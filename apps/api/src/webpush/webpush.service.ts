import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import * as webpush from "web-push";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { seal, unseal } from "../common/platform-config";
import type {
  CreatePushCampaignDto,
  PushSendDto,
  PushSubscribeDto,
  PushUnsubscribeDto,
  UpdatePushSettingDto,
} from "./webpush.dto";

/**
 * AB7 (AX16) — Web Push for shop visitors.
 *
 * VAPID discipline: the org's keypair is generated ONCE, the
 * first time the merchant enables push. The public key is stored
 * plain (it is public — the shop page hands it to browsers); the
 * private key is stored SEALED (common/platform-config seal) and
 * never leaves the server or appears in any API response.
 * Re-enabling NEVER regenerates: regenerating would orphan every
 * subscription captured under the old keypair.
 *
 * Send discipline: counts are the push service's real outcomes
 * (per-subscription WebPushDelivery rows). A 404/410 from the push
 * service marks the subscription "gone" (never retried, never
 * deleted — delivery history references the row). One bad
 * subscription never aborts a batch.
 *
 * Fan-out is chunked: a campaign send attempts at most
 * INLINE_CHUNK subscriptions inline; the rest stay "queued"
 * (queuedCount) for the web_push_sweep job, which drains via the
 * same drainCampaign() used here.
 */
export const WEBPUSH_INLINE_CHUNK = 500;
export const WEBPUSH_SWEEP_CAMPAIGNS_PER_RUN = 5;

