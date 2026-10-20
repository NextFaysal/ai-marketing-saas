process.env.JWT_SECRET = "test-secret";
process.env.WEB_URL = "https://app.example.com";
process.env.API_PUBLIC_URL = "https://api.example.com";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import { MessagingService, MESSAGING_AI_FEATURE } from "./messaging.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * MX6 — Two-way & Interactive Campaigns: rule validation
 * (reserved STOP/START refused incl. Bengali, duplicate claims
 * refused incl. across a poll's options + against other rules,
 * WhatsApp-only honest refusal, action-required), inbound
 * matching with per-action outcomes (customer Json tag append +
 * dedupe, lead fallback, conversation tag, opted-out sender →
 * auto-reply skipped but tag applied, no reply port → skipped
 * honestly, port failure → failed with the real reason), the
 * reserved-word guarantee at this layer (STOP never produces a
 * hit), poll votes + latest-wins tally, the AI classification
 * suggestion workflow through the MS9 guard path (kill switch
 * 403 / cap 429 / dev provider 502 — nothing stored; confirm
 * interest tags the conversation; confirm opt-out writes NO
 * preference row), and the delivery → inbox conversationId
 * bridge (digit-normalized WhatsApp match, sms → null, no
 * conversation → null). Fake-prisma style like the MS specs.
 */
const cmp = (a: any, b: any) => {
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  return av < bv ? -1 : av > bv ? 1 : 0;
};
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (k === "OR") return (v as any[]).some((sub) => matches(row, sub));
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("not" in v) {
        if (v.not === null) { if (row[k] === null || row[k] === undefined) return false; }
        else if (row[k] === v.not) return false;
      }
      if ("in" in v && !v.in.includes(row[k])) return false;
      if ("contains" in v && !String(row[k] ?? "").includes(String(v.contains))) return false;
      if ("gt" in v && !(cmp(row[k], v.gt) > 0)) return false;
      if ("gte" in v && !(cmp(row[k], v.gte) >= 0)) return false;
      if ("lt" in v && !(cmp(row[k], v.lt) < 0)) return false;
      if ("lte" in v && !(cmp(row[k], v.lte) <= 0)) return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v instanceof Date) return cmp(row[k], v) === 0;
    return row[k] === v;
  });
}
function applyOrder(list: any[], orderBy: any): any[] {
  if (!orderBy) return list;
  const keys = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...list];
  for (let i = keys.length - 1; i >= 0; i--) {
    const [key, dir] = Object.entries(keys[i])[0] as [string, string];
    out.sort((a, b) => (dir === "desc" ? cmp(b[key], a[key]) : cmp(a[key], b[key])));
  }
  return out;
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where, take, orderBy }: any = {}) => {
      const f = applyOrder(rows.filter((r) => matches(r, where ?? {})), orderBy);
      return take ? f.slice(0, take) : f;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (row) { Object.assign(row, data); row.updatedAt = new Date(); }
      return row;
    },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); if (i >= 0) rows.splice(i, 1); return {}; },
  };
}

const TABLE_NAMES = [
  "messagingKeywordRule", "messagingKeywordHit", "messagePreference", "customer", "lead",
  "channelConversation", "messageDelivery", "aIUsageRecord", "businessProfile", "product",
];

function build(llmFactory?: any) {
  const tables: Record<string, any> = {};
  for (const n of TABLE_NAMES) tables[n] = makeTable(n);
  const settingValues: Record<string, unknown> = {};
  tables.systemSetting = {
    findUnique: async ({ where }: any) => (where.key in settingValues ? { key: where.key, value: settingValues[where.key] } : null),
  };
  const orgRow: any = { aiDailyLimitOverride: null, broadcastCapOverride: null, seatLimit: null };
  tables.organization = { findUnique: async () => orgRow };
  tables.subscription = { findFirst: async () => null };
  const audit = { log: async () => undefined } as any;
  const email = { isConfigured: () => true, send: async () => ({ providerMessageId: "x" }) } as any;
  const sms = { isConfigured: () => true, send: async () => ({ providerMessageId: "y" }) } as any;
  const svc = new MessagingService(tables as any, audit, email, sms, llmFactory);
  return { svc, tables, settingValues, orgRow };
}

