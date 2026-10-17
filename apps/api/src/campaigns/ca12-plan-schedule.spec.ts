import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder Advanced CA12 (CB3): plan-level
 * scheduled pause/resume. The window lives on the plan;
 * the per-org plan_schedule_sweep job runs
 * scanPlanSchedules, which claims each due leg by stamping
 * *ExecutedAt FIRST (exactly once — re-runs are no-ops) and
 * executes through setMetaStatus (stubbed here at the
 * service boundary; the real Meta-confirmed path is
 * covered by the phase-i/phase-k suites).
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("gte" in v) return new Date(row[k]).getTime() >= new Date((v as any).gte).getTime();
      if ("lte" in v) return row[k] != null && new Date(row[k]).getTime() <= new Date((v as any).lte).getTime();
      if ("lt" in v) return new Date(row[k]).getTime() < new Date((v as any).lt).getTime();
      if ("not" in v) return row[k] !== (v as any).not;
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
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findUnique: async ({ where }: any = {}) => rows.find((r) => r.id === where.id) ?? null,
    findMany: async ({ where, take }: any = {}) => { const f = rows.filter((r) => matches(r, where ?? {})); return take ? f.slice(0, take) : f; },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
    updateMany: async ({ where, data }: any) => { let count = 0; for (const r of rows) if (matches(r, where ?? {})) { Object.assign(r, data); count++; } return { count }; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); rows.splice(i, 1); return {}; },
  };
}
const hour = 3_600_000;

function setup() {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "organization", "dailyAdMetric", "attributionCredit", "touchpoint"]) tables[n] = makeTable(n);
  tables.organization.rows.push({ id: "org", timezone: "Asia/Dhaka" });
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", externalId: "act_777", currency: "BDT", integrationId: "int-1" });
  const auditCalls: any[] = [];
  const audit = { log: async (e: any) => { auditCalls.push(e); } } as any;
  const svc: any = new CampaignsService(tables as any, audit, { getProvider: () => new DevTemplateProvider() } as any);
  const statusCalls: { planId: string; target: string }[] = [];
  svc.setMetaStatus = async (_org: string, _actor: string, planId: string, target: string) => {
    statusCalls.push({ planId, target });
    const row = tables.campaignPlan.rows.find((p: any) => p.id === planId);
    if (row) row.metaStatus = target;
    return {};
  };
  return { tables, svc, auditCalls, statusCalls };
}

function livePlan(tables: any, extra: any = {}) {
  tables.campaignPlan.rows.push({
    id: "plan-1", organizationId: "org", adAccountId: "acc-1", name: "Eid Sale", objective: "OUTCOME_SALES",
    status: "published", externalCampaignId: "camp-1", metaStatus: "ACTIVE", budgetMode: "abo", createdById: "u1",
    pauseAt: null, resumeAt: null, pauseExecutedAt: null, resumeExecutedAt: null, ...extra,
  });
}

describe("CA12 setPlanSchedule", () => {
  it("sets a window on a published plan, returns the org timezone, and audits", async () => {
    const { tables, svc, auditCalls } = setup();
    livePlan(tables);
    const pauseAt = new Date(Date.now() + 2 * hour);
    const resumeAt = new Date(Date.now() + 26 * hour);
    const out = await svc.setPlanSchedule("org", "u1", "plan-1", { pauseAt: pauseAt.toISOString(), resumeAt: resumeAt.toISOString() });
    expect(out.timezone).toBe("Asia/Dhaka");
    expect(new Date(out.pauseAt).getTime()).toBe(pauseAt.getTime());
    expect(out.pauseExecutedAt).toBeNull();
    const row = tables.campaignPlan.rows[0];
    expect(new Date(row.pauseAt).getTime()).toBe(pauseAt.getTime());
    expect(auditCalls.find((a: any) => a.action === "campaign.pause_window_set")).toBeTruthy();
  });

  it("refuses a window on a draft plan and a resume not after pause; clearing always works and resets stamps", async () => {
    const { tables, svc } = setup();
    livePlan(tables, { status: "draft", externalCampaignId: null });
    await expect(svc.setPlanSchedule("org", "u1", "plan-1", { pauseAt: new Date(Date.now() + hour).toISOString() })).rejects.toThrow(/Published/);
    tables.campaignPlan.rows[0].status = "published";
    tables.campaignPlan.rows[0].externalCampaignId = "camp-1";
    const t = Date.now();
    await expect(svc.setPlanSchedule("org", "u1", "plan-1", { pauseAt: new Date(t + 2 * hour).toISOString(), resumeAt: new Date(t + hour).toISOString() })).rejects.toThrow(/পরে/);
    // clearing an executed window clears the stamps too
    tables.campaignPlan.rows[0].pauseAt = new Date(t - hour);
    tables.campaignPlan.rows[0].pauseExecutedAt = new Date(t - hour);
    const cleared = await svc.setPlanSchedule("org", "u1", "plan-1", { pauseAt: null, resumeAt: null });
    expect(cleared.pauseAt).toBeNull();
    expect(tables.campaignPlan.rows[0].pauseExecutedAt).toBeNull();
  });
});

