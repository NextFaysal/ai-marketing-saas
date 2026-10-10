process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
import { CampaignsService, BLUEPRINTS } from "./campaigns.service";
import { AdsService } from "../ads/ads.service";
import { AutomationService, JOB_TYPES } from "../automation/automation.service";
import { CatalogsService } from "../catalogs/catalogs.service";
import { encryptJson } from "../integrations/crypto";

const audit = { log: async () => undefined } as any;
const llm = { getProvider: () => null } as any;

function table(name: string, rows: any[] = []) {
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => Object.entries(where ?? {}).every(([k, v]) => {
      if (v && typeof v === "object") return true;
      return r[k] === v;
    })) ?? null,
    findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id || r.organizationId === where.organizationId) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => Object.entries(where ?? {}).every(([k, v]) => {
      if (v && typeof v === "object" && "in" in (v as any)) return (v as any).in.includes(r[k]);
      if (v && typeof v === "object" && "gte" in (v as any)) return new Date(r[k]) >= new Date((v as any).gte);
      if (v && typeof v === "object") return true;
      return r[k] === v;
    })),
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); rows.splice(i, 1); return {}; },
  };
}

function basePrisma() {
  const secrets = encryptJson({ accessToken: "tok-123" });
  const t: any = {
    campaignPlan: table("plan"), campaignAdSet: table("adset"), campaignAd: table("ad"),
    campaignPublishLog: table("log"), adAccount: table("account"), integration: table("integration"),
    integrationCredential: table("cred"), product: table("product"), dailyAdMetric: table("metric"),
    dailyAdBreakdown: table("bd"), automationRule: table("rule"), automationRun: table("run"),
    catalogRecord: table("catalog"), productSet: table("pset"), businessProfile: table("bp"),
    attributionCredit: table("credit"), touchpoint: table("tp"),
  };
  t.integration.rows.push({ id: "int-1", organizationId: "org-1", provider: "meta", status: "CONNECTED" });
  t.integrationCredential.rows.push({ id: "cred-1", integrationId: "int-1", encryptedData: secrets });
  const attach = (orig: any) => async (args: any) => {
    const row = await orig(args);
    if (row && args?.include?.credential) return { ...row, credential: t.integrationCredential.rows.find((c: any) => c.integrationId === row.id) ?? null };
    return row;
  };
  t.integration.findFirst = attach(t.integration.findFirst);
  t.integration.findUnique = attach(t.integration.findUnique);
  t.adAccount.rows.push({ id: "acc-1", organizationId: "org-1", platform: "meta", sourceType: "api", externalId: "act_777", integrationId: "int-1", name: "Main", currency: "BDT" });
  return t;
}

describe("Phase K - breakdowns v2 validation", () => {
  it("accepts device/region/hourly and rejects unknown dimensions", async () => {
    const prisma = basePrisma();
    const svc = new AdsService(prisma as any, audit);
    await expect(svc.getBreakdowns("org-1", "acc-1", "device", 30)).resolves.toEqual([]);
    await expect(svc.getBreakdowns("org-1", "acc-1", "hourly", 30)).resolves.toEqual([]);
    await expect(svc.getBreakdowns("org-1", "acc-1", "bogus", 30)).rejects.toThrow(/dimension must be/);
  });
});

describe("Phase K - creative leaderboard fatigue", () => {
  it("flags an ad fatigued only when frequency is high AND ctr dropped >= 30%", async () => {
    const prisma = basePrisma();
    const day = 86400000;
    const now = Date.now();
    const row = (ad: string, daysAgo: number, o: any) => prisma.dailyAdMetric.rows.push({
      organizationId: "org-1", source: "meta", adAccountId: "acc-1", campaignExternalId: "camp-1", campaignName: "C",
      adExternalId: ad, adName: ad, date: new Date(now - daysAgo * day), spendMinor: 5000n, ...o,
    });
    // ad-fat: current freq 500/100=5, ctr 2%; previous ctr 5% -> drop 60%
    row("ad-fat", 1, { impressions: 500n, clicks: 10n, reach: 100n, conversions: 1n });
    row("ad-fat", 20, { impressions: 500n, clicks: 25n, reach: 400n, conversions: 2n });
    // ad-ok: freq 1.25, ctr steady
    row("ad-ok", 1, { impressions: 500n, clicks: 25n, reach: 400n, conversions: 3n });
    row("ad-ok", 20, { impressions: 500n, clicks: 24n, reach: 400n, conversions: 3n });
    const svc = new AdsService(prisma as any, audit);
    const out = await svc.creativeLeaderboard("org-1", 14);
    const fat = out.ads.find((a) => a.adExternalId === "ad-fat")!;
    const ok = out.ads.find((a) => a.adExternalId === "ad-ok")!;
    expect(fat.fatigued).toBe(true);
    expect(fat.fatigueReasons).toEqual(["frequency_high", "ctr_declining"]);
    expect(ok.fatigued).toBe(false);
  });
});

