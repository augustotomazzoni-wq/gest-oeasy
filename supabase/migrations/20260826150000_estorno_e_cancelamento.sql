-- Estorno de recebimento e cancelamento de parcela, acordo e repasse.
--
-- Princípio: nada é apagado. Um lançamento errado é ESTORNADO — a linha
-- continua no banco com quem estornou, quando e por quê — e deixa de contar
-- em qualquer saldo, view ou relatório. É o comportamento esperado em
-- controle financeiro: o histórico do erro faz parte da auditoria.

-- ============================================================
-- 1) Colunas de estorno/cancelamento
-- ============================================================
ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid,
  ADD COLUMN IF NOT EXISTS reversal_reason text;

CREATE INDEX IF NOT EXISTS receipts_active_idx
  ON public.receipts (installment_id) WHERE reversed_at IS NULL;

-- legal_receivables e client_transfers já têm status 'cancelado' no enum;
-- installments já tem canceled_at/cancel_reason. Falta só o motivo do
-- cancelamento nos dois primeiros.
ALTER TABLE public.legal_receivables
  ADD COLUMN IF NOT EXISTS cancel_reason text;

ALTER TABLE public.client_transfers
  ADD COLUMN IF NOT EXISTS cancel_reason text;

-- ============================================================
-- 2) Recebimento estornado não conta mais em lugar nenhum
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
  WHERE reversed_at IS NULL
  GROUP BY installment_id
) rc ON rc.installment_id = i.id;

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
  WHERE rp.reversed_at IS NULL
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
-- 3) O caixa também precisa ignorar o que foi estornado: ao estornar,
--    os lançamentos correspondentes saem do fluxo de caixa.
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

  -- Estornado: remove do caixa e não gera nada novo.
  IF NEW.reversed_at IS NOT NULL THEN
    DELETE FROM public.financial_transactions
    WHERE source_id = NEW.id AND source_type IN ('receipt', 'receipt_client');
    RETURN NEW;
  END IF;

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
      SET type = EXCLUDED.type, description = EXCLUDED.description,
          amount = EXCLUDED.amount, paid_on = EXCLUDED.paid_on,
          bank_account_id = EXCLUDED.bank_account_id, updated_at = now();
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
      SET type = EXCLUDED.type, description = EXCLUDED.description,
          amount = EXCLUDED.amount, paid_on = EXCLUDED.paid_on,
          bank_account_id = EXCLUDED.bank_account_id, updated_at = now();
  ELSE
    DELETE FROM public.financial_transactions
    WHERE source_type = 'receipt_client' AND source_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- A trava de sobrepagamento também precisa ignorar recebimentos estornados,
-- senão um estorno seguido do lançamento correto seria bloqueado.
CREATE OR REPLACE FUNCTION public.prevent_installment_overpay()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _gross numeric;
  _already_paid numeric;
BEGIN
  -- Estorno não precisa passar pela trava.
  IF NEW.reversed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT gross_amount INTO _gross
  FROM public.installments
  WHERE id = NEW.installment_id
  FOR UPDATE;

  IF _gross IS NULL THEN
    RAISE EXCEPTION 'Parcela não encontrada.';
  END IF;

  SELECT COALESCE(sum(total_amount), 0) INTO _already_paid
  FROM public.receipts
  WHERE installment_id = NEW.installment_id
    AND id <> NEW.id
    AND reversed_at IS NULL;

  IF _already_paid + NEW.total_amount - _gross > 0.01 THEN
    RAISE EXCEPTION 'Este recebimento ultrapassa o saldo da parcela.';
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 4) Funções de estorno/cancelamento — cada uma checa a permissão
--    "cancel_or_reverse" do módulo e grava a auditoria.
-- ============================================================

