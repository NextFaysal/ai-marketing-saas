import { CampaignsService } from "./campaigns.service";
import { encryptJson } from "../integrations/crypto";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder Advanced CA23 (CB6): TRUE Advantage+ +
 * app promotion. SPIKE VERDICT (Meta's unified Advantage+
 * guide, developers.facebook.com/docs/marketing-api/
 * advantage-campaigns, verified 2026-10-17): there is NO
 * settable ASC field in the current API — the legacy
 * smart_promotion_type=AUTOMATED_SHOPPING_ADS create path
 * was removed (v25.0 errors on every version). A campaign
 * IS Advantage+ when three levers hold: (1) campaign-level
 * budget on a supported bid_strategy, (2) NO placement
 * targeting/exclusions on any ad set, (3) Advantage+
 * audience on at least one ad set — and the only
 * confirmation is the advantage_state_info READ-BACK.
 * These specs pin: the publish wire (campaign bid +
 * sharing off, no placement fields, no ad-set bid fields),
 * the read-back stored verbatim (incl. a DISABLED verdict
 * recorded loudly, publish NOT failed), the validation
 * conflicts NAMED (placements, mixed bids), and the app
 * promotion shape (promoted_object application_id +
 * object_store_url, APP_INSTALLS). All Meta traffic is a
 * stubbed fetch — labelled stub evidence, no live call.
 */
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
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
    findMany: async ({ where, take, orderBy }: any = {}) => {
      let f = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "desc") f = [...f].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return take ? f.slice(0, take) : f;
    },
    findUnique: async ({ where }: any = {}) => rows.find((r) => r.id === where.id || r.organizationId === where.organizationId) ?? null,
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
    delete: async ({ where }: any = {}) => { const i = rows.findIndex((r) => r.id === where.id); if (i >= 0) rows.splice(i, 1); return {}; },
  };
}
function fakePrisma() {
  const tables: any = {
    campaignPlan: makeTable("plan"), campaignAdSet: makeTable("adset"), campaignAd: makeTable("ad"),
    campaignPublishLog: makeTable("log"), adAccount: makeTable("account"), integration: makeTable("integration"),
    product: makeTable("product"), aIUsageRecord: makeTable("usage"), campaignPlanVersion: makeTable("version"),
  };
  tables.businessProfile = { findUnique: async () => ({ organizationId: "org-1", industry: "fashion", websiteUrl: "https://shop.example", brandVoice: "friendly" }) };
  const secrets = encryptJson({ accessToken: "tok-123" });
  tables.integration.rows.push({ id: "int-1", organizationId: "org-1", provider: "meta", status: "CONNECTED", credential: { encryptedData: secrets } });
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org-1", platform: "meta", sourceType: "api", externalId: "act_777", integrationId: "int-1", name: "Main", currency: "BDT" });
  return tables;
}
const auditStub = { log: async () => undefined } as any;
const devLlm = { getProvider: () => new DevTemplateProvider() } as any;

function metaFetch(verdict: any) {
  const calls: { method: string; url: string; body: string }[] = [];
  const fetchFn = async (url: string, init: any) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: String(init?.body ?? "") });
    if (method === "GET" && url.includes("advantage_state_info")) {
      return { ok: true, status: 200, json: async () => verdict };
    }
    if (url.includes("/campaigns")) return { ok: true, status: 200, json: async () => ({ id: "camp-100" }) };
    if (url.includes("/adsets")) return { ok: true, status: 200, json: async () => ({ id: "adset-100" }) };
    if (url.includes("/ads")) return { ok: true, status: 200, json: async () => ({ id: "ad-100" }) };
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  };
  return { fetchFn, calls };
}
const PLUS = { advantage_state_info: { advantage_state: "ADVANTAGE_PLUS_SALES", advantage_budget_state: "ENABLED", advantage_audience_state: "ENABLED", advantage_placement_state: "ENABLED" }, smart_promotion_type: "GUIDED_CREATION" };
const DISABLED = { advantage_state_info: { advantage_state: "DISABLED", advantage_budget_state: "ENABLED", advantage_audience_state: "ENABLED", advantage_placement_state: "DISABLED" }, smart_promotion_type: "GUIDED_CREATION" };

