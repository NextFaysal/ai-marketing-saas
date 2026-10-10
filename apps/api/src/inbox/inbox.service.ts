import { ensurePlatformConfig, getPlatformConfigSync, resolveMessagingAppSecret } from "../common/platform-config";
import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { encryptJson, decryptJson } from "../integrations/crypto";
import { MetaMessagingClient, MessagingSecrets } from "./meta-messaging.client";
import { WooClient } from "../integrations/woocommerce/woo.client";
import { randomUUID } from "crypto";
import { parseMetaWebhook } from "./webhook.parser";
import { LlmFactory } from "../ai/llm/llm.factory";
import { EventsService } from "../common/events.service";
import { classifyIntent, parseCodReply, type Classification } from "./intent";
import { extractPaymentScreenshot, transcribeAudio } from "./media-intelligence";
import { formatMinor } from "@repo/contracts";

const STATUS_RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3 };

export function verifyMetaSignature(rawBody: string, appSecret: string, header: string | undefined): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header.slice("sha256=".length));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10); // compare on last 10 digits (local part)
}

@Injectable()
export class InboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly llm: LlmFactory,
    @Optional() private readonly events?: EventsService,
  ) {}

  // ----- Connection management -----
  async connectMessaging(organizationId: string, actorId: string, dto: {
    channel: string; accessToken: string; appSecret?: string; verifyToken: string;
    phoneNumberId?: string; pageId?: string;
  }) {
    if (!["whatsapp", "messenger", "instagram"].includes(dto.channel)) throw new BadRequestException("channel must be whatsapp, messenger or instagram");
    // The app secret may be omitted when the platform Meta app is
    // configured by the operator (Milestone 33): the tenant connects
    // under the platform app and webhook verification falls back to
    // the platform secret. With neither, connecting is refused —
    // an unverifiable webhook would be a silent security hole.
    if (!dto.appSecret) {
      await ensurePlatformConfig(this.prisma).catch(() => undefined);
      if (!getPlatformConfigSync().metaApp?.appSecret) {
        throw new BadRequestException("An app secret is required: provide your Meta app secret, or ask the platform admin to configure the platform Meta app in the Admin Console");
      }
    }
    if (dto.channel === "whatsapp" && !dto.phoneNumberId) throw new BadRequestException("phoneNumberId is required for WhatsApp");
    if (dto.channel === "instagram" && !dto.pageId) throw new BadRequestException("pageId (the Facebook Page linked to the Instagram account) is required for Instagram");
    const secrets: MessagingSecrets = {
      accessToken: dto.accessToken, appSecret: dto.appSecret ?? "", verifyToken: dto.verifyToken,
      phoneNumberId: dto.phoneNumberId, pageId: dto.pageId,
    };
    // Verify BEFORE saving anything - an unverified connection is never stored as connected.
    // Meta's rejection is surfaced as a 400 with Meta's own message —
    // never a bare 500 (live-verification find, Milestone 33).
    const me = await new MetaMessagingClient(secrets).verifyToken().catch((e) => {
      throw new BadRequestException(e instanceof Error ? e.message : "Meta token verification failed");
    });
    const integration = await (this.prisma as any).integration.create({
      data: {
        organizationId, provider: dto.channel, status: "CONNECTED",
        externalAccountId: dto.phoneNumberId ?? dto.pageId ?? me.id,
      },
    });
    await (this.prisma as any).integrationCredential.create({
      data: { integrationId: integration.id, encryptedData: encryptJson(secrets) },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "integration.messaging.connected", entityType: "Integration", entityId: integration.id, metadata: { channel: dto.channel } });
    return { id: integration.id, provider: integration.provider, status: integration.status, externalAccountId: integration.externalAccountId };
  }

  async listMessagingIntegrations(organizationId: string) {
    const items = await (this.prisma as any).integration.findMany({
      where: { organizationId, provider: { in: ["whatsapp", "messenger", "instagram"] } }, orderBy: { createdAt: "desc" },
    });
    // Secrets are never returned.
    return items.map((i: any) => ({ id: i.id, provider: i.provider, status: i.status, externalAccountId: i.externalAccountId, createdAt: i.createdAt, lastError: i.lastError }));
  }

  private async secretsFor(integrationId: string): Promise<MessagingSecrets> {
    const integration = await (this.prisma as any).integration.findUnique({ where: { id: integrationId }, include: { credential: true } });
    if (!integration?.credential) throw new BadRequestException("Messaging integration is not configured");
    return decryptJson<MessagingSecrets>(integration.credential.encryptedData);
  }

  private async integrationForConversation(conversation: any): Promise<{ id: string; provider: string }> {
    if (conversation.integrationId) {
      const i = await (this.prisma as any).integration.findUnique({ where: { id: conversation.integrationId } });
      if (i) return i;
    }
    const latest = await (this.prisma as any).integration.findFirst({
      where: { organizationId: conversation.organizationId, provider: conversation.channel, status: "CONNECTED" },
      orderBy: { createdAt: "desc" },
    });
    if (!latest) throw new BadRequestException(`No connected ${conversation.channel} integration for this organization`);
    return latest;
  }

  // ----- Webhooks -----
  async verifySubscription(integrationId: string, mode: string, token: string, challenge: string): Promise<string | null> {
    const integration = await (this.prisma as any).integration.findUnique({ where: { id: integrationId }, include: { credential: true } });
    if (!integration?.credential || !["whatsapp", "messenger", "instagram"].includes(integration.provider)) return null;
    const secrets = decryptJson<MessagingSecrets>(integration.credential.encryptedData);
    if (mode === "subscribe" && secrets.verifyToken && token === secrets.verifyToken) return challenge;
    return null;
  }

  async handleWebhook(integrationId: string, rawBody: string, signature: string | undefined): Promise<{ received: number; duplicates: number; statusesApplied: number; leadgenReceived: number }> {
    const integration = await (this.prisma as any).integration.findUnique({ where: { id: integrationId }, include: { credential: true } });
    if (!integration?.credential) throw new NotFoundException("Integration not found");
    const secrets = decryptJson<MessagingSecrets>(integration.credential.encryptedData);
    // The integration's own app secret wins; tenants connected
    // under the platform Meta app verify against the platform
    // secret the operator configured (Milestone 33).
    await ensurePlatformConfig(this.prisma).catch(() => undefined);
    const appSecret = resolveMessagingAppSecret(secrets.appSecret);
    if (!appSecret || !verifyMetaSignature(rawBody, appSecret, signature)) {
      throw new BadRequestException("Invalid webhook signature");
    }
    const payload = JSON.parse(rawBody);
    const parsed = parseMetaWebhook(payload);
    const organizationId: string = integration.organizationId;
    let received = 0, duplicates = 0, statusesApplied = 0;

    for (const event of parsed.messages) {
      const conversation = await this.findOrCreateConversation(organizationId, integration.id, event.channel, event.externalContactId, event.contactName);
      const existing = await (this.prisma as any).channelMessage.findFirst({
        where: { conversationId: conversation.id, externalId: event.externalId },
      });
      if (existing) { duplicates++; continue; }
      const stored = await (this.prisma as any).channelMessage.create({
        data: {
          conversationId: conversation.id, direction: "in", externalId: event.externalId,
          type: event.type, content: event.content ?? null, status: "received",
          mediaId: event.mediaId ?? null, mediaUrl: event.mediaUrl ?? null,
          referral: event.referral ?? undefined,
          platformTimestamp: event.timestamp,
        },
      });
      if (event.referral?.sourceId && !(conversation as any).ctwaSourceId) {
        await (this.prisma as any).channelConversation.update({
          where: { id: conversation.id }, data: { ctwaSourceId: event.referral.sourceId },
        }).catch(() => undefined);
      }
      await (this.prisma as any).channelConversation.update({
        where: { id: conversation.id },
        data: {
          unreadCount: { increment: 1 }, lastMessageAt: event.timestamp,
          lastCustomerMessageAt: event.timestamp,
          lastMessagePreview: (event.content ?? `[${event.type}]`).slice(0, 120), status: "open",
        },
      });
      received++;
      // Intelligence layer: classification, COD replies, workflow events,
      // grounded auto-reply. Each step is isolated - a failure here must
      // never lose the customer's message.
      await this.processInboundIntelligence(organizationId, conversation, stored, event).catch(() => undefined);
    }

    let leadgenReceived = 0;
    for (const lg of parsed.leadgens) {
      const created = await this.ingestLeadgen(organizationId, secrets.accessToken, lg).catch(() => false);
      if (created) leadgenReceived++;
    }

    for (const status of parsed.statuses) {
      const message = await (this.prisma as any).channelMessage.findFirst({
        where: { externalId: status.externalId, direction: "out", conversation: { organizationId } },
      });
      if (!message) continue;
      if (status.status === "failed") {
        await (this.prisma as any).channelMessage.update({ where: { id: message.id }, data: { status: "failed" } });
        statusesApplied++;
      } else if ((STATUS_RANK[status.status] ?? -1) > (STATUS_RANK[message.status] ?? -1)) {
        await (this.prisma as any).channelMessage.update({ where: { id: message.id }, data: { status: status.status } });
        statusesApplied++;
      }
    }
    return { received, duplicates, statusesApplied, leadgenReceived };
  }

  /** Meta Lead Ads: a leadgen webhook carries only an id; the actual
   * answers are fetched from the Graph API with the page token and
   * stored as a CRM Lead (idempotent on the leadgen id). Nothing is
   * created when the fetch fails — the webhook returns and Meta will
   * retry, or the owner can check the audit trail. */
  private async ingestLeadgen(organizationId: string, accessToken: string, lg: { leadgenId: string; formId?: string; adId?: string; campaignId?: string }): Promise<boolean> {
    const existing = await (this.prisma as any).lead.findFirst({
      where: { organizationId, source: "facebook_lead_ads", externalId: lg.leadgenId },
    });
    if (existing) return false;
    const { graphGet } = await import("../common/meta-graph");
    const data = await graphGet(accessToken, `/${lg.leadgenId}`, { fields: "field_data,ad_id,campaign_id,form_id,created_time" });
    const fields = new Map<string, string>();
    for (const f of data?.field_data ?? []) {
      if (f?.name) fields.set(String(f.name), Array.isArray(f.values) ? String(f.values[0] ?? "") : String(f.values ?? ""));
    }
    const name = fields.get("full_name") ?? fields.get("name")
      ?? [fields.get("first_name"), fields.get("last_name")].filter(Boolean).join(" ")
      ?? "Facebook Lead";
    const answers = [...fields.entries()].map(([k, v]) => `${k}: ${v}`).join(" | ");
    const lead = await (this.prisma as any).lead.create({
      data: {
        organizationId, name: name || "Facebook Lead",
        email: fields.get("email") ?? null, phone: fields.get("phone_number") ?? fields.get("phone") ?? null,
        source: "facebook_lead_ads", externalId: lg.leadgenId, stage: "new",
        notes: `Lead Ads form ${data?.form_id ?? lg.formId ?? ""}`.trim(),
      },
    });
    await (this.prisma as any).leadActivity.create({
      data: {
        leadId: lead.id, type: "lead_ads_form",
        content: `Facebook Lead Ads জমা: ${answers}${data?.ad_id ?? lg.adId ? ` | ad: ${data?.ad_id ?? lg.adId}` : ""}${data?.campaign_id ?? lg.campaignId ? ` | campaign: ${data?.campaign_id ?? lg.campaignId}` : ""}`,
      },
    }).catch(() => undefined);
    await this.audit.log({ organizationId, userId: "system", action: "lead.ads_ingested", entityType: "Lead", entityId: lead.id, metadata: { leadgenId: lg.leadgenId } }).catch(() => undefined);
    try { this.events?.emit("lead.created", { organizationId, context: { leadId: lead.id, source: "facebook_lead_ads" } }); } catch { /* never block ingest */ }
    return true;
  }

  private async findOrCreateConversation(organizationId: string, integrationId: string, channel: string, externalContactId: string, contactName?: string) {
    let conversation = await (this.prisma as any).channelConversation.findFirst({
      where: { organizationId, channel, externalContactId },
    });
    if (conversation) {
      if (contactName && !conversation.contactName) {
        conversation = await (this.prisma as any).channelConversation.update({ where: { id: conversation.id }, data: { contactName } });
      }
      return conversation;
    }
    const contactPhone = channel === "whatsapp" ? externalContactId : null;
    // Match an existing customer by phone (last-10-digits comparison).
    let customerId: string | null = null;
    if (contactPhone) {
      const customers = await (this.prisma as any).customer.findMany({
        where: { organizationId, phone: { not: null } }, take: 500, select: { id: true, phone: true },
      });
      const match = customers.find((c: any) => normalizePhone(c.phone) === normalizePhone(contactPhone));
      customerId = match?.id ?? null;
    }
    conversation = await (this.prisma as any).channelConversation.create({
      data: { organizationId, integrationId, channel, externalContactId, contactName: contactName ?? null, contactPhone, customerId },
    });
    if (!customerId) {
      // A brand-new contact becomes a lead so nothing falls through the cracks.
      const lead = await (this.prisma as any).lead.create({
        data: {
          organizationId, name: contactName ?? contactPhone ?? "Messenger user",
          phone: contactPhone, source: channel, stage: "new",
        },
      });
      await (this.prisma as any).leadActivity.create({
        data: { leadId: lead.id, type: "created", content: `Auto-created from first ${channel} message` },
      });
      conversation = await (this.prisma as any).channelConversation.update({
        where: { id: conversation.id }, data: { leadId: lead.id },
      });
    }
    if (!conversation.assignedUserId) {
      conversation = await this.maybeSmartAssign(organizationId, conversation).catch(() => conversation);
    }
    return conversation;
  }

  // ----- Inbox settings -----
  async getSettings(organizationId: string) {
    const row = await (this.prisma as any).inboxSetting.findUnique({ where: { organizationId } }).catch(() => null);
    return {
      organizationId,
      autoReplyMode: row?.autoReplyMode ?? "off",
      confidenceThreshold: row?.confidenceThreshold ?? 70,
      perIntent: row?.perIntent ?? {},
      smartAssign: row?.smartAssign ?? "off",
      slaFirstResponseMinutes: row?.slaFirstResponseMinutes ?? 60,
      botEnabled: row?.botEnabled ?? false,
      botDeliveryChargeMinor: row?.botDeliveryChargeMinor ?? null,
    };
  }

  async updateSettings(organizationId: string, actorId: string, dto: {
    autoReplyMode?: string; confidenceThreshold?: number; perIntent?: Record<string, string>;
    smartAssign?: string; slaFirstResponseMinutes?: number;
    botEnabled?: boolean; botDeliveryChargeMinor?: number | null;
  }) {
    const modes = ["off", "draft", "auto"];
    if (dto.autoReplyMode && !modes.includes(dto.autoReplyMode)) throw new BadRequestException("autoReplyMode must be off | draft | auto");
    if (dto.smartAssign && !["off", "round_robin", "least_busy"].includes(dto.smartAssign)) throw new BadRequestException("smartAssign must be off | round_robin | least_busy");
    if (dto.confidenceThreshold !== undefined && (dto.confidenceThreshold < 0 || dto.confidenceThreshold > 100)) throw new BadRequestException("confidenceThreshold must be 0..100");
    if (dto.perIntent) {
      for (const [intent, mode] of Object.entries(dto.perIntent)) {
        if (!["price", "stock", "delivery", "order_status", "payment", "complaint", "greeting", "order_intent", "other"].includes(intent)) throw new BadRequestException(`Unknown intent: ${intent}`);
        if (!modes.includes(mode)) throw new BadRequestException(`Invalid mode for ${intent}: ${mode}`);
      }
    }
    const data = {
      ...(dto.autoReplyMode ? { autoReplyMode: dto.autoReplyMode } : {}),
      ...(dto.confidenceThreshold !== undefined ? { confidenceThreshold: Math.round(dto.confidenceThreshold) } : {}),
      ...(dto.perIntent ? { perIntent: dto.perIntent } : {}),
      ...(dto.smartAssign ? { smartAssign: dto.smartAssign } : {}),
      ...(dto.slaFirstResponseMinutes !== undefined ? { slaFirstResponseMinutes: Math.max(1, Math.round(dto.slaFirstResponseMinutes)) } : {}),
      ...(dto.botEnabled !== undefined ? { botEnabled: Boolean(dto.botEnabled) } : {}),
      ...(dto.botDeliveryChargeMinor !== undefined ? { botDeliveryChargeMinor: dto.botDeliveryChargeMinor === null ? null : Math.max(0, Math.round(dto.botDeliveryChargeMinor)) } : {}),
    };
    const existing = await (this.prisma as any).inboxSetting.findUnique({ where: { organizationId } }).catch(() => null);
    const saved = existing
      ? await (this.prisma as any).inboxSetting.update({ where: { organizationId }, data })
      : await (this.prisma as any).inboxSetting.create({ data: { organizationId, ...data } });
    await this.audit.log({ organizationId, userId: actorId, action: "inbox.settings.updated", entityType: "InboxSetting", entityId: saved.id, metadata: data });
    return this.getSettings(organizationId);
  }

  /** Round-robin / least-busy assignment among support-capable members. */
  private async maybeSmartAssign(organizationId: string, conversation: any) {
    const settings = await this.getSettings(organizationId);
    if (settings.smartAssign === "off") return conversation;
    const memberships = await (this.prisma as any).membership.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" }, take: 100 });
    const eligible = memberships.filter((m: any) => ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"].includes(m.role));
    if (eligible.length === 0) return conversation;
    let chosen: any = eligible[0];
    if (settings.smartAssign === "round_robin") {
      const row = await (this.prisma as any).inboxSetting.findUnique({ where: { organizationId } }).catch(() => null);
      const idx = eligible.findIndex((m: any) => m.userId === row?.lastAssignedUserId);
      chosen = eligible[(idx + 1) % eligible.length];
      if (row) await (this.prisma as any).inboxSetting.update({ where: { organizationId }, data: { lastAssignedUserId: chosen.userId } });
      else await (this.prisma as any).inboxSetting.create({ data: { organizationId, smartAssign: settings.smartAssign, lastAssignedUserId: chosen.userId } });
    } else {
      const open = await (this.prisma as any).channelConversation.findMany({
        where: { organizationId, status: "open", assignedUserId: { in: eligible.map((m: any) => m.userId) } }, take: 1000,
      });
      const counts = new Map<string, number>(eligible.map((m: any) => [m.userId, 0]));
      for (const c of open) counts.set(c.assignedUserId, (counts.get(c.assignedUserId) ?? 0) + 1);
      chosen = [...eligible].sort((a: any, b: any) => (counts.get(a.userId) ?? 0) - (counts.get(b.userId) ?? 0))[0];
    }
    return (this.prisma as any).channelConversation.update({
      where: { id: conversation.id }, data: { assignedUserId: chosen.userId },
    });
  }

  // ----- Inbound intelligence -----
  /** Public entry for channels that ingest outside webhooks (webchat). */
  async ingestChatMessage(organizationId: string, conversationId: string, messageId: string) {
    const conversation = await (this.prisma as any).channelConversation.findFirst({ where: { id: conversationId, organizationId } });
    const message = await (this.prisma as any).channelMessage.findFirst({ where: { id: messageId, conversationId } });
    if (!conversation || !message) return;
    await this.processInboundIntelligence(organizationId, conversation, message, { content: message.content ?? "" }).catch(() => undefined);
  }

  private async processInboundIntelligence(organizationId: string, conversation: any, message: any, event: any) {
    const text: string = event.content ?? "";
    let classification: Classification = { intent: "other", confidence: 0, sentiment: null };
    if (text) {
      classification = classifyIntent(text);
      await (this.prisma as any).channelMessage.update({
        where: { id: message.id },
        data: { intent: classification.intent, intentConfidence: classification.confidence },
      }).catch(() => undefined);
      if (classification.sentiment === "negative") {
        await (this.prisma as any).channelConversation.update({
          where: { id: conversation.id }, data: { sentimentFlag: "negative", priority: "high" },
        }).catch(() => undefined);
        conversation = { ...conversation, sentimentFlag: "negative", priority: "high" };
        await this.notifyUrgent(organizationId, conversation).catch(() => undefined);
      }
    }

    // COD confirmation replies resolve BEFORE any auto-reply.
    const codHandled = text ? await this.handleCodReply(organizationId, conversation, text).catch(() => false) : false;
    const csatHandled = !codHandled && text ? await this.handleCsatReply(organizationId, conversation, text).catch(() => false) : false;
    const spam = text ? await this.detectSpam(organizationId, conversation, text).catch(() => false) : false;

    try {
      this.events?.emit("conversation.message_received", {
        organizationId,
        context: {
          conversationId: conversation.id, channel: conversation.channel,
          intent: classification.intent, intentConfidence: classification.confidence,
          sentiment: classification.sentiment, content: text,
          leadId: conversation.leadId ?? undefined, customerId: conversation.customerId ?? undefined,
          contactName: conversation.contactName ?? undefined, contactPhone: conversation.contactPhone ?? undefined,
        },
      });
    } catch { /* workflow failures never affect message ingest */ }

    const botHandled = !codHandled && !csatHandled && !spam && text
      ? await this.handleOrderBot(organizationId, conversation, text, classification).catch(() => false)
      : false;
    if (!codHandled && !csatHandled && !spam && !botHandled && text) {
      await this.maybeAutoReply(organizationId, conversation, classification, text).catch(() => undefined);
    }
  }

  // ----- Order-taking bot -----
  private bnToEnDigits(text: string): string {
    const map: Record<string, string> = { "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4", "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9" };
    return String(text ?? "").split("").map((ch) => map[ch] ?? ch).join("");
  }

  private async botSend(organizationId: string, conversation: any, session: any, content: string): Promise<boolean> {
    try {
      await this.sendAutomatedMessage(organizationId, conversation.id, content, "order_bot");
      return true;
    } catch (e) {
      await (this.prisma as any).botSession.update({ where: { id: session.id }, data: { status: "handed_off" } }).catch(() => undefined);
      await (this.prisma as any).conversationNote.create({
        data: { organizationId, conversationId: conversation.id, authorUserId: "system", content: `অর্ডার বট বার্তা পাঠাতে ব্যর্থ হয়ে থেমেছে: ${e instanceof Error ? e.message : "error"}` },
      }).catch(() => undefined);
      return false;
    }
  }

  private async botFail(organizationId: string, conversation: any, session: any, reason: string) {
    await (this.prisma as any).botSession.update({ where: { id: session.id }, data: { status: "handed_off" } }).catch(() => undefined);
    await (this.prisma as any).conversationNote.create({
      data: { organizationId, conversationId: conversation.id, authorUserId: "system", content: `অর্ডার বট হস্তান্তর: ${reason}` },
    }).catch(() => undefined);
  }

  /** Returns true when the bot consumed this message. */
  private async handleOrderBot(organizationId: string, conversation: any, text: string, classification: Classification): Promise<boolean> {
    const prisma = this.prisma as any;
    let session = await prisma.botSession?.findFirst?.({ where: { conversationId: conversation.id, status: "active" } }).catch(() => null);
    if (session && Date.now() - new Date(session.updatedAt).getTime() > 30 * 60000) {
      await prisma.botSession.update({ where: { id: session.id }, data: { status: "expired" } }).catch(() => undefined);
      session = null;
    }
    const settings = await this.getSettings(organizationId);
    const trimmed = text.trim();
    const handoffWords = ["এজেন্ট", "মানুষ", "agent", "human", "stop", "থামুন", "বন্ধ করুন"];

    if (session) {
      if (handoffWords.some((w) => trimmed.toLowerCase() === w || trimmed.includes("এজেন্ট চাই"))) {
        await this.botFail(organizationId, conversation, session, "গ্রাহক এজেন্ট চেয়েছেন");
        await this.botSend(organizationId, conversation, session, "ঠিক আছে, আমাদের একজন এজেন্ট শীঘ্রই উত্তর দেবেন। ধন্যবাদ!");
        return true;
      }
      return this.botStep(organizationId, conversation, session, trimmed, settings);
    }

    if (!settings.botEnabled) return false;
    if (classification.intent !== "order_intent") return false;
    const products = await prisma.product.findMany({ where: { organizationId, status: "ACTIVE" }, orderBy: { createdAt: "asc" }, take: 10 });
    if (products.length === 0) return false;
    session = await prisma.botSession.create({
      data: { organizationId, conversationId: conversation.id, state: "ask_product", data: {}, status: "active" },
    });
    const list = products.map((p: any, i: number) => `${i + 1}. ${p.name} — ${formatMinor(BigInt(p.priceMinor), p.currency)}`).join("\n");
    const ok = await this.botSend(organizationId, conversation, session,
      `আসসালামু আলাইকুম! অর্ডার করতে সাহায্য করছি। কোন পণ্যটি নিতে চান? পণ্যের নম্বরটি লিখুন:\n${list}\n(যেকোনো সময় "এজেন্ট" লিখলে মানুষের সাথে কথা বলতে পারবেন)`);
    return ok || true;
  }

  private async botStep(organizationId: string, conversation: any, session: any, text: string, settings: any): Promise<boolean> {
    const prisma = this.prisma as any;
    const data: Record<string, any> = { ...(session.data ?? {}) };
    const save = async (state: string) => prisma.botSession.update({ where: { id: session.id }, data: { state, data } });

    if (session.state === "ask_product") {
      const products = await prisma.product.findMany({ where: { organizationId, status: "ACTIVE" }, orderBy: { createdAt: "asc" }, take: 10 });
      const num = Number(this.bnToEnDigits(text).replace(/[^0-9]/g, ""));
      let product = num >= 1 && num <= products.length ? products[num - 1] : matchProduct(text, products);
      if (!product) {
        await this.botSend(organizationId, conversation, session, "দুঃখিত, কোন পণ্য বোঝা যায়নি। তালিকার নম্বরটি লিখুন (যেমন: 1)।");
        return true;
      }
      data.productId = product.id; data.productName = product.name;
      await save("ask_quantity");
      await this.botSend(organizationId, conversation, session, `"${product.name}" — কয়টি নিতে চান? সংখ্যা লিখুন।`);
      return true;
    }
    if (session.state === "ask_quantity") {
      const qty = Number(this.bnToEnDigits(text).replace(/[^0-9]/g, ""));
      if (!qty || qty < 1 || qty > 50) {
        await this.botSend(organizationId, conversation, session, "সঠিক সংখ্যা লিখুন (১ থেকে ৫০)।");
        return true;
      }
      data.quantity = qty;
      await save("ask_name");
      await this.botSend(organizationId, conversation, session, "আপনার পুরো নাম লিখুন (ডেলিভারির জন্য)।");
      return true;
    }
    if (session.state === "ask_name") {
      if (text.length < 3) {
        await this.botSend(organizationId, conversation, session, "নামটি আরেকবার লিখুন (কমপক্ষে ৩ অক্ষর)।");
        return true;
      }
      data.name = text.slice(0, 80);
      await save("ask_phone");
      await this.botSend(organizationId, conversation, session, "আপনার মোবাইল নম্বর লিখুন (যেমন: 01XXXXXXXXX)।");
      return true;
    }
    if (session.state === "ask_phone") {
      const digits = this.bnToEnDigits(text).replace(/\D/g, "");
      const local = digits.slice(-11);
      if (!/^01\d{9}$/.test(local)) {
        await this.botSend(organizationId, conversation, session, "নম্বরটি সঠিক মনে হচ্ছে না। 01 দিয়ে শুরু হওয়া ১১ সংখ্যার মোবাইল নম্বর লিখুন।");
        return true;
      }
      data.phone = local;
      await save("ask_address");
      await this.botSend(organizationId, conversation, session, "ডেলিভারির পুরো ঠিকানা লিখুন (বাসা/হোল্ডিং, রোড, এলাকা, থানা, জেলা)।");
      return true;
    }
    if (session.state === "ask_address") {
      if (text.length < 8) {
        await this.botSend(organizationId, conversation, session, "ঠিকানাটি বিস্তারিত লিখুন (কমপক্ষে বাসা, রোড ও এলাকা)।");
        return true;
      }
      data.address = text.slice(0, 500);
      const product = await prisma.product.findFirst({ where: { id: data.productId, organizationId } });
      if (!product) { await this.botFail(organizationId, conversation, session, "পণ্যটি আর পাওয়া যাচ্ছে না"); return true; }
      const unit = BigInt(product.priceMinor);
      const subtotal = unit * BigInt(data.quantity);
      const delivery = settings.botDeliveryChargeMinor;
      data.unitPriceMinor = String(unit); data.subtotalMinor = String(subtotal);
      await save("confirm");
      const lines = [
        "অর্ডারের সারসংক্ষেপ:",
        `পণ্য: ${product.name} × ${data.quantity} = ${formatMinor(subtotal, product.currency)}`,
        delivery != null ? `ডেলিভারি চার্জ: ${formatMinor(BigInt(delivery), product.currency)}` : "ডেলিভারি চার্জ: আমাদের টিম কনফার্ম করবে",
        delivery != null ? `সর্বমোট (COD): ${formatMinor(subtotal + BigInt(delivery), product.currency)}` : `মোট (ডেলিভারি ছাড়া): ${formatMinor(subtotal, product.currency)}`,
        `নাম: ${data.name}`,
        `ফোন: ${data.phone}`,
        `ঠিকানা: ${data.address}`,
        'সব ঠিক থাকলে "হ্যাঁ" লিখুন, বাতিল করতে "না" লিখুন।',
      ];
      await this.botSend(organizationId, conversation, session, lines.join("\n"));
      return true;
    }
    if (session.state === "confirm") {
      const verdict = parseCodReply(text);
      if (verdict === "declined") {
        await prisma.botSession.update({ where: { id: session.id }, data: { status: "handed_off", data } });
        await this.botSend(organizationId, conversation, session, "ঠিক আছে, অর্ডারটি বাতিল করা হলো। অন্য কিছু জানতে চাইলে লিখুন।");
        return true;
      }
      if (verdict !== "confirmed") {
        await this.botSend(organizationId, conversation, session, 'অনুগ্রহ করে "হ্যাঁ" (কনফার্ম) অথবা "না" (বাতিল) লিখুন।');
        return true;
      }
      // Create the customer with the collected details, then the order
      // through the standard chat-order pipeline.
      let customer = conversation.customerId
        ? await prisma.customer.findFirst({ where: { id: conversation.customerId, organizationId } })
        : null;
      if (!customer) {
        customer = await prisma.customer.create({
          data: { organizationId, firstName: data.name, lastName: null, phone: data.phone, email: null, source: "chat_bot" },
        });
        await prisma.channelConversation.update({ where: { id: conversation.id }, data: { customerId: customer.id } });
      }
      const order = await this.createChatOrder(organizationId, "system", conversation.id, {
        items: [{ productId: data.productId, quantity: data.quantity }],
        shippingMinor: settings.botDeliveryChargeMinor ?? 0,
        isCod: true,
      });
      await prisma.conversationNote.create({
        data: {
          organizationId, conversationId: conversation.id, authorUserId: "system",
          content: `বট অর্ডার ${order.externalNumber}: ${data.name}, ${data.phone}, ঠিকানা: ${data.address} (স্টোর সিঙ্ক: ${order.storeSyncStatus})`,
        },
      }).catch(() => undefined);
      await prisma.botSession.update({ where: { id: session.id }, data: { status: "completed", data } });
      await this.botSend(organizationId, conversation, session,
        `ধন্যবাদ ${data.name}! আপনার অর্ডার ${order.externalNumber} তৈরি হয়েছে (মোট ${formatMinor(BigInt(order.totalMinor), order.currency)})।${order.storeSyncStatus === "synced" ? " অর্ডারটি স্টোরেও পাঠানো হয়েছে।" : ""} আমাদের টিম শীঘ্রই কল করে কনফার্ম করবে।`);
      return true;
    }
    await this.botFail(organizationId, conversation, session, `অজানা বট ধাপ: ${session.state}`);
    return true;
  }

  async stopBot(organizationId: string, actorId: string, conversationId: string) {
    await this.getConversationOrThrow(organizationId, conversationId);
    const session = await (this.prisma as any).botSession?.findFirst?.({ where: { conversationId, status: "active" } }).catch(() => null);
    if (!session) return { stopped: false };
    await (this.prisma as any).botSession.update({ where: { id: session.id }, data: { status: "handed_off" } });
    await (this.prisma as any).conversationNote.create({
      data: { organizationId, conversationId, authorUserId: actorId, content: "এজেন্ট বট থামিয়ে কথোপকথনের দায়িত্ব নিয়েছেন।" },
    }).catch(() => undefined);
    return { stopped: true };
  }

  async getBotSession(conversationId: string) {
    return (this.prisma as any).botSession?.findFirst?.({
      where: { conversationId }, orderBy: { createdAt: "desc" },
    }).catch(() => null) ?? null;
  }

  private async handleCsatReply(organizationId: string, conversation: any, text: string): Promise<boolean> {
    if (!conversation.csatSentAt || conversation.csatRating) return false;
    const bnDigits: Record<string, string> = { "১": "1", "২": "2", "৩": "3", "৪": "4", "৫": "5" };
    const normalized = text.trim().split("").map((ch) => bnDigits[ch] ?? ch).join("");
    if (!/^[1-5]$/.test(normalized)) return false;
    const rating = Number(normalized);
    await (this.prisma as any).channelConversation.update({
      where: { id: conversation.id }, data: { csatRating: rating, csatRatedAt: new Date() },
    });
    await (this.prisma as any).conversationNote.create({
      data: { organizationId, conversationId: conversation.id, authorUserId: "system", content: `CSAT রেটিং: ${rating}/5` },
    }).catch(() => undefined);
    return true;
  }

  /** Flag (never delete) likely-spam conversations for a human call. */
  private async detectSpam(organizationId: string, conversation: any, text: string): Promise<boolean> {
    if (conversation.spamFlag) return true;
    const trimmed = text.trim();
    let reason: string | null = null;
    const recent = await (this.prisma as any).channelMessage.findMany({
      where: { conversationId: conversation.id, direction: "in" }, orderBy: { createdAt: "desc" }, take: 20,
    });
    const tenMinAgo = Date.now() - 10 * 60000;
    const sameRecent = recent.filter((m: any) => (m.content ?? "").trim() === trimmed && new Date(m.createdAt).getTime() >= tenMinAgo).length;
    if (sameRecent >= 3) reason = "একই বার্তা ১০ মিনিটে ৩+ বার পাঠানো হয়েছে";
    else if (recent.length <= 1 && /(https?:\/\/|www\.)/i.test(trimmed) && /(free|prize|lottery|winner|জিতেছেন|ফ্রি|লটারি|ক্যাশব্যাক|অফার জিতুন)/i.test(trimmed)) {
      reason = "প্রথম বার্তাতেই প্রমোশনাল লিংক";
    }
    if (!reason) return false;
    await (this.prisma as any).channelConversation.update({
      where: { id: conversation.id }, data: { spamFlag: true, spamReason: reason },
    }).catch(() => undefined);
    return true;
  }

  private async handleCodReply(organizationId: string, conversation: any, text: string): Promise<boolean> {
    const verdict = parseCodReply(text);
    if (!verdict) return false;
    const order = await (this.prisma as any).order.findFirst({
      where: { organizationId, codConversationId: conversation.id, codConfirmationStatus: "awaiting" },
    });
    if (!order) return false;
    await (this.prisma as any).order.update({
      where: { id: order.id }, data: { codConfirmationStatus: verdict },
    });
    await (this.prisma as any).conversationNote.create({
      data: {
        organizationId, conversationId: conversation.id, authorUserId: "system",
        content: verdict === "confirmed"
          ? `COD নিশ্চিতকরণ: গ্রাহক অর্ডার #${order.externalNumber ?? order.id} কনফার্ম করেছেন।`
          : `COD নিশ্চিতকরণ: গ্রাহক অর্ডার #${order.externalNumber ?? order.id} বাতিল করেছেন।`,
      },
    }).catch(() => undefined);
    if (conversation.leadId) {
      await (this.prisma as any).leadActivity.create({
        data: { leadId: conversation.leadId, type: "cod_" + verdict, content: `COD order #${order.externalNumber ?? order.id} ${verdict} via chat reply` },
      }).catch(() => undefined);
    }
    if (verdict === "confirmed") {
      try { this.events?.emit("order.cod_confirmed", { organizationId, context: { orderId: order.id } }); } catch { /* CAPI never blocks COD handling */ }
    }
    return true;
  }

  /** Compose an answer strictly from real business data, or return null. */
  private async composeGroundedReply(organizationId: string, conversation: any, intent: string, text: string) {
    if (intent === "price" || intent === "stock") {
      const products = await (this.prisma as any).product.findMany({ where: { organizationId, status: "ACTIVE" }, take: 100 });
      const product = matchProduct(text, products);
      if (!product) return null;
      const price = formatMinor(BigInt(product.priceMinor), product.currency);
      if (intent === "price") {
        const stockLine = product.stockQuantity == null ? "" : product.stockQuantity > 0 ? ` স্টকে আছে (${product.stockQuantity}টি)।` : " দুঃখিত, আপাতত স্টক শেষ।";
        return {
          content: `আসসালামু আলাইকুম! "${product.name}" এর দাম ${price}।${stockLine} অর্ডার করতে আপনার নাম, ফোন নম্বর ও ঠিকানা পাঠিয়ে দিন।`,
          evidence: { type: "product_price", productId: product.id, priceMinor: String(product.priceMinor), currency: product.currency },
        };
      }
      if (product.stockQuantity == null) return null; // unknown stock is never claimed
      return {
        content: product.stockQuantity > 0
          ? `জি, "${product.name}" স্টকে আছে (${product.stockQuantity}টি)। দাম ${price}। অর্ডার করতে নাম, ফোন ও ঠিকানা পাঠান।`
          : `দুঃখিত, "${product.name}" আপাতত স্টক শেষ। নতুন স্টক এলে আমরা জানিয়ে দেব।`,
        evidence: { type: "product_stock", productId: product.id, stockQuantity: product.stockQuantity },
      };
    }
    if (intent === "delivery" || intent === "payment") {
      const policy = await (this.prisma as any).businessPolicy.findFirst({
        where: { organizationId, type: intent === "delivery" ? "shipping" : "payment" },
      });
      if (!policy?.content) return null;
      const excerpt = String(policy.content).replace(/\s+/g, " ").slice(0, 350);
      return {
        content: `${intent === "delivery" ? "ডেলিভারি সংক্রান্ত তথ্য" : "পেমেন্ট সংক্রান্ত তথ্য"}: ${excerpt}`,
        evidence: { type: "business_policy", policyId: policy.id, policyType: policy.type },
      };
    }
    if (intent === "order_status") {
      if (!conversation.customerId) return null;
      const order = await (this.prisma as any).order.findFirst({
        where: { organizationId, customerId: conversation.customerId }, orderBy: { createdAt: "desc" },
      });
      if (!order) return null;
      const label: Record<string, string> = {
        pending: "প্রসেসিংয়ের অপেক্ষায়", "on-hold": "অপেক্ষমাণ", processing: "প্রস্তুত হচ্ছে",
        shipped: "কুরিয়ারে দেওয়া হয়েছে", "in-transit": "কুরিয়ারে দেওয়া হয়েছে",
        completed: "ডেলিভারি সম্পন্ন", delivered: "ডেলিভারি সম্পন্ন", refunded: "রিফান্ড হয়েছে", failed: "ব্যর্থ হয়েছে", cancelled: "বাতিল হয়েছে",
      };
      return {
        content: `আপনার সর্বশেষ অর্ডার #${order.externalNumber ?? ""} বর্তমানে "${label[order.status] ?? order.status}" অবস্থায় আছে। আর কিছু জানতে চাইলে লিখুন, আমাদের টিম সাহায্য করবে।`,
        evidence: { type: "order_status", orderId: order.id, status: order.status },
      };
    }
    return null;
  }

  private async maybeAutoReply(organizationId: string, conversation: any, classification: Classification, text: string) {
    const settings = await this.getSettings(organizationId);
    const perIntent = (settings.perIntent ?? {}) as Record<string, string>;
    const mode = perIntent[classification.intent] ?? settings.autoReplyMode;
    if (mode === "off") return;
    if (!["price", "stock", "delivery", "order_status", "payment"].includes(classification.intent)) return;
    if (classification.confidence < settings.confidenceThreshold) return;
    const composed = await this.composeGroundedReply(organizationId, conversation, classification.intent, text);
    if (!composed) return; // no verified data -> no reply, ever

    // Judge the WhatsApp window from the FRESH row: the conversation
    // object handed down from the webhook is a snapshot taken before
    // lastCustomerMessageAt was stamped for this very message.
    const fresh = await (this.prisma as any).channelConversation.findFirst({ where: { id: conversation.id } }).catch(() => null);
    const current = fresh ?? conversation;
    const windowClosed = current.channel === "whatsapp" && this.whatsappWindow(current)?.open === false;
    if (mode === "draft" || windowClosed) {
      await (this.prisma as any).messageDraft.create({
        data: {
          organizationId, conversationId: conversation.id, content: composed.content,
          provider: "auto-reply", status: "suggested", createdByUserId: null,
        },
      });
      return;
    }

    conversation = current;
    // Rate limit: at most one auto-reply per conversation per 10 minutes.
    const lastAuto = await (this.prisma as any).channelMessage.findFirst({
      where: { conversationId: conversation.id, autoReply: true }, orderBy: { createdAt: "desc" },
    });
    if (lastAuto && Date.now() - new Date(lastAuto.createdAt).getTime() < 10 * 60 * 1000) return;

    const message = await (this.prisma as any).channelMessage.create({
      data: {
        conversationId: conversation.id, direction: "out", type: "text", content: composed.content,
        status: "queued", autoReply: true, autoReplyEvidence: JSON.stringify(composed.evidence),
      },
    });
    try {
      const messageId = await this.deliverText(conversation, composed.content);
      await (this.prisma as any).channelMessage.update({ where: { id: message.id }, data: { status: "sent", externalId: messageId } });
      await (this.prisma as any).channelConversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: new Date(), lastMessagePreview: composed.content.slice(0, 120),
          ...(conversation.firstResponseAt ? {} : { firstResponseAt: new Date() }),
        },
      });
      await this.audit.log({
        organizationId, userId: "system", action: "inbox.auto_reply.sent", entityType: "ChannelConversation",
        entityId: conversation.id, metadata: { intent: classification.intent, confidence: classification.confidence, evidence: composed.evidence },
      });
    } catch (e) {
      const error = e instanceof Error ? e.message : "Auto-reply send failed";
      await (this.prisma as any).channelMessage.update({ where: { id: message.id }, data: { status: "failed", error } });
      await this.audit.log({
        organizationId, userId: "system", action: "inbox.auto_reply.failed", entityType: "ChannelConversation",
        entityId: conversation.id, metadata: { intent: classification.intent, error },
      });
    }
  }

  // ----- COD confirmation -----
  async requestCodConfirmation(organizationId: string, actorId: string, conversationId: string, orderId: string) {
    const conv = await this.getConversationOrThrow(organizationId, conversationId);
    const order = await (this.prisma as any).order.findFirst({ where: { id: orderId, organizationId } });
    if (!order) throw new NotFoundException("Order not found in this organization");
    if (!conv.customerId || order.customerId !== conv.customerId) throw new BadRequestException("This order is not linked to the conversation's customer");
    if (!order.isCod) throw new BadRequestException("This is not a cash-on-delivery order");
    if (!["pending", "on-hold", "processing"].includes(order.status)) throw new BadRequestException(`Order status "${order.status}" cannot be confirmed via chat`);
    if (order.codConfirmationStatus === "awaiting") throw new BadRequestException("A confirmation request is already awaiting the customer's reply");
    if (order.codConfirmationStatus === "confirmed") throw new BadRequestException("This order is already confirmed");
    const name = conv.contactName ?? "সম্মানিত গ্রাহক";
    const total = formatMinor(BigInt(order.totalMinor), order.currency);
    const text = `আসসালামু আলাইকুম ${name}! আপনার অর্ডার #${order.externalNumber ?? ""} (${total}) ক্যাশ অন ডেলিভারিতে রাখা আছে। অর্ডারটি কনফার্ম করতে "হ্যাঁ" লিখে রিপ্লাই দিন, আর বাতিল করতে "না" লিখুন।`;
    // Send FIRST through the normal confirmed path; state changes only
    // after the platform confirms the message was sent.
    await this.sendReply(organizationId, actorId, conversationId, text);
    const updated = await (this.prisma as any).order.update({
      where: { id: orderId },
      data: { codConfirmationStatus: "awaiting", codConfirmationSentAt: new Date(), codConversationId: conversationId },
    });
    return { ...updated, totalMinor: String(updated.totalMinor) };
  }

  // ----- SLA / team report -----
  async getTeamReport(organizationId: string, days = 7) {
    const settings = await this.getSettings(organizationId);
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const convs = await (this.prisma as any).channelConversation.findMany({
      where: { organizationId, createdAt: { gte: since } }, take: 1000,
    });
    const closed = await (this.prisma as any).channelConversation.findMany({
      where: { organizationId, resolvedAt: { gte: since } }, take: 1000,
    });
    const rated = await (this.prisma as any).channelConversation.findMany({
      where: { organizationId, csatRatedAt: { gte: since } }, take: 1000,
    }).catch(() => []);
    const csatResponses = rated.filter((c: any) => c.csatRating).length;
    const csatAvg = csatResponses ? Math.round((rated.reduce((sum: number, c: any) => sum + (c.csatRating ?? 0), 0) / csatResponses) * 10) / 10 : null;
    const responseMinutes = convs
      .filter((c: any) => c.firstResponseAt)
      .map((c: any) => (new Date(c.firstResponseAt).getTime() - new Date(c.createdAt).getTime()) / 60000)
      .filter((m: number) => m >= 0);
    const avg = responseMinutes.length ? Math.round(responseMinutes.reduce((a: number, b: number) => a + b, 0) / responseMinutes.length) : null;
    const openNow = await (this.prisma as any).channelConversation.findMany({
      where: { organizationId, status: "open" }, take: 1000,
    });
    const breachCutoff = Date.now() - settings.slaFirstResponseMinutes * 60000;
    const currentBreaches = openNow.filter((c: any) => !c.firstResponseAt && new Date(c.createdAt).getTime() < breachCutoff).length;

    const perAgentMap = new Map<string, { userId: string; assigned: number; closed: number; resp: number[] }>();
    for (const c of convs) {
      if (!c.assignedUserId) continue;
      const row = perAgentMap.get(c.assignedUserId) ?? { userId: c.assignedUserId, assigned: 0, closed: 0, resp: [] as number[] };
      row.assigned++;
      if (c.resolvedAt) row.closed++;
      if (c.firstResponseAt) row.resp.push((new Date(c.firstResponseAt).getTime() - new Date(c.createdAt).getTime()) / 60000);
      perAgentMap.set(c.assignedUserId, row);
    }
    const perAgent = [...perAgentMap.values()].map((r) => ({
      userId: r.userId, assigned: r.assigned, closed: r.closed,
      avgFirstResponseMinutes: r.resp.length ? Math.round(r.resp.reduce((a, b) => a + b, 0) / r.resp.length) : null,
    }));

    const customerIds = [...new Set(convs.map((c: any) => c.customerId).filter(Boolean))];
    let chatLinkedOrders = 0; let chatLinkedRevenueMinor = "0"; let chatLinkedCurrency = "BDT";
    if (customerIds.length) {
      const orders = await (this.prisma as any).order.findMany({
        where: { organizationId, customerId: { in: customerIds }, createdAt: { gte: since } }, take: 1000,
      });
      const billable = orders.filter((o: any) => o.status !== "cancelled");
      chatLinkedOrders = billable.length;
      chatLinkedRevenueMinor = String(billable.reduce((sum: bigint, o: any) => sum + BigInt(o.totalMinor), 0n));
      chatLinkedCurrency = billable[0]?.currency ?? "BDT";
    }
    return {
      days, slaFirstResponseMinutes: settings.slaFirstResponseMinutes,
      opened: convs.length, closed: closed.length,
      avgFirstResponseMinutes: avg, currentBreaches,
      perAgent, chatLinkedOrders, chatLinkedRevenueMinor, chatLinkedCurrency, csatAvg, csatResponses,
      chatLinkedNote: "Orders/revenue of customers who have an inbox conversation in the period (linked, not platform-attributed).",
    };
  }

  // ----- Inbox API -----

  // ----- Payment screenshot verification (agent-assist) -----
  async verifyPaymentScreenshot(organizationId: string, actorId: string, conversationId: string, messageId: string) {
    const conv = await this.getConversationOrThrow(organizationId, conversationId);
    const existing = await (this.prisma as any).paymentVerification?.findFirst?.({ where: { messageId } }).catch(() => null);
    if (existing) return this.serializeVerification(existing);
    const { bytes, contentType } = await this.getMessageMedia(organizationId, conversationId, messageId);
    // Throws an honest configuration error when no vision provider exists.
    const { extraction, modelProvider } = await extractPaymentScreenshot(bytes, contentType);

    // Expected amount: the COD order awaiting confirmation in this
    // thread, else the customer's latest open order.
    let expected: any = null;
    const awaiting = await (this.prisma as any).order.findFirst({
      where: { organizationId, codConversationId: conversationId, codConfirmationStatus: "awaiting" },
    });
    if (awaiting) expected = awaiting;
    else if (conv.customerId) {
      expected = await (this.prisma as any).order.findFirst({
        where: { organizationId, customerId: conv.customerId, status: { in: ["pending", "on-hold", "processing"] } },
        orderBy: { createdAt: "desc" },
      });
    }
    const expectedAmountMinor = expected ? BigInt(expected.totalMinor) : null;
    const amountMinor = extraction.amount != null ? BigInt(Math.round(extraction.amount * 100)) : null;

    const flags: string[] = [...extraction.suspicious];
    let verdict: string;
    let duplicate: any = null;
    if (extraction.trxId) {
      duplicate = await (this.prisma as any).paymentVerification.findFirst({
        where: { organizationId, trxId: extraction.trxId },
      }).catch(() => null);
      if (duplicate) flags.push("duplicate_trxid");
    }
    if (!extraction.trxId || extraction.provider === "unknown") verdict = "unverifiable";
    else if (duplicate) verdict = "duplicate_trxid";
    else if (expectedAmountMinor == null) verdict = "no_expected_order";
    else if (amountMinor != null && amountMinor === expectedAmountMinor) verdict = "matched";
    else verdict = "amount_mismatch";

    const row = await (this.prisma as any).paymentVerification.create({
      data: {
        organizationId, conversationId, messageId,
        provider: extraction.provider, trxId: extraction.trxId,
        amountMinor, expectedAmountMinor, verdict, flags,
        rawExtraction: extraction as any, modelProvider, createdById: actorId,
      },
    });
    await (this.prisma as any).conversationNote.create({
      data: {
        organizationId, conversationId, authorUserId: "system",
        content: `পেমেন্ট স্ক্রিনশট যাচাই: ${verdict}${extraction.trxId ? ` · TrxID ${extraction.trxId}` : ""}${amountMinor != null ? ` · পরিমাণ ${formatMinor(amountMinor, expected?.currency ?? "BDT")}` : ""}${flags.length ? ` · সতর্কতা: ${flags.join(", ")}` : ""} (এটি সহায়ক যাচাই; পেমেন্ট নিশ্চিত করার সিদ্ধান্ত এজেন্টের)`,
      },
    }).catch(() => undefined);
    return this.serializeVerification(row);
  }

  private serializeVerification(row: any) {
    return {
      ...row,
      amountMinor: row.amountMinor != null ? String(row.amountMinor) : null,
      expectedAmountMinor: row.expectedAmountMinor != null ? String(row.expectedAmountMinor) : null,
    };
  }

  async listPaymentVerifications(organizationId: string, conversationId: string) {
    await this.getConversationOrThrow(organizationId, conversationId);
    const rows = await (this.prisma as any).paymentVerification?.findMany?.({
      where: { organizationId, conversationId }, orderBy: { createdAt: "desc" }, take: 50,
    }).catch(() => []) ?? [];
    return rows.map((r: any) => this.serializeVerification(r));
  }

  // ----- Voice-note transcription -----
  async transcribeMessage(organizationId: string, conversationId: string, messageId: string) {
    await this.getConversationOrThrow(organizationId, conversationId);
    const message = await (this.prisma as any).channelMessage.findFirst({ where: { id: messageId, conversationId } });
    if (!message) throw new NotFoundException("Message not found in this conversation");
    if (message.transcription) return { transcription: message.transcription, provider: message.transcriptionProvider, intent: message.intent ?? null };
    const { bytes, contentType } = await this.getMessageMedia(organizationId, conversationId, messageId);
    // Throws an honest configuration error when no speech provider exists.
    const { text, modelProvider } = await transcribeAudio(bytes, contentType);
    const cls = classifyIntent(text);
    const updated = await (this.prisma as any).channelMessage.update({
      where: { id: messageId },
      data: {
        transcription: text, transcriptionProvider: modelProvider,
        ...(message.intent ? {} : { intent: cls.intent, intentConfidence: cls.confidence }),
      },
    });
    return { transcription: updated.transcription, provider: updated.transcriptionProvider, intent: updated.intent ?? cls.intent };
  }

  /**
   * Automated send path used by workflows and the order bot. Same
   * honesty discipline as sendReply: the row becomes "sent" only with
   * a platform message id; failures mark the row failed and throw.
   * Outbound rows are flagged autoReply with an evidence/source tag so
   * the thread always shows a machine sent them.
   */
  async sendAutomatedMessage(organizationId: string, conversationId: string, content: string, sourceTag: string) {
    const conv = await this.getConversationOrThrow(organizationId, conversationId);
    const integration = await this.integrationForConversation(conv);
    const secrets = await this.secretsFor(integration.id);
    const client = new MetaMessagingClient(secrets);
    const message = await (this.prisma as any).channelMessage.create({
      data: {
        conversationId, direction: "out", type: "text", content, status: "queued",
        autoReply: true, autoReplyEvidence: JSON.stringify({ type: sourceTag }),
      },
    });
    try {
      const messageId = await this.deliverText(conv, content);
      const sent = await (this.prisma as any).channelMessage.update({
        where: { id: message.id }, data: { status: "sent", externalId: messageId },
      });
      await (this.prisma as any).channelConversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: new Date(), lastMessagePreview: content.slice(0, 120),
          ...(conv.firstResponseAt ? {} : { firstResponseAt: new Date() }),
        },
      });
      await this.audit.log({
        organizationId, userId: "system", action: "inbox.automated_message.sent", entityType: "ChannelConversation",
        entityId: conversationId, metadata: { source: sourceTag },
      });
      return sent;
    } catch (e) {
      const error = e instanceof Error ? e.message : "Platform send failed";
      await (this.prisma as any).channelMessage.update({ where: { id: message.id }, data: { status: "failed", error } });
      throw new BadRequestException(error);
    }
  }

  /**
   * WhatsApp's 24h customer-service window: free-form messages are only
   * allowed within 24h of the customer's last message. Outside it, only
   * approved template messages may be sent. Derived strictly from the
   * recorded lastCustomerMessageAt - never guessed.
   */
  // ----- Order from chat -----
  async createChatOrder(organizationId: string, actorId: string, conversationId: string, dto: {
    items: { productId: string; variantId?: string; quantity: number }[];
    shippingMinor?: number; isCod?: boolean;
  }) {
    const conv = await this.getConversationOrThrow(organizationId, conversationId);
    if (!Array.isArray(dto.items) || dto.items.length === 0) throw new BadRequestException("At least one item is required");
    const shippingMinor = BigInt(Math.max(0, Math.round(dto.shippingMinor ?? 0)));
    const products = await (this.prisma as any).product.findMany({
      where: { organizationId, id: { in: dto.items.map((i) => i.productId) } }, take: 100,
    });
    const byId = new Map<string, any>(products.map((p: any) => [p.id, p] as [string, any]));
    let subtotal = 0n;
    const lines: { product: any; variant: any; quantity: number; unitPrice: bigint }[] = [];
    for (const item of dto.items) {
      const product = byId.get(item.productId);
      if (!product) throw new BadRequestException(`Product not found in this organization: ${item.productId}`);
      const quantity = Math.min(99, Math.max(1, Math.round(item.quantity || 1)));
      let variant: any = null;
      if (item.variantId) {
        variant = await (this.prisma as any).productVariant.findFirst({ where: { id: item.variantId, productId: product.id } });
        if (!variant) throw new BadRequestException(`Variant not found for product ${product.name}`);
      }
      const unitPrice = BigInt(variant?.priceMinor ?? product.priceMinor);
      subtotal += unitPrice * BigInt(quantity);
      lines.push({ product, variant, quantity, unitPrice });
    }

    // Customer: the conversation's linked customer, or create one from
    // the contact so the order has a real owner.
    let customer: any = null;
    if (conv.customerId) customer = await (this.prisma as any).customer.findFirst({ where: { id: conv.customerId, organizationId } });
    if (!customer) {
      customer = await (this.prisma as any).customer.create({
        data: {
          organizationId, firstName: conv.contactName ?? "Chat Customer", lastName: null,
          phone: conv.contactPhone ?? null, email: null, source: "chat",
        },
      });
      await (this.prisma as any).channelConversation.update({ where: { id: conv.id }, data: { customerId: customer.id } });
    }

    const suffix = randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
    const order = await (this.prisma as any).order.create({
      data: {
        organizationId, customerId: customer.id, source: "chat",
        externalId: `chat-${randomUUID()}`, externalNumber: `CHAT-${suffix}`,
        status: "pending", paymentMethod: dto.isCod === false ? null : "cod", isCod: dto.isCod !== false,
        currency: lines[0].product.currency ?? "BDT",
        subtotalMinor: subtotal, shippingMinor, discountMinor: 0n, taxMinor: 0n,
        totalMinor: subtotal + shippingMinor, refundedMinor: 0n,
        placedAt: new Date(), storeSyncStatus: "local_only", conversationId,
      },
    });
    for (const line of lines) {
      await (this.prisma as any).orderItem.create({
        data: {
          orderId: order.id, productId: line.product.id,
          externalProductId: line.product.externalId ?? null,
          externalVariationId: line.variant?.externalId ?? null,
          name: line.variant ? `${line.product.name} - ${line.variant.name}` : line.product.name,
          sku: line.variant?.sku ?? line.product.sku ?? null,
          quantity: line.quantity, priceMinor: line.unitPrice,
          totalMinor: line.unitPrice * BigInt(line.quantity),
        },
      });
    }

    // Optional push to the connected WooCommerce store. The local order
    // is real either way; the sync outcome is recorded, never assumed.
    let syncStatus = "local_only"; let syncError: string | null = null;
    const woo = await (this.prisma as any).integration.findFirst({
      where: { organizationId, provider: "woocommerce", status: "CONNECTED" }, include: { store: true, credential: true },
    }).catch(() => null);
    if (woo?.store && woo?.credential) {
      const allWoo = lines.every((l) => l.product.source === "woocommerce" && /^\d+$/.test(String(l.product.externalId ?? "")));
      if (!allWoo) {
        syncError = "সব পণ্য WooCommerce থেকে আসেনি, তাই স্টোরে পাঠানো হয়নি";
      } else {
        try {
          const creds = decryptJson(woo.credential.encryptedData) as any;
          const client = new WooClient(woo.store.url, { consumerKey: creds.consumerKey, consumerSecret: creds.consumerSecret });
          const created = await client.createOrder({
            payment_method: order.isCod ? "cod" : "bacs",
            payment_method_title: order.isCod ? "Cash on delivery" : "Direct bank transfer",
            set_paid: false, status: "pending",
            billing: { first_name: customer.firstName ?? "", phone: customer.phone ?? "" },
            line_items: lines.map((l) => ({
              product_id: Number(l.product.externalId),
              ...(l.variant?.externalId && /^\d+$/.test(String(l.variant.externalId)) ? { variation_id: Number(l.variant.externalId) } : {}),
              quantity: l.quantity,
            })),
            ...(shippingMinor > 0n ? { shipping_lines: [{ method_id: "flat_rate", method_title: "Delivery", total: (Number(shippingMinor) / 100).toFixed(2) }] } : {}),
          });
          await (this.prisma as any).order.update({
            where: { id: order.id },
            data: { externalId: String(created.id), externalNumber: String(created.number ?? created.id), storeSyncStatus: "synced" },
          });
          syncStatus = "synced";
        } catch (e) {
          syncStatus = "failed";
          syncError = e instanceof Error ? e.message : "WooCommerce push failed";
          await (this.prisma as any).order.update({
            where: { id: order.id }, data: { storeSyncStatus: "failed", storeSyncError: syncError },
          });
        }
      }
      if (syncStatus === "local_only" && syncError) {
        await (this.prisma as any).order.update({ where: { id: order.id }, data: { storeSyncError: syncError } });
      }
    }

    await this.audit.log({
      organizationId, userId: actorId, action: "inbox.order.created", entityType: "Order", entityId: order.id,
      metadata: { conversationId, totalMinor: String(order.totalMinor), storeSyncStatus: syncStatus },
    });
    try {
      this.events?.emit("order.created", {
        organizationId,
        context: {
          orderId: order.id, orderNumber: order.externalNumber, customerId: customer.id,
          total: Number(order.totalMinor) / 100, currency: order.currency, status: order.status, source: "chat",
        },
      });
    } catch { /* workflows never block order creation */ }
    const items = await (this.prisma as any).orderItem.findMany({ where: { orderId: order.id }, take: 100 });
    const fresh = await (this.prisma as any).order.findFirst({ where: { id: order.id } });
    return {
      ...fresh, subtotalMinor: String(fresh.subtotalMinor), shippingMinor: String(fresh.shippingMinor),
      totalMinor: String(fresh.totalMinor), storeSyncStatus: fresh.storeSyncStatus ?? syncStatus,
      items: items.map((i: any) => ({ ...i, priceMinor: String(i.priceMinor), totalMinor: String(i.totalMinor) })),
    };
  }

  // ----- Translation + summary -----
  async translateMessage(organizationId: string, conversationId: string, messageId: string, target: string) {
    await this.getConversationOrThrow(organizationId, conversationId);
    const message = await (this.prisma as any).channelMessage.findFirst({ where: { id: messageId, conversationId } });
    if (!message?.content) throw new NotFoundException("Message not found or has no text");
    if (!["en", "bn"].includes(target)) throw new BadRequestException("target must be en or bn");
    const provider = this.llm.getProvider();
    if (!provider.isRealLlm) {
      // Honest boundary: templates cannot translate. No fake output.
      throw new BadRequestException("অনুবাদের জন্য একটি আসল LLM provider দরকার (LLM_PROVIDER ও API key সেট করুন)। Dev template দিয়ে অনুবাদ সম্ভব নয়।");
    }
    const result = await provider.complete([
      { role: "system", content: `You are a professional translator. Translate the user's text into ${target === "en" ? "English" : "Bengali"}. Return ONLY the translation, no explanations.` },
      { role: "user", content: message.content },
    ], { maxTokens: 600 });
    await (this.prisma as any).aIUsageRecord.create({
      data: { organizationId, userId: "system", feature: "translate", provider: provider.name, inputTokens: result.inputTokens, outputTokens: result.outputTokens, estimated: result.tokensEstimated },
    }).catch(() => undefined);
    return { translatedText: result.text.trim(), provider: provider.name, target };
  }

  async summarizeConversation(organizationId: string, actorId: string, conversationId: string) {
    const conv = await this.getConversationOrThrow(organizationId, conversationId);
    const messages = await (this.prisma as any).channelMessage.findMany({
      where: { conversationId }, orderBy: { createdAt: "desc" }, take: 50,
    });
    if (messages.length === 0) throw new BadRequestException("এই কথোপকথনে কোনো বার্তা নেই");
    const history = [...messages].reverse();
    const provider = this.llm.getProvider();
    let summary: string;
    if (provider.isRealLlm) {
      const result = await provider.complete([
        { role: "system", content: "Summarize this customer-support conversation in Bengali in 3-5 short bullet lines. Use ONLY facts from the messages: what the customer wants, key details (product, price, order), current status, and any pending action. Never invent facts." },
        { role: "user", content: history.map((m: any) => `${m.direction === "in" ? "Customer" : "Business"}: ${m.content ?? `[${m.type}]`}`).join("\n") },
      ], { maxTokens: 400 });
      summary = result.text.trim();
      await (this.prisma as any).aIUsageRecord.create({
        data: { organizationId, userId: actorId, feature: "summary", provider: provider.name, inputTokens: result.inputTokens, outputTokens: result.outputTokens, estimated: result.tokensEstimated },
      }).catch(() => undefined);
    } else {
      // Clearly labeled data digest (not an AI summary).
      const inbound = history.filter((m: any) => m.direction === "in");
      const intents = [...new Set(inbound.map((m: any) => m.intent).filter(Boolean))];
      const first = inbound[0]?.content ?? "—";
      summary = [
        `মোট বার্তা: ${history.length} (গ্রাহক ${inbound.length}, টিম ${history.length - inbound.length})`,
        `গ্রাহকের প্রথম বার্তা: "${String(first).slice(0, 140)}"`,
        intents.length ? `শনাক্ত বিষয়: ${intents.join(", ")}` : "কোনো Intent শনাক্ত হয়নি",
        `কথোপকথনের অবস্থা: ${conv.status}${conv.csatRating ? ` · CSAT ${conv.csatRating}/5` : ""}`,
        "(এটি ডেটা-ভিত্তিক সারসংক্ষেপ; আসল LLM যুক্ত হলে বিস্তারিত সারসংক্ষেপ পাওয়া যাবে।)",
      ].join("\n");
    }
    const updated = await (this.prisma as any).channelConversation.update({
      where: { id: conversationId },
      data: { summaryText: summary, summaryProvider: provider.name, summaryAt: new Date() },
    });
    return { summaryText: updated.summaryText, summaryProvider: updated.summaryProvider, summaryAt: updated.summaryAt };
  }

  whatsappWindow(conv: any, now = new Date()): { open: boolean; expiresAt: string | null } | null {
    if (conv.channel !== "whatsapp") return null;
    if (!conv.lastCustomerMessageAt) return { open: false, expiresAt: null };
    const expires = new Date(new Date(conv.lastCustomerMessageAt).getTime() + 24 * 3600 * 1000);
    return { open: now < expires, expiresAt: expires.toISOString() };
  }

  async listConversations(organizationId: string, filters: {
    status?: string; channel?: string; q?: string; unreadOnly?: boolean;
    assignee?: string; tag?: string; sort?: string;
  } = {}, actorId?: string) {
    const where: any = {
      organizationId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.channel ? { channel: filters.channel } : {}),
      ...(filters.unreadOnly ? { unreadCount: { gt: 0 } } : {}),
      ...(filters.tag ? { tags: { has: filters.tag } } : {}),
    };
    if (filters.assignee === "me" && actorId) where.assignedUserId = actorId;
    else if (filters.assignee === "unassigned") where.assignedUserId = null;
    else if (filters.assignee) where.assignedUserId = filters.assignee;
    if (filters.q) {
      const q = filters.q.trim();
      where.OR = [
        { contactName: { contains: q, mode: "insensitive" } },
        { contactPhone: { contains: q } },
        { lastMessagePreview: { contains: q, mode: "insensitive" } },
      ];
    }
    const rows = await (this.prisma as any).channelConversation.findMany({
      where, orderBy: { lastMessageAt: "desc" }, take: 100,
    });
    if (filters.sort === "unread") {
      rows.sort((a: any, b: any) => (b.unreadCount - a.unreadCount) || (new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime()));
    }
    return rows.map((r: any) => ({ ...r, whatsappWindow: this.whatsappWindow(r) }));
  }

  private async getConversationOrThrow(organizationId: string, conversationId: string) {
    const conv = await (this.prisma as any).channelConversation.findFirst({ where: { id: conversationId, organizationId } });
    if (!conv) throw new NotFoundException("Conversation not found in this organization");
    return conv;
  }

  async getConversation(organizationId: string, conversationId: string) {
    const conv = await this.getConversationOrThrow(organizationId, conversationId);
    const messages = await (this.prisma as any).channelMessage.findMany({
      where: { conversationId }, orderBy: { createdAt: "desc" }, take: 100,
    });
    const drafts = await (this.prisma as any).messageDraft.findMany({
      where: { conversationId, status: "suggested" }, orderBy: { createdAt: "desc" }, take: 5,
    });
    const context = await this.customerContext(organizationId, conv);
    return {
      conversation: { ...conv, whatsappWindow: this.whatsappWindow(conv) },
      botSession: await this.getBotSession(conversationId),
      messages: messages.reverse(), drafts, context,
    };
  }

  // ----- Agent notifications + presence (Phase F) -----
  private async notify(organizationId: string, userId: string, type: string, title: string, body: string | null, conversationId: string | null) {
    await (this.prisma as any).agentNotification?.create({
      data: { organizationId, userId, type, title, body, conversationId },
    }).catch(() => undefined);
  }

  private async notifyUrgent(organizationId: string, conversation: any) {
    const title = `জরুরি কথোপকথন: ${conversation.contactName ?? conversation.externalContactId ?? "গ্রাহক"}`;
    const body = "নেতিবাচক মনোভাব শনাক্ত হয়েছে — অগ্রাধিকার দিয়ে দেখুন।";
    if (conversation.assignedUserId) {
      await this.notify(organizationId, conversation.assignedUserId, "urgent", title, body, conversation.id);
      return;
    }
    const admins = await (this.prisma as any).membership.findMany({
      where: { organizationId, role: { in: ["OWNER", "ADMIN"] } }, take: 10,
    }).catch(() => []);
    for (const m of admins) await this.notify(organizationId, m.userId, "urgent", title, body, conversation.id);
  }

  async listNotifications(organizationId: string, userId: string) {
    const rows = await (this.prisma as any).agentNotification?.findMany({
      where: { organizationId, userId }, orderBy: { createdAt: "desc" }, take: 30,
    }).catch(() => []) ?? [];
    return rows;
  }

  async unreadNotificationCount(organizationId: string, userId: string) {
    const rows = await (this.prisma as any).agentNotification?.findMany({
      where: { organizationId, userId }, orderBy: { createdAt: "desc" }, take: 200,
    }).catch(() => []) ?? [];
    return { count: rows.filter((r: any) => !r.readAt).length };
  }

  async markNotificationRead(organizationId: string, userId: string, notificationId: string) {
    const row = await (this.prisma as any).agentNotification?.findFirst({ where: { id: notificationId, organizationId, userId } }).catch(() => null);
    if (!row) throw new NotFoundException("Notification not found");
    return (this.prisma as any).agentNotification.update({ where: { id: notificationId }, data: { readAt: new Date() } });
  }

  /** Heartbeat: records that this agent is viewing (or typing in) the
   * conversation and returns OTHER agents active within 45 seconds. */
  async heartbeatPresence(organizationId: string, userId: string, conversationId: string, typing: boolean) {
    await this.getConversationOrThrow(organizationId, conversationId);
    const existing = await (this.prisma as any).agentPresence?.findFirst({ where: { conversationId, userId } }).catch(() => null);
    if (existing) {
      await (this.prisma as any).agentPresence.update({ where: { id: existing.id }, data: { typing, lastSeenAt: new Date() } });
    } else {
      await (this.prisma as any).agentPresence?.create({
        data: { organizationId, conversationId, userId, typing, lastSeenAt: new Date() },
      }).catch(() => undefined);
    }
    const cutoff = Date.now() - 45 * 1000;
    const rows = await (this.prisma as any).agentPresence?.findMany({ where: { organizationId, conversationId }, take: 20 }).catch(() => []) ?? [];
    const others = rows.filter((r: any) => r.userId !== userId && new Date(r.lastSeenAt).getTime() > cutoff);
    if (!others.length) return { others: [] };
    const members = await (this.prisma as any).membership.findMany({
      where: { organizationId, userId: { in: others.map((r: any) => r.userId) } }, include: { user: true }, take: 20,
    }).catch(() => []);
    const nameOf = new Map(members.map((m: any) => [m.userId, m.user?.name ?? m.user?.email ?? "Agent"]));
    return { others: others.map((r: any) => ({ userId: r.userId, name: nameOf.get(r.userId) ?? "Agent", typing: r.typing })) };
  }

  /**
   * Everything the agent needs beside the thread: who this customer is,
   * what they bought, what they are worth, and where the lead stands.
   * All figures are computed from real orders; cancelled orders are
   * excluded from lifetime spend and the exclusion is visible in code.
   */
  private async customerContext(organizationId: string, conv: any) {
    const out: any = { customer: null, lead: null, orders: [], lifetime: null };
    if (conv.leadId) {
      const lead = await (this.prisma as any).lead.findFirst({ where: { id: conv.leadId, organizationId } });
      if (lead) out.lead = { ...lead, valueMinor: lead.valueMinor != null ? String(lead.valueMinor) : null };
    }
    if (!conv.customerId) return out;
    const customer = await (this.prisma as any).customer.findFirst({ where: { id: conv.customerId, organizationId } });
    if (!customer) return out;
    out.customer = { id: customer.id, name: customer.name, phone: customer.phone, email: customer.email, createdAt: customer.createdAt };
    const orders = await (this.prisma as any).order.findMany({
      where: { organizationId, customerId: customer.id }, orderBy: { createdAt: "desc" }, take: 50,
    });
    const shipments = orders.length ? await ((this.prisma as any).courierShipment?.findMany({
      where: { organizationId, orderId: { in: orders.map((o: any) => o.id) } }, take: 20,
    })?.catch(() => []) ?? Promise.resolve([])) : [];
    const shipByOrder = new Map<string, any>(shipments.map((sh: any) => [sh.orderId, sh]));
    out.orders = orders.slice(0, 5).map((o: any) => ({
      id: o.id, externalNumber: o.externalNumber, status: o.status, source: o.source,
      isCod: o.isCod, currency: o.currency, totalMinor: String(o.totalMinor), createdAt: o.createdAt,
      codConfirmationStatus: o.codConfirmationStatus ?? null,
      shipment: shipByOrder.get(o.id) ? { trackingCode: shipByOrder.get(o.id).trackingCode, status: shipByOrder.get(o.id).status, provider: shipByOrder.get(o.id).provider } : null,
    }));
    const billable = orders.filter((o: any) => o.status !== "cancelled");
    out.lifetime = {
      orderCount: billable.length,
      totalSpentMinor: String(billable.reduce((sum: bigint, o: any) => sum + BigInt(o.totalMinor), 0n)),
      currency: billable[0]?.currency ?? customer.currency ?? "BDT",
      lastOrderAt: billable[0]?.createdAt ?? null,
    };
    return out;
  }

  // ----- Internal notes (never leave the building) -----
  async listNotes(organizationId: string, conversationId: string) {
    await this.getConversationOrThrow(organizationId, conversationId);
    return (this.prisma as any).conversationNote.findMany({
      where: { conversationId, organizationId }, orderBy: { createdAt: "asc" }, take: 200,
    });
  }

  async addNote(organizationId: string, actorId: string, conversationId: string, content: string) {
    const note = await this.createNoteInternal(organizationId, actorId, conversationId, content);
    await this.notifyMentions(organizationId, actorId, conversationId, content).catch(() => undefined);
    return note;
  }

  private async notifyMentions(organizationId: string, actorId: string, conversationId: string, content: string) {
    const lower = content.toLowerCase();
    if (!lower.includes("@")) return;
    const members = await (this.prisma as any).membership.findMany({
      where: { organizationId }, include: { user: true }, take: 50,
    }).catch(() => []);
    for (const m of members) {
      if (m.userId === actorId) continue;
      const firstName = (m.user?.name ?? "").split(" ")[0]?.toLowerCase();
      const emailPrefix = (m.user?.email ?? "").split("@")[0]?.toLowerCase();
      const hit = (firstName && firstName.length >= 2 && lower.includes(`@${firstName}`))
        || (emailPrefix && emailPrefix.length >= 2 && lower.includes(`@${emailPrefix}`));
      if (hit) {
        await this.notify(organizationId, m.userId, "mention",
          "আপনাকে একটি নোটে মেনশন করা হয়েছে", content.slice(0, 140), conversationId);
      }
    }
  }

  private async createNoteInternal(organizationId: string, actorId: string, conversationId: string, content: string) {
    await this.getConversationOrThrow(organizationId, conversationId);
    const text = content?.trim();
    if (!text) throw new BadRequestException("Note content is required");
    // Deliberately no messaging client here: notes are internal only.
    return (this.prisma as any).conversationNote.create({
      data: { organizationId, conversationId, authorUserId: actorId, content: text.slice(0, 4000) },
    });
  }

  // ----- Quick replies -----
  async listQuickReplies(organizationId: string) {
    return (this.prisma as any).quickReply.findMany({ where: { organizationId }, orderBy: { title: "asc" }, take: 200 });
  }

  async createQuickReply(organizationId: string, actorId: string, dto: { title: string; content: string }) {
    if (!dto.title?.trim() || !dto.content?.trim()) throw new BadRequestException("title and content are required");
    return (this.prisma as any).quickReply.create({
      data: { organizationId, title: dto.title.trim().slice(0, 120), content: dto.content.slice(0, 4000), createdByUserId: actorId },
    });
  }

  async deleteQuickReply(organizationId: string, quickReplyId: string) {
    const row = await (this.prisma as any).quickReply.findFirst({ where: { id: quickReplyId, organizationId } });
    if (!row) throw new NotFoundException("Quick reply not found in this organization");
    await (this.prisma as any).quickReply.delete({ where: { id: quickReplyId } });
    return { deleted: true };
  }

  // ----- WhatsApp template registry + sending -----
  async listWhatsAppTemplates(organizationId: string) {
    return (this.prisma as any).whatsAppTemplate.findMany({ where: { organizationId }, orderBy: { name: "asc" }, take: 200 });
  }

  async createWhatsAppTemplate(organizationId: string, dto: { name: string; language?: string; category?: string; bodyText?: string }) {
    if (!dto.name?.trim()) throw new BadRequestException("Template name is required (must match the name in Meta exactly)");
    const existing = await (this.prisma as any).whatsAppTemplate.findFirst({
      where: { organizationId, name: dto.name.trim(), language: dto.language ?? "bn" },
    });
    if (existing) throw new BadRequestException("This template name + language is already registered");
    return (this.prisma as any).whatsAppTemplate.create({
      data: {
        organizationId, name: dto.name.trim(), language: dto.language ?? "bn",
        category: dto.category ?? null, bodyText: dto.bodyText ?? null,
      },
    });
  }

  async deleteWhatsAppTemplate(organizationId: string, templateId: string) {
    const row = await (this.prisma as any).whatsAppTemplate.findFirst({ where: { id: templateId, organizationId } });
    if (!row) throw new NotFoundException("Template not found in this organization");
    await (this.prisma as any).whatsAppTemplate.delete({ where: { id: templateId } });
    return { deleted: true };
  }

  async markRead(organizationId: string, conversationId: string) {
    await this.getConversationOrThrow(organizationId, conversationId);
    return (this.prisma as any).channelConversation.update({ where: { id: conversationId }, data: { unreadCount: 0 } });
  }

  async updateConversation(organizationId: string, actorId: string, conversationId: string, dto: { status?: string; assignedUserId?: string | null; tags?: string[]; spamFlag?: boolean }) {
    const before = await this.getConversationOrThrow(organizationId, conversationId);
    const beforeAssignee = before.assignedUserId ?? null;
    if (dto.status && !["open", "pending", "closed"].includes(dto.status)) throw new BadRequestException("Invalid status");
    if (dto.assignedUserId) {
      const member = await (this.prisma as any).membership.findFirst({ where: { organizationId, userId: dto.assignedUserId } });
      if (!member) throw new BadRequestException("Assignee is not a member of this organization");
    }
    const data: any = {
      ...(dto.status ? { status: dto.status } : {}),
      ...(dto.assignedUserId !== undefined ? { assignedUserId: dto.assignedUserId } : {}),
    };
    if (dto.status === "closed") data.resolvedAt = new Date();
    if (dto.status === "open" || dto.status === "pending") data.resolvedAt = null;
    if (dto.spamFlag !== undefined) { data.spamFlag = dto.spamFlag; if (dto.spamFlag === false) data.spamReason = null; }
    if (dto.tags !== undefined) data.tags = normalizeTags(dto.tags);
    const updated = await (this.prisma as any).channelConversation.update({ where: { id: conversationId }, data });
    // Closing a real conversation invites a CSAT rating - once, and
    // only when the send actually succeeds (e.g. the WhatsApp window
    // must be open; a failed attempt leaves csatSentAt unset).
    if (dto.status === "closed" && !updated.csatSentAt) {
      const inbound = await (this.prisma as any).channelMessage.findFirst({
        where: { conversationId, direction: "in" },
      }).catch(() => null);
      if (inbound) {
        try {
          await this.sendReply(organizationId, actorId, conversationId,
            "ধন্যবাদ! আমাদের সেবা কেমন লেগেছে জানাবেন? ১ থেকে ৫ এর মধ্যে একটি সংখ্যা পাঠিয়ে রেটিং দিন (৫ = সবচেয়ে ভালো)।");
          await (this.prisma as any).channelConversation.update({
            where: { id: conversationId }, data: { csatSentAt: new Date() },
          });
        } catch { /* window closed or platform error: no CSAT this time */ }
      }
    }
    if (dto.assignedUserId && dto.assignedUserId !== actorId && dto.assignedUserId !== beforeAssignee) {
      await this.notify(organizationId, dto.assignedUserId, "assigned",
        `নতুন কথোপকথন অ্যাসাইন হয়েছে: ${updated.contactName ?? updated.externalContactId ?? "গ্রাহক"}`,
        (updated.lastMessagePreview ?? "").slice(0, 120) || null, conversationId).catch(() => undefined);
    }
    return updated;
  }

  /**
   * Channel delivery for text. WhatsApp/Messenger/Instagram go through
   * the Meta client and count only with a platform message id. Webchat
   * is our own channel: the row itself is the delivery (the visitor's
   * widget polls it), so the id is generated locally.
   */
  private async deliverText(conv: any, content: string): Promise<string> {
    if (conv.channel === "webchat") {
      return `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
    const integration = await this.integrationForConversation(conv);
    const secrets = await this.secretsFor(integration.id);
    const client = new MetaMessagingClient(secrets);
    const { messageId } = conv.channel === "whatsapp"
      ? await client.sendWhatsAppText(conv.externalContactId, content)
      : await client.sendMessengerText(conv.externalContactId, content);
    return messageId;
  }

  /**
   * The ONLY send path. The message row is created as "queued" and becomes
   * "sent" strictly when the platform API returns a message id. Otherwise
   * it is marked "failed" with the platform's error, and an exception is
   * thrown so the UI never shows a false success.
   */
  async sendReply(organizationId: string, actorId: string, conversationId: string, content: string, opts: { viaDraftId?: string } = {}) {
    const conv = await this.getConversationOrThrow(organizationId, conversationId);
    const message = await (this.prisma as any).channelMessage.create({
      data: {
        conversationId, direction: "out", type: "text", content, status: "queued",
        sentByUserId: actorId, sentByAiDraft: Boolean(opts.viaDraftId),
      },
    });
    try {
      const messageId = await this.deliverText(conv, content);
      const sent = await (this.prisma as any).channelMessage.update({
        where: { id: message.id }, data: { status: "sent", externalId: messageId },
      });
      await (this.prisma as any).channelConversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: new Date(), lastMessagePreview: content.slice(0, 120),
          ...(conv.firstResponseAt ? {} : { firstResponseAt: new Date() }),
        },
      });
      // A human reply takes the conversation over from the order bot.
      await (this.prisma as any).botSession?.updateMany?.({ where: { conversationId, status: "active" }, data: { status: "handed_off" } }).catch?.(() => undefined);
      const activeBot = await (this.prisma as any).botSession?.findFirst?.({ where: { conversationId, status: "active" } }).catch?.(() => null);
      if (activeBot) await (this.prisma as any).botSession.update({ where: { id: activeBot.id }, data: { status: "handed_off" } }).catch(() => undefined);
      if (opts.viaDraftId) {
        await (this.prisma as any).messageDraft.update({ where: { id: opts.viaDraftId }, data: { status: "sent" } });
      }
      return sent;
    } catch (e) {
      const error = e instanceof Error ? e.message : "Send failed";
      await (this.prisma as any).channelMessage.update({
        where: { id: message.id }, data: { status: "failed", error },
      });
      throw new BadRequestException(`Message was NOT sent: ${error}`);
    }
  }

  // ----- AI draft replies: suggestion only, never auto-send -----
  async suggestDraft(organizationId: string, actorId: string, conversationId: string) {
    const conv = await this.getConversationOrThrow(organizationId, conversationId);
    const recent = await (this.prisma as any).channelMessage.findMany({
      where: { conversationId }, orderBy: { createdAt: "desc" }, take: 10,
    });
    const history = [...recent].reverse();
    const lastInbound = [...history].reverse().find((m: any) => m.direction === "in");
    const provider = this.llm.getProvider();

    const [profile, policies, products] = await Promise.all([
      (this.prisma as any).businessProfile.findUnique({ where: { organizationId } }),
      (this.prisma as any).businessPolicy.findMany({ where: { organizationId }, take: 10 }),
      (this.prisma as any).product.findMany({ where: { organizationId, status: "ACTIVE" }, take: 100 }),
    ]);
    const matchedProduct = matchProduct(lastInbound?.content ?? "", products);

    let content: string;
    let usage = { inputTokens: 0, outputTokens: 0, estimated: true };
    if (provider.isRealLlm) {
      const knowledge = JSON.stringify({
        business: profile ? { industry: profile.industry, description: profile.description, brandVoice: profile.brandVoice } : null,
        policies: policies.map((p: any) => ({ type: p.type, title: p.title, content: String(p.content).slice(0, 400) })),
        matchedProduct: matchedProduct ? { name: matchedProduct.name, price: formatMinor(BigInt(matchedProduct.priceMinor), matchedProduct.currency), stock: matchedProduct.stockQuantity } : null,
      });
      const result = await provider.complete([
        { role: "system", content: "You draft customer-support replies for approval by a human. Use ONLY the business knowledge provided: never invent prices, stock, discounts, delivery charges or policies. If the knowledge does not cover the question, draft a polite reply that asks a clarifying question or says the team will confirm - do not guess. Reply in the customer's language. Return ONLY the draft text." },
        { role: "user", content: `Business knowledge:\n${knowledge}\n\nConversation (oldest first):\n${history.map((m: any) => `${m.direction === "in" ? "Customer" : "Business"}: ${m.content ?? `[${m.type}]`}`).join("\n")}\n\nDraft the next reply.` },
      ], { maxTokens: 500 });
      content = result.text.trim();
      usage = { inputTokens: result.inputTokens, outputTokens: result.outputTokens, estimated: result.tokensEstimated };
    } else {
      content = templateDraft(lastInbound?.content ?? "", matchedProduct, profile);
    }

    const draft = await (this.prisma as any).messageDraft.create({
      data: { organizationId, conversationId, content, provider: provider.name, createdByUserId: actorId, status: "suggested" },
    });
    await (this.prisma as any).aIUsageRecord.create({
      data: { organizationId, userId: actorId, feature: "draft", provider: provider.name, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, estimated: usage.estimated },
    });
    return draft;
  }

  /**
   * Template send path - same honesty discipline as sendReply: the row
   * is "queued" and becomes "sent" only with a Meta message id.
   * Templates are the only messages allowed outside the 24h window.
   */
  async sendTemplate(organizationId: string, actorId: string, conversationId: string, templateId: string, variables: string[] = []) {
    const conv = await this.getConversationOrThrow(organizationId, conversationId);
    if (conv.channel !== "whatsapp") throw new BadRequestException("Template messages are WhatsApp-only");
    const template = await (this.prisma as any).whatsAppTemplate.findFirst({ where: { id: templateId, organizationId } });
    if (!template) throw new NotFoundException("Template not found in this organization");
    const integration = await this.integrationForConversation(conv);
    const secrets = await this.secretsFor(integration.id);
    const client = new MetaMessagingClient(secrets);
    const preview = renderTemplatePreview(template, variables);
    const message = await (this.prisma as any).channelMessage.create({
      data: { conversationId, direction: "out", type: "template", content: preview, status: "queued", sentByUserId: actorId },
    });
    try {
      const { messageId } = await client.sendWhatsAppTemplate(conv.externalContactId, template.name, template.language, variables);
      const sent = await (this.prisma as any).channelMessage.update({
        where: { id: message.id }, data: { status: "sent", externalId: messageId },
      });
      await (this.prisma as any).channelConversation.update({
        where: { id: conversationId }, data: { lastMessageAt: new Date(), lastMessagePreview: preview.slice(0, 120) },
      });
      return sent;
    } catch (e) {
      const error = e instanceof Error ? e.message : "Template send failed";
      await (this.prisma as any).channelMessage.update({ where: { id: message.id }, data: { status: "failed", error } });
      throw new BadRequestException(`Template message was NOT sent: ${error}`);
    }
  }

  /** Image reply by public URL - same queued -> sent-only-with-id path. */
  async sendImageReply(organizationId: string, actorId: string, conversationId: string, imageUrl: string, caption?: string) {
    const conv = await this.getConversationOrThrow(organizationId, conversationId);
    if (!/^https:\/\//i.test(imageUrl ?? "")) throw new BadRequestException("imageUrl must be a public https URL");
    const integration = await this.integrationForConversation(conv);
    const secrets = await this.secretsFor(integration.id);
    const client = new MetaMessagingClient(secrets);
    const message = await (this.prisma as any).channelMessage.create({
      data: { conversationId, direction: "out", type: "image", content: caption ?? null, mediaUrl: imageUrl, status: "queued", sentByUserId: actorId },
    });
    try {
      const { messageId } = conv.channel === "whatsapp"
        ? await client.sendWhatsAppImage(conv.externalContactId, imageUrl, caption)
        : await client.sendMessengerImage(conv.externalContactId, imageUrl);
      const sent = await (this.prisma as any).channelMessage.update({
        where: { id: message.id }, data: { status: "sent", externalId: messageId },
      });
      await (this.prisma as any).channelConversation.update({
        where: { id: conversationId }, data: { lastMessageAt: new Date(), lastMessagePreview: (caption ?? "[image]").slice(0, 120) },
      });
      return sent;
    } catch (e) {
      const error = e instanceof Error ? e.message : "Image send failed";
      await (this.prisma as any).channelMessage.update({ where: { id: message.id }, data: { status: "failed", error } });
      throw new BadRequestException(`Image was NOT sent: ${error}`);
    }
  }

  /**
   * Resolves a message's media bytes for the authenticated agent UI.
   * Messenger attachments have direct URLs; WhatsApp media goes through
   * the Graph API with the integration token. Bytes are proxied, the
   * platform token never reaches the browser.
   */
  async getMessageMedia(organizationId: string, conversationId: string, messageId: string): Promise<{ bytes: Buffer; contentType: string }> {
    const conv = await this.getConversationOrThrow(organizationId, conversationId);
    const message = await (this.prisma as any).channelMessage.findFirst({ where: { id: messageId, conversationId } });
    if (!message) throw new NotFoundException("Message not found in this conversation");
    if (message.mediaId) {
      const integration = await this.integrationForConversation(conv);
      const secrets = await this.secretsFor(integration.id);
      return new MetaMessagingClient(secrets).downloadWhatsAppMedia(message.mediaId);
    }
    if (message.mediaUrl) {
      const res = await fetch(message.mediaUrl);
      if (!res.ok) throw new BadRequestException(`Media fetch failed (${res.status})`);
      return { bytes: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
    }
    throw new NotFoundException("This message has no media");
  }

  async dismissDraft(organizationId: string, conversationId: string, draftId: string) {
    await this.getConversationOrThrow(organizationId, conversationId);
    const draft = await (this.prisma as any).messageDraft.findFirst({ where: { id: draftId, conversationId, organizationId } });
    if (!draft) throw new NotFoundException("Draft not found");
    return (this.prisma as any).messageDraft.update({ where: { id: draftId }, data: { status: "dismissed" } });
  }

  async sendDraft(organizationId: string, actorId: string, conversationId: string, draftId: string, editedContent?: string) {
    await this.getConversationOrThrow(organizationId, conversationId);
    const draft = await (this.prisma as any).messageDraft.findFirst({ where: { id: draftId, conversationId, organizationId } });
    if (!draft) throw new NotFoundException("Draft not found");
    if (draft.status !== "suggested") throw new BadRequestException("Draft is no longer pending");
    const content = (editedContent ?? draft.content).trim();
    if (!content) throw new BadRequestException("Message content is empty");
    return this.sendReply(organizationId, actorId, conversationId, content, { viaDraftId: draftId });
  }
}

export function matchProduct(text: string, products: any[]): any | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  let best: any = null; let bestScore = 0;
  for (const p of products) {
    const words = String(p.name).toLowerCase().split(/[^a-z0-9\u0980-\u09FF]+/).filter((w: string) => w.length >= 3);
    const score = words.filter((w: string) => lower.includes(w)).length;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return bestScore > 0 ? best : null;
}

/** Deterministic draft for the dev-template provider: grounded in real
 *  product/policy data when found, otherwise an honest "we will confirm"
 *  placeholder - it never invents a price or a policy. */
export function templateDraft(lastInbound: string, product: any | null, profile: any | null): string {
  const greeting = "আসসালামু আলাইকুম!";
  const text = lastInbound.toLowerCase();
  const asksPrice = /দাম|price|কত টাকা|cost/.test(text);
  const asksDelivery = /ডেলিভারি|delivery|শিপিং|shipping|কুরিয়ার/.test(text);
  const asksStock = /স্টক|stock|আছে কি|available|in stock/.test(text);
  if (asksPrice && product) {
    return `${greeting} ${product.name} এর দাম ${formatMinor(BigInt(product.priceMinor), product.currency)}। অর্ডার করতে চাইলে আপনার নাম, ঠিকানা ও ফোন নম্বর দিন, আমরা বাকি প্রক্রিয়া সম্পন্ন করে দেব।`;
  }
  if (asksStock && product) {
    return product.stockQuantity !== null && product.stockQuantity !== undefined
      ? `${greeting} হ্যাঁ, ${product.name} এখন স্টকে আছে (${product.stockQuantity}টি)। অর্ডার করতে চাইলে জানাবেন।`
      : `${greeting} ${product.name} এর স্টক যাচাই করে একটু পরেই নিশ্চিত করছি।`;
  }
  if (asksDelivery) {
    return `${greeting} ডেলিভারি চার্জ ও সময় আপনার এলাকা অনুযায়ী জানিয়ে দিচ্ছি, অনুগ্রহ করে আপনার জেলা/এলাকার নামটি বলুন।`;
  }
  if (product) {
    return `${greeting} ${product.name} সম্পর্কে জানতে চাওয়ার জন্য ধন্যবাদ। দাম ${formatMinor(BigInt(product.priceMinor), product.currency)}। আর কিছু জানতে চাইলে জিজ্ঞেস করুন।`;
  }
  const business = profile?.industry ? "" : "";
  return `${greeting} আপনার বার্তার জন্য ধন্যবাদ।${business} আপনার প্রশ্নটি দেখে নিশ্চিত উত্তর জানাচ্ছি, অনুগ্রহ করে একটু অপেক্ষা করুন।`;
}

/** Trim, drop empties, dedupe, cap count and length. Shared by conversations and leads. */
export function normalizeTags(tags: string[]): string[] {
  // Dedupe is case-insensitive ("VIP" and "vip" are the same tag to an
  // agent) but the first occurrence's casing is what gets displayed.
  const seen = new Map<string, string>();
  for (const raw of tags ?? []) {
    const t = String(raw).trim().slice(0, 30);
    if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
    if (seen.size >= 10) break;
  }
  return [...seen.values()];
}

/** Agent-facing preview of a template send: bodyText with {{1}}, {{2}}... filled. */
export function renderTemplatePreview(template: { name: string; bodyText?: string | null }, variables: string[]): string {
  if (!template.bodyText) return `[Template: ${template.name}]`;
  return template.bodyText.replace(/\{\{(\d+)\}\}/g, (_m, n) => variables[Number(n) - 1] ?? `{{${n}}}`);
}
