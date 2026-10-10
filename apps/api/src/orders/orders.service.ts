import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

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
  constructor(private readonly prisma: PrismaService) {}

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
    return { total, page, pageSize, items: items.map(pubOrder) };
  }

  async getOne(organizationId: string, orderId: string) {
    const o = await (this.prisma as any).order.findFirst({
      where: { id: orderId, organizationId }, include: { customer: true, items: true, store: true },
    });
    if (!o) throw new NotFoundException("Order not found in this organization");
    return pubOrder(o);
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
