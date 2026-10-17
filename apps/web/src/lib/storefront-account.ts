/**
 * EC25 — storefront customer accounts (client helpers).
 *
 * Login is phone + SMS OTP. The session token lives in
 * localStorage keyed by org slug (`storefront-session-<slug>`)
 * and travels in the `x-shop-session` header. A guest wishlist
 * (productId array, `storefront-wishlist-<slug>`) is kept locally
 * and merged into the account wishlist on login.
 */
import { API_URL } from "@/lib/api";

export const SHOP_SESSION_EVENT = "storefront-session-changed";
export const GUEST_WISHLIST_EVENT = "storefront-guest-wishlist-changed";

export interface ShopCustomer {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
}

export interface ShopAddress {
  id: string;
  label: string | null;
  recipientName: string;
  phone: string;
  addressLine: string;
  district: string;
  isDefault: boolean;
}

export interface MyOrderItem {
  name: string;
  quantity: number;
  priceMinor: string;
  totalMinor: string;
  isGift: boolean;
}

export interface MyOrder {
  id: string;
  orderNumber: string;
  status: string;
  // AB4: present when the account-orders payload carries it —
  // the express-checkout preselect reads it (display only).
  paymentMethod?: string | null;
  placedAt: string;
  totalMinor: string;
  itemCount: number;
  items: MyOrderItem[];
  hasTracking: boolean;
}

export interface MyOrderDetail extends MyOrder {
  subtotalMinor: string;
  discountMinor: string;
  shippingMinor: string;
  address: string | null;
  giftSkipped: boolean;
}

export interface OrdersPage {
  items: MyOrder[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface ReorderResult {
  items: {
    productId: string;
    variantId: string | null;
    variantSku: string | null;
    name: string;
    quantity: number;
    currentPriceMinor: string;
    available: true;
  }[];
  unavailable: { name: string; reason: string }[];
}

/** AB1: one loyalty-ledger entry on the account loyalty view. */
export interface LoyaltyEntry {
  id: string;
  deltaPoints: number;
  reason: "earn" | "redeem" | "expire" | "adjust" | "referral_reward" | string;
  orderId: string | null;
  orderNumber: string | null;
  balanceAfter: number;
  expiresAt: string | null;
  remainingPoints: number | null;
  note: string | null;
  createdAt: string;
}

/** AB1: a referral-reward coupon the customer earned as referrer. */
export interface ReferralRewardCoupon {
  id: string;
  code: string;
  /** Percent value of the coupon. */
  value: number;
  kind: string;
  endsAt: string | null;
  active: boolean;
  usedCount: number;
  sourceOrderNumber: string | null;
}

/** AB1: GET :orgSlug/account/loyalty response. */
export interface AccountLoyalty {
  enabled: boolean;
  balance: number;
  /** Taka value of the balance, in paisa (a number). */
  balanceValueMinor: number;
  redeemValueMinorPerPoint: number;
  entries: LoyaltyEntry[];
  referralRewards: { coupons: ReferralRewardCoupon[] };
  referralCode: string | null;
}

/** MX14: one on-site notification in the customer's center. */
export interface ShopNotification {
  id: string;
  title: string;
  body: string;
  url: string | null;
  broadcastId: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string | null;
}

export interface WishlistItem {
  productId: string;
  name: string;
  slug: string | null;
  imageUrl: string | null;
  currentPriceMinor: string;
  priceAtAddMinor: string;
  priceDropped: boolean;
  stockState: string;
  addedAt: string;
}

// --- storage keys -------------------------------------------------

export function shopSessionKey(orgSlug: string): string {
  return `storefront-session-${orgSlug}`;
}

export function guestWishlistKey(orgSlug: string): string {
  return `storefront-wishlist-${orgSlug}`;
}

// --- session ------------------------------------------------------

export function getShopSession(orgSlug: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(shopSessionKey(orgSlug));
  } catch {
    return null;
  }
}

export function setShopSession(orgSlug: string, token: string): void {
  try {
    localStorage.setItem(shopSessionKey(orgSlug), token);
  } catch { /* storage unavailable */ }
  notifySessionChanged(orgSlug);
}

export function clearShopSession(orgSlug: string): void {
  try {
    localStorage.removeItem(shopSessionKey(orgSlug));
  } catch { /* ignore */ }
  notifySessionChanged(orgSlug);
}

export function notifySessionChanged(orgSlug: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SHOP_SESSION_EVENT, { detail: { orgSlug } }));
}

