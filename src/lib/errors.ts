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
/** Mensagens do Supabase Auth, que vêm sempre em inglês. */
const AUTH_MESSAGES: [RegExp, string][] = [
  [/invalid login credentials/i, "E-mail ou senha incorretos."],
  [/email not confirmed/i, "Confirme seu e-mail antes de entrar."],
  [/user already registered|already been registered/i, "Já existe um usuário com esse e-mail."],
  [/password should be at least/i, "A senha deve ter ao menos 8 caracteres."],
  [/unable to validate email|invalid email/i, "E-mail inválido."],
  [/email rate limit|too many requests/i, "Muitas tentativas. Espere alguns minutos."],
];

export function friendlyError(e: unknown): string {
  const err = e as PgError | Error | null | undefined;
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const code = (err as PgError | null | undefined)?.code;

  for (const [pattern, message] of AUTH_MESSAGES) {
    if (pattern.test(raw)) return message;
  }

  if (code && PG_CODE_MESSAGES[code]) return PG_CODE_MESSAGES[code];

  // P0001/P0002 são os códigos de RAISE EXCEPTION do Postgres: as travas do
  // próprio sistema (sobrepagamento de parcela, proteção do administrador
  // principal, permissão negada nas funções). Essas mensagens já foram
  // escritas em português para quem opera — mostrar o texto original.
  if (code === "P0001" || code === "P0002") {
    return raw || "Não foi possível concluir a ação.";
  }

  // O banco está desatualizado em relação ao app: a tela chama uma função ou
  // coluna que a migration correspondente ainda não criou. Sem esta mensagem
  // o usuário via só "avise o suporte", sem pista do que fazer.
  if (code === "PGRST202" || /could not find the function/i.test(raw)) {
    return "O banco de dados está desatualizado: falta aplicar a última migration do Supabase. Avise o responsável técnico.";
  }
  if (code === "PGRST203" || /could not choose the best candidate function/i.test(raw)) {
    return "O banco de dados tem duas versões da mesma função. É preciso remover a versão antiga no Supabase.";
  }
  if (code === "PGRST204" || /could not find the '.*' column/i.test(raw)) {
    return "O banco de dados está desatualizado: falta uma coluna criada pela última migration. Avise o responsável técnico.";
  }

  if (/row-level security policy/i.test(raw))
    return "Você não tem permissão para realizar esta ação.";
  if (/failed to fetch|network ?error/i.test(raw))
    return "Falha de conexão. Verifique a internet e tente novamente.";
  if (/jwt expired|invalid.*token/i.test(raw))
    return "Sua sessão expirou. Atualize a página e entre novamente.";

  if (!code) return raw || "Não foi possível concluir a ação.";

  return "Não foi possível concluir a ação. Tente novamente ou avise o suporte técnico.";
}

/**
 * Levanta o primeiro erro de um conjunto de consultas feitas em paralelo.
 *
 * As telas disparam de quatro a sete consultas num `Promise.all` e quase
 * sempre conferiam o erro de uma só. Quando outra falhava, ela virava lista
 * vazia em silêncio: a tela abria com números errados ou seções vazias, sem
 * nada indicando que faltou dado. Foi assim que uma coluna que não existia numa
 * view apareceu como "este acordo não tem parcelas".
 */
export function throwFirstError(...results: { error: unknown }[]): void {
  for (const result of results) {
    if (result.error) throw result.error;
  }
}
