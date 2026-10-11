import "reflect-metadata";
import { InboxService } from "./inbox.service";
import { AiInstructionsService } from "./ai-instructions.service";
import { AiInstructionsController } from "./ai-instructions.controller";
import { ROLES_KEY } from "../common/decorators";

/**
 * CX2 — AI Instructions Desk.
 *
 * Draft → test → publish → rollback over BusinessProfile, the
 * version history (AiInstructionVersion), the Desk test seam
 * (InboxService.testComposeReply reusing the real compose
 * pipeline with an instructions override), and the unanswered-
 * question capture (AiUnansweredQuestion) at the autopilot's
 * knowledge_gap / no_answer / low_confidence exits.
 *
 * Fake prisma + stubbed LLM at the established seams — no live
 * DB and no live AI call anywhere in this file.
 */
type Row = Record<string, any>;
function match(row: Row, where: any = {}): boolean {
  return Object.entries(where).every(([k, raw]) => {
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
function sortRows(rows: Row[], orderBy: any): Row[] {
  if (!orderBy) return rows;
  const entries = Object.entries(orderBy);
  if (!entries.length) return rows;
  const [key, dir] = entries[0] as [string, string];
  return [...rows].sort((a, b) => {
    const av = a[key] instanceof Date ? new Date(a[key]).getTime() : a[key];
    const bv = b[key] instanceof Date ? new Date(b[key]).getTime() : b[key];
    const cmp = (av ?? 0) < (bv ?? 0) ? -1 : (av ?? 0) > (bv ?? 0) ? 1 : 0;
    return dir === "desc" ? -cmp : cmp;
  });
}
function table(store: Row[]) {
  return {
    findMany: jest.fn(async ({ where, take, orderBy }: any = {}) => {
      const rows = sortRows(store.filter((r) => match(r, where)), orderBy);
      return take ? rows.slice(0, take) : rows;
    }),
    findFirst: jest.fn(async ({ where, orderBy }: any = {}) => {
      const rows = sortRows(store.filter((r) => match(r, where)), orderBy);
      return rows[0] ?? null;
    }),
    findUnique: jest.fn(async ({ where }: any = {}) => store.find((r) => match(r, where)) ?? null),
    create: jest.fn(async ({ data }: any) => { const row = { id: `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...data }; store.push(row); return row; }),
    update: jest.fn(async ({ where, data }: any) => { const row = store.find((r) => r.id === where.id || match(r, where)); if (!row) throw new Error("nf"); Object.assign(row, data); return row; }),
    upsert: jest.fn(async ({ where, update, create }: any) => {
      const row = store.find((r) => match(r, where));
      if (row) { Object.assign(row, update); return row; }
      const created = { id: `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      store.push(created); return created;
    }),
    count: jest.fn(async ({ where }: any = {}) => store.filter((r) => match(r, where)).length),
  };
}

const ORG = "org-1";
const ORG_B = "org-2";
const LIVE = "লাইভ নির্দেশনা: ভদ্রভাবে উত্তর দিন।";
const DRAFT = "খসড়া নির্দেশনা: শুধু টেস্টের জন্য।";

function setup(llmProvider?: any) {
  const settings: Row[] = [{ id: "s1", organizationId: ORG, autoReplyMode: "auto", confidenceThreshold: 70, perIntent: {}, smartAssign: "off", slaFirstResponseMinutes: 60, perChannelModes: {}, escalationThresholdMinor: null }];
  const profiles: Row[] = [{ id: "bp1", organizationId: ORG, aiInstructions: LIVE, aiInstructionsDraft: null, aiReplyLanguage: "bn", contactPhone: "01711111111" }];
  const products: Row[] = [
    { id: "p1", organizationId: ORG, name: "কটন শাড়ি", priceMinor: 120000n, currency: "BDT", stockQuantity: 5, status: "ACTIVE", createdAt: new Date("2026-01-01") },
  ];
  const conversations: Row[] = [];
  const messages: Row[] = [];
  const drafts: Row[] = [];
  const versions: Row[] = [];
  const unanswered: Row[] = [];
  const usage: Row[] = [];
  const organizations: Row[] = [{ id: ORG, name: "টেস্ট শপ" }];
  const systemSettings: Row[] = [];
  const db = {
    inboxSetting: table(settings),
    businessProfile: table(profiles),
    product: table(products),
    businessPolicy: table([] as Row[]),
    knowledgeDocument: table([] as Row[]),
    order: table([] as Row[]),
    channelConversation: table(conversations),
    channelMessage: table(messages),
    messageDraft: table(drafts),
    aiInstructionVersion: table(versions),
    aiUnansweredQuestion: table(unanswered),
    aIUsageRecord: table(usage),
    organization: table(organizations),
    systemSetting: table(systemSettings),
    subscription: table([] as Row[]),
    membership: table([] as Row[]),
  };
  const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
  const llm = { getProvider: () => { if (!llmProvider) throw new Error("no provider configured"); return llmProvider; } };
  const inbox = new InboxService(db as any, audit as any, llm as any);
  const desk = new AiInstructionsService(db as any, audit as any, inbox as any);
  return { inbox, desk, db, audit, profiles, products, versions, unanswered, usage, conversations, messages, drafts, systemSettings, organizations };
}
function conv(over: Row = {}): Row {
  return { id: `c-${Math.random().toString(36).slice(2, 8)}`, organizationId: ORG, channel: "webchat", status: "open", assignedUserId: null, priority: "normal", sentimentFlag: null, autoReplyPaused: false, customerId: null, contactName: "রহিম", createdAt: new Date(), lastMessageAt: new Date(), firstResponseAt: new Date(), ...over };
}
const realProvider = (text: string, capture?: any[]) => ({
  name: "fake-llm",
  isRealLlm: true,
  complete: jest.fn(async (messages: any[]) => {
    capture?.push(messages);
    return { text, model: "fake-1", inputTokens: 10, outputTokens: 5, tokensEstimated: false };
  }),
});
const statusOf = (e: any) => (e?.getStatus ? e.getStatus() : e?.status);

describe("CX2 publish flow: draft is a working copy, publish makes it live + versioned", () => {
  it("draft save never touches published; publish writes aiInstructions + v1, second publish v2", async () => {
    const { desk, profiles, versions, audit } = setup();
    const s0 = await desk.getState(ORG);
    expect(s0.published).toBe(LIVE);
    expect(s0.draft).toBe(LIVE); // effective draft falls back to published
    expect(s0.hasUnpublishedChanges).toBe(false);
    expect(s0.latestVersion).toBeNull();

    const s1 = await desk.saveDraft(ORG, DRAFT);
    expect(s1.draft).toBe(DRAFT);
    expect(s1.published).toBe(LIVE);
    expect(s1.hasUnpublishedChanges).toBe(true);
    expect(profiles[0].aiInstructions).toBe(LIVE); // consumers' column untouched

    const p1 = await desk.publish(ORG, "owner-1", "প্রথম প্রকাশ");
    expect(p1.version).toBe(1);
    expect(p1.published).toBe(DRAFT);
    expect(p1.hasUnpublishedChanges).toBe(false);
    expect(p1.latestVersion).toBe(1);
    expect(profiles[0].aiInstructions).toBe(DRAFT);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ organizationId: ORG, version: 1, instructions: DRAFT, replyLanguage: "bn", note: "প্রথম প্রকাশ", publishedById: "owner-1" });
    expect(audit.calls.some((a) => a.action === "ai_instructions.published" && a.metadata?.version === 1)).toBe(true);

    await desk.saveDraft(ORG, "দ্বিতীয় খসড়া");
    const p2 = await desk.publish(ORG, "owner-1");
    expect(p2.version).toBe(2);
    expect(versions).toHaveLength(2);
    expect(versions[1]).toMatchObject({ version: 2, instructions: "দ্বিতীয় খসড়া", note: null });
    const listed = await desk.listVersions(ORG);
    expect(listed.map((v: any) => v.version)).toEqual([2, 1]); // desc
  });

  it("draft save creates the BusinessProfile row when the org has none yet", async () => {
    const { desk, profiles } = setup();
    profiles.length = 0;
    const s = await desk.saveDraft(ORG, "প্রথম খসড়া");
    expect(profiles).toHaveLength(1);
    expect(profiles[0].aiInstructionsDraft).toBe("প্রথম খসড়া");
    expect(s.published).toBeNull();
    expect(s.draft).toBe("প্রথম খসড়া");
    expect(s.hasUnpublishedChanges).toBe(true);
  });
});

describe("CX2 consumers see the published text only", () => {
  it("buildFactPack reads aiInstructions (not the draft); the override swaps it for one compose", async () => {
    const { inbox, desk } = setup();
    await desk.saveDraft(ORG, DRAFT);
    const stub = conv();
    const pack = await (inbox as any).buildFactPack(ORG, stub, "price", "কটন শাড়ি এর দাম কত?");
    expect(pack.ownerInstructions).toBe(LIVE);
    expect(pack.replyLanguage).toBe("bn");
    const overridden = await (inbox as any).buildFactPack(ORG, stub, "price", "কটন শাড়ি এর দাম কত?", { instructions: DRAFT, replyLanguage: "en" });
    expect(overridden.ownerInstructions).toBe(DRAFT);
    expect(overridden.replyLanguage).toBe("en");
  });

  it("Desk test with useDraft=false sends the LIVE instructions to the LLM; useDraft=true sends the draft", async () => {
    const captured: any[] = [];
    const { desk } = setup(realProvider("আমাদের ফোন নম্বর 01711111111।", captured));
    await desk.saveDraft(ORG, DRAFT);
    const q = "যোগাযোগের নম্বরটা দেবেন?";
    const liveRes: any = await desk.test(ORG, { question: q, useDraft: false });
    expect(liveRes.noAnswer).toBe(false);
    expect(liveRes.answer).toContain("01711111111");
    const livePrompt = captured[0][0].content as string;
    expect(livePrompt).toContain(LIVE);
    expect(livePrompt).not.toContain(DRAFT);

    const draftRes: any = await desk.test(ORG, { question: q, useDraft: true });
    expect(draftRes.noAnswer).toBe(false);
    const draftPrompt = captured[1][0].content as string;
    expect(draftPrompt).toContain(DRAFT);
    expect(draftPrompt).not.toContain(LIVE);
  });
});

describe("CX2 rollback: faithful restore + a NEW version row; history untouched", () => {
  it("rollback to v1 restores text + language into published AND draft, appends v3", async () => {
    const { desk, profiles, versions, audit } = setup();
    await desk.saveDraft(ORG, "প্রথম সংস্করণ");
    const p1 = await desk.publish(ORG, "owner-1", "v1 নোট");
    profiles[0].aiReplyLanguage = "en"; // language changed later, outside the Desk
    await desk.saveDraft(ORG, "দ্বিতীয় সংস্করণ");
    await desk.publish(ORG, "owner-1", "v2 নোট");
    expect(profiles[0].aiInstructions).toBe("দ্বিতীয় সংস্করণ");
    expect(versions[1].replyLanguage).toBe("en");

    const v1Row = versions.find((v) => v.version === 1);
    const state = await desk.rollback(ORG, "admin-1", v1Row!.id);
    expect(state.published).toBe("প্রথম সংস্করণ");
    expect(state.draft).toBe("প্রথম সংস্করণ");
    expect(state.hasUnpublishedChanges).toBe(false);
    expect(profiles[0].aiInstructionsDraft).toBe("প্রথম সংস্করণ");
    expect(profiles[0].aiReplyLanguage).toBe("bn"); // v1's language restored
    expect(versions).toHaveLength(3);
    const v3 = versions.find((v) => v.version === 3);
    expect(v3!).toMatchObject({ instructions: "প্রথম সংস্করণ", replyLanguage: "bn", publishedById: "admin-1" });
    expect(v3!.note).toContain("v1");
    expect(v3!.note).toContain("রোলব্যাক");
    // history rows are never rewritten
    expect(versions.find((v) => v.version === 1)).toMatchObject({ instructions: "প্রথম সংস্করণ", note: "v1 নোট" });
    expect(versions.find((v) => v.version === 2)).toMatchObject({ instructions: "দ্বিতীয় সংস্করণ", note: "v2 নোট" });
    expect(p1.version).toBe(1);
    expect(audit.calls.some((a) => a.action === "ai_instructions.rollback" && a.metadata?.fromVersion === 1 && a.metadata?.newVersion === 3)).toBe(true);
  });
});

describe("CX2 roles: drafting is MARKETING_MANAGER work; publish/rollback are OWNER/ADMIN", () => {
  it("controller @Roles metadata matches the brief", () => {
    expect(Reflect.getMetadata(ROLES_KEY, AiInstructionsController.prototype.saveDraft)).toEqual(["OWNER", "ADMIN", "MARKETING_MANAGER"]);
    expect(Reflect.getMetadata(ROLES_KEY, AiInstructionsController.prototype.test)).toEqual(["OWNER", "ADMIN", "MARKETING_MANAGER"]);
    expect(Reflect.getMetadata(ROLES_KEY, AiInstructionsController.prototype.updateUnansweredStatus)).toEqual(["OWNER", "ADMIN", "MARKETING_MANAGER"]);
    expect(Reflect.getMetadata(ROLES_KEY, AiInstructionsController.prototype.publish)).toEqual(["OWNER", "ADMIN"]);
    expect(Reflect.getMetadata(ROLES_KEY, AiInstructionsController.prototype.rollback)).toEqual(["OWNER", "ADMIN"]);
    // reads carry no @Roles — any org member (TenantGuard still applies)
    expect(Reflect.getMetadata(ROLES_KEY, AiInstructionsController.prototype.getState)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, AiInstructionsController.prototype.versions)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, AiInstructionsController.prototype.unanswered)).toBeUndefined();
  });
});

