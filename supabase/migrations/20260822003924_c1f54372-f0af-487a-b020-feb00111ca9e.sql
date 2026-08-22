-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('admin','financeiro','advogado','consulta');
CREATE TYPE public.receivable_type AS ENUM ('acordo','sentenca','execucao','honorarios','outro');
CREATE TYPE public.receivable_status AS ENUM ('rascunho','estimado','confirmado','em_pagamento','em_execucao','encerrado','cancelado');
CREATE TYPE public.flow_type AS ENUM ('escritorio_recebe_total','cliente_recebe_direto','recebimento_dividido','deposito_judicial');
CREATE TYPE public.transfer_status AS ENUM ('pendente','agendado','pago','cancelado');
CREATE TYPE public.tx_type AS ENUM ('entrada','saida','transferencia_entre_contas','entrada_de_terceiros','repasse_de_terceiros');
CREATE TYPE public.tx_status AS ENUM ('previsto','pago','cancelado');
CREATE TYPE public.category_type AS ENUM ('receita','despesa');

-- ============ ORGANIZATIONS ============
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  cnpj text,
  logo_url text,
  currency text NOT NULL DEFAULT 'BRL',
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  address text,
  brand_color text NOT NULL DEFAULT '#132F4C',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.organizations (id, name)
VALUES ('00000000-0000-0000-0000-000000000001','Hoffmann & Tomazzoni');

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  email text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  last_sign_in_at timestamptz,
  invited_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- ============ SECURITY FUNCTIONS ============
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid() AND active;
$$;

-- pode escrever dados financeiros
CREATE OR REPLACE FUNCTION public.can_write()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'financeiro');
$$;

CREATE OR REPLACE FUNCTION public.is_org_member(_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND active AND organization_id = _org);
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- bootstrap de usuários
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid := '00000000-0000-0000-0000-000000000001';
BEGIN
  INSERT INTO public.profiles (id, organization_id, full_name, email, confirmed_at)
  VALUES (NEW.id, _org, COALESCE(NEW.raw_user_meta_data->>'full_name',''), NEW.email, NEW.email_confirmed_at)
  ON CONFLICT (id) DO NOTHING;

  IF lower(NEW.email) = 'augusto.tomazzoni@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id,'admin') ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id,'consulta') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ CADASTROS ============
CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  tax_id text,
  phone text,
  email text,
  notes text,
  status text NOT NULL DEFAULT 'ativo',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  deleted_at timestamptz
);

CREATE TABLE public.client_payment_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  pix_key_type text,
  pix_key text,
  bank text,
  branch text,
  account text,
  holder_name text,
  holder_tax_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE TABLE public.cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  case_number text,
  opposing_party text,
  court text,
  practice_area text,
  action_type text,
  result_center text,
  responsible_lawyer text,
  status text NOT NULL DEFAULT 'ativo',
  notes text,
  external_link text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  deleted_at timestamptz
);
CREATE UNIQUE INDEX cases_org_number_uniq ON public.cases(organization_id, case_number) WHERE case_number IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE public.bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  bank text,
  branch text,
  account text,
  initial_balance numeric(14,2) NOT NULL DEFAULT 0,
  initial_balance_date date NOT NULL DEFAULT current_date,
  active boolean NOT NULL DEFAULT true,
  color text NOT NULL DEFAULT '#132F4C',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  type public.category_type NOT NULL,
  color text NOT NULL DEFAULT '#64748B',
  active boolean NOT NULL DEFAULT true,
  parent_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.categories (organization_id, name, type) VALUES
 ('00000000-0000-0000-0000-000000000001','Honorários contratuais','receita'),
 ('00000000-0000-0000-0000-000000000001','Sucumbência','receita'),
 ('00000000-0000-0000-0000-000000000001','Consultoria','receita'),
 ('00000000-0000-0000-0000-000000000001','Reembolso de custas','receita'),
 ('00000000-0000-0000-0000-000000000001','Perícia','despesa'),
 ('00000000-0000-0000-0000-000000000001','Custas processuais','despesa'),
 ('00000000-0000-0000-0000-000000000001','Correspondentes','despesa'),
 ('00000000-0000-0000-0000-000000000001','Salários','despesa'),
 ('00000000-0000-0000-0000-000000000001','Aluguel','despesa'),
 ('00000000-0000-0000-0000-000000000001','Softwares','despesa'),
 ('00000000-0000-0000-0000-000000000001','Impostos','despesa'),
 ('00000000-0000-0000-0000-000000000001','Marketing','despesa'),
 ('00000000-0000-0000-0000-000000000001','Materiais','despesa'),
 ('00000000-0000-0000-0000-000000000001','Retiradas de sócios','despesa');

