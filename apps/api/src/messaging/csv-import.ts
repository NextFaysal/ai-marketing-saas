import Papa from "papaparse";
import { normalizeBdPhone } from "./sms.provider";

/**
 * MX10 — CSV contact-import hygiene (pure; the service supplies
 * the org's existing-address set from the database). The wizard
 * runs this BEFORE any commit: every row comes back either
 * "clean" or "excluded" WITH a reason — duplicates (within the
 * file AND against existing contacts), invalid addresses and
 * role addresses are never silently dropped and never imported.
 *
 * Parsing follows the repo's existing CSV pattern
 * (imports/csv.ts — papaparse with a header row). The mapping
 * step maps the file's header names onto name/email/phone.
 */

export interface CsvImportMapping { name?: string; email?: string; phone?: string }

export type CsvRowReason = "duplicate_in_file" | "duplicate_existing" | "invalid_email" | "invalid_phone" | "missing_address" | "role_address";

export interface CsvRowOutcome {
  /** 1-based data row number (header excluded), imports/csv.ts style. */
  row: number;
  name: string;
  email: string;
  phone: string;
  /** The channel address this row would be consented for, normalized. */
  address: string;
  status: "clean" | "excluded";
  reason?: CsvRowReason;
  reasonText?: string;
}

/** Role / functional local-parts: real mailboxes, but not a
 * person who consented — flagged and excluded with a reason. */
export const ROLE_LOCAL_PARTS = new Set([
  "info", "admin", "support", "help", "contact", "office", "mail",
  "webmaster", "postmaster", "noreply", "no-reply", "sales",
  "billing", "hello", "team", "orders", "service", "careers", "jobs",
]);

export function isRoleEmail(email: string): boolean {
  const local = String(email ?? "").trim().toLowerCase().split("@")[0] ?? "";
  return ROLE_LOCAL_PARTS.has(local);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseContactsCsv(csvText: string): { headers: string[]; records: Record<string, string>[] } {
  const parsed = Papa.parse<Record<string, unknown>>(String(csvText ?? ""), { header: true, skipEmptyLines: true });
  const headers = (parsed.meta.fields ?? []).map((h) => String(h));
  const records = (parsed.data ?? []).map((r) => {
    const out: Record<string, string> = {};
    for (const h of headers) out[h] = r[h] === null || r[h] === undefined ? "" : String(r[h]).trim();
    return out;
  }).filter((r) => Object.values(r).some((v) => v !== ""));
  return { headers, records };
}

/** The normalized channel address for one row ("" when absent). */
export function rowAddress(channel: string, email: string, phone: string): string {
  if (channel === "email") return email.trim().toLowerCase();
  return normalizeBdPhone(phone) ?? phone.replace(/\D/g, "");
}

/**
 * Classify every row. `existingAddresses` holds the org's
 * existing contact addresses for the channel, normalized the
 * same way. First occurrence of an address in the file wins;
 * later ones are duplicate_in_file.
 */
export function classifyCsvRows(input: {
  records: Record<string, string>[];
  mapping: CsvImportMapping;
  channel: string;
  existingAddresses: Set<string>;
}): { rows: CsvRowOutcome[]; cleanCount: number; duplicateCount: number; invalidCount: number; roleCount: number } {
  const rows: CsvRowOutcome[] = [];
  const seenInFile = new Set<string>();
  let duplicateCount = 0, invalidCount = 0, roleCount = 0;
  input.records.forEach((rec, i) => {
    const name = input.mapping.name ? (rec[input.mapping.name] ?? "") : "";
    const email = input.mapping.email ? (rec[input.mapping.email] ?? "") : "";
    const phone = input.mapping.phone ? (rec[input.mapping.phone] ?? "") : "";
    const address = rowAddress(input.channel, email, phone);
    const base = { row: i + 1, name, email, phone, address };
    const exclude = (reason: CsvRowReason, reasonText: string): CsvRowOutcome => ({ ...base, status: "excluded", reason, reasonText });
    if (!address) { invalidCount++; rows.push(exclude("missing_address", `No ${input.channel === "email" ? "email" : "phone"} value in the mapped column`)); return; }
    if (input.channel === "email") {
      if (!EMAIL_RE.test(address)) { invalidCount++; rows.push(exclude("invalid_email", `Invalid email address: ${email}`)); return; }
      if (isRoleEmail(address)) { roleCount++; rows.push(exclude("role_address", `Role address (${address.split("@")[0]}@) — not an individual subscriber`)); return; }
    } else if (address.replace(/\D/g, "").length < 10) {
      invalidCount++; rows.push(exclude("invalid_phone", `Invalid phone number: ${phone}`)); return;
    }
    if (seenInFile.has(address)) { duplicateCount++; rows.push(exclude("duplicate_in_file", "Same address appears earlier in this file")); return; }
    seenInFile.add(address);
    if (input.existingAddresses.has(address)) { duplicateCount++; rows.push(exclude("duplicate_existing", "Address already exists as a contact in this organization")); return; }
    rows.push({ ...base, status: "clean" });
  });
  return { rows, cleanCount: rows.filter((r) => r.status === "clean").length, duplicateCount, invalidCount, roleCount };
}
