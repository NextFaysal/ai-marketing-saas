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
}
