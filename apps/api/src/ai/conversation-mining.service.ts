import { Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { LearningService } from "./learning.service";
import { CustomerMemoryService } from "./customer-memory.service";
import { AnswerStoreService, normalizeQuestion } from "./answer-store.service";
import { maskSensitiveText } from "../inbox/pii-mask";
import { buildLlmProvider } from "./llm/llm.factory";
import type { LlmProvider } from "./llm/llm.types";
import { resolveOrgLlmConfig } from "./llm/org-llm-config";
import { effectiveLlmConfig } from "../common/platform-config";
import { aiPauseReason, killSwitches } from "../common/platform-settings";

/**
 * SA-B4 (Smart AI Phase 0, P6): conversation learning — the
 * Brain reads RESOLVED inbox conversations and proposes what it
 * learned as SUGGESTED LearnedItems. It never writes live
 * knowledge (D3), and it never runs at all for an org that has
 * not opted in (D4: BusinessProfile.conversationLearningEnabled
 * defaults FALSE).
 *
 * Privacy discipline (L3), in order:
 *  1. The opt-in gate is checked BEFORE any provider resolution
 *     or LLM call — a disabled org costs zero calls (spec-proven
 *     with a provider spy).
 *  2. Every message text is scrubbed with the codebase's own
 *     maskSensitiveText (BD phone / card-like runs / TrxID-shaped
 *     tokens) BEFORE it is assembled into an extraction prompt —
 *     raw conversation text is never sent anywhere unscrubbed,
 *     and the only recipient is the org's OWN configured LLM
 *     provider (the same resolution chat uses: org OrgLlmConfig
 *     first, platform config second).
 *  3. Extracted candidates pass the Answer Store's own PII
 *     screen (screenAnswerPii) on BOTH question and answer —
 *     anything identifier-shaped (incl. order references, which
 *     the masker deliberately leaves alone) is dropped, not
 *     stored.
 *  4. Survivors land as status "suggested" only. Recorded
 *     limit: names and free-form addresses have no reliable
 *     shape to mask; the extraction prompt forbids personal
 *     data, the screens drop identifier shapes, and a human
 *     reviews every suggestion before it can go live (D3) —
 *     that review is the final gate, by design.
 *
 * Unanswered clusters (AiUnansweredQuestion, count >= 2) are
 * mined WITHOUT the LLM: a faq_pair is suggested only when a
 * staff answer actually exists in the linked conversation;
 * otherwise a fact records the gap. An answer is never invented.
 *
 * Watermark: LearningState(source "conversation") — only
 * conversations resolved after the watermark are mined, and
 * the watermark advances to the newest resolvedAt processed.
 * Runs are capped (50 conversations, 60 messages each) so one
 * sweep is always bounded; the remainder is picked up next run.
 */

export const MAX_CONVERSATIONS_PER_RUN = 50;
export const MAX_MESSAGES_PER_CONVERSATION = 60;
export const MAX_PAIRS_PER_CONVERSATION = 10;
export const UNANSWERED_CLUSTER_MIN_COUNT = 2;
const MAX_TRANSCRIPT_CHARS = 12_000;
const MAX_ORGS_PER_SWEEP = 200;

const EXTRACTION_SYSTEM = [
  "You extract reusable FAQ knowledge from a customer-support conversation transcript.",
  "The transcript is already privacy-masked. Rules:",
  "- Return ONLY JSON of the shape {\"pairs\": [{\"question\": string, \"answer\": string}], \"facts\": [{\"text\": string}]}.",
  "- A pair is a general question customers ask and the answer staff/AI actually gave. Rewrite the question generically (no names, no 'I/my').",
  "- NEVER include personal data: no names, phone numbers, addresses, order numbers, transaction ids, or anything specific to this one customer.",
  "- NEVER invent: if the conversation does not clearly answer a question, do not include the pair.",
  "- Facts are standalone reusable business facts stated in the conversation (policies, procedures), again with no personal data.",
  "- If nothing reusable exists, return {\"pairs\": [], \"facts\": []}.",
].join("\n");

export interface MineResult {
  status: "ok" | "skipped";
  reason?: string;
  conversations: number;
  pairs: number;
  facts: number;
  unanswered: number;
  llmCalls: number;
}

interface MinedPair { question: string; answer: string }

@Injectable()
export class ConversationMiningService {
  private readonly logger = new Logger(ConversationMiningService.name);
  private learningFallback?: LearningService;
  private storeFallback?: AnswerStoreService;
  private memoryFallback?: CustomerMemoryService;

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly learning?: LearningService,
    @Optional() private readonly answerStore?: AnswerStoreService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly deps?: { providerResolver?: (organizationId: string) => Promise<LlmProvider | null> },
    // SA-B5 (P8b): customer-memory refresh rides this sweep's
    // pass (the same D4 opt-in list). Appended LAST so every
    // existing positional construction keeps its meaning.
    @Optional() private readonly customerMemory?: CustomerMemoryService,
  ) {}

  private memory(): CustomerMemoryService {
    return this.customerMemory ?? (this.memoryFallback ??= new CustomerMemoryService(this.prisma as any));
  }

  private db(): any {
    if (!this.prisma) throw new Error("ConversationMiningService: PrismaService is not available");
    return this.prisma as any;
  }

  private learn(): LearningService {
    return this.learning ?? (this.learningFallback ??= new LearningService(this.prisma as any));
  }

  private store(): AnswerStoreService {
    return this.answerStore ?? (this.storeFallback ??= new AnswerStoreService(this.prisma as any));
  }

  /** Resolve the org's chat provider exactly as the chat layer
   * does (org config -> platform config). Returns null when the
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

  /** Mine one org. Never throws; never calls the LLM when the
   * org has not opted in or AI is kill-switched for it. */
  async mineOrg(organizationId: string): Promise<MineResult> {
    const out: MineResult = { status: "ok", conversations: 0, pairs: 0, facts: 0, unanswered: 0, llmCalls: 0 };
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
        await this.learn().saveState(organizationId, "conversation", {
          lastStatus: "skipped", lastDetail: { reason: "no_real_llm_provider" },
        });
        return { ...out, status: "skipped", reason: "no_real_llm_provider" };
      }

      const state = await this.learn().getState(organizationId, "conversation");
      const watermark: Date = state?.watermark ?? new Date(0);
      const conversations = await this.db().channelConversation.findMany({
        where: {
          organizationId,
          status: "closed",
          isPractice: false,
          OR: [{ resolvedAt: { gt: watermark } }, { resolvedAt: null, updatedAt: { gt: watermark } }],
        },
        orderBy: [{ resolvedAt: "asc" }, { updatedAt: "asc" }],
        take: MAX_CONVERSATIONS_PER_RUN,
      });

      let newest: Date | null = null;
      for (const conv of conversations ?? []) {
        out.conversations++;
        const stamp = conv.resolvedAt ?? conv.updatedAt;
        if (stamp && (!newest || stamp > newest)) newest = stamp;
        const mined = await this.mineConversation(organizationId, provider, conv, out);
        out.pairs += mined.pairs;
        out.facts += mined.facts;
      }

      out.unanswered = await this.mineUnanswered(organizationId);

      await this.learn().saveState(organizationId, "conversation", {
        ...(newest ? { watermark: newest } : {}),
        lastStatus: "ok",
        lastDetail: {
          conversations: out.conversations, pairs: out.pairs, facts: out.facts,
          unanswered: out.unanswered, llmCalls: out.llmCalls,
        },
      });
      return out;
    } catch (e) {
      this.logger.error(`conversation mining failed for org ${organizationId}: ${e instanceof Error ? e.message : String(e)}`);
      await this.learn()
        .saveState(organizationId, "conversation", {
          lastStatus: "failed", lastDetail: { reason: e instanceof Error ? e.message : "mining_failed" },
        })
        .catch(() => undefined);
      return { ...out, status: "skipped", reason: "mining_failed" };
    }
  }

  /** Extract + filter + suggest for ONE conversation. Returns
   * the counts of suggestions actually created. */
  private async mineConversation(
    organizationId: string,
    provider: LlmProvider,
    conv: any,
    counters: MineResult,
  ): Promise<{ pairs: number; facts: number }> {
    const none = { pairs: 0, facts: 0 };
    const messages = await this.db().channelMessage.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: "asc" },
      take: MAX_MESSAGES_PER_CONVERSATION,
    });
    const lines: string[] = [];
    let hasQuestion = false;
    let hasAnswer = false;
    for (const m of messages ?? []) {
      const raw = String(m?.content ?? m?.transcription ?? "").trim();
      if (!raw) continue;
      if (m.type && m.type !== "text" && !m?.transcription) continue;
      // PII scrub BEFORE anything else — the masked text is the
      // only text the LLM (and any log below) ever sees.
      const text = maskSensitiveText(raw).slice(0, 1000);
      if (m.direction === "in") {
        hasQuestion = true;
        lines.push(`Customer: ${text}`);
      } else if (m.direction === "out") {
        if (m.status && !["sent", "delivered", "read"].includes(m.status)) continue;
        hasAnswer = true;
        lines.push(`${m.autoReply ? "AI" : "Staff"}: ${text}`);
      }
    }
    if (!hasQuestion || !hasAnswer || !lines.length) return none;
    const transcript = lines.join("\n").slice(0, MAX_TRANSCRIPT_CHARS);

    let result;
    try {
      result = await provider.complete(
        [
          { role: "system", content: EXTRACTION_SYSTEM },
          { role: "user", content: transcript },
        ],
        { jsonMode: true, maxTokens: 1200 },
      );
      counters.llmCalls++;
    } catch (e) {
      this.logger.warn(`extraction call failed for org ${organizationId} conversation ${conv.id}: ${e instanceof Error ? e.message : String(e)}`);
      return none;
    }
    await this.db().aIUsageRecord.create({
      data: {
        organizationId, userId: "system", feature: "conversation_learning",
        provider: provider.name, model: result.model,
        inputTokens: result.inputTokens, outputTokens: result.outputTokens,
        estimated: result.tokensEstimated,
      },
    }).catch(() => undefined);

    const parsed = parseExtraction(result.text);
    let pairs = 0;
    let facts = 0;
    for (const pair of parsed.pairs.slice(0, MAX_PAIRS_PER_CONVERSATION)) {
      if (await this.pairAlreadyKnown(organizationId, pair.question)) continue;
      // Post-filter: the Answer Store's own PII screen on BOTH
      // sides — identifier-shaped content is dropped, not stored.
      if (await this.store().screenAnswerPii(organizationId, pair.answer)) continue;
      if (await this.store().screenAnswerPii(organizationId, pair.question)) continue;
      const created = await this.learn().createSuggestion(organizationId, {
        kind: "faq_pair",
        title: pair.question.slice(0, 120),
        content: { question: pair.question, answer: pair.answer },
        sourceType: "conversation",
        sourceRef: [conv.id],
      });
      if (created.created) pairs++;
    }
    for (const fact of parsed.facts.slice(0, MAX_PAIRS_PER_CONVERSATION)) {
      if (await this.store().screenAnswerPii(organizationId, fact.text)) continue;
      const created = await this.learn().createSuggestion(organizationId, {
        kind: "fact",
        title: fact.text.slice(0, 120),
        content: { text: fact.text },
        sourceType: "conversation",
        sourceRef: [conv.id],
      });
      if (created.created) facts++;
    }
    return { pairs, facts };
  }

  /** A pair is not re-suggested when the Answer Store already
   * holds a live (or human-disabled) entry for the question. */
  private async pairAlreadyKnown(organizationId: string, question: string): Promise<boolean> {
    try {
      const existing = await this.db().aiStoredAnswer.findFirst({
        where: { organizationId, normalizedQuestion: normalizeQuestion(question), channel: "inbox" },
        select: { status: true },
      });
      return Boolean(existing) && existing.status !== "invalidated";
    } catch {
      return false;
    }
  }

  /** Unanswered clusters -> suggestions, deterministically (no
   * LLM): a faq_pair ONLY from a staff answer that exists in the
   * linked conversation; otherwise a fact recording the gap. */
  async mineUnanswered(organizationId: string): Promise<number> {
    let created = 0;
    try {
      const rows = await this.db().aiUnansweredQuestion.findMany({
        where: { organizationId, status: "open", count: { gte: UNANSWERED_CLUSTER_MIN_COUNT } },
        orderBy: [{ count: "desc" }, { lastSeenAt: "desc" }],
        take: 25,
      });
      for (const row of rows ?? []) {
        const question = String(row.questionText ?? "").trim();
        if (!question) continue;
        if (await this.pairAlreadyKnown(organizationId, question)) continue;
        const staffAnswer = row.conversationId
          ? await this.findStaffAnswer(organizationId, row.conversationId, String(row.normalizedQuestion ?? ""))
          : null;
        if (staffAnswer) {
          const r = await this.learn().createSuggestion(organizationId, {
            kind: "faq_pair",
            title: question.slice(0, 120),
            content: { question, answer: staffAnswer },
            sourceType: "unanswered",
            sourceRef: [row.id],
          });
          if (r.created) created++;
        } else {
          const r = await this.learn().createSuggestion(organizationId, {
            kind: "fact",
            title: `Unanswered question: ${question.slice(0, 100)}`,
            content: {
              text: `Customers have asked this ${row.count} time(s) and no approved answer exists yet: "${question}"`,
            },
            sourceType: "unanswered",
            sourceRef: [row.id],
          });
          if (r.created) created++;
        }
      }
    } catch (e) {
      this.logger.warn(`unanswered mining failed for org ${organizationId}: ${e instanceof Error ? e.message : String(e)}`);
    }
    return created;
  }

  /** The first STAFF (human, non-AI) text reply after the
   * clustered question in its conversation — masked, screened,
   * or null. AI replies do not count: an unanswered question by
   * definition has no trusted answer yet. */
  private async findStaffAnswer(organizationId: string, conversationId: string, normalized: string): Promise<string | null> {
    try {
      const conv = await this.db().channelConversation.findFirst({
        where: { id: conversationId, organizationId },
        select: { id: true },
      });
      if (!conv) return null;
      const messages = await this.db().channelMessage.findMany({
        where: { conversationId },
        orderBy: { createdAt: "asc" },
        take: MAX_MESSAGES_PER_CONVERSATION,
      });
      let questionSeen = !normalized;
      for (const m of messages ?? []) {
        const raw = String(m?.content ?? "").trim();
        if (!raw) continue;
        if (m.direction === "in") {
          if (normalizeQuestion(raw) === normalized) questionSeen = true;
          continue;
        }
        if (!questionSeen) continue;
        if (m.direction === "out" && m.sentByUserId && !m.autoReply && (!m.status || ["sent", "delivered", "read"].includes(m.status))) {
          const masked = maskSensitiveText(raw).slice(0, 2000);
          if (await this.store().screenAnswerPii(organizationId, masked)) return null;
          return masked;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /** The conversation_learning_sweep job body: only orgs that
   * opted in are even looked at. One org's failure never stops
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
        const orgId = String(p.organizationId);
        // SA-B5 (P8b): refresh per-customer memories for the
        // org BEFORE mining — deterministic, no LLM, and it
        // runs even when mining itself will skip (no provider):
        // memory is bookkeeping over the org's own rows, mining
        // is the LLM step. Failure-isolated: a memory failure
        // never blocks mining.
        await this.memory()
          .refreshOrg(orgId)
          .catch(() => undefined);
        const r = await this.mineOrg(orgId);
        results.push({ organizationId: orgId, status: r.status, reason: r.reason });
      }
    } catch (e) {
      this.logger.error(`conversation learning sweep failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { orgs: results.length, results };
  }
}

/** Tolerant extraction-JSON parse: strip code fences, take the
 * outermost object, validate shapes, cap lengths. Anything
 * malformed yields empty lists — a bad LLM reply mines nothing,
 * never garbage. */
export function parseExtraction(text: string): { pairs: MinedPair[]; facts: { text: string }[] } {
  const empty = { pairs: [] as MinedPair[], facts: [] as { text: string }[] };
  try {
    const cleaned = String(text ?? "").replace(/```(?:json)?/gi, " ").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return empty;
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    const pairs: MinedPair[] = [];
    for (const p of Array.isArray(parsed?.pairs) ? parsed.pairs : []) {
      const question = String(p?.question ?? "").trim().slice(0, 500);
      const answer = String(p?.answer ?? "").trim().slice(0, 2000);
      if (question && answer) pairs.push({ question, answer });
    }
    const facts: { text: string }[] = [];
    for (const f of Array.isArray(parsed?.facts) ? parsed.facts : []) {
      const t = String(f?.text ?? f ?? "").trim().slice(0, 1000);
      if (t) facts.push({ text: t });
    }
    return { pairs, facts };
  } catch {
    return empty;
  }
}