async function approvedAdvantagePlan(svc: any) {
  const plan = await svc.createPlan("org-1", "creator-1", { name: "Adv Plan", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
  const adSet = await svc.addAdSet("org-1", plan.id, {
    name: "Broad", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS",
    pageId: "page-1", pixelId: "pixel-1", countries: ["BD"],
  });
  await svc.addAd("org-1", plan.id, adSet.id, { name: "Ad 1", primaryText: "দাম ১৫০০ টাকা", headline: "H", linkUrl: "https://shop.example/p" });
  await svc.setAdvantagePlus("org-1", "creator-1", plan.id, true);
  await svc.submitForApproval("org-1", "creator-1", plan.id);
  await svc.approve("org-1", "owner-1", plan.id);
  return plan.id;
}

describe("CA23 validation conflicts are named", () => {
  it("placement restrictions on an Advantage+ plan error, naming the ad set and fields", async () => {
    const svc: any = new CampaignsService(fakePrisma() as any, auditStub, devLlm);
    const plan = await svc.createPlan("org-1", "u", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
    await svc.addAdSet("org-1", plan.id, { name: "Restricted", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg", pixelId: "px", countries: ["BD"], platforms: ["facebook"], devices: ["mobile"] });
    await svc.setAdvantagePlus("org-1", "u", plan.id, true);
    const full = await svc.getPlanFull("org-1", plan.id);
    const { valid, errors } = svc.validatePlan(full);
    expect(valid).toBe(false);
    expect(errors.join(" ")).toContain("Restricted");
    expect(errors.join(" ")).toContain("platforms");
    expect(errors.join(" ")).toContain("devices");
    expect(errors.join(" ")).toContain("Advantage+");
  });

  it("mixed ad-set bid strategies on an Advantage+ plan error (no silent pick)", async () => {
    const svc: any = new CampaignsService(fakePrisma() as any, auditStub, devLlm);
    const plan = await svc.createPlan("org-1", "u", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
    await svc.addAdSet("org-1", plan.id, { name: "S1", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg", pixelId: "px", countries: ["BD"] });
    await svc.addAdSet("org-1", plan.id, { name: "S2", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg", pixelId: "px", countries: ["BD"], bidStrategy: "bid_cap", bidAmount: "50" });
    await svc.setAdvantagePlus("org-1", "u", plan.id, true);
    const full = await svc.getPlanFull("org-1", plan.id);
    const { errors } = svc.validatePlan(full);
    expect(errors.join(" ")).toContain("ONE campaign bid strategy");
  });

  it("toGraphTargeting suppresses every placement field only for Advantage+ (defence in depth)", async () => {
    const svc: any = new CampaignsService(fakePrisma() as any, auditStub, devLlm);
    const targeting = { countries: ["BD"], platforms: ["facebook"], positions: ["feed"], devices: ["mobile"] };
    const manual = svc.toGraphTargeting(targeting, false);
    expect(manual.publisher_platforms).toEqual(["facebook"]);
    expect(manual.device_platforms).toEqual(["mobile"]);
    const plus = svc.toGraphTargeting(targeting, true);
    expect(plus.publisher_platforms).toBeUndefined();
    expect(plus.facebook_positions).toBeUndefined();
    expect(plus.device_platforms).toBeUndefined();
    expect(plus.targeting_automation).toEqual({ advantage_audience: 1 });
  });
});

describe("CA23 publish wire + read-back", () => {
  it("sends campaign bid_strategy + sharing off, no ad-set bids, and stores Meta's ADVANTAGE_PLUS_SALES verdict", async () => {
    const prisma = fakePrisma();
    const svc: any = new CampaignsService(prisma as any, auditStub, devLlm);
    const planId = await approvedAdvantagePlan(svc);
    const { fetchFn, calls } = metaFetch(PLUS);
    (global as any).fetch = fetchFn;
    const published = await svc.publish("org-1", "owner-1", planId);
    expect(published.status).toBe("published");
    const campaignCall = calls.find((c) => c.method === "POST" && c.url.includes("/campaigns"))!;
    expect(campaignCall.body).toContain("bid_strategy=LOWEST_COST_WITHOUT_CAP");
    expect(campaignCall.body).toContain("is_adset_budget_sharing_enabled=false");
    expect(campaignCall.body).toContain("daily_budget=50000");
    const adSetCall = calls.find((c) => c.method === "POST" && c.url.includes("/adsets"))!;
    expect(adSetCall.body).not.toContain("bid_strategy=");
    const targeting = JSON.parse(decodeURIComponent(adSetCall.body.split("targeting=")[1].split("&")[0]));
    expect(targeting.publisher_platforms).toBeUndefined();
    expect(targeting.targeting_automation).toEqual({ advantage_audience: 1 });
    const planRow = prisma.campaignPlan.rows.find((r: any) => r.id === planId);
    expect(planRow.advantageState).toBe("ADVANTAGE_PLUS_SALES");
    expect(planRow.advantageStateInfo.advantage_state).toBe("ADVANTAGE_PLUS_SALES");
    expect(prisma.campaignPublishLog.rows.some((l: any) => l.step === "advantage_state" && String(l.error).includes("ADVANTAGE_PLUS_SALES"))).toBe(true);
  });

  it("a DISABLED verdict is recorded loudly and does NOT fail the publish", async () => {
    const prisma = fakePrisma();
    const svc: any = new CampaignsService(prisma as any, auditStub, devLlm);
    const planId = await approvedAdvantagePlan(svc);
    const { fetchFn } = metaFetch(DISABLED);
    (global as any).fetch = fetchFn;
    const published = await svc.publish("org-1", "owner-1", planId);
    expect(published.status).toBe("published");
    const planRow = prisma.campaignPlan.rows.find((r: any) => r.id === planId);
    expect(planRow.advantageState).toBe("DISABLED");
    expect(prisma.campaignPublishLog.rows.some((l: any) => l.step === "advantage_state" && String(l.error).includes("DISABLED"))).toBe(true);
    const readiness = await svc.readiness("org-1", planId);
    const adv = readiness.checks.find((c: any) => c.key === "advantage");
    expect(adv.level).toBe("error");
  });

  it("a non-Advantage plan's campaign create is byte-identical to before (no bid fields)", async () => {
    const prisma = fakePrisma();
    const svc: any = new CampaignsService(prisma as any, auditStub, devLlm);
    const plan = await svc.createPlan("org-1", "creator-1", { name: "Plain", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
    const adSet = await svc.addAdSet("org-1", plan.id, { name: "S", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg", pixelId: "px", countries: ["BD"] });
    await svc.addAd("org-1", plan.id, adSet.id, { name: "A", primaryText: "t", headline: "h", linkUrl: "https://shop.example/p" });
    await svc.submitForApproval("org-1", "creator-1", plan.id);
    await svc.approve("org-1", "owner-1", plan.id);
    const { fetchFn, calls } = metaFetch(PLUS);
    (global as any).fetch = fetchFn;
    await svc.publish("org-1", "owner-1", plan.id);
    const campaignCall = calls.find((c) => c.method === "POST" && c.url.includes("/campaigns"))!;
    expect(campaignCall.body).not.toContain("bid_strategy");
    expect(campaignCall.body).not.toContain("is_adset_budget_sharing_enabled");
    expect(calls.some((c) => c.method === "GET" && c.url.includes("advantage_state_info"))).toBe(false);
  });
});

describe("CA23 app promotion", () => {
  it("an app plan without app fields fails validation naming each missing piece", async () => {
    const svc: any = new CampaignsService(fakePrisma() as any, auditStub, devLlm);
    const plan = await svc.createPlan("org-1", "u", { name: "App", objective: "OUTCOME_APP_PROMOTION", adAccountId: "acc-1" });
    await svc.addAdSet("org-1", plan.id, { name: "Installs", dailyBudget: "500", optimizationGoal: "LINK_CLICKS", countries: ["BD"] });
    const full = await svc.getPlanFull("org-1", plan.id);
    const { valid, errors } = svc.validatePlan(full);
    expect(valid).toBe(false);
    expect(errors.join(" ")).toContain("App ID is required");
    expect(errors.join(" ")).toContain("App Store / Play Store URL is required");
    expect(errors.join(" ")).toContain("APP_INSTALLS");
  });

  it("publishes promoted_object { application_id, object_store_url } and Advantage+ app verdict reads back", async () => {
    const prisma = fakePrisma();
    const svc: any = new CampaignsService(prisma as any, auditStub, devLlm);
    const plan = await svc.createPlan("org-1", "creator-1", { name: "App Plan", objective: "OUTCOME_APP_PROMOTION", adAccountId: "acc-1" });
    const adSet = await svc.addAdSet("org-1", plan.id, {
      name: "Installs", dailyBudget: "500", optimizationGoal: "APP_INSTALLS", countries: ["BD"],
      pageId: "page-1", appId: "1234567890", appStoreUrl: "https://play.google.com/store/apps/details?id=com.example.app",
    });
    await svc.addAd("org-1", plan.id, adSet.id, { name: "Ad", primaryText: "অ্যাপটি ইনস্টল করুন", headline: "App", linkUrl: "https://play.google.com/store/apps/details?id=com.example.app", callToAction: "INSTALL_MOBILE_APP" });
    await svc.setAdvantagePlus("org-1", "creator-1", plan.id, true);
    await svc.submitForApproval("org-1", "creator-1", plan.id);
    await svc.approve("org-1", "owner-1", plan.id);
    const appVerdict = { advantage_state_info: { advantage_state: "ADVANTAGE_PLUS_APP", advantage_budget_state: "ENABLED", advantage_audience_state: "ENABLED", advantage_placement_state: "ENABLED" }, smart_promotion_type: "GUIDED_CREATION" };
    const { fetchFn, calls } = metaFetch(appVerdict);
    (global as any).fetch = fetchFn;
    const published = await svc.publish("org-1", "owner-1", plan.id);
    expect(published.status).toBe("published");
    const adSetCall = calls.find((c) => c.method === "POST" && c.url.includes("/adsets"))!;
    const po = JSON.parse(decodeURIComponent(adSetCall.body.split("promoted_object=")[1].split("&")[0]));
    expect(po.application_id).toBe("1234567890");
    expect(po.object_store_url).toContain("play.google.com");
    const planRow = prisma.campaignPlan.rows.find((r: any) => r.id === plan.id);
    expect(planRow.advantageState).toBe("ADVANTAGE_PLUS_APP");
  });

  it("the Advantage+ toggle refuses a traffic plan but accepts sales and app plans", async () => {
    const svc: any = new CampaignsService(fakePrisma() as any, auditStub, devLlm);
    const traffic = await svc.createPlan("org-1", "u", { name: "T", objective: "OUTCOME_TRAFFIC", adAccountId: "acc-1" });
    await expect(svc.setAdvantagePlus("org-1", "u", traffic.id, true)).rejects.toThrow("OUTCOME_SALES or OUTCOME_APP_PROMOTION");
  });
});
