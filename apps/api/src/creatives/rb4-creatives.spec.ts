import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { CreativesService } from "./creatives.service";

/**
 * RB4/RM8 item 5 — direct-to-R2 creative uploads.
 *
 * Storage is a recorded fake; the Meta graph seam is module-
 * mocked (the same seam the by-URL path uses), so complete()
 * runs the REAL upload() — flag check, asset row, Meta call,
 * status transitions — against a scripted Meta answer. No live
 * bucket, no live Meta: this proves wiring, not R2 itself.
 */

jest.mock("../common/meta-graph", () => ({
  metaTokenForAccount: jest.fn(async () => ({ account: { id: "acct-1", externalId: "act_123" }, token: "tok" })),
  graphPost: jest.fn(async (_token: string, path: string) =>
    path.endsWith("/adimages") ? { images: { "uploaded.png": { hash: "hash-abc" } } } : { id: "video-999" },
  ),
  graphGet: jest.fn(async () => ({})),
}));

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const MP4_HEAD = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from("ftypisom", "ascii"),
  Buffer.from([0x00, 0x00, 0x02, 0x00]),
  Buffer.from("isomiso2", "ascii"),
]);

function makeService(opts: { mode?: "s3" | "local"; flagEnabled?: boolean } = {}) {
  const assets: any[] = [];
  const prisma: any = {
    orgFeatureFlag: {
      findUnique: async () => ({ enabled: opts.flagEnabled !== false }),
    },
    creativeAsset: {
      create: async ({ data }: any) => {
        const row = { id: `asset-${assets.length + 1}`, ...data };
        assets.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = assets.find((a) => a.id === where.id);
        Object.assign(row, data);
        return row;
      },
      findUnique: async ({ where }: any) => assets.find((a) => a.id === where.id) ?? null,
      findFirst: async ({ where }: any) => assets.find((a) => a.id === where.id) ?? null,
    },
  };
  const audit: any = { log: async () => undefined };
  const objects = new Map<string, Buffer>();
  const calls: { op: string; args: any[] }[] = [];
  const storage: any = {
    mode: opts.mode ?? "s3",
    bucketFor: (v: string) => (v === "public" ? "qosprey-media-public" : "qosprey-media-private"),
    presignedPutUrl: (v: string, key: string) => `https://storage.example.test/put/${key}?sig=fake`,
    head: async (v: string, key: string) => {
      calls.push({ op: "head", args: [v, key] });
      const b = objects.get(`${v}:${key}`);
      return b ? { sizeBytes: b.length, contentType: null, etag: null, lastModified: new Date(0).toISOString(), metadata: {} } : null;
    },
    get: async (v: string, key: string) => objects.get(`${v}:${key}`) ?? null,
    copy: async (from: any, to: any) => {
      calls.push({ op: "copy", args: [from, to] });
      const b = objects.get(`${from.visibility}:${from.key}`);
      if (!b) throw new Error("source missing (fake)");
      objects.set(`${to.visibility}:${to.key}`, b);
      return { etag: "\"e\"" };
    },
    delete: async (v: string, key: string) => {
      calls.push({ op: "delete", args: [v, key] });
      objects.delete(`${v}:${key}`);
    },
  };
  const registered: any[] = [];
  const registry: any = { register: async (input: any) => { registered.push(input); return input; } };
  const service = new CreativesService(prisma, audit, storage, registry);
  return { service, prisma, assets, objects, calls, registered };
}

const QKEY = "_quarantine/org-1/creative/uuid-1";

