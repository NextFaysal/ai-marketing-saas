import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { InventoryService } from "../inventory/inventory.service";
import { toCsv } from "../imports/csv";

/**
 * EC33 — Inventory Intelligence.
 *
 * Adds three read models on top of the stock the codebase already
 * tracks (Product.stockQuantity / ProductVariant.stockQuantity,
 * nullable = untracked) plus one org setting (InventorySetting):
 *
 * - velocity: how fast each TRACKED row is actually selling,
 *   measured ONLY from orders that count as SOLD (see isSoldOrder).
 * - velocity reorder suggestions: cover `leadTimeDays` of sales at
 *   the 30-day velocity. The simple threshold mode stays in
 *   PurchasingService.reorderSuggestions, completely untouched —
 *   the controller routes mode=simple/absent there and mode=
 *   velocity here.
 * - dead stock: tracked rows holding stock that has not sold in
 *   `days`, valued at the latest ProductCost.
 * - valuation: total stock value at latest cost, with honest
 *   coverage counts (rows without any cost are counted as
 *   unvalued and contribute NOTHING to the total — never a
 *   guessed cost).
 *
 * Granularity rule (identical to reorderSuggestions): when a
 * product has tracked variants, the variants are the tracked rows
 * and the product row gets NO entry of its own; only when a
 * product has no tracked variants does its own stockQuantity row
 * count. Only ACTIVE products are considered.
 *
 * Everything is computed in memory from findMany loads (the
 * AccountingService discipline): no aggregate queries, so the
 * service behaves identically against a real Prisma client and
 * the in-memory fakes used in specs.
 */

const DAY_MS = 86400000;
export const DEFAULT_LEAD_TIME_DAYS = 14;
const VELOCITY_WINDOWS = [30, 60, 90] as const;
/** Dead states: an order in one of these never counts as sold. */
const DEAD_ORDER_STATUSES = ["cancelled", "refunded", "failed"];
/** Shipment states that prove delivery (codebase delivered bucket). */
const DELIVERED_SHIPMENT_STATUSES = ["delivered", "partial_delivered"];
/** Suggestions always read the 30-day window (documented choice):
 * long enough to smooth daily noise, short enough to react. */
const SUGGESTION_WINDOW_DAYS = 30;

export interface TrackedRow {
  productId: string;
  productName: string;
  variantId: string | null;
  variantName: string | null;
  sku: string | null;
  currentStock: number;
  threshold: number;
}

interface SaleEvent {
  productId: string;
  /** Resolved variant id when the item's sku matched a variant of
   * the product; null = product-level sale. */
  variantId: string | null;
  quantity: number;
  date: Date;
}

