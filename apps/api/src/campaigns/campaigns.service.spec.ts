import { CampaignsService } from "./campaigns.service";
import { encryptJson } from "../integrations/crypto";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(row[k]);
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
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where, take, orderBy }: any = {}) => {
      let f = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "desc") f = [...f].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return take ? f.slice(0, take) : f;
    },
    findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); Object.assign(row, data); return row; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); rows.splice(i, 1); return {}; },
  };
}
function fakePrisma() {
  const tables: any = {
    campaignPlan: makeTable("plan"), campaignAdSet: makeTable("adset"), campaignAd: makeTable("ad"),
    campaignPublishLog: makeTable("log"), adAccount: makeTable("account"), integration: makeTable("integration"),
    product: makeTable("product"), aIUsageRecord: makeTable("usage"),
  };
  tables.businessProfile = { findUnique: async () => ({ industry: "fashion", websiteUrl: "https://shop.example", brandVoice: "friendly" }) };
  const secrets = encryptJson({ accessToken: "tok-123" });
  tables.integration.rows.push({ id: "int-1", organizationId: "org-1", provider: "meta", status: "CONNECTED", credential: { encryptedData: secrets } });
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org-1", platform: "meta", sourceType: "api", externalId: "act_777", integrationId: "int-1", name: "Main", currency: "BDT" });
  tables.product.rows.push({ id: "prod-1", organizationId: "org-1", status: "ACTIVE", name: "Cotton Panjabi", priceMinor: 150000n, currency: "BDT", category: "clothing", description: "Comfortable cotton panjabi" });
  return tables;
}
const auditStub = { log: async () => undefined } as any;
const devLlm = { getProvider: () => new DevTemplateProvider() } as any;

