import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { dhakaDayStartUtc } from "../crm/lead-followups";

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
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

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
      }
    }
    return { decremented, skipped };
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
      lines.push({ productId: item.productId ?? null, variantId, quantity: item.quantity });
    }
    return lines;
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

    const placed = await (this.prisma as any).stockMovement.findMany({
      where: { orderId, reason: "order_placed" },
    });
    if (!placed.length) return { restored: 0, skipped: 0 };
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
      }
    }
    return { restored, skipped };
  }

  // ---------- Manual adjustment ----------

  async adjust(
    organizationId: string,
    actorUserId: string,
    productId: string,
    input: { variantId?: string | null; delta?: number | null; setTo?: number | null; note?: string | null },
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
        delta: appliedDelta, balanceAfter: newBalance, reason: "manual_adjustment",
        actorUserId, note: input.note ?? null,
      },
    });
    await this.audit.log({
      organizationId, userId: actorUserId, action: "inventory.adjusted",
      entityType: "Product", entityId: productId,
      metadata: { productId, variantId: variant?.id ?? null, delta: appliedDelta, balanceAfter: newBalance },
    });
    await this.maybeLowStockAlert(organizationId, product, variant, current, newBalance);
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
}
