import { AudiencesService } from "./audiences.service";
import { CampaignsService } from "../campaigns/campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder Advanced CA7: per-audience performance
 * history. The rollup is computed from REAL DailyAdMetric
 * rows joined per ad set to the ONE audience that ad set
 * unambiguously used:
 *  - ad-set-level rows only (adExternalId "" — the
 *    planPerformance counting rule); per-ad rows never
 *    double-count;
 *  - a set naming 2+ audiences is AMBIGUOUS: excluded and
 *    counted in the coverage note, its spend attributed
 *    NOWHERE (never split or guessed);
 *  - a set naming an audience we do not own is UNKNOWN:
 *    excluded and counted;
 *  - audiences with no attributed set get NO row — the
 *    builder shows "তথ্য নেই", never a fabricated zero;
 *  - a rollup whose sets leave the window is visibly
 *    zeroed on the next refresh, not left stale;
 *  - suggestPlan facts carry the top audiences by CPA
 *    only past the stated minimums (≥ ৳500 attributed
 *    spend AND ≥ 1 conversion).
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
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
  };
}
const audit = { log: async () => undefined } as any;
const now = new Date();
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000);

function audienceSetup() {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "audienceRecord", "savedAudience", "dailyAdMetric", "audiencePerformanceRollup"]) tables[n] = makeTable(n);
  tables.campaignPlan.rows.push({ id: "p1", organizationId: "org", adAccountId: "acc-1" });
  tables.audienceRecord.rows.push(
    { id: "rec-1", organizationId: "org", adAccountId: "acc-1", name: "ক্রেতা", kind: "custom", externalAudienceId: "aud-1" },
    { id: "rec-2", organizationId: "org", adAccountId: "acc-1", name: "ভিজিটর", kind: "custom", externalAudienceId: "aud-2" },
  );
  tables.savedAudience.rows.push({ id: "sav-1", organizationId: "org", name: "ঢাকা সেভড", targeting: {} });
  tables.campaignAdSet.rows.push(
    { id: "s1", planId: "p1", externalAdSetId: "ext-s1", targeting: { customAudienceIds: ["aud-1"] } },
    { id: "s2", planId: "p1", externalAdSetId: "ext-s2", targeting: { customAudienceIds: ["aud-1", "aud-2"] } },
    { id: "s3", planId: "p1", externalAdSetId: "ext-s3", targeting: { customAudienceIds: ["aud-foreign"] } },
    { id: "s4", planId: "p1", externalAdSetId: "ext-s4", targeting: { savedAudienceId: "sav-1" } },
    { id: "s5", planId: "p1", externalAdSetId: null, targeting: { customAudienceIds: ["aud-1"] } },
    { id: "s6", planId: "p1", externalAdSetId: "ext-s6", targeting: { countries: ["BD"] } },
  );
  tables.dailyAdMetric.rows.push(
    { id: "m1", organizationId: "org", adSetExternalId: "ext-s1", adExternalId: "", spendMinor: 120000n, impressions: 10000, clicks: 250, platformConversions: 12, date: now },
    { id: "m2", organizationId: "org", adSetExternalId: "ext-s1", adExternalId: "ad-x", spendMinor: 999999n, impressions: 1, clicks: 1, platformConversions: 99, date: now },
    { id: "m3", organizationId: "org", adSetExternalId: "ext-s2", adExternalId: "", spendMinor: 500000n, impressions: 5000, clicks: 100, platformConversions: 50, date: now },
    { id: "m4", organizationId: "org", adSetExternalId: "ext-s4", adExternalId: "", spendMinor: 30000n, impressions: 3000, clicks: 60, platformConversions: 3, date: now },
    { id: "m5", organizationId: "org", adSetExternalId: "ext-s3", adExternalId: "", spendMinor: 70000n, impressions: 700, clicks: 7, platformConversions: 1, date: now },
    { id: "m6", organizationId: "org", adSetExternalId: "ext-s1", adExternalId: "", spendMinor: 80000n, impressions: 8000, clicks: 80, platformConversions: 8, date: daysAgo(200) },
  );
  const svc = new AudiencesService(tables as any, audit);
  return { tables, svc };
}

