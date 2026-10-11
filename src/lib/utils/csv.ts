/**
 * RFC 4180 CSV writer. Cells containing a delimiter, quote or line break are
 * quoted with doubled quotes. Text cells starting with = + - @ (or tab / CR)
 * are prefixed with an apostrophe so spreadsheet apps never evaluate them as
 * formulas (CSV injection). Numbers are written as-is.
 */
export type CsvValue = string | number | boolean | null | undefined;

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let text = typeof value === "boolean" ? String(value) : value;
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** UTF-8 BOM so Excel opens non-ASCII (₹, Hindi names) correctly. */
export const CSV_BOM = "\uFEFF";

export function toCsv(rows: CsvValue[][], { bom = true }: { bom?: boolean } = {}): string {
  const body = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  return (bom ? CSV_BOM : "") + body + "\r\n";
}
