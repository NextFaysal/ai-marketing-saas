import {
  MediaLifecycleService,
  trashRetentionDays,
  quarantineRetentionHours,
} from "./media-lifecycle.service";

/**
 * RB6/RM11 — media lifecycle sweep: trash purge past retention,
 * abandoned-quarantine cleanup, orphan REPORT (counts only),
 * backup when configured. All seams faked; "now" is injected so
 * the retention windows are exact, not wall-clock luck.
 */

function cmp(v: any, cond: any): boolean {
  if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
    if ("lt" in cond) return v < cond.lt;
    if ("gte" in cond) return v >= cond.gte;
    if ("in" in cond) return cond.in.includes(v);
    if ("not" in cond) return v !== cond.not;
    return true;
  }
  return v === cond;
}

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => v === undefined || cmp(row[k], v));
}

function makeStoredFileTable() {
  const rows: any[] = [];
  return {
    rows,
    findMany: async ({ where, orderBy, take }: any = {}) => {
      let out = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "asc") out = [...out].sort((a, b) => +a.createdAt - +b.createdAt);
      return take != null ? out.slice(0, take) : out;
    },
    delete: async ({ where }: any) => {
      const i = rows.findIndex((r) => r.id === where.id);
      if (i < 0) throw new Error("row not found");
      const [row] = rows.splice(i, 1);
      return row;
    },
  };
}

function makeIdTable() {
  const rows: any[] = [];
  return {
    rows,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
  };
}

class FakeStorage {
  mode = "s3";
  objects = new Map<string, { sizeBytes: number; lastModified: string }>();
  deleted: string[] = [];
  failDeleteFor: string | null = null;
  backupName: string | null = null;
  backupPuts: { key: string; bytes: Buffer }[] = [];
  backupCopies: { fromKey: string; toKey: string }[] = [];
  private id(v: string, k: string) { return `${v}:${k}`; }
  async delete(v: string, k: string) {
    if (this.failDeleteFor === k) throw new Error("simulated delete failure");
    this.deleted.push(this.id(v, k));
    this.objects.delete(this.id(v, k));
  }
  async list(v: string, prefix: string) {
    const objects = [...this.objects.entries()]
      .filter(([id]) => id.startsWith(`${v}:`) && id.slice(v.length + 1).startsWith(prefix))
      .map(([id, meta]) => ({ key: id.slice(v.length + 1), sizeBytes: meta.sizeBytes, etag: null, lastModified: meta.lastModified }));
    return { objects, truncated: false, nextCursor: null };
  }
  async head(v: string, k: string) {
    const meta = this.objects.get(this.id(v, k));
    return meta ? { sizeBytes: meta.sizeBytes, contentType: null, etag: null, lastModified: meta.lastModified, metadata: {} } : null;
  }
  backupBucket() { return this.backupName; }
  async putBackupObject(key: string, bytes: Buffer) {
    this.backupPuts.push({ key, bytes });
    return true;
  }
  async copyToBackupObject(from: { visibility: string; key: string }, toKey: string) {
    this.backupCopies.push({ fromKey: from.key, toKey });
    return true;
  }
}

const NOW = new Date("2026-10-15T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86400000);
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600000);

function makeService(prisma: any, storage: FakeStorage) {
  return new MediaLifecycleService(prisma as any, storage as any);
}

function basePrisma() {
  return { storedFile: makeStoredFileTable(), product: makeIdTable(), creativeAsset: makeIdTable() } as any;
}

describe("RM11 retention env helpers", () => {
  it("defaults, overrides and clamps", () => {
    expect(trashRetentionDays({} as any)).toBe(30);
    expect(quarantineRetentionHours({} as any)).toBe(24);
    expect(trashRetentionDays({ MEDIA_TRASH_RETENTION_DAYS: "7" } as any)).toBe(7);
    expect(trashRetentionDays({ MEDIA_TRASH_RETENTION_DAYS: "0" } as any)).toBe(1);
    expect(trashRetentionDays({ MEDIA_TRASH_RETENTION_DAYS: "junk" } as any)).toBe(30);
    expect(quarantineRetentionHours({ MEDIA_QUARANTINE_RETENTION_HOURS: "48" } as any)).toBe(48);
  });
});

