import { CampaignsService } from "./campaigns.service";
import { MetaPublishClient } from "./meta-publish.client";
import { DevTemplateProvider } from "../ai/llm/dev.provider";
import { PublishingService } from "../publishing/publishing.service";
import { encryptJson } from "../integrations/crypto";

// CA17 (CB4): plan-level UTM template + attribution display.
// UTM params resolve from the plan's REAL template or the
// documented defaults (no invented values); a link's own
// utm_* are the owner's and never overwritten; the same
// params ride Meta url_tags, the Google finalUrlSuffix and
// the TikTok landing URL. Attribution windows are read from
// stored config only: the org's first-party window yes,
// platform windows are stored nowhere → "সেট করা নেই".

function makeTable(rows: any[] = []) {
  const t: any = {
    rows,
    findFirst: jest.fn(async ({ where }: any = {}) => rows.find((r) => Object.entries(where ?? {}).every(([k, v]) => r[k] === v)) ?? null),
    findUnique: jest.fn(async ({ where }: any = {}) => rows.find((r) => r.id === where.id) ?? null),
    findMany: jest.fn(async () => rows),
    create: jest.fn(async ({ data }: any) => { const row = { id: data.id ?? `r${rows.length + 1}`, ...data }; rows.push(row); return row; }),
    update: jest.fn(async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); Object.assign(row, data); return row; }),
  };
  return t;
}

function makeCampaigns(planExtra: any = {}, orgRow: any = { id: "org", attributionWindowDays: 30 }) {
  const plan = { id: "p1", organizationId: "org", name: "Eid Sale", objective: "sales", status: "approved", budgetMode: "ad_set", utmTemplate: null, ...planExtra };
  const tables: any = {
    campaignPlan: makeTable([plan]),
    campaignAdSet: makeTable([{ id: "s1", organizationId: "org", planId: "p1", name: "Dhaka Women 25-34", budgetMinor: 50000n, targeting: { countries: ["BD"], ageMin: 18, ageMax: 65, genders: [] }, pageId: "pg1" }]),
    campaignAd: makeTable([{ id: "a1", organizationId: "org", planId: "p1", adSetId: "s1", name: "Hero Ad One", primaryText: "Big Eid Offer", headline: "Eid Collection", imageUrl: "https://cdn.example.com/hero.jpg", linkUrl: "https://shop.example.com/p1", status: "draft", textOptions: { primaryTexts: ["Big Eid Offer"], headlines: ["Eid Collection 2026", "New Offer Inside", "Free Delivery BD"], descriptions: ["Best eid collection in BD", "Order today pay on delivery"] } }]),
    creativeAsset: makeTable([]),
    adAccount: makeTable([
      { id: "ga1", organizationId: "org", platform: "google", name: "Google Account" },
      { id: "ta1", organizationId: "org", platform: "tiktok", name: "TikTok Account" },
    ]),
    savedAudience: makeTable([]),
    audienceRecord: makeTable([]),
    businessProfile: makeTable([]),
    product: makeTable([]),
    integration: makeTable([]),
    platformPublication: makeTable([]),
    organization: makeTable([orgRow]),
    dailyAdMetric: makeTable([]),
    thirdPartyOrder: makeTable([]),
    crossPlatformDraft: makeTable([]),
    campaignPublishLog: makeTable([]),
  };
  const audit = { log: jest.fn(async () => ({})) };
  const publishing = {
    publishGoogle: jest.fn(async () => ({ status: "created_paused", externalId: "g1", detail: {} })),
    publishGooglePmax: jest.fn(async () => ({ status: "created_paused", externalId: "g2", detail: {} })),
    publishTikTok: jest.fn(async () => ({ status: "created_paused", externalId: "t1", detail: {} })),
  };
  const svc = new CampaignsService(tables as any, audit as any, { getProvider: () => new DevTemplateProvider() } as any, publishing as any);
  return { svc, tables, plan, publishing };
}

