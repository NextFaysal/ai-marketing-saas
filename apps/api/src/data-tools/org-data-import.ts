import { randomUUID } from "node:crypto";
import { DATA_EXPORT_INLINE_MAX_ROWS } from "./data-exports.service";

/**
 * ORG16 (Organization Next OB5) — org bundle import planning.
 *
 * The pure half of bundle restore: parse-adjacent validation and
 * import planning for the file the AB8 export pipeline produces
 * ({ manifest, data } — see organizations/org-data-export.ts and
 * docs/org-ob5-import-design.md). No database access happens
 * here; DataImportsService owns emptiness checks, the job row
 * and the transaction. Everything here is deterministic except
 * id generation, which is injectable for specs.
 *
 * The governing decisions (design note §৩):
 *  - Recognition is STRUCTURAL — the export manifest carries no
 *    format/version marker, so a bundle is ours only when its
 *    exact key sets, manifest↔data row counts and row shapes all
 *    match what buildOrgDataBundle emits.
 *  - SIX tables restore (businessProfile, products, customers,
 *    leads, orders, orderItems). The other nine are skipped with
 *    stated reasons — never silently dropped, never fabricated.
 *  - Credential material anywhere it does not belong rejects the
 *    WHOLE bundle. The one position our own export legitimately
 *    carries a secret (businessProfile.metaCapiToken) is stripped
 *    and reported instead — rejecting it would make every real
 *    export unrestorable.
 *  - Every restored row gets a pre-generated NEW id; all bundle-
 *    internal references are remapped through the id maps, and
 *    references pointing outside the bundle are nulled + counted.
 */

export const BUNDLE_IMPORT_MAX_ROWS = DATA_EXPORT_INLINE_MAX_ROWS;
export const BUNDLE_JSON_MAX_LENGTH = 2_800_000;

/** The 15 manifest table keys, in the builder's own order. */
export const BUNDLE_TABLE_KEYS = [
  "organization", "businessProfile", "members", "products", "orders",
  "customers", "leads", "conversations", "campaignPlans", "integrations",
  "subscription", "payments", "supportTickets", "orderItems", "mediaAssets",
] as const;

/** data-side key for each manifest table key. */
const DATA_KEY_BY_TABLE: Record<string, string> = {
  organization: "organization",
  businessProfile: "businessProfile",
  members: "members",
  products: "products",
  orders: "orders",
  customers: "customers",
  leads: "leads",
  conversations: "conversations",
  campaignPlans: "campaignPlans",
  integrations: "integrations",
  subscription: "subscription",
  payments: "payments",
  supportTickets: "supportTickets",
  orderItems: "orderItems",
  mediaAssets: "mediaAssets",
};

/** Tables restored into the target org (execution order). */
export const IMPORT_TABLE_KEYS = [
  "businessProfile", "customers", "products", "leads", "orders", "orderItems",
] as const;

/** Skip reasons, by manifest table key (stable codes; UI labels them). */
export const SKIPPED_TABLE_REASONS: Record<string, string> = {
  organization: "target_identity_kept",
  members: "people_not_restored",
  subscription: "billing_state_not_transferred",
  payments: "billing_ledger_not_transferred",
  integrations: "connections_not_restored",
  conversations: "transcripts_not_in_bundle",
  campaignPlans: "ad_children_not_in_bundle",
  supportTickets: "messages_not_in_bundle",
  mediaAssets: "bytes_not_in_bundle",
};

const INTEGRATION_ROW_KEYS = ["id", "provider", "status", "externalAccountId", "lastSyncAt", "createdAt"];

/** Any of these in a row key marks credential material. */
const CREDENTIAL_KEY_RE = /credential|secret|password|passwd|token|api[-_]?key|private[-_]?key|auth[-_]?header/i;
/** The single position a real export legitimately carries one. */
const KNOWN_SENSITIVE_POSITION = { table: "businessProfile", key: "metaCapiToken" };
/** Deprecated duplicate of Organization.customDomain (ORG7) — never restored. */
const KNOWN_DEPRECATED_POSITION = { table: "businessProfile", key: "customDomain" };

