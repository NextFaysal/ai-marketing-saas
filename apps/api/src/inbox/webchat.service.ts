import { Injectable, Optional } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { InboxService } from "./inbox.service";
import { RealtimeService } from "./realtime.service";
import { LeadAssignmentService } from "../crm/lead-assignment.service";
import { parseProductCard } from "./product-card";
import { nextDeliveryPatch } from "./message-lifecycle";
import { MediaStore } from "./media-store";
import { badRequest, notFound, unauthorized } from "../i18n/api-exception";

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Website live chat. A WidgetSite (public key) lives on the store's
 * website; visitors get a session token (only its SHA-256 is stored).
 * Messages land in the unified inbox as channel "webchat"; agent
 * replies are rows the widget polls - our own channel, so delivery is
 * the row itself.
 */
@Injectable()
export class WebchatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly inbox: InboxService,
    // Milestone 66: visitor realtime (same module's service).
    @Optional() private readonly realtime?: RealtimeService,
    // CRM C5: lead auto-assignment for visitor-created leads.
    @Optional() private readonly leadAssignment?: LeadAssignmentService,
  ) {}

  // ----- Site management (authenticated) -----
  async createSite(organizationId: string, actorId: string, dto: { name: string; domain?: string; greeting?: string; color?: string }) {
    if (!dto.name?.trim()) throw badRequest("inbox.siteNameIsRequired");
    const integration = await (this.prisma as any).integration.create({
      data: { organizationId, provider: "webchat", status: "CONNECTED", externalAccountId: dto.domain ?? null },
    });
    const site = await (this.prisma as any).widgetSite.create({
      data: {
        organizationId, integrationId: integration.id, name: dto.name.trim(),
        domain: dto.domain?.trim() || null, greeting: dto.greeting?.trim() || null,
        color: dto.color?.trim() || null, widgetKey: `wc_${randomBytes(18).toString("hex")}`, enabled: true,
      },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "webchat.site.created", entityType: "WidgetSite", entityId: site.id, metadata: { name: site.name } });
    return site;
  }

  async listSites(organizationId: string) {
    return (this.prisma as any).widgetSite.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 50 });
  }

  async setSiteEnabled(organizationId: string, siteId: string, enabled: boolean) {
    const site = await (this.prisma as any).widgetSite.findFirst({ where: { id: siteId, organizationId } });
    if (!site) throw notFound("inbox.widgetSiteNotFound");
    return (this.prisma as any).widgetSite.update({ where: { id: siteId }, data: { enabled } });
  }

  // ----- Public widget API (site key + session token) -----
  private async siteByKey(key: string) {
    const site = await (this.prisma as any).widgetSite.findFirst({ where: { widgetKey: key } });
    if (!site || !site.enabled) throw notFound("inbox.chatIsNotAvailableForThis");
    return site;
  }

  async startSession(key: string, dto: { visitorId: string; name?: string }) {
    const site = await this.siteByKey(key);
    if (!dto.visitorId?.trim()) throw badRequest("inbox.visitoridIsRequired");
    const token = randomBytes(32).toString("hex");
    const existing = await (this.prisma as any).liveChatSession.findFirst({
      where: { widgetSiteId: site.id, visitorId: dto.visitorId.trim() },
    });
    if (existing) {
      await (this.prisma as any).liveChatSession.update({
        where: { id: existing.id },
        data: { visitorTokenHash: tokenHash(token), visitorName: dto.name?.trim() || existing.visitorName, lastSeenAt: new Date() },
      });
      return { token, conversationId: existing.conversationId, greeting: site.greeting, color: site.color, siteName: site.name };
    }
    // New visitor: conversation + lead, like every other channel.
    const conversation = await (this.prisma as any).channelConversation.create({
      data: {
        organizationId: site.organizationId, integrationId: site.integrationId, channel: "webchat",
        externalContactId: `visitor-${dto.visitorId.trim()}`, contactName: dto.name?.trim() || "Website visitor",
      },
    });
    const lead = await (this.prisma as any).lead.create({
      data: { organizationId: site.organizationId, name: dto.name?.trim() || "Website visitor", source: "webchat", stage: "new" },
    });
    await (this.prisma as any).leadActivity.create({
      data: { leadId: lead.id, type: "created", content: `Auto-created from website chat (${site.name})` },
    });
    // CRM C5: the org's lead auto-assignment strategy applies.
    await this.leadAssignment?.assignNewLead(site.organizationId, lead.id).catch(() => undefined);
    await (this.prisma as any).channelConversation.update({ where: { id: conversation.id }, data: { leadId: lead.id } });
    const session = await (this.prisma as any).liveChatSession.create({
      data: {
        widgetSiteId: site.id, conversationId: conversation.id, visitorId: dto.visitorId.trim(),
        visitorTokenHash: tokenHash(token), visitorName: dto.name?.trim() || null,
      },
    });
    return { token, conversationId: session.conversationId, greeting: site.greeting, color: site.color, siteName: site.name };
  }

  private async sessionByToken(key: string, token: string) {
    const site = await this.siteByKey(key);
    if (!token) throw unauthorized("inbox.missingChatSessionToken");
    const session = await (this.prisma as any).liveChatSession.findFirst({
      where: { widgetSiteId: site.id, visitorTokenHash: tokenHash(token) },
    });
    if (!session) throw unauthorized("inbox.invalidChatSessionToken");
    return { site, session };
  }

  async postMessage(key: string, dto: { token: string; text: string }) {
    const { site, session } = await this.sessionByToken(key, dto.token);
    const text = dto.text?.trim();
    if (!text) throw badRequest("inbox.messageTextIsRequired");
    if (text.length > 2000) throw badRequest("inbox.messageIsTooLongMax2000");
    const message = await (this.prisma as any).channelMessage.create({
      data: {
        conversationId: session.conversationId, direction: "in", type: "text",
        content: text.slice(0, 2000), status: "received", externalId: `web-in-${randomUUID()}`,
      },
    });
    try { this.inbox.emitInboxEvent(session.organizationId ?? (site as any).organizationId, { type: "message.created", conversationId: session.conversationId, message }); } catch { /* realtime is best-effort */ }
    await (this.prisma as any).channelConversation.update({
      where: { id: session.conversationId },
      data: {
        unreadCount: { increment: 1 }, lastMessageAt: new Date(), lastCustomerMessageAt: new Date(),
        lastMessagePreview: text.slice(0, 120), status: "open",
      },
    });
    await (this.prisma as any).liveChatSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    // Same intelligence pipeline as every other channel (intent,
    // auto-reply, bot, workflows) - replies arrive via polling.
    await this.inbox.ingestChatMessage(site.organizationId, session.conversationId, message.id);
    return { id: message.id, createdAt: message.createdAt };
  }

  /**
   * Inbox Next-Gen P3: visitor presence heartbeat from the widget
   * (the one channel where customer presence/typing honestly
   * exists — both ends are ours). Token discipline is
   * sessionByToken's: a bad token is a 401 before anything is
   * recorded. The lastSeenAt write is throttled to one per 30s —
   * the widget heartbeats far more often than the stored value
   * needs — but the presence event to agents is always reported.
   */
  async visitorPresence(key: string, dto: { token: string; typing?: boolean }) {
    const { site, session } = await this.sessionByToken(key, dto.token);
    const lastSeen = session.lastSeenAt ? new Date(session.lastSeenAt).getTime() : 0;
    if (!lastSeen || Date.now() - lastSeen > 30_000) {
      await (this.prisma as any).liveChatSession.update({
        where: { id: session.id }, data: { lastSeenAt: new Date() },
      }).catch(() => undefined);
    }
    try { this.inbox.emitVisitorPresence(site.organizationId, session.conversationId, Boolean(dto.typing)); } catch { /* realtime is best-effort */ }
    return { ok: true };
  }

  /**
   * Milestone 66: the visitor's realtime stream. The
   * conversation is derived from the session token alone —
   * there is no way to subscribe to someone else's thread.
   * Throws 401 for a bad token before any stream opens.
   */
  async streamFor(key: string, token: string) {
    const { session } = await this.sessionByToken(key, token);
    if (!this.realtime) throw badRequest("inbox.realtimeIsNotAvailableInThis");
    return this.realtime.streamVisitor(session.conversationId);
  }

  async listMessages(key: string, token: string) {
    const { site, session } = await this.sessionByToken(key, token);
    const rows = await (this.prisma as any).channelMessage.findMany({
      where: { conversationId: session.conversationId }, orderBy: { createdAt: "asc" }, take: 100,
    });
    // IN6a (webchat): this fetch IS the visitor's real read path —
    // the widget only calls it to render the thread to the visitor.
    // Agent messages handed to the visitor here are therefore
    // honestly "read" (our own channel: fetch = delivery + view).
    // Monotonic via the same lifecycle patch; failures never break
    // the visitor's thread load.
    for (const m of rows as any[]) {
      if (m.direction !== "out") continue;
      const patch = nextDeliveryPatch(m, "read", new Date());
      if (!patch) continue;
      // Best-effort only: a missing column (migration not yet run)
      // or any write failure must never break the visitor's thread
      // load, and the in-memory row is only marked read when the
      // write actually succeeded — never claim a read we did not
      // persist. (A .catch() alone is not enough: a prisma fake or
      // partial client without `update` throws synchronously.)
      try {
        await (this.prisma as any).channelMessage.update({
          where: { id: m.id },
          data: {
            status: patch.status, deliveryStatus: patch.deliveryStatus,
            ...(patch.deliveredAt && !m.deliveredAt ? { deliveredAt: patch.deliveredAt } : {}),
            ...(patch.readAt && !m.readAt ? { readAt: patch.readAt } : {}),
          },
        });
        Object.assign(m, { deliveryStatus: "read", readAt: patch.readAt ?? m.readAt });
        try { this.inbox.emitInboxEvent(site.organizationId, { type: "conversation.updated", conversationId: session.conversationId }); } catch { /* best-effort */ }
      } catch { /* read marking is best-effort; listing continues */ }
    }
    return rows.map((m: any) => ({
      id: m.id, direction: m.direction, content: m.content, type: m.type, createdAt: m.createdAt,
      // Inbox Next-Gen P1: agent-uploaded media (stored by us) gets a
      // token-guarded media path; platform-hosted media ids/URLs are
      // never exposed to visitors. The token in the URL is the
      // visitor's own session token — the only credential that can
      // open it, and only for this conversation's messages.
      mediaUrl: m.mediaStorageKey ? `/public/chat/${key}/messages/${m.id}/media?token=${encodeURIComponent(token)}` : null,
      // Inbox Next-Gen P2: product showcase cards are recognised
      // from the composed caption (see product-card.ts) so the
      // widget can render a card + order button. Only the product
      // name + formatted price are exposed — nothing internal.
      product: parseProductCard(m),
    }));
  }

  /**
   * Inbox Next-Gen P1: serve stored media bytes to the visitor who
   * owns the session. The message must belong to the session's own
   * conversation (derived from the token, never client-supplied)
   * and must carry OUR stored copy — platform media is not proxied
   * to visitors.
   */
  async getVisitorMedia(key: string, token: string, messageId: string): Promise<{ bytes: Buffer; contentType: string }> {
    const { session } = await this.sessionByToken(key, token);
    const message = await (this.prisma as any).channelMessage.findFirst({
      where: { id: messageId, conversationId: session.conversationId },
    });
    if (!message?.mediaStorageKey) throw notFound("inbox.mediaNotFoundForThisConversation");
    const bytes = await MediaStore.fromEnv().get(message.mediaStorageKey).catch(() => null);
    if (!bytes) throw notFound("inbox.mediaNotFoundForThisConversation");
    return { bytes, contentType: message.mediaContentType ?? "application/octet-stream" };
  }
}
