import "reflect-metadata";
import { InboxService } from "./inbox.service";
import { AuditService } from "../audit/audit.service";
import { buildInboxAnalytics, tzParts } from "./in10-analytics";
import { maskSensitiveText } from "./pii-mask";

/**
 * IN10 — trust & Analytics v2.
 *
 * Coverage:
 *  - pure analytics builder: every number is computed by hand
 *    in the fixture comments and asserted exactly (heatmap,
 *    channel conversion, trend averages, intent shares);
 *  - block: the row lands in the spam queue, the ingest gate
 *    stops ALL intelligence/bot work for a blocked conversation
 *    (proven against a control conversation that IS processed);
 *  - the CX3 deferred sweep clears a blocked batch unsent;
 *  - CSAT ≤3 immediately notifies the lead; 5 does not;
 *  - view/export audit on the existing AuditService, with a
 *    30-minute per-viewer dedupe; the audit list reads it back;
 *  - PII masking is opt-in and happens before storage.
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
    if (v === undefined) return true;
    if (k === "OR") return (v as any[]).some((sub) => match(row, sub));
    if (k === "AND") return (v as any[]).every((sub) => match(row, sub));
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v.in as any[]).includes(row[k]);
      if ("notIn" in v) return !(v.notIn as any[]).includes(row[k]);
      if ("not" in v) {
        if (v.not === null) return row[k] !== null && row[k] !== undefined;
        if (typeof v.not === "object" && "contains" in v.not) return !String(row[k] ?? "").toLowerCase().includes(String(v.not.contains).toLowerCase());
        return !eqVal(row[k], v.not);
      }
      if ("has" in v) return Array.isArray(row[k]) && row[k].includes(v.has);
      if ("gte" in v && !(new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
      if ("gt" in v && !(new Date(row[k]).getTime() > new Date(v.gt).getTime())) return false;
      if ("lte" in v && !(new Date(row[k]).getTime() <= new Date(v.lte).getTime())) return false;
      if ("lt" in v && !(new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false;
      if ("contains" in v) return String(row[k] ?? "").toLowerCase().includes(String(v.contains).toLowerCase());
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
    rows: store,
    findMany: jest.fn(async ({ where, take, orderBy, skip }: any = {}) => {
      let rows = sortRows(store.filter((r) => match(r, where)), orderBy);
      if (skip) rows = rows.slice(skip);
      return take ? rows.slice(0, take) : rows;
    }),
    findFirst: jest.fn(async ({ where, orderBy }: any = {}) => sortRows(store.filter((r) => match(r, where)), orderBy)[0] ?? null),
    findUnique: jest.fn(async ({ where }: any = {}) => store.find((r) => match(r, where)) ?? null),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `row-${store.length + 1}-${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      store.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = store.find((r) => r.id === where.id || match(r, where));
      if (!row) throw new Error("nf");
      Object.assign(row, data);
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: any = {}) => {
      let n = 0;
      for (const r of store) if (match(r, where)) { Object.assign(r, data); n++; }
      return { count: n };
    }),
    deleteMany: jest.fn(async ({ where }: any = {}) => { let n = 0; for (let i = store.length - 1; i >= 0; i--) if (match(store[i], where)) { store.splice(i, 1); n++; } return { count: n }; }),
    count: jest.fn(async ({ where }: any = {}) => store.filter((r) => match(r, where)).length),
  };
}

const ORG = "org-1";
const rowOf = (rows: Row[], id: string): Row => {
  const r = rows.find((x) => x.id === id);
  if (!r) throw new Error(`missing ${id}`);
  return r;
};

// ----------------------------------------------------------------
// Pure analytics builder — hand-computed fixture.
// now = 2026-10-12T12:00:00Z (= 18:00 Asia/Dhaka, Monday 2026-10-12).
// Window (days=7): >= 2026-10-05T12:00:00Z.
//  conv A (whatsapp): created Oct12 02:00Z (Dhaka Oct12 08:00),
//    firstResponse +30m, lastMessage Oct12 05:00Z (in window).
//  conv B (messenger): created Oct11 20:00Z (Dhaka Oct12 02:00),
//    firstResponse +60m, resolvedAt Oct12 01:00Z → resolution
//    = 300 minutes, resolved day (Dhaka) = Oct12.
//  conv C (whatsapp): created Oct06 13:00Z (in window),
//    lastMessage Oct01 (BEFORE window → not "active").
//  messages (inbound): A×3 at Dhaka hours 9, 9, 10 (intents
//    price, price, complaint); B×1 at Dhaka hour 2 (other);
//    one message on a ghost conversation (excluded).
//  orders: oA on conv A (completed, in window); oB on conv B
//    (cancelled → never converted).
// Expected:
//  hourTotals: [2]=1, [9]=2, [10]=1; peakHour = 9 with 2.
//  matrix: weekday 1 (Mon) hour 9 = 2, hour 10 = 1, hour 2 = 1.
//  channels: whatsapp active 1 (only A), converted 1 → 100%;
//    messenger active 1, converted 0 → 0%. started: whatsapp 2,
//    messenger 1.
//  totals: conversationsStarted 3, active 2, converted 1 → 50%.
//  intents: price 2 (50%), complaint 1 (25%), other 1 (25%);
//    inboundMessages 4, classified 4.
//  trend Oct12: started 2 (A + B), avgFirstResponse (30+60)/2=45,
//    resolved 1, avgResolution 300, inbound 4.
// ----------------------------------------------------------------
describe("IN10c pure builder — hand-verified arithmetic", () => {
  const now = new Date("2026-10-12T12:00:00.000Z");
  const conversations = [
    { id: "A", channel: "whatsapp", createdAt: new Date("2026-10-12T02:00:00Z"), lastMessageAt: new Date("2026-10-12T05:00:00Z"), firstResponseAt: new Date("2026-10-12T02:30:00Z"), resolvedAt: null },
    { id: "B", channel: "messenger", createdAt: new Date("2026-10-11T20:00:00Z"), lastMessageAt: new Date("2026-10-12T01:00:00Z"), firstResponseAt: new Date("2026-10-11T21:00:00Z"), resolvedAt: new Date("2026-10-12T01:00:00Z") },
    { id: "C", channel: "whatsapp", createdAt: new Date("2026-10-06T13:00:00Z"), lastMessageAt: new Date("2026-10-01T00:00:00Z"), firstResponseAt: null, resolvedAt: null },
  ];
  const messages = [
    { conversationId: "A", direction: "in", createdAt: new Date("2026-10-12T03:05:00Z"), intent: "price" },      // Dhaka 09:05
    { conversationId: "A", direction: "in", createdAt: new Date("2026-10-12T03:40:00Z"), intent: "price" },      // Dhaka 09:40
    { conversationId: "A", direction: "in", createdAt: new Date("2026-10-12T04:10:00Z"), intent: "complaint" },  // Dhaka 10:10
    { conversationId: "B", direction: "in", createdAt: new Date("2026-10-11T20:05:00Z"), intent: "other" },      // Dhaka Oct12 02:05
    { conversationId: "ghost", direction: "in", createdAt: new Date("2026-10-12T03:00:00Z"), intent: "price" },  // excluded
  ];
  const orders = [
    { conversationId: "A", status: "completed", createdAt: new Date("2026-10-12T06:00:00Z") },
    { conversationId: "B", status: "cancelled", createdAt: new Date("2026-10-12T02:00:00Z") },
  ];
  const out = buildInboxAnalytics({ conversations, messages, orders, now, days: 7, timezone: "Asia/Dhaka" });

  it("heatmap buckets by the org timezone and finds the peak hour", () => {
    expect(out.heatmap.hourTotals[2]).toBe(1);
    expect(out.heatmap.hourTotals[9]).toBe(2);
    expect(out.heatmap.hourTotals[10]).toBe(1);
    expect(out.heatmap.peakHour).toEqual({ hour: 9, count: 2 });
    expect(out.heatmap.matrix[1][9]).toBe(2); // Monday
    expect(out.heatmap.matrix[1][2]).toBe(1);
    expect(out.totals.inboundMessages).toBe(4); // ghost excluded
  });

  it("channel conversion counts only non-cancelled in-window orders on active threads", () => {
    const wa = out.channels.find((c) => c.channel === "whatsapp");
    const fb = out.channels.find((c) => c.channel === "messenger");
    expect(wa).toMatchObject({ conversationsStarted: 2, activeConversations: 1, convertedConversations: 1, conversionPct: 100 });
    expect(fb).toMatchObject({ conversationsStarted: 1, activeConversations: 1, convertedConversations: 0, conversionPct: 0 });
    expect(out.totals).toMatchObject({ conversationsStarted: 3, chatOrders: 1 });
  });

  it("trend averages only the conversations that have the measurement", () => {
    const last = out.trend[out.trend.length - 1];
    expect(last.date).toBe("2026-10-12");
    expect(last).toMatchObject({ newConversations: 2, inboundMessages: 4, avgFirstResponseMinutes: 45, resolvedCount: 1, avgResolutionMinutes: 300 });
    const first = out.trend[0];
    expect(first.date).toBe("2026-10-06");
    expect(first.avgFirstResponseMinutes).toBeNull(); // no samples → null, not 0
  });

  it("intent shares are exact percentages of inbound messages", () => {
    expect(out.intents).toEqual([
      { intent: "price", count: 2, pct: 50 },
      { intent: "complaint", count: 1, pct: 25 },
      { intent: "other", count: 1, pct: 25 },
    ]);
    expect(out.totals.classifiedMessages).toBe(4);
  });

  it("tzParts converts UTC to the org's local day/hour/weekday", () => {
    const p = tzParts(new Date("2026-10-11T20:05:00Z"), "Asia/Dhaka");
    expect(p).toEqual({ dayKey: "2026-10-12", hour: 2, weekday: 1 });
  });
});

describe("IN10 pii-mask — opt-in masking of identifiers only", () => {
  it("masks phones, card-like runs and txn tokens; amounts and order ids stay readable", () => {
    const masked = maskSensitiveText("ফোন 01712345678, TrxID 9HXK2LMNOP, দাম ১,২০০ টাকা, অর্ডার #A1023");
    expect(masked).not.toContain("01712345678");
    expect(masked).not.toContain("9HXK2LMNOP");
    expect(masked).toContain("১,২০০");
    expect(masked).toContain("#A1023");
    expect(masked).toContain("***");
  });
});

// ----------------------------------------------------------------
// Service-level harness
// ----------------------------------------------------------------
function setup() {
  const conversations: Row[] = [
    { id: "conv-1", organizationId: ORG, channel: "whatsapp", externalContactId: "0171", contactName: "রহিম", contactPhone: "01711111111", customerId: null, leadId: null, status: "open", tags: [], unreadCount: 0, assignedUserId: "agent-1", teamId: "team-1", csatSentAt: null, csatRating: null, spamFlag: false, spamReason: null, blockedAt: null, blockedByUserId: null, blockReason: null, autoReplyDueAt: null, autoReplyBatchSince: null, isPractice: false, firstResponseAt: null, firstResponseMinutes: null, resolvedAt: null, lastMessageAt: new Date(), createdAt: new Date(Date.now() - 3600_000), updatedAt: new Date() },
  ];
  const messages: Row[] = [];
  const notifications: Row[] = [];
  const auditRows: Row[] = [];
  const notes: Row[] = [];
  const db: any = {
    channelConversation: table(conversations),
    channelMessage: table(messages),
    conversationNote: table(notes),
    agentNotification: table(notifications),
    auditLog: table(auditRows),
    inboxTeam: table([{ id: "team-1", organizationId: ORG, name: "সাপোর্ট", leadUserId: "lead-1", memberUserIds: ["agent-1"] }]),
    inboxSetting: table([]),
    organization: table([{ id: ORG, name: "টেস্ট শপ", timezone: "Asia/Dhaka" }]),
    membership: table([]),
    customer: table([]),
    lead: table([]),
    order: table([]),
    courierShipment: table([]),
    customerMergeRecord: table([]),
    messageDraft: table([]),
    botSession: table([]),
    orgFeatureFlag: table([]),
    businessProfile: table([]),
    businessPolicy: table([]),
    product: table([]),
    platformSetting: table([]),
  };
  const audit = new AuditService(db as any);
  const llm = { getProvider: () => ({ name: "dev-template", isRealLlm: false }) };
  const service = new InboxService(db as any, audit as any, llm as any);
  return { service, db, conversations, messages, notifications, auditRows, notes };
}

describe("IN10a block — spam queue, ingest gate, audit, unblock", () => {
  it("block marks the row and the spam queue returns it; unblock clears only the block's own spam mark", async () => {
    const s = setup();
    const blocked = await s.service.setConversationBlocked(ORG, "agent-1", "conv-1", { blocked: true, reason: "অভদ্র আচরণ" });
    expect(blocked.blockedAt).toBeTruthy();
    expect(blocked.blockReason).toBe("অভদ্র আচরণ");
    expect(blocked.spamFlag).toBe(true);
    expect(blocked.spamReason).toContain("ব্লক করা হয়েছে");
    const queue = await s.service.listConversations(ORG, { spamOnly: true });
    expect(queue.map((c: any) => c.id)).toContain("conv-1");
    const unblocked = await s.service.setConversationBlocked(ORG, "agent-1", "conv-1", { blocked: false });
    expect(unblocked.blockedAt).toBeNull();
    expect(unblocked.spamFlag).toBe(false);
    expect(s.auditRows.filter((r) => r.action === "inbox.conversation.blocked" || r.action === "inbox.conversation.unblocked")).toHaveLength(2);
  });

  it("a blocked conversation gets NO intelligence: no intent stamp, no bot, no notes (control conversation does)", async () => {
    const s = setup();
    await s.service.setConversationBlocked(ORG, "agent-1", "conv-1", { blocked: true });
    const blockedMsg: Row = { id: "m-blocked", organizationId: ORG, conversationId: "conv-1", direction: "inbound", senderType: "customer", type: "text", content: "দাম কত?", status: "received", intent: null, sentiment: null, createdAt: new Date() };
    s.messages.push(blockedMsg);
    await s.service.ingestChatMessage(ORG, "conv-1", blockedMsg as any);
    expect(blockedMsg.intent).toBeNull();
    expect(s.notes.filter((n) => n.conversationId === "conv-1")).toHaveLength(0);
    expect(s.messages.filter((m) => m.conversationId === "conv-1" && m.direction === "outbound")).toHaveLength(0);

    const control: Row = { ...rowOf(s.conversations, "conv-1"), id: "conv-2", blockedAt: null, spamFlag: false };
    s.conversations.push(control);
    const controlMsg: Row = { id: "m-control", organizationId: ORG, conversationId: "conv-2", direction: "inbound", senderType: "customer", type: "text", content: "দাম কত?", status: "received", intent: null, sentiment: null, createdAt: new Date() };
    s.messages.push(controlMsg);
    await s.service.ingestChatMessage(ORG, "conv-2", controlMsg as any);
    expect(controlMsg.intent).toBe("price"); // pipeline ran for the unblocked twin
  });

  it("the deferred auto-reply sweep clears a blocked batch without sending", async () => {
    const s = setup();
    const conv = rowOf(s.conversations, "conv-1");
    conv.blockedAt = new Date();
    conv.autoReplyDueAt = new Date(Date.now() - 60_000);
    conv.autoReplyBatchSince = new Date(Date.now() - 120_000);
    s.messages.push({ id: "m-b1", organizationId: ORG, conversationId: "conv-1", direction: "inbound", senderType: "customer", type: "text", content: "দাম কত?", status: "received", createdAt: new Date(Date.now() - 100_000) });
    const out = await s.service.runDueAutoReplies(ORG);
    expect(out.fired).toBe(0);
    expect(conv.autoReplyBatchSince).toBeNull();
  });
});

describe("IN10d CSAT — low rating notifies the lead immediately", () => {
  it("rating 2 → urgent lead notification; rating 5 → none", async () => {
    const s = setup();
    const conv = rowOf(s.conversations, "conv-1");
    conv.csatSentAt = new Date();
    const low: Row = { id: "m-low", organizationId: ORG, conversationId: "conv-1", direction: "inbound", senderType: "customer", type: "text", content: "2", status: "received", intent: null, createdAt: new Date() };
    s.messages.push(low);
    await s.service.ingestChatMessage(ORG, "conv-1", low as any);
    expect(conv.csatRating).toBe(2);
    const hits = s.notifications.filter((n) => n.userId === "lead-1");
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toContain("CSAT");
    expect(hits[0].type).toBe("urgent");

    const conv2: Row = { ...rowOf(s.conversations, "conv-1"), id: "conv-5", csatSentAt: new Date(), csatRating: null };
    s.conversations.push(conv2);
    const high: Row = { id: "m-high", organizationId: ORG, conversationId: "conv-5", direction: "inbound", senderType: "customer", type: "text", content: "5", status: "received", intent: null, createdAt: new Date() };
    s.messages.push(high);
    await s.service.ingestChatMessage(ORG, "conv-5", high as any);
    expect(conv2.csatRating).toBe(5);
    expect(s.notifications.filter((n) => (n.body ?? "").includes("conv-5"))).toHaveLength(0);
  });
});

describe("IN10b audit trail + note masking", () => {
  it("views are audited once per viewer per 30 minutes; exports always; the audit list reads them back", async () => {
    const s = setup();
    await s.service.getConversation(ORG, "conv-1", "agent-9");
    await s.service.getConversation(ORG, "conv-1", "agent-9");
    const viewed = s.auditRows.filter((r) => r.action === "inbox.conversation.viewed");
    expect(viewed).toHaveLength(1); // deduped
    await s.service.exportConversation(ORG, "conv-1", "json", "agent-9");
    expect(s.auditRows.some((r) => r.action === "inbox.conversation.exported")).toBe(true);
    const list = await s.service.listConversationAudit(ORG, "conv-1");
    expect(list.map((a: any) => a.action)).toEqual(expect.arrayContaining(["inbox.conversation.viewed", "inbox.conversation.exported"]));
  });

  it("note masking is opt-in: masked notes store no raw identifier; plain notes store verbatim", async () => {
    const s = setup();
    const masked = await s.service.addNote(ORG, "agent-1", "conv-1", "পেমেন্ট TrxID 9HXK2LMNOP ফোন 01712345678", { maskSensitive: true });
    expect(masked.content).not.toContain("9HXK2LMNOP");
    expect(masked.content).not.toContain("01712345678");
    const plain = await s.service.addNote(ORG, "agent-1", "conv-1", "পেমেন্ট TrxID 9HXK2LMNOP", {});
    expect(plain.content).toContain("9HXK2LMNOP");
  });
});

describe("IN10c analytics service — org-scoped compute over real rows", () => {
  it("counts only this org's rows and honours the window", async () => {
    const s = setup();
    const conv = rowOf(s.conversations, "conv-1");
    conv.channel = "whatsapp";
    conv.createdAt = new Date();
    conv.lastMessageAt = new Date();
    s.conversations.push({ id: "conv-foreign", organizationId: "org-2", channel: "whatsapp", createdAt: new Date(), lastMessageAt: new Date(), firstResponseMinutes: 5, resolvedAt: null });
    s.messages.push(
      { id: "a1", organizationId: ORG, conversationId: "conv-1", direction: "inbound", senderType: "customer", type: "text", content: "দাম?", intent: "price", createdAt: new Date() },
      { id: "a2", organizationId: "org-2", conversationId: "conv-foreign", direction: "inbound", senderType: "customer", type: "text", content: "x", intent: "price", createdAt: new Date() },
    );
    (s.db.order.rows as Row[]).push({ id: "o-a", organizationId: ORG, conversationId: "conv-1", status: "completed", createdAt: new Date() });
    const out = await s.service.getInboxAnalytics(ORG, 7);
    expect(out.totals.inboundMessages).toBe(1); // DB direction "inbound" must reach the builder (regression guard)
    expect(out.totals.conversationsStarted).toBe(1);
    expect(out.totals.chatOrders).toBe(1);
    const wa = out.channels.find((c: any) => c.channel === "whatsapp");
    expect(wa).toMatchObject({ activeConversations: 1, convertedConversations: 1, conversionPct: 100 });
    expect(out.timezone).toBe("Asia/Dhaka");
  });
});
