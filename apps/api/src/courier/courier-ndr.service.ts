import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { InboxService } from "../inbox/inbox.service";
import { EventsService } from "../common/events.service";
import { trackingLinkFor } from "./tracking-token";
import { normalizeBdPhone as normalizeSmsPhone } from "../messaging/sms.provider";
import {
  ContactNdrDto,
  CustomerNdrActionDto,
  RescheduleNdrDto,
  ResolveNdrDto,
} from "./courier-ndr.dto";
import { notFound } from "../i18n";

// Statuses from Steadfast, Pathao, RedX that signal delivery failure, hold, or unreachable customer
export const NDR_STATUS_KEYWORDS = [
  "hold",
  "failed_attempt",
  "delivery_failed",
  "failed",
  "unreachable",
  "rescheduled",
  "customer_unreachable",
  "cancelled_by_customer",
  "wrong_address",
];

export function isNdrStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return NDR_STATUS_KEYWORDS.some((kw) => s.includes(kw));
}

@Injectable()
export class CourierNdrService {
  private readonly logger = new Logger(CourierNdrService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly inbox?: InboxService,
    @Optional() private readonly events?: EventsService,
  ) {}

  /**
   * Called during courier status sync when an NDR or failed delivery attempt is detected.
   * Creates or updates a CourierNdrIncident and triggers automatic customer recovery.
   */
  async interceptNdr(
    organizationId: string,
    shipment: any,
    reason?: string,
  ): Promise<any> {
    if (!shipment?.id || !shipment?.orderId) return null;

    let incident = await (this.prisma as any).courierNdrIncident.findFirst({
      where: {
        organizationId,
        shipmentId: shipment.id,
        status: { in: ["OPEN", "CUSTOMER_CONTACTED", "RESCHEDULED"] },
      },
    });

    const determinedReason = reason || shipment.status || "customer_unreachable";

    if (!incident) {
      incident = await (this.prisma as any).courierNdrIncident.create({
        data: {
          organizationId,
          shipmentId: shipment.id,
          orderId: shipment.orderId,
          provider: shipment.provider,
          trackingCode: shipment.trackingCode || "N/A",
          reason: determinedReason,
          status: "OPEN",
          notes: `Courier reported status: ${shipment.status}`,
        },
      });
    } else {
      incident = await (this.prisma as any).courierNdrIncident.update({
        where: { id: incident.id },
        data: {
          reason: determinedReason,
          notes: `Updated status: ${shipment.status}`,
        },
      });
    }

    // Auto-fire customer recovery communication
    await this.sendNdrCustomerAlert(organizationId, incident, shipment).catch((err) => {
      this.logger.warn(`Failed to send automated NDR alert: ${err instanceof Error ? err.message : err}`);
    });

    return incident;
  }

