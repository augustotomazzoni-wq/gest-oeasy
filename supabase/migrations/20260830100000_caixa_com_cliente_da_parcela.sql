-- De quem é a parcela que entrou no caixa.
--
-- O lançamento nascido de uma baixa dizia só "Recebimento de parcela -
-- honorários do escritório". Sem o cliente e sem a parcela, quem olha o Fluxo
-- de Caixa vê o valor e não tem como saber de quem veio — e para conferir
-- precisa ir até Parcelas procurar pela data.
--
-- O repasse ao cliente já gravava o `client_id` desde o começo; o recebimento
-- não. Aqui os dois passam a gravar, e a descrição passa a dizer qual parcela
-- foi.

-- ============================================================
-- 1) O gatilho do recebimento
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_receipt_transaction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _firm_share numeric;
  _client_share numeric;
  _client_id uuid;
  _case_id uuid;
  _label text;
  _sufixo text;
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

  -- De quem é esta parcela. O caminho é recebimento → parcela → acordo.
  SELECT r.client_id, r.case_id, i.label
    INTO _client_id, _case_id, _label
  FROM public.installments i
  JOIN public.legal_receivables r ON r.id = i.receivable_id
  WHERE i.id = NEW.installment_id;

  _sufixo := COALESCE(' — ' || NULLIF(btrim(_label), ''), '');

  _firm_share := COALESCE(NEW.fee_amount, 0)
               + COALESCE(NEW.success_fee_amount, 0)
               + COALESCE(NEW.cost_reimbursement, 0);
  _client_share := COALESCE(NEW.client_amount_received_by_firm, 0);

  IF _firm_share > 0.01 THEN
    INSERT INTO public.financial_transactions (
      organization_id, type, description, competence_date, paid_on, amount,
      status, bank_account_id, client_id, case_id, source_type, source_id, created_by
    ) VALUES (
      NEW.organization_id, 'entrada',
      'Recebimento de parcela - honorários do escritório' || _sufixo,
      NEW.received_on, NEW.received_on, _firm_share, 'pago',
      NEW.bank_account_id, _client_id, _case_id, 'receipt', NEW.id, NEW.created_by
    )
    ON CONFLICT (source_type, source_id) DO UPDATE
      SET type = EXCLUDED.type, description = EXCLUDED.description,
          amount = EXCLUDED.amount, paid_on = EXCLUDED.paid_on,
          bank_account_id = EXCLUDED.bank_account_id,
          client_id = EXCLUDED.client_id, case_id = EXCLUDED.case_id,
          updated_at = now();
  ELSE
    DELETE FROM public.financial_transactions
    WHERE source_type = 'receipt' AND source_id = NEW.id;
  END IF;

  IF _client_share > 0.01 THEN
    INSERT INTO public.financial_transactions (
      organization_id, type, description, competence_date, paid_on, amount,
      status, bank_account_id, client_id, case_id, source_type, source_id, created_by
    ) VALUES (
      NEW.organization_id, 'entrada_de_terceiros',
      'Recebimento de parcela - valor da cliente em conta do escritório' || _sufixo,
      NEW.received_on, NEW.received_on, _client_share, 'pago',
      NEW.bank_account_id, _client_id, _case_id, 'receipt_client', NEW.id, NEW.created_by
    )
    ON CONFLICT (source_type, source_id) DO UPDATE
      SET type = EXCLUDED.type, description = EXCLUDED.description,
          amount = EXCLUDED.amount, paid_on = EXCLUDED.paid_on,
          bank_account_id = EXCLUDED.bank_account_id,
          client_id = EXCLUDED.client_id, case_id = EXCLUDED.case_id,
          updated_at = now();
  ELSE
    DELETE FROM public.financial_transactions
    WHERE source_type = 'receipt_client' AND source_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 2) Os lançamentos que já existem ganham o cliente
--    Sem isto, só os recebimentos daqui para frente teriam nome, e o
--    histórico continuaria anônimo.
-- ============================================================
UPDATE public.financial_transactions t
SET client_id = r.client_id,
    case_id = COALESCE(t.case_id, r.case_id),
    updated_at = now()
FROM public.receipts rc
JOIN public.installments i ON i.id = rc.installment_id
JOIN public.legal_receivables r ON r.id = i.receivable_id
WHERE t.source_type IN ('receipt', 'receipt_client')
  AND t.source_id = rc.id
  AND t.client_id IS DISTINCT FROM r.client_id;
