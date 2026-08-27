import {
  addDaysISO,
  addMonthsISO,
  dateBR,
  endOfMonthISO,
  endOfWeekISO,
  endOfYearISO,
  startOfMonthISO,
  startOfWeekISO,
  startOfYearISO,
} from "@/lib/format";

/** Filtro de período usado no Dashboard e no Fluxo de Caixa. */
export type PeriodType = "dia" | "semana" | "mes" | "ano" | "personalizado";

export const MONTH_NAMES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export const PERIOD_OPTIONS = [
  ["dia", "Dia"],
  ["semana", "Semana"],
  ["mes", "Mês"],
  ["ano", "Ano"],
  ["personalizado", "Personalizado"],
] as const;

export function periodRange(
  type: PeriodType,
  anchor: string,
  custom?: { start: string; end: string },
): { start: string; end: string } {
  switch (type) {
    case "dia":
      return { start: anchor, end: anchor };
    case "semana":
      return { start: startOfWeekISO(anchor), end: endOfWeekISO(anchor) };
    case "ano":
      return { start: startOfYearISO(anchor), end: endOfYearISO(anchor) };
    case "personalizado": {
      // Datas invertidas são um erro de digitação comum — troca em vez de
      // devolver um intervalo vazio e uma tela toda zerada.
      const s = custom?.start || anchor;
      const e = custom?.end || anchor;
      return s <= e ? { start: s, end: e } : { start: e, end: s };
    }
    case "mes":
    default:
      return { start: startOfMonthISO(anchor), end: endOfMonthISO(anchor) };
  }
}

export function periodLabel(
  type: PeriodType,
  anchor: string,
  custom?: { start: string; end: string },
): string {
  const { start, end } = periodRange(type, anchor, custom);
  if (type === "dia") return dateBR(anchor);
  if (type === "semana") return `${dateBR(start)} – ${dateBR(end)}`;
  if (type === "ano") return anchor.slice(0, 4);
  if (type === "personalizado") return `${dateBR(start)} – ${dateBR(end)}`;
  return monthLabel(anchor);
}

/**
 * Data que representa a competência do período — sempre o primeiro dia dele.
 * É o que mantém "Competência: Agosto de 2026" à vista mesmo quando o recorte
 * escolhido é um dia, uma semana ou um intervalo livre.
 */
export function startOfPeriodAnchor(
  type: PeriodType,
  anchor: string,
  custom?: { start: string; end: string },
): string {
  return periodRange(type, anchor, custom).start;
}

/** "Agosto de 2026" — o mês de competência, escrito por extenso. */
export function monthLabel(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return `${MONTH_NAMES[(m ?? 1) - 1]} de ${y}`;
}

export function shiftAnchor(type: PeriodType, anchor: string, direction: 1 | -1): string {
  if (type === "dia") return addDaysISO(anchor, direction);
  if (type === "semana") return addDaysISO(anchor, direction * 7);
  if (type === "ano") {
    const [y, m, d] = anchor.split("-");
    return `${Number(y) + direction}-${m}-${d}`;
  }
  return addMonthsISO(anchor, direction);
}
