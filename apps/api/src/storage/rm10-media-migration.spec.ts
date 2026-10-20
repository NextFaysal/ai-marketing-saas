import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { MediaMigrationService } from "./media-migration.service";
import { StorageRegistryService } from "./storage-registry.service";

/**
 * RB6/RM10 — legacy local-media migration: inventory assembled
 * from real DB rows; run copies local bytes to the bucket under
 * the SAME key, verifies sha256 on read-back, registers, and is
 * idempotent (HEAD skip). All seams faked — no disk, no network.
 */

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(row[k]);
      if ("not" in v) {
        if (v.not === null) return row[k] !== null && row[k] !== undefined;
        return row[k] !== v.not;
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
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }: any = {}) => {
      if (where?.key) return rows.find((r) => r.key === where.key) ?? null;
      if (where?.id) return rows.find((r) => r.id === where.id) ?? null;
      return null;
    },
    upsert: async ({ where, create, update }: any) => {
      const found = rows.find((r) => r.key === where.key);
      if (found) { Object.assign(found, update); return found; }
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      rows.push(row);
      return row;
    },
    updateMany: async ({ where, data }: any = {}) => {
      let count = 0;
      for (const row of rows) if (matches(row, where)) { Object.assign(row, data); count += 1; }
      return { count };
    },
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
  };
}

function makePrisma() {
  return {
    mediaAsset: makeTable("asset"),
    channelMessage: makeTable("msg"),
    channelConversation: makeTable("conv"),
    organization: makeTable("org"),
    storedFile: makeTable("stored"),
  } as any;
}

class FakeTargetStorage {
  mode: "s3" | "local" = "s3";
  objects = new Map<string, Buffer>();
  corruptOnGet = false;
  private id(v: string, k: string) { return `${v}:${k}`; }
  bucketFor(v: string) { return v === "public" ? "pub-bucket" : "priv-bucket"; }
  async put(v: string, k: string, b: Buffer) { this.objects.set(this.id(v, k), Buffer.from(b)); }
  async get(v: string, k: string) {
    const b = this.objects.get(this.id(v, k));
    if (!b) return null;
    return this.corruptOnGet ? Buffer.concat([b, Buffer.from("!")]) : Buffer.from(b);
  }
  async head(v: string, k: string) {
    const b = this.objects.get(this.id(v, k));
    return b ? { sizeBytes: b.length, contentType: null, etag: null, lastModified: new Date().toISOString(), metadata: {} } : null;
  }
  async delete(v: string, k: string) { this.objects.delete(this.id(v, k)); }
}

function makeService(prisma: any, target: FakeTargetStorage, localFiles: Map<string, Buffer>) {
  const localReader: any = { get: async (key: string) => localFiles.get(key) ?? null };
  return new MediaMigrationService(
    prisma,
    target as any,
    new StorageRegistryService(prisma as any),
    localReader,
  );
}

function seed(prisma: any) {
  prisma.mediaAsset.rows.push(
    { id: "a1", organizationId: "org-1", storageKey: "org-1/social/a1.png", contentType: "image/png", sizeBytes: 4 },
    { id: "a2", organizationId: "org-1", storageKey: "org-1/social/a1.png", contentType: "image/png", sizeBytes: 4 }, // dup key
    { id: "a3", organizationId: "org-1", storageKey: "org-1/social/a3.mp4", contentType: "video/mp4", sizeBytes: 9 },
  );
  prisma.channelConversation.rows.push({ id: "conv-1", organizationId: "org-1" });
  prisma.channelMessage.rows.push(
    { id: "m1", conversationId: "conv-1", mediaStorageKey: "org-1/2026-10/m1.jpg", mediaContentType: "image/jpeg", mediaSizeBytes: 3 },
    { id: "m2", conversationId: "conv-1", mediaStorageKey: null },
  );
  prisma.organization.rows.push(
    { id: "org-1", logoUrl: "/public/branding/org-1/logo" },
    { id: "org-2", logoUrl: "https://media.qosprey.com/branding/org-2/logo-ab12cd34.png" },
    { id: "org-3", logoUrl: null },
  );
  prisma.storedFile.rows.push({
    id: "sf-1", organizationId: "org-1", bucket: "local", key: "org-1/product/p1/x.png",
    visibility: "public", surface: "product", contentType: "image/png", sizeBytes: 5n, status: "active", sourceRef: "product:p1",
  });
}

describe("RM10 scan", () => {
  it("assembles the inventory from DB rows, deduped by key, with honest byte accounting", async () => {
    const prisma = makePrisma();
    seed(prisma);
    const svc = makeService(prisma, new FakeTargetStorage(), new Map());
    const out: any = await svc.scan();
    // social 2 (dup merged) + inbox 1 + branding 2 + product 1 = 6
    expect(out.totalKeys).toBe(6);
    expect(out.bySurface.social.keys).toBe(2);
    expect(out.bySurface.inbox.keys).toBe(1);
    expect(out.bySurface.branding.keys).toBe(2);
    expect(out.bySurface.product.keys).toBe(1);
    // known bytes: social 4+9, inbox 3, product 5 = 21; branding sizes unknown (2)
    expect(out.knownBytes).toBe("21");
    expect(out.unknownSizeCount).toBe(2);
    expect(out.storageMode).toBe("s3");
  });
});

