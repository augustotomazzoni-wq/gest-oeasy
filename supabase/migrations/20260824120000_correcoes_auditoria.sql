-- Correções da auditoria de 24/08/2026: segurança (RLS), integridade financeira
-- (constraints, atomicidade e trava de sobrepagamento) e permissões dos papéis
-- "Lançador Financeiro" e "Cobrança e Recebíveis".

-- ============================================================
-- SEG-1 / SEG-2 / FIN-4 — leitura de dados sensíveis e escrita
-- restrita ao papel certo, e não a "qualquer autenticado".
-- ============================================================

-- Chave PIX/conta de destino do cliente (client_transfers.destination_info)
-- só pode ser lida por quem opera o financeiro.
DROP POLICY IF EXISTS tr_select ON public.client_transfers;
CREATE POLICY tr_select ON public.client_transfers FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id() AND public.can_write());

-- Dados bancários do próprio escritório: visíveis para quem opera o financeiro
-- e para o Lançador Financeiro, que precisa escolher a conta ao lançar caixa.
DROP POLICY IF EXISTS bank_select ON public.bank_accounts;
CREATE POLICY bank_select ON public.bank_accounts FOR SELECT TO authenticated
  USING (
    organization_id = public.current_org_id()
    AND (public.can_write() OR public.has_role(auth.uid(), 'lancador'))
  );

-- O Lançador Financeiro cadastra receitas/despesas no caixa (permissão já
-- prevista na matriz de perfis, mas nunca aplicada na política de escrita).
DROP POLICY IF EXISTS tx_write ON public.financial_transactions;
CREATE POLICY tx_write ON public.financial_transactions FOR ALL TO authenticated
  USING (
    organization_id = public.current_org_id()
    AND (public.can_write() OR public.has_role(auth.uid(), 'lancador'))
  )
  WITH CHECK (
    organization_id = public.current_org_id()
    AND (public.can_write() OR public.has_role(auth.uid(), 'lancador'))
  );

-- Cobrança e Recebíveis confirma somente recebimentos que a cliente recebeu
-- diretamente (dinheiro que nunca passa pelo caixa do escritório) — nunca
-- pode lançar honorários/sucumbência/valores na conta do escritório.
DROP POLICY IF EXISTS rcpt_write ON public.receipts;
CREATE POLICY rcpt_write ON public.receipts FOR ALL TO authenticated
  USING (
    organization_id = public.current_org_id()
    AND (
      public.can_write()
      OR (public.has_role(auth.uid(), 'cobranca') AND receipt_destination = 'cliente_direto')
    )
  )
  WITH CHECK (
    organization_id = public.current_org_id()
    AND (
      public.can_write()
      OR (public.has_role(auth.uid(), 'cobranca') AND receipt_destination = 'cliente_direto')
    )
  );

-- ============================================================
-- SEG-3 — Sócio Gestor (e demais perfis com a permissão granular
-- "manage_users") conseguem de fato alterar o perfil de um usuário.
-- A trigger protect_main_admin_roles continua protegendo o papel
-- de Administrador Principal.
-- ============================================================
GRANT INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;

DROP POLICY IF EXISTS roles_write ON public.user_roles;
CREATE POLICY roles_write ON public.user_roles FOR ALL TO authenticated
  USING (public.can('global', 'manage_users'))
  WITH CHECK (public.can('global', 'manage_users'));

