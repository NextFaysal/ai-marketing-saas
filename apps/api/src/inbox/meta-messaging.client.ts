import { graphVersion } from "../common/meta-graph";

/**
 * Meta messaging client for WhatsApp Cloud API and Messenger.
 * Both live on the Graph API. Docs:
 * - WhatsApp send: POST /{phone_number_id}/messages
 * - Messenger send: POST /me/messages with the Page access token.
 * A message is only "sent" when the API returns a message id; callers
 * must treat any other outcome as a failure, never as success.
 */
export interface MessagingSecrets {
  accessToken: string;
  appSecret?: string;
  verifyToken?: string;
  phoneNumberId?: string; // WhatsApp
  pageId?: string;        // Messenger
  // MS6: WhatsApp Business Account id — required for the
  // message_templates management endpoints (sync / submit). Set
  // manually by the tenant (connect flow or the WABA settings
  // endpoint); never guessed or derived silently.
  wabaId?: string;
}

/**
 * MS6: rich send-time template parameters, mapped to Meta's
 * template-message components format (lowercase types, per the
 * Cloud API template send docs):
 * - headerTextParams → { type:"header", parameters:[{type:"text",text}…] }
 * - headerMedia      → { type:"header", parameters:[{type:<kind>,<kind>:{link}}] }
 * - buttonParams     → one { type:"button", sub_type, index:"<n>",
 *   parameters:[…] } component per entry (url → text suffix;
 *   quick_reply → payload).
 */
export interface WhatsAppTemplateRichParams {
  headerTextParams?: string[];
  headerMedia?: { kind: "image" | "video" | "document"; link: string };
  buttonParams?: { index: number; subType: "url" | "quick_reply"; text?: string; payload?: string }[];
}

type FetchFn = typeof fetch;

export class MetaMessagingClient {
  private readonly base: string;
  constructor(
    private readonly secrets: MessagingSecrets,
    private readonly fetchFn: FetchFn = fetch,
    version?: string,
  ) {
    this.base = `https://graph.facebook.com/${version ?? graphVersion()}`;
  }

