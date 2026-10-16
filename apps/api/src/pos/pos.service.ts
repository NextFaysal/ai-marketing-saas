import {
  BadRequestException, Injectable, Logger, NotFoundException, Optional,
} from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { OrdersService } from "../orders/orders.service";
import { PromotionsService, type LoyaltyRedeemInput } from "../commerce/promotions.service";
import { LoyaltyService } from "../commerce/loyalty.service";
import { GiftCardsService } from "../commerce/gift-cards.service";
import { PriceListsService, pickGroupPrice } from "../commerce/price-lists.service";
import { DiscountsService } from "../commerce/discounts.service";
import type { PromotionLine } from "../commerce/promotions";
import { dhakaDayStartUtc } from "../crm/lead-followups";
import { IdempotencyService } from "../fraud/idempotency.service";
import type { CreatePosSaleDto } from "./pos.dto";

const DAY_MS = 24 * 3600 * 1000;

/**
 * EC34 — POS / কাউন্টার বিক্রি (quick-sale at the shop counter).
 *
 * A POS sale is an ordinary Order row with source "pos" — no
 * POS-specific tables (migration 20261013600000 is index-only).
 * The differences from the other order paths are all here:
 *
 *  - PRICES COME FROM THE DB, NEVER THE CLIENT. The DTO carries
 *    no price fields at all; each unit price is resolved from
 *    ProductVariant.priceMinor (when set) ?? Product.priceMinor,
 *    the same native unit rule the storefront charges.
 *  - PRICING RUNS THE ONE CHECKOUT PATH: PromotionsService
 *    .evaluateCheckout (promotions → coupon → referral → EC23
 *    tax), so a counter sale discounts and taxes exactly like a
 *    shop checkout. Delivery is always 0 (the buyer is standing
 *    at the counter). An invalid coupon throws the evaluator's
 *    verbatim Bengali BadRequest BEFORE anything is written.
 *  - PLACEMENT RIDES IntegrationsService.upsertOrder, so the S1
 *    inventory hooks decrement stock at placement (preorder
 *    lines are stamped isPreorder and never decrement), the
 *    customer is found-or-created, and order events fire —
 *    exactly like every other source.
 *  - THE SALE IS COMPLETED IMMEDIATELY: after placement the
 *    order is transitioned processing → completed through
 *    OrdersService.updateOrder (the transition table allows it;
 *    order.delivered fires there). A counter sale has no
 *    fulfilment leg.
 *  - PAYMENT: mode "paid" records the money as an approved
 *    PaymentVerification in EC19 shape but with source "pos"
 *    (NOT OrdersService.recordAdvanceVerification, whose source
 *    "manual_advance" + audit action would make counter money
 *    indistinguishable from phone-order advances). Because the
 *    row is approved, the EC19 due math (total − Σ approved)
 *    drops the order's due to 0 by construction. Mode "due"
 *    (বাকি/খাতা) records nothing — the full total stays due.
 *    The duplicate-approved-TrxID guard runs BEFORE placement
 *    so a reused reference refuses the whole sale instead of
 *    leaving a completed-but-unpaid order behind.
 *  - GIFT PROMOTIONS: evaluateCheckout may return a gift
 *    candidate, but POS v1 does NOT place gift lines (a counter
 *    sale hands over exactly what was scanned). A gift is not a
 *    discount, so ignoring it leaves every total consistent;
 *    giftOutcome stays unset, so stampOrder leaves the gift
 *    fields untouched.
 *  - WALK-IN CUSTOMER: with no phone, all counter walk-ins in
 *    an org share ONE customer record (source "pos",
 *    externalId "pos-walkin", firstName "কাউন্টার ক্রেতা").
 *    upsertOrder creates a customer when externalId + firstName
 *    are present (phone is NOT mandatory in its customer block),
 *    and finds it again by (org, source, externalId) on later
 *    sales — honest bookkeeping: walk-in revenue is real, the
 *    buyer is simply unidentified.
 */
