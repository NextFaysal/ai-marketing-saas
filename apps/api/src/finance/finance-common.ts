import * as ExcelJS from "exceljs";
import { minorToMajor, toCsv } from "../imports/csv";

/**
 * GB8 (GC19/GC20) — shared finance helpers.
 *
 * Range convention mirrors EC23 (AccountingService.parsePeriod)
 * and ON7 (OrderProfitService.resolveRange): Dhaka calendar days,
 * `from` 00:00 → `to` 23:59:59.999 +06:00, default = the last 30
 * Dhaka days ending today, max span 366 days, rolled-over dates
 * rejected. Every figure in this module is computed from source
 * records (orders, return requests, payment transactions,
 * shipments, reconciliation rows, expense rows) — a "ledger" here
 * is a formal VIEW over those records, never a second set of
 * books.
 */

export interface FinanceRange {
  from: string; // YYYY-MM-DD (Dhaka)
  to: string; // YYYY-MM-DD (Dhaka)
  fromDate: Date;
  toDate: Date; // inclusive end-of-day instant
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function dhakaDateKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function addDaysToKey(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00+06:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return dhakaDateKey(d);
}

export function parseFinanceRange(from?: string, to?: string, now: Date = new Date()): FinanceRange {
  const today = dhakaDateKey(now);
  const f = from && DATE_KEY.test(from) ? from : addDaysToKey(today, -29);
  const t = to && DATE_KEY.test(to) ? to : today;
  const fromDate = new Date(`${f}T00:00:00+06:00`);
  const toDate = new Date(`${t}T23:59:59.999+06:00`);
  // Reject impossible dates (2026-02-31 rolls over — the key
  // round-trip catches it).
  if (Number.isNaN(fromDate.getTime()) || dhakaDateKey(fromDate) !== f) throw new Error("শুরুর তারিখটি সঠিক নয়");
  if (Number.isNaN(toDate.getTime()) || dhakaDateKey(toDate) !== t) throw new Error("শেষের তারিখটি সঠিক নয়");
  if (fromDate.getTime() > toDate.getTime()) throw new Error("শুরুর তারিখ শেষের তারিখের পরে হতে পারে না");
  const spanDays = Math.round((toDate.getTime() - fromDate.getTime()) / 86400_000);
  if (spanDays > 366) throw new Error("একবারে সর্বোচ্চ ৩৬৬ দিনের রিপোর্ট দেখা যাবে");
  return { from: f, to: t, fromDate, toDate };
}

/** EC23 convention: an order belongs to its PLACED date when one
 * is recorded (placedAt), else its creation date. */
export function orderEffectiveDate(o: { placedAt?: Date | string | null; createdAt: Date | string }): Date {
  return new Date((o.placedAt ?? o.createdAt) as any);
}

export function inRange(d: Date, range: FinanceRange): boolean {
  const t = d.getTime();
  return t >= range.fromDate.getTime() && t <= range.toDate.getTime();
}

/** Statuses that never count as sales anywhere in this module
 * (GB7's NON_COUNTING mirror). */
export const NON_COUNTING_STATUSES = ["cancelled", "failed", "refunded"];

/**
 * Sold-bucket predicate — a deliberate mirror of ON7's
 * OrderProfitService.isSoldOrder (itself a mirror of EC33's):
 * dead = cancelled / refunded / failed; sold = completed or
 * delivered, OR any shipment delivered / partially delivered.
 * Kept as a local mirror (not an import) for the same
 * module-cycle reason ON7 states.
 */
const DEAD = new Set(["cancelled", "refunded", "failed"]);
export function isSoldOrderShape(status: string, shipmentStatuses: string[]): boolean {
  if (DEAD.has(status)) return false;
  if (status === "completed" || status === "delivered") return true;
  return shipmentStatuses.some((s) => s === "delivered" || s === "partial_delivered");
}

/** Group flat rows (shipments, verifications) by their orderId —
 * Order has NO shipments/paymentVerifications relations in the
 * schema, so every consumer loads those tables separately (the
 * ON7/EC23 pattern). */
export function groupByOrderId(rows: any[]): Map<string, any[]> {
  const map = new Map<string, any[]>();
  for (const r of rows ?? []) {
    const key = String(r.orderId ?? "");
    if (!key) continue;
    const arr = map.get(key) ?? [];
    arr.push(r);
    map.set(key, arr);
  }
  return map;
}

export function toBig(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return BigInt(v.trim());
  return 0n;
}

// ---------------- one exporter (CSV + XLSX from the same rows) ---

export interface ReportSection {
  title: string;
  headers: string[];
  rows: unknown[][];
}

/**
 * CSV: sections stacked in the ON7 sectioned style — a `# <title>`
 * lead row, the header row, then the data rows. Optional note
 * lines are emitted first as `# ...` rows.
 */
export function sectionsToCsv(sections: ReportSection[], notes: string[] = []): string {
  const blocks: string[] = [];
  if (notes.length) blocks.push(notes.map((n) => `# ${n}`).join("\n"));
  for (const s of sections) {
    blocks.push([`# ${s.title}`, toCsv(s.headers, s.rows)].join("\n"));
  }
  return blocks.join("\n\n") + "\n";
}

function sheetName(raw: string, used: Set<string>): string {
  let name = raw.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Sheet";
  if (used.has(name)) name = `${name.slice(0, 27)} ${used.size + 1}`;
  used.add(name);
  return name;
}

/** XLSX: one worksheet per section (exceljs, the GB2 pattern). */
export async function sectionsToXlsx(sections: ReportSection[], notes: string[] = []): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const used = new Set<string>();
  if (notes.length) {
    const ws = wb.addWorksheet(sheetName("নোট", used));
    for (const n of notes) ws.addRow([n]);
  }
  for (const s of sections) {
    const ws = wb.addWorksheet(sheetName(s.title, used));
    ws.addRow(s.headers);
    for (const row of s.rows) ws.addRow(row.map((c) => (c === null || c === undefined ? "" : c)));
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

export interface BuiltFile {
  filename: string;
  contentType: string;
  body: Buffer | string;
  summary: string;
}

export async function buildFileFromSections(
  baseName: string,
  sections: ReportSection[],
  format: "csv" | "xlsx",
  summary: string,
  notes: string[] = [],
): Promise<BuiltFile> {
  if (format === "xlsx") {
    return {
      filename: `${baseName}.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body: await sectionsToXlsx(sections, notes),
      summary,
    };
  }
  return {
    filename: `${baseName}.csv`,
    contentType: "text/csv; charset=utf-8",
    body: sectionsToCsv(sections, notes),
    summary,
  };
}

/** Money cell for exports: taka with 2 decimals, integer math. */
export function takaCell(minor: bigint): string {
  return minorToMajor(minor);
}

/** "৳1,234.50" for email summaries. */
export function takaText(minor: bigint): string {
  const major = minorToMajor(minor);
  const [whole, frac] = major.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `৳${grouped}.${frac ?? "00"}`;
}
