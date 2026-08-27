import * as XLSX from "xlsx";

/**
 * Leitura e escrita das planilhas exportadas pelo Advbox — as mesmas colunas,
 * na mesma ordem, para que o arquivo baixado aqui possa voltar para cá (ou
 * para o Advbox) sem retrabalho.
 */

export type AdvboxKind = "clientes" | "processos" | "financeiro";

export type AdvClient = {
  name: string;
  tax_id: string | null;
  rg: string | null;
  birth_date: string | null;
  marital_status: string | null;
  pis_pasep: string | null;
  ctps: string | null;
  cid: string | null;
  occupation: string | null;
  gender: string | null;
  phone: string | null;
  phone_secondary: string | null;
  email: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  address: string | null;
  district: string | null;
  zip_code: string | null;
  mother_name: string | null;
  source: string | null;
  notes: string | null;
};

export type AdvCase = {
  client_name: string;
  client_tax_id: string | null;
  opposing_party: string | null;
  action_group: string | null;
  action_type: string | null;
  judicial_phase: string | null;
  stage: string | null;
  case_number: string | null;
  protocol_number: string | null;
  original_case: string | null;
  folder: string | null;
  case_year: string | null;
  request_date: string | null;
  segment: string | null;
  county: string | null;
  court_division: string | null;
  court: string | null;
  closing_date: string | null;
  res_judicata_date: string | null;
  archived_date: string | null;
  case_result: string | null;
  claim_value: number | null;
  fee_amount: number | null;
  fee_percent: number | null;
  contingency: string | null;
  responsible_lawyer: string | null;
  last_movement: string | null;
  notes: string | null;
};

/** Uma linha do resumo de receitas e despesas do Advbox. */
export type AdvFinancialEntry = {
  account: string | null;
  cost_center: string | null;
  sector: string | null;
  /** "entrada" (RECEITA) ou "saida" (DESPESA), já traduzido. */
  type: "entrada" | "saida";
  due_date: string | null;
  /** Competência no formato MM/AAAA, como o Advbox exporta. */
  competence: string | null;
  paid_on: string | null;
  category: string | null;
  description: string | null;
  amount: number;
  case_number: string | null;
  parties: string | null;
  /**
   * Para onde a linha deve ir. Honorários e alvarás são receita de processo:
   * entram pela tela de Acordos, viram parcela e o recebimento espelha no
   * caixa sozinho. Lançar direto no caixa contaria o mesmo dinheiro duas
   * vezes, então essas linhas ficam de fora da importação.
   */
  route: "caixa" | "acordos";
  /**
   * Impressão digital da linha. O Advbox não exporta um id, então este texto
   * — montado sempre igual a partir do conteúdo — é o que impede a mesma
   * linha de entrar duas vezes quando você reimporta o arquivo.
   */
  fingerprint: string;
};

/**
 * O Advbox numera as categorias para ordenar a lista dele ("6. INDENIZAÇÃO").
 * Aqui o número não serve para nada e só atrapalha a leitura, então sai.
 */
export function cleanCategoryName(raw: string | null): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  return s.replace(/^\d+\s*[.)-]\s*/, "").trim() || s;
}

/**
 * Receita que nasce de processo (alvará, honorários de qualquer tipo,
 * sucumbência) não entra pelo caixa — entra pelos Acordos.
 */
export function isReceitaDeProcesso(category: string | null): boolean {
  const c = deaccent(category ?? "");
  return c.includes("honorario") || c.includes("alvara") || c.includes("sucumbencia");
}

export type AdvboxParse =
  | { kind: "clientes"; clients: AdvClient[]; warnings: string[] }
  | { kind: "processos"; cases: AdvCase[]; warnings: string[] }
  | { kind: "financeiro"; entries: AdvFinancialEntry[]; warnings: string[] };

/** Cabeçalhos exatos do Advbox, na ordem em que ele exporta. */
export const CLIENT_HEADERS = [
  "Nome",
  "CPF/CNPJ",
  "RG",
  "Data de nascimento",
  "Estado Civil",
  "PIS/PASEP",
  "CTPS",
  "CID",
  "Profissão",
  "Sexo",
  "Celular",
  "Telefone",
  "E-mail",
  "País",
  "Estado",
  "Cidade",
  "Endereço",
  "Bairro",
  "CEP",
  "Nome da mãe",
  "Origem",
  "Anotações Gerais",
  "Data de cadastro",
] as const;