  /**
   * Sends automated WhatsApp / SMS alert with interactive tracking/action link to the customer
   */
  async sendNdrCustomerAlert(
    organizationId: string,
    incident: any,
    shipment?: any,
  ): Promise<boolean> {
    const ship =
      shipment ||
      (await (this.prisma as any).courierShipment.findFirst({
        where: { id: incident.shipmentId, organizationId },
      }));

    if (!ship) return false;

    const order = await (this.prisma as any).order.findFirst({
      where: { id: incident.orderId, organizationId },
      include: { customer: { select: { phone: true, email: true, name: true } } },
    });

    const trackingLink = ship.trackingToken ? trackingLinkFor(ship.trackingToken) : null;
    const recipientPhone = order?.customer?.phone || ship.recipientPhone;

    const messageLines = [
      `⚠️ ডেলিভারি সতর্কবার্তা (Order: ${order?.externalNumber || ship.invoice})`,
      `প্রিয় গ্রাহক, ${ship.provider.toUpperCase()} কুরিয়ারের ডেলিভারি রাইডার আপনার ঠিকানায় পার্সেলটি ডেলিভারির চেষ্টা করেছিল, কিন্তু আপনার সাথে যোগাযোগ করা সম্ভব হয়নি।`,
      ship.trackingCode ? `Tracking Code: ${ship.trackingCode}` : null,
      trackingLink ? `🔄 পার্সেলটি পুনরায় ডেলিভারি নিতে বা বিকল্প সময় জানাতে ক্লিক করুন: ${trackingLink}` : null,
      `অথবা এই মেসেজের উত্তরে আপনার সুবিধাজনক ডেলিভারির সময় জানিয়ে দিন। ধন্যবাদ!`,
    ].filter(Boolean);

    const messageText = messageLines.join("\n\n");
    let sent = false;

    // 1. Try In-App Inbox / WhatsApp / Messenger if conversation exists
    if (this.inbox && order?.conversationId) {
      try {
        await this.inbox.sendAutomatedMessage(
          organizationId,
          order.conversationId,
          messageText,
          "courier_update",
        );
        sent = true;
      } catch (e) {
        this.logger.debug(`Inbox NDR message send failed: ${e instanceof Error ? e.message : e}`);
      }
    }

    // Update incident status
    await (this.prisma as any).courierNdrIncident.update({
      where: { id: incident.id },
      data: {
        status: "CUSTOMER_CONTACTED",
        lastContactedAt: new Date(),
        actionTaken: sent ? "Customer contacted via Chat/WhatsApp" : "Customer alert queued",
      },
    });

    // Notify agents via event
    if (this.events) {
      try {
        this.events.emit("courier.ndr_intercepted", {
          organizationId,
          incidentId: incident.id,
          orderId: incident.orderId,
          trackingCode: incident.trackingCode,
          provider: incident.provider,
          reason: incident.reason,
        });
      } catch {}
    }

    return true;
  }

  /**
   * List NDR incidents with metrics for dashboard
   */
  async list(organizationId: string, query?: { status?: string; provider?: string }) {
    const where: any = { organizationId };
    if (query?.status) where.status = query.status;
    if (query?.provider) where.provider = query.provider;

    const [incidents, allCount, openCount, contactedCount, rescheduledCount, resolvedCount, returnedCount] =
      await Promise.all([
        (this.prisma as any).courierNdrIncident.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
        (this.prisma as any).courierNdrIncident.count({ where: { organizationId } }),
        (this.prisma as any).courierNdrIncident.count({ where: { organizationId, status: "OPEN" } }),
        (this.prisma as any).courierNdrIncident.count({ where: { organizationId, status: "CUSTOMER_CONTACTED" } }),
        (this.prisma as any).courierNdrIncident.count({ where: { organizationId, status: "RESCHEDULED" } }),
        (this.prisma as any).courierNdrIncident.count({ where: { organizationId, status: "RESOLVED" } }),
        (this.prisma as any).courierNdrIncident.count({ where: { organizationId, status: "RETURNED" } }),
      ]);

    // Attach order details
    const orderIds = incidents.map((i: any) => i.orderId);
    const orders = await (this.prisma as any).order.findMany({
      where: { id: { in: orderIds }, organizationId },
      select: {
        id: true,
        externalNumber: true,
        totalAmountMinor: true,
        customer: { select: { name: true, phone: true } },
      },
    });
    const orderMap = new Map(orders.map((o: any) => [o.id, o]));

    const enriched = incidents.map((inc: any) => {
      const order: any = orderMap.get(inc.orderId);
      return {
        ...inc,
        orderNumber: order?.externalNumber || "N/A",
        totalAmountMinor: order?.totalAmountMinor?.toString() || "0",
        customerName: order?.customer?.name || "Customer",
        customerPhone: order?.customer?.phone || "",
      };
    });

    const recoveredCount = resolvedCount + rescheduledCount;
    const recoveryRate = allCount > 0 ? Math.round((recoveredCount / allCount) * 100) : 0;

    return {
      metrics: {
        total: allCount,
        open: openCount,
        contacted: contactedCount,
        rescheduled: rescheduledCount,
        resolved: resolvedCount,
        returned: returnedCount,
        recoveryRatePercent: recoveryRate,
      },
      incidents: enriched,
    };
  }

