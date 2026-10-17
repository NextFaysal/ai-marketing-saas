import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder Advanced CA28 (CB6): landing pages
 * from the builder. VERIFY result: the EC13 landing
 * machinery (LandingsService + LandingPage) is
 * product-bound and org-scoped, its public rendering
 * composes the Product row's own name/price/images,
 * and only PUBLISHED landings serve publicly — so a
 * plan-scoped page needs NO new page type: creation
 * delegates to LandingsService unchanged, and the
 * builder adds (1) product resolution from the plan/ad
 * and (2) a separate, explicit apply step that writes
 * the landing URL into an ad's linkUrl ONLY for a
 * published landing and ONLY when the user confirms
 * (creation never touches the ad). LandingsService
 * itself is stubbed at its public seam here — the real
 * service's slug/section/render behaviour is covered
 * by the landings module's own specs; this spec pins
 * the builder-side contract. The URL base follows the
 * feeds precedent (WEB_PUBLIC_URL ?? APP_PUBLIC_URL).
 */
process.env.WEB_PUBLIC_URL = "https://app.example";

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
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
  };
}
const auditStub = { log: async () => undefined } as any;
const devLlm = { getProvider: () => new DevTemplateProvider() } as any;

function fixture(withLandings = true) {
  const tables: any = {
    campaignPlan: makeTable("plan"), campaignAdSet: makeTable("adset"), campaignAd: makeTable("ad"),
    campaignPublishLog: makeTable("log"), campaignPlanVersion: makeTable("version"), campaignAdVersion: makeTable("adversion"),
    adAccount: makeTable("account"), product: makeTable("product"), landingPage: makeTable("landing"),
  };
  tables.businessProfile = { findUnique: async () => ({ organizationId: "org-1", industry: "fashion", websiteUrl: "https://shop.example" }) };
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org-1", platform: "meta", externalId: "act_777", name: "Main", currency: "BDT" });
  tables.product.rows.push({ id: "prod-1", organizationId: "org-1", name: "শীতের জ্যাকেট প্রিমিয়াম", priceMinor: 250000n, currency: "BDT", status: "ACTIVE", imageUrl: "https://cdn.example/jacket.jpg" });
  let slugSeq = 0;
  const landingsStub: any = {
    async create(orgId: string, _actor: string, dto: any) {
      const row = {
        id: `land-${++slugSeq}`, organizationId: orgId, productId: dto.productId,
        slug: `landing-${slugSeq}`, title: dto.title, status: dto.status ?? "draft",
        sections: null, upsellProductId: null, createdAt: new Date(), updatedAt: new Date(),
      };
      tables.landingPage.rows.push(row);
      return { ...row };
    },
    async list(orgId: string) {
      return tables.landingPage.rows.filter((r: any) => r.organizationId === orgId).map((r: any) => ({ ...r }));
    },
  };
  const svc: any = new CampaignsService(
    tables as any, auditStub, devLlm,
    undefined, undefined, undefined, undefined, undefined,
    withLandings ? landingsStub : undefined,
  );
  return { tables, svc };
}