@Injectable()
export class PosService {
  private readonly logger = new Logger(PosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly orders: OrdersService,
    private readonly promotions: PromotionsService,
    @Optional() private readonly discounts?: DiscountsService,
    @Optional() private readonly audit?: AuditService,
    // AB1 (AX1): loyalty snapshot + placement-time points spend.
    // LAST param + Optional, same discipline; absent keeps POS
    // exactly as before AB1.
    @Optional() private readonly loyalty?: LoyaltyService,
    // AB2 (AX3): gift-card redemption resolution + placement-time
    // balance spend. LAST param + Optional, same discipline;
    // absent keeps POS exactly as before AB2.
    @Optional() private readonly giftCards?: GiftCardsService,
    // AB4 (AX6): GB3 idempotency replay for retried sales (incl.
    // offline-sync posts). LAST param + Optional, same
    // discipline; absent keeps POS exactly as before AB4.
    @Optional() private readonly idempotency?: IdempotencyService,
    // AB5 (AX7): B2B group price lists as a PRICE SOURCE.
    // LAST param + Optional, same discipline; absent keeps POS
    // exactly as before AB5.
    @Optional() private readonly priceLists?: PriceListsService,
  ) {}

  private t(name: string): any {
    return (this.prisma as any)[name];
  }

  // ---------- search ----------

  private stockState(product: any): string {
    if (product?.preorderEnabled) return "preorder";
    const stock = product?.stockQuantity;
    if (stock === null || stock === undefined) return "untracked";
    return Number(stock) > 0 ? "in_stock" : "out_of_stock";
  }

  private serializeVariant(v: any) {
    return {
      id: v.id,
      name: v.name,
      sku: v.sku ?? null,
      priceMinor: v.priceMinor !== null && v.priceMinor !== undefined ? String(v.priceMinor) : null,
      stockQuantity: v.stockQuantity ?? null,
    };
  }

  private serializeProduct(product: any, variants: any[]) {
    return {
      productId: product.id,
      name: product.name,
      sku: product.sku ?? null,
      barcode: product.barcode ?? null,
      imageUrl: product.imageUrl ?? null,
      priceMinor: String(product.priceMinor ?? 0n),
      stockQuantity: product.stockQuantity ?? null,
      stockState: this.stockState(product),
      preorderEnabled: !!product.preorderEnabled,
      variants: (variants ?? []).map((v: any) => this.serializeVariant(v)),
    };
  }

  private async variantsOf(productId: string): Promise<any[]> {
    const table = this.t("productVariant");
    if (!table?.findMany) return [];
    return (await table.findMany({ where: { productId } }).catch(() => [])) ?? [];
  }

