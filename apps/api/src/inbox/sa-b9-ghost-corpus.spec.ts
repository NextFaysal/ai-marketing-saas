process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.DISABLE_SCHEDULER = "true";

import { formatMinor } from "@repo/contracts";
import { InboxService, matchProduct } from "./inbox.service";
import { OrgBrainService } from "../ai/org-brain.service";
import { extractGuardNumbers } from "./business-brain";

/**
 * SA-B9 (Smart AI Phase 1, R3) — Item 2: the ghost-complete
 * decision corpus.
 *
 * SA-B7 stopped the ghost-complete Brain migration on a stop
 * rule: ghostComplete's number guard admits exactly the
 * numbers present in the agent's partial + the thread + ITS
 * hand-picked knowledge JSON (profile {industry, description,
 * brandVoice} + ALL policies take-10, content sliced to 400 +
 * the live matched product). Swapping the knowledge source
 * changes the guard's allowed set — i.e. changes guard
 * behaviour. This corpus is the empirical test the close-out
 * demanded: for every case it computes
 *   LEGACY   — the verdict of the REAL ghostComplete (its own
 *              construction, its own guard), and
 *   CANDIDATE— the verdict of a Brain-derived set built by a
 *              faithful reconstruction: the same JSON shape,
 *              but the profile + policies read through a REAL
 *              OrgBrainService.getContext (publicProfile +
 *              policies sliced to 10, content sliced to 400),
 *              the same live product match, and — crucially —
 *              the Brain's matched knowledge / product matches
 *              / fact lines EXCLUDED (the inbox fact pack's
 *              surfaces; including them is the "naive" variant
 *              tested separately below).
 * A migration is justified only if the two verdicts agree on
 * EVERY case. They do not — see the policy-window describe.
 *
 * DECISION (recorded in docs/smart-ai-b9-acceptance.md and
 * docs/smart-ai-phase1-summary.md): ghostComplete STAYS
 * LEGACY. The final describe pins the shipped behaviour.
 */

type Row = Record<string, any>;
const ORG = "org-1";
const PAST = new Date("2026-01-01T00:00:00Z");

// ----------------------------------------------------------------
// In-memory prisma (the SA-B7 table pattern)
// ----------------------------------------------------------------
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
  "systemSetting", "subscription",
];
function makeDb() {
  const stores: Record<string, Row[]> = {};
  const db: Record<string, any> = {};
  for (const n of TABLE_NAMES) { stores[n] = []; db[n] = table(stores[n], n); }
  db.$queryRaw = jest.fn(async () => []);
  db.$executeRaw = jest.fn(async () => 1);
  return { db, stores };
}

// ----------------------------------------------------------------
// Fixtures + the two verdicts
// ----------------------------------------------------------------
const QUERY = "Cotton Panjabi নিতে চাই, ডেলিভারি কত দিনে পাব?";
const PARTIAL = "আসসালামু আলাইকুম, ";

