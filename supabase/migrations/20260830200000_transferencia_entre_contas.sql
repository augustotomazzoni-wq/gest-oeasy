-- Transferência entre contas do próprio escritório.
--
-- O escritório passou a ter duas contas, e mover dinheiro de uma para a outra
-- não é receita nem despesa: o patrimônio não muda, só o lugar onde ele está.
-- Lançar como receita na conta que recebe inflaria o faturamento do mês; lançar
-- como despesa na que envia derrubaria o lucro. Nenhum dos dois aconteceu.
--
-- Como fica gravado: duas linhas no caixa, uma `saida` na conta de origem e uma
-- `entrada` na de destino, com o MESMO `source_id`. É esse id compartilhado que
-- mantém as duas juntas — apagar uma sem a outra deixaria o saldo errado para
-- sempre, então tudo passa por funções que mexem no par inteiro.
--
-- Por que não uma coluna nova: `v_bank_balances` já soma `entrada` como + e
-- `saida` como −, cada linha na sua conta. Com o par, o saldo das duas contas
-- se ajusta sozinho, sem tocar em nenhuma view. E o `source_type` preenchido
-- faz as funções genéricas de editar e apagar lançamento recusarem mexer numa
-- perna solta, que é exatamente o que se quer.
--
-- Por que `transfer_out` e `transfer_in` em vez de um só: existe índice único
-- em (source_type, source_id). Com o mesmo source_type nas duas linhas, a
-- segunda bateria no índice. Com nomes diferentes, o par convive e continua
-- protegido contra duplicidade.

