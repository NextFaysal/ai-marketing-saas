import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CatalogPushService } from "../commerce/catalog-push.service";
import { EventsService } from "../common/events.service";
import { dhakaDayStartUtc } from "../crm/lead-followups";

/** EC28: emitted on a stock transition 0 → >0 so the storefront
 * retention service can fire back-in-stock alerts. The
 * EventsService dispatch is failure-isolated by design. */
export const STOCK_INCREASED_EVENT = "inventory.stock_increased";

/**
 * Sales & Data S1 — Inventory Movement.
 *
 * Before S1, Product.stockQuantity was display-only: orders never
 * decremented it and nothing recorded why a number changed. This
 * service is the ONE writer of order-driven stock changes. Every
 * change writes a StockMovement row (the ledger), so a balance is
 * always explainable.
 *
 * Semantics (see docs/sales-s1-acceptance.md):
 * - UNTRACKED: stockQuantity === null means "not tracked". Order
 *   placement skips untracked rows entirely (product-level AND
 *   variant-level — a tracked product with an untracked variant
 *   does NOT fall back to the product row, and vice versa).
 * - IDEMPOTENT: order_placed is keyed by (orderId, productId,
 *   variantId); a restore is keyed by (orderId, productId,
 *   variantId) across BOTH restore reasons — an order restored
 *   once can never be restored twice.
 * - Restore replays the PLACED movements (exact quantities), never
 *   the order's current items — items are fully replaced on every
 *   store upsert, so by cancel time they may say anything.
 * - Negative balances are recorded truthfully (COD oversell is
 *   real); nothing clamps at zero.
 */

export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

/** Order statuses that mean "this order never took stock". */
const DEAD_ON_ARRIVAL = ["cancelled", "failed", "refunded", "returned"];
const RESTORE_REASONS = ["order_cancelled", "order_returned"] as const;
export type RestoreReason = (typeof RESTORE_REASONS)[number];

