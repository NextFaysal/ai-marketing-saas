import { BadRequestException } from "@nestjs/common";

/**
 * EC24 — Product Model Expansion shared helpers.
 *
 * This module is deliberately dependency-free (no service imports)
 * so Products / Landings / Storefront / Inventory can all use the
 * SAME rules without creating a module cycle.
 *
 * PART A RULE (pre-order, implemented exactly):
 *  - A product with preorderEnabled=true may be ordered at
 *    zero/negative tracked stock.
 *  - Its OrderItem is stamped isPreorder=true (ANY order of a
 *    preorder-enabled product is a preorder line — no per-line
 *    opt-in in v1).
 *  - InventoryService.applyOrderPlaced SKIPS preorder lines
 *    entirely: no decrement, no StockMovement (stock may not
 *    exist yet).
 *  - Normal products keep the pre-EC24 behaviour byte-for-byte.
 *  - preorderLimit (when set) caps the total OPEN pre-ordered
 *    units for the product in the org: open = OrderItems with
 *    isPreorder=true whose order status is NOT IN
 *    (cancelled, refunded, failed, completed).
 */

export const PREORDER_CLOSED_STATUSES = ["cancelled", "refunded", "failed", "completed"] as const;

export interface PreorderInfo {
  enabled: true;
  releaseDate: string | null;
}

/** Public serialization: `preorder: { enabled, releaseDate } | null`. */
export function preorderInfo(product: any): PreorderInfo | null {
  if (!product?.preorderEnabled) return null;
  const d = product.preorderReleaseDate;
  return {
    enabled: true,
    releaseDate: d ? (d instanceof Date ? d.toISOString() : String(d)) : null,
  };
}

/**
 * Open pre-ordered quantity for one product in one org, computed
 * from real OrderItem + Order rows. Failure-isolated in the same
 * spirit as the rest of the checkout code: a missing table in an
 * old fake/deployment reads as 0 rather than breaking checkout —
 * the limit is only enforced when it can actually be measured.
 */
export async function openPreorderQty(prisma: any, organizationId: string, productId: string): Promise<number> {
  try {
    const itemTable = prisma?.orderItem;
    const orderTable = prisma?.order;
    if (!itemTable?.findMany || !orderTable?.findFirst) return 0;
    const items: any[] =
      (await itemTable.findMany({ where: { productId, isPreorder: true } }).catch(() => [])) ?? [];
    let open = 0;
    for (const item of items) {
      if (!item?.orderId) continue;
      const order = await orderTable
        .findFirst({ where: { id: item.orderId, organizationId } })
        .catch(() => null);
      if (!order) continue;
      if ((PREORDER_CLOSED_STATUSES as readonly string[]).includes(String(order.status))) continue;
      open += Number(item.quantity ?? 0) || 0;
    }
    return open;
  } catch {
    return 0;
  }
}

/**
 * Enforce preorderLimit for a checkout request. No-op unless the
 * product is preorder-enabled AND carries a limit. Refuses the
 * WHOLE order (the caller writes nothing) with an honest Bengali
 * message when open + requested would exceed the limit.
 */
/**
 * PART D RULE (wholesale, implemented exactly):
 *  - wholesaleTiers = [{ minQty: int >= 2, priceMinor > 0 }],
 *    strictly ascending unique minQty, max 10 tiers.
 *  - At STOREFRONT SHOP checkout only, an identified customer
 *    with isWholesale=true gets, per line, the highest tier whose
 *    minQty <= line quantity. The tier price REPLACES the regular
 *    / sale price entirely (even when the sale price is lower) —
 *    promotions/coupons then apply ON TOP of the tier price.
 *  - Guest checkouts and the single/landing paths have no
 *    identified wholesale customer, so they never see tier prices.
 */
export interface WholesaleTier {
  minQty: number;
  priceMinor: string; // BigInt-safe string in JSON storage
}

