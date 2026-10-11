import { ensurePlatformConfig, getPlatformConfigSync, resolveMessagingAppSecret } from "../common/platform-config";
import { BadRequestException, ForbiddenException, HttpException, Injectable, NotFoundException, Optional } from "@nestjs/common";
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
import { orgFlagEnabled } from "../common/feature-flags";
import { RealtimeService } from "./realtime.service";
import { isValidTimezone, isValidWindows, isWithinSchedule } from "./working-hours";
import { contactFactLines, deliveryFactLines, hoursFactLines, matchKnowledge, paymentFactLines } from "./business-brain";
import { MediaStore, mediaKeyFor } from "./media-store";
import { detectMediaKind, defaultMediaFileName, type MediaKind } from "./media-sniff";
import { composeProductCardText } from "./product-card";
import { classifyIntent, moodFromMessages, parseCodReply, type Classification } from "./intent";
import { extractPaymentScreenshot, transcribeAudio } from "./media-intelligence";
import { formatMinor } from "@repo/contracts";
import { RiskService } from "../orders/risk.service";
import { LeadAssignmentService } from "../crm/lead-assignment.service";

const STATUS_RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3 };

/** Inbox Next-Gen P1: decoded-size cap for browser-uploaded media.
 * 2MB of bytes is ~2.7MB of base64, inside the 3MB JSON body limit. */
