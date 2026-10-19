import { inboxBn, inboxEn } from "./i18n/inbox";

type Loc = "bn" | "en";
const D = (locale?: string) => (locale === "en" ? inboxEn : inboxBn);
// IN6 (Inbox Next): message-lifecycle presentation helpers.
//
// Honesty rules baked in:
// - A delivery tick exists ONLY when the server stored a real
//   platform-confirmed deliveryStatus (Meta webhook / webchat
//   visitor fetch). No status → no tick, never a guessed one.
// - Ticks render only on WhatsApp (✓/✓✓/blue ✓✓) and Messenger /
//   Instagram ("Seen"/"Delivered" labels). Telegram/Email have no
//   confirmed-status source in our integration → nothing shown.
// - The quote the CUSTOMER receives exists only on WhatsApp
//   (context) and Messenger/Instagram (reply_to). On every other
//   channel the quote is internal-only and the composer says so.
// - Agent reaction sending exists only on Messenger/Instagram
//   (Meta sender_action). No button anywhere else.

export type DeliveryTick = { glyph: string; label: string; blue: boolean } | null;

export function deliveryTick(
  channel: string | null | undefined,
  msg: { direction: string; deliveryStatus?: string | null },
  locale: Loc = "bn",
): DeliveryTick {
  const dd = D(locale);
  if (msg.direction !== "out" || !msg.deliveryStatus) return null;
  if (channel === "whatsapp") {
    if (msg.deliveryStatus === "sent") return { glyph: "✓", label: dd.tickSent, blue: false };
    if (msg.deliveryStatus === "delivered") return { glyph: "✓✓", label: dd.tickDelivered, blue: false };
    if (msg.deliveryStatus === "read") return { glyph: "✓✓", label: dd.tickRead, blue: true };
    return null; // failed is rendered by the existing failed state
  }
  if (channel === "messenger" || channel === "instagram") {
    if (msg.deliveryStatus === "delivered") return { glyph: "", label: "Delivered", blue: false };
    if (msg.deliveryStatus === "read") return { glyph: "", label: "Seen", blue: false };
    return null;
  }
  if (channel === "webchat") {
    // Our own channel: read is real (the visitor fetched the
    // thread); there is no separate delivered state to claim.
    if (msg.deliveryStatus === "read") return { glyph: "", label: "Seen", blue: false };
    return null;
  }
  return null;
}

/** True when a quote chosen in the composer will reach the
 * customer AS a quote on the platform (not just in our thread). */
export function quoteReachesCustomer(channel: string | null | undefined): boolean {
  return channel === "whatsapp" || channel === "messenger" || channel === "instagram";
}

/** True when the agent reaction button may be offered at all. */
export function canSendReaction(channel: string | null | undefined): boolean {
  return channel === "messenger" || channel === "instagram";
}

/** The small emoji set offered for agent reactions (Messenger/IG). */
export const AGENT_REACTIONS = ["❤️", "👍", "😆", "😮", "😢", "😡"] as const;

export interface StoredReaction { emoji: string; actor: "customer" | "page"; at?: string }

/** Parses the message row's reactions (array or JSON string). */
export function parseMessageReactions(raw: unknown): StoredReaction[] {
  let v: unknown = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return []; } }
  if (!Array.isArray(v)) return [];
  return v.filter((r: any) => r && typeof r.emoji === "string" && (r.actor === "customer" || r.actor === "page"))
    .map((r: any) => ({ emoji: r.emoji, actor: r.actor, at: typeof r.at === "string" ? r.at : undefined }));
}