describe("RB4 presignCreativeUpload", () => {
  it("hands out a quarantine PUT URL in s3 mode", async () => {
    const { service } = makeService();
    const out = await service.presignCreativeUpload("org-1", "user-1", {
      kind: "image", contentType: "image/png", sizeBytes: PNG_1PX.length, fileName: "a.png",
    });
    expect(out.key).toMatch(/^_quarantine\/org-1\/creative\//);
    expect(out.uploadUrl).toContain(out.key);
    expect(out.expiresInSeconds).toBe(600);
  });

  it("refuses honestly in local mode — no fabricated URL", async () => {
    const { service } = makeService({ mode: "local" });
    await expect(
      service.presignCreativeUpload("org-1", "user-1", { kind: "image", contentType: "image/png", sizeBytes: 10 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refuses when the creative_library flag is off", async () => {
    const { service } = makeService({ flagEnabled: false });
    await expect(
      service.presignCreativeUpload("org-1", "user-1", { kind: "image", contentType: "image/png", sizeBytes: 10 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects a gif image and an oversized video at presign", async () => {
    const { service } = makeService();
    await expect(
      service.presignCreativeUpload("org-1", "user-1", { kind: "image", contentType: "image/gif", sizeBytes: 10 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.presignCreativeUpload("org-1", "user-1", { kind: "video", contentType: "video/mp4", sizeBytes: 51 * 1024 * 1024 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("RB4 completeCreativeUpload", () => {
  it("image: verifies bytes, copies to the final key, creates the asset via upload() with the CDN sourceUrl", async () => {
    const { service, assets, objects, calls, registered } = makeService();
    objects.set(`public:${QKEY}`, PNG_1PX);
    const asset = await service.completeCreativeUpload("org-1", "user-1", {
      key: QKEY, kind: "image", contentType: "image/png", sizeBytes: PNG_1PX.length,
      adAccountId: "acct-1", name: "Banner",
    });
    expect(asset.status).toBe("ready");
    expect(asset.externalHash).toBe("hash-abc");
    expect(asset.sourceUrl).toMatch(/^https:\/\/media\.qosprey\.com\/org-1\/creative\/[0-9a-f-]+\.png$/);
    expect(assets).toHaveLength(1);
    const copy = calls.find((c) => c.op === "copy");
    expect(copy?.args[0]).toEqual({ visibility: "public", key: QKEY });
    expect(copy?.args[1].key).toBe(asset.sourceUrl.replace("https://media.qosprey.com/", ""));
    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatchObject({ surface: "creative", visibility: "public", sourceRef: `creative:${asset.id}` });
    // quarantine object is gone after success
    expect(objects.has(`public:${QKEY}`)).toBe(false);
  });

  it("video: an mp4 lands under .mp4 and the asset goes through advideos", async () => {
    const { service, objects } = makeService();
    objects.set(`public:${QKEY}`, MP4_HEAD);
    const asset = await service.completeCreativeUpload("org-1", "user-1", {
      key: QKEY, kind: "video", contentType: "video/mp4", sizeBytes: MP4_HEAD.length,
      adAccountId: "acct-1", name: "Clip",
    });
    expect(asset.status).toBe("processing");
    expect(asset.externalVideoId).toBe("video-999");
    expect(asset.sourceUrl).toMatch(/\.mp4$/);
  });

  it("sniff mismatch (declared png, bytes are mp4): refuses, deletes quarantine, creates NO asset", async () => {
    const { service, assets, objects, calls } = makeService();
    objects.set(`public:${QKEY}`, MP4_HEAD);
    await expect(
      service.completeCreativeUpload("org-1", "user-1", {
        key: QKEY, kind: "image", contentType: "image/png", sizeBytes: MP4_HEAD.length,
        adAccountId: "acct-1", name: "Fake",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(assets).toHaveLength(0);
    expect(calls.some((c) => c.op === "copy")).toBe(false);
    expect(objects.has(`public:${QKEY}`)).toBe(false);
  });

  it("size mismatch between HEAD and the declaration: refuses and deletes", async () => {
    const { service, assets, objects } = makeService();
    objects.set(`public:${QKEY}`, PNG_1PX);
    await expect(
      service.completeCreativeUpload("org-1", "user-1", {
        key: QKEY, kind: "image", contentType: "image/png", sizeBytes: PNG_1PX.length + 5,
        adAccountId: "acct-1", name: "Wrong size",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(assets).toHaveLength(0);
    expect(objects.has(`public:${QKEY}`)).toBe(false);
  });

  it("a key outside this org's creative quarantine is refused untouched", async () => {
    const { service, assets, objects } = makeService();
    const other = "_quarantine/org-2/creative/uuid-9";
    objects.set(`public:${other}`, PNG_1PX);
    await expect(
      service.completeCreativeUpload("org-1", "user-1", {
        key: other, kind: "image", contentType: "image/png", sizeBytes: PNG_1PX.length,
        adAccountId: "acct-1", name: "Not mine",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(assets).toHaveLength(0);
    expect(objects.has(`public:${other}`)).toBe(true);
  });

  it("missing quarantined object: honest refusal", async () => {
    const { service } = makeService();
    await expect(
      service.completeCreativeUpload("org-1", "user-1", {
        key: QKEY, kind: "image", contentType: "image/png", sizeBytes: 10,
        adAccountId: "acct-1", name: "Ghost",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
