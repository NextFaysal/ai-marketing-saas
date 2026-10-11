import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { effectiveAccess } from "../common/permission-catalog";
import { isWithinSchedule } from "../inbox/working-hours";

/**
 * CRM C5 — Lead Auto-Assignment.
 *
 * An org-level strategy decides who owns a NEW lead when the
 * caller did not name an owner:
 *   off              — pre-C5 behaviour, zero change: through
 *                      LeadsService.create the creator owns the
 *                      lead; the actor-less ingestion paths
 *                      (Meta leadgen, first-message, webchat)
 *                      leave it unassigned.
 *   round_robin      — rotate through the eligible members in a
 *                      stable order; the cursor (the member who
 *                      received the last auto-assignment) is
 *                      persisted on the CrmSetting row and
 *                      advances ONLY on an actual auto-assignment.
 *   least_open_leads — the eligible member with the fewest leads
 *                      in open stages (stage not won/lost,
 *                      non-merged) right now; ties break by the
 *                      same stable order.
 *
 * ELIGIBILITY (exactly the M72 rule, no parallel invention): an
 * ACTIVE membership whose effective access for the "customers"
 * permission area — the area LeadsController is tagged with,
 * "গ্রাহক ও লিড" — is allowed, computed by the same
 * effectiveAccess() helper RolesGuard enforces (role baseline,
 * per-member grants/denies on top; the OWNER is always allowed;
 * a DENY blocks even a passing role). Suspended/invited members
 * are never eligible. An explicitly supplied owner ALWAYS wins
 * and never moves the cursor.
 *
 * WORKING HOURS (M68): members with an AgentSchedule who are
 * currently off-shift are skipped WHEN at least one eligible
 * member is on-shift (a member with no schedule row counts as
 * always on-shift — the M68 convention). If NOBODY is on-shift,
 * the full eligible set is used: a lead must not get stuck
 * unassigned at night just because every schedule says off.
 * (This fallback deliberately differs from the inbox
 * conversation engine, which leaves the conversation unassigned
 * for the sweep to pick up later; a lead has no such sweep.)
 *
 * If the eligible set is EMPTY, no assignment happens — the
 * lead stays unassigned rather than landing on an ineligible
 * or suspended user.
 */

export const LEAD_ASSIGN_STRATEGIES = ["off", "round_robin", "least_open_leads"] as const;
export type LeadAssignStrategy = (typeof LEAD_ASSIGN_STRATEGIES)[number];

/** The M72 permission area covering leads (see LeadsController). */
export const LEAD_PERMISSION_AREA = "customers";

export interface LeadAssignSettingView {
  leadAssignStrategy: LeadAssignStrategy;
  rrCursorUserId: string | null;
}

export type AutoAssignOutcome =
  | { kind: "off" }
  | { kind: "none" }
  | { kind: "picked"; userId: string; strategy: Exclude<LeadAssignStrategy, "off"> };

const STRATEGY_LABEL: Record<string, string> = {
  round_robin: "পালাক্রমে (Round Robin)",
  least_open_leads: "সবচেয়ে কম খোলা Lead (Least Open Leads)",
};

@Injectable()
export class LeadAssignmentService {
  constructor(private readonly prisma: PrismaService) {}

  /** The org's setting; a missing row (or an unavailable table,
   * e.g. a partial test fake) reads as the default: off. */
  async getSetting(organizationId: string): Promise<LeadAssignSettingView> {
    try {
      const row = await (this.prisma as any).crmSetting?.findUnique({ where: { organizationId } });
      const strategy = (LEAD_ASSIGN_STRATEGIES as readonly string[]).includes(row?.leadAssignStrategy)
        ? (row.leadAssignStrategy as LeadAssignStrategy)
        : "off";
      return { leadAssignStrategy: strategy, rrCursorUserId: row?.rrCursorUserId ?? null };
    } catch {
      return { leadAssignStrategy: "off", rrCursorUserId: null };
    }
  }

  async updateSetting(organizationId: string, strategy: string): Promise<LeadAssignSettingView> {
    if (!(LEAD_ASSIGN_STRATEGIES as readonly string[]).includes(strategy)) {
      throw new BadRequestException("leadAssignStrategy must be off | round_robin | least_open_leads");
    }
    const p = this.prisma as any;
    const existing = await p.crmSetting.findUnique({ where: { organizationId } }).catch(() => null);
    if (existing) {
      await p.crmSetting.update({ where: { organizationId }, data: { leadAssignStrategy: strategy } });
    } else {
      await p.crmSetting.create({ data: { organizationId, leadAssignStrategy: strategy } });
    }
    return this.getSetting(organizationId);
  }

  /**
   * Eligible members in the STABLE order used by both strategies:
   * membership createdAt ascending, ties broken by userId so the
   * order never depends on database return order.
   */
  async eligibleMembers(organizationId: string): Promise<{ userId: string; role: string }[]> {
    const memberships = await (this.prisma as any).membership.findMany({
      where: { organizationId, status: "ACTIVE" }, take: 200,
    }).catch(() => []);
    const sorted = [...(memberships as any[])].sort((a, b) => {
      const dt = new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();
      return dt !== 0 ? dt : String(a.userId).localeCompare(String(b.userId));
    });
    return sorted
      .filter((m) => effectiveAccess(m.role, m.permissionOverrides)
        .some((e) => e.key === LEAD_PERMISSION_AREA && e.allowed))
      .map((m) => ({ userId: m.userId as string, role: m.role as string }));
  }

