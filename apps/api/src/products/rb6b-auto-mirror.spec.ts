import { createHash } from "node:crypto";
import { ProductsService } from "./products.service";
import { ProductImageMirrorService, PRODUCT_IMAGE_AUTO_MIRROR_FLAG } from "./product-image-mirror.service";
import { StorageRegistryService } from "../storage/storage-registry.service";

/**
 * RB6b — auto-mirror wiring (plan D3) + ExternalReview image
 * mirror. Same fake seams as rm4-product-images.spec.ts
 * (in-memory Prisma tables, in-memory object store, stubbed
 * fetch/DNS) — no spec touches the network or a real bucket.
 */

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v && !v.in.includes(row[k])) return false;
      if ("not" in v) {
        const ok = v.not === null ? row[k] !== null && row[k] !== undefined : row[k] !== v.not;
        if (!ok) return false;
      }
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }: any = {}) => {
      if (where?.id) return rows.find((r) => r.id === where.id) ?? null;
      if (where?.key) return rows.find((r) => r.key === where.key) ?? null;
      return null;
    },
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error(`row not found in ${name}: ${where.id}`);
      Object.assign(row, data);
      return row;
    },
    upsert: async ({ where, create, update }: any) => {
      const found = rows.find((r) => r.key === where.key);
      if (found) {
        Object.assign(found, update);
        return found;
      }
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      rows.push(row);
      return row;
    },
  };
}

/** OrgFeatureFlag needs compound-key (organizationId_key)
 * findUnique/upsert — a dedicated stub. */
function makeFlagTable() {
  const rows: any[] = [];
  let seq = 0;
  const find = (k: any) => rows.find((r) => r.organizationId === k?.organizationId && r.key === k?.key) ?? null;
  return {
    rows,
    findUnique: async ({ where }: any = {}) => find(where?.organizationId_key),
    upsert: async ({ where, create, update }: any) => {
      const found = find(where?.organizationId_key);
      if (found) {
        Object.assign(found, update);
        return found;
      }
      const row = { id: `flag-${++seq}`, ...create };
      rows.push(row);
      return row;
    },
  };
}

function makePrisma() {
  return {
    product: makeTable("product"),
    productImage: makeTable("pimg"),
    storedFile: makeTable("stored"),
    externalReview: makeTable("review"),
    orgFeatureFlag: makeFlagTable(),
  };
}

const auditStub: any = { log: async () => {} };

class FakeStorage {
  mode: "s3" | "local" = "s3";
  objects = new Map<string, Buffer>();
  putCalls = 0;
  bucketFor(v: string) {
    return v === "public" ? "pub-bucket" : "priv-bucket";
  }
  async put(_v: string, key: string, bytes: Buffer, _contentType?: string) {
    this.putCalls += 1;
    this.objects.set(key, Buffer.from(bytes));
  }
  async delete(_v: string, key: string) {
    this.objects.delete(key);
  }
}

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("fake-png-payload"),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("fake-jpeg-payload")]);

const resOf = (bytes: Buffer, status = 200) => ({
  status,
  headers: { get: () => null },
  arrayBuffer: async () => bytes,
});

function makeMirror(prisma: any, storage: FakeStorage) {
  const registry = new StorageRegistryService(prisma as any);
  const mirror = new ProductImageMirrorService(prisma as any, storage as any, registry as any, auditStub);
  mirror.resolveHost = async () => ["93.184.216.34"];
  return { mirror, registry };
}

