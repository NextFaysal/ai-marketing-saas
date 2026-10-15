import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder Next NB5 mini-fix: full-field copy
 * parity. duplicatePlan / duplicateAdSet /
 * clonePlanToAccount all ride the shared copy helpers, so
 * a copy carries EVERY plan / ad-set / ad field (CN1
 * targeting, CN2 bids + CBO budgets + cap, CN3 conversion
 * event / catalog pair, CN4 lead form, CN5 creative v2,
 * daypart, schedule) — and never the external ids or
 * non-draft state of the source.
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
    findMany: async ({ where, take, skip }: any = {}) => {
      const f = rows.filter((r) => matches(r, where ?? {}));
      const s = skip ? f.slice(skip) : f;
      return take ? s.slice(0, take) : s;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); rows.splice(i, 1); return {}; },
  };
}

const START = new Date("2026-11-01T09:00:00.000Z");
const END = new Date("2026-11-30T21:00:00.000Z");
const TARGETING = { countries: ["BD"], ageMin: 18, ageMax: 45, interests: [{ id: "6003107902433", name: "Fashion" }], customAudienceIds: ["aud-1"] };
const TEXT_OPTIONS = { primaryTexts: ["Text", "Alt text"], headlines: ["Head"], descriptions: ["Desc"] };
const PLACEMENT_ASSETS = { feed: { imageAssetId: "img-1" }, vertical: { videoAssetId: "vid-1" } };
const ENHANCEMENTS = { image_templates: true, text_optimizations: false };
const CAROUSEL = [{ title: "Card 1", linkUrl: "https://shop.example/p1" }];
const DAYPART = [{ day: 1, startHour: 9, endHour: 21 }];

function setup() {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "catalogRecord", "productSet", "leadForm"]) tables[n] = makeTable(n);
  // duplicateAdSet reads the source WITH its ads (include).
  const setFindFirst = tables.campaignAdSet.findFirst;
  tables.campaignAdSet.findFirst = async (args: any) => {
    const row = await setFindFirst(args);
    if (row && args?.include?.ads) return { ...row, ads: tables.campaignAd.rows.filter((a: any) => a.adSetId === row.id) };
    return row;
  };
  tables.catalogRecord.rows.push({ id: "cat-1", organizationId: "org", name: "Catalog" });
  tables.productSet.rows.push({ id: "pset-1", organizationId: "org", catalogRecordId: "cat-1", name: "Set" });
  tables.leadForm.rows.push({ id: "form-1", organizationId: "org", pageId: "page-1", name: "Form" });
  tables.campaignPlan.rows.push({
    id: "plan-1", organizationId: "org", adAccountId: "acc-1", name: "Full Plan", objective: "OUTCOME_SALES",
    status: "published", isTemplate: false, createdById: "u1", advantagePlus: true,
    externalCampaignId: "camp-ext", metaStatus: "PAUSED",
    approvedById: "owner-1", approvedAt: new Date(), submissionSnapshot: { name: "frozen" },
    dailyBudgetCapMinor: 900000n, budgetMode: "cbo",
    campaignDailyBudgetMinor: 800000n, campaignLifetimeBudgetMinor: 5000000n,
  });
  tables.campaignAdSet.rows.push({
    id: "set-1", planId: "plan-1", name: "Full Set", externalAdSetId: "set-ext",
    dailyBudgetMinor: 50000n, lifetimeBudgetMinor: 200000n,
    billingEvent: "IMPRESSIONS", optimizationGoal: "OFFSITE_CONVERSIONS",
    pageId: "page-1", pixelId: "px-1", targeting: TARGETING,
    startTime: START, endTime: END, daypart: DAYPART, daypartTz: "Asia/Dhaka",
    // Copy is mechanical (validation lives on the save
    // path), so every bid column is loaded at once here.
    bidStrategy: "roas_goal", bidAmountMinor: 111n, costGoalMinor: 222n, roasAverageFloor: 20000,
    conversionEvent: "PURCHASE", catalogRecordId: "cat-1", productSetId: "pset-1", leadFormId: "form-1",
  });
  tables.campaignAd.rows.push({
    id: "ad-1", adSetId: "set-1", name: "Full Ad", externalAdId: "ad-ext",
    productId: "prod-1", primaryText: "Text", headline: "Head", description: "Desc",
    linkUrl: "https://shop.example/x", callToAction: "SHOP_NOW", format: "link",
    imageAssetId: "img-1", videoAssetId: "vid-1", carouselCards: CAROUSEL, imageUrl: "https://cdn.example/x.jpg",
    textOptions: TEXT_OPTIONS, placementAssets: PLACEMENT_ASSETS, creativeEnhancements: ENHANCEMENTS,
    createdByAi: true,
  });
  const audit = { log: async () => undefined } as any;
  const svc = new CampaignsService(tables as any, audit, { getProvider: () => new DevTemplateProvider() } as any);
  return { tables, svc };
}

