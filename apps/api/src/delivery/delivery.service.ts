import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { OrdersService } from "../orders/orders.service";
import { dhakaDayStartUtc } from "../crm/lead-followups";
import { badRequest, notFound } from "../i18n/api-exception";

/**
 * EC22 — Delivery Ops: the org's OWN riders (staff-operated
 * records only; no rider login/app in v1).
 *
 * Assignment lifecycle: assigned → picked_up → delivered, with
 * `returned` reachable from either open state. At most ONE open
 * (assigned | picked_up) assignment per order — enforced here,
 * since a plain unique cannot express it.
 *
 * Marking `delivered` drives the order to "completed" through
 * OrdersService.updateOrder — the one real order-transition path
 * (transition validation, inventory, events, store pushes all
 * live there). The order transition runs FIRST: if it throws, the
 * error propagates and the assignment is left UNCHANGED, so the
 * two records never disagree.
 */

const DAY_MS = 24 * 3600 * 1000;

const TRANSITIONS: Record<string, string[]> = {
  assigned: ["picked_up", "returned"],
  picked_up: ["delivered", "returned"],
  delivered: [],
  returned: [],
};

@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly orders: OrdersService,
  ) {}

  // ---------------- Riders ----------------

  async listRiders(organizationId: string) {
    return (this.prisma as any).rider.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
    });
  }

  async createRider(organizationId: string, actorId: string, dto: { name?: string; phone?: string }) {
    const name = dto.name?.trim();
    const phone = dto.phone?.trim();
    if (!name) throw badRequest("delivery.aRiderNameIsRequired");
    if (!phone) throw badRequest("delivery.aRiderPhoneNumberIsRequired");
    const rider = await (this.prisma as any).rider.create({
      data: { organizationId, name, phone, active: true },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "rider.created", entityType: "Rider",
      entityId: rider.id, metadata: { name },
    });
    return rider;
  }

  private async riderOr404(organizationId: string, riderId: string) {
    const rider = await (this.prisma as any).rider.findFirst({
      where: { id: riderId, organizationId },
    });
    if (!rider) throw notFound("delivery.theRiderWasNotFound");
    return rider;
  }

  async updateRider(organizationId: string, actorId: string, riderId: string, dto: { name?: string; phone?: string; active?: boolean }) {
    const existing = await this.riderOr404(organizationId, riderId);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw badRequest("delivery.theRiderNameCannotBeEmpty");
      data.name = name;
    }
    if (dto.phone !== undefined) {
      const phone = dto.phone.trim();
      if (!phone) throw badRequest("delivery.theRiderPhoneNumberCannotBe");
      data.phone = phone;
    }
    if (dto.active !== undefined) data.active = Boolean(dto.active);
    const rider = await (this.prisma as any).rider.update({ where: { id: existing.id }, data });
    await this.audit.log({
      organizationId, userId: actorId, action: "rider.updated", entityType: "Rider",
      entityId: rider.id, metadata: { fields: Object.keys(data) },
    });
    return rider;
  }

  /** Delete is a soft deactivation — assignment history keeps its rider. */
  async removeRider(organizationId: string, actorId: string, riderId: string) {
    const existing = await this.riderOr404(organizationId, riderId);
    const rider = await (this.prisma as any).rider.update({
      where: { id: existing.id }, data: { active: false },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "rider.deactivated", entityType: "Rider",
      entityId: rider.id, metadata: { name: existing.name },
    });
    return rider;
  }

  // ---------------- Assignments ----------------

  async createAssignment(organizationId: string, actorId: string, dto: { orderId: string; riderId: string; note?: string }) {
    const order = await (this.prisma as any).order.findFirst({
      where: { id: dto.orderId, organizationId },
    });
    if (!order) throw notFound("delivery.orderNotFoundInThisOrganization");
    const rider = await this.riderOr404(organizationId, dto.riderId);
    if (!rider.active) throw badRequest("delivery.thisRiderIsNotActiveActivate");

    const existing = await (this.prisma as any).deliveryAssignment.findMany({
      where: { organizationId, orderId: order.id },
    });
    if ((existing as any[]).some((a) => a.status === "assigned" || a.status === "picked_up")) {
      throw badRequest("delivery.aRiderIsAlreadyActiveOn");
    }

    const assignment = await (this.prisma as any).deliveryAssignment.create({
      data: {
        organizationId, orderId: order.id, riderId: rider.id,
        note: dto.note?.trim() || null,
        status: "assigned", assignedById: actorId,
      },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "rider.assigned", entityType: "DeliveryAssignment",
      entityId: assignment.id, metadata: { orderId: order.id, riderId: rider.id },
    });
    return assignment;
  }

  async transition(organizationId: string, actorId: string, assignmentId: string, dto: { status: string }) {
    const assignment = await (this.prisma as any).deliveryAssignment.findFirst({
      where: { id: assignmentId, organizationId },
    });
    if (!assignment) throw notFound("delivery.theDeliveryAssignmentWasNotFound");

    const from: string = assignment.status;
    const to = dto.status;
    const allowed = TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(
        allowed.length > 0
          ? `“${from}” অবস্থা থেকে শুধু ${allowed.map((s) => `“${s}”`).join(", ")} অবস্থায় যাওয়া যায় — “${to}” যাওয়া যায় না`
          : `এই অ্যাসাইনমেন্টটি ইতিমধ্যে “${from}” অবস্থায় শেষ হয়েছে — আর অবস্থা বদলানো যায় না`,
      );
    }

    const data: Record<string, unknown> = { status: to };
    if (to === "delivered") {
      // Order FIRST (see class comment): OrdersService.updateOrder
      // is the real transition path; a failure there must leave
      // this assignment untouched.
      await this.orders.updateOrder(organizationId, actorId, assignment.orderId, { status: "completed" });
      data.deliveredAt = new Date();
    } else if (to === "picked_up") {
      data.pickedUpAt = new Date();
    } else if (to === "returned") {
      data.returnedAt = new Date();
      // NOTE: `returned` deliberately does NOT touch the order in
      // v1 — the parcel coming back does not by itself decide the
      // order's status (staff may re-deliver, cancel, or refund),
      // so no order transition is invented here.
    }

    const updated = await (this.prisma as any).deliveryAssignment.update({
      where: { id: assignment.id }, data,
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "rider.assignment_transition", entityType: "DeliveryAssignment",
      entityId: assignment.id,
      metadata: { from, to, orderId: assignment.orderId, riderId: assignment.riderId },
    });
    return updated;
  }

  async listAssignments(organizationId: string, filters: { riderId?: string; orderId?: string; date?: string } = {}) {
    const where: Record<string, unknown> = { organizationId };
    if (filters.riderId) where.riderId = filters.riderId;
    if (filters.orderId) where.orderId = filters.orderId;
    if (filters.date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(filters.date)) {
        throw badRequest("delivery.dateMustBeInYyyyMm");
      }
      // Noon UTC of the requested day is the same Dhaka calendar
      // day (Dhaka is UTC+6), so the Dhaka-day solver anchors right.
      const anchor = new Date(`${filters.date}T12:00:00.000Z`);
      if (Number.isNaN(anchor.getTime())) throw badRequest("delivery.dateIsNotValid");
      const start = dhakaDayStartUtc(anchor);
      where.assignedAt = { gte: start, lt: new Date(start.getTime() + DAY_MS) };
    }
    const rows = await (this.prisma as any).deliveryAssignment.findMany({
      where, orderBy: { assignedAt: "desc" }, take: 100,
    });

    return Promise.all((rows as any[]).map(async (a) => {
      const rider = await (this.prisma as any).rider.findFirst({
        where: { id: a.riderId, organizationId },
      }).catch(() => null);
      const order = await (this.prisma as any).order.findFirst({
        where: { id: a.orderId, organizationId },
      }).catch(() => null);
      return {
        ...a,
        riderName: rider?.name ?? null,
        orderNumber: order?.externalNumber ?? null,
        orderStatus: order?.status ?? null,
        orderTotalMinor: order ? String(order.totalMinor ?? 0) : null,
        orderAddress: order?.address ?? null,
      };
    }));
  }
}
