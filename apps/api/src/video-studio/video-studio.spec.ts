import "reflect-metadata";
import { NotFoundException } from "@nestjs/common";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VideoStudioService } from "./video-studio.service";
import { VideoStudioController } from "./video-studio.controller";
import { FfmpegTemplateVideoProvider, VideoRenderError } from "./ffmpeg-video.provider";
import { SocialImportService } from "../social/social-import.service";
import { MediaStore } from "../inbox/media-store";

/**
 * NF2 (FB1) — Short Video Studio backend. Fake-prisma harness in
 * the live-commerce.spec.ts pattern (in-memory tables, org-scoped
 * `matches`). The renderer is the REAL FfmpegTemplateVideoProvider
 * against the REAL ffmpeg binary on this machine: the success
 * test renders a real mp4 from real generated PNG fixtures and
 * probes the STORED bytes with ffprobe. MediaStore runs in local
 * mode against a per-run temp dir (MEDIA_LOCAL_DIR) — no S3 env
 * is set in the test process, and any inherited one is cleared.
 */

jest.setTimeout(240_000);

type Row = Record<string, any>;

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (k === "OR") return (v as any[]).some((sub) => matches(row, sub));
    if (k === "AND") return (v as any[]).every((sub) => matches(row, sub));
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("not" in v) return row[k] !== (v as any).not;
      return true;
    }
    return row[k] === v;
  });
}

function execFileP(file: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(err) : resolve({ stdout: String(stdout), stderr: String(stderr) }));
  });
}

async function makePng(color: string, size: string, path: string): Promise<Buffer> {
  await execFileP("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=${color}:s=${size}`, "-frames:v", "1", path]);
  return readFile(path);
}

async function probe(bytes: Buffer, dir: string): Promise<any> {
  const file = join(dir, `probe-${Math.random().toString(36).slice(2)}.mp4`);
  await writeFile(file, bytes);
  const { stdout } = await execFileP("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,codec_name",
    "-show_entries", "format=duration", "-of", "json", file,
  ]);
  return JSON.parse(stdout);
}

const SRC_URL = "https://cdn.example.com/sari.jpg";
const SRC2_URL = "https://cdn.example.com/sari-back.jpg";
const BAD_URL = "https://cdn.example.com/corrupt.jpg";

async function setup(opts: { provider?: any } = {}) {
  const projects: Row[] = [];
  const assets: Row[] = [];
  const productImages: Row[] = [
    { id: "pi-1", productId: "p1", url: SRC2_URL, position: 1 },
  ];
  const products: Row[] = [
    { id: "p1", organizationId: "org-1", name: "টেস্ট শাড়ি", slug: "test-sari", priceMinor: 150000n, currency: "BDT", imageUrl: SRC_URL, status: "ACTIVE" },
    { id: "p-bad", organizationId: "org-1", name: "নষ্ট ছবির পণ্য", slug: null, priceMinor: 5000n, currency: "BDT", imageUrl: BAD_URL, status: "ACTIVE" },
    { id: "p-noslug", organizationId: "org-1", name: "স্লাগহীন পণ্য", slug: null, priceMinor: 70000n, currency: "BDT", imageUrl: SRC_URL, status: "ACTIVE" },
    { id: "p9", organizationId: "org-2", name: "অন্য দোকানের পণ্য", slug: null, priceMinor: 1000n, currency: "BDT", imageUrl: null, status: "ACTIVE" },
  ];
  assets.push(
    { id: "asset-src-1", organizationId: "org-1", kind: "image", name: "শাড়ি — ছবি", contentType: "image/png", sizeBytes: 10, storageKey: "org-1/social/src1.png", publicToken: null, origin: "imported", sourceUrl: SRC_URL, createdById: "staff-1", createdAt: new Date(), updatedAt: new Date() },
    { id: "asset-src-2", organizationId: "org-1", kind: "image", name: "শাড়ি পেছন — ছবি", contentType: "image/png", sizeBytes: 10, storageKey: "org-1/social/src2.png", publicToken: null, origin: "imported", sourceUrl: SRC2_URL, createdById: "staff-1", createdAt: new Date(), updatedAt: new Date() },
    { id: "asset-bad", organizationId: "org-1", kind: "image", name: "নষ্ট — ছবি", contentType: "image/jpeg", sizeBytes: 10, storageKey: "org-1/social/bad.jpg", publicToken: null, origin: "imported", sourceUrl: BAD_URL, createdById: "staff-1", createdAt: new Date(), updatedAt: new Date() },
  );
  let seq = 100;
  const nid = (p: string) => `${p}-${++seq}`;

  const generic = (rows: Row[], prefix: string) => ({
    findFirst: jest.fn(async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null),
    findMany: jest.fn(async ({ where, orderBy, take }: any = {}) => {
      let found = rows.filter((r) => matches(r, where ?? {}));
      const ob = Array.isArray(orderBy) ? orderBy[0] : orderBy;
      if (ob?.createdAt === "desc") found = [...found].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (ob?.createdAt === "asc") found = [...found].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      if (ob?.position === "asc") found = [...found].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      if (typeof take === "number") found = found.slice(0, take);
      return found;
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: data.id ?? nid(prefix), createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    }),
  });

  const socialAccounts: Row[] = [
    { id: "sa-1", organizationId: "org-1", platform: "meta_page", status: "connected", createdAt: new Date("2026-01-01") },
    { id: "sa-2", organizationId: "org-1", platform: "youtube", status: "connected", createdAt: new Date("2026-02-01") },
    { id: "sa-9", organizationId: "org-2", platform: "meta_page", status: "connected", createdAt: new Date("2026-01-01") },
  ];
  const socialPosts: Row[] = [];
  const prisma: any = {
    videoProject: generic(projects, "vp"),
    product: generic(products, "prod"),
    productImage: generic(productImages, "pi"),
    mediaAsset: generic(assets, "ma"),
    socialAccount: generic(socialAccounts, "sa"),
  };
  const audit: any = { log: jest.fn(async () => undefined) };
  const importer = new SocialImportService(prisma, audit);
  // SocialService STUB (Item 4): createPost call-count + args pin
  // the exactly-once + mediaRefs/link rules; the real createPost
  // path is covered by the social suites.
  let postSeq = 0;
  const social: any = {
    createPost: jest.fn(async (orgId: string, _actor: string, dto: any) => {
      const post = { id: `post-${++postSeq}`, organizationId: orgId, status: "draft", ...dto };
      socialPosts.push(post);
      return post;
    }),
  };
  const service = new VideoStudioService(prisma, audit, importer, opts.provider ?? new FfmpegTemplateVideoProvider(), social);
  return { service, prisma, audit, importer, social, socialPosts, socialAccounts, projects, assets, products, productImages };
}