function expectAdSetParity(copySet: any) {
  expect(copySet.name).toBe("Full Set");
  expect(copySet.dailyBudgetMinor).toBe("50000");
  expect(copySet.lifetimeBudgetMinor).toBe("200000");
  expect(copySet.billingEvent).toBe("IMPRESSIONS");
  expect(copySet.optimizationGoal).toBe("OFFSITE_CONVERSIONS");
  expect(copySet.pageId).toBe("page-1");
  expect(copySet.pixelId).toBe("px-1");
  expect(copySet.targeting).toEqual(TARGETING);
  expect(copySet.startTime).toEqual(START);
  expect(copySet.endTime).toEqual(END);
  expect(copySet.daypart).toEqual(DAYPART);
  expect(copySet.daypartTz).toBe("Asia/Dhaka");
  expect(copySet.bidStrategy).toBe("roas_goal");
  expect(copySet.bidAmountMinor).toBe("111");
  expect(copySet.costGoalMinor).toBe("222");
  expect(copySet.roasAverageFloor).toBe(20000);
  expect(copySet.conversionEvent).toBe("PURCHASE");
  expect(copySet.catalogRecordId).toBe("cat-1");
  expect(copySet.productSetId).toBe("pset-1");
  expect(copySet.leadFormId).toBe("form-1");
  // A copy is a fresh draft: external ids never carried.
  expect(copySet.externalAdSetId ?? null).toBeNull();
  expect(copySet.id).not.toBe("set-1");
}

function expectAdParity(copyAd: any) {
  expect(copyAd.name).toBe("Full Ad");
  expect(copyAd.productId).toBe("prod-1");
  expect(copyAd.primaryText).toBe("Text");
  expect(copyAd.headline).toBe("Head");
  expect(copyAd.description).toBe("Desc");
  expect(copyAd.linkUrl).toBe("https://shop.example/x");
  expect(copyAd.callToAction).toBe("SHOP_NOW");
  expect(copyAd.format).toBe("link");
  expect(copyAd.imageAssetId).toBe("img-1");
  expect(copyAd.videoAssetId).toBe("vid-1");
  expect(copyAd.carouselCards).toEqual(CAROUSEL);
  expect(copyAd.imageUrl).toBe("https://cdn.example/x.jpg");
  expect(copyAd.textOptions).toEqual(TEXT_OPTIONS);
  expect(copyAd.placementAssets).toEqual(PLACEMENT_ASSETS);
  expect(copyAd.creativeEnhancements).toEqual(ENHANCEMENTS);
  expect(copyAd.createdByAi).toBe(true);
  expect(copyAd.externalAdId ?? null).toBeNull();
  expect(copyAd.id).not.toBe("ad-1");
}

describe("NB5 mini-fix: copy parity", () => {
  it("duplicatePlan copies every plan / ad-set / ad field, incl. the daily budget cap", async () => {
    const { svc } = setup();
    const copy: any = await svc.duplicatePlan("org", "u1", "plan-1", {});
    // Plan level.
    expect(copy.name).toBe("Full Plan (কপি)");
    expect(copy.objective).toBe("OUTCOME_SALES");
    expect(copy.adAccountId).toBe("acc-1");
    expect(copy.advantagePlus).toBe(true);
    expect(copy.budgetMode).toBe("cbo");
    expect(copy.campaignDailyBudgetMinor).toBe("800000");
    expect(copy.campaignLifetimeBudgetMinor).toBe("5000000");
    expect(copy.dailyBudgetCapMinor).toBe("900000"); // the NB4 finding: was dropped
    // The copy is a NEW draft — source state/external ids stay behind.
    expect(copy.status).toBe("draft");
    expect(copy.externalCampaignId ?? null).toBeNull();
    expect(copy.approvedById ?? null).toBeNull();
    expect(copy.submissionSnapshot ?? null).toBeNull();
    expect(copy.id).not.toBe("plan-1");
    // Ad set + ad level.
    expect(copy.adSets).toHaveLength(1);
    expectAdSetParity(copy.adSets[0]);
    expect(copy.adSets[0].ads).toHaveLength(1);
    expectAdParity(copy.adSets[0].ads[0]);
  });

  it("duplicateAdSet copies the ad set fully AND the ads' CN5 fields", async () => {
    const { tables, svc } = setup();
    // duplicateAdSet is an in-plan edit — the plan must be editable.
    tables.campaignPlan.rows[0].status = "draft";
    const copy: any = await svc.duplicateAdSet("org", "plan-1", "set-1", "u1");
    expect(copy.name).toBe("Full Set (কপি)");
    expect(copy.dailyBudgetMinor).toBe("50000");
    expect(copy.lifetimeBudgetMinor).toBe("200000");
    expect(copy.billingEvent).toBe("IMPRESSIONS");
    expect(copy.optimizationGoal).toBe("OFFSITE_CONVERSIONS");
    expect(copy.pageId).toBe("page-1");
    expect(copy.pixelId).toBe("px-1");
    expect(copy.targeting).toEqual(TARGETING);
    expect(copy.startTime).toEqual(START);
    expect(copy.endTime).toEqual(END);
    expect(copy.daypart).toEqual(DAYPART);
    expect(copy.daypartTz).toBe("Asia/Dhaka");
    expect(copy.bidStrategy).toBe("roas_goal");
    expect(copy.bidAmountMinor).toBe("111");
    expect(copy.costGoalMinor).toBe("222");
    expect(copy.roasAverageFloor).toBe(20000);
    expect(copy.conversionEvent).toBe("PURCHASE");
    expect(copy.catalogRecordId).toBe("cat-1");
    expect(copy.productSetId).toBe("pset-1");
    expect(copy.leadFormId).toBe("form-1");
    expect(copy.externalAdSetId ?? null).toBeNull();
    // The NB5 gap: duplicateAdSet's ad copy missed CN5.
    expect(copy.ads).toHaveLength(1);
    expectAdParity(copy.ads[0]);
  });
});
