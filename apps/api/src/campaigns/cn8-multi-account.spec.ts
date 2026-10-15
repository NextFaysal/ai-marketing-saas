import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder Next CN8: cross-account clone with a
 * mapping report (verified / user-confirmed / dropped —
 * nothing silently carried), account health, and portfolio
 * totals that never mix currencies.
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
function setup() {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "integration", "product", "dailyAdMetric", "dailyAdBreakdown", "audienceRecord", "socialAccount", "catalogRecord", "productSet", "leadForm", "customFieldDef", "conversionApiSetting", "conversionEventLog", "automationRule", "automationRun", "attributionCredit", "touchpoint", "crossPlatformDraft", "platformPublication"]) tables[n] = makeTable(n);
  tables.adAccount.rows.push(
    { id: "acc-1", organizationId: "org", platform: "meta", externalId: "act_777", name: "Source", currency: "BDT", platformStatusBucket: "active", integrationId: "int-1" },
    { id: "acc-2", organizationId: "org", platform: "meta", externalId: "act_888", name: "Target", currency: "BDT", platformStatusBucket: null, integrationId: "int-2" },
    { id: "acc-3", organizationId: "org", platform: "google", externalId: "g-1", name: "Google Acc", currency: "BDT", integrationId: "int-3" },
  );
  tables.socialAccount.rows.push({ id: "sa-1", organizationId: "org", platform: "meta_page", externalId: "page-1", name: "Shop Page", status: "connected", createdById: "u1" });
  tables.campaignPlan.rows.push({ id: "plan-1", organizationId: "org", adAccountId: "acc-1", name: "Eid Sale", objective: "OUTCOME_SALES", status: "published", externalCampaignId: "camp-1", budgetMode: "abo", createdById: "u1" });
  tables.campaignAdSet.rows.push(
    { id: "set-1", planId: "plan-1", name: "Main Set", dailyBudgetMinor: 50000n, billingEvent: "IMPRESSIONS", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "page-1", pixelId: "px-1", targeting: { countries: ["BD"], customAudienceIds: ["aud-old"], excludedAudienceIds: [] } },
    { id: "set-2", planId: "plan-1", name: "Catalog Set", dailyBudgetMinor: 30000n, billingEvent: "IMPRESSIONS", optimizationGoal: "OFFSITE_CONVERSIONS", targeting: { countries: ["BD"] }, catalogRecordId: "cat-1", productSetId: "pset-1" },
  );
  tables.campaignAd.rows.push({ id: "ad-1", adSetId: "set-1", name: "Ad One", primaryText: "x", linkUrl: "https://x.com", callToAction: "SHOP_NOW", format: "link" });
  tables.catalogRecord.rows.push({ id: "cat-1", organizationId: "org", name: "Shop Catalog", externalCatalogId: "cat-ext", status: "connected" });
  tables.productSet.rows.push({ id: "pset-1", catalogRecordId: "cat-1", name: "All Products", externalSetId: "set-ext", status: "created" });
  // Target account has a READY replacement audience, not the source one.
  tables.audienceRecord.rows.push({ id: "ar-1", organizationId: "org", adAccountId: "acc-2", name: "Buyers (target)", kind: "custom", source: "customers", externalAudienceId: "aud-new", status: "ready", createdById: "u1" });
  const audit = { log: async () => undefined } as any;
  const svc = new CampaignsService(tables as any, audit, { getProvider: () => new DevTemplateProvider() } as any);
  return { tables, svc };
}

