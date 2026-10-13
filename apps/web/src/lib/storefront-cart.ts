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
  bump: { title: string; priceMinor: string } | null;
  unitPriceMinor: string;
  lineTotalMinor: string;
}

export interface Cart {
  id: string;
  status: string;
  email: string | null;
  phone: string | null;
  items: CartItem[];
  updatedAt?: string;
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
  return cart.items.reduce((sum, i) => sum + i.quantity, 0);
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
  body: { productId: string; variantId?: string | null; quantity: number; includeBump?: boolean },
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
  body: { cartToken: string; district: string; couponCode?: string },
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
    paymentMethod?: "cod" | "bkash" | "nagad";
    note?: string;
    advanceNote?: string;
  },
): Promise<CheckoutResult> {
  return publicFetch<CheckoutResult>(`${shopPath(orgSlug)}/checkout`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function lastOrderKey(orgSlug: string): string {
  return `storefront-last-order-${orgSlug}`;
}
