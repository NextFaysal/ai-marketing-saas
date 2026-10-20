import "reflect-metadata";
import { SocialCommentsService } from "./social-comments.service";
import { MetaMessagingClient } from "./meta-messaging.client";

/**
 * IN8 — Comment + DM unified queue (verify-first).
 *
 * Audit verdict this spec encodes: before IN8, SocialCommentsService
 * never called Meta Graph at all — hide flipped only the local
 * status, replies were stored text that never left our DB, there
 * was no delete path, and isPrivateDmSent came from the AI plan
 * without any send. The Graph layer added here is proven the same
 * way IN6 proved its client: a REAL MetaMessagingClient over a
 * fake fetch — URL, method and body are asserted, success counts
 * only on the documented confirmation body, and Graph failures
 * surface verbatim with the local row untouched. No live Meta
 * credential exists in this environment (M30) — nothing here
 * claims a live send.
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
    if (k === "organizationId_externalCommentId" && v && typeof v === "object") {
      return row.organizationId === v.organizationId && row.externalCommentId === v.externalCommentId;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v.in as any[]).includes(row[k]);
      if ("not" in v) {
        if (v.not === null) return row[k] !== null && row[k] !== undefined;
        return !eqVal(row[k], v.not);
      }
      if ("contains" in v) return String(row[k] ?? "").toLowerCase().includes(String(v.contains).toLowerCase());
      if ("lt" in v && !(new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false;
      if ("lte" in v && !(new Date(row[k]).getTime() <= new Date(v.lte).getTime())) return false;
      return true;
    }
    return eqVal(row[k], v);
  });
}
function table(store: Row[]) {
  return {
    findMany: jest.fn(async ({ where, take, skip, orderBy }: any = {}) => {
      let rows = store.filter((r) => match(r, where));
      if (orderBy?.createdAt === "desc") rows = [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (skip) rows = rows.slice(skip);
      return take ? rows.slice(0, take) : rows;
    }),
    findFirst: jest.fn(async ({ where }: any = {}) => store.find((r) => match(r, where)) ?? null),
    findUnique: jest.fn(async ({ where }: any = {}) => store.find((r) => match(r, where)) ?? null),
    create: jest.fn(async ({ data }: any) => { const row = { id: `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...data }; store.push(row); return row; }),
    update: jest.fn(async ({ where, data }: any) => { const row = store.find((r) => r.id === where.id || match(r, where)); if (!row) throw new Error("nf"); Object.assign(row, data); return row; }),
    updateMany: jest.fn(async ({ where, data }: any) => { let n = 0; for (const r of store) if (match(r, where)) { Object.assign(r, data); n++; } return { count: n }; }),
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

/** Scripted fake fetch: routes by URL suffix; records every call. */
function scriptedFetch(routes: { suffix: string; body: any; ok?: boolean; status?: number }[]) {
  const calls: { url: string; method: string; body: any }[] = [];
  const fetchFn = async (url: string, init: any = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: String(url), method: init.method ?? "GET", body });
    const route = routes.find((r) => String(url).endsWith(r.suffix) || String(url).includes(r.suffix));
    if (!route) return { ok: false, status: 404, json: async () => ({ error: { message: `no route for ${url}` } }) } as any;
    return { ok: route.ok ?? true, status: route.status ?? 200, json: async () => route.body } as any;
  };
  return { calls, fetchFn: fetchFn as any };
}

const commentRow = (over: Row = {}): Row => ({
  id: "c1", organizationId: ORG, platform: "facebook", externalPostId: "post-9",
  externalCommentId: "ext-cmt-1", postTitle: "লেদার ওয়ালেট অফার", authorName: "রাকিব হাসান",
  authorSocialId: "fb-rakib", commentText: "এটার দাম কত ভাই?", sentiment: "POSITIVE",
  intent: "PRICE_QUERY", status: "PENDING", replyText: null, repliedAt: null,
  isPrivateDmSent: false, privateDmText: null, metadata: {}, assignedUserId: null,
  dmConversationId: null, createdAt: new Date(), ...over,
});

