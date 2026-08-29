-- Editar acordo, parcela e repasse.
--
-- Até aqui só dava para cancelar. Corrigir um valor digitado errado obrigava a
-- cancelar tudo e cadastrar de novo, o que suja o histórico e faz perder o
-- vínculo com o processo.
--
-- As travas partem de um princípio: o que já foi recebido ou pago é passado, e
-- passado não se reescreve. Edita-se o que ainda vai acontecer.

-- ============================================================
-- 1) Permissões "Editar" em Acordos e Repasses.
--    Nascem ligadas só para o Administrador Principal. Os demais perfis
--    aparecem desmarcados na matriz e podem ser liberados quando o
--    escritório quiser, na tela Usuários e Perfis de Acesso.
-- ============================================================
INSERT INTO public.role_permissions (organization_id, role_code, module, action, allowed)
SELECT o.id, r.role_code, m.module, 'edit', r.allowed
FROM public.organizations o
CROSS JOIN (VALUES
  ('admin', true),
  ('socio_gestor', false),
  ('financeiro', false),
  ('lancador', false),
  ('cobranca', false),
  ('advogado', false),
  ('consulta', false)
) AS r(role_code, allowed)
CROSS JOIN (VALUES ('acordos'), ('repasses')) AS m(module)
ON CONFLICT (organization_id, role_code, module, action) DO NOTHING;

-- Se a permissão já existia ligada para alguém (ela não fazia nada antes,
-- porque não havia botão de editar), começa fechada como as outras.
UPDATE public.role_permissions
SET allowed = false, updated_at = now()
WHERE module IN ('acordos', 'repasses')
  AND action = 'edit'
  AND role_code <> 'admin'
  AND allowed;

-- ============================================================
-- 2) Editar o acordo.
--    Os campos descritivos são sempre livres. Os valores não podem cair
--    abaixo do que já foi recebido — senão o acordo passaria a dever menos
--    do que a cliente já pagou, e o saldo viraria negativo.
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
  _expected_client_amount numeric DEFAULT NULL
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

  -- O que já entrou por este acordo, sem contar recebimento estornado.
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

