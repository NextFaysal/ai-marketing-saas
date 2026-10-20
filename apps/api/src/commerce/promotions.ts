/**
 * EC16 — pure promotion helpers: config validation + the ONE
 * cart-promotion evaluator every checkout path (shop / single /
 * landing) and the staff preview call. No DB, no IO. Money is
 * BigInt minor units everywhere.
 *
 * THE STACKING RULE (documented in docs/ecommerce-b9-acceptance.md):
 *  1. Promotions evaluate FIRST, in priority order (priority DESC,
 *     then createdAt ASC), against each line's EFFECTIVE
 *     (sale-aware) unit price — the price the checkout already
 *     charges (Product.priceMinor / variant priceMinor; a
 *     product-level sale is already reflected in that price, with
 *     compareAtMinor > price marking the sale).
 *  2. Unit consumption: a unit discounted by one promotion is
 *     consumed and cannot be discounted again by a later
 *     promotion. BOGO consumes only its GET units (buy units stay
 *     eligible for later promotions). A percent promotion
 *     (tiered / flash) consumes every remaining unit of each line
 *     it discounts.
 *  3. Flash never stacks on a product-level sale: flash skips
 *     lines whose compareAtMinor > unit price (already on sale).
 *     BOGO and tiered DO apply on sale lines (on the sale price).
 *  4. The EC7 coupon validates AFTER promotions, on the
 *     post-promotion line totals (EC7's own base definition —
 *     eligible item totals — is unchanged; with no promotion
 *     applied the coupon context is byte-identical to EC7's).
 *  5. The referral discount applies LAST: percent of the
 *     post-promotion, post-coupon merchandise amount.
 * Percent math floors per line ((amount * pct) / 100), matching
 * EC7's integer discipline.
 */

export interface PromotionLine {
  productId: string | null;
  categoryId: string | null;
  quantity: number;
  /** Effective (sale-aware) unit price in minor units. */
  unitPriceMinor: bigint;
  /** > unitPriceMinor ⇒ the line is already on a product-level sale. */
  compareAtMinor?: bigint | null;
}

export interface PromotionBreakdownEntry {
  promotionId: string;
  name: string;
  type: string;
  amountMinor: bigint;
}

export interface PromotionEvaluation {
  promotionDiscountMinor: bigint;
  breakdown: PromotionBreakdownEntry[];
  /** Per-input-line totals after all promotions (same order). */
  lineTotalsMinor: bigint[];
}

export interface BogoConfig {
  buyProductId?: string | null;
  buyCategoryId?: string | null;
  buyQty: number;
  getProductId?: string | null;
  getCategoryId?: string | null;
  getQty: number;
  getDiscountPercent: number;
  /** GB7: skip unless the buyer has at least this many prior orders. */
  minPriorOrders?: number;
}

export interface TieredConfig {
  scope: "subtotal" | "category";
  categoryId?: string | null;
  tiers: Array<{ minAmountMinor?: string | null; minQty?: number | null; percentOff: number }>;
  minPriorOrders?: number;
}

export interface FlashConfig {
  percentOff: number;
  productIds?: string[];
  categoryIds?: string[];
  minPriorOrders?: number;
}

/** EC29: free-gift promotion — when the cart's pre-discount
 * product-line subtotal reaches minSubtotalMinor, ONE unit set
 * (giftQty) of giftProductId is added to the order at price 0.
 * The gift is NOT a discount: it never touches discount totals. */
export interface GiftConfig {
  minSubtotalMinor: string;
  giftProductId: string;
  giftVariantSku?: string | null;
  giftQty: number;
  minPriorOrders?: number;
}

/** GB7: the normalized promotion config returned by
 * validatePromotionConfig (any type, with the shared
 * minPriorOrders condition when configured). */
export type NormalizedPromotionConfig = BogoConfig | TieredConfig | FlashConfig | GiftConfig;

function normalizeMinPriorOrders(cfg: any): number | undefined {
  const raw = cfg?.minPriorOrders;
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) return raw;
  throw new Error("min_prior_orders");
}

function isIntIn(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

function optId(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || v.length > 64) throw new Error("invalid_id");
  return v;
}

function optIdList(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v) || v.length > 200) throw new Error("invalid_id_list");
  return v.map((x) => {
    const id = optId(x);
    if (!id) throw new Error("invalid_id_list");
    return id;
  });
}

/** Validate + normalize a promotion config. Throws Error with a
 * stable reason key; the service maps it to a Bengali 400. */
