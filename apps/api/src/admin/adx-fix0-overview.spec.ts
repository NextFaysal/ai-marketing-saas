process.env.ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
import { AdminService } from "./admin.service";

/**
 * DB2 FIX-0 — AdminService.overview() failed-sync count.
 *
 * The bug (found in DB1, recorded in docs/admin-ux-architecture.md
 * §5 and the DB1 acceptance doc): overview() filtered SyncJob by
 * `updatedAt`, a field the SyncJob model does NOT have (schema:
 * startedAt / completedAt only). Against real Prisma that query
 * throws, and overview's `.catch(() => 0)` silently reported 0
 * failed sync jobs forever.
 *
 * This spec's fake Prisma reproduces Prisma's behaviour for an
 * unknown field: a syncJob.count whose `where` mentions `updatedAt`
 * THROWS (as Prisma's validation does). With the fix, overview()
 * queries by `startedAt` — the same field navCounts() and every
 * other failed-sync query use — and the recent FAILED job counts.
 */

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600000);

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (k === "OR") return (v as any[]).some((w) => matches(row, w));
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("gte" in v) return new Date(row[k]) >= new Date((v as any).gte);
      if ("startsWith" in v) return String(row[k] ?? "").startsWith((v as any).startsWith);
      return true;
    }
    return row[k] === v;
  });
}

function table(rows: any[] = []) {
  return {
    rows,
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where)).length,
    findMany: async ({ where, orderBy, take }: any = {}) => {
      let out = rows.filter((r) => matches(r, where));
      if (orderBy?.createdAt === "desc") out = [...out].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
      return take != null ? out.slice(0, take) : out;
    },
  };
}

/** SyncJob fake that mimics real Prisma: unknown field ⇒ throw. */
function syncJobTable(rows: any[], seen: { wheres: any[] }) {
  return {
    rows,
    count: async ({ where }: any = {}) => {
      seen.wheres.push(where);
      if (where && "updatedAt" in where) {
        throw new Error("Unknown argument `updatedAt`. Did you mean `startedAt`?");
      }
      return rows.filter((r) => matches(r, where)).length;
    },
    findMany: async () => [],
  };
}

function fakePrisma(seen: { wheres: any[] }) {
  return {
    organization: table([{ id: "o1", createdAt: hoursAgo(100) }, { id: "o2", createdAt: hoursAgo(24 * 40) }]),
    user: table([{ id: "u1", createdAt: hoursAgo(50) }]),
    order: table([]),
    dailyAdMetric: table([]),
    aIUsageRecord: table([]),
    syncJob: syncJobTable([
      { id: "s1", status: "FAILED", startedAt: hoursAgo(2) },   // recent failure — must count
      { id: "s2", status: "FAILED", startedAt: hoursAgo(30) },  // outside the 24h window
      { id: "s3", status: "COMPLETED", startedAt: hoursAgo(1) }, // not a failure
      { id: "s4", status: "FAILED", startedAt: hoursAgo(23) },  // recent failure — must count
    ], seen),
    automationRun: table([
      { id: "a1", status: "error", createdAt: hoursAgo(3) },
      { id: "a2", status: "error", createdAt: hoursAgo(49) },
    ]),
    auditLog: table([]),
  } as any;
}

const audit: any = { log: async () => undefined };

describe("FIX-0 overview() failedSyncJobs24h", () => {
  it("counts recent FAILED SyncJobs via startedAt (not the nonexistent updatedAt)", async () => {
    const seen = { wheres: [] as any[] };
    const out = await new AdminService(fakePrisma(seen), audit).overview();
    expect(out.failedSyncJobs24h).toBe(2); // s1 (2h ago) + s4 (23h ago); s2 is 30h old, s3 COMPLETED
    expect(out.failedAutomationRuns24h).toBe(1); // unchanged behaviour on the other side
    // The query itself must be the startedAt-based definition.
    expect(seen.wheres).toHaveLength(1);
    expect(seen.wheres[0]).toEqual({ status: "FAILED", startedAt: { gte: expect.any(Date) } });
    expect("updatedAt" in seen.wheres[0]).toBe(false);
    // Response shape is unchanged.
    expect(out.organizations).toBe(2);
    expect(out.users).toBe(1);
    expect(out).toHaveProperty("monthOrders");
    expect(out).toHaveProperty("recentAdminActions");
  });

  it("a where-clause using updatedAt would have thrown against this Prisma (the old bug)", async () => {
    const seen = { wheres: [] as any[] };
    const p = fakePrisma(seen);
    await expect(p.syncJob.count({ where: { status: "FAILED", updatedAt: { gte: new Date() } } }))
      .rejects.toThrow("Unknown argument `updatedAt`");
  });
});
