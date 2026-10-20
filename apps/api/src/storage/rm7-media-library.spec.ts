import { BadRequestException, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { MediaLibraryService, MEDIA_LIBRARY_UPLOAD_MAX_BYTES } from "./media-library.service";
import { StorageRegistryService } from "./storage-registry.service";

/**
 * RM7 — unified media library over the StoredFile registry.
 * Everything is faked at the seams (in-memory StoredFile table in
 * the rm4 style, an in-memory object store) — no spec touches the
 * network or a real bucket; the live R2 proof stays the owner's
 * post-deploy verify step.
 */

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (k === "AND") return (v as any[]).every((w) => matches(row, w));
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("startsWith" in v) return typeof row[k] === "string" && row[k].startsWith(v.startsWith);
      if ("contains" in v) {
        const hay = String(row[k] ?? "");
        return v.mode === "insensitive"
          ? hay.toLowerCase().includes(String(v.contains).toLowerCase())
          : hay.includes(String(v.contains));
      }
      if ("not" in v) {
        const n = v.not;
        if (n !== null && typeof n === "object") {
          if ("startsWith" in n) return !(typeof row[k] === "string" && row[k].startsWith(n.startsWith));
          return true;
        }
        return row[k] !== n;
      }
      return true;
    }
    return row[k] === v;
  });
}

function makeStoredFileTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    findMany: async ({ where, orderBy, skip = 0, take }: any = {}) => {
      let out = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "desc") out = [...out].sort((a, b) => +b.createdAt - +a.createdAt);
      if (orderBy?.createdAt === "asc") out = [...out].sort((a, b) => +a.createdAt - +b.createdAt);
      return out.slice(skip, take != null ? skip + take : undefined);
    },
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findUnique: async ({ where }: any = {}) => {
      if (where?.key) return rows.find((r) => r.key === where.key) ?? null;
      if (where?.id) return rows.find((r) => r.id === where.id) ?? null;
      return null;
    },
    create: async ({ data }: any) => {
      const row = { id: `sf-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    upsert: async ({ where, create, update }: any) => {
      const found = rows.find((r) => r.key === where.key);
      if (found) {
        Object.assign(found, update);
        return found;
      }
      const row = { id: `sf-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      rows.push(row);
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
  };
}

/** In-memory StorageService stand-in with the exact surface the
 * RM7 code calls. `mode` is flippable for the local-mode rules. */
