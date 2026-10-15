import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { PromotionsService, type CheckoutEvaluation } from "../commerce/promotions.service";
import { InventoryService } from "../inventory/inventory.service";
import { OrdersService } from "./orders.service";
import { StorefrontService } from "../storefront/storefront.service";
import { allocateBundle } from "../commerce/ec29-bundles";
import { serializeTaxBreakdown } from "../commerce/tax";
import { normalizeBdPhone } from "./phone-utils";
import type { EditOrderItemsDto, MergeOrdersDto, SplitOrderDto, SurgeryItemDto } from "./orders.dto";

/**
 * ON3 — Order Surgery: item edits (+ preview), split and merge
 * for orders that have not left the building yet.
 *
 * Ground rules (shared by all three operations):
 * - Money is BigInt minor units internally; strings at the edge.
 * - Line prices are PINNED: an edit never re-prices a line from
 *   the current catalog. PromotionsService.evaluateCheckout is
 *   re-run over the pinned prices (its prices are caller-passed),
 *   so promotion / coupon / referral / tax outcomes always match
 *   a fresh checkout of the same cart — the parity the specs pin.
 * - The evaluator's GIFT candidate is always ignored: surgery
 *   never adds or removes gift lines from a re-evaluation.
 * - Fulfillment coverage is computed directly from Prisma
 *   (fulfillment rows, non-cancelled, items Json quantities per
 *   orderItemId — the same math as
 *   FulfillmentService.remainingFor). FulfillmentService itself
 *   is NOT injected: FulfillmentModule imports OrdersModule, so
 *   importing it here would close a module cycle.
 */

const STORE_SOURCES = ["woocommerce", "shopify"];
const EDITABLE_STATUSES = ["pending", "on-hold", "processing"];
const SHIPMENT_BLOCKING_STATUSES = ["picked_up", "in_transit", "out_for_delivery", "delivered", "partial_delivered"];
const COUPON_ERROR_PREFIX = "কুপন প্রয়োগ করা যায়নি";

function bi(v: unknown): bigint {
  try { return BigInt((v ?? 0) as any); } catch { return 0n; }
}

export interface ResolvedLine {
  orderItemId: string | null;
  productId: string | null;
  variantSku: string | null;
  name: string;
  quantity: number;
  unitPriceMinor: bigint;
  isPreorder: boolean;
  isGift: boolean;
  bundleId: string | null;
  bundleName: string | null;
  product?: any;
}

export interface SurgeryTotals {
  lines: Array<ResolvedLine & { totalMinor: bigint }>;
  subtotalMinor: bigint;
  promotionDiscountMinor: bigint;
  promotionsApplied: CheckoutEvaluation["promotionsApplied"];
  couponMinor: bigint;
  couponDropped: boolean;
  couponPinnedMinor: bigint;
  appliedCouponCode: string | null;
  referralDiscountMinor: bigint;
  referralDropped: boolean;
  discountMinor: bigint;
  taxMinor: bigint;
  taxAddedMinor: bigint;
  taxBreakdown: CheckoutEvaluation["taxBreakdown"];
  shippingMinor: bigint;
  totalMinor: bigint;
  warnings: string[];
  ev: CheckoutEvaluation;
  couponEvaluated: boolean;
}

