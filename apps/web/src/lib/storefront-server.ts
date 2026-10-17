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
import type { PublicShopOffer } from "@/lib/app-offers-nf14";

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
  // NF5 (FB3): DISPLAY-ONLY converted prices from human-entered
  // rates (empty/absent when no rate is configured). The label is
  // the server's honest wording — approximate, checkout in base.
  displayPrices?: { currency: string; amount: string; label: string; sourceNote: string; rateUpdatedAt: string | null }[];
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
    // OU8: section customizer (optional — older API payloads omit).
    showHero?: boolean;
    showBrands?: boolean;
    showBundles?: boolean;
    showFlashSale?: boolean;
    showRecentlyViewed?: boolean;
    sectionOrder?: string[] | null;
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

/**
 * ED5 (EB2) cache policy for server-side shop reads.
 *
 * Every fetch through `serverGet` carries an explicit cache class:
 *  - "public"  → Next Data Cache, `{ next: { revalidate: 60 } }`.
 *    Used ONLY for public catalogue/content reads (the `/public/shop/*`
 *    endpoints): the same payload is served to every visitor, it
 *    contains no per-visitor, per-session or per-cart state, and it
 *    is safe to serve stale for a short window.
 *  - "private" → `{ cache: "no-store" }`. Reserved for anything
 *    user-specific (cart, account, orders, tracking-by-token…).
 *    NOTE: no export in this file is private today — those reads do
 *    NOT go through this file at all. They are client-side
 *    `/backend` fetches in lib/storefront-cart.ts (fetchCart) and
 *    lib/storefront-account.ts (fetchWishlist, fetchMe, orders…),
 *    keyed by a cart token / shop session in localStorage. The
 *    "private" class exists so a future export cannot silently
 *    inherit the public default.
 *
 * Accepted trade-off (documented, deliberate): public shop data may
 * be up to 60 seconds stale — a merchant's price/stock/content edit
 * can take up to a minute to appear on the storefront. There is NO
 * on-demand revalidation (no revalidatePath/revalidateTag webhook
 * from the API on merchant edits); that is out of scope for ED5.
 */
export type ShopCacheClass = "public" | "private";

export const SHOP_PUBLIC_REVALIDATE_SECONDS = 60;

async function serverGet<T>(path: string, cacheClass: ShopCacheClass = "public"): Promise<T | null> {
  try {
    const res = await fetch(
      `${apiInternalBase()}${path}`,
      cacheClass === "private"
        ? { cache: "no-store" }
        : { next: { revalidate: SHOP_PUBLIC_REVALIDATE_SECONDS } },
    );
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
    // NF5 (FB3): shopper locale choice (bn | en | hi) — forwarded
    // to the API's ?locale= on the same :orgSlug route; absent =
    // the org's StorefrontSetting.locale applies.
    locale?: string,
  ): Promise<ShopHome | null> => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (category) params.set("category", category);
    if (brand) params.set("brand", brand);
    if (locale) params.set("locale", locale);
    params.set("page", page);
    params.set("pageSize", pageSize);
    if (sort) params.set("sort", sort);
    const idList = (Array.isArray(ids) ? ids : ids ? [ids] : []).filter(Boolean);
    if (idList.length) params.set("ids", idList.join(","));
    // ED5: public — catalogue/home payload (incl. q/category/brand/sort/page/ids variants); identical for every visitor.
    return serverGet<ShopHome>(`/public/shop/${encodeURIComponent(orgSlug)}?${params.toString()}`, "public");
  },
);

/** NF14 (FB5): the shop's active public offers (display data
 * only — the standalone/app-only filtering happens client-side
 * in ShopOffers via lib/app-offers-nf14). */
export const fetchShopOffers = cache(
  async (orgSlug: string): Promise<{ offers: PublicShopOffer[] } | null> =>
    // ED5: public — active offers are identical for every visitor.
    serverGet<{ offers: PublicShopOffer[] }>(
      `/public/shop/${encodeURIComponent(orgSlug)}/offers`,
      "public",
    ),
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
    // ED5: public — published brand page + its active products.
    return serverGet<ShopBrandPage>(
      `/public/shop/${encodeURIComponent(orgSlug)}/brands/${encodeURIComponent(brandSlug)}?${params.toString()}`,
      "public",
    );
  },
);

export const fetchShopPage = cache(
  async (orgSlug: string, pageSlug: string): Promise<ShopPageData | null> =>
    // ED5: public — published content page only.
    serverGet<ShopPageData>(
      `/public/shop/${encodeURIComponent(orgSlug)}/pages/${encodeURIComponent(pageSlug)}`,
      "public",
    ),
);

export const fetchShopBlog = cache(
  async (orgSlug: string): Promise<ShopBlogList | null> =>
    // ED5: public — published blog index only.
    serverGet<ShopBlogList>(`/public/shop/${encodeURIComponent(orgSlug)}/blog`, "public"),
);

export const fetchShopBlogPost = cache(
  async (orgSlug: string, postSlug: string): Promise<ShopBlogPost | null> =>
    // ED5: public — one published blog post (drafts answer 404).
    serverGet<ShopBlogPost>(
      `/public/shop/${encodeURIComponent(orgSlug)}/blog/${encodeURIComponent(postSlug)}`,
      "public",
    ),
);

export const fetchProductDetail = cache(
  async (orgSlug: string, productSlug: string): Promise<ShopProductDetail | null> =>
    // ED5: public — product detail + related; no per-visitor fields (recently-viewed is client-side).
    serverGet<ShopProductDetail>(
      `/public/shop/${encodeURIComponent(orgSlug)}/products/${encodeURIComponent(productSlug)}`,
      "public",
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
  // ED5: public — aggregate reviews summary (average + count) only; no individual reviewer identity is consumed here.
  const data = await serverGet<{ summary?: { average: number | null; count: number } }>(
    `/public/shop/${encodeURIComponent(orgSlug)}/products/${encodeURIComponent(productSlug)}/reviews`,
    "public",
  );
  return data?.summary ?? null;
}
