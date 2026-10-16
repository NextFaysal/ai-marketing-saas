/**
 * GB3 (GC8): shared checkout-trust payload builder — ONE shape
 * for the shop home, the single-product checkout and the landing
 * payload, so every public surface tells the shopper the same
 * terms / CAPTCHA / COD facts about the org.
 *
 * Pure-ish: it reads only through the prisma-like object and the
 * (optional) CheckoutGuardService's settings loader handed to
 * it, and every read is failure-isolated — a trust-payload
 * problem degrades to "nothing required, nothing enabled",
 * never to a broken page.
 */
import { depositConfigOf } from "./deposit";

export interface TermsRefResult {
  required: boolean;
  ref: string | null;
  url: string | null;
}

/**
 * The terms reference for a consent stamp: the PUBLISHED
 * ShopPage slug "terms" wins (`page:terms@<updatedAt ISO>` — the
 * stamp pins WHICH version was consented to); else the
 * merchant's external termsUrl; else null.
 */
export function termsRefFor(setting: any, page: any | null): TermsRefResult {
  const required = setting?.requireTermsConsent === true;
  const url =
    setting?.termsUrl != null && String(setting.termsUrl).trim() !== ""
      ? String(setting.termsUrl)
      : null;
  let ref: string | null = null;
  if (page) {
    const updated = page.updatedAt ? new Date(page.updatedAt) : null;
    ref =
      updated && !Number.isNaN(updated.getTime())
        ? `page:terms@${updated.toISOString()}`
        : "page:terms";
  } else if (url) {
    ref = url;
  }
  return { required, ref, url };
}

/** The org's published terms page row, or null (failure-isolated). */
export async function loadPublishedTermsPage(prisma: any, orgId: string): Promise<any | null> {
  try {
    const table = prisma?.shopPage;
    if (!table?.findFirst) return null;
    return (
      (await table
        .findFirst({ where: { organizationId: orgId, slug: "terms", published: true } })
        .catch(() => null)) ?? null
    );
  } catch {
    return null;
  }
}

export interface CheckoutTrust {
  termsRequired: boolean;
  termsRef: string | null;
  termsUrl: string | null;
  termsPage: boolean;
  captcha: { checkoutEnabled: boolean; otpEnabled: boolean; siteKey: string | null };
  cod: { maxOrderMinor: string | null; advanceAboveMinor: string | null };
  /** AB4 (AX5a): the org's deposit config (canonical shape
   * from fraud/deposit.depositConfigOf) — every checkout
   * surface tells the shopper the same deposit terms. */
  deposit: ReturnType<typeof depositConfigOf>;
}

/**
 * buildCheckoutTrust(prisma, guard, orgId, setting, bp)
 *
 * - `guard` may be a CheckoutGuardService (its loadFraudSettings
 *   is used), a raw fraud-settings row, or null/undefined (all
 *   CAPTCHA surfaces read as disabled).
 * - A CAPTCHA surface is "enabled" only when FULLY configured:
 *   captchaEnabled + the surface flag + a site key + a sealed
 *   secret. The site key is exposed ONLY when at least one
 *   surface is fully enabled, else null (a half-configured
 *   setup must not render a widget that can never pass).
 * - opts.includeOtp === false forces the otpEnabled output to
 *   false (the single-product surface has no OTP) without
 *   affecting the site-key decision.
 */
export async function buildCheckoutTrust(
  prisma: any,
  guard: any,
  orgId: string,
  setting: any,
  bp: any,
  opts?: { includeOtp?: boolean },
): Promise<CheckoutTrust> {
  const page = await loadPublishedTermsPage(prisma, orgId);
  const terms = termsRefFor(setting, page);

  let fraudSettings: any = null;
  try {
    if (guard?.loadFraudSettings) {
      fraudSettings = await guard.loadFraudSettings(orgId).catch(() => null);
    } else if (guard && typeof guard === "object") {
      fraudSettings = guard;
    }
  } catch {
    fraudSettings = null;
  }
  const s = fraudSettings ?? {};
  const siteKeyRaw = s.turnstileSiteKey ? String(s.turnstileSiteKey) : null;
  const secretSet = !!(s.turnstileSecretEncrypted || s.turnstileSecretSet);
  const fullyConfigured = s.captchaEnabled === true && !!siteKeyRaw && secretSet;
  const checkoutEnabled = fullyConfigured && s.captchaOnCheckout !== false;
  const otpEnabledRaw = fullyConfigured && s.captchaOnOtp === true;
  const otpEnabled = opts?.includeOtp === false ? false : otpEnabledRaw;

  return {
    termsRequired: terms.required,
    termsRef: terms.ref,
    termsUrl: terms.url,
    termsPage: !!page,
    captcha: {
      checkoutEnabled,
      otpEnabled,
      siteKey: checkoutEnabled || otpEnabledRaw ? siteKeyRaw : null,
    },
    cod: {
      maxOrderMinor: bp?.codMaxOrderMinor != null ? String(bp.codMaxOrderMinor) : null,
      advanceAboveMinor:
        bp?.codAdvanceRequiredAboveMinor != null ? String(bp.codAdvanceRequiredAboveMinor) : null,
    },
    deposit: depositConfigOf(bp),
  };
}
