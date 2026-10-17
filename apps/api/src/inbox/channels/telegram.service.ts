import { BadRequestException, Injectable, NotFoundException, OnModuleInit, Optional } from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../../audit/audit.service";
import { encryptJson, decryptJson } from "../../integrations/crypto";
import { InboxService } from "../inbox.service";
import { MessagingService } from "../../messaging/messaging.service";
import type { ChannelAdapter, VerifiedChannelAccount } from "./channel-adapter";

/** Telegram Bot API client (official API, bot accounts only —
 * Telegram does not offer user-account automation). All calls go
 * to api.telegram.org; a send counts only with a message_id. */
export class TelegramClient {
  constructor(private readonly botToken: string) {}

  private async call<T>(method: string, body?: Record<string, any>): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${this.botToken}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok || !json?.ok) {
      throw new BadRequestException(`Telegram: ${json?.description ?? `HTTP ${res.status}`}`);
    }
    return json.result as T;
  }

  /** Multipart variant of call() for file uploads (Bot API upload
   * methods take the file bytes directly, no public URL needed). */
  private async callMultipart<T>(method: string, fields: Record<string, string>, fileField: string, bytes: Buffer, fileName: string, contentType: string): Promise<T> {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append(fileField, new Blob([new Uint8Array(bytes)], { type: contentType }), fileName);
    const res = await fetch(`https://api.telegram.org/bot${this.botToken}/${method}`, { method: "POST", body: form });
    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok || !json?.ok) {
      throw new BadRequestException(`Telegram: ${json?.description ?? `HTTP ${res.status}`}`);
    }
    return json.result as T;
  }

  getMe() {
    return this.call<{ id: number; username?: string; first_name?: string }>("getMe");
  }
  setWebhook(url: string, secretToken: string) {
    return this.call<boolean>("setWebhook", { url, secret_token: secretToken, allowed_updates: ["message"] });
  }
  sendMessage(chatId: string, text: string, replyMarkup?: { inline_keyboard: { text: string; url: string }[][] }) {
    // MX13: optional inline URL buttons — the Bot API's
    // reply_markup.inline_keyboard (documented Bot API
    // behaviour; URL buttons need an https URL, which
    // messaging's validateTelegramButtons enforces upstream).
    return this.call<{ message_id: number }>("sendMessage", { chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
  }
  sendPhotoUpload(chatId: string, bytes: Buffer, contentType: string, fileName: string, caption?: string) {
    return this.callMultipart<{ message_id: number }>("sendPhoto", { chat_id: chatId, ...(caption ? { caption } : {}) }, "photo", bytes, fileName, contentType);
  }
  sendVoiceUpload(chatId: string, bytes: Buffer, contentType: string, fileName: string, caption?: string) {
    return this.callMultipart<{ message_id: number }>("sendVoice", { chat_id: chatId, ...(caption ? { caption } : {}) }, "voice", bytes, fileName, contentType);
  }
  sendAudioUpload(chatId: string, bytes: Buffer, contentType: string, fileName: string, caption?: string) {
    return this.callMultipart<{ message_id: number }>("sendAudio", { chat_id: chatId, ...(caption ? { caption } : {}) }, "audio", bytes, fileName, contentType);
  }
  sendVideoUpload(chatId: string, bytes: Buffer, contentType: string, fileName: string, caption?: string) {
    return this.callMultipart<{ message_id: number }>("sendVideo", { chat_id: chatId, ...(caption ? { caption } : {}) }, "video", bytes, fileName, contentType);
  }
  sendDocumentUpload(chatId: string, bytes: Buffer, contentType: string, fileName: string, caption?: string) {
    return this.callMultipart<{ message_id: number }>("sendDocument", { chat_id: chatId, ...(caption ? { caption } : {}) }, "document", bytes, fileName, contentType);
  }
}

export class TelegramAdapter implements ChannelAdapter {
  readonly channel = "telegram";
  async verifyCredentials(credentials: Record<string, any>): Promise<VerifiedChannelAccount> {
    if (!credentials.botToken) throw new BadRequestException("A Telegram bot token is required");
    const me = await new TelegramClient(String(credentials.botToken)).getMe();
    return { externalAccountId: String(me.id), displayName: me.username ? `@${me.username}` : (me.first_name ?? "Telegram bot") };
  }
  async sendText(credentials: Record<string, any>, externalContactId: string, text: string): Promise<{ externalId: string }> {
    const sent = await new TelegramClient(String(credentials.botToken)).sendMessage(externalContactId, text);
    return { externalId: String(sent.message_id) };
  }
  /** Inbox Next-Gen P1: uploaded media (drag-drop / voice notes).
   * OGG voice notes go through sendVoice (Telegram requires the
   * OGG/Opus container there); other audio uses sendAudio. Any
   * container Telegram rejects surfaces its own error verbatim. */
  async sendMedia(credentials: Record<string, any>, externalContactId: string, media: { bytes: Buffer; contentType: string; kind: "image" | "audio" | "video" | "document"; fileName: string; caption?: string }): Promise<{ externalId: string }> {
    const client = new TelegramClient(String(credentials.botToken));
    const caption = media.caption?.trim() ? media.caption.trim().slice(0, 1024) : undefined;
    const sent =
      media.kind === "image" ? await client.sendPhotoUpload(externalContactId, media.bytes, media.contentType, media.fileName, caption)
      : media.kind === "audio" && media.contentType.includes("ogg") ? await client.sendVoiceUpload(externalContactId, media.bytes, media.contentType, media.fileName, caption)
      : media.kind === "audio" ? await client.sendAudioUpload(externalContactId, media.bytes, media.contentType, media.fileName, caption)
      : media.kind === "video" ? await client.sendVideoUpload(externalContactId, media.bytes, media.contentType, media.fileName, caption)
      : await client.sendDocumentUpload(externalContactId, media.bytes, media.contentType, media.fileName, caption);
    return { externalId: String(sent.message_id) };
  }
}

interface TelegramSecrets { botToken: string; webhookSecret: string }

@Injectable()
export class TelegramService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly inbox: InboxService,
    // MX13: MessagingService is OPTIONAL so existing constructor
    // shapes (specs building TelegramService directly) keep
    // working; Nest resolves it in production (InboxModule
    // imports MessagingModule — no cycle, the MX12 WebPush
    // precedent).
    @Optional() private readonly messaging?: MessagingService,
  ) {}

  /** MX13 — register the telegram send port Messaging consumes
   * (the registered-port discipline: messaging never imports
   * inbox code and never touches the sealed bot credentials).
   * Defensive like the webpush registration: a messaging
   * service built without the register method (an older test
   * double) is skipped, never a boot crash. */
  onModuleInit() {
    const m = this.messaging as any;
    if (m && typeof m.registerTelegramSendPort === "function") {
      m.registerTelegramSendPort({
        sendTelegram: (organizationId: string, input: { chatId: string; text: string; buttons?: { label: string; url: string }[] | null }) =>
          this.sendForMessaging(organizationId, input),
      });
    }
  }

  /**
   * MX13 — the Messaging broadcast send path for telegram. The
   * org's connected bot (the earliest CONNECTED telegram
   * Integration — the same row the inbox channel sends through)
   * delivers the message via the Bot API. The outcome mirrors
   * Telegram's real result: "sent" ONLY with a real message_id;
   * anything else is "failed" with Telegram's real description
   * (403 "bot was blocked by the user", 400 "chat not found",
   * …) or the honest local reason (no connected bot). This
   * method NEVER throws — the port contract carries failures
   * as values, so messaging records them per recipient.
   */
  async sendForMessaging(organizationId: string, input: {
    chatId: string; text: string; buttons?: { label: string; url: string }[] | null;
  }): Promise<{ outcome: "sent" | "failed"; messageId?: string; error?: string }> {
    try {
      const integration = await (this.prisma as any).integration.findFirst({
        where: { organizationId, provider: "telegram", status: "CONNECTED" },
        orderBy: { createdAt: "asc" },
        include: { credential: true },
      });
      if (!integration?.credential) {
        return { outcome: "failed", error: "No connected Telegram bot for this organization (connect one in the Inbox first)" };
      }
      const secrets = decryptJson<TelegramSecrets>(integration.credential.encryptedData);
      if (!secrets?.botToken) {
        return { outcome: "failed", error: "The connected Telegram bot's credentials could not be read" };
      }
      const buttons = Array.isArray(input.buttons) ? input.buttons : [];
      const replyMarkup = buttons.length
        ? { inline_keyboard: buttons.map((b) => [{ text: String(b.label), url: String(b.url) }]) }
        : undefined;
      const sent = await new TelegramClient(String(secrets.botToken)).sendMessage(String(input.chatId), input.text, replyMarkup);
      if (!sent?.message_id) {
        return { outcome: "failed", error: "Telegram accepted the request without returning a message_id" };
      }
      return { outcome: "sent", messageId: String(sent.message_id) };
    } catch (e) {
      return { outcome: "failed", error: e instanceof Error ? e.message : "Telegram send failed" };
    }
  }

  /**
   * Connect a tenant's Telegram bot: the token is verified with
   * Telegram (getMe) BEFORE anything is stored; credentials are
   * AES-GCM encrypted and never returned. Webhook registration is
   * attempted against the public API base and its REAL outcome is
   * reported — a failed registration never blocks the connection
   * record, but it is never hidden either.
   */
  async connect(organizationId: string, actorId: string, dto: { botToken: string }) {
    const account = await new TelegramAdapter().verifyCredentials({ botToken: dto.botToken });
    const webhookSecret = createHash("sha256").update(`${organizationId}:${account.externalAccountId}:${Date.now()}`).digest("hex").slice(0, 48);
    const secrets: TelegramSecrets = { botToken: dto.botToken, webhookSecret };
    // CC7 (Connect Center): keyed by (organizationId, provider,
    // externalAccountId) — the external id here is the bot's own
    // numeric id from Telegram's verified getMe response, never
    // user-typed text. Reconnecting the SAME bot refreshes its row
    // + sealed credential in place (and re-registers the webhook
    // below against the same integration id, with the fresh
    // webhook secret); a SECOND, different bot gets its own row
    // and coexists — the CC2 discipline connectMessaging got in B1.
    const existing = await (this.prisma as any).integration.findFirst({
      where: { organizationId, provider: "telegram", externalAccountId: account.externalAccountId },
    });
    let integration = existing;
    if (existing) {
      integration = await (this.prisma as any).integration.update({
        where: { id: existing.id },
        data: { status: "CONNECTED", lastError: null },
      });
      const refreshed = await (this.prisma as any).integrationCredential
        .update({ where: { integrationId: existing.id }, data: { encryptedData: encryptJson(secrets) } })
        .catch(() => null);
      if (!refreshed) {
        await (this.prisma as any).integrationCredential.create({
          data: { integrationId: existing.id, encryptedData: encryptJson(secrets) },
        });
      }
    } else {
      integration = await (this.prisma as any).integration.create({
        data: { organizationId, provider: "telegram", status: "CONNECTED", externalAccountId: account.externalAccountId },
      });
      await (this.prisma as any).integrationCredential.create({
        data: { integrationId: integration.id, encryptedData: encryptJson(secrets) },
      });
    }
    let webhook: { registered: boolean; url?: string; error?: string } = { registered: false };
    const base = (process.env.PUBLIC_API_URL ?? "").replace(/\/$/, "");
    if (base.startsWith("https://")) {
      const url = `${base}/webhooks/telegram/${integration.id}`;
      try {
        await new TelegramClient(dto.botToken).setWebhook(url, webhookSecret);
        webhook = { registered: true, url };
      } catch (e) {
        webhook = { registered: false, url, error: e instanceof Error ? e.message : "setWebhook failed" };
      }
    } else {
      webhook = { registered: false, error: "PUBLIC_API_URL is not a public https URL, so the webhook could not be registered automatically. Set it and reconnect, or register the webhook manually." };
    }
    await this.audit.log({
      organizationId, userId: actorId, action: "inbox.telegram.connected", entityType: "Integration",
      entityId: integration.id, metadata: { bot: account.displayName, webhookRegistered: webhook.registered, reconnected: Boolean(existing) },
    });
    return { integrationId: integration.id, bot: account.displayName, webhook, reconnected: Boolean(existing) };
  }

  /** Inbound webhook: authenticity = the per-integration secret
   * token Telegram echoes in a header (set at setWebhook time). */
  async handleWebhook(integrationId: string, secretHeader: string | undefined, update: any) {
    const integration = await (this.prisma as any).integration.findUnique({
      where: { id: integrationId }, include: { credential: true },
    });
    if (!integration?.credential || integration.provider !== "telegram") throw new NotFoundException("Integration not found");
    const secrets = decryptJson<TelegramSecrets>(integration.credential.encryptedData);
    const expected = Buffer.from(secrets.webhookSecret ?? "");
    const given = Buffer.from(secretHeader ?? "");
    if (expected.length === 0 || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new BadRequestException("Invalid webhook secret");
    }
    const message = update?.message;
    if (!message?.chat?.id || typeof message.text !== "string") return { ignored: true };
    const name = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || message.from?.username || "Telegram user";
    const result = await this.inbox.ingestExternalMessage({
      organizationId: integration.organizationId,
      integrationId: integration.id,
      channel: "telegram",
      externalContactId: String(message.chat.id),
      contactName: name,
      externalId: String(message.message_id),
      content: message.text,
      timestamp: message.date ? new Date(message.date * 1000) : new Date(),
    });
    return { received: result === "stored" ? 1 : 0, duplicates: result === "duplicate" ? 1 : 0 };
  }
}
