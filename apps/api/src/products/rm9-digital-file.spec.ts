import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import {
  ProductsService,
  DIGITAL_FILE_MAX_BYTES,
  DIGITAL_FILE_SHA_MAX_BYTES,
} from "./products.service";
import { StorageRegistryService } from "../storage/storage-registry.service";
import { StorefrontService } from "../storefront/storefront.service";
import { assertEc24Conditionals } from "../commerce/ec24";

// INT7 union (AB5/AX9): the reveal mints signed download tokens
// (the JWT_SECRET source shared with the admin token); the R2
// presigned URL is produced at the token-redemption step.
process.env.JWT_SECRET = "rm9-spec-secret";

/**
 * RB6/RM9 — digital product files in the platform's own PRIVATE
 * bucket: presign (blocklist + size cap) -> browser PUT ->
 * complete (HEAD size, small-file sha256, final key, registry,
 * Product.digitalStorageKey) -> buyer reveal (EC24b gates
 * unchanged; the revealed URL is a 300s presigned GET).
 * Everything is faked at the seams — no network, no real bucket.
 */

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (k === "OR") return (v as any[]).some((w) => matches(row, w));
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(row[k]);
      if ("not" in v) return row[k] !== v.not;
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
      for (const row of rows) if (matches(row, where)) { Object.assign(row, data); count += 1; }
      return { count };
    },
    upsert: async ({ where, create, update }: any) => {
      const found = rows.find((r) => r.key === where.key);
      if (found) { Object.assign(found, update); return found; }
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
  } as any;
}

const auditStub: any = { log: async () => {} };

/** Visibility-aware in-memory StorageService stand-in. */
class FakeStorage {
  mode: "s3" | "local" = "s3";
  objects = new Map<string, Buffer>();
  deleted: string[] = [];
  private id(vis: string, key: string) { return `${vis}:${key}`; }
  bucketFor(v: string) { return v === "public" ? "pub-bucket" : "priv-bucket"; }
  presignedPutUrl(v: string, key: string) {
    return this.mode === "s3" ? `https://fake-s3.test/${v}/${key}?put=1` : null;
  }
  signedGetUrl(v: string, key: string, ttl: number) {
    return this.mode === "s3" ? `https://fake-s3.test/${v}/${key}?get=1&ttl=${ttl}` : null;
  }
  async put(v: string, key: string, bytes: Buffer) { this.objects.set(this.id(v, key), Buffer.from(bytes)); }
  async get(v: string, key: string) {
    const b = this.objects.get(this.id(v, key));
    return b ? Buffer.from(b) : null;
  }
  async head(v: string, key: string) {
    const b = this.objects.get(this.id(v, key));
    return b ? { sizeBytes: b.length, contentType: "application/pdf", etag: null, lastModified: new Date().toISOString(), metadata: {} } : null;
  }
  async copy(from: { visibility: string; key: string }, to: { visibility: string; key: string }) {
    const b = this.objects.get(this.id(from.visibility, from.key));
    if (!b) throw new Error("copy source missing");
    this.objects.set(this.id(to.visibility, to.key), Buffer.from(b));
    return { etag: null };
  }
  async delete(v: string, key: string) {
    this.deleted.push(`${v}:${key}`);
    this.objects.delete(this.id(v, key));
  }
}

function makeService(prisma: any, storage: FakeStorage) {
  return new ProductsService(
    prisma as any,
    auditStub,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined,
    storage as any,
    new StorageRegistryService(prisma as any) as any,
    undefined,
  );
}

async function seedProduct(prisma: any, over: any = {}) {
  return prisma.product.create({
    data: { organizationId: "org-1", name: "ইবুক", priceMinor: 1000n, digital: false, ...over },
  });
}

