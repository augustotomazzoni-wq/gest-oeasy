type PgError = { code?: string; message?: string };

const PG_CODE_MESSAGES: Record<string, string> = {
  "23505": "Já existe um registro com esses dados.",
  "23503": "Este registro está vinculado a outro cadastro e não pode ser salvo ou excluído assim.",
  "23502": "Preencha todos os campos obrigatórios.",
  "23514": "Os valores informados não são válidos — confira os totais e os sinais.",
  "42501": "Você não tem permissão para realizar esta ação.",
};

/**
 * Traduz erros do Postgres/Supabase (identificados pelo código SQLSTATE) para
 * mensagens em português que fazem sentido para quem opera o escritório.
 * Erros sem código vêm de validações do próprio app (Error simples lançado
 * antes da rede) e já estão escritos para o usuário — são exibidos como estão.
 */
export function friendlyError(e: unknown): string {
  const err = e as PgError | Error | null | undefined;
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const code = (err as PgError | null | undefined)?.code;

  if (code && PG_CODE_MESSAGES[code]) return PG_CODE_MESSAGES[code];
  if (/row-level security policy/i.test(raw))
    return "Você não tem permissão para realizar esta ação.";
  if (/failed to fetch|network ?error/i.test(raw))
    return "Falha de conexão. Verifique a internet e tente novamente.";
  if (/jwt expired|invalid.*token/i.test(raw))
    return "Sua sessão expirou. Atualize a página e entre novamente.";

  if (!code) return raw || "Não foi possível concluir a ação.";

  return "Não foi possível concluir a ação. Tente novamente ou avise o suporte técnico.";
}