export interface PlacedItemInput {
  productId: string | null;
  variantId?: string | null;
  quantity: number;
  /** EC24a: pre-order line — skipped entirely (no decrement, no
   * movement): the stock may not exist yet. See commerce/ec24.ts. */
  isPreorder?: boolean;
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    // EC4: optional so existing 2-arg constructions (specs, legacy
    // wiring) keep working; when present, absolute balances after a
    // local stock change are pushed to connected stores.
    @Optional() private readonly catalogPush?: CatalogPushService,
    // EC28 + SU5: optional event bus — EC28 back-in-stock hook and
    // SU5 social auto-draft producer both ride this param. LAST
    // param so existing positional constructions keep working
    // (EventsService is global); fire-and-forget emits.
    @Optional() private readonly events?: EventsService,
  ) {}

  /** EC28 — emit the restock transition (0 → >0 only). Never throws. */
  private emitStockIncreased(
    organizationId: string,
    productId: string,
    variant: { id?: string | null; sku?: string | null } | null,
    prevBalance: number,
    balanceAfter: number,
  ): void {
    if (!this.events) return;
    if (!(prevBalance <= 0 && balanceAfter > 0)) return;
    try {
      this.events.emit(STOCK_INCREASED_EVENT, {
        organizationId,
        productId,
        variantId: variant?.id ?? null,
        variantSku: variant?.sku ?? null,
        prevBalance,
        balanceAfter,
      });
    } catch {
      /* the event bus never breaks a stock write */
    }
  }

  /**
   * EC4 — notify the commerce layer that a local balance changed,
   * so it can enqueue an outbound inventory push. `quantity` is the
   * ABSOLUTE balance after the change, not a delta. Fully
   * failure-isolated: a push-enqueue problem never breaks the stock
   * write that triggered it.
   */
  private async notifyStockPush(
    organizationId: string,
    productId: string,
    variantId: string | null,
    balanceAfter: number,
  ): Promise<void> {
    if (!this.catalogPush) return;
    try {
      await this.catalogPush.enqueueInventoryPush(organizationId, productId, variantId, balanceAfter);
    } catch (e) {
      this.logger.warn(`stock push enqueue failed for product ${productId}: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  resolveThreshold(product: { lowStockThreshold?: number | null }): number {
    return product.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
  }

  // ---------- Order placement ----------

  async applyOrderPlaced(
    organizationId: string,
    orderId: string,
    opts: { items?: PlacedItemInput[]; status?: string } = {},
  ): Promise<{ decremented: number; skipped: number }> {
    // An order CREATED directly in a dead state (e.g. a backfilled
    // cancelled Woo order) never took stock — placing it would
    // double-count a cancellation that never had a placement.
    if (opts.status && DEAD_ON_ARRIVAL.includes(opts.status)) {
      return { decremented: 0, skipped: 0 };
    }
    const lines = opts.items ?? (await this.loadOrderLines(orderId));
    let decremented = 0;
    let skipped = 0;
    for (const line of lines) {
      // EC24a: preorder lines never touch stock (counted as skipped).
      if ((line as any).isPreorder) { skipped++; continue; }
      if (!line.productId || !line.quantity || line.quantity <= 0) { skipped++; continue; }
      const variantId = line.variantId ?? null;
      // Idempotency: one order_placed movement per
      // (order, product, variant). Re-running placement (sync
      // retries, webhook redelivery) must never double-decrement.
      const already = await (this.prisma as any).stockMovement.findFirst({
        where: { orderId, reason: "order_placed", productId: line.productId, variantId },
      });
      if (already) { skipped++; continue; }

      if (variantId) {
        const variant = await (this.prisma as any).productVariant.findFirst({ where: { id: variantId } });
        // Variant row gone, or untracked at variant level — skip.
        // Deliberately NO fallback to the product row: the sale
        // was of that variant, and the product row may aggregate
        // other variants.
        if (!variant || variant.stockQuantity == null) { skipped++; continue; }
        const prev = variant.stockQuantity as number;
        const balanceAfter = prev - line.quantity;
        await (this.prisma as any).productVariant.update({
          where: { id: variant.id }, data: { stockQuantity: balanceAfter },
        });
        await (this.prisma as any).stockMovement.create({
          data: {
            organizationId, productId: line.productId, variantId,
            delta: -line.quantity, balanceAfter, reason: "order_placed", orderId,
          },
        });
        decremented++;
        const product = await (this.prisma as any).product.findFirst({ where: { id: line.productId, organizationId } });
        if (product) await this.maybeLowStockAlert(organizationId, product, variant, prev, balanceAfter);
        await this.notifyStockPush(organizationId, line.productId, variantId, balanceAfter);
        // EC4: bundle expansion keys off the PARENT product,
        // regardless of which variant of it sold — composition is
        // defined per parent product.
        await this.decrementBundleComponents(organizationId, orderId, line.productId, line.quantity);
      } else {
        const product = await (this.prisma as any).product.findFirst({ where: { id: line.productId, organizationId } });
        if (!product || product.stockQuantity == null) { skipped++; continue; }
        const prev = product.stockQuantity as number;
        const balanceAfter = prev - line.quantity;
        await (this.prisma as any).product.update({
          where: { id: product.id }, data: { stockQuantity: balanceAfter },
        });
        await (this.prisma as any).stockMovement.create({
          data: {
            organizationId, productId: line.productId, variantId: null,
            delta: -line.quantity, balanceAfter, reason: "order_placed", orderId,
          },
        });
        decremented++;
        await this.maybeLowStockAlert(organizationId, product, null, prev, balanceAfter);
        await this.notifyStockPush(organizationId, line.productId, null, balanceAfter);
        await this.decrementBundleComponents(organizationId, orderId, line.productId, line.quantity);
      }
    }
    return { decremented, skipped };
  }

  /**
   * EC4 — bundle component decrement. When a sold product is a
   * bundle parent, each component is decremented by
   * (component quantity × sold line quantity) under reason
   * "bundle_component", keyed idempotently by
   * (orderId, reason, componentProductId, componentVariantId).
   *
   * Rules carried over from S1: untracked component rows are
   * skipped with NO product↔variant fallback; negative balances
   * are recorded truthfully (no clamping).
   *
   * ONE LEVEL ONLY: component decrements written here do NOT
   * trigger their own bundle expansion — a component that is
   * itself a bundle parent does not cascade. Do not recurse.
   *
   * Bundle work is NOT counted in applyOrderPlaced's
   * { decremented, skipped } — those counts describe the SOLD
   * lines only (existing S1 specs assert them).
   *
   * Fully failure-isolated: a missing BundleItem table (older
   * fakes / pre-migration DBs) or any bundle error is logged and
   * treated as "no bundle work" — it must never break order
   * placement.
   */
  private async decrementBundleComponents(
    organizationId: string,
    orderId: string,
    parentProductId: string,
    lineQuantity: number,
  ): Promise<void> {
    try {
      const bundleTable = (this.prisma as any).bundleItem;
      if (!bundleTable?.findMany) return;
      const items = await bundleTable.findMany({
        where: { organizationId, parentProductId },
      }).catch(() => null);
      if (!items) return;
      for (const item of items as any[]) {
        try {
          const needed = (item.quantity as number) * lineQuantity;
          if (!needed || needed <= 0) continue;
          const componentProductId = item.componentProductId as string;
          const componentVariantId = (item.componentVariantId ?? null) as string | null;
          // Idempotency: one bundle_component movement per
          // (order, component product, component variant).
          const already = await (this.prisma as any).stockMovement.findFirst({
            where: { orderId, reason: "bundle_component", productId: componentProductId, variantId: componentVariantId },
          });
          if (already) continue;

          if (componentVariantId) {
            const variant = await (this.prisma as any).productVariant.findFirst({ where: { id: componentVariantId } });
            // Variant gone or untracked at variant level — skip,
            // deliberately NO fallback to the component product row.
            if (!variant || variant.stockQuantity == null) continue;
            const prev = variant.stockQuantity as number;
            const balanceAfter = prev - needed;
            await (this.prisma as any).productVariant.update({
              where: { id: variant.id }, data: { stockQuantity: balanceAfter },
            });
            await (this.prisma as any).stockMovement.create({
              data: {
                organizationId, productId: componentProductId, variantId: componentVariantId,
                delta: -needed, balanceAfter, reason: "bundle_component", orderId,
              },
            });
            const componentProduct = await (this.prisma as any).product.findFirst({
              where: { id: componentProductId, organizationId },
            });
            if (componentProduct) await this.maybeLowStockAlert(organizationId, componentProduct, variant, prev, balanceAfter);
            await this.notifyStockPush(organizationId, componentProductId, componentVariantId, balanceAfter);
          } else {
            const componentProduct = await (this.prisma as any).product.findFirst({
              where: { id: componentProductId, organizationId },
            });
            if (!componentProduct || componentProduct.stockQuantity == null) continue;
            const prev = componentProduct.stockQuantity as number;
            const balanceAfter = prev - needed;
            await (this.prisma as any).product.update({
              where: { id: componentProduct.id }, data: { stockQuantity: balanceAfter },
            });
            await (this.prisma as any).stockMovement.create({
              data: {
                organizationId, productId: componentProductId, variantId: null,
                delta: -needed, balanceAfter, reason: "bundle_component", orderId,
              },
            });
            await this.maybeLowStockAlert(organizationId, componentProduct, null, prev, balanceAfter);
            await this.notifyStockPush(organizationId, componentProductId, null, balanceAfter);
          }
        } catch (e) {
          this.logger.warn(`bundle component decrement failed for parent ${parentProductId}: ${e instanceof Error ? e.message : "unknown"}`);
        }
      }
    } catch (e) {
      this.logger.warn(`bundle expansion failed for parent ${parentProductId}: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  /** Lines for an order from its CURRENT OrderItem rows, with the
   * internal variant resolved by the SKU rule: an item carrying an
   * externalVariationId or a sku tries (productId, sku) on
   * ProductVariant; found → variant-level, else product-level. */
  private async loadOrderLines(orderId: string): Promise<PlacedItemInput[]> {
    const items = await (this.prisma as any).orderItem.findMany({ where: { orderId } });
    const lines: PlacedItemInput[] = [];
    for (const item of items as any[]) {
      let variantId: string | null = null;
      if (item.productId && (item.externalVariationId || item.sku) && item.sku) {
        const variant = await (this.prisma as any).productVariant.findFirst({
          where: { productId: item.productId, sku: item.sku },
        }).catch(() => null);
        variantId = variant?.id ?? null;
      }
      lines.push({ productId: item.productId ?? null, variantId, quantity: item.quantity, isPreorder: !!item.isPreorder });
    }
    return lines;
  }

  // ---------- ON3: order-edit stock delta ----------

  /**
   * ON3 — apply the stock effect of an order ITEM EDIT.
   * `deltaQty` is the change in SOLD quantity for the line
   * (+ = more sold → stock decreases; − = fewer sold → stock
   * rises). Mirrors placement's tracked rules exactly: preorder
   * lines and product-less lines are skipped, the variant is
   * resolved by (productId, sku) exactly like loadOrderLines,
   * and an untracked resolved row is skipped with NO
   * product↔variant fallback. Every applied line writes an
   * "order_edit" StockMovement (delta is STOCK-signed:
   * −deltaQty) — applyOrderRestore's Phase B nets these against
   * the placed movements so a later cancel restores exactly the
   * net sold quantity.
   */
  async applyOrderEditDelta(
    organizationId: string,
    orderId: string,
    lines: Array<{ productId: string | null; sku?: string | null; deltaQty: number; isPreorder?: boolean }>,
  ): Promise<{ adjusted: number; skipped: number }> {
    let adjusted = 0;
    let skipped = 0;
    for (const line of lines ?? []) {
      if (line.isPreorder || !line.productId || !line.deltaQty || line.deltaQty === 0) { skipped++; continue; }
      const deltaQty = line.deltaQty;
      // Resolve the variant by the loadOrderLines SKU rule.
      let variant: any = null;
      if (line.sku) {
        variant = await (this.prisma as any).productVariant.findFirst({
          where: { productId: line.productId, sku: line.sku },
        }).catch(() => null);
      }
      let applied = false;
      if (variant) {
        if (variant.stockQuantity == null) { skipped++; continue; }
        const prev = variant.stockQuantity as number;
        const balanceAfter = prev - deltaQty;
        await (this.prisma as any).productVariant.update({
          where: { id: variant.id }, data: { stockQuantity: balanceAfter },
        });
        await (this.prisma as any).stockMovement.create({
          data: {
            organizationId, productId: line.productId, variantId: variant.id,
            delta: -deltaQty, balanceAfter, reason: "order_edit", orderId,
          },
        });
        adjusted++;
        applied = true;
        const product = await (this.prisma as any).product.findFirst({ where: { id: line.productId, organizationId } });
        if (product) await this.maybeLowStockAlert(organizationId, product, variant, prev, balanceAfter);
        await this.notifyStockPush(organizationId, line.productId, variant.id, balanceAfter);
      } else {
        const product = await (this.prisma as any).product.findFirst({ where: { id: line.productId, organizationId } });
        if (!product || product.stockQuantity == null) { skipped++; continue; }
        const prev = product.stockQuantity as number;
        const balanceAfter = prev - deltaQty;
        await (this.prisma as any).product.update({
          where: { id: product.id }, data: { stockQuantity: balanceAfter },
        });
        await (this.prisma as any).stockMovement.create({
          data: {
            organizationId, productId: line.productId, variantId: null,
            delta: -deltaQty, balanceAfter, reason: "order_edit", orderId,
          },
        });
        adjusted++;
        applied = true;
        await this.maybeLowStockAlert(organizationId, product, null, prev, balanceAfter);
        await this.notifyStockPush(organizationId, line.productId, null, balanceAfter);
      }
      if (applied) {
        await this.editBundleComponents(organizationId, orderId, line.productId, deltaQty);
      }
    }
    return { adjusted, skipped };
  }

  /**
   * ON3 — the EC4 bundle-composition mirror of
   * decrementBundleComponents for EDIT deltas: same
   * resolution/tracked rules and per-component failure
   * isolation, but WITHOUT the placement idempotency skip and
   * with SIGNED amounts (a negative deltaQty gives components
   * back). Movements carry reason "order_edit" so restore
   * Phase B nets them. Not counted in applyOrderEditDelta's
   * { adjusted, skipped } — those describe the sold lines only.
   */
  private async editBundleComponents(
    organizationId: string,
    orderId: string,
    parentProductId: string,
    deltaQty: number,
  ): Promise<void> {
    try {
      const bundleTable = (this.prisma as any).bundleItem;
      if (!bundleTable?.findMany) return;
      const items = await bundleTable.findMany({
        where: { organizationId, parentProductId },
      }).catch(() => null);
      if (!items) return;
      for (const item of items as any[]) {
        try {
          const needed = (item.quantity as number) * deltaQty;
          if (!needed) continue;
          const componentProductId = item.componentProductId as string;
          const componentVariantId = (item.componentVariantId ?? null) as string | null;
          if (componentVariantId) {
            const variant = await (this.prisma as any).productVariant.findFirst({ where: { id: componentVariantId } });
            if (!variant || variant.stockQuantity == null) continue;
            const prev = variant.stockQuantity as number;
            const balanceAfter = prev - needed;
            await (this.prisma as any).productVariant.update({
              where: { id: variant.id }, data: { stockQuantity: balanceAfter },
            });
            await (this.prisma as any).stockMovement.create({
              data: {
                organizationId, productId: componentProductId, variantId: componentVariantId,
                delta: -needed, balanceAfter, reason: "order_edit", orderId,
              },
            });
            const componentProduct = await (this.prisma as any).product.findFirst({
              where: { id: componentProductId, organizationId },
            });
            if (componentProduct) await this.maybeLowStockAlert(organizationId, componentProduct, variant, prev, balanceAfter);
            await this.notifyStockPush(organizationId, componentProductId, componentVariantId, balanceAfter);
          } else {
            const componentProduct = await (this.prisma as any).product.findFirst({
              where: { id: componentProductId, organizationId },
            });
            if (!componentProduct || componentProduct.stockQuantity == null) continue;
            const prev = componentProduct.stockQuantity as number;
            const balanceAfter = prev - needed;
            await (this.prisma as any).product.update({
              where: { id: componentProduct.id }, data: { stockQuantity: balanceAfter },
            });
            await (this.prisma as any).stockMovement.create({
              data: {
                organizationId, productId: componentProductId, variantId: null,
                delta: -needed, balanceAfter, reason: "order_edit", orderId,
              },
            });
            await this.maybeLowStockAlert(organizationId, componentProduct, null, prev, balanceAfter);
            await this.notifyStockPush(organizationId, componentProductId, null, balanceAfter);
          }
        } catch (e) {
          this.logger.warn(`bundle component edit failed for parent ${parentProductId}: ${e instanceof Error ? e.message : "unknown"}`);
        }
      }
    } catch (e) {
      this.logger.warn(`bundle edit expansion failed for parent ${parentProductId}: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  // ---------- ON3: ledger-only stock transfer (split / merge) ----------

  /**
   * ON3 — record that sold stock moved from one order to
   * another (split-out child / merge survivor) WITHOUT changing
   * any balance: the goods were already decremented once, at
   * the original placement.
   *
   * Reason mapping (documented because restore depends on it):
   * - FROM order: "order_edit" with delta +quantity. Restore
   *   Phase B nets order_edit against the from-order's placed
   *   movements, so cancelling the from-order afterwards
   *   restores only what stayed on it.
   * - TO order (sold line): "order_placed" with delta −quantity.
   *   Restore Phase A replays order_placed movements, so
   *   cancelling the to-order restores the transferred qty.
   * - TO order (EC4 bundle components): "bundle_component"
   *   with delta −componentQty — Phase A reads order_placed +
   *   bundle_component. FROM-order components mirror as
   *   "order_edit" +componentQty (Phase B nets them there).
   * balanceAfter on every movement is the CURRENT (unchanged)
   * balance. Untracked / missing rows skip that line entirely.
   */
  async recordStockTransfer(
    organizationId: string,
    fromOrderId: string,
    toOrderId: string,
    lines: Array<{ productId: string | null; sku?: string | null; quantity: number; isPreorder?: boolean }>,
  ): Promise<{ recorded: number; skipped: number }> {
    let recorded = 0;
    let skipped = 0;
    for (const line of lines ?? []) {
      if (line.isPreorder || !line.productId || !line.quantity || line.quantity <= 0) { skipped++; continue; }
      let variant: any = null;
      if (line.sku) {
        variant = await (this.prisma as any).productVariant.findFirst({
          where: { productId: line.productId, sku: line.sku },
        }).catch(() => null);
      }
      let balance: number | null = null;
      let variantId: string | null = null;
      if (variant) {
        if (variant.stockQuantity == null) { skipped++; continue; }
        balance = variant.stockQuantity as number;
        variantId = variant.id;
      } else {
        const product = await (this.prisma as any).product.findFirst({ where: { id: line.productId, organizationId } });
        if (!product || product.stockQuantity == null) { skipped++; continue; }
        balance = product.stockQuantity as number;
      }
      await (this.prisma as any).stockMovement.create({
        data: {
          organizationId, productId: line.productId, variantId,
          delta: line.quantity, balanceAfter: balance, reason: "order_edit", orderId: fromOrderId,
        },
      });
      await (this.prisma as any).stockMovement.create({
        data: {
          organizationId, productId: line.productId, variantId,
          delta: -line.quantity, balanceAfter: balance, reason: "order_placed", orderId: toOrderId,
        },
      });
      recorded++;
      // EC4 components mirror on both orders (failure-isolated).
      try {
        const bundleTable = (this.prisma as any).bundleItem;
        if (bundleTable?.findMany) {
          const items = await bundleTable.findMany({
            where: { organizationId, parentProductId: line.productId },
          }).catch(() => null);
          for (const item of (items as any[]) ?? []) {
            try {
              const compQty = (item.quantity as number) * line.quantity;
              if (!compQty || compQty <= 0) continue;
              const componentProductId = item.componentProductId as string;
              const componentVariantId = (item.componentVariantId ?? null) as string | null;
              let compBalance: number | null = null;
              if (componentVariantId) {
                const cv = await (this.prisma as any).productVariant.findFirst({ where: { id: componentVariantId } });
                if (!cv || cv.stockQuantity == null) continue;
                compBalance = cv.stockQuantity as number;
              } else {
                const cp = await (this.prisma as any).product.findFirst({ where: { id: componentProductId, organizationId } });
                if (!cp || cp.stockQuantity == null) continue;
                compBalance = cp.stockQuantity as number;
              }
              await (this.prisma as any).stockMovement.create({
                data: {
                  organizationId, productId: componentProductId, variantId: componentVariantId,
                  delta: compQty, balanceAfter: compBalance, reason: "order_edit", orderId: fromOrderId,
                },
              });
              await (this.prisma as any).stockMovement.create({
                data: {
                  organizationId, productId: componentProductId, variantId: componentVariantId,
                  delta: -compQty, balanceAfter: compBalance, reason: "bundle_component", orderId: toOrderId,
                },
              });
            } catch { /* per-component isolation, as in placement */ }
          }
        }
      } catch { /* bundle mirror never breaks a transfer */ }
    }
    return { recorded, skipped };
  }

  // ---------- Order restore (cancel / return) ----------

  async applyOrderRestore(
    organizationId: string,
    orderId: string,
    reason: RestoreReason,
  ): Promise<{ restored: number; skipped: number }> {
    // Fast path: this exact restore already ran for this order.
    const sameReason = await (this.prisma as any).stockMovement.findFirst({
      where: { orderId, reason },
    });
    if (sameReason) return { restored: 0, skipped: 0 };

    // EC4: the placed set includes bundle component movements —
    // restoring an order restores its components too, replaying
    // the exact placed quantities (never the order's items).
    const placed = await (this.prisma as any).stockMovement.findMany({
      where: { orderId, reason: { in: ["order_placed", "bundle_component"] } },
    });
    if (!placed.length) {
      // ON3 Phase B can still apply on its own (an order whose
      // only stock movements came from item edits).
      return this.applyRestoreNetting(organizationId, orderId, reason, 0, 0);
    }
    // An order restored once (either reason) must never restore
    // twice — collect every line already restored under EITHER
    // restore reason.
    const priorRestores = await (this.prisma as any).stockMovement.findMany({
      where: { orderId, reason: { in: [...RESTORE_REASONS] } },
    });
    const restoredKeys = new Set(
      (priorRestores as any[]).map((m) => `${m.productId}::${m.variantId ?? ""}`),
    );

    let restored = 0;
    let skipped = 0;
    for (const movement of placed as any[]) {
      const key = `${movement.productId}::${movement.variantId ?? ""}`;
      if (restoredKeys.has(key)) { skipped++; continue; }
      const qty = Math.abs(movement.delta as number);
      if (movement.variantId) {
        const variant = await (this.prisma as any).productVariant.findFirst({ where: { id: movement.variantId } });
        // The row became untracked (or was deleted) after the
        // sale — there is no honest balance to add back onto.
        if (!variant || variant.stockQuantity == null) { skipped++; continue; }
        const balanceAfter = (variant.stockQuantity as number) + qty;
        await (this.prisma as any).productVariant.update({
          where: { id: variant.id }, data: { stockQuantity: balanceAfter },
        });
        await (this.prisma as any).stockMovement.create({
          data: {
            organizationId, productId: movement.productId, variantId: movement.variantId,
            delta: qty, balanceAfter, reason, orderId,
          },
        });
        restored++;
        await this.notifyStockPush(organizationId, movement.productId, movement.variantId, balanceAfter);
        // EC28: cancel/return restore is a stock-increase path too.
        this.emitStockIncreased(organizationId, movement.productId, variant, (variant.stockQuantity as number), balanceAfter);
      } else {
        const product = await (this.prisma as any).product.findFirst({ where: { id: movement.productId, organizationId } });
        if (!product || product.stockQuantity == null) { skipped++; continue; }
        const balanceAfter = (product.stockQuantity as number) + qty;
        await (this.prisma as any).product.update({
          where: { id: product.id }, data: { stockQuantity: balanceAfter },
        });
        await (this.prisma as any).stockMovement.create({
          data: {
            organizationId, productId: movement.productId, variantId: null,
            delta: qty, balanceAfter, reason, orderId,
          },
        });
        restored++;
        await this.notifyStockPush(organizationId, movement.productId, null, balanceAfter);
        this.emitStockIncreased(organizationId, movement.productId, null, product.stockQuantity as number, balanceAfter);
      }
    }
    // ON3 Phase B: net the order_edit movements (item edits +
    // split/merge transfers) against what Phase A just restored.
    return this.applyRestoreNetting(organizationId, orderId, reason, restored, skipped);
  }

  /**
   * ON3 restore Phase B — netting. Phase A above replays the
   * PLACED movements exactly; item edits after placement (and
   * split/merge transfers) mean the placed quantity is no
   * longer the net sold quantity. For each stock key in the
   * union of placed-family (order_placed, bundle_component)
   * and order_edit movements:
   *   target  = −Σ deltas over those three reasons
   *             (the total quantity that must end up restored)
   *   already = Σ deltas over the RESTORE_REASONS movements
   *             (queried FRESH, after Phase A, so Phase A's own
   *             writes count)
   *   diff    = target − already
   * A non-zero diff is written as one more restore movement
   * (delta = diff; diff may be NEGATIVE — Phase A over-restored
   * when units were edited away / transferred out). Counting
   * choice: `restored` increments only when diff > 0 (a real
   * give-back); a negative correction is a ledger fix, not a
   * restoration. Idempotent by construction: a second restore
   * computes diff 0 for every key.
   */
  private async applyRestoreNetting(
    organizationId: string,
    orderId: string,
    reason: RestoreReason,
    restored: number,
    skipped: number,
  ): Promise<{ restored: number; skipped: number }> {
    const edits = await (this.prisma as any).stockMovement.findMany({
      where: { orderId, reason: "order_edit" },
    }).catch(() => []);
    if (!(edits as any[]).length) return { restored, skipped };

    const placedFamily = await (this.prisma as any).stockMovement.findMany({
      where: { orderId, reason: { in: ["order_placed", "bundle_component", "order_edit"] } },
    });
    const restoreRows = await (this.prisma as any).stockMovement.findMany({
      where: { orderId, reason: { in: [...RESTORE_REASONS] } },
    });
    const targetByKey = new Map<string, { productId: string; variantId: string | null; target: number }>();
    for (const m of placedFamily as any[]) {
      const key = `${m.productId}::${m.variantId ?? ""}`;
      const entry = targetByKey.get(key) ?? { productId: m.productId, variantId: m.variantId ?? null, target: 0 };
      entry.target += -(m.delta as number);
      targetByKey.set(key, entry);
    }
    const alreadyByKey = new Map<string, number>();
    for (const m of restoreRows as any[]) {
      const key = `${m.productId}::${m.variantId ?? ""}`;
      alreadyByKey.set(key, (alreadyByKey.get(key) ?? 0) + (m.delta as number));
    }

    for (const [key, entry] of targetByKey) {
      const diff = entry.target - (alreadyByKey.get(key) ?? 0);
      if (diff === 0) continue;
      if (entry.variantId) {
        const variant = await (this.prisma as any).productVariant.findFirst({ where: { id: entry.variantId } });
        if (!variant || variant.stockQuantity == null) { skipped++; continue; }
        const prev = variant.stockQuantity as number;
        const balanceAfter = prev + diff;
        await (this.prisma as any).productVariant.update({
          where: { id: variant.id }, data: { stockQuantity: balanceAfter },
        });
        await (this.prisma as any).stockMovement.create({
          data: {
            organizationId, productId: entry.productId, variantId: entry.variantId,
            delta: diff, balanceAfter, reason, orderId,
          },
        });
        if (diff > 0) restored++;
        await this.notifyStockPush(organizationId, entry.productId, entry.variantId, balanceAfter);
        if (diff > 0) this.emitStockIncreased(organizationId, entry.productId, variant, prev, balanceAfter);
      } else {
        const product = await (this.prisma as any).product.findFirst({ where: { id: entry.productId, organizationId } });
        if (!product || product.stockQuantity == null) { skipped++; continue; }
        const prev = product.stockQuantity as number;
        const balanceAfter = prev + diff;
        await (this.prisma as any).product.update({
          where: { id: product.id }, data: { stockQuantity: balanceAfter },
        });
        await (this.prisma as any).stockMovement.create({
          data: {
            organizationId, productId: entry.productId, variantId: null,
            delta: diff, balanceAfter, reason, orderId,
          },
        });
        if (diff > 0) restored++;
        await this.notifyStockPush(organizationId, entry.productId, null, balanceAfter);
        if (diff > 0) this.emitStockIncreased(organizationId, entry.productId, null, prev, balanceAfter);
      }
    }
    return { restored, skipped };
  }

  // ---------- Manual adjustment ----------

  async adjust(
    organizationId: string,
    actorUserId: string,
    productId: string,
    input: { variantId?: string | null; delta?: number | null; setTo?: number | null; note?: string | null; reason?: string },
  ) {
    const hasDelta = input.delta !== undefined && input.delta !== null;
    const hasSetTo = input.setTo !== undefined && input.setTo !== null;
    if (hasDelta === hasSetTo) {
      throw new BadRequestException("delta অথবা setTo — ঠিক একটি দিতে হবে (দুটোই বা কোনোটিই নয়)।");
    }
    const product = await (this.prisma as any).product.findFirst({ where: { id: productId, organizationId } });
    if (!product) throw new NotFoundException("Product not found in this organization");

    let variant: any = null;
    if (input.variantId) {
      variant = await (this.prisma as any).productVariant.findFirst({
        where: { id: input.variantId, productId },
      });
      if (!variant) throw new NotFoundException("Variant not found for this product");
    }
    const current: number | null = variant ? variant.stockQuantity : product.stockQuantity;
    if (current == null) {
      throw new BadRequestException("এই পণ্যের স্টক ট্র্যাক করা হচ্ছে না — আগে পণ্যের স্টক সংখ্যা বসান");
    }
    let newBalance: number;
    let appliedDelta: number;
    if (hasSetTo) {
      if (!Number.isInteger(input.setTo) || (input.setTo as number) < 0) {
        throw new BadRequestException("setTo অবশ্যই ০ বা তার বেশি পূর্ণসংখ্যা হতে হবে।");
      }
      newBalance = input.setTo as number;
      appliedDelta = newBalance - current;
    } else {
      if (!Number.isInteger(input.delta)) {
        throw new BadRequestException("delta অবশ্যই পূর্ণসংখ্যা হতে হবে।");
      }
      appliedDelta = input.delta as number;
      newBalance = current + appliedDelta;
    }
    if (variant) {
      await (this.prisma as any).productVariant.update({ where: { id: variant.id }, data: { stockQuantity: newBalance } });
    } else {
      await (this.prisma as any).product.update({ where: { id: product.id }, data: { stockQuantity: newBalance } });
    }
    const movement = await (this.prisma as any).stockMovement.create({
      data: {
        organizationId, productId, variantId: variant?.id ?? null,
        delta: appliedDelta, balanceAfter: newBalance, reason: input.reason ?? "manual_adjustment",
        actorUserId, note: input.note ?? null,
      },
    });
    await this.audit.log({
      organizationId, userId: actorUserId, action: "inventory.adjusted",
      entityType: "Product", entityId: productId,
      metadata: { productId, variantId: variant?.id ?? null, delta: appliedDelta, balanceAfter: newBalance },
    });
    await this.maybeLowStockAlert(organizationId, product, variant, current, newBalance);
    await this.notifyStockPush(organizationId, productId, variant?.id ?? null, newBalance);
    // EC28: adjust() is the single choke point for manual adjust,
    // purchase-receive, stock counts and return restock — a
    // 0 → >0 transition here fires the back-in-stock hook.
    this.emitStockIncreased(organizationId, productId, variant, current, newBalance);
    // SU5 (INT5 union, in addition to the EC28 hook above):
    // product-level (NOT variant) restock from zero may become a
    // social DRAFT when the org enabled the trigger.
    if (!variant && current <= 0 && newBalance > 0) {
      this.events?.emit?.("social_draft.back_in_stock", { organizationId, productId });
    }
    return { productId, variantId: variant?.id ?? null, stockQuantity: newBalance, movement };
  }

  // ---------- Store sync ----------

  /**
   * Records a sync_correction when a store sync overwrites a
   * tracked balance with a different one. The caller still writes
   * the synced value itself — the store is the source of truth;
   * this only explains the jump in the ledger.
   *
   * Baseline rule: previous == null (stock becomes tracked) or
   * incoming == null (stock becomes untracked) writes NO movement
   * — establishing/removing tracking is not a stock delta.
   * Equal values write nothing either. Sync corrections never
   * fire low-stock alerts (the merchant's own store already
   * manages its stock; an alert per sync would be noise).
   */
  async recordSyncedStock(
    organizationId: string,
    productId: string,
    variantId: string | null,
    previous: number | null,
    incoming: number | null,
  ): Promise<void> {
    if (previous == null || incoming == null || previous === incoming) return;
    // EC4: NO stock-push notification here — this balance came IN
    // from a store sync; pushing it back out would loop.
    await (this.prisma as any).stockMovement.create({
      data: {
        organizationId, productId, variantId: variantId ?? null,
        delta: incoming - previous, balanceAfter: incoming,
        reason: "sync_correction", actorUserId: null, note: "store sync",
      },
    });
  }

  // ---------- Low-stock alert ----------

  /**
   * Fires ONLY on a crossing: prevBalance > threshold and
   * newBalance <= threshold. Already-below stock staying below is
   * not re-alerted per order. Deduped per product per Dhaka day
   * via the AuditLog marker (same discipline as CRM C1's
   * LeadActivity marker). Recipients: ACTIVE OWNER/ADMIN members.
   * Fully failure-isolated — an alert problem never breaks the
   * stock write that triggered it.
   */
  private async maybeLowStockAlert(
    organizationId: string,
    product: any,
    variant: any | null,
    prevBalance: number,
    newBalance: number,
  ): Promise<void> {
    try {
      const threshold = this.resolveThreshold(product);
      if (!(prevBalance > threshold && newBalance <= threshold)) return;
      const marker = await (this.prisma as any).auditLog.findFirst({
        where: {
          organizationId, action: "inventory.low_stock_alert",
          entityType: "Product", entityId: product.id,
          createdAt: { gte: dhakaDayStartUtc(new Date()) },
        },
      }).catch(() => null);
      if (marker) return;
      const memberships = await (this.prisma as any).membership.findMany({
        where: { organizationId, status: "ACTIVE" }, take: 200,
      }).catch(() => []);
      const recipients = [...new Set((memberships as any[])
        .filter((m) => ["OWNER", "ADMIN"].includes(m.role))
        .map((m) => m.userId as string))];
      const variantPart = variant?.name ? ` (${variant.name})` : "";
      const title = `স্টক কম: ${product.name}`;
      const body = `“${product.name}”${variantPart} পণ্যের স্টক কমে ${newBalance}টি আছে (সতর্কতার সীমা ${threshold}টি)। Products পেজ থেকে স্টক সমন্বয় করুন বা নতুন স্টক আনুন।`;
      for (const userId of recipients) {
        await (this.prisma as any).agentNotification.create({
          data: { organizationId, userId, type: "low_stock", title, body, conversationId: null },
        }).catch(() => undefined);
      }
      await this.audit.log({
        organizationId, userId: undefined, action: "inventory.low_stock_alert",
        entityType: "Product", entityId: product.id,
        metadata: { productId: product.id, variantId: variant?.id ?? null, balanceAfter: newBalance, threshold },
      });
    } catch (e) {
      this.logger.warn(`low-stock alert failed for product ${product?.id}: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  // ---------- History ----------

  async listMovements(
    organizationId: string,
    productId: string,
    query: { page?: number; pageSize?: number } = {},
  ) {
    const product = await (this.prisma as any).product.findFirst({ where: { id: productId, organizationId } });
    if (!product) throw new NotFoundException("Product not found in this organization");
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const where = { organizationId, productId };
    const [total, rows] = await Promise.all([
      (this.prisma as any).stockMovement.count({ where }),
      (this.prisma as any).stockMovement.findMany({
        where, orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize, take: pageSize,
      }),
    ]);
    const variantIds = [...new Set((rows as any[]).map((r) => r.variantId).filter(Boolean))] as string[];
    const variants = variantIds.length
      ? await (this.prisma as any).productVariant.findMany({ where: { id: { in: variantIds } } })
      : [];
    const nameOf = new Map((variants as any[]).map((v) => [v.id, v.name]));
    return {
      total, page, pageSize,
      items: (rows as any[]).map((r) => ({
        ...r,
        variantName: r.variantId ? (nameOf.get(r.variantId) ?? null) : null,
      })),
    };
  }

  /**
   * AI-powered Inventory Runout Forecasting & Reorder Intelligence
   * Computes sales velocity (last N days), estimated runout days,
   * stock status (out_of_stock, critical, low, healthy, dead_stock),
   * suggested reorder quantity, and pre-formatted supplier WhatsApp PO message.
   */
  async getInventoryForecast(
    organizationId: string,
    options?: { lookbackDays?: number; targetCoverDays?: number },
  ) {
    const lookback = Math.max(7, Math.min(60, options?.lookbackDays ?? 14));
    const coverDays = Math.max(7, Math.min(90, options?.targetCoverDays ?? 21));
    const sinceDate = new Date(Date.now() - lookback * 24 * 3600 * 1000);

    const [products, recentOrders, org] = await Promise.all([
      (this.prisma as any).product.findMany({
        where: { organizationId, status: "ACTIVE" },
        select: {
          id: true,
          name: true,
          sku: true,
          priceMinor: true,
          stockQuantity: true,
          lowStockThreshold: true,
          imageUrl: true,
          category: true,
        },
      }),
      (this.prisma as any).order.findMany({
        where: {
          organizationId,
          status: { not: "cancelled" },
          createdAt: { gte: sinceDate },
        },
        select: {
          items: {
            select: {
              productId: true,
              sku: true,
              quantity: true,
            },
          },
        },
      }),
      (this.prisma as any).organization.findFirst({
        where: { id: organizationId },
        select: { name: true, brandName: true },
      }),
    ]);

    const storeName = org?.brandName || org?.name || "আমাদের স্টোর";

    // Aggregate sold quantities by productId and sku
    const soldByProductId = new Map<string, number>();
    const soldBySku = new Map<string, number>();

    for (const order of recentOrders ?? []) {
      for (const item of order.items ?? []) {
        const qty = Number(item.quantity || 1);
        if (item.productId) {
          soldByProductId.set(item.productId, (soldByProductId.get(item.productId) ?? 0) + qty);
        }
        if (item.sku) {
          soldBySku.set(item.sku, (soldBySku.get(item.sku) ?? 0) + qty);
        }
      }
    }

    let totalStockValueMinor = 0n;
    let potentialLostRevenueMinor = 0n;
    let outOfStockCount = 0;
    let criticalCount = 0;
    let lowStockCount = 0;
    let healthyCount = 0;
    let deadStockCount = 0;

    const items = (products ?? []).map((p: any) => {
      const unitsSold = soldByProductId.get(p.id) ?? (p.sku ? soldBySku.get(p.sku) ?? 0 : 0);
      const dailyVelocity = Math.round((unitsSold / lookback) * 10) / 10;
      const currentStock = typeof p.stockQuantity === "number" ? p.stockQuantity : null;
      const price = BigInt(p.priceMinor || 0);

      if (currentStock !== null && currentStock > 0) {
        totalStockValueMinor += BigInt(currentStock) * price;
      }

      let runoutDays: number | null = null;
      let status: "out_of_stock" | "critical" | "low" | "healthy" | "dead_stock" | "untracked" = "untracked";

      if (currentStock === null) {
        status = "untracked";
      } else if (currentStock <= 0) {
        status = "out_of_stock";
        outOfStockCount++;
        potentialLostRevenueMinor += BigInt(Math.max(1, Math.round(dailyVelocity * 7))) * price;
      } else if (dailyVelocity > 0) {
        runoutDays = Math.round(currentStock / dailyVelocity);
        if (runoutDays <= 4) {
          status = "critical";
          criticalCount++;
          potentialLostRevenueMinor += BigInt(Math.max(1, Math.round(dailyVelocity * 3))) * price;
        } else if (runoutDays <= 10) {
          status = "low";
          lowStockCount++;
        } else if (runoutDays > 45 && unitsSold <= 2) {
          status = "dead_stock";
          deadStockCount++;
        } else {
          status = "healthy";
          healthyCount++;
        }
      } else {
        // No sales in lookback period
        if (currentStock > 20) {
          status = "dead_stock";
          deadStockCount++;
          runoutDays = 999;
        } else {
          status = "healthy";
          healthyCount++;
          runoutDays = 999;
        }
      }

      // Suggested reorder quantity
      let suggestedReorder = 0;
      if (currentStock !== null) {
        if (dailyVelocity > 0) {
          const needed = Math.ceil(dailyVelocity * coverDays);
          suggestedReorder = Math.max(0, needed - currentStock);
        } else if (currentStock <= 0) {
          suggestedReorder = 10;
        }
      }

      // WhatsApp supplier message generator
      const supplierMessage = `আসসালামু আলাইকুম। ${storeName} থেকে বলছি। আমাদের "${p.name}"${p.sku ? ` (SKU: ${p.sku})` : ""} পণ্যটির স্টক শেষ পর্যায়ে (বর্তমান স্টক: ${currentStock ?? 0} পিস)। জরুরি ভিত্তিতে ${suggestedReorder > 0 ? suggestedReorder : 20} পিস প্রস্তুত করে পাঠানোর অনুরোধ করছি। অনুগ্রহ করে কনফার্ম করবেন। ধন্যবাদ!`;

      return {
        id: p.id,
        name: p.name,
        sku: p.sku ?? null,
        imageUrl: p.imageUrl ?? null,
        priceMinor: String(p.priceMinor),
        stockQuantity: currentStock,
        category: p.category ?? null,
        unitsSoldInWindow: unitsSold,
        dailyVelocity,
        runoutDays,
        status,
        suggestedReorder,
        supplierMessage,
      };
    });

    // Sort by urgency: out_of_stock -> critical -> low -> dead_stock -> healthy
    const urgencyOrder: Record<string, number> = {
      out_of_stock: 1,
      critical: 2,
      low: 3,
      dead_stock: 4,
      healthy: 5,
      untracked: 6,
    };
    items.sort((a: any, b: any) => (urgencyOrder[a.status] || 99) - (urgencyOrder[b.status] || 99));

    return {
      summary: {
        totalProducts: products.length,
        outOfStockCount,
        criticalCount,
        lowStockCount,
        healthyCount,
        deadStockCount,
        totalStockValueMinor: String(totalStockValueMinor),
        potentialLostRevenueMinor: String(potentialLostRevenueMinor),
        lookbackDays: lookback,
        targetCoverDays: coverDays,
      },
      items,
    };
  }
}
