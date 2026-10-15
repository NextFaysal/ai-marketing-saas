import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder Next CN7: the optimisation loop inside
 * the builder — breakdowns from the EXISTING DailyAdBreakdown
 * rows, per-ad creative fatigue via the shared Phase-K rule,
 * deterministic recommendations with evidence (nothing
 * mutates), and automation guardrails linked through the
 * rules engine's own campaignPlanId.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
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
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); rows.splice(i, 1); return {}; },
  };
}
const day = 86_400_000;
function setup() {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "integration", "product", "dailyAdMetric", "dailyAdBreakdown", "audienceRecord", "socialAccount", "catalogRecord", "productSet", "leadForm", "customFieldDef", "conversionApiSetting", "conversionEventLog", "automationRule", "automationRun", "attributionCredit", "touchpoint", "crossPlatformDraft", "platformPublication"]) tables[n] = makeTable(n);
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", externalId: "act_777", name: "Main", currency: "BDT", platformStatusBucket: "active", integrationId: "int-1" });
  tables.campaignPlan.rows.push({ id: "plan-1", organizationId: "org", adAccountId: "acc-1", name: "Eid Sale", objective: "OUTCOME_SALES", status: "published", externalCampaignId: "camp-1", budgetMode: "abo", createdById: "u1" });
  tables.campaignAdSet.rows.push(
    { id: "set-1", planId: "plan-1", name: "Winner Set", externalAdSetId: "ext-set-1", dailyBudgetMinor: 100000n, billingEvent: "IMPRESSIONS", optimizationGoal: "OFFSITE_CONVERSIONS", targeting: { countries: ["BD"] } },
    { id: "set-2", planId: "plan-1", name: "Dead Set", externalAdSetId: "ext-set-2", dailyBudgetMinor: 50000n, billingEvent: "IMPRESSIONS", optimizationGoal: "OFFSITE_CONVERSIONS", targeting: { countries: ["BD"] } },
  );
  tables.campaignAd.rows.push(
    { id: "ad-1", adSetId: "set-1", name: "Tired Creative", externalAdId: "ext-ad-1", primaryText: "x", linkUrl: "https://x.com", callToAction: "SHOP_NOW", format: "link" },
    { id: "ad-2", adSetId: "set-2", name: "Quiet Ad", externalAdId: "ext-ad-2", primaryText: "y", linkUrl: "https://x.com", callToAction: "SHOP_NOW", format: "link" },
  );
  const now = Date.now();
  tables.dailyAdMetric.rows.push(
    // campaign-level + ad-set-level rows for planPerformance
    { organizationId: "org", adAccountId: "acc-1", campaignExternalId: "camp-1", adSetExternalId: "", adExternalId: "", spendMinor: 210000n, impressions: 10000, clicks: 450, platformConversions: 20, reach: 5000, source: "meta", date: new Date(now - day) },
    { organizationId: "org", adAccountId: "acc-1", campaignExternalId: "camp-1", adSetExternalId: "ext-set-1", adExternalId: "", spendMinor: 150000n, impressions: 8000, clicks: 400, platformConversions: 20, reach: 4000, source: "meta", date: new Date(now - day) },
    { organizationId: "org", adAccountId: "acc-1", campaignExternalId: "camp-1", adSetExternalId: "ext-set-2", adExternalId: "", spendMinor: 60000n, impressions: 2000, clicks: 50, platformConversions: 0, reach: 1500, source: "meta", date: new Date(now - day) },
    // ad-level rows: ad-1 fatigued (freq 4.0, CTR 2% -> 1% = 50% drop)
    { organizationId: "org", adAccountId: "acc-1", campaignExternalId: "camp-1", adSetExternalId: "ext-set-1", adExternalId: "ext-ad-1", adName: "Tired Creative", spendMinor: 90000n, impressions: 4000, clicks: 40, reach: 1000, conversions: 5, source: "meta", date: new Date(now - day) },
    { organizationId: "org", adAccountId: "acc-1", campaignExternalId: "camp-1", adSetExternalId: "ext-set-1", adExternalId: "ext-ad-1", adName: "Tired Creative", spendMinor: 80000n, impressions: 4000, clicks: 80, reach: 2000, conversions: 8, source: "meta", date: new Date(now - 20 * day) },
    // ad-2: healthy, low frequency, stable CTR
    { organizationId: "org", adAccountId: "acc-1", campaignExternalId: "camp-1", adSetExternalId: "ext-set-2", adExternalId: "ext-ad-2", adName: "Quiet Ad", spendMinor: 10000n, impressions: 1000, clicks: 20, reach: 900, conversions: 0, source: "meta", date: new Date(now - day) },
    { organizationId: "org", adAccountId: "acc-1", campaignExternalId: "camp-1", adSetExternalId: "ext-set-2", adExternalId: "ext-ad-2", adName: "Quiet Ad", spendMinor: 9000n, impressions: 1000, clicks: 20, reach: 900, conversions: 0, source: "meta", date: new Date(now - 20 * day) },
  );
  tables.dailyAdBreakdown.rows.push(
    { organizationId: "org", adAccountId: "acc-1", campaignExternalId: "camp-1", dimension: "age_gender", key: "25-34:male", spendMinor: 100000n, impressions: 5000, clicks: 250, platformConversions: 10, date: new Date(now - day), source: "api" },
    { organizationId: "org", adAccountId: "acc-1", campaignExternalId: "camp-1", dimension: "age_gender", key: "35-44:female", spendMinor: 50000n, impressions: 3000, clicks: 90, platformConversions: 4, date: new Date(now - day), source: "api" },
    { organizationId: "org", adAccountId: "acc-1", campaignExternalId: "camp-1", dimension: "placement", key: "facebook:feed", spendMinor: 120000n, impressions: 6000, clicks: 300, platformConversions: 12, date: new Date(now - day), source: "api" },
    { organizationId: "org", adAccountId: "acc-1", campaignExternalId: "camp-1", dimension: "device", key: "mobile", spendMinor: 130000n, impressions: 7000, clicks: 320, platformConversions: 13, date: new Date(now - day), source: "api" },
  );
  tables.automationRule.rows.push(
    { id: "rule-1", organizationId: "org", name: "CPA Guard", campaignPlanId: "plan-1", metric: "platform_cpa", comparator: "gt", threshold: "300", windowDays: 3, action: "pause_campaign", enabled: true, lastEvaluatedAt: new Date(now - day), lastTriggeredAt: new Date(now - day), createdById: "u1" },
    { id: "rule-2", organizationId: "org", name: "Org ROAS Watch", campaignPlanId: null, metric: "platform_roas", comparator: "lt", threshold: "1.5", windowDays: 3, action: "alert", enabled: true, createdById: "u1" },
    { id: "rule-3", organizationId: "org", name: "Other Plan Rule", campaignPlanId: "plan-9", metric: "platform_cpa", comparator: "gt", threshold: "500", windowDays: 3, action: "alert", enabled: true, createdById: "u1" },
  );
  tables.automationRun.rows.push({ id: "run-1", organizationId: "org", kind: "rule", refId: "rule-1", status: "triggered", detail: "CPA 420 > 300 — campaign paused", evidence: { cpaMinor: "42000" }, createdAt: new Date(now - day) });
  const audit = { log: async () => undefined } as any;
  const svc = new CampaignsService(tables as any, audit, { getProvider: () => new DevTemplateProvider() } as any);
  return { tables, svc };
}

