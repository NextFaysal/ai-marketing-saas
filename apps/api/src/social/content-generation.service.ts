import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { LlmFactory, providerForOrg } from "../ai/llm/llm.factory";
import { CreativeLearningService } from "../ai/creative-learning.service";
import { buildStyleInstructions } from "../ai/org-brain.service";
import { extractGuardNumbers } from "../inbox/business-brain";
import { policyFindingsForText } from "../campaigns/policy-check";
import { formatMinor } from "@repo/contracts";
import { SocialService } from "./social.service";
import { suggestSocialHashtags } from "./social-ai.service";
import { GenerateContentDto } from "./content-generation.dto";
import { ApiException, badRequest, notFound, forbidden } from "../i18n/api-exception";
import { resolveOwnerLanguageForOrg } from "../ai/owner-language";

/** SA-B19 (G1): the per-call variant cap — a named constant so
 *  no caller can turn generation into a cost storm. */
export const CONTENT_GENERATION_MAX_VARIANTS = 5;
export const CONTENT_GENERATION_DEFAULT_VARIANTS = 3;
/** The AIUsageRecord feature bucket for this generator. */
export const CONTENT_GENERATION_FEATURE = "content_generation";
/** Item 2 attribution: the SocialPost.autoDraftKind stamp every
 *  generated draft carries (SU5 provenance columns); the ref is
 *  "product:<id>" | "learned:<id>" | "topic". Per-post insights
 *  (SP7, SocialPost.insights) already exist, so a later
 *  generated-vs-manual comparison can group by this tag — no
 *  analytics are built here, and none are claimed. */
export const CONTENT_GENERATION_AUTO_DRAFT_KIND = "ai_content";
/** How many SA-B16 winning exemplars ride into the prompt as
 *  style references (few-shot). */
export const CONTENT_GENERATION_EXEMPLAR_LIMIT = 3;

/**
 * Typed refusal for an org with no real LLM configured (the
 * MS9/SU4 honest pattern): generation without a real model
 * would be a canned template passed off as AI, so the call
 * fails with a stable machine-readable code instead.
 */
