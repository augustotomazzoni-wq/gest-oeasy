-- ============================================================
-- Leitura do financeiro obedece à matriz de permissões,
-- e a troca de perfil de um usuário passa a ser uma operação só.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Quem pode LER o financeiro
-- ------------------------------------------------------------
-- Até aqui, lançamentos do caixa, empréstimos, recebimentos, parcelas e
-- acordos podiam ser lidos por qualquer usuário ativo do escritório. O
-- menu escondia o Fluxo de Caixa de um perfil de Consulta ou Advogado, mas
-- bastava digitar o endereço da tela para abrir tudo: esconder o botão
-- não é proteger o dado.
--
-- Agora a leitura segue a coluna "Ver" da matriz de permissões, tela por
-- tela. Administrador, Sócio Gestor e Financeiro continuam lendo tudo,
-- independentemente da matriz (é o can_write()) — assim nenhuma
-- desmarcação por engano tranca quem administra o sistema.

DROP POLICY IF EXISTS tx_select ON public.financial_transactions;
CREATE POLICY tx_select ON public.financial_transactions FOR SELECT TO authenticated
  USING (
    organization_id = public.current_org_id()
    AND (
      public.can_write()
      OR public.has_role(auth.uid(), 'lancador'::public.app_role)
      OR public.can('caixa', 'view')
    )
  );

DROP POLICY IF EXISTS loans_select ON public.loans;
CREATE POLICY loans_select ON public.loans FOR SELECT TO authenticated
  USING (
    organization_id = public.current_org_id()
    AND (public.can_write() OR public.can('caixa', 'view'))
  );

DROP POLICY IF EXISTS rcpt_select ON public.receipts;
CREATE POLICY rcpt_select ON public.receipts FOR SELECT TO authenticated
  USING (
    organization_id = public.current_org_id()
    AND (public.can_write() OR public.can('parcelas', 'view'))
  );

DROP POLICY IF EXISTS inst_select ON public.installments;
CREATE POLICY inst_select ON public.installments FOR SELECT TO authenticated
  USING (
    organization_id = public.current_org_id()
    AND (public.can_write() OR public.can('parcelas', 'view'))
  );

DROP POLICY IF EXISTS recv_select ON public.legal_receivables;
CREATE POLICY recv_select ON public.legal_receivables FOR SELECT TO authenticated
  USING (
    organization_id = public.current_org_id()
    AND (public.can_write() OR public.can('acordos', 'view'))
  );

-- ------------------------------------------------------------
-- 2) Trocar o perfil de um usuário, de uma vez só
-- ------------------------------------------------------------
-- A tela apagava o perfil antigo e depois gravava o novo, em dois pedidos
-- separados. Se o segundo falhasse, a pessoa ficava sem perfil nenhum e
-- sem acesso. Aqui as duas coisas acontecem juntas: ou troca, ou fica
-- como estava.
CREATE OR REPLACE FUNCTION public.set_user_role(_user_id uuid, _role public.app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.current_org_id() IS NULL THEN
    RAISE EXCEPTION 'Seu acesso está desativado.';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.can('global', 'manage_users')
  ) THEN
    RAISE EXCEPTION 'Você não tem permissão para alterar perfis de acesso.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = _user_id
       AND p.organization_id = public.current_org_id()
  ) THEN
    RAISE EXCEPTION 'Este usuário não pertence ao seu escritório.';
  END IF;

  -- Só quem já é Administrador concede o perfil de Administrador.
  IF _role = 'admin'::public.app_role
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Somente o Administrador Principal pode conceder esse perfil.';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = _user_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_user_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_role(uuid, public.app_role) TO authenticated;

-- ------------------------------------------------------------
-- 3) Avisa a API que o formato mudou
-- ------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------
-- Conferência: devem voltar seis linhas
-- ------------------------------------------------------------
SELECT tablename || ' / ' || policyname AS item, qual AS regra
  FROM pg_policies
 WHERE schemaname = 'public'
   AND policyname IN ('tx_select', 'loans_select', 'rcpt_select', 'inst_select', 'recv_select')
UNION ALL
SELECT 'funcao set_user_role', count(*)::text
  FROM pg_proc
 WHERE proname = 'set_user_role'
 ORDER BY 1;
