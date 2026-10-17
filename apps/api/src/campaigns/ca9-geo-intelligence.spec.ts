import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";
import { encryptJson } from "../integrations/crypto";

/**
 * Campaign Builder Advanced CA9: geo intelligence.
 *  - (a) per-plan region performance aggregates the
 *    plan's STORED DailyAdBreakdown region rows (real
 *    rows only). Breakdown rows are CAMPAIGN-level — the
 *    payload says so; no per-ad-set geo claim is made.
 *    Regions under the stated minimum (2 stored rows)
 *    are withheld and counted, never merged into an
 *    invented "other".
 *  - BD division mapping matches only the name variants
 *    Meta is known to return for Bangladesh (both
 *    "Chittagong" and "Chattogram", "Barisal"/"Barishal"
 *    spellings included); an unmapped region keeps its
 *    raw name with division null — never guessed.
 *  - (b) the one-click draft copies the source ad set
 *    and targets the top regions by conversions, with
 *    each Meta region key RESOLVED through Meta's own
 *    targeting search (stubbed fetch here); an
 *    unresolvable region lands in notCarried, never in
 *    the targeting. Nothing is published.
 *  - (c) suggestPlan facts gain topRegions under the
 *    same minimums when breakdown rows exist.
 */
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");

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
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
  };
}
function setup() {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "integration", "product", "aIUsageRecord", "businessProfile", "dailyAdMetric", "dailyAdBreakdown", "audiencePerformanceRollup", "audienceRecord"]) tables[n] = makeTable(n);
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
  tables.businessProfile.findUnique = async () => ({ organizationId: "org", industry: "fashion retail", brandVoice: "friendly", websiteUrl: "https://shop.example" });
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", sourceType: "api", externalId: "act_777", name: "Main", currency: "BDT", integrationId: "int-meta" });
  tables.integration.rows.push({ id: "int-meta", organizationId: "org", provider: "meta", status: "CONNECTED", credential: { encryptedData: encryptJson({ accessToken: "tok-ads" }) } });
  tables.product.rows.push({ id: "prod-1", organizationId: "org", status: "ACTIVE", name: "Cotton Panjabi", priceMinor: 150000n, currency: "BDT", category: "clothing", description: "Comfortable" });
  const svc = new CampaignsService(tables as any, { log: async () => undefined } as any, { getProvider: () => new DevTemplateProvider() } as any);
  return { tables, svc };
}
let rowSeq = 0;
function brow(tables: any, key: string, spendMinor: bigint, conversions: number, campaign = "camp-1") {
  tables.dailyAdBreakdown.rows.push({
    id: `b-${++rowSeq}`, organizationId: "org", adAccountId: "acc-1", platform: "meta", source: "api",
    date: new Date(), dimension: "region", key, campaignExternalId: campaign,
    spendMinor, impressions: 1000, clicks: 50, platformConversions: conversions,
  });
}
function seedRegions(tables: any) {
  brow(tables, "Dhaka Division", 30000n, 4); brow(tables, "Dhaka Division", 30000n, 3); brow(tables, "Dhaka Division", 30000n, 3);
  brow(tables, "Chittagong Division", 30000n, 3); brow(tables, "Chittagong Division", 30000n, 3);
  brow(tables, "Khulna Division", 20000n, 2); brow(tables, "Khulna Division", 20000n, 2);
  brow(tables, "Sylhet", 10000n, 1); brow(tables, "Sylhet", 10000n, 1);
  brow(tables, "Atlantis", 5000n, 1); brow(tables, "Atlantis", 5000n, 0);
  brow(tables, "Nowhere Land", 90000n, 99);
}
async function publishedPlan(svc: CampaignsService, tables: any) {
  const plan: any = await svc.createPlan("org", "u1", { name: "Live", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
  const adSet: any = await svc.addAdSet("org", plan.id, { name: "Main Set", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg", pixelId: "px", countries: ["BD"] });
  // Flip to the published state only AFTER the draft-era
  // writes — the builder's own lifecycle order.
  const row = tables.campaignPlan.rows.find((p: any) => p.id === plan.id);
  row.status = "published";
  row.externalCampaignId = "camp-1";
  const srow = tables.campaignAdSet.rows.find((s: any) => s.id === adSet.id);
  srow.externalAdSetId = "ext-s1";
  return { plan, adSet };
}
const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

describe("CA9 geo intelligence", () => {
  it("aggregates stored region rows with BD mapping, threshold and honest campaign-level note", async () => {
    const { svc, tables } = setup();
    const { plan } = await publishedPlan(svc, tables);
    seedRegions(tables);
    const out = await svc.planRegionPerformance("org", plan.id);
    expect(out.available).toBe(true);
    expect(out.totalRows).toBe(12);
    expect(out.minRows).toBe(2);
    expect(out.rowsBelowThreshold).toBe(1); // "Nowhere Land": 99 conversions but ONE row — withheld.
    expect(out.note).toContain("Campaign-Level");
    const names = out.regions.map((r: any) => r.region);
    expect(names).toEqual(["Dhaka Division", "Chittagong Division", "Khulna Division", "Sylhet", "Atlantis"]);
    const dhaka = out.regions[0];
    expect(dhaka).toMatchObject({ division: "dhaka", divisionLabel: "ঢাকা বিভাগ", spend: 900, conversions: 10, cpa: 90, rows: 3 });
    expect(out.regions[1].divisionLabel).toBe("চট্টগ্রাম বিভাগ"); // old "Chittagong" spelling maps too
    expect(out.regions[3].divisionLabel).toBe("সিলেট বিভাগ"); // bare name maps
    const atlantis = out.regions.find((r: any) => r.region === "Atlantis");
    expect(atlantis.division).toBeNull();
    expect(atlantis.divisionLabel).toBeNull(); // unmapped stays raw, never guessed
  });

  it("an unpublished plan reports honestly unavailable", async () => {
    const { svc } = setup();
    const plan: any = await svc.createPlan("org", "u1", { name: "Draft", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
    const out = await svc.planRegionPerformance("org", plan.id);
    expect(out.available).toBe(false);
    expect(out.regions).toEqual([]);
  });

  it("bdDivisionOf covers both spellings and refuses near-misses", () => {
    expect(CampaignsService.bdDivisionOf("Chattogram Division")?.division).toBe("chattogram");
    expect(CampaignsService.bdDivisionOf("Barishal")?.division).toBe("barishal");
    expect(CampaignsService.bdDivisionOf("  Dhaka   Division ")?.division).toBe("dhaka");
    expect(CampaignsService.bdDivisionOf("Dhaka City")).toBeNull();
    expect(CampaignsService.bdDivisionOf("")).toBeNull();
  });

  it("one-click draft: copies the source set, targets resolved top regions, unresolvable lands in notCarried", async () => {
    const { svc, tables } = setup();
    const { plan, adSet } = await publishedPlan(svc, tables);
    seedRegions(tables);
    global.fetch = (async (url: string) => {
      const q = new URL(String(url)).searchParams.get("q") ?? "";
      const data = q === "Dhaka Division" ? [{ id: "111", name: "Dhaka Division", type: "region" }]
        : q === "Chittagong Division" ? [{ id: "222", name: "Chittagong Division", type: "region" }]
        : [];
      return { ok: true, status: 200, json: async () => ({ data }) };
    }) as any;
    const out = await svc.createRegionAdSetDraft("org", "u1", plan.id, { sourceAdSetId: adSet.id });
    expect(out.regions).toEqual([
      { key: "111", name: "Dhaka Division" },
      { key: "222", name: "Chittagong Division" },
    ]);
    expect(out.notCarried.some((n: string) => n.includes("Khulna Division"))).toBe(true);
    const created = tables.campaignAdSet.rows.find((s: any) => s.id === out.adSet.id);
    expect(created.externalAdSetId ?? null).toBeNull(); // a local draft — nothing sent to Meta
    expect(created.targeting.regions).toEqual(out.regions);
    expect(created.targeting.countries).toEqual(["BD"]); // source settings copied
    expect(String(created.dailyBudgetMinor)).toBe("50000");
    expect(created.name).toContain("শীর্ষ Region");
    // The stored regions flow into the Graph targeting shape.
    const graph = (svc as any).toGraphTargeting(created.targeting);
    expect(graph.geo_locations.regions).toEqual([{ key: "111" }, { key: "222" }]);
  });

  it("no conversions in any region -> the draft refuses honestly", async () => {
    const { svc, tables } = setup();
    const { plan, adSet } = await publishedPlan(svc, tables);
    brow(tables, "Dhaka Division", 30000n, 0); brow(tables, "Dhaka Division", 30000n, 0);
    await expect(svc.createRegionAdSetDraft("org", "u1", plan.id, { sourceAdSetId: adSet.id })).rejects.toThrow(/কনভার্সন নেই/);
  });

  it("suggestPlan facts gain topRegions under the same minimums; empty without rows", async () => {
    const { svc, tables } = setup();
    seedRegions(tables);
    const out = await svc.suggestPlan("org", "u1", { adAccountId: "acc-1", productId: "prod-1", goal: "বিক্রি", totalDailyBudget: "2000" });
    expect(out.facts.topRegions.map((r: any) => r.region)).toEqual(["Dhaka Division", "Chittagong Division", "Khulna Division"]);
    expect(out.facts.topRegions[0]).toMatchObject({ divisionLabel: "ঢাকা বিভাগ", conversions: 10 });
    const fresh = setup();
    const out2 = await fresh.svc.suggestPlan("org", "u1", { adAccountId: "acc-1", productId: "prod-1", goal: "বিক্রি", totalDailyBudget: "2000" });
    expect(out2.facts.topRegions).toEqual([]);
  });
});