  /** M68 shift preference with the documented night fallback. */
  private async shiftPreferred(
    organizationId: string,
    eligible: { userId: string }[],
    now: Date,
  ): Promise<{ userId: string }[]> {
    if (!eligible.length) return eligible;
    const schedules = await (this.prisma as any).agentSchedule?.findMany({
      where: { organizationId, userId: { in: eligible.map((m) => m.userId) } },
    }).catch(() => []) ?? [];
    if (!(schedules as any[]).length) return eligible;
    const schedOf = new Map((schedules as any[]).map((s) => [s.userId, s]));
    const onShift = eligible.filter((m) => {
      const s = schedOf.get(m.userId);
      return !s || isWithinSchedule(s as any, now);
    });
    return onShift.length ? onShift : eligible;
  }

  /** Open-lead counts (stage not won/lost, non-merged) per user. */
  private async openLeadCounts(organizationId: string, userIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>(userIds.map((id) => [id, 0]));
    if (!userIds.length) return counts;
    const rows = await (this.prisma as any).lead.findMany({
      where: {
        organizationId, ownerUserId: { in: userIds },
        stage: { notIn: ["won", "lost"] }, mergedIntoId: null,
      },
      select: { ownerUserId: true }, take: 10000,
    }).catch(() => []);
    for (const r of rows as any[]) {
      if (r.ownerUserId) counts.set(r.ownerUserId, (counts.get(r.ownerUserId) ?? 0) + 1);
    }
    return counts;
  }

  private async persistCursor(organizationId: string, strategy: LeadAssignStrategy, userId: string) {
    const p = this.prisma as any;
    const existing = await p.crmSetting.findUnique({ where: { organizationId } }).catch(() => null);
    if (existing) await p.crmSetting.update({ where: { organizationId }, data: { rrCursorUserId: userId } });
    else await p.crmSetting.create({ data: { organizationId, leadAssignStrategy: strategy, rrCursorUserId: userId } });
  }

  /**
   * Decide the auto-assignee for a new lead. Pure decision +
   * cursor persistence for round_robin; does NOT touch the lead.
   */
  async resolveAutoAssignment(organizationId: string, now = new Date()): Promise<AutoAssignOutcome> {
    const setting = await this.getSetting(organizationId);
    if (setting.leadAssignStrategy === "off") return { kind: "off" };
    const eligible = await this.eligibleMembers(organizationId);
    if (!eligible.length) return { kind: "none" };
    const pool = await this.shiftPreferred(organizationId, eligible, now);
    if (setting.leadAssignStrategy === "round_robin") {
      const idx = pool.findIndex((m) => m.userId === setting.rrCursorUserId);
      const chosen = pool[(idx + 1) % pool.length];
      await this.persistCursor(organizationId, setting.leadAssignStrategy, chosen.userId);
      return { kind: "picked", userId: chosen.userId, strategy: "round_robin" };
    }
    const counts = await this.openLeadCounts(organizationId, pool.map((m) => m.userId));
    let chosen = pool[0];
    for (const m of pool) {
      if ((counts.get(m.userId) ?? 0) < (counts.get(chosen.userId) ?? 0)) chosen = m;
    }
    return { kind: "picked", userId: chosen.userId, strategy: "least_open_leads" };
  }

  /**
   * Apply the org's strategy to an EXISTING lead row (the
   * ingestion paths create the row themselves): on "picked" the
   * owner is written and a LeadActivity of type "assigned"
   * (system actor) records the rule that chose them; on "none"
   * the lead is explicitly left ownerless; on "off" nothing
   * changes at all.
   */
  async assignNewLead(organizationId: string, leadId: string, now = new Date()): Promise<AutoAssignOutcome> {
    const outcome = await this.resolveAutoAssignment(organizationId, now);
    if (outcome.kind === "off") return outcome;
    const p = this.prisma as any;
    if (outcome.kind === "none") {
      await p.lead.update({ where: { id: leadId }, data: { ownerUserId: null } }).catch(() => undefined);
      return outcome;
    }
    await p.lead.update({ where: { id: leadId }, data: { ownerUserId: outcome.userId } });
    const user = await p.user?.findUnique({ where: { id: outcome.userId } }).catch(() => null);
    const who = user?.name ?? user?.email ?? "সদস্য";
    await p.leadActivity.create({
      data: {
        leadId, userId: null, type: "assigned",
        content: `সিস্টেম: Lead-টি স্বয়ংক্রিয়ভাবে ${who}-কে অ্যাসাইন করা হয়েছে (নিয়ম: ${STRATEGY_LABEL[outcome.strategy] ?? outcome.strategy})।`,
      },
    }).catch(() => undefined);
    return outcome;
  }
}