function realProvider(text: string) {
  return {
    name: "openai", isRealLlm: true,
    complete: async () => ({ text, model: "gpt-test", inputTokens: 7, outputTokens: 3, tokensEstimated: false }),
  };
}
const factoryOf = (provider: any) => ({ getProvider: () => provider });
const statusOf = (e: any) => (typeof e?.getStatus === "function" ? e.getStatus() : e?.status);

const CONV = { id: "conv-1", externalContactId: "8801712345678", customerId: "cust-1", leadId: null as string | null };

function seedConversation(tables: any, over: any = {}) {
  tables.channelConversation.rows.push({
    id: "conv-1", organizationId: "org-1", channel: "whatsapp",
    externalContactId: "8801712345678", customerId: "cust-1", leadId: null, tags: [],
    ...over,
  });
}

describe("MX6 rule validation", () => {
  it("refuses reserved keywords — Latin STOP, lowercase start, and the Bengali STOP words", async () => {
    const { svc } = build();
    for (const kw of ["STOP", "stop all", "Unsubscribe", "start", "বন্ধ করুন", "স্টপ", "চালু করুন"]) {
      const err = await svc.createKeywordRule("org-1", "user-1", { name: "R", kind: "keyword", keyword: kw, tag: "x", applyTagTo: ["customer"] }).catch((e) => e);
      expect(statusOf(err)).toBe(400);
      expect(err.code).toBe("messaging.keywordIsAReservedKeywordSTOP2");
    }
  });

  it("refuses a reserved keyword inside a poll option", async () => {
    const { svc } = build();
    const err = await svc.createKeywordRule("org-1", "user-1", {
      name: "P", kind: "poll",
      pollOptions: [
        { key: "a", label: "হ্যাঁ", keywords: ["YES"] },
        { key: "b", label: "না", keywords: ["STOP"] },
      ],
    }).catch((e) => e);
    expect(statusOf(err)).toBe(400);
    expect(err.code).toBe("messaging.kIsAReservedKeywordSTOP");
  });

  it("refuses duplicate claims: against another rule (case-insensitive) and inside another poll's options", async () => {
    const { svc } = build();
    await svc.createKeywordRule("org-1", "user-1", { name: "Offer", kind: "keyword", keyword: "OFFER", tag: "interested", applyTagTo: ["customer"] });
    const dup = await svc.createKeywordRule("org-1", "user-1", { name: "Offer2", kind: "keyword", keyword: "offer", autoReplyText: "hi" }).catch((e) => e);
    expect(statusOf(dup)).toBe(400);
    expect(dup.code).toBe("messaging.keywordNkIsAlreadyClaimedBy");
    const dupPoll = await svc.createKeywordRule("org-1", "user-1", {
      name: "P", kind: "poll",
      pollOptions: [
        { key: "a", label: "A", keywords: ["OFFER"] },
        { key: "b", label: "B", keywords: ["NO"] },
      ],
    }).catch((e) => e);
    expect(statusOf(dupPoll)).toBe(400);
    // A keyword repeated across ONE poll's own options is refused too.
    const selfDup = await svc.createKeywordRule("org-1", "user-1", {
      name: "P2", kind: "poll",
      pollOptions: [
        { key: "a", label: "A", keywords: ["YES"] },
        { key: "b", label: "B", keywords: ["yes"] },
      ],
    }).catch((e) => e);
    expect(statusOf(selfDup)).toBe(400);
    expect(selfDup.code).toBe("messaging.pollKeywordKIsClaimedBy");
  });

  it("a DISABLED rule claims nothing — its keyword can be re-claimed", async () => {
    const { svc } = build();
    const r = await svc.createKeywordRule("org-1", "user-1", { name: "Old", kind: "keyword", keyword: "DEAL", tag: "x", applyTagTo: ["customer"] });
    await svc.updateKeywordRule("org-1", "user-1", r.id, { enabled: false });
    const ok = await svc.createKeywordRule("org-1", "user-1", { name: "New", kind: "keyword", keyword: "deal", autoReplyText: "আসসালামু আলাইকুম" });
    expect(ok.keyword).toBe("deal");
  });

  it("refuses non-whatsapp channels with the honest no-inbound-path reason", async () => {
    const { svc } = build();
    const smsErr = await svc.createKeywordRule("org-1", "user-1", { name: "S", kind: "keyword", channel: "sms", keyword: "OFFER", tag: "x", applyTagTo: ["customer"] }).catch((e) => e);
    expect(statusOf(smsErr)).toBe(400);
    expect(smsErr.code).toBe("messaging.keywordCampaignsAreWhatsAppOnlyIn");
    expect(smsErr.code).toBe("messaging.keywordCampaignsAreWhatsAppOnlyIn");
    const emailErr = await svc.createKeywordRule("org-1", "user-1", { name: "E", kind: "keyword", channel: "email", keyword: "OFFER", tag: "x", applyTagTo: ["customer"] }).catch((e) => e);
    expect(statusOf(emailErr)).toBe(400);
    expect(emailErr.code).toBe("messaging.keywordCampaignsAreWhatsAppOnlyIn");
  });

  it("refuses a keyword rule with no action, and polls carrying actions", async () => {
    const { svc } = build();
    const noAction = await svc.createKeywordRule("org-1", "user-1", { name: "N", kind: "keyword", keyword: "HELLO" }).catch((e) => e);
    expect(statusOf(noAction)).toBe(400);
    expect(noAction.code).toBe("messaging.aKeywordRuleNeedsAtLeast");
    const pollTag = await svc.createKeywordRule("org-1", "user-1", {
      name: "P", kind: "poll", tag: "x", applyTagTo: ["customer"],
      pollOptions: [
        { key: "a", label: "A", keywords: ["YES"] },
        { key: "b", label: "B", keywords: ["NO"] },
      ],
    }).catch((e) => e);
    expect(statusOf(pollTag)).toBe(400);
    const oneOption = await svc.createKeywordRule("org-1", "user-1", {
      name: "P1", kind: "poll",
      pollOptions: [{ key: "a", label: "A", keywords: ["YES"] }],
    }).catch((e) => e);
    expect(statusOf(oneOption)).toBe(400);
  });
});

