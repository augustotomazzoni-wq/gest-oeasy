-- Melhorias de 27/08/2026:
--   trava que faltava no caixa, contas a pagar com vencimento, recorrência
--   mensal, forma de pagamento e exportação controlada por permissão.

-- ============================================================
-- 1) O caixa não conseguia gravar NENHUM recebimento.
--    A trava de duplicidade criada na migration original é PARCIAL
--    (WHERE source_type IS NOT NULL). O Postgres não aceita inferir um
--    índice parcial no "ON CONFLICT (source_type, source_id)" que a função
--    de espelhar o recebimento no caixa usa — então todo recebimento
--    morria com "there is no unique or exclusion constraint matching the
--    ON CONFLICT specification". Um índice completo resolve: colunas nulas
--    continuam sendo tratadas como distintas, então lançamentos manuais
--    (sem origem) seguem podendo se repetir à vontade.
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS financial_transactions_source_uidx
  ON public.financial_transactions (source_type, source_id);

DROP INDEX IF EXISTS public.financial_transactions_source_uniq;

-- ============================================================
-- 2) Forma de pagamento do lançamento (dinheiro, PIX, cartão…).
--    'alvara' só faz sentido em entradas, mas a checagem fica aberta:
--    quem restringe por tipo é a tela.
-- ============================================================
ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS payment_method text;

ALTER TABLE public.financial_transactions
  DROP CONSTRAINT IF EXISTS financial_transactions_payment_method_check;

ALTER TABLE public.financial_transactions
  ADD CONSTRAINT financial_transactions_payment_method_check CHECK (
    payment_method IS NULL OR payment_method IN (
      'dinheiro', 'pix', 'cartao_credito', 'cartao_debito',
      'transferencia', 'boleto', 'alvara', 'outro'
    )
  ) NOT VALID;

-- ============================================================
-- 3) Recorrência: um lançamento que se repete por N meses.
--    Cada mês vira uma linha própria (dá para pagar, editar ou cancelar
--    um mês sem mexer nos outros); recurrence_group_id costura o grupo
--    para o dia em que for preciso apagar a série inteira.
-- ============================================================
ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS recurrence_group_id uuid,
  ADD COLUMN IF NOT EXISTS recurrence_index integer,
  ADD COLUMN IF NOT EXISTS recurrence_total integer;

CREATE INDEX IF NOT EXISTS financial_transactions_recurrence_idx
  ON public.financial_transactions (recurrence_group_id)
  WHERE recurrence_group_id IS NOT NULL;

-- Contas a pagar: a lista é sempre "o que vence no período", por vencimento.
CREATE INDEX IF NOT EXISTS financial_transactions_due_idx
  ON public.financial_transactions (organization_id, status, due_date);

-- ============================================================
-- 4) Apagar a série inteira de uma recorrência de uma vez.
--    Só apaga o que ainda está previsto — mês já pago vira histórico e
--    não pode sumir do caixa.
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_recurrence_series(_group_id uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _org uuid := public.current_org_id();
  _removed integer;
  _user_email text;
BEGIN
  IF _org IS NULL OR NOT public.can_write() THEN
    RAISE EXCEPTION 'Usuário sem permissão para apagar lançamentos.';
  END IF;

  IF _group_id IS NULL THEN
    RAISE EXCEPTION 'Informe a recorrência a apagar.';
  END IF;

  WITH apagados AS (
    DELETE FROM public.financial_transactions
    WHERE recurrence_group_id = _group_id
      AND organization_id = _org
      AND status <> 'pago'
    RETURNING id
  )
  SELECT count(*) INTO _removed FROM apagados;

  SELECT email INTO _user_email FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (
    organization_id, user_id, user_email, action, table_name, record_id, old_values
  ) VALUES (
    _org, auth.uid(), _user_email, 'apagar_recorrencia', 'financial_transactions',
    _group_id, jsonb_build_object('lancamentos_apagados', _removed)
  );

  RETURN _removed;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_recurrence_series(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_recurrence_series(uuid) TO authenticated;

-- ============================================================
-- 5) Exportar clientes, processos e fluxo de caixa passa a ser uma
--    permissão como qualquer outra: o Administrador liga e desliga na
--    coluna "Exportar" da tela Usuários e Perfis de Acesso.
--    Antes, qualquer pessoa logada — inclusive a Consulta Restrita —
--    baixava a base inteira com CPF, endereço e telefone num clique.
--    Financeiro e Sócio Gestor já vêm liberados para não mudar a rotina
--    de quem hoje usa; os demais entram bloqueados.
-- ============================================================
INSERT INTO public.role_permissions (organization_id, role_code, module, action, allowed)
SELECT o.id, r.role_code, m.module, 'export', r.allowed
FROM public.organizations o
CROSS JOIN (VALUES
  ('admin', true),
  ('socio_gestor', true),
  ('financeiro', true),
  ('lancador', false),
  ('cobranca', false),
  ('advogado', false),
  ('consulta', false)
) AS r(role_code, allowed)
CROSS JOIN (VALUES ('clientes'), ('processos'), ('caixa'), ('importacao')) AS m(module)
ON CONFLICT (organization_id, role_code, module, action) DO NOTHING;
