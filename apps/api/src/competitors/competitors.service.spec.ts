import { CompetitorsService } from "./competitors.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

process.env.FACEBOOK_AD_LIBRARY_TOKEN = "test-token";

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
      if (orderBy?.startedAt === "asc") f = [...f].sort((a, b) => new Date(a.startedAt ?? 0).getTime() - new Date(b.startedAt ?? 0).getTime());
      if (orderBy?.observedAt === "desc") f = [...f].sort((a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime());
      if (orderBy?.createdAt === "desc") f = [...f].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return take ? f.slice(0, take) : f;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); Object.assign(row, data); return row; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); rows.splice(i, 1); return {}; },
  };
}
function fakePrisma() {
  return {
    competitor: makeTable("competitor"), competitorAd: makeTable("ad"),
    competitorPriceObservation: makeTable("obs"), competitorInsight: makeTable("insight"),
    product: makeTable("product"), aIUsageRecord: makeTable("usage"),
    integration: makeTable("integration"),
  };
}
const auditStub = { log: async () => undefined } as any;
const devLlm = { getProvider: () => new DevTemplateProvider() } as any;

const AD_HTML_PAGE = `<html><head><script type="application/ld+json">{"@type":"Product","name":"Cotton Panjabi","offers":{"price":"1200","priceCurrency":"BDT"}}</script></head></html>`;