@Injectable()
export class InventoryIntelligenceService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly inventory?: InventoryService,
  ) {}

  // ---------- Settings ----------

  private settingsTable(): any {
    return (this.prisma as any).inventorySetting;
  }

  private serializeSettings(row: any, orgId: string) {
    if (!row) return { organizationId: orgId, leadTimeDays: DEFAULT_LEAD_TIME_DAYS };
    return {
      id: row.id,
      organizationId: row.organizationId ?? orgId,
      leadTimeDays: row.leadTimeDays ?? DEFAULT_LEAD_TIME_DAYS,
      createdAt: row.createdAt ?? null,
      updatedAt: row.updatedAt ?? null,
    };
  }

  async getSettings(orgId: string) {
    const table = this.settingsTable();
    let row: any = null;
    if (table?.findFirst) {
      row = await table.findFirst({ where: { organizationId: orgId } }).catch(() => null);
    }
    if (!row && table?.findMany) {
      const rows = (await table.findMany({ where: { organizationId: orgId } }).catch(() => [])) ?? [];
      row = rows[0] ?? null;
    }
    return this.serializeSettings(row, orgId);
  }

  async updateSettings(orgId: string, actorId: string, dto: { leadTimeDays?: unknown }) {
    const leadTimeDays = (dto as any)?.leadTimeDays;
    if (!Number.isInteger(leadTimeDays) || (leadTimeDays as number) < 1 || (leadTimeDays as number) > 180) {
      throw new BadRequestException("লিড টাইম (leadTimeDays) অবশ্যই ১ থেকে ১৮০ দিনের মধ্যে পূর্ণসংখ্যা হতে হবে");
    }
    const table = this.settingsTable();
    const existing = table?.findFirst
      ? await table.findFirst({ where: { organizationId: orgId } }).catch(() => null)
      : null;
    const row = existing
      ? await table.update({ where: { id: existing.id }, data: { leadTimeDays } })
      : await table.create({ data: { organizationId: orgId, leadTimeDays } });
    await this.audit?.log({
      organizationId: orgId,
      userId: actorId,
      action: "inventory_settings.updated",
      entityType: "InventorySetting",
      entityId: row.id,
      metadata: { leadTimeDays: row.leadTimeDays ?? leadTimeDays },
    }).catch(() => undefined);
    return this.serializeSettings(row, orgId);
  }

  // ---------- Catalog (tracked rows) ----------

  private resolveThreshold(product: any): number {
    if (this.inventory?.resolveThreshold) return this.inventory.resolveThreshold(product);
    return product?.lowStockThreshold ?? 5;
  }

  /** ACTIVE products + their variants, and the tracked-row view of
   * them (see the granularity rule in the class doc). */
  private async loadCatalog(orgId: string): Promise<{
    products: any[];
    variantsByProduct: Map<string, any[]>;
    trackedRows: TrackedRow[];
  }> {
    const rawProducts = await (this.prisma as any).product
      .findMany({ where: { organizationId: orgId } })
      .catch(() => []);
    const products = (((rawProducts ?? []) as any[])).filter((p) => !p.status || p.status === "ACTIVE");
    const variantsByProduct = new Map<string, any[]>();
    for (const product of products) {
      const rawVariants = await (this.prisma as any).productVariant
        .findMany({ where: { productId: product.id } })
        .catch(() => []);
      const variants = ((rawVariants ?? []) as any[]);
      variantsByProduct.set(product.id, variants);
    }
    const trackedRows: TrackedRow[] = [];
    for (const product of products) {
      const threshold = this.resolveThreshold(product);
      const variants = variantsByProduct.get(product.id) ?? [];
      const trackedVariants = variants.filter((v: any) => v.stockQuantity != null);
      if (trackedVariants.length > 0) {
        for (const variant of trackedVariants) {
          trackedRows.push({
            productId: product.id,
            productName: product.name,
            variantId: variant.id,
            variantName: variant.name ?? null,
            sku: variant.sku ?? null,
            currentStock: variant.stockQuantity,
            threshold,
          });
        }
      } else if (product.stockQuantity != null) {
        trackedRows.push({
          productId: product.id,
          productName: product.name,
          variantId: null,
          variantName: null,
          sku: product.sku ?? null,
          currentStock: product.stockQuantity,
          threshold,
        });
      }
    }
    return { products, variantsByProduct, trackedRows };
  }

  // ---------- Sold orders ----------

  /** The codebase's delivered bucket (orders/risk-score.ts): an
   * order counts as SOLD when its status is NOT a dead state
   * (cancelled / refunded / failed) AND it is delivered-proven —
   * status "completed" (or "delivered") OR a CourierShipment in
   * delivered / partial_delivered. A merely-placed order
   * (pending / processing with no delivered shipment) is NOT a
   * sale yet: the parcel may still come back. */
  private isSoldOrder(order: any, shipmentStatuses: string[]): boolean {
    const status = String(order?.status ?? "").toLowerCase();
    if (DEAD_ORDER_STATUSES.includes(status)) return false;
    if (status === "completed" || status === "delivered") return true;
    return shipmentStatuses.some((s) => DELIVERED_SHIPMENT_STATUSES.includes(String(s).toLowerCase()));
  }

  private effectiveDate(order: any): Date {
    // Codebase convention: placedAt, falling back to createdAt.
    return new Date(order?.placedAt ?? order?.createdAt);
  }

  /** Every sold-order line of the org as a flat sale event.
   * Variant mapping: an item whose sku equals a variant sku OF
   * THE SAME PRODUCT is that variant's sale (native checkout
   * stamps variant lines with sku = ProductVariant.sku and
   * resolves productId through that same sku); any other item is
   * a product-level sale. Items with no productId carry no
   * product velocity and are skipped. */
  private async loadSaleEvents(
    orgId: string,
    variantsByProduct: Map<string, any[]>,
  ): Promise<SaleEvent[]> {
    const rawOrders = await (this.prisma as any).order
      .findMany({ where: { organizationId: orgId } })
      .catch(() => []);
    const orders = ((rawOrders ?? []) as any[]);
    if (!orders.length) return [];

    const shipmentTable = (this.prisma as any).courierShipment;
    const shipments = ((shipmentTable?.findMany
      ? await shipmentTable.findMany({ where: { organizationId: orgId } }).catch(() => [])
      : []) ?? []) as any[];
    const statusesByOrder = new Map<string, string[]>();
    for (const s of shipments) {
      const list = statusesByOrder.get(s.orderId) ?? [];
      list.push(s.status);
      statusesByOrder.set(s.orderId, list);
    }

    const sold = orders.filter((o) => this.isSoldOrder(o, statusesByOrder.get(o.id) ?? []));
    if (!sold.length) return [];
    const soldIds = sold.map((o) => o.id);
    const dateByOrder = new Map<string, Date>(sold.map((o) => [o.id, this.effectiveDate(o)]));

    let items: any[] = [];
    try {
      const rawItems = await (this.prisma as any).orderItem.findMany({
        where: { orderId: { in: soldIds } },
      });
      items = ((rawItems ?? []) as any[]);
    } catch {
      // Fallback for clients/fakes without `in` support: per-order.
      items = [];
      for (const id of soldIds) {
        const rawRows = await (this.prisma as any).orderItem
          .findMany({ where: { orderId: id } })
          .catch(() => []);
        items.push(...(((rawRows ?? []) as any[])));
      }
    }

    const events: SaleEvent[] = [];
    for (const item of items) {
      if (!item.productId) continue;
      const qty = Number(item.quantity ?? 0);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const date = dateByOrder.get(item.orderId);
      if (!date || Number.isNaN(date.getTime())) continue;
      let variantId: string | null = null;
      if (item.sku) {
        const variant = (variantsByProduct.get(item.productId) ?? []).find(
          (v: any) => v.sku != null && String(v.sku) === String(item.sku),
        );
        variantId = variant?.id ?? null;
      }
      events.push({ productId: item.productId, variantId, quantity: qty, date });
    }
    return events;
  }

  /** Events belonging to one tracked row: a variant row owns only
   * its own variant's events; a product row owns ALL of the
   * product's events (variant sales are that product's sales). */
  private eventsForRow(events: SaleEvent[], row: TrackedRow): SaleEvent[] {
    if (row.variantId) {
      return events.filter((e) => e.productId === row.productId && e.variantId === row.variantId);
    }
    return events.filter((e) => e.productId === row.productId);
  }

  // ---------- Costs ----------

  /** Latest ProductCost minor for a tracked row. Variant-specific
   * rows are preferred for a variant row; when none exists the
   * product-level (variantId = null) latest is used. "Latest" =
   * effectiveFrom desc, tie-break createdAt desc, then id desc —
   * sorted in JS so the rule is identical everywhere. */
  private pickLatestCost(rows: any[]): bigint | null {
    if (!rows.length) return null;
    const sorted = rows.slice().sort((a, b) => {
      const eff = new Date(b.effectiveFrom ?? b.createdAt).getTime() - new Date(a.effectiveFrom ?? a.createdAt).getTime();
      if (eff !== 0) return eff;
      const created = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (created !== 0) return created;
      return String(b.id ?? "").localeCompare(String(a.id ?? ""));
    });
    try {
      return BigInt(sorted[0].costMinor);
    } catch {
      return null;
    }
  }

  private async loadCostsByProduct(productIds: string[]): Promise<Map<string, any[]>> {
    const out = new Map<string, any[]>();
    if (!productIds.length) return out;
    let rows: any[] = [];
    try {
      rows = (((await (this.prisma as any).productCost.findMany({
        where: { productId: { in: productIds } },
      })) ?? []) as any[]);
    } catch {
      rows = [];
      for (const productId of productIds) {
        const part = (((await (this.prisma as any).productCost
          .findMany({ where: { productId } })
          .catch(() => [])) ?? []) as any[]);
        rows.push(...part);
      }
    }
    for (const row of rows) {
      const list = out.get(row.productId) ?? [];
      list.push(row);
      out.set(row.productId, list);
    }
    return out;
  }

  private latestCostFor(costsByProduct: Map<string, any[]>, row: TrackedRow): bigint | null {
    const rows = costsByProduct.get(row.productId) ?? [];
    if (row.variantId) {
      const variantCost = this.pickLatestCost(rows.filter((r) => r.variantId === row.variantId));
      if (variantCost != null) return variantCost;
    }
    return this.pickLatestCost(rows.filter((r) => r.variantId == null));
  }

  // ---------- Velocity ----------

  /**
   * Per tracked row: units sold in [now − windowDays, now]
   * (inclusive both ends, by effective order date), daily
   * velocity, and the projected stockout.
   *
   * Stockout rules: velocity 0 ⇒ daysOfStockLeft /
   * projectedStockoutDate are null (no honest projection exists).
   * Stock 0 (or negative — COD oversell) with velocity > 0 ⇒
   * already stocked out: daysOfStockLeft 0 and the stockout date
   * is `now` itself. Otherwise stockout = now + daysOfStockLeft.
   *
   * `nowOverride` exists for deterministic specs; controllers
   * never pass it.
   */
  async velocity(orgId: string, windowDays: number, nowOverride?: Date) {
    if (!(VELOCITY_WINDOWS as readonly number[]).includes(windowDays)) {
      throw new BadRequestException("উইন্ডো (windowDays) অবশ্যই ৩০, ৬০ বা ৯০ দিনের একটি হতে হবে");
    }
    const now = nowOverride ?? new Date();
    const startMs = now.getTime() - windowDays * DAY_MS;
    const { variantsByProduct, trackedRows } = await this.loadCatalog(orgId);
    const events = await this.loadSaleEvents(orgId, variantsByProduct);

    const items = trackedRows.map((row) => {
      const rowEvents = this.eventsForRow(events, row).filter((e) => {
        const t = e.date.getTime();
        return t >= startMs && t <= now.getTime();
      });
      const unitsSold = rowEvents.reduce((sum, e) => sum + e.quantity, 0);
      const dailyVelocity = unitsSold / windowDays;
      let daysOfStockLeft: number | null = null;
      let projectedStockoutDate: string | null = null;
      if (dailyVelocity > 0) {
        daysOfStockLeft = row.currentStock > 0 ? row.currentStock / dailyVelocity : 0;
        projectedStockoutDate = new Date(now.getTime() + daysOfStockLeft * DAY_MS).toISOString();
      }
      return {
        productId: row.productId,
        productName: row.productName,
        variantId: row.variantId,
        variantName: row.variantName,
        sku: row.sku,
        currentStock: row.currentStock,
        unitsSold,
        dailyVelocity,
        daysOfStockLeft,
        projectedStockoutDate,
      };
    });
    return { windowDays, items, generatedAt: now.toISOString() };
  }

  // ---------- Reorder suggestions (velocity mode) ----------

  /**
   * Velocity-mode reorder suggestions. A row is suggested when
   * ceil(dailyVelocity × leadTimeDays) − currentStock > 0 — i.e.
   * the stock on hand will not cover one lead time of sales at
   * the 30-day velocity. Rows with zero velocity are EXCLUDED
   * (no recent demand is not proof more stock is needed) and
   * counted in noRecentSalesCount; rows whose stock already
   * covers the lead time are excluded silently.
   *
   * Shape parity with the simple mode: product/variant identity,
   * sku and currentStock are the same fields; lastSupplier /
   * lastUnitCostMinor are honestly null here (the supplier lookup
   * lives in PurchasingService and is not duplicated).
   */
  async reorderSuggestionsV2(orgId: string, mode?: string) {
    if (mode !== undefined && mode !== "velocity") {
      throw new BadRequestException("mode অবশ্যই simple বা velocity হতে হবে — simple মোডের জন্য বিদ্যমান সাজেশন ব্যবহার করুন");
    }
    const settings = await this.getSettings(orgId);
    const leadTimeDays = settings.leadTimeDays;
    const vel = await this.velocity(orgId, SUGGESTION_WINDOW_DAYS);
    let noRecentSalesCount = 0;
    const items: any[] = [];
    for (const row of vel.items) {
      if (!(row.dailyVelocity > 0)) {
        noRecentSalesCount++;
        continue;
      }
      const suggestedQty = Math.max(
        0,
        Math.ceil(row.dailyVelocity * leadTimeDays) - row.currentStock,
      );
      if (suggestedQty <= 0) continue;
      items.push({
        productId: row.productId,
        productName: row.productName,
        variantId: row.variantId,
        variantName: row.variantName,
        sku: row.sku,
        currentStock: row.currentStock,
        suggestedQty,
        basis: "velocity",
        dailyVelocity: row.dailyVelocity,
        leadTimeDays,
        unitsSold: row.unitsSold,
        windowDays: SUGGESTION_WINDOW_DAYS,
        lastSupplier: null,
        lastUnitCostMinor: null,
      });
    }
    return { mode: "velocity", items, noRecentSalesCount };
  }

  // ---------- Dead stock ----------

  /**
   * Tracked rows with stock > 0 and NO sale in [now − days, now].
   * Boundary rule: a sale whose effective date is EXACTLY
   * now − days counts as INSIDE the window (inclusive), so that
   * row is NOT dead; 1ms older and the row is dead. A variant
   * row's sales are its own variant's sales; a product row's
   * sales are all of the product's sales (see eventsForRow).
   * lastSaleAt is the row's most recent sale at ANY time (null
   * when it never sold). unvaluedCount counts the DEAD rows
   * whose latest cost is unknown — their stuckValueMinor is
   * null, never an invented number.
   */
  async deadStock(orgId: string, days: number = 90, nowOverride?: Date) {
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw new BadRequestException("দিনের সংখ্যা (days) অবশ্যই ১ থেকে ৩৬৫-এর মধ্যে পূর্ণসংখ্যা হতে হবে");
    }
    const now = nowOverride ?? new Date();
    const startMs = now.getTime() - days * DAY_MS;
    const { variantsByProduct, trackedRows } = await this.loadCatalog(orgId);
    const stocked = trackedRows.filter((r) => r.currentStock > 0);
    const events = await this.loadSaleEvents(orgId, variantsByProduct);
    const costsByProduct = await this.loadCostsByProduct([...new Set(stocked.map((r) => r.productId))]);

    let unvaluedCount = 0;
    const items = [];
    for (const row of stocked) {
      const rowEvents = this.eventsForRow(events, row);
      const soldInWindow = rowEvents.some((e) => {
        const t = e.date.getTime();
        return t >= startMs && t <= now.getTime();
      });
      if (soldInWindow) continue;
      const lastSaleAt = rowEvents.length
        ? new Date(Math.max(...rowEvents.map((e) => e.date.getTime()))).toISOString()
        : null;
      const unitCost = this.latestCostFor(costsByProduct, row);
      if (unitCost == null) unvaluedCount++;
      items.push({
        productId: row.productId,
        productName: row.productName,
        variantId: row.variantId,
        variantName: row.variantName,
        sku: row.sku,
        currentStock: row.currentStock,
        lastSaleAt,
        unitCostMinor: unitCost != null ? String(unitCost) : null,
        stuckValueMinor: unitCost != null ? String(BigInt(row.currentStock) * unitCost) : null,
        _stuck: unitCost != null ? BigInt(row.currentStock) * unitCost : null,
      });
    }
    items.sort((a, b) => {
      if (a._stuck == null && b._stuck == null) return 0;
      if (a._stuck == null) return 1; // nulls last
      if (b._stuck == null) return -1;
      if (a._stuck !== b._stuck) return a._stuck > b._stuck ? -1 : 1;
      return 0;
    });
    return {
      days,
      items: items.map(({ _stuck, ...rest }) => rest),
      unvaluedCount,
    };
  }

  async deadStockCsv(orgId: string, days: number = 90): Promise<string> {
    const { items } = await this.deadStock(orgId, days);
    return toCsv(
      ["product_id", "product_name", "variant_id", "variant_name", "sku", "current_stock", "last_sale_at", "unit_cost_minor", "stuck_value_minor"],
      items.map((i) => [
        i.productId, i.productName, i.variantId ?? "", i.variantName ?? "", i.sku ?? "",
        i.currentStock, i.lastSaleAt ?? "", i.unitCostMinor ?? "", i.stuckValueMinor ?? "",
      ]),
    );
  }

  // ---------- Valuation ----------

  /**
   * Stock value at latest cost over tracked rows with stock > 0.
   * Rows without any cost are counted in unvaluedProducts and
   * contribute nothing to totalValueMinor — the total is the
   * value of what is actually costed, never an estimate padded
   * with invented costs. items = valued rows only, value desc,
   * capped at 100. All money crosses as strings (BigInt).
   */
  async valuation(orgId: string) {
    const { trackedRows } = await this.loadCatalog(orgId);
    const stocked = trackedRows.filter((r) => r.currentStock > 0);
    const costsByProduct = await this.loadCostsByProduct([...new Set(stocked.map((r) => r.productId))]);

    let totalValueMinor = 0n;
    let valuedProducts = 0;
    let unvaluedProducts = 0;
    const valued: any[] = [];
    for (const row of stocked) {
      const unitCost = this.latestCostFor(costsByProduct, row);
      if (unitCost == null) {
        unvaluedProducts++;
        continue;
      }
      const valueMinor = BigInt(row.currentStock) * unitCost;
      totalValueMinor += valueMinor;
      valuedProducts++;
      valued.push({
        productId: row.productId,
        productName: row.productName,
        variantId: row.variantId,
        variantName: row.variantName,
        sku: row.sku,
        currentStock: row.currentStock,
        unitCostMinor: String(unitCost),
        valueMinor: String(valueMinor),
        _value: valueMinor,
      });
    }
    valued.sort((a, b) => (a._value === b._value ? 0 : a._value > b._value ? -1 : 1));
    return {
      totalValueMinor: String(totalValueMinor),
      currency: "BDT",
      valuedProducts,
      unvaluedProducts,
      items: valued.slice(0, 100).map(({ _value, ...rest }) => rest),
    };
  }
}