export function validatePromotionConfig(
  type: string,
  raw: any,
): BogoConfig | TieredConfig | FlashConfig | GiftConfig {
  const cfg = raw && typeof raw === "object" ? raw : {};
  const minPriorOrders = normalizeMinPriorOrders(cfg);
  const minPriorPart = minPriorOrders !== undefined ? { minPriorOrders } : {};
  if (type === "bogo") {
    const buyProductId = optId(cfg.buyProductId);
    const buyCategoryId = optId(cfg.buyCategoryId);
    const getProductId = optId(cfg.getProductId);
    const getCategoryId = optId(cfg.getCategoryId);
    if (!buyProductId && !buyCategoryId) throw new Error("bogo_buy_scope_required");
    if (!getProductId && !getCategoryId) throw new Error("bogo_get_scope_required");
    if (!isIntIn(cfg.buyQty, 1, 1000)) throw new Error("bogo_buy_qty");
    if (!isIntIn(cfg.getQty, 1, 1000)) throw new Error("bogo_get_qty");
    if (!isIntIn(cfg.getDiscountPercent, 1, 100)) throw new Error("bogo_percent");
    return {
      buyProductId,
      buyCategoryId,
      buyQty: cfg.buyQty,
      getProductId,
      getCategoryId,
      getQty: cfg.getQty,
      getDiscountPercent: cfg.getDiscountPercent,
      ...minPriorPart,
    };
  }
  if (type === "tiered") {
    const scope = cfg.scope === "category" ? "category" : cfg.scope === "subtotal" ? "subtotal" : null;
    if (!scope) throw new Error("tiered_scope");
    const categoryId = optId(cfg.categoryId);
    if (scope === "category" && !categoryId) throw new Error("tiered_category_required");
    if (!Array.isArray(cfg.tiers) || cfg.tiers.length === 0 || cfg.tiers.length > 10) {
      throw new Error("tiered_tiers");
    }
    const tiers = cfg.tiers.map((t: any) => {
      const hasAmount = t?.minAmountMinor !== null && t?.minAmountMinor !== undefined && t?.minAmountMinor !== "";
      const hasQty = t?.minQty !== null && t?.minQty !== undefined;
      if (hasAmount === hasQty) throw new Error("tiered_tier_threshold");
      if (!isIntIn(t?.percentOff, 1, 90)) throw new Error("tiered_percent");
      let minAmountMinor: string | null = null;
      let minQty: number | null = null;
      if (hasAmount) {
        const s = String(t.minAmountMinor).trim();
        if (!/^\d+$/.test(s)) throw new Error("tiered_tier_amount");
        minAmountMinor = s;
      } else {
        if (!isIntIn(t.minQty, 1, 100000)) throw new Error("tiered_tier_qty");
        minQty = t.minQty;
      }
      return { minAmountMinor, minQty, percentOff: t.percentOff };
    });
    return { scope, categoryId, tiers, ...minPriorPart };
  }
  if (type === "flash") {
    if (!isIntIn(cfg.percentOff, 1, 90)) throw new Error("flash_percent");
    return {
      percentOff: cfg.percentOff,
      productIds: optIdList(cfg.productIds),
      categoryIds: optIdList(cfg.categoryIds),
      ...minPriorPart,
    };
  }
  if (type === "gift") {
    const rawThreshold = cfg.minSubtotalMinor;
    if (rawThreshold === null || rawThreshold === undefined || rawThreshold === "") {
      throw new Error("gift_threshold");
    }
    if (typeof rawThreshold !== "string" && typeof rawThreshold !== "number") {
      throw new Error("gift_threshold");
    }
    const minSubtotalMinor = String(rawThreshold).trim();
    if (!/^\d+$/.test(minSubtotalMinor)) throw new Error("gift_threshold");
    const giftProductId = optId(cfg.giftProductId);
    if (!giftProductId) throw new Error("gift_product_required");
    let giftVariantSku: string | null = null;
    if (cfg.giftVariantSku !== null && cfg.giftVariantSku !== undefined && cfg.giftVariantSku !== "") {
      if (typeof cfg.giftVariantSku !== "string" || cfg.giftVariantSku.length > 100) {
        throw new Error("gift_variant_sku");
      }
      giftVariantSku = cfg.giftVariantSku;
    }
    const giftQty = cfg.giftQty === null || cfg.giftQty === undefined ? 1 : cfg.giftQty;
    if (!isIntIn(giftQty, 1, 3)) throw new Error("gift_qty");
    return { minSubtotalMinor, giftProductId, giftVariantSku, giftQty, ...minPriorPart };
  }
  throw new Error("unknown_type");
}

