import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { DiscountsService } from "./discounts.service";
import { DISCOUNT_REASON_MESSAGES } from "./discounts";
import {
  evaluatePromotions,
  inWindow,
  normalizeReferralCode,
  phoneKeyLoose,
  validatePromotionConfig,
  PROMOTION_CONFIG_MESSAGES,
  type GiftConfig,
  type PromotionLine,
} from "./promotions";
import type { PromotionDto, PromotionPreviewDto } from "./commerce.dto";
import { computeTax, serializeTaxBreakdown, type TaxBreakdownEntry } from "./tax";

export interface CheckoutEvaluation {
  /** Merchandise subtotal (product lines + bump), pre-discount. */
  subtotalMinor: bigint;
  promotionDiscountMinor: bigint;
  promotionsApplied: Array<{ promotionId: string; name: string; type: string; amountMinor: bigint }>;
  couponDiscountMinor: bigint;
  couponFreeShipping: boolean;
  appliedDiscountId: string | null;
  appliedCouponCode: string | null;
  referral: { code: string; referrerCustomerId: string; discountMinor: bigint } | null;
  /** The code to stamp on the order: a presented code that
   * resolved to a real referrer customer in this org (stamped
   * even when it granted no discount — first-use / self /
   * below-minimum — so the record is truthful). */
  referralCodeToRecord: string | null;
  referralDiscountMinor: bigint;
  /** promotion + coupon + referral — what lands in Order.discountMinor. */
  totalDiscountMinor: bigint;
  /** EC23: VAT computed LAST (after promotions/coupon/referral) on
   * the post-discount merchandise bases. taxMinor is the VAT amount
   * (contained portion when prices include VAT); taxAddedMinor is
   * what the order total grows by (0 inclusive, taxMinor exclusive).
   * All zero / [] when the org has no tax configuration — the
   * pre-EC23 behaviour, byte-identical. */
  taxMinor: bigint;
  taxAddedMinor: bigint;
  taxBreakdown: TaxBreakdownEntry[];
  /** EC29: the ONE qualifying free-gift promotion for this cart,
   * or null. A gift is not a discount — it never enters
   * totalDiscountMinor; checkout paths place it as a price-0
   * order line via giftPlacement(). */
  gift: {
    promotionId: string;
    name: string;
    productId: string;
    giftVariantSku: string | null;
    giftQty: number;
  } | null;
  /** EC29: set by the checkout path AFTER it attempts placement:
   * "applied" (gift line appended) or "skipped" (e.g. out of
   * stock). Unset on preview/landing evaluations — stampOrder
   * only stamps gift fields when this is set. */
  giftOutcome?: "applied" | "skipped" | null;
}

