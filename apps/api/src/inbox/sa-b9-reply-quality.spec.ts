process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.DISABLE_SCHEDULER = "true";

import { InboxService } from "./inbox.service";
import { SocialCommentsService } from "./social-comments.service";
import { OrgBrainService } from "../ai/org-brain.service";
import { AnswerStoreService } from "../ai/answer-store.service";
import { REPLY_QUALITY_MARKER } from "../ai/reply-quality";

/**
 * SA-B9 (Smart AI Phase 1, R3): one reply-quality rule on every
 * channel — path-integration proofs.
 *
 * Every customer-facing compose (inbox autopilot, the order
 * bot's grounded branch which composes through it, the staff
 * draft's LLM branch, the comment autopilot) now carries the
 * SAME shared block from ai/reply-quality.ts: the marker, the
 * one language directive the shared resolver chose, the
 * natural-writing + honesty lines, and — for an org with an
 * ACTIVE learned voice — the styleInstructions rendered
 * identically on every path. These specs capture the real
 * prompts each path sends its provider and assert on them.
 *
 * Language cases: Bengali -> the Bengali directive; English ->
 * English; Banglish -> the mixed directive; an org-pinned
 * language wins over detection (the shipped IN7 owner rule);
 * a remembered preference applies when the message carries no
 * detectable language; and with no signal at all the default
 * is Bengali. The draft path gaining the detected + memory
 * rungs (it previously had ONLY the org rung) is the R3
 * behaviour change, asserted directly.
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
    findUnique: jest.fn(async ({ where }: any = {}) => {
      if (where && typeof where === "object" && where.organizationId_customerKey) {
        const k = where.organizationId_customerKey;
        return store.find((r) => r.organizationId === k.organizationId && r.customerKey === k.customerKey) ?? null;
      }
      return store.find((r) => match(r, where)) ?? null;
    }),
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
  "systemSetting", "subscription", "socialComment", "socialReplySetting",
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
// Fixtures
// ----------------------------------------------------------------
const BN_PRICE_Q = "Cotton Panjabi এর দাম কত? আর কি কি সাইজ আছে?"; // detects bn (the IN7-pinned string)
const EN_PRICE_Q = "What is the price of Cotton Panjabi?";
const MIXED_PRICE_Q = "আপনাদের Cotton Panjabi টার price কত হবে?"; // detects mixed
const VOICE_TRAITS = { formality: "friendly", emojiUse: "light", greetingStyle: null, languageMix: "bn", avgSentence: "short", signaturePhrases: [] as string[] };

function setup(opts: {
  aiReplyLanguage?: string | null;
  brandVoice?: string | null;
  voiceActive?: boolean;
  memoryPref?: string | null;
  llmText?: string;
} = {}) {
  const { db, stores } = makeDb();
  stores.organization.push({ id: ORG, name: "টেস্ট শপ" });
  stores.businessProfile.push({
    id: "prof-1", organizationId: ORG, industry: "fashion", description: "Clothing store",
    brandVoice: opts.brandVoice ?? null,
    goals: null, targetCustomers: null, uniqueSellingPoints: null, monthlyBudgetMinor: null,
    businessModel: null, tradeLicenseNo: null, billingEmails: null,
    deliveryChargeInsideMinor: 6000n, deliveryChargeOutsideMinor: 12000n, codAvailable: true,
    bkashNumber: "01712345678", contactPhone: "01712345678",
    aiInstructions: null, aiReplyLanguage: opts.aiReplyLanguage ?? null,
    createdAt: PAST, updatedAt: PAST,
  });
  stores.product.push({ id: "p1", organizationId: ORG, status: "ACTIVE", name: "Cotton Panjabi", priceMinor: 150000n, currency: "BDT", stockQuantity: 12, createdAt: PAST, updatedAt: PAST });
  if (opts.voiceActive) {
    stores.aiBrandVoiceProfile.push({
      id: "vp-1", organizationId: ORG, status: "active", traits: VOICE_TRAITS,
      exampleSnippets: [], pendingTraits: null, pendingExamples: null, createdAt: PAST, updatedAt: PAST,
    });
  }
  if (opts.memoryPref) {
    stores.customerMemory.push({
      id: "mem-1", organizationId: ORG, customerKey: "messenger:fb-customer-1", displayName: "রহিম",
      languagePref: opts.memoryPref, topics: [], orderCount: 1, lastOrderAt: null, notes: [],
      createdAt: PAST, updatedAt: PAST,
    });
  }
  stores.membership.push({ id: "m1", organizationId: ORG, userId: "agent-1", role: "OWNER" });
  const conv: Row = {
    id: "conv-1", organizationId: ORG, channel: "messenger", status: "open", customerId: null,
    externalContactId: "fb-customer-1", contactName: "রহিম", isPractice: false,
    assignedUserId: null, autoReplyPaused: false, tags: [], pipelineStage: "new", unreadCount: 0,
    createdAt: PAST, updatedAt: PAST, lastMessageAt: PAST,
  };
  stores.channelConversation.push(conv);
  const prompts: any[][] = [];
  const provider = {
    name: "fake-llm", isRealLlm: true,
    complete: jest.fn(async (msgs: any[]) => {
      prompts.push(msgs);
      // The comment compose's fact set carries no product price
      // (no product was matched there) — a price-quoting reply
      // would be guard-blocked, correctly. The comment path
      // gets a number-free grounded reply instead.
      const isComment = String(msgs?.[0]?.content ?? "").includes("social-media assistant");
      const text = isComment ? "ধন্যবাদ! বিস্তারিত জানতে পেজের ইনবক্সে মেসেজ করুন।" : (opts.llmText ?? "ধন্যবাদ! আর কিছু জানতে চাইলে বলুন।");
      return { text, inputTokens: 10, outputTokens: 5, tokensEstimated: false };
    }),
  };
  const llm = { forOrg: async () => provider, getProvider: () => provider };
  const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
  const service = new InboxService(db as any, audit as any, llm as any);
  const brain = new OrgBrainService(db as any);
  const storeSvc = new AnswerStoreService(db as any, undefined);
  const comments = new SocialCommentsService(db as any, audit as any, llm as any, brain as any, storeSvc as any);
  return { db, stores, service, comments, provider, prompts, conv };
}

const systemOf = (prompts: any[][], i = 0) => String(prompts[i]?.[0]?.content ?? "");

/** The rendered style segment of a prompt — the text the shared
 * block placed after the SA-B5 label, up to the facts section
 * (or the end of the system content on the draft path). */