/** ML10: reason key → catalog code (bn text = PROMOTION_CONFIG_MESSAGES). */
export const PROMOTION_CONFIG_CODES: Record<string, string> = {
  invalid_id: "commerce.promotionConfigInvalidId",
  invalid_id_list: "commerce.promotionConfigInvalidIdList",
  bogo_buy_scope_required: "commerce.promotionConfigBogoBuyScope",
  bogo_get_scope_required: "commerce.promotionConfigBogoGetScope",
  bogo_buy_qty: "commerce.promotionConfigBogoBuyQty",
  bogo_get_qty: "commerce.promotionConfigBogoGetQty",
  bogo_percent: "commerce.promotionConfigBogoPercent",
  tiered_scope: "commerce.promotionConfigTieredScope",
  tiered_category_required: "commerce.promotionConfigTieredCategory",
  tiered_tiers: "commerce.promotionConfigTieredTiers",
  tiered_tier_threshold: "commerce.promotionConfigTieredThreshold",
  tiered_percent: "commerce.promotionConfigTieredPercent",
  tiered_tier_amount: "commerce.promotionConfigTieredAmount",
  tiered_tier_qty: "commerce.promotionConfigTieredQty",
  flash_percent: "commerce.promotionConfigFlashPercent",
  gift_threshold: "commerce.promotionConfigGiftThreshold",
  gift_product_required: "commerce.promotionConfigGiftProduct",
  gift_variant_sku: "commerce.promotionConfigGiftVariantSku",
  gift_qty: "commerce.promotionConfigGiftQty",
  min_prior_orders: "commerce.promotionConfigMinPriorOrders",
  unknown_type: "commerce.promotionConfigUnknownType",
};

export const PROMOTION_CONFIG_MESSAGES: Record<string, string> = {
  invalid_id: "কনফিগে দেওয়া আইডিটি সঠিক নয়",
  invalid_id_list: "কনফিগের আইডি তালিকাটি সঠিক নয়",
  bogo_buy_scope_required: "BOGO-তে কেনার পণ্য বা ক্যাটাগরি দিতে হবে",
  bogo_get_scope_required: "BOGO-তে পাওয়ার পণ্য বা ক্যাটাগরি দিতে হবে",
  bogo_buy_qty: "BOGO কেনার পরিমাণ ১–১০০০ হতে হবে",
  bogo_get_qty: "BOGO পাওয়ার পরিমাণ ১–১০০০ হতে হবে",
  bogo_percent: "BOGO ছাড়ের শতাংশ ১–১০০ হতে হবে",
  tiered_scope: "Tiered scope হতে হবে subtotal অথবা category",
  tiered_category_required: "Category scope-এর জন্য ক্যাটাগরি দিতে হবে",
  tiered_tiers: "কমপক্ষে ১টি, সর্বোচ্চ ১০টি tier দিতে হবে",
  tiered_tier_threshold: "প্রতিটি tier-এ minAmountMinor অথবা minQty — ঠিক একটি দিতে হবে",
  tiered_percent: "Tier-এর শতাংশ ১–৯০ হতে হবে",
  tiered_tier_amount: "Tier-এর ন্যূনতম পরিমাণ সঠিক সংখ্যা হতে হবে",
  tiered_tier_qty: "Tier-এর ন্যূনতম পরিমাণ (qty) ১–১০০০০০ হতে হবে",
  flash_percent: "Flash ছাড়ের শতাংশ ১–৯০ হতে হবে",
  gift_threshold: "উপহারের জন্য ন্যূনতম অর্ডার পরিমাণ সঠিক সংখ্যা হতে হবে",
  gift_product_required: "উপহারের পণ্য দিতে হবে",
  gift_variant_sku: "উপহারের ভ্যারিয়েন্ট SKU সঠিক নয়",
  gift_qty: "উপহারের পরিমাণ ১–৩ হতে হবে",
  min_prior_orders: "সর্বনিম্ন আগের অর্ডার সংখ্যা ০ বা তার বেশি পূর্ণসংখ্যা হতে হবে",
  unknown_type: "অজানা প্রমোশন ধরন",
};

export function inWindow(p: any, now: Date): boolean {
  if (p.startsAt && now < new Date(p.startsAt)) return false;
  if (p.endsAt && now > new Date(p.endsAt)) return false;
  return true;
}