export const MEDIA_UPLOAD_MAX_BYTES = 2_000_000;

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
    @Optional() private readonly realtime?: RealtimeService,
    @Optional() private readonly risk?: RiskService,
    // CRM C5: lead auto-assignment for the leads this service
    // creates directly (leadgen, first-message). Optional — a
    // missing engine leaves those leads unassigned, as before.
    @Optional() private readonly leadAssignment?: LeadAssignmentService,
  ) {}

  // ----- Realtime fan-out (Unified Inbox U1) -----
  private rtMessage(organizationId: string, conversationId: string, message: unknown) {
    try { this.realtime?.emit(organizationId, { type: "message.created", conversationId, message }); } catch { /* realtime never breaks messaging */ }
  }
  private rtConversation(organizationId: string, conversationId: string, patch?: Record<string, unknown>) {
    try { this.realtime?.emit(organizationId, { type: "conversation.updated", conversationId, patch }); } catch { /* ditto */ }
  }
  /** Public hook for sibling services (webchat) in the same module. */
  emitInboxEvent(organizationId: string, event: { type: "message.created" | "conversation.updated"; conversationId: string; message?: unknown }) {
    if (event.type === "message.created") this.rtMessage(organizationId, event.conversationId, event.message);
    else this.rtConversation(organizationId, event.conversationId);
  }

  /** Inbox Next-Gen P3: a webchat visitor's presence/typing,
   * fanned out to the org's agent stream (the agents' counterpart
   * of notifyVisitorTyping, which goes visitor-ward). Public hook
   * for WebchatService, mirroring emitInboxEvent. */
  emitVisitorPresence(organizationId: string, conversationId: string, typing: boolean) {
    try { this.realtime?.emit(organizationId, { type: "visitor.presence", conversationId, visitorTyping: typing }); } catch { /* realtime never breaks messaging */ }
  }

  // ----- Inbox Next-Gen P3: AI enforcement parity -----
  /**
   * The per-org AI kill switch + plan daily cap, per feature —
   * the same enforcement ai/chat and ai/creative-studio already
   * apply (audit item 10: inbox LLM features checked NEITHER).
   * Applied to the AGENT-INITIATED features (draft, summary,
   * translate, ghost_complete, tone_rewrite). The autopilot path
   * (composeLlmGroundedReply / maybeAutoReply) is deliberately
   * NOT gated here: it is not agent-initiated, it runs per inbound
   * customer message under its own confidence/grounding rules, and
   * charging it against the agent-facing daily cap would let a
   * busy inbox silently disable drafting for the whole day.
   */
  private async checkAiAllowed(organizationId: string, feature: string) {
    const { killSwitches, effectiveLimits } = await import("../common/platform-settings");
    const ks = await killSwitches(this.prisma as any);
    if (ks.aiDisabledOrgIds.includes(organizationId)) {
      throw new HttpException("AI features are temporarily disabled for this organization by the platform team.", 403);
    }
    const baseline = Number(process.env.AI_DAILY_MESSAGE_LIMIT ?? 200);
    const { aiDaily: limit } = await effectiveLimits(this.prisma as any, organizationId, { aiDaily: baseline, broadcastCap: 1000 });
    const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
    const used = await (this.prisma as any).aIUsageRecord.count({ where: { organizationId, feature, createdAt: { gte: startOfDay } } });
    if (used >= limit) throw new HttpException(`Daily AI limit reached for this organization (${limit}). Try again tomorrow or ask the platform team to raise your plan limit.`, 429);
  }

  /** Defensive batch read for read-time projections: a partial
   * fake (or a not-yet-migrated table) degrades to no rows instead
   * of breaking the conversation list/detail. */
  private async safeFindMany(table: string, args: any): Promise<any[]> {
    try {
      const rows = await (this.prisma as any)[table]?.findMany?.(args);
      return Array.isArray(rows) ? rows : [];
    } catch { return []; }
  }

  /** Inbox Next-Gen P3: thread mood from the newest inbound texts
   * (rows arrive newest-first; empty contents are media rows). */
  private moodOf(rows: { content?: string | null }[]): "positive" | "neutral" | "negative" | null {
    const texts = rows.filter((r) => r.content && String(r.content).trim()).slice(0, 5).map((r) => String(r.content));
    return moodFromMessages(texts);
  }

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
      this.rtMessage(organizationId, conversation.id, stored);
      if (stored.mediaId || stored.mediaUrl) {
        await this.captureMessageMedia(organizationId, conversation, stored).catch(() => undefined);
      }
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

  /**
   * Generic channel ingest (Unified Inbox U4): the single entry
   * every non-Meta channel uses to land a customer message —
   * dedupe by external id, conversation upsert, unread + realtime,
   * then the full intelligence pipeline (classification,
   * assignment, bot, autopilot). Returns "duplicate" when the
   * platform re-delivers an already-stored message.
   */
  async ingestExternalMessage(input: {
    organizationId: string; integrationId: string; channel: string;
    externalContactId: string; contactName?: string; contactPhone?: string;
    externalId: string; content: string; timestamp?: Date; subject?: string;
  }): Promise<"stored" | "duplicate"> {
    const conversation = await this.findOrCreateConversation(
      input.organizationId, input.integrationId, input.channel, input.externalContactId, input.contactName,
    );
    if (input.subject && !(conversation as any).subject) {
      await (this.prisma as any).channelConversation.update({
        where: { id: conversation.id }, data: { subject: input.subject },
      }).catch(() => undefined);
    }
    const existing = await (this.prisma as any).channelMessage.findFirst({
      where: { conversationId: conversation.id, externalId: input.externalId },
    });
    if (existing) return "duplicate";
    const at = input.timestamp ?? new Date();
    const stored = await (this.prisma as any).channelMessage.create({
      data: {
        conversationId: conversation.id, direction: "in", externalId: input.externalId,
        type: "text", content: input.content, status: "received", platformTimestamp: at,
      },
    });
    await (this.prisma as any).channelConversation.update({
      where: { id: conversation.id },
      data: {
        unreadCount: { increment: 1 }, lastMessageAt: at, lastCustomerMessageAt: at,
        lastMessagePreview: input.content.slice(0, 120), status: "open",
        ...(input.contactPhone && !conversation.contactPhone ? { contactPhone: input.contactPhone } : {}),
      },
    });
    this.rtMessage(input.organizationId, conversation.id, stored);
    await this.processInboundIntelligence(input.organizationId, conversation, stored, { content: input.content }).catch(() => undefined);
    return "stored";
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
    // CRM C5: the org's lead auto-assignment strategy applies to
    // ingested leads too (no actor here — the lead starts
    // unassigned and only the strategy may give it an owner).
    await this.leadAssignment?.assignNewLead(organizationId, lead.id).catch(() => undefined);
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
      // CRM C5: same auto-assignment as every other creation path.
      await this.leadAssignment?.assignNewLead(organizationId, lead.id).catch(() => undefined);
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
      reassignAfterMinutes: row?.reassignAfterMinutes ?? null,
      escalationTeamId: row?.escalationTeamId ?? null,
      perChannelModes: row?.perChannelModes ?? {},
      escalationThresholdMinor: row?.escalationThresholdMinor ?? null,
      retentionDays: row?.retentionDays ?? null,
      botEnabled: row?.botEnabled ?? false,
      botDeliveryChargeMinor: row?.botDeliveryChargeMinor ?? null,
    };
  }

  async updateSettings(organizationId: string, actorId: string, dto: {
    autoReplyMode?: string; confidenceThreshold?: number; perIntent?: Record<string, string>;
    smartAssign?: string; slaFirstResponseMinutes?: number;
    botEnabled?: boolean; botDeliveryChargeMinor?: number | null;
    reassignAfterMinutes?: number | null; escalationTeamId?: string | null;
    perChannelModes?: Record<string, string>; escalationThresholdMinor?: number | null;
    retentionDays?: number | null;
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
    if (dto.perChannelModes) {
      for (const [channel, m] of Object.entries(dto.perChannelModes)) {
        if (!["whatsapp", "messenger", "instagram", "webchat", "tiktok", "telegram", "email"].includes(channel)) throw new BadRequestException(`Unknown channel: ${channel}`);
        if (!modes.includes(m)) throw new BadRequestException(`Invalid mode for channel ${channel}: ${m}`);
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
      ...(dto.reassignAfterMinutes !== undefined ? { reassignAfterMinutes: dto.reassignAfterMinutes === null ? null : Math.min(10080, Math.max(5, Math.round(dto.reassignAfterMinutes))) } : {}),
      ...(dto.escalationTeamId !== undefined ? { escalationTeamId: dto.escalationTeamId || null } : {}),
      ...(dto.perChannelModes ? { perChannelModes: dto.perChannelModes } : {}),
      ...(dto.escalationThresholdMinor !== undefined ? { escalationThresholdMinor: dto.escalationThresholdMinor === null ? null : Math.max(0, Math.round(dto.escalationThresholdMinor)) } : {}),
      ...(dto.retentionDays !== undefined ? { retentionDays: dto.retentionDays === null ? null : Math.min(3650, Math.max(7, Math.round(dto.retentionDays))) } : {}),
    };
    const existing = await (this.prisma as any).inboxSetting.findUnique({ where: { organizationId } }).catch(() => null);
    const saved = existing
      ? await (this.prisma as any).inboxSetting.update({ where: { organizationId }, data })
      : await (this.prisma as any).inboxSetting.create({ data: { organizationId, ...data } });
    await this.audit.log({ organizationId, userId: actorId, action: "inbox.settings.updated", entityType: "InboxSetting", entityId: saved.id, metadata: data });
    return this.getSettings(organizationId);
  }

  /** Round-robin / least-busy assignment among support-capable members. */
  // ----- Unified Inbox U2: teams, agent state, assignment engine -----

  // Unified Inbox U5: control center.
  static readonly PIPELINE_STAGES = ["new", "talking", "ordered", "delivered", "repeat"] as const;
  static readonly CONVERSATION_OUTCOMES = ["sale", "no_sale_price", "no_sale_stock", "no_sale_undecided", "support_resolved", "spam", "other"] as const;
  private static readonly STAGE_RANK: Record<string, number> = { new: 0, talking: 1, ordered: 2, delivered: 3, repeat: 4 };

  static readonly TEAM_CHANNELS = ["whatsapp", "messenger", "instagram", "webchat", "tiktok", "telegram", "email"];
  static readonly AGENT_STATUSES = ["online", "busy", "away"];

  /** Milestone 71: resolve a team + the actor's right to act
   * on it. Managers (OWNER/ADMIN/MARKETING_MANAGER) act on any
   * team; a team's lead acts on their own. Returns the team and
   * its member ids. Throws 404 / 403 as appropriate. */
  private async teamScope(organizationId: string, actorId: string, teamId: string) {
    const p = this.prisma as any;
    const team = await p.inboxTeam.findFirst({ where: { id: teamId, organizationId } });
    if (!team) throw new NotFoundException("Team not found");
    const actor = await p.membership.findUnique({
      where: { userId_organizationId: { userId: actorId, organizationId } },
    }).catch(() => null);
    const isManager = actor && ["OWNER", "ADMIN", "MARKETING_MANAGER"].includes(actor.role);
    if (!isManager && team.leadUserId !== actorId) {
      throw new ForbiddenException("Only the team's lead or an organization manager can do this");
    }
    const roster = await p.inboxTeamMember?.findMany({ where: { teamId } }).catch(() => []) ?? [];
    return { team, memberIds: (roster as any[]).map((r) => r.userId) };
  }

  async listTeams(organizationId: string) {
    const p = this.prisma as any;
    const teams = await p.inboxTeam?.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } }).catch(() => []) ?? [];
    const memberships = await p.membership.findMany({ where: { organizationId }, include: { user: true }, take: 100 }).catch(() => []);
    const nameOf = new Map((memberships as any[]).map((m) => [m.userId, m.user?.name ?? m.user?.email ?? null]));
    const out: any[] = [];
    for (const t of teams as any[]) {
      const members = await p.inboxTeamMember?.findMany({ where: { teamId: t.id } }).catch(() => []) ?? [];
      const open = await p.channelConversation.count({ where: { organizationId, teamId: t.id, status: "open" } }).catch(() => 0);
      out.push({ ...t, members, openCount: open, leadName: t.leadUserId ? nameOf.get(t.leadUserId) ?? null : null });
    }
    return out;
  }

  async createTeam(organizationId: string, actorId: string, dto: { name: string; channels?: string[] }) {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException("Team name is required");
    const channels = (dto.channels ?? []).filter((c) => InboxService.TEAM_CHANNELS.includes(c));
    const row = await (this.prisma as any).inboxTeam.create({ data: { organizationId, name: name.slice(0, 80), channels } });
    await this.audit.log({ organizationId, userId: actorId, action: "inbox.team.created", entityType: "InboxTeam", entityId: row.id, metadata: { name, channels } });
    return row;
  }

  async updateTeam(organizationId: string, actorId: string, teamId: string, dto: { name?: string; channels?: string[]; leadUserId?: string | null }) {
    const p = this.prisma as any;
    const team = await p.inboxTeam.findFirst({ where: { id: teamId, organizationId } });
    if (!team) throw new NotFoundException("Team not found");
    const data: any = {};
    if (dto.name !== undefined) { if (!dto.name.trim()) throw new BadRequestException("Team name is required"); data.name = dto.name.trim().slice(0, 80); }
    if (dto.channels !== undefined) data.channels = dto.channels.filter((c: string) => InboxService.TEAM_CHANNELS.includes(c));
    // Milestone 71: setting the lead. The lead must be an org
    // member (any role); null clears the lead.
    if (dto.leadUserId !== undefined) {
      if (dto.leadUserId === null) data.leadUserId = null;
      else {
        const member = await p.membership.findFirst({ where: { organizationId, userId: dto.leadUserId } });
        if (!member) throw new BadRequestException("The lead must be a member of this organization");
        data.leadUserId = dto.leadUserId;
      }
    }
    const row = await p.inboxTeam.update({ where: { id: teamId }, data });
    await this.audit.log({ organizationId, userId: actorId, action: "inbox.team.updated", entityType: "InboxTeam", entityId: teamId, metadata: data });
    return row;
  }

  async deleteTeam(organizationId: string, actorId: string, teamId: string) {
    const p = this.prisma as any;
    const team = await p.inboxTeam.findFirst({ where: { id: teamId, organizationId } });
    if (!team) throw new NotFoundException("Team not found");
    await p.inboxTeamMember?.deleteMany({ where: { teamId } }).catch(() => undefined);
    await p.channelConversation.updateMany({ where: { organizationId, teamId }, data: { teamId: null } }).catch(() => undefined);
    await p.inboxTeam.delete({ where: { id: teamId } });
    await this.audit.log({ organizationId, userId: actorId, action: "inbox.team.deleted", entityType: "InboxTeam", entityId: teamId, metadata: { name: team.name } });
    return { deleted: true };
  }

  async setTeamMembers(organizationId: string, actorId: string, teamId: string, members: { userId: string; capacity?: number }[]) {
    const p = this.prisma as any;
    const team = await p.inboxTeam.findFirst({ where: { id: teamId, organizationId } });
    if (!team) throw new NotFoundException("Team not found");
    // Milestone 71: org managers manage any roster; the team's
    // own lead manages theirs. (The controller's @Roles admits
    // agents so a lead can reach this; the right is enforced
    // here.) OWNER/ADMIN keep their guard-level fast path.
    const actor = await p.membership.findUnique({
      where: { userId_organizationId: { userId: actorId, organizationId } },
    }).catch(() => null);
    const actorOk = actor && (["OWNER", "ADMIN", "MARKETING_MANAGER"].includes(actor.role) || team.leadUserId === actorId);
    if (!actorOk) throw new ForbiddenException("Only the team's lead or an organization manager can set the roster");
    const cleaned: { userId: string; capacity: number }[] = [];
    for (const m of members ?? []) {
      const membership = await p.membership.findFirst({ where: { organizationId, userId: m.userId } });
      if (!membership) throw new BadRequestException(`User ${m.userId} is not a member of this organization`);
      cleaned.push({ userId: m.userId, capacity: Math.min(200, Math.max(1, Math.round(Number(m.capacity ?? 20)) || 20)) });
    }
    await p.inboxTeamMember.deleteMany({ where: { teamId } });
    for (const m of cleaned) {
      await p.inboxTeamMember.create({ data: { teamId, userId: m.userId, capacity: m.capacity } });
    }
    await this.audit.log({ organizationId, userId: actorId, action: "inbox.team.members_set", entityType: "InboxTeam", entityId: teamId, metadata: { count: cleaned.length } });
    return this.listTeams(organizationId);
  }

  async setAgentState(organizationId: string, userId: string, status: string) {
    if (!InboxService.AGENT_STATUSES.includes(status)) throw new BadRequestException("status must be online | busy | away");
    const p = this.prisma as any;
    const row = await p.agentState.upsert({
      where: { organizationId_userId: { organizationId, userId } },
      create: { organizationId, userId, status },
      update: { status },
    });
    return { userId, status: row.status, updatedAt: row.updatedAt };
  }

  // ---------- Milestone 68 (Team T2): working hours ----------

  /** Schedules for every agent-role member, with the live
   * on-shift verdict computed for "now". */
  async listAgentSchedules(organizationId: string) {
    const p = this.prisma as any;
    const memberships = await p.membership.findMany({ where: { organizationId }, include: { user: true }, take: 100 });
    const schedules = await p.agentSchedule?.findMany({ where: { organizationId } }).catch(() => []) ?? [];
    const schedOf = new Map((schedules as any[]).map((s) => [s.userId, s]));
    const now = new Date();
    return (memberships as any[])
      .filter((m) => ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"].includes(m.role))
      .map((m) => {
        const s = schedOf.get(m.userId);
        return {
          userId: m.userId,
          name: m.user?.name ?? m.user?.email ?? "Agent",
          email: m.user?.email ?? null,
          role: m.role,
          timezone: s?.timezone ?? "Asia/Dhaka",
          windows: s?.windows ?? {},
          hasSchedule: Boolean(s),
          onShift: s ? isWithinSchedule(s as any, now) : true,
        };
      });
  }

  /** Managers (OWNER/ADMIN/MARKETING_MANAGER) set anyone's
   * schedule; an agent may only set their own. */
  async setAgentSchedule(organizationId: string, actorId: string, targetUserId: string, dto: { timezone?: string; windows: unknown }) {
    const p = this.prisma as any;
    const actor = await p.membership.findUnique({
      where: { userId_organizationId: { userId: actorId, organizationId } },
    });
    if (!actor || actor.status !== "ACTIVE") throw new NotFoundException("Actor is not an active member of this organization");
    const isManager = ["OWNER", "ADMIN", "MARKETING_MANAGER"].includes(actor.role);
    if (!isManager && actorId !== targetUserId) throw new BadRequestException("Agents can only set their own schedule");
    const target = await p.membership.findUnique({
      where: { userId_organizationId: { userId: targetUserId, organizationId } },
    });
    if (!target) throw new NotFoundException("That user is not a member of this organization");
    if (!isValidWindows(dto.windows)) {
      throw new BadRequestException("Invalid windows: use weekday keys (mon..sun) with [\"HH:MM\",\"HH:MM\"] pairs; start and end must differ");
    }
    const timezone = dto.timezone?.trim() || "Asia/Dhaka";
    if (!isValidTimezone(timezone)) throw new BadRequestException(`Unknown timezone: ${timezone}`);
    const row = await p.agentSchedule.upsert({
      where: { organizationId_userId: { organizationId, userId: targetUserId } },
      create: { organizationId, userId: targetUserId, timezone, windows: dto.windows as any },
      update: { timezone, windows: dto.windows as any },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "inbox.agent_schedule_updated", entityType: "AgentSchedule", entityId: row.id,
      metadata: { targetUserId, timezone },
    });
    return { userId: targetUserId, timezone: row.timezone, windows: row.windows, onShift: isWithinSchedule(row as any, new Date()) };
  }

  async deleteAgentSchedule(organizationId: string, actorId: string, targetUserId: string) {
    const p = this.prisma as any;
    const actor = await p.membership.findUnique({
      where: { userId_organizationId: { userId: actorId, organizationId } },
    });
    if (!actor || actor.status !== "ACTIVE") throw new NotFoundException("Actor is not an active member of this organization");
    const isManager = ["OWNER", "ADMIN", "MARKETING_MANAGER"].includes(actor.role);
    if (!isManager && actorId !== targetUserId) throw new BadRequestException("Agents can only manage their own schedule");
    await p.agentSchedule.deleteMany({ where: { organizationId, userId: targetUserId } });
    await this.audit.log({
      organizationId, userId: actorId, action: "inbox.agent_schedule_cleared", entityType: "AgentSchedule", entityId: targetUserId,
      metadata: { targetUserId },
    });
    return { ok: true, userId: targetUserId, hasSchedule: false };
  }

  // ---------- Milestone 69 (Team W1): activity & idle ----------

  /** Org-level heartbeat from the tenant web app (~60s). Only
   * stamps AgentState.lastActiveAt; never audited (too frequent). */
  async heartbeat(organizationId: string, userId: string) {
    const p = this.prisma as any;
    const now = new Date();
    await p.agentState.upsert({
      where: { organizationId_userId: { organizationId, userId } },
      create: { organizationId, userId, status: "online", lastActiveAt: now },
      update: { lastActiveAt: now },
    });
    return { ok: true, lastActiveAt: now };
  }

  /** UTC instant of local midnight (start of today) in `tz`. */
  private static dayStartUtc(tz: string, now: Date): Date {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const get = (t: string) => Number(parts.find((x) => x.type === t)?.value ?? 0);
    const y = get("year"); const m = get("month"); const d = get("day");
    let guess = Date.UTC(y, m - 1, d, 0, 0, 0);
    for (let i = 0; i < 2; i++) {
      const local = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(guess));
      const g = (t: string) => Number(local.find((x) => x.type === t)?.value ?? 0);
      const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
      guess -= asUtc - Date.UTC(y, m - 1, d, 0, 0, 0);
    }
    return new Date(guess);
  }

  /**
   * The owner's "who is working" board, compute-on-read from
   * real rows: presence (AgentState), today's replies sent,
   * conversations closed (assignee at close), audit actions,
   * and the derived activity state:
   *   away (manual) → away; a real action ≤15m ago → active;
   *   app heartbeat fresh (≤3m) but no action for 15m+ → idle;
   *   otherwise → offline. Actions are the work signal; the
   *   heartbeat is presence only. The UI labels the rule
   *   honestly — it is a signal, not proof of work.
   */
  async teamActivity(organizationId: string, tz = "Asia/Dhaka") {
    const p = this.prisma as any;
    const safeTz = isValidTimezone(tz) ? tz : "Asia/Dhaka";
    const now = new Date();
    const start = InboxService.dayStartUtc(safeTz, now);
    const end = new Date(start.getTime() + 24 * 3600 * 1000);
    const inWindow = { gte: start, lt: end };
    const memberships = await p.membership.findMany({ where: { organizationId }, include: { user: true }, take: 100 });
    const states = await p.agentState?.findMany({ where: { organizationId } }).catch(() => []) ?? [];
    const stateOf = new Map((states as any[]).map((r) => [r.userId, r]));
    const schedules = await p.agentSchedule?.findMany({ where: { organizationId } }).catch(() => []) ?? [];
    const schedOf = new Map((schedules as any[]).map((s) => [s.userId, s]));
    const rows: any[] = [];
    for (const m of (memberships as any[]).filter((x) => ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"].includes(x.role))) {
      const userId = m.userId;
      // ChannelMessage has no organizationId (scoped via its
      // conversation) and records the sender as sentByUserId
      // with direction "out"; auto-replies are not the agent's
      // work and failed sends never reached the customer.
      const myMessages = { conversation: { organizationId }, sentByUserId: userId, direction: "out", autoReply: false, status: { not: "failed" } };
      const [repliesSent, closedToday, auditActions, openNow, lastMsg, lastAudit] = await Promise.all([
        p.channelMessage.count({ where: { ...myMessages, createdAt: inWindow } }).catch(() => 0),
        p.channelConversation.count({ where: { organizationId, assignedUserId: userId, status: "closed", resolvedAt: inWindow } }).catch(() => 0),
        p.auditLog.count({ where: { organizationId, userId, createdAt: inWindow } }).catch(() => 0),
        p.channelConversation.count({ where: { organizationId, assignedUserId: userId, status: "open" } }).catch(() => 0),
        p.channelMessage.findFirst({ where: myMessages, orderBy: { createdAt: "desc" } }).catch(() => null),
        p.auditLog.findFirst({ where: { organizationId, userId }, orderBy: { createdAt: "desc" } }).catch(() => null),
      ]);
      const st = stateOf.get(userId);
      const heartbeatAt: Date | null = st?.lastActiveAt ? new Date(st.lastActiveAt) : null;
      const actionTimes = [lastMsg?.createdAt, lastAudit?.createdAt].filter(Boolean).map((d) => new Date(d as any).getTime());
      const lastActionAt = actionTimes.length ? new Date(Math.max(...actionTimes)) : null;
      // The ladder: actions are the WORK signal; the heartbeat
      // is only presence. Recent work → active; app open but no
      // work for 15m+ → idle; neither → offline.
      const actionAgeMin = lastActionAt ? (now.getTime() - lastActionAt.getTime()) / 60000 : null;
      const heartbeatAgeMin = heartbeatAt ? (now.getTime() - heartbeatAt.getTime()) / 60000 : null;
      let activityState: string;
      if (st?.status === "away") activityState = "away";
      else if (actionAgeMin !== null && actionAgeMin <= 15) activityState = "active";
      else if (heartbeatAgeMin !== null && heartbeatAgeMin <= 3) activityState = "idle";
      else activityState = "offline";
      rows.push({
        userId,
        name: m.user?.name ?? m.user?.email ?? "Agent",
        email: m.user?.email ?? null,
        role: m.role,
        membershipStatus: m.status,
        presenceStatus: st?.status ?? "online",
        activityState,
        heartbeatAt,
        lastActionAt,
        onShift: schedOf.has(userId) ? isWithinSchedule(schedOf.get(userId) as any, now) : true,
        hasSchedule: schedOf.has(userId),
        today: { repliesSent, closedToday, auditActions, openNow },
      });
    }
    return { timezone: safeTz, dayStart: start, idleAfterMinutes: 15, members: rows };
  }

  // ---------- Milestone 70 (Team W2): performance scorecard ----------

  /**
   * Windowed per-agent stats with getTeamReport's semantics:
   * assigned/first-response by conversation createdAt, closed/
   * resolution by resolvedAt, CSAT by csatRatedAt — plus human
   * replies (M69's message rules). All attributed by assignee.
   */
  private async scoreWindow(organizationId: string, memberIds: string[], from: Date, to: Date) {
    const p = this.prisma as any;
    const win = { gte: from, lt: to };
    const [created, resolved, rated, messages] = await Promise.all([
      p.channelConversation.findMany({ where: { organizationId, createdAt: win }, take: 5000 }).catch(() => []),
      p.channelConversation.findMany({ where: { organizationId, resolvedAt: win }, take: 5000 }).catch(() => []),
      p.channelConversation.findMany({ where: { organizationId, csatRatedAt: win }, take: 5000 }).catch(() => []),
      memberIds.length
        ? p.channelMessage.findMany({
            where: { conversation: { organizationId }, sentByUserId: { in: memberIds }, direction: "out", autoReply: false, status: { not: "failed" }, createdAt: win },
            take: 5000,
          }).catch(() => [])
        : [],
    ]);
    const stats = new Map<string, { assigned: number; closed: number; resp: number[]; res: number[]; csat: number[]; replies: number }>();
    const row = (uid: string) => {
      let r = stats.get(uid);
      if (!r) { r = { assigned: 0, closed: 0, resp: [], res: [], csat: [], replies: 0 }; stats.set(uid, r); }
      return r;
    };
    for (const c of created as any[]) {
      if (!c.assignedUserId) continue;
      const r = row(c.assignedUserId); r.assigned++;
      if (c.firstResponseAt) {
        const mins = (new Date(c.firstResponseAt).getTime() - new Date(c.createdAt).getTime()) / 60000;
        if (mins >= 0) r.resp.push(mins);
      }
    }
    for (const c of resolved as any[]) {
      if (!c.assignedUserId || !c.resolvedAt) continue;
      const r = row(c.assignedUserId); r.closed++;
      const mins = (new Date(c.resolvedAt).getTime() - new Date(c.createdAt).getTime()) / 60000;
      if (mins >= 0) r.res.push(mins);
    }
    for (const c of rated as any[]) {
      if (c.assignedUserId && c.csatRating) row(c.assignedUserId).csat.push(c.csatRating);
    }
    for (const m of messages as any[]) {
      if (m.sentByUserId) row(m.sentByUserId).replies++;
    }
    const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
    const out = new Map<string, any>();
    for (const [uid, r] of stats) {
      out.set(uid, {
        assigned: r.assigned, closed: r.closed, replies: r.replies,
        avgFirstResponseMinutes: avg(r.resp), avgResolutionMinutes: avg(r.res),
        csatAvg: r.csat.length ? Math.round((r.csat.reduce((a, b) => a + b, 0) / r.csat.length) * 10) / 10 : null,
        csatResponses: r.csat.length,
      });
    }
    return out;
  }

  /**
   * The owner's scorecard: current period vs the previous
   * equal-length period, a TRANSPARENT indicator whose four
   * components are returned (and printed in the UI), flags
   * derived from org medians with their evidence, and a
   * ranking. Nothing here is a black box.
   *
   * Indicator (0–100), each component capped:
   *   volume     = min(30, closed)                      (cap 30)
   *   speed      = first response ≤5m → 25, −1 per extra 3m (cap 25)
   *   resolution = resolution ≤60m → 20, −1 per extra 30m (cap 20)
   *   csat       = csatAvg / 5 × 25                     (cap 25)
   * A missing metric scores 0 for its component AND lists the
   * component in missingComponents — a new agent reads as
   * "insufficient data", never as a fabricated zero-history.
   */
  async teamScorecard(organizationId: string, days = 7, opts?: { actorId?: string; teamId?: string }) {
    const p = this.prisma as any;
    const span = Math.min(90, Math.max(1, Math.round(Number(days) || 7))) * 24 * 3600 * 1000;
    const now = new Date();
    const curFrom = new Date(now.getTime() - span);
    const prevFrom = new Date(now.getTime() - 2 * span);
    const memberships = await p.membership.findMany({ where: { organizationId }, include: { user: true }, take: 100 });
    let members = (memberships as any[]).filter((m) => ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"].includes(m.role));
    // Milestone 71: a team slice — the team's lead or a manager
    // only; medians/flags/ranking then describe that team.
    let scopedTeamName: string | null = null;
    if (opts?.teamId) {
      if (!opts.actorId) throw new ForbiddenException("A scoped team scorecard requires an identified viewer");
      const scope = await this.teamScope(organizationId, opts.actorId, opts.teamId);
      scopedTeamName = scope.team.name;
      const roster = new Set(scope.memberIds);
      members = members.filter((m) => roster.has(m.userId));
    }
    const ids = members.map((m) => m.userId);
    const [cur, prev, activity] = await Promise.all([
      this.scoreWindow(organizationId, ids, curFrom, now),
      this.scoreWindow(organizationId, ids, prevFrom, curFrom),
      this.teamActivity(organizationId).catch(() => null),
    ]);
    const activityOf = new Map(((activity?.members ?? []) as any[]).map((a) => [a.userId, a.activityState]));
    const empty = { assigned: 0, closed: 0, replies: 0, avgFirstResponseMinutes: null, avgResolutionMinutes: null, csatAvg: null, csatResponses: 0 };
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    const median = (xs: number[]) => {
      if (!xs.length) return null;
      const s = [...xs].sort((a, b) => a - b);
      return s.length % 2 ? s[Math.floor(s.length / 2)] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    };
    const rows = members.map((m) => {
      const c = cur.get(m.userId) ?? empty;
      const pv = prev.get(m.userId) ?? empty;
      const components = {
        volume: Math.min(30, c.closed),
        speed: c.avgFirstResponseMinutes === null ? null : clamp(25 - Math.max(0, Math.round((c.avgFirstResponseMinutes - 5) / 3)), 0, 25),
        resolution: c.avgResolutionMinutes === null ? null : clamp(20 - Math.max(0, Math.round((c.avgResolutionMinutes - 60) / 30)), 0, 20),
        csat: c.csatAvg === null ? null : Math.round((c.csatAvg / 5) * 25),
      };
      const missingComponents = (Object.entries(components) as [string, number | null][]).filter(([, v]) => v === null).map(([k]) => k);
      const indicator = Object.values(components).reduce((a: number, v) => a + (v ?? 0), 0);
      const delta = (a: number | null, b: number | null) => (a === null || b === null ? null : Math.round((a - b) * 10) / 10);
      return {
        userId: m.userId,
        name: m.user?.name ?? m.user?.email ?? "Agent",
        email: m.user?.email ?? null,
        role: m.role,
        membershipStatus: m.status,
        current: c,
        previous: pv,
        deltas: {
          assigned: c.assigned - pv.assigned, closed: c.closed - pv.closed, replies: c.replies - pv.replies,
          avgFirstResponseMinutes: delta(c.avgFirstResponseMinutes, pv.avgFirstResponseMinutes),
          avgResolutionMinutes: delta(c.avgResolutionMinutes, pv.avgResolutionMinutes),
          csatAvg: delta(c.csatAvg, pv.csatAvg),
        },
        indicator,
        components,
        missingComponents,
        insufficientData: c.closed === 0 && c.avgFirstResponseMinutes === null && c.csatAvg === null,
        activityState: activityOf.get(m.userId) ?? null,
        flags: [] as { code: string; label: string; detail: string }[],
      };
    });
    // Flags vs org medians (evidence included in every flag).
    const medianFR = median(rows.map((r) => r.current.avgFirstResponseMinutes).filter((x): x is number => x !== null));
    const medianClosed = median(rows.map((r) => r.current.closed));
    for (const r of rows) {
      const c = r.current;
      if (c.avgFirstResponseMinutes !== null && c.assigned >= 3 && medianFR !== null && medianFR > 0 && c.avgFirstResponseMinutes > 1.5 * medianFR) {
        r.flags.push({ code: "slow_first_response", label: "প্রথম জবাব ধীর", detail: `গড় ${c.avgFirstResponseMinutes} মিনিট · টিমের মধ্যম ${medianFR} মিনিট` });
      }
      if (c.csatAvg !== null && c.csatResponses >= 2 && c.csatAvg < 3.5) {
        r.flags.push({ code: "low_csat", label: "CSAT কম", detail: `গড় ${c.csatAvg}/5 (${c.csatResponses}টি রেটিং)` });
      }
      if (medianClosed !== null && medianClosed > 0 && c.assigned >= 5 && c.closed < 0.5 * medianClosed) {
        r.flags.push({ code: "low_closures", label: "বন্ধ কম", detail: `${c.closed}টি বন্ধ · টিমের মধ্যম ${medianClosed}টি` });
      }
      if (r.activityState === "idle") {
        r.flags.push({ code: "idle_now", label: "এখন নিষ্ক্রিয়", detail: "Dashboard খোলা, কিন্তু ১৫+ মিনিট কোনো কাজের চিহ্ন নেই" });
      }
      if (c.csatAvg !== null && c.csatResponses >= 2 && c.csatAvg >= 4.5) {
        r.flags.push({ code: "customers_happy", label: "গ্রাহক খুশি", detail: `CSAT ${c.csatAvg}/5 (${c.csatResponses}টি রেটিং)` });
      }
    }
    rows.sort((a, b) => b.indicator - a.indicator);
    rows.forEach((r, i) => { (r as any).rank = r.insufficientData ? null : i + 1; });
    return {
      days: span / (24 * 3600 * 1000),
      scopedTeamId: opts?.teamId ?? null, scopedTeamName,
      currentWindow: { from: curFrom, to: now },
      previousWindow: { from: prevFrom, to: curFrom },
      formula: "সূচক (০–১০০) = বন্ধ কথোপকথন (সর্বোচ্চ ৩০) + প্রথম জবাবের গতি (সর্বোচ্চ ২৫) + সমাধানের গতি (সর্বোচ্চ ২০) + CSAT (সর্বোচ্চ ২৫)। কোনো মাপের তথ্য না থাকলে সেই অংশে ০ এবং 'তথ্য নেই' বলে চিহ্নিত।",
      // Milestone 74 (Team T5): assignment fairness — each
      // agent's share of the period's assignments vs the
      // equal share, computed from the same rows.
      fairness: buildFairness(rows),
      agents: rows,
    };
  }

  /** CSV rendering of the scorecard (same numbers, no new math). */
  async teamScorecardCsv(organizationId: string, days = 7, opts?: { actorId?: string; teamId?: string }): Promise<string> {
    const card = await this.teamScorecard(organizationId, days, opts);
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = ["rank", "name", "email", "role", "indicator", "volume_pts", "speed_pts", "resolution_pts", "csat_pts",
      "assigned", "assigned_prev", "closed", "closed_prev", "replies", "replies_prev",
      "avg_first_response_min", "avg_first_response_prev", "avg_resolution_min", "avg_resolution_prev",
      "csat_avg", "csat_prev", "csat_responses", "flags", "insufficient_data"];
    const lines = [head.join(",")];
    for (const a of card.agents as any[]) {
      lines.push([
        a.rank, a.name, a.email, a.role, a.indicator, a.components.volume, a.components.speed, a.components.resolution, a.components.csat,
        a.current.assigned, a.previous.assigned, a.current.closed, a.previous.closed, a.current.replies, a.previous.replies,
        a.current.avgFirstResponseMinutes, a.previous.avgFirstResponseMinutes, a.current.avgResolutionMinutes, a.previous.avgResolutionMinutes,
        a.current.csatAvg, a.previous.csatAvg, a.current.csatResponses, a.flags.map((f: any) => f.code).join(";"), a.insufficientData,
      ].map(esc).join(","));
    }
    return lines.join("\n");
  }

  async listAgentStates(organizationId: string) {
    const p = this.prisma as any;
    const memberships = await p.membership.findMany({ where: { organizationId }, include: { user: true }, take: 100 });
    const states = await p.agentState?.findMany({ where: { organizationId } }).catch(() => []) ?? [];
    const stateOf = new Map((states as any[]).map((r) => [r.userId, r]));
    const teamMembers = await p.inboxTeamMember?.findMany({ where: { teamId: { in: ((await p.inboxTeam?.findMany({ where: { organizationId } }).catch(() => []) ?? []) as any[]).map((t) => t.id) } } }).catch(() => []) ?? [];
    const capOf = new Map<string, number>();
    const teamsOf = new Map<string, string[]>();
    const teamName = new Map(((await p.inboxTeam?.findMany({ where: { organizationId } }).catch(() => []) ?? []) as any[]).map((t) => [t.id, t.name]));
    for (const m of teamMembers as any[]) {
      capOf.set(m.userId, Math.max(capOf.get(m.userId) ?? 0, m.capacity ?? 20));
      teamsOf.set(m.userId, [...(teamsOf.get(m.userId) ?? []), teamName.get(m.teamId) ?? m.teamId]);
    }
    const open = await p.channelConversation.findMany({ where: { organizationId, status: "open", assignedUserId: { not: null } }, take: 2000 }).catch(() => []);
    const openOf = new Map<string, number>();
    for (const c of open as any[]) openOf.set(c.assignedUserId, (openOf.get(c.assignedUserId) ?? 0) + 1);
    // Milestone 68: surface the shift verdict on the board.
    const schedules = await p.agentSchedule?.findMany({ where: { organizationId } }).catch(() => []) ?? [];
    const schedOf = new Map((schedules as any[]).map((s) => [s.userId, s]));
    const nowForShift = new Date();
    return (memberships as any[])
      .filter((m) => ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"].includes(m.role))
      .map((m) => ({
        userId: m.userId,
        name: m.user?.name ?? m.user?.email ?? "Agent",
        email: m.user?.email ?? null,
        role: m.role,
        status: stateOf.get(m.userId)?.status ?? "online",
        capacity: capOf.get(m.userId) ?? 20,
        openCount: openOf.get(m.userId) ?? 0,
        teams: teamsOf.get(m.userId) ?? [],
        lastAssignedAt: stateOf.get(m.userId)?.lastAssignedAt ?? null,
        hasSchedule: schedOf.has(m.userId),
        onShift: schedOf.has(m.userId) ? isWithinSchedule(schedOf.get(m.userId) as any, nowForShift) : true,
      }));
  }

  /** Candidate pool for assignment: team-routed when teams exist. */
  private async assignmentPool(organizationId: string, conversation: any, settings: any) {
    const p = this.prisma as any;
    const teams = await p.inboxTeam?.findMany({ where: { organizationId } }).catch(() => []) ?? [];
    if (!(teams as any[]).length) return null; // null => legacy org-wide pool
    const escalated = conversation.priority === "high" || conversation.sentimentFlag === "negative";
    let selected = (teams as any[]).filter((t) => !(t.channels as string[])?.length || (t.channels as string[]).includes(conversation.channel));
    if (escalated && settings.escalationTeamId) {
      const esc = (teams as any[]).find((t) => t.id === settings.escalationTeamId);
      if (esc) selected = [esc];
    }
    if (!selected.length) selected = teams as any[];
    const members = await p.inboxTeamMember?.findMany({ where: { teamId: { in: selected.map((t: any) => t.id) } } }).catch(() => []) ?? [];
    const teamOf = new Map<string, string>();
    const capOf = new Map<string, number>();
    for (const t of selected) {
      for (const m of members as any[]) {
        if (m.teamId !== t.id) continue;
        if (!teamOf.has(m.userId)) teamOf.set(m.userId, t.id);
        capOf.set(m.userId, Math.max(capOf.get(m.userId) ?? 0, m.capacity ?? 20));
      }
    }
    return [...teamOf.entries()].map(([userId, teamId]) => ({ userId, teamId: teamId as string | null, capacity: capOf.get(userId) ?? 20 }));
  }

  /**
   * Assignment engine v2: team routing (channel match, escalation
   * team for high-priority/negative), agent-state aware (away is
   * skipped), capacity-capped, round-robin or least-busy within
   * the pool. Without teams it keeps the original org-wide
   * behavior — now also state/capacity aware.
   */
  private async maybeSmartAssign(organizationId: string, conversation: any) {
    const settings = await this.getSettings(organizationId);
    if (settings.smartAssign === "off") return conversation;
    const p = this.prisma as any;
    const memberships = await p.membership.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" }, take: 100 });
    const supportRoles = ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"];
    const roleOf = new Map((memberships as any[]).map((m) => [m.userId, m.role]));
    const pool = await this.assignmentPool(organizationId, conversation, settings);
    let candidates: { userId: string; teamId: string | null; capacity: number }[] =
      pool ?? (memberships as any[]).filter((m) => supportRoles.includes(m.role)).map((m) => ({ userId: m.userId, teamId: null, capacity: 20 }));
    candidates = candidates.filter((c) => supportRoles.includes(roleOf.get(c.userId) ?? ""));
    if (!candidates.length) return conversation;
    const states = await p.agentState?.findMany({ where: { organizationId, userId: { in: candidates.map((c) => c.userId) } } }).catch(() => []) ?? [];
    const away = new Set((states as any[]).filter((r) => r.status === "away").map((r) => r.userId));
    candidates = candidates.filter((c) => !away.has(c.userId));
    if (!candidates.length) return conversation;
    // Milestone 68: off-shift agents are skipped too. No schedule
    // row = always available (pre-M68 behavior). Suspended
    // members (M67) are never assigned either.
    const statusOf = new Map((memberships as any[]).map((m) => [m.userId, m.status]));
    candidates = candidates.filter((c) => statusOf.get(c.userId) !== "SUSPENDED");
    const schedules = await p.agentSchedule?.findMany({
      where: { organizationId, userId: { in: candidates.map((c) => c.userId) } },
    }).catch(() => []) ?? [];
    if ((schedules as any[]).length) {
      const schedOf = new Map((schedules as any[]).map((s) => [s.userId, s]));
      const now = new Date();
      candidates = candidates.filter((c) => {
        const s = schedOf.get(c.userId);
        return !s || isWithinSchedule(s as any, now);
      });
      if (!candidates.length) return conversation;
    }
    const open = await p.channelConversation.findMany({
      where: { organizationId, status: "open", assignedUserId: { in: candidates.map((c) => c.userId) } }, take: 2000,
    });
    const counts = new Map<string, number>(candidates.map((c) => [c.userId, 0]));
    for (const c of open as any[]) counts.set(c.assignedUserId, (counts.get(c.assignedUserId) ?? 0) + 1);
    candidates = candidates.filter((c) => (counts.get(c.userId) ?? 0) < c.capacity);
    if (!candidates.length) return conversation;
    let chosen = candidates[0];
    if (settings.smartAssign === "round_robin") {
      const row = await p.inboxSetting.findUnique({ where: { organizationId } }).catch(() => null);
      const idx = candidates.findIndex((c) => c.userId === row?.lastAssignedUserId);
      chosen = candidates[(idx + 1) % candidates.length];
      if (row) await p.inboxSetting.update({ where: { organizationId }, data: { lastAssignedUserId: chosen.userId } });
      else await p.inboxSetting.create({ data: { organizationId, smartAssign: settings.smartAssign, lastAssignedUserId: chosen.userId } });
    } else {
      chosen = [...candidates].sort((a, b) => (counts.get(a.userId) ?? 0) - (counts.get(b.userId) ?? 0))[0];
    }
    const updated = await p.channelConversation.update({
      where: { id: conversation.id },
      data: { assignedUserId: chosen.userId, ...(chosen.teamId ? { teamId: chosen.teamId } : {}) },
    });
    try {
      await p.agentState?.upsert({
        where: { organizationId_userId: { organizationId, userId: chosen.userId } },
        create: { organizationId, userId: chosen.userId, status: "online", lastAssignedAt: new Date() },
        update: { lastAssignedAt: new Date() },
      });
    } catch { /* state bookkeeping never blocks assignment */ }
    await this.notify(organizationId, chosen.userId, "assigned",
      `নতুন কথোপকথন অ্যাসাইন হয়েছে: ${updated.contactName ?? updated.externalContactId ?? "গ্রাহক"}`,
      (updated.lastMessagePreview ?? "").slice(0, 120) || null, conversation.id).catch(() => undefined);
    this.rtConversation(organizationId, conversation.id, { assignedUserId: chosen.userId, teamId: chosen.teamId });
    return updated;
  }

  /**
   * Assignment sweep (scheduler job "inbox_assignment_sweep"):
   * assigns the unassigned backlog and reassigns stale open
   * conversations away from agents marked away.
   */
  async sweepAssignments(organizationId: string) {
    const settings = await this.getSettings(organizationId);
    if (settings.smartAssign === "off") return { assigned: 0, reassigned: 0, skipped: "policy_off" as const };
    const p = this.prisma as any;
    const reassignAfter = (settings.reassignAfterMinutes ?? 30) * 60000;
    let assigned = 0;
    let reassigned = 0;
    const backlog = await p.channelConversation.findMany({
      where: { organizationId, status: "open", assignedUserId: null, createdAt: { lt: new Date(Date.now() - 5 * 60000) } },
      take: 50,
    }).catch(() => []);
    for (const c of backlog as any[]) {
      const after: any = await this.maybeSmartAssign(organizationId, c).catch(() => c);
      if (after?.assignedUserId) assigned++;
    }
    const awayStates = await p.agentState?.findMany({ where: { organizationId, status: "away" } }).catch(() => []) ?? [];
    if ((awayStates as any[]).length) {
      const stale = await p.channelConversation.findMany({
        where: {
          organizationId, status: "open",
          assignedUserId: { in: (awayStates as any[]).map((r) => r.userId) },
          lastMessageAt: { lt: new Date(Date.now() - reassignAfter) },
        },
        take: 50,
      }).catch(() => []);
      for (const c of stale as any[]) {
        const previousAssignee = c.assignedUserId;
        const cleared = await p.channelConversation.update({ where: { id: c.id }, data: { assignedUserId: null } });
        const after: any = await this.maybeSmartAssign(organizationId, cleared).catch(() => cleared);
        if (after?.assignedUserId && after.assignedUserId !== previousAssignee) reassigned++;
      }
    }
    return { assigned, reassigned };
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

    // Unified Inbox U2: assignment runs for EVERY channel here —
    // the Meta webhook path assigns at creation, but webchat (and
    // any future channel) reaches intelligence unassigned. Running
    // it after classification lets escalation routing use the
    // fresh priority/sentiment of this very message.
    if (!conversation.assignedUserId) {
      const assigned: any = await this.maybeSmartAssign(organizationId, conversation).catch(() => null);
      if (assigned?.assignedUserId) conversation = assigned;
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
    // Milestone 40: platform feature flag (order_bot) — when the
    // admin has disabled it for this org the bot never engages.
    if (!(await orgFlagEnabled(this.prisma as any, organizationId, "order_bot"))) return false;
    const prisma = this.prisma as any;
    let session = await prisma.botSession?.findFirst?.({ where: { conversationId: conversation.id, status: "active" } }).catch(() => null);
    if (session && Date.now() - new Date(session.updatedAt).getTime() > 30 * 60000) {
      await prisma.botSession.update({ where: { id: session.id }, data: { status: "expired" } }).catch(() => undefined);
      session = null;
    }
    const settings = await this.getSettings(organizationId);
    // Milestone 76: the bot's delivery charge falls back to
    // the Command Center profile (inside-Dhaka charge) when
    // no bot-specific charge is set.
    if (settings.botDeliveryChargeMinor == null) {
      const profile = await prisma.businessProfile?.findUnique({ where: { organizationId } }).catch(() => null);
      if (profile?.deliveryChargeInsideMinor != null) settings.botDeliveryChargeMinor = Number(profile.deliveryChargeInsideMinor);
    }
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
      data.pendingProductId = product.id; data.pendingProductName = product.name;
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
      // Bot v2 (U3): the cart holds any number of products.
      const items: any[] = Array.isArray(data.items) ? data.items : [];
      const pendingId = data.pendingProductId ?? data.productId;
      const pendingName = data.pendingProductName ?? data.productName;
      if (pendingId) {
        const existing = items.find((i) => i.productId === pendingId);
        if (existing) existing.quantity = Math.min(99, (existing.quantity ?? 0) + qty);
        else items.push({ productId: pendingId, productName: pendingName, quantity: qty });
        data.items = items;
      }
      data.quantity = qty;
      delete data.pendingProductId; delete data.pendingProductName;
      await save("ask_more");
      const products = await prisma.product.findMany({ where: { organizationId, status: "ACTIVE" }, orderBy: { createdAt: "asc" }, take: 10 });
      const cartLines = items.map((i) => `• ${i.productName} × ${i.quantity}`).join("\n");
      const list = products.map((p: any, i: number) => `${i + 1}. ${p.name} — ${formatMinor(BigInt(p.priceMinor), p.currency)}`).join("\n");
      await this.botSend(organizationId, conversation, session,
        `কার্টে যোগ হয়েছে:\n${cartLines}\n\nআরো পণ্য নিতে চাইলে নম্বর লিখুন, শেষ করতে "শেষ" লিখুন:\n${list}`);
      return true;
    }
    if (session.state === "ask_more") {
      const doneWords = ["শেষ", "হয়ে গেছে", "হয়ে গেছে", "না", "আর না", "done", "no", "ses"];
      if (doneWords.includes(text.trim().toLowerCase())) {
        await save("ask_name");
        await this.botSend(organizationId, conversation, session, "আপনার পুরো নাম লিখুন (ডেলিভারির জন্য)।");
        return true;
      }
      const products = await prisma.product.findMany({ where: { organizationId, status: "ACTIVE" }, orderBy: { createdAt: "asc" }, take: 10 });
      const num = Number(this.bnToEnDigits(text).replace(/[^0-9]/g, ""));
      const product = num >= 1 && num <= products.length ? products[num - 1] : matchProduct(text, products);
      if (!product) {
        await this.botSend(organizationId, conversation, session, "বোঝা যায়নি — আরো পণ্যের নম্বর লিখুন, অথবা শেষ করতে \"শেষ\" লিখুন।");
        return true;
      }
      data.pendingProductId = product.id; data.pendingProductName = product.name;
      await save("ask_quantity");
      await this.botSend(organizationId, conversation, session, `\"${product.name}\" — কয়টি নিতে চান? সংখ্যা লিখুন।`);
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
      // Bot v2 (U3): totals over the whole cart; legacy single-
      // product sessions (started before v2) still resolve.
      const cartItems: any[] = Array.isArray(data.items) && data.items.length
        ? data.items
        : [{ productId: data.productId, productName: data.productName, quantity: data.quantity ?? 1 }];
      let subtotal = 0n;
      let currency = "BDT";
      const itemLines: string[] = [];
      for (const item of cartItems) {
        const product = await prisma.product.findFirst({ where: { id: item.productId, organizationId } });
        if (!product) { await this.botFail(organizationId, conversation, session, "একটি পণ্য আর পাওয়া যাচ্ছে না"); return true; }
        currency = product.currency ?? currency;
        const lineTotal = BigInt(product.priceMinor) * BigInt(item.quantity);
        subtotal += lineTotal;
        itemLines.push(`পণ্য: ${product.name} × ${item.quantity} = ${formatMinor(lineTotal, product.currency)}`);
      }
      data.items = cartItems;
      const delivery = settings.botDeliveryChargeMinor;
      data.subtotalMinor = String(subtotal);
      await save("confirm");
      const lines = [
        "অর্ডারের সারসংক্ষেপ:",
        ...itemLines,
        delivery != null ? `ডেলিভারি চার্জ: ${formatMinor(BigInt(delivery), currency)}` : "ডেলিভারি চার্জ: আমাদের টিম কনফার্ম করবে",
        delivery != null ? `সর্বমোট (COD): ${formatMinor(subtotal + BigInt(delivery), currency)}` : `মোট (ডেলিভারি ছাড়া): ${formatMinor(subtotal, currency)}`,
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
      const orderItems: any[] = Array.isArray(data.items) && data.items.length
        ? data.items.map((i: any) => ({ productId: i.productId, quantity: i.quantity }))
        : [{ productId: data.productId, quantity: data.quantity }];
      const order = await this.createChatOrder(organizationId, "system", conversation.id, {
        items: orderItems,
        shippingMinor: settings.botDeliveryChargeMinor ?? 0,
        isCod: true,
        address: data.address,
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
      // Milestone 76: Command Center profile facts lead (the
      // numbers customers actually ask for); the policy text
      // follows when one exists. Neither -> stay silent.
      const profile = await (this.prisma as any).businessProfile.findUnique({ where: { organizationId } }).catch(() => null);
      const lines = intent === "delivery" ? deliveryFactLines(profile) : paymentFactLines(profile);
      const policy = await (this.prisma as any).businessPolicy.findFirst({
        where: { organizationId, type: intent === "delivery" ? "shipping" : "payment" },
      });
      if (!lines.length && !policy?.content) return null;
      const parts: string[] = [];
      if (lines.length) parts.push(lines.join("। ") + "।");
      if (policy?.content) parts.push(String(policy.content).replace(/\s+/g, " ").slice(0, 350));
      return {
        content: `${intent === "delivery" ? "ডেলিভারি সংক্রান্ত তথ্য" : "পেমেন্ট সংক্রান্ত তথ্য"}: ${parts.join(" ")}`,
        evidence: lines.length
          ? { type: "business_profile", area: intent }
          : { type: "business_policy", policyId: policy.id, policyType: policy.type },
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

  // ----- Unified Inbox U3: autopilot (modes per intent/channel,
  // escalation gate, rule replies, then an LLM tier that may only
  // restate a verified fact pack) -----

  private static readonly HUMAN_WORDS = ["এজেন্ট", "মানুষ চাই", "মানুষের সাথে", "agent", "human", "real person", "কাস্টমার কেয়ার", "কাস্টমার কেয়ার"];

  /** Escalate to a human: pause autopilot on this conversation,
   * raise priority, notify, audit. Returns true when escalated. */
  private async escalateAutopilot(organizationId: string, conversation: any, reason: string) {
    await (this.prisma as any).channelConversation.update({
      where: { id: conversation.id },
      data: { autoReplyPaused: true, priority: "high" },
    }).catch(() => undefined);
    this.rtConversation(organizationId, conversation.id, { autoReplyPaused: true, priority: "high" });
    await this.notifyUrgent(organizationId, { ...conversation, priority: "high" }).catch(() => undefined);
    await this.audit.log({
      organizationId, userId: "system", action: "inbox.autopilot.escalated", entityType: "ChannelConversation",
      entityId: conversation.id, metadata: { reason },
    }).catch(() => undefined);
    return true;
  }

  private async maybeAutoReply(organizationId: string, conversation: any, classification: Classification, text: string) {
    const settings = await this.getSettings(organizationId);
    const perIntent = (settings.perIntent ?? {}) as Record<string, string>;
    const perChannel = (settings.perChannelModes ?? {}) as Record<string, string>;
    const mode = perIntent[classification.intent] ?? perChannel[conversation.channel] ?? settings.autoReplyMode;
    if (mode === "off") return;

    // Judge everything from the FRESH row: the conversation object
    // handed down is a snapshot from before this message landed.
    const fresh = await (this.prisma as any).channelConversation.findFirst({ where: { id: conversation.id } }).catch(() => null);
    const current = fresh ?? conversation;
    if (current.autoReplyPaused) return; // a human owns this thread now

    // ---- Escalation gate (before any composing) ----
    const lower = text.toLowerCase();
    if (classification.sentiment === "negative" || classification.intent === "complaint") {
      await this.escalateAutopilot(organizationId, current, classification.intent === "complaint" ? "complaint" : "negative_sentiment");
      return;
    }
    if (InboxService.HUMAN_WORDS.some((w) => lower.includes(w))) {
      await this.escalateAutopilot(organizationId, current, "human_requested");
      return;
    }
    if (settings.escalationThresholdMinor != null && current.customerId) {
      const openOrder = await (this.prisma as any).order.findFirst({
        where: { organizationId, customerId: current.customerId, status: { in: ["pending", "on-hold", "processing"] } },
        orderBy: { createdAt: "desc" },
      }).catch(() => null);
      if (openOrder && Number(openOrder.totalMinor) > settings.escalationThresholdMinor) {
        await this.escalateAutopilot(organizationId, current, "high_value_order");
        return;
      }
    }
    if (classification.intent === "other" && classification.confidence < 40) {
      // Two consecutive ununderstood messages -> stop guessing.
      const recent = await (this.prisma as any).channelMessage.findMany({
        where: { conversationId: conversation.id, direction: "in" }, orderBy: { createdAt: "desc" }, take: 2,
      }).catch(() => []);
      if (recent.length >= 2 && recent.every((m: any) => (m.intent ?? "other") === "other")) {
        await this.escalateAutopilot(organizationId, current, "repeated_ununderstood");
        return;
      }
    }

    if (!["price", "stock", "delivery", "order_status", "payment"].includes(classification.intent)) return;
    if (classification.confidence < settings.confidenceThreshold) return;
    let composed: { content: string; evidence: any } | null = await this.composeGroundedReply(organizationId, current, classification.intent, text);
    if (!composed) {
      // LLM tier: may only restate the verified fact pack. No
      // facts, no provider, guard failure -> still no reply.
      composed = await this.composeLlmGroundedReply(organizationId, current, classification.intent, text).catch(() => null);
    }
    if (!composed) return; // no verified data -> no reply, ever

    conversation = current;
    const windowClosed = conversation.channel === "whatsapp" && this.whatsappWindow(conversation)?.open === false;
    if (mode === "draft" || windowClosed) {
      await (this.prisma as any).messageDraft.create({
        data: {
          organizationId, conversationId: conversation.id, content: composed.content,
          provider: "auto-reply", status: "suggested", createdByUserId: null,
        },
      });
      return;
    }

    // Rate limit: at most one auto-reply per conversation per 10 minutes.
    const lastAuto = await (this.prisma as any).channelMessage.findFirst({
      where: { conversationId: conversation.id, autoReply: true }, orderBy: { createdAt: "desc" },
    });
    if (lastAuto && Date.now() - new Date(lastAuto.createdAt).getTime() < 10 * 60 * 1000) return;

    const message = await (this.prisma as any).channelMessage.create({
      data: {
        conversationId: conversation.id, direction: "out", type: "text", content: composed.content,
        status: "queued", autoReply: true, autoReplyEvidence: JSON.stringify({ via: "autopilot", ...composed.evidence }),
      },
    });
    try {
      const messageId = await this.deliverText(conversation, composed.content);
      await (this.prisma as any).channelMessage.update({ where: { id: message.id }, data: { status: "sent", externalId: messageId } });
      this.rtMessage(organizationId, conversation.id, { ...message, status: "sent", externalId: messageId });
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

  /**
   * The verified fact pack an LLM may restate — Milestone 76
   * (Business Brain v2): the Command Center profile (delivery
   * charges/times, payment numbers, contact, hours) and
   * keyword-matched knowledge/FAQ join the original product /
   * policy / order sources. Returns null only when there is
   * genuinely nothing verified to say.
   */
  private async buildFactPack(organizationId: string, conversation: any, intent: string, text: string) {
    const p = this.prisma as any;
    const facts: string[] = [];
    const sources: any[] = [];
    const profile = (await p.businessProfile?.findUnique?.({ where: { organizationId } })?.catch?.(() => null)) ?? null;
    if (intent === "price" || intent === "stock") {
      const products = await p.product.findMany({ where: { organizationId, status: "ACTIVE" }, take: 100 });
      const product = matchProduct(text, products);
      if (product) {
        facts.push(`পণ্য: ${product.name}`);
        facts.push(`দাম: ${formatMinor(BigInt(product.priceMinor), product.currency)} (${product.currency})`);
        if (product.stockQuantity != null) facts.push(`স্টক: ${product.stockQuantity}টি`);
        sources.push({ type: "product", productId: product.id });
      }
    }
    if (intent === "delivery" || intent === "payment") {
      const lines = intent === "delivery" ? deliveryFactLines(profile) : paymentFactLines(profile);
      facts.push(...lines);
      if (lines.length) sources.push({ type: "business_profile", area: intent });
      const policy = await p.businessPolicy.findFirst({ where: { organizationId, type: intent === "delivery" ? "shipping" : "payment" } });
      if (policy?.content) {
        facts.push(`${intent === "delivery" ? "ডেলিভারি" : "পেমেন্ট"} নীতি: ${String(policy.content).replace(/\s+/g, " ").slice(0, 500)}`);
        sources.push({ type: "business_policy", policyId: policy.id });
      }
    }
    if (intent === "order_status" && conversation.customerId) {
      const order = await p.order.findFirst({ where: { organizationId, customerId: conversation.customerId }, orderBy: { createdAt: "desc" } });
      if (order) {
        facts.push(`সর্বশেষ অর্ডার নম্বর: ${order.externalNumber ?? order.id}`);
        facts.push(`অর্ডারের অবস্থা: ${order.status}`);
        facts.push(`অর্ডারের মোট: ${formatMinor(BigInt(order.totalMinor), order.currency)}`);
        sources.push({ type: "order_status", orderId: order.id, status: order.status });
      }
    }
    // Contact/hours questions map to no dedicated intent — the
    // classifier calls them "other"; the brain answers them
    // from the profile, and FAQ matching runs for EVERY intent.
    if (intent === "other" || intent === "greeting") {
      const lines = [...contactFactLines(profile), ...hoursFactLines(profile)];
      facts.push(...lines);
      if (lines.length) sources.push({ type: "business_profile", area: "contact_hours" });
    }
    // Defensive `?.()` chain: older spec fakes (and any partial
    // prisma double) may lack these tables entirely — a missing
    // table must mean "no facts", never a synchronous throw
    // before .catch can attach.
    const docs = (await p.knowledgeDocument?.findMany?.({ where: { organizationId }, take: 100 })?.catch?.(() => [])) ?? [];
    for (const m of matchKnowledge(text, docs as any[])) {
      facts.push(`জ্ঞানভান্ডার (${m.doc.title}): ${String(m.doc.content).replace(/\s+/g, " ").slice(0, 400)}`);
      sources.push({ type: "knowledge", docId: m.doc.id, kind: m.doc.kind });
    }
    if (!facts.length) return null;
    const org = (await p.organization?.findUnique?.({ where: { id: organizationId }, select: { name: true } })?.catch?.(() => null)) ?? null;
    if (org?.name) facts.unshift(`ব্যবসার নাম: ${org.name}`);
    return {
      factsText: facts.join("\n"), sources,
      // Milestone 77: owner behaviour rides along; the number
      // guard still decides what may be said.
      ownerInstructions: profile?.aiInstructions ?? null,
      replyLanguage: profile?.aiReplyLanguage ?? null,
    };
  }

  /** Numbers in a text, normalized (Bengali digits -> Latin,
   * separators stripped) for the hallucination guard. */
  private static extractNumbers(input: string): string[] {
    const normalized = input.replace(/[০-৯]/g, (d) => "০১২৩৪৫৬৭৮৯".indexOf(d).toString()).replace(/,/g, "");
    return (normalized.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n)));
  }

  /**
   * LLM autopilot tier. The model receives ONLY the fact pack and
   * the customer's message; its reply is admitted only if every
   * number in it appears in the pack (a deterministic guard
   * against invented prices/totals). Anything else -> no reply.
   */
  private async composeLlmGroundedReply(organizationId: string, conversation: any, intent: string, text: string) {
    const pack = await this.buildFactPack(organizationId, conversation, intent, text);
    if (!pack) return null;
    let provider: any;
    try { provider = this.llm.getProvider(); } catch { return null; }
    if (!provider?.isRealLlm) return null; // dev templates never autopilot
    const result = await provider.complete([
      {
        role: "system",
        content: [
          "You are the customer-support autopilot of a Bangladeshi ecommerce business.",
          "Answer the customer using ONLY the verified facts below. Never invent prices, stock, discounts, delivery times or promises.",
          "Reply in the customer's language and style (Bengali, English, or mixed as they wrote). Keep it short and helpful.",
          "If the facts do not answer the question, reply with exactly: NO_ANSWER",
          // Milestone 77: owner behaviour from the Command
          // Center — conduct only; the facts rule stands.
          ...((pack as any).ownerInstructions ? ["", `Owner's standing instructions for tone and conduct (never override the verified facts): ${String((pack as any).ownerInstructions).slice(0, 1000)}`] : []),
          ...((pack as any).replyLanguage === "bn" ? ["Always reply in Bengali."] : (pack as any).replyLanguage === "en" ? ["Always reply in English."] : []),
          "",
          "VERIFIED FACTS:",
          pack.factsText,
        ].join("\n"),
      },
      { role: "user", content: text },
    ], { maxTokens: 400 });
    const reply = (result.text ?? "").trim();
    await (this.prisma as any).aIUsageRecord.create({
      data: { organizationId, userId: "system", feature: "autopilot", provider: provider.name, inputTokens: result.inputTokens, outputTokens: result.outputTokens, estimated: result.tokensEstimated },
    }).catch(() => undefined);
    if (!reply || reply.toUpperCase().includes("NO_ANSWER")) return null;
    const factNumbers = new Set(InboxService.extractNumbers(pack.factsText));
    const invented = InboxService.extractNumbers(reply).filter((n) => !factNumbers.has(n));
    if (invented.length) {
      await this.audit.log({
        organizationId, userId: "system", action: "inbox.autopilot.guard_rejected", entityType: "ChannelConversation",
        entityId: conversation.id, metadata: { intent, inventedNumbers: invented },
      }).catch(() => undefined);
      return null;
    }
    return { content: reply.slice(0, 1500), evidence: { tier: "llm", provider: provider.name, sources: pack.sources } };
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

  /** Forward-only pipeline advance: real events move a thread
   * along the pipeline (first reply -> talking, chat order ->
   * ordered/repeat); agents can also move it manually. */
  private async advanceStage(organizationId: string, conversation: any, to: string) {
    try {
      const rank = InboxService.STAGE_RANK;
      if ((rank[conversation.pipelineStage ?? "new"] ?? 0) >= (rank[to] ?? 0)) return;
      const updated = await (this.prisma as any).channelConversation.update({
        where: { id: conversation.id }, data: { pipelineStage: to },
      });
      conversation.pipelineStage = updated.pipelineStage;
      this.rtConversation(organizationId, conversation.id, { pipelineStage: to });
    } catch { /* a stage must never break messaging */ }
  }

  /** M51: stages shown on the board. "shipped" is DERIVED ONLY —
   * it is never stored and cannot be set manually: a conversation
   * whose stored stage is "ordered" shows as "shipped" while a linked
   * order's courier shipment is in transit, and as "delivered" once
   * delivered (the U5 derivation). Stored stages stay the U5 set. */
  static readonly BOARD_STAGES = ["new", "talking", "ordered", "shipped", "delivered", "repeat"] as const;

  private effectiveStage(conv: any, linkedOrders: any[], shipments: any[] = []): string {
    const stored = conv.pipelineStage ?? "new";
    if (stored !== "ordered") return stored;
    const delivered = linkedOrders.some((o: any) =>
      ["completed", "delivered"].includes(String(o.status ?? "").toLowerCase()))
      || shipments.some((s: any) => ["delivered", "partial_delivered"].includes(String(s.status ?? "").toLowerCase()));
    if (delivered) return "delivered";
    const inTransit = shipments.some((s: any) => String(s.status ?? "").toLowerCase() === "in_transit");
    return inTransit ? "shipped" : stored;
  }

  /** Pipeline board: active conversations grouped by stage, with
   * the money actually attached to each stage — the totals of the
   * orders linked to those conversations (real rows, labelled as
   * linked pipeline value, never a forecast). */
  async getPipelineBoard(organizationId: string) {
    const convs = await (this.prisma as any).channelConversation.findMany({
      where: { organizationId, status: { not: "closed" } },
      orderBy: { lastMessageAt: "desc" }, take: 300,
    });
    const ids = convs.map((c: any) => c.id);
    const orders = ids.length ? await (this.prisma as any).order.findMany({
      where: { organizationId, conversationId: { in: ids } }, orderBy: { createdAt: "desc" }, take: 600,
    }).catch(() => []) : [];
    const ordersByConv = new Map<string, any[]>();
    for (const o of orders) {
      const list = ordersByConv.get(o.conversationId) ?? [];
      list.push(o); ordersByConv.set(o.conversationId, list);
    }
    // M51: shipments of the linked orders drive the derived
    // "shipped" stage (courier status vocabulary: in_transit).
    const orderIds = orders.map((o: any) => o.id);
    const shipments = orderIds.length ? await (this.prisma as any).courierShipment.findMany({
      where: { organizationId, orderId: { in: orderIds } }, take: 1200,
    }).catch(() => []) : [];
    const shipmentsByOrder = new Map<string, any[]>();
    for (const s of shipments) {
      const list = shipmentsByOrder.get(s.orderId) ?? [];
      list.push(s); shipmentsByOrder.set(s.orderId, list);
    }
    const stages: Record<string, { count: number; valueMinor: string; cards: any[] }> = {};
    for (const stage of InboxService.BOARD_STAGES) stages[stage] = { count: 0, valueMinor: "0", cards: [] };
    for (const conv of convs) {
      const linked = ordersByConv.get(conv.id) ?? [];
      const linkedShipments = linked.flatMap((o: any) => shipmentsByOrder.get(o.id) ?? []);
      const stage = this.effectiveStage(conv, linked, linkedShipments);
      const bucket = stages[stage] ?? stages.talking;
      bucket.count++;
      const latestTotal = linked[0] ? BigInt(linked[0].totalMinor) : 0n;
      bucket.valueMinor = String(BigInt(bucket.valueMinor) + latestTotal);
      if (bucket.cards.length < 60) {
        bucket.cards.push({
          id: conv.id, channel: conv.channel, contactName: conv.contactName, contactPhone: conv.contactPhone,
          lastMessagePreview: conv.lastMessagePreview, lastMessageAt: conv.lastMessageAt,
          unreadCount: conv.unreadCount, assignedUserId: conv.assignedUserId, priority: conv.priority,
          pipelineStage: stage, storedStage: conv.pipelineStage ?? "new",
          latestOrderTotalMinor: linked[0] ? String(linked[0].totalMinor) : null,
          latestOrderStatus: linked[0]?.status ?? null,
          latestShipmentStatus: linkedShipments[0]?.status ?? null,
        });
      }
    }
    return { stages, totalActive: convs.length };
  }

  /** Customer Command Profile: everything known about the person
   * behind this thread, assembled from real rows — all-channel
   * conversations, orders with shipments and payment facts, the
   * lead, ad origin, RFM + lifetime value. */
  async getCommandProfile(organizationId: string, conversationId: string) {
    const conv = await this.getConversationOrThrow(organizationId, conversationId);
    const context = await this.customerContext(organizationId, conv);
    const convWhere: any = conv.customerId
      ? { organizationId, customerId: conv.customerId }
      : { organizationId, channel: conv.channel, externalContactId: conv.externalContactId };
    const allConversations = await (this.prisma as any).channelConversation.findMany({
      where: convWhere, orderBy: { lastMessageAt: "desc" }, take: 20,
    }).catch(() => []);
    const verifications = await (((this.prisma as any).paymentVerification?.findMany({
      where: { organizationId, conversationId }, orderBy: { createdAt: "desc" }, take: 10,
    }))?.catch(() => []) ?? []);
    let rfm: any = null;
    if (context.lifetime && context.lifetime.orderCount > 0) {
      const lastOrderAt = context.lifetime.lastOrderAt ? new Date(context.lifetime.lastOrderAt) : null;
      const recencyDays = lastOrderAt ? Math.floor((Date.now() - lastOrderAt.getTime()) / 86400000) : null;
      const frequency = context.lifetime.orderCount;
      const monetaryMinor = context.lifetime.totalSpentMinor;
      const segment = frequency >= 3 && (recencyDays ?? 999) <= 90 ? "champion"
        : frequency >= 2 && (recencyDays ?? 999) <= 90 ? "loyal"
        : (recencyDays ?? 999) <= 30 ? "recent"
        : (recencyDays ?? 999) > 180 ? "dormant" : "standard";
      rfm = { recencyDays, frequency, monetaryMinor, segment };
    }
    return {
      conversation: {
        id: conv.id, channel: conv.channel, contactName: conv.contactName, contactPhone: conv.contactPhone,
        pipelineStage: conv.pipelineStage ?? "new", outcome: conv.outcome ?? null, status: conv.status,
        assignedUserId: conv.assignedUserId, teamId: conv.teamId ?? null,
      },
      customer: context.customer, lead: context.lead, lifetime: context.lifetime, orders: context.orders,
      conversations: allConversations.map((c: any) => ({
        id: c.id, channel: c.channel, status: c.status, lastMessageAt: c.lastMessageAt,
        lastMessagePreview: c.lastMessagePreview, pipelineStage: c.pipelineStage ?? "new",
      })),
      payments: {
        verifications: verifications.map((v: any) => ({
          id: v.id, provider: v.provider, verdict: v.verdict, trxId: v.trxId,
          amountMinor: v.amountMinor != null ? String(v.amountMinor) : null, createdAt: v.createdAt,
        })),
      },
      adOrigin: {
        ctwaSourceId: conv.ctwaSourceId ?? null,
        leadSource: context.lead?.source ?? null,
      },
      rfm,
    };
  }

  /** One-click: send the customer their tracking info through the
   * confirmed send path (counts only when the platform confirms). */
  async shareTracking(organizationId: string, actorId: string, conversationId: string) {
    const conv = await this.getConversationOrThrow(organizationId, conversationId);
    const orders = await (this.prisma as any).order.findMany({
      where: { organizationId, conversationId }, orderBy: { createdAt: "desc" }, take: 5,
    }).catch(() => []);
    let allOrderIds = orders.map((o: any) => o.id);
    if (conv.customerId) {
      const customerOrders = await (this.prisma as any).order.findMany({
        where: { organizationId, customerId: conv.customerId }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true },
      }).catch(() => []);
      allOrderIds = [...new Set([...allOrderIds, ...customerOrders.map((o: any) => o.id)])];
    }
    if (!allOrderIds.length) throw new BadRequestException("এই গ্রাহকের কোনো অর্ডার পাওয়া যায়নি");
    const shipment = await (this.prisma as any).courierShipment.findFirst({
      where: { organizationId, orderId: { in: allOrderIds } }, orderBy: { createdAt: "desc" },
    }).catch(() => null);
    if (!shipment?.trackingCode) throw new BadRequestException("এই অর্ডারের কোনো কুরিয়ার বুকিং/ট্র্যাকিং এখনো নেই");
    const text = `আপনার পার্সেলটি ${shipment.provider} কুরিয়ারে পাঠানো হয়েছে। Tracking: ${shipment.trackingCode} (স্ট্যাটাস: ${shipment.status})। ধন্যবাদ!`;
    const sent = await this.sendAutomatedMessage(organizationId, conversationId, text, "tracking_share");
    return { sent: true, trackingCode: shipment.trackingCode, provider: shipment.provider, messageId: sent.id };
  }

  /** One-click: file a refund REQUEST for the billing owner — a
   * real internal record (note + notification + audit). It does
   * NOT move money; the business settles refunds itself. */
  async requestRefund(organizationId: string, actorId: string, conversationId: string, dto: { reason?: string }) {
    const conv = await this.getConversationOrThrow(organizationId, conversationId);
    const reason = (dto.reason ?? "").trim().slice(0, 300);
    await this.createNoteInternal(organizationId, actorId, conversationId,
      `💸 রিফান্ড অনুরোধ: ${reason || "(কারণ দেওয়া হয়নি)"} — বিলিং মালিকের পর্যালোচনার জন্য।`);
    const owners = await (this.prisma as any).membership.findMany({
      where: { organizationId, role: { in: ["OWNER", "ADMIN"] } }, take: 10,
    }).catch(() => []);
    for (const m of owners) {
      if (m.userId === actorId) continue;
      await this.notify(organizationId, m.userId, "refund_request",
        `রিফান্ড অনুরোধ: ${conv.contactName ?? conv.externalContactId ?? "গ্রাহক"}`,
        reason || null, conversationId).catch(() => undefined);
    }
    await this.audit.log({
      organizationId, userId: actorId, action: "inbox.refund_requested", entityType: "ChannelConversation",
      entityId: conversationId, metadata: { reason: reason || null },
    }).catch(() => undefined);
    return { requested: true, notified: owners.filter((m: any) => m.userId !== actorId).length };
  }

  // ----- Unified Inbox U6: media pipeline, export, retention -----

  /** A short-lived signed URL for a stored media object (S3
   * mode). Local mode returns null — the client uses the
   * authenticated proxy instead. */
  async getMediaSignedUrl(organizationId: string, conversationId: string, messageId: string) {
    await this.getConversationOrThrow(organizationId, conversationId);
    const message = await (this.prisma as any).channelMessage.findFirst({ where: { id: messageId, conversationId } });
    if (!message) throw new NotFoundException("Message not found in this conversation");
    if (!message.mediaStorageKey) return { url: null, stored: false, mode: this.mediaStore().mode };
    const url = this.mediaStore().signedUrl(message.mediaStorageKey, 900);
    return { url, stored: true, mode: this.mediaStore().mode, expiresInSeconds: url ? 900 : null };
  }

  /** Media search across the org's inbox: newest stored/linked
   * media first, filterable by message type and free text on the
   * contact. Only real media rows are returned. */
  async searchMedia(organizationId: string, opts: { type?: string; q?: string; days?: number } = {}) {
    const since = new Date(Date.now() - Math.min(365, Math.max(1, opts.days ?? 90)) * 86400000);
    const messages = await (this.prisma as any).channelMessage.findMany({
      where: {
        createdAt: { gte: since },
        ...(opts.type ? { type: opts.type } : {}),
        OR: [{ mediaId: { not: null } }, { mediaUrl: { not: null } }, { mediaStorageKey: { not: null } }],
      },
      orderBy: { createdAt: "desc" }, take: 200,
    }).catch(() => []);
    // The fake/real relation filter above may not exist on every
    // client shape; verify org ownership through the conversations.
    const convIds = [...new Set(messages.map((m: any) => m.conversationId))];
    const convs = convIds.length ? await (this.prisma as any).channelConversation.findMany({
      where: { organizationId, id: { in: convIds } },
    }).catch(() => []) : [];
    const convById = new Map<string, any>(convs.map((c: any) => [c.id, c] as [string, any]));
    const q = (opts.q ?? "").toLowerCase();
    return messages
      .filter((m: any) => convById.has(m.conversationId))
      .filter((m: any) => !q || (convById.get(m.conversationId)?.contactName ?? "").toLowerCase().includes(q)
        || (convById.get(m.conversationId)?.contactPhone ?? "").includes(q))
      .slice(0, 100)
      .map((m: any) => ({
        id: m.id, conversationId: m.conversationId, type: m.type, direction: m.direction,
        contentType: m.mediaContentType ?? null, sizeBytes: m.mediaSizeBytes ?? null,
        stored: Boolean(m.mediaStorageKey), createdAt: m.createdAt,
        contactName: convById.get(m.conversationId)?.contactName ?? null,
        channel: convById.get(m.conversationId)?.channel ?? null,
      }));
  }

  /** Export one thread (JSON structure or CSV of its messages). */
  async exportConversation(organizationId: string, conversationId: string, format: "json" | "csv" = "json") {
    const conv = await this.getConversationOrThrow(organizationId, conversationId);
    const messages = await (this.prisma as any).channelMessage.findMany({
      where: { conversationId }, orderBy: { createdAt: "asc" }, take: 5000,
    });
    if (format === "csv") {
      const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const lines = ["created_at,direction,type,status,content,external_id"];
      for (const m of messages) lines.push([m.createdAt?.toISOString?.() ?? m.createdAt, m.direction, m.type, m.status, esc(m.content), m.externalId ?? ""].join(","));
      // direction/type/status are token-safe; only content needed escaping above.
      return { format, filename: `conversation-${conversationId}.csv`, contentType: "text/csv", body: lines.join("\n") };
    }
    return {
      format, filename: `conversation-${conversationId}.json`, contentType: "application/json",
      body: JSON.stringify({
        exportedAt: new Date().toISOString(),
        conversation: {
          id: conv.id, channel: conv.channel, contactName: conv.contactName, contactPhone: conv.contactPhone,
          status: conv.status, pipelineStage: conv.pipelineStage ?? "new", outcome: conv.outcome ?? null,
          assignedUserId: conv.assignedUserId, createdAt: conv.createdAt,
        },
        messages: messages.map((m: any) => ({
          id: m.id, direction: m.direction, type: m.type, content: m.content, status: m.status,
          externalId: m.externalId, createdAt: m.createdAt, hasMedia: Boolean(m.mediaId || m.mediaUrl || m.mediaStorageKey),
          mediaStored: Boolean(m.mediaStorageKey),
        })),
      }, null, 2),
    };
  }

  /** Org-wide period export (JSON), capped and self-describing
   * about truncation so a partial export is never mistaken for
   * a complete one. */
  async exportInbox(organizationId: string, opts: { from?: string; to?: string } = {}) {
    const from = opts.from ? new Date(opts.from) : new Date(Date.now() - 30 * 86400000);
    const to = opts.to ? new Date(opts.to) : new Date();
    const convs = await (this.prisma as any).channelConversation.findMany({
      where: { organizationId, createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: "asc" }, take: 501,
    });
    const truncated = convs.length > 500;
    const out: any[] = [];
    for (const conv of convs.slice(0, 500)) {
      const messages = await (this.prisma as any).channelMessage.findMany({
        where: { conversationId: conv.id }, orderBy: { createdAt: "asc" }, take: 2000,
      });
      out.push({
        id: conv.id, channel: conv.channel, contactName: conv.contactName, contactPhone: conv.contactPhone,
        status: conv.status, pipelineStage: conv.pipelineStage ?? "new", outcome: conv.outcome ?? null, createdAt: conv.createdAt,
        messages: messages.map((m: any) => ({ direction: m.direction, type: m.type, content: m.content, status: m.status, createdAt: m.createdAt })),
      });
    }
    return {
      exportedAt: new Date().toISOString(), from, to, truncated,
      conversationCount: out.length, conversations: out,
    };
  }

  /** Retention: delete CLOSED conversations resolved longer ago
   * than the org's retentionDays (with their messages, notes,
   * drafts and bot sessions). Open threads are never touched.
   * No policy set -> nothing is deleted. */
  async applyRetention(organizationId: string) {
    const settings = await this.getSettings(organizationId).catch(() => null);
    const days = settings?.retentionDays ?? null;
    if (!days) return { deleted: 0, skipped: "no_policy" };
    const cutoff = new Date(Date.now() - days * 86400000);
    const stale = await (this.prisma as any).channelConversation.findMany({
      where: { organizationId, status: "closed", resolvedAt: { lt: cutoff } },
      take: 500, select: { id: true },
    }).catch(() => []);
    let deletedMessages = 0;
    for (const conv of stale) {
      const id = conv.id;
      deletedMessages += await (this.prisma as any).channelMessage.deleteMany({ where: { conversationId: id } }).then((r: any) => r?.count ?? 0).catch(() => 0);
      await (this.prisma as any).conversationNote?.deleteMany({ where: { conversationId: id } }).catch(() => undefined);
      await (this.prisma as any).messageDraft?.deleteMany({ where: { conversationId: id } }).catch(() => undefined);
      await (this.prisma as any).botSession?.deleteMany({ where: { conversationId: id } }).catch(() => undefined);
      await (this.prisma as any).channelConversation.delete({ where: { id } }).catch(() => undefined);
    }
    if (stale.length) {
      await this.audit.log({
        organizationId, userId: "system", action: "inbox.retention_applied", entityType: "Organization",
        entityId: organizationId, metadata: { retentionDays: days, conversationsDeleted: stale.length, messagesDeleted: deletedMessages },
      }).catch(() => undefined);
    }
    return { deleted: stale.length, messagesDeleted: deletedMessages, retentionDays: days };
  }

  // ----- SLA / team report -----
  async getTeamReport(organizationId: string, days = 7, actorId?: string, teamId?: string) {
    const settings = await this.getSettings(organizationId);
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    // Milestone 71: optional team scoping — the team's lead or a
    // manager may view one team's slice. Conversations count
    // toward the team when their assignee is on the roster or
    // the conversation itself is stamped with the team.
    let scopeIds: string[] | null = null;
    let scopedTeam: any = null;
    if (teamId) {
      if (!actorId) throw new ForbiddenException("A scoped team report requires an identified viewer");
      const scope = await this.teamScope(organizationId, actorId, teamId);
      scopedTeam = scope.team;
      scopeIds = scope.memberIds;
    }
    const inScope = (c: any) => !scopeIds || (c.assignedUserId && scopeIds.includes(c.assignedUserId)) || c.teamId === teamId;
    let convs = await (this.prisma as any).channelConversation.findMany({
      where: { organizationId, createdAt: { gte: since } }, take: 1000,
    });
    let closed = await (this.prisma as any).channelConversation.findMany({
      where: { organizationId, resolvedAt: { gte: since } }, take: 1000,
    });
    let rated = await (this.prisma as any).channelConversation.findMany({
      where: { organizationId, csatRatedAt: { gte: since } }, take: 1000,
    }).catch(() => []);
    if (scopeIds) {
      convs = convs.filter(inScope); closed = closed.filter(inScope); rated = rated.filter(inScope);
    }
    const csatResponses = rated.filter((c: any) => c.csatRating).length;
    const csatAvg = csatResponses ? Math.round((rated.reduce((sum: number, c: any) => sum + (c.csatRating ?? 0), 0) / csatResponses) * 10) / 10 : null;
    const responseMinutes = convs
      .filter((c: any) => c.firstResponseAt)
      .map((c: any) => (new Date(c.firstResponseAt).getTime() - new Date(c.createdAt).getTime()) / 60000)
      .filter((m: number) => m >= 0);
    const avg = responseMinutes.length ? Math.round(responseMinutes.reduce((a: number, b: number) => a + b, 0) / responseMinutes.length) : null;
    let openNow = await (this.prisma as any).channelConversation.findMany({
      where: { organizationId, status: "open" }, take: 1000,
    });
    if (scopeIds) openNow = openNow.filter(inScope);
    const breachCutoff = Date.now() - settings.slaFirstResponseMinutes * 60000;
    const currentBreaches = openNow.filter((c: any) => !c.firstResponseAt && new Date(c.createdAt).getTime() < breachCutoff).length;

    const perAgentMap = new Map<string, { userId: string; assigned: number; closed: number; resp: number[]; res: number[]; csat: number[]; openNow: number }>();
    const agentRow = (uid: string) => {
      const row = perAgentMap.get(uid) ?? { userId: uid, assigned: 0, closed: 0, resp: [] as number[], res: [] as number[], csat: [] as number[], openNow: 0 };
      perAgentMap.set(uid, row);
      return row;
    };
    for (const c of convs) {
      if (!c.assignedUserId) continue;
      const row = agentRow(c.assignedUserId);
      row.assigned++;
      if (c.resolvedAt) row.closed++;
      if (c.firstResponseAt) row.resp.push((new Date(c.firstResponseAt).getTime() - new Date(c.createdAt).getTime()) / 60000);
    }
    for (const c of closed) {
      if (!c.assignedUserId || !c.resolvedAt) continue;
      const minutes = (new Date(c.resolvedAt).getTime() - new Date(c.createdAt).getTime()) / 60000;
      if (minutes >= 0) agentRow(c.assignedUserId).res.push(minutes);
    }
    for (const c of rated) {
      if (c.assignedUserId && c.csatRating) agentRow(c.assignedUserId).csat.push(c.csatRating);
    }
    for (const c of openNow) {
      if (c.assignedUserId) agentRow(c.assignedUserId).openNow++;
    }
    const memberRows = await (this.prisma as any).membership.findMany({
      where: { organizationId, userId: { in: [...perAgentMap.keys()] } }, include: { user: true }, take: 100,
    }).catch(() => []);
    const nameOf = new Map((memberRows as any[]).map((m) => [m.userId, m.user?.name ?? m.user?.email ?? "Agent"]));
    const perAgent = [...perAgentMap.values()].map((r) => ({
      userId: r.userId, name: nameOf.get(r.userId) ?? "Agent",
      assigned: r.assigned, closed: r.closed, openNow: r.openNow,
      avgFirstResponseMinutes: r.resp.length ? Math.round(r.resp.reduce((a, b) => a + b, 0) / r.resp.length) : null,
      avgResolutionMinutes: r.res.length ? Math.round(r.res.reduce((a, b) => a + b, 0) / r.res.length) : null,
      csatAvg: r.csat.length ? Math.round((r.csat.reduce((a, b) => a + b, 0) / r.csat.length) * 10) / 10 : null,
      csatResponses: r.csat.length,
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
    // Unified Inbox U3: autopilot analytics from real rows.
    const windowConvIds = [...new Set([...convs, ...closed, ...rated, ...openNow].map((c: any) => c.id))];
    let autoSent = 0;
    let llmSent = 0;
    if (windowConvIds.length) {
      const autoMsgs = await (this.prisma as any).channelMessage.findMany({
        where: { conversationId: { in: windowConvIds }, autoReply: true, status: "sent" }, take: 2000,
      }).catch(() => []);
      // Only genuine autopilot sends count — the order bot and
      // workflow automations also set autoReply with their own
      // evidence shapes, and must not inflate the autopilot stat.
      const autopilotMsgs = (autoMsgs as any[]).filter((m) => {
        try { return JSON.parse(m.autoReplyEvidence ?? "{}").via === "autopilot"; } catch { return false; }
      });
      autoSent = autopilotMsgs.length;
      llmSent = autopilotMsgs.filter((m) => {
        try { return JSON.parse(m.autoReplyEvidence ?? "{}").tier === "llm"; } catch { return false; }
      }).length;
    }
    let draftsSuggested = 0;
    try {
      draftsSuggested = await (this.prisma as any).messageDraft.count({
        where: {
          organizationId, provider: "auto-reply", createdAt: { gte: since },
          ...(scopeIds ? { conversationId: { in: [...new Set([...convs, ...closed, ...rated].map((c: any) => c.id))] } } : {}),
        },
      });
    } catch { draftsSuggested = 0; }
    let escalatedNow = 0;
    try {
      if (scopeIds) {
        const paused = await (this.prisma as any).channelConversation.findMany({
          where: { organizationId, autoReplyPaused: true }, take: 1000,
        });
        escalatedNow = paused.filter(inScope).length;
      } else {
        escalatedNow = await (this.prisma as any).channelConversation.count({
          where: { organizationId, autoReplyPaused: true },
        });
      }
    } catch { escalatedNow = 0; }

    // U5: close outcomes feed analytics — counted from the real
    // outcome field recorded when threads were closed.
    const outcomes: Record<string, number> = {};
    for (const c of closed) {
      const key = (c as any).outcome ?? "unset";
      outcomes[key] = (outcomes[key] ?? 0) + 1;
    }

    // Milestone 71: per-team aggregation (an agent on two teams
    // counts toward both — noted in the UI) + a daily trend
    // series bucketed by Asia/Dhaka calendar day. Zero-count
    // days are real (nothing happened), not placeholders.
    const pAny = this.prisma as any;
    const allTeams = await pAny.inboxTeam?.findMany({ where: { organizationId } }).catch(() => []) ?? [];
    const allTeamMembers = await pAny.inboxTeamMember?.findMany({
      where: { teamId: { in: (allTeams as any[]).map((t) => t.id) } },
    }).catch(() => []) ?? [];
    const teamMembersOf = new Map<string, string[]>();
    for (const tm of allTeamMembers as any[]) {
      teamMembersOf.set(tm.teamId, [...(teamMembersOf.get(tm.teamId) ?? []), tm.userId]);
    }
    const avgOf = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
    const perTeam = (allTeams as any[]).map((t) => {
      const ids = teamMembersOf.get(t.id) ?? [];
      const rowsT = ids.map((uid) => perAgentMap.get(uid)).filter(Boolean) as any[];
      const resp = rowsT.flatMap((r) => r.resp); const res = rowsT.flatMap((r) => r.res); const csat = rowsT.flatMap((r) => r.csat);
      return {
        teamId: t.id, name: t.name, leadUserId: t.leadUserId ?? null,
        memberCount: ids.length,
        assigned: rowsT.reduce((a, r) => a + r.assigned, 0),
        closed: rowsT.reduce((a, r) => a + r.closed, 0),
        openNow: rowsT.reduce((a, r) => a + r.openNow, 0),
        avgFirstResponseMinutes: avgOf(resp),
        avgResolutionMinutes: avgOf(res),
        csatAvg: csat.length ? Math.round((csat.reduce((a, b) => a + b, 0) / csat.length) * 10) / 10 : null,
      };
    });
    const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    const trendMap = new Map<string, { date: string; created: number; closed: number }>();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 3600 * 1000);
      trendMap.set(dayKey(d), { date: dayKey(d), created: 0, closed: 0 });
    }
    for (const c of convs) { const k = dayKey(new Date(c.createdAt)); if (trendMap.has(k)) trendMap.get(k)!.created++; }
    for (const c of closed) { if (c.resolvedAt) { const k = dayKey(new Date(c.resolvedAt)); if (trendMap.has(k)) trendMap.get(k)!.closed++; } }
    const dailyTrend = [...trendMap.values()];

    return {
      days, slaFirstResponseMinutes: settings.slaFirstResponseMinutes,
      opened: convs.length, closed: closed.length,
      avgFirstResponseMinutes: avg, currentBreaches,
      perAgent, perTeam, dailyTrend,
      scopedTeamId: scopedTeam?.id ?? null, scopedTeamName: scopedTeam?.name ?? null,
      chatLinkedOrders, chatLinkedRevenueMinor, chatLinkedCurrency, csatAvg, csatResponses,
      autopilot: { autoSent, llmSent, draftsSuggested, escalatedNow },
      outcomes,
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
    // Webchat delivery needs no Meta integration (deliverText
    // serves it in-process). Gating webchat on a Meta integration
    // made the order bot / automated messages unusable on the
    // website channel — found live in U3 verification.
    if (!["webchat", "telegram", "email"].includes(conv.channel)) {
      const integration = await this.integrationForConversation(conv);
      const secrets = await this.secretsFor(integration.id);
      void new MetaMessagingClient(secrets); // config gate for Meta channels
    }
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
      this.rtMessage(organizationId, conversationId, sent);
      await this.advanceStage(organizationId, conv, "talking");
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
    shippingMinor?: number; isCod?: boolean; address?: string;
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
        address: dto.address?.slice(0, 500) ?? null,
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
            billing: { first_name: customer.firstName ?? "", phone: customer.phone ?? "", ...(dto.address ? { address_1: dto.address.slice(0, 200) } : {}) },
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
    // U5: the pipeline follows the sale — a first order moves the
    // thread to "ordered"; a customer who already ordered before
    // makes it a "repeat" thread.
    try {
      const prior = await (this.prisma as any).order.count({
        where: { organizationId, customerId: customer.id, id: { not: order.id } },
      }).catch(() => 0);
      const convRow = await this.getConversationOrThrow(organizationId, conversationId).catch(() => null);
      if (convRow) await this.advanceStage(organizationId, convRow, prior > 0 ? "repeat" : "ordered");
    } catch { /* stage never blocks an order */ }
    const items = await (this.prisma as any).orderItem.findMany({ where: { orderId: order.id }, take: 100 });
    const fresh = await (this.prisma as any).order.findFirst({ where: { id: order.id } });
    // M50: attach the return-risk warning for the AGENT (merchant
    // side only — never shown to the customer, never blocks the
    // order). Recorded in the audit trail with the order.
    let risk: any = null;
    if (this.risk) {
      try {
        risk = await this.risk.forOrder(organizationId, fresh);
        if (risk && risk.band !== "low") {
          await this.audit.log({
            organizationId, userId: actorId, action: "inbox.order.risk_warning", entityType: "Order", entityId: order.id,
            metadata: { band: risk.band, score: risk.score, decided: risk.decided },
          }).catch(() => undefined);
        }
      } catch { risk = null; }
    }
    return {
      ...fresh, subtotalMinor: String(fresh.subtotalMinor), shippingMinor: String(fresh.shippingMinor),
      totalMinor: String(fresh.totalMinor), discountMinor: String(fresh.discountMinor ?? 0),
      taxMinor: String(fresh.taxMinor ?? 0), refundedMinor: String(fresh.refundedMinor ?? 0),
      storeSyncStatus: fresh.storeSyncStatus ?? syncStatus,
      items: items.map((i: any) => ({ ...i, priceMinor: String(i.priceMinor), totalMinor: String(i.totalMinor) })),
      risk,
    };
  }

  // ----- Translation + summary -----
  async translateMessage(organizationId: string, conversationId: string, messageId: string, target: string) {
    await this.getConversationOrThrow(organizationId, conversationId);
    await this.checkAiAllowed(organizationId, "translate");
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
    await this.checkAiAllowed(organizationId, "summary");
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
    assignee?: string; tag?: string; sort?: string; folder?: string;
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
    // Inbox Next-Gen P2: smart folders. "mine" / "unassigned"
    // mirror the assignee filter; "sla" / "vip" add an AND clause
    // derived from real fields (see folderExtraWhere), so a folder
    // composes with status/channel/q/tag instead of replacing them.
    if (filters.folder === "mine" && actorId) where.assignedUserId = actorId;
    else if (filters.folder === "unassigned") where.assignedUserId = null;
    else if (filters.folder === "sla" || filters.folder === "vip") {
      const extra = await this.folderExtraWhere(organizationId, filters.folder);
      where.AND = [...(where.AND ?? []), extra];
    }
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
    // Inbox Next-Gen P3: read-time mood + webchat visitor presence.
    // Per-message sentiment was never persisted (only intent), and
    // there is no schema change in this phase — mood is computed
    // here from stored message text with the same deterministic
    // classifier, in ONE batch query for the whole page of rows.
    const ids = rows.map((r: any) => r.id);
    const recentInbound = ids.length ? await this.safeFindMany("channelMessage", {
      where: { conversationId: { in: ids }, direction: "in" }, orderBy: { createdAt: "desc" }, take: 500,
    }) : [];
    const inboundByConv = new Map<string, any[]>();
    for (const m of recentInbound) {
      if (!m.content || !String(m.content).trim()) continue;
      const list = inboundByConv.get(m.conversationId) ?? [];
      if (list.length < 5) { list.push(m); inboundByConv.set(m.conversationId, list); }
    }
    // Visitor last-seen exists only for our own webchat channel.
    const webchatIds = rows.filter((r: any) => r.channel === "webchat").map((r: any) => r.id);
    const sessions = webchatIds.length ? await this.safeFindMany("liveChatSession", {
      where: { conversationId: { in: webchatIds } }, select: { conversationId: true, lastSeenAt: true },
    }) : [];
    const lastSeenByConv = new Map<string, string | null>(sessions.map((s: any) => [
      s.conversationId, s.lastSeenAt ? new Date(s.lastSeenAt).toISOString() : null,
    ]));
    return rows.map((r: any) => ({
      ...r,
      whatsappWindow: this.whatsappWindow(r),
      mood: this.moodOf(inboundByConv.get(r.id) ?? []),
      visitorLastSeenAt: r.channel === "webchat" ? (lastSeenByConv.get(r.id) ?? null) : null,
    }));
  }

  // ----- Inbox Next-Gen P2: smart folders -----

  /**
   * The SLA-breach / VIP where-clauses, shared by the list filter
   * and the folder counts so the two can never drift apart.
   *
   * SLA breach (definition, also in docs/inbox-nextgen-p2-acceptance.md):
   * a conversation still awaiting its FIRST response whose wait has
   * passed the org threshold — firstResponseAt IS NULL, status is
   * open or pending (not closed), and createdAt is older than
   * now − InboxSetting.slaFirstResponseMinutes. This is the team
   * report's currentBreaches rule (which counts status "open")
   * widened to "pending" threads that never got a first response.
   *
   * VIP: the conversation's LATEST linked order (Order.conversationId,
   * newest first — the pipeline board's linkage) totals at least
   * InboxSetting.escalationThresholdMinor, the same high-value
   * threshold the U3 autopilot escalates on. Unset/zero threshold
   * → no VIP folder (empty id list, honest empty state in the UI).
   */
  private async folderExtraWhere(organizationId: string, folder: "sla" | "vip") {
    const settings = await this.getSettings(organizationId);
    if (folder === "sla") {
      const cutoff = new Date(Date.now() - settings.slaFirstResponseMinutes * 60000);
      return { firstResponseAt: null, createdAt: { lt: cutoff }, status: { in: ["open", "pending"] } };
    }
    const ids = await this.vipConversationIds(organizationId, settings.escalationThresholdMinor);
    return { id: { in: ids ?? [] } };
  }

  /** Conversation ids whose latest linked order meets the VIP
   * threshold; null when the org has no threshold configured. */
  private async vipConversationIds(organizationId: string, thresholdMinor: number | null): Promise<string[] | null> {
    if (thresholdMinor == null || thresholdMinor <= 0) return null;
    const orders = await (this.prisma as any).order.findMany({
      where: { organizationId, conversationId: { not: null } },
      orderBy: { createdAt: "desc" }, take: 3000,
      select: { conversationId: true, totalMinor: true },
    }).catch(() => []);
    const latest = new Map<string, bigint>();
    for (const o of orders) {
      if (o.conversationId && !latest.has(o.conversationId)) latest.set(o.conversationId, BigInt(o.totalMinor));
    }
    const threshold = BigInt(thresholdMinor);
    return [...latest.entries()].filter(([, total]) => total >= threshold).map(([id]) => id);
  }

  /** Server-side folder counts. The list is capped at 100 rows,
   * so counts MUST come from here — counting the loaded page
   * would lie. Counts describe the folders themselves (org-wide),
   * independent of the transient q/status filters. */
  async conversationFolderCounts(organizationId: string, actorId: string) {
    const settings = await this.getSettings(organizationId);
    const count = (where: any) => (this.prisma as any).channelConversation.count({ where }).catch(() => 0);
    const vipIds = await this.vipConversationIds(organizationId, settings.escalationThresholdMinor);
    const slaWhere = await this.folderExtraWhere(organizationId, "sla");
    const [all, mine, unassigned, slaBreach] = await Promise.all([
      count({ organizationId }),
      count({ organizationId, assignedUserId: actorId }),
      count({ organizationId, assignedUserId: null }),
      count({ organizationId, ...slaWhere }),
    ]);
    return {
      all, mine, unassigned, slaBreach,
      vip: vipIds ? vipIds.length : 0,
      vipThresholdMinor: settings.escalationThresholdMinor != null ? String(settings.escalationThresholdMinor) : null,
      slaFirstResponseMinutes: settings.slaFirstResponseMinutes,
    };
  }

  // ----- Inbox Next-Gen P2: bulk actions -----

  /**
   * One real bulk endpoint instead of N client-side PATCH loops.
   * Every id runs through the SAME code path as its single-
   * conversation equivalent (updateConversation for close / assign
   * / tag-add — including its validation, CSAT-on-close behaviour
   * and assignee notification; markRead for mark-read), so a bulk
   * effect can never diverge from a manual one. Per-item results:
   * one bad or foreign id reports its own error (org scoping makes
   * foreign ids plain "not found" — nothing leaks) and never fails
   * the batch. One summary audit entry is written for the batch.
   */
  async bulkUpdateConversations(organizationId: string, actorId: string, dto: {
    ids: string[]; action: string; assignedUserId?: string | null; tag?: string;
  }) {
    const ids = [...new Set((dto.ids ?? []).map((s) => String(s).trim()).filter(Boolean))];
    if (!ids.length) throw new BadRequestException("কমপক্ষে একটি কথোপকথন বেছে নিন।");
    if (ids.length > 25) throw new BadRequestException("একবারে সর্বোচ্চ ২৫টি কথোপকথনে বাল্ক অ্যাকশন করা যাবে।");
    const action = dto.action;
    if (!["close", "assign", "tag-add", "mark-read"].includes(action)) {
      throw new BadRequestException("Invalid bulk action (close | assign | tag-add | mark-read)");
    }
    if (action === "assign" && dto.assignedUserId === undefined) {
      throw new BadRequestException("assignedUserId is required for the assign action");
    }
    const tag = (dto.tag ?? "").trim();
    if (action === "tag-add" && !tag) throw new BadRequestException("tag is required for the tag-add action");
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of ids) {
      try {
        if (action === "close") {
          await this.updateConversation(organizationId, actorId, id, { status: "closed" });
        } else if (action === "assign") {
          await this.updateConversation(organizationId, actorId, id, { assignedUserId: dto.assignedUserId ?? null });
        } else if (action === "mark-read") {
          await this.markRead(organizationId, id);
        } else {
          const conv = await this.getConversationOrThrow(organizationId, id);
          await this.updateConversation(organizationId, actorId, id, { tags: [...(conv.tags ?? []), tag] });
        }
        results.push({ id, ok: true });
      } catch (e) {
        results.push({ id, ok: false, error: e instanceof Error ? e.message : "Bulk item failed" });
      }
    }
    const succeeded = results.filter((r) => r.ok).length;
    await this.audit.log({
      organizationId, userId: actorId, action: "inbox.conversations.bulk",
      entityType: "ChannelConversation",
      metadata: { bulkAction: action, requested: ids.length, succeeded, failed: ids.length - succeeded },
    }).catch(() => undefined);
    return { results, succeeded, failed: ids.length - succeeded };
  }

  // ----- Inbox Next-Gen P2: product showcase cards -----

  /**
   * Sends a product as a showcase card: the product's REAL catalog
   * image with a composed caption (name, real price, stock state,
   * order line — see composeProductCardText). Delivery rides the
   * P1 media machinery (sendMediaReply), so the per-channel truth
   * table is P1's: the caption travels with the image on WhatsApp,
   * Telegram, Email and Webchat. Messenger/Instagram attachment
   * uploads carry NO caption, so there the card text follows as
   * its own message and the response says so (image+text).
   *
   * Honest fallbacks: when the product has no usable image (no
   * URL, unfetchable, oversized, or not a sniffable image) the
   * card goes as a plain TEXT message and sentAs says "text". A
   * platform rejection inside sendMediaReply is NOT masked by a
   * fallback — the failed row + verbatim error stand, exactly
   * like every other send path.
   */
  async sendProductCard(organizationId: string, actorId: string, conversationId: string, dto: { productId: string; caption?: string }) {
    const conv = await this.getConversationOrThrow(organizationId, conversationId);
    const product = await (this.prisma as any).product.findFirst({ where: { id: dto.productId, organizationId } });
    if (!product) throw new NotFoundException("Product not found in this organization");
    const cardText = composeProductCardText(product, dto.caption);
    const fetched = await this.fetchProductImage(product).catch(() => null);
    if (fetched) {
      const dataBase64 = fetched.bytes.toString("base64");
      const fileName = defaultMediaFileName("image", fetched.contentType);
      if (conv.channel === "messenger" || conv.channel === "instagram") {
        const imageMessage = await this.sendMediaReply(organizationId, actorId, conversationId, {
          dataBase64, fileName, contentType: fetched.contentType,
        });
        try {
          const captionMessage = await this.sendReply(organizationId, actorId, conversationId, cardText);
          return { sentAs: "image+text", message: imageMessage, captionMessage };
        } catch (e) {
          return {
            sentAs: "image", message: imageMessage, captionDelivered: false,
            captionError: e instanceof Error ? e.message : "Caption send failed",
          };
        }
      }
      const message = await this.sendMediaReply(organizationId, actorId, conversationId, {
        dataBase64, fileName, contentType: fetched.contentType, caption: cardText,
      });
      return { sentAs: "image+caption", message };
    }
    const message = await this.sendReply(organizationId, actorId, conversationId, cardText);
    return { sentAs: "text", message };
  }

  /** Downloads the catalog image and sniffs it with the same
   * magic-byte discipline as uploads. ANY failure (no URL, non-200,
   * empty/oversized body, not an image) returns null → the caller
   * falls back to the text card. Nothing is sent from here. */
  private async fetchProductImage(product: any): Promise<{ bytes: Buffer; contentType: string } | null> {
    const url = String(product.imageUrl ?? "").trim();
    if (!/^https:\/\//i.test(url)) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length || bytes.length > MEDIA_UPLOAD_MAX_BYTES) return null;
    const detected = detectMediaKind(bytes, res.headers.get("content-type") ?? undefined);
    if (!detected || detected.kind !== "image") return null;
    return { bytes, contentType: detected.contentType };
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
    // Inbox Next-Gen P3: mood from the newest inbound texts (the
    // fetched page is newest-first) + a per-message computed
    // sentiment for inbound rows — read-time only, same classifier
    // as ingest, nothing persisted.
    const mood = this.moodOf(messages.filter((m: any) => m.direction === "in"));
    const withSentiment = messages.map((m: any) => ({
      ...m,
      sentiment: m.direction === "in" && m.content && String(m.content).trim()
        ? classifyIntent(String(m.content)).sentiment
        : null,
    }));
    return {
      conversation: { ...conv, whatsappWindow: this.whatsappWindow(conv), mood },
      botSession: await this.getBotSession(conversationId),
      messages: withSentiment.reverse(), drafts, context,
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
    const conv = await this.getConversationOrThrow(organizationId, conversationId);
    try { this.realtime?.notePresence(organizationId, conversationId, userId, typing); } catch { /* ephemeral */ }
    // Inbox Next-Gen P3: on our OWN webchat channel the visitor can
    // honestly be shown the agent is typing (visitor stream). Other
    // channels expose no such signal to customers — nothing is sent.
    if (conv.channel === "webchat") {
      try { this.realtime?.notifyVisitorTyping(conversationId, typing); } catch { /* ephemeral */ }
    }
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
      address: o.address ?? null,
      // Inbox Next-Gen P2: the courier widget needs the shipment
      // id (for the manual sync call), COD amount and last-check
      // time — not just the badge triple it started with.
      shipment: shipByOrder.get(o.id) ? {
        id: shipByOrder.get(o.id).id,
        trackingCode: shipByOrder.get(o.id).trackingCode, status: shipByOrder.get(o.id).status, provider: shipByOrder.get(o.id).provider,
        consignmentId: shipByOrder.get(o.id).consignmentId ?? null,
        codAmountMinor: shipByOrder.get(o.id).codAmountMinor != null ? String(shipByOrder.get(o.id).codAmountMinor) : null,
        lastCheckedAt: shipByOrder.get(o.id).lastCheckedAt ?? null,
      } : null,
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
    const updated = await (this.prisma as any).channelConversation.update({ where: { id: conversationId }, data: { unreadCount: 0 } });
    this.rtConversation(organizationId, conversationId, { unreadCount: 0 });
    return updated;
  }

  async updateConversation(organizationId: string, actorId: string, conversationId: string, dto: { status?: string; assignedUserId?: string | null; tags?: string[]; spamFlag?: boolean; autoReplyPaused?: boolean; pipelineStage?: string; outcome?: string | null; outcomeReason?: string | null }) {
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
    if (dto.autoReplyPaused !== undefined) data.autoReplyPaused = Boolean(dto.autoReplyPaused);
    if (dto.pipelineStage !== undefined) {
      if (!(InboxService.PIPELINE_STAGES as readonly string[]).includes(dto.pipelineStage)) throw new BadRequestException("Invalid pipeline stage");
      data.pipelineStage = dto.pipelineStage;
    }
    if (dto.outcome !== undefined) {
      if (dto.outcome !== null && !(InboxService.CONVERSATION_OUTCOMES as readonly string[]).includes(dto.outcome)) throw new BadRequestException("Invalid conversation outcome");
      data.outcome = dto.outcome;
    }
    if (dto.outcomeReason !== undefined) data.outcomeReason = dto.outcomeReason ? String(dto.outcomeReason).slice(0, 300) : null;
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
    this.rtConversation(organizationId, conversationId, { status: updated.status, assignedUserId: updated.assignedUserId, tags: updated.tags, pipelineStage: updated.pipelineStage, outcome: updated.outcome });
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
    if (conv.channel === "telegram" || conv.channel === "email") {
      // Resolved lazily to avoid a module cycle at boot; the
      // channel services live under inbox/channels and use the
      // integration's own encrypted credentials. A send counts
      // only when the channel API confirms it.
      const { ChannelSendService } = await import("./channels/channel-send.service");
      return new ChannelSendService(this.prisma as any).sendText(conv, content);
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
  // ---------- Milestone 73 (Team T4): self-service ----------

  /** The signed-in member's own signature settings. */
  async getMySignature(organizationId: string, userId: string) {
    const table = (this.prisma as any).agentState;
    if (!table?.findUnique) return { signature: "", enabled: false };
    const row = await table.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    }).catch(() => null);
    return { signature: row?.signature ?? "", enabled: Boolean(row?.signatureEnabled) };
  }

  /** Save the caller's own signature (plain text, ≤ 300
   * chars; applies to their future human replies only). */
  async updateMySignature(organizationId: string, userId: string, dto: { signature?: string; enabled?: boolean }) {
    const signature = (dto.signature ?? "").trim().slice(0, 300);
    const enabled = Boolean(dto.enabled) && signature.length > 0;
    const p = this.prisma as any;
    await p.agentState.upsert({
      where: { organizationId_userId: { organizationId, userId } },
      create: { organizationId, userId, status: "online", signature, signatureEnabled: enabled },
      update: { signature, signatureEnabled: enabled },
    });
    return { signature, enabled };
  }

  /** Append the sender's signature when they enabled one.
   * Only human sends opt in (see sendReply's opts.signature);
   * system templates (COD/CSAT) and automations never carry
   * a personal signature. */
  async withSignature(organizationId: string, actorId: string, content: string): Promise<string> {
    const { signature, enabled } = await this.getMySignature(organizationId, actorId);
    return enabled && signature ? appendSignature(content, signature) : content;
  }

  /** The signed-in member's own performance picture: their
   * scorecard row (with rank context), today's activity row,
   * and their open queue. Nothing about anyone else leaks —
   * the full scorecard stays manager/lead territory. */
  async myPerformance(organizationId: string, userId: string, days: number) {
    const card: any = await this.teamScorecard(organizationId, days);
    const me = (card.agents ?? []).find((a: any) => a.userId === userId) ?? null;
    const activity: any = await this.teamActivity(organizationId).catch(() => null);
    const row = (activity?.members ?? []).find((a: any) => a.userId === userId) ?? null;
    const today = row ? {
      state: row.activityState, onShift: row.onShift,
      repliesToday: row.today?.repliesSent ?? 0, closedToday: row.today?.closedToday ?? 0,
      openNow: row.today?.openNow ?? 0,
    } : null;
    return {
      days, rank: me?.rank ?? null, totalAgents: (card.agents ?? []).length,
      me, today,
    };
  }

  // ---------- Milestone 74 (Team T5): workload rebalance ----------

  /**
   * Move open conversations away from over-capacity agents to
   * the least-busy eligible teammates. Eligibility mirrors the
   * assignment engine: ACTIVE membership, not away, on shift
   * (Milestone 68), under capacity (max team capacity, default
   * 20). A conversation stamped with a team prefers a receiver
   * on that team. The newest conversations move first (the
   * donor has the least history in them). dryRun returns the
   * plan untouched; a real run writes ONE summary audit row.
   */
  async rebalanceWorkload(organizationId: string, actorId: string, opts: { dryRun?: boolean } = {}) {
    const p = this.prisma as any;
    const board: any[] = await this.listAgentStates(organizationId);
    const memberships = await p.membership.findMany({ where: { organizationId } });
    const activeIds = new Set((memberships as any[]).filter((m) => m.status === "ACTIVE").map((m) => m.userId));
    const teams = await p.inboxTeam?.findMany({ where: { organizationId } }).catch(() => []) ?? [];
    const teamName = new Map((teams as any[]).map((t) => [t.id, t.name]));
    const open = await p.channelConversation.findMany({
      where: { organizationId, status: "open", assignedUserId: { not: null } },
      orderBy: { createdAt: "desc" }, take: 2000,
    });
    const byAssignee = new Map<string, any[]>();
    for (const c of open as any[]) {
      const list = byAssignee.get(c.assignedUserId) ?? [];
      list.push(c); byAssignee.set(c.assignedUserId, list);
    }
    const projected = new Map(board.map((b) => [b.userId, b.openCount]));
    const receivers = board
      .filter((b) => activeIds.has(b.userId) && b.status !== "away" && b.onShift)
      .map((b) => ({ ...b }));
    const donors = board
      .filter((b) => (projected.get(b.userId) ?? 0) > b.capacity)
      .sort((a, b) => (projected.get(b.userId) ?? 0) - (projected.get(a.userId) ?? 0));
    const moves: { conversationId: string; fromUserId: string; toUserId: string }[] = [];
    let skippedNoReceiver = 0;
    for (const donor of donors) {
      let excess = (projected.get(donor.userId) ?? 0) - donor.capacity;
      const mine = byAssignee.get(donor.userId) ?? [];
      for (const conv of mine) {
        if (excess <= 0) break;
        const eligible = receivers
          .filter((r) => r.userId !== donor.userId && (projected.get(r.userId) ?? 0) < r.capacity)
          .sort((a, b) => {
            const teamA = conv.teamId && (a.teams ?? []).includes(teamName.get(conv.teamId)) ? 0 : 1;
            const teamB = conv.teamId && (b.teams ?? []).includes(teamName.get(conv.teamId)) ? 0 : 1;
            if (teamA !== teamB) return teamA - teamB;
            return (projected.get(a.userId) ?? 0) - (projected.get(b.userId) ?? 0);
          });
        const target = eligible[0];
        if (!target) { skippedNoReceiver++; continue; }
        moves.push({ conversationId: conv.id, fromUserId: donor.userId, toUserId: target.userId });
        projected.set(donor.userId, (projected.get(donor.userId) ?? 0) - 1);
        projected.set(target.userId, (projected.get(target.userId) ?? 0) + 1);
        excess--;
      }
    }
    if (!opts.dryRun && moves.length) {
      for (const mv of moves) {
        await p.channelConversation.update({ where: { id: mv.conversationId }, data: { assignedUserId: mv.toUserId } });
        await p.agentState?.upsert?.({
          where: { organizationId_userId: { organizationId, userId: mv.toUserId } },
          create: { organizationId, userId: mv.toUserId, status: "online", lastAssignedAt: new Date() },
          update: { lastAssignedAt: new Date() },
        }).catch?.(() => undefined);
      }
      await this.audit.log({
        organizationId, userId: actorId, action: "inbox.workload_rebalanced",
        entityType: "ChannelConversation", entityId: organizationId,
        metadata: { movedCount: moves.length, moves },
      });
    }
    return {
      dryRun: Boolean(opts.dryRun), movedCount: moves.length, moves,
      donorsConsidered: donors.length, skippedNoReceiver,
    };
  }

  async sendReply(organizationId: string, actorId: string, conversationId: string, content: string, opts: { viaDraftId?: string; signature?: boolean } = {}) {
    const conv = await this.getConversationOrThrow(organizationId, conversationId);
    // Milestone 73: a human sender's enabled signature rides
    // along (composer + approved drafts opt in; system
    // templates do not).
    if (opts.signature) content = await this.withSignature(organizationId, actorId, content);
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
          // Unified Inbox U3: a human reply resumes autopilot if
          // an escalation had paused it.
          ...(conv.autoReplyPaused ? { autoReplyPaused: false } : {}),
        },
      });
      // A human reply takes the conversation over from the order bot.
      await (this.prisma as any).botSession?.updateMany?.({ where: { conversationId, status: "active" }, data: { status: "handed_off" } }).catch?.(() => undefined);
      const activeBot = await (this.prisma as any).botSession?.findFirst?.({ where: { conversationId, status: "active" } }).catch?.(() => null);
      if (activeBot) await (this.prisma as any).botSession.update({ where: { id: activeBot.id }, data: { status: "handed_off" } }).catch(() => undefined);
      if (opts.viaDraftId) {
        await (this.prisma as any).messageDraft.update({ where: { id: opts.viaDraftId }, data: { status: "sent" } });
      }
      this.rtMessage(organizationId, conversationId, sent);
      await this.advanceStage(organizationId, conv, "talking");
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
    await this.checkAiAllowed(organizationId, "draft");
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

  // ----- Inbox Next-Gen P3: AI copilot (ghost completion + tone rewrite) -----

  /**
   * Ghost completion: continues the agent's half-written reply.
   * Suggestion only — the agent accepts it explicitly (Tab) in the
   * composer; nothing is ever sent from here. A ghost must NEVER
   * break the composer: short partials, the dev template, provider
   * failures and number-guard rejections all resolve to an empty
   * completion instead of an error. Enforcement failures (kill
   * switch / daily cap) DO throw — those are policy, not flakiness.
   */
  async ghostComplete(organizationId: string, actorId: string, conversationId: string, partialRaw: unknown): Promise<{ completion: string }> {
    const conv = await this.getConversationOrThrow(organizationId, conversationId);
    void conv;
    const partial = String(partialRaw ?? "");
    if (partial.trim().length < 2) return { completion: "" };
    await this.checkAiAllowed(organizationId, "ghost_complete");
    const provider = this.llm.getProvider();
    if (!provider.isRealLlm) return { completion: "" }; // dev template NEVER fabricates a ghost

    const recent = await (this.prisma as any).channelMessage.findMany({
      where: { conversationId }, orderBy: { createdAt: "desc" }, take: 10,
    });
    const history = [...recent].reverse();
    const lastInbound = [...history].reverse().find((m: any) => m.direction === "in");
    const [profile, policies, products] = await Promise.all([
      (this.prisma as any).businessProfile.findUnique({ where: { organizationId } }),
      (this.prisma as any).businessPolicy.findMany({ where: { organizationId }, take: 10 }),
      (this.prisma as any).product.findMany({ where: { organizationId, status: "ACTIVE" }, take: 100 }),
    ]);
    const matchedProduct = matchProduct(lastInbound?.content ?? "", products);
    const knowledge = JSON.stringify({
      business: profile ? { industry: profile.industry, description: profile.description, brandVoice: profile.brandVoice } : null,
      policies: policies.map((p: any) => ({ type: p.type, title: p.title, content: String(p.content).slice(0, 400) })),
      matchedProduct: matchedProduct ? { name: matchedProduct.name, price: formatMinor(BigInt(matchedProduct.priceMinor), matchedProduct.currency), stock: matchedProduct.stockQuantity } : null,
    });

    let result: any;
    try {
      result = await provider.complete([
        { role: "system", content: "You complete a support agent's half-written reply. Continue the partial text with ONE short natural continuation (max ~14 words) in the SAME language/script as the partial. Use ONLY the business knowledge provided: never invent prices, stock, discounts, delivery charges, dates or policies. If a safe grounded continuation is impossible, return an empty response. Return ONLY the continuation — do not repeat the partial text." },
        { role: "user", content: `Business knowledge:\n${knowledge}\n\nConversation (oldest first):\n${history.map((m: any) => `${m.direction === "in" ? "Customer" : "Business"}: ${m.content ?? `[${m.type}]`}`).join("\n")}\n\nAgent's partial reply (continue this):\n${partial}` },
      ], { maxTokens: 80 });
    } catch { return { completion: "" }; }
    // The provider call consumed quota even if the guard below
    // drops the text — record it like every other inbox feature.
    await (this.prisma as any).aIUsageRecord.create({
      data: { organizationId, userId: actorId, feature: "ghost_complete", provider: provider.name, inputTokens: result.inputTokens, outputTokens: result.outputTokens, estimated: result.tokensEstimated },
    }).catch(() => undefined);

    let completion = String(result.text ?? "").trim();
    if (completion.startsWith(partial.trim())) completion = completion.slice(partial.trim().length).trim();
    completion = completion.slice(0, 160);
    // Number guard (same discipline as the autopilot): every
    // number in the continuation must already exist in the
    // partial, the thread, or the grounded knowledge.
    const allowed = new Set(InboxService.extractNumbers(
      `${partial}\n${history.map((m: any) => String(m.content ?? "")).join("\n")}\n${knowledge}`,
    ));
    const invented = InboxService.extractNumbers(completion).filter((n) => !allowed.has(n));
    if (invented.length) return { completion: "" };
    return { completion };
  }

  /**
   * Tone rewrite: rewrites the AGENT'S OWN draft in a chosen tone.
   * Facts are sacred — if the model changes any number, the
   * rewrite is refused outright instead of silently applied.
   */
  async toneRewrite(organizationId: string, actorId: string, conversationId: string, textRaw: unknown, tone: string): Promise<{ text: string }> {
    await this.getConversationOrThrow(organizationId, conversationId);
    const text = String(textRaw ?? "").trim();
    if (!text) throw new BadRequestException("লেখা খালি — আগে কিছু লিখুন।");
    if (text.length > 2000) throw new BadRequestException("লেখা খুব লম্বা (সর্বোচ্চ ২০০০ অক্ষর)।");
    if (!["polite", "professional", "sales"].includes(tone)) {
      throw new BadRequestException("tone must be polite, professional or sales");
    }
    await this.checkAiAllowed(organizationId, "tone_rewrite");
    const provider = this.llm.getProvider();
    if (!provider.isRealLlm) {
      // Honest boundary, same style as translateMessage.
      throw new BadRequestException("টোন বদলাতে একটি আসল LLM provider দরকার (LLM_PROVIDER ও API key সেট করুন)। Dev template দিয়ে টোন বদলানো সম্ভব নয়।");
    }
    const toneInstruction = {
      polite: "মার্জিত ও নম্র (polite and courteous)",
      professional: "পেশাদার ও পরিষ্কার (professional and clear)",
      sales: "বন্ধুসুলভ সেলস-বান্ধব, চাপাচাপি নয় (friendly and sales-aware, never pushy)",
    }[tone as "polite" | "professional" | "sales"];
    const result = await provider.complete([
      { role: "system", content: `You rewrite a support agent's draft reply in this tone: ${toneInstruction}. Hard rules: preserve the meaning, the facts and EVERY number exactly as written; keep the SAME language/script as the input; return ONLY the rewritten text, no explanations.` },
      { role: "user", content: text },
    ], { maxTokens: 500 });
    await (this.prisma as any).aIUsageRecord.create({
      data: { organizationId, userId: actorId, feature: "tone_rewrite", provider: provider.name, inputTokens: result.inputTokens, outputTokens: result.outputTokens, estimated: result.tokensEstimated },
    }).catch(() => undefined);
    const rewritten = String(result.text ?? "").trim();
    const inputNumbers = new Set(InboxService.extractNumbers(text));
    const invented = InboxService.extractNumbers(rewritten).filter((n) => !inputNumbers.has(n));
    if (invented.length) {
      throw new BadRequestException("AI সংখ্যা বদলে ফেলেছে, তাই এই রিরাইটটি প্রয়োগ করা হয়নি। আবার চেষ্টা করুন।");
    }
    return { text: rewritten };
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
      this.rtMessage(organizationId, conversationId, sent);
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
      this.rtMessage(organizationId, conversationId, sent);
      return sent;
    } catch (e) {
      const error = e instanceof Error ? e.message : "Image send failed";
      await (this.prisma as any).channelMessage.update({ where: { id: message.id }, data: { status: "failed", error } });
      throw new BadRequestException(`Image was NOT sent: ${error}`);
    }
  }

  /**
   * Inbox Next-Gen P1: agent-uploaded media (drag-drop, paste,
   * voice recorder). The bytes arrive base64-in-JSON (the M59 logo
   * pattern), are sniffed by magic bytes (the declared type is never
   * trusted for images/PDF), persisted into the SAME MediaStore the
   * inbound pipeline uses — so the agent thread renders them through
   * the existing media proxy — and then delivered per channel.
   * Delivery follows the platform's real upload path per channel
   * (Meta media upload, Messenger attachment upload, Telegram Bot
   * API upload, SMTP attachment, webchat row). The row is "sent"
   * only with the platform's confirmation id, exactly like
   * sendReply/sendImageReply; any platform error marks it failed
   * and is thrown verbatim.
   */
  async sendMediaReply(organizationId: string, actorId: string, conversationId: string, dto: { dataBase64: string; fileName?: string; contentType?: string; caption?: string }) {
    const conv = await this.getConversationOrThrow(organizationId, conversationId);
    const bytes = Buffer.from(String(dto.dataBase64 ?? ""), "base64");
    if (!bytes.length) throw new BadRequestException("ফাইলটি খালি অথবা পড়া যায়নি।");
    if (bytes.length > MEDIA_UPLOAD_MAX_BYTES) throw new BadRequestException(`ফাইল খুব বড় — সর্বোচ্চ ${Math.round(MEDIA_UPLOAD_MAX_BYTES / 100000) / 10}MB পর্যন্ত আপলোড করা যাবে।`);
    const detected = detectMediaKind(bytes, dto.contentType);
    if (!detected) throw new BadRequestException("এই ফাইল ফরম্যাটটি পাঠানো যায় না — ছবি (PNG/JPG/WebP/GIF), অডিও/ভয়েস, MP4/WebM ভিডিও অথবা PDF দিন।");
    const kind = detected.kind;
    const fileName = (dto.fileName ?? "").trim().slice(0, 200) || defaultMediaFileName(kind, detected.contentType);
    const caption = dto.caption?.trim() ? dto.caption.trim().slice(0, 1024) : undefined;
    const message = await (this.prisma as any).channelMessage.create({
      data: {
        conversationId, direction: "out", type: kind,
        content: caption ?? (kind === "image" ? null : fileName),
        status: "queued", sentByUserId: actorId,
      },
    });
    // Persist first (best effort, like captureMessageMedia): the
    // agent thread can render the bytes through the media proxy
    // regardless of the platform outcome; a FAILED row shows its
    // error, never a fake success.
    try {
      const key = mediaKeyFor(organizationId, message.id, detected.contentType);
      await this.mediaStore().put(key, bytes, detected.contentType);
      await (this.prisma as any).channelMessage.update({
        where: { id: message.id },
        data: { mediaStorageKey: key, mediaContentType: detected.contentType, mediaSizeBytes: bytes.length },
      });
    } catch { /* storage best-effort; delivery continues */ }
    try {
      const externalId = await this.deliverMedia(conv, { bytes, contentType: detected.contentType, kind, fileName, caption });
      const sent = await (this.prisma as any).channelMessage.update({
        where: { id: message.id }, data: { status: "sent", externalId },
      });
      const previewLabel = kind === "image" ? "[ছবি]" : kind === "audio" ? "[ভয়েস/অডিও]" : kind === "video" ? "[ভিডিও]" : "[ফাইল]";
      await (this.prisma as any).channelConversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: new Date(), lastMessagePreview: (caption ?? previewLabel).slice(0, 120),
          ...(conv.firstResponseAt ? {} : { firstResponseAt: new Date() }),
          ...(conv.autoReplyPaused ? { autoReplyPaused: false } : {}),
        },
      });
      const activeBot = await (this.prisma as any).botSession?.findFirst?.({ where: { conversationId, status: "active" } }).catch?.(() => null);
      if (activeBot) await (this.prisma as any).botSession.update({ where: { id: activeBot.id }, data: { status: "handed_off" } }).catch(() => undefined);
      this.rtMessage(organizationId, conversationId, sent);
      await this.advanceStage(organizationId, conv, "talking");
      return sent;
    } catch (e) {
      const error = e instanceof Error ? e.message : "Media send failed";
      await (this.prisma as any).channelMessage.update({ where: { id: message.id }, data: { status: "failed", error } });
      throw new BadRequestException(`Media was NOT sent: ${error}`);
    }
  }

  /** Per-channel delivery for uploaded media — see sendMediaReply. */
  private async deliverMedia(conv: any, media: { bytes: Buffer; contentType: string; kind: MediaKind; fileName: string; caption?: string }): Promise<string> {
    if (conv.channel === "webchat") {
      // Same as text: the stored row IS the delivery; the visitor
      // fetches the bytes through the token-guarded public media
      // route and the widget renders them.
      return `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
    if (conv.channel === "telegram" || conv.channel === "email") {
      const { ChannelSendService } = await import("./channels/channel-send.service");
      return new ChannelSendService(this.prisma as any).sendMedia(conv, media);
    }
    const integration = await this.integrationForConversation(conv);
    const secrets = await this.secretsFor(integration.id);
    const client = new MetaMessagingClient(secrets);
    if (conv.channel === "whatsapp") {
      const { mediaId } = await client.uploadWhatsAppMedia(media.bytes, media.contentType, media.fileName);
      const { messageId } = await client.sendWhatsAppMedia(conv.externalContactId, mediaId, media.kind, media.caption, media.fileName);
      return messageId;
    }
    const { attachmentId } = await client.uploadMessengerAttachment(media.bytes, media.contentType, media.kind, media.fileName);
    const { messageId } = await client.sendMessengerAttachment(conv.externalContactId, attachmentId, media.kind);
    return messageId;
  }

  /**
   * Resolves a message's media bytes for the authenticated agent UI.
   * Messenger attachments have direct URLs; WhatsApp media goes through
   * the Graph API with the integration token. Bytes are proxied, the
   * platform token never reaches the browser.
   */
  private mediaStore(): MediaStore {
    if (!this._mediaStore) this._mediaStore = MediaStore.fromEnv();
    return this._mediaStore;
  }
  private _mediaStore: MediaStore | null = null;

  /** U6: persist a message's platform media into durable storage
   * (platform ids/urls expire). Best effort — a capture failure
   * never blocks the conversation; the proxy can retry later. */
  async captureMessageMedia(organizationId: string, conv: any, message: any, prefetched?: { bytes: Buffer; contentType: string }): Promise<boolean> {
    if (message.mediaStorageKey) return true;
    if (!message.mediaId && !message.mediaUrl) return false;
    const { bytes, contentType } = prefetched ?? await this.fetchPlatformMedia(conv, message);
    const key = mediaKeyFor(organizationId, message.id, contentType);
    await this.mediaStore().put(key, bytes, contentType);
    await (this.prisma as any).channelMessage.update({
      where: { id: message.id },
      data: { mediaStorageKey: key, mediaContentType: contentType, mediaSizeBytes: bytes.length },
    });
    return true;
  }

  private async fetchPlatformMedia(conv: any, message: any): Promise<{ bytes: Buffer; contentType: string }> {
    if (message.mediaId) {
      const integration = await this.integrationForConversation(conv);
      const secrets = await this.secretsFor(integration.id);
      return new MetaMessagingClient(secrets).downloadWhatsAppMedia(message.mediaId);
    }
    const res = await fetch(message.mediaUrl);
    if (!res.ok) throw new BadRequestException(`Media fetch failed (${res.status})`);
    return { bytes: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
  }

  async getMessageMedia(organizationId: string, conversationId: string, messageId: string): Promise<{ bytes: Buffer; contentType: string }> {
    const conv = await this.getConversationOrThrow(organizationId, conversationId);
    const message = await (this.prisma as any).channelMessage.findFirst({ where: { id: messageId, conversationId } });
    if (!message) throw new NotFoundException("Message not found in this conversation");
    if (message.mediaStorageKey) {
      const stored = await this.mediaStore().get(message.mediaStorageKey).catch(() => null);
      if (stored) return { bytes: stored, contentType: message.mediaContentType ?? "application/octet-stream" };
    }
    if (message.mediaId) {
      const integration = await this.integrationForConversation(conv);
      const secrets = await this.secretsFor(integration.id);
      const got = await new MetaMessagingClient(secrets).downloadWhatsAppMedia(message.mediaId);
      await this.captureMessageMedia(organizationId, conv, message, got).catch(() => undefined);
      return got;
    }
    if (message.mediaUrl) {
      const got = await this.fetchPlatformMedia(conv, message);
      await this.captureMessageMedia(organizationId, conv, message, got).catch(() => undefined);
      return got;
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
    return this.sendReply(organizationId, actorId, conversationId, content, { viaDraftId: draftId, signature: true });
  }
}

/** Milestone 74: assignment fairness from scorecard rows.
 * sharePercent = the agent's slice of all assignments in the
 * period; deviation = share − equal share (100 / headcount).
 * Percentages are rounded to 0.1; with zero assignments the
 * honest answer is all-zero shares, not an invented split. */
export function buildFairness(rows: { userId: string; current: { assigned: number } }[]) {
  const totalAssigned = rows.reduce((s, r) => s + (r.current?.assigned ?? 0), 0);
  const equalSharePercent = rows.length ? Math.round((1000 / rows.length)) / 10 : 0;
  const perAgent = rows.map((r) => {
    const assigned = r.current?.assigned ?? 0;
    const sharePercent = totalAssigned ? Math.round((1000 * assigned) / totalAssigned) / 10 : 0;
    return {
      userId: r.userId, assigned, sharePercent,
      deviationPercent: Math.round((sharePercent - equalSharePercent) * 10) / 10,
    };
  });
  const shares = perAgent.map((a) => a.sharePercent);
  return {
    totalAssigned, equalSharePercent,
    spreadPercent: shares.length ? Math.round((Math.max(...shares) - Math.min(...shares)) * 10) / 10 : 0,
    perAgent,
  };
}

/** Milestone 73: how a signature joins a message body. */
export function appendSignature(content: string, signature: string): string {
  const sig = signature.trim();
  if (!sig) return content;
  return `${content}\n\n${sig}`;
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