// ---------- field whitelists (schema scalars only; relations and
// Unsupported columns — Product.searchVector — never appear) ----------

const PROFILE_FIELDS = [
  "description", "industry", "businessModel", "websiteUrl", "goals", "targetCustomers",
  "brandVoice", "uniqueSellingPoints", "monthlyBudgetMinor", "budgetCurrency", "contactEmail",
  "contactPhone", "address", "city", "businessHours", "deliveryChargeInsideMinor",
  "deliveryChargeOutsideMinor", "freeDeliveryAboveMinor", "deliveryDaysInside",
  "deliveryDaysOutside", "codAvailable", "minOrderMinor", "codMaxOrderMinor", "codBlockedDistricts",
  "codAdvanceRequiredAboveMinor", "depositMode", "depositPercent", "depositFixedMinor",
  "depositAppliesTo", "depositNote", "bkashNumber", "nagadNumber", "paymentNote",
  "advancePaymentPercent", "returnWindowDays", "aiInstructions", "aiInstructionsDraft",
  "aiReplyLanguage", "billingEmails", "billingAddress", "billingBin", "tradeLicenseNo",
  "businessAddress", "metaPixelId", "tikTokPixelId", "createdAt", "updatedAt",
];
const PROFILE_BIGINTS = [
  "monthlyBudgetMinor", "deliveryChargeInsideMinor", "deliveryChargeOutsideMinor",
  "freeDeliveryAboveMinor", "minOrderMinor", "codMaxOrderMinor",
  "codAdvanceRequiredAboveMinor", "depositFixedMinor",
];
const PROFILE_DATES = ["createdAt", "updatedAt"];

const PRODUCT_FIELDS = [
  "name", "slug", "description", "nameEn", "descriptionEn", "category", "sku", "status",
  "priceMinor", "compareAtMinor", "currency", "stockQuantity", "lowStockThreshold", "imageUrl",
  "source", "externalId", "bumpTitle", "bumpPriceMinor", "bumpImageUrl", "weightGrams",
  "lengthCm", "widthCm", "heightCm", "barcode", "seoTitle", "seoDescription", "taxRateBps",
  "preorderEnabled", "preorderReleaseDate", "preorderLimit", "isGiftCard", "giftCardConfig",
  "digital", "digitalFileUrl", "digitalAccessLimit", "digitalDeliveryType",
  "digitalLinkExpiryHours", "subscriptionEnabled", "subscriptionIntervalDays",
  "subscriptionDiscountPercent", "wholesaleTiers", "replenishmentDays",
  "replenishmentReminderText", "videoUrl", "videoPosterUrl", "freeShipping",
  "lastOosNotifiedAt", "createdAt", "updatedAt",
];
const PRODUCT_BIGINTS = ["priceMinor", "compareAtMinor", "bumpPriceMinor"];
const PRODUCT_DATES = ["preorderReleaseDate", "lastOosNotifiedAt", "createdAt", "updatedAt"];

const CUSTOMER_FIELDS = [
  "externalId", "source", "firstName", "lastName", "email", "phone", "address", "customFields",
  "unsubscribed", "referralCode", "isWholesale", "creditLimitMinor", "creditTermsDays", "tags",
  "notes", "isVip", "isBlocked", "blockedReason", "createdAt", "updatedAt",
];
const CUSTOMER_BIGINTS = ["creditLimitMinor"];
const CUSTOMER_DATES = ["createdAt", "updatedAt"];

const LEAD_FIELDS = [
  "name", "phone", "email", "source", "externalId", "stage", "tags", "valueMinor", "currency",
  "notes", "nextFollowUpAt", "lastContactedAt", "customFields", "unsubscribed",
  "createdAt", "updatedAt",
];
const LEAD_BIGINTS = ["valueMinor"];
const LEAD_DATES = ["nextFollowUpAt", "lastContactedAt", "createdAt", "updatedAt"];

