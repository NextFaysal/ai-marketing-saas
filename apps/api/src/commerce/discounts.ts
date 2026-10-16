/**
 * EC7 — pure discount helpers: validation math + platform parsers.
 * No DB, no IO. Money is BigInt minor units everywhere.
 */

export type DiscountValidation = {
  valid: boolean;
  reason?: string;
  discountMinor: bigint;
  freeShipping: boolean;
  discount?: any;
  // GB7 (GC17): the discount's customer-condition fields, carried
  // on the input discount shape validateDiscount reads (kept here
  // as optional so existing callers/shapes are unchanged).
  firstOrderOnly?: boolean;
  repeatCustomerOnly?: boolean;
  perCustomerLimit?: number | null;
  maxOrderMinor?: bigint | null;
  excludedProductIds?: string[] | null;
  excludedCategoryIds?: string[] | null;
};

export interface ValidationCtx {
  subtotalMinor: bigint;
  items: Array<{ productId?: string | null; categoryId?: string | null; totalMinor: bigint }>;
  now?: Date;
  /** GB7: buyer's prior (counting) order count; null = unverifiable. */
  priorOrderCount?: number | null;
  /** GB7: this customer's prior uses of THIS coupon; null = unverifiable. */
  customerUsageCount?: number | null;
}

export function normalizeDiscountCode(code: string): string {
  return String(code ?? "").trim().toUpperCase();
}

export const DISCOUNT_REASON_MESSAGES: Record<string, string> = {
  not_found: "এই কোডে কোনো কুপন পাওয়া যায়নি",
  inactive: "এই কুপনটি বর্তমানে বন্ধ আছে",
  not_started: "এই কুপনের অফার এখনো শুরু হয়নি",
  expired: "এই কুপনের মেয়াদ শেষ হয়ে গেছে",
  usage_limit_reached: "এই কুপনের ব্যবহারের সীমা শেষ হয়ে গেছে",
  below_min_order: "এই কুপনের জন্য ন্যূনতম অর্ডার পরিমাণ পূরণ হয়নি",
  no_eligible_items: "এই কুপনটি আপনার কার্টের কোনো পণ্যের জন্য প্রযোজ্য নয়",
  invalid_kind: "এই কুপনের ধরনটি সঠিক নয়",
  not_first_order: "এই কুপনটি শুধু প্রথম অর্ডারের জন্য প্রযোজ্য",
  not_repeat_customer: "এই কুপনটি শুধু আগের অর্ডার আছে এমন গ্রাহকদের জন্য",
  customer_limit_reached: "আপনি এই কুপনটির প্রতি-গ্রাহক সর্বোচ্চ ব্যবহার সীমায় পৌঁছে গেছেন",
  above_max_order: "এই কুপনটি এত বড় অর্ডারে প্রযোজ্য নয়",
  excluded_items: "আপনার কার্টের কিছু পণ্যে এই কুপনটি প্রযোজ্য নয়",
};

function scopeIdsOf(discount: any): string[] {
  const raw = discount?.scopeIds;
  if (!Array.isArray(raw)) return [];
  return raw.map((x: any) => String(x));
}

function idListOf(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x: any) => String(x));
}

