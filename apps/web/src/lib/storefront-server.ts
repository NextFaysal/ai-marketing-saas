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
  // EC27: product row timestamp — the sitemap's lastmod source.
  updatedAt?: string | null;
  compareAtMinor: string | null;
  currency: string;
  imageUrl: string | null;
  images: string[];
  stockQuantity: number | null;
  stockState: "untracked" | "out_of_stock" | "low" | "in_stock" | string;
  // EC24a: pre-order info (null when not a preorder product).
  preorder?: { enabled: true; releaseDate: string | null } | null;
  // EC24b: digital flag only — the file URL is never in this payload.
  digital?: boolean;
  bump: { title: string; priceMinor: string; imageUrl: string | null } | null;
  variants: ShopProductVariant[];
}

export interface ShopBundleComponent {
  productId: string;
  name: string;
  variantSku: string | null;
  qty: number;
  unitPriceMinor: string;
}

export interface ShopBundle {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  bundlePriceMinor: string;
  regularTotalMinor: string;
  savingsMinor: string | null;
  components: ShopBundleComponent[];
}

export interface ShopHome {
  settings: {
    shopName: string;
    announcementText: string | null;
    showFeatured: boolean;
    showCategories: boolean;
    showSearch: boolean;
    metaDescription: string | null;
    // EC19/B8: shop-surface locale + featured mode.
    locale?: "bn" | "en" | string;
    featuredMode?: string;
    // EC18/B8: branded tracking page + checkout trust copy.
    trackingPageEnabled?: boolean;
    returnPolicyText?: string | null;
    deliveryPromiseText?: string | null;
    supportPhone?: string | null;
    // EC29: gift-wrap offer on the shop checkout.
    giftWrapEnabled?: boolean;
    giftWrapFeeMinor?: string | null;
  };
  // EC29: active bundles for the home-page strip.
  bundles?: ShopBundle[];
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
  // EC27: co-purchased products from real sold orders (empty when
  // nothing clears the >= 2 co-occurrence threshold — no filler).
  boughtTogether?: ShopProduct[];
  // EC18/EC19/B8 additions on the product-detail payload.
  settings?: {
    locale?: "bn" | "en" | string;
    trackingPageEnabled?: boolean;
    returnPolicyText?: string | null;
    deliveryPromiseText?: string | null;
    supportPhone?: string | null;
  };
  organization?: {
    id: string;
    name: string;
    slug: string;
    brandName: string | null;
    logoUrl: string | null;
    primaryColor: string | null;
  };
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

/** EC27: every ACTIVE product's slug + updatedAt for the sitemap. */
export async function fetchAllProductSitemapEntries(
  orgSlug: string,
): Promise<{ slug: string; updatedAt: string | null }[]> {
  const first = await fetchShopHome(orgSlug, "", "", "1", "60");
  if (!first) return [];
  const entries = first.products
    .filter((p) => !!p.slug)
    .map((p) => ({ slug: p.slug as string, updatedAt: p.updatedAt ?? null }));
  const totalPages = first.pagination?.totalPages ?? 1;
  for (let page = 2; page <= Math.min(totalPages, 200); page++) {
    const next = await fetchShopHome(orgSlug, "", "", String(page), "60");
    if (!next) break;
    entries.push(
      ...next.products
        .filter((p) => !!p.slug)
        .map((p) => ({ slug: p.slug as string, updatedAt: p.updatedAt ?? null })),
    );
  }
  return entries;
}

/** EC27: the EC15 unified reviews summary for JSON-LD (null when
 * the endpoint is unreachable — the rating is then omitted). */
export async function fetchProductReviewsSummary(
  orgSlug: string,
  productSlug: string,
): Promise<{ average: number | null; count: number } | null> {
  const data = await serverGet<{ summary?: { average: number | null; count: number } }>(
    `/public/shop/${encodeURIComponent(orgSlug)}/products/${encodeURIComponent(productSlug)}/reviews`,
  );
  return data?.summary ?? null;
}
