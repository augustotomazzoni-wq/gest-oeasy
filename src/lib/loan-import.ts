import * as XLSX from "xlsx";

/**
 * Planilha de empréstimo: uma aba com os dados do contrato e outra com as
 * parcelas. O contrato do banco raramente traz as datas de vencimento (elas
 * costumam ser definidas no ato do depósito), então a coluna Vencimento pode
 * vir vazia — nesse caso as datas são calculadas mês a mês a partir do
 * primeiro vencimento informado na tela.
 */
export type LoanImportParcel = {
  numero: number;
  due_date: string | null;
  amount: number;
};

export type LoanImport = {
  lender: string | null;
  contract_number: string | null;
  amount_received: number | null;
  received_on: string | null;
  notes: string | null;
  parcels: LoanImportParcel[];
  warnings: string[];
};

export const LOAN_SHEET = "Emprestimo";
export const PARCEL_SHEET = "Parcelas";

export const LOAN_HEADERS = [
  "Credor",
  "Contrato",
  "Valor recebido",
  "Recebido em",
  "Observações",
] as const;

export const PARCEL_HEADERS = ["Parcela", "Vencimento", "Valor"] as const;

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
  let s = String(v).replace(/[^\d,.-]/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
  else if (lastComma >= 0) s = s.replace(/,/g, "");
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

function text(v: unknown): string | null {
  const s = String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return s || null;
}

/** Índice das colunas pelo nome do cabeçalho, sem depender da ordem. */
function headerIndex(header: unknown[]): Map<string, number> {
  const map = new Map<string, number>();
  header.forEach((h, i) => {
    const key = deaccent(String(h ?? ""));
    if (key && !map.has(key)) map.set(key, i);
  });
  return map;
}

/** Acha a aba pelo nome, ignorando acento e maiúsculas. */
function findSheet(wb: XLSX.WorkBook, wanted: string): string | null {
  const alvo = deaccent(wanted);
  return wb.SheetNames.find((n) => deaccent(n) === alvo) ?? null;
}

export function parseLoanWorkbook(buffer: ArrayBuffer): LoanImport {
  const wb = XLSX.read(buffer, { cellDates: true });
  const warnings: string[] = [];

  const parcelSheet = findSheet(wb, PARCEL_SHEET);
  if (!parcelSheet) {
    throw new Error(
      'Não encontrei a aba "Parcelas". Baixe o modelo na própria tela e preencha por cima dele.',
    );
  }

  // ---- dados do contrato (opcionais: dá para preencher na tela) ----
  let lender: string | null = null;
  let contract: string | null = null;
  let amount: number | null = null;
  let received: string | null = null;
  let notes: string | null = null;

  const loanSheet = findSheet(wb, LOAN_SHEET);
  if (loanSheet) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[loanSheet]!, {
      header: 1,
      raw: true,
      blankrows: false,
    });
    if (rows.length >= 2) {
      const idx = headerIndex(rows[0]!);
      const at = (label: string) => {
        const i = idx.get(deaccent(label));
        return i === undefined ? null : (rows[1]![i] ?? null);
      };
      lender = text(at("Credor"));
      contract = text(at("Contrato"));
      amount = toNumber(at("Valor recebido"));
      received = toISODate(at("Recebido em"));
      notes = text(at("Observações"));
    }
  } else {
    warnings.push('A aba "Emprestimo" não veio no arquivo — preencha os dados do contrato na tela.');
  }

  // ---- parcelas ----
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[parcelSheet]!, {
    header: 1,
    raw: true,
    blankrows: false,
  });
  if (rows.length < 2) throw new Error('A aba "Parcelas" está vazia.');

  const idx = headerIndex(rows[0]!);
  const colValor = idx.get("valor");
  const colVenc = idx.get("vencimento");
  const colNum = idx.get("parcela");
  if (colValor === undefined) {
    throw new Error('A aba "Parcelas" precisa de uma coluna "Valor".');
  }

  const parcels: LoanImportParcel[] = [];
  let semValor = 0;
  let semData = 0;

  rows.slice(1).forEach((row, i) => {
    const valor = toNumber(row[colValor]);
    if (!valor || valor <= 0) {
      if (row.some((c) => String(c ?? "").trim())) semValor += 1;
      return;
    }
    const venc = colVenc === undefined ? null : toISODate(row[colVenc]);
    if (!venc) semData += 1;
    const numero =
      colNum === undefined ? parcels.length + 1 : (toNumber(row[colNum]) ?? parcels.length + 1);
    parcels.push({ numero: Math.trunc(numero), due_date: venc, amount: valor });
    void i;
  });

  if (semValor) warnings.push(`${semValor} linha(s) ignorada(s) por não ter valor.`);
  if (semData) {
    warnings.push(
      `${semData} parcela(s) sem data de vencimento — serão calculadas mês a mês a partir do 1º vencimento que você informar na tela.`,
    );
  }
  if (!parcels.length) throw new Error("Nenhuma parcela encontrada na planilha.");

  return {
    lender,
    contract_number: contract,
    amount_received: amount,
    received_on: received,
    notes,
    parcels,
    warnings,
  };
}

/** Modelo em branco, para o escritório preencher com qualquer contrato. */
export function loanTemplateRows(): {
  emprestimo: Record<string, unknown>[];
  parcelas: Record<string, unknown>[];
} {
  return {
    emprestimo: [
      {
        Credor: "",
        Contrato: "",
        "Valor recebido": "",
        "Recebido em": "",
        Observações: "",
      },
    ],
    parcelas: [{ Parcela: 1, Vencimento: "", Valor: "" }],
  };
}
