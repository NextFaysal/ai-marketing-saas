import { LearningService, learnedItemDedupeKey, defaultApprovalVisibility } from "./learning.service";
import { WebsiteLearningService, isPrivateOrReservedIp } from "./website-learning.service";
import { ConversationMiningService, parseExtraction } from "./conversation-mining.service";
import { AnswerStoreService } from "./answer-store.service";
import { KnowledgeIndexingService } from "./knowledge-indexing.service";
import { EmbeddingsService } from "./embeddings.service";
import type { EmbeddingRowInput, EmbeddingRowMeta, VectorSearchHit, VectorStore } from "./vector-store";

/**
 * SA-B4 (Smart AI Phase 0, P5/P6) — learning guarantees:
 *  - D4 opt-in gate: mining an org whose conversationLearning
 *    is OFF makes ZERO provider resolutions and ZERO LLM calls.
 *  - PII: sentinel phone/order data in a conversation never
 *    reaches the extraction prompt unmasked and never lands in
 *    any stored LearnedItem field.
 *  - D3 suggested-only: mining writes LearnedItems and NOTHING
 *    else (Answer Store + KnowledgeDocuments stay empty) until
 *    a human approves; approval applies exactly one item, with
 *    the recorded visibility default.
 *  - L1 isolation: org A's mining/approval never touches org
 *    B's rows.
 *  - Website: private-IP seeds are refused before any fetch,
 *    cross-host links are never fetched, robots disallows are
 *    skipped, unchanged pages hash-skip on refresh.
 *  - P5a: indexed product text carries category/brand/tags/
 *    variants but NEVER a price or stock value.
 * All doubles below are TEST doubles; production code contains
 * no fabricated data paths.
 */

// ---------- in-memory fake prisma ----------
function cmpVal(v: any): any {
  return v instanceof Date ? v.getTime() : v;
}
function matchesWhere(row: any, where: any): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === "OR") {
      if (!(cond as any[]).some((c) => matchesWhere(row, c))) return false;
      continue;
    }
    if (key === "organizationId_dedupeKey") {
      const c = cond as any;
      if (row.organizationId !== c.organizationId || row.dedupeKey !== c.dedupeKey) return false;
      continue;
    }
    if (key === "organizationId_source") {
      const c = cond as any;
      if (row.organizationId !== c.organizationId || row.source !== c.source) return false;
      continue;
    }
    const val = row[key];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as any;
      if ("gt" in c && !(cmpVal(val) > cmpVal(c.gt))) return false;
      if ("gte" in c && !(cmpVal(val) >= cmpVal(c.gte))) return false;
      if ("in" in c && !c.in.includes(val)) return false;
      if ("not" in c && val === c.not) return false;
      continue;
    }
    if (val !== cond) return false;
  }
  return true;
}
function applyOrder(rows: any[], orderBy: any): any[] {
  const specs = (Array.isArray(orderBy) ? orderBy : [orderBy]).filter(Boolean);
  const out = [...rows];
  for (let i = specs.length - 1; i >= 0; i--) {
    const [field, dir] = Object.entries(specs[i])[0] as [string, string];
    out.sort((a, b) => {
      const av = cmpVal(a[field]) ?? 0;
      const bv = cmpVal(b[field]) ?? 0;
      return dir === "desc" ? (bv > av ? 1 : bv < av ? -1 : 0) : av > bv ? 1 : av < bv ? -1 : 0;
    });
  }
  return out;
}
function makeFakePrisma() {
  let seq = 0;
  const nid = () => `fake-${++seq}`;
  const tables: Record<string, any[]> = {
    businessProfile: [], learnedItem: [], learningState: [], knowledgeDocument: [],
    channelConversation: [], channelMessage: [], aiUnansweredQuestion: [], aiStoredAnswer: [],
    aIUsageRecord: [], category: [], brand: [], productTagAssignment: [], productVariant: [],
    auditLog: [],
  };
  const model = (name: string) => ({
    findMany: async (args: any = {}) => {
      let rows = tables[name].filter((r) => matchesWhere(r, args.where));
      if (args.orderBy) rows = applyOrder(rows, args.orderBy);
      if (args.skip) rows = rows.slice(args.skip);
      if (args.take) rows = rows.slice(0, args.take);
      return rows;
    },
    findFirst: async (args: any = {}) => {
      const rows = tables[name].filter((r) => matchesWhere(r, args.where));
      return rows[0] ?? null;
    },
    findUnique: async (args: any = {}) => {
      const rows = tables[name].filter((r) => matchesWhere(r, args.where));
      return rows[0] ?? null;
    },
    count: async (args: any = {}) => tables[name].filter((r) => matchesWhere(r, args.where)).length,
    create: async (args: any) => {
      // Schema @defaults the real client applies (the fake must
      // mirror them or rows differ from production shape).
      const schemaDefaults: Record<string, any> = name === "learnedItem" ? { status: "suggested" } : {};
      const row = { id: nid(), createdAt: new Date(), updatedAt: new Date(), ...schemaDefaults, ...args.data };
      tables[name].push(row);
      return row;
    },
    update: async (args: any) => {
      const row = tables[name].find((r) => r.id === args.where.id);
      if (!row) throw new Error("record not found");
      Object.assign(row, args.data, { updatedAt: new Date() });
      return row;
    },
    upsert: async (args: any) => {
      const existing = tables[name].find((r) => matchesWhere(r, args.where));
      if (existing) {
        Object.assign(existing, args.update, { updatedAt: new Date() });
        return existing;
      }
      const row = { id: nid(), createdAt: new Date(), updatedAt: new Date(), ...args.create };
      tables[name].push(row);
      return row;
    },
  });
  const prisma: any = { __tables: tables };
  for (const name of Object.keys(tables)) prisma[name] = model(name);
  return prisma;
}

