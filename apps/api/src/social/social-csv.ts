/**
 * SU11 — pure CSV parser for the bulk draft import.
 *
 * A small RFC-4180-style parser (no dependency): quoted fields may
 * contain commas, CR/LF newlines and "" escaped quotes; both CRLF
 * and LF record separators work; a leading BOM is stripped.
 * Kept pure and separate so the grammar is spec-pinned in
 * social-su11.spec.ts without any service/Prisma harness.
 */

export interface ParsedCsv {
  /** Header names, trimmed, in file order. */
  headers: string[];
  /** One entry per non-blank data record. `row` is the 1-based
   * spreadsheet row number (header = row 1, first data row = 2). */
  rows: { row: number; values: Record<string, string> }[];
}

/** Split raw CSV text into records of raw field strings. */
export function splitCsvRecords(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "")
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let recordHasContent = false;
  const endField = () => { record.push(field); field = ""; };
  const endRecord = () => {
    endField();
    // A physically blank line (a single empty field, nothing else)
    // is not a data row — spreadsheets and editors emit them freely.
    if (!(record.length === 1 && record[0] === "" && !recordHasContent)) records.push(record);
    record = [];
    recordHasContent = false;
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") { inQuotes = true; recordHasContent = true; continue; }
    if (ch === ",") { endField(); recordHasContent = true; continue; }
    if (ch === "\r") {
      if (src[i + 1] === "\n") i++;
      endRecord();
      continue;
    }
    if (ch === "\n") { endRecord(); continue; }
    field += ch;
    if (ch !== " " && ch !== "\t") recordHasContent = true;
  }
  // Trailing record without a final newline.
  if (field !== "" || record.length > 0 || recordHasContent) endRecord();
  return records;
}

/** Parse CSV text into headers + keyed rows. An empty text (or a
 * header-less one) yields empty headers/rows — the caller decides
 * the Bengali error for that. Extra fields beyond the header are
 * dropped; missing trailing fields read as "". */
export function parseCsv(text: string): ParsedCsv {
  const records = splitCsvRecords(typeof text === "string" ? text : "");
  if (records.length === 0) return { headers: [], rows: [] };
  const headers = records[0].map((h) => h.trim());
  const rows = records.slice(1).map((fields, i) => {
    const values: Record<string, string> = {};
    headers.forEach((h, idx) => { values[h] = (fields[idx] ?? "").trim(); });
    return { row: i + 2, values };
  });
  return { headers, rows };
}
