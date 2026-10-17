/**
 * CC1 — Connect Center view helpers.
 *
 * The overview payload comes from GET
 * organizations/:id/connections/overview, which aggregates the
 * REAL backing rows. These helpers only shape that payload for
 * display: health pill wording/colours and the search filter.
 * Nothing here invents a status — an account the API reports as
 * `unknown` stays "অজানা" in the UI.
 */

export type ConnectionHealth = "ok" | "error" | "disconnected" | "expiring" | "unknown";

export interface ConnectionAccount {
  id: string;
  source: string;
  category: string;
  provider: string;
  displayName: string;
  externalAccountId: string | null;
  status: string;
  lastSyncAt: string | null;
  lastError: string | null;
  tokenExpiresAt: string | null;
  expiringSoon: boolean;
  health: ConnectionHealth;
  isDefault: boolean;
  /** CC3/CC4: which app this connection was made through.
   * Absent on rows with no own-app path (stores, senders, …). */
  appSource?: string;
  /** CC3: appSource is "own" but the own-app config was deleted. */
  ownAppConfigMissing?: boolean;
  /** CC11: the latest Connection Doctor run for this account,
   * or null when it has never been diagnosed. */
  lastCheck?: { overall: string; at: string; trigger: string } | null;
  /** CC14/CC15: the provider's OWN health snapshot, stored
   * verbatim server-side. A field the provider did not return is
   * ABSENT here — the UI renders absence as "তথ্য নেই", never as
   * a guessed value. */
  providerHealth?: Record<string, any> | null;
  providerHealthAt?: string | null;
  providerHealthError?: string | null;
  /** AD3 for ad accounts: Meta's verbatim status + bucket. */
  platformStatusBucket?: string | null;
  platformStatusRaw?: string | null;
  deepLink: string;
  /** CC17: the tenant-chosen display label (the overview's
   * displayName already prefers it server-side) and the
   * free-text group the account is filed under. */
  label?: string | null;
  groupName?: string | null;
  /** CC18: per-connection sync pause (Integration rows). */
  syncPaused?: boolean;
  /** CC30: per-connection SCHEDULED-sync cadence in minutes
   * (Integration rows, store integrations). null/absent = no
   * cadence — every scheduled run syncs. Manual syncs ignore it. */
  syncIntervalMinutes?: number | null;
  /** CC21: auto-healing opt-out (Integration rows). false =
   * the tenant turned sweep auto-repair OFF for this
   * connection; detection/alerts still run. */
  autoHealEnabled?: boolean;
  /** AD5 surfaced in the Center: ad-account sync disabled on
   * the ads page — displayed here, managed there. */
  syncDisabled?: boolean;
}

/** CC11 — one Doctor step exactly as the API recorded it: the
 * status is the provider's real answer (pass/fail) or an honest
 * not_checkable — the UI never upgrades it. */
export interface DoctorStepView {
  key: string;
  label: string;
  status: "pass" | "fail" | "not_checkable";
  message: string;
}

export interface HealthCheckRunView {
  id: string;
  targetType: string;
  targetId: string;
  provider: string | null;
  displayName: string | null;
  runById: string | null;
  trigger: string; // manual | sweep
  overall: string; // pass | fail | partial
  steps: DoctorStepView[];
  createdAt: string;
}

export const OVERALL_META: Record<string, { label: string; cls: string }> = {
  pass: { label: "পাস", cls: "bg-green-100 text-green-700" },
  fail: { label: "ব্যর্থ", cls: "bg-red-100 text-red-700" },
  partial: { label: "আংশিক", cls: "bg-amber-100 text-amber-700" },
};

export function overallMeta(overall: string): { label: string; cls: string } {
  return OVERALL_META[overall] ?? { label: overall, cls: "bg-slate-100 text-slate-600" };
}

export const STEP_STATUS_META: Record<string, { label: string; cls: string }> = {
  pass: { label: "✓ পাস", cls: "bg-green-100 text-green-700" },
  fail: { label: "✗ ব্যর্থ", cls: "bg-red-100 text-red-700" },
  not_checkable: { label: "? যাচাই সম্ভব নয়", cls: "bg-slate-100 text-slate-500" },
};

export function stepStatusMeta(status: string): { label: string; cls: string } {
  return STEP_STATUS_META[status] ?? { label: status, cls: "bg-slate-100 text-slate-600" };
}

/** CC12 — one delivered connection alert as the API reports it.
 * emailSentCount counts ONLY recipients for whom the mail
 * provider returned a real message id. */
export interface ConnectionAlertView {
  id: string;
  targetType: string;
  targetId: string;
  provider: string | null;
  category: string | null;
  displayName: string | null;
  kind: string; // broke | expiring | recovered
  state: string;
  title: string;
  body: string | null;
  emailSentCount: number;
  emailError: string | null;
  readAt: string | null;
  createdAt: string;
}

export const ALERT_KIND_META: Record<string, { label: string; cls: string }> = {
  broke: { label: "সমস্যা", cls: "bg-red-100 text-red-700" },
  expiring: { label: "মেয়াদ শেষের পথে", cls: "bg-amber-100 text-amber-700" },
  recovered: { label: "ঠিক হয়েছে", cls: "bg-green-100 text-green-700" },
};

export function alertKindMeta(kind: string): { label: string; cls: string } {
  return ALERT_KIND_META[kind] ?? { label: kind, cls: "bg-slate-100 text-slate-600" };
}

