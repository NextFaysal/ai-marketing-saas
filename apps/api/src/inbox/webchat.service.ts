import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { InboxService } from "./inbox.service";

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
  ) {}

  // ----- Site management (authenticated) -----
  async createSite(organizationId: string, actorId: string, dto: { name: string; domain?: string; greeting?: string; color?: string }) {
    if (!dto.name?.trim()) throw new BadRequestException("Site name is required");
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
    if (!site) throw new NotFoundException("Widget site not found");
    return (this.prisma as any).widgetSite.update({ where: { id: siteId }, data: { enabled } });
  }

  // ----- Public widget API (site key + session token) -----
  private async siteByKey(key: string) {
    const site = await (this.prisma as any).widgetSite.findFirst({ where: { widgetKey: key } });
    if (!site || !site.enabled) throw new NotFoundException("Chat is not available for this site");
    return site;
  }

  async startSession(key: string, dto: { visitorId: string; name?: string }) {
    const site = await this.siteByKey(key);
    if (!dto.visitorId?.trim()) throw new BadRequestException("visitorId is required");
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
    if (!token) throw new UnauthorizedException("Missing chat session token");
    const session = await (this.prisma as any).liveChatSession.findFirst({
      where: { widgetSiteId: site.id, visitorTokenHash: tokenHash(token) },
    });
    if (!session) throw new UnauthorizedException("Invalid chat session token");
    return { site, session };
  }

  async postMessage(key: string, dto: { token: string; text: string }) {
    const { site, session } = await this.sessionByToken(key, dto.token);
    const text = dto.text?.trim();
    if (!text) throw new BadRequestException("Message text is required");
    if (text.length > 2000) throw new BadRequestException("Message is too long (max 2000 characters)");
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

  async listMessages(key: string, token: string) {
    const { session } = await this.sessionByToken(key, token);
    const rows = await (this.prisma as any).channelMessage.findMany({
      where: { conversationId: session.conversationId }, orderBy: { createdAt: "asc" }, take: 100,
    });
    return rows.map((m: any) => ({
      id: m.id, direction: m.direction, content: m.content, type: m.type, createdAt: m.createdAt,
    }));
  }
}