const ORG_A = "org-a";
const ORG_B = "org-b";
const PHONE = "01712345678";

function makeLearningStack(prisma: any, storeImpl?: any, indexingImpl?: any) {
  const audit = { log: jest.fn(async () => undefined) };
  const store = storeImpl ?? {
    store: jest.fn(async () => ({ stored: true, entryId: "answer-1", replaced: false, vectorStored: false })),
    screenAnswerPii: jest.fn(async () => null),
  };
  const indexing = indexingImpl ?? { indexDocument: jest.fn(async () => ({ status: "indexed" })) };
  const learning = new LearningService(prisma as any, store as any, indexing as any, audit as any);
  return { learning, store, indexing, audit };
}

// ---------- LearningService: approval application ----------
describe("SA-B4 LearningService — approval application (D3)", () => {
  it("faq_pair approval applies to the Answer Store as staff_approved and stamps the item", async () => {
    const prisma = makeFakePrisma();
    const { learning, store, audit } = makeLearningStack(prisma);
    const { item } = await learning.createSuggestion(ORG_A, {
      kind: "faq_pair", title: "Delivery charge?",
      content: { question: "ডেলিভারি চার্জ কত?", answer: "ঢাকার ভিতরে ৬০ টাকা।" },
      sourceType: "conversation", sourceRef: ["conv-1"],
    });
    const approved = await learning.approve(ORG_A, "user-1", item.id);
    expect(store.store).toHaveBeenCalledWith(ORG_A, expect.objectContaining({ origin: "staff_approved" }));
    expect(approved.status).toBe("approved");
    expect(approved.appliedRef).toBe("answer:answer-1");
    expect(approved.reviewedById).toBe("user-1");
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: "learning.approve" }));
  });

  it("faq_pair approval SURFACES an Answer Store refusal and leaves the item suggested", async () => {
    const prisma = makeFakePrisma();
    const refusingStore = {
      store: jest.fn(async () => ({ stored: false, reason: "pii_phone_in_answer" })),
      screenAnswerPii: jest.fn(async () => null),
    };
    const { learning } = makeLearningStack(prisma, refusingStore);
    const { item } = await learning.createSuggestion(ORG_A, {
      kind: "faq_pair", title: "Q",
      content: { question: "নম্বর?", answer: `কল করুন ${PHONE}` },
      sourceType: "conversation", sourceRef: [],
    });
    await expect(learning.approve(ORG_A, "user-1", item.id)).rejects.toThrow(/pii_phone_in_answer/);
    const after = await learning.listItems(ORG_A, { status: "suggested" });
    expect(after.total).toBe(1);
    expect(after.items[0].appliedRef).toBeFalsy();
  });

  it("fact approval defaults: conversation -> internal note, website -> public note, product_note always internal", async () => {
    const prisma = makeFakePrisma();
    const { learning, indexing } = makeLearningStack(prisma);
    const mk = async (sourceType: any, kind: any = "fact") =>
      (await learning.createSuggestion(ORG_A, {
        kind, title: "t", content: { text: `ক্যাশ অন ডেলিভারি সারা দেশে আছে (${sourceType})।` },
        sourceType, sourceRef: [],
      })).item;
    const convFact = await mk("conversation");
    await learning.approve(ORG_A, "user-1", convFact.id);
    const webFact = await mk("website");
    await learning.approve(ORG_A, "user-1", webFact.id);
    const note = await mk("product", "product_note");
    await learning.approve(ORG_A, "user-1", note.id, { visibility: "public" });
    const docs = prisma.__tables.knowledgeDocument;
    expect(docs).toHaveLength(3);
    expect(docs.find((d: any) => d.source === "learned:conversation").visibility).toBe("internal");
    expect(docs.find((d: any) => d.source === "learned:website").visibility).toBe("public");
    expect(docs.find((d: any) => d.source === "learned:product").visibility).toBe("internal");
    expect(docs.every((d: any) => d.kind === "note")).toBe(true);
    expect(indexing.indexDocument).toHaveBeenCalledTimes(3);
    expect(defaultApprovalVisibility({ kind: "fact", sourceType: "unanswered" })).toBe("internal");
  });

  it("isolation + state discipline: org B cannot approve org A's item; double-approve and reject-after-approve fail", async () => {
    const prisma = makeFakePrisma();
    const { learning } = makeLearningStack(prisma);
    const { item } = await learning.createSuggestion(ORG_A, {
      kind: "fact", title: "t", content: { text: "তথ্য" }, sourceType: "conversation", sourceRef: [],
    });
    await expect(learning.approve(ORG_B, "user-9", item.id)).rejects.toThrow(/not found/i);
    await learning.reject(ORG_A, "user-1", item.id);
    await expect(learning.approve(ORG_A, "user-1", item.id)).rejects.toThrow(/already rejected/);
    expect(prisma.__tables.knowledgeDocument).toHaveLength(0);
  });

  it("dedupe wall: the same suggestion is never created twice (even after rejection)", async () => {
    const prisma = makeFakePrisma();
    const { learning } = makeLearningStack(prisma);
    const input = {
      kind: "faq_pair" as const, title: "t",
      content: { question: "দাম কত?", answer: "তালিকা দেখুন।" },
      sourceType: "conversation" as const, sourceRef: ["c1"],
    };
    const first = await learning.createSuggestion(ORG_A, input);
    const second = await learning.createSuggestion(ORG_A, { ...input, sourceRef: ["c2"] });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(learnedItemDedupeKey("faq_pair", { question: "দাম কত?!" })).toBe(
      learnedItemDedupeKey("faq_pair", { question: "দাম কত?" }),
    );
    // ...but the same content in ANOTHER org is a different row (L1).
    const other = await learning.createSuggestion(ORG_B, input);
    expect(other.created).toBe(true);
  });

  it("toggle defaults (D4): no profile => conversation OFF / website ON-inert; explicit opt-in reads through", async () => {
    const prisma = makeFakePrisma();
    const { learning } = makeLearningStack(prisma);
    expect(await learning.getToggles(ORG_A)).toEqual({
      conversationLearningEnabled: false, websiteLearningEnabled: true, websiteUrl: null,
    });
    prisma.__tables.businessProfile.push({
      id: "bp-1", organizationId: ORG_A,
      conversationLearningEnabled: true, websiteLearningEnabled: false, websiteUrl: "https://shop.example.com",
    });
    expect(await learning.getToggles(ORG_A)).toEqual({
      conversationLearningEnabled: true, websiteLearningEnabled: false, websiteUrl: "https://shop.example.com",
    });
  });
});