const ORDER_FIELDS = [
  "externalId", "externalNumber", "source", "status", "paymentMethod", "isCod",
  "codConfirmationStatus", "codConfirmationSentAt", "storeSyncStatus", "storeSyncError",
  "isPractice", "termsConsentedAt", "termsRef", "codAdvanceRequired", "depositDueMinor",
  "checkoutFields", "tags", "riskScore", "riskBand", "riskReasons", "riskAssessedAt",
  "reviewHold", "reviewHoldReason", "reviewHeldAt", "codCallAttempts", "codLastCallAt",
  "codLastCallOutcome", "address", "internalNote", "deliveryDate", "deliveryMethod",
  "freeShippingApplied", "confirmedAt", "commissionMinor", "currency", "subtotalMinor",
  "shippingMinor", "discountMinor", "promotionDiscountMinor", "promotionsApplied",
  "referralDiscountMinor", "referralCode", "affiliateCode", "invoiceNumber", "taxBreakdown",
  "digitalAccessCount", "digitalLastAccessedAt", "wholesaleBreakdown", "priceListBreakdown",
  "creditDueDate", "utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm",
  "clickIdType", "clickId", "deviceHash", "giftSkipped", "couponCode", "appliedDiscounts",
  "giftWrapMinor", "giftMessage", "taxMinor", "totalMinor", "refundedMinor", "placedAt",
  "createdAt", "updatedAt",
];
const ORDER_BIGINTS = [
  "depositDueMinor", "commissionMinor", "subtotalMinor", "shippingMinor", "discountMinor",
  "promotionDiscountMinor", "referralDiscountMinor", "giftWrapMinor", "taxMinor",
  "totalMinor", "refundedMinor",
];
const ORDER_DATES = [
  "codConfirmationSentAt", "termsConsentedAt", "riskAssessedAt", "reviewHeldAt",
  "codLastCallAt", "confirmedAt", "digitalLastAccessedAt", "creditDueDate", "placedAt",
  "createdAt", "updatedAt",
];

const ORDER_ITEM_FIELDS = [
  "externalProductId", "externalVariationId", "name", "sku", "quantity", "priceMinor",
  "totalMinor", "isPreorder", "isGift", "bundleName", "digitalAccessCount",
  "digitalLastAccessedAt",
];
const ORDER_ITEM_BIGINTS = ["priceMinor", "totalMinor"];
const ORDER_ITEM_DATES = ["digitalLastAccessedAt"];

// ---------- types ----------

export interface BundleTableReport {
  table: string;
  rows: number;
  action: "import" | "skip";
  reason?: string;
}

export interface ImportPlan {
  profile: Record<string, any> | null;
  customers: Record<string, any>[];
  products: Record<string, any>[];
  leads: Record<string, any>[];
  orders: Record<string, any>[];
  orderItems: Record<string, any>[];
}

export interface BundleCheckOk {
  ok: true;
  sourceOrgName: string | null;
  sourceOrgId: string | null;
  exportedAt: string | null;
  tables: BundleTableReport[];
  totalImportRows: number;
  strippedSensitiveFields: string[];
  nulledReferenceCounts: Record<string, number>;
  warnings: string[];
  plan: ImportPlan;
}

export type BundleCheck = BundleCheckOk | { ok: false; errors: string[] };

// ---------- small helpers ----------

function isPlainObject(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toBigInt(v: unknown): bigint | null {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return BigInt(v.trim());
  return null;
}

function toDate(v: unknown): Date | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v === "string") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/**
 * Build one create-row from a bundle row: whitelist fields only,
 * re-type BigInt/Date columns (the export stringified them), and
 * report type errors instead of guessing.
 */
