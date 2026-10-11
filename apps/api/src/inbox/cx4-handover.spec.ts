import "reflect-metadata";
import { InboxService } from "./inbox.service";
import { AutomationService, JOB_TEMPLATES, JOB_TYPES } from "../automation/automation.service";

/**
 * CX4 — Handover queue polish.
 *
 * - escalateAutopilot now writes handoverReason + handoverAt as
 *   real fields (the audit entry keeps carrying the reason too).
 * - updateConversation supports timed assignment
 *   (assignForMinutes 5..480): assignedAt marks when the current
 *   assignment started, assignedUntil the deadline,
 *   assignmentKind "timed" | "normal" | null.
 * - runHandoverSweeps (handover_timer_sweep job): an expired timed
 *   assignment lapses to normal when the assignee replied after
 *   assignedAt; otherwise the conversation returns to the AI
 *   (assignee cleared, autopilot resumed, system note + audit).
 * - listConversations folder "handover": paused + open/pending,
 *   longest wait first (handoverAt ?? updatedAt); folder counts
 *   include handover.
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
    if (k === "AND") return (v as any[]).every((sub) => match(row, sub));
    if (k === "OR") return (v as any[]).some((sub) => match(row, sub));
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v.in as any[]).includes(row[k]);
      if ("notIn" in v) return !(v.notIn as any[]).includes(row[k]);
      if ("not" in v) {
        if (v.not === null) return row[k] !== null && row[k] !== undefined;
        return !eqVal(row[k], v.not);
      }
      if ("has" in v) return Array.isArray(row[k]) && row[k].includes(v.has);
      if ("contains" in v) return typeof row[k] === "string" && row[k].toLowerCase().includes(String(v.contains).toLowerCase());
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
    count: jest.fn(async ({ where }: any = {}) => store.filter((r) => match(r, where)).length),
    aggregate: jest.fn(async ({ where }: any = {}) => ({ _sum: { unreadCount: store.filter((r) => match(r, where)).reduce((s, r) => s + (r.unreadCount ?? 0), 0) } })),
  };
}

const ORG = "org-1";
const ORG_B = "org-2";

function setup() {
  const settings: Row[] = [{ id: "s1", organizationId: ORG, autoReplyMode: "auto", confidenceThreshold: 70, perIntent: {}, smartAssign: "off", slaFirstResponseMinutes: 60, perChannelModes: {}, escalationThresholdMinor: null }];
  const conversations: Row[] = [];
  const messages: Row[] = [];
  const notes: Row[] = [];
  const db = {
    inboxSetting: table(settings),
    channelConversation: table(conversations),
    channelMessage: table(messages),
    conversationNote: table(notes),
    messageDraft: table([] as Row[]),
    product: table([] as Row[]),
    order: table([] as Row[]),
    businessPolicy: table([] as Row[]),
    businessProfile: table([] as Row[]),
    knowledgeDocument: table([] as Row[]),
    aiUnansweredQuestion: table([] as Row[]),
    aIUsageRecord: table([] as Row[]),
    organization: table([{ id: ORG, name: "টেস্ট শপ", timezone: "Asia/Dhaka" }] as Row[]),
    membership: table([
      { id: "m1", organizationId: ORG, userId: "owner", role: "OWNER" },
      { id: "m2", organizationId: ORG, userId: "agent-1", role: "SUPPORT_AGENT" },
      { id: "m3", organizationId: ORG, userId: "agent-2", role: "SUPPORT_AGENT" },
    ] as Row[]),
    agentNotification: table([] as Row[]),
  };
  const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
  const llm = { getProvider: () => { throw new Error("no provider configured"); } };
  const service = new InboxService(db as any, audit as any, llm as any);
  return { service, db, audit, settings, conversations, messages, notes };
}
function conv(over: Row = {}): Row {
  return {
    id: `c-${Math.random().toString(36).slice(2, 8)}`, organizationId: ORG, channel: "whatsapp", status: "open",
    assignedUserId: null, assignedAt: null, assignedUntil: null, assignmentKind: null,
    priority: "normal", sentimentFlag: null, autoReplyPaused: false, handoverReason: null, handoverAt: null,
    customerId: null, contactName: "রহিম", unreadCount: 0, tags: [],
    createdAt: new Date(), updatedAt: new Date(), lastMessageAt: new Date(), firstResponseAt: new Date(),
    autoReplyDueAt: null, autoReplyBatchSince: null, ...over,
  };
}
const minsAgo = (n: number) => new Date(Date.now() - n * 60000);
const minsFromNow = (n: number) => new Date(Date.now() + n * 60000);

describe("CX4 (a) escalation writes handover fields", () => {
  it("escalateAutopilot stores handoverReason + handoverAt and keeps the audit reason", async () => {
    const { service, conversations, audit } = setup();
    const c = conv(); conversations.push(c);
    await (service as any).escalateAutopilot(ORG, c, "complaint");
    expect(c.autoReplyPaused).toBe(true);
    expect(c.priority).toBe("high");
    expect(c.handoverReason).toBe("complaint");
    expect(c.handoverAt).toBeInstanceOf(Date);
    expect(Math.abs(Date.now() - new Date(c.handoverAt).getTime())).toBeLessThan(5000);
    const entry = audit.calls.find((a) => a.action === "inbox.autopilot.escalated");
    expect(entry).toBeTruthy();
    expect(entry.metadata).toEqual({ reason: "complaint" });
    expect(entry.entityId).toBe(c.id);
  });
});

describe("CX4 (b) timed assignment via updateConversation", () => {
  it("timed assign sets assignedAt / assignedUntil (≈ +minutes) / assignmentKind timed", async () => {
    const { service, conversations } = setup();
    const c = conv(); conversations.push(c);
    const before = Date.now();
    const updated: any = await service.updateConversation(ORG, "owner", c.id, { assignedUserId: "agent-1", assignForMinutes: 30 });
    expect(updated.assignedUserId).toBe("agent-1");
    expect(updated.assignmentKind).toBe("timed");
    expect(updated.assignedAt).toBeInstanceOf(Date);
    expect(new Date(updated.assignedAt).getTime()).toBeGreaterThanOrEqual(before);
    const until = new Date(updated.assignedUntil).getTime();
    expect(until - before).toBeGreaterThanOrEqual(29 * 60000);
    expect(until - before).toBeLessThanOrEqual(31 * 60000);
  });

  it("manual assign (no minutes) clears the timer and marks the assignment normal", async () => {
    const { service, conversations } = setup();
    const c = conv({ assignedUserId: "agent-1", assignedAt: minsAgo(10), assignedUntil: minsFromNow(20), assignmentKind: "timed" });
    conversations.push(c);
    const updated: any = await service.updateConversation(ORG, "owner", c.id, { assignedUserId: "agent-2" });
    expect(updated.assignedUserId).toBe("agent-2");
    expect(updated.assignmentKind).toBe("normal");
    expect(updated.assignedUntil ?? null).toBeNull();
    expect(updated.assignedAt).toBeInstanceOf(Date);
  });

  it("unassign clears assignee + all three timer fields", async () => {
    const { service, conversations } = setup();
    const c = conv({ assignedUserId: "agent-1", assignedAt: minsAgo(10), assignedUntil: minsFromNow(20), assignmentKind: "timed" });
    conversations.push(c);
    const updated: any = await service.updateConversation(ORG, "owner", c.id, { assignedUserId: null });
    expect(updated.assignedUserId ?? null).toBeNull();
    expect(updated.assignedAt ?? null).toBeNull();
    expect(updated.assignedUntil ?? null).toBeNull();
    expect(updated.assignmentKind ?? null).toBeNull();
  });

  it("assignForMinutes outside 5..480 -> BadRequest (4 and 481)", async () => {
    const { service, conversations } = setup();
    const c = conv(); conversations.push(c);
    await expect(service.updateConversation(ORG, "owner", c.id, { assignedUserId: "agent-1", assignForMinutes: 4 })).rejects.toThrow(/৫ থেকে ৪৮০/);
    await expect(service.updateConversation(ORG, "owner", c.id, { assignedUserId: "agent-1", assignForMinutes: 481 })).rejects.toThrow(/৫ থেকে ৪৮০/);
    await expect(service.updateConversation(ORG, "owner", c.id, { assignedUserId: "agent-1", assignForMinutes: 30.5 })).rejects.toThrow(/৫ থেকে ৪৮০/);
    expect(c.assignedUserId ?? null).toBeNull(); // nothing was written
  });

  it("an update without assignedUserId leaves all assignment fields untouched", async () => {
    const { service, conversations } = setup();
    const assignedAt = minsAgo(10); const assignedUntil = minsFromNow(20);
    const c = conv({ assignedUserId: "agent-1", assignedAt, assignedUntil, assignmentKind: "timed" });
    conversations.push(c);
    const updated: any = await service.updateConversation(ORG, "owner", c.id, { status: "pending" });
    expect(updated.assignedUserId).toBe("agent-1");
    expect(updated.assignedAt).toBe(assignedAt);
    expect(updated.assignedUntil).toBe(assignedUntil);
    expect(updated.assignmentKind).toBe("timed");
  });
});

describe("CX4 (c) runHandoverSweeps", () => {
  it("expired + assignee never replied -> returned to AI (fields cleared, note + audit, counter)", async () => {
    const { service, conversations, messages, notes, audit } = setup();
    const c = conv({
      assignedUserId: "agent-1", assignedAt: minsAgo(120), assignedUntil: minsAgo(5),
      assignmentKind: "timed", autoReplyPaused: true, handoverReason: "complaint", handoverAt: minsAgo(120),
    });
    conversations.push(c);
    // A reply from SOMEONE ELSE and an OLD reply from the assignee
    // (before assignedAt) must not count as the assignee replying.
    messages.push(
      { id: "x1", conversationId: c.id, direction: "out", sentByUserId: "agent-2", createdAt: minsAgo(30) },
      { id: "x2", conversationId: c.id, direction: "out", sentByUserId: "agent-1", createdAt: minsAgo(180) },
      { id: "x3", conversationId: c.id, direction: "in", sentByUserId: null, createdAt: minsAgo(10) },
    );
    const res = await service.runHandoverSweeps(ORG);
    expect(res).toEqual({ returned: 1, lapsed: 0, woken: 0 }); // CX5: return shape extended with woken (snooze wake shares this sweep)
    expect(c.assignedUserId ?? null).toBeNull();
    expect(c.assignedAt ?? null).toBeNull();
    expect(c.assignedUntil ?? null).toBeNull();
    expect(c.assignmentKind ?? null).toBeNull();
    expect(c.autoReplyPaused).toBe(false);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      organizationId: ORG, conversationId: c.id, authorUserId: "system",
      content: "⏱️ নির্ধারিত সময় শেষ — কথোপকথনটি AI-এর কাছে ফেরত দেওয়া হয়েছে",
    });
    const entry = audit.calls.find((a) => a.action === "inbox.handover.timer_returned");
    expect(entry).toBeTruthy();
    expect(entry.entityId).toBe(c.id);
    expect(entry.metadata).toEqual({ previousAssignee: "agent-1" });
  });

  it("expired + assignee replied after assignedAt -> lapses to normal, still assigned, autopilot untouched", async () => {
    const { service, conversations, messages, notes, audit } = setup();
    const c = conv({
      assignedUserId: "agent-1", assignedAt: minsAgo(120), assignedUntil: minsAgo(5),
      assignmentKind: "timed", autoReplyPaused: true,
    });
    conversations.push(c);
    messages.push({ id: "r1", conversationId: c.id, direction: "out", sentByUserId: "agent-1", createdAt: minsAgo(60) });
    const res = await service.runHandoverSweeps(ORG);
    expect(res).toEqual({ returned: 0, lapsed: 1, woken: 0 }); // CX5: woken added
    expect(c.assignedUserId).toBe("agent-1");
    expect(c.assignmentKind).toBe("normal");
    expect(c.assignedUntil ?? null).toBeNull();
    expect(c.autoReplyPaused).toBe(true); // untouched by a lapse
    expect(notes).toHaveLength(0);
    expect(audit.calls.some((a) => a.action === "inbox.handover.timer_returned")).toBe(false);
  });

  it("not-yet-expired and closed conversations are untouched", async () => {
    const { service, conversations } = setup();
    const future = conv({ assignedUserId: "agent-1", assignedAt: minsAgo(10), assignedUntil: minsFromNow(20), assignmentKind: "timed", autoReplyPaused: true });
    const closed = conv({ assignedUserId: "agent-1", assignedAt: minsAgo(120), assignedUntil: minsAgo(5), assignmentKind: "timed", autoReplyPaused: true, status: "closed" });
    conversations.push(future, closed);
    const res = await service.runHandoverSweeps(ORG);
    expect(res).toEqual({ returned: 0, lapsed: 0, woken: 0 }); // CX5: woken added
    expect(future.assignmentKind).toBe("timed");
    expect(future.assignedUserId).toBe("agent-1");
    expect(closed.assignmentKind).toBe("timed");
    expect(closed.assignedUserId).toBe("agent-1");
    expect(closed.autoReplyPaused).toBe(true);
  });

  it("(e) tenant isolation: another org's expired timed assignment is untouched", async () => {
    const { service, conversations } = setup();
    const mine = conv({ assignedUserId: "agent-1", assignedAt: minsAgo(120), assignedUntil: minsAgo(5), assignmentKind: "timed", autoReplyPaused: true });
    const other = conv({ organizationId: ORG_B, assignedUserId: "agent-9", assignedAt: minsAgo(120), assignedUntil: minsAgo(5), assignmentKind: "timed", autoReplyPaused: true });
    conversations.push(mine, other);
    const res = await service.runHandoverSweeps(ORG);
    expect(res).toEqual({ returned: 1, lapsed: 0, woken: 0 }); // CX5: return shape extended with woken (snooze wake shares this sweep)
    expect(other.assignedUserId).toBe("agent-9");
    expect(other.assignmentKind).toBe("timed");
    expect(other.autoReplyPaused).toBe(true);
  });
});

describe("CX4 (d) handover queue: list filter, waiting sort, counts", () => {
  function queueSetup() {
    const s = setup();
    const legacy = conv({ id: "h-legacy", autoReplyPaused: true, status: "open", handoverAt: null, updatedAt: minsAgo(300), lastMessageAt: minsAgo(1) });
    const old = conv({ id: "h-old", autoReplyPaused: true, status: "open", handoverAt: minsAgo(120), updatedAt: minsAgo(120), lastMessageAt: minsAgo(2) });
    const recent = conv({ id: "h-recent", autoReplyPaused: true, status: "pending", handoverAt: minsAgo(30), updatedAt: minsAgo(30), lastMessageAt: minsAgo(3) });
    const closedPaused = conv({ id: "h-closed", autoReplyPaused: true, status: "closed", handoverAt: minsAgo(400), updatedAt: minsAgo(400) });
    const notPaused = conv({ id: "h-notpaused", autoReplyPaused: false, status: "open", handoverAt: minsAgo(400), updatedAt: minsAgo(400) });
    const foreign = conv({ id: "h-foreign", organizationId: ORG_B, autoReplyPaused: true, status: "open", handoverAt: minsAgo(400), updatedAt: minsAgo(400) });
    s.conversations.push(legacy, old, recent, closedPaused, notPaused, foreign);
    return s;
  }

  it("folder=handover returns only paused + open/pending rows, longest wait first (handoverAt ?? updatedAt)", async () => {
    const { service } = queueSetup();
    const rows = await service.listConversations(ORG, { folder: "handover" }, "owner");
    expect(rows.map((r: any) => r.id)).toEqual(["h-legacy", "h-old", "h-recent"]);
  });

  it("folder counts include handover, scoped to the org", async () => {
    const { service } = queueSetup();
    const counts: any = await service.conversationFolderCounts(ORG, "owner");
    expect(counts.handover).toBe(3);
    expect(counts.all).toBe(5);
  });
});

describe("CX4 job registration: handover_timer_sweep", () => {
  it("JOB_TYPES + template (org, 1 minute) exist and executeJob dispatches to runHandoverSweeps", async () => {
    expect(JOB_TYPES as readonly string[]).toContain("handover_timer_sweep");
    const tpl = JOB_TEMPLATES.find((t) => t.type === "handover_timer_sweep");
    expect(tpl).toBeTruthy();
    expect(tpl!.key).toBe("handover_timer_sweep");
    expect(tpl!.targetKind).toBe("org");
    expect(tpl!.intervalMinutes).toBe(1);
    expect(tpl!.descriptionBn.length).toBeGreaterThan(10);

    const inbox = { runHandoverSweeps: jest.fn(async () => ({ returned: 2, lapsed: 1 })) };
    const db: any = { scheduledJob: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) }, organization: { findMany: jest.fn(async () => []) } };
    // Positional construction mirrors cx3-jobs.spec.ts.
    const svc = new AutomationService(
      db as any, { log: jest.fn(async () => undefined) } as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      undefined, undefined, inbox as any, undefined, undefined, undefined, undefined, undefined, undefined,
      { runDueCommentReplies: jest.fn(async () => ({ fired: 0, batched: 0, skipped: 0 })) } as any,
    );
    const out: any = await svc.executeJob({ organizationId: ORG, createdById: "owner", type: "handover_timer_sweep", targetId: ORG });
    expect(inbox.runHandoverSweeps).toHaveBeenCalledWith(ORG);
    expect(out).toEqual({ returned: 2, lapsed: 1 });
  });
});
