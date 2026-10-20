/**
 * AB8 (AX21/AX25) — dashboard surfaces: pure helpers for the
 * developer API keys card, the data & backup card and the
 * audit-log page. Side-effect free, unit-testable. Shapes mirror
 * the fixed API contracts exactly; nulls render as honest
 * placeholders, never fabricated values.
 */

import type { UiLocale } from "./i18n/dict";
import { sharedBn, sharedEn } from "./i18n/shared";

/** MB2 F2: label copy resolves through the `shared` namespace;
 * every helper keeps locale default "bn" so existing
 * callers/tests stay byte-identical. */
const SD = (locale: UiLocale = "bn"): typeof sharedBn =>
  locale === "en" ? sharedEn : sharedBn;

/* ---------------- AX21: merchant API keys ---------------- */

export const MERCHANT_API_SCOPES = [
  { key: "products:read", label: sharedBn.scopeProductsRead, labelEn: sharedEn.scopeProductsRead },
  { key: "products:write", label: sharedBn.scopeProductsWrite, labelEn: sharedEn.scopeProductsWrite },
  { key: "orders:read", label: sharedBn.scopeOrdersRead, labelEn: sharedEn.scopeOrdersRead },
  { key: "customers:read", label: sharedBn.scopeCustomersRead, labelEn: sharedEn.scopeCustomersRead },
] as const;

export type MerchantApiScope = (typeof MERCHANT_API_SCOPES)[number]["key"];

/** Scope rows with a single resolved `label` for the locale. */
export function merchantApiScopesFor(locale: UiLocale = "bn"): { key: MerchantApiScope; label: string }[] {
  return MERCHANT_API_SCOPES.map((s) => ({
    key: s.key,
    label: locale === "en" ? s.labelEn : s.label,
  }));
}

export function merchantApiScopeLabel(scope: string, locale: UiLocale = "bn"): string {
  const found = MERCHANT_API_SCOPES.find((s) => s.key === scope);
  if (!found) return scope;
  return locale === "en" ? found.labelEn : found.label;
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

export function merchantApiKeyStatusLabel(status: string, locale: UiLocale = "bn"): string {
  const d = SD(locale);
  switch (status) {
    case "active": return d.keyStatusActive;
    case "revoked": return d.keyStatusRevoked;
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
export function validateMerchantKeyDraft(name: string, scopes: readonly string[], locale: UiLocale = "bn"): string | null {
  const d = SD(locale);
  if (!name.trim()) return d.keyNameRequired;
  if (name.trim().length > 80) return d.keyNameTooLong;
  if (scopes.length === 0) return d.keyScopeRequired;
  const allowed = new Set<string>(MERCHANT_API_SCOPES.map((s) => s.key));
  if (scopes.some((s) => !allowed.has(s))) return d.keyScopeInvalid;
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

export function dataExportKindLabel(kind: string, locale: UiLocale = "bn"): string {
  const d = SD(locale);
  switch (kind) {
    case "manual": return d.exportKindManual;
    case "backup": return d.exportKindBackup;
    default: return kind;
  }
}

export function dataExportStatusLabel(status: string, locale: UiLocale = "bn"): string {
  const d = SD(locale);
  switch (status) {
    case "pending": return d.exportStatusPending;
    case "ready": return d.exportStatusReady;
    case "failed": return d.exportStatusFailed;
    case "expired": return d.exportStatusExpired;
    default: return status;
  }
}

/** A download is offered only for a ready export (the API also
 * refuses anything else / past expiry). */
export function canDownloadExport(row: Pick<DataExportRow, "status"> | null | undefined): boolean {
  return row?.status === "ready";
}

/** Byte size → human size in the locale's digits; null = "—"
 * (unknown, never a fabricated 0). Mirrors the settings-page
 * byte format. The bn path is byte-identical to the original
 * Bengali-digit format ("০ বাইট", bn-BD grouping). */
export function formatExportSize(sizeBytes: number | null | undefined, locale: UiLocale = "bn"): string {
  if (sizeBytes == null || !Number.isFinite(sizeBytes) || sizeBytes < 0) return "—";
  const units = [SD(locale).sizeUnitByte, "KB", "MB", "GB", "TB"];
  let v = sizeBytes; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toLocaleString(locale === "en" ? "en-IN" : "bn-BD", { maximumFractionDigits: 2 })} ${units[i]}`;
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

/** Import table labels per locale (bn record is the source). */
export function importTableLabelsFor(locale: UiLocale = "bn"): Record<string, string> {
  const d = SD(locale);
  return {
    organization: d.tblOrganization,
    businessProfile: d.tblBusinessProfile,
    members: d.tblMembers,
    products: d.tblProducts,
    orders: d.tblOrders,
    customers: d.tblCustomers,
    leads: d.tblLeads,
    conversations: d.tblConversations,
    campaignPlans: d.tblCampaignPlans,
    integrations: d.tblIntegrations,
    subscription: d.tblSubscription,
    payments: d.tblPayments,
    supportTickets: d.tblSupportTickets,
    orderItems: d.tblOrderItems,
    mediaAssets: d.tblMediaAssets,
  };
}

export function dataImportTableLabel(table: string, locale: UiLocale = "bn"): string {
  return importTableLabelsFor(locale)[table] ?? table;
}

/** Import skip-reason labels per locale (bn record is the source). */
export function importSkipReasonLabelsFor(locale: UiLocale = "bn"): Record<string, string> {
  const d = SD(locale);
  return {
    target_identity_kept: d.skipTargetIdentity,
    people_not_restored: d.skipPeopleNotRestored,
    billing_state_not_transferred: d.skipBillingState,
    billing_ledger_not_transferred: d.skipBillingLedger,
    connections_not_restored: d.skipConnectionsNotRestored,
    transcripts_not_in_bundle: d.skipTranscriptsNotInBundle,
    ad_children_not_in_bundle: d.skipAdChildrenNotInBundle,
    messages_not_in_bundle: d.skipMessagesNotInBundle,
    bytes_not_in_bundle: d.skipBytesNotInBundle,
  };
}

export function dataImportSkipReasonLabel(reason: string | undefined, locale: UiLocale = "bn"): string {
  if (!reason) return "";
  return importSkipReasonLabelsFor(locale)[reason] ?? reason;
}

/** Import error labels per locale (bn record is the source). */
export function importErrorLabelsFor(locale: UiLocale = "bn"): Record<string, string> {
  const d = SD(locale);
  return {
    target_org_not_empty: d.impErrTargetNotEmpty,
    bundle_not_an_object: d.impErrBundleNotObject,
    import_row_cap_exceeded: d.impErrRowCapExceeded,
  };
}

export function dataImportErrorLabel(error: string, locale: UiLocale = "bn"): string {
  const d = SD(locale);
  const table = importErrorLabelsFor(locale);
  if (table[error]) return table[error];
  if (error.startsWith("credential_field_present:")) {
    return d.impErrCredentialField;
  }
  if (error.startsWith("source_table_truncated:")) {
    return d.impErrSourceTruncated;
  }
  if (error.startsWith("row_count_mismatch:") || error.startsWith("malformed") || error.startsWith("unexpected") || error.startsWith("duplicate") || error.startsWith("dangling")) {
    return d.impErrDataInconsistent;
  }
  return error;
}

export function dataImportJobStatusLabel(status: string, locale: UiLocale = "bn"): string {
  const d = SD(locale);
  switch (status) {
    case "running": return d.jobStatusRunning;
    case "completed": return d.jobStatusCompleted;
    case "failed": return d.jobStatusFailed;
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
