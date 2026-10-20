import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder Next CN1: targeting v2 — location
 * depth (cities/radius/postcodes/location types), locales,
 * behaviors + demographics in the DTO, one narrowing layer,
 * the expansion toggle, Meta targeting search with an
 * honest unavailable state, id-entry validation (name-only
 * legacy entries are NOT re-validated, only flagged), and
 * a delivery-estimate attempt per ad set in readiness.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
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
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); rows.splice(i, 1); return {}; },
  };
}
function setup() {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "integration", "product"]) tables[n] = makeTable(n);
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", sourceType: "api", externalId: "act_1", name: "Main", currency: "BDT", platformStatusBucket: "active", integrationId: null });
  const svc = new CampaignsService(tables as any, { log: async () => undefined } as any, { getProvider: () => new DevTemplateProvider() } as any);
  return { tables, svc };
}
async function draft(svc: CampaignsService) {
  const plan: any = await svc.createPlan("org", "u1", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
  return plan;
}
const baseSet = { name: "S1", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg", pixelId: "px", countries: ["BD"] };

describe("CN1 targeting v2", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it("stores location depth/locales/demographics/narrowing and maps them into the Graph payload", async () => {
    const { svc } = setup();
    const plan = await draft(svc);
    const adSet: any = await svc.addAdSet("org", plan.id, {
      ...baseSet,
      cities: [{ key: "city-key-dhaka", name: "Dhaka", radius: 25, distanceUnit: "kilometer" }, { key: "city-key-ctg" }],
      postcodes: ["BD:1212"], locationTypes: ["home", "recent"], locales: [1012],
      behaviors: ["Online shopping"], demographics: { educationStatuses: [3], lifeEvents: ["New job"] },
      narrowInterests: ["Fashion"], targetingExpansion: true,
    });
    const t = adSet.targeting;
    expect(t.cities).toHaveLength(2);
    expect(t.cities[0]).toMatchObject({ key: "city-key-dhaka", radius: 25, distanceUnit: "kilometer" });
    expect(t.postcodes).toEqual(["BD:1212"]);
    expect(t.locationTypes).toEqual(["home", "recent"]);
    expect(t.locales).toEqual([1012]);
    expect(t.behaviors).toEqual(["Online shopping"]);
    expect(t.demographics.educationStatuses).toEqual([3]);
    expect(t.targetingExpansion).toBe(true);

    const graph = (svc as any).toGraphTargeting(t);
    expect(graph.geo_locations.countries).toEqual(["BD"]);
    expect(graph.geo_locations.cities).toEqual([
      { key: "city-key-dhaka", radius: 25, distance_unit: "kilometer" },
      { key: "city-key-ctg" },
    ]);
    expect(graph.geo_locations.zips).toEqual([{ key: "BD:1212" }]);
    expect(graph.geo_locations.location_types).toEqual(["home", "recent"]);
    expect(graph.locales).toEqual([1012]);
    const flex = graph.flexible_spec as any[];
    expect(flex.some((f) => Array.isArray(f.behaviors))).toBe(true);
    expect(flex.some((f) => Array.isArray(f.demographics) && f.demographics[0].education_statuses?.[0] === 3 && f.demographics[0].life_events?.[0]?.name === "New job")).toBe(true);
    // The narrowing layer is its OWN flexible_spec element (AND).
    expect(flex[flex.length - 1].interests).toEqual([{ name: "Fashion" }]);
    expect(graph.targeting_automation).toEqual({ advantage_audience: 1 });
  });

  it("refuses shapes Meta cannot express (bad location type, keyless city, bad locale, unknown demographics key)", async () => {
    const { svc } = setup();
    const plan = await draft(svc);
    await expect(svc.addAdSet("org", plan.id, { ...baseSet, locationTypes: ["moon"] as any })).rejects.toThrow(/location type/);
    await expect(svc.addAdSet("org", plan.id, { ...baseSet, cities: [{ name: "Dhaka" } as any] })).rejects.toThrow(/location key/);
    await expect(svc.addAdSet("org", plan.id, { ...baseSet, cities: [{ key: "k", radius: 500 }] })).rejects.toThrow(/radius/);
    await expect(svc.addAdSet("org", plan.id, { ...baseSet, locales: [0] })).rejects.toThrow(/locale/);
    await expect(svc.addAdSet("org", plan.id, { ...baseSet, demographics: { zodiac: [1] } })).rejects.toThrow(/demographics field/);
  });

  it("name-only legacy entries still save with NO Meta connection (they are flagged, not blocked)", async () => {
    const { svc, tables } = setup();
    const plan = await draft(svc);
    const adSet: any = await svc.addAdSet("org", plan.id, { ...baseSet, interests: ["Fashion"], behaviors: ["Travel"] });
    expect(adSet.targeting.interests).toEqual(["Fashion"]);
    expect(tables.campaignAdSet.rows).toHaveLength(1);
  });

  it("an id-carrying entry is REFUSED when Meta cannot confirm it (no connection)", async () => {
    const { svc, tables } = setup();
    const plan = await draft(svc);
    await expect(svc.addAdSet("org", plan.id, { ...baseSet, interests: [{ id: "6001", name: "Fashion" }] }))
      .rejects.toThrow(/যাচাই করা যায়নি/);
    expect(tables.campaignAdSet.rows).toHaveLength(0); // nothing stored
  });

  it("an id-carrying entry saves when Meta's search confirms the id, and is refused when it does not", async () => {
    const { svc, tables } = setup();
    const plan = await draft(svc);
    (svc as any).publishClient = async () => ({
      account: tables.adAccount.rows[0],
      client: { targetingSearch: async (_acc: string, i: any) => (i.query === "Fashion" ? [{ id: "6001", name: "Fashion" }] : []) },
    });
    const adSet: any = await svc.addAdSet("org", plan.id, { ...baseSet, interests: [{ id: "6001", name: "Fashion" }] });
    expect(adSet.targeting.interests).toEqual([{ id: "6001", name: "Fashion" }]);
    const graph = (svc as any).toGraphTargeting(adSet.targeting);
    expect(graph.flexible_spec[0].interests).toEqual([{ id: "6001", name: "Fashion" }]);
    await expect(svc.addAdSet("org", plan.id, { ...baseSet, name: "S2", interests: [{ id: "9999", name: "Nope" }] }))
      .rejects.toThrow(/পাওয়া যায়নি/);
  });

  it("updateAdSet layers the new fields over stored targeting and validates only the edited entries", async () => {
    const { svc } = setup();
    const plan = await draft(svc);
    const adSet: any = await svc.addAdSet("org", plan.id, { ...baseSet, interests: ["Fashion"] });
    const updated: any = await svc.updateAdSet("org", plan.id, adSet.id, "u1", {
      cities: [{ key: "city-key-khulna", radius: 10 }], locales: [1012, 1024], narrowBehaviors: ["Online shopping"],
    });
    expect(updated.targeting.cities).toEqual([{ key: "city-key-khulna", radius: 10 }]);
    expect(updated.targeting.locales).toEqual([1012, 1024]);
    expect(updated.targeting.narrowBehaviors).toEqual(["Online shopping"]);
    expect(updated.targeting.interests).toEqual(["Fashion"]); // untouched legacy entry survives un-re-validated
    const cleared: any = await svc.updateAdSet("org", plan.id, adSet.id, "u1", { cities: [], locales: [] });
    expect(cleared.targeting.cities).toBeUndefined();
    expect(cleared.targeting.locales).toBeUndefined();
  });

  it("targeting search returns Meta rows when connected, and the honest unavailable state when not", async () => {
    const { svc, tables } = setup();
    await expect(svc.searchTargeting("org", { adAccountId: "acc-1", kind: "bogus", query: "x" })).rejects.toMatchObject({ code: "campaigns.kindMustBeOneOf" });
    const off = await svc.searchTargeting("org", { adAccountId: "acc-1", kind: "interest", query: "Fashion" });
    expect(off.available).toBe(false);
    expect(off.results).toEqual([]);
    expect(off.reason).toBeTruthy();
    (svc as any).metaClientForAccount = async () => ({
      targetingSearch: async () => [{ id: "6001", name: "Fashion", type: "adinterest", path: ["Interests"], audience_size_lower_bound: 1000, audience_size_upper_bound: 2000 }],
    });
    const on = await svc.searchTargeting("org", { adAccountId: "acc-1", kind: "interest", query: "Fashion" });
    expect(on.available).toBe(true);
    expect(on.results[0]).toMatchObject({ id: "6001", name: "Fashion", audienceSizeLower: 1000 });
    expect(tables.adAccount.rows[0].externalId).toBe("act_1");
  });

  it("readiness attempts an estimate for EVERY ad set and flags name-only entries", async () => {
    global.fetch = (async () => ({ status: 200 })) as any;
    const { svc } = setup();
    const plan = await draft(svc);
    await svc.addAdSet("org", plan.id, { ...baseSet, interests: ["Fashion"] });
    const s2: any = await svc.addAdSet("org", plan.id, { ...baseSet, name: "S2" });
    await svc.addAd("org", plan.id, s2.id, { name: "A", primaryText: "ভালো প্রোডাক্ট কিনুন এখনই সেরা দামে", linkUrl: "https://shop.example/x" });
    const out = await svc.readiness("org", plan.id);
    expect(out.estimates).toHaveLength(2);
    expect(out.estimates.every((e: any) => e.available === false && e.reason)).toBe(true);
    expect(out.estimate.available).toBe(false); // back-compat: first set
    const tcheck = out.checks.find((c: any) => c.key === "targeting");
    expect(tcheck?.level).toBe("warn");
    expect(tcheck?.detail).toContain("Fashion");
  });
});
