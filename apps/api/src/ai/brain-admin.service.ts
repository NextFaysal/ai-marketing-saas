import { Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EmbeddingsService } from "./embeddings.service";
import { LearningService } from "./learning.service";
import { badRequest, notFound } from "../i18n/api-exception";

/**
 * SA-B6 (Smart AI Phase 0, P9): the management/read surface the
 * tenant Learn Dashboard is built on — a brain overview plus the
 * two human-control surfaces SA-B3/SA-B5 deliberately deferred
 * here: Answer Store management (list / enable / disable /
 * delete) and Customer Memory read + forget.
 *
 * Laws enforced here:
 *  - L1: every query is organizationId-scoped in SQL; an id from
 *    another org is a 404, never a leak.
 *  - L3/L4: an INVALIDATED stored answer can never be re-enabled
 *    from this surface — invalidation means its grounding went
 *    stale (SA-B3 recorded the reason on the row). The only way
 *    back is a fresh grounded store through AnswerStoreService
 *    (a new autopilot capture or a human approval), or deletion.
 *    This surface therefore allows exactly the active <-> disabled
 *    toggle on healthy rows, and delete on any row.
 *  - Honesty: every overview number is a real row aggregate.
 *    The coverage percent is a SETUP checklist (which knowledge
 *    areas hold any data at all), never a quality score.
 */

export const BRAIN_COVERAGE_AREAS = [
  "profile",
  "policies",
  "knowledge",
  "products",
  "website",
  "answers",
  "brandVoice",
  "customerMemory",
] as const;

const ANSWER_PREVIEW_CHARS = 240;

@Injectable()
export class BrainAdminService {
  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly embeddings?: EmbeddingsService,
    @Optional() private readonly learning?: LearningService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private db(): any {
    if (!this.prisma) throw new Error("BrainAdminService: PrismaService is not available");
    return this.prisma as any;
  }

  // ---------------- overview ----------------

