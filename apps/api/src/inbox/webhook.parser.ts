export interface IncomingMessageEvent {
  channel: "whatsapp" | "messenger" | "instagram";
  externalContactId: string;
  contactName?: string;
  externalId: string;
  type: string;
  content?: string;
  /** IN6b: platform id of the message this one quotes, when the
   * platform reports it (WhatsApp context.id / Messenger
   * message.reply_to.mid). Resolved to our row id at ingest. */
  replyToExternalId?: string;
  /** WhatsApp media id; bytes are resolved later via the Graph API. */
  mediaId?: string;
  /** Direct attachment URL (Messenger attachments carry one). */
  mediaUrl?: string;
  /** Click-to-WhatsApp ad referral, present on the first message of a
   * chat started from an ad (Meta sends source_id = the ad id). */
  referral?: { sourceId?: string; sourceType?: string; sourceUrl?: string; headline?: string };
  timestamp: Date;
}
export interface LeadgenEvent {
  pageId: string;
  leadgenId: string;
  formId?: string;
  adId?: string;
  campaignId?: string;
}
export interface FeedCommentEvent {
  platform: "facebook" | "instagram";
  postId: string;
  commentId: string;
  authorId: string;
  authorName: string;
  message: string;
  postTitle?: string;
  timestamp: Date;
}
export interface StatusEvent {
  channel: "whatsapp" | "messenger" | "instagram";
  externalId: string;
  status: string; // sent | delivered | read | failed
  /** MS7: for a WhatsApp "failed" status, Meta's errors[0]
   * rendered as one line (title + error_data.details when
   * present) so the broadcast delivery can carry the real
   * provider reason. Absent for every other status/channel. */
  error?: string;
  /** When the platform says the status happened (WhatsApp carries
   * a per-status timestamp; Messenger delivery events do not, so
   * the service falls back to now). */
  at?: Date;
}
export interface ReactionEvent {
  channel: "whatsapp" | "messenger" | "instagram";
  /** Platform id of the message that was reacted to. */
  externalId: string;
  externalContactId: string;
  /** Literal emoji (WhatsApp sends this; Messenger usually does). */
  emoji?: string;
  /** Named reaction (Messenger's love/like/smile/…) when no
   * literal emoji is present — normalized by the service. */
  named?: string;
  action: "react" | "unreact";
  timestamp: Date;
}
export interface ReadWatermarkEvent {
  channel: "whatsapp" | "messenger" | "instagram";
  externalContactId: string;
  /** Every outbound message at/before this moment was read. */
  watermark: Date;
}
export interface ParsedWebhook {
  messages: IncomingMessageEvent[];
  statuses: StatusEvent[];
  reactions: ReactionEvent[];
  readWatermarks: ReadWatermarkEvent[];
  leadgens: LeadgenEvent[];
  comments: FeedCommentEvent[];
}

const ts = (seconds: string | number | undefined): Date =>
  new Date((Number(seconds ?? 0) || Math.floor(Date.now() / 1000)) * 1000);