export interface AlertPreferencesView {
  emailEnabled: boolean;
  categories: string[] | null;
  doctorEnabled: boolean;
  doctorIntervalHours: number;
}

/** CC13 — one timeline entry, always backed by a real record
 * (audit / sync / webhook / health check / payment). */
export interface TimelineItemView {
  id: string;
  at: string;
  kind: "audit" | "sync" | "webhook" | "health_check" | "payment";
  title: string;
  detail: string | null;
  severity: "info" | "warn" | "error";
}

export const TIMELINE_KIND_LABEL: Record<string, string> = {
  audit: "কার্যকলাপ",
  sync: "Sync",
  webhook: "Webhook",
  health_check: "স্বাস্থ্য পরীক্ষা",
  payment: "পেমেন্ট",
};

export const SEVERITY_META: Record<string, { cls: string }> = {
  info: { cls: "bg-slate-100 text-slate-600" },
  warn: { cls: "bg-amber-100 text-amber-700" },
  error: { cls: "bg-red-100 text-red-700" },
};

/** CC3 — an own-app config as the API reports it (no secret, ever).
 * CC28: platforms are meta | tiktok | google | linkedin; the
 * google/linkedin views carry the redirectUris the tenant must
 * register in their own provider console, and a Meta save that
 * ROTATED the secret is flagged `rotated`. */
export interface TenantAppConfigView {
  platform: string; // meta | tiktok | google | linkedin
  appId: string;
  status: string; // verified | configured
  lastVerifiedAt: string | null;
  lastError: string | null;
  verificationNote: string; // verified_with_meta | verified_at_first_connect
  redirectUris?: string[];
  rotated?: boolean;
}

/** CC28 — the own-app registration guides the app-configs list
 * returns alongside the configs (the redirect URIs exist to be
 * registered BEFORE the first own-app connect can succeed). */
export interface OwnAppGuides {
  google: { redirectUris: string[] };
  linkedin: { redirectUris: string[] };
  threads?: { redirectUris: string[] };
}

export const APP_SOURCE_META: Record<string, { label: string; cls: string }> = {
  own: { label: "নিজের অ্যাপ", cls: "bg-violet-100 text-violet-700" },
  platform: { label: "প্ল্যাটফর্ম অ্যাপ", cls: "bg-slate-100 text-slate-600" },
};

/** Badge for an account's app source; null when the row carries
 * no app source (categories without an own-app path). */
export function appSourceMeta(account: ConnectionAccount): { label: string; cls: string } | null {
  if (!account.appSource) return null;
  return APP_SOURCE_META[account.appSource] ?? APP_SOURCE_META.platform;
}

/** Bengali wording for an own-app config's verification state —
 * "verified" only ever means a real platform check happened
 * (Meta); TikTok's "configured" says plainly that verification
 * waits for the first connect. */
export function appConfigStatusLabel(config: TenantAppConfigView): string {
  if (config.status === "verified") return "যাচাইকৃত";
  return "কনফিগার করা হয়েছে — যাচাই প্রথম কানেক্টে হবে";
}

/** CC8 — the tenant's OWN LLM config as the API reports it (the
 * key itself is never in this shape). */
export interface OrgLlmConfigView {
  provider: string; // openai | anthropic | gemini
  model: string | null;
  status: string; // verified | configured
  isEnabled: boolean;
  lastVerifiedAt: string | null;
  lastError: string | null;
  verificationNote: string;
}

export function llmConfigStatusLabel(view: OrgLlmConfigView): string {
  if (view.status === "verified") return "যাচাইকৃত — এই key দিয়েই AI চলবে";
  return "কনফিগার করা";
}

/** CC9 — one of the tenant's OWN payment gateways as the API
 * reports it (credentials never in this shape — only the
 * non-secret identifier). */
export interface TenantPaymentGatewayView {
  provider: string; // sslcommerz | bkash | nagad | shurjopay | aamarpay | stripe
  identifier: string | null;
  sandbox: boolean;
  status: string; // verified | configured
  isEnabled: boolean;
  lastVerifiedAt: string | null;
  lastError: string | null;
  verificationNote: string; // verified_with_gateway | no_pre_transaction_check
  /** GC12: the merchant's own gateway-contract fee numbers
   * (null = no fee rate configured; fee reports then show no
   * fee for this gateway). */
  feeBps: number | null;
  feeFixedMinor: string | null;
  createdAt?: string;
  updatedAt?: string;
  /** CC19: which credential set this row is — production flows
   * only ever use "live"; "sandbox" rows are for Doctor checks
   * and clearly-labelled test payments. */
  environment?: string; // live | sandbox
}

/** Honest status wording: "verified" is only ever bKash's real
 * grant-token check; SSLCommerz/Nagad rows say plainly that no
 * pre-transaction check exists for them. */
export function gatewayStatusLabel(view: TenantPaymentGatewayView): string {
  if (view.status === "verified") return "যাচাইকৃত";
  return "কনফিগার করা — আগাম যাচাইয়ের সুযোগ নেই, প্রথম আসল লেনদেনই যাচাই";
}

/** CC10 — platform-payment offer + this org's enablement, as the
 * API reports it. `offered` comes from the PLATFORM's real
 * gateway configuration — a provider the platform has not
 * configured is offered=false and can never be enabled. */
