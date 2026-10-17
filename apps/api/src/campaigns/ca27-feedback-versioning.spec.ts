import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder Advanced CA27 (CB6):
 * (a) Winner-trait facts from REAL rows only — A/B
 * verdict winners (winnerPlanId, verdict-gated) plus
 * proven performers (ad-level metrics clearing the
 * CA25 bars with >= 5 conversions). A trait value is
 * emitted only with >= 3 winners behind it; below that
 * it is suppressed and counted, never presented as a
 * pattern. Text-overlay is honestly excluded: CA5
 * vision stores no per-asset result.
 * (b) Per-ad versioning: updateAd snapshots the
 * BEFORE image only when content actually changes;
 * diff compares a version to the current ad; restore
 * writes the snapshot back AND appends the pre-restore
 * state as a new version (append-only history), never
 * touching the ad's external (Meta) binding.
 * (c) Catalog carousel assembly from a product set's
 * real Product rows (stored criteria); existing manual
 * cards are never stomped without an explicit replace,
 * and applying rides updateAd so the old cards are
 * versioned first.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      return true; // nested relation filters are permissive in this harness
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
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
  };
}
const auditStub = { log: async () => undefined } as any;
const devLlm = { getProvider: () => new DevTemplateProvider() } as any;

function basePrisma() {
  const tables: any = {
    campaignPlan: makeTable("plan"), campaignAdSet: makeTable("adset"), campaignAd: makeTable("ad"),
    campaignPublishLog: makeTable("log"), campaignPlanVersion: makeTable("version"), campaignAdVersion: makeTable("adversion"),
    adAccount: makeTable("account"), dailyAdMetric: makeTable("metric"), creativeAsset: makeTable("ca"),
    product: makeTable("product"), productSet: makeTable("pset"),
  };
  tables.businessProfile = { findUnique: async () => ({ organizationId: "org-1", industry: "fashion", websiteUrl: "https://shop.example" }) };
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org-1", platform: "meta", externalId: "act_777", name: "Main", currency: "BDT" });
  return tables;
}

describe("CA27(a) winner traits", () => {
  function traitService() {
    const prisma = basePrisma();
    // A/B winner plan with 3 video ads (short text, vertical assets)
    prisma.campaignPlan.rows.push({ id: "plan-w", organizationId: "org-1", name: "W", objective: "OUTCOME_SALES", status: "published", adAccountId: "acc-1" });
    prisma.campaignAdSet.rows.push({ id: "set-w", planId: "plan-w", name: "SW" });
    for (let i = 1; i <= 3; i++) {
      prisma.campaignAd.rows.push({ id: `ad-w${i}`, adSetId: "set-w", name: `W${i}`, format: "video", primaryText: "ছোট লেখা", callToAction: "SHOP_NOW", videoAssetId: `ca-v${i}`, linkUrl: "https://shop.example" });
      prisma.creativeAsset.rows.push({ id: `ca-v${i}`, organizationId: "org-1", width: 1080, height: 1920 });
    }
    // one proven performer (link format, long text) — its traits have sample 1
    prisma.campaignPlan.rows.push({ id: "plan-p", organizationId: "org-1", name: "P", objective: "OUTCOME_SALES", status: "published", adAccountId: "acc-1" });
    prisma.campaignAdSet.rows.push({ id: "set-p", planId: "plan-p", name: "SP" });
    prisma.campaignAd.rows.push({ id: "ad-p1", adSetId: "set-p", name: "P1", format: "link", primaryText: "x".repeat(200), callToAction: "LEARN_MORE", externalAdId: "ext-P1", linkUrl: "https://shop.example" });
    prisma.dailyAdMetric.rows.push({ organizationId: "org-1", level: "ad", adExternalId: "ext-P1", impressions: 6000, clicks: 100, spendMinor: 60000, conversions: 10 });
    // a non-winner: below the bars
    prisma.campaignAd.rows.push({ id: "ad-n1", adSetId: "set-p", name: "N1", format: "carousel", primaryText: "মাঝারি লেখা এখানে আছে কিছুটা বড় করে লেখা হলো যাতে মাঝারি বাকেটে পড়ে ঠিকঠাক ভাবে", callToAction: "SHOP_NOW", externalAdId: "ext-N1", linkUrl: "https://shop.example" });
    prisma.dailyAdMetric.rows.push({ organizationId: "org-1", level: "ad", adExternalId: "ext-N1", impressions: 100, clicks: 5, spendMinor: 500, conversions: 0 });
    const svc: any = new CampaignsService(prisma as any, auditStub, devLlm);
    svc.abTestResults = async () => [{ groupId: "g1", winnerPlanId: "plan-w", verdict: "winner_by_cpa" }];
    return svc;
  }

  it("emits only traits with >= 3 winners, suppresses the rest with counts, and composes the labelled facts line", async () => {
    const svc = traitService();
    const out = await svc.winnerTraits("org-1");
    expect(out.winnersConsidered).toBe(4);
    expect(out.sources).toEqual({ abVerdict: 3, provenPerformer: 1 });
    const keys = out.traits.map((t: any) => `${t.trait}:${t.value}`);
    expect(keys).toContain("format:video");
    expect(keys.some((k: string) => k.startsWith("aspect:") && k.includes("উল্লম্ব"))).toBe(true);
    expect(keys.some((k: string) => k.startsWith("cta:SHOP_NOW"))).toBe(true); // 3 winners share SHOP_NOW — emitted; LEARN_MORE (1) is suppressed below
    expect(out.factsBn).toContain("আগের বিজয়ী বিজ্ঞাপনগুলোর বৈশিষ্ট্য");
    expect(out.factsBn).toContain("video (3টি)");
    // single-sample traits are suppressed, never emitted
    expect(out.traits.some((t: any) => t.value === "link")).toBe(false);
    expect(out.suppressed.some((t: any) => t.trait === "format" && t.value === "link" && t.count === 1)).toBe(true);
    expect(out.suppressed.some((t: any) => t.trait === "cta" && t.value === "LEARN_MORE" && t.count === 1)).toBe(true);
    // text overlay is honestly excluded — no stored vision signal
    expect(out.excluded.join(" ")).toContain("টেক্সট-ওভারলে");
    expect(out.traits.some((t: any) => t.trait === "textOverlay")).toBe(false);
  });

  it("an org with no winners gets no facts line at all", async () => {
    const svc: any = new CampaignsService(basePrisma() as any, auditStub, devLlm);
    svc.abTestResults = async () => [];
    const out = await svc.winnerTraits("org-1");
    expect(out.winnersConsidered).toBe(0);
    expect(out.factsBn).toBe("");
    expect(out.traits).toEqual([]);
  });
});

