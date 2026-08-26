-- Correções da varredura de 26/08/2026.

-- ============================================================
-- 1) Campo "Observações" do Fluxo de Caixa era digitado e descartado:
--    a tela tinha o campo, mas a coluna não existia no banco.
-- ============================================================
ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS notes text;

-- ============================================================
-- 2) A política de escrita em user_roles era a única sem checagem de
--    organização. Um usuário desativado mantém o token válido até expirar,
--    e podia continuar alterando papéis de todo mundo pela API — inclusive
--    removendo o papel dos outros e trancando o escritório fora do sistema.
--    current_org_id() já retorna NULL para usuário inativo, então exigir a
--    organização resolve os dois problemas de uma vez.
-- ============================================================
DROP POLICY IF EXISTS roles_write ON public.user_roles;
CREATE POLICY roles_write ON public.user_roles FOR ALL TO authenticated
  USING (
    public.current_org_id() IS NOT NULL
    AND public.can('global', 'manage_users')
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = user_roles.user_id
        AND p.organization_id = public.current_org_id()
    )
  )
  WITH CHECK (
    public.current_org_id() IS NOT NULL
    AND public.can('global', 'manage_users')
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = user_roles.user_id
        AND p.organization_id = public.current_org_id()
    )
  );

-- Quem administra usuários precisa enxergar o papel atual de cada pessoa.
-- Sem isto, o Sócio Gestor via todo mundo como "Consulta Restrita" e podia
-- sobrescrever papéis corretos sem perceber.
DROP POLICY IF EXISTS roles_select_self ON public.user_roles;
CREATE POLICY roles_select_self ON public.user_roles FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR (
      public.can('global', 'manage_users')
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = user_roles.user_id
          AND p.organization_id = public.current_org_id()
      )
    )
  );

-- ============================================================
-- 3) Parcela vencida com pagamento parcial ficava escondida: o status
--    PARCIAL era testado antes de ATRASADA, então ela sumia do card de
--    atrasos, dos alertas e do gráfico de envelhecimento — justamente a
--    dívida que já começou a atrasar. Agora o vencimento tem prioridade,
--    e o valor já pago continua visível nas colunas Recebido/Saldo.
-- ============================================================
CREATE OR REPLACE VIEW public.v_installments
WITH (security_invoker = true) AS
SELECT i.*,
  r.client_id, r.case_id, r.type AS receivable_type, r.status AS receivable_status,
  r.is_estimated,
  COALESCE(rc.paid_total,0) AS paid_total,
  COALESCE(rc.paid_fee,0) AS paid_fee,
  COALESCE(rc.paid_success_fee,0) AS paid_success_fee,
  COALESCE(rc.paid_client,0) AS paid_client,
  (i.gross_amount - COALESCE(rc.paid_total,0)) AS balance,
  CASE
    WHEN i.canceled_at IS NOT NULL THEN 'CANCELADA'
    WHEN i.gross_amount - COALESCE(rc.paid_total,0) <= 0.01
         AND COALESCE(rc.paid_total,0) > 0 THEN 'PAGA'
    WHEN i.due_date IS NOT NULL AND i.due_date < current_date THEN 'ATRASADA'
    WHEN COALESCE(rc.paid_total,0) > 0.01 THEN 'PARCIAL'
    WHEN i.due_date IS NULL THEN 'A_DEFINIR'
    WHEN i.due_date = current_date THEN 'VENCE_HOJE'
    ELSE 'A_VENCER'
  END AS status,
  COALESCE(rc.paid_cost_reimbursement,0) AS paid_cost_reimbursement,
  r.flow AS payment_flow
FROM public.installments i
JOIN public.legal_receivables r ON r.id = i.receivable_id
LEFT JOIN (
  SELECT installment_id,
         sum(total_amount) paid_total,
         sum(fee_amount) paid_fee,
         sum(success_fee_amount) paid_success_fee,
         sum(client_amount) paid_client,
         sum(cost_reimbursement) paid_cost_reimbursement
  FROM public.receipts
  GROUP BY installment_id
) rc ON rc.installment_id = i.id;

