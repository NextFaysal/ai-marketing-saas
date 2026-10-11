import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { RiskService } from "./risk.service";
import type { CreateManualOrderDto } from "./orders.dto";

function pubOrder(o: any) {
  return {
    ...o,
    subtotalMinor: o.subtotalMinor?.toString(), shippingMinor: o.shippingMinor?.toString(),
    discountMinor: o.discountMinor?.toString(), taxMinor: o.taxMinor?.toString(),
    totalMinor: o.totalMinor?.toString(), refundedMinor: o.refundedMinor?.toString(),
    items: o.items?.map((i: any) => ({ ...i, priceMinor: i.priceMinor?.toString(), totalMinor: i.totalMinor?.toString() })),
  };
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly risk?: RiskService,
    // Milestone 65: manual orders enter through the integrations
    // upsert (dedupe + order.created + risk all inherit).
    @Optional() private readonly integrations?: IntegrationsService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  /**
   * Record an order taken outside any store/chat (phone,
   * counter, messenger). Totals are computed server-side from
   * the item lines. The customer is keyed by phone (as the
   * upsert's source-scoped externalId) so repeat buyers
   * converge on one record; an externalRef makes re-submits
   * update instead of duplicating.
   */
  async createManual(organizationId: string, actorId: string, dto: CreateManualOrderDto) {
    if (!this.integrations) throw new BadRequestException("Manual orders are not available in this deployment");
    if (!Array.isArray(dto.items) || dto.items.length === 0) throw new BadRequestException("At least one item is required");
    const phone = String(dto.customerPhone ?? "").trim();
    if (!phone) throw new BadRequestException("customerPhone is required");
    let subtotal = 0n;
    const items = dto.items.map((item) => {
      const lineTotal = BigInt(item.unitPriceMinor) * BigInt(item.quantity);
      subtotal += lineTotal;
      return {
        name: item.name, sku: item.sku, quantity: item.quantity,
        priceMinor: BigInt(item.unitPriceMinor), totalMinor: lineTotal,
      };
    });
    const shippingMinor = BigInt(dto.shippingMinor ?? 0);
    const discountMinor = BigInt(dto.discountMinor ?? 0);
    const total = subtotal + shippingMinor - discountMinor;
    const externalId = dto.externalRef?.trim() ? dto.externalRef.trim() : `manual-${randomUUID()}`;
    const result = await this.integrations.upsertOrder(organizationId, null, {
      externalId,
      externalNumber: dto.externalRef?.trim() || undefined,
      status: dto.status ?? "processing",
      paymentMethod: dto.isCod === false ? "prepaid" : "cod",
      isCod: dto.isCod !== false,
      currency: (dto.currency ?? "BDT").toUpperCase(),
      subtotalMinor: subtotal,
      shippingMinor,
      discountMinor,
      taxMinor: 0n,
      totalMinor: total > 0n ? total : 0n,
      refundedMinor: 0n,
      placedAt: dto.placedAt ? new Date(dto.placedAt) : new Date(),
      customer: {
        externalId: phone,
        firstName: dto.customerName?.trim() || phone,
        email: dto.customerEmail,
        phone,
        address: dto.address ? { address_1: dto.address } : undefined,
      },
      items,
    }, "manual");
    const order = await (this.prisma as any).order.findFirst({
      where: { organizationId, source: "manual", externalId },
      include: { items: true, customer: true },
    });
    await this.audit?.log({
      organizationId, userId: actorId, action: "orders.manual_created",
      entityType: "Order", entityId: order?.id ?? externalId,
      metadata: { externalId, result, totalMinor: (total > 0n ? total : 0n).toString() },
    }).catch(() => undefined);
    if (!order) throw new NotFoundException("Order was recorded but could not be reloaded");
    return { ...pubOrder(order), upsertResult: result };
  }

  async list(organizationId: string, q: { status?: string; isCod?: boolean; page?: number; pageSize?: number }) {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 20));
    const where: any = {
      organizationId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.isCod !== undefined ? { isCod: q.isCod } : {}),
    };
    const [total, items] = await Promise.all([
      (this.prisma as any).order.count({ where }),
      (this.prisma as any).order.findMany({
        where, orderBy: { placedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize,
        include: { customer: true, items: true },
      }),
    ]);
    const mapped = items.map(pubOrder);
    // M50: light risk summary per row (band + score). Enrichment must
    // never break the listing — on any failure rows ship without it.
    if (this.risk) {
      try {
        const summaries = await this.risk.summariesForOrders(organizationId, items);
        for (const item of mapped) {
          const s = summaries.get(item.id);
          if (s) (item as any).risk = s;
        }
      } catch { /* risk is advisory only */ }
    }
    return { total, page, pageSize, items: mapped };
  }

  async getOne(organizationId: string, orderId: string) {
    const o = await (this.prisma as any).order.findFirst({
      where: { id: orderId, organizationId }, include: { customer: true, items: true, store: true },
    });
    if (!o) throw new NotFoundException("Order not found in this organization");
    const out: any = pubOrder(o);
    if (this.risk) {
      try { out.risk = await this.risk.forOrder(organizationId, o); } catch { /* advisory only */ }
    }
    return out;
  }

  /** M50 dedicated endpoint: the full assessment with verbatim reasons. */
  async riskForOrder(organizationId: string, orderId: string) {
    const o = await (this.prisma as any).order.findFirst({ where: { id: orderId, organizationId } });
    if (!o) throw new NotFoundException("Order not found in this organization");
    if (!this.risk) throw new NotFoundException("Risk service unavailable");
    return this.risk.forOrder(organizationId, o);
  }

  async stats(organizationId: string) {
    const grouped = await (this.prisma as any).order.groupBy({
      by: ["status"], where: { organizationId }, _count: true, _sum: { totalMinor: true },
    });
    const cod = await (this.prisma as any).order.groupBy({
      by: ["isCod"], where: { organizationId }, _count: true,
    });
    const byStatus = grouped.map((g: any) => ({
      status: g.status, count: g._count, totalMinor: (g._sum.totalMinor ?? 0n).toString(),
    }));
    const totalOrders = byStatus.reduce((s: number, g: any) => s + g.count, 0);
    const codCount = cod.find((c: any) => c.isCod)?._count ?? 0;
    // Delivered revenue = completed orders only. Cancelled/refunded money is
    // reported separately by status above, never merged into revenue.
    const delivered = byStatus.find((g: any) => g.status === "completed");
    return {
      totalOrders,
      codOrders: codCount,
      codSharePercent: totalOrders > 0 ? Math.round((codCount / totalOrders) * 10000) / 100 : 0,
      deliveredRevenueMinor: delivered?.totalMinor ?? "0",
      byStatus,
    };
  }
}