describe("CA27(b) ad versioning", () => {
  async function adFixture() {
    const prisma = basePrisma();
    const svc: any = new CampaignsService(prisma as any, auditStub, devLlm);
    const plan = await svc.createPlan("org-1", "u", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
    const adSet = await svc.addAdSet("org-1", plan.id, { name: "S", dailyBudget: "500", optimizationGoal: "LINK_CLICKS", countries: ["BD"] });
    const ad = await svc.addAd("org-1", plan.id, adSet.id, { name: "A", primaryText: "আসল লেখা", headline: "H1", linkUrl: "https://shop.example" });
    // a live binding that restore must never touch
    prisma.campaignAd.rows.find((r: any) => r.id === ad.id).externalAdId = "ext-live-1";
    return { prisma, svc, planId: plan.id, adId: ad.id };
  }

  it("snapshots the before-image only on real change; restore appends and never rewrites", async () => {
    const { prisma, svc, planId, adId } = await adFixture();
    await svc.updateAd("org-1", planId, adId, "u", { primaryText: "নতুন লেখা" });
    let versions = await svc.adVersions("org-1", planId, adId);
    expect(versions.versions).toHaveLength(1);
    expect(versions.versions[0].version).toBe(1);
    expect(versions.versions[0].source).toBe("edit");
    const v1 = prisma.campaignAdVersion.rows[0];
    expect(v1.snapshot.primaryText).toBe("আসল লেখা");
    // no-op edit creates NO version
    await svc.updateAd("org-1", planId, adId, "u", { primaryText: "নতুন লেখা" });
    versions = await svc.adVersions("org-1", planId, adId);
    expect(versions.versions).toHaveLength(1);
    // diff v1 vs current
    const diff = await svc.adVersionDiff("org-1", planId, adId, v1.id);
    expect(diff.identical).toBe(false);
    const pt = diff.changes.find((c: any) => c.field === "primaryText");
    expect(pt.versionValue).toBe("আসল লেখা");
    expect(pt.currentValue).toBe("নতুন লেখা");
    // restore v1: text returns; a v2 (source restore) preserves the pre-restore state; binding untouched
    const restored = await svc.restoreAdVersion("org-1", planId, adId, "u", v1.id);
    expect(restored.primaryText).toBe("আসল লেখা");
    expect(restored.externalAdId).toBe("ext-live-1");
    versions = await svc.adVersions("org-1", planId, adId);
    expect(versions.versions).toHaveLength(2);
    const v2 = prisma.campaignAdVersion.rows.find((r: any) => r.version === 2);
    expect(v2.source).toBe("restore");
    expect(v2.snapshot.primaryText).toBe("নতুন লেখা");
    // restoring v2 brings the newer text back — history only grows
    await svc.restoreAdVersion("org-1", planId, adId, "u", v2.id);
    const adNow = prisma.campaignAd.rows.find((r: any) => r.id === adId);
    expect(adNow.primaryText).toBe("নতুন লেখা");
    expect(prisma.campaignAdVersion.rows).toHaveLength(3);
  });
});

describe("CA27(c) catalog carousel assembly", () => {
  async function carouselFixture(withManualCards: boolean) {
    const prisma = basePrisma();
    const svc: any = new CampaignsService(prisma as any, auditStub, devLlm);
    const plan = await svc.createPlan("org-1", "u", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
    const adSet = await svc.addAdSet("org-1", plan.id, { name: "S", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", countries: ["BD"] });
    prisma.campaignAdSet.rows.find((r: any) => r.id === adSet.id).productSetId = "set-1";
    const ad = await svc.addAd("org-1", plan.id, adSet.id, { name: "A", primaryText: "লেখা", linkUrl: "https://shop.example/landing" });
    prisma.productSet.rows.push({ id: "set-1", organizationId: "org-1", catalogRecordId: "cat-1", name: "Winter", category: "winter", maxPriceMinor: 50000n, inStockOnly: true, status: "local", createdById: "u" });
    const prod = (id: string, name: string, over: any = {}) => prisma.product.rows.push({ id, organizationId: "org-1", name, category: "winter", priceMinor: 10000n, currency: "BDT", status: "ACTIVE", stockQuantity: 5, imageUrl: `https://cdn.example/${id}.jpg`, ...over });
    prod("p1", "শীতের জ্যাকেট", { priceMinor: 25000n });
    prod("p2", "শীতের সোয়েটার", { stockQuantity: null });
    prod("p3", "শেষ স্টক", { stockQuantity: 0 });
    prod("p4", "গ্রীষ্মের টি", { category: "summer" });
    if (withManualCards) {
      prisma.campaignAd.rows.find((r: any) => r.id === ad.id).carouselCards = [
        { title: "হাতে বসানো ১", linkUrl: "https://shop.example/a" },
        { title: "হাতে বসানো ২", linkUrl: "https://shop.example/b" },
      ];
      prisma.campaignAd.rows.find((r: any) => r.id === ad.id).format = "carousel";
    }
    return { prisma, svc, planId: plan.id, adId: ad.id };
  }

  it("builds cards from the set's real products (criteria applied, out-of-stock excluded)", async () => {
    const { svc, planId, adId } = await carouselFixture(false);
    const out = await svc.assembleCatalogCarousel("org-1", "u", planId, adId, {});
    expect(out.applied).toBe(true);
    expect(out.cards).toHaveLength(2);
    const titles = out.cards.map((c: any) => c.title).sort();
    expect(titles).toEqual(["শীতের জ্যাকেট", "শীতের সোয়েটার"]);
    expect(out.cards[0].linkUrl).toBe("https://shop.example/landing");
    expect(out.cards.map((c: any) => c.description).join(" ")).toContain("250");
    expect(out.ad.format).toBe("carousel");
  });

  it("manual cards are preserved without replace; with replace they are versioned first", async () => {
    const { prisma, svc, planId, adId } = await carouselFixture(true);
    const preview = await svc.assembleCatalogCarousel("org-1", "u", planId, adId, {});
    expect(preview.applied).toBe(false);
    expect(preview.previewCards).toHaveLength(2);
    const adRow = prisma.campaignAd.rows.find((r: any) => r.id === adId);
    expect(adRow.carouselCards[0].title).toBe("হাতে বসানো ১");
    const applied = await svc.assembleCatalogCarousel("org-1", "u", planId, adId, { replace: true });
    expect(applied.applied).toBe(true);
    expect(adRow.carouselCards).toHaveLength(2);
    expect(adRow.carouselCards[0].title).not.toBe("হাতে বসানো ১");
    // the manual cards survive as a restorable version
    const versions = prisma.campaignAdVersion.rows.filter((r: any) => r.adId === adId);
    expect(versions.length).toBeGreaterThanOrEqual(1);
    expect(versions[0].snapshot.carouselCards[0].title).toBe("হাতে বসানো ১");
  });

  it("an ad set with no product set refuses honestly", async () => {
    const prisma = basePrisma();
    const svc: any = new CampaignsService(prisma as any, auditStub, devLlm);
    const plan = await svc.createPlan("org-1", "u", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
    const adSet = await svc.addAdSet("org-1", plan.id, { name: "S", dailyBudget: "500", optimizationGoal: "LINK_CLICKS", countries: ["BD"] });
    const ad = await svc.addAd("org-1", plan.id, adSet.id, { name: "A", primaryText: "লেখা", linkUrl: "https://shop.example" });
    await expect(svc.assembleCatalogCarousel("org-1", "u", plan.id, ad.id, {})).rejects.toThrow(/Product Set/);
  });
});
