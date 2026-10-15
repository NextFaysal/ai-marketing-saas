import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EventsService } from "../common/events.service";
import { decryptJson } from "../integrations/crypto";
import { orgFlagEnabled } from "../common/feature-flags";
import { MetaCapiClient } from "../conversions/capi.client";
import { hashEmail, hashPhone } from "../conversions/conversions.service";

const TRIGGERS = ["placed", "cod_confirmed", "delivered"] as const;

/** Format a Date as Google Ads requires: "yyyy-MM-dd HH:mm:ss+06:00"
 * in Asia/Dhaka wall time (Dhaka has no DST; fixed offset). */
export function googleDateTime(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}+06:00`;
}

/**
 * Server-side conversions for Google Ads (offline click conversion
 * upload keyed by the gclid our tracker captured) and TikTok Events
 * API (keyed by ttclid). Phase L. Same discipline as Meta CAPI:
 * one event per order per platform (unique log), an upload counts
 * as sent ONLY when the platform's response confirms it, and an
 * order without a recorded click id is skipped honestly — never
 * sent unkeyed.
 *
 * Frontier CN14 (NB6): Meta joins the surface. Spike verdict
 * (see docs/campaign-builder-nb6-acceptance.md): Meta's legacy
 * Offline Conversions API / offline event sets were
 * DISCONTINUED (event-set creation ended May 2024, the API
 * itself in May 2025) — the current documented path is the
 * Conversions API to a DATASET: POST /{dataset_id}/events
 * with action_source "system_generated" for CRM/backend
 * events, the exact endpoint this codebase's MetaCapiClient
 * already speaks. The meta upload therefore rides that
 * client, is keyed by hashed customer data (Meta has no
 * click id to require), and dedupes against BOTH its own
 * log and the Conversions API's log: the event_id is the
 * SAME deterministic `purchase-{orderKey}` ConversionsService
 * uses, so when that service already delivered the Purchase
 * to the same dataset, this upload records a skip instead
 * of double-counting the order.
 */
@Injectable()
export class OfflineConversionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly events?: EventsService,
  ) {
    if (this.events) {
      this.events.on("order.created", (p) => { void this.handleTrigger(p?.organizationId, p?.context?.orderId, "placed"); });
      this.events.on("order.cod_confirmed", (p) => { void this.handleTrigger(p?.organizationId, p?.context?.orderId, "cod_confirmed"); });
      this.events.on("order.delivered", (p) => { void this.handleTrigger(p?.organizationId, p?.context?.orderId, "delivered"); });
      // CN14: CRM stage outcomes for Meta lead-ads leads
      // (LeadsService already emits lead.stage_changed;
      // the handler itself enforces every gate and never
      // throws back into the bus).
      this.events.on("lead.stage_changed", (p) => { void this.sendLeadFeedback(p?.organizationId, p?.context?.leadId, p?.context?.stage).catch(() => undefined); });
    }
  }

  async getSettings(organizationId: string) {
    const rows = await (this.prisma as any).offlineConversionSetting.findMany({ where: { organizationId } });
    return rows;
  }

  async saveSetting(organizationId: string, actorId: string, platform: string, dto: {
    adAccountId: string; conversionAction?: string; pixelCode?: string; trigger?: string; enabled?: boolean;
    datasetId?: string; leadFeedbackEnabled?: boolean;
  }) {
    if (!["google", "tiktok", "meta"].includes(platform)) throw new BadRequestException("platform must be google, tiktok or meta");
    const account = await (this.prisma as any).adAccount.findFirst({ where: { id: dto.adAccountId, organizationId } });
    if (!account) throw new NotFoundException("Ad account not found");
    if (account.platform !== platform) throw new BadRequestException(`That ad account is a ${account.platform} account, not ${platform}`);
    if (platform === "google" && !dto.conversionAction?.trim()) throw new BadRequestException("Google needs the offline conversion action id (from Google Ads > Goals > Conversions)");
    if (platform === "tiktok" && !dto.pixelCode?.trim()) throw new BadRequestException("TikTok needs the Events API pixel code");
    if (platform === "meta" && !dto.datasetId?.trim()) throw new BadRequestException("Meta needs the dataset (pixel) id that receives offline events (Events Manager > Data sources)");
    if (dto.trigger && !(TRIGGERS as readonly string[]).includes(dto.trigger)) throw new BadRequestException("Invalid trigger");
    const existing = await (this.prisma as any).offlineConversionSetting.findFirst({ where: { organizationId, platform } });
    const data = {
      organizationId, platform, adAccountId: dto.adAccountId,
      conversionAction: dto.conversionAction?.trim() ?? null,
      pixelCode: dto.pixelCode?.trim() ?? null,
      datasetId: dto.datasetId?.trim() ?? null,
      leadFeedbackEnabled: dto.leadFeedbackEnabled === true,
      trigger: dto.trigger ?? "cod_confirmed",
      enabled: dto.enabled !== false,
    };
    const saved = existing
      ? await (this.prisma as any).offlineConversionSetting.update({ where: { id: existing.id }, data })
      : await (this.prisma as any).offlineConversionSetting.create({ data });
    await this.audit.log({ organizationId, userId: actorId, action: "offline_conversions.settings_saved", entityType: "OfflineConversionSetting", entityId: saved.id, metadata: { platform } });
    return saved;
  }

  async listLogs(organizationId: string, platform?: string) {
    return (this.prisma as any).offlineConversionLog.findMany({
      where: { organizationId, ...(platform ? { platform } : {}) },
      orderBy: { createdAt: "desc" }, take: 100,
    });
  }

  private async handleTrigger(organizationId: string, orderId: string, trigger: string) {
    if (!organizationId || !orderId) return;
    // Milestone 40: platform feature flag (offline_conversions).
    if (!(await orgFlagEnabled(this.prisma as any, organizationId, "offline_conversions"))) return;
    for (const platform of ["google", "tiktok", "meta"] as const) {
      const setting = await (this.prisma as any).offlineConversionSetting.findFirst({ where: { organizationId, platform } }).catch(() => null);
      if (!setting?.enabled || setting.trigger !== trigger) continue;
      await this.uploadForOrder(organizationId, orderId, platform).catch(() => undefined);
    }
  }

  /** Find the click id recorded for this order's attributed
   * touchpoints (the tracker stored clickIdType + clickId there). */
  async clickIdForOrder(organizationId: string, orderId: string, type: "gclid" | "ttclid"): Promise<string | null> {
    const credits = await (this.prisma as any).attributionCredit?.findMany({ where: { organizationId, orderId }, take: 50 }).catch(() => []);
    if (!credits?.length) return null;
    const tpIds = [...new Set(credits.map((c: any) => c.touchpointId))];
    const tps = await (this.prisma as any).touchpoint.findMany({ where: { id: { in: tpIds } } });
    for (const tp of tps as any[]) {
      if (tp.clickIdType === type && tp.clickId) return String(tp.clickId);
    }
    return null;
  }

  private async recordLog(organizationId: string, platform: string, eventId: string, orderId: string | null, status: string, detail?: string) {
    const existing = await (this.prisma as any).offlineConversionLog.findFirst({ where: { organizationId, platform, eventId } });
    if (existing) {
      return (this.prisma as any).offlineConversionLog.update({ where: { id: existing.id }, data: { status, detail: detail ?? null, orderId } });
    }
    return (this.prisma as any).offlineConversionLog.create({ data: { organizationId, platform, eventId, orderId, status, detail: detail ?? null } });
  }

  private async accountSecrets(organizationId: string, adAccountId: string) {
    const account = await (this.prisma as any).adAccount.findFirst({ where: { id: adAccountId, organizationId } });
    if (!account?.integrationId) throw new BadRequestException("Ad account is not connected via API");
    const integration = await (this.prisma as any).integration.findFirst({
      where: { id: account.integrationId, organizationId }, include: { credential: true },
    });
    if (!integration?.credential) throw new BadRequestException("Integration credentials are missing; reconnect the account");
    return { account, secrets: decryptJson<any>(integration.credential.encryptedData) };
  }

  async uploadForOrder(organizationId: string, orderId: string, platform: "google" | "tiktok" | "meta") {
    const setting = await (this.prisma as any).offlineConversionSetting.findFirst({ where: { organizationId, platform } });
    if (!setting) throw new BadRequestException(`No ${platform} offline conversion setting saved`);
    if (!setting.enabled) throw new BadRequestException(`${platform} offline conversions are disabled`);
    const order = await (this.prisma as any).order.findFirst({ where: { id: orderId, organizationId } });
    if (!order) throw new NotFoundException("Order not found");
    const eventId = `purchase-${order.externalNumber ?? order.externalId ?? order.id}`;
    const prior = await (this.prisma as any).offlineConversionLog.findFirst({ where: { organizationId, platform, eventId } });
    if (prior?.status === "sent") return { ...prior, alreadySent: true };
    if (["cancelled", "refunded"].includes(String(order.status))) {
      return this.recordLog(organizationId, platform, eventId, orderId, "skipped", `order status is ${order.status}`);
    }
    // CN14: Meta matches on hashed customer data, not a
    // click id — its own path (dataset dedup + user_data).
    if (platform === "meta") return this.uploadMetaForOrder(organizationId, order, setting, eventId);
    const clickType = platform === "google" ? "gclid" : "ttclid";
    const clickId = await this.clickIdForOrder(organizationId, orderId, clickType as any);
    if (!clickId) {
      return this.recordLog(organizationId, platform, eventId, orderId, "skipped", `no ${clickType} recorded on this order's touchpoints`);
    }
    try {
      const detail = platform === "google"
        ? await this.sendGoogle(setting, order, clickId)
        : await this.sendTiktok(setting, order, clickId, eventId);
      return await this.recordLog(organizationId, platform, eventId, orderId, "sent", detail);
    } catch (e) {
      const message = e instanceof Error ? e.message : "upload failed";
      await this.recordLog(organizationId, platform, eventId, orderId, "failed", message).catch(() => undefined);
      throw new BadRequestException(`${platform} upload did NOT confirm: ${message}`);
    }
  }

  private async sendGoogle(setting: any, order: any, gclid: string): Promise<string> {
    const { account, secrets } = await this.accountSecrets(setting.organizationId, setting.adAccountId);
    const customerId = String(account.externalId).replace(/-/g, "");
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: secrets.clientId, client_secret: secrets.clientSecret, refresh_token: secrets.refreshToken, grant_type: "refresh_token" }).toString(),
    });
    const tokenJson: any = await tokenRes.json().catch(() => null);
    if (!tokenRes.ok || !tokenJson?.access_token) throw new Error(`Google OAuth failed (${tokenRes.status})`);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${tokenJson.access_token}`,
      "developer-token": secrets.developerToken,
      "Content-Type": "application/json",
      ...(secrets.loginCustomerId ? { "login-customer-id": String(secrets.loginCustomerId).replace(/-/g, "") } : {}),
    };
    const res = await fetch(`https://googleads.googleapis.com/v17/customers/${customerId}/conversionUploads:uploadClickConversions`, {
      method: "POST", headers,
      body: JSON.stringify({
        conversions: [{
          conversionAction: `customers/${customerId}/conversionActions/${setting.conversionAction}`,
          gclid,
          conversionDateTime: googleDateTime(new Date(order.createdAt)),
          conversionValue: Number(BigInt(order.totalMinor ?? 0)) / 100,
          currencyCode: order.currency ?? "BDT",
        }],
        partialFailure: true,
      }),
    });
    const json: any = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json?.error?.message ?? `Google upload failed (${res.status})`);
    if (json?.partialFailureError) throw new Error(`Google partial failure: ${json.partialFailureError.message ?? "unknown"}`);
    const result = json?.results?.[0];
    if (!result?.gclid) throw new Error("Google returned no confirmed result row for this conversion");
    return `google confirmed gclid ${result.gclid}`;
  }

  private async sendTiktok(setting: any, order: any, ttclid: string, eventId: string): Promise<string> {
    const { secrets } = await this.accountSecrets(setting.organizationId, setting.adAccountId);
    const res = await fetch("https://business-api.tiktok.com/open_api/v1.3/event/track/", {
      method: "POST",
      headers: { "Access-Token": secrets.accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        event_source: "web",
        event_source_id: setting.pixelCode,
        data: [{
          event: "CompletePayment",
          event_time: Math.floor(new Date(order.createdAt).getTime() / 1000),
          event_id: eventId,
          context: { ad: { callback: ttclid } },
          properties: {
            value: Number(BigInt(order.totalMinor ?? 0)) / 100,
            currency: order.currency ?? "BDT",
            order_id: String(order.externalNumber ?? order.id),
          },
        }],
      }),
    });
    const json: any = await res.json().catch(() => null);
    if (!res.ok || json?.code !== 0) throw new Error(json?.message ?? `TikTok Events API failed (${res.status})`);
    return "tiktok confirmed (code 0)";
  }

  /** CN14: one event to a Meta dataset through the
   *  EXISTING Conversions API client (an event counts as
   *  sent only when Meta answers events_received >= 1 —
   *  the client throws otherwise). The token is the Meta
   *  ad account's own integration token. */
  private async sendMetaEvent(setting: any, datasetId: string, event: any): Promise<string> {
    const { secrets } = await this.accountSecrets(setting.organizationId, setting.adAccountId);
    const token = secrets?.accessToken;
    if (!token) throw new Error("the Meta ad account's integration has no access token — reconnect Meta Ads");
    const out = await new MetaCapiClient(String(token)).sendEvents(datasetId, [event]);
    return `meta confirmed events_received ${out.eventsReceived}${out.fbtraceId ? ` (fbtrace ${out.fbtraceId})` : ""}`;
  }

  /** CN14: the Meta order upload. Dedup order: this
   *  surface's own log (checked by the caller) → the
   *  Conversions API's log for the SAME dataset + SAME
   *  event_id (already delivered = skip, named) → send.
   *  The event_id is deterministic (`purchase-{orderKey}`,
   *  shared with ConversionsService by construction) and
   *  the log detail says so — Meta also dedupes on
   *  event_id server-side, but we never rely on that
   *  alone to avoid a double send. */
  private async uploadMetaForOrder(organizationId: string, order: any, setting: any, eventId: string) {
    const datasetId = setting.datasetId?.trim();
    if (!datasetId) {
      return this.recordLog(organizationId, "meta", eventId, order.id, "skipped", "the meta offline setting has no datasetId — set the dataset (pixel) id on the setting first");
    }
    const capiSetting = await (this.prisma as any).conversionApiSetting?.findFirst?.({ where: { organizationId } }).catch(() => null);
    if (capiSetting?.pixelId && String(capiSetting.pixelId) === datasetId) {
      const delivered = await (this.prisma as any).conversionEventLog?.findFirst?.({ where: { organizationId, eventId, status: "sent" } }).catch(() => null);
      if (delivered) {
        return this.recordLog(organizationId, "meta", eventId, order.id, "skipped", `already delivered to dataset ${datasetId} by the Conversions API under the same event_id (${eventId}) — not sent twice`);
      }
    }
    const customer = order.customerId
      ? await (this.prisma as any).customer.findFirst({ where: { id: order.customerId, organizationId } }).catch(() => null)
      : null;
    const userData: Record<string, unknown> = {};
    const em = hashEmail(customer?.email); if (em) userData.em = [em];
    const ph = hashPhone(customer?.phone); if (ph) userData.ph = [ph];
    if (customer?.id) userData.external_id = [createHash("sha256").update(String(customer.id)).digest("hex")];
    if (!Object.keys(userData).length) {
      return this.recordLog(organizationId, "meta", eventId, order.id, "skipped", "no customer email or phone on this order — Meta has nothing to match an offline event to, so nothing was sent");
    }
    const items = await (this.prisma as any).orderItem?.findMany?.({ where: { orderId: order.id }, take: 50 }).catch(() => []) ?? [];
    const key = order.externalNumber ?? order.externalId ?? order.id;
    const event = {
      event_name: "Purchase",
      event_time: Math.floor(new Date(order.placedAt ?? order.createdAt).getTime() / 1000),
      event_id: eventId,
      action_source: "system_generated",
      user_data: userData,
      custom_data: {
        currency: order.currency ?? "BDT",
        value: Number(BigInt(order.totalMinor ?? 0)) / 100,
        order_id: String(key),
        num_items: (items as any[]).reduce((s: number, i: any) => s + (i.quantity ?? 1), 0),
        content_ids: (items as any[]).map((i: any) => i.sku ?? i.name).filter(Boolean).slice(0, 50),
        content_type: "product",
      },
    };
    try {
      const detail = await this.sendMetaEvent(setting, datasetId, event);
      return await this.recordLog(organizationId, "meta", eventId, order.id, "sent", `${detail}; event_id ${eventId} is the deterministic order-derived id shared with the Conversions API`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "upload failed";
      await this.recordLog(organizationId, "meta", eventId, order.id, "failed", message).catch(() => undefined);
      throw new BadRequestException(`meta upload did NOT confirm: ${message}`);
    }
  }

  /** CN14 lead quality feedback (Meta's Conversion Leads
   *  payload specification, developers.facebook.com):
   *  a CRM stage event to the org's dataset —
   *  event_name = the CRM stage (the spec's free-form
   *  stage field), action_source "system_generated",
   *  user_data carrying the lead's Meta leadgen id
   *  (lead_id; hashed email/phone alongside when known),
   *  custom_data with the two REQUIRED fields
   *  lead_event_source + event_source "crm".
   *  Gates, all required: the meta offline setting exists,
   *  is enabled, has leadFeedbackEnabled AND a datasetId;
   *  the lead is a Meta lead-ads lead (only those carry a
   *  lead_id Meta recognises). Best-effort by design: the
   *  CRM stage change has already succeeded; every outcome
   *  lands in OfflineConversionLog and nothing here throws. */
  async sendLeadFeedback(organizationId?: string, leadId?: string, stage?: string) {
    if (!organizationId || !leadId || !stage) return;
    if (!["qualified", "won"].includes(stage)) return;
    if (!(await orgFlagEnabled(this.prisma as any, organizationId, "offline_conversions").catch(() => false))) return;
    const setting = await (this.prisma as any).offlineConversionSetting.findFirst({ where: { organizationId, platform: "meta" } }).catch(() => null);
    if (!setting?.enabled || !setting.leadFeedbackEnabled) return;
    const datasetId = setting.datasetId?.trim();
    if (!datasetId) return;
    const lead = await (this.prisma as any).lead.findFirst({ where: { id: leadId, organizationId } }).catch(() => null);
    if (!lead || lead.source !== "facebook_lead_ads") return;
    const eventId = `lead-feedback-${lead.id}-${stage}`;
    const prior = await (this.prisma as any).offlineConversionLog.findFirst({ where: { organizationId, platform: "meta", eventId } }).catch(() => null);
    if (prior?.status === "sent") return;
    const userData: Record<string, unknown> = {};
    const leadgenId = lead.externalId ? String(lead.externalId) : "";
    // The spec's example carries lead_id as a JSON number;
    // ids up to 16 digits are exactly representable. A
    // longer id goes as a string rather than a rounded
    // number — never a corrupted id.
    if (/^\d{1,16}$/.test(leadgenId)) userData.lead_id = Number(leadgenId);
    else if (leadgenId) userData.lead_id = leadgenId;
    const em = hashEmail(lead.email); if (em) userData.em = [em];
    const ph = hashPhone(lead.phone); if (ph) userData.ph = [ph];
    if (!Object.keys(userData).length) {
      await this.recordLog(organizationId, "meta", eventId, null, "skipped", `lead ${lead.id} stage "${stage}": no lead_id or hashed email/phone to match on — nothing sent`).catch(() => undefined);
      return;
    }
    const event = {
      event_name: stage,
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: "system_generated",
      user_data: userData,
      custom_data: { lead_event_source: "Qosprey CRM", event_source: "crm", lead_stage: stage },
    };
    try {
      const detail = await this.sendMetaEvent(setting, datasetId, event);
      await this.recordLog(organizationId, "meta", eventId, null, "sent", `lead ${lead.id} stage "${stage}" → dataset ${datasetId}: ${detail}`);
    } catch (e) {
      await this.recordLog(organizationId, "meta", eventId, null, "failed", e instanceof Error ? e.message : "lead feedback failed").catch(() => undefined);
    }
  }

  /** Backfill recent orders (respecting dedupe + skips). */
  async uploadRecent(organizationId: string, platform: "google" | "tiktok" | "meta", days = 30) {
    const since = new Date(Date.now() - Math.min(90, Math.max(1, days)) * 86400000);
    const orders = await (this.prisma as any).order.findMany({
      where: { organizationId, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 100,
    });
    let sent = 0, skipped = 0, failed = 0;
    for (const order of orders as any[]) {
      try {
        const log = await this.uploadForOrder(organizationId, order.id, platform);
        if ((log as any).status === "sent") sent++;
        else if ((log as any).status === "skipped") skipped++;
      } catch { failed++; }
    }
    return { examined: orders.length, sent, skipped, failed };
  }
}
