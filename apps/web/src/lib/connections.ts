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
  deepLink: string;
}

/** CC3 — an own-app config as the API reports it (no secret, ever). */
export interface TenantAppConfigView {
  platform: string; // meta | tiktok
  appId: string;
  status: string; // verified | configured
  lastVerifiedAt: string | null;
  lastError: string | null;
  verificationNote: string; // verified_with_meta | verified_at_first_connect
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
  provider: string; // sslcommerz | bkash | nagad
  identifier: string | null;
  sandbox: boolean;
  status: string; // verified | configured
  isEnabled: boolean;
  lastVerifiedAt: string | null;
  lastError: string | null;
  verificationNote: string; // verified_with_gateway | no_pre_transaction_check
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
  status: string; // pending | approved | paid | rejected | cancelled
  adminNote: string | null;
  payoutRef: string | null;
  createdAt: string;
  updatedAt: string;
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

export function formatWhen(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("bn-BD", { dateStyle: "medium", timeStyle: "short" });
}