let storeDir: string;
let fixtureDir: string;
let tinyMp4: string;

beforeAll(async () => {
  // Force MediaStore local mode for this spec process.
  for (const k of ["MEDIA_S3_BUCKET", "MEDIA_S3_ACCESS_KEY_ID", "MEDIA_S3_SECRET_ACCESS_KEY", "MEDIA_R2_PRIVATE_BUCKET", "MEDIA_R2_PUBLIC_BUCKET"]) {
    delete process.env[k];
  }
  storeDir = await mkdtemp(join(tmpdir(), "nf2-store-"));
  fixtureDir = await mkdtemp(join(tmpdir(), "nf2-fixtures-"));
  process.env.MEDIA_LOCAL_DIR = storeDir;
  const store = MediaStore.fromEnv();
  const png1 = await makePng("0x3366cc", "800x600", join(fixtureDir, "img1.png"));
  const png2 = await makePng("0xcc6633", "1200x900", join(fixtureDir, "img2.png"));
  await store.put("org-1/social/src1.png", png1, "image/png");
  await store.put("org-1/social/src2.png", png2, "image/png");
  await store.put("org-1/social/bad.jpg", Buffer.from("এটি কোনো ছবি নয় — শুধু টেক্সট", "utf8"), "image/jpeg");
  // A real (tiny) mp4 for the Item-4 stub provider: publish tests
  // exercise the service's storage + post flow, not ffmpeg again.
  tinyMp4 = join(fixtureDir, "tiny.mp4");
  await execFileP("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=1080x1920:r=30", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", tinyMp4]);
});

/** Fast provider stub for publish tests (real render is proven
 * by the Item-3 describes above). */
function stubProvider() {
  return {
    render: jest.fn(async () => ({ filePath: tinyMp4, durationSec: 1, width: 1080, height: 1920 })),
  };
}

describe("NF2 provider — binary honesty (injected bogus path)", () => {
  it("missing ffmpeg → VideoRenderError with the Bengali ffmpeg-missing label", async () => {
    const provider = new FfmpegTemplateVideoProvider("/nonexistent/ffmpeg-xyz-123");
    await expect(provider.assertBinaryAvailable()).rejects.toBeInstanceOf(VideoRenderError);
    await expect(provider.assertBinaryAvailable()).rejects.toThrow("ffmpeg পাওয়া যায়নি");
    const workDir = await mkdtemp(join(tmpdir(), "nf2-unit-"));
    await expect(provider.render({
      imagePaths: [join(fixtureDir, "img1.png")], productName: "X", priceText: "BDT 1.00",
      language: "bn", template: "showcase", workDir,
    })).rejects.toThrow("ffmpeg পাওয়া যায়নি");
  });
});

describe("NF2 projects — create + org isolation", () => {
  it("create validates template/language and defaults to showcase/bn queued", async () => {
    const s = await setup();
    const created: any = await s.service.createProject("org-1", "staff-1", { productId: "p1" });
    expect(created.status).toBe("queued");
    expect(created.template).toBe("showcase");
    expect(created.language).toBe("bn");
    expect(created.productName).toBe("টেস্ট শাড়ি");
    await expect(s.service.createProject("org-1", "staff-1", { productId: "p1", template: "bogus" }))
      .rejects.toThrow("template");
    await expect(s.service.createProject("org-1", "staff-1", { productId: "p1", language: "fr" }))
      .rejects.toThrow("language");
  });

  it("org B cannot create for, read, render or list org A's project/product (404 everywhere)", async () => {
    const s = await setup();
    await expect(s.service.createProject("org-2", "staff-9", { productId: "p1" }))
      .rejects.toMatchObject({ code: "videoStudio.productNotFoundInThisOrganization" });
    const created: any = await s.service.createProject("org-1", "staff-1", { productId: "p1" });
    await expect(s.service.getProject("org-2", created.id)).rejects.toMatchObject({ code: "videoStudio.theVideoProjectWasNotFound" });
    await expect(s.service.renderProject("org-2", created.id)).rejects.toMatchObject({ code: "videoStudio.theVideoProjectWasNotFound" });
    const listB = await s.service.listProjects("org-2");
    expect(listB).toHaveLength(0);
    // The foreign render attempt never touched the row.
    expect(s.projects[0].status).toBe("queued");
  });
});

describe("NF2 render — REAL ffmpeg end to end", () => {
  it("renders a ready project: stored mp4 probes 1080x1920 h264, ~6s for 2 images; asset origin video_studio; re-render is a no-op", async () => {
    const s = await setup();
    const created: any = await s.service.createProject("org-1", "staff-1", { productId: "p1", template: "offer", offerText: "ঈদ অফার" });
    const out: any = await s.service.renderProject("org-1", created.id);
    expect(out.status).toBe("ready");
    expect(out.errorLabel).toBeNull();
    expect(out.mediaAssetId).toBeTruthy();
    // The web preview URL rides the EXISTING asset path (public token route).
    expect(out.assetUrl).toContain("/public/media/");

    const videos = s.assets.filter((a) => a.kind === "video");
    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({ origin: "video_studio", contentType: "video/mp4", organizationId: "org-1" });

    const bytes = await MediaStore.fromEnv().get(videos[0].storageKey);
    expect(bytes).toBeTruthy();
    expect(bytes!.length).toBe(videos[0].sizeBytes);
    const info = await probe(bytes!, fixtureDir);
    expect(info.streams[0].width).toBe(1080);
    expect(info.streams[0].height).toBe(1920);
    expect(info.streams[0].codec_name).toBe("h264");
    const duration = Number(info.format.duration);
    expect(duration).toBeGreaterThan(5.4);
    expect(duration).toBeLessThan(6.6);

    // Idempotency: rendering a ready project creates NO second asset.
    const again: any = await s.service.renderProject("org-1", created.id);
    expect(again.status).toBe("ready");
    expect(again.mediaAssetId).toBe(out.mediaAssetId);
    expect(s.assets.filter((a) => a.kind === "video")).toHaveLength(1);
  });

  it("corrupt image source → failed + errorLabel, and NO MediaAsset is created", async () => {
    const s = await setup();
    const before = s.assets.length;
    const created: any = await s.service.createProject("org-1", "staff-1", { productId: "p-bad" });
    const out: any = await s.service.renderProject("org-1", created.id);
    expect(out.status).toBe("failed");
    expect(out.errorLabel).toBeTruthy();
    expect(out.errorLabel).toContain("ছবি");
    expect(out.mediaAssetId).toBeNull();
    expect(s.assets.length).toBe(before);
  });

  it("ffmpeg missing (bogus injected binary) → failed with the ffmpeg-missing label, no asset", async () => {
    const s = await setup({ provider: new FfmpegTemplateVideoProvider("/nonexistent/ffmpeg-xyz-123") });
    const before = s.assets.length;
    const created: any = await s.service.createProject("org-1", "staff-1", { productId: "p1" });
    const out: any = await s.service.renderProject("org-1", created.id);
    expect(out.status).toBe("failed");
    expect(out.errorLabel).toContain("ffmpeg পাওয়া যায়নি");
    expect(s.assets.length).toBe(before);
  });

  it("sweep renders queued projects for the org and reports counts", async () => {
    const s = await setup();
    await s.service.createProject("org-1", "staff-1", { productId: "p1" });
    const res: any = await s.service.runRenderSweep("org-1");
    expect(res.processed).toBe(1);
    expect(res.ready).toBe(1);
    expect(res.failed).toBe(0);
    const list = await s.service.listProjects("org-1");
    expect(list[0].status).toBe("ready");
    // A second sweep has nothing to do.
    const res2: any = await s.service.runRenderSweep("org-1");
    expect(res2.processed).toBe(0);
  });
});

describe("NF2 publish — SocialService.createPost only, exactly once", () => {
  it("a non-ready project refuses BEFORE createPost is called", async () => {
    const s = await setup({ provider: stubProvider() });
    const created: any = await s.service.createProject("org-1", "staff-1", { productId: "p1" });
    await expect(s.service.publishProject("org-1", "staff-1", created.id, {}))
      .rejects.toThrow("ready");
    expect(s.social.createPost).not.toHaveBeenCalled();
  });

  it("ready project: createPost once with video mediaRef + default caption (name + real price) + slug link; second publish returns the same post", async () => {
    const s = await setup({ provider: stubProvider() });
    const created: any = await s.service.createProject("org-1", "staff-1", { productId: "p1" });
    const ready: any = await s.service.renderProject("org-1", created.id);
    expect(ready.status).toBe("ready");

    const published: any = await s.service.publishProject("org-1", "staff-1", created.id, {});
    expect(s.social.createPost).toHaveBeenCalledTimes(1);
    const dto = s.social.createPost.mock.calls[0][2];
    // No account given → the org's FIRST connected account.
    expect(dto.socialAccountId).toBe("sa-1");
    expect(dto.mediaRefs).toEqual([{ assetId: ready.mediaAssetId, kind: "video" }]);
    expect(dto.caption).toContain("টেস্ট শাড়ি");
    expect(dto.caption).toContain("1500");
    // MS5 rule: the link exists only because the product has a slug.
    expect(dto.linkUrl).toBe("http://localhost:3000/checkout/test-sari");
    expect(published.socialPostId).toBe(s.socialPosts[0].id);

    const again: any = await s.service.publishProject("org-1", "staff-1", created.id, {});
    expect(again.socialPostId).toBe(published.socialPostId);
    expect(s.social.createPost).toHaveBeenCalledTimes(1);
    expect(s.socialPosts).toHaveLength(1);
  });

  it("explicit account + caption win; a slug-less product publishes with NO fabricated link", async () => {
    const s = await setup({ provider: stubProvider() });
    const created: any = await s.service.createProject("org-1", "staff-1", { productId: "p-noslug" });
    await s.service.renderProject("org-1", created.id);
    await s.service.publishProject("org-1", "staff-1", created.id, { socialAccountId: "sa-2", caption: "কাস্টম ক্যাপশন" });
    const dto = s.social.createPost.mock.calls[0][2];
    expect(dto.socialAccountId).toBe("sa-2");
    expect(dto.caption).toBe("কাস্টম ক্যাপশন");
    expect(dto.linkUrl).toBeUndefined();
  });

  it("org B cannot publish org A's project (404, createPost never called)", async () => {
    const s = await setup({ provider: stubProvider() });
    const created: any = await s.service.createProject("org-1", "staff-1", { productId: "p1" });
    await s.service.renderProject("org-1", created.id);
    await expect(s.service.publishProject("org-2", "staff-9", created.id, {}))
      .rejects.toMatchObject({ code: "videoStudio.theVideoProjectWasNotFound" });
    expect(s.social.createPost).not.toHaveBeenCalled();
  });
});

describe("NF2 controller — create triggers a fire-and-forget render", () => {
  it("POST video-projects returns the queued project and triggers renderProject once", async () => {
    const stubService: any = {
      createProject: jest.fn(async () => ({ id: "vp-1", status: "queued" })),
      renderProject: jest.fn(async () => ({ id: "vp-1", status: "ready" })),
    };
    const controller = new VideoStudioController(stubService);
    const out: any = await controller.createProject({ userId: "staff-1" } as any, "org-1", { productId: "p1" } as any);
    expect(out.status).toBe("queued");
    expect(stubService.createProject).toHaveBeenCalledTimes(1);
    expect(stubService.renderProject).toHaveBeenCalledWith("org-1", "vp-1");
  });
});
