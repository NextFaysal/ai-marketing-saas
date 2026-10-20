/**
 * SA-B6 (Smart AI Phase 0, P9): pure display helpers for the
 * tenant Learn Dashboard (Organization Settings → "🧠 AI শিখন").
 * Everything here is a deterministic mapping from API vocabulary
 * to plain Bengali labels — no data is invented; unknown values
 * fall back to the raw value so nothing is ever silently hidden.
 */

import { intlLocaleOf, normalizeUiLocale } from "@repo/contracts";
import type { UiLocale } from "./i18n/dict";
import { tr } from "./i18n/lookup";
import { aiBn, aiEn } from "./i18n/ai";

const AI_DICTS = { bn: aiBn, en: aiEn };
/** MB2 (ML6): label helpers read the `ai` namespace directly and
 * take an optional locale (default "bn" — existing callers and
 * tests keep the Bengali output they have today). */
function L(locale: UiLocale | undefined, key: string, params?: Record<string, string | number>): string {
  return tr(AI_DICTS, locale ?? "bn", key, params) ?? key;
}

export const LEARNING_WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"];
export const LEARNING_DELETE_ROLES = ["OWNER", "ADMIN"];

export function canWriteLearning(role: string | null | undefined): boolean {
  return !!role && LEARNING_WRITE_ROLES.includes(role);
}

export function canDeleteLearning(role: string | null | undefined): boolean {
  return !!role && LEARNING_DELETE_ROLES.includes(role);
}

export interface BrainOverview {
  organizationId: string;
  knowledge: { total: number; public: number; internal: number; websitePages: number };
  embeddings: {
    available: boolean;
    reason: string | null;
    provider: string | null;
    model: string | null;
    indexedChunks: number;
    indexedProducts: number;
    retrievalMode: "hybrid" | "keyword";
  };
  answers: { active: number; invalidated: number; disabled: number; total: number; totalHits: number; storeEnabled: boolean };
  learning: {
    pendingSuggestions: number;
    toggles: { conversationLearningEnabled: boolean; websiteLearningEnabled: boolean; websiteUrl: string | null };
    sources: {
      website: LearningStateSummary | null;
      conversation: LearningStateSummary | null;
      performance: LearningStateSummary | null;
    };
  };
  performance: { lastSnapshotAt: string; periodStart: string; periodEnd: string } | null;
  brandVoice: { status: string; hasPendingSuggestion: boolean };
  customerMemories: { count: number };
  unanswered: { open: number };
  coverage: { percent: number; areas: { key: string; present: boolean }[]; gaps: string[] };
}

export interface LearningStateSummary {
  lastRunAt: string | null;
  lastStatus: string | null;
  reason: string | null;
}

export function coverageAreaLabel(key: string, locale: UiLocale = "bn"): string {
  switch (key) {
    case "profile": return L(locale, "learnCoverageProfile");
    case "policies": return L(locale, "learnCoveragePolicies");
    case "knowledge": return L(locale, "learnCoverageKnowledge");
    case "products": return L(locale, "learnCoverageProducts");
    case "website": return L(locale, "learnCoverageWebsite");
    case "answers": return L(locale, "learnCoverageAnswers");
    case "brandVoice": return L(locale, "learnCoverageBrandVoice");
    case "customerMemory": return L(locale, "learnCoverageCustomerMemory");
    default: return key;
  }
}

export function learningStateText(state: LearningStateSummary | null, locale: UiLocale = "bn"): string {
  if (!state || !state.lastRunAt) return L(locale, "learnStateNeverRun");
  const when = formatDate(state.lastRunAt, locale);
  if (state.lastStatus === "ok") return L(locale, "learnStateLastRunOk", { when });
  if (state.lastStatus === "failed") return L(locale, "learnStateLastRunFailed", { when });
  if (state.lastStatus === "skipped") return state.reason
    ? L(locale, "learnStateLastRunSkippedReason", { when, reason: state.reason })
    : L(locale, "learnStateLastRunSkipped", { when });
  return L(locale, "learnStateLastRunPlain", { when });
}

