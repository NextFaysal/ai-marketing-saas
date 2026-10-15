process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.DISABLE_SCHEDULER = "true";

/**
 * CX12c — Voice-Note Ordering: the AUTO transcription pipeline.
 *
 * The speech provider itself is NOT under test here (media-intelligence
 * has its own specs against the real provider HTTP shapes). This spec
 * mocks the media-intelligence module so transcribeAudio is a fake:
 * transcription is proven ONLY through that fake — no real
 * transcription is claimed. What is proven is the pipeline: an
 * inbound voice note (content null) is transcribed once during
 * processInboundIntelligence (reached here through the public
 * ingestChatMessage entry), the transcript is stored + status
 * stamped, and the SAME dispatch feeds it to the order bot /
 * autopilot exactly like typed text. Failures stamp
 * failed/unavailable, never throw, and are never retried by a
 * re-dispatch.
 */
jest.mock("./media-intelligence", () => {
  class MediaIntelligenceError extends Error {}
  return {
    MediaIntelligenceError,
    transcribeAudio: jest.fn(),
    extractPaymentScreenshot: jest.fn(async () => { throw new Error("not used in CX12c specs"); }),
  };
});

import { InboxService } from "./inbox.service";
import { encryptJson } from "../integrations/crypto";
import { DevTemplateProvider } from "../ai/llm/dev.provider";
import { transcribeAudio, MediaIntelligenceError } from "./media-intelligence";

const transcribeMock = transcribeAudio as unknown as jest.Mock;
const getMediaMock = jest.fn(async () => ({ bytes: Buffer.from([1, 2, 3]), contentType: "audio/ogg" }));

function matches(row: any, where: any, tables: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (k === "OR") return (v as any[]).some((sub) => matches(row, sub, tables));
    if (k === "conversation") {
      const conv = tables.channelConversation.rows.find((c: any) => c.id === row.conversationId);
      return Boolean(conv) && matches(conv, v, tables);
    }
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("not" in v) return row[k] !== v.not;
      if ("in" in v) return v.in.includes(row[k]);
      if ("gt" in v) return row[k] > v.gt;
      if ("gte" in v) return row[k] >= v.gte;
      if ("lt" in v) return row[k] < v.lt;
      if ("lte" in v) return row[k] <= v.lte;
      if ("has" in v) return Array.isArray(row[k]) && row[k].includes(v.has);
      if ("contains" in v) {
        const hay = String(row[k] ?? "");
        return v.mode === "insensitive" ? hay.toLowerCase().includes(String(v.contains).toLowerCase()) : hay.includes(v.contains);
      }
      return true;
    }
    return row[k] === v;
  });
}
function makeTable(name: string, tables: any) {
  const rows: any[] = [];
  let seq = 0;
  const applyOrder = (list: any[], orderBy: any) => {
    if (!orderBy) return list;
    const entries = Array.isArray(orderBy) ? orderBy : [orderBy];
    let out = [...list];
    for (const ob of entries) {
      const [key, dir] = Object.entries(ob)[0] as [string, string];
      out.sort((a, b) => {
        const av = a[key] instanceof Date ? a[key].getTime() : a[key];
        const bv = b[key] instanceof Date ? b[key].getTime() : b[key];
        return dir === "desc" ? (bv > av ? 1 : -1) : (av > bv ? 1 : -1);
      });
    }
    return out;
  };
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where ?? {}, tables)) ?? null,
    findMany: async ({ where, take, orderBy }: any = {}) => {
      const f = applyOrder(rows.filter((r) => matches(r, where ?? {}, tables)), orderBy);
      return take ? f.slice(0, take) : f;
    },
    findUnique: async ({ where }: any) => rows.find((r) => matches(r, where ?? {}, tables)) ?? null,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where ?? {}, tables));
      if (!row) return null;
      for (const [k, v] of Object.entries(data)) {
        if (v !== null && typeof v === "object" && "increment" in (v as any)) (row as any)[k] = ((row as any)[k] ?? 0) + (v as any).increment;
        else (row as any)[k] = v;
      }
      row.updatedAt = new Date();
      return row;
    },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => matches(r, where ?? {}, tables)); return rows.splice(i, 1)[0]; },
  };
}
const TABLE_NAMES = ["integration", "channelConversation", "channelMessage", "conversationNote", "quickReply", "whatsAppTemplate", "lead", "leadActivity", "customer", "order", "orderItem", "membership", "messageDraft", "inboxSetting", "businessPolicy", "product", "productVariant", "botSession"];
function fakePrisma() {
  const tables: Record<string, any> = {};
  for (const name of TABLE_NAMES) tables[name] = makeTable(name, tables);
  tables.businessProfile = { findUnique: async () => ({ industry: "fashion", description: "Clothing", brandVoice: "friendly" }) };
  const secrets = encryptJson({ accessToken: "tok", appSecret: "appsecret", verifyToken: "vtok", phoneNumberId: "999" });
  tables.integration.rows.push({ id: "int-1", organizationId: "org-1", provider: "whatsapp", status: "CONNECTED", credential: { encryptedData: secrets } });
  tables.product.rows.push(
    { id: "p1", organizationId: "org-1", status: "ACTIVE", name: "Cotton Panjabi", priceMinor: 150000n, currency: "BDT", stockQuantity: 12, source: "manual", externalId: null, createdAt: new Date(1) },
    { id: "p2", organizationId: "org-1", status: "ACTIVE", name: "Silk Saree", priceMinor: 450000n, currency: "BDT", stockQuantity: 5, source: "manual", externalId: null, createdAt: new Date(2) },
  );
  return tables;
}
const llmStub = { getProvider: () => new DevTemplateProvider() } as any;
const auditStub = { log: async () => undefined } as any;

