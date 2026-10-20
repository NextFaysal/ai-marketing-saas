import { Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { LearningService } from "./learning.service";
import { maskSensitiveText } from "../inbox/pii-mask";
import { buildLlmProvider } from "./llm/llm.factory";
import type { LlmProvider } from "./llm/llm.types";
import { resolveOrgLlmConfig } from "./llm/org-llm-config";
import { effectiveLlmConfig } from "../common/platform-config";
import { aiPauseReason, killSwitches } from "../common/platform-settings";
import { badRequest, notFound } from "../i18n/api-exception";

/**
 * SA-B5 (Smart AI Phase 0, P8a): brand voice learning — the
 * Brain studies how the org's own STAFF actually write, and
 * proposes a structured voice profile (tone, emoji use,
 * greeting, language mix, sentence length, signature phrases,
 * example snippets).
 *
 * Laws, in order:
 *  - D4: voice is learned from conversations, so it sits
 *    behind the SAME opt-in as conversation mining
 *    (BusinessProfile.conversationLearningEnabled, default
 *    OFF). The gate is checked BEFORE any provider resolution
 *    — an org that never opted in costs zero LLM calls.
 *  - L3: every sampled message is scrubbed with
 *    maskSensitiveText before it is assembled into a prompt;
 *    the only recipient is the org's OWN configured provider.
 *  - L2: the model may only DESCRIBE style. greetingStyle,
 *    signaturePhrases and every example snippet must be
 *    copied verbatim from the masked samples — each one is
 *    verified as a substring of the samples before storage
 *    and dropped if the model invented it.
 *  - D3: the result is a SUGGESTION (profile status
 *    "suggested"). It shapes nothing until a human activates
 *    it; a re-learn while a profile is active waits in the
 *    pending columns and never overwrites the live traits.
 *
 * Home decision (recorded): the profile lives in its own
 * AiBrandVoiceProfile row, NOT as a LearnedItem — it is a
 * structured, per-org singleton (traits + examples + an
 * activation state), not a piece of knowledge content; the
 * LearnedItem queue stays for content the Brain may QUOTE.
 * The human decision still flows through explicit
 * activate/dismiss endpoints with audit rows, the same review
 * discipline as LearnedItem approval.
 *
 * Precedence (recorded, applied in OrgBrainService): the
 * owner's explicit BusinessProfile.brandVoice text is a
 * standing instruction and wins over the learned profile
 * wherever they conflict.
 */

export const MIN_STAFF_SAMPLES = 5;
const MAX_CONVERSATIONS = 40;
const MAX_MESSAGES_PER_CONVERSATION = 30;
const MAX_SAMPLES = 120;
const MAX_ORGS_PER_SWEEP = 200;

const VOICE_SYSTEM = [
  "You summarise a shop's customer-reply STYLE from samples of its staff's sent messages (already privacy-masked).",
  "Return ONLY JSON of the shape {\"traits\": {\"formality\": \"formal\"|\"neutral\"|\"friendly\", \"emojiUse\": \"none\"|\"light\"|\"frequent\", \"greetingStyle\": string|null, \"languageMix\": \"bn\"|\"en\"|\"mixed\", \"avgSentence\": \"short\"|\"medium\"|\"long\", \"signaturePhrases\": [string]}, \"examples\": [string]}.",
  "- greetingStyle, signaturePhrases and examples MUST be copied VERBATIM from the samples — never invent a phrase the staff did not write.",
  "- examples: at most 3 short messages that best show the style.",
  "- Describe STYLE only. Never state product facts, prices, policies or promises.",
].join("\n");

export interface VoiceLearnResult {
  status: "ok" | "skipped";
  reason?: string;
  samples: number;
  profileStatus?: string;
}

const normText = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Verbatim check on whitespace-normalised text: a phrase the
 * model claims the staff wrote must actually appear in the
 * (masked) samples it was shown. */
export function appearsInSamples(needle: string, samplesJoined: string): boolean {
  const n = normText(needle);
  if (!n) return false;
  return normText(samplesJoined).includes(n);
}

const pickEnum = (v: any, allowed: string[], fallback: string | null): string | null =>
  typeof v === "string" && allowed.includes(v) ? v : fallback;

/** Validate + anti-invent a raw LLM voice summary. Anything
 * off-vocabulary is coerced or dropped; any phrase or example
 * that is not verbatim in the samples is dropped. */
export function validateVoiceSummary(
  parsed: any,
  samples: string[],
): { traits: Record<string, unknown>; examples: string[] } | null {
  if (!parsed || typeof parsed !== "object") return null;
  const raw = parsed.traits && typeof parsed.traits === "object" ? parsed.traits : null;
  if (!raw) return null;
  const joined = samples.join("\n");
  const traits: Record<string, unknown> = {
    formality: pickEnum(raw.formality, ["formal", "neutral", "friendly"], "neutral"),
    emojiUse: pickEnum(raw.emojiUse, ["none", "light", "frequent"], "none"),
    greetingStyle:
      typeof raw.greetingStyle === "string" && appearsInSamples(raw.greetingStyle, joined)
        ? raw.greetingStyle.trim().slice(0, 120)
        : null,
    languageMix: pickEnum(raw.languageMix, ["bn", "en", "mixed"], null),
    avgSentence: pickEnum(raw.avgSentence, ["short", "medium", "long"], null),
    signaturePhrases: (Array.isArray(raw.signaturePhrases) ? raw.signaturePhrases : [])
      .filter((p: any) => typeof p === "string" && appearsInSamples(p, joined))
      .map((p: string) => p.trim().slice(0, 60))
      .slice(0, 5),
  };
  const examples = (Array.isArray(parsed.examples) ? parsed.examples : [])
    .filter((e: any) => typeof e === "string" && appearsInSamples(e, joined))
    .map((e: string) => e.trim().slice(0, 300))
    .slice(0, 3);
  return { traits, examples };
}

/** Tolerant JSON parse (same discipline as conversation
 * mining): fences stripped, outermost object, garbage -> null. */
export function parseVoiceSummary(text: string): any | null {
  try {
    const cleaned = String(text ?? "").replace(/```(?:json)?/gi, " ").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

@Injectable()
export class VoiceLearningService {
  private readonly logger = new Logger(VoiceLearningService.name);
  private learningFallback?: LearningService;

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly learning?: LearningService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly deps?: { providerResolver?: (organizationId: string) => Promise<LlmProvider | null> },
  ) {}

  private db(): any {
    if (!this.prisma) throw new Error("VoiceLearningService: PrismaService is not available");
    return this.prisma as any;
  }

  private learn(): LearningService {
    return this.learning ?? (this.learningFallback ??= new LearningService(this.prisma as any));
  }

  /** Resolve the org's chat provider exactly as the chat layer
   * does (org config -> platform config). Null when the
   * effective provider is not a real LLM. */
  private async resolveProvider(organizationId: string): Promise<LlmProvider | null> {
    if (this.deps?.providerResolver) return this.deps.providerResolver(organizationId);
    const creds = await resolveOrgLlmConfig(this.prisma as any, organizationId).catch(() => null);
    const provider = creds
      ? buildLlmProvider(creds.provider, creds.apiKey, creds.model)
      : (() => {
          const cfg = effectiveLlmConfig();
          return buildLlmProvider(cfg.provider, cfg.apiKey, cfg.model);
        })();
    return provider.isRealLlm ? provider : null;
  }

  /** Recent STAFF-sent message texts for the org, PII-masked.
   * AI replies (autoReply) and unsent drafts never count —
   * the voice being learned is the humans'. */
  private async sampleStaffMessages(organizationId: string): Promise<string[]> {
    const conversations = await this.db().channelConversation.findMany({
      where: { organizationId, isPractice: false },
      orderBy: { lastMessageAt: "desc" },
      take: MAX_CONVERSATIONS,
    });
    const samples: string[] = [];
    for (const conv of conversations ?? []) {
      if (samples.length >= MAX_SAMPLES) break;
      const messages = await this.db().channelMessage.findMany({
        where: { conversationId: conv.id, direction: "out" },
        orderBy: { createdAt: "desc" },
        take: MAX_MESSAGES_PER_CONVERSATION,
      });
      for (const m of messages ?? []) {
        if (samples.length >= MAX_SAMPLES) break;
        if (!m.sentByUserId || m.autoReply) continue;
        if (m.status && !["sent", "delivered", "read"].includes(m.status)) continue;
        const raw = String(m?.content ?? "").trim();
        if (!raw) continue;
        samples.push(maskSensitiveText(raw).slice(0, 500));
      }
    }
    return samples;
  }

  /** Learn (or re-propose) one org's voice profile. Never
   * throws; never calls the LLM when the org has not opted in
   * or AI is kill-switched for it. */
  async learnOrg(organizationId: string): Promise<VoiceLearnResult> {
    const out: VoiceLearnResult = { status: "ok", samples: 0 };
    try {
      const toggles = await this.learn().getToggles(organizationId);
      if (!toggles.conversationLearningEnabled) {
        return { ...out, status: "skipped", reason: "conversation_learning_disabled" };
      }
      const ks = await killSwitches(this.prisma as any).catch(() => ({ aiDisabledOrgIds: [] as string[] }));
      const pauseReason = aiPauseReason(ks, organizationId);
      if (pauseReason) {
        return { ...out, status: "skipped", reason: pauseReason };
      }
      const provider = await this.resolveProvider(organizationId);
      if (!provider) {
        await this.learn().saveState(organizationId, "brand_voice", {
          lastStatus: "skipped", lastDetail: { reason: "no_real_llm_provider" },
        });
        return { ...out, status: "skipped", reason: "no_real_llm_provider" };
      }
      const samples = await this.sampleStaffMessages(organizationId);
      out.samples = samples.length;
      if (samples.length < MIN_STAFF_SAMPLES) {
        await this.learn().saveState(organizationId, "brand_voice", {
          lastStatus: "skipped", lastDetail: { reason: "insufficient_staff_messages", samples: samples.length },
        });
        return { ...out, status: "skipped", reason: "insufficient_staff_messages" };
      }

      let result;
      try {
        result = await provider.complete(
          [
            { role: "system", content: VOICE_SYSTEM },
            { role: "user", content: samples.map((s, i) => `${i + 1}. ${s}`).join("\n").slice(0, 12_000) },
          ],
          { jsonMode: true, maxTokens: 800 },
        );
      } catch (e) {
        this.logger.warn(`voice summary call failed for org ${organizationId}: ${e instanceof Error ? e.message : String(e)}`);
        return { ...out, status: "skipped", reason: "llm_call_failed" };
      }
      await this.db().aIUsageRecord.create({
        data: {
          organizationId, userId: "system", feature: "brand_voice_learning",
          provider: provider.name, model: result.model,
          inputTokens: result.inputTokens, outputTokens: result.outputTokens,
          estimated: result.tokensEstimated,
        },
      }).catch(() => undefined);

      const validated = validateVoiceSummary(parseVoiceSummary(result.text), samples);
      if (!validated) {
        await this.learn().saveState(organizationId, "brand_voice", {
          lastStatus: "skipped", lastDetail: { reason: "unparseable_voice_summary", samples: samples.length },
        });
        return { ...out, status: "skipped", reason: "unparseable_voice_summary" };
      }

      const existing = await this.db().aiBrandVoiceProfile.findUnique({ where: { organizationId } });
      let profileStatus: string;
      if (!existing) {
        await this.db().aiBrandVoiceProfile.create({
          data: {
            organizationId,
            traits: validated.traits as any,
            exampleSnippets: validated.examples as any,
            status: "suggested",
          },
        });
        profileStatus = "suggested";
      } else if (existing.status === "active") {
        // D3: a live profile is NEVER overwritten by a re-learn;
        // the proposal waits in the pending columns.
        await this.db().aiBrandVoiceProfile.update({
          where: { id: existing.id },
          data: { pendingTraits: validated.traits as any, pendingExamples: validated.examples as any },
        });
        profileStatus = "active_with_pending";
      } else {
        await this.db().aiBrandVoiceProfile.update({
          where: { id: existing.id },
          data: { traits: validated.traits as any, exampleSnippets: validated.examples as any },
        });
        profileStatus = "suggested";
      }
      await this.audit?.log({
        organizationId, userId: "system", action: "brand_voice.suggested",
        entityType: "AiBrandVoiceProfile", entityId: existing?.id ?? organizationId,
        metadata: { samples: samples.length, profileStatus },
      }).catch(() => undefined);
      await this.learn().saveState(organizationId, "brand_voice", {
        lastStatus: "ok", lastDetail: { samples: samples.length, profileStatus },
      });
      return { ...out, profileStatus };
    } catch (e) {
      this.logger.error(`voice learning failed for org ${organizationId}: ${e instanceof Error ? e.message : String(e)}`);
      await this.learn()
        .saveState(organizationId, "brand_voice", { lastStatus: "failed", lastDetail: { reason: "voice_learning_failed" } })
        .catch(() => undefined);
      return { ...out, status: "skipped", reason: "voice_learning_failed" };
    }
  }

  async getProfile(organizationId: string) {
    return this.db().aiBrandVoiceProfile.findUnique({ where: { organizationId } });
  }

  /** Human activation: promote the pending re-learn proposal
   * when one waits, otherwise flip suggested -> active. */
  async activate(organizationId: string, actorId: string) {
    const row = await this.getProfile(organizationId);
    if (!row) throw notFound("ai.brandVoiceProfileNotFound");
    let updated;
    if (row.pendingTraits) {
      updated = await this.db().aiBrandVoiceProfile.update({
        where: { id: row.id },
        data: {
          traits: row.pendingTraits,
          exampleSnippets: (row.pendingExamples ?? []) as any,
          pendingTraits: null,
          pendingExamples: null,
          status: "active",
        },
      });
    } else if (row.status !== "active") {
      updated = await this.db().aiBrandVoiceProfile.update({
        where: { id: row.id },
        data: { status: "active" },
      });
    } else {
      throw badRequest("ai.brandVoiceProfileIsAlreadyActive");
    }
    await this.audit?.log({
      organizationId, userId: actorId, action: "brand_voice.activate",
      entityType: "AiBrandVoiceProfile", entityId: row.id, metadata: {},
    });
    return updated;
  }

  /** Human dismissal: drop a pending re-learn proposal, or
   * delete a never-activated suggestion outright. An ACTIVE
   * profile with nothing pending cannot be dismissed here —
   * deactivating a live voice is a settings act, not a
   * suggestion review. */
  async dismissSuggestion(organizationId: string, actorId: string) {
    const row = await this.getProfile(organizationId);
    if (!row) throw notFound("ai.brandVoiceProfileNotFound");
    if (row.pendingTraits) {
      const updated = await this.db().aiBrandVoiceProfile.update({
        where: { id: row.id },
        data: { pendingTraits: null, pendingExamples: null },
      });
      await this.audit?.log({
        organizationId, userId: actorId, action: "brand_voice.dismiss",
        entityType: "AiBrandVoiceProfile", entityId: row.id, metadata: { scope: "pending" },
      });
      return updated;
    }
    if (row.status === "suggested") {
      await this.db().aiBrandVoiceProfile.delete({ where: { id: row.id } });
      await this.audit?.log({
        organizationId, userId: actorId, action: "brand_voice.dismiss",
        entityType: "AiBrandVoiceProfile", entityId: row.id, metadata: { scope: "suggested" },
      });
      return { dismissed: true, id: row.id };
    }
    throw badRequest("ai.nothingToDismissTheActiveProfile");
  }

  /** The brand_voice_learning_sweep job body: only opted-in
   * orgs are even looked at. One org's failure never stops
   * the sweep. */
  async runSweep(): Promise<{ orgs: number; results: { organizationId: string; status: string; reason?: string }[] }> {
    const results: { organizationId: string; status: string; reason?: string }[] = [];
    try {
      const profiles = await this.db().businessProfile.findMany({
        where: { conversationLearningEnabled: true },
        select: { organizationId: true },
        take: MAX_ORGS_PER_SWEEP,
      });
      for (const p of profiles ?? []) {
        const r = await this.learnOrg(String(p.organizationId));
        results.push({ organizationId: String(p.organizationId), status: r.status, reason: r.reason });
      }
    } catch (e) {
      this.logger.error(`brand voice learning sweep failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { orgs: results.length, results };
  }
}
