/**
 * EC27 — pure SEO builders for the native shop (unit-tested).
 *
 * JSON-LD is built ONLY from real payload data: the product's own
 * name/images/price/stock state, and the EC15 unified reviews
 * summary. aggregateRating is OMITTED ENTIRELY when there are no
 * reviews — a rating is never fabricated. Availability is omitted
 * for untracked stock (no stock claim exists to make).
 */
import { shopSubdomainHost } from "@repo/contracts";
import { buildSitemapUrl } from "./storefront-sitemap";

/** Legacy path-form canonical (web host + /shop/<slug>). Kept for
 * compatibility; TD7 pages use the host-form below. */
export function canonicalShopUrl(base: string, orgSlug: string, productSlug?: string): string {
  return productSlug
    ? buildSitemapUrl(base, `/shop/${orgSlug}/products/${encodeURIComponent(productSlug)}`)
    : buildSitemapUrl(base, `/shop/${orgSlug}`);
}

// ---------- TD7: host-form canonical base ----------

/** Strip scheme/path/trailing dots from a stored custom domain. */
export function normalizeCustomDomainHost(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
}

export interface CanonicalShopOrg {
  slug: string;
  customDomain?: string | null;
  domainVerified?: boolean;
}

/**
 * TD7 — THE canonical origin of a shop, exactly one per shop:
 * the merchant's own domain when it is set AND verified (the EC8
 * condition, as carried by the shop home payload), otherwise the
 * tenant subdomain {slug}.qosprey.com from the TD1 contracts rule.
 */
export function canonicalShopBase(org: CanonicalShopOrg): string {
  const domain = org.domainVerified ? normalizeCustomDomainHost(org.customDomain) : "";
  if (domain) return `https://${domain}`;
  return `https://${shopSubdomainHost(org.slug)}`;
}

/** Canonical URL on a host-form base: the shop lives at its root. */
export function canonicalShopUrlAt(canonicalBase: string, productSlug?: string): string {
  const base = String(canonicalBase ?? "").replace(/\/+$/, "");
  return productSlug ? `${base}/products/${encodeURIComponent(productSlug)}` : `${base}/`;
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
  /** TD7: host-form canonical base (canonicalShopBase) — when
   * given, URLs are built on it instead of the legacy path form. */
  canonicalBase?: string;
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
  const url = input.canonicalBase
    ? canonicalShopUrlAt(input.canonicalBase, product.slug ?? undefined)
    : product.slug
      ? canonicalShopUrl(input.base, input.orgSlug, product.slug)
      : canonicalShopUrl(input.base, input.orgSlug);
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
  /** TD7: host-form canonical base — see ProductJsonLdInput. */
  canonicalBase?: string;
  shopName: string;
  description?: string | null;
  logoUrl?: string | null;
}

export function buildShopJsonLd(input: ShopJsonLdInput): Record<string, unknown>[] {
  const home = input.canonicalBase
    ? canonicalShopUrlAt(input.canonicalBase)
    : canonicalShopUrl(input.base, input.orgSlug);
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
