import { AdminService } from "./admin.service";

/**
 * RB6/RM12 — GET /admin/storage-overview aggregation over the
 * StoredFile registry: totals, bucket/visibility/surface splits,
 * top orgs with names, trashed reported separately, BigInt sums
 * as decimal strings, and the storage mode read from the same
 * env rule StorageService itself uses. Faked Prisma seams only.
 */

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(row[k]);
      if ("not" in v) return row[k] !== v.not;
      return true;
    }
    return row[k] === v;
  });
}

function groupByImpl(rows: any[]) {
  return async ({ by, where, orderBy, take }: any) => {
    const field = by[0];
    const filtered = rows.filter((r) => matches(r, where ?? {}));
    const groups = new Map<string, any[]>();
    for (const r of filtered) {
      const k = String(r[field]);
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    let out = [...groups.entries()].map(([k, rs]) => ({
      [field]: k,
      _sum: { sizeBytes: rs.reduce((a, r) => a + BigInt(r.sizeBytes ?? 0), 0n) },
      _count: { _all: rs.length },
    }));
    if (orderBy?._sum?.sizeBytes === "desc") {
      out = out.sort((a, b) => Number(b._sum.sizeBytes - a._sum.sizeBytes));
    }
    return take != null ? out.slice(0, take) : out;
  };
}

function aggregateImpl(rows: any[]) {
  return async ({ where }: any) => {
    const filtered = rows.filter((r) => matches(r, where ?? {}));
    return {
      _sum: { sizeBytes: filtered.reduce((a, r) => a + BigInt(r.sizeBytes ?? 0), 0n) },
      _count: { _all: filtered.length },
    };
  };
}

function seedRows() {
  return [
    { id: "1", organizationId: "org-1", bucket: "pub", visibility: "public", surface: "product", sizeBytes: 1000n, status: "active" },
    { id: "2", organizationId: "org-1", bucket: "priv", visibility: "private", surface: "inbox", sizeBytes: 500n, status: "active" },
    { id: "3", organizationId: "org-2", bucket: "pub", visibility: "public", surface: "product", sizeBytes: 2500n, status: "active" },
    { id: "4", organizationId: "org-2", bucket: "priv", visibility: "private", surface: "digital", sizeBytes: 9000n, status: "active" },
    { id: "5", organizationId: "org-1", bucket: "pub", visibility: "public", surface: "product", sizeBytes: 700n, status: "trashed" },
    { id: "6", organizationId: "org-1", bucket: "pub", visibility: "public", surface: "social", sizeBytes: 300n, status: "quarantine" },
  ];
}

function makePrisma(withGroupBy = true) {
  const rows = seedRows();
  const storedFile: any = {
    rows,
    findMany: async ({ take }: any = {}) => (take != null ? rows.slice(0, take) : [...rows]),
  };
  if (withGroupBy) {
    storedFile.groupBy = groupByImpl(rows);
    storedFile.aggregate = aggregateImpl(rows);
  }
  return {
    storedFile,
    organization: {
      findMany: async ({ where }: any = {}) =>
        [
          { id: "org-1", name: "দোকান এক" },
          { id: "org-2", name: "দোকান দুই" },
        ].filter((o) => matches(o, where ?? {})),
    },
  } as any;
}

const auditStub: any = { log: async () => {} };
const ENV_KEYS = ["MEDIA_S3_BUCKET", "MEDIA_S3_ACCESS_KEY_ID", "MEDIA_S3_SECRET_ACCESS_KEY", "MEDIA_R2_PRIVATE_BUCKET", "MEDIA_R2_PUBLIC_BUCKET"];

describe("RM12 storage overview (groupBy path)", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => { for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  it("aggregates totals and splits; trashed is separate; sums are strings", async () => {
    const svc = new AdminService(makePrisma(), auditStub);
    const out: any = await svc.storageOverview();
    expect(out.mode).toBe("local"); // no bucket env in the test process
    expect(out.registryAvailable).toBe(true);
    // live = active + quarantine: 1000+500+2500+9000+300 = 13300, 5 objects
    expect(out.totalObjects).toBe(5);
    expect(out.totalBytes).toBe("13300");
    expect(out.trashedObjects).toBe(1);
    expect(out.trashedBytes).toBe("700");
    expect(out.byVisibility).toEqual(expect.arrayContaining([
      { visibility: "public", objects: 3, bytes: "3800" },
      { visibility: "private", objects: 2, bytes: "9500" },
    ]));
    expect(out.byBucket).toEqual(expect.arrayContaining([
      { bucket: "pub", objects: 3, bytes: "3800" },
      { bucket: "priv", objects: 2, bytes: "9500" },
    ]));
    expect(out.bySurface[0]).toEqual({ surface: "digital", objects: 1, bytes: "9000" });
  });

  it("top orgs come back bytes-descending with names attached", async () => {
    const svc = new AdminService(makePrisma(), auditStub);
    const out: any = await svc.storageOverview();
    expect(out.topOrgs).toEqual([
      { organizationId: "org-2", name: "দোকান দুই", objects: 2, bytes: "11500" },
      { organizationId: "org-1", name: "দোকান এক", objects: 3, bytes: "1800" },
    ]);
  });

  it("mode flips to s3 exactly when bucket + credentials are configured", async () => {
    process.env.MEDIA_S3_BUCKET = "b";
    process.env.MEDIA_S3_ACCESS_KEY_ID = "k";
    process.env.MEDIA_S3_SECRET_ACCESS_KEY = "s";
    const svc = new AdminService(makePrisma(), auditStub);
    const out: any = await svc.storageOverview();
    expect(out.mode).toBe("s3");
  });
});

describe("RM12 storage overview (findMany fallback)", () => {
  it("aggregates identically without groupBy, and reports registry absence honestly", async () => {
    const svc = new AdminService(makePrisma(false), auditStub);
    const out: any = await svc.storageOverview();
    expect(out.totalObjects).toBe(5);
    expect(out.totalBytes).toBe("13300");
    expect(out.trashedBytes).toBe("700");
    expect(out.topOrgs[0]).toMatchObject({ organizationId: "org-2", bytes: "11500", name: "দোকান দুই" });

    const empty = new AdminService({ organization: { findMany: async () => [] } } as any, auditStub);
    const out2: any = await empty.storageOverview();
    expect(out2.registryAvailable).toBe(false);
    expect(out2.totalBytes).toBe("0");
  });
});