function ghostSetup(opts: { policies?: Row[]; extraMessages?: Row[]; profile?: Row } = {}) {
  const { db, stores } = makeDb();
  stores.organization.push({ id: ORG, name: "টেস্ট শপ" });
  stores.businessProfile.push({
    id: "prof-1", organizationId: ORG, industry: "fashion",
    description: "ঢাকার বিশ্বস্ত ফ্যাশন দোকান, প্রতিষ্ঠিত 2015 সালে।", brandVoice: "friendly",
    goals: null, targetCustomers: null, uniqueSellingPoints: null, monthlyBudgetMinor: null,
    businessModel: null, tradeLicenseNo: null, billingEmails: null,
    deliveryChargeInsideMinor: 6000n, deliveryChargeOutsideMinor: 12000n, codAvailable: true,
    bkashNumber: "01712345678", aiInstructions: null, aiReplyLanguage: null,
    createdAt: PAST, updatedAt: PAST,
    ...(opts.profile ?? {}),
  });
  stores.product.push(
    { id: "p1", organizationId: ORG, status: "ACTIVE", name: "Cotton Panjabi", priceMinor: 150000n, currency: "BDT", stockQuantity: 12, createdAt: PAST, updatedAt: PAST },
    { id: "p2", organizationId: ORG, status: "ACTIVE", name: "Silk Saree", priceMinor: 320000n, currency: "BDT", stockQuantity: 5, createdAt: PAST, updatedAt: PAST },
  );
  const policies = opts.policies ?? [
    { id: "pol-return", organizationId: ORG, type: "return", title: "রিটার্ন নীতি", content: "পণ্য পাওয়ার 9 দিনের মধ্যে রিটার্ন করা যাবে।" },
    { id: "pol-warranty", organizationId: ORG, type: "warranty", title: "ওয়ারেন্টি", content: "সেলাইয়ে 18 মাসের ওয়ারেন্টি প্রযোজ্য।" },
  ];
  stores.businessPolicy.push(...policies);
  stores.knowledgeDocument.push({
    id: "doc-1", organizationId: ORG, kind: "faq", title: "ডেলিভারি সময়",
    content: "হোম ডেলিভারি সাধারণত 48 ঘণ্টায় পৌঁছে যায়।", visibility: "public", createdAt: PAST, updatedAt: PAST,
  });
  stores.membership.push({ id: "m1", organizationId: ORG, userId: "agent-1", role: "OWNER" });
  const conv: Row = {
    id: "conv-1", organizationId: ORG, channel: "messenger", status: "open", customerId: null,
    externalContactId: "fb-customer-1", contactName: "রহিম", isPractice: false,
    assignedUserId: null, autoReplyPaused: false, tags: [], pipelineStage: "new", unreadCount: 0,
    createdAt: PAST, updatedAt: PAST, lastMessageAt: PAST,
  };
  stores.channelConversation.push(conv);
  stores.channelMessage.push(
    ...(opts.extraMessages ?? []),
    { id: "msg-in", conversationId: "conv-1", direction: "in", type: "text", content: QUERY, status: "received", createdAt: PAST },
  );
  const holder: { text: string } = { text: "" };
  const provider = {
    name: "fake-llm", isRealLlm: true,
    complete: jest.fn(async () => ({ text: holder.text, inputTokens: 10, outputTokens: 5, tokensEstimated: false })),
  };
  const llm = { getProvider: () => provider };
  const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
  const service = new InboxService(db as any, audit as any, llm as any);
  return { db, stores, service, holder, conv };
}

/** LEGACY verdict: the real ghostComplete — non-empty completion = accepted. */
async function legacyVerdict(s: ReturnType<typeof ghostSetup>, completion: string, partial = PARTIAL): Promise<boolean> {
  s.holder.text = completion;
  const out = await s.service.ghostComplete(ORG, "agent-1", "conv-1", partial);
  return Boolean(out.completion);
}

/** The candidate Brain-derived knowledge JSON — the ghost's
 * shape, faithfully reconstructed from a REAL Brain context:
 * profile + policies via OrgBrainService (policies sliced to
 * the ghost's 10, content sliced to its 400), the same live
 * product match. The Brain's matched knowledge, product
 * matches and fact lines are EXCLUDED (see the naive variant). */
async function brainGhostKnowledgeJson(s: ReturnType<typeof ghostSetup>): Promise<string> {
  const brain = new OrgBrainService(s.db as any);
  const ctx = await brain.getContext(ORG, { audience: "customer", query: QUERY });
  const products = s.stores.product.filter((p) => p.organizationId === ORG && p.status === "ACTIVE");
  const matchedProduct = matchProduct(QUERY, products);
  return JSON.stringify({
    business: ctx.publicProfile ? { industry: ctx.publicProfile.industry, description: ctx.publicProfile.description, brandVoice: ctx.publicProfile.brandVoice } : null,
    policies: ctx.policies.slice(0, 10).map((p: any) => ({ type: p.type, title: p.title, content: String(p.content).slice(0, 400) })),
    matchedProduct: matchedProduct ? { name: matchedProduct.name, price: formatMinor(BigInt(matchedProduct.priceMinor), matchedProduct.currency), stock: matchedProduct.stockQuantity } : null,
  });
}

function threadText(s: ReturnType<typeof ghostSetup>): string {
  return s.stores.channelMessage.filter((m) => m.conversationId === "conv-1").map((m) => String(m.content ?? "")).join("\n");
}

/** CANDIDATE verdict: every number in the completion is in the
 * Brain-derived allowed set (partial + thread + candidate JSON)
 * — the ghost guard's exact rule over the candidate source. */
