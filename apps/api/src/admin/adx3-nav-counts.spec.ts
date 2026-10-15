process.env.ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
import { AdminService } from "./admin.service";

/**
 * ADX3 — GET /admin/nav-counts (AdminService.navCounts).
 *
 * The counts behind the admin sidebar badges and the Attention
 * Bell. The honesty contract under test (architecture doc §4–§5):
 *  - every field is counted from real rows with the definitions
 *    the corresponding page already uses;
 *  - a field that cannot be sourced is OMITTED — never 0-filled;
 *  - failedJobs24h is all-or-nothing (a partial sum understates);
 *  - genuine zeros ARE returned as 0 (the client decides display).
 * Fake Prisma follows the other admin specs' mocked pattern.
 */

const NOW = new Date("2026-10-15T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600000);

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

function table(rows: any[] = [], opts: { throwOn?: string } = {}) {
  return {
    rows,
    count: async ({ where }: any = {}) => {
      if (opts.throwOn === "count") throw new Error("count failed");
      return rows.filter((r) => matches(r, where)).length;
    },
    findMany: async ({ where, orderBy, take }: any = {}) => {
      if (opts.throwOn === "findMany") throw new Error("findMany failed");
      let out = rows.filter((r) => matches(r, where));
      if (orderBy?.createdAt === "desc") out = [...out].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
      return take != null ? out.slice(0, take) : out;
    },
    findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
  };
}

function fakePrisma(over: Record<string, any> = {}) {
  return {
    payoutRequest: table([
      { id: "p1", status: "pending" }, { id: "p2", status: "pending" },
      { id: "p3", status: "approved" }, { id: "p4", status: "paid" },
    ]),
    supportTicket: table([
      { id: "t1", status: "open" }, { id: "t2", status: "pending" },
      { id: "t3", status: "open" }, { id: "t4", status: "resolved" }, { id: "t5", status: "closed" },
    ]),
    syncJob: table([
      { id: "s1", status: "FAILED", startedAt: hoursAgo(2), integrationId: "i1" },
      { id: "s2", status: "FAILED", startedAt: hoursAgo(30), integrationId: "i1" }, // outside 24h
      { id: "s3", status: "COMPLETED", startedAt: hoursAgo(1), integrationId: "i1" },
    ]),
    automationRun: table([
      { id: "a1", status: "error", createdAt: hoursAgo(3) },
      { id: "a2", status: "error", createdAt: hoursAgo(40) }, // outside 24h
      { id: "a3", status: "success", createdAt: hoursAgo(1) },
    ]),
    integration: table([{ id: "i1", organizationId: "org-1", provider: "shopify", status: "CONNECTED", createdAt: hoursAgo(50), updatedAt: hoursAgo(50) }]),
    subscription: table([
      { id: "sub1", organizationId: "org-1", plan: "GROWTH", status: "PAST_DUE", currentPeriodEnd: hoursAgo(72), createdAt: hoursAgo(500), updatedAt: hoursAgo(70) },
      { id: "sub2", organizationId: "org-2", plan: "FREE", status: "ACTIVE", currentPeriodEnd: new Date(NOW.getTime() + 86400000), createdAt: hoursAgo(400), updatedAt: hoursAgo(60) },
    ]),
    organization: table([{ id: "org-1", name: "Org One" }, { id: "org-2", name: "Org Two" }]),
    saasPayment: table([]),
    systemSetting: table([]),
    ...over,
  } as any;
}

const audit: any = { log: async () => undefined };
const svc = (over?: Record<string, any>) => new AdminService(fakePrisma(over), audit);

describe("ADX3 navCounts", () => {
  it("counts every field from real rows with the page definitions", async () => {
    const out = await svc().navCounts(NOW);
    expect(out.pendingPayouts).toBe(2); // pending only, not approved/paid
    expect(out.openTickets).toBe(3); // open + pending, not resolved/closed
    expect(out.failedJobs24h).toBe(2); // 1 FAILED sync in 24h (startedAt) + 1 error run in 24h
    expect(out.overdueSubscriptions).toBe(1); // the PAST_DUE latest sub; org-2 is ACTIVE + not ended
  });

  it("activeAlerts matches alertsBoard()'s own computation on the same data", async () => {
    const s = svc();
    const [counts, board] = await Promise.all([s.navCounts(NOW), s.alertsBoard()]);
    expect(counts.activeAlerts).toBe(board.length);
    // The seed data produces exactly the PAST_DUE alert.
    expect(board.map((a: any) => a.kind)).toEqual(["past_due"]);
    expect(counts.activeAlerts).toBe(1);
  });

  it("returns genuine zeros as 0, not omitted", async () => {
    const out = await svc({
      payoutRequest: table([]), supportTicket: table([]),
      syncJob: table([]), automationRun: table([]),
      integration: table([]), subscription: table([]),
    }).navCounts(NOW);
    expect(out).toEqual({
      pendingPayouts: 0, openTickets: 0, failedJobs24h: 0, activeAlerts: 0, overdueSubscriptions: 0,
    });
  });

  it("omits a field whose count query fails — never zero-fills it", async () => {
    const out = await svc({ payoutRequest: table([], { throwOn: "count" }) }).navCounts(NOW);
    expect("pendingPayouts" in out).toBe(false);
    expect(out.openTickets).toBe(3); // the other fields are unaffected
  });

  it("failedJobs24h is all-or-nothing: one side failing omits the whole field", async () => {
    const out = await svc({ automationRun: table([], { throwOn: "count" }) }).navCounts(NOW);
    expect("failedJobs24h" in out).toBe(false);
    expect(out.pendingPayouts).toBe(2);
  });

  it("activeAlerts survives an integration-read failure exactly as alertsBoard() does", async () => {
    // alertsBoard() internally catches its integration read and
    // still computes the subscription-driven alerts; navCounts must
    // agree with the board, not invent its own failure mode.
    const p = fakePrisma();
    p.integration = { findMany: async () => { throw new Error("db down"); } };
    const s = new AdminService(p, audit);
    const out = await s.navCounts(NOW);
    expect(out.activeAlerts).toBe(1); // the PAST_DUE alert only
  });

  it("omits overdueSubscriptions when billingSummary() cannot run", async () => {
    const p = fakePrisma();
    p.subscription = { findMany: async () => { throw new Error("db down"); } };
    const out = await new AdminService(p, audit).navCounts(NOW);
    expect("overdueSubscriptions" in out).toBe(false);
  });
});
