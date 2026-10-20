import "reflect-metadata";
import { ActionEngineService } from "./action-engine.service";
import { ActionExecutorsService } from "./action-executors.service";
import { ACTION_CATALOG, catalogAction } from "./action-catalog";
import { InboxService } from "../../inbox/inbox.service";
import { SocialCommentsService } from "../../inbox/social-comments.service";

/**
 * SA-B10 (Smart AI Phase 2, W1) — Action Engine guarantees:
 *  - the pipeline runs through the REAL staff service paths
 *    (InboxService.updateConversation, SocialCommentsService
 *    .updateCommentStatus with a stubbed Graph client — the
 *    stub replaces the platform client only, in this spec);
 *  - exactly-once: a double approve/execute never runs the
 *    executor twice and returns the recorded outcome;
 *  - autonomy (D5): L0 refuses propose, L1 cannot execute
 *    without a recorded approval, L2 auto-executes low-risk
 *    only, L3 cannot be set (rejection audit-logged);
 *  - the L5 wall: money-adjacent request_refund is proposal-
 *    only — approve records the decision, execute() refuses
 *    at every level, it never becomes "executed";
 *  - verification: an executor that claims success without
 *    changing real state is recorded FAILED with reason
 *    verification_mismatch, never as success;
 *  - failures are recorded as failures with the error verbatim;
 *  - cross-org: another org cannot see/decide/execute a
 *    proposal (404), and autonomy settings are per-org;
 *  - audit: AuditLog + AIAction rows exist for the propose /
 *    approve / execute-outcome transitions;
 *  - catalog integrity: every executable entry is fully
 *    wired (b10 references + the b11 inbox set + the b12
 *    comment set, SA-B12), proposal-only entries have no
 *    executor at all.
 *
 * Fake prisma only — no live DB, no live send anywhere.
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

function setup() {
  const conversations: Row[] = [
    { id: "conv-1", organizationId: ORG, status: "open", contactName: "রহিম", externalContactId: "psid-1", channel: "messenger", tags: [], csatSentAt: null },
    { id: "conv-b", organizationId: ORG_B, status: "open", contactName: "অন্য দোকান", externalContactId: "psid-9", channel: "messenger", tags: [], csatSentAt: null },
  ];
  const comments: Row[] = [
    { id: "cmt-1", organizationId: ORG, platform: "facebook", status: "PENDING", authorName: "করিম", commentText: "দাম কত?", externalCommentId: "ext-cmt-1", metadata: {} },
  ];
  const proposals: Row[] = [];
  const settings: Row[] = [];
  const aiActions: Row[] = [];
  const db = {
    channelConversation: table(conversations),
    channelMessage: table([] as Row[]),
    socialComment: table(comments),
    integration: table([] as Row[]),
    membership: table([{ id: "m1", organizationId: ORG, userId: OWNER, role: "OWNER" }] as Row[]),
    order: table([] as Row[]),
    aIActionProposal: table(proposals),
    aiAutonomySetting: table(settings),
    aIAction: table(aiActions),
  };
  const auditCalls: any[] = [];
  const audit = { log: jest.fn(async (e: any) => { auditCalls.push(e); }) };
  const llm = { getProvider: () => { throw new Error("no provider configured"); } };
  const inbox = new InboxService(db as any, audit as any, llm as any);
  const social = new SocialCommentsService(db as any, audit as any);
  const graph = { setCommentHidden: jest.fn(async (_id: string, _hidden: boolean) => ({ success: true })) };
  (social as any).graphClientFor = async () => graph;
  const executors = new ActionExecutorsService(db as any, inbox, social);
  const engine = new ActionEngineService(db as any, audit as any, executors);
  return { db, engine, executors, inbox, social, graph, audit, auditCalls, conversations, comments, proposals, settings, aiActions };
}

describe("SA-B10 Action Engine — pipeline through real service paths", () => {
  it("close_conversation: propose executes nothing; approve executes + verifies; audit rows exist", async () => {
    const s = setup();
    const res: any = await s.engine.propose(ORG, "close_conversation", { conversationId: "conv-1" }, { proposedBy: "staff", actorUserId: OWNER });
    expect(res.ok).toBe(true);
    expect(res.autoExecuted).toBe(false);
    expect(res.proposal.status).toBe("proposed");
    expect(res.proposal.actionId).toBe("close_conversation");
    expect(res.proposal.surface).toBe("inbox");
    expect(res.proposal.autonomyLevel).toBe(1); // absent setting = default L1
    expect(res.proposal.preview).toContain("এখনো কিছুই করা হয়নি");
    // NOTHING executed at propose time
    expect(s.conversations[0].status).toBe("open");

    const done: any = await s.engine.approve(ORG, OWNER, res.proposal.id);
    expect(done.status).toBe("executed");
    expect(done.result.outcome).toBe("verified_success");
    expect(done.verification.verified).toBe(true);
    expect(done.executedAt).toBeTruthy();
    expect(s.conversations[0].status).toBe("closed");

    const phases = s.aiActions.map((r) => r.args?.phase);
    expect(phases).toEqual(expect.arrayContaining(["proposed", "approved", "executed"]));
    const auditActions = s.auditCalls.map((c) => c.action);
    expect(auditActions).toEqual(expect.arrayContaining(["ai.action_proposed", "ai.action_approved", "ai.action_executed"]));
  });

  it("hide_comment: Graph-first hide through SocialCommentsService, verified from the row", async () => {
    const s = setup();
    const res: any = await s.engine.propose(ORG, "hide_comment", { commentId: "cmt-1" }, { proposedBy: "ai", actorUserId: null, sourceRef: { commentId: "cmt-1" } });
    expect(res.ok).toBe(true);
    expect(res.proposal.proposedBy).toBe("ai");
    expect(res.proposal.userId).toBeNull(); // an AI proposer has no human user id — recorded truthfully
    const done: any = await s.engine.approve(ORG, OWNER, res.proposal.id);
    expect(done.status).toBe("executed");
    expect(s.graph.setCommentHidden).toHaveBeenCalledTimes(1);
    expect(s.graph.setCommentHidden).toHaveBeenCalledWith("ext-cmt-1", true);
    expect(s.comments[0].status).toBe("HIDDEN");
  });

  it("exactly-once: double approve + execute never run the executor twice", async () => {
    const s = setup();
    const spy = jest.spyOn(s.inbox, "updateConversation");
    const res: any = await s.engine.propose(ORG, "close_conversation", { conversationId: "conv-1" }, { proposedBy: "staff", actorUserId: OWNER });
    await s.engine.approve(ORG, OWNER, res.proposal.id);
    await expect(s.engine.approve(ORG, OWNER, res.proposal.id)).rejects.toMatchObject({ code: "ai.thisActionProposalWasAlreadyDecided2" });
    const again: any = await s.engine.execute(ORG, OWNER, res.proposal.id);
    expect(again.ok).toBe(true);
    expect(again.noop).toBe(true);
    expect(again.proposal.status).toBe("executed");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(s.aiActions.filter((r) => r.args?.phase === "executed")).toHaveLength(1);
  });

  it("reject: a rejected proposal can neither be approved nor executed", async () => {
    const s = setup();
    const res: any = await s.engine.propose(ORG, "close_conversation", { conversationId: "conv-1" }, { proposedBy: "staff", actorUserId: OWNER });
    const rejected: any = await s.engine.reject(ORG, OWNER, res.proposal.id);
    expect(rejected.status).toBe("rejected");
    const exec: any = await s.engine.execute(ORG, OWNER, res.proposal.id);
    expect(exec).toMatchObject({ ok: false, reason: "proposal_rejected" });
    await expect(s.engine.approve(ORG, OWNER, res.proposal.id)).rejects.toMatchObject({ code: "ai.thisActionProposalWasAlreadyDecided2" });
    expect(s.conversations[0].status).toBe("open");
  });
});

describe("SA-B10 Action Engine — autonomy matrix (D5)", () => {
  it("L1: execute() on an unapproved proposal is refused (approval_required)", async () => {
    const s = setup();
    const res: any = await s.engine.propose(ORG, "close_conversation", { conversationId: "conv-1" }, { proposedBy: "staff", actorUserId: OWNER });
    const exec: any = await s.engine.execute(ORG, OWNER, res.proposal.id);
    expect(exec).toMatchObject({ ok: false, reason: "approval_required" });
    expect(s.conversations[0].status).toBe("open");
  });

  it("L0: propose() refuses with a typed result, creates no row, and the refusal is audit-logged", async () => {
    const s = setup();
    await s.engine.setAutonomy(ORG, "close_conversation", 0, OWNER);
    const res: any = await s.engine.propose(ORG, "close_conversation", { conversationId: "conv-1" }, { proposedBy: "ai", actorUserId: null });
    expect(res).toMatchObject({ ok: false, reason: "autonomy_off" });
    expect(s.proposals).toHaveLength(0);
    expect(s.auditCalls.some((c) => c.action === "ai.action_propose_refused" && c.metadata?.reason === "autonomy_off")).toBe(true);
  });

  it("L2: a low-risk action auto-executes through the same verified pipeline", async () => {
    const s = setup();
    await s.engine.setAutonomy(ORG, "close_conversation", 2, OWNER);
    const res: any = await s.engine.propose(ORG, "close_conversation", { conversationId: "conv-1" }, { proposedBy: "ai", actorUserId: null });
    expect(res.ok).toBe(true);
    expect(res.autoExecuted).toBe(true);
    expect(res.proposal.status).toBe("executed");
    expect(res.proposal.result.outcome).toBe("verified_success");
    expect(res.proposal.decidedById).toBeNull(); // autonomous — no human decided
    expect(s.conversations[0].status).toBe("closed");
    expect(s.auditCalls.some((c) => c.action === "ai.action_approved" && c.metadata?.autonomous === true)).toBe(true);
  });

  it("L2: a medium-risk action does NOT auto-execute (test-registered wiring on a real catalog entry)", async () => {
    const s = setup();
    // reply_to_comment is medium-risk. To exercise the ENGINE's
    // L2 gate itself (not the production executor), this spec
    // REPLACES the entry's registrations inside this test's own
    // ActionExecutorsService instance with a minimal
    // builder/executor/verifier — the maps are per-instance, so
    // production wiring is untouched (the catalog-integrity
    // spec below and the SA-B12 suite prove the real wiring on
    // fresh instances). (History: this test used block_sender
    // until SA-B11 wired it, then the then-unwired
    // reply_to_comment until SA-B12 wired it.)
    s.executors.builders.set("reply_to_comment", async (_org, payload) => ({
      title: "উত্তর", preview: "preview", payload: { commentId: payload.commentId }, conversationId: null,
    }));
    s.executors.executors.set("comment.reply_to_comment", async () => ({ replied: true }));
    s.executors.verifiers.set("comment.reply_to_comment.verify", async () => ({ verified: true, detail: {} }));
    await s.engine.setAutonomy(ORG, "reply_to_comment", 2, OWNER);
    const res: any = await s.engine.propose(ORG, "reply_to_comment", { commentId: "cmt-1" }, { proposedBy: "ai", actorUserId: null });
    expect(res.ok).toBe(true);
    expect(res.autoExecuted).toBe(false);
    expect(res.proposal.status).toBe("proposed"); // waits for a human, exactly like L1
  });

  it("L3: setAutonomy rejects level 3, audit-logs the rejection, and stores nothing", async () => {
    const s = setup();
    await expect(s.engine.setAutonomy(ORG, "close_conversation", 3, OWNER)).rejects.toThrow(/আলাদা সিদ্ধান্ত/);
    expect(s.settings).toHaveLength(0);
    expect(await s.engine.getAutonomyLevel(ORG, "close_conversation")).toBe(1);
    const rejection = s.auditCalls.find((c) => c.action === "ai.action_autonomy_rejected");
    expect(rejection?.metadata?.reason).toBe("level_3_requires_separate_owner_decision");
  });

  it("autonomy settings are per-org: org B's level never changes org A's", async () => {
    const s = setup();
    await s.engine.setAutonomy(ORG_B, "close_conversation", 0, "owner-b");
    expect(await s.engine.getAutonomyLevel(ORG, "close_conversation")).toBe(1);
    expect(await s.engine.getAutonomyLevel(ORG_B, "close_conversation")).toBe(0);
    const list = await s.engine.listAutonomy(ORG);
    expect(list.find((x) => x.actionId === "close_conversation")?.level).toBe(1);
  });
});

describe("SA-B10 Action Engine — the L5 money wall + honest failures", () => {
  it("request_refund: approve records the decision (proposal_only); execute() refuses; it never becomes executed", async () => {
    const s = setup();
    const res: any = await s.engine.propose(ORG, "request_refund", { conversationId: "conv-1", reason: "পণ্য নষ্ট এসেছে" }, { proposedBy: "staff", actorUserId: OWNER });
    expect(res.ok).toBe(true);
    const approved: any = await s.engine.approve(ORG, OWNER, res.proposal.id);
    expect(approved.status).toBe("approved"); // decided — NOT executed
    expect(approved.result.outcome).toBe("proposal_only");
    const exec: any = await s.engine.execute(ORG, OWNER, res.proposal.id);
    expect(exec).toMatchObject({ ok: false, reason: "money_adjacent_proposal_only" });
    const finalRow = s.proposals.find((r) => r.id === res.proposal.id) as Row;
    expect(finalRow.status).toBe("approved");
    expect(finalRow.executedAt ?? null).toBeNull();
  });

  it("request_refund at L2 never auto-executes either", async () => {
    const s = setup();
    await s.engine.setAutonomy(ORG, "request_refund", 2, OWNER);
    const res: any = await s.engine.propose(ORG, "request_refund", { conversationId: "conv-1", reason: "ভুল পণ্য" }, { proposedBy: "ai", actorUserId: null });
    expect(res.ok).toBe(true);
    expect(res.autoExecuted).toBe(false);
    expect(res.proposal.status).toBe("proposed");
  });

  it("verification mismatch: a lying executor is recorded FAILED (verification_mismatch), never success", async () => {
    const s = setup();
    // SPEC-ONLY stub: replaces the executor function to claim
    // success without touching real state. Production executors
    // are the real service paths (proven by the specs above).
    s.executors.executors.set("inbox.close_conversation", async () => ({ conversationId: "conv-1", status: "closed" }));
    const res: any = await s.engine.propose(ORG, "close_conversation", { conversationId: "conv-1" }, { proposedBy: "staff", actorUserId: OWNER });
    const done: any = await s.engine.approve(ORG, OWNER, res.proposal.id);
    expect(done.status).toBe("failed");
    expect(done.error).toBe("verification_mismatch");
    expect(done.result.outcome).toBe("verification_mismatch");
    expect(done.verification.verified).toBe(false);
    expect(done.verification.detail.observedStatus).toBe("open");
    expect(s.conversations[0].status).toBe("open"); // reality unchanged — and the record says so
    expect(s.aiActions.some((r) => r.args?.phase === "failed" && r.status === "error")).toBe(true);
  });

  it("executor failure (Graph refuses the hide) is recorded FAILED with the error verbatim", async () => {
    const s = setup();
    s.graph.setCommentHidden.mockRejectedValueOnce(new Error("Meta Graph error: cannot hide"));
    // updateCommentStatus wraps Graph errors into BadRequestException with the same message
    const res: any = await s.engine.propose(ORG, "hide_comment", { commentId: "cmt-1" }, { proposedBy: "staff", actorUserId: OWNER });
    const done: any = await s.engine.approve(ORG, OWNER, res.proposal.id);
    expect(done.status).toBe("failed");
    expect(done.error).toContain("cannot hide");
    expect(s.comments[0].status).toBe("PENDING");
  });
});

describe("SA-B10 Action Engine — isolation + validation + catalog integrity", () => {
  it("cross-org: org B cannot approve, reject, execute or list org A's proposal", async () => {
    const s = setup();
    const res: any = await s.engine.propose(ORG, "close_conversation", { conversationId: "conv-1" }, { proposedBy: "staff", actorUserId: OWNER });
    await expect(s.engine.approve(ORG_B, "owner-b", res.proposal.id)).rejects.toMatchObject({ code: "ai.actionProposalNotFound" });
    await expect(s.engine.reject(ORG_B, "owner-b", res.proposal.id)).rejects.toMatchObject({ code: "ai.actionProposalNotFound" });
    await expect(s.engine.execute(ORG_B, "owner-b", res.proposal.id)).rejects.toMatchObject({ code: "ai.actionProposalNotFound" });
    expect(await s.engine.listProposals(ORG_B)).toHaveLength(0);
    expect(s.proposals[0].status).toBe("proposed"); // untouched
  });

  it("validation: unknown action, missing target, foreign target, already-closed target", async () => {
    const s = setup();
    await expect(s.engine.propose(ORG, "no_such_action", {}, { proposedBy: "staff", actorUserId: OWNER })).rejects.toMatchObject({ code: "ai.unknownCatalogAction2" });
    await expect(s.engine.propose(ORG, "close_conversation", {}, { proposedBy: "staff", actorUserId: OWNER })).rejects.toMatchObject({ code: "ai.isRequired" });
    await expect(s.engine.propose(ORG, "close_conversation", { conversationId: "conv-b" }, { proposedBy: "staff", actorUserId: OWNER })).rejects.toMatchObject({ code: "ai.conversationNotFoundInThisOrganization" });
    s.conversations[0].status = "closed";
    await expect(s.engine.propose(ORG, "close_conversation", { conversationId: "conv-1" }, { proposedBy: "staff", actorUserId: OWNER })).rejects.toThrow(/ইতিমধ্যে বন্ধ/);
  });

  it("an action whose wiring is missing refuses honestly (typed not_wired), creating no row", async () => {
    const s = setup();
    // SA-B12 wired the last catalog entry, so no production
    // entry is unwired anymore. The engine's not_wired branch
    // still guards any FUTURE catalog entry whose batch has not
    // landed; exercise it by removing one registration inside
    // this test's own instance (production wiring is proven by
    // the integrity spec below on a fresh instance).
    s.executors.builders.delete("unhide_comment");
    const res: any = await s.engine.propose(ORG, "unhide_comment", { commentId: "cmt-1" }, { proposedBy: "ai", actorUserId: null });
    expect(res).toMatchObject({ ok: false, reason: "action_not_wired" });
    expect(s.proposals).toHaveLength(0);
  });

  it("catalog integrity: wiring claims match the registries exactly", async () => {
    const s = setup();
    for (const entry of ACTION_CATALOG) {
      if (entry.wiring === "never") {
        expect(entry.moneyAdjacent).toBe(true);
        expect(entry.executorKey).toBeNull();
        expect(entry.verifierKey).toBeNull();
      } else {
        expect(entry.executorKey).toBeTruthy();
        expect(entry.verifierKey).toBeTruthy();
      }
      if (entry.wiring === "b10" || entry.wiring === "b11" || entry.wiring === "b12") {
        // b10 reference pair + the b11 inbox set (SA-B11) + the
        // b12 comment set (SA-B12) are fully registered:
        // builder + executor + verifier.
        expect(s.executors.builders.has(entry.id)).toBe(true);
        expect(s.executors.executors.has(entry.executorKey as string)).toBe(true);
        expect(s.executors.verifiers.has(entry.verifierKey as string)).toBe(true);
      }
      if (entry.moneyAdjacent) {
        expect(entry.executorKey).toBeNull();
        expect(s.executors.executors.has(entry.executorKey as string)).toBe(false);
      }
    }
    // request_refund is proposable (builder) yet has NO executor.
    expect(s.executors.builders.has("request_refund")).toBe(true);
    expect(catalogAction("request_refund")?.moneyAdjacent).toBe(true);
    // The dropped draft entry stays dropped: no priority setter exists.
    expect(catalogAction("set_conversation_priority")).toBeNull();
  });
});