// --- guest wishlist ------------------------------------------------

export function getGuestWishlist(orgSlug: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(guestWishlistKey(orgSlug));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function setGuestWishlist(orgSlug: string, ids: string[]): void {
  try {
    localStorage.setItem(guestWishlistKey(orgSlug), JSON.stringify(ids));
  } catch { /* ignore */ }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(GUEST_WISHLIST_EVENT, { detail: { orgSlug } }));
  }
}

export function guestWishlistHas(orgSlug: string, productId: string): boolean {
  return getGuestWishlist(orgSlug).includes(productId);
}

export function guestWishlistAdd(orgSlug: string, productId: string): void {
  const list = getGuestWishlist(orgSlug);
  if (!list.includes(productId)) setGuestWishlist(orgSlug, [...list, productId]);
}

export function guestWishlistRemove(orgSlug: string, productId: string): void {
  setGuestWishlist(orgSlug, getGuestWishlist(orgSlug).filter((x) => x !== productId));
}

export function clearGuestWishlist(orgSlug: string): void {
  try {
    localStorage.removeItem(guestWishlistKey(orgSlug));
  } catch { /* ignore */ }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(GUEST_WISHLIST_EVENT, { detail: { orgSlug } }));
  }
}

// --- fetch helper ---------------------------------------------------

const shopPath = (orgSlug: string) => `/public/shop/${encodeURIComponent(orgSlug)}`;

