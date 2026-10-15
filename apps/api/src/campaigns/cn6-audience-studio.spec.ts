import { CampaignsService } from "./campaigns.service";
import { AudiencesService } from "../audiences/audiences.service";
import { encryptJson } from "../integrations/crypto";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

/**
 * Campaign Builder Next CN6: the Audience Studio inside an
 * ad set. Every action rides the REAL AudiencesService over
 * shared tables — creation is Meta-confirmed or it does not
 * attach; exclusion presets land as named, inspectable
 * targeting entries; sizes come from AudienceRecords
 * (approximateCount, else last membership count, else
 * UNKNOWN); overlap is honestly not computable from stored
 * data. No second audience system exists in this file.
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
    groupBy: async ({ by, where }: any) => {
      const f = rows.filter((r) => matches(r, where ?? {}));
      const groups = new Map<string, any[]>();
      for (const r of f) { const k = r[by[0]]; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(r); }
      return [...groups.entries()].map(([k, g]) => ({
        [by[0]]: k, _count: { _all: g.length },
        _sum: { totalMinor: g.reduce((a, r) => a + BigInt(r.totalMinor ?? 0), 0n) },
        _max: { placedAt: g.reduce((a, r) => (r.placedAt && (!a || r.placedAt > a) ? r.placedAt : a), null), createdAt: g.reduce((a, r) => (r.createdAt && (!a || r.createdAt > a) ? r.createdAt : a), null) },
      }));
    },
  };
}
function setup(metaMode: "ok" | "fail" = "ok") {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "integration", "product", "dailyAdMetric", "audienceRecord", "customer", "lead", "order", "trackingEvent", "visitor", "abandonedStoreCheckout", "catalogRecord", "productSet", "leadForm", "customFieldDef", "conversionApiSetting", "conversionEventLog"]) tables[n] = makeTable(n);
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", sourceType: "api", externalId: "act_777", name: "Main", currency: "BDT", platformStatusBucket: "active", integrationId: "int-1" });
  tables.integration.rows.push({ id: "int-1", organizationId: "org", provider: "meta", status: "CONNECTED", credential: { encryptedData: encryptJson({ accessToken: "tok-123" }) } });
  const origCreate = tables.campaignAd.create;
  tables.campaignAd.create = async (args: any) => { const row = await origCreate(args); row.__adSet = tables.campaignAdSet.rows.find((s: any) => s.id === row.adSetId) ?? {}; return row; };
  const audit = { log: async () => undefined } as any;
  const audiences = new AudiencesService(tables as any, audit);
  const svc = new CampaignsService(tables as any, audit, { getProvider: () => new DevTemplateProvider() } as any, undefined, audiences);
  (global as any).fetch = async (url: string, init: any) => {
    const u = String(url);
    if (metaMode === "fail" && u.includes("/customaudiences")) {
      return { ok: false, status: 400, json: async () => ({ error: { message: "Meta refused the audience" } }) };
    }
    if (u.includes("/customaudiences") && !u.includes("/users")) return { ok: true, status: 200, json: async () => ({ id: `aud-meta-${Math.floor(Math.random() * 1e6)}` }) };
    if (u.includes("/users")) return { ok: true, status: 200, json: async () => ({ num_received: 1 }) };
    if (u.includes("/delivery_estimate")) return { ok: true, status: 200, json: async () => ({ data: [{ users_lower_bound: 12000, users_upper_bound: 34000 }] }) };
    if (u.includes("/campaigns")) return { ok: true, status: 200, json: async () => ({ id: "camp-1" }) };
    if (u.includes("/adsets")) return { ok: true, status: 200, json: async () => ({ id: "adset-1" }) };
    if (u.includes("/ads")) return { ok: true, status: 200, json: async () => ({ id: "ad-1" }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return { tables, svc, audiences };
}
const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });
const day = 86_400_000;
async function draft(svc: CampaignsService, tables: any) {
  tables.customer.rows.push(
    { id: "c1", organizationId: "org", email: "a@x.com", phone: "01710000001", mergedIntoId: null, firstName: "A" },
    { id: "c2", organizationId: "org", email: "b@x.com", phone: null, mergedIntoId: null, firstName: "B" },
  );
  const now = Date.now();
  tables.order.rows.push(
    { id: "o1", organizationId: "org", customerId: "c1", status: "completed", isPractice: false, totalMinor: 5000n, placedAt: new Date(now - 3 * day), createdAt: new Date(now - 3 * day) },
    { id: "o2", organizationId: "org", customerId: "c2", status: "completed", isPractice: false, totalMinor: 7000n, placedAt: new Date(now - 40 * day), createdAt: new Date(now - 40 * day) },
  );
  const plan: any = await svc.createPlan("org", "creator", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
  const adSet: any = await svc.addAdSet("org", plan.id, { name: "S1", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg", pixelId: "px", countries: ["BD"] });
  return { plan, adSet };
}

describe("CN6 audience studio", () => {
  it("studio home returns real source counts + the account's records + presets", async () => {
    const { tables, svc } = setup();
    const { plan } = await draft(svc, tables);
    const studio: any = await svc.audienceStudio("org", plan.id);
    expect(studio.available).toBe(true);
    expect(studio.sources.find((s: any) => s.key === "buyers").contactCount).toBe(2);
    expect(studio.sources.find((s: any) => s.key === "recent_purchasers_30").contactCount).toBe(1);
    expect(studio.presets.map((p: any) => p.key)).toEqual(["exclude_purchasers_30d", "exclude_existing_customers"]);
  });

  it("one-click create (buyers) goes through AudiencesService and attaches only with a Meta id", async () => {
    const { tables, svc } = setup();
    const { plan, adSet } = await draft(svc, tables);
    const res: any = await svc.studioCreateAudience("org", plan.id, adSet.id, "u", { source: "buyers", name: "Buyers", attach: true });
    expect(res.record.source).toBe("buyers");
    expect(res.record.externalAudienceId).toBeTruthy();
    expect(res.attached).toBe(true);
    const set = tables.campaignAdSet.rows.find((s: any) => s.id === adSet.id);
    expect(set.targeting.customAudienceIds).toContain(res.record.externalAudienceId);
    // The record is a genuine AudienceRecord row of the plan's account.
    expect(tables.audienceRecord.rows).toHaveLength(1);
    expect(tables.audienceRecord.rows[0].adAccountId).toBe("acc-1");
  });

  it("an empty source refuses creation honestly (nothing attached, no record)", async () => {
    const { tables, svc } = setup();
    const { plan, adSet } = await draft(svc, tables);
    await expect(svc.studioCreateAudience("org", plan.id, adSet.id, "u", { source: "cart_abandoners", name: "Abandoners", attach: true })).rejects.toThrow(/No contacts/);
    expect(tables.audienceRecord.rows).toHaveLength(0);
  });

  it("lookalike inline: country + ratio validated; valid creation attaches", async () => {
    const { tables, svc } = setup();
    const { plan, adSet } = await draft(svc, tables);
    tables.audienceRecord.rows.push({ id: "src-1", organizationId: "org", adAccountId: "acc-1", name: "Buyers", kind: "custom", source: "buyers", status: "ready", externalAudienceId: "aud-src" });
    await expect(svc.studioCreateLookalike("org", plan.id, adSet.id, "u", { sourceAudienceRecordId: "src-1", name: "LAL", country: "Bangladesh" })).rejects.toThrow(/ISO 2-letter/);
    await expect(svc.studioCreateLookalike("org", plan.id, adSet.id, "u", { sourceAudienceRecordId: "src-1", name: "LAL", country: "BD", ratio: 0.5 })).rejects.toThrow(/ratio/);
    const res: any = await svc.studioCreateLookalike("org", plan.id, adSet.id, "u", { sourceAudienceRecordId: "src-1", name: "LAL BD 1%", country: "BD", ratio: 0.01, attach: true });
    expect(res.record.kind).toBe("lookalike");
    expect(res.attached).toBe(true);
  });

  it("exclusion preset creates once, names itself in targeting, and reuses the record next time", async () => {
    const { tables, svc } = setup();
    const { plan, adSet } = await draft(svc, tables);
    const first: any = await svc.studioApplyExclusionPreset("org", plan.id, adSet.id, "u", { preset: "exclude_purchasers_30d" });
    expect(first.status).toBe("applied");
    expect(first.created).toBe(true);
    let set = tables.campaignAdSet.rows.find((s: any) => s.id === adSet.id);
    expect(set.targeting.excludedAudienceIds).toContain(first.record.externalAudienceId);
    expect(set.targeting.exclusionPresets).toHaveLength(1);
    expect(set.targeting.exclusionPresets[0]).toMatchObject({ key: "exclude_purchasers_30d", audienceRecordId: first.record.id });
    // The preset is visible to the publish targeting mapping.
    const graph = (svc as any).toGraphTargeting(set.targeting, false);
    expect(graph.excluded_custom_audiences).toEqual([{ id: first.record.externalAudienceId }]);
    const second: any = await svc.studioApplyExclusionPreset("org", plan.id, adSet.id, "u", { preset: "exclude_purchasers_30d" });
    expect(second.created).toBe(false);
    expect(tables.audienceRecord.rows.filter((r: any) => r.source === "recent_purchasers")).toHaveLength(1);
    set = tables.campaignAdSet.rows.find((s: any) => s.id === adSet.id);
    expect(set.targeting.exclusionPresets).toHaveLength(1);
    await expect(svc.studioApplyExclusionPreset("org", plan.id, adSet.id, "u", { preset: "nope" })).rejects.toThrow(/preset must be one of/);
  });

  it("when Meta refuses, the preset answers unavailable and targeting stays untouched", async () => {
    const { tables, svc } = setup("fail");
    const { plan, adSet } = await draft(svc, tables);
    const res: any = await svc.studioApplyExclusionPreset("org", plan.id, adSet.id, "u", { preset: "exclude_existing_customers" });
    expect(res.status).toBe("unavailable");
    expect(res.reason).toBeTruthy();
    const set = tables.campaignAdSet.rows.find((s: any) => s.id === adSet.id);
    expect(set.targeting.excludedAudienceIds ?? []).toHaveLength(0);
    expect(set.targeting.exclusionPresets ?? []).toHaveLength(0);
  });

  it("insights resolve sizes from records, mark foreign ids unknown, and refuse to invent overlap", async () => {
    const { tables, svc } = setup();
    const { plan, adSet } = await draft(svc, tables);
    tables.audienceRecord.rows.push(
      { id: "r1", organizationId: "org", adAccountId: "acc-1", name: "Buyers", kind: "custom", source: "buyers", status: "ready", externalAudienceId: "aud-1", approximateCount: 42000, lastMembershipCount: 300 },
      { id: "r2", organizationId: "org", adAccountId: "acc-1", name: "Viewers", kind: "custom", source: "product_viewers", status: "ready", externalAudienceId: "aud-2", approximateCount: null, lastMembershipCount: 150 },
      { id: "r3", organizationId: "org", adAccountId: "acc-1", name: "NoSize", kind: "custom", source: "customers", status: "building", externalAudienceId: "aud-3", approximateCount: null, lastMembershipCount: null },
    );
    const set = tables.campaignAdSet.rows.find((s: any) => s.id === adSet.id);
    set.targeting = { ...set.targeting, customAudienceIds: ["aud-1", "aud-2", "aud-foreign"], excludedAudienceIds: ["aud-3"] };
    const ins: any = await svc.audienceInsights("org", plan.id, adSet.id);
    expect(ins.included[0]).toMatchObject({ size: 42000, sizeSource: "meta_approximate_count" });
    expect(ins.included[1]).toMatchObject({ size: 150, sizeSource: "last_membership_sync" });
    expect(ins.included[2].size).toBeNull();
    expect(ins.excluded[0].size).toBeNull();
    expect(ins.warnings.length).toBeGreaterThanOrEqual(2);
    expect(ins.overlap.status).toBe("not_computable");
    expect(ins.estimate).toMatchObject({ available: true, lowerBound: 12000, upperBound: 34000 });
  });

  it("studio actions refuse on a non-editable plan", async () => {
    const { tables, svc } = setup();
    const { plan, adSet } = await draft(svc, tables);
    tables.campaignPlan.rows.find((p: any) => p.id === plan.id).status = "approved";
    await expect(svc.studioCreateAudience("org", plan.id, adSet.id, "u", { source: "buyers", name: "B" })).rejects.toThrow(/can no longer be edited/);
  });
});
