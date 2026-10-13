import { createHash } from "node:crypto";
import { phoneKeyLoose } from "../commerce/promotions";

/**
 * EC25 — storefront account secrets are never stored raw.
 * OTP codes and session tokens are both persisted only as
 * SHA-256 hex digests (the OTP hash input additionally binds
 * org + phone — see ShopAccountService.requestOtp).
 */
export function hashShopSecret(value: string): string {
  return createHash("sha256").update(String(value)).digest("hex");
}

/** Loose BD phone comparison key (digits, last 11) — the ONE
 * phone-key definition, shared with the referral/tracking code. */
export function shopPhoneKey(phone: string | null | undefined): string {
  return phoneKeyLoose(phone);
}