describe("MX6 inbound matching + actions", () => {
  it("applies the customer tag (Json append, others preserved) and dedupes on a second reply", async () => {
    const { svc, tables } = build();
    seedConversation(tables);
    tables.customer.rows.push({ id: "cust-1", organizationId: "org-1", tags: ["vip"] });
    await svc.createKeywordRule("org-1", "user-1", { name: "Offer", kind: "keyword", keyword: "OFFER", tag: "interested", applyTagTo: ["customer"] });
    const first = await svc.handleKeywordReply("org-1", { ...CONV }, "  offer ");
    expect(first.matched).toBe(true);
    expect(tables.customer.rows[0].tags).toEqual(["vip", "interested"]);
    expect(tables.messagingKeywordHit.rows).toHaveLength(1);
    expect(tables.messagingKeywordHit.rows[0].actions).toEqual([
      { action: "tag", target: "customer", entity: "customer", status: "applied" },
    ]);
    const second = await svc.handleKeywordReply("org-1", { ...CONV }, "OFFER");
    expect(second.matched).toBe(true);
    expect(tables.customer.rows[0].tags).toEqual(["vip", "interested"]);
    expect(tables.messagingKeywordHit.rows[1].actions[0].status).toBe("skipped");
    expect(tables.messagingKeywordHit.rows[1].actions[0].reason).toContain("already present");
  });

  it("customer target falls back to the linked lead; lead + conversation targets tag their own rows", async () => {
    const { svc, tables } = build();
    seedConversation(tables, { customerId: null, leadId: "lead-1", tags: ["old"] });
    tables.lead.rows.push({ id: "lead-1", organizationId: "org-1", tags: [] });
    await svc.createKeywordRule("org-1", "user-1", {
      name: "Info", kind: "keyword", keyword: "INFO", tag: "asked-info", applyTagTo: ["customer", "conversation"],
    });
    const res = await svc.handleKeywordReply("org-1", { id: "conv-1", externalContactId: "8801712345678", customerId: null, leadId: "lead-1" }, "INFO");
    expect(res.matched).toBe(true);
    expect(tables.lead.rows[0].tags).toEqual(["asked-info"]);
    expect(tables.channelConversation.rows[0].tags).toEqual(["old", "asked-info"]);
    const actions = tables.messagingKeywordHit.rows[0].actions;
    expect(actions[0]).toMatchObject({ target: "customer", entity: "lead", status: "applied" });
    expect(actions[1]).toMatchObject({ target: "conversation", entity: "conversation", status: "applied" });
  });

  it("opted-out sender: tag still applies, auto-reply is skipped with the reason, port never called", async () => {
    const { svc, tables } = build();
    seedConversation(tables);
    tables.customer.rows.push({ id: "cust-1", organizationId: "org-1", tags: [] });
    await svc.setPreference("org-1", { channel: "whatsapp", address: "8801712345678", status: "opted_out", source: "manual" });
    let portCalls = 0;
    svc.registerInboxReplyPort({ sendConversationText: async () => { portCalls++; return { providerMessageId: "wamid.x" }; } });
    await svc.createKeywordRule("org-1", "user-1", {
      name: "Offer", kind: "keyword", keyword: "OFFER", tag: "interested", applyTagTo: ["customer"],
      autoReplyText: "ধন্যবাদ! অফারের বিস্তারিত পাঠানো হলো।",
    });
    const res = await svc.handleKeywordReply("org-1", { ...CONV }, "OFFER");
    expect(res.matched).toBe(true);
    expect(portCalls).toBe(0);
    expect(tables.customer.rows[0].tags).toEqual(["interested"]);
    const actions = tables.messagingKeywordHit.rows[0].actions;
    expect(actions.find((a: any) => a.action === "auto_reply")).toEqual({ action: "auto_reply", status: "skipped", reason: "sender opted out" });
  });

  it("no reply port registered: auto-reply skipped honestly, the hit is still recorded", async () => {
    const { svc, tables } = build();
    seedConversation(tables);
    await svc.createKeywordRule("org-1", "user-1", { name: "Hi", kind: "keyword", keyword: "HELLO", autoReplyText: "হ্যালো!" });
    const res = await svc.handleKeywordReply("org-1", { ...CONV }, "HELLO");
    expect(res.matched).toBe(true);
    expect(tables.messagingKeywordHit.rows).toHaveLength(1);
    const action = tables.messagingKeywordHit.rows[0].actions[0];
    expect(action.status).toBe("skipped");
    expect(action.reason).toContain("not available");
  });

  it("port success records the provider message id; port failure records failed + the real error", async () => {
    const { svc, tables } = build();
    seedConversation(tables);
    await svc.createKeywordRule("org-1", "user-1", { name: "Hi", kind: "keyword", keyword: "HELLO", autoReplyText: "হ্যালো!" });
    svc.registerInboxReplyPort({ sendConversationText: async () => ({ providerMessageId: "wamid.42" }) });
    await svc.handleKeywordReply("org-1", { ...CONV }, "HELLO");
    expect(tables.messagingKeywordHit.rows[0].actions[0]).toEqual({ action: "auto_reply", status: "applied", providerMessageId: "wamid.42" });
    svc.registerInboxReplyPort({ sendConversationText: async () => { throw new Error("Meta 131030: recipient not in allowed list"); } });
    await svc.handleKeywordReply("org-1", { ...CONV }, "HELLO");
    const failed = tables.messagingKeywordHit.rows[1].actions[0];
    expect(failed.status).toBe("failed");
    expect(failed.reason).toContain("131030");
  });

  it("STOP / START texts never produce a hit at this layer; non-campaign chatter writes no row", async () => {
    const { svc, tables } = build();
    seedConversation(tables);
    tables.customer.rows.push({ id: "cust-1", organizationId: "org-1", tags: [] });
    await svc.createKeywordRule("org-1", "user-1", { name: "Offer", kind: "keyword", keyword: "OFFER", tag: "interested", applyTagTo: ["customer"] });
    for (const text of ["STOP", "স্টপ", "START", "বন্ধ করুন"]) {
      const res = await svc.handleKeywordReply("org-1", { ...CONV }, text);
      expect(res.matched).toBe(false);
    }
    const chatter = await svc.handleKeywordReply("org-1", { ...CONV }, "দাম কত ভাই?");
    expect(chatter.matched).toBe(false);
    expect(tables.messagingKeywordHit.rows).toHaveLength(0);
    expect(tables.customer.rows[0].tags).toEqual([]);
  });
});