describe("RM11 trash purge", () => {
  it("purges trashed rows past 30 days (object + row), keeps fresh trash and active rows", async () => {
    const prisma = basePrisma();
    prisma.storedFile.rows.push(
      { id: "old-trash", organizationId: "o1", key: "o1/product/p/old.png", visibility: "public", surface: "product", status: "trashed", createdAt: daysAgo(60), updatedAt: daysAgo(31), sizeBytes: 5n },
      { id: "new-trash", organizationId: "o1", key: "o1/product/p/new.png", visibility: "public", surface: "product", status: "trashed", createdAt: daysAgo(2), updatedAt: daysAgo(1), sizeBytes: 5n },
      { id: "active-old", organizationId: "o1", key: "o1/product/p/live.png", visibility: "public", surface: "product", status: "active", createdAt: daysAgo(90), updatedAt: daysAgo(90), sizeBytes: 5n },
    );
    const storage = new FakeStorage();
    storage.objects.set("public:o1/product/p/live.png", { sizeBytes: 5, lastModified: daysAgo(90).toISOString() });
    const out: any = await makeService(prisma, storage).runSweep({ now: NOW });
    expect(out.trashedPurged).toBe(1);
    expect(out.trashedErrors).toBe(0);
    expect(storage.deleted).toContain("public:o1/product/p/old.png");
    expect(prisma.storedFile.rows.map((r: any) => r.id).sort()).toEqual(["active-old", "new-trash"]);
  });

  it("a failed object delete KEEPS the registry row for the next sweep", async () => {
    const prisma = basePrisma();
    prisma.storedFile.rows.push(
      { id: "stuck", organizationId: "o1", key: "o1/inbox/stuck.jpg", visibility: "private", surface: "inbox", status: "trashed", createdAt: daysAgo(60), updatedAt: daysAgo(45), sizeBytes: 5n },
    );
    const storage = new FakeStorage();
    storage.failDeleteFor = "o1/inbox/stuck.jpg";
    const out: any = await makeService(prisma, storage).runSweep({ now: NOW });
    expect(out.trashedPurged).toBe(0);
    expect(out.trashedErrors).toBe(1);
    expect(prisma.storedFile.rows.length).toBe(1);
  });
});

describe("RM11 quarantine cleanup", () => {
  it("deletes abandoned quarantine objects older than 24h in both buckets, keeps fresh ones", async () => {
    const prisma = basePrisma();
    const storage = new FakeStorage();
    storage.objects.set("public:_quarantine/o1/product/aaa", { sizeBytes: 1, lastModified: hoursAgo(30).toISOString() });
    storage.objects.set("public:_quarantine/o1/product/bbb", { sizeBytes: 1, lastModified: hoursAgo(2).toISOString() });
    storage.objects.set("private:_quarantine/o1/digital/ccc", { sizeBytes: 1, lastModified: hoursAgo(25).toISOString() });
    storage.objects.set("public:o1/product/p/real.png", { sizeBytes: 1, lastModified: hoursAgo(99).toISOString() });
    const out: any = await makeService(prisma, storage).runSweep({ now: NOW });
    expect(out.quarantineDeleted).toEqual({ public: 1, private: 1 });
    expect(storage.objects.has("public:_quarantine/o1/product/bbb")).toBe(true);
    expect(storage.objects.has("public:o1/product/p/real.png")).toBe(true);
  });
});

