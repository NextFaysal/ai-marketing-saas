import { PublicMediaService } from "./public-media.service";
import { publicMediaServingEnabled, storedAssetPublicUrl, publicMediaUrl } from "./media-url";

/**
 * RB4/RM5 — PublicMediaService + the serializer URL helpers.
 *
 * The storage seam is a fake (recorded calls, scripted HEAD
 * results): this proves the branch logic — local refusal, HEAD
 * hit without copy, copy on miss, failure -> null — with no live
 * bucket, exactly like the RM2 suite. The env-helper tests pin
 * the combinations that must agree with StorageService's mode.
 */

const ENV_KEYS = [
  "MEDIA_S3_BUCKET",
  "MEDIA_S3_ENDPOINT",
  "MEDIA_S3_ACCESS_KEY_ID",
  "MEDIA_S3_SECRET_ACCESS_KEY",
  "MEDIA_R2_PUBLIC_BUCKET",
  "MEDIA_R2_PRIVATE_BUCKET",
  "MEDIA_CDN_BASE_URL",
] as const;

const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

function setS3Env() {
  process.env.MEDIA_S3_BUCKET = "qosprey-media-private";
  process.env.MEDIA_S3_ACCESS_KEY_ID = "AKIDEXAMPLE0000";
  process.env.MEDIA_S3_SECRET_ACCESS_KEY = "fake-secret-for-tests";
}

describe("RB4 publicMediaServingEnabled — env combinations", () => {
  it("false with nothing set (local mode)", () => {
    expect(publicMediaServingEnabled()).toBe(false);
  });

  it("false with a bucket but no credentials", () => {
    process.env.MEDIA_S3_BUCKET = "qosprey-media-private";
    expect(publicMediaServingEnabled()).toBe(false);
  });

  it("false with credentials but no bucket anywhere", () => {
    process.env.MEDIA_S3_ACCESS_KEY_ID = "x";
    process.env.MEDIA_S3_SECRET_ACCESS_KEY = "y";
    expect(publicMediaServingEnabled()).toBe(false);
  });

  it("true with the RB1 single-bucket env", () => {
    setS3Env();
    expect(publicMediaServingEnabled()).toBe(true);
  });

  it("true with only the R2 bucket pair + credentials (no MEDIA_S3_BUCKET)", () => {
    process.env.MEDIA_R2_PRIVATE_BUCKET = "qosprey-media-private";
    process.env.MEDIA_R2_PUBLIC_BUCKET = "qosprey-media-public";
    process.env.MEDIA_S3_ACCESS_KEY_ID = "x";
    process.env.MEDIA_S3_SECRET_ACCESS_KEY = "y";
    expect(publicMediaServingEnabled()).toBe(true);
  });
});

describe("RB4 storedAssetPublicUrl — the frozen serializer shape", () => {
  const row = { publicToken: "tok123", storageKey: "org-1/social/asset-1.jpg" };

  it("null without a public token, whatever the mode", () => {
    setS3Env();
    expect(storedAssetPublicUrl({ publicToken: null, storageKey: row.storageKey })).toBeNull();
    expect(storedAssetPublicUrl({})).toBeNull();
  });

  it("local mode keeps the SP1 relative token path", () => {
    expect(storedAssetPublicUrl(row)).toBe("/public/media/tok123");
  });

  it("s3 mode returns the CDN URL for the storage key", () => {
    setS3Env();
    expect(storedAssetPublicUrl(row)).toBe(publicMediaUrl("org-1/social/asset-1.jpg"));
    expect(storedAssetPublicUrl(row)).toBe("https://media.qosprey.com/org-1/social/asset-1.jpg");
  });

  it("s3 mode without a storage key cannot build a CDN URL — relative path stands", () => {
    setS3Env();
    expect(storedAssetPublicUrl({ publicToken: "tok123", storageKey: null })).toBe("/public/media/tok123");
  });
});

// ---------- PublicMediaService ----------

interface FakeHead { sizeBytes: number; contentType: string | null; etag: string | null; lastModified: string; metadata: Record<string, string> }
const headOf = (sizeBytes: number): FakeHead => ({ sizeBytes, contentType: "image/jpeg", etag: "\"e1\"", lastModified: new Date(0).toISOString(), metadata: {} });

