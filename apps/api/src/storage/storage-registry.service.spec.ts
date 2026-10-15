import { StorageRegistryService } from "./storage-registry.service";

/**
 * RM3 — StoredFile registry against an in-memory fake of the Prisma
 * delegate (the same fake-Prisma style as the rest of the api
 * suite). Proves registration idempotency, org-guarded trashing and
 * BigInt-safe usage accounting. A real Postgres run of the migration
 * is a separate gate (see docs/r2-rb2-acceptance.md).
 */

interface Row {
  id: string; organizationId: string; bucket: string; key: string;
  visibility: string; surface: string; contentType: string;
  sizeBytes: bigint; width: number | null; height: number | null;
  sha256: string | null; status: string; createdById: string | null;
  sourceRef: string | null; createdAt: Date; updatedAt: Date;
}

function fakePrisma() {
  const rows: Row[] = [];
  let seq = 0;
  const matches = (row: Row, where: any): boolean => {
    if (where.organizationId !== undefined && row.organizationId !== where.organizationId) return false;
    if (where.key !== undefined && row.key !== where.key) return false;
    if (where.status?.not !== undefined && row.status === where.status.not) return false;
    if (typeof where.status === "string" && row.status !== where.status) return false;
    return true;
  };
  const table = {
    rows,
    async upsert({ where, create, update }: any) {
      const existing = rows.find((r) => r.key === where.key);
      if (existing) {
        Object.assign(existing, update, { updatedAt: new Date() });
        return existing;
      }
      const row: Row = { id: `sf-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      rows.push(row);
      return row;
    },
    async updateMany({ where, data }: any) {
      let count = 0;
      for (const row of rows) if (matches(row, where)) { Object.assign(row, data); count++; }
      return { count };
    },
    async findUnique({ where }: any) {
      return rows.find((r) => r.key === where.key) ?? null;
    },
    async aggregate({ where }: any) {
      const hit = rows.filter((r) => matches(r, where));
      return {
        _sum: { sizeBytes: hit.reduce((a, r) => a + r.sizeBytes, 0n) },
        _count: { _all: hit.length },
      };
    },
    async groupBy({ by, where }: any) {
      const field = by[0] as "surface";
      const groups = new Map<string, Row[]>();
      for (const row of rows.filter((r) => matches(r, where))) {
        const list = groups.get(row[field]) ?? [];
        list.push(row);
        groups.set(row[field], list);
      }
      return [...groups.entries()].map(([value, list]) => ({
        [field]: value,
        _sum: { sizeBytes: list.reduce((a, r) => a + r.sizeBytes, 0n) },
        _count: { _all: list.length },
      }));
    },
  };
  return { storedFile: table, table };
}

function registry() {
  const fake = fakePrisma();
  const svc = new StorageRegistryService(fake as any);
  return { svc, fake };
}

const base = {
  organizationId: "org-1",
  bucket: "qosprey-media-private",
  visibility: "private" as const,
  surface: "inbox",
  contentType: "image/jpeg",
};

describe("RM3 StorageRegistryService", () => {
  it("registers a file and serializes sizeBytes as a decimal string", async () => {
    const { svc } = registry();
    const row = await svc.register({ ...base, key: "org-1/inbox/a.jpg", sizeBytes: 12345, width: 800, height: 600, sha256: "ab12" });
    expect(row.key).toBe("org-1/inbox/a.jpg");
    expect(row.sizeBytes).toBe("12345");
    expect(row.status).toBe("active");
    expect(row.width).toBe(800);
  });

  it("re-registering the same key upserts instead of duplicating (usage counts it once)", async () => {
    const { svc, fake } = registry();
    await svc.register({ ...base, key: "org-1/inbox/a.jpg", sizeBytes: 100 });
    await svc.register({ ...base, key: "org-1/inbox/a.jpg", sizeBytes: 250, status: "active" });
    expect(fake.table.rows).toHaveLength(1);
    const usage = await svc.usageForOrg("org-1");
    expect(usage.totalBytes).toBe("250");
    expect(usage.fileCount).toBe(1);
  });

  it("usage sums across surfaces with a per-surface breakdown, and other orgs are invisible", async () => {
    const { svc } = registry();
    await svc.register({ ...base, key: "org-1/inbox/a.jpg", sizeBytes: 1000 });
    await svc.register({ ...base, key: "org-1/social/b.mp4", surface: "social", contentType: "video/mp4", sizeBytes: 2000 });
    await svc.register({ ...base, key: "org-2/inbox/c.jpg", organizationId: "org-2", sizeBytes: 9999 });
    const usage = await svc.usageForOrg("org-1");
    expect(usage.totalBytes).toBe("3000");
    expect(usage.fileCount).toBe(2);
    expect(usage.bySurface).toEqual({
      inbox: { totalBytes: "1000", fileCount: 1 },
      social: { totalBytes: "2000", fileCount: 1 },
    });
  });

  it("handles files larger than the Int ceiling (the BigInt reason) exactly", async () => {
    const { svc } = registry();
    await svc.register({ ...base, key: "org-1/social/big.mp4", surface: "social", contentType: "video/mp4", sizeBytes: 3_500_000_000 });
    await svc.register({ ...base, key: "org-1/social/big2.mp4", surface: "social", contentType: "video/mp4", sizeBytes: 3_500_000_000 });
    const usage = await svc.usageForOrg("org-1");
    expect(usage.totalBytes).toBe("7000000000");
  });

  it("markTrashed flips status, excludes the file from usage, and is org-guarded", async () => {
    const { svc } = registry();
    await svc.register({ ...base, key: "org-1/inbox/a.jpg", sizeBytes: 100 });
    await svc.register({ ...base, key: "org-1/inbox/b.jpg", sizeBytes: 200 });

    expect(await svc.markTrashed("org-2", "org-1/inbox/a.jpg")).toEqual({ key: "org-1/inbox/a.jpg", trashed: false });
    expect(await svc.markTrashed("org-1", "org-1/inbox/a.jpg")).toEqual({ key: "org-1/inbox/a.jpg", trashed: true });
    expect(await svc.markTrashed("org-1", "org-1/inbox/nope.jpg")).toEqual({ key: "org-1/inbox/nope.jpg", trashed: false });

    const usage = await svc.usageForOrg("org-1");
    expect(usage.totalBytes).toBe("200");
    expect(usage.fileCount).toBe(1);

    const row = await svc.findByKey("org-1/inbox/a.jpg");
    expect(row.status).toBe("trashed");
  });

  it("quarantine files count toward usage until trashed; empty org measures zero", async () => {
    const { svc } = registry();
    expect(await svc.usageForOrg("org-empty")).toEqual({ organizationId: "org-empty", totalBytes: "0", fileCount: 0, bySurface: {} });
    await svc.register({ ...base, key: "_quarantine/org-1/u.jpg", sizeBytes: 50, status: "quarantine" });
    const usage = await svc.usageForOrg("org-1");
    expect(usage.totalBytes).toBe("50");
    expect(usage.fileCount).toBe(1);
  });
});