-- ============================================================
-- 1) Registrar a transferência
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_account_transfer(
  _from_account uuid,
  _to_account uuid,
  _amount numeric,
  _date date,
  _notes text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  _org uuid := public.current_org_id();
  _group uuid := gen_random_uuid();
  _from_name text;
  _to_name text;
  _saldo_origem numeric;
  _user_email text;
BEGIN
  IF _org IS NULL OR NOT public.can_write() THEN
    RAISE EXCEPTION 'Você não tem permissão para registrar transferências.';
  END IF;

  IF _from_account IS NULL OR _to_account IS NULL THEN
    RAISE EXCEPTION 'Escolha a conta de origem e a de destino.';
  END IF;

  IF _from_account = _to_account THEN
    RAISE EXCEPTION 'A conta de origem e a de destino são a mesma. Escolha contas diferentes.';
  END IF;

  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'Informe um valor maior que zero.';
  END IF;

  IF _date IS NULL THEN
    RAISE EXCEPTION 'Informe a data da transferência.';
  END IF;

  -- As duas contas têm de ser deste escritório. Sem esta conferência daria
  -- para mover dinheiro para a conta de outra organização passando o id na mão.
  SELECT name INTO _from_name FROM public.bank_accounts
  WHERE id = _from_account AND organization_id = _org;
  SELECT name INTO _to_name FROM public.bank_accounts
  WHERE id = _to_account AND organization_id = _org;

  IF _from_name IS NULL OR _to_name IS NULL THEN
    RAISE EXCEPTION 'Conta bancária não encontrada.';
  END IF;

  -- A saída sai da conta de origem.
  INSERT INTO public.financial_transactions (
    organization_id, created_by, type, status, description, amount,
    paid_on, due_date, competence_date, bank_account_id, notes,
    source_type, source_id
  ) VALUES (
    _org, auth.uid(), 'saida', 'pago',
    'Transferência para ' || _to_name, _amount,
    _date, _date, _date, _from_account, NULLIF(btrim(_notes), ''),
    'transfer_out', _group
  );

  -- E entra na de destino, no mesmo dia e pelo mesmo valor.
  INSERT INTO public.financial_transactions (
    organization_id, created_by, type, status, description, amount,
    paid_on, due_date, competence_date, bank_account_id, notes,
    source_type, source_id
  ) VALUES (
    _org, auth.uid(), 'entrada', 'pago',
    'Transferência de ' || _from_name, _amount,
    _date, _date, _date, _to_account, NULLIF(btrim(_notes), ''),
    'transfer_in', _group
  );

  -- Não impede a transferência, mas devolve o saldo para a tela avisar: às
  -- vezes o escritório move dinheiro sabendo que a conta fica negativa por um
  -- dia, e travar aqui só atrapalharia.
  SELECT balance INTO _saldo_origem FROM public.v_bank_balances
  WHERE bank_account_id = _from_account;

  SELECT email INTO _user_email FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (
    organization_id, user_id, user_email, action, table_name, record_id, new_values
  ) VALUES (
    _org, auth.uid(), _user_email, 'transferencia_entre_contas',
    'financial_transactions', _group,
    jsonb_build_object(
      'de', _from_name, 'para', _to_name,
      'valor', _amount, 'data', _date, 'observacoes', _notes
    )
  );

  RETURN jsonb_build_object(
    'grupo', _group,
    'de', _from_name,
    'para', _to_name,
    'valor', _amount,
    'saldo_da_origem', _saldo_origem
  );
END;
$fn$;

-- ============================================================
-- 2) Corrigir uma transferência já lançada
--    Mexe nas duas pernas de uma vez. Trocar a conta, o valor ou a data em
--    uma só deixaria as duas contas com saldo errado.
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_account_transfer(
  _group_id uuid,
  _from_account uuid,
  _to_account uuid,
  _amount numeric,
  _date date,
  _notes text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  _org uuid := public.current_org_id();
  _antes jsonb;
  _from_name text;
  _to_name text;
  _user_email text;
BEGIN
  IF _org IS NULL OR NOT public.can('caixa', 'edit') THEN
    RAISE EXCEPTION 'Você não tem permissão para editar lançamentos.';
  END IF;

  SELECT jsonb_agg(to_jsonb(t)) INTO _antes
  FROM public.financial_transactions t
  WHERE t.source_id = _group_id
    AND t.source_type IN ('transfer_out', 'transfer_in')
    AND t.organization_id = _org;

  IF _antes IS NULL THEN
    RAISE EXCEPTION 'Transferência não encontrada.';
  END IF;

  IF _from_account = _to_account THEN
    RAISE EXCEPTION 'A conta de origem e a de destino são a mesma. Escolha contas diferentes.';
  END IF;

  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'Informe um valor maior que zero.';
  END IF;

  IF _date IS NULL THEN
    RAISE EXCEPTION 'Informe a data da transferência.';
  END IF;

  SELECT name INTO _from_name FROM public.bank_accounts
  WHERE id = _from_account AND organization_id = _org;
  SELECT name INTO _to_name FROM public.bank_accounts
  WHERE id = _to_account AND organization_id = _org;

  IF _from_name IS NULL OR _to_name IS NULL THEN
    RAISE EXCEPTION 'Conta bancária não encontrada.';
  END IF;

  UPDATE public.financial_transactions SET
    amount = _amount,
    paid_on = _date,
    due_date = _date,
    competence_date = _date,
    bank_account_id = _from_account,
    description = 'Transferência para ' || _to_name,
    notes = NULLIF(btrim(_notes), ''),
    updated_at = now()
  WHERE source_id = _group_id AND source_type = 'transfer_out' AND organization_id = _org;

  UPDATE public.financial_transactions SET
    amount = _amount,
    paid_on = _date,
    due_date = _date,
    competence_date = _date,
    bank_account_id = _to_account,
    description = 'Transferência de ' || _from_name,
    notes = NULLIF(btrim(_notes), ''),
    updated_at = now()
  WHERE source_id = _group_id AND source_type = 'transfer_in' AND organization_id = _org;

  SELECT email INTO _user_email FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (
    organization_id, user_id, user_email, action, table_name, record_id,
    old_values, new_values
  ) VALUES (
    _org, auth.uid(), _user_email, 'editar_transferencia',
    'financial_transactions', _group_id, _antes,
    jsonb_build_object(
      'de', _from_name, 'para', _to_name,
      'valor', _amount, 'data', _date, 'observacoes', _notes
    )
  );
END;
$fn$;

-- ============================================================
-- 3) Apagar a transferência — as duas pernas juntas
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_account_transfer(_group_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  _org uuid := public.current_org_id();
  _antes jsonb;
  _user_email text;
BEGIN
  IF _org IS NULL OR NOT public.can('caixa', 'delete') THEN
    RAISE EXCEPTION 'Você não tem permissão para excluir lançamentos.';
  END IF;

  SELECT jsonb_agg(to_jsonb(t)) INTO _antes
  FROM public.financial_transactions t
  WHERE t.source_id = _group_id
    AND t.source_type IN ('transfer_out', 'transfer_in')
    AND t.organization_id = _org;

  IF _antes IS NULL THEN
    RAISE EXCEPTION 'Transferência não encontrada.';
  END IF;

  SELECT email INTO _user_email FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (
    organization_id, user_id, user_email, action, table_name, record_id, old_values
  ) VALUES (
    _org, auth.uid(), _user_email, 'excluir_transferencia',
    'financial_transactions', _group_id, _antes
  );

  DELETE FROM public.financial_transactions
  WHERE source_id = _group_id
    AND source_type IN ('transfer_out', 'transfer_in')
    AND organization_id = _org;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.create_account_transfer(uuid, uuid, numeric, date, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_account_transfer(uuid, uuid, numeric, date, text)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_account_transfer(uuid, uuid, uuid, numeric, date, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_account_transfer(uuid, uuid, uuid, numeric, date, text)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.delete_account_transfer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_account_transfer(uuid) TO authenticated;

-- ============================================================
-- 4) Avisar a API que existem funções novas
--
--    O PostgREST guarda em memória a lista do que existe no banco. Sem este
--    aviso ele pode continuar respondendo "could not find the function" por
--    alguns minutos depois da migration rodar — que é a tela dizendo "o banco
--    de dados está desatualizado" mesmo com tudo já criado.
-- ============================================================
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- 5) Conferência: as três funções têm de aparecer aqui
--
--    Se esta última consulta devolver as 3 linhas, está tudo no lugar e a tela
--    de transferência funciona. Se vier vazia, alguma coisa acima não rodou.
-- ============================================================
SELECT p.proname AS funcao_criada
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'create_account_transfer',
    'update_account_transfer',
    'delete_account_transfer'
  )
ORDER BY p.proname;
