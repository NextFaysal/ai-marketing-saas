import { BadRequestException, HttpException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { InboxService } from "./inbox.service";

export const UNANSWERED_STATUSES = ["open", "resolved", "ignored"] as const;

/**
 * CX2 — AI Instructions Desk.
 *
 * The owner's AI instructions used to be a single live-edited
 * textarea on the settings page: every keystroke-save went
 * straight to customers. The Desk makes it a publishing flow:
 *
 *   draft (BusinessProfile.aiInstructionsDraft — a persistent
 *   working copy) → test (InboxService.testComposeReply, the real
 *   compose pipeline with an instructions override) → publish
 *   (the text lands in BusinessProfile.aiInstructions, the ONLY
 *   field consumers read, plus an immutable AiInstructionVersion
 *   row) → rollback (restores a version's text + language into
 *   BOTH columns and records itself as a new version).
 *
 * The effective draft is `aiInstructionsDraft ?? aiInstructions`:
 * an org that never opened the Desk simply has its published
 * text as the draft.
 */
@Injectable()
export class AiInstructionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly inbox: InboxService,
  ) {}

  private async getProfile(organizationId: string) {
    return (await (this.prisma as any).businessProfile?.findUnique?.({ where: { organizationId } })?.catch?.(() => null)) ?? null;
  }

  private async latestVersionRow(organizationId: string) {
    return (await (this.prisma as any).aiInstructionVersion?.findFirst?.({
      where: { organizationId }, orderBy: { version: "desc" },
    })?.catch?.(() => null)) ?? null;
  }

  /** The Desk state: published text, the effective draft, and
   * whether the two differ (unpublished changes waiting). */
  async getState(organizationId: string) {
    const profile = await this.getProfile(organizationId);
    const published: string | null = profile?.aiInstructions ?? null;
    const draft: string | null = profile?.aiInstructionsDraft ?? published;
    const latest = await this.latestVersionRow(organizationId);
    return {
      published,
      replyLanguage: profile?.aiReplyLanguage ?? null,
      draft,
      hasUnpublishedChanges: draft !== published,
      latestVersion: latest?.version ?? null,
    };
  }

  /** Save the working draft. NEVER touches the published text —
   * customers keep getting the old instructions until publish. */
  async saveDraft(organizationId: string, instructions: string) {
    if (typeof instructions !== "string") throw new BadRequestException("instructions must be a string");
    if (instructions.length > 2000) throw new BadRequestException("instructions must be at most 2000 characters");
    await (this.prisma as any).businessProfile.upsert({
      where: { organizationId },
      update: { aiInstructionsDraft: instructions },
      create: { organizationId, aiInstructionsDraft: instructions },
    });
    return this.getState(organizationId);
  }

  /** Publish the effective draft: it becomes the live
   * aiInstructions (the column every consumer reads) and an
   * immutable version row is appended. The draft column is left
   * as-is — it now equals the published text. */
  async publish(organizationId: string, actorId: string, note?: string) {
    const profile = await this.getProfile(organizationId);
    const text: string = profile?.aiInstructionsDraft ?? profile?.aiInstructions ?? "";
    const latest = await this.latestVersionRow(organizationId);
    const version = (latest?.version ?? 0) + 1;
    await (this.prisma as any).businessProfile.upsert({
      where: { organizationId },
      update: { aiInstructions: text },
      create: { organizationId, aiInstructions: text },
    });
    const row = await (this.prisma as any).aiInstructionVersion.create({
      data: {
        organizationId,
        version,
        instructions: text,
        replyLanguage: profile?.aiReplyLanguage ?? null,
        note: typeof note === "string" && note.trim() ? note.trim().slice(0, 200) : null,
        publishedById: actorId,
      },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "ai_instructions.published",
      entityType: "AiInstructionVersion", entityId: row.id, metadata: { version },
    }).catch(() => undefined);
    return { ...(await this.getState(organizationId)), version };
  }

  async listVersions(organizationId: string) {
    const rows = await (this.prisma as any).aiInstructionVersion
      .findMany({ where: { organizationId }, orderBy: { version: "desc" }, take: 50 })
      .catch(() => []);
    return Array.isArray(rows) ? rows : [];
  }

  /** Faithful restore: the version's instructions AND reply
   * language go back into both the published and draft columns,
   * and the rollback itself is recorded as a NEW version — the
   * history rows are never rewritten. */
  async rollback(organizationId: string, actorId: string, versionId: string) {
    const v = await (this.prisma as any).aiInstructionVersion
      .findFirst({ where: { id: versionId, organizationId } })
      .catch(() => null);
    if (!v) throw new NotFoundException("Version not found in this organization");
    await (this.prisma as any).businessProfile.upsert({
      where: { organizationId },
      update: { aiInstructions: v.instructions, aiInstructionsDraft: v.instructions, aiReplyLanguage: v.replyLanguage ?? null },
      create: { organizationId, aiInstructions: v.instructions, aiInstructionsDraft: v.instructions, aiReplyLanguage: v.replyLanguage ?? null },
    });
    const latest = await this.latestVersionRow(organizationId);
    const newVersion = (latest?.version ?? 0) + 1;
    const row = await (this.prisma as any).aiInstructionVersion.create({
      data: {
        organizationId,
        version: newVersion,
        instructions: v.instructions,
        replyLanguage: v.replyLanguage ?? null,
        note: `v${v.version} সংস্করণে রোলব্যাক`,
        publishedById: actorId,
      },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "ai_instructions.rollback",
      entityType: "AiInstructionVersion", entityId: row.id,
      metadata: { fromVersion: v.version, newVersion },
    }).catch(() => undefined);
    return this.getState(organizationId);
  }

  /**
   * Kill switch + daily AI cap for the Desk test, mirroring
   * CreativeStudioService.checkDailyLimit exactly — except the
   * usage counted is this feature's own ("instructions_test"),
   * the same feature the test's LLM calls record under, so the
   * cap and the usage ledger agree.
   */
  private async checkTestLimit(organizationId: string) {
    const { killSwitches, effectiveLimits } = await import("../common/platform-settings");
    const ks = await killSwitches(this.prisma as any);
    if (ks.aiDisabledOrgIds.includes(organizationId)) {
      throw new HttpException("AI features are temporarily disabled for this organization by the platform team.", 403);
    }
    const baseline = Number(process.env.AI_DAILY_MESSAGE_LIMIT ?? 200);
    const { aiDaily: limit } = await effectiveLimits(this.prisma as any, organizationId, { aiDaily: baseline, broadcastCap: 1000 });
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const used = await (this.prisma as any).aIUsageRecord.count({
      where: { organizationId, feature: "instructions_test", createdAt: { gte: startOfDay } },
    });
    if (used >= limit) {
      throw new HttpException(
        `Daily AI generation limit reached for this organization (${limit}). Try again tomorrow or ask the platform team to raise your plan limit.`,
        429,
      );
    }
  }

  /** Test-compose a reply under the draft (useDraft) or the
   * published instructions. Enforcement runs FIRST, before any
   * compose work. The instructions travel as an override — the
   * stored profile is never mutated by a test. */
  async test(organizationId: string, dto: { question: string; useDraft: boolean }) {
    await this.checkTestLimit(organizationId);
    const question = typeof dto?.question === "string" ? dto.question.trim() : "";
    if (!question || question.length > 500) throw new BadRequestException("question is required (1..500 characters)");
    const profile = await this.getProfile(organizationId);
    const published: string | null = profile?.aiInstructions ?? null;
    const effectiveDraft: string | null = profile?.aiInstructionsDraft ?? published;
    const text = dto?.useDraft ? effectiveDraft : published;
    const result = await this.inbox.testComposeReply(organizationId, question, {
      instructions: text,
      replyLanguage: profile?.aiReplyLanguage ?? null,
    });
    return { ...result, model: (result as any).evidence?.provider ?? null };
  }

  /** The questions the autopilot could not answer, newest first. */
  async listUnanswered(organizationId: string, opts?: { status?: string; take?: number }) {
    const takeRaw = Math.floor(Number(opts?.take ?? 50));
    const take = Number.isFinite(takeRaw) ? Math.min(100, Math.max(1, takeRaw)) : 50;
    const where: Record<string, unknown> = { organizationId };
    if (opts?.status) where.status = opts.status;
    const rows = await (this.prisma as any).aiUnansweredQuestion
      .findMany({ where, orderBy: { createdAt: "desc" }, take })
      .catch(() => []);
    return Array.isArray(rows) ? rows : [];
  }

  async updateUnansweredStatus(organizationId: string, actorId: string, id: string, status: string) {
    if (!(UNANSWERED_STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestException(`status must be one of: ${UNANSWERED_STATUSES.join(" | ")}`);
    }
    const row = await (this.prisma as any).aiUnansweredQuestion
      .findFirst({ where: { id, organizationId } })
      .catch(() => null);
    if (!row) throw new NotFoundException("Unanswered question not found in this organization");
    const updated = await (this.prisma as any).aiUnansweredQuestion.update({
      where: { id: row.id },
      data: { status },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "ai_instructions.unanswered_status",
      entityType: "AiUnansweredQuestion", entityId: row.id, metadata: { status },
    }).catch(() => undefined);
    return updated;
  }
}