async function candidateVerdict(s: ReturnType<typeof ghostSetup>, completion: string, partial = PARTIAL): Promise<boolean> {
  const knowledge = await brainGhostKnowledgeJson(s);
  const allowed = new Set(extractGuardNumbers(`${partial}\n${threadText(s)}\n${knowledge}`));
  return extractGuardNumbers(completion).every((n) => allowed.has(n));
}

/** NAIVE verdict: the candidate set PLUS the Brain's fact
 * lines + matched knowledge/product content — what a careless
 * "just feed it the fact pack" migration would admit. */
async function naiveVerdict(s: ReturnType<typeof ghostSetup>, completion: string, partial = PARTIAL): Promise<boolean> {
  const brain = new OrgBrainService(s.db as any);
  const ctx = await brain.getContext(ORG, { audience: "customer", query: QUERY });
  const knowledge = await brainGhostKnowledgeJson(s);
  const extra = [
    ctx.factsText,
    ...(ctx.knowledgeMatches ?? []).map((m: any) => String(m.content)),
    ...(ctx.productMatches ?? []).map((m: any) => String(m.content)),
  ].join("\n");
  const allowed = new Set(extractGuardNumbers(`${partial}\n${threadText(s)}\n${knowledge}\n${extra}`));
  return extractGuardNumbers(completion).every((n) => allowed.has(n));
}

// ----------------------------------------------------------------
// The corpus — shared-order cases (both reads see the same rows
// in the same order: the faithful-reconstruction question)
// ----------------------------------------------------------------
describe("SA-B9 ghost corpus — content cases (shared read order)", () => {
  const cases: Array<{ name: string; completion: string; expected: boolean; setup?: Parameters<typeof ghostSetup>[0]; partial?: string }> = [
    { name: "matched product price", completion: "দাম 1500 টাকা, অর্ডার করবেন?", expected: true },
    { name: "invented price", completion: "দাম 999 টাকা মাত্র", expected: false },
    { name: "unmatched product's price", completion: "Silk Saree-এর দাম 3200 টাকা", expected: false },
    { name: "profile description number (2015)", completion: "আমরা 2015 সাল থেকে সেবা দিচ্ছি", expected: true },
    { name: "policy number (return 9 days)", completion: "রিটার্ন 9 দিনের মধ্যে করা যাবে", expected: true },
    { name: "policy number (warranty 18 months)", completion: "ওয়ারেন্টি 18 মাস প্রযোজ্য", expected: true },
    { name: "matched product stock", completion: "স্টকে 12টি আছে", expected: true },
    { name: "delivery charge (fact-line only, 60)", completion: "ডেলিভারি চার্জ 60 টাকা হবে", expected: false },
    { name: "knowledge-doc number (48 hours)", completion: "হোম ডেলিভারি 48 ঘণ্টায় পৌঁছাবে", expected: false },
    {
      name: "discount present in a policy (15%)", completion: "এখন 15% ছাড় চলছে", expected: true,
      setup: { policies: [{ id: "pol-offer", organizationId: ORG, type: "offer", title: "ঈদ অফার", content: "ঈদ উপলক্ষে সব পণ্যে 15% ছাড়।" }] },
    },
    {
      name: "discount absent everywhere (15%)", completion: "এখন 15% ছাড় চলছে", expected: false,
      setup: { policies: [{ id: "pol-return", organizationId: ORG, type: "return", title: "রিটার্ন নীতি", content: "পণ্য পাওয়ার 9 দিনের মধ্যে রিটার্ন করা যাবে।" }] },
    },
    {
      name: "policy number beyond the 400-char slice",
      completion: "বিশেষ ফি 500 টাকা", expected: false,
      setup: { policies: [{ id: "pol-long", organizationId: ORG, type: "terms", title: "শর্তাবলি", content: `${"বিস্তারিত শর্তাবলি এখানে লেখা আছে। ".repeat(30)}শেষে বিশেষ ফি 500 টাকা।` }] },
    },
    {
      name: "thread number (order 8801 in history)", completion: "আপনার অর্ডার 8801 পথে আছে", expected: true,
      setup: { extraMessages: [{ id: "msg-out", conversationId: "conv-1", direction: "out", type: "text", content: "আপনার অর্ডার নম্বর 8801 কনফার্ম করা হয়েছে।", status: "sent", createdAt: PAST }] },
    },
    {
      name: "partial number (3 items)", completion: "এবারও 3টি পাঠাব?", expected: true,
      partial: "আপনি আগেরবার 3টি নিয়েছিলেন, ",
    },
  ];

  for (const c of cases) {
    it(`agrees: ${c.name}`, async () => {
      const s = ghostSetup(c.setup);
      const legacy = await legacyVerdict(s, c.completion, c.partial);
      const candidate = await candidateVerdict(s, c.completion, c.partial);
      expect(legacy).toBe(c.expected);
      expect(candidate).toBe(legacy);
    });
  }
});