describe("CX2 Desk test endpoint: real compose pipeline, instructions_test usage, kill switch + cap", () => {
  it("deterministic tier answers a price question without any LLM call", async () => {
    const { desk, usage } = setup(); // no provider at all
    const res: any = await desk.test(ORG, { question: "কটন শাড়ি এর দাম কত?", useDraft: false });
    expect(res.noAnswer).toBe(false);
    expect(res.answer).toContain("কটন শাড়ি");
    expect(res.intent).toBe("price");
    expect(res.model).toBeNull(); // deterministic evidence carries no provider
    expect(usage).toHaveLength(0);
  });

  it("LLM tier answer is returned with its model and an instructions_test usage row", async () => {
    const { desk, usage } = setup(realProvider("আমাদের ফোন নম্বর 01711111111।"));
    const res: any = await desk.test(ORG, { question: "যোগাযোগের নম্বরটা দেবেন?", useDraft: true });
    expect(res.noAnswer).toBe(false);
    expect(res.answer).toContain("01711111111");
    expect(res.model).toBe("fake-llm");
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ organizationId: ORG, feature: "instructions_test", provider: "fake-llm" });
  });

  it("stubbed LLM NO_ANSWER -> noAnswer true, and the Desk test records NO unanswered question", async () => {
    const { desk, unanswered } = setup(realProvider("NO_ANSWER"));
    const res: any = await desk.test(ORG, { question: "যোগাযোগের নম্বরটা দেবেন?", useDraft: false });
    expect(res.noAnswer).toBe(true);
    expect(res.answer).toBeNull();
    expect(unanswered).toHaveLength(0); // captureUnanswered: false on the test seam
  });

  it("kill switch -> 403 before any compose", async () => {
    const { desk, systemSettings } = setup(realProvider("আমাদের ফোন নম্বর 01711111111।"));
    systemSettings.push({ key: "killSwitches", value: { aiDisabledOrgIds: [ORG] } });
    let caught: any = null;
    try { await desk.test(ORG, { question: "যোগাযোগের নম্বরটা দেবেন?", useDraft: false }); } catch (e) { caught = e; }
    expect(caught).not.toBeNull();
    expect(statusOf(caught)).toBe(403);
  });

  it("daily cap counts ONLY instructions_test usage -> 429 once reached", async () => {
    const { desk, usage, organizations } = setup(realProvider("আমাদের ফোন নম্বর 01711111111।"));
    organizations[0].aiDailyLimitOverride = 2;
    organizations[0].broadcastCapOverride = null;
    // other features' usage never counts against the Desk test cap
    usage.push(
      { id: "u-a", organizationId: ORG, feature: "autopilot", provider: "fake-llm", createdAt: new Date() },
      { id: "u-b", organizationId: ORG, feature: "autopilot", provider: "fake-llm", createdAt: new Date() },
      { id: "u-c", organizationId: ORG, feature: "autopilot", provider: "fake-llm", createdAt: new Date() },
      { id: "u-1", organizationId: ORG, feature: "instructions_test", provider: "fake-llm", createdAt: new Date() },
    );
    const ok: any = await desk.test(ORG, { question: "যোগাযোগের নম্বরটা দেবেন?", useDraft: false });
    expect(ok.noAnswer).toBe(false); // 1 < 2: the test itself adds the 2nd instructions_test row
    let caught: any = null;
    try { await desk.test(ORG, { question: "যোগাযোগের নম্বরটা দেবেন?", useDraft: false }); } catch (e) { caught = e; }
    expect(caught).not.toBeNull();
    expect(statusOf(caught)).toBe(429);
  });
});