describe("RM9 presign", () => {
  it("refuses executable extensions and extension-less names", async () => {
    const prisma = makePrisma();
    const product = await seedProduct(prisma);
    const svc = makeService(prisma, new FakeStorage());
    for (const fileName of ["setup.exe", "run.bat", "script.sh", "app.js", "page.html", "noext"]) {
      await expect(
        svc.presignDigitalFile("org-1", "u1", product.id, { fileName, contentType: "application/octet-stream", sizeBytes: 100 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it("refuses >100MB and refuses honestly in local mode", async () => {
    const prisma = makePrisma();
    const product = await seedProduct(prisma);
    const storage = new FakeStorage();
    const svc = makeService(prisma, storage);
    await expect(
      svc.presignDigitalFile("org-1", "u1", product.id, { fileName: "big.zip", contentType: "application/zip", sizeBytes: DIGITAL_FILE_MAX_BYTES + 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    storage.mode = "local";
    await expect(
      svc.presignDigitalFile("org-1", "u1", product.id, { fileName: "book.pdf", contentType: "application/pdf", sizeBytes: 100 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("hands out a PRIVATE quarantine key for a valid declaration", async () => {
    const prisma = makePrisma();
    const product = await seedProduct(prisma);
    const svc = makeService(prisma, new FakeStorage());
    const out: any = await svc.presignDigitalFile("org-1", "u1", product.id, {
      fileName: "ebook.pdf", contentType: "application/pdf", sizeBytes: 2048,
    });
    expect(out.key).toMatch(/^_quarantine\/org-1\/digital\//);
    expect(out.uploadUrl).toContain("/private/");
    expect(out.fileName).toBe("ebook.pdf");
  });

  it("404s for another org's product", async () => {
    const prisma = makePrisma();
    const product = await seedProduct(prisma, { organizationId: "org-2" });
    const svc = makeService(prisma, new FakeStorage());
    await expect(
      svc.presignDigitalFile("org-1", "u1", product.id, { fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 10 }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("RM9 complete", () => {
  async function presignAndPut(svc: ProductsService, storage: FakeStorage, productId: string, bytes: Buffer, fileName = "ebook.pdf") {
    const pre: any = await svc.presignDigitalFile("org-1", "u1", productId, {
      fileName, contentType: "application/pdf", sizeBytes: bytes.length,
    });
    await storage.put("private", pre.key, bytes);
    return pre;
  }

  it("small file: sha256 recorded, product points at the final key, registry row is private/digital", async () => {
    const prisma = makePrisma();
    const product = await seedProduct(prisma);
    const storage = new FakeStorage();
    const svc = makeService(prisma, storage);
    const bytes = Buffer.from("%PDF-1.4 fake ebook bytes");
    const pre = await presignAndPut(svc, storage, product.id, bytes);
    const out: any = await svc.completeDigitalFile("org-1", "u1", product.id, {
      key: pre.key, fileName: "ebook.pdf", sizeBytes: bytes.length,
    });
    const sha = createHash("sha256").update(bytes).digest("hex");
    expect(out.sha256).toBe(sha);
    expect(out.digitalStorageKey).toMatch(new RegExp(`^org-1/digital/${product.id}/[0-9a-f-]+\\.pdf$`));
    const row = prisma.product.rows.find((r: any) => r.id === product.id);
    expect(row.digitalStorageKey).toBe(out.digitalStorageKey);
    expect(row.digital).toBe(true);
    const reg = prisma.storedFile.rows.find((r: any) => r.key === out.digitalStorageKey);
    expect(reg).toMatchObject({ surface: "digital", visibility: "private", bucket: "priv-bucket", sha256: sha, status: "active" });
    // Quarantine object is gone; the final object holds the bytes.
    expect(await storage.get("private", pre.key)).toBeNull();
    expect((await storage.get("private", out.digitalStorageKey))?.equals(bytes)).toBe(true);
  });

  it("large file (> sha cap): HEAD-verified, sha256 honestly null, never read back", async () => {
    const prisma = makePrisma();
    const product = await seedProduct(prisma);
    const storage = new FakeStorage();
    let getCalls = 0;
    const origGet = storage.get.bind(storage);
    storage.get = async (v: string, k: string) => { getCalls += 1; return origGet(v, k); };
    const svc = makeService(prisma, storage);
    const bytes = Buffer.alloc(DIGITAL_FILE_SHA_MAX_BYTES + 1, 7);
    const pre = await presignAndPut(svc, storage, product.id, bytes, "course.zip");
    const out: any = await svc.completeDigitalFile("org-1", "u1", product.id, {
      key: pre.key, fileName: "course.zip", sizeBytes: bytes.length,
    });
    expect(out.sha256).toBeNull();
    expect(getCalls).toBe(0);
    const reg = prisma.storedFile.rows.find((r: any) => r.key === out.digitalStorageKey);
    expect(reg.sha256).toBeNull();
    expect(Number(reg.sizeBytes)).toBe(bytes.length);
  });

  it("size mismatch: refuses and deletes the quarantine object, product untouched", async () => {
    const prisma = makePrisma();
    const product = await seedProduct(prisma);
    const storage = new FakeStorage();
    const svc = makeService(prisma, storage);
    const pre: any = await svc.presignDigitalFile("org-1", "u1", product.id, {
      fileName: "ebook.pdf", contentType: "application/pdf", sizeBytes: 100,
    });
    await storage.put("private", pre.key, Buffer.from("short"));
    await expect(
      svc.completeDigitalFile("org-1", "u1", product.id, { key: pre.key, fileName: "ebook.pdf", sizeBytes: 100 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await storage.get("private", pre.key)).toBeNull();
    expect(prisma.product.rows[0].digitalStorageKey ?? null).toBeNull();
    expect(prisma.storedFile.rows.length).toBe(0);
  });

  it("rejects a key outside this org's digital quarantine prefix", async () => {
    const prisma = makePrisma();
    const product = await seedProduct(prisma);
    const svc = makeService(prisma, new FakeStorage());
    await expect(
      svc.completeDigitalFile("org-1", "u1", product.id, {
        key: "_quarantine/org-2/digital/abc", fileName: "ebook.pdf", sizeBytes: 10,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("replacing the file trashes the previous registry row; the product points at the new key", async () => {
    const prisma = makePrisma();
    const product = await seedProduct(prisma);
    const storage = new FakeStorage();
    const svc = makeService(prisma, storage);
    const first = await presignAndPut(svc, storage, product.id, Buffer.from("v1"));
    const out1: any = await svc.completeDigitalFile("org-1", "u1", product.id, {
      key: first.key, fileName: "ebook.pdf", sizeBytes: 2,
    });
    const second = await presignAndPut(svc, storage, product.id, Buffer.from("v2!"));
    const out2: any = await svc.completeDigitalFile("org-1", "u1", product.id, {
      key: second.key, fileName: "ebook.pdf", sizeBytes: 3,
    });
    expect(out2.digitalStorageKey).not.toBe(out1.digitalStorageKey);
    const old = prisma.storedFile.rows.find((r: any) => r.key === out1.digitalStorageKey);
    expect(old.status).toBe("trashed");
    // The old OBJECT is not deleted inline (RM11 lifecycle does
    // that after the retention window — a buyer mid-download of
    // the previous reveal must not be cut off).
    expect(await storage.get("private", out1.digitalStorageKey)).not.toBeNull();
  });
});

describe("RM9 EC24 conditional", () => {
  it("an R2-hosted key satisfies the digital-file requirement; neither file nor URL still refuses", () => {
    expect(() => assertEc24Conditionals({ digital: true, digitalStorageKey: "org-1/digital/p/1.pdf" })).not.toThrow();
    expect(() => assertEc24Conditionals({ digital: true })).toThrow(/ফাইল URL আবশ্যক/);
    expect(() => assertEc24Conditionals({ digital: true, digitalFileUrl: "https://x.test/f.pdf" })).not.toThrow();
  });
});

// ---------- delivery: the EC24b reveal with an R2 file ----------

function storefrontPrisma() {
  const t = (name: string) => makeTable(name);
  return {
    organization: t("org"), storefrontSetting: t("setting"),
    order: t("order"), orderItem: t("item"), customer: t("customer"),
    product: t("product"), fulfillment: t("fulfillment"),
    courierShipment: t("ship"), integration: t("int"),
  } as any;
}

const PHONE = "01711111111";
function seedShop(prisma: any, productOver: any = {}, limit: number | null = 1) {
  prisma.organization.rows.push({ id: "org-1", slug: "shop-one", name: "Shop One" });
  prisma.storefrontSetting.rows.push({ id: "s-1", organizationId: "org-1", shopEnabled: true, trackingPageEnabled: true, shopName: "Shop" });
  prisma.customer.rows.push({ id: "c-1", organizationId: "org-1", phone: PHONE, firstName: "রহিম" });
  prisma.product.rows.push({
    id: "p-digi", organizationId: "org-1", name: "ইবুক", status: "ACTIVE", priceMinor: 10000n,
    digital: true, digitalAccessLimit: limit, ...productOver,
  });
  prisma.order.rows.push({
    id: "o-1", organizationId: "org-1", externalId: "native-1", externalNumber: "ORD-1",
    customerId: "c-1", status: "completed", totalMinor: 10000n, currency: "BDT",
    digitalAccessCount: 0, placedAt: new Date(),
  });
  prisma.orderItem.rows.push({ id: "i-1", orderId: "o-1", productId: "p-digi", name: "ইবুক", quantity: 1, totalMinor: 10000n });
}

function makeStorefront(prisma: any, storage?: FakeStorage) {
  return new StorefrontService(
    prisma as any,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined,
    storage as any,
  );
}

class FakeRes {
  statusCode: number | null = null;
  headers: Record<string, string> = {};
  body: string | null = null;
  redirectUrl: string | null = null;
  status(code: number) { this.statusCode = code; return this; }
  setHeader(k: string, v: string) { this.headers[k] = v; return this; }
  send(b: string) { this.body = b; return this; }
  end(b?: string) { if (b) this.body = b; return this; }
  redirect(code: number, url: string) { this.statusCode = code; this.redirectUrl = url; return this; }
}

function tokenFrom(downloadPath: string): string {
  return downloadPath.split("token=")[1];
}

describe("RM9 delivery reveal", () => {
  // INT7 union semantics: AB5 (AX9) redesigned this surface — the
  // reveal returns a signed downloadPath and NEVER a raw or
  // presigned URL; the RM9 resolution (R2 key -> 300s presigned
  // GET, merchant URL as fallback) happens at the token-redemption
  // step (StorefrontService.digitalDownload), where these tests
  // now verify it.
  it("R2 file: reveal mints a signed path (no URL leaks); download 302s to the 300s presigned GET; reveal cap still applies", async () => {
    const prisma = storefrontPrisma();
    seedShop(prisma, { digitalStorageKey: "org-1/digital/p-digi/abc.pdf", digitalFileUrl: null });
    const svc = makeStorefront(prisma, new FakeStorage());
    const out: any = await svc.digitalAccess("shop-one", { phone: PHONE, orderNumber: "ORD-1" });
    expect(out.links).toHaveLength(1);
    expect(out.links[0].productName).toBe("ইবুক");
    expect(out.links[0].downloadPath).toContain("digital-download?token=");
    expect(JSON.stringify(out)).not.toContain("fake-s3.test");
    expect(prisma.order.rows[0].digitalAccessCount).toBe(1);
    // Redeem: the R2 key resolves to the 300s presigned GET.
    const res = new FakeRes();
    await svc.digitalDownload("shop-one", "o-1", tokenFrom(out.links[0].downloadPath), res as any);
    expect(res.statusCode).toBe(302);
    expect(res.redirectUrl).toBe("https://fake-s3.test/private/org-1/digital/p-digi/abc.pdf?get=1&ttl=300");
    // Cap = 1: the second reveal is refused exactly as EC24b.
    await expect(svc.digitalAccess("shop-one", { phone: PHONE, orderNumber: "ORD-1" }))
      .rejects.toThrow(/ডাউনলোডের সীমা শেষ/);
  });

  it("R2 key wins over a merchant URL when both exist", async () => {
    const prisma = storefrontPrisma();
    seedShop(prisma, { digitalStorageKey: "org-1/digital/p-digi/abc.pdf", digitalFileUrl: "https://files.example.com/ebook.pdf" }, null);
    const svc = makeStorefront(prisma, new FakeStorage());
    const out: any = await svc.digitalAccess("shop-one", { phone: PHONE, orderNumber: "ORD-1" });
    const res = new FakeRes();
    await svc.digitalDownload("shop-one", "o-1", tokenFrom(out.links[0].downloadPath), res as any);
    expect(res.statusCode).toBe(302);
    expect(res.redirectUrl).toContain("fake-s3.test/private/");
  });

  it("no storage wired: reveal mints a signed path (raw merchant URL never exposed) and download 302s to it; key-only product yields no link", async () => {
    const prisma = storefrontPrisma();
    seedShop(prisma, { digitalFileUrl: "https://files.example.com/ebook.pdf" }, null);
    const svc = makeStorefront(prisma);
    const out: any = await svc.digitalAccess("shop-one", { phone: PHONE, orderNumber: "ORD-1" });
    expect(out.links).toHaveLength(1);
    expect(out.links[0].downloadPath).toContain("digital-download?token=");
    expect(JSON.stringify(out)).not.toContain("files.example.com");
    const res = new FakeRes();
    await svc.digitalDownload("shop-one", "o-1", tokenFrom(out.links[0].downloadPath), res as any);
    expect(res.statusCode).toBe(302);
    expect(res.redirectUrl).toBe("https://files.example.com/ebook.pdf");

    const prisma2 = storefrontPrisma();
    seedShop(prisma2, { digitalStorageKey: "org-1/digital/p-digi/abc.pdf", digitalFileUrl: null }, null);
    const svc2 = makeStorefront(prisma2);
    const out2: any = await svc2.digitalAccess("shop-one", { phone: PHONE, orderNumber: "ORD-1" });
    expect(out2.links).toEqual([]);
  });
});
