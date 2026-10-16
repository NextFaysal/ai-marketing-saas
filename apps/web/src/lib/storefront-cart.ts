/**
 * EC8 storefront — client-safe cart helpers.
 *
 * The guest cart is addressed by an opaque token the API issues
 * at cart creation; it lives in localStorage keyed by org slug
 * and travels in the `x-cart-token` header. Prices are NEVER
 * stored client-side — every cart/quote response is re-serialized
 * by the server from current product rows.
 */
import { API_URL } from "@/lib/api";
import type { CheckoutAttribution } from "@/lib/shop-tracking";

export const CART_UPDATED_EVENT = "storefront-cart-updated";

export interface CartItem {
  id: string;
  productId: string;
  variantId: string | null;
  productName: string | null;
  variantName: string | null;
  imageUrl: string | null;
  quantity: number;
  includeBump: boolean;
  // AB2 (AX3): gift-card face value + recipient chosen for this
  // line (null on ordinary lines).
  giftCardAmountMinor?: string | null;
  giftCardRecipient?: { name?: string; email?: string; phone?: string; message?: string } | null;
  bump: { title: string; priceMinor: string } | null;
  unitPriceMinor: string;
  lineTotalMinor: string;
}

export interface CartBundleComponent {
  productId: string;
  name: string;
  variantSku: string | null;
  qty: number;
  // AB5 (AX8): the slot label this component was picked through
  // (null on fixed components).
  viaSlot?: string | null;
}

export interface CartBundleItem {
  id: string;
  bundleId: string;
  name: string;
  imageUrl: string | null;
  quantity: number;
  bundlePriceMinor: string;
  lineTotalMinor: string;
  components: CartBundleComponent[];
  // AB5 (AX8): the stored normalized picks (null on slotless lines).
  picks?: { slotId: string; productId: string }[] | null;
}

export interface Cart {
  id: string;
  status: string;
  email: string | null;
  phone: string | null;
  items: CartItem[];
  // EC29: bundle lines live apart from product lines.
  bundleItems?: CartBundleItem[];
  updatedAt?: string;
}

/** EC29: free-gift outcome carried by quote + checkout responses. */
export interface GiftOutcome {
  promotionName: string;
  productName: string;
  quantity: number;
}

export interface DeliverySlotOption {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
}

export interface AppliedPromotion {
  promotionId: string;
  name: string;
  type: string;
  amountMinor: string;
}

/** EC30: pickup point as carried by quote / checkout responses. */
export interface PickupPoint {
  id: string;
  name: string;
  address: string;
  district: string;
  phone: string | null;
  feeMinor: string;
}

export interface Quote {
  district: string;
  zone: { id: string; name: string; kind: string; deliveryDays: number | null } | null;
  items: unknown[];
  itemsSubtotalMinor: string;
  bumpMinor: string;
  subtotalMinor: string;
  discountMinor: string;
  deliveryMinor: string;
  totalMinor: string;
  codDueMinor: string;
  coupon: { code: string; freeShipping: boolean } | null;
  currency: string;
  // EC18/B8: active slots for the quoted district (server-filtered).
  deliverySlots?: DeliverySlotOption[];
  // EC16: server-computed promotion / referral discounts.
  promotionDiscountMinor?: string;
  promotionsApplied?: AppliedPromotion[];
  referralDiscountMinor?: string;
  referral?: { code: string; discountMinor: string } | null;
  // EC29: gift outcome + gift-wrap fee (server-computed).
  gift?: GiftOutcome | null;
  giftWrapMinor?: string;
  // EC30: delivery method + pickup point + pricing provenance.
  deliveryMethod?: string;
  pickupPoint?: PickupPoint | null;
  shippingRateRuleId?: string | null;
  zoneFreeShippingApplied?: boolean;
  freeShippingZoneId?: string | null;
  // GB3 (GC8): server COD rules for THIS quote's total.
  codRules?: {
    maxOrderMinor: string | null;
    advanceAboveMinor: string | null;
    unavailableForTotal: boolean;
    advanceRequiredForTotal: boolean;
  };
  // AB1: loyalty redemption priced into this quote (null when
  // the program is off or no customer was resolved). The object
  // only appears when the quote request asked for points.
  loyalty?: { balance: number; pointsApplied: number; discountMinor: string } | null;
  // AB2: gift-card redemption priced into this quote (last4 +
  // balances only — never the full code).
  giftCard?: { codeLast4: string; balanceMinor: string; discountMinor: string } | null;
  // AB4 (AX5): deposit quote — per-kind amounts (paisa strings;
  // null = deposit not applicable to that payment kind).
  deposit?: { note: string; amounts: { cod: string | null; online: string | null; manual: string | null } } | null;
}

