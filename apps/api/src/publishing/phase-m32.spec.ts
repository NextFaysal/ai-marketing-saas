process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
import { PublishingService } from "./publishing.service";
import { encryptJson } from "../integrations/crypto";

const audit = { log: async () => undefined } as any;

function table(name: string, rows: any[] = []) {
  let seq = 0;
  const match = (r: any, where: any) => Object.entries(where ?? {}).every(([k, v]) => (v && typeof v === "object" ? true : r[k] === v));
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => match(r, where)) ?? null,
    findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => match(r, where)),
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
  };
}

function prismaWith(platform: "tiktok" | "google") {
  const secrets = platform === "tiktok"
    ? encryptJson({ accessToken: "tt-token" })
    : encryptJson({ clientId: "cid", clientSecret: "cs", refreshToken: "rt", developerToken: "dev" });
  const t: any = {
    adAccount: table("account"), integration: table("integration"),
    integrationCredential: table("cred"), platformPublication: table("pub"),
  };
  t.adAccount.rows.push({ id: "acc-1", organizationId: "org-1", platform, externalId: platform === "tiktok" ? "adv-1" : "1234567890", integrationId: "int-1" });
  const credRow = { id: "cred-1", integrationId: "int-1", encryptedData: secrets };
  t.integration.rows.push({ id: "int-1", organizationId: "org-1", provider: platform === "tiktok" ? "tiktok_ads" : "google_ads", status: "CONNECTED", credential: credRow });
  return t;
}

describe("Milestone 32 — TikTok video creative", () => {
  const calls: { url: string; body: any }[] = [];
  beforeEach(() => {
    calls.length = 0;
    (global as any).fetch = jest.fn(async (url: string, init: any = {}) => {
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ url, body });
      const ok = (data: any) => ({ ok: true, status: 200, json: async () => ({ code: 0, data }) });
      if (url.includes("/identity/get/")) return ok({ identity_list: [{ identity_type: "CUSTOMIZED_USER", identity_id: "idn-1" }] });
      if (url.includes("/tool/location/")) return ok({ list: [{ code: "BD", location_id: 42 }] });
      if (url.includes("/campaign/create/")) return ok({ campaign_id: 100 });
      if (url.includes("/adgroup/create/")) return ok({ adgroup_id: 200 });
      if (url.includes("/file/video/ad/upload/")) return ok([{ video_id: "vid-9" }]);
      if (url.includes("/file/image/ad/upload/")) return ok([{ image_id: "img-1" }]);
      if (url.includes("/ad/create/")) return ok({ ad_ids: [300] });
      throw new Error(`unexpected fetch ${url}`);
    });
  });

  it("video URL takes the video path: upload by URL, SINGLE_VIDEO ad, no image ids", async () => {
    const svc = new PublishingService(prismaWith("tiktok"), audit);
    const out: any = await svc.publishTikTok("org-1", "u-1", {
      adAccountId: "acc-1", name: "Video Ad", dailyBudget: "10", countryCodes: ["BD"],
      adText: "Watch this", landingUrl: "https://shop.example/p", videoUrl: "https://cdn.example/v.mp4",
    });
    expect(out.status).toBe("created_paused");
    expect(calls.some((c) => c.url.includes("/file/video/ad/upload/"))).toBe(true);
    expect(calls.some((c) => c.url.includes("/file/image/ad/upload/"))).toBe(false);
    const adCall = calls.find((c) => c.url.includes("/ad/create/"))!;
    expect(adCall.body.video_id).toBe("vid-9");
    expect(adCall.body.ad_format).toBe("SINGLE_VIDEO");
    expect(adCall.body.image_ids).toBeUndefined();
    expect(out.detail.videoId).toBe("vid-9");
  });

  it("image path is unchanged when no video URL is given; no creative at all is refused", async () => {
    const svc = new PublishingService(prismaWith("tiktok"), audit);
    const out: any = await svc.publishTikTok("org-1", "u-1", {
      adAccountId: "acc-1", name: "Image Ad", dailyBudget: "10", countryCodes: ["BD"],
      adText: "See this", landingUrl: "https://shop.example/p", imageUrl: "https://cdn.example/i.jpg",
    });
    expect(out.status).toBe("created_paused");
    const adCall = calls.find((c) => c.url.includes("/ad/create/"))!;
    expect(adCall.body.image_ids).toEqual(["img-1"]);
    await expect(svc.publishTikTok("org-1", "u-1", {
      adAccountId: "acc-1", name: "No Creative", dailyBudget: "10", countryCodes: ["BD"],
      adText: "x", landingUrl: "https://shop.example/p",
    })).rejects.toMatchObject({ code: "publishing.provideAnImageUrlOrA" });
  });
});

