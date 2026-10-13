/**
 * EC14 — pure product-feed builder + serializers. One canonical
 * item model, channel serializers on top (Meta RSS-XML, Google
 * RSS-XML, generic CSV with the Google column set). Field rules
 * follow docs/ec14-marketplace-research.md (§3.4 Meta, §4.4
 * Google):
 *  - availability vocabulary differs per channel (Meta "in stock",
 *    Google "in_stock") — the serializers map it, never the model.
 *  - id capped at 50 chars (Google's limit), title 150,
 *    description 5,000 (Google's tighter caps serve both).
 *  - price = the regular price; sale_price (only when the product
 *    is on a product-level sale: compareAtMinor > price) is the
 *    current selling price. Cart promotions (EC16) are NOT feed
 *    data — feeds carry product prices only.
 *  - sale_price_effective_date is omitted: native products have
 *    no sale window, and both platforms' documented semantics are
 *    "omitted ⇒ the sale applies while sale_price is present".
 *  - gtin is emitted only when the product carries a real
 *    barcode; a GTIN is NEVER invented. Google gets
 *    identifier_exists=no when no GTIN is known.
 *  - Products with no public slug, no image, or no description
 *    text are EXCLUDED and reported in `skipped` with the reason —
 *    Meta/Google hard-require link/image_link/description, and a
 *    placeholder would be fabricated data.
 */

export interface FeedVariantInput {
  id: string;
  name?: string | null;
  sku?: string | null;
  priceMinor?: bigint | number | string | null;
  stockQuantity?: number | null;
}

export interface FeedProductInput {
  id: string;
  name: string;
  slug?: string | null;
  description?: string | null;
  seoDescription?: string | null;
  sku?: string | null;
  priceMinor: bigint | number | string;
  compareAtMinor?: bigint | number | string | null;
  currency?: string | null;
  stockQuantity?: number | null;
  imageUrl?: string | null;
  images?: Array<{ url: string; position?: number | null }>;
  barcode?: string | null;
  categoryName?: string | null;
  variants?: FeedVariantInput[];
}

export interface FeedItem {
  id: string;
  title: string;
  description: string;
  link: string;
  imageLink: string;
  additionalImageLinks: string[];
  inStock: boolean;
  /** Regular price (minor). On sale: the compare-at price. */
  priceMinor: bigint;
  /** Current selling price when on sale, else null. */
  salePriceMinor: bigint | null;
  currency: string;
  brand: string;
  gtin: string | null;
  googleProductCategory: string | null;
  productType: string | null;
  itemGroupId: string | null;
}

export interface FeedSkipped {
  productId: string;
  name: string;
  reason: "slug_missing" | "image_missing" | "description_missing" | "out_of_stock";
}

export interface FeedBuildOptions {
  webBase: string;
  orgSlug: string;
  shopEnabled: boolean;
  brand: string;
  defaultGoogleCategory?: string | null;
  includeOutOfStock: boolean;
}

export const FEED_SKIP_MESSAGES: Record<FeedSkipped["reason"], string> = {
  slug_missing: "পণ্যের পাবলিক স্লাগ নেই",
  image_missing: "পণ্যের কোনো ছবি নেই",
  description_missing: "পণ্যের বিবরণ নেই",
  out_of_stock: "স্টক শেষ (ফিডে out-of-stock অন্তর্ভুক্ত করা হয়নি)",
};

function toBig(v: bigint | number | string | null | undefined): bigint | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.trunc(v));
  const s = String(v).trim();
  return /^-?\d+$/.test(s) ? BigInt(s) : null;
}

