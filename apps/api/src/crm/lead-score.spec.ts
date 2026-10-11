import { scoreLead, type LeadScoreInput } from "./lead-score";
import { LeadsService } from "./leads.service";

const NOW = new Date("2026-10-11T10:00:00.000Z"); // 16:00 Dhaka
const DAY = 86400000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);
const daysAhead = (n: number) => new Date(NOW.getTime() + n * DAY);

function base(over: Partial<LeadScoreInput> = {}): LeadScoreInput {
  return {
    stage: "new", valueMinor: null, activityCount: 0,
    lastActivityAt: null, lastContactedAt: null, createdAt: daysAgo(30),
    nextFollowUpAt: null, customerId: null, deliveredOrderCount: 0,
    ...over,
  };
}

describe("scoreLead — stage signal", () => {
  it("stage points progress new < contacted < qualified < proposal = won", () => {
    const at = (stage: string) => scoreLead(base({ stage, createdAt: NOW }), NOW).score;
    expect(at("new")).toBe(2 + 15);
    expect(at("contacted")).toBe(12 + 15);
    expect(at("qualified")).toBe(22 + 15);
    expect(at("proposal")).toBe(30 + 15);
    expect(at("won")).toBe(30 + 15);
  });
  it("won is always band hot; lost is capped at 10 and cold even with max other signals", () => {
    expect(scoreLead(base({ stage: "won", createdAt: NOW }), NOW).band).toBe("hot");
    const lost = scoreLead(base({
      stage: "lost", createdAt: NOW, valueMinor: 5_000_000, activityCount: 9,
      nextFollowUpAt: daysAhead(2), customerId: "c1", deliveredOrderCount: 3,
    }), NOW);
    expect(lost.score).toBe(10);
    expect(lost.band).toBe("cold");
    expect(lost.reasons.join(" ")).toContain("সর্বোচ্চ 10");
  });
});

describe("scoreLead — value bands (BDT)", () => {
  const withValue = (v: number | null) => scoreLead(base({ stage: "contacted", createdAt: NOW, valueMinor: v }), NOW).score;
  it("thresholds: none 0 · <৳1,000 +5 · ৳1,000 +10 · ৳4,999 +10 · ৳5,000 +15 · ৳20,000 +20", () => {
    const fixed = 12 + 15; // contacted + recency today
    expect(withValue(null)).toBe(fixed);
    expect(withValue(0)).toBe(fixed);
    expect(withValue(50_000)).toBe(fixed + 5);     // ৳500
    expect(withValue(99_900)).toBe(fixed + 5);     // ৳999
    expect(withValue(100_000)).toBe(fixed + 10);   // ৳1,000
    expect(withValue(499_900)).toBe(fixed + 10);   // ৳4,999
    expect(withValue(500_000)).toBe(fixed + 15);   // ৳5,000
    expect(withValue(1_999_900)).toBe(fixed + 15); // ৳19,999
    expect(withValue(2_000_000)).toBe(fixed + 20); // ৳20,000
  });
});

describe("scoreLead — activity & recency", () => {
  it("activity tiers 0/1/2/3/5/6 → 0/5/5/10/10/15", () => {
    const withActs = (n: number) => scoreLead(base({ activityCount: n, createdAt: NOW }), NOW).score;
    const fixed = 2 + 15;
    expect(withActs(0)).toBe(fixed);
    expect(withActs(1)).toBe(fixed + 5);
    expect(withActs(2)).toBe(fixed + 5);
    expect(withActs(3)).toBe(fixed + 10);
    expect(withActs(5)).toBe(fixed + 10);
    expect(withActs(6)).toBe(fixed + 15);
  });
  it("recency tiers by Dhaka days since last touch", () => {
    const withTouch = (d: number) => scoreLead(base({ lastContactedAt: daysAgo(d) }), NOW).score;
    expect(withTouch(0)).toBe(2 + 15);
    expect(withTouch(1)).toBe(2 + 15);
    expect(withTouch(2)).toBe(2 + 12);
    expect(withTouch(3)).toBe(2 + 12);
    expect(withTouch(4)).toBe(2 + 8);
    expect(withTouch(7)).toBe(2 + 8);
    expect(withTouch(8)).toBe(2 + 4);
    expect(withTouch(14)).toBe(2 + 4);
    expect(withTouch(15)).toBe(2);
    expect(withTouch(60)).toBe(2);
  });
  it("recency uses the LATEST of lastContactedAt / lastActivityAt / createdAt", () => {
    const s = scoreLead(base({ createdAt: daysAgo(40), lastContactedAt: daysAgo(30), lastActivityAt: daysAgo(1) }), NOW);
    expect(s.score).toBe(2 + 15);
  });
});

