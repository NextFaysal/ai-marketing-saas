import { InboxService } from "./inbox.service";
import { AnswerStoreService, normalizeQuestion } from "../ai/answer-store.service";

/**
 * SA-B3 (Smart AI Phase 0, P4): Answer Store inbox integration.
 *
 * The full autopilot loop against fakes (the U3/CX11ac harness
 * pattern + the Answer Store's pgvector simulation, shared with
 * answer-store.spec.ts):
 *  1) a guard-passed LLM-tier answer that is SENT is captured
 *     into the store (origin autopilot_grounded, pack sources);
 *  2) the same question in a NEW conversation is then served
 *     from the store with ZERO LLM calls (provider spy), marked
 *     tier "answer_store" in the message evidence, and a
 *     zero-token "answer_store_hit" usage row is recorded;
 *  3) a below-threshold paraphrase misses and the LLM composes;
 *  4) order_status answers are NEVER stored (customer-own);
 *  5) a staff-edited autopilot draft send is captured as
 *     origin "staff_edited"; unedited sends and non-autopilot
 *     drafts are not.
 */

type Row = Record<string, any>;
const ORG = "org-1";
const PAST = new Date("2026-01-01T00:00:00Z");

function match(row: Row, where: any = {}): boolean {
  return Object.entries(where ?? {}).every(([k, raw]) => {
    const v = raw as any;
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
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let n = 0;
      for (const r of store) if (match(r, where)) { applyData(r, data); n++; }
      return { count: n };
    }),
    count: jest.fn(async ({ where }: any = {}) => store.filter((r) => match(r, where)).length),
  };
}

function cosine(a: number[], b: number[]): number {
  const dot = a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);
  const na = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
  const nb = Math.sqrt(b.reduce((s, x) => s + x * x, 0));
  return na && nb ? dot / (na * nb) : 0;
}

const EMBEDDINGS: Record<string, number[]> = {
  [normalizeQuestion("ডেলিভারি চার্জ কত?")]: [1, 0, 0],
  [normalizeQuestion("ডেলিভারি খরচ কেমন হবে")]: [0.5, Math.sqrt(1 - 0.25), 0], // cosine 0.50 vs the stored question
};

