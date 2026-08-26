-- Nomes/empresas que costumam pagar em nome do cliente. Resolve o caso comum
-- de um pagamento chegar com um nome diferente do cliente cadastrado (ex.:
-- cônjuge, familiar, empresa) e ninguém conseguir identificar de quem é.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS payer_names text[] NOT NULL DEFAULT '{}';

-- A assinatura da função ganhou um parâmetro novo (_payer_names): remove a
-- versão antiga primeiro para não deixar as duas coexistindo como funções
-- sobrecarregadas (mesmo nome, quantidade de parâmetros diferente).
DROP FUNCTION IF EXISTS public.create_client_with_payment_account(
  text, text, text, text, text, text, text, text, text, text, text, text
);

-- Permite cadastrar os pagadores já na criação do cliente, na mesma
-- transação atômica usada para o cliente e a forma de recebimento.
CREATE OR REPLACE FUNCTION public.create_client_with_payment_account(
  _name text,
  _tax_id text DEFAULT NULL,
  _phone text DEFAULT NULL,
  _email text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _pix_key_type text DEFAULT NULL,
  _pix_key text DEFAULT NULL,
  _bank text DEFAULT NULL,
  _branch text DEFAULT NULL,
  _account text DEFAULT NULL,
  _holder_name text DEFAULT NULL,
  _holder_tax_id text DEFAULT NULL,
  _payer_names text[] DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _organization_id uuid := public.current_org_id();
  _client_id uuid;
  _user_email text;
BEGIN
  IF _organization_id IS NULL OR NOT public.can_write() THEN
    RAISE EXCEPTION 'Usuário sem permissão para cadastrar clientes.';
  END IF;

  IF NULLIF(btrim(_name), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o nome do cliente.';
  END IF;

  INSERT INTO public.clients (
    organization_id, created_by, name, tax_id, phone, email, notes, payer_names
  ) VALUES (
    _organization_id,
    auth.uid(),
    btrim(_name),
    NULLIF(btrim(_tax_id), ''),
    NULLIF(btrim(_phone), ''),
    NULLIF(btrim(_email), ''),
    NULLIF(btrim(_notes), ''),
    COALESCE(_payer_names, '{}')
  )
  RETURNING id INTO _client_id;

  IF COALESCE(
    NULLIF(btrim(_pix_key), ''),
    NULLIF(btrim(_bank), ''),
    NULLIF(btrim(_account), '')
  ) IS NOT NULL THEN
    INSERT INTO public.client_payment_accounts (
      organization_id, client_id, created_by,
      pix_key_type, pix_key, bank, branch, account,
      holder_name, holder_tax_id
    ) VALUES (
      _organization_id, _client_id, auth.uid(),
      NULLIF(btrim(_pix_key_type), ''), NULLIF(btrim(_pix_key), ''),
      NULLIF(btrim(_bank), ''), NULLIF(btrim(_branch), ''),
      NULLIF(btrim(_account), ''), NULLIF(btrim(_holder_name), ''),
      NULLIF(btrim(_holder_tax_id), '')
    );
  END IF;

  SELECT email INTO _user_email FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (
    organization_id, user_id, user_email, action, table_name, record_id
  ) VALUES (
    _organization_id, auth.uid(), _user_email, 'criar_cliente', 'clients', _client_id
  );

  RETURN _client_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_client_with_payment_account(
  text, text, text, text, text, text, text, text, text, text, text, text, text[]
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_client_with_payment_account(
  text, text, text, text, text, text, text, text, text, text, text, text, text[]
) TO authenticated;