describe("CA17 UTM params — defaults and template rendering", () => {
  it("defaults: per-platform source, cpc, plan slug; content/term only with ad-set/ad context", () => {
    const { svc } = makeCampaigns();
    const meta = svc.utmParamsFor({ name: "Eid Sale", utmTemplate: null }, { platform: "meta", adSetName: "Dhaka Women 25-34", adName: "Hero Ad One" });
    expect(meta).toEqual([
      { key: "utm_source", value: "facebook" }, { key: "utm_medium", value: "cpc" },
      { key: "utm_campaign", value: "eid-sale" }, { key: "utm_content", value: "dhaka-women-25-34" },
      { key: "utm_term", value: "hero-ad-one" },
    ]);
    const google = svc.utmParamsFor({ name: "Eid Sale", utmTemplate: null }, { platform: "google" });
    expect(google).toEqual([
      { key: "utm_source", value: "google" }, { key: "utm_medium", value: "cpc" }, { key: "utm_campaign", value: "eid-sale" },
    ]);
    expect(svc.utmParamsFor({ name: "Eid Sale", utmTemplate: null }, { platform: "tiktok" })[0]).toEqual({ key: "utm_source", value: "tiktok" });
  });

  it("template values render tokens; unset keys keep defaults; an empty render is omitted", () => {
    const { svc } = makeCampaigns();
    const plan = { name: "Eid Sale", utmTemplate: { source: "{platform}-ads", campaign: "promo-{campaign}", content: "{adset}", term: "{ad}" } };
    const withCtx = svc.utmParamsFor(plan, { platform: "meta", adSetName: "Dhaka", adName: "Hero" });
    expect(withCtx).toContainEqual({ key: "utm_source", value: "facebook-ads" });
    expect(withCtx).toContainEqual({ key: "utm_campaign", value: "promo-eid-sale" });
    expect(withCtx).toContainEqual({ key: "utm_medium", value: "cpc" }); // untouched default
    // No ad-set/ad context: {adset}/{ad} render empty → those keys disappear entirely.
    const bare = svc.utmParamsFor(plan, { platform: "meta" });
    expect(bare.find((p) => p.key === "utm_content")).toBeUndefined();
    expect(bare.find((p) => p.key === "utm_term")).toBeUndefined();
  });

  it("applyUtmParams never overwrites the owner's own utm_* and reports the skip", () => {
    const { svc } = makeCampaigns();
    const params = svc.utmParamsFor({ name: "Eid Sale", utmTemplate: null }, { platform: "meta" });
    const out = svc.applyUtmParams("https://shop.example.com/p?utm_campaign=my-own&color=red", params);
    expect(out.url).toContain("utm_campaign=my-own");
    expect(out.url).toContain("color=red");
    expect(out.url).toContain("utm_source=facebook");
    expect(out.skipped).toEqual(["utm_campaign"]);
    expect(out.applied).toEqual(expect.arrayContaining(["utm_source", "utm_medium"]));
    expect(svc.applyUtmParams("not a url", params)).toEqual({ url: "not a url", changed: false, applied: [], skipped: [] });
  });
});

describe("CA17 UTM template — get/set with validation", () => {
  it("saves a valid template (audited) and renders per-platform samples", async () => {
    const { svc, tables } = makeCampaigns();
    const out = await svc.setPlanUtmTemplate("org", "u1", "p1", { template: { source: "{platform}", campaign: "eid-{campaign}" } });
    expect(tables.campaignPlan.rows[0].utmTemplate).toEqual({ source: "{platform}", campaign: "eid-{campaign}" });
    expect(out.samples.google).toContain("utm_campaign=eid-eid-sale");
    expect(out.samples.meta).toContain("utm_source=facebook");
  });

  it("refuses unknown keys, unknown tokens, empty and over-long values; null clears", async () => {
    const { svc } = makeCampaigns();
    await expect(svc.setPlanUtmTemplate("org", "u1", "p1", { template: { bogus: "x" } })).rejects.toThrow("অজানা UTM Key");
    await expect(svc.setPlanUtmTemplate("org", "u1", "p1", { template: { source: "{product}" } })).rejects.toThrow("অজানা Token");
    await expect(svc.setPlanUtmTemplate("org", "u1", "p1", { template: { source: "  " } })).rejects.toThrow("খালি");
    await expect(svc.setPlanUtmTemplate("org", "u1", "p1", { template: { source: "x".repeat(121) } })).rejects.toThrow("১২০");
    const cleared = await svc.setPlanUtmTemplate("org", "u1", "p1", { template: null });
    expect(cleared.template).toBeNull();
  });
});

describe("CA17 UTM — mapper application (Google suffix / TikTok URL)", () => {
  it("Google fan-out mapping carries finalUrlSuffix from the plan defaults", async () => {
    const { svc } = makeCampaigns();
    const out: any = await svc.fanoutPreview("org", "p1", "u1", { googleAccountId: "ga1" });
    const g = out.platforms.find((b: any) => b.platform === "google");
    expect(g.mapped.finalUrlSuffix).toBe("utm_source=google&utm_medium=cpc&utm_campaign=eid-sale");
    expect(g.transformations.some((t: string) => t.includes("Final URL Suffix"))).toBe(true);
  });

  it("TikTok mapping tags the landing URL; a pre-existing owner utm_campaign wins and is reported", async () => {
    const { svc, tables } = makeCampaigns();
    tables.campaignAd.rows[0].linkUrl = "https://shop.example.com/p1?utm_campaign=owners-own";
    const out: any = await svc.fanoutPreview("org", "p1", "u1", { tiktokAccountId: "ta1" });
    const t = out.platforms.find((b: any) => b.platform === "tiktok");
    expect(t.mapped.landingUrl).toContain("utm_campaign=owners-own");
    expect(t.mapped.landingUrl).toContain("utm_source=tiktok");
    expect(t.transformations.some((x: string) => x.includes("আগে থেকেই ছিল"))).toBe(true);
  });

  it("a saved template flows into the fan-out suffix verbatim-rendered", async () => {
    const { svc } = makeCampaigns({ utmTemplate: { campaign: "promo-{campaign}", medium: "paid-social" } });
    const out: any = await svc.fanoutPreview("org", "p1", "u1", { googleAccountId: "ga1" });
    const g = out.platforms.find((b: any) => b.platform === "google");
    expect(g.mapped.finalUrlSuffix).toBe("utm_source=google&utm_medium=paid-social&utm_campaign=promo-eid-sale");
  });
});