describe("CA7 rollup aggregation (AudiencesService)", () => {
  it("attributes only unambiguous ad sets; ambiguous and unknown spend lands NOWHERE", async () => {
    const { svc } = audienceSetup();
    const out = await svc.refreshPerformanceRollups("org");
    expect(out.coverage).toEqual({
      adSetsWithAudience: 4, adSetsCounted: 2,
      adSetsAmbiguousExcluded: 1, adSetsUnknownExcluded: 1, adSetsWithoutAudience: 1,
    });
    expect(out.items).toHaveLength(2);
    const rec = out.items.find((i: any) => i.audienceKey === "record:rec-1");
    expect(rec).toMatchObject({ name: "ক্রেতা", spend: 1200, impressions: 10000, clicks: 250, conversions: 12, cpa: 100, adSetsCounted: 1, windowDays: 90 });
    const sav = out.items.find((i: any) => i.audienceKey === "saved:sav-1");
    expect(sav).toMatchObject({ name: "ঢাকা সেভড", spend: 300, conversions: 3, cpa: 100, adSetsCounted: 1 });
    // rec-2 appears ONLY inside the ambiguous set -> no row at all.
    expect(out.items.some((i: any) => i.audienceKey === "record:rec-2")).toBe(false);
    // Attributed spend is ৳1500 of the ৳7200 in-window ad-set
    // spend — the ambiguous set's ৳5000 and the unknown set's
    // ৳700 are attributed NOWHERE, and the per-ad row (m2)
    // never double-counts.
    const total = out.items.reduce((a: number, i: any) => a + i.spend, 0);
    expect(total).toBe(1500);
  });

  it("a rollup whose sets leave the window is visibly zeroed on refresh, never left stale", async () => {
    const { svc, tables } = audienceSetup();
    await svc.refreshPerformanceRollups("org");
    tables.dailyAdMetric.rows.length = 0;
    tables.campaignAdSet.rows.find((s: any) => s.id === "s1").targeting = { countries: ["BD"] };
    tables.campaignAdSet.rows.find((s: any) => s.id === "s4").targeting = { countries: ["BD"] };
    const out = await svc.refreshPerformanceRollups("org");
    const rec = out.items.find((i: any) => i.audienceKey === "record:rec-1");
    expect(rec).toMatchObject({ spend: 0, conversions: 0, cpa: null, adSetsCounted: 0 });
  });

  it("an org with no data reads honestly empty", async () => {
    const tables: any = {};
    for (const n of ["campaignPlan", "campaignAdSet", "audienceRecord", "savedAudience", "dailyAdMetric", "audiencePerformanceRollup"]) tables[n] = makeTable(n);
    const svc = new AudiencesService(tables as any, audit);
    const out = await svc.listPerformance("org-empty");
    expect(out.items).toEqual([]);
    expect(out.refreshedAt).toBeNull();
  });
});