describe("scoreLead — follow-up & customer signals", () => {
  it("future follow-up +10, due today +5, overdue −10 with the day count in the reason", () => {
    expect(scoreLead(base({ createdAt: NOW, nextFollowUpAt: daysAhead(3) }), NOW).score).toBe(2 + 15 + 10);
    expect(scoreLead(base({ createdAt: NOW, nextFollowUpAt: NOW }), NOW).score).toBe(2 + 15 + 5);
    const overdue = scoreLead(base({ createdAt: NOW, nextFollowUpAt: daysAgo(2) }), NOW);
    expect(overdue.score).toBe(2 + 15 - 10);
    expect(overdue.reasons.join(" ")).toContain("2 দিন পেরিয়ে গেছে");
  });
  it("linked customer +5 and delivered orders +5 (count in the reason)", () => {
    expect(scoreLead(base({ createdAt: NOW, customerId: "c1" }), NOW).score).toBe(2 + 15 + 5);
    const s = scoreLead(base({ createdAt: NOW, customerId: "c1", deliveredOrderCount: 2 }), NOW);
    expect(s.score).toBe(2 + 15 + 5 + 5);
    expect(s.reasons.join(" ")).toContain("2টি অর্ডার");
  });
  it("delivered orders without a linked customer earn nothing", () => {
    expect(scoreLead(base({ createdAt: NOW, deliveredOrderCount: 5 }), NOW).score).toBe(2 + 15);
  });
});

describe("scoreLead — combined, bands, clamping, thin data", () => {
  it("a fully-loaded proposal lead reaches exactly 100 and band hot", () => {
    const s = scoreLead(base({
      stage: "proposal", valueMinor: 2_500_000, activityCount: 6, createdAt: NOW,
      nextFollowUpAt: daysAhead(1), customerId: "c1", deliveredOrderCount: 1,
    }), NOW);
    expect(s.score).toBe(100);
    expect(s.band).toBe("hot");
    expect(s.thinData).toBe(false);
  });
  it("score never goes below 0 (overdue penalty on a bare new lead)", () => {
    const s = scoreLead(base({ nextFollowUpAt: daysAgo(5) }), NOW);
    expect(s.score).toBe(0);
    expect(s.band).toBe("cold");
  });
  it("band edges: 60 hot, 59 warm, 30 warm, 29 cold", () => {
    // qualified(22) + ৳20,000(20) + acts 3(10) + recency ≤7d(8) = 60
    expect(scoreLead(base({ stage: "qualified", valueMinor: 2_000_000, activityCount: 3, lastContactedAt: daysAgo(5) }), NOW).band).toBe("hot");
    // contacted(12) + ৳5,000(15) + acts 1(5) + recency today(15) + customer(5) + delivered(5) = 57 → warm
    expect(scoreLead(base({ stage: "contacted", valueMinor: 500_000, activityCount: 1, createdAt: NOW, customerId: "c", deliveredOrderCount: 1 }), NOW).band).toBe("warm");
    // new(2) + acts 6(15) + recency ≤3d(12) = 29 → cold
    expect(scoreLead(base({ activityCount: 6, lastContactedAt: daysAgo(2) }), NOW).band).toBe("cold");
  });
  it("thin data: bare lead gets the verbatim caution and thinData=true", () => {
    const s = scoreLead(base(), NOW);
    expect(s.thinData).toBe(true);
    expect(s.reasons.join(" ")).toContain("এই Lead সম্পর্কে তথ্য খুবই কম");
    expect(s.score).toBe(2);
  });
  it("any single real signal (value / customer / contact / 2+ activities) clears thin data", () => {
    expect(scoreLead(base({ valueMinor: 10_000 }), NOW).thinData).toBe(false);
    expect(scoreLead(base({ customerId: "c1" }), NOW).thinData).toBe(false);
    expect(scoreLead(base({ lastContactedAt: daysAgo(1) }), NOW).thinData).toBe(false);
    expect(scoreLead(base({ activityCount: 2 }), NOW).thinData).toBe(false);
  });
});