async function accountFetch<T>(orgSlug: string, path: string, init: RequestInit = {}): Promise<T> {
  const token = getShopSession(orgSlug);
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-shop-session": token } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    // A dead/expired session falls back to guest state everywhere.
    if (res.status === 401 && token) clearShopSession(orgSlug);
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// --- auth -----------------------------------------------------------

export async function requestOtp(
  orgSlug: string,
  phone: string,
  captchaToken?: string,
): Promise<{ sent: true; expiresInSeconds: number }> {
  return accountFetch(orgSlug, `${shopPath(orgSlug)}/auth/request-otp`, {
    method: "POST",
    body: JSON.stringify({ phone, ...(captchaToken ? { captchaToken } : {}) }),
  });
}

export async function verifyOtp(
  orgSlug: string,
  phone: string,
  code: string,
): Promise<{ token: string; customer: ShopCustomer; merge: { added: number; skipped: number } | null }> {
  const out = await accountFetch<{ token: string; customer: ShopCustomer }>(
    orgSlug,
    `${shopPath(orgSlug)}/auth/verify`,
    { method: "POST", body: JSON.stringify({ phone, code }) },
  );
  setShopSession(orgSlug, out.token);
  // Merge the guest wishlist into the account, then clear it —
  // a failed merge keeps the guest list (no silent loss).
  let merge: { added: number; skipped: number } | null = null;
  const guest = getGuestWishlist(orgSlug);
  if (guest.length > 0) {
    try {
      merge = await mergeWishlist(orgSlug, guest);
      clearGuestWishlist(orgSlug);
    } catch { /* guest list retained; account page can retry implicitly next login */ }
  }
  return { token: out.token, customer: out.customer, merge };
}

export async function logout(orgSlug: string): Promise<void> {
  try {
    await accountFetch(orgSlug, `${shopPath(orgSlug)}/auth/logout`, { method: "POST" });
  } catch { /* session is cleared locally regardless */ }
  clearShopSession(orgSlug);
}

// --- account data -----------------------------------------------------

export async function fetchMe(
  orgSlug: string,
): Promise<{ customer: ShopCustomer; defaultAddress: ShopAddress | null }> {
  return accountFetch(orgSlug, `${shopPath(orgSlug)}/account/me`);
}

export async function updateProfile(
  orgSlug: string,
  body: { name?: string; email?: string },
): Promise<{ customer: ShopCustomer; defaultAddress: ShopAddress | null }> {
  return accountFetch(orgSlug, `${shopPath(orgSlug)}/account/profile`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

/** AB1: the signed-in customer's loyalty balance, history and referral rewards. */
export async function fetchAccountLoyalty(orgSlug: string): Promise<AccountLoyalty> {
  return accountFetch(orgSlug, `${shopPath(orgSlug)}/account/loyalty`);
}

export interface AccountStoreCreditEntry {
  id: string;
  deltaMinor: string;
  reason: string;
  orderId: string | null;
  balanceAfter: string;
  note: string | null;
  createdAt: string | null;
}

export interface AccountStoreCredit {
  /** Derived ledger balance, paisa as a string. */
  balanceMinor: string;
  entries: AccountStoreCreditEntry[];
  tier: {
    customerId: string;
    tierId: string | null;
    tierName: string | null;
    lifetimeSpendMinor: string;
  } | null;
}

/** NF7: the signed-in customer's OWN store-credit balance,
 * ledger history and membership tier. Session-scoped on the
 * server — it can only ever return the caller's own data. */
export async function fetchAccountStoreCredit(orgSlug: string): Promise<AccountStoreCredit> {
  return accountFetch(orgSlug, `${shopPath(orgSlug)}/account/store-credit`);
}

export async function fetchMyOrders(orgSlug: string, page = 1, pageSize = 10): Promise<OrdersPage> {
  return accountFetch(orgSlug, `${shopPath(orgSlug)}/account/orders?page=${page}&pageSize=${pageSize}`);
}

export async function fetchMyOrder(orgSlug: string, orderId: string): Promise<MyOrderDetail> {
  return accountFetch(orgSlug, `${shopPath(orgSlug)}/account/orders/${encodeURIComponent(orderId)}`);
}

export async function reorderOrder(orgSlug: string, orderId: string): Promise<ReorderResult> {
  return accountFetch(orgSlug, `${shopPath(orgSlug)}/account/orders/${encodeURIComponent(orderId)}/reorder`, {
    method: "POST",
  });
}

// --- addresses ----------------------------------------------------------

export async function fetchAddresses(orgSlug: string): Promise<{ items: ShopAddress[] }> {
  return accountFetch(orgSlug, `${shopPath(orgSlug)}/account/addresses`);
}

export async function createAddress(
  orgSlug: string,
  body: {
    label?: string;
    recipientName: string;
    phone: string;
    addressLine: string;
    district: string;
    isDefault?: boolean;
  },
): Promise<ShopAddress> {
  return accountFetch(orgSlug, `${shopPath(orgSlug)}/account/addresses`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateAddress(
  orgSlug: string,
  id: string,
  body: Partial<{
    label: string;
    recipientName: string;
    phone: string;
    addressLine: string;
    district: string;
    isDefault: boolean;
  }>,
): Promise<ShopAddress> {
  return accountFetch(orgSlug, `${shopPath(orgSlug)}/account/addresses/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteAddress(orgSlug: string, id: string): Promise<void> {
  await accountFetch(orgSlug, `${shopPath(orgSlug)}/account/addresses/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// --- wishlist (account) ---------------------------------------------------

export async function fetchWishlist(orgSlug: string): Promise<{ items: WishlistItem[] }> {
  return accountFetch(orgSlug, `${shopPath(orgSlug)}/account/wishlist`);
}

export async function addWishlist(orgSlug: string, productId: string): Promise<unknown> {
  return accountFetch(orgSlug, `${shopPath(orgSlug)}/account/wishlist`, {
    method: "POST",
    body: JSON.stringify({ productId }),
  });
}

export async function removeWishlist(orgSlug: string, productId: string): Promise<unknown> {
  return accountFetch(orgSlug, `${shopPath(orgSlug)}/account/wishlist/${encodeURIComponent(productId)}`, {
    method: "DELETE",
  });
}

export async function mergeWishlist(
  orgSlug: string,
  productIds: string[],
): Promise<{ added: number; skipped: number }> {
  return accountFetch(orgSlug, `${shopPath(orgSlug)}/account/wishlist/merge`, {
    method: "POST",
    body: JSON.stringify({ productIds }),
  });
}

// --- MX14: on-site notifications ------------------------------------

export async function fetchNotifications(
  orgSlug: string,
): Promise<{ items: ShopNotification[]; unreadCount: number }> {
  return accountFetch(orgSlug, `${shopPath(orgSlug)}/account/notifications`);
}

export async function markNotificationRead(orgSlug: string, notificationId: string): Promise<ShopNotification> {
  return accountFetch(orgSlug, `${shopPath(orgSlug)}/account/notifications/${encodeURIComponent(notificationId)}/read`, {
    method: "POST",
  });
}

export async function markAllNotificationsRead(orgSlug: string): Promise<{ marked: number; unreadCount: number }> {
  return accountFetch(orgSlug, `${shopPath(orgSlug)}/account/notifications/read-all`, { method: "POST" });
}
