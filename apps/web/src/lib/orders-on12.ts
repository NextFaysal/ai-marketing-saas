/**
 * ON12 (Orders Next): Team Performance — pure payload-shaping
 * helpers for the team panel. Side-effect free, unit-testable.
 * Shapes mirror the API payload in
 * apps/api/src/orders/order-team-performance.service.ts EXACTLY.
 *
 * Honesty notes carried from the API:
 * - assignedOpen is a CURRENT snapshot (orders assigned to the
 *   member right now whose status is non-terminal) — it is NOT
 *   range-bound, and the panel labels it "এখন খোলা (বর্তমান)".
 * - statusChanges counts only per-order
 *   "orders.status_changed" audit rows; bulk actions write one
 *   "orders.bulk" row and never appear here (documented
 *   definition limit on both sides).
 */

export interface TeamMemberPerformance {
  userId: string;
  name: string;
  email: string | null;
  role: string;
  assignedOpen: number;
  statusChanges: number;
  holdsPlaced: number;
  holdsReleased: number;
  codCalls: number;
  picksDone: number;
  commentsPosted: number;
}

export interface TeamPerformanceTotals {
  assignedOpen: number;
  statusChanges: number;
  holdsPlaced: number;
  holdsReleased: number;
  codCalls: number;
  picksDone: number;
  commentsPosted: number;
}

export interface TeamPerformancePayload {
  from: string;
  to: string;
  members: TeamMemberPerformance[];
  totals: TeamPerformanceTotals;
}

export function buildTeamPerformancePath(orgId: string, from: string, to: string): string {
  return `/organizations/${orgId}/orders/team-performance?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}

const ROLE_LABELS: Record<string, string> = {
  OWNER: "মালিক",
  ADMIN: "অ্যাডমিন",
  MARKETING_MANAGER: "মার্কেটিং ম্যানেজার",
  SUPPORT_AGENT: "সাপোর্ট এজেন্ট",
  VIEWER: "দর্শক",
};

/** Role key → Bengali label; an unknown role shows as-is. */
export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

/** Display name: the API already falls back name → email →
 * userId; an empty name still degrades to email/userId here. */
export function memberDisplayName(m: TeamMemberPerformance): string {
  return m.name || m.email || m.userId;
}

/** Holds cell: placed / released, e.g. "+3 / −1". */
export function formatHolds(placed: number, released: number): string {
  return `+${placed} / −${released}`;
}

/** Range-bound activity total (assignedOpen excluded — it is a
 * snapshot, not range activity). Used for row emphasis only. */
export function activityTotal(m: TeamMemberPerformance): number {
  return m.statusChanges + m.holdsPlaced + m.holdsReleased + m.codCalls + m.picksDone + m.commentsPosted;
}
