import { NormalizedOrder, NormalizedProduct, wooMoney } from "../woocommerce/normalize";

export function normalizeShopifyProduct(p: any, defaultCurrency = "BDT"): NormalizedProduct {
  const variants: any[] = Array.isArray(p.variants) ? p.variants : [];
  const first = variants[0] ?? {};
  const stock = variants.length && variants.every((v) => typeof v.inventory_quantity === "number")
    ? variants.reduce((sum, v) => sum + v.inventory_quantity, 0) : null;
  const status = p.status === "active" ? "ACTIVE" : p.status === "draft" ? "DRAFT" : "ARCHIVED";
  return {
    externalId: String(p.id),
    name: String(p.title ?? `Product ${p.id}`),
    description: typeof p.body_html === "string" ? p.body_html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 5000) : undefined,
    category: p.product_type || undefined,
    sku: first.sku || undefined,
    status,
    priceMinor: wooMoney(first.price ?? "0"),
    compareAtMinor: first.compare_at_price ? wooMoney(first.compare_at_price) : undefined,
    currency: defaultCurrency,
    stockQuantity: stock,
    imageUrl: p.images?.[0]?.src || undefined,
  };
}

export function normalizeShopifyVariant(v: any): { name: string; sku?: string; priceMinor?: bigint; stockQuantity: number | null } {
  return {
    name: String(v.title ?? "Default"),
    sku: v.sku || undefined,
    priceMinor: v.price !== undefined ? wooMoney(v.price) : undefined,
    stockQuantity: typeof v.inventory_quantity === "number" ? v.inventory_quantity : null,
  };
}

function shopifyOrderStatus(o: any): string {
  if (o.cancelled_at) return "cancelled";
  const fin = String(o.financial_status ?? "");
  if (fin === "refunded") return "refunded";
  if (fin === "voided") return "cancelled";
  if (o.fulfillment_status === "fulfilled" && (fin === "paid" || fin === "partially_refunded")) return "completed";
  if (fin === "paid" || fin === "partially_paid" || fin === "partially_refunded") return "processing";
  return "pending";
}

export function normalizeShopifyOrder(o: any): NormalizedOrder {
  const money = (set: any, fallback?: unknown): bigint => wooMoney(set?.shop_money?.amount ?? fallback ?? "0");
  let refunded = 0n;
  for (const refund of o.refunds ?? []) {
    for (const tx of refund.transactions ?? []) {
      if (tx.kind === "refund" && tx.status !== "failure") refunded += wooMoney(tx.amount ?? "0");
    }
  }
  const gateways: string[] = Array.isArray(o.payment_gateway_names) ? o.payment_gateway_names : [];
  const isCod = gateways.some((g) => /cash|cod/i.test(g));
  const customer = o.customer ?? {};
  return {
    externalId: String(o.id),
    externalNumber: o.name ? String(o.name).replace(/^#/, "") : String(o.order_number ?? o.id),
    status: shopifyOrderStatus(o),
    paymentMethod: gateways[0],
    isCod,
    currency: o.currency ?? "BDT",
    subtotalMinor: money(o.current_subtotal_price_set, o.subtotal_price),
    shippingMinor: money(o.total_shipping_price_set),
    discountMinor: money(o.total_discounts_set, o.total_discounts),
    taxMinor: money(o.total_tax_set, o.total_tax),
    totalMinor: money(o.current_total_price_set, o.total_price),
    refundedMinor: refunded,
    placedAt: o.created_at ? new Date(o.created_at) : undefined,
    customer: {
      externalId: customer.id ? String(customer.id) : undefined,
      firstName: customer.first_name || o.billing_address?.first_name || undefined,
      lastName: customer.last_name || o.billing_address?.last_name || undefined,
      email: (o.email ?? customer.email)?.toLowerCase(),
      phone: o.phone ?? customer.phone ?? o.billing_address?.phone ?? undefined,
      address: o.billing_address ?? undefined,
    },
    items: (o.line_items ?? []).map((li: any) => ({
      externalProductId: li.product_id ? String(li.product_id) : undefined,
      externalVariationId: li.variant_id ? String(li.variant_id) : undefined,
      name: String(li.title ?? "Item"),
      sku: li.sku || undefined,
      quantity: Number(li.quantity ?? 1),
      priceMinor: wooMoney(li.price ?? "0"),
      totalMinor: wooMoney(li.price ?? "0") * BigInt(Number(li.quantity ?? 1)),
    })),
  };
}
