process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
import { BadRequestException, HttpException, NotFoundException } from "@nestjs/common";
import { SocialImageService, composePosterSvg, wrapPosterText } from "./social-image.service";
import { GeminiImageProvider } from "../ai/images/gemini-image.provider";
import { buildImageProvider } from "../ai/images/image.factory";
import { ImageConfigError } from "../ai/images/image.types";
import { MediaStore } from "../inbox/media-store";
import { AdminService } from "../admin/admin.service";
import { setPlatformConfigSnapshot } from "../common/platform-config";

/**
 * SP4 — AI Image (provider + template composer):
 * - GeminiImageProvider against stubbed fetch: inlineData bytes,
 *   verbatim provider errors, no-image-part honesty.
 * - generateAiImage: enforcement (feature "social_image") BEFORE
 *   resolution, not-configured Bengali 400, product enrichment with
 *   name/category ONLY (never the price), usage AFTER persist,
 *   provider/non-image failures produce nothing.
 * - Template composer: pure SVG composition (photo data URI,
 *   escaping, brand colour, wrapping), real-price default subtext,
 *   separate "social_template" usage feature. (PP3: the old
 *   product-image deferral is now an auto-import — see the
 *   contract-change test below and social-pp3.spec.ts.)
 * - Admin verify-before-save: a failed verification writes NO row.
 */

// Standard 1×1 transparent PNG.
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=";
const PNG_BYTES = Buffer.from(PNG_B64, "base64");

const ORG = "org-1";
const ACTOR = "user-1";

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && "gte" in (v as any)) {
      return new Date(row[k]) >= (v as any).gte;
    }
    if (v !== null && typeof v === "object" && !(v instanceof Date) && "in" in (v as any)) {
      return (v as any).in.includes(row[k]);
    }
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
    return row[k] === v;
  });
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where, take, orderBy }: any = {}) => {
      let f = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "desc") f = [...f].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (orderBy?.createdAt === "asc") f = [...f].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      return take ? f.slice(0, take) : f;
    },
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (row) Object.assign(row, data);
      return row;
    },
  };
}

function fakePrisma() {
  const tables: any = {
    product: makeTable("product"),
    mediaAsset: makeTable("asset"),
    organization: makeTable("org"),
    aIUsageRecord: makeTable("usage"),
    systemSetting: makeTable("setting"),
    subscription: makeTable("sub"),
    businessProfile: makeTable("bp"),
  };
  tables.product.rows.push({
    id: "prod-1", organizationId: ORG, name: "Cotton Panjabi",
    description: "Comfortable cotton panjabi", category: "Men's Fashion",
    priceMinor: 150000n, compareAtMinor: 200000n, currency: "BDT", stockQuantity: 12,
  });
  tables.organization.rows.push({
    id: ORG, name: "Shop One", brandName: "Shop One",
    primaryColor: "#ff5733", logoUrl: null, logoContentType: null,
    aiDailyLimitOverride: null, broadcastCapOverride: null, seatLimit: null,
  });
  return tables;
}

function stubMediaStore() {
  const blobs = new Map<string, { bytes: Buffer; contentType: string }>();
  jest.spyOn(MediaStore.prototype, "put").mockImplementation(async (key: string, bytes: Buffer, contentType: string) => {
    blobs.set(key, { bytes: Buffer.from(bytes), contentType });
  });
  jest.spyOn(MediaStore.prototype, "get").mockImplementation(async (key: string) => blobs.get(key)?.bytes ?? null);
  return blobs;
}

function buildService(prisma: any) {
  const auditRows: any[] = [];
  const audit = { log: jest.fn(async (input: any) => { auditRows.push(input); }) } as any;
  const svc = new SocialImageService(prisma as any, audit);
  return { svc, auditRows };
}

function stubProvider(svc: SocialImageService, generate: (prompt: string) => Promise<any>) {
  const provider = { name: "gemini", isRealProvider: true as const, generate };
  jest.spyOn(svc, "resolveProvider").mockReturnValue({ provider: provider as any, providerName: "gemini", model: undefined, source: "admin" });
  return provider;
}

function okPngResult() {
  return { bytes: PNG_BYTES, contentType: "image/png", model: "gemini-2.5-flash-image", inputTokens: 10, outputTokens: 20, tokensEstimated: false };
}

