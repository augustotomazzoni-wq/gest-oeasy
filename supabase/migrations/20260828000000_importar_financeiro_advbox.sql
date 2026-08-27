-- Importação do resumo de receitas e despesas do Advbox.

-- ============================================================
-- 1) Categoria não pode duplicar.
--    A importação cria sozinha as categorias que ainda não existem; sem uma
--    trava, reimportar o mesmo arquivo criaria "5. ALUGUEL" de novo a cada
--    vez. Compara sem acento e sem maiúsculas para "Alugúel" não virar uma
--    segunda categoria de "ALUGUEL".
-- ============================================================
DELETE FROM public.categories c
USING public.categories d
WHERE c.organization_id = d.organization_id
  AND c.type = d.type
  AND lower(btrim(c.name)) = lower(btrim(d.name))
  AND c.ctid > d.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS categories_org_name_type_uidx
  ON public.categories (organization_id, lower(btrim(name)), type);

-- ============================================================
-- 2) Impressão digital do lançamento importado.
--    O Advbox não exporta um id por linha, então a identidade é o próprio
--    conteúdo (tipo + datas + categoria + descrição + valor + processo).
--    Com o índice único abaixo, reimportar o mesmo arquivo — ou um arquivo
--    maior que repita meses já importados — não duplica nada.
--
--    Fica em coluna própria, e não em source_type/source_id, de propósito:
--    source_type marca o que é espelho de recebimento e por isso não pode
--    ser editado nem apagado. Lançamento importado do Advbox é lançamento
--    manual comum — o Administrador precisa poder corrigir e excluir.
-- ============================================================
ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS import_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS financial_transactions_import_uidx
  ON public.financial_transactions (organization_id, import_hash)
  WHERE import_hash IS NOT NULL;