export interface PlatformPaymentProviderView {
  provider: string; // sslcommerz | bkash
  offered: boolean;
  enabled: boolean;
  enablementStatus: string; // platform_not_configured | enabled | disabled | not_enabled
}

export interface PlatformPaymentsView {
  feeBps: number;
  feePercent: number;
  providers: PlatformPaymentProviderView[];
}

export interface WalletLedgerView {
  id: string;
  type: string; // payment_credit | fee_debit | payout_debit | adjustment
  amountMinor: string;
  balanceAfterMinor: string;
  refType: string | null;
  refId: string | null;
  note: string | null;
  createdAt: string;
}

export interface WalletView {
  currency: string;
  balanceMinor: string;
  heldMinor: string;
  availableMinor: string;
  feeBps: number;
  ledger: WalletLedgerView[];
}

export interface PayoutRequestView {
  id: string;
  amountMinor: string;
  method: string; // bkash | bank
  destination: Record<string, unknown> | null;
  destinationId: string | null;
  createdBySystem: boolean;
  status: string; // pending | approved | paid | rejected | cancelled
  adminNote: string | null;
  payoutRef: string | null;
  createdAt: string;
  updatedAt: string;
}

// ------------------------------------------------------------------
// CC24/CC25/CC26 (Connect Center Next, B11) — gateway refunds,
// settlement reconciliation, payout automation, payment links
// ------------------------------------------------------------------