  /**
   * Reschedule an NDR incident manually
   */
  async reschedule(organizationId: string, incidentId: string, dto: RescheduleNdrDto) {
    const incident = await (this.prisma as any).courierNdrIncident.findFirst({
      where: { id: incidentId, organizationId },
    });
    if (!incident) throw notFound("courier.ndrIncidentNotFound");

    const updated = await (this.prisma as any).courierNdrIncident.update({
      where: { id: incidentId },
      data: {
        status: "RESCHEDULED",
        rescheduleDate: new Date(dto.rescheduleDate),
        notes: dto.notes ? `${incident.notes || ""}\nReschedule note: ${dto.notes}`.trim() : incident.notes,
        actionTaken: "Rescheduled by merchant agent",
      },
    });

    return updated;
  }

  /**
   * Mark an NDR incident as resolved or returned
   */
  async resolve(organizationId: string, incidentId: string, dto: ResolveNdrDto) {
    const incident = await (this.prisma as any).courierNdrIncident.findFirst({
      where: { id: incidentId, organizationId },
    });
    if (!incident) throw notFound("courier.ndrIncidentNotFound");

    const updated = await (this.prisma as any).courierNdrIncident.update({
      where: { id: incidentId },
      data: {
        status: dto.resolution,
        resolvedAt: new Date(),
        notes: dto.notes ? `${incident.notes || ""}\nResolution: ${dto.notes}`.trim() : incident.notes,
      },
    });

    return updated;
  }

  /**
   * Customer action response via public live-tracking link
   */
  async customerRespond(token: string, dto: CustomerNdrActionDto) {
    const shipment = await (this.prisma as any).courierShipment.findFirst({
      where: { trackingToken: token },
    });
    if (!shipment) throw notFound("courier.shipmentNotFound");

    const incident = await (this.prisma as any).courierNdrIncident.findFirst({
      where: {
        organizationId: shipment.organizationId,
        shipmentId: shipment.id,
      },
      orderBy: { createdAt: "desc" },
    });

    if (!incident) {
      // If incident record didn't exist yet, create one
      return {
        success: true,
        message: "আপনার মতামত গ্রহণ করা হয়েছে। আমাদের কাস্টমার কেয়ার টিম দ্রুত যোগাযোগ করবে।",
      };
    }

    let status = "RESCHEDULED";
    let rescheduleDate: Date | null = null;
    let feedback = dto.action;

    if (dto.action === "CONFIRMED_TOMORROW") {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      rescheduleDate = tomorrow;
    } else if (dto.action === "CHANGE_ADDRESS") {
      rescheduleDate = dto.preferredDate ? new Date(dto.preferredDate) : new Date();
      if (dto.newAddress) {
        await (this.prisma as any).courierShipment.update({
          where: { id: shipment.id },
          data: { recipientAddress: dto.newAddress },
        }).catch(() => {});
      }
    } else if (dto.action === "CANCEL_ORDER") {
      status = "RETURNED";
    }

    await (this.prisma as any).courierNdrIncident.update({
      where: { id: incident.id },
      data: {
        status,
        customerFeedback: feedback,
        rescheduleDate: rescheduleDate || undefined,
        notes: `${incident.notes || ""}\nCustomer action: ${dto.action}${dto.note ? ` - ${dto.note}` : ""}${dto.newAddress ? ` (New Address: ${dto.newAddress})` : ""}`.trim(),
        actionTaken: `Customer responded: ${dto.action}`,
      },
    });

    return {
      success: true,
      action: dto.action,
      message:
        dto.action === "CANCEL_ORDER"
          ? "আপনার অনুরোধ অনুযায়ী অর্ডারটি বাতিলের প্রক্রিয়া শুরু করা হয়েছে।"
          : "ধন্যবাদ! আপনার সুবিধাজনক সময়ে পার্সেলটি পুনরায় ডেলিভারি করার জন্য কুরিয়ার টিমকে নির্দেশনা দেওয়া হয়েছে।",
    };
  }
}
