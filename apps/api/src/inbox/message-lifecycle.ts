/**
 * IN6 — message lifecycle pure helpers (delivery status, reactions).
 *
 * Honesty rules baked in here:
 * - A delivery status exists ONLY when a platform confirmed it
 *   (Meta webhook status / delivery event, or a webchat visitor
 *   actually fetching the thread). Sending never invents one.
 * - Progression is monotonic: sent(1) < delivered(2) < read(3).
 *   A late "delivered" must never drag a "read" message backwards.
 * - "failed" is a side terminal: it applies from any non-read
 *   state, and a failed message never resurrects via a later
 *   positive status (Meta can send both orders on retries).
 */

export const DELIVERY_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3 };

export interface DeliveryPatch {
  deliveryStatus: string;
  status: string;
  deliveredAt?: Date;
  readAt?: Date;
}

/**
 * Computes the column patch for one confirmed status event against
 * the message's current row, or null when the event must NOT be
 * applied (regression, duplicate, unknown status, resurrection).
 * `currentStatus` is the legacy internal status column, kept in
 * lockstep so existing readers (counts, reports) stay truthful.
 */
export function nextDeliveryPatch(
  current: { deliveryStatus?: string | null; status?: string | null },
  incoming: string,
  at: Date,
): DeliveryPatch | null {
  const cur = current.deliveryStatus ?? null;
  if (incoming === "failed") {
    if (cur === "failed" || cur === "read") return null;
    return { deliveryStatus: "failed", status: "failed" };
  }
  const rank = DELIVERY_RANK[incoming];
  if (rank === undefined) return null;
  if (cur === "failed") return null;
  const curRank = cur ? (DELIVERY_RANK[cur] ?? 0) : 0;
  if (rank <= curRank) return null;
  const patch: DeliveryPatch = { deliveryStatus: incoming, status: incoming };
  // deliveredAt is stamped when delivery is first confirmed — a
  // direct sent→read jump still proves delivery happened by then.
  if (rank >= 2) patch.deliveredAt = at;
  if (rank >= 3) patch.readAt = at;
  return patch;
}

export interface StoredReaction { emoji: string; actor: "customer" | "page"; at: string }

/** Parses the stored reactions JSON (array or JSON string) safely. */
export function parseReactions(raw: unknown): StoredReaction[] {
  let v: unknown = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return []; } }
  if (!Array.isArray(v)) return [];
  return v.filter((r: any) => r && typeof r.emoji === "string" && (r.actor === "customer" || r.actor === "page"))
    .map((r: any) => ({ emoji: r.emoji, actor: r.actor, at: typeof r.at === "string" ? r.at : "" }));
}

/**
 * Applies one reaction event to the stored list. One reaction per
 * actor: a new emoji from the same actor REPLACES their previous
 * one (that is how Messenger/WhatsApp behave); action "unreact"
 * removes that actor's entry. Returns the new list.
 */
export function applyReaction(
  raw: unknown,
  input: { emoji?: string | null; actor: "customer" | "page"; action: "react" | "unreact"; at: Date },
): StoredReaction[] {
  const list = parseReactions(raw).filter((r) => r.actor !== input.actor);
  if (input.action === "react" && input.emoji) {
    list.push({ emoji: input.emoji, actor: input.actor, at: input.at.toISOString() });
  }
  return list;
}

/** Meta's named Messenger reactions → the emoji customers see. */
export const MESSENGER_REACTION_EMOJI: Record<string, string> = {
  love: "❤️", like: "👍", dislike: "👎", smile: "😆", wow: "😮", sad: "😢", angry: "😡",
};

/**
 * Normalizes a webhook reaction to the emoji to store. Prefers the
 * payload's own emoji (WhatsApp sends the literal emoji; Messenger
 * sends one too) and falls back to the named-reaction map.
 */
export function reactionEmoji(payloadEmoji?: string | null, named?: string | null): string | null {
  if (payloadEmoji && payloadEmoji.trim()) return payloadEmoji;
  if (named && MESSENGER_REACTION_EMOJI[named]) return MESSENGER_REACTION_EMOJI[named];
  return null;
}
