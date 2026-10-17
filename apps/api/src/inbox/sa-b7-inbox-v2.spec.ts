import { createHmac } from "crypto";

process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.DISABLE_SCHEDULER = "true";

import { InboxService } from "./inbox.service";
import { OrgBrainService } from "../ai/org-brain.service";
import { AnswerStoreService } from "../ai/answer-store.service";
import { EmbeddingsService } from "../ai/embeddings.service";
import type { EmbeddingRowInput, EmbeddingRowMeta, VectorSearchHit, VectorSearchOptions, VectorStore } from "../ai/vector-store";
import { tokenize } from "./business-brain";
import { encryptJson } from "../integrations/crypto";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * SA-B7 (Smart AI Phase 1, R1): Inbox Reply v2.
 *
 * Part A — suggestDraft (CX1 compose-suggest) on the Brain:
 *  A1) the drafting prompt is assembled from OrgBrainService —
 *      the public knowledge match and THIS customer's memory are
 *      in it; internal docs, internal profile fields (goals /
 *      budget / target customers / USP) and ANOTHER customer's
 *      memory are not (L1/L3 sentinels);
 *  A2) an Answer Store hit becomes the suggested draft verbatim
 *      (provider "answer_store", zero LLM calls, zero-token
 *      usage row) — the FIRST suggestion is the stored answer;
 *  A3) a store miss takes the LLM path, and the dev-template
 *      fallback contract is unchanged.
 *
 * Part B — the order bot's Brain question branch (webhook flow):
 *  B1) a semantic product question at ask_product is answered
 *      from the Brain-grounded compose (semantic product match)
 *      with the step's re-ask appended and the state UNMOVED;
 *      the same at ask_quantity; the flow then completes and
 *      the confirmation shows ONLY what the customer typed —
 *      memory name/address sentinels never become order data;
 *  B2) with no real LLM the branch falls back to the exact
 *      pre-SA-B7 "বোঝা যায়নি" message.
 */

type Row = Record<string, any>;
const ORG = "org-1";
const PAST = new Date("2026-01-01T00:00:00Z");

