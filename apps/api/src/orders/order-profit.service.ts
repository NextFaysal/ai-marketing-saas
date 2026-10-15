import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TRANSIT_STATUSES, dhakaTodayString } from "./order-queues";
import { toCsv } from "../imports/csv";

/**
 * ON7 — Profit & COD board (read-only).
 *
 * Cost rule (as-of): a line's unit cost is the latest ProductCost
 * whose effectiveFrom <= the order's placedAt; if no such row
 * exists, the EARLIEST cost after placedAt (the closest known
 * cost — better than pretending the line cost nothing); if there
 * is no cost row at all for the applicable set, the line is
 * UNcosted and contributes nothing to productCost (never a guess).
 * The applicable set is the variant-specific rows (variant
 * resolved by the codebase SKU rule: (productId, sku) ->
 * ProductVariant.id) when the line has a variant AND any
 * variant-specific rows exist at any date; otherwise the
 * product-level rows (variantId = null).
 *
 * Gift lines (isGift) ARE costed: a free gift's product cost is a
 * real cost of the order even though its revenue is 0. Bundle
 * component lines are real lines and are costed like any line.
 *
 * Delivery actual: there is NO courier-charge field on
 * CourierShipment. The only real actual charge is
 * ReconciliationLine.sheetChargeMinor from the merchant's imported
 * settlement sheet, so an order's delivery actual is reported only
 * when EVERY shipment of the order has a matching sheet line —
 * partial truth is shown through deliveryActualCoverage instead
 * of a made-up total.
 */

const DAY_MS = 86400000;
const DEAD_ORDER_STATUSES = ["cancelled", "refunded", "failed"];
const DELIVERED_SHIPMENT_STATUSES = ["delivered", "partial_delivered"];
const RECON_CHARGE_OUTCOMES = ["matched", "amount_mismatch", "already_collected"];
const OPEN_DUE_EXCLUDED = ["cancelled", "refunded", "returned", "failed"];

function big(v: unknown): bigint {
  try { return BigInt(v as any); } catch { return 0n; }
}

/** Asia/Dhaka calendar date (YYYY-MM-DD) of an instant. BD is a
 * fixed UTC+06:00 with no DST, so a plain shift is exact (the
 * EC23 AccountingService convention). */
function dhakaDateString(d: Date): string {
  return new Date(d.getTime() + 6 * 3600 * 1000).toISOString().slice(0, 10);
}

interface CostContext {
  costsByProduct: Map<string, any[]>;
  variantIdByKey: Map<string, string>;
}