-- ============ RECEBÍVEIS ============
CREATE TABLE public.legal_receivables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  case_id uuid REFERENCES public.cases(id) ON DELETE SET NULL,
  type public.receivable_type NOT NULL DEFAULT 'acordo',
  status public.receivable_status NOT NULL DEFAULT 'confirmado',
  description text,
  notes text,
  gross_amount numeric(14,2) NOT NULL DEFAULT 0,
  fee_percent numeric(7,4),
  fee_fixed_amount numeric(14,2),
  success_fee_amount numeric(14,2) NOT NULL DEFAULT 0,
  cost_reimbursement numeric(14,2) NOT NULL DEFAULT 0,
  expected_firm_amount numeric(14,2) NOT NULL DEFAULT 0,
  expected_client_amount numeric(14,2) NOT NULL DEFAULT 0,
  agreement_date date,
  flow public.flow_type NOT NULL DEFAULT 'escritorio_recebe_total',
  is_estimated boolean NOT NULL DEFAULT false,
  review_pending boolean NOT NULL DEFAULT false,
  manual_override_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  deleted_at timestamptz
);
CREATE INDEX ON public.legal_receivables (organization_id, client_id);
CREATE INDEX ON public.legal_receivables (organization_id, status);

CREATE TABLE public.installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  receivable_id uuid NOT NULL REFERENCES public.legal_receivables(id) ON DELETE CASCADE,
  label text,
  number integer NOT NULL DEFAULT 1,
  total_count integer NOT NULL DEFAULT 1,
  due_date date,
  gross_amount numeric(14,2) NOT NULL DEFAULT 0,
  fee_amount numeric(14,2) NOT NULL DEFAULT 0,
  success_fee_amount numeric(14,2) NOT NULL DEFAULT 0,
  client_amount numeric(14,2) NOT NULL DEFAULT 0,
  cost_reimbursement numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  canceled_at timestamptz,
  cancel_reason text,
  review_pending boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX ON public.installments (organization_id, due_date);
CREATE INDEX ON public.installments (receivable_id);

CREATE TABLE public.receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  installment_id uuid NOT NULL REFERENCES public.installments(id) ON DELETE CASCADE,
  received_on date NOT NULL DEFAULT current_date,
  total_amount numeric(14,2) NOT NULL,
  fee_amount numeric(14,2) NOT NULL DEFAULT 0,
  success_fee_amount numeric(14,2) NOT NULL DEFAULT 0,
  client_amount numeric(14,2) NOT NULL DEFAULT 0,
  cost_reimbursement numeric(14,2) NOT NULL DEFAULT 0,
  bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  payment_method text,
  reference text,
  notes text,
  reconciled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT receipts_allocation_check CHECK (
    abs(total_amount - (fee_amount + success_fee_amount + client_amount + cost_reimbursement)) <= 0.01
  )
);
CREATE INDEX ON public.receipts (organization_id, received_on);
CREATE INDEX ON public.receipts (installment_id);

CREATE TABLE public.client_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  case_id uuid REFERENCES public.cases(id) ON DELETE SET NULL,
  receivable_id uuid REFERENCES public.legal_receivables(id) ON DELETE SET NULL,
  receipt_id uuid REFERENCES public.receipts(id) ON DELETE SET NULL,
  amount numeric(14,2) NOT NULL,
  scheduled_for date,
  paid_on date,
  bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  destination_info text,
  status public.transfer_status NOT NULL DEFAULT 'pendente',
  receipt_file_url text,
  notes text,
  override_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX ON public.client_transfers (organization_id, client_id, status);

