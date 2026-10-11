import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { phoneKey, scoreRisk, classifyOutcome, RiskAssessment, OrderOutcomeInput } from "./risk-score";

export interface OrderRisk extends RiskAssessment {
  phone: string | null;
  basis: "phone-history";
}

/**
 * Milestone 50 — org-scoped risk computation. Loads ONLY the given
 * organization's rows, resolves each order's phone (customer phone ->
 * courier shipment recipient phone -> chat conversation contact
 * phone), groups by the codebase's last-10-digits phone key, and
 * scores an order against the OTHER orders sharing that phone.
 * Compute-on-read: nothing is persisted, nothing is blocked.
 */
@Injectable()
export class RiskService {
  constructor(private readonly prisma: PrismaService) {}

  private async loadOrgData(organizationId: string) {
    const [orders, shipments, conversations] = await Promise.all([
      (this.prisma as any).order.findMany({
        where: { organizationId }, orderBy: { createdAt: "asc" }, take: 5000,
        include: { customer: { select: { phone: true } } },
      }).catch(() => []),
      (this.prisma as any).courierShipment.findMany({
        where: { organizationId }, select: { orderId: true, status: true, recipientPhone: true, recipientAddress: true }, take: 5000,
      }).catch(() => []),
      (this.prisma as any).channelConversation.findMany({
        where: { organizationId }, select: { id: true, contactPhone: true }, take: 5000,
      }).catch(() => []),
    ]);
    const convPhone = new Map<string, string | null>(conversations.map((c: any) => [c.id, c.contactPhone ?? null]));
    const shipByOrder = new Map<string, any[]>();
    for (const s of shipments) {
      const list = shipByOrder.get(s.orderId) ?? [];
      list.push(s); shipByOrder.set(s.orderId, list);
    }
    const phoneOf = (o: any): string | null =>
      o.customer?.phone ?? shipByOrder.get(o.id)?.[0]?.recipientPhone ?? (o.conversationId ? convPhone.get(o.conversationId) : null) ?? null;
    const addressOf = (o: any): string | null =>
      o.address ?? shipByOrder.get(o.id)?.[0]?.recipientAddress ?? null;
    return { orders, shipByOrder, phoneOf, addressOf };
  }

  private assess(orders: any[], shipByOrder: Map<string, any[]>, phoneOf: (o: any) => string | null, addressOf: (o: any) => string | null, target: any): OrderRisk {
    const phone = phoneOf(target);
    const key = phoneKey(phone);
    if (!key) {
      return {
        band: "unknown", score: null, decided: 0, negativeRate: null,
        history: { total: 0, delivered: 0, returned: 0, cancelledOrFailed: 0, refunded: 0, open: 0, codOrders: 0 },
        reasons: ["এই অর্ডারে কোনো ফোন নম্বর পাওয়া যায়নি — ফোনের ইতিহাস ছাড়া ঝুঁকি বলা যাচ্ছে না।"],
        suggestion: null, phone: null, basis: "phone-history",
      };
    }
    const priors = orders.filter((o: any) => o.id !== target.id && phoneKey(phoneOf(o)) === key);
    const toInput = (o: any): OrderOutcomeInput => ({
      status: o.status, isCod: Boolean(o.isCod),
      shipmentStatuses: (shipByOrder.get(o.id) ?? []).map((s: any) => s.status),
    });
    const targetAddress = String(addressOf(target) ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    const sameAddressAsDelivered = targetAddress.length >= 8 && priors.some((o: any) => {
      const a = String(addressOf(o) ?? "").trim().toLowerCase().replace(/\s+/g, " ");
      if (!a || a !== targetAddress) return false;
      return classifyOutcome(toInput(o)) === "delivered";
    });
    const result = scoreRisk(priors.map(toInput), { targetIsCod: Boolean(target.isCod), sameAddressAsDelivered });
    return { ...result, phone, basis: "phone-history" };
  }

  async forOrder(organizationId: string, order: any): Promise<OrderRisk> {
    const { orders, shipByOrder, phoneOf, addressOf } = await this.loadOrgData(organizationId);
    const target = orders.find((o: any) => o.id === order.id) ?? order;
    return this.assess(orders, shipByOrder, phoneOf, addressOf, target);
  }

  /** Light summaries for a page of orders (band + score only). */
  async summariesForOrders(organizationId: string, pageOrders: any[]): Promise<Map<string, { band: string; score: number | null }>> {
    const out = new Map<string, { band: string; score: number | null }>();
    if (!pageOrders.length) return out;
    const { orders, shipByOrder, phoneOf, addressOf } = await this.loadOrgData(organizationId);
    for (const o of pageOrders) {
      const target = orders.find((x: any) => x.id === o.id) ?? o;
      const r = this.assess(orders, shipByOrder, phoneOf, addressOf, target);
      out.set(o.id, { band: r.band, score: r.score });
    }
    return out;
  }

  /** Customer 360: the customer's own orders + any other orders in the
   * org sharing the customer's phone, assessed as one history. */
  async forCustomer(organizationId: string, customer: any): Promise<OrderRisk> {
    const { orders, shipByOrder, phoneOf, addressOf } = await this.loadOrgData(organizationId);
    const key = phoneKey(customer?.phone);
    const own = orders.filter((o: any) => o.customerId === customer.id);
    const byPhone = key ? orders.filter((o: any) => phoneKey(phoneOf(o)) === key) : [];
    const seen = new Set<string>();
    const historyOrders = [...own, ...byPhone].filter((o: any) => (seen.has(o.id) ? false : (seen.add(o.id), true)));
    const toInput = (o: any): OrderOutcomeInput => ({
      status: o.status, isCod: Boolean(o.isCod),
      shipmentStatuses: (shipByOrder.get(o.id) ?? []).map((s: any) => s.status),
    });
    // A customer is assessed on their whole history (no target order).
    const result = scoreRisk(historyOrders.map(toInput), {});
    // scoreRisk phrases reasons as "আগের অর্ডার" (prior orders); for a
    // customer profile that wording is still accurate per-order-set,
    // except the empty case which it already phrases neutrally.
    return { ...result, phone: customer?.phone ?? null, basis: "phone-history" };
  }
}