export interface PaymentRefundView {
  id: string;
  transactionId: string;
  orderId: string;
  provider: string; // sslcommerz | bkash
  source: string; // own | platform
  environment: string;
  amountMinor: string;
  currency: string;
  status: string; // initiated | processing | refunded | failed
  // OU5 Refund Center: "gateway" (CC24 API path) | "manual"
  // (provider-dashboard refund tracked in-platform).
  mode?: string;
  trackingLabel?: string | null;
  manualProviderRef?: string | null;
  manualProofNote?: string | null;
  manualRecordedById?: string | null;
  manualRecordedAt?: string | null;
  gatewayRefundRef: string | null;
  gatewayStatusRaw: Record<string, any> | null;
  reason: string | null;
  requestedById: string;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function refundStatusMeta(status: string): { label: string; cls: string } {
  switch (status) {
    case "refunded": return { label: "রিফান্ড যাচাইকৃত", cls: "bg-green-100 text-green-700" };
    case "processing": return { label: "গেটওয়েতে প্রক্রিয়াধীন", cls: "bg-amber-100 text-amber-700" };
    case "initiated": return { label: "শুরু হয়েছে", cls: "bg-amber-100 text-amber-700" };
    case "failed": return { label: "ব্যর্থ", cls: "bg-red-100 text-red-700" };
    default: return { label: status, cls: "bg-slate-100 text-slate-600" };
  }
}

export interface SettlementImportView {
  id: string;
  provider: string;
  source: string;
  periodLabel: string;
  periodFrom: string | null;
  periodTo: string | null;
  fileName: string;
  rowCount: number;
  skippedCount: number;
  matchedCount: number;
  createdById: string;
  createdAt: string;
}

export interface SettlementRowView {
  id: string;
  externalRef: string;
  amountMinor: string;
  currency: string;
  rawStatus: string | null;
  matchState: string; // matched | amount_mismatch | missing_in_system | duplicate
  matchedTransactionId: string | null;
}

export interface SettlementMissingInReportView {
  transactionId: string;
  orderId: string;
  providerTxnId: string | null;
  amountMinor: string;
  currency: string;
  paidAt: string;
}

export interface SettlementImportDetailView {
  import: SettlementImportView;
  counts: { matched: number; amount_mismatch: number; missing_in_system: number; duplicate: number; missing_in_report: number };
  matched: SettlementRowView[];
  amountMismatch: SettlementRowView[];
  missingInSystem: SettlementRowView[];
  duplicates: SettlementRowView[];
  missingInReport: SettlementMissingInReportView[];
}

export function settlementStateLabel(state: string): string {
  switch (state) {
    case "matched": return "মিলেছে";
    case "amount_mismatch": return "পরিমাণে অমিল";
    case "missing_in_system": return "সিস্টেমে নেই";
    case "duplicate": return "ফাইলে পুনরাবৃত্তি";
    default: return state;
  }
}

export interface PayoutDestinationView {
  id: string;
  label: string;
  method: string; // bkash | bank
  details: Record<string, unknown>;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PayoutScheduleView {
  id: string;
  enabled: boolean;
  cadence: string; // weekly | monthly
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  thresholdMinor: string;
  destinationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentLinkView {
  id: string;
  orderId: string;
  provider: string;
  source: string; // own | platform
  environment: string;
  status: string; // active | used | expired | revoked
  expiresAt: string;
  usedAt: string | null;
  createdById: string;
  createdAt: string;
}

/** The creation response — the ONLY shape that ever carries
 * the plaintext token + full pay URL. */
export interface PaymentLinkCreatedView extends PaymentLinkView {
  token: string;
  payUrl: string;
}

export function paymentLinkStatusMeta(status: string): { label: string; cls: string } {
  switch (status) {
    case "active": return { label: "সক্রিয়", cls: "bg-green-100 text-green-700" };
    case "used": return { label: "ব্যবহৃত হয়েছে", cls: "bg-slate-200 text-slate-600" };
    case "expired": return { label: "মেয়াদ শেষ", cls: "bg-amber-100 text-amber-700" };
    case "revoked": return { label: "বাতিল করা", cls: "bg-red-100 text-red-700" };
    default: return { label: status, cls: "bg-slate-100 text-slate-600" };
  }
}

export interface PublicPaymentLinkView {
  status: string; // active | used | expired | revoked
  shopName: string;
  orderNumber: string | null;
  amountDueMinor: string | null;
  currency: string;
  provider: string;
  source: string;
  expiresAt: string;
}

/** Minor units (decimal string) → "৳ 1,234.56" / "-৳ 50.00". */
export function formatTakaMinor(minor: string | number): string {
  let v: bigint;
  try { v = typeof minor === "string" ? BigInt(minor) : BigInt(Math.round(minor)); } catch { return "৳ 0.00"; }
  const neg = v < 0n; const abs = neg ? -v : v;
  return `${neg ? "-৳ " : "৳ "}${(abs / 100n).toLocaleString("en-US")}.${String(abs % 100n).padStart(2, "0")}`;
}

export function payoutStatusLabel(status: string): string {
  switch (status) {
    case "pending": return "অপেক্ষমাণ (অ্যাডমিনের সিদ্ধান্ত বাকি)";
    case "approved": return "অনুমোদিত (পাঠানো বাকি)";
    case "paid": return "পাঠানো হয়েছে";
    case "rejected": return "প্রত্যাখ্যাত";
    case "cancelled": return "বাতিল করেছেন";
    default: return status;
  }
}

export function ledgerTypeLabel(type: string): string {
  switch (type) {
    case "payment_credit": return "প্ল্যাটফর্ম পেমেন্ট জমা";
    case "fee_debit": return "প্ল্যাটফর্ম ফি";
    case "payout_debit": return "Payout পাঠানো";
    case "refund_debit": return "রিফান্ড ডেবিট-ব্যাক";
    case "adjustment": return "অ্যাডমিন সংশোধন";
    default: return type;
  }
}

export interface ConnectionCategory {
  key: string;
  label: string;
  deepLink: string;
  status: string;
  note: string | null;
  connectedCount: number;
  totalCount: number;
  accounts: ConnectionAccount[];
}

export interface ConnectionsOverview {
  organizationId: string;
  generatedAt: string;
  summary: {
    totalAccounts: number;
    connectedAccounts: number;
    errorAccounts: number;
    /** CC12: unread connection alerts (the header badge). */
    unreadAlerts?: number;
    byCategory: Record<string, { connected: number; total: number }>;
  };
  categories: ConnectionCategory[];
}

export const HEALTH_META: Record<ConnectionHealth, { label: string; cls: string }> = {
  ok: { label: "সচল", cls: "bg-green-100 text-green-700" },
  error: { label: "সমস্যা আছে", cls: "bg-red-100 text-red-700" },
  disconnected: { label: "বিচ্ছিন্ন", cls: "bg-slate-200 text-slate-600" },
  expiring: { label: "টোকেনের মেয়াদ শেষের পথে", cls: "bg-amber-100 text-amber-700" },
  unknown: { label: "অজানা", cls: "bg-slate-100 text-slate-500" },
};

export function healthMeta(health: string): { label: string; cls: string } {
  return HEALTH_META[(health as ConnectionHealth)] ?? HEALTH_META.unknown;
}

/** Bengali wording for a category-level status from the API. */
export function categoryStatusLabel(category: ConnectionCategory): string {
  if (category.status === "platform_managed") return "প্ল্যাটফর্মের AI দিয়ে চলছে";
  if (category.status === "not_configured") return "কনফিগার করা হয়নি";
  if (category.totalCount === 0) return "কিছু কানেক্ট করা হয়নি";
  return `${category.connectedCount}/${category.totalCount} কানেক্টেড`;
}

export function accountMatches(account: ConnectionAccount, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [account.displayName, account.provider, account.externalAccountId ?? "", account.status]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

/**
 * Search filter: with an empty query the overview is returned
 * untouched. With a query, each category keeps only matching
 * accounts (or all of them when the category label itself matches)
 * and categories with nothing left are dropped.
 */
export function filterOverview(overview: ConnectionsOverview, query: string): ConnectionCategory[] {
  const q = query.trim().toLowerCase();
  if (!q) return overview.categories;
  const out: ConnectionCategory[] = [];
  for (const category of overview.categories) {
    if (category.label.toLowerCase().includes(q)) { out.push(category); continue; }
    const accounts = category.accounts.filter((a) => accountMatches(a, q));
    if (accounts.length > 0) out.push({ ...category, accounts });
  }
  return out;
}

/** CC14 — WhatsApp deep health as stored from Meta's response.
 * Only keys Meta actually returned are present. */
export interface WhatsAppHealthView {
  displayPhoneNumber?: string;
  verifiedName?: string;
  qualityRating?: string;
  messagingLimit?: string;
  status?: string;
  nameStatus?: string;
  wabaReviewStatus?: string;
  wabaError?: string;
}

export function whatsappHealth(account: ConnectionAccount): WhatsAppHealthView | null {
  const snap = account.providerHealth;
  if (!snap || snap.kind !== "whatsapp") return null;
  const out: WhatsAppHealthView = {};
  if (typeof snap.displayPhoneNumber === "string") out.displayPhoneNumber = snap.displayPhoneNumber;
  if (typeof snap.verifiedName === "string") out.verifiedName = snap.verifiedName;
  if (typeof snap.qualityRating === "string") out.qualityRating = snap.qualityRating;
  if (typeof snap.messagingLimit === "string") out.messagingLimit = snap.messagingLimit;
  if (typeof snap.status === "string") out.status = snap.status;
  if (typeof snap.nameStatus === "string") out.nameStatus = snap.nameStatus;
  if (typeof snap.waba?.accountReviewStatus === "string") out.wabaReviewStatus = snap.waba.accountReviewStatus;
  if (typeof snap.wabaError === "string") out.wabaError = snap.wabaError;
  return out;
}

export const QUALITY_META: Record<string, { label: string; cls: string }> = {
  GREEN: { label: "Quality: ভালো (Green)", cls: "bg-green-100 text-green-700" },
  YELLOW: { label: "Quality: মাঝারি (Yellow)", cls: "bg-amber-100 text-amber-700" },
  RED: { label: "Quality: খারাপ (Red)", cls: "bg-red-100 text-red-700" },
};

export function qualityMeta(rating: string): { label: string; cls: string } {
  return QUALITY_META[rating] ?? { label: `Quality: ${rating}`, cls: "bg-slate-100 text-slate-600" };
}

/** CC15 — one completeness line: yes/no exactly as the provider
 * reported, or "unknown" when the provider gave no answer. */
export interface CompletenessItem {
  key: string;
  label: string;
  state: "yes" | "no" | "unknown";
  detail: string | null;
}

export const COMPLETENESS_META: Record<CompletenessItem["state"], { icon: string; cls: string }> = {
  yes: { icon: "✓", cls: "bg-green-100 text-green-700" },
  no: { icon: "✗", cls: "bg-red-100 text-red-700" },
  unknown: { icon: "?", cls: "bg-slate-100 text-slate-500" },
};

export function completenessItems(account: ConnectionAccount): CompletenessItem[] {
  const snap = account.providerHealth;
  if (!snap) return [];
  const items: CompletenessItem[] = [];
  if (snap.kind === "meta_page") {
    const ig = snap.instagram;
    items.push({
      key: "instagram", label: "Instagram লিঙ্ক করা",
      state: !ig ? "unknown" : ig.linked === true ? "yes" : ig.linked === false ? "no" : "unknown",
      detail: ig?.linked === true ? (ig.username ? `@${ig.username}` : ig.id ?? null) : null,
    });
    for (const [key, label] of [["pixel", "Pixel / Dataset"], ["catalog", "Product Catalog"]] as const) {
      const entry = snap[key];
      items.push({
        key, label: `${label} (Meta Business)`,
        state: !entry ? "unknown" : entry.associated === true ? "yes" : entry.associated === false ? "no" : "unknown",
        detail: entry?.associated === true && typeof entry.count === "number" ? `${entry.count}টি পাওয়া গেছে` : entry?.error ? String(entry.error) : null,
      });
    }
  }
  if (snap.kind === "ad_account") {
    const onFile = snap.paymentMethodOnFile;
    items.push({
      key: "payment_method", label: "Payment method on file (Meta-র রিপোর্ট)",
      state: onFile === true ? "yes" : onFile === false ? "no" : "unknown",
      detail: null,
    });
  }
  // CC30: the owning Meta business's verification_status,
  // stored verbatim in the snapshot by the CC15 refresh. No
  // business in the snapshot ⇒ unknown — never assumed.
  if (snap.kind === "meta_page" || snap.kind === "ad_account") {
    const biz = snap.business;
    items.push({
      key: "business_verification", label: "Business verification (Meta)",
      state: !biz ? "unknown" : biz.verificationStatus === "verified" ? "yes" : biz.verificationStatus ? "no" : "unknown",
      detail: biz ? (biz.verificationStatus ? `Meta-র মান: ${biz.verificationStatus}` : `Business ID: ${biz.id}`) : null,
    });
  }
  return items;
}

// ------------------------------------------------------------------
// CC30 — per-account usage insights + deliverability (view types
// mirror GET connections/usage and connections/deliverability;
// every number is a real-row count from the API — the UI never
// derives or estimates anything itself).
// ------------------------------------------------------------------

export interface UsageAccountView {
  targetType: string;
  targetId: string;
  category: string;
  provider: string;
  displayName: string;
  metrics: Record<string, number | string | null> | null;
  attribution: string;
  estimatedCostMinor: string | null;
  costRateMinor: number | null;
}

export interface UsageView {
  days: number;
  since: string;
  accounts: UsageAccountView[];
  unattributed: ({ kind: string } & Record<string, number | string>)[];
}

/** One-line Bengali summary of a usage entry's metrics; null
 * when the API reported the facts as unattributable (the panel
 * renders "তথ্য নেই" for those). */
export function usageMetricSummary(entry: UsageAccountView): string | null {
  const m = entry.metrics;
  if (!m) return null;
  if ("messagesReceived" in m || "messagesSent" in m) {
    if (m.messagesReceived === null || m.messagesSent === null) return null;
    return `এসেছে ${m.messagesReceived} · গেছে ${m.messagesSent}`;
  }
  if ("postsPublished" in m) return `প্রকাশিত পোস্ট ${m.postsPublished}`;
  if ("ordersInWindow" in m) {
    if (m.ordersInWindow === null) return null;
    return `অর্ডার ${m.ordersInWindow}`;
  }
  if ("shipmentsBooked" in m) return `শিপমেন্ট বুকিং ${m.shipmentsBooked}`;
  if ("verifiedPayments" in m) return `যাচাইকৃত পেমেন্ট ${m.verifiedPayments}টি`;
  return null;
}

export interface DeliverabilityView {
  email: {
    configured: boolean;
    domain: string | null;
    source: string;
    dkimSelectorSet: boolean;
    spf: { status: string };
    dkim: { status: string };
    note: string;
  };
  metaBusiness: {
    targetType: string;
    targetId: string;
    displayName: string;
    businessId: string | null;
    verificationStatus: string | null;
    providerHealthAt: string | null;
  }[];
}

/** Meta business verification wording — Meta's verbatim value
 * is always shown beside the label; unknown stays unknown. */
export function businessVerificationMeta(status: string | null | undefined): { label: string; cls: string } {
  switch (status) {
    case "verified": return { label: "✓ Verified", cls: "bg-green-100 text-green-700" };
    case "not_verified": return { label: "✗ Not verified", cls: "bg-red-100 text-red-700" };
    case null:
    case undefined:
    case "": return { label: "? তথ্য নেই", cls: "bg-slate-100 text-slate-500" };
    default: return { label: status, cls: "bg-amber-100 text-amber-700" };
  }
}

/** AD3 bucket wording — mirrors the API's bucketLabelBn. */
export function adBucketMeta(bucket: string | null | undefined): { label: string; cls: string } {
  switch (bucket) {
    case "active": return { label: "সক্রিয়", cls: "bg-green-100 text-green-700" };
    case "disabled": return { label: "বন্ধ (Disabled)", cls: "bg-red-100 text-red-700" };
    case "restricted": return { label: "সীমাবদ্ধ (Restricted)", cls: "bg-amber-100 text-amber-700" };
    case "unknown": return { label: "অজানা অবস্থা", cls: "bg-slate-100 text-slate-500" };
    default: return { label: "জানা নেই", cls: "bg-slate-100 text-slate-500" };
  }
}

/** CC16 — commerce diagnostics as the API reports them. */
export interface CommerceDiagnosticsView {
  integrationId: string;
  provider: string;
  storeId: string | null;
  /** CC21: sweep auto-healing opt-out for this connection. */
  autoHealEnabled?: boolean;
  webhookStatus: { status?: string; topics?: Record<string, { status: string; error?: string }> } | null;
  shopifyScopes: { granted: string[]; required: string[]; missing: string[] } | null;
  shopifyScopesError: string | null;
  tracker: { lastEventAt: string | null; label: string } | null;
  lastCheck: { overall: string; at: string; trigger: string } | null;
}

export interface WebhookTopicView { topic: string; status: string; error: string | null }

export function webhookTopics(webhookStatus: CommerceDiagnosticsView["webhookStatus"]): WebhookTopicView[] {
  const topics = webhookStatus?.topics;
  if (!topics || typeof topics !== "object") return [];
  return Object.entries(topics).map(([topic, v]) => ({
    topic,
    status: typeof v?.status === "string" ? v.status : "unknown",
    error: typeof v?.error === "string" ? v.error : null,
  }));
}

export function webhookTopicMeta(status: string): { cls: string } {
  if (["registered", "created", "exists"].includes(status)) return { cls: "bg-green-100 text-green-700" };
  if (["failed", "error"].includes(status)) return { cls: "bg-red-100 text-red-700" };
  return { cls: "bg-amber-100 text-amber-700" };
}

/** Which accounts have a CC14/CC15 provider-health refresh. */
export function canRefreshProviderHealth(account: ConnectionAccount): boolean {
  if (account.source === "integration") return ["whatsapp", "messenger", "meta_social"].includes(account.provider);
  if (account.source === "social_account") return account.provider === "meta_page";
  if (account.source === "ad_account") return account.provider === "meta";
  return false;
}

export function formatWhen(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("bn-BD", { dateStyle: "medium", timeStyle: "short" });
}

// ------------------------------------------------------------------
// CC17 — groups: accounts file under their free-text groupName;
// accounts without one land in the ungrouped section, LAST.
// ------------------------------------------------------------------

export interface AccountGroup {
  groupName: string | null;
  accounts: ConnectionAccount[];
}

export function groupAccounts(accounts: ConnectionAccount[]): AccountGroup[] {
  const order: (string | null)[] = [];
  const byGroup = new Map<string | null, ConnectionAccount[]>();
  for (const account of accounts) {
    const key = account.groupName?.trim() ? account.groupName.trim() : null;
    if (!byGroup.has(key)) { byGroup.set(key, []); order.push(key); }
    byGroup.get(key)!.push(account);
  }
  // Ungrouped always renders last, whatever the data order was.
  const named = order.filter((g) => g !== null);
  const groups: AccountGroup[] = named.map((g) => ({ groupName: g, accounts: byGroup.get(g)! }));
  if (byGroup.has(null)) groups.push({ groupName: null, accounts: byGroup.get(null)! });
  return groups;
}

/** Distinct group names present in an account list, sorted. */
export function accountGroupNames(accounts: ConnectionAccount[]): string[] {
  const names = new Set<string>();
  for (const a of accounts) if (a.groupName?.trim()) names.add(a.groupName.trim());
  return [...names].sort((x, y) => x.localeCompare(y, "bn"));
}

/** Group filter sentinel for "accounts with no group". */
export const UNGROUPED_FILTER = "__ungrouped";

export function accountInGroup(account: ConnectionAccount, groupFilter: string): boolean {
  if (!groupFilter) return true;
  const group = account.groupName?.trim() ? account.groupName.trim() : null;
  if (groupFilter === UNGROUPED_FILTER) return group === null;
  return group === groupFilter;
}

/** Which Connect Center sources the label/group editor applies
 * to (the API's setAccountMeta sources). */
export function canEditAccountMeta(account: ConnectionAccount): boolean {
  return account.source === "integration" || account.source === "social_account" || account.source === "ad_account";
}

/** Sync pause applies to Integration rows only (stores +
 * channels). Ad accounts keep their AD5 syncDisabled, managed
 * on the ads page — never a second pause flag here. */
export function canPauseSync(account: ConnectionAccount): boolean {
  return account.source === "integration";
}

/** CC30 — cadence presets for the store-card interval choice
 * (minutes). "custom" and null (ডিফল্ট) are handled by the UI. */
export const SYNC_INTERVAL_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 15, label: "১৫ মিনিট" },
  { minutes: 30, label: "৩০ মিনিট" },
  { minutes: 60, label: "১ ঘণ্টা" },
  { minutes: 360, label: "৬ ঘণ্টা" },
  { minutes: 1440, label: "২৪ ঘণ্টা" },
];

export function syncIntervalLabel(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "ডিফল্ট (cadence নেই)";
  const preset = SYNC_INTERVAL_PRESETS.find((p) => p.minutes === minutes);
  if (preset) return `প্রতি ${preset.label}`;
  if (minutes % 1440 === 0) return `প্রতি ${minutes / 1440} দিন`;
  if (minutes % 60 === 0) return `প্রতি ${minutes / 60} ঘণ্টা`;
  return `প্রতি ${minutes} মিনিট`;
}

// ------------------------------------------------------------------
// CC17 — member × account access matrix
// ------------------------------------------------------------------

export interface MemberAccessMember {
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
  deniedConnectionIds: string[];
}

export interface MemberAccessTarget {
  id: string;
  source: string;
  provider: string;
  displayName: string;
}

export interface MemberAccessMatrix {
  members: MemberAccessMember[];
  targets: MemberAccessTarget[];
}

/** OWNER rows are never restricted (M72 semantics) — the matrix
 * renders them read-only instead of offering toggles that the
 * API would refuse anyway. */
export function memberCanBeRestricted(member: MemberAccessMember): boolean {
  return member.role !== "OWNER";
}

// ------------------------------------------------------------------
// CC18 — per-connection sync history
// ------------------------------------------------------------------

export interface SyncHistoryItem {
  id: string;
  kind: string;
  status: string;
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

export function syncJobStatusLabel(item: SyncHistoryItem): string {
  if (item.error === "sync_paused") return "বিরতি (pause) থাকায় এড়িয়ে যাওয়া হয়েছে";
  if (item.status === "COMPLETED") return "সম্পন্ন";
  if (item.status === "FAILED") return "ব্যর্থ";
  if (item.status === "RUNNING") return "চলমান";
  return item.status;
}

// ------------------------------------------------------------------
// CC19 — gateway transaction history + IPN viewer
// ------------------------------------------------------------------

export interface PaymentTransactionView {
  id: string;
  provider: string;
  source: string; // own | platform
  environment: string; // live | sandbox
  amountMinor: string;
  currency: string;
  status: string; // initiated | verified_paid | failed | cancelled
  orderId: string;
  valId: string | null;
  providerTxnId: string | null;
  hasIpnPayload: boolean;
  createdAt: string;
  updatedAt: string;
}

export function txnStatusMeta(status: string): { label: string; cls: string } {
  switch (status) {
    case "verified_paid": return { label: "যাচাইকৃত পেইড", cls: "bg-green-100 text-green-700" };
    case "initiated": return { label: "শুরু হয়েছে", cls: "bg-amber-100 text-amber-700" };
    case "failed": return { label: "ব্যর্থ", cls: "bg-red-100 text-red-700" };
    case "cancelled": return { label: "বাতিল", cls: "bg-slate-200 text-slate-600" };
    default: return { label: status, cls: "bg-slate-100 text-slate-600" };
  }
}

export interface PaymentIpnView {
  transactionId: string;
  provider: string;
  source: string;
  environment: string;
  status: string;
  valId: string | null;
  providerTxnId: string | null;
  ipnPayload: Record<string, any> | null;
}

// ------------------------------------------------------------------
// CC19 — buyer "Pay online" options (storefront success page)
// ------------------------------------------------------------------

export interface PayOption {
  provider: string; // sslcommerz | bkash
  source: "own" | "platform";
}

export function payOptionLabel(option: PayOption): string {
  const provider = option.provider === "bkash" ? "বিকাশ" : "SSLCommerz (কার্ড/মোবাইল ব্যাংকিং)";
  return option.source === "platform" ? `${provider} — প্ল্যাটফর্ম পেমেন্ট` : provider;
}

/**
 * The visibility rule for the buyer's Pay-online button: it
 * exists ONLY when the shop's public payment-options answer
 * contains at least one option — the API lists an option only
 * when it would really work (enabled own LIVE gateway, or a
 * tenant-enabled platform provider the platform actually
 * offers). Sandbox sets are never buyer options.
 */
export function payOnlineAvailable(options: PayOption[] | null | undefined): boolean {
  return Array.isArray(options) && options.length > 0;
}

// ------------------------------------------------------------------
// CC20 — Smart Setup Assistant (findings come from the API; every
// finding there is computed from real rows — this side only
// renders + dismisses)
// ------------------------------------------------------------------

export interface SetupFindingView {
  key: string;
  severity: "blocker" | "improvement" | "info";
  title: string;
  feature: string;
  evidence: string;
  actionLabel: string;
  href: string;
}

export const FINDING_SEVERITY_META: Record<string, { label: string; cls: string }> = {
  blocker: { label: "🚫 ব্লকার", cls: "bg-red-100 text-red-700" },
  improvement: { label: "⚠️ উন্নতি দরকার", cls: "bg-amber-100 text-amber-700" },
  info: { label: "ℹ️ তথ্য", cls: "bg-slate-100 text-slate-600" },
};

export function findingSeverityMeta(severity: string): { label: string; cls: string } {
  return FINDING_SEVERITY_META[severity] ?? FINDING_SEVERITY_META.info!;
}

// ------------------------------------------------------------------
// CC20 — Google pack + LinkedIn. CC28: BOTH app paths — the
// platform's app or the tenant's own (saved in the own-app
// section); the panel offers the choice per connect.
// ------------------------------------------------------------------

export interface GoogleConnectKindView {
  kind: "ga4" | "merchant" | "business";
  label: string;
  icon: string;
  blurb: string;
}

export const GOOGLE_CONNECT_KINDS: GoogleConnectKindView[] = [
  {
    kind: "ga4",
    label: "Google Analytics (GA4)",
    icon: "📊",
    blurb: "কানেক্টের পর আপনার GA4 property তালিকা থেকে একটি বেছে নেবেন — সেটির আইডিই সেভ হবে।",
  },
  {
    kind: "merchant",
    label: "Google Merchant Center",
    icon: "🏷️",
    blurb: "Merchant অ্যাকাউন্ট তালিকা থেকে একটি বেছে নেবেন (Merchant API v1 দিয়ে পড়া হয়)।",
  },
  {
    kind: "business",
    label: "Google Business Profile",
    icon: "📍",
    blurb: "আপনার Business Profile location তালিকা থেকে একটি বেছে নেবেন।",
  },
];

export function googleKindLabel(kind: string): string {
  return GOOGLE_CONNECT_KINDS.find((k) => k.kind === kind)?.label ?? kind;
}

// ------------------------------------------------------------------
// CC20 — Marketplace NO-BUILD notes. These are the EC14/EC
// program's recorded verdicts (docs/ec14-marketplace-research.md),
// shown honestly in the Center: there is NO connect button for
// either, because there is no real API path to connect through.
// A note is a finding of fact, not a placeholder account.
// ------------------------------------------------------------------

export interface MarketplaceNoteView {
  provider: string;
  name: string;
  icon: string;
  verdict: "no_build";
  summary: string;
  reason: string;
  revisit: string;
}

export const MARKETPLACE_NOTES: MarketplaceNoteView[] = [
  {
    provider: "tiktok_shop",
    name: "TikTok Shop",
    icon: "🎵",
    verdict: "no_build",
    summary: "TikTok Shop কানেক্ট করার বাটন এখানে নেই — এটি ইচ্ছাকৃত সিদ্ধান্ত, অসম্পূর্ণ কাজ নয়।",
    reason: "গবেষণায় (EC14) দেখা গেছে: TikTok Shop-এর অফিসিয়াল seller-market তালিকায় বাংলাদেশ \"Not listed\" — বাংলাদেশি seller-এর কোনো TikTok Shop-ই থাকতে পারে না, তাই কানেক্ট করার মতো কোনো আসল অ্যাকাউন্টের অস্তিত্বই নেই।",
    revisit: "রায় বদলাবে যদি: TikTok Shop বাংলাদেশে অফিসিয়ালি seller চালু করে, অথবা কোনো tenant সমর্থিত দেশের আসল TikTok Shop নিয়ে আসে।",
  },
  {
    provider: "daraz",
    name: "Daraz",
    icon: "🛍️",
    verdict: "no_build",
    summary: "Daraz কানেক্ট করার বাটন এখানে নেই — কোনো আসল API পথ ছাড়া বাটন বসানো হবে না।",
    reason: "গবেষণায় (EC14) দেখা গেছে: পাবলিক Lazada Open Platform শুধু মালয়েশিয়া/সিঙ্গাপুর/থাইল্যান্ড/ফিলিপাইন/ভিয়েতনাম/ইন্দোনেশিয়ার জন্য — Daraz বাংলাদেশের কোনো পাবলিক seller API বা developer onboarding পাওয়া যায়নি। Lazada ইন্টিগ্রেশনকে \"Daraz\" বলে চালানো মিথ্যা দাবি হতো।",
    revisit: "রায় বদলাবে যদি: Daraz বাংলাদেশ লিখিতভাবে third-party API access নিশ্চিত করে, অথবা অফিসিয়াল পাবলিক BD developer portal চালু হয়।",
  },
];
