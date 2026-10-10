export interface IncomingMessageEvent {
  channel: "whatsapp" | "messenger" | "instagram";
  externalContactId: string;
  contactName?: string;
  externalId: string;
  type: string;
  content?: string;
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
export interface StatusEvent {
  channel: "whatsapp" | "messenger" | "instagram";
  externalId: string;
  status: string; // sent | delivered | read | failed
}
export interface ParsedWebhook { messages: IncomingMessageEvent[]; statuses: StatusEvent[]; leadgens: LeadgenEvent[] }

const ts = (seconds: string | number | undefined): Date =>
  new Date((Number(seconds ?? 0) || Math.floor(Date.now() / 1000)) * 1000);

export function parseMetaWebhook(payload: any): ParsedWebhook {
  const out: ParsedWebhook = { messages: [], statuses: [], leadgens: [] };
  if (!payload || !Array.isArray(payload.entry)) return out;

  for (const entry of payload.entry) {
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
        out.statuses.push({ channel: "whatsapp", externalId: String(s.id), status: String(s.status) });
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
          timestamp: ts(event.timestamp ? Math.floor(Number(event.timestamp) / 1000) : undefined),
        });
      }
      if (event.delivery) {
        for (const mid of event.delivery.mids ?? []) out.statuses.push({ channel: pageChannel, externalId: String(mid), status: "delivered" });
      }
      if (event.read) {
        // Read receipts carry a watermark, not message ids; nothing precise to update.
      }
    }
  }
  return out;
}