async function buildApprovedPlan(svc: CampaignsService) {
  const plan = await svc.createPlan("org-1", "creator-1", { name: "Eid Campaign", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
  const adSet = await svc.addAdSet("org-1", plan.id, {
    name: "BD Broad", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS",
    pageId: "page-1", pixelId: "pixel-1", countries: ["BD"],
  });
  await svc.addAd("org-1", plan.id, adSet.id, {
    name: "Ad 1", primaryText: "Cotton Panjabi - দাম BDT 1500.00", headline: "Cotton Panjabi",
    linkUrl: "https://shop.example/products/panjabi",
  });
  await svc.submitForApproval("org-1", "creator-1", plan.id);
  await svc.approve("org-1", "owner-1", plan.id);
  return plan.id;
}

function metaFetch(behavior: { failAdSetTimes?: number; failStatus?: boolean } = {}) {
  const calls: { url: string; body: string }[] = [];
  let adSetAttempts = 0;
  const fetchFn = async (url: string, init: any) => {
    calls.push({ url, body: String(init?.body ?? "") });
    if (url.includes("/campaigns")) return { ok: true, status: 200, json: async () => ({ id: "camp-100" }) };
    if (url.includes("/adsets")) {
      adSetAttempts++;
      if ((behavior.failAdSetTimes ?? 0) >= adSetAttempts) {
        return { ok: false, status: 400, json: async () => ({ error: { message: "Invalid targeting" } }) };
      }
      return { ok: true, status: 200, json: async () => ({ id: "adset-100" }) };
    }
    if (url.includes("/ads")) return { ok: true, status: 200, json: async () => ({ id: "ad-100" }) };
    const tailSegment = url.split("/").pop() ?? "";
    if (tailSegment && !["campaigns", "adsets", "ads"].includes(tailSegment)) {
      if (behavior.failStatus) return { ok: false, status: 400, json: async () => ({ error: { message: "Cannot activate" } }) };
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetchFn, calls };
}

describe("CampaignsService workflow guards", () => {
  it("an incomplete plan cannot be submitted; a draft cannot be approved or published", async () => {
    const svc = new CampaignsService(fakePrisma() as any, auditStub, devLlm);
    const plan = await svc.createPlan("org-1", "u", { name: "Empty", objective: "OUTCOME_TRAFFIC", adAccountId: "acc-1" });
    await expect(svc.submitForApproval("org-1", "u", plan.id)).rejects.toMatchObject({ code: "campaigns.planIsNotReadyForApproval" });
    await expect(svc.approve("org-1", "u", plan.id)).rejects.toMatchObject({ code: "campaigns.onlyPendingApprovalPlansCanBe" });
    await expect(svc.publish("org-1", "u", plan.id)).rejects.toMatchObject({ code: "campaigns.planMustBeApprovedBeforePublishing" });
  });

  it("approved plans are frozen for editing; rejection reopens editing", async () => {
    const svc = new CampaignsService(fakePrisma() as any, auditStub, devLlm);
    const planId = await (async () => {
      const plan = await svc.createPlan("org-1", "creator", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
      const adSet = await svc.addAdSet("org-1", plan.id, { name: "S", dailyBudget: "100", optimizationGoal: "LINK_CLICKS", pageId: "pg", countries: ["BD"] });
      await svc.addAd("org-1", plan.id, adSet.id, { name: "A", primaryText: "text", linkUrl: "https://x.example" });
      return plan.id;
    })();
    await svc.submitForApproval("org-1", "creator", planId);
    await svc.reject("org-1", "owner", planId, "Budget too high");
    // Rejected is editable again:
    const s2 = await svc.addAdSet("org-1", planId, { name: "S2", dailyBudget: "50", optimizationGoal: "LINK_CLICKS", pageId: "pg", countries: ["BD"] });
    expect(s2).toBeDefined();
    await svc.addAd("org-1", planId, s2.id, { name: "A2", primaryText: "text", linkUrl: "https://x.example" });
    await svc.submitForApproval("org-1", "creator", planId);
    await svc.approve("org-1", "owner", planId);
    await expect(svc.addAdSet("org-1", planId, { name: "S3", dailyBudget: "50", optimizationGoal: "LINK_CLICKS", pageId: "pg", countries: ["BD"] })).rejects.toMatchObject({ code: "campaigns.planIsAndCanNoLonger" });
  });

  it("sales ad sets optimizing for conversions require a pixel", async () => {
    const svc = new CampaignsService(fakePrisma() as any, auditStub, devLlm);
    const plan = await svc.createPlan("org-1", "u", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
    const adSet = await svc.addAdSet("org-1", plan.id, { name: "S", dailyBudget: "100", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg", countries: ["BD"] });
    await svc.addAd("org-1", plan.id, adSet.id, { name: "A", primaryText: "t", linkUrl: "https://x.example" });
    await expect(svc.submitForApproval("org-1", "u", plan.id)).rejects.toThrow("Pixel ID is required");
  });
});

describe("CampaignsService publishing", () => {
  it("publishes PAUSED objects, stores every external id, and logs each step", async () => {
    const prisma = fakePrisma();
    const svc = new CampaignsService(prisma as any, auditStub, devLlm);
    const planId = await buildApprovedPlan(svc);
    const { fetchFn, calls } = metaFetch();
    (global as any).fetch = fetchFn;
    const published = await svc.publish("org-1", "owner-1", planId);
    expect(published.status).toBe("published");
    expect(published.metaStatus).toBe("PAUSED");
    expect(published.externalCampaignId).toBe("camp-100");
    expect(published.adSets[0].externalAdSetId).toBe("adset-100");
    expect(published.adSets[0].ads[0].externalAdId).toBe("ad-100");
    expect(calls.every((c) => c.body.includes("status=PAUSED"))).toBe(true);
    const successLogs = prisma.campaignPublishLog.rows.filter((l: any) => l.status === "success");
    expect(successLogs.map((l: any) => l.step).sort()).toEqual(["ad", "adset", "campaign", "utm_tagged"]);
  });

  it("a partial failure keeps created ids; retry resumes without duplicating the campaign", async () => {
    const prisma = fakePrisma();
    const svc = new CampaignsService(prisma as any, auditStub, devLlm);
    const planId = await buildApprovedPlan(svc);
    const failing = metaFetch({ failAdSetTimes: 1 });
    (global as any).fetch = failing.fetchFn;
    await expect(svc.publish("org-1", "owner-1", planId)).rejects.toThrow("did NOT complete");
    const afterFail = await svc.getPlan("org-1", planId);
    expect(afterFail.status).toBe("publish_failed");
    expect(afterFail.externalCampaignId).toBe("camp-100"); // kept for resume

    const healthy = metaFetch();
    (global as any).fetch = healthy.fetchFn;
    const retried = await svc.publish("org-1", "owner-1", planId);
    expect(retried.status).toBe("published");
    // The campaign endpoint was NOT called again: no duplicate campaign.
    expect(healthy.calls.some((c) => c.url.includes("/campaigns"))).toBe(false);
  });

  it("activation is separate: failure leaves local status untouched", async () => {
    const prisma = fakePrisma();
    const svc = new CampaignsService(prisma as any, auditStub, devLlm);
    const planId = await buildApprovedPlan(svc);
    (global as any).fetch = metaFetch().fetchFn;
    await svc.publish("org-1", "owner-1", planId);
    (global as any).fetch = metaFetch({ failStatus: true }).fetchFn;
    await expect(svc.setMetaStatus("org-1", "owner-1", planId, "ACTIVE")).rejects.toThrow("did NOT confirm");
    expect((await svc.getPlan("org-1", planId)).metaStatus).toBe("PAUSED");
    (global as any).fetch = metaFetch().fetchFn;
    const activated = await svc.setMetaStatus("org-1", "owner-1", planId, "ACTIVE");
    expect(activated.metaStatus).toBe("ACTIVE");
  });
});

describe("CampaignsService AI copy", () => {
  it("dev-template copy uses the real product price and saves draft ads flagged as AI", async () => {
    const svc = new CampaignsService(fakePrisma() as any, auditStub, devLlm);
    const plan = await svc.createPlan("org-1", "u", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
    const adSet = await svc.addAdSet("org-1", plan.id, { name: "S", dailyBudget: "100", optimizationGoal: "LINK_CLICKS", pageId: "pg", countries: ["BD"] });
    const { created, provider } = await svc.generateCopy("org-1", "u", plan.id, { adSetId: adSet.id, productId: "prod-1" });
    expect(provider).toBe("dev-template");
    expect(created).toHaveLength(2);
    expect(created[0].primaryText).toContain("1500.00");
    expect(created[0].createdByAi).toBe(true);
    expect(created[0].linkUrl).toBe("https://shop.example");
  });
});
