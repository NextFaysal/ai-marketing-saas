import "reflect-metadata";
import { InboxService } from "./inbox.service";

/**
 * CX11ac — Attribution completion + Reply Quality analytics.
 *
 * - sendReply records the composer-reported attribution
 *   (sentWithAiAssist / quickReplyId) on the message row and
 *   increments QuickReply.timesUsed ONLY on a confirmed send.
 * - sendDraft always sends as AI-assisted and records whether
 *   the agent edited the draft text (sentEdited).
 * - getTeamReport gains an additive replyQuality block: draft
 *   acceptance / edited share, a CSAT split by who answered
 *   (auto-reply only / human only / mixed / unclassified) and
 *   per-agent assist counts. Every rate is null — never 0 or
 *   invented — when its denominator is 0.
 *
 * Attribution trust scope: the flags attest the UI path the
 * text came through (ghost accept / tone rewrite / draft /
 * quick-reply picker) as reported by our own composer — they
 * are not cryptographic proof of authorship.
 *
 * Fake prisma only — no live DB, no live send anywhere.
 */
type Row = Record<string, any>;

const stores: Record<string, Row[]> = {};
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
    if (k === "conversation") {
      // Nested relation filter (perAgentAssist query): resolve
      // the message's conversation row and match against it.
      const conv = (stores.channelConversation ?? []).find((c) => c.id === row.conversationId);
      return Boolean(conv) && match(conv as Row, v);
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
function applyData(row: Row, data: any) {
  for (const [k, v] of Object.entries(data ?? {})) {
    if (v !== null && typeof v === "object" && "increment" in (v as any)) row[k] = (row[k] ?? 0) + (v as any).increment;
    else row[k] = v;
  }
}
function table(name: string) {
  const store = stores[name];
  return {
    findMany: jest.fn(async ({ where, take }: any = {}) => {
      const rows = store.filter((r) => match(r, where));
      return take ? rows.slice(0, take) : rows;
    }),
    findFirst: jest.fn(async ({ where }: any = {}) => store.find((r) => match(r, where)) ?? null),
    findUnique: jest.fn(async ({ where }: any = {}) => store.find((r) => match(r, where)) ?? null),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `${name}-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      store.push(row); return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = store.find((r) => r.id === where.id || match(r, where));
      if (!row) throw new Error("nf");
      applyData(row, data); return row;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let n = 0; for (const r of store) if (match(r, where)) { applyData(r, data); n++; } return { count: n };
    }),
    count: jest.fn(async ({ where }: any = {}) => store.filter((r) => match(r, where)).length),
  };
}

const ORG = "org-1";
const ORG_B = "org-2";
const now = () => new Date();
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600 * 1000);

function setup() {
  for (const k of Object.keys(stores)) delete stores[k];
  const names = [
    "inboxSetting", "channelConversation", "channelMessage", "conversationNote",
    "messageDraft", "quickReply", "product", "order", "businessPolicy",
    "businessProfile", "knowledgeDocument", "aIUsageRecord", "organization",
    "membership", "agentNotification", "botSession", "inboxTeam", "inboxTeamMember",
    "integration",
  ];
  for (const n of names) stores[n] = [];
  stores.inboxSetting.push({ id: "s1", organizationId: ORG, autoReplyMode: "auto", confidenceThreshold: 70, perIntent: {}, smartAssign: "off", slaFirstResponseMinutes: 60, perChannelModes: {}, escalationThresholdMinor: null });
  stores.organization.push({ id: ORG, name: "টেস্ট শপ", timezone: "Asia/Dhaka" });
  stores.membership.push(
    { id: "m1", organizationId: ORG, userId: "agent-1", role: "SUPPORT_AGENT", user: { name: "এজেন্ট এক", email: "a1@test" } },
    { id: "m2", organizationId: ORG, userId: "agent-2", role: "SUPPORT_AGENT", user: { name: "এজেন্ট দুই", email: "a2@test" } },
  );
  const db: Record<string, any> = {};
  for (const n of names) db[n] = table(n);
  const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
  const llm = { getProvider: () => { throw new Error("no provider configured"); } };
  const service = new InboxService(db as any, audit as any, llm as any);
  return { service, db, audit };
}
function conv(over: Row = {}): Row {
  return {
    id: `c-${Math.random().toString(36).slice(2, 8)}`, organizationId: ORG, channel: "webchat", status: "open",
    assignedUserId: null, priority: "normal", autoReplyPaused: false, customerId: null,
    contactName: "রহিম", unreadCount: 0, tags: [], pipelineStage: "new",
    csatRating: null, csatRatedAt: null, resolvedAt: null,
    createdAt: now(), updatedAt: now(), lastMessageAt: now(), firstResponseAt: now(), ...over,
  };
}
function msg(over: Row = {}): Row {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`, conversationId: "c-x", direction: "out", type: "text",
    status: "sent", autoReply: false, sentByUserId: null, sentByAiDraft: false,
    sentWithAiAssist: false, quickReplyId: null, createdAt: now(), ...over,
  };
}

describe("CX11ac (a) sendReply attribution", () => {
  it("plain send -> sentWithAiAssist false, quickReplyId null, no increment", async () => {
    const { service } = setup();
    const c = conv(); stores.channelConversation.push(c);
    const qr = { id: "qr-1", organizationId: ORG, title: "স্বাগতম", content: "হ্যালো", timesUsed: 3, createdAt: now() };
    stores.quickReply.push(qr);
    const sent: any = await service.sendReply(ORG, "agent-1", c.id, "হ্যালো");
    expect(sent.status).toBe("sent");
    expect(sent.sentWithAiAssist).toBe(false);
    expect(sent.quickReplyId ?? null).toBeNull();
    expect(sent.sentByAiDraft).toBe(false);
    expect(qr.timesUsed).toBe(3);
  });

  it("aiAssisted -> true; quickReplyId set on the message + timesUsed incremented on success", async () => {
    const { service } = setup();
    const c = conv(); stores.channelConversation.push(c);
    const qr = { id: "qr-1", organizationId: ORG, title: "স্বাগতম", content: "হ্যালো", timesUsed: 3, createdAt: now() };
    stores.quickReply.push(qr);
    const sent: any = await service.sendReply(ORG, "agent-1", c.id, "হ্যালো", { aiAssisted: true, quickReplyId: "qr-1" });
    expect(sent.sentWithAiAssist).toBe(true);
    expect(sent.quickReplyId).toBe("qr-1");
    expect(qr.timesUsed).toBe(4);
  });

  it("delivery failure -> NO increment and the row is failed", async () => {
    const { service } = setup();
    // WhatsApp with no integration: delivery cannot succeed.
    const c = conv({ channel: "whatsapp" }); stores.channelConversation.push(c);
    const qr = { id: "qr-1", organizationId: ORG, title: "স্বাগতম", content: "হ্যালো", timesUsed: 3, createdAt: now() };
    stores.quickReply.push(qr);
    await expect(service.sendReply(ORG, "agent-1", c.id, "হ্যালো", { quickReplyId: "qr-1" })).rejects.toThrow(/NOT sent/);
    expect(qr.timesUsed).toBe(3);
    const row = stores.channelMessage.find((m) => m.conversationId === c.id);
    expect(row?.status).toBe("failed");
    expect(row?.quickReplyId).toBe("qr-1");
  });
});

describe("CX11ac (b) sendDraft edited tracking", () => {
  function draftSetup() {
    const s = setup();
    const c = conv(); stores.channelConversation.push(c);
    const draft = {
      id: "d-1", organizationId: ORG, conversationId: c.id, content: "আসল ড্রাফট লেখা",
      status: "suggested", sentEdited: false, createdAt: now(),
    };
    stores.messageDraft.push(draft);
    return { ...s, c, draft };
  }

  it("unedited send -> sentEdited false; message is AI draft AND AI-assisted", async () => {
    const { service, c, draft } = draftSetup();
    const sent: any = await service.sendDraft(ORG, "agent-1", c.id, draft.id);
    expect(sent.status).toBe("sent");
    expect(sent.sentByAiDraft).toBe(true);
    expect(sent.sentWithAiAssist).toBe(true);
    expect(draft.status).toBe("sent");
    expect(draft.sentEdited).toBe(false);
  });

  it("edited send -> sentEdited true", async () => {
    const { service, c, draft } = draftSetup();
    const sent: any = await service.sendDraft(ORG, "agent-1", c.id, draft.id, "বদলে দেওয়া লেখা");
    expect(sent.sentByAiDraft).toBe(true);
    expect(sent.sentWithAiAssist).toBe(true);
    expect(draft.status).toBe("sent");
    expect(draft.sentEdited).toBe(true);
  });

  it("whitespace-only difference is NOT an edit (both sides trimmed)", async () => {
    const { service, c, draft } = draftSetup();
    await service.sendDraft(ORG, "agent-1", c.id, draft.id, "  আসল ড্রাফট লেখা  ");
    expect(draft.sentEdited).toBe(false);
  });
});

describe("CX11ac (c) replyQuality math", () => {
  it("draft counts + rates, edited share, CSAT buckets, per-agent grouping", async () => {
    const { service } = setup();
    // Drafts: 4 in window (2 sent — 1 edited, 1 dismissed, 1 still
    // suggested) + 1 old sent draft outside the window.
    stores.messageDraft.push(
      { id: "dr1", organizationId: ORG, status: "sent", sentEdited: true, createdAt: hoursAgo(2) },
      { id: "dr2", organizationId: ORG, status: "sent", sentEdited: false, createdAt: hoursAgo(2) },
      { id: "dr3", organizationId: ORG, status: "dismissed", sentEdited: false, createdAt: hoursAgo(2) },
      { id: "dr4", organizationId: ORG, status: "suggested", sentEdited: false, createdAt: hoursAgo(2) },
      { id: "dr5", organizationId: ORG, status: "sent", sentEdited: true, createdAt: hoursAgo(24 * 30) },
    );
    // CSAT conversations (rated within the window):
    const aiOnly = conv({ id: "cs-ai", csatRating: 5, csatRatedAt: hoursAgo(1), status: "closed", resolvedAt: hoursAgo(1) });
    const humanOnly = conv({ id: "cs-human", csatRating: 4, csatRatedAt: hoursAgo(1), status: "closed", resolvedAt: hoursAgo(1) });
    const mixed = conv({ id: "cs-mixed", csatRating: 3, csatRatedAt: hoursAgo(1), status: "closed", resolvedAt: hoursAgo(1) });
    const unclass = conv({ id: "cs-none", csatRating: 2, csatRatedAt: hoursAgo(1), status: "closed", resolvedAt: hoursAgo(1) });
    const oldRated = conv({ id: "cs-old", csatRating: 1, csatRatedAt: hoursAgo(24 * 30), status: "closed", resolvedAt: hoursAgo(24 * 30) });
    stores.channelConversation.push(aiOnly, humanOnly, mixed, unclass, oldRated);
    stores.channelMessage.push(
      msg({ conversationId: "cs-ai", autoReply: true, sentByUserId: null, createdAt: hoursAgo(3) }),
      msg({ conversationId: "cs-human", autoReply: false, sentByUserId: "agent-1", createdAt: hoursAgo(3) }),
      msg({ conversationId: "cs-mixed", autoReply: true, sentByUserId: null, createdAt: hoursAgo(3) }),
      msg({ conversationId: "cs-mixed", autoReply: false, sentByUserId: "agent-2", createdAt: hoursAgo(3) }),
      msg({ conversationId: "cs-old", autoReply: true, sentByUserId: null, createdAt: hoursAgo(24 * 30) }),
      // Per-agent assist rows (in window): agent-1 sent 3 (1 draft,
      // 1 assist-not-draft, 1 quick reply), agent-2 sent 1 plain.
      msg({ conversationId: "cs-human", sentByUserId: "agent-1", sentByAiDraft: true, sentWithAiAssist: true, createdAt: hoursAgo(2) }),
      msg({ conversationId: "cs-human", sentByUserId: "agent-1", sentByAiDraft: false, sentWithAiAssist: true, createdAt: hoursAgo(2) }),
      msg({ conversationId: "cs-human", sentByUserId: "agent-1", sentByAiDraft: false, sentWithAiAssist: false, quickReplyId: "qr-1", createdAt: hoursAgo(2) }),
      // An inbound row and an old row must not count.
      msg({ conversationId: "cs-human", direction: "in", sentByUserId: null, createdAt: hoursAgo(2) }),
      msg({ conversationId: "cs-human", sentByUserId: "agent-2", createdAt: hoursAgo(24 * 30) }),
    );
    const report: any = await service.getTeamReport(ORG, 7);
    const rq = report.replyQuality;
    expect(rq).toBeTruthy();
    expect(rq.drafts).toEqual({
      suggested: 4, sent: 2, dismissed: 1, sentEditedCount: 1,
      acceptanceRatePct: 66.7, editedSharePct: 50,
    });
    expect(rq.csat.aiOnly).toEqual({ count: 1, avgRating: 5 });
    expect(rq.csat.humanOnly).toEqual({ count: 1, avgRating: 4 });
    expect(rq.csat.mixed).toEqual({ count: 1, avgRating: 3 });
    // Unclassified: counted, excluded from the averages.
    expect(rq.csat.unclassified).toEqual({ count: 1, avgRating: null });
    const a1 = rq.perAgentAssist.find((r: any) => r.userId === "agent-1");
    const a2 = rq.perAgentAssist.find((r: any) => r.userId === "agent-2");
    // agent-1: the cs-human human row above + the 3 assist rows.
    expect(a1).toEqual({ userId: "agent-1", sent: 4, aiDraftCount: 1, aiAssistedCount: 1, quickReplyCount: 1 });
    // agent-2: only the cs-mixed human row is in-window.
    expect(a2).toEqual({ userId: "agent-2", sent: 1, aiDraftCount: 0, aiAssistedCount: 0, quickReplyCount: 0 });
    expect(rq.perAgentAssist[0].userId).toBe("agent-1"); // sorted by sent desc
  });
});

describe("CX11ac (d) zero denominators -> nulls", () => {
  it("no drafts and no rated conversations -> all rates/averages null, counts 0", async () => {
    const { service } = setup();
    const report: any = await service.getTeamReport(ORG, 7);
    const rq = report.replyQuality;
    expect(rq.drafts).toEqual({
      suggested: 0, sent: 0, dismissed: 0, sentEditedCount: 0,
      acceptanceRatePct: null, editedSharePct: null,
    });
    expect(rq.csat.aiOnly).toEqual({ count: 0, avgRating: null });
    expect(rq.csat.humanOnly).toEqual({ count: 0, avgRating: null });
    expect(rq.csat.mixed).toEqual({ count: 0, avgRating: null });
    expect(rq.csat.unclassified).toEqual({ count: 0, avgRating: null });
    expect(rq.perAgentAssist).toEqual([]);
  });

  it("drafts suggested but none decided -> acceptance null, edited share null", async () => {
    const { service } = setup();
    stores.messageDraft.push({ id: "dr1", organizationId: ORG, status: "suggested", sentEdited: false, createdAt: hoursAgo(1) });
    const report: any = await service.getTeamReport(ORG, 7);
    expect(report.replyQuality.drafts.suggested).toBe(1);
    expect(report.replyQuality.drafts.acceptanceRatePct).toBeNull();
    expect(report.replyQuality.drafts.editedSharePct).toBeNull();
  });
});

describe("CX11ac (e) tenant isolation", () => {
  it("another org's drafts, messages and rated conversations are excluded", async () => {
    const { service } = setup();
    stores.messageDraft.push(
      { id: "mine", organizationId: ORG, status: "sent", sentEdited: false, createdAt: hoursAgo(1) },
      { id: "theirs", organizationId: ORG_B, status: "sent", sentEdited: true, createdAt: hoursAgo(1) },
      { id: "theirs2", organizationId: ORG_B, status: "dismissed", sentEdited: false, createdAt: hoursAgo(1) },
    );
    const foreign = conv({ id: "cs-foreign", organizationId: ORG_B, csatRating: 5, csatRatedAt: hoursAgo(1), status: "closed", resolvedAt: hoursAgo(1) });
    stores.channelConversation.push(foreign);
    // A foreign-org conversation's messages must not leak into
    // perAgentAssist (nested conversation.organizationId filter).
    stores.channelMessage.push(
      msg({ conversationId: "cs-foreign", sentByUserId: "agent-9", sentWithAiAssist: true, quickReplyId: "qr-9", createdAt: hoursAgo(1) }),
    );
    const report: any = await service.getTeamReport(ORG, 7);
    const rq = report.replyQuality;
    expect(rq.drafts.suggested).toBe(1);
    expect(rq.drafts.sent).toBe(1);
    expect(rq.drafts.dismissed).toBe(0);
    expect(rq.csat.aiOnly.count + rq.csat.humanOnly.count + rq.csat.mixed.count + rq.csat.unclassified.count).toBe(0);
    expect(rq.perAgentAssist).toEqual([]);
  });
});
