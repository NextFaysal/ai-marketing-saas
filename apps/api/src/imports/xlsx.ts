import * as ExcelJS from "exceljs";
import { parseProductRecords, ParseResult } from "./csv";

/**
 * GB2 (GC6 §3): Excel (.xlsx) front-end for product imports. Reads the
 * FIRST worksheet, treats its first row as headers (normalized exactly
 * like the CSV parser's papaparse transformHeader: trim, lowercase,
 * spaces -> underscores) and delegates row mapping/validation to
 * parseProductRecords, so CSV and XLSX files with the same columns
 * produce identical ParseResults.
 *
 * Throws a plain Error with a clear message when the file cannot be
 * read at all; ImportsService converts that to a Bengali 400.
 */

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return String(value);
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // Formula cell: { formula, result }
    if ("result" in obj) return cellToString(obj.result);
    // Rich text cell: { richText: [{ text }, ...] }
    if (Array.isArray(obj.richText)) {
      return (obj.richText as Array<Record<string, unknown>>)
        .map((part) => (part && typeof part.text === "string" ? part.text : ""))
        .join("");
    }
    // Hyperlink cell: { text, hyperlink }
    if (typeof obj.text === "string") return obj.text;
    return String(value ?? "");
  }
  return String(value ?? "");
}

export async function parseProductsXlsx(buffer: Buffer): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as any);
  } catch (e) {
    throw new Error(`Could not read the Excel file: ${e instanceof Error ? e.message : "invalid .xlsx data"}`);
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("The Excel file contains no worksheet");
  if (worksheet.rowCount < 1) throw new Error("The Excel file is empty (no header row)");

  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];
  const columnCount = Math.max(worksheet.columnCount, headerRow.cellCount);
  for (let col = 1; col <= columnCount; col++) {
    headers.push(cellToString(headerRow.getCell(col).value).trim().toLowerCase().replace(/\s+/g, "_"));
  }

  const records: Array<Record<string, string>> = [];
  for (let r = 2; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const record: Record<string, string> = {};
    let allEmpty = true;
    for (let col = 1; col <= columnCount; col++) {
      const key = headers[col - 1];
      if (!key) continue;
      const text = cellToString(row.getCell(col).value);
      if (text.trim() !== "") allEmpty = false;
      record[key] = text;
    }
    // Mirror papaparse skipEmptyLines: "greedy" — fully-empty rows are
    // dropped entirely and do not count toward totalRows.
    if (allEmpty) continue;
    records.push(record);
  }

  return parseProductRecords(records);
}
