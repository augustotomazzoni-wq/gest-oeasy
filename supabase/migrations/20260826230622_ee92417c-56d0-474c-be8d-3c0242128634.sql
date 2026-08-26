CREATE OR REPLACE FUNCTION public.delete_canceled_installment(_installment_id uuid)
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
  IF _org IS NULL OR NOT public.is_protected_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Somente o Administrador Principal pode apagar parcelas canceladas.';
  END IF;

  SELECT * INTO _inst FROM public.installments
  WHERE id = _installment_id AND organization_id = _org
  FOR UPDATE;

  IF _inst.id IS NULL THEN
    RAISE EXCEPTION 'Parcela não encontrada.';
  END IF;

  IF _inst.canceled_at IS NULL THEN
    RAISE EXCEPTION 'Só é possível apagar uma parcela que esteja cancelada.';
  END IF;

  SELECT COALESCE(sum(total_amount), 0) INTO _paid
  FROM public.receipts
  WHERE installment_id = _installment_id AND reversed_at IS NULL;

  IF _paid > 0.01 THEN
    RAISE EXCEPTION 'Esta parcela tem recebimento válido. Estorne o recebimento antes de apagar.';
  END IF;

  DELETE FROM public.client_transfers
  WHERE receipt_id IN (SELECT id FROM public.receipts WHERE installment_id = _installment_id)
    AND status <> 'pago';

  DELETE FROM public.receipts WHERE installment_id = _installment_id;
  DELETE FROM public.installments WHERE id = _installment_id;

  SELECT email INTO _user_email FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (
    organization_id, user_id, user_email, action, table_name, record_id, old_values
  ) VALUES (
    _org, auth.uid(), _user_email, 'apagar_parcela_cancelada', 'installments', _installment_id,
    jsonb_build_object(
      'receivable_id', _inst.receivable_id,
      'numero', _inst.number,
      'valor', _inst.gross_amount,
      'motivo_cancelamento', _inst.cancel_reason
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_canceled_receivable(_receivable_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _org uuid := public.current_org_id();
  _recv public.legal_receivables%ROWTYPE;
  _paid numeric;
  _user_email text;
BEGIN
  IF _org IS NULL OR NOT public.is_protected_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Somente o Administrador Principal pode apagar acordos cancelados.';
  END IF;

  SELECT * INTO _recv FROM public.legal_receivables
  WHERE id = _receivable_id AND organization_id = _org
  FOR UPDATE;

  IF _recv.id IS NULL THEN
    RAISE EXCEPTION 'Acordo não encontrado.';
  END IF;

  IF _recv.status <> 'cancelado' THEN
    RAISE EXCEPTION 'Só é possível apagar um acordo que esteja cancelado.';
  END IF;

  SELECT COALESCE(sum(rp.total_amount), 0) INTO _paid
  FROM public.receipts rp
  JOIN public.installments i ON i.id = rp.installment_id
  WHERE i.receivable_id = _receivable_id AND rp.reversed_at IS NULL;

  IF _paid > 0.01 THEN
    RAISE EXCEPTION 'Este acordo tem recebimentos válidos. Estorne os recebimentos antes de apagar.';
  END IF;

  DELETE FROM public.client_transfers
  WHERE (receivable_id = _receivable_id
     OR receipt_id IN (
       SELECT rp.id FROM public.receipts rp
       JOIN public.installments i ON i.id = rp.installment_id
       WHERE i.receivable_id = _receivable_id
     ))
    AND status <> 'pago';

  DELETE FROM public.receipts
  WHERE installment_id IN (SELECT id FROM public.installments WHERE receivable_id = _receivable_id);

  DELETE FROM public.installments WHERE receivable_id = _receivable_id;
  DELETE FROM public.legal_receivables WHERE id = _receivable_id;

  SELECT email INTO _user_email FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (
    organization_id, user_id, user_email, action, table_name, record_id, old_values
  ) VALUES (
    _org, auth.uid(), _user_email, 'apagar_acordo_cancelado', 'legal_receivables', _receivable_id,
    jsonb_build_object(
      'client_id', _recv.client_id,
      'case_id', _recv.case_id,
      'descricao', _recv.description,
      'valor_bruto', _recv.gross_amount,
      'motivo_cancelamento', _recv.cancel_reason
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_canceled_installment(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_canceled_receivable(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_canceled_installment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_canceled_receivable(uuid) TO authenticated;