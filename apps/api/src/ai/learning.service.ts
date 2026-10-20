import { Injectable, Logger, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AnswerStoreService, normalizeQuestion } from "./answer-store.service";
import { KnowledgeIndexingService } from "./knowledge-indexing.service";
import { badRequest, notFound } from "../i18n/api-exception";

/**
 * SA-B4 (Smart AI Phase 0, P5/P6): the learning core — the one
 * place mined knowledge waits for a human, and the one place a
 * human decision turns it live.
 *
 * Laws enforced here:
 *  - D3: a LearnedItem is a SUGGESTION. Nothing in this service
 *    (or in the miners that feed it) writes to the Answer Store
 *    or to KnowledgeDocuments except `approve`, which is a human
 *    act carrying the reviewer's id and an audit row.
 *  - L1: every read/write is organizationId-scoped; an item id
 *    from another org is a 404, never a leak.
 *  - L3: approval visibility defaults are conservative —
 *    conversation/unanswered-sourced facts land INTERNAL unless
 *    the approver explicitly chooses public.
 *
 * Approval application mapping (recorded for SA-B4):
 *  - faq_pair     -> AnswerStoreService.store(origin
 *    "staff_approved"). A store REFUSAL (PII screen, disabled
 *    entry, ...) is surfaced to the approver as a 400 and the
 *    item stays suggested — a safety refusal is never silently
 *    rerouted into a knowledge doc, which would bypass the very
 *    screen that refused it. (SA-B3 made the store work without
 *    embeddings, so "no vector" is not a refusal reason.)
 *  - fact         -> KnowledgeDocument kind "note", visibility =
 *    the approver's choice, defaulting to "public" for
 *    website/product sources (the org's own published/recorded
 *    material) and "internal" for conversation/unanswered
 *    sources.
 *  - product_note -> KnowledgeDocument kind "note", visibility
 *    "internal" (fixed — product notes are staff knowledge).
 *  - SA-B5: fact with sourceType "performance" -> kind "note",
 *    visibility "internal" (FIXED, not overridable — metrics
 *    are INTERNAL class by law L3).
 *  - SA-B14: fact with sourceType "ads" -> same FIXED internal
 *    landing (ad spend/ROAS are metrics of the same class).
 *  - SA-B16: fact with sourceType "creative" -> same FIXED
 *    internal landing (creative CTR/ROAS patterns are the
 *    owner's performance data, never customer-quotable).
 *  - SA-B17: fact with sourceType "competitor" -> same FIXED
 *    internal landing (a rival's prices and ad activity are
 *    the org's private intelligence, never customer-quotable).
 * Applied docs are indexed through the existing pipeline
 * (fire-and-forget, ProductsService pattern) so hybrid retrieval
 * sees them exactly like any other document.
 */

export type LearnedItemKind = "faq_pair" | "fact" | "product_note";
export type LearnedItemSource = "conversation" | "unanswered" | "website" | "product" | "performance" | "ads" | "creative" | "competitor";

export interface CreateSuggestionInput {
  kind: LearnedItemKind;
  title: string;
  content: Record<string, unknown>;
  sourceType: LearnedItemSource;
  sourceRef?: unknown;
}

/** The dedupe wall: same org + kind + normalized payload = the
 * same suggestion, however many times mining re-derives it. */
export function learnedItemDedupeKey(kind: string, content: Record<string, unknown>): string {
  let basis: string;
  if (kind === "faq_pair") {
    basis = `faq:${normalizeQuestion(String(content?.question ?? ""))}`;
  } else {
    basis = `${kind}:${String(content?.text ?? "").toLowerCase().replace(/\s+/g, " ").trim()}`;
  }
  return createHash("sha256").update(basis).digest("hex");
}

/** Default disclosure class when an approver does not choose. */
export function defaultApprovalVisibility(item: { kind: string; sourceType: string }): string {
  if (item.kind === "product_note") return "internal";
  // SA-B5 (P7): performance facts carry business metrics —
  // INTERNAL class by law L3, never a default-public source.
  // SA-B14 (A1): ads findings carry spend/ROAS — same class,
  // same rule. SA-B16 (A3): creative patterns carry CTR/ROAS —
  // same class, same rule. SA-B17 (C1): competitor findings
  // carry rival prices/activity — same class, same rule.
  if (item.sourceType === "performance" || item.sourceType === "ads" || item.sourceType === "creative" || item.sourceType === "competitor") return "internal";
  return item.sourceType === "website" || item.sourceType === "product" ? "public" : "internal";
}