class FakeStorage {
  mode: "s3" | "local" = "s3";
  objects = new Map<string, Buffer>();
  bucketFor(v: string) {
    return v === "public" ? "pub-bucket" : "priv-bucket";
  }
  presignedPutUrl(_v: string, key: string) {
    return this.mode === "s3" ? `https://fake-s3.test/put/${key}?sig=1` : null;
  }
  signedGetUrl(v: string, key: string, _ttl?: number) {
    return this.mode === "s3" ? `https://fake-s3.test/get/${v}/${key}?sig=2` : null;
  }
  async put(_v: string, key: string, bytes: Buffer) {
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
const HTML = Buffer.from("<html><body>not an image</body></html>");

const auditStub: any = { log: async () => {} };

function makeService(storage: FakeStorage = new FakeStorage()) {
  const storedFile = makeStoredFileTable();
  const prisma: any = { storedFile };
  const registry = new StorageRegistryService(prisma);
  const svc = new MediaLibraryService(prisma, storage as any, registry as any, auditStub);
  return { svc, storedFile, storage, registry };
}

let day = 0;
async function seed(storedFile: any, over: any = {}) {
  day += 1;
  return storedFile.create({
    data: {
      organizationId: "org-1",
      bucket: "pub-bucket",
      key: `org-1/product/p1/img-${day}.png`,
      visibility: "public",
      surface: "product",
      contentType: "image/png",
      sizeBytes: 1234n,
      width: 800,
      height: 600,
      sha256: null,
      status: "active",
      createdById: "u1",
      sourceRef: null,
      createdAt: new Date(2026, 9, day),
      ...over,
    },
  });
}

describe("RM7 media library — list", () => {
  it("lists only the org's ACTIVE files, newest first, with total + pagination", async () => {
    const { svc, storedFile } = makeService();
    await seed(storedFile, { key: "org-1/product/a.png" });
    await seed(storedFile, { key: "org-1/product/b.png" });
    await seed(storedFile, { key: "org-1/product/c.png" });
    await seed(storedFile, { key: "org-1/product/gone.png", status: "trashed" });
    await seed(storedFile, { key: "org-2/product/x.png", organizationId: "org-2" });

    const all = await svc.list("org-1", {});
    expect(all.total).toBe(3);
    expect(all.items.map((i: any) => i.key)).toEqual([
      "org-1/product/c.png",
      "org-1/product/b.png",
      "org-1/product/a.png",
    ]);

    const page2 = await svc.list("org-1", { page: 2, pageSize: 2 });
    expect(page2.total).toBe(3);
    expect(page2.page).toBe(2);
    expect(page2.pageSize).toBe(2);
    expect(page2.items.map((i: any) => i.key)).toEqual(["org-1/product/a.png"]);
  });

  it("filters by surface, kind (contentType prefix) and q (key contains, case-insensitive)", async () => {
    const { svc, storedFile } = makeService();
    await seed(storedFile, { key: "org-1/product/Hero.png", surface: "product", contentType: "image/png" });
    await seed(storedFile, { key: "org-1/social/clip.mp4", surface: "social", contentType: "video/mp4", visibility: "public" });
    await seed(storedFile, { key: "org-1/inbox/doc.pdf", surface: "inbox", contentType: "application/pdf", visibility: "private", bucket: "priv-bucket" });
    await seed(storedFile, { key: "org-1/inbox/photo.jpg", surface: "inbox", contentType: "image/jpeg", visibility: "private", bucket: "priv-bucket" });

    expect((await svc.list("org-1", { surface: "inbox" })).total).toBe(2);
    expect((await svc.list("org-1", { kind: "image" })).total).toBe(2);
    expect((await svc.list("org-1", { kind: "video" })).total).toBe(1);
    const files = await svc.list("org-1", { kind: "file" });
    expect(files.total).toBe(1);
    expect(files.items[0].key).toBe("org-1/inbox/doc.pdf");
    expect((await svc.list("org-1", { q: "hero" })).total).toBe(1);
    expect((await svc.list("org-1", { surface: "inbox", kind: "image" })).total).toBe(1);
    await expect(svc.list("org-1", { kind: "audio" })).rejects.toMatchObject({ code: "storage.kindMustBeImageVideoOr" });
  });

  it("DTO: sizeBytes is a string; public -> CDN URL, private -> presigned GET, local mode -> null", async () => {
    const { svc, storedFile, storage } = makeService();
    const pub = await seed(storedFile, { key: "org-1/product/pub.png", visibility: "public" });
    await seed(storedFile, { key: "org-1/inbox/priv.png", visibility: "private", surface: "inbox", bucket: "priv-bucket" });

    const { items } = await svc.list("org-1", {});
    const pubDto = items.find((i: any) => i.id === pub.id);
    expect(pubDto.sizeBytes).toBe("1234");
    expect(pubDto.url).toBe("https://media.qosprey.com/org-1/product/pub.png");
    expect(pubDto.width).toBe(800);
    const privDto = items.find((i: any) => i.key === "org-1/inbox/priv.png");
    expect(privDto.url).toBe("https://fake-s3.test/get/private/org-1/inbox/priv.png?sig=2");

    storage.mode = "local";
    const local = await svc.list("org-1", {});
    expect(local.items.every((i: any) => i.url === null)).toBe(true);
  });
});

describe("RM7 media library — upload", () => {
  it("presign refuses bad type / oversize / local mode and issues a quarantine key", async () => {
    const { svc, storage } = makeService();
    await expect(
      svc.presignUpload("org-1", "u1", { contentType: "image/gif", sizeBytes: 100 }),
    ).rejects.toMatchObject({ code: "storage.onlyPngJpegOrWebpImages" });
    await expect(
      svc.presignUpload("org-1", "u1", { contentType: "image/png", sizeBytes: MEDIA_LIBRARY_UPLOAD_MAX_BYTES + 1 }),
    ).rejects.toMatchObject({ code: "storage.theFileIsTooLargeAt" });

    const ok = await svc.presignUpload("org-1", "u1", { fileName: "a.png", contentType: "image/png", sizeBytes: 100 });
    expect(ok.key.startsWith("_quarantine/org-1/library/")).toBe(true);
    expect(ok.uploadUrl).toContain(ok.key);

    storage.mode = "local";
    await expect(
      svc.presignUpload("org-1", "u1", { contentType: "image/png", sizeBytes: 100 }),
    ).rejects.toMatchObject({ code: "storage.directFileUploadIsNotOn" });
  });

  it("complete registers the file (surface=library, sha256) and drops the quarantine object", async () => {
    const { svc, storedFile, storage } = makeService();
    const pre = await svc.presignUpload("org-1", "u1", { contentType: "image/png", sizeBytes: PNG.length });
    await storage.put("public", pre.key, PNG);

    const dto = await svc.completeUpload("org-1", "u1", { key: pre.key, contentType: "image/png", sizeBytes: PNG.length });
    expect(dto.surface).toBe("library");
    expect(dto.key.startsWith("org-1/library/")).toBe(true);
    expect(dto.key.endsWith(".png")).toBe(true);
    expect(dto.url).toBe(`https://media.qosprey.com/${dto.key}`);
    expect(dto.sizeBytes).toBe(String(PNG.length));

    const row = storedFile.rows.find((r: any) => r.key === dto.key);
    expect(row).toBeTruthy();
    expect(row.sha256).toBe(createHash("sha256").update(PNG).digest("hex"));
    expect(row.visibility).toBe("public");
    expect(storage.objects.has(pre.key)).toBe(false);
    expect(storage.objects.has(dto.key)).toBe(true);
  });

  it("complete cleans up fully on sniff mismatch and on size mismatch (no row, no objects)", async () => {
    const { svc, storedFile, storage } = makeService();

    const pre1 = await svc.presignUpload("org-1", "u1", { contentType: "image/png", sizeBytes: HTML.length });
    await storage.put("public", pre1.key, HTML);
    await expect(
      svc.completeUpload("org-1", "u1", { key: pre1.key, contentType: "image/png", sizeBytes: HTML.length }),
    ).rejects.toMatchObject({ code: "storage.theUploadedFileSRealFormat" });
    expect(storage.objects.has(pre1.key)).toBe(false);
    expect(storedFile.rows.length).toBe(0);

    const pre2 = await svc.presignUpload("org-1", "u1", { contentType: "image/png", sizeBytes: PNG.length });
    await storage.put("public", pre2.key, PNG);
    await expect(
      svc.completeUpload("org-1", "u1", { key: pre2.key, contentType: "image/png", sizeBytes: PNG.length + 5 }),
    ).rejects.toMatchObject({ code: "storage.theUploadedFileSSizeDoes" });
    expect(storage.objects.has(pre2.key)).toBe(false);
    expect(storedFile.rows.length).toBe(0);
  });

  it("complete refuses a key outside this org's library quarantine prefix", async () => {
    const { svc } = makeService();
    await expect(
      svc.completeUpload("org-1", "u1", { key: "_quarantine/org-2/library/abc", contentType: "image/png", sizeBytes: 10 }),
    ).rejects.toMatchObject({ code: "storage.theUploadKeyIsNotValid" });
    await expect(
      svc.completeUpload("org-1", "u1", { key: "org-1/library/abc.png", contentType: "image/png", sizeBytes: 10 }),
    ).rejects.toMatchObject({ code: "storage.theUploadKeyIsNotValid" });
  });
});

describe("RM7 media library — trash", () => {
  it("trashes the registry row (org-guarded) and the file leaves the list", async () => {
    const { svc, storedFile } = makeService();
    const mine = await seed(storedFile, { key: "org-1/library/mine.png", surface: "library" });
    const theirs = await seed(storedFile, { key: "org-2/library/theirs.png", organizationId: "org-2", surface: "library" });

    await expect(svc.trash("org-1", "u1", theirs.id)).rejects.toMatchObject({ code: "storage.theFileWasNotFound" });
    await expect(svc.trash("org-1", "u1", "no-such-id")).rejects.toMatchObject({ code: "storage.theFileWasNotFound" });

    const out = await svc.trash("org-1", "u1", mine.id);
    expect(out).toEqual({ id: mine.id, key: "org-1/library/mine.png", trashed: true });
    expect(storedFile.rows.find((r: any) => r.id === mine.id).status).toBe("trashed");
    expect((await svc.list("org-1", {})).total).toBe(0);
  });
});