function buildRow(
  table: string,
  row: Record<string, any>,
  fields: string[],
  bigints: string[],
  dates: string[],
  errors: string[],
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of fields) {
    const v = row[f];
    if (v === undefined) continue;
    if (v === null) { out[f] = null; continue; }
    if (bigints.includes(f)) {
      const b = toBigInt(v);
      if (b === null) { errors.push(`invalid_money_value:${table}.${f}`); continue; }
      out[f] = b;
      continue;
    }
    if (dates.includes(f)) {
      const d = toDate(v);
      if (d === null) { errors.push(`invalid_date_value:${table}.${f}`); continue; }
      out[f] = d;
      continue;
    }
    out[f] = v;
  }
  return out;
}

function bump(counts: Record<string, number>, key: string, by = 1) {
  counts[key] = (counts[key] ?? 0) + by;
}

function dupCheck(values: (string | null | undefined)[], errorCode: string, errors: string[]) {
  const seen = new Set<string>();
  for (const v of values) {
    if (v === null || v === undefined || v === "") continue;
    if (seen.has(v)) { errors.push(errorCode); return; }
    seen.add(v);
  }
}

// ---------- the checker ----------

/**
 * Validate a parsed bundle and, when valid, produce the full
 * import plan (new ids pre-generated, references remapped).
 * `newId` is injectable so specs can pin the remap exactly.
 */
