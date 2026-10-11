/**
 * Minimal RFC 4180 CSV parser (quoted cells, escaped quotes, embedded
 * newlines, CRLF, UTF-8 BOM). Delimiter is auto-detected from the header
 * line (comma, semicolon or tab) so Excel exports in any locale work.
 */
export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  /** 1-based CSV record number of each row (header = 1, blank records counted). */
  rowNumbers: number[];
  /** Cell count of each row, to detect rows wider than the header. */
  cellCounts: number[];
  /** True when the file ends inside a quoted cell (malformed CSV). */
  unterminatedQuote: boolean;
}

export function parseCsv(text: string): ParsedCsv {
  const src = text.replace(/^\uFEFF/, "");
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const delimiter = [",", ";", "\t"].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best, ",");

  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      record.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      record.push(cell);
      records.push(record);
      record = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || record.length > 0) {
    record.push(cell);
    records.push(record);
  }

  const nonEmpty = records
    .map((r, idx) => ({ r, n: idx + 1 }))
    .filter(({ r }) => r.some((c) => c.trim() !== ""));
  const [headerRow, ...dataRows] = nonEmpty;
  if (!headerRow) return { headers: [], rows: [], rowNumbers: [], cellCounts: [], unterminatedQuote: inQuotes };

  const headers = headerRow.r.map((h) => h.trim());
  const rows = dataRows.map(({ r }) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (h) obj[h] = (r[idx] ?? "").trim();
    });
    return obj;
  });
  return {
    headers,
    rows,
    rowNumbers: dataRows.map(({ n }) => n),
    cellCounts: dataRows.map(({ r }) => r.length),
    unterminatedQuote: inQuotes,
  };
}
