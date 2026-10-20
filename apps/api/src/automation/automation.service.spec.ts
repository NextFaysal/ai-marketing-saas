import { AutomationService, evaluateThreshold } from "./automation.service";

process.env.DISABLE_SCHEDULER = "true";

function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("gte" in v) return new Date(row[k]).getTime() >= new Date(v.gte).getTime();
      if ("lte" in v) return new Date(row[k]).getTime() <= new Date(v.lte).getTime();
      if ("in" in v) return v.in.includes(row[k]);
      return true;
    }
    return row[k] === v;
  });
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where, take, orderBy }: any = {}) => {
      let f = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "desc") f = [...f].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (orderBy?.nextRunAt === "asc") f = [...f].sort((a, b) => new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime());
      return take ? f.slice(0, take) : f;
    },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); Object.assign(row, data); return row; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); rows.splice(i, 1); return {}; },
  };
}

function buildSvc() {
  const tables: any = {
    scheduledJob: makeTable("job"), automationRule: makeTable("rule"), automationRun: makeTable("run"),
    dailyAdMetric: makeTable("metric"), campaignPlan: makeTable("plan"),
    organization: { findMany: async () => [{ id: "org-1" }] },
  };
  const campaignsStub = { calls: [] as any[], async setMetaStatus(orgId: string, actor: string, planId: string, status: string) { this.calls.push({ planId, status }); return { metaStatus: status }; } };
  const adsStub = {
    syncMetaInsights: async () => ({ rows: 3, created: 3, updated: 0 }),
    // AD5: executeJob dispatches insights jobs via syncInsightsJob.
    // Only the meta arm is stubbed — other platforms throw, exactly
    // like the previously-undefined syncGoogleInsights did (the
    // failing-job test below depends on that).
    syncInsightsJob: async (platform: string) => {
      if (platform !== "meta") throw new TypeError("adsStub has no insights job for this platform");
      return { rows: 3, created: 3, updated: 0 };
    },
  };
  const svc = new AutomationService(
    tables as any, { log: async () => undefined } as any,
    {} as any, {} as any, adsStub as any, {} as any, {} as any, campaignsStub as any,
  );
  return { svc, tables, campaignsStub };
}

describe("evaluateThreshold", () => {
  it("compares gt/lt strictly", () => {
    expect(evaluateThreshold(10, "gt", 5)).toBe(true);
    expect(evaluateThreshold(5, "gt", 5)).toBe(false);
    expect(evaluateThreshold(1.5, "lt", 2)).toBe(true);
  });
});

describe("Scheduled jobs", () => {
  it("a due job runs, records a success run and reschedules", async () => {
    const { svc, tables } = buildSvc();
    const job = await svc.createJob("org-1", "owner", { name: "Meta sync", type: "meta_insights", targetId: "acc-1", intervalMinutes: 60 });
    // Force it due:
    tables.scheduledJob.rows[0].nextRunAt = new Date(Date.now() - 1000);
    const ran = await svc.runDueJobs();
    expect(ran).toBe(1);
    expect(job.lastStatus ?? tables.scheduledJob.rows[0].lastStatus).toBe("success");
    expect(tables.automationRun.rows).toHaveLength(1);
    expect(tables.automationRun.rows[0].status).toBe("success");
    expect(new Date(tables.scheduledJob.rows[0].nextRunAt).getTime()).toBeGreaterThan(Date.now());
  });
  it("a failing job records an error run and the error message", async () => {
    const { svc, tables } = buildSvc();
    const job = await svc.createJob("org-1", "owner", { name: "Bad", type: "google_insights", targetId: "acc-x", intervalMinutes: 30 });
    tables.scheduledJob.rows[0].nextRunAt = new Date(Date.now() - 1000);
    // google sync on the ads stub is undefined -> executeJob throws TypeError
    await svc.runDueJobs();
    expect(tables.scheduledJob.rows[0].lastStatus).toBe("error");
    expect(tables.automationRun.rows[0].status).toBe("error");
    expect(job.id).toBe(tables.automationRun.rows[0].refId);
  });
  it("rejects unknown job types and too-short intervals", async () => {
    const { svc } = buildSvc();
    await expect(svc.createJob("org-1", "o", { name: "x", type: "rm_rf", targetId: "t", intervalMinutes: 60 })).rejects.toMatchObject({ code: "automation.invalidJobType" });
    // CX3: the job-interval minimum is now 1 (the reply-debounce
    // sweeps run every minute); 0 is still rejected.
    await expect(svc.createJob("org-1", "o", { name: "x", type: "meta_insights", targetId: "t", intervalMinutes: 0 })).rejects.toMatchObject({ code: "automation.intervalminutesMustBeAtLeast1" });
  });
});

describe("Automation rules", () => {
  function seed(svcTables: any) {
    svcTables.campaignPlan.rows.push({ id: "plan-1", organizationId: "org-1", status: "published", metaStatus: "ACTIVE", externalCampaignId: "camp-9" });
    const today = new Date();
    svcTables.dailyAdMetric.rows.push(
      { organizationId: "org-1", campaignExternalId: "camp-9", date: today, spendMinor: 90000n, platformConversions: 2, platformConversionValueMinor: 100000n },
    );
  }
  it("high CPA pauses the campaign through CampaignsService and logs evidence", async () => {
    const { svc, tables, campaignsStub } = buildSvc();
    seed(tables);
    await svc.createRule("org-1", "owner", { name: "CPA guard", metric: "platform_cpa", comparator: "gt", threshold: "300", action: "pause_campaign", mode: "execute" });
    const result = await svc.evaluateRules("org-1", "owner");
    // CPA = 900.00 / 2 = 450 > 300 -> triggered
    expect(result.results[0].triggered).toBe(true);
    expect(campaignsStub.calls).toEqual([{ planId: "plan-1", status: "PAUSED" }]);
    const run = tables.automationRun.rows.find((r: any) => r.status === "triggered");
    expect(run.evidence.value).toBeCloseTo(450);
  });
  it("below-threshold CPA does not pause anything", async () => {
    const { svc, tables, campaignsStub } = buildSvc();
    seed(tables);
    await svc.createRule("org-1", "owner", { name: "CPA guard", metric: "platform_cpa", comparator: "gt", threshold: "500", action: "pause_campaign", mode: "execute" });
    const result = await svc.evaluateRules("org-1", "owner");
    expect(result.results[0].triggered).toBe(false);
    expect(campaignsStub.calls).toHaveLength(0);
  });
  it("spend with zero conversions triggers the spend guard via CPA-less path", async () => {
    const { svc, tables, campaignsStub } = buildSvc();
    tables.campaignPlan.rows.push({ id: "plan-2", organizationId: "org-1", status: "published", metaStatus: "ACTIVE", externalCampaignId: "camp-10" });
    tables.dailyAdMetric.rows.push({ organizationId: "org-1", campaignExternalId: "camp-10", date: new Date(), spendMinor: 60000n, platformConversions: 0, platformConversionValueMinor: 0n });
    await svc.createRule("org-1", "owner", { name: "Waste guard", metric: "spend_no_conversions", comparator: "gt", threshold: "500", action: "pause_campaign", mode: "execute" });
    const result = await svc.evaluateRules("org-1", "owner");
    const forPlan2 = result.results.find((r) => r.planId === "plan-2");
    expect(forPlan2?.triggered).toBe(true);
    expect(campaignsStub.calls[0].planId).toBe("plan-2");
  });
});
