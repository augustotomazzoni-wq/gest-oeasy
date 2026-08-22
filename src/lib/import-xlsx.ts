import * as XLSX from "xlsx";

export type ParsedClient = {
  name: string;
  opposing_party: string | null;
  case_number: string | null;
  type: string;
  status: string;
  is_estimated: boolean;
  gross_amount: number | null;
  fee_percent: number | null;
  firm_amount: number;
  already_received: number;
  notes: string | null;
};

export type ParsedInstallment = {
  client: string;
  number: number;
  total_count: number;
  due_date: string | null;
  firm_amount: number;
  paid: boolean;
  received_on: string | null;
  status: string | null;
  notes: string | null;
};

export type ParsedWorkbook = {
  clients: ParsedClient[];
  installments: ParsedInstallment[];
  warnings: string[];
};

const TYPE_MAP: Record<string, string> = {
  acordo: "acordo",
  sentenca: "sentenca",
  execucao: "execucao",
  honorarios: "honorarios",
};

const STATUS_MAP: Record<string, string> = {
  encerrado: "encerrado",
  "em pagamento": "em_pagamento",
  "em execucao": "em_execucao",
  "estimado (a confirmar)": "estimado",
  estimado: "estimado",
  rascunho: "rascunho",
  cancelado: "cancelado",
};

function deaccent(v: string) {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const cleaned = String(v)
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toISODate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    return new Date(v.getTime() - v.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);
  }
  const s = String(v).trim();
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = s.match(/^\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  return null;
}

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/** Localiza a linha de cabeçalho procurando a coluna "Cliente". */
function findHeader(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const first = deaccent(String(rows[i]?.[0] ?? ""));
    if (first === "cliente") return i;
  }
  return -1;
}

function indexOfHeader(header: unknown[], candidates: string[]): number {
  const norm = header.map((h) => deaccent(String(h ?? "")));
  for (const c of candidates) {
    const i = norm.indexOf(deaccent(c));
    if (i >= 0) return i;
  }
  for (const c of candidates) {
    const i = norm.findIndex((h) => h.includes(deaccent(c)));
    if (i >= 0) return i;
  }
  return -1;
}

export function parseWorkbook(buffer: ArrayBuffer): ParsedWorkbook {
  const wb = XLSX.read(buffer, { cellDates: true });
  const warnings: string[] = [];

  const sheetByName = (needle: string) =>
    wb.SheetNames.find((n) => deaccent(n).includes(deaccent(needle)));

  const clientsSheet = sheetByName("cliente");
  const instSheet = sheetByName("parcela");

  const clients: ParsedClient[] = [];
  const installments: ParsedInstallment[] = [];

  if (!clientsSheet) {
    warnings.push('Aba "Clientes" não encontrada na planilha.');
  } else {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[clientsSheet]!, {
      header: 1,
      raw: true,
      blankrows: false,
    });
    const h = findHeader(rows);
    if (h < 0) warnings.push('Cabeçalho da aba "Clientes" não localizado.');
    else {
      const head = rows[h]!;
      const col = {
        name: 0,
        opposing: indexOfHeader(head, ["Reclamado"]),
        caseNumber: indexOfHeader(head, ["Nº do Processo", "Processo"]),
        type: indexOfHeader(head, ["Tipo"]),
        status: indexOfHeader(head, ["Situação"]),
        gross: indexOfHeader(head, ["Valor do Acordo"]),
        percent: indexOfHeader(head, ["% Nosso"]),
        firm: indexOfHeader(head, ["Nosso Valor"]),
        received: indexOfHeader(head, ["Já Recebido"]),
        notes: indexOfHeader(head, ["Observações"]),
      };
      for (const row of rows.slice(h + 1)) {
        const name = text(row[col.name]);
        if (!name || deaccent(name) === "total") continue;
        const rawStatus = deaccent(String(row[col.status] ?? ""));
        const rawType = deaccent(String(row[col.type] ?? ""));
        clients.push({
          name,
          opposing_party: col.opposing >= 0 ? text(row[col.opposing]) : null,
          case_number: col.caseNumber >= 0 ? text(row[col.caseNumber]) : null,
          type: TYPE_MAP[rawType] ?? "outro",
          status: STATUS_MAP[rawStatus] ?? "confirmado",
          is_estimated: rawStatus.startsWith("estimado"),
          gross_amount: col.gross >= 0 ? toNumber(row[col.gross]) : null,
          fee_percent:
            col.percent >= 0
              ? (() => {
                  const p = toNumber(row[col.percent]);
                  if (p === null) return null;
                  return p <= 1 ? p * 100 : p;
                })()
              : null,
          firm_amount: (col.firm >= 0 ? toNumber(row[col.firm]) : 0) ?? 0,
          already_received: (col.received >= 0 ? toNumber(row[col.received]) : 0) ?? 0,
          notes: col.notes >= 0 ? text(row[col.notes]) : null,
        });
      }
    }
  }

  if (!instSheet) {
    warnings.push('Aba "Parcelas a Receber" não encontrada — apenas clientes serão importados.');
  } else {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[instSheet]!, {
      header: 1,
      raw: true,
      blankrows: false,
    });
    const h = findHeader(rows);
    if (h < 0) warnings.push('Cabeçalho da aba de parcelas não localizado.');
    else {
      const head = rows[h]!;
      const col = {
        name: 0,
        parcel: indexOfHeader(head, ["Parcela"]),
        due: indexOfHeader(head, ["Vencimento"]),
        value: indexOfHeader(head, ["Valor NOSSO", "Valor"]),
        ok: indexOfHeader(head, ["OK?"]),
        receivedOn: indexOfHeader(head, ["Data do Recebimento"]),
        status: indexOfHeader(head, ["Status"]),
        notes: indexOfHeader(head, ["Observações"]),
      };
      for (const row of rows.slice(h + 1)) {
        const client = text(row[col.name]);
        if (!client || deaccent(client) === "total") continue;
        const parcel = String(row[col.parcel] ?? "1/1");
        const [a, b] = parcel.split("/");
        const status = col.status >= 0 ? text(row[col.status]) : null;
        const ok = col.ok >= 0 && deaccent(String(row[col.ok] ?? "")) === "ok";
        installments.push({
          client,
          number: Number(a) || 1,
          total_count: Number(b) || 1,
          due_date: col.due >= 0 ? toISODate(row[col.due]) : null,
          firm_amount: (col.value >= 0 ? toNumber(row[col.value]) : 0) ?? 0,
          paid: ok || deaccent(status ?? "") === "paga",
          received_on: col.receivedOn >= 0 ? toISODate(row[col.receivedOn]) : null,
          status,
          notes: col.notes >= 0 ? text(row[col.notes]) : null,
        });
      }
    }
  }

  const names = new Set(clients.map((c) => deaccent(c.name)));
  const orphans = new Set(
    installments.filter((i) => !names.has(deaccent(i.client))).map((i) => i.client),
  );
  for (const o of orphans) {
    warnings.push(`Parcelas de "${o}" não têm cliente correspondente na aba Clientes.`);
  }

  return { clients, installments, warnings };
}

export function matchKey(name: string): string {
  return deaccent(name).replace(/\s+/g, " ");
}
