import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { killSwitches, platformSetting } from "../common/platform-settings";

const DAY_MS = 86_400_000;

/**
 * SA-B24 (Smart AI Phase 6, plan T3: AI Oversight) — the
 * SUPER admin's cross-org AI health board + the kill-switch
 * write path (global pause + per-org disable flips).
 *
 * THE BOARD'S HONESTY RULES (the SA-B23 line, held):
 *  - Every number is aggregated from REAL rows in the stated
 *    window (proposal / usage / answer / learned-item rows).
 *    Nothing is estimated and nothing is carried over from a
 *    different table's semantics: where a table cannot answer
 *    a question exactly (AiStoredAnswer has no per-hit
 *    timestamp log — hitCount is cumulative and lastHitAt is
 *    per-row), the board says so in the field's own name
 *    (`totalHitsAllTime`, `distinctAnswersHitInWindow`)
 *    instead of dressing an approximation up as a windowed
 *    count.
 *  - FAILED proposals are counted on their terminal stamp:
 *    a failed row's updatedAt is when it failed (failed is a
 *    terminal engine state; nothing updates the row after),
 *    and the failure `error` strings are passed through
 *    VERBATIM from the rows — verification_mismatch and
 *    platform errors read exactly as the engine recorded them.
 *  - Counts and identity only. The drill list names orgs
 *    (id/name/slug — the same identity the SA-B23 view
 *    exposes) with their counts; tenant CONTENTS stay behind
 *    SA-B23's audited per-org view, which remains the only
 *    door to them.
 *  - An empty platform is zeros, never an error. Every read
 *    degrades defensively (the platform-settings precedent):
 *    a missing delegate yields its empty value.
 *
 * THE KILL SWITCH (Item 2): the flags live in the EXISTING
 * SystemSetting "killSwitches" row — the same row the
 * per-org list and broadcastsPaused have always lived in, so
 * there is exactly one switchboard and no migration. The
 * read path every enforcement point consults is the one
 * helper (common/platform-settings killSwitches() +
 * isAiDisabledForOrg()); this service is the admin WRITE
 * path: read-modify-write preserving every sibling field,
 * a non-empty `reason` required for EVERY flip in BOTH
 * directions (an unexplained resume is how a pause gets
 * silently lifted), and an audit row per flip carrying the
 * reason verbatim.
 */
