import { CreativesService } from "../creatives/creatives.service";
import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * CA2 — AI slideshow video: service wiring + script facts.
 *
 * The video-slides module is stubbed HERE (labelled stub,
 * tests only — it returns the input photo / a tiny ftyp
 * buffer instantly); the REAL sharp+ffmpeg assembly is
 * proven separately in creatives/ca2-video-slides.spec.ts.
 * The Meta graph seam is module-mocked like the other
 * creative specs, so upload() runs for real and each
 * variant's status is the mocked Meta answer ("processing").
 * Proven here: 3 aspect assets through the real storage +
 * registry path, ffmpeg-missing honest refusal, external
 * (non-CDN) product photos refusal, template script labelled
 * as template, and an LLM script with an INVENTED number
 * falling back to the template instead of being used.
 */

jest.mock("../common/meta-graph", () => ({
  metaTokenForAccount: jest.fn(async () => ({ account: { id: "acct-1", externalId: "act_123" }, token: "tok" })),
  graphPost: jest.fn(async (_token: string, path: string) =>
    path.endsWith("/advideos") ? { id: "video-999" } : { images: { "gen.png": { hash: "hash-1" } } },
  ),
  graphGet: jest.fn(async () => ({})),
}));

const FAKE_MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom", "ascii"), Buffer.alloc(64, 7)]);
jest.mock("../creatives/video-slides", () => ({
  isFfmpegAvailable: jest.fn(async () => true),
  renderSlidePng: jest.fn(async (input: any) => input.photo),
  assembleSlideshowMp4: jest.fn(async () => FAKE_MP4),
}));

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const ORG = "org-1";
const ACTOR = "user-1";
const CDN_KEY = "org-1/products/panjabi.png";
const CDN_URL = `https://media.qosprey.com/${CDN_KEY}`;

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) return true;
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
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
  };
}

function buildCreatives(productImageUrl: string | null = CDN_URL) {
  const tables: any = {
    creativeAsset: makeTable("asset"),
    aIUsageRecord: makeTable("usage"),
    product: makeTable("product"),
    productImage: makeTable("pimg"),
    organization: makeTable("org"),
    systemSetting: makeTable("setting"),
    subscription: makeTable("sub"),
  };
  tables.organization.rows.push({ id: ORG, name: "Shop One", primaryColor: "#224466" });
  tables.product.rows.push({
    id: "prod-1", organizationId: ORG, name: "Cotton Panjabi", category: "clothing",
    description: "Comfortable cotton", priceMinor: 150000n, currency: "BDT", imageUrl: productImageUrl,
  });
  const prisma: any = { ...tables, orgFeatureFlag: { findUnique: async () => ({ enabled: true }) } };
  const auditRows: any[] = [];
  const audit: any = { log: jest.fn(async (i: any) => { auditRows.push(i); }) };
  const objects = new Map<string, Buffer>([[CDN_KEY, PNG_BYTES]]);
  const storage: any = {
    mode: "s3",
    bucketFor: (v: string) => (v === "public" ? "pub-bucket" : "priv-bucket"),
    get: jest.fn(async (_v: string, key: string) => objects.get(key) ?? null),
    put: jest.fn(async (_v: string, key: string, bytes: Buffer) => { objects.set(key, Buffer.from(bytes)); }),
    delete: jest.fn(async (_v: string, key: string) => { objects.delete(key); }),
  };
  const registered: any[] = [];
  const registry: any = { register: jest.fn(async (i: any) => { registered.push(i); return i; }) };
  const svc = new CreativesService(prisma as any, audit, storage, registry);
  return { svc, tables, auditRows, objects, registered };
}

describe("CA2 CreativesService.generateAiVideo", () => {
  it("creates 3 aspect video assets through storage + registry + Meta ingest", async () => {
    const { svc, tables, objects, registered, auditRows } = buildCreatives();
    const out = await svc.generateAiVideo(ORG, ACTOR, {
      adAccountId: "acct-1", productId: "prod-1", name: "AI ভিডিও — Cotton Panjabi",
      script: { headline: "Cotton Panjabi", lines: ["Comfortable cotton", "বিস্তারিত দেখতে ক্লিক করুন"] },
    });
    expect(out.framesUsed).toBe(1);
    expect(out.assets).toHaveLength(3);
    const names = out.assets.map((a: any) => a.name);
    expect(names.some((n: string) => n.endsWith("(1:1)"))).toBe(true);
    expect(names.some((n: string) => n.endsWith("(4:5)"))).toBe(true);
    expect(names.some((n: string) => n.endsWith("(9:16)"))).toBe(true);
    for (const a of out.assets) {
      expect(a.kind).toBe("video");
      expect(a.status).toBe("processing"); // Meta's ingest answer via the mocked seam
      expect(a.externalVideoId).toBe("video-999");
    }
    expect(tables.creativeAsset.rows).toHaveLength(3);
    expect(registered).toHaveLength(3);
    expect(registered.every((r: any) => r.contentType === "video/mp4" && r.surface === "creative")).toBe(true);
    const storedMp4s = [...objects.keys()].filter((k) => k.endsWith(".mp4"));
    expect(storedMp4s).toHaveLength(3);
    expect(auditRows.some((r: any) => r.action === "creative.ai_video_created")).toBe(true);
  });

  it("ffmpeg unavailable → honest refusal, nothing created", async () => {
    const { svc, tables } = buildCreatives();
    jest.spyOn(svc, "videoFfmpegAvailable").mockResolvedValue(false);
    await expect(svc.generateAiVideo(ORG, ACTOR, {
      adAccountId: "acct-1", productId: "prod-1", name: "V", script: { headline: "H", lines: ["L"] },
    })).rejects.toThrow("ffmpeg এই সার্ভারে পাওয়া যাচ্ছে না");
    expect(tables.creativeAsset.rows).toHaveLength(0);
  });

  it("product photo only on an external URL → honest refusal (bytes are never fetched ad-hoc)", async () => {
    const { svc, tables } = buildCreatives("https://example.com/external.png");
    await expect(svc.generateAiVideo(ORG, ACTOR, {
      adAccountId: "acct-1", productId: "prod-1", name: "V", script: { headline: "H", lines: ["L"] },
    })).rejects.toThrow("মিডিয়া CDN-এ পাওয়া যায়নি");
    expect(tables.creativeAsset.rows).toHaveLength(0);
  });
});

