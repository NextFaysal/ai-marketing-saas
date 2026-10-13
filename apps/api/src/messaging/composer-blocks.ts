/**
 * MS5 — composer building blocks: product + coupon snippets.
 * Pure helpers shared by the composer-products endpoint (and
 * mirrored by the web composer). A snippet is inserted as TEXT
 * into body (and an HTML variant into htmlBody) at compose time —
 * the stored broadcast remains plain body/htmlBody; there is no
 * block engine. Prices come from the REAL Product row's
 * priceMinor/currency; nothing is invented here.
 */

/** Minor units → display price: ৳ symbol for BDT, en-IN grouping
 * with 2 decimals (the messaging page's ৳ style). Other
 * currencies keep their code in front. */
export function formatPriceMinor(minor: bigint | number | string, currency: string): string {
  let m: bigint;
  try { m = BigInt(minor as any); } catch { m = BigInt(Math.round(Number(minor) || 0)); }
  const negative = m < 0n;
  const abs = negative ? -m : m;
  const major = Number(abs) / 100;
  const formatted = major.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = negative ? "-" : "";
  return currency === "BDT" ? `${sign}৳${formatted}` : `${sign}${currency} ${formatted}`;
}

export function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface ProductSnippetInput {
  name: string;
  priceMinor: bigint | number | string;
  currency: string;
  /** A real public product URL, or null when the product has
   * none (in this codebase: a product without a slug has no
   * public checkout page, so no link is ever fabricated). */
  url?: string | null;
}

export function productSnippetText(p: ProductSnippetInput): string {
  const line = `${p.name} — ${formatPriceMinor(p.priceMinor, p.currency)}`;
  return p.url ? `${line}\n${p.url}` : line;
}

export function productSnippetHtml(p: ProductSnippetInput): string {
  const head = `<p><strong>${escapeHtml(p.name)}</strong> — ${formatPriceMinor(p.priceMinor, p.currency)}</p>`;
  return p.url ? `${head}<p><a href="${escapeHtml(p.url)}">কিনুন</a></p>` : head;
}

export interface CouponSnippetInput { code: string; label?: string | null }

export function couponSnippetText(c: CouponSnippetInput): string {
  return `কুপন কোড: ${c.code}` + (c.label ? ` — ${c.label}` : "");
}

export function couponSnippetHtml(c: CouponSnippetInput): string {
  return `<p>কুপন কোড: <strong>${escapeHtml(c.code)}</strong>${c.label ? ` — ${escapeHtml(c.label)}` : ""}</p>`;
}
