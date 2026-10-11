import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { RiskService } from "../orders/risk.service";

const customerName = (c: any) => [c.firstName, c.lastName].filter(Boolean).join(" ") || c.name || null;

/**
 * Customer 360: one record per real person. Lists exclude merged
 * records; detail aggregates orders, conversations and shipments from
 * the real tables; merge moves relationships to the surviving record
 * and keeps the source as a marked, hidden shell (never deleted).
 */
@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, @Optional() private readonly risk?: RiskService) {}

  async list(organizationId: string, q?: string) {
    const rows = await (this.prisma as any).customer.findMany({
      where: { organizationId, mergedIntoId: null }, orderBy: { createdAt: "desc" }, take: 500,
    });
    const needle = q?.trim().toLowerCase();
    const filtered = needle
      ? rows.filter((c: any) => [customerName(c), c.phone, c.email].filter(Boolean).some((v: string) => v.toLowerCase().includes(needle)))
      : rows;
    const withStats = await Promise.all(filtered.slice(0, 100).map(async (c: any) => {
      const orders = await (this.prisma as any).order.findMany({
        where: { organizationId, customerId: c.id, status: { not: "cancelled" } }, take: 200,
      });
      return {
        id: c.id, name: customerName(c), firstName: c.firstName, lastName: c.lastName,
        phone: c.phone, email: c.email, source: c.source, createdAt: c.createdAt,
        orderCount: orders.length,
        totalSpentMinor: String(orders.reduce((s: bigint, o: any) => s + BigInt(o.totalMinor), 0n)),
      };
    }));
    return withStats;
  }

  async detail(organizationId: string, customerId: string) {
    const customer = await (this.prisma as any).customer.findFirst({ where: { id: customerId, organizationId } });
    if (!customer) throw new NotFoundException("Customer not found in this organization");
    const orders = await (this.prisma as any).order.findMany({
      where: { organizationId, customerId }, orderBy: { createdAt: "desc" }, take: 50,
    });
    const conversations = await (this.prisma as any).channelConversation.findMany({
      where: { organizationId, customerId }, orderBy: { lastMessageAt: "desc" }, take: 20,
    }).catch(() => []);
    const shipments = orders.length ? await (this.prisma as any).courierShipment.findMany({
      where: { organizationId, orderId: { in: orders.map((o: any) => o.id) } }, take: 20,
    }).catch(() => []) : [];
    const lead = customer.id ? await (this.prisma as any).lead.findFirst({
      where: { organizationId, customerId },
    }).catch(() => null) : null;
    const activeOrders = orders.filter((o: any) => o.status !== "cancelled");
    // M50: return-risk summary for this customer (own org rows only).
    let risk: any = null;
    if (this.risk) {
      try { risk = await this.risk.forCustomer(organizationId, customer); } catch { risk = null; }
    }
    return {
      risk,
      customer: { ...customer, name: customerName(customer) },
      orders: orders.map((o: any) => ({
        ...o,
        totalMinor: String(o.totalMinor), subtotalMinor: String(o.subtotalMinor ?? o.totalMinor),
        shippingMinor: String(o.shippingMinor ?? 0), discountMinor: String(o.discountMinor ?? 0),
        taxMinor: String(o.taxMinor ?? 0), refundedMinor: String(o.refundedMinor ?? 0),
      })),
      conversations: conversations.map((c: any) => ({
        id: c.id, channel: c.channel, status: c.status, contactName: c.contactName,
        lastMessagePreview: c.lastMessagePreview, lastMessageAt: c.lastMessageAt, unreadCount: c.unreadCount,
      })),
      shipments: shipments.map((s: any) => ({ ...s, codAmountMinor: String(s.codAmountMinor) })),
      lead: lead ? { id: lead.id, stage: lead.stage, source: lead.source } : null,
      lifetime: {
        orderCount: activeOrders.length,
        totalSpentMinor: String(activeOrders.reduce((s: bigint, o: any) => s + BigInt(o.totalMinor), 0n)),
        currency: activeOrders[0]?.currency ?? orders[0]?.currency ?? "BDT",
      },
    };
  }

  async merge(organizationId: string, actorId: string, dto: { sourceId: string; targetId: string }) {
    if (dto.sourceId === dto.targetId) throw new BadRequestException("Source and target must differ");
    const source = await (this.prisma as any).customer.findFirst({ where: { id: dto.sourceId, organizationId } });
    const target = await (this.prisma as any).customer.findFirst({ where: { id: dto.targetId, organizationId } });
    if (!source || !target) throw new NotFoundException("Customer not found in this organization");
    if (source.mergedIntoId) throw new BadRequestException("Source customer was already merged");
    if (target.mergedIntoId) throw new BadRequestException("Target customer was itself merged into another record");
    const orders = await (this.prisma as any).order.findMany({ where: { organizationId, customerId: source.id }, take: 1000 });
    for (const o of orders) {
      await (this.prisma as any).order.update({ where: { id: o.id }, data: { customerId: target.id } });
    }
    const conversations = await (this.prisma as any).channelConversation.findMany({
      where: { organizationId, customerId: source.id }, take: 200,
    }).catch(() => []);
    for (const c of conversations) {
      await (this.prisma as any).channelConversation.update({ where: { id: c.id }, data: { customerId: target.id } });
    }
    // Fill gaps on the survivor from the source (never overwrite).
    const fill: any = {};
    if (!target.phone && source.phone) fill.phone = source.phone;
    if (!target.email && source.email) fill.email = source.email;
    if (!target.firstName && source.firstName) fill.firstName = source.firstName;
    if (!target.lastName && source.lastName) fill.lastName = source.lastName;
    if (Object.keys(fill).length) await (this.prisma as any).customer.update({ where: { id: target.id }, data: fill });
    await (this.prisma as any).customer.update({ where: { id: source.id }, data: { mergedIntoId: target.id } });
    await this.audit.log({
      organizationId, userId: actorId, action: "customer.merged", entityType: "Customer", entityId: target.id,
      metadata: { sourceId: source.id, ordersMoved: orders.length, conversationsMoved: conversations.length },
    });
    return this.detail(organizationId, target.id);
  }
}