export class LlmNotConfiguredError extends HttpException {
  constructor() {
    super(
      {
        code: "LLM_NOT_CONFIGURED",
        message:
          "আসল AI (LLM) configure করা নেই — Content Generation-এর জন্য Admin Panel → Platform Config-এ LLM সেট করুন। Dev template দিয়ে content বানানো হবে না।",
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

interface ResolvedSource {
  type: "product" | "learned_item" | "topic";
  /** Provenance ref stamped on every created draft. */
  ref: string;
  factLines: string[];
  product: any | null;
  /** Token source for the deterministic hashtag suggester. */
  tagTopic?: string;
}

/**
 * SA-B19 (Smart AI Phase 5, G1) — AI Social Content Generation.
 *
 * What makes this G1 rather than another copy helper: the topic
 * sources are Brain assets — a LIVE product row, an APPROVED
 * LearnedItem (an A3 creative pattern, a C2 competitor
 * counter-idea, a P7 performance fact) or a staff topic — the
 * prompt carries the org's brand voice (owner text + the
 * SA-B5 learned profile, via the ONE precedence builder
 * OrgBrainService uses) and the SA-B16 winning exemplars as
 * style references, and EVERY returned variant must pass the
 * shared number guard (extractGuardNumbers, the SA-B3
 * extraction the inbox/Answer Store/B14 narration all run)
 * against the grounded fact pack before it may become a post.
 *
 * Standing rules honoured structurally:
 *  - DRAFT-ONLY (L5): survivors become real draft posts via
 *    SocialService.createPost — the ONE creation path — with
 *    no scheduledAt and no publish call anywhere in this file.
 *    A human reviews, edits, schedules and publishes.
 *  - REAL-LLM ONLY: a non-real provider is a typed 503, never
 *    a dev template (SU4 precedent; SP3's labelled templates
 *    stay SP3's own surface, untouched).
 *  - Enforcement mirrors SP3: platform kill switch + the
 *    org's daily AI cap run BEFORE any load, under this
 *    generator's own feature bucket; the AIUsageRecord is
 *    written after provider success, before parsing.
 *  - The guard's allowed set is built from the FACT PACK ONLY.
 *    Exemplar texts are style references: their numbers are
 *    NOT admitted, so a caption echoing a stale price out of
 *    an old winning ad is dropped like any invented number.
 */
@Injectable()
export class ContentGenerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmFactory,
    private readonly social: SocialService,
    private readonly creative: CreativeLearningService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  /** SP3's enforcement discipline, this generator's bucket. */
  private async checkDailyLimit(organizationId: string) {
    const { killSwitches, effectiveLimits, isAiDisabledForOrg } = await import("../common/platform-settings");
    const ks = await killSwitches(this.prisma as any);
    if (isAiDisabledForOrg(ks, organizationId)) {
      throw forbidden(ks.aiGloballyPaused ? "social.aiFeaturesTemporarilyPausedPlatformWide" : "social.aiFeaturesTemporarilyDisabledForThisOrganization");
    }
    const baseline = Number(process.env.AI_DAILY_MESSAGE_LIMIT ?? 200);
    const { aiDaily: limit } = await effectiveLimits(this.prisma as any, organizationId, { aiDaily: baseline, broadcastCap: 1000 });
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const used = await (this.prisma as any).aIUsageRecord.count({
      where: { organizationId, feature: CONTENT_GENERATION_FEATURE, createdAt: { gte: startOfDay } },
    });
    if (used >= limit) {
      throw new ApiException("social.dailyAiGenerationLimitReachedFor2", { limit: limit }, 429);
    }
  }

  private async resolveSource(organizationId: string, dto: GenerateContentDto): Promise<ResolvedSource> {
    if (dto.sourceType === "product") {
      const productId = typeof dto.productId === "string" ? dto.productId.trim() : "";
      if (!productId) throw badRequest("social.productSourceProductid");
      const product = await (this.prisma as any).product.findFirst({
        where: { id: productId, organizationId },
      });
      if (!product) throw notFound("social.productNotFoundInThisOrganization");
      const factLines: string[] = [`Product name: ${product.name}`];
      if (product.category) factLines.push(`Category: ${product.category}`);
      if (product.description) factLines.push(`Description: ${product.description}`);
      // The LIVE price joins the fact pack ONLY on the caller's
      // explicit opt-in — a product post is not automatically a
      // price post (brief, Item 1a).
      if (dto.includePrice === true) {
        try {
          factLines.push(`Price: ${formatMinor(BigInt(product.priceMinor), product.currency)}`);
          if (product.compareAtMinor !== null && product.compareAtMinor !== undefined) {
            factLines.push(`Compare-at price: ${formatMinor(BigInt(product.compareAtMinor), product.currency)}`);
          }
        } catch { /* a malformed price contributes no price fact */ }
      }
      return { type: "product", ref: `product:${product.id}`, factLines, product };
    }

    if (dto.sourceType === "learned_item") {
      const learnedItemId = typeof dto.learnedItemId === "string" ? dto.learnedItemId.trim() : "";
      if (!learnedItemId) throw badRequest("social.learnedItemSourceLearneditemid");
      const item = await (this.prisma as any).learnedItem.findFirst({
        where: { id: learnedItemId, organizationId },
      });
      if (!item) throw notFound("social.learnedItemNotFoundInThis");
      // D3/L2: only APPROVED learning is knowledge. A suggested
      // (or rejected) item is a proposal a human has not
      // accepted — generating content from it would launder an
      // unreviewed claim into a public post.
      if (item.status !== "approved") {
        throw badRequest("social.contentCanOnlyBeMadeFrom");
      }
      const content = (item.content ?? {}) as any;
      const factLines: string[] = [`Approved insight (${item.sourceType}): ${item.title}`];
      if (item.kind === "faq_pair") {
        if (content.question) factLines.push(`Question: ${content.question}`);
        if (content.answer) factLines.push(`Answer: ${content.answer}`);
      } else if (typeof content.text === "string" && content.text.trim()) {
        factLines.push(content.text.trim());
      }
      return { type: "learned_item", ref: `learned:${item.id}`, factLines, product: null, tagTopic: String(item.title ?? "") };
    }

    const topic = typeof dto.topic === "string" ? dto.topic.trim() : "";
    if (!topic) throw badRequest("social.topicSourceTopic");
    return { type: "topic", ref: "topic", factLines: [`Topic: ${topic}`], product: null, tagTopic: topic };
  }

  async generate(organizationId: string, userId: string, dto: GenerateContentDto) {
    // Enforcement FIRST (before any load), mirroring SP3/SU4.
    await this.checkDailyLimit(organizationId);

    // MB5 (ML13, CD-8 #14): dto.language still wins; absent, the
    // default comes from the shared OWNER chain, not a hardcoded bn.
    const { language } = await resolveOwnerLanguageForOrg(this.prisma as any, {
      organizationId,
      userId,
      dtoLanguage: dto.language ?? null,
    });
    const count = Math.min(
      CONTENT_GENERATION_MAX_VARIANTS,
      Math.max(1, Math.floor(dto.count ?? CONTENT_GENERATION_DEFAULT_VARIANTS)),
    );

    const source = await this.resolveSource(organizationId, dto);

    const profile = await (this.prisma as any).businessProfile
      ?.findUnique({ where: { organizationId } })
      .catch(() => null);

    const factLines: string[] = [...source.factLines];
    if (profile?.industry) factLines.push(`Business industry: ${profile.industry}`);
    if (profile?.description) factLines.push(`About the business: ${profile.description}`);
    if (profile?.uniqueSellingPoints) factLines.push(`Unique selling points: ${profile.uniqueSellingPoints}`);

    // Brand voice: the owner's explicit text + the SA-B5
    // learned profile, composed by the ONE precedence builder
    // (buildStyleInstructions — owner text leads, learned style
    // applies only where it does not conflict, and the block is
    // null unless an ACTIVE learned profile exists). With no
    // active profile, the owner's text alone rides as a fact,
    // exactly as SP3 carried it.
    const voiceRow = await (this.prisma as any).aiBrandVoiceProfile
      ?.findUnique({ where: { organizationId } })
      .catch(() => null);
    const styleInstructions = buildStyleInstructions(profile?.brandVoice ?? null, voiceRow);
    if (!styleInstructions && profile?.brandVoice) {
      factLines.push(`Brand voice: ${profile.brandVoice}`);
    }

    // SA-B16 exemplars — the org's own top-performing ad copy,
    // read through the Creative Intelligence report (the same
    // service method the tenant API serves). Style references
    // ONLY: the prompt says so, and the guard below does not
    // admit their numbers into the allowed set. A metrics-read
    // failure degrades to no exemplars rather than blocking
    // grounded generation on an optional style input; the
    // count used is reported back (exemplarsUsed).
    let exemplars: { primaryText: string; headline: string | null }[] = [];
    try {
      const report = await this.creative.computeReport(organizationId);
      exemplars = (report?.exemplars ?? [])
        .slice(0, CONTENT_GENERATION_EXEMPLAR_LIMIT)
        .map((u: any) => ({ primaryText: String(u.primaryText ?? ""), headline: u.headline ?? null }))
        .filter((u: any) => u.primaryText.trim());
    } catch {
      exemplars = [];
    }

    const provider = await providerForOrg(this.llm, organizationId);
    if (!provider.isRealLlm) throw new LlmNotConfiguredError();

    const factsText = factLines.join("\n");
    const systemPrompt = [
      "You write social media post captions for a business in the AI Content Generator.",
      "Use ONLY the given facts. Never invent prices, discounts, stock, delivery promises, features or results.",
      "Any number you write must appear in the given facts, exactly as given.",
      language === "bn" ? "Write in Bengali (Bangla script)." : "Write in English.",
      ...(styleInstructions ? [`Voice and style:\n${styleInstructions}`] : []),
      ...(exemplars.length
        ? [
            "Style references — this business's own best-performing ad copy, given in the request. Match their style, structure and energy, but take NO facts and NO numbers from them; facts come only from the request's fact list.",
          ]
        : []),
      `Return ONLY JSON {"variants":[{"caption":string,"imageBrief":string}]} with exactly ${count} variants.`,
      "caption must be at most 2000 characters. imageBrief is ONE short line describing a photo idea for the post (text only — no image is generated).",
    ].join("\n");
    const userMessage = [
      `Facts:\n${factsText}`,
      ...(exemplars.length
        ? [`Style references:\n${exemplars.map((u) => `- "${u.primaryText}"${u.headline ? ` (headline: ${u.headline})` : ""}`).join("\n")}`]
        : []),
    ].join("\n\n");

    let result: any;
    try {
      result = await provider.complete(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        { jsonMode: true, maxTokens: 1600 },
      );
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? String(e));
    }

    // Usage AFTER provider success, BEFORE parsing (house
    // discipline) — the row stands even if every variant is
    // dropped below: the provider did the work.
    await (this.prisma as any).aIUsageRecord.create({
      data: {
        organizationId,
        userId,
        feature: CONTENT_GENERATION_FEATURE,
        provider: provider.name,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        estimated: result.tokensEstimated,
      },
    });

    // The shared number guard (SA-B3 extraction): a variant may
    // carry ONLY numbers present in the fact pack. An invented
    // price/offer number drops the whole variant — numbers are
    // never silently edited into compliance.
    const allowedNumbers = new Set<string>(extractGuardNumbers(factsText));

    let parsed: any = null;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      parsed = null;
    }
    const rawVariants: any[] = Array.isArray(parsed?.variants) ? parsed.variants : [];
    const survivors: { caption: string; imageBrief: string }[] = [];
    let droppedCount = 0;
    for (const raw of rawVariants) {
      if (survivors.length >= count) break;
      const caption = typeof raw?.caption === "string" ? raw.caption.trim().slice(0, 2200) : "";
      if (!caption) continue;
      const imageBrief = typeof raw?.imageBrief === "string" ? raw.imageBrief.trim().slice(0, 300) : "";
      const ungrounded = extractGuardNumbers(`${caption}\n${imageBrief}`).filter((n) => !allowedNumbers.has(n));
      if (ungrounded.length > 0) {
        droppedCount++;
        continue;
      }
      survivors.push({ caption, imageBrief });
    }

    if (survivors.length === 0) {
      throw droppedCount > 0
        ? badRequest("social.aiVariantsAllDroppedNumbersOutsideFacts", { droppedCount })
        : badRequest("social.theAiProviderReturnedNoUsable");
    }

    const hashtags = suggestSocialHashtags({
      product: source.product ?? undefined,
      businessProfile: profile ?? undefined,
      topic: source.tagTopic,
    });

    // DRAFT-ONLY persistence: every survivor becomes a real
    // draft through the ONE creation path. No scheduledAt is
    // ever passed and no publish path is called — scheduling
    // and publishing stay human acts in the composer.
    const drafts: any[] = [];
    for (const v of survivors) {
      const storedCaption = hashtags.length ? `${v.caption}\n\n${hashtags.join(" ")}` : v.caption;
      const post = await this.social.createPost(organizationId, userId, {
        socialAccountId: dto.socialAccountId,
        caption: storedCaption,
        autoDraftKind: CONTENT_GENERATION_AUTO_DRAFT_KIND,
        autoDraftRef: source.ref,
      });
      drafts.push({
        postId: post.id,
        caption: storedCaption,
        hashtags,
        imageBrief: v.imageBrief,
        policy: (() => {
          const findings = policyFindingsForText(v.caption);
          return { status: findings.length ? "flagged" : "pass", findings };
        })(),
      });
    }

    await this.audit?.log({
      organizationId,
      userId,
      action: "social.content_generated",
      entityType: "SocialPost",
      entityId: drafts[0]?.postId,
      metadata: { sourceType: source.type, sourceRef: source.ref, created: drafts.length, droppedCount, exemplarsUsed: exemplars.length },
    });

    return {
      provider: provider.name,
      source: { type: source.type, ref: source.ref },
      exemplarsUsed: exemplars.length,
      droppedCount,
      drafts,
    };
  }
}
