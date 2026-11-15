/**
 * Puxa clientes e processos da Advbox.
 *
 * Roda só no servidor. O token nunca sai daqui: o navegador pede
 * "atualiza", o servidor busca na Advbox e grava no banco, e o que volta
 * para a tela é só o resumo do que entrou.
 *
 * Regra de ouro da atualização: a Advbox COMPLETA o cadastro, não o
 * substitui. Campo que vem vazio de lá não apaga o que já existe aqui —
 * a Advbox não guarda nome da mãe, comarca, vara, parte contrária nem
 * resultado do processo, e esses campos são preenchidos à mão aqui
 * dentro. Se a atualização gravasse vazio por cima, perderia tudo isso.
 *
 * A gravação é em lote de propósito. O aplicativo é publicado em
 * Cloudflare, que limita quantas chamadas externas cabem numa única
 * requisição; uma gravação por cliente esbarraria nesse limite conforme a
 * base crescesse. Em lote, a base inteira cabe em poucas chamadas.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { todas } from "@/lib/paginar";
import { chaveNome, criarReconhecedor } from "@/lib/reconhecer-cliente";

const BASE = "https://app.advbox.com.br/api/v1";

/** A Advbox devolve no máximo mil por vez. */
const POR_PAGINA = 1000;

/** Trava de segurança: 30 páginas são 30 mil registros, muito além da base. */
const MAX_PAGINAS = 30;

/** A Advbox aceita 30 consultas por minuto; esperar entre páginas evita o 429. */
const PAUSA_ENTRE_PAGINAS_MS = 2100;

/** Quantas linhas vão por gravação. */
const LOTE = 200;

// ============================================================
// O formato que a Advbox devolve
// ============================================================

type AdvCliente = {
  id: number;
  name?: string | null;
  /** CPF ou CNPJ, com ou sem pontuação. */
  identification?: string | null;
  /** Campo livre de documento — é onde a Advbox guarda o RG. */
  document?: string | null;
  cellphone?: string | null;
  gender?: string | null;
  civil_status?: string | null;
  phone?: string | null;
  email?: string | null;
  occupation?: string | null;
  street?: string | null;
  postalcode?: string | null;
  /** Bairro. */
  region?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  /** Vem como DD/MM/AAAA. */
  birthdate?: string | null;
  number_ctps?: string | null;
  number_pis?: string | null;
  number_cid?: string | null;
  notes?: string | null;
  origin?: string | null;
};

type AdvProcesso = {
  id: number;
  process_number?: string | null;
  protocol_number?: string | null;
  folder?: string | null;
  process_date?: string | null;
  /** Expectativa / valor da causa. */
  fees_expec?: number | string | null;
  /** Honorários fechados em dinheiro. */
  fees_money?: number | string | null;
  contingency?: string | null;
  type?: string | null;
  group?: string | null;
  status_closure?: string | null;
  /** Trânsito em julgado. */
  exit_production?: string | null;
  /** Arquivamento. */
  exit_execution?: string | null;
  responsible?: string | null;
  /** Fase processual ("FASE INSTRUTORIA"). */
  stage?: string | null;
  /** Etapa ("JUDICIAL", "EXTRAJUDICIAL"). */
  step?: string | null;
  notes?: string | null;
  customers?: Array<{
    customer_id?: number | null;
    name?: string | null;
    identification?: string | null;
  }> | null;
};

export type ResultadoSync = {
  criados: number;
  atualizados: number;
  clientesCriados: number;
  lidosDaAdvbox: number;
  avisos: string[];
};

type Linha = Record<string, unknown>;

// ============================================================
// Conversões
// ============================================================

function texto(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

/**
 * A Advbox manda data em dois formatos conforme o campo: AAAA-MM-DD nos
 * processos e DD/MM/AAAA no aniversário. Aceita os dois.
 */
function paraISO(v: unknown): string | null {
  const s = texto(v);
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return null;
}

function paraNumero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = texto(v);
  if (!s) return null;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Junta o que veio da Advbox com o que já existe aqui, campo a campo:
 * vale o da Advbox quando tem conteúdo, senão fica o daqui. É isto que
 * impede a atualização de apagar o que foi digitado à mão.
 *
 * Todas as linhas saem com exatamente as mesmas colunas — é o que permite
 * gravar o lote inteiro de uma vez.
 */
function mesclar(colunas: readonly string[], daAdvbox: Linha, daqui: Linha | undefined): Linha {
  const saida: Linha = {};
  for (const col of colunas) {
    const novo = daAdvbox[col];
    saida[col] = novo === null || novo === undefined || novo === "" ? (daqui?.[col] ?? null) : novo;
  }
  return saida;
}

/** Quebra a lista em pedaços para não mandar tudo numa requisição só. */
function emLotes<T>(lista: T[], tamanho = LOTE): T[][] {
  const partes: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) partes.push(lista.slice(i, i + tamanho));
  return partes;
}