const PROMOTION_TYPES = ["bogo", "tiered", "flash", "gift"] as const;
const NON_COUNTING_ORDER_STATUSES = ["cancelled", "failed", "refunded"];
const REFERRAL_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function toDateOrNull(v?: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

@Injectable()
export class PromotionsService {
  private readonly logger = new Logger(PromotionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly discounts: DiscountsService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private table(): any {
    return (this.prisma as any).promotion;
  }

  private serialize(p: any): any {
    if (!p) return p;
    return {
      ...p,
      startsAt: p.startsAt ? new Date(p.startsAt).toISOString() : null,
      endsAt: p.endsAt ? new Date(p.endsAt).toISOString() : null,
    };
  }

  private async loadOr404(orgId: string, id: string): Promise<any> {
    const row = await this.table().findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException("Promotion not found in this organization");
    return row;
  }

  /** Validate config + window + referenced ids. Returns the
   * normalized config to store. Throws Bengali BadRequest. */
  private async validateAndNormalize(
    orgId: string,
    type: string,
    config: any,
    startsAt: Date | null,
    endsAt: Date | null,
  ): Promise<any> {
    if (!(PROMOTION_TYPES as readonly string[]).includes(type)) {
      throw new BadRequestException("প্রমোশনের ধরন সঠিক নয় (bogo | tiered | flash | gift)");
    }
    let normalized: any;
    try {
      normalized = validatePromotionConfig(type, config);
    } catch (e) {
      const key = e instanceof Error ? e.message : "unknown_type";
      throw new BadRequestException(PROMOTION_CONFIG_MESSAGES[key] ?? "প্রমোশন কনফিগ সঠিক নয়");
    }
    if (type === "flash" && (!startsAt || !endsAt)) {
      throw new BadRequestException("Flash প্রমোশনে শুরু ও শেষের সময় দুটোই আবশ্যক");
    }
    if (startsAt && endsAt && endsAt <= startsAt) {
      throw new BadRequestException("শেষের সময় শুরুর সময়ের পরে হতে হবে");
    }
    const productIds = new Set<string>();
    const categoryIds = new Set<string>();
    if (type === "bogo") {
      if (normalized.buyProductId) productIds.add(normalized.buyProductId);
      if (normalized.getProductId) productIds.add(normalized.getProductId);
      if (normalized.buyCategoryId) categoryIds.add(normalized.buyCategoryId);
      if (normalized.getCategoryId) categoryIds.add(normalized.getCategoryId);
    } else if (type === "tiered") {
      if (normalized.categoryId) categoryIds.add(normalized.categoryId);
    } else if (type === "flash") {
      (normalized.productIds ?? []).forEach((x: string) => productIds.add(x));
      (normalized.categoryIds ?? []).forEach((x: string) => categoryIds.add(x));
    } else if (type === "gift") {
      if (normalized.giftProductId) productIds.add(normalized.giftProductId);
    }
    for (const pid of productIds) {
      const p = await (this.prisma as any).product.findFirst({
        where: { id: pid, organizationId: orgId },
      });
      if (!p) throw new BadRequestException(`পণ্য পাওয়া যায়নি (এই সংস্থার নয়): ${pid}`);
    }
    for (const cid of categoryIds) {
      const c = await (this.prisma as any).category.findFirst({
        where: { id: cid, organizationId: orgId },
      });
      if (!c) throw new BadRequestException(`ক্যাটাগরি পাওয়া যায়নি (এই সংস্থার নয়): ${cid}`);
    }
    if (type === "gift" && normalized.giftVariantSku) {
      const variantTable = (this.prisma as any).productVariant;
      const variant = variantTable?.findFirst
        ? await variantTable
            .findFirst({
              where: { productId: normalized.giftProductId, sku: normalized.giftVariantSku },
            })
            .catch(() => null)
        : null;
      if (!variant) {
        throw new BadRequestException("উপহারের ভ্যারিয়েন্ট SKU পাওয়া যায়নি");
      }
    }
    return normalized;
  }

  async list(orgId: string) {
    const rows = (await this.table().findMany({
      where: { organizationId: orgId },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    })) ?? [];
    return { items: rows.map((r: any) => this.serialize(r)) };
  }

  async getOne(orgId: string, id: string) {
    return this.serialize(await this.loadOr404(orgId, id));
  }

  async create(orgId: string, actorId: string, dto: PromotionDto) {
    const name = String(dto.name ?? "").trim();
    if (!name) throw new BadRequestException("প্রমোশনের নাম আবশ্যক");
    const startsAt = toDateOrNull(dto.startsAt);
    const endsAt = toDateOrNull(dto.endsAt);
    const config = await this.validateAndNormalize(orgId, String(dto.type ?? ""), dto.config, startsAt, endsAt);
    const row = await this.table().create({
      data: {
        organizationId: orgId,
        name,
        type: String(dto.type),
        config,
        startsAt,
        endsAt,
        active: dto.active ?? true,
        priority: dto.priority ?? 0,
        createdBy: actorId,
      },
    });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "promotion.created",
      entityType: "Promotion", entityId: row.id, metadata: { type: row.type, name },
    });
    return { promotion: this.serialize(row) };
  }

  async update(orgId: string, actorId: string, id: string, dto: PromotionDto) {
    const existing = await this.loadOr404(orgId, id);
    const type = dto.type !== undefined ? String(dto.type) : String(existing.type);
    const startsAt = dto.startsAt !== undefined ? toDateOrNull(dto.startsAt) : (existing.startsAt ? new Date(existing.startsAt) : null);
    const endsAt = dto.endsAt !== undefined ? toDateOrNull(dto.endsAt) : (existing.endsAt ? new Date(existing.endsAt) : null);
    const data: Record<string, any> = {};
    if (dto.name !== undefined) {
      const name = String(dto.name ?? "").trim();
      if (!name) throw new BadRequestException("প্রমোশনের নাম আবশ্যক");
      data.name = name;
    }
    if (dto.type !== undefined || dto.config !== undefined || dto.startsAt !== undefined || dto.endsAt !== undefined) {
      data.config = await this.validateAndNormalize(
        orgId, type, dto.config !== undefined ? dto.config : existing.config, startsAt, endsAt,
      );
      data.type = type;
      data.startsAt = startsAt;
      data.endsAt = endsAt;
    }
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.priority !== undefined) data.priority = dto.priority;
    const updated = await this.table().update({ where: { id }, data });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "promotion.updated",
      entityType: "Promotion", entityId: id,
    });
    return { promotion: this.serialize(updated) };
  }

  async setActive(orgId: string, actorId: string, id: string, active: boolean) {
    await this.loadOr404(orgId, id);
    const updated = await this.table().update({ where: { id }, data: { active } });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "promotion.toggled",
      entityType: "Promotion", entityId: id, metadata: { active },
    });
    return { promotion: this.serialize(updated) };
  }

  async remove(orgId: string, actorId: string, id: string) {
    await this.loadOr404(orgId, id);
    await this.table().delete({ where: { id } });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "promotion.deleted",
      entityType: "Promotion", entityId: id,
    });
    return { deleted: true };
  }

  // ---------- checkout evaluation (the ONE pricing path) ----------

  /**
   * Evaluate promotions → EC7 coupon → referral for a cart.
   * `lines` are the PRODUCT lines only (bumps are never
   * promotion/coupon eligible, exactly as EC7 paths behave today);
   * `bumpMinor` joins the subtotal for min-order / referral
   * thresholds only. An invalid coupon throws the same Bengali
   * BadRequest the checkout paths throw today; referral problems
   * never throw (silently no discount).
   */
  async evaluateCheckout(
    orgId: string,
    input: {
      lines: PromotionLine[];
      bumpMinor?: bigint;
      couponCode?: string | null;
      referralCode?: string | null;
      buyerPhone?: string | null;
      now?: Date;
    },
  ): Promise<CheckoutEvaluation> {
    const now = input.now ?? new Date();
    const bumpMinor = input.bumpMinor ?? 0n;
    const itemsSubtotal = input.lines.reduce(
      (s, l) => s + l.unitPriceMinor * BigInt(Math.max(0, l.quantity)),
      0n,
    );
    const subtotalMinor = itemsSubtotal + bumpMinor;

    // 1) Promotions.
    let promotionsApplied: CheckoutEvaluation["promotionsApplied"] = [];
    let promotionDiscountMinor = 0n;
    let discountedLineTotals = input.lines.map(
      (l) => l.unitPriceMinor * BigInt(Math.max(0, l.quantity)),
    );
    const activePromotions =
      (await this.table().findMany({
        where: { organizationId: orgId, active: true },
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      }).catch(() => [])) ?? [];
    if (activePromotions.length > 0) {
      const ev = evaluatePromotions(activePromotions, input.lines, now);
      promotionDiscountMinor = ev.promotionDiscountMinor;
      promotionsApplied = ev.breakdown;
      discountedLineTotals = ev.lineTotalsMinor;
    }

    // 1b) EC29 gift candidate — computed AFTER promotions, from
    // the same already-loaded activePromotions (priority desc,
    // createdAt asc). The threshold basis is itemsSubtotal =
    // Σ product-line unitPrice×qty BEFORE any discount (the
    // bump is EXCLUDED — itemsSubtotal above is exactly the
    // product lines only). At most ONE gift: the first qualifying
    // candidate wins.
    let gift: CheckoutEvaluation["gift"] = null;
    for (const p of activePromotions) {
      if (!p || String(p.type) !== "gift") continue;
      if (!inWindow(p, now)) continue;
      let cfg: GiftConfig;
      try {
        cfg = validatePromotionConfig("gift", p.config) as GiftConfig;
      } catch {
        continue; // malformed stored gift config ⇒ skipped, never a crash
      }
      if (itemsSubtotal < BigInt(cfg.minSubtotalMinor)) continue;
      const giftProduct = await (this.prisma as any).product
        .findFirst({
          where: { id: cfg.giftProductId, organizationId: orgId, status: "ACTIVE" },
        })
        .catch(() => null);
      if (!giftProduct) continue;
      gift = {
        promotionId: String(p.id),
        name: String(p.name ?? ""),
        productId: cfg.giftProductId,
        giftVariantSku: cfg.giftVariantSku ?? null,
        giftQty: cfg.giftQty,
      };
      break;
    }
    const postPromotionSubtotal =
      discountedLineTotals.reduce((s, x) => s + x, 0n) + bumpMinor;

    // 2) EC7 coupon — validated by the EXISTING DiscountsService
    // against the post-promotion context. With no promotion
    // applied this context is identical to what the checkout
    // paths pass today (EC7 behaviour preserved exactly).
    let couponDiscountMinor = 0n;
    let couponFreeShipping = false;
    let appliedDiscountId: string | null = null;
    let appliedCouponCode: string | null = null;
    if (input.couponCode?.trim()) {
      const v = await this.discounts.validateForCheckout(orgId, input.couponCode, {
        subtotalMinor: postPromotionSubtotal,
        items: input.lines.map((l, i) => ({
          productId: l.productId,
          categoryId: l.categoryId,
          totalMinor: discountedLineTotals[i],
        })),
      });
      if (!v.valid) {
        throw new BadRequestException(
          `কুপন প্রয়োগ করা যায়নি: ${DISCOUNT_REASON_MESSAGES[v.reason ?? ""] ?? v.reason}`,
        );
      }
      couponDiscountMinor = v.discountMinor;
      couponFreeShipping = v.freeShipping;
      appliedDiscountId = v.discount?.id ?? null;
      appliedCouponCode = normalizeReferralCode(input.couponCode);
    }

    // 3) Referral-as-discount (buyer side only). Never throws.
    let referral: CheckoutEvaluation["referral"] = null;
    let referralCodeToRecord: string | null = null;
    const rawCode = normalizeReferralCode(input.referralCode);
    if (rawCode) {
      try {
        referral = await this.resolveReferral(orgId, rawCode, {
          buyerPhone: input.buyerPhone ?? null,
          postPromotionSubtotal,
          couponDiscountMinor,
        });
        if (referral) referralCodeToRecord = rawCode;
        else {
          // Record the code when it at least resolves to a real
          // referrer (the tracking record), even if it granted
          // nothing this time.
          const referrer = await (this.prisma as any).customer.findFirst({
            where: { organizationId: orgId, referralCode: rawCode },
          });
          if (referrer) referralCodeToRecord = rawCode;
        }
      } catch (e) {
        this.logger.warn(
          `referral resolution failed for org ${orgId}: ${e instanceof Error ? e.message : String(e)}`,
        );
        referral = null;
        referralCodeToRecord = null;
      }
    }
    const referralDiscountMinor = referral?.discountMinor ?? 0n;

    // 4) EC23 tax — LAST, on post-discount merchandise bases.
    const tax = await this.computeCheckoutTax(orgId, {
      lines: input.lines,
      discountedLineTotals,
      bumpMinor,
      postPromotionSubtotal,
      couponDiscountMinor,
      referralDiscountMinor,
    });

    return {
      subtotalMinor,
      promotionDiscountMinor,
      promotionsApplied,
      couponDiscountMinor,
      couponFreeShipping,
      appliedDiscountId,
      appliedCouponCode,
      referral,
      referralCodeToRecord,
      referralDiscountMinor,
      totalDiscountMinor: promotionDiscountMinor + couponDiscountMinor + referralDiscountMinor,
      taxMinor: tax.taxMinor,
      taxAddedMinor: tax.taxAddedMinor,
      taxBreakdown: tax.breakdown,
      gift,
    };
  }

  /**
   * EC29: resolve a gift candidate for placement — the ONE
   * semantics both checkout paths (shop + single) use. Returns
   * null when the gift cannot be placed: product missing /
   * not ACTIVE in the org, the configured variant SKU no longer
   * resolves, or tracked stock is below giftQty on a
   * non-preorder product (untracked stock = null ⇒ placeable).
   */
  async giftPlacement(
    orgId: string,
    gift: NonNullable<CheckoutEvaluation["gift"]>,
  ): Promise<{ product: any; variant: any | null } | null> {
    try {
      const product = await (this.prisma as any).product
        .findFirst({ where: { id: gift.productId, organizationId: orgId, status: "ACTIVE" } })
        .catch(() => null);
      if (!product) return null;
      let variant: any = null;
      if (gift.giftVariantSku) {
        const variantTable = (this.prisma as any).productVariant;
        variant = variantTable?.findFirst
          ? await variantTable
              .findFirst({ where: { productId: product.id, sku: gift.giftVariantSku } })
              .catch(() => null)
          : null;
        if (!variant) return null;
      }
      const stock = variant?.stockQuantity ?? product.stockQuantity;
      if (stock !== null && stock !== undefined && Number(stock) < gift.giftQty && !product.preorderEnabled) {
        return null;
      }
      return { product, variant };
    } catch {
      return null;
    }
  }

  /**
   * EC23: load the org TaxSetting + per-product rate overrides and
   * run the pure computeTax. Failure-isolated + parity-first: no
   * TaxSetting row and no product rate (or any load failure) yields
   * zero tax and an empty breakdown, exactly the pre-EC23 result.
   *
   * Line bases: the evaluator's discounted line totals scaled by
   * (merchandisePayable / postPromotionSubtotal) so coupon +
   * referral discounts shrink every line's taxable base
   * proportionally (per-line floor; the bump pseudo-line is scaled
   * the same way and taxed at the org default rate only).
   */
  private async computeCheckoutTax(
    orgId: string,
    ctx: {
      lines: PromotionLine[];
      discountedLineTotals: bigint[];
      bumpMinor: bigint;
      postPromotionSubtotal: bigint;
      couponDiscountMinor: bigint;
      referralDiscountMinor: bigint;
    },
  ): Promise<{ taxMinor: bigint; taxAddedMinor: bigint; breakdown: TaxBreakdownEntry[] }> {
    const zero = { taxMinor: 0n, taxAddedMinor: 0n, breakdown: [] as TaxBreakdownEntry[] };
    try {
      const settingTable = (this.prisma as any).taxSetting;
      const setting = settingTable?.findFirst
        ? await settingTable.findFirst({ where: { organizationId: orgId } }).catch(() => null)
        : null;
      const defaultVatBps: number | null =
        setting?.defaultVatBps != null && Number.isInteger(setting.defaultVatBps)
          ? Number(setting.defaultVatBps)
          : null;
      const productIds = [...new Set(ctx.lines.map((l) => l.productId).filter(Boolean))] as string[];
      const productRates = new Map<string, number | null>();
      if (productIds.length > 0) {
        const rows =
          (await (this.prisma as any).product
            .findMany({ where: { id: { in: productIds }, organizationId: orgId } })
            .catch(() => [])) ?? [];
        for (const r of rows) {
          productRates.set(
            String(r.id),
            r.taxRateBps != null && Number.isInteger(r.taxRateBps) ? Number(r.taxRateBps) : null,
          );
        }
      }
      const anyProductRate = [...productRates.values()].some((v) => v != null);
      if (defaultVatBps == null && !anyProductRate) return zero;

      const merchandisePayable =
        ctx.postPromotionSubtotal - ctx.couponDiscountMinor - ctx.referralDiscountMinor;
      const payable = merchandisePayable > 0n ? merchandisePayable : 0n;
      const scale = (amount: bigint): bigint =>
        ctx.postPromotionSubtotal > 0n ? (amount * payable) / ctx.postPromotionSubtotal : 0n;

      const taxLines = ctx.lines.map((l, i) => ({
        productId: l.productId,
        baseMinor: scale(ctx.discountedLineTotals[i] ?? 0n),
      }));
      if (ctx.bumpMinor > 0n) {
        taxLines.push({ productId: null, baseMinor: scale(ctx.bumpMinor) });
      }
      const pricesIncludeVat = setting?.pricesIncludeVat !== false;
      return computeTax(
        taxLines,
        (productId) =>
          productId == null
            ? defaultVatBps
            : (productRates.get(productId) ?? null) ?? defaultVatBps,
        pricesIncludeVat,
      );
    } catch (e) {
      this.logger.warn(
        `EC23 tax evaluation failed for org ${orgId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return zero;
    }
  }

  private async resolveReferral(
    orgId: string,
    code: string,
    ctx: { buyerPhone: string | null; postPromotionSubtotal: bigint; couponDiscountMinor: bigint },
  ): Promise<CheckoutEvaluation["referral"]> {
    const setting = await (this.prisma as any).storefrontSetting
      .findFirst({ where: { organizationId: orgId } })
      .catch(() => null);
    const percent = setting?.referralDiscountPercent;
    if (percent == null || !Number.isInteger(percent) || percent < 1 || percent > 90) {
      return null; // feature off (or misconfigured) ⇒ no discount
    }
    const referrer = await (this.prisma as any).customer.findFirst({
      where: { organizationId: orgId, referralCode: code },
    });
    if (!referrer) return null;
    const buyerKey = phoneKeyLoose(ctx.buyerPhone);
    if (!buyerKey) return null;
    // Self-referral: same phone as the referrer ⇒ silently nothing.
    if (phoneKeyLoose(referrer.phone) === buyerKey) return null;
    // Minimum subtotal, judged on the post-promotion merchandise
    // subtotal (bump included, shipping excluded).
    if (
      setting.referralMinSubtotalMinor != null &&
      ctx.postPromotionSubtotal < BigInt(setting.referralMinSubtotalMinor)
    ) {
      return null;
    }
    // First use per (buyer, code): any earlier non-cancelled order
    // by the same phone carrying this code blocks the discount.
    const priorOrders =
      (await (this.prisma as any).order.findMany({
        where: { organizationId: orgId, referralCode: code },
        take: 1000,
      }).catch(() => [])) ?? [];
    const priorCustomerIds = [
      ...new Set(priorOrders.map((o: any) => o.customerId).filter(Boolean)),
    ] as string[];
    if (priorCustomerIds.length > 0) {
      const priorCustomers =
        (await (this.prisma as any).customer.findMany({
          where: { id: { in: priorCustomerIds }, organizationId: orgId },
        }).catch(() => [])) ?? [];
      const buyerPriorIds = new Set(
        priorCustomers
          .filter((c: any) => phoneKeyLoose(c.phone) === buyerKey)
          .map((c: any) => String(c.id)),
      );
      const blocking = priorOrders.some(
        (o: any) =>
          o.customerId &&
          buyerPriorIds.has(String(o.customerId)) &&
          !NON_COUNTING_ORDER_STATUSES.includes(String(o.status ?? "")),
      );
      if (blocking) return null;
    }
    const base = ctx.postPromotionSubtotal - ctx.couponDiscountMinor;
    if (base <= 0n) return null;
    const discountMinor = (base * BigInt(percent)) / 100n;
    if (discountMinor <= 0n) return null;
    return { code, referrerCustomerId: String(referrer.id), discountMinor };
  }

  /** Stamp the EC16 split onto a placed order (the EC18 slot
   * pattern). Failure-isolated: never throws, logs instead — a
   * stamp failure must not fail a placed order. */
  async stampOrder(
    orgId: string,
    source: string,
    externalId: string,
    ev: CheckoutEvaluation,
  ): Promise<void> {
    try {
      const orderTable = (this.prisma as any).order;
      const order = orderTable?.findFirst
        ? await orderTable.findFirst({ where: { organizationId: orgId, source, externalId } })
        : null;
      if (!order) return;
      await orderTable.update({
        where: { id: order.id },
        data: {
          promotionDiscountMinor: ev.promotionDiscountMinor,
          promotionsApplied:
            ev.promotionsApplied.length > 0
              ? ev.promotionsApplied.map((p) => ({ ...p, amountMinor: p.amountMinor.toString() }))
              : null,
          referralDiscountMinor: ev.referralDiscountMinor,
          referralCode: ev.referralCodeToRecord,
          // EC23: the per-rate tax snapshot. taxMinor/totalMinor
          // already rode the checkout's own order write (upsert);
          // taxBreakdown is not part of that payload, so it is
          // stamped here with the rest of the EC16 split.
          taxBreakdown:
            ev.taxBreakdown && ev.taxBreakdown.length > 0
              ? serializeTaxBreakdown(ev.taxBreakdown)
              : null,
          // EC29: gift stamps ride ONLY when the checkout path
          // actually attempted placement (giftOutcome set). When
          // unset (landing/preview evaluations) the gift fields
          // are left untouched.
          ...(ev.gift && ev.giftOutcome
            ? {
                giftPromotionId: ev.gift.promotionId,
                giftSkipped: ev.giftOutcome === "skipped",
              }
            : {}),
        },
      });
    } catch (e) {
      this.logger.warn(
        `EC16 order stamp failed for ${externalId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** Lazily generate (or return) a customer's own referral code. */
  async ensureCustomerReferralCode(orgId: string, customerId: string): Promise<string | null> {
    const customerTable = (this.prisma as any).customer;
    const row = await customerTable.findFirst({ where: { id: customerId, organizationId: orgId } });
    if (!row) return null;
    if (row.referralCode) return String(row.referralCode);
    for (let attempt = 0; attempt < 5; attempt++) {
      const bytes = randomBytes(6);
      let suffix = "";
      for (let i = 0; i < 6; i++) suffix += REFERRAL_CODE_ALPHABET[bytes[i] % REFERRAL_CODE_ALPHABET.length];
      const code = `REF${suffix}`;
      const clash = await customerTable.findFirst({
        where: { organizationId: orgId, referralCode: code },
      });
      if (clash) continue;
      await customerTable.update({ where: { id: customerId }, data: { referralCode: code } });
      return code;
    }
    return null;
  }

  /** Failure-isolated helper for checkout responses: the buyer's
   * OWN referral code (to share), resolved by phone. */
  async yourReferralCodeForPhone(orgId: string, phone: string | null): Promise<string | null> {
    try {
      if (!phone) return null;
      const key = phoneKeyLoose(phone);
      if (!key) return null;
      // Fast path: checkout stores the phone verbatim (trimmed).
      let mine = await (this.prisma as any).customer.findFirst({
        where: { organizationId: orgId, phone: phone.trim() },
      }).catch(() => null);
      if (!mine) {
        const customers =
          (await (this.prisma as any).customer.findMany({
            where: { organizationId: orgId },
            take: 2000,
          }).catch(() => [])) ?? [];
        mine = customers.find((c: any) => phoneKeyLoose(c.phone) === key) ?? null;
      }
      if (!mine) return null;
      return await this.ensureCustomerReferralCode(orgId, String(mine.id));
    } catch {
      return null;
    }
  }

  // ---------- staff preview (cart simulator) ----------

  async preview(orgId: string, dto: PromotionPreviewDto) {
    const lines: PromotionLine[] = [];
    for (const item of dto.items ?? []) {
      const product = await (this.prisma as any).product.findFirst({
        where: { id: item.productId, organizationId: orgId, status: "ACTIVE" },
      });
      if (!product) {
        throw new BadRequestException(`পণ্য পাওয়া যায়নি অথবা সক্রিয় নয়: ${item.productId}`);
      }
      const qty = Math.max(1, Math.min(999, Number(item.quantity ?? 1) || 1));
      lines.push({
        productId: product.id,
        categoryId: product.categoryId ?? null,
        quantity: qty,
        unitPriceMinor: BigInt(product.priceMinor),
        compareAtMinor: product.compareAtMinor != null ? BigInt(product.compareAtMinor) : null,
      });
    }
    if (lines.length === 0) throw new BadRequestException("প্রিভিউয়ের জন্য অন্তত একটি পণ্য দিন");
    const ev = await this.evaluateCheckout(orgId, {
      lines,
      bumpMinor: 0n,
      couponCode: dto.couponCode ?? null,
      referralCode: dto.referralCode ?? null,
      buyerPhone: dto.buyerPhone ?? null,
    });
    return {
      items: lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        unitPriceMinor: l.unitPriceMinor.toString(),
        lineTotalMinor: (l.unitPriceMinor * BigInt(l.quantity)).toString(),
      })),
      subtotalMinor: ev.subtotalMinor.toString(),
      promotionDiscountMinor: ev.promotionDiscountMinor.toString(),
      promotionsApplied: ev.promotionsApplied.map((p) => ({
        promotionId: p.promotionId, name: p.name, type: p.type, amountMinor: p.amountMinor.toString(),
      })),
      coupon: ev.appliedCouponCode
        ? { code: ev.appliedCouponCode, discountMinor: ev.couponDiscountMinor.toString(), freeShipping: ev.couponFreeShipping }
        : null,
      referral: ev.referral
        ? { code: ev.referral.code, discountMinor: ev.referral.discountMinor.toString() }
        : null,
      referralDiscountMinor: ev.referralDiscountMinor.toString(),
      // EC29: the gift candidate for this simulated cart (not a
      // discount — totalDiscountMinor above is unchanged by it).
      gift: ev.gift
        ? {
            promotionId: ev.gift.promotionId,
            name: ev.gift.name,
            productId: ev.gift.productId,
            giftVariantSku: ev.gift.giftVariantSku,
            quantity: ev.gift.giftQty,
          }
        : null,
      totalDiscountMinor: ev.totalDiscountMinor.toString(),
      merchandiseTotalMinor: (ev.subtotalMinor - ev.totalDiscountMinor).toString(),
      // EC23: VAT on the post-discount bases (see evaluateCheckout).
      taxMinor: (ev.taxMinor ?? 0n).toString(),
      taxAddedMinor: (ev.taxAddedMinor ?? 0n).toString(),
      taxBreakdown: (ev.taxBreakdown ?? []).map((b) => ({
        rateBps: b.rateBps,
        taxableMinor: b.taxableMinor.toString(),
        taxMinor: b.taxMinor.toString(),
      })),
      currency: "BDT",
    };
  }
}