describe("Phase K - pacing", () => {
  it("computes month spend, projection and a CPA-gap suggestion from campaign-level rows only", async () => {
    const prisma = basePrisma();
    const now = new Date();
    const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 2));
    prisma.dailyAdMetric.rows.push(
      { organizationId: "org-1", campaignExternalId: "c1", campaignName: "Good", adExternalId: "", date: thisMonth, spendMinor: 10000n, conversions: 10n },
      { organizationId: "org-1", campaignExternalId: "c2", campaignName: "Bad", adExternalId: "", date: thisMonth, spendMinor: 10000n, conversions: 2n },
      { organizationId: "org-1", campaignExternalId: "c1", campaignName: "Good", adExternalId: "ad-9", date: thisMonth, spendMinor: 999999n, conversions: 0n }, // ad-level: must NOT count
    );
    const svc = new AdsService(prisma as any, audit);
    const out = await svc.pacing("org-1", 1000);
    expect(out.monthSpendMinor).toBe("20000");
    expect(out.pacePercent).not.toBeNull();
    expect(out.suggestions.some((s) => s.includes("Bad") && s.includes("Good"))).toBe(true);
  });
});

describe("Phase K - dayparting", () => {
  it("computes desired state from tz-aware windows (Friday noon Dhaka)", () => {
    const svc = new CampaignsService(basePrisma() as any, audit, llm);
    const friNoonDhaka = new Date("2026-10-09T06:00:00.000Z"); // Fri 12:00 +06
    expect(svc.daypartDesiredState([{ day: 5, startHour: 9, endHour: 23 }], "Asia/Dhaka", friNoonDhaka)).toBe("ACTIVE");
    expect(svc.daypartDesiredState([{ day: 6, startHour: 9, endHour: 23 }], "Asia/Dhaka", friNoonDhaka)).toBe("PAUSED");
  });

  it("transitions an ad set once and records the state", async () => {
    const prisma = basePrisma();
    prisma.campaignPlan.rows.push({ id: "plan-1", organizationId: "org-1", name: "Live", status: "published", adAccountId: "acc-1", externalCampaignId: "camp-1", metaStatus: "PAUSED" });
    prisma.campaignAdSet.rows.push({ id: "adset-1", planId: "plan-1", name: "S", externalAdSetId: "adset-x", daypart: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, startHour: 0, endHour: 24 })), daypartTz: "Asia/Dhaka", daypartState: "PAUSED" });
    (global as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({}) }) as any;
    const svc = new CampaignsService(prisma as any, audit, llm);
    const out = await svc.applyDayparting("org-1", "user-1");
    expect(out).toMatchObject({ checked: 1, transitioned: 1 });
    expect(prisma.campaignAdSet.rows[0].daypartState).toBe("ACTIVE");
    const again = await svc.applyDayparting("org-1", "user-1");
    expect(again.transitioned).toBe(0);
  });
});

describe("Phase K - A/B tests", () => {
  it("groups original + variant and refuses a winner without data", async () => {
    const prisma = basePrisma();
    prisma.campaignPlan.rows.push({ id: "plan-orig", organizationId: "org-1", name: "Sale", objective: "OUTCOME_SALES", status: "draft", adAccountId: "acc-1" });
    const svc = new CampaignsService(prisma as any, audit, llm);
    const clone: any = await svc.createAbVariant("org-1", "user-1", "plan-orig", {});
    expect(clone.abGroupId).toBeTruthy();
    expect(clone.abVariant).toBe("B");
    expect(prisma.campaignPlan.rows.find((p: any) => p.id === "plan-orig").abVariant).toBe("A");
    const board = await svc.abTestResults("org-1");
    expect(board).toHaveLength(1);
    expect(board[0].variants).toHaveLength(2);
    expect(board[0].verdict).toBe("insufficient_data");
    expect(board[0].winnerPlanId).toBeNull();
  });
});

