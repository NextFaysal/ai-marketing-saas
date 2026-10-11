import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder CB5: real per-plan performance
 * (campaign-level rows only — ad-level rows would
 * double-count), winner promotion via the existing
 * A/B verdict, and the scheduled-launch scan.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v.in as any[]).includes(row[k]);
      if ("lte" in v || "not" in v) {
        if ("not" in v && v.not === null && row[k] === null) return false;
        if ("lte" in v && !(row[k] <= v.lte)) return false;
        return true;
      }
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
    findMany: async ({ where, take }: any = {}) => { const out = rows.filter((r) => matches(r, where ?? {})); return take ? out.slice(0, take) : out; },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
    updateMany: async ({ where, data }: any) => { let count = 0; for (const r of rows) if (matches(r, where ?? {})) { Object.assign(r, data); count++; } return { count }; },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
  };
}
function setup() {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "integration", "product", "aIUsageRecord", "dailyAdMetric", "attributionCredit", "touchpoint", "membership", "agentNotification", "campaignPlanComment", "auditLog"]) tables[n] = makeTable(n);
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
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", sourceType: "api", externalId: "act_1", name: "Main", currency: "BDT" });
  const svc = new CampaignsService(tables as any, { log: async () => undefined } as any, { getProvider: () => new DevTemplateProvider() } as any);
  return { tables, svc };
}
async function publishedPlan(svc: CampaignsService, tables: any) {
  const plan: any = await svc.createPlan("org", "u1", { name: "Live", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
  const adSet: any = await svc.addAdSet("org", plan.id, { name: "S", dailyBudget: "500", optimizationGoal: "LINK_CLICKS", pageId: "pg", countries: ["BD"] });
  await svc.addAd("org", plan.id, adSet.id, { name: "A", primaryText: "কিনুন এখনই দারুণ প্রোডাক্ট", linkUrl: "https://shop.example/x" });
  tables.campaignPlan.rows.find((r: any) => r.id === plan.id).status = "published";
  tables.campaignPlan.rows.find((r: any) => r.id === plan.id).externalCampaignId = "camp-900";
  tables.campaignAdSet.rows.find((r: any) => r.id === adSet.id).externalAdSetId = "set-900";
  return { plan, adSet };
}

describe("CB5 performance loop", () => {
  it("aggregates campaign-level rows only, with CPA/CTR and a per-adset join", async () => {
    const { svc, tables } = setup();
    const { plan } = await publishedPlan(svc, tables);
    const day = new Date("2026-10-10T00:00:00Z");
    tables.dailyAdMetric.rows.push(
      { id: "m1", organizationId: "org", campaignExternalId: "camp-900", adSetExternalId: "set-900", adExternalId: "", date: day, spendMinor: 20000n, impressions: 1000, clicks: 50, conversions: 0n, platformConversions: 4, reach: 800 },
      { id: "m2", organizationId: "org", campaignExternalId: "camp-900", adSetExternalId: "set-900", adExternalId: "ad-1", date: day, spendMinor: 99999n, impressions: 9999, clicks: 999, conversions: 0n, platformConversions: 99, reach: 1 },
    );
    const out = await svc.planPerformance("org", plan.id);
    expect(out.published).toBe(true);
    expect(out.totals?.spendMinor).toBe("20000");
    expect(out.totals?.cpaMinor).toBe("5000");
    expect(out.totals?.ctrPercent).toBe(5);
    expect(out.perAdSet[0].spendMinor).toBe("20000");
    expect(out.daily).toHaveLength(1);
  });

  it("an unpublished plan reports an honest empty performance", async () => {
    const { svc } = setup();
    const plan: any = await svc.createPlan("org", "u1", { name: "Draft", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
    const out = await svc.planPerformance("org", plan.id);
    expect(out.published).toBe(false);
    expect(out.totals).toBeNull();
  });

  it("promoteWinner duplicates the A/B winner once a verdict exists", async () => {
    const { svc, tables } = setup();
    const a = await publishedPlan(svc, tables);
    const b = await publishedPlan(svc, tables);
    const day = new Date("2026-10-10T00:00:00Z");
    for (const [plan, ext, spend, conv] of [[a.plan, "camp-900", 20000n, 4n], [b.plan, "camp-901", 20000n, 2n]] as const) {
      const row = tables.campaignPlan.rows.find((r: any) => r.id === (plan as any).id);
      row.abGroupId = "grp-1"; row.abVariant = ext === "camp-900" ? "A" : "B"; row.abMetric = "platform_cpa";
      row.externalCampaignId = ext; row.status = "published";
      tables.dailyAdMetric.rows.push({ id: `m-${ext}`, organizationId: "org", campaignExternalId: ext, adSetExternalId: "", adExternalId: "", date: day, spendMinor: spend, impressions: 100, clicks: 5, platformConversions: Number(conv), reach: 10 });
    }
    const draft: any = await svc.promoteWinner("org", a.plan.id, "u1");
    expect(draft.status).toBe("draft");
    expect(draft.name).toContain("বিজয়ী সংস্করণ");
  });

  it("scheduled launch: only approved plans; the scan claims, attempts once, and records failure honestly", async () => {
    const { svc, tables } = setup();
    const { plan } = await publishedPlan(svc, tables);
    const row = tables.campaignPlan.rows.find((r: any) => r.id === plan.id);
    row.status = "approved"; row.externalCampaignId = null;
    await expect(svc.scheduleLaunch("org", plan.id, "u1", new Date(Date.now() - 1000).toISOString())).rejects.toThrow(/future/);
    await svc.scheduleLaunch("org", plan.id, "u1", new Date(Date.now() + 3600_000).toISOString());
    expect(row.publishAt).toBeTruthy();
    row.publishAt = new Date(Date.now() - 1000); // due now
    const out = await svc.scanScheduledLaunches();
    // No Meta integration in the fake -> publish fails,
    // exactly one attempt, publishAt already claimed.
    expect(out.failed).toBe(1);
    expect(row.publishAt).toBeNull();
    const again = await svc.scanScheduledLaunches();
    expect(again.failed).toBe(0);
  });
});
