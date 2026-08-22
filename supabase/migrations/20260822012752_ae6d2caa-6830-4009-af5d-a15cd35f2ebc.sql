-- Definições de perfis
CREATE TABLE public.role_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  code text NOT NULL,
  name text NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  protected boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (organization_id, code)
);

CREATE TABLE public.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  role_code text NOT NULL,
  module text NOT NULL,
  action text NOT NULL,
  allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, role_code, module, action)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_definitions TO authenticated;
GRANT ALL ON public.role_definitions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_permissions TO authenticated;
GRANT ALL ON public.role_permissions TO service_role;

ALTER TABLE public.role_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "role_definitions_select" ON public.role_definitions
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
CREATE POLICY "role_definitions_write" ON public.role_definitions
  FOR ALL TO authenticated
  USING (public.is_org_member(organization_id) AND public.has_role(auth.uid(),'admin') AND NOT protected)
  WITH CHECK (public.is_org_member(organization_id) AND public.has_role(auth.uid(),'admin') AND NOT protected);

CREATE POLICY "role_permissions_select" ON public.role_permissions
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
CREATE POLICY "role_permissions_write" ON public.role_permissions
  FOR ALL TO authenticated
  USING (public.is_org_member(organization_id) AND public.has_role(auth.uid(),'admin') AND role_code <> 'admin')
  WITH CHECK (public.is_org_member(organization_id) AND public.has_role(auth.uid(),'admin') AND role_code <> 'admin');

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.role_definitions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Permissão efetiva
CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _module text, _action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_code = ur.role::text
    WHERE ur.user_id = _user_id
      AND rp.allowed
      AND rp.action = _action
      AND rp.module IN (_module, 'global')
  );