  /**
   * Counter search: an exact sku/barcode hit (product or
   * variant) returns `exact` — the single addable line the UI
   * drops straight into the cart on Enter (the packing-scan
   * pattern). Otherwise up to 20 fuzzy name/sku/barcode matches.
   * Org-scoped + ACTIVE only, always.
   */
  async search(organizationId: string, rawQuery: string | undefined) {
    const q = String(rawQuery ?? "").trim();
    if (!q) return { exact: null, results: [] };

    // Exact product sku / barcode.
    let exactProduct: any = null;
    let exactVariant: any = null;
    exactProduct = await this.t("product").findFirst({
      where: { organizationId, status: "ACTIVE", OR: [{ sku: q }, { barcode: q }] },
    }).catch(() => null);

    if (!exactProduct) {
      // Exact variant sku — the variant's product rides along.
      const variantTable = this.t("productVariant");
      const variant = variantTable?.findFirst
        ? await variantTable.findFirst({
            where: { sku: q, product: { organizationId, status: "ACTIVE" } },
            include: { product: true },
          }).catch(() => null)
        : null;
      if (variant?.product) {
        exactVariant = variant;
        exactProduct = variant.product;
      }
    }

    if (exactProduct) {
      const variants = await this.variantsOf(exactProduct.id);
      const base = this.serializeProduct(exactProduct, variants);
      const unit = exactVariant?.priceMinor !== null && exactVariant?.priceMinor !== undefined
        ? BigInt(exactVariant.priceMinor)
        : BigInt(exactProduct.priceMinor ?? 0n);
      return {
        exact: {
          ...base,
          variantId: exactVariant?.id ?? null,
          variant: exactVariant ? this.serializeVariant(exactVariant) : null,
          unitPriceMinor: unit.toString(),
          effectiveStockQuantity: exactVariant
            ? (exactVariant.stockQuantity ?? null)
            : (exactProduct.stockQuantity ?? null),
        },
        results: [base],
      };
    }

    const rows = await this.t("product").findMany({
      where: {
        organizationId,
        status: "ACTIVE",
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { sku: { contains: q, mode: "insensitive" } },
          { barcode: { contains: q, mode: "insensitive" } },
        ],
      },
      take: 20,
      include: { variants: true },
    }).catch(() => []);
    return {
      exact: null,
      results: (rows ?? []).map((p: any) => this.serializeProduct(p, p.variants ?? [])),
    };
  }

  // ---------- sale ----------

  /** EC19 duplicate guard, POS edition: an already-APPROVED
   * verification carrying this TrxID anywhere in the org refuses
   * the sale (checked before placement — see the class doc). */
  private async assertNoDuplicateTrx(organizationId: string, reference: string) {
    const table = this.t("paymentVerification");
    if (!table?.findFirst && !table?.findMany) return;
    let duplicate: any = null;
    if (table.findFirst) {
      duplicate = await table.findFirst({
        where: { organizationId, trxId: reference, status: "approved" },
      }).catch(() => null);
    } else {
      const rows = (await table.findMany({ where: { organizationId } }).catch(() => [])) ?? [];
      duplicate = rows.find((r: any) => r.trxId === reference && r.status === "approved") ?? null;
    }
    if (duplicate) {
      throw new BadRequestException("This transaction reference has already been recorded as a verified payment");
    }
  }

  async createSale(
    organizationId: string,
    actorId: string,
    dto: CreatePosSaleDto,
    opts?: { forceStock?: boolean },
  ) {
    // AB4 (AX6): GB3 idempotency — a retry presenting a key that
    // already placed a sale replays the stored response as-is.
    // Keys are namespaced `pos:` because IdempotencyRecord's
    // unique is (org, key) ACROSS scopes.
    const idemKey = dto?.idempotencyKey && this.idempotency
      ? `pos:${dto.idempotencyKey}`
      : null;
    if (idemKey) {
      const replay = await this.idempotency!.findReplay(organizationId, idemKey).catch(() => null);
      if (replay != null) return replay;
    }
    if (!Array.isArray(dto?.items) || dto.items.length === 0) {
      throw new BadRequestException("কমপক্ষে একটি পণ্য যোগ করুন");
    }
    const mode = dto.payment?.mode;
    if (mode !== "paid" && mode !== "due") {
      throw new BadRequestException("পেমেন্টের ধরন পাঠান — paid (নগদ) অথবা due (বাকি)");
    }
    const method = dto.payment.method ?? "cash";
    const reference = dto.payment.reference?.trim() ? dto.payment.reference.trim() : null;

    // Aggregate duplicate (product, variant) lines BEFORE the
    // stock check — two lines of 3 against a stock of 5 must
    // refuse, not pass twice.
    const aggregated = new Map<string, { productId: string; variantId: string | null; quantity: number }>();
    for (const item of dto.items) {
      const quantity = Number(item?.quantity);
      if (!item?.productId || !Number.isInteger(quantity) || quantity <= 0) {
        throw new BadRequestException("প্রতিটি পণ্যের পরিমাণ ধনাত্মক সংখ্যা হতে হবে");
      }
      const key = `${item.productId}::${item.variantId ?? ""}`;
      const prev = aggregated.get(key);
      if (prev) prev.quantity += quantity;
      else aggregated.set(key, { productId: item.productId, variantId: item.variantId ?? null, quantity });
    }

    // Resolve every line server-side: product (org + ACTIVE),
    // variant (must belong to the product), DB unit price, and
    // the storefront's tracked-stock rule (variant stock wins;
    // null = untracked = no limit; preorder bypasses entirely).
    interface ResolvedLine {
      product: any; variant: any | null; quantity: number; unitPriceMinor: bigint;
    }
    const resolved: ResolvedLine[] = [];
    for (const line of aggregated.values()) {
      const product = await this.t("product").findFirst({
        where: { id: line.productId, organizationId, status: "ACTIVE" },
      });
      if (!product) throw new BadRequestException("পণ্যটি পাওয়া যায়নি বা বন্ধ আছে");
      let variant: any = null;
      if (line.variantId) {
        variant = await this.t("productVariant").findFirst({
          where: { id: line.variantId, productId: product.id },
        });
        if (!variant) throw new BadRequestException("ভ্যারিয়েন্টটি এই পণ্যের নয়");
      }
      // AB4 (AX6): opts.forceStock skips ONLY this per-line
      // quantity refusal (offline-sync repost with merchant
      // approval). Prices, the evaluator and the placement-time
      // stock DECREMENT are untouched — the overdraw is the
      // merchant's sanctioned choice, like a backorder.
      if (!product.preorderEnabled && !opts?.forceStock) {
        const stock = variant ? variant.stockQuantity : product.stockQuantity;
        if (stock !== null && stock !== undefined && line.quantity > Number(stock)) {
          throw new BadRequestException(
            `দুঃখিত, "${product.name}"-এর স্টকে মাত্র ${stock}টি আছে — এর বেশি অর্ডার করা যাবে না`,
          );
        }
      }
      const unitPriceMinor = variant?.priceMinor !== null && variant?.priceMinor !== undefined
        ? BigInt(variant.priceMinor)
        : BigInt(product.priceMinor ?? 0n);
      resolved.push({ product, variant, quantity: line.quantity, unitPriceMinor });
    }

    // Duplicate-TrxID guard BEFORE any write (paid mode only).
    if (mode === "paid" && reference) {
      await this.assertNoDuplicateTrx(organizationId, reference);
    }

    // The ONE pricing path. An invalid coupon throws the
    // evaluator's verbatim Bengali error here — before placement.
    const phone = dto.customerPhone?.trim() ? dto.customerPhone.trim() : null;
    const promoLines: PromotionLine[] = resolved.map((l) => ({
      productId: l.product.id,
      categoryId: l.product.categoryId ?? null,
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
      compareAtMinor: l.product.compareAtMinor ?? null,
    }));
    // GB7: with a phone, resolve the customer + prior count ONCE.
    // Walk-ins (no phone) share no verified identity — customerId
    // and priorOrderCount stay null, so customer-conditioned
    // coupons refuse (staff can add the customer's phone).
    let posCustomerId: string | null = null;
    let posPriorOrderCount: number | null = null;
    if (phone) {
      // Guards keep lightweight promotions stubs (older harnesses) working.
      posCustomerId =
        typeof (this.promotions as any).customerIdForPhone === "function"
          ? await this.promotions.customerIdForPhone(organizationId, phone)
          : null;
      posPriorOrderCount =
        typeof (this.promotions as any).priorOrderCountFor === "function"
          ? await this.promotions.priorOrderCountFor(organizationId, posCustomerId)
          : null;
    }
    // AB5 (AX7) PRICE SOURCE precedence: gift-card lines keep
    // face value → an explicit price-list price REPLACES the
    // catalog/variant price AND beats wholesale-tier math
    // (negotiated price is more specific than a quantity tier;
    // POS has no tier, the rule is stated for parity) → catalog
    // price otherwise. Applied BEFORE the evaluator runs, by
    // rewriting the resolved lines + their promo lines in place
    // (same order in both arrays). Walk-ins have no verified
    // identity, so no group prices — same basis as GB7 above.
    // Failure-isolated: no map ⇒ prices stay exactly as today.
    const priceListBreakdown: Array<{ productId: string; variantId: string | null; priceMinor: string }> = [];
    if (this.priceLists && posCustomerId) {
      const map = await this.priceLists
        .priceMapForCustomer(organizationId, posCustomerId)
        .catch(() => null);
      if (map) {
        for (let i = 0; i < resolved.length; i++) {
          const l = resolved[i];
          if ((l.product as any).isGiftCard) continue;
          const listPrice = pickGroupPrice(map, l.product.id, l.variant?.id ?? null);
          if (listPrice != null) {
            l.unitPriceMinor = listPrice;
            if (promoLines[i]) promoLines[i].unitPriceMinor = listPrice;
            priceListBreakdown.push({
              productId: l.product.id,
              variantId: l.variant?.id ?? null,
              priceMinor: listPrice.toString(),
            });
          }
        }
      }
    }
    // AB1 (AX1): loyalty snapshot for the phone-identified
    // customer (walk-ins share no verified identity, so no
    // snapshot and no redemption — same basis as GB7 above).
    let loyaltyInput: LoyaltyRedeemInput | null = null;
    if (this.loyalty && dto.loyaltyPoints != null && dto.loyaltyPoints > 0 && posCustomerId) {
      const snap = await this.loyalty
        .checkoutSnapshot(organizationId, posCustomerId)
        .catch(() => null);
      if (snap) loyaltyInput = { pointsToRedeem: dto.loyaltyPoints, ...snap };
    }
    // AB2 (AX3): gift-card redemption snapshot. A presented code
    // that cannot be redeemed REFUSES the sale here (the Bengali
    // BadRequest from resolveForCheckout propagates — before
    // placement, like an invalid coupon). Gift-card PRODUCT
    // sales need no intent code here: POS items already carry
    // productId, so the reconciler's fallback records them.
    let giftCardInput: { giftCardId: string; balanceMinor: bigint; codeLast4: string } | null = null;
    if (dto.giftCardCode?.trim()) {
      if (!this.giftCards) {
        throw new BadRequestException("গিফট কার্ড সুবিধা এই দোকানে নেই");
      }
      const cartHasGiftCardProduct = resolved.some((l) => !!l.product.isGiftCard);
      const snap = await this.giftCards.resolveForCheckout(organizationId, dto.giftCardCode, {
        cartHasGiftCardProduct,
      });
      giftCardInput = { giftCardId: snap.giftCardId, balanceMinor: snap.balanceMinor, codeLast4: snap.codeLast4 };
    }
    const ev = await this.promotions.evaluateCheckout(organizationId, {
      lines: promoLines,
      couponCode: dto.couponCode?.trim() ? dto.couponCode.trim() : null,
      buyerPhone: phone,
      customerId: posCustomerId,
      priorOrderCount: posPriorOrderCount,
      loyalty: loyaltyInput,
      giftCard: giftCardInput,
    });
    // EC23 total: subtotal − all discounts + tax ADDED (delivery 0).
    const subtotal = ev.subtotalMinor;
    const discount = ev.totalDiscountMinor;
    let total = subtotal - discount + ev.taxAddedMinor;
    if (total < 0n) total = 0n;

    const customer = phone
      ? { externalId: phone, firstName: dto.customerName?.trim() || phone, phone }
      : { externalId: "pos-walkin", firstName: "কাউন্টার ক্রেতা" };

    const externalId = `pos-${randomUUID()}`;
    const externalNumber = `ORD-${Date.now().toString().slice(-6)}-${randomBytes(2).toString("hex").toUpperCase()}`;
    await this.integrations.upsertOrder(organizationId, null, {
      externalId,
      externalNumber,
      status: "processing",
      paymentMethod: mode === "paid" ? method : "cod",
      isCod: mode !== "paid",
      currency: "BDT",
      subtotalMinor: subtotal,
      shippingMinor: 0n,
      discountMinor: discount,
      taxMinor: ev.taxMinor,
      totalMinor: total,
      refundedMinor: 0n,
      placedAt: new Date(),
      customer,
      items: resolved.map((l) => ({
        productId: l.product.id,
        name: l.variant ? `${l.product.name} — ${l.variant.name}` : l.product.name,
        // The variant sku rides the line so the S1 placement
        // hook resolves (and decrements) the VARIANT's stock,
        // exactly like the storefront's lines.
        sku: l.variant?.sku ?? l.product.sku ?? undefined,
        quantity: l.quantity,
        priceMinor: l.unitPriceMinor,
        totalMinor: l.unitPriceMinor * BigInt(l.quantity),
        isPreorder: !!l.product.preorderEnabled,
      })),
    } as any, "pos");

    const order = await this.t("order").findFirst({
      where: { organizationId, source: "pos", externalId },
    });
    if (!order) throw new NotFoundException("Order was recorded but could not be reloaded");

    // EC16 stamps (promotion/coupon/referral split + EC23 tax
    // breakdown) — failure-isolated inside stampOrder. Gift
    // fields stay untouched (giftOutcome unset — see class doc).
    await this.promotions.stampOrder(organizationId, "pos", externalId, ev);
    // AB5 (AX7): stamp the group price-list snapshot onto the
    // placed order (failure-isolated — the sale already stands).
    if (priceListBreakdown.length > 0) {
      try {
        await this.t("order").update({
          where: { id: order.id },
          data: { priceListBreakdown },
        });
      } catch (e) {
        this.logger.warn(`POS price list stamp failed for order ${order.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    // Coupon redemption AFTER placement, failure-isolated like
    // every other checkout path.
    if (ev.appliedDiscountId && this.discounts) {
      await this.discounts.redeem(organizationId, ev.appliedDiscountId).catch((e) => {
        this.logger.warn(`POS coupon redeem failed for discount ${ev.appliedDiscountId}: ${e instanceof Error ? e.message : String(e)}`);
      });
    }

    // AB1 (AX1): spend the redeemed points now that the order
    // exists (failure-isolated inside LoyaltyService).
    if ((ev.loyaltyPointsApplied ?? 0) > 0 && this.loyalty) {
      await this.loyalty.postPlacementRedeem(organizationId, {
        orderId: order.id,
        customerId: order.customerId ?? null,
        points: ev.loyaltyPointsApplied ?? 0,
      });
    }

    // AB2 (AX3): spend the redeemed gift-card balance now that
    // the order exists (failure-isolated inside GiftCardsService).
    if ((ev.giftCardDiscountMinor ?? 0n) > 0n && this.giftCards) {
      await this.giftCards.postPlacementRedeem(organizationId, {
        orderId: order.id,
        giftCardId: ev.giftCardId!,
        amountMinor: ev.giftCardDiscountMinor!,
      });
    }

    // A counter sale is fulfilled on the spot.
    await this.orders.updateOrder(organizationId, actorId, order.id, { status: "completed" });

    // Payment (see class doc for why this is NOT
    // recordAdvanceVerification): the EC19 shape, source "pos".
    // A fully discounted sale (total 0) records nothing — an
    // amount must be > 0 and there is nothing due either way.
    if (mode === "paid" && total > 0n) {
      await this.t("paymentVerification").create({
        data: {
          organizationId,
          orderId: order.id,
          conversationId: null,
          messageId: null,
          provider: method,
          trxId: reference,
          amountMinor: total,
          expectedAmountMinor: total,
          verdict: "matched",
          status: "approved",
          source: "pos",
          reviewedById: actorId,
          createdById: actorId,
          modelProvider: "manual_staff",
          note: null,
        },
      });
    }

    await this.audit?.log({
      organizationId, userId: actorId, action: "pos.sale_created",
      entityType: "Order", entityId: order.id,
      metadata: {
        orderId: order.id, totalMinor: total.toString(), mode,
        ...(opts?.forceStock ? { forced: true } : {}),
      },
    }).catch(() => undefined);

    const full: any = await this.orders.getOne(organizationId, order.id);
    const org = await this.t("organization").findFirst({ where: { id: organizationId } }).catch(() => null);
    const paidMinor = full?.advancePaidMinor ?? (mode === "paid" ? total.toString() : "0");
    const dueMinor = full?.amountDueMinor ?? (mode === "paid" ? "0" : total.toString());
    const result = {
      ...full,
      receipt: {
        shopName: org?.brandName || org?.name || null,
        orderNumber: order.externalNumber ?? externalNumber,
        lines: resolved.map((l) => ({
          name: l.variant ? `${l.product.name} — ${l.variant.name}` : l.product.name,
          quantity: l.quantity,
          unitPriceMinor: l.unitPriceMinor.toString(),
          totalMinor: (l.unitPriceMinor * BigInt(l.quantity)).toString(),
        })),
        subtotalMinor: subtotal.toString(),
        discountMinor: discount.toString(),
        // AB1 (AX1): the loyalty slice of the discount + the
        // points it spent (0 when no redemption happened).
        loyaltyDiscountMinor: (ev.loyaltyDiscountMinor ?? 0n).toString(),
        loyaltyPointsUsed: ev.loyaltyPointsApplied ?? 0,
        // AB2 (AX3): the gift-card slice of the discount, only
        // when a card was applied (last4 + amount only, never
        // the full code).
        ...(giftCardInput
          ? {
              giftCard: {
                codeLast4: giftCardInput.codeLast4,
                discountMinor: (ev.giftCardDiscountMinor ?? 0n).toString(),
              },
            }
          : {}),
        taxMinor: ev.taxMinor.toString(),
        taxAddedMinor: ev.taxAddedMinor.toString(),
        totalMinor: total.toString(),
        paidMinor: String(paidMinor),
        dueMinor: String(dueMinor),
        paymentMode: mode,
        paymentMethod: mode === "paid" ? method : null,
      },
    };
    // AB4 (AX6): store the response under the namespaced key —
    // record() returns the response the caller should return
    // (a concurrent winner's stored response wins the race).
    if (idemKey) {
      return this.idempotency!.record(organizationId, idemKey, "pos", order.id, result);
    }
    return result;
  }

  // ---------- today's sales ----------

  /** Today's POS orders on the Asia/Dhaka calendar day (the
   * lead-followups dhakaDayStartUtc helper — the same bounds the
   * rest of the product calls "today"). Due per order comes
   * from ONE batched approved-verification sum. */
  async today(organizationId: string) {
    const start = dhakaDayStartUtc(new Date());
    const end = new Date(start.getTime() + DAY_MS);
    const rows = (await this.t("order").findMany({
      where: { organizationId, source: "pos", createdAt: { gte: start, lt: end } },
      orderBy: { createdAt: "desc" },
      include: { items: true },
    }).catch(() => [])) ?? [];

    const paidByOrder = new Map<string, bigint>();
    if (rows.length > 0) {
      const pvTable = this.t("paymentVerification");
      const pvRows = pvTable?.findMany
        ? ((await pvTable.findMany({
            where: { organizationId, orderId: { in: rows.map((o: any) => o.id) }, status: "approved" },
          }).catch(() => [])) ?? [])
        : [];
      for (const row of pvRows) {
        if (row.amountMinor === null || row.amountMinor === undefined) continue;
        const key = String(row.orderId);
        let amount = 0n;
        try { amount = BigInt(row.amountMinor as any); } catch { amount = 0n; }
        paidByOrder.set(key, (paidByOrder.get(key) ?? 0n) + amount);
      }
    }

    let totalSales = 0n;
    const orders = rows.map((o: any) => {
      const totalMinor = BigInt(o.totalMinor ?? 0);
      totalSales += totalMinor;
      const paid = paidByOrder.get(String(o.id)) ?? 0n;
      const capped = paid > totalMinor ? totalMinor : paid;
      return {
        id: o.id,
        externalNumber: o.externalNumber ?? null,
        totalMinor: totalMinor.toString(),
        dueMinor: (totalMinor - capped).toString(),
        createdAt: o.createdAt,
        itemCount: (o.items ?? []).reduce((s: number, i: any) => s + Number(i.quantity ?? 0), 0),
      };
    });
    return { orders, totalSalesMinor: totalSales.toString(), orderCount: orders.length };
  }
}
