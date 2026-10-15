import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { parseRange } from "./order-analytics.service";
import { ORDER_TERMINAL_STATUSES } from "./order-queues";

/**
 * ON12 — Team Performance (the ON12 remainder; see the plan note
 * in docs/orders-ob5-on12-acceptance.md).
 *
 * METRIC DEFINITIONS (every number traces to exactly these —
 * do not fork; NO schema change, NO migration — every metric
 * reads existing rows):
 *
 * - Population: ALL ACTIVE Membership rows of the org. A member
 *   with no activity in range still appears, with zeros and
 *   their real assignedOpen. Inactive/suspended memberships
 *   never appear, and no other org's member ever appears.
 * - Range: `from`/`to` are Asia/Dhaka calendar days
 *   (YYYY-MM-DD) — the ON9 conversion (order-analytics
 *   parseRange: window = [from 00:00 +06:00, to+1day
 *   00:00 +06:00); defaults to = today (Dhaka), from = to − 29
 *   days; from > to → 400 Bengali). Range-bound metrics filter
 *   their source timestamp against [start, end).
 * - assignedOpen (CURRENT SNAPSHOT, NOT range-bound): Order
 *   rows with organizationId = org, assigneeId = the member's
 *   userId, isPractice = false, and status NOT in
 *   ORDER_TERMINAL_STATUSES (order-queues.ts — the orders
 *   area's one lifecycle-done set). It answers "who is holding
 *   open work right now", so the range never applies to it;
 *   the web panel labels the column "এখন খোলা (বর্তমান)".
 * - statusChanges / holdsPlaced / holdsReleased / codCalls /
 *   commentsPosted (RANGE-BOUND): AuditLog counts where
 *   organizationId = org, userId = the member, createdAt in
 *   range, entityType = "Order", and action is EXACTLY:
 *     statusChanges  = "orders.status_changed"
 *     holdsPlaced    = "orders.review_hold_set"
 *     holdsReleased  = "orders.review_hold_released"
 *     codCalls       = "orders.cod_call_recorded"
 *     commentsPosted = "orders.comment_created"
 *   entityType: EVERY one of these five writers was verified
 *   to set entityType "Order" (OrdersService.updateOrder,
 *   FraudShieldService hold/release/recordCodCall,
 *   OrderInsightsService.createComment), so the filter applies
 *   to all five uniformly.
 *   DEFINITION LIMIT (stated, not worked around): bulk
 *   operations write ONE "orders.bulk" AuditLog row, not
 *   per-order "orders.status_changed" rows — so status changes
 *   made through a bulk action do NOT appear in statusChanges.
 * - picksDone (RANGE-BOUND): PickWaveOrder rows with
 *   pickedById = the member and pickedAt in range.
 *   PickWaveOrder carries no organizationId — org scoping goes
 *   through its PickWave (wave.organizationId = org), exactly
 *   the ON6 model shape.
 *
 * Aggregation choice (documented per the brief): orgs are
 * small, so this follows the orders-area house pattern (ON9
 * analytics / queues / insights): org-scoped findMany per
 * source table, then a JS tally per member. One findMany over
 * the five audit actions in one query, not five queries.
 */

export const TEAM_PERFORMANCE_ACTIONS = {
  statusChanges: "orders.status_changed",
  holdsPlaced: "orders.review_hold_set",
  holdsReleased: "orders.review_hold_released",
  codCalls: "orders.cod_call_recorded",
  commentsPosted: "orders.comment_created",
} as const;

type MetricKey = keyof typeof TEAM_PERFORMANCE_ACTIONS;

const ACTION_TO_METRIC = new Map<string, MetricKey>(
  (Object.entries(TEAM_PERFORMANCE_ACTIONS) as [MetricKey, string][]).map(([k, v]) => [v, k]),
);