export function checkBundle(parsed: unknown, newId: () => string = randomUUID): BundleCheck {
  const errors: string[] = [];

  // V1 — top-level shape: exactly { manifest, data }.
  if (!isPlainObject(parsed)) return { ok: false, errors: ["bundle_not_an_object"] };
  const topKeys = Object.keys(parsed).sort();
  if (topKeys.join(",") !== "data,manifest") {
    return { ok: false, errors: [`unexpected_top_level_keys:${topKeys.join("|")}`] };
  }
  const { manifest, data } = parsed as { manifest: any; data: any };
  if (!isPlainObject(manifest) || !isPlainObject(data)) {
    return { ok: false, errors: ["manifest_or_data_not_an_object"] };
  }

  // V2 — key sets: manifest.tables exactly the 15; data exactly
  // the builder's 17 keys (2 stamps + 15 table payloads).
  const tableKeys = isPlainObject(manifest.tables) ? Object.keys(manifest.tables).sort() : [];
  const expectedTables = [...BUNDLE_TABLE_KEYS].sort();
  if (tableKeys.join(",") !== expectedTables.join(",")) {
    return { ok: false, errors: [`unexpected_manifest_tables:${tableKeys.join("|")}`] };
  }
  const expectedDataKeys = ["exportedAt", "exportedBy", ...Object.values(DATA_KEY_BY_TABLE)].sort();
  const dataKeys = Object.keys(data).sort();
  if (dataKeys.join(",") !== expectedDataKeys.join(",")) {
    return { ok: false, errors: [`unexpected_data_keys:${dataKeys.join("|")}`] };
  }

  // V3 — manifest stats well-formed + no truncation anywhere.
  for (const t of BUNDLE_TABLE_KEYS) {
    const stat = manifest.tables[t];
    if (!isPlainObject(stat) || typeof stat.rows !== "number" || typeof stat.truncated !== "boolean") {
      errors.push(`malformed_manifest_stat:${t}`);
      continue;
    }
    if (stat.truncated) errors.push(`source_table_truncated:${t}`);
  }
  if (errors.length) return { ok: false, errors };

  // V4 — manifest ↔ data row-count agreement, with strict
  // payload shapes: the three singleton tables are objects (or
  // null), the other twelve are arrays.
  const rowsOf = (table: string): any[] | Record<string, any> | null => data[DATA_KEY_BY_TABLE[table]];
  const OBJECT_TABLES = new Set(["organization", "businessProfile", "subscription"]);
  for (const t of BUNDLE_TABLE_KEYS) {
    const payload = rowsOf(t);
    if (OBJECT_TABLES.has(t)) {
      if (payload !== null && !isPlainObject(payload)) { errors.push(`malformed_table_payload:${t}`); continue; }
      if (t === "organization" && payload === null) { errors.push("missing_source_organization"); continue; }
      const actual = payload ? 1 : 0;
      if (actual !== manifest.tables[t].rows) errors.push(`row_count_mismatch:${t}`);
    } else {
      if (!Array.isArray(payload)) { errors.push(`malformed_table_payload:${t}`); continue; }
      if (payload.length !== manifest.tables[t].rows) errors.push(`row_count_mismatch:${t}`);
    }
  }
  if (errors.length) return { ok: false, errors };

  const arr = (t: string): Record<string, any>[] => data[DATA_KEY_BY_TABLE[t]] as Record<string, any>[];

  // V4b — integrations rows carry EXACTLY the exported six keys.
  for (const row of arr("integrations")) {
    if (!isPlainObject(row)) { errors.push("malformed_row:integrations"); continue; }
    const keys = Object.keys(row).sort();
    if (keys.join(",") !== [...INTEGRATION_ROW_KEYS].sort().join(",")) {
      errors.push("integration_row_shape_mismatch");
      break;
    }
  }
  if (errors.length) return { ok: false, errors };

  // V5 — credential scan over every payload object (incl. the
  // nested member user summaries). Known positions are stripped
  // later; anything else credential-shaped rejects the bundle.
  const scanObject = (table: string, obj: any) => {
    if (!isPlainObject(obj)) return;
    for (const key of Object.keys(obj)) {
      if (!CREDENTIAL_KEY_RE.test(key)) continue;
      if (table === KNOWN_SENSITIVE_POSITION.table && key === KNOWN_SENSITIVE_POSITION.key) continue;
      if (table === KNOWN_DEPRECATED_POSITION.table && key === KNOWN_DEPRECATED_POSITION.key) continue;
      errors.push(`credential_field_present:${table}.${key}`);
    }
  };
  for (const t of BUNDLE_TABLE_KEYS) {
    const payload = rowsOf(t);
    if (Array.isArray(payload)) {
      for (const row of payload) {
        scanObject(t, row);
        if (t === "members" && isPlainObject(row)) scanObject("members.user", (row as any).user);
      }
    } else {
      scanObject(t, payload);
    }
  }
  if (errors.length) return { ok: false, errors: [...new Set(errors)] };

  // V6 — every row of an IMPORTED table is an object with a
  // string id, unique within its table.
  const idSets: Record<string, Set<string>> = {};
  for (const t of IMPORT_TABLE_KEYS) {
    const set = new Set<string>();
    const payload = rowsOf(t);
    const rows = t === "businessProfile" ? (payload ? [payload] : []) : (payload as any[]);
    for (const row of rows as any[]) {
      if (!isPlainObject(row) || typeof row.id !== "string" || row.id === "") {
        errors.push(`malformed_row:${t}`);
        continue;
      }
      if (set.has(row.id)) errors.push(`duplicate_row_id:${t}`);
      set.add(row.id);
    }
    idSets[t] = set;
  }
  if (errors.length) return { ok: false, errors: [...new Set(errors)] };

  // V7 — row caps, from the export builder's own numbers: no
  // table past its hard ceiling (defensive; the manifest count
  // agreement already proved the lengths), and the total of
  // RESTORED rows within the inline-work threshold.
  const countOf = (t: string) => manifest.tables[t].rows as number;
  for (const t of BUNDLE_TABLE_KEYS) {
    if (countOf(t) > 200_000) errors.push(`table_row_ceiling_exceeded:${t}`);
  }
  const totalImportRows = IMPORT_TABLE_KEYS.reduce((sum, t) => sum + countOf(t), 0);
  if (totalImportRows > BUNDLE_IMPORT_MAX_ROWS) errors.push("import_row_cap_exceeded");
  if (errors.length) return { ok: false, errors };

  // Id maps — pre-generated NEW ids for every imported row.
  const idMap: Record<string, Map<string, string>> = {};
  for (const t of IMPORT_TABLE_KEYS) {
    idMap[t] = new Map([...idSets[t]].map((old) => [old, newId()]));
  }
  const remap = (table: string, v: unknown): string | null =>
    typeof v === "string" && v !== "" ? (idMap[table].get(v) ?? null) : null;
  const remapOrError = (table: string, v: unknown, label: string): string | null => {
    if (v === null || v === undefined || v === "") return null;
    const out = remap(table, v);
    if (out === null) errors.push(`dangling_reference:${label}`);
    return out;
  };

  const nulled: Record<string, number> = {};
  const warnings: string[] = [];
  const stripped: string[] = [];

  // Customers (self-reference: mergedIntoId remaps in-map).
  const customerRows = arr("customers");
  dupCheck(customerRows.map((r) => r.referralCode), "duplicate_customer_referral_code", errors);
  const planCustomers = customerRows.map((row) => {
    const out = buildRow("customers", row, CUSTOMER_FIELDS, CUSTOMER_BIGINTS, CUSTOMER_DATES, errors);
    out.id = idMap.customers.get(row.id)!;
    if (row.groupId) bump(nulled, "customers.groupId");
    out.groupId = null;
    out.mergedIntoId = remapOrError("customers", row.mergedIntoId, "customers.mergedIntoId");
    if (typeof row.loyaltyBalanceCache === "number" && row.loyaltyBalanceCache !== 0) {
      bump(nulled, "customers.loyaltyBalanceCache");
    }
    out.loyaltyBalanceCache = 0;
    return out;
  });

  // Products.
  const productRows = arr("products");
  dupCheck(productRows.map((r) => r.sku), "duplicate_product_sku", errors);
  {
    const slugs = productRows.map((r) => r.slug).filter(Boolean) as string[];
    if (new Set(slugs).size !== slugs.length) warnings.push("duplicate_product_slugs");
  }
  const planProducts = productRows.map((row) => {
    const out = buildRow("products", row, PRODUCT_FIELDS, PRODUCT_BIGINTS, PRODUCT_DATES, errors);
    out.id = idMap.products.get(row.id)!;
    if (row.categoryId) bump(nulled, "products.categoryId");
    if (row.brandId) bump(nulled, "products.brandId");
    if (row.digitalStorageKey) bump(nulled, "products.digitalStorageKey");
    out.categoryId = null;
    out.brandId = null;
    out.digitalStorageKey = null;
    return out;
  });

  // Leads.
  const leadRows = arr("leads");
  const planLeads = leadRows.map((row) => {
    const out = buildRow("leads", row, LEAD_FIELDS, LEAD_BIGINTS, LEAD_DATES, errors);
    out.id = idMap.leads.get(row.id)!;
    out.customerId = remapOrError("customers", row.customerId, "leads.customerId");
    out.mergedIntoId = remapOrError("leads", row.mergedIntoId, "leads.mergedIntoId");
    if (row.ownerUserId) bump(nulled, "leads.ownerUserId");
    out.ownerUserId = null;
    return out;
  });

  // Orders.
  const orderRows = arr("orders");
  dupCheck(
    orderRows.map((r) => `${r.source ?? ""}|${r.externalId ?? ""}`),
    "duplicate_order_source_external_id",
    errors,
  );
  dupCheck(orderRows.map((r) => r.invoiceNumber), "duplicate_order_invoice_number", errors);
  const ORDER_NULLED_SCALARS = [
    "storeId", "conversationId", "codConversationId", "storeDraftId", "storeInvoiceUrl",
    "assigneeId", "agentId", "landingPageId", "landingVariantId", "deliverySlotId",
    "pickupPointId", "freeShippingZoneId", "shippingRateRuleId", "affiliatePartnerId",
    "subscriptionId", "giftPromotionId",
  ] as const;
  const planOrders = orderRows.map((row) => {
    const out = buildRow("orders", row, ORDER_FIELDS, ORDER_BIGINTS, ORDER_DATES, errors);
    out.id = idMap.orders.get(row.id)!;
    out.customerId = remapOrError("customers", row.customerId, "orders.customerId");
    out.referrerCustomerId = remapOrError("customers", row.referrerCustomerId, "orders.referrerCustomerId");
    out.splitFromId = remapOrError("orders", row.splitFromId, "orders.splitFromId");
    out.mergedIntoId = remapOrError("orders", row.mergedIntoId, "orders.mergedIntoId");
    for (const f of ORDER_NULLED_SCALARS) {
      if (row[f]) bump(nulled, `orders.${f}`);
      out[f] = null;
    }
    return out;
  });

  // Order items (required orderId, optional productId).
  const itemRows = arr("orderItems");
  const planItems = itemRows.map((row) => {
    const out = buildRow("orderItems", row, ORDER_ITEM_FIELDS, ORDER_ITEM_BIGINTS, ORDER_ITEM_DATES, errors);
    out.id = idMap.orderItems.get(row.id)!;
    out.orderId = remapOrError("orders", row.orderId, "orderItems.orderId");
    out.productId = remapOrError("products", row.productId, "orderItems.productId");
    if (row.bundleId) bump(nulled, "orderItems.bundleId");
    out.bundleId = null;
    return out;
  });

  // Business profile (singleton; written onto the target org's
  // own profile row by the service — no id rides along).
  let planProfile: Record<string, any> | null = null;
  const profileRow = data.businessProfile as Record<string, any> | null;
  if (profileRow) {
    planProfile = buildRow("businessProfile", profileRow, PROFILE_FIELDS, PROFILE_BIGINTS, PROFILE_DATES, errors);
    if (profileRow.metaCapiToken) stripped.push("businessProfile.metaCapiToken");
    if (profileRow.customDomain) stripped.push("businessProfile.customDomain");
  }

  // V10 — minimal required-field sanity on imported rows.
  for (const r of arr("products")) {
    if (typeof r.name !== "string" || r.name === "" || toBigInt(r.priceMinor) === null) {
      errors.push("malformed_row:products");
      break;
    }
  }
  for (const r of arr("orders")) {
    if (typeof r.externalId !== "string" || r.externalId === "" || typeof r.status !== "string") {
      errors.push("malformed_row:orders");
      break;
    }
  }
  for (const r of arr("leads")) {
    if (typeof r.name !== "string" || r.name === "") { errors.push("malformed_row:leads"); break; }
  }
  for (const r of itemRows) {
    if (typeof r.name !== "string" || !Number.isInteger(r.quantity)) {
      errors.push("malformed_row:orderItems");
      break;
    }
  }
  if (errors.length) return { ok: false, errors: [...new Set(errors)] };

  const tables: BundleTableReport[] = BUNDLE_TABLE_KEYS.map((t) => {
    const isImport = (IMPORT_TABLE_KEYS as readonly string[]).includes(t);
    return {
      table: t,
      rows: countOf(t),
      action: isImport ? "import" : "skip",
      ...(isImport ? {} : { reason: SKIPPED_TABLE_REASONS[t] }),
    };
  });

  return {
    ok: true,
    sourceOrgName: typeof data.organization?.name === "string" ? data.organization.name : null,
    sourceOrgId: typeof data.organization?.id === "string" ? data.organization.id : null,
    exportedAt: typeof manifest.exportedAt === "string" ? manifest.exportedAt : null,
    tables,
    totalImportRows,
    strippedSensitiveFields: stripped,
    nulledReferenceCounts: nulled,
    warnings,
    plan: {
      profile: planProfile,
      customers: planCustomers,
      products: planProducts,
      leads: planLeads,
      orders: planOrders,
      orderItems: planItems,
    },
  };
}

/** JSON.parse with an honest failure (null instead of throwing). */
export function parseBundleJson(text: string): unknown | null {
  if (typeof text !== "string" || text.trim() === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