function styleSegment(system: string): string | null {
  const m = system.match(/Style guidance from the shop's learned brand voice \(shapes WORDING ONLY — never facts, prices or promises\): ([\s\S]*?)(?:\n\nVERIFIED FACTS:|$)/);
  return m ? m[1] : null;
}

describe("SA-B9 autopilot compose — the shared block + the one language rule", () => {
  it("Bengali customer -> marker + the detected Bengali directive + natural/honesty lines", async () => {
    const s = setup({ llmText: "Cotton Panjabi-এর দাম 1500 টাকা।" });
    const out = await (s.service as any).composeLlmGroundedReply(ORG, s.conv, "price", BN_PRICE_Q);
    expect(out?.content).toContain("1500");
    const system = systemOf(s.prompts);
    expect(system).toContain(REPLY_QUALITY_MARKER);
    expect(system).toContain("Always reply in Bengali (the customer's last message is mainly in Bengali)");
    expect(system).toContain("Write naturally, like a helpful person in a real conversation");
    expect(system).toContain("Never invent offers, discounts, deadlines or promises");
  });

  it("English customer -> the detected English directive", async () => {
    const s = setup({ llmText: "The price of Cotton Panjabi is 1500 taka." });
    const out = await (s.service as any).composeLlmGroundedReply(ORG, s.conv, "price", EN_PRICE_Q);
    expect(out?.content).toContain("1500");
    const system = systemOf(s.prompts);
    expect(system).toContain(REPLY_QUALITY_MARKER);
    expect(system).toContain("Always reply in English (the customer's last message is mainly in English)");
  });

  it("Banglish customer -> the mixed directive (match the customer's mix, never force a pure language)", async () => {
    const s = setup({ llmText: "Cotton Panjabi-এর দাম 1500 টাকা।" });
    const out = await (s.service as any).composeLlmGroundedReply(ORG, s.conv, "price", MIXED_PRICE_Q);
    expect(out?.content).toContain("1500");
    const system = systemOf(s.prompts);
    expect(system).toContain("Reply in the same mix of Bengali and English (Banglish) as the customer's last message.");
    expect(system).not.toContain("Always reply in Bengali.");
    expect(system).not.toContain("Always reply in English.");
  });

  it("org-pinned English wins over a Bengali customer (owner rule, through the block)", async () => {
    const s = setup({ aiReplyLanguage: "en", llmText: "The price is 1500 taka." });
    const out = await (s.service as any).composeLlmGroundedReply(ORG, s.conv, "price", BN_PRICE_Q);
    expect(out).toBeTruthy();
    const system = systemOf(s.prompts);
    expect(system).toContain(REPLY_QUALITY_MARKER);
    expect(system).toContain("Always reply in English.");
    expect(system).not.toContain("mainly in Bengali");
  });

  it("no detectable language in the message -> the remembered preference speaks", async () => {
    const s = setup({ memoryPref: "en", llmText: "Thanks for messaging us!" });
    const out = await (s.service as any).composeLlmGroundedReply(ORG, s.conv, "other", "😊👍");
    expect(out?.content).toContain("Thanks");
    const system = systemOf(s.prompts);
    expect(system).toContain(REPLY_QUALITY_MARKER);
    expect(system).toContain("This customer usually writes in English — reply in that language.");
  });

  it("no signal at all -> the Bengali default, honestly labelled by the plain forced line", async () => {
    const s = setup({ llmText: "ধন্যবাদ! বলুন কী জানতে চান।" });
    const out = await (s.service as any).composeLlmGroundedReply(ORG, s.conv, "other", "😊👍");
    expect(out).toBeTruthy();
    const system = systemOf(s.prompts);
    expect(system).toContain(REPLY_QUALITY_MARKER);
    expect(system).toContain("Always reply in Bengali.");
    expect(system).not.toContain("usually writes in");
  });

  it("no voice profile -> quality block only, no style artefact in the prompt", async () => {
    const s = setup({ llmText: "Cotton Panjabi-এর দাম 1500 টাকা।" });
    await (s.service as any).composeLlmGroundedReply(ORG, s.conv, "price", BN_PRICE_Q);
    const system = systemOf(s.prompts);
    expect(system).toContain(REPLY_QUALITY_MARKER);
    expect(system).not.toContain("Style guidance");
    expect(styleSegment(system)).toBeNull();
  });
});

describe("SA-B9 one block, every channel — identical style rendering", () => {
  it("autopilot, draft and comment prompts carry the SAME rendered style for a voice-active org", async () => {
    const s = setup({ voiceActive: true, llmText: "Cotton Panjabi-এর দাম 1500 টাকা।" });

    // Autopilot
    await (s.service as any).composeLlmGroundedReply(ORG, s.conv, "price", BN_PRICE_Q);
    const autoSystem = systemOf(s.prompts, 0);
    expect(autoSystem).toContain(REPLY_QUALITY_MARKER);
    const autoStyle = styleSegment(autoSystem);
    expect(autoStyle).toContain("Tone: friendly");

    // Draft (staff suggestion) — the customer's Bengali question
    // now drives the language through the detected rung the
    // draft path never had before R3.
    s.stores.channelMessage.push({ id: "dm-1", conversationId: "conv-1", direction: "in", type: "text", content: "আপনাদের ডেলিভারি চার্জ কত টাকা?", status: "received", createdAt: PAST });
    const draft = await s.service.suggestDraft(ORG, "agent-1", "conv-1");
    expect(draft?.content).toBeTruthy();
    const draftSystem = systemOf(s.prompts, 1);
    expect(draftSystem).toContain(REPLY_QUALITY_MARKER);
    expect(draftSystem).toContain("Always reply in Bengali (the customer's last message is mainly in Bengali)");
    expect(styleSegment(draftSystem)).toBe(autoStyle);

    // Comment autopilot — same org, same voice.
    const composed = await (s.comments as any).composeGroundedCommentReply(ORG, {
      comment: { id: "cmt-1", platform: "facebook", authorSocialId: null },
      commentText: "ডেলিভারি চার্জ কত টাকা?",
      plan: { classification: {}, matchedProduct: null, isNightOwl: false, aiPlan: null },
      allowStore: false,
    });
    expect(composed?.via).toBe("llm");
    const commentSystem = systemOf(s.prompts, 2);
    expect(commentSystem).toContain(REPLY_QUALITY_MARKER);
    expect(commentSystem).toContain("Always reply in Bengali (the customer's last message is mainly in Bengali)");
    expect(styleSegment(commentSystem)).toBe(autoStyle);
  });

  it("the order bot's grounded branch composes through the same block (usageFeature order_bot)", async () => {
    const s = setup({ llmText: "Cotton Panjabi-এর দাম 1500 টাকা।" });
    const out = await (s.service as any).composeLlmGroundedReply(ORG, s.conv, "price", BN_PRICE_Q, { usageFeature: "order_bot" });
    expect(out?.content).toContain("1500");
    const system = systemOf(s.prompts);
    expect(system).toContain(REPLY_QUALITY_MARKER);
    expect(system).toContain("Always reply in Bengali (the customer's last message is mainly in Bengali)");
    expect(s.stores.aIUsageRecord.some((u: Row) => u.feature === "order_bot")).toBe(true);
  });

  it("owner brandVoice precedence survives inside the shared block (SA-B5 rule unchanged)", async () => {
    const s = setup({ voiceActive: true, brandVoice: "সবসময় 'আপনি' বলে সম্বোধন করবেন।", llmText: "Cotton Panjabi-এর দাম 1500 টাকা।" });
    await (s.service as any).composeLlmGroundedReply(ORG, s.conv, "price", BN_PRICE_Q);
    const seg = styleSegment(systemOf(s.prompts));
    expect(seg).toContain("Owner's brand voice — standing instruction; it takes precedence over the learned style below wherever they conflict:");
    expect(seg).toContain("সবসময় 'আপনি' বলে সম্বোধন করবেন।");
    expect(seg).toContain("Tone: friendly");
  });
});
