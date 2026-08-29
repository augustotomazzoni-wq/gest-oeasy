-- Apagar um acordo levando junto parcelas, recebimentos e repasses.
--
-- Hoje só existe delete_canceled_receivable, que exige cancelar antes e é
-- restrita ao Administrador Principal pelo e-mail. Esta versão apaga direto,
-- em cascata, e é controlada por permissão — o Administrador libera para
-- quem quiser na tela Usuários e Perfis de Acesso.

-- ============================================================
-- 1) Permissão "Excluir" no módulo Acordos.
--    Nasce ligada só para o Administrador Principal.
-- ============================================================
INSERT INTO public.role_permissions (organization_id, role_code, module, action, allowed)
SELECT o.id, r.role_code, 'acordos', 'delete', r.allowed
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
ON CONFLICT (organization_id, role_code, module, action) DO NOTHING;

UPDATE public.role_permissions
SET allowed = false, updated_at = now()
WHERE module = 'acordos' AND action = 'delete' AND role_code <> 'admin' AND allowed;

-- ============================================================
-- 2) Apagar o acordo inteiro.
--
--    A trava: dinheiro que já entrou ou saiu não some por aqui. Apagar um
--    acordo com recebimento válido apagaria também o lançamento espelhado no
--    caixa, e o saldo do banco de um mês fechado mudaria sozinho. Nesses
--    casos o caminho é estornar o recebimento antes — aí o acordo fica limpo
--    e pode ser apagado.
--
--    O que foi apagado fica inteiro no log de auditoria.
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_receivable(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  _org uuid := public.current_org_id();
  _old public.legal_receivables%ROWTYPE;
  _recebido numeric;
  _repasses_pagos integer;
  _n_parcelas integer;
  _n_recebimentos integer;
  _n_repasses integer;
  _snapshot jsonb;
  _user_email text;
BEGIN
  IF _org IS NULL OR NOT public.can('acordos', 'delete') THEN
    RAISE EXCEPTION 'Você não tem permissão para excluir acordos.';
  END IF;

  SELECT * INTO _old FROM public.legal_receivables
  WHERE id = _id AND organization_id = _org FOR UPDATE;

  IF _old.id IS NULL THEN
    RAISE EXCEPTION 'Acordo não encontrado.';
  END IF;

  -- Recebimento válido (não estornado) impede a exclusão.
  SELECT COALESCE(sum(rp.total_amount), 0) INTO _recebido
  FROM public.receipts rp
  JOIN public.installments i ON i.id = rp.installment_id
  WHERE i.receivable_id = _id AND rp.reversed_at IS NULL;

  IF _recebido > 0.01 THEN
    RAISE EXCEPTION 'Este acordo já recebeu %. Estorne os recebimentos antes de apagar — senão o caixa e o saldo do banco mudariam sozinhos.', _recebido;
  END IF;

  -- Repasse já pago também é dinheiro que saiu de verdade.
  SELECT count(*) INTO _repasses_pagos
  FROM public.client_transfers t
  WHERE t.organization_id = _org
    AND t.status = 'pago'
    AND (
      t.receivable_id = _id
      OR t.receipt_id IN (
        SELECT rp.id FROM public.receipts rp
        JOIN public.installments i ON i.id = rp.installment_id
        WHERE i.receivable_id = _id
      )
    );

  IF _repasses_pagos > 0 THEN
    RAISE EXCEPTION 'Existem % repasse(s) já pago(s) ligados a este acordo. Cancele-os antes de apagar.', _repasses_pagos;
  END IF;

  -- Fotografia do que vai sumir, para o log de auditoria.
  SELECT
    (SELECT count(*) FROM public.installments WHERE receivable_id = _id),
    (SELECT count(*) FROM public.receipts rp
      JOIN public.installments i ON i.id = rp.installment_id
      WHERE i.receivable_id = _id),
    (SELECT count(*) FROM public.client_transfers t
      WHERE t.organization_id = _org
        AND (t.receivable_id = _id
          OR t.receipt_id IN (
            SELECT rp.id FROM public.receipts rp
            JOIN public.installments i ON i.id = rp.installment_id
            WHERE i.receivable_id = _id)))
    INTO _n_parcelas, _n_recebimentos, _n_repasses;

  _snapshot := jsonb_build_object(
    'acordo', to_jsonb(_old),
    'parcelas', (SELECT coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb)
                 FROM public.installments i WHERE i.receivable_id = _id),
    'recebimentos', (SELECT coalesce(jsonb_agg(to_jsonb(rp)), '[]'::jsonb)
                     FROM public.receipts rp
                     JOIN public.installments i ON i.id = rp.installment_id
                     WHERE i.receivable_id = _id),
    'repasses', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
                 FROM public.client_transfers t
                 WHERE t.organization_id = _org
                   AND (t.receivable_id = _id
                     OR t.receipt_id IN (
                       SELECT rp.id FROM public.receipts rp
                       JOIN public.installments i ON i.id = rp.installment_id
                       WHERE i.receivable_id = _id)))
  );

  -- Do filho para o pai. Os gatilhos limpam sozinhos os lançamentos
  -- espelhados no caixa quando o recebimento e o repasse são apagados.
  DELETE FROM public.client_transfers t
  WHERE t.organization_id = _org
    AND (
      t.receivable_id = _id
      OR t.receipt_id IN (
        SELECT rp.id FROM public.receipts rp
        JOIN public.installments i ON i.id = rp.installment_id
        WHERE i.receivable_id = _id
      )
    );

  DELETE FROM public.receipts
  WHERE installment_id IN (SELECT id FROM public.installments WHERE receivable_id = _id);

  DELETE FROM public.installments WHERE receivable_id = _id;
  DELETE FROM public.legal_receivables WHERE id = _id;

  SELECT email INTO _user_email FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (
    organization_id, user_id, user_email, action, table_name, record_id, old_values
  ) VALUES (
    _org, auth.uid(), _user_email, 'excluir_acordo', 'legal_receivables', _id, _snapshot
  );

  RETURN jsonb_build_object(
    'parcelas', _n_parcelas,
    'recebimentos', _n_recebimentos,
    'repasses', _n_repasses
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.delete_receivable(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_receivable(uuid) TO authenticated;