export function validateWholesaleTiers(v: unknown): WholesaleTier[] | null {
  if (v === undefined || v === null) return null;
  const fail = (why: string): never => {
    throw new BadRequestException(`পাইকারি মূল্যের স্তর সঠিক নয় — ${why}`);
  };
  if (!Array.isArray(v)) return fail("তালিকা (array) হতে হবে");
  if (v.length > 10) return fail("সর্বোচ্চ ১০টি স্তর দেওয়া যাবে");
  const out: WholesaleTier[] = [];
  let prev = 0;
  for (const raw of v as any[]) {
    if (!raw || typeof raw !== "object") return fail("প্রতিটি স্তরে minQty ও priceMinor থাকতে হবে");
    const minQty = (raw as any).minQty;
    if (!Number.isInteger(minQty) || minQty < 2) return fail("minQty কমপক্ষে ২ হতে হবে");
    if (minQty <= prev) return fail("minQty কঠোরভাবে বাড়তে হবে (ডুপ্লিকেট নয়)");
    prev = minQty;
    let price: bigint;
    try {
      price = BigInt(String((raw as any).priceMinor));
    } catch {
      return fail("priceMinor পূর্ণসংখ্যা (মাইনর একক) হতে হবে");
    }
    if (price <= 0n) return fail("priceMinor ০-এর বেশি হতে হবে");
    out.push({ minQty, priceMinor: price.toString() });
  }
  return out;
}

/** Highest tier whose minQty <= qty; null when none qualifies. */
export function selectWholesaleTier(tiers: unknown, qty: number): WholesaleTier | null {
  if (!Array.isArray(tiers)) return null;
  let best: WholesaleTier | null = null;
  for (const t of tiers as any[]) {
    const minQty = Number(t?.minQty);
    if (!Number.isInteger(minQty)) continue;
    if (minQty <= qty && (!best || minQty > best.minQty)) {
      try {
        best = { minQty, priceMinor: BigInt(String(t.priceMinor)).toString() };
      } catch { /* malformed stored tier never prices a line */ }
    }
  }
  return best;
}

/** Conditional validation for the EC24 product flags, checked
 * against the EFFECTIVE (merged) product state so an update that
 * only flips one flag still validates against stored values. */
export function assertEc24Conditionals(effective: {
  digital?: unknown; digitalFileUrl?: unknown; digitalStorageKey?: unknown;
  digitalDeliveryType?: unknown;
  subscriptionEnabled?: unknown; subscriptionIntervalDays?: unknown;
}): void {
  // Union (RB6/RM9 + AB5/AX9): a license-only product delivers
  // pool keys, not a file, so it legitimately has no file URL;
  // "file"/"both" still require one — satisfied by EITHER the
  // merchant-hosted URL or an R2-hosted file (digitalStorageKey).
  if (effective.digital && effective.digitalDeliveryType !== "license" && !String(effective.digitalFileUrl ?? "").trim() && !String(effective.digitalStorageKey ?? "").trim()) {
    throw new BadRequestException("ডিজিটাল পণ্য চালু করতে ফাইল URL আবশ্যক");
  }
  if (effective.subscriptionEnabled && !(Number(effective.subscriptionIntervalDays) >= 1)) {
    throw new BadRequestException("সাবস্ক্রিপশন চালু করতে ইন্টারভাল (দিন) কমপক্ষে ১ হতে হবে");
  }
}

export async function assertPreorderLimit(
  prisma: any,
  organizationId: string,
  product: any,
  requestedQty: number,
): Promise<void> {
  if (!product?.preorderEnabled) return;
  if (product.preorderLimit === null || product.preorderLimit === undefined) return;
  const limit = Number(product.preorderLimit);
  if (!Number.isFinite(limit)) return;
  const open = await openPreorderQty(prisma, organizationId, product.id);
  if (open + requestedQty > limit) {
    throw new BadRequestException(
      `প্রি-অর্ডারের সীমা শেষ — এই পণ্যের প্রি-অর্ডার সীমা ${limit}টি, ইতিমধ্যে ${open}টি খোলা প্রি-অর্ডার আছে`,
    );
  }
}