describe("RM10 run", () => {
  function seeded() {
    const prisma = makePrisma();
    seed(prisma);
    const local = new Map<string, Buffer>([
      ["org-1/social/a1.png", Buffer.from("AAAA")],
      ["org-1/social/a3.mp4", Buffer.from("VIDEODATA")],
      ["org-1/2026-10/m1.jpg", Buffer.from("JPG")],
      ["branding/org-1/logo", Buffer.from("LOGO")],
      ["branding/org-2/logo-ab12cd34.png", Buffer.from("LOGO2")],
      ["org-1/product/p1/x.png", Buffer.from("PROD!")],
    ]);
    const target = new FakeTargetStorage();
    const svc = makeService(prisma, target, local);
    return { prisma, target, svc };
  }

  it("copies every known key under the SAME key, verifies sha, registers; a second run skips all", async () => {
    const { prisma, target, svc } = seeded();
    const out: any = await svc.run({});
    expect(out.copied).toBe(6);
    expect(out.failed).toEqual([]);
    expect(out.remaining).toBe(0);
    expect((await target.get("public", "org-1/social/a1.png"))?.toString()).toBe("AAAA");
    expect((await target.get("private", "org-1/2026-10/m1.jpg"))?.toString()).toBe("JPG");
    const reg = prisma.storedFile.rows.find((r: any) => r.key === "org-1/2026-10/m1.jpg");
    expect(reg.bucket).toBe("priv-bucket");
    expect(reg.sha256).toBe(createHash("sha256").update(Buffer.from("JPG")).digest("hex"));
    // The local-mode registry row is re-pointed at the real bucket.
    const prod = prisma.storedFile.rows.find((r: any) => r.key === "org-1/product/p1/x.png");
    expect(prod.bucket).toBe("pub-bucket");

    const again: any = await svc.run({});
    expect(again.copied).toBe(0);
    // 5, not 6: the migrated local-registry row was re-pointed at
    // the real bucket, so it no longer enters the inventory as a
    // local item at all — the other five HEAD-skip.
    expect(again.skipped).toBe(5);
    expect(again.totalKnown).toBe(5);
    expect(again.failed).toEqual([]);
  });

  it("a key already in the bucket is skipped (but registered), without local bytes", async () => {
    const { prisma, target, svc } = seeded();
    await target.put("public", "org-1/social/a1.png", Buffer.from("AAAA"));
    const out: any = await svc.run({});
    expect(out.skipped).toBe(1);
    expect(out.copied).toBe(5);
    const reg = prisma.storedFile.rows.find((r: any) => r.key === "org-1/social/a1.png");
    expect(reg).toBeTruthy();
  });

  it("missing local file and unknown org land in failed with reasons; nothing is fabricated", async () => {
    const prisma = makePrisma();
    seed(prisma);
    prisma.channelMessage.rows.push({
      id: "m-orphan", conversationId: "conv-gone", mediaStorageKey: "org-9/2026-10/x.jpg",
      mediaContentType: "image/jpeg", mediaSizeBytes: 3,
    });
    const local = new Map<string, Buffer>([
      ["org-1/social/a1.png", Buffer.from("AAAA")],
      // a3.mp4 deliberately missing locally
      ["org-1/2026-10/m1.jpg", Buffer.from("JPG")],
      ["branding/org-1/logo", Buffer.from("LOGO")],
      ["branding/org-2/logo-ab12cd34.png", Buffer.from("LOGO2")],
      ["org-1/product/p1/x.png", Buffer.from("PROD!")],
      ["org-9/2026-10/x.jpg", Buffer.from("ORP")],
    ]);
    const svc = makeService(prisma, new FakeTargetStorage(), local);
    const out: any = await svc.run({});
    expect(out.copied).toBe(5);
    const reasons = Object.fromEntries(out.failed.map((f: any) => [f.key, f.reason]));
    expect(reasons["org-1/social/a3.mp4"]).toMatch(/লোকাল ফাইল পাওয়া যায়নি/);
    expect(reasons["org-9/2026-10/x.jpg"]).toMatch(/organization জানা যায়নি/);
  });

  it("sha mismatch on read-back deletes the copy and reports failure", async () => {
    const { target, svc } = seeded();
    target.corruptOnGet = true;
    const out: any = await svc.run({ batchSize: 1 });
    expect(out.copied).toBe(0);
    expect(out.failed[0].reason).toMatch(/sha256 মেলেনি/);
    expect(target.objects.size).toBe(0);
  });

  it("batchSize bounds the run and reports the remainder", async () => {
    const { svc } = seeded();
    const out: any = await svc.run({ batchSize: 2 });
    expect(out.processed).toBe(2);
    expect(out.remaining).toBe(4);
    expect(out.totalKnown).toBe(6);
  });

  it("refuses to run when the target is local mode (nowhere to copy to)", async () => {
    const prisma = makePrisma();
    seed(prisma);
    const target = new FakeTargetStorage();
    target.mode = "local";
    const svc = makeService(prisma, target, new Map());
    await expect(svc.run({})).rejects.toMatchObject({ code: "storage.migrationCannotBeRunObjectStorage" });
  });
});
