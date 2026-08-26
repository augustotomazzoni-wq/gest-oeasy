-- Campos equivalentes aos das planilhas do Advbox, para que a importação e a
-- exportação usem exatamente o mesmo formato e nada se perca no caminho.
-- Todos são opcionais: quem cadastra preenche só o que tiver.

-- ============================================================
-- CLIENTES
-- ============================================================
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS rg text,
  ADD COLUMN IF NOT EXISTS birth_date date,
  ADD COLUMN IF NOT EXISTS marital_status text,
  ADD COLUMN IF NOT EXISTS pis_pasep text,
  ADD COLUMN IF NOT EXISTS ctps text,
  ADD COLUMN IF NOT EXISTS cid text,
  ADD COLUMN IF NOT EXISTS occupation text,
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS phone_secondary text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS district text,
  ADD COLUMN IF NOT EXISTS zip_code text,
  ADD COLUMN IF NOT EXISTS mother_name text,
  ADD COLUMN IF NOT EXISTS source text;

-- Busca por nome, CPF/CNPJ e cidade fica rápida mesmo com a base cheia.
CREATE INDEX IF NOT EXISTS clients_tax_digits_idx
  ON public.clients (regexp_replace(COALESCE(tax_id, ''), '[^0-9]', '', 'g'));

-- ============================================================
-- PROCESSOS
-- ============================================================
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS action_group text,
  ADD COLUMN IF NOT EXISTS judicial_phase text,
  ADD COLUMN IF NOT EXISTS stage text,
  ADD COLUMN IF NOT EXISTS protocol_number text,
  ADD COLUMN IF NOT EXISTS original_case text,
  ADD COLUMN IF NOT EXISTS folder text,
  ADD COLUMN IF NOT EXISTS case_year text,
  ADD COLUMN IF NOT EXISTS request_date date,
  ADD COLUMN IF NOT EXISTS segment text,
  ADD COLUMN IF NOT EXISTS county text,
  ADD COLUMN IF NOT EXISTS court_division text,
  ADD COLUMN IF NOT EXISTS closing_date date,
  ADD COLUMN IF NOT EXISTS res_judicata_date date,
  ADD COLUMN IF NOT EXISTS archived_date date,
  ADD COLUMN IF NOT EXISTS case_result text,
  ADD COLUMN IF NOT EXISTS claim_value numeric(14,2),
  ADD COLUMN IF NOT EXISTS fee_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS fee_percent numeric(7,4),
  ADD COLUMN IF NOT EXISTS contingency text,
  ADD COLUMN IF NOT EXISTS last_movement text;

ALTER TABLE public.cases
  ADD CONSTRAINT cases_values_nonnegative_check CHECK (
    (claim_value IS NULL OR claim_value >= 0)
    AND (fee_amount IS NULL OR fee_amount >= 0)
    AND (fee_percent IS NULL OR (fee_percent >= 0 AND fee_percent <= 100))
  ) NOT VALID;