describe("RB6b auto-mirror opt-out setting (plan D3)", () => {
  it("defaults to ON with no flag row; the setter writes ONE row and flips it both ways", async () => {
    const prisma = makePrisma();
    const { mirror } = makeMirror(prisma, new FakeStorage());

    expect(await mirror.autoMirrorEnabled("org-1")).toBe(true);

    const off = await mirror.setAutoMirrorEnabled("org-1", false, "u1");
    expect(off).toEqual({ productImageAutoMirror: false });
    expect(prisma.orgFeatureFlag.rows).toHaveLength(1);
    expect(prisma.orgFeatureFlag.rows[0]).toMatchObject({
      organizationId: "org-1",
      key: PRODUCT_IMAGE_AUTO_MIRROR_FLAG,
      enabled: false,
    });
    expect(await mirror.autoMirrorEnabled("org-1")).toBe(false);
    // another org is unaffected
    expect(await mirror.autoMirrorEnabled("org-2")).toBe(true);

    const on = await mirror.setAutoMirrorEnabled("org-1", true, "u1");
    expect(on).toEqual({ productImageAutoMirror: true });
    expect(prisma.orgFeatureFlag.rows).toHaveLength(1); // upsert, not a second row
    expect(await mirror.autoMirrorEnabled("org-1")).toBe(true);
  });

  it("runAutoMirror skips an opted-out org WITHOUT fetching or touching rows", async () => {
    const prisma = makePrisma();
    const product = await prisma.product.create({
      data: { organizationId: "org-1", name: "শার্ট", imageUrl: "https://cdn.shopify.com/shirt.png" },
    });
    await prisma.productImage.create({
      data: { productId: product.id, url: "https://cdn.shopify.com/shirt.png", altText: null, position: 0 },
    });
    const storage = new FakeStorage();
    const { mirror } = makeMirror(prisma, storage);
    let fetchCalls = 0;
    mirror.fetchFn = async () => {
      fetchCalls += 1;
      return resOf(PNG);
    };
    await mirror.setAutoMirrorEnabled("org-1", false, "u1");

    const out: any = await mirror.runAutoMirror("org-1", "u1");
    expect(out).toEqual({ skipped: "opted-out" });
    expect(fetchCalls).toBe(0);
    expect(storage.putCalls).toBe(0);
    expect(prisma.productImage.rows[0].url).toBe("https://cdn.shopify.com/shirt.png");
  });

  it("runAutoMirror (enabled) passes the run's flat summary through, reviews included", async () => {
    const prisma = makePrisma();
    const product = await prisma.product.create({
      data: { organizationId: "org-1", name: "শার্ট", imageUrl: null },
    });
    await prisma.productImage.create({
      data: { productId: product.id, url: "https://a.example.com/one.png", altText: null, position: 0 },
    });
    const storage = new FakeStorage();
    const { mirror } = makeMirror(prisma, storage);
    mirror.fetchFn = async () => resOf(PNG);

    const out: any = await mirror.runAutoMirror("org-1", "u1");
    expect(out).toEqual({
      scanned: 1,
      mirrored: 1,
      deduped: 0,
      failed: 0,
      reviews: { scanned: 0, mirrored: 0, failed: 0 },
    });
  });

  it("ProductsService facades read/write the same setting", async () => {
    const prisma = makePrisma();
    const storage = new FakeStorage();
    const registry = new StorageRegistryService(prisma as any);
    const { mirror } = makeMirror(prisma, storage);
    const svc = new ProductsService(
      prisma as any,
      auditStub,
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined,
      storage as any,
      registry as any,
      mirror as any,
    );
    expect(await svc.getProductImageAutoMirror("org-1")).toEqual({ productImageAutoMirror: true });
    expect(await svc.setProductImageAutoMirror("org-1", "u1", false)).toEqual({ productImageAutoMirror: false });
    expect(await svc.getProductImageAutoMirror("org-1")).toEqual({ productImageAutoMirror: false });
  });
});

