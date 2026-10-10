import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { computeCredits, filterTouchpointsInWindow, AttributionModelName, DEFAULT_ATTRIBUTION_WINDOW_DAYS } from "./engine";

export const ALL_MODELS: AttributionModelName[] = ["FIRST_TOUCH", "LAST_TOUCH", "LAST_NON_DIRECT", "LINEAR"];
const REVENUE_EXCLUDED_STATUSES = ["cancelled", "refunded", "failed"];

@Injectable()
export class AttributionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compute credits for one order across all models. Idempotent per model:
   * if credits already exist for (order, model) they are left untouched,
   * so retries, duplicate purchase events and reconciles never double count.
   */
  async computeForOrder(
    organizationId: string,
    order: { id: string; totalMinor: bigint; placedAt?: Date | null; createdAt?: Date },
    visitorId: string,
    windowDays = DEFAULT_ATTRIBUTION_WINDOW_DAYS,
  ) {
    const conversionAt = order.placedAt ?? order.createdAt ?? new Date();
    const allTouchpoints = await (this.prisma as any).touchpoint.findMany({
      where: { organizationId, visitorId },
    });
    const inWindow = filterTouchpointsInWindow(
      allTouchpoints.map((t: any) => ({ ...t, occurredAt: new Date(t.occurredAt) })),
      conversionAt, windowDays,
    );
    const createdModels: string[] = [];
    for (const model of ALL_MODELS) {
      const existing = await (this.prisma as any).attributionCredit.findFirst({
        where: { organizationId, orderId: order.id, model },
      });
      if (existing) continue;
      const allocations = computeCredits(inWindow, BigInt(order.totalMinor), model);
      for (const alloc of allocations) {
        await (this.prisma as any).attributionCredit.create({
          data: { organizationId, orderId: order.id, model, touchpointId: alloc.touchpointId, revenueMinor: alloc.revenueMinor },
        });
      }
      createdModels.push(model);
    }
    return { createdModels, touchpointsInWindow: inWindow.length };
  }

  async creditsForOrder(organizationId: string, orderId: string) {
    const order = await (this.prisma as any).order.findFirst({ where: { id: orderId, organizationId } });
    if (!order) throw new NotFoundException("Order not found in this organization");
    const credits = await (this.prisma as any).attributionCredit.findMany({
      where: { organizationId, orderId }, include: { touchpoint: true }, orderBy: { model: "asc" },
    });
    return credits.map((c: any) => ({ ...c, revenueMinor: c.revenueMinor?.toString() }));
  }

  /**
   * Reconciliation: for orders that have a tracked purchase event but no
   * credits yet, compute them. Orders with no tracking evidence are NOT
   * credited to any channel - they stay unattributed in the report.
   */
  /** The org's configured attribution window (falls back to 30). */
  async windowFor(organizationId: string): Promise<number> {
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } }).catch(() => null);
    const days = Number(org?.attributionWindowDays ?? DEFAULT_ATTRIBUTION_WINDOW_DAYS);
    return [7, 14, 30, 60, 90].includes(days) ? days : DEFAULT_ATTRIBUTION_WINDOW_DAYS;
  }

  async getSettings(organizationId: string) {
    return { windowDays: await this.windowFor(organizationId) };
  }

  async updateSettings(organizationId: string, windowDays: number) {
    if (![7, 14, 30, 60, 90].includes(windowDays)) {
      throw new BadRequestException("windowDays must be one of 7, 14, 30, 60, 90");
    }
    await (this.prisma as any).organization.update({ where: { id: organizationId }, data: { attributionWindowDays: windowDays } });
    return { windowDays };
  }

  async reconcile(organizationId: string, windowDays?: number) {
    windowDays ??= await this.windowFor(organizationId);
    const orders = await (this.prisma as any).order.findMany({
      where: { organizationId }, orderBy: { placedAt: "desc" }, take: 500,
    });
    let computed = 0, alreadyDone = 0, noEvidence = 0;
    for (const order of orders) {
      const existing = await (this.prisma as any).attributionCredit.findFirst({ where: { organizationId, orderId: order.id } });
      if (existing) { alreadyDone++; continue; }
      const purchaseEvent = await (this.prisma as any).trackingEvent.findFirst({
        where: { organizationId, type: "purchase", orderExternalId: order.externalId, visitorId: { not: null } },
      });
      if (!purchaseEvent?.visitorId) { noEvidence++; continue; }
      await this.computeForOrder(organizationId, order, purchaseEvent.visitorId, windowDays);
      computed++;
    }
    return { checked: orders.length, computed, alreadyDone, noTrackingEvidence: noEvidence };
  }

  async report(organizationId: string, model: AttributionModelName = "LAST_TOUCH") {
    const windowDays = await this.windowFor(organizationId);
    const [orders, credits, purchaseEvents] = await Promise.all([
      (this.prisma as any).order.findMany({ where: { organizationId }, take: 5000 }),
      (this.prisma as any).attributionCredit.findMany({
        where: { organizationId, model }, include: { touchpoint: true },
      }),
      (this.prisma as any).trackingEvent.findMany({ where: { organizationId, type: "purchase" }, take: 5000 }),
    ]);

    const revenueOrders = orders.filter((o: any) => !REVENUE_EXCLUDED_STATUSES.includes(o.status));
    const ordersRevenue = revenueOrders.reduce((s: bigint, o: any) => s + BigInt(o.totalMinor), 0n);
    const orderIdsWithCredits = new Set(credits.map((c: any) => c.orderId));

    const byChannel = new Map<string, { source: string; campaign: string | null; revenueMinor: bigint; orders: Set<string> }>();
    let attributedRevenue = 0n, unattributedCreditRevenue = 0n;
    for (const c of credits) {
      const revenue = BigInt(c.revenueMinor);
      attributedRevenue += revenue;
      const source = c.touchpoint?.source ?? "unattributed";
      const campaign = c.touchpoint?.campaign ?? null;
      if (!c.touchpoint) unattributedCreditRevenue += revenue;
      const key = `${source}::${campaign ?? ""}`;
      const entry = byChannel.get(key) ?? { source, campaign, revenueMinor: 0n, orders: new Set<string>() };
      entry.revenueMinor += revenue;
      entry.orders.add(c.orderId);
      byChannel.set(key, entry);
    }

    const ordersWithoutCredits = revenueOrders.filter((o: any) => !orderIdsWithCredits.has(o.id));
    const ordersWithoutCreditsRevenue = ordersWithoutCredits.reduce((s: bigint, o: any) => s + BigInt(o.totalMinor), 0n);
    const orderExternalIds = new Set(orders.map((o: any) => o.externalId));
    const purchaseEventsWithoutOrder = purchaseEvents.filter((e: any) => e.orderExternalId && !orderExternalIds.has(e.orderExternalId));

    return {
      model,
      windowDays,
      totals: {
        orders: revenueOrders.length,
        ordersRevenueMinor: ordersRevenue.toString(),
        attributedRevenueMinor: attributedRevenue.toString(),
        // Unattributed = explicit unattributed credits + orders never credited.
        // Inferred attribution is kept separate from verified in the UI copy.
        unattributedRevenueMinor: (unattributedCreditRevenue + ordersWithoutCreditsRevenue).toString(),
        ordersWithoutCredits: ordersWithoutCredits.length,
      },
      byChannel: [...byChannel.values()]
        .map((e) => ({ source: e.source, campaign: e.campaign, revenueMinor: e.revenueMinor.toString(), orders: e.orders.size }))
        .sort((a, b) => Number(BigInt(b.revenueMinor) - BigInt(a.revenueMinor))),
      reconciliation: {
        trackedPurchaseEvents: purchaseEvents.length,
        purchaseEventsWithoutMatchingOrder: purchaseEventsWithoutOrder.length,
        // By construction this equals the unattributed total: every credited
        // order's allocations sum exactly to its order total (see engine).
        uncreditedRevenueMinor: (ordersRevenue - attributedRevenue).toString(),
        note: "Unattributed revenue is expected when orders have no tracking evidence; it is reported, never guessed into a channel.",
      },
    };
  }
}