// ----------------------------------------------------------------
// Shared in-memory prisma (the SA-B3 table pattern)
// ----------------------------------------------------------------
function match(row: Row, where: any = {}): boolean {
  return Object.entries(where ?? {}).every(([k, raw]) => {
    const v = raw as any;
    if (k === "organizationId_customerKey" && v && typeof v === "object") {
      return row.organizationId === v.organizationId && row.customerKey === v.customerKey;
    }
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v.in as any[]).includes(row[k]);
      if ("not" in v) return row[k] !== v.not;
      if ("gte" in v) return new Date(row[k]).getTime() >= new Date(v.gte).getTime();
      if ("lt" in v) return new Date(row[k]).getTime() < new Date(v.lt).getTime();
      return true;
    }
    return row[k] === v;
  });
}
function applyData(row: Row, data: any) {
  for (const [k, v] of Object.entries(data ?? {})) {
    if (v !== null && typeof v === "object" && "increment" in (v as any)) row[k] = (row[k] ?? 0) + (v as any).increment;
    else row[k] = v;
  }
}
function table(store: Row[], name: string) {
  return {
    rows: store,
    findMany: jest.fn(async ({ where, take, orderBy }: any = {}) => {
      let rows = store.filter((r) => match(r, where));
      if (orderBy?.createdAt === "desc") rows = [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (orderBy?.createdAt === "asc") rows = [...rows].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      return take ? rows.slice(0, take) : rows;
    }),
    findFirst: jest.fn(async ({ where, orderBy }: any = {}) => {
      let rows = store.filter((r) => match(r, where));
      if (orderBy?.createdAt === "desc") rows = [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return rows[0] ?? null;
    }),
    findUnique: jest.fn(async ({ where }: any = {}) => store.find((r) => match(r, where)) ?? null),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `${name}-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      store.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = store.find((r) => r.id === where.id || match(r, where));
      if (!row) throw new Error("nf");
      applyData(row, data);
      row.updatedAt = new Date();
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let n = 0;
      for (const r of store) if (match(r, where)) { applyData(r, data); n++; }
      return { count: n };
    }),
    count: jest.fn(async ({ where }: any = {}) => store.filter((r) => match(r, where)).length),
    upsert: jest.fn(async ({ where, create, update }: any) => {
      const key = where.organizationId_normalizedQuestion_channel;
      if (key) {
        const existing = store.find(
          (r) => r.organizationId === key.organizationId && r.normalizedQuestion === key.normalizedQuestion && r.channel === key.channel,
        );
        if (existing) { applyData(existing, update); existing.updatedAt = new Date(); return existing; }
      }
      const row = { id: `${name}-${store.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      store.push(row);
      return row;
    }),
  };
}

const TABLE_NAMES = [
  "inboxSetting", "channelConversation", "channelMessage", "messageDraft", "product", "order",
  "orderItem", "customer", "businessPolicy", "businessProfile", "knowledgeDocument", "organization",
  "membership", "agentNotification", "botSession", "integration", "conversationNote",
  "aiUnansweredQuestion", "aIUsageRecord", "quickReply", "inboxTeam", "inboxTeamMember",
  "customerMemory", "aiBrandVoiceProfile", "aiStoredAnswer", "performanceSnapshot", "lead", "leadActivity",
];
function makeDb() {
  const stores: Record<string, Row[]> = {};
  const db: Record<string, any> = {};
  for (const n of TABLE_NAMES) { stores[n] = []; db[n] = table(stores[n], n); }
  db.$queryRaw = jest.fn(async () => []);
  db.$executeRaw = jest.fn(async () => 1);
  return { db, stores };
}
const auditStub = () => ({ calls: [] as any[], log: jest.fn(async (e: any) => undefined) });

// ----------------------------------------------------------------
// Part A — suggestDraft
// ----------------------------------------------------------------
const QUESTION_A = "সেনসিটিভ ত্বকের জন্য কোন পোশাক ভালো?";

function draftSetup(llmProvider: any) {
  const { db, stores } = makeDb();
  stores.organization.push({ id: ORG, name: "টেস্ট শপ" });
  stores.businessProfile.push({
    id: "prof-1", organizationId: ORG, industry: "fashion", description: "Clothing store", brandVoice: "friendly",
    goals: "GOAL_SENTINEL_X", targetCustomers: "TARGET_SENTINEL_X", uniqueSellingPoints: "USP_SENTINEL_X",
    monthlyBudgetMinor: 12345600n, businessModel: null, tradeLicenseNo: null, billingEmails: null,
    deliveryChargeInsideMinor: 6000n, deliveryChargeOutsideMinor: 12000n, codAvailable: true, bkashNumber: "01712345678",
    aiInstructions: null, aiReplyLanguage: null, createdAt: PAST, updatedAt: PAST,
  });
  stores.knowledgeDocument.push(
    { id: "doc-pub", organizationId: ORG, kind: "faq", visibility: "public", title: "Sensitive Skin Care", content: "PUBLIC_DOC_FACT: সেনসিটিভ ত্বকের যত্নে খাঁটি সুতির পোশাক আরামদায়ক।", createdAt: PAST, updatedAt: PAST },
    { id: "doc-int", organizationId: ORG, kind: "note", visibility: "internal", title: "Internal note", content: "INTERNAL_DOC_SENTINEL wholesale margin note", createdAt: PAST, updatedAt: PAST },
  );
  stores.product.push({ id: "p1", organizationId: ORG, status: "ACTIVE", name: "Cotton Panjabi", priceMinor: 150000n, currency: "BDT", stockQuantity: 12 });
  stores.customerMemory.push(
    {
      id: "mem-a", organizationId: ORG, customerKey: "whatsapp:8801711111111", displayName: "Rahim", languagePref: "bn",
      topics: [{ productId: null, name: "MEMORY_A_PRODUCT", via: "asked" }], orderCount: 2, lastOrderAt: PAST, notes: [], lastInteractionAt: PAST,
      createdAt: PAST, updatedAt: PAST,
    },
    {
      id: "mem-b", organizationId: ORG, customerKey: "whatsapp:8801799999999", displayName: "Other", languagePref: "bn",
      topics: [{ productId: null, name: "MEMORY_B_SENTINEL", via: "asked" }], orderCount: 1, lastOrderAt: PAST, notes: [], lastInteractionAt: PAST,
      createdAt: PAST, updatedAt: PAST,
    },
  );
  const convA: Row = {
    id: "conv-a", organizationId: ORG, channel: "whatsapp", externalContactId: "8801711111111",
    status: "open", assignedUserId: null, priority: "normal", autoReplyPaused: false, customerId: null,
    createdAt: new Date(), lastMessageAt: new Date(),
  };
  stores.channelConversation.push(convA);
  stores.channelMessage.push({
    id: "in-a", conversationId: "conv-a", direction: "in", type: "text", content: QUESTION_A, status: "received", createdAt: new Date(),
  });

  const llm = { getProvider: () => llmProvider };
  const brain = new OrgBrainService(db as any);
  const answerStore = new AnswerStoreService(db as any);
  const service = new InboxService(
    db as any, auditStub() as any, llm as any,
    undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined,
    brain as any, answerStore as any,
  );
  return { service, db, stores, answerStore };
}

describe("SA-B7 suggestDraft on the Brain (R1)", () => {
  it("A1: the prompt is Brain-assembled — public knowledge + own memory in; internal + foreign sentinels out", async () => {
    const calls: any[] = [];
    const llmProvider = {
      name: "fake-llm", isRealLlm: true,
      complete: jest.fn(async (msgs: any) => { calls.push(msgs); return { text: "খসড়া উত্তর — LLM DRAFT TEXT", inputTokens: 10, outputTokens: 5, tokensEstimated: false }; }),
    };
    const { service, stores } = draftSetup(llmProvider);
    const draft = await service.suggestDraft(ORG, "agent-1", "conv-a");
    expect(llmProvider.complete).toHaveBeenCalledTimes(1);
    expect(draft.content).toBe("খসড়া উত্তর — LLM DRAFT TEXT");
    expect(draft.provider).toBe("fake-llm");
    expect(draft.status).toBe("suggested");

    const prompt = calls[0].map((m: any) => String(m.content)).join("\n");
    // Brain surfaces present:
    expect(prompt).toContain("PUBLIC_DOC_FACT");
    expect(prompt).toContain("MEMORY_A_PRODUCT");
    // L3/L1 sentinels absent:
    expect(prompt).not.toContain("INTERNAL_DOC_SENTINEL");
    expect(prompt).not.toContain("GOAL_SENTINEL_X");
    expect(prompt).not.toContain("TARGET_SENTINEL_X");
    expect(prompt).not.toContain("USP_SENTINEL_X");
    expect(prompt).not.toContain("MEMORY_B_SENTINEL");
    // Nothing was sent — a draft is a suggestion only.
    expect(stores.channelMessage.filter((m) => m.direction === "out")).toHaveLength(0);
  });

  it("A2: an Answer Store hit is the suggested draft — verbatim, labelled, zero LLM calls", async () => {
    const llmProvider = {
      name: "fake-llm", isRealLlm: true,
      complete: jest.fn(async () => ({ text: "LLM SHOULD NOT BE CALLED", inputTokens: 1, outputTokens: 1, tokensEstimated: false })),
    };
    const { service, stores, answerStore } = draftSetup(llmProvider);
    const stored = await answerStore.store(ORG, {
      question: "ডেলিভারি চার্জ কত?",
      answer: "ঢাকার ভিতরে ডেলিভারি চার্জ ৬০ টাকা।",
      channel: "inbox", language: "bn",
      sourceRefs: { profileAreas: ["delivery"] },
      origin: "staff_approved",
    });
    expect(stored.stored).toBe(true);

    stores.channelMessage.push({
      id: "in-a2", conversationId: "conv-a", direction: "in", type: "text", content: "ডেলিভারি চার্জ কত?", status: "received", createdAt: new Date(Date.now() + 1000),
    });
    const draft = await service.suggestDraft(ORG, "agent-1", "conv-a");
    expect(draft.content).toBe("ঢাকার ভিতরে ডেলিভারি চার্জ ৬০ টাকা।");
    expect(draft.provider).toBe("answer_store");
    expect(llmProvider.complete).not.toHaveBeenCalled();
    const usage = stores.aIUsageRecord.filter((u) => u.feature === "draft");
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ provider: "answer_store", inputTokens: 0, outputTokens: 0 });
    expect(stores.aiStoredAnswer[0].hitCount).toBe(1);
  });

  it("A3: dev-template fallback contract unchanged (grounded template, never sent)", async () => {
    const { service, stores } = draftSetup(new DevTemplateProvider());
    stores.channelMessage[0].content = "Cotton Panjabi এর দাম কত?";
    const draft = await service.suggestDraft(ORG, "agent-1", "conv-a");
    expect(draft.provider).toBe("dev-template");
    expect(draft.content).toContain("1500.00");
    expect(stores.channelMessage.filter((m) => m.direction === "out")).toHaveLength(0);
  });
});