function setup(routes: Parameters<typeof scriptedFetch>[0], seedComments: Row[] = [commentRow()]) {
  const comments: Row[] = [...seedComments];
  const conversations: Row[] = [];
  const notes: Row[] = [];
  const settings: Row[] = [{
    id: "rs1", organizationId: ORG, aiAutoReplyEnabled: true, sendPrivateDm: true, autoHideSpam: true,
    replyDelaySeconds: 25, tonePreference: "FRIENDLY_SALES", bannedKeywords: [], salesOrderUrl: null,
    nightOwlEnabled: false, urgentAlertTelegramEnabled: false, telegramChatId: null, telegramBotToken: null,
  }];
  const db = {
    socialComment: table(comments),
    socialReplySetting: table(settings),
    product: table([] as Row[]),
    lead: table([] as Row[]),
    channelConversation: table(conversations),
    conversationNote: table(notes),
  };
  const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
  const service = new SocialCommentsService(db as any, audit as any);
  const { calls, fetchFn } = scriptedFetch(routes);
  (service as any).graphClientFor = async () => new MetaMessagingClient({ accessToken: "tok" }, fetchFn);
  return { service, db, audit, comments, conversations, notes, calls };
}

describe("IN8 client: Graph comment endpoints (real client, fake fetch)", () => {
  it("hide = POST /{comment-id} {is_hidden:true}; {success:true} confirms", async () => {
    const { calls, fetchFn } = scriptedFetch([{ suffix: "/ext-1", body: { success: true } }]);
    const client = new MetaMessagingClient({ accessToken: "t" }, fetchFn);
    await expect(client.setCommentHidden("ext-1", true)).resolves.toEqual({ success: true });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain("/ext-1");
    expect(calls[0].body).toEqual({ is_hidden: true });
  });

  it("hide without {success:true} is NOT a hide; Graph errors surface verbatim", async () => {
    const silent = new MetaMessagingClient({ accessToken: "t" }, scriptedFetch([{ suffix: "/ext-1", body: {} }]).fetchFn);
    await expect(silent.setCommentHidden("ext-1", true)).rejects.toThrow(/NOT hidden/);
    const failing = new MetaMessagingClient({ accessToken: "t" }, scriptedFetch([{ suffix: "/ext-1", body: { error: { message: "Unsupported post request" } }, ok: false, status: 400 }]).fetchFn);
    await expect(failing.setCommentHidden("ext-1", true)).rejects.toThrow("Unsupported post request");
  });

  it("reply = POST /{comment-id}/comments {message}; the returned id confirms", async () => {
    const { calls, fetchFn } = scriptedFetch([{ suffix: "/ext-1/comments", body: { id: "reply-7" } }]);
    const client = new MetaMessagingClient({ accessToken: "t" }, fetchFn);
    await expect(client.replyToComment("ext-1", "দাম ১২৫০ টাকা")).resolves.toEqual({ commentId: "reply-7" });
    expect(calls[0].body).toEqual({ message: "দাম ১২৫০ টাকা" });
    const silent = new MetaMessagingClient({ accessToken: "t" }, scriptedFetch([{ suffix: "/ext-1/comments", body: {} }]).fetchFn);
    await expect(silent.replyToComment("ext-1", "x")).rejects.toThrow(/NOT confirmed/);
  });

  it("delete = DELETE /{comment-id}; {success:true} confirms, anything else throws", async () => {
    const { calls, fetchFn } = scriptedFetch([{ suffix: "/ext-1", body: { success: true } }]);
    const client = new MetaMessagingClient({ accessToken: "t" }, fetchFn);
    await expect(client.deleteComment("ext-1")).resolves.toEqual({ success: true });
    expect(calls[0].method).toBe("DELETE");
    const silent = new MetaMessagingClient({ accessToken: "t" }, scriptedFetch([{ suffix: "/ext-1", body: {} }]).fetchFn);
    await expect(silent.deleteComment("ext-1")).rejects.toThrow(/NOT deleted/);
  });

  it("private reply = POST /{comment-id}/private_replies {message}; id confirms, window error is verbatim", async () => {
    const { calls, fetchFn } = scriptedFetch([{ suffix: "/ext-1/private_replies", body: { id: "dm-3", recipient_id: "fb-rakib" } }]);
    const client = new MetaMessagingClient({ accessToken: "t" }, fetchFn);
    await expect(client.privateReplyToComment("ext-1", "ইনবক্সে বিস্তারিত পাঠালাম")).resolves.toEqual({ messageId: "dm-3" });
    expect(calls[0].body).toEqual({ message: "ইনবক্সে বিস্তারিত পাঠালাম" });
    const expired = new MetaMessagingClient({ accessToken: "t" }, scriptedFetch([{ suffix: "/ext-1/private_replies", body: { error: { message: "(#10902) Private reply window expired" } }, ok: false, status: 400 }]).fetchFn);
    await expect(expired.privateReplyToComment("ext-1", "x")).rejects.toThrow("Private reply window expired");
  });
});

