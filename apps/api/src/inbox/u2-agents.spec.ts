import { InboxService } from "./inbox.service";

/**
 * Unified Inbox U2 (Milestone 44): teams, capacities, agent state,
 * the v2 assignment engine (team routing, escalation, away/capacity
 * filters, in-pool round-robin) and the assignment sweep.
 */
type Row = Record<string, any>;
function match(row: Row, where: any = {}): boolean {
  return Object.entries(where).every(([k, raw]) => {
    const v = raw as any;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v.in as any[]).includes(row[k]);
      if ("not" in v) return row[k] !== v.not;
      if ("gte" in v) return new Date(row[k]).getTime() >= new Date(v.gte).getTime();
      if ("lt" in v) return new Date(row[k]).getTime() < new Date(v.lt).getTime();
      return true;
    }
    return row[k] === v;
  });
}
function table(store: Row[]) {
  return {
    findMany: jest.fn(async ({ where, take, orderBy }: any = {}) => {
      let rows = store.filter((r) => match(r, where));
      if (orderBy?.createdAt) rows = [...rows].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      return take ? rows.slice(0, take) : rows;
    }),
    findFirst: jest.fn(async ({ where }: any = {}) => store.find((r) => match(r, where)) ?? null),
    findUnique: jest.fn(async ({ where }: any = {}) => {
      if (where.organizationId_userId) return store.find((r) => r.organizationId === where.organizationId_userId.organizationId && r.userId === where.organizationId_userId.userId) ?? null;
      return store.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null;
    }),
    create: jest.fn(async ({ data }: any) => { const row = { id: `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...data }; store.push(row); return row; }),
    update: jest.fn(async ({ where, data }: any) => { const row = store.find((r) => r.id === where.id || match(r, where)); if (!row) throw new Error("nf"); Object.assign(row, data, { updatedAt: new Date() }); return row; }),
    updateMany: jest.fn(async ({ where, data }: any) => { let n = 0; for (const r of store) if (match(r, where)) { Object.assign(r, data); n++; } return { count: n }; }),
    delete: jest.fn(async ({ where }: any) => { const i = store.findIndex((r) => r.id === where.id); if (i >= 0) store.splice(i, 1); return {}; }),
    deleteMany: jest.fn(async ({ where }: any = {}) => { let n = 0; for (let i = store.length - 1; i >= 0; i--) if (match(store[i], where)) { store.splice(i, 1); n++; } return { count: n }; }),
    count: jest.fn(async ({ where }: any = {}) => store.filter((r) => match(r, where)).length),
    upsert: jest.fn(async ({ where, create, update }: any) => {
      const key = where.organizationId_userId ?? where;
      const found = store.find((r) => Object.entries(key).every(([k, v]) => r[k] === v));
      if (found) { Object.assign(found, update, { updatedAt: new Date() }); return found; }
      const row = { id: `up-${store.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      store.push(row); return row;
    }),
  };
}

const ORG = "org-1";
function setup() {
  const memberships: Row[] = [
    { id: "m1", organizationId: ORG, userId: "owner", role: "OWNER", createdAt: new Date("2026-01-01"), user: { id: "owner", name: "Owner", email: "o@x" } },
    { id: "m2", organizationId: ORG, userId: "agent-a", role: "SUPPORT_AGENT", createdAt: new Date("2026-01-02"), user: { id: "agent-a", name: "Agent A", email: "a@x" } },
    { id: "m3", organizationId: ORG, userId: "agent-b", role: "SUPPORT_AGENT", createdAt: new Date("2026-01-03"), user: { id: "agent-b", name: "Agent B", email: "b@x" } },
  ];
  const conversations: Row[] = [];
  const db = {
    membership: table(memberships),
    inboxSetting: table([{ id: "s1", organizationId: ORG, smartAssign: "round_robin", autoReplyMode: "off", confidenceThreshold: 70, slaFirstResponseMinutes: 60, lastAssignedUserId: null }]),
    inboxTeam: table([] as Row[]),
    inboxTeamMember: table([] as Row[]),
    agentState: table([] as Row[]),
    channelConversation: table(conversations),
    agentNotification: table([] as Row[]),
  };
  const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
  const service = new InboxService(db as any, audit as any, undefined as any);
  return { service, db, conversations, memberships };
}
function conv(over: Row = {}): Row {
  return { id: `c-${Math.random().toString(36).slice(2, 8)}`, organizationId: ORG, channel: "whatsapp", status: "open", assignedUserId: null, priority: "normal", sentimentFlag: null, contactName: "কাস্টমার", lastMessagePreview: "hi", createdAt: new Date(), lastMessageAt: new Date(), ...over };
}

describe("U2 teams + agent state", () => {
  it("team CRUD validates membership and channels", async () => {
    const { service } = setup();
    const team = await service.createTeam(ORG, "owner", { name: "সেলস", channels: ["whatsapp", "bogus"] as any });
    expect(team.channels).toEqual(["whatsapp"]); // unknown channel filtered
    await expect(service.setTeamMembers(ORG, "owner", team.id, [{ userId: "ghost" }])).rejects.toThrow(/not a member/);
    const teams = await service.setTeamMembers(ORG, "owner", team.id, [{ userId: "agent-a", capacity: 5 }]);
    expect(teams[0].members).toHaveLength(1);
    expect(teams[0].members[0].capacity).toBe(5);
  });

  it("agent state upserts and validates", async () => {
    const { service } = setup();
    await expect(service.setAgentState(ORG, "agent-a", "sleeping")).rejects.toThrow(/online \| busy \| away/);
    const a = await service.setAgentState(ORG, "agent-a", "away");
    expect(a.status).toBe("away");
    const b = await service.setAgentState(ORG, "agent-a", "online");
    expect(b.status).toBe("online");
    const states = await service.listAgentStates(ORG);
    expect(states.find((s: any) => s.userId === "agent-a")?.status).toBe("online");
    expect(states.find((s: any) => s.userId === "agent-a")?.capacity).toBe(20);
  });
});

describe("U2 assignment engine", () => {
  it("routes by channel team, rotates within the pool, skips away + full agents", async () => {
    const { service, db, conversations } = setup();
    const wa = await service.createTeam(ORG, "owner", { name: "WA টিম", channels: ["whatsapp"] });
    const fb = await service.createTeam(ORG, "owner", { name: "FB টিম", channels: ["messenger"] });
    await service.setTeamMembers(ORG, "owner", wa.id, [{ userId: "agent-a", capacity: 1 }, { userId: "agent-b", capacity: 5 }]);
    await service.setTeamMembers(ORG, "owner", fb.id, [{ userId: "owner", capacity: 5 }]);

    // messenger conversation -> FB team (owner), never the WA pool
    const c1 = conv({ channel: "messenger" }); conversations.push(c1);
    const a1: any = await (service as any).maybeSmartAssign(ORG, c1);
    expect(a1.assignedUserId).toBe("owner");
    expect(a1.teamId).toBe(fb.id);

    // whatsapp round-robin within WA pool: A then B
    const c2 = conv(); conversations.push(c2);
    const a2: any = await (service as any).maybeSmartAssign(ORG, c2);
    const c3 = conv(); conversations.push(c3);
    const a3: any = await (service as any).maybeSmartAssign(ORG, c3);
    expect([a2.assignedUserId, a3.assignedUserId].sort()).toEqual(["agent-a", "agent-b"]);
    // agent-a is now at capacity 1 -> next WA conversation goes to agent-b
    const c4 = conv(); conversations.push(c4);
    const a4: any = await (service as any).maybeSmartAssign(ORG, c4);
    expect(a4.assignedUserId).toBe("agent-b");
    // agent-b goes away -> nobody eligible left in the WA pool
    await service.setAgentState(ORG, "agent-b", "away");
    const c5 = conv(); conversations.push(c5);
    const a5: any = await (service as any).maybeSmartAssign(ORG, c5);
    expect(a5.assignedUserId).toBeNull();
    void db;
  });

  it("escalation team receives high-priority conversations", async () => {
    const { service, conversations } = setup();
    const general = await service.createTeam(ORG, "owner", { name: "সাধারণ", channels: [] });
    const vip = await service.createTeam(ORG, "owner", { name: "এসকেলেশন", channels: [] });
    await service.setTeamMembers(ORG, "owner", general.id, [{ userId: "agent-a" }]);
    await service.setTeamMembers(ORG, "owner", vip.id, [{ userId: "agent-b" }]);
    await service.updateSettings(ORG, "owner", { escalationTeamId: vip.id });
    const hot = conv({ priority: "high", sentimentFlag: "negative" }); conversations.push(hot);
    const a: any = await (service as any).maybeSmartAssign(ORG, hot);
    expect(a.assignedUserId).toBe("agent-b");
    expect(a.teamId).toBe(vip.id);
  });

  it("sweep assigns backlog and reassigns away agents' stale threads", async () => {
    const { service, conversations } = setup();
    await service.setAgentState(ORG, "agent-a", "away");
    const old = new Date(Date.now() - 60 * 60000);
    const stale = conv({ assignedUserId: "agent-a", createdAt: old, lastMessageAt: old });
    const backlog = conv({ createdAt: old, lastMessageAt: old });
    conversations.push(stale, backlog);
    const result = await service.sweepAssignments(ORG);
    expect(result.assigned).toBe(1);
    expect(result.reassigned).toBe(1);
    expect(stale.assignedUserId).not.toBe("agent-a");
    expect(backlog.assignedUserId).toBeTruthy();
  });

  it("policy off: sweep and engine assign nothing", async () => {
    const { service, db, conversations } = setup();
    (db.inboxSetting as any); // silence
    const { service: s2 } = setup();
    await s2.updateSettings(ORG, "owner", { smartAssign: "off" });
    const c = conv(); conversations.push(c);
    const out = await s2.sweepAssignments(ORG);
    expect((out as any).skipped).toBe("policy_off");
    expect(c.assignedUserId).toBeNull();
    void service;
  });
});
