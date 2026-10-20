import { CustomReportsService, validateDefinition, presetRange } from "./custom-reports.service";

/** Reports Advanced RP2: honest metric matrix, day runs
 *  over aggregates with ensure-fresh, ads grouping at
 *  campaign level only, derived metrics null on zero
 *  denominators, saved-definition CRUD. */
const audit = { log: async () => undefined } as any;
function svc(over: any = {}) {
  const state = { recomputes: 0, saved: [] as any[] };
  const prisma: any = {
    dailyMetricAggregate: { findMany: async () => over.aggs ?? [] },
    dailyAdMetric: { findMany: async () => over.adRows ?? [] },
    savedReport: {
      create: async ({ data }: any) => { const r = { id: "sr-1", createdAt: new Date(), updatedAt: new Date(), ...data }; state.saved.push(r); return r; },
      findMany: async () => state.saved,
      findFirst: async ({ where }: any) => state.saved.find((r) => r.id === where.id && r.organizationId === where.organizationId) ?? null,
      update: async ({ where, data }: any) => { const r = state.saved.find((x) => x.id === where.id); Object.assign(r, data); return r; },
      delete: async ({ where }: any) => { state.saved = state.saved.filter((x) => x.id !== where.id); return {}; },
    },
    ...over.prisma,
  };
  const analytics: any = { recomputeAggregates: async () => { state.recomputes++; return { daysWritten: 0 }; } };
  return { svc: new CustomReportsService(prisma, audit, analytics), state };
}
const agg = (day: string, orders: number, revenue: bigint, spend: bigint) => ({
  date: new Date(`${day}T00:00:00Z`), orders, revenueMinor: revenue, refundedMinor: 0n, cogsMinor: 0n, adSpendMinor: spend,
});

describe("RP2 custom reports", () => {
  it("the matrix refuses order metrics on ads dimensions and vice versa", () => {
    expect(() => validateDefinition("platform", ["revenue"])).toThrow(/পাওয়া যায়/);
    expect(() => validateDefinition("day", ["clicks"])).toThrow(/পাওয়া যায়/);
    expect(() => validateDefinition("day", [])).toThrow(/metric/);
  });

  it("presets resolve to real calendar ranges", () => {
    const lm = presetRange("last_month");
    expect(lm.from.slice(8)).toBe("01");
    expect(new Date(lm.to).getTime()).toBeLessThan(new Date(presetRange("this_month").from).getTime());
  });

  it("day run: coverage gap triggers one recompute; profit and AOV derive honestly", async () => {
    const { svc: s, state } = svc({ aggs: [agg("2026-10-10", 4, 200000n, 50000n), agg("2026-10-11", 0, 0n, 0n)] });
    const out = await s.run("org", { dimension: "day", metrics: ["orders", "revenue", "profit", "aov"], from: "2026-10-05", to: "2026-10-11" });
    expect(state.recomputes).toBe(1); // 2 rows < 7 days -> ensure-fresh fired
    expect(out.rows[0].values.profit).toBe("150000");
    expect(out.rows[0].values.aov).toBe("50000");
    expect(out.rows[1].values.aov).toBeNull(); // zero orders -> null, never a fake 0 average
    expect(out.totals.orders).toBe(4);
  });

  it("platform run groups campaign-level rows only and derives CTR/CPA", async () => {
    const rows = [
      { platform: "meta", campaignExternalId: "c1", campaignName: "A", spendMinor: 10000n, impressions: 1000, clicks: 50, platformConversions: 5, platformConversionValueMinor: 90000n },
      { platform: "meta", campaignExternalId: "c2", campaignName: "B", spendMinor: 5000n, impressions: 500, clicks: 10, platformConversions: 0, platformConversionValueMinor: 0n },
      { platform: "google", campaignExternalId: "g1", campaignName: "G", spendMinor: 3000n, impressions: 300, clicks: 30, platformConversions: 3, platformConversionValueMinor: 40000n },
    ];
    const { svc: s } = svc({ adRows: rows });
    const out = await s.run("org", { dimension: "platform", metrics: ["spend", "ctr", "cpa"], rangePreset: "last_7d" });
    const meta = out.rows.find((r) => r.key === "meta")!;
    expect(meta.values.spend).toBe("15000");
    expect(meta.values.ctr).toBe(4); // 60/1500
    expect(meta.values.cpa).toBe("3000"); // 15000/5
    expect(out.totals.spend).toBe("18000");
    const camp = await s.run("org", { dimension: "campaign", metrics: ["spend", "cpa"], rangePreset: "last_7d" });
    expect(camp.rows.find((r) => r.key === "c2")!.values.cpa).toBeNull(); // zero conversions
    expect(camp.rows[0].key).toBe("c1"); // sorted by spend desc
  });

  it("saved definitions: create validates + filters recipients, run uses the stored definition, foreign org 404s", async () => {
    const { svc: s } = svc({});
    const created = await s.create("org", "u1", { name: "Weekly ads", dimension: "platform", metrics: ["spend"], recipients: ["a@b.co", "not-an-email"] });
    expect(created.recipients).toEqual(["a@b.co"]);
    await expect(s.create("org", "u1", { name: "x", dimension: "platform", metrics: ["revenue"] })).rejects.toThrow(/পাওয়া যায়/);
    await expect(s.get("other-org", created.id)).rejects.toMatchObject({ code: "reports.savedReportNotFound" });
    const run = await s.runSaved("org", created.id);
    expect(run.dimension).toBe("platform");
  });
});
