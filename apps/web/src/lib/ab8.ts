/**
 * AB8 (AX21/AX25) — dashboard surfaces: pure helpers for the
 * developer API keys card, the data & backup card and the
 * audit-log page. Side-effect free, unit-testable. Shapes mirror
 * the fixed API contracts exactly; nulls render as honest
 * placeholders, never fabricated values.
 */

/* ---------------- AX21: merchant API keys ---------------- */

export const MERCHANT_API_SCOPES = [
  { key: "products:read", label: "পণ্য পড়া (products:read)" },
  { key: "products:write", label: "পণ্য লেখা/বদলানো (products:write)" },
  { key: "orders:read", label: "অর্ডার পড়া (orders:read)" },
  { key: "customers:read", label: "গ্রাহক পড়া (customers:read)" },
] as const;

export type MerchantApiScope = (typeof MERCHANT_API_SCOPES)[number]["key"];

export function merchantApiScopeLabel(scope: string): string {
  return MERCHANT_API_SCOPES.find((s) => s.key === scope)?.label ?? scope;
}

export interface MerchantApiKeyRecord {
  id: string;
  name: string;
  /** First 8 chars of the random segment (API contract). */
  keyPrefix: string;
  scopes: string[];
  status: string; // active | revoked
  lastUsedAt: string | null;
  createdAt: string;
  createdById: string;
}

export interface CreatedMerchantApiKey {
  /** Plaintext key — returned exactly once at creation. */
  key: string;
  record: MerchantApiKeyRecord;
}

/**
 * Display form of a stored key: the plaintext is never stored,
 * so a listed key can only ever be shown as its prefix.
 * `qk_live_<keyPrefix>…`
 */
export function formatMerchantKeyPrefix(keyPrefix: string | null | undefined): string {
  const p = (keyPrefix ?? "").trim();
  if (!p) return "—";
  return `qk_live_${p}…`;
}

export function merchantApiKeyStatusLabel(status: string): string {
  switch (status) {
    case "active": return "সক্রিয়";
    case "revoked": return "বাতিল করা";
    default: return status;
  }
}

/**
 * Normalize the key-list payload. The contract shape is
 * `{ items: [...] }`; the delivered API currently returns the
 * bare array — accept BOTH so the card never renders an empty
 * list for a shape it should have understood. Anything else
 * degrades to an empty list, never a crash.
 */
export function merchantKeysFromPayload(payload: unknown): MerchantApiKeyRecord[] {
  if (Array.isArray(payload)) return payload as MerchantApiKeyRecord[];
  if (payload && typeof payload === "object" && Array.isArray((payload as { items?: unknown }).items)) {
    return (payload as { items: MerchantApiKeyRecord[] }).items;
  }
  return [];
}

/** Validates the create form before it is sent (server re-checks;
 * the create DTO caps the name at 80 chars). */
export function validateMerchantKeyDraft(name: string, scopes: readonly string[]): string | null {
  if (!name.trim()) return "কী-এর নাম লিখুন।";
  if (name.trim().length > 80) return "কী-এর নাম সর্বোচ্চ ৮০ অক্ষরের হতে পারবে।";
  if (scopes.length === 0) return "অন্তত একটি স্কোপ বেছে নিন।";
  const allowed = new Set<string>(MERCHANT_API_SCOPES.map((s) => s.key));
  if (scopes.some((s) => !allowed.has(s))) return "একটি স্কোপ সঠিক নয়।";
  return null;
}

/* ---------------- AX25: data exports + backup ---------------- */

export interface DataExportRow {
  id: string;
  kind: string; // manual | backup
  status: string; // pending | ready | failed | expired
  sizeBytes: number | null;
  error?: string | null;
  expiresAt: string | null;
  createdAt: string;
  completedAt?: string | null;
  requestedById?: string | null;
  // OU12: last backup verification (restore-readiness check)
  // recorded on the row — null until a verification has run.
  backupVerifiedAt?: string | null;
  backupVerification?: BackupVerification | null;
}

/** OU12: the recorded verification result shape (API-owned). */
export interface BackupVerification {
  ok: boolean;
  problems: string[];
  truncatedTables: string[];
  sectionsPresent?: string[];
  nonRestorableSections?: Array<{ section: string; reason: string }>;
}

export interface BackupPreference {
  enabled: boolean;
  lastBackupAt: string | null;
}

export interface DataExportsPayload {
  items: DataExportRow[];
  backupPreference: BackupPreference;
}

