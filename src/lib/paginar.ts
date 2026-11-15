/**
 * Busca todas as linhas de uma consulta, e não só as mil primeiras.
 *
 * O banco devolve no máximo mil linhas por pedido e não avisa quando corta.
 * Uma tela que soma lançamentos passaria a somar só os mil primeiros no dia
 * em que o caixa crescesse — o número encolheria sem erro nenhum, e ninguém
 * teria como saber. Aqui a consulta é repetida, de mil em mil, até acabar.
 *
 * A consulta precisa ter uma ordem definida (`.order(...)`), senão as
 * páginas podem repetir ou pular linhas.
 *
 * Uso: `todas(supabase.from("x").select("*").order("id"))` no lugar de
 * `supabase.from("x").select("*")`. O que volta tem o mesmo formato.
 */

const POR_PAGINA = 1000;

/** Trava de segurança: duzentas páginas são duzentas mil linhas. */
const MAX_PAGINAS = 200;

type Resposta<T, E> = { data: T[] | null; error: E | null };

type Paginavel<T, E> = PromiseLike<Resposta<T, E>> & {
  range: (de: number, ate: number) => unknown;
};

export async function todas<T, E>(consulta: Paginavel<T, E>): Promise<Resposta<T, E>> {
  const linhas: T[] = [];

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina += 1) {
    const de = pagina * POR_PAGINA;
    // O construtor de consulta do Supabase pode ser disparado mais de uma
    // vez: `range` só troca o recorte e cada `await` faz um pedido novo.
    consulta.range(de, de + POR_PAGINA - 1);
    const { data, error } = await consulta;
    if (error) return { data: null, error };
    const lote = data ?? [];
    linhas.push(...lote);
    if (lote.length < POR_PAGINA) break;
  }

  return { data: linhas, error: null };
}