afterEach(() => jest.restoreAllMocks());

describe("GeminiImageProvider (stubbed fetch)", () => {
  function fetchReturning(body: any, ok = true, status = 200) {
    return jest.fn(async () => ({ ok, status, json: async () => body })) as any;
  }

  it("returns bytes/contentType/model/tokens from an inlineData part", async () => {
    const fetchFn = fetchReturning({
      candidates: [{ content: { parts: [{ text: "here you go" }, { inlineData: { data: PNG_B64, mimeType: "image/png" } }] } }],
      usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 1290 },
    });
    const provider = new GeminiImageProvider("key-1", undefined, fetchFn);
    const result = await provider.generate("a red circle");
    expect(result.bytes.equals(PNG_BYTES)).toBe(true);
    expect(result.contentType).toBe("image/png");
    expect(result.model).toBe("gemini-2.5-flash-image");
    expect(result.inputTokens).toBe(7);
    expect(result.outputTokens).toBe(1290);
    expect(result.tokensEstimated).toBe(false);
    const [url, init] = fetchFn.mock.calls[0] as any[];
    expect(String(url)).toContain("/models/gemini-2.5-flash-image:generateContent");
    const sent = JSON.parse(init.body);
    expect(sent.generationConfig.responseModalities).toEqual(["TEXT", "IMAGE"]);
    expect(init.headers["x-goog-api-key"]).toBe("key-1");
  });

  it("missing usageMetadata → tokensEstimated true, zero tokens", async () => {
    const fetchFn = fetchReturning({
      candidates: [{ content: { parts: [{ inlineData: { data: PNG_B64 } }] } }],
    });
    const result = await new GeminiImageProvider("k", "custom-model", fetchFn).generate("x");
    expect(result.contentType).toBe("image/png"); // mimeType default
    expect(result.model).toBe("custom-model");
    expect(result.tokensEstimated).toBe(true);
  });

  it("error response → throws with the provider's verbatim message", async () => {
    const fetchFn = fetchReturning({ error: { message: "API key not valid. Please pass a valid API key." } }, false, 400);
    await expect(new GeminiImageProvider("bad", undefined, fetchFn).generate("x"))
      .rejects.toThrow("Gemini image request failed (400): API key not valid. Please pass a valid API key.");
  });

  it("ok but no image part → throws 'Gemini returned no image data' with the text part", async () => {
    const fetchFn = fetchReturning({
      candidates: [{ content: { parts: [{ text: "I cannot draw that." }] } }],
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 5 },
    });
    await expect(new GeminiImageProvider("k", undefined, fetchFn).generate("x"))
      .rejects.toThrow("Gemini returned no image data: I cannot draw that.");
  });

  it("no key → ImageConfigError; factory errors for empty/unknown names", () => {
    expect(() => new GeminiImageProvider("")).toThrow(ImageConfigError);
    expect(() => new GeminiImageProvider("")).toThrow("IMAGE_API_KEY is required for the Gemini image provider");
    expect(() => buildImageProvider("", "k")).toThrow("No image provider configured");
    expect(() => buildImageProvider("dall-e", "k")).toThrow("Unknown image provider: dall-e (expected gemini)");
    expect(buildImageProvider("gemini", "k").name).toBe("gemini");
  });
});

