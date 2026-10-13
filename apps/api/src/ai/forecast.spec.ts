import { forecastRevenue, type DailyRevenuePoint } from "./forecast";

function series(days: number, perDay: number): DailyRevenuePoint[] {
  const out: DailyRevenuePoint[] = [];
  const base = new Date("2026-09-14T00:00:00Z");
  for (let i = 0; i < days; i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i);
    out.push({ date: d.toISOString().slice(0, 10), revenueMinor: perDay });
  }
  return out;
}

describe("forecastRevenue (AP4)", () => {
  it("flat series → flat projection with a ±15% band and labelled method", () => {
    const r = forecastRevenue(series(28, 100_000), 14);
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.method).toContain("least-squares");
    expect(r.dailyBaselineMinor).toBe(100_000);
    expect(r.days).toHaveLength(14);
    expect(r.days[0].projectedMinor).toBe(100_000);
    expect(r.days[0].lowMinor).toBe(85_000);
    expect(r.days[0].highMinor).toBe(115_000);
    expect(r.totalProjectedMinor).toBe(1_400_000);
  });

  it("thin data refuses honestly instead of guessing", () => {
    const r = forecastRevenue(series(6, 100_000), 14);
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.reason).toContain("অনুমান বানানো হয় না");
    expect(r.basedOnDays).toBe(6);
  });

  it("mostly-zero days also refuse (fewer than 7 selling days)", () => {
    const pts = series(20, 0);
    pts[3].revenueMinor = 5000;
    const r = forecastRevenue(pts, 7);
    expect(r.available).toBe(false);
  });

  it("scenario scales the projection and restates the assumption", () => {
    const base = forecastRevenue(series(28, 100_000), 7);
    const scen = forecastRevenue(series(28, 100_000), 7, 20);
    if (!base.available || !scen.available) throw new Error("expected available");
    expect(scen.totalProjectedMinor).toBe(Math.round(base.totalProjectedMinor * 1.2));
    expect(scen.scenarioGrowthPct).toBe(20);
    expect(scen.assumptions.join(" ")).toContain("What-if scenario");
  });

  it("a rising series trends up but stays clamped and non-negative", () => {
    const pts = series(28, 0).map((p, i) => ({ ...p, revenueMinor: 50_000 + i * 10_000 }));
    const r = forecastRevenue(pts, 7);
    if (!r.available) throw new Error("expected available");
    expect(r.trendPctPerDay).toBeGreaterThan(0);
    expect(r.days[6].projectedMinor).toBeGreaterThan(r.days[0].projectedMinor);
    for (const d of r.days) expect(d.projectedMinor).toBeGreaterThanOrEqual(0);
  });
});
