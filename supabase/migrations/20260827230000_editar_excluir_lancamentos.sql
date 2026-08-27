-- Editar e excluir lançamentos do fluxo de caixa.
--
-- Regra central: só lançamento MANUAL pode ser editado ou apagado.
-- Lançamento que nasceu de um recebimento ou de um repasse (source_type
-- preenchido) é espelho da sua origem — mexer nele por fora deixaria o caixa
-- divergente da parcela. Para esses, o caminho continua sendo estornar o
-- recebimento, que já desfaz o lançamento sozinho.

-- ============================================================
-- 1) Duas permissões novas na matriz de perfis: "Editar" e "Excluir"
--    no módulo Fluxo de caixa. Nascem ligadas SÓ para o Administrador
--    Principal; os demais perfis aparecem na tela desmarcados, prontos
--    para serem liberados quando o escritório quiser.
-- ============================================================
INSERT INTO public.role_permissions (organization_id, role_code, module, action, allowed)
SELECT o.id, r.role_code, 'caixa', a.action, r.allowed
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
CROSS JOIN (VALUES ('edit'), ('delete')) AS a(action)
ON CONFLICT (organization_id, role_code, module, action) DO NOTHING;

-- 'caixa:edit' já existia na matriz desde o início, ligado para Financeiro,
-- Lançador e Sócio Gestor — mas naquela época não fazia nada, porque não havia
-- botão de editar. Agora que ele libera a edição de verdade, precisa começar
-- fechado como o 'delete': o escritório abre para quem quiser, com a decisão
-- consciente. O INSERT acima não corrige isso sozinho (ON CONFLICT DO NOTHING
-- preserva a linha antiga), por isso o UPDATE explícito.
UPDATE public.role_permissions
SET allowed = false, updated_at = now()
WHERE module = 'caixa' AND action = 'edit' AND role_code <> 'admin' AND allowed;

-- ============================================================
-- 2) Editar um lançamento manual.
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_manual_transaction(
  _id uuid,
  _type text,
  _description text,
  _amount numeric,
  _status text,
  _date date,
  _payment_method text DEFAULT NULL,
  _bank_account_id uuid DEFAULT NULL,
  _category_id uuid DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  _org uuid := public.current_org_id();
  _old public.financial_transactions%ROWTYPE;
  _user_email text;
BEGIN
  IF _org IS NULL OR NOT public.can('caixa', 'edit') THEN
    RAISE EXCEPTION 'Você não tem permissão para editar lançamentos.';
  END IF;

  SELECT * INTO _old FROM public.financial_transactions
  WHERE id = _id AND organization_id = _org
  FOR UPDATE;

  IF _old.id IS NULL THEN
    RAISE EXCEPTION 'Lançamento não encontrado.';
  END IF;

  IF _old.source_type IS NOT NULL THEN
    RAISE EXCEPTION 'Este lançamento veio de um recebimento ou repasse. Estorne a operação de origem em vez de editar o caixa.';
  END IF;

  IF NULLIF(btrim(_description), '') IS NULL THEN
    RAISE EXCEPTION 'Informe a descrição do lançamento.';
  END IF;

  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'Informe um valor maior que zero.';
  END IF;

  IF _date IS NULL THEN
    RAISE EXCEPTION 'Informe a data do lançamento.';
  END IF;

  IF _status = 'pago' AND _bank_account_id IS NULL THEN
    RAISE EXCEPTION 'Informe a conta bancária do lançamento já pago.';
  END IF;

  UPDATE public.financial_transactions SET
    type = _type::public.tx_type,
    description = btrim(_description),
    amount = _amount,
    status = _status::public.tx_status,
    -- Pago guarda a data do pagamento; previsto guarda só o vencimento.
    paid_on = CASE WHEN _status = 'pago' THEN _date ELSE NULL END,
    due_date = _date,
    competence_date = _date,
    payment_method = NULLIF(btrim(_payment_method), ''),
    bank_account_id = _bank_account_id,
    category_id = _category_id,
    notes = NULLIF(btrim(_notes), ''),
    updated_at = now()
  WHERE id = _id;

  SELECT email INTO _user_email FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (
    organization_id, user_id, user_email, action, table_name, record_id,
    old_values, new_values
  ) VALUES (
    _org, auth.uid(), _user_email, 'editar_lancamento', 'financial_transactions', _id,
    jsonb_build_object(
      'tipo', _old.type, 'descricao', _old.description, 'valor', _old.amount,
      'situacao', _old.status, 'pago_em', _old.paid_on, 'vencimento', _old.due_date,
      'forma_pagamento', _old.payment_method
    ),
    jsonb_build_object(
      'tipo', _type, 'descricao', btrim(_description), 'valor', _amount,
      'situacao', _status, 'data', _date, 'forma_pagamento', _payment_method
    )
  );
END;
$fn$;

-- ============================================================
-- 3) Excluir um lançamento manual.
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_manual_transaction(_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  _org uuid := public.current_org_id();
  _old public.financial_transactions%ROWTYPE;
  _user_email text;
BEGIN
  IF _org IS NULL OR NOT public.can('caixa', 'delete') THEN
    RAISE EXCEPTION 'Você não tem permissão para excluir lançamentos.';
  END IF;

  SELECT * INTO _old FROM public.financial_transactions
  WHERE id = _id AND organization_id = _org
  FOR UPDATE;

  IF _old.id IS NULL THEN
    RAISE EXCEPTION 'Lançamento não encontrado.';
  END IF;

  IF _old.source_type IS NOT NULL THEN
    RAISE EXCEPTION 'Este lançamento veio de um recebimento ou repasse. Estorne a operação de origem em vez de apagar o caixa.';
  END IF;

  -- O histórico do que foi apagado fica inteiro no log de auditoria: um
  -- lançamento pago já entrou em fechamento e não pode simplesmente sumir
  -- sem deixar rastro.
  SELECT email INTO _user_email FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (
    organization_id, user_id, user_email, action, table_name, record_id, old_values
  ) VALUES (
    _org, auth.uid(), _user_email, 'excluir_lancamento', 'financial_transactions', _id,
    jsonb_build_object(
      'tipo', _old.type, 'descricao', _old.description, 'valor', _old.amount,
      'situacao', _old.status, 'pago_em', _old.paid_on, 'vencimento', _old.due_date,
      'forma_pagamento', _old.payment_method, 'conta', _old.bank_account_id,
      'categoria', _old.category_id, 'observacoes', _old.notes,
      'recorrencia', _old.recurrence_group_id
    )
  );

  DELETE FROM public.financial_transactions WHERE id = _id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.update_manual_transaction(
  uuid, text, text, numeric, text, date, text, uuid, uuid, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_manual_transaction(
  uuid, text, text, numeric, text, date, text, uuid, uuid, text
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.delete_manual_transaction(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_manual_transaction(uuid) TO authenticated;