  async getOverview(organizationId: string) {
    const db = this.db();
    const [
      profile,
      policies,
      docsTotal,
      docsPublic,
      docsInternal,
      websitePages,
      indexedChunks,
      productRows,
      ansActive,
      ansInvalidated,
      ansDisabled,
      ansHits,
      pendingSuggestions,
      unansweredOpen,
      memoryCount,
      voice,
      latestSnapshot,
      states,
      toggles,
    ] = await Promise.all([
      db.businessProfile.findUnique({ where: { organizationId }, select: { id: true, answerStoreEnabled: true } }),
      db.businessPolicy.count({ where: { organizationId } }),
      db.knowledgeDocument.count({ where: { organizationId } }),
      db.knowledgeDocument.count({ where: { organizationId, visibility: "public" } }),
      db.knowledgeDocument.count({ where: { organizationId, visibility: "internal" } }),
      db.knowledgeDocument.count({ where: { organizationId, kind: "website" } }),
      db.knowledgeEmbedding.count({ where: { organizationId } }),
      db.knowledgeEmbedding.findMany({
        where: { organizationId, sourceType: "product" },
        select: { sourceId: true },
        distinct: ["sourceId"],
      }),
      db.aiStoredAnswer.count({ where: { organizationId, status: "active" } }),
      db.aiStoredAnswer.count({ where: { organizationId, status: "invalidated" } }),
      db.aiStoredAnswer.count({ where: { organizationId, status: "disabled" } }),
      db.aiStoredAnswer.aggregate({ where: { organizationId }, _sum: { hitCount: true } }),
      db.learnedItem.count({ where: { organizationId, status: "suggested" } }),
      db.aiUnansweredQuestion.count({ where: { organizationId, status: "open" } }),
      db.customerMemory.count({ where: { organizationId } }),
      db.aiBrandVoiceProfile.findUnique({ where: { organizationId } }),
      db.performanceSnapshot.findFirst({ where: { organizationId }, orderBy: { periodEnd: "desc" } }),
      db.learningState.findMany({ where: { organizationId } }),
      this.learning
        ? this.learning.getToggles(organizationId)
        : Promise.resolve({ conversationLearningEnabled: false, websiteLearningEnabled: true, websiteUrl: null as string | null }),
    ]);

    const emb = this.embeddings
      ? await this.embeddings.resolveConfig(organizationId)
      : ({ ok: false, reason: "embeddings_service_unavailable" } as const);

    const stateBySource = new Map<string, any>((states ?? []).map((s: any) => [s.source, s]));
    const stateSummary = (source: string) => {
      const s = stateBySource.get(source);
      if (!s) return null;
      return {
        lastRunAt: s.lastRunAt ?? null,
        lastStatus: s.lastStatus ?? null,
        reason: (s.lastDetail as any)?.reason ?? null,
      };
    };

    const indexedProducts = Array.isArray(productRows) ? productRows.length : 0;
    const present: Record<(typeof BRAIN_COVERAGE_AREAS)[number], boolean> = {
      profile: !!profile,
      policies: policies > 0,
      knowledge: docsTotal > 0,
      products: indexedProducts > 0,
      website: websitePages > 0,
      answers: ansActive > 0,
      brandVoice: voice?.status === "active",
      customerMemory: memoryCount > 0,
    };
    const areas = BRAIN_COVERAGE_AREAS.map((key) => ({ key, present: present[key] }));
    const presentCount = areas.filter((a) => a.present).length;

    return {
      organizationId,
      generatedAt: new Date(),
      knowledge: { total: docsTotal, public: docsPublic, internal: docsInternal, websitePages },
      embeddings: {
        available: emb.ok,
        reason: emb.ok ? null : emb.reason,
        provider: emb.ok ? emb.config.provider : null,
        model: emb.ok ? emb.config.model : null,
        indexedChunks,
        indexedProducts,
        retrievalMode: emb.ok ? "hybrid" : "keyword",
      },
      answers: {
        active: ansActive,
        invalidated: ansInvalidated,
        disabled: ansDisabled,
        total: ansActive + ansInvalidated + ansDisabled,
        totalHits: ansHits?._sum?.hitCount ?? 0,
        // SA-B13 (W4): the per-org Answer Store switch, read
        // from the same profile row as the coverage check —
        // only an explicit false disables (schema default
        // TRUE), so the dashboard shows exactly the state the
        // AnswerStoreService gate will enforce.
        storeEnabled: (profile as any)?.answerStoreEnabled !== false,
      },
      learning: {
        pendingSuggestions,
        toggles,
        sources: {
          website: stateSummary("website"),
          conversation: stateSummary("conversation"),
          performance: stateSummary("performance"),
        },
      },
      performance: latestSnapshot
        ? { lastSnapshotAt: latestSnapshot.computedAt, periodStart: latestSnapshot.periodStart, periodEnd: latestSnapshot.periodEnd }
        : null,
      brandVoice: {
        status: voice ? (voice.status as string) : "none",
        hasPendingSuggestion: !!voice?.pendingTraits,
      },
      customerMemories: { count: memoryCount },
      unanswered: { open: unansweredOpen },
      coverage: {
        percent: Math.round((presentCount / BRAIN_COVERAGE_AREAS.length) * 100),
        areas,
        gaps: areas.filter((a) => !a.present).map((a) => a.key),
      },
    };
  }

  // ---------------- answer store management ----------------

  async listStoredAnswers(
    organizationId: string,
    opts: { status?: string; search?: string; limit?: number; offset?: number } = {},
  ) {
    const take = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const skip = Math.max(opts.offset ?? 0, 0);
    const where: Record<string, unknown> = { organizationId };
    if (opts.status) where.status = opts.status;
    const search = (opts.search ?? "").trim();
    if (search) where.questionText = { contains: search, mode: "insensitive" };
    const db = this.db();
    const [rows, total] = await Promise.all([
      db.aiStoredAnswer.findMany({ where, orderBy: { updatedAt: "desc" }, take, skip }),
      db.aiStoredAnswer.count({ where }),
    ]);
    return {
      items: (rows as any[]).map((r) => ({
        id: r.id,
        question: r.questionText,
        normalizedQuestion: r.normalizedQuestion,
        answerPreview: String(r.answerText ?? "").slice(0, ANSWER_PREVIEW_CHARS),
        answerTruncated: String(r.answerText ?? "").length > ANSWER_PREVIEW_CHARS,
        channel: r.channel,
        language: r.language ?? null,
        origin: r.origin,
        status: r.status,
        invalidReason: r.invalidReason ?? null,
        hitCount: r.hitCount,
        lastHitAt: r.lastHitAt ?? null,
        containsLiveFacts: !!r.containsLiveFacts,
        groundedAt: r.groundedAt,
        updatedAt: r.updatedAt,
      })),
      total,
    };
  }

