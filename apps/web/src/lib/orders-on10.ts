/**
 * ON10 (Orders Next): Print & Document Center — pure
 * payload-shaping helpers for the print panel. Side-effect free,
 * unit-testable. Shapes mirror the API payloads in
 * apps/api/src/orders/print-center.service.ts EXACTLY.
 *
 * Honesty notes carried from the API:
 * - A print job's PDF is streamed once at creation and NEVER
 *   stored — the history below is the job RECORD (type, counts,
 *   failed ids), not a re-download.
 * - logoUrl is stored + validated by the API but does not
 *   render yet (the dependency-free PDF toolkit cannot embed
 *   raster images) — the form says so, it never pretends.
 */

export type PrintJobType = "invoices" | "labels" | "packing_slips" | "challans";

export const PRINT_TYPE_OPTIONS: { value: PrintJobType; label: string; hint: string }[] = [
  { value: "invoices", label: "ইনভয়েস", hint: "প্রতি অর্ডারে এক পৃষ্ঠা — টেমপ্লেট সেটিংস প্রযোজ্য" },
  { value: "labels", label: "শিপিং লেবেল", hint: "সর্বশেষ কুরিয়ার শিপমেন্ট থেকে; বুকিং না থাকলে ওই অর্ডার ব্যর্থ তালিকায় যাবে" },
  { value: "packing_slips", label: "প্যাকিং স্লিপ", hint: "সার্ভার-তৈরি স্লিপ (ওয়েব প্রিন্ট পেজের একই তথ্য) — দাম ছাড়া, উপহারের বার্তাসহ" },
  { value: "challans", label: "ডেলিভারি চালান", hint: "COD বকেয়াসহ হস্তান্তর দলিল (মোট − অনুমোদিত পেমেন্ট)" },
];

export interface PrintJobRow {
  id: string;
  organizationId: string;
  type: PrintJobType | string;
  orderIds: string[];
  orderCount: number;
  failedOrderIds: string[];
  status: "done" | "failed" | string;
  error: string | null;
  createdById: string | null;
  createdAt: string | null;
}

export interface PrintJobList {
  items: PrintJobRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PrintTemplate {
  logoUrl: string | null;
  footerText: string | null;
  termsText: string | null;
  invoiceNote: string | null;
  updatedAt: string | null;
}

export function printTypeLabel(type: string): string {
  return PRINT_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

export function printJobStatusLabel(job: PrintJobRow): string {
  if (job.status === "failed") return "ব্যর্থ";
  if (job.failedOrderIds.length > 0) return `হয়েছে (${job.failedOrderIds.length}টি বাদ)`;
  return "হয়েছে";
}

/**
 * Parse a pasted list of order ids (the Print Center's manual
 * entry): split on whitespace / commas / newlines, trim, drop
 * empties, dedupe preserving order. Returns the ids plus how
 * many were dropped as duplicates (the panel shows it — no
 * silent shrinking).
 */
export function parseOrderIdsInput(text: string): { ids: string[]; duplicatesDropped: number } {
  const parts = String(text ?? "").split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  const ids: string[] = [];
  let duplicatesDropped = 0;
  for (const p of parts) {
    if (seen.has(p)) { duplicatesDropped++; continue; }
    seen.add(p);
    ids.push(p);
  }
  return { ids, duplicatesDropped };
}

/** Merge the page selection with pasted ids (selection first). */
export function mergeOrderIds(selected: string[], pastedText: string): { ids: string[]; duplicatesDropped: number } {
  const pasted = parseOrderIdsInput(pastedText);
  const seen = new Set<string>();
  const ids: string[] = [];
  let duplicatesDropped = pasted.duplicatesDropped;
  for (const id of [...selected, ...pasted.ids]) {
    if (seen.has(id)) { duplicatesDropped++; continue; }
    seen.add(id);
    ids.push(id);
  }
  return { ids, duplicatesDropped };
}

export const MAX_ORDERS_PER_JOB = 100;

/** Client-side mirror of the API's template validation (the API
 * stays authoritative — this only fails fast). Empty string =
 * clear the field (sent as null). */
export function validateTemplateForm(form: PrintTemplate): string | null {
  const logo = (form.logoUrl ?? "").trim();
  if (logo && !/^https?:\/\/\S+$/.test(logo)) return "লোগোর URL অবশ্যই http:// বা https:// দিয়ে শুরু হতে হবে";
  const caps: [keyof PrintTemplate, number][] = [["logoUrl", 500], ["footerText", 200], ["termsText", 1000], ["invoiceNote", 500]];
  for (const [field, cap] of caps) {
    const v = (form[field] ?? "") as string;
    if (v.length > cap) return `${field} সর্বোচ্চ ${cap} অক্ষর হতে পারবে`;
  }
  return null;
}

/** The PUT payload: trimmed strings, empty → null (full replace,
 * exactly the API's semantics). */
export function templatePayload(form: PrintTemplate): { logoUrl: string | null; footerText: string | null; termsText: string | null; invoiceNote: string | null } {
  const clean = (v: string | null) => {
    const t = (v ?? "").trim();
    return t ? t : null;
  };
  return { logoUrl: clean(form.logoUrl), footerText: clean(form.footerText), termsText: clean(form.termsText), invoiceNote: clean(form.invoiceNote) };
}

export function buildPrintJobsPath(orgId: string, page = 1, pageSize = 20): string {
  return `/organizations/${orgId}/orders/print-jobs?page=${page}&pageSize=${pageSize}`;
}
