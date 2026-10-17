/**
 * EC13 — SERVER-only fetch helper for landing metadata.
 *
 * Mirrors storefront-server.ts: imported only by the /l/[slug]
 * server wrapper + generateMetadata. It talks to the API on its
 * internal address (API_INTERNAL_URL); the browser-facing payload
 * (with the visitor's A/B variant) is fetched client-side by
 * LandingClient, because variant assignment needs the visitor
 * token from localStorage.
 */
import { cache } from "react";
import { apiInternalBase } from "./storefront-server";

export interface LandingMeta {
  landing: { id: string; slug: string; title: string };
  product: {
    name: string;
    description?: string | null;
    imageUrl?: string | null;
    images?: string[];
  };
  organization: { name?: string | null };
}

/**
 * ED5 (EB2): same cache policy as lib/storefront-server.ts.
 * This fetch is "public": it returns only landing metadata (title,
 * product name/description/images, org name) for a published landing
 * slug — identical for every visitor. The per-visitor payload (with
 * the A/B variant, which needs the visitor token from localStorage)
 * is NOT fetched here; LandingClient fetches it client-side.
 * Trade-off: metadata may be up to 60s stale; no on-demand
 * revalidation (out of scope for ED5).
 */
export const fetchLandingMeta = cache(async (slug: string): Promise<LandingMeta | null> => {
  try {
    const res = await fetch(`${apiInternalBase()}/public/landing/${encodeURIComponent(slug)}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return (await res.json()) as LandingMeta;
  } catch {
    return null;
  }
});