// ---------- Conversation mining (P6) ----------
function fakeProvider(text: string, spy?: jest.Mock) {
  return {
    name: "fake-llm", isRealLlm: true,
    complete: spy ?? jest.fn(async () => ({ text, model: "fake-1", inputTokens: 11, outputTokens: 7, tokensEstimated: false })),
  } as any;
}

describe("SA-B4 ConversationMiningService — opt-in, PII, suggested-only, isolation", () => {
  function seedOrgA(prisma: any) {
    prisma.__tables.businessProfile.push({
      id: "bp-a", organizationId: ORG_A,
      conversationLearningEnabled: true, websiteLearningEnabled: true, websiteUrl: null,
      bkashNumber: null, nagadNumber: null, contactPhone: null,
    });
    prisma.__tables.channelConversation.push({
      id: "conv-a1", organizationId: ORG_A, status: "closed", isPractice: false,
      resolvedAt: new Date("2026-10-16T10:00:00Z"), updatedAt: new Date("2026-10-16T10:00:00Z"),
    });
    prisma.__tables.channelMessage.push(
      { id: "m1", conversationId: "conv-a1", direction: "in", type: "text", status: "received", content: `ডেলিভারি চার্জ কত? আমার নম্বর ${PHONE}`, createdAt: new Date("2026-10-16T09:00:00Z") },
      { id: "m2", conversationId: "conv-a1", direction: "out", type: "text", status: "sent", sentByUserId: "staff-1", autoReply: false, content: "ঢাকার ভিতরে ডেলিভারি চার্জ ৬০ টাকা।", createdAt: new Date("2026-10-16T09:05:00Z") },
    );
  }

  it("toggle OFF: zero provider resolutions, zero LLM calls, zero items", async () => {
    const prisma = makeFakePrisma();
    prisma.__tables.businessProfile.push({
      id: "bp-off", organizationId: ORG_A,
      conversationLearningEnabled: false, websiteLearningEnabled: true, websiteUrl: null,
    });
    const resolver = jest.fn(async () => fakeProvider("{}"));
    const { learning } = makeLearningStack(prisma);
    const mining = new ConversationMiningService(prisma as any, learning, new AnswerStoreService(prisma as any) as any, undefined, { providerResolver: resolver });
    const r = await mining.mineOrg(ORG_A);
    expect(r.status).toBe("skipped");
    expect(r.reason).toBe("conversation_learning_disabled");
    expect(resolver).not.toHaveBeenCalled();
    expect(prisma.__tables.learnedItem).toHaveLength(0);
  });

  it("no real LLM configured: honest skip, no fake items", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    const { learning } = makeLearningStack(prisma);
    const mining = new ConversationMiningService(prisma as any, learning, new AnswerStoreService(prisma as any) as any, undefined, { providerResolver: async () => null });
    const r = await mining.mineOrg(ORG_A);
    expect(r).toMatchObject({ status: "skipped", reason: "no_real_llm_provider" });
    expect(prisma.__tables.learnedItem).toHaveLength(0);
  });

  it("mines suggestions only; the prompt is PII-masked; poisoned pairs are dropped; nothing lands in Answer Store / Knowledge", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    const complete = jest.fn(async () => ({
      text: JSON.stringify({
        pairs: [
          { question: "ডেলিভারি চার্জ কত?", answer: "ঢাকার ভিতরে ডেলিভারি চার্জ ৬০ টাকা।" },
          { question: "যোগাযোগের নম্বর কোনটি?", answer: `কল করুন ${PHONE}` },
        ],
        facts: [{ text: "সারা দেশে ক্যাশ অন ডেলিভারি আছে।" }],
      }),
      model: "fake-1", inputTokens: 11, outputTokens: 7, tokensEstimated: false,
    }));
    const { learning } = makeLearningStack(prisma);
    const mining = new ConversationMiningService(
      prisma as any, learning, new AnswerStoreService(prisma as any) as any, undefined,
      { providerResolver: async () => fakeProvider("", complete) },
    );
    const r = await mining.mineOrg(ORG_A);
    expect(r).toMatchObject({ status: "ok", conversations: 1, pairs: 1, facts: 1, llmCalls: 1 });

    // The prompt the provider received never carried the raw phone.
    const sentMessages = (complete.mock.calls[0] as any[])[0] as { role: string; content: string }[];
    const promptText = sentMessages.map((m) => m.content).join("\n");
    expect(promptText).not.toContain(PHONE);
    expect(promptText).toContain("***");

    // Suggested-only: exactly the clean pair + fact; the poisoned
    // pair was dropped by the Answer Store's own PII screen.
    const items = prisma.__tables.learnedItem;
    expect(items).toHaveLength(2);
    expect(items.every((i: any) => i.status === "suggested" && i.organizationId === ORG_A)).toBe(true);
    expect(JSON.stringify(items)).not.toContain(PHONE);
    // No live knowledge was written by mining (D3).
    expect(prisma.__tables.aiStoredAnswer).toHaveLength(0);
    expect(prisma.__tables.knowledgeDocument).toHaveLength(0);
    // Usage was recorded honestly.
    expect(prisma.__tables.aIUsageRecord).toHaveLength(1);
    expect(prisma.__tables.aIUsageRecord[0].feature).toBe("conversation_learning");

    // Watermark advanced: a second run mines nothing new.
    const r2 = await mining.mineOrg(ORG_A);
    expect(r2.conversations).toBe(0);
    expect(r2.llmCalls).toBe(0);
    expect(prisma.__tables.learnedItem).toHaveLength(2);
  });

  it("isolation: org B's conversations are never read into org A's suggestions", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    prisma.__tables.businessProfile.push({
      id: "bp-b", organizationId: ORG_B,
      conversationLearningEnabled: true, websiteLearningEnabled: true, websiteUrl: null,
      bkashNumber: null, nagadNumber: null, contactPhone: null,
    });
    prisma.__tables.channelConversation.push({
      id: "conv-b1", organizationId: ORG_B, status: "closed", isPractice: false,
      resolvedAt: new Date("2026-10-16T11:00:00Z"), updatedAt: new Date("2026-10-16T11:00:00Z"),
    });
    prisma.__tables.channelMessage.push(
      { id: "mb1", conversationId: "conv-b1", direction: "in", type: "text", status: "received", content: "B-SECRET-QUESTION", createdAt: new Date("2026-10-16T10:30:00Z") },
      { id: "mb2", conversationId: "conv-b1", direction: "out", type: "text", status: "sent", sentByUserId: "staff-9", autoReply: false, content: "B-SECRET-ANSWER", createdAt: new Date("2026-10-16T10:35:00Z") },
    );
    const { learning } = makeLearningStack(prisma);
    const mining = new ConversationMiningService(
      prisma as any, learning, new AnswerStoreService(prisma as any) as any, undefined,
      { providerResolver: async () => fakeProvider(JSON.stringify({ pairs: [{ question: "ডেলিভারি চার্জ কত?", answer: "ঢাকার ভিতরে ৬০ টাকা।" }], facts: [] })) },
    );
    await mining.mineOrg(ORG_A);
    const aItems = prisma.__tables.learnedItem.filter((i: any) => i.organizationId === ORG_A);
    expect(JSON.stringify(aItems)).not.toContain("B-SECRET");
    expect(aItems.every((i: any) => JSON.stringify(i.sourceRef) === JSON.stringify(["conv-a1"]))).toBe(true);
  });

  it("unanswered clusters: faq_pair only from a REAL staff answer; otherwise a gap fact — never an invented answer", async () => {
    const prisma = makeFakePrisma();
    prisma.__tables.businessProfile.push({
      id: "bp-a", organizationId: ORG_A,
      conversationLearningEnabled: true, websiteLearningEnabled: true, websiteUrl: null,
      bkashNumber: null, nagadNumber: null, contactPhone: null,
    });
    prisma.__tables.channelConversation.push({
      id: "conv-u1", organizationId: ORG_A, status: "closed", isPractice: false,
      resolvedAt: new Date("2026-10-10T10:00:00Z"), updatedAt: new Date("2026-10-10T10:00:00Z"),
    });
    prisma.__tables.channelMessage.push(
      { id: "u1", conversationId: "conv-u1", direction: "in", type: "text", status: "received", content: "ওয়ারেন্টি কত দিনের?", createdAt: new Date("2026-10-10T09:00:00Z") },
      { id: "u2", conversationId: "conv-u1", direction: "out", type: "text", status: "sent", sentByUserId: "staff-1", autoReply: false, content: "সব পণ্যে ৭ দিনের রিপ্লেসমেন্ট ওয়ারেন্টি।", createdAt: new Date("2026-10-10T09:05:00Z") },
    );
    const { normalizeQuestion } = await import("./answer-store.service");
    prisma.__tables.aiUnansweredQuestion.push(
      { id: "uq-1", organizationId: ORG_A, conversationId: "conv-u1", channel: "messenger", questionText: "ওয়ারেন্টি কত দিনের?", normalizedQuestion: normalizeQuestion("ওয়ারেন্টি কত দিনের?"), reason: "knowledge_gap", status: "open", count: 3, lastSeenAt: new Date() },
      { id: "uq-2", organizationId: ORG_A, conversationId: null, channel: "messenger", questionText: "EMI সুবিধা আছে কি?", normalizedQuestion: normalizeQuestion("EMI সুবিধা আছে কি?"), reason: "knowledge_gap", status: "open", count: 5, lastSeenAt: new Date() },
    );
    const { learning } = makeLearningStack(prisma);
    const mining = new ConversationMiningService(prisma as any, learning, new AnswerStoreService(prisma as any) as any);
    const created = await mining.mineUnanswered(ORG_A);
    expect(created).toBe(2);
    const pair = prisma.__tables.learnedItem.find((i: any) => i.kind === "faq_pair");
    expect(pair.sourceType).toBe("unanswered");
    expect(pair.content.answer).toContain("৭ দিনের");
    const gap = prisma.__tables.learnedItem.find((i: any) => i.kind === "fact");
    expect(gap.content.text).toContain("EMI সুবিধা আছে কি?");
    expect(gap.content.answer).toBeUndefined();
  });

  it("parseExtraction tolerates fences and garbage, invents nothing", () => {
    expect(parseExtraction("not json at all")).toEqual({ pairs: [], facts: [] });
    const ok = parseExtraction("```json\n{\"pairs\": [{\"question\": \"q\", \"answer\": \"a\"}], \"facts\": [{\"text\": \"f\"}]}\n```");
    expect(ok.pairs).toHaveLength(1);
    expect(ok.facts).toEqual([{ text: "f" }]);
  });
});

