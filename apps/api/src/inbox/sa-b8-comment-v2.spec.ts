import "reflect-metadata";
import { InboxService } from "./inbox.service";
import { SocialCommentsService } from "./social-comments.service";
import { CommentClassifier } from "./comment-classifier";
import { CommentHumanizer } from "./comment-humanizer";
import { OrgBrainService } from "../ai/org-brain.service";
import { AnswerStoreService } from "../ai/answer-store.service";

/**
 * SA-B8 (Phase 1, R2) — Comment Reply v2 + the CX3 fix proofs.
 *
 * CX3 (inbox): the production lag is simulated DETERMINISTICALLY
 * (messages aged seconds before the defer runs) — the shape the
 * old `new Date()` batch stamp could never survive: a lone aged
 * message still fires exactly once, and an aged 3-message burst
 * produces ONE reply composed from the combined text, first
 * message included.
 *
 * CX3 (comments): a 3-comment burst fires ONE reply from the
 * combined text (first comment included), covered comments are
 * discharged, a re-run posts nothing more (Graph call counted).
 *
 * R2 grounding: the comment autopilot composes from the Org
 * Brain — a policy/FAQ sentinel reaches the prompt and the
 * posted reply; internal-class sentinels (internal doc, goals,
 * budget) and another org's docs never do; an LLM-invented price
 * is blocked by the shared number guard and routed to the human
 * queue (nothing posted at all); the Answer Store serves the
 * comment channel with zero LLM calls and a price change
 * invalidates the entry; a commenter's own memory/order facts
 * never appear in a public reply (the order question gets an
 * inbox invitation), with the memory read for language only.
 *
 * Fake prisma + a scripted Graph client + a fake LLM provider —
 * no live DB, no live send, no live model anywhere.
 */
type Row = Record<string, any>;

