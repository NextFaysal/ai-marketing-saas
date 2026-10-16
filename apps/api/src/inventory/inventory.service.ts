import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { createAgentNotification } from "../common/agent-notify";
import { AuditService } from "../audit/audit.service";
import { CatalogPushService } from "../commerce/catalog-push.service";
import { EventsService } from "../common/events.service";
import { dhakaDayStartUtc } from "../crm/lead-followups";
import { parseBdAddress } from "../orders/bd-address";

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

/** GB2 (GC7): the merchant-facing stock-adjustment reason
 * vocabulary, enforced on the staff stock-adjustment endpoint
 * (StockAdjustmentDto). Internal flows keep their own system
 * reasons (SYSTEM_ADJUST_REASONS) — those never reach the
 * merchant form. Legacy free-text reasons already sitting in
 * the ledger stay readable as-is; the damage report counts
 * only the coded DAMAGE_REASONS. */
export const ADJUSTMENT_REASONS = [
  "damaged", "lost", "expired", "supplier_return", "correction", "other", "manual_adjustment",
] as const;
export const DAMAGE_REASONS = ["damaged", "lost", "expired"] as const;
export const SYSTEM_ADJUST_REASONS = [
  "purchase_receive", "return_restock", "stock_count", "ai_proposal",
] as const;

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

  // ---------- AB3 (AX4): bin layer ----------
  //
  // The per-bin truth (StockBalance) + claim state
  // (StockAllocation) described in docs/advanced-ab3-design.md
  // §3–§6. INVARIANT: for every TRACKED stock row,
  // Σ StockBalance.onHand over all bins == the global counter.
  // Every mutation below changes balances by the same net delta
  // as the global write, inside ONE transaction (the loyalty
  // $transaction pattern) covering {global write, balance
  // writes, movement writes, allocation writes}; alerts/push
  // stay outside, after the transaction, exactly as before AB3.
  //
  // MISSING-TABLE TOLERANCE (design §3, same pattern as
  // reservedQuantity): when the StockBalance/StockAllocation
  // tables are absent (pre-migration fakes, older spec
  // constructions) the bin layer is INACTIVE and every behaviour
  // is byte-identical to the pre-AB3 service — no binId on
  // movements, one movement per line, counts unchanged.

  /** Run `fn` inside a Prisma interactive transaction when the
   * client supports it (loyalty pattern); otherwise run it
   * against the root client (in-memory fakes have no
   * $transaction — the write group is then a plain sequence,
   * exactly like the pre-AB3 service). */
  private async stockTx<T>(fn: (db: any) => Promise<T>): Promise<T> {
    const p: any = this.prisma as any;
    if (typeof p.$transaction === "function") return p.$transaction(fn);
    return fn(p);
  }

  /** The bin layer is active only when ALL of its tables exist. */
  private binActive(db: any): boolean {
    return Boolean(
      db?.stockBalance?.findFirst && db?.stockAllocation?.create &&
      db?.warehouse?.findMany && db?.binLocation?.findMany &&
      db?.productBinAssignment?.findMany,
    );
  }

  private byCreatedThenId(a: any, b: any): number {
    const dt = new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();
    if (dt !== 0) return dt;
    return String(a.id ?? "").localeCompare(String(b.id ?? ""));
  }

  /** The current GLOBAL counter for a stock key (null =
   * untracked / row gone). Variant rows are keyed by id alone,
   * mirroring every existing read in this service. */
  private async globalCounterIn(db: any, organizationId: string, productId: string, variantId: string | null): Promise<number | null> {
    if (variantId) {
      const v = await db.productVariant.findFirst({ where: { id: variantId } }).catch(() => null);
      return v?.stockQuantity ?? null;
    }
    const p = await db.product.findFirst({ where: { id: productId, organizationId } }).catch(() => null);
    return p?.stockQuantity ?? null;
  }

  /**
   * Design §4.1 — THE default-bin resolver (in-transaction form).
   * 1. ProductBinAssignment for (product, variant): an
   *    assignment in a default warehouse of the org wins, else
   *    the earliest assignment (the SQL backfill's rule).
   * 2. Else the org's chosen default warehouse — isDefault
   *    first, else earliest createdAt, NO active filter
   *    (mirrors slice 1's SQL exactly) — and its earliest bin.
   * 3. Else lazily create "Main Warehouse" (isDefault) +
   *    "Main Bin" (code "MAIN").
   * Returns the bin row, or null when the bin layer is inactive.
   */
  private async resolveDefaultBinIn(db: any, organizationId: string, productId?: string | null, variantId?: string | null): Promise<any | null> {
    if (!this.binActive(db)) return null;
    const warehouses: any[] = ((await db.warehouse.findMany({ where: { organizationId } }).catch(() => [])) ?? []) as any[];
    const sortedWarehouses = [...warehouses].sort((a, b) => {
      const dd = Number(b.isDefault === true) - Number(a.isDefault === true);
      return dd !== 0 ? dd : this.byCreatedThenId(a, b);
    });
    if (productId) {
      const assignments: any[] = ((await db.productBinAssignment.findMany({
        where: { organizationId, productId, variantId: variantId ?? null },
      }).catch(() => [])) ?? []) as any[];
      const sortedAssignments = [...assignments].sort((a, b) => this.byCreatedThenId(a, b));
      const defaultWarehouseIds = new Set(warehouses.filter((w) => w.isDefault).map((w) => w.id));
      const chosen = sortedAssignments.find((a) => defaultWarehouseIds.has(a.warehouseId)) ?? sortedAssignments[0];
      if (chosen) {
        const bin = await db.binLocation.findFirst({ where: { id: chosen.binLocationId } }).catch(() => null);
        if (bin) return bin;
      }
    }
    let warehouse = sortedWarehouses[0] ?? null;
    if (!warehouse) {
      warehouse = await db.warehouse.create({
        data: { organizationId, name: "Main Warehouse", isDefault: true, active: true },
      });
    }
    const bins: any[] = ((await db.binLocation.findMany({ where: { warehouseId: warehouse.id } }).catch(() => [])) ?? []) as any[];
    const earliest = [...bins].sort((a, b) => this.byCreatedThenId(a, b))[0];
    if (earliest) return earliest;
    return db.binLocation.create({
      data: { organizationId, warehouseId: warehouse.id, code: "MAIN" },
    });
  }

  /** Public resolver (design §4.1). Null when the bin layer is
   * inactive. */
  async resolveDefaultBin(organizationId: string, productId?: string | null, variantId?: string | null): Promise<any | null> {
    if (!this.binActive(this.prisma as any)) return null;
    return this.stockTx((db) => this.resolveDefaultBinIn(db, organizationId, productId, variantId));
  }

  /**
   * Design §4.3 lazy seeding: when a TRACKED stock row has NO
   * StockBalance rows yet, create one at the resolved default
   * bin with onHand = qtyOverride ?? the current global counter.
   * Callers pass the PRE-mutation counter as qtyOverride when
   * they already hold it (or when the caller, e.g. a store sync,
   * has already overwritten the global). Returns true when a
   * row was seeded. Untracked rows never gain balances.
   */
  private async seedBalanceIfMissingIn(
    db: any, organizationId: string, productId: string, variantId: string | null, qtyOverride?: number | null,
  ): Promise<boolean> {
    if (!this.binActive(db)) return false;
    const existing = await db.stockBalance.findFirst({
      where: { organizationId, productId, variantId },
    }).catch(() => null);
    if (existing) return false;
    const counter = qtyOverride ?? (await this.globalCounterIn(db, organizationId, productId, variantId));
    if (counter == null) return false;
    const bin = await this.resolveDefaultBinIn(db, organizationId, productId, variantId);
    if (!bin) return false;
    await db.stockBalance.create({
      data: { organizationId, productId, variantId, binId: bin.id, onHand: counter, reserved: 0 },
    });
    return true;
  }

  /** Public, failure-isolated lazy seed — the products.service
   * hook target (a seeding failure never breaks a product
   * write). No-ops when the row already has balances, is
   * untracked, or the bin layer is inactive. */
  async seedBalanceIfMissing(organizationId: string, productId: string, variantId?: string | null): Promise<void> {
    try {
      await this.stockTx((db) => this.seedBalanceIfMissingIn(db, organizationId, productId, variantId ?? null));
    } catch (e) {
      this.logger.warn(`stock balance seed failed for product ${productId}: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  /** Find-then-write one bin's onHand by `delta` (the partial
   * unique indexes make a plain upsert unsafe for NULL
   * variantIds — design §2). Creates the row at `delta` when
   * the bin has no balance row for the key yet. */
  private async applyBinDeltaIn(
    db: any, organizationId: string, productId: string, variantId: string | null, binId: string, delta: number,
  ): Promise<void> {
    const row = await db.stockBalance.findFirst({
      where: { organizationId, productId, variantId, binId },
    }).catch(() => null);
    if (row) {
      await db.stockBalance.update({ where: { id: row.id }, data: { onHand: (row.onHand as number) + delta } });
    } else {
      await db.stockBalance.create({
        data: { organizationId, productId, variantId, binId, onHand: delta, reserved: 0 },
      });
    }
  }

  /** Design §3: a bin's `reserved` counter is RECOMPUTED from
   * its active, unexpired reservation rows at every reservation
   * mutation (expiry is lazy, so a stored counter without
   * recompute would drift). */
  private async refreshBinReservedIn(
    db: any, organizationId: string, productId: string, variantId: string | null, binId: string,
  ): Promise<void> {
    const table = db?.stockReservation;
    if (!table?.findMany || !db?.stockBalance?.findFirst) return;
    const rows: any[] = ((await table.findMany({
      where: { organizationId, productId, variantId, binId, state: "active", expiresAt: { gt: new Date() } },
    }).catch(() => [])) ?? []) as any[];
    const total = rows.reduce((sum: number, r: any) => sum + (Number(r.quantity) || 0), 0);
    const bal = await db.stockBalance.findFirst({
      where: { organizationId, productId, variantId, binId },
    }).catch(() => null);
    if (bal && bal.reserved !== total) {
      await db.stockBalance.update({ where: { id: bal.id }, data: { reserved: total } }).catch(() => null);
    }
  }

  /** Design §4.2 candidate warehouses: ACTIVE only, ordered
   * district-match first, priority ASC, isDefault first,
   * createdAt ASC. */
  private async warehouseCandidatesIn(db: any, organizationId: string, district: string | null): Promise<any[]> {
    const rows: any[] = ((await db.warehouse.findMany({
      where: { organizationId, active: true },
    }).catch(() => [])) ?? []) as any[];
    const wanted = (district ?? "").trim().toLowerCase();
    const serves = (w: any): boolean => {
      if (!wanted || !Array.isArray(w.serviceDistricts)) return false;
      return w.serviceDistricts.some((d: unknown) => String(d).trim().toLowerCase() === wanted);
    };
    return [...rows].sort((a, b) => {
      const dm = Number(serves(b)) - Number(serves(a));
      if (dm !== 0) return dm;
      const pr = (Number(a.priority) || 0) - (Number(b.priority) || 0);
      if (pr !== 0) return pr;
      const dd = Number(b.isDefault === true) - Number(a.isDefault === true);
      if (dd !== 0) return dd;
      return this.byCreatedThenId(a, b);
    });
  }

  /** Bins of ONE warehouse in §4.2 draw order: assignment bins
   * for this (product, variant) first (assignment createdAt
   * ASC), then the rest by onHand DESC, code ASC. Every bin of
   * the warehouse appears (onHand 0 when it has no balance row
   * for the key). */
  private async orderedBinsInWarehouseIn(
    db: any, organizationId: string, warehouseId: string, productId: string, variantId: string | null,
  ): Promise<Array<{ binId: string; onHand: number }>> {
    const bins: any[] = ((await db.binLocation.findMany({ where: { warehouseId } }).catch(() => [])) ?? []) as any[];
    if (!bins.length) return [];
    const balances: any[] = ((await db.stockBalance.findMany({
      where: { organizationId, productId, variantId },
    }).catch(() => [])) ?? []) as any[];
    const onHandByBin = new Map<string, number>(balances.map((b: any) => [b.binId, Number(b.onHand) || 0]));
    const assignments: any[] = ((await db.productBinAssignment.findMany({
      where: { organizationId, productId, variantId, warehouseId },
    }).catch(() => [])) ?? []) as any[];
    const binById = new Map(bins.map((b: any) => [b.id, b]));
    const ordered: Array<{ binId: string; onHand: number }> = [];
    const seen = new Set<string>();
    for (const a of [...assignments].sort((x, y) => this.byCreatedThenId(x, y))) {
      if (!binById.has(a.binLocationId) || seen.has(a.binLocationId)) continue;
      seen.add(a.binLocationId);
      ordered.push({ binId: a.binLocationId, onHand: onHandByBin.get(a.binLocationId) ?? 0 });
    }
    const rest = bins.filter((b: any) => !seen.has(b.id)).map((b: any) => ({
      binId: b.id as string, onHand: onHandByBin.get(b.id) ?? 0, code: String(b.code ?? ""),
    }));
    rest.sort((a, b) => (b.onHand - a.onHand) || a.code.localeCompare(b.code));
    for (const r of rest) ordered.push({ binId: r.binId, onHand: r.onHand });
    return ordered;
  }

  /** The bin a remainder lands in INSIDE one warehouse: the
   * assignment bin for the key in that warehouse, else its
   * earliest bin, else a lazily created "MAIN" bin. */
  private async resolveBinInWarehouseIn(
    db: any, organizationId: string, warehouseId: string, productId: string, variantId: string | null,
  ): Promise<any> {
    const assignments: any[] = ((await db.productBinAssignment.findMany({
      where: { organizationId, productId, variantId, warehouseId },
    }).catch(() => [])) ?? []) as any[];
    const first = [...assignments].sort((a, b) => this.byCreatedThenId(a, b))[0];
    if (first) {
      const bin = await db.binLocation.findFirst({ where: { id: first.binLocationId } }).catch(() => null);
      if (bin) return bin;
    }
    const bins: any[] = ((await db.binLocation.findMany({ where: { warehouseId } }).catch(() => [])) ?? []) as any[];
    const earliest = [...bins].sort((a, b) => this.byCreatedThenId(a, b))[0];
    if (earliest) return earliest;
    return db.binLocation.create({ data: { organizationId, warehouseId, code: "MAIN" } });
  }

  private mergeDraw(draws: Array<{ binId: string; warehouseId: string; qty: number }>, binId: string, warehouseId: string, qty: number): void {
    const existing = draws.find((d) => d.binId === binId);
    if (existing) existing.qty += qty;
    else draws.push({ binId, warehouseId, qty });
  }

  /**
   * Design §5.1 — plan a draw of `qty` units of a stock key
   * across warehouses: candidates per §4.2, each bin drawn to
   * zero before falling through; any remainder over-draws the
   * FIRST candidate warehouse's resolved-in-that-warehouse
   * default bin (COD oversell is real — a bin may go negative,
   * exactly like the global counter). An org with NO warehouses
   * at all draws everything from the §4.1 resolved default bin
   * (which lazily creates Main Warehouse/Main Bin).
   */
  private async planDrawIn(
    db: any, organizationId: string, productId: string, variantId: string | null, qty: number, district: string | null,
  ): Promise<Array<{ binId: string; warehouseId: string; qty: number }>> {
    if (qty <= 0) return [];
    const candidates = await this.warehouseCandidatesIn(db, organizationId, district);
    if (!candidates.length) {
      const bin = await this.resolveDefaultBinIn(db, organizationId, productId, variantId);
      if (!bin) return [];
      return [{ binId: bin.id, warehouseId: bin.warehouseId, qty }];
    }
    const draws: Array<{ binId: string; warehouseId: string; qty: number }> = [];
    let remaining = qty;
    for (const wh of candidates) {
      if (remaining <= 0) break;
      const bins = await this.orderedBinsInWarehouseIn(db, organizationId, wh.id, productId, variantId);
      for (const b of bins) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, Math.max(b.onHand, 0));
        if (take > 0) { this.mergeDraw(draws, b.binId, wh.id, take); remaining -= take; }
      }
    }
    if (remaining > 0) {
      const first = candidates[0];
      const bin = await this.resolveBinInWarehouseIn(db, organizationId, first.id, productId, variantId);
      if (bin) this.mergeDraw(draws, bin.id, first.id, remaining);
    }
    return draws;
  }

  /** Draw `qty` from ONE warehouse by the §4.2 within-warehouse
   * order; the remainder over-draws that warehouse's resolved
   * default bin. Used by staff re-allocation (§5.3). */
  private async drawWithinWarehouseIn(
    db: any, organizationId: string, warehouseId: string, productId: string, variantId: string | null, qty: number,
  ): Promise<Array<{ binId: string; warehouseId: string; qty: number }>> {
    const draws: Array<{ binId: string; warehouseId: string; qty: number }> = [];
    let remaining = qty;
    const bins = await this.orderedBinsInWarehouseIn(db, organizationId, warehouseId, productId, variantId);
    for (const b of bins) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, Math.max(b.onHand, 0));
      if (take > 0) { this.mergeDraw(draws, b.binId, warehouseId, take); remaining -= take; }
    }
    if (remaining > 0) {
      const bin = await this.resolveBinInWarehouseIn(db, organizationId, warehouseId, productId, variantId);
      if (bin) this.mergeDraw(draws, bin.id, warehouseId, remaining);
    }
    return draws;
  }

  /** The order's district, derived exactly like
   * fulfillment-excellence's districtOf: structured
   * address.district first, else parseBdAddress over the
   * address text (the order's customer address, falling back
   * to an address carried on the order row itself, which may
   * be a string or a Json object). Failure-isolated: any load
   * problem yields null (priority order then decides). */
  private districtOfOrder(order: any): string | null {
    const customer = order?.customer ?? null;
    const address = customer?.address ?? null;
    if (address && typeof address === "object" && address.district) return String(address.district);
    let text = "";
    if (typeof address === "string") text = address;
    else if (address && typeof address === "object") text = String(address.address_1 ?? address.address1 ?? "");
    if (!text) {
      const own = order?.address;
      if (typeof own === "string") text = own;
      else if (own && typeof own === "object") {
        if (own.district) return String(own.district);
        text = String(own.address_1 ?? own.address1 ?? "");
      }
    }
    if (!text) return null;
    return parseBdAddress(text).district;
  }

  private async orderDistrict(orderId: string): Promise<string | null> {
    try {
      const p: any = this.prisma as any;
      if (!p.order?.findFirst) return null;
      const order = await p.order.findFirst({ where: { id: orderId } }).catch(() => null);
      if (!order) return null;
      let customer = (order as any).customer ?? null;
      if (!customer && order.customerId && p.customer?.findFirst) {
        customer = await p.customer.findFirst({ where: { id: order.customerId } }).catch(() => null);
      }
      return this.districtOfOrder(customer ? { ...order, customer } : order);
    } catch {
      return null;
    }
  }

  /** OrderItem refs for allocation orderItemId matching, using
   * the SAME (productId, sku) variant rule as loadOrderLines. */
  private async loadOrderItemRefs(orderId: string): Promise<Array<{ id: string; productId: string | null; variantId: string | null }>> {
    const items = await (this.prisma as any).orderItem.findMany({ where: { orderId } }).catch(() => []);
    const refs: Array<{ id: string; productId: string | null; variantId: string | null }> = [];
    for (const item of items as any[]) {
      let variantId: string | null = null;
      if (item.productId && (item.externalVariationId || item.sku) && item.sku) {
        const variant = await (this.prisma as any).productVariant.findFirst({
          where: { productId: item.productId, sku: item.sku },
        }).catch(() => null);
        variantId = variant?.id ?? null;
      }
      refs.push({ id: item.id, productId: item.productId ?? null, variantId });
    }
    return refs;
  }

  /** An order's ACTIVE allocation rows (one stock key when
   * productId is given, the whole order otherwise), in
   * allocation (createdAt) order. */
  private async activeAllocationsIn(
    db: any, organizationId: string, orderId: string, productId?: string, variantId?: string | null,
  ): Promise<any[]> {
    if (!db?.stockAllocation?.findMany) return [];
    const where: any = { organizationId, orderId, status: "active" };
    if (productId !== undefined) { where.productId = productId; where.variantId = variantId ?? null; }
    const rows: any[] = ((await db.stockAllocation.findMany({ where }).catch(() => [])) ?? []) as any[];
    return [...rows].sort((a, b) => this.byCreatedThenId(a, b));
  }

  private async settleAllocationsIn(
    db: any, organizationId: string, orderId: string, productId: string, variantId: string | null,
  ): Promise<void> {
    const rows = await this.activeAllocationsIn(db, organizationId, orderId, productId, variantId);
    for (const row of rows) {
      await db.stockAllocation.update({ where: { id: row.id }, data: { status: "settled" } }).catch(() => null);
    }
  }

  /**
   * The bin side of a DEDUCTION inside a transaction: plan the
   * draw (§5.1), write one StockMovement per bin drawn (binId
   * set, balanceAfter = the GLOBAL balance after, as always)
   * and one StockAllocation per draw. The caller performs the
   * global write + lazy seed inside the same transaction.
   */
  private async deductPortionsIn(
    db: any, organizationId: string, orderId: string, productId: string, variantId: string | null,
    qty: number, district: string | null, orderItemId: string | null,
    reason: string, balanceAfter: number,
  ): Promise<void> {
    const draws = await this.planDrawIn(db, organizationId, productId, variantId, qty, district);
    for (const d of draws) {
      await this.applyBinDeltaIn(db, organizationId, productId, variantId, d.binId, -d.qty);
      await db.stockMovement.create({
        data: {
          organizationId, productId, variantId,
          delta: -d.qty, balanceAfter, reason, orderId, binId: d.binId,
        },
      });
      await db.stockAllocation.create({
        data: {
          organizationId, orderId, orderItemId: orderItemId ?? null,
          productId, variantId, binId: d.binId, warehouseId: d.warehouseId,
          qty: d.qty, status: "active",
        },
      });
    }
  }

  /**
   * Restore crediting state shared by Phase A and Phase B of
   * ONE applyOrderRestore call: allocation row id → qty already
   * credited back during this restore. Phase A credits the
   * placed quantity across the order's CURRENT allocations;
   * Phase B's positive diff must continue where Phase A stopped
   * (the rows keep their full qty until they are settled at the
   * end), so without this ledger Phase B would double-credit
   * the bins Phase A already filled.
   */
  private async creditRestorePortionsIn(
    db: any, organizationId: string, orderId: string, productId: string, variantId: string | null,
    qty: number, ledger: Map<string, number>,
  ): Promise<Array<{ binId: string; qty: number }>> {
    const portions: Array<{ binId: string; qty: number }> = [];
    let remaining = qty;
    if (remaining > 0) {
      const allocations = await this.activeAllocationsIn(db, organizationId, orderId, productId, variantId);
      for (const a of allocations) {
        if (remaining <= 0) break;
        const alreadyCredited = ledger.get(a.id) ?? 0;
        const room = (a.qty as number) - alreadyCredited;
        if (room <= 0) continue;
        const take = Math.min(remaining, room);
        ledger.set(a.id, alreadyCredited + take);
        portions.push({ binId: a.binId, qty: take });
        remaining -= take;
      }
    }
    if (remaining > 0) {
      // No (or insufficient) allocations — a pre-AB3 order: the
      // remainder lands in the resolved default bin.
      const bin = await this.resolveDefaultBinIn(db, organizationId, productId, variantId);
      if (bin) portions.push({ binId: bin.id, qty: remaining });
    }
    return portions;
  }

  /**
   * Credit `qty` back into an order's allocation bins in
   * REVERSE allocation order, SHRINKING the allocation rows
   * (deleted at zero) — the applyOrderEditDelta negative side
   * (§5.2: an edit that un-sells units releases the claim,
   * newest claim first). Any remainder (no/insufficient
   * allocations) goes to the resolved default bin. Returns the
   * credited portions for per-portion movement writes.
   */
  private async creditAllocationsReverseIn(
    db: any, organizationId: string, orderId: string, productId: string, variantId: string | null, qty: number,
  ): Promise<Array<{ binId: string; qty: number }>> {
    const portions: Array<{ binId: string; qty: number }> = [];
    let remaining = qty;
    const allocations = await this.activeAllocationsIn(db, organizationId, orderId, productId, variantId);
    for (const a of [...allocations].reverse()) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, a.qty as number);
      if (take <= 0) continue;
      if (take === (a.qty as number)) {
        await db.stockAllocation.delete({ where: { id: a.id } }).catch(() => null);
      } else {
        await db.stockAllocation.update({ where: { id: a.id }, data: { qty: (a.qty as number) - take } }).catch(() => null);
      }
      portions.push({ binId: a.binId, qty: take });
      remaining -= take;
    }
    if (remaining > 0) {
      const bin = await this.resolveDefaultBinIn(db, organizationId, productId, variantId);
      if (bin) portions.push({ binId: bin.id, qty: remaining });
    }
    for (const portion of portions) {
      await this.applyBinDeltaIn(db, organizationId, productId, variantId, portion.binId, portion.qty);
    }
    return portions;
  }

  /**
   * ON3 surgery (§5.2): move up to `qty` of the from-order's
   * active allocations for a stock key to the to-order — shrink
   * or delete the from rows, create (or top up) to-order rows on
   * the SAME bins/warehouses. Balances never move: the stock
   * never moved, only the claim did. Returns the first moved
   * bin (for stamping the paired ledger movements), or null
   * when the from-order holds no allocations for the key.
   * Moved rows carry orderItemId null: the to-order's items are
   * different rows, and a stale item link would be a lie.
   */
  private async moveAllocationsIn(
    db: any, organizationId: string, fromOrderId: string, toOrderId: string,
    productId: string, variantId: string | null, qty: number,
  ): Promise<string | null> {
    const allocations = await this.activeAllocationsIn(db, organizationId, fromOrderId, productId, variantId);
    let remaining = qty;
    let firstBinId: string | null = null;
    for (const a of allocations) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, a.qty as number);
      if (take <= 0) continue;
      firstBinId = firstBinId ?? a.binId;
      if (take === (a.qty as number)) {
        await db.stockAllocation.delete({ where: { id: a.id } }).catch(() => null);
      } else {
        await db.stockAllocation.update({ where: { id: a.id }, data: { qty: (a.qty as number) - take } }).catch(() => null);
      }
      const existing = (await this.activeAllocationsIn(db, organizationId, toOrderId, productId, variantId))
        .find((r: any) => r.binId === a.binId);
      if (existing) {
        await db.stockAllocation.update({ where: { id: existing.id }, data: { qty: (existing.qty as number) + take } }).catch(() => null);
      } else {
        await db.stockAllocation.create({
          data: {
            organizationId, orderId: toOrderId, orderItemId: null,
            productId, variantId, binId: a.binId, warehouseId: a.warehouseId,
            qty: take, status: "active",
          },
        });
      }
      remaining -= take;
    }
    return firstBinId;
  }

  /**
   * Design §4.3(b) — idempotent service backfill: for every
   * tracked product/variant row with NO StockBalance rows, seed
   * one at the resolved default bin with onHand = the global
   * counter (the service twin of the migration SQL + the
   * deploy script). Returns { seeded, skipped } where skipped
   * counts tracked rows that already had balances.
   */
  async backfillStockBalances(organizationId?: string): Promise<{ seeded: number; skipped: number }> {
    let seeded = 0;
    let skipped = 0;
    const p: any = this.prisma as any;
    if (!this.binActive(p)) return { seeded, skipped };
    let orgIds: string[] = [];
    if (organizationId) orgIds = [organizationId];
    else {
      if (!p.organization?.findMany) return { seeded, skipped };
      const orgs: any[] = ((await p.organization.findMany({}).catch(() => [])) ?? []) as any[];
      orgIds = orgs.map((o: any) => o.id as string);
    }
    for (const orgId of orgIds) {
      const products: any[] = ((await p.product.findMany({ where: { organizationId: orgId } }).catch(() => [])) ?? []) as any[];
      for (const product of products) {
        if (product.stockQuantity != null) {
          const did = await this.stockTx((db) => this.seedBalanceIfMissingIn(db, orgId, product.id, null)).catch(() => false);
          if (did) seeded++; else skipped++;
        }
        const variants: any[] = ((await p.productVariant.findMany({ where: { productId: product.id } }).catch(() => [])) ?? []) as any[];
        for (const variant of variants) {
          if (variant.stockQuantity == null) continue;
          const did = await this.stockTx((db) => this.seedBalanceIfMissingIn(db, orgId, product.id, variant.id)).catch(() => false);
          if (did) seeded++; else skipped++;
        }
      }
    }
    return { seeded, skipped };
  }

  /**
   * AB3 public primitive (design §6, used by the warehouse
   * transfer slice): move stock between bins WITHOUT touching
   * the global counter — the movement's balanceAfter is the
   * current (unchanged) global. Unlike the failure-isolated
   * hooks, this THROWS when the bin layer is inactive:
   * transfers must never silently no-op.
   */
  async applyBinOnlyDelta(
    organizationId: string,
    input: {
      productId: string; variantId?: string | null; binId: string; delta: number;
      reason: string; orderId?: string | null; actorUserId?: string | null; note?: string | null;
      refuseNegative?: boolean;
    },
  ): Promise<{ binId: string; onHand: number; movement: any }> {
    const p: any = this.prisma as any;
    if (!this.binActive(p)) {
      throw new BadRequestException("বিন-ভিত্তিক স্টক স্তর সক্রিয় নয় — এই কাজটি করা যাচ্ছে না।");
    }
    const bin = await p.binLocation.findFirst({
      where: { id: input.binId, organizationId },
    }).catch(() => null);
    if (!bin) throw new BadRequestException("নির্দিষ্ট বিনটি এই প্রতিষ্ঠানে পাওয়া যায়নি।");
    const variantId = input.variantId ?? null;
    return this.stockTx(async (db) => {
      const current = await this.globalCounterIn(db, organizationId, input.productId, variantId);
      if (current == null) {
        throw new BadRequestException("এই পণ্যের স্টক ট্র্যাক করা হচ্ছে না — আগে পণ্যের স্টক সংখ্যা বসান");
      }
      await this.seedBalanceIfMissingIn(db, organizationId, input.productId, variantId, current);
      const bal = await db.stockBalance.findFirst({
        where: { organizationId, productId: input.productId, variantId, binId: input.binId },
      }).catch(() => null);
      const binOnHand = (bal?.onHand as number) ?? 0;
      if (input.refuseNegative && binOnHand + input.delta < 0) {
        throw new BadRequestException("এই বিনে পর্যাপ্ত স্টক নেই — ট্রান্সফার করা যাচ্ছে না।");
      }
      await this.applyBinDeltaIn(db, organizationId, input.productId, variantId, input.binId, input.delta);
      const movement = await db.stockMovement.create({
        data: {
          organizationId, productId: input.productId, variantId,
          delta: input.delta, balanceAfter: current, reason: input.reason,
          orderId: input.orderId ?? null, actorUserId: input.actorUserId ?? null,
          note: input.note ?? null, binId: input.binId,
        },
      });
      return { binId: input.binId, onHand: binOnHand + input.delta, movement };
    });
  }

  /**
   * Design §5.3 — staff re-allocation: move an order's ACTIVE
   * allocations to a chosen warehouse. Per allocation row: the
   * qty is credited back to its current bin, drawn from the
   * target warehouse by the §4.2 within-warehouse order
   * (over-draw into the target's resolved default bin when it
   * lacks stock — the same oversell honesty as placement), and
   * the allocation row is re-pointed/split to the new bins. A
   * paired movement set (reallocation_out −qty from the old
   * bin, reallocation_in +qty into the new bin, balanceAfter =
   * the UNCHANGED global) explains the attribution move; the
   * global counter NEVER changes and no order_placed/order_edit
   * movement is touched, so restore math is unaffected —
   * restore reads the CURRENT allocations, which is exactly
   * why this is safe. Audited as inventory.reallocated.
   */
  async reallocateOrderBins(
    organizationId: string,
    orderId: string,
    targetWarehouseId: string,
    actorUserId?: string | null,
  ): Promise<{ moved: number; allocations: any[] }> {
    const p: any = this.prisma as any;
    const existing = this.binActive(p)
      ? await this.activeAllocationsIn(p, organizationId, orderId)
      : [];
    if (!existing.length) {
      throw new BadRequestException("এই অর্ডারে সক্রিয় স্টক বরাদ্দ নেই — পুনঃবরাদ্দ করা যাচ্ছে না।");
    }
    const target = await p.warehouse.findFirst({
      where: { id: targetWarehouseId, organizationId },
    }).catch(() => null);
    if (!target) throw new NotFoundException("Target warehouse not found in this organization");
    if (!target.active) {
      throw new BadRequestException("লক্ষ্য গুদামটি নিষ্ক্রিয় — সক্রিয় একটি গুদাম বেছে নিন।");
    }
    const result = await this.stockTx(async (db) => {
      const rows = await this.activeAllocationsIn(db, organizationId, orderId);
      const globalByKey = new Map<string, number>();
      const newRows: any[] = [];
      let moved = 0;
      for (const alloc of rows) {
        const key = `${alloc.productId}::${alloc.variantId ?? ""}`;
        if (!globalByKey.has(key)) {
          globalByKey.set(key, (await this.globalCounterIn(db, organizationId, alloc.productId, alloc.variantId ?? null)) ?? 0);
        }
        const balanceAfter = globalByKey.get(key) as number;
        const qty = alloc.qty as number;
        // Credit the current bin back FIRST — when the target
        // IS the source warehouse, the credited units are then
        // drawable by the within-warehouse draw below.
        await this.applyBinDeltaIn(db, organizationId, alloc.productId, alloc.variantId ?? null, alloc.binId, qty);
        await db.stockMovement.create({
          data: {
            organizationId, productId: alloc.productId, variantId: alloc.variantId ?? null,
            delta: -qty, balanceAfter, reason: "reallocation_out", orderId,
            actorUserId: actorUserId ?? null, binId: alloc.binId,
          },
        });
        const draws = await this.drawWithinWarehouseIn(db, organizationId, targetWarehouseId, alloc.productId, alloc.variantId ?? null, qty);
        let first = true;
        for (const d of draws) {
          await this.applyBinDeltaIn(db, organizationId, alloc.productId, alloc.variantId ?? null, d.binId, -d.qty);
          await db.stockMovement.create({
            data: {
              organizationId, productId: alloc.productId, variantId: alloc.variantId ?? null,
              delta: d.qty, balanceAfter, reason: "reallocation_in", orderId,
              actorUserId: actorUserId ?? null, binId: d.binId,
            },
          });
          if (first) {
            const updated = await db.stockAllocation.update({
              where: { id: alloc.id },
              data: { binId: d.binId, warehouseId: targetWarehouseId, qty: d.qty },
            });
            newRows.push(updated);
            first = false;
          } else {
            const created = await db.stockAllocation.create({
              data: {
                organizationId, orderId, orderItemId: alloc.orderItemId ?? null,
                productId: alloc.productId, variantId: alloc.variantId ?? null,
                binId: d.binId, warehouseId: targetWarehouseId, qty: d.qty, status: "active",
              },
            });
            newRows.push(created);
          }
        }
        moved += qty;
      }
      return { moved, allocations: newRows };
    });
    await this.audit.log({
      organizationId, userId: actorUserId ?? undefined, action: "inventory.reallocated",
      entityType: "Order", entityId: orderId,
      metadata: { orderId, targetWarehouseId, movedQty: result.moved },
    });
    return result;
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
    // AB3: when the bin layer is active, the order's district
    // (for §4.2 routing) and its OrderItem refs (for allocation
    // orderItemId) are loaded ONCE per call. Both loads are
    // failure-isolated and skipped entirely when the layer is
    // inactive, keeping the legacy path byte-identical.
    const binOn = this.binActive(this.prisma as any);
    const district = binOn ? await this.orderDistrict(orderId) : null;
    const itemRefs = binOn ? await this.loadOrderItemRefs(orderId).catch(() => [] as Array<{ id: string; productId: string | null; variantId: string | null }>) : [];
    const usedRefs = new Set<string>();
    const refFor = (productId: string, variantId: string | null): string | null => {
      const ref = itemRefs.find((r) => !usedRefs.has(r.id) && r.productId === productId && (r.variantId ?? null) === variantId);
      if (ref) { usedRefs.add(ref.id); return ref.id; }
      return null;
    };
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
        // AB3: {seed, global write, balance writes, movements,
        // allocations} land in ONE transaction; alerts/push stay
        // after it. In the single-bin world the draw produces
        // exactly one movement, identical to the pre-AB3 write.
        await this.stockTx(async (db) => {
          const active = this.binActive(db);
          if (active) await this.seedBalanceIfMissingIn(db, organizationId, line.productId as string, variantId, prev);
          await db.productVariant.update({
            where: { id: variant.id }, data: { stockQuantity: balanceAfter, ...this.oosRearm(variant, balanceAfter) },
          });
          if (active) {
            await this.deductPortionsIn(db, organizationId, orderId, line.productId as string, variantId, line.quantity, district, refFor(line.productId as string, variantId), "order_placed", balanceAfter);
          } else {
            await db.stockMovement.create({
              data: {
                organizationId, productId: line.productId, variantId,
                delta: -line.quantity, balanceAfter, reason: "order_placed", orderId,
              },
            });
          }
        });
        decremented++;
        const product = await (this.prisma as any).product.findFirst({ where: { id: line.productId, organizationId } });
        if (product) await this.maybeLowStockAlert(organizationId, product, variant, prev, balanceAfter);
        if (product) await this.maybeOutOfStockAlert(organizationId, product, variant, prev, balanceAfter);
        await this.notifyStockPush(organizationId, line.productId, variantId, balanceAfter);
        // EC4: bundle expansion keys off the PARENT product,
        // regardless of which variant of it sold — composition is
        // defined per parent product.
        await this.decrementBundleComponents(organizationId, orderId, line.productId, line.quantity, district);
      } else {
        const product = await (this.prisma as any).product.findFirst({ where: { id: line.productId, organizationId } });
        if (!product || product.stockQuantity == null) { skipped++; continue; }
        const prev = product.stockQuantity as number;
        const balanceAfter = prev - line.quantity;
        await this.stockTx(async (db) => {
          const active = this.binActive(db);
          if (active) await this.seedBalanceIfMissingIn(db, organizationId, line.productId as string, null, prev);
          await db.product.update({
            where: { id: product.id }, data: { stockQuantity: balanceAfter, ...this.oosRearm(product, balanceAfter) },
          });
          if (active) {
            await this.deductPortionsIn(db, organizationId, orderId, line.productId as string, null, line.quantity, district, refFor(line.productId as string, null), "order_placed", balanceAfter);
          } else {
            await db.stockMovement.create({
              data: {
                organizationId, productId: line.productId, variantId: null,
                delta: -line.quantity, balanceAfter, reason: "order_placed", orderId,
              },
            });
          }
        });
        decremented++;
        await this.maybeLowStockAlert(organizationId, product, null, prev, balanceAfter);
        await this.maybeOutOfStockAlert(organizationId, product, null, prev, balanceAfter);
        await this.notifyStockPush(organizationId, line.productId, null, balanceAfter);
        await this.decrementBundleComponents(organizationId, orderId, line.productId, line.quantity, district);
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
    district: string | null = null,
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
            // AB3: component draws use the same §5.1 rule (their
            // own candidate walk, the order's district);
            // allocations carry orderItemId null — components are
            // not order items.
            await this.stockTx(async (db) => {
              const active = this.binActive(db);
              if (active) await this.seedBalanceIfMissingIn(db, organizationId, componentProductId, componentVariantId, prev);
              await db.productVariant.update({
                where: { id: variant.id }, data: { stockQuantity: balanceAfter, ...this.oosRearm(variant, balanceAfter) },
              });
              if (active) {
                await this.deductPortionsIn(db, organizationId, orderId, componentProductId, componentVariantId, needed, district, null, "bundle_component", balanceAfter);
              } else {
                await db.stockMovement.create({
                  data: {
                    organizationId, productId: componentProductId, variantId: componentVariantId,
                    delta: -needed, balanceAfter, reason: "bundle_component", orderId,
                  },
                });
              }
            });
            const componentProduct = await (this.prisma as any).product.findFirst({
              where: { id: componentProductId, organizationId },
            });
            if (componentProduct) await this.maybeLowStockAlert(organizationId, componentProduct, variant, prev, balanceAfter);
            if (componentProduct) await this.maybeOutOfStockAlert(organizationId, componentProduct, variant, prev, balanceAfter);
            await this.notifyStockPush(organizationId, componentProductId, componentVariantId, balanceAfter);
          } else {
            const componentProduct = await (this.prisma as any).product.findFirst({
              where: { id: componentProductId, organizationId },
            });
            if (!componentProduct || componentProduct.stockQuantity == null) continue;
            const prev = componentProduct.stockQuantity as number;
            const balanceAfter = prev - needed;
            await this.stockTx(async (db) => {
              const active = this.binActive(db);
              if (active) await this.seedBalanceIfMissingIn(db, organizationId, componentProductId, null, prev);
              await db.product.update({
                where: { id: componentProduct.id }, data: { stockQuantity: balanceAfter, ...this.oosRearm(componentProduct, balanceAfter) },
              });
              if (active) {
                await this.deductPortionsIn(db, organizationId, orderId, componentProductId, null, needed, district, null, "bundle_component", balanceAfter);
              } else {
                await db.stockMovement.create({
                  data: {
                    organizationId, productId: componentProductId, variantId: null,
                    delta: -needed, balanceAfter, reason: "bundle_component", orderId,
                  },
                });
              }
            });
            await this.maybeLowStockAlert(organizationId, componentProduct, null, prev, balanceAfter);
            await this.maybeOutOfStockAlert(organizationId, componentProduct, null, prev, balanceAfter);
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
    // AB3: the order's district (for §5.1 draws on positive
    // deltas) is loaded once, only when the bin layer is active.
    const district = this.binActive(this.prisma as any) ? await this.orderDistrict(orderId) : null;
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
      // AB3 write group for one edit line: seed (pre-edit
      // global) → global write → bin side, in ONE transaction.
      // Positive deltaQty draws MORE by the §5.1 rule and
      // extends allocations (deductPortionsIn); negative credits
      // back into the order's allocation bins in REVERSE
      // allocation order, shrinking the rows
      // (creditAllocationsReverseIn). The order_edit movement
      // gains binId — one movement per bin portion when the
      // delta splits across bins; { adjusted, skipped } still
      // count LINES, exactly as before.
      const writeLine = async (row: any, isVariant: boolean, variantId: string | null, prev: number, balanceAfter: number) => {
        await this.stockTx(async (db) => {
          const active = this.binActive(db);
          if (active) await this.seedBalanceIfMissingIn(db, organizationId, line.productId as string, variantId, prev);
          if (isVariant) {
            await db.productVariant.update({
              where: { id: row.id }, data: { stockQuantity: balanceAfter, ...this.oosRearm(row, balanceAfter) },
            });
          } else {
            await db.product.update({
              where: { id: row.id }, data: { stockQuantity: balanceAfter, ...this.oosRearm(row, balanceAfter) },
            });
          }
          if (!active) {
            await db.stockMovement.create({
              data: {
                organizationId, productId: line.productId, variantId,
                delta: -deltaQty, balanceAfter, reason: "order_edit", orderId,
              },
            });
          } else if (deltaQty > 0) {
            await this.deductPortionsIn(db, organizationId, orderId, line.productId as string, variantId, deltaQty, district, null, "order_edit", balanceAfter);
          } else {
            const portions = await this.creditAllocationsReverseIn(db, organizationId, orderId, line.productId as string, variantId, -deltaQty);
            for (const portion of portions) {
              await db.stockMovement.create({
                data: {
                  organizationId, productId: line.productId, variantId,
                  delta: portion.qty, balanceAfter, reason: "order_edit", orderId, binId: portion.binId,
                },
              });
            }
          }
        });
      };
      let applied = false;
      if (variant) {
        if (variant.stockQuantity == null) { skipped++; continue; }
        const prev = variant.stockQuantity as number;
        const balanceAfter = prev - deltaQty;
        await writeLine(variant, true, variant.id, prev, balanceAfter);
        adjusted++;
        applied = true;
        const product = await (this.prisma as any).product.findFirst({ where: { id: line.productId, organizationId } });
        if (product) await this.maybeLowStockAlert(organizationId, product, variant, prev, balanceAfter);
        if (product) await this.maybeOutOfStockAlert(organizationId, product, variant, prev, balanceAfter);
        await this.notifyStockPush(organizationId, line.productId, variant.id, balanceAfter);
      } else {
        const product = await (this.prisma as any).product.findFirst({ where: { id: line.productId, organizationId } });
        if (!product || product.stockQuantity == null) { skipped++; continue; }
        const prev = product.stockQuantity as number;
        const balanceAfter = prev - deltaQty;
        await writeLine(product, false, null, prev, balanceAfter);
        adjusted++;
        applied = true;
        await this.maybeLowStockAlert(organizationId, product, null, prev, balanceAfter);
        await this.maybeOutOfStockAlert(organizationId, product, null, prev, balanceAfter);
        await this.notifyStockPush(organizationId, line.productId, null, balanceAfter);
      }
      if (applied) {
        await this.editBundleComponents(organizationId, orderId, line.productId, deltaQty, district);
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
    district: string | null = null,
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
            // AB3: signed mirror of the sold-line treatment —
            // needed > 0 draws by §5.1, needed < 0 credits the
            // component's allocation bins in reverse order.
            await this.stockTx(async (db) => {
              const active = this.binActive(db);
              if (active) await this.seedBalanceIfMissingIn(db, organizationId, componentProductId, componentVariantId, prev);
              await db.productVariant.update({
                where: { id: variant.id }, data: { stockQuantity: balanceAfter, ...this.oosRearm(variant, balanceAfter) },
              });
              if (!active) {
                await db.stockMovement.create({
                  data: {
                    organizationId, productId: componentProductId, variantId: componentVariantId,
                    delta: -needed, balanceAfter, reason: "order_edit", orderId,
                  },
                });
              } else if (needed > 0) {
                await this.deductPortionsIn(db, organizationId, orderId, componentProductId, componentVariantId, needed, district, null, "order_edit", balanceAfter);
              } else {
                const portions = await this.creditAllocationsReverseIn(db, organizationId, orderId, componentProductId, componentVariantId, -needed);
                for (const portion of portions) {
                  await db.stockMovement.create({
                    data: {
                      organizationId, productId: componentProductId, variantId: componentVariantId,
                      delta: portion.qty, balanceAfter, reason: "order_edit", orderId, binId: portion.binId,
                    },
                  });
                }
              }
            });
            const componentProduct = await (this.prisma as any).product.findFirst({
              where: { id: componentProductId, organizationId },
            });
            if (componentProduct) await this.maybeLowStockAlert(organizationId, componentProduct, variant, prev, balanceAfter);
            if (componentProduct) await this.maybeOutOfStockAlert(organizationId, componentProduct, variant, prev, balanceAfter);
            await this.notifyStockPush(organizationId, componentProductId, componentVariantId, balanceAfter);
          } else {
            const componentProduct = await (this.prisma as any).product.findFirst({
              where: { id: componentProductId, organizationId },
            });
            if (!componentProduct || componentProduct.stockQuantity == null) continue;
            const prev = componentProduct.stockQuantity as number;
            const balanceAfter = prev - needed;
            await this.stockTx(async (db) => {
              const active = this.binActive(db);
              if (active) await this.seedBalanceIfMissingIn(db, organizationId, componentProductId, null, prev);
              await db.product.update({
                where: { id: componentProduct.id }, data: { stockQuantity: balanceAfter, ...this.oosRearm(componentProduct, balanceAfter) },
              });
              if (!active) {
                await db.stockMovement.create({
                  data: {
                    organizationId, productId: componentProductId, variantId: null,
                    delta: -needed, balanceAfter, reason: "order_edit", orderId,
                  },
                });
              } else if (needed > 0) {
                await this.deductPortionsIn(db, organizationId, orderId, componentProductId, null, needed, district, null, "order_edit", balanceAfter);
              } else {
                const portions = await this.creditAllocationsReverseIn(db, organizationId, orderId, componentProductId, null, -needed);
                for (const portion of portions) {
                  await db.stockMovement.create({
                    data: {
                      organizationId, productId: componentProductId, variantId: null,
                      delta: portion.qty, balanceAfter, reason: "order_edit", orderId, binId: portion.binId,
                    },
                  });
                }
              }
            });
            await this.maybeLowStockAlert(organizationId, componentProduct, null, prev, balanceAfter);
            await this.maybeOutOfStockAlert(organizationId, componentProduct, null, prev, balanceAfter);
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
      // AB3 (§5.2): the CLAIM moves with the surgery — up to
      // `quantity` of the from-order's active allocations for
      // this key are re-created on the to-order (same bins);
      // balances do NOT move. The paired movements below are
      // stamped with the first moved bin (when the move splits
      // across bins, the first is stamped and the rest are
      // visible on the allocation rows — these movements are
      // bookkeeping, not per-bin truth).
      let firstBinId: string | null = null;
      if (this.binActive(this.prisma as any)) {
        firstBinId = await this.stockTx((db) =>
          this.moveAllocationsIn(db, organizationId, fromOrderId, toOrderId, line.productId as string, variantId, line.quantity),
        ).catch(() => null);
      }
      await (this.prisma as any).stockMovement.create({
        data: {
          organizationId, productId: line.productId, variantId,
          delta: line.quantity, balanceAfter: balance, reason: "order_edit", orderId: fromOrderId,
          ...(firstBinId ? { binId: firstBinId } : {}),
        },
      });
      await (this.prisma as any).stockMovement.create({
        data: {
          organizationId, productId: line.productId, variantId,
          delta: -line.quantity, balanceAfter: balance, reason: "order_placed", orderId: toOrderId,
          ...(firstBinId ? { binId: firstBinId } : {}),
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
              // AB3: component allocations move with the
              // component claim; both mirror movements are
              // stamped with the first moved component bin.
              let compFirstBinId: string | null = null;
              if (this.binActive(this.prisma as any)) {
                compFirstBinId = await this.stockTx((db) =>
                  this.moveAllocationsIn(db, organizationId, fromOrderId, toOrderId, componentProductId, componentVariantId, compQty),
                ).catch(() => null);
              }
              await (this.prisma as any).stockMovement.create({
                data: {
                  organizationId, productId: componentProductId, variantId: componentVariantId,
                  delta: compQty, balanceAfter: compBalance, reason: "order_edit", orderId: fromOrderId,
                  ...(compFirstBinId ? { binId: compFirstBinId } : {}),
                },
              });
              await (this.prisma as any).stockMovement.create({
                data: {
                  organizationId, productId: componentProductId, variantId: componentVariantId,
                  delta: -compQty, balanceAfter: compBalance, reason: "bundle_component", orderId: toOrderId,
                  ...(compFirstBinId ? { binId: compFirstBinId } : {}),
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

    // AB3: the order's district feeds Phase B's negative-diff
    // draws (§5.1 rule) in every restore path below.
    const binOn = this.binActive(this.prisma as any);
    const district = binOn ? await this.orderDistrict(orderId) : null;

    // EC4: the placed set includes bundle component movements —
    // restoring an order restores its components too, replaying
    // the exact placed quantities (never the order's items).
    const placed = await (this.prisma as any).stockMovement.findMany({
      where: { orderId, reason: { in: ["order_placed", "bundle_component"] } },
    });
    if (!placed.length) {
      // ON3 Phase B can still apply on its own (an order whose
      // only stock movements came from item edits).
      return this.applyRestoreNetting(organizationId, orderId, reason, 0, 0, new Map(), district);
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

    // AB3: Phase A is grouped by stock KEY. Pre-AB3 there is
    // exactly one placed movement per key, so grouping changes
    // nothing; in the bin world one placement may have written
    // SEVERAL placed movements for a key (one per bin drawn),
    // and the key is still ONE restored line — { restored,
    // skipped } count keys/lines, never movements. The global
    // write is the key's total placed qty, exactly the sum of
    // the per-movement writes it replaces.
    //
    // The BIN side does NOT replay the placed movements' bins:
    // design §5.2 returns the qty across the order's CURRENT
    // active allocations (re-allocation / split-merge may have
    // moved the claim since placement), in allocation order,
    // with one restore movement per bin portion credited.
    // Extra restore movements sharing this (orderId, reason)
    // are safe for the idempotency logic: the fast path keys on
    // findFirst(orderId, reason) — any one of them trips it —
    // and restoredKeys is a per-KEY set, so portions of one key
    // can never double-restore; Phase B re-queries the restore
    // rows fresh and sums deltas per key, so split portions sum
    // exactly like a single movement did.
    const creditLedger = new Map<string, number>();
    const placedByKey = new Map<string, { productId: string; variantId: string | null; qty: number }>();
    for (const movement of placed as any[]) {
      const key = `${movement.productId}::${movement.variantId ?? ""}`;
      const entry = placedByKey.get(key) ?? { productId: movement.productId, variantId: movement.variantId ?? null, qty: 0 };
      entry.qty += Math.abs(movement.delta as number);
      placedByKey.set(key, entry);
    }

    let restored = 0;
    let skipped = 0;
    for (const [key, entry] of placedByKey) {
      if (restoredKeys.has(key)) { skipped++; continue; }
      const qty = entry.qty;
      if (entry.variantId) {
        const variant = await (this.prisma as any).productVariant.findFirst({ where: { id: entry.variantId } });
        // The row became untracked (or was deleted) after the
        // sale — there is no honest balance to add back onto.
        if (!variant || variant.stockQuantity == null) { skipped++; continue; }
        const prev = variant.stockQuantity as number;
        const balanceAfter = prev + qty;
        await this.stockTx(async (db) => {
          const active = this.binActive(db);
          if (active) await this.seedBalanceIfMissingIn(db, organizationId, entry.productId, entry.variantId, prev);
          await db.productVariant.update({
            where: { id: variant.id }, data: { stockQuantity: balanceAfter, ...this.oosRearm(variant, balanceAfter) },
          });
          if (active) {
            const portions = await this.creditRestorePortionsIn(db, organizationId, orderId, entry.productId, entry.variantId, qty, creditLedger);
            for (const portion of portions) {
              await this.applyBinDeltaIn(db, organizationId, entry.productId, entry.variantId, portion.binId, portion.qty);
              await db.stockMovement.create({
                data: {
                  organizationId, productId: entry.productId, variantId: entry.variantId,
                  delta: portion.qty, balanceAfter, reason, orderId, binId: portion.binId,
                },
              });
            }
          } else {
            await db.stockMovement.create({
              data: {
                organizationId, productId: entry.productId, variantId: entry.variantId,
                delta: qty, balanceAfter, reason, orderId,
              },
            });
          }
        });
        restored++;
        await this.notifyStockPush(organizationId, entry.productId, entry.variantId, balanceAfter);
        // EC28: cancel/return restore is a stock-increase path too.
        this.emitStockIncreased(organizationId, entry.productId, variant, prev, balanceAfter);
      } else {
        const product = await (this.prisma as any).product.findFirst({ where: { id: entry.productId, organizationId } });
        if (!product || product.stockQuantity == null) { skipped++; continue; }
        const prev = product.stockQuantity as number;
        const balanceAfter = prev + qty;
        await this.stockTx(async (db) => {
          const active = this.binActive(db);
          if (active) await this.seedBalanceIfMissingIn(db, organizationId, entry.productId, null, prev);
          await db.product.update({
            where: { id: product.id }, data: { stockQuantity: balanceAfter, ...this.oosRearm(product, balanceAfter) },
          });
          if (active) {
            const portions = await this.creditRestorePortionsIn(db, organizationId, orderId, entry.productId, null, qty, creditLedger);
            for (const portion of portions) {
              await this.applyBinDeltaIn(db, organizationId, entry.productId, null, portion.binId, portion.qty);
              await db.stockMovement.create({
                data: {
                  organizationId, productId: entry.productId, variantId: null,
                  delta: portion.qty, balanceAfter, reason, orderId, binId: portion.binId,
                },
              });
            }
          } else {
            await db.stockMovement.create({
              data: {
                organizationId, productId: entry.productId, variantId: null,
                delta: qty, balanceAfter, reason, orderId,
              },
            });
          }
        });
        restored++;
        await this.notifyStockPush(organizationId, entry.productId, null, balanceAfter);
        this.emitStockIncreased(organizationId, entry.productId, null, prev, balanceAfter);
      }
    }
    // ON3 Phase B: net the order_edit movements (item edits +
    // split/merge transfers) against what Phase A just restored.
    return this.applyRestoreNetting(organizationId, orderId, reason, restored, skipped, creditLedger, district);
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
    creditLedger: Map<string, number> = new Map(),
    district: string | null = null,
  ): Promise<{ restored: number; skipped: number }> {
    const edits = await (this.prisma as any).stockMovement.findMany({
      where: { orderId, reason: "order_edit" },
    }).catch(() => []);

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

    // AB3: with NO order_edit movements the pre-AB3 method
    // returned here untouched — the counts and writes stay
    // exactly that; the only addition is settling the
    // allocations of keys Phase A fully restored (already ==
    // target), which is bookkeeping no legacy reader sees.
    const binOn = this.binActive(this.prisma as any);
    if (!(edits as any[]).length) {
      if (binOn) {
        await this.stockTx(async (db) => {
          for (const [key, entry] of targetByKey) {
            if (entry.target > 0 && (alreadyByKey.get(key) ?? 0) >= entry.target) {
              await this.settleAllocationsIn(db, organizationId, orderId, entry.productId, entry.variantId);
            }
          }
        });
      }
      return { restored, skipped };
    }

    for (const [key, entry] of targetByKey) {
      const diff = entry.target - (alreadyByKey.get(key) ?? 0);
      if (diff === 0) {
        // Fully restored already (Phase A covered it): settle
        // the key's allocations and move on — no write, as
        // before AB3.
        if (binOn && entry.target > 0) {
          await this.stockTx((db) => this.settleAllocationsIn(db, organizationId, orderId, entry.productId, entry.variantId));
        }
        continue;
      }
      if (entry.variantId) {
        const variant = await (this.prisma as any).productVariant.findFirst({ where: { id: entry.variantId } });
        if (!variant || variant.stockQuantity == null) { skipped++; continue; }
        const prev = variant.stockQuantity as number;
        const balanceAfter = prev + diff;
        await this.stockTx(async (db) => {
          const active = this.binActive(db);
          if (active) await this.seedBalanceIfMissingIn(db, organizationId, entry.productId, entry.variantId, prev);
          await db.productVariant.update({
            where: { id: variant.id }, data: { stockQuantity: balanceAfter, ...this.oosRearm(variant, balanceAfter) },
          });
          if (!active) {
            await db.stockMovement.create({
              data: {
                organizationId, productId: entry.productId, variantId: entry.variantId,
                delta: diff, balanceAfter, reason, orderId,
              },
            });
          } else if (diff > 0) {
            // Credit across the key's allocation rows (the
            // shared ledger continues Phase A's crediting),
            // remainder to the default bin.
            const portions = await this.creditRestorePortionsIn(db, organizationId, orderId, entry.productId, entry.variantId, diff, creditLedger);
            for (const portion of portions) {
              await this.applyBinDeltaIn(db, organizationId, entry.productId, entry.variantId, portion.binId, portion.qty);
              await db.stockMovement.create({
                data: {
                  organizationId, productId: entry.productId, variantId: entry.variantId,
                  delta: portion.qty, balanceAfter, reason, orderId, binId: portion.binId,
                },
              });
            }
          } else {
            // Over-restored: draw the excess back by the §5.1
            // rule and EXTEND the order's allocations — the
            // units are claimed again (e.g. transferred out to
            // another order, whose own allocations carry its
            // claim; these rows settle with this key below).
            const draws = await this.planDrawIn(db, organizationId, entry.productId, entry.variantId, -diff, district);
            for (const d of draws) {
              await this.applyBinDeltaIn(db, organizationId, entry.productId, entry.variantId, d.binId, -d.qty);
              await db.stockMovement.create({
                data: {
                  organizationId, productId: entry.productId, variantId: entry.variantId,
                  delta: -d.qty, balanceAfter, reason, orderId, binId: d.binId,
                },
              });
              await db.stockAllocation.create({
                data: {
                  organizationId, orderId, orderItemId: null,
                  productId: entry.productId, variantId: entry.variantId,
                  binId: d.binId, warehouseId: d.warehouseId, qty: d.qty, status: "active",
                },
              });
            }
          }
          if (active) await this.settleAllocationsIn(db, organizationId, orderId, entry.productId, entry.variantId);
        });
        if (diff > 0) restored++;
        await this.notifyStockPush(organizationId, entry.productId, entry.variantId, balanceAfter);
        if (diff > 0) this.emitStockIncreased(organizationId, entry.productId, variant, prev, balanceAfter);
        // GB2 (GC7): netting can also take a row DOWN to zero.
        if (prev > 0 && balanceAfter === 0) {
          const product = await (this.prisma as any).product.findFirst({ where: { id: entry.productId, organizationId } }).catch(() => null);
          if (product) await this.maybeOutOfStockAlert(organizationId, product, variant, prev, balanceAfter);
        }
      } else {
        const product = await (this.prisma as any).product.findFirst({ where: { id: entry.productId, organizationId } });
        if (!product || product.stockQuantity == null) { skipped++; continue; }
        const prev = product.stockQuantity as number;
        const balanceAfter = prev + diff;
        await this.stockTx(async (db) => {
          const active = this.binActive(db);
          if (active) await this.seedBalanceIfMissingIn(db, organizationId, entry.productId, null, prev);
          await db.product.update({
            where: { id: product.id }, data: { stockQuantity: balanceAfter, ...this.oosRearm(product, balanceAfter) },
          });
          if (!active) {
            await db.stockMovement.create({
              data: {
                organizationId, productId: entry.productId, variantId: null,
                delta: diff, balanceAfter, reason, orderId,
              },
            });
          } else if (diff > 0) {
            const portions = await this.creditRestorePortionsIn(db, organizationId, orderId, entry.productId, null, diff, creditLedger);
            for (const portion of portions) {
              await this.applyBinDeltaIn(db, organizationId, entry.productId, null, portion.binId, portion.qty);
              await db.stockMovement.create({
                data: {
                  organizationId, productId: entry.productId, variantId: null,
                  delta: portion.qty, balanceAfter, reason, orderId, binId: portion.binId,
                },
              });
            }
          } else {
            const draws = await this.planDrawIn(db, organizationId, entry.productId, null, -diff, district);
            for (const d of draws) {
              await this.applyBinDeltaIn(db, organizationId, entry.productId, null, d.binId, -d.qty);
              await db.stockMovement.create({
                data: {
                  organizationId, productId: entry.productId, variantId: null,
                  delta: -d.qty, balanceAfter, reason, orderId, binId: d.binId,
                },
              });
              await db.stockAllocation.create({
                data: {
                  organizationId, orderId, orderItemId: null,
                  productId: entry.productId, variantId: null,
                  binId: d.binId, warehouseId: d.warehouseId, qty: d.qty, status: "active",
                },
              });
            }
          }
          if (active) await this.settleAllocationsIn(db, organizationId, orderId, entry.productId, null);
        });
        if (diff > 0) restored++;
        await this.notifyStockPush(organizationId, entry.productId, null, balanceAfter);
        if (diff > 0) this.emitStockIncreased(organizationId, entry.productId, null, prev, balanceAfter);
        await this.maybeOutOfStockAlert(organizationId, product, null, prev, balanceAfter);
      }
    }
    return { restored, skipped };
  }

  // ---------- Manual adjustment ----------

  async adjust(
    organizationId: string,
    actorUserId: string,
    productId: string,
    input: { variantId?: string | null; delta?: number | null; setTo?: number | null; note?: string | null; reason?: string; binId?: string | null },
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
    // AB3 (design §6): an explicit binId must name a bin of THIS
    // org; the addressed bin absorbs the delta (for setTo, the
    // difference between the target and the current global), so
    // Σ balances keeps holding. Without one, the delta posts to
    // the resolved default bin.
    let explicitBin: any = null;
    if (input.binId) {
      const binTable = (this.prisma as any).binLocation;
      explicitBin = binTable?.findFirst
        ? await binTable.findFirst({ where: { id: input.binId, organizationId } }).catch(() => null)
        : null;
      if (!explicitBin) {
        throw new BadRequestException("নির্দিষ্ট বিনটি এই প্রতিষ্ঠানে পাওয়া যায়নি — সঠিক বিন বেছে নিন।");
      }
    }
    const variantId = variant?.id ?? null;
    const movement = await this.stockTx(async (db) => {
      const active = this.binActive(db);
      let addressedBinId: string | null = explicitBin?.id ?? null;
      if (active) {
        // Lazy-seed with the PRE-adjust global before applying
        // the bin delta (§4.3).
        await this.seedBalanceIfMissingIn(db, organizationId, productId, variantId, current);
        if (!addressedBinId) {
          const bin = await this.resolveDefaultBinIn(db, organizationId, productId, variantId);
          addressedBinId = bin?.id ?? null;
        }
      }
      if (variant) {
        await db.productVariant.update({ where: { id: variant.id }, data: { stockQuantity: newBalance, ...this.oosRearm(variant, newBalance) } });
      } else {
        await db.product.update({ where: { id: product.id }, data: { stockQuantity: newBalance, ...this.oosRearm(product, newBalance) } });
      }
      const created = await db.stockMovement.create({
        data: {
          organizationId, productId, variantId: variant?.id ?? null,
          delta: appliedDelta, balanceAfter: newBalance, reason: input.reason ?? "manual_adjustment",
          actorUserId, note: input.note ?? null,
          ...(active && addressedBinId ? { binId: addressedBinId } : {}),
        },
      });
      if (active && addressedBinId) {
        await this.applyBinDeltaIn(db, organizationId, productId, variantId, addressedBinId, appliedDelta);
      }
      return created;
    });
    await this.audit.log({
      organizationId, userId: actorUserId, action: "inventory.adjusted",
      entityType: "Product", entityId: productId,
      metadata: { productId, variantId: variant?.id ?? null, delta: appliedDelta, balanceAfter: newBalance },
    });
    await this.maybeLowStockAlert(organizationId, product, variant, current, newBalance);
    await this.maybeOutOfStockAlert(organizationId, product, variant, current, newBalance);
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
    // AB3: the sync delta posts to the resolved default bin (the
    // external store has no bin concept; the distribution
    // otherwise survives). Seeding uses qtyOverride = previous,
    // because the caller may already have written the incoming
    // global by the time this runs.
    await this.stockTx(async (db) => {
      await db.stockMovement.create({
        data: {
          organizationId, productId, variantId: variantId ?? null,
          delta: incoming - previous, balanceAfter: incoming,
          reason: "sync_correction", actorUserId: null, note: "store sync",
        },
      });
      if (this.binActive(db)) {
        await this.seedBalanceIfMissingIn(db, organizationId, productId, variantId ?? null, previous);
        const bin = await this.resolveDefaultBinIn(db, organizationId, productId, variantId ?? null);
        if (bin) await this.applyBinDeltaIn(db, organizationId, productId, variantId ?? null, bin.id, incoming - previous);
      }
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
        await createAgentNotification(this.prisma as any, { organizationId, userId, type: "low_stock", title, body, conversationId: null }).catch(() => undefined);
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

  // ---------- GB2 (GC7): inventory settings + availability ----------

  /** The org's InventorySetting row values with the schema
   * defaults when no row exists; failure-isolated (a settings
   * read failure must never block a checkout — the safe default
   * is enforcement ON: allowBackorder false, reservations off). */
  async getInventorySettings(organizationId: string): Promise<{ leadTimeDays: number; allowBackorder: boolean; reserveMinutes: number }> {
    try {
      const row: any = await this.prisma.inventorySetting
        .findUnique({ where: { organizationId } })
        .catch(() => null);
      return {
        leadTimeDays: row?.leadTimeDays ?? 14,
        allowBackorder: row?.allowBackorder === true,
        reserveMinutes: Math.max(0, Number(row?.reserveMinutes ?? 0) || 0),
      };
    } catch {
      return { leadTimeDays: 14, allowBackorder: false, reserveMinutes: 0 };
    }
  }

  /** Σ active, unexpired reservation quantities for one stock
   * row. Lazy expiry: a row counts only while expiresAt > now —
   * no sweep job. `excludeSessionRef` removes the caller's own
   * session so a cart never blocks its own checkout. */
  async reservedQuantity(
    organizationId: string,
    productId: string,
    variantId: string | null,
    excludeSessionRef?: string,
    now: Date = new Date(),
  ): Promise<number> {
    try {
      const table = (this.prisma as any).stockReservation;
      if (!table?.findMany) return 0;
      const rows: any[] = ((await table.findMany({
        where: {
          organizationId, productId, variantId: variantId ?? null,
          state: "active", expiresAt: { gt: now },
        },
      }).catch(() => [])) ?? []) as any[];
      return rows
        .filter((r: any) => !excludeSessionRef || String(r.sessionRef) !== excludeSessionRef)
        .reduce((sum: number, r: any) => sum + (Number(r.quantity) || 0), 0);
    } catch {
      return 0;
    }
  }

  /** Org-wide active reservation totals keyed
   * `${productId}::${variantId ?? ""}` — the batch read behind
   * the shop availability maps and the inventory availability
   * endpoint. Lazy expiry applies (expiresAt > now). */
  async activeReservationTotals(
    organizationId: string,
    excludeSessionRef?: string,
    now: Date = new Date(),
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    try {
      const table = (this.prisma as any).stockReservation;
      if (!table?.findMany) return out;
      const rows: any[] = ((await table.findMany({
        where: { organizationId, state: "active", expiresAt: { gt: now } },
        take: 10000,
      }).catch(() => [])) ?? []) as any[];
      for (const r of rows) {
        if (excludeSessionRef && String(r.sessionRef) === excludeSessionRef) continue;
        const key = `${String(r.productId)}::${r.variantId ?? ""}`;
        out.set(key, (out.get(key) ?? 0) + (Number(r.quantity) || 0));
      }
    } catch { /* totals are decoration for reads; enforcement re-checks per line */ }
    return out;
  }

  /**
   * The ONE availability verdict used by every native checkout
   * (shop cart, single-product, landing): preorder lines and
   * untracked rows are always fine; allowBackorder ON means the
   * merchant accepts oversell (placement decrements into
   * negative exactly as the ledger has always done); otherwise
   * the quantity must fit inside on-hand minus OTHER sessions'
   * active reservations.
   */
  async checkAvailability(
    organizationId: string,
    product: { id: string; stockQuantity: number | null; preorderEnabled?: boolean },
    variant: { id: string; stockQuantity: number | null } | null,
    quantity: number,
    opts: { excludeSessionRef?: string } = {},
  ): Promise<{ ok: true } | { ok: false; available: number }> {
    if ((product as any)?.preorderEnabled) return { ok: true };
    const onHand = variant ? variant.stockQuantity : product.stockQuantity;
    if (onHand == null) return { ok: true };
    const settings = await this.getInventorySettings(organizationId);
    if (settings.allowBackorder) return { ok: true };
    const reserved = await this.reservedQuantity(
      organizationId, product.id, variant?.id ?? null, opts.excludeSessionRef,
    );
    const available = onHand - reserved;
    return quantity > available ? { ok: false, available } : { ok: true };
  }

  // ---------- GB2 (GC7): cart stock reservations ----------

  /**
   * Reconcile a server cart's reservations with its current
   * lines (called on every cart mutation). Runs ONLY when the
   * org enabled reservations (reserveMinutes > 0); with the
   * setting off this is a no-op and no rows are written. Rules:
   *  - preorder lines and untracked rows never reserve;
   *  - bundle lines reserve nothing themselves (their component
   *    products are not cart lines — components are still
   *    availability-checked at quote/checkout time);
   *  - a line reserves min(quantity, on-hand): a reservation
   *    never promises stock that does not exist;
   *  - stale rows (removed lines, trimmed quantities) are
   *    released / adjusted in place; expiry refreshes on every
   *    mutation (the window slides with cart activity).
   * Failure-isolated end to end: a reservation failure never
   * blocks a cart mutation.
   */
  async syncCartReservations(
    organizationId: string,
    sessionRef: string,
    lines: Array<{ productId: string; variantId: string | null; quantity: number }>,
  ): Promise<void> {
    try {
      const table = (this.prisma as any).stockReservation;
      if (!table?.findMany) return;
      const settings = await this.getInventorySettings(organizationId);
      if (settings.reserveMinutes <= 0) return;
      const expiresAt = new Date(Date.now() + settings.reserveMinutes * 60_000);
      // Resolve the desired set: load each line's stock row.
      const desired = new Map<string, { productId: string; variantId: string | null; quantity: number }>();
      for (const line of lines) {
        if (!line.productId || line.quantity <= 0) continue;
        let onHand: number | null = null;
        if (line.variantId) {
          const v: any = await this.prisma.productVariant
            .findFirst({ where: { id: line.variantId } })
            .catch(() => null);
          if (v) {
            const p: any = await this.prisma.product
              .findFirst({ where: { id: v.productId, organizationId } })
              .catch(() => null);
            if (p?.preorderEnabled) continue;
            onHand = v.stockQuantity ?? null;
          }
        } else {
          const p: any = await this.prisma.product
            .findFirst({ where: { id: line.productId, organizationId } })
            .catch(() => null);
          if (!p || p.preorderEnabled) continue;
          onHand = p.stockQuantity ?? null;
        }
        if (onHand == null) continue;
        const qty = Math.max(0, Math.min(line.quantity, onHand));
        if (qty <= 0) continue;
        const key = `${line.productId}::${line.variantId ?? ""}`;
        const existing = desired.get(key);
        if (existing) existing.quantity = Math.min(onHand, existing.quantity + qty);
        else desired.set(key, { productId: line.productId, variantId: line.variantId ?? null, quantity: qty });
      }
      // AB3 (design §6): ONE bin per stock key (assignment →
      // default resolver), stamped on the rows written below.
      // The reserved qty caps at what THAT BIN can promise:
      // min(desired, binOnHand − other sessions' active
      // unexpired reservations on the same bin+key). Org-global
      // availability (checkAvailability) is unchanged — it still
      // reads reservation rows org-wide.
      const binByKey = new Map<string, string>();
      if (this.binActive(this.prisma as any)) {
        const now = new Date();
        for (const [key, want] of [...desired]) {
          const bin = await this.resolveDefaultBinIn(this.prisma as any, organizationId, want.productId, want.variantId).catch(() => null);
          if (!bin) continue;
          await this.seedBalanceIfMissingIn(this.prisma as any, organizationId, want.productId, want.variantId).catch(() => false);
          const bal = await (this.prisma as any).stockBalance.findFirst({
            where: { organizationId, productId: want.productId, variantId: want.variantId, binId: bin.id },
          }).catch(() => null);
          const binOnHand = (bal?.onHand as number) ?? 0;
          const others: any[] = ((await table.findMany({
            where: {
              organizationId, productId: want.productId, variantId: want.variantId,
              binId: bin.id, state: "active", expiresAt: { gt: now },
            },
          }).catch(() => [])) ?? []) as any[];
          const othersReserved = others
            .filter((r: any) => String(r.sessionRef) !== sessionRef)
            .reduce((sum: number, r: any) => sum + (Number(r.quantity) || 0), 0);
          const capped = Math.max(0, Math.min(want.quantity, binOnHand - othersReserved));
          if (capped <= 0) { desired.delete(key); continue; }
          want.quantity = capped;
          binByKey.set(key, bin.id);
        }
      }
      const binAffected = new Map<string, { productId: string; variantId: string | null; binId: string }>();
      const markBin = (productId: string, variantId: string | null, binId: string | null | undefined) => {
        if (!binId) return;
        binAffected.set(`${productId}::${variantId ?? ""}::${binId}`, { productId, variantId, binId });
      };
      const current: any[] = ((await table.findMany({
        where: { organizationId, sessionRef, state: "active" },
      }).catch(() => [])) ?? []) as any[];
      const kept = new Set<string>();
      for (const row of current) {
        const key = `${String(row.productId)}::${row.variantId ?? ""}`;
        const want = desired.get(key);
        if (!want) {
          await table.update({ where: { id: row.id }, data: { state: "released" } }).catch(() => null);
          markBin(String(row.productId), row.variantId ?? null, row.binId);
          continue;
        }
        kept.add(key);
        const newBinId = binByKey.get(key) ?? null;
        if (Number(row.quantity) !== want.quantity || new Date(row.expiresAt).getTime() !== expiresAt.getTime() || (newBinId && row.binId !== newBinId)) {
          const data: any = { quantity: want.quantity, expiresAt };
          if (newBinId && row.binId !== newBinId) data.binId = newBinId;
          await table.update({ where: { id: row.id }, data }).catch(() => null);
          markBin(String(row.productId), row.variantId ?? null, row.binId);
          markBin(String(row.productId), row.variantId ?? null, newBinId ?? row.binId);
        }
      }
      for (const [key, want] of desired) {
        if (kept.has(key)) continue;
        const newBinId = binByKey.get(key) ?? null;
        await table.create({
          data: {
            organizationId, sessionRef,
            productId: want.productId, variantId: want.variantId,
            quantity: want.quantity, state: "active", expiresAt,
            ...(newBinId ? { binId: newBinId } : {}),
          },
        }).catch(() => null);
        markBin(want.productId, want.variantId, newBinId);
      }
      // AB3: recompute the maintained reserved counters of
      // every bin this reconciliation touched (§3).
      if (binByKey.size || binAffected.size) {
        for (const affected of binAffected.values()) {
          await this.refreshBinReservedIn(this.prisma as any, organizationId, affected.productId, affected.variantId, affected.binId);
        }
      }
    } catch { /* failure-isolated by design */ }
  }

  /** Settle a session's reservations when it converts to an
   * order (consumed) or dies (released). Failure-isolated. */
  async settleCartReservations(organizationId: string, sessionRef: string, state: "consumed" | "released"): Promise<void> {
    try {
      const table = (this.prisma as any).stockReservation;
      if (!table?.findMany) return;
      const rows: any[] = ((await table.findMany({
        where: { organizationId, sessionRef, state: "active" },
      }).catch(() => [])) ?? []) as any[];
      for (const row of rows) {
        await table.update({ where: { id: row.id }, data: { state } }).catch(() => null);
      }
      // AB3: settled rows no longer hold their bins — recompute
      // the maintained reserved counters (§3).
      if (this.binActive(this.prisma as any)) {
        const seen = new Set<string>();
        for (const row of rows) {
          if (!row.binId) continue;
          const key = `${String(row.productId)}::${row.variantId ?? ""}::${row.binId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          await this.refreshBinReservedIn(this.prisma as any, organizationId, String(row.productId), row.variantId ?? null, row.binId);
        }
      }
    } catch { /* failure-isolated by design */ }
  }

  // ---------- GB2 (GC7): out-of-stock staff alert ----------

  /**
   * The re-arm data for a stock write: a write that lands the
   * balance ABOVE zero clears the row's OOS stamp, so the NEXT
   * zero-crossing alerts again. Rows that were never stamped
   * get an empty object (their update data stays byte-identical
   * to before GB2).
   */
  private oosRearm(row: any, balanceAfter: number): Record<string, unknown> {
    return balanceAfter > 0 && row?.lastOosNotifiedAt ? { lastOosNotifiedAt: null } : {};
  }

  /**
   * OUT-OF-STOCK alert: a write that takes a tracked row from
   * > 0 to exactly 0 fires ONE Bengali AgentNotification to the
   * org's ACTIVE OWNER/ADMIN memberships and stamps the stock
   * row (lastOosNotifiedAt), so repeat decrements at 0 stay
   * silent until a restock re-arms (see oosRearm). Mirrors the
   * low-stock alert's delivery pattern; sync-driven corrections
   * never call this (same discipline as maybeLowStockAlert).
   * Failure-isolated: an alert failure never blocks a write.
   */
  async maybeOutOfStockAlert(
    organizationId: string,
    product: { id: string; name?: string; stockQuantity?: number | null; lastOosNotifiedAt?: unknown },
    variant: { id: string; name?: string; stockQuantity?: number | null; lastOosNotifiedAt?: unknown } | null,
    previous: number | null,
    balanceAfter: number,
  ): Promise<void> {
    try {
      if (previous == null || previous <= 0 || balanceAfter !== 0) return;
      const row: any = variant ?? product;
      if (!row || row.lastOosNotifiedAt) return; // already reported for this crossing
      const productName = product.name ?? "পণ্য";
      const label = variant ? `${productName} — ${variant.name ?? "ভ্যারিয়েন্ট"}` : productName;
      const memberships: any[] = ((await (this.prisma as any).membership.findMany({
        where: { organizationId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } },
      }).catch(() => [])) ?? []) as any[];
      let notified = 0;
      for (const m of memberships) {
        const created = await createAgentNotification(this.prisma as any, {
            organizationId,
            userId: m.userId,
            type: "out_of_stock",
            title: `স্টক শেষ: ${label}`,
            body: `«${label}»-এর স্টক শূন্যে পৌঁছেছে — নতুন অর্ডারে এই আইটেমটি আর বিক্রি হবে না (ব্যাকঅর্ডার বন্ধ থাকলে)।`,
          }).catch(() => null);
        if (created) notified++;
      }
      if (notified === 0) return;
      // Stamp the stock row so the crossing reports exactly once.
      const stamp = { lastOosNotifiedAt: new Date() };
      if (variant) {
        await this.prisma.productVariant.update({ where: { id: variant.id }, data: stamp }).catch(() => null);
      } else {
        await this.prisma.product.update({ where: { id: product.id }, data: stamp }).catch(() => null);
      }
      await this.audit.log({
        organizationId,
        action: "inventory.out_of_stock_alert",
        entityType: "Product",
        entityId: product.id,
        metadata: { productId: product.id, variantId: variant?.id ?? null, balanceAfter: 0, notified },
      });
    } catch { /* failure-isolated by design */ }
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
