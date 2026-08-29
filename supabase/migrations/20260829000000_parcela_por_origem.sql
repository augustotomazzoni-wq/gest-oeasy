-- Separar, dentro do mesmo acordo, o dinheiro que vem pela cliente do que a
-- parte contrária paga direto ao escritório.
--
-- O caso real: a cliente recebe o acordo da empresa e repassa a parte do
-- escritório; ao mesmo tempo, a sucumbência é paga direto pela empresa ao
-- escritório — e nas datas dela, que não são as mesmas do acordo.
-- Antes só dava para modelar isso criando dois acordos separados, o que
-- desmontava a ligação entre eles e duplicava o processo na lista.

-- ============================================================
-- 1) De onde vem cada parcela.
--    'principal'   — valor do acordo (o que passa pela cliente)
--    'sucumbencia' — pago direto pela parte contrária ao escritório
-- ============================================================
ALTER TABLE public.installments
  ADD COLUMN IF NOT EXISTS stream text NOT NULL DEFAULT 'principal';

ALTER TABLE public.installments
  DROP CONSTRAINT IF EXISTS installments_stream_check;

ALTER TABLE public.installments
  ADD CONSTRAINT installments_stream_check
  CHECK (stream IN ('principal', 'sucumbencia')) NOT VALID;

-- Parcelas antigas que só têm sucumbência já nascem classificadas certo.
UPDATE public.installments
SET stream = 'sucumbencia'
WHERE stream = 'principal'
  AND success_fee_amount > 0.01
  AND fee_amount <= 0.01
  AND client_amount <= 0.01
  AND cost_reimbursement <= 0.01;

-- ============================================================
-- 2) O cadastro do acordo passa a gravar a origem de cada parcela.
--    Mesma função de antes, só com a coluna nova no INSERT.
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

  INSERT INTO public.legal_receivables (
    organization_id, created_by, client_id, case_id, type, status,
    description, notes, gross_amount, fee_percent, fee_fixed_amount,
    success_fee_amount, cost_reimbursement, expected_firm_amount,
    expected_client_amount, agreement_date, flow, is_estimated,
    manual_override_reason
  ) VALUES (
    _organization_id, auth.uid(), _client_id, _case_id,
    _type::public.receivable_type, _status::public.receivable_status,
    NULLIF(btrim(_description), ''), NULLIF(btrim(_notes), ''),
    _gross_amount, _fee_percent, _fee_fixed_amount, _success_fee_amount,
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
      'parcelas', COALESCE(jsonb_array_length(_installments), 0)
    )
  );

  RETURN _receivable_id;
END;
$fn$;