@Injectable()
export class WebPushService {
  private readonly logger = new Logger(WebPushService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private t(name: string): any {
    return (this.prisma as any)[name];
  }

  private async safeAudit(input: Parameters<AuditService["log"]>[0]): Promise<void> {
    try {
      await this.audit?.log(input);
    } catch {
      /* audit is best-effort, like the neighbouring services */
    }
  }

  private vapidSubject(): string {
    return process.env.WEB_PUSH_SUBJECT ?? "https://app.qosprey.com";
  }

  // ================= Settings (staff) =================

  private async findSetting(orgId: string): Promise<any | null> {
    return this.t("shopPushSetting").findFirst({ where: { organizationId: orgId } }).catch(() => null);
  }

  private async settingView(orgId: string, setting: any | null) {
    const [subscriberCount, testDeviceCount] = await Promise.all([
      this.t("webPushSubscription").count({ where: { organizationId: orgId, status: "active" } }).catch(() => 0),
      this.t("webPushSubscription").count({ where: { organizationId: orgId, status: "active", isTestDevice: true } }).catch(() => 0),
    ]);
    return {
      enabled: setting?.enabled === true,
      promptDelaySec: setting?.promptDelaySec ?? 20,
      hasKeys: Boolean(setting?.vapidPublicKey && setting?.vapidPrivateKeySealed),
      vapidPublicKey: setting?.vapidPublicKey ?? null,
      subscriberCount,
      testDeviceCount,
    };
  }

  async getSetting(orgId: string) {
    return this.settingView(orgId, await this.findSetting(orgId));
  }

  async updateSetting(orgId: string, actorId: string, dto: UpdatePushSettingDto) {
    if (dto.promptDelaySec !== undefined) {
      if (!Number.isInteger(dto.promptDelaySec) || dto.promptDelaySec < 5 || dto.promptDelaySec > 300) {
        throw new BadRequestException("প্রম্পট দেখানোর বিলম্ব ৫ থেকে ৩০০ সেকেন্ডের মধ্যে হতে হবে");
      }
    }
    const existing = await this.findSetting(orgId);
    const data: Record<string, unknown> = {};
    if (dto.promptDelaySec !== undefined) data.promptDelaySec = dto.promptDelaySec;
    let keysGenerated = false;
    if (dto.enabled !== undefined) {
      data.enabled = dto.enabled === true;
      if (dto.enabled === true && !(existing?.vapidPublicKey && existing?.vapidPrivateKeySealed)) {
        // First enable: generate the ONE keypair for this org.
        const keys = webpush.generateVAPIDKeys();
        data.vapidPublicKey = keys.publicKey;
        data.vapidPrivateKeySealed = seal(keys.privateKey);
        keysGenerated = true;
      }
    }
    let row: any;
    if (existing) {
      row = await this.t("shopPushSetting").update({ where: { id: existing.id }, data });
    } else {
      row = await this.t("shopPushSetting").create({
        data: { organizationId: orgId, enabled: false, promptDelaySec: 20, ...data },
      });
    }
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "webpush.setting_updated",
      entityType: "ShopPushSetting", entityId: row?.id ?? orgId,
      metadata: { enabled: data.enabled ?? existing?.enabled ?? false, promptDelaySec: data.promptDelaySec ?? row?.promptDelaySec ?? null, keysGenerated },
    });
    return this.settingView(orgId, row);
  }

  // ================= Public (shop visitors) =================

  private async findOrgBySlug(orgSlug: string): Promise<any | null> {
    if (!orgSlug) return null;
    return this.t("organization").findFirst({ where: { slug: orgSlug } });
  }

  private async requireOrgBySlug(orgSlug: string): Promise<any> {
    const org = await this.findOrgBySlug(orgSlug);
    if (!org) throw new NotFoundException("দোকানটি পাওয়া যায়নি");
    return org;
  }

  async publicConfig(orgSlug: string) {
    const org = await this.requireOrgBySlug(orgSlug);
    const setting = await this.findSetting(org.id);
    const enabled = setting?.enabled === true;
    return {
      enabled,
      // The public key is only handed out while push is on —
      // a disabled shop must not prompt or subscribe anyone.
      publicKey: enabled ? (setting?.vapidPublicKey ?? null) : null,
      promptDelaySec: setting?.promptDelaySec ?? 20,
    };
  }

  /** Shared subscription payload validation (public subscribe +
   * staff test-device registration). */
  private validateSubscription(dto: PushSubscribeDto): { endpoint: string; p256dh: string; auth: string } {
    const endpoint = typeof dto?.endpoint === "string" ? dto.endpoint.trim() : "";
    if (!endpoint || endpoint.length > 1000) {
      throw new BadRequestException("সাবস্ক্রিপশনের endpoint সঠিক নয়");
    }
    let parsed: URL;
    try {
      parsed = new URL(endpoint);
    } catch {
      throw new BadRequestException("সাবস্ক্রিপশনের endpoint সঠিক নয়");
    }
    if (parsed.protocol !== "https:") {
      throw new BadRequestException("সাবস্ক্রিপশনের endpoint অবশ্যই https হতে হবে");
    }
    const p256dh = typeof dto?.keys?.p256dh === "string" ? dto.keys.p256dh.trim() : "";
    const auth = typeof dto?.keys?.auth === "string" ? dto.keys.auth.trim() : "";
    if (!p256dh || p256dh.length > 512 || !auth || auth.length > 512) {
      throw new BadRequestException("সাবস্ক্রিপশনের keys সঠিক নয়");
    }
    return { endpoint, p256dh, auth };
  }

  /** Upsert by (organizationId, endpoint) — the schema unique.
   * Re-subscribing refreshes keys / UA / lastSeenAt and flips a
   * "gone" row back to active (the browser re-granted it). */
  private async upsertSubscription(orgId: string, input: {
    endpoint: string; p256dh: string; auth: string;
    customerId?: string | null; customerIdProvided?: boolean;
    userAgent?: string | null; isTestDevice?: boolean;
  }) {
    const existing = await this.t("webPushSubscription").findFirst({
      where: { organizationId: orgId, endpoint: input.endpoint },
    });
    const userAgent = input.userAgent ? String(input.userAgent).slice(0, 500) : (existing?.userAgent ?? null);
    if (existing) {
      return this.t("webPushSubscription").update({
        where: { id: existing.id },
        data: {
          p256dh: input.p256dh, auth: input.auth,
          customerId: input.customerIdProvided ? (input.customerId ?? null) : (existing.customerId ?? null),
          userAgent, status: "active", lastSeenAt: new Date(),
          ...(input.isTestDevice !== undefined ? { isTestDevice: input.isTestDevice } : {}),
        },
      });
    }
    return this.t("webPushSubscription").create({
      data: {
        organizationId: orgId, endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth,
        customerId: input.customerId ?? null, userAgent,
        isTestDevice: input.isTestDevice === true, status: "active", lastSeenAt: new Date(),
      },
    });
  }

  async subscribe(orgSlug: string, dto: PushSubscribeDto, userAgent?: string) {
    const org = await this.requireOrgBySlug(orgSlug);
    const setting = await this.findSetting(org.id);
    if (setting?.enabled !== true) {
      throw new ForbiddenException("এই দোকানে ওয়েব পুশ এখন চালু নেই");
    }
    const sub = this.validateSubscription(dto);
    // A customerId only sticks when the customer really belongs
    // to this org; a foreign/stale id is dropped to null rather
    // than failing the visitor's subscribe.
    let customerId: string | null = null;
    if (dto.customerId) {
      const customer = await this.t("customer").findFirst({
        where: { id: dto.customerId, organizationId: org.id },
      }).catch(() => null);
      customerId = customer ? customer.id : null;
    }
    return this.upsertSubscription(org.id, {
      ...sub, customerId, customerIdProvided: dto.customerId !== undefined,
      userAgent: userAgent ?? null,
    });
  }

  async unsubscribe(orgSlug: string, dto: PushUnsubscribeDto) {
    const org = await this.requireOrgBySlug(orgSlug);
    const endpoint = typeof dto?.endpoint === "string" ? dto.endpoint.trim() : "";
    if (!endpoint) throw new BadRequestException("সাবস্ক্রিপশনের endpoint সঠিক নয়");
    const existing = await this.t("webPushSubscription").findFirst({
      where: { organizationId: org.id, endpoint },
    });
    if (existing && existing.status !== "gone") {
      // Never delete: WebPushDelivery rows reference this row.
      await this.t("webPushSubscription").update({ where: { id: existing.id }, data: { status: "gone" } });
      return { ok: true, updated: true };
    }
    return { ok: true, updated: false };
  }

  // ================= Test devices (staff) =================

  async registerTestDevice(orgId: string, actorId: string, dto: PushSubscribeDto) {
    const sub = this.validateSubscription(dto);
    const row = await this.upsertSubscription(orgId, { ...sub, isTestDevice: true });
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "webpush.test_device_registered",
      entityType: "WebPushSubscription", entityId: row?.id ?? null, metadata: {},
    });
    return row;
  }

  // ================= Sending =================

  private validateSend(dto: PushSendDto): { title: string; body: string; url: string | null } {
    const title = typeof dto?.title === "string" ? dto.title.trim() : "";
    const body = typeof dto?.body === "string" ? dto.body.trim() : "";
    if (!title || title.length > 120) throw new BadRequestException("পুশের শিরোনাম আবশ্যক এবং সর্বোচ্চ ১২০ অক্ষরের হতে হবে");
    if (!body || body.length > 300) throw new BadRequestException("পুশের বার্তা আবশ্যক এবং সর্বোচ্চ ৩০০ অক্ষরের হতে হবে");
    let url: string | null = null;
    if (dto?.url !== undefined && dto.url !== null && String(dto.url).trim() !== "") {
      const raw = String(dto.url).trim();
      // v1 strict: shop-relative paths only. Absolute/external
      // URLs are refused so a campaign can never push visitors
      // off the shop's own pages.
      if (!raw.startsWith("/") || raw.startsWith("//") || raw.length > 500) {
        throw new BadRequestException("পুশের লিংক অবশ্যই দোকানের নিজের পেজের হতে হবে (যেমন /sale) — বাইরের লিংক দেওয়া যাবে না");
      }
      url = raw;
    }
    return { title, body, url };
  }

  private requireKeys(setting: any): { publicKey: string; privateKey: string } {
    const publicKey = setting?.vapidPublicKey ? String(setting.vapidPublicKey) : "";
    const privateKey = unseal(setting?.vapidPrivateKeySealed);
    if (!publicKey || !privateKey) {
      throw new BadRequestException("ওয়েব পুশের VAPID key এখনো তৈরি হয়নি — আগে সেটিংসে পুশ চালু করুন");
    }
    return { publicKey, privateKey };
  }

  /** Attempt delivery to the given subscriptions, writing one
   * WebPushDelivery per attempt. Never throws per-subscription:
   * 404/410 → subscription + delivery "gone"; anything else →
   * delivery "failed" with the (capped) provider error. */
  private async deliverTo(setting: any, campaign: any, subs: any[]): Promise<void> {
    if (subs.length === 0) return;
    const { publicKey, privateKey } = this.requireKeys(setting);
    webpush.setVapidDetails(this.vapidSubject(), publicKey, privateKey);
    const payload = JSON.stringify({ title: campaign.title, body: campaign.body, url: campaign.url ?? null });
    for (const sub of subs) {
      try {
        const result: any = await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: 86400 },
        );
        await this.t("webPushDelivery").create({
          data: {
            campaignId: campaign.id, subscriptionId: sub.id, status: "sent",
            statusCode: typeof result?.statusCode === "number" ? result.statusCode : null,
          },
        }).catch(() => undefined);
      } catch (e) {
        const statusCode = typeof (e as any)?.statusCode === "number" ? (e as any).statusCode : null;
        const message = (e instanceof Error ? e.message : String(e ?? "send failed")).slice(0, 300);
        if (statusCode === 404 || statusCode === 410) {
          await this.t("webPushSubscription").update({
            where: { id: sub.id }, data: { status: "gone" },
          }).catch(() => undefined);
          await this.t("webPushDelivery").create({
            data: { campaignId: campaign.id, subscriptionId: sub.id, status: "gone", statusCode, error: message },
          }).catch(() => undefined);
        } else {
          await this.t("webPushDelivery").create({
            data: { campaignId: campaign.id, subscriptionId: sub.id, status: "failed", statusCode, error: message },
          }).catch(() => undefined);
        }
      }
    }
  }

  /** Recompute a campaign's honest counts from its delivery rows.
   * queuedCount = pool subscriptions still without a delivery row
   * (pool "all" = every active subscription of the org; pool
   * "test" = the campaign already reached every test device, so
   * nothing is queued — test campaigns are born done and the
   * sweep must never widen them to real subscribers). */
  private async finalizeCampaign(orgId: string, campaign: any, pool: "all" | "test") {
    const deliveries = await this.t("webPushDelivery").findMany({ where: { campaignId: campaign.id } });
    const tally = { sent: 0, failed: 0, gone: 0 };
    const deliveredIds = new Set<string>();
    for (const d of deliveries as any[]) {
      deliveredIds.add(d.subscriptionId);
      if (d.status === "sent") tally.sent++;
      else if (d.status === "gone") tally.gone++;
      else tally.failed++;
    }
    let queuedCount = 0;
    if (pool === "all") {
      const active = await this.t("webPushSubscription").findMany({
        where: { organizationId: orgId, status: "active" },
      });
      queuedCount = (active as any[]).filter((s) => !deliveredIds.has(s.id)).length;
    }
    const status = queuedCount > 0 ? "queued" : "done";
    const updated = await this.t("webPushCampaign").update({
      where: { id: campaign.id },
      data: { sentCount: tally.sent, failedCount: tally.failed, goneCount: tally.gone, queuedCount, status },
    }).catch(() => null);
    return updated ?? { ...campaign, sentCount: tally.sent, failedCount: tally.failed, goneCount: tally.gone, queuedCount, status };
  }

  /**
   * Send a campaign chunk: active subscriptions of the org that
   * have NO delivery row for this campaign yet, oldest first, up
   * to chunkSize. Reused by the create path (inline chunk) and by
   * the web_push_sweep job (drain of the queued remainder).
   */
  async drainCampaign(orgId: string, campaign: any, chunkSize = WEBPUSH_INLINE_CHUNK) {
    if (!campaign || campaign.status === "done") return campaign;
    const setting = await this.findSetting(orgId);
    if (!setting?.vapidPublicKey || !setting?.vapidPrivateKeySealed) return campaign;
    const deliveries = await this.t("webPushDelivery").findMany({ where: { campaignId: campaign.id } });
    const deliveredIds = new Set((deliveries as any[]).map((d) => d.subscriptionId));
    const active = await this.t("webPushSubscription").findMany({
      where: { organizationId: orgId, status: "active" },
      orderBy: { createdAt: "asc" },
    });
    const targets = (active as any[])
      .filter((s) => !deliveredIds.has(s.id))
      .slice(0, Math.max(0, chunkSize));
    if (targets.length > 0) {
      await this.t("webPushCampaign").update({
        where: { id: campaign.id }, data: { status: "sending" },
      }).catch(() => undefined);
      await this.deliverTo(setting, campaign, targets);
    }
    return this.finalizeCampaign(orgId, campaign, "all");
  }

  /** web_push_sweep job body: drain the org's queued campaigns,
   * oldest first, at most 5 campaigns × 500 deliveries per run. */
  async runWebPushSweep(orgId: string) {
    const campaigns = await this.t("webPushCampaign").findMany({
      where: { organizationId: orgId, status: "queued" },
      orderBy: { createdAt: "asc" },
      take: WEBPUSH_SWEEP_CAMPAIGNS_PER_RUN,
    });
    const drained: any[] = [];
    for (const campaign of campaigns as any[]) {
      const updated = await this.drainCampaign(orgId, campaign, WEBPUSH_INLINE_CHUNK);
      drained.push({
        campaignId: campaign.id, status: updated?.status ?? campaign.status,
        sentCount: updated?.sentCount ?? 0, failedCount: updated?.failedCount ?? 0,
        goneCount: updated?.goneCount ?? 0, queuedCount: updated?.queuedCount ?? 0,
      });
    }
    return { campaigns: drained.length, drained };
  }

  // ================= Campaigns (staff) =================

  async createCampaign(orgId: string, actorId: string, dto: CreatePushCampaignDto) {
    const send = this.validateSend(dto);
    const setting = await this.findSetting(orgId);
    if (setting?.enabled !== true) {
      throw new BadRequestException("ওয়েব পুশ চালু না থাকলে ক্যাম্পেইন পাঠানো যাবে না — আগে সেটিংসে পুশ চালু করুন");
    }
    this.requireKeys(setting);
    const campaign = await this.t("webPushCampaign").create({
      data: {
        organizationId: orgId, title: send.title, body: send.body, url: send.url,
        createdById: actorId, status: "queued",
        queuedCount: 0, sentCount: 0, failedCount: 0, goneCount: 0,
      },
    });
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "webpush.campaign_created",
      entityType: "WebPushCampaign", entityId: campaign.id,
      metadata: { title: send.title, url: send.url },
    });
    // Inline chunk now; any remainder stays queued for the sweep.
    return this.drainCampaign(orgId, campaign, WEBPUSH_INLINE_CHUNK);
  }

  /** Test send: a real campaign row (same delivery accounting),
   * but its audience is ONLY the org's active test devices. It
   * does not require `enabled` — testing before going live is
   * the point — but it does require the generated keypair. The
   * campaign is finalized against the test pool, so it is born
   * "done" and the sweep never widens it to real subscribers. */
  async testSend(orgId: string, actorId: string, dto: PushSendDto) {
    const send = this.validateSend(dto);
    const setting = await this.findSetting(orgId);
    this.requireKeys(setting);
    const campaign = await this.t("webPushCampaign").create({
      data: {
        organizationId: orgId, title: send.title, body: send.body, url: send.url,
        createdById: actorId, status: "queued",
        queuedCount: 0, sentCount: 0, failedCount: 0, goneCount: 0,
      },
    });
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "webpush.test_sent",
      entityType: "WebPushCampaign", entityId: campaign.id,
      metadata: { title: send.title, url: send.url },
    });
    const devices = await this.t("webPushSubscription").findMany({
      where: { organizationId: orgId, status: "active", isTestDevice: true },
      orderBy: { createdAt: "asc" },
    });
    await this.deliverTo(setting, campaign, devices as any[]);
    return this.finalizeCampaign(orgId, campaign, "test");
  }

  async listCampaigns(orgId: string) {
    return this.t("webPushCampaign").findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async getCampaign(orgId: string, campaignId: string) {
    const campaign = await this.t("webPushCampaign").findFirst({
      where: { id: campaignId, organizationId: orgId },
    });
    if (!campaign) throw new NotFoundException("পুশ ক্যাম্পেইনটি পাওয়া যায়নি");
    const deliveries = await this.t("webPushDelivery").findMany({ where: { campaignId: campaign.id } });
    const deliverySummary = { sent: 0, failed: 0, gone: 0, total: 0 };
    for (const d of deliveries as any[]) {
      deliverySummary.total++;
      if (d.status === "sent") deliverySummary.sent++;
      else if (d.status === "gone") deliverySummary.gone++;
      else if (d.status === "failed") deliverySummary.failed++;
    }
    return { ...campaign, deliverySummary };
  }
}
