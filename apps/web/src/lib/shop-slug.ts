import { PLATFORM_APEX_DOMAIN, checkSlugLocally, shopSubdomainHost } from "@repo/contracts";

/**
 * TD2 — web-side helpers for the onboarding subdomain picker.
 * The platform domain is the PLATFORM_APEX_DOMAIN constant from
 * @repo/contracts (one place), never an env var: tenant shop
 * addresses are always {slug}.qosprey.com. All rule decisions
 * (format/reserved) reuse the contracts helpers — the picker can
 * give instant feedback locally, but the authoritative verdict is
 * the API's GET /organizations/slug-available, which runs the
 * very same check plus the database "taken" state.
 */
export { PLATFORM_APEX_DOMAIN, shopSubdomainHost };

/** Same slugify the onboarding flow has always used for names. */
export function slugifyShopName(v: string): string {
  return v
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/** Local-only verdict for instant feedback while typing. */
export function localSlugProblem(slug: string): "invalid" | "reserved" | null {
  const out = checkSlugLocally(slug);
  return out.ok ? null : out.reason;
}

export const SHOP_ADDRESS_SUFFIX = `.${PLATFORM_APEX_DOMAIN}`;
