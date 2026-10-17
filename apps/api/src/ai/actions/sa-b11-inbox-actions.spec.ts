import "reflect-metadata";
import { ActionEngineService } from "./action-engine.service";
import { ActionExecutorsService } from "./action-executors.service";
import { InboxActionProposerService } from "./inbox-action-proposer.service";
import { InboxService } from "../../inbox/inbox.service";
import { SocialCommentsService } from "../../inbox/social-comments.service";
import { EventsService } from "../../common/events.service";

/**
 * SA-B11 (Smart AI Phase 2, W2) — Inbox Actions guarantees:
 *  - the five remaining inbox catalog entries (assign / tag /
 *    reopen / mark-spam / block) execute through the REAL staff
 *    service paths (InboxService.updateConversation /
 *    setConversationBlocked) and are verified by read-back;
 *  - payload validation follows the services' own rules: tags
 *    go through normalizeTags + merge; a non-member assignee is
 *    refused by updateConversation itself and lands on the
 *    proposal as a FAILED outcome (verbatim), never a crash and
 *    never a silent assignment;
 *  - open-proposal dedupe: the same (org, action, conversation)
 *    — plus the tag set for tag_conversation — returns the
 *    existing OPEN proposal; a rejected one blocks nothing;
 *  - the three deterministic proposers: (A) a completed order-
 *    bot order proposes close_conversation; (B) a fresh spam-
 *    detector flag proposes block_sender (the detector flags,
 *    it never blocks — and mark_conversation_spam is not
 *    re-proposed for a flag the detector already wrote);
 *    (C) suggestNextAction's "resolve" / tags are recorded as
 *    engine proposals while its response contract is unchanged;
 *  - autonomy interplay through the real trigger path: L2
 *    auto-executes + verifies the close, L1 leaves it proposed,
 *    L0 creates no proposal rows at all;
 *  - an ordinary inbound message creates no proposals;
 *  - cross-org targets are refused by the builders.
 *
 * Fake prisma only — the SA-B10 table pattern. The only stubs
 * are at the platform/LLM edges (a fake LLM provider for
 * suggestNextAction, and instance-level stubs for the bot's
 * createChatOrder/botSend in the completion test, whose subject
 * is the completion EMIT, not order creation — that pipeline
 * has its own suites).
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
    if (k === "organizationId_actionId" && v && typeof v === "object") {
      return row.organizationId === v.organizationId && row.actionId === v.actionId;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v.in as any[]).includes(row[k]);
      if ("not" in v) {
        if (v.not === null) return row[k] !== null && row[k] !== undefined;
        return !eqVal(row[k], v.not);
      }
      return true;
    }
    return eqVal(row[k], v);
  });
}
function table(store: Row[]) {
  return {
    findMany: jest.fn(async ({ where, take, orderBy }: any = {}) => {
      let rows = store.filter((r) => match(r, where));
      if (orderBy?.createdAt === "desc") rows = [...rows].reverse();
      return take ? rows.slice(0, take) : rows;
    }),
    findFirst: jest.fn(async ({ where }: any = {}) => store.find((r) => match(r, where)) ?? null),
    findUnique: jest.fn(async ({ where }: any = {}) => store.find((r) => match(r, where)) ?? null),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      store.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = store.find((r) => r.id === where.id || match(r, where));
      if (!row) throw new Error("nf");
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let n = 0;
      for (const r of store) if (match(r, where)) { Object.assign(r, data, { updatedAt: new Date() }); n++; }
      return { count: n };
    }),
    upsert: jest.fn(async ({ where, create, update }: any) => {
      const row = store.find((r) => match(r, where));
      if (row) { Object.assign(row, update, { updatedAt: new Date() }); return row; }
      const created = { id: `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      store.push(created);
      return created;
    }),
    count: jest.fn(async ({ where }: any = {}) => store.filter((r) => match(r, where)).length),
  };
}

const ORG = "org-1";
const ORG_B = "org-2";
const OWNER = "owner-1";
const AGENT = "agent-1";

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

function setup(opts: { withProposer?: boolean; llmProvider?: any } = {}) {
  const conversations: Row[] = [
    { id: "conv-1", organizationId: ORG, status: "open", contactName: "রহিম", externalContactId: "psid-1", channel: "webchat", tags: ["vip"], spamFlag: false, blockedAt: null, assignedUserId: null, csatSentAt: null, customerId: "cust-1", pipelineStage: "new" },
    { id: "conv-2", organizationId: ORG, status: "closed", contactName: "করিম", externalContactId: "psid-2", channel: "webchat", tags: [], spamFlag: false, blockedAt: null, assignedUserId: null, csatSentAt: new Date(), resolvedAt: new Date(), customerId: null, pipelineStage: "new" },
    { id: "conv-b", organizationId: ORG_B, status: "open", contactName: "অন্য দোকান", externalContactId: "psid-9", channel: "webchat", tags: [], spamFlag: false, blockedAt: null, assignedUserId: null, csatSentAt: null, customerId: null, pipelineStage: "new" },
  ];
  const messages: Row[] = [];
  const sessions: Row[] = [];
  const proposals: Row[] = [];
  const settings: Row[] = [];
  const aiActions: Row[] = [];
  const db = {
    channelConversation: table(conversations),
    channelMessage: table(messages),
    botSession: table(sessions),
    socialComment: table([] as Row[]),
    integration: table([] as Row[]),
    membership: table([
      { id: "m1", organizationId: ORG, userId: OWNER, role: "OWNER", status: "ACTIVE" },
      { id: "m2", organizationId: ORG, userId: AGENT, role: "AGENT", status: "ACTIVE" },
      { id: "m3", organizationId: ORG_B, userId: "owner-b", role: "OWNER", status: "ACTIVE" },
    ] as Row[]),
    order: table([] as Row[]),
    customer: table([{ id: "cust-1", organizationId: ORG, firstName: "রহিম", phone: "01710000000" }] as Row[]),
    aIActionProposal: table(proposals),
    aiAutonomySetting: table(settings),
    aIAction: table(aiActions),
    aIUsageRecord: table([] as Row[]),
    platformSetting: table([] as Row[]),
    organization: table([{ id: ORG, name: "টেস্ট শপ" }, { id: ORG_B, name: "অন্য" }] as Row[]),
    subscription: table([] as Row[]),
    inboxSetting: table([] as Row[]),
    inboxTeam: table([] as Row[]),
    inboxTeamMember: table([] as Row[]),
    conversationNote: table([] as Row[]),
    agentNotification: table([] as Row[]),
    businessProfile: table([] as Row[]),
  };
  const auditCalls: any[] = [];
  const audit = { log: jest.fn(async (e: any) => { auditCalls.push(e); }) };
  const llm = { getProvider: () => { if (opts.llmProvider) return opts.llmProvider; throw new Error("no provider configured"); } };
  const events = new EventsService();
  const inbox = new InboxService(db as any, audit as any, llm as any, events as any);
  const social = new SocialCommentsService(db as any, audit as any);
  const executors = new ActionExecutorsService(db as any, inbox, social);
  const engine = new ActionEngineService(db as any, audit as any, executors);
  const proposer = new InboxActionProposerService(engine, events);
  if (opts.withProposer) proposer.onModuleInit();
  return { db, engine, executors, inbox, social, events, proposer, audit, auditCalls, conversations, messages, sessions, proposals, settings, aiActions };
}

describe("SA-B11 Item 1 — inbox executors through the real staff paths", () => {
  it("assign_conversation: propose → approve assigns via updateConversation and the verifier reads it back", async () => {
    const s = setup();
    const res: any = await s.engine.propose(ORG, "assign_conversation", { conversationId: "conv-1", assignedUserId: AGENT }, { proposedBy: "ai", actorUserId: null });
    expect(res.ok).toBe(true);
    expect(res.proposal.status).toBe("proposed");
    expect(s.conversations[0].assignedUserId).toBeNull(); // nothing executed yet
    const done: any = await s.engine.approve(ORG, OWNER, res.proposal.id);
    expect(done.status).toBe("executed");
    expect(done.result.outcome).toBe("verified_success");
    expect(done.verification.detail.observedAssignee).toBe(AGENT);
    expect(s.conversations[0].assignedUserId).toBe(AGENT);
  });

  it("assign_conversation: unassign (null) is a real, verifiable act", async () => {
    const s = setup();
    s.conversations[0].assignedUserId = AGENT;
    const res: any = await s.engine.propose(ORG, "assign_conversation", { conversationId: "conv-1", assignedUserId: null }, { proposedBy: "staff", actorUserId: OWNER });
    const done: any = await s.engine.approve(ORG, OWNER, res.proposal.id);
    expect(done.status).toBe("executed");
    expect(s.conversations[0].assignedUserId).toBeNull();
  });

  it("assign_conversation: a non-member assignee is refused by the staff path itself — FAILED proposal, error verbatim, no assignment, no crash", async () => {
    const s = setup();
    const res: any = await s.engine.propose(ORG, "assign_conversation", { conversationId: "conv-1", assignedUserId: "ghost-9" }, { proposedBy: "ai", actorUserId: null });
    expect(res.ok).toBe(true); // the proposal is recorded; validation lives in the real path
    expect(res.proposal.preview).toContain("সদস্য নন"); // the human was warned at propose time
    const done: any = await s.engine.approve(ORG, OWNER, res.proposal.id);
    expect(done.status).toBe("failed");
    expect(done.error).toContain("not a member of this organization");
    expect(s.conversations[0].assignedUserId).toBeNull(); // the assignment never happened
    expect(s.aiActions.some((r) => r.args?.phase === "failed" && r.status === "error")).toBe(true);
  });

  it("tag_conversation: merges + normalizes through the inbox's own rules (existing tags kept, dupes dropped)", async () => {
    const s = setup();
    const res: any = await s.engine.propose(ORG, "tag_conversation", { conversationId: "conv-1", addTags: [" Urgent ", "VIP", "follow-up"] }, { proposedBy: "ai", actorUserId: null });
    expect(res.ok).toBe(true);
    // "VIP" is already on the thread (conv tags: ["vip"]) — the builder keeps only fresh tags.
    expect(res.proposal.payload.addTags).toEqual(["Urgent", "follow-up"]);
    const done: any = await s.engine.approve(ORG, OWNER, res.proposal.id);
    expect(done.status).toBe("executed");
    expect(s.conversations[0].tags).toEqual(["vip", "Urgent", "follow-up"]);
    expect(done.verification.detail.missing).toEqual([]);
  });

  it("tag_conversation: proposing only already-present tags is refused by the builder", async () => {
    const s = setup();
    await expect(s.engine.propose(ORG, "tag_conversation", { conversationId: "conv-1", addTags: ["VIP"] }, { proposedBy: "ai", actorUserId: null }))
      .rejects.toThrow(/ইতিমধ্যে আছে/);
    expect(s.proposals).toHaveLength(0);
  });

  it("reopen_conversation: a closed thread reopens via updateConversation (resolvedAt cleared); an open one is refused", async () => {
    const s = setup();
    const res: any = await s.engine.propose(ORG, "reopen_conversation", { conversationId: "conv-2" }, { proposedBy: "staff", actorUserId: OWNER });
    const done: any = await s.engine.approve(ORG, OWNER, res.proposal.id);
    expect(done.status).toBe("executed");
    expect(s.conversations[1].status).toBe("open");
    expect(s.conversations[1].resolvedAt).toBeNull();
    await expect(s.engine.propose(ORG, "reopen_conversation", { conversationId: "conv-1" }, { proposedBy: "staff", actorUserId: OWNER }))
      .rejects.toThrow(/ইতিমধ্যে খোলা/);
  });

  it("mark_conversation_spam: flags via updateConversation; an already-flagged thread is refused", async () => {
    const s = setup();
    const res: any = await s.engine.propose(ORG, "mark_conversation_spam", { conversationId: "conv-1" }, { proposedBy: "ai", actorUserId: null });
    const done: any = await s.engine.approve(ORG, OWNER, res.proposal.id);
    expect(done.status).toBe("executed");
    expect(s.conversations[0].spamFlag).toBe(true);
    await expect(s.engine.propose(ORG, "mark_conversation_spam", { conversationId: "conv-1" }, { proposedBy: "ai", actorUserId: null }))
      .rejects.toThrow(/ইতিমধ্যে স্প্যাম/);
  });

  it("block_sender: blocks via setConversationBlocked (blockedAt stamped, spamFlag follows as the path's own side effect)", async () => {
    const s = setup();
    const res: any = await s.engine.propose(ORG, "block_sender", { conversationId: "conv-1", reason: "বারবার স্প্যাম" }, { proposedBy: "ai", actorUserId: null });
    const done: any = await s.engine.approve(ORG, OWNER, res.proposal.id);
    expect(done.status).toBe("executed");
    expect(done.result.outcome).toBe("verified_success");
    expect(s.conversations[0].blockedAt).toBeTruthy();
    expect(s.conversations[0].spamFlag).toBe(true); // setConversationBlocked's own side effect
    // Already blocked → builder refuses.
    await expect(s.engine.propose(ORG, "block_sender", { conversationId: "conv-1" }, { proposedBy: "ai", actorUserId: null }))
      .rejects.toThrow(/ইতিমধ্যে ব্লক/);
  });

  it("cross-org: another org's conversation is not found by the builders", async () => {
    const s = setup();
    await expect(s.engine.propose(ORG, "assign_conversation", { conversationId: "conv-b", assignedUserId: AGENT }, { proposedBy: "ai", actorUserId: null }))
      .rejects.toThrow(/not found/i);
    await expect(s.engine.propose(ORG, "block_sender", { conversationId: "conv-b" }, { proposedBy: "ai", actorUserId: null }))
      .rejects.toThrow(/not found/i);
    expect(s.proposals).toHaveLength(0);
  });
});

describe("SA-B11 Item 2 — open-proposal dedupe (engine-level)", () => {
  it("the same trigger twice yields ONE open proposal (the second call returns it, flagged deduped)", async () => {
    const s = setup();
    const first: any = await s.engine.propose(ORG, "close_conversation", { conversationId: "conv-1" }, { proposedBy: "ai", actorUserId: null, sourceRef: { trigger: "order_bot_completed" } });
    const second: any = await s.engine.propose(ORG, "close_conversation", { conversationId: "conv-1" }, { proposedBy: "ai", actorUserId: null, sourceRef: { trigger: "order_bot_completed" } });
    expect(first.deduped).toBeUndefined();
    expect(second.deduped).toBe(true);
    expect(second.proposal.id).toBe(first.proposal.id);
    expect(s.proposals).toHaveLength(1);
  });

  it("a REJECTED proposal does not block a fresh one from the same trigger", async () => {
    const s = setup();
    const first: any = await s.engine.propose(ORG, "close_conversation", { conversationId: "conv-1" }, { proposedBy: "ai", actorUserId: null });
    await s.engine.reject(ORG, OWNER, first.proposal.id);
    const second: any = await s.engine.propose(ORG, "close_conversation", { conversationId: "conv-1" }, { proposedBy: "ai", actorUserId: null });
    expect(second.deduped).toBeUndefined();
    expect(second.proposal.id).not.toBe(first.proposal.id);
    expect(second.proposal.status).toBe("proposed");
    expect(s.proposals).toHaveLength(2);
  });

  it("tag_conversation dedupe compares the tag set (case-insensitive); different tags are a different proposal", async () => {
    const s = setup();
    const first: any = await s.engine.propose(ORG, "tag_conversation", { conversationId: "conv-1", addTags: ["Urgent"] }, { proposedBy: "ai", actorUserId: null });
    const sameSet: any = await s.engine.propose(ORG, "tag_conversation", { conversationId: "conv-1", addTags: ["urgent"] }, { proposedBy: "ai", actorUserId: null });
    expect(sameSet.deduped).toBe(true);
    expect(sameSet.proposal.id).toBe(first.proposal.id);
    const otherSet: any = await s.engine.propose(ORG, "tag_conversation", { conversationId: "conv-1", addTags: ["wholesale"] }, { proposedBy: "ai", actorUserId: null });
    expect(otherSet.deduped).toBeUndefined();
    expect(s.proposals).toHaveLength(2);
  });
});

describe("SA-B11 Item 2 — the deterministic proposers (handlers)", () => {
  it("Trigger A: bot-order completion proposes close_conversation (proposedBy ai, sourceRef names the trigger + order)", async () => {
    const s = setup();
    await s.proposer.onBotOrderCompleted({ organizationId: ORG, context: { conversationId: "conv-1", orderId: "ord-1" } });
    await s.proposer.onBotOrderCompleted({ organizationId: ORG, context: { conversationId: "conv-1", orderId: "ord-1" } }); // re-fire: dedupe
    expect(s.proposals).toHaveLength(1);
    const p = s.proposals[0];
    expect(p.actionId).toBe("close_conversation");
    expect(p.proposedBy).toBe("ai");
    expect(p.userId).toBeNull();
    expect(p.status).toBe("proposed");
    expect(p.sourceRef).toMatchObject({ trigger: "order_bot_completed", orderId: "ord-1" });
    expect(s.conversations[0].status).toBe("open"); // L1: proposed, not executed
  });

  it("Trigger A + autonomy: at L2 the triggered close auto-executes and verifies; at L0 no proposal row exists", async () => {
    const s2 = setup();
    await s2.engine.setAutonomy(ORG, "close_conversation", 2, OWNER);
    await s2.proposer.onBotOrderCompleted({ organizationId: ORG, context: { conversationId: "conv-1", orderId: "ord-1" } });
    expect(s2.proposals).toHaveLength(1);
    expect(s2.proposals[0].status).toBe("executed");
    expect(s2.proposals[0].result.outcome).toBe("verified_success");
    expect(s2.conversations[0].status).toBe("closed");

    const s0 = setup();
    await s0.engine.setAutonomy(ORG, "close_conversation", 0, OWNER);
    await s0.proposer.onBotOrderCompleted({ organizationId: ORG, context: { conversationId: "conv-1", orderId: "ord-1" } });
    expect(s0.proposals).toHaveLength(0);
    expect(s0.conversations[0].status).toBe("open");
  });

  it("Trigger B: a fresh spam flag proposes block_sender (medium — waits at L1); approval blocks through the real path", async () => {
    const s = setup();
    await s.proposer.onSpamFlagged({ organizationId: ORG, context: { conversationId: "conv-1", reason: "প্রথম বার্তাতেই প্রমোশনাল লিংক" } });
    expect(s.proposals).toHaveLength(1);
    const p = s.proposals[0];
    expect(p.actionId).toBe("block_sender");
    expect(p.status).toBe("proposed");
    expect(p.sourceRef).toMatchObject({ trigger: "spam_detector" });
    const done: any = await s.engine.approve(ORG, OWNER, p.id);
    expect(done.status).toBe("executed");
    expect(s.conversations[0].blockedAt).toBeTruthy();
  });

  it("Trigger C: 'resolve' + tags become two engine proposals; a non-catalogued action becomes none", async () => {
    const s = setup();
    await s.proposer.onNextActionSuggested({ organizationId: ORG, context: { conversationId: "conv-1", action: "resolve", tags: ["follow-up"], reason: "অর্ডার ডেলিভারি হয়ে গেছে" } });
    expect(s.proposals.map((p) => p.actionId).sort()).toEqual(["close_conversation", "tag_conversation"]);
    expect(s.proposals.every((p) => p.proposedBy === "ai" && p.status === "proposed")).toBe(true);
    const tagP = s.proposals.find((p) => p.actionId === "tag_conversation");
    expect(tagP?.payload.addTags).toEqual(["follow-up"]);

    const s2 = setup();
    await s2.proposer.onNextActionSuggested({ organizationId: ORG, context: { conversationId: "conv-1", action: "wait_customer", tags: [], reason: "অপেক্ষা করুন" } });
    expect(s2.proposals).toHaveLength(0); // wait_customer has no catalog entry — nothing invented
  });
});

describe("SA-B11 Item 2 — triggers through the REAL inbox paths (event bus wired)", () => {
  it("detectSpam: the detector flags (its own act) and the bus turns the fresh flag into a block_sender proposal — once", async () => {
    const s = setup({ withProposer: true });
    const conv = s.conversations[0];
    const spamText = "ফ্রি লটারি জিতেছেন! https://scam.example.com";
    const first = await (s.inbox as any).detectSpam(ORG, conv, spamText);
    expect(first).toBe(true);
    expect(conv.spamFlag).toBe(true); // the detector's own write — unchanged behaviour
    await flush();
    expect(s.proposals).toHaveLength(1);
    expect(s.proposals[0].actionId).toBe("block_sender");
    expect(s.conversations[0].blockedAt).toBeNull(); // proposed only — not blocked
    // Already flagged: detectSpam early-returns, no new event, no new proposal.
    const again = await (s.inbox as any).detectSpam(ORG, conv, spamText);
    expect(again).toBe(true);
    await flush();
    expect(s.proposals).toHaveLength(1);
    // A benign message on a fresh thread flags nothing and proposes nothing.
    const conv2 = { ...s.conversations[1], id: "conv-9", status: "open", spamFlag: false };
    const benign = await (s.inbox as any).detectSpam(ORG, conv2, "আসসালামু আলাইকুম, দাম কত?");
    expect(benign).toBe(false);
    await flush();
    expect(s.proposals).toHaveLength(1);
  });

  it("order bot completion: the confirm step creates the order, completes the session, and the close is proposed through the bus", async () => {
    const s = setup({ withProposer: true });
    const conv = s.conversations[0];
    s.sessions.push({ id: "sess-1", organizationId: ORG, conversationId: "conv-1", state: "confirm", status: "active", data: { name: "রহিম", phone: "01710000000", address: "ঢাকা", productId: "p1", quantity: 1 }, updatedAt: new Date() });
    // Spec-edge stubs ONLY: order creation has its own pipeline
    // suites; botSend is the channel send. botStep itself — the
    // completion bookkeeping + emit under test — is the real code.
    (s.inbox as any).createChatOrder = jest.fn(async () => ({ id: "ord-1", externalNumber: "ORD-1", totalMinor: 150000n, currency: "BDT", storeSyncStatus: "synced" }));
    (s.inbox as any).botSend = jest.fn(async () => true);
    const handled = await (s.inbox as any).botStep(ORG, conv, s.sessions[0], "হ্যাঁ", { botDeliveryChargeMinor: 6000 });
    expect(handled).toBe(true);
    expect(s.sessions[0].status).toBe("completed");
    await flush();
    expect(s.proposals).toHaveLength(1);
    expect(s.proposals[0].actionId).toBe("close_conversation");
    expect(s.proposals[0].sourceRef).toMatchObject({ trigger: "order_bot_completed", orderId: "ord-1" });
    expect(conv.status).toBe("open"); // proposed at L1 — the thread itself is untouched
  });

  it("suggestNextAction: the response contract is unchanged AND its resolve + tags land as engine proposals (repeat call dedupes)", async () => {
    const llmProvider = {
      name: "fake-llm", isRealLlm: true,
      complete: jest.fn(async () => ({
        text: JSON.stringify({ action: "resolve", reason: "অর্ডার সম্পন্ন, বিষয়টি মিটে গেছে", tags: ["follow-up"], pipelineStage: null }),
        inputTokens: 5, outputTokens: 5, tokensEstimated: false,
      })),
    };
    const s = setup({ withProposer: true, llmProvider });
    s.messages.push({ id: "in-1", conversationId: "conv-1", direction: "in", type: "text", content: "ধন্যবাদ, পেয়ে গেছি", status: "received", createdAt: new Date() });
    const out = await s.inbox.suggestNextAction(ORG, OWNER, "conv-1");
    // The IN7 contract: same shape out as before SA-B11.
    expect(out.provider).toBe("fake-llm");
    expect(out.proposal?.action).toBe("resolve");
    expect(out.proposal?.tags).toEqual(["follow-up"]);
    await flush();
    expect(s.proposals.map((p) => p.actionId).sort()).toEqual(["close_conversation", "tag_conversation"]);
    // Staff clicks "suggest" again: same suggestion, no duplicate proposals.
    const out2 = await s.inbox.suggestNextAction(ORG, OWNER, "conv-1");
    expect(out2.proposal?.action).toBe("resolve");
    await flush();
    expect(s.proposals).toHaveLength(2);
    // Nothing was executed by any of this (L1).
    expect(s.conversations[0].status).toBe("open");
    expect(s.conversations[0].tags).toEqual(["vip"]);
  });

  it("an ordinary inbound message runs the full intelligence dispatch and proposes NOTHING", async () => {
    const s = setup({ withProposer: true });
    const conv = s.conversations[0];
    const msg = { id: "in-9", conversationId: "conv-1", direction: "in", type: "text", content: "আসসালামু আলাইকুম, এই পণ্যটা কি স্টকে আছে?", status: "received", createdAt: new Date() };
    s.messages.push(msg);
    await (s.inbox as any).processInboundIntelligence(ORG, conv, msg, { content: msg.content });
    await flush();
    expect(s.proposals).toHaveLength(0);
    expect(conv.spamFlag).toBe(false);
    expect(conv.status).toBe("open");
  });
});
