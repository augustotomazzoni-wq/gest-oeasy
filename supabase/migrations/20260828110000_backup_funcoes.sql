-- Gerar e restaurar backup completo do escritório.

-- ============================================================
-- Gerar backup. Copia todas as tabelas de dados do escritório.
--
-- Ficam de fora, de propósito:
--   profiles e user_roles — presos ao login do Supabase; restaurá-los
--     derrubaria o acesso de todo mundo;
--   audit_logs — é o livro de registro, nunca se sobrescreve;
--   a própria tabela de backups.
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_backup(_label text DEFAULT NULL, _kind text DEFAULT 'manual')
RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  _org uuid := public.current_org_id();
  _payload jsonb;
  _counts jsonb;
  _id uuid;
  _user_email text;
BEGIN
  IF _org IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Somente o Administrador pode gerar backup.';
  END IF;

  SELECT jsonb_build_object(
    'bank_accounts',           (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.bank_accounts t WHERE t.organization_id = _org),
    'categories',              (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.categories t WHERE t.organization_id = _org),
    'clients',                 (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.clients t WHERE t.organization_id = _org),
    'cases',                   (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.cases t WHERE t.organization_id = _org),
    'client_payment_accounts', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.client_payment_accounts t WHERE t.organization_id = _org),
    'legal_receivables',       (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.legal_receivables t WHERE t.organization_id = _org),
    'installments',            (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.installments t WHERE t.organization_id = _org),
    'receipts',                (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.receipts t WHERE t.organization_id = _org),
    'client_transfers',        (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.client_transfers t WHERE t.organization_id = _org),
    'financial_transactions',  (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.financial_transactions t WHERE t.organization_id = _org)
  ) INTO _payload;

  SELECT jsonb_object_agg(k, jsonb_array_length(v)) INTO _counts
  FROM jsonb_each(_payload) AS e(k, v);

  SELECT email INTO _user_email FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.backups (
    organization_id, label, kind, payload, counts, size_bytes, created_by, created_by_email
  ) VALUES (
    _org,
    coalesce(nullif(btrim(_label), ''), to_char(now(), 'DD/MM/YYYY HH24:MI')),
    coalesce(nullif(btrim(_kind), ''), 'manual'),
    jsonb_build_object('versao', 1, 'gerado_em', now(), 'tabelas', _payload),
    _counts,
    length(_payload::text),
    auth.uid(),
    _user_email
  )
  RETURNING id INTO _id;

  INSERT INTO public.audit_logs (
    organization_id, user_id, user_email, action, table_name, record_id, new_values
  ) VALUES (
    _org, auth.uid(), _user_email, 'gerar_backup', 'backups', _id, _counts
  );

  RETURN _id;
END;
$fn$;

-- ============================================================
-- Restaurar. Substitui os dados atuais pelos do backup.
--
-- Antes de mexer em qualquer coisa, grava um backup automático do estado
-- atual — se a restauração for a errada, dá para voltar. Tudo acontece
-- dentro de uma transação: ou restaura inteiro, ou não restaura nada.
--
-- A ordem importa: apaga do filho para o pai e insere do pai para o
-- filho. Recebimentos e repasses recriam sozinhos, por gatilho, os
-- lançamentos espelhados no caixa — por isso financial_transactions
-- entra por último e ignora os que o gatilho já criou.
-- ============================================================
CREATE OR REPLACE FUNCTION public.restore_backup(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  _org uuid := public.current_org_id();
  _t jsonb;
  _counts jsonb;
  _user_email text;
BEGIN
  IF _org IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Somente o Administrador pode restaurar backup.';
  END IF;

  _t := _payload -> 'tabelas';
  IF _t IS NULL OR jsonb_typeof(_t) <> 'object' THEN
    RAISE EXCEPTION 'Arquivo de backup inválido: não encontrei a seção "tabelas".';
  END IF;

  -- Rede de segurança: o estado de agora vira uma versão no histórico.
  PERFORM public.create_backup(
    'Antes de restaurar - ' || to_char(now(), 'DD/MM/YYYY HH24:MI'), 'automatico'
  );

  DELETE FROM public.client_transfers WHERE organization_id = _org;
  DELETE FROM public.receipts WHERE organization_id = _org;
  DELETE FROM public.installments WHERE organization_id = _org;
  DELETE FROM public.legal_receivables WHERE organization_id = _org;
  DELETE FROM public.financial_transactions WHERE organization_id = _org;
  DELETE FROM public.client_payment_accounts WHERE organization_id = _org;
  DELETE FROM public.cases WHERE organization_id = _org;
  DELETE FROM public.clients WHERE organization_id = _org;
  DELETE FROM public.categories WHERE organization_id = _org;
  DELETE FROM public.bank_accounts WHERE organization_id = _org;

  INSERT INTO public.bank_accounts
    SELECT * FROM jsonb_populate_recordset(null::public.bank_accounts, coalesce(_t->'bank_accounts', '[]'::jsonb));
  INSERT INTO public.categories
    SELECT * FROM jsonb_populate_recordset(null::public.categories, coalesce(_t->'categories', '[]'::jsonb));
  INSERT INTO public.clients
    SELECT * FROM jsonb_populate_recordset(null::public.clients, coalesce(_t->'clients', '[]'::jsonb));
  INSERT INTO public.cases
    SELECT * FROM jsonb_populate_recordset(null::public.cases, coalesce(_t->'cases', '[]'::jsonb));
  INSERT INTO public.client_payment_accounts
    SELECT * FROM jsonb_populate_recordset(null::public.client_payment_accounts, coalesce(_t->'client_payment_accounts', '[]'::jsonb));
  INSERT INTO public.legal_receivables
    SELECT * FROM jsonb_populate_recordset(null::public.legal_receivables, coalesce(_t->'legal_receivables', '[]'::jsonb));
  INSERT INTO public.installments
    SELECT * FROM jsonb_populate_recordset(null::public.installments, coalesce(_t->'installments', '[]'::jsonb));
  INSERT INTO public.receipts
    SELECT * FROM jsonb_populate_recordset(null::public.receipts, coalesce(_t->'receipts', '[]'::jsonb));
  INSERT INTO public.client_transfers
    SELECT * FROM jsonb_populate_recordset(null::public.client_transfers, coalesce(_t->'client_transfers', '[]'::jsonb));

  INSERT INTO public.financial_transactions
    SELECT * FROM jsonb_populate_recordset(null::public.financial_transactions, coalesce(_t->'financial_transactions', '[]'::jsonb))
  ON CONFLICT (source_type, source_id) DO NOTHING;

  SELECT jsonb_object_agg(k, jsonb_array_length(v)) INTO _counts
  FROM jsonb_each(_t) AS e(k, v);

  SELECT email INTO _user_email FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (
    organization_id, user_id, user_email, action, table_name, new_values
  ) VALUES (
    _org, auth.uid(), _user_email, 'restaurar_backup', 'backups', _counts
  );

  RETURN _counts;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.delete_category(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_bank_account(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_backup(text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.restore_backup(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_category(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_bank_account(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_backup(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_backup(jsonb) TO authenticated;