describe("CA17 UTM — published payloads", () => {
  it("Meta createAd sends url_tags only when provided", async () => {
    const bodies: string[] = [];
    const fetchFn = async (_url: string, init: any) => { bodies.push(String(init.body)); return { ok: true, status: 200, json: async () => ({ id: "ad1" }) } as any; };
    const client = new MetaPublishClient("tok", fetchFn as any);
    await client.createAd("123", { name: "A", adSetId: "s1", pageId: "pg", linkUrl: "https://x.example", primaryText: "Hi", callToAction: "SHOP_NOW", urlTags: "utm_source=facebook&utm_campaign=eid-sale" });
    expect(new URLSearchParams(bodies[0]).get("url_tags")).toBe("utm_source=facebook&utm_campaign=eid-sale");
    await client.createAd("123", { name: "A", adSetId: "s1", pageId: "pg", linkUrl: "https://x.example", primaryText: "Hi", callToAction: "SHOP_NOW" });
    expect(new URLSearchParams(bodies[1]).get("url_tags")).toBeNull();
  });

  it("Google Search publish puts finalUrlSuffix on the campaign create only when given", async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    const creds = encryptJson({ developerToken: "dev", clientId: "cid", clientSecret: "cs", refreshToken: "rt" });
    const account = { id: "acc1", organizationId: "org", platform: "google", externalId: "123-456-7890", accessStatus: "ok", integrationId: "int1" };
    const integration = { id: "int1", organizationId: "org", status: "connected", credential: { encryptedData: creds } };
    const tables: any = { adAccount: makeTable([account]), integration: makeTable([integration]), integrationAccount: makeTable([]), adPublishLog: makeTable([]), platformPublication: makeTable([]) };
    tables.adAccount.findMany = async () => [account];
    const svc = new PublishingService(tables as any, { log: jest.fn(async () => ({})) } as any);
    const calls: { url: string; body: any }[] = [];
    const origFetch = global.fetch;
    global.fetch = (async (url: string, init: any) => {
      let body: any = null;
      try { body = init?.body ? JSON.parse(String(init.body)) : null; } catch { body = null; }
      calls.push({ url: String(url), body });
      if (String(url).includes("oauth2")) return { ok: true, status: 200, json: async () => ({ access_token: "at" }) } as any;
      if (String(url).includes("geoTargetConstants:suggest")) return { ok: true, status: 200, json: async () => ({ geoTargetConstantSuggestions: [{ geoTargetConstant: { resourceName: "geoTargetConstants/2024" } }] }) } as any;
      const firstOp = body?.operations?.[0] ?? {};
      const rn = firstOp.create?.campaignBudget !== undefined || String(url).includes("campaignBudgets")
        ? "customers/1/campaignBudgets/9"
        : String(url).includes("campaigns") ? "customers/1/campaigns/5"
        : String(url).includes("adGroups") ? "customers/1/adGroups/6" : "customers/1/adGroupAds/7";
      return { ok: true, status: 200, json: async () => ({ results: [{ resourceName: rn }] }) } as any;
    }) as any;
    try {
      const dto: any = { adAccountId: "acc1", name: "G", dailyBudget: "300", countryCodes: ["BD"], headlines: ["h1", "h2", "h3"], descriptions: ["d1", "d2"], finalUrl: "https://s.example", keywords: [{ text: "k" }] };
      await svc.publishGoogle("org", "u1", { ...dto, finalUrlSuffix: "utm_source=google&utm_campaign=eid-sale" });
      const campaignCall = calls.find((c) => c.url.includes("campaigns:mutate"));
      expect(campaignCall?.body.operations[0].create.finalUrlSuffix).toBe("utm_source=google&utm_campaign=eid-sale");
      calls.length = 0;
      await svc.publishGoogle("org", "u1", dto);
      const plainCall = calls.find((c) => c.url.includes("campaigns:mutate"));
      expect(plainCall?.body.operations[0].create.finalUrlSuffix).toBeUndefined();
    } finally {
      global.fetch = origFetch;
    }
  });
});

describe("CA17 attribution display — stored values only", () => {
  it("first-party window comes from the org setting; platform windows are 'সেট করা নেই', never invented", async () => {
    const { svc } = makeCampaigns(
      { externalCampaignId: "cmp-1", status: "active" },
      { id: "org", attributionWindowDays: 14 },
    );
    const out: any = await svc.planPerformance("org", "p1");
    expect(out.attribution.firstParty).toEqual({ windowDays: 14, source: "organization_setting" });
    expect(out.attribution.platforms).toHaveLength(3);
    for (const p of out.attribution.platforms) {
      expect(p.configured).toBe(false);
      expect(p.windowDays).toBeNull();
      expect(p.display).toBe("সেট করা নেই");
    }
  });
});
