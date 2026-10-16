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
import type { ShopTracking } from "@/lib/shop-tracking";

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
  // AB2 (AX3): gift-card flag + face-value config (null when the
  // product is not a gift card or no config was authored).
  isGiftCard?: boolean;
  giftCardConfig?: {
    presetAmountsMinor: number[];
    allowCustomAmount: boolean;
    minAmountMinor?: number | null;
    maxAmountMinor?: number | null;
  } | null;
  bump: { title: string; priceMinor: string; imageUrl: string | null } | null;
  variants: ShopProductVariant[];
  // GC: product video (null when none).
  video?:
    | { kind: "youtube" | "vimeo"; embedUrl: string; posterUrl: string | null }
    | { kind: "file"; url: string; posterUrl: string | null }
    | null;
  // GC6: brand + free-shipping (public payload).
  brandId?: string | null;
  brand?: { id: string; name: string; slug: string; logoUrl: string | null } | null;
  freeShipping?: boolean;
  // GB7 (GC18): live flash sale covering this product, when one does.
  flashSale?: { promotionId: string; name: string; percentOff: number; endsAt: string };
}

export interface ShopBrandSummary {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  productCount: number;
}

export interface ShopBrandPage {
  brand: { id: string; name: string; slug: string; logoUrl: string | null; description: string | null };
  products: ShopProduct[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export type ShopSort = "featured" | "newest" | "price_asc" | "price_desc" | "best_selling" | "name_asc";

export const SHOP_SORTS: ShopSort[] = ["featured", "newest", "price_asc", "price_desc", "best_selling", "name_asc"];

export function shopSortOf(value: unknown): ShopSort {
  return typeof value === "string" && (SHOP_SORTS as string[]).includes(value) ? (value as ShopSort) : "featured";
}

export interface ShopPageBlock {
  type: string;
  data: Record<string, unknown>;
}

export interface ShopPageData {
  page: { slug: string; title: string; blocks: ShopPageBlock[] };
  settings: { shopName: string; locale?: string };
}

export interface ShopBundleComponent {
  productId: string;
  name: string;
  variantSku: string | null;
  qty: number;
  unitPriceMinor: string;
}

/** AB5 (AX8): one mix-and-match slot option (a pool product). */
export interface ShopBundleSlotOption {
  productId: string;
  name: string | null;
  imageUrl: string | null;
  variantSku: string | null;
  regularUnitMinor: string;
}

/** AB5 (AX8): a bundle slot with its CURRENT option pool,
 * resolved server-side (the shop UI never re-derives pools). */
export interface ShopBundleSlot {
  id: string | null;
  label: string;
  chooseQty: number;
  sourceType: "category" | "products" | string;
  sourceRef: { categoryId?: string; productIds?: string[] } | null;
  options: ShopBundleSlotOption[];
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
  // AB5 (AX8): mix-and-match slots (empty/absent = fixed bundle).
  slots?: ShopBundleSlot[];
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
    // GC: theme + branding + floating contact channels.
    themeId?: "classic" | "bold" | "minimal" | string;
    faviconUrl?: string | null;
    whatsappNumber?: string | null;
    messengerUrl?: string | null;
    // GB7 (GC18): merchant tracking IDs (nulls when unset).
    tracking?: ShopTracking;
    // AB8 (AX23): merchant custom code (API-supplied; may be
    // absent on older payloads — consumers read defensively).
    customCss?: string | null;
    customJs?: string | null;
    customJsEnabled?: boolean;
  };
  // GB7 (GC18): live flash sales with the server clock for countdowns.
  flashSales?: {
    serverNow: string;
    sales: Array<{
      promotionId: string;
      name: string;
      percentOff: number;
      startsAt: string | null;
      endsAt: string;
      products: Array<ShopProduct & { salePriceMinor: string }>;
    }>;
  };
  // GC: published content pages for menu/footer (published only).
  // AB6 (AX12): `blog` is true when the shop has ≥1 published blog post.
  pages?: { menu: { slug: string; title: string }[]; footer: { slug: string; title: string }[]; blog?: boolean };
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
    // AB8 (AX22): white-label flag (API-supplied; read
    // defensively — older payloads/fixtures may omit it).
    whiteLabel?: boolean;
  };
  businessProfile: {
    codAvailable: boolean;
    bkashNumber: string | null;
    nagadNumber: string | null;
    paymentNote: string | null;
  };
  districts: string[];
  categories: { id: string | null; name: string; slug: string | null; productCount: number }[];
  // GC6: only brands with ≥1 active product.
  brands?: ShopBrandSummary[];
  featuredProducts: ShopProduct[];
  products: ShopProduct[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

/** AB6 (AX12): one published blog post as listed on the blog index. */
export interface ShopBlogPostSummary {
  slug: string;
  title: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  tags: string[];
  publishedAt: string | null;
  authorName: string | null;
  // Not part of the fixed list contract; tolerated when present
  // (the sitemap prefers it over publishedAt when supplied).
  updatedAt?: string | null;
}

export interface ShopBlogOrganization {
  name: string;
  slug: string;
  brandName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
}

export interface ShopBlogList {
  posts: ShopBlogPostSummary[];
  settings: { shopName: string; locale?: string };
  organization: ShopBlogOrganization;
}

/** AB6 (AX12): one published blog post (drafts answer 404). */
export interface ShopBlogPost {
  post: {
    slug: string;
    title: string;
    excerpt: string | null;
    coverImageUrl: string | null;
    blocks: ShopPageBlock[];
    tags: string[];
    publishedAt: string | null;
    authorName: string | null;
    seo: { title: string | null; description: string | null };
  };
  settings: { shopName: string; locale?: string };
  organization: ShopBlogOrganization;
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
    sort?: string,
    brand = "",
    // AB6 (AX14): resolve specific product ids (in the ids'
    // order, ACTIVE only) — used for live recently-viewed cards.
    ids?: string[] | string,
  ): Promise<ShopHome | null> => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (category) params.set("category", category);
    if (brand) params.set("brand", brand);
    params.set("page", page);
    params.set("pageSize", pageSize);
    if (sort) params.set("sort", sort);
    const idList = (Array.isArray(ids) ? ids : ids ? [ids] : []).filter(Boolean);
    if (idList.length) params.set("ids", idList.join(","));
    return serverGet<ShopHome>(`/public/shop/${encodeURIComponent(orgSlug)}?${params.toString()}`);
  },
);

