import { InboxService } from "./inbox.service";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * Milestone 69 (Team W1): the activity board's derivation
 * ladder, heartbeat stamping, and the feed's role scoping.
 * "Now" is pinned: Sunday 2026-10-11 12:00 Dhaka (06:00 UTC).
 */
const NOW = new Date(Date.UTC(2026, 9, 11, 6, 0));
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60000);

function match(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const rv = row[k];
      if ("gte" in v && !(new Date(rv) >= new Date((v as any).gte))) return false;
      if ("lt" in v && !(new Date(rv) < new Date((v as any).lt))) return false;
      if ("in" in v && !(v as any).in.includes(rv)) return false;
      if ("not" in v) return rv !== (v as any).not;
      if ("gte" in v || "lt" in v || "in" in v) return true; // operators handled above
      // one-level nested equality (e.g. conversation: { organizationId })
      return Object.entries(v as any).every(([nk, nv]) => rv?.[nk] === nv);
    }
    return row[k] === v;
  });
}
function table(rows: any[]) {
  return {
    findMany: jest.fn(async ({ where, orderBy, take }: any = {}) => {
      let out = rows.filter((r) => match(r, where));
      if (orderBy?.createdAt === "desc") out = [...out].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
      return take ? out.slice(0, take) : out;
    }),
    findFirst: jest.fn(async ({ where, orderBy }: any = {}) => {
      let out = rows.filter((r) => match(r, where));
      if (orderBy?.createdAt === "desc") out = [...out].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
      return out[0] ?? null;
    }),
    findUnique: jest.fn(async ({ where }: any) => rows.find((r) =>
      (where?.userId_organizationId ? r.userId === where.userId_organizationId.userId && r.organizationId === where.userId_organizationId.organizationId : true)) ?? null),
    count: jest.fn(async ({ where }: any = {}) => rows.filter((r) => match(r, where)).length),
    upsert: jest.fn(async ({ where, create, update }: any) => {
      const key = where.organizationId_userId;
      let row = rows.find((r) => r.userId === key.userId && r.organizationId === key.organizationId);
      if (row) Object.assign(row, update); else { row = { id: `row-${rows.length + 1}`, ...create }; rows.push(row); }
      return row;
    }),
  };
}

describe("M69 team activity board", () => {
  beforeAll(() => { jest.useFakeTimers({ now: NOW.getTime() }); });
  afterAll(() => { jest.useRealTimers(); });

  function board() {
    const memberships = [
      { userId: "u-active", organizationId: "org", role: "SUPPORT_AGENT", status: "ACTIVE", user: { name: "Active", email: "a@x" } },
      { userId: "u-idle", organizationId: "org", role: "SUPPORT_AGENT", status: "ACTIVE", user: { name: "Idle", email: "i@x" } },
      { userId: "u-offline", organizationId: "org", role: "SUPPORT_AGENT", status: "ACTIVE", user: { name: "Off", email: "o@x" } },
      { userId: "u-away", organizationId: "org", role: "SUPPORT_AGENT", status: "ACTIVE", user: { name: "Away", email: "w@x" } },
    ];
    const states = [
      { userId: "u-active", organizationId: "org", status: "online", lastActiveAt: minsAgo(1) },
      { userId: "u-idle", organizationId: "org", status: "online", lastActiveAt: minsAgo(1) }, // app open, no work
      { userId: "u-offline", organizationId: "org", status: "online", lastActiveAt: minsAgo(300) },
      { userId: "u-away", organizationId: "org", status: "away", lastActiveAt: minsAgo(1) },
    ];
    // Real ChannelMessage shape: no organizationId (scoped via
    // conversation), sender = sentByUserId, direction "in"|"out".
    const msg = (sentByUserId: string, direction: string, at: Date, extra: any = {}) => ({
      conversation: { organizationId: "org" }, sentByUserId, direction, autoReply: false, status: "sent", createdAt: at, ...extra,
    });
    const messages = [
      msg("u-active", "out", minsAgo(5)),
      msg("u-active", "out", minsAgo(30)),
      msg("u-offline", "out", minsAgo(400)),                        // hours ago — no recent work
      msg("someone-else", "out", minsAgo(2)),
      msg("u-active", "in", minsAgo(3)),                            // inbound never counts
      msg("u-active", "out", minsAgo(8), { autoReply: true }),      // the bot's work, not the agent's
      msg("u-active", "out", minsAgo(9), { status: "failed" }),     // never reached the customer
    ];
    const db: any = {
      membership: table(memberships),
      agentState: table(states),
      agentSchedule: table([]),
      channelMessage: table(messages),
      channelConversation: table([
        { organizationId: "org", assignedUserId: "u-active", status: "closed", resolvedAt: minsAgo(60) },
        { organizationId: "org", assignedUserId: "u-active", status: "open", resolvedAt: null },
      ]),
      auditLog: table([
        { organizationId: "org", userId: "u-active", action: "x", createdAt: minsAgo(10) },
      ]),
    };
    const svc = new InboxService(db as any, { log: jest.fn(async () => undefined) } as any, {} as any);
    return { svc, db, states };
  }

  it("derives active / idle / offline / away and counts only real rows", async () => {
    const { svc } = board();
    const out = await svc.teamActivity("org");
    const by = new Map(out.members.map((m: any) => [m.userId, m]));
    expect(by.get("u-active").activityState).toBe("active");
    expect(by.get("u-active").today.repliesSent).toBe(2);   // the inbound one doesn't count
    expect(by.get("u-active").today.closedToday).toBe(1);
    expect(by.get("u-active").today.openNow).toBe(1);
    expect(by.get("u-idle").activityState).toBe("idle");     // heartbeat fresh, last action never
    expect(by.get("u-offline").activityState).toBe("offline");
    expect(by.get("u-away").activityState).toBe("away");     // manual away wins over a fresh heartbeat
  });

  it("heartbeat stamps lastActiveAt on the agent's state row", async () => {
    const { svc, states } = board();
    await svc.heartbeat("org", "u-idle");
    const row = states.find((s) => s.userId === "u-idle");
    expect(+new Date(row!.lastActiveAt!)).toBe(NOW.getTime());
  });
});

describe("M69 activity feed scoping", () => {
  function feedDb() {
    const memberships = [
      { userId: "boss", organizationId: "org", role: "OWNER", status: "ACTIVE", user: { name: "Boss" } },
      { userId: "agent", organizationId: "org", role: "SUPPORT_AGENT", status: "ACTIVE", user: { name: "Agent" } },
    ];
    const audit = [
      { id: "1", organizationId: "org", userId: "boss", action: "a.boss", entityType: "X", createdAt: new Date(3000) },
      { id: "2", organizationId: "org", userId: "agent", action: "a.agent", entityType: "Y", createdAt: new Date(2000) },
      { id: "3", organizationId: "other-org", userId: "boss", action: "a.other", entityType: "X", createdAt: new Date(4000) },
    ];
    const db: any = { membership: table(memberships), auditLog: table(audit) };
    return new OrganizationsService(db as any, {} as any);
  }

  it("a manager sees the org's feed; an agent only ever sees their own rows", async () => {
    const svc = feedDb();
    const bossFeed = await svc.memberActivityFeed("org", "boss", {});
    expect(bossFeed.map((r: any) => r.action)).toEqual(["a.boss", "a.agent"]);
    expect(bossFeed[0].actorName).toBe("Boss");
    const agentFeed = await svc.memberActivityFeed("org", "agent", { userId: "boss" }); // tries to peek — overridden
    expect(agentFeed.map((r: any) => r.action)).toEqual(["a.agent"]);
  });
});
