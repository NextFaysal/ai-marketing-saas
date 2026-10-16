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
    if (!row) {
      // GB2 (GC7): the newer fields serialize with their schema
      // defaults even when no settings row exists yet.
      return { organizationId: orgId, leadTimeDays: DEFAULT_LEAD_TIME_DAYS, allowBackorder: false, reserveMinutes: 0 };
    }
    return {
      id: row.id,
      organizationId: row.organizationId ?? orgId,
      leadTimeDays: row.leadTimeDays ?? DEFAULT_LEAD_TIME_DAYS,
      allowBackorder: row.allowBackorder === true,
      reserveMinutes: Math.max(0, Number(row.reserveMinutes ?? 0) || 0),
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

  /** Partial update (GB2 widened): leadTimeDays keeps its
   * original 1..180 validation WHENEVER THE KEY IS PRESENT
   * (EC33 pins the Bengali message for 0 / 181 / fractional /
   * non-integer / null / undefined values, and the audit
   * metadata { leadTimeDays } for lead-time-only updates); the
   * GB2 fields validate their own ranges when their keys are
   * present. A patch with NO recognized key fails as the legacy
   * lead-time validation error. Only provided fields change. */
  async updateSettings(orgId: string, actorId: string, dto: { leadTimeDays?: unknown; allowBackorder?: unknown; reserveMinutes?: unknown }) {
    const d: any = dto ?? {};
    const hasLead = "leadTimeDays" in d;
    const hasBackorder = "allowBackorder" in d;
    const hasReserve = "reserveMinutes" in d;
    const LEAD_MSG = "লিড টাইম (leadTimeDays) অবশ্যই ১ থেকে ১৮০ দিনের মধ্যে পূর্ণসংখ্যা হতে হবে";
    if (!hasLead && !hasBackorder && !hasReserve) {
      throw new BadRequestException(LEAD_MSG);
    }
    const data: Record<string, unknown> = {};
    if (hasLead) {
      const leadTimeDays = d.leadTimeDays;
      if (!Number.isInteger(leadTimeDays) || (leadTimeDays as number) < 1 || (leadTimeDays as number) > 180) {
        throw new BadRequestException(LEAD_MSG);
      }
      data.leadTimeDays = leadTimeDays;
    }
    if (hasBackorder) {
      if (typeof d.allowBackorder !== "boolean") {
        throw new BadRequestException("allowBackorder অবশ্যই true/false হতে হবে");
      }
      data.allowBackorder = d.allowBackorder;
    }
    if (hasReserve) {
      const rm = d.reserveMinutes;
      if (!Number.isInteger(rm) || (rm as number) < 0 || (rm as number) > 1440) {
        throw new BadRequestException("রিজার্ভ সময় (reserveMinutes) অবশ্যই ০ থেকে ১৪৪০ মিনিটের মধ্যে পূর্ণসংখ্যা হতে হবে");
      }
      data.reserveMinutes = rm;
    }
    const table = this.settingsTable();
    const existing = table?.findFirst
      ? await table.findFirst({ where: { organizationId: orgId } }).catch(() => null)
      : null;
    const row = existing
      ? await table.update({ where: { id: existing.id }, data })
      : await table.create({ data: { organizationId: orgId, leadTimeDays: DEFAULT_LEAD_TIME_DAYS, ...data } });
    // Audit metadata: lead-time updates keep the EC33 shape
    // ({ leadTimeDays }); GB2 field changes are named in
    // `changed` (both appear on a mixed patch).
    const gb2Changed = Object.keys(data).filter((k) => k !== "leadTimeDays");
    const metadata: Record<string, unknown> = {};
    if (data.leadTimeDays !== undefined) metadata.leadTimeDays = data.leadTimeDays;
    if (gb2Changed.length > 0) metadata.changed = gb2Changed;
    await this.audit?.log({
      organizationId: orgId,
      userId: actorId,
      action: "inventory_settings.updated",
      entityType: "InventorySetting",
      entityId: row.id,
      metadata,
    }).catch(() => undefined);
    return this.serializeSettings(row, orgId);
  }

  // ---------- GB2 (GC7): availability + damage report ----------

  /**
   * Per-tracked-row availability for the inventory UI:
   * on-hand, reserved (active unexpired StockReservations) and
   * available = on-hand − reserved, at the same row granularity
   * as the velocity catalog (variant rows when the product has
   * variants, otherwise the product row).
   */
  async availability(organizationId: string) {
    const catalog = await this.loadCatalog(organizationId);
    const totals = this.inventory
      ? await this.inventory.activeReservationTotals(organizationId)
      : new Map<string, number>();
    const items = catalog.trackedRows.map((item) => {
      const key = `${item.productId}::${item.variantId ?? ""}`;
      const reserved = totals.get(key) ?? 0;
      const onHand = item.currentStock;
      return {
        productId: item.productId,
        productName: item.productName,
        variantId: item.variantId,
        variantName: item.variantName,
        sku: item.sku,
        onHand,
        reserved,
        available: onHand - reserved,
      };
    });
    const settings = await this.getSettings(organizationId);
    return { items, reserveMinutes: (settings as any).reserveMinutes ?? 0 };
  }

  /**
   * Damaged / lost / expired report over an inclusive date
   * range: StockMovement rows whose reason is one of the coded
   * damage reasons. Totals count only stock-OUT movements
   * (negative deltas — a positive "damaged" adjustment is a
   * correction, not a loss); the row list keeps every
   * damage-reason movement for honesty. Cost value uses the
   * ON7 as-of rule (variant-specific cost beats product cost;
   * latest effectiveFrom ≤ movement time, else earliest after);
   * a movement with NO recorded cost is counted in
   * uncostedMovements and contributes nothing — never an
   * invented value.
   */
  async damageReport(organizationId: string, from?: string, to?: string) {
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86_400_000);
    const toDate = to ? new Date(to) : new Date();
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      throw new BadRequestException("তারিখ সঠিক নয়");
    }
    const movements: any[] = ((await (this.prisma as any).stockMovement
      .findMany({
        where: {
          organizationId,
          reason: { in: ["damaged", "lost", "expired"] },
          createdAt: { gte: fromDate, lte: toDate },
        },
        orderBy: { createdAt: "asc" },
        take: 2000,
      })
      .catch(() => [])) ?? []) as any[];
    const productIds = [...new Set(movements.map((m: any) => String(m.productId)))];
    const costRows: any[] = productIds.length
      ? (((await (this.prisma as any).productCost
          .findMany({ where: { productId: { in: productIds } } })
          .catch(() => [])) ?? []) as any[])
      : [];
    const costAt = (productId: string, variantId: string | null, at: Date): bigint | null => {
      const rows = costRows
        .filter((c: any) => String(c.productId) === productId && (variantId ? c.variantId === variantId : !c.variantId))
        .sort((a: any, b: any) => new Date(a.effectiveFrom).getTime() - new Date(b.effectiveFrom).getTime());
      if (rows.length === 0) return null;
      let chosen: any = null;
      for (const r of rows) {
        if (new Date(r.effectiveFrom).getTime() <= at.getTime()) chosen = r;
      }
      const pick = chosen ?? rows[0];
      return pick ? BigInt(pick.costMinor) : null;
    };
    const names = new Map<string, { product: string; variant: string | null }>();
    if (productIds.length) {
      const products: any[] = ((await (this.prisma as any).product
        .findMany({ where: { id: { in: productIds } }, include: { variants: true } })
        .catch(() => [])) ?? []) as any[];
      for (const p of products) {
        names.set(`${p.id}::`, { product: p.name, variant: null });
        for (const v of p.variants ?? []) names.set(`${p.id}::${v.id}`, { product: p.name, variant: v.name });
      }
    }
    const rows = movements.map((m: any) => {
      const delta = Number(m.delta) || 0;
      const qty = Math.abs(delta);
      const isOut = delta < 0;
      const unitCost = isOut ? costAt(String(m.productId), m.variantId ?? null, new Date(m.createdAt)) : null;
      const label = names.get(`${m.productId}::${m.variantId ?? ""}`) ?? { product: String(m.productId), variant: null };
      return {
        at: m.createdAt ? new Date(m.createdAt).toISOString() : null,
        productId: String(m.productId),
        productName: label.product,
        variantId: m.variantId ?? null,
        variantName: label.variant,
        reason: String(m.reason),
        quantity: isOut ? qty : 0,
        delta,
        costValueMinor: isOut && unitCost != null ? (unitCost * BigInt(qty)).toString() : null,
      };
    });
    const totals = { damaged: 0, lost: 0, expired: 0, totalQuantity: 0, costValueMinor: "0", uncostedMovements: 0 };
    let costSum = 0n;
    for (const r of rows) {
      if (r.delta >= 0) continue;
      if (r.reason === "damaged") totals.damaged += r.quantity;
      if (r.reason === "lost") totals.lost += r.quantity;
      if (r.reason === "expired") totals.expired += r.quantity;
      totals.totalQuantity += r.quantity;
      if (r.costValueMinor != null) costSum += BigInt(r.costValueMinor);
      else totals.uncostedMovements++;
    }
    totals.costValueMinor = costSum.toString();
    return {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      rows,
      totals,
      truncated: movements.length >= 2000,
    };
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
      const allRowEvents = this.eventsForRow(events, row);
      const rowEvents = allRowEvents.filter((e) => {
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

      // ---------- AB7 (AX20): forecasting v2 (additive) ----------
      // Deterministic statistics over the SAME sold-order events
      // and row identity as v1 — no ML, no learned model. The v1
      // fields above are byte-identical in behaviour; everything
      // below rides the same rows.
      //
      // Windows (all end at `now`, all by effective order date):
      //   last 30d:  t ∈ [now−30d, now]     (matches v1's window)
      //   prior 30d: t ∈ [now−60d, now−30d) (days 31–60; the 30d
      //     boundary instant belongs to the last-30 window only)
      //   last 90d:  t ∈ [now−90d, now]     (weekday profile)
      // vel30 / velPrior are units/day over their 30d windows.
      //
      // trendGrowthPct = (vel30 − velPrior) / velPrior × 100,
      //   rounded to 1 decimal; NULL when velPrior = 0 (never a
      //   divide-by-zero dressed up as a number), even if both
      //   windows are empty.
      // trendFactor = velPrior > 0 ? clamp(vel30/velPrior, 0.5, 2)
      //   : 1  (clamped so one spike/collapse cannot double or
      //   halve the projection unboundedly).
      //
      // weekdayFactors[w] (w = JS getDay(), 0 = Sunday), from the
      //   last 90d of daily sales:
      //     raw[w] = (units on weekday w / occurrences of w in
      //               the 90d window) / (total 90d units / 90)
      //   then normalized by their mean so mean(factors) ≈ 1
      //   (rounded to 4 decimals). Requires >= 21 DISTINCT days
      //   with sales in the 90d window; below that the history is
      //   too sparse to claim a weekly pattern → all factors 1.0
      //   and demandBasis "velocity" (else "trend_seasonal").
      //
      // projectedDailyDemand = vel30 × trendFactor × (mean of
      //   weekdayFactors over the NEXT 7 calendar days), rounded
      //   to 3 decimals; 0 when vel30 = 0.
      //
      // Stockout v2: simulate day-by-day starting tomorrow; each
      //   day d subtracts vel30 × trendFactor × factor[weekday(d)];
      //   the first day whose cumulative demand >= currentStock
      //   is the stockout. Capped at 365 days → beyond that both
      //   v2 fields are null. currentStock <= 0 with vel30 > 0
      //   mirrors v1's stocked-out rule (0 days, date = now);
      //   vel30 = 0 → both null (no honest projection).
      const nowMs = now.getTime();
      const inWindow = (e: SaleEvent, fromMs: number, toMs: number, toInclusive: boolean) => {
        const t = e.date.getTime();
        return t >= fromMs && (toInclusive ? t <= toMs : t < toMs);
      };
      const unitsLast30 = allRowEvents
        .filter((e) => inWindow(e, nowMs - 30 * DAY_MS, nowMs, true))
        .reduce((sum, e) => sum + e.quantity, 0);
      const unitsPrior30 = allRowEvents
        .filter((e) => inWindow(e, nowMs - 60 * DAY_MS, nowMs - 30 * DAY_MS, false))
        .reduce((sum, e) => sum + e.quantity, 0);
      const vel30 = unitsLast30 / 30;
      const velPrior = unitsPrior30 / 30;
      const trendGrowthPct =
        velPrior > 0 ? Math.round(((vel30 - velPrior) / velPrior) * 100 * 10) / 10 : null;
      const trendFactor = velPrior > 0 ? Math.min(2, Math.max(0.5, vel30 / velPrior)) : 1;

      // Daily buckets over the last 90 days (in memory from the
      // one events scan — no per-row queries).
      const start90Ms = nowMs - 90 * DAY_MS;
      const unitsByWeekday = [0, 0, 0, 0, 0, 0, 0];
      const weekdayOccurrences = [0, 0, 0, 0, 0, 0, 0];
      for (let d = 0; d < 90; d++) {
        weekdayOccurrences[new Date(start90Ms + d * DAY_MS).getDay()]++;
      }
      const distinctSalesDays = new Set<string>();
      let units90 = 0;
      for (const e of allRowEvents) {
        const t = e.date.getTime();
        if (t < start90Ms || t > nowMs) continue;
        units90 += e.quantity;
        unitsByWeekday[e.date.getDay()] += e.quantity;
        distinctSalesDays.add(`${e.date.getFullYear()}-${e.date.getMonth()}-${e.date.getDate()}`);
      }
      const hasSeasonalHistory = distinctSalesDays.size >= 21 && units90 > 0;
      let weekdayFactors: number[] = [1, 1, 1, 1, 1, 1, 1];
      if (hasSeasonalHistory) {
        const overallDaily = units90 / 90;
        const raw = unitsByWeekday.map((u, w) =>
          weekdayOccurrences[w] > 0 && overallDaily > 0 ? u / weekdayOccurrences[w] / overallDaily : 0,
        );
        const rawMean = raw.reduce((s, x) => s + x, 0) / 7;
        if (rawMean > 0) {
          weekdayFactors = raw.map((x) => Math.round((x / rawMean) * 10000) / 10000);
        }
      }
      const demandBasis: "trend_seasonal" | "velocity" = hasSeasonalHistory ? "trend_seasonal" : "velocity";

      let projectedDailyDemand = 0;
      if (vel30 > 0) {
        let next7FactorSum = 0;
        for (let d = 1; d <= 7; d++) {
          next7FactorSum += weekdayFactors[new Date(nowMs + d * DAY_MS).getDay()];
        }
        projectedDailyDemand = Math.round(vel30 * trendFactor * (next7FactorSum / 7) * 1000) / 1000;
      }

      let daysOfStockLeftV2: number | null = null;
      let projectedStockoutDateV2: string | null = null;
      if (vel30 > 0) {
        if (row.currentStock <= 0) {
          daysOfStockLeftV2 = 0;
          projectedStockoutDateV2 = now.toISOString();
        } else {
          let cumulative = 0;
          for (let d = 1; d <= 365; d++) {
            const date = new Date(nowMs + d * DAY_MS);
            cumulative += vel30 * trendFactor * weekdayFactors[date.getDay()];
            if (cumulative >= row.currentStock) {
              daysOfStockLeftV2 = d;
              projectedStockoutDateV2 = date.toISOString();
              break;
            }
          }
        }
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
        trendGrowthPct,
        weekdayFactors,
        projectedDailyDemand,
        projectedStockoutDateV2,
        daysOfStockLeftV2,
        demandBasis,
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
