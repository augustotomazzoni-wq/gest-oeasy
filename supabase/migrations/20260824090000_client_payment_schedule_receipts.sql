-- Dados de pagamento do cliente, recebimentos divididos e correções de caixa.

-- O Sócio Gestor também pode operar os cadastros e o financeiro.
CREATE OR REPLACE FUNCTION public.can_write()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(),'admin')
      OR public.has_role(auth.uid(),'socio_gestor')
      OR public.has_role(auth.uid(),'financeiro');
$$;

-- Cria cliente e sua forma de recebimento na mesma transação.
CREATE OR REPLACE FUNCTION public.create_client_with_payment_account(
  _name text,
  _tax_id text DEFAULT NULL,
  _phone text DEFAULT NULL,
  _email text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _pix_key_type text DEFAULT NULL,
  _pix_key text DEFAULT NULL,
  _bank text DEFAULT NULL,
  _branch text DEFAULT NULL,
  _account text DEFAULT NULL,
  _holder_name text DEFAULT NULL,
  _holder_tax_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _organization_id uuid := public.current_org_id();
  _client_id uuid;
BEGIN
  IF _organization_id IS NULL OR NOT public.can_write() THEN
    RAISE EXCEPTION 'Usuário sem permissão para cadastrar clientes.';
  END IF;

  IF NULLIF(btrim(_name), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o nome do cliente.';
  END IF;

  INSERT INTO public.clients (
    organization_id, created_by, name, tax_id, phone, email, notes
  ) VALUES (
    _organization_id,
    auth.uid(),
    btrim(_name),
    NULLIF(btrim(_tax_id), ''),
    NULLIF(btrim(_phone), ''),
    NULLIF(btrim(_email), ''),
    NULLIF(btrim(_notes), '')
  )
  RETURNING id INTO _client_id;

  IF COALESCE(
    NULLIF(btrim(_pix_key), ''),
    NULLIF(btrim(_bank), ''),
    NULLIF(btrim(_account), '')
  ) IS NOT NULL THEN
    INSERT INTO public.client_payment_accounts (
      organization_id, client_id, created_by,
      pix_key_type, pix_key, bank, branch, account,
      holder_name, holder_tax_id
    ) VALUES (
      _organization_id, _client_id, auth.uid(),
      NULLIF(btrim(_pix_key_type), ''), NULLIF(btrim(_pix_key), ''),
      NULLIF(btrim(_bank), ''), NULLIF(btrim(_branch), ''),
      NULLIF(btrim(_account), ''), NULLIF(btrim(_holder_name), ''),
      NULLIF(btrim(_holder_tax_id), '')
    );
  END IF;

  RETURN _client_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_client_with_payment_account(
  text, text, text, text, text, text, text, text, text, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_client_with_payment_account(
  text, text, text, text, text, text, text, text, text, text, text, text
) TO authenticated;

-- Separa a classificação econômica do recebimento do local em que o dinheiro entrou.
ALTER TABLE public.receipts
  ADD COLUMN receipt_destination text NOT NULL DEFAULT 'conta_escritorio',
  ADD COLUMN client_amount_received_by_firm numeric(14,2),
  ADD COLUMN client_amount_received_direct numeric(14,2),
  ADD COLUMN amount_received_in_firm_account numeric(14,2),
  ADD COLUMN allocation_override_reason text;

UPDATE public.receipts
SET client_amount_received_by_firm = client_amount,
    client_amount_received_direct = 0,
    amount_received_in_firm_account = total_amount;

ALTER TABLE public.receipts
  ALTER COLUMN client_amount_received_by_firm SET DEFAULT 0,
  ALTER COLUMN client_amount_received_by_firm SET NOT NULL,
  ALTER COLUMN client_amount_received_direct SET DEFAULT 0,
  ALTER COLUMN client_amount_received_direct SET NOT NULL,
  ALTER COLUMN amount_received_in_firm_account SET DEFAULT 0,
  ALTER COLUMN amount_received_in_firm_account SET NOT NULL,
  ADD CONSTRAINT receipts_destination_check CHECK (
    receipt_destination IN ('conta_escritorio', 'cliente_direto', 'dividido')
  ),
  ADD CONSTRAINT receipts_nonnegative_destination_amounts CHECK (
    client_amount_received_by_firm >= 0
    AND client_amount_received_direct >= 0
    AND amount_received_in_firm_account >= 0
  ),
  ADD CONSTRAINT receipts_client_destination_allocation_check CHECK (
    abs(client_amount - (
      client_amount_received_by_firm + client_amount_received_direct
    )) <= 0.01
  ),
  ADD CONSTRAINT receipts_firm_account_allocation_check CHECK (
    abs(amount_received_in_firm_account - (
      fee_amount + success_fee_amount + cost_reimbursement
      + client_amount_received_by_firm
    )) <= 0.01
  ),
  ADD CONSTRAINT receipts_destination_consistency_check CHECK (
    (receipt_destination = 'conta_escritorio' AND client_amount_received_direct <= 0.01)
    OR (receipt_destination = 'cliente_direto' AND amount_received_in_firm_account <= 0.01)
    OR (receipt_destination = 'dividido'
        AND amount_received_in_firm_account > 0.01
        AND client_amount_received_direct > 0.01)
  );

-- O caixa recebe somente o valor que efetivamente entrou na conta do escritório.
CREATE OR REPLACE FUNCTION public.sync_receipt_transaction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.financial_transactions
    WHERE source_type = 'receipt' AND source_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.amount_received_in_firm_account > 0.01 THEN
    INSERT INTO public.financial_transactions (
      organization_id, type, description, competence_date, paid_on, amount,
      status, bank_account_id, source_type, source_id, created_by
    ) VALUES (
      NEW.organization_id,
      CASE
        WHEN NEW.client_amount_received_by_firm > 0.01
             AND NEW.fee_amount + NEW.success_fee_amount + NEW.cost_reimbursement <= 0.01
          THEN 'entrada_de_terceiros'::public.tx_type
        ELSE 'entrada'::public.tx_type
      END,
      'Recebimento de parcela - valor em conta do escritório',
      NEW.received_on,
      NEW.received_on,
      NEW.amount_received_in_firm_account,
      'pago',
      NEW.bank_account_id,
      'receipt',
      NEW.id,
      NEW.created_by
    )
    ON CONFLICT (source_type, source_id) DO UPDATE
      SET type = EXCLUDED.type,
          amount = EXCLUDED.amount,
          paid_on = EXCLUDED.paid_on,
          bank_account_id = EXCLUDED.bank_account_id,
          updated_at = now();
  ELSE
    DELETE FROM public.financial_transactions
    WHERE source_type = 'receipt' AND source_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- Mantém as colunas existentes da view e acrescenta os novos detalhamentos ao final.
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
    WHEN COALESCE(rc.paid_total,0) > 0.01 THEN 'PARCIAL'
    WHEN i.due_date IS NULL THEN 'A_DEFINIR'
    WHEN i.due_date = current_date THEN 'VENCE_HOJE'
    WHEN i.due_date < current_date THEN 'ATRASADA'
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

-- Valores recebidos diretamente pela cliente não geram obrigação de repasse.
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
) tr ON tr.client_id = c.id;

