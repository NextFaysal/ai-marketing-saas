import { CampaignsService } from "./campaigns.service";
import { MetaPublishClient } from "./meta-publish.client";
import { encryptJson } from "../integrations/crypto";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

/**
 * Campaign Builder Next CN5: creative v2 — multiple text
 * options (legacy columns always mirror option index 0),
 * per-placement asset overrides published through Meta's
 * documented asset_feed_spec + asset_customization_rules,
 * Advantage enhancement toggles mapped to
 * degrees_of_freedom_spec (unknown keys REFUSED at save),
 * honest first-option fallback for formats that cannot
 * carry them (carousel here; catalog/lead behave the same),
 * and asset variants from the creative + social libraries.
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
  const table: any = {
    rows,
    findFirst: async ({ where }: any = {}) => {
      const hit = rows.find((r) => matches(r, where ?? {}));
      if (name === "campaignAd" && hit) {
        const set = arguments; // (unused) — adSet join emulated below via __adSet on rows
        void set;
      }
      return hit ?? null;
    },
    findUnique: async ({ where }: any = {}) => rows.find((r) => r.id === where.id) ?? null,
    findMany: async ({ where, take }: any = {}) => { const f = rows.filter((r) => matches(r, where ?? {})); return take ? f.slice(0, take) : f; },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); rows.splice(i, 1); return {}; },
  };
  return table;
}
function setup() {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "integration", "product", "dailyAdMetric", "catalogRecord", "productSet", "audienceRecord", "conversionApiSetting", "conversionEventLog", "leadForm", "customFieldDef", "creativeAsset", "mediaAsset"]) tables[n] = makeTable(n);
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", sourceType: "api", externalId: "act_777", name: "Main", currency: "BDT", platformStatusBucket: "active", integrationId: "int-1" });
  tables.integration.rows.push({ id: "int-1", organizationId: "org", provider: "meta", status: "CONNECTED", credential: { encryptedData: encryptJson({ accessToken: "tok-123" }) } });
  // campaignAd rows need their ad set attached for the
  // findFirst({ adSet: { planId } }) lookups updateAd uses.
  const origCreate = tables.campaignAd.create;
  tables.campaignAd.create = async (args: any) => {
    const row = await origCreate(args);
    row.__adSet = tables.campaignAdSet.rows.find((s: any) => s.id === row.adSetId) ?? {};
    return row;
  };
  const svc = new CampaignsService(tables as any, { log: async () => undefined } as any, { getProvider: () => new DevTemplateProvider() } as any);
  return { tables, svc };
}
const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; delete process.env.API_PUBLIC_URL; });
function metaFetch() {
  const calls: { url: string; params: URLSearchParams }[] = [];
  (global as any).fetch = async (url: string, init: any) => {
    calls.push({ url: String(url), params: new URLSearchParams(String(init?.body ?? "")) });
    if (String(url).includes("/campaigns")) return { ok: true, status: 200, json: async () => ({ id: "camp-100" }) };
    if (String(url).includes("/adsets")) return { ok: true, status: 200, json: async () => ({ id: "adset-100" }) };
    if (String(url).includes("/ads")) return { ok: true, status: 200, json: async () => ({ id: "ad-100" }) };
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  };
  return calls;
}
async function draftWithAd(svc: CampaignsService, adDto: any = {}) {
  const plan: any = await svc.createPlan("org", "creator", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
  const adSet: any = await svc.addAdSet("org", plan.id, { name: "S1", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg", pixelId: "px", countries: ["BD"], ...((adDto as any).__adSet ?? {}) });
  const clean = { ...(adDto as any) }; delete (clean as any).__adSet;
  const ad: any = await svc.addAd("org", plan.id, adSet.id, { name: "A1", primaryText: "প্রথম লেখা — সেরা অফার", headline: "প্রথম শিরোনাম", linkUrl: "https://shop.example/x", imageUrl: "https://cdn.example/base.jpg", ...clean });
  return { plan, adSet, ad };
}
async function publishPlan(svc: CampaignsService, planId: string) {
  await svc.submitForApproval("org", "creator", planId);
  await svc.approve("org", "owner", planId);
  return svc.publish("org", "owner", planId);
}
function adCreative(calls: { url: string; params: URLSearchParams }[]) {
  const call = calls.find((c) => c.url.endsWith("/ads"));
  return JSON.parse(call!.params.get("creative") ?? "{}");
}

describe("CN5 text options", () => {
  it("stores options and syncs the legacy columns from index 0 (base text stays first)", async () => {
    const { svc } = setup();
    const { ad } = await draftWithAd(svc, { textOptions: { primaryTexts: ["দ্বিতীয় লেখা", "প্রথম লেখা — সেরা অফার"], headlines: ["দ্বিতীয় শিরোনাম", "প্রথম শিরোনাম"], descriptions: ["বিবরণ এক", "বিবরণ দুই"] } });
    expect(ad.primaryText).toBe("প্রথম লেখা — সেরা অফার");
    expect(ad.headline).toBe("প্রথম শিরোনাম");
    expect(ad.description).toBe("বিবরণ এক");
    expect(ad.textOptions.primaryTexts[0]).toBe("প্রথম লেখা — সেরা অফার");
    expect(ad.textOptions.primaryTexts).toHaveLength(2);
  });

  it("refuses over-cap options with the limit named", async () => {
    const { svc } = setup();
    await expect(draftWithAd(svc, { textOptions: { primaryTexts: ["1", "2", "3", "4", "5", "6"] } })).rejects.toMatchObject({ code: "campaigns.atMostPrimaryTextOptionsMeta" });
    await expect(draftWithAd(svc, { textOptions: { descriptions: ["a", "b", "c"] } })).rejects.toMatchObject({ code: "campaigns.atMostDescriptionOptions" });
  });

  it("PATCH replaces options wholesale; a legacy text edit re-syncs index 0; null clears", async () => {
    const { svc, tables } = setup();
    const { plan, ad } = await draftWithAd(svc, { textOptions: { primaryTexts: ["প্রথম লেখা — সেরা অফার", "বিকল্প লেখা"] } });
    const edited: any = await svc.updateAd("org", plan.id, ad.id, "u", { primaryText: "নতুন প্রথম লেখা" });
    expect(edited.primaryText).toBe("নতুন প্রথম লেখা");
    expect(edited.textOptions.primaryTexts).toEqual(["নতুন প্রথম লেখা", "বিকল্প লেখা"]);
    const replaced: any = await svc.updateAd("org", plan.id, ad.id, "u", { textOptions: { primaryTexts: ["শুধু এটাই"] } });
    expect(replaced.textOptions.primaryTexts).toEqual(["শুধু এটাই"]);
    const cleared: any = await svc.updateAd("org", plan.id, ad.id, "u", { textOptions: null });
    expect(cleared.textOptions).toBeNull();
    expect(tables.campaignAd.rows[0].primaryText).toBeTruthy();
  });

  it("the submission snapshot freezes the CN5 fields", async () => {
    const { svc, tables } = setup();
    const { plan } = await draftWithAd(svc, { textOptions: { primaryTexts: ["প্রথম লেখা — সেরা অফার", "বিকল্প লেখা"] }, creativeEnhancements: { text_optimizations: true } });
    await svc.submitForApproval("org", "creator", plan.id);
    const row = tables.campaignPlan.rows.find((p: any) => p.id === plan.id);
    expect(row.submissionSnapshot.adSets[0].ads[0].textOptions.primaryTexts).toHaveLength(2);
    expect(row.submissionSnapshot.adSets[0].ads[0].creativeEnhancements).toEqual({ text_optimizations: true });
  });
});

describe("CN5 validation refusals", () => {
  it("refuses an unmapped enhancement key and a wrong-kind placement override at save", async () => {
    const { svc } = setup();
    await expect(draftWithAd(svc, { creativeEnhancements: { magic_sparkles: true } })).rejects.toMatchObject({ code: "campaigns.creativeenhancementsKeyIsNotAMeta" });
    await expect(draftWithAd(svc, { placementAssets: { feed: { videoAssetId: "v1" } } })).rejects.toMatchObject({ code: "campaigns.placementassetsALinkAdSPlacement" });
    await expect(draftWithAd(svc, { placementAssets: { sidebar: { imageUrl: "https://x/y.jpg" } } })).rejects.toMatchObject({ code: "campaigns.placementassetsGroupIsNotSupportedAllowed" });
    const { plan, ad } = await draftWithAd(svc, {});
    await expect(svc.updateAd("org", plan.id, ad.id, "u", { format: "carousel", carouselCards: [{ title: "a", linkUrl: "https://x/1" }, { title: "b", linkUrl: "https://x/2" }], placementAssets: { feed: { imageUrl: "https://x/y.jpg" } } })).rejects.toMatchObject({ code: "campaigns.placementassetsAreNotSupportedForFormat" });
  });
});

describe("CN5 publish mapping", () => {
  it("multi-text link ad publishes through asset_feed_spec (DEGREES_OF_FREEDOM) with enhancements as degrees_of_freedom_spec", async () => {
    const { svc } = setup();
    const { plan } = await draftWithAd(svc, {
      textOptions: { primaryTexts: ["প্রথম লেখা — সেরা অফার", "বিকল্প লেখা"], headlines: ["প্রথম শিরোনাম", "বিকল্প শিরোনাম"] },
      creativeEnhancements: { text_optimizations: true, image_touchups: false },
    });
    const calls = metaFetch();
    await publishPlan(svc, plan.id);
    const creative = adCreative(calls);
    expect(creative.link_data).toBeUndefined();
    const feed = creative.asset_feed_spec;
    expect(feed.optimization_type).toBe("DEGREES_OF_FREEDOM");
    expect(feed.bodies.map((b: any) => b.text)).toEqual(["প্রথম লেখা — সেরা অফার", "বিকল্প লেখা"]);
    expect(feed.titles).toHaveLength(2);
    expect(feed.images[0].url).toBe("https://cdn.example/base.jpg");
    expect(creative.degrees_of_freedom_spec.creative_features_spec).toEqual({
      text_optimizations: { enroll_status: "OPT_IN" },
      image_touchups: { enroll_status: "OPT_OUT" },
    });
  });

  it("placement overrides publish labelled assets + customization rules with a base fallback (PLACEMENT)", async () => {
    const { svc } = setup();
    const { plan } = await draftWithAd(svc, {
      placementAssets: { feed: { imageUrl: "https://cdn.example/feed.jpg" }, vertical: { imageUrl: "https://cdn.example/tall.jpg" } },
    });
    const calls = metaFetch();
    await publishPlan(svc, plan.id);
    const feed = adCreative(calls).asset_feed_spec;
    expect(feed.optimization_type).toBe("PLACEMENT");
    const byLabel = Object.fromEntries(feed.images.map((i: any) => [i.adlabels[0].name, i.url]));
    expect(byLabel).toEqual({ cn5_base: "https://cdn.example/base.jpg", cn5_feed: "https://cdn.example/feed.jpg", cn5_vertical: "https://cdn.example/tall.jpg" });
    const rules = feed.asset_customization_rules;
    expect(rules).toHaveLength(3);
    expect(rules[0].customization_spec.facebook_positions).toEqual(["feed"]);
    expect(rules[0].image_label.name).toBe("cn5_feed");
    expect(rules[1].customization_spec.instagram_positions).toEqual(["story", "reels"]);
    expect(rules[2].customization_spec).toEqual({});
    expect(rules[2].image_label.name).toBe("cn5_base");
  });

  it("a plain ad (no CN5 fields) keeps the legacy link_data creative byte-shape", async () => {
    const { svc } = setup();
    const { plan } = await draftWithAd(svc, {});
    const calls = metaFetch();
    await publishPlan(svc, plan.id);
    const creative = adCreative(calls);
    expect(creative.asset_feed_spec).toBeUndefined();
    expect(creative.degrees_of_freedom_spec).toBeUndefined();
    expect(creative.link_data.message).toBe("প্রথম লেখা — সেরা অফার");
  });

  it("carousel with text options publishes legacy cards AND logs the first-option fallback", async () => {
    const { svc, tables } = setup();
    const { plan } = await draftWithAd(svc, {
      format: "carousel", imageUrl: undefined,
      carouselCards: [
        { title: "কার্ড ১", linkUrl: "https://shop.example/1", imageUrl: "https://cdn.example/1.jpg" },
        { title: "কার্ড ২", linkUrl: "https://shop.example/2", imageUrl: "https://cdn.example/2.jpg" },
      ],
      textOptions: { primaryTexts: ["প্রথম লেখা — সেরা অফার", "বিকল্প লেখা"] },
    });
    const calls = metaFetch();
    await publishPlan(svc, plan.id);
    const creative = adCreative(calls);
    expect(creative.asset_feed_spec).toBeUndefined();
    expect(creative.link_data.child_attachments).toHaveLength(2);
    const log = tables.campaignPublishLog.rows.find((l: any) => l.step === "creative_v2_first_option_only");
    expect(log).toBeTruthy();
    expect(log.error).toMatch(/Text Options/);
  });

  it("readiness warns loudly when a carousel carries options that publish will not send", async () => {
    const { svc } = setup();
    const { plan } = await draftWithAd(svc, {
      format: "carousel", imageUrl: undefined,
      carouselCards: [
        { title: "কার্ড ১", linkUrl: "https://shop.example/1", imageUrl: "https://cdn.example/1.jpg" },
        { title: "কার্ড ২", linkUrl: "https://shop.example/2", imageUrl: "https://cdn.example/2.jpg" },
      ],
      textOptions: { primaryTexts: ["প্রথম লেখা — সেরা অফার", "বিকল্প লেখা"] },
    });
    const r: any = await svc.readiness("org", plan.id);
    const row = r.checks.find((c: any) => c.key === "creative" && c.level === "warn");
    expect(row?.detail).toMatch(/Carousel Creative-এ Text Options যাবে না/);
  });
});

describe("CN5 client units", () => {
  it("enhancementsToDof maps booleans to enroll_status and sends nothing when unset", () => {
    expect(MetaPublishClient.enhancementsToDof(undefined)).toBeUndefined();
    expect(MetaPublishClient.enhancementsToDof({})).toBeUndefined();
    expect(MetaPublishClient.enhancementsToDof({ video_auto_crop: true })).toEqual({ creative_features_spec: { video_auto_crop: { enroll_status: "OPT_IN" } } });
  });
  it("buildAssetFeedCreative returns null for a single-option ad without placement media", () => {
    expect(MetaPublishClient.buildAssetFeedCreative({ pageId: "pg", linkUrl: "https://x", callToAction: "SHOP_NOW", primaryText: "t", imageUrl: "https://x/i.jpg" })).toBeNull();
  });
});

describe("CN5 variants from assets", () => {
  it("creative-library image becomes a link variant; video becomes a video variant", async () => {
    const { svc, tables } = setup();
    tables.creativeAsset.rows.push(
      { id: "ca-img", organizationId: "org", adAccountId: "acc-1", kind: "image", name: "Hero", status: "ready", externalHash: "h1" },
      { id: "ca-vid", organizationId: "org", adAccountId: "acc-1", kind: "video", name: "Clip", status: "ready", externalVideoId: "v1" },
    );
    const { plan, ad } = await draftWithAd(svc, {});
    const v1: any = await svc.createAdVariant("org", plan.id, ad.id, "u", { creativeAssetId: "ca-img" });
    expect(v1.format).toBe("link"); expect(v1.imageAssetId).toBe("ca-img"); expect(v1.adSetId).toBe(ad.adSetId);
    const v2: any = await svc.createAdVariant("org", plan.id, ad.id, "u", { creativeAssetId: "ca-vid" });
    expect(v2.format).toBe("video"); expect(v2.videoAssetId).toBe("ca-vid");
    await expect(svc.createAdVariant("org", plan.id, ad.id, "u", { creativeAssetId: "ca-img", mediaAssetId: "m1" })).rejects.toMatchObject({ code: "campaigns.chooseExactlyOneAssetCreativeassetidCreative" });
  });

  it("social/studio media: video refused with the reason; image needs a public token + API_PUBLIC_URL", async () => {
    const { svc, tables } = setup();
    tables.mediaAsset.rows.push(
      { id: "m-vid", organizationId: "org", kind: "video", name: "Reel", publicToken: "tok1" },
      { id: "m-img", organizationId: "org", kind: "image", name: "Poster", publicToken: "tok2" },
      { id: "m-notoken", organizationId: "org", kind: "image", name: "Private", publicToken: null },
    );
    const { plan, ad } = await draftWithAd(svc, {});
    await expect(svc.createAdVariant("org", plan.id, ad.id, "u", { mediaAssetId: "m-vid" })).rejects.toThrow(/Creative Library/);
    await expect(svc.createAdVariant("org", plan.id, ad.id, "u", { mediaAssetId: "m-notoken" })).rejects.toThrow(/public link token/);
    await expect(svc.createAdVariant("org", plan.id, ad.id, "u", { mediaAssetId: "m-img" })).rejects.toThrow(/API_PUBLIC_URL/);
    process.env.API_PUBLIC_URL = "https://api.example.com/";
    const v: any = await svc.createAdVariant("org", plan.id, ad.id, "u", { mediaAssetId: "m-img" });
    expect(v.format).toBe("link");
    expect(v.imageUrl).toBe("https://api.example.com/public/media/tok2");
  });
});
