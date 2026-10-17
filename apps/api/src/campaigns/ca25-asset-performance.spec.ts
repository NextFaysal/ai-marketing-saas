import { createHash } from "node:crypto";
import { CampaignsService } from "./campaigns.service";
import { CreativesService } from "../creatives/creatives.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder Advanced CA25 (CB6): asset picker
 * intelligence. (1) Per-asset performance joins org ads
 * (imageAssetId / videoAssetId, or a creative:/media:
 * sourceRef on imageUrl/videoUrl) → the ad's
 * externalAdId → DailyAdMetric rows with level "ad"
 * ONLY — campaign/ad-set-level rows must NEVER be
 * attributed to a creative (the CA7 honesty rule).
 * (2) A rating ("আগে ভালো চলেছে") exists only when BOTH
 * stated bars are met by those real rows: >= 1,000
 * impressions AND >= ৳100 (10,000 minor) real spend;
 * rated assets sort above unrated ones. (3) Completing
 * a creative upload whose bytes (sha256) already exist
 * in the org returns a duplicateWarning naming the
 * earlier file — the upload still completes.
 * Creatives part: Meta graph seam is module-mocked (the
 * rb4 harness) — labelled stub evidence, no live calls.
 */
jest.mock("../common/meta-graph", () => ({
  metaTokenForAccount: jest.fn(async () => ({ account: { id: "acct-1", externalId: "act_123" }, token: "tok" })),
  graphPost: jest.fn(async (_token: string, path: string) =>
    path.endsWith("/adimages") ? { images: { "uploaded.png": { hash: "hash-abc" } } } : { id: "video-999" },
  ),
  graphGet: jest.fn(async () => ({})),
}));

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
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
    findFirst: async ({ where, orderBy }: any = {}) => {
      let f = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "asc") f = [...f].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      return f[0] ?? null;
    },
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
  };
}
const auditStub = { log: async () => undefined } as any;
const devLlm = { getProvider: () => new DevTemplateProvider() } as any;

const UUID_C = "11111111-2222-3333-4444-555555555555";

function perfService() {
  const prisma: any = {
    campaignPlan: makeTable("plan"), campaignAdSet: makeTable("adset"), campaignAd: makeTable("ad"),
    dailyAdMetric: makeTable("metric"), creativeAsset: makeTable("ca"), mediaAsset: makeTable("ma"),
  };
  prisma.campaignPlan.rows.push({ id: "plan-1", organizationId: "org-1" });
  prisma.campaignAdSet.rows.push({ id: "adset-1", planId: "plan-1" });
  prisma.campaignAd.rows.push(
    { id: "ad-A", adSetId: "adset-1", externalAdId: "ext-A", imageAssetId: "asset-good", videoAssetId: null, imageUrl: null, videoUrl: null },
    { id: "ad-B", adSetId: "adset-1", externalAdId: "ext-B", imageAssetId: "asset-lowimp", videoAssetId: null, imageUrl: null, videoUrl: null },
    { id: "ad-C", adSetId: "adset-1", externalAdId: "ext-C", imageAssetId: null, videoAssetId: null, imageUrl: `creative:${UUID_C}`, videoUrl: null },
    { id: "ad-D", adSetId: "adset-1", externalAdId: "ext-D", imageAssetId: null, videoAssetId: null, imageUrl: "https://cdn.example/plain.jpg", videoUrl: null },
  );
  prisma.creativeAsset.rows.push(
    { id: "asset-good", name: "Good", kind: "image", createdAt: new Date("2026-09-01") },
    { id: "asset-lowimp", name: "LowImp", kind: "image", createdAt: new Date("2026-09-02") },
    { id: UUID_C, name: "LowSpend", kind: "image", createdAt: new Date("2026-09-03") },
  );
  const m = (over: any) => ({ organizationId: "org-1", date: new Date(), level: "ad", campaignExternalId: null, adSetExternalId: null, adExternalId: null, impressions: 0, clicks: 0, spendMinor: 0, conversions: 0, reach: 0, ...over });
  prisma.dailyAdMetric.rows.push(
    m({ adExternalId: "ext-A", impressions: 3000, clicks: 150, spendMinor: 30000, conversions: 15 }),
    m({ adExternalId: "ext-A", impressions: 2000, clicks: 100, spendMinor: 20000, conversions: 10 }),
    // Campaign-level and ad-set-level rows for the SAME
    // campaign — must never land on any creative.
    m({ level: "campaign", campaignExternalId: "camp-1", impressions: 999999, clicks: 99999, spendMinor: 99999900, conversions: 9999 }),
    m({ level: "adset", adSetExternalId: "adset-ext-1", impressions: 888888, clicks: 8888, spendMinor: 88888800, conversions: 888 }),
    m({ adExternalId: "ext-B", impressions: 500, clicks: 40, spendMinor: 60000, conversions: 6 }),
    m({ adExternalId: "ext-C", impressions: 6000, clicks: 60, spendMinor: 5000, conversions: 1 }),
    m({ adExternalId: "ext-D", impressions: 7000, clicks: 70, spendMinor: 70000, conversions: 7 }),
  );
  return new CampaignsService(prisma, auditStub, devLlm) as any;
}