function matchesScope(
  line: PromotionLine,
  productId: string | null,
  categoryId: string | null,
): boolean {
  if (productId) return line.productId === productId;
  if (categoryId) return line.categoryId === categoryId;
  return false;
}

function isOnProductSale(line: PromotionLine): boolean {
  return line.compareAtMinor != null && line.compareAtMinor > line.unitPriceMinor;
}

/**
 * Evaluate promotions over cart product lines. `promotions` are
 * raw rows (already org-scoped + active-filtered by the caller);
 * windowing and config sanity are re-checked here so a malformed
 * stored config can never crash or fabricate a discount — it is
 * skipped.
 */
export function evaluatePromotions(
  promotions: any[],
  lines: PromotionLine[],
  now: Date | { priorOrderCount?: number | null } = new Date(),
  ctx?: { priorOrderCount?: number | null },
): PromotionEvaluation {
  // GB7: ctx may be passed as the 4th argument (canonical, with
  // `now` as the 3rd) or — for convenience — as the 3rd argument
  // in place of `now`. Existing 2/3-arg callers keep working.
  let effectiveCtx = ctx;
  let effectiveNow: Date;
  if (now instanceof Date) {
    effectiveNow = now;
  } else {
    effectiveCtx = effectiveCtx ?? (now as { priorOrderCount?: number | null });
    effectiveNow = new Date();
  }
  now = effectiveNow;
  const lineTotalsMinor = lines.map((l) => l.unitPriceMinor * BigInt(Math.max(0, l.quantity)));
  const remainingUnits = lines.map((l) => Math.max(0, l.quantity));
  const breakdown: PromotionBreakdownEntry[] = [];
  let promotionDiscountMinor = 0n;

  const ordered = [...(promotions ?? [])]
    .filter((p) => p && p.active !== false && inWindow(p, now))
    .sort((a, b) => {
      const byPriority = Number(b.priority ?? 0) - Number(a.priority ?? 0);
      if (byPriority !== 0) return byPriority;
      const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return at - bt;
    });

  const addEntry = (p: any, amount: bigint) => {
    if (amount <= 0n) return;
    promotionDiscountMinor += amount;
    breakdown.push({
      promotionId: String(p.id),
      name: String(p.name ?? ""),
      type: String(p.type),
      amountMinor: amount,
    });
  };

  for (const p of ordered) {
    let cfg: BogoConfig | TieredConfig | FlashConfig | GiftConfig;
    try {
      cfg = validatePromotionConfig(String(p.type), p.config);
    } catch {
      continue; // malformed stored config ⇒ no discount, never a guess
    }
    // GB7: a minPriorOrders promotion is skipped when the buyer's
    // prior-order count is unknown (null) or below the minimum.
    const minPrior = (cfg as any).minPriorOrders as number | undefined;
    if (
      minPrior != null &&
      (effectiveCtx?.priorOrderCount == null || effectiveCtx.priorOrderCount < minPrior)
    ) {
      continue;
    }
    // EC29: "gift" promotions validate above and intentionally have
    // NO branch here — a gift is not a discount and must never
    // change promotionDiscountMinor / line totals. Gift selection
    // lives in PromotionsService.evaluateCheckout.

    if (p.type === "bogo") {
      const c = cfg as BogoConfig;
      // Pools over the FULL cart quantities: a unit can serve as
      // a buy unit OR a get unit, never both. Group feasibility
      // (the union constraint) stops scope overlap from
      // double-counting: buy 2 get 1 with only 2 units in the
      // cart forms no complete group.
      let buyPool = 0;
      let getPool = 0;
      let overlapPool = 0;
      lines.forEach((l) => {
        const q = Math.max(0, l.quantity);
        const isBuy = matchesScope(l, c.buyProductId ?? null, c.buyCategoryId ?? null);
        const isGet = matchesScope(l, c.getProductId ?? null, c.getCategoryId ?? null);
        if (isBuy) buyPool += q;
        if (isGet) getPool += q;
        if (isBuy && isGet) overlapPool += q;
      });
      let groups = Math.floor(buyPool / c.buyQty);
      while (
        groups > 0 &&
        buyPool + getPool - overlapPool < groups * (c.buyQty + c.getQty)
      ) {
        groups--;
      }
      if (groups <= 0) continue;
      // Reserve the buy requirement (cart order) so reserved
      // units cannot also be discounted as get units. Only
      // unconsumed units can be reserved or discounted.
      const reserved = lines.map(() => 0);
      let toReserve = groups * c.buyQty;
      lines.forEach((l, i) => {
        if (toReserve <= 0) return;
        if (!matchesScope(l, c.buyProductId ?? null, c.buyCategoryId ?? null)) return;
        const take = Math.min(remainingUnits[i], toReserve);
        reserved[i] = take;
        toReserve -= take;
      });
      let getUnitsLeft = groups * c.getQty;
      // Cheapest get-scope units first (by unit price, stable by line order).
      const candidates = lines
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => matchesScope(l, c.getProductId ?? null, c.getCategoryId ?? null))
        .sort((a, b) => {
          if (a.l.unitPriceMinor !== b.l.unitPriceMinor) {
            return a.l.unitPriceMinor < b.l.unitPriceMinor ? -1 : 1;
          }
          return a.i - b.i;
        });
      let amount = 0n;
      for (const { l, i } of candidates) {
        if (getUnitsLeft <= 0) break;
        const take = Math.min(remainingUnits[i] - reserved[i], getUnitsLeft);
        if (take <= 0) continue;
        const segmentTotal = l.unitPriceMinor * BigInt(take);
        const d = (segmentTotal * BigInt(c.getDiscountPercent)) / 100n;
        amount += d;
        lineTotalsMinor[i] -= d;
        remainingUnits[i] -= take;
        getUnitsLeft -= take;
      }
      addEntry(p, amount);
      continue;
    }

    if (p.type === "tiered") {
      const c = cfg as TieredConfig;
      const inScope = (l: PromotionLine) =>
        c.scope === "subtotal" ? true : l.categoryId === c.categoryId;
      let qualifyAmount = 0n;
      let qualifyQty = 0;
      lines.forEach((l) => {
        if (!inScope(l)) return;
        qualifyAmount += l.unitPriceMinor * BigInt(Math.max(0, l.quantity));
        qualifyQty += Math.max(0, l.quantity);
      });
      let best: { percentOff: number; threshold: bigint } | null = null;
      for (const t of c.tiers) {
        const qualifies =
          t.minAmountMinor != null ? qualifyAmount >= BigInt(t.minAmountMinor) : qualifyQty >= (t.minQty ?? 0);
        if (!qualifies) continue;
        const threshold = t.minAmountMinor != null ? BigInt(t.minAmountMinor) : BigInt(t.minQty ?? 0);
        if (
          !best ||
          t.percentOff > best.percentOff ||
          (t.percentOff === best.percentOff && threshold > best.threshold)
        ) {
          best = { percentOff: t.percentOff, threshold };
        }
      }
      if (!best) continue;
      let amount = 0n;
      lines.forEach((l, i) => {
        if (!inScope(l) || remainingUnits[i] <= 0) return;
        const remainingAmount = l.unitPriceMinor * BigInt(remainingUnits[i]);
        const d = (remainingAmount * BigInt(best!.percentOff)) / 100n;
        if (d <= 0n) return;
        amount += d;
        lineTotalsMinor[i] -= d;
        remainingUnits[i] = 0; // a percent discount consumes the line's remaining units
      });
      addEntry(p, amount);
      continue;
    }

    if (p.type === "flash") {
      const c = cfg as FlashConfig;
      const productIds = c.productIds ?? [];
      const categoryIds = c.categoryIds ?? [];
      const inScope = (l: PromotionLine) =>
        (productIds.length === 0 && categoryIds.length === 0) ||
        (l.productId != null && productIds.includes(l.productId)) ||
        (l.categoryId != null && categoryIds.includes(l.categoryId));
      let amount = 0n;
      lines.forEach((l, i) => {
        if (!inScope(l) || remainingUnits[i] <= 0) return;
        if (isOnProductSale(l)) return; // flash never stacks on a product-level sale
        const remainingAmount = l.unitPriceMinor * BigInt(remainingUnits[i]);
        const d = (remainingAmount * BigInt(c.percentOff)) / 100n;
        if (d <= 0n) return;
        amount += d;
        lineTotalsMinor[i] -= d;
        remainingUnits[i] = 0;
      });
      addEntry(p, amount);
      continue;
    }
  }

  return { promotionDiscountMinor, breakdown, lineTotalsMinor };
}

/** Loose BD phone comparison key: digits only, last 11 when long
 * enough (mirrors the EC18 tracking lookup's loose normalize). */
export function phoneKeyLoose(phone: string | null | undefined): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length > 11) return digits.slice(-11);
  return digits;
}

export function normalizeReferralCode(code: string | null | undefined): string {
  return String(code ?? "").trim().toUpperCase();
}
