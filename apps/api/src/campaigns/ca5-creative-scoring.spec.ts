import sharp from "sharp";
import { CreativesService } from "../creatives/creatives.service";
import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * CA5 — creative scoring depth.
 *
 * Proven: (1) dimensions are stored from REAL bytes — direct
 * upload completion (sharp metadata), CA1 AI image, CA2 AI
 * video (exact render size); (2) creative-health runs
 * deterministic dimension checks (low resolution, taller
 * than 9:16, landscape-without-vertical-override); (3) an
 * asset without dimensions is reported not_checked, never
 * passed; (4) the text-in-image and 9:16 safe-zone items are
 * VisionService estimates, LABELLED as estimates; vision
 * unavailable → not_checked with the provider's own reason.
 */

jest.mock("../common/meta-graph", () => ({
  metaTokenForAccount: jest.fn(async () => ({ account: { id: "acct-1", externalId: "act_123" }, token: "tok" })),
  graphPost: jest.fn(async (_token: string, path: string) =>
    path.endsWith("/adimages") ? { images: { "gen.png": { hash: "hash-1" } } } : { id: "video-999" },
  ),
  graphGet: jest.fn(async () => ({})),
}));
jest.mock("../creatives/video-slides", () => ({
  isFfmpegAvailable: jest.fn(async () => true),
  renderSlidePng: jest.fn(async (input: any) => input.photo),
  assembleSlideshowMp4: jest.fn(async () => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom", "ascii"), Buffer.alloc(32, 3)])),
}));

const ORG = "org-1";
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
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
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
  };
}
async function pngOf(w: number, h: number): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 120, g: 80, b: 40 } } }).png().toBuffer();
}
function s3Storage(objects: Map<string, Buffer>) {
  return {
    mode: "s3",
    bucketFor: (v: string) => (v === "public" ? "pub" : "priv"),
    get: jest.fn(async (_v: string, k: string) => objects.get(k) ?? null),
    put: jest.fn(async (_v: string, k: string, b: Buffer) => { objects.set(k, Buffer.from(b)); }),
    head: jest.fn(async (_v: string, k: string) => { const b = objects.get(k); return b ? { sizeBytes: b.length, contentType: "image/png" } : null; }),
    copy: jest.fn(async (from: any, to: any) => { const b = objects.get(from.key); if (b) objects.set(to.key, b); }),
    delete: jest.fn(async (_v: string, k: string) => { objects.delete(k); }),
  } as any;
}

describe("CA5 dimension population", () => {
  function buildCreatives() {
    const tables: any = {
      creativeAsset: makeTable("asset"), product: makeTable("product"), productImage: makeTable("pimg"),
      organization: makeTable("org"), systemSetting: makeTable("setting"), subscription: makeTable("sub"), aIUsageRecord: makeTable("usage"),
    };
    tables.organization.rows.push({ id: ORG, name: "Shop", primaryColor: "#224466" });
    const prisma: any = { ...tables, orgFeatureFlag: { findUnique: async () => ({ enabled: true }) } };
    const objects = new Map<string, Buffer>();
    const svc = new CreativesService(prisma as any, { log: async () => undefined } as any, s3Storage(objects), { register: async () => ({}) } as any);
    return { svc, tables, objects };
  }

  it("direct upload completion stores sharp-measured dimensions (800×600)", async () => {
    const { svc, objects } = buildCreatives();
    const png = await pngOf(800, 600);
    const qKey = `_quarantine/${ORG}/creative/q1.png`;
    objects.set(qKey, png);
    const asset = await svc.completeCreativeUpload(ORG, "u1", { key: qKey, kind: "image", contentType: "image/png", sizeBytes: png.length, adAccountId: "acct-1", name: "Uploaded" });
    expect(asset.width).toBe(800);
    expect(asset.height).toBe(600);
  });

  it("CA1 AI image stores the generated image's dimensions (640×480)", async () => {
    const { svc } = buildCreatives();
    const png = await pngOf(640, 480);
    jest.spyOn(svc, "resolveProvider").mockReturnValue({
      provider: { generate: async () => ({ bytes: png, contentType: "image/png", inputTokens: 0, outputTokens: 0, tokensEstimated: true }) },
      model: "stub-1",
    } as any);
    const { asset } = await svc.generateAiImage(ORG, "u1", { adAccountId: "acct-1", prompt: "a panjabi" });
    expect(asset.width).toBe(640);
    expect(asset.height).toBe(480);
  });

  it("CA2 AI video stores each variant's exact render size", async () => {
    const { svc, tables, objects } = buildCreatives();
    const photo = await pngOf(500, 500);
    const key = "org-1/products/p.png";
    objects.set(key, photo);
    tables.product.rows.push({ id: "prod-1", organizationId: ORG, name: "Panjabi", priceMinor: 150000n, currency: "BDT", imageUrl: `https://media.qosprey.com/${key}` });
    const out = await svc.generateAiVideo(ORG, "u1", { adAccountId: "acct-1", productId: "prod-1", name: "AI ভিডিও — Panjabi", script: { headline: "Panjabi", lines: ["Line"] } });
    const dims = out.assets.map((a: any) => `${a.width}x${a.height}`).sort();
    expect(dims).toEqual(["1080x1080", "1080x1350", "1080x1920"]);
  });
});