describe("CN7 breakdowns", () => {
  it("aggregates stored breakdown rows per dimension and splits age/gender", async () => {
    const { svc } = setup();
    const out = await svc.planBreakdowns("org", "plan-1");
    expect(out.published).toBe(true);
    expect(out.dimensions.age_gender.hasData).toBe(true);
    expect(out.dimensions.age.rows.map((r: any) => r.key)).toEqual(expect.arrayContaining(["25-34", "35-44"]));
    const male = out.dimensions.gender.rows.find((r: any) => r.key === "male");
    expect(male.spendMinor).toBe("100000");
    expect(male.cpaMinor).toBe("10000");
    expect(out.dimensions.placement.rows[0].key).toBe("facebook:feed");
    expect(out.dimensions.device.hasData).toBe(true);
  });

  it("unpublished plan reports honest empty dimensions", async () => {
    const { tables, svc } = setup();
    tables.campaignPlan.rows.push({ id: "plan-draft", organizationId: "org", adAccountId: "acc-1", name: "Draft", objective: "OUTCOME_SALES", status: "draft", createdById: "u1" });
    const out = await svc.planBreakdowns("org", "plan-draft");
    expect(out.published).toBe(false);
    expect(out.dimensions.placement.hasData).toBe(false);
  });
});

describe("CN7 creative insights + recommendations", () => {
  it("flags fatigue with the Phase-K rule (frequency >= 3.5 AND CTR drop >= 30%)", async () => {
    const { svc } = setup();
    const out = await svc.planCreativeInsights("org", "plan-1");
    const tired = out.ads.find((a: any) => a.adId === "ad-1");
    expect(tired.fatigued).toBe(true);
    expect(tired.fatigueReasons).toEqual(["frequency_high", "ctr_declining"]);
    expect(tired.frequency).toBe(4);
    expect(tired.ctrDropPercent).toBe(50);
    const quiet = out.ads.find((a: any) => a.adId === "ad-2");
    expect(quiet.fatigued).toBe(false);
  });

  it("produces fatigued + dead-set + budget-shift recommendations with evidence, mutating nothing", async () => {
    const { tables, svc } = setup();
    const out = await svc.planRecommendations("org", "plan-1");
    const types = out.recommendations.map((r: any) => r.type);
    expect(types).toEqual(expect.arrayContaining(["fatigued_creative", "dead_ad_set", "budget_shift"]));
    const shift = out.recommendations.find((r: any) => r.type === "budget_shift");
    expect(shift.proposal.fromAdSetId).toBe("set-2");
    expect(shift.proposal.toAdSetId).toBe("set-1");
    expect(shift.proposal.shiftMinor).toBe("10000"); // 20% of donor's 50000
    expect(shift.proposal.fromDailyAfterMinor).toBe("40000");
    expect(shift.proposal.toDailyAfterMinor).toBe("110000");
    expect(shift.evidence.winnerCpaMinor).toBe("7500");
    expect(shift.action.applyVia).toBe("live_budget_edit");
    const dead = out.recommendations.find((r: any) => r.type === "dead_ad_set");
    expect(dead.evidence.spendMinor).toBe("60000");
    // nothing mutated: budgets untouched, plan still published
    const set2 = tables.campaignAdSet.rows.find((s: any) => s.id === "set-2");
    expect(set2.dailyBudgetMinor).toBe(50000n);
    expect(tables.campaignPlan.rows).toHaveLength(1);
  });

  it("applyRecommendation creates a fresh draft only for the draft kind; other kinds refuse with their real path", async () => {
    const { tables, svc } = setup();
    const out = await svc.applyRecommendation("org", "u1", "plan-1", { kind: "create_fresh_draft", adId: "ad-1" });
    expect(out.draftId).toBeTruthy();
    const draft = tables.campaignPlan.rows.find((p: any) => p.id === out.draftId);
    expect(draft.status).toBe("draft");
    expect(draft.name).toContain("Fresh Creative Draft");
    await expect(svc.applyRecommendation("org", "u1", "plan-1", { kind: "budget_shift_proposal" })).rejects.toThrow(/Live Budget Edit/);
  });
});

