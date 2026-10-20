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
  PROMOTION_CONFIG_CODES,
  type GiftConfig,
  type PromotionLine,
} from "./promotions";
import type { PromotionDto, PromotionPreviewDto } from "./commerce.dto";
import { EventsService } from "../common/events.service";
import { computeTax, serializeTaxBreakdown, type TaxBreakdownEntry } from "./tax";
import { badRequest, notFound } from "../i18n";

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
  /** AB1 (AX2): the resolved referrer's Customer id behind
   * referralCodeToRecord (set in BOTH the discount path and the
   * code-only tracking path), stamped onto Order.referrerCustomerId
   * by stampOrder so the referral-reward hook never has to
   * re-resolve a code. Optional: pre-AB1 evaluations lack it. */
  referrerCustomerIdToRecord?: string | null;
  /** AB1 (AX1): the loyalty-points discount line — applied
   * AFTER coupon + referral, BEFORE tax, and included in
   * totalDiscountMinor exactly like its neighbours. The points
   * themselves are spent by the CALLER at placement
   * (LoyaltyService.postPlacementRedeem); the evaluator only
   * prices them from the caller-supplied snapshot. Optional:
   * evaluations built by pre-AB1 callers/specs lack both. */
  loyaltyDiscountMinor?: bigint;
  loyaltyPointsApplied?: number;
  /** AB2 (AX3): the gift-card discount line — applied AFTER
   * loyalty (step 3c), BEFORE tax, and included in
   * totalDiscountMinor exactly like its neighbours. The card's
   * balance itself is spent by the CALLER at placement
   * (GiftCardService); the evaluator only prices it from the
   * caller-supplied snapshot. Optional: evaluations built by
   * pre-AB2 callers/specs lack all three. */
  giftCardDiscountMinor?: bigint;
  giftCardId?: string | null;
  giftCardCodeLast4?: string | null;
  /** NF7 (FB3): the store-credit discount line — applied AFTER
   * the gift card (step 3d), BEFORE tax, and included in
   * totalDiscountMinor exactly like its neighbours. The credit
   * itself is spent by the CALLER at placement
   * (StoreCreditService.postPlacementSpend); the evaluator only
   * prices it from the caller-supplied snapshot. Optional:
   * evaluations built by pre-NF7 callers/specs lack both. */
  storeCreditDiscountMinor?: bigint;
  storeCreditCustomerId?: string | null;
  /** promotion + coupon + referral + loyalty + gift card — what lands in Order.discountMinor. */
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

/** GB7: named shape of evaluateCheckout's input argument. */
export interface EvaluateCheckoutInput {
  lines: PromotionLine[];
  bumpMinor?: bigint;
  couponCode?: string | null;
  referralCode?: string | null;
  buyerPhone?: string | null;
  now?: Date;
  customerId?: string | null;
  priorOrderCount?: number | null;
  excludeOrderId?: string | null;
  /** AB1 (AX1): loyalty redemption request + the resolved
   * customer's snapshot, supplied by the caller (the GB7
   * priorOrderCount pattern — the evaluator itself reads no
   * loyalty tables). Null/absent ⇒ no loyalty line, and the
   * evaluation is byte-identical to the pre-AB1 result. */
  loyalty?: LoyaltyRedeemInput | null;
  /** AB2 (AX3): gift-card redemption snapshot, supplied by the
   * caller (the GB7 / AB1 pattern — the evaluator itself reads
   * no gift-card tables and never throws for gift-card reasons).
   * Null/absent ⇒ no gift-card line, and the evaluation totals
   * are identical to the pre-AB2 result. */
  giftCard?: { giftCardId: string; balanceMinor: bigint; codeLast4: string } | null;
  /** NF7 (FB3): store-credit redemption snapshot, supplied by
   * the caller (the GB7 / AB1 / AB2 pattern — the evaluator
   * itself reads no credit tables and never throws for credit
   * reasons). requestedMinor null/absent ⇒ apply as much as
   * fits. Null/absent ⇒ no credit line, and the evaluation
   * totals are identical to the pre-NF7 result. */
  storeCredit?: { customerId: string; balanceMinor: bigint; requestedMinor?: bigint | null } | null;
}

/** AB1 (AX1): everything evaluateCheckout needs to price a
 * points redemption without touching the DB: the shopper's
 * requested points plus the setting/balance snapshot the caller
 * resolved for the identified customer. */
