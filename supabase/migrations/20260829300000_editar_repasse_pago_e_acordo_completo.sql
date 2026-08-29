-- Editar repasse mesmo depois de pago, editar todos os campos do acordo, e
-- alinhar as datas previstas dos repasses já cadastrados.

-- ============================================================
-- 1) Repasse pago volta a ser editável.
--    A trava anterior existia por medo de o caixa ficar desencontrado — mas o
--    gatilho transfers_sync_tx reespelha o lançamento a cada UPDATE, então o
--    caixa acompanha a correção sozinho. Só repasse cancelado fica de fora.
--    A data do pagamento também passa a ser editável: é ela que vale no caixa.
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_transfer(
  _id uuid,
  _amount numeric DEFAULT NULL,
  _scheduled_for date DEFAULT NULL,
  _bank_account_id uuid DEFAULT NULL,
  _destination_info text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _status text DEFAULT NULL,
  _paid_on date DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  _org uuid := public.current_org_id();
  _old public.client_transfers%ROWTYPE;
  _novo_status public.transfer_status;
  _user_email text;
BEGIN
  IF _org IS NULL OR NOT public.can('repasses', 'edit') THEN
    RAISE EXCEPTION 'Você não tem permissão para editar repasses.';
  END IF;

  SELECT * INTO _old FROM public.client_transfers
  WHERE id = _id AND organization_id = _org FOR UPDATE;

  IF _old.id IS NULL THEN
    RAISE EXCEPTION 'Repasse não encontrado.';
  END IF;

  IF _old.status = 'cancelado' THEN
    RAISE EXCEPTION 'Este repasse está cancelado. Crie um novo em vez de editar.';
  END IF;

  IF _amount IS NOT NULL AND _amount <= 0 THEN
    RAISE EXCEPTION 'Informe um valor maior que zero.';
  END IF;

  _novo_status := COALESCE(_status::public.transfer_status, _old.status);

  IF _novo_status = 'pago' AND COALESCE(_paid_on, _old.paid_on) IS NULL THEN
    RAISE EXCEPTION 'Informe a data em que o repasse foi pago.';
  END IF;

  UPDATE public.client_transfers SET
    amount = COALESCE(_amount, amount),
    scheduled_for = COALESCE(_scheduled_for, scheduled_for),
    bank_account_id = _bank_account_id,
    destination_info = NULLIF(btrim(_destination_info), ''),
    notes = NULLIF(btrim(_notes), ''),
    status = _novo_status,
    -- Deixou de ser pago: a data do pagamento não faz mais sentido.
    paid_on = CASE WHEN _novo_status = 'pago' THEN COALESCE(_paid_on, paid_on) ELSE NULL END,
    updated_at = now()
  WHERE id = _id;

  SELECT email INTO _user_email FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (
    organization_id, user_id, user_email, action, table_name, record_id,
    old_values, new_values
  ) VALUES (
    _org, auth.uid(), _user_email, 'editar_repasse', 'client_transfers', _id,
    jsonb_build_object(
      'valor', _old.amount, 'previsto', _old.scheduled_for,
      'situacao', _old.status, 'pago_em', _old.paid_on
    ),
    jsonb_build_object(
      'valor', _amount, 'previsto', _scheduled_for,
      'situacao', _novo_status, 'pago_em', _paid_on
    )
  );
END;
$fn$;

-- ============================================================
-- 2) Editar o acordo inteiro: entram o percentual e o valor fixo de
--    honorários, que antes ficavam de fora da edição.
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_receivable(
  _id uuid,
  _type text,
  _status text,
  _description text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _case_id uuid DEFAULT NULL,
  _agreement_date date DEFAULT NULL,
  _flow text DEFAULT NULL,
  _is_estimated boolean DEFAULT NULL,
  _gross_amount numeric DEFAULT NULL,
  _success_fee_amount numeric DEFAULT NULL,
  _cost_reimbursement numeric DEFAULT NULL,
  _expected_firm_amount numeric DEFAULT NULL,
  _expected_client_amount numeric DEFAULT NULL,
  _fee_percent numeric DEFAULT NULL,
  _fee_fixed_amount numeric DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  _org uuid := public.current_org_id();
  _old public.legal_receivables%ROWTYPE;
  _pago_firm numeric;
  _pago_client numeric;
  _user_email text;
BEGIN
  IF _org IS NULL OR NOT public.can('acordos', 'edit') THEN
    RAISE EXCEPTION 'Você não tem permissão para editar acordos.';
  END IF;

  SELECT * INTO _old FROM public.legal_receivables
  WHERE id = _id AND organization_id = _org FOR UPDATE;

  IF _old.id IS NULL THEN
    RAISE EXCEPTION 'Acordo não encontrado.';
  END IF;

  IF _old.status = 'cancelado' THEN
    RAISE EXCEPTION 'Este acordo está cancelado. Cadastre um novo em vez de editar.';
  END IF;

  SELECT COALESCE(sum(rp.fee_amount + rp.success_fee_amount), 0),
         COALESCE(sum(rp.client_amount), 0)
    INTO _pago_firm, _pago_client
  FROM public.receipts rp
  JOIN public.installments i ON i.id = rp.installment_id
  WHERE i.receivable_id = _id AND rp.reversed_at IS NULL;

  IF _expected_firm_amount IS NOT NULL AND _expected_firm_amount < _pago_firm - 0.01 THEN
    RAISE EXCEPTION 'O escritório já recebeu % neste acordo. O valor esperado não pode ficar abaixo disso.', _pago_firm;
  END IF;

  IF _expected_client_amount IS NOT NULL AND _expected_client_amount < _pago_client - 0.01 THEN
    RAISE EXCEPTION 'A cliente já recebeu % neste acordo. O valor esperado não pode ficar abaixo disso.', _pago_client;
  END IF;

  UPDATE public.legal_receivables SET
    type = _type::public.receivable_type,
    status = _status::public.receivable_status,
    description = NULLIF(btrim(_description), ''),
    notes = NULLIF(btrim(_notes), ''),
    case_id = _case_id,
    agreement_date = COALESCE(_agreement_date, agreement_date),
    flow = COALESCE(_flow::public.flow_type, flow),
    is_estimated = COALESCE(_is_estimated, is_estimated),
    gross_amount = COALESCE(_gross_amount, gross_amount),
    fee_percent = _fee_percent,
    fee_fixed_amount = _fee_fixed_amount,
    success_fee_amount = COALESCE(_success_fee_amount, success_fee_amount),
    cost_reimbursement = COALESCE(_cost_reimbursement, cost_reimbursement),
    expected_firm_amount = COALESCE(_expected_firm_amount, expected_firm_amount),
    expected_client_amount = COALESCE(_expected_client_amount, expected_client_amount),
    updated_at = now()
  WHERE id = _id;

  SELECT email INTO _user_email FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (
    organization_id, user_id, user_email, action, table_name, record_id,
    old_values, new_values
  ) VALUES (
    _org, auth.uid(), _user_email, 'editar_acordo', 'legal_receivables', _id,
    jsonb_build_object(
      'tipo', _old.type, 'situacao', _old.status, 'descricao', _old.description,
      'bruto', _old.gross_amount, 'escritorio', _old.expected_firm_amount,
      'cliente', _old.expected_client_amount
    ),
    jsonb_build_object(
      'tipo', _type, 'situacao', _status, 'descricao', _description,
      'bruto', _gross_amount, 'escritorio', _expected_firm_amount,
      'cliente', _expected_client_amount
    )
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.update_transfer(
  uuid, numeric, date, uuid, text, text, text, date
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_transfer(
  uuid, numeric, date, uuid, text, text, text, date
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_receivable(
  uuid, text, text, text, text, uuid, date, text, boolean,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_receivable(
  uuid, text, text, text, text, uuid, date, text, boolean,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric
) TO authenticated;

-- A versão antiga de update_transfer (7 argumentos) some, senão o PostgREST
-- fica com duas candidatas e não sabe qual chamar.
DROP FUNCTION IF EXISTS public.update_transfer(uuid, numeric, date, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.update_receivable(
  uuid, text, text, text, text, uuid, date, text, boolean,
  numeric, numeric, numeric, numeric, numeric
);