describe("CA5 creativeHealth depth", () => {
  function buildHealth(vision?: any, creatives?: any) {
    const tables: any = {
      campaignPlan: makeTable("plan"), campaignAdSet: makeTable("set"), campaignAd: makeTable("ad"),
      creativeAsset: makeTable("asset"), businessProfile: makeTable("bp"), campaignPublishLog: makeTable("log"),
    };
    tables.campaignPlan.rows.push({ id: "plan-1", organizationId: ORG, name: "P", status: "draft", createdById: "u1" });
    tables.campaignAdSet.rows.push({ id: "set-1", planId: "plan-1", name: "S", targeting: {} });
    const svc = new CampaignsService(
      tables as any, { log: async () => undefined } as any, { getProvider: () => new DevTemplateProvider() } as any,
      undefined, undefined, undefined, creatives, vision,
    );
    return { svc, tables };
  }
  const baseAd = { planId: "plan-1", adSetId: "set-1", primaryText: "একটি যথেষ্ট লম্বা প্রাইমারি টেক্সট এখানে আছে", headline: "শিরোনাম", linkUrl: "https://shop.example.com/p", format: "link" };
  const creativesStub = { creativeImageBytes: async () => ({ bytes: Buffer.from("x"), mimeType: "image/png" }) };

  it("dimension checks: low resolution + landscape warnings from stored dims", async () => {
    const { svc, tables } = buildHealth(undefined, creativesStub);
    tables.creativeAsset.rows.push(
      { id: "img-small", organizationId: ORG, kind: "image", sourceUrl: "https://media.qosprey.com/org-1/creative/s.png", width: 300, height: 300 },
      { id: "img-wide", organizationId: ORG, kind: "image", sourceUrl: "https://media.qosprey.com/org-1/creative/w.png", width: 2000, height: 800 },
    );
    tables.campaignAd.rows.push(
      { ...baseAd, id: "ad-1", name: "Small", imageAssetId: "img-small" },
      { ...baseAd, id: "ad-2", name: "Wide", imageAssetId: "img-wide" },
    );
    const out = await svc.creativeHealth(ORG, "plan-1", "u1");
    expect(out.findings.some((f: any) => f.adId === "ad-1" && f.message.includes("রেজোলিউশন কম"))).toBe(true);
    expect(out.findings.some((f: any) => f.adId === "ad-2" && f.message.includes("Landscape ছবি"))).toBe(true);
  });

  it("asset WITHOUT dimensions → not_checked (never a silent pass); vision absent → not_checked too", async () => {
    const { svc, tables } = buildHealth(undefined, undefined);
    tables.creativeAsset.rows.push({ id: "img-old", organizationId: ORG, kind: "image", sourceUrl: "https://media.qosprey.com/org-1/creative/old.png", width: null, height: null });
    tables.campaignAd.rows.push({ ...baseAd, id: "ad-1", name: "Old", imageAssetId: "img-old" });
    const out = await svc.creativeHealth(ORG, "plan-1", "u1");
    expect(out.findings.some((f: any) => f.level === "not_checked" && f.message.includes("Dimension"))).toBe(true);
    expect(out.findings.some((f: any) => f.level === "not_checked" && f.message.includes("Vision"))).toBe(true);
  });

  it("vision unavailable → the item is not_checked WITH the provider's reason", async () => {
    const vision = { analyzeImage: async () => ({ available: false, reason: "No real AI (LLM) provider is configured" }) };
    const { svc, tables } = buildHealth(vision, creativesStub);
    tables.creativeAsset.rows.push({ id: "img-1", organizationId: ORG, kind: "image", sourceUrl: "https://media.qosprey.com/org-1/creative/a.png", width: 1080, height: 1080 });
    tables.campaignAd.rows.push({ ...baseAd, id: "ad-1", name: "A", imageAssetId: "img-1" });
    const out = await svc.creativeHealth(ORG, "plan-1", "u1");
    expect(out.findings.some((f: any) => f.level === "not_checked" && f.message.includes("No real AI"))).toBe(true);
  });

  it("vision estimate: heavy text + vertical edge content → labelled estimate warnings incl. 9:16 safe zone", async () => {
    const vision = { analyzeImage: async () => ({ available: true, text: JSON.stringify({ textCoveragePercent: 55, contentAtEdges: ["bottom"], summary: "estimate" }), provider: "stub", model: "m" }) };
    const { svc, tables } = buildHealth(vision, creativesStub);
    tables.creativeAsset.rows.push({ id: "img-v", organizationId: ORG, kind: "image", sourceUrl: "https://media.qosprey.com/org-1/creative/v.png", width: 1080, height: 1920 });
    tables.campaignAd.rows.push({ ...baseAd, id: "ad-1", name: "Vertical", imageAssetId: "img-v" });
    const out = await svc.creativeHealth(ORG, "plan-1", "u1");
    expect(out.findings.some((f: any) => f.message.includes("Vision Estimate") && f.message.includes("55%"))).toBe(true);
    expect(out.findings.some((f: any) => f.message.includes("Safe Zone"))).toBe(true);
  });
});
