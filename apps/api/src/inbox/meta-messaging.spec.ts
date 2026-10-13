import { MetaMessagingClient } from "./meta-messaging.client";
import { parseMetaWebhook } from "./webhook.parser";

const waPayload = {
  object: "whatsapp_business_account",
  entry: [{
    changes: [{
      value: {
        contacts: [{ profile: { name: "Rahim Uddin" }, wa_id: "8801712345678" }],
        messages: [{ from: "8801712345678", id: "wamid.1", timestamp: "1728000000", type: "text", text: { body: "দাম কত?" } }],
        statuses: [{ id: "wamid.0", status: "delivered", timestamp: "1728000001" }],
      },
    }],
  }],
};
const msgrPayload = {
  object: "page",
  entry: [{ messaging: [{ sender: { id: "PSID-9" }, timestamp: 1728000000000, message: { mid: "mid.1", text: "Hello, is this in stock?" } }] }],
};

describe("parseMetaWebhook", () => {
  it("parses WhatsApp inbound messages and statuses", () => {
    const parsed = parseMetaWebhook(waPayload);
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0]).toMatchObject({ channel: "whatsapp", externalContactId: "8801712345678", contactName: "Rahim Uddin", content: "দাম কত?", externalId: "wamid.1" });
    // IN6a: statuses now also carry the platform timestamp (`at`).
    expect(parsed.statuses).toEqual([{ channel: "whatsapp", externalId: "wamid.0", status: "delivered", at: new Date(1728000001000) }]);
  });
  it("parses Messenger messages and ignores echoes", () => {
    const parsed = parseMetaWebhook(msgrPayload);
    expect(parsed.messages[0]).toMatchObject({ channel: "messenger", externalContactId: "PSID-9", content: "Hello, is this in stock?" });
    const echo = parseMetaWebhook({ entry: [{ messaging: [{ sender: { id: "P" }, message: { mid: "m", text: "x", is_echo: true } }] }] });
    expect(echo.messages).toHaveLength(0);
  });
  it("garbage payloads parse to empty", () => {
    // Merge note (owner series e115adf): the parser gained an
    // additive `comments` array (social comment ingest); the empty
    // shape assertions include it — behaviour otherwise unchanged.
    // IN6: the empty shape also gained additive `reactions` and
    // `readWatermarks` arrays — behaviour otherwise unchanged.
    expect(parseMetaWebhook(null)).toEqual({ messages: [], statuses: [], leadgens: [], comments: [], reactions: [], readWatermarks: [] });
    expect(parseMetaWebhook({})).toEqual({ messages: [], statuses: [], leadgens: [], comments: [], reactions: [], readWatermarks: [] });
  });
});

describe("MetaMessagingClient", () => {
  it("WhatsApp send returns the wamid only when the API confirms", async () => {
    const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.42" }] }) }) as any;
    const client = new MetaMessagingClient({ accessToken: "t", phoneNumberId: "123" }, fetchFn);
    await expect(client.sendWhatsAppText("8801", "hello")).resolves.toEqual({ messageId: "wamid.42" });
  });
  it("a 200 response without a message id is a failure, not success", async () => {
    const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({}) }) as any;
    const client = new MetaMessagingClient({ accessToken: "t", phoneNumberId: "123" }, fetchFn);
    await expect(client.sendWhatsAppText("8801", "hello")).rejects.toThrow("NOT confirmed sent");
  });
  it("Messenger send requires message_id", async () => {
    const fetchFn = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "bad PSID" } }) }) as any;
    const client = new MetaMessagingClient({ accessToken: "t" }, fetchFn);
    await expect(client.sendMessengerText("X", "hi")).rejects.toThrow("bad PSID");
  });
});