describe("MX6 polls", () => {
  async function seedPoll(svc: MessagingService) {
    return svc.createKeywordRule("org-1", "user-1", {
      name: "ডেলিভারি পোল", kind: "poll",
      pollOptions: [
        { key: "home", label: "হোম ডেলিভারি", keywords: ["HOME", "বাসা"] },
        { key: "pickup", label: "পিকআপ", keywords: ["PICKUP", "দোকান"] },
      ],
    });
  }

  it("a vote records pollOptionKey with NO actions; a changed vote moves the tally (latest wins, distinct conversations)", async () => {
    const { svc, tables } = build();
    const poll = await seedPoll(svc);
    const convA = { id: "conv-a", externalContactId: "8801000000001", customerId: null, leadId: null };
    const convB = { id: "conv-b", externalContactId: "8801000000002", customerId: null, leadId: null };
    const v1 = await svc.handleKeywordReply("org-1", convA, "বাসা");
    expect(v1).toMatchObject({ matched: true, pollOptionKey: "home" });
    expect(tables.messagingKeywordHit.rows[0].actions).toBeNull();
    await svc.handleKeywordReply("org-1", convB, "HOME");
    let tally = await svc.getKeywordPollTally("org-1", poll.id);
    expect(tally.totalVoters).toBe(2);
    expect(tally.options).toEqual([
      { key: "home", label: "হোম ডেলিভারি", votes: 2 },
      { key: "pickup", label: "পিকআপ", votes: 0 },
    ]);
    // A changes their mind: only the LATEST vote counts.
    await svc.handleKeywordReply("org-1", convA, "দোকান");
    tally = await svc.getKeywordPollTally("org-1", poll.id);
    expect(tally.totalVoters).toBe(2);
    expect(tally.options).toEqual([
      { key: "home", label: "হোম ডেলিভারি", votes: 1 },
      { key: "pickup", label: "পিকআপ", votes: 1 },
    ]);
    expect(tables.messagingKeywordHit.rows).toHaveLength(3);
  });

  it("tally on a keyword rule is an honest 400", async () => {
    const { svc } = build();
    const rule = await svc.createKeywordRule("org-1", "user-1", { name: "K", kind: "keyword", keyword: "OFFER", tag: "x", applyTagTo: ["customer"] });
    const err = await svc.getKeywordPollTally("org-1", rule.id).catch((e) => e);
    expect(statusOf(err)).toBe(400);
  });
});