// ----------------------------------------------------------------
// Part B — order bot question branch (webhook harness, after M15)
// ----------------------------------------------------------------
const DIM = 256;
function fakeVector(text: string): number[] {
  const v = new Array(DIM).fill(0);
  for (const tok of tokenize(text)) {
    let h = 0;
    for (const ch of tok) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % DIM] += 1;
  }
  return v;
}
class FakeEmbeddings extends EmbeddingsService {
  constructor() { super(undefined); }
  override async embedOne(_org: string, text: string): Promise<any> {
    return { ok: true, vectors: [fakeVector(text)], provider: "test", model: "fake-embed-1", dimension: DIM, inputTokens: 1, tokensEstimated: true };
  }
}
class InMemoryStore implements VectorStore {
  rows: (EmbeddingRowMeta & { embedding: number[] })[] = [];
  seed(row: EmbeddingRowMeta & { embedding: number[] }) { this.rows.push(row); }
  async listBySource(): Promise<EmbeddingRowMeta[]> { return []; }
  async insertRows(rows: EmbeddingRowInput[]): Promise<number> { for (const r of rows) this.rows.push({ ...r, id: `seed-${this.rows.length}` }); return rows.length; }
  async deleteByIds(): Promise<number> { return 0; }
  async deleteBySource(): Promise<number> { return 0; }
  async search(org: string, qv: number[], opts: VectorSearchOptions): Promise<VectorSearchHit[]> {
    const qn = Math.sqrt(qv.reduce((s, n) => s + n * n, 0)) || 1;
    return this.rows
      .filter((r) => r.organizationId === org && r.provider === opts.provider && r.model === opts.model && r.dimension === qv.length)
      .filter((r) => !opts.sourceTypes || opts.sourceTypes.includes(r.sourceType))
      .filter((r) => opts.audience === "internal" || r.visibility === "public")
      .map((r) => {
        const dn = Math.sqrt(r.embedding.reduce((s, n) => s + n * n, 0)) || 1;
        const dot = r.embedding.reduce((s, n, i) => s + n * qv[i], 0);
        return { id: r.id, sourceType: r.sourceType, sourceId: r.sourceId, chunkIndex: r.chunkIndex, content: r.content, visibility: r.visibility, similarity: dot / (qn * dn) };
      })
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, opts.limit);
  }
}

