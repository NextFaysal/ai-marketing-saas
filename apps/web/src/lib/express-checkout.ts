/**
 * AB4 (AX5c) — express checkout helpers.
 *
 * A logged-in shopper confirms a saved-address order in one sheet.
 * The payload builder is pure (spec'd); the POST carries the shop
 * session header exactly like storefront-account.ts and surfaces
 * the server's Bengali error message verbatim.
 */
import { API_URL } from "./api";
import type { FieldAnswers } from "./checkout-fields";
import type { CheckoutResult } from "./storefront-cart";

export interface ExpressCheckoutInput {
  cartToken: string;
  addressId?: string;
  paymentMethod?: "cod" | "bkash" | "nagad";
  onlinePayment?: { provider: "sslcommerz" | "bkash" | "shurjopay" | "aamarpay" | "stripe"; source: "own" | "platform" };
  fieldAnswers?: FieldAnswers;
  termsAccepted?: boolean;
  idempotencyKey?: string;
  // AB8 (AX27): client device hash (weak fraud signal).
  deviceHash?: string;
}

/** Build the POST /public/shop/:slug/express-checkout body — only
 * defined optional keys are included. */
export function buildExpressPayload(input: ExpressCheckoutInput): Record<string, unknown> {
  const body: Record<string, unknown> = { cartToken: input.cartToken };
  if (input.addressId) body.addressId = input.addressId;
  if (input.paymentMethod) body.paymentMethod = input.paymentMethod;
  if (input.onlinePayment) body.onlinePayment = input.onlinePayment;
  if (input.fieldAnswers && Object.keys(input.fieldAnswers).length > 0) body.fieldAnswers = input.fieldAnswers;
  if (input.termsAccepted !== undefined) body.termsAccepted = input.termsAccepted;
  if (input.idempotencyKey) body.idempotencyKey = input.idempotencyKey;
  if (input.deviceHash) body.deviceHash = input.deviceHash;
  return body;
}

/**
 * The preselected payment method from the account's most recent
 * order (display + payload hint only — the server re-validates).
 * Only the legacy manual kinds map onto the express DTO; anything
 * else (online/unknown) yields undefined.
 */
export function preselectPaymentMethod(
  orders: { paymentMethod?: string | null }[] | null | undefined,
): "cod" | "bkash" | "nagad" | undefined {
  const first = orders?.[0]?.paymentMethod;
  if (first === "cod" || first === "bkash" || first === "nagad") return first;
  return undefined;
}

export function paymentMethodLabelBn(method: string | null | undefined): string {
  if (method === "cod") return "ক্যাশ অন ডেলিভারি";
  if (method === "bkash") return "বিকাশ (ম্যানুয়াল)";
  if (method === "nagad") return "নগদ (ম্যানুয়াল)";
  if (method) return "অনলাইন পেমেন্ট";
  return "ক্যাশ অন ডেলিভারি";
}

/** The shop session token, read with the same storage key
 * storefront-account.ts owns (read directly here to keep this
 * module's import graph alias-free for unit tests). */
export function readShopSessionToken(orgSlug: string): string | null {
  try {
    return typeof window !== "undefined" ? localStorage.getItem(`storefront-session-${orgSlug}`) : null;
  } catch {
    return null;
  }
}

export async function placeExpressCheckout(
  orgSlug: string,
  input: ExpressCheckoutInput,
): Promise<CheckoutResult> {
  const session = readShopSessionToken(orgSlug);
  const res = await fetch(`${API_URL}/public/shop/${encodeURIComponent(orgSlug)}/express-checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(session ? { "x-shop-session": session } : {}),
    },
    body: JSON.stringify(buildExpressPayload(input)),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `অর্ডার করা যায়নি (${res.status})`);
  }
  return res.json() as Promise<CheckoutResult>;
}