export const fetchShopBrand = cache(
  async (
    orgSlug: string,
    brandSlug: string,
    page = "1",
    pageSize = "24",
  ): Promise<ShopBrandPage | null> => {
    const params = new URLSearchParams();
    params.set("page", page);
    params.set("pageSize", pageSize);
    return serverGet<ShopBrandPage>(
      `/public/shop/${encodeURIComponent(orgSlug)}/brands/${encodeURIComponent(brandSlug)}?${params.toString()}`,
    );
  },
);

export const fetchShopPage = cache(
  async (orgSlug: string, pageSlug: string): Promise<ShopPageData | null> =>
    serverGet<ShopPageData>(
      `/public/shop/${encodeURIComponent(orgSlug)}/pages/${encodeURIComponent(pageSlug)}`,
    ),
);

export const fetchShopBlog = cache(
  async (orgSlug: string): Promise<ShopBlogList | null> =>
    serverGet<ShopBlogList>(`/public/shop/${encodeURIComponent(orgSlug)}/blog`),
);

export const fetchShopBlogPost = cache(
  async (orgSlug: string, postSlug: string): Promise<ShopBlogPost | null> =>
    serverGet<ShopBlogPost>(
      `/public/shop/${encodeURIComponent(orgSlug)}/blog/${encodeURIComponent(postSlug)}`,
    ),
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