// ============================================================
// A conversa com a Advbox
// ============================================================

function erroDaAdvbox(status: number): string {
  if (status === 401 || status === 403) {
    return "A Advbox recusou o token. Confira em Configurações se ele foi copiado inteiro e se continua válido lá.";
  }
  if (status === 429) {
    return "A Advbox limitou as consultas por excesso de pedidos. Espere um minuto e atualize de novo.";
  }
  if (status >= 500) {
    return `A Advbox está fora do ar no momento (erro ${status}). Tente de novo daqui a pouco.`;
  }
  return `A Advbox respondeu com erro ${status}.`;
}

async function buscarTudo<T>(caminho: string, token: string): Promise<T[]> {
  const itens: T[] = [];

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina += 1) {
    if (pagina > 0) await new Promise((r) => setTimeout(r, PAUSA_ENTRE_PAGINAS_MS));

    const url = `${BASE}${caminho}?limit=${POR_PAGINA}&offset=${pagina * POR_PAGINA}`;
    let resposta: Response;
    try {
      resposta = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(90_000),
      });
    } catch {
      throw new Error("Não foi possível falar com a Advbox. Verifique a conexão e tente de novo.");
    }

    if (!resposta.ok) throw new Error(erroDaAdvbox(resposta.status));

    const corpo = (await resposta.json()) as { data?: T[] } | T[];
    const lote = Array.isArray(corpo) ? corpo : (corpo.data ?? []);
    itens.push(...lote);
    if (lote.length < POR_PAGINA) break;
  }

  return itens;
}

// ============================================================
// Token e estado da integração
// ============================================================

async function lerToken(organizationId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("advbox_integracao")
    .select("token, ativo")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    throw new Error(
      "Não foi possível ler a configuração da Advbox. Confira se a atualização do banco já foi aplicada.",
    );
  }
  if (!data?.token) {
    throw new Error(
      "Nenhum token da Advbox foi cadastrado ainda. Vá em Configurações para informar.",
    );
  }
  if (!data.ativo) {
    throw new Error("A integração com a Advbox está desligada em Configurações.");
  }
  return data.token;
}

async function registrarResultado(organizationId: string, resumo: string): Promise<void> {
  await supabaseAdmin
    .from("advbox_integracao")
    .update({
      ultima_sincronizacao: new Date().toISOString(),
      ultimo_resultado: resumo,
    })
    .eq("organization_id", organizationId);
}