export interface LoyaltyRedeemInput {
  pointsToRedeem: number;
  balance: number;
  redeemValueMinorPerPoint: number;
  minRedeemPoints: number;
  maxRedeemSharePct: number | null;
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
    // SU5: sale-start producer hook. LAST param + Optional
    // (EventsService is global); fire-and-forget emit.
    @Optional() private readonly events?: EventsService,
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
    if (!row) throw notFound("commerce.promotionNotFoundInOrg");
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
      throw badRequest("commerce.promotionTypeInvalid");
    }
    let normalized: any;
    try {
      normalized = validatePromotionConfig(type, config);
    } catch (e) {
      const key = e instanceof Error ? e.message : "unknown_type";
      throw badRequest(PROMOTION_CONFIG_CODES[key] ?? "commerce.promotionConfigUnknownType");
    }
    if (type === "flash" && (!startsAt || !endsAt)) {
      throw badRequest("commerce.flashPromotionTimesRequired");
    }
    if (startsAt && endsAt && endsAt <= startsAt) {
      throw badRequest("commerce.endTimeBeforeStart");
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
      if (!p) throw badRequest("commerce.productNotOfOrg", { productId: pid });
    }
    for (const cid of categoryIds) {
      const c = await (this.prisma as any).category.findFirst({
        where: { id: cid, organizationId: orgId },
      });
      if (!c) throw badRequest("commerce.categoryNotOfOrg", { categoryId: cid });
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
        throw badRequest("commerce.giftVariantSkuNotFound");
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
    if (!name) throw badRequest("commerce.promotionNameRequired");
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
    // SU5: a promotion born active may become a social DRAFT.
    if (row.active) {
      this.events?.emit?.("social_draft.promotion_activated", { organizationId: orgId, promotionId: row.id });
    }
    return { promotion: this.serialize(row) };
  }

  async update(orgId: string, actorId: string, id: string, dto: PromotionDto) {
    const existing = await this.loadOr404(orgId, id);
    // SU5: captured BEFORE the write — the transition check
    // below must compare against the pre-update state.
    const wasActive = existing.active === true;
    const type = dto.type !== undefined ? String(dto.type) : String(existing.type);
    const startsAt = dto.startsAt !== undefined ? toDateOrNull(dto.startsAt) : (existing.startsAt ? new Date(existing.startsAt) : null);
    const endsAt = dto.endsAt !== undefined ? toDateOrNull(dto.endsAt) : (existing.endsAt ? new Date(existing.endsAt) : null);
    const data: Record<string, any> = {};
    if (dto.name !== undefined) {
      const name = String(dto.name ?? "").trim();
      if (!name) throw badRequest("commerce.promotionNameRequired");
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
    // SU5: an inactive → active transition is a sale start.
    if (!wasActive && updated.active === true) {
      this.events?.emit?.("social_draft.promotion_activated", { organizationId: orgId, promotionId: id });
    }
    return { promotion: this.serialize(updated) };
  }

  async setActive(orgId: string, actorId: string, id: string, active: boolean) {
    await this.loadOr404(orgId, id);
    const updated = await this.table().update({ where: { id }, data: { active } });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "promotion.toggled",
      entityType: "Promotion", entityId: id, metadata: { active },
    });
    // SU5: explicit activation is a sale start.
    if (active === true) {
      this.events?.emit?.("social_draft.promotion_activated", { organizationId: orgId, promotionId: id });
    }
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
    input: EvaluateCheckoutInput,
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
      const ev = evaluatePromotions(activePromotions, input.lines, now, {
        priorOrderCount: input.priorOrderCount,
      });
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
        priorOrderCount: input.priorOrderCount,
        customerId: input.customerId,
        excludeOrderId: input.excludeOrderId,
      });
      if (!v.valid) {
        throw badRequest("commerce.couponApplyFailed", { reason: DISCOUNT_REASON_MESSAGES[v.reason ?? ""] ?? v.reason });
      }
      couponDiscountMinor = v.discountMinor;
      couponFreeShipping = v.freeShipping;
      appliedDiscountId = v.discount?.id ?? null;
      appliedCouponCode = normalizeReferralCode(input.couponCode);
    }

    // 3) Referral-as-discount (buyer side only). Never throws.
    let referral: CheckoutEvaluation["referral"] = null;
    let referralCodeToRecord: string | null = null;
    // AB1 (AX2): the referrer's id rides along in BOTH paths so
    // stampOrder can pin it on the order for the reward hook.
    let referrerCustomerIdToRecord: string | null = null;
    const rawCode = normalizeReferralCode(input.referralCode);
    if (rawCode) {
      try {
        referral = await this.resolveReferral(orgId, rawCode, {
          buyerPhone: input.buyerPhone ?? null,
          postPromotionSubtotal,
          couponDiscountMinor,
        });
        if (referral) {
          referralCodeToRecord = rawCode;
          referrerCustomerIdToRecord = referral.referrerCustomerId;
        } else {
          // Record the code when it at least resolves to a real
          // referrer (the tracking record), even if it granted
          // nothing this time.
          const referrer = await (this.prisma as any).customer.findFirst({
            where: { organizationId: orgId, referralCode: rawCode },
          });
          if (referrer) {
            referralCodeToRecord = rawCode;
            referrerCustomerIdToRecord = String(referrer.id);
          }
        }
      } catch (e) {
        this.logger.warn(
          `referral resolution failed for org ${orgId}: ${e instanceof Error ? e.message : String(e)}`,
        );
        referral = null;
        referralCodeToRecord = null;
        referrerCustomerIdToRecord = null;
      }
    }
    const referralDiscountMinor = referral?.discountMinor ?? 0n;

    // 3b) AB1 (AX1): loyalty-points redemption — its own discount
    // line AFTER coupon + referral, priced ONLY from the
    // caller-supplied snapshot (never a DB read, never a throw).
    // An over-request is CLAMPED, never an error: the applied
    // points are reduced to what fits (balance, the merchandise
    // payable after the other lines, and the optional share
    // cap), and loyaltyPointsApplied reports exactly what will
    // be spent at placement. Below the configured minimum the
    // redemption simply does not happen.
    let loyaltyDiscountMinor = 0n;
    let loyaltyPointsApplied = 0;
    const loy = input.loyalty ?? null;
    if (
      loy &&
      Number.isInteger(loy.pointsToRedeem) &&
      loy.pointsToRedeem > 0 &&
      Number.isInteger(loy.redeemValueMinorPerPoint) &&
      loy.redeemValueMinorPerPoint > 0
    ) {
      const payableAfterOthers =
        postPromotionSubtotal - couponDiscountMinor - referralDiscountMinor;
      if (payableAfterOthers > 0n) {
        let candidate = Math.min(
          loy.pointsToRedeem,
          Math.max(0, Math.floor(loy.balance)),
        );
        if (loy.minRedeemPoints > 0 && candidate < loy.minRedeemPoints) {
          candidate = 0;
        }
        if (candidate > 0) {
          const shareCap =
            loy.maxRedeemSharePct != null
              ? (payableAfterOthers * BigInt(loy.maxRedeemSharePct)) / 100n
              : null;
          const discountCap =
            shareCap != null && shareCap < payableAfterOthers
              ? shareCap
              : payableAfterOthers;
          let pts = candidate;
          if (BigInt(pts) * BigInt(loy.redeemValueMinorPerPoint) > discountCap) {
            pts = Number(discountCap / BigInt(loy.redeemValueMinorPerPoint));
          }
          loyaltyPointsApplied = pts;
          // The discount is ALWAYS points × value exactly, so
          // the ledger spend and the priced discount can never
          // drift apart by a rounding paisa.
          loyaltyDiscountMinor = BigInt(pts) * BigInt(loy.redeemValueMinorPerPoint);
        }
      }
    }

    // 3c) AB2 (AX3): gift-card redemption — its own discount
    // line AFTER loyalty, priced ONLY from the caller-supplied
    // snapshot (never a DB read, never a throw). The applied
    // amount is simply what the card can cover of what loyalty
    // left: min(balance, payableAfterLoyalty), floored at 0.
    // The id / last4 are echoed ONLY when value actually
    // applied (mirroring how referral behaves).
    let giftCardDiscountMinor = 0n;
    let giftCardId: string | null = null;
    let giftCardCodeLast4: string | null = null;
    const gc = input.giftCard ?? null;
    if (gc) {
      const payableAfterLoyaltyRaw =
        postPromotionSubtotal - couponDiscountMinor - referralDiscountMinor - loyaltyDiscountMinor;
      const payableAfterLoyalty = payableAfterLoyaltyRaw > 0n ? payableAfterLoyaltyRaw : 0n;
      const balance = gc.balanceMinor ?? 0n;
      const applied =
        balance <= 0n ? 0n : balance < payableAfterLoyalty ? balance : payableAfterLoyalty;
      if (applied > 0n) {
        giftCardDiscountMinor = applied;
        giftCardId = gc.giftCardId ?? null;
        giftCardCodeLast4 = gc.codeLast4 ?? null;
      }
    }

    // 3d) NF7 (FB3): store-credit redemption — its own discount
    // line AFTER the gift card, priced ONLY from the
    // caller-supplied snapshot. The applied amount is
    // min(balance, requested when given, payableAfterGiftCard),
    // floored at 0 — credit can never exceed what the customer
    // has or what the order still owes. The customer id is
    // echoed ONLY when value actually applied.
    let storeCreditDiscountMinor = 0n;
    let storeCreditCustomerId: string | null = null;
    const sc = input.storeCredit ?? null;
    if (sc) {
      const payableAfterGiftRaw =
        postPromotionSubtotal - couponDiscountMinor - referralDiscountMinor - loyaltyDiscountMinor - giftCardDiscountMinor;
      const payableAfterGift = payableAfterGiftRaw > 0n ? payableAfterGiftRaw : 0n;
      const balance = sc.balanceMinor ?? 0n;
      let applied = balance <= 0n ? 0n : balance < payableAfterGift ? balance : payableAfterGift;
      if (sc.requestedMinor !== null && sc.requestedMinor !== undefined && sc.requestedMinor < applied) {
        applied = sc.requestedMinor > 0n ? sc.requestedMinor : 0n;
      }
      if (applied > 0n) {
        storeCreditDiscountMinor = applied;
        storeCreditCustomerId = sc.customerId ?? null;
      }
    }

    // 4) EC23 tax — LAST, on post-discount merchandise bases.
    const tax = await this.computeCheckoutTax(orgId, {
      lines: input.lines,
      discountedLineTotals,
      bumpMinor,
      postPromotionSubtotal,
      couponDiscountMinor,
      referralDiscountMinor,
      loyaltyDiscountMinor,
      giftCardDiscountMinor,
      storeCreditDiscountMinor,
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
      referrerCustomerIdToRecord,
      referralDiscountMinor,
      loyaltyDiscountMinor,
      loyaltyPointsApplied,
      giftCardDiscountMinor,
      giftCardId,
      giftCardCodeLast4,
      storeCreditDiscountMinor,
      storeCreditCustomerId,
      totalDiscountMinor:
        promotionDiscountMinor +
        couponDiscountMinor +
        referralDiscountMinor +
        loyaltyDiscountMinor +
        giftCardDiscountMinor +
        storeCreditDiscountMinor,
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
      /** AB1 + AB2: loyalty redemption and the gift-card line
       * both shrink the taxable base proportionally, exactly
       * like coupon + referral. */
      loyaltyDiscountMinor: bigint;
      giftCardDiscountMinor: bigint;
      /** NF7: the store-credit line shrinks the taxable base
       * the same way (optional — pre-NF7 callers omit it). */
      storeCreditDiscountMinor?: bigint;
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
        ctx.postPromotionSubtotal -
        ctx.couponDiscountMinor -
        ctx.referralDiscountMinor -
        ctx.loyaltyDiscountMinor -
        ctx.giftCardDiscountMinor -
        (ctx.storeCreditDiscountMinor ?? 0n);
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
      // GB7: appliedDiscounts is built FROM this evaluation only
      // (never reconstructed later) — entries with discount > 0.
      const appliedDiscounts: any[] = [];
      for (const p of ev.promotionsApplied ?? []) {
        if (p.amountMinor != null && BigInt(p.amountMinor as any) > 0n) {
          appliedDiscounts.push({
            promotionId: p.promotionId,
            kind: "promotion",
            name: p.name,
            discountMinor: String(p.amountMinor),
          });
        }
      }
      if (ev.appliedDiscountId != null && ev.couponDiscountMinor != null && ev.couponDiscountMinor > 0n) {
        appliedDiscounts.push({
          couponCode: ev.appliedCouponCode,
          kind: "coupon",
          name: ev.appliedCouponCode,
          discountMinor: String(ev.couponDiscountMinor),
        });
      }
      if (ev.referralDiscountMinor != null && ev.referralDiscountMinor > 0n) {
        appliedDiscounts.push({
          kind: "referral",
          name: "রেফারেল ছাড়",
          discountMinor: String(ev.referralDiscountMinor),
        });
      }
      // AB1 (AX1): the loyalty line joins the same stamp — the
      // applied POINTS ride along so Order 360 / reports can show
      // what was spent without re-reading the ledger.
      if (ev.loyaltyDiscountMinor != null && ev.loyaltyDiscountMinor > 0n) {
        appliedDiscounts.push({
          kind: "loyalty",
          name: "লয়্যালটি পয়েন্ট ছাড়",
          discountMinor: String(ev.loyaltyDiscountMinor),
          points: ev.loyaltyPointsApplied ?? null,
        });
      }
      // AB2 (AX3): the gift-card line joins the same stamp — the
      // card's last4 rides along so Order 360 / reports can show
      // which card paid without ever exposing the full code.
      if (ev.giftCardDiscountMinor != null && ev.giftCardDiscountMinor > 0n) {
        appliedDiscounts.push({
          kind: "gift_card",
          name: "গিফট কার্ড (••••" + (ev.giftCardCodeLast4 ?? "") + ")",
          discountMinor: String(ev.giftCardDiscountMinor),
          codeLast4: ev.giftCardCodeLast4 ?? null,
        });
      }
      await orderTable.update({
        where: { id: order.id },
        data: {
          ...(appliedDiscounts.length > 0 ? { appliedDiscounts } : {}),
          promotionDiscountMinor: ev.promotionDiscountMinor,
          promotionsApplied:
            ev.promotionsApplied.length > 0
              ? ev.promotionsApplied.map((p) => ({ ...p, amountMinor: p.amountMinor.toString() }))
              : null,
          referralDiscountMinor: ev.referralDiscountMinor,
          referralCode: ev.referralCodeToRecord,
          // AB1 (AX2): pin the resolved referrer ONLY when this
          // evaluation resolved one (same discipline as
          // couponCode below: an evaluation that carried no
          // referral input must not erase a previously stamped
          // referrer).
          ...(ev.referrerCustomerIdToRecord
            ? { referrerCustomerId: ev.referrerCustomerIdToRecord }
            : {}),
          // ON3: stamp the coupon code ONLY when a coupon truly
          // applied in this evaluation (appliedDiscountId set) —
          // the value is then ev.appliedCouponCode. When no
          // coupon was decided by this evaluation the stored
          // couponCode is left unchanged: stampOrder also runs
          // for evaluations that carried no coupon input, and
          // erasing (or inventing) the code there would break
          // ON3 surgery's re-validation of the original coupon.
          // Order surgery writes couponCode itself on its own
          // updates (including clearing it when a coupon drops).
          ...(ev.appliedDiscountId != null
            ? { couponCode: ev.appliedCouponCode }
            : {}),
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

  /** GB7: promotions/coupon performance report, reading ONLY the
   * Order.appliedDiscounts stamps written at placement. */
  async promotionsReport(orgId: string, fromRaw?: string, toRaw?: string) {
    const now = new Date();
    let to = now;
    let from = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    if (fromRaw) {
      const d = new Date(fromRaw);
      if (Number.isNaN(d.getTime())) throw badRequest("commerce.startDateInvalid");
      from = d;
    }
    if (toRaw) {
      const d = new Date(toRaw);
      if (Number.isNaN(d.getTime())) throw badRequest("commerce.endDateInvalid");
      to = d;
    }
    const orderTable = (this.prisma as any).order;
    const fetched =
      (orderTable?.findMany
        ? await orderTable.findMany({
            where: {
              organizationId: orgId,
              isPractice: false,
              status: { notIn: [...NON_COUNTING_ORDER_STATUSES] },
              placedAt: { gte: from, lte: to },
              appliedDiscounts: { not: null },
            },
            orderBy: { placedAt: "desc" },
            take: 5001,
          })
        : []) ?? [];
    const truncated = fetched.length > 5000;
    const orders = fetched.slice(0, 5000);
    const couponMap = new Map<string, { code: string; redemptions: number; discountTotal: bigint; revenue: bigint; seenOrders: Set<string> }>();
    const promoMap = new Map<string, { promotionId: string; name: string; applications: number; discountTotal: bigint }>();
    for (const order of orders) {
      const entries: any[] = Array.isArray(order.appliedDiscounts) ? order.appliedDiscounts : [];
      const couponCodesInOrder = new Set<string>();
      for (const entry of entries) {
        let disc = 0n;
        try { disc = BigInt(entry?.discountMinor ?? 0); } catch { disc = 0n; }
        if (entry?.kind === "coupon" && entry.couponCode) {
          const code = String(entry.couponCode);
          let agg = couponMap.get(code);
          if (!agg) {
            agg = { code, redemptions: 0, discountTotal: 0n, revenue: 0n, seenOrders: new Set() };
            couponMap.set(code, agg);
          }
          agg.discountTotal += disc;
          if (!agg.seenOrders.has(String(order.id))) {
            agg.seenOrders.add(String(order.id));
            agg.redemptions += 1;
            let total = 0n;
            try { total = BigInt(order.totalMinor ?? 0); } catch { total = 0n; }
            agg.revenue += total;
          }
          couponCodesInOrder.add(code);
        } else if (entry?.kind === "promotion" && entry.promotionId) {
          const pid = String(entry.promotionId);
          let agg = promoMap.get(pid);
          if (!agg) {
            // Orders are newest-first, so the first name seen is the latest.
            agg = { promotionId: pid, name: String(entry.name ?? ""), applications: 0, discountTotal: 0n };
            promoMap.set(pid, agg);
          }
          agg.applications += 1;
          agg.discountTotal += disc;
        }
      }
    }
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      coupons: [...couponMap.values()].map((a) => ({
        code: a.code,
        redemptions: a.redemptions,
        discountTotalMinor: a.discountTotal.toString(),
        revenueMinor: a.revenue.toString(),
      })),
      promotions: [...promoMap.values()].map((a) => ({
        promotionId: a.promotionId,
        name: a.name,
        applications: a.applications,
        discountTotalMinor: a.discountTotal.toString(),
      })),
      coverage: {
        ordersScanned: orders.length,
        truncated,
        note: "এই রিপোর্টে শুধু GB7 (appliedDiscounts স্ট্যাম্প) চালুর পর দেওয়া অর্ডার ধরা হয়েছে; আগের অর্ডারে এই তথ্য নেই।",
      },
    };
  }

  /** GB7: prior (counting) order count for a resolved customer.
   * Failure-isolated: null when there is no customer or the count
   * cannot be loaded (null = identity/history unverifiable). */
  async priorOrderCountFor(
    orgId: string,
    customerId: string | null,
    excludeOrderId?: string,
  ): Promise<number | null> {
    try {
      if (!customerId) return null;
      const orderTable = (this.prisma as any).order;
      if (!orderTable?.count) return null;
      const count = await orderTable.count({
        where: {
          organizationId: orgId,
          customerId,
          isPractice: false,
          status: { notIn: [...NON_COUNTING_ORDER_STATUSES] },
          ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
        },
      });
      return Number(count);
    } catch (e) {
      this.logger.warn(
        `prior order count failed for org ${orgId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  /** GB7: resolve a Customer id by phone (loose BD key comparison,
   * mirroring yourReferralCodeForPhone). Failure-isolated → null. */
  async customerIdForPhone(orgId: string, phone: string | null | undefined): Promise<string | null> {
    try {
      if (!phone) return null;
      const key = phoneKeyLoose(phone);
      if (!key) return null;
      const customers =
        (await (this.prisma as any).customer
          .findMany({
            where: { organizationId: orgId, phone: { not: null } },
            select: { id: true, phone: true },
          })
          .catch(() => [])) ?? [];
      const mine = customers.find((c: any) => phoneKeyLoose(c.phone) === key) ?? null;
      return mine ? String(mine.id) : null;
    } catch (e) {
      this.logger.warn(
        `customer lookup by phone failed for org ${orgId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
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
        throw badRequest("commerce.productNotFoundOrInactiveId", { productId: item.productId });
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
    if (lines.length === 0) throw badRequest("commerce.previewNeedsProduct");
    // GB7: resolve the preview buyer's identity/history when a
    // phone was given, so customer-conditioned rules preview truly.
    let previewCustomerId: string | null = null;
    let previewPriorOrderCount: number | null = null;
    if (dto.buyerPhone) {
      previewCustomerId = await this.customerIdForPhone(orgId, dto.buyerPhone);
      previewPriorOrderCount = await this.priorOrderCountFor(orgId, previewCustomerId);
    }
    const ev = await this.evaluateCheckout(orgId, {
      lines,
      bumpMinor: 0n,
      couponCode: dto.couponCode ?? null,
      referralCode: dto.referralCode ?? null,
      buyerPhone: dto.buyerPhone ?? null,
      customerId: previewCustomerId,
      priorOrderCount: previewPriorOrderCount,
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
