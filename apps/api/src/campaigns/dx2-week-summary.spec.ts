import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Design+UX DX2 — the hub "এই সপ্তাহে" strip aggregate
 * (GET campaign-plans/week-summary). It exists because
 * none of its four numbers is reachable from the web in
 * one load: portfolio totals have no date window, CN7
 * recommendations + fatigue are per-plan endpoints, and
 * the offline loop's last success sits in the log list.
 * This spec pins the aggregation ONLY (the underlying
 * read-models have their own CN5/CN7/CN14 specs): rolling
 * 7d vs previous 7d spend from campaign-level rows with
 * currencies never mixed, recommendation + fatigue counts
 * reused from the per-plan services with the top plan
 * named for the strip's deep link, and the offline loop's
 * configured / last-success / failed-7d state. Nothing is
 * estimated; an org with no data gets honest zeros/nulls.
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
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where, take }: any = {}) => { const f = rows.filter((r) => matches(r, where ?? {})); return take ? f.slice(0, take) : f; },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
    updateMany: async ({ where, data }: any) => { let n = 0; for (const r of rows) if (matches(r, where ?? {})) { Object.assign(r, data); n++; } return { count: n }; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); rows.splice(i, 1); return {}; },
  };
}
const day = 86400000;
const daysAgo = (n: number) => new Date(Date.now() - n * day);

function setup() {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "campaignPlanComment", "adAccount", "integration", "product", "businessProfile", "aIUsageRecord", "dailyAdMetric", "dailyAdBreakdown", "audienceRecord", "socialAccount", "catalogRecord", "productSet", "leadForm", "customFieldDef", "conversionApiSetting", "conversionEventLog", "automationRule", "automationRun", "attributionCredit", "touchpoint", "crossPlatformDraft", "platformPublication", "organization", "competitor", "competitorAd", "competitorInsight", "reportShare", "user", "notification", "offlineConversionSetting", "offlineConversionLog"]) tables[n] = makeTable(n);
  tables.organization.rows.push({ id: "org", name: "Qosprey Fashion Ltd" });
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", externalId: "act_777", name: "Meta Main", currency: "BDT", integrationId: "int-1" });
  tables.adAccount.rows.push({ id: "acc-2", organizationId: "org", platform: "meta", externalId: "act_888", name: "Meta US", currency: "USD", integrationId: "int-1" });
  const audit = { log: async () => undefined } as any;
  const svc = new CampaignsService(tables as any, audit, { getProvider: () => new DevTemplateProvider() } as any, {} as any);
  return { tables, svc };
}

function seedSpend(tables: any) {
  const m = (r: any) => tables.dailyAdMetric.rows.push({ organizationId: "org", source: "meta", impressions: 0, clicks: 0, conversions: 0, platformConversions: 0, reach: 0, ...r });
  // Campaign-level rows (both external ids empty).
  m({ adAccountId: "acc-1", campaignExternalId: "camp-ext-1", adSetExternalId: "", adExternalId: "", date: daysAgo(3), spendMinor: 100000 }); // this week BDT
  m({ adAccountId: "acc-1", campaignExternalId: "camp-ext-1", adSetExternalId: "", adExternalId: "", date: daysAgo(10), spendMinor: 50000 }); // prev week BDT
  m({ adAccountId: "acc-1", campaignExternalId: "camp-ext-1", adSetExternalId: "", adExternalId: "", date: daysAgo(20), spendMinor: 999999 }); // outside both windows
  m({ adAccountId: "acc-2", campaignExternalId: "camp-ext-9", adSetExternalId: "", adExternalId: "", date: daysAgo(2), spendMinor: 2000 }); // this week USD
  // An ad-level row must never enter the campaign-level spend.
  m({ adAccountId: "acc-1", campaignExternalId: "camp-ext-1", adSetExternalId: "set-ext-1", adExternalId: "ad-ext-1", date: daysAgo(3), spendMinor: 777777 });
}

