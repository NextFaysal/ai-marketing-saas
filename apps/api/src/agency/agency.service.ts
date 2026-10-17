import { BadRequestException, ForbiddenException, Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { AnalyticsService } from "../analytics/analytics.service";
import type { CreateOrganizationDto } from "../organizations/organizations.dto";
import type { CreateAgencyCommissionDto } from "./agency.dto";

/**
 * NF15 (FB5) — Agency / reseller console.
 *
 * DEPENDENCY RULE (binding): ORG14 (cross-org team view) was
 * NEVER built — owner decision D2 in the ORG package is still
 * open. This service is built ONLY on what exists: the signed-in
 * user's own ACTIVE memberships, exactly as returned by
 * OrganizationsService.listMine. There is no agency entity and
 * no cross-org query that bypasses per-org membership: every
 * per-org number below is computed through that org's normal
 * tenant-scoped paths (AnalyticsService.overview — the same
 * service the dashboard home calls — plus tenant-scoped counts
 * filtered by organizationId), for orgs the caller is a member
 * of, and for no others.
 *
 * PENDING STATUS (verified in code): "pending" is a real member
 * of the order status vocabulary — it is a key of
 * ORDER_TRANSITIONS in orders.service.ts (pending | on-hold |
 * processing → …) and the WooCommerce-style raw status the Order
 * model documents. pendingOrders therefore counts orders whose
 * status is exactly "pending".
 *
 * COMMISSIONS ARE RECORDS ONLY: AgencyCommissionEntry rows are a
 * ledger of what the agency recorded — creating one moves NO
 * money, touches NO wallet table, and executes NO payout.
 * Payouts remain behind the OU11 legal gate. Every commission
 * payload carries the literal `recordsOnly: true`.
 */

export const PENDING_ORDER_STATUS = "pending";

export const AGENCY_COMMISSION_RECORDS_NOTE_BN =
  "কমিশন এখানে শুধু রেকর্ড হিসেবে রাখা হয় — কোনো টাকা স্বয়ংক্রিয়ভাবে কাটা বা পাঠানো হয় না। পেআউট OU11 আইনি গেটের অধীনে বন্ধ আছে।";

export const AGENCY_SUMMARY_ERROR_BN = "তথ্য লোড হয়নি";

/** YYYY-MM-DD (UTC, the dashboard home's own `f()` semantics:
 * `d.toISOString().slice(0, 10)`) ranges for today + this month.
 * AnalyticsService.overview(from, to) treats `to` as that day's
 * start and extends it by one day, so from == to == today is
 * exactly today, and [month-start, today] is month-to-date. */
export function agencyDateRanges(now: Date = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 8)}01`;
  return {
    todayFrom: today,
    todayTo: today,
    monthFrom: monthStart,
    monthTo: today,
  };
}

export interface AgencyOrgSummary {
  ordersToday: number;
  revenueTodayMinor: string;
  ordersMonth: number;
  revenueMonthMinor: string;
  pendingOrders: number;
  unreadInbox: number;
}

@Injectable()
export class AgencyConsoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgs: OrganizationsService,
    private readonly analytics: AnalyticsService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  /** One org's card summary, through that org's normal
   * tenant-scoped paths only. Throws on failure — the console
   * caller isolates per org. */
  async orgSummary(organizationId: string): Promise<AgencyOrgSummary> {
    const ranges = agencyDateRanges();
    const [today, month, pendingOrders, conversations] = await Promise.all([
      this.analytics.overview(organizationId, ranges.todayFrom, ranges.todayTo),
      this.analytics.overview(organizationId, ranges.monthFrom, ranges.monthTo),
      (this.prisma as any).order.count({
        where: { organizationId, status: PENDING_ORDER_STATUS },
      }),
      (this.prisma as any).channelConversation.findMany({
        where: { organizationId },
        select: { unreadCount: true },
      }),
    ]);
    const unreadInbox = (conversations as any[]).reduce(
      (sum, c) => sum + (Number(c?.unreadCount) || 0),
      0,
    );
    return {
      ordersToday: Number(today?.totals?.orders ?? 0),
      revenueTodayMinor: BigInt(today?.totals?.revenueMinor ?? 0).toString(),
      ordersMonth: Number(month?.totals?.orders ?? 0),
      revenueMonthMinor: BigInt(month?.totals?.revenueMinor ?? 0).toString(),
      pendingOrders: Number(pendingOrders ?? 0),
      unreadInbox,
    };
  }

  /**
   * GET /agency/console — the caller's own memberships only.
   * Per-org failure isolation: one org's summary throwing yields
   * that card with summary:null + an honest error label; the
   * rest still return, and totals sum ONLY the intact cards.
   */
  async getConsole(userId: string) {
    const memberships = await this.orgs.listMine(userId);
    const orgs: any[] = [];
    let summariesFailed = 0;
    let ordersToday = 0;
    let ordersMonth = 0;
    let pendingOrders = 0;
    let unreadInbox = 0;
    let revenueToday = 0n;
    let revenueMonth = 0n;

    for (const org of memberships as any[]) {
      const organizationId = String(org.id);
      let summary: AgencyOrgSummary | null = null;
      let error: string | null = null;
      try {
        summary = await this.orgSummary(organizationId);
      } catch {
        error = AGENCY_SUMMARY_ERROR_BN;
        summariesFailed++;
      }
      if (summary) {
        ordersToday += summary.ordersToday;
        ordersMonth += summary.ordersMonth;
        pendingOrders += summary.pendingOrders;
        unreadInbox += summary.unreadInbox;
        revenueToday += BigInt(summary.revenueTodayMinor);
        revenueMonth += BigInt(summary.revenueMonthMinor);
      }
      orgs.push({
        organization: org,
        myRole: org.myRole ?? null,
        summary,
        error,
      });
    }

    return {
      orgs,
      totals: {
        orgCount: orgs.length,
        ordersToday,
        revenueTodayMinor: revenueToday.toString(),
        ordersMonth,
        revenueMonthMinor: revenueMonth.toString(),
        pendingOrders,
        unreadInbox,
        summariesFailed,
      },
    };
  }

  /**
   * POST /agency/client-orgs — delegates EXACTLY to
   * OrganizationsService.create: slug governance (TD1) and the
   * ORG12 per-user owned-org cap inside create() apply unchanged,
   * its refusals propagate unchanged, and the caller lands OWNER
   * (the existing create() rule).
   */
  async createClientOrg(userId: string, dto: CreateOrganizationDto, ip?: string) {
    return this.orgs.create(userId, dto, ip);
  }

  private commissionView(entry: any, clientNameById: Map<string, string>) {
    return {
      id: entry.id,
      agencyOrganizationId: entry.agencyOrganizationId,
      clientOrganizationId: entry.clientOrganizationId,
      // The client org's name is resolved ONLY from orgs the
      // caller is a member of. An entry whose client org the
      // caller no longer belongs to shows the id with name null —
      // never another tenant's data beyond what the entry holds.
      clientOrganizationName: clientNameById.get(entry.clientOrganizationId) ?? null,
      periodLabel: entry.periodLabel,
      amountMinor: BigInt(entry.amountMinor ?? 0).toString(),
      note: entry.note ?? null,
      recordedById: entry.recordedById,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      recordsOnly: true as const,
    };
  }

  /** The caller's own membership org names (listMine is the
   * single source of truth for "orgs I belong to"). */
  private async myOrgNames(userId: string): Promise<Map<string, string>> {
    const mine = await this.orgs.listMine(userId);
    return new Map((mine as any[]).map((o) => [String(o.id), String(o.name ?? "")]));
  }

  async listCommissions(agencyOrganizationId: string, userId: string) {
    const entries = await (this.prisma as any).agencyCommissionEntry.findMany({
      where: { agencyOrganizationId },
      orderBy: { createdAt: "desc" },
    });
    const names = await this.myOrgNames(userId);
    return (entries as any[]).map((e) => this.commissionView(e, names));
  }

  async createCommission(
    agencyOrganizationId: string,
    userId: string,
    dto: CreateAgencyCommissionDto,
    ip?: string,
  ) {
    const periodLabel = String(dto?.periodLabel ?? "").trim();
    if (!periodLabel) {
      throw new BadRequestException("সময়ের লেবেল (period) আবশ্যক — যেমন “অক্টোবর ২০২৬”।");
    }
    if (periodLabel.length > 40) {
      throw new BadRequestException("সময়ের লেবেল সর্বোচ্চ ৪০ অক্ষরের হতে পারবে।");
    }
    let amount: bigint;
    try {
      amount = BigInt(String(dto?.amountMinor ?? "").trim());
    } catch {
      throw new BadRequestException("কমিশনের পরিমাণ সঠিক সংখ্যা নয়।");
    }
    if (amount <= 0n) {
      throw new BadRequestException("কমিশনের পরিমাণ শূন্যের বেশি হতে হবে।");
    }
    const clientOrganizationId = String(dto?.clientOrganizationId ?? "").trim();
    if (!clientOrganizationId) {
      throw new BadRequestException("ক্লায়েন্ট প্রতিষ্ঠান বেছে নিন।");
    }
    if (clientOrganizationId === agencyOrganizationId) {
      throw new BadRequestException("এজেন্সি প্রতিষ্ঠান নিজেই ক্লায়েন্ট হতে পারে না।");
    }
    // An agency records commission only for client orgs they
    // actually belong to in v1 — membership is proven through
    // the caller's own listMine, never by trusting the id.
    const names = await this.myOrgNames(userId);
    if (!names.has(clientOrganizationId)) {
      throw new ForbiddenException("আপনি এই ক্লায়েন্ট প্রতিষ্ঠানের সদস্য নন — কমিশন রেকর্ড করা যাবে না।");
    }
    const note = String(dto?.note ?? "").trim() || null;
    const entry = await (this.prisma as any).agencyCommissionEntry.create({
      data: {
        agencyOrganizationId,
        clientOrganizationId,
        periodLabel,
        amountMinor: amount,
        note,
        recordedById: userId,
      },
    });
    await this.audit?.log({
      organizationId: agencyOrganizationId,
      userId,
      action: "agency.commission_recorded",
      entityType: "AgencyCommissionEntry",
      entityId: entry.id,
      metadata: { clientOrganizationId, periodLabel, amountMinor: amount.toString(), recordsOnly: true },
      ipAddress: ip,
    }).catch(() => undefined);
    return this.commissionView(entry, names);
  }
}