// ---------- Website learning (P5b) ----------
describe("SA-B4 WebsiteLearningService — SSRF, robots, same-host, hash-skip", () => {
  const PUBLIC_DNS = async (host: string) => {
    if (host === "internal.example.com") return [{ address: "192.168.1.10", family: 4 }];
    return [{ address: "93.184.216.34", family: 4 }];
  };
  const HOME_HTML = `<html><head><title>Test Shop</title></head><body>
    <nav>Menu</nav><h1>Test Shop — সেরা পণ্য</h1>
    <p>আমাদের দোকানে হাতে তৈরি পণ্য পাওয়া যায়। সারা দেশে হোম ডেলিভারি দেওয়া হয় এবং ক্যাশ অন ডেলিভারি সুবিধা রয়েছে।</p>
    <a href="/about">About</a> <a href="/private">Private</a>
    <a href="https://evil.example.com/steal">External</a> <a href="/logo.png">Logo</a>
  </body></html>`;
  const ABOUT_HTML = `<html><head><title>About Us</title></head><body>
    <p>আমরা ২০১৫ সাল থেকে খুলনা থেকে হাতে তৈরি পণ্য বিক্রি করছি। প্রতিটি পণ্য যত্নে তৈরি এবং পরীক্ষা করা হয়।</p>
  </body></html>`;

  function makeFetchFn(pages: Record<string, string>, calls: string[]) {
    return (async (url: any) => {
      const u = String(url);
      calls.push(u);
      const body = pages[u];
      if (body === undefined) {
        return { ok: false, status: 404, headers: { get: () => null }, text: async () => "" };
      }
      const isRobots = u.endsWith("/robots.txt");
      return {
        ok: true, status: 200,
        headers: { get: (h: string) => (h === "content-type" ? (isRobots ? "text/plain" : "text/html") : null) },
        text: async () => body,
      };
    }) as any;
  }

  function seedSite(prisma: any, pages: Record<string, string>, calls: string[], aboutOverride?: string) {
    prisma.__tables.businessProfile.push({
      id: "bp-w", organizationId: ORG_A,
      conversationLearningEnabled: false, websiteLearningEnabled: true,
      websiteUrl: "https://shop.example.com",
    });
    const sitePages = {
      "https://shop.example.com/robots.txt": "User-agent: *\nDisallow: /private\n",
      "https://shop.example.com/": HOME_HTML,
      "https://shop.example.com/about": aboutOverride ?? ABOUT_HTML,
      ...pages,
    };
    const { learning } = makeLearningStack(prisma);
    const indexing = { indexDocument: jest.fn(async () => ({ status: "indexed" })) };
    const svc = new WebsiteLearningService(prisma as any, indexing as any, learning, {
      fetchFn: makeFetchFn(sitePages, calls), lookupFn: PUBLIC_DNS as any,
    });
    return { svc, indexing };
  }

  it("learns same-host public pages as public website docs; cross-host, assets and robots-disallowed paths are never fetched", async () => {
    const prisma = makeFakePrisma();
    const calls: string[] = [];
    const { svc, indexing } = seedSite(prisma, {}, calls);
    const r = await svc.learnOrgWebsite(ORG_A);
    expect(r.status).toBe("ok");
    expect(r.pagesCreated).toBe(2);
    const docs = prisma.__tables.knowledgeDocument;
    expect(docs).toHaveLength(2);
    expect(docs.every((d: any) => d.kind === "website" && d.visibility === "public" && d.organizationId === ORG_A)).toBe(true);
    expect(docs.map((d: any) => d.source).sort()).toEqual([
      "website:https://shop.example.com/", "website:https://shop.example.com/about",
    ]);
    expect(indexing.indexDocument).toHaveBeenCalledTimes(2);
    expect(calls.some((u) => u.includes("evil.example.com"))).toBe(false);
    expect(calls.some((u) => u.includes("logo.png"))).toBe(false);
    expect(calls.some((u) => u.includes("/private"))).toBe(false);
    expect(r.skipped).toContainEqual({ url: "https://shop.example.com/private", reason: "robots_disallow" });
    // Run state is recorded honestly.
    const state = prisma.__tables.learningState.find((s: any) => s.source === "website");
    expect(state.lastStatus).toBe("ok");
  });

  it("refresh: unchanged pages hash-skip (no update, no re-index); a changed page updates exactly once", async () => {
    const prisma = makeFakePrisma();
    const calls: string[] = [];
    const first = seedSite(prisma, {}, calls);
    await first.svc.learnOrgWebsite(ORG_A);
    const updateSpy = jest.spyOn(prisma.knowledgeDocument, "update");
    const second = seedSite(prisma, {}, calls);
    // seedSite pushed a duplicate profile row; getToggles reads
    // the first — both carry identical values, fine.
    const r2 = await second.svc.learnOrgWebsite(ORG_A);
    expect(r2.pagesUnchanged).toBe(2);
    expect(r2.pagesUpdated).toBe(0);
    expect(updateSpy).not.toHaveBeenCalled();
    const changed = seedSite(prisma, {}, calls, ABOUT_HTML.replace("২০১৫", "২০২০"));
    const r3 = await changed.svc.learnOrgWebsite(ORG_A);
    expect(r3.pagesUpdated).toBe(1);
    expect(r3.pagesUnchanged).toBe(1);
    expect(prisma.__tables.knowledgeDocument).toHaveLength(2);
  });

  it("private-IP seed is refused BEFORE any fetch; isPrivateOrReservedIp covers the ranges", async () => {
    const prisma = makeFakePrisma();
    prisma.__tables.businessProfile.push({
      id: "bp-bad", organizationId: ORG_B,
      conversationLearningEnabled: false, websiteLearningEnabled: true,
      websiteUrl: "http://internal.example.com",
    });
    const calls: string[] = [];
    const { learning } = makeLearningStack(prisma);
    const svc = new WebsiteLearningService(prisma as any, { indexDocument: jest.fn() } as any, learning, {
      fetchFn: makeFetchFn({}, calls), lookupFn: PUBLIC_DNS as any,
    });
    const r = await svc.learnOrgWebsite(ORG_B);
    expect(r.status).toBe("failed");
    expect(r.reason).toBe("blocked_private_address");
    expect(calls).toHaveLength(0);
    expect(prisma.__tables.knowledgeDocument).toHaveLength(0);
    for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.1.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateOrReservedIp(ip)).toBe(true);
    }
    for (const ip of ["8.8.8.8", "93.184.216.34", "172.15.0.1", "172.32.0.1", "2606:2800:220:1:248:1893:25c8:1946"]) {
      expect(isPrivateOrReservedIp(ip)).toBe(false);
    }
  });

  it("toggle OFF / no URL: skipped honestly, nothing fetched", async () => {
    const prisma = makeFakePrisma();
    prisma.__tables.businessProfile.push({
      id: "bp-off", organizationId: ORG_A,
      conversationLearningEnabled: false, websiteLearningEnabled: false,
      websiteUrl: "https://shop.example.com",
    });
    const calls: string[] = [];
    const { learning } = makeLearningStack(prisma);
    const svc = new WebsiteLearningService(prisma as any, { indexDocument: jest.fn() } as any, learning, {
      fetchFn: makeFetchFn({}, calls), lookupFn: PUBLIC_DNS as any,
    });
    expect(await svc.learnOrgWebsite(ORG_A)).toMatchObject({ status: "skipped", reason: "website_learning_disabled" });
    expect(calls).toHaveLength(0);
  });
});

