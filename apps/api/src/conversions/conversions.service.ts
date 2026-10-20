import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { createHash, randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EventsService } from "../common/events.service";
import { encryptJson, decryptJson } from "../integrations/crypto";
import { MetaCapiClient } from "./capi.client";
import { badRequest, notFound } from "../i18n/api-exception";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
export function hashEmail(email?: string | null): string | null {
  const e = (email ?? "").trim().toLowerCase();
  return e.includes("@") ? sha256(e) : null;
}
export function hashPhone(phone?: string | null): string | null {
  let d = (phone ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("0")) d = `880${d.slice(1)}`; // BD local -> intl
  return sha256(d);
}

const TRIGGERS = ["placed", "cod_confirmed", "delivered"] as const;

@Injectable()
export class ConversionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly events?: EventsService,
  ) {
    if (this.events) {
      this.events.on("order.created", (p) => { void this.handleOrderTrigger(p?.organizationId, p?.context?.orderId, "placed"); });
      this.events.on("order.cod_confirmed", (p) => { void this.handleOrderTrigger(p?.organizationId, p?.context?.orderId, "cod_confirmed"); });
      this.events.on("order.delivered", (p) => { void this.handleOrderTrigger(p?.organizationId, p?.context?.orderId, "delivered"); });
      this.events.on("lead.created", (p) => { void this.handleLead(p?.organizationId, p?.context?.leadId); });
    }
  }

  async getSettings(organizationId: string) {
    const row = await (this.prisma as any).conversionApiSetting.findUnique({ where: { organizationId } }).catch(() => null);
    if (!row) return { configured: false };
    return {
      configured: true, pixelId: row.pixelId, hasDedicatedToken: Boolean(row.accessTokenEncrypted),
      testEventCode: row.testEventCode ?? null, purchaseTrigger: row.purchaseTrigger,
      enabled: row.enabled, sendLeadEvents: row.sendLeadEvents,
    };
  }

  async updateSettings(organizationId: string, actorId: string, dto: {
    pixelId: string; accessToken?: string; testEventCode?: string | null;
    purchaseTrigger?: string; enabled?: boolean; sendLeadEvents?: boolean;
  }) {
    if (!dto.pixelId?.trim()) throw badRequest("conversions.pixelidDatasetIdIsRequired");
    if (dto.purchaseTrigger && !(TRIGGERS as readonly string[]).includes(dto.purchaseTrigger)) {
      throw badRequest("conversions.purchasetriggerMustBePlacedCodConfirmed");
    }
    const data: any = {
      pixelId: dto.pixelId.trim(),
      ...(dto.testEventCode !== undefined ? { testEventCode: dto.testEventCode?.trim() || null } : {}),
      ...(dto.purchaseTrigger ? { purchaseTrigger: dto.purchaseTrigger } : {}),
      ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      ...(dto.sendLeadEvents !== undefined ? { sendLeadEvents: dto.sendLeadEvents } : {}),
      ...(dto.accessToken?.trim() ? { accessTokenEncrypted: encryptJson({ token: dto.accessToken.trim() }) } : {}),
    };
    const existing = await (this.prisma as any).conversionApiSetting.findUnique({ where: { organizationId } }).catch(() => null);
    if (existing) await (this.prisma as any).conversionApiSetting.update({ where: { organizationId }, data });
    else await (this.prisma as any).conversionApiSetting.create({ data: { organizationId, ...data } });
    await this.audit.log({ organizationId, userId: actorId, action: "conversions.settings.updated", entityType: "ConversionApiSetting", metadata: { pixelId: data.pixelId } });
    return this.getSettings(organizationId);
  }

  private async settingOrNull(organizationId: string) {
    return (this.prisma as any).conversionApiSetting.findUnique({ where: { organizationId } }).catch(() => null);
  }

  private async resolveToken(organizationId: string, setting: any): Promise<string> {
    if (setting.accessTokenEncrypted) {
      return decryptJson<{ token: string }>(setting.accessTokenEncrypted).token;
    }
    const integration = await (this.prisma as any).integration.findFirst({
      where: { organizationId, provider: "meta", status: "CONNECTED" }, include: { credential: true },
      orderBy: { createdAt: "desc" },
    });
    if (integration?.credential) {
      return decryptJson<{ accessToken: string }>(integration.credential.encryptedData).accessToken;
    }
    throw badRequest("conversions.noConversionsApiTokenSetA");
  }

  private async alreadyLogged(organizationId: string, eventId: string): Promise<boolean> {
    const row = await (this.prisma as any).conversionEventLog.findFirst({ where: { organizationId, eventId } }).catch(() => null);
    return Boolean(row);
  }

  private async dispatch(organizationId: string, setting: any, event: any, meta: { sourceType: string; sourceId?: string }, testEventCode?: string) {
    const token = await this.resolveToken(organizationId, setting);
    const client = new MetaCapiClient(token);
    try {
      const out = await client.sendEvents(setting.pixelId, [event], testEventCode);
      const log = await (this.prisma as any).conversionEventLog.create({
        data: {
          organizationId, eventName: event.event_name, sourceType: meta.sourceType, sourceId: meta.sourceId ?? null,
          eventId: event.event_id, status: "sent", eventsReceived: out.eventsReceived, fbtraceId: out.fbtraceId ?? null,
          payload: event,
        },
      });
      return log;
    } catch (e) {
      const log = await (this.prisma as any).conversionEventLog.create({
        data: {
          organizationId, eventName: event.event_name, sourceType: meta.sourceType, sourceId: meta.sourceId ?? null,
          eventId: event.event_id, status: "failed", error: e instanceof Error ? e.message : "send failed",
          payload: event,
        },
      }).catch(() => null);
      if (!testEventCode && meta.sourceType !== "order" && meta.sourceType !== "lead") throw e;
      return log;
    }
  }

  /** Best-effort fbc from our own first-party tracker data. */
  private async fbcForOrder(organizationId: string, order: any): Promise<string | null> {
    try {
      const events = await (this.prisma as any).trackingEvent.findMany({
        where: { organizationId, type: "purchase" }, orderBy: { occurredAt: "desc" }, take: 200,
      });
      const key = order.externalNumber ?? order.externalId;
      const hit = events.find((e: any) => e.payload?.orderExternalId && key && String(e.payload.orderExternalId) === String(key));
      if (!hit?.visitorId) return null;
      const touch = await (this.prisma as any).touchpoint.findFirst({
        where: { organizationId, visitorId: hit.visitorId, fbclid: { not: null } }, orderBy: { occurredAt: "desc" },
      });
      if (!touch?.fbclid) return null;
      return `fb.1.${new Date(touch.occurredAt).getTime()}.${touch.fbclid}`;
    } catch { return null; }
  }

  async handleOrderTrigger(organizationId?: string, orderId?: string, kind?: string) {
    if (!organizationId || !orderId || !kind) return;
    const setting = await this.settingOrNull(organizationId);
    if (!setting?.enabled || setting.purchaseTrigger !== kind) return;
    const order = await (this.prisma as any).order.findFirst({ where: { id: orderId, organizationId } });
    if (!order || order.status === "cancelled" || order.status === "refunded") return;
    const key = order.externalNumber ?? order.externalId ?? order.id;
    const eventId = `purchase-${key}`;
    if (await this.alreadyLogged(organizationId, eventId)) return; // one Purchase per order
    const customer = order.customerId
      ? await (this.prisma as any).customer.findFirst({ where: { id: order.customerId, organizationId } })
      : null;
    const items = await (this.prisma as any).orderItem.findMany({ where: { orderId: order.id }, take: 50 }).catch(() => []);
    const userData: Record<string, unknown> = {};
    const em = hashEmail(customer?.email); if (em) userData.em = [em];
    const ph = hashPhone(customer?.phone); if (ph) userData.ph = [ph];
    if (customer?.id) userData.external_id = [sha256(customer.id)];
    const fbc = await this.fbcForOrder(organizationId, order);
    if (fbc) userData.fbc = fbc;
    const event = {
      event_name: "Purchase",
      event_time: Math.floor(new Date(order.placedAt ?? order.createdAt).getTime() / 1000),
      event_id: eventId,
      action_source: "system_generated",
      user_data: userData,
      custom_data: {
        currency: order.currency ?? "BDT",
        value: Number(BigInt(order.totalMinor)) / 100,
        order_id: String(key),
        num_items: items.reduce((s: number, i: any) => s + (i.quantity ?? 1), 0),
        content_ids: items.map((i: any) => i.sku ?? i.name).filter(Boolean).slice(0, 50),
        content_type: "product",
      },
    };
    await this.dispatch(organizationId, setting, event, { sourceType: "order", sourceId: order.id }).catch(() => undefined);
  }

  async handleLead(organizationId?: string, leadId?: string) {
    if (!organizationId || !leadId) return;
    const setting = await this.settingOrNull(organizationId);
    if (!setting?.enabled || !setting.sendLeadEvents) return;
    const lead = await (this.prisma as any).lead.findFirst({ where: { id: leadId, organizationId } });
    if (!lead) return;
    const eventId = `lead-${lead.id}`;
    if (await this.alreadyLogged(organizationId, eventId)) return;
    const userData: Record<string, unknown> = {};
    const em = hashEmail(lead.email); if (em) userData.em = [em];
    const ph = hashPhone(lead.phone); if (ph) userData.ph = [ph];
    const event = {
      event_name: "Lead",
      event_time: Math.floor(new Date(lead.createdAt).getTime() / 1000),
      event_id: eventId,
      action_source: "system_generated",
      user_data: userData,
      custom_data: { lead_source: lead.source ?? "crm" },
    };
    await this.dispatch(organizationId, setting, event, { sourceType: "lead", sourceId: lead.id }).catch(() => undefined);
  }

  /** A real API call with the org's test event code, so the owner can
   * watch it land in Meta's Test Events tab. Requires the code. */
  async sendTestEvent(organizationId: string, actorId: string) {
    const setting = await this.settingOrNull(organizationId);
    if (!setting) throw notFound("conversions.conversionsApiIsNotConfiguredFor");
    if (!setting.testEventCode) throw badRequest("conversions.setATesteventcodeFirstMetaEvents");
    const event = {
      event_name: "Purchase",
      event_time: Math.floor(Date.now() / 1000),
      event_id: `test-${randomUUID()}`,
      action_source: "system_generated",
      user_data: { em: [hashEmail("test@example.com")] },
      custom_data: { currency: "BDT", value: 1, content_type: "product" },
    };
    const log = await this.dispatch(organizationId, setting, event, { sourceType: "test" }, setting.testEventCode);
    if (!log || log.status !== "sent") throw new BadRequestException(log?.error ?? "Test event was not received by Meta");
    await this.audit.log({ organizationId, userId: actorId, action: "conversions.test_event", entityType: "ConversionApiSetting", metadata: { eventId: event.event_id } });
    return { ...log, payload: undefined };
  }

  async listEvents(organizationId: string) {
    const rows = await (this.prisma as any).conversionEventLog.findMany({
      where: { organizationId }, orderBy: { createdAt: "desc" }, take: 100,
    });
    return rows.map((r: any) => ({ ...r, payload: undefined }));
  }
}
