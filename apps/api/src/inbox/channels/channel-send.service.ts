
import * as nodemailer from "nodemailer";
import { decryptJson } from "../../integrations/crypto";
import { TelegramAdapter } from "./telegram.service";
import type { EmailCredentials } from "./email.service";
import { badRequest } from "../../i18n/api-exception";

/**
 * Outbound dispatch for the U4 channels (used by InboxService's
 * deliverText). Resolves the conversation's own integration and
 * its encrypted credentials, then sends through the channel's
 * real API — a send counts only when the channel confirms it
 * (Telegram message_id / SMTP messageId).
 */
export class ChannelSendService {
  constructor(private readonly prisma: any) {}

  private async integrationFor(conv: any) {
    if (conv.integrationId) {
      const found = await this.prisma.integration.findUnique({ where: { id: conv.integrationId }, include: { credential: true } });
      if (found?.credential) return found;
    }
    const latest = await this.prisma.integration.findFirst({
      where: { organizationId: conv.organizationId, provider: conv.channel, status: "CONNECTED" },
      include: { credential: true }, orderBy: { createdAt: "desc" },
    });
    if (!latest?.credential) throw badRequest("inbox.noConnectedIntegrationForThisOrganization", { convChannel: conv.channel });
    return latest;
  }

  async sendText(conv: any, content: string): Promise<string> {
    const integration = await this.integrationFor(conv);
    const creds = decryptJson<any>(integration.credential.encryptedData);
    if (conv.channel === "telegram") {
      const sent = await new TelegramAdapter().sendText(creds, conv.externalContactId, content);
      return sent.externalId;
    }
    if (conv.channel === "email") {
      const emailCreds = creds as EmailCredentials;
      const transport = nodemailer.createTransport({
        host: emailCreds.smtpHost, port: emailCreds.smtpPort, secure: emailCreds.smtpPort === 465,
        auth: { user: emailCreds.user, pass: emailCreds.password },
      });
      // Thread onto the customer's last inbound message when known.
      const lastInbound = await this.prisma.channelMessage.findFirst({
        where: { conversationId: conv.id, direction: "in" }, orderBy: { createdAt: "desc" },
      }).catch(() => null);
      const subject = conv.subject ? (/^re:/i.test(conv.subject) ? conv.subject : `Re: ${conv.subject}`) : "Re: আপনার বার্তা";
      const info = await transport.sendMail({
        from: emailCreds.user,
        to: conv.externalContactId,
        subject,
        text: content,
        ...(lastInbound?.externalId ? { inReplyTo: lastInbound.externalId, references: lastInbound.externalId } : {}),
      });
      if (!info?.messageId) throw badRequest("inbox.smtpDidNotConfirmTheEmail");
      return String(info.messageId);
    }
    throw badRequest("inbox.channelsendserviceDoesNotHandleChannel", { convChannel: conv.channel });
  }

  /**
   * Inbox Next-Gen P1: uploaded media dispatch for the U4 channels.
   * Telegram uploads the bytes through the Bot API; email sends the
   * file as a real SMTP attachment. Same rule as sendText: counts
   * only with the channel's own confirmation id.
   */
  async sendMedia(conv: any, media: { bytes: Buffer; contentType: string; kind: "image" | "audio" | "video" | "document"; fileName: string; caption?: string }): Promise<string> {
    const integration = await this.integrationFor(conv);
    const creds = decryptJson<any>(integration.credential.encryptedData);
    if (conv.channel === "telegram") {
      const sent = await new TelegramAdapter().sendMedia(creds, conv.externalContactId, media);
      return sent.externalId;
    }
    if (conv.channel === "email") {
      const emailCreds = creds as EmailCredentials;
      const transport = nodemailer.createTransport({
        host: emailCreds.smtpHost, port: emailCreds.smtpPort, secure: emailCreds.smtpPort === 465,
        auth: { user: emailCreds.user, pass: emailCreds.password },
      });
      const lastInbound = await this.prisma.channelMessage.findFirst({
        where: { conversationId: conv.id, direction: "in" }, orderBy: { createdAt: "desc" },
      }).catch(() => null);
      const subject = conv.subject ? (/^re:/i.test(conv.subject) ? conv.subject : `Re: ${conv.subject}`) : "Re: আপনার বার্তা";
      const info = await transport.sendMail({
        from: emailCreds.user,
        to: conv.externalContactId,
        subject,
        text: media.caption?.trim() ? media.caption.trim() : `📎 ${media.fileName}`,
        attachments: [{ filename: media.fileName, content: media.bytes, contentType: media.contentType }],
        ...(lastInbound?.externalId ? { inReplyTo: lastInbound.externalId, references: lastInbound.externalId } : {}),
      });
      if (!info?.messageId) throw badRequest("inbox.smtpDidNotConfirmTheEmail");
      return String(info.messageId);
    }
    throw badRequest("inbox.channelsendserviceDoesNotHandleChannel", { convChannel: conv.channel });
  }
}
