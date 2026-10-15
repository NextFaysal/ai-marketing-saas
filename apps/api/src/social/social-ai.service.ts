import { BadRequestException, HttpException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LlmFactory, providerForOrg } from "../ai/llm/llm.factory";
import { estimateTokens } from "../ai/llm/llm.types";
import { policyFindingsForText } from "../campaigns/policy-check";
import { formatMinor } from "@repo/contracts";

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmFactory,
  ) {}

  private async checkDailyLimit(organizationId: string) {
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
      where: { organizationId, feature: "social_copy", createdAt: { gte: startOfDay } },
    });
    if (used >= limit) {
      throw new HttpException(
        `Daily AI generation limit reached for this organization (${limit}). Try again tomorrow or ask the platform team to raise your plan limit.`,
        429,
      );
    }
  }

  async generateCopy(
    organizationId: string,
    userId: string,
    dto: { productId?: string; topic?: string; tone?: string; language?: string; count?: number; platform?: string },
  ) {
    // Enforcement FIRST (before any load), mirroring M55.
    await this.checkDailyLimit(organizationId);

    const language: "bn" | "en" = dto.language === "en" ? "en" : "bn";
    const count = Math.min(5, Math.max(1, Math.floor(dto.count ?? 3)));
    const topic = dto.topic?.trim() ? dto.topic.trim() : undefined;

    let product: any = null;
    if (dto.productId) {
      product = await (this.prisma as any).product.findFirst({
        where: { id: dto.productId, organizationId },
      });
      if (!product) throw new NotFoundException("Product not found in this organization");
    } else if (!topic) {
      throw new BadRequestException("Product বেছে নিন অথবা একটা বিষয় (Topic) লিখুন।");
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
        throw new BadRequestException("The AI provider returned no usable caption variants. Nothing was saved.");
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
}