describe("Milestone 32 — Google Performance Max", () => {
  const calls: { url: string; body: any }[] = [];
  const pmaxDto = {
    adAccountId: "acc-1", name: "PMax Test", dailyBudget: "20", countryCodes: ["BD"],
    finalUrl: "https://shop.example", businessName: "Demo Store",
    headlines: ["Head One", "Head Two", "Head Three"], longHeadlines: ["A longer headline for the store"],
    descriptions: ["First description", "Second description"],
    logoUrl: "https://cdn.example/logo.png", imageUrls: ["https://cdn.example/hero.jpg"],
  };
  beforeEach(() => {
    calls.length = 0;
    (global as any).fetch = jest.fn(async (url: string, init: any = {}) => {
      let body: any;
      try { body = init.body ? JSON.parse(String(init.body)) : undefined; } catch { body = undefined; }
      calls.push({ url, body });
      const okJson = (json: any) => ({ ok: true, status: 200, json: async () => json });
      if (url.includes("oauth2.googleapis.com")) return okJson({ access_token: "tok" });
      if (url.includes("cdn.example")) return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, json: async () => ({}) };
      if (url.includes("geoTargetConstants:suggest")) return okJson({ geoTargetConstantSuggestions: [{ geoTargetConstant: { resourceName: "geoTargetConstants/2024" } }] });
      const seg = ["campaignBudgets", "campaigns", "campaignCriteria", "assetGroups", "assets", "assetGroupAssets", "assetGroupListingGroupFilters"].find((s) => url.includes(`/${s}:mutate`));
      if (seg) return okJson({ results: (body.operations as any[]).map((_, i) => ({ resourceName: `customers/1234567890/${seg}/r${calls.length}-${i}` })) });
      throw new Error(`unexpected fetch ${url}`);
    });
  });

  it("builds the full PAUSED chain: budget -> PMax campaign -> locations -> asset group -> assets -> links -> listing filter", async () => {
    const svc = new PublishingService(prismaWith("google"), audit);
    const out: any = await svc.publishGooglePmax("org-1", "u-1", pmaxDto);
    expect(out.status).toBe("created_paused");
    const campaignCall = calls.find((c) => c.url.includes("/campaigns:mutate"))!;
    expect(campaignCall.body.operations[0].create.advertisingChannelType).toBe("PERFORMANCE_MAX");
    expect(campaignCall.body.operations[0].create.status).toBe("PAUSED");
    const groupCall = calls.find((c) => c.url.includes("/assetGroups:mutate"))!;
    expect(groupCall.body.operations[0].create.status).toBe("PAUSED");
    const linkCall = calls.find((c) => c.url.includes("/assetGroupAssets:mutate"))!;
    const fieldTypes = linkCall.body.operations.map((o: any) => o.create.fieldType);
    expect(fieldTypes).toContain("HEADLINE");
    expect(fieldTypes).toContain("LONG_HEADLINE");
    expect(fieldTypes).toContain("DESCRIPTION");
    expect(fieldTypes).toContain("BUSINESS_NAME");
    expect(fieldTypes).toContain("LOGO");
    expect(fieldTypes).toContain("MARKETING_IMAGE");
    const filterCall = calls.find((c) => c.url.includes("/assetGroupListingGroupFilters:mutate"))!;
    expect(filterCall.body.operations[0].create.type).toBe("UNIT_INCLUDED");
    const imageAssetCall = calls.find((c) => c.url.includes("/assets:mutate") && c.body.operations[0].create.type === "IMAGE")!;
    expect(imageAssetCall.body.operations[0].create.imageAsset.data).toBe(Buffer.from(new Uint8Array([1, 2, 3])).toString("base64"));
    expect(out.detail.kind).toBe("performance_max");
  });

  it("validation refuses thin asset sets before any API call or record", async () => {
    const p = prismaWith("google");
    const svc = new PublishingService(p, audit);
    await expect(svc.publishGooglePmax("org-1", "u-1", { ...pmaxDto, headlines: ["only", "two"] })).rejects.toMatchObject({ code: "publishing.performanceMaxNeeds315Headlines" });
    await expect(svc.publishGooglePmax("org-1", "u-1", { ...pmaxDto, businessName: "x".repeat(26) })).rejects.toMatchObject({ code: "publishing.businessNameIsRequiredMax25" });
    await expect(svc.publishGooglePmax("org-1", "u-1", { ...pmaxDto, imageUrls: [] })).rejects.toMatchObject({ code: "publishing.performanceMaxNeeds120Marketing" });
    expect(p.platformPublication.rows).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });
});
