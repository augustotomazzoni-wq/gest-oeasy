import * as XLSX from "xlsx";

/** Gera e baixa uma planilha .xlsx a partir de uma lista de linhas (objeto = colunas). */
export function downloadXlsx(filename: string, sheetName: string, rows: Record<string, unknown>[]) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}
