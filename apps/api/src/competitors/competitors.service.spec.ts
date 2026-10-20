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
    await expect(svc.addObservation("org-1", competitor.id, { productName: "X", price: "100", sourceUrl: "" })).rejects.toMatchObject({ code: "competitors.aSourceUrlIsRequiredAs" });
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
    await expect(svc.generateInsights("org-1", "u", competitor.id)).rejects.toMatchObject({ code: "competitors.noCompetitorEvidenceCollectedYetSync" });
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
    // HF5: dev-template provider -> the draft is labeled "template".
    expect(counter.origin).toBe("template");
    expect(counter.counterCampaign.headline).toBeDefined();
    expect(counter.counterCampaign.primaryText).toBeDefined();
    expect(counter.counterCampaign.callToAction).toBeDefined();
  });

  it("getSeoTrafficReport returns a REAL on-page audit of observed facts only (HF2)", async () => {
    const prisma = fakePrisma();
    const svc = new CompetitorsService(prisma as any, auditStub, devLlm);
    const competitor = await svc.create("org-1", "u", {
      name: "Apex Footwear",
      websiteUrl: "https://apexfootwear.com",
    });
    const SEO_HTML = `<html><head>
      <title>Apex Footwear — Best Shoes in Bangladesh</title>
      <meta name="description" content="Buy original Apex shoes online with cash on delivery.">
      <meta property="og:title" content="Apex Footwear">
      <script type="application/ld+json">{"@type":"Product","name":"Running Shoe","offers":{"price":"2500","priceCurrency":"BDT"}}</script>
      </head><body>
      <h1>Premium Shoes Collection</h1><h2>New Arrivals</h2>
      <a href="https://apexfootwear.com/shop">Shop</a>
      <a href="/products/running-shoe">Running Shoe</a>
      <a href="/offers/eid-sale">Eid Sale</a>
      </body></html>`;
    (global as any).fetch = async (url: string) => {
      if (url.endsWith("/robots.txt")) return { ok: true, status: 200, text: async () => "User-agent: *\nAllow: /" };
      if (url.endsWith("/sitemap.xml")) return { ok: true, status: 200, text: async () => "<urlset></urlset>" };
      return { ok: true, status: 200, text: async () => SEO_HTML };
    };

    const report = await svc.getSeoTrafficReport("org-1", competitor.id);
    expect(report.available).toBe(true);
    expect(report.domain).toBe("apexfootwear.com");
    expect(report.title).toContain("Apex Footwear");
    expect(report.metaDescription).toContain("cash on delivery");
    expect(report.productSchemaPresent).toBe(true);
    expect(report.sitemapPresent).toBe(true);
    expect(report.observedPhrases).toContainEqual({ source: "h1", text: "Premium Shoes Collection" });
    expect(report.internalLinks.map((l: any) => l.kind)).toEqual(expect.arrayContaining(["product", "offer"]));
    // The invented metrics are GONE from the response.
    expect(report).not.toHaveProperty("estimatedMonthlyOrganicVisits");
    expect(report).not.toHaveProperty("domainAuthorityScore");
    expect(report).not.toHaveProperty("topKeywords");
  });

  it("getSeoTrafficReport is honestly unavailable when the site is unreachable or missing (HF2)", async () => {
    const prisma = fakePrisma();
    const svc = new CompetitorsService(prisma as any, auditStub, devLlm);
    const withSite = await svc.create("org-1", "u", { name: "Down Shop", websiteUrl: "https://down.example" });
    (global as any).fetch = async () => { throw new Error("ECONNREFUSED"); };
    const unreachable = await svc.getSeoTrafficReport("org-1", withSite.id);
    expect(unreachable.available).toBe(false);
    expect(unreachable.reason).toBeDefined();

    const noSite = await svc.create("org-1", "u", { name: "No Site Shop" });
    const missing = await svc.getSeoTrafficReport("org-1", noSite.id);
    expect(missing.available).toBe(false);
  });

  it("generateSeoGapStrategy grounds in the real audit and carries no estimatedCtrBoost (HF2)", async () => {
    const prisma = fakePrisma();
    const svc = new CompetitorsService(prisma as any, auditStub, devLlm);
    const competitor = await svc.create("org-1", "u", {
      name: "Apex Footwear",
      websiteUrl: "https://apexfootwear.com",
    });
    (global as any).fetch = async (url: string) => {
      if (url.endsWith("/robots.txt")) return { ok: true, status: 200, text: async () => "User-agent: *\nAllow: /" };
      if (url.endsWith("/sitemap.xml")) return { ok: true, status: 200, text: async () => "<urlset></urlset>" };
      return { ok: true, status: 200, text: async () => `<html><head><title>Apex Footwear</title></head><body><h1>Shoes</h1></body></html>` };
    };

    const gap = await svc.generateSeoGapStrategy("org-1", "u", competitor.id);
    expect(gap.competitor.name).toBe("Apex Footwear");
    expect(gap.seoAudit.available).toBe(true);
    expect(gap.strategy.recommendedMetaTitle).toBeDefined();
    expect(gap.strategy.recommendedMetaDescription).toBeDefined();
    expect(gap.strategy.targetKeywords.length).toBe(5);
    expect(gap.strategy).not.toHaveProperty("estimatedCtrBoost");
  });

  it("generateSeoGapStrategy refuses when the competitor site cannot be audited (HF2)", async () => {
    const prisma = fakePrisma();
    const svc = new CompetitorsService(prisma as any, auditStub, devLlm);
    const competitor = await svc.create("org-1", "u", { name: "Down Shop", websiteUrl: "https://down.example" });
    (global as any).fetch = async () => { throw new Error("ECONNREFUSED"); };
    await expect(svc.generateSeoGapStrategy("org-1", "u", competitor.id)).rejects.toThrow();
  });

  it("deconstructVideoScript creates scene-by-scene storyboard and voiceover", async () => {
    const prisma = fakePrisma();
    const svc = new CompetitorsService(prisma as any, auditStub, devLlm);
    const competitor = await svc.create("org-1", "u", { name: "Fashion House BD" });

    const ad = await (prisma as any).competitorAd.create({
      data: {
        competitorId: competitor.id,
        externalAdId: "ad-video-1",
        startedAt: new Date(Date.now() - 5 * 86400000),
        isActive: true,
        platforms: ["tiktok", "facebook"],
        creativeText: "Don't miss our viral Panjabi drop this Eid! Free shipping nationwide.",
      },
    });

    const script = await svc.deconstructVideoScript("org-1", "u", competitor.id, {
      competitorAdId: ad.id,
      videoStyle: "ugc",
    });

    expect(script.format).toBe("TikTok & Reels (9:16)");
    // HF5: template draft is labeled, and its hook text is a labeled
    // assumption — not a factual claim about the competitor's video.
    expect(script.origin).toBe("template");
    expect(script.competitorHookBreakdown.firstThreeSecondsHook).toContain("খসড়া অনুমান");
    expect(script.competitorHookBreakdown.firstThreeSecondsHook).toBeDefined();
    expect(script.adaptedScript.scenes.length).toBe(5);
    expect(script.adaptedScript.scenes[0].phase).toBe("Scroll-Stopping Hook");
    expect(script.adaptedScript.fullVoiceoverBangla).toBeDefined();
    expect(script.adaptedScript.creatorShootingChecklist.length).toBeGreaterThan(0);
  });

  it("mineCustomerComplaints without pasted reviews is honestly unavailable — no report is invented (HF4)", async () => {
    const prisma = fakePrisma();
    const svc = new CompetitorsService(prisma as any, auditStub, devLlm);
    const competitor = await svc.create("org-1", "u", {
      name: "Fast Fashion BD",
      websiteUrl: "https://fastfashionbd.com",
    });

    const noInput = await svc.mineCustomerComplaints("org-1", competitor.id);
    expect(noInput.available).toBe(false);
    if (!noInput.available) expect(noInput.reason).toContain("আসল রিভিউ পেস্ট করুন");

    const emptyInput = await svc.mineCustomerComplaints("org-1", competitor.id, "   \n  ");
    expect(emptyInput.available).toBe(false);
  });

  it("mineCustomerComplaints counts from the pasted input and quotes are verbatim from it (HF4)", async () => {
    const prisma = fakePrisma();
    const svc = new CompetitorsService(prisma as any, auditStub, devLlm);
    const competitor = await svc.create("org-1", "u", { name: "Fast Fashion BD" });

    const pasted = [
      "Delivery took 10 days, very late and frustrating. Rating 1/5",
      "ডেলিভারি পেতে অনেক দেরি হয়েছে, খুব খারাপ অভিজ্ঞতা",
      "Fabric quality is bad, color faded after one wash. 2 stars",
      "Good product, fast delivery, very happy!",
    ].join("\n\n");

    const report = await svc.mineCustomerComplaints("org-1", competitor.id, pasted);
    expect(report.available).toBe(true);
    if (!report.available) throw new Error("expected an available report");
    expect(report.totalAnalyzedFeedback).toBe(4);
    // Ratings parsed from the input itself: (1 + 2) / 2 — nothing invented.
    expect(report.overallRatingScore).toBe(1.5);
    expect(report.sentimentDistribution.dissatisfied).toBe(75);
    expect(report.sentimentDistribution.satisfied).toBe(25);
    expect(report.topComplaints[0].category).toBe("Shipping & Delivery");
    expect(report.topComplaints[0].itemCount).toBe(2);
    // Every quote shown must be found verbatim in the pasted text.
    for (const theme of report.topComplaints) {
      for (const quote of theme.sampleCustomerQuotes) {
        expect(pasted).toContain(quote);
      }
    }
    expect(report.recommendedCounterAngles.length).toBeGreaterThan(0);
    expect(report.biggestVulnerability).toContain("Shipping & Delivery");
  });

  it("verifyQuotes drops invented quotes and keeps verbatim excerpts (HF4)", async () => {
    const { verifyQuotes } = await import("./review-miner");
    const input = "Delivery took 10 days, very late.\n\nFabric quality is bad.";
    expect(verifyQuotes(["Delivery took 10 days", "Customers say the CEO is wonderful"], input))
      .toEqual(["Delivery took 10 days"]);
  });

  it("saves and loads Telegram and WhatsApp alert configuration", async () => {
    const prisma = fakePrisma();
    const svc = new CompetitorsService(prisma as any, auditStub, devLlm);

    const initial = await svc.getAlertSettings("org-1");
    expect(initial.telegramEnabled).toBe(false);

    const updated = await svc.saveAlertSettings("org-1", "u", {
      telegramEnabled: true,
      telegramBotToken: "test-token",
      telegramChatId: "123456",
      notifyOnStockOut: true,
    });

    expect(updated.telegramEnabled).toBe(true);
    expect(updated.telegramChatId).toBe("123456");

    const fetched = await svc.getAlertSettings("org-1");
    expect(fetched.telegramEnabled).toBe(true);
    expect(fetched.telegramChatId).toBe("123456");
  });

  it("testSendAlert dispatches payload to Telegram with token and chatId", async () => {
    const prisma = fakePrisma();
    const svc = new CompetitorsService(prisma as any, auditStub, devLlm);

    (global as any).fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: 998 } }),
    });

    const res = await svc.testSendAlert("org-1", {
      channel: "telegram",
      telegramBotToken: "fake-bot-token",
      telegramChatId: "fake-chat-id",
    });

    expect(res.success).toBe(true);
  });

  it("auditCheckoutFunnel detects gateways, trust signals and form fields from REAL fetched HTML (HF3)", async () => {
    const prisma = fakePrisma();
    const svc = new CompetitorsService(prisma as any, auditStub, devLlm);
    const competitor = await svc.create("org-1", "u", {
      name: "Smart Gadgets BD",
      websiteUrl: "https://smartgadgetsbd.com",
    });
    (global as any).fetch = async (url: string) => {
      if (url.endsWith("/robots.txt")) return { ok: true, status: 200, text: async () => "User-agent: *\nAllow: /" };
      if (url.includes("/checkout")) return { ok: true, status: 200, text: async () => `<html><body><form action="/checkout" method="post"><input type="text" name="fullName"><input type="tel" name="phone"><textarea name="address"></textarea><input type="submit" value="Order"></form></body></html>` };
      return { ok: true, status: 200, text: async () => `<html><body><a href="https://smartgadgetsbd.com/checkout">Checkout</a><p>Pay easily with bKash or Nagad. Cash on delivery available nationwide. Buy 2 get 1 free combo offer!</p></body></html>` };
    };

    const funnel = await svc.auditCheckoutFunnel("org-1", competitor.id);
    expect(funnel.competitorName).toBe("Smart Gadgets BD");
    expect(funnel.scanned).toBe(true);
    expect(funnel.paymentGatewaysDetected).toEqual(expect.arrayContaining(["bKash (বিকাশ)", "Nagad (নগদ)", "Cash on Delivery (ক্যাশ অন ডেলিভারি)"]));
    expect(funnel.trustSignalsDetected).toContain("ক্যাশ অন ডেলিভারি");
    expect(funnel.checkoutDetected).toBe(true);
    expect(funnel.checkoutFieldCount).toBe(3);
    expect(funnel.checkoutFields).toContain("phone");
    expect(funnel.bundleHints.length).toBeGreaterThan(0);
    // Invented fields are GONE.
    expect(funnel).not.toHaveProperty("formFrictionScore");
    expect(funnel).not.toHaveProperty("bundleOffers");
    expect(funnel.generalTips.length).toBeGreaterThan(0);
  });

  it("auditCheckoutFunnel reports not-detected honestly and scanned:false when unreachable (HF3)", async () => {
    const prisma = fakePrisma();
    const svc = new CompetitorsService(prisma as any, auditStub, devLlm);
    const plain = await svc.create("org-1", "u", { name: "Plain Shop", websiteUrl: "https://plain.example" });
    (global as any).fetch = async (url: string) => {
      if (url.endsWith("/robots.txt")) return { ok: true, status: 200, text: async () => "User-agent: *\nAllow: /" };
      return { ok: true, status: 200, text: async () => `<html><body><p>Welcome to our store.</p></body></html>` };
    };
    const funnel = await svc.auditCheckoutFunnel("org-1", plain.id);
    expect(funnel.scanned).toBe(true);
    expect(funnel.paymentGatewaysDetected).toEqual([]);
    expect(funnel.checkoutFieldCount).toBeNull();
    expect(funnel.bundleHints).toEqual([]);

    const down = await svc.create("org-1", "u", { name: "Down Shop", websiteUrl: "https://down.example" });
    (global as any).fetch = async () => { throw new Error("ECONNREFUSED"); };
    const unreachable = await svc.auditCheckoutFunnel("org-1", down.id);
    expect(unreachable.scanned).toBe(false);
    expect(unreachable.reason).toBeDefined();
  });

  it("getDynamicRules and saveDynamicRules persist and retrieve rules configuration", async () => {
    const prisma = fakePrisma();
    const svc = new CompetitorsService(prisma as any, auditStub, devLlm);

    const defaultRules = await svc.getDynamicRules("org-1");
    expect(defaultRules.length).toBeGreaterThan(0);
    expect(defaultRules[0].triggerType).toBe("COMPETITOR_STOCK_OUT");

    const customRules = [...defaultRules];
    customRules[0].enabled = false;

    const saved = await svc.saveDynamicRules("org-1", "u", { rules: customRules });
    expect(saved.success).toBe(true);

    const fetched = await svc.getDynamicRules("org-1");
    expect(fetched[0].enabled).toBe(false);
  });

  it("syncMultiPlatform persists nothing for TikTok/Bing and reports them unavailable (HF1)", async () => {
    const prisma = fakePrisma();
    const svc = new CompetitorsService(prisma as any, auditStub, devLlm);
    const competitor = await svc.create("org-1", "u", { name: "Rival", websiteUrl: "https://rival.example/" });
    (global as any).fetch = async () => ({ ok: false, status: 503, text: async () => "" });
    const res = await svc.syncMultiPlatform("org-1", "u", competitor.id, { platforms: ["google", "tiktok", "bing"] });
    expect(res.fetched).toBe(0);
    expect(res.created).toBe(0);
    expect(prisma.competitorAd.rows).toHaveLength(0);
    expect(res.unavailable.tiktok).toContain("public data source");
    expect(res.unavailable.bing).toContain("public data source");
    expect(res.unavailable.google).toBeDefined();
  });

  it("syncMultiPlatform persists real Google results labeled organic_search, with no invented start date (HF1)", async () => {
    const prisma = fakePrisma();
    const svc = new CompetitorsService(prisma as any, auditStub, devLlm);
    const competitor = await svc.create("org-1", "u", { name: "Rival", websiteUrl: "https://rival.example/" });
    (global as any).fetch = async () => ({
      ok: true, status: 200,
      text: async () => `<html><body><a class="result__url" href="https://rival.example/shop"><h2 class="result__a">Rival Shop</h2></a><a class="result__snippet" href="https://rival.example/shop">Cash on delivery available.</a></body></html>`,
    });
    const res = await svc.syncMultiPlatform("org-1", "u", competitor.id, { platforms: ["google"] });
    expect(res.fetched).toBe(1);
    expect(prisma.competitorAd.rows).toHaveLength(1);
    expect(prisma.competitorAd.rows[0].raw).toMatchObject({ sourceType: "organic_search" });
    expect(prisma.competitorAd.rows[0].startedAt ?? null).toBeNull();
    expect(prisma.competitorAd.rows[0].creativeText).toContain("[Google Search Result]");
  });

  it("default rules ship with zero history — no fake trigger counts or executions (HF6)", async () => {
    const svc = new CompetitorsService(fakePrisma() as any, auditStub, devLlm);
    const rules = await svc.getDynamicRules("org-1");
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      expect(r.triggerCount).toBe(0);
      expect(r.lastTriggeredAt).toBeNull();
      expect(r.recentExecutions ?? []).toEqual([]);
    }
  });

  it("simulateRuleTrigger evaluates trigger condition and logs recent execution", async () => {
    const prisma = fakePrisma();
    const svc = new CompetitorsService(prisma as any, auditStub, devLlm);

    const res = await svc.simulateRuleTrigger("org-1", {
      triggerType: "COMPETITOR_STOCK_OUT",
      competitorName: "Daraz Express",
      productName: "Wireless Earbuds Pro",
    });

    expect(res.triggeredCount).toBeGreaterThan(0);
    expect(res.results[0].actionTaken).toContain("স্বয়ংক্রিয়ভাবে অ্যাক্টিভ ক্যাম্পেইন বাজেট");
  });
});






