import { ReportCenterService, REPORT_CATALOG } from "./report-center.service";

/** Reports Advanced RP1: center payload — catalog, recent
 *  AI reports, active shares (tokens never exposed),
 *  report jobs, and freshness from real rows only. */
function fake(over: any = {}) {
  const base: any = {
    aIReport: { findMany: async () => [{ id: "r1", type: "weekly", title: "সাপ্তাহিক", periodStart: new Date(), periodEnd: new Date(), createdAt: new Date(), provider: "gemini" }] },
    reportShare: { findMany: async () => [
      { id: "s1", title: "Client", days: 30, expiresAt: new Date(Date.now() + 86400000), createdAt: new Date() },
      { id: "s2", title: "Old", days: 7, expiresAt: new Date(Date.now() - 86400000), createdAt: new Date() },
    ] },
    scheduledJob: { findMany: async () => [{ id: "j1", name: "Daily", type: "daily_report", enabled: true, lastRunAt: new Date(), nextRunAt: new Date(), lastStatus: "success" }] },
    integration: { findMany: async () => [{ provider: "woocommerce", lastSyncAt: new Date("2026-10-11T10:00:00Z"), status: "CONNECTED" }] },
    dailyAdMetric: { findFirst: async () => ({ date: new Date("2026-10-10T00:00:00Z") }) },
    order: { findFirst: async () => ({ createdAt: new Date("2026-10-11T11:00:00Z") }) },
  };
  return new ReportCenterService({ ...base, ...over } as any);
}

describe("RP1 report center", () => {
  it("returns the catalog, active share count and freshness; expired shares are not active", async () => {
    const c = await fake().center("org");
    expect(c.catalog.length).toBe(REPORT_CATALOG.length);
    expect(c.aiReports).toHaveLength(1);
    expect(c.shares.activeCount).toBe(1);
    expect(c.shares.recent).toHaveLength(2);
    expect(JSON.stringify(c)).not.toContain("token");
    expect(c.jobs[0].type).toBe("daily_report");
    expect(c.freshness.storeLastSyncAt).toBe("2026-10-11T10:00:00.000Z");
    expect(c.freshness.latestAdMetricDate).toContain("2026-10-10");
  });

  it("a never-synced org gets nulls, not invented freshness", async () => {
    const c = await fake({
      integration: { findMany: async () => [] },
      dailyAdMetric: { findFirst: async () => null },
      order: { findFirst: async () => null },
    }).center("org");
    expect(c.freshness.storeLastSyncAt).toBeNull();
    expect(c.freshness.latestAdMetricDate).toBeNull();
    expect(c.freshness.latestOrderAt).toBeNull();
  });
});