@Injectable()
export class LearningService {
  private readonly logger = new Logger(LearningService.name);
  private answerStoreFallback?: AnswerStoreService;
  private indexingFallback?: KnowledgeIndexingService;

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly answerStore?: AnswerStoreService,
    @Optional() private readonly indexing?: KnowledgeIndexingService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private db(): any {
    if (!this.prisma) throw new Error("LearningService: PrismaService is not available");
    return this.prisma as any;
  }

  private store(): AnswerStoreService {
    return this.answerStore ?? (this.answerStoreFallback ??= new AnswerStoreService(this.prisma as any));
  }

  private indexer(): KnowledgeIndexingService {
    return this.indexing ?? (this.indexingFallback ??= new KnowledgeIndexingService(this.prisma as any));
  }

  /** The org's learning toggles + website source, from the
   * BusinessProfile (where the org's AI settings live). An org
   * with no profile row gets the schema defaults: conversation
   * mining OFF (D4), website learning ON but URL-less (inert). */
  async getToggles(organizationId: string): Promise<{
    conversationLearningEnabled: boolean;
    websiteLearningEnabled: boolean;
    websiteUrl: string | null;
  }> {
    const profile = await this.db().businessProfile.findUnique({
      where: { organizationId },
      select: { conversationLearningEnabled: true, websiteLearningEnabled: true, websiteUrl: true },
    });
    return {
      conversationLearningEnabled: profile?.conversationLearningEnabled === true,
      websiteLearningEnabled: profile ? profile.websiteLearningEnabled !== false : true,
      websiteUrl: profile?.websiteUrl ? String(profile.websiteUrl) : null,
    };
  }

