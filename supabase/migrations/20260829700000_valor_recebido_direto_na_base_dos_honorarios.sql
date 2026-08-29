-- Valor que a cliente recebeu direto e que, mesmo assim, conta para os
-- honorários.
--
-- O caso real: na ação trabalhista o FGTS é liberado na conta vinculada e a
-- cliente saca sozinha. Esse dinheiro nunca passa pelo escritório — não é
-- receita, não entra no caixa e não vira repasse —, mas o contrato cobra os
-- 30% sobre ele do mesmo jeito.
--
-- Até agora a única saída era somar o FGTS no valor bruto, e aí ele
-- contaminava tudo: virava dinheiro a distribuir, entrava no cronograma e o
-- sistema passava a cobrar uma parcela e a esperar um repasse que nunca iam
-- existir.
--
-- Com o campo próprio, ele entra só na base do percentual. O valor bruto
-- continua sendo apenas o que transita, e é dele que saem cronograma, caixa e
-- repasse.

-- ============================================================
-- 1) A coluna
-- ============================================================
ALTER TABLE public.legal_receivables
  ADD COLUMN IF NOT EXISTS fee_base_extra_amount numeric(14,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.legal_receivables.fee_base_extra_amount IS
  'Valor que a cliente recebeu direto (FGTS, alvará) e que compõe a base dos honorários contratuais. Não transita pelo escritório: fica fora do valor bruto, do cronograma, do caixa e do repasse.';

ALTER TABLE public.legal_receivables
  DROP CONSTRAINT IF EXISTS legal_receivables_fee_base_extra_check;

ALTER TABLE public.legal_receivables
  ADD CONSTRAINT legal_receivables_fee_base_extra_check
  CHECK (fee_base_extra_amount >= 0) NOT VALID;

-- ============================================================
-- 2) Cadastro do acordo: mesma função de antes, com o campo novo.
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_agreement_with_schedule(
  _client_id uuid,
  _case_id uuid DEFAULT NULL,
  _type text DEFAULT 'acordo',
  _status text DEFAULT 'confirmado',
  _description text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _gross_amount numeric DEFAULT 0,
  _fee_percent numeric DEFAULT NULL,
  _fee_fixed_amount numeric DEFAULT NULL,
  _fee_base_extra_amount numeric DEFAULT 0,
  _success_fee_amount numeric DEFAULT 0,
  _cost_reimbursement numeric DEFAULT 0,
  _expected_firm_amount numeric DEFAULT 0,
  _expected_client_amount numeric DEFAULT 0,
  _agreement_date date DEFAULT NULL,
  _flow text DEFAULT 'escritorio_recebe_total',
  _is_estimated boolean DEFAULT false,
  _manual_override_reason text DEFAULT NULL,
  _installments jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  _organization_id uuid := public.current_org_id();
  _receivable_id uuid;
  _item jsonb;
  _user_email text;
BEGIN
  IF _organization_id IS NULL OR NOT public.can_write() THEN
    RAISE EXCEPTION 'Usuário sem permissão para cadastrar acordos.';
  END IF;

  IF _client_id IS NULL THEN
    RAISE EXCEPTION 'Selecione o cliente.';
  END IF;

  IF COALESCE(_fee_base_extra_amount, 0) < 0 THEN
    RAISE EXCEPTION 'O valor recebido direto pela cliente não pode ser negativo.';
  END IF;

  INSERT INTO public.legal_receivables (
    organization_id, created_by, client_id, case_id, type, status,
    description, notes, gross_amount, fee_percent, fee_fixed_amount,
    fee_base_extra_amount, success_fee_amount, cost_reimbursement,
    expected_firm_amount, expected_client_amount, agreement_date, flow,
    is_estimated, manual_override_reason
  ) VALUES (
    _organization_id, auth.uid(), _client_id, _case_id,
    _type::public.receivable_type, _status::public.receivable_status,
    NULLIF(btrim(_description), ''), NULLIF(btrim(_notes), ''),
    _gross_amount, _fee_percent, _fee_fixed_amount,
    COALESCE(_fee_base_extra_amount, 0), _success_fee_amount,
    _cost_reimbursement, _expected_firm_amount, _expected_client_amount,
    _agreement_date, _flow::public.flow_type, _is_estimated,
    NULLIF(btrim(_manual_override_reason), '')
  )
  RETURNING id INTO _receivable_id;

  IF _installments IS NOT NULL AND jsonb_array_length(_installments) > 0 THEN
    FOR _item IN SELECT * FROM jsonb_array_elements(_installments) LOOP
      INSERT INTO public.installments (
        organization_id, created_by, receivable_id, label, number,
        total_count, due_date, gross_amount, fee_amount,
        success_fee_amount, client_amount, cost_reimbursement, stream
      ) VALUES (
        _organization_id, auth.uid(), _receivable_id,
        _item->>'label',
        COALESCE((_item->>'number')::integer, 1),
        COALESCE((_item->>'total_count')::integer, 1),
        NULLIF(_item->>'due_date', '')::date,
        COALESCE((_item->>'gross_amount')::numeric, 0),
        COALESCE((_item->>'fee_amount')::numeric, 0),
        COALESCE((_item->>'success_fee_amount')::numeric, 0),
        COALESCE((_item->>'client_amount')::numeric, 0),
        COALESCE((_item->>'cost_reimbursement')::numeric, 0),
        CASE WHEN _item->>'stream' = 'sucumbencia' THEN 'sucumbencia' ELSE 'principal' END
      );
    END LOOP;
  END IF;

  SELECT email INTO _user_email FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (
    organization_id, user_id, user_email, action, table_name, record_id, new_values
  ) VALUES (
    _organization_id, auth.uid(), _user_email, 'criar_recebivel',
    'legal_receivables', _receivable_id,
    jsonb_build_object(
      'firm', _expected_firm_amount,
      'client', _expected_client_amount,
      'gross', _gross_amount,
      'recebido_direto', COALESCE(_fee_base_extra_amount, 0),
      'parcelas', COALESCE(jsonb_array_length(_installments), 0)
    )
  );

  RETURN _receivable_id;
END;
$fn$;

-- ============================================================
-- 3) Edição do acordo
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
  _fee_fixed_amount numeric DEFAULT NULL,
  _fee_base_extra_amount numeric DEFAULT NULL
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

  IF _fee_base_extra_amount IS NOT NULL AND _fee_base_extra_amount < 0 THEN
    RAISE EXCEPTION 'O valor recebido direto pela cliente não pode ser negativo.';
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
    fee_base_extra_amount = COALESCE(_fee_base_extra_amount, fee_base_extra_amount),
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
      'cliente', _old.expected_client_amount,
      'recebido_direto', _old.fee_base_extra_amount
    ),
    jsonb_build_object(
      'tipo', _type, 'situacao', _status, 'descricao', _description,
      'bruto', _gross_amount, 'escritorio', _expected_firm_amount,
      'cliente', _expected_client_amount,
      'recebido_direto', _fee_base_extra_amount
    )
  );
END;
$fn$;

-- ============================================================
-- 4) As assinaturas antigas somem: com duas candidatas, o PostgREST não sabe
--    qual chamar e o cadastro para de funcionar.
-- ============================================================
DROP FUNCTION IF EXISTS public.create_agreement_with_schedule(
  uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, date, text, boolean, text, jsonb
);

DROP FUNCTION IF EXISTS public.update_receivable(
  uuid, text, text, text, text, uuid, date, text, boolean,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric
);

REVOKE EXECUTE ON FUNCTION public.create_agreement_with_schedule(
  uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, date, text, boolean, text, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_agreement_with_schedule(
  uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, date, text, boolean, text, jsonb
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_receivable(
  uuid, text, text, text, text, uuid, date, text, boolean,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_receivable(
  uuid, text, text, text, text, uuid, date, text, boolean,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric
) TO authenticated;
