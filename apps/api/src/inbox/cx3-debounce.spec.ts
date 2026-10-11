import "reflect-metadata";
import { InboxService } from "./inbox.service";
import { SocialCommentsService } from "./social-comments.service";
import { CommentClassifier } from "./comment-classifier";
import { CommentHumanizer } from "./comment-humanizer";

/**
 * CX3 — Wait-before-answering (debounce).
 *
 * Inbox: InboxSetting.aiReplyDelaySeconds (+ per-channel
 * overrides) defers ONLY the compose step of maybeAutoReply —
 * escalation / whitelist / confidence run immediately — and the
 * inbox_autoreply_sweep (runDueAutoReplies) later fires ONE
 * reply composed from the whole message batch, claimed by a
 * conditional updateMany on the exact due timestamp.
 *
 * Comments: SocialReplySetting.replyDelaySeconds (which existed
 * but was never applied) now defers the AI reply at ingest;
 * runDueCommentReplies fires it, batching earlier same-author /
 * same-post comments into the latest comment's single reply.
 * Hide/spam stays immediate.
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
    if (k === "organizationId_externalCommentId" && v && typeof v === "object") {
      return row.organizationId === v.organizationId && row.externalCommentId === v.externalCommentId;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
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
      return true;
    }
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
const ORG_B = "org-2";
const CLS = (intent: string, confidence = 95, sentiment: string | null = null) => ({ intent, confidence, sentiment } as any);

function inboxSetup() {
  const settings: Row[] = [{ id: "s1", organizationId: ORG, autoReplyMode: "auto", confidenceThreshold: 70, perIntent: {}, smartAssign: "off", slaFirstResponseMinutes: 60, perChannelModes: {}, escalationThresholdMinor: null, aiReplyDelaySeconds: 0, aiReplyDelayByChannel: {} }];
  const conversations: Row[] = [];
  const messages: Row[] = [];
  const drafts: Row[] = [];
  const products: Row[] = [
    { id: "p1", organizationId: ORG, name: "কটন শাড়ি", priceMinor: 120000n, currency: "BDT", stockQuantity: 5, status: "ACTIVE", createdAt: new Date("2026-01-01") },
    { id: "p2", organizationId: ORG, name: "লেদার ব্যাগ", priceMinor: 250000n, currency: "BDT", stockQuantity: 2, status: "ACTIVE", createdAt: new Date("2026-01-02") },
  ];
  const db = {
    inboxSetting: table(settings),
    channelConversation: table(conversations),
    channelMessage: table(messages),
    messageDraft: table(drafts),
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
  return { service, db, audit, settings, conversations, messages, drafts };
}
function conv(over: Row = {}): Row {
  return { id: `c-${Math.random().toString(36).slice(2, 8)}`, organizationId: ORG, channel: "webchat", status: "open", assignedUserId: null, priority: "normal", sentimentFlag: null, autoReplyPaused: false, customerId: null, contactName: "রহিম", createdAt: new Date(), lastMessageAt: new Date(), firstResponseAt: new Date(), autoReplyDueAt: null, autoReplyBatchSince: null, ...over };
}
function inbound(conversationId: string, content: string, createdAt = new Date()): Row {
  return { id: `m-${Math.random().toString(36).slice(2, 8)}`, conversationId, direction: "in", type: "text", content, status: "received", autoReply: false, sentByUserId: null, createdAt };
}

describe("CX3 inbox settings: delay fields round-trip + validation", () => {
  it("defaults are 0 / {} and updates persist; out-of-range and bad shapes -> 400", async () => {
    const { service, settings } = inboxSetup();
    settings[0].aiReplyDelaySeconds = undefined; settings[0].aiReplyDelayByChannel = undefined;
    const s0 = await service.getSettings(ORG);
    expect(s0.aiReplyDelaySeconds).toBe(0);
    expect(s0.aiReplyDelayByChannel).toEqual({});

    const s1 = await service.updateSettings(ORG, "owner", { aiReplyDelaySeconds: 45, aiReplyDelayByChannel: { whatsapp: 90 } });
    expect(s1.aiReplyDelaySeconds).toBe(45);
    expect(s1.aiReplyDelayByChannel).toEqual({ whatsapp: 90 });
    expect(settings[0].aiReplyDelaySeconds).toBe(45);

    await expect(service.updateSettings(ORG, "owner", { aiReplyDelaySeconds: 601 })).rejects.toThrow(/0\.\.600/);
    await expect(service.updateSettings(ORG, "owner", { aiReplyDelaySeconds: -1 })).rejects.toThrow(/0\.\.600/);
    await expect(service.updateSettings(ORG, "owner", { aiReplyDelaySeconds: 1.5 })).rejects.toThrow(/0\.\.600/);
    await expect(service.updateSettings(ORG, "owner", { aiReplyDelayByChannel: { whatsapp: 999 } })).rejects.toThrow(/0\.\.600/);
    await expect(service.updateSettings(ORG, "owner", { aiReplyDelayByChannel: { pigeon: 10 } as any })).rejects.toThrow(/Unknown channel/);
    await expect(service.updateSettings(ORG, "owner", { aiReplyDelayByChannel: [] as any })).rejects.toThrow(/object/);
  });

  it("per-channel override wins over the org value at the defer point", async () => {
    const { service, conversations } = inboxSetup();
    await service.updateSettings(ORG, "owner", { aiReplyDelaySeconds: 0, aiReplyDelayByChannel: { webchat: 30 } });
    const c = conv(); conversations.push(c);
    const before = Date.now();
    await (service as any).maybeAutoReply(ORG, c, CLS("price"), "কটন শাড়ি এর দাম কত?");
    expect(c.autoReplyDueAt).toBeTruthy();
    expect(new Date(c.autoReplyDueAt).getTime() - before).toBeGreaterThanOrEqual(29_000);
  });
});

describe("CX3 inbox debounce", () => {
  it("delay=0 regression: sends immediately and never sets autoReplyDueAt", async () => {
    const { service, conversations, messages } = inboxSetup();
    const c = conv(); conversations.push(c);
    await (service as any).maybeAutoReply(ORG, c, CLS("price"), "কটন শাড়ি এর দাম কত?");
    const sent = messages.filter((m) => m.autoReply);
    expect(sent).toHaveLength(1);
    expect(sent[0].status).toBe("sent");
    expect(sent[0].content).toContain("কটন শাড়ি");
    expect(c.autoReplyDueAt ?? null).toBeNull();
    expect(c.autoReplyBatchSince ?? null).toBeNull();
  });

  it("delay 45: first message defers (dueAt ≈ +45s, batchSince set, nothing sent); second extends dueAt, batchSince unchanged", async () => {
    const { service, conversations, messages } = inboxSetup();
    await service.updateSettings(ORG, "owner", { aiReplyDelaySeconds: 45 });
    const c = conv(); conversations.push(c);
    const t0 = Date.now();
    await (service as any).maybeAutoReply(ORG, c, CLS("price"), "কটন শাড়ি এর দাম কত?");
    expect(messages.filter((m) => m.autoReply)).toHaveLength(0);
    expect(c.autoReplyDueAt).toBeTruthy();
    const due1 = new Date(c.autoReplyDueAt).getTime();
    expect(due1 - t0).toBeGreaterThanOrEqual(44_000);
    expect(due1 - t0).toBeLessThanOrEqual(46_000);
    const batchSince = c.autoReplyBatchSince;
    expect(batchSince).toBeTruthy();

    // simulate a couple of seconds passing, then the second message
    await new Promise((r) => setTimeout(r, 1100));
    await (service as any).maybeAutoReply(ORG, c, CLS("price"), "লেদার ব্যাগ এর দাম কত?");
    expect(messages.filter((m) => m.autoReply)).toHaveLength(0);
    expect(new Date(c.autoReplyDueAt).getTime()).toBeGreaterThan(due1);
    expect(c.autoReplyBatchSince).toBe(batchSince);
  });

  it("fire: runDueAutoReplies sends exactly ONE reply for a 2-message batch, composed from the combined text; re-running sends nothing", async () => {
    const { service, conversations, messages } = inboxSetup();
    await service.updateSettings(ORG, "owner", { aiReplyDelaySeconds: 45 });
    const c = conv(); conversations.push(c);
    messages.push(inbound(c.id, "কটন শাড়ি এর দাম কত?"));
    await (service as any).maybeAutoReply(ORG, c, CLS("price"), "কটন শাড়ি এর দাম কত?");
    messages.push(inbound(c.id, "লেদার ব্যাগ এর দাম কত?"));
    await (service as any).maybeAutoReply(ORG, c, CLS("price"), "লেদার ব্যাগ এর দাম কত?");
    expect(messages.filter((m) => m.autoReply)).toHaveLength(0);

    c.autoReplyDueAt = new Date(Date.now() - 1000); // due
    const res = await service.runDueAutoReplies(ORG);
    expect(res.fired).toBe(1);
    const sent = messages.filter((m) => m.autoReply && m.status === "sent");
    expect(sent).toHaveLength(1);
    // The combined batch text mentions BOTH products; the grounded
    // compose picks the FIRST match in the combined text, so the
    // single reply is about the first product — proof the reply
    // derived from the batch, not from the last message alone
    // (which would have answered about লেদার ব্যাগ).
    expect(sent[0].content).toContain("কটন শাড়ি");
    expect(c.autoReplyDueAt ?? null).toBeNull();
    expect(c.autoReplyBatchSince ?? null).toBeNull();

    const res2 = await service.runDueAutoReplies(ORG);
    expect(res2).toEqual({ fired: 0, skipped: 0 });
    expect(messages.filter((m) => m.autoReply)).toHaveLength(1);
  });

  it("human reply inside the batch window discharges the batch: no AI send, markers cleared", async () => {
    const { service, conversations, messages } = inboxSetup();
    await service.updateSettings(ORG, "owner", { aiReplyDelaySeconds: 45 });
    const c = conv(); conversations.push(c);
    messages.push(inbound(c.id, "কটন শাড়ি এর দাম কত?"));
    await (service as any).maybeAutoReply(ORG, c, CLS("price"), "কটন শাড়ি এর দাম কত?");
    messages.push({ id: "human-1", conversationId: c.id, direction: "out", type: "text", content: "আমি দেখছি", status: "sent", autoReply: false, sentByUserId: "agent-1", createdAt: new Date() });
    c.autoReplyDueAt = new Date(Date.now() - 1000);
    const res = await service.runDueAutoReplies(ORG);
    expect(res.fired).toBe(0);
    expect(messages.filter((m) => m.autoReply)).toHaveLength(0);
    expect(c.autoReplyBatchSince ?? null).toBeNull();
  });

  it("autoReplyPaused before fire -> no send, batch discharged", async () => {
    const { service, conversations, messages } = inboxSetup();
    await service.updateSettings(ORG, "owner", { aiReplyDelaySeconds: 45 });
    const c = conv(); conversations.push(c);
    messages.push(inbound(c.id, "কটন শাড়ি এর দাম কত?"));
    await (service as any).maybeAutoReply(ORG, c, CLS("price"), "কটন শাড়ি এর দাম কত?");
    c.autoReplyPaused = true;
    c.autoReplyDueAt = new Date(Date.now() - 1000);
    const res = await service.runDueAutoReplies(ORG);
    expect(res.fired).toBe(0);
    expect(messages.filter((m) => m.autoReply)).toHaveLength(0);
    expect(c.autoReplyBatchSince ?? null).toBeNull();
  });

  it("escalation is immediate even with a delay: complaint pauses + audits at ingest, no dueAt is set", async () => {
    const { service, conversations, messages, audit } = inboxSetup();
    await service.updateSettings(ORG, "owner", { aiReplyDelaySeconds: 45 });
    const c = conv(); conversations.push(c);
    await (service as any).maybeAutoReply(ORG, c, CLS("complaint", 90, "negative"), "খুবই বাজে সার্ভিস, রিফান্ড চাই");
    expect(c.autoReplyPaused).toBe(true);
    expect(c.autoReplyDueAt ?? null).toBeNull();
    expect(audit.calls.some((a) => a.action === "inbox.autopilot.escalated")).toBe(true);
    expect(messages.filter((m) => m.autoReply)).toHaveLength(0);
  });

  it("draft mode defers too: the draft is composed at fire time", async () => {
    const { service, conversations, messages, drafts } = inboxSetup();
    await service.updateSettings(ORG, "owner", { autoReplyMode: "draft", aiReplyDelaySeconds: 30 });
    const c = conv(); conversations.push(c);
    messages.push(inbound(c.id, "কটন শাড়ি এর দাম কত?"));
    await (service as any).maybeAutoReply(ORG, c, CLS("price"), "কটন শাড়ি এর দাম কত?");
    expect(drafts).toHaveLength(0);
    c.autoReplyDueAt = new Date(Date.now() - 1000);
    await service.runDueAutoReplies(ORG);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].content).toContain("কটন শাড়ি");
  });

  it("tenant isolation: the sweep only fires the given org's due conversations", async () => {
    const { service, conversations, messages } = inboxSetup();
    await service.updateSettings(ORG, "owner", { aiReplyDelaySeconds: 45 });
    const mine = conv(); conversations.push(mine);
    const other = conv({ organizationId: ORG_B }); conversations.push(other);
    messages.push(inbound(mine.id, "কটন শাড়ি এর দাম কত?"));
    messages.push(inbound(other.id, "কটন শাড়ি এর দাম কত?"));
    mine.autoReplyBatchSince = new Date(Date.now() - 5000); mine.autoReplyDueAt = new Date(Date.now() - 1000);
    other.autoReplyBatchSince = new Date(Date.now() - 5000); other.autoReplyDueAt = new Date(Date.now() - 1000);
    const res = await service.runDueAutoReplies(ORG);
    expect(res.fired).toBe(1);
    expect(messages.filter((m) => m.autoReply)).toHaveLength(1);
    expect(other.autoReplyDueAt).toBeTruthy(); // untouched
  });
});

// ---------- Comments ----------

function commentsSetup(replyDelaySeconds = 25) {
  const replySettings: Row[] = [{
    id: "rs1", organizationId: ORG, aiAutoReplyEnabled: true, sendPrivateDm: true, autoHideSpam: true,
    replyDelaySeconds, tonePreference: "FRIENDLY_SALES", bannedKeywords: [], salesOrderUrl: null,
    nightOwlEnabled: false, urgentAlertTelegramEnabled: false, telegramChatId: null, telegramBotToken: null,
  }];
  const comments: Row[] = [];
  const products: Row[] = [
    { id: "p1", organizationId: ORG, name: "লেদার ওয়ালেট", priceMinor: 125000n, currency: "BDT", slug: "wallet", status: "ACTIVE" },
  ];
  const leads: Row[] = [];
  const db = {
    socialReplySetting: table(replySettings),
    socialComment: table(comments),
    product: table(products),
    lead: table(leads),
  };
  const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
  const service = new SocialCommentsService(db as any, audit as any);
  return { service, db, audit, replySettings, comments, leads };
}
const dto = (over: Row = {}): any => ({
  platform: "facebook", externalPostId: "post-1", externalCommentId: `cmt-${Math.random().toString(36).slice(2, 8)}`,
  postTitle: "লেদার ওয়ালেট অফার", authorName: "রাকিব হাসান", authorSocialId: "fb-rakib",
  commentText: "এটার দাম কত ভাই?", ...over,
});

describe("CX3 comments ingest: the delay finally applies", () => {
  it("default delay 25: ingest leaves replyText null, repliedAt null, DM unsent, and sets aiReplyDueAt ≈ +25s (plan retained)", async () => {
    const { service, comments } = commentsSetup(25);
    const before = Date.now();
    const c: any = await service.ingestComment(ORG, dto());
    expect(c.status).toBe("PENDING");
    expect(c.replyText).toBeNull();
    expect(c.repliedAt).toBeNull();
    expect(c.isPrivateDmSent).toBe(false);
    expect(c.privateDmText).toBeTruthy(); // plan retained
    expect(c.metadata?.aiPlanned?.publicCommentReply).toBeTruthy();
    expect(c.aiReplyDueAt).toBeTruthy();
    const due = new Date(c.aiReplyDueAt).getTime();
    expect(due - before).toBeGreaterThanOrEqual(24_000);
    expect(due - before).toBeLessThanOrEqual(26_000);
    expect(comments).toHaveLength(1);
  });

  it("spam -> HIDDEN immediately, no dueAt, no reply — the delay never applies to safety actions", async () => {
    const { service } = commentsSetup(25);
    const c: any = await service.ingestComment(ORG, dto({ commentText: "ঘরে বসে প্রতিদিন ইনকাম করতে টেলিগ্রাম চ্যানেলে জয়েন করুন" }));
    expect(c.status).toBe("HIDDEN");
    expect(c.aiReplyDueAt ?? null).toBeNull();
    expect(c.replyText).toBeNull();
  });

  it("delay 0 -> today's instant behaviour exactly (reply applied at ingest, no dueAt)", async () => {
    const { service } = commentsSetup(0);
    const c: any = await service.ingestComment(ORG, dto());
    expect(c.replyText).toBeTruthy();
    expect(c.repliedAt).toBeTruthy();
    expect(c.isPrivateDmSent).toBe(true);
    expect(c.aiReplyDueAt ?? null).toBeNull();
  });

  it("aiAutoReplyEnabled=false -> nothing is scheduled at ingest", async () => {
    const { service, replySettings } = commentsSetup(25);
    replySettings[0].aiAutoReplyEnabled = false;
    const c: any = await service.ingestComment(ORG, dto());
    expect(c.aiReplyDueAt ?? null).toBeNull();
    expect(c.replyText).toBeNull();
  });
});

describe("CX3 comments sweep: runDueCommentReplies", () => {
  it("single due comment -> AUTO_REPLIED with the humanizer plan for its text; re-running fires nothing", async () => {
    const { service, comments } = commentsSetup(25);
    const c: any = await service.ingestComment(ORG, dto());
    c.aiReplyDueAt = new Date(Date.now() - 1000);
    const res = await service.runDueCommentReplies(ORG);
    expect(res).toEqual({ fired: 1, batched: 0, skipped: 0 });
    expect(c.status).toBe("AUTO_REPLIED");
    expect(c.replyText).toBeTruthy();
    expect(c.repliedAt).toBeTruthy();
    expect(c.aiReplyDueAt ?? null).toBeNull();
    const res2 = await service.runDueCommentReplies(ORG);
    expect(res2.fired).toBe(0);
    expect(comments).toHaveLength(1);
  });

  it("batch of 2 (same author + post): ONE reply on the latest, composed from the combined text; the earlier is discharged via aiReplyBatchOf + metadata", async () => {
    const rand = jest.spyOn(Math, "random").mockReturnValue(0);
    try {
      const { service } = commentsSetup(25);
      const first: any = await service.ingestComment(ORG, dto({ externalCommentId: "cmt-first", commentText: "লেদার ওয়ালেট এর দাম কত?" }));
      // ensure a strictly later createdAt for the second comment
      await new Promise((r) => setTimeout(r, 5));
      const second: any = await service.ingestComment(ORG, dto({ externalCommentId: "cmt-second", commentText: "ডেলিভারি চার্জ কত?" }));
      first.aiReplyDueAt = new Date(Date.now() - 1000);
      second.aiReplyDueAt = new Date(Date.now() - 1000);

      const res = await service.runDueCommentReplies(ORG);
      expect(res.fired).toBe(1);
      expect(res.batched).toBe(1);

      // expected reply = the humanizer plan for the COMBINED text
      const classification = CommentClassifier.classify(`${first.commentText}\n${second.commentText}`, []);
      const expected = CommentHumanizer.generateHumanReply({
        authorName: second.authorName,
        commentText: `${first.commentText}\n${second.commentText}`,
        classification,
        postTitle: second.postTitle,
        matchedProduct: { name: "লেদার ওয়ালেট", priceFormatted: "BDT 1250.00", orderUrl: "/checkout/wallet" },
        tonePreference: "FRIENDLY_SALES",
        isNightOwl: false,
      });
      expect(second.status).toBe("AUTO_REPLIED");
      expect(second.replyText).toBe(expected.publicCommentReply);

      expect(first.status).toBe("AUTO_REPLIED");
      expect(first.aiReplyBatchOf).toBe("cmt-second");
      expect(first.metadata?.aiReplyBatch?.coveredBy).toBe("cmt-second");
      expect(first.replyText ?? null).toBeNull(); // covered, not separately replied
    } finally {
      rand.mockRestore();
    }
  });

  it("skips a comment an agent already MANUALLY_REPLIED (and one whose org disabled auto-reply)", async () => {
    const { service, replySettings } = commentsSetup(25);
    const c: any = await service.ingestComment(ORG, dto());
    c.status = "MANUALLY_REPLIED"; c.replyText = "মানুষের উত্তর";
    c.aiReplyDueAt = new Date(Date.now() - 1000);
    const res = await service.runDueCommentReplies(ORG);
    expect(res.fired).toBe(0);
    expect(c.replyText).toBe("মানুষের উত্তর");

    const c2: any = await service.ingestComment(ORG, dto());
    c2.aiReplyDueAt = new Date(Date.now() - 1000);
    replySettings[0].aiAutoReplyEnabled = false;
    const res2 = await service.runDueCommentReplies(ORG);
    expect(res2.fired).toBe(0);
    expect(c2.status).toBe("PENDING");
    expect(c2.replyText).toBeNull();
  });

  it("tenant isolation: the sweep only fires the given org's comments", async () => {
    const { service, comments } = commentsSetup(25);
    const mine: any = await service.ingestComment(ORG, dto({ externalCommentId: "mine-1" }));
    mine.aiReplyDueAt = new Date(Date.now() - 1000);
    comments.push({
      id: "foreign-1", organizationId: ORG_B, platform: "facebook", externalPostId: "post-1", externalCommentId: "foreign-cmt",
      authorName: "অন্য", commentText: "দাম কত?", status: "PENDING", replyText: null, repliedAt: null,
      isPrivateDmSent: false, aiReplyDueAt: new Date(Date.now() - 1000), createdAt: new Date(),
    });
    const res = await service.runDueCommentReplies(ORG);
    expect(res.fired).toBe(1);
    const foreign = comments.find((c) => c.id === "foreign-1")!;
    expect(foreign.status).toBe("PENDING");
    expect(foreign.replyText).toBeNull();
  });
});