export function stripHtmlToText(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function capText(s: string, max: number): string {
  return s.length > max ? s.slice(0, max).trimEnd() : s;
}

function feedId(raw: string | null | undefined, fallback: string): string {
  const candidate = (raw ?? "").trim();
  if (candidate && candidate.length <= 50) return candidate;
  return fallback;
}

function absoluteUrl(webBase: string, url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = webBase.replace(/\/+$/, "");
  return url.startsWith("/") ? `${base}${url}` : `${base}/${url}`;
}

export function buildFeedItems(
  products: FeedProductInput[],
  opts: FeedBuildOptions,
): { items: FeedItem[]; skipped: FeedSkipped[] } {
  const items: FeedItem[] = [];
  const skipped: FeedSkipped[] = [];
  const webBase = opts.webBase.replace(/\/+$/, "");

  for (const p of products ?? []) {
    const name = String(p.name ?? "");
    if (!p.slug) {
      skipped.push({ productId: p.id, name, reason: "slug_missing" });
      continue;
    }
    const gallery = [...(p.images ?? [])]
      .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
      .map((i) => i.url)
      .filter(Boolean);
    const primary = gallery[0] ?? p.imageUrl ?? null;
    if (!primary) {
      skipped.push({ productId: p.id, name, reason: "image_missing" });
      continue;
    }
    const additional: string[] = [];
    for (const u of gallery.slice(1)) {
      const abs = absoluteUrl(webBase, u);
      if (!additional.includes(abs)) additional.push(abs);
    }
    if (p.imageUrl) {
      const abs = absoluteUrl(webBase, p.imageUrl);
      if (abs !== absoluteUrl(webBase, primary) && !additional.includes(abs)) {
        additional.push(abs);
      }
    }
    const description = capText(stripHtmlToText(p.seoDescription ?? p.description), 5000);
    if (!description) {
      skipped.push({ productId: p.id, name, reason: "description_missing" });
      continue;
    }
    const link = opts.shopEnabled
      ? `${webBase}/shop/${opts.orgSlug}/products/${p.slug}`
      : `${webBase}/checkout/${p.slug}`;
    const currency = (p.currency ?? "BDT").toUpperCase();
    const groupId = feedId(p.sku, p.id);
    const gtin = p.barcode && String(p.barcode).trim() ? String(p.barcode).trim() : null;

    const rows: Array<{
      id: string;
      titleSuffix: string | null;
      price: bigint;
      stock: number | null;
      itemGroupId: string | null;
    }> = [];
    const variants = (p.variants ?? []).filter((v) => v != null);
    if (variants.length > 0) {
      for (const v of variants) {
        rows.push({
          id: feedId(v.sku, v.id),
          titleSuffix: v.name ? String(v.name) : null,
          price: toBig(v.priceMinor) ?? toBig(p.priceMinor) ?? 0n,
          stock: v.stockQuantity ?? p.stockQuantity ?? null,
          itemGroupId: groupId,
        });
      }
    } else {
      rows.push({
        id: groupId,
        titleSuffix: null,
        price: toBig(p.priceMinor) ?? 0n,
        stock: p.stockQuantity ?? null,
        itemGroupId: null,
      });
    }

    for (const row of rows) {
      const inStock = row.stock === null || row.stock > 0;
      if (!inStock && !opts.includeOutOfStock) {
        skipped.push({ productId: p.id, name, reason: "out_of_stock" });
        continue;
      }
      const compareAt = toBig(p.compareAtMinor);
      const onSale = compareAt !== null && compareAt > row.price;
      const title = capText(row.titleSuffix ? `${name} — ${row.titleSuffix}` : name, 150);
      items.push({
        id: row.id,
        title,
        description,
        link,
        imageLink: absoluteUrl(webBase, primary),
        additionalImageLinks: additional.slice(0, 10),
        inStock,
        priceMinor: onSale ? (compareAt as bigint) : row.price,
        salePriceMinor: onSale ? row.price : null,
        currency,
        brand: opts.brand,
        gtin,
        googleProductCategory: opts.defaultGoogleCategory ?? null,
        productType: p.categoryName ?? null,
        itemGroupId: row.itemGroupId,
      });
    }
  }
  return { items, skipped };
}

// ---------- serializers ----------

export function formatFeedPrice(minor: bigint, currency: string): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const whole = abs / 100n;
  const frac = abs % 100n;
  return `${neg ? "-" : ""}${whole.toString()}.${frac.toString().padStart(2, "0")} ${currency}`;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function el(tag: string, value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  return `<${tag}>${xmlEscape(value)}</${tag}>`;
}

export function serializeFeedXml(
  items: FeedItem[],
  channel: "meta" | "google",
  shop: { name: string; link: string; description: string },
): string {
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">');
  out.push("<channel>");
  out.push(el("title", shop.name));
  out.push(el("link", shop.link));
  out.push(el("description", shop.description));
  for (const it of items) {
    out.push("<item>");
    out.push(el("g:id", it.id));
    out.push(el("g:title", it.title));
    out.push(el("g:description", it.description));
    out.push(el("g:link", it.link));
    out.push(el("g:image_link", it.imageLink));
    // Meta's own XML example leaves additional_image_link
    // unprefixed; Google repeats g:additional_image_link.
    if (channel === "google") {
      for (const u of it.additionalImageLinks) out.push(el("g:additional_image_link", u));
    } else if (it.additionalImageLinks.length > 0) {
      out.push(el("additional_image_link", it.additionalImageLinks.join(",")));
    }
    out.push(el("g:condition", "new"));
    out.push(el("g:availability", channel === "meta" ? (it.inStock ? "in stock" : "out of stock") : it.inStock ? "in_stock" : "out_of_stock"));
    out.push(el("g:price", formatFeedPrice(it.priceMinor, it.currency)));
    if (it.salePriceMinor !== null) {
      out.push(el("g:sale_price", formatFeedPrice(it.salePriceMinor, it.currency)));
    }
    out.push(el("g:brand", it.brand));
    if (it.gtin) out.push(el("g:gtin", it.gtin));
    if (channel === "google" && !it.gtin) {
      // No GTIN is known for this product — say so honestly
      // instead of omitting (Google then assumes one exists).
      out.push(el("g:identifier_exists", "no"));
    }
    if (it.googleProductCategory) out.push(el("g:google_product_category", it.googleProductCategory));
    if (it.productType) out.push(el("g:product_type", it.productType));
    if (it.itemGroupId) out.push(el("g:item_group_id", it.itemGroupId));
    out.push("</item>");
  }
  out.push("</channel>");
  out.push("</rss>");
  return out.join("\n");
}

const CSV_COLUMNS = [
  "id",
  "title",
  "description",
  "link",
  "image_link",
  "additional_image_link",
  "availability",
  "condition",
  "price",
  "sale_price",
  "brand",
  "gtin",
  "identifier_exists",
  "google_product_category",
  "product_type",
  "item_group_id",
] as const;

function csvCell(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

/** Generic CSV with the GOOGLE column set (research §5: TikTok
 * publishes no hostable feed spec — this file is labelled
 * generic in the UI and is NOT a TikTok integration). */
export function serializeFeedCsv(items: FeedItem[]): string {
  const lines: string[] = [CSV_COLUMNS.join(",")];
  for (const it of items) {
    const row: Record<string, string> = {
      id: it.id,
      title: it.title,
      description: it.description,
      link: it.link,
      image_link: it.imageLink,
      additional_image_link: it.additionalImageLinks.join(","),
      availability: it.inStock ? "in_stock" : "out_of_stock",
      condition: "new",
      price: formatFeedPrice(it.priceMinor, it.currency),
      sale_price: it.salePriceMinor !== null ? formatFeedPrice(it.salePriceMinor, it.currency) : "",
      brand: it.brand,
      gtin: it.gtin ?? "",
      identifier_exists: it.gtin ? "" : "no",
      google_product_category: it.googleProductCategory ?? "",
      product_type: it.productType ?? "",
      item_group_id: it.itemGroupId ?? "",
    };
    lines.push(CSV_COLUMNS.map((c) => csvCell(row[c] ?? "")).join(","));
  }
  return lines.join("\n");
}

/** Serialize one feed item for the staff preview (money as
 * display strings, exactly as the file carries them). */
export function previewFeedItem(it: FeedItem, channel: string) {
  return {
    id: it.id,
    title: it.title,
    link: it.link,
    imageLink: it.imageLink,
    availability:
      channel === "meta" ? (it.inStock ? "in stock" : "out of stock") : it.inStock ? "in_stock" : "out_of_stock",
    price: formatFeedPrice(it.priceMinor, it.currency),
    salePrice: it.salePriceMinor !== null ? formatFeedPrice(it.salePriceMinor, it.currency) : null,
    brand: it.brand,
    gtin: it.gtin,
    itemGroupId: it.itemGroupId,
  };
}