@Injectable()
export class OrderProfitService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- sold bucket ----------

  /** Mirror of the EC33 canonical predicate in
   * purchasing/inventory-intelligence.service.ts (isSoldOrder):
   * an order counts as SOLD when its status is NOT a dead state
   * (cancelled / refunded / failed) AND it is delivered-proven —
   * status "completed"/"delivered" OR any shipment in
   * delivered / partial_delivered. Importing PurchasingModule
   * into OrdersModule would risk a cycle, so this is a deliberate
   * 6-line mirror with this pointer, the same pattern EC33 uses
   * for orders/risk-score.ts. */
  private isSoldOrder(order: any, shipmentStatuses: string[]): boolean {
    const status = String(order?.status ?? "").toLowerCase();
    if (DEAD_ORDER_STATUSES.includes(status)) return false;
    if (status === "completed" || status === "delivered") return true;
    return shipmentStatuses.some((s) => DELIVERED_SHIPMENT_STATUSES.includes(String(s).toLowerCase()));
  }

  // ---------- cost resolution ----------

  private async loadCostContext(productIds: string[]): Promise<CostContext> {
    const costsByProduct = new Map<string, any[]>();
    const variantIdByKey = new Map<string, string>();
    if (!productIds.length) return { costsByProduct, variantIdByKey };
    const costTable = (this.prisma as any).productCost;
    if (costTable?.findMany) {
      const rows = (await costTable.findMany({
        where: { productId: { in: productIds } }, orderBy: { effectiveFrom: "asc" },
      }).catch(() => [])) ?? [];
      for (const r of rows) {
        const list = costsByProduct.get(String(r.productId)) ?? [];
        list.push(r);
        costsByProduct.set(String(r.productId), list);
      }
      for (const list of costsByProduct.values()) {
        list.sort((a: any, b: any) => new Date(a.effectiveFrom).getTime() - new Date(b.effectiveFrom).getTime());
      }
    }
    const variantTable = (this.prisma as any).productVariant;
    if (variantTable?.findMany) {
      const rows = (await variantTable.findMany({
        where: { productId: { in: productIds } },
      }).catch(() => [])) ?? [];
      for (const v of rows) {
        if (v?.sku != null) variantIdByKey.set(`${v.productId}::${v.sku}`, String(v.id));
      }
    }
    return { costsByProduct, variantIdByKey };
  }

  /** Unit cost for ONE line under the as-of rule (see class doc),
   * or null when the applicable set is empty (line uncosted). */
  private pickUnitCost(ctx: CostContext, line: any, placedAt: Date): bigint | null {
    if (!line?.productId) return null;
    const all = ctx.costsByProduct.get(String(line.productId)) ?? [];
    if (!all.length) return null;
    const variantId = line.sku != null ? ctx.variantIdByKey.get(`${line.productId}::${line.sku}`) ?? null : null;
    const variantRows = variantId ? all.filter((r: any) => r.variantId != null && String(r.variantId) === variantId) : [];
    const set = variantRows.length ? variantRows : all.filter((r: any) => r.variantId == null);
    if (!set.length) return null;
    const at = placedAt.getTime();
    let chosen: any = null;
    for (const r of set) {
      if (new Date(r.effectiveFrom).getTime() <= at) chosen = r;
      else break;
    }
    // None at-or-before placedAt -> the earliest after placedAt.
    if (!chosen) chosen = set[0];
    return big(chosen.costMinor ?? 0);
  }

  /** Batch cost resolution for the lines of ONE order at one
   * placedAt: one ProductCost query + one ProductVariant query
   * for all involved products, never per-line queries. */
  private async costForLines(_orgId: string, lines: any[], placedAt: Date) {
    const productIds = [...new Set(lines.map((l) => l?.productId).filter(Boolean).map(String))];
    const ctx = await this.loadCostContext(productIds);
    return lines.map((line) => {
      const unit = this.pickUnitCost(ctx, line, placedAt);
      const qty = Number(line?.quantity ?? 0) || 0;
      return { line, unitCostMinor: unit, costMinor: unit == null ? null : unit * BigInt(qty) };
    });
  }

  private effectiveDate(order: any): Date {
    return new Date(order?.placedAt ?? order?.createdAt ?? 0);
  }

  private async linesForOrder(order: any): Promise<any[]> {
    if (Array.isArray(order?.items)) return order.items;
    const table = (this.prisma as any).orderItem;
    if (!table?.findMany) return [];
    return (await table.findMany({ where: { orderId: order.id } }).catch(() => [])) ?? [];
  }

  private async approvedSumsByOrder(orgId: string, orderIds: string[]): Promise<Map<string, bigint>> {
    const out = new Map<string, bigint>();
    if (!orderIds.length) return out;
    const table = (this.prisma as any).paymentVerification;
    try {
      if (table?.groupBy) {
        const rows = await table.groupBy({
          by: ["orderId"],
          where: { organizationId: orgId, status: "approved", orderId: { in: orderIds } },
          _sum: { amountMinor: true },
        });
        for (const r of rows ?? []) {
          if (r?.orderId == null) continue;
          out.set(String(r.orderId), big(r._sum?.amountMinor ?? 0));
        }
        return out;
      }
    } catch { /* fall through to the findMany path */ }
    try {
      if (table?.findMany) {
        const rows = (await table.findMany({ where: { organizationId: orgId, status: "approved" } }).catch(() => [])) ?? [];
        const wanted = new Set(orderIds.map(String));
        for (const r of rows) {
          if (r?.orderId == null || !wanted.has(String(r.orderId)) || r.amountMinor == null) continue;
          out.set(String(r.orderId), (out.get(String(r.orderId)) ?? 0n) + big(r.amountMinor));
        }
      }
    } catch { /* advisory math only */ }
    return out;
  }

  // ---------- per-order profit ----------

  async getOrderProfit(orgId: string, orderId: string) {
    const order = await (this.prisma as any).order.findFirst({ where: { id: orderId, organizationId: orgId } });
    if (!order) throw new NotFoundException("এই সংগঠনে অর্ডার পাওয়া যায়নি।");
    const lines = await this.linesForOrder(order);
    const placedAt = this.effectiveDate(order);
    const costed = await this.costForLines(orgId, lines, placedAt);

    let productCost: bigint | null = null;
    let costedLines = 0;
    const uncostedLines: any[] = [];
    let uncostedRevenue = 0n;
    for (const c of costed) {
      if (c.costMinor != null) {
        productCost = (productCost ?? 0n) + c.costMinor;
        costedLines += 1;
      } else {
        uncostedLines.push({
          name: c.line?.name ?? "", sku: c.line?.sku ?? null,
          quantity: Number(c.line?.quantity ?? 0) || 0,
          revenueMinor: String(big(c.line?.totalMinor ?? 0)),
        });
        uncostedRevenue += big(c.line?.totalMinor ?? 0);
      }
    }

    // Delivery actual (see class doc for the only real source).
    const shipmentTable = (this.prisma as any).courierShipment;
    const shipments: any[] = shipmentTable?.findMany
      ? ((await shipmentTable.findMany({ where: { organizationId: orgId, orderId: order.id } }).catch(() => [])) ?? [])
      : [];
    let withCharge = 0;
    let chargeSum = 0n;
    if (shipments.length) {
      const lineTable = (this.prisma as any).reconciliationLine;
      const recon: any[] = lineTable?.findMany
        ? ((await lineTable.findMany({
            where: { organizationId: orgId, matchedShipmentId: { in: shipments.map((s: any) => String(s.id)) } },
          }).catch(() => [])) ?? [])
        : [];
      for (const s of shipments) {
        const candidates = recon
          .filter((r: any) => String(r.matchedShipmentId) === String(s.id)
            && r.sheetChargeMinor != null && RECON_CHARGE_OUTCOMES.includes(String(r.outcome)))
          .sort((a: any, b: any) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime());
        if (candidates.length) {
          withCharge += 1;
          chargeSum += big(candidates[0].sheetChargeMinor);
        }
      }
    }
    const deliveryActual: bigint | null =
      shipments.length > 0 && withCharge === shipments.length ? chargeSum : null;

    const revenue = big(order.totalMinor ?? 0);
    const grossMargin: bigint | null = productCost != null ? revenue - productCost : null;
    const netMargin: bigint | null =
      deliveryActual != null && grossMargin != null ? grossMargin - deliveryActual : null;

    return {
      orderId: String(order.id),
      orderNumber: order.externalNumber ?? order.externalId ?? String(order.id),
      revenueMinor: String(revenue),
      discountMinor: String(big(order.discountMinor ?? 0)),
      deliveryChargedMinor: String(big(order.shippingMinor ?? 0)),
      productCostMinor: productCost != null ? String(productCost) : null,
      costedLines,
      uncostedLines,
      uncostedRevenueMinor: String(uncostedRevenue),
      grossMarginMinor: grossMargin != null ? String(grossMargin) : null,
      deliveryActualMinor: deliveryActual != null ? String(deliveryActual) : null,
      deliveryActualCoverage: { shipments: shipments.length, withCharge },
      netMarginMinor: netMargin != null ? String(netMargin) : null,
    };
  }

  // ---------- profit report ----------

  /** EC23 AccountingService.parsePeriod, mirrored exactly: the
   * period is Asia/Dhaka calendar days, [from 00:00, to
   * 23:59:59.999] +06:00. Defaults (controller contract): the
   * last 30 Dhaka days ending today (Dhaka) when absent. */
  private resolveRange(from?: string, to?: string): { from: string; to: string; start: Date; end: Date } {
    let f = from?.trim() ? from.trim() : null;
    let t = to?.trim() ? to.trim() : null;
    if (!t) t = dhakaTodayString();
    if (!f) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
        const base = new Date(`${t}T00:00:00Z`);
        f = new Date(base.getTime() - 29 * DAY_MS).toISOString().slice(0, 10);
      } else {
        f = t;
      }
    }
    const bad = () => new BadRequestException("তারিখ সঠিক নয় — from ও to দুটোই YYYY-MM-DD আকারে দিন");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || !/^\d{4}-\d{2}-\d{2}$/.test(t)) throw bad();
    const start = new Date(`${f}T00:00:00+06:00`);
    const end = new Date(`${t}T23:59:59.999+06:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw bad();
    if (dhakaDateString(start) !== f || dhakaDateString(end) !== t) throw bad();
    if (start > end) throw new BadRequestException("শুরুর তারিখ শেষের তারিখের পরে হতে পারে না");
    const days = Math.round(
      (Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1, Number(t.slice(8, 10))) -
        Date.UTC(Number(f.slice(0, 4)), Number(f.slice(5, 7)) - 1, Number(f.slice(8, 10)))) / DAY_MS,
    ) + 1;
    if (days > 366) throw new BadRequestException("সর্বোচ্চ ৩৬৬ দিনের রিপোর্ট একবারে নেওয়া যাবে");
    return { from: f, to: t, start, end };
  }

  async getProfitReport(orgId: string, range: { from?: string; to?: string } = {}) {
    const { from, to, start, end } = this.resolveRange(range?.from, range?.to);
    // Bounded load, then the EC23 in-memory effective-date filter
    // (placedAt, fallback createdAt — a placedAt-only Prisma range
    // would silently drop legacy rows whose placedAt is null).
    const rawOrders: any[] = ((await (this.prisma as any).order.findMany({
      where: { organizationId: orgId, isPractice: false }, take: 5000,
    }).catch(() => [])) ?? []);
    const inRange = rawOrders.filter((o: any) => {
      const eff = this.effectiveDate(o);
      return !Number.isNaN(eff.getTime()) && eff >= start && eff <= end;
    });

    const shipmentTable = (this.prisma as any).courierShipment;
    const shipments: any[] = shipmentTable?.findMany && inRange.length
      ? ((await shipmentTable.findMany({
          where: { organizationId: orgId, orderId: { in: inRange.map((o: any) => String(o.id)) } },
        }).catch(() => [])) ?? [])
      : [];
    const statusesByOrder = new Map<string, string[]>();
    for (const s of shipments) {
      const list = statusesByOrder.get(String(s.orderId)) ?? [];
      list.push(String(s.status));
      statusesByOrder.set(String(s.orderId), list);
    }
    const sold = inRange.filter((o: any) => this.isSoldOrder(o, statusesByOrder.get(String(o.id)) ?? []));

    const itemTable = (this.prisma as any).orderItem;
    const items: any[] = itemTable?.findMany && sold.length
      ? ((await itemTable.findMany({ where: { orderId: { in: sold.map((o: any) => String(o.id)) } } }).catch(() => [])) ?? [])
      : [];
    const itemsByOrder = new Map<string, any[]>();
    for (const it of items) {
      const list = itemsByOrder.get(String(it.orderId)) ?? [];
      list.push(it);
      itemsByOrder.set(String(it.orderId), list);
    }

    // One cost-context load for every involved product.
    const productIds = [...new Set(items.map((l: any) => l?.productId).filter(Boolean).map(String))];
    const ctx = await this.loadCostContext(productIds);

    let revenue = 0n;
    let productCost = 0n;
    let costedLineRevenue = 0n;
    let totalLineRevenue = 0n;
    let uncostedOrders = 0;
    let costedOrdersRevenue = 0n;
    let anyCostedOrder = false;
    const perProductMap = new Map<string, any>();

    for (const order of sold) {
      revenue += big(order.totalMinor ?? 0);
      const lines = itemsByOrder.get(String(order.id)) ?? [];
      const placedAt = this.effectiveDate(order);
      let orderHasCosted = false;
      for (const line of lines) {
        const lineRevenue = big(line.totalMinor ?? 0);
        totalLineRevenue += lineRevenue;
        const unit = this.pickUnitCost(ctx, line, placedAt);
        const qty = Number(line.quantity ?? 0) || 0;
        const lineCost: bigint | null = unit == null ? null : unit * BigInt(qty);
        if (lineCost != null) {
          orderHasCosted = true;
          productCost += lineCost;
          costedLineRevenue += lineRevenue;
        }
        const key = line.productId
          ? `p:${line.productId}::${line.sku ?? ""}`
          : `u:${line.name ?? ""}::${line.sku ?? ""}`;
        const agg = perProductMap.get(key) ?? {
          productId: line.productId ?? null, name: line.name ?? "", sku: line.sku ?? null,
          quantity: 0, revenue: 0n, cost: null as bigint | null,
        };
        agg.quantity += qty;
        agg.revenue += lineRevenue;
        if (lineCost != null) agg.cost = (agg.cost ?? 0n) + lineCost;
        perProductMap.set(key, agg);
      }
      if (orderHasCosted) {
        anyCostedOrder = true;
        costedOrdersRevenue += big(order.totalMinor ?? 0);
      } else {
        uncostedOrders += 1;
      }
    }

    const allPerProduct = [...perProductMap.values()].map((a: any) => ({
      productId: a.productId, name: a.name, sku: a.sku, quantity: a.quantity,
      revenueMinor: String(a.revenue),
      costMinor: a.cost != null ? String(a.cost) : null,
      marginMinor: a.cost != null ? String(a.revenue - a.cost) : null,
      _margin: a.cost != null ? a.revenue - a.cost : null as bigint | null,
    }));
    allPerProduct.sort((a: any, b: any) => {
      if (a._margin == null && b._margin == null) return String(a.name).localeCompare(String(b.name));
      if (a._margin == null) return 1; // null margins LAST
      if (b._margin == null) return -1;
      return a._margin < b._margin ? -1 : a._margin > b._margin ? 1 : 0;
    });
    const truncated = allPerProduct.length > 100;
    const perProduct = allPerProduct.slice(0, 100).map(({ _margin, ...rest }: any) => rest);

    // Gross-margin basis (documented): Σ order revenue − Σ product
    // cost over the orders that have at least one costed line —
    // uncosted orders' revenue never inflates the margin.
    const grossMargin: bigint | null = anyCostedOrder ? costedOrdersRevenue - productCost : null;
    const costCoveragePercent: number | null = totalLineRevenue > 0n
      ? Math.round((Number(costedLineRevenue) / Number(totalLineRevenue)) * 1000) / 10
      : null;

    return {
      range: { from, to },
      perProductBasis: "pre_discount_line_totals",
      totals: {
        orders: sold.length,
        revenueMinor: String(revenue),
        productCostMinor: String(productCost),
        costedRevenueMinor: String(costedLineRevenue),
        costCoveragePercent,
        grossMarginMinor: grossMargin != null ? String(grossMargin) : null,
        uncostedOrders,
      },
      perProduct,
      truncated,
      perProductTruncated: truncated,
    };
  }

  /** EC23 export style: a range/coverage header section, the
   * totals rows, then the per-product table — one CSV string. */
  async getProfitReportCsv(orgId: string, range: { from?: string; to?: string } = {}): Promise<string> {
    const report = await this.getProfitReport(orgId, range);
    const t = report.totals;
    const sections: string[] = [];
    sections.push(toCsv(
      ["section", "value"],
      [
        ["# ON7 লাভের রিপোর্ট (profit report)", ""],
        ["range_from", report.range.from],
        ["range_to", report.range.to],
        ["per_product_basis", report.perProductBasis],
        ["cost_coverage_percent", t.costCoveragePercent == null ? "" : String(t.costCoveragePercent)],
      ],
    ));
    sections.push(toCsv(
      ["metric", "value_minor"],
      [
        ["orders", t.orders],
        ["revenue_minor", t.revenueMinor],
        ["product_cost_minor", t.productCostMinor],
        ["costed_line_revenue_minor", t.costedRevenueMinor],
        ["gross_margin_minor", t.grossMarginMinor ?? ""],
        ["uncosted_orders", t.uncostedOrders],
      ],
    ));
    sections.push(toCsv(
      ["product_id", "name", "sku", "quantity", "revenue_minor", "cost_minor", "margin_minor"],
      report.perProduct.map((p: any) => [
        p.productId ?? "", p.name, p.sku ?? "", p.quantity, p.revenueMinor, p.costMinor ?? "", p.marginMinor ?? "",
      ]),
    ));
    return sections.join("\n") + "\n";
  }

  // ---------- COD board ----------

  async getCodBoard(orgId: string) {
    const shipmentTable = (this.prisma as any).courierShipment;
    const shipments: any[] = shipmentTable?.findMany
      ? ((await shipmentTable.findMany({ where: { organizationId: orgId } }).catch(() => [])) ?? [])
      : [];
    const sevenDaysAgo = new Date(Date.now() - 7 * DAY_MS);
    const transit = new Set((TRANSIT_STATUSES as readonly string[]).map(String));
    const delivered = new Set(DELIVERED_SHIPMENT_STATUSES);

    interface Agg { provider: string; inTransit: bigint; deliveredUncollected: bigint; collected7d: bigint }
    const byProvider = new Map<string, Agg>();
    const aggFor = (provider: string): Agg => {
      const agg = byProvider.get(provider) ?? { provider, inTransit: 0n, deliveredUncollected: 0n, collected7d: 0n };
      byProvider.set(provider, agg);
      return agg;
    };
    const shippedOrderIds = new Set<string>();
    for (const s of shipments) {
      shippedOrderIds.add(String(s.orderId));
      const agg = aggFor(String(s.provider ?? ""));
      const status = String(s.status ?? "");
      const uncollected = s.codCollectedMinor == null;
      if (transit.has(status) && uncollected) agg.inTransit += big(s.codAmountMinor ?? 0);
      if (delivered.has(status) && uncollected) agg.deliveredUncollected += big(s.codAmountMinor ?? 0);
      if (s.codCollectedMinor != null && s.codCollectedAt != null && new Date(s.codCollectedAt) >= sevenDaysAgo) {
        agg.collected7d += big(s.codCollectedMinor);
      }
    }

    // Unassigned COD due: COD orders with NO shipment at all,
    // EC19 due math (approved PaymentVerification sums, ONE
    // grouped query for the candidate set — the OB1 pattern).
    const orderTable = (this.prisma as any).order;
    const codOrders: any[] = orderTable?.findMany
      ? ((await orderTable.findMany({
          where: {
            organizationId: orgId, isCod: true, isPractice: false,
            status: { notIn: OPEN_DUE_EXCLUDED },
          },
        }).catch(() => [])) ?? [])
      : [];
    const candidates = codOrders.filter((o: any) => !shippedOrderIds.has(String(o.id)));
    const sums = await this.approvedSumsByOrder(orgId, candidates.map((o: any) => String(o.id)));
    let unassignedDue = 0n;
    let unassignedOrders = 0;
    for (const o of candidates) {
      const total = big(o.totalMinor ?? 0);
      const paidRaw = sums.get(String(o.id)) ?? 0n;
      const paid = paidRaw > total ? total : paidRaw;
      const due = total - paid;
      if (due > 0n) { unassignedDue += due; unassignedOrders += 1; }
    }

    const providers = [...byProvider.values()]
      .sort((a, b) => a.provider.localeCompare(b.provider))
      .map((a) => ({
        provider: a.provider,
        inTransitCodMinor: String(a.inTransit),
        deliveredUncollectedMinor: String(a.deliveredUncollected),
        collectedLast7dMinor: String(a.collected7d),
        outstandingMinor: String(a.inTransit + a.deliveredUncollected),
      }));
    const totals = [...byProvider.values()].reduce(
      (acc, a) => ({
        inTransit: acc.inTransit + a.inTransit,
        deliveredUncollected: acc.deliveredUncollected + a.deliveredUncollected,
        collected7d: acc.collected7d + a.collected7d,
      }),
      { inTransit: 0n, deliveredUncollected: 0n, collected7d: 0n },
    );
    return {
      providers,
      unassigned: { orders: unassignedOrders, dueMinor: String(unassignedDue) },
      unassignedCodDueMinor: String(unassignedDue),
      totals: {
        inTransitCodMinor: String(totals.inTransit),
        deliveredUncollectedMinor: String(totals.deliveredUncollected),
        collectedLast7dMinor: String(totals.collected7d),
        outstandingMinor: String(totals.inTransit + totals.deliveredUncollected),
      },
    };
  }
}