describe("CA25 asset performance attribution", () => {
  it("rates only assets clearing BOTH bars, from ad-level rows only; campaign/ad-set rows never attributed", async () => {
    const svc = perfService();
    const out = await svc.assetPerformance("org-1");
    const good = out.assets.find((a: any) => a.assetId === "asset-good");
    expect(good).toBeTruthy();
    expect(good.rated).toBe(true);
    expect(good.impressions).toBe(5000); // the 999,999 campaign-level impressions are NOT here
    expect(good.spendMinor).toBe(50000);
    expect(good.ctrPct).toBe(5);
    expect(good.cpaMinor).toBe(2000);
    expect(good.name).toBe("Good");
    // threshold bars are stated in the payload
    expect(out.thresholds.minImpressions).toBe(1000);
    expect(out.thresholds.minSpendMinor).toBe(10000);
  });

  it("below either bar the asset is unrated with null CTR/CPA — never a badge", async () => {
    const svc = perfService();
    const out = await svc.assetPerformance("org-1");
    const lowImp = out.assets.find((a: any) => a.assetId === "asset-lowimp");
    expect(lowImp.impressions).toBe(500);
    expect(lowImp.rated).toBe(false);
    expect(lowImp.ctrPct).toBeNull();
    expect(lowImp.cpaMinor).toBeNull();
    const lowSpend = out.assets.find((a: any) => a.assetId === UUID_C);
    expect(lowSpend.source).toBe("creative");
    expect(lowSpend.impressions).toBe(6000);
    expect(lowSpend.rated).toBe(false);
  });

  it("an ad without an asset reference contributes nothing; rated assets sort above unrated", async () => {
    const svc = perfService();
    const out = await svc.assetPerformance("org-1");
    expect(out.assets).toHaveLength(3); // ad-D (plain URL) has no asset
    expect(out.assets[0].assetId).toBe("asset-good");
    expect(out.assets[0].rated).toBe(true);
    expect(out.assets.slice(1).every((a: any) => !a.rated)).toBe(true);
  });

  it("an org with no plans gets an empty, honestly-shaped payload", async () => {
    const svc: any = new CampaignsService({ campaignPlan: makeTable("p"), campaignAdSet: makeTable("s"), campaignAd: makeTable("a"), dailyAdMetric: makeTable("m"), creativeAsset: makeTable("c"), mediaAsset: makeTable("ma") } as any, auditStub, devLlm);
    const out = await svc.assetPerformance("org-x");
    expect(out.assets).toEqual([]);
    expect(out.thresholds.minImpressions).toBe(1000);
  });
});

// ---- duplicate-upload warning (rb4-style harness) ----
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
function dupService(earlierSha: string | null) {
  const assets: any[] = [];
  const prisma: any = {
    orgFeatureFlag: { findUnique: async () => ({ enabled: true }) },
    creativeAsset: {
      create: async ({ data }: any) => { const row = { id: `asset-${assets.length + 1}`, ...data }; assets.push(row); return row; },
      update: async ({ where, data }: any) => { const row = assets.find((a) => a.id === where.id); Object.assign(row, data); return row; },
      findUnique: async ({ where }: any) => assets.find((a) => a.id === where.id) ?? null,
      findFirst: async ({ where }: any) => assets.find((a) => a.id === where.id) ?? null,
    },
    storedFile: {
      findFirst: async ({ where }: any) =>
        earlierSha && where.sha256 === earlierSha && where.organizationId === "org-1"
          ? { id: "file-earlier", organizationId: "org-1", sha256: earlierSha, status: "active", createdAt: new Date("2026-09-15T10:00:00Z") }
          : null,
    },
  };
  const objects = new Map<string, Buffer>();
  const storage: any = {
    mode: "s3",
    bucketFor: (v: string) => (v === "public" ? "pub" : "priv"),
    head: async (v: string, key: string) => { const b = objects.get(`${v}:${key}`); return b ? { sizeBytes: b.length, contentType: null, etag: null, lastModified: new Date(0).toISOString(), metadata: {} } : null; },
    get: async (v: string, key: string) => objects.get(`${v}:${key}`) ?? null,
    copy: async (from: any, to: any) => { const b = objects.get(`${from.visibility}:${from.key}`); if (!b) throw new Error("missing"); objects.set(`${to.visibility}:${to.key}`, b); return { etag: "\"e\"" }; },
    delete: async (v: string, key: string) => { objects.delete(`${v}:${key}`); },
  };
  const registry: any = { register: async (input: any) => input };
  const service = new CreativesService(prisma, auditStub, storage, registry);
  return { service, objects };
}

describe("CA25 duplicate-upload warning", () => {
  const QKEY = "_quarantine/org-1/creative/uuid-dup";
  const dto = { key: QKEY, kind: "image", contentType: "image/png", sizeBytes: PNG_1PX.length, adAccountId: "acct-1", name: "dup.png" };

  it("same bytes already stored in the org: upload completes WITH a duplicateWarning naming the earlier file", async () => {
    const sha = createHash("sha256").update(PNG_1PX).digest("hex");
    const { service, objects } = dupService(sha);
    objects.set(`public:${QKEY}`, PNG_1PX);
    const asset: any = await service.completeCreativeUpload("org-1", "user-1", dto as any);
    expect(asset.id).toBeTruthy();
    expect(asset.duplicateWarning).toBeTruthy();
    expect(asset.duplicateWarning.otherFileId).toBe("file-earlier");
    expect(asset.duplicateWarning.sha256).toBe(sha);
    expect(new Date(asset.duplicateWarning.firstUploadedAt).toISOString()).toBe("2026-09-15T10:00:00.000Z");
  });

  it("fresh bytes: duplicateWarning is null", async () => {
    const { service, objects } = dupService(null);
    objects.set(`public:${QKEY}`, PNG_1PX);
    const asset: any = await service.completeCreativeUpload("org-1", "user-1", dto as any);
    expect(asset.duplicateWarning).toBeNull();
  });
});
