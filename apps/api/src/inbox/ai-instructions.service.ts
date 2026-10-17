import { BadRequestException, HttpException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { InboxService } from "./inbox.service";
import { LlmFactory, providerForOrg } from "../ai/llm/llm.factory";
import { matchKnowledge } from "./business-brain";
import { parseUnansweredDraft, type UnansweredDraftProposal } from "./in7-ai";

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
    // IN7e: optional so existing constructions (and older specs)
    // keep working — without a factory the draft-proposal
    // endpoint honestly reports that no proposal can be made.
    @Optional() private readonly llm?: LlmFactory,
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
    await this.checkFeatureLimit(organizationId, "instructions_test");
  }

  /** Kill switch + per-feature daily cap, shared by the Desk's
   * AI features: the cap counts the SAME feature the calls record
   * under, so ledger and enforcement always agree. */
  private async checkFeatureLimit(organizationId: string, feature: string) {
    const { killSwitches, effectiveLimits, isAiDisabledForOrg } = await import("../common/platform-settings");
    const ks = await killSwitches(this.prisma as any);
    if (isAiDisabledForOrg(ks, organizationId)) {
      throw new HttpException(ks.aiGloballyPaused ? "AI features are temporarily paused platform-wide by the platform team." : "AI features are temporarily disabled for this organization by the platform team.", 403);
    }
    const baseline = Number(process.env.AI_DAILY_MESSAGE_LIMIT ?? 200);
    const { aiDaily: limit } = await effectiveLimits(this.prisma as any, organizationId, { aiDaily: baseline, broadcastCap: 1000 });
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const used = await (this.prisma as any).aIUsageRecord.count({
      where: { organizationId, feature, createdAt: { gte: startOfDay } },
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

  /**
   * IN7e: "learn from the unanswered" — for ONE unanswered
   * question, the AI drafts either a knowledge chunk or an
   * instruction line that WOULD have answered it, grounded in
   * the real question + the org's existing knowledge/instructions
   * context. DISPLAY-ONLY: nothing is written here — no knowledge
   * row, no draft change, no publish. A human routes the proposal
   * through the existing paths (knowledge-documents POST, or the
   * Desk draft above) if they accept it. Enforcement parity:
   * kill switch + daily cap under feature "unanswered_draft",
   * checked before any LLM call; every call records usage.
   */
  async draftUnansweredProposal(organizationId: string, actorId: string, id: string): Promise<{
    proposal: UnansweredDraftProposal | null; provider: string | null; reason?: string;
    question: { id: string; questionText: string };
  }> {
    await this.checkFeatureLimit(organizationId, "unanswered_draft");
    const row = await (this.prisma as any).aiUnansweredQuestion
      .findFirst({ where: { id, organizationId } })
      .catch(() => null);
    if (!row) throw new NotFoundException("Unanswered question not found in this organization");
    const question = { id: row.id, questionText: row.questionText };
    let provider: any;
    try { provider = this.llm ? await providerForOrg(this.llm, organizationId) : null; } catch { provider = null; }
    if (!provider?.isRealLlm) {
      return { proposal: null, provider: provider?.name ?? null, reason: "আসল AI provider যুক্ত নেই — খসড়া প্রস্তাব তৈরি হয়নি।", question };
    }
    const profile = await this.getProfile(organizationId);
    const docs = (await (this.prisma as any).knowledgeDocument?.findMany?.({ where: { organizationId }, take: 100 })?.catch?.(() => [])) ?? [];
    const matched = matchKnowledge(String(row.questionText ?? ""), docs as any[])
      .map((m: any) => `${m.doc.title}: ${String(m.doc.content).replace(/\s+/g, " ").slice(0, 300)}`);
    const result = await provider.complete([
      {
        role: "system",
        content: [
          "A customer asked a question the support autopilot could NOT answer. Draft the missing piece of business knowledge so it can be answered next time.",
          "Reply with ONLY a JSON object, no prose: {\"kind\": \"knowledge\"|\"instruction\", \"title\": string, \"content\": string, \"reason\": string}",
          "kind \"knowledge\": a factual chunk for the knowledge base (title + content with the facts an answer needs). kind \"instruction\": ONE instruction line for the AI instructions (behaviour/conduct, no new facts).",
          "Write content in Bengali unless the question is in English. NEVER invent specific prices, charges, phone numbers or policies that are not in the context below — if a specific fact is missing, phrase the draft so the owner fills it in, e.g. '___ টাকা' placeholders are NOT allowed; instead say what the team must confirm.",
          `বিদ্যমান নির্দেশনা (published): ${String(profile?.aiInstructions ?? "—").slice(0, 800)}`,
          `প্রাসঙ্গিক বিদ্যমান জ্ঞান: ${matched.length ? matched.join(" | ") : "নেই"}`,
        ].join("\n"),
      },
      { role: "user", content: `উত্তরহীন প্রশ্ন: ${String(row.questionText ?? "").slice(0, 500)}` },
    ], { maxTokens: 400 });
    await (this.prisma as any).aIUsageRecord.create({
      data: { organizationId, userId: actorId, feature: "unanswered_draft", provider: provider.name, inputTokens: result.inputTokens, outputTokens: result.outputTokens, estimated: result.tokensEstimated },
    }).catch(() => undefined);
    const proposal = parseUnansweredDraft(String(result.text ?? ""));
    if (!proposal) return { proposal: null, provider: provider.name, reason: "AI-এর খসড়াটি যাচাই করা যায়নি — দেখানো হয়নি।", question };
    return { proposal, provider: provider.name, question };
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
