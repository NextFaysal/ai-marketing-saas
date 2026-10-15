process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "<MASKED_SECRET_001>";

import { ConnectionAnalyticsService } from "./connection-analytics.service";

/**
 * CC22 — health analytics from REAL ConnectionHealthCheck rows.
 * Pinned math:
 * - uptime = pass / (pass + fail + partial); partial
 *   ("degraded") is in the denominator, never the numerator,
 *   and is reported as its own count;
 * - zero checks ⇒ uptimePct / lastFailure are explicit nulls
 *   (never 0% or 100%);
 * - last failure kind comes from the failed run's own failed
 *   step keys;
 * - daily buckets cover the last 14 days; an empty day has
 *   passRatePct null;
 * - the worst list needs >= 5 checks, ranks by uptime
 *   ascending, and caps at 5;
 * - runs older than 30 days are outside the window.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-14T12:00:00.000Z");

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if ("in" in v) return v.in.includes(row[k]);
      if ("gte" in v) return new Date(row[k]).getTime() >= new Date(v.gte).getTime();
      return true;
    }
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
    return row[k] === v;
  });
}

function makeCheckTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findMany: async (args: any = {}) => {
      let out = rows.filter((r) => matches(r, args.where ?? {}));
      const orderBy = args?.orderBy;
      if (orderBy) {
        const [key, dir] = Object.entries(orderBy)[0] as [string, string];
        out.sort((a, b) => {
          const av = new Date(a[key]).getTime(), bv = new Date(b[key]).getTime();
          return dir === "desc" ? bv - av : av - bv;
        });
      }
      if (typeof args?.take === "number") out = out.slice(0, args.take);
      return out;
    },
    create: async ({ data }: any) => { const row = { id: `check-${++seq}`, ...data }; rows.push(row); return row; },
  };
}

function build(accounts: any[]) {
  const checks = makeCheckTable();
  const tables: any = { connectionHealthCheck: checks };
  const connections: any = {
    getOverview: async () => ({
      categories: [{ key: "messaging", accounts }],
    }),
  };
  const svc = new ConnectionAnalyticsService(tables as any, connections);
  return { svc, checks };
}

const ACCT_A = { id: "int-a", source: "integration", provider: "whatsapp", category: "messaging", displayName: "WhatsApp A" };
const ACCT_B = { id: "int-b", source: "integration", provider: "shopify", category: "commerce", displayName: "Shop B" };

async function addRun(checks: any, targetId: string, overall: string, at: Date, steps: any[] = []) {
  return checks.create({
    data: {
      organizationId: "org-1", targetType: "integration", targetId,
      provider: "whatsapp", category: "messaging", displayName: "X",
      overall, steps, trigger: "sweep", runById: null, createdAt: at,
    },
  });
}

describe("CC22 health analytics", () => {
  it("computes uptime with degraded counted as not-ok and shown separately", async () => {
    const { svc, checks } = build([ACCT_A]);
    for (let i = 0; i < 6; i++) await addRun(checks, "int-a", "pass", new Date(NOW.getTime() - i * DAY));
    for (let i = 0; i < 3; i++) await addRun(checks, "int-a", "fail", new Date(NOW.getTime() - i * DAY - 1000), [{ key: "token", label: "Token", status: "fail", message: "expired" }]);
    await addRun(checks, "int-a", "partial", new Date(NOW.getTime() - 2 * DAY));
    const out = await svc.getHealthAnalytics("org-1", NOW);
    const a = out.accounts[0];
    expect(a.checks).toBe(10);
    expect(a.passed).toBe(6);
    expect(a.failed).toBe(3);
    expect(a.degraded).toBe(1);
    expect(a.uptimePct).toBe(60);
  });

  it("returns explicit nulls for an account with zero checks (never 0%/100%)", async () => {
    const { svc } = build([ACCT_A, ACCT_B]);
    const out = await svc.getHealthAnalytics("org-1", NOW);
    const b = out.accounts.find((x: any) => x.targetId === "int-b")!;
    expect(b.checks).toBe(0);
    expect(b.uptimePct).toBeNull();
    expect(b.lastFailureAt).toBeNull();
    expect(b.lastFailureKind).toBeNull();
    expect(b.daily).toHaveLength(14);
    expect(b.daily.every((d: any) => d.passRatePct === null)).toBe(true);
    expect(out.worst).toEqual([]);
  });

  it("reports the last failure time + kind from the newest failed run's failed steps", async () => {
    const { svc, checks } = build([ACCT_A]);
    await addRun(checks, "int-a", "fail", new Date(NOW.getTime() - 5 * DAY), [{ key: "bot", status: "fail" }]);
    await addRun(checks, "int-a", "fail", new Date(NOW.getTime() - 1 * DAY), [
      { key: "token", status: "fail" }, { key: "page", status: "pass" },
    ]);
    await addRun(checks, "int-a", "pass", NOW);
    const out = await svc.getHealthAnalytics("org-1", NOW);
    const a = out.accounts[0];
    expect(a.lastFailureAt).toBe(new Date(NOW.getTime() - 1 * DAY).toISOString());
    expect(a.lastFailureKind).toBe("token");
  });

  it("buckets runs into the last 14 daily buckets with per-day pass rates", async () => {
    const { svc, checks } = build([ACCT_A]);
    await addRun(checks, "int-a", "pass", NOW);
    await addRun(checks, "int-a", "fail", NOW, [{ key: "token", status: "fail" }]);
    await addRun(checks, "int-a", "pass", new Date(NOW.getTime() - 13 * DAY));
    const out = await svc.getHealthAnalytics("org-1", NOW);
    const daily = out.accounts[0].daily;
    expect(daily).toHaveLength(14);
    expect(daily[13].date).toBe("2026-10-14");
    expect(daily[13].total).toBe(2);
    expect(daily[13].passRatePct).toBe(50);
    expect(daily[0].total).toBe(1);
    expect(daily[0].passRatePct).toBe(100);
    expect(daily[5].passRatePct).toBeNull();
  });

  it("worst list requires >= 5 checks, ranks by uptime ascending, caps at 5", async () => {
    const accounts = Array.from({ length: 7 }, (_, i) => ({
      id: `int-${i}`, source: "integration", provider: "whatsapp", category: "messaging", displayName: `A${i}`,
    }));
    accounts.push({ id: "int-few", source: "integration", provider: "whatsapp", category: "messaging", displayName: "Few" });
    const { svc, checks } = build(accounts);
    // int-0: 5 checks all fail (0%); int-1: 5 checks 1 pass (20%); ... int-6: 5 checks all pass for 6 of them pattern
    for (let i = 0; i < 7; i++) {
      const passes = i; // int-0 → 0 passes of 5... need exactly 5 runs each: passes = min(i,5)
      const p = Math.min(i, 5);
      for (let j = 0; j < p; j++) await addRun(checks, `int-${i}`, "pass", new Date(NOW.getTime() - j * 1000 - i));
      for (let j = p; j < 5; j++) await addRun(checks, `int-${i}`, "fail", new Date(NOW.getTime() - j * 1000 - i), [{ key: "token", status: "fail" }]);
    }
    // int-few: only 2 checks, both fail — must NOT appear despite 0%.
    await addRun(checks, "int-few", "fail", NOW, [{ key: "token", status: "fail" }]);
    await addRun(checks, "int-few", "fail", NOW, [{ key: "token", status: "fail" }]);
    const out = await svc.getHealthAnalytics("org-1", NOW);
    expect(out.worst.map((w: any) => w.targetId)).toEqual(["int-0", "int-1", "int-2", "int-3", "int-4"]);
    expect(out.worst[0].uptimePct).toBe(0);
  });

  it("excludes runs older than the 30-day window", async () => {
    const { svc, checks } = build([ACCT_A]);
    await addRun(checks, "int-a", "fail", new Date(NOW.getTime() - 40 * DAY), [{ key: "token", status: "fail" }]);
    await addRun(checks, "int-a", "pass", NOW);
    const out = await svc.getHealthAnalytics("org-1", NOW);
    // The fake honours the createdAt >= since filter like Prisma.
    expect(out.accounts[0].checks).toBe(1);
    expect(out.accounts[0].uptimePct).toBe(100);
  });
});