describe("CN7 guardrails", () => {
  it("lists plan-linked and org-wide rules with last firing evidence; other plans' rules excluded", async () => {
    const { svc } = setup();
    const out = await svc.planGuardrails("org", "plan-1");
    expect(out.linked.map((r: any) => r.id)).toEqual(["rule-1"]);
    expect(out.linked[0].lastRun.status).toBe("triggered");
    expect(out.linked[0].lastTriggeredAt).toBeTruthy();
    expect(out.orgWide.map((r: any) => r.id)).toEqual(["rule-2"]);
  });

  it("attach narrows a rule to the plan; detach returns it to org-wide", async () => {
    const { tables, svc } = setup();
    const after = await svc.attachGuardrail("org", "u1", "plan-1", "rule-2");
    expect(after.linked.map((r: any) => r.id).sort()).toEqual(["rule-1", "rule-2"]);
    expect(tables.automationRule.rows.find((r: any) => r.id === "rule-2").campaignPlanId).toBe("plan-1");
    const detached = await svc.detachGuardrail("org", "u1", "plan-1", "rule-2");
    expect(detached.orgWide.map((r: any) => r.id)).toEqual(["rule-2"]);
    await expect(svc.detachGuardrail("org", "u1", "plan-1", "rule-2")).rejects.toThrow();
  });
});
