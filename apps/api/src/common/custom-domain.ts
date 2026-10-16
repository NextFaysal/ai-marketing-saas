import { PLATFORM_APEX_DOMAIN } from "@repo/contracts";

/**
 * TD9 — shared custom-domain helpers (API side).
 *
 * One source of truth for how a merchant custom domain is
 * normalised, how its www/apex variants are derived, and whether
 * a host belongs to the platform itself. StorefrontService,
 * OrganizationsService (branding path) and the CORS verified-domain
 * lookup all consume these helpers — there is deliberately no
 * second copy of the rules anywhere.
 */

/** Bengali refusal used by BOTH write paths (storefront
 * setCustomDomain + branding updateBranding) when a merchant tries
 * to claim the platform's own domain / a platform subdomain as
 * their custom domain. Kept here so the two paths can never drift
 * to different wordings. */
export const PLATFORM_CUSTOM_DOMAIN_MESSAGE =
  "প্ল্যাটফর্মের নিজের ডোমেইন বা সাবডোমেইন কাস্টম ডোমেইন হিসেবে দেওয়া যাবে না";

/**
 * Normalise a raw custom-domain input exactly as the existing
 * write paths always have: trim, lowercase, strip an http(s)://
 * protocol prefix and strip any path (everything from the first
 * "/"). Null/undefined/empty input normalises to "".
 */
export function normalizeCustomDomainInput(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

/**
 * The www/apex toggle variants of an already-normalised host:
 * a host starting with "www." toggles to the bare host, any other
 * host toggles to its "www." form. Returns the deduped array
 * [host, toggled] — a single entry only when the toggle would not
 * change anything (empty host).
 */
export function customDomainVariants(host: string): string[] {
  const h = normalizeCustomDomainInput(host);
  if (!h) return [];
  const toggled = h.startsWith("www.") ? h.slice("www.".length) : `www.${h}`;
  if (!toggled || toggled === h) return [h];
  return [h, toggled];
}

/**
 * Every host form a raw input may be stored / looked up under:
 * normalise first, then expand to the www/apex variants.
 */
export function customDomainCandidates(raw: unknown): string[] {
  const normalized = normalizeCustomDomainInput(raw);
  if (!normalized) return [];
  return customDomainVariants(normalized);
}

/**
 * True when the (normalised) domain IS the platform apex or any
 * subdomain under it — such a domain can never be a merchant
 * custom domain.
 */
export function isPlatformHostedDomain(domain: unknown): boolean {
  const d = normalizeCustomDomainInput(domain);
  if (!d) return false;
  return d === PLATFORM_APEX_DOMAIN || d.endsWith(`.${PLATFORM_APEX_DOMAIN}`);
}