export interface CheckoutResult {
  success: boolean;
  orderId: string | null;
  orderNumber: string;
  shopName: string;
  paymentMethod: string;
  paymentClaimStatus: "cod_due" | "advance_unverified" | string;
  itemsSubtotalMinor: string;
  bumpMinor: string;
  subtotalMinor: string;
  discountMinor: string;
  deliveryMinor: string;
  totalMinor: string;
  codDueMinor: string;
  amountDueMinor: string;
  currency: string;
  // EC18/B8: the slot the shopper picked, when one was chosen.
  deliverySlot?: { id: string; label: string; date: string } | null;
  // EC16: promotion / referral outcome + the buyer's own code.
  promotionDiscountMinor?: string;
  promotionsApplied?: AppliedPromotion[];
  referralDiscountMinor?: string;
  referral?: { code: string; discountMinor: string } | null;
  yourReferralCode?: string | null;
  // EC24b: order contains digital items (success-screen note).
  hasDigitalItems?: boolean;
  // EC29: gift outcome + wrap fee + honest gift-skip flag.
  gift?: GiftOutcome | null;
  giftWrapMinor?: string;
  giftSkipped?: boolean;
  // EC30: delivery method + chosen pickup point for the success screen.
  deliveryMethod?: string;
  pickupPoint?: PickupPoint | null;
  // AB1: loyalty points actually spent on this order.
  loyaltyDiscountMinor?: string;
  loyaltyPointsUsed?: number;
  // AB2: gift-card discount actually applied to this order.
  giftCardDiscountMinor?: string;
  giftCardCodeLast4?: string | null;
  // AB4 (AX5): deposit due on this order (null when none).
  deposit?: { amountMinor: string; kind: string; note: string; dueAfterMinor: string } | null;
}

export function cartTokenKey(orgSlug: string): string {
  return `storefront-cart-token-${orgSlug}`;
}

export function getCartToken(orgSlug: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(cartTokenKey(orgSlug));
  } catch {
    return null;
  }
}

export function setCartToken(orgSlug: string, token: string): void {
  try {
    localStorage.setItem(cartTokenKey(orgSlug), token);
  } catch {
    /* storage unavailable — cart still works for this page view via API errors surfaced to the user */
  }
}

export function clearCartToken(orgSlug: string): void {
  try {
    localStorage.removeItem(cartTokenKey(orgSlug));
  } catch {
    /* ignore */
  }
  notifyCartUpdated(orgSlug);
}

export function notifyCartUpdated(orgSlug: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CART_UPDATED_EVENT, { detail: { orgSlug } }));
}

export function cartItemCount(cart: Cart | null | undefined): number {
  if (!cart) return 0;
  const products = cart.items.reduce((sum, i) => sum + i.quantity, 0);
  // EC29: bundle lines count toward the header badge too.
  const bundles = (cart.bundleItems ?? []).reduce((sum, i) => sum + i.quantity, 0);
  return products + bundles;
}

async function publicFetch<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-cart-token": token } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const shopPath = (orgSlug: string) => `/public/shop/${encodeURIComponent(orgSlug)}`;

export async function createCart(orgSlug: string): Promise<{ cartToken: string; cart: Cart }> {
  const out = await publicFetch<{ cartToken: string; cart: Cart }>(`${shopPath(orgSlug)}/cart`, {
    method: "POST",
  });
  setCartToken(orgSlug, out.cartToken);
  notifyCartUpdated(orgSlug);
  return out;
}

/** Existing open cart for the stored token, or null (no token / gone / converted). */
export async function fetchCart(orgSlug: string): Promise<Cart | null> {
  const token = getCartToken(orgSlug);
  if (!token) return null;
  try {
    const out = await publicFetch<{ cart: Cart }>(`${shopPath(orgSlug)}/cart`, {}, token);
    return out.cart;
  } catch {
    return null;
  }
}

/** A usable open-cart token: reuse the stored one, mint a new cart otherwise. */
export async function ensureCartToken(orgSlug: string): Promise<string> {
  const existing = await fetchCart(orgSlug);
  if (existing && existing.status === "open") {
    const token = getCartToken(orgSlug);
    if (token) return token;
  }
  const created = await createCart(orgSlug);
  return created.cartToken;
}

