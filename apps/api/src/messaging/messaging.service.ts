import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EmailProvider } from "./email.provider";
import { MetaMessagingClient } from "../inbox/meta-messaging.client";
import { decryptJson } from "../integrations/crypto";
import { SmsProvider, normalizeBdPhone } from "./sms.provider";
import { renderTemplate } from "./render";

export interface Recipient { type: "customer" | "lead"; id: string; name: string; email?: string | null; phone?: string | null }

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly email: EmailProvider,
    private readonly sms: SmsProvider,
  ) {}

  providerStatus() {
    return {
      email: { configured: this.email.isConfigured(), transport: "SMTP" },
      sms: { configured: this.sms.isConfigured(), provider: "SSL Wireless (BD)" },
    };
  }

  // ---------- Templates ----------
  async createTemplate(organizationId: string, actorId: string, dto: { name: string; channel: string; subject?: string; body: string }) {
    if (!["email", "sms"].includes(dto.channel)) throw new BadRequestException("channel must be email or sms");
    if (dto.channel === "email" && !dto.subject) throw new BadRequestException("Email templates need a subject");
    const template = await (this.prisma as any).messageTemplate.create({
      data: { organizationId, name: dto.name, channel: dto.channel, subject: dto.subject ?? null, body: dto.body, createdById: actorId },
    });
    return template;
  }

  async listTemplates(organizationId: string, channel?: string) {
    return (this.prisma as any).messageTemplate.findMany({
      where: { organizationId, ...(channel ? { channel } : {}) }, orderBy: { createdAt: "desc" },
    });
  }

  async getTemplate(organizationId: string, templateId: string) {
    const template = await (this.prisma as any).messageTemplate.findFirst({ where: { id: templateId, organizationId } });
    if (!template) throw new NotFoundException("Template not found");
    return template;
  }

  async updateTemplate(organizationId: string, templateId: string, dto: { name?: string; subject?: string; body?: string }) {
    await this.getTemplate(organizationId, templateId);
    return (this.prisma as any).messageTemplate.update({ where: { id: templateId }, data: { ...dto } });
  }

  async deleteTemplate(organizationId: string, templateId: string) {
    await this.getTemplate(organizationId, templateId);
    await (this.prisma as any).messageTemplate.delete({ where: { id: templateId } });
    return { deleted: true };
  }

  // ---------- Audience ----------
  async resolveAudience(
    organizationId: string,
    channel: string,
    audienceType: string,
    audienceStage?: string,
    audienceSegment?: string,
    opts?: { excludePastDays?: number; excludeOptOut?: boolean },
  ): Promise<Recipient[]> {
    const channelField = channel === "email" ? "email" : "phone";
    const excludeOptOut = opts?.excludeOptOut !== false;

    let recipients: Recipient[] = [];
    if (audienceType === "customers") {
      let rows = await (this.prisma as any).customer.findMany({
        where: {
          organizationId,
        },
      });
      if (excludeOptOut) {
        rows = rows.filter((c: any) => !c.unsubscribed);
      }
      recipients = rows
        .filter((c: any) => (channelField === "email" ? c.email : c.phone))
        .map((c: any) => ({ type: "customer" as const, id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(" ") || "Customer", email: c.email, phone: c.phone }));
    } else if (audienceType === "leads_stage") {
      if (!audienceStage) throw new BadRequestException("audienceStage is required for leads_stage audience");
      let rows = await (this.prisma as any).lead.findMany({
        where: {
          organizationId,
          stage: audienceStage,
        },
      });
      if (excludeOptOut) {
        rows = rows.filter((l: any) => !l.unsubscribed);
      }
      recipients = rows
        .filter((l: any) => (channelField === "email" ? l.email : l.phone))
        .map((l: any) => ({ type: "lead" as const, id: l.id, name: l.name, email: l.email, phone: l.phone }));
    } else if (audienceType === "segment") {
      if (!audienceSegment) throw new BadRequestException("audienceSegment is required for segment audience");
      const { computeRfm } = await import("./rfm");
      const rows = await computeRfm(this.prisma as any, organizationId);
      let optOutCustomerIds = new Set<string>();
      if (excludeOptOut) {
        const optedOut = await (this.prisma as any).customer.findMany({
          where: { organizationId, unsubscribed: true },
          select: { id: true },
        }).catch(() => []);
        optOutCustomerIds = new Set((optedOut as any[]).map((c) => c.id));
      }
      recipients = rows
        .filter((r) => r.segment === audienceSegment && !optOutCustomerIds.has(r.customerId))
        .filter((r) => (channelField === "email" ? r.email : r.phone))
        .map((r) => ({ type: "customer" as const, id: r.customerId, name: r.name, email: r.email, phone: r.phone }));
    } else {
      throw new BadRequestException("audienceType must be customers, leads_stage or segment");
    }

    // CX10: Exclude recent broadcast deliveries within last X days
    if (opts?.excludePastDays && opts.excludePastDays > 0) {
      const cutoff = new Date(Date.now() - opts.excludePastDays * 24 * 60 * 60 * 1000);
      const recentDeliveries = await (this.prisma as any).messageDelivery.findMany({
        where: { organizationId, createdAt: { gte: cutoff } },
        select: { address: true, recipientId: true },
        take: 50000,
      }).catch(() => []);
      const excludedAddresses = new Set((recentDeliveries as any[]).map((d) => d.address).filter(Boolean));
      const excludedIds = new Set((recentDeliveries as any[]).map((d) => d.recipientId).filter(Boolean));

      recipients = recipients.filter((r) => {
        const addr = channelField === "email" ? r.email : r.phone;
        if (excludedIds.has(r.id)) return false;
        if (addr && excludedAddresses.has(addr)) return false;
        return true;
      });
    }

    return recipients;
  }

  /**
   * CX10: Audience preview before send — computes total eligible,
   * excluded count (opt-out & recent broadcasts), and returns a sample.
   */
  async previewAudience(organizationId: string, input: {
    channel: string;
    audienceType: string;
    audienceStage?: string;
    audienceSegment?: string;
    excludePastDays?: number;
    excludeOptOut?: boolean;
  }) {
    const raw = await this.resolveAudience(organizationId, input.channel, input.audienceType, input.audienceStage, input.audienceSegment, { excludeOptOut: false });
    const totalRaw = raw.length;

    const filtered = await this.resolveAudience(organizationId, input.channel, input.audienceType, input.audienceStage, input.audienceSegment, {
      excludePastDays: input.excludePastDays,
      excludeOptOut: input.excludeOptOut ?? true,
    });
    const totalEligible = filtered.length;

    const sample = filtered.slice(0, 10).map((r) => {
      const rawContact = input.channel === "email" ? (r.email ?? "") : (r.phone ?? "");
      let masked = rawContact;
      if (input.channel === "email" && rawContact.includes("@")) {
        const [user, domain] = rawContact.split("@");
        masked = `${user.slice(0, 2)}***@${domain}`;
      } else if (rawContact.length >= 6) {
        masked = rawContact.slice(0, 3) + "****" + rawContact.slice(-3);
      }
      return {
        id: r.id,
        type: r.type,
        name: r.name,
        maskedContact: masked,
      };
    });

    return {
      totalRaw,
      totalEligible,
      excludedCount: Math.max(0, totalRaw - totalEligible),
      sample,
    };
  }

  async rfmReport(organizationId: string) {
    const { computeRfm, RFM_SEGMENTS } = await import("./rfm");
    const rows = await computeRfm(this.prisma as any, organizationId);
    const counts: Record<string, number> = {};
    for (const seg of RFM_SEGMENTS) counts[seg] = rows.filter((r) => r.segment === seg).length;
    return { totalCustomers: rows.length, segments: counts, rows: rows.slice(0, 200) };
  }

  // ---------- Single send (used by broadcasts AND workflows) ----------
  async sendToRecipient(organizationId: string, input: {
    channel: string; recipient: Recipient; subject?: string | null; body: string;
    vars: Record<string, unknown>; broadcastId?: string; workflowRunId?: string;
  }): Promise<{ status: "sent" | "failed"; providerMessageId?: string; error?: string; address: string }> {
    const text = renderTemplate(input.body, { name: input.recipient.name, ...input.vars });
    let address = "";
    try {
      if (input.channel === "email") {
        address = input.recipient.email ?? "";
        if (!address) throw new Error("Recipient has no email address");
        const subject = renderTemplate(input.subject ?? "", { name: input.recipient.name, ...input.vars });
        const result = await this.email.send({ to: address, subject, text });
        await this.recordDelivery(organizationId, input, address, "sent", result.providerMessageId);
        return { status: "sent", providerMessageId: result.providerMessageId, address };
      }
      if (input.channel === "sms") {
        const raw = input.recipient.phone ?? "";
        const normalized = normalizeBdPhone(raw);
        if (!normalized) throw new Error(`Phone number cannot be normalized for SMS: ${raw || "(empty)"}`);
        address = normalized;
        const result = await this.sms.send({ to: normalized, text, reference: randomUUID().replace(/-/g, "").slice(0, 20) });
        await this.recordDelivery(organizationId, input, address, "sent", result.providerMessageId);
        return { status: "sent", providerMessageId: result.providerMessageId, address };
      }
      throw new Error(`Unknown channel: ${input.channel}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Send failed";
      await this.recordDelivery(organizationId, input, address || input.recipient.email || input.recipient.phone || "", "failed", undefined, message);
      return { status: "failed", error: message, address };
    }
  }

  private async recordDelivery(organizationId: string, input: { channel: string; recipient: Recipient; broadcastId?: string; workflowRunId?: string }, address: string, status: string, providerMessageId?: string, error?: string) {
    await (this.prisma as any).messageDelivery.create({
      data: {
        organizationId, broadcastId: input.broadcastId ?? null, workflowRunId: input.workflowRunId ?? null,
        channel: input.channel, recipientType: input.recipient.type, recipientId: input.recipient.id,
        address, status, providerMessageId: providerMessageId ?? null, error: error ?? null,
      },
    }).catch(() => undefined); // delivery logging must never crash a send loop
  }

  // ---------- Broadcasts ----------
  async createBroadcast(organizationId: string, actorId: string, dto: {
    name: string; channel: string; templateId?: string; subject?: string; body?: string; audienceType: string; audienceStage?: string; audienceSegment?: string;
    whatsappTemplateId?: string; templateParams?: string[];
    abTest?: boolean; abSubject?: string; abBody?: string; abWhatsappTemplateId?: string;
    excludePastDays?: number; excludeOptOut?: boolean;
  }) {
    if (!["email", "sms", "whatsapp"].includes(dto.channel)) throw new BadRequestException("channel must be email, sms or whatsapp");
    let subject = dto.subject ?? null;
    let body = dto.body ?? "";
    if (dto.channel === "whatsapp") {
      // WhatsApp broadcasts send a registered, Meta-approved template.
      // Free-form marketing messages outside the 24h window are not
      // allowed by Meta, so there is deliberately no body-only path.
      if (!dto.whatsappTemplateId) throw new BadRequestException("WhatsApp broadcasts need a registered template (whatsappTemplateId)");
      const tpl = await (this.prisma as any).whatsAppTemplate.findFirst({ where: { id: dto.whatsappTemplateId, organizationId } });
      if (!tpl) throw new NotFoundException("WhatsApp template not found in this organization");
      body = tpl.bodyText ?? `[WhatsApp template: ${tpl.name}]`;
      const baseWa = {
        organizationId, channel: "whatsapp", templateId: null,
        templateParams: dto.templateParams ?? [], subject: null,
        audienceType: dto.audienceType, audienceStage: dto.audienceStage ?? null, audienceSegment: dto.audienceSegment ?? null,
        excludePastDays: dto.excludePastDays ?? null, excludeOptOut: dto.excludeOptOut ?? true,
        status: "draft", createdById: actorId,
      };
      if (dto.abTest) {
        if (!dto.abWhatsappTemplateId) throw new BadRequestException("A/B WhatsApp broadcasts need a second template (abWhatsappTemplateId)");
        const tplB = await (this.prisma as any).whatsAppTemplate.findFirst({ where: { id: dto.abWhatsappTemplateId, organizationId } });
        if (!tplB) throw new NotFoundException("A/B WhatsApp template not found in this organization");
        const abGroupId = randomUUID();
        const a = await (this.prisma as any).broadcast.create({ data: { ...baseWa, name: `${dto.name} (A)`, whatsappTemplateId: tpl.id, body, abVariant: "A", abGroupId } });
        const b = await (this.prisma as any).broadcast.create({ data: { ...baseWa, name: `${dto.name} (B)`, whatsappTemplateId: tplB.id, body: tplB.bodyText ?? `[WhatsApp template: ${tplB.name}]`, abVariant: "B", abGroupId } });
        return { abGroupId, variants: [a, b] };
      }
      const broadcast = await (this.prisma as any).broadcast.create({
        data: { ...baseWa, name: dto.name, whatsappTemplateId: tpl.id, body },
      });
      return broadcast;
    }
    if (dto.templateId) {
      const template = await this.getTemplate(organizationId, dto.templateId);
      if (template.channel !== dto.channel) throw new BadRequestException("Template channel does not match the broadcast channel");
      subject = template.subject; body = template.body;
    }
    if (!body) throw new BadRequestException("Broadcast body is required (write one or choose a template)");
    if (dto.channel === "email" && !subject) throw new BadRequestException("Email broadcasts need a subject");
    const baseData = {
      organizationId, channel: dto.channel,
      audienceType: dto.audienceType, audienceStage: dto.audienceStage ?? null, audienceSegment: dto.audienceSegment ?? null,
      excludePastDays: dto.excludePastDays ?? null, excludeOptOut: dto.excludeOptOut ?? true,
      status: "draft", createdById: actorId,
    };
    if (dto.abTest) {
      if (!dto.abBody) throw new BadRequestException("A/B broadcasts need a variant B body (abBody)");
      const abGroupId = randomUUID();
      const a = await (this.prisma as any).broadcast.create({
        data: { ...baseData, name: `${dto.name} (A)`, templateId: dto.templateId ?? null, subject, body, abVariant: "A", abGroupId },
      });
      const b = await (this.prisma as any).broadcast.create({
        data: { ...baseData, name: `${dto.name} (B)`, templateId: null, subject: dto.abSubject ?? subject, body: dto.abBody, abVariant: "B", abGroupId },
      });
      return { abGroupId, variants: [a, b] };
    }
    const broadcast = await (this.prisma as any).broadcast.create({
      data: { ...baseData, name: dto.name, templateId: dto.templateId ?? null, subject, body },
    });
    return broadcast;
  }

  async listBroadcasts(organizationId: string) {
    return (this.prisma as any).broadcast.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 50 });
  }

  async sendBroadcast(organizationId: string, actorId: string, broadcastId: string) {
    const broadcast = await (this.prisma as any).broadcast.findFirst({ where: { id: broadcastId, organizationId } });
    if (!broadcast) throw new NotFoundException("Broadcast not found");
    if (broadcast.status === "sent" || broadcast.status === "sending") {
      throw new BadRequestException("This broadcast was already sent (or is sending). Create a new broadcast to send again.");
    }
    let recipients = await this.resolveAudience(organizationId, broadcast.channel, broadcast.audienceType, broadcast.audienceStage ?? undefined, broadcast.audienceSegment ?? undefined, {
      excludePastDays: broadcast.excludePastDays ?? undefined,
      excludeOptOut: broadcast.excludeOptOut ?? true,
    });
    if (broadcast.abGroupId && broadcast.abVariant) {
      // Deterministic split: each recipient belongs to exactly one
      // variant across the whole A/B group.
      const want = broadcast.abVariant === "A" ? 0 : 1;
      recipients = recipients.filter((r) => {
        const key = `${r.type}:${r.id}`;
        let h = 0; for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
        return h % 2 === want;
      });
    }
    const { killSwitches, effectiveLimits } = await import("../common/platform-settings");
    const ks = await killSwitches(this.prisma as any);
    if (ks.broadcastsPaused) {
      throw new BadRequestException("Broadcasts are temporarily paused platform-wide by the platform team (incident mode). Try again later.");
    }
    const baselineCap = Number(process.env.BROADCAST_MAX_RECIPIENTS ?? 1000);
    const { broadcastCap: max } = await effectiveLimits(this.prisma as any, organizationId, { aiDaily: 200, broadcastCap: baselineCap });
    if (recipients.length === 0) throw new BadRequestException("Audience is empty: no recipients with a usable address for this channel");
    if (recipients.length > max) {
      throw new BadRequestException(`Audience has ${recipients.length} recipients, over the per-send cap of ${max}. Narrow the audience (e.g. a lead stage) instead of silently truncating.`);
    }
    await (this.prisma as any).broadcast.update({ where: { id: broadcastId }, data: { status: "sending", totalRecipients: recipients.length } });
    let sent = 0, failed = 0;
    if (broadcast.channel === "whatsapp") {
      const counts = await this.sendWhatsAppBroadcast(organizationId, broadcast, recipients, broadcastId);
      sent = counts.sent; failed = counts.failed;
    } else {
      for (const recipient of recipients) {
        const result = await this.sendToRecipient(organizationId, {
          channel: broadcast.channel, recipient, subject: broadcast.subject, body: broadcast.body,
          vars: {}, broadcastId,
        });
        if (result.status === "sent") sent++; else failed++;
      }
    }
    const status = failed === 0 ? "sent" : sent === 0 ? "failed" : "partial";
    const updated = await (this.prisma as any).broadcast.update({
      where: { id: broadcastId }, data: { status, sentCount: sent, failedCount: failed, sentAt: new Date() },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "broadcast.send", entityType: "Broadcast", entityId: broadcastId, metadata: { channel: broadcast.channel, total: recipients.length, sent, failed } });
    return updated;
  }

  /**
   * WhatsApp template broadcast: one Meta send per recipient, a
   * delivery row per recipient, "sent" only with a Meta message id.
   * Parameters support {name} substitution per recipient.
   */
  private async sendWhatsAppBroadcast(organizationId: string, broadcast: any, recipients: Recipient[], broadcastId: string) {
    const integration = await (this.prisma as any).integration.findFirst({
      where: { organizationId, provider: "whatsapp", status: "CONNECTED" }, include: { credential: true },
    });
    if (!integration?.credential) throw new BadRequestException("No connected WhatsApp integration for this organization");
    const template = await (this.prisma as any).whatsAppTemplate.findFirst({ where: { id: broadcast.whatsappTemplateId, organizationId } });
    if (!template) throw new NotFoundException("WhatsApp template not found");
    const secrets = decryptJson(integration.credential.encryptedData) as any;
    const client = new MetaMessagingClient({ accessToken: secrets.accessToken, phoneNumberId: secrets.phoneNumberId });
    const paramsTemplate: string[] = Array.isArray(broadcast.templateParams) ? broadcast.templateParams : [];
    let sent = 0, failed = 0;
    for (const recipient of recipients) {
      const normalized = normalizeBdPhone(recipient.phone ?? "");
      const address = normalized ?? (recipient.phone ?? "");
      try {
        if (!normalized) throw new Error(`Phone number cannot be normalized for WhatsApp: ${recipient.phone || "(empty)"}`);
        const params = paramsTemplate.map((p) => String(p).replaceAll("{name}", recipient.name));
        const { messageId } = await client.sendWhatsAppTemplate(normalized, template.name, template.language, params);
        await this.recordDelivery(organizationId, { channel: "whatsapp", recipient, broadcastId }, address, "sent", messageId);
        sent++;
      } catch (e) {
        await this.recordDelivery(organizationId, { channel: "whatsapp", recipient, broadcastId }, address, "failed", undefined, e instanceof Error ? e.message : "Send failed");
        failed++;
      }
    }
    return { sent, failed };
  }

  async listDeliveries(organizationId: string, broadcastId: string) {
    return (this.prisma as any).messageDelivery.findMany({
      where: { organizationId, broadcastId }, orderBy: { createdAt: "desc" }, take: 200,
    });
  }
}
