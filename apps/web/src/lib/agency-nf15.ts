/**
 * NF15 (FB5) — Agency / reseller console web helpers + payload
 * types. There is NO agency entity: the console lists ONLY the
 * signed-in user's own ACTIVE memberships (the API builds it
 * from OrganizationsService.listMine), and the totals are sums
 * of those listed cards ONLY — the banner below keeps that
 * scope explicit so a labelled sum is never mistaken for
 * consolidated cross-org analytics. Money is minor-unit STRINGS
 * from the API — display via formatMinor, never floats.
 *
 * The commission banner must stay byte-identical to the API's
 * AGENCY_COMMISSION_RECORDS_NOTE_BN (apps/api/src/agency
 * /agency.service.ts) — pinned by the vitest suite.
 */

export const AGENCY_COMMISSION_RECORDS_BN =
  "কমিশন এখানে শুধু রেকর্ড হিসেবে রাখা হয় — কোনো টাকা স্বয়ংক্রিয়ভাবে কাটা বা পাঠানো হয় না। পেআউট OU11 আইনি গেটের অধীনে বন্ধ আছে।";

/** Honest per-card failure state (mirrors the API label). */
export const AGENCY_SUMMARY_ERROR_BN = "তথ্য লোড হয়নি";

export interface AgencyOrgSummary {
  ordersToday: number;
  revenueTodayMinor: string;
  ordersMonth: number;
  revenueMonthMinor: string;
  pendingOrders: number;
  unreadInbox: number;
}

export interface AgencyOrgCard {
  organization: {
    id: string;
    name: string;
    slug: string;
    creditMinor?: string;
    [key: string]: unknown;
  };
  myRole: string | null;
  summary: AgencyOrgSummary | null;
  error?: string | null;
}

export interface AgencyTotals {
  orgCount: number;
  ordersToday: number;
  revenueTodayMinor: string;
  ordersMonth: number;
  revenueMonthMinor: string;
  pendingOrders: number;
  unreadInbox: number;
  summariesFailed: number;
}

export interface AgencyConsoleView {
  orgs: AgencyOrgCard[];
  totals: AgencyTotals;
}

export interface AgencyCommissionView {
  id: string;
  agencyOrganizationId: string;
  clientOrganizationId: string;
  clientOrganizationName: string | null;
  periodLabel: string;
  amountMinor: string;
  note: string | null;
  recordedById: string;
  createdAt: string;
  updatedAt: string;
  recordsOnly: true;
}

/** Totals banner label — the sum covers ONLY the listed orgs,
 * and it says so, with the count. */
export function totalsBannerLabel(orgCount: number): string {
  return `শুধু তালিকাভুক্ত প্রতিষ্ঠানগুলোর মোট (${orgCount}টি)`;
}

/** The caller's own role in an org, in Bengali with the raw
 * role kept beside it (unknown roles pass through verbatim). */
export function roleLabelBn(role: string | null | undefined): string {
  switch (role) {
    case "OWNER": return "মালিক (OWNER)";
    case "ADMIN": return "অ্যাডমিন (ADMIN)";
    case "MARKETING_MANAGER": return "মার্কেটিং ম্যানেজার";
    case "ADVERTISER": return "বিজ্ঞাপনদাতা";
    case "SUPPORT_AGENT": return "সাপোর্ট এজেন্ট";
    case "ANALYST": return "অ্যানালিস্ট";
    case "VIEWER": return "দর্শক (VIEWER)";
    default: return role ?? "—";
  }
}

/**
 * Client-side mirror of the API totals rule: sum ONLY the
 * listed cards; a null summary contributes 0 and is counted in
 * summariesFailed. Used to cross-check/render — the API totals
 * remain the authority.
 */
export function sumSummaries(orgs: AgencyOrgCard[]): AgencyTotals {
  let ordersToday = 0;
  let ordersMonth = 0;
  let pendingOrders = 0;
  let unreadInbox = 0;
  let summariesFailed = 0;
  let revenueToday = 0n;
  let revenueMonth = 0n;
  for (const card of orgs) {
    if (!card.summary) { summariesFailed++; continue; }
    ordersToday += card.summary.ordersToday;
    ordersMonth += card.summary.ordersMonth;
    pendingOrders += card.summary.pendingOrders;
    unreadInbox += card.summary.unreadInbox;
    try { revenueToday += BigInt(card.summary.revenueTodayMinor); } catch { /* malformed stays 0 */ }
    try { revenueMonth += BigInt(card.summary.revenueMonthMinor); } catch { /* malformed stays 0 */ }
  }
  return {
    orgCount: orgs.length,
    ordersToday,
    revenueTodayMinor: revenueToday.toString(),
    ordersMonth,
    revenueMonthMinor: revenueMonth.toString(),
    pendingOrders,
    unreadInbox,
    summariesFailed,
  };
}

/** BDT major text ("1500" / "1500.50") → minor-unit string, or
 * null when invalid / not positive (the API re-validates). */
export function bdtToMinor(v: string): string | null {
  const s = String(v ?? "").trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const minor = BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
  return minor > 0n ? minor.toString() : null;
}

/** Agency-org choices for the commission form: only orgs where
 * the caller is OWNER/ADMIN (the API's commission gate). */
export function agencyOrgChoices(orgs: AgencyOrgCard[]): AgencyOrgCard[] {
  return orgs.filter((o) => o.myRole === "OWNER" || o.myRole === "ADMIN");
}

/** Client-org choices: the caller's OTHER membership orgs —
 * never the selected agency org itself. */
export function clientOrgChoices(orgs: AgencyOrgCard[], agencyOrgId: string): AgencyOrgCard[] {
  return orgs.filter((o) => o.organization.id !== agencyOrgId);
}