describe("RM11 orphan report (counts only)", () => {
  it("counts missing objects and dangling product/creative refs; deletes nothing active", async () => {
    const prisma = basePrisma();
    prisma.product.rows.push({ id: "p-alive" });
    prisma.creativeAsset.rows.push({ id: "c-alive" });
    prisma.storedFile.rows.push(
      { id: "ok", organizationId: "o1", key: "o1/product/p-alive/a.png", visibility: "public", surface: "product", status: "active", sourceRef: "product:p-alive", createdAt: daysAgo(3), updatedAt: daysAgo(3), sizeBytes: 5n },
      { id: "gone-object", organizationId: "o1", key: "o1/product/p-alive/b.png", visibility: "public", surface: "product", status: "active", sourceRef: "product:p-alive", createdAt: daysAgo(3), updatedAt: daysAgo(3), sizeBytes: 5n },
      { id: "dangling", organizationId: "o1", key: "o1/product/p-dead/c.png", visibility: "public", surface: "product", status: "active", sourceRef: "product:p-dead", createdAt: daysAgo(3), updatedAt: daysAgo(3), sizeBytes: 5n },
      { id: "creative-ok", organizationId: "o1", key: "o1/creative/x.png", visibility: "public", surface: "creative", status: "active", sourceRef: "creative:c-alive", createdAt: daysAgo(3), updatedAt: daysAgo(3), sizeBytes: 5n },
    );
    const storage = new FakeStorage();
    for (const k of ["o1/product/p-alive/a.png", "o1/product/p-dead/c.png", "o1/creative/x.png"]) {
      storage.objects.set(`public:${k}`, { sizeBytes: 5, lastModified: daysAgo(3).toISOString() });
    }
    const out: any = await makeService(prisma, storage).runSweep({ now: NOW });
    expect(out.orphans.sampled).toBe(4);
    expect(out.orphans.missingObjects).toBe(1);
    expect(out.orphans.danglingSurfaceRows).toBe(1);
    // Report only: every active row and object is still there.
    expect(prisma.storedFile.rows.length).toBe(4);
    expect(storage.deleted).toEqual([]);
  });
});

describe("RM11 backup", () => {
  it("reports not-configured when no backup bucket is set", async () => {
    const out: any = await makeService(basePrisma(), new FakeStorage()).runSweep({ now: NOW });
    expect(out.backup).toBe("not-configured");
  });

  it("writes the dated registry snapshot and copies only the last 24h of private objects", async () => {
    const prisma = basePrisma();
    prisma.storedFile.rows.push(
      { id: "fresh-priv", organizationId: "o1", key: "o1/inbox/fresh.jpg", visibility: "private", surface: "inbox", status: "active", createdAt: hoursAgo(3), updatedAt: hoursAgo(3), sizeBytes: 5n },
      { id: "old-priv", organizationId: "o1", key: "o1/inbox/old.jpg", visibility: "private", surface: "inbox", status: "active", createdAt: daysAgo(4), updatedAt: daysAgo(4), sizeBytes: 5n },
      { id: "fresh-pub", organizationId: "o1", key: "o1/product/p/a.png", visibility: "public", surface: "product", status: "active", createdAt: hoursAgo(1), updatedAt: hoursAgo(1), sizeBytes: 5n },
    );
    const storage = new FakeStorage();
    storage.backupName = "backup-bucket";
    for (const r of prisma.storedFile.rows) {
      storage.objects.set(`${r.visibility}:${r.key}`, { sizeBytes: 5, lastModified: NOW.toISOString() });
    }
    const out: any = await makeService(prisma, storage).runSweep({ now: NOW });
    expect(out.backup.bucket).toBe("backup-bucket");
    expect(out.backup.snapshotKey).toBe("backup/registry-2026-10-15.json");
    expect(out.backup.registryRows).toBe(3);
    expect(out.backup.privateCopied).toBe(1);
    expect(out.backup.privateFailed).toBe(0);
    expect(storage.backupCopies).toEqual([{ fromKey: "o1/inbox/fresh.jpg", toKey: "o1/inbox/fresh.jpg" }]);
    const snapshot = JSON.parse(storage.backupPuts[0].bytes.toString("utf8"));
    expect(snapshot.count).toBe(3);
    expect(snapshot.files[0].sizeBytes).toBe("5"); // BigInt serialized as string
  });
});