const ORDER_TRANSCRIPT = "আমি অর্ডার করতে চাই";
const PRICE_TRANSCRIPT = "Cotton Panjabi এর দাম কত?";

function seedConversation(tables: any, over: any = {}) {
  const conv = {
    id: "conv-1", organizationId: "org-1", integrationId: "int-1", channel: "whatsapp",
    externalContactId: "8801711111111", contactName: "Karim", status: "open",
    assignedUserId: "agent-1", unreadCount: 1, autoReplyPaused: false, customerId: null,
    lastMessageAt: new Date(), lastCustomerMessageAt: new Date(), createdAt: new Date(),
    ...over,
  };
  tables.channelConversation.rows.push(conv);
  return conv;
}
function seedMessage(tables: any, over: any = {}) {
  const msg = {
    id: "msg-audio-1", conversationId: "conv-1", direction: "in", type: "audio",
    content: null, mediaId: "media-1", status: "received", intent: null, intentConfidence: null,
    transcription: null, transcriptionProvider: null, transcriptionStatus: null,
    createdAt: new Date(), ...over,
  };
  tables.channelMessage.rows.push(msg);
  return msg;
}
const outTexts = (tables: any) => tables.channelMessage.rows.filter((m: any) => m.direction === "out" && m.status === "sent").map((m: any) => m.content as string);
const rowOf = (tables: any, id: string) => tables.channelMessage.rows.find((m: any) => m.id === id);