-- ============================================================
-- 4) Cliente excluído continuava aparecendo no seletor de repasses, no
--    painel "Saldo por cliente" e somando em "Aguardando repasse" no
--    dashboard — sem aparecer mais na tela de Clientes para conferir.
-- ============================================================
CREATE OR REPLACE VIEW public.v_client_balances
WITH (security_invoker = true) AS
SELECT c.id AS client_id, c.organization_id, c.name,
  COALESCE(rec.received_client,0) AS received_client,
  COALESCE(tr.transferred,0) AS transferred,
  COALESCE(rec.received_client,0) - COALESCE(tr.transferred,0) AS pending_transfer
FROM public.clients c
LEFT JOIN (
  SELECT r.client_id, sum(rp.client_amount_received_by_firm) received_client
  FROM public.receipts rp
  JOIN public.installments i ON i.id = rp.installment_id
  JOIN public.legal_receivables r ON r.id = i.receivable_id
  GROUP BY r.client_id
) rec ON rec.client_id = c.id
LEFT JOIN (
  SELECT client_id, sum(amount) transferred
  FROM public.client_transfers
  WHERE status = 'pago'
  GROUP BY client_id
) tr ON tr.client_id = c.id
WHERE c.deleted_at IS NULL;

-- ============================================================
-- 5) O caixa contava dinheiro da cliente como receita do escritório.
--    Quando o escritório recebia o total e repassava depois, o lançamento
--    inteiro entrava como 'entrada' — então "Receitas do escritório" e
--    "Resultado do mês" no Fluxo de Caixa ficavam inflados e divergiam do
--    Dashboard (que sempre contou só honorários + sucumbência).
--
--    Agora o recebimento gera até dois lançamentos: a parte do escritório
--    como 'entrada' e a parte da cliente como 'entrada_de_terceiros'. O
--    saldo bancário continua igual (os dois são entradas), mas o resultado
--    do mês passa a refletir só o que é do escritório.
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_receipt_transaction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _firm_share numeric;
  _client_share numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.financial_transactions
    WHERE source_id = OLD.id AND source_type IN ('receipt', 'receipt_client');
    RETURN OLD;
  END IF;

  -- O que é receita do escritório e o que é dinheiro da cliente que passou
  -- pela conta dele (e por isso ainda vai gerar repasse).
  _firm_share := COALESCE(NEW.fee_amount, 0)
               + COALESCE(NEW.success_fee_amount, 0)
               + COALESCE(NEW.cost_reimbursement, 0);
  _client_share := COALESCE(NEW.client_amount_received_by_firm, 0);

  IF _firm_share > 0.01 THEN
    INSERT INTO public.financial_transactions (
      organization_id, type, description, competence_date, paid_on, amount,
      status, bank_account_id, source_type, source_id, created_by
    ) VALUES (
      NEW.organization_id, 'entrada',
      'Recebimento de parcela - honorários do escritório',
      NEW.received_on, NEW.received_on, _firm_share, 'pago',
      NEW.bank_account_id, 'receipt', NEW.id, NEW.created_by
    )
    ON CONFLICT (source_type, source_id) DO UPDATE
      SET type = EXCLUDED.type,
          description = EXCLUDED.description,
          amount = EXCLUDED.amount,
          paid_on = EXCLUDED.paid_on,
          bank_account_id = EXCLUDED.bank_account_id,
          updated_at = now();
  ELSE
    DELETE FROM public.financial_transactions
    WHERE source_type = 'receipt' AND source_id = NEW.id;
  END IF;

  IF _client_share > 0.01 THEN
    INSERT INTO public.financial_transactions (
      organization_id, type, description, competence_date, paid_on, amount,
      status, bank_account_id, source_type, source_id, created_by
    ) VALUES (
      NEW.organization_id, 'entrada_de_terceiros',
      'Recebimento de parcela - valor da cliente em conta do escritório',
      NEW.received_on, NEW.received_on, _client_share, 'pago',
      NEW.bank_account_id, 'receipt_client', NEW.id, NEW.created_by
    )
    ON CONFLICT (source_type, source_id) DO UPDATE
      SET type = EXCLUDED.type,
          description = EXCLUDED.description,
          amount = EXCLUDED.amount,
          paid_on = EXCLUDED.paid_on,
          bank_account_id = EXCLUDED.bank_account_id,
          updated_at = now();
  ELSE
    DELETE FROM public.financial_transactions
    WHERE source_type = 'receipt_client' AND source_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- Reprocessa os recebimentos já existentes para que o caixa passe a mostrar
-- a separação correta também no histórico.
UPDATE public.receipts SET updated_at = updated_at;