function eqVal(a: any, b: any): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Date || b instanceof Date) return new Date(a).getTime() === new Date(b).getTime();
  return a === b;
}
function match(row: Row, where: any = {}): boolean {
  return Object.entries(where ?? {}).every(([k, raw]) => {
    const v = raw as any;
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const keys = Object.keys(v);
      const isOperator = keys.some((kk) => ["in", "notIn", "not", "gte", "gt", "lte", "lt", "equals", "contains", "mode"].includes(kk));
      if (!isOperator) {
        // Compound unique key (organizationId_customerKey,
        // organizationId_externalCommentId, ...): every subfield
        // must equal the row's own field of that name.
        return keys.every((kk) => eqVal(row[kk], v[kk]));
      }
      if ("in" in v) return (v.in as any[]).includes(row[k]);
      if ("notIn" in v) return !(v.notIn as any[]).includes(row[k]);
      if ("not" in v) {
        if (v.not === null) return row[k] !== null && row[k] !== undefined;
        return !eqVal(row[k], v.not);
      }
      if ("gte" in v && !(new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
      if ("gt" in v && !(new Date(row[k]).getTime() > new Date(v.gt).getTime())) return false;
      if ("lte" in v && !(new Date(row[k]).getTime() <= new Date(v.lte).getTime())) return false;
      if ("lt" in v && !(new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false;
      if ("equals" in v) return eqVal(row[k], v.equals);
      if ("contains" in v) return String(row[k] ?? "").toLowerCase().includes(String(v.contains).toLowerCase());
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    return eqVal(row[k], v);
  });
}
function sortRows(rows: Row[], orderBy: any): Row[] {
  if (!orderBy) return rows;
  const entries = Array.isArray(orderBy) ? orderBy : [orderBy];
  let out = [...rows];
  for (const e of [...entries].reverse()) {
    const [key, dir] = Object.entries(e)[0] as [string, string];
    out = out.sort((a, b) => {
      const av = a[key] instanceof Date ? new Date(a[key]).getTime() : a[key];
      const bv = b[key] instanceof Date ? new Date(b[key]).getTime() : b[key];
      const cmp = (av ?? 0) < (bv ?? 0) ? -1 : (av ?? 0) > (bv ?? 0) ? 1 : 0;
      return dir === "desc" ? -cmp : cmp;
    });
  }
  return out;
}
function applyData(row: Row, data: any): void {
  for (const [k, v] of Object.entries(data ?? {})) {
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v) && ("increment" in (v as any) || "decrement" in (v as any))) {
      const inc = Number((v as any).increment ?? 0) - Number((v as any).decrement ?? 0);
      row[k] = Number(row[k] ?? 0) + inc;
    } else {
      row[k] = v;
    }
  }
}
function table(store: Row[]) {
  return {
    findMany: jest.fn(async ({ where, take, orderBy, skip }: any = {}) => {
      let rows = sortRows(store.filter((r) => match(r, where)), orderBy);
      if (skip) rows = rows.slice(skip);
      return take ? rows.slice(0, take) : rows;
    }),
    findFirst: jest.fn(async ({ where, orderBy }: any = {}) => {
      const rows = sortRows(store.filter((r) => match(r, where)), orderBy);
      return rows[0] ?? null;
    }),
    findUnique: jest.fn(async ({ where }: any = {}) => store.find((r) => match(r, where)) ?? null),
    create: jest.fn(async ({ data }: any) => { const row = { id: `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...data }; store.push(row); return row; }),
    update: jest.fn(async ({ where, data }: any) => { const row = store.find((r) => r.id === where.id || match(r, where)); if (!row) throw new Error("nf"); applyData(row, data); row.updatedAt = new Date(); return row; }),
    updateMany: jest.fn(async ({ where, data }: any) => { let n = 0; for (const r of store) if (match(r, where)) { applyData(r, data); n++; } return { count: n }; }),
    upsert: jest.fn(async ({ where, update, create }: any) => {
      const row = store.find((r) => match(r, where));
      if (row) { applyData(row, update); return row; }
      const created = { id: `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      store.push(created); return created;
    }),
    count: jest.fn(async ({ where }: any = {}) => store.filter((r) => match(r, where)).length),
    delete: jest.fn(async ({ where }: any) => { const i = store.findIndex((r) => r.id === where.id || match(r, where)); if (i < 0) throw new Error("nf"); return store.splice(i, 1)[0]; }),
    deleteMany: jest.fn(async ({ where }: any = {}) => { let n = 0; for (let i = store.length - 1; i >= 0; i--) if (match(store[i], where)) { store.splice(i, 1); n++; } return { count: n }; }),
  };
}

const ORG = "org-1";
const ORG_B = "org-2";
const CLS = (intent: string, confidence = 95, sentiment: string | null = null) => ({ intent, confidence, sentiment } as any);

// ----------------------------------------------------------------
// CX3 inbox: deterministic production-lag proofs
// ----------------------------------------------------------------

function inboxSetup() {
  const settings: Row[] = [{ id: "s1", organizationId: ORG, autoReplyMode: "auto", confidenceThreshold: 70, perIntent: {}, smartAssign: "off", slaFirstResponseMinutes: 60, perChannelModes: {}, escalationThresholdMinor: null, aiReplyDelaySeconds: 45, aiReplyDelayByChannel: {} }];
  const conversations: Row[] = [];
  const messages: Row[] = [];
  const products: Row[] = [
    { id: "p1", organizationId: ORG, name: "কটন শাড়ি", priceMinor: 120000n, currency: "BDT", stockQuantity: 5, status: "ACTIVE", createdAt: new Date("2026-01-01") },
    { id: "p2", organizationId: ORG, name: "লেদার ব্যাগ", priceMinor: 250000n, currency: "BDT", stockQuantity: 2, status: "ACTIVE", createdAt: new Date("2026-01-02") },
  ];
  const db = {
    inboxSetting: table(settings),
    channelConversation: table(conversations),
    channelMessage: table(messages),
    messageDraft: table([] as Row[]),
    product: table(products),
    order: table([] as Row[]),
    businessPolicy: table([] as Row[]),
    businessProfile: table([] as Row[]),
    knowledgeDocument: table([] as Row[]),
    aiUnansweredQuestion: table([] as Row[]),
    aIUsageRecord: table([] as Row[]),
    organization: table([{ id: ORG, name: "টেস্ট শপ" }] as Row[]),
    membership: table([{ id: "m1", organizationId: ORG, userId: "owner", role: "OWNER" }] as Row[]),
    agentNotification: table([] as Row[]),
  };
  const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
  const llm = { getProvider: () => { throw new Error("no provider configured"); } };
  const service = new InboxService(db as any, audit as any, llm as any);
  return { service, db, audit, settings, conversations, messages };
}
function conv(over: Row = {}): Row {
  return { id: `c-${Math.random().toString(36).slice(2, 8)}`, organizationId: ORG, channel: "webchat", status: "open", assignedUserId: null, priority: "normal", sentimentFlag: null, autoReplyPaused: false, customerId: null, contactName: "রহিম", createdAt: new Date(), lastMessageAt: new Date(), firstResponseAt: new Date(), autoReplyDueAt: null, autoReplyBatchSince: null, ...over };
}
function inbound(conversationId: string, content: string, createdAt: Date): Row {
  return { id: `m-${Math.random().toString(36).slice(2, 8)}`, conversationId, direction: "in", type: "text", content, status: "received", autoReply: false, sentByUserId: null, createdAt };
}

describe("SA-B8 CX3 inbox: aged messages (deterministic production lag)", () => {
  it("burst of 3 aged messages: batchSince = FIRST message time, exactly one reply composed from the combined text, re-run posts nothing", async () => {
    const { service, conversations, messages } = inboxSetup();
    const c = conv(); conversations.push(c);
    const base = Date.now() - 9000;
    const m1 = inbound(c.id, "কটন শাড়ি এর দাম কত?", new Date(base));
    const m2 = inbound(c.id, "লেদার ব্যাগ এর দাম কত?", new Date(base + 3000));
    const m3 = inbound(c.id, "দুটোই দেখতে চাই", new Date(base + 6000));
    // Production shape: ingest stamps lastMessageAt from the
    // message, then the dispatch calls maybeAutoReply with the
    // message's own createdAt (the SA-B8 caller contract).
    for (const m of [m1, m2, m3]) {
      messages.push(m);
      c.lastMessageAt = m.createdAt;
      await (service as any).maybeAutoReply(ORG, c, CLS("price"), m.content, { messageAt: m.createdAt });
    }
    expect(messages.filter((m) => m.autoReply)).toHaveLength(0);
    // The batch opens at the FIRST message — with the pre-fix
    // stamp (now) every one of these messages predates it and
    // the batch would collect NOTHING.
    expect(new Date(c.autoReplyBatchSince).getTime()).toBe(m1.createdAt.getTime());

    c.autoReplyDueAt = new Date(Date.now() - 1000);
    const res = await service.runDueAutoReplies(ORG);
    expect(res.fired).toBe(1);
    const sent = messages.filter((m) => m.autoReply && m.status === "sent");
    expect(sent).toHaveLength(1);
    // The grounded compose picks the first product match in the
    // COMBINED text — the first message's product. Had the first
    // message been lost, the reply would be about লেদার ব্যাগ
    // (or the batch would have been empty entirely).
    expect(sent[0].content).toContain("কটন শাড়ি");

    const res2 = await service.runDueAutoReplies(ORG);
    expect(res2.fired).toBe(0);
    expect(messages.filter((m) => m.autoReply && m.status === "sent")).toHaveLength(1);
  });
});

// ----------------------------------------------------------------
// Comments: shared grounded setup
// ----------------------------------------------------------------

interface FakeProvider {
  name: string;
  isRealLlm: boolean;
  complete: jest.Mock;
}
function fakeProvider(respond: (messages: any[]) => string): FakeProvider {
  return {
    name: "fake-llm",
    isRealLlm: true,
    complete: jest.fn(async (messages: any[]) => ({ text: respond(messages), inputTokens: 11, outputTokens: 7, tokensEstimated: false })),
  };
}

function commentsSetup(opts: { replyDelaySeconds?: number; provider?: FakeProvider | null; withLlm?: boolean } = {}) {
  const replySettings: Row[] = [{
    id: "rs1", organizationId: ORG, aiAutoReplyEnabled: true, sendPrivateDm: true, autoHideSpam: true,
    replyDelaySeconds: opts.replyDelaySeconds ?? 0, tonePreference: "FRIENDLY_SALES", bannedKeywords: [], salesOrderUrl: null,
    nightOwlEnabled: false, urgentAlertTelegramEnabled: false, telegramChatId: null, telegramBotToken: null,
  }];
  const comments: Row[] = [];
  const products: Row[] = [
    { id: "p1", organizationId: ORG, name: "লেদার ওয়ালেট", priceMinor: 125000n, currency: "BDT", slug: "wallet", status: "ACTIVE", createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01") },
  ];
  const profile: Row = {
    id: "bp1", organizationId: ORG, industry: "fashion", description: "লেদার পণ্যের দোকান", brandVoice: null,
    deliveryChargeInsideMinor: 6000, deliveryChargeOutsideMinor: 12000, deliveryDaysInside: 2, deliveryDaysOutside: 3,
    codAvailable: true, bkashNumber: "01711111111", nagadNumber: null, advancePaymentPercent: null, paymentNote: null,
    contactPhone: "01822222222", contactEmail: null, address: null, city: "ঢাকা", websiteUrl: null, businessHours: null,
    returnWindowDays: null, aiInstructions: null, aiReplyLanguage: null,
    goals: "GOAL-SENTINEL-555", monthlyBudgetMinor: "987654", targetCustomers: "TARGET-SENTINEL", uniqueSellingPoints: "USP-SENTINEL",
    createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
  };
  const docs: Row[] = [
    { id: "doc-return", organizationId: ORG, kind: "policy", title: "রিটার্ন নীতি", content: "পণ্য হাতে পাওয়ার ১৪ দিনের মধ্যে রিটার্ন করা যাবে। রিটার্নের জন্য পণ্য অবশ্যই অব্যবহৃত থাকতে হবে।", visibility: "public", createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01") },
    { id: "doc-internal", organizationId: ORG, kind: "note", title: "ভিতরের নোট", content: "রিটার্ন করা যাবে দিনের মধ্যে INTERNAL-SENTINEL-999 গোপন মার্জিন তথ্য", visibility: "internal", createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01") },
    { id: "doc-orgb", organizationId: ORG_B, kind: "policy", title: "রিটার্ন নীতি", content: "রিটার্ন করা যাবে ORGB-SENTINEL-333 অন্য দোকানের তথ্য", visibility: "public", createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01") },
  ];
  const memories: Row[] = [
    {
      id: "mem-1", organizationId: ORG, customerKey: "messenger:fb-rakib", displayName: "রাকিব হাসান", languagePref: "bn",
      topics: [{ productId: "p1", name: "লেদার ওয়ালেট", via: "asked" }], orderCount: 5, lastOrderAt: new Date("2026-09-01"),
      notes: [{ kind: "order", text: "সর্বশেষ অর্ডার SENTINEL-ORDER-7788 ডেলিভারি হয়েছে", conversationId: "conv-x", at: "2026-09-01" }],
      lastInteractionAt: new Date("2026-09-01"), createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
    },
  ];
  const storedAnswers: Row[] = [];
  const usage: Row[] = [];
  const db = {
    socialReplySetting: table(replySettings),
    socialComment: table(comments),
    product: table(products),
    lead: table([] as Row[]),
    businessProfile: table([profile]),
    businessPolicy: table([] as Row[]),
    knowledgeDocument: table(docs),
    organization: table([{ id: ORG, name: "টেস্ট শপ" }, { id: ORG_B, name: "অন্য শপ" }] as Row[]),
    aiBrandVoiceProfile: table([] as Row[]),
    customerMemory: table(memories),
    aiStoredAnswer: table(storedAnswers),
    aIUsageRecord: table(usage),
    integration: table([] as Row[]),
    $queryRaw: async () => [],
    $executeRaw: async () => 0,
  };
  const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
  const provider = opts.provider ?? null;
  const llm = opts.withLlm === false || !provider
    ? undefined
    : { forOrg: async () => provider, getProvider: () => provider };
  const brain = new OrgBrainService(db as any);
  const brainCalls: any[] = [];
  const origGetContext = brain.getContext.bind(brain);
  (brain as any).getContext = async (org: string, o: any) => { brainCalls.push(o); return origGetContext(org, o); };
  const storeSvc = new AnswerStoreService(db as any, undefined);
  const service = new SocialCommentsService(db as any, audit as any, llm as any, brain as any, storeSvc as any);
  const graph = {
    replies: [] as { commentId: string; text: string }[],
    dms: [] as { commentId: string; text: string }[],
  };
  (service as any).graphClientFor = async () => ({
    replyToComment: async (commentId: string, text: string) => { graph.replies.push({ commentId, text }); return { commentId: `graph-reply-${graph.replies.length}` }; },
    privateReplyToComment: async (commentId: string, text: string) => { graph.dms.push({ commentId, text }); return { messageId: "graph-dm-1" }; },
    setCommentHidden: async () => ({ success: true }),
    deleteComment: async () => ({ success: true }),
  });
  return { service, db, audit, replySettings, comments, products, profile, docs, memories, storedAnswers, usage, graph, provider, brainCalls, storeSvc };
}
const cdto = (over: Row = {}): any => ({
  platform: "facebook", externalPostId: "post-1", externalCommentId: `cmt-${Math.random().toString(36).slice(2, 8)}`,
  postTitle: "লেদার ওয়ালেট অফার", authorName: "রাকিব হাসান", authorSocialId: "fb-rakib",
  commentText: "এটার দাম কত ভাই?", ...over,
});
const flush = async () => { await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); };

// ----------------------------------------------------------------
// CX3 comments: burst of 3, deterministic
// ----------------------------------------------------------------

describe("SA-B8 CX3 comments: burst of 3 with the delay on", () => {
  it("ONE reply from the combined text (first comment included), covered comments discharged, re-run posts nothing more", async () => {
    const rand = jest.spyOn(Math, "random").mockReturnValue(0);
    try {
      // No LLM wired at all: the pre-SA-B8 humanizer behaviour
      // must be byte-exact (the grounded compose declines).
      const { service, graph } = commentsSetup({ replyDelaySeconds: 25, withLlm: false });
      const c1: any = await service.ingestComment(ORG, cdto({ externalCommentId: "b1", commentText: "লেদার ওয়ালেট এর দাম কত?" }));
      await new Promise((r) => setTimeout(r, 5));
      const c2: any = await service.ingestComment(ORG, cdto({ externalCommentId: "b2", commentText: "ডেলিভারি চার্জ কত?" }));
      await new Promise((r) => setTimeout(r, 5));
      const c3: any = await service.ingestComment(ORG, cdto({ externalCommentId: "b3", commentText: "ক্যাশ অন ডেলিভারি আছে?" }));
      for (const c of [c1, c2, c3]) c.aiReplyDueAt = new Date(Date.now() - 1000);

      const res = await service.runDueCommentReplies(ORG);
      expect(res.fired).toBe(1);
      expect(res.batched).toBe(2);
      // Exactly one post left the building.
      expect(graph.replies).toHaveLength(1);
      expect(graph.replies[0].commentId).toBe("b3");

      // The one reply is the humanizer plan for the COMBINED
      // text — which begins with the FIRST comment. (Pre-CX3-fix
      // shapes that dropped the first message would compose
      // from c2+c3 and fail this equality.)
      const combined = `${c1.commentText}\n${c2.commentText}\n${c3.commentText}`;
      const expected = CommentHumanizer.generateHumanReply({
        authorName: c3.authorName,
        commentText: combined,
        classification: CommentClassifier.classify(combined, []),
        postTitle: c3.postTitle,
        matchedProduct: { name: "লেদার ওয়ালেট", priceFormatted: "BDT 1250.00", orderUrl: "/checkout/wallet" },
        tonePreference: "FRIENDLY_SALES",
        isNightOwl: false,
      });
      expect(c3.status).toBe("AUTO_REPLIED");
      expect(c3.replyText).toBe(expected.publicCommentReply);
      expect(graph.replies[0].text).toBe(expected.publicCommentReply);

      for (const covered of [c1, c2]) {
        expect(covered.status).toBe("AUTO_REPLIED");
        expect(covered.aiReplyBatchOf).toBe("b3");
        expect(covered.metadata?.aiReplyBatch?.coveredBy).toBe("b3");
        expect(covered.replyText ?? null).toBeNull();
      }

      const res2 = await service.runDueCommentReplies(ORG);
      expect(res2.fired).toBe(0);
      expect(graph.replies).toHaveLength(1);
    } finally {
      rand.mockRestore();
    }
  });
});

// ----------------------------------------------------------------
// R2: Brain grounding
// ----------------------------------------------------------------

describe("SA-B8 R2: Brain-grounded comment replies", () => {
  it("a policy question is answered from the org's own policy doc; internal + foreign + profile-internal sentinels never reach the prompt or the post", async () => {
    const prompts: any[] = [];
    const provider = fakeProvider((messages) => {
      prompts.push(messages);
      return "আসসালামু আলাইকুম রাকিব ভাইয়া! আমাদের রিটার্ন নীতি অনুযায়ী পণ্য হাতে পাওয়ার ১৪ দিনের মধ্যে রিটার্ন করা যাবে।";
    });
    const { service, graph, usage } = commentsSetup({ replyDelaySeconds: 0, provider });
    const c: any = await service.ingestComment(ORG, cdto({ commentText: "রিটার্ন করা যাবে কত দিনের মধ্যে?" }));

    expect(c.status).toBe("PENDING"); // instant path leaves status; replyText is the applied marker
    expect(graph.replies).toHaveLength(1);
    expect(graph.replies[0].text).toContain("১৪ দিনের মধ্যে রিটার্ন");
    expect(c.replyText).toBe(graph.replies[0].text);
    expect(c.metadata?.graph?.groundedVia).toBe("llm");

    // The compose received the org's OWN public knowledge + the
    // profile's delivery facts...
    const system = String(prompts[0][0].content);
    expect(system).toContain("রিটার্ন নীতি");
    expect(system).toContain("১৪ দিনের মধ্যে রিটার্ন করা যাবে");
    expect(system).toContain("BDT 60.00");
    // ...and NONE of the internal-class or foreign-org material.
    for (const sentinel of ["INTERNAL-SENTINEL-999", "ORGB-SENTINEL-333", "GOAL-SENTINEL-555", "987654", "TARGET-SENTINEL", "USP-SENTINEL"]) {
      expect(system).not.toContain(sentinel);
      expect(graph.replies[0].text).not.toContain(sentinel);
    }
    expect(usage.some((u) => u.feature === "comment_autopilot" && u.provider === "fake-llm")).toBe(true);
  });

  it("the number guard blocks an invented price: nothing is posted (model text or humanizer), the comment stays PENDING for a human, the rejection is recorded", async () => {
    const provider = fakeProvider(() => "লেদার ওয়ালেটের দাম মাত্র ৯৯৯ টাকা! এখনই অর্ডার করুন।");
    const { service, graph, audit } = commentsSetup({ replyDelaySeconds: 0, provider });
    const c: any = await service.ingestComment(ORG, cdto({ commentText: "লেদার ওয়ালেট এর দাম কত?" }));

    expect(provider.complete).toHaveBeenCalled();
    expect(graph.replies).toHaveLength(0);
    expect(c.status).toBe("PENDING");
    expect(c.replyText ?? null).toBeNull();
    expect(c.metadata?.graph?.guardBlocked?.inventedNumbers).toContain("999");
    expect(audit.calls.some((a) => a.action === "social_comments.guard_rejected")).toBe(true);
  });

  it("a grounded sweep reply (delay path) composes from the Brain and is captured into the Answer Store (comment channel)", async () => {
    const provider = fakeProvider(() => "লেদার ওয়ালেটের দাম BDT 1250.00। ক্যাশ অন ডেলিভারিতে নিতে পারবেন।");
    const { service, graph, storedAnswers } = commentsSetup({ replyDelaySeconds: 25, provider });
    const c: any = await service.ingestComment(ORG, cdto({ externalCommentId: "sweep-1", commentText: "লেদার ওয়ালেট এর দাম কত?" }));
    expect(c.replyText).toBeNull();
    c.aiReplyDueAt = new Date(Date.now() - 1000);
    const res = await service.runDueCommentReplies(ORG);
    expect(res.fired).toBe(1);
    expect(c.status).toBe("AUTO_REPLIED");
    expect(c.replyText).toContain("1250.00");
    expect(c.metadata?.graph?.groundedVia).toBe("llm");
    expect(graph.replies).toHaveLength(1);

    await flush();
    const entry = storedAnswers.find((a) => a.channel === "comment" && a.status === "active");
    expect(entry).toBeTruthy();
    expect(entry!.answerText).toContain("1250.00");
    expect(entry!.origin).toBe("autopilot_grounded");
  });
});

// ----------------------------------------------------------------
// R2: Answer Store — comment channel
// ----------------------------------------------------------------

describe("SA-B8 R2: Answer Store on the comment channel", () => {
  it("a stored comment answer serves with ZERO LLM calls; a price change invalidates it and the LLM path takes over", async () => {
    const provider = fakeProvider(() => "লেদার ওয়ালেটের বর্তমান দাম BDT 1350.00।");
    const s = commentsSetup({ replyDelaySeconds: 0, provider });
    const stored = await s.storeSvc.store(ORG, {
      question: "লেদার ওয়ালেট এর দাম কত?",
      answer: "লেদার ওয়ালেটের দাম BDT 1250.00 — ক্যাশ অন ডেলিভারিতে নিতে পারবেন।",
      channel: "comment",
      language: "bn",
      sourceRefs: { productIds: ["p1"] },
      origin: "staff_approved",
    });
    expect(stored.stored).toBe(true);
    const entryId = (stored as any).entryId as string;

    // First ask: the store serves; the model is never called.
    const c1: any = await s.service.ingestComment(ORG, cdto({ externalCommentId: "store-1", commentText: "লেদার ওয়ালেট এর দাম কত?" }));
    expect(provider.complete).not.toHaveBeenCalled();
    expect(s.graph.replies).toHaveLength(1);
    expect(s.graph.replies[0].text).toBe("লেদার ওয়ালেটের দাম BDT 1250.00 — ক্যাশ অন ডেলিভারিতে নিতে পারবেন।");
    expect(c1.metadata?.graph?.groundedVia).toBe("answer_store");
    expect(s.usage.some((u) => u.feature === "answer_store_hit" && u.inputTokens === 0 && u.outputTokens === 0)).toBe(true);

    // The price moves: the stored answer must NOT serve again.
    // (Checked on a direct lookup first — deterministic, with no
    // capture in flight.)
    s.products[0].priceMinor = 135000n;
    const miss = await s.storeSvc.lookup(ORG, "লেদার ওয়ালেট এর দাম কত?", { channel: "comment", language: "bn" });
    expect(miss.hit).toBe(false);
    const entry = s.storedAnswers.find((a) => a.id === entryId);
    expect(entry!.status).toBe("invalidated");
    expect((miss as any).invalidReason).toBeTruthy();

    // The next identical comment takes the LLM path and answers
    // with the NEW price; the guard-passed send then re-grounds
    // the store entry with the fresh answer (SA-B3 replace
    // semantics — the stale text is nowhere servable afterwards).
    const c2: any = await s.service.ingestComment(ORG, cdto({ externalCommentId: "store-2", commentText: "লেদার ওয়ালেট এর দাম কত?" }));
    expect(provider.complete).toHaveBeenCalled();
    expect(s.graph.replies).toHaveLength(2);
    expect(s.graph.replies[1].text).toContain("1350.00");
    expect(s.graph.replies[1].text).not.toContain("1250.00");
    expect(c2.metadata?.graph?.groundedVia).toBe("llm");
    await flush();
    const active = s.storedAnswers.filter((a) => a.channel === "comment" && a.status === "active");
    expect(active).toHaveLength(1);
    expect(active[0].answerText).toContain("1350.00");
  });
});

// ----------------------------------------------------------------
// R2: public-comment confidentiality (L3)
// ----------------------------------------------------------------

describe("SA-B8 R2: a public comment never carries the commenter's own facts", () => {
  it("an order question gets the inbox invitation; the commenter's memory/order sentinels never reach the prompt or the post; memory is read via own_customer for language only", async () => {
    const prompts: any[] = [];
    const provider = fakeProvider((messages) => {
      prompts.push(messages);
      return "আসসালামু আলাইকুম ভাইয়া! আপনার অর্ডারের খবর জানতে অনুগ্রহ করে আমাদের পেজের ইনবক্সে মেসেজ করুন — ওখানেই অর্ডার নম্বর দিয়ে সাথে সাথে জানিয়ে দেব।";
    });
    const s = commentsSetup({ replyDelaySeconds: 0, provider });
    const c: any = await s.service.ingestComment(ORG, cdto({ commentText: "আমার অর্ডার কোথায়? কবে পাবো?" }));

    expect(s.graph.replies).toHaveLength(1);
    expect(s.graph.replies[0].text).toContain("ইনবক্সে মেসেজ করুন");
    // The memory WAS resolved (own_customer + the DM-linking
    // key) — and used for nothing but language: neither the
    // prompt nor the public post contains a single memory/order
    // fact.
    expect(s.brainCalls.some((o) => o.audience === "own_customer" && o.customerKey === "messenger:fb-rakib")).toBe(true);
    const system = String(prompts[0][0].content);
    for (const sentinel of ["SENTINEL-ORDER-7788", "রাকিব হাসান", "fb-rakib"]) {
      expect(system).not.toContain(sentinel);
      expect(s.graph.replies[0].text).not.toContain(sentinel);
    }
    expect(c.replyText).toBe(s.graph.replies[0].text);

    // An anonymous commenter (no social id) is a plain customer
    // audience — no memory key is even attempted.
    await s.service.ingestComment(ORG, cdto({ externalCommentId: "anon-1", authorSocialId: undefined, commentText: "ডেলিভারি চার্জ কত?" }));
    expect(s.brainCalls.some((o) => o.audience === "customer" && !o.customerKey)).toBe(true);
  });
});