describe("CN8 cross-account clone", () => {
  it("carries only verified ids; the rest drop as blockers and the clone is a draft in the target account", async () => {
    const { tables, svc } = setup();
    const out = await svc.clonePlanToAccount("org", "u1", "plan-1", { targetAdAccountId: "acc-2" });
    expect(out.plan.adAccountId).toBe("acc-2");
    expect(out.plan.status).toBe("draft");
    const [s1, s2] = out.plan.adSets;
    expect(s1.pageId).toBe("page-1"); // verified via connected SocialAccount page
    expect(s1.pixelId ?? null).toBeNull(); // unverifiable in target -> dropped
    expect(s1.targeting.customAudienceIds).toEqual([]); // aud-old not ready in target -> dropped
    expect(s2.catalogRecordId ?? null).toBeNull();
    const outcomes = out.mapping.map((m: any) => `${m.field}:${m.outcome}`);
    expect(outcomes).toEqual(expect.arrayContaining(["pageId:carried_verified", "pixelId:dropped_blocker", "customAudienceIds:dropped_blocker", "catalog:dropped_blocker"]));
    expect(out.blockers.length).toBeGreaterThanOrEqual(3);
    expect(tables.campaignPlan.rows.filter((p: any) => p.adAccountId === "acc-2")).toHaveLength(1);
  });

  it("resolutions carry as user_confirmed (pixel + audience replacement + catalog re-pick)", async () => {
    const { svc } = setup();
    const out = await svc.clonePlanToAccount("org", "u1", "plan-1", {
      targetAdAccountId: "acc-2",
      resolutions: { pixelId: "px-2", audienceReplacements: { "aud-old": "aud-new" }, catalogRecordId: "cat-1", productSetId: "pset-1" },
    });
    const [s1, s2] = out.plan.adSets;
    expect(s1.pixelId).toBe("px-2");
    expect(s1.targeting.customAudienceIds).toEqual(["aud-new"]);
    expect(s2.catalogRecordId).toBe("cat-1");
    expect(s2.productSetId).toBe("pset-1");
    expect(out.blockers).toEqual([]);
    expect(out.mapping.every((m: any) => m.outcome !== "dropped_blocker")).toBe(true);
  });

  it("refuses same-account and non-Meta targets", async () => {
    const { svc } = setup();
    await expect(svc.clonePlanToAccount("org", "u1", "plan-1", { targetAdAccountId: "acc-1" })).rejects.toThrow(/Duplicate/);
    await expect(svc.clonePlanToAccount("org", "u1", "plan-1", { targetAdAccountId: "acc-3" })).rejects.toThrow(/Meta/);
  });

  it("a replacement audience that is not ready in the target is still a blocker", async () => {
    const { svc } = setup();
    const out = await svc.clonePlanToAccount("org", "u1", "plan-1", {
      targetAdAccountId: "acc-2",
      resolutions: { audienceReplacements: { "aud-old": "aud-missing" } },
    });
    const [s1] = out.plan.adSets;
    expect(s1.targeting.customAudienceIds).toEqual([]);
    expect(out.mapping.some((m: any) => m.field === "customAudienceIds" && m.outcome === "dropped_blocker")).toBe(true);
  });
});

describe("CN8 account health + portfolio", () => {
  it("health reports unknown bucket as unknown, never active", async () => {
    const { svc } = setup();
    const out = await svc.accountsHealth("org");
    const target = out.find((a: any) => a.id === "acc-2")!;
    expect(target.health.platformStatusBucket).toBe("unknown");
    expect(target.health.connection).toBe("api");
    const source = out.find((a: any) => a.id === "acc-1")!;
    expect(source.health.platformStatusBucket).toBe("active");
  });

  it("portfolio totals use campaign-level rows only, per account and per currency", async () => {
    const { tables, svc } = setup();
    const now = new Date();
    tables.dailyAdMetric.rows.push(
      { organizationId: "org", adAccountId: "acc-1", campaignExternalId: "camp-1", adSetExternalId: "", adExternalId: "", spendMinor: 100000n, impressions: 1000, clicks: 50, platformConversions: 5, date: now, source: "meta" },
      { organizationId: "org", adAccountId: "acc-2", campaignExternalId: "camp-9", adSetExternalId: "", adExternalId: "", spendMinor: 200000n, impressions: 2000, clicks: 80, platformConversions: 8, date: now, source: "meta" },
      { organizationId: "org", adAccountId: "acc-2", campaignExternalId: "camp-9", adSetExternalId: "s", adExternalId: "a", spendMinor: 999999n, impressions: 1, clicks: 1, platformConversions: 99, date: now, source: "meta" },
    );
    const out = await svc.portfolioTotals("org");
    expect(out.accounts[0].adAccountId).toBe("acc-2");
    expect(out.accounts[0].spendMinor).toBe("200000"); // ad-level row ignored
    expect(out.totalByCurrency).toEqual([{ currency: "BDT", spendMinor: "300000", impressions: 3000, clicks: 130, conversions: 13 }]);
  });
});
