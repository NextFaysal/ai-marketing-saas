import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { LlmFactory, providerForOrg } from "../ai/llm/llm.factory";
import { badRequest, notFound } from "../i18n";

/** Exact refusal surfaced to staff when no real LLM is configured. */
export const NO_LLM_MESSAGE = "LLM কনফিগার করা নেই — AI সারসংক্ষেপ উপলব্ধ নয়";

/**
 * AX15 — AI review insights.
 *
 * STAFF-triggered only: a staff member explicitly asks for a
 * summary of one product's OWN store reviews (OrderReview rows);
 * the org's real LLM (same LlmFactory + providerForOrg path as
 * ProposalsService) reads the review texts and returns a JSON
 * summary + sentiment counts + themes, stored as ONE
 * ProductReviewInsight row per (org, product) and refreshed only
 * when staff generate again. Nothing is ever auto-generated.
 *
 * REVIEW SELECTION (mirrors ProductReviewsService.ownReviewsRaw):
 * an own review counts when it belongs to an order of this org
 * that contains the product (resolved product → order items →
 * org orders), carries a rating, has been received (receivedAt
 * set — rows are created only after a delivery event), and is
 * visible (isVisible !== false). External reviews are NEVER
 * included — we did not witness those purchases.
 *
 * COUNT BASIS (one consistent basis everywhere): a review is
 * countable only when it also carries text — a rating-only review
 * cannot be summarized, so counting it would make a fresh insight
 * look permanently stale. `reviewCountAtGeneration`, the
 * sentiment total and the staff GET `currentReviewCount` all use
 * this same basis (visible + rated + received + text-carrying).
 */