@Injectable()
export class AdminOversightService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private db(): any {
    return this.prisma as any;
  }

  /** Defensive reads (platform-settings precedent): a partial
   * fake or a not-yet-migrated table degrades to the empty
   * value instead of 500ing the board. */
  private async rows<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      const out = await fn();
      return out ?? fallback;
    } catch {
      return fallback;
    }
  }

  // ---------------- the board ----------------

  async board(daysRaw?: string | number | null) {
    const days = daysRaw === undefined || daysRaw === null || daysRaw === "" ? 7 : Number(daysRaw);
    if (days !== 7 && days !== 30) throw new BadRequestException("days must be 7 or 30");
    const now = new Date();
    const since = new Date(now.getTime() - days * DAY_MS);
    const p = this.db();

    // ---- proposals (engine rows only: actionId present;
    // legacy Milestone-47 rows carry none and are reported
    // as their own labelled count, never blended in) ----
    const filed = await this.rows<any[]>(() => p.aIActionProposal.findMany({ where: { actionId: { not: null }, createdAt: { gte: since } } }), []);
    const failedRows = await this.rows<any[]>(() => p.aIActionProposal.findMany({ where: { actionId: { not: null }, status: "failed", updatedAt: { gte: since } } }), []);
    const executedInWindow = await this.rows<number>(() => p.aIActionProposal.count({ where: { actionId: { not: null }, executedAt: { gte: since } } }), 0);
    const legacyFiledInWindow = await this.rows<number>(() => p.aIActionProposal.count({ where: { actionId: null, createdAt: { gte: since } } }), 0);
    const pendingProposalRows = await this.rows<any[]>(() => p.aIActionProposal.findMany({ where: { actionId: { not: null }, status: "proposed" }, select: { organizationId: true } }), []);

    const byStatus: Record<string, number> = {};
    const byAction: Record<string, { filed: number; executed: number; failed: number; pending: number }> = {};
    for (const r of filed) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      const a = (byAction[r.actionId] ??= { filed: 0, executed: 0, failed: 0, pending: 0 });
      a.filed += 1;
      if (r.status === "executed") a.executed += 1;
      else if (r.status === "failed") a.failed += 1;
      else if (r.status === "proposed") a.pending += 1;
    }
    const failureReasonCounts = new Map<string, number>();
    for (const r of failedRows) {
      const reason = typeof r.error === "string" && r.error ? r.error : "unknown";
      failureReasonCounts.set(reason, (failureReasonCounts.get(reason) ?? 0) + 1);
    }
    const failureReasons = [...failureReasonCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
      .slice(0, 10);

    // ---- LLM usage (AIUsageRecord: one row per recorded
    // call; `feature` is the bucket each surface writes) ----
    const usage = await this.rows<any[]>(() => p.aIUsageRecord.findMany({ where: { createdAt: { gte: since } } }), []);
    const byFeatureMap = new Map<string, { feature: string; calls: number; inputTokens: number; outputTokens: number; totalTokens: number; estimatedCalls: number }>();
    const byOrgUsage = new Map<string, { organizationId: string; calls: number; totalTokens: number }>();
    const usageTotals = { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCalls: 0 };
    for (const r of usage) {
      const input = Number(r.inputTokens ?? 0) || 0;
      const output = Number(r.outputTokens ?? 0) || 0;
      const f = (byFeatureMap.get(r.feature) ?? { feature: r.feature, calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCalls: 0 });
      f.calls += 1; f.inputTokens += input; f.outputTokens += output; f.totalTokens += input + output;
      if (r.estimated) f.estimatedCalls += 1;
      byFeatureMap.set(r.feature, f);
      const o = (byOrgUsage.get(r.organizationId) ?? { organizationId: r.organizationId, calls: 0, totalTokens: 0 });
      o.calls += 1; o.totalTokens += input + output;
      byOrgUsage.set(r.organizationId, o);
      usageTotals.calls += 1; usageTotals.inputTokens += input; usageTotals.outputTokens += output; usageTotals.totalTokens += input + output;
      if (r.estimated) usageTotals.estimatedCalls += 1;
    }
    const byFeature = [...byFeatureMap.values()].sort((a, b) => b.totalTokens - a.totalTokens || a.feature.localeCompare(b.feature));
    const topOrgsByUsage = [...byOrgUsage.values()].sort((a, b) => b.totalTokens - a.totalTokens || b.calls - a.calls).slice(0, 10);

    // ---- stored answers ----
    const answersActive = await this.rows<number>(() => p.aiStoredAnswer.count({ where: { status: "active" } }), 0);
    const answersInvalidated = await this.rows<number>(() => p.aiStoredAnswer.count({ where: { status: "invalidated" } }), 0);
    const answersDisabled = await this.rows<number>(() => p.aiStoredAnswer.count({ where: { status: "disabled" } }), 0);
    const hitRows = await this.rows<any[]>(() => p.aiStoredAnswer.findMany({ select: { hitCount: true } }), []);
    const totalHitsAllTime = hitRows.reduce((sum, r) => sum + (Number(r.hitCount ?? 0) || 0), 0);
    const distinctAnswersHitInWindow = await this.rows<number>(() => p.aiStoredAnswer.count({ where: { lastHitAt: { gte: since } } }), 0);
    const invalidatedInWindow = await this.rows<number>(() => p.aiStoredAnswer.count({ where: { status: "invalidated", updatedAt: { gte: since } } }), 0);

    // ---- learned items ----
    const suggestedRows = await this.rows<any[]>(() => p.learnedItem.findMany({ where: { status: "suggested" }, select: { sourceType: true, organizationId: true } }), []);
    const pendingBySource: Record<string, number> = {};
    const orgsWithPendingLearning = new Set<string>();
    for (const r of suggestedRows) {
      pendingBySource[r.sourceType] = (pendingBySource[r.sourceType] ?? 0) + 1;
      orgsWithPendingLearning.add(r.organizationId);
    }
    const decidedRows = await this.rows<any[]>(() => p.learnedItem.findMany({ where: { reviewedAt: { gte: since } }, select: { status: true, reviewedVia: true } }), []);
    const decidedInWindow = { approved: 0, rejected: 0, viaAdminConsole: 0 };
    for (const r of decidedRows) {
      if (r.status === "approved") decidedInWindow.approved += 1;
      else if (r.status === "rejected") decidedInWindow.rejected += 1;
      if (r.reviewedVia === "admin_console") decidedInWindow.viaAdminConsole += 1;
    }

    // ---- orgs: active vs silent (active = at least one
    // AIUsageRecord row in the window; the only per-org AI
    // activity ledger every surface writes to) ----
    const totalOrgs = await this.rows<number>(() => p.organization.count(), 0);
    const orgsWithPendingProposals = new Set(pendingProposalRows.map((r) => r.organizationId));

    // ---- drill: per-org counts only (failed executions in
    // window, usage in window, proposals pending NOW) ----
    const drillMap = new Map<string, { organizationId: string; failedExecutions: number; usageCalls: number; usageTokens: number; pendingProposals: number }>();
    const drillRow = (orgId: string) => drillMap.get(orgId) ?? { organizationId: orgId, failedExecutions: 0, usageCalls: 0, usageTokens: 0, pendingProposals: 0 };
    for (const r of failedRows) { const d = drillRow(r.organizationId); d.failedExecutions += 1; drillMap.set(r.organizationId, d); }
    for (const [orgId, o] of byOrgUsage) { const d = drillRow(orgId); d.usageCalls = o.calls; d.usageTokens = o.totalTokens; drillMap.set(orgId, d); }
    for (const r of pendingProposalRows) { const d = drillRow(r.organizationId); d.pendingProposals += 1; drillMap.set(r.organizationId, d); }
    const drillIds = [...drillMap.keys()];
    const drillOrgs = drillIds.length
      ? await this.rows<any[]>(() => p.organization.findMany({ where: { id: { in: drillIds } }, select: { id: true, name: true, slug: true } }), [])
      : [];
    const orgIdentity = new Map(drillOrgs.map((o: any) => [o.id, o]));
    const drill = [...drillMap.values()]
      .sort((a, b) => b.failedExecutions - a.failedExecutions || b.usageTokens - a.usageTokens || a.organizationId.localeCompare(b.organizationId))
      .slice(0, 20)
      .map((d) => ({ ...d, name: orgIdentity.get(d.organizationId)?.name ?? null, slug: orgIdentity.get(d.organizationId)?.slug ?? null }));

    const ks = await killSwitches(this.db());

    return {
      windowDays: days,
      since: since.toISOString(),
      generatedAt: now.toISOString(),
      proposals: {
        filedInWindow: filed.length,
        byStatus,
        byAction,
        executedInWindow,
        failedInWindow: failedRows.length,
        failureReasons,
        pendingNow: pendingProposalRows.length,
        legacyFiledInWindow,
      },
      usage: { totals: usageTotals, byFeature, topOrgsByUsage, activeOrgs: byOrgUsage.size },
      answers: {
        active: answersActive,
        invalidated: answersInvalidated,
        disabled: answersDisabled,
        totalHitsAllTime,
        distinctAnswersHitInWindow,
        invalidatedInWindow,
      },
      learning: {
        pendingNow: suggestedRows.length,
        pendingBySource,
        orgsWithPending: orgsWithPendingLearning.size,
        decidedInWindow,
      },
      orgs: {
        total: totalOrgs,
        activeInWindow: byOrgUsage.size,
        silentInWindow: Math.max(0, totalOrgs - byOrgUsage.size),
        withPendingProposals: orgsWithPendingProposals.size,
        withPendingLearning: orgsWithPendingLearning.size,
      },
      drill,
      killSwitch: {
        globallyPaused: ks.aiGloballyPaused,
        globalPause: ks.aiGlobalPause,
        broadcastsPaused: ks.broadcastsPaused,
        disabledOrgIds: ks.aiDisabledOrgIds,
        orgPauseMeta: ks.aiOrgPauseMeta,
      },
    };
  }

  // ---------------- the kill switch ----------------

  async getKillSwitch() {
    const ks = await killSwitches(this.db());
    const ids = ks.aiDisabledOrgIds;
    const orgRows = ids.length
      ? await this.rows<any[]>(() => this.db().organization.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, slug: true } }), [])
      : [];
    const identity = new Map(orgRows.map((o: any) => [o.id, o]));
    return {
      globallyPaused: ks.aiGloballyPaused,
      globalPause: ks.aiGlobalPause,
      broadcastsPaused: ks.broadcastsPaused,
      disabledOrgs: ids.map((organizationId) => {
        const meta = ks.aiOrgPauseMeta[organizationId];
        return {
          organizationId,
          name: identity.get(organizationId)?.name ?? null,
          slug: identity.get(organizationId)?.slug ?? null,
          reason: meta?.reason ?? null,
          byId: meta?.byId ?? null,
          at: meta?.at ?? null,
        };
      }),
    };
  }

  /** The reason gate (SA-B23 pattern) — runs before anything
   * else in every flip: trimmed-empty is a 400 with zero
   * state change and zero audit rows. */
  private requireReason(reason: unknown): string {
    const r = String(reason ?? "").trim();
    if (!r) {
      throw new BadRequestException(
        "A reason is required for every kill-switch flip — it is recorded verbatim in the audit trail.",
      );
    }
    if (r.length > 500) throw new BadRequestException("reason is too long (max 500)");
    return r;
  }

  /** Read-modify-write of the ONE killSwitches row,
   * preserving every sibling field (including fields this
   * service does not know about), with the house defaults
   * filled for the legacy fields. */
  private async writeKillSwitches(actorId: string | null, mutate: (current: any) => any) {
    const currentRaw = (await platformSetting(this.db(), "killSwitches")) as any;
    const current = currentRaw && typeof currentRaw === "object" ? currentRaw : {};
    const next = mutate({
      ...current,
      aiDisabledOrgIds: Array.isArray(current.aiDisabledOrgIds) ? current.aiDisabledOrgIds.map(String) : [],
      broadcastsPaused: current.broadcastsPaused === true,
      aiGloballyPaused: current.aiGloballyPaused === true,
      aiGlobalPause: current.aiGlobalPause ?? null,
      aiOrgPauseMeta: current.aiOrgPauseMeta && typeof current.aiOrgPauseMeta === "object" ? current.aiOrgPauseMeta : {},
    });
    await this.db().systemSetting.upsert({
      where: { key: "killSwitches" },
      create: { key: "killSwitches", value: next, updatedById: actorId ?? undefined },
      update: { value: next, updatedById: actorId ?? undefined },
    });
    return next;
  }

  async setGlobalPause(actor: any, pausedRaw: unknown, reasonRaw: unknown, ip?: string) {
    const reason = this.requireReason(reasonRaw);
    if (typeof pausedRaw !== "boolean") throw new BadRequestException("paused must be a boolean");
    const paused = pausedRaw;
    const at = new Date().toISOString();
    await this.writeKillSwitches(actor?.id ?? null, (current) => ({
      ...current,
      aiGloballyPaused: paused,
      aiGlobalPause: { paused, reason, byId: actor?.id ?? null, at },
    }));
    await this.audit.log({
      userId: actor?.id ?? undefined,
      action: paused ? "admin.ai_kill_switch_global_pause" : "admin.ai_kill_switch_global_resume",
      entityType: "SystemSetting",
      entityId: "killSwitches",
      metadata: { reason, paused },
      ipAddress: ip,
    });
    return this.getKillSwitch();
  }

  async setOrgDisabled(actor: any, organizationId: string, disabledRaw: unknown, reasonRaw: unknown, ip?: string) {
    const reason = this.requireReason(reasonRaw);
    if (typeof disabledRaw !== "boolean") throw new BadRequestException("disabled must be a boolean");
    const disabled = disabledRaw;
    const org = await this.rows<any>(() => this.db().organization.findUnique({ where: { id: organizationId }, select: { id: true } }), null);
    if (!org) throw new NotFoundException("Organization not found");
    const at = new Date().toISOString();
    await this.writeKillSwitches(actor?.id ?? null, (current) => {
      const ids = new Set<string>(current.aiDisabledOrgIds);
      if (disabled) ids.add(organizationId);
      else ids.delete(organizationId);
      return {
        ...current,
        aiDisabledOrgIds: [...ids],
        aiOrgPauseMeta: {
          ...current.aiOrgPauseMeta,
          [organizationId]: { disabled, reason, byId: actor?.id ?? null, at },
        },
      };
    });
    await this.audit.log({
      organizationId,
      userId: actor?.id ?? undefined,
      action: disabled ? "admin.ai_kill_switch_org_disable" : "admin.ai_kill_switch_org_enable",
      entityType: "Organization",
      entityId: organizationId,
      metadata: { reason, disabled },
      ipAddress: ip,
    });
    return this.getKillSwitch();
  }
}
