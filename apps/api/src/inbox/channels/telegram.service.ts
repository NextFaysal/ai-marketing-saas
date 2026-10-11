import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../../audit/audit.service";
import { encryptJson, decryptJson } from "../../integrations/crypto";
import { InboxService } from "../inbox.service";
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

  getMe() {
    return this.call<{ id: number; username?: string; first_name?: string }>("getMe");
  }
  setWebhook(url: string, secretToken: string) {
    return this.call<boolean>("setWebhook", { url, secret_token: secretToken, allowed_updates: ["message"] });
  }
  sendMessage(chatId: string, text: string) {
    return this.call<{ message_id: number }>("sendMessage", { chat_id: chatId, text });
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
}

interface TelegramSecrets { botToken: string; webhookSecret: string }

@Injectable()
export class TelegramService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly inbox: InboxService,
  ) {}

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
    const integration = await (this.prisma as any).integration.create({
      data: { organizationId, provider: "telegram", status: "CONNECTED", externalAccountId: account.externalAccountId },
    });
    const secrets: TelegramSecrets = { botToken: dto.botToken, webhookSecret };
    await (this.prisma as any).integrationCredential.create({
      data: { integrationId: integration.id, encryptedData: encryptJson(secrets) },
    });
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
      entityId: integration.id, metadata: { bot: account.displayName, webhookRegistered: webhook.registered },
    });
    return { integrationId: integration.id, bot: account.displayName, webhook };
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
