-- ============================================================
-- Integração com a Advbox
--
-- Guarda o token da API e liga cada cliente e cada processo daqui
-- ao registro correspondente lá, para que atualizar não duplique.
--
-- O token é segredo do escritório: fica numa tabela que o navegador
-- não enxerga de jeito nenhum (sem GRANT para authenticated). Só o
-- servidor do aplicativo, com a chave de serviço, consegue ler. Quem
-- está logado — inclusive um perfil de Consulta Restrita — não tem
-- como puxar esse valor pelo F12.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Onde mora o token
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.advbox_integracao (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  token text NOT NULL,
  -- Últimos quatro caracteres, só para o Administrador reconhecer qual
  -- token está salvo sem precisar ver o token.
  token_dica text,
  ativo boolean NOT NULL DEFAULT true,
  ultima_sincronizacao timestamptz,
  ultimo_resultado text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_by_email text
);

ALTER TABLE public.advbox_integracao ENABLE ROW LEVEL SECURITY;

-- De propósito: nada para o navegador. Toda leitura e escrita passa
-- pelas funções de servidor do aplicativo.
REVOKE ALL ON public.advbox_integracao FROM authenticated, anon;
GRANT ALL ON public.advbox_integracao TO service_role;

-- Política só por garantia: se um dia alguém conceder GRANT por engano,
-- ainda assim fica restrito ao Administrador da própria organização.
DROP POLICY IF EXISTS advbox_admin ON public.advbox_integracao;
CREATE POLICY advbox_admin ON public.advbox_integracao FOR ALL TO authenticated
  USING (organization_id = public.current_org_id() AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (organization_id = public.current_org_id() AND public.has_role(auth.uid(), 'admin'::public.app_role));

-- ------------------------------------------------------------
-- 2) A ligação com o cadastro de lá
-- ------------------------------------------------------------
-- Sem isso, atualizar de novo criaria tudo outra vez a cada mudança de
-- nome ou de CPF. Com o id da Advbox guardado, o mesmo cliente é sempre
-- reconhecido como o mesmo.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS advbox_id bigint;
ALTER TABLE public.cases   ADD COLUMN IF NOT EXISTS advbox_id bigint;

CREATE UNIQUE INDEX IF NOT EXISTS clients_advbox_id_idx
  ON public.clients (organization_id, advbox_id) WHERE advbox_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cases_advbox_id_idx
  ON public.cases (organization_id, advbox_id) WHERE advbox_id IS NOT NULL;

-- ------------------------------------------------------------
-- 3) Avisa a API que o formato mudou
-- ------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------
-- Conferência: rode junto e veja se voltam as três linhas
-- ------------------------------------------------------------
SELECT 'tabela advbox_integracao' AS item,
       count(*)::text AS resultado
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'advbox_integracao'
UNION ALL
SELECT 'coluna advbox_id em clients',
       count(*)::text
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'advbox_id'
UNION ALL
SELECT 'coluna advbox_id em cases',
       count(*)::text
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'cases' AND column_name = 'advbox_id';
