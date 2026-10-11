import { ReportGoalsService, monthWindow } from "./report-goals.service";
import { AnalyticsService } from "../analytics/analytics.service";

/** Reports Advanced RP5: month windows + pace, goal
 *  progress from real totals, delta rules (null when
 *  the previous value is 0 and current is not). */
describe("RP5 goals + comparison", () => {
  it("monthWindow: past month fully elapsed, current month partial, future month zero", () => {
    const now = new Date("2026-10-11T12:00:00Z");
    const past = monthWindow("2026-09", now);
    expect(past).toMatchObject({ from: "2026-09-01", to: "2026-09-30", daysInMonth: 30, elapsedDays: 30 });
    const cur = monthWindow("2026-10", now);
    expect(cur.elapsedDays).toBe(11);
    expect(cur.to).toBe("2026-10-11");
    expect(monthWindow("2026-12", now).elapsedDays).toBe(0);
    expect(() => monthWindow("2026-13", now)).toThrow(/YYYY-MM/);
  });

  it("goal progress: actual from computeRange totals, pace shown, unset metric has null target", async () => {
    const prisma: any = { reportGoal: { findMany: async () => [{ id: "g1", metric: "revenue", target: 1000000n }] } };
    const analytics: any = { computeRange: async () => ({ totals: { orders: 40, revenueMinor: "250000", adSpendMinor: "80000" } }) };
    const svc = new ReportGoalsService(prisma, { log: async () => undefined } as any, analytics);
    const out = await svc.list("org", "2026-09");
    const rev = out.goals.find((g) => g.metric === "revenue")!;
    expect(rev.actual).toBe("250000");
    expect(rev.progressPct).toBe(25);
    expect(out.pacePct).toBe(100); // past month
    expect(out.goals.find((g) => g.metric === "orders")!.target).toBeNull();
    expect(out.goals.find((g) => g.metric === "orders")!.actual).toBe("40");
  });

  it("overview comparison: deltas computed, prev=0 & cur>0 -> null, both 0 -> 0", async () => {
    const svc = new AnalyticsService({} as any);
    let call = 0;
    (svc as any).computeRange = async () => {
      call++;
      return call === 1
        ? { totals: { orders: 150, revenueMinor: "300000", adSpendMinor: "100000" }, profit: { contributionProfitMinor: "50000" }, _dailyRaw: new Map(), _orders: [] }
        : { totals: { orders: 100, revenueMinor: "200000", adSpendMinor: "0" }, profit: { contributionProfitMinor: "0" }, _dailyRaw: new Map(), _orders: [] };
    };
    const out: any = await svc.overview("org", "2026-10-01", "2026-10-07");
    expect(out.comparison.deltas).toEqual({ orders: 50, revenue: 50, adSpend: null, profit: null });
    expect(out.comparison.previous.orders).toBe(100);
    expect(out.comparison.previousRange).toEqual({ from: "2026-09-24", to: "2026-09-30" });
  });
});