const PRODUCT_CHUNK = "খাঁটি সুতির পাঞ্জাবি — সেনসিটিভ ত্বকের জন্য আরামদায়ক, গরমে ঘাম শোষণ করে, প্রতিদিনের ব্যবহারে টেকসই।";
const BOT_QUESTION = "সেনসিটিভ ত্বকের জন্য আরামদায়ক কোনটা হবে?";
const BOT_ANSWER = "জি, এই পাঞ্জাবিটি খাঁটি সুতির — সেনসিটিভ ত্বকের জন্য আরামদায়ক।";

function botSetup(llmProvider: any, withBrain: boolean) {
  const { db, stores } = makeDb();
  const secrets = encryptJson({ accessToken: "tok", appSecret: "appsecret", verifyToken: "vtok", phoneNumberId: "999" });
  stores.integration.push({ id: "int-1", organizationId: ORG, provider: "whatsapp", status: "CONNECTED", credential: { encryptedData: secrets } });
  stores.businessProfile.push({
    id: "prof-1", organizationId: ORG, industry: "fashion", description: "Clothing store", brandVoice: null,
    deliveryChargeInsideMinor: 6000n, deliveryChargeOutsideMinor: 12000n, createdAt: PAST, updatedAt: PAST,
  });
  stores.organization.push({ id: ORG, name: "টেস্ট শপ" });
  stores.product.push(
    { id: "p1", organizationId: ORG, status: "ACTIVE", name: "Cotton Panjabi", priceMinor: 150000n, currency: "BDT", stockQuantity: 12, createdAt: new Date(1) },
    { id: "p2", organizationId: ORG, status: "ACTIVE", name: "Silk Saree", priceMinor: 450000n, currency: "BDT", stockQuantity: 5, createdAt: new Date(2) },
  );
  // The sender's memory: context-only material. Its name/address
  // sentinels must NEVER become bot order data.
  stores.customerMemory.push({
    id: "mem-1", organizationId: ORG, customerKey: "whatsapp:8801711111111", displayName: "MEMORY_NAME_SENTINEL", languagePref: "bn",
    topics: [{ productId: "p2", name: "Silk Saree", via: "ordered" }], orderCount: 3, lastOrderAt: PAST,
    notes: [{ kind: "note", text: "MEMORY_ADDR_SENTINEL বাসা ৯৯, গোপন রোড", conversationId: "c-old", at: null }],
    lastInteractionAt: PAST, createdAt: PAST, updatedAt: PAST,
  });

  const llm = { getProvider: () => llmProvider };
  let brain: OrgBrainService | undefined;
  if (withBrain) {
    const store = new InMemoryStore();
    store.seed({
      id: "emb-p1", organizationId: ORG, sourceType: "product", sourceId: "p1", chunkIndex: 0,
      content: PRODUCT_CHUNK, contentHash: "h", provider: "test", model: "fake-embed-1", dimension: DIM,
      visibility: "public", embedding: fakeVector(PRODUCT_CHUNK),
    });
    brain = new OrgBrainService(db as any, new FakeEmbeddings(), store);
  }
  const service = new InboxService(
    db as any, auditStub() as any, llm as any,
    undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined,
    brain as any, undefined,
  );
  return { service, db, stores };
}

