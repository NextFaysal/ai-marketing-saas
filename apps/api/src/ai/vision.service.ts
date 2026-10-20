import { HttpException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LlmFactory, providerForOrg } from "./llm/llm.factory";
import { ApiException, forbidden } from "../i18n/api-exception";

/**
 * CX8: the shared vision capability — the FIRST describe-image path
 * that goes through the platform's own LLM discipline (the older
 * inbox payment-screenshot helper reads raw LLM_* env vars and
 * writes no usage records; CX8 deliberately does not copy that).
 *
 * Discipline, mirrored from creative-studio.service.ts / chat:
 *  - the provider comes from LlmFactory — the SAME effective config
 *    (Admin Console setting, else LLM_* env) the chat uses;
 *  - BEFORE any provider HTTP: platform kill switch, then the
 *    per-feature daily cap (AIUsageRecord count for THIS feature,
 *    effective limit via platform-settings) — a block throws
 *    HttpException 403/429 exactly like creative-studio;
 *  - AFTER a successful call: one AIUsageRecord with the caller's
 *    feature key, provider, model and the provider-reported tokens
 *    (estimated:true only when the provider itself reports none —
 *    the reports.service.ts precedent is that the flag comes from
 *    the provider result, never assumed).
 *
 * Unavailability is NOT an error and NEVER fabricated: a dev-template
 * provider, an unconfigured/broken config, or a provider without a
 * vision implementation returns { available:false, reason } and no
 * provider HTTP is attempted for the dev/unconfigured shapes.
 *
 * Shipped vision-capable set: openai, gemini, anthropic (each
 * provider class implements completeVision in its own wire shape).
 */
export const VISION_FEATURES = ["vision_label_scan", "vision_product_match", "vision_chat", "vision_ad_creative_scan"] as const;
export type VisionFeature = (typeof VISION_FEATURES)[number];

export const VISION_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type VisionResult =
  | { available: true; text: string; provider: string; model: string }
  | { available: false; reason: string };

@Injectable()
export class VisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmFactory,
  ) {}

  /** Kill switch + per-feature daily cap, checked BEFORE the
   *  provider call — the creative-studio checkDailyLimit, with the
   *  counted feature being the caller's own feature key. */
  private async checkDailyLimit(organizationId: string, feature: VisionFeature) {
    const { killSwitches, effectiveLimits, isAiDisabledForOrg } = await import("../common/platform-settings");
    const ks = await killSwitches(this.prisma as any);
    if (isAiDisabledForOrg(ks, organizationId)) {
      throw forbidden(ks.aiGloballyPaused ? "ai.aiFeaturesTemporarilyPausedPlatformWide" : "ai.aiFeaturesTemporarilyDisabledForThisOrganization");
    }
    const baseline = Number(process.env.AI_DAILY_MESSAGE_LIMIT ?? 200);
    const { aiDaily: limit } = await effectiveLimits(this.prisma as any, organizationId, { aiDaily: baseline, broadcastCap: 1000 });
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const used = await (this.prisma as any).aIUsageRecord.count({
      where: { organizationId, feature, createdAt: { gte: startOfDay } },
    });
    if (used >= limit) {
      throw new ApiException("ai.dailyAiGenerationLimitReachedFor", { limit: limit }, 429);
    }
  }

  async analyzeImage(
    organizationId: string,
    userId: string,
    input: {
      imageBase64?: string;
      imageBytes?: Buffer;
      mimeType: string;
      prompt: string;
      feature: VisionFeature;
    },
  ): Promise<VisionResult> {
    // Enforcement FIRST — before the provider is even resolved, so a
    // blocked org never reaches provider HTTP (spec-proven).
    await this.checkDailyLimit(organizationId, input.feature);

    if (!(VISION_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
      return { available: false, reason: `Vision supports only JPEG/PNG/WebP images (got ${input.mimeType || "unknown"}).` };
    }
    const base64 = input.imageBase64 ?? (input.imageBytes ? input.imageBytes.toString("base64") : "");
    if (!base64) return { available: false, reason: "No image bytes were provided." };

    let provider: ReturnType<LlmFactory["getProvider"]>;
    try {
      provider = await providerForOrg(this.llm, organizationId);
    } catch (e) {
      // Unconfigured / misconfigured LLM (e.g. a real provider named
      // without a key) — an honest unavailable, never a throw, never
      // a fabricated reading.
      return { available: false, reason: e instanceof Error ? e.message : "LLM is not configured." };
    }
    if (!provider.isRealLlm) {
      return { available: false, reason: "No real AI (LLM) provider is configured — the dev-template adapter cannot read images." };
    }
    if (typeof provider.completeVision !== "function") {
      return { available: false, reason: `The configured provider (${provider.name}) cannot read images.` };
    }

    // A real provider failure propagates verbatim (creative-studio
    // discipline): the caller surfaces it; nothing is recorded as
    // usage for a call that did not complete.
    const result = await provider.completeVision(
      { base64, mimeType: input.mimeType },
      input.prompt,
      { jsonMode: true, maxTokens: 800 },
    );

    await (this.prisma as any).aIUsageRecord.create({
      data: {
        organizationId,
        userId,
        feature: input.feature,
        provider: provider.name,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        estimated: result.tokensEstimated,
      },
    });

    return { available: true, text: result.text, provider: provider.name, model: result.model };
  }
}
