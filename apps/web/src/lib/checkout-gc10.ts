/**
 * GC10 — embedded checkout payment helpers (pure + storage).
 *
 * Honesty rules baked in:
 * - an online option's label says WHOSE gateway it is (the
 *   shop's own, or the platform's) — never a bare brand claim;
 * - the browser-return `?payment=` flag NEVER means "paid":
 *   paymentStateKind maps ONLY the polled server state
 *   "verified_paid" to "paid". "verifying", "received", a
 *   missing state — everything else stays pending/none.
 */
import { API_URL } from "./api";

export interface OnlinePaymentOption {
  provider: "sslcommerz" | "bkash" | "shurjopay" | "aamarpay" | "stripe";
  source: "own" | "platform";
  sandbox: boolean;
}

export interface OnlinePaymentSelection {
  provider: "sslcommerz" | "bkash" | "shurjopay" | "aamarpay" | "stripe";
  source: "own" | "platform";
}

export function providerDisplayName(provider: string): string {
  if (provider === "sslcommerz") return "SSLCommerz";
  if (provider === "bkash") return "bKash";
  if (provider === "shurjopay") return "ShurjoPay";
  if (provider === "aamarpay") return "aamarPay";
  if (provider === "stripe") return "Stripe (কার্ড)";
  return provider;
}

/** Radio value for an online option: `online:{source}:{provider}`. */
export function onlineSelectionValue(option: OnlinePaymentOption): string {
  return `online:${option.source}:${option.provider}`;
}

/** Parse a payment-choice radio value back into a selection.
 * Anything that is not a well-formed online value → null
 * (COD / manual values are handled by the legacy path). */
export function parseOnlineSelection(value: string | null | undefined): OnlinePaymentSelection | null {
  if (!value) return null;
  const parts = value.split(":");
  if (parts.length !== 3 || parts[0] !== "online") return null;
  const [, source, provider] = parts;
  if (source !== "own" && source !== "platform") return null;
  if (provider !== "sslcommerz" && provider !== "bkash" && provider !== "shurjopay" && provider !== "aamarpay" && provider !== "stripe") return null;
  return { provider, source };
}

/** Honest radio label: platform rows are labelled as the
 * platform gateway; own rows as a plain online payment. */
export function onlineOptionLabel(option: OnlinePaymentOption): string {
  const name = providerDisplayName(option.provider);
  return option.source === "platform"
    ? `অনলাইনে পেমেন্ট (প্ল্যাটফর্ম গেটওয়ে) — ${name}`
    : `অনলাইনে পেমেন্ট — ${name}`;
}

/** Online context for the success page: the stored checkout
 * said online_pending, OR the browser came back with a
 * ?payment= flag (gateway return / initiate failure). */
export function isOnlineCheckoutContext(
  storedClaimStatus: string | null | undefined,
  paymentParam: string | null | undefined,
): boolean {
  if (storedClaimStatus === "online_pending") return true;
  return paymentParam !== null && paymentParam !== undefined && paymentParam !== "";
}

export type PaymentStateKind = "paid" | "deposit_paid" | "pending" | "failed" | "cancelled" | "none";

// ---------- AB4 (AX5): deposits ----------

/** Deposit block on the GC10 polled payment-state response. */
export interface DepositState {
  dueMinor: string;
  paidMinor: string;
  outstandingMinor: string;
}

/** Full polled payment-state response shape. */
export interface PaymentStateResponse {
  state?: string;
  deposit?: DepositState | null;
}

/** Deposit block on the quote response (amounts are paisa strings;
 * a null amount means deposit does not apply to that payment kind). */
export interface QuoteDeposit {
  note: string;
  amounts: { cod: string | null; online: string | null; manual: string | null };
}

/** Deposit block on the checkout placement response. */
export interface PlacementDeposit {
  amountMinor: string;
  kind: string;
  note: string;
  dueAfterMinor: string;
}

export type DepositPaymentKind = "cod" | "online" | "manual";

/** Which deposit bucket a checkout payment-method radio value uses. */
export function depositKindForPaymentMethod(value: string | null | undefined): DepositPaymentKind {
  if (parseOnlineSelection(value)) return "online";
  if (value === "cod") return "cod";
  return "manual";
}

/** The server's deposit amount for a payment kind, or null when
 * deposit does not apply to that kind (or there is no deposit). */
export function depositAmountForKind(
  deposit: QuoteDeposit | null | undefined,
  kind: DepositPaymentKind,
): string | null {
  if (!deposit) return null;
  return deposit.amounts?.[kind] ?? null;
}

/**
 * The three summary lines for a deposit-active quote. All amounts
 * are the SERVER's strings; `dueAfterMinor` is a display-only
 * derivation (total − deposit) so the buyer sees what remains at
 * delivery — it is never sent back or used for pricing.
 */
