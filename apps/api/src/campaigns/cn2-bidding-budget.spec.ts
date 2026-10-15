import { CampaignsService } from "./campaigns.service";
import { encryptJson } from "../integrations/crypto";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

/**
 * Campaign Builder Next CN2: bidding & budget v2 — the
 * per-objective bid support matrix (refusals with reasons),
 * stored bid columns + Graph mapping, TRUE campaign
 * budget (budgetMode abo|cbo for every plan, Advantage+
 * unchanged), the publish payload shape for both modes,
 * and the pacing read-model over real metric rows.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if (k === "adSet") return matches(row.__adSet ?? {}, v);
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
    updateMany: async ({ where, data }: any) => { let n = 0; for (const r of rows) if (matches(r, where)) { Object.assign(r, data); n++; } return { count: n }; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); rows.splice(i, 1); return {}; },
  };
}
function setup(withIntegration = false) {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "integration", "product", "dailyAdMetric"]) tables[n] = makeTable(n);
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", sourceType: "api", externalId: "act_777", name: "Main", currency: "BDT", platformStatusBucket: "active", integrationId: withIntegration ? "int-1" : null });
  if (withIntegration) {
    tables.integration.rows.push({ id: "int-1", organizationId: "org", provider: "meta", status: "CONNECTED", credential: { encryptedData: encryptJson({ accessToken: "tok-123" }) } });
  }
  const svc = new CampaignsService(tables as any, { log: async () => undefined } as any, { getProvider: () => new DevTemplateProvider() } as any);
  return { tables, svc };
}
function metaFetch() {
  const calls: { url: string; params: URLSearchParams }[] = [];
  const fetchFn = async (url: string, init: any) => {
    calls.push({ url, params: new URLSearchParams(String(init?.body ?? "")) });
    if (url.includes("/campaigns")) return { ok: true, status: 200, json: async () => ({ id: "camp-100" }) };
    if (url.includes("/adsets")) return { ok: true, status: 200, json: async () => ({ id: "adset-100" }) };
    if (url.includes("/ads")) return { ok: true, status: 200, json: async () => ({ id: "ad-100" }) };
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  };
  return { fetchFn, calls };
}
const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

async function approvedPlan(svc: CampaignsService, planDto: any, adSetDto: any) {
  const plan: any = await svc.createPlan("org", "creator", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1", ...planDto });
  const adSet: any = await svc.addAdSet("org", plan.id, { name: "S1", pageId: "pg", countries: ["BD"], ...adSetDto });
  await svc.addAd("org", plan.id, adSet.id, { name: "A1", primaryText: "ভালো প্রোডাক্ট কিনুন এখনই", linkUrl: "https://shop.example/x" });
  await svc.submitForApproval("org", "creator", plan.id);
  await svc.approve("org", "owner", plan.id);
  return { plan, adSet };
}

describe("CN2 bid support matrix", () => {
  it("bid_cap stores + maps; REACH and missing amount are refused with reasons", async () => {
    const { svc } = setup();
    const plan: any = await svc.createPlan("org", "u", { name: "P", objective: "OUTCOME_TRAFFIC", adAccountId: "acc-1" });
    const s: any = await svc.addAdSet("org", plan.id, { name: "S", dailyBudget: "500", optimizationGoal: "LINK_CLICKS", pageId: "pg", countries: ["BD"], bidStrategy: "bid_cap", bidAmount: "50" });
    expect(s.bidStrategy).toBe("bid_cap");
    expect(s.bidAmountMinor).toBe("5000");
    expect((svc as any).bidGraphFields(s)).toEqual({ bidStrategy: "LOWEST_COST_WITH_BID_CAP", bidAmountMinor: "5000" });
    await expect(svc.addAdSet("org", plan.id, { name: "S2", dailyBudget: "500", optimizationGoal: "REACH", pageId: "pg", countries: ["BD"], bidStrategy: "bid_cap", bidAmount: "50" })).rejects.toThrow(/REACH/);
    await expect(svc.addAdSet("org", plan.id, { name: "S3", dailyBudget: "500", optimizationGoal: "LINK_CLICKS", pageId: "pg", countries: ["BD"], bidStrategy: "bid_cap" })).rejects.toThrow(/bidAmount/);
    await expect(svc.addAdSet("org", plan.id, { name: "S4", dailyBudget: "500", optimizationGoal: "LINK_CLICKS", pageId: "pg", countries: ["BD"], bidStrategy: "moon" as any })).rejects.toThrow(/not supported/);
  });

  it("cost_cap needs a result goal; roas_goal needs Sales + VALUE + pixel and stores ROAS x 10000", async () => {
    const { svc } = setup();
    const plan: any = await svc.createPlan("org", "u", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
    await expect(svc.addAdSet("org", plan.id, { name: "S", dailyBudget: "500", optimizationGoal: "LINK_CLICKS", pageId: "pg", countries: ["BD"], bidStrategy: "cost_cap", costPerResultGoal: "300" })).rejects.toThrow(/result-based/);
    const s: any = await svc.addAdSet("org", plan.id, { name: "S", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg", pixelId: "px", countries: ["BD"], bidStrategy: "cost_cap", costPerResultGoal: "300" });
    expect(s.costGoalMinor).toBe("30000");
    expect((svc as any).bidGraphFields(s)).toEqual({ bidStrategy: "COST_CAP", bidAmountMinor: "30000" });

    await expect(svc.addAdSet("org", plan.id, { name: "S2", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg", pixelId: "px", countries: ["BD"], bidStrategy: "roas_goal", roasGoal: "2.0" })).rejects.toThrow(/VALUE/);
    const r: any = await svc.addAdSet("org", plan.id, { name: "S3", dailyBudget: "500", optimizationGoal: "VALUE", pageId: "pg", pixelId: "px", countries: ["BD"], bidStrategy: "roas_goal", roasGoal: "2.0" });
    expect(r.roasAverageFloor).toBe(20000);
    expect((svc as any).bidGraphFields(r)).toEqual({ bidStrategy: "LOWEST_COST_WITH_MIN_ROAS", bidConstraints: { roas_average_floor: 20000 } });

    const traffic: any = await svc.createPlan("org", "u", { name: "T", objective: "OUTCOME_TRAFFIC", adAccountId: "acc-1" });
    await expect(svc.addAdSet("org", traffic.id, { name: "S", dailyBudget: "500", optimizationGoal: "VALUE", pageId: "pg", pixelId: "px", countries: ["BD"], bidStrategy: "roas_goal", roasGoal: "2.0" })).rejects.toThrow(/Sales/);
    // lowest_cost with a stray amount is a contradiction — refused, not silently dropped.
    await expect(svc.addAdSet("org", plan.id, { name: "S4", dailyBudget: "500", optimizationGoal: "LINK_CLICKS", pageId: "pg", countries: ["BD"], bidAmount: "10" })).rejects.toThrow(/lowest_cost takes no/);
    // lowest_cost itself maps to NO fields (Meta's own default).
    expect((svc as any).bidGraphFields({ bidStrategy: null })).toEqual({});
  });

  it("switching strategy on PATCH replaces the bid group wholesale; amount-only edits layer", async () => {
    const { svc } = setup();
    const plan: any = await svc.createPlan("org", "u", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
    const s: any = await svc.addAdSet("org", plan.id, { name: "S", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg", pixelId: "px", countries: ["BD"], bidStrategy: "bid_cap", bidAmount: "50" });
    const layered: any = await svc.updateAdSet("org", plan.id, s.id, "u", { bidAmount: "75" });
    expect(layered.bidStrategy).toBe("bid_cap");
    expect(layered.bidAmountMinor).toBe("7500");
    const switched: any = await svc.updateAdSet("org", plan.id, s.id, "u", { bidStrategy: "cost_cap", costPerResultGoal: "300" });
    expect(switched.bidStrategy).toBe("cost_cap");
    expect(switched.bidAmountMinor).toBeNull(); // wholesale: the old cap is gone
    expect(switched.costGoalMinor).toBe("30000");
    const cleared: any = await svc.updateAdSet("org", plan.id, s.id, "u", { bidStrategy: "lowest_cost" });
    expect(cleared.bidStrategy).toBeNull();
    expect(cleared.costGoalMinor).toBeNull();
  });
});

describe("CN2 true campaign budget (CBO/ABO)", () => {
  it("a CBO plan validates + publishes with the budget on the campaign and none on the ad set", async () => {
    const { svc, tables } = setup(true);
    const { plan } = await approvedPlan(svc, { budgetMode: "cbo", campaignDailyBudget: "2000" }, { optimizationGoal: "LINK_CLICKS" });
    const full = await svc.getPlan("org", plan.id);
    expect(full.budgetMode).toBe("cbo");
    expect(full.campaignDailyBudgetMinor).toBe("200000");
    const totals = svc.budgetTotals(full);
    expect(totals.budgetMode).toBe("cbo");
    expect(totals.effectiveDailyMinor).toBe("200000");
    // The submission snapshot froze the budget structure.
    const diff = await svc.submissionDiff("org", plan.id);
    expect(diff.snapshot.budgetMode).toBe("cbo");
    expect(diff.snapshot.campaignDailyBudgetMinor).toBe("200000");
    expect(diff.differs).toBe(false);

    const { fetchFn, calls } = metaFetch();
    (global as any).fetch = fetchFn;
    const published = await svc.publish("org", "owner", plan.id);
    expect(published.status).toBe("published");
    const camp = calls.find((c) => c.url.includes("/campaigns"))!;
    expect(camp.params.get("daily_budget")).toBe("200000");
    expect(camp.params.get("status")).toBe("PAUSED");
    const set = calls.find((c) => c.url.includes("/adsets"))!;
    expect(set.params.get("daily_budget")).toBeNull();
    expect(set.params.get("lifetime_budget")).toBeNull();
    expect(tables.campaignPublishLog.rows.some((l: any) => l.step === "campaign_budget" && l.status === "success")).toBe(true);
    // A live per-ad-set budget edit is meaningless under CBO — refused with the reason.
    await expect(svc.updateAdSetBudget("org", "owner", plan.id, published.adSets[0].id, { dailyBudget: "100" })).rejects.toThrow(/campaign-level budget \(CBO\)/);
  });

  it("a CBO plan WITHOUT a campaign budget cannot be submitted; an ABO publish is unchanged", async () => {
    const { svc } = setup(true);
    const plan: any = await svc.createPlan("org", "u", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1", budgetMode: "cbo" });
    const s: any = await svc.addAdSet("org", plan.id, { name: "S", optimizationGoal: "LINK_CLICKS", pageId: "pg", countries: ["BD"] });
    await svc.addAd("org", plan.id, s.id, { name: "A", primaryText: "ভালো প্রোডাক্ট কিনুন এখনই", linkUrl: "https://shop.example/x" });
    await expect(svc.submitForApproval("org", "u", plan.id)).rejects.toThrow(/Campaign budget \(CBO\)/);
    // Give it the budget via PATCH and the same plan submits.
    await svc.updatePlan("org", plan.id, { campaignDailyBudget: "1000" });
    const submitted = await svc.submitForApproval("org", "u", plan.id);
    expect(submitted.status).toBe("pending_approval");

    const { plan: abo } = await approvedPlan(svc, {}, { optimizationGoal: "OFFSITE_CONVERSIONS", dailyBudget: "500", pixelId: "px", bidStrategy: "bid_cap", bidAmount: "50" });
    const { fetchFn, calls } = metaFetch();
    (global as any).fetch = fetchFn;
    await svc.publish("org", "owner", abo.id);
    const camp = calls.find((c) => c.url.includes("/campaigns"))!;
    expect(camp.params.get("daily_budget")).toBeNull(); // ABO: no campaign budget
    const set = calls.find((c) => c.url.includes("/adsets"))!;
    expect(set.params.get("daily_budget")).toBe("50000");
    expect(set.params.get("bid_strategy")).toBe("LOWEST_COST_WITH_BID_CAP");
    expect(set.params.get("bid_amount")).toBe("5000");
  });

  it("Advantage+ still publishes as before: budget moves to the campaign from the first ad set", async () => {
    const { svc } = setup(true);
    // Advantage+ is toggled on the DRAFT (before submit) —
    // the CB4 snapshot then freezes it, as designed.
    const plan: any = await svc.createPlan("org", "creator", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
    const adSet: any = await svc.addAdSet("org", plan.id, { name: "S1", pageId: "pg", countries: ["BD"], optimizationGoal: "OFFSITE_CONVERSIONS", dailyBudget: "500", pixelId: "px" });
    await svc.addAd("org", plan.id, adSet.id, { name: "A1", primaryText: "ভালো প্রোডাক্ট কিনুন এখনই", linkUrl: "https://shop.example/x" });
    await svc.setAdvantagePlus("org", "creator", plan.id, true);
    await svc.submitForApproval("org", "creator", plan.id);
    await svc.approve("org", "owner", plan.id);
    const { fetchFn, calls } = metaFetch();
    (global as any).fetch = fetchFn;
    const published = await svc.publish("org", "owner", plan.id);
    expect(published.status).toBe("published");
    const camp = calls.find((c) => c.url.includes("/campaigns"))!;
    expect(camp.params.get("daily_budget")).toBe("50000");
    const set = calls.find((c) => c.url.includes("/adsets"))!;
    expect(set.params.get("daily_budget")).toBeNull();
  });
});

describe("CN2 pacing read-model", () => {
  it("computes spent vs expected from campaign-level rows only; ad-level rows never count", async () => {
    const { svc, tables } = setup();
    const day = 86_400_000;
    const start = new Date(Date.now() - 9 * day);
    const end = new Date(Date.now() + 10 * day);
    tables.campaignPlan.rows.push({ id: "plan-x", organizationId: "org", adAccountId: "acc-1", name: "Live", objective: "OUTCOME_SALES", status: "published", externalCampaignId: "camp-9", budgetMode: "abo", createdById: "u", publishedAt: start });
    tables.campaignAdSet.rows.push({ id: "set-x", planId: "plan-x", name: "S", lifetimeBudgetMinor: 1000000n, dailyBudgetMinor: null, optimizationGoal: "LINK_CLICKS", targeting: { countries: ["BD"] }, startTime: start, endTime: end });
    tables.dailyAdMetric.rows.push(
      { id: "m1", organizationId: "org", campaignExternalId: "camp-9", adSetExternalId: "", adExternalId: "", date: start, spendMinor: 250000n },
      { id: "m2", organizationId: "org", campaignExternalId: "camp-9", adSetExternalId: "", adExternalId: "", date: new Date(), spendMinor: 150000n },
      { id: "m3", organizationId: "org", campaignExternalId: "camp-9", adSetExternalId: "set-ext", adExternalId: "", date: new Date(), spendMinor: 99900n },
      { id: "m4", organizationId: "org", campaignExternalId: "camp-9", adSetExternalId: "", adExternalId: "ad-ext", date: new Date(), spendMinor: 88800n },
    );
    const out = await svc.planPacing("org", "plan-x");
    expect(out.status).toBe("ok");
    expect(out.label).toBe("computed_from_daily_ad_metric");
    expect(out.spentMinor).toBe("400000"); // m1+m2 only
    expect(out.daysElapsed).toBe(10);
    expect(out.daysTotal).toBe(20);
    expect(out.expectedMinor).toBe("500000"); // lifetime 1,000,000 x 10/20
    expect(out.varianceMinor).toBe("-100000");
    expect(out.metricRows).toBe(2);
  });

  it("no metric rows is an honest no_data; an unpublished plan says so", async () => {
    const { svc, tables } = setup();
    tables.campaignPlan.rows.push({ id: "plan-y", organizationId: "org", adAccountId: "acc-1", name: "Live2", objective: "OUTCOME_SALES", status: "published", externalCampaignId: "camp-10", budgetMode: "abo", createdById: "u" });
    const out = await svc.planPacing("org", "plan-y");
    expect(out.status).toBe("no_data");
    expect(out.spentMinor).toBe("0");
    expect(out.expectedMinor).toBeNull();
    const draft: any = await svc.createPlan("org", "u", { name: "D", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
    const out2 = await svc.planPacing("org", draft.id);
    expect(out2.published).toBe(false);
    expect(out2.status).toBe("not_published");
  });
});
