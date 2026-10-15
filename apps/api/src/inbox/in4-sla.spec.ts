import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { InboxService, buildSlaBreachWhere, effectiveSlaMinutes, parseSlaByChannel, slaStateFor } from "./inbox.service";

/**
 * IN4 — Layered SLA + active escalation chain.
 *
 * - Layering: VIP minutes → per-channel minutes → org default;
 *   with nothing layered configured the breach where-clause is
 *   EXACTLY the pre-IN4 shape, and the list filter / folder
 *   counts / sweep all derive from the same helpers.
 * - Chain (runSlaSweeps with an injected fake clock): 75% →
 *   assignee warning (once); breach + escalate-after → team-lead
 *   urgent alert (once, setting-gated); same point → optional
 *   auto-reassign (default OFF) to the least-busy eligible agent
 *   — away / suspended / off-shift agents are never chosen, the
 *   current assignee is never "reassigned" to themselves, and
 *   with no candidate the marker stays unset for a later pass.
 * - Scope: only first-response-pending (open/pending,
 *   non-practice) conversations are ever scanned.
 *
 * Fake prisma only — notifications are AgentNotification rows,
 * nothing leaves the process.
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
    updateMany: jest.fn(async ({ where, data }: any = {}) => { let n = 0; for (const r of store) if (match(r, where)) { Object.assign(r, data); n++; } return { count: n }; }),
    count: jest.fn(async ({ where }: any = {}) => store.filter((r) => match(r, where)).length),
    aggregate: jest.fn(async ({ where }: any = {}) => ({ _sum: { unreadCount: store.filter((r) => match(r, where)).reduce((s, r) => s + (r.unreadCount ?? 0), 0) } })),
    delete: jest.fn(async ({ where }: any = {}) => { const i = store.findIndex((r) => r.id === where.id); return store.splice(i, 1)[0]; }),
    upsert: jest.fn(async ({ where, create, update }: any = {}) => { const row = store.find((r) => match(r, where)); if (row) { Object.assign(row, update); return row; } const n = { id: `up-${store.length + 1}`, ...create }; store.push(n); return n; }),
  };
}

const ORG = "org-1";
const NOW = new Date("2026-10-12T12:00:00.000Z");
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60000);

function conv(patch: Partial<Row>): Row {
  return {
    organizationId: ORG, channel: "webchat", status: "open", contactName: "গ্রাহক", contactPhone: null,
    externalContactId: `ext-${patch.id}`, assignedUserId: null, teamId: null, tags: [], unreadCount: 0,
    isPractice: false, snoozedUntil: null, autoReplyPaused: false, pipelineStage: "new",
    firstResponseAt: null, lastCustomerMessageAt: minsAgo(10), lastMessageAt: minsAgo(10),
    lastMessagePreview: "হ্যালো", createdAt: minsAgo(10), updatedAt: minsAgo(10),
    slaWarnedAt: null, slaLeadAlertedAt: null, slaAutoReassignedAt: null,
    handoverAt: null, handoverReason: null, assignmentKind: null, assignedUntil: null,
    priority: "normal", sentimentFlag: null, spamFlag: false,
    ...patch,
  };
}

function setup(settingsPatch: Row = {}, convs: Row[] = []) {
  const settings: Row[] = [{
    id: "s1", organizationId: ORG, autoReplyMode: "off", confidenceThreshold: 70, perIntent: {},
    smartAssign: "off", slaFirstResponseMinutes: 60, perChannelModes: {}, escalationThresholdMinor: null,
    slaByChannel: null, slaVipMinutes: null, slaEscalateAfterMinutes: 30,
    slaLeadAlertEnabled: true, slaAutoReassignEnabled: false, ...settingsPatch,
  }];
  const notifications: Row[] = [];
  const db = {
    inboxSetting: table(settings),
    channelConversation: table(convs),
    channelMessage: table([] as Row[]),
    liveChatSession: table([] as Row[]),
    conversationNote: table([] as Row[]),
    messageDraft: table([] as Row[]),
    botSession: table([] as Row[]),
    membership: table([
      { id: "m0", organizationId: ORG, userId: "owner", role: "OWNER", status: "ACTIVE", createdAt: minsAgo(10000) },
      { id: "m1", organizationId: ORG, userId: "lead-1", role: "MARKETING_MANAGER", status: "ACTIVE", createdAt: minsAgo(9000) },
      { id: "m2", organizationId: ORG, userId: "agent-1", role: "SUPPORT_AGENT", status: "ACTIVE", createdAt: minsAgo(8000) },
      { id: "m3", organizationId: ORG, userId: "agent-2", role: "SUPPORT_AGENT", status: "ACTIVE", createdAt: minsAgo(7000) },
      { id: "m4", organizationId: ORG, userId: "agent-3", role: "SUPPORT_AGENT", status: "ACTIVE", createdAt: minsAgo(6000) },
      { id: "m5", organizationId: ORG, userId: "agent-4", role: "SUPPORT_AGENT", status: "ACTIVE", createdAt: minsAgo(5000) },
    ] as Row[]),
    inboxTeam: table([] as Row[]),
    inboxTeamMember: table([] as Row[]),
    agentState: table([] as Row[]),
    agentSchedule: table([] as Row[]),
    agentNotification: table(notifications),
    order: table([] as Row[]),
    courierShipment: table([] as Row[]),
    quickReply: table([] as Row[]),
    organization: table([{ id: ORG, name: "টেস্ট শপ", timezone: "Asia/Dhaka" }] as Row[]),
    businessProfile: table([] as Row[]),
    businessPolicy: table([] as Row[]),
    product: table([] as Row[]),
  };
  const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
  const svc = new InboxService(db as any, audit as any, { getProvider: () => ({ isRealLlm: false, name: "dev-template" }) } as any);
  return { svc, db, audit, notifications, settings, convs };
}

describe("IN4a pure layering", () => {
  it("parseSlaByChannel keeps only known channels with in-range integers", () => {
    expect(parseSlaByChannel({ whatsapp: 30, evil: 5, messenger: 0, webchat: 45.5, telegram: "20" })).toEqual({ whatsapp: 30 });
    expect(parseSlaByChannel(null)).toEqual({});
    expect(parseSlaByChannel("junk")).toEqual({});
  });
  it("effectiveSlaMinutes: VIP → channel → default", () => {
    const s = { slaFirstResponseMinutes: 60, slaByChannel: { whatsapp: 30 }, slaVipMinutes: 15 };
    expect(effectiveSlaMinutes(s, "whatsapp", false)).toBe(30);
    expect(effectiveSlaMinutes(s, "whatsapp", true)).toBe(15);
    expect(effectiveSlaMinutes(s, "messenger", false)).toBe(60);
    expect(effectiveSlaMinutes({}, "whatsapp", false)).toBe(60);
    expect(effectiveSlaMinutes({ slaFirstResponseMinutes: 90, slaVipMinutes: null }, "whatsapp", true)).toBe(90);
  });
  it("slaStateFor: warning at 75%, breach at 100%, null outside scope", () => {
    const s = { slaFirstResponseMinutes: 60 };
    const c = { channel: "webchat", status: "open", firstResponseAt: null, isPractice: false, createdAt: minsAgo(50) };
    expect(slaStateFor(s, c, false, NOW)?.state).toBe("warning");
    expect(slaStateFor(s, { ...c, createdAt: minsAgo(61) }, false, NOW)?.state).toBe("breached");
    expect(slaStateFor(s, { ...c, createdAt: minsAgo(10) }, false, NOW)).toBeNull();
    expect(slaStateFor(s, { ...c, firstResponseAt: new Date() }, false, NOW)).toBeNull();
    expect(slaStateFor(s, { ...c, status: "closed" }, false, NOW)).toBeNull();
    expect(slaStateFor(s, { ...c, isPractice: true }, false, NOW)).toBeNull();
  });
  it("buildSlaBreachWhere is byte-identical to the legacy clause when nothing is layered", () => {
    const w = buildSlaBreachWhere({ slaFirstResponseMinutes: 60 }, null, NOW);
    expect(w).toEqual({
      firstResponseAt: null, status: { in: ["open", "pending"] },
      createdAt: { lt: new Date(NOW.getTime() - 60 * 60000) },
    });
  });
  it("buildSlaBreachWhere layers channel + VIP clauses and excludes VIP from the rest", () => {
    const w = buildSlaBreachWhere({ slaFirstResponseMinutes: 60, slaByChannel: { whatsapp: 30 }, slaVipMinutes: 15 }, ["c-vip"], NOW) as any;
    expect(w.OR).toHaveLength(3);
    expect(w.OR[0]).toMatchObject({ id: { in: ["c-vip"] } });
    expect(w.OR[1]).toMatchObject({ channel: "whatsapp", id: { notIn: ["c-vip"] } });
    expect(w.OR[2]).toMatchObject({ channel: { notIn: ["whatsapp"] }, id: { notIn: ["c-vip"] } });
  });
});

describe("IN4 settings round-trip + validation", () => {
  it("persists the layered fields and reads them back; corrupt stored maps read as {}", async () => {
    const { svc, settings } = setup();
    const saved = await svc.updateSettings(ORG, "owner", {
      slaByChannel: { whatsapp: 30 }, slaVipMinutes: 15, slaEscalateAfterMinutes: 45,
      slaLeadAlertEnabled: false, slaAutoReassignEnabled: true,
    });
    expect(saved.slaByChannel).toEqual({ whatsapp: 30 });
    expect(saved.slaVipMinutes).toBe(15);
    expect(saved.slaEscalateAfterMinutes).toBe(45);
    expect(saved.slaLeadAlertEnabled).toBe(false);
    expect(saved.slaAutoReassignEnabled).toBe(true);
    settings[0].slaByChannel = { whatsapp: "garbage", nope: 3 };
    const read = await svc.getSettings(ORG);
    expect(read.slaByChannel).toEqual({});
  });
  it("refuses invalid layering at the write boundary", async () => {
    const { svc } = setup();
    await expect(svc.updateSettings(ORG, "owner", { slaByChannel: { evil: 30 } as any })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.updateSettings(ORG, "owner", { slaByChannel: { whatsapp: 0 } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.updateSettings(ORG, "owner", { slaVipMinutes: 0 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.updateSettings(ORG, "owner", { slaEscalateAfterMinutes: 99999 })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("IN4a layered breach folder + counts + row state", () => {
  it("whatsapp's 30-minute layer breaches at 45m while the 60-minute default does not", async () => {
    // listConversations runs on the real clock — creation times
    // here are real-clock relative (threshold slack ≥ 10 minutes).
    const ago = (m: number) => new Date(Date.now() - m * 60000);
    const { svc } = setup({ slaByChannel: { whatsapp: 30 } }, [
      conv({ id: "c-wa", channel: "whatsapp", createdAt: ago(45) }),
      conv({ id: "c-fb", channel: "messenger", createdAt: ago(45) }),
      conv({ id: "c-wa-young", channel: "whatsapp", createdAt: ago(20) }),
    ]);
    const rows = await svc.listConversations(ORG, { folder: "sla" }, "agent-1");
    expect(rows.map((r: any) => r.id)).toEqual(["c-wa"]);
    const counts = await svc.conversationFolderCounts(ORG, "agent-1");
    expect(counts.slaBreach).toBe(1);
    expect(counts.slaByChannel).toEqual({ whatsapp: 30 });
  });
  it("the VIP layer (15m) breaches a 20-minute-old VIP conversation but not a non-VIP twin", async () => {
    const ago = (m: number) => new Date(Date.now() - m * 60000);
    const { svc, db } = setup({ slaVipMinutes: 15, escalationThresholdMinor: 100000 }, [
      conv({ id: "c-vip", channel: "webchat", createdAt: ago(20) }),
      conv({ id: "c-plain", channel: "webchat", createdAt: ago(20) }),
    ]);
    (db.order as any).create({ data: { id: "o-vip", organizationId: ORG, conversationId: "c-vip", totalMinor: 150000n, createdAt: ago(19) } });
    const rows = await svc.listConversations(ORG, { folder: "sla" }, "agent-1");
    expect(rows.map((r: any) => r.id)).toEqual(["c-vip"]);
    const all = await svc.listConversations(ORG, {}, "agent-1");
    const vipRow = all.find((r: any) => r.id === "c-vip");
    expect(vipRow.slaState).toBe("breached");
    expect(vipRow.slaEffectiveMinutes).toBe(15);
    const plainRow = all.find((r: any) => r.id === "c-plain");
    expect(plainRow.slaState).toBeNull(); // 20m < 75% of 60m
  });
  it("list rows carry warning state at 75% with the layered deadline (real clock)", async () => {
    const fiftyMinAgo = new Date(Date.now() - 50 * 60000);
    const { svc } = setup({}, [conv({ id: "c-warn", channel: "webchat", createdAt: fiftyMinAgo })]);
    const rows = await svc.listConversations(ORG, {}, "agent-1");
    const row = rows.find((r: any) => r.id === "c-warn");
    expect(row.slaState).toBe("warning"); // 50m ≥ 75% of 60m, below the limit
    expect(row.slaEffectiveMinutes).toBe(60);
    expect(row.slaDueAt).toBe(new Date(fiftyMinAgo.getTime() + 60 * 60000).toISOString());
  });
});

describe("IN4 chain — warning (fake clock)", () => {
  it("warns the assignee once at 75%; an unassigned conversation is warned only after assignment", async () => {
    const c1 = conv({ id: "c-1", assignedUserId: "agent-1", createdAt: minsAgo(50) });
    const c2 = conv({ id: "c-2", assignedUserId: null, createdAt: minsAgo(50) });
    const { svc, notifications } = setup({}, [c1, c2]);
    const r1 = await svc.runSlaSweeps(ORG, NOW);
    expect(r1.warned).toBe(1);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ userId: "agent-1", type: "sla_warning", conversationId: "c-1" });
    expect(c1.slaWarnedAt).toEqual(NOW);
    expect(c2.slaWarnedAt).toBeNull(); // nobody to warn — marker stays unset
    const r2 = await svc.runSlaSweeps(ORG, NOW);
    expect(r2.warned).toBe(0); // never twice
    c2.assignedUserId = "agent-2";
    const r3 = await svc.runSlaSweeps(ORG, NOW);
    expect(r3.warned).toBe(1);
    expect(notifications[1]).toMatchObject({ userId: "agent-2", type: "sla_warning", conversationId: "c-2" });
  });
});

describe("IN4 chain — lead alert (fake clock)", () => {
  it("alerts the escalation team's lead once, after breach + escalate-after", async () => {
    const c1 = conv({ id: "c-1", assignedUserId: "agent-1", createdAt: minsAgo(100) });
    const { svc, db, notifications, audit } = setup({ escalationTeamId: "team-1" }, [c1]);
    (db.inboxTeam as any).create({ data: { id: "team-1", organizationId: ORG, name: "সাপোর্ট", channels: [], leadUserId: "lead-1" } });
    const r = await svc.runSlaSweeps(ORG, NOW);
    expect(r.leadAlerted).toBe(1);
    const urgent = notifications.filter((n) => n.type === "urgent");
    expect(urgent).toHaveLength(1);
    expect(urgent[0].userId).toBe("lead-1");
    expect(c1.slaLeadAlertedAt).toEqual(NOW);
    expect(audit.calls.some((c: any) => c.action === "inbox.sla.lead_alerted")).toBe(true);
    const r2 = await svc.runSlaSweeps(ORG, NOW);
    expect(r2.leadAlerted).toBe(0);
  });
  it("does not alert before breach + escalate-after, nor when the step is disabled", async () => {
    const early = conv({ id: "c-early", assignedUserId: "agent-1", createdAt: minsAgo(70) }); // breached 60, escalate at 90
    const s1 = setup({}, [early]);
    expect((await s1.svc.runSlaSweeps(ORG, NOW)).leadAlerted).toBe(0);
    const late = conv({ id: "c-late", assignedUserId: "agent-1", createdAt: minsAgo(100) });
    const s2 = setup({ slaLeadAlertEnabled: false }, [late]);
    expect((await s2.svc.runSlaSweeps(ORG, NOW)).leadAlerted).toBe(0);
    expect(s2.notifications.filter((n) => n.type === "urgent")).toHaveLength(0);
  });
  it("falls back to OWNER/ADMIN when no team lead exists", async () => {
    const c1 = conv({ id: "c-1", assignedUserId: "agent-1", createdAt: minsAgo(100) });
    const { svc, notifications } = setup({}, [c1]);
    const r = await svc.runSlaSweeps(ORG, NOW);
    expect(r.leadAlerted).toBe(1);
    expect(notifications.filter((n) => n.type === "urgent").map((n) => n.userId)).toEqual(["owner"]);
  });
});

describe("IN4 chain — auto-reassign (fake clock)", () => {
  function reassignSetup(settingsPatch: Row = {}) {
    const breached = conv({ id: "c-breach", assignedUserId: "agent-1", createdAt: minsAgo(100) });
    const load: Row[] = [1, 2, 3, 4].map((i) => conv({
      id: `c-load-${i}`, assignedUserId: "agent-1", createdAt: minsAgo(500), firstResponseAt: minsAgo(400),
    }));
    // Everyone else eligible carries SOME load so agent-2 (zero
    // open) is the unique least-busy: owner 1, lead-1 2.
    load.push(conv({ id: "c-load-owner", assignedUserId: "owner", createdAt: minsAgo(500), firstResponseAt: minsAgo(400) }));
    load.push(conv({ id: "c-load-lead-1", assignedUserId: "lead-1", createdAt: minsAgo(500), firstResponseAt: minsAgo(400) }));
    load.push(conv({ id: "c-load-lead-2", assignedUserId: "lead-1", createdAt: minsAgo(500), firstResponseAt: minsAgo(400) }));
    const s = setup({ slaAutoReassignEnabled: true, ...settingsPatch }, [breached, ...load]);
    (s.db.agentState as any).create({ data: { id: "as-3", organizationId: ORG, userId: "agent-3", status: "away" } });
    (s.db.agentSchedule as any).create({ data: { id: "sch-4", organizationId: ORG, userId: "agent-4", timezone: "UTC", windows: {} } });
    return { ...s, breached };
  }
  it("moves the breached conversation to the least-busy eligible agent — never away/off-shift/the same person", async () => {
    const { svc, breached, notifications, audit } = reassignSetup();
    const r = await svc.runSlaSweeps(ORG, NOW);
    expect(r.reassigned).toBe(1);
    expect(breached.assignedUserId).toBe("agent-2"); // 0 open; agent-3 away, agent-4 off-shift, agent-1 is the current assignee + busiest
    expect(breached.slaAutoReassignedAt).toEqual(NOW);
    expect(notifications.some((n) => n.type === "assigned" && n.userId === "agent-2" && n.conversationId === "c-breach")).toBe(true);
    expect(audit.calls.some((c: any) => c.action === "inbox.sla.auto_reassigned" && c.metadata?.from === "agent-1" && c.metadata?.to === "agent-2")).toBe(true);
    const r2 = await svc.runSlaSweeps(ORG, NOW);
    expect(r2.reassigned).toBe(0); // once only
  });
  it("is OFF by default: the same breach changes no assignment", async () => {
    const breached = conv({ id: "c-breach", assignedUserId: "agent-1", createdAt: minsAgo(100) });
    const { svc } = setup({}, [breached]);
    const r = await svc.runSlaSweeps(ORG, NOW);
    expect(r.reassigned).toBe(0);
    expect(breached.assignedUserId).toBe("agent-1");
    expect(breached.slaAutoReassignedAt).toBeNull();
  });
  it("with no eligible candidate the marker stays unset (a later pass can still act)", async () => {
    const breached = conv({ id: "c-breach", assignedUserId: "agent-1", createdAt: minsAgo(100) });
    const { svc, db } = setup({ slaAutoReassignEnabled: true }, [breached]);
    // Make everyone else ineligible: agent-2/3/4 away, lead-1 away, owner away.
    for (const u of ["agent-2", "agent-3", "agent-4", "lead-1", "owner"]) {
      (db.agentState as any).create({ data: { id: `as-${u}`, organizationId: ORG, userId: u, status: "away" } });
    }
    const r = await svc.runSlaSweeps(ORG, NOW);
    expect(r.reassigned).toBe(0);
    expect(breached.slaAutoReassignedAt).toBeNull();
    expect(breached.assignedUserId).toBe("agent-1");
  });
});

describe("IN4 chain — scope", () => {
  it("never scans first-responded, closed or practice conversations", async () => {
    const { svc, notifications } = setup({ slaAutoReassignEnabled: true }, [
      conv({ id: "c-done", assignedUserId: "agent-1", createdAt: minsAgo(500), firstResponseAt: minsAgo(400) }),
      conv({ id: "c-closed", assignedUserId: "agent-1", createdAt: minsAgo(500), status: "closed" }),
      conv({ id: "c-practice", assignedUserId: "agent-1", createdAt: minsAgo(500), isPractice: true }),
    ]);
    const r = await svc.runSlaSweeps(ORG, NOW);
    expect(r).toEqual({ scanned: 0, warned: 0, leadAlerted: 0, reassigned: 0 });
    expect(notifications).toHaveLength(0);
  });
});

describe("IN4d handover queue — SLA-risk sort", () => {
  it("waiting order and SLA-risk order differ when the layers say so; rows carry slaState", async () => {
    const realNow = Date.now();
    const ago = (m: number) => new Date(realNow - m * 60000);
    // A waited longest (handover 65m ago) but its deadline is
    // LATER (messenger, default 60m, created 70m ago → due 10m ago).
    const a = conv({ id: "c-a", channel: "messenger", createdAt: ago(70), handoverAt: ago(65), autoReplyPaused: true });
    // B waited least (5m) but its deadline is EARLIER (whatsapp
    // layer 30m, created 50m ago → due 20m ago).
    const b = conv({ id: "c-b", channel: "whatsapp", createdAt: ago(50), handoverAt: ago(5), autoReplyPaused: true });
    const { svc } = setup({ slaByChannel: { whatsapp: 30 } }, [a, b]);
    const byWaiting = await svc.listConversations(ORG, { folder: "handover" }, "agent-1");
    expect(byWaiting.map((r: any) => r.id)).toEqual(["c-a", "c-b"]);
    const byRisk = await svc.listConversations(ORG, { folder: "handover", sort: "sla_risk" }, "agent-1");
    expect(byRisk.map((r: any) => r.id)).toEqual(["c-b", "c-a"]);
    expect(byRisk[0].slaState).toBe("breached");
    expect(byRisk[0].slaEffectiveMinutes).toBe(30);
    expect(byRisk[0].slaDueAt).toBeTruthy();
  });
});
