import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ConnectionsService } from "./connections.service";

/**
 * CC22 (Connect Center Next) — connection health analytics.
 *
 * Everything here is computed from REAL ConnectionHealthCheck
 * rows (the CC11 Doctor's recorded runs — manual and sweep)
 * and nothing else: no live provider calls, no estimates.
 *
 * Definitions (documented, pinned by specs):
 * - A run's outcome is its stored `overall`: "pass" = ok,
 *   "fail" = failed, "partial" = DEGRADED. Degraded counts as
 *   NOT ok for uptime — it is in the denominator and never in
 *   the numerator — and is also reported as its own count so
 *   the tenant can see it separately.
 * - uptimePct (30 days) = pass / (pass + fail + degraded)
 *   over the runs in the window, one decimal.
 * - An account with ZERO recorded checks returns explicit
 *   nulls for uptime / last-failure (NEVER 0% or 100% — no
 *   data is not perfect health and not total failure).
 * - Daily buckets are the last 14 UTC days; a day with no
 *   runs has total 0 and passRatePct null.
 * - The org "worst" list ranks by uptime ascending among
 *   accounts with >= 5 checks in the window (a single bad run
 *   must not brand an account the worst).
 * - The account universe is the Connect Center overview's own
 *   account list (targetType = overview `source`, targetId =
 *   overview `id`) — the same identity the Doctor records.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AccountHealthStats {
  targetType: string;
  targetId: string;
  provider: string | null;
  category: string | null;
  displayName: string | null;
  checks: number;
  passed: number;
  failed: number;
  degraded: number;
  uptimePct: number | null;
  lastFailureAt: string | null;
  lastFailureKind: string | null;
  daily: { date: string; total: number; passed: number; failed: number; degraded: number; passRatePct: number | null }[];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class ConnectionAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: ConnectionsService,
  ) {}

  async getHealthAnalytics(organizationId: string, now = new Date()) {
    const since30 = new Date(now.getTime() - 30 * DAY_MS);
    const rows = await (this.prisma as any).connectionHealthCheck.findMany({
      where: { organizationId, createdAt: { gte: since30 } },
      orderBy: { createdAt: "desc" }, take: 5000,
    }).catch(() => []);

    // Group the recorded runs by the CC11 target identity.
    const byTarget = new Map<string, any[]>();
    for (const row of rows ?? []) {
      const key = `${row.targetType}:${row.targetId}`;
      const list = byTarget.get(key) ?? [];
      list.push(row);
      byTarget.set(key, list);
    }

    // The account universe comes from the overview (the same
    // list the tenant sees), so accounts that exist but were
    // never checked appear with explicit nulls.
    const overview = await this.connections.getOverview(organizationId);
    const accounts: any[] = overview.categories.flatMap((c: any) => c.accounts ?? []);

    const stats: AccountHealthStats[] = accounts.map((account) => {
      const targetType = String(account.source);
      const targetId = String(account.id);
      const runs = byTarget.get(`${targetType}:${targetId}`) ?? [];
      return this.statsFor(targetType, targetId, {
        provider: account.provider ?? null,
        category: account.category ?? null,
        displayName: account.displayName ?? null,
      }, runs, now);
    });

    const worst = stats
      .filter((s) => s.checks >= 5 && s.uptimePct !== null)
      .sort((a, b) => (a.uptimePct! - b.uptimePct!) || (b.checks - a.checks))
      .slice(0, 5);

    return {
      generatedAt: now.toISOString(),
      windowDays: 30,
      accounts: stats,
      worst,
    };
  }

  private statsFor(
    targetType: string,
    targetId: string,
    identity: { provider: string | null; category: string | null; displayName: string | null },
    runs: any[],
    now: Date,
  ): AccountHealthStats {
    let passed = 0;
    let failed = 0;
    let degraded = 0;
    let lastFailureAt: string | null = null;
    let lastFailureKind: string | null = null;

    // Daily buckets: the last 14 UTC days, oldest first.
    const dailyMap = new Map<string, { total: number; passed: number; failed: number; degraded: number }>();
    for (let i = 13; i >= 0; i--) {
      dailyMap.set(dayKey(new Date(now.getTime() - i * DAY_MS)), { total: 0, passed: 0, failed: 0, degraded: 0 });
    }

    // Runs arrive newest-first (the query orders desc), so the
    // first "fail" seen is the most recent failure.
    for (const run of runs) {
      const overall = String(run.overall ?? "");
      const bucket = dailyMap.get(dayKey(new Date(run.createdAt)));
      if (overall === "pass") passed++;
      else if (overall === "fail") {
        failed++;
        if (!lastFailureAt) {
          lastFailureAt = new Date(run.createdAt).toISOString();
          const steps: any[] = Array.isArray(run.steps) ? run.steps : [];
          const failedKeys = steps.filter((s) => s?.status === "fail").map((s) => String(s.key ?? "")).filter(Boolean);
          lastFailureKind = failedKeys.length ? failedKeys.join(", ") : "doctor_fail";
        }
      } else if (overall === "partial") degraded++;
      if (bucket) {
        bucket.total++;
        if (overall === "pass") bucket.passed++;
        else if (overall === "fail") bucket.failed++;
        else if (overall === "partial") bucket.degraded++;
      }
    }

    const checks = runs.length;
    return {
      targetType, targetId,
      provider: identity.provider, category: identity.category, displayName: identity.displayName,
      checks, passed, failed, degraded,
      uptimePct: checks > 0 ? round1((passed / checks) * 100) : null,
      lastFailureAt,
      lastFailureKind,
      daily: [...dailyMap.entries()].map(([date, b]) => ({
        date, ...b,
        passRatePct: b.total > 0 ? round1((b.passed / b.total) * 100) : null,
      })),
    };
  }
}