CREATE TABLE public.financial_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type public.tx_type NOT NULL,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  description text NOT NULL,
  competence_date date,
  due_date date,
  paid_on date,
  amount numeric(14,2) NOT NULL,
  status public.tx_status NOT NULL DEFAULT 'pago',
  bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  case_id uuid REFERENCES public.cases(id) ON DELETE SET NULL,
  source_type text,
  source_id uuid,
  attachment_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE UNIQUE INDEX financial_transactions_source_uniq ON public.financial_transactions(source_type, source_id) WHERE source_type IS NOT NULL;
CREATE INDEX ON public.financial_transactions (organization_id, paid_on);

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid,
  user_email text,
  action text NOT NULL,
  table_name text,
  record_id uuid,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.audit_logs (organization_id, created_at DESC);

-- ============ TRIGGERS updated_at ============
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['organizations','profiles','clients','client_payment_accounts','cases','bank_accounts','categories','legal_receivables','installments','receipts','client_transfers','financial_transactions']
  LOOP
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t);
  END LOOP;
END $$;

-- ============ SINCRONIZAÇÃO CAIXA ============
CREATE OR REPLACE FUNCTION public.sync_receipt_transaction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.financial_transactions WHERE source_type='receipt' AND source_id = OLD.id;
    RETURN OLD;
  END IF;
  INSERT INTO public.financial_transactions
    (organization_id, type, description, competence_date, paid_on, amount, status, bank_account_id, source_type, source_id, created_by)
  VALUES (NEW.organization_id, 'entrada', 'Recebimento de parcela', NEW.received_on, NEW.received_on,
          NEW.total_amount, 'pago', NEW.bank_account_id, 'receipt', NEW.id, NEW.created_by)
  ON CONFLICT (source_type, source_id) DO UPDATE
    SET amount = EXCLUDED.amount, paid_on = EXCLUDED.paid_on,
        bank_account_id = EXCLUDED.bank_account_id, updated_at = now();
  RETURN NEW;
END; $$;

CREATE TRIGGER receipts_sync_tx AFTER INSERT OR UPDATE OR DELETE ON public.receipts
FOR EACH ROW EXECUTE FUNCTION public.sync_receipt_transaction();

CREATE OR REPLACE FUNCTION public.sync_transfer_transaction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.financial_transactions WHERE source_type='client_transfer' AND source_id = OLD.id;
    RETURN OLD;
  END IF;
  IF NEW.status = 'pago' AND NEW.paid_on IS NOT NULL THEN
    INSERT INTO public.financial_transactions
      (organization_id, type, description, competence_date, paid_on, amount, status, bank_account_id, client_id, case_id, source_type, source_id, created_by)
    VALUES (NEW.organization_id,'repasse_de_terceiros','Repasse ao cliente', NEW.paid_on, NEW.paid_on,
            NEW.amount,'pago', NEW.bank_account_id, NEW.client_id, NEW.case_id,'client_transfer', NEW.id, NEW.created_by)
    ON CONFLICT (source_type, source_id) DO UPDATE
      SET amount = EXCLUDED.amount, paid_on = EXCLUDED.paid_on,
          bank_account_id = EXCLUDED.bank_account_id, updated_at = now();
  ELSE
    DELETE FROM public.financial_transactions WHERE source_type='client_transfer' AND source_id = NEW.id;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER transfers_sync_tx AFTER INSERT OR UPDATE OR DELETE ON public.client_transfers
FOR EACH ROW EXECUTE FUNCTION public.sync_transfer_transaction();