describe("SocialImageService.generateAiImage", () => {
  it("not configured → exact Bengali 400, zero assets, zero usage", async () => {
    const prisma = fakePrisma(); stubMediaStore();
    const { svc } = buildService(prisma);
    jest.spyOn(svc, "resolveProvider").mockReturnValue(null);
    await expect(svc.generateAiImage(ORG, ACTOR, { prompt: "একটি লাল গোলাপ" }))
      .rejects.toThrow("AI ছবি তৈরির provider configure করা নেই — Admin Panel থেকে সেট করুন, অথবা Template Poster ব্যবহার করুন");
    expect(prisma.mediaAsset.rows).toHaveLength(0);
    expect(prisma.aIUsageRecord.rows).toHaveLength(0);
    expect(svc.imageStatus()).toEqual({ configured: false, provider: null });
  });

  it("empty prompt → Bengali 400 before anything else", async () => {
    const prisma = fakePrisma(); stubMediaStore();
    const { svc } = buildService(prisma);
    await expect(svc.generateAiImage(ORG, ACTOR, { prompt: "   " }))
      .rejects.toThrow("ছবির বর্ণনা (Prompt) দিন।");
  });

  it("success: asset origin ai_generated, prompt has name+category but NEVER the price, usage after persist", async () => {
    const prisma = fakePrisma(); const blobs = stubMediaStore();
    const { svc, auditRows } = buildService(prisma);
    let seenPrompt = "";
    stubProvider(svc, async (prompt: string) => { seenPrompt = prompt; return okPngResult(); });
    const asset: any = await svc.generateAiImage(ORG, ACTOR, { prompt: "ঈদের জন্য আকর্ষণীয় ব্যাকগ্রাউন্ড", productId: "prod-1" });
    expect(asset.origin).toBe("ai_generated");
    expect(asset.kind).toBe("image");
    expect(asset.contentType).toBe("image/png");
    expect(asset.prompt).toContain("ঈদের জন্য আকর্ষণীয় ব্যাকগ্রাউন্ড");
    expect(asset.prompt).toContain("Cotton Panjabi");
    expect(asset.prompt).toContain("Men's Fashion");
    // Enrichment honesty: the formatted price is never baked in.
    expect(asset.prompt).not.toContain("BDT 1500.00");
    expect(asset.prompt).not.toContain("1500");
    expect(seenPrompt).toBe(asset.prompt);
    const stored = prisma.mediaAsset.rows[0];
    expect(stored.storageKey).toBe(`${ORG}/social/${asset.id}.png`);
    expect(blobs.get(stored.storageKey)?.bytes.equals(PNG_BYTES)).toBe(true);
    expect(prisma.aIUsageRecord.rows).toHaveLength(1);
    const usage = prisma.aIUsageRecord.rows[0];
    expect(usage.feature).toBe("social_image");
    expect(usage.provider).toBe("gemini");
    expect(usage.model).toBe("gemini-2.5-flash-image");
    expect(usage.estimated).toBe(false);
    expect(auditRows.some((r: any) => r.action === "social.ai_image_created")).toBe(true);
    expect(JSON.stringify(auditRows)).not.toContain("Cotton Panjabi"); // prompt never audited
  });

  it("provider throws → verbatim BadRequest, zero usage, zero assets", async () => {
    const prisma = fakePrisma(); stubMediaStore();
    const { svc } = buildService(prisma);
    stubProvider(svc, async () => { throw new Error("Gemini image request failed (429): quota exhausted verbatim"); });
    const err = await svc.generateAiImage(ORG, ACTOR, { prompt: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain("quota exhausted verbatim");
    expect(prisma.mediaAsset.rows).toHaveLength(0);
    expect(prisma.aIUsageRecord.rows).toHaveLength(0);
  });

  it("non-image provider bytes → honest Bengali 400, no asset, no usage", async () => {
    const prisma = fakePrisma(); stubMediaStore();
    const { svc } = buildService(prisma);
    stubProvider(svc, async () => ({ bytes: Buffer.from("just some text, not an image"), contentType: "text/plain", model: "m", inputTokens: 1, outputTokens: 1, tokensEstimated: false }));
    await expect(svc.generateAiImage(ORG, ACTOR, { prompt: "x" }))
      .rejects.toThrow("Provider এমন ডেটা ফেরত দিয়েছে যা ছবি হিসেবে পড়া যাচ্ছে না — Asset তৈরি হয়নি।");
    expect(prisma.mediaAsset.rows).toHaveLength(0);
    expect(prisma.aIUsageRecord.rows).toHaveLength(0);
  });

  it("kill switch → 403 (feature social_image), before provider resolution matters", async () => {
    const prisma = fakePrisma(); stubMediaStore();
    prisma.systemSetting.rows.push({ key: "killSwitches", value: { aiDisabledOrgIds: [ORG] } });
    const { svc } = buildService(prisma);
    stubProvider(svc, async () => okPngResult());
    const err = await svc.generateAiImage(ORG, ACTOR, { prompt: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(403);
    expect(prisma.mediaAsset.rows).toHaveLength(0);
  });

  it("daily cap for social_image → 429 once the limit is used", async () => {
    const prisma = fakePrisma(); stubMediaStore();
    prisma.organization.rows[0].aiDailyLimitOverride = 1;
    prisma.aIUsageRecord.rows.push({
      id: "usage-seed", organizationId: ORG, userId: ACTOR, feature: "social_image",
      provider: "gemini", createdAt: new Date(),
    });
    const { svc } = buildService(prisma);
    stubProvider(svc, async () => okPngResult());
    const err = await svc.generateAiImage(ORG, ACTOR, { prompt: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    expect(err.message).toContain("Daily AI generation limit reached for this organization (1)");
    expect(prisma.aIUsageRecord.rows).toHaveLength(1); // only the seed
  });

  it("cross-org product → 404", async () => {
    const prisma = fakePrisma(); stubMediaStore();
    prisma.product.rows.push({
      id: "prod-other", organizationId: "org-OTHER", name: "Other", category: null,
      priceMinor: 100n, currency: "BDT",
    });
    const { svc } = buildService(prisma);
    stubProvider(svc, async () => okPngResult());
    const err = await svc.generateAiImage(ORG, ACTOR, { prompt: "x", productId: "prod-other" }).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.message).toContain("Product not found in this organization");
  });
});

describe("composePosterSvg / wrapPosterText", () => {
  const photo = `data:image/png;base64,${PNG_B64}`;

  it("starts with <svg, embeds the photo URI and the brand colour, escapes headline text", () => {
    const svg = composePosterSvg({
      photoDataUri: photo, headline: "A & B <Sale>", subtext: "BDT 100.00",
      brandName: "Shop One", primaryColor: "#FF5733",
    });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain(photo);
    expect(svg).toContain("#FF5733");
    expect(svg).toContain("A &amp; B &lt;Sale&gt;");
    expect(svg).not.toContain("A & B <Sale>");
    expect(svg).toContain("BDT 100.00");
    expect(svg).toContain("Shop One");
  });

  it("wrapPosterText caps at 2 lines with an ellipsis on overflow", () => {
    const lines = wrapPosterText("This is a very long headline that will definitely need wrapping across lines", 24);
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines[lines.length - 1]).toContain("…");
    const short = wrapPosterText("Short Sale", 24);
    expect(short).toEqual(["Short Sale"]);
    const svg = composePosterSvg({
      photoDataUri: photo,
      headline: "This is a very long headline that will definitely need wrapping across lines",
      subtext: "", brandName: "", primaryColor: "#111827",
    });
    expect((svg.match(/<tspan/g) ?? []).length).toBe(2);
  });
});

describe("SocialImageService.createTemplateImage", () => {
  function setup() {
    const prisma = fakePrisma();
    const blobs = stubMediaStore();
    const assetRow = {
      id: "asset-1", organizationId: ORG, kind: "image", name: "photo.png",
      contentType: "image/png", sizeBytes: PNG_BYTES.length,
      storageKey: `${ORG}/social/asset-1.png`, publicToken: null,
      origin: "upload", prompt: null, createdById: ACTOR,
      createdAt: new Date(), updatedAt: new Date(),
    };
    prisma.mediaAsset.rows.push(assetRow);
    blobs.set(assetRow.storageKey, { bytes: PNG_BYTES, contentType: "image/png" });
    const { svc, auditRows } = buildService(prisma);
    return { prisma, blobs, svc, auditRows };
  }

  function storedSvg(prisma: any, blobs: Map<string, any>, createdId: string): string {
    const row = prisma.mediaAsset.rows.find((r: any) => r.id === createdId);
    return blobs.get(row.storageKey)?.bytes.toString("utf8") ?? "";
  }

  it("creates an SVG poster asset: origin template, real price as default subtext, social_template usage", async () => {
    const { prisma, blobs, svc, auditRows } = setup();
    const created: any = await svc.createTemplateImage(ORG, ACTOR, { mediaAssetId: "asset-1", productId: "prod-1", headline: "ঈদ অফার" });
    expect(created.origin).toBe("template");
    expect(created.contentType).toBe("image/svg+xml");
    expect(created.kind).toBe("image");
    const svg = storedSvg(prisma, blobs, created.id);
    expect(svg.startsWith("<svg")).toBe(true);
    // Default subtext = the product's REAL formatted price.
    expect(svg).toContain("BDT 1500.00");
    expect(svg).toContain("#FF5733"); // org brand colour, uppercased
    expect(prisma.aIUsageRecord.rows).toHaveLength(1);
    const usage = prisma.aIUsageRecord.rows[0];
    expect(usage.feature).toBe("social_template");
    expect(usage.provider).toBe("template-composer");
    expect(usage.model).toBe("svg-template-v1");
    expect(usage.estimated).toBe(true);
    expect(auditRows.some((r: any) => r.action === "social.template_image_created" && r.metadata.withProduct === true)).toBe(true);
  });

  it("explicit subtext overrides the price; empty subtext means NO price in the SVG", async () => {
    const { prisma, blobs, svc } = setup();
    const a: any = await svc.createTemplateImage(ORG, ACTOR, { mediaAssetId: "asset-1", productId: "prod-1", headline: "Sale", subtext: "শুধু আজকের জন্য" });
    const svgA = storedSvg(prisma, blobs, a.id);
    expect(svgA).toContain("শুধু আজকের জন্য");
    expect(svgA).not.toContain("BDT 1500.00");

    const b: any = await svc.createTemplateImage(ORG, ACTOR, { mediaAssetId: "asset-1", productId: "prod-1", headline: "Sale", subtext: "" });
    const svgB = storedSvg(prisma, blobs, b.id);
    expect(svgB).not.toContain("BDT");
  });

  it("productId without mediaAssetId → PP3 auto-import path (contract change: the SP2 deferral 400 is gone)", async () => {
    // PP3 CONTRACT CHANGE: this used to assert the honest SP2
    // deferral ("Product-এর ছবি Media Library-তে নেই … import
    // করার ব্যবস্থা এখনো নেই"). PP3 replaces that dead end with
    // a real auto-import via SocialImportService. The fake prod-1
    // carries NO imageUrl, so the importer's own Bengali 400
    // surfaces verbatim from createTemplateImage — and the old
    // deferral text must never come back. (The full auto-import
    // success/failure matrix lives in social-pp3.spec.ts.)
    const { svc } = setup();
    const err = await svc.createTemplateImage(ORG, ACTOR, { productId: "prod-1", headline: "Sale" }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain("কোনো ছবির URL নেই");
    expect(err.message).not.toContain("import করার ব্যবস্থা এখনো নেই");
    const err2 = await svc.createTemplateImage(ORG, ACTOR, { headline: "Sale" }).catch((e) => e);
    expect(err2.message).toContain("Template Poster-এর জন্য একটি ছবি বেছে নিন।");
  });

  it("video asset → 400; other org's asset → 404; missing headline → 400; overlong headline → 400", async () => {
    const { prisma, svc } = setup();
    prisma.mediaAsset.rows.push({
      id: "asset-video", organizationId: ORG, kind: "video", name: "clip.mp4",
      contentType: "video/mp4", sizeBytes: 10, storageKey: `${ORG}/social/v.mp4`,
      publicToken: null, origin: "upload", prompt: null, createdById: ACTOR,
      createdAt: new Date(), updatedAt: new Date(),
    });
    prisma.mediaAsset.rows.push({
      id: "asset-foreign", organizationId: "org-OTHER", kind: "image", name: "x.png",
      contentType: "image/png", sizeBytes: 10, storageKey: `org-OTHER/social/x.png`,
      publicToken: null, origin: "upload", prompt: null, createdById: ACTOR,
      createdAt: new Date(), updatedAt: new Date(),
    });
    const videoErr = await svc.createTemplateImage(ORG, ACTOR, { mediaAssetId: "asset-video", headline: "Sale" }).catch((e) => e);
    expect(videoErr).toBeInstanceOf(BadRequestException);
    expect(videoErr.message).toContain("ছবি (image) asset লাগবে");
    const foreignErr = await svc.createTemplateImage(ORG, ACTOR, { mediaAssetId: "asset-foreign", headline: "Sale" }).catch((e) => e);
    expect(foreignErr).toBeInstanceOf(NotFoundException);
    await expect(svc.createTemplateImage(ORG, ACTOR, { mediaAssetId: "asset-1", headline: "   " }))
      .rejects.toThrow("Poster-এর Headline দিন।");
    await expect(svc.createTemplateImage(ORG, ACTOR, { mediaAssetId: "asset-1", headline: "x".repeat(121) }))
      .rejects.toThrow("Headline সর্বোচ্চ ১২০ অক্ষরের হতে পারবে।");
    // Only the seed asset exists — failures created nothing.
    expect(prisma.mediaAsset.rows.filter((r: any) => r.origin === "template")).toHaveLength(0);
  });
});

describe("Admin image config — verify-before-save", () => {
  const actor: any = { id: "admin-1" };

  function adminPrismaFake() {
    const rows: any[] = [];
    return {
      rows,
      systemSetting: {
        rows,
        findUnique: async ({ where }: any) => rows.find((r) => r.key === where.key) ?? null,
        upsert: async ({ where, create, update }: any) => {
          const row = rows.find((r) => r.key === where.key);
          if (row) { Object.assign(row, update); return row; }
          const created = { ...create }; rows.push(created); return created;
        },
        deleteMany: async ({ where }: any) => {
          const i = rows.findIndex((r) => r.key === where.key);
          if (i >= 0) rows.splice(i, 1);
          return { count: 1 };
        },
      },
    } as any;
  }

  beforeEach(() => {
    setPlatformConfigSnapshot({ llm: null, metaApp: null, smtp: null, sms: null, sslcommerz: null, bkash: null, image: null, loadedAt: 0 });
    delete process.env.IMAGE_PROVIDER; delete process.env.IMAGE_API_KEY; delete process.env.IMAGE_MODEL;
  });
  afterAll(() => setPlatformConfigSnapshot({ llm: null, metaApp: null, smtp: null, sms: null, sslcommerz: null, bkash: null, image: null, loadedAt: 0 }));

  it("verification failure → throws with the provider error verbatim and writes NO row", async () => {
    const prisma = adminPrismaFake();
    const audit = { log: async () => undefined } as any;
    const svc = new AdminService(prisma, audit);
    (global as any).fetch = jest.fn(async () => ({
      ok: false, status: 400,
      json: async () => ({ error: { message: "API key not valid. Please pass a valid API key." } }),
    }));
    const err = await svc.updatePlatformConfig(actor, "image", { provider: "gemini", apiKey: "bad-key" }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain("Image provider verification FAILED — the setting was NOT saved:");
    expect(err.message).toContain("Gemini image request failed (400): API key not valid.");
    expect(prisma.rows.find((r: any) => r.key === "imageConfig")).toBeUndefined();
  });

  it("verification success → row written (key sealed) and imageVerification returned", async () => {
    const prisma = adminPrismaFake();
    const audit = { log: async () => undefined } as any;
    const svc = new AdminService(prisma, audit);
    (global as any).fetch = jest.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ inlineData: { data: PNG_B64, mimeType: "image/png" } }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 100 },
      }),
    }));
    const view: any = await svc.updatePlatformConfig(actor, "image", { provider: "gemini", apiKey: "good-key" });
    const row = prisma.rows.find((r: any) => r.key === "imageConfig");
    expect(row).toBeDefined();
    expect(row.value.provider).toBe("gemini");
    expect(row.value.apiKeyEncrypted).not.toContain("good-key");
    expect(view.image.provider).toBe("gemini");
    expect(view.image.secretConfigured).toBe(true);
    expect(JSON.stringify(view)).not.toContain("good-key");
    expect(view.imageVerification).toMatchObject({ ok: true, model: "gemini-2.5-flash-image" });
  });

  it("invalid provider → 400; disable-style save (empty provider) skips verification entirely", async () => {
    const prisma = adminPrismaFake();
    const audit = { log: async () => undefined } as any;
    const svc = new AdminService(prisma, audit);
    await expect(svc.updatePlatformConfig(actor, "image", { provider: "dall-e" }))
      .rejects.toThrow("image provider must be gemini");
    (global as any).fetch = jest.fn(async () => { throw new Error("fetch must not be called"); });
    const view: any = await svc.updatePlatformConfig(actor, "image", { provider: "" });
    expect(view.imageVerification).toBeUndefined();
    expect(prisma.rows.find((r: any) => r.key === "imageConfig")?.value.provider).toBe("");
  });
});
