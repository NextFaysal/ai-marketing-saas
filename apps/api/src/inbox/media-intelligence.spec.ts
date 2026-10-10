import { createHmac } from "crypto";

process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.DISABLE_SCHEDULER = "true";

import { InboxService } from "./inbox.service";
import { encryptJson } from "../integrations/crypto";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(row[k]);
      if ("not" in v) return row[k] !== v.not;
      return true;
    }
    return row[k] === v;
  });
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    findUnique: async ({ where }: any) => rows.find((r) => matches(r, where ?? {})) ?? null,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => matches(r, where ?? {})); if (row) Object.assign(row, data); return row ?? null; },
  };
}
function fakePrisma() {
  const tables: Record<string, any> = {};
  for (const n of ["integration", "channelConversation", "channelMessage", "conversationNote", "customer", "order", "paymentVerification", "courierShipment", "lead"]) tables[n] = makeTable(n);
  const secrets = encryptJson({ accessToken: "tok", appSecret: "appsecret", verifyToken: "vtok", phoneNumberId: "999" });
  tables.integration.rows.push({ id: "int-1", organizationId: "org-1", provider: "whatsapp", status: "CONNECTED", credential: { encryptedData: secrets } });
  tables.channelConversation.rows.push({
    id: "conv-1", organizationId: "org-1", integrationId: "int-1", channel: "whatsapp",
    contactId: "8801711111111", contactName: "Karim", status: "open", customerId: "cus-1", leadId: null,
    unreadCount: 1, tags: [],
  });
  tables.customer.rows.push({ id: "cus-1", organizationId: "org-1", firstName: "Karim", phone: "01711111111", createdAt: new Date() });
  tables.order.rows.push({
    id: "ord-1", organizationId: "org-1", customerId: "cus-1", status: "pending", isCod: true,
    totalMinor: 150000n, currency: "BDT", codConversationId: "conv-1", codConfirmationStatus: "awaiting", createdAt: new Date(),
  });
  tables.channelMessage.rows.push(
    { id: "msg-img", conversationId: "conv-1", direction: "in", type: "image", mediaId: "media-1", content: null, status: "delivered", createdAt: new Date() },
    { id: "msg-audio", conversationId: "conv-1", direction: "in", type: "audio", mediaId: "media-2", content: null, status: "delivered", intent: null, createdAt: new Date() },
  );
  return tables;
}
const llmStub = { getProvider: () => new DevTemplateProvider() } as any;
const auditStub = { log: async () => undefined } as any;

let visionAmount = 1500;
let visionTrx = "9HXABC123";
function stubFetches() {
  global.fetch = (async (url: any) => {
    const u = String(url);
    if (u.includes("api.openai.com/v1/chat/completions")) {
      const content = JSON.stringify({ provider: "bkash", trxId: visionTrx, amount: visionAmount, senderNumber: "017****1111", receiverNumber: null, datetimeText: null, suspicious: [] });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }
    if (u.includes("api.openai.com/v1/audio/transcriptions")) {
      return new Response(JSON.stringify({ text: "এই শাড়িটার দাম কত" }), { status: 200 });
    }
    if (u.includes("graph.facebook.com") && u.includes("media")) {
      return new Response(JSON.stringify({ url: "https://cdn.example/file" }), { status: 200 });
    }
    if (u.includes("cdn.example")) {
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    if (u.includes("graph.facebook.com")) {
      return new Response(JSON.stringify({ messages: [{ id: "wamid.x" }] }), { status: 200 });
    }
    throw new Error("unexpected fetch " + u);
  }) as any;
}

describe("M16 payment verification + transcription", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    visionAmount = 1500; visionTrx = "9HXABC123";
    process.env.LLM_PROVIDER = "openai"; process.env.LLM_API_KEY = "test-key";
    stubFetches();
  });
  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.LLM_PROVIDER; delete process.env.LLM_API_KEY;
  });

  it("matches a screenshot against the awaiting COD order total", async () => {
    const tables = fakePrisma();
    const svc = new InboxService(tables as any, auditStub, llmStub);
    const v = await svc.verifyPaymentScreenshot("org-1", "agent", "conv-1", "msg-img");
    expect(v.verdict).toBe("matched");
    expect(v.trxId).toBe("9HXABC123");
    expect(v.amountMinor).toBe("150000");
    expect(v.expectedAmountMinor).toBe("150000");
    expect(tables.conversationNote.rows.some((n: any) => n.content.includes("পেমেন্ট স্ক্রিনশট যাচাই"))).toBe(true);
  });

  it("flags amount mismatch and reused TrxIDs (screenshot fraud)", async () => {
    const tables = fakePrisma();
    const svc = new InboxService(tables as any, auditStub, llmStub);
    await svc.verifyPaymentScreenshot("org-1", "agent", "conv-1", "msg-img");
    // a second screenshot reusing the same TrxID
    tables.channelMessage.rows.push({ id: "msg-img2", conversationId: "conv-1", direction: "in", type: "image", mediaId: "media-9", content: null, status: "delivered", createdAt: new Date() });
    const dup = await svc.verifyPaymentScreenshot("org-1", "agent", "conv-1", "msg-img2");
    expect(dup.verdict).toBe("duplicate_trxid");
    expect(dup.flags).toContain("duplicate_trxid");
    // a different TrxID with the wrong amount
    visionTrx = "NEWTRX999"; visionAmount = 1400;
    tables.channelMessage.rows.push({ id: "msg-img3", conversationId: "conv-1", direction: "in", type: "image", mediaId: "media-10", content: null, status: "delivered", createdAt: new Date() });
    const mis = await svc.verifyPaymentScreenshot("org-1", "agent", "conv-1", "msg-img3");
    expect(mis.verdict).toBe("amount_mismatch");
  });

  it("transcribes a voice note and classifies its intent from the transcript", async () => {
    const tables = fakePrisma();
    const svc = new InboxService(tables as any, auditStub, llmStub);
    const out = await svc.transcribeMessage("org-1", "conv-1", "msg-audio");
    expect(out.transcription).toBe("এই শাড়িটার দাম কত");
    expect(out.provider).toBe("openai-whisper");
    const row = tables.channelMessage.rows.find((m: any) => m.id === "msg-audio");
    expect(row.transcription).toBe("এই শাড়িটার দাম কত");
    expect(row.intent).toBe("price");
  });

  it("refuses honestly when no real AI provider is configured", async () => {
    delete process.env.LLM_PROVIDER; delete process.env.LLM_API_KEY;
    const tables = fakePrisma();
    const svc = new InboxService(tables as any, auditStub, llmStub);
    await expect(svc.verifyPaymentScreenshot("org-1", "agent", "conv-1", "msg-img")).rejects.toThrow("আসল AI provider দরকার");
    await expect(svc.transcribeMessage("org-1", "conv-1", "msg-audio")).rejects.toThrow("আসল AI provider দরকার");
    expect(tables.paymentVerification.rows).toHaveLength(0);
  });
});

// keep createHmac import used by sibling patterns (signature parity)
void createHmac;
