import "reflect-metadata";
import { InboxService } from "./inbox.service";

/**
 * CX5 — Snooze + one-row action bar actions.
 *
 * - snoozeConversation / unsnoozeConversation: exactly one of
 *   minutes (5..10080) / until (future ISO, > now + 60s); sets or
 *   clears snoozedUntil (the field rode CX4's migration — no new
 *   migration), audits, realtime-patches. Snoozing never touches
 *   autoReplyPaused or the assignment.
 * - Visibility: an actively-snoozed conversation is hidden from
 *   every list view and folder count EXCEPT the snoozed folder
 *   (sorted by wake time ascending).
 * - Wake: runHandoverSweeps (CX4's sweep, extended return shape
 *   { returned, lapsed, woken }) clears an expired snooze; closed
 *   conversations are never woken; resolving clears the snooze.
 * - takeOverConversation: ONE update (assign to actor, timer
 *   dropped, autopilot paused, handoverReason manual_takeover).
 * - backToAiConversation: autopilot resumes, timer cleared,
 *   assignee + handover history kept.
 *
 * Fake prisma only — no live DB, no live send anywhere. The fake
 * matcher supports COMBINED operators (e.g. { lte, not }) which
 * the CX5 wake query uses.
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
      if ("in" in v && !(v.in as any[]).includes(row[k])) return false;
      if ("notIn" in v && (v.notIn as any[]).includes(row[k])) return false;
      if ("not" in v) {
        if (v.not === null) { if (row[k] === null || row[k] === undefined) return false; }
        else if (eqVal(row[k], v.not)) return false;
      }
      if ("has" in v && !(Array.isArray(row[k]) && row[k].includes(v.has))) return false;
      if ("contains" in v && !(typeof row[k] === "string" && row[k].toLowerCase().includes(String(v.contains).toLowerCase()))) return false;
      if ("gte" in v && !(new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
      if ("gt" in v && !(new Date(row[k]).getTime() > new Date(v.gt).getTime())) return false;
      if ("lte" in v && !(new Date(row[k]).getTime() <= new Date(v.lte).getTime())) return false;
      if ("lt" in v && !(new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false;
      if ("equals" in v && !eqVal(row[k], v.equals)) return false;
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
    snoozedUntil: null,
    customerId: null, contactName: "রহিম", unreadCount: 0, tags: [],
    createdAt: new Date(), updatedAt: new Date(), lastMessageAt: new Date(), firstResponseAt: new Date(),
    autoReplyDueAt: null, autoReplyBatchSince: null, ...over,
  };
}
const minsAgo = (n: number) => new Date(Date.now() - n * 60000);
const minsFromNow = (n: number) => new Date(Date.now() + n * 60000);

describe("CX5 (a) snoozeConversation validation + effects", () => {
  it("minutes path sets snoozedUntil ≈ +minutes, audits the ISO time, and touches nothing else", async () => {
    const { service, conversations, audit } = setup();
    const c = conv({ assignedUserId: "agent-1", autoReplyPaused: false });
    conversations.push(c);
    const before = Date.now();
    const updated: any = await service.snoozeConversation(ORG, "owner", c.id, { minutes: 60 });
    const until = new Date(updated.snoozedUntil).getTime();
    expect(until - before).toBeGreaterThanOrEqual(59 * 60000);
    expect(until - before).toBeLessThanOrEqual(61 * 60000);
    // Snooze is visibility only: autopilot + assignment untouched.
    expect(updated.autoReplyPaused).toBe(false);
    expect(updated.assignedUserId).toBe("agent-1");
    const entry = audit.calls.find((a) => a.action === "inbox.conversation.snoozed");
    expect(entry).toBeTruthy();
    expect(entry.entityId).toBe(c.id);
    expect(entry.metadata).toEqual({ snoozedUntil: new Date(until).toISOString() });
  });

  it("until path sets exactly the parsed future time", async () => {
    const { service, conversations } = setup();
    const c = conv(); conversations.push(c);
    const target = minsFromNow(240);
    const updated: any = await service.snoozeConversation(ORG, "owner", c.id, { until: target.toISOString() });
    expect(new Date(updated.snoozedUntil).getTime()).toBe(target.getTime());
  });

  it("both minutes+until, or neither, -> BadRequest and nothing is written", async () => {
    const { service, conversations } = setup();
    const c = conv(); conversations.push(c);
    await expect(service.snoozeConversation(ORG, "owner", c.id, { minutes: 60, until: minsFromNow(60).toISOString() })).rejects.toThrow(/ঠিক একটি/);
    await expect(service.snoozeConversation(ORG, "owner", c.id, {})).rejects.toThrow(/ঠিক একটি/);
    expect(c.snoozedUntil ?? null).toBeNull();
  });

  it("minutes outside 5..10080 or non-integer -> BadRequest", async () => {
    const { service, conversations } = setup();
    const c = conv(); conversations.push(c);
    await expect(service.snoozeConversation(ORG, "owner", c.id, { minutes: 4 })).rejects.toThrow(/৫ থেকে ১০০৮০/);
    await expect(service.snoozeConversation(ORG, "owner", c.id, { minutes: 10081 })).rejects.toThrow(/৫ থেকে ১০০৮০/);
    await expect(service.snoozeConversation(ORG, "owner", c.id, { minutes: 30.5 })).rejects.toThrow(/৫ থেকে ১০০৮০/);
    expect(c.snoozedUntil ?? null).toBeNull();
  });

  it("past until, until within 60s, and unparseable until -> BadRequest", async () => {
    const { service, conversations } = setup();
    const c = conv(); conversations.push(c);
    await expect(service.snoozeConversation(ORG, "owner", c.id, { until: minsAgo(5).toISOString() })).rejects.toThrow(/ভবিষ্যতে/);
    await expect(service.snoozeConversation(ORG, "owner", c.id, { until: new Date(Date.now() + 30000).toISOString() })).rejects.toThrow(/ভবিষ্যতে/);
    await expect(service.snoozeConversation(ORG, "owner", c.id, { until: "not-a-date" })).rejects.toThrow(/ভবিষ্যতে/);
    expect(c.snoozedUntil ?? null).toBeNull();
  });

  it("tenant isolation: snoozing another org's conversation is a plain not-found", async () => {
    const { service, conversations } = setup();
    const foreign = conv({ organizationId: ORG_B });
    conversations.push(foreign);
    await expect(service.snoozeConversation(ORG, "owner", foreign.id, { minutes: 60 })).rejects.toMatchObject({ code: "inbox.conversationNotFoundInThisOrganization" });
    expect(foreign.snoozedUntil ?? null).toBeNull();
  });
});

describe("CX5 (b) unsnoozeConversation", () => {
  it("clears snoozedUntil and audits inbox.conversation.unsnoozed", async () => {
    const { service, conversations, audit } = setup();
    const c = conv({ snoozedUntil: minsFromNow(120) });
    conversations.push(c);
    const updated: any = await service.unsnoozeConversation(ORG, "owner", c.id);
    expect(updated.snoozedUntil ?? null).toBeNull();
    const entry = audit.calls.find((a) => a.action === "inbox.conversation.unsnoozed");
    expect(entry).toBeTruthy();
    expect(entry.entityId).toBe(c.id);
  });
});

describe("CX5 (c) snooze visibility: list + counts", () => {
  function visSetup() {
    const s = setup();
    const plain = conv({ id: "v-plain" });
    const snoozedSoon = conv({ id: "v-snoozed-soon", snoozedUntil: minsFromNow(30), updatedAt: minsAgo(10) });
    const snoozedLate = conv({ id: "v-snoozed-late", snoozedUntil: minsFromNow(300), status: "pending" });
    const snoozedClosed = conv({ id: "v-snoozed-closed", snoozedUntil: minsFromNow(60), status: "closed" });
    const expired = conv({ id: "v-expired", snoozedUntil: minsAgo(5) });
    const snoozedHandover = conv({ id: "v-snoozed-handover", snoozedUntil: minsFromNow(90), autoReplyPaused: true, handoverAt: minsAgo(20) });
    const foreign = conv({ id: "v-foreign", organizationId: ORG_B, snoozedUntil: minsFromNow(45) });
    s.conversations.push(plain, snoozedSoon, snoozedLate, snoozedClosed, expired, snoozedHandover, foreign);
    return s;
  }

  it("default list hides actively-snoozed rows but keeps expired ones", async () => {
    const { service } = visSetup();
    const rows = await service.listConversations(ORG, {}, "owner");
    expect(rows.map((r: any) => r.id).sort()).toEqual(["v-expired", "v-plain"]);
  });

  it("handover folder also hides actively-snoozed rows", async () => {
    const { service } = visSetup();
    const rows = await service.listConversations(ORG, { folder: "handover" }, "owner");
    expect(rows.map((r: any) => r.id)).toEqual([]);
  });

  it("snoozed folder shows only actively-snoozed open/pending rows, earliest wake first", async () => {
    const { service } = visSetup();
    const rows = await service.listConversations(ORG, { folder: "snoozed" }, "owner");
    expect(rows.map((r: any) => r.id)).toEqual(["v-snoozed-soon", "v-snoozed-handover", "v-snoozed-late"]);
  });

  it("counts exclude snoozed everywhere except the snoozed count", async () => {
    const { service } = visSetup();
    const counts: any = await service.conversationFolderCounts(ORG, "owner");
    expect(counts.snoozed).toBe(3); // soon + late + handover (closed excluded)
    expect(counts.all).toBe(2); // plain + expired only
    expect(counts.handover).toBe(0); // the one paused row is snoozed
  });
});

describe("CX5 (d) wake via runHandoverSweeps + resolve clears snooze", () => {
  it("expired snooze wakes (woken counted, field cleared); future snooze and closed rows are untouched", async () => {
    const { service, conversations } = setup();
    const due = conv({ id: "w-due", snoozedUntil: minsAgo(1) });
    const future = conv({ id: "w-future", snoozedUntil: minsFromNow(60) });
    const closed = conv({ id: "w-closed", snoozedUntil: minsAgo(1), status: "closed" });
    const foreign = conv({ id: "w-foreign", organizationId: ORG_B, snoozedUntil: minsAgo(1) });
    conversations.push(due, future, closed, foreign);
    const res = await service.runHandoverSweeps(ORG);
    expect(res).toEqual({ returned: 0, lapsed: 0, woken: 1 });
    expect(due.snoozedUntil ?? null).toBeNull();
    expect(new Date(future.snoozedUntil).getTime()).toBeGreaterThan(Date.now() + 59 * 60000);
    expect(closed.snoozedUntil).not.toBeNull(); // closed is never woken by the sweep
    expect(foreign.snoozedUntil).not.toBeNull(); // tenant isolation
  });

  it("updateConversation with status closed clears the snooze (resolvedAt still set)", async () => {
    const { service, conversations } = setup();
    const c = conv({ snoozedUntil: minsFromNow(120) });
    conversations.push(c);
    const updated: any = await service.updateConversation(ORG, "owner", c.id, { status: "closed" });
    expect(updated.status).toBe("closed");
    expect(updated.snoozedUntil ?? null).toBeNull();
    expect(updated.resolvedAt).toBeInstanceOf(Date);
  });
});

describe("CX5 (e) take-over / back-to-ai", () => {
  it("takeOverConversation writes ALL fields in ONE update and audits take_over", async () => {
    const { service, conversations, audit, db } = setup();
    const c = conv({
      assignedUserId: "agent-1", assignedAt: minsAgo(30), assignedUntil: minsFromNow(10), assignmentKind: "timed",
      autoReplyPaused: false, handoverReason: null, handoverAt: null,
    });
    conversations.push(c);
    (db.channelConversation.update as jest.Mock).mockClear();
    const updated: any = await service.takeOverConversation(ORG, "agent-2", c.id);
    const calls = (db.channelConversation.update as jest.Mock).mock.calls;
    expect(calls).toHaveLength(1);
    const data = calls[0][0].data;
    expect(Object.keys(data).sort()).toEqual(["assignedAt", "assignedUntil", "assignedUserId", "assignmentKind", "autoReplyPaused", "handoverAt", "handoverReason"]);
    expect(data.assignedUserId).toBe("agent-2");
    expect(data.assignedUntil ?? null).toBeNull();
    expect(data.assignmentKind).toBe("normal");
    expect(data.autoReplyPaused).toBe(true);
    expect(data.handoverReason).toBe("manual_takeover");
    expect(data.assignedAt).toBeInstanceOf(Date);
    expect(data.handoverAt).toBeInstanceOf(Date);
    expect(updated.assignedUserId).toBe("agent-2");
    expect(updated.autoReplyPaused).toBe(true);
    const entry = audit.calls.find((a) => a.action === "inbox.conversation.take_over");
    expect(entry).toBeTruthy();
    expect(entry.entityId).toBe(c.id);
    expect(entry.userId).toBe("agent-2");
  });

  it("backToAiConversation unpauses + clears the timer but KEEPS assignee and handover history", async () => {
    const { service, conversations, audit } = setup();
    const handoverAt = minsAgo(45);
    const c = conv({
      assignedUserId: "agent-1", assignedAt: minsAgo(45), assignedUntil: minsFromNow(15), assignmentKind: "timed",
      autoReplyPaused: true, handoverReason: "complaint", handoverAt,
    });
    conversations.push(c);
    const updated: any = await service.backToAiConversation(ORG, "owner", c.id);
    expect(updated.autoReplyPaused).toBe(false);
    expect(updated.assignedUntil ?? null).toBeNull();
    expect(updated.assignmentKind ?? null).toBeNull();
    expect(updated.assignedUserId).toBe("agent-1"); // assignee kept
    expect(updated.handoverReason).toBe("complaint"); // history kept
    expect(updated.handoverAt).toBe(handoverAt);
    const entry = audit.calls.find((a) => a.action === "inbox.conversation.back_to_ai");
    expect(entry).toBeTruthy();
    expect(entry.entityId).toBe(c.id);
  });

  it("tenant isolation: take-over / back-to-ai on another org's conversation are not-found", async () => {
    const { service, conversations } = setup();
    const foreign = conv({ organizationId: ORG_B });
    conversations.push(foreign);
    await expect(service.takeOverConversation(ORG, "owner", foreign.id)).rejects.toMatchObject({ code: "inbox.conversationNotFoundInThisOrganization" });
    await expect(service.backToAiConversation(ORG, "owner", foreign.id)).rejects.toMatchObject({ code: "inbox.conversationNotFoundInThisOrganization" });
    expect(foreign.autoReplyPaused).toBe(false);
    expect(foreign.assignedUserId ?? null).toBeNull();
  });
});
