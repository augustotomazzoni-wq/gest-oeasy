/**
 * Decide se um cliente que está chegando (da planilha ou da Advbox) é
 * alguém que já está cadastrado.
 *
 * A ordem de confiança é: o id da Advbox, depois o CPF/CNPJ, e só por
 * último o nome. O nome sozinho é uma pista fraca — duas clientes podem se
 * chamar igual — então ele só vale quando não há como confundir:
 *
 *  - Se quem chega tem CPF e a cadastrada com o mesmo nome tem OUTRO CPF,
 *    são duas pessoas. Antes isso as fundia numa só.
 *  - Se há mais de uma cadastrada com o mesmo nome e nenhum documento
 *    desempata, não dá para saber qual é. Em vez de escolher uma no
 *    escuro, a linha fica de fora e a pessoa é avisada.
 */

export type ClienteConhecido = {
  id: string;
  name: unknown;
  tax_id: unknown;
  advbox_id?: unknown;
};

export type Reconhecimento = { tipo: "achou"; id: string } | { tipo: "novo" } | { tipo: "ambiguo" };

function somenteDigitos(v: unknown): string {
  return String(v ?? "").replace(/\D+/g, "");
}

/** Nome sem acento, sem espaço dobrado e em minúsculas, só para comparar. */
export function chaveNome(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function criarReconhecedor(cadastrados: ClienteConhecido[]) {
  const porAdvbox = new Map<number, string>();
  const porCpf = new Map<string, string>();
  const porNome = new Map<string, { id: string; cpf: string }[]>();

  function registrar(id: string, advboxId: unknown, taxId: unknown, nome: unknown) {
    if (typeof advboxId === "number") porAdvbox.set(advboxId, id);
    const cpf = somenteDigitos(taxId);
    if (cpf) porCpf.set(cpf, id);
    const chave = chaveNome(nome);
    if (!chave) return;
    const lista = porNome.get(chave) ?? [];
    const atual = lista.find((c) => c.id === id);
    if (atual) atual.cpf = cpf || atual.cpf;
    else lista.push({ id, cpf });
    porNome.set(chave, lista);
  }

  for (const c of cadastrados) registrar(c.id, c.advbox_id, c.tax_id, c.name);

  function reconhecer(advboxId: unknown, taxId: unknown, nome: unknown): Reconhecimento {
    if (typeof advboxId === "number") {
      const id = porAdvbox.get(advboxId);
      if (id) return { tipo: "achou", id };
    }

    const cpf = somenteDigitos(taxId);
    if (cpf) {
      const id = porCpf.get(cpf);
      if (id) return { tipo: "achou", id };
    }

    const homonimos = porNome.get(chaveNome(nome)) ?? [];
    // Quem chega com CPF só pode ser uma cadastrada que ainda não tem
    // documento: as que têm outro CPF são outra pessoa.
    const candidatos = cpf ? homonimos.filter((c) => !c.cpf) : homonimos;
    if (candidatos.length === 1) return { tipo: "achou", id: candidatos[0]!.id };
    if (candidatos.length > 1) return { tipo: "ambiguo" };
    return { tipo: "novo" };
  }

  return { reconhecer, registrar };
}
