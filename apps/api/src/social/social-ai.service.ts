import { BadRequestException, HttpException, Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { LlmFactory, providerForOrg } from "../ai/llm/llm.factory";
import { estimateTokens } from "../ai/llm/llm.types";
import { policyFindingsForText } from "../campaigns/policy-check";
import { formatMinor } from "@repo/contracts";
import { SocialService } from "./social.service";
import { SocialImportService } from "./social-import.service";
import { ApiException, badRequest, notFound, forbidden } from "../i18n/api-exception";
import { resolveOwnerLanguageForOrg } from "../ai/owner-language";

/**
 * SU4: numbers in a text, normalized for the grounding guard
 * (the inbox extractNumbers discipline: Bengali digits -> Latin,
 * thousands separators stripped, canonical Number() form so
 * "১,৫০০" and "1500.00" both become "1500").
 */
export function extractSocialNumbers(text: string): string[] {
  const normalized = String(text ?? "")
    .replace(/[০-৯]/g, (d) => "০১২৩৪৫৬৭৮৯".indexOf(d).toString())
    .replace(/,/g, "");
  return (normalized.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n)));
}

/** The numbers in `text` that are NOT in the allowed set. */
export function ungroundedNumbers(text: string, allowed: Set<string>): string[] {
  return extractSocialNumbers(text).filter((n) => !allowed.has(n));
}

/**
 * Deterministic hashtag suggestions — pure and exported for tests.
 * Tokens come ONLY from grounded fields (product category/name,
 * business industry, the user's own topic): apostrophes are
 * removed first ("Men's" -> "mens"), the rest is split on
 * non-alphanumerics, and only Latin [a-z0-9] words of length >= 3
 * survive. Bengali words therefore yield no tokens — that is the
 * documented deterministic behaviour; no trending tags are invented.
 */