describe("RB6b review image mirror", () => {
  async function seedReview(prisma: any, imageUrls: any) {
    return prisma.externalReview.create({
      data: {
        organizationId: "org-1",
        storeId: "store-1",
        productId: "prod-1",
        externalId: "rev-1",
        rating: 5,
        imageUrls,
      },
    });
  }

  it("mirrors a review photo into the review key space, registers surface=review, leaves non-external entries untouched", async () => {
    const prisma = makePrisma();
    const alreadyOurs = "https://media.qosprey.com/org-1/product/prod-1/old.png";
    const review = await seedReview(prisma, ["https://woo.example.com/review-1.png", alreadyOurs, 42]);
    const storage = new FakeStorage();
    const { mirror, registry } = makeMirror(prisma, storage);
    mirror.fetchFn = async () => resOf(PNG);

    const out = await mirror.mirrorExternalImages("org-1", "u1");
    expect(out.reviews).toEqual({ scanned: 1, mirrored: 1, failed: 0 });
    expect(out.scanned).toBe(0); // product counts untouched by the review pass

    const stored = await prisma.externalReview.findFirst({ where: { id: review.id } });
    expect(stored.imageUrls[0]).toMatch(new RegExp(`^https://media\\.qosprey\\.com/org-1/review/${review.id}/.+\\.png$`));
    expect(stored.imageUrls[1]).toBe(alreadyOurs);
    expect(stored.imageUrls[2]).toBe(42);

    const key = stored.imageUrls[0].replace("https://media.qosprey.com/", "");
    const reg = await registry.findByKey(key);
    expect(reg.surface).toBe("review");
    expect(reg.sourceRef).toBe("https://woo.example.com/review-1.png");
    expect(reg.sha256).toBe(createHash("sha256").update(PNG).digest("hex"));

    const again = await mirror.mirrorExternalImages("org-1", "u1");
    expect(again.reviews).toEqual({ scanned: 0, mirrored: 0, failed: 0 });
  });

  it("dedupes review bytes against a pre-existing surface=review registry object — no upload", async () => {
    const prisma = makePrisma();
    await seedReview(prisma, ["https://woo.example.com/dup.jpg"]);
    const storage = new FakeStorage();
    const { mirror, registry } = makeMirror(prisma, storage);
    await registry.register({
      organizationId: "org-1",
      bucket: "pub-bucket",
      key: "org-1/review/other/seeded.jpg",
      visibility: "public",
      surface: "review",
      contentType: "image/jpeg",
      sizeBytes: JPEG.length,
      sha256: createHash("sha256").update(JPEG).digest("hex"),
    });
    mirror.fetchFn = async () => resOf(JPEG);

    const out = await mirror.mirrorExternalImages("org-1", "u1");
    expect(out.reviews).toEqual({ scanned: 1, mirrored: 1, failed: 0 });
    expect(storage.putCalls).toBe(0);
    const stored = await prisma.externalReview.findFirst({ where: {} });
    expect(stored.imageUrls[0]).toBe("https://media.qosprey.com/org-1/review/other/seeded.jpg");
  });

  it("a failed review photo keeps its original URL; a mixed array rewrites only the successes", async () => {
    const prisma = makePrisma();
    const review = await seedReview(prisma, ["https://ok.example.com/a.png", "https://dead.example.com/b.png"]);
    const storage = new FakeStorage();
    const { mirror } = makeMirror(prisma, storage);
    mirror.fetchFn = async (url: string) => {
      if (url.includes("dead.example.com")) throw new Error("connect timeout");
      return resOf(PNG);
    };

    const out = await mirror.mirrorExternalImages("org-1", "u1");
    expect(out.reviews).toEqual({ scanned: 2, mirrored: 1, failed: 1 });
    const stored = await prisma.externalReview.findFirst({ where: { id: review.id } });
    expect(stored.imageUrls[0]).toMatch(/^https:\/\/media\.qosprey\.com\/org-1\/review\//);
    expect(stored.imageUrls[1]).toBe("https://dead.example.com/b.png");
  });

  it("local mode counts review photos as failed and rewrites nothing", async () => {
    const prisma = makePrisma();
    const review = await seedReview(prisma, ["https://woo.example.com/r.png"]);
    const storage = new FakeStorage();
    storage.mode = "local";
    const { mirror } = makeMirror(prisma, storage);
    mirror.fetchFn = async () => resOf(PNG);

    const out = await mirror.mirrorExternalImages("org-1", "u1");
    expect(out.reviews).toEqual({ scanned: 1, mirrored: 0, failed: 1 });
    const stored = await prisma.externalReview.findFirst({ where: { id: review.id } });
    expect(stored.imageUrls[0]).toBe("https://woo.example.com/r.png");
    expect(storage.putCalls).toBe(0);
  });
});
