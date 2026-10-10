process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
import { CampaignsService } from "./campaigns.service";
import { MetaPublishClient } from "./meta-publish.client";
import { CreativesService } from "../creatives/creatives.service";
import { AudiencesService } from "../audiences/audiences.service";
import { CatalogsService } from "../catalogs/catalogs.service";
import { encryptJson } from "../integrations/crypto";

const audit = { log: async () => undefined } as any;
const llm = { getProvider: () => null } as any;

function table(name: string, rows: any[] = []) {
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => Object.entries(where ?? {}).every(([k, v]) => r[k] === v)) ?? null,
    findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id || r.organizationId === where.organizationId) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => Object.entries(where ?? {}).every(([k, v]) => {
      if (v && typeof v === "object" && "in" in (v as any)) return (v as any).in.includes(r[k]);
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
    campaignPublishLog: table("log"), creativeAsset: table("asset"),
    adAccount: table("account"), integration: table("integration"),
    product: table("product"), customer: table("customer"), lead: table("lead"),
    audienceRecord: table("audience"), savedAudience: table("saved"),
    catalogRecord: table("catalog"), order: table("order"), orderItem: table("orderItem"),
    businessProfile: { findFirst: async () => ({ websiteUrl: "https://shop.example" }) },
  };
  t.integration.rows.push({ id: "int-1", organizationId: "org-1", provider: "meta", status: "CONNECTED", credential: { encryptedData: secrets } });
  t.adAccount.rows.push({ id: "acc-1", organizationId: "org-1", platform: "meta", sourceType: "api", externalId: "act_777", integrationId: "int-1", name: "Main", currency: "BDT" });
  t.product.rows.push({ id: "prod-1", organizationId: "org-1", status: "ACTIVE", name: "Cotton Panjabi", priceMinor: 150000n, currency: "BDT", category: "clothing", description: "Comfy", sku: "SKU-1", slug: "cotton-panjabi", imageUrl: "https://shop.example/p.jpg", stockQuantity: 5 });
  return t;
}

function graphFetch(handler: (url: string, body: URLSearchParams) => any) {
  const calls: { url: string; body: URLSearchParams }[] = [];
  const fn = async (url: string, init: any) => {
    const body = new URLSearchParams(String(init?.body ?? ""));
    calls.push({ url, body });
    const out = handler(url, body);
    return { ok: true, status: 200, json: async () => out, statusText: "OK" } as any;
  };
  (global as any).fetch = fn;
  return calls;
}

// ---------- Publish client creative shapes ----------
describe("Phase H - MetaPublishClient formats", () => {
  it("builds video_data, carousel child_attachments and image_hash creatives", async () => {
    const bodies: any[] = [];
    const fetchFn = async (_url: string, init: any) => {
      bodies.push(new URLSearchParams(String(init.body)));
      return { ok: true, status: 200, json: async () => ({ id: "ad-x" }) } as any;
    };
    const client = new MetaPublishClient("tok", fetchFn as any);
    await client.createAd("act_1", { name: "V", adSetId: "s1", pageId: "p1", linkUrl: "https://x.com", primaryText: "hi", videoId: "vid-9", callToAction: "SHOP_NOW" });
    const vCreative = JSON.parse(bodies[0].get("creative")!);
    expect(vCreative.video_data.video_id).toBe("vid-9");

    await client.createAd("act_1", {
      name: "C", adSetId: "s1", pageId: "p1", linkUrl: "https://x.com", primaryText: "hi", callToAction: "SHOP_NOW",
      carouselCards: [
        { title: "A", linkUrl: "https://x.com/1", imageHash: "hash-1" },
        { title: "B", linkUrl: "https://x.com/2", imageUrl: "https://x.com/2.jpg" },
      ],
    });
    const cCreative = JSON.parse(bodies[1].get("creative")!);
    expect(cCreative.link_data.child_attachments.length).toBe(2);
    expect(cCreative.link_data.child_attachments[0].image_hash).toBe("hash-1");

    await client.createAd("act_1", { name: "L", adSetId: "s1", pageId: "p1", linkUrl: "https://x.com", primaryText: "hi", imageHash: "hash-2", callToAction: "SHOP_NOW" });
    const lCreative = JSON.parse(bodies[2].get("creative")!);
    expect(lCreative.link_data.image_hash).toBe("hash-2");
  });
});

