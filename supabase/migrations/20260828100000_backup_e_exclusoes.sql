-- Exclusão de conta/categoria restrita ao Administrador, e backup completo
-- do sistema com histórico de versões.

-- ============================================================
-- 1) Excluir conta bancária ou categoria vira permissão própria.
--    Nasce ligada só para o Administrador Principal; os demais perfis
--    continuam podendo apenas DESATIVAR, que é o que preserva o histórico.
-- ============================================================
INSERT INTO public.role_permissions (organization_id, role_code, module, action, allowed)
SELECT o.id, r.role_code, m.module, 'delete', r.allowed
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
CROSS JOIN (VALUES ('contas'), ('categorias')) AS m(module)
ON CONFLICT (organization_id, role_code, module, action) DO NOTHING;

UPDATE public.role_permissions
SET allowed = false, updated_at = now()
WHERE module IN ('contas', 'categorias')
  AND action = 'delete'
  AND role_code <> 'admin'
  AND allowed;

-- ============================================================
-- 2) Categoria importada do Advbox não precisa do número na frente.
--    "6. INDENIZAÇÃO" vira "INDENIZAÇÃO". Só renomeia quando o nome
--    limpo ainda não existe, para não colidir com o índice único.
-- ============================================================
UPDATE public.categories c
SET name = btrim(regexp_replace(c.name, '^[0-9]+\.\s*', '')), updated_at = now()
WHERE c.name ~ '^[0-9]+\.\s'
  AND NOT EXISTS (
    SELECT 1 FROM public.categories d
    WHERE d.organization_id = c.organization_id
      AND d.type = c.type
      AND d.id <> c.id
      AND lower(btrim(d.name)) = lower(btrim(regexp_replace(c.name, '^[0-9]+\.\s*', '')))
  );

-- ============================================================
-- 3) Excluir categoria. Recusa quando ela já foi usada: apagar
--    deixaria lançamentos antigos sem classificação e o relatório do
--    ano passado mudaria sozinho. Nesse caso o caminho é desativar.
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_category(_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  _org uuid := public.current_org_id();
  _old public.categories%ROWTYPE;
  _usos integer;
  _user_email text;
BEGIN
  IF _org IS NULL OR NOT public.can('categorias', 'delete') THEN
    RAISE EXCEPTION 'Somente o Administrador pode excluir categorias. Use "Desativar".';
  END IF;

  SELECT * INTO _old FROM public.categories
  WHERE id = _id AND organization_id = _org FOR UPDATE;
  IF _old.id IS NULL THEN
    RAISE EXCEPTION 'Categoria não encontrada.';
  END IF;

  SELECT count(*) INTO _usos FROM public.financial_transactions WHERE category_id = _id;
  IF _usos > 0 THEN
    RAISE EXCEPTION 'Esta categoria está em % lançamento(s) e não pode ser apagada sem alterar o histórico. Use "Desativar" para tirá-la das listas sem mexer no passado.', _usos;
  END IF;

  SELECT email INTO _user_email FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (
    organization_id, user_id, user_email, action, table_name, record_id, old_values
  ) VALUES (
    _org, auth.uid(), _user_email, 'excluir_categoria', 'categories', _id,
    jsonb_build_object('nome', _old.name, 'tipo', _old.type)
  );

  DELETE FROM public.categories WHERE id = _id;
END;
$fn$;

-- ============================================================
-- 4) Excluir conta bancária. Mesma regra: conta que já teve movimento
--    não some, porque o saldo histórico depende dela.
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_bank_account(_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  _org uuid := public.current_org_id();
  _old public.bank_accounts%ROWTYPE;
  _usos integer;
  _user_email text;
BEGIN
  IF _org IS NULL OR NOT public.can('contas', 'delete') THEN
    RAISE EXCEPTION 'Somente o Administrador pode excluir contas bancárias. Use "Desativar".';
  END IF;

  SELECT * INTO _old FROM public.bank_accounts
  WHERE id = _id AND organization_id = _org FOR UPDATE;
  IF _old.id IS NULL THEN
    RAISE EXCEPTION 'Conta não encontrada.';
  END IF;

  SELECT count(*) INTO _usos FROM public.financial_transactions WHERE bank_account_id = _id;
  IF _usos > 0 THEN
    RAISE EXCEPTION 'Esta conta tem % lançamento(s) e não pode ser apagada sem alterar o histórico. Use "Desativar" para tirá-la das listas sem mexer no passado.', _usos;
  END IF;

  SELECT email INTO _user_email FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (
    organization_id, user_id, user_email, action, table_name, record_id, old_values
  ) VALUES (
    _org, auth.uid(), _user_email, 'excluir_conta', 'bank_accounts', _id,
    jsonb_build_object('nome', _old.name, 'banco', _old.bank, 'conta', _old.account)
  );

  DELETE FROM public.bank_accounts WHERE id = _id;
END;
$fn$;

-- ============================================================
-- 5) Histórico de backups.
--    O conteúdo inteiro fica na própria linha: nesta escala (centenas de
--    registros) é bem menor que a papelada de um único processo, e evita
--    depender de bucket de arquivos.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  label text NOT NULL,
  kind text NOT NULL DEFAULT 'manual',
  payload jsonb NOT NULL,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  size_bytes integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_by_email text
);

CREATE INDEX IF NOT EXISTS backups_org_created_idx
  ON public.backups (organization_id, created_at DESC);

ALTER TABLE public.backups ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON public.backups TO authenticated;
GRANT ALL ON public.backups TO service_role;

-- Backup é a cópia integral do escritório: só o Administrador enxerga.
DROP POLICY IF EXISTS backups_admin_select ON public.backups;
CREATE POLICY backups_admin_select ON public.backups FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id() AND public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS backups_admin_write ON public.backups;
CREATE POLICY backups_admin_write ON public.backups FOR ALL TO authenticated
  USING (organization_id = public.current_org_id() AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (organization_id = public.current_org_id() AND public.has_role(auth.uid(), 'admin'::public.app_role));
