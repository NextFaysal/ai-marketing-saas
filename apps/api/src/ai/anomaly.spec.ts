import { detectAnomalies, DailyPoint } from "./anomaly";

function series(overrides: Partial<DailyPoint> = {}): DailyPoint[] {
  const days: DailyPoint[] = [];
  for (let i = 0; i < 7; i++) {
    days.push({ date: `2026-10-0${i + 1}`, orders: 10, revenueMinor: 100000n, spendMinor: 20000n, ...overrides });
  }
  return days;
}

describe("detectAnomalies", () => {
  it("flags a spend spike with evidence", () => {
    const s = [...series(), { date: "2026-10-08", orders: 10, revenueMinor: 100000n, spendMinor: 40000n }];
    const { anomalies } = detectAnomalies(s);
    const spike = anomalies.find((a) => a.type === "spend_spike");
    expect(spike).toBeDefined();
    expect(spike!.evidence.changePercent).toBe(100);
  });
  it("flags orders and revenue drops", () => {
    const s = [...series(), { date: "2026-10-08", orders: 4, revenueMinor: 40000n, spendMinor: 20000n }];
    const types = detectAnomalies(s).anomalies.map((a) => a.type);
    expect(types).toContain("orders_drop");
    expect(types).toContain("revenue_drop");
  });
  it("flags spend with zero sales as critical", () => {
    const s = [...series(), { date: "2026-10-08", orders: 0, revenueMinor: 0n, spendMinor: 15000n }];
    const a = detectAnomalies(s).anomalies.find((x) => x.type === "spend_no_sales");
    expect(a?.severity).toBe("critical");
  });
  it("does NOT invent anomalies from a tiny sample", () => {
    const tiny: DailyPoint[] = [
      { date: "2026-10-01", orders: 1, revenueMinor: 5000n, spendMinor: 1000n },
      { date: "2026-10-02", orders: 0, revenueMinor: 0n, spendMinor: 900n },
    ];
    const { anomalies, sufficientData } = detectAnomalies(tiny);
    expect(sufficientData).toBe(false);
    expect(anomalies.filter((a) => a.type === "orders_drop" || a.type === "revenue_drop")).toHaveLength(0);
  });
  it("a normal day produces no anomalies", () => {
    const s = [...series(), { date: "2026-10-08", orders: 11, revenueMinor: 110000n, spendMinor: 21000n }];
    expect(detectAnomalies(s).anomalies).toHaveLength(0);
  });
});