// ---------- Campaigns: duplicate / blueprint / formats ----------
describe("Phase H - campaigns service", () => {
  it("duplicates a plan without external ids and validates ad formats", async () => {
    const prisma = basePrisma();
    const svc = new CampaignsService(prisma, audit, llm);
    const plan = await svc.createPlan("org-1", "u1", { name: "Orig", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
    const adSet = await svc.addAdSet("org-1", plan.id, { name: "Set", dailyBudget: "500", optimizationGoal: "LINK_CLICKS", pageId: "page-1", countries: ["BD"], interests: ["Fashion"], customAudienceIds: ["238500"] });
    const storedSet = prisma.campaignAdSet.rows.find((r: any) => r.id === adSet.id);
    expect(storedSet.targeting.interests).toEqual(["Fashion"]);
    expect(storedSet.targeting.customAudienceIds).toEqual(["238500"]);
    await svc.addAd("org-1", plan.id, adSet.id, { name: "A1", primaryText: "text", linkUrl: "https://x.com" });
    await expect(svc.addAd("org-1", plan.id, adSet.id, { name: "Bad", primaryText: "t", linkUrl: "https://x.com", format: "carousel", carouselCards: [{ title: "only", linkUrl: "https://x.com" }] })).rejects.toThrow(/2-10 cards/);
    await expect(svc.addAd("org-1", plan.id, adSet.id, { name: "Bad2", primaryText: "t", linkUrl: "https://x.com", format: "video" })).rejects.toThrow(/videoAssetId/);

    const copy: any = await svc.duplicatePlan("org-1", "u1", plan.id);
    expect(copy.id).not.toBe(plan.id);
    expect(copy.status).toBe("draft");
    expect(copy.name).toContain("কপি");
    expect(copy.adSets.length).toBe(1);
    expect(copy.adSets[0].externalAdSetId ?? null).toBeNull();
    expect(copy.adSets[0].ads.length).toBe(1);
    expect(copy.adSets[0].targeting.interests).toEqual(["Fashion"]);
  });

  it("instantiates a blueprint grounded in the chosen product", async () => {
    const prisma = basePrisma();
    const svc = new CampaignsService(prisma, audit, llm);
    const plan: any = await svc.instantiateBlueprint("org-1", "u1", { blueprintKey: "cod_sales", adAccountId: "acc-1", productId: "prod-1" });
    expect(plan.objective).toBe("OUTCOME_SALES");
    const ad = plan.adSets[0].ads[0];
    expect(ad.primaryText).toContain("Cotton Panjabi");
    expect(ad.primaryText).toContain("1500");
  });

  it("publishing a video ad requires a ready asset and then sends the video id", async () => {
    const prisma = basePrisma();
    const svc = new CampaignsService(prisma, audit, llm);
    prisma.creativeAsset.rows.push({ id: "asset-1", organizationId: "org-1", adAccountId: "acc-1", kind: "video", name: "Clip", status: "processing", externalVideoId: "vid-1", sourceUrl: "https://x.com/v.mp4", createdById: "u1" });
    const plan = await svc.createPlan("org-1", "u1", { name: "Video Plan", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
    const adSet = await svc.addAdSet("org-1", plan.id, { name: "Set", dailyBudget: "500", optimizationGoal: "LINK_CLICKS", pageId: "page-1", countries: ["BD"] });
    await svc.addAd("org-1", plan.id, adSet.id, { name: "V", primaryText: "watch", linkUrl: "https://x.com", format: "video", videoAssetId: "asset-1" });
    await svc.submitForApproval("org-1", "u1", plan.id);
    await svc.approve("org-1", "owner", plan.id);
    graphFetch((url) => ({ id: "x-1" }));
    await expect(svc.publish("org-1", "owner", plan.id)).rejects.toThrow(/not ready/);

    prisma.creativeAsset.rows[0].status = "ready";
    const calls = graphFetch((url) => {
      if (url.includes("/campaigns")) return { id: "camp-1" };
      if (url.includes("/adsets")) return { id: "adset-1" };
      if (url.includes("/ads")) return { id: "ad-1" };
      return { id: "x" };
    });
    const done: any = await svc.publish("org-1", "owner", plan.id);
    expect(done.status).toBe("published");
    const adsCall = calls.find((c) => c.url.includes("/ads"))!;
    const creative = JSON.parse(adsCall.body.get("creative")!);
    expect(creative.video_data.video_id).toBe("vid-1");
  });
});

// ---------- Creatives ----------
describe("Phase H - creatives service", () => {
  it("image upload stores the Meta hash; video goes to processing; errors are recorded", async () => {
    const prisma = basePrisma();
    const svc = new CreativesService(prisma, audit);
    graphFetch((url) => url.includes("adimages") ? { images: { "https://x.com/a.jpg": { hash: "hash-abc" } } } : { id: "vid-55" });
    const img: any = await svc.upload("org-1", "u1", "acc-1", { kind: "image", name: "Banner", sourceUrl: "https://x.com/a.jpg" });
    expect(img.status).toBe("ready");
    expect(img.externalHash).toBe("hash-abc");
    const vid: any = await svc.upload("org-1", "u1", "acc-1", { kind: "video", name: "Clip", sourceUrl: "https://x.com/v.mp4" });
    expect(vid.status).toBe("processing");
    expect(vid.externalVideoId).toBe("vid-55");

    (global as any).fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "Invalid image URL" } }), statusText: "Bad Request" } as any);
    const failed: any = await svc.upload("org-1", "u1", "acc-1", { kind: "image", name: "Bad", sourceUrl: "https://x.com/bad.jpg" });
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("Invalid image URL");
  });
});