describe("CA12 scanPlanSchedules", () => {
  it("a due pause executes once through setMetaStatus; re-runs are no-ops", async () => {
    const { tables, svc, statusCalls } = setup();
    const now = new Date();
    livePlan(tables, { pauseAt: new Date(now.getTime() - hour) });
    const first = await svc.scanPlanSchedules("org", now);
    expect(first).toEqual({ paused: 1, resumed: 0, skipped: 0, failed: 0 });
    expect(statusCalls).toEqual([{ planId: "plan-1", target: "PAUSED" }]);
    expect(tables.campaignPlan.rows[0].pauseExecutedAt).toBeTruthy();
    const second = await svc.scanPlanSchedules("org", now);
    expect(second).toEqual({ paused: 0, resumed: 0, skipped: 0, failed: 0 });
    expect(statusCalls).toHaveLength(1);
  });

  it("a not-yet-due window is untouched", async () => {
    const { tables, svc, statusCalls } = setup();
    const now = new Date();
    livePlan(tables, { pauseAt: new Date(now.getTime() + hour) });
    const out = await svc.scanPlanSchedules("org", now);
    expect(out).toEqual({ paused: 0, resumed: 0, skipped: 0, failed: 0 });
    expect(statusCalls).toHaveLength(0);
    expect(tables.campaignPlan.rows[0].pauseExecutedAt).toBeNull();
  });

  it("a due pause on a plan that is no longer live records skipped_not_live and never retries", async () => {
    const { tables, svc, statusCalls, auditCalls } = setup();
    const now = new Date();
    livePlan(tables, { status: "draft", externalCampaignId: null, pauseAt: new Date(now.getTime() - hour) });
    const out = await svc.scanPlanSchedules("org", now);
    expect(out.skipped).toBe(1);
    expect(statusCalls).toHaveLength(0);
    const skip = auditCalls.find((a: any) => a.action === "campaign.scheduled_pause_skipped");
    expect(skip.metadata.reason).toBe("not_live");
    const again = await svc.scanPlanSchedules("org", now);
    expect(again).toEqual({ paused: 0, resumed: 0, skipped: 0, failed: 0 });
  });

  it("the resume leg fires at its time, and only from PAUSED (a manual resume in between is a recorded skip)", async () => {
    const { tables, svc, statusCalls, auditCalls } = setup();
    const now = new Date();
    livePlan(tables, {
      pauseAt: new Date(now.getTime() - 2 * hour), pauseExecutedAt: new Date(now.getTime() - 2 * hour),
      resumeAt: new Date(now.getTime() - hour), metaStatus: "PAUSED",
    });
    const out = await svc.scanPlanSchedules("org", now);
    expect(out.resumed).toBe(1);
    expect(statusCalls).toEqual([{ planId: "plan-1", target: "ACTIVE" }]);

    // second plan: owner resumed manually before the window
    tables.campaignPlan.rows.push({
      id: "plan-2", organizationId: "org", adAccountId: "acc-1", name: "Manual", objective: "OUTCOME_SALES",
      status: "published", externalCampaignId: "camp-2", metaStatus: "ACTIVE", budgetMode: "abo", createdById: "u1",
      pauseAt: null, resumeAt: new Date(now.getTime() - hour), pauseExecutedAt: null, resumeExecutedAt: null,
    });
    const out2 = await svc.scanPlanSchedules("org", now);
    expect(out2.resumed).toBe(0);
    expect(out2.skipped).toBe(1);
    expect(statusCalls).toHaveLength(1);
    const skip = auditCalls.find((a: any) => a.action === "campaign.scheduled_resume_skipped" && a.entityId === "plan-2");
    expect(skip.metadata.reason).toBe("not_paused");
  });

  it("a failing pause is audited as failed, stamped once (no silent retry loop)", async () => {
    const { tables, svc, auditCalls } = setup();
    const now = new Date();
    livePlan(tables, { pauseAt: new Date(now.getTime() - hour) });
    svc.setMetaStatus = async () => { throw new Error("Meta unreachable"); };
    const out = await svc.scanPlanSchedules("org", now);
    expect(out.failed).toBe(1);
    const fail = auditCalls.find((a: any) => a.action === "campaign.scheduled_pause_failed");
    expect(fail.metadata.error).toContain("Meta unreachable");
    const again = await svc.scanPlanSchedules("org", now);
    expect(again).toEqual({ paused: 0, resumed: 0, skipped: 0, failed: 0 });
  });

  it("org scoping: another org's due windows are not this org's sweep business", async () => {
    const { tables, svc, statusCalls } = setup();
    const now = new Date();
    livePlan(tables, { pauseAt: new Date(now.getTime() - hour) });
    tables.campaignPlan.rows.push({
      id: "plan-foreign", organizationId: "other", adAccountId: "acc-1", name: "Foreign", objective: "OUTCOME_SALES",
      status: "published", externalCampaignId: "camp-9", metaStatus: "ACTIVE", budgetMode: "abo", createdById: "u9",
      pauseAt: new Date(now.getTime() - hour), resumeAt: null, pauseExecutedAt: null, resumeExecutedAt: null,
    });
    const out = await svc.scanPlanSchedules("org", now);
    expect(out.paused).toBe(1);
    expect(statusCalls).toEqual([{ planId: "plan-1", target: "PAUSED" }]);
    expect(tables.campaignPlan.rows.find((p: any) => p.id === "plan-foreign").pauseExecutedAt).toBeNull();
  });
});
