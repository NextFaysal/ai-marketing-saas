/**
 * EC8 storefront — SERVER-only fetch helpers.
 *
 * Imported only by server components, generateMetadata and the
 * sitemap route. Never import this from a client component: it
 * reads API_INTERNAL_URL and talks to the API on its internal
 * address (the browser-facing API_URL is the relative /backend
 * proxy, which does not work from the server).
 */
import { cache } from "react";

export function apiInternalBase(): string {
  return process.env.API_INTERNAL_URL ?? "http://localhost:4000";
}

export interface ShopProductVariant {
  id: string;
  name: string;
  sku: string | null;
  priceMinor: string | null;
  stockQuantity: number | null;
  stockState: string;
  attributes: unknown;
}

export interface ShopProduct {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  category: string | null;
  categoryId: string | null;
  sku: string | null;
  priceMinor: string;
  compareAtMinor: string | null;
  currency: string;
  imageUrl: string | null;
  images: string[];
  stockQuantity: number | null;
  stockState: "untracked" | "out_of_stock" | "low" | "in_stock" | string;
  bump: { title: string; priceMinor: string; imageUrl: string | null } | null;
  variants: ShopProductVariant[];
}

export interface ShopHome {
  settings: {
    shopName: string;
    announcementText: string | null;
    showFeatured: boolean;
    showCategories: boolean;
    showSearch: boolean;
    metaDescription: string | null;
  };
  organization: {
    id: string;
    name: string;
    slug: string;
    brandName: string | null;
    logoUrl: string | null;
    primaryColor: string | null;
    customDomain: string | null;
    domainVerified: boolean;
  };
  businessProfile: {
    codAvailable: boolean;
    bkashNumber: string | null;
    nagadNumber: string | null;
    paymentNote: string | null;
  };
  districts: string[];
  categories: { id: string | null; name: string; slug: string | null; productCount: number }[];
  featuredProducts: ShopProduct[];
  products: ShopProduct[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface ShopProductDetail {
  product: ShopProduct & {
    category: { id: string | null; name: string | null; slug: string | null; legacy: string | null };
    seo: { title: string | null; description: string | null };
  };
  related: ShopProduct[];
}

async function serverGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${apiInternalBase()}${path}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const fetchShopHome = cache(
  async (
    orgSlug: string,
    q = "",
    category = "",
    page = "1",
    pageSize = "24",
  ): Promise<ShopHome | null> => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (category) params.set("category", category);
    params.set("page", page);
    params.set("pageSize", pageSize);
    return serverGet<ShopHome>(`/public/shop/${encodeURIComponent(orgSlug)}?${params.toString()}`);
  },
);

export const fetchProductDetail = cache(
  async (orgSlug: string, productSlug: string): Promise<ShopProductDetail | null> =>
    serverGet<ShopProductDetail>(
      `/public/shop/${encodeURIComponent(orgSlug)}/products/${encodeURIComponent(productSlug)}`,
    ),
);

/** Every ACTIVE product slug, paging the shop API (pageSize 60, bounded 200 pages). */
export async function fetchAllProductSlugs(orgSlug: string): Promise<string[]> {
  const first = await fetchShopHome(orgSlug, "", "", "1", "60");
  if (!first) return [];
  const slugs: (string | null)[] = first.products.map((p) => p.slug);
  const totalPages = first.pagination?.totalPages ?? 1;
  for (let page = 2; page <= Math.min(totalPages, 200); page++) {
    const next = await fetchShopHome(orgSlug, "", "", String(page), "60");
    if (!next) break;
    slugs.push(...next.products.map((p) => p.slug));
  }
  return slugs.filter((s): s is string => !!s);
}