function fakeStorage(opts: {
  mode: "s3" | "local";
  heads: (FakeHead | null)[];
  copyError?: boolean;
}) {
  const calls: { op: string; args: any[] }[] = [];
  let headIdx = 0;
  const storage: any = {
    mode: opts.mode,
    bucketFor: (v: string) => (v === "public" ? "qosprey-media-public" : "qosprey-media-private"),
    head: async (v: string, key: string) => {
      calls.push({ op: "head", args: [v, key] });
      return opts.heads[Math.min(headIdx++, opts.heads.length - 1)] ?? null;
    },
    copy: async (from: any, to: any) => {
      calls.push({ op: "copy", args: [from, to] });
      if (opts.copyError) throw new Error("copy failed (fake)");
      return { etag: "\"e2\"" };
    },
  };
  return { storage, calls };
}

function fakeRegistry(fail = false) {
  const registered: any[] = [];
  const registry: any = {
    register: async (input: any) => {
      if (fail) throw new Error("registry down (fake)");
      registered.push(input);
      return input;
    },
  };
  return { registry, registered };
}

const ASSET = { organizationId: "org-1", storageKey: "org-1/social/asset-1.jpg", contentType: "image/jpeg", sizeBytes: 1234, createdById: "user-1" };

describe("RB4 PublicMediaService.resolvePublicMediaUrl", () => {
  it("local mode -> null and zero storage calls", async () => {
    const { storage, calls } = fakeStorage({ mode: "local", heads: [headOf(1)] });
    const svc = new PublicMediaService(storage as any, fakeRegistry().registry);
    expect(svc.servingEnabled).toBe(false);
    await expect(svc.resolvePublicMediaUrl(ASSET, "social")).resolves.toBeNull();
    expect(calls).toEqual([]);
  });

  it("s3 + bytes already public -> CDN URL, no copy, registry row written", async () => {
    const { storage, calls } = fakeStorage({ mode: "s3", heads: [headOf(4321)] });
    const { registry, registered } = fakeRegistry();
    const svc = new PublicMediaService(storage as any, registry);
    const url = await svc.resolvePublicMediaUrl(ASSET, "social");
    expect(url).toBe("https://media.qosprey.com/org-1/social/asset-1.jpg");
    expect(calls.map((c) => c.op)).toEqual(["head"]);
    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatchObject({
      organizationId: "org-1", bucket: "qosprey-media-public", key: ASSET.storageKey,
      visibility: "public", surface: "social", sizeBytes: 4321, status: "active",
    });
  });

  it("s3 + bytes only private -> copies private->public, re-heads, returns URL", async () => {
    const { storage, calls } = fakeStorage({ mode: "s3", heads: [null, headOf(1234)] });
    const svc = new PublicMediaService(storage as any, fakeRegistry().registry);
    const url = await svc.resolvePublicMediaUrl(ASSET, "social");
    expect(url).toBe("https://media.qosprey.com/org-1/social/asset-1.jpg");
    expect(calls.map((c) => c.op)).toEqual(["head", "copy", "head"]);
    expect(calls[1].args).toEqual([
      { visibility: "private", key: ASSET.storageKey },
      { visibility: "public", key: ASSET.storageKey },
    ]);
  });

  it("s3 + copy fails -> null (never a URL that would 404)", async () => {
    const { storage } = fakeStorage({ mode: "s3", heads: [null], copyError: true });
    const svc = new PublicMediaService(storage as any, fakeRegistry().registry);
    await expect(svc.resolvePublicMediaUrl(ASSET, "social")).resolves.toBeNull();
  });

  it("s3 + copy ok but object still missing -> null", async () => {
    const { storage } = fakeStorage({ mode: "s3", heads: [null, null] });
    const svc = new PublicMediaService(storage as any, fakeRegistry().registry);
    await expect(svc.resolvePublicMediaUrl(ASSET, "social")).resolves.toBeNull();
  });

  it("registry failure never breaks resolution", async () => {
    const { storage } = fakeStorage({ mode: "s3", heads: [headOf(10)] });
    const svc = new PublicMediaService(storage as any, fakeRegistry(true).registry);
    await expect(svc.resolvePublicMediaUrl(ASSET, "social")).resolves.toBe(
      "https://media.qosprey.com/org-1/social/asset-1.jpg",
    );
  });

  it("no registry injected -> still resolves", async () => {
    const { storage } = fakeStorage({ mode: "s3", heads: [headOf(10)] });
    const svc = new PublicMediaService(storage as any);
    await expect(svc.resolvePublicMediaUrl(ASSET, "social")).resolves.toContain("https://media.qosprey.com/");
  });

  it("missing storageKey -> null", async () => {
    const { storage } = fakeStorage({ mode: "s3", heads: [headOf(10)] });
    const svc = new PublicMediaService(storage as any, fakeRegistry().registry);
    await expect(svc.resolvePublicMediaUrl({ ...ASSET, storageKey: "" }, "social")).resolves.toBeNull();
  });
});
