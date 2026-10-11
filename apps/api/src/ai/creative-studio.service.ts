import { BadRequestException, HttpException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LlmFactory } from "./llm/llm.factory";
import { estimateTokens } from "./llm/llm.types";
import { CampaignsService } from "../campaigns/campaigns.service";
import { policyFindingsForText } from "../campaigns/policy-check";
import { formatMinor } from "@repo/contracts";

export const STUDIO_CTAS = [
  "SHOP_NOW",
  "BUY_NOW",
  "LEARN_MORE",
  "SIGN_UP",
  "GET_OFFER",
  "CALL_NOW",
  "MESSAGE_PAGE",
  "SEND_WHATSAPP_MESSAGE",
  "CONTACT_US",
  "APPLY_NOW",
  "GET_QUOTE",
  "DOWNLOAD",
  "SUBSCRIBE",
  "BOOK_TRAVEL",
] as const;

type StudioVariantInput = { headline: string; primaryText: string; callToAction: string };

@Injectable()
export class CreativeStudioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmFactory,
    private readonly campaigns: CampaignsService,
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
      where: { organizationId, feature: "creative_studio", createdAt: { gte: startOfDay } },
    });
    if (used >= limit) {
      throw new HttpException(
        `Daily AI generation limit reached for this organization (${limit}). Try again tomorrow or ask the platform team to raise your plan limit.`,
        429,
      );
    }
  }

  private withPolicy(variant: StudioVariantInput) {
    const findings = policyFindingsForText(`${variant.headline}\n${variant.primaryText}`);
    return {
      headline: variant.headline,
      primaryText: variant.primaryText,
      callToAction: variant.callToAction,
      policy: { status: findings.length ? "flagged" : "pass", findings },
    };
  }

  async generate(
    organizationId: string,
    userId: string,
    dto: { productId: string; goal?: string; tone?: string; language?: "bn" | "en" },
  ) {
    // Enforcement FIRST (before product load)
    await this.checkDailyLimit(organizationId);

    const product = await (this.prisma as any).product.findFirst({
      where: { id: dto.productId, organizationId },
    });
    if (!product) throw new NotFoundException("Product not found in this organization");

    const businessProfile = await (this.prisma as any).businessProfile
      ?.findUnique({ where: { organizationId } })
      .catch(() => null);

    const language: "bn" | "en" = dto.language === "en" ? "en" : "bn";
    const formattedPrice = formatMinor(BigInt(product.priceMinor), product.currency);
    const compareAtFormatted =
      product.compareAtMinor !== null && product.compareAtMinor !== undefined
        ? formatMinor(BigInt(product.compareAtMinor), product.currency)
        : null;

    const facts: string[] = [];
    facts.push(`Product name: ${product.name}`);
    facts.push(`Price: ${formattedPrice}`);
    if (compareAtFormatted) facts.push(`Compare-at price: ${compareAtFormatted}`);
    if (product.category) facts.push(`Category: ${product.category}`);
    if (product.description) facts.push(`Description: ${product.description}`);
    if (product.stockQuantity !== null && product.stockQuantity !== undefined) {
      facts.push(`Stock quantity: ${product.stockQuantity}`);
    }
    if (businessProfile?.brandVoice) facts.push(`Brand voice: ${businessProfile.brandVoice}`);
    if (dto.goal) facts.push(`Goal: ${dto.goal}`);
    if (dto.tone) facts.push(`Tone: ${dto.tone}`);
    const factsText = facts.join("\n");

    const provider = this.llm.getProvider();

    let variants: StudioVariantInput[] = [];
    let notice: string | undefined;

    if (provider.isRealLlm) {
      const systemPrompt = [
        "You write ad copy for an ecommerce product in the AI Creative Studio.",
        "Use ONLY the given product facts. Never invent prices, discounts, stock, delivery promises, features or results.",
        language === "bn"
          ? "Write in Bengali (Bangla script)."
          : "Write in English.",
        `Return ONLY JSON {"variants":[{"headline":string,"primaryText":string,"callToAction":string}]} with exactly 4 variants.`,
        `callToAction must be one of: ${STUDIO_CTAS.join(", ")}.`,
        "headline must be at most 125 characters, primaryText must be at most 500 characters.",
      ].join("\n");

      let result: any;
      try {
        result = await provider.complete(
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: factsText },
          ],
          { jsonMode: true, maxTokens: 1200 },
        );
      } catch (e: any) {
        throw new BadRequestException(e?.message ?? String(e));
      }

      await (this.prisma as any).aIUsageRecord.create({
        data: {
          organizationId,
          userId,
          feature: "creative_studio",
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
        const headline = typeof raw?.headline === "string" ? raw.headline.trim() : "";
        const primaryText = typeof raw?.primaryText === "string" ? raw.primaryText.trim() : "";
        if (!headline || !primaryText) continue;
        const callToAction =
          typeof raw?.callToAction === "string" && (STUDIO_CTAS as readonly string[]).includes(raw.callToAction)
            ? raw.callToAction
            : "SHOP_NOW";
        variants.push({
          headline: headline.slice(0, 200),
          primaryText: primaryText.slice(0, 2000),
          callToAction,
        });
        if (variants.length >= 5) break;
      }

      if (variants.length === 0) {
        throw new BadRequestException("The AI provider returned no usable copy variants. Nothing was saved.");
      }
    } else {
      // Dev template path — exactly 3 variants from product facts ONLY
      const descriptionExcerpt = product.description ? String(product.description).slice(0, 200) : "";
      const categoryText = product.category ? String(product.category) : "";
      const compareTextBn = compareAtFormatted ? ` আগের দাম ${compareAtFormatted}, এখন ${formattedPrice}।` : "";
      const compareTextEn = compareAtFormatted ? ` Previous price ${compareAtFormatted}, now ${formattedPrice}.` : "";

      if (language === "bn") {
        variants = [
          {
            headline: `${product.name} — মাত্র ${formattedPrice}`.slice(0, 200),
            primaryText:
              `${product.name} এখন ${formattedPrice}।${compareTextBn}${descriptionExcerpt ? ` ${descriptionExcerpt}` : ""} বিস্তারিত দেখে এখনই অর্ডার করুন।`.slice(0, 2000),
            callToAction: "SHOP_NOW",
          },
          {
            headline: `${product.name} কিনুন — ${formattedPrice}`.slice(0, 200),
            primaryText:
              `${categoryText ? `${categoryText} ক্যাটাগরির ` : ""}${product.name} পাওয়া যাচ্ছে ${formattedPrice} দামে।${compareTextBn}${descriptionExcerpt ? ` ${descriptionExcerpt}` : ""}`.slice(0, 2000),
            callToAction: "BUY_NOW",
          },
          {
            headline: `${product.name} — ${formattedPrice}`.slice(0, 200),
            primaryText:
              `${product.name} — দাম ${formattedPrice}।${compareTextBn} পছন্দ হলে এখনই অর্ডার করুন।`.slice(0, 2000),
            callToAction: "SHOP_NOW",
          },
        ];
        notice =
          "আসল AI (LLM) কনফিগার করা হয়নি — এগুলো Dev Template Adapter দিয়ে বানানো সাধারণ টেমপ্লেট, আসল AI জেনারেশন নয়।";
      } else {
        variants = [
          {
            headline: `${product.name} — only ${formattedPrice}`.slice(0, 200),
            primaryText:
              `${product.name} is now ${formattedPrice}.${compareTextEn}${descriptionExcerpt ? ` ${descriptionExcerpt}` : ""} View details and order now.`.slice(0, 2000),
            callToAction: "SHOP_NOW",
          },
          {
            headline: `Buy ${product.name} — ${formattedPrice}`.slice(0, 200),
            primaryText:
              `${categoryText ? `From the ${categoryText} category, ` : ""}${product.name} is available for ${formattedPrice}.${compareTextEn}${descriptionExcerpt ? ` ${descriptionExcerpt}` : ""}`.slice(0, 2000),
            callToAction: "BUY_NOW",
          },
          {
            headline: `${product.name} — ${formattedPrice}`.slice(0, 200),
            primaryText:
              `${product.name} — price ${formattedPrice}.${compareTextEn} Order now if you like it.`.slice(0, 2000),
            callToAction: "SHOP_NOW",
          },
        ];
        notice =
          "No real AI (LLM) is configured — these are plain templates from the Dev Template Adapter, not real AI generation.";
      }

      const outputText = variants.map((v) => `${v.headline}\n${v.primaryText}`).join("\n");
      await (this.prisma as any).aIUsageRecord.create({
        data: {
          organizationId,
          userId,
          feature: "creative_studio",
          provider: "dev-template",
          model: "dev-template-v1",
          inputTokens: estimateTokens(factsText),
          outputTokens: estimateTokens(outputText),
          estimated: true,
        },
      });
    }

    const withPolicy = variants.map((v) => this.withPolicy(v));

    return {
      provider: provider.name,
      isRealLlm: provider.isRealLlm,
      product: { id: product.id, name: product.name, price: formattedPrice, currency: product.currency },
      variants: withPolicy,
      ...(notice ? { notice } : {}),
    };
  }

  async createDraft(
    organizationId: string,
    userId: string,
    dto: {
      productId: string;
      adAccountId: string;
      headline: string;
      primaryText: string;
      callToAction?: string;
      linkUrl?: string;
    },
  ) {
    const headline = dto.headline?.trim() ?? "";
    if (!headline) throw new BadRequestException("headline is required");
    const primaryText = dto.primaryText?.trim() ?? "";
    if (!primaryText) throw new BadRequestException("primaryText is required");
    const callToAction = dto.callToAction ?? "SHOP_NOW";
    if (!(STUDIO_CTAS as readonly string[]).includes(callToAction)) {
      throw new BadRequestException(
        `Invalid callToAction "${callToAction}". Must be one of: ${STUDIO_CTAS.join(", ")}`,
      );
    }

    const product = await (this.prisma as any).product.findFirst({
      where: { id: dto.productId, organizationId },
    });
    if (!product) throw new NotFoundException("Product not found in this organization");

    const businessProfile = await (this.prisma as any).businessProfile
      ?.findUnique({ where: { organizationId } })
      .catch(() => null);

    const linkUrl = dto.linkUrl ?? businessProfile?.websiteUrl ?? "";
    if (!linkUrl) {
      throw new BadRequestException(
        "A landing link is required: pass linkUrl or set the business website URL in Business Knowledge",
      );
    }

    const plan: any = await this.campaigns.createPlan(organizationId, userId, {
      name: `AI Studio: ${product.name}`.slice(0, 200),
      objective: "OUTCOME_SALES",
      adAccountId: dto.adAccountId,
    });

    const adSet: any = await this.campaigns.addAdSet(organizationId, plan.id, {
      name: "AI Studio — BD Broad",
      dailyBudget: "500",
      optimizationGoal: "OFFSITE_CONVERSIONS",
      countries: ["BD"],
      ageMin: 18,
      ageMax: 65,
    });

    const ad: any = await this.campaigns.addAd(organizationId, plan.id, adSet.id, {
      name: `AI Studio Ad — ${product.name}`.slice(0, 200),
      primaryText,
      headline,
      linkUrl,
      callToAction,
      productId: product.id,
      createdByAi: true,
      ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}),
    });

    const findings = policyFindingsForText(`${headline}\n${primaryText}`);
    const policy = { status: findings.length ? "flagged" : "pass", findings };

    return {
      planId: plan.id,
      status: "draft",
      adSetId: adSet.id,
      adId: ad.id,
      policy,
      note: "ড্রাফট তৈরি হয়েছে — কিছুই প্রকাশ বা লঞ্চ হয়নি। দৈনিক বাজেট ৫০০ টাকা ও টার্গেটিং (বাংলাদেশ, ১৮–৬৫) শুরুর মান মাত্র; Campaign Builder-এ গিয়ে Page/Pixelসহ সব যাচাই করে তবেই সাবমিট করুন।",
    };
  }
}