describe("MX6 AI classification (suggestions only)", () => {
  async function seedHit(svc: MessagingService, tables: any, text = "আমি এটা কিনতে চাই, দাম কত?") {
    seedConversation(tables);
    await svc.createKeywordRule("org-1", "user-1", { name: "Buy", kind: "keyword", keyword: "BUY", tag: "x", applyTagTo: ["conversation"] });
    tables.messagingKeywordHit.rows.push({
      id: "hit-1", organizationId: "org-1", ruleId: "r", conversationId: "conv-1",
      customerId: "cust-1", leadId: null, matchedText: text, matchedKeyword: "BUY",
      pollOptionKey: null, actions: null, suggestedLabel: null, classifyStatus: null, confirmedLabel: null,
      createdAt: new Date(),
    });
  }

  it("classify stores a suggestion and applies NOTHING (no tag, no preference, one usage record)", async () => {
    const { svc, tables } = build(factoryOf(realProvider(JSON.stringify({ label: "interest" }))));
    await seedHit(svc, tables);
    const updated = await svc.classifyKeywordHit("org-1", "user-1", "hit-1");
    expect(updated.suggestedLabel).toBe("interest");
    expect(updated.classifyStatus).toBe("suggested");
    expect(updated.confirmedLabel).toBeNull();
    expect(tables.channelConversation.rows[0].tags).toEqual([]);
    expect(tables.messagePreference.rows).toHaveLength(0);
    expect(tables.aIUsageRecord.rows).toHaveLength(1);
    expect(tables.aIUsageRecord.rows[0].feature).toBe(MESSAGING_AI_FEATURE);
  });

  it("confirm interest tags the conversation with the label; confirm opt-out writes NO preference row", async () => {
    const { svc, tables } = build(factoryOf(realProvider(JSON.stringify({ label: "interest" }))));
    await seedHit(svc, tables);
    await svc.classifyKeywordHit("org-1", "user-1", "hit-1");
    const confirmed = await svc.applyKeywordHitLabel("org-1", "user-1", "hit-1", "confirm");
    expect(confirmed.classifyStatus).toBe("confirmed");
    expect(confirmed.confirmedLabel).toBe("interest");
    expect(confirmed.conversationTagged).toBe(true);
    expect(tables.channelConversation.rows[0].tags).toEqual(["interest"]);

    // A separate org state classified as opt-out: confirming
    // stores the label ONLY — suppression is the real STOP
    // path's job, never a suggestion confirm.
    const b2 = build(factoryOf(realProvider(JSON.stringify({ label: "opt-out" }))));
    seedConversation(b2.tables);
    b2.tables.messagingKeywordHit.rows.push({
      id: "hit-9", organizationId: "org-1", ruleId: "r", conversationId: "conv-1",
      customerId: "cust-1", leadId: null, matchedText: "আর মেসেজ পাঠাবেন না", matchedKeyword: "X",
      pollOptionKey: null, actions: null, suggestedLabel: null, classifyStatus: null, confirmedLabel: null,
      createdAt: new Date(),
    });
    await b2.svc.classifyKeywordHit("org-1", "user-1", "hit-9");
    const confirmed2 = await b2.svc.applyKeywordHitLabel("org-1", "user-1", "hit-9", "confirm");
    expect(confirmed2.confirmedLabel).toBe("opt-out");
    expect(b2.tables.messagePreference.rows).toHaveLength(0);
    expect(b2.tables.channelConversation.rows[0].tags).toEqual([]);
  });

  it("dismiss stores dismissed and applies nothing; deciding without a suggestion is a 400", async () => {
    const { svc, tables } = build(factoryOf(realProvider(JSON.stringify({ label: "complaint" }))));
    await seedHit(svc, tables);
    const early = await svc.applyKeywordHitLabel("org-1", "user-1", "hit-1", "confirm").catch((e) => e);
    expect(statusOf(early)).toBe(400);
    await svc.classifyKeywordHit("org-1", "user-1", "hit-1");
    const dismissed = await svc.applyKeywordHitLabel("org-1", "user-1", "hit-1", "dismiss");
    expect(dismissed.classifyStatus).toBe("dismissed");
    expect(dismissed.confirmedLabel).toBeNull();
    expect(tables.channelConversation.rows[0].tags).toEqual([]);
  });

  it("kill switch ⇒ the MS9 403 with NO stored suggestion; daily cap ⇒ 429 likewise", async () => {
    const ks = build(factoryOf(realProvider(JSON.stringify({ label: "interest" }))));
    await seedHit(ks.svc, ks.tables);
    ks.settingValues.killSwitches = { aiDisabledOrgIds: ["org-1"], broadcastsPaused: false };
    const err = await ks.svc.classifyKeywordHit("org-1", "user-1", "hit-1").catch((e) => e);
    expect(statusOf(err)).toBe(403);
    expect(ks.tables.messagingKeywordHit.rows[0].suggestedLabel).toBeNull();
    expect(ks.tables.aIUsageRecord.rows).toHaveLength(0);

    const cap = build(factoryOf(realProvider(JSON.stringify({ label: "interest" }))));
    await seedHit(cap.svc, cap.tables);
    cap.orgRow.aiDailyLimitOverride = 1;
    cap.tables.aIUsageRecord.rows.push({ id: "u-0", organizationId: "org-1", feature: MESSAGING_AI_FEATURE, createdAt: new Date() });
    const err2 = await cap.svc.classifyKeywordHit("org-1", "user-1", "hit-1").catch((e) => e);
    expect(statusOf(err2)).toBe(429);
    expect(cap.tables.messagingKeywordHit.rows[0].suggestedLabel).toBeNull();
  });

  it("dev provider ⇒ honest 502, no suggestion stored (a template adapter cannot classify)", async () => {
    const { svc, tables } = build(factoryOf(new DevTemplateProvider()));
    await seedHit(svc, tables);
    const err = await svc.classifyKeywordHit("org-1", "user-1", "hit-1").catch((e) => e);
    expect(statusOf(err)).toBe(502);
    expect(tables.messagingKeywordHit.rows[0].suggestedLabel).toBeNull();
    expect(tables.aIUsageRecord.rows).toHaveLength(0);
  });

  it("an off-vocabulary LLM answer ⇒ 502 and nothing stored", async () => {
    const { svc, tables } = build(factoryOf(realProvider(JSON.stringify({ label: "maybe-buying" }))));
    await seedHit(svc, tables);
    const err = await svc.classifyKeywordHit("org-1", "user-1", "hit-1").catch((e) => e);
    expect(statusOf(err)).toBe(502);
    expect(tables.messagingKeywordHit.rows[0].suggestedLabel).toBeNull();
    expect(tables.aIUsageRecord.rows).toHaveLength(0);
  });
});