  /** Create a suggestion unless the same one already exists for
   * the org (any status — a rejected suggestion is not re-mined
   * into existence again). Never throws into miners. */
  async createSuggestion(
    organizationId: string,
    input: CreateSuggestionInput,
  ): Promise<{ created: boolean; item?: any; reason?: string }> {
    try {
      const dedupeKey = learnedItemDedupeKey(input.kind, input.content);
      const existing = await this.db().learnedItem.findUnique({
        where: { organizationId_dedupeKey: { organizationId, dedupeKey } },
      });
      if (existing) return { created: false, item: existing, reason: "duplicate" };
      const item = await this.db().learnedItem.create({
        data: {
          organizationId,
          kind: input.kind,
          title: String(input.title ?? "").slice(0, 300),
          content: input.content as any,
          sourceType: input.sourceType,
          sourceRef: (input.sourceRef ?? null) as any,
          dedupeKey,
        },
      });
      return { created: true, item };
    } catch (e) {
      this.logger.error(
        `createSuggestion failed for org ${organizationId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return { created: false, reason: "create_failed" };
    }
  }

  async listItems(
    organizationId: string,
    opts: { status?: string; sourceType?: string; limit?: number; offset?: number } = {},
  ) {
    const take = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const skip = Math.max(opts.offset ?? 0, 0);
    const where: Record<string, unknown> = { organizationId };
    if (opts.status) where.status = opts.status;
    if (opts.sourceType) where.sourceType = opts.sourceType;
    const [items, total] = await Promise.all([
      this.db().learnedItem.findMany({ where, orderBy: { createdAt: "desc" }, take, skip }),
      this.db().learnedItem.count({ where }),
    ]);
    return { items, total };
  }

  private async getItemOrThrow(organizationId: string, itemId: string) {
    const item = await this.db().learnedItem.findFirst({ where: { id: itemId, organizationId } });
    if (!item) throw notFound("ai.learnedItemNotFound");
    return item;
  }

  /** Human approval: apply the suggestion, then stamp the item.
   * If application fails, the item stays "suggested" and the
   * error surfaces — an item is never marked approved for
   * knowledge that did not actually land. */
  async approve(
    organizationId: string,
    actorId: string,
    itemId: string,
    opts: { visibility?: string; via?: string } = {},
  ) {
    const item = await this.getItemOrThrow(organizationId, itemId);
    if (item.status !== "suggested") {
      throw badRequest("ai.learnedItemIsAlready", { itemStatus: item.status });
    }
    if (opts.visibility !== undefined && opts.visibility !== "public" && opts.visibility !== "internal") {
      throw badRequest("ai.visibilityMustBePublicOrInternal");
    }
    const content = (item.content ?? {}) as Record<string, unknown>;
    let appliedRef: string;

    if (item.kind === "faq_pair") {
      const question = String(content.question ?? "").trim();
      const answer = String(content.answer ?? "").trim();
      if (!question || !answer) throw badRequest("ai.faqPairSuggestionIsMissingIts");
      const result = await this.store().store(organizationId, {
        question,
        answer,
        channel: "inbox",
        origin: "staff_approved",
      });
      if (!result.stored) {
        throw badRequest("ai.answerStoreRefusedThisSuggestion", { resultReason: result.reason });
      }
      appliedRef = `answer:${result.entryId}`;
    } else if (item.kind === "fact" || item.kind === "product_note") {
      const text = String(content.text ?? "").trim();
      if (!text) throw badRequest("ai.suggestionIsMissingItsText", { itemKind: item.kind });
      // SA-B5 (P7): a performance fact is INTERNAL and that is
      // NOT overridable — an approver cannot make order counts
      // or campaign returns quotable to customers (law L3).
      // SA-B14 (A1): ads findings (spend/ROAS) get the same
      // non-overridable INTERNAL landing. SA-B16 (A3):
      // creative patterns (CTR/ROAS) likewise. SA-B17 (C1):
      // competitor findings (rival prices/activity) likewise.
      const visibility =
        item.kind === "product_note" || item.sourceType === "performance" || item.sourceType === "ads" || item.sourceType === "creative" || item.sourceType === "competitor"
          ? "internal"
          : opts.visibility ?? defaultApprovalVisibility(item);
      const doc = await this.db().knowledgeDocument.create({
        data: {
          organizationId,
          kind: "note",
          title: String(item.title ?? "").slice(0, 200) || "Learned note",
          content: text,
          visibility,
          source: `learned:${item.sourceType}`,
        },
      });
      appliedRef = `knowledge:${doc.id}`;
      // Fire-and-forget indexing, the ProductsService pattern: a
      // save never fails because embeddings are unavailable.
      void this.indexer()
        .indexDocument(doc)
        .catch(() => undefined);
    } else {
      throw badRequest("ai.unknownLearnedItemKind", { itemKind: item.kind });
    }

    const updated = await this.db().learnedItem.update({
      where: { id: item.id },
      // SA-B23: reviewedVia records WHERE the decision was
      // made ("org" = the tenant's own queue, "admin_console"
      // = a SUPER admin's console fix). The tenant path passes
      // no via and stays "org"; the console passes its marker
      // explicitly — the actor is never impersonated either way.
      data: { status: "approved", reviewedById: actorId, reviewedAt: new Date(), reviewedVia: opts.via ?? "org", appliedRef },
    });
    await this.audit?.log({
      organizationId,
      userId: actorId,
      action: "learning.approve",
      entityType: "LearnedItem",
      entityId: item.id,
      metadata: { kind: item.kind, sourceType: item.sourceType, appliedRef, ...(opts.via ? { via: opts.via } : {}) },
    });
    return updated;
  }

  async reject(organizationId: string, actorId: string, itemId: string, opts: { via?: string } = {}) {
    const item = await this.getItemOrThrow(organizationId, itemId);
    if (item.status !== "suggested") {
      throw badRequest("ai.learnedItemIsAlready", { itemStatus: item.status });
    }
    const updated = await this.db().learnedItem.update({
      where: { id: item.id },
      // SA-B23: same reviewedVia provenance stamp as approve().
      data: { status: "rejected", reviewedById: actorId, reviewedAt: new Date(), reviewedVia: opts.via ?? "org" },
    });
    await this.audit?.log({
      organizationId,
      userId: actorId,
      action: "learning.reject",
      entityType: "LearnedItem",
      entityId: item.id,
      metadata: { kind: item.kind, sourceType: item.sourceType, ...(opts.via ? { via: opts.via } : {}) },
    });
    return updated;
  }

  /** Read/write the durable per-source run state (watermark +
   * last-run summary) used by the mining/refresh sweeps. */
  async getState(organizationId: string, source: string) {
    return this.db().learningState.findUnique({
      where: { organizationId_source: { organizationId, source } },
    });
  }

  async saveState(
    organizationId: string,
    source: string,
    data: { watermark?: Date | null; lastStatus?: string; lastDetail?: unknown },
  ) {
    const now = new Date();
    return this.db().learningState.upsert({
      where: { organizationId_source: { organizationId, source } },
      create: {
        organizationId,
        source,
        watermark: data.watermark ?? null,
        lastRunAt: now,
        lastStatus: data.lastStatus ?? null,
        lastDetail: (data.lastDetail ?? null) as any,
      },
      update: {
        ...(data.watermark !== undefined ? { watermark: data.watermark } : {}),
        lastRunAt: now,
        ...(data.lastStatus !== undefined ? { lastStatus: data.lastStatus } : {}),
        ...(data.lastDetail !== undefined ? { lastDetail: data.lastDetail as any } : {}),
      },
    });
  }
}
