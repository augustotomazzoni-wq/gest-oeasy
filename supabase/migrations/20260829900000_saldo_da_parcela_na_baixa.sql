-- O que fazer com o que faltou quando a cliente paga menos que a parcela.
--
-- O caso real: Maria devia 3 parcelas de R$ 1.000. Na segunda ela pagou só
-- R$ 700. Hoje a parcela fica "parcial" com R$ 300 em aberto na data que já
-- passou, e vira uma atrasada que ninguém vai cobrar — porque na prática o
-- combinado é outro: os R$ 300 vão junto com a última, que passa a ser
-- R$ 1.300.
--
-- Esta função move o saldo na hora da baixa. A parcela paga encolhe para o
-- valor que realmente entrou e fica quitada; o que faltou vai inteiro para
-- outra parcela ou para uma parcela nova, com data própria.
--
-- O acordo não muda: o dinheiro só trocou de parcela. A soma de todas elas
-- continua sendo o mesmo total a receber.

CREATE OR REPLACE FUNCTION public.move_installment_balance(
  _installment_id uuid,
  _destino text,
  _target_installment_id uuid DEFAULT NULL,
  _due_date date DEFAULT NULL,
  _label text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  _org uuid := public.current_org_id();
  _i public.installments%ROWTYPE;
  _alvo public.installments%ROWTYPE;
  _pago_total numeric;
  _pago_fee numeric;
  _pago_success numeric;
  _pago_client numeric;
  _pago_costs numeric;
  _pago_alvo numeric;
  _saldo numeric;
  _s_fee numeric;
  _s_success numeric;
  _s_client numeric;
  _s_costs numeric;
  _resto numeric;
  _maior numeric;
  _numero integer;
  _quantas integer;
  _destino_id uuid;
  _origem_nome text;
  _user_email text;
BEGIN
  -- Mesma permissão de registrar a baixa: quem dá baixa precisa conseguir
  -- terminar o que começou.
  IF _org IS NULL OR NOT public.can_write() THEN
    RAISE EXCEPTION 'Você não tem permissão para mexer nas parcelas.';
  END IF;

  IF _destino NOT IN ('parcela', 'nova') THEN
    RAISE EXCEPTION 'Destino inválido para o saldo da parcela.';
  END IF;

  SELECT * INTO _i FROM public.installments
  WHERE id = _installment_id AND organization_id = _org FOR UPDATE;

  IF _i.id IS NULL THEN
    RAISE EXCEPTION 'Parcela não encontrada.';
  END IF;

  IF _i.canceled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta parcela está cancelada.';
  END IF;

  SELECT COALESCE(sum(total_amount), 0), COALESCE(sum(fee_amount), 0),
         COALESCE(sum(success_fee_amount), 0), COALESCE(sum(client_amount), 0),
         COALESCE(sum(cost_reimbursement), 0)
    INTO _pago_total, _pago_fee, _pago_success, _pago_client, _pago_costs
  FROM public.receipts
  WHERE installment_id = _installment_id AND reversed_at IS NULL;

  IF _pago_total <= 0.01 THEN
    RAISE EXCEPTION 'Esta parcela ainda não recebeu nada. Para adiar o valor inteiro, mude a data de vencimento dela.';
  END IF;

  _saldo := round(_i.gross_amount - _pago_total, 2);

  IF _saldo <= 0.01 THEN
    RAISE EXCEPTION 'Esta parcela não tem saldo em aberto.';
  END IF;

  -- O saldo carrega a composição do que não foi pago, para o rateio entre
  -- honorários, sucumbência, valor da cliente e reembolso continuar fechando.
  _s_fee := greatest(round(_i.fee_amount - _pago_fee, 2), 0);
  _s_success := greatest(round(_i.success_fee_amount - _pago_success, 2), 0);
  _s_client := greatest(round(_i.client_amount - _pago_client, 2), 0);
  _s_costs := greatest(round(_i.cost_reimbursement - _pago_costs, 2), 0);

  -- Quando o rateio do recebimento foi alterado à mão, a diferença encosta na
  -- maior parte para a soma bater com o saldo.
  _resto := round(_saldo - (_s_fee + _s_success + _s_client + _s_costs), 2);
  IF _resto <> 0 THEN
    _maior := greatest(_s_fee, _s_success, _s_client, _s_costs);
    IF _s_client = _maior THEN
      _s_client := greatest(round(_s_client + _resto, 2), 0);
    ELSIF _s_fee = _maior THEN
      _s_fee := greatest(round(_s_fee + _resto, 2), 0);
    ELSIF _s_success = _maior THEN
      _s_success := greatest(round(_s_success + _resto, 2), 0);
    ELSE
      _s_costs := greatest(round(_s_costs + _resto, 2), 0);
    END IF;
  END IF;

  IF abs(_s_fee + _s_success + _s_client + _s_costs - _saldo) > 0.01 THEN
    RAISE EXCEPTION 'A composição desta parcela não fecha com o saldo de %. Ajuste a parcela antes de mover o saldo.', _saldo;
  END IF;

  _origem_nome := COALESCE(NULLIF(btrim(_i.label), ''), 'parcela ' || _i.number);

  IF _destino = 'parcela' THEN
    SELECT * INTO _alvo FROM public.installments
    WHERE id = _target_installment_id
      AND organization_id = _org
      AND receivable_id = _i.receivable_id
    FOR UPDATE;

    IF _alvo.id IS NULL THEN
      RAISE EXCEPTION 'Escolha uma parcela do mesmo acordo para receber o saldo.';
    END IF;

    IF _alvo.id = _i.id THEN
      RAISE EXCEPTION 'O saldo não pode ir para a própria parcela.';
    END IF;

    IF _alvo.canceled_at IS NOT NULL THEN
      RAISE EXCEPTION 'A parcela escolhida está cancelada.';
    END IF;

    SELECT COALESCE(sum(total_amount), 0) INTO _pago_alvo
    FROM public.receipts
    WHERE installment_id = _alvo.id AND reversed_at IS NULL;

    IF _alvo.gross_amount - _pago_alvo <= 0.01 THEN
      RAISE EXCEPTION 'A parcela escolhida já está quitada. Escolha outra ou cobre o saldo numa parcela nova.';
    END IF;

    UPDATE public.installments SET
      gross_amount = round(gross_amount + _saldo, 2),
      fee_amount = round(fee_amount + _s_fee, 2),
      success_fee_amount = round(success_fee_amount + _s_success, 2),
      client_amount = round(client_amount + _s_client, 2),
      cost_reimbursement = round(cost_reimbursement + _s_costs, 2),
      notes = COALESCE(notes || E'\n', '') ||
        'Recebeu o saldo de ' || replace(to_char(_saldo, 'FM999999990.00'), '.', ',') ||
        ' que faltou na ' || _origem_nome || '.',
      updated_at = now()
    WHERE id = _alvo.id;

    _destino_id := _alvo.id;
  ELSE
    IF _due_date IS NULL THEN
      RAISE EXCEPTION 'Informe a data de vencimento da parcela nova.';
    END IF;

    SELECT COALESCE(max(number), 0) + 1, count(*) + 1
      INTO _numero, _quantas
    FROM public.installments
    WHERE receivable_id = _i.receivable_id;

    INSERT INTO public.installments (
      organization_id, created_by, receivable_id, label, number, total_count,
      due_date, gross_amount, fee_amount, success_fee_amount, client_amount,
      cost_reimbursement, stream, notes
    ) VALUES (
      _org, auth.uid(), _i.receivable_id,
      COALESCE(NULLIF(btrim(_label), ''), 'Saldo da ' || _origem_nome),
      _numero, _quantas, _due_date, _saldo, _s_fee, _s_success, _s_client,
      _s_costs, _i.stream,
      'Saldo que faltou na ' || _origem_nome || '.'
    )
    RETURNING id INTO _destino_id;

    -- "Item 2 de 3" tem que continuar dizendo a verdade depois da parcela nova.
    UPDATE public.installments
    SET total_count = _quantas, updated_at = now()
    WHERE receivable_id = _i.receivable_id;
  END IF;

  -- A parcela paga encolhe para o que entrou de verdade e fica quitada.
  UPDATE public.installments SET
    gross_amount = _pago_total,
    fee_amount = round(_i.fee_amount - _s_fee, 2),
    success_fee_amount = round(_i.success_fee_amount - _s_success, 2),
    client_amount = round(_i.client_amount - _s_client, 2),
    cost_reimbursement = round(_i.cost_reimbursement - _s_costs, 2),
    notes = COALESCE(notes || E'\n', '') ||
      'Faltaram ' || replace(to_char(_saldo, 'FM999999990.00'), '.', ',') || ', cobrados em outra parcela.',
    updated_at = now()
  WHERE id = _i.id;

  SELECT email INTO _user_email FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (
    organization_id, user_id, user_email, action, table_name, record_id,
    old_values, new_values
  ) VALUES (
    _org, auth.uid(), _user_email, 'mover_saldo_da_parcela', 'installments',
    _i.id,
    jsonb_build_object('valor', _i.gross_amount, 'pago', _pago_total),
    jsonb_build_object(
      'saldo', _saldo,
      'destino', _destino,
      'parcela_destino', _destino_id,
      'vencimento', _due_date
    )
  );

  RETURN _destino_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.move_installment_balance(
  uuid, text, uuid, date, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_installment_balance(
  uuid, text, uuid, date, text
) TO authenticated;
