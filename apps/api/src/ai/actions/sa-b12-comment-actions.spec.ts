import "reflect-metadata";
import { ActionEngineService } from "./action-engine.service";
import { ActionExecutorsService } from "./action-executors.service";
import { CommentActionProposerService, REPEAT_SPAM_AUTHOR_THRESHOLD } from "./comment-action-proposer.service";
import { InboxService } from "../../inbox/inbox.service";
import { SocialCommentsService } from "../../inbox/social-comments.service";
import { EventsService } from "../../common/events.service";

/**
 * SA-B12 (Smart AI Phase 2, W3) — Comment Actions guarantees:
 *  - the four remaining comment catalog entries (unhide /
 *    reply / DM / delete) execute through the REAL staff
 *    service paths (SocialCommentsService.updateCommentStatus /
 *    sendReply / sendPrivateReply / deleteComment — all
 *    Graph-first, IN8) and are verified by read-back of BOTH
 *    the local row and the Graph marker;
 *  - a Graph failure is a FAILED proposal with the platform
 *    error verbatim and the local row is left exactly as it
 *    was — never a local-only state change dressed as success;
 *  - reply_to_comment re-runs the SA-B8 number guard at
 *    execution against FRESH facts: text that was grounded at
 *    approval time but whose price has since moved FAILS and
 *    posts nothing;
 *  - the DM precondition (Meta's one private reply per
 *    comment) is enforced by the staff path itself — a DM sent
 *    between proposal and approval lands as a FAILED proposal
 *    with the service's reason verbatim, never a second send;
 *  - the deterministic proposers: (E) a repeat spam author at
 *    the named threshold proposes delete_comment for the
 *    newest spam comment (below threshold / no social id →
 *    silent), and (F) a complaint whose public DM-invitation
 *    reply posted WITHOUT its drafted private reply proposes
 *    send_dm_to_commenter carrying that drafted text (DM sent
 *    → silent);
 *  - autonomy: delete_comment (high risk) never auto-executes
 *    even at L2; L0 creates no proposals from triggers;
 *  - engine dedupe covers comment targets (commentId, plus the
 *    text for reply/DM proposals);
 *  - cross-org targets are refused by the builders.
 *
 * Fake prisma only (the SA-B8 table pattern). The only stub is
 * the platform edge: a scripted Graph client substituted for
 * MetaMessagingClient — the real SocialCommentsService methods
 * run end to end against it, exactly like SA-B8/B10.
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

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };

function commentRow(partial: Partial<Row>): Row {
  return {
    platform: "facebook",
    externalPostId: "post-1",
    postTitle: "লেদার ওয়ালেট পোস্ট",
    authorName: "করিম",
    authorSocialId: "fb-karim",
    sentiment: "NEUTRAL",
    intent: "GENERAL",
    status: "PENDING",
    replyText: null,
    repliedAt: null,
    isPrivateDmSent: false,
    privateDmText: null,
    aiReplyDueAt: null,
    aiReplyBatchOf: null,
    assignedUserId: null,
    dmConversationId: null,
    metadata: {},
    ...partial,
  };
}

function setup(opts: { withProposer?: boolean; replySettings?: Row } = {}) {
  const comments: Row[] = [
    commentRow({ id: "cmt-hidden", organizationId: ORG, status: "HIDDEN", commentText: "click here to win", externalCommentId: "ext-hidden", sentiment: "SPAM" }),
    commentRow({ id: "cmt-plain", organizationId: ORG, commentText: "লেদার ওয়ালেট টা নিতে চাই", externalCommentId: "ext-plain" }),
    commentRow({ id: "cmt-dmed", organizationId: ORG, commentText: "দাম কত?", externalCommentId: "ext-dmed", isPrivateDmSent: true, privateDmText: "আগের DM" }),
    commentRow({ id: "cmt-foreign", organizationId: ORG_B, commentText: "অন্য দোকানের কমেন্ট", externalCommentId: "ext-foreign" }),
  ];
  const products: Row[] = [
    { id: "prod-1", organizationId: ORG, status: "ACTIVE", name: "লেদার ওয়ালেট", priceMinor: 125000, currency: "BDT", slug: "leather-wallet", createdAt: new Date() },
  ];
  const proposals: Row[] = [];
  const settings: Row[] = [];
  const aiActions: Row[] = [];
  const replySettings: Row[] = opts.replySettings ? [opts.replySettings] : [];
  const db = {
    channelConversation: table([] as Row[]),
    channelMessage: table([] as Row[]),
    socialComment: table(comments),
    socialReplySetting: table(replySettings),
    product: table(products),
    integration: table([] as Row[]),
    membership: table([{ id: "m1", organizationId: ORG, userId: OWNER, role: "OWNER", status: "ACTIVE" }] as Row[]),
    order: table([] as Row[]),
    conversationNote: table([] as Row[]),
    businessProfile: table([] as Row[]),
    businessPolicy: table([] as Row[]),
    knowledgeDocument: table([] as Row[]),
    customerMemory: table([] as Row[]),
    platformSetting: table([] as Row[]),
    orgLlmConfig: table([] as Row[]),
    inboxSetting: table([] as Row[]),
    lead: table([] as Row[]),
    aIActionProposal: table(proposals),
    aiAutonomySetting: table(settings),
    aIAction: table(aiActions),
    aIUsageRecord: table([] as Row[]),
  };
  const auditCalls: any[] = [];
  const audit = { log: jest.fn(async (e: any) => { auditCalls.push(e); }) };
  const llm = { getProvider: () => { throw new Error("no provider configured"); } };
  const events = new EventsService();
  const inbox = new InboxService(db as any, audit as any, llm as any, events as any);
  const social = new SocialCommentsService(db as any, audit as any, undefined, undefined, undefined, events as any);
  const graph = {
    setCommentHidden: jest.fn(async (_id: string, _hidden: boolean) => ({ success: true })),
    replyToComment: jest.fn(async (_id: string, _text: string) => ({ commentId: "graph-reply-1" })),
    privateReplyToComment: jest.fn(async (_id: string, _text: string) => ({ messageId: "dm-msg-1" })),
    deleteComment: jest.fn(async (_id: string) => ({ success: true })),
  };
  (social as any).graphClientFor = async () => graph;
  const executors = new ActionExecutorsService(db as any, inbox, social);
  const engine = new ActionEngineService(db as any, audit as any, executors);
  const proposer = new CommentActionProposerService(engine, events, db as any);
  if (opts.withProposer) proposer.onModuleInit();
  return { db, engine, executors, inbox, social, events, proposer, graph, audit, auditCalls, comments, products, proposals, settings, aiActions };
}

const byId = (s: ReturnType<typeof setup>, id: string) => s.comments.find((c) => c.id === id) as Row;

describe("SA-B12 Item 1 — comment executors through the real staff paths", () => {
  it("unhide_comment: propose → approve unhides Graph-first and the verifier reads PENDING back", async () => {
    const s = setup();
    const res: any = await s.engine.propose(ORG, "unhide_comment", { commentId: "cmt-hidden" }, { proposedBy: "ai", actorUserId: null });
    expect(res.ok).toBe(true);
    expect(byId(s, "cmt-hidden").status).toBe("HIDDEN"); // nothing executed yet
    const done: any = await s.engine.approve(ORG, OWNER, res.proposal.id);
    expect(done.status).toBe("executed");
    expect(done.result.outcome).toBe("verified_success");
    expect(s.graph.setCommentHidden).toHaveBeenCalledWith("ext-hidden", false);
    expect(byId(s, "cmt-hidden").status).toBe("PENDING");
  });

  it("unhide_comment: a comment that is not HIDDEN is refused by the builder", async () => {
    const s = setup();
    await expect(s.engine.propose(ORG, "unhide_comment", { commentId: "cmt-plain" }, { proposedBy: "ai", actorUserId: null }))
      .rejects.toThrow(/HIDDEN/);
    expect(s.proposals).toHaveLength(0);
  });

  it("unhide_comment: a Graph refusal is a FAILED proposal with the error verbatim — the row stays HIDDEN", async () => {
    const s = setup();
    s.graph.setCommentHidden.mockRejectedValueOnce(new Error("Meta Graph error: cannot unhide"));
    const res: any = await s.engine.propose(ORG, "unhide_comment", { commentId: "cmt-hidden" }, { proposedBy: "staff", actorUserId: OWNER });
    const done: any = await s.engine.approve(ORG, OWNER, res.proposal.id);
    expect(done.status).toBe("failed");
    expect(done.error).toContain("cannot unhide");
    expect(byId(s, "cmt-hidden").status).toBe("HIDDEN"); // no local-only lie
  });

  it("reply_to_comment: grounded text posts through sendReply (Graph first) and verifies status + text + Graph id", async () => {
    const s = setup();
    const res: any = await s.engine.propose(ORG, "reply_to_comment", { commentId: "cmt-plain", replyText: "লেদার ওয়ালেটের দাম 1250 টাকা।" }, { proposedBy: "staff", actorUserId: OWNER });
    expect(res.ok).toBe(true);
    expect(byId(s, "cmt-plain").replyText).toBeNull();
    const done: any = await s.engine.approve(ORG, OWNER, res.proposal.id);
    expect(done.status).toBe("executed");
    expect(s.graph.replyToComment).toHaveBeenCalledWith("ext-plain", "লেদার ওয়ালেটের দাম 1250 টাকা।");
    const row = byId(s, "cmt-plain");
    expect(row.status).toBe("MANUALLY_REPLIED");
    expect(row.replyText).toBe("লেদার ওয়ালেটের দাম 1250 টাকা।");
    expect(done.verification.detail.graphReplyId).toBe("graph-reply-1");
  });

  it("reply_to_comment: the price moved after approval — the execution-time guard FAILS the proposal and posts NOTHING", async () => {
    const s = setup();
    const res: any = await s.engine.propose(ORG, "reply_to_comment", { commentId: "cmt-plain", replyText: "লেদার ওয়ালেটের দাম 1250 টাকা।" }, { proposedBy: "staff", actorUserId: OWNER });
    expect(res.ok).toBe(true);
    s.products[0].priceMinor = 135000; // the live price moves 1250 -> 1350 before approval
    const done: any = await s.engine.approve(ORG, OWNER, res.proposal.id);
    expect(done.status).toBe("failed");
    expect(done.error).toContain("number guard");
    expect(done.error).toContain("1250");
    expect(s.graph.replyToComment).not.toHaveBeenCalled(); // zero posts
    const row = byId(s, "cmt-plain");
    expect(row.status).toBe("PENDING");
    expect(row.replyText).toBeNull();
  });

  it("reply_to_comment: a Graph refusal surfaces verbatim and the comment keeps no reply state", async () => {
    const s = setup();
    s.graph.replyToComment.mockRejectedValueOnce(new Error("Meta Graph error: comment unavailable"));
    const res: any = await s.engine.propose(ORG, "reply_to_comment", { commentId: "cmt-plain", replyText: "ধন্যবাদ! ইনবক্সে বিস্তারিত পাঠানো হয়েছে।" }, { proposedBy: "staff", actorUserId: OWNER });
    const done: any = await s.engine.approve(ORG, OWNER, res.proposal.id);
    expect(done.status).toBe("failed");
    expect(done.error).toContain("comment unavailable");
    expect(byId(s, "cmt-plain").status).toBe("PENDING");
    expect(byId(s, "cmt-plain").replyText).toBeNull();
  });

  it("reply_to_comment: a DELETED comment and a foreign-org comment are refused by the builder", async () => {
    const s = setup();
    byId(s, "cmt-plain").status = "DELETED";
    await expect(s.engine.propose(ORG, "reply_to_comment", { commentId: "cmt-plain", replyText: "উত্তর" }, { proposedBy: "staff", actorUserId: OWNER }))
      .rejects.toThrow(/মুছে ফেলা/);
    await expect(s.engine.propose(ORG, "reply_to_comment", { commentId: "cmt-foreign", replyText: "উত্তর" }, { proposedBy: "staff", actorUserId: OWNER }))
      .rejects.toThrow(/not found/i);
    expect(s.proposals).toHaveLength(0);
  });

  it("send_dm_to_commenter: propose → approve sends via sendPrivateReply and verifies the DM flag + Graph id", async () => {
    const s = setup();
    const res: any = await s.engine.propose(ORG, "send_dm_to_commenter", { commentId: "cmt-plain", message: "আসসালামু আলাইকুম! আপনার অর্ডার নম্বরটি এখানে জানান।" }, { proposedBy: "ai", actorUserId: null });
    expect(res.ok).toBe(true);
    expect(byId(s, "cmt-plain").isPrivateDmSent).toBe(false);
    const done: any = await s.engine.approve(ORG, OWNER, res.proposal.id);
    expect(done.status).toBe("executed");
    expect(s.graph.privateReplyToComment).toHaveBeenCalledWith("ext-plain", "আসসালামু আলাইকুম! আপনার অর্ডার নম্বরটি এখানে জানান।");
    expect(byId(s, "cmt-plain").isPrivateDmSent).toBe(true);
    expect(done.verification.detail.graphPrivateReplyId).toBe("dm-msg-1");
  });

  it("send_dm_to_commenter: already DM'd is refused by the builder (Meta's one-private-reply rule)", async () => {
    const s = setup();
    await expect(s.engine.propose(ORG, "send_dm_to_commenter", { commentId: "cmt-dmed", message: "আবার DM" }, { proposedBy: "ai", actorUserId: null }))
      .rejects.toThrow(/private reply/);
    expect(s.proposals).toHaveLength(0);
  });

  it("send_dm_to_commenter: a DM sent between proposal and approval fails honestly at execution — no second send", async () => {
    const s = setup();
    const res: any = await s.engine.propose(ORG, "send_dm_to_commenter", { commentId: "cmt-plain", message: "অর্ডার নম্বরটি জানান।" }, { proposedBy: "ai", actorUserId: null });
    expect(res.ok).toBe(true);
    byId(s, "cmt-plain").isPrivateDmSent = true; // staff DM'd it from the queue meanwhile
    const done: any = await s.engine.approve(ORG, OWNER, res.proposal.id);
    expect(done.status).toBe("failed");
    expect(done.error).toContain("already sent for this comment");
    expect(s.graph.privateReplyToComment).not.toHaveBeenCalled();
  });

  it("delete_comment: propose → approve deletes on Graph first; the verifier reads back status AND the Graph marker", async () => {
    const s = setup();
    const res: any = await s.engine.propose(ORG, "delete_comment", { commentId: "cmt-plain" }, { proposedBy: "staff", actorUserId: OWNER });
    expect(res.ok).toBe(true);
    expect(res.proposal.preview).toContain("স্থায়ী");
    const done: any = await s.engine.approve(ORG, OWNER, res.proposal.id);
    expect(done.status).toBe("executed");
    expect(s.graph.deleteComment).toHaveBeenCalledWith("ext-plain");
    const row = byId(s, "cmt-plain");
    expect(row.status).toBe("DELETED");
    expect((row.metadata as any)?.graph?.deletedAt).toBeTruthy();
    expect(done.verification.detail.graphDeletedAt).toBeTruthy();
  });

  it("delete_comment: a Graph refusal is FAILED verbatim — the local row is NOT dressed up as deleted", async () => {
    const s = setup();
    s.graph.deleteComment.mockRejectedValueOnce(new Error("Meta Graph error: delete not permitted"));
    const res: any = await s.engine.propose(ORG, "delete_comment", { commentId: "cmt-plain" }, { proposedBy: "staff", actorUserId: OWNER });
    const done: any = await s.engine.approve(ORG, OWNER, res.proposal.id);
    expect(done.status).toBe("failed");
    expect(done.error).toContain("delete not permitted");
    expect(byId(s, "cmt-plain").status).toBe("PENDING");
  });

  it("hide_comment regression: the B10 reference still runs end-to-end alongside the b12 set", async () => {
    const s = setup();
    const res: any = await s.engine.propose(ORG, "hide_comment", { commentId: "cmt-plain" }, { proposedBy: "ai", actorUserId: null });
    const done: any = await s.engine.approve(ORG, OWNER, res.proposal.id);
    expect(done.status).toBe("executed");
    expect(byId(s, "cmt-plain").status).toBe("HIDDEN");
  });
});

describe("SA-B12 — comment-target dedupe (engine-level)", () => {
  it("the same delete proposal twice returns the open row (deduped); a rejected one blocks nothing", async () => {
    const s = setup();
    const first: any = await s.engine.propose(ORG, "delete_comment", { commentId: "cmt-plain" }, { proposedBy: "ai", actorUserId: null });
    const second: any = await s.engine.propose(ORG, "delete_comment", { commentId: "cmt-plain" }, { proposedBy: "ai", actorUserId: null });
    expect(first.ok).toBe(true);
    expect(second.deduped).toBe(true);
    expect(second.proposal.id).toBe(first.proposal.id);
    expect(s.proposals).toHaveLength(1);
    await s.engine.reject(ORG, OWNER, first.proposal.id);
    const third: any = await s.engine.propose(ORG, "delete_comment", { commentId: "cmt-plain" }, { proposedBy: "ai", actorUserId: null });
    expect(third.ok).toBe(true);
    expect(third.deduped).toBeFalsy();
    expect(s.proposals).toHaveLength(2);
  });

  it("reply dedupe is text-aware: same text dedupes, a different text is a different proposal", async () => {
    const s = setup();
    const a: any = await s.engine.propose(ORG, "reply_to_comment", { commentId: "cmt-plain", replyText: "দাম 1250 টাকা।" }, { proposedBy: "staff", actorUserId: OWNER });
    const b: any = await s.engine.propose(ORG, "reply_to_comment", { commentId: "cmt-plain", replyText: "দাম 1250 টাকা।" }, { proposedBy: "staff", actorUserId: OWNER });
    expect(b.deduped).toBe(true);
    expect(b.proposal.id).toBe(a.proposal.id);
    const c: any = await s.engine.propose(ORG, "reply_to_comment", { commentId: "cmt-plain", replyText: "ইনবক্সে বিস্তারিত জানানো হয়েছে।" }, { proposedBy: "staff", actorUserId: OWNER });
    expect(c.deduped).toBeFalsy();
    expect(s.proposals).toHaveLength(2);
  });
});

describe("SA-B12 Item 2 — Trigger E (repeat spam author -> delete proposal)", () => {
  const spamDto = (n: number) => ({
    platform: "facebook",
    externalPostId: "post-1",
    externalCommentId: `ext-spam-${n}`,
    authorName: "Spam Bot",
    authorSocialId: "spam-author-1",
    commentText: "earn money online, click here: bit.ly/x",
  });

  it("fires through the REAL ingest path at the threshold — and only there", async () => {
    const s = setup({ withProposer: true });
    await s.social.ingestComment(ORG, spamDto(1) as any);
    await flush();
    expect(s.proposals).toHaveLength(0); // 1 < threshold
    await s.social.ingestComment(ORG, spamDto(2) as any);
    await flush();
    expect(s.proposals).toHaveLength(0); // 2 < threshold
    await s.social.ingestComment(ORG, spamDto(3) as any);
    await flush();
    expect(REPEAT_SPAM_AUTHOR_THRESHOLD).toBe(3);
    expect(s.proposals).toHaveLength(1);
    const p = s.proposals[0];
    expect(p.actionId).toBe("delete_comment");
    expect(p.proposedBy).toBe("ai");
    expect(p.status).toBe("proposed");
    expect(p.payload.commentId).toBe(s.comments.find((c) => c.externalCommentId === "ext-spam-3")?.id);
    expect(p.sourceRef.trigger).toBe("repeat_spam_author");
    expect(p.sourceRef.spamCount).toBe(3);
    // the pipeline's own act (auto-hide) is untouched and NOT re-proposed
    expect(s.comments.find((c) => c.externalCommentId === "ext-spam-3")?.status).toBe("HIDDEN");
    expect(s.proposals.some((r) => r.actionId === "hide_comment")).toBe(false);
    // a 4th spam comment proposes a delete for THAT comment (a new target)
    await s.social.ingestComment(ORG, spamDto(4) as any);
    await flush();
    expect(s.proposals).toHaveLength(2);
    expect(s.proposals[1].payload.commentId).toBe(s.comments.find((c) => c.externalCommentId === "ext-spam-4")?.id);
  });

  it("dedupe: re-firing the same event for the same comment creates no second proposal", async () => {
    const s = setup({ withProposer: true });
    for (const n of [1, 2, 3]) await s.social.ingestComment(ORG, spamDto(n) as any);
    await flush();
    expect(s.proposals).toHaveLength(1);
    const target = s.comments.find((c) => c.externalCommentId === "ext-spam-3") as Row;
    await s.proposer.onSpamFlagged({ organizationId: ORG, context: { commentId: target.id, authorSocialId: "spam-author-1" } });
    expect(s.proposals).toHaveLength(1);
  });

  it("silent without an authorSocialId (no reliable 'same author' to count)", async () => {
    const s = setup({ withProposer: true });
    await s.proposer.onSpamFlagged({ organizationId: ORG, context: { commentId: "cmt-plain" } });
    await s.proposer.onSpamFlagged({ organizationId: ORG, context: { commentId: "cmt-plain", authorSocialId: "" } });
    expect(s.proposals).toHaveLength(0);
  });

  it("autonomy: at L2 the high-risk delete still waits for a human (never auto-executes)", async () => {
    const s = setup({ withProposer: true });
    await s.engine.setAutonomy(ORG, "delete_comment", 2, OWNER);
    for (const n of [1, 2, 3]) await s.social.ingestComment(ORG, spamDto(n) as any);
    await flush();
    expect(s.proposals).toHaveLength(1);
    expect(s.proposals[0].status).toBe("proposed"); // L2 auto-executes LOW risk only
    expect(s.graph.deleteComment).not.toHaveBeenCalled();
    expect(s.comments.find((c) => c.externalCommentId === "ext-spam-3")?.status).toBe("HIDDEN");
  });

  it("autonomy: at L0 the trigger creates no proposal rows at all", async () => {
    const s = setup({ withProposer: true });
    await s.engine.setAutonomy(ORG, "delete_comment", 0, OWNER);
    for (const n of [1, 2, 3]) await s.social.ingestComment(ORG, spamDto(n) as any);
    await flush();
    expect(s.proposals).toHaveLength(0);
  });
});

describe("SA-B12 Item 2 — Trigger F (complaint DM follow-through)", () => {
  const complaintSettings = (sendPrivateDm: boolean): Row => ({
    id: "rs-1",
    organizationId: ORG,
    aiAutoReplyEnabled: true,
    sendPrivateDm,
    autoHideSpam: true,
    replyDelaySeconds: 0,
    tonePreference: "FRIENDLY_SALES",
    bannedKeywords: [],
    nightOwlEnabled: false,
    nightOwlMessage: null,
    urgentAlertTelegramEnabled: false,
    telegramChatId: null,
    telegramBotToken: null,
    salesOrderUrl: null,
    freeDeliveryThresholdMinor: null,
    cannedSnippets: [],
    updatedById: null,
  });
  const complaintDto = {
    platform: "facebook",
    externalPostId: "post-1",
    externalCommentId: "ext-complaint-1",
    authorName: "রফিক",
    authorSocialId: "fb-rafiq",
    commentText: "আপনাদের সার্ভিস খুব খারাপ, প্রোডাক্ট ভাঙা ছিল!",
  };

  it("fires through the REAL ingest reply path when the drafted DM was not sent (setting off)", async () => {
    const s = setup({ withProposer: true, replySettings: complaintSettings(false) });
    const ingested: any = await s.social.ingestComment(ORG, complaintDto as any);
    await flush();
    // the public DM-invitation reply posted; no DM went out
    expect(ingested.status).toBe("PENDING");
    expect(ingested.replyText).toContain("ইনবক্সে");
    expect(ingested.isPrivateDmSent).toBe(false);
    expect(s.graph.privateReplyToComment).not.toHaveBeenCalled();
    // exactly one follow-up proposal, carrying the plan's own drafted DM text
    expect(s.proposals).toHaveLength(1);
    const p = s.proposals[0];
    expect(p.actionId).toBe("send_dm_to_commenter");
    expect(p.proposedBy).toBe("ai");
    expect(p.sourceRef.trigger).toBe("dm_followup_complaint");
    expect(p.payload.message).toBe(ingested.privateDmText);
    expect(p.payload.message).toContain("অর্ডার আইডি");
    // L3 preview discipline: the preview quotes the DM text and
    // the public comment only — no order/memory facts exist here.
    expect(p.preview).toContain("অর্ডার আইডি");
    // approving it performs the follow-through DM for real
    const done: any = await s.engine.approve(ORG, OWNER, p.id);
    expect(done.status).toBe("executed");
    expect(s.graph.privateReplyToComment).toHaveBeenCalledTimes(1);
    expect(s.comments.find((c) => c.id === ingested.id)?.isPrivateDmSent).toBe(true);
  });

  it("silent when the pipeline's own DM was sent with the reply (setting on)", async () => {
    const s = setup({ withProposer: true, replySettings: complaintSettings(true) });
    const ingested: any = await s.social.ingestComment(ORG, complaintDto as any);
    await flush();
    expect(ingested.isPrivateDmSent).toBe(true);
    expect(s.graph.privateReplyToComment).toHaveBeenCalledTimes(1);
    expect(s.proposals).toHaveLength(0);
  });

  it("silent for a non-complaint comment even when no DM was sent", async () => {
    const s = setup({ withProposer: true, replySettings: complaintSettings(false) });
    await s.social.ingestComment(ORG, {
      platform: "facebook",
      externalPostId: "post-1",
      externalCommentId: "ext-general-1",
      authorName: "সুমন",
      authorSocialId: "fb-sumon",
      commentText: "খুব সুন্দর প্রোডাক্ট!",
    } as any);
    await flush();
    expect(s.proposals).toHaveLength(0);
  });

  it("handler-level: a missing/blank drafted text proposes nothing, and L0 proposes nothing", async () => {
    const s = setup({ withProposer: true });
    await s.proposer.onDmFollowupNeeded({ organizationId: ORG, context: { commentId: "cmt-plain" } });
    await s.proposer.onDmFollowupNeeded({ organizationId: ORG, context: { commentId: "cmt-plain", privateDmText: "   " } });
    expect(s.proposals).toHaveLength(0);
    await s.engine.setAutonomy(ORG, "send_dm_to_commenter", 0, OWNER);
    await s.proposer.onDmFollowupNeeded({ organizationId: ORG, context: { commentId: "cmt-plain", privateDmText: "অর্ডার নম্বরটি জানান।" } });
    expect(s.proposals).toHaveLength(0);
  });
});
