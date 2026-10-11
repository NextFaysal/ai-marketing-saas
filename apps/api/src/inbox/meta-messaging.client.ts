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

  async sendWhatsAppText(toWaId: string, text: string): Promise<{ messageId: string }> {
    if (!this.secrets.phoneNumberId) throw new Error("WhatsApp phoneNumberId is not configured");
    const res = await this.fetchFn(`${this.base}/${this.secrets.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.secrets.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: toWaId, type: "text", text: { body: text } }),
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
  async sendWhatsAppTemplate(toWaId: string, name: string, language: string, bodyParams: string[] = []): Promise<{ messageId: string }> {
    if (!this.secrets.phoneNumberId) throw new Error("WhatsApp phoneNumberId is not configured");
    const components = bodyParams.length
      ? [{ type: "body", parameters: bodyParams.map((text) => ({ type: "text", text })) }]
      : [];
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

  async sendMessengerText(psid: string, text: string): Promise<{ messageId: string }> {
    const res = await this.fetchFn(`${this.base}/me/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.secrets.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: psid }, messaging_type: "RESPONSE", message: { text } }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Messenger send failed (${res.status}): ${body?.error?.message ?? "unknown error"}`);
    if (!body?.message_id) throw new Error("Messenger API returned no message_id; the message is NOT confirmed sent");
    return { messageId: String(body.message_id) };
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
