/**
 * AD6 — client-side search/filter for the Ad Accounts page.
 *
 * The list endpoint (AD1/AD3) already returns everything the page
 * needs per account — name, label, externalId, platform, computed
 * health and the platform-status bucket — so filtering runs over
 * the already-fetched list instead of duplicating the query
 * server-side (see docs/ad-accounts-ad6-acceptance.md). Kept as a
 * pure function so the behaviour is unit-testable without a
 * component harness.
 */
export interface FilterableAdAccount {
  name: string;
  label?: string | null;
  externalId?: string | null;
  platform: string;
  health?: string;
  platformStatusBucket?: string | null;
}

export interface AdAccountFilters {
  /** Free text matched against name, label and externalId (case-insensitive substring). */
  query?: string;
  /** Exact platform match ("meta" | "google" | "tiktok" | …); empty = all. */
  platform?: string;
  /** AD1 computed health incl. AD5's "sync_disabled"; empty = all. */
  health?: string;
  /** AD3 platform-status bucket ("active" | "disabled" | "restricted" | "unknown"); empty = all. */
  status?: string;
}

export function filterAdAccounts<T extends FilterableAdAccount>(accounts: T[], filters: AdAccountFilters): T[] {
  const q = (filters.query ?? "").trim().toLowerCase();
  return accounts.filter((a) => {
    if (filters.platform && a.platform !== filters.platform) return false;
    if (filters.health && (a.health ?? "") !== filters.health) return false;
    if (filters.status && (a.platformStatusBucket ?? "") !== filters.status) return false;
    if (q) {
      const haystack = [a.name, a.label ?? "", a.externalId ?? ""].join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}