// ---------- Product indexing coverage (P5a) ----------
class FakeEmbeddings extends EmbeddingsService {
  constructor() { super(undefined); }
  override async resolveConfig(): Promise<any> {
    return { ok: true, config: { provider: "test", apiKey: "x", model: "fake-embed-1" } };
  }
  override async embed(_org: string, texts: string[]): Promise<any> {
    return {
      ok: true, provider: "test", model: "fake-embed-1", dimension: 3, inputTokens: texts.length, tokensEstimated: true,
      vectors: texts.map((t) => [t.length % 7, t.length % 5, t.length % 3]),
    };
  }
}
class InMemoryStore implements VectorStore {
  rows: (EmbeddingRowMeta & { embedding: number[] })[] = [];
  private seq = 0;
  async listBySource(org: string, st: string, sid: string): Promise<EmbeddingRowMeta[]> {
    return this.rows.filter((r) => r.organizationId === org && r.sourceType === st && r.sourceId === sid)
      .map(({ embedding: _e, ...meta }) => meta);
  }
  async insertRows(rows: EmbeddingRowInput[]): Promise<number> {
    for (const r of rows) this.rows.push({ ...r, id: `row-${++this.seq}` });
    return rows.length;
  }
  async deleteByIds(org: string, ids: string[]): Promise<number> {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !(r.organizationId === org && ids.includes(r.id)));
    return before - this.rows.length;
  }
  async deleteBySource(org: string, st: string, sid: string): Promise<number> {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !(r.organizationId === org && r.sourceType === st && r.sourceId === sid));
    return before - this.rows.length;
  }
  async search(): Promise<VectorSearchHit[]> { return []; }
}

