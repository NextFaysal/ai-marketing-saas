import { Injectable, Optional } from "@nestjs/common";

/**
 * SN6 — Telegram Bot API client (docs/social-sn7-threads-spike.md
 * §৩). The Bot API is NOT OAuth: the tenant creates a bot with
 * BotFather, pastes the bot token, and adds the bot as an admin
 * of their channel; we then talk to
 * `https://api.telegram.org/bot<token>/<method>` with JSON POSTs.
 *
 * Error discipline: every failure surfaces Telegram's own
 * `description` VERBATIM (wrapped only where the caller adds its
 * own Bengali context). The bot token rides in the request URL —
 * it is never logged here (this client logs nothing) and never
 * part of a returned object or an error message: a transport
 * failure (fetch itself throwing) is reported WITHOUT the URL,
 * because Node fetch errors can embed the request URL.
 */

export type TelegramFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

export interface TelegramBotIdentity {
  id: number;
  username: string | null;
  firstName: string | null;
}

export interface TelegramChat {
  id: number;
  type: string;
  title: string | null;
  username: string | null;
}

export interface TelegramChatMember {
  status: string;
  canPostMessages: boolean | null;
}

export interface TelegramSentMessage {
  messageId: number;
  chatId: number;
  chatUsername: string | null;
}

/** Telegram's documented caption ceiling for photo/video/media
 * groups; the message-text ceiling for sendMessage. */
export const TELEGRAM_CAPTION_MAX = 1024;
export const TELEGRAM_TEXT_MAX = 4096;

@Injectable()
export class TelegramClient {
  private readonly fetchFn: TelegramFetch;

  // @Optional(): the fetch injection is a test seam, not a
  // Nest provider — without the decorator the module graph
  // cannot boot (pre-existing base bug found by FB1's boot
  // smoke on the nf line; the same one-line fix applied here).
  constructor(@Optional() fetchFn?: TelegramFetch) {
    this.fetchFn = fetchFn ?? ((url, init) => fetch(url, init as any) as any);
  }

  private async call<T>(botToken: string, method: string, payload: Record<string, unknown>): Promise<T> {
    let res: { ok: boolean; status: number; json: () => Promise<any> };
    try {
      res = await this.fetchFn(`https://api.telegram.org/bot${botToken}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      // Deliberately no error interpolation: a fetch failure may
      // carry the token-bearing URL in its message.
      throw new Error("Telegram-এর সাথে যোগাযোগ করা যায়নি — নেটওয়ার্ক সমস্যা হতে পারে, আবার চেষ্টা করুন।");
    }
    const json = await res.json().catch(() => null);
    if (!json || json.ok !== true) {
      const description = typeof json?.description === "string" && json.description
        ? json.description
        : `Telegram API error (HTTP ${res.status})`;
      const err = new Error(description) as Error & { telegramErrorCode?: number };
      if (typeof json?.error_code === "number") err.telegramErrorCode = json.error_code;
      throw err;
    }
    return json.result as T;
  }

  /** getMe — proves the bot token is a real bot token. */
  async getMe(botToken: string): Promise<TelegramBotIdentity> {
    const me = await this.call<any>(botToken, "getMe", {});
    return {
      id: Number(me?.id),
      username: typeof me?.username === "string" ? me.username : null,
      firstName: typeof me?.first_name === "string" ? me.first_name : null,
    };
  }

  /** getChat — the channel must exist and be visible to the bot. */
  async getChat(botToken: string, chatId: string): Promise<TelegramChat> {
    const chat = await this.call<any>(botToken, "getChat", { chat_id: chatId });
    return {
      id: Number(chat?.id),
      type: String(chat?.type ?? ""),
      title: typeof chat?.title === "string" ? chat.title : null,
      username: typeof chat?.username === "string" ? chat.username : null,
    };
  }

  /** getChatMember — is the bot an admin of this channel, and
   * may it post? (can_post_messages is absent/null for creators.) */
  async getChatMember(botToken: string, chatId: string, botUserId: number): Promise<TelegramChatMember> {
    const member = await this.call<any>(botToken, "getChatMember", { chat_id: chatId, user_id: botUserId });
    return {
      status: String(member?.status ?? ""),
      canPostMessages: typeof member?.can_post_messages === "boolean" ? member.can_post_messages : null,
    };
  }

  private sent(result: any): TelegramSentMessage {
    return {
      messageId: Number(result?.message_id),
      chatId: Number(result?.chat?.id),
      chatUsername: typeof result?.chat?.username === "string" ? result.chat.username : null,
    };
  }

  async sendMessage(botToken: string, chatId: string, text: string): Promise<TelegramSentMessage> {
    return this.sent(await this.call<any>(botToken, "sendMessage", { chat_id: chatId, text }));
  }

  async sendPhoto(botToken: string, chatId: string, photoUrl: string, caption?: string): Promise<TelegramSentMessage> {
    return this.sent(await this.call<any>(botToken, "sendPhoto", {
      chat_id: chatId, photo: photoUrl, ...(caption ? { caption } : {}),
    }));
  }

  async sendVideo(botToken: string, chatId: string, videoUrl: string, caption?: string): Promise<TelegramSentMessage> {
    return this.sent(await this.call<any>(botToken, "sendVideo", {
      chat_id: chatId, video: videoUrl, ...(caption ? { caption } : {}),
    }));
  }

  /** sendMediaGroup — 2–10 photo/video items by public URL;
   * the caption rides on the FIRST item (Telegram's shape).
   * Returns EVERY message of the group (the first one's id is
   * the post's anchor). */
  async sendMediaGroup(
    botToken: string, chatId: string,
    media: { type: "photo" | "video"; url: string; caption?: string }[],
  ): Promise<TelegramSentMessage[]> {
    const result = await this.call<any[]>(botToken, "sendMediaGroup", {
      chat_id: chatId,
      media: media.map((m) => ({
        type: m.type, media: m.url, ...(m.caption ? { caption: m.caption } : {}),
      })),
    });
    return (Array.isArray(result) ? result : []).map((r) => this.sent(r));
  }
}
