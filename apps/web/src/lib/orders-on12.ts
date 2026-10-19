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
import { ordersBn, ordersEn } from "@/lib/i18n/orders";
import { interpolate } from "@/lib/i18n/lookup";

/** ML5 i18n: locale for lib label helpers — defaults to bn so
 * existing callers and tests keep the Bengali copy. */
export type LibLocale = "bn" | "en";
const D = (locale?: string): typeof ordersBn =>
  locale === "en" ? ordersEn : ordersBn;


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
  OWNER: ordersBn.owner,
  ADMIN: ordersBn.admin,
  MARKETING_MANAGER: ordersBn.marketingManager,
  SUPPORT_AGENT: ordersBn.supportAgent,
  VIEWER: ordersBn.viewer,
};

/** Role key → Bengali label; an unknown role shows as-is. */
export function roleLabel(role: string, locale: LibLocale = "bn"): string {
  const d = D(locale);
  const map: Record<string, string> = {
    OWNER: d.owner, ADMIN: d.admin, MARKETING_MANAGER: d.marketingManager,
    SUPPORT_AGENT: d.supportAgent, VIEWER: d.viewer,
  };
  return map[role] ?? role;
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