/**
 * Normalize the exports-list payload. The contract shape is
 * `{ items, backupPreference }`; the delivered API currently
 * returns the rows under `exports` instead — accept BOTH.
 * A missing preference degrades to the honest default
 * (disabled, never backed up), never an invented state.
 */
export function dataExportsFromPayload(payload: unknown): DataExportsPayload {
  const p = (payload && typeof payload === "object" ? payload : {}) as {
    items?: unknown; exports?: unknown; backupPreference?: Partial<BackupPreference> | null;
  };
  const items = (Array.isArray(p.items) ? p.items : Array.isArray(p.exports) ? p.exports : []) as DataExportRow[];
  return {
    items,
    backupPreference: {
      enabled: Boolean(p.backupPreference?.enabled),
      lastBackupAt: p.backupPreference?.lastBackupAt ?? null,
    },
  };
}

/** The download endpoint streams a JSON file (the API sets
 * Content-Type application/json) — name the saved file .json,
 * never .zip. */
export function exportDownloadFilename(exportId: string): string {
  return `data-export-${exportId}.json`;
}

export function dataExportKindLabel(kind: string): string {
  switch (kind) {
    case "manual": return "ম্যানুয়াল";
    case "backup": return "স্বয়ংক্রিয় ব্যাকআপ";
    default: return kind;
  }
}

export function dataExportStatusLabel(status: string): string {
  switch (status) {
    case "pending": return "তৈরি হচ্ছে…";
    case "ready": return "প্রস্তুত";
    case "failed": return "ব্যর্থ";
    case "expired": return "মেয়াদ শেষ";
    default: return status;
  }
}

/** A download is offered only for a ready export (the API also
 * refuses anything else / past expiry). */
export function canDownloadExport(row: Pick<DataExportRow, "status"> | null | undefined): boolean {
  return row?.status === "ready";
}

/** Byte size → Bengali-digit human size; null = "—" (unknown,
 * never a fabricated 0). Mirrors the settings-page byte format. */