@Injectable()
export class ReviewInsightsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly llmFactory?: LlmFactory,
  ) {}

  private p(): any { return this.prisma as any; }

  private async assertProduct(organizationId: string, productId: string) {
    const product = await (this.p().product?.findFirst({
      where: { id: productId, organizationId },
    }).catch(() => null) ?? null);
    if (!product) throw notFound("commerce.productNotFoundShort");
    return product;
  }

  /** Org-scoped orders that contain this product (mirrors
   *  ProductReviewsService.orderIdsForProduct). */
  private async orderIdsForProduct(organizationId: string, productId: string): Promise<string[]> {
    const items = await (this.p().orderItem?.findMany({
      where: { productId }, select: { orderId: true },
    }).catch(() => []) ?? []);
    const orderIds = [...new Set(items.map((i: any) => i.orderId).filter(Boolean))] as string[];
    if (!orderIds.length) return [];
    const orders = await (this.p().order?.findMany({
      where: { organizationId, id: { in: orderIds } }, select: { id: true },
    }).catch(() => []) ?? []);
    const owned = new Set(orders.map((o: any) => o.id));
    return orderIds.filter((id) => owned.has(id));
  }

  /**
   * The product's own countable reviews (see the class doc for the
   * basis), newest first by receivedAt (createdAt fallback).
   * `withTextOnly` is the generation/count basis; the raw rated
   * set is kept available for completeness.
   */
  private async ownCountableReviews(organizationId: string, productId: string) {
    const orderIds = await this.orderIdsForProduct(organizationId, productId);
    if (!orderIds.length) return [] as any[];
    const rows = (await (this.p().orderReview?.findMany({
      where: { organizationId }, orderBy: { receivedAt: "desc" }, take: 500,
    }).catch(() => []) ?? []))
      .filter((r: any) =>
        orderIds.includes(r.orderId)
        && r.rating != null
        && r.receivedAt != null
        && r.isVisible !== false
        && typeof r.comment === "string"
        && r.comment.trim().length > 0);
    rows.sort((a: any, b: any) =>
      new Date(b.receivedAt ?? b.createdAt ?? 0).getTime() - new Date(a.receivedAt ?? a.createdAt ?? 0).getTime());
    return rows;
  }

  private toPayload(row: any) {
    if (!row) return null;
    return {
      id: row.id,
      organizationId: row.organizationId,
      productId: row.productId,
      summaryText: row.summaryText,
      sentiment: row.sentimentJson ?? null,
      themes: Array.isArray(row.themesJson) ? row.themesJson : [],
      reviewCount: row.reviewCountAtGeneration,
      generatedAt: row.generatedAt,
      generatedById: row.generatedById ?? null,
      modelLabel: row.modelLabel ?? null,
    };
  }

  /**
   * Generate (or regenerate) the insight for one product.
   * Failure honesty: no real LLM → the exact NO_LLM_MESSAGE
   * refusal; LLM throw / unparseable JSON / invalid summary →
   * BadRequestException and NOTHING is written, so a previous
   * insight stays intact.
   */
  async generate(organizationId: string, productId: string, actorId?: string) {
    const product = await this.assertProduct(organizationId, productId);
    const countable = await this.ownCountableReviews(organizationId, productId);
    const reviews = countable.slice(0, 100).map((r: any) => ({
      rating: r.rating,
      text: String(r.comment).trim(),
    }));
    const reviewCount = reviews.length;
    if (reviewCount === 0) {
      throw badRequest("orders.noTextReviewsForSummary");
    }

    if (!this.llmFactory) throw badRequest("orders.noLlmConfigured");
    const provider: any = await providerForOrg(this.llmFactory, organizationId).catch(() => null);
    if (!provider?.isRealLlm) throw badRequest("orders.noLlmConfigured");

    let result: any;
    try {
      result = await provider.complete([
        {
          role: "system",
          content: "You summarize real customer product reviews for a shop owner. Use ONLY the reviews given; invent nothing. Return ONLY JSON with keys: summary (string, in Bengali, at most ~3 sentences), positive (integer count of positive reviews), neutral (integer), negative (integer), themes (array of at most 5 short strings naming recurring themes). The counts classify the reviews given and must add up to at most the number of reviews given.",
        },
        {
          role: "user",
          content: JSON.stringify({
            product: product.name,
            reviewCount,
            reviews: reviews.map((r: any, i: number) => ({ n: i + 1, rating: r.rating, text: r.text.slice(0, 1000) })),
          }),
        },
      ], { jsonMode: true });
    } catch (e) {
      throw e instanceof Error ? new BadRequestException(e.message) : badRequest("orders.llmSummaryGenFailed");
    }

    let parsed: any;
    try {
      const raw = String(result?.text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      parsed = JSON.parse(raw);
    } catch (e) {
      throw badRequest("orders.llmResponseNotJson", { detail: e instanceof Error ? e.message : "parse error" });
    }

    // ---- sanitize ----
    const summaryText = typeof parsed?.summary === "string" ? parsed.summary.trim().slice(0, 1200) : "";
    if (!summaryText) {
      throw badRequest("orders.llmNoValidSummary");
    }
    const clampCount = (v: any) => {
      const n = Math.floor(Number(v));
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    let positive = clampCount(parsed?.positive);
    let neutral = clampCount(parsed?.neutral);
    let negative = clampCount(parsed?.negative);
    // Count-clamping choice: when the LLM's counts overshoot the
    // reviews actually sent, scale all three DOWN proportionally
    // (floor each) so positive+neutral+negative <= reviewCount
    // always holds and no sentiment is favoured over another; the
    // floored remainder is simply left unclassified.
    const totalCounted = positive + neutral + negative;
    if (totalCounted > reviewCount) {
      const f = reviewCount / totalCounted;
      positive = Math.floor(positive * f);
      neutral = Math.floor(neutral * f);
      negative = Math.floor(negative * f);
    }
    const themes: string[] = Array.isArray(parsed?.themes)
      ? parsed.themes
          .filter((t: any) => typeof t === "string" && t.trim().length > 0)
          .map((t: string) => t.trim().slice(0, 80))
          .slice(0, 5)
      : [];

    const sentimentJson = { positive, neutral, negative, total: reviewCount };
    const modelLabel = (typeof result?.model === "string" && result.model) || (typeof provider?.model === "string" && provider.model) || null;
    const generatedAt = new Date();
    const data: any = {
      summaryText,
      sentimentJson,
      themesJson: themes,
      reviewCountAtGeneration: reviewCount,
      generatedAt,
      generatedById: actorId ?? null,
      modelLabel,
    };

    // Upsert on the (organizationId, productId) unique pair —
    // find-then-write so the same path works on every client.
    const existing = await (this.p().productReviewInsight?.findFirst({
      where: { organizationId, productId },
    }).catch(() => null) ?? null);
    const saved = existing
      ? await this.p().productReviewInsight.update({ where: { id: existing.id }, data })
      : await this.p().productReviewInsight.create({
          data: { organizationId, productId, ...data },
        });

    // Usage recording (mirrors ChatService's AIUsageRecord write).
    // Failure-isolated: a failed usage write must not fail the
    // generation the staff member already paid an LLM call for.
    try {
      const hasTokens = typeof result?.inputTokens === "number" || typeof result?.outputTokens === "number";
      await this.p().aIUsageRecord?.create({
        data: {
          organizationId,
          userId: actorId ?? null,
          feature: "review_insight",
          provider: provider.name ?? "unknown",
          model: modelLabel ?? undefined,
          inputTokens: hasTokens ? (result.inputTokens ?? 0) : 0,
          outputTokens: hasTokens ? (result.outputTokens ?? 0) : 0,
          estimated: hasTokens ? result.tokensEstimated === true : true,
        },
      });
    } catch { /* usage accounting is best-effort */ }

    await this.audit?.log({
      organizationId, userId: actorId ?? "system", action: "product_review_insight.generate",
      entityType: "ProductReviewInsight", entityId: saved?.id,
      metadata: { productId, reviewCount, modelLabel },
    }).catch(() => undefined);

    return this.toPayload(saved ?? { id: existing?.id, organizationId, productId, ...data });
  }

  /** Staff read: the stored insight + staleness math. */
  async getForStaff(organizationId: string, productId: string) {
    await this.assertProduct(organizationId, productId);
    const insight = await (this.p().productReviewInsight?.findFirst({
      where: { organizationId, productId },
    }).catch(() => null) ?? null);
    const countable = await this.ownCountableReviews(organizationId, productId);
    const currentReviewCount = countable.length;
    return {
      insight: this.toPayload(insight),
      currentReviewCount,
      reviewsSinceGeneration: insight
        ? Math.max(0, currentReviewCount - (insight.reviewCountAtGeneration ?? 0))
        : 0,
    };
  }

  /** Public read by slugs: PDP box data, or { insight: null }. */
  async getPublicBySlug(orgSlug: string, productSlug: string) {
    const org = await (this.p().organization?.findFirst({ where: { slug: orgSlug } }).catch(() => null) ?? null);
    if (!org) throw notFound("orders.storeNotFound");
    const product = await (this.p().product?.findFirst({
      where: { organizationId: org.id, slug: productSlug, status: "ACTIVE" },
    }).catch(() => null) ?? null);
    if (!product) throw notFound("commerce.productNotFoundShort");
    const insight = await (this.p().productReviewInsight?.findFirst({
      where: { organizationId: org.id, productId: product.id },
    }).catch(() => null) ?? null);
    if (!insight) return { insight: null };
    return {
      summaryText: insight.summaryText,
      sentiment: insight.sentimentJson ?? null,
      themes: Array.isArray(insight.themesJson) ? insight.themesJson : [],
      generatedAt: insight.generatedAt,
      reviewCount: insight.reviewCountAtGeneration,
    };
  }
}