// ---------- Surfaces (list / getOne) with tenant isolation ----------

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("notIn" in v && v.notIn.includes(row[k])) return false;
      if ("in" in v && !v.in.includes(row[k])) return false;
      if ("not" in v) { const ok = v.not === null ? row[k] != null : row[k] !== v.not; if (!ok) return false; }
      if ("lt" in v && !(row[k] != null && new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false;
      if ("gte" in v && !(row[k] != null && new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where, take, orderBy }: any = {}) => {
      let f = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "desc") f = [...f].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (orderBy?.updatedAt === "desc") f = [...f].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      if (take) f = f.slice(0, take);
      return f;
    },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
  };
}

describe("Lead score surfaces", () => {
  function setup() {
    const prisma: any = { lead: makeTable("lead"), leadActivity: makeTable("act"), order: makeTable("ord"), customer: makeTable("cust"), membership: makeTable("mem") };
    const svc = new LeadsService(prisma);
    return { prisma, svc };
  }
  const leadData = (over: Record<string, unknown> = {}) => ({
    organizationId: "org-1", name: "L", phone: null, email: null, source: "manual", stage: "new",
    valueMinor: null, currency: "BDT", notes: null, ownerUserId: null, customerId: null,
    mergedIntoId: null, nextFollowUpAt: null, lastContactedAt: null, ...over,
  });

  it("list rows carry a computed score; sort=score orders high → low", async () => {
    const { prisma, svc } = setup();
    const cold = await prisma.lead.create({ data: leadData({ name: "Cold", createdAt: daysAgo(40), updatedAt: daysAgo(1) }) });
    const hot = await prisma.lead.create({ data: leadData({ name: "Hot", stage: "proposal", valueMinor: BigInt(2_500_000), createdAt: new Date(), updatedAt: new Date() }) });
    const rows = await svc.list("org-1", {});
    const byName = Object.fromEntries(rows.map((r: any) => [r.name, r.score.score]));
    expect(byName.Hot).toBeGreaterThan(byName.Cold);
    expect(rows.find((r: any) => r.id === hot.id).score.band).toBe("hot");
    expect(rows.find((r: any) => r.id === cold.id).score.thinData).toBe(true);
    const sorted = await svc.list("org-1", { sort: "score" });
    expect(sorted[0].name).toBe("Hot");
  });

  it("delivered orders count only within the same organization", async () => {
    const { prisma, svc } = setup();
    const lead = await prisma.lead.create({ data: leadData({ customerId: "cust-1", createdAt: new Date(), updatedAt: new Date() }) });
    prisma.order.rows.push(
      { id: "o1", organizationId: "org-1", customerId: "cust-1", status: "delivered" },
      { id: "o2", organizationId: "org-2", customerId: "cust-1", status: "delivered" },
      { id: "o3", organizationId: "org-1", customerId: "cust-1", status: "cancelled" },
    );
    const detail = await svc.getOne("org-1", lead.id);
    // customer link +5, exactly ONE same-org delivered order +5.
    expect(detail.score.reasons.join(" ")).toContain("1টি অর্ডার");
    expect(detail.score.score).toBe(2 + 15 + 5 + 5);
  });

  it("getOne of another org's lead is a 404 (tenant isolation)", async () => {
    const { prisma, svc } = setup();
    const foreign = await prisma.lead.create({ data: leadData({ organizationId: "org-2" }) });
    await expect(svc.getOne("org-1", foreign.id)).rejects.toThrow("Lead not found");
    const rows = await svc.list("org-1", {});
    expect(rows).toHaveLength(0);
  });
});
