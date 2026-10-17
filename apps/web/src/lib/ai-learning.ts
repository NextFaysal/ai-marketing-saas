/**
 * SA-B6 (Smart AI Phase 0, P9): pure display helpers for the
 * tenant Learn Dashboard (Organization Settings → "🧠 AI শিখন").
 * Everything here is a deterministic mapping from API vocabulary
 * to plain Bengali labels — no data is invented; unknown values
 * fall back to the raw value so nothing is ever silently hidden.
 */

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

export function coverageAreaLabel(key: string): string {
  switch (key) {
    case "profile": return "ব্যবসার প্রোফাইল";
    case "policies": return "পলিসি";
    case "knowledge": return "জ্ঞান ডকুমেন্ট";
    case "products": return "পণ্যের তথ্য";
    case "website": return "ওয়েবসাইটের পেজ";
    case "answers": return "সংরক্ষিত উত্তর";
    case "brandVoice": return "ব্র্যান্ড ভয়েস";
    case "customerMemory": return "কাস্টমার স্মৃতি";
    default: return key;
  }
}

export function learningStateText(state: LearningStateSummary | null): string {
  if (!state || !state.lastRunAt) return "এখনো চালানো হয়নি";
  const when = formatDate(state.lastRunAt);
  if (state.lastStatus === "ok") return `শেষ চালানো: ${when} (সফল)`;
  if (state.lastStatus === "failed") return `শেষ চালানো: ${when} (ব্যর্থ)`;
  if (state.lastStatus === "skipped") return `শেষ চালানো: ${when} (এড়িয়ে যাওয়া হয়েছে${state.reason ? ` — ${state.reason}` : ""})`;
  return `শেষ চালানো: ${when}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("bn-BD", { year: "numeric", month: "short", day: "numeric" });
}

export function learnedKindLabel(kind: string): string {
  switch (kind) {
    case "faq_pair": return "প্রশ্নোত্তর";
    case "fact": return "তথ্য";
    case "product_note": return "পণ্যের নোট";
    default: return kind;
  }
}

export function learnedSourceLabel(sourceType: string): string {
  switch (sourceType) {
    case "conversation": return "কথোপকথন থেকে শেখা";
    case "unanswered": return "উত্তর-না-পাওয়া প্রশ্ন থেকে";
    case "website": return "ওয়েবসাইট থেকে";
    case "product": return "পণ্য থেকে";
    case "performance": return "পারফরম্যান্স থেকে";
    default: return sourceType;
  }
}

/** What approving a suggested item will create — mirrors the
 * SA-B4 LearningService mapping so the UI never promises a
 * different outcome than the API delivers. */
export function approvalTargetText(item: { kind: string; sourceType: string }): string {
  if (item.kind === "faq_pair") return "অনুমোদন হলে উত্তর ভান্ডারে যাবে";
  if (item.kind === "product_note") return "অনুমোদন হলে অভ্যন্তরীণ নোট হিসেবে জ্ঞানে যাবে";
  if (item.sourceType === "performance") return "অনুমোদন হলে অভ্যন্তরীণ তথ্য হিসেবে জ্ঞানে যাবে";
  return "অনুমোদন হলে জ্ঞান ডকুমেন্ট হিসেবে যাবে";
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

export function answerOriginLabel(origin: string): string {
  switch (origin) {
    case "autopilot_grounded": return "AI-এর যাচাইকৃত উত্তর";
    case "staff_approved": return "অনুমোদিত শেখা উত্তর";
    case "staff_edited": return "স্টাফের সংশোধন করা উত্তর";
    default: return origin;
  }
}

export function answerStatusLabel(status: string): string {
  switch (status) {
    case "active": return "চালু";
    case "disabled": return "বন্ধ";
    case "invalidated": return "বাতিল (উৎস বদলেছে)";
    default: return status;
  }
}

/** SA-B3's invalidation vocabulary in plain language. */
export function invalidReasonLabel(reason: string | null | undefined): string {
  switch (reason) {
    case "source_doc_changed": return "উৎস ডকুমেন্ট বদলে গেছে";
    case "source_doc_removed": return "উৎস ডকুমেন্ট মুছে গেছে";
    case "source_doc_reclassified": return "উৎস ডকুমেন্ট অভ্যন্তরীণ করা হয়েছে";
    case "source_policy_changed": return "উৎস পলিসি বদলে গেছে";
    case "source_policy_removed": return "উৎস পলিসি মুছে গেছে";
    case "source_profile_changed": return "ব্যবসার তথ্য বদলে গেছে";
    case "product_unavailable": return "পণ্যটি আর পাওয়া যাচ্ছে না";
    case "product_changed": return "পণ্যের তথ্য বদলে গেছে";
    case "live_facts_changed": return "দাম/স্টকের তথ্য বদলে গেছে";
    case "number_guard_failed": return "সংখ্যা যাচাইয়ে আটকে গেছে";
    default: return reason ?? "";
  }
}

export function previewText(text: string, max = 240): string {
  const t = String(text ?? "");
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** AiBrandVoiceProfile traits (closed vocabularies from SA-B5)
 * in plain language. Unknown values are shown raw, never dropped. */
export function voiceTraitLines(traits: Record<string, unknown> | null | undefined): string[] {
  if (!traits || typeof traits !== "object") return [];
  const lines: string[] = [];
  const formality: Record<string, string> = { formal: "আনুষ্ঠানিক ভঙ্গিতে কথা বলে", neutral: "স্বাভাবিক ভঙ্গিতে কথা বলে", friendly: "বন্ধুসুলভ ভঙ্গিতে কথা বলে" };
  const emoji: Record<string, string> = { none: "ইমোজি ব্যবহার করে না", light: "মাঝে মাঝে ইমোজি ব্যবহার করে", frequent: "প্রায়ই ইমোজি ব্যবহার করে" };
  const mix: Record<string, string> = { bn: "মূলত বাংলায় লেখে", en: "মূলত ইংরেজিতে লেখে", mixed: "বাংলা-ইংরেজি মিশিয়ে লেখে" };
  const sentence: Record<string, string> = { short: "ছোট ছোট বাক্যে লেখে", medium: "মাঝারি আকারের বাক্যে লেখে", long: "বড় বাক্যে লেখে" };
  if (typeof traits.formality === "string") lines.push(formality[traits.formality] ?? `ভঙ্গি: ${traits.formality}`);
  if (typeof traits.emojiUse === "string") lines.push(emoji[traits.emojiUse] ?? `ইমোজি: ${traits.emojiUse}`);
  if (typeof traits.languageMix === "string") lines.push(mix[traits.languageMix] ?? `ভাষা: ${traits.languageMix}`);
  if (typeof traits.avgSentence === "string") lines.push(sentence[traits.avgSentence] ?? `বাক্য: ${traits.avgSentence}`);
  if (typeof traits.greetingStyle === "string" && traits.greetingStyle) lines.push(`শুভেচ্ছা: “${traits.greetingStyle}”`);
  if (Array.isArray(traits.signaturePhrases)) {
    for (const p of traits.signaturePhrases) if (typeof p === "string" && p) lines.push(`পরিচিত বাক্য: “${p}”`);
  }
  return lines;
}

export function languagePrefLabel(pref: string | null | undefined): string {
  switch (pref) {
    case "bn": return "বাংলা";
    case "en": return "ইংরেজি";
    case "mixed": return "বাংলা-ইংরেজি মিশ্র";
    default: return "জানা নেই";
  }
}

export function unansweredReasonLabel(reason: string): string {
  switch (reason) {
    case "no_answer": return "উত্তর মেলেনি";
    case "knowledge_gap": return "জ্ঞানে এই তথ্য নেই";
    case "low_confidence": return "নিশ্চিত উত্তর ছিল না";
    default: return reason;
  }
}

export function brandVoiceStatusText(status: string, hasPending: boolean): string {
  if (status === "active") return hasPending ? "চালু আছে — নতুন প্রস্তাব অপেক্ষমাণ" : "চালু আছে";
  if (status === "suggested") return "প্রস্তাব এসেছে — অনুমোদনের অপেক্ষায়";
  return "এখনো শেখা হয়নি";
}