export function depositSummaryLines(input: {
  totalMinor: string;
  deposit: QuoteDeposit | null | undefined;
  kind: DepositPaymentKind;
}): { totalMinor: string; depositMinor: string; dueAfterMinor: string; note: string } | null {
  const amount = depositAmountForKind(input.deposit, input.kind);
  if (amount === null) return null;
  let dueAfter = amount;
  try {
    const rest = BigInt(input.totalMinor) - BigInt(amount);
    dueAfter = (rest > 0n ? rest : 0n).toString();
  } catch { /* malformed strings render the deposit amount itself */ }
  return {
    totalMinor: input.totalMinor,
    depositMinor: amount,
    dueAfterMinor: dueAfter,
    note: input.deposit?.note ?? "",
  };
}

/** Bengali display lines for a polled deposit block (raw minors in,
 * formatted lines out via the caller's formatter). */
export function depositStateLines(
  deposit: DepositState | null | undefined,
  format: (minor: string) => string,
): string[] {
  if (!deposit) return [];
  return [
    `মোট ডিপোজিট: ${format(deposit.dueMinor)}`,
    `পরিশোধিত: ${format(deposit.paidMinor)}`,
    `বাকি: ${format(deposit.outstandingMinor)}`,
  ];
}

/** True when the deposit itself is fully paid (paid ≥ due, due > 0)
 * but the order may still carry a balance. Display comparison only. */
export function isDepositFullyPaid(deposit: DepositState | null | undefined): boolean {
  if (!deposit) return false;
  try {
    const due = BigInt(deposit.dueMinor);
    return due > 0n && BigInt(deposit.paidMinor) >= due;
  } catch {
    return false;
  }
}

export function hasOutstandingMinor(minor: string | null | undefined): boolean {
  if (!minor) return false;
  try {
    return BigInt(minor) > 0n;
  } catch {
    return false;
  }
}

/**
 * Map a POLLED server state to what the success page may
 * render. Only "verified_paid" is paid — the gateway's
 * server-side verification is the sole source of that state.
 * Unknown / informational values ("verifying", "received",
 * null) stay "pending": they must never render as success.
 */
export function paymentStateKind(state: string | null | undefined): PaymentStateKind {
  switch (state) {
    case "verified_paid":
      return "paid";
    case "deposit_paid":
      return "deposit_paid";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "none":
      return "none";
    default:
      return "pending";
  }
}

/** Polling stops only on a terminal kind. `deposit_paid` is
 * terminal for polling: the deposit leg is settled — any balance
 * is a separate, later initiation, not a poll outcome. */
export function isTerminalPaymentKind(kind: PaymentStateKind): boolean {
  return kind === "paid" || kind === "deposit_paid" || kind === "failed" || kind === "cancelled";
}

// ---------- payment initiation (GC10 + AB4 purpose) ----------

export type InitiatePurpose = "deposit" | "balance";

export interface InitiatePaymentInput {
  orderId: string;
  orderNumber: string;
  provider: OnlinePaymentSelection["provider"];
  source: OnlinePaymentSelection["source"];
  /** Omit for the legacy full-amount initiation. */
  purpose?: InitiatePurpose;
}

/** Request body for POST /public/tenant-payments/initiate/:slug —
 * `purpose` is included ONLY when given, so legacy calls stay
 * byte-identical. */
export function buildInitiatePayload(input: InitiatePaymentInput): Record<string, string> {
  const body: Record<string, string> = {
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    provider: input.provider,
    source: input.source,
  };
  if (input.purpose) body.purpose = input.purpose;
  return body;
}

// ---------- chosen online selection (for the retry button) ----------

export function onlinePaymentChoiceKey(orgSlug: string): string {
  return `storefront-online-payment-${orgSlug}`;
}

export function saveOnlinePaymentChoice(orgSlug: string, sel: OnlinePaymentSelection): void {
  try {
    sessionStorage.setItem(onlinePaymentChoiceKey(orgSlug), JSON.stringify(sel));
  } catch { /* storage unavailable — retry just stays hidden */ }
}

/**
 * Initiate (or re-initiate) a gateway payment for a placed order.
 * Returns the gateway redirect URL; throws on any failure so the
 * caller can land the buyer on the success page honestly unpaid.
 */
export async function initiatePayment(orgSlug: string, input: InitiatePaymentInput): Promise<string> {
  const res = await fetch(`${API_URL}/public/tenant-payments/initiate/${encodeURIComponent(orgSlug)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildInitiatePayload(input)),
  });
  if (!res.ok) throw new Error("initiate failed");
  const data = (await res.json()) as { redirectUrl?: string };
  if (!data.redirectUrl) throw new Error("initiate failed");
  return data.redirectUrl;
}

export function readOnlinePaymentChoice(orgSlug: string): OnlinePaymentSelection | null {
  try {
    const raw = sessionStorage.getItem(onlinePaymentChoiceKey(orgSlug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OnlinePaymentSelection;
    if (parsed?.provider !== "sslcommerz" && parsed?.provider !== "bkash" && parsed?.provider !== "shurjopay" && parsed?.provider !== "aamarpay" && parsed?.provider !== "stripe") return null;
    if (parsed?.source !== "own" && parsed?.source !== "platform") return null;
    return { provider: parsed.provider, source: parsed.source };
  } catch {
    return null;
  }
}