function campaignSetup() {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "integration", "product", "aIUsageRecord", "businessProfile", "dailyAdMetric", "audienceRecord", "audiencePerformanceRollup"]) tables[n] = makeTable(n);
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
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", sourceType: "api", externalId: "act_1", name: "Main", currency: "BDT" });
  tables.product.rows.push({ id: "prod-1", organizationId: "org", status: "ACTIVE", name: "Cotton Panjabi", priceMinor: 150000n, currency: "BDT", category: "clothing", description: "Comfortable" });
  tables.audienceRecord.rows.push(
    { id: "rec-1", organizationId: "org", adAccountId: "acc-1", name: "ক্রেতা", kind: "custom", status: "ready", externalAudienceId: "aud-1" },
    { id: "rec-9", organizationId: "org", adAccountId: "acc-1", name: "নতুন Audience", kind: "custom", status: "ready", externalAudienceId: "aud-9" },
  );
  tables.audiencePerformanceRollup.rows.push(
    { id: "roll-1", organizationId: "org", audienceKey: "record:rec-1", audienceKind: "custom", audienceRecordId: "rec-1", savedAudienceId: null, name: "ক্রেতা", adAccountId: "acc-1", spendMinor: 120000n, impressions: 10000, clicks: 250, conversions: 12, windowDays: 90, adSetsCounted: 1, computedAt: now },
    { id: "roll-2", organizationId: "org", audienceKey: "record:rec-2", audienceKind: "lookalike", audienceRecordId: "rec-2", savedAudienceId: null, name: "Lookalike", adAccountId: "acc-1", spendMinor: 60000n, impressions: 6000, clicks: 90, conversions: 2, windowDays: 90, adSetsCounted: 1, computedAt: now },
    { id: "roll-3", organizationId: "org", audienceKey: "record:rec-3", audienceKind: "custom", audienceRecordId: "rec-3", savedAudienceId: null, name: "ছোট ব্যয়", adAccountId: "acc-1", spendMinor: 40000n, impressions: 4000, clicks: 40, conversions: 8, windowDays: 90, adSetsCounted: 1, computedAt: now },
    { id: "roll-4", organizationId: "org", audienceKey: "record:rec-4", audienceKind: "custom", audienceRecordId: "rec-4", savedAudienceId: null, name: "শূন্য কনভার্সন", adAccountId: "acc-1", spendMinor: 90000n, impressions: 9000, clicks: 90, conversions: 0, windowDays: 90, adSetsCounted: 1, computedAt: now },
  );
  const audiencesStub: any = {
    sourceCatalog: async () => [],
    listPerformance: async () => ({ windowDays: 90, refreshedAt: now, coverage: { adSetsCounted: 2 }, items: [{ audienceKey: "record:rec-1" }] }),
  };
  const svc = new CampaignsService(tables as any, audit, { getProvider: () => new DevTemplateProvider() } as any, undefined, audiencesStub);
  return { tables, svc };
}

describe("CA7 surfaces (CampaignsService)", () => {
  it("the studio attaches the rollup per record; a record without one shows performance null (তথ্য নেই)", async () => {
    const { svc } = campaignSetup();
    const plan: any = await svc.createPlan("org", "u1", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
    const studio = await svc.audienceStudio("org", plan.id);
    const withPerf = studio.records.find((r: any) => r.id === "rec-1");
    expect(withPerf.performance).toMatchObject({ spend: 1200, conversions: 12, cpa: 100 });
    const noPerf = studio.records.find((r: any) => r.id === "rec-9");
    expect(noPerf.performance).toBeNull();
  });

  it("audience-sources carries the additive performance block", async () => {
    const { svc } = campaignSetup();
    const out = await svc.audienceSourceCatalog("org");
    expect(out.available).toBe(true);
    expect(out.performance).toMatchObject({ windowDays: 90 });
  });

  it("suggestPlan facts rank top audiences by CPA past the stated minimums only", async () => {
    const { svc } = campaignSetup();
    const out = await svc.suggestPlan("org", "u1", { adAccountId: "acc-1", productId: "prod-1", goal: "বিক্রি বাড়ানো", totalDailyBudget: "2000" });
    // roll-3 is below the ৳500 minimum spend; roll-4 has no
    // conversions. Neither may appear, at any rank.
    expect(out.facts.topAudiences.map((a: any) => a.name)).toEqual(["ক্রেতা", "Lookalike"]);
    expect(out.facts.topAudiences[0]).toMatchObject({ spend: 1200, conversions: 12, cpa: 100, windowDays: 90 });
    expect(out.facts.topAudiences[1].cpa).toBe(300);
  });
});
