import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder CB2: unified readiness (structure +
 * account + schedule + landing + budget), the plan
 * daily-cap guardrail at submit, and an honestly
 * unavailable reach estimate without a Meta token.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) return true;
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
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
  };
}
function setup() {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "integration", "product"]) tables[n] = makeTable(n);
  // getPlanFull: attach ad sets + ads.
  const planFind = tables.campaignPlan.findFirst;
  tables.campaignPlan.findFirst = async (args: any) => {
    const row = await planFind(args);
    if (row && args?.include) {
      const adSets = tables.campaignAdSet.rows.filter((s: any) => s.planId === row.id)
        .map((s: any) => ({ ...s, ads: tables.campaignAd.rows.filter((a: any) => a.adSetId === s.id) }));
      return { ...row, adSets, publishLogs: [] };
    }
    return row;
  };
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", sourceType: "api", externalId: "act_1", name: "Main", currency: "BDT", platformStatusBucket: "active", integrationId: null });
  const svc = new CampaignsService(tables as any, { log: async () => undefined } as any, { getProvider: () => new DevTemplateProvider() } as any);
  return { tables, svc };
}
async function fullPlan(svc: CampaignsService) {
  const plan: any = await svc.createPlan("org", "u1", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
  const adSet: any = await svc.addAdSet("org", plan.id, { name: "S1", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg", pixelId: "px", countries: ["BD"] });
  await svc.addAd("org", plan.id, adSet.id, { name: "A1", primaryText: "ভালো প্রোডাক্ট কিনুন এখনই", linkUrl: "https://shop.example/x" });
  return { plan, adSet };
}

describe("CB2 readiness", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it("composes structure/account/budget and reports an unavailable estimate honestly", async () => {
    global.fetch = (async () => ({ status: 200 })) as any;
    const { svc } = setup();
    const { plan } = await fullPlan(svc);
    const out = await svc.readiness("org", plan.id);
    expect(out.ready).toBe(true);
    expect(out.checks.find((c: any) => c.key === "structure")?.level).toBe("ok");
    expect(out.checks.find((c: any) => c.key === "account")?.level).toBe("ok");
    expect(out.checks.filter((c: any) => c.key === "landing")[0].level).toBe("ok");
    expect(out.budget.dailyTotalMinor).toBe("50000");
    // No integration/credential -> estimate unavailable, with the reason.
    expect(out.estimate.available).toBe(false);
    expect(out.estimate.reason).toBeTruthy();
  });

  it("a disabled platform account is an error; an expired schedule is an error", async () => {
    global.fetch = (async () => ({ status: 200 })) as any;
    const { svc, tables } = setup();
    const { plan, adSet } = await fullPlan(svc);
    tables.adAccount.rows[0].platformStatusBucket = "disabled";
    tables.campaignAdSet.rows.find((s: any) => s.id === adSet.id).endTime = new Date(Date.now() - 3600_000);
    const out = await svc.readiness("org", plan.id);
    expect(out.ready).toBe(false);
    expect(out.checks.some((c: any) => c.key === "account" && c.level === "error")).toBe(true);
    expect(out.checks.some((c: any) => c.key === "schedule" && c.level === "error")).toBe(true);
  });

  it("the daily cap blocks submit with the numbers, and clearing it lets submit through", async () => {
    const { svc } = setup();
    const { plan } = await fullPlan(svc);
    await svc.updatePlan("org", plan.id, { dailyBudgetCap: "400" });
    await expect(svc.submitForApproval("org", "u1", plan.id)).rejects.toMatchObject({ code: "campaigns.planDailyBudgetCapExceededMinor" });
    await svc.updatePlan("org", plan.id, { dailyBudgetCap: "" });
    const submitted = await svc.submitForApproval("org", "u1", plan.id);
    expect(submitted.status).toBe("pending_approval");
  });

  it("budgetTotals sums daily and lifetime separately", async () => {
    const { svc } = setup();
    const { plan } = await fullPlan(svc);
    await svc.addAdSet("org", plan.id, { name: "S2", lifetimeBudget: "10000", optimizationGoal: "LINK_CLICKS", pageId: "pg", countries: ["BD"] });
    const full = await svc.getPlan("org", plan.id);
    const totals = svc.budgetTotals(full);
    expect(totals.dailyTotalMinor).toBe("50000");
    expect(totals.lifetimeTotalMinor).toBe("1000000");
    expect(totals.perAdSet).toHaveLength(2);
  });
});
