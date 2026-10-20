import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../../audit/audit.service";
import { aiPauseReason, killSwitches } from "../../common/platform-settings";
import { ACTION_CATALOG, AUTONOMY_LEVELS, DEFAULT_AUTONOMY_LEVEL, catalogAction, type CatalogAction } from "./action-catalog";
import { ActionExecutorsService } from "./action-executors.service";
import { badRequest, notFound } from "../../i18n/api-exception";

export type ProposeResult =
  | { ok: true; proposal: any; autoExecuted: boolean; deduped?: boolean }
  | { ok: false; reason: "autonomy_off" | "action_not_wired"; message: string };

export type ExecuteResult =
  | { ok: true; proposal: any; noop?: boolean }
  | { ok: false; reason: "approval_required" | "proposal_rejected" | "money_adjacent_proposal_only" | "executor_not_registered" | "ai_paused"; message: string };

/**
 * SA-B10 (Smart AI Phase 2, W1) — the Action Engine.
 *
 * Lifecycle (on the EXTENDED AIActionProposal row, Milestone-47
 * precedent): propose → human approve/reject → execute →
 * verify. Every transition is claimed with a conditional
 * updateMany, so a proposal executes EXACTLY ONCE: a second
 * approve/execute observes a terminal (or already-claimed)
 * status and returns the recorded outcome instead of running
 * again.
 *
 * Law L5 is enforced here, structurally:
 *  - execution goes through the catalog's registered executor,
 *    which calls the EXISTING staff service path;
 *  - success is recorded only after the registered verifier
 *    re-reads the real state and agrees — a mismatch is a
 *    FAILED record with reason "verification_mismatch", never
 *    a success;
 *  - failures are recorded as failures, with the error verbatim;
 *  - money-adjacent (proposal-only) entries can be proposed and
 *    approved as a recorded decision, but execute() refuses
 *    them at every autonomy level;
 *  - every transition writes an AuditLog row (AuditService) and
 *    an AIAction row (the AI audit trail), like ProposalsService.
 *
 * Autonomy (plan D5): per-org per-action level from
 * AiAutonomySetting, absent = 1. Level 0 refuses propose();
 * level 1 requires a recorded human approval before execution;
 * level 2 auto-executes LOW-risk entries only (others behave
 * as level 1). Level 3 cannot be stored (setAutonomy rejects
 * it, with the rejection itself audit-logged).
 */