function seedPublishedPlan(tables: any) {
  tables.campaignPlan.rows.push({ id: "plan-1", organizationId: "org", adAccountId: "acc-1", name: "ঈদ সেল", objective: "OUTCOME_SALES", status: "published", externalCampaignId: "camp-ext-1", budgetMode: "abo", createdAt: daysAgo(30), updatedAt: daysAgo(1) });
  tables.campaignPlan.rows.push({ id: "plan-draft", organizationId: "org", adAccountId: "acc-1", name: "খসড়া", objective: "OUTCOME_SALES", status: "draft", externalCampaignId: null, budgetMode: "abo", createdAt: daysAgo(2), updatedAt: daysAgo(0) });
  tables.campaignAdSet.rows.push({ id: "set-1", planId: "plan-1", name: "Set A", externalAdSetId: "set-ext-1", dailyBudgetMinor: 100000, lifetimeBudgetMinor: null });
  tables.campaignAd.rows.push({ id: "ad-1", adSetId: "set-1", name: "Ad A", externalAdId: "ad-ext-1" });
  // Dead ad set: ৳600 spend, zero conversions (ad-set-level row).
  tables.dailyAdMetric.rows.push({ organizationId: "org", source: "meta", adAccountId: "acc-1", campaignExternalId: "camp-ext-1", adSetExternalId: "set-ext-1", adExternalId: "", date: daysAgo(3), spendMinor: 60000, impressions: 5000, clicks: 50, conversions: 0, platformConversions: 0, reach: 4000 });
  // Fatigued ad: frequency 7 in the current window, CTR 10% → 1%.
  tables.dailyAdMetric.rows.push({ organizationId: "org", source: "meta", adAccountId: "acc-1", campaignExternalId: "camp-ext-1", adSetExternalId: "set-ext-1", adExternalId: "ad-ext-1", date: daysAgo(3), spendMinor: 1000, impressions: 7000, clicks: 70, conversions: 0, platformConversions: 0, reach: 1000 });
  tables.dailyAdMetric.rows.push({ organizationId: "org", source: "meta", adAccountId: "acc-1", campaignExternalId: "camp-ext-1", adSetExternalId: "set-ext-1", adExternalId: "ad-ext-1", date: daysAgo(20), spendMinor: 900, impressions: 1000, clicks: 100, conversions: 0, platformConversions: 0, reach: 900 });
}

function seedOffline(tables: any) {
  tables.offlineConversionSetting.rows.push({ id: "ocs-1", organizationId: "org", platform: "meta", adAccountId: "acc-1", enabled: true, trigger: "delivered", datasetId: "ds-1", leadFeedbackEnabled: false });
  tables.offlineConversionLog.rows.push({ id: "log-1", organizationId: "org", platform: "meta", status: "sent", createdAt: daysAgo(2) });
  tables.offlineConversionLog.rows.push({ id: "log-2", organizationId: "org", platform: "meta", status: "failed", createdAt: daysAgo(1) });
  tables.offlineConversionLog.rows.push({ id: "log-3", organizationId: "org", platform: "google", status: "failed", createdAt: daysAgo(10) });
}

describe("DX2 weekSummary", () => {
  it("aggregates rolling 7d vs previous 7d spend per currency, campaign-level rows only", async () => {
    const { tables, svc } = setup();
    seedSpend(tables);
    const out = await svc.weekSummary("org");
    expect(out.windowDays).toBe(7);
    const bdt = out.spendByCurrency.find((c) => c.currency === "BDT");
    const usd = out.spendByCurrency.find((c) => c.currency === "USD");
    expect(bdt).toEqual({ currency: "BDT", thisWeekMinor: "100000", prevWeekMinor: "50000" });
    expect(usd).toEqual({ currency: "USD", thisWeekMinor: "2000", prevWeekMinor: "0" });
  });

  it("counts recommendations + fatigue from the per-plan read-models and names the top plan", async () => {
    const { tables, svc } = setup();
    seedSpend(tables); seedPublishedPlan(tables);
    const out = await svc.weekSummary("org");
    expect(out.recommendations.publishedPlans).toBe(1); // the draft (no external id) is not checked
    expect(out.recommendations.total).toBe(2); // fatigued creative + dead ad set
    expect(out.recommendations.topPlan).toEqual({ planId: "plan-1", name: "ঈদ সেল", count: 2 });
    expect(out.fatigue.total).toBe(1);
    expect(out.fatigue.topPlan).toEqual({ planId: "plan-1", name: "ঈদ সেল", count: 1 });
  });

  it("reports the offline loop state from the existing setting + log records", async () => {
    const { tables, svc } = setup();
    seedOffline(tables);
    const out = await svc.weekSummary("org");
    expect(out.offlineLoop.configured).toBe(true);
    expect(out.offlineLoop.lastSuccessPlatform).toBe("meta");
    expect(Math.abs(new Date(out.offlineLoop.lastSuccessAt as string).getTime() - daysAgo(2).getTime())).toBeLessThan(5000);
    expect(out.offlineLoop.failedLast7Days).toBe(1); // the 10-day-old failure is outside the window
  });

  it("is honestly empty for an org with no data", async () => {
    const { svc } = setup();
    const out = await svc.weekSummary("org");
    expect(out.spendByCurrency).toEqual([]);
    expect(out.recommendations).toEqual({ total: 0, plansChecked: 0, publishedPlans: 0, topPlan: null });
    expect(out.fatigue).toEqual({ total: 0, topPlan: null });
    expect(out.offlineLoop).toEqual({ configured: false, lastSuccessAt: null, lastSuccessPlatform: null, failedLast7Days: 0 });
  });
});
