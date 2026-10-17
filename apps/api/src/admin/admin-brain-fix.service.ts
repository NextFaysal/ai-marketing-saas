import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { BrainAdminService } from "../ai/brain-admin.service";
import { AnswerStoreService } from "../ai/answer-store.service";
import { LearningService } from "../ai/learning.service";
import { AdminBrainService } from "./admin-brain.service";

/** The provenance marker stamped on every console decision —
 * the same string LearningService writes to
 * LearnedItem.reviewedVia for console reviews (SA-B23). */
export const ADMIN_CONSOLE_VIA = "admin_console";

/**
 * SA-B23 (Smart AI Phase 6, T1 console family): the SUPER
 * admin's per-org Brain FIXES. This is the most sensitive
 * write surface in the program — a platform operator changing
 * what a tenant's Brain knows — so the rules are structural,
 * not conventional:
 *
 *  - REASON FIRST. Every fix requires a non-empty `reason`,
 *    validated before ANY read or mutation. An empty reason is
 *    a 400 with zero state change and zero fix-audit rows:
 *    there is no such thing as an unexplained admin fix.
 *  - SAME PATHS AS THE TENANT. Invalidation goes through
 *    AnswerStoreService.invalidate (the store's own path),
 *    learned-item decisions through LearningService
 *    approve/reject, forgetting through BrainAdminService's
 *    B6 forget. No parallel admin mutation logic exists here;
 *    this service only gates (reason), delegates, and records.
 *  - THE ACTOR IS THE ADMIN, NEVER A FORGED STAFF MEMBER. The
 *    admin's own user id is passed as the actor to the tenant
 *    services, so their stamps (reviewedById, the tenant audit
 *    rows) truthfully name the admin; the console path adds
 *    `reviewedVia: "admin_console"` (SA-B23 column) plus its
 *    own org-scoped admin audit row carrying the reason
 *    verbatim. An org reading its rows can always distinguish
 *    "platform admin did this" from "we did this".
 *  - A FAILED FIX LEAVES NO FIX-AUDIT. If the tenant path
 *    refuses (e.g. the Answer Store's PII screen rejecting an
 *    approval), the error surfaces and nothing here records a
 *    fix that did not happen.
 */