export function validateDiscount(
  discount: any,
  ctx: ValidationCtx,
): DiscountValidation {
  const fail = (reason: string): DiscountValidation => ({
    valid: false,
    reason,
    discountMinor: 0n,
    freeShipping: false,
  });
  const now = ctx.now ?? new Date();
  if (!discount || !discount.active) return fail("inactive");
  if (discount.startsAt && now < new Date(discount.startsAt)) return fail("not_started");
  if (discount.endsAt && now > new Date(discount.endsAt)) return fail("expired");
  if (discount.usageLimit != null && (discount.usedCount ?? 0) >= discount.usageLimit)
    return fail("usage_limit_reached");
  if (discount.minOrderMinor != null && ctx.subtotalMinor < BigInt(discount.minOrderMinor))
    return fail("below_min_order");
  // GB7: maximum order value (mirror of minOrderMinor, reversed).
  const maxOrderMinorRaw = discount.maxOrderMinor ?? null;
  if (maxOrderMinorRaw != null && ctx.subtotalMinor > BigInt(maxOrderMinorRaw))
    return fail("above_max_order");

  const scopeType = discount.scopeType ?? "all";
  const scopeIds = scopeIdsOf(discount);
  let eligible = ctx.items ?? [];
  if (scopeType === "products") {
    eligible = eligible.filter((i) => i.productId != null && scopeIds.includes(String(i.productId)));
  } else if (scopeType === "categories") {
    eligible = eligible.filter((i) => i.categoryId != null && scopeIds.includes(String(i.categoryId)));
  }
  const base = eligible.reduce((sum, i) => sum + BigInt(i.totalMinor ?? 0), 0n);
  // GB7: exclusions — ANY cart item whose product/category is
  // excluded refuses the coupon outright (no partial application).
  const excludedProductIds = idListOf(discount.excludedProductIds);
  const excludedCategoryIds = idListOf(discount.excludedCategoryIds);
  if (excludedProductIds.length > 0 || excludedCategoryIds.length > 0) {
    const hasExcluded = (ctx.items ?? []).some(
      (i) =>
        (i.productId != null && excludedProductIds.includes(String(i.productId))) ||
        (i.categoryId != null && excludedCategoryIds.includes(String(i.categoryId))),
    );
    if (hasExcluded) return fail("excluded_items");
  }
  // GB7: customer conditions. A null count means the buyer's
  // identity/history is unverifiable ⇒ refuse (conservative).
  if (discount.firstOrderOnly) {
    if (ctx.priorOrderCount == null || ctx.priorOrderCount > 0) return fail("not_first_order");
  }
  if (discount.repeatCustomerOnly) {
    if (ctx.priorOrderCount == null || ctx.priorOrderCount < 1) return fail("not_repeat_customer");
  }
  if (discount.perCustomerLimit != null) {
    if (ctx.customerUsageCount == null || ctx.customerUsageCount >= Number(discount.perCustomerLimit))
      return fail("customer_limit_reached");
  }
  if (scopeType !== "all" && eligible.length === 0) return fail("no_eligible_items");
  if (base <= 0n) return fail("no_eligible_items");

  const kind = discount.kind;
  if (kind === "percent") {
    const value = Number(discount.value);
    if (!Number.isInteger(value) || value < 1 || value > 90) return fail("invalid_kind");
    return { valid: true, discountMinor: (base * BigInt(value)) / 100n, freeShipping: false, discount };
  }
  if (kind === "fixed") {
    const value = Number(discount.value);
    if (!Number.isInteger(value) || value < 1) return fail("invalid_kind");
    const amt = BigInt(value);
    return { valid: true, discountMinor: amt < base ? amt : base, freeShipping: false, discount };
  }
  if (kind === "free_shipping") {
    return { valid: true, discountMinor: 0n, freeShipping: true, discount };
  }
  return fail("invalid_kind");
}

export interface ParsedPlatformDiscount {
  code: string;
  kind: string;
  value: number;
  minOrderMinor: bigint | null;
  endsAt: Date | null;
  usageLimit: number | null;
  active: boolean;
  externalId: string;
}

function parseDateOrNull(v: any): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
function parseIntOrNull(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}
function majorToMinor(v: any): bigint | null {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(String(v));
  if (!Number.isFinite(n) || n <= 0) return null;
  return BigInt(Math.round(n * 100));
}

export function parseWooCoupon(raw: any): ParsedPlatformDiscount {
  const amount = parseFloat(String(raw?.amount ?? "0"));
  const amountFinite = Number.isFinite(amount) ? amount : 0;
  let kind: string;
  let value: number;
  if (raw?.free_shipping === true) {
    kind = "free_shipping";
    value = 0;
  } else if (raw?.discount_type === "percent") {
    kind = "percent";
    value = Math.round(amountFinite);
  } else {
    // fixed_cart / fixed_product (and any other type) → fixed
    kind = "fixed";
    value = Math.round(amountFinite * 100);
  }
  return {
    code: normalizeDiscountCode(String(raw?.code ?? "")),
    kind,
    value,
    minOrderMinor: majorToMinor(raw?.minimum_amount),
    endsAt: parseDateOrNull(raw?.date_expires),
    usageLimit: parseIntOrNull(raw?.usage_limit),
    active: raw?.status === undefined || raw?.status === null ? true : raw.status === "publish",
    externalId: raw?.id === undefined || raw?.id === null ? "" : String(raw.id),
  };
}

export function parseShopifyDiscountNode(node: any): ParsedPlatformDiscount | null {
  const discount = node?.discount;
  if (!discount || discount.__typename !== "DiscountCodeBasic") return null;
  const code = discount.codes?.edges?.[0]?.node?.code;
  if (!code) return null;
  const valueNode = discount.customerGets?.value;
  let kind: string;
  let value: number;
  if (valueNode?.__typename === "DiscountPercentage") {
    const pct = Number(valueNode.percentage);
    if (!Number.isFinite(pct)) return null;
    kind = "percent";
    value = Math.round(pct * 100);
  } else if (valueNode?.__typename === "DiscountAmount") {
    const amt = parseFloat(String(valueNode.amount?.amount ?? ""));
    if (!Number.isFinite(amt)) return null;
    kind = "fixed";
    value = Math.round(amt * 100);
  } else {
    return null;
  }
  const subtotalRaw = discount.minimumRequirement?.subtotal?.greaterThanOrEqualToSubtotal;
  return {
    code: normalizeDiscountCode(String(code)),
    kind,
    value,
    minOrderMinor: majorToMinor(subtotalRaw),
    endsAt: parseDateOrNull(discount.endsAt),
    usageLimit: parseIntOrNull(discount.usageLimit),
    active: discount.status === undefined || discount.status === null ? true : discount.status === "ACTIVE",
    externalId: node?.id === undefined || node?.id === null ? "" : String(node.id),
  };
}