-- ============================================================
-- FIN-1 — trava de valores negativos direto no banco, não só na tela.
-- As constraints entram como NOT VALID: passam a valer para todo
-- lançamento novo imediatamente, sem que a migration falhe caso já
-- exista alguma linha antiga fora do padrão. Depois de confirmar que
-- os dados atuais estão corretos, valide com, por exemplo:
--   ALTER TABLE public.legal_receivables VALIDATE CONSTRAINT legal_receivables_nonnegative_check;
-- ============================================================
ALTER TABLE public.legal_receivables
  ADD CONSTRAINT legal_receivables_nonnegative_check CHECK (
    gross_amount >= 0
    AND COALESCE(fee_fixed_amount, 0) >= 0
    AND success_fee_amount >= 0
    AND cost_reimbursement >= 0
    AND expected_firm_amount >= 0
    AND expected_client_amount >= 0
  ) NOT VALID,
  ADD CONSTRAINT legal_receivables_fee_percent_check CHECK (
    fee_percent IS NULL OR (fee_percent >= 0 AND fee_percent <= 100)
  ) NOT VALID;

ALTER TABLE public.installments
  ADD CONSTRAINT installments_nonnegative_check CHECK (
    gross_amount >= 0
    AND fee_amount >= 0
    AND success_fee_amount >= 0
    AND client_amount >= 0
    AND cost_reimbursement >= 0
  ) NOT VALID;

ALTER TABLE public.receipts
  ADD CONSTRAINT receipts_components_nonnegative_check CHECK (
    total_amount >= 0
    AND fee_amount >= 0
    AND success_fee_amount >= 0
    AND client_amount >= 0
    AND cost_reimbursement >= 0
  ) NOT VALID;

-- ============================================================
-- FIN-3 — trava contra recebimento em duplicidade/concorrente que
-- ultrapasse o valor devido da parcela. O SELECT ... FOR UPDATE
-- trava a linha da parcela, então dois lançamentos simultâneos são
-- serializados e o segundo enxerga a soma já atualizada.
-- ============================================================
CREATE OR REPLACE FUNCTION public.prevent_installment_overpay()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _gross numeric;
  _already_paid numeric;
BEGIN
  SELECT gross_amount INTO _gross
  FROM public.installments
  WHERE id = NEW.installment_id
  FOR UPDATE;

  IF _gross IS NULL THEN
    RAISE EXCEPTION 'Parcela não encontrada.';
  END IF;

  SELECT COALESCE(sum(total_amount), 0) INTO _already_paid
  FROM public.receipts
  WHERE installment_id = NEW.installment_id AND id <> NEW.id;

  IF _already_paid + NEW.total_amount - _gross > 0.01 THEN
    RAISE EXCEPTION 'Este recebimento ultrapassa o saldo da parcela.';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.prevent_installment_overpay() FROM PUBLIC;

DROP TRIGGER IF EXISTS receipts_prevent_overpay ON public.receipts;
CREATE TRIGGER receipts_prevent_overpay
  BEFORE INSERT OR UPDATE ON public.receipts
  FOR EACH ROW EXECUTE FUNCTION public.prevent_installment_overpay();

-- ============================================================
-- FIN-2 — criação de acordo + cronograma de parcelas em uma única
-- transação (mesmo padrão já usado em create_client_with_payment_account),
-- evitando um acordo "fantasma" sem parcelas se a segunda etapa falhar.
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
AS $$
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
        success_fee_amount, client_amount, cost_reimbursement
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
        COALESCE((_item->>'cost_reimbursement')::numeric, 0)
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
$$;

REVOKE EXECUTE ON FUNCTION public.create_agreement_with_schedule(
  uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, date, text, boolean, text, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_agreement_with_schedule(
  uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, date, text, boolean, text, jsonb
) TO authenticated;

-- ============================================================
-- FIN-5 — registra em audit_logs a criação de cliente com dados de
-- pagamento, igual às demais mutações financeiras.
-- ============================================================
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
  _user_email text;
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

  SELECT email INTO _user_email FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (
    organization_id, user_id, user_email, action, table_name, record_id
  ) VALUES (
    _organization_id, auth.uid(), _user_email, 'criar_cliente', 'clients', _client_id
  );

  RETURN _client_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_client_with_payment_account(
  text, text, text, text, text, text, text, text, text, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_client_with_payment_account(
  text, text, text, text, text, text, text, text, text, text, text, text
) TO authenticated;
