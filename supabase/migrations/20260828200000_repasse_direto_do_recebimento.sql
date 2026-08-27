-- "Pagar cliente" direto do recebimento.
--
-- Hoje, depois de dar baixa numa parcela, quem quer repassar o dinheiro da
-- cliente precisa ir até a tela de Repasses e digitar tudo de novo — cliente,
-- valor, destino. Isso é retrabalho e é onde nasce erro de digitação.
-- Esta função cria o repasse a partir do próprio recebimento, com o valor
-- exato que passou pela conta do escritório.

CREATE OR REPLACE FUNCTION public.create_transfer_from_receipt(
  _receipt_id uuid,
  _scheduled_for date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  _org uuid := public.current_org_id();
  _rc public.receipts%ROWTYPE;
  _client_id uuid;
  _case_id uuid;
  _receivable_id uuid;
  _destino text;
  _existente uuid;
  _id uuid;
  _user_email text;
BEGIN
  IF _org IS NULL OR NOT public.can_write() THEN
    RAISE EXCEPTION 'Você não tem permissão para criar repasses.';
  END IF;

  SELECT * INTO _rc FROM public.receipts
  WHERE id = _receipt_id AND organization_id = _org;

  IF _rc.id IS NULL THEN
    RAISE EXCEPTION 'Recebimento não encontrado.';
  END IF;

  IF _rc.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Este recebimento foi estornado. Não há o que repassar.';
  END IF;

  -- Só gera repasse o dinheiro da cliente que passou pela conta do
  -- escritório. O que ela recebeu direto do banco nunca entrou aqui.
  IF COALESCE(_rc.client_amount_received_by_firm, 0) <= 0.01 THEN
    RAISE EXCEPTION 'Neste recebimento não há valor da cliente em conta do escritório para repassar.';
  END IF;

  -- Um repasse por recebimento: evita pagar a mesma cliente duas vezes por
  -- clicar duas vezes no botão.
  SELECT id INTO _existente FROM public.client_transfers
  WHERE receipt_id = _receipt_id AND status <> 'cancelado'
  LIMIT 1;

  IF _existente IS NOT NULL THEN
    RAISE EXCEPTION 'Este recebimento já tem repasse criado. Veja em Repasses a Clientes.';
  END IF;

  SELECT r.client_id, r.case_id, r.id
    INTO _client_id, _case_id, _receivable_id
  FROM public.installments i
  JOIN public.legal_receivables r ON r.id = i.receivable_id
  WHERE i.id = _rc.installment_id;

  IF _client_id IS NULL THEN
    RAISE EXCEPTION 'Não consegui identificar a cliente deste recebimento.';
  END IF;

  -- Traz PIX ou conta da cliente já preenchidos, para quem for pagar não
  -- precisar procurar o dado em outra tela.
  SELECT CASE
           WHEN NULLIF(btrim(pa.pix_key), '') IS NOT NULL
             THEN 'PIX ' || coalesce(pa.pix_key_type, '') || ': ' || pa.pix_key
           WHEN NULLIF(btrim(pa.account), '') IS NOT NULL
             THEN coalesce(pa.bank, 'Banco') || ' ag. ' || coalesce(pa.branch, '-')
                  || ' c/c ' || pa.account
           ELSE NULL
         END
    INTO _destino
  FROM public.client_payment_accounts pa
  WHERE pa.client_id = _client_id
  ORDER BY pa.created_at
  LIMIT 1;

  INSERT INTO public.client_transfers (
    organization_id, created_by, client_id, case_id, receivable_id, receipt_id,
    amount, scheduled_for, status, bank_account_id, destination_info, notes
  ) VALUES (
    _org, auth.uid(), _client_id, _case_id, _receivable_id, _receipt_id,
    _rc.client_amount_received_by_firm,
    coalesce(_scheduled_for, current_date),
    'pendente',
    _rc.bank_account_id,
    _destino,
    'Gerado a partir do recebimento de ' || to_char(_rc.received_on, 'DD/MM/YYYY')
  )
  RETURNING id INTO _id;

  SELECT email INTO _user_email FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (
    organization_id, user_id, user_email, action, table_name, record_id, new_values
  ) VALUES (
    _org, auth.uid(), _user_email, 'repasse_do_recebimento', 'client_transfers', _id,
    jsonb_build_object(
      'recebimento', _receipt_id,
      'cliente', _client_id,
      'valor', _rc.client_amount_received_by_firm
    )
  );

  RETURN _id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.create_transfer_from_receipt(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_transfer_from_receipt(uuid, date) TO authenticated;
