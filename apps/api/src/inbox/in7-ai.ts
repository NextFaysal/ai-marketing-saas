/**
 * IN7 — AI next-step helpers (pure, deterministic, unit-tested).
 *
 * - detectReplyLanguage: the customer's last-message language from
 *   script ratios only (no model call, no guessing). Bengali script
 *   (U+0980–U+09FF) vs Latin letters; a real mix is "mixed"
 *   (Banglish). No letters at all -> null (no instruction added).
 * - The next-action / tag / stage proposal contract: a CLOSED
 *   action allowlist (each action maps to an EXISTING UI path —
 *   nothing here ever sends or mutates), plus a strict parser for
 *   the model's JSON so a malformed or off-list answer degrades
 *   to "no proposal" instead of inventing a new capability.
 * - The unanswered-draft contract: the model may only propose a
 *   knowledge chunk OR an instruction line, as JSON, for a human
 *   to review. Parsing never writes anything.
 */

export type DetectedLanguage = "bn" | "en" | "mixed";

/** Bengali-script share >= 60% -> bn; Latin share >= 60% -> en;
 * both present in substance -> mixed; no letters -> null. */
export function detectReplyLanguage(text: string): DetectedLanguage | null {
  const s = String(text ?? "");
  let bn = 0;
  let latin = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    // Bengali block, minus its digits (U+09E6–U+09EF) — digits
    // carry no language.
    if (cp >= 0x0980 && cp <= 0x09ff && !(cp >= 0x09e6 && cp <= 0x09ef)) bn++;
    else if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) latin++;
  }
  const total = bn + latin;
  if (total === 0) return null;
  if (bn / total >= 0.6) return "bn";
  if (latin / total >= 0.6) return "en";
  return "mixed";
}

/** The prompt line for a detected language (IN7d). An explicit
 * owner override (BusinessProfile.aiReplyLanguage / Desk
 * override) always wins — the caller only consults this when no
 * override exists. */
export function detectedLanguageInstruction(lang: DetectedLanguage | null): string | null {
  if (lang === "bn") return "Always reply in Bengali (the customer's last message is mainly in Bengali).";
  if (lang === "en") return "Always reply in English (the customer's last message is mainly in English).";
  if (lang === "mixed") return "Reply in the same mix of Bengali and English (Banglish) as the customer's last message.";
  return null;
}

/**
 * IN7b: the closed set of suggested next actions. Every action
 * maps to a button/panel that ALREADY exists in the inbox UI:
 * - share_tracking  -> the 🚚 ট্র্যাকিং পাঠান button (shareTracking)
 * - cod_confirm     -> the COD confirmation flow for the linked order
 * - create_order    -> the চ্যাট থেকে Order panel (createChatOrder)
 * - wait_customer   -> nothing to do; the ball is with the customer
 * - reply_manually  -> focus the composer; a human should answer
 * - resolve         -> close the conversation (status switch)
 */
export const NEXT_ACTIONS = [
  "share_tracking",
  "cod_confirm",
  "create_order",
  "wait_customer",
  "reply_manually",
  "resolve",
] as const;
export type NextAction = (typeof NEXT_ACTIONS)[number];

export const NEXT_ACTION_LABELS: Record<NextAction, string> = {
  share_tracking: "ট্র্যাকিং পাঠান",
  cod_confirm: "COD কনফার্মেশন পাঠান",
  create_order: "অর্ডার তৈরি করুন",
  wait_customer: "গ্রাহকের উত্তরের অপেক্ষা করুন",
  reply_manually: "নিজে উত্তর দিন",
  resolve: "কথোপকথন বন্ধ করুন",
};

export interface NextActionProposal {
  action: NextAction;
  label: string;
  reason: string;
  /** IN7c: proposed tags (additive suggestions only — applied
   * solely when the agent clicks Accept, via updateConversation). */
  tags: string[];
  /** IN7c: proposed pipeline stage (same accept-only rule). */
  pipelineStage: string | null;
}

const PIPELINE_STAGES = ["new", "talking", "ordered", "delivered", "repeat"] as const;

/** First JSON object found in a model reply, or null. */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const s = String(text ?? "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(s.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function cleanTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const tag = t.trim().replace(/\s+/g, " ").slice(0, 40);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= 3) break;
  }
  return out;
}

/**
 * Strict parse of the model's next-action JSON. An action outside
 * the allowlist invalidates the WHOLE proposal (null) — a
 * suggestion we cannot map to a real UI path is not shown at all.
 * Tags/stage are sanitized independently; an invalid stage drops
 * to null rather than failing the action proposal.
 */
export function parseNextActionProposal(text: string): NextActionProposal | null {
  const obj = extractJsonObject(text);
  if (!obj) return null;
  const action = typeof obj.action === "string" ? obj.action : "";
  if (!(NEXT_ACTIONS as readonly string[]).includes(action)) return null;
  const reason = typeof obj.reason === "string" ? obj.reason.trim().slice(0, 300) : "";
  const stage = typeof obj.pipelineStage === "string" && (PIPELINE_STAGES as readonly string[]).includes(obj.pipelineStage)
    ? obj.pipelineStage
    : null;
  return {
    action: action as NextAction,
    label: NEXT_ACTION_LABELS[action as NextAction],
    reason,
    tags: cleanTags(obj.tags),
    pipelineStage: stage,
  };
}

export interface UnansweredDraftProposal {
  kind: "knowledge" | "instruction";
  title: string;
  content: string;
  reason: string;
}

/**
 * IN7e: strict parse of the unanswered-question draft proposal.
 * kind "knowledge" -> a knowledge chunk draft (title + content);
 * kind "instruction" -> a single instruction line for the Desk
 * draft. Anything else -> null. The result is DISPLAY-ONLY: the
 * endpoint never persists it; a human routes it through the
 * existing knowledge-create / Desk-draft paths.
 */
export function parseUnansweredDraft(text: string): UnansweredDraftProposal | null {
  const obj = extractJsonObject(text);
  if (!obj) return null;
  const kind = obj.kind === "knowledge" || obj.kind === "instruction" ? obj.kind : null;
  if (!kind) return null;
  const content = typeof obj.content === "string" ? obj.content.trim().slice(0, 1500) : "";
  if (!content) return null;
  const title = typeof obj.title === "string" && obj.title.trim()
    ? obj.title.trim().slice(0, 200)
    : "AI-প্রস্তাবিত খসড়া";
  const reason = typeof obj.reason === "string" ? obj.reason.trim().slice(0, 300) : "";
  return { kind, title, content, reason };
}

/** IN7a: the system label prefixing every AI handover-summary
 * note, so a system note is never mistaken for a human's note in
 * the timeline. */
export const HANDOVER_SUMMARY_LABEL = "🤖 AI হ্যান্ডওভার সারসংক্ষেপ (সিস্টেম নোট)";
