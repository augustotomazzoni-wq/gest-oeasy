-- A view das parcelas não estava enxergando a coluna de origem.
--
-- `v_installments` é definida com `SELECT i.*`, e o Postgres congela essa
-- lista de colunas no momento em que a view é criada. A view foi criada em
-- 26/08; a coluna `stream` (de onde vem a parcela: cliente, empresa ou
-- sucumbência) entrou na tabela em 29/08. Resultado: a coluna existe na
-- tabela e não existe na view.
--
-- Dois efeitos disso:
--
-- 1. A tela de edição do acordo pedia `stream` por nome e recebia erro do
--    PostgREST, o que deixava o cronograma aparecendo vazio.
-- 2. Em Parcelas, que lê com `select("*")` e por isso não dava erro, as
--    etiquetas "sucumbência" e "a empresa paga" nunca apareciam — a coluna
--    simplesmente não vinha.
--
-- `CREATE OR REPLACE VIEW` não resolve: ele só aceita acrescentar colunas no
-- fim, e `i.*` insere a nova no meio da lista. Por isso a view é derrubada e
-- refeita. A definição abaixo é a mesma de antes, sem nenhuma outra mudança.

DROP VIEW IF EXISTS public.v_installments;

CREATE VIEW public.v_installments
WITH (security_invoker = true) AS
SELECT i.*,
  r.client_id, r.case_id, r.type AS receivable_type, r.status AS receivable_status,
  r.is_estimated,
  COALESCE(rc.paid_total,0) AS paid_total,
  COALESCE(rc.paid_fee,0) AS paid_fee,
  COALESCE(rc.paid_success_fee,0) AS paid_success_fee,
  COALESCE(rc.paid_client,0) AS paid_client,
  (i.gross_amount - COALESCE(rc.paid_total,0)) AS balance,
  CASE
    WHEN i.canceled_at IS NOT NULL THEN 'CANCELADA'
    WHEN i.gross_amount - COALESCE(rc.paid_total,0) <= 0.01
         AND COALESCE(rc.paid_total,0) > 0 THEN 'PAGA'
    WHEN i.due_date IS NOT NULL AND i.due_date < current_date THEN 'ATRASADA'
    WHEN COALESCE(rc.paid_total,0) > 0.01 THEN 'PARCIAL'
    WHEN i.due_date IS NULL THEN 'A_DEFINIR'
    WHEN i.due_date = current_date THEN 'VENCE_HOJE'
    ELSE 'A_VENCER'
  END AS status,
  COALESCE(rc.paid_cost_reimbursement,0) AS paid_cost_reimbursement,
  r.flow AS payment_flow
FROM public.installments i
JOIN public.legal_receivables r ON r.id = i.receivable_id
LEFT JOIN (
  SELECT installment_id,
         sum(total_amount) paid_total,
         sum(fee_amount) paid_fee,
         sum(success_fee_amount) paid_success_fee,
         sum(client_amount) paid_client,
         sum(cost_reimbursement) paid_cost_reimbursement
  FROM public.receipts
  WHERE reversed_at IS NULL
  GROUP BY installment_id
) rc ON rc.installment_id = i.id;

-- A permissão de leitura vai junto: derrubar a view leva o GRANT antigo.
GRANT SELECT ON public.v_installments TO authenticated;