@Injectable()
export class OrderSurgeryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly promotions: PromotionsService,
    private readonly inventory: InventoryService,
    private readonly orders: OrdersService,
    @Optional() private readonly audit?: AuditService,
    // Used ONLY for the delivery recalc (matchZone +
    // resolveDeliveryCharge). Appended + @Optional like the
    // codebase pattern; absent → delivery is preserved with a
    // warning, never invented.
    @Optional() private readonly storefront?: StorefrontService,
  ) {}

  private t(name: string): any { return (this.prisma as any)[name]; }

  // ---------- shared stage guard ----------

  private async loadOrderOr404(orgId: string, orderId: string): Promise<any> {
    const order = await this.t("order").findFirst({
      where: { id: orderId, organizationId: orgId },
      include: { items: true, customer: true },
    });
    if (!order) throw new NotFoundException("Order not found in this organization");
    // Fake-Prisma / partial deployments may not honour include —
    // fall back to explicit loads so items/customer are real.
    if (!Array.isArray(order.items)) {
      order.items = await this.t("orderItem").findMany({ where: { orderId: order.id } }).catch(() => []);
    }
    if (order.customerId && !order.customer) {
      order.customer = await this.t("customer").findFirst({ where: { id: order.customerId, organizationId: orgId } }).catch(() => null);
    }
    return order;
  }

  /** Stage guard for item edits (also used by split/merge via
   * stageGuard). Returns soft warnings (e.g. an in_review
   * shipment whose label/manifest is now stale). */
  private async stageGuard(orgId: string, order: any): Promise<{ warnings: string[] }> {
    if (order.isPractice) throw new BadRequestException("প্র্যাকটিস অর্ডারে এই কাজ করা যাবে না");
    if (order.reviewHold) throw new BadRequestException("অর্ডারটি পর্যালোচনার জন্য আটকানো আছে — আগে হোল্ড ছাড়ুন");
    if (STORE_SOURCES.includes(String(order.source))) {
      throw new BadRequestException("স্টোরের অর্ডারের আইটেম এখান থেকে বদলানো যাবে না — স্টোরের হিসাবের সঙ্গে মিল থাকবে না");
    }
    if (!EDITABLE_STATUSES.includes(String(order.status))) {
      throw new BadRequestException(`এই অবস্থার অর্ডারে এই কাজ করা যাবে না (অবস্থা: ${order.status})`);
    }
    const warnings: string[] = [];
    const shipments = await this.shipmentsFor(orgId, order.id);
    for (const s of shipments) {
      if (SHIPMENT_BLOCKING_STATUSES.includes(String(s.status))) {
        throw new BadRequestException(`shipment ইতিমধ্যে কুরিয়ারের পথে (অবস্থা: ${s.status}) — এখন আইটেম বদলানো যাবে না`);
      }
      if (String(s.status) === "in_review") {
        warnings.push("courier লেবেল/manifest পুরনো হয়ে গেছে — shipment-এর তথ্য আবার যাচাই করুন");
      }
    }
    return { warnings };
  }

  private async shipmentsFor(orgId: string, orderId: string): Promise<any[]> {
    const table = this.t("courierShipment");
    if (!table?.findMany) return [];
    return (await table.findMany({ where: { organizationId: orgId, orderId } }).catch(() => [])) ?? [];
  }

  /** Fulfillment coverage per orderItemId from non-cancelled
   * fulfillments (same math as FulfillmentService.remainingFor,
   * computed from Prisma — see the class comment for why). */
  private async fulfillmentCoverage(orgId: string, orderId: string): Promise<Array<{ fulfillment: any; perItem: Map<string, number> }>> {
    const table = this.t("fulfillment");
    if (!table?.findMany) return [];
    const rows = (await table.findMany({ where: { organizationId: orgId, orderId } }).catch(() => [])) ?? [];
    const out: Array<{ fulfillment: any; perItem: Map<string, number> }> = [];
    for (const f of rows) {
      if (String(f.status) === "cancelled") continue;
      const perItem = new Map<string, number>();
      for (const line of (Array.isArray(f.items) ? f.items : []) as any[]) {
        if (!line?.orderItemId) continue;
        perItem.set(String(line.orderItemId), (perItem.get(String(line.orderItemId)) ?? 0) + Number(line.quantity ?? 0));
      }
      out.push({ fulfillment: f, perItem });
    }
    return out;
  }

  private coveredQty(coverage: Array<{ fulfillment: any; perItem: Map<string, number> }>, orderItemId: string): number {
    let q = 0;
    for (const c of coverage) q += c.perItem.get(orderItemId) ?? 0;
    return q;
  }

  // ---------- recompute core ----------

  /**
   * The ONE totals computation for surgery: preview, apply,
   * split (both sides) and merge all price through here.
   * `orderLike` carries the stored stamps the coupon/referral /
   * delivery rules read (discount split, referralCode,
   * couponCode, giftWrapMinor, shippingMinor, deliveryMethod,
   * customer phone/address).
   */
  private async computeSurgeryTotals(
    orgId: string,
    orderLike: any,
    resolved: ResolvedLine[],
    opts: { couponCode?: string | null; recalculateDelivery?: boolean } = {},
  ): Promise<SurgeryTotals> {
    const warnings: string[] = [];
    const lines = resolved.map((l) => ({ ...l, totalMinor: l.unitPriceMinor * BigInt(l.quantity) }));

    const catalogLines: any[] = [];
    let bumpMinor = 0n;
    const productById = new Map<string, any>();
    for (const l of lines) {
      if (l.isGift) continue;
      if (l.productId == null) { bumpMinor += l.totalMinor; continue; }
      let product = l.product ?? productById.get(l.productId);
      if (product === undefined) {
        product = await this.t("product").findFirst({ where: { id: l.productId, organizationId: orgId } }).catch(() => null);
        productById.set(l.productId, product);
      }
      catalogLines.push({
        productId: l.productId,
        categoryId: product?.categoryId ?? null,
        quantity: l.quantity,
        unitPriceMinor: l.unitPriceMinor,
        compareAtMinor: product?.compareAtMinor != null ? bi(product.compareAtMinor) : null,
      });
    }

    const derivedCoupon = (() => {
      const d = bi(orderLike.discountMinor) - bi(orderLike.promotionDiscountMinor) - bi(orderLike.referralDiscountMinor);
      return d > 0n ? d : 0n;
    })();

    const effectiveCode = opts.couponCode !== undefined ? opts.couponCode : (orderLike.couponCode ?? null);
    let ev: CheckoutEvaluation | null = null;
    let couponDropped = false;
    let couponPinnedMinor = 0n;
    let couponMinor = 0n;
    let appliedCouponCode: string | null = null;
    let couponEvaluated = false;

    const evalArgs = (couponCode: string | null) => ({
      lines: catalogLines,
      bumpMinor,
      couponCode,
      referralCode: orderLike.referralCode ?? null,
      buyerPhone: orderLike.customer?.phone ?? null,
    });

    if (effectiveCode) {
      try {
        ev = await this.promotions.evaluateCheckout(orgId, evalArgs(effectiveCode));
        couponEvaluated = true;
        couponMinor = ev.couponDiscountMinor;
        appliedCouponCode = ev.appliedCouponCode;
      } catch (e) {
        if (e instanceof BadRequestException && String((e as any).message ?? "").startsWith(COUPON_ERROR_PREFIX)) {
          // The stored/presented coupon no longer validates —
          // drop it (truthfully) instead of blocking the edit.
          ev = await this.promotions.evaluateCheckout(orgId, evalArgs(null));
          couponDropped = true;
          couponMinor = 0n;
          appliedCouponCode = null;
        } else {
          throw e;
        }
      }
    } else {
      ev = await this.promotions.evaluateCheckout(orgId, evalArgs(null));
      // Pinning applies only to the INHERITED case (no coupon
      // decision in the request and no stored code): an explicit
      // couponCode: null in the request is a deliberate drop,
      // never a pin.
      if (opts.couponCode === undefined && derivedCoupon > 0n) {
        // Legacy order: a coupon discount exists in the stored
        // split but no code was ever stored — pin the amount
        // (unverified) rather than silently erasing it.
        couponPinnedMinor = derivedCoupon;
        couponMinor = derivedCoupon;
        warnings.push(`অর্ডারে কুপন কোড সংরক্ষিত নেই — আগের কুপন ছাড় ৳${couponMinor.toString()} যাচাই ছাড়াই রাখা হয়েছে`);
      }
    }
    if (!ev) throw new BadRequestException("মূল্য হিসাব করা যায়নি");

    const referralDropped = bi(orderLike.referralDiscountMinor) > 0n && ev.referralDiscountMinor === 0n;

    // ---- delivery ----
    let shippingMinor = bi(orderLike.shippingMinor);
    if (opts.recalculateDelivery) {
      if (String(orderLike.deliveryMethod ?? "home") === "pickup") {
        // Pickup orders keep the point's own fee — no recalc.
      } else if (!this.storefront) {
        warnings.push("জেলা জানা নেই — ডেলিভারি চার্জ আগেরটাই রাখা হয়েছে");
      } else {
        const addr = orderLike.customer?.address;
        const district = addr && typeof addr === "object" ? (addr.district ?? null) : null;
        if (!district) {
          warnings.push("জেলা জানা নেই — ডেলিভারি চার্জ আগেরটাই রাখা হয়েছে");
        } else {
          const zone = await this.storefront.matchZone(orgId, String(district)).catch(() => null);
          if (!zone) {
            warnings.push("জেলা জানা নেই — ডেলিভারি চার্জ আগেরটাই রাখা হয়েছে");
          } else {
            // Weight semantics mirror cartWeightOf: unknown
            // (null) when ANY catalog product lacks weightGrams.
            let weightGrams: number | null = 0;
            for (const l of lines) {
              if (l.isGift || l.productId == null) continue;
              const product = l.product ?? productById.get(l.productId);
              if (!product || product.weightGrams == null) { weightGrams = null; break; }
              weightGrams = (weightGrams ?? 0) + Number(product.weightGrams) * l.quantity;
            }
            const discountedSubtotal = ev.subtotalMinor - (ev.promotionDiscountMinor + couponMinor + ev.referralDiscountMinor);
            const res = await this.storefront.resolveDeliveryCharge(orgId, zone, {
              weightGrams,
              discountedSubtotal,
            });
            shippingMinor = res.deliveryMinor;
            if (couponEvaluated && ev.couponFreeShipping) shippingMinor = 0n;
          }
        }
      }
    }

    const discountMinor = ev.promotionDiscountMinor + couponMinor + ev.referralDiscountMinor;
    const totalMinor = ev.subtotalMinor - discountMinor + shippingMinor + ev.taxAddedMinor + bi(orderLike.giftWrapMinor);

    return {
      lines,
      subtotalMinor: ev.subtotalMinor,
      promotionDiscountMinor: ev.promotionDiscountMinor,
      promotionsApplied: ev.promotionsApplied,
      couponMinor,
      couponDropped,
      couponPinnedMinor,
      appliedCouponCode,
      referralDiscountMinor: ev.referralDiscountMinor,
      referralDropped,
      discountMinor,
      taxMinor: ev.taxMinor,
      taxAddedMinor: ev.taxAddedMinor,
      taxBreakdown: ev.taxBreakdown,
      shippingMinor,
      totalMinor,
      warnings,
      ev,
      couponEvaluated,
    };
  }

  private serializeTotals(t: SurgeryTotals) {
    return {
      lines: t.lines.map((l) => ({
        orderItemId: l.orderItemId,
        productId: l.productId,
        sku: l.variantSku,
        name: l.name,
        quantity: l.quantity,
        unitPriceMinor: l.unitPriceMinor.toString(),
        totalMinor: l.totalMinor.toString(),
        isPreorder: l.isPreorder,
        isGift: l.isGift,
        bundleId: l.bundleId,
        bundleName: l.bundleName,
      })),
      subtotalMinor: t.subtotalMinor.toString(),
      promotionDiscountMinor: t.promotionDiscountMinor.toString(),
      promotionsApplied: t.promotionsApplied.map((p) => ({ promotionId: p.promotionId, name: p.name, type: p.type, amountMinor: p.amountMinor.toString() })),
      couponMinor: t.couponMinor.toString(),
      couponDropped: t.couponDropped,
      couponPinnedMinor: t.couponPinnedMinor.toString(),
      appliedCouponCode: t.appliedCouponCode,
      referralDiscountMinor: t.referralDiscountMinor.toString(),
      referralDropped: t.referralDropped,
      discountMinor: t.discountMinor.toString(),
      taxMinor: t.taxMinor.toString(),
      taxAddedMinor: t.taxAddedMinor.toString(),
      taxBreakdown: (t.taxBreakdown ?? []).map((b) => ({ rateBps: b.rateBps, taxableMinor: b.taxableMinor.toString(), taxMinor: b.taxMinor.toString() })),
      shippingMinor: t.shippingMinor.toString(),
      totalMinor: t.totalMinor.toString(),
      warnings: t.warnings,
    };
  }

  // ---------- line resolution (PATCH items / preview) ----------

  private async resolveDesiredLines(
    orgId: string,
    order: any,
    dto: EditOrderItemsDto,
  ): Promise<{ resolved: ResolvedLine[]; priceOverrides: number; diff: { added: any[]; removed: any[]; changed: any[] } }> {
    const items: SurgeryItemDto[] = Array.isArray(dto.items) ? dto.items : [];
    const existing: any[] = order.items ?? [];
    const byId = new Map(existing.map((i: any) => [String(i.id), i]));
    const seenItemIds = new Set<string>();
    const addressed = new Set<string>();
    const bundleGroups = new Map<string, any[]>();
    for (const line of existing) {
      if (line.bundleId) {
        const g = bundleGroups.get(String(line.bundleId)) ?? [];
        g.push(line);
        bundleGroups.set(String(line.bundleId), g);
      }
    }
    const addressedBundles = new Set<string>();
    const resolved: ResolvedLine[] = [];
    let priceOverrides = 0;
    const diffAdded: any[] = [];
    const diffChanged: any[] = [];
    const diffRemovedExplicit: any[] = [];

    const parseOverride = (raw?: string): bigint | null => {
      if (raw === undefined || raw === null) return null;
      try { return BigInt(String(raw)); } catch { throw new BadRequestException("unitPriceMinor সঠিক সংখ্যায় পাঠান (পয়সায়)"); }
    };

    for (const entry of items) {
      const qty = Number(entry.quantity);
      if (!Number.isInteger(qty) || qty < 0) throw new BadRequestException("আইটেমের পরিমাণ সঠিক পূর্ণসংখ্যা হতে হবে");

      // ---- bundle-group entry ----
      if (entry.bundleId) {
        if (qty < 1) throw new BadRequestException("বান্ডেলের পরিমাণ কমপক্ষে ১ হতে হবে — বান্ডেল সরাতে চাইলে গ্রুপটি বাদ দিন");
        const group = bundleGroups.get(String(entry.bundleId));
        if (!group || group.length === 0) throw new BadRequestException("এই অর্ডারে বান্ডেল গ্রুপটি পাওয়া যায়নি");
        if (addressedBundles.has(String(entry.bundleId))) throw new BadRequestException("একই বান্ডেল গ্রুপ দুবার দেওয়া হয়েছে");
        addressedBundles.add(String(entry.bundleId));
        const bundle = await this.t("bundle").findFirst({ where: { id: String(entry.bundleId), organizationId: orgId } }).catch(() => null);
        if (!bundle || bundle.active === false) {
          throw new BadRequestException("বান্ডেলটি আর পাওয়া যাচ্ছে না — component লাইনগুলো সরাসরি বদলানো যাবে না");
        }
        const bundleItems: any[] = Array.isArray(bundle.items) ? bundle.items : [];
        const first = group[0];
        const firstDef = bundleItems.find((b: any) => String(b.productId) === String(first.productId) && (b.variantSku ?? null) === (first.sku ?? null))
          ?? bundleItems.find((b: any) => String(b.productId) === String(first.productId));
        if (!firstDef || !Number(firstDef.qty)) throw new BadRequestException("বান্ডেলের সংজ্ঞা বদলে গেছে — component লাইনগুলো সরাসরি বদলানো যাবে না");
        if (Number(first.quantity) % Number(firstDef.qty) !== 0) {
          throw new BadRequestException("বান্ডেলের সংজ্ঞা বদলে গেছে — component লাইনগুলো সরাসরি বদলানো যাবে না");
        }
        const currentBundleQty = Number(first.quantity) / Number(firstDef.qty);
        if (!Number.isInteger(currentBundleQty) || currentBundleQty < 1) {
          throw new BadRequestException("বান্ডেলের সংজ্ঞা বদলে গেছে — component লাইনগুলো সরাসরি বদলানো যাবে না");
        }
        // EC29 identity: stored component totals sum EXACTLY to
        // bundlePrice × bundleQty, so the implied per-set price
        // is an exact integer division.
        const storedSum = group.reduce((s: bigint, l: any) => s + bi(l.totalMinor), 0n);
        if (storedSum % BigInt(currentBundleQty) !== 0n) {
          throw new BadRequestException("বান্ডেলের সংজ্ঞা বদলে গেছে — component লাইনগুলো সরাসরি বদলানো যাবে না");
        }
        const impliedPrice = storedSum / BigInt(currentBundleQty);
        // Re-allocate over the components SCALED to the new
        // bundle quantity, exactly as EC29 allocates a fresh
        // set: allocateBundle(impliedPrice × newQty, scaled
        // components) — its allocated totals sum EXACTLY to
        // impliedPrice × newQty, and each line's new unit price
        // is the allocation's per-unit output. Regular weights
        // resolve from CURRENT product/variant rows (the
        // BundlesService.resolveComponents rule); a component
        // whose product is gone falls back to its stored
        // per-unit allocated price as the weight.
        const scaledComps: Array<{ line: any; defQty: number; regularUnitMinor: bigint }> = [];
        for (const l of group as any[]) {
          const def = bundleItems.find((b: any) => String(b.productId) === String(l.productId) && (b.variantSku ?? null) === (l.sku ?? null))
            ?? bundleItems.find((b: any) => String(b.productId) === String(l.productId));
          if (!def) throw new BadRequestException("বান্ডেলের সংজ্ঞা বদলে গেছে — component লাইনগুলো সরাসরি বদলানো যাবে না");
          const product = await this.t("product").findFirst({ where: { id: l.productId, organizationId: orgId } }).catch(() => null);
          let variant: any = null;
          if (def.variantSku) {
            variant = await this.t("productVariant").findFirst({ where: { productId: l.productId, sku: def.variantSku } }).catch(() => null);
          }
          const regularUnitMinor = variant?.priceMinor != null
            ? bi(variant.priceMinor)
            : product?.priceMinor != null
              ? bi(product.priceMinor)
              : (Number(l.quantity) > 0 ? bi(l.totalMinor) / BigInt(Number(l.quantity)) : 0n);
          scaledComps.push({ line: l, defQty: Number(def.qty), regularUnitMinor });
        }
        const allocs = allocateBundle(
          impliedPrice * BigInt(qty),
          scaledComps.map(({ defQty, regularUnitMinor }) => ({ qty: defQty * qty, regularUnitMinor })),
        );
        for (let i = 0; i < scaledComps.length; i++) {
          const { line, defQty } = scaledComps[i];
          addressed.add(String(line.id));
          const newQty = defQty * qty;
          resolved.push({
            orderItemId: String(line.id),
            productId: line.productId ?? null,
            variantSku: line.sku ?? null,
            name: line.name,
            quantity: newQty,
            unitPriceMinor: allocs[i].allocatedUnitMinor,
            isPreorder: !!line.isPreorder,
            isGift: !!line.isGift,
            bundleId: line.bundleId ?? null,
            bundleName: line.bundleName ?? null,
          });
          if (newQty !== Number(line.quantity)) {
            diffChanged.push({ orderItemId: String(line.id), from: Number(line.quantity), to: newQty });
          }
        }
        continue;
      }

      // ---- existing-line entry ----
      if (entry.orderItemId) {
        const id = String(entry.orderItemId);
        if (seenItemIds.has(id)) throw new BadRequestException("একই আইটেম দুবার দেওয়া হয়েছে");
        seenItemIds.add(id);
        const line = byId.get(id);
        if (!line) throw new BadRequestException(`অর্ডারে এই আইটেমটি নেই: ${id}`);
        if (line.bundleId) throw new BadRequestException("বান্ডেলের অংশ সরাসরি বদলানো যাবে না — বান্ডেলের পরিমাণ বদলান");
        addressed.add(id);
        if (qty === 0) {
          // Explicit removal (quantity 0) — recorded in the
          // removed diff even though the line was addressed.
          diffRemovedExplicit.push({ orderItemId: id, qty: Number(line.quantity) });
          continue;
        }
        if (line.isGift && qty !== Number(line.quantity)) {
          throw new BadRequestException("উপহার লাইনের পরিমাণ বদলানো যাবে না — সরাতে চাইলে লাইনটি বাদ দিন");
        }
        let unit = bi(line.priceMinor);
        const override = parseOverride(entry.unitPriceMinor);
        if (override !== null) {
          if (line.isGift) throw new BadRequestException("উপহার লাইনের দাম বদলানো যাবে না");
          if (override !== unit) { unit = override; priceOverrides++; }
        }
        resolved.push({
          orderItemId: id,
          productId: line.productId ?? null,
          variantSku: line.sku ?? null,
          name: line.name,
          quantity: qty,
          unitPriceMinor: unit,
          isPreorder: !!line.isPreorder,
          isGift: !!line.isGift,
          bundleId: null,
          bundleName: null,
        });
        if (qty !== Number(line.quantity) || override !== null) {
          diffChanged.push({ orderItemId: id, from: Number(line.quantity), to: qty });
        }
        continue;
      }

      // ---- NEW line ----
      if (!entry.productId) throw new BadRequestException("নতুন আইটেমের জন্য productId আবশ্যক");
      if (qty < 1) throw new BadRequestException("নতুন আইটেমের পরিমাণ কমপক্ষে ১ হতে হবে");
      const product = await this.t("product").findFirst({ where: { id: String(entry.productId), organizationId: orgId } }).catch(() => null);
      if (!product) throw new BadRequestException(`পণ্য পাওয়া যায়নি (এই সংস্থার নয়): ${entry.productId}`);
      if (String(product.status) !== "ACTIVE") throw new BadRequestException(`পণ্যটি সক্রিয় নয়: ${product.name ?? entry.productId}`);
      let variant: any = null;
      if (entry.variantId) {
        variant = await this.t("productVariant").findFirst({ where: { id: String(entry.variantId), productId: product.id } }).catch(() => null);
        if (!variant) throw new BadRequestException("ভ্যারিয়েন্টটি এই পণ্যের নয়");
      }
      const override = parseOverride(entry.unitPriceMinor);
      const unit = override ?? (variant?.priceMinor != null ? bi(variant.priceMinor) : bi(product.priceMinor));
      if (override !== null) priceOverrides++;
      resolved.push({
        orderItemId: null,
        productId: product.id,
        variantSku: variant?.sku ?? product.sku ?? null,
        name: product.name,
        quantity: qty,
        unitPriceMinor: unit,
        isPreorder: !!product.preorderEnabled,
        isGift: false,
        bundleId: null,
        bundleName: null,
        product,
      });
      diffAdded.push({ productId: product.id, qty });
    }

    // Bundle groups addressed piecemeal: any component addressed
    // individually was already refused above (bundleId check);
    // a group NOT addressed by a bundleId entry is removed whole
    // (its lines simply stay unaddressed → removed below).

    const diffRemoved: any[] = [...diffRemovedExplicit];
    for (const line of existing) {
      if (!addressed.has(String(line.id))) {
        diffRemoved.push({ orderItemId: String(line.id), qty: Number(line.quantity) });
      }
    }

    if (!resolved.some((l) => !l.isGift)) {
      throw new BadRequestException("অর্ডারে অন্তত একটি আইটেম থাকতে হবে");
    }
    return { resolved, priceOverrides, diff: { added: diffAdded, removed: diffRemoved, changed: diffChanged } };
  }

  private assertFulfillmentForEdit(
    coverage: Array<{ fulfillment: any; perItem: Map<string, number> }>,
    order: any,
    resolved: ResolvedLine[],
  ) {
    const newQtyById = new Map<string, number>();
    for (const l of resolved) if (l.orderItemId) newQtyById.set(l.orderItemId, l.quantity);
    for (const line of order.items ?? []) {
      const id = String(line.id);
      const covered = this.coveredQty(coverage, id);
      if (covered <= 0) continue;
      const isChangedOrRemoved = !newQtyById.has(id) || newQtyById.get(id) !== Number(line.quantity);
      if (!isChangedOrRemoved) continue;
      for (const c of coverage) {
        const q = c.perItem.get(id) ?? 0;
        if (q > 0 && String(c.fulfillment.status) !== "pending") {
          throw new BadRequestException(`এই আইটেমটি ইতিমধ্যে ফুলফিলমেন্টে (${c.fulfillment.status}) আছে — আগে ফুলফিলমেন্ট বাতিল করুন`);
        }
      }
      const newQty = newQtyById.get(id) ?? 0;
      if (covered > newQty) {
        throw new BadRequestException("আইটেমের পরিমাণ প্যাক করা পরিমাণের কম করা যাবে না");
      }
    }
  }

  // ---------- shared write helpers ----------

  private async replaceItems(orderId: string, lines: Array<ResolvedLine & { totalMinor: bigint }>) {
    await this.t("orderItem").deleteMany({ where: { orderId } });
    for (const l of lines) {
      await this.t("orderItem").create({
        data: {
          orderId,
          productId: l.productId,
          sku: l.variantSku,
          name: l.name,
          quantity: l.quantity,
          priceMinor: l.unitPriceMinor,
          totalMinor: l.totalMinor,
          isPreorder: l.isPreorder,
          isGift: l.isGift,
          bundleId: l.bundleId,
          bundleName: l.bundleName,
        },
      });
    }
  }

  private async writeTotals(orderId: string, totals: SurgeryTotals, couponCodeValue: string | null) {
    await this.t("order").update({
      where: { id: orderId },
      data: {
        subtotalMinor: totals.subtotalMinor,
        shippingMinor: totals.shippingMinor,
        discountMinor: totals.discountMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
        couponCode: couponCodeValue,
      },
    });
  }

  private async stampFailureIsolated(orgId: string, order: any, totals: SurgeryTotals) {
    try {
      await this.promotions.stampOrder(orgId, String(order.source), String(order.externalId), totals.ev);
    } catch { /* stampOrder is itself failure-isolated; belt + braces */ }
  }

  private stockDeltas(oldLines: any[], newLines: ResolvedLine[]): Array<{ productId: string | null; sku?: string | null; deltaQty: number; isPreorder?: boolean }> {
    const agg = new Map<string, { productId: string | null; sku: string | null; deltaQty: number; isPreorder: boolean }>();
    const keyOf = (productId: any, sku: any) => `${productId ?? ""}::${sku ?? ""}`;
    for (const l of oldLines ?? []) {
      const k = keyOf(l.productId, l.sku);
      const e = agg.get(k) ?? { productId: l.productId ?? null, sku: l.sku ?? null, deltaQty: 0, isPreorder: !!l.isPreorder };
      e.deltaQty -= Number(l.quantity ?? 0);
      agg.set(k, e);
    }
    for (const l of newLines ?? []) {
      const k = keyOf(l.productId, l.variantSku);
      const e = agg.get(k) ?? { productId: l.productId ?? null, sku: l.variantSku ?? null, deltaQty: 0, isPreorder: !!l.isPreorder };
      e.deltaQty += Number(l.quantity ?? 0);
      if (l.isPreorder) e.isPreorder = true;
      agg.set(k, e);
    }
    return [...agg.values()].filter((e) => e.deltaQty !== 0);
  }

  private async approvedSum(orgId: string, orderId: string): Promise<bigint> {
    const table = this.t("paymentVerification");
    if (!table?.findMany) return 0n;
    const rows = (await table.findMany({ where: { organizationId: orgId, orderId } }).catch(() => [])) ?? [];
    let sum = 0n;
    for (const r of rows) {
      if (String(r.status) !== "approved") continue;
      if (r.amountMinor === null || r.amountMinor === undefined) continue;
      try { sum += BigInt(r.amountMinor as any); } catch { /* unparseable counts 0 */ }
    }
    return sum;
  }

  private async overpaidMinor(orgId: string, orderId: string, newTotal: bigint): Promise<bigint> {
    const paid = await this.approvedSum(orgId, orderId);
    return paid > newTotal ? paid - newTotal : 0n;
  }

  // ---------- PATCH items + preview ----------

  async previewItems(orgId: string, orderId: string, dto: EditOrderItemsDto) {
    const order = await this.loadOrderOr404(orgId, orderId);
    const { warnings } = await this.stageGuard(orgId, order);
    const { resolved } = await this.resolveDesiredLines(orgId, order, dto);
    const totals = await this.computeSurgeryTotals(orgId, order, resolved, {
      couponCode: dto.couponCode,
      recalculateDelivery: dto.recalculateDelivery,
    });
    const out = this.serializeTotals(totals);
    out.warnings = [...warnings, ...totals.warnings];
    return out;
  }

  async editItems(orgId: string, actorId: string, orderId: string, dto: EditOrderItemsDto) {
    const order = await this.loadOrderOr404(orgId, orderId);
    const { warnings: stageWarnings } = await this.stageGuard(orgId, order);
    const { resolved, priceOverrides, diff } = await this.resolveDesiredLines(orgId, order, dto);
    const coverage = await this.fulfillmentCoverage(orgId, order.id);
    this.assertFulfillmentForEdit(coverage, order, resolved);

    const totalsBefore = {
      subtotal: bi(order.subtotalMinor).toString(),
      discount: bi(order.discountMinor).toString(),
      total: bi(order.totalMinor).toString(),
    };
    const totals = await this.computeSurgeryTotals(orgId, order, resolved, {
      couponCode: dto.couponCode,
      recalculateDelivery: dto.recalculateDelivery,
    });

    const oldLines = [...(order.items ?? [])];
    await this.replaceItems(order.id, totals.lines);
    // couponCode written by surgery itself: the applied code, or
    // null when dropped / none / pinned (pinned = code unknown).
    await this.writeTotals(order.id, totals, totals.appliedCouponCode ?? null);
    await this.stampFailureIsolated(orgId, order, totals);

    const stockDelta = await this.inventory.applyOrderEditDelta(
      orgId, order.id, this.stockDeltas(oldLines, totals.lines),
    );

    const warnings = [...stageWarnings, ...totals.warnings];
    if (order.storeDraftId || order.storeInvoiceUrl) {
      warnings.push("এই অর্ডারের স্টোর ড্রাফটটি এখন পুরনো — ড্রাফটের হিসাব এই বদলের সঙ্গে মিলবে না");
    }

    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "order.items_edited",
      entityType: "Order", entityId: order.id,
      metadata: {
        added: diff.added, removed: diff.removed, changed: diff.changed,
        priceOverrides,
        totalsBefore,
        totalsAfter: {
          subtotal: totals.subtotalMinor.toString(),
          discount: totals.discountMinor.toString(),
          total: totals.totalMinor.toString(),
        },
        couponDropped: totals.couponDropped,
        couponPinned: totals.couponPinnedMinor > 0n,
      },
    }).catch(() => undefined);

    const refreshed = await this.orders.getOne(orgId, order.id);
    const overpaid = await this.overpaidMinor(orgId, order.id, totals.totalMinor);
    return {
      order: refreshed,
      couponDropped: totals.couponDropped,
      couponPinnedMinor: totals.couponPinnedMinor.toString(),
      referralDropped: totals.referralDropped,
      warnings,
      overpaidMinor: overpaid.toString(),
      stockDelta,
    };
  }

  // ---------- split ----------

  async split(orgId: string, actorId: string, orderId: string, dto: SplitOrderDto) {
    const order = await this.loadOrderOr404(orgId, orderId);
    const { warnings: stageWarnings } = await this.stageGuard(orgId, order);
    const shipments = await this.shipmentsFor(orgId, order.id);
    if (shipments.some((s: any) => String(s.status) !== "cancelled")) {
      throw new BadRequestException("shipment বুক হয়ে থাকলে split করা যাবে না");
    }
    const moveLines: Array<{ orderItemId: string; quantity: number }> = Array.isArray(dto.lines) ? dto.lines : [];
    if (moveLines.length === 0) throw new BadRequestException("split করতে অন্তত একটি আইটেম দিন");
    const byId = new Map<string, any>((order.items ?? []).map((i: any) => [String(i.id), i] as [string, any]));
    const seen = new Set<string>();
    const movedExisting: Array<{ line: any; quantity: number }> = [];
    for (const m of moveLines) {
      const id = String(m.orderItemId);
      if (seen.has(id)) throw new BadRequestException("একই আইটেম দুবার দেওয়া হয়েছে");
      seen.add(id);
      const line = byId.get(id);
      if (!line) throw new BadRequestException(`অর্ডারে এই আইটেমটি নেই: ${id}`);
      if (line.isGift) throw new BadRequestException("উপহার লাইন split করা যাবে না");
      const q = Number(m.quantity);
      if (!Number.isInteger(q) || q < 1 || q > Number(line.quantity)) {
        throw new BadRequestException("split-এর পরিমাণ লাইনের পরিমাণের বেশি হতে পারবে না");
      }
      movedExisting.push({ line, quantity: q });
    }
    // Bundle groups move whole or not at all.
    const movedIds = new Set(movedExisting.map((m) => String(m.line.id)));
    const bundleGroups = new Map<string, any[]>();
    for (const line of order.items ?? []) {
      if (line.bundleId) {
        const g = bundleGroups.get(String(line.bundleId)) ?? [];
        g.push(line);
        bundleGroups.set(String(line.bundleId), g);
      }
    }
    for (const [bundleId, group] of bundleGroups) {
      const inMove = group.filter((l: any) => movedIds.has(String(l.id)));
      if (inMove.length === 0) continue;
      const whole = inMove.length === group.length
        && group.every((l: any) => {
          const m = movedExisting.find((x) => String(x.line.id) === String(l.id));
          return m && m.quantity === Number(l.quantity);
        });
      if (!whole) throw new BadRequestException("বান্ডেল আংশিকভাবে split করা যাবে না");
      void bundleId;
    }
    // Any fulfillment coverage of a moved line blocks the split.
    const coverage = await this.fulfillmentCoverage(orgId, order.id);
    for (const m of movedExisting) {
      if (this.coveredQty(coverage, String(m.line.id)) > 0) {
        throw new BadRequestException("ফুলফিলমেন্টে থাকা আইটেম split করা যাবে না");
      }
    }
    // Something must remain on the original.
    const remainingLines: ResolvedLine[] = [];
    for (const line of order.items ?? []) {
      const m = movedExisting.find((x) => String(x.line.id) === String(line.id));
      const remainQty = Number(line.quantity) - (m?.quantity ?? 0);
      if (remainQty > 0) {
        remainingLines.push({
          orderItemId: String(line.id), productId: line.productId ?? null, variantSku: line.sku ?? null,
          name: line.name, quantity: remainQty, unitPriceMinor: bi(line.priceMinor),
          isPreorder: !!line.isPreorder, isGift: !!line.isGift,
          bundleId: line.bundleId ?? null, bundleName: line.bundleName ?? null,
        });
      }
    }
    if (remainingLines.length === 0) {
      throw new BadRequestException("সব আইটেম সরিয়ে নিলে split নয় — অন্তত একটি আইটেম মূল অর্ডারে রাখুন");
    }
    const movedResolved: ResolvedLine[] = movedExisting.map(({ line, quantity }) => ({
      orderItemId: String(line.id), productId: line.productId ?? null, variantSku: line.sku ?? null,
      name: line.name, quantity, unitPriceMinor: bi(line.priceMinor),
      isPreorder: !!line.isPreorder, isGift: !!line.isGift,
      bundleId: line.bundleId ?? null, bundleName: line.bundleName ?? null,
    }));

    let childShipping = 0n;
    if (dto.deliveryChargeMinor !== undefined && dto.deliveryChargeMinor !== null) {
      try { childShipping = BigInt(String(dto.deliveryChargeMinor)); } catch { throw new BadRequestException("deliveryChargeMinor সঠিক সংখ্যায় পাঠান (পয়সায়)"); }
    }

    // Child totals: a FRESH evaluation context — no coupon, no
    // referral carried over (promotions DO re-evaluate on the
    // moved cart; documented ON3 behaviour).
    const childPseudoOrder = {
      discountMinor: 0n, promotionDiscountMinor: 0n, referralDiscountMinor: 0n,
      referralCode: null, couponCode: null, giftWrapMinor: 0n,
      shippingMinor: childShipping, deliveryMethod: "home",
      customer: order.customer ?? null,
    };
    const childTotals = await this.computeSurgeryTotals(orgId, childPseudoOrder, movedResolved, { couponCode: null });
    const originalTotals = await this.computeSurgeryTotals(orgId, order, remainingLines, {});

    // Create the child DIRECTLY in Prisma — upsertOrder would
    // double-decrement stock and fire order.ingested/workflows.
    const externalId = `split-${randomUUID()}`;
    const externalNumber = `ORD-${Date.now().toString().slice(-6)}-${randomBytes(2).toString("hex").toUpperCase()}`;
    const child = await this.t("order").create({
      data: {
        organizationId: orgId,
        source: order.source,
        externalId,
        externalNumber,
        customerId: order.customerId ?? null,
        status: order.status,
        paymentMethod: order.paymentMethod ?? null,
        isCod: !!order.isCod,
        currency: order.currency ?? "BDT",
        subtotalMinor: childTotals.subtotalMinor,
        shippingMinor: childTotals.shippingMinor,
        discountMinor: childTotals.discountMinor,
        taxMinor: childTotals.taxMinor,
        taxBreakdown: childTotals.taxBreakdown && childTotals.taxBreakdown.length > 0 ? serializeTaxBreakdown(childTotals.taxBreakdown) : null,
        totalMinor: childTotals.totalMinor,
        refundedMinor: 0n,
        promotionDiscountMinor: childTotals.promotionDiscountMinor,
        referralDiscountMinor: childTotals.referralDiscountMinor,
        placedAt: new Date(),
        address: order.address ?? null,
        splitFromId: order.id,
        storeId: null,
      },
    });
    const childId = String(child.id);
    for (const l of childTotals.lines) {
      await this.t("orderItem").create({
        data: {
          orderId: childId, productId: l.productId, sku: l.variantSku, name: l.name,
          quantity: l.quantity, priceMinor: l.unitPriceMinor, totalMinor: l.totalMinor,
          isPreorder: l.isPreorder, isGift: l.isGift, bundleId: l.bundleId, bundleName: l.bundleName,
        },
      });
    }
    await this.stampFailureIsolated(orgId, { source: order.source, externalId }, childTotals);

    // Rewrite the original's items + totals.
    await this.replaceItems(order.id, originalTotals.lines);
    await this.writeTotals(order.id, originalTotals, originalTotals.appliedCouponCode ?? null);
    await this.stampFailureIsolated(orgId, order, originalTotals);

    // Ledger-only stock transfer — balances unchanged.
    await this.inventory.recordStockTransfer(
      orgId, order.id, childId,
      movedResolved.map((l) => ({ productId: l.productId, sku: l.variantSku, quantity: l.quantity, isPreorder: l.isPreorder })),
    );

    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "order.split_out",
      entityType: "Order", entityId: order.id,
      metadata: { childOrderId: childId, movedLines: movedResolved.length, childTotal: childTotals.totalMinor.toString() },
    }).catch(() => undefined);
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "order.split_in",
      entityType: "Order", entityId: childId,
      metadata: { parentOrderId: order.id },
    }).catch(() => undefined);

    void stageWarnings;
    return {
      original: await this.orders.getOne(orgId, order.id),
      created: await this.orders.getOne(orgId, childId),
      movedDeliveryMinor: childTotals.shippingMinor.toString(),
      verificationsStayedOnOriginal: true,
    };
  }

  // ---------- merge ----------

  async merge(orgId: string, actorId: string, survivorId: string, dto: MergeOrdersDto) {
    const rawIds = Array.isArray(dto.orderIds) ? dto.orderIds.map((x) => String(x)) : [];
    const ids = [...new Set(rawIds)];
    if (ids.length < 2 || ids.length > 5) throw new BadRequestException("মার্জ করতে ২–৫টি অর্ডার দিন");
    if (!ids.includes(survivorId)) throw new BadRequestException("survivor অর্ডারটি orderIds-এর মধ্যে থাকতে হবে");

    const participants: any[] = [];
    for (const id of ids) {
      const o = await this.loadOrderOr404(orgId, id);
      await this.stageGuard(orgId, o);
      if ((o as any).mergedIntoId) throw new BadRequestException(`অর্ডার ${o.externalNumber ?? o.externalId} ইতিমধ্যে অন্য অর্ডারে মার্জ হয়ে গেছে`);
      const shipments = await this.shipmentsFor(orgId, o.id);
      if (shipments.some((s: any) => String(s.status) !== "cancelled")) {
        throw new BadRequestException(`অর্ডার ${o.externalNumber ?? o.externalId}-এর shipment বুক হয়ে আছে — মার্জ করা যাবে না`);
      }
      const coverage = await this.fulfillmentCoverage(orgId, o.id);
      for (const c of coverage) {
        if (String(c.fulfillment.status) !== "pending") {
          throw new BadRequestException(`অর্ডার ${o.externalNumber ?? o.externalId}-এর ফুলফিলমেন্ট ${c.fulfillment.status} অবস্থায় আছে — মার্জ করা যাবে না`);
        }
      }
      participants.push(o);
    }
    const survivor = participants.find((o) => String(o.id) === survivorId);
    const others = participants.filter((o) => String(o.id) !== survivorId);

    // Same customer: identical customerId, or ONE normalized
    // phone key shared by every participant's customer.
    const customerIds = participants.map((o) => (o.customerId ? String(o.customerId) : null));
    const allSameCustomer = customerIds.every((c) => c !== null) && new Set(customerIds).size === 1;
    if (!allSameCustomer) {
      if (customerIds.some((c) => c === null)) {
        throw new BadRequestException("গ্রাহক একই নয় — সব অর্ডারে একই গ্রাহক থাকতে হবে");
      }
      const phoneKeys = participants.map((o) => normalizeBdPhone(o.customer?.phone ?? null));
      if (phoneKeys.some((k) => !k) || new Set(phoneKeys).size !== 1) {
        throw new BadRequestException("গ্রাহক একই নয় — সব অর্ডারে একই গ্রাহক থাকতে হবে");
      }
    }
    const currencies = new Set(participants.map((o) => String(o.currency ?? "BDT")));
    if (currencies.size !== 1) throw new BadRequestException("সব অর্ডারের মুদ্রা এক হতে হবে");

    // Combine lines by (productId, sku, unitPrice, isGift, bundleId).
    const combined = new Map<string, ResolvedLine>();
    const addLine = (line: any, fromSurvivor: boolean) => {
      const rl: ResolvedLine = {
        orderItemId: fromSurvivor ? String(line.id) : null,
        productId: line.productId ?? null,
        variantSku: line.sku ?? null,
        name: line.name,
        quantity: Number(line.quantity),
        unitPriceMinor: bi(line.priceMinor),
        isPreorder: !!line.isPreorder,
        isGift: !!line.isGift,
        bundleId: line.bundleId ?? null,
        bundleName: line.bundleName ?? null,
      };
      const key = `${rl.productId ?? ""}::${rl.variantSku ?? ""}::${rl.unitPriceMinor.toString()}::${rl.isGift}::${rl.bundleId ?? ""}`;
      const existingLine = combined.get(key);
      if (existingLine) {
        existingLine.quantity += rl.quantity;
        if (!existingLine.orderItemId && rl.orderItemId) existingLine.orderItemId = rl.orderItemId;
      } else {
        combined.set(key, rl);
      }
    };
    for (const line of survivor.items ?? []) addLine(line, true);
    for (const o of others) for (const line of o.items ?? []) addLine(line, false);
    const combinedLines = [...combined.values()];

    const totals = await this.computeSurgeryTotals(orgId, survivor, combinedLines, {});
    await this.replaceItems(survivor.id, totals.lines);
    await this.writeTotals(survivor.id, totals, totals.appliedCouponCode ?? null);
    await this.stampFailureIsolated(orgId, survivor, totals);

    const droppedDeliveryMinor = others.reduce((s: bigint, o: any) => s + bi(o.shippingMinor), 0n);
    let reassignedVerifications = 0;
    const cancelledOrderIds: string[] = [];

    for (const o of others) {
      // Cancel its PENDING fulfillments (non-pending already refused).
      const coverage = await this.fulfillmentCoverage(orgId, o.id);
      const seenFulfillments = new Set<string>();
      for (const c of coverage) {
        const fid = String(c.fulfillment.id);
        if (seenFulfillments.has(fid)) continue;
        seenFulfillments.add(fid);
        if (String(c.fulfillment.status) === "pending") {
          await this.t("fulfillment").update({ where: { id: fid }, data: { status: "cancelled" } }).catch(() => undefined);
        }
      }
      // Reassign payment verifications to the survivor.
      const vTable = this.t("paymentVerification");
      if (vTable?.findMany && vTable?.update) {
        const rows = (await vTable.findMany({ where: { organizationId: orgId, orderId: o.id } }).catch(() => [])) ?? [];
        for (const r of rows) {
          await vTable.update({ where: { id: r.id }, data: { orderId: survivor.id } }).catch(() => undefined);
          reassignedVerifications++;
        }
      } else if (vTable?.updateMany) {
        const res = await vTable.updateMany({ where: { organizationId: orgId, orderId: o.id }, data: { orderId: survivor.id } }).catch(() => ({ count: 0 }));
        reassignedVerifications += Number((res as any)?.count ?? 0);
      }
      // Ledger-only stock transfer (see InventoryService for the
      // reason mapping — reused as-is for merge: the survivor's
      // restore nets the transferred order_placed movements,
      // the merged-away order's movements stay as history; it is
      // never restored because revival is blocked).
      await this.inventory.recordStockTransfer(
        orgId, o.id, survivor.id,
        (o.items ?? []).map((l: any) => ({ productId: l.productId ?? null, sku: l.sku ?? null, quantity: Number(l.quantity), isPreorder: !!l.isPreorder })),
      );
      const mergeNote = `অন্য অর্ডারে মার্জ হয়েছে: ${survivor.externalNumber ?? survivor.externalId}`;
      const internalNote = o.internalNote ? `${o.internalNote} | ${mergeNote}` : mergeNote;
      await this.t("order").update({
        where: { id: o.id },
        data: { status: "cancelled", internalNote, mergedIntoId: survivor.id },
      });
      cancelledOrderIds.push(String(o.id));
      await this.audit?.log({
        organizationId: orgId, userId: actorId, action: "order.merged_out",
        entityType: "Order", entityId: o.id, metadata: { survivorId: survivor.id },
      }).catch(() => undefined);
    }

    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "order.merged_in",
      entityType: "Order", entityId: survivor.id,
      metadata: {
        mergedOrderIds: cancelledOrderIds,
        droppedDeliveryMinor: droppedDeliveryMinor.toString(),
        reassignedVerifications,
      },
    }).catch(() => undefined);

    const overpaid = await this.overpaidMinor(orgId, survivor.id, totals.totalMinor);
    return {
      survivor: await this.orders.getOne(orgId, survivor.id),
      cancelledOrderIds,
      droppedDeliveryMinor: droppedDeliveryMinor.toString(),
      reassignedVerifications,
      overpaidMinor: overpaid.toString(),
    };
  }
}
