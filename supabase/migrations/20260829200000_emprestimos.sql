-- Empréstimos: dinheiro que entra no caixa mas não é receita do escritório,
-- e as parcelas futuras que ele gera.
--
-- O problema que isto resolve: lançar um empréstimo de R$ 130.000 como receita
-- comum inflava o lucro e estragava o custo por cliente; e as 54 parcelas de
-- devolução, lançadas como despesa comum, derrubavam o lucro de todo mês por
-- algo que não é custo de operação. Empréstimo é financiamento: mexe no saldo
-- da conta, não no resultado.

-- ============================================================
-- 1) Marca de financiamento no lançamento.
--    Entra e sai do caixa (o saldo do banco é real), mas fica de fora do
--    lucro, do custo por cliente e da receita média por cliente.
-- ============================================================
ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS is_financing boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS financial_transactions_financing_idx
  ON public.financial_transactions (organization_id, is_financing)
  WHERE is_financing;

-- ============================================================
-- 2) O empréstimo em si, para agrupar o contrato e suas parcelas.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lender text NOT NULL,
  contract_number text,
  amount_received numeric(14,2) NOT NULL DEFAULT 0,
  received_on date,
  bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE INDEX IF NOT EXISTS loans_org_idx ON public.loans (organization_id, received_on DESC);

ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS loan_id uuid REFERENCES public.loans(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS financial_transactions_loan_idx
  ON public.financial_transactions (loan_id)
  WHERE loan_id IS NOT NULL;

ALTER TABLE public.loans ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.loans TO authenticated;
GRANT ALL ON public.loans TO service_role;

DROP POLICY IF EXISTS loans_select ON public.loans;
CREATE POLICY loans_select ON public.loans FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id());

DROP POLICY IF EXISTS loans_write ON public.loans;
CREATE POLICY loans_write ON public.loans FOR ALL TO authenticated
  USING (organization_id = public.current_org_id() AND public.can_write())
  WITH CHECK (organization_id = public.current_org_id() AND public.can_write());

-- ============================================================
-- 3) Cadastrar o empréstimo inteiro de uma vez.
--    Cria a entrada do dinheiro recebido e todas as parcelas futuras como
--    contas a pagar, já marcadas como financiamento.
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_loan(
  _lender text,
  _amount_received numeric,
  _received_on date,
  _installments jsonb,
  _contract_number text DEFAULT NULL,
  _bank_account_id uuid DEFAULT NULL,
  _category_id uuid DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  _org uuid := public.current_org_id();
  _loan_id uuid;
  _item jsonb;
  _n integer := 0;
  _user_email text;
BEGIN
  IF _org IS NULL OR NOT public.can_write() THEN
    RAISE EXCEPTION 'Você não tem permissão para cadastrar empréstimos.';
  END IF;

  IF NULLIF(btrim(_lender), '') IS NULL THEN
    RAISE EXCEPTION 'Informe quem concedeu o empréstimo.';
  END IF;

  IF _amount_received IS NULL OR _amount_received <= 0 THEN
    RAISE EXCEPTION 'Informe o valor recebido.';
  END IF;

  INSERT INTO public.loans (
    organization_id, created_by, lender, contract_number,
    amount_received, received_on, bank_account_id, notes
  ) VALUES (
    _org, auth.uid(), btrim(_lender), NULLIF(btrim(_contract_number), ''),
    _amount_received, _received_on, _bank_account_id, NULLIF(btrim(_notes), '')
  )
  RETURNING id INTO _loan_id;

  -- O dinheiro que entrou: aparece no caixa e no saldo, fora do resultado.
  INSERT INTO public.financial_transactions (
    organization_id, created_by, type, status, description, amount,
    paid_on, due_date, competence_date, bank_account_id, category_id,
    is_financing, loan_id
  ) VALUES (
    _org, auth.uid(), 'entrada', 'pago',
    'Empréstimo recebido - ' || btrim(_lender)
      || COALESCE(' (' || NULLIF(btrim(_contract_number), '') || ')', ''),
    _amount_received, _received_on, _received_on, _received_on,
    _bank_account_id, _category_id, true, _loan_id
  );

  -- As parcelas de devolução: contas a pagar, uma por vencimento.
  IF _installments IS NOT NULL AND jsonb_array_length(_installments) > 0 THEN
    FOR _item IN SELECT * FROM jsonb_array_elements(_installments) LOOP
      _n := _n + 1;
      INSERT INTO public.financial_transactions (
        organization_id, created_by, type, status, description, amount,
        due_date, competence_date, bank_account_id, category_id,
        is_financing, loan_id, recurrence_index, recurrence_total
      ) VALUES (
        _org, auth.uid(), 'saida', 'previsto',
        'Parcela ' || _n || '/' || jsonb_array_length(_installments)
          || ' - ' || btrim(_lender),
        COALESCE((_item->>'amount')::numeric, 0),
        NULLIF(_item->>'due_date', '')::date,
        NULLIF(_item->>'due_date', '')::date,
        _bank_account_id, _category_id, true, _loan_id,
        _n, jsonb_array_length(_installments)
      );
    END LOOP;
  END IF;

  SELECT email INTO _user_email FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (
    organization_id, user_id, user_email, action, table_name, record_id, new_values
  ) VALUES (
    _org, auth.uid(), _user_email, 'cadastrar_emprestimo', 'loans', _loan_id,
    jsonb_build_object('credor', _lender, 'valor', _amount_received, 'parcelas', _n)
  );

  RETURN _loan_id;
END;
$fn$;

-- ============================================================
-- 4) Apagar o empréstimo. Some com as parcelas que ainda não foram pagas;
--    o que já foi pago permanece, porque saiu do caixa de verdade.
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_loan(_loan_id uuid)
RETURNS integer LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  _org uuid := public.current_org_id();
  _pagas integer;
  _removidas integer;
  _user_email text;
BEGIN
  IF _org IS NULL OR NOT public.can_write() THEN
    RAISE EXCEPTION 'Você não tem permissão para apagar empréstimos.';
  END IF;

  SELECT count(*) INTO _pagas
  FROM public.financial_transactions
  WHERE loan_id = _loan_id AND organization_id = _org AND status = 'pago';

  WITH apagadas AS (
    DELETE FROM public.financial_transactions
    WHERE loan_id = _loan_id AND organization_id = _org AND status <> 'pago'
    RETURNING id
  )
  SELECT count(*) INTO _removidas FROM apagadas;

  UPDATE public.financial_transactions
  SET loan_id = NULL
  WHERE loan_id = _loan_id AND organization_id = _org;

  DELETE FROM public.loans WHERE id = _loan_id AND organization_id = _org;

  SELECT email INTO _user_email FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (
    organization_id, user_id, user_email, action, table_name, record_id, old_values
  ) VALUES (
    _org, auth.uid(), _user_email, 'apagar_emprestimo', 'loans', _loan_id,
    jsonb_build_object('parcelas_apagadas', _removidas, 'lancamentos_pagos_mantidos', _pagas)
  );

  RETURN _removidas;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.create_loan(
  text, numeric, date, jsonb, text, uuid, uuid, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_loan(
  text, numeric, date, jsonb, text, uuid, uuid, text
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.delete_loan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_loan(uuid) TO authenticated;