describe("MX6 delivery → inbox conversationId bridge", () => {
  function seedDeliveries(tables: any) {
    tables.channelConversation.rows.push({
      id: "conv-wa", organizationId: "org-1", channel: "whatsapp", externalContactId: "8801712345678", tags: [],
    });
    tables.channelConversation.rows.push({
      id: "conv-other-org", organizationId: "org-2", channel: "whatsapp", externalContactId: "8801999999999", tags: [],
    });
    const base = { organizationId: "org-1", broadcastId: "bc-1", status: "sent", createdAt: new Date() };
    tables.messageDelivery.rows.push(
      { ...base, id: "d-wa", channel: "whatsapp", address: "+880 1712-345678" },
      { ...base, id: "d-sms", channel: "sms", address: "8801712345678" },
      { ...base, id: "d-wa-none", channel: "whatsapp", address: "8801555555555" },
      { ...base, id: "d-email", channel: "email", address: "a@x.com" },
    );
  }

  it("legacy listing: whatsapp rows resolve by digits-only match; sms/email/no-conversation → null", async () => {
    const { svc, tables } = build();
    seedDeliveries(tables);
    const rows: any[] = await svc.listDeliveries("org-1", "bc-1") as any[];
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.conversationId]));
    expect(byId["d-wa"]).toBe("conv-wa");
    expect(byId["d-sms"]).toBeNull();
    expect(byId["d-wa-none"]).toBeNull();
    expect(byId["d-email"]).toBeNull();
  });

  it("paged listing carries conversationId too", async () => {
    const { svc, tables } = build();
    seedDeliveries(tables);
    const page: any = await svc.listDeliveries("org-1", "bc-1", {});
    const wa = page.items.find((r: any) => r.id === "d-wa");
    expect(wa.conversationId).toBe("conv-wa");
    expect(page.items.find((r: any) => r.id === "d-sms").conversationId).toBeNull();
  });
});