-- ============================================================
-- 3) Editar uma parcela.
--    Parcela que já recebeu alguma coisa não pode valer menos do que o que
--    entrou nela. Parcela cancelada não se edita.
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_installment(
  _id uuid,
  _label text DEFAULT NULL,
  _due_date date DEFAULT NULL,
  _gross_amount numeric DEFAULT NULL,
  _fee_amount numeric DEFAULT NULL,
  _success_fee_amount numeric DEFAULT NULL,
  _client_amount numeric DEFAULT NULL,
  _cost_reimbursement numeric DEFAULT NULL,
  _stream text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  _org uuid := public.current_org_id();
  _old public.installments%ROWTYPE;
  _pago numeric;
  _novo_bruto numeric;
  _partes numeric;
  _user_email text;
BEGIN
  IF _org IS NULL OR NOT public.can('acordos', 'edit') THEN
    RAISE EXCEPTION 'Você não tem permissão para editar parcelas.';
  END IF;

  SELECT * INTO _old FROM public.installments
  WHERE id = _id AND organization_id = _org FOR UPDATE;

  IF _old.id IS NULL THEN
    RAISE EXCEPTION 'Parcela não encontrada.';
  END IF;

  IF _old.canceled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta parcela está cancelada.';
  END IF;

  SELECT COALESCE(sum(total_amount), 0) INTO _pago
  FROM public.receipts WHERE installment_id = _id AND reversed_at IS NULL;

  _novo_bruto := COALESCE(_gross_amount, _old.gross_amount);

  IF _novo_bruto < _pago - 0.01 THEN
    RAISE EXCEPTION 'Esta parcela já recebeu %. O valor não pode ficar abaixo disso — estorne o recebimento antes.', _pago;
  END IF;

  -- A soma das partes tem que fechar com o valor da parcela, senão o rateio
  -- do recebimento fica impossível de bater.
  _partes := COALESCE(_fee_amount, _old.fee_amount)
           + COALESCE(_success_fee_amount, _old.success_fee_amount)
           + COALESCE(_client_amount, _old.client_amount)
           + COALESCE(_cost_reimbursement, _old.cost_reimbursement);

  IF abs(_partes - _novo_bruto) > 0.01 THEN
    RAISE EXCEPTION 'A divisão da parcela (%) não fecha com o valor dela (%).', _partes, _novo_bruto;
  END IF;

  UPDATE public.installments SET
    label = COALESCE(NULLIF(btrim(_label), ''), label),
    due_date = COALESCE(_due_date, due_date),
    gross_amount = _novo_bruto,
    fee_amount = COALESCE(_fee_amount, fee_amount),
    success_fee_amount = COALESCE(_success_fee_amount, success_fee_amount),
    client_amount = COALESCE(_client_amount, client_amount),
    cost_reimbursement = COALESCE(_cost_reimbursement, cost_reimbursement),
    stream = COALESCE(NULLIF(_stream, ''), stream),
    updated_at = now()
  WHERE id = _id;

  SELECT email INTO _user_email FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (
    organization_id, user_id, user_email, action, table_name, record_id,
    old_values, new_values
  ) VALUES (
    _org, auth.uid(), _user_email, 'editar_parcela', 'installments', _id,
    jsonb_build_object(
      'rotulo', _old.label, 'vencimento', _old.due_date, 'valor', _old.gross_amount
    ),
    jsonb_build_object('rotulo', _label, 'vencimento', _due_date, 'valor', _novo_bruto)
  );
END;
$fn$;

-- ============================================================
-- 4) Editar um repasse.
--    Repasse já pago é histórico e mexe no caixa: para corrigir, cancela-se
--    e cria-se outro. Enquanto está pendente ou agendado, edita à vontade.
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_transfer(
  _id uuid,
  _amount numeric DEFAULT NULL,
  _scheduled_for date DEFAULT NULL,
  _bank_account_id uuid DEFAULT NULL,
  _destination_info text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _status text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  _org uuid := public.current_org_id();
  _old public.client_transfers%ROWTYPE;
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

  IF _old.status = 'pago' THEN
    RAISE EXCEPTION 'Este repasse já foi pago e entrou no caixa. Para corrigir, cancele e crie outro.';
  END IF;

  IF _old.status = 'cancelado' THEN
    RAISE EXCEPTION 'Este repasse está cancelado.';
  END IF;

  IF _amount IS NOT NULL AND _amount <= 0 THEN
    RAISE EXCEPTION 'Informe um valor maior que zero.';
  END IF;

  UPDATE public.client_transfers SET
    amount = COALESCE(_amount, amount),
    scheduled_for = COALESCE(_scheduled_for, scheduled_for),
    bank_account_id = _bank_account_id,
    destination_info = NULLIF(btrim(_destination_info), ''),
    notes = NULLIF(btrim(_notes), ''),
    status = COALESCE(_status::public.transfer_status, status),
    updated_at = now()
  WHERE id = _id;

  SELECT email INTO _user_email FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (
    organization_id, user_id, user_email, action, table_name, record_id,
    old_values, new_values
  ) VALUES (
    _org, auth.uid(), _user_email, 'editar_repasse', 'client_transfers', _id,
    jsonb_build_object(
      'valor', _old.amount, 'previsto', _old.scheduled_for, 'situacao', _old.status
    ),
    jsonb_build_object('valor', _amount, 'previsto', _scheduled_for, 'situacao', _status)
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.update_receivable(
  uuid, text, text, text, text, uuid, date, text, boolean, numeric, numeric, numeric, numeric, numeric
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_receivable(
  uuid, text, text, text, text, uuid, date, text, boolean, numeric, numeric, numeric, numeric, numeric
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_installment(
  uuid, text, date, numeric, numeric, numeric, numeric, numeric, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_installment(
  uuid, text, date, numeric, numeric, numeric, numeric, numeric, text
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_transfer(
  uuid, numeric, date, uuid, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_transfer(
  uuid, numeric, date, uuid, text, text, text
) TO authenticated;
