import { InboxService, buildFairness } from "./inbox.service";

/**
 * Milestone 74 (Team T5): workload rebalance + fairness.
 * Donor (capacity 2, five open) sheds exactly three, newest
 * first, to the only eligible receiver — the away agent and
 * the off-shift agent are never chosen. dryRun mutates
 * nothing and writes no audit.
 */
type Row = Record<string, any>;
function match(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      if ("in" in v) return (v.in as any[]).includes(row[k]);
      if ("not" in v) return row[k] !== v.not;
      return false;
    }
    return row[k] === v;
  });
}
function table(store: Row[]) {
  return {
    findMany: jest.fn(async ({ where, orderBy, take }: any = {}) => {
      let rows = store.filter((r) => match(r, where));
      if (orderBy?.createdAt) rows = [...rows].sort((a, b) => orderBy.createdAt === "desc" ? +b.createdAt - +a.createdAt : +a.createdAt - +b.createdAt);
      return take ? rows.slice(0, take) : rows;
    }),
    findFirst: jest.fn(async ({ where }: any = {}) => store.find((r) => match(r, where)) ?? null),
    update: jest.fn(async ({ where, data }: any) => {
      const row = store.find((r) => r.id === where.id); Object.assign(row!, data); return row;
    }),
    upsert: jest.fn(async ({ where, create, update }: any) => {
      const key = where.organizationId_userId;
      let row = store.find((r) => r.organizationId === key.organizationId && r.userId === key.userId);
      if (row) Object.assign(row, update); else { const created: Row = { id: `st-${store.length + 1}`, ...create }; store.push(created); return created; }
      return row;
    }),
  };
}

const ORG = "org";
function world() {
  jest.useFakeTimers({ now: new Date("2026-10-11T06:00:00.000Z") }); // Sun 12:00 Dhaka
  const memberships: Row[] = [
    { id: "m-d", userId: "donor", organizationId: ORG, role: "SUPPORT_AGENT", status: "ACTIVE", user: { name: "Donor" } },
    { id: "m-a", userId: "recv-a", organizationId: ORG, role: "SUPPORT_AGENT", status: "ACTIVE", user: { name: "Receiver A" } },
    { id: "m-b", userId: "away-b", organizationId: ORG, role: "SUPPORT_AGENT", status: "ACTIVE", user: { name: "Away B" } },
    { id: "m-c", userId: "off-c", organizationId: ORG, role: "SUPPORT_AGENT", status: "ACTIVE", user: { name: "OffShift C" } },
  ];
  const states: Row[] = [
    { id: "s-a", organizationId: ORG, userId: "recv-a", status: "online" },
    { id: "s-b", organizationId: ORG, userId: "away-b", status: "away" },
    { id: "s-c", organizationId: ORG, userId: "off-c", status: "online" },
  ];
  const teams: Row[] = [{ id: "team-1", organizationId: ORG, name: "Sales", channels: [] }];
  const teamMembers: Row[] = [{ id: "tm-d", teamId: "team-1", userId: "donor", capacity: 2 }];
  // OffShift C works Sundays 00:00–01:00 only — off-shift at noon.
  const schedules: Row[] = [{ id: "sch-c", organizationId: ORG, userId: "off-c", timezone: "Asia/Dhaka", windows: { sun: [["00:00", "01:00"]] } }];
  const convs: Row[] = [1, 2, 3, 4, 5].map((i) => ({
    id: `conv-${i}`, organizationId: ORG, status: "open", assignedUserId: "donor", teamId: null,
    createdAt: new Date(`2026-10-11T0${i}:00:00.000Z`),
  }));
  const fake: any = {
    membership: table(memberships), agentState: table(states),
    inboxTeam: table(teams), inboxTeamMember: table(teamMembers),
    agentSchedule: table(schedules), channelConversation: table(convs),
  };
  const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
  const svc = new InboxService(fake, audit as any, {} as any);
  return { svc, convs, audit };
}

describe("M74 rebalance", () => {
  it("dry run plans three moves to the only eligible receiver and changes nothing", async () => {
    const { svc, convs, audit } = world();
    const plan: any = await svc.rebalanceWorkload(ORG, "boss", { dryRun: true });
    expect(plan.movedCount).toBe(3);
    expect(plan.moves.map((m: any) => m.conversationId)).toEqual(["conv-5", "conv-4", "conv-3"]); // newest first
    expect(plan.moves.every((m: any) => m.toUserId === "recv-a")).toBe(true);
    expect(convs.every((c) => c.assignedUserId === "donor")).toBe(true);
    expect(audit.calls).toHaveLength(0);
  });

  it("a real run applies the moves and audits once", async () => {
    const { svc, convs, audit } = world();
    const out: any = await svc.rebalanceWorkload(ORG, "boss", {});
    expect(out.movedCount).toBe(3);
    expect(convs.filter((c) => c.assignedUserId === "recv-a")).toHaveLength(3);
    expect(convs.filter((c) => c.assignedUserId === "donor")).toHaveLength(2);
    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0].action).toBe("inbox.workload_rebalanced");
    expect(audit.calls[0].metadata.movedCount).toBe(3);
  });
});

describe("M74 fairness math", () => {
  it("shares and deviations are exact; zero work stays honestly zero", () => {
    const f = buildFairness([
      { userId: "a", current: { assigned: 10 } },
      { userId: "b", current: { assigned: 30 } },
    ]);
    expect(f.totalAssigned).toBe(40);
    expect(f.equalSharePercent).toBe(50);
    expect(f.perAgent).toEqual([
      { userId: "a", assigned: 10, sharePercent: 25, deviationPercent: -25 },
      { userId: "b", assigned: 30, sharePercent: 75, deviationPercent: 25 },
    ]);
    expect(f.spreadPercent).toBe(50);
    const zero = buildFairness([{ userId: "a", current: { assigned: 0 } }]);
    expect(zero.perAgent[0].sharePercent).toBe(0);
  });
});