function setup(llmProvider?: any) {
  const stores: Record<string, Row[]> = {};
  const names = [
    "inboxSetting", "channelConversation", "channelMessage", "messageDraft", "product", "order",
    "orderItem", "customer", "businessPolicy", "businessProfile", "knowledgeDocument", "organization",
    "membership", "agentNotification", "botSession", "integration", "conversationNote",
    "aiUnansweredQuestion", "aIUsageRecord", "quickReply", "inboxTeam", "inboxTeamMember",
  ];
  for (const n of names) stores[n] = [];
  const answers: Row[] = [];
  stores.aiStoredAnswer = answers;
  stores.inboxSetting.push({
    id: "s1", organizationId: ORG, autoReplyMode: "auto", confidenceThreshold: 70, perIntent: {},
    smartAssign: "off", slaFirstResponseMinutes: 60, perChannelModes: {}, escalationThresholdMinor: null,
  });
  stores.organization.push({ id: ORG, name: "টেস্ট শপ" });
  stores.businessProfile.push({
    id: "prof-1", organizationId: ORG, deliveryChargeInsideMinor: 6000n, deliveryChargeOutsideMinor: 12000n,
    deliveryDaysInside: null, deliveryDaysOutside: null, codAvailable: true, bkashNumber: "01712345678",
    createdAt: PAST, updatedAt: PAST,
  });
  stores.membership.push({ id: "m1", organizationId: ORG, userId: "agent-1", role: "SUPPORT_AGENT", user: { id: "agent-1", name: "এজেন্ট", email: "a@x" } });

  const db: Record<string, any> = {};
  for (const n of names) db[n] = table(stores[n], n);
  db.aiStoredAnswer = {
    ...table(answers, "ans"),
    upsert: jest.fn(async ({ where, create, update }: any) => {
      const key = where.organizationId_normalizedQuestion_channel;
      const existing = answers.find(
        (r) => r.organizationId === key.organizationId && r.normalizedQuestion === key.normalizedQuestion && r.channel === key.channel,
      );
      if (existing) {
        applyData(existing, update);
        existing.updatedAt = new Date();
        return existing;
      }
      const row = { id: `ans-${answers.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      answers.push(row);
      return row;
    }),
  };
  db.$queryRaw = jest.fn(async (sql: any) => {
    const values = sql.values as any[];
    const vector = JSON.parse(values[0]) as number[];
    const [, organizationId, channel, provider, model, dimension] = values;
    return answers
      .filter(
        (r) =>
          r.organizationId === organizationId && r.status === "active" && r.channel === channel &&
          r.provider === provider && r.model === model && r.dimension === dimension && Array.isArray(r._vector),
      )
      .map((r) => ({ id: r.id, similarity: cosine(vector, r._vector) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);
  });
  db.$executeRaw = jest.fn(async (sql: any) => {
    const text = (sql.strings as string[]).join(" ");
    const values = sql.values as any[];
    const hasVector = text.includes("::vector");
    const id = hasVector ? values[1] : values[0];
    const row = answers.find((r) => r.id === id);
    if (!row) return 0;
    row._vector = hasVector ? (JSON.parse(values[0]) as number[]) : null;
    return 1;
  });

  const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
  const llm = { getProvider: () => { if (!llmProvider) throw new Error("no provider configured"); return llmProvider; } };
  const embeddings: any = {
    embedOne: jest.fn(async (_org: string, text: string) => {
      const v = EMBEDDINGS[text] ?? [0, 0, 1];
      return { ok: true, vectors: [v], provider: "fake", model: "fake-embed", dimension: v.length, inputTokens: 1, tokensEstimated: false };
    }),
  };
  const answerStore = new AnswerStoreService(db as any, embeddings);
  const service = new InboxService(
    db as any, audit as any, llm as any,
    undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined,
    answerStore as any,
  );
  // Force the LLM tier (the deterministic tier is covered by U3).
  (service as any).composeGroundedReply = async () => null;
  return { service, db, audit, stores, answers, answerStore };
}

function conv(over: Row = {}): Row {
  return {
    id: `c-${Math.random().toString(36).slice(2, 8)}`, organizationId: ORG, channel: "webchat", status: "open",
    assignedUserId: null, priority: "normal", autoReplyPaused: false, customerId: null, contactName: "রহিম",
    createdAt: new Date(), lastMessageAt: new Date(), firstResponseAt: null, ...over,
  };
}
const CLS = (intent: string, confidence = 95, sentiment: string | null = null) => ({ intent, confidence, sentiment } as any);
const flush = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
const until = async (cond: () => boolean) => { for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setImmediate(r)); };

const provider = (text: string) => ({
  name: "fake-llm", isRealLlm: true,
  complete: jest.fn(async () => ({ text, inputTokens: 10, outputTokens: 5, tokensEstimated: false })),
});

describe("SA-B3 autopilot: store after send, serve without LLM", () => {
  it("first answer is composed by the LLM and captured; the repeat is served from the store with ZERO LLM calls", async () => {
    const llm = provider("ঢাকার ভিতরে ডেলিভারি চার্জ ৬০ টাকা এবং বাইরে ১২০ টাকা।");
    const s = setup(llm);
    const c1 = conv(); s.stores.channelConversation.push(c1);
    await (s.service as any).maybeAutoReply(ORG, c1, CLS("delivery"), "ডেলিভারি চার্জ কত?");
    expect(llm.complete).toHaveBeenCalledTimes(1);
    const sent1 = s.stores.channelMessage.filter((m) => m.autoReply && m.status === "sent");
    expect(sent1).toHaveLength(1);
    expect(JSON.parse(sent1[0].autoReplyEvidence).tier).toBe("llm");

    await until(() => s.answers.length === 1);
    expect(s.answers).toHaveLength(1);
    expect(s.answers[0]).toMatchObject({ origin: "autopilot_grounded", status: "active", containsLiveFacts: true });
    expect(s.answers[0].sourceRefs.profileAreas).toContain("delivery");
    expect(s.answers[0].hitCount).toBe(0);

    // Second conversation, same question: the store serves it.
    llm.complete.mockClear();
    const c2 = conv(); s.stores.channelConversation.push(c2);
    await (s.service as any).maybeAutoReply(ORG, c2, CLS("delivery"), "ডেলিভারি চার্জ কত?");
    expect(llm.complete).not.toHaveBeenCalled();
    const sent2 = s.stores.channelMessage.filter((m) => m.autoReply && m.status === "sent" && m.conversationId === c2.id);
    expect(sent2).toHaveLength(1);
    const evidence = JSON.parse(sent2[0].autoReplyEvidence);
    expect(evidence.tier).toBe("answer_store");
    expect(evidence.answerStoreHit).toBe(true);
    expect(evidence.answerStoreId).toBe(s.answers[0].id);
    expect(sent2[0].content).toBe("ঢাকার ভিতরে ডেলিভারি চার্জ ৬০ টাকা এবং বাইরে ১২০ টাকা।");
    expect(s.answers[0].hitCount).toBe(1);
    const usage = s.stores.aIUsageRecord.filter((u) => u.feature === "answer_store_hit");
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ inputTokens: 0, outputTokens: 0, provider: "answer_store" });
  });

  it("below-threshold paraphrase misses the store and the LLM composes (spy proves the path)", async () => {
    const llm = provider("ঢাকার ভিতরে ডেলিভারি চার্জ ৬০ টাকা এবং বাইরে ১২০ টাকা।");
    const s = setup(llm);
    const c1 = conv(); s.stores.channelConversation.push(c1);
    await (s.service as any).maybeAutoReply(ORG, c1, CLS("delivery"), "ডেলিভারি চার্জ কত?");
    await until(() => s.answers.length === 1);
    expect(s.answers).toHaveLength(1);

    llm.complete.mockClear();
    const c2 = conv(); s.stores.channelConversation.push(c2);
    await (s.service as any).maybeAutoReply(ORG, c2, CLS("delivery"), "ডেলিভারি খরচ কেমন হবে");
    expect(llm.complete).toHaveBeenCalledTimes(1);
    const sent2 = s.stores.channelMessage.filter((m) => m.autoReply && m.status === "sent" && m.conversationId === c2.id);
    expect(sent2).toHaveLength(1);
    expect(JSON.parse(sent2[0].autoReplyEvidence).tier).toBe("llm");
    expect(s.answers[0].hitCount).toBe(0); // the stored entry was never served
  });

  it("order_status answers are never stored (customer-own), though the reply itself is sent", async () => {
    const llm = provider("আপনার অর্ডারটি প্রস্তুত হচ্ছে, শীঘ্রই কুরিয়ারে দেওয়া হবে।");
    const s = setup(llm);
    s.stores.order.push({
      id: "o1", organizationId: ORG, customerId: "cust-1", externalNumber: "1024", status: "processing",
      totalMinor: 50000n, currency: "BDT", createdAt: new Date(),
    });
    const c = conv({ customerId: "cust-1" }); s.stores.channelConversation.push(c);
    await (s.service as any).maybeAutoReply(ORG, c, CLS("order_status"), "আমার অর্ডারের অবস্থা কি?");
    const sent = s.stores.channelMessage.filter((m) => m.autoReply && m.status === "sent");
    expect(sent).toHaveLength(1); // the customer got their answer
    await flush();
    expect(s.answers).toHaveLength(0); // ...but nothing was stored
  });
});

describe("SA-B3 staff-edit capture (sendDraft)", () => {
  function draftSetup(providerName: string, draftContent: string) {
    const s = setup(provider("unused"));
    const c = conv(); s.stores.channelConversation.push(c);
    s.stores.channelMessage.push({
      id: "in-1", conversationId: c.id, direction: "in", type: "text", content: "ডেলিভারি চার্জ কত?",
      intent: "delivery", status: "received", createdAt: new Date(),
    });
    const draft = {
      id: "d-1", organizationId: ORG, conversationId: c.id, content: draftContent,
      provider: providerName, status: "suggested", createdByUserId: null, createdAt: new Date(),
    };
    s.stores.messageDraft.push(draft);
    return { s, c, draft };
  }

  it("an edited autopilot draft send is captured as staff_edited and then served by lookup", async () => {
    const { s, c, draft } = draftSetup("auto-reply", "ডেলিভারি চার্জ ৬০ টাকা।");
    const edited = "ঢাকার ভিতরে ডেলিভারি চার্জ ৬০ টাকা, বাইরে ১২০ টাকা।";
    await s.service.sendDraft(ORG, "agent-1", c.id, draft.id, edited);
    await until(() => s.answers.length === 1);
    expect(s.answers).toHaveLength(1);
    expect(s.answers[0]).toMatchObject({ origin: "staff_edited", questionText: "ডেলিভারি চার্জ কত?" });
    expect(s.answers[0].answerText).toBe(edited);
    const hit = await s.answerStore.lookup(ORG, "ডেলিভারি চার্জ কত?");
    expect(hit.hit).toBe(true);
    if (hit.hit) expect(hit.answer).toBe(edited);
  });

  it("unedited autopilot draft sends and edited NON-autopilot drafts are not captured", async () => {
    const a = draftSetup("auto-reply", "ডেলিভারি চার্জ ৬০ টাকা।");
    await a.s.service.sendDraft(ORG, "agent-1", a.c.id, a.draft.id); // no edit
    await flush();
    expect(a.s.answers).toHaveLength(0);

    const b = draftSetup("openai", "ডেলিভারি চার্জ ৬০ টাকা।"); // compose-suggest path provider
    await b.s.service.sendDraft(ORG, "agent-1", b.c.id, b.draft.id, "ঢাকার ভিতরে ডেলিভারি চার্জ ৬০ টাকা।");
    await flush();
    expect(b.s.answers).toHaveLength(0);
  });
});
