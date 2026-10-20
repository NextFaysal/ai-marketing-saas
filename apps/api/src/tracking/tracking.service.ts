import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { IngestDto, TrackEventDto } from "./tracking.dto";
import { classifyTouchpoint } from "../attribution/engine";
import { AttributionService } from "../attribution/attribution.service";
import { parseMoneyToMinor } from "@repo/contracts";
import { badRequest } from "../i18n/api-exception";

const MAX_BATCH = 50;
const ALLOWED_TYPES = ["page_view", "product_view", "add_to_cart", "checkout_started", "lead", "purchase", "refund", "custom", "identify"];

@Injectable()
export class TrackingService {
  constructor(private readonly prisma: PrismaService, private readonly attribution: AttributionService) {}

  async ingest(dto: IngestDto) {
    if (dto.events.length > MAX_BATCH) throw badRequest("tracking.batchTooLargeMaxEvents", { MAX_BATCH: MAX_BATCH });
    const store = await (this.prisma as any).store.findFirst({ where: { trackingKey: dto.key } });
    if (!store) throw badRequest("tracking.unknownTrackingKey");
    const organizationId: string = store.organizationId;

    let accepted = 0, duplicates = 0, rejected = 0;
    for (const event of dto.events) {
      const result = await this.ingestOne(organizationId, store.id, event);
      if (result === "accepted") accepted++;
      else if (result === "duplicate") duplicates++;
      else rejected++;
    }
    return { accepted, duplicates, rejected };
  }

  private async ingestOne(organizationId: string, storeId: string, event: TrackEventDto): Promise<"accepted" | "duplicate" | "rejected"> {
    if (!ALLOWED_TYPES.includes(event.type)) return "rejected";

    // Deduplication: the same clientEventId can arrive twice (beacon retry,
    // page reload). It is stored exactly once per organization.
    const existing = await (this.prisma as any).trackingEvent.findFirst({
      where: { organizationId, clientEventId: event.clientEventId },
    });
    if (existing) return "duplicate";

    const occurredAt = event.occurredAt && !Number.isNaN(Date.parse(event.occurredAt)) ? new Date(event.occurredAt) : new Date();

    // Visitor upsert (pseudonymous id only)
    let visitor = await (this.prisma as any).visitor.findFirst({ where: { organizationId, anonymousId: event.anonymousId } });
    if (!visitor) {
      visitor = await (this.prisma as any).visitor.create({ data: { organizationId, anonymousId: event.anonymousId } });
    } else {
      await (this.prisma as any).visitor.update({ where: { id: visitor.id }, data: { lastSeenAt: new Date() } });
    }

    // S4: an identify event is the ONLY way contact details reach a
    // visitor — the store calls TP.identify(...) explicitly (e.g. when a
    // shopper types their email/phone at checkout). Fields are validated
    // strictly; invalid values are ignored, never stored. The identify
    // event itself is still stored below like any other event.
    if (event.type === "identify") {
      const props: any = event.properties ?? {};
      const contact: { email?: string; phone?: string } = {};
      if (typeof props.email === "string") {
        const email = props.email.trim().toLowerCase();
        if (email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) contact.email = email;
      }
      if (typeof props.phone === "string") {
        const phone = props.phone.trim();
        if (phone.length >= 6 && phone.length <= 20 && /^[0-9+\-\s]+$/.test(phone)) contact.phone = phone;
      }
      if (contact.email !== undefined || contact.phone !== undefined) {
        await (this.prisma as any).visitor.update({ where: { id: visitor.id }, data: contact });
      }
    }

    // Session: created once, with its touchpoint. Later events in the same
    // session do not create new touchpoints.
    let session = await (this.prisma as any).trackingSession.findFirst({
      where: { organizationId, sessionKey: event.sessionKey },
    });
    if (!session) {
      const s = event.session ?? {};
      session = await (this.prisma as any).trackingSession.create({
        data: {
          organizationId, visitorId: visitor.id, sessionKey: event.sessionKey,
          landingPage: s.landingPage ?? event.url ?? null, referrer: s.referrer ?? event.referrer ?? null,
          utmSource: s.utmSource ?? null, utmMedium: s.utmMedium ?? null, utmCampaign: s.utmCampaign ?? null,
          utmContent: s.utmContent ?? null, utmTerm: s.utmTerm ?? null,
          fbclid: s.fbclid ?? null, gclid: s.gclid ?? null, ttclid: s.ttclid ?? null,
          startedAt: occurredAt, lastActivityAt: occurredAt,
        },
      });
      const cls = classifyTouchpoint(s);
      await (this.prisma as any).touchpoint.create({
        data: {
          organizationId, visitorId: visitor.id, sessionId: session.id,
          source: cls.source, medium: s.utmMedium ?? null, campaign: s.utmCampaign ?? null,
          content: s.utmContent ?? null, term: s.utmTerm ?? null,
          clickIdType: cls.clickIdType, clickId: cls.clickId,
          landingPage: s.landingPage ?? event.url ?? null, referrer: s.referrer ?? event.referrer ?? null,
          isDirect: cls.isDirect, occurredAt,
        },
      });
    } else {
      await (this.prisma as any).trackingSession.update({ where: { id: session.id }, data: { lastActivityAt: occurredAt } });
    }

    // Link to a synced order when we can (purchase events usually arrive
    // before or after the Woo sync; reconciliation handles the other order).
    let order: any = null;
    if (event.orderExternalId) {
      order = await (this.prisma as any).order.findFirst({ where: { organizationId, externalId: event.orderExternalId } });
    }

    let valueMinor: bigint | null = null;
    if (event.value) { try { valueMinor = parseMoneyToMinor(event.value); } catch { valueMinor = null; } }

    await (this.prisma as any).trackingEvent.create({
      data: {
        organizationId, storeId, visitorId: visitor.id, sessionKey: event.sessionKey,
        clientEventId: event.clientEventId, type: event.type,
        url: event.url ?? null, referrer: event.referrer ?? null,
        properties: event.properties ?? undefined,
        orderExternalId: event.orderExternalId ?? null, orderId: order?.id ?? null,
        valueMinor, currency: event.currency ?? null, occurredAt,
      },
    });

    if (event.type === "purchase" && order) {
      await this.attribution.computeForOrder(organizationId, order, visitor.id);
    }
    return "accepted";
  }
}