const sign = (body: string) => "sha256=" + createHmac("sha256", "appsecret").update(body, "utf8").digest("hex");
let msgSeq = 0;
async function inbound(svc: InboxService, from: string, body: string) {
  const raw = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: {
      contacts: [{ profile: { name: "Karim" }, wa_id: from }],
      messages: [{ from, id: `wamid.b${++msgSeq}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }],
    } }] }],
  });
  await svc.handleWebhook("int-1", raw, sign(raw));
}

describe("SA-B7 order bot Brain question branch (R1)", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  function groundedProvider() {
    return {
      name: "fake-llm", isRealLlm: true,
      complete: jest.fn(async (msgs: any) => {
        const sys = String(msgs[0].content);
        if (sys.includes("সেনসিটিভ ত্বকের জন্য আরামদায়ক")) {
          return { text: BOT_ANSWER, inputTokens: 10, outputTokens: 5, tokensEstimated: false };
        }
        return { text: "NO_ANSWER", inputTokens: 10, outputTokens: 1, tokensEstimated: false };
      }),
    };
  }

  it("B1: mid-order questions are Brain-answered, state unmoved, memory never becomes order data", async () => {
    global.fetch = (async () => new Response(JSON.stringify({ messages: [{ id: `wamid.s${Math.random()}` }] }), { status: 200 })) as any;
    const provider = groundedProvider();
    const { service, stores } = botSetup(provider, true);
    await service.updateSettings(ORG, "owner", { botEnabled: true, botDeliveryChargeMinor: 6000 });
    const outTexts = () => stores.channelMessage.filter((m) => m.direction === "out" && m.status === "sent").map((m) => m.content as string);
    const session = () => stores.botSession[0];

    await inbound(service, "8801711111111", "আমি অর্ডার করতে চাই");
    expect(session().state).toBe("ask_product");

    // A semantic product question — no product name, no number:
    // the state machine cannot parse it; the Brain answers.
    await inbound(service, "8801711111111", BOT_QUESTION);
    const answerMsg = outTexts().at(-1)!;
    expect(answerMsg).toContain(BOT_ANSWER);
    expect(answerMsg).toContain("পণ্যের নম্বরটি লিখুন"); // the step's re-ask rides along
    expect(session().state).toBe("ask_product"); // state unmoved
    // Memory was context for the compose — never order data:
    expect(session().data?.name).toBeUndefined();
    expect(session().data?.phone).toBeUndefined();
    expect(session().data?.address).toBeUndefined();

    // Choose the product, then ask about it again at ask_quantity.
    await inbound(service, "8801711111111", "1");
    expect(session().state).toBe("ask_quantity");
    await inbound(service, "8801711111111", BOT_QUESTION);
    expect(outTexts().at(-1)).toContain(BOT_ANSWER);
    expect(outTexts().at(-1)).toContain("কয়টি নিতে চান");
    expect(session().state).toBe("ask_quantity");

    // The transactional walk is untouched and completes.
    await inbound(service, "8801711111111", "২");
    expect(session().state).toBe("ask_more");
    await inbound(service, "8801711111111", "শেষ");
    await inbound(service, "8801711111111", "Rahim Uddin");
    await inbound(service, "8801711111111", "01711111111");
    await inbound(service, "8801711111111", "বাসা ৫, রোড ২, মিরপুর ১০, ঢাকা");
    expect(session().state).toBe("confirm");
    const summary = outTexts().at(-1)!;
    expect(summary).toContain("Rahim Uddin");
    expect(summary).toContain("01711111111");
    expect(summary).toContain("বাসা ৫");
    expect(summary).not.toContain("MEMORY_NAME_SENTINEL");
    expect(summary).not.toContain("MEMORY_ADDR_SENTINEL");
    await inbound(service, "8801711111111", "হ্যাঁ");
    expect(stores.order).toHaveLength(1);
    expect(stores.customer[0].firstName).toBe("Rahim Uddin");
    expect(stores.customer[0].phone).toBe("01711111111");
    // The bot's grounded answers were metered under their own label.
    expect(stores.aIUsageRecord.some((u) => u.feature === "order_bot")).toBe(true);
  });

  it("B2: no real LLM -> the exact pre-SA-B7 fallback message, state unmoved", async () => {
    global.fetch = (async () => new Response(JSON.stringify({ messages: [{ id: "wamid.z" }] }), { status: 200 })) as any;
    const { service, stores } = botSetup(new DevTemplateProvider(), false);
    await service.updateSettings(ORG, "owner", { botEnabled: true, botDeliveryChargeMinor: 6000 });
    await inbound(service, "8801711111111", "আমি অর্ডার করতে চাই");
    await inbound(service, "8801711111111", "আজব কথা বললাম");
    const last = stores.channelMessage.filter((m) => m.direction === "out" && m.status === "sent").at(-1);
    expect(last!.content).toBe("দুঃখিত, কোন পণ্য বোঝা যায়নি। তালিকার নম্বরটি লিখুন (যেমন: 1)।");
    expect(stores.botSession[0].state).toBe("ask_product");
  });
});