describe("IN8 service: local status moves only on Graph confirmation", () => {
  it("hide: Graph success -> HIDDEN + metadata; Graph failure -> verbatim throw, still PENDING", async () => {
    const ok = setup([{ suffix: "/ext-cmt-1", body: { success: true } }]);
    const hidden = await ok.service.updateCommentStatus(ORG, "c1", "HIDDEN");
    expect(hidden.status).toBe("HIDDEN");
    expect(ok.calls[0].body).toEqual({ is_hidden: true });

    const bad = setup([{ suffix: "/ext-cmt-1", body: { error: { message: "Cannot hide this comment" } }, ok: false, status: 400 }]);
    await expect(bad.service.updateCommentStatus(ORG, "c1", "HIDDEN")).rejects.toThrow("Cannot hide this comment");
    expect(bad.comments[0].status).toBe("PENDING");
  });

  it("unhide: HIDDEN -> PENDING posts {is_hidden:false} first", async () => {
    const s = setup([{ suffix: "/ext-cmt-1", body: { success: true } }], [commentRow({ status: "HIDDEN" })]);
    const back = await s.service.updateCommentStatus(ORG, "c1", "PENDING");
    expect(back.status).toBe("PENDING");
    expect(s.calls[0].body).toEqual({ is_hidden: false });
  });

  it("ESCALATED stays a local triage transition (no Graph call exists for it)", async () => {
    const s = setup([]);
    const esc = await s.service.updateCommentStatus(ORG, "c1", "ESCALATED");
    expect(esc.status).toBe("ESCALATED");
    expect(s.calls).toHaveLength(0);
  });

  it("reply: Graph success -> MANUALLY_REPLIED + graphReplyId; failure -> verbatim throw, row untouched", async () => {
    const ok = setup([{ suffix: "/ext-cmt-1/comments", body: { id: "reply-9" } }]);
    const sent: any = await ok.service.sendReply(ORG, "agent-1", "c1", { replyText: "দাম ১২৫০ টাকা ভাইয়া" });
    expect(sent.status).toBe("MANUALLY_REPLIED");
    expect(sent.graphReplyId).toBe("reply-9");
    expect(sent.metadata.graph.replyId).toBe("reply-9");

    const bad = setup([{ suffix: "/ext-cmt-1/comments", body: { error: { message: "Invalid OAuth access token" } }, ok: false, status: 400 }]);
    await expect(bad.service.sendReply(ORG, "agent-1", "c1", { replyText: "x" })).rejects.toThrow("Invalid OAuth access token");
    expect(bad.comments[0].status).toBe("PENDING");
    expect(bad.comments[0].replyText).toBeNull();
  });

  it("delete: confirmed -> DELETED; unconfirmed -> throw, status unchanged", async () => {
    const ok = setup([{ suffix: "/ext-cmt-1", body: { success: true } }]);
    const del = await ok.service.deleteComment(ORG, "agent-1", "c1");
    expect(del.status).toBe("DELETED");
    expect(ok.calls[0].method).toBe("DELETE");

    const bad = setup([{ suffix: "/ext-cmt-1", body: {}, ok: true }]);
    await expect(bad.service.deleteComment(ORG, "agent-1", "c1")).rejects.toThrow(/NOT deleted/);
    expect(bad.comments[0].status).toBe("PENDING");
  });

  it("no connected Meta integration -> honest refusal before anything changes; tiktok has no Graph path at all", async () => {
    const comments: Row[] = [commentRow()];
    const db = { socialComment: table(comments), socialReplySetting: table([] as Row[]), product: table([] as Row[]), lead: table([] as Row[]) };
    const audit = { log: jest.fn(async () => undefined) };
    const bare = new SocialCommentsService(db as any, audit as any); // graphClientFor NOT stubbed
    await expect(bare.sendReply(ORG, "agent-1", "c1", { replyText: "x" })).rejects.toMatchObject({ code: "inbox.noConnectedMetaMessengerInstagramIntegration" });
    expect(comments[0].status).toBe("PENDING");

    const ttComments: Row[] = [commentRow({ platform: "tiktok" })];
    const ttDb = { socialComment: table(ttComments), socialReplySetting: table([] as Row[]), product: table([] as Row[]), lead: table([] as Row[]) };
    const ttService = new SocialCommentsService(ttDb as any, audit as any); // unpatched: platform check precedes any integration lookup
    await expect(ttService.updateCommentStatus(ORG, "c1", "HIDDEN")).rejects.toMatchObject({ code: "inbox.metaGraphCommentActionsAreNot" });
    expect(ttComments[0].status).toBe("PENDING");
  });
});