  private async getAnswerOrThrow(organizationId: string, answerId: string) {
    const row = await this.db().aiStoredAnswer.findFirst({ where: { id: answerId, organizationId } });
    if (!row) throw notFound("ai.storedAnswerNotFound");
    return row;
  }

  /** The ONLY status transitions this surface allows:
   * active -> disabled and disabled -> active. An invalidated
   * row is read-only here (delete or fresh re-grounding only) —
   * re-activating it would resurrect an answer whose sources
   * SA-B3 proved stale, breaking L4. */
  async setStoredAnswerStatus(organizationId: string, actorId: string, answerId: string, status: string) {
    if (status !== "active" && status !== "disabled") {
      throw badRequest("ai.statusMustBeActiveOrDisabled");
    }
    const row = await this.getAnswerOrThrow(organizationId, answerId);
    if (row.status === "invalidated") {
      throw badRequest("ai.thisAnswerWasInvalidatedAndCannot", { p1: row.invalidReason ?? "stale source" });
    }
    if (row.status === status) return row;
    const updated = await this.db().aiStoredAnswer.update({
      where: { id: row.id },
      data: { status },
    });
    await this.audit?.log({
      organizationId,
      userId: actorId,
      action: status === "disabled" ? "answer_store.disable" : "answer_store.enable",
      entityType: "AiStoredAnswer",
      entityId: row.id,
    });
    return updated;
  }

  async deleteStoredAnswer(organizationId: string, actorId: string, answerId: string) {
    const row = await this.getAnswerOrThrow(organizationId, answerId);
    await this.db().aiStoredAnswer.delete({ where: { id: row.id } });
    await this.audit?.log({
      organizationId,
      userId: actorId,
      action: "answer_store.delete",
      entityType: "AiStoredAnswer",
      entityId: row.id,
      metadata: { question: row.questionText, status: row.status, hitCount: row.hitCount },
    });
    return { deleted: true, id: row.id };
  }

  // ---------------- customer memory management ----------------

  async listCustomerMemories(organizationId: string, opts: { limit?: number; offset?: number } = {}) {
    const take = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const skip = Math.max(opts.offset ?? 0, 0);
    const where = { organizationId };
    const db = this.db();
    const [rows, total] = await Promise.all([
      db.customerMemory.findMany({
        where,
        orderBy: [{ lastInteractionAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
        take,
        skip,
      }),
      db.customerMemory.count({ where }),
    ]);
    return {
      items: (rows as any[]).map((r) => ({
        id: r.id,
        customerKey: r.customerKey,
        displayName: r.displayName ?? null,
        languagePref: r.languagePref ?? null,
        orderCount: r.orderCount,
        lastOrderAt: r.lastOrderAt ?? null,
        lastInteractionAt: r.lastInteractionAt ?? null,
        updatedAt: r.updatedAt,
      })),
      total,
    };
  }

  /** The per-customer "forget" act SA-B5 deferred to P9: erases
   * exactly one customer's memory row for THIS org. The memory
   * writer may re-learn the customer from future interactions —
   * forgetting is about the stored row, recorded in the audit. */
  async deleteCustomerMemory(organizationId: string, actorId: string, memoryId: string) {
    const row = await this.db().customerMemory.findFirst({ where: { id: memoryId, organizationId } });
    if (!row) throw notFound("ai.customerMemoryNotFound");
    await this.db().customerMemory.delete({ where: { id: row.id } });
    await this.audit?.log({
      organizationId,
      userId: actorId,
      action: "customer_memory.forget",
      entityType: "CustomerMemory",
      entityId: row.id,
      metadata: { customerKey: row.customerKey },
    });
    return { deleted: true, id: row.id };
  }
}
