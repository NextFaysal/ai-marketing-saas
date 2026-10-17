// NF7 (FB3) — Membership tiers + store credit: staff-side and
// shop-side shapes, Bengali labels and pure payload builders.
// Shapes mirror the API contracts:
//   GET/POST/PATCH/DELETE organizations/:id/membership/tiers
//   GET    organizations/:id/customers/:cid/membership
//   GET    organizations/:id/customers/:cid/store-credit
//   POST   organizations/:id/customers/:cid/store-credit/grant
//   POST   organizations/:id/orders/:oid/refund-to-credit
//   GET/POST/DELETE organizations/:id/commerce/tiers/:tid/price-list[/items]
//   GET    public/shop/:slug/account/store-credit
// Money is paisa as a STRING over the wire, like every other
// commerce minor field.

export interface TierView {
  id: string;
  name: string;
  /** Lifetime sold-spend threshold, paisa string. */
  minSpendMinor: string;
  sortOrder: number;
  memberCount?: number;
  hasPriceList?: boolean;
}

export interface CustomerTierView {
  customerId: string;
  tierId: string | null;
  tierName: string | null;
  minSpendMinor: string | null;
  lifetimeSpendMinor: string;
  computedAt: string | null;
}

export interface StoreCreditEntryView {
  id: string;
  customerId?: string;
  deltaMinor: string;
  reason: string;
  orderId: string | null;
  balanceAfter: string;
  note: string | null;
  createdAt: string | null;
}

export interface CustomerCreditView {
  customerId: string;
  balanceMinor: string;
  entries: StoreCreditEntryView[];
}

export interface AccountCreditView {
  balanceMinor: string;
  entries: StoreCreditEntryView[];
  tier: CustomerTierView | null;
}

const REASON_LABELS: Record<string, string> = {
  grant_manual: "স্টাফ ক্রেডিট দিয়েছেন",
  refund_credit: "রিফান্ড → স্টোর ক্রেডিট",
  spend: "অর্ডারে খরচ",
  spend_reversal: "বাতিল অর্ডারের ক্রেডিট ফেরত",
};

/** Bengali label for a ledger reason; unknown reasons fall
 * back to the raw value (never an invented label). */
export function creditReasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason;
}

/** Signed paisa string for display: credits +, spends −. */
export function creditDeltaLabel(deltaMinor: string): string {
  try {
    const v = BigInt(deltaMinor);
    if (v > 0n) return `+${v.toString()}`;
    return v.toString();
  } catch {
    return deltaMinor;
  }
}

/** The refund-to-credit gate, mirrored from the API: the
 * orders UI renders the credit option ONLY when the order's
 * push-state says it is enabled (the server computes it from
 * the per-store setting, default OFF, and re-checks on the
 * refund call itself). */
export function refundToCreditOffered(pushState: { refundToCreditEnabled?: boolean } | null | undefined): boolean {
  return pushState?.refundToCreditEnabled === true;
}

/** Taka input (e.g. "250" / "250.50") → paisa string, or null
 * when the input is not a positive amount. Pure — the same
 * discipline as the orders refund input. */
export function takaToMinorString(raw: string): string | null {
  const s = String(raw ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const minor = BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
  return minor > 0n ? minor.toString() : null;
}

/** Build the tier create/update payload. minSpend comes from a
 * taka input; an unparseable amount yields null so the caller
 * can show the error instead of sending garbage. */
export function buildTierPayload(input: { name: string; minSpendTaka: string; sortOrder: string }): {
  name: string; minSpendMinor: string; sortOrder: number;
} | null {
  const name = input.name.trim();
  if (!name) return null;
  const minSpendMinor = takaToMinorString(input.minSpendTaka);
  if (minSpendMinor === null) return null;
  const sortOrder = Number(input.sortOrder);
  return { name, minSpendMinor, sortOrder: Number.isInteger(sortOrder) ? sortOrder : 0 };
}

/** Build a manual-grant payload; the note is REQUIRED by the
 * API — an empty note yields null here so the form can refuse
 * before any request. */
export function buildGrantPayload(input: { amountTaka: string; note: string }): {
  amountMinor: string; note: string;
} | null {
  const amountMinor = takaToMinorString(input.amountTaka);
  const note = input.note.trim();
  if (amountMinor === null || !note) return null;
  return { amountMinor, note };
}