// ----------------------------------------------------------------
// The naive variant — why "just use the fact pack" is NOT the
// migration: it admits numbers the legacy guard rejects.
// ----------------------------------------------------------------
describe("SA-B9 ghost corpus — the naive full-Brain set diverges", () => {
  it("delivery charge (60, fact-line only): legacy + faithful candidate reject, naive admits", async () => {
    const s = ghostSetup();
    const completion = "ডেলিভারি চার্জ 60 টাকা হবে";
    expect(await legacyVerdict(s, completion)).toBe(false);
    expect(await candidateVerdict(s, completion)).toBe(false);
    expect(await naiveVerdict(s, completion)).toBe(true);
  });

  it("knowledge-doc number (48): legacy + faithful candidate reject, naive admits", async () => {
    const s = ghostSetup();
    const completion = "হোম ডেলিভারি 48 ঘণ্টায় পৌঁছাবে";
    expect(await legacyVerdict(s, completion)).toBe(false);
    expect(await candidateVerdict(s, completion)).toBe(false);
    expect(await naiveVerdict(s, completion)).toBe(true);
  });
});

// ----------------------------------------------------------------
// THE DIVERGING CASE — the policy window. Neither read has an
// ORDER BY: the ghost reads policies take-10, the Brain reads
// take-20. Two unordered reads in production may observe
// different orders, so the ghost's 10 and the Brain's first-10
// are not provably the same rows. Simulated here exactly the
// way production can behave: each read observes its own order.
// ----------------------------------------------------------------
describe("SA-B9 ghost corpus — policy window divergence (the blocker)", () => {
  function twelvePolicySetup() {
    const policies: Row[] = Array.from({ length: 12 }, (_, i) => ({
      id: `pol-${i + 1}`, organizationId: ORG, type: "terms", title: `শর্ত ${i + 1}`,
      content: `এই নীতির শর্ত নম্বর ${7001 + i} প্রযোজ্য।`,
    }));
    const s = ghostSetup({ policies });
    // Model the two unordered reads observing different orders
    // (no ORDER BY exists in either query — production Postgres
    // owes no order, and different LIMITs commonly differ):
    // the ghost's take-10 lands in insertion order, the Brain's
    // take-20 lands reversed.
    s.db.businessPolicy.findMany = jest.fn(async ({ where, take }: any = {}) => {
      const rows = s.stores.businessPolicy.filter((r) => match(r, where));
      if (take === 20) return [...rows].reverse().slice(0, 20);
      return take ? rows.slice(0, take) : rows;
    });
    return s;
  }

  it("policy #12's number (7012): legacy rejects, Brain-derived admits — DIVERGES", async () => {
    const s = twelvePolicySetup();
    const completion = "শর্ত 7012 অনুযায়ী হবে";
    expect(await legacyVerdict(s, completion)).toBe(false);
    expect(await candidateVerdict(s, completion)).toBe(true);
  });

  it("policy #1's number (7001): legacy admits, Brain-derived rejects — DIVERGES the other way", async () => {
    const s = twelvePolicySetup();
    const completion = "শর্ত 7001 অনুযায়ী হবে";
    expect(await legacyVerdict(s, completion)).toBe(true);
    expect(await candidateVerdict(s, completion)).toBe(false);
  });

  it("pins the shipped behaviour: production ghostComplete follows the LEGACY verdicts", async () => {
    const s = twelvePolicySetup();
    expect(await legacyVerdict(s, "শর্ত 7001 অনুযায়ী হবে")).toBe(true);
    expect(await legacyVerdict(s, "শর্ত 7012 অনুযায়ী হবে")).toBe(false);
  });
});