$$;
REVOKE EXECUTE ON FUNCTION public.has_permission(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can(_module text, _action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_permission(auth.uid(), _module, _action);
$$;
REVOKE EXECUTE ON FUNCTION public.can(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_protected_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _user_id AND lower(p.email) = 'augusto.tomazzoni@gmail.com'
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_protected_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_protected_admin(uuid) TO authenticated, service_role;

-- Proteção do Administrador Principal
CREATE OR REPLACE FUNCTION public.protect_main_admin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'profiles' THEN
    IF public.is_protected_admin(OLD.id) THEN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'O Administrador Principal não pode ser excluído.';
      END IF;
      IF NEW.active = false OR lower(NEW.email) <> lower(OLD.email) THEN
        RAISE EXCEPTION 'O Administrador Principal não pode ser desativado nem ter o e-mail alterado.';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'user_roles' THEN
    IF TG_OP = 'DELETE' THEN
      IF public.is_protected_admin(OLD.user_id) AND OLD.role = 'admin' THEN
        RAISE EXCEPTION 'O papel de Administrador Principal não pode ser removido.';
      END IF;
      RETURN OLD;
    END IF;
    IF NEW.role = 'admin' AND NOT public.is_protected_admin(NEW.user_id)
       AND NOT public.is_protected_admin(auth.uid()) AND auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'Somente o Administrador Principal pode conceder esse papel.';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.protect_main_admin() FROM PUBLIC;

CREATE TRIGGER protect_main_admin_profiles
  BEFORE UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_main_admin();

CREATE TRIGGER protect_main_admin_roles
  BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.protect_main_admin();

-- Seed dos perfis
INSERT INTO public.role_definitions (organization_id, code, name, description, is_system, protected)
VALUES
 ('00000000-0000-0000-0000-000000000001','admin','Administrador Principal','Proprietário protegido da organização, com acesso total.',true,true),
 ('00000000-0000-0000-0000-000000000001','socio_gestor','Sócio Gestor','Opera todos os módulos, aprova lançamentos e gerencia usuários, sem editar a matriz de permissões.',true,false),
 ('00000000-0000-0000-0000-000000000001','financeiro','Financeiro','Opera o financeiro completo, categorias e aprovações, sem administrar usuários.',true,false),
 ('00000000-0000-0000-0000-000000000001','lancador','Lançador Financeiro','Cadastra receitas e despesas em rascunho para aprovação.',true,false),
 ('00000000-0000-0000-0000-000000000001','cobranca','Cobrança e Recebíveis','Acompanha parcelas, registra cobranças e confirma recebimento direto pela cliente.',true,false),
 ('00000000-0000-0000-0000-000000000001','consulta','Consulta Restrita','Somente leitura de cadastros e dados operacionais autorizados.',true,false),
 ('00000000-0000-0000-0000-000000000001','advogado','Advogado','Visualiza seus clientes e processos e registra observações.',true,false)
ON CONFLICT (organization_id, code) DO NOTHING;

-- Matriz de permissões
WITH org AS (SELECT '00000000-0000-0000-0000-000000000001'::uuid AS id),
mods AS (SELECT unnest(ARRAY['clientes','processos','acordos','parcelas','repasses','caixa','categorias','contas','relatorios','usuarios','perfis','importacao','cobrancas','dashboard']) AS module),
acts AS (SELECT unnest(ARRAY['view','create','edit','cancel_or_reverse','approve','export']) AS action),
matrix AS (
  -- admin: tudo
  SELECT 'admin' AS role_code, m.module, a.action, true AS allowed FROM mods m CROSS JOIN acts a
  UNION ALL
  SELECT 'admin', 'global', x, true FROM unnest(ARRAY['manage_categories','manage_users','manage_roles','view_sensitive_financials','confirm_direct_receipt','manage_collections']) x
  -- socio gestor: tudo menos perfis
  UNION ALL
  SELECT 'socio_gestor', m.module, a.action, m.module <> 'perfis' FROM mods m CROSS JOIN acts a
  UNION ALL
  SELECT 'socio_gestor', 'global', x, true FROM unnest(ARRAY['manage_categories','manage_users','view_sensitive_financials','confirm_direct_receipt','manage_collections']) x
  UNION ALL
  SELECT 'socio_gestor', 'global', 'manage_roles', false
  -- financeiro
  UNION ALL
  SELECT 'financeiro', m.module, a.action, m.module NOT IN ('usuarios','perfis') FROM mods m CROSS JOIN acts a
  UNION ALL
  SELECT 'financeiro', 'global', x, true FROM unnest(ARRAY['manage_categories','view_sensitive_financials','confirm_direct_receipt','manage_collections']) x
  UNION ALL
  SELECT 'financeiro', 'global', x, false FROM unnest(ARRAY['manage_users','manage_roles']) x
  -- lancador: apenas caixa (rascunhos próprios) e dashboard restrito
  UNION ALL
  SELECT 'lancador', 'caixa', a.action, a.action IN ('view','create','edit') FROM acts a
  UNION ALL
  SELECT 'lancador', 'dashboard', 'view', true
  UNION ALL
  SELECT 'lancador', 'global', x, false FROM unnest(ARRAY['manage_categories','manage_users','manage_roles','view_sensitive_financials','confirm_direct_receipt','manage_collections']) x
  -- cobranca
  UNION ALL
  SELECT 'cobranca', m.module, a.action, a.action = 'view' AND m.module IN ('clientes','processos','acordos','parcelas','cobrancas','dashboard') FROM mods m CROSS JOIN acts a
  UNION ALL
  SELECT 'cobranca', 'cobrancas', x, true FROM unnest(ARRAY['create','edit']) x
  UNION ALL
  SELECT 'cobranca', 'global', x, true FROM unnest(ARRAY['confirm_direct_receipt','manage_collections']) x
  UNION ALL
  SELECT 'cobranca', 'global', x, false FROM unnest(ARRAY['manage_categories','manage_users','manage_roles','view_sensitive_financials']) x
  -- consulta restrita
  UNION ALL
  SELECT 'consulta', m.module, a.action, a.action = 'view' AND m.module IN ('clientes','processos','acordos','parcelas','repasses','dashboard') FROM mods m CROSS JOIN acts a
  UNION ALL
  SELECT 'consulta', 'global', x, false FROM unnest(ARRAY['manage_categories','manage_users','manage_roles','view_sensitive_financials','confirm_direct_receipt','manage_collections']) x
  -- advogado
  UNION ALL
  SELECT 'advogado', m.module, a.action, a.action = 'view' AND m.module IN ('clientes','processos','acordos','parcelas','dashboard') FROM mods m CROSS JOIN acts a
  UNION ALL
  SELECT 'advogado', 'global', x, false FROM unnest(ARRAY['manage_categories','manage_users','manage_roles','view_sensitive_financials','confirm_direct_receipt','manage_collections']) x
)
INSERT INTO public.role_permissions (organization_id, role_code, module, action, allowed)
SELECT org.id, mx.role_code, mx.module, mx.action, bool_or(mx.allowed)
FROM matrix mx CROSS JOIN org
GROUP BY org.id, mx.role_code, mx.module, mx.action
ON CONFLICT (organization_id, role_code, module, action) DO NOTHING;