CREATE OR REPLACE FUNCTION public.reverse_receipt(_receipt_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _org uuid := public.current_org_id();
  _rec public.receipts%ROWTYPE;
  _user_email text;
BEGIN
  IF _org IS NULL OR NOT public.can('parcelas', 'cancel_or_reverse') THEN
    RAISE EXCEPTION 'Você não tem permissão para estornar recebimentos.';
  END IF;

  IF NULLIF(btrim(_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do estorno.';
  END IF;

  SELECT * INTO _rec FROM public.receipts
  WHERE id = _receipt_id AND organization_id = _org
  FOR UPDATE;

  IF _rec.id IS NULL THEN
    RAISE EXCEPTION 'Recebimento não encontrado.';
  END IF;

  IF _rec.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Este recebimento já foi estornado.';
  END IF;

  UPDATE public.receipts
  SET reversed_at = now(),
      reversed_by = auth.uid(),
      reversal_reason = btrim(_reason)
  WHERE id = _receipt_id;

  SELECT email INTO _user_email FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (
    organization_id, user_id, user_email, action, table_name, record_id, old_values, new_values
  ) VALUES (
    _org, auth.uid(), _user_email, 'estornar_recebimento', 'receipts', _receipt_id,
    jsonb_build_object(
      'total_amount', _rec.total_amount,
      'fee_amount', _rec.fee_amount,
      'success_fee_amount', _rec.success_fee_amount,
      'client_amount', _rec.client_amount,
      'received_on', _rec.received_on
    ),
    jsonb_build_object('motivo', btrim(_reason))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_installment(_installment_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _org uuid := public.current_org_id();
  _inst public.installments%ROWTYPE;
  _paid numeric;
  _user_email text;
BEGIN
  IF _org IS NULL OR NOT public.can('parcelas', 'cancel_or_reverse') THEN
    RAISE EXCEPTION 'Você não tem permissão para cancelar parcelas.';
  END IF;

  IF NULLIF(btrim(_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento.';
  END IF;

  SELECT * INTO _inst FROM public.installments
  WHERE id = _installment_id AND organization_id = _org
  FOR UPDATE;

  IF _inst.id IS NULL THEN
    RAISE EXCEPTION 'Parcela não encontrada.';
  END IF;

  IF _inst.canceled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta parcela já está cancelada.';
  END IF;

  SELECT COALESCE(sum(total_amount), 0) INTO _paid
  FROM public.receipts
  WHERE installment_id = _installment_id AND reversed_at IS NULL;

  IF _paid > 0.01 THEN
    RAISE EXCEPTION 'Esta parcela tem recebimento lançado. Estorne o recebimento antes de cancelar.';
  END IF;

  UPDATE public.installments
  SET canceled_at = now(), cancel_reason = btrim(_reason)
  WHERE id = _installment_id;

  SELECT email INTO _user_email FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (
    organization_id, user_id, user_email, action, table_name, record_id, new_values
  ) VALUES (
    _org, auth.uid(), _user_email, 'cancelar_parcela', 'installments', _installment_id,
    jsonb_build_object('motivo', btrim(_reason), 'valor', _inst.gross_amount)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_receivable(_receivable_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _org uuid := public.current_org_id();
  _recv public.legal_receivables%ROWTYPE;
  _paid numeric;
  _canceled_count integer;
  _user_email text;
BEGIN
  IF _org IS NULL OR NOT public.can('acordos', 'cancel_or_reverse') THEN
    RAISE EXCEPTION 'Você não tem permissão para cancelar acordos.';
  END IF;

  IF NULLIF(btrim(_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento.';
  END IF;

  SELECT * INTO _recv FROM public.legal_receivables
  WHERE id = _receivable_id AND organization_id = _org
  FOR UPDATE;

  IF _recv.id IS NULL THEN
    RAISE EXCEPTION 'Acordo não encontrado.';
  END IF;

  IF _recv.status = 'cancelado' THEN
    RAISE EXCEPTION 'Este acordo já está cancelado.';
  END IF;

  SELECT COALESCE(sum(rp.total_amount), 0) INTO _paid
  FROM public.receipts rp
  JOIN public.installments i ON i.id = rp.installment_id
  WHERE i.receivable_id = _receivable_id AND rp.reversed_at IS NULL;

  IF _paid > 0.01 THEN
    RAISE EXCEPTION 'Este acordo já tem recebimentos lançados. Estorne os recebimentos antes de cancelar.';
  END IF;

  -- Cancela junto as parcelas em aberto: um acordo cancelado não deve
  -- continuar cobrando nas telas de parcelas e no dashboard.
  UPDATE public.installments
  SET canceled_at = now(),
      cancel_reason = 'Acordo cancelado: ' || btrim(_reason)
  WHERE receivable_id = _receivable_id AND canceled_at IS NULL;
  GET DIAGNOSTICS _canceled_count = ROW_COUNT;

  UPDATE public.legal_receivables
  SET status = 'cancelado', cancel_reason = btrim(_reason)
  WHERE id = _receivable_id;

  SELECT email INTO _user_email FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (
    organization_id, user_id, user_email, action, table_name, record_id, new_values
  ) VALUES (
    _org, auth.uid(), _user_email, 'cancelar_acordo', 'legal_receivables', _receivable_id,
    jsonb_build_object(
      'motivo', btrim(_reason),
      'parcelas_canceladas', _canceled_count
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_transfer(_transfer_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _org uuid := public.current_org_id();
  _tr public.client_transfers%ROWTYPE;
  _user_email text;
BEGIN
  IF _org IS NULL OR NOT public.can('repasses', 'cancel_or_reverse') THEN
    RAISE EXCEPTION 'Você não tem permissão para cancelar repasses.';
  END IF;

  IF NULLIF(btrim(_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento.';
  END IF;

  SELECT * INTO _tr FROM public.client_transfers
  WHERE id = _transfer_id AND organization_id = _org
  FOR UPDATE;

  IF _tr.id IS NULL THEN
    RAISE EXCEPTION 'Repasse não encontrado.';
  END IF;

  IF _tr.status = 'cancelado' THEN
    RAISE EXCEPTION 'Este repasse já está cancelado.';
  END IF;

  -- Cancelar um repasse já pago devolve o valor ao saldo a repassar da
  -- cliente (o trigger de sincronização remove o lançamento do caixa).
  UPDATE public.client_transfers
  SET status = 'cancelado', cancel_reason = btrim(_reason), paid_on = NULL
  WHERE id = _transfer_id;

  SELECT email INTO _user_email FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (
    organization_id, user_id, user_email, action, table_name, record_id, old_values, new_values
  ) VALUES (
    _org, auth.uid(), _user_email, 'cancelar_repasse', 'client_transfers', _transfer_id,
    jsonb_build_object('amount', _tr.amount, 'status', _tr.status, 'paid_on', _tr.paid_on),
    jsonb_build_object('motivo', btrim(_reason))
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reverse_receipt(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_installment(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_receivable(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_transfer(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.reverse_receipt(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_installment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_receivable(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_transfer(uuid, text) TO authenticated;

-- ============================================================
-- 5) "Data do saldo inicial" era preenchida no cadastro da conta e nunca
--    usada: o saldo somava TODAS as movimentações pagas, inclusive as
--    anteriores à data informada — o que inflava o saldo sem deixar pista.
--    Agora só entram no cálculo os lançamentos a partir dessa data.
-- ============================================================
CREATE OR REPLACE VIEW public.v_bank_balances
WITH (security_invoker = true) AS
SELECT b.id AS bank_account_id, b.organization_id, b.name, b.color,
  b.initial_balance + COALESCE(mv.delta,0) AS balance
FROM public.bank_accounts b
LEFT JOIN LATERAL (
  SELECT sum(CASE WHEN t.type IN ('entrada','entrada_de_terceiros') THEN t.amount
                  WHEN t.type IN ('saida','repasse_de_terceiros') THEN -t.amount
                  ELSE 0 END) AS delta
  FROM public.financial_transactions t
  WHERE t.bank_account_id = b.id
    AND t.status = 'pago'
    AND (t.paid_on IS NULL OR t.paid_on >= b.initial_balance_date)
) mv ON true;
