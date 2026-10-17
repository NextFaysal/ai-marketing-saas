import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder Advanced CA6: deterministic audience
 * conflict warnings + the overlap spike verdict.
 *  - the same included audience on 2+ ad sets of one plan
 *    is a readiness warning naming the audience (resolved
 *    against OUR AudienceRecords) and the ad sets;
 *  - an audience that is BOTH included and excluded (or
 *    excluded via an applied preset) is a validatePlan
 *    structural ERROR — it never reaches publish as-is;
 *  - a prospecting ad set with no exclusion at all warns
 *    and points at the exclusion presets; retargeting
 *    layers and warm (custom-audience) sets never draw it;
 *  - overlap stays not_computable, now with the CA6 spike
 *    verdict: Meta's Graph API documents NO overlap edge
 *    on the Custom Audience node (checked 2026-10-17) —
 *    overlap exists only in the Ads Manager UI tool.
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
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "integration", "product", "audienceRecord"]) tables[n] = makeTable(n);
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
  tables.audienceRecord.rows.push(
    { id: "rec-1", organizationId: "org", adAccountId: "acc-1", name: "ক্রেতা তালিকা", kind: "custom", externalAudienceId: "aud-1", status: "ready" },
    { id: "rec-2", organizationId: "org", adAccountId: "acc-1", name: "ক্রেতা Lookalike 1%", kind: "lookalike", externalAudienceId: "aud-lal", status: "ready" },
  );
  const svc = new CampaignsService(tables as any, { log: async () => undefined } as any, { getProvider: () => new DevTemplateProvider() } as any);
  return { tables, svc };
}
async function planWithSets(svc: CampaignsService, tables: any, targetings: any[]) {
  const plan: any = await svc.createPlan("org", "u1", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
  const sets: any[] = [];
  for (let i = 0; i < targetings.length; i++) {
    const adSet: any = await svc.addAdSet("org", plan.id, { name: `S${i + 1}`, dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg", pixelId: "px", countries: ["BD"] });
    await svc.addAd("org", plan.id, adSet.id, { name: `A${i + 1}`, primaryText: "ভালো প্রোডাক্ট কিনুন এখনই", linkUrl: "https://shop.example/x" });
    const row = tables.campaignAdSet.rows.find((s: any) => s.id === adSet.id);
    row.targeting = { ...(row.targeting ?? {}), ...targetings[i] };
    if (targetings[i].__layer) { row.funnelLayer = targetings[i].__layer; }
    sets.push(adSet);
  }
  return { plan, sets };
}
const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

describe("CA6 audience conflicts", () => {
  it("the same audience on two ad sets is a readiness warning naming the audience and both sets", async () => {
    global.fetch = (async () => ({ status: 200 })) as any;
    const { svc, tables } = setup();
    const { plan } = await planWithSets(svc, tables, [
      { customAudienceIds: ["aud-1"] },
      { customAudienceIds: ["aud-1"] },
    ]);
    const out = await svc.readiness("org", plan.id);
    const aud = out.checks.filter((c: any) => c.key === "audience");
    expect(aud).toHaveLength(1);
    expect(aud[0].level).toBe("warn");
    expect(aud[0].detail).toContain("ক্রেতা তালিকা");
    expect(aud[0].detail).toContain("S1");
    expect(aud[0].detail).toContain("S2");
    // The helper carries the stable code for the same finding.
    const full = await (svc as any).getPlanFull("org", plan.id);
    const findings = CampaignsService.audiencePlanFindings(full, new Map([["aud-1", "ক্রেতা তালিকা"]]), new Map([["aud-1", "custom"]]));
    expect(findings.map((f) => f.code)).toContain("audience_shared_across_ad_sets");
  });

  it("an audience both included and excluded is a validatePlan ERROR (and blocks readiness)", async () => {
    global.fetch = (async () => ({ status: 200 })) as any;
    const { svc, tables } = setup();
    const { plan } = await planWithSets(svc, tables, [
      { customAudienceIds: ["aud-1"], excludedAudienceIds: ["aud-1"] },
    ]);
    const full = await (svc as any).getPlanFull("org", plan.id);
    const v = svc.validatePlan(full);
    expect(v.valid).toBe(false);
    expect(v.errors.some((e: string) => /both included and excluded/.test(e))).toBe(true);
    const out = await svc.readiness("org", plan.id);
    expect(out.ready).toBe(false);
  });

  it("a preset-only exclusion conflicts the same way (preset carries its own external id)", async () => {
    const { svc, tables } = setup();
    const { plan } = await planWithSets(svc, tables, [
      { customAudienceIds: ["aud-9"], exclusionPresets: [{ key: "exclude_purchasers_30d", label: "শেষ ৩০ দিনের ক্রেতাদের বাদ দিন", audienceRecordId: "rec-9", externalAudienceId: "aud-9" }] },
    ]);
    const full = await (svc as any).getPlanFull("org", plan.id);
    const v = svc.validatePlan(full);
    expect(v.valid).toBe(false);
    expect(v.errors.some((e: string) => /aud-9/.test(e) && /both included and excluded/.test(e))).toBe(true);
  });

  it("prospecting without any exclusion warns; retargeting layers, warm sets and excluded sets do not", () => {
    const nameOf = new Map([["aud-1", "ক্রেতা তালিকা"], ["aud-lal", "ক্রেতা Lookalike 1%"]]);
    const kindOf = new Map([["aud-1", "custom"], ["aud-lal", "lookalike"]]);
    const codes = (adSets: any[]) => CampaignsService.audiencePlanFindings({ adSets }, nameOf, kindOf).map((f) => f.code);
    // Broad prospecting, nothing excluded -> warning.
    expect(codes([{ name: "Broad", targeting: { countries: ["BD"] } }])).toContain("prospecting_without_exclusion");
    // Interest prospecting with an exclusion -> no warning.
    expect(codes([{ name: "Interest", targeting: { countries: ["BD"], excludedAudienceIds: ["aud-1"] } }])).not.toContain("prospecting_without_exclusion");
    // Retargeting layer -> never prospecting.
    expect(codes([{ name: "RT", funnelLayer: "retargeting", targeting: { countries: ["BD"] } }])).not.toContain("prospecting_without_exclusion");
    // Warm set (includes a real custom audience) -> no warning.
    expect(codes([{ name: "Warm", targeting: { countries: ["BD"], customAudienceIds: ["aud-1"] } }])).not.toContain("prospecting_without_exclusion");
    // Lookalike-only set is still cold -> warning stands.
    expect(codes([{ name: "LAL", targeting: { countries: ["BD"], customAudienceIds: ["aud-lal"] } }])).toContain("prospecting_without_exclusion");
  });

  it("overlap stays not_computable with the spike verdict (no Meta overlap endpoint exists)", async () => {
    const { svc, tables } = setup();
    const { plan, sets } = await planWithSets(svc, tables, [
      { customAudienceIds: ["aud-1", "aud-2"] },
    ]);
    const out = await svc.audienceInsights("org", plan.id, sets[0].id);
    expect(out.overlap.status).toBe("not_computable");
    expect(out.overlap.reason).toContain("Ads Manager");
    expect(out.overlap.reason).toContain("2026-10-17");
  });
});