-- ============ VIEWS DE CÁLCULO ============
CREATE VIEW public.v_installments
WITH (security_invoker = true) AS
SELECT i.*,
  r.client_id, r.case_id, r.type AS receivable_type, r.status AS receivable_status, r.is_estimated,
  COALESCE(rc.paid_total,0) AS paid_total,
  COALESCE(rc.paid_fee,0) AS paid_fee,
  COALESCE(rc.paid_success_fee,0) AS paid_success_fee,
  COALESCE(rc.paid_client,0) AS paid_client,
  (i.gross_amount - COALESCE(rc.paid_total,0)) AS balance,
  CASE
    WHEN i.canceled_at IS NOT NULL THEN 'CANCELADA'
    WHEN i.gross_amount - COALESCE(rc.paid_total,0) <= 0.01 AND COALESCE(rc.paid_total,0) > 0 THEN 'PAGA'
    WHEN COALESCE(rc.paid_total,0) > 0.01 THEN 'PARCIAL'
    WHEN i.due_date IS NULL THEN 'A_DEFINIR'
    WHEN i.due_date = current_date THEN 'VENCE_HOJE'
    WHEN i.due_date < current_date THEN 'ATRASADA'
    ELSE 'A_VENCER'
  END AS status
FROM public.installments i
JOIN public.legal_receivables r ON r.id = i.receivable_id
LEFT JOIN (
  SELECT installment_id,
         sum(total_amount) paid_total,
         sum(fee_amount) paid_fee,
         sum(success_fee_amount) paid_success_fee,
         sum(client_amount) paid_client
  FROM public.receipts GROUP BY installment_id
) rc ON rc.installment_id = i.id;

CREATE VIEW public.v_client_balances
WITH (security_invoker = true) AS
SELECT c.id AS client_id, c.organization_id, c.name,
  COALESCE(rec.received_client,0) AS received_client,
  COALESCE(tr.transferred,0) AS transferred,
  COALESCE(rec.received_client,0) - COALESCE(tr.transferred,0) AS pending_transfer
FROM public.clients c
LEFT JOIN (
  SELECT r.client_id, sum(rp.client_amount) received_client
  FROM public.receipts rp
  JOIN public.installments i ON i.id = rp.installment_id
  JOIN public.legal_receivables r ON r.id = i.receivable_id
  GROUP BY r.client_id
) rec ON rec.client_id = c.id
LEFT JOIN (
  SELECT client_id, sum(amount) transferred FROM public.client_transfers
  WHERE status = 'pago' GROUP BY client_id
) tr ON tr.client_id = c.id;

CREATE VIEW public.v_bank_balances
WITH (security_invoker = true) AS
SELECT b.id AS bank_account_id, b.organization_id, b.name, b.color,
  b.initial_balance + COALESCE(mv.delta,0) AS balance
FROM public.bank_accounts b
LEFT JOIN (
  SELECT bank_account_id,
    sum(CASE WHEN type IN ('entrada','entrada_de_terceiros') THEN amount
             WHEN type IN ('saida','repasse_de_terceiros') THEN -amount ELSE 0 END) delta
  FROM public.financial_transactions WHERE status='pago' GROUP BY bank_account_id
) mv ON mv.bank_account_id = b.id;

-- ============ GRANTS ============
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations, public.profiles, public.clients,
  public.client_payment_accounts, public.cases, public.bank_accounts, public.categories,
  public.legal_receivables, public.installments, public.receipts, public.client_transfers,
  public.financial_transactions TO authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT SELECT ON public.v_installments, public.v_client_balances, public.v_bank_balances TO authenticated;
GRANT ALL ON public.organizations, public.profiles, public.user_roles, public.clients,
  public.client_payment_accounts, public.cases, public.bank_accounts, public.categories,
  public.legal_receivables, public.installments, public.receipts, public.client_transfers,
  public.financial_transactions, public.audit_logs TO service_role;

-- ============ RLS ============
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_payment_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_receivables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_select ON public.organizations FOR SELECT TO authenticated
  USING (public.is_org_member(id));
CREATE POLICY org_update ON public.organizations FOR UPDATE TO authenticated
  USING (public.is_org_member(id) AND public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.is_org_member(id) AND public.has_role(auth.uid(),'admin'));

CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR organization_id = public.current_org_id());
CREATE POLICY profiles_self_update ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY profiles_admin_all ON public.profiles FOR ALL TO authenticated
  USING (organization_id = public.current_org_id() AND public.has_role(auth.uid(),'admin'))
  WITH CHECK (organization_id = public.current_org_id() AND public.has_role(auth.uid(),'admin'));

CREATE POLICY roles_select_self ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- tabelas de negócio: leitura por membro da organização; escrita conforme papel
CREATE POLICY clients_select ON public.clients FOR SELECT TO authenticated USING (organization_id = public.current_org_id());
CREATE POLICY clients_write ON public.clients FOR ALL TO authenticated
  USING (organization_id = public.current_org_id() AND public.can_write())
  WITH CHECK (organization_id = public.current_org_id() AND public.can_write());

CREATE POLICY cpa_select ON public.client_payment_accounts FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id() AND public.can_write());
CREATE POLICY cpa_write ON public.client_payment_accounts FOR ALL TO authenticated
  USING (organization_id = public.current_org_id() AND public.can_write())
  WITH CHECK (organization_id = public.current_org_id() AND public.can_write());

CREATE POLICY cases_select ON public.cases FOR SELECT TO authenticated USING (organization_id = public.current_org_id());
CREATE POLICY cases_write ON public.cases FOR ALL TO authenticated
  USING (organization_id = public.current_org_id() AND public.can_write())
  WITH CHECK (organization_id = public.current_org_id() AND public.can_write());

CREATE POLICY bank_select ON public.bank_accounts FOR SELECT TO authenticated USING (organization_id = public.current_org_id());
CREATE POLICY bank_write ON public.bank_accounts FOR ALL TO authenticated
  USING (organization_id = public.current_org_id() AND public.can_write())
  WITH CHECK (organization_id = public.current_org_id() AND public.can_write());

CREATE POLICY cat_select ON public.categories FOR SELECT TO authenticated USING (organization_id = public.current_org_id());
CREATE POLICY cat_write ON public.categories FOR ALL TO authenticated
  USING (organization_id = public.current_org_id() AND public.can_write())
  WITH CHECK (organization_id = public.current_org_id() AND public.can_write());

CREATE POLICY recv_select ON public.legal_receivables FOR SELECT TO authenticated USING (organization_id = public.current_org_id());
CREATE POLICY recv_write ON public.legal_receivables FOR ALL TO authenticated
  USING (organization_id = public.current_org_id() AND public.can_write())
  WITH CHECK (organization_id = public.current_org_id() AND public.can_write());

CREATE POLICY inst_select ON public.installments FOR SELECT TO authenticated USING (organization_id = public.current_org_id());
CREATE POLICY inst_write ON public.installments FOR ALL TO authenticated
  USING (organization_id = public.current_org_id() AND public.can_write())
  WITH CHECK (organization_id = public.current_org_id() AND public.can_write());

CREATE POLICY rcpt_select ON public.receipts FOR SELECT TO authenticated USING (organization_id = public.current_org_id());
CREATE POLICY rcpt_write ON public.receipts FOR ALL TO authenticated
  USING (organization_id = public.current_org_id() AND public.can_write())
  WITH CHECK (organization_id = public.current_org_id() AND public.can_write());

CREATE POLICY tr_select ON public.client_transfers FOR SELECT TO authenticated USING (organization_id = public.current_org_id());
CREATE POLICY tr_write ON public.client_transfers FOR ALL TO authenticated
  USING (organization_id = public.current_org_id() AND public.can_write())
  WITH CHECK (organization_id = public.current_org_id() AND public.can_write());

CREATE POLICY tx_select ON public.financial_transactions FOR SELECT TO authenticated USING (organization_id = public.current_org_id());
CREATE POLICY tx_write ON public.financial_transactions FOR ALL TO authenticated
  USING (organization_id = public.current_org_id() AND public.can_write())
  WITH CHECK (organization_id = public.current_org_id() AND public.can_write());

CREATE POLICY audit_select ON public.audit_logs FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id() AND public.has_role(auth.uid(),'admin'));
CREATE POLICY audit_insert ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_org_id() AND user_id = auth.uid());