describe("CompetitorsService", () => {
  it("syncAds upserts by archive id (no duplicates on re-sync)", async () => {
    const prisma = fakePrisma();
    const svc = new CompetitorsService(prisma as any, auditStub, devLlm);
    const competitor = await svc.create("org-1", "u", { name: "Rival", facebookPageId: "555" });
    (global as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: [
      { id: "ad-1", page_id: "555", page_name: "Rival", ad_delivery_start_time: "2026-09-15T00:00:00+0000", publisher_platforms: ["facebook"], ad_creative_bodies: ["Sale!"], ad_snapshot_url: "https://www.facebook.com/ads/library/?id=ad-1" },
      { id: "ad-2", page_id: "555", page_name: "Rival", ad_delivery_start_time: "2026-10-01T00:00:00+0000", ad_snapshot_url: "https://www.facebook.com/ads/library/?id=ad-2" },
    ] }) });
    const first = await svc.syncAds("org-1", "u", competitor.id);
    expect(first).toMatchObject({ fetched: 2, created: 2 });
    const second = await svc.syncAds("org-1", "u", competitor.id);
    expect(second).toMatchObject({ created: 0, updated: 2 });
    expect(prisma.competitorAd.rows).toHaveLength(2);
  });

  it("scanWebsite stores observations with the page URL as evidence", async () => {
    const prisma = fakePrisma();
    const svc = new CompetitorsService(prisma as any, auditStub, devLlm);
    const competitor = await svc.create("org-1", "u", { name: "Rival", websiteUrl: "https://rival.example/" });
    (global as any).fetch = async (url: string) => {
      if (url.endsWith("/robots.txt")) return { ok: true, status: 200, text: async () => "User-agent: *\nAllow: /" };
      if (url.endsWith("/sitemap.xml")) return { ok: true, status: 200, text: async () => `<urlset><url><loc>https://rival.example/products/panjabi</loc></url></urlset>` };
      if (url.includes("/products/panjabi")) return { ok: true, status: 200, text: async () => AD_HTML_PAGE };
      return { ok: true, status: 200, text: async () => "<html></html>" };
    };
    const result = await svc.scanWebsite("org-1", "u", competitor.id);
    expect(result.stored).toBe(1);
    expect(prisma.competitorPriceObservation.rows[0]).toMatchObject({
      productName: "Cotton Panjabi", priceMinor: 120000n, sourceType: "website_scan",
      sourceUrl: "https://rival.example/products/panjabi",
    });
  });

  it("manual observations without a source URL are rejected (evidence is mandatory)", async () => {
    const svc = new CompetitorsService(fakePrisma() as any, auditStub, devLlm);
    const competitor = await svc.create("org-1", "u", { name: "Rival" });
    await expect(svc.addObservation("org-1", competitor.id, { productName: "X", price: "100", sourceUrl: "" })).rejects.toThrow("evidence");
  });

  it("priceComparison matches by name, reports the diff, and admits gaps honestly", async () => {
    const prisma = fakePrisma();
    const svc = new CompetitorsService(prisma as any, auditStub, devLlm);
    await (prisma as any).product.create({ data: { organizationId: "org-1", status: "ACTIVE", name: "Cotton Panjabi", priceMinor: 150000n, currency: "BDT" } });
    await (prisma as any).product.create({ data: { organizationId: "org-1", status: "ACTIVE", name: "Silk Scarf", priceMinor: 90000n, currency: "BDT" } });
    const competitor = await svc.create("org-1", "u", { name: "Rival" });
    await svc.addObservation("org-1", competitor.id, { productName: "Cotton Panjabi Premium", price: "1200", sourceUrl: "https://rival.example/p" });
    const { rows } = await svc.priceComparison("org-1");
    const panjabi = rows.find((r: any) => r.productName === "Cotton Panjabi");
    expect(panjabi!.competitorPrices[0]).toMatchObject({ diffPercent: -20, competitorName: "Rival" });
    const scarf = rows.find((r: any) => r.productName === "Silk Scarf");
    expect(scarf!.competitorPrices).toEqual([]); // no evidence, no invented competitor price
  });

  it("insights require valid evidence; fake LLM citations are dropped", async () => {
    const prisma = fakePrisma();
    const competitorRow = { id: "comp-1", organizationId: "org-1", name: "Rival" };
    (prisma.competitor.rows as any[]).push(competitorRow);
    (prisma.competitorPriceObservation.rows as any[]).push({
      id: "obs-1", competitorId: "comp-1", productName: "Cotton Panjabi", priceMinor: 120000n,
      currency: "BDT", sourceUrl: "https://rival.example/p", sourceType: "manual", observedAt: new Date(),
    });
    const fakeLlm = {
      getProvider: () => ({
        name: "fake-llm", isRealLlm: true,
        complete: async () => ({
          text: JSON.stringify({ insights: [
            { kind: "pricing", title: "Rival lists Panjabi at 1200", evidenceRefs: ["price:obs-1"] },
            { kind: "pricing", title: "Invented claim", evidenceRefs: ["price:DOES-NOT-EXIST"] },
            { kind: "activity", title: "No evidence at all", evidenceRefs: [] },
          ] }),
          model: "fake", inputTokens: 10, outputTokens: 5, tokensEstimated: false,
        }),
      }),
    } as any;
    const svc = new CompetitorsService(prisma as any, auditStub, fakeLlm);
    const result = await svc.generateInsights("org-1", "u", "comp-1");
    expect(result.generated).toBe(1);
    expect(result.droppedWithoutEvidence).toBe(2);
    expect(prisma.competitorInsight.rows[0].evidence[0].url).toBe("https://rival.example/p");
  });

  it("generating insights with zero collected evidence is refused, not faked", async () => {
    const svc = new CompetitorsService(fakePrisma() as any, auditStub, devLlm);
    const competitor = await svc.create("org-1", "u", { name: "Empty Rival" });
    await expect(svc.generateInsights("org-1", "u", competitor.id)).rejects.toThrow("never generated without evidence");
  });

  it("listAds identifies winning ads running for 14+ days", async () => {
    const prisma = fakePrisma();
    const svc = new CompetitorsService(prisma as any, auditStub, devLlm);
    const competitor = await svc.create("org-1", "u", { name: "Rival Winning" });
    
    // Old active ad running for 25 days
    const twentyFiveDaysAgo = new Date(Date.now() - 25 * 86400000);
    await (prisma as any).competitorAd.create({
      data: {
        competitorId: competitor.id,
        externalAdId: "ad-winning",
        startedAt: twentyFiveDaysAgo,
        isActive: true,
        platforms: ["facebook"],
        creativeText: "Winning Ad Text",
      },
    });

    // Fresh ad running for 2 days
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000);
    await (prisma as any).competitorAd.create({
      data: {
        competitorId: competitor.id,
        externalAdId: "ad-fresh",
        startedAt: twoDaysAgo,
        isActive: true,
        platforms: ["facebook"],
        creativeText: "Fresh Ad Text",
      },
    });

    const ads = await svc.listAds("org-1", competitor.id);
    const winning = ads.find((a: any) => a.externalAdId === "ad-winning");
    const fresh = ads.find((a: any) => a.externalAdId === "ad-fresh");

    expect(winning?.isWinning).toBe(true);
    expect(winning?.daysRunning).toBeGreaterThanOrEqual(24);
    expect(fresh?.isWinning).toBe(false);
    expect(fresh?.isFresh).toBe(true);
  });

  it("generateCounterAd outputs strategic hook breakdown and counter-campaign", async () => {
    const prisma = fakePrisma();
    const svc = new CompetitorsService(prisma as any, auditStub, devLlm);
    const competitor = await svc.create("org-1", "u", { name: "Rival Fashion" });

    const ad = await (prisma as any).competitorAd.create({
      data: {
        competitorId: competitor.id,
        externalAdId: "ad-comp-1",
        startedAt: new Date(Date.now() - 10 * 86400000),
        isActive: true,
        platforms: ["facebook"],
        creativeText: "Buy our panjabi for cheap discounts!",
      },
    });

    const counter = await svc.generateCounterAd("org-1", "u", {
      competitorAdId: ad.id,
    });

    expect(counter.hookBreakdown).toBeDefined();
    expect(counter.counterCampaign.headline).toBeDefined();
    expect(counter.counterCampaign.primaryText).toBeDefined();
    expect(counter.counterCampaign.callToAction).toBeDefined();
  });
});