describe("CX12c voice-note auto-transcription pipeline", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    jest.clearAllMocks();
    getMediaMock.mockResolvedValue({ bytes: Buffer.from([1, 2, 3]), contentType: "audio/ogg" });
    // Platform sends (bot / autopilot delivery) succeed with a message id.
    global.fetch = (async () => new Response(JSON.stringify({ messages: [{ id: `wamid.s${Math.random()}` }] }), { status: 200 })) as any;
  });
  afterEach(() => { global.fetch = realFetch; });

  async function setup(settings: any = {}) {
    const tables = fakePrisma();
    const svc = new InboxService(tables as any, auditStub, llmStub);
    (svc as any).getMessageMedia = getMediaMock;
    if (Object.keys(settings).length) await svc.updateSettings("org-1", "owner", settings);
    return { tables, svc };
  }

  it("audio + provider success: transcript stored (done), and the order bot receives it in the same dispatch", async () => {
    transcribeMock.mockResolvedValue({ text: ORDER_TRANSCRIPT, modelProvider: "openai-whisper" });
    const { tables, svc } = await setup({ botEnabled: true, botDeliveryChargeMinor: 6000 });
    seedConversation(tables);
    seedMessage(tables);
    await svc.ingestChatMessage("org-1", "conv-1", "msg-audio-1");
    expect(transcribeMock).toHaveBeenCalledTimes(1);
    const row = rowOf(tables, "msg-audio-1");
    expect(row.transcription).toBe(ORDER_TRANSCRIPT);
    expect(row.transcriptionProvider).toBe("openai-whisper");
    expect(row.transcriptionStatus).toBe("done");
    expect(row.intent).toBe("order_intent");
    // The bot consumed the transcript exactly like typed text: a
    // session opened at ask_product and the product list was sent.
    expect(tables.botSession.rows).toHaveLength(1);
    expect(tables.botSession.rows[0].state).toBe("ask_product");
    expect(outTexts(tables)[0]).toContain("Cotton Panjabi");
  });

  it("autopilot receives the transcript too (bot disabled): a grounded price reply is sent", async () => {
    transcribeMock.mockResolvedValue({ text: PRICE_TRANSCRIPT, modelProvider: "openai-whisper" });
    const { tables, svc } = await setup({ autoReplyMode: "auto" });
    seedConversation(tables);
    seedMessage(tables);
    await svc.ingestChatMessage("org-1", "conv-1", "msg-audio-1");
    const row = rowOf(tables, "msg-audio-1");
    expect(row.transcriptionStatus).toBe("done");
    expect(row.intent).toBe("price");
    expect(tables.botSession.rows).toHaveLength(0);
    const auto = tables.channelMessage.rows.filter((m: any) => m.direction === "out" && m.autoReply && m.status === "sent");
    expect(auto).toHaveLength(1);
    expect(auto[0].content).toContain("Cotton Panjabi");
  });

  it("audio + MediaIntelligenceError: status unavailable, NO throw, bot/autopilot fed nothing", async () => {
    transcribeMock.mockRejectedValue(new MediaIntelligenceError("এই ফিচারের জন্য একটি আসল AI provider দরকার"));
    const { tables, svc } = await setup({ botEnabled: true, autoReplyMode: "auto" });
    seedConversation(tables);
    seedMessage(tables);
    await expect(svc.ingestChatMessage("org-1", "conv-1", "msg-audio-1")).resolves.toBeUndefined();
    const row = rowOf(tables, "msg-audio-1");
    expect(row.transcriptionStatus).toBe("unavailable");
    expect(row.transcription).toBeNull();
    expect(row.intent).toBeNull();
    expect(tables.botSession.rows).toHaveLength(0);
    expect(outTexts(tables)).toHaveLength(0);
  });

  it("audio + generic provider failure: status failed, ingest intact", async () => {
    transcribeMock.mockRejectedValue(new Error("socket hangup"));
    const { tables, svc } = await setup({ botEnabled: true, autoReplyMode: "auto" });
    seedConversation(tables);
    const msg = seedMessage(tables);
    await expect(svc.ingestChatMessage("org-1", "conv-1", "msg-audio-1")).resolves.toBeUndefined();
    const row = rowOf(tables, "msg-audio-1");
    expect(row.transcriptionStatus).toBe("failed");
    expect(row.transcription).toBeNull();
    // The message row itself is otherwise untouched.
    expect(row.status).toBe("received");
    expect(row.content).toBeNull();
    expect(msg.conversationId).toBe("conv-1");
    expect(tables.botSession.rows).toHaveLength(0);
    expect(outTexts(tables)).toHaveLength(0);
  });

  it("already-transcribed message: provider NOT called again, stored text drives the dispatch", async () => {
    transcribeMock.mockResolvedValue({ text: "should never be used", modelProvider: "openai-whisper" });
    const { tables, svc } = await setup({ botEnabled: true, botDeliveryChargeMinor: 6000 });
    seedConversation(tables);
    seedMessage(tables, { transcription: ORDER_TRANSCRIPT, transcriptionProvider: "gemini", transcriptionStatus: null });
    await svc.ingestChatMessage("org-1", "conv-1", "msg-audio-1");
    expect(transcribeMock).not.toHaveBeenCalled();
    expect(getMediaMock).not.toHaveBeenCalled();
    const row = rowOf(tables, "msg-audio-1");
    expect(row.transcription).toBe(ORDER_TRANSCRIPT);
    expect(row.transcriptionStatus).toBe("done"); // converged
    expect(tables.botSession.rows).toHaveLength(1);
  });

  it("status failed/unavailable: a second dispatch does NOT retry the provider", async () => {
    for (const status of ["failed", "unavailable"]) {
      transcribeMock.mockResolvedValue({ text: ORDER_TRANSCRIPT, modelProvider: "openai-whisper" });
      const { tables, svc } = await setup({ botEnabled: true });
      seedConversation(tables);
      seedMessage(tables, { transcriptionStatus: status });
      await svc.ingestChatMessage("org-1", "conv-1", "msg-audio-1");
      expect(transcribeMock).not.toHaveBeenCalled();
      expect(getMediaMock).not.toHaveBeenCalled();
      const row = rowOf(tables, "msg-audio-1");
      expect(row.transcriptionStatus).toBe(status);
      expect(row.transcription).toBeNull();
      expect(tables.botSession.rows).toHaveLength(0);
    }
  });

  it("plain text message: zero transcription activity", async () => {
    transcribeMock.mockResolvedValue({ text: ORDER_TRANSCRIPT, modelProvider: "openai-whisper" });
    const { tables, svc } = await setup({ botEnabled: true, botDeliveryChargeMinor: 6000 });
    seedConversation(tables);
    seedMessage(tables, { id: "msg-text-1", type: "text", content: ORDER_TRANSCRIPT, mediaId: null });
    await svc.ingestChatMessage("org-1", "conv-1", "msg-text-1");
    expect(transcribeMock).not.toHaveBeenCalled();
    expect(getMediaMock).not.toHaveBeenCalled();
    const row = rowOf(tables, "msg-text-1");
    expect(row.transcription).toBeNull();
    expect(row.transcriptionStatus).toBeNull();
    // ...and the typed text still reaches the bot as before.
    expect(tables.botSession.rows).toHaveLength(1);
  });

  it("outbound audio: ignored by the auto path", async () => {
    transcribeMock.mockResolvedValue({ text: ORDER_TRANSCRIPT, modelProvider: "openai-whisper" });
    const { tables, svc } = await setup({ botEnabled: true });
    seedConversation(tables);
    seedMessage(tables, { id: "msg-audio-out", direction: "out" });
    await svc.ingestChatMessage("org-1", "conv-1", "msg-audio-out");
    expect(transcribeMock).not.toHaveBeenCalled();
    expect(getMediaMock).not.toHaveBeenCalled();
    expect(rowOf(tables, "msg-audio-out").transcriptionStatus).toBeNull();
  });

  it("tenant isolation: another org's dispatch never transcribes this org's voice note", async () => {
    transcribeMock.mockResolvedValue({ text: ORDER_TRANSCRIPT, modelProvider: "openai-whisper" });
    const { tables, svc } = await setup({ botEnabled: true });
    seedConversation(tables);
    seedMessage(tables);
    // Dispatch under org-2 for org-1's conversation/message ids:
    // ingestChatMessage resolves the conversation under org-2, finds
    // nothing, and returns without touching the row.
    await svc.ingestChatMessage("org-2", "conv-1", "msg-audio-1");
    expect(transcribeMock).not.toHaveBeenCalled();
    expect(rowOf(tables, "msg-audio-1").transcriptionStatus).toBeNull();
    // Direct dispatch guard: even if a caller hands the auto path a
    // conversation/message pair from another org, it refuses.
    const conv = tables.channelConversation.rows[0];
    const msg = tables.channelMessage.rows[0];
    const out = await (svc as any).autoTranscribeInbound("org-2", conv, msg);
    expect(out).toBeNull();
    expect(transcribeMock).not.toHaveBeenCalled();
    expect(rowOf(tables, "msg-audio-1").transcriptionStatus).toBeNull();
  });

  it("on-demand transcribeMessage still surfaces the honest config error to the agent (behaviour preserved)", async () => {
    transcribeMock.mockRejectedValue(new MediaIntelligenceError("এই ফিচারের জন্য একটি আসল AI provider দরকার"));
    const { tables, svc } = await setup();
    seedConversation(tables);
    seedMessage(tables);
    await expect(svc.transcribeMessage("org-1", "conv-1", "msg-audio-1")).rejects.toThrow("আসল AI provider দরকার");
  });

  it("on-demand transcribeMessage reuses the shared core: stores transcript + status done", async () => {
    transcribeMock.mockResolvedValue({ text: PRICE_TRANSCRIPT, modelProvider: "gemini" });
    const { tables, svc } = await setup();
    seedConversation(tables);
    seedMessage(tables);
    const out = await svc.transcribeMessage("org-1", "conv-1", "msg-audio-1");
    expect(out.transcription).toBe(PRICE_TRANSCRIPT);
    expect(out.provider).toBe("gemini");
    expect(out.intent).toBe("price");
    const row = rowOf(tables, "msg-audio-1");
    expect(row.transcriptionStatus).toBe("done");
    expect(row.transcriptionProvider).toBe("gemini");
  });
});
