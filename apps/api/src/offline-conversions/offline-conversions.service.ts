import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EventsService } from "../common/events.service";
import { decryptJson } from "../integrations/crypto";

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
    }
  }

  async getSettings(organizationId: string) {
    const rows = await (this.prisma as any).offlineConversionSetting.findMany({ where: { organizationId } });
    return rows;
  }

  async saveSetting(organizationId: string, actorId: string, platform: string, dto: {
    adAccountId: string; conversionAction?: string; pixelCode?: string; trigger?: string; enabled?: boolean;
  }) {
    if (!["google", "tiktok"].includes(platform)) throw new BadRequestException("platform must be google or tiktok");
    const account = await (this.prisma as any).adAccount.findFirst({ where: { id: dto.adAccountId, organizationId } });
    if (!account) throw new NotFoundException("Ad account not found");
    if (account.platform !== platform) throw new BadRequestException(`That ad account is a ${account.platform} account, not ${platform}`);
    if (platform === "google" && !dto.conversionAction?.trim()) throw new BadRequestException("Google needs the offline conversion action id (from Google Ads > Goals > Conversions)");
    if (platform === "tiktok" && !dto.pixelCode?.trim()) throw new BadRequestException("TikTok needs the Events API pixel code");
    if (dto.trigger && !(TRIGGERS as readonly string[]).includes(dto.trigger)) throw new BadRequestException("Invalid trigger");
    const existing = await (this.prisma as any).offlineConversionSetting.findFirst({ where: { organizationId, platform } });
    const data = {
      organizationId, platform, adAccountId: dto.adAccountId,
      conversionAction: dto.conversionAction?.trim() ?? null,
      pixelCode: dto.pixelCode?.trim() ?? null,
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
    for (const platform of ["google", "tiktok"] as const) {
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

  private async recordLog(organizationId: string, platform: string, eventId: string, orderId: string, status: string, detail?: string) {
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

  async uploadForOrder(organizationId: string, orderId: string, platform: "google" | "tiktok") {
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

  /** Backfill recent orders (respecting dedupe + skips). */
  async uploadRecent(organizationId: string, platform: "google" | "tiktok", days = 30) {
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