describe("IN8c: comment -> DM with inbox context", () => {
  it("private reply confirmed -> conversation found/created for the commenter + a context NOTE (post, comment, text); no message row is fabricated", async () => {
    const s = setup([{ suffix: "/ext-cmt-1/private_replies", body: { id: "dm-11" } }]);
    const res: any = await s.service.sendPrivateReply(ORG, "agent-1", "c1", "আসসালামু আলাইকুম, দাম ও ডেলিভারি বিস্তারিত এখানে দিলাম");
    expect(res.isPrivateDmSent).toBe(true);
    expect(res.graphPrivateReplyId).toBe("dm-11");
    expect(res.dmConversationId).toBeTruthy();
    expect(s.conversations).toHaveLength(1);
    expect(s.conversations[0]).toMatchObject({ organizationId: ORG, channel: "messenger", externalContactId: "fb-rakib", contactName: "রাকিব হাসান" });
    expect(s.comments[0].dmConversationId).toBe(s.conversations[0].id);
    expect(s.notes).toHaveLength(1);
    expect(s.notes[0].content).toContain("post-9");
    expect(s.notes[0].content).toContain("এটার দাম কত ভাই?");
    expect(s.notes[0].content).toContain("dm-11");
    // The fake DB has no channelMessage table at all: nothing in
    // this path can invent a thread message.
    expect((s.db as any).channelMessage).toBeUndefined();
  });

  it("private reply failure (window expired) -> verbatim throw, NO conversation, NO note, flag unset", async () => {
    const s = setup([{ suffix: "/ext-cmt-1/private_replies", body: { error: { message: "(#10902) Private reply window expired" } }, ok: false, status: 400 }]);
    await expect(s.service.sendPrivateReply(ORG, "agent-1", "c1", "hello")).rejects.toThrow("Private reply window expired");
    expect(s.conversations).toHaveLength(0);
    expect(s.notes).toHaveLength(0);
    expect(s.comments[0].isPrivateDmSent).toBe(false);
    expect(s.comments[0].dmConversationId).toBeNull();
  });

  it("a second private reply is refused up front (Meta allows one per comment) without any Graph call", async () => {
    const s = setup([], [commentRow({ isPrivateDmSent: true })]);
    await expect(s.service.sendPrivateReply(ORG, "agent-1", "c1", "again")).rejects.toMatchObject({ code: "inbox.aPrivateReplyWasAlreadySent" });
    expect(s.calls).toHaveLength(0);
  });

  it("reply with DM: public reply lands, DM fails -> reply kept, privateDmError reported, DM flag stays false", async () => {
    const s = setup([
      { suffix: "/ext-cmt-1/comments", body: { id: "reply-5" } },
      { suffix: "/ext-cmt-1/private_replies", body: { error: { message: "window closed" } }, ok: false, status: 400 },
    ]);
    const res: any = await s.service.sendReply(ORG, "agent-1", "c1", { replyText: "কমেন্টে উত্তর দিলাম", sendPrivateDm: true, privateDmText: "ইনবক্সে দেখুন" });
    expect(res.status).toBe("MANUALLY_REPLIED");
    expect(res.graphReplyId).toBe("reply-5");
    expect(res.privateDmError).toContain("window closed");
    expect(res.isPrivateDmSent).toBe(false);
    expect(s.conversations).toHaveLength(0);
  });
});