@Injectable()
export class AdminBrainFixService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly brain: AdminBrainService,
    private readonly brainAdmin: BrainAdminService,
    private readonly answerStore: AnswerStoreService,
    private readonly learning: LearningService,
  ) {}

  private db(): any {
    return this.prisma as any;
  }

  /** The reason gate — runs before anything else in every fix. */
  private requireReason(reason: unknown): string {
    const r = String(reason ?? "").trim();
    if (!r) {
      throw new BadRequestException(
        "A reason is required for every admin Brain fix — it is recorded verbatim in the audit trail.",
      );
    }
    if (r.length > 500) throw new BadRequestException("reason is too long (max 500)");
    return r;
  }

  /** (a) Invalidate a stored answer through the Answer
   * Store's own path — the row keeps serving nothing from this
   * moment (lookup filters on status "active"), and the row's
   * invalidReason IS the admin's stated reason. */
  async invalidateAnswer(actor: any, organizationId: string, answerId: string, reasonRaw: unknown, ip?: string) {
    const reason = this.requireReason(reasonRaw);
    const before = await this.db().aiStoredAnswer.findFirst({ where: { id: answerId, organizationId } });
    if (!before) throw new NotFoundException("Stored answer not found");
    // Snapshot the pre-fix state into locals BEFORE mutating —
    // the audit must record what the row WAS, whatever the ORM
    // does with the fetched object afterwards.
    const previousStatus = before.status;
    const question = before.questionText;
    await this.answerStore.invalidate(organizationId, answerId, reason);
    const after = await this.db().aiStoredAnswer.findFirst({ where: { id: answerId, organizationId } });
    await this.audit.log({
      organizationId,
      userId: actor?.id,
      action: "admin.ai_brain_fix_answer_invalidate",
      entityType: "AiStoredAnswer",
      entityId: answerId,
      metadata: { reason, question, previousStatus },
      ipAddress: ip,
    });
    return {
      id: answerId,
      question: after?.questionText ?? question,
      status: after?.status ?? "invalidated",
      invalidReason: after?.invalidReason ?? reason,
      decidedVia: ADMIN_CONSOLE_VIA,
    };
  }

  /** (b) Approve/reject a pending LearnedItem as admin. The
   * tenant LearningService performs the decision (including
   * applying an approval to the Answer Store / Knowledge) with
   * the admin's id as the actor and the console via stamped on
   * the row; a refusal from that path (already decided, the
   * store's PII screen, …) surfaces unchanged and leaves no
   * fix-audit here. */
  async reviewLearnedItem(
    actor: any,
    organizationId: string,
    itemId: string,
    decisionRaw: unknown,
    reasonRaw: unknown,
    ip?: string,
  ) {
    const reason = this.requireReason(reasonRaw);
    if (decisionRaw !== "approve" && decisionRaw !== "reject") {
      throw new BadRequestException("decision must be \"approve\" or \"reject\"");
    }
    const updated =
      decisionRaw === "approve"
        ? await this.learning.approve(organizationId, actor?.id, itemId, { via: ADMIN_CONSOLE_VIA })
        : await this.learning.reject(organizationId, actor?.id, itemId, { via: ADMIN_CONSOLE_VIA });
    await this.audit.log({
      organizationId,
      userId: actor?.id,
      action: decisionRaw === "approve" ? "admin.ai_brain_fix_learned_approve" : "admin.ai_brain_fix_learned_reject",
      entityType: "LearnedItem",
      entityId: itemId,
      metadata: {
        reason,
        kind: updated.kind,
        sourceType: updated.sourceType,
        appliedRef: updated.appliedRef ?? null,
        reviewedVia: ADMIN_CONSOLE_VIA,
      },
      ipAddress: ip,
    });
    return {
      id: updated.id,
      status: updated.status,
      kind: updated.kind,
      sourceType: updated.sourceType,
      reviewedById: updated.reviewedById ?? null,
      reviewedVia: (updated as any).reviewedVia ?? ADMIN_CONSOLE_VIA,
      reviewedAt: updated.reviewedAt instanceof Date ? updated.reviewedAt.toISOString() : (updated.reviewedAt ?? null),
      appliedRef: updated.appliedRef ?? null,
    };
  }

  /** (c) Forget ONE customer's memory, addressed by its key
   * (`channel:externalContactId`) — keyed, never browsed: the
   * admin names the exact customer key (from the org's own
   * report of a problem), and the B6 forget path removes
   * exactly that row for exactly this org. */
  async forgetCustomerMemory(actor: any, organizationId: string, customerKeyRaw: unknown, reasonRaw: unknown, ip?: string) {
    const reason = this.requireReason(reasonRaw);
    const customerKey = String(customerKeyRaw ?? "").trim();
    if (!customerKey) throw new BadRequestException("customerKey is required");
    const row = await this.db().customerMemory.findFirst({ where: { organizationId, customerKey } });
    if (!row) throw new NotFoundException("Customer memory not found");
    await this.brainAdmin.deleteCustomerMemory(organizationId, actor?.id, row.id);
    await this.audit.log({
      organizationId,
      userId: actor?.id,
      action: "admin.ai_brain_fix_memory_forget",
      entityType: "CustomerMemory",
      entityId: row.id,
      metadata: { reason, customerKey },
      ipAddress: ip,
    });
    return { deleted: true, id: row.id, customerKey, decidedVia: ADMIN_CONSOLE_VIA };
  }

  /** (d) The Answer Store on/off switch as an admin override.
   * The write is the same BusinessProfile row the tenant's own
   * settings PATCH writes (upsert, the tenant path's shape);
   * the origin of THIS change is the admin audit row + the
   * response payload — no staff actor is stamped anywhere. */
  async setAnswerStoreEnabled(actor: any, organizationId: string, enabledRaw: unknown, reasonRaw: unknown, ip?: string) {
    const reason = this.requireReason(reasonRaw);
    if (typeof enabledRaw !== "boolean") throw new BadRequestException("enabled must be a boolean");
    await this.brain.getOrgOrThrow(organizationId);
    const db = this.db();
    const before = await db.businessProfile.findUnique({
      where: { organizationId },
      select: { answerStoreEnabled: true },
    });
    const previousEnabled = before?.answerStoreEnabled !== false;
    const row = await db.businessProfile.upsert({
      where: { organizationId },
      create: { organizationId, answerStoreEnabled: enabledRaw },
      update: { answerStoreEnabled: enabledRaw },
    });
    await this.audit.log({
      organizationId,
      userId: actor?.id,
      action: "admin.ai_brain_fix_answer_store_toggle",
      entityType: "BusinessProfile",
      entityId: row.id,
      metadata: { reason, from: previousEnabled, to: enabledRaw },
      ipAddress: ip,
    });
    return {
      organizationId,
      answerStoreEnabled: enabledRaw,
      previousEnabled,
      decidedVia: ADMIN_CONSOLE_VIA,
    };
  }
}