export const CASE_HEADERS = [
  "Nome do cliente",
  "Parte contrária",
  "Grupo de ação",
  "Tipo de ação",
  "Fase judicial",
  "Etapa",
  "Número do processo",
  "Número do protocolo",
  "Processo originário",
  "Pasta/Caso",
  "Ano",
  "Data do requerimento",
  "Segmento",
  "Comarca",
  "Vara",
  "Tribunal",
  "Data do fechamento",
  "Data do trânsito em julgado",
  "Data do arquivamento",
  "Resultado do processo",
  "Expectiva/Valor da causa (R$)",
  "Valor dos honorários (R$)",
  "Honorários (%)",
  "Contingenciamento",
  "Responsável",
  "Último andamento",
  "Anotações Gerais",
  "Data de cadastro",
] as const;

function deaccent(v: string) {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  if (!s || s.toLowerCase() === "none") return null;
  return s;
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  // Aceita "R$39.111,96", "39111.96", "30.0" e "1.234,56".
  let s = String(v).replace(/[^\d,.-]/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) {
    // vírgula é o separador decimal (padrão brasileiro)
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (lastComma >= 0) {
    // vírgula só como separador de milhar
    s = s.replace(/,/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toISODate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = s.match(/^\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  return null;
}

export function onlyDigits(v: string | null | undefined): string {
  return String(v ?? "").replace(/\D/g, "");
}

/** Número ou zero — evita espalhar `?? 0` pelo código. */
function num0(v: number | null): number {
  return v ?? 0;
}

/**
 * Chave estável de uma linha do financeiro. O Advbox não exporta id, então
 * a identidade da linha é o próprio conteúdo: reimportar o mesmo arquivo
 * (ou um arquivo maior que contenha os mesmos meses) não duplica nada.
 * Descrição entra normalizada para não quebrar a chave por causa de um
 * espaço a mais ou de uma diferença de maiúsculas.
 */
export function financialFingerprint(e: {
  type: string;
  due_date: string | null;
  paid_on: string | null;
  category: string | null;
  description: string | null;
  amount: number;
  case_number: string | null;
}): string {
  return [
    "advbox",
    e.type,
    e.due_date ?? "",
    e.paid_on ?? "",
    deaccent(e.category ?? ""),
    deaccent(e.description ?? ""),
    e.amount.toFixed(2),
    onlyDigits(e.case_number),
  ].join("|");
}

/** "MARIA DA SILVA (123.456.789-00)" → nome e CPF separados. */
export function splitNameAndTaxId(raw: string): { name: string; tax_id: string | null } {
  const s = String(raw ?? "").trim();
  const m = s.match(/^(.*?)\s*\(([\d.\-/]+)\)\s*$/);
  if (m) return { name: m[1]!.trim(), tax_id: m[2]! };
  return { name: s, tax_id: null };
}

function headerIndex(header: unknown[]): Map<string, number> {
  const map = new Map<string, number>();
  header.forEach((h, i) => {
    const key = deaccent(String(h ?? ""));
    if (key && !map.has(key)) map.set(key, i);
  });
  return map;
}

/** Cabeçalhos do resumo de receitas e despesas do Advbox. */
export const FINANCIAL_HEADERS = [
  "Conta/Cartão",
  "Centro de custo",
  "Setor/Unidade",
  "Tipo",
  "Vencimento",
  "Competencia",
  "Pagamento",
  "Categoria",
  "Descrição",
  "Valor recebido",
  "Valor pago",
  "Processo",
  "Partes",
] as const;

/** Descobre qual das três planilhas do Advbox é, pelo cabeçalho. */
export function detectKind(header: unknown[]): AdvboxKind | null {
  const idx = headerIndex(header);
  // O financeiro é o único que traz as duas colunas de valor separadas.
  if (idx.has("valor recebido") && idx.has("valor pago")) return "financeiro";
  if (idx.has("nome do cliente") && idx.has("tipo de acao")) return "processos";
  if (idx.has("nome") && idx.has("cpf/cnpj")) return "clientes";
  return null;
}

export function parseAdvboxWorkbook(buffer: ArrayBuffer): AdvboxParse {
  const wb = XLSX.read(buffer, { cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("A planilha está vazia.");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName]!, {
    header: 1,
    raw: true,
    blankrows: false,
  });
  if (!rows.length) throw new Error("A planilha está vazia.");

  const header = rows[0]!;
  const kind = detectKind(header);
  if (!kind) {
    throw new Error(
      'Formato não reconhecido. Use a exportação do Advbox de Clientes (começa com "Nome"), de Processos (começa com "Nome do cliente") ou o resumo de Receitas e Despesas (tem as colunas "Valor recebido" e "Valor pago").',
    );
  }

  const idx = headerIndex(header);
  const at = (row: unknown[], label: string) => {
    const i = idx.get(deaccent(label));
    return i === undefined ? null : (row[i] ?? null);
  };
  const warnings: string[] = [];
  const body = rows.slice(1);

  if (kind === "clientes") {
    const clients: AdvClient[] = [];
    const seen = new Map<string, number>();
    body.forEach((row, n) => {
      const name = text(at(row, "Nome"));
      if (!name) return;
      const tax_id = text(at(row, "CPF/CNPJ"));
      const key = onlyDigits(tax_id) || deaccent(name);
      const prev = seen.get(key);
      if (prev !== undefined) {
        warnings.push(
          `Linha ${n + 2}: "${name}" repete o cadastro da linha ${prev + 2} — será importado uma vez só.`,
        );
        return;
      }
      seen.set(key, n);
      clients.push({
        name,
        tax_id,
        rg: text(at(row, "RG")),
        birth_date: toISODate(at(row, "Data de nascimento")),
        marital_status: text(at(row, "Estado Civil")),
        pis_pasep: text(at(row, "PIS/PASEP")),
        ctps: text(at(row, "CTPS")),
        cid: text(at(row, "CID")),
        occupation: text(at(row, "Profissão")),
        gender: text(at(row, "Sexo")),
        phone: text(at(row, "Celular")),
        phone_secondary: text(at(row, "Telefone")),
        email: text(at(row, "E-mail")),
        country: text(at(row, "País")),
        state: text(at(row, "Estado")),
        city: text(at(row, "Cidade")),
        address: text(at(row, "Endereço")),
        district: text(at(row, "Bairro")),
        zip_code: text(at(row, "CEP")),
        mother_name: text(at(row, "Nome da mãe")),
        source: text(at(row, "Origem")),
        notes: text(at(row, "Anotações Gerais")),
      });
    });
    if (!clients.length) warnings.push("Nenhum cliente encontrado na planilha.");
    return { kind, clients, warnings };
  }

  if (kind === "financeiro") {
    const entries: AdvFinancialEntry[] = [];
    const seenPrints = new Map<string, number>();
    let semTipo = 0;
    let semValor = 0;
    let semData = 0;
    let repetidas = 0;

    body.forEach((row, n) => {
      const linha = n + 2;
      const rawType = deaccent(String(at(row, "Tipo") ?? ""));
      if (!rawType) return;

      const isReceita = rawType.startsWith("receita");
      const isDespesa = rawType.startsWith("despesa");
      if (!isReceita && !isDespesa) {
        semTipo += 1;
        return;
      }

      // A planilha separa em duas colunas; sobra a que corresponde ao tipo.
      const recebido = toNumber(at(row, "Valor recebido"));
      const pago = toNumber(at(row, "Valor pago"));
      const amount = Math.abs(num0(isReceita ? recebido : pago) || num0(recebido) || num0(pago));
      if (!amount) {
        semValor += 1;
        return;
      }

      const dueDate = toISODate(at(row, "Vencimento"));
      const paidOn = toISODate(at(row, "Pagamento"));
      if (!dueDate && !paidOn) {
        semData += 1;
        return;
      }

      const entry: AdvFinancialEntry = {
        account: text(at(row, "Conta/Cartão")),
        cost_center: text(at(row, "Centro de custo")),
        sector: text(at(row, "Setor/Unidade")),
        type: isReceita ? "entrada" : "saida",
        due_date: dueDate,
        competence: text(at(row, "Competencia")) ?? text(at(row, "Competência")),
        paid_on: paidOn,
        category: cleanCategoryName(text(at(row, "Categoria"))),
        description: text(at(row, "Descrição")),
        amount,
        case_number: text(at(row, "Processo")),
        parties: text(at(row, "Partes")),
        route:
          isReceita && isReceitaDeProcesso(text(at(row, "Categoria"))) ? "acordos" : "caixa",
        fingerprint: "",
      };
      entry.fingerprint = financialFingerprint(entry);

      const antes = seenPrints.get(entry.fingerprint);
      if (antes) {
        repetidas += 1;
        warnings.push(
          `Linha ${linha}: repete exatamente a linha ${antes} (mesmo tipo, data, categoria e valor) — será importada uma vez só.`,
        );
        return;
      }
      seenPrints.set(entry.fingerprint, linha);
      entries.push(entry);
    });

    if (semTipo) warnings.push(`${semTipo} linha(s) ignorada(s): coluna "Tipo" não é RECEITA nem DESPESA.`);
    if (semValor) warnings.push(`${semValor} linha(s) ignorada(s) por não ter valor.`);
    if (semData) warnings.push(`${semData} linha(s) ignorada(s) por não ter vencimento nem pagamento.`);
    if (repetidas) warnings.push(`${repetidas} linha(s) repetida(s) no arquivo foram descartadas.`);
    if (!entries.length) warnings.push("Nenhum lançamento encontrado na planilha.");
    return { kind, entries, warnings };
  }

  const cases: AdvCase[] = [];
  const seenNumbers = new Map<string, number>();
  body.forEach((row, n) => {
    const raw = text(at(row, "Nome do cliente"));
    if (!raw) return;
    const { name, tax_id } = splitNameAndTaxId(raw);
    const case_number = text(at(row, "Número do processo"));
    if (case_number) {
      const prev = seenNumbers.get(case_number);
      if (prev !== undefined) {
        warnings.push(
          `Linha ${n + 2}: processo ${case_number} repete a linha ${prev + 2} — será importado uma vez só.`,
        );
        return;
      }
      seenNumbers.set(case_number, n);
    }
    cases.push({
      client_name: name,
      client_tax_id: tax_id,
      opposing_party: text(at(row, "Parte contrária")),
      action_group: text(at(row, "Grupo de ação")),
      action_type: text(at(row, "Tipo de ação")),
      judicial_phase: text(at(row, "Fase judicial")),
      stage: text(at(row, "Etapa")),
      case_number,
      protocol_number: text(at(row, "Número do protocolo")),
      original_case: text(at(row, "Processo originário")),
      folder: text(at(row, "Pasta/Caso")),
      case_year: text(at(row, "Ano")),
      request_date: toISODate(at(row, "Data do requerimento")),
      segment: text(at(row, "Segmento")),
      county: text(at(row, "Comarca")),
      court_division: text(at(row, "Vara")),
      court: text(at(row, "Tribunal")),
      closing_date: toISODate(at(row, "Data do fechamento")),
      res_judicata_date: toISODate(at(row, "Data do trânsito em julgado")),
      archived_date: toISODate(at(row, "Data do arquivamento")),
      case_result: text(at(row, "Resultado do processo")),
      claim_value: toNumber(at(row, "Expectiva/Valor da causa (R$)")),
      fee_amount: toNumber(at(row, "Valor dos honorários (R$)")),
      fee_percent: toNumber(at(row, "Honorários (%)")),
      contingency: text(at(row, "Contingenciamento")),
      responsible_lawyer: text(at(row, "Responsável")),
      last_movement: text(at(row, "Último andamento")),
      notes: text(at(row, "Anotações Gerais")),
    });
  });
  if (!cases.length) warnings.push("Nenhum processo encontrado na planilha.");
  const semNumero = cases.filter((c) => !c.case_number).length;
  if (semNumero) {
    warnings.push(
      `${semNumero} processo(s) sem número — serão identificados pelo cliente e pela parte contrária.`,
    );
  }
  return { kind, cases, warnings };
}

/* ------------------------------------------------------------------ *
 * Exportação no mesmo formato
 * ------------------------------------------------------------------ */

function dateBR(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : "";
}

export function clientsToAdvboxRows(
  clients: {
    name: string;
    tax_id: string | null;
    rg: string | null;
    birth_date: string | null;
    marital_status: string | null;
    pis_pasep: string | null;
    ctps: string | null;
    cid: string | null;
    occupation: string | null;
    gender: string | null;
    phone: string | null;
    phone_secondary: string | null;
    email: string | null;
    country: string | null;
    state: string | null;
    city: string | null;
    address: string | null;
    district: string | null;
    zip_code: string | null;
    mother_name: string | null;
    source: string | null;
    notes: string | null;
    created_at: string | null;
  }[],
): Record<string, string>[] {
  return clients.map((c) => ({
    Nome: c.name ?? "",
    "CPF/CNPJ": c.tax_id ?? "",
    RG: c.rg ?? "",
    "Data de nascimento": dateBR(c.birth_date),
    "Estado Civil": c.marital_status ?? "",
    "PIS/PASEP": c.pis_pasep ?? "",
    CTPS: c.ctps ?? "",
    CID: c.cid ?? "",
    Profissão: c.occupation ?? "",
    Sexo: c.gender ?? "",
    Celular: c.phone ?? "",
    Telefone: c.phone_secondary ?? "",
    "E-mail": c.email ?? "",
    País: c.country ?? "",
    Estado: c.state ?? "",
    Cidade: c.city ?? "",
    Endereço: c.address ?? "",
    Bairro: c.district ?? "",
    CEP: c.zip_code ?? "",
    "Nome da mãe": c.mother_name ?? "",
    Origem: c.source ?? "",
    "Anotações Gerais": c.notes ?? "",
    "Data de cadastro": dateBR(c.created_at?.slice(0, 10) ?? null),
  }));
}

export function casesToAdvboxRows(
  cases: {
    client_name: string;
    client_tax_id: string | null;
    opposing_party: string | null;
    action_group: string | null;
    action_type: string | null;
    judicial_phase: string | null;
    stage: string | null;
    case_number: string | null;
    protocol_number: string | null;
    original_case: string | null;
    folder: string | null;
    case_year: string | null;
    request_date: string | null;
    segment: string | null;
    county: string | null;
    court_division: string | null;
    court: string | null;
    closing_date: string | null;
    res_judicata_date: string | null;
    archived_date: string | null;
    case_result: string | null;
    claim_value: number | null;
    fee_amount: number | null;
    fee_percent: number | null;
    contingency: string | null;
    responsible_lawyer: string | null;
    last_movement: string | null;
    notes: string | null;
    created_at: string | null;
  }[],
): Record<string, string>[] {
  const money = (v: number | null) =>
    v === null || v === undefined
      ? ""
      : `R$${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return cases.map((c) => ({
    // O Advbox exporta o cliente como "NOME (CPF)" — mantemos igual para que
    // o arquivo daqui possa ser reimportado sem ajuste.
    "Nome do cliente": c.client_tax_id
      ? `${c.client_name} (${c.client_tax_id})`
      : (c.client_name ?? ""),
    "Parte contrária": c.opposing_party ?? "",
    "Grupo de ação": c.action_group ?? "",
    "Tipo de ação": c.action_type ?? "",
    "Fase judicial": c.judicial_phase ?? "",
    Etapa: c.stage ?? "",
    "Número do processo": c.case_number ?? "",
    "Número do protocolo": c.protocol_number ?? "",
    "Processo originário": c.original_case ?? "",
    "Pasta/Caso": c.folder ?? "",
    Ano: c.case_year ?? "",
    "Data do requerimento": dateBR(c.request_date),
    Segmento: c.segment ?? "",
    Comarca: c.county ?? "",
    Vara: c.court_division ?? "",
    Tribunal: c.court ?? "",
    "Data do fechamento": dateBR(c.closing_date),
    "Data do trânsito em julgado": dateBR(c.res_judicata_date),
    "Data do arquivamento": dateBR(c.archived_date),
    "Resultado do processo": c.case_result ?? "",
    "Expectiva/Valor da causa (R$)": money(c.claim_value),
    "Valor dos honorários (R$)": money(c.fee_amount),
    "Honorários (%)": c.fee_percent === null ? "" : String(c.fee_percent),
    Contingenciamento: c.contingency ?? "",
    Responsável: c.responsible_lawyer ?? "",
    "Último andamento": c.last_movement ?? "",
    "Anotações Gerais": c.notes ?? "",
    "Data de cadastro": dateBR(c.created_at?.slice(0, 10) ?? null),
  }));
}