/** Confere o token sem mexer em nada: pede uma página mínima de clientes. */
export async function testarToken(token: string): Promise<void> {
  let resposta: Response;
  try {
    resposta = await fetch(`${BASE}/customers?limit=1`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("Não foi possível falar com a Advbox. Verifique a conexão e tente de novo.");
  }
  if (!resposta.ok) throw new Error(erroDaAdvbox(resposta.status));
}

// ============================================================
// Gravação em lote
// ============================================================

/**
 * Grava atualizações e inclusões. No caminho da atualização usa
 * onConflict "id": a linha já existe, então só as colunas enviadas são
 * tocadas e o resto do cadastro fica intacto.
 */
async function gravar(
  tabela: "clients" | "cases",
  atualizacoes: Linha[],
  insercoes: Linha[],
  avisos: string[],
): Promise<Linha[]> {
  for (const lote of emLotes(atualizacoes)) {
    const { error } = await supabaseAdmin.from(tabela).upsert(lote as never, { onConflict: "id" });
    if (error) {
      avisos.push(
        `Um lote de ${lote.length} registro(s) não pôde ser atualizado: ${error.message}`,
      );
    }
  }

  const inseridos: Linha[] = [];
  for (const lote of emLotes(insercoes)) {
    const { data, error } = await supabaseAdmin
      .from(tabela)
      .insert(lote as never)
      .select("id, advbox_id");
    if (error) {
      avisos.push(
        `Um lote de ${lote.length} registro(s) não pôde ser cadastrado: ${error.message}`,
      );
      continue;
    }
    inseridos.push(...((data ?? []) as unknown as Linha[]));
  }

  return inseridos;
}

// ============================================================
// Clientes
// ============================================================

/** As colunas que a Advbox manda. As outras ficam como estão. */
const COLUNAS_CLIENTE = [
  "advbox_id",
  "name",
  "tax_id",
  "rg",
  "birth_date",
  "marital_status",
  "pis_pasep",
  "ctps",
  "cid",
  "occupation",
  "gender",
  "phone",
  "phone_secondary",
  "email",
  "country",
  "state",
  "city",
  "address",
  "district",
  "zip_code",
  "source",
  "notes",
] as const;

function valoresCliente(c: AdvCliente): Linha {
  return {
    advbox_id: c.id,
    name: texto(c.name),
    tax_id: texto(c.identification),
    rg: texto(c.document),
    birth_date: paraISO(c.birthdate),
    marital_status: texto(c.civil_status),
    pis_pasep: texto(c.number_pis),
    ctps: texto(c.number_ctps),
    cid: texto(c.number_cid),
    occupation: texto(c.occupation),
    gender: texto(c.gender),
    // Na Advbox o celular é o contato principal; o fixo fica como segundo.
    phone: texto(c.cellphone),
    phone_secondary: texto(c.phone),
    email: texto(c.email),
    country: texto(c.country),
    state: texto(c.state),
    city: texto(c.city),
    address: texto(c.street),
    district: texto(c.region),
    zip_code: texto(c.postalcode),
    source: texto(c.origin),
    notes: texto(c.notes),
  };
}

type ClienteLocal = Linha & { id: string };

async function carregarClientes(organizationId: string): Promise<ClienteLocal[]> {
  const { data, error } = await todas(
    supabaseAdmin
      .from("clients")
      .select(`id, ${COLUNAS_CLIENTE.join(", ")}`)
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .order("id"),
  );
  if (error) throw new Error("Não foi possível ler o cadastro de clientes.");
  return (data ?? []) as unknown as ClienteLocal[];
}

/**
 * Reconhece cliente já cadastrado (regra em reconhecer-cliente.ts) e guarda
 * a linha de cada um, para a mescla saber o que já está preenchido aqui.
 */
function indiceDeClientes(lista: ClienteLocal[]) {
  const reconhecedor = criarReconhecedor(
    lista.map((c) => ({
      id: c.id,
      name: c["name"],
      tax_id: c["tax_id"],
      advbox_id: c["advbox_id"],
    })),
  );
  const porId = new Map(lista.map((c) => [c.id, c]));
  const linhaDe = (id: string): ClienteLocal | undefined => porId.get(id);
  return { achar: reconhecedor.reconhecer, registrar: reconhecedor.registrar, linhaDe };
}

export async function sincronizarClientes(
  organizationId: string,
  userId: string,
): Promise<ResultadoSync> {
  const token = await lerToken(organizationId);
  const vindos = await buscarTudo<AdvCliente>("/customers", token);

  const indice = indiceDeClientes(await carregarClientes(organizationId));

  const atualizacoes: Linha[] = [];
  const insercoes: Linha[] = [];
  const avisos: string[] = [];
  // A Advbox pode trazer o mesmo cadastro em duas entradas; sem isto, o
  // lote tentaria gravar a mesma linha duas vezes e o banco recusaria.
  const jaNoLote = new Set<string>();

  for (const c of vindos) {
    const nome = texto(c.name);
    if (!nome) {
      avisos.push(`Um cadastro da Advbox (id ${c.id}) veio sem nome e foi deixado de fora.`);
      continue;
    }

    const daAdvbox = valoresCliente(c);
    const achado = indice.achar(c.id, c.identification, nome);
    if (achado.tipo === "ambiguo") {
      avisos.push(
        `${nome}: há mais de um cadastro com esse nome e nenhum CPF para desempatar — ficou de fora.`,
      );
      continue;
    }
    const id = achado.tipo === "achou" ? achado.id : undefined;

    if (id) {
      if (jaNoLote.has(id)) continue;
      jaNoLote.add(id);
      atualizacoes.push({
        id,
        organization_id: organizationId,
        ...mesclar(COLUNAS_CLIENTE, daAdvbox, indice.linhaDe(id)),
      });
    } else {
      const marca = `novo:${c.id}`;
      if (jaNoLote.has(marca)) continue;
      jaNoLote.add(marca);
      insercoes.push({
        organization_id: organizationId,
        created_by: userId,
        ...mesclar(COLUNAS_CLIENTE, daAdvbox, undefined),
      });
    }
  }

  await gravar("clients", atualizacoes, insercoes, avisos);

  const resumo = `Clientes: ${insercoes.length} cadastrado(s), ${atualizacoes.length} atualizado(s).`;
  await registrarResultado(organizationId, resumo);
  await registrarAuditoria(
    organizationId,
    userId,
    "clients",
    "sincronizar_advbox_clientes",
    resumo,
  );

  return {
    criados: insercoes.length,
    atualizados: atualizacoes.length,
    clientesCriados: 0,
    lidosDaAdvbox: vindos.length,
    avisos,
  };
}

// ============================================================
// Processos
// ============================================================

const COLUNAS_PROCESSO = [
  "advbox_id",
  "client_id",
  "case_number",
  "protocol_number",
  "folder",
  "request_date",
  "claim_value",
  "fee_amount",
  "contingency",
  "action_type",
  "action_group",
  "practice_area",
  "judicial_phase",
  "stage",
  "responsible_lawyer",
  "closing_date",
  "res_judicata_date",
  "archived_date",
  "notes",
] as const;

function valoresProcesso(p: AdvProcesso, clientId: string): Linha {
  return {
    advbox_id: p.id,
    client_id: clientId,
    case_number: texto(p.process_number),
    protocol_number: texto(p.protocol_number),
    folder: texto(p.folder),
    request_date: paraISO(p.process_date),
    // "Expectativa/Valor da causa" e "Valor dos honorários", os mesmos dois
    // campos que a planilha da Advbox traz.
    claim_value: paraNumero(p.fees_expec),
    fee_amount: paraNumero(p.fees_money),
    contingency: texto(p.contingency),
    action_type: texto(p.type),
    action_group: texto(p.group),
    // O grupo da Advbox é o que o dashboard usa como área de atuação.
    practice_area: texto(p.group),
    // Atenção à troca de nomes: o "stage" da Advbox é a fase judicial, e o
    // "step" dela é o que aqui se chama etapa.
    judicial_phase: texto(p.stage),
    stage: texto(p.step),
    responsible_lawyer: texto(p.responsible),
    closing_date: paraISO(p.status_closure),
    res_judicata_date: paraISO(p.exit_production),
    archived_date: paraISO(p.exit_execution),
    notes: texto(p.notes),
  };
}

export async function sincronizarProcessos(
  organizationId: string,
  userId: string,
): Promise<ResultadoSync> {
  const token = await lerToken(organizationId);
  const vindos = await buscarTudo<AdvProcesso>("/lawsuits", token);

  const indiceClientes = indiceDeClientes(await carregarClientes(organizationId));
  const avisos: string[] = [];

  // ---- 1) Os clientes que existem lá e ainda não aqui ----
  // Entram primeiro, numa gravação só, porque o processo precisa do id
  // deles para ser vinculado.
  const faltantes = new Map<number | string, Linha>();
  for (const p of vindos) {
    const titular = (p.customers ?? []).find((c) => texto(c.name));
    if (!titular) continue;
    const nome = texto(titular.name) as string;
    const achado = indiceClientes.achar(titular.customer_id, titular.identification, nome);
    if (achado.tipo !== "novo") continue;
    const chave = titular.customer_id ?? `nome:${chaveNome(nome)}`;
    if (faltantes.has(chave)) continue;
    faltantes.set(chave, {
      organization_id: organizationId,
      created_by: userId,
      advbox_id: titular.customer_id ?? null,
      name: nome,
      tax_id: texto(titular.identification),
      notes: "Cadastrado ao atualizar os processos pela Advbox",
    });
  }

  let clientesCriados = 0;
  if (faltantes.size) {
    const novos = [...faltantes.values()];
    const inseridos = await gravar("clients", [], novos, avisos);
    clientesCriados = inseridos.length;
    // Os recém-criados passam a ser reconhecíveis pelos processos.
    for (const linha of inseridos) {
      const original = novos.find((n) => n["advbox_id"] === linha["advbox_id"]);
      indiceClientes.registrar(
        String(linha["id"]),
        linha["advbox_id"],
        original?.["tax_id"],
        original?.["name"],
      );
    }
  }

  // ---- 2) Os processos ----
  const { data: locais, error: errLocais } = await todas(
    supabaseAdmin
      .from("cases")
      .select(`id, ${COLUNAS_PROCESSO.join(", ")}`)
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .order("id"),
  );
  if (errLocais) throw new Error("Não foi possível ler o cadastro de processos.");

  const porAdvbox = new Map<number, string>();
  const porNumero = new Map<string, string>();
  const porPasta = new Map<string, string>();
  const porId = new Map<string, Linha>();
  for (const k of (locais ?? []) as unknown as Array<Linha & { id: string }>) {
    porId.set(k.id, k);
    if (typeof k["advbox_id"] === "number") porAdvbox.set(k["advbox_id"], k.id);
    const numero = texto(k["case_number"]);
    if (numero) porNumero.set(numero, k.id);
    const pasta = texto(k["folder"]);
    if (pasta) porPasta.set(chaveNome(pasta), k.id);
  }

  const atualizacoes: Linha[] = [];
  const insercoes: Linha[] = [];
  const jaNoLote = new Set<string>();

  for (const p of vindos) {
    const titular = (p.customers ?? []).find((c) => texto(c.name));
    const rotulo = texto(p.process_number) ?? texto(p.folder) ?? `id ${p.id}`;

    if (!titular) {
      avisos.push(
        `Processo ${rotulo}: veio sem cliente vinculado na Advbox e foi deixado de fora.`,
      );
      continue;
    }

    const achado = indiceClientes.achar(
      titular.customer_id,
      titular.identification,
      texto(titular.name),
    );
    if (achado.tipo !== "achou") {
      avisos.push(
        achado.tipo === "ambiguo"
          ? `Processo ${rotulo}: há mais de uma cliente chamada ${texto(titular.name)} e nenhum CPF para desempatar — ficou de fora.`
          : `Processo ${rotulo}: o cliente ${texto(titular.name)} não pôde ser cadastrado.`,
      );
      continue;
    }
    const clientId = achado.id;

    const daAdvbox = valoresProcesso(p, clientId);
    const numero = texto(p.process_number);
    const pasta = texto(p.folder);
    const id =
      porAdvbox.get(p.id) ??
      (numero ? porNumero.get(numero) : undefined) ??
      // Só cai na pasta quando não há número: processo sem número não tem
      // outra marca para ser reconhecido.
      (!numero && pasta ? porPasta.get(chaveNome(pasta)) : undefined);

    if (id) {
      if (jaNoLote.has(id)) continue;
      jaNoLote.add(id);
      atualizacoes.push({
        id,
        organization_id: organizationId,
        ...mesclar(COLUNAS_PROCESSO, daAdvbox, porId.get(id)),
      });
    } else {
      const marca = `novo:${p.id}`;
      if (jaNoLote.has(marca)) continue;
      jaNoLote.add(marca);
      insercoes.push({
        organization_id: organizationId,
        created_by: userId,
        ...mesclar(COLUNAS_PROCESSO, daAdvbox, undefined),
      });
    }
  }

  await gravar("cases", atualizacoes, insercoes, avisos);

  const resumo = `Processos: ${insercoes.length} cadastrado(s), ${atualizacoes.length} atualizado(s).`;
  await registrarResultado(organizationId, resumo);
  await registrarAuditoria(organizationId, userId, "cases", "sincronizar_advbox_processos", resumo);

  return {
    criados: insercoes.length,
    atualizados: atualizacoes.length,
    clientesCriados,
    lidosDaAdvbox: vindos.length,
    avisos,
  };
}

// ============================================================
// Registro
// ============================================================

async function registrarAuditoria(
  organizationId: string,
  userId: string,
  tabela: string,
  acao: string,
  resumo: string,
): Promise<void> {
  const { data: perfil } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle();

  await supabaseAdmin.from("audit_logs").insert({
    organization_id: organizationId,
    user_id: userId,
    user_email: perfil?.email ?? null,
    action: acao,
    table_name: tabela,
    new_values: { resultado: resumo },
  });
}
