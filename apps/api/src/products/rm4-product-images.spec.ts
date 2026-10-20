import { BadRequestException } from "@nestjs/common";
import { ApiException } from "../i18n";
import { createHash } from "node:crypto";
import { ProductsService, PRODUCT_IMAGE_UPLOAD_MAX_BYTES } from "./products.service";
import { ProductImageMirrorService } from "./product-image-mirror.service";
import { StorageRegistryService } from "../storage/storage-registry.service";

/**
 * RM4 — product image direct-to-R2 upload + external-URL mirror.
 * Everything is faked at the seams (in-memory Prisma tables in the
 * ec3-catalog.spec style, an in-memory object store, stubbed
 * fetch/DNS for the mirror) — no spec touches the network or a
 * real bucket; the live R2 proof stays RB1's verify-script step.
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
    updateMany: async ({ where, data }: any = {}) => {
      let count = 0;
      for (const row of rows) {
        if (matches(row, where)) {
          Object.assign(row, data);
          count += 1;
        }
      }
      return { count };
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
    delete: async ({ where }: any) => {
      const i = rows.findIndex((r) => r.id === where.id);
      if (i < 0) throw new Error(`row not found in ${name}: ${where.id}`);
      const [row] = rows.splice(i, 1);
      return row;
    },
  };
}

function makePrisma() {
  return {
    product: makeTable("product"),
    productImage: makeTable("pimg"),
    storedFile: makeTable("stored"),
  };
}

const auditStub: any = { log: async () => {} };

/** In-memory StorageService stand-in with the exact surface the
 * RM4 code calls. `mode` is flippable for the local-mode refusal. */