function toTime(v: any): number | null {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

function emptyMetrics() {
  return {
    assignedOpen: 0,
    statusChanges: 0,
    holdsPlaced: 0,
    holdsReleased: 0,
    codCalls: 0,
    picksDone: 0,
    commentsPosted: 0,
  };
}

@Injectable()
export class OrderTeamPerformanceService {
  constructor(private readonly prisma: PrismaService) {}

  private t(name: string): any { return (this.prisma as any)[name]; }

  private async rows(name: string, where: any): Promise<any[]> {
    try {
      const table = this.t(name);
      if (!table?.findMany) return [];
      return (await table.findMany({ where })) ?? [];
    } catch { return []; }
  }

  async getTeamPerformance(organizationId: string, from?: string, to?: string, now: Date = new Date()) {
    const range = parseRange(from, to, now);
    const inRange = (t: number | null) => t !== null && t >= range.start.getTime() && t < range.end.getTime();

    const [memberships, users, orders, audits, waves, pickRows] = await Promise.all([
      this.rows("membership", { organizationId }),
      this.rows("user", {}),
      this.rows("order", { organizationId }),
      this.rows("auditLog", { organizationId }),
      this.rows("pickWave", { organizationId }),
      this.rows("pickWaveOrder", {}),
    ]);

    const userById = new Map(users.map((u: any) => [String(u.id), u]));
    const active = memberships.filter((m: any) => String(m.status) === "ACTIVE");

    // One tally bucket per ACTIVE member (dedupe by userId —
    // a user holds at most one membership per org in practice,
    // and a duplicate row must never double a person).
    const byUser = new Map<string, ReturnType<typeof emptyMetrics>>();
    const memberRows: { userId: string; role: string }[] = [];
    for (const m of active) {
      const userId = String(m.userId);
      if (byUser.has(userId)) continue;
      byUser.set(userId, emptyMetrics());
      memberRows.push({ userId, role: String(m.role ?? "") });
    }

    // assignedOpen — current snapshot, NOT range-bound.
    for (const o of orders) {
      if (o.isPractice) continue;
      if (!o.assigneeId) continue;
      const bucket = byUser.get(String(o.assigneeId));
      if (!bucket) continue;
      if ((ORDER_TERMINAL_STATUSES as readonly string[]).includes(String(o.status))) continue;
      bucket.assignedOpen++;
    }

    // Audit-backed metrics — one pass over the org's audit rows;
    // only the five exact actions count (NOT "orders.bulk").
    for (const a of audits) {
      const metric = ACTION_TO_METRIC.get(String(a.action));
      if (!metric) continue;
      if (String(a.entityType) !== "Order") continue;
      if (!a.userId) continue;
      const bucket = byUser.get(String(a.userId));
      if (!bucket) continue;
      if (!inRange(toTime(a.createdAt))) continue;
      bucket[metric]++;
    }

    // picksDone — org via the wave, picker + pickedAt in range.
    const orgWaveIds = new Set(waves.map((w: any) => String(w.id)));
    for (const p of pickRows) {
      if (!orgWaveIds.has(String(p.waveId))) continue;
      if (!p.pickedById || !p.pickedAt) continue;
      const bucket = byUser.get(String(p.pickedById));
      if (!bucket) continue;
      if (!inRange(toTime(p.pickedAt))) continue;
      bucket.picksDone++;
    }

    const members = memberRows
      .map(({ userId, role }) => {
        const user = userById.get(userId);
        const metrics = byUser.get(userId)!;
        return {
          userId,
          name: user?.name ? String(user.name) : (user?.email ? String(user.email) : userId),
          email: user?.email ? String(user.email) : null,
          role,
          ...metrics,
        };
      })
      .sort((a, b) => {
        const actA = a.statusChanges + a.holdsPlaced + a.holdsReleased + a.codCalls + a.picksDone + a.commentsPosted;
        const actB = b.statusChanges + b.holdsPlaced + b.holdsReleased + b.codCalls + b.picksDone + b.commentsPosted;
        return actB - actA || a.name.localeCompare(b.name);
      });

    const totals = emptyMetrics();
    for (const m of members) {
      totals.assignedOpen += m.assignedOpen;
      totals.statusChanges += m.statusChanges;
      totals.holdsPlaced += m.holdsPlaced;
      totals.holdsReleased += m.holdsReleased;
      totals.codCalls += m.codCalls;
      totals.picksDone += m.picksDone;
      totals.commentsPosted += m.commentsPosted;
    }

    return { from: range.from, to: range.to, members, totals };
  }
}
