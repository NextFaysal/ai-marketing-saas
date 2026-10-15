/**
 * MS5 — web mirror of the API's composer-blocks coupon snippet
 * (apps/api/src/messaging/composer-blocks.ts). Product snippets
 * are NOT mirrored: they come from the API's composer/products
 * endpoint, built from the real Product row. The coupon snippet
 * is pure text formatting, so the composer builds it locally —
 * keep the format identical to the API's.
 *
 * HONEST LIMIT: there is no tenant discount/coupon store in this
 * system. A coupon block is TEXT ONLY — the system does not
 * validate, redeem or track the code anywhere.
 */
export function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function couponSnippetText(code: string, label?: string | null): string {
  return `কুপন কোড: ${code}` + (label ? ` — ${label}` : "");
}

export function couponSnippetHtml(code: string, label?: string | null): string {
  return `<p>কুপন কোড: <strong>${escapeHtml(code)}</strong>${label ? ` — ${escapeHtml(label)}` : ""}</p>`;
}
