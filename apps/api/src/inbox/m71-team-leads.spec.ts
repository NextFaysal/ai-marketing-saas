import { InboxService } from "./inbox.service";

/**
 * Milestone 71 (Team T3): team leads & scoped analytics.
 * A lead manages their own team's roster and sees only their
 * team's slice of the report/scorecard; managers see all.
 * "Now" pinned: Sunday 2026-10-11 12:00 Dhaka.
 */
const NOW = new Date(Date.UTC(2026, 9, 11, 6, 0));
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 3600 * 1000);
const minsAfter = (b: Date, m: number) => new Date(b.getTime() + m * 60000);

function match(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (k === "OR" && Array.isArray(v)) return v.some((sub: any) => match(row, sub));
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const rv = row[k];
      if ("gte" in v && !(new Date(rv) >= new Date((v as any).gte))) return false;
      if ("lt" in v && !(new Date(rv) < new Date((v as any).lt))) return false;
      if ("in" in v && !(v as any).in.includes(rv)) return false;
      if ("not" in v) return rv !== (v as any).not;
      if ("gte" in v || "lt" in v || "in" in v) return true;
      return Object.entries(v as any).every(([nk, nv]) => rv?.[nk] === nv);
    }
    return row[k] === v;
  });
}
function table(rows: any[]) {
  return {
    findMany: jest.fn(async ({ where, take }: any = {}) => {
      const out = rows.filter((r) => match(r, where));
      return take ? out.slice(0, take) : out;
    }),
    findFirst: jest.fn(async ({ where }: any = {}) => rows.find((r) => match(r, where)) ?? null),
    findUnique: jest.fn(async ({ where }: any) => rows.find((r) =>
      where?.userId_organizationId
        ? r.userId === where.userId_organizationId.userId && r.organizationId === where.userId_organizationId.organizationId
        : r.id === where?.id) ?? null),
    count: jest.fn(async ({ where }: any = {}) => rows.filter((r) => match(r, where)).length),
    create: jest.fn(async ({ data }: any) => { const row = { id: `id-${rows.length + 1}`, ...data }; rows.push(row); return row; }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row;
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i], where)) rows.splice(i, 1);
      return { count: before - rows.length };
    }),
    upsert: jest.fn(async () => ({})),
  };
}

function world() {
  const memberships = [
    { userId: "boss", organizationId: "org", role: "OWNER", status: "ACTIVE", user: { name: "Boss", email: "b@x" } },
    { userId: "lead", organizationId: "org", role: "SUPPORT_AGENT", status: "ACTIVE", user: { name: "Lead", email: "l@x" } },
    { userId: "mate", organizationId: "org", role: "SUPPORT_AGENT", status: "ACTIVE", user: { name: "Mate", email: "m@x" } },
    { userId: "outsider", organizationId: "org", role: "SUPPORT_AGENT", status: "ACTIVE", user: { name: "Out", email: "o@x" } },
  ];
  const teams = [{ id: "team-a", organizationId: "org", name: "Sales", channels: [], leadUserId: "lead" }];
  const teamMembers = [
    { id: "tm-1", teamId: "team-a", userId: "lead", capacity: 20 },
    { id: "tm-2", teamId: "team-a", userId: "mate", capacity: 20 },
  ];
  const conv = (assignedUserId: string, teamId: string | null, d: number) => {
    const created = daysAgo(d);
    return { organizationId: "org", assignedUserId, teamId, createdAt: created, firstResponseAt: minsAfter(created, 6), resolvedAt: minsAfter(created, 40), csatRatedAt: daysAgo(d), csatRating: 5, status: "closed", autoReplyPaused: false, customerId: null };
  };
  const convs = [conv("mate", "team-a", 1), conv("mate", "team-a", 2), conv("outsider", null, 1)];
  const db: any = {
    membership: table(memberships),
    inboxTeam: table(teams),
    inboxTeamMember: table(teamMembers),
    channelConversation: table(convs),
    channelMessage: table([]),
    agentState: table([]),
    agentSchedule: table([]),
    auditLog: table([]),
    messageDraft: table([]),
    order: table([]),
    inboxSetting: { findUnique: jest.fn(async () => ({ organizationId: "org", smartAssign: "least_busy", slaFirstResponseMinutes: 30 })) },
  };
  const svc = new InboxService(db as any, { log: jest.fn(async () => undefined) } as any, {} as any);
  return { svc, db, teams, teamMembers };
}

describe("M71 team leads", () => {
  beforeAll(() => { jest.useFakeTimers({ now: NOW.getTime() }); });
  afterAll(() => { jest.useRealTimers(); });

  it("the lead sets their own team's roster; a non-lead agent cannot", async () => {
    const { svc } = world();
    await expect(svc.setTeamMembers("org", "outsider", "team-a", [{ userId: "mate" }])).rejects.toMatchObject({ code: "inbox.onlyTheTeamSLeadOr2" });
    const out = await svc.setTeamMembers("org", "lead", "team-a", [{ userId: "lead" }, { userId: "mate", capacity: 5 }]);
    const teamA = (out as any[]).find((t) => t.id === "team-a");
    expect(teamA.members).toHaveLength(2);
    expect(teamA.members.find((m: any) => m.userId === "mate").capacity).toBe(5);
  });

  it("setting a lead requires an org member; clearing works", async () => {
    const { svc } = world();
    await expect(svc.updateTeam("org", "boss", "team-a", { leadUserId: "ghost" })).rejects.toMatchObject({ code: "inbox.theLeadMustBeAMember" });
    const row: any = await svc.updateTeam("org", "boss", "team-a", { leadUserId: "mate" });
    expect(row.leadUserId).toBe("mate");
    const cleared: any = await svc.updateTeam("org", "boss", "team-a", { leadUserId: null });
    expect(cleared.leadUserId).toBeNull();
  });

  it("the full report gains perTeam + dailyTrend", async () => {
    const { svc } = world();
    const report: any = await svc.getTeamReport("org", 7, "boss");
    const teamA = report.perTeam.find((t: any) => t.teamId === "team-a");
    expect(teamA.assigned).toBe(2);       // mate's two; outsider has no team
    expect(teamA.closed).toBe(2);
    expect(teamA.leadUserId).toBe("lead");
    expect(report.dailyTrend).toHaveLength(7);
    expect(report.dailyTrend.reduce((a: number, d: any) => a + d.created, 0)).toBe(3);
    expect(report.scopedTeamId).toBeNull();
  });

  it("a scoped report counts only the team's conversations, and only for the lead/managers", async () => {
    const { svc } = world();
    await expect(svc.getTeamReport("org", 7, "outsider", "team-a")).rejects.toMatchObject({ code: "inbox.onlyTheTeamSLeadOr" });
    const scoped: any = await svc.getTeamReport("org", 7, "lead", "team-a");
    expect(scoped.scopedTeamId).toBe("team-a");
    expect(scoped.opened).toBe(2);         // outsider's conversation is out of scope
    expect(scoped.perAgent.map((a: any) => a.userId)).toEqual(["mate"]);
  });

  it("a scoped scorecard lists only roster members", async () => {
    const { svc } = world();
    await expect(svc.teamScorecard("org", 7, { actorId: "outsider", teamId: "team-a" })).rejects.toMatchObject({ code: "inbox.onlyTheTeamSLeadOr" });
    const card: any = await svc.teamScorecard("org", 7, { actorId: "lead", teamId: "team-a" });
    expect(card.scopedTeamName).toBe("Sales");
    expect(card.agents.map((a: any) => a.userId).sort()).toEqual(["lead", "mate"]);
  });
});