describe("CX2 unanswered capture at the autopilot exits", () => {
  it("no fact pack -> knowledge_gap row with conversation + channel", async () => {
    const { inbox, unanswered } = setup(realProvider("কিছু একটা"));
    const c = conv();
    const out = await (inbox as any).composeLlmGroundedReply(ORG, c, "price", "সোনার চেইন এর দাম কত?");
    expect(out).toBeNull();
    expect(unanswered).toHaveLength(1);
    expect(unanswered[0]).toMatchObject({
      organizationId: ORG, conversationId: c.id, channel: "webchat",
      questionText: "সোনার চেইন এর দাম কত?", reason: "knowledge_gap", status: "open", count: 1,
    });
  });

  it("fact pack + provider NO_ANSWER -> no_answer; same question within 24h dedupes to count 2", async () => {
    const { inbox, unanswered } = setup(realProvider("NO_ANSWER"));
    const c = conv();
    await (inbox as any).composeLlmGroundedReply(ORG, c, "price", "কটন শাড়ি এর দাম কত?");
    await (inbox as any).composeLlmGroundedReply(ORG, c, "price", "  কটন   শাড়ি এর দাম কত? ");
    expect(unanswered).toHaveLength(1);
    expect(unanswered[0].reason).toBe("no_answer");
    expect(unanswered[0].count).toBe(2);
    expect(unanswered[0].lastSeenAt).toBeTruthy();
  });

  it("an OPEN row older than 24h does NOT dedupe — a fresh row is created", async () => {
    const { inbox, unanswered } = setup(realProvider("NO_ANSWER"));
    unanswered.push({
      id: "old-1", organizationId: ORG, conversationId: "c-old", channel: "webchat",
      questionText: "কটন শাড়ি এর দাম কত?", normalizedQuestion: "কটন শাড়ি এর দাম কত?",
      reason: "no_answer", status: "open", count: 3,
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000), lastSeenAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    });
    const c = conv();
    await (inbox as any).composeLlmGroundedReply(ORG, c, "price", "কটন শাড়ি এর দাম কত?");
    expect(unanswered).toHaveLength(2);
    expect(unanswered.find((u) => u.id === "old-1")?.count).toBe(3);
  });

  it("number-guard rejection is NOT captured as unanswered (already audit-logged)", async () => {
    const { inbox, unanswered, audit } = setup(realProvider("অফার চলছে! মাত্র ৫০ টাকায় পাবেন!"));
    const c = conv();
    const out = await (inbox as any).composeLlmGroundedReply(ORG, c, "price", "কটন শাড়ি এর দাম কত?");
    expect(out).toBeNull();
    expect(audit.calls.some((a) => a.action === "inbox.autopilot.guard_rejected")).toBe(true);
    expect(unanswered).toHaveLength(0);
  });

  it("low-confidence drop in maybeAutoReply (whitelisted intent) -> low_confidence, and nothing is sent", async () => {
    const { inbox, unanswered, conversations, messages } = setup();
    const c = conv(); conversations.push(c);
    await (inbox as any).maybeAutoReply(ORG, c, { intent: "price", confidence: 50, sentiment: null }, "কটন শাড়ি এর দাম কত?");
    expect(unanswered).toHaveLength(1);
    expect(unanswered[0]).toMatchObject({ organizationId: ORG, reason: "low_confidence", status: "open" });
    expect(messages.filter((m) => m.autoReply)).toHaveLength(0);
  });

  it("capture failure never breaks compose or maybeAutoReply (failure isolation)", async () => {
    const { inbox, db, conversations } = setup(realProvider("NO_ANSWER"));
    (db.aiUnansweredQuestion as any).create = jest.fn(async () => { throw new Error("db down"); });
    const c = conv(); conversations.push(c);
    // knowledge_gap path with a throwing create: compose still returns null, no throw
    await expect((inbox as any).composeLlmGroundedReply(ORG, c, "price", "সোনার চেইন এর দাম কত?")).resolves.toBeNull();
    // low-confidence path with a throwing create: maybeAutoReply still resolves
    await expect((inbox as any).maybeAutoReply(ORG, c, { intent: "price", confidence: 10, sentiment: null }, "কটন শাড়ি এর দাম কত?")).resolves.toBeUndefined();
  });
});

