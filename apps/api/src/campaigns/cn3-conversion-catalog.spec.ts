import { CampaignsService } from "./campaigns.service";
import { encryptJson } from "../integrations/crypto";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

/**
 * Campaign Builder Next CN3: the conversion-event support
 * matrix (refusals with reasons), the chosen event in the
 * publish promoted_object (PURCHASE stays the default),
 * REAL catalog ads (org/catalog/product-set validation,
 * product_set_id in promoted_object, the dynamic template
 * creative), the readiness events row over the existing
 * CAPI records, and the dynamic-retargeting preset's
 * honest missing / needs_choice / created answers.
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
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "integration", "product", "dailyAdMetric", "catalogRecord", "productSet", "audienceRecord", "conversionApiSetting", "conversionEventLog", "leadForm", "customFieldDef"]) tables[n] = makeTable(n);
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

async function approvedPlan(svc: CampaignsService, planDto: any, adSetDto: any, adDto: any = {}) {
  const plan: any = await svc.createPlan("org", "creator", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1", ...planDto });
  const adSet: any = await svc.addAdSet("org", plan.id, { name: "S1", pageId: "pg", countries: ["BD"], ...adSetDto });
  await svc.addAd("org", plan.id, adSet.id, { name: "A1", primaryText: "ভালো প্রোডাক্ট কিনুন এখনই", linkUrl: "https://shop.example/x", ...adDto });
  await svc.submitForApproval("org", "creator", plan.id);
  await svc.approve("org", "owner", plan.id);
  return { plan, adSet };
}
function seedCatalog(tables: any, setStatus = "created") {
  tables.catalogRecord.rows.push({ id: "cat-1", organizationId: "org", name: "Main Catalog", externalCatalogId: "cat-meta-1", status: "connected" });
  tables.productSet.rows.push({ id: "set-1", organizationId: "org", catalogRecordId: "cat-1", name: "All Products", externalSetId: setStatus === "created" ? "set-meta-1" : null, status: setStatus });
}

describe("CN3 conversion event matrix", () => {
  it("stores a valid event; refuses out-of-matrix combos with the reason", async () => {
    const { svc } = setup();
    const plan: any = await svc.createPlan("org", "u", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
    const s: any = await svc.addAdSet("org", plan.id, { name: "S", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg", pixelId: "px-1", countries: ["BD"], conversionEvent: "ADD_TO_CART" });
    expect(s.conversionEvent).toBe("ADD_TO_CART");
    // LEAD is not a Sales-objective event.
    await expect(svc.addAdSet("org", plan.id, { name: "S2", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg", pixelId: "px-1", countries: ["BD"], conversionEvent: "LEAD" })).rejects.toThrow(/not supported for objective OUTCOME_SALES/);
    // An event on a non-pixel goal is refused.
    await expect(svc.addAdSet("org", plan.id, { name: "S3", dailyBudget: "500", optimizationGoal: "LINK_CLICKS", pageId: "pg", countries: ["BD"], conversionEvent: "PURCHASE" })).rejects.toThrow(/pixel conversion goals/);
    // An event without a pixel is refused.
    await expect(svc.addAdSet("org", plan.id, { name: "S4", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg", countries: ["BD"], conversionEvent: "PURCHASE" })).rejects.toThrow(/needs a Pixel ID/);
    // Unknown event names are refused by the same matrix.
    await expect(svc.addAdSet("org", plan.id, { name: "S5", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg", pixelId: "px-1", countries: ["BD"], conversionEvent: "MOON" })).rejects.toThrow(/not supported/);
  });

  it("LEAD via pixel: only on a Leads plan's LEAD_GENERATION set, only the LEAD event", async () => {
    const { svc } = setup();
    const plan: any = await svc.createPlan("org", "u", { name: "P", objective: "OUTCOME_LEADS", adAccountId: "acc-1" });
    const s: any = await svc.addAdSet("org", plan.id, { name: "S", dailyBudget: "500", optimizationGoal: "LEAD_GENERATION", pageId: "pg", pixelId: "px-1", countries: ["BD"], conversionEvent: "LEAD" });
    expect(s.conversionEvent).toBe("LEAD");
    await expect(svc.addAdSet("org", plan.id, { name: "S2", dailyBudget: "500", optimizationGoal: "LEAD_GENERATION", pageId: "pg", pixelId: "px-1", countries: ["BD"], conversionEvent: "PURCHASE" })).rejects.toThrow(/LEAD only/);
    await expect(svc.addAdSet("org", plan.id, { name: "S3", dailyBudget: "500", optimizationGoal: "LEAD_GENERATION", pageId: "pg", countries: ["BD"], conversionEvent: "LEAD" })).rejects.toThrow(/needs a Pixel ID/);
  });

  it("PATCH: the event can be set + cleared; a merged out-of-matrix state is refused", async () => {
    const { svc } = setup();
    const plan: any = await svc.createPlan("org", "u", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
    const s: any = await svc.addAdSet("org", plan.id, { name: "S", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg", pixelId: "px-1", countries: ["BD"] });
    const set1: any = await svc.updateAdSet("org", plan.id, s.id, "u", { conversionEvent: "INITIATE_CHECKOUT" });
    expect(set1.conversionEvent).toBe("INITIATE_CHECKOUT");
    await expect(svc.updateAdSet("org", plan.id, s.id, "u", { optimizationGoal: "LINK_CLICKS" })).rejects.toThrow(/pixel conversion goals/);
    const cleared: any = await svc.updateAdSet("org", plan.id, s.id, "u", { conversionEvent: "" });
    expect(cleared.conversionEvent).toBeNull();
  });

  it("publish sends the chosen event; no choice keeps the PURCHASE default", async () => {
    const { svc } = setup(true);
    const { fetchFn, calls } = metaFetch();
    global.fetch = fetchFn as any;
    await approvedPlan(svc, {}, { dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pixelId: "px-1", conversionEvent: "ADD_TO_CART" });
    const plans: any = await svc.listPlans("org");
    await svc.publish("org", "owner", plans[0].id);
    const adsetCall = calls.find((c) => c.url.includes("/adsets"))!;
    expect(JSON.parse(adsetCall.params.get("promoted_object")!)).toEqual({ pixel_id: "px-1", custom_event_type: "ADD_TO_CART" });

    const { svc: svc2 } = setup(true);
    global.fetch = fetchFn as any;
    const before = calls.length;
    await approvedPlan(svc2, {}, { dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pixelId: "px-1" });
    const plans2: any = await svc2.listPlans("org");
    await svc2.publish("org", "owner", plans2[0].id);
    const adsetCall2 = calls.slice(before).find((c) => c.url.includes("/adsets"))!;
    expect(JSON.parse(adsetCall2.params.get("promoted_object")!)).toEqual({ pixel_id: "px-1", custom_event_type: "PURCHASE" });
  });
});

describe("CN3 catalog ads", () => {
  it("save-time refs: local-only set, wrong catalog and foreign catalog are refused", async () => {
    const { tables, svc } = setup();
    seedCatalog(tables, "local");
    const plan: any = await svc.createPlan("org", "u", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
    await expect(svc.addAdSet("org", plan.id, { name: "S", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg", countries: ["BD"], catalogRecordId: "cat-1", productSetId: "set-1" })).rejects.toMatchObject({ code: "campaigns.productSetIsNotCreatedOn" });
    tables.productSet.rows[0].status = "created"; tables.productSet.rows[0].externalSetId = "set-meta-1";
    tables.catalogRecord.rows.push({ id: "cat-2", organizationId: "org", name: "Other", externalCatalogId: "cat-meta-2", status: "connected" });
    await expect(svc.addAdSet("org", plan.id, { name: "S", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg", countries: ["BD"], catalogRecordId: "cat-2", productSetId: "set-1" })).rejects.toMatchObject({ code: "campaigns.thatProductSetBelongsToA" });
    await expect(svc.addAdSet("org", plan.id, { name: "S", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg", countries: ["BD"], catalogRecordId: "nope", productSetId: "set-1" })).rejects.toMatchObject({ code: "campaigns.catalogNotFoundInThisOrganization" });
    await expect(svc.addAdSet("org", plan.id, { name: "S", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg", countries: ["BD"], catalogRecordId: "cat-1" })).rejects.toMatchObject({ code: "campaigns.catalogAdsNeedBothACatalog" });
    const ok: any = await svc.addAdSet("org", plan.id, { name: "S", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg", countries: ["BD"], catalogRecordId: "cat-1", productSetId: "set-1" });
    expect(ok.productSetId).toBe("set-1");
    // A catalog set carrying a pixel event is refused at save.
    await expect(svc.addAdSet("org", plan.id, { name: "S2", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg", pixelId: "px-1", countries: ["BD"], catalogRecordId: "cat-1", productSetId: "set-1", conversionEvent: "PURCHASE" })).rejects.toThrow(/product set/);
  });

  it("publish sends product_set_id and the dynamic template creative — and no pixel event", async () => {
    const { tables, svc } = setup(true);
    seedCatalog(tables);
    const { fetchFn, calls } = metaFetch();
    global.fetch = fetchFn as any;
    const { plan } = await approvedPlan(svc, {}, { dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", catalogRecordId: "cat-1", productSetId: "set-1" });
    await svc.publish("org", "owner", plan.id);
    const adsetCall = calls.find((c) => c.url.includes("/adsets"))!;
    expect(JSON.parse(adsetCall.params.get("promoted_object")!)).toEqual({ product_set_id: "set-meta-1" });
    const adCall = calls.find((c) => c.url.includes("/ads") && !c.url.includes("/adsets"))!;
    const creative = JSON.parse(adCall.params.get("creative")!);
    expect(creative.template_data).toBeTruthy();
    expect(creative.template_data.link).toBe("{{product.url}}");
    expect(creative.template_data.call_to_action.type).toBe("SHOP_NOW");
    expect(creative.link_data).toBeUndefined();
  });

  it("validatePlan gates catalog structure: non-Sales objective + video ad are errors", async () => {
    const { tables, svc } = setup();
    seedCatalog(tables);
    const plan: any = await svc.createPlan("org", "u", { name: "P", objective: "OUTCOME_TRAFFIC", adAccountId: "acc-1" });
    const s: any = await svc.addAdSet("org", plan.id, { name: "S", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg", countries: ["BD"], catalogRecordId: "cat-1", productSetId: "set-1" });
    await svc.addAd("org", plan.id, s.id, { name: "A1", primaryText: "দেখুন", linkUrl: "https://shop.example/x" });
    const full: any = await svc.getPlan("org", plan.id);
    const v = (svc as any).validatePlan(full);
    expect(v.valid).toBe(false);
    expect(v.errors.join(" ")).toMatch(/Sales structure/);
  });
});

describe("CN3 readiness events row (existing CAPI records)", () => {
  async function readinessFor(setupFn: (tables: any) => void) {
    const { tables, svc } = setup();
    setupFn(tables);
    const plan: any = await svc.createPlan("org", "u", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
    const s: any = await svc.addAdSet("org", plan.id, { name: "S", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg", pixelId: "px-1", countries: ["BD"] });
    await svc.addAd("org", plan.id, s.id, { name: "A1", primaryText: "কিনুন", linkUrl: "https://shop.example/x" });
    // The landing check fetches for real — stub a reachable page.
    global.fetch = (async () => ({ ok: true, status: 200, json: async () => ({}) })) as any;
    const r: any = await svc.readiness("org", plan.id);
    return r.checks.filter((c: any) => c.key === "events");
  }

  it("no CAPI setting = unknown warning, never a pass", async () => {
    const rows = await readinessFor(() => undefined);
    expect(rows).toHaveLength(1);
    expect(rows[0].level).toBe("warn");
    expect(rows[0].detail).toMatch(/unknown/);
  });

  it("matching setting + a received event = ok; a failed last event = warn with the error", async () => {
    const okRows = await readinessFor((t) => {
      t.conversionApiSetting.rows.push({ id: "cs-1", organizationId: "org", pixelId: "px-1", enabled: true });
      t.conversionEventLog.rows.push({ id: "ev-1", organizationId: "org", eventName: "Purchase", status: "sent", eventsReceived: 1, createdAt: new Date() });
    });
    expect(okRows[0].level).toBe("ok");

    const failRows = await readinessFor((t) => {
      t.conversionApiSetting.rows.push({ id: "cs-1", organizationId: "org", pixelId: "px-1", enabled: true });
      t.conversionEventLog.rows.push({ id: "ev-1", organizationId: "org", eventName: "Purchase", status: "failed", error: "Invalid access token", createdAt: new Date() });
    });
    expect(failRows[0].level).toBe("warn");
    expect(failRows[0].detail).toMatch(/Invalid access token/);
  });

  it("setting for a different pixel = unknown warning naming both", async () => {
    const rows = await readinessFor((t) => {
      t.conversionApiSetting.rows.push({ id: "cs-1", organizationId: "org", pixelId: "px-OTHER", enabled: true });
    });
    expect(rows[0].level).toBe("warn");
    expect(rows[0].detail).toMatch(/px-OTHER/);
  });
});

describe("CN3 retargeting preset", () => {
  it("missing → needs_choice → created, with account/status guards", async () => {
    const { tables, svc } = setup();
    const plan: any = await svc.createPlan("org", "u", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
    const missing: any = await svc.applyRetargetingPreset("org", plan.id, "u", { kind: "product_viewers" });
    expect(missing.status).toBe("missing");
    expect(missing.missing[0]).toMatch(/CN6/);

    tables.audienceRecord.rows.push({ id: "aud-1", organizationId: "org", adAccountId: "acc-1", name: "Product Viewers 30d", kind: "custom", source: "meta", externalAudienceId: "aud-meta-1", status: "ready", approximateCount: 4200 });
    tables.audienceRecord.rows.push({ id: "aud-2", organizationId: "org", adAccountId: "acc-2", name: "Other account", kind: "custom", source: "meta", externalAudienceId: "aud-meta-2", status: "ready" });
    tables.audienceRecord.rows.push({ id: "aud-3", organizationId: "org", adAccountId: "acc-1", name: "Building", kind: "custom", source: "meta", externalAudienceId: "aud-meta-3", status: "building" });

    const choice: any = await svc.applyRetargetingPreset("org", plan.id, "u", { kind: "add_to_cart" });
    expect(choice.status).toBe("needs_choice");
    expect(choice.candidates.map((c: any) => c.id)).toEqual(["aud-1"]);

    await expect(svc.applyRetargetingPreset("org", plan.id, "u", { kind: "product_viewers", audienceRecordId: "aud-2" })).rejects.toMatchObject({ code: "campaigns.thatAudienceBelongsToADifferent" });
    await expect(svc.applyRetargetingPreset("org", plan.id, "u", { kind: "product_viewers", audienceRecordId: "aud-3" })).rejects.toMatchObject({ code: "campaigns.audienceIsNotReadyStatus" });

    const created: any = await svc.applyRetargetingPreset("org", plan.id, "u", { kind: "product_viewers", audienceRecordId: "aud-1", pageId: "pg", pixelId: "px-1" });
    expect(created.status).toBe("created");
    expect(created.adSet.conversionEvent).toBe("PURCHASE");
    expect((created.adSet.targeting as any).customAudienceIds).toEqual(["aud-meta-1"]);
    expect(created.missing).toEqual([]);
  });
});
