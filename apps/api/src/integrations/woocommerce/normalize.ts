import { parseMoneyToMinor } from "@repo/contracts";

// WooCommerce money arrives as decimal strings in the store currency.
// Some fields can be "" (e.g. no discount) - treat empty as 0, but a
// malformed non-empty value must fail loudly rather than sync wrong data.
export function wooMoney(value: unknown): bigint {
  if (value === null || value === undefined || value === "") return 0n;
  return parseMoneyToMinor(String(value));
}

function wooStock(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
}

export interface NormalizedProduct {
  externalId: string;
  name: string;
  slug?: string;
  description?: string;
  category?: string;
  sku?: string;
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  priceMinor: bigint;
  compareAtMinor?: bigint;
  currency: string;
  stockQuantity: number | null;
  imageUrl?: string;
}

export function normalizeWooProduct(p: any, defaultCurrency = "BDT"): NormalizedProduct {
  const status = p.status === "publish" ? "ACTIVE" : p.status === "draft" ? "DRAFT" : "ARCHIVED";
  return {
    externalId: String(p.id),
    name: String(p.name ?? `Product ${p.id}`),
    slug: p.slug || undefined,
    description: typeof p.description === "string" ? stripHtml(p.description).slice(0, 5000) : undefined,
    category: p.categories?.[0]?.name || undefined,
    sku: p.sku || undefined,
    status,
    // Woo uses price; fall back to regular_price when price is empty (e.g. some variable products)
    priceMinor: wooMoney(p.price !== "" && p.price != null ? p.price : p.regular_price),
    compareAtMinor: p.regular_price && p.sale_price && p.regular_price !== p.sale_price ? wooMoney(p.regular_price) : undefined,
    currency: defaultCurrency,
    stockQuantity: p.manage_stock ? wooStock(p.stock_quantity) : null,
    imageUrl: p.images?.[0]?.src || undefined,
  };
}

export function normalizeWooVariation(v: any): { name: string; sku?: string; priceMinor?: bigint; stockQuantity: number | null } {
  const attrText = Array.isArray(v.attributes)
    ? v.attributes.map((a: any) => a.option).filter(Boolean).join(" / ")
    : "";
  return {
    name: attrText || `Variation ${v.id}`,
    sku: v.sku || undefined,
    priceMinor: v.price !== "" && v.price != null ? wooMoney(v.price) : undefined,
    stockQuantity: v.manage_stock ? wooStock(v.stock_quantity) : null,
  };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export interface NormalizedOrderItem {
  externalProductId?: string;
  externalVariationId?: string;
  name: string;
  sku?: string;
  quantity: number;
  priceMinor: bigint;
  totalMinor: bigint;
}

export interface NormalizedOrder {
  externalId: string;
  externalNumber?: string;
  status: string;
  paymentMethod?: string;
  isCod: boolean;
  currency: string;
  subtotalMinor: bigint;
  shippingMinor: bigint;
  discountMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  refundedMinor: bigint;
  placedAt?: Date;
  customer: {
    externalId?: string; firstName?: string; lastName?: string;
    email?: string; phone?: string; address?: Record<string, unknown>;
  };
  items: NormalizedOrderItem[];
}

export function normalizeWooOrder(o: any): NormalizedOrder {
  const paymentMethod: string | undefined = o.payment_method || undefined;
  const refunds = Array.isArray(o.refunds) ? o.refunds : [];
  // Woo returns refund totals as negative amounts; store the positive total refunded.
  const refundedMinor = refunds.reduce((sum: bigint, r: any) => {
    const v = wooMoney(r.total);
    return sum + (v < 0n ? -v : v);
  }, 0n);
  const billing = o.billing ?? {};
  return {
    externalId: String(o.id),
    externalNumber: o.number ? String(o.number) : undefined,
    status: String(o.status ?? "pending"),
    paymentMethod,
    // WooCommerce's standard COD gateway id is "cod"; some local gateways
    // also use ids containing "cash_on_delivery".
    isCod: paymentMethod === "cod" || (paymentMethod?.includes("cash_on_delivery") ?? false),
    currency: o.currency || "BDT",
    subtotalMinor: (o.line_items ?? []).reduce((s: bigint, li: any) => s + wooMoney(li.subtotal), 0n),
    shippingMinor: wooMoney(o.shipping_total),
    discountMinor: wooMoney(o.discount_total),
    taxMinor: wooMoney(o.total_tax),
    totalMinor: wooMoney(o.total),
    refundedMinor,
    placedAt: o.date_created_gmt ? new Date(o.date_created_gmt + (o.date_created_gmt.endsWith("Z") ? "" : "Z")) : undefined,
    customer: {
      externalId: o.customer_id ? String(o.customer_id) : undefined,
      firstName: billing.first_name || undefined,
      lastName: billing.last_name || undefined,
      email: billing.email || undefined,
      phone: billing.phone || undefined,
      address: billing,
    },
    items: (o.line_items ?? []).map((li: any) => ({
      externalProductId: li.product_id ? String(li.product_id) : undefined,
      externalVariationId: li.variation_id ? String(li.variation_id) : undefined,
      name: String(li.name ?? "Item"),
      sku: li.sku || undefined,
      quantity: Number(li.quantity ?? 1),
      priceMinor: wooMoney(li.price),
      totalMinor: wooMoney(li.total),
    })),
  };
}