describe("IN8d: hide-word auto-hide regression + report counts", () => {
  const spamDto: any = {
    platform: "facebook", externalPostId: "post-9", externalCommentId: "spam-1",
    authorName: "Earn Money", authorSocialId: "fb-spam", commentText: "earn money online fast — click here now",
  };

  it("spam ingest: HIDDEN locally AND Graph hide attempted through the new layer (ok recorded)", async () => {
    const s = setup([{ suffix: "/spam-1", body: { success: true } }], []);
    const c: any = await s.service.ingestComment(ORG, spamDto);
    expect(c.status).toBe("HIDDEN");
    expect(c.metadata.graphHide).toMatchObject({ attempted: true, ok: true, source: "auto_hide" });
    expect(s.calls.some((x) => x.body?.is_hidden === true)).toBe(true);
  });

  it("spam ingest with Graph failing: local HIDDEN stands (safety), failure recorded verbatim — never dressed as platform-hidden", async () => {
    const s = setup([{ suffix: "/spam-1", body: { error: { message: "token expired" } }, ok: false, status: 400 }], []);
    const c: any = await s.service.ingestComment(ORG, spamDto);
    expect(c.status).toBe("HIDDEN");
    expect(c.metadata.graphHide.ok).toBe(false);
    expect(c.metadata.graphHide.error).toContain("token expired");
  });

  it("list stats report hidden counts from real rows; assign + unassigned filter work", async () => {
    const s = setup([], [
      commentRow({ id: "c1" }),
      commentRow({ id: "c2", externalCommentId: "ext-2", status: "HIDDEN", sentiment: "SPAM" }),
      commentRow({ id: "c3", externalCommentId: "ext-3", status: "HIDDEN", sentiment: "NEGATIVE" }),
    ]);
    const list: any = await s.service.listComments(ORG, {} as any);
    expect(list.stats).toMatchObject({ pendingCount: 1, spamCount: 1, hiddenCount: 2, hiddenSpamCount: 1 });

    await s.service.assignComment(ORG, "lead-1", "c1", "agent-7");
    expect(s.comments[0].assignedUserId).toBe("agent-7");
    const unassigned: any = await s.service.listComments(ORG, { unassigned: "true" } as any);
    expect(unassigned.items.map((i: any) => i.id).sort()).toEqual(["c2", "c3"]);
    const mine: any = await s.service.listComments(ORG, { assignedUserId: "agent-7" } as any);
    expect(mine.items.map((i: any) => i.id)).toEqual(["c1"]);
  });
});

describe("IN8 bulk: per-item Graph honesty", () => {
  it("HIDE_ALL: confirmed item hides, failed item is reported verbatim and left PENDING", async () => {
    const s = setup(
      [{ suffix: "/ext-cmt-1", body: { success: true } }, { suffix: "/ext-2", body: { error: { message: "hide denied" } }, ok: false, status: 400 }],
      [commentRow({ id: "c1" }), commentRow({ id: "c2", externalCommentId: "ext-2" })],
    );
    const res: any = await s.service.executeBulkAction(ORG, "agent-1", ["c1", "c2"], "HIDE_ALL");
    expect(res.affected).toBe(1);
    expect(res.failed).toEqual([{ id: "c2", error: expect.stringContaining("hide denied") }]);
    expect(s.comments[0].status).toBe("HIDDEN");
    expect(s.comments[1].status).toBe("PENDING");
  });
});