describe("SA-B4 product indexing (P5a) — relational coverage, never price/stock", () => {
  it("embed text carries category/brand/tags/variant attributes and NONE of the sentinel price/stock values", async () => {
    const prisma = makeFakePrisma();
    prisma.__tables.category.push({ id: "cat-1", organizationId: ORG_A, name: "শাড়ি" });
    prisma.__tables.brand.push({ id: "brand-1", organizationId: ORG_A, name: "TestBrand" });
    prisma.__tables.productTagAssignment.push(
      { id: "ta-1", productId: "prod-1", tagId: "tag-1", tag: { name: "ঈদ কালেকশন", organizationId: ORG_A } },
      { id: "ta-2", productId: "prod-1", tagId: "tag-2", tag: { name: "নতুন", organizationId: ORG_A } },
    );
    prisma.__tables.productVariant.push({
      id: "var-1", productId: "prod-1", name: "লাল / XL",
      attributes: { color: "লাল", size: "XL", wholesalePrice: "888888" },
      priceMinor: 555555n, stockQuantity: 22222,
    });
    const store = new InMemoryStore();
    const svc = new KnowledgeIndexingService(prisma as any, new FakeEmbeddings() as any, store as any);
    const r = await svc.indexProduct({
      id: "prod-1", organizationId: ORG_A, name: "হাতে বোনা শাড়ি", nameEn: null,
      category: null, categoryId: "cat-1", brandId: "brand-1",
      description: "যত্নে বোনা তাঁতের শাড়ি।", descriptionEn: null, seoDescription: null,
      status: "ACTIVE",
      // The live-fact fields a caller row carries — must never
      // reach the embed text (cast: the service's input type
      // deliberately does not declare them).
      ...({ priceMinor: 777777n, stockQuantity: 31337 } as any),
    });
    expect(r.status).toBe("indexed");
    const text = store.rows.map((row) => row.content).join("\n");
    expect(text).toContain("শাড়ি");
    expect(text).toContain("TestBrand");
    expect(text).toContain("ঈদ কালেকশন");
    expect(text).toContain("লাল / XL");
    expect(text).toContain("color: লাল");
    for (const sentinel of ["777777", "31337", "555555", "22222", "888888"]) {
      expect(text).not.toContain(sentinel);
    }
  });
});