export function suggestSocialHashtags(input: {
  product?: any;
  businessProfile?: any;
  topic?: string;
}): string[] {
  const sources: unknown[] = [
    input.product?.category,
    input.product?.name,
    input.businessProfile?.industry,
    input.topic,
  ];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const source of sources) {
    if (typeof source !== "string" || !source) continue;
    const cleaned = source.replace(/['’]/g, "");
    for (const raw of cleaned.split(/[^A-Za-z0-9]+/)) {
      const word = raw.toLowerCase();
      if (word.length < 3) continue;
      if (!/^[a-z0-9]+$/.test(word)) continue;
      if (seen.has(word)) continue;
      seen.add(word);
      tags.push(`#${word}`);
      if (tags.length >= 8) return tags;
    }
  }
  return tags;
}

/**
 * SP3 — AI Copy for social posts. Mirrors M55 Creative Studio
 * (creative-studio.service.ts) exactly for enforcement, grounding
 * and post-processing: kill switch + daily cap BEFORE any load,
 * facts built ONLY from the product / Business Brain / the user's
 * topic, a prompt that forbids inventing prices/discounts/stock/
 * delivery/features/results, an AIUsageRecord written after
 * provider success and before parsing on the real path, and policy
 * findings attached per variant. Like M55, there is NO numeric
 * post-check dropping variants with invented prices — the guards
 * are the prompt prohibition + grounded facts + policy findings.
 */
@Injectable()
export class SocialAiService {
  private readonly social?: SocialService;
  private readonly importer?: SocialImportService;
  private readonly audit?: AuditService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmFactory,
    // SU4: materialize needs the ONE post-creation path and the
    // PP3 importer. Both are @Optional so the many existing specs
    // that construct this service with (prisma, llm) keep working
    // unchanged — without them materialize refuses honestly.
    // (social.service / social-import.service never import this
    // service, so there is no import cycle.)
    @Optional() social?: SocialService,
    @Optional() importer?: SocialImportService,
    @Optional() audit?: AuditService,
  ) {
    this.social = social;
    this.importer = importer;
    this.audit = audit;
  }

  private async checkDailyLimit(organizationId: string, feature = "social_copy") {
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
      where: { organizationId, feature, createdAt: { gte: startOfDay } },
    });
    if (used >= limit) {
      throw new ApiException("social.dailyAiGenerationLimitReachedFor2", { limit: limit }, 429);
    }
  }

  async generateCopy(
    organizationId: string,
    userId: string,
    dto: { productId?: string; topic?: string; tone?: string; language?: string; count?: number; platform?: string },
  ) {
    // Enforcement FIRST (before any load), mirroring M55.
    await this.checkDailyLimit(organizationId);

    // MB5 (ML13, CD-8 #13): dto.language still wins; absent, the
    // default comes from the shared OWNER chain, not a hardcoded bn.
    const { language } = await resolveOwnerLanguageForOrg(this.prisma as any, {
      organizationId,
      userId,
      dtoLanguage: dto.language ?? null,
    });
    const count = Math.min(5, Math.max(1, Math.floor(dto.count ?? 3)));
    const topic = dto.topic?.trim() ? dto.topic.trim() : undefined;

    let product: any = null;
    if (dto.productId) {
      product = await (this.prisma as any).product.findFirst({
        where: { id: dto.productId, organizationId },
      });
      if (!product) throw notFound("social.productNotFoundInThisOrganization");
    } else if (!topic) {
      throw badRequest("social.productTopic");
    }

    const businessProfile = await (this.prisma as any).businessProfile
      ?.findUnique({ where: { organizationId } })
      .catch(() => null);

    const formattedPrice = product ? formatMinor(BigInt(product.priceMinor), product.currency) : null;
    const compareAtFormatted =
      product && product.compareAtMinor !== null && product.compareAtMinor !== undefined
        ? formatMinor(BigInt(product.compareAtMinor), product.currency)
        : null;

    const facts: string[] = [];
    if (product) {
      facts.push(`Product name: ${product.name}`);
      facts.push(`Price: ${formattedPrice}`);
      if (compareAtFormatted) facts.push(`Compare-at price: ${compareAtFormatted}`);
      if (product.category) facts.push(`Category: ${product.category}`);
      if (product.description) facts.push(`Description: ${product.description}`);
      if (product.stockQuantity !== null && product.stockQuantity !== undefined) {
        facts.push(`Stock quantity: ${product.stockQuantity}`);
      }
    }
    if (businessProfile?.brandVoice) facts.push(`Brand voice: ${businessProfile.brandVoice}`);
    if (businessProfile?.industry) facts.push(`Business industry: ${businessProfile.industry}`);
    if (businessProfile?.description) facts.push(`About the business: ${businessProfile.description}`);
    if (businessProfile?.uniqueSellingPoints) facts.push(`Unique selling points: ${businessProfile.uniqueSellingPoints}`);
    if (topic) facts.push(`Topic: ${topic}`);
    if (dto.tone) facts.push(`Tone: ${dto.tone}`);
    if (dto.platform === "meta_page") {
      facts.push("Platform: Facebook Page — a slightly longer, link-friendly caption works well.");
    } else if (dto.platform === "instagram") {
      facts.push("Platform: Instagram — keep the caption concise and hashtag-friendly.");
    }
    const factsText = facts.join("\n");

    const provider = await providerForOrg(this.llm, organizationId);

    let captions: string[] = [];
    let notice: string | undefined;

    if (provider.isRealLlm) {
      const systemPrompt = [
        "You write social media post captions for a business in the AI Social Copy generator.",
        "Use ONLY the given facts. Never invent prices, discounts, stock, delivery promises, features or results.",
        "If no price is among the facts, do not mention any price.",
        language === "bn"
          ? "Write in Bengali (Bangla script)."
          : "Write in English.",
        `Return ONLY JSON {"variants":[{"caption":string}]} with exactly ${count} variants.`,
        "caption must be at most 2000 characters.",
      ].join("\n");

      let result: any;
      try {
        result = await provider.complete(
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: factsText },
          ],
          { jsonMode: true, maxTokens: 1400 },
        );
      } catch (e: any) {
        throw new BadRequestException(e?.message ?? String(e));
      }

      await (this.prisma as any).aIUsageRecord.create({
        data: {
          organizationId,
          userId,
          feature: "social_copy",
          provider: provider.name,
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          estimated: result.tokensEstimated,
        },
      });

      let parsed: any = null;
      try {
        parsed = JSON.parse(result.text);
      } catch {
        parsed = null;
      }
      const rawVariants: any[] = Array.isArray(parsed?.variants) ? parsed.variants : [];
      for (const raw of rawVariants) {
        const caption = typeof raw?.caption === "string" ? raw.caption.trim() : "";
        if (!caption) continue;
        captions.push(caption.slice(0, 2200));
        if (captions.length >= count) break;
      }

      if (captions.length === 0) {
        throw badRequest("social.theAiProviderReturnedNoUsable");
      }
    } else {
      // Dev template path — grounded templates from the facts ONLY.
      if (product) {
        const descriptionExcerpt = product.description ? String(product.description).slice(0, 200) : "";
        const descBn = descriptionExcerpt ? ` ${descriptionExcerpt}` : "";
        const descEn = descriptionExcerpt ? ` ${descriptionExcerpt}` : "";
        const compareBn = compareAtFormatted ? ` আগের দাম ${compareAtFormatted}, এখন ${formattedPrice}।` : "";
        const compareEn = compareAtFormatted ? ` Previous price ${compareAtFormatted}, now ${formattedPrice}.` : "";
        const categoryText = product.category ? String(product.category) : "";
        if (language === "bn") {
          captions = [
            `${product.name} — মাত্র ${formattedPrice}।${compareBn}${descBn} বিস্তারিত দেখে এখনই অর্ডার করুন।`,
            `${categoryText ? `${categoryText} ক্যাটাগরির ` : ""}${product.name} পাওয়া যাচ্ছে ${formattedPrice} দামে।${compareBn}${descBn}`,
            topic
              ? `${topic} — ${product.name}, দাম ${formattedPrice}।${compareBn} পছন্দ হলে এখনই অর্ডার করুন।`
              : `${product.name} — দাম ${formattedPrice}।${compareBn} পছন্দ হলে এখনই অর্ডার করুন।`,
          ];
          notice =
            "আসল AI (LLM) কনফিগার করা হয়নি — এগুলো Dev Template Adapter দিয়ে বানানো সাধারণ টেমপ্লেট, আসল AI জেনারেশন নয়।";
        } else {
          captions = [
            `${product.name} — only ${formattedPrice}.${compareEn}${descEn} View details and order now.`,
            `${categoryText ? `From the ${categoryText} category, ` : ""}${product.name} is available for ${formattedPrice}.${compareEn}${descEn}`,
            topic
              ? `${topic} — ${product.name}, price ${formattedPrice}.${compareEn} Order now if you like it.`
              : `${product.name} — price ${formattedPrice}.${compareEn} Order now if you like it.`,
          ];
          notice =
            "No real AI (LLM) is configured — these are plain templates from the Dev Template Adapter, not real AI generation.";
        }
      } else {
        // Topic-only: the topic text itself plus generic,
        // non-factual scaffolding — never a price/discount claim.
        const brandVoice = businessProfile?.brandVoice ? String(businessProfile.brandVoice) : "";
        if (language === "bn") {
          captions = [
            `${topic}`,
            `${topic} — বিস্তারিত জানতে ইনবক্স করুন।`,
            brandVoice ? `${topic} — ${brandVoice}` : `${topic} — বিস্তারিত জানতে কমেন্ট করুন।`,
          ];
          notice =
            "আসল AI (LLM) কনফিগার করা হয়নি — এগুলো Dev Template Adapter দিয়ে বানানো সাধারণ টেমপ্লেট, আসল AI জেনারেশন নয়।";
        } else {
          captions = [
            `${topic}`,
            `${topic} — send us an inbox message for details.`,
            brandVoice ? `${topic} — ${brandVoice}` : `${topic} — comment to share your thoughts.`,
          ];
          notice =
            "No real AI (LLM) is configured — these are plain templates from the Dev Template Adapter, not real AI generation.";
        }
      }
      captions = captions.slice(0, count).map((c) => c.slice(0, 2200));

      const outputText = captions.join("\n");
      await (this.prisma as any).aIUsageRecord.create({
        data: {
          organizationId,
          userId,
          feature: "social_copy",
          provider: "dev-template",
          model: "dev-template-v1",
          inputTokens: estimateTokens(factsText),
          outputTokens: estimateTokens(outputText),
          estimated: true,
        },
      });
    }

    const hashtags = suggestSocialHashtags({ product, businessProfile, topic });

    return {
      provider: provider.name,
      isRealLlm: provider.isRealLlm,
      product: product ? { id: product.id, name: product.name, price: formattedPrice, currency: product.currency } : null,
      variants: captions.map((caption) => {
        const findings = policyFindingsForText(caption);
        return { caption, policy: { status: findings.length ? "flagged" : "pass", findings } };
      }),
      hashtags,
      ...(notice ? { notice } : {}),
    };
  }

  // ---------- SU4: monthly content plan + Reel/Short script ----------
  //
  // Both features are REAL-LLM ONLY: a month of planning or a
  // script from the dev template would be fabrication dressed as
  // AI, so a non-real provider refuses (no plan row, no usage
  // row) — unlike generateCopy, whose dev templates are honestly
  // labelled per-variant. Usage discipline otherwise mirrors
  // SP3: kill switch + daily cap FIRST (per feature), and the
  // AIUsageRecord is written after provider success, before
  // parsing.

  private serializeContentPlan(row: any) {
    if (!row) return row;
    return {
      id: row.id, month: row.month,
      pillars: Array.isArray(row.pillars) ? row.pillars : [],
      items: Array.isArray(row.items) ? row.items : [],
      status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  private async loadBusinessProfile(organizationId: string): Promise<any> {
    return (this.prisma as any).businessProfile
      ?.findUnique({ where: { organizationId } })
      .catch(() => null);
  }

  private productFactLines(product: any): string[] {
    const lines: string[] = [`Product (id: ${product.id}): ${product.name}`];
    try {
      lines.push(`Price: ${formatMinor(BigInt(product.priceMinor), product.currency)}`);
      if (product.compareAtMinor !== null && product.compareAtMinor !== undefined) {
        lines.push(`Compare-at price: ${formatMinor(BigInt(product.compareAtMinor), product.currency)}`);
      }
    } catch { /* a malformed price simply contributes no price fact */ }
    if (product.category) lines.push(`Category: ${product.category}`);
    if (product.stockQuantity !== null && product.stockQuantity !== undefined) {
      lines.push(`Stock quantity: ${product.stockQuantity}`);
    }
    return lines;
  }

  private businessFactLines(businessProfile: any): string[] {
    const lines: string[] = [];
    if (businessProfile?.brandVoice) lines.push(`Brand voice: ${businessProfile.brandVoice}`);
    if (businessProfile?.industry) lines.push(`Business industry: ${businessProfile.industry}`);
    if (businessProfile?.description) lines.push(`About the business: ${businessProfile.description}`);
    if (businessProfile?.uniqueSellingPoints) lines.push(`Unique selling points: ${businessProfile.uniqueSellingPoints}`);
    return lines;
  }

  async generateContentPlan(
    organizationId: string,
    userId: string,
    dto: { month: string; pillars?: string[]; focus?: string },
  ) {
    // Enforcement FIRST (before any load), per-feature cap.
    await this.checkDailyLimit(organizationId, "social_content_plan");

    const month = typeof dto.month === "string" ? dto.month.trim() : "";
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw badRequest("social.giveTheMonthInProperYyyy");
    }
    const focus = dto.focus?.trim() ? dto.focus.trim() : undefined;

    const productRows = await (this.prisma as any).product.findMany({
      where: { organizationId, status: "ACTIVE" }, orderBy: { createdAt: "desc" }, take: 20,
    }).catch(() => []);
    const products: any[] = Array.isArray(productRows) ? productRows : [];
    const businessProfile = await this.loadBusinessProfile(organizationId);

    if (products.length === 0 && !focus) {
      throw badRequest("social.thereIsNoActiveProductAdd");
    }

    const requested = (Array.isArray(dto.pillars) ? dto.pillars : [])
      .map((p) => (typeof p === "string" ? p.trim() : ""))
      .filter(Boolean)
      .slice(0, 6);
    const pillars = requested.length > 0
      ? requested
      : ["product_showcase", "offer", "customer_review", "tips"];

    const facts: string[] = [];
    for (const product of products) facts.push(...this.productFactLines(product));
    facts.push(...this.businessFactLines(businessProfile));
    if (focus) facts.push(`Focus: ${focus}`);
    facts.push(`Month: ${month}`);
    facts.push(`Content pillars: ${pillars.join(", ")}`);
    const factsText = facts.join("\n");

    // Grounding set for the caption number guard: every number
    // that appears in the facts, PLUS the calendar days 1–31 —
    // a plan caption legitimately says things like "৫ তারিখে"
    // (on the 5th) or "Day 12 of the plan", so bare day-of-month
    // numbers are plan structure, not invented facts.
    const allowedNumbers = new Set<string>(extractSocialNumbers(factsText));
    for (let d = 1; d <= 31; d++) allowedNumbers.add(String(d));

    const provider = await providerForOrg(this.llm, organizationId);
    if (!provider.isRealLlm) {
      throw badRequest("social.realAiLlmIsNotConfigured2");
    }

    const systemPrompt = [
      "You are the AI Content Planner for a business's social media.",
      "Use ONLY the given facts. Never invent prices, discounts, stock, delivery promises, features or results.",
      "If no price is among the facts, do not mention any price.",
      "Write every caption in Bengali (Bangla script).",
      `Plan the month ${month}: return at most 20 items spread across the month.`,
      "Each item's pillar must be one of the given content pillars; productId must be one of the given product ids, or null when the item is not about a specific product.",
      'Return ONLY JSON {"items":[{"day":number,"pillar":string,"productId":string|null,"caption":string,"mediaIdea":string}]}.',
      "day is the day of the month (1-28). caption is a ready-to-post draft caption. mediaIdea is a short note on what photo/video to use.",
    ].join("\n");

    let result: any;
    try {
      result = await provider.complete(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: factsText },
        ],
        { jsonMode: true, maxTokens: 3000 },
      );
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? String(e));
    }

    // Usage AFTER provider success, BEFORE parsing (SP3 discipline).
    await (this.prisma as any).aIUsageRecord.create({
      data: {
        organizationId, userId, feature: "social_content_plan",
        provider: provider.name, model: result.model,
        inputTokens: result.inputTokens, outputTokens: result.outputTokens,
        estimated: result.tokensEstimated,
      },
    });

    let parsed: any = null;
    try { parsed = JSON.parse(result.text); } catch { parsed = null; }
    const rawItems: any[] = Array.isArray(parsed?.items) ? parsed.items : [];
    const productById = new Map<string, any>(products.map((p: any) => [p.id as string, p]));
    const items: any[] = [];
    let droppedItems = 0;
    for (const raw of rawItems) {
      if (items.length >= 20) break;
      const day = Number(raw?.day);
      const caption = typeof raw?.caption === "string" ? raw.caption.trim() : "";
      if (!Number.isInteger(day) || day < 1 || day > 31 || !caption) {
        droppedItems++;
        continue;
      }
      // Number guard: a caption may only carry numbers from the
      // facts (prices, stock) or calendar structure (see above).
      // An invented price drops the whole item — never edited in.
      if (ungroundedNumbers(caption, allowedNumbers).length > 0) {
        droppedItems++;
        continue;
      }
      const pillar = typeof raw?.pillar === "string" && raw.pillar.trim() ? raw.pillar.trim() : pillars[0];
      const product = typeof raw?.productId === "string" ? productById.get(raw.productId) : undefined;
      items.push({
        day,
        pillar,
        productId: product ? product.id : null,
        productName: product ? product.name : null,
        caption,
        mediaIdea: typeof raw?.mediaIdea === "string" ? raw.mediaIdea.trim() : "",
      });
    }
    items.sort((a, b) => a.day - b.day);

    if (items.length === 0) {
      // The usage row above stands (the provider did the work) —
      // the same accounting as SP3's zero-variants path.
      throw badRequest("social.theAiReturnedNoUsablePlan");
    }

    const plan = await (this.prisma as any).socialContentPlan.create({
      data: { organizationId, month, pillars, items, status: "generated", createdById: userId },
    });
    await this.audit?.log({
      organizationId, userId, action: "social.content_plan_created",
      entityType: "SocialContentPlan", entityId: plan.id,
      metadata: { month, itemCount: items.length, droppedItems },
    });
    return { plan: this.serializeContentPlan(plan), provider: provider.name, droppedItems };
  }

  async listContentPlans(organizationId: string) {
    const rows = await (this.prisma as any).socialContentPlan.findMany({
      where: { organizationId }, orderBy: { createdAt: "desc" },
    });
    return (Array.isArray(rows) ? rows : []).map((r: any) => this.serializeContentPlan(r));
  }

  async getContentPlan(organizationId: string, planId: string) {
    const row = await (this.prisma as any).socialContentPlan.findFirst({
      where: { id: planId, organizationId },
    });
    if (!row) throw notFound("social.contentPlanNotFoundInThis");
    return this.serializeContentPlan(row);
  }

  /**
   * Turn chosen plan items into real DRAFT posts through the ONE
   * post-creation path (SocialService.createPost — approval rule
   * and media validation apply exactly as in the composer). An
   * item with a product that has an imageUrl gets that image
   * imported (PP3) and attached; without one the draft is
   * text-only. Per-item outcomes — one bad item never stops the
   * rest, and an already-materialized item is skipped, so
   * re-running materialize is safe.
   */
  async materializePlan(
    organizationId: string,
    userId: string,
    planId: string,
    dto: { itemIndexes: number[]; socialAccountId: string },
  ) {
    if (!this.social || !this.importer) {
      throw badRequest("social.materializeDeployment");
    }
    const planRow = await (this.prisma as any).socialContentPlan.findFirst({
      where: { id: planId, organizationId },
    });
    if (!planRow) throw notFound("social.contentPlanNotFoundInThis");
    const items: any[] = (Array.isArray(planRow.items) ? planRow.items : []).map((i: any) => ({ ...i }));

    const results: { index: number; status: "created" | "skipped" | "failed"; postId?: string; error?: string }[] = [];
    let created = 0;
    let skipped = 0;
    let failed = 0;
    const indexes = Array.isArray(dto.itemIndexes) ? dto.itemIndexes : [];
    for (const index of indexes) {
      const item = Number.isInteger(index) && index >= 0 && index < items.length ? items[index] : null;
      if (!item) {
        failed++;
        results.push({ index, status: "failed", error: "item পাওয়া যায়নি" });
        continue;
      }
      if (item.materializedPostId) {
        skipped++;
        results.push({ index, status: "skipped", postId: item.materializedPostId, error: "ইতিমধ্যে draft তৈরি হয়েছে" });
        continue;
      }
      try {
        const mediaRefs: { assetId: string; kind: string }[] = [];
        if (item.productId) {
          const product = await (this.prisma as any).product.findFirst({
            where: { id: item.productId, organizationId },
          });
          if (!product) throw new Error("Product পাওয়া যায়নি");
          if (typeof product.imageUrl === "string" && product.imageUrl.trim()) {
            const asset = await this.importer.importForProduct(organizationId, userId, product.id);
            mediaRefs.push({ assetId: asset.id, kind: "image" });
          }
        }
        const post = await this.social.createPost(organizationId, userId, {
          socialAccountId: dto.socialAccountId,
          caption: item.caption,
          mediaRefs,
        });
        item.materializedPostId = post.id;
        created++;
        results.push({ index, status: "created", postId: post.id });
      } catch (e) {
        failed++;
        results.push({ index, status: "failed", error: e instanceof Error ? e.message : String(e) });
      }
    }

    let plan = planRow;
    if (created > 0) {
      const materializedCount = items.filter((i: any) => i.materializedPostId).length;
      const status = materializedCount >= items.length
        ? "materialized"
        : materializedCount > 0
          ? "partially_materialized"
          : planRow.status;
      plan = await (this.prisma as any).socialContentPlan.update({
        where: { id: planRow.id }, data: { items, status },
      });
    }
    await this.audit?.log({
      organizationId, userId, action: "social.content_plan_materialized",
      entityType: "SocialContentPlan", entityId: planRow.id,
      metadata: { created, skipped, failed },
    });
    return { results, plan: this.serializeContentPlan(plan) };
  }

  /**
   * Reel/Short script draft — RETURNED ONLY. No SocialPost, no
   * MediaAsset, nothing is saved: the human reads the script,
   * shoots the video, and composes the post themselves. (The
   * caption number guard is therefore not applied here — the
   * prompt prohibition stands, and a human reviews the draft
   * before anything can be published from it.)
   */
  async generateScript(
    organizationId: string,
    userId: string,
    dto: { productId?: string; topic: string; language?: string },
  ) {
    await this.checkDailyLimit(organizationId, "social_script");

    const topic = dto.topic?.trim() ? dto.topic.trim() : "";
    if (!topic) throw badRequest("social.writeATopic");
    // MB5 (ML13, CD-8 #13): dto.language wins; absent → OWNER chain.
    const { language } = await resolveOwnerLanguageForOrg(this.prisma as any, {
      organizationId,
      userId,
      dtoLanguage: dto.language ?? null,
    });

    let product: any = null;
    if (dto.productId) {
      product = await (this.prisma as any).product.findFirst({
        where: { id: dto.productId, organizationId },
      });
      if (!product) throw notFound("social.productNotFoundInThisOrganization");
    }
    const businessProfile = await this.loadBusinessProfile(organizationId);

    const facts: string[] = [];
    if (product) facts.push(...this.productFactLines(product));
    facts.push(...this.businessFactLines(businessProfile));
    facts.push(`Topic: ${topic}`);
    const factsText = facts.join("\n");

    const provider = await providerForOrg(this.llm, organizationId);
    if (!provider.isRealLlm) {
      throw badRequest("social.realAiLlmIsNotConfigured4");
    }

    const systemPrompt = [
      "You write short-form video (Reel/Short) scripts for a business.",
      "Use ONLY the given facts. Never invent prices, discounts, stock, delivery promises, features or results.",
      "If no price is among the facts, do not mention any price.",
      language === "bn" ? "Write in Bengali (Bangla script)." : "Write in English.",
      'Return ONLY JSON {"hook":string,"onScreenText":string[],"shotList":string[],"captionDraft":string}.',
      "hook is the spoken/opening line (first 3 seconds). onScreenText lists the text overlays in order. shotList lists the shots in order. captionDraft is the post caption to publish with the video.",
    ].join("\n");

    let result: any;
    try {
      result = await provider.complete(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: factsText },
        ],
        { jsonMode: true, maxTokens: 1600 },
      );
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? String(e));
    }

    await (this.prisma as any).aIUsageRecord.create({
      data: {
        organizationId, userId, feature: "social_script",
        provider: provider.name, model: result.model,
        inputTokens: result.inputTokens, outputTokens: result.outputTokens,
        estimated: result.tokensEstimated,
      },
    });

    let parsed: any = null;
    try { parsed = JSON.parse(result.text); } catch { parsed = null; }
    const hook = typeof parsed?.hook === "string" ? parsed.hook.trim() : "";
    if (!hook) {
      throw badRequest("social.theAiReturnedNoUsableScript");
    }
    const stringList = (value: unknown): string[] =>
      (Array.isArray(value) ? value : [])
        .map((v) => (typeof v === "string" ? v.trim() : ""))
        .filter(Boolean);
    return {
      hook,
      onScreenText: stringList(parsed?.onScreenText),
      shotList: stringList(parsed?.shotList),
      captionDraft: typeof parsed?.captionDraft === "string" ? parsed.captionDraft.trim() : "",
      provider: provider.name,
      isRealLlm: true as const,
    };
  }

  // ---------- SN4: platform variants + translation + carousel outline ----------
  //
  // All three are REAL-LLM ONLY and RETURN ONLY — like
  // generateScript, a non-real provider refuses BEFORE any usage
  // row is written, and like generateContentPlan the usage row is
  // written after provider success, before parsing, per feature.
  // No SocialPost / SocialContentPlan (or any other) row is ever
  // created here — only the AIUsageRecord. The number guard
  // (ungroundedNumbers against extractSocialNumbers of the
  // source text) drops/w refuses anything carrying a number the
  // user's own text did not contain.

  async generateVariants(
    organizationId: string,
    userId: string,
    dto: { caption: string; platforms: string[]; tone?: string },
  ) {
    await this.checkDailyLimit(organizationId, "social_variants");

    const caption = typeof dto.caption === "string" ? dto.caption.trim() : "";
    if (!caption) throw badRequest("social.writeACaption");

    const ALLOWED_PLATFORMS = ["meta_page", "instagram", "tiktok", "youtube", "linkedin"];
    const platforms: string[] = [];
    for (const raw of Array.isArray(dto.platforms) ? dto.platforms : []) {
      const platform = typeof raw === "string" ? raw.trim() : "";
      if (!ALLOWED_PLATFORMS.includes(platform)) continue;
      if (platforms.includes(platform)) continue;
      platforms.push(platform);
    }
    if (platforms.length === 0) {
      throw badRequest("social.chooseAtLeastOneValidPlatform");
    }

    const allowedNumbers = new Set<string>(extractSocialNumbers(caption));
    const tone = dto.tone?.trim() ? dto.tone.trim() : undefined;

    const provider = await providerForOrg(this.llm, organizationId);
    if (!provider.isRealLlm) {
      throw badRequest("social.realAiLlmIsNotConfigured3");
    }

    const systemPrompt = [
      "You adapt ONE given social media caption into platform-specific variants.",
      "Re-shape ONLY the given caption for each platform. Never add new information, prices, discounts, stock claims, delivery promises, features or results.",
      "A number that appears in the given caption may be kept exactly as it is; never introduce any new number.",
      "Platform guidance:",
      "- meta_page (Facebook Page): slightly longer, link-friendly.",
      "- instagram: concise, hashtag-friendly.",
      "- tiktok: short, casual, the first line is the hook.",
      "- youtube: the first line works like a title, followed by a short description.",
      "- linkedin: professional tone.",
      ...(tone ? [`Match this tone: ${tone}`] : []),
      'Return ONLY JSON {"variants":[{"platform":string,"caption":string}]} with exactly one variant for each requested platform.',
    ].join("\n");
    const userMessage = [
      `Caption:\n${caption}`,
      `Platforms: ${platforms.join(", ")}`,
    ].join("\n");

    let result: any;
    try {
      result = await provider.complete(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        { jsonMode: true, maxTokens: 1800 },
      );
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? String(e));
    }

    await (this.prisma as any).aIUsageRecord.create({
      data: {
        organizationId, userId, feature: "social_variants",
        provider: provider.name, model: result.model,
        inputTokens: result.inputTokens, outputTokens: result.outputTokens,
        estimated: result.tokensEstimated,
      },
    });

    let parsed: any = null;
    try { parsed = JSON.parse(result.text); } catch { parsed = null; }
    const rawVariants: any[] = Array.isArray(parsed?.variants) ? parsed.variants : [];
    const variants: any[] = [];
    let droppedCount = 0;
    for (const platform of platforms) {
      const raw = rawVariants.find((v: any) => v && typeof v.platform === "string" && v.platform.trim() === platform);
      if (!raw) continue;
      const variantCaption = typeof raw.caption === "string" ? raw.caption.trim().slice(0, 2200) : "";
      if (!variantCaption) continue;
      if (ungroundedNumbers(variantCaption, allowedNumbers).length > 0) {
        droppedCount++;
        continue;
      }
      const findings = policyFindingsForText(variantCaption);
      variants.push({
        platform,
        caption: variantCaption,
        policy: { status: findings.length ? "flagged" : "pass", findings },
      });
    }

    if (variants.length === 0) {
      throw badRequest("social.theAiReturnedNoUsableVariant");
    }

    return { variants, droppedCount, provider: provider.name, isRealLlm: true as const };
  }

  async translateText(
    organizationId: string,
    userId: string,
    dto: { text: string; targetLang: string },
  ) {
    await this.checkDailyLimit(organizationId, "social_translate");

    const text = typeof dto.text === "string" ? dto.text.trim() : "";
    if (!text) throw badRequest("social.giveTextToTranslate");
    const targetLang = dto.targetLang === "en" ? "en" : dto.targetLang === "bn" ? "bn" : null;
    if (!targetLang) throw badRequest("social.targetLanguageCanOnlyBeBn");

    const provider = await providerForOrg(this.llm, organizationId);
    if (!provider.isRealLlm) {
      throw badRequest("social.realAiLlmIsNotConfigured5");
    }

    const systemPrompt = [
      targetLang === "bn"
        ? "Translate the given text faithfully into Bengali (Bangla script)."
        : "Translate the given text faithfully into English.",
      "Keep every hashtag, URL, @mention, emoji and number exactly unchanged.",
      "Add no information and remove no information — translate only.",
      'Return ONLY JSON {"text": string}.',
    ].join("\n");

    let result: any;
    try {
      result = await provider.complete(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
        { jsonMode: true, maxTokens: 1200 },
      );
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? String(e));
    }

    await (this.prisma as any).aIUsageRecord.create({
      data: {
        organizationId, userId, feature: "social_translate",
        provider: provider.name, model: result.model,
        inputTokens: result.inputTokens, outputTokens: result.outputTokens,
        estimated: result.tokensEstimated,
      },
    });

    let parsed: any = null;
    try { parsed = JSON.parse(result.text); } catch { parsed = null; }
    const translated = typeof parsed?.text === "string" ? parsed.text.trim() : "";
    if (!translated) {
      throw badRequest("social.theAiReturnedNoUsableTranslation");
    }
    if (ungroundedNumbers(translated, new Set<string>(extractSocialNumbers(text))).length > 0) {
      throw badRequest("social.theTranslationContainsANumberThat");
    }

    return { text: translated, provider: provider.name, isRealLlm: true as const };
  }

  async generateCarouselOutline(
    organizationId: string,
    userId: string,
    dto: { caption: string },
  ) {
    await this.checkDailyLimit(organizationId, "social_carousel_outline");

    const caption = typeof dto.caption === "string" ? dto.caption.trim() : "";
    if (!caption) throw badRequest("social.writeACaption");

    const allowedNumbers = new Set<string>(extractSocialNumbers(caption));

    const provider = await providerForOrg(this.llm, organizationId);
    if (!provider.isRealLlm) {
      throw badRequest("social.realAiLlmIsNotConfigured");
    }

    const systemPrompt = [
      "You split ONE given caption into an Instagram carousel outline.",
      "Return 4 to 8 slides. The first slide is the hook, the last slide is the call to action (CTA).",
      "Each slide is short — at most 200 characters.",
      "Use ONLY the given caption. Never add new information or any new number; a number from the caption may be kept exactly as it is.",
      'Return ONLY JSON {"slides": string[]}.',
    ].join("\n");

    let result: any;
    try {
      result = await provider.complete(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: caption },
        ],
        { jsonMode: true, maxTokens: 1200 },
      );
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? String(e));
    }

    await (this.prisma as any).aIUsageRecord.create({
      data: {
        organizationId, userId, feature: "social_carousel_outline",
        provider: provider.name, model: result.model,
        inputTokens: result.inputTokens, outputTokens: result.outputTokens,
        estimated: result.tokensEstimated,
      },
    });

    let parsed: any = null;
    try { parsed = JSON.parse(result.text); } catch { parsed = null; }
    const rawSlides: any[] = Array.isArray(parsed?.slides) ? parsed.slides : [];
    const slides: string[] = [];
    let droppedCount = 0;
    for (const raw of rawSlides) {
      if (slides.length >= 8) break;
      const slide = typeof raw === "string" ? raw.trim().slice(0, 200) : "";
      if (!slide) continue;
      if (ungroundedNumbers(slide, allowedNumbers).length > 0) {
        droppedCount++;
        continue;
      }
      slides.push(slide);
    }

    if (slides.length < 2) {
      throw badRequest("social.theAiReturnedNoUsableCarousel");
    }

    return { slides, droppedCount, provider: provider.name, isRealLlm: true as const };
  }
}