describe("Phase K - rules v3 pause_ad", () => {
  it("pauses only the breaching ad when ad_frequency exceeds the threshold", async () => {
    const prisma = basePrisma();
    prisma.campaignPlan.rows.push({ id: "plan-1", organizationId: "org-1", name: "Live", status: "published", metaStatus: "ACTIVE", externalCampaignId: "camp-1" });
    prisma.campaignAdSet.rows.push({ id: "adset-1", planId: "plan-1", name: "S", externalAdSetId: "adset-x" });
    prisma.campaignAd.rows.push(
      { id: "ad-1", adSetId: "adset-1", name: "Tired", externalAdId: "ad-x" },
      { id: "ad-2", adSetId: "adset-1", name: "Fresh", externalAdId: "ad-y" },
    );
    const day = 86400000;
    prisma.dailyAdMetric.rows.push(
      { organizationId: "org-1", campaignExternalId: "camp-1", adExternalId: "ad-x", date: new Date(Date.now() - day), spendMinor: 5000n, impressions: 1000n, clicks: 10n, reach: 200n, conversions: 0n },
      { organizationId: "org-1", campaignExternalId: "camp-1", adExternalId: "ad-y", date: new Date(Date.now() - day), spendMinor: 5000n, impressions: 1000n, clicks: 30n, reach: 900n, conversions: 1n },
    );
    prisma.automationRule.rows.push({ id: "rule-1", organizationId: "org-1", name: "Fatigue guard", metric: "ad_frequency", comparator: "gt", threshold: 3, windowDays: 7, action: "pause_ad", targetType: "campaign_plan", enabled: true, createdById: "user-1" });
    const paused: string[] = [];
    const campaignsStub = {
      setAdStatus: async (_o: string, _a: string, _p: string, adId: string) => { paused.push(adId); },
      setMetaStatus: async () => undefined,
      scalePlanBudgets: async () => [],
      applyDayparting: async () => ({}),
    };
    const svc = new AutomationService(prisma as any, audit, {} as any, {} as any, {} as any, {} as any, {} as any, campaignsStub as any);
    const out: any = await svc.evaluateRules("org-1", "user-1");
    expect(paused).toEqual(["ad-1"]);
    expect(out.results.some((r: any) => r.triggered)).toBe(true);
    expect(JOB_TYPES).toContain("dayparting");
  });
});

describe("Phase K - product sets + catalog blueprint", () => {
  it("counts members from real products with category/price/stock filters", async () => {
    const prisma = basePrisma();
    prisma.catalogRecord.rows.push({ id: "cat-1", organizationId: "org-1", name: "Main", externalCatalogId: "123", status: "active" });
    prisma.product.rows.push(
      { id: "p1", organizationId: "org-1", status: "ACTIVE", name: "Panjabi A", category: "clothing", priceMinor: 100000n, stockQuantity: 5 },
      { id: "p2", organizationId: "org-1", status: "ACTIVE", name: "Panjabi B", category: "clothing", priceMinor: 300000n, stockQuantity: 5 },
      { id: "p3", organizationId: "org-1", status: "ACTIVE", name: "Panjabi C", category: "clothing", priceMinor: 90000n, stockQuantity: 0 },
      { id: "p4", organizationId: "org-1", status: "ACTIVE", name: "Shoe", category: "shoes", priceMinor: 80000n, stockQuantity: 3 },
    );
    const svc = new CatalogsService(prisma as any, audit);
    const set: any = await svc.createProductSet("org-1", "user-1", "cat-1", { name: "Affordable clothing", category: "clothing", maxPriceMajor: "2000" });
    expect(set.memberCount).toBe(1); // only p1: clothing + <= 200000 minor + in stock
    expect(BLUEPRINTS.some((b) => b.key === "catalog_sales")).toBe(true);
  });
});