export async function patchCartLine(
  orgSlug: string,
  body: {
    productId: string; variantId?: string | null; quantity: number; includeBump?: boolean;
    // AB2 (AX3): gift-card face value (minor, as a string) + the
    // flat recipient fields the cart PATCH DTO accepts.
    giftCardAmountMinor?: string;
    giftCardRecipientName?: string;
    giftCardRecipientEmail?: string;
    giftCardRecipientPhone?: string;
    giftCardRecipientMessage?: string;
  },
): Promise<Cart> {
  const token = await ensureCartToken(orgSlug);
  const out = await publicFetch<{ cart: Cart }>(
    `${shopPath(orgSlug)}/cart`,
    { method: "PATCH", body: JSON.stringify(body) },
    token,
  );
  notifyCartUpdated(orgSlug);
  return out.cart;
}

/** EC29: set a bundle line's absolute quantity (0 removes the line).
 * AB5 (AX8): a slotted bundle's picks ([{ slotId, productId }])
 * ride along — the server requires every slot satisfied exactly. */
export async function patchBundleLine(
  orgSlug: string,
  body: { bundleId: string; quantity: number; picks?: { slotId: string; productId: string }[] },
): Promise<Cart> {
  const token = await ensureCartToken(orgSlug);
  const out = await publicFetch<{ cart: Cart }>(
    `${shopPath(orgSlug)}/cart/bundle`,
    { method: "POST", body: JSON.stringify(body) },
    token,
  );
  notifyCartUpdated(orgSlug);
  return out.cart;
}

export async function setCartContact(
  orgSlug: string,
  body: { email?: string; phone?: string },
): Promise<Cart> {
  const token = await ensureCartToken(orgSlug);
  const out = await publicFetch<{ cart: Cart }>(
    `${shopPath(orgSlug)}/cart/contact`,
    { method: "POST", body: JSON.stringify(body) },
    token,
  );
  return out.cart;
}

export async function requestQuote(
  orgSlug: string,
  body: { cartToken: string; district: string; couponCode?: string; referralCode?: string; buyerPhone?: string; giftWrap?: boolean; deliveryMethod?: string; pickupPointId?: string; loyaltyPoints?: number; giftCardCode?: string },
): Promise<Quote> {
  return publicFetch<Quote>(`${shopPath(orgSlug)}/quote`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function placeCheckout(
  orgSlug: string,
  body: {
    cartToken: string;
    name: string;
    phone: string;
    address: string;
    district: string;
    couponCode?: string;
    referralCode?: string;
    // AB1: loyalty points to redeem (server re-prices + clamps).
    loyaltyPoints?: number;
    // AB2: gift-card code to redeem (server resolves + prices it).
    giftCardCode?: string;
    // EC32: affiliate partner code (attribution only, no discount).
    affiliateCode?: string;
    paymentMethod?: "cod" | "bkash" | "nagad";
    // GC10: online gateway selection (own/platform). When
    // present the server places a non-COD online order and the
    // response's paymentClaimStatus is "online_pending".
    onlinePayment?: { provider: "sslcommerz" | "bkash" | "shurjopay" | "aamarpay"; source: "own" | "platform" };
    note?: string;
    advanceNote?: string;
    deliverySlotId?: string;
    deliveryDate?: string;
    // EC29: gift wrap + message (server prices the wrap fee).
    giftWrap?: boolean;
    giftMessage?: string;
    // EC30: delivery method + chosen pickup point.
    deliveryMethod?: string;
    pickupPointId?: string;
    // GB3 (GC8): terms consent + idempotency + Turnstile token.
    termsAccepted?: boolean;
    idempotencyKey?: string;
    captchaToken?: string;
    // AB4 (AX5): answers to the org's custom checkout fields.
    fieldAnswers?: Record<string, string | boolean>;
    // AB7 (AX19): first-touch attribution (omitted when empty).
    attribution?: CheckoutAttribution;
    // AB8 (AX27): client device hash — a weak fraud signal
    // (lib/device-hash); omitted entirely when unavailable.
    deviceHash?: string;
  },
): Promise<CheckoutResult> {
  // EC25: a logged-in shopper's session links the order to their
  // account. Read lazily here to avoid a circular import with
  // storefront-account.ts (which imports nothing from this file,
  // but the storage key lives there) — the key format is shared.
  let session: string | null = null;
  try {
    session = typeof window !== "undefined" ? localStorage.getItem(`storefront-session-${orgSlug}`) : null;
  } catch { /* storage unavailable — guest checkout */ }
  return publicFetch<CheckoutResult>(`${shopPath(orgSlug)}/checkout`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: session ? { "x-shop-session": session } : {},
  });
}

export function lastOrderKey(orgSlug: string): string {
  return `storefront-last-order-${orgSlug}`;
}

/** Local (browser) calendar date as YYYY-MM-DD, `offsetDays` from today. */
export function slotDateString(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