describe("CX2 unanswered triage + tenant isolation", () => {
  it("status update validates the enum, updates + audits; bad status -> 400", async () => {
    const { desk, unanswered, audit } = setup();
    unanswered.push({ id: "q1", organizationId: ORG, conversationId: "c1", channel: "messenger", questionText: "প্রশ্ন?", normalizedQuestion: "প্রশ্ন?", reason: "no_answer", status: "open", count: 1, createdAt: new Date(), lastSeenAt: new Date() });
    const updated = await desk.updateUnansweredStatus(ORG, "mm-1", "q1", "resolved");
    expect(updated.status).toBe("resolved");
    expect(audit.calls.some((a) => a.action === "ai_instructions.unanswered_status" && a.metadata?.status === "resolved")).toBe(true);
    let caught: any = null;
    try { await desk.updateUnansweredStatus(ORG, "mm-1", "q1", "banana"); } catch (e) { caught = e; }
    expect(statusOf(caught)).toBe(400);
  });

  it("org B's versions and unanswered rows are invisible to org A; cross-org rollback/status -> 404", async () => {
    const { desk, versions, unanswered, profiles } = setup();
    profiles.push({ id: "bpB", organizationId: ORG_B, aiInstructions: "B এর নির্দেশনা", aiInstructionsDraft: null, aiReplyLanguage: null });
    await desk.saveDraft(ORG_B, "B এর খসড়া");
    await desk.publish(ORG_B, "owner-b");
    await desk.saveDraft(ORG, "A এর খসড়া");
    await desk.publish(ORG, "owner-a");
    unanswered.push(
      { id: "qA", organizationId: ORG, conversationId: "cA", channel: "webchat", questionText: "A প্রশ্ন", normalizedQuestion: "a প্রশ্ন", reason: "no_answer", status: "open", count: 1, createdAt: new Date(), lastSeenAt: new Date() },
      { id: "qB", organizationId: ORG_B, conversationId: "cB", channel: "webchat", questionText: "B প্রশ্ন", normalizedQuestion: "b প্রশ্ন", reason: "no_answer", status: "open", count: 1, createdAt: new Date(), lastSeenAt: new Date() },
    );
    const aVersions = await desk.listVersions(ORG);
    expect(aVersions).toHaveLength(1);
    expect(aVersions[0].instructions).toBe("A এর খসড়া");
    const aUnanswered = await desk.listUnanswered(ORG);
    expect(aUnanswered.map((u: any) => u.id)).toEqual(["qA"]);

    const bVersion = versions.find((v) => v.organizationId === ORG_B);
    let caught: any = null;
    try { await desk.rollback(ORG, "owner-a", bVersion!.id); } catch (e) { caught = e; }
    expect(statusOf(caught)).toBe(404);

    let caught2: any = null;
    try { await desk.updateUnansweredStatus(ORG, "owner-a", "qB", "resolved"); } catch (e) { caught2 = e; }
    expect(statusOf(caught2)).toBe(404);
    expect(unanswered.find((u) => u.id === "qB")?.status).toBe("open");
  });
});
