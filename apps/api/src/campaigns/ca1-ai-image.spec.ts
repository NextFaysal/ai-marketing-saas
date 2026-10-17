import { BadRequestException } from "@nestjs/common";
import { CreativesService } from "../creatives/creatives.service";
import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * CA1 — AI image generation inside the builder.
 *
 * The provider seam is stubbed (labelled stub, tests only);
 * the Meta graph seam is module-mocked exactly like the RB4
 * creative spec, so upload() runs for real: flag check, asset
 * row, Meta ingest call, status transition. Proven here:
 * provider-absent honest refusal (nothing persisted), success
 * path asset correctness (ready + Meta hash + "AI ছবি — "
 * provenance name + registry + "ad_image" usage), product
 * enrichment with name/category ONLY (never the price),
 * non-image bytes refusal, and local-storage refusal BEFORE
 * the provider is ever called.
 */

jest.mock("../common/meta-graph", () => ({
  metaTokenForAccount: jest.fn(async () => ({ account: { id: "acct-1", externalId: "act_123" }, token: "tok" })),
  graphPost: jest.fn(async (_token: string, path: string) =>
    path.endsWith("/adimages") ? { images: { "gen.png": { hash: "hash-gen-1" } } } : { id: "video-999" },
  ),
  graphGet: jest.fn(async () => ({})),
}));

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const ORG = "org-1";
const ACTOR = "user-1";

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && "gte" in (v as any)) {
      return new Date(row[k]) >= (v as any).gte;
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
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
  };
}

function buildCreatives(opts: { mode?: "s3" | "local" } = {}) {
  const tables: any = {
    creativeAsset: makeTable("asset"),
    aIUsageRecord: makeTable("usage"),
    product: makeTable("product"),
    systemSetting: makeTable("setting"),
    organization: makeTable("org"),
    subscription: makeTable("sub"),
  };
  tables.organization.rows.push({ id: ORG, name: "Shop One", aiDailyLimitOverride: null, broadcastCapOverride: null, seatLimit: null });
  tables.product.rows.push({ id: "prod-1", organizationId: ORG, name: "Cotton Panjabi", category: "Men's Fashion", priceMinor: 150000n, currency: "BDT" });
  const prisma: any = {
    ...tables,
    orgFeatureFlag: { findUnique: async () => ({ enabled: true }) },
  };
  const auditRows: any[] = [];
  const audit: any = { log: jest.fn(async (i: any) => { auditRows.push(i); }) };
  const objects = new Map<string, Buffer>();
  const storage: any = {
    mode: opts.mode ?? "s3",
    bucketFor: (v: string) => (v === "public" ? "pub-bucket" : "priv-bucket"),
    put: jest.fn(async (_v: string, key: string, bytes: Buffer) => { objects.set(key, Buffer.from(bytes)); }),
    delete: jest.fn(async (_v: string, key: string) => { objects.delete(key); }),
  };
  const registered: any[] = [];
  const registry: any = { register: jest.fn(async (i: any) => { registered.push(i); return i; }) };
  const svc = new CreativesService(prisma as any, audit, storage, registry);
  return { svc, tables, auditRows, objects, storage, registered };
}

function stubProvider(svc: CreativesService, generate: (prompt: string) => Promise<any>) {
  const provider = { name: "gemini", isRealProvider: true as const, generate };
  jest.spyOn(svc, "resolveProvider").mockReturnValue({ provider: provider as any, providerName: "gemini", model: undefined, source: "admin" });
  return provider;
}

