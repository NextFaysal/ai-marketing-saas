/**
 * EC27 — pure SEO builders for the native shop (unit-tested).
 *
 * JSON-LD is built ONLY from real payload data: the product's own
 * name/images/price/stock state, and the EC15 unified reviews
 * summary. aggregateRating is OMITTED ENTIRELY when there are no
 * reviews — a rating is never fabricated. Availability is omitted
 * for untracked stock (no stock claim exists to make).
 */
import { buildSitemapUrl } from "./storefront-sitemap";

export function canonicalShopUrl(base: string, orgSlug: string, productSlug?: string): string {
  return productSlug
    ? buildSitemapUrl(base, `/shop/${orgSlug}/products/${encodeURIComponent(productSlug)}`)
    : buildSitemapUrl(base, `/shop/${orgSlug}`);
}

/** Integer minor units → a major-unit decimal string ("500.00"). */
export function minorToMajorString(minor: string): string {
  try {
    const v = BigInt(minor);
    const sign = v < 0n ? "-" : "";
    const abs = v < 0n ? -v : v;
    return `${sign}${(abs / 100n).toString()}.${(abs % 100n).toString().padStart(2, "0")}`;
  } catch {
    return minor;
  }
}

export interface ProductJsonLdInput {
  base: string;
  orgSlug: string;
  product: {
    name: string;
    slug?: string | null;
    description?: string | null;
    images?: string[];
    imageUrl?: string | null;
    sku?: string | null;
    priceMinor: string;
    currency?: string | null;
    stockState?: string | null;
  };
  reviewsSummary?: { average: number | null; count: number } | null;
}

export function buildProductJsonLd(input: ProductJsonLdInput): Record<string, unknown> {
  const { product } = input;
  const url = product.slug ? canonicalShopUrl(input.base, input.orgSlug, product.slug) : canonicalShopUrl(input.base, input.orgSlug);
  const images = (product.images?.length ? product.images : product.imageUrl ? [product.imageUrl] : [])
    .filter((x): x is string => !!x);
  const offer: Record<string, unknown> = {
    "@type": "Offer",
    url,
    priceCurrency: (product.currency ?? "BDT").toUpperCase(),
    price: minorToMajorString(product.priceMinor),
  };
  if (product.stockState === "in_stock" || product.stockState === "low") {
    offer.availability = "https://schema.org/InStock";
  } else if (product.stockState === "out_of_stock") {
    offer.availability = "https://schema.org/OutOfStock";
  }
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    url,
    offers: offer,
  };
  if (product.description) ld.description = product.description;
  if (images.length) ld.image = images;
  if (product.sku) ld.sku = product.sku;
  const summary = input.reviewsSummary;
  if (summary && summary.count > 0 && summary.average !== null && summary.average !== undefined) {
    ld.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: summary.average,
      reviewCount: summary.count,
    };
  }
  return ld;
}

export interface ShopJsonLdInput {
  base: string;
  orgSlug: string;
  shopName: string;
  description?: string | null;
  logoUrl?: string | null;
}

export function buildShopJsonLd(input: ShopJsonLdInput): Record<string, unknown>[] {
  const home = canonicalShopUrl(input.base, input.orgSlug);
  const organization: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: input.shopName,
    url: home,
  };
  if (input.description) organization.description = input.description;
  if (input.logoUrl) organization.logo = input.logoUrl;
  const website: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: input.shopName,
    url: home,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${home}?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
  return [organization, website];
}

/** Serialize JSON-LD for a <script type="application/ld+json"> tag
 * (escapes "<" so a product name can never break out of the tag). */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