class FakeStorage {
  mode: "s3" | "local" = "s3";
  objects = new Map<string, Buffer>();
  putCalls = 0;
  bucketFor(v: string) {
    return v === "public" ? "pub-bucket" : "priv-bucket";
  }
  presignedPutUrl(_v: string, key: string) {
    return this.mode === "s3" ? `https://fake-s3.test/${key}?sig=1` : null;
  }
  async put(_v: string, key: string, bytes: Buffer, _contentType?: string) {
    this.putCalls += 1;
    this.objects.set(key, Buffer.from(bytes));
  }
  async get(_v: string, key: string) {
    const b = this.objects.get(key);
    return b ? Buffer.from(b) : null;
  }
  async head(_v: string, key: string) {
    const b = this.objects.get(key);
    return b ? { sizeBytes: b.length, contentType: null, etag: null, lastModified: new Date().toISOString(), metadata: {} } : null;
  }
  async copy(from: { key: string }, to: { key: string }) {
    const b = this.objects.get(from.key);
    if (!b) throw new Error("copy source missing");
    this.objects.set(to.key, Buffer.from(b));
    return { etag: null };
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
const HTML = Buffer.from("<html><body>not an image</body></html>");

function makeService(prisma: any, storage: FakeStorage, registry: any, mirror?: any) {
  return new ProductsService(
    prisma as any,
    auditStub,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined,
    storage as any,
    registry as any,
    mirror as any,
  );
}

async function seedProduct(prisma: any, over: any = {}) {
  return prisma.product.create({
    data: { organizationId: "org-1", name: "শার্ট", priceMinor: 1000n, imageUrl: null, ...over },
  });
}

describe("RM4 presign", () => {
  it("refuses a non-allowlisted content type (gif) and an oversize file", async () => {
    const prisma = makePrisma();
    const product = await seedProduct(prisma);
    const svc = makeService(prisma, new FakeStorage(), new StorageRegistryService(prisma as any));
    await expect(
      svc.presignProductImage("org-1", "u1", product.id, { fileName: "a.gif", contentType: "image/gif", sizeBytes: 100 }),
    ).rejects.toBeInstanceOf(ApiException);
    await expect(
      svc.presignProductImage("org-1", "u1", product.id, {
        fileName: "a.png",
        contentType: "image/png",
        sizeBytes: PRODUCT_IMAGE_UPLOAD_MAX_BYTES + 1,
      }),
    ).rejects.toBeInstanceOf(ApiException);
  });

  it("refuses honestly in local mode — no fake upload URL", async () => {
    const prisma = makePrisma();
    const product = await seedProduct(prisma);
    const storage = new FakeStorage();
    storage.mode = "local";
    const svc = makeService(prisma, storage, new StorageRegistryService(prisma as any));
    await expect(
      svc.presignProductImage("org-1", "u1", product.id, { fileName: "a.png", contentType: "image/png", sizeBytes: 100 }),
    ).rejects.toBeInstanceOf(ApiException);
  });

  it("404s for a product of another org", async () => {
    const prisma = makePrisma();
    const product = await seedProduct(prisma, { organizationId: "org-2" });
    const svc = makeService(prisma, new FakeStorage(), new StorageRegistryService(prisma as any));
    await expect(
      svc.presignProductImage("org-1", "u1", product.id, { fileName: "a.png", contentType: "image/png", sizeBytes: 100 }),
    ).rejects.toMatchObject({ code: "products.productNotFoundInOrg", status: 404 });
  });

  it("hands out a quarantine key + presigned URL for a valid declaration", async () => {
    const prisma = makePrisma();
    const product = await seedProduct(prisma);
    const svc = makeService(prisma, new FakeStorage(), new StorageRegistryService(prisma as any));
    const out = await svc.presignProductImage("org-1", "u1", product.id, {
      fileName: "a.png",
      contentType: "image/png",
      sizeBytes: PNG.length,
    });
    expect(out.key.startsWith("_quarantine/org-1/product/")).toBe(true);
    expect(out.uploadUrl).toContain(out.key);
    expect(out.expiresInSeconds).toBe(600);
  });
});

describe("RM4 complete", () => {
  async function presignAndLand(svc: ProductsService, storage: FakeStorage, productId: string, bytes: Buffer, contentType = "image/png") {
    const pre = await svc.presignProductImage("org-1", "u1", productId, {
      fileName: "a",
      contentType,
      sizeBytes: bytes.length,
    });
    // The browser's direct PUT, simulated at the storage seam.
    await storage.put("public", pre.key, bytes, contentType);
    return pre;
  }

  it("happy path: gallery row on the CDN URL, cover mirror adopted, registry row with sha256, quarantine gone", async () => {
    const prisma = makePrisma();
    const product = await seedProduct(prisma);
    const storage = new FakeStorage();
    const registry = new StorageRegistryService(prisma as any);
    const svc = makeService(prisma, storage, registry);
    const pre = await presignAndLand(svc, storage, product.id, PNG);

    const image = await svc.completeProductImage("org-1", "u1", product.id, {
      key: pre.key,
      contentType: "image/png",
      sizeBytes: PNG.length,
    });

    expect(image.url).toMatch(/^https:\/\/media\.qosprey\.com\/org-1\/product\/.+\.png$/);
    expect(image.position).toBe(0);
    const stored = await prisma.product.findFirst({ where: { id: product.id } });
    expect(stored.imageUrl).toBe(image.url); // position-0 cover mirror (addImage rule)
    expect(storage.objects.has(pre.key)).toBe(false); // quarantine removed
    const finalKey = image.url.replace("https://media.qosprey.com/", "");
    expect(storage.objects.get(finalKey)?.equals(PNG)).toBe(true);

    const reg = await registry.findByKey(finalKey);
    expect(reg).toBeTruthy();
    expect(reg.status).toBe("active");
    expect(reg.surface).toBe("product");
    expect(reg.visibility).toBe("public");
    expect(reg.bucket).toBe("pub-bucket");
    expect(reg.sha256).toBe(createHash("sha256").update(PNG).digest("hex"));
    expect(reg.sizeBytes).toBe(String(PNG.length));
  });

  it("second upload appends at the end and does NOT steal an existing cover", async () => {
    const prisma = makePrisma();
    const product = await seedProduct(prisma, { imageUrl: "https://images.unsplash.com/cover.jpg" });
    const storage = new FakeStorage();
    const svc = makeService(prisma, storage, new StorageRegistryService(prisma as any));
    const pre = await presignAndLand(svc, storage, product.id, JPEG, "image/jpeg");
    const image = await svc.completeProductImage("org-1", "u1", product.id, {
      key: pre.key,
      contentType: "image/jpeg",
      sizeBytes: JPEG.length,
    });
    expect(image.url.endsWith(".jpg")).toBe(true);
    const stored = await prisma.product.findFirst({ where: { id: product.id } });
    expect(stored.imageUrl).toBe("https://images.unsplash.com/cover.jpg");
  });

  it("sniff mismatch (declared png, bytes are jpeg): 400, no rows, no objects left", async () => {
    const prisma = makePrisma();
    const product = await seedProduct(prisma);
    const storage = new FakeStorage();
    const svc = makeService(prisma, storage, new StorageRegistryService(prisma as any));
    const pre = await presignAndLand(svc, storage, product.id, JPEG, "image/png");
    await expect(
      svc.completeProductImage("org-1", "u1", product.id, { key: pre.key, contentType: "image/png", sizeBytes: JPEG.length }),
    ).rejects.toBeInstanceOf(ApiException);
    expect(prisma.productImage.rows.length).toBe(0);
    expect(prisma.storedFile.rows.length).toBe(0);
    expect(storage.objects.size).toBe(0);
  });

  it("size mismatch: 400 and the quarantine object is removed", async () => {
    const prisma = makePrisma();
    const product = await seedProduct(prisma);
    const storage = new FakeStorage();
    const svc = makeService(prisma, storage, new StorageRegistryService(prisma as any));
    const pre = await svc.presignProductImage("org-1", "u1", product.id, {
      fileName: "a.png",
      contentType: "image/png",
      sizeBytes: PNG.length,
    });
    await storage.put("public", pre.key, PNG, "image/png");
    await expect(
      svc.completeProductImage("org-1", "u1", product.id, { key: pre.key, contentType: "image/png", sizeBytes: PNG.length + 5 }),
    ).rejects.toBeInstanceOf(ApiException);
    expect(storage.objects.size).toBe(0);
    expect(prisma.productImage.rows.length).toBe(0);
  });

  it("missing upload and a foreign-org quarantine key are both refused", async () => {
    const prisma = makePrisma();
    const product = await seedProduct(prisma);
    const svc = makeService(prisma, new FakeStorage(), new StorageRegistryService(prisma as any));
    await expect(
      svc.completeProductImage("org-1", "u1", product.id, {
        key: "_quarantine/org-1/product/does-not-exist",
        contentType: "image/png",
        sizeBytes: 10,
      }),
    ).rejects.toBeInstanceOf(ApiException);
    await expect(
      svc.completeProductImage("org-1", "u1", product.id, {
        key: "_quarantine/org-2/product/abc",
        contentType: "image/png",
        sizeBytes: 10,
      }),
    ).rejects.toBeInstanceOf(ApiException);
  });

  it("deleting a CDN-backed gallery image trashes its registry row but leaves the object for RM11", async () => {
    const prisma = makePrisma();
    const product = await seedProduct(prisma);
    const storage = new FakeStorage();
    const registry = new StorageRegistryService(prisma as any);
    const svc = makeService(prisma, storage, registry);
    const pre = await presignAndLand(svc, storage, product.id, PNG);
    const image = await svc.completeProductImage("org-1", "u1", product.id, {
      key: pre.key,
      contentType: "image/png",
      sizeBytes: PNG.length,
    });
    const finalKey = image.url.replace("https://media.qosprey.com/", "");

    await svc.deleteImage("org-1", "u1", product.id, image.id);

    const reg = await registry.findByKey(finalKey);
    expect(reg.status).toBe("trashed");
    expect(storage.objects.has(finalKey)).toBe(true); // lifecycle (RM11) owns deletion
    const stored = await prisma.product.findFirst({ where: { id: product.id } });
    expect(stored.imageUrl).toBeNull();
  });
});

describe("RM4 mirror", () => {
  function makeMirror(prisma: any, storage: FakeStorage) {
    const registry = new StorageRegistryService(prisma as any);
    const mirror = new ProductImageMirrorService(prisma as any, storage as any, registry as any, auditStub);
    mirror.resolveHost = async () => ["93.184.216.34"];
    return { mirror, registry };
  }
  const resOf = (bytes: Buffer, status = 200) => ({
    status,
    headers: { get: () => null },
    arrayBuffer: async () => bytes,
  });

  it("mirrors a gallery image + its cover, registers with the source URL, and a re-run finds nothing external", async () => {
    const prisma = makePrisma();
    const product = await seedProduct(prisma, { imageUrl: "https://cdn.shopify.com/shirt.png" });
    await prisma.productImage.create({
      data: { productId: product.id, url: "https://cdn.shopify.com/shirt.png", altText: null, position: 0 },
    });
    const storage = new FakeStorage();
    const { mirror, registry } = makeMirror(prisma, storage);
    mirror.fetchFn = async () => resOf(PNG);

    const out = await mirror.mirrorExternalImages("org-1", "u1");
    expect(out).toEqual({ scanned: 1, mirrored: 1, deduped: 0, failed: [], reviews: { scanned: 0, mirrored: 0, failed: 0 } });

    const row = prisma.productImage.rows[0];
    expect(row.url).toMatch(/^https:\/\/media\.qosprey\.com\/org-1\/product\/.+\.png$/);
    const stored = await prisma.product.findFirst({ where: { id: product.id } });
    expect(stored.imageUrl).toBe(row.url);
    expect(storage.putCalls).toBe(1);
    const reg = await registry.findByKey(row.url.replace("https://media.qosprey.com/", ""));
    expect(reg.sourceRef).toBe("https://cdn.shopify.com/shirt.png");
    expect(reg.sha256).toBe(createHash("sha256").update(PNG).digest("hex"));

    const again = await mirror.mirrorExternalImages("org-1", "u1");
    expect(again).toEqual({ scanned: 0, mirrored: 0, deduped: 0, failed: [], reviews: { scanned: 0, mirrored: 0, failed: 0 } });
  });

  it("dedupes identical bytes from a second product/URL against the registry — no second upload", async () => {
    const prisma = makePrisma();
    const p1 = await seedProduct(prisma, { name: "এক" });
    const p2 = await seedProduct(prisma, { name: "দুই" });
    await prisma.productImage.create({ data: { productId: p1.id, url: "https://a.example.com/one.png", altText: null, position: 0 } });
    await prisma.productImage.create({ data: { productId: p2.id, url: "https://b.example.com/two.png", altText: null, position: 0 } });
    const storage = new FakeStorage();
    const { mirror } = makeMirror(prisma, storage);
    mirror.fetchFn = async () => resOf(PNG); // both URLs serve the same bytes

    const out = await mirror.mirrorExternalImages("org-1", "u1");
    expect(out.scanned).toBe(2);
    expect(out.mirrored).toBe(1);
    expect(out.deduped).toBe(1);
    expect(out.failed).toEqual([]);
    expect(storage.putCalls).toBe(1);
    expect(prisma.productImage.rows[0].url).toBe(prisma.productImage.rows[1].url);
  });

  it("adopts a pre-existing registry object with the same sha256 without uploading", async () => {
    const prisma = makePrisma();
    const product = await seedProduct(prisma);
    await prisma.productImage.create({ data: { productId: product.id, url: "https://x.example.com/dup.jpg", altText: null, position: 0 } });
    const storage = new FakeStorage();
    const { mirror, registry } = makeMirror(prisma, storage);
    await registry.register({
      organizationId: "org-1",
      bucket: "pub-bucket",
      key: "org-1/product/other/seeded.jpg",
      visibility: "public",
      surface: "product",
      contentType: "image/jpeg",
      sizeBytes: JPEG.length,
      sha256: createHash("sha256").update(JPEG).digest("hex"),
    });
    mirror.fetchFn = async () => resOf(JPEG);

    const out = await mirror.mirrorExternalImages("org-1", "u1");
    expect(out).toEqual({ scanned: 1, mirrored: 0, deduped: 1, failed: [], reviews: { scanned: 0, mirrored: 0, failed: 0 } });
    expect(storage.putCalls).toBe(0);
    expect(prisma.productImage.rows[0].url).toBe("https://media.qosprey.com/org-1/product/other/seeded.jpg");
  });

  it("fetch failure and non-image bytes are reported per item and leave rows untouched", async () => {
    const prisma = makePrisma();
    const p1 = await seedProduct(prisma, { name: "ভাঙা" });
    const p2 = await seedProduct(prisma, { name: "ভুয়া" });
    await prisma.productImage.create({ data: { productId: p1.id, url: "https://dead.example.com/a.png", altText: null, position: 0 } });
    await prisma.productImage.create({ data: { productId: p2.id, url: "https://fake.example.com/b.png", altText: null, position: 0 } });
    const storage = new FakeStorage();
    const { mirror } = makeMirror(prisma, storage);
    mirror.fetchFn = async (url: string) => {
      if (url.includes("dead.example.com")) throw new Error("connect timeout");
      return resOf(HTML);
    };

    const out = await mirror.mirrorExternalImages("org-1", "u1");
    expect(out.scanned).toBe(2);
    expect(out.mirrored).toBe(0);
    expect(out.failed.length).toBe(2);
    expect(out.failed.find((f) => f.productId === p1.id)?.host).toBe("dead.example.com");
    expect(out.failed.find((f) => f.productId === p2.id)?.host).toBe("fake.example.com");
    expect(prisma.productImage.rows[0].url).toBe("https://dead.example.com/a.png");
    expect(prisma.productImage.rows[1].url).toBe("https://fake.example.com/b.png");
    expect(storage.putCalls).toBe(0);
  });

  it("refuses a host resolving to a private address WITHOUT fetching, and refuses plain http", async () => {
    const prisma = makePrisma();
    const p1 = await seedProduct(prisma, { name: "ভেতরের" });
    const p2 = await seedProduct(prisma, { name: "http" });
    await prisma.productImage.create({ data: { productId: p1.id, url: "https://internal.example.com/a.png", altText: null, position: 0 } });
    await prisma.productImage.create({ data: { productId: p2.id, url: "http://plain.example.com/b.png", altText: null, position: 0 } });
    const storage = new FakeStorage();
    const { mirror } = makeMirror(prisma, storage);
    mirror.resolveHost = async () => ["10.0.0.5"];
    let fetchCalls = 0;
    mirror.fetchFn = async () => {
      fetchCalls += 1;
      return resOf(PNG);
    };

    const out = await mirror.mirrorExternalImages("org-1", "u1");
    expect(out.failed.length).toBe(2);
    expect(out.failed.find((f) => f.productId === p1.id)?.reason).toMatch(/private\/internal/);
    expect(out.failed.find((f) => f.productId === p2.id)?.reason).toMatch(/https/);
    expect(fetchCalls).toBe(0);
    expect(storage.putCalls).toBe(0);
  });

  it("a cover imageUrl with no gallery row is mirrored on the product itself", async () => {
    const prisma = makePrisma();
    const product = await seedProduct(prisma, { imageUrl: "https://woo.example.com/cover.webp" });
    const storage = new FakeStorage();
    const { mirror } = makeMirror(prisma, storage);
    const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x10, 0, 0, 0]), Buffer.from("WEBP"), Buffer.from("payload")]);
    mirror.fetchFn = async () => resOf(WEBP);

    const out = await mirror.mirrorExternalImages("org-1", "u1");
    expect(out).toEqual({ scanned: 1, mirrored: 1, deduped: 0, failed: [], reviews: { scanned: 0, mirrored: 0, failed: 0 } });
    const stored = await prisma.product.findFirst({ where: { id: product.id } });
    expect(stored.imageUrl).toMatch(/^https:\/\/media\.qosprey\.com\/org-1\/product\/.+\.webp$/);
    expect(prisma.productImage.rows.length).toBe(0); // no gallery row invented
  });
});
