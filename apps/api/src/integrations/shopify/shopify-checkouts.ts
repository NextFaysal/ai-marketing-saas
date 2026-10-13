/**
 * EC10: Shopify abandoned-checkout payload parsing + persistence.
 *
 * The same shape serves both sources:
 *  - CHECKOUTS_CREATE / CHECKOUTS_UPDATE webhook payloads, and
 *  - rows from the REST `/checkouts.json` endpoint (which is the
 *    abandoned-checkouts list — see ShopifyClient.listCheckouts).
 * Both carry `id`, `email`, address phone fallbacks, `line_items`,
 * `total_price` (major-unit string), `currency`,
 * `abandoned_checkout_url` and `created_at`.
 */

export interface ShopifyCheckoutItem {
  name: string;
  quantity: number;
  priceMinor: number;
}

export interface ParsedShopifyCheckout {
  externalCheckoutId: string;
  email: string | null;
  phone: string | null;
  items: ShopifyCheckoutItem[];
  totalMinor: bigint;
  currency: string;
  checkoutUrl: string | null;
  abandonedAt: Date;
}

export function parseShopifyCheckout(payload: any): ParsedShopifyCheckout {
  const items: ShopifyCheckoutItem[] = (payload?.line_items ?? []).map((li: any) => ({
    name: li?.title ?? li?.name ?? "item",
    quantity: li?.quantity ?? 1,
    priceMinor: Math.round(parseFloat(String(li?.price ?? "0")) * 100),
  }));
  return {
    externalCheckoutId: String(payload?.id),
    email: payload?.email ?? null,
    phone:
      payload?.phone ??
      payload?.shipping_address?.phone ??
      payload?.billing_address?.phone ??
      null,
    items,
    totalMinor: BigInt(Math.round(parseFloat(String(payload?.total_price ?? "0")) * 100)),
    currency: payload?.currency ?? "BDT",
    checkoutUrl: payload?.abandoned_checkout_url ?? null,
    abandonedAt: payload?.created_at ? new Date(payload.created_at) : new Date(),
  };
}

export async function upsertAbandonedStoreCheckout(
  prisma: any,
  input: { organizationId: string; storeId: string; payload: any },
): Promise<"created" | "updated"> {
  const parsed = parseShopifyCheckout(input.payload);
  const table = prisma.abandonedStoreCheckout;
  const existing = await table.findFirst({
    where: { storeId: input.storeId, externalCheckoutId: parsed.externalCheckoutId },
  });
  if (existing) {
    await table.update({
      where: { id: existing.id },
      data: {
        email: parsed.email,
        phone: parsed.phone,
        items: parsed.items,
        totalMinor: parsed.totalMinor,
        currency: parsed.currency,
        checkoutUrl: parsed.checkoutUrl,
        abandonedAt: parsed.abandonedAt,
        // status is deliberately untouched: a re-observed checkout
        // must not resurrect a recovered/expired lifecycle.
      },
    });
    return "updated";
  }
  await table.create({
    data: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      externalCheckoutId: parsed.externalCheckoutId,
      email: parsed.email,
      phone: parsed.phone,
      items: parsed.items,
      totalMinor: parsed.totalMinor,
      currency: parsed.currency,
      checkoutUrl: parsed.checkoutUrl,
      status: "open",
      abandonedAt: parsed.abandonedAt,
    },
  });
  return "created";
}
