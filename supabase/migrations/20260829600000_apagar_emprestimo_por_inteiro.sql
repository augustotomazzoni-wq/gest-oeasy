-- Apagar o empréstimo apagando também o dinheiro que ele trouxe.
--
-- O erro: delete_loan só removia lançamentos com status <> 'pago'. Só que a
-- entrada do dinheiro recebido nasce com status 'pago' — então ela sobrevivia
-- ao apagar. Pior: o UPDATE seguinte zerava o loan_id, deixando o lançamento
-- órfão, sem nada que ligasse de volta ao empréstimo. Era isso que fazia o
-- valor continuar aparecendo em "Total que entrou no caixa" depois de apagar.
--
-- Agora apaga tudo o que nasceu do empréstimo, pago ou não: se o empréstimo
-- não existe, o dinheiro dele não entrou e as parcelas dele não saíram. O que
-- some fica inteiro no log de auditoria.

-- O retorno muda de integer para jsonb, então a função antiga precisa sair
-- antes — CREATE OR REPLACE não troca o tipo de retorno.
DROP FUNCTION IF EXISTS public.delete_loan(uuid);

CREATE FUNCTION public.delete_loan(_loan_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  _org uuid := public.current_org_id();
  _loan public.loans%ROWTYPE;
  _entrou numeric;
  _saiu numeric;
  _n_pagos integer;
  _n_previstos integer;
  _snapshot jsonb;
  _user_email text;
BEGIN
  IF _org IS NULL OR NOT public.can_write() THEN
    RAISE EXCEPTION 'Você não tem permissão para apagar empréstimos.';
  END IF;

  SELECT * INTO _loan FROM public.loans
  WHERE id = _loan_id AND organization_id = _org FOR UPDATE;

  IF _loan.id IS NULL THEN
    RAISE EXCEPTION 'Empréstimo não encontrado.';
  END IF;

  SELECT
    COALESCE(sum(amount) FILTER (WHERE type = 'entrada' AND status = 'pago'), 0),
    COALESCE(sum(amount) FILTER (WHERE type = 'saida'   AND status = 'pago'), 0),
    count(*) FILTER (WHERE status = 'pago'),
    count(*) FILTER (WHERE status <> 'pago')
    INTO _entrou, _saiu, _n_pagos, _n_previstos
  FROM public.financial_transactions
  WHERE loan_id = _loan_id AND organization_id = _org;

  _snapshot := jsonb_build_object(
    'emprestimo', to_jsonb(_loan),
    'entrou_estornado_do_caixa', _entrou,
    'saiu_estornado_do_caixa', _saiu,
    'lancamentos', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
                    FROM public.financial_transactions t
                    WHERE t.loan_id = _loan_id AND t.organization_id = _org)
  );

  -- Tudo o que o empréstimo criou, pago ou previsto.
  DELETE FROM public.financial_transactions
  WHERE loan_id = _loan_id AND organization_id = _org;

  DELETE FROM public.loans WHERE id = _loan_id AND organization_id = _org;

  SELECT email INTO _user_email FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (
    organization_id, user_id, user_email, action, table_name, record_id, old_values
  ) VALUES (
    _org, auth.uid(), _user_email, 'apagar_emprestimo', 'loans', _loan_id, _snapshot
  );

  RETURN jsonb_build_object(
    'pagos', _n_pagos,
    'previstos', _n_previstos,
    'entrou', _entrou,
    'saiu', _saiu
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.delete_loan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_loan(uuid) TO authenticated;

-- ============================================================
-- Faxina do estrago que a versão antiga deixou: entradas e parcelas que
-- ficaram órfãs quando um empréstimo foi apagado. Só pega o que a própria
-- create_loan escreveu — a descrição tem o formato dela e o vínculo já foi
-- cortado. Lançamento feito à mão pelo escritório não bate com o padrão.
-- ============================================================
DO $faxina$
DECLARE
  _n integer := 0;
BEGIN
  -- Guarda no log antes de apagar, uma linha por organização.
  INSERT INTO public.audit_logs (
    organization_id, user_email, action, table_name, old_values
  )
  SELECT t.organization_id, 'sistema', 'faxina_emprestimo_orfao',
         'financial_transactions', jsonb_agg(to_jsonb(t))
  FROM public.financial_transactions t
  WHERE t.loan_id IS NULL
    AND t.is_financing
    AND (
      (t.type = 'entrada' AND t.description LIKE 'Empréstimo recebido - %')
      OR (t.type = 'saida' AND t.status <> 'pago'
          AND t.description ~ '^Parcela [0-9]+/[0-9]+ - ')
    )
  GROUP BY t.organization_id;

  DELETE FROM public.financial_transactions t
  WHERE t.loan_id IS NULL
    AND t.is_financing
    AND (
      (t.type = 'entrada' AND t.description LIKE 'Empréstimo recebido - %')
      OR (t.type = 'saida' AND t.status <> 'pago'
          AND t.description ~ '^Parcela [0-9]+/[0-9]+ - ')
    );

  GET DIAGNOSTICS _n = ROW_COUNT;
  RAISE NOTICE 'Faxina: % lancamento(s) orfao(s) de emprestimo removido(s).', _n;
END;
$faxina$;