export function formatDate(value: string | null | undefined, locale: UiLocale = "bn"): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  // Short-month form: @repo/contracts fmt* has no short-date variant,
  // so Intl is used directly with the contracts locale mapping
  // (intlLocaleOf) — same rendering the contracts module produces.
  return new Intl.DateTimeFormat(intlLocaleOf(normalizeUiLocale(locale)), { year: "numeric", month: "short", day: "numeric" }).format(d);
}

export function learnedKindLabel(kind: string, locale: UiLocale = "bn"): string {
  switch (kind) {
    case "faq_pair": return L(locale, "learnKindFaq");
    case "fact": return L(locale, "learnKindFact");
    case "product_note": return L(locale, "learnKindProductNote");
    default: return kind;
  }
}

export function learnedSourceLabel(sourceType: string, locale: UiLocale = "bn"): string {
  switch (sourceType) {
    case "conversation": return L(locale, "learnSourceConversation");
    case "unanswered": return L(locale, "learnSourceUnanswered");
    case "website": return L(locale, "learnSourceWebsite");
    case "product": return L(locale, "learnSourceProduct");
    case "performance": return L(locale, "learnSourcePerformance");
    default: return sourceType;
  }
}

/** What approving a suggested item will create — mirrors the
 * SA-B4 LearningService mapping so the UI never promises a
 * different outcome than the API delivers. */
export function approvalTargetText(item: { kind: string; sourceType: string }, locale: UiLocale = "bn"): string {
  if (item.kind === "faq_pair") return L(locale, "learnApprovalFaq");
  if (item.kind === "product_note") return L(locale, "learnApprovalProductNote");
  if (item.sourceType === "performance") return L(locale, "learnApprovalPerformance");
  return L(locale, "learnApprovalDefault");
}

/** Whether the approve call accepts a visibility choice at all:
 * only plain facts from non-performance sources — everything
 * else has a fixed class in the API (SA-B4/SA-B5 rules). */
export function approvalAllowsVisibilityChoice(item: { kind: string; sourceType: string }): boolean {
  return item.kind === "fact" && item.sourceType !== "performance";
}

export function defaultApprovalVisibility(item: { kind: string; sourceType: string }): "public" | "internal" {
  if (item.kind === "product_note" || item.sourceType === "performance") return "internal";
  return item.sourceType === "website" || item.sourceType === "product" ? "public" : "internal";
}

export function answerOriginLabel(origin: string, locale: UiLocale = "bn"): string {
  switch (origin) {
    case "autopilot_grounded": return L(locale, "learnOriginAutopilot");
    case "staff_approved": return L(locale, "learnOriginStaffApproved");
    case "staff_edited": return L(locale, "learnOriginStaffEdited");
    default: return origin;
  }
}

export function answerStatusLabel(status: string, locale: UiLocale = "bn"): string {
  switch (status) {
    case "active": return L(locale, "learnStatusActive");
    case "disabled": return L(locale, "learnStatusDisabled");
    case "invalidated": return L(locale, "learnStatusInvalidated");
    default: return status;
  }
}

/** SA-B3's invalidation vocabulary in plain language. */
export function invalidReasonLabel(reason: string | null | undefined, locale: UiLocale = "bn"): string {
  switch (reason) {
    case "source_doc_changed": return L(locale, "learnInvalidDocChanged");
    case "source_doc_removed": return L(locale, "learnInvalidDocRemoved");
    case "source_doc_reclassified": return L(locale, "learnInvalidDocReclassified");
    case "source_policy_changed": return L(locale, "learnInvalidPolicyChanged");
    case "source_policy_removed": return L(locale, "learnInvalidPolicyRemoved");
    case "source_profile_changed": return L(locale, "learnInvalidProfileChanged");
    case "product_unavailable": return L(locale, "learnInvalidProductUnavailable");
    case "product_changed": return L(locale, "learnInvalidProductChanged");
    case "live_facts_changed": return L(locale, "learnInvalidLiveFacts");
    case "number_guard_failed": return L(locale, "learnInvalidNumberGuard");
    default: return reason ?? "";
  }
}

