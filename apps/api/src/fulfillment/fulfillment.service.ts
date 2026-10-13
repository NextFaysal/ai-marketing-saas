import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { OrderPushService } from "../commerce/order-push.service";
import { dhakaDayStartUtc } from "../crm/lead-followups";

export interface FulfillmentItemLine { orderItemId: string; quantity: number; packed?: boolean }

export const FULFILLMENT_STATUSES = ["pending", "packed", "handed_over", "in_transit", "delivered", "returned", "cancelled"] as const;

/**
 * EC9 — fulfilments of (parts of) orders.
 *
 * Remaining quantities are computed on read: ordered quantity per
 * OrderItem minus the quantities on all non-cancelled fulfilments
 * of the order. Creating a fulfilment for a courier shipment with
 * a tracking code enqueues the EC5 create_fulfillment store push
 * exactly once (storePushEnqueuedAt marker), failure-isolated —
 * a store problem never blocks dispatch work.
 */
@Injectable()
export class FulfillmentService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly orderPush?: OrderPushService,
  ) {}

  async loadOrder(organizationId: string, orderId: string) {
    const order = await (this.prisma as any).order.findFirst({
      where: { id: orderId, organizationId }, include: { items: true },
    });
    if (!order) throw new NotFoundException("Order not found in this organization");
    return order;
  }

  /** orderItemId -> remaining (ordered - already fulfilled) qty. */
  async remainingFor(organizationId: string, order: any): Promise<Map<string, number>> {
    const fulfilled: any[] = ((await (this.prisma as any).fulfillment.findMany({ where: { organizationId, orderId: order.id } }).catch(() => [])) ?? [])
      .filter((f: any) => f.status !== "cancelled");
    const used = new Map<string, number>();
    for (const f of fulfilled) {
      for (const line of (f.items ?? []) as FulfillmentItemLine[]) {
        used.set(line.orderItemId, (used.get(line.orderItemId) ?? 0) + (line.quantity ?? 0));
      }
    }
    const remaining = new Map<string, number>();
    for (const item of order.items ?? []) {
      remaining.set(item.id, Math.max(0, (item.quantity ?? 0) - (used.get(item.id) ?? 0)));
    }
    return remaining;
  }

  async withRemaining(organizationId: string, fulfillment: any) {
    const order = await this.loadOrder(organizationId, fulfillment.orderId).catch(() => null);
    return { ...fulfillment, orderNumber: order?.externalNumber ?? null, remaining: undefined, orderItems: order?.items ?? [] };
  }

  async create(organizationId: string, actorId: string, orderId: string, dto: {
    items?: FulfillmentItemLine[];
    courierShipmentId?: string;
  }) {
    const order = await this.loadOrder(organizationId, orderId);
    let shipment: any = null;
    if (dto.courierShipmentId) {
      shipment = await (this.prisma as any).courierShipment.findFirst({
        where: { id: dto.courierShipmentId, organizationId, orderId: order.id },
      });
      if (!shipment) throw new NotFoundException("Courier shipment not found for this order");
    }
    const remaining = await this.remainingFor(organizationId, order);
    let lines: FulfillmentItemLine[];
    if (dto.items && dto.items.length > 0) {
      lines = dto.items.map((l) => ({ orderItemId: l.orderItemId, quantity: Math.floor(l.quantity), packed: false }));
    } else {
      lines = [...remaining.entries()]
        .filter(([, qty]) => qty > 0)
        .map(([orderItemId, quantity]) => ({ orderItemId, quantity, packed: false }));
    }
    if (!lines.length) throw new BadRequestException("এই অর্ডারের সব আইটেম আগেই ফুলফিল করা হয়েছে");
    for (const line of lines) {
      const rem = remaining.get(line.orderItemId);
      if (rem === undefined) throw new BadRequestException("অর্ডারে এই আইটেমটি নেই");
      if (!(line.quantity > 0) || line.quantity > rem) {
        throw new BadRequestException(`আইটেমের পরিমাণ বাকি পরিমাণের (${rem}) বেশি হতে পারবে না`);
      }
    }
    const fulfillment = await (this.prisma as any).fulfillment.create({
      data: {
        organizationId, orderId: order.id, status: "pending",
        courierShipmentId: shipment?.id ?? null,
        courierProvider: shipment?.provider ?? null,
        trackingCode: shipment?.trackingCode ?? null,
        items: lines, createdById: actorId,
      },
    });
    await this.audit?.log({
      organizationId, userId: actorId, action: "fulfillment.created",
      entityType: "Fulfillment", entityId: fulfillment.id,
      metadata: { orderId: order.id, shipmentId: shipment?.id ?? null },
    }).catch(() => undefined);
    // EC5 hook: a fulfilment that already has a courier tracking
    // code pushes the fulfilment to the store — once, isolated.
    if (shipment?.trackingCode && this.orderPush) {
      try {
        const res = await this.orderPush.enqueueFulfillment(organizationId, order.id, {
          trackingCode: shipment.trackingCode, courierProvider: shipment.provider, fulfillmentId: fulfillment.id,
        });
        if (res.enqueued > 0) {
          await (this.prisma as any).fulfillment.update({
            where: { id: fulfillment.id }, data: { storePushEnqueuedAt: new Date() },
          }).catch(() => undefined);
          fulfillment.storePushEnqueuedAt = new Date();
        }
      } catch { /* failure-isolated: dispatch work never breaks */ }
    }
    return fulfillment;
  }

  async listForOrder(organizationId: string, orderId: string) {
    const order = await this.loadOrder(organizationId, orderId);
    const rows: any[] = ((await (this.prisma as any).fulfillment.findMany({ where: { organizationId, orderId } })) ?? [])
      .sort((a: any, b: any) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime());
    const remaining = await this.remainingFor(organizationId, order);
    return {
      orderId, orderNumber: order.externalNumber ?? null,
      items: (order.items ?? []).map((i: any) => ({ ...i, priceMinor: i.priceMinor?.toString(), totalMinor: i.totalMinor?.toString(), remaining: remaining.get(i.id) ?? 0 })),
      fulfillments: rows,
    };
  }

  async update(organizationId: string, actorId: string, fulfillmentId: string, dto: {
    status?: string;
    packed?: { orderItemId: string; packed: boolean }[];
    trackingCode?: string;
    courierProvider?: string;
  }) {
    const f = await (this.prisma as any).fulfillment.findFirst({ where: { id: fulfillmentId, organizationId } });
    if (!f) throw new NotFoundException("Fulfillment not found in this organization");
    const data: Record<string, any> = {};
    if (dto.status !== undefined) {
      if (!(FULFILLMENT_STATUSES as readonly string[]).includes(dto.status)) {
        throw new BadRequestException(`status অবশ্যই এর একটি হতে হবে: ${FULFILLMENT_STATUSES.join(", ")}`);
      }
      data.status = dto.status;
    }
    if (dto.packed && dto.packed.length > 0) {
      const packedMap = new Map(dto.packed.map((p) => [p.orderItemId, p.packed === true]));
      data.items = ((f.items ?? []) as FulfillmentItemLine[]).map((l) =>
        packedMap.has(l.orderItemId) ? { ...l, packed: packedMap.get(l.orderItemId) } : l,
      );
      // All items packed -> the fulfilment itself becomes "packed"
      // (unless staff set an explicit further-along status).
      if (dto.status === undefined && (data.items as FulfillmentItemLine[]).every((l) => l.packed)) {
        data.status = "packed";
      }
    }
    if (dto.trackingCode !== undefined) data.trackingCode = dto.trackingCode || null;
    if (dto.courierProvider !== undefined) data.courierProvider = dto.courierProvider || null;
    const updated = await (this.prisma as any).fulfillment.update({ where: { id: f.id }, data });
    await this.audit?.log({
      organizationId, userId: actorId, action: "fulfillment.updated",
      entityType: "Fulfillment", entityId: f.id, metadata: { status: data.status ?? null },
    }).catch(() => undefined);
    // Late tracking assignment also earns the store push, once.
    if (updated.trackingCode && !f.storePushEnqueuedAt && this.orderPush) {
      try {
        const res = await this.orderPush.enqueueFulfillment(organizationId, f.orderId, {
          trackingCode: updated.trackingCode, courierProvider: updated.courierProvider ?? undefined, fulfillmentId: f.id,
        });
        if (res.enqueued > 0) {
          await (this.prisma as any).fulfillment.update({ where: { id: f.id }, data: { storePushEnqueuedAt: new Date() } }).catch(() => undefined);
        }
      } catch { /* isolated */ }
    }
    return updated;
  }

  /** Dispatch board: today's (Dhaka) fulfilments + anything still
   *  awaiting dispatch (pending/packed), grouped read-side by the
   *  web page; the API returns the flat org-scoped list + counts. */
  async board(organizationId: string, now: Date = new Date()) {
    const dayStart = dhakaDayStartUtc(now);
    const all: any[] = ((await (this.prisma as any).fulfillment.findMany({ where: { organizationId } }).catch(() => [])) ?? []);
    const rows = all.filter((f: any) => {
      const createdToday = f.createdAt && new Date(f.createdAt).getTime() >= dayStart.getTime();
      return createdToday || f.status === "pending" || f.status === "packed";
    }).sort((a: any, b: any) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime());
    const enriched: any[] = [];
    for (const f of rows) {
      const order = await (this.prisma as any).order.findFirst({ where: { id: f.orderId, organizationId }, include: { items: true } }).catch(() => null);
      enriched.push({
        ...f,
        orderNumber: order?.externalNumber ?? null,
        orderStatus: order?.status ?? null,
        itemCount: ((f.items ?? []) as FulfillmentItemLine[]).reduce((s, l) => s + (l.quantity ?? 0), 0),
        lines: ((f.items ?? []) as FulfillmentItemLine[]).map((l) => {
          const oi = (order?.items ?? []).find((i: any) => i.id === l.orderItemId);
          return { ...l, name: oi?.name ?? l.orderItemId };
        }),
      });
    }
    return { date: dayStart.toISOString(), total: enriched.length, fulfillments: enriched };
  }

  /** Printable handover manifest for one courier + Dhaka day. */
  async manifest(organizationId: string, courierProvider: string, dateStr?: string) {
    if (!courierProvider) throw new BadRequestException("courier (provider) দরকার");
    const day = dateStr ? new Date(`${dateStr}T00:00:00Z`) : new Date();
    const start = dhakaDayStartUtc(day);
    const end = new Date(start.getTime() + 24 * 3600 * 1000);
    const all: any[] = ((await (this.prisma as any).fulfillment.findMany({ where: { organizationId } }).catch(() => [])) ?? []);
    const rows: any[] = [];
    for (const f of all) {
      if (f.courierProvider !== courierProvider) continue;
      if (!["packed", "handed_over", "in_transit", "delivered"].includes(f.status)) continue;
      const created = f.createdAt ? new Date(f.createdAt).getTime() : 0;
      if (created < start.getTime() || created >= end.getTime()) continue;
      const order = await (this.prisma as any).order.findFirst({ where: { id: f.orderId, organizationId } }).catch(() => null);
      rows.push({
        fulfillmentId: f.id,
        trackingCode: f.trackingCode ?? null,
        orderNumber: order?.externalNumber ?? null,
        itemCount: ((f.items ?? []) as FulfillmentItemLine[]).reduce((s: number, l: any) => s + (l.quantity ?? 0), 0),
        status: f.status,
      });
    }
    return {
      courier: courierProvider,
      date: start.toISOString().slice(0, 10),
      totalParcels: rows.length,
      totalItems: rows.reduce((s, r) => s + r.itemCount, 0),
      rows,
    };
  }
}