async function planWithAd(svc: any, withProduct: boolean) {
  const plan = await svc.createPlan("org-1", "u", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
  const adSet = await svc.addAdSet("org-1", plan.id, { name: "S", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", countries: ["BD"] });
  const ad = await svc.addAd("org-1", plan.id, adSet.id, {
    name: "A", primaryText: "লেখা", linkUrl: "https://shop.example/old",
    ...(withProduct ? { productId: "prod-1" } : {}),
  });
  return { planId: plan.id, adId: ad.id };
}

describe("CA28 builder landing pages", () => {
  it("creates a landing from the ad's REAL product (draft by default) and never touches the ad", async () => {
    const { tables, svc } = fixture();
    const { planId, adId } = await planWithAd(svc, true);
    const out = await svc.createPlanLanding("org-1", "u", planId, { adId });
    expect(out.landing.productId).toBe("prod-1");
    expect(out.landing.title).toBe("শীতের জ্যাকেট প্রিমিয়াম"); // the Product row's own name
    expect(out.landing.status).toBe("draft");
    expect(out.path).toBe("/l/landing-1");
    expect(out.url).toBe("https://app.example/l/landing-1");
    expect(out.product.name).toBe("শীতের জ্যাকেট প্রিমিয়াম");
    const adRow = tables.campaignAd.rows.find((r: any) => r.id === adId);
    expect(adRow.linkUrl).toBe("https://shop.example/old"); // creation did NOT overwrite
  });

  it("a published landing applies to the ad only through the explicit step; the old link is versioned", async () => {
    const { tables, svc } = fixture();
    const { planId, adId } = await planWithAd(svc, true);
    const out = await svc.createPlanLanding("org-1", "u", planId, { adId, publish: true });
    expect(out.landing.status).toBe("published");
    const applied = await svc.applyLandingToAd("org-1", "u", planId, adId, out.landing.id);
    expect(applied.url).toBe("https://app.example/l/landing-1");
    expect(applied.ad.linkUrl).toBe("https://app.example/l/landing-1");
    const versions = tables.campaignAdVersion.rows.filter((r: any) => r.adId === adId);
    expect(versions.length).toBeGreaterThanOrEqual(1);
    expect(versions[0].snapshot.linkUrl).toBe("https://shop.example/old");
  });

  it("a DRAFT landing is refused for apply — the public machinery serves published pages only", async () => {
    const { svc } = fixture();
    const { planId, adId } = await planWithAd(svc, true);
    const out = await svc.createPlanLanding("org-1", "u", planId, { adId });
    await expect(svc.applyLandingToAd("org-1", "u", planId, adId, out.landing.id)).rejects.toThrow(/Publish করা Landing ছাড়া/);
  });

  it("no product anywhere in the plan: honest refusal; an ad without a product refuses too", async () => {
    const { svc } = fixture();
    const { planId, adId } = await planWithAd(svc, false);
    await expect(svc.createPlanLanding("org-1", "u", planId, {})).rejects.toThrow(/Product যুক্ত নেই/);
    await expect(svc.createPlanLanding("org-1", "u", planId, { adId })).rejects.toThrow(/Product যুক্ত নেই/);
  });

  it("plan-level creation resolves the product from another ad that carries one", async () => {
    const { svc } = fixture();
    const plan = await svc.createPlan("org-1", "u", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
    const adSet = await svc.addAdSet("org-1", plan.id, { name: "S", dailyBudget: "500", optimizationGoal: "LINK_CLICKS", countries: ["BD"] });
    await svc.addAd("org-1", plan.id, adSet.id, { name: "A1", primaryText: "x", linkUrl: "https://shop.example" });
    await svc.addAd("org-1", plan.id, adSet.id, { name: "A2", primaryText: "y", linkUrl: "https://shop.example", productId: "prod-1" });
    const out = await svc.createPlanLanding("org-1", "u", plan.id, {});
    expect(out.landing.productId).toBe("prod-1");
  });

  it("existing landings for the same product are offered alongside a fresh creation", async () => {
    const { tables, svc } = fixture();
    const { planId, adId } = await planWithAd(svc, true);
    tables.landingPage.rows.push({ id: "land-old", organizationId: "org-1", productId: "prod-1", slug: "old-landing", title: "Old", status: "published", sections: null, upsellProductId: null, createdAt: new Date(), updatedAt: new Date() });
    const out = await svc.createPlanLanding("org-1", "u", planId, { adId });
    expect(out.existingForProduct).toHaveLength(1);
    expect(out.existingForProduct[0].slug).toBe("old-landing");
    expect(out.existingForProduct[0].url).toBe("https://app.example/l/old-landing");
  });

  it("without a wired LandingsService the path refuses honestly", async () => {
    const { svc } = fixture(false);
    const { planId, adId } = await planWithAd(svc, true);
    await expect(svc.createPlanLanding("org-1", "u", planId, { adId })).rejects.toThrow(/Landing Service/);
  });
});