  async verifyToken(): Promise<{ id: string; name?: string }> {
    const res = await this.fetchFn(`${this.base}/me?access_token=${encodeURIComponent(this.secrets.accessToken)}`);
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Meta token verification failed (${res.status}): ${body?.error?.message ?? "unknown error"}`);
    return { id: String(body.id), name: body.name };
  }

  async sendWhatsAppText(toWaId: string, text: string, contextMessageId?: string): Promise<{ messageId: string }> {
    if (!this.secrets.phoneNumberId) throw new Error("WhatsApp phoneNumberId is not configured");
    const res = await this.fetchFn(`${this.base}/${this.secrets.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.secrets.accessToken}`, "Content-Type": "application/json" },
      // IN6b: WhatsApp quote — the Cloud API's real `context`
      // parameter (the wamid of the quoted message). Omitted
      // entirely when there is no quote, byte-identical to before.
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: toWaId, type: "text", text: { body: text }, ...(contextMessageId ? { context: { message_id: contextMessageId } } : {}) }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`WhatsApp send failed (${res.status}): ${body?.error?.message ?? "unknown error"}`);
    const messageId = body?.messages?.[0]?.id;
    if (!messageId) throw new Error("WhatsApp API returned no message id; the message is NOT confirmed sent");
    return { messageId: String(messageId) };
  }

  /**
   * WhatsApp template message — the ONLY message type allowed outside
   * the 24h customer-service window. The template must already exist
   * (approved) in Meta; Meta's own error is surfaced unchanged when it
   * is not. Sent only counts when Meta returns a message id.
   */
  async sendWhatsAppTemplate(toWaId: string, name: string, language: string, bodyParams: string[] = [], rich?: WhatsAppTemplateRichParams): Promise<{ messageId: string }> {
    if (!this.secrets.phoneNumberId) throw new Error("WhatsApp phoneNumberId is not configured");
    // MS6: components are built in Meta's order — header, body,
    // buttons. A media header wins over header text params when
    // both are given. With rich undefined/empty the request body
    // is byte-identical to the pre-MS6 shape.
    const components: any[] = [];
    if (rich?.headerMedia) {
      const kind = rich.headerMedia.kind;
      components.push({ type: "header", parameters: [{ type: kind, [kind]: { link: rich.headerMedia.link } }] });
    } else if (rich?.headerTextParams?.length) {
      components.push({ type: "header", parameters: rich.headerTextParams.map((text) => ({ type: "text", text })) });
    }
    if (bodyParams.length) {
      components.push({ type: "body", parameters: bodyParams.map((text) => ({ type: "text", text })) });
    }
    for (const btn of rich?.buttonParams ?? []) {
      components.push({
        type: "button", sub_type: btn.subType, index: String(btn.index),
        parameters: btn.subType === "url"
          ? [{ type: "text", text: btn.text ?? "" }]
          : [{ type: "payload", payload: btn.payload ?? "" }],
      });
    }
    const res = await this.fetchFn(`${this.base}/${this.secrets.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.secrets.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", recipient_type: "individual", to: toWaId,
        type: "template", template: { name, language: { code: language }, ...(components.length ? { components } : {}) },
      }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`WhatsApp template send failed (${res.status}): ${body?.error?.message ?? "unknown error"}`);
    const messageId = body?.messages?.[0]?.id;
    if (!messageId) throw new Error("WhatsApp API returned no message id; the template message is NOT confirmed sent");
    return { messageId: String(messageId) };
  }

  /**
   * MS6 — list the WABA's message templates (WhatsApp Business
   * Management API). Shape per Meta's template docs
   * (https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview)
   * and the Graph API reference for the whats-app-business-account
   * message_templates edge: returns { data: [{ id, name, language,
   * category, status, quality_score: { score }, components }],
   * paging: { cursors: { before, after }, next? } }. One page per
   * call; the caller walks cursors via `after`.
   */
  async listMessageTemplates(wabaId: string, after?: string): Promise<any> {
    const url = `${this.base}/${wabaId}/message_templates?fields=name,language,category,status,quality_score,components,id&limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`;
    const res = await this.fetchFn(url, { headers: { Authorization: `Bearer ${this.secrets.accessToken}` } });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`WhatsApp template list failed (${res.status}): ${body?.error?.message ?? "unknown error"}`);
    return body;
  }

  /**
   * MS6 — create a message template = submit it for Meta's review
   * (POST /{waba-id}/message_templates with { name, category,
   * language, parameter_format?, components } in the UPPERCASE
   * create format — see the template components docs:
   * https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components).
   * Response shape: { id, status, category } (status may be absent;
   * callers treat absent as "PENDING"). Meta's error surfaces
   * verbatim on rejection — nothing was created.
   */
  async createMessageTemplate(wabaId: string, payload: Record<string, unknown>): Promise<{ id?: string; status?: string; category?: string }> {
    const res = await this.fetchFn(`${this.base}/${wabaId}/message_templates`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.secrets.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`WhatsApp template create failed (${res.status}): ${body?.error?.message ?? "unknown error"}`);
    return body;
  }

  async sendWhatsAppImage(toWaId: string, link: string, caption?: string): Promise<{ messageId: string }> {
    if (!this.secrets.phoneNumberId) throw new Error("WhatsApp phoneNumberId is not configured");
    const res = await this.fetchFn(`${this.base}/${this.secrets.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.secrets.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: toWaId, type: "image", image: { link, ...(caption ? { caption } : {}) } }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`WhatsApp image send failed (${res.status}): ${body?.error?.message ?? "unknown error"}`);
    const messageId = body?.messages?.[0]?.id;
    if (!messageId) throw new Error("WhatsApp API returned no message id; the image is NOT confirmed sent");
    return { messageId: String(messageId) };
  }

  /**
   * Downloads WhatsApp media bytes: resolve the media id to a temporary
   * Graph URL, then fetch the bytes with the access token. Nothing is
   * persisted; callers stream the result to the authenticated agent.
   */
  async downloadWhatsAppMedia(mediaId: string): Promise<{ bytes: Buffer; contentType: string }> {
    const metaRes = await this.fetchFn(`${this.base}/${mediaId}?access_token=${encodeURIComponent(this.secrets.accessToken)}`);
    const meta: any = await metaRes.json().catch(() => ({}));
    if (!metaRes.ok || !meta?.url) throw new Error(`Media lookup failed (${metaRes.status}): ${meta?.error?.message ?? "no download URL returned"}`);
    const fileRes = await this.fetchFn(String(meta.url), { headers: { Authorization: `Bearer ${this.secrets.accessToken}` } });
    if (!fileRes.ok) throw new Error(`Media download failed (${fileRes.status})`);
    const bytes = Buffer.from(await fileRes.arrayBuffer());
    return { bytes, contentType: String(meta.mime_type ?? fileRes.headers.get("content-type") ?? "application/octet-stream") };
  }

  async sendMessengerText(psid: string, text: string, replyToMid?: string): Promise<{ messageId: string }> {
    const res = await this.fetchFn(`${this.base}/me/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.secrets.accessToken}`, "Content-Type": "application/json" },
      // IN6b: Messenger/Instagram quote — the Send API's real
      // top-level `reply_to.mid` parameter (Meta docs, "Send a
      // message": reply to a specific past message in the chat).
      body: JSON.stringify({ recipient: { id: psid }, messaging_type: "RESPONSE", message: { text }, ...(replyToMid ? { reply_to: { mid: replyToMid } } : {}) }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Messenger send failed (${res.status}): ${body?.error?.message ?? "unknown error"}`);
    if (!body?.message_id) throw new Error("Messenger API returned no message_id; the message is NOT confirmed sent");
    return { messageId: String(body.message_id) };
  }

  /**
   * IN6c: agent reaction on Messenger/Instagram — Meta's real
   * sender_action API (docs "Sender actions": POST /me/messages
   * with sender_action "react"/"unreact" and payload
   * {message_id, reaction}). Success is Meta's response carrying
   * the recipient_id; anything else throws verbatim. There is NO
   * equivalent WhatsApp Cloud API for reacting as the business,
   * so this method is Messenger/Instagram only by design.
   */
  async sendMessengerReaction(psid: string, mid: string, emoji: string | null): Promise<{ recipientId: string }> {
    const res = await this.fetchFn(`${this.base}/me/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.secrets.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: psid },
        sender_action: emoji ? "react" : "unreact",
        payload: { message_id: mid, ...(emoji ? { reaction: emoji } : {}) },
      }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Messenger reaction failed (${res.status}): ${body?.error?.message ?? "unknown error"}`);
    if (!body?.recipient_id) throw new Error("Messenger API did not confirm the reaction; it is NOT applied");
    return { recipientId: String(body.recipient_id) };
  }

  // ---- IN8: Page/IG comment actions (Meta Graph comment endpoints) ----
  // Docs (Graph API, Page/IG comments):
  // - hide/unhide: POST /{comment-id} with {is_hidden: true|false}
  //   -> {success: true}
  // - reply:       POST /{comment-id}/comments with {message}
  //   -> the new comment object {id, ...}
  // - delete:      DELETE /{comment-id} -> {success: true}
  // - private reply: POST /{comment-id}/private_replies with
  //   {message} -> {id, recipient_id} (one private reply per comment,
  //   only within Meta's window; Meta's own error surfaces verbatim
  //   when the window has passed or it was already used).
  // Every method throws unless Graph confirms with the expected
  // body — a 2xx without the confirmation field is NOT success.

  private async graphCommentCall(label: string, url: string, init: Record<string, unknown>): Promise<any> {
    const res = await this.fetchFn(url, init);
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${label} failed (${res.status}): ${body?.error?.message ?? "unknown error"}`);
    return body;
  }

  async setCommentHidden(commentId: string, hidden: boolean): Promise<{ success: true }> {
    const body = await this.graphCommentCall("Comment hide", `${this.base}/${encodeURIComponent(commentId)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.secrets.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ is_hidden: hidden }),
    });
    if (body?.success !== true) throw new Error("Meta did not confirm the comment hide; it is NOT hidden on the platform");
    return { success: true };
  }

  async replyToComment(commentId: string, message: string): Promise<{ commentId: string }> {
    const body = await this.graphCommentCall("Comment reply", `${this.base}/${encodeURIComponent(commentId)}/comments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.secrets.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (!body?.id) throw new Error("Meta returned no id for the comment reply; the reply is NOT confirmed posted");
    return { commentId: String(body.id) };
  }

  async deleteComment(commentId: string): Promise<{ success: true }> {
    const body = await this.graphCommentCall("Comment delete", `${this.base}/${encodeURIComponent(commentId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.secrets.accessToken}` },
    });
    if (body?.success !== true) throw new Error("Meta did not confirm the comment delete; it is NOT deleted on the platform");
    return { success: true };
  }

  async privateReplyToComment(commentId: string, message: string): Promise<{ messageId: string }> {
    const body = await this.graphCommentCall("Comment private reply", `${this.base}/${encodeURIComponent(commentId)}/private_replies`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.secrets.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const id = body?.id ?? body?.message_id;
    if (!id) throw new Error("Meta returned no id for the private reply; the DM is NOT confirmed sent");
    return { messageId: String(id) };
  }

  async sendMessengerImage(psid: string, url: string): Promise<{ messageId: string }> {
    const res = await this.fetchFn(`${this.base}/me/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.secrets.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: psid }, messaging_type: "RESPONSE", message: { attachment: { type: "image", payload: { url, is_reusable: false } } } }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Messenger image send failed (${res.status}): ${body?.error?.message ?? "unknown error"}`);
    if (!body?.message_id) throw new Error("Messenger API returned no message_id; the image is NOT confirmed sent");
    return { messageId: String(body.message_id) };
  }

  // ---- Inbox Next-Gen P1: uploaded media (drag-drop / voice) ----
  // The URL-based sends above cannot carry browser-recorded or
  // dropped files (no public URL exists for them), so the bytes are
  // uploaded to Meta first and then sent by the returned id — the
  // same "sent only with a platform message id" discipline.

  /** WhatsApp media upload: POST /{phone_number_id}/media (multipart). */
  async uploadWhatsAppMedia(bytes: Buffer, contentType: string, fileName: string): Promise<{ mediaId: string }> {
    if (!this.secrets.phoneNumberId) throw new Error("WhatsApp phoneNumberId is not configured");
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", contentType);
    form.append("file", new Blob([new Uint8Array(bytes)], { type: contentType }), fileName);
    const res = await this.fetchFn(`${this.base}/${this.secrets.phoneNumberId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.secrets.accessToken}` },
      body: form,
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`WhatsApp media upload failed (${res.status}): ${body?.error?.message ?? "unknown error"}`);
    if (!body?.id) throw new Error("WhatsApp API returned no media id for the upload; the media is NOT uploaded");
    return { mediaId: String(body.id) };
  }

  /** Send a previously uploaded WhatsApp media id (image/audio/video/document). */
  async sendWhatsAppMedia(toWaId: string, mediaId: string, kind: "image" | "audio" | "video" | "document", caption?: string, fileName?: string): Promise<{ messageId: string }> {
    if (!this.secrets.phoneNumberId) throw new Error("WhatsApp phoneNumberId is not configured");
    const media: Record<string, unknown> = { id: mediaId };
    // WhatsApp accepts captions on image/video/document only, and a
    // filename on documents only.
    if (caption && kind !== "audio") media.caption = caption;
    if (fileName && kind === "document") media.filename = fileName;
    const res = await this.fetchFn(`${this.base}/${this.secrets.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.secrets.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: toWaId, type: kind, [kind]: media }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`WhatsApp media send failed (${res.status}): ${body?.error?.message ?? "unknown error"}`);
    const messageId = body?.messages?.[0]?.id;
    if (!messageId) throw new Error("WhatsApp API returned no message id; the media is NOT confirmed sent");
    return { messageId: String(messageId) };
  }

  /** Messenger/Instagram attachment upload: POST /me/message_attachments (multipart). */
  async uploadMessengerAttachment(bytes: Buffer, contentType: string, kind: "image" | "audio" | "video" | "document", fileName: string): Promise<{ attachmentId: string }> {
    const attachmentType = kind === "document" ? "file" : kind;
    const form = new FormData();
    form.append("message", JSON.stringify({ attachment: { type: attachmentType, payload: { is_reusable: true } } }));
    form.append("filedata", new Blob([new Uint8Array(bytes)], { type: contentType }), fileName);
    const res = await this.fetchFn(`${this.base}/me/message_attachments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.secrets.accessToken}` },
      body: form,
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Messenger attachment upload failed (${res.status}): ${body?.error?.message ?? "unknown error"}`);
    if (!body?.attachment_id) throw new Error("Messenger API returned no attachment_id for the upload; the media is NOT uploaded");
    return { attachmentId: String(body.attachment_id) };
  }

  /** Send a previously uploaded Messenger/Instagram attachment id. */
  async sendMessengerAttachment(psid: string, attachmentId: string, kind: "image" | "audio" | "video" | "document"): Promise<{ messageId: string }> {
    const attachmentType = kind === "document" ? "file" : kind;
    const res = await this.fetchFn(`${this.base}/me/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.secrets.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: psid }, messaging_type: "RESPONSE", message: { attachment: { type: attachmentType, payload: { attachment_id: attachmentId } } } }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Messenger media send failed (${res.status}): ${body?.error?.message ?? "unknown error"}`);
    if (!body?.message_id) throw new Error("Messenger API returned no message_id; the media is NOT confirmed sent");
    return { messageId: String(body.message_id) };
  }
}
