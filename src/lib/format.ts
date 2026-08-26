export const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function money(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  return BRL.format(Number.isFinite(n) ? n : 0);
}

export function num(value: number | string | null | undefined): number {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Formata uma data ISO (yyyy-MM-dd) em dd/MM/yyyy sem deslocamento de fuso. */
export function dateBR(value: string | null | undefined): string {
  if (!value) return "—";
  const iso = value.slice(0, 10);
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return "—";
  return `${d}/${m}/${y}`;
}

export function todayISO(): string {
  const now = new Date();
  const tz = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return tz.toISOString().slice(0, 10);
}

export function addMonthsISO(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  const day = base.getUTCDate();
  base.setUTCDate(1);
  base.setUTCMonth(base.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(day, lastDay));
  return base.toISOString().slice(0, 10);
}

/** Adiciona dias a uma data ISO (yyyy-MM-dd), sem deslocamento de fuso. */
export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = new Date(Date.UTC(y!, (m ?? 1) - 1, (d ?? 1) + days));
  return base.toISOString().slice(0, 10);
}

/** Início da semana (segunda-feira) que contém a data informada. */
export function startOfWeekISO(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  const weekday = base.getUTCDay(); // 0 = domingo
  const diffToMonday = weekday === 0 ? 6 : weekday - 1;
  return addDaysISO(iso, -diffToMonday);
}

/** Fim da semana (domingo) que contém a data informada. */
export function endOfWeekISO(iso: string): string {
  return addDaysISO(startOfWeekISO(iso), 6);
}

export function startOfMonthISO(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function endOfMonthISO(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
}

export function startOfYearISO(iso: string): string {
  return `${iso.slice(0, 4)}-01-01`;
}

export function endOfYearISO(iso: string): string {
  return `${iso.slice(0, 4)}-12-31`;
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

export function maskTaxId(value: string | null | undefined): string {
  if (!value) return "—";
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11) return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
  if (digits.length === 14) return `**.${digits.slice(2, 5)}.${digits.slice(5, 8)}/****-**`;
  return value.length > 4 ? `${"*".repeat(value.length - 4)}${value.slice(-4)}` : value;
}

export function maskAccount(value: string | null | undefined): string {
  if (!value) return "—";
  return value.length > 3 ? `****${value.slice(-3)}` : value;
}

export const INSTALLMENT_STATUS_LABEL: Record<string, string> = {
  PAGA: "Paga",
  PARCIAL: "Parcial",
  VENCE_HOJE: "Vence hoje",
  ATRASADA: "Atrasada",
  A_VENCER: "A vencer",
  A_DEFINIR: "A definir",
  CANCELADA: "Cancelada",
};

export const RECEIVABLE_TYPE_LABEL: Record<string, string> = {
  acordo: "Acordo",
  sentenca: "Sentença",
  execucao: "Execução",
  honorarios: "Honorários",
  outro: "Outro",
};

export const RECEIVABLE_STATUS_LABEL: Record<string, string> = {
  rascunho: "Rascunho",
  estimado: "Estimado",
  confirmado: "Confirmado",
  em_pagamento: "Em pagamento",
  em_execucao: "Em execução",
  encerrado: "Encerrado",
  cancelado: "Cancelado",
};

export const FLOW_LABEL: Record<string, string> = {
  escritorio_recebe_total: "Escritório recebe o total",
  cliente_recebe_direto: "Cliente recebe direto",
  recebimento_dividido: "Recebimento dividido",
  deposito_judicial: "Depósito judicial",
};

export const TRANSFER_STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente",
  agendado: "Agendado",
  pago: "Pago",
  cancelado: "Cancelado",
};

export const TX_TYPE_LABEL: Record<string, string> = {
  entrada: "Entrada",
  saida: "Saída",
  transferencia_entre_contas: "Transferência entre contas",
  entrada_de_terceiros: "Entrada de terceiros",
  repasse_de_terceiros: "Repasse de terceiros",
};