@Injectable()
export class ActionEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly executors: ActionExecutorsService,
  ) {}

  private p(): any {
    return this.prisma as any;
  }

  /** SA-B24 (T3): the kill-switch read for execution — the
   * ONE read path (common/platform-settings), consulted at
   * execute() and at runExecution()'s entry. The settings
   * read is itself defensive (a failure reads as "no
   * setting" = unpaused), so this never throws. */
  private async aiPaused(orgId: string): Promise<"ai_globally_paused" | "ai_disabled_for_org" | null> {
    const ks = await killSwitches(this.p()).catch(() => null);
    return aiPauseReason(ks, orgId);
  }

  private async logAiAction(orgId: string, userId: string | null, row: any, phase: string, status: string, error?: string) {
    await this.p().aIAction.create({
      data: {
        organizationId: orgId,
        userId: userId ?? null,
        conversationId: row.conversationId ?? null,
        toolName: `engine.${row.actionId}`,
        args: { proposalId: row.id, actionId: row.actionId, phase } as any,
        status,
        error: error ?? null,
      },
    }).catch(() => undefined);
  }

  private async getEngineProposalOrThrow(orgId: string, proposalId: string) {
    const row = await this.p().aIActionProposal.findFirst({
      where: { id: proposalId, organizationId: orgId, actionId: { not: null } },
    });
    if (!row) throw notFound("ai.actionProposalNotFound");
    return row;
  }

  // ---------------- autonomy ----------------

  async getAutonomyLevel(orgId: string, actionId: string): Promise<number> {
    const row = await this.p().aiAutonomySetting.findFirst({ where: { organizationId: orgId, actionId } });
    const level = Number(row?.level ?? DEFAULT_AUTONOMY_LEVEL);
    return (AUTONOMY_LEVELS as readonly number[]).includes(level) ? level : DEFAULT_AUTONOMY_LEVEL;
  }

  async listAutonomy(orgId: string) {
    const rows = await this.p().aiAutonomySetting.findMany({ where: { organizationId: orgId } });
    const byAction = new Map((rows as any[]).map((r) => [r.actionId, r]));
    return ACTION_CATALOG.map((entry) => {
      const setting = byAction.get(entry.id);
      return {
        actionId: entry.id,
        surface: entry.surface,
        title: entry.title,
        riskClass: entry.riskClass,
        moneyAdjacent: entry.moneyAdjacent,
        undoable: entry.undoable,
        wiring: entry.wiring,
        level: setting ? Number(setting.level) : DEFAULT_AUTONOMY_LEVEL,
        levelIsDefault: !setting,
        updatedById: setting?.updatedById ?? null,
        updatedAt: setting?.updatedAt ?? null,
      };
    });
  }

  async setAutonomy(orgId: string, actionId: string, level: unknown, actorId: string) {
    const entry = catalogAction(actionId);
    if (!entry) throw notFound("ai.unknownCatalogAction");
    if (level === 3) {
      // D5: level 3 needs a separate owner decision. The refusal
      // itself is part of the record, not a silent no.
      await this.audit.log({
        organizationId: orgId, userId: actorId, action: "ai.action_autonomy_rejected",
        entityType: "AiAutonomySetting", entityId: actionId,
        metadata: { actionId, requestedLevel: 3, reason: "level_3_requires_separate_owner_decision" },
      });
      throw badRequest("ai.level3ActingOnItsOwn");
    }
    if (typeof level !== "number" || !Number.isInteger(level) || !(AUTONOMY_LEVELS as readonly number[]).includes(level)) {
      throw badRequest("ai.levelMustBe01Or");
    }
    const row = await this.p().aiAutonomySetting.upsert({
      where: { organizationId_actionId: { organizationId: orgId, actionId } },
      create: { organizationId: orgId, actionId, level, updatedById: actorId },
      update: { level, updatedById: actorId },
    });
    await this.audit.log({
      organizationId: orgId, userId: actorId, action: "ai.action_autonomy_updated",
      entityType: "AiAutonomySetting", entityId: row.id,
      metadata: { actionId, level },
    });
    return { actionId, level, updatedById: actorId, updatedAt: row.updatedAt };
  }

  // ---------------- propose ----------------

  async propose(
    orgId: string,
    actionId: string,
    payload: unknown,
    opts: { proposedBy: "ai" | "staff"; actorUserId?: string | null; sourceRef?: Record<string, unknown> | null; conversationId?: string | null },
  ): Promise<ProposeResult> {
    const entry = catalogAction(actionId);
    if (!entry) throw badRequest("ai.unknownCatalogAction2", { actionId: actionId });
    if (opts.proposedBy !== "ai" && opts.proposedBy !== "staff") throw badRequest("ai.proposedbyMustBeAiOrStaff");

    const level = await this.getAutonomyLevel(orgId, actionId);
    if (level === 0) {
      await this.audit.log({
        organizationId: orgId, userId: opts.actorUserId ?? undefined, action: "ai.action_propose_refused",
        entityType: "AIActionProposal", entityId: actionId,
        metadata: { actionId, reason: "autonomy_off", proposedBy: opts.proposedBy },
      });
      return { ok: false, reason: "autonomy_off", message: `“${entry.title.bn}” কাজটি এই org-এ বন্ধ (autonomy স্তর ০) — প্রস্তাব তৈরি হয়নি।` };
    }

    const builder = this.executors.builders.get(actionId);
    if (!builder) {
      return { ok: false, reason: "action_not_wired", message: `“${entry.title.bn}” কাজটি catalog-এ আছে, কিন্তু এর executor এখনো wired নয় (${entry.wiring}) — প্রস্তাব তৈরি হয়নি।` };
    }

    const built = await builder(orgId, payload ?? {});

    // SA-B11 (W2): open-proposal dedupe. Deterministic triggers
    // (bot completion, spam detector, next-action bridge) can
    // fire repeatedly for the same conversation; while an
    // identical proposal is still OPEN (status "proposed") the
    // existing row is the answer — no duplicate is created.
    // Terminal rows (approved/executed/rejected/failed) never
    // block a fresh proposal: after a rejection the same trigger
    // may propose again. The dedupe key is (organizationId,
    // actionId, conversationId); tag_conversation also compares
    // the normalized tag set, because different tags are a
    // different proposal. Check-then-create (no schema change);
    // execution exactly-once still rests on the claim pipeline
    // below, not on this check.
    // SA-B12 (W3): comment actions carry no conversation — their
    // dedupe target is the payload's commentId (compared by
    // sameProposalPayload, which also compares the reply/DM text
    // for the text-carrying comment actions: a different text
    // for the same comment is a different proposal).
    // SA-B15 (A2): ads actions carry neither — their dedupe
    // target is the payload's campaignKey (the builder's
    // normalized platform::account::campaign identity, compared
    // by sameProposalPayload; a budget proposal also compares
    // the requested amount — a different budget is a different
    // proposal).
    const dedupeConversationId = built.conversationId ?? opts.conversationId ?? null;
    const dedupeCommentId =
      !dedupeConversationId && typeof (built.payload as any)?.commentId === "string"
        ? ((built.payload as any).commentId as string)
        : null;
    const dedupeAdsKey =
      !dedupeConversationId &&
      !dedupeCommentId &&
      typeof (built.payload as any)?.campaignKey === "string"
        ? ((built.payload as any).campaignKey as string)
        : null;
    if (dedupeConversationId || dedupeCommentId || dedupeAdsKey) {
      const open = await this.p().aIActionProposal.findMany({
        where: {
          organizationId: orgId,
          actionId,
          status: "proposed",
          ...(dedupeConversationId ? { conversationId: dedupeConversationId } : {}),
        },
      });
      const dupe = (open as any[]).find((r) => this.sameProposalPayload(actionId, r.payload, built.payload));
      if (dupe) return { ok: true, proposal: dupe, autoExecuted: false, deduped: true };
    }

    const row = await this.p().aIActionProposal.create({
      data: {
        organizationId: orgId,
        userId: opts.actorUserId ?? null,
        conversationId: built.conversationId ?? opts.conversationId ?? null,
        type: actionId,
        actionId,
        surface: entry.surface,
        proposedBy: opts.proposedBy,
        autonomyLevel: level,
        sourceRef: (opts.sourceRef ?? null) as any,
        title: built.title,
        preview: built.preview,
        payload: built.payload as any,
        status: "proposed",
      },
    });
    await this.logAiAction(orgId, opts.actorUserId ?? null, row, "proposed", "success");
    await this.audit.log({
      organizationId: orgId, userId: opts.actorUserId ?? undefined, action: "ai.action_proposed",
      entityType: "AIActionProposal", entityId: row.id,
      metadata: { actionId, surface: entry.surface, proposedBy: opts.proposedBy, autonomyLevel: level },
    });

    // Level 2: low-risk entries execute without a second human
    // click — through the SAME claim + verify pipeline as an
    // approval (the AP7 autonomous precedent). Money-adjacent
    // and non-low entries always wait for a human.
    if (level === 2 && entry.riskClass === "low" && !entry.moneyAdjacent) {
      const decided = await this.claimDecision(orgId, opts.actorUserId ?? null, row.id, { autonomous: true });
      if (decided) {
        const finalRow = await this.runExecution(orgId, opts.actorUserId ?? "system", row.id);
        return { ok: true, proposal: finalRow, autoExecuted: true };
      }
    }
    return { ok: true, proposal: row, autoExecuted: false };
  }

  /** Dedupe payload comparison. SA-B11: tag_conversation
   *  distinguishes proposals by payload — the normalized tag
   *  set; every other conversation action is identical per
   *  conversation target. SA-B12: comment actions are identical
   *  per comment target, except the two text-carrying ones —
   *  a different reply/DM text for the same comment is a
   *  different proposal. SA-B15: ads actions are identical per
   *  campaignKey, except set_campaign_budget, which also
   *  compares the requested budget (amount + kind). */
  private sameProposalPayload(actionId: string, a: any, b: any): boolean {
    if (actionId === "tag_conversation") {
      const norm = (p: any) => (Array.isArray(p?.addTags) ? p.addTags.map((t: any) => String(t).toLowerCase()).sort() : []).join("|");
      return norm(a) === norm(b);
    }
    if (typeof b?.commentId === "string") {
      if (a?.commentId !== b.commentId) return false;
      if (actionId === "reply_to_comment") return (a?.replyText ?? null) === (b?.replyText ?? null);
      if (actionId === "send_dm_to_commenter") return (a?.message ?? null) === (b?.message ?? null);
      return true;
    }
    if (typeof b?.campaignKey === "string") {
      if (a?.campaignKey !== b.campaignKey) return false;
      if (actionId === "set_campaign_budget") {
        return (
          String(a?.requestedBudgetMinor ?? "") === String(b?.requestedBudgetMinor ?? "") &&
          (a?.budgetKind ?? "daily") === (b?.budgetKind ?? "daily")
        );
      }
      return true;
    }
    return true;
  }

  // ---------------- decide (approve / reject) ----------------

  /** Claims proposed → approved exactly once; returns false when already decided. */
  private async claimDecision(orgId: string, actorId: string | null, proposalId: string, opts?: { autonomous?: boolean }): Promise<boolean> {
    const claim = await this.p().aIActionProposal.updateMany({
      where: { id: proposalId, organizationId: orgId, status: "proposed" },
      data: { status: "approved", decidedById: actorId, decidedAt: new Date() },
    });
    if (!claim?.count) return false;
    const row = await this.getEngineProposalOrThrow(orgId, proposalId);
    await this.logAiAction(orgId, actorId, row, "approved", "success");
    await this.audit.log({
      organizationId: orgId, userId: actorId ?? undefined, action: "ai.action_approved",
      entityType: "AIActionProposal", entityId: proposalId,
      metadata: { actionId: row.actionId, ...(opts?.autonomous ? { autonomous: true } : {}) },
    });
    return true;
  }

  async decide(orgId: string, actorId: string, proposalId: string, decision: "approve" | "reject") {
    return decision === "approve" ? this.approve(orgId, actorId, proposalId) : this.reject(orgId, actorId, proposalId);
  }

  async approve(orgId: string, actorId: string, proposalId: string) {
    const row = await this.getEngineProposalOrThrow(orgId, proposalId);
    if (row.status !== "proposed") throw badRequest("ai.thisActionProposalWasAlreadyDecided2", { rowStatus: row.status });
    const claimed = await this.claimDecision(orgId, actorId, proposalId);
    if (!claimed) throw badRequest("ai.thisActionProposalWasAlreadyDecided");
    const entry = catalogAction(row.actionId) as CatalogAction;
    if (entry.moneyAdjacent) {
      // Proposal-only by law (L5): approval records the human
      // decision; the act itself is performed by a human through
      // the existing staff path. The row stays "approved" with
      // the outcome spelled out in its result — it NEVER becomes
      // "executed" by this engine.
      const updated = await this.p().aIActionProposal.update({
        where: { id: proposalId },
        data: { result: { outcome: "proposal_only", note: "Approved as a recorded decision. The engine never executes money-adjacent actions (L5); a human performs it through the existing staff path." } as any },
      });
      await this.audit.log({
        organizationId: orgId, userId: actorId, action: "ai.action_proposal_only_approved",
        entityType: "AIActionProposal", entityId: proposalId,
        metadata: { actionId: row.actionId },
      });
      return updated;
    }
    return this.runExecution(orgId, actorId, proposalId);
  }

  async reject(orgId: string, actorId: string, proposalId: string) {
    const row = await this.getEngineProposalOrThrow(orgId, proposalId);
    if (row.status !== "proposed") throw badRequest("ai.thisActionProposalWasAlreadyDecided2", { rowStatus: row.status });
    const claim = await this.p().aIActionProposal.updateMany({
      where: { id: proposalId, organizationId: orgId, status: "proposed" },
      data: { status: "rejected", decidedById: actorId, decidedAt: new Date() },
    });
    if (!claim?.count) throw badRequest("ai.thisActionProposalWasAlreadyDecided");
    const updated = await this.getEngineProposalOrThrow(orgId, proposalId);
    await this.logAiAction(orgId, actorId, updated, "rejected", "denied");
    await this.audit.log({
      organizationId: orgId, userId: actorId, action: "ai.action_rejected",
      entityType: "AIActionProposal", entityId: proposalId,
      metadata: { actionId: row.actionId },
    });
    return updated;
  }

  // ---------------- execute ----------------

  async execute(orgId: string, actorId: string, proposalId: string): Promise<ExecuteResult> {
    const row = await this.getEngineProposalOrThrow(orgId, proposalId);
    if (row.status === "executed" || row.status === "failed") {
      // Terminal: the recorded outcome is the answer — never re-run.
      return { ok: true, proposal: row, noop: true };
    }
    if (row.status === "rejected") {
      return { ok: false, reason: "proposal_rejected", message: "প্রত্যাখ্যাত প্রস্তাব কার্যকর করা যায় না।" };
    }
    const entry = catalogAction(row.actionId) as CatalogAction;
    if (entry.moneyAdjacent) {
      return { ok: false, reason: "money_adjacent_proposal_only", message: "টাকা-সংক্রান্ত কাজ engine নিজে কার্যকর করে না (আইন L5) — এটি শুধুমাত্র প্রস্তাব পর্যন্ত।" };
    }
    if (row.status === "proposed") {
      return { ok: false, reason: "approval_required", message: "মানুষের অনুমোদন ছাড়া এই কাজ কার্যকর করা যায় না (autonomy স্তর ১)।" };
    }
    if (row.status === "executing") {
      return { ok: true, proposal: row, noop: true };
    }
    // SA-B24 (T3): while the kill switch is on for this org
    // (global pause or per-org disable), execution refuses —
    // the proposal stays APPROVED and queued; it is NOT
    // failed, and it can execute once the switch lifts. The
    // recorded-outcome reads above (terminal / rejected /
    // money / approval checks) deliberately stay available:
    // they execute nothing.
    if (await this.aiPaused(orgId)) {
      return { ok: false, reason: "ai_paused", message: "AI সাময়িকভাবে বন্ধ আছে (প্ল্যাটফর্ম টিমের kill switch) — প্রস্তাবটি অনুমোদিত অবস্থায় অপেক্ষায় থাকবে, কিছুই কার্যকর হয়নি।" };
    }
    const finalRow = await this.runExecution(orgId, actorId, proposalId);
    return { ok: true, proposal: finalRow };
  }

  /**
   * Claims approved → executing, runs the registered executor
   * through the existing service path, then lets the registered
   * verifier judge the real state. Exactly one caller wins the
   * claim; everyone else observes the recorded outcome.
   */
  private async runExecution(orgId: string, actorId: string, proposalId: string) {
    // SA-B24 (T3): the execution choke point itself — every
    // path that runs an executor funnels through here
    // (approve(), execute(), L2 autonomous), so the pause is
    // checked here too: while paused the row is returned
    // UNEXECUTED (still approved), before any claim. Nothing
    // is recorded as failed — a pause is not a failure.
    if (await this.aiPaused(orgId)) {
      return this.getEngineProposalOrThrow(orgId, proposalId);
    }
    const claim = await this.p().aIActionProposal.updateMany({
      where: { id: proposalId, organizationId: orgId, status: "approved" },
      data: { status: "executing" },
    });
    if (!claim?.count) return this.getEngineProposalOrThrow(orgId, proposalId);
    const row = await this.getEngineProposalOrThrow(orgId, proposalId);
    const entry = catalogAction(row.actionId) as CatalogAction;
    const executor = entry.executorKey ? this.executors.executors.get(entry.executorKey) : undefined;
    if (!executor) {
      return this.failExecution(orgId, actorId, row, "executor_not_registered", { outcome: "failed" });
    }
    let result: Record<string, unknown>;
    try {
      result = await executor(orgId, actorId, row.payload ?? {});
    } catch (e) {
      const message = e instanceof Error ? e.message : "Execution failed";
      return this.failExecution(orgId, actorId, row, message, { outcome: "failed" });
    }
    const verifier = entry.verifierKey ? this.executors.verifiers.get(entry.verifierKey) : undefined;
    let verification: { verified: boolean; detail: Record<string, unknown> };
    if (!verifier) {
      verification = { verified: false, detail: { error: "verifier_not_registered" } };
    } else {
      try {
        verification = await verifier(orgId, row.payload ?? {}, result);
      } catch (e) {
        verification = { verified: false, detail: { error: e instanceof Error ? e.message : "verifier failed" } };
      }
    }
    if (!verification.verified) {
      // The operation claimed success but the read-back disagrees:
      // recorded as FAILED with reason verification_mismatch —
      // never dressed up as success (L5).
      return this.failExecution(orgId, actorId, row, "verification_mismatch", { ...result, outcome: "verification_mismatch" }, verification);
    }
    const updated = await this.p().aIActionProposal.update({
      where: { id: proposalId },
      data: {
        status: "executed",
        executedAt: new Date(),
        result: { ...result, outcome: "verified_success" } as any,
        verification: verification as any,
        error: null,
      },
    });
    await this.logAiAction(orgId, actorId === "system" ? null : actorId, updated, "executed", "success");
    await this.audit.log({
      organizationId: orgId, userId: actorId, action: "ai.action_executed",
      entityType: "AIActionProposal", entityId: proposalId,
      metadata: { actionId: row.actionId, outcome: "verified_success" },
    });
    return updated;
  }

  private async failExecution(orgId: string, actorId: string, row: any, message: string, result: Record<string, unknown>, verification?: { verified: boolean; detail: Record<string, unknown> }) {
    const updated = await this.p().aIActionProposal.update({
      where: { id: row.id },
      data: {
        status: "failed",
        error: message,
        result: result as any,
        ...(verification ? { verification: verification as any } : {}),
      },
    });
    await this.logAiAction(orgId, actorId === "system" ? null : actorId, updated, "failed", "error", message);
    await this.audit.log({
      organizationId: orgId, userId: actorId, action: "ai.action_failed",
      entityType: "AIActionProposal", entityId: row.id,
      metadata: { actionId: row.actionId, error: message },
    });
    return updated; // the FAILED state is the honest result
  }

  // ---------------- reads ----------------

  async listProposals(orgId: string, status?: string) {
    return this.p().aIActionProposal.findMany({
      where: { organizationId: orgId, actionId: { not: null }, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async getCatalog() {
    return ACTION_CATALOG.map((entry) => ({ ...entry }));
  }
}