describe("CA1 CreativesService.generateAiImage", () => {
  it("provider not configured → honest Bengali refusal; no asset, no usage, nothing stored", async () => {
    const { svc, tables, objects } = buildCreatives();
    jest.spyOn(svc, "resolveProvider").mockReturnValue(null);
    await expect(svc.generateAiImage(ORG, ACTOR, { adAccountId: "acct-1", prompt: "লাল পাঞ্জাবি" }))
      .rejects.toThrow("AI ছবি তৈরির provider configure করা নেই");
    expect(tables.creativeAsset.rows).toHaveLength(0);
    expect(tables.aIUsageRecord.rows).toHaveLength(0);
    expect(objects.size).toBe(0);
  });

  it("empty prompt → 400 before anything else", async () => {
    const { svc } = buildCreatives();
    await expect(svc.generateAiImage(ORG, ACTOR, { adAccountId: "acct-1", prompt: "   " }))
      .rejects.toThrow("ছবির বর্ণনা (Prompt) দিন");
  });

  it("local storage mode → refusal BEFORE the provider is called (no quota spent)", async () => {
    const { svc } = buildCreatives({ mode: "local" });
    const generate = jest.fn(async () => ({ bytes: PNG_BYTES, contentType: "image/png", model: "m", inputTokens: 1, outputTokens: 1, tokensEstimated: false }));
    stubProvider(svc, generate);
    await expect(svc.generateAiImage(ORG, ACTOR, { adAccountId: "acct-1", prompt: "পাঞ্জাবি" }))
      .rejects.toThrow(BadRequestException);
    expect(generate).not.toHaveBeenCalled();
  });

  it("success: ready CreativeAsset with Meta hash, provenance name, registry row, usage + audit", async () => {
    const { svc, tables, objects, registered, auditRows } = buildCreatives();
    stubProvider(svc, async () => ({ bytes: PNG_BYTES, contentType: "image/png", model: "gemini-img-1", inputTokens: 10, outputTokens: 20, tokensEstimated: false }));
    const out = await svc.generateAiImage(ORG, ACTOR, { adAccountId: "acct-1", prompt: "লাল পাঞ্জাবি, সাদা ব্যাকগ্রাউন্ড" });
    expect(out.provider).toBe("gemini");
    const asset = out.asset;
    expect(asset.kind).toBe("image");
    expect(asset.status).toBe("ready");
    expect(asset.externalHash).toBe("hash-gen-1");
    expect(asset.name.startsWith("AI ছবি — ")).toBe(true);
    expect(asset.sourceUrl).toContain("/creative/");
    // Stored bytes are the provider's actual bytes.
    const key = [...objects.keys()][0];
    expect(objects.get(key)?.equals(PNG_BYTES)).toBe(true);
    expect(asset.sourceUrl.endsWith(key)).toBe(true);
    // Registry bookkeeping points at the created asset.
    expect(registered).toHaveLength(1);
    expect(registered[0].surface).toBe("creative");
    expect(registered[0].sourceRef).toBe(`creative:${asset.id}`);
    expect(registered[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    // Usage recorded under the ad_image feature, AFTER persist.
    expect(tables.aIUsageRecord.rows).toHaveLength(1);
    expect(tables.aIUsageRecord.rows[0].feature).toBe("ad_image");
    expect(tables.aIUsageRecord.rows[0].provider).toBe("gemini");
    expect(auditRows.some((r: any) => r.action === "creative.ai_image_created")).toBe(true);
  });

  it("product enrichment adds name + category to the prompt — NEVER the price", async () => {
    const { svc } = buildCreatives();
    let seenPrompt = "";
    stubProvider(svc, async (p: string) => { seenPrompt = p; return { bytes: PNG_BYTES, contentType: "image/png", model: "m", inputTokens: 1, outputTokens: 1, tokensEstimated: true }; });
    await svc.generateAiImage(ORG, ACTOR, { adAccountId: "acct-1", prompt: "মডেল শট", productId: "prod-1" });
    expect(seenPrompt).toContain("Cotton Panjabi");
    expect(seenPrompt).toContain("Men's Fashion");
    expect(seenPrompt).not.toContain("1500");
    expect(seenPrompt).not.toContain("১৫০০");
  });

  it("non-image provider bytes → refusal; no asset, no usage, nothing stored", async () => {
    const { svc, tables, objects } = buildCreatives();
    stubProvider(svc, async () => ({ bytes: Buffer.from("this is not an image"), contentType: "text/plain", model: "m", inputTokens: 1, outputTokens: 1, tokensEstimated: false }));
    await expect(svc.generateAiImage(ORG, ACTOR, { adAccountId: "acct-1", prompt: "কিছু একটা" }))
      .rejects.toThrow("ছবি হিসেবে পড়া যাচ্ছে না");
    expect(tables.creativeAsset.rows).toHaveLength(0);
    expect(tables.aIUsageRecord.rows).toHaveLength(0);
    expect(objects.size).toBe(0);
  });

  it("provider throws → verbatim error surfaces; nothing persisted", async () => {
    const { svc, tables } = buildCreatives();
    stubProvider(svc, async () => { throw new Error("Gemini quota exhausted (provider verbatim)"); });
    await expect(svc.generateAiImage(ORG, ACTOR, { adAccountId: "acct-1", prompt: "পাঞ্জাবি" }))
      .rejects.toThrow("Gemini quota exhausted (provider verbatim)");
    expect(tables.creativeAsset.rows).toHaveLength(0);
    expect(tables.aIUsageRecord.rows).toHaveLength(0);
  });
});

describe("CA1 CampaignsService.generateImage (plan gate + delegation)", () => {
  function buildCampaigns(creatives?: any, planStatus = "draft") {
    const tables: any = { campaignPlan: makeTable("plan") };
    tables.campaignPlan.rows.push({ id: "plan-1", organizationId: ORG, adAccountId: "acct-9", status: planStatus, name: "P" });
    const svc = new CampaignsService(
      tables as any, { log: async () => undefined } as any,
      { getProvider: () => new DevTemplateProvider() } as any,
      undefined, undefined, undefined, creatives,
    );
    return { svc, tables };
  }

  it("creatives service absent → honest refusal", async () => {
    const { svc } = buildCampaigns(undefined);
    await expect(svc.generateImage(ORG, ACTOR, "plan-1", { prompt: "ছবি" }))
      .rejects.toThrow("AI image generation is not available in this context");
  });

  it("delegates with the plan's ad account by default", async () => {
    const generateAiImage = jest.fn(async () => ({ asset: { id: "asset-1", status: "ready" }, provider: "gemini", model: "m" }));
    const { svc } = buildCampaigns({ generateAiImage });
    const out = await svc.generateImage(ORG, ACTOR, "plan-1", { prompt: "ছবি", productId: "prod-1" });
    expect(generateAiImage).toHaveBeenCalledWith(ORG, ACTOR, { adAccountId: "acct-9", prompt: "ছবি", productId: "prod-1" });
    expect(out.asset.id).toBe("asset-1");
  });

  it("published plan is not editable → generation refused at the plan gate", async () => {
    const generateAiImage = jest.fn(async () => ({ asset: { id: "x" }, provider: "gemini", model: "m" }));
    const { svc } = buildCampaigns({ generateAiImage }, "published");
    await expect(svc.generateImage(ORG, ACTOR, "plan-1", { prompt: "ছবি" })).rejects.toThrow();
    expect(generateAiImage).not.toHaveBeenCalled();
  });
});