// ---------- Audiences ----------
describe("Phase H - audiences service", () => {
  it("uploads only hashes and records Meta's audience id", async () => {
    const prisma = basePrisma();
    prisma.customer.rows.push(
      { id: "c1", organizationId: "org-1", email: "buyer@example.com", phone: "01712345678", mergedIntoId: null },
      { id: "c2", organizationId: "org-1", email: null, phone: "01812345678", mergedIntoId: null },
    );
    const svc = new AudiencesService(prisma, audit);
    const calls = graphFetch((url) => url.includes("/users") ? { num_received: 2 } : { id: "aud-9" });
    const record: any = await svc.createCustom("org-1", "u1", { adAccountId: "acc-1", name: "Buyers", source: "customers" });
    expect(record.externalAudienceId).toBe("aud-9");
    const usersCall = calls.find((c) => c.url.includes("/users"))!;
    const payload = JSON.parse(usersCall.body.get("payload")!);
    expect(payload.schema).toEqual(["EMAIL_SHA256", "PHONE_SHA256"]);
    const raw = JSON.stringify(calls.map((c) => c.body.toString()));
    expect(raw).not.toContain("buyer@example.com");
    expect(raw).not.toContain("01712345678");
    expect(payload.data.length).toBe(2);
  });

  it("refuses an empty source honestly", async () => {
    const prisma = basePrisma();
    const svc = new AudiencesService(prisma, audit);
    await expect(svc.createCustom("org-1", "u1", { adAccountId: "acc-1", name: "Empty", source: "leads" })).rejects.toThrow(/No contacts/);
  });
});

// ---------- Catalogs ----------
describe("Phase H - catalogs service", () => {
  it("pushes products and reports Meta's own counts; refuses without a website", async () => {
    const prisma = basePrisma();
    prisma.catalogRecord.rows.push({ id: "cat-1", organizationId: "org-1", name: "Main", externalCatalogId: "cat-999", status: "connected" });
    const svc = new CatalogsService(prisma, audit);
    graphFetch(() => ({ handles: ["h1"], errors: [] }));
    const summary: any = await svc.pushProducts("org-1", "u1", "cat-1");
    expect(summary.pushed).toBe(1);
    expect(summary.errors).toBe(0);

    const noSite = basePrisma();
    noSite.businessProfile = { findFirst: async () => ({ websiteUrl: null }) };
    noSite.catalogRecord.rows.push({ id: "cat-1", organizationId: "org-1", name: "Main", externalCatalogId: "cat-999", status: "connected" });
    await expect(new CatalogsService(noSite, audit).pushProducts("org-1", "u1", "cat-1")).rejects.toThrow(/Website/);
  });
});