describe("CA2 CampaignsService.generateVideo (script discipline)", () => {
  function buildCampaigns(llm: any, creatives?: any) {
    const tables: any = {
      campaignPlan: makeTable("plan"), product: makeTable("product"), aIUsageRecord: makeTable("usage"),
    };
    tables.campaignPlan.rows.push({ id: "plan-1", organizationId: ORG, adAccountId: "acct-9", status: "draft", name: "P" });
    tables.product.rows.push({
      id: "prod-1", organizationId: ORG, name: "Cotton Panjabi", category: "clothing",
      description: "Comfortable cotton", priceMinor: 150000n, currency: "BDT", imageUrl: CDN_URL,
    });
    const svc = new CampaignsService(tables as any, { log: async () => undefined } as any, llm, undefined, undefined, undefined, creatives);
    return { svc, tables };
  }
  const stubCreatives = () => ({
    generateAiVideo: jest.fn(async () => ({ assets: [{ id: "v1" }, { id: "v2" }, { id: "v3" }], framesUsed: 2 })),
  });

  it("no real LLM → template script from real facts, LABELLED template", async () => {
    const creatives = stubCreatives();
    const { svc } = buildCampaigns({ getProvider: () => new DevTemplateProvider() }, creatives);
    const out = await svc.generateVideo(ORG, ACTOR, "plan-1", { productId: "prod-1" });
    expect(out.scriptSource).toBe("template");
    expect(out.script.headline).toBe("Cotton Panjabi");
    expect(creatives.generateAiVideo).toHaveBeenCalledWith(ORG, ACTOR, expect.objectContaining({ adAccountId: "acct-9", productId: "prod-1" }));
  });

  it("LLM script with an INVENTED number (50% discount) → falls back to the labelled template", async () => {
    const fakeLlm = {
      isRealLlm: true, name: "fake-llm",
      complete: async () => ({
        text: JSON.stringify({ headline: "দারুণ অফার", lines: ["এখনই 50% ছাড়ে কিনুন", "সীমিত সময়ের অফার"] }),
        inputTokens: 5, outputTokens: 6, tokensEstimated: false,
      }),
    };
    const creatives = stubCreatives();
    const { svc, tables } = buildCampaigns({ getProvider: () => fakeLlm }, creatives);
    const out = await svc.generateVideo(ORG, ACTOR, "plan-1", { productId: "prod-1" });
    expect(out.scriptSource).toBe("template");
    expect(JSON.stringify(out.script)).not.toContain("50%");
    // The LLM call still consumed tokens — usage recorded.
    expect(tables.aIUsageRecord.rows.some((r: any) => r.feature === "ad_video_script")).toBe(true);
  });

  it("clean LLM script (only the real price as a number) → used, labelled llm", async () => {
    const fakeLlm = {
      isRealLlm: true, name: "fake-llm",
      complete: async () => ({
        text: JSON.stringify({ headline: "কটন পাঞ্জাবি — নতুন কালেকশন", lines: ["আরামদায়ক কটন ফেব্রিক", "দাম মাত্র 1500 টাকা"] }),
        inputTokens: 5, outputTokens: 6, tokensEstimated: false,
      }),
    };
    const creatives = stubCreatives();
    const { svc } = buildCampaigns({ getProvider: () => fakeLlm }, creatives);
    const out = await svc.generateVideo(ORG, ACTOR, "plan-1", { productId: "prod-1" });
    expect(out.scriptSource).toBe("llm");
    expect(out.script.headline).toContain("নতুন কালেকশন");
  });

  it("creatives service absent → honest refusal", async () => {
    const { svc } = buildCampaigns({ getProvider: () => new DevTemplateProvider() }, undefined);
    await expect(svc.generateVideo(ORG, ACTOR, "plan-1", { productId: "prod-1" }))
      .rejects.toThrow("AI video generation is not available in this context");
  });
});