export function previewText(text: string, max = 240): string {
  const t = String(text ?? "");
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** AiBrandVoiceProfile traits (closed vocabularies from SA-B5)
 * in plain language. Unknown values are shown raw, never dropped. */
export function voiceTraitLines(traits: Record<string, unknown> | null | undefined, locale: UiLocale = "bn"): string[] {
  if (!traits || typeof traits !== "object") return [];
  const lines: string[] = [];
  const formality: Record<string, string> = { formal: L(locale, "learnVoiceFormalityFormal"), neutral: L(locale, "learnVoiceFormalityNeutral"), friendly: L(locale, "learnVoiceFormalityFriendly") };
  const emoji: Record<string, string> = { none: L(locale, "learnVoiceEmojiNone"), light: L(locale, "learnVoiceEmojiLight"), frequent: L(locale, "learnVoiceEmojiFrequent") };
  const mix: Record<string, string> = { bn: L(locale, "learnVoiceMixBn"), en: L(locale, "learnVoiceMixEn"), mixed: L(locale, "learnVoiceMixMixed") };
  const sentence: Record<string, string> = { short: L(locale, "learnVoiceSentenceShort"), medium: L(locale, "learnVoiceSentenceMedium"), long: L(locale, "learnVoiceSentenceLong") };
  if (typeof traits.formality === "string") lines.push(formality[traits.formality] ?? L(locale, "learnVoiceFormalityFallback", { value: traits.formality }));
  if (typeof traits.emojiUse === "string") lines.push(emoji[traits.emojiUse] ?? L(locale, "learnVoiceEmojiFallback", { value: traits.emojiUse }));
  if (typeof traits.languageMix === "string") lines.push(mix[traits.languageMix] ?? L(locale, "learnVoiceMixFallback", { value: traits.languageMix }));
  if (typeof traits.avgSentence === "string") lines.push(sentence[traits.avgSentence] ?? L(locale, "learnVoiceSentenceFallback", { value: traits.avgSentence }));
  if (typeof traits.greetingStyle === "string" && traits.greetingStyle) lines.push(L(locale, "learnVoiceGreeting", { value: traits.greetingStyle }));
  if (Array.isArray(traits.signaturePhrases)) {
    for (const p of traits.signaturePhrases) if (typeof p === "string" && p) lines.push(L(locale, "learnVoiceSignature", { value: p }));
  }
  return lines;
}

export function languagePrefLabel(pref: string | null | undefined, locale: UiLocale = "bn"): string {
  switch (pref) {
    case "bn": return L(locale, "learnLangBn");
    case "en": return L(locale, "learnLangEn");
    case "mixed": return L(locale, "learnLangMixed");
    default: return L(locale, "learnLangUnknown");
  }
}

export function unansweredReasonLabel(reason: string, locale: UiLocale = "bn"): string {
  switch (reason) {
    case "no_answer": return L(locale, "learnUnansweredNoAnswer");
    case "knowledge_gap": return L(locale, "learnUnansweredKnowledgeGap");
    case "low_confidence": return L(locale, "learnUnansweredLowConfidence");
    default: return reason;
  }
}

export function brandVoiceStatusText(status: string, hasPending: boolean, locale: UiLocale = "bn"): string {
  if (status === "active") return hasPending ? L(locale, "learnBrandVoiceActivePending") : L(locale, "learnBrandVoiceActive");
  if (status === "suggested") return L(locale, "learnBrandVoiceSuggested");
  return L(locale, "learnBrandVoiceNotLearned");
}