export function parseMetaWebhook(payload: any): ParsedWebhook {
  const out: ParsedWebhook = { messages: [], statuses: [], reactions: [], readWatermarks: [], leadgens: [], comments: [] };
  if (!payload || !Array.isArray(payload.entry)) return out;

  for (const entry of payload.entry) {
    // Page feed/comments: entry.changes[] with item === "comment"
    for (const change of entry.changes ?? []) {
      const val = change?.value ?? {};
      if (change.field === "feed" && (val.item === "comment" || val.verb === "add") && val.comment_id) {
        out.comments.push({
          platform: payload.object === "instagram" ? "instagram" : "facebook",
          postId: String(val.post_id || entry.id || ""),
          commentId: String(val.comment_id),
          authorId: String(val.from?.id || ""),
          authorName: String(val.from?.name || "Anonymous User"),
          message: String(val.message || ""),
          timestamp: ts(val.created_time),
        });
      }
      if (change.field === "comments" && val.id) {
        // Instagram media comments
        out.comments.push({
          platform: "instagram",
          postId: String(val.media?.id || entry.id || ""),
          commentId: String(val.id),
          authorId: String(val.from?.id || ""),
          authorName: String(val.from?.username || "Instagram User"),
          message: String(val.text || ""),
          timestamp: ts(val.timestamp),
        });
      }
    }
    // WhatsApp: entry.changes[].value
    for (const change of entry.changes ?? []) {
      const value = change?.value ?? {};
      const profileName = value.contacts?.[0]?.profile?.name as string | undefined;
      if (change.field === "leadgen" && value.leadgen_id) {
        out.leadgens.push({
          pageId: String(entry.id ?? ""),
          leadgenId: String(value.leadgen_id),
          formId: value.form_id ? String(value.form_id) : undefined,
          adId: value.ad_id ? String(value.ad_id) : undefined,
          campaignId: value.campaign_id ? String(value.campaign_id) : undefined,
        });
      }
      for (const m of value.messages ?? []) {
        // IN6c: a WhatsApp reaction is a message of type "reaction"
        // pointing at the reacted message — it is NOT a chat
        // message and must never land in the thread as one. An
        // empty emoji means the customer removed their reaction.
        if (m.type === "reaction") {
          out.reactions.push({
            channel: "whatsapp",
            externalId: String(m.reaction?.message_id ?? ""),
            externalContactId: String(m.from),
            emoji: m.reaction?.emoji ? String(m.reaction.emoji) : undefined,
            action: m.reaction?.emoji ? "react" : "unreact",
            timestamp: ts(m.timestamp),
          });
          continue;
        }
        const type = String(m.type ?? "other");
        const media = ["image", "audio", "video", "document", "sticker"].includes(type) ? m[type] : undefined;
        out.messages.push({
          channel: "whatsapp",
          externalContactId: String(m.from),
          contactName: profileName,
          externalId: String(m.id),
          type,
          content:
            type === "text" ? m.text?.body :
            type === "button" ? m.button?.text :
            type === "interactive" ? (m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title) :
            media?.caption ?? media?.filename ?? undefined,
          mediaId: media?.id ? String(media.id) : undefined,
          replyToExternalId: m.context?.id ? String(m.context.id) : undefined,
          referral: m.referral ? {
            sourceId: m.referral.source_id ? String(m.referral.source_id) : undefined,
            sourceType: m.referral.source_type ? String(m.referral.source_type) : undefined,
            sourceUrl: m.referral.source_url ? String(m.referral.source_url) : undefined,
            headline: m.referral.headline ? String(m.referral.headline) : undefined,
          } : undefined,
          timestamp: ts(m.timestamp),
        });
      }
      for (const s of value.statuses ?? []) {
        const status = String(s.status);
        // MS7: a failed WhatsApp status carries Meta's errors[]
        // (code/title + error_data.details). Keep the first
        // error as one line; other statuses keep no error field,
        // so existing consumers see byte-identical events.
        let error: string | undefined;
        if (status === "failed" && Array.isArray(s.errors) && s.errors.length) {
          const first = s.errors[0] ?? {};
          const title = String(first.title ?? first.message ?? "").trim();
          const details = String(first.error_data?.details ?? "").trim();
          error = [title, details].filter(Boolean).join(" — ") || undefined;
        }
        out.statuses.push({ channel: "whatsapp", externalId: String(s.id), status, ...(error ? { error } : {}), at: s.timestamp ? ts(s.timestamp) : undefined });
      }
    }
    // Messenger + Instagram DM: entry.messaging[] (Instagram webhooks
    // carry object: "instagram" with the same messaging shape; the
    // sender id is the IGSID.)
    const pageChannel = payload.object === "instagram" ? "instagram" : "messenger";
    for (const event of entry.messaging ?? []) {
      if (event.message && !event.message.is_echo) {
        const m = event.message;
        const hasAttachment = Array.isArray(m.attachments) && m.attachments.length > 0;
        out.messages.push({
          channel: pageChannel,
          externalContactId: String(event.sender?.id),
          externalId: String(m.mid),
          type: m.text ? "text" : hasAttachment ? String(m.attachments[0].type ?? "other") : "other",
          content: m.text ?? undefined,
          mediaUrl: hasAttachment ? (m.attachments[0].payload?.url ?? undefined) : undefined,
          replyToExternalId: m.reply_to?.mid ? String(m.reply_to.mid) : undefined,
          timestamp: ts(event.timestamp ? Math.floor(Number(event.timestamp) / 1000) : undefined),
        });
      }
      // IN6c: Messenger/Instagram message_reactions webhook. The
      // emoji field carries the literal emoji; `reaction` carries
      // the name (love/like/…) — the service normalizes.
      if (event.reaction) {
        out.reactions.push({
          channel: pageChannel,
          externalId: String(event.reaction.mid ?? ""),
          externalContactId: String(event.sender?.id ?? ""),
          emoji: event.reaction.emoji ? String(event.reaction.emoji) : undefined,
          named: event.reaction.reaction ? String(event.reaction.reaction) : undefined,
          action: event.reaction.action === "unreact" ? "unreact" : "react",
          timestamp: ts(event.timestamp ? Math.floor(Number(event.timestamp) / 1000) : undefined),
        });
      }
      if (event.delivery) {
        for (const mid of event.delivery.mids ?? []) out.statuses.push({ channel: pageChannel, externalId: String(mid), status: "delivered" });
      }
      if (event.read) {
        // IN6a: read receipts carry a watermark (ms epoch), not
        // message ids. The watermark IS precise about time: every
        // outbound message sent at/before it was read. The service
        // applies it monotonically to that conversation only.
        const wm = Number(event.read.watermark);
        if (Number.isFinite(wm) && wm > 0 && event.sender?.id) {
          out.readWatermarks.push({ channel: pageChannel, externalContactId: String(event.sender.id), watermark: new Date(wm) });
        }
      }
    }
  }
  return out;
}
