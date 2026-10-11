import { InboxService } from "./inbox.service";

/**
 * Milestone 70 (Team W2): scorecard math — indicator
 * components, period deltas, median flags, insufficient
 * data, ranking and CSV. "Now" pinned: Sunday 2026-10-11
 * 12:00 Dhaka (06:00 UTC); the period is 7 days, so the
 * current window starts 2026-10-04 06:00 UTC and the
 * previous one 2026-09-27 06:00 UTC.
 */
const NOW = new Date(Date.UTC(2026, 9, 11, 6, 0));
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 3600 * 1000);
const minsAfter = (base: Date, m: number) => new Date(base.getTime() + m * 60000);

function match(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
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
    findFirst: jest.fn(async () => null),
    count: jest.fn(async ({ where }: any = {}) => rows.filter((r) => match(r, where)).length),
  };
}

function world() {
  const memberships = [
    { userId: "star", organizationId: "org", role: "SUPPORT_AGENT", status: "ACTIVE", user: { name: "Star", email: "s@x" } },
    { userId: "slow", organizationId: "org", role: "SUPPORT_AGENT", status: "ACTIVE", user: { name: "Slow", email: "sl@x" } },
    { userId: "newbie", organizationId: "org", role: "SUPPORT_AGENT", status: "ACTIVE", user: { name: "New", email: "n@x" } },
  ];
  // Star, current window: 5 conversations, first response 4m,
  // resolved in 50m, CSAT 5+5; previous window: 2 closed.
  const convs: any[] = [];
  for (let i = 0; i < 5; i++) {
    const created = daysAgo(2);
    convs.push({ organizationId: "org", assignedUserId: "star", createdAt: created, firstResponseAt: minsAfter(created, 4), resolvedAt: minsAfter(created, 50), csatRatedAt: daysAgo(1), csatRating: 5, status: "closed" });
  }
  for (let i = 0; i < 2; i++) {
    const created = daysAgo(10);
    convs.push({ organizationId: "org", assignedUserId: "star", createdAt: created, firstResponseAt: minsAfter(created, 9), resolvedAt: minsAfter(created, 90), csatRatedAt: null, csatRating: null, status: "closed" });
  }
  // Slow, current window: 4 conversations, first response 40m,
  // resolved in 300m, CSAT 2+3.
  for (let i = 0; i < 4; i++) {
    const created = daysAgo(3);
    convs.push({ organizationId: "org", assignedUserId: "slow", createdAt: created, firstResponseAt: minsAfter(created, 40), resolvedAt: minsAfter(created, 300), csatRatedAt: daysAgo(2), csatRating: i % 2 ? 3 : 2, status: "closed" });
  }
  const messages = [
    { conversation: { organizationId: "org" }, sentByUserId: "star", direction: "out", autoReply: false, status: "sent", createdAt: daysAgo(1) },
    { conversation: { organizationId: "org" }, sentByUserId: "star", direction: "out", autoReply: false, status: "sent", createdAt: daysAgo(9) },
    { conversation: { organizationId: "org" }, sentByUserId: "slow", direction: "out", autoReply: false, status: "sent", createdAt: daysAgo(2) },
  ];
  const db: any = {
    membership: table(memberships),
    channelConversation: table(convs),
    channelMessage: table(messages),
    agentState: table([]),
    agentSchedule: table([]),
    auditLog: table([]),
  };
  return new InboxService(db as any, { log: jest.fn(async () => undefined) } as any, {} as any);
}

describe("M70 performance scorecard", () => {
  beforeAll(() => { jest.useFakeTimers({ now: NOW.getTime() }); });
  afterAll(() => { jest.useRealTimers(); });

  it("computes components, totals, deltas and ranks transparently", async () => {
    const card = await world().teamScorecard("org", 7);
    const [star, slow, newbie] = card.agents as any[];
    expect(star.name).toBe("Star");
    // star: volume min(30,5)=5, speed FR 4m -> 25, resolution 50m -> 20, csat 5.0 -> 25 = 75
    expect(star.components).toEqual({ volume: 5, speed: 25, resolution: 20, csat: 25 });
    expect(star.indicator).toBe(75);
    expect(star.rank).toBe(1);
    expect(star.current.closed).toBe(5);
    expect(star.previous.closed).toBe(2);
    expect(star.deltas.closed).toBe(3);
    expect(star.current.replies).toBe(1);
    expect(star.previous.replies).toBe(1);
    expect(star.flags.map((f: any) => f.code)).toContain("customers_happy");
    // slow: volume 4, speed FR40 -> 25 - round(35/3)=12 -> 13, resolution 300 -> 20 - round(240/30)=8 -> 12, csat 2.5 -> 13 = 42
    expect(slow.components).toEqual({ volume: 4, speed: 13, resolution: 12, csat: 13 });
    expect(slow.indicator).toBe(42);
    expect(slow.flags.map((f: any) => f.code)).toEqual(expect.arrayContaining(["slow_first_response", "low_csat"]));
    // newbie: no data at all -> insufficient, unranked, missing components named
    expect(newbie.insufficientData).toBe(true);
    expect(newbie.rank).toBeNull();
    expect(newbie.missingComponents).toEqual(expect.arrayContaining(["speed", "resolution", "csat"]));
  });

  it("CSV carries the same numbers with a header row", async () => {
    const csv = await world().teamScorecardCsv("org", 7);
    const lines = csv.split("\n");
    expect(lines[0]).toContain("indicator");
    const starLine = lines.find((l) => l.includes("Star"));
    expect(starLine).toContain(",75,");
    expect(starLine).toContain("customers_happy");
  });
});
