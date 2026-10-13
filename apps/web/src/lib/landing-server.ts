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

export const fetchLandingMeta = cache(async (slug: string): Promise<LandingMeta | null> => {
  try {
    const res = await fetch(`${apiInternalBase()}/public/landing/${encodeURIComponent(slug)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as LandingMeta;
  } catch {
    return null;
  }
});