export function formatExportSize(sizeBytes: number | null | undefined): string {
  if (sizeBytes == null || !Number.isFinite(sizeBytes) || sizeBytes < 0) return "—";
  if (sizeBytes === 0) return "০ বাইট";
  const units = ["বাইট", "KB", "MB", "GB", "TB"];
  let v = sizeBytes; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toLocaleString("bn-BD", { maximumFractionDigits: 2 })} ${units[i]}`;
}

/* ---------------- ORG16: data import / restore ---------------- */

export interface DataImportTableReport {
  table: string;
  rows: number;
  action: "import" | "skip";
  reason?: string;
}

export interface DataImportReport {
  valid: boolean;
  errors: string[];
  source: { organizationName: string | null; organizationId: string | null; exportedAt: string | null } | null;
  tables: DataImportTableReport[];
  totalImportRows: number;
  strippedSensitiveFields: string[];
  nulledReferenceCounts: Record<string, number>;
  warnings: string[];
  targetEmpty: boolean | null;
  targetCounts: { products: number; orders: number; customers: number; leads: number } | null;
  targetProfileFilled: boolean | null;
  searchVectorRefreshed?: boolean;
}

export interface DataImportJob {
  id: string;
  status: string; // running | completed | failed
  fileName: string | null;
  sourceOrgName: string | null;
  report: DataImportReport | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

const IMPORT_TABLE_LABELS: Record<string, string> = {
  organization: "প্রতিষ্ঠান",
  businessProfile: "ব্যবসার প্রোফাইল",
  members: "সদস্যরা",
  products: "পণ্য",
  orders: "অর্ডার",
  customers: "ক্রেতা",
  leads: "লিড",
  conversations: "কথোপকথন",
  campaignPlans: "ক্যাম্পেইন পরিকল্পনা",
  integrations: "সংযোগসমূহ",
  subscription: "সাবস্ক্রিপশন",
  payments: "পেমেন্ট",
  supportTickets: "সাপোর্ট টিকিট",
  orderItems: "অর্ডারের আইটেম",
  mediaAssets: "মিডিয়া ফাইল",
};

export function dataImportTableLabel(table: string): string {
  return IMPORT_TABLE_LABELS[table] ?? table;
}

const SKIP_REASON_LABELS: Record<string, string> = {
  target_identity_kept: "এই প্রতিষ্ঠানের নিজের পরিচয়ই থাকবে",
  people_not_restored: "সদস্যপদ ও ব্যবহারকারী ফিরিয়ে আনা হয় না",
  billing_state_not_transferred: "বিলিং অবস্থা স্থানান্তর হয় না",
  billing_ledger_not_transferred: "বিলিং লেজার স্থানান্তর হয় না",
  connections_not_restored: "সংযোগের credential bundle-এ থাকে না",
  transcripts_not_in_bundle: "বার্তাগুলো bundle-এ নেই",
  ad_children_not_in_bundle: "বিজ্ঞাপনের বিস্তারিত bundle-এ নেই",
  messages_not_in_bundle: "টিকিটের বার্তা bundle-এ নেই",
  bytes_not_in_bundle: "ফাইলের বাইট bundle-এ নেই, শুধু তথ্য থাকে",
};

export function dataImportSkipReasonLabel(reason: string | undefined): string {
  if (!reason) return "";
  return SKIP_REASON_LABELS[reason] ?? reason;
}

const IMPORT_ERROR_LABELS: Record<string, string> = {
  target_org_not_empty: "এই প্রতিষ্ঠানটি খালি নয় — ইমপোর্ট শুধু একদম নতুন, খালি প্রতিষ্ঠানে করা যায়।",
  bundle_not_an_object: "ফাইলটি সঠিক bundle ফরম্যাটে নয়।",
  import_row_cap_exceeded: "Bundle-টি এই পদ্ধতির জন্য বড় — মোট ফিরিয়ে-আনা সারি সীমার বেশি।",
};

export function dataImportErrorLabel(error: string): string {
  if (IMPORT_ERROR_LABELS[error]) return IMPORT_ERROR_LABELS[error];
  if (error.startsWith("credential_field_present:")) {
    return "Bundle-এ credential-জাতীয় তথ্য আছে — নিরাপত্তার কারণে পুরো bundle বাতিল করা হয়েছে।";
  }
  if (error.startsWith("source_table_truncated:")) {
    return "উৎস এক্সপোর্টটি অসম্পূর্ণ ছিল (কিছু ডেটা কাটা পড়েছিল) — অসম্পূর্ণ bundle ফিরিয়ে আনা হয় না।";
  }
  if (error.startsWith("row_count_mismatch:") || error.startsWith("malformed") || error.startsWith("unexpected") || error.startsWith("duplicate") || error.startsWith("dangling")) {
    return "Bundle-এর ভেতরের ডেটায় অসঙ্গতি আছে — ফাইলটি বদলানো বা নষ্ট হয়ে থাকতে পারে।";
  }
  return error;
}

export function dataImportJobStatusLabel(status: string): string {
  switch (status) {
    case "running": return "চলছে…";
    case "completed": return "সম্পন্ন";
    case "failed": return "ব্যর্থ";
    default: return status;
  }
}

/* ---------------- AX25: audit logs ---------------- */

export interface AuditLogActor { id: string; email: string; name: string | null }

export interface AuditLogRow {
  id: string;
  createdAt: string;
  actor: AuditLogActor | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
}

export interface AuditLogsPayload {
  total: number;
  page: number;
  pageSize: number;
  /** Honesty marker from the API: only org-stamped rows exist. */
  scopeNote: string;
  items: AuditLogRow[];
}

export interface AuditLogFilters {
  entity: string;
  actorId: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
}

/** Build the audit-log query string; empty filters are omitted
 * entirely (never sent as blank params). */
export function buildAuditLogQuery(f: AuditLogFilters): string {
  const q = new URLSearchParams();
  if (f.entity.trim()) q.set("entity", f.entity.trim());
  if (f.actorId.trim()) q.set("actorId", f.actorId.trim());
  if (f.from.trim()) q.set("from", f.from.trim());
  if (f.to.trim()) q.set("to", f.to.trim());
  q.set("page", String(Math.max(1, Math.floor(f.page) || 1)));
  q.set("pageSize", String(f.pageSize));
  return q.toString();
}

export function auditLogTotalPages(total: number, pageSize: number): number {
  if (!pageSize || pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
}

/**
 * Metadata → display TEXT only. The caller renders the result as
 * a React text node (never dangerouslySetInnerHTML), so markup
 * inside metadata can never execute — it is shown verbatim.
 * Unstringifiable values degrade to an honest placeholder.
 */
export function auditMetadataText(metadata: unknown): string {
  if (metadata == null) return "—";
  if (typeof metadata === "string") return metadata;
  try {
    return JSON.stringify(metadata, null, 2) ?? "—";
  } catch {
    return "—";
  }
}

/** One-line summary for the table column: the full pretty text
 * collapsed so a row stays compact (detail remains in title). */
export function auditMetadataSummary(metadata: unknown): string {
  const text = auditMetadataText(metadata);
  if (text === "—") return text;
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 160 ? `${oneLine.slice(0, 160)}…` : oneLine;
}
