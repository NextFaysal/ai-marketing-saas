/**
 * IN3: pure helpers for inbox macros + bulk reply in the inbox
 * page. A macro step mirrors the API's sanitizeMacroSteps
 * vocabulary exactly — the builder only produces shapes the
 * server accepts, and summaries describe what a run WILL do
 * (the server result remains the only truth about what it DID).
 * No fetching, no state — unit-tested.
 */

export type MacroStep =
  | { type: "reply"; quickReplyId: string }
  | { type: "assign"; assignedUserId: string | null }
  | { type: "tag"; tag: string }
  | { type: "pipeline"; stage: string }
  | { type: "close"; outcome?: string | null }
  | { type: "snooze"; minutes: number };

export const MACRO_STEP_LABELS: Record<string, string> = {
  reply: "💬 Quick Reply পাঠান",
  assign: "👤 অ্যাসাইন",
  tag: "🏷️ ট্যাগ যোগ",
  pipeline: "📊 Pipeline স্টেজ",
  close: "✅ বন্ধ করুন",
  snooze: "😴 Snooze",
};

export const PIPELINE_STAGES = ["new", "talking", "ordered", "delivered", "repeat"] as const;
export const CONVERSATION_OUTCOMES = [
  "sale", "no_sale_price", "no_sale_stock", "no_sale_undecided",
  "support_resolved", "spam", "other",
] as const;

/** One human-readable line describing a step, resolving ids to
 * names through the caller's lookups when they are available
 * (a missing lookup falls back to the raw value — never an
 * invented name). */
export function macroStepSummary(
  step: MacroStep,
  lookups: { quickReplyTitle?: (id: string) => string | undefined; memberName?: (id: string) => string | undefined } = {},
): string {
  switch (step.type) {
    case "reply": {
      const title = lookups.quickReplyTitle?.(step.quickReplyId);
      return `💬 উত্তর${title ? `: “${title}”` : ""}`;
    }
    case "assign":
      if (step.assignedUserId === null) return "👤 অ্যাসাইন তুলে নিন";
      if (step.assignedUserId === "me") return "👤 অ্যাসাইন: নিজেকে";
      return `👤 অ্যাসাইন: ${lookups.memberName?.(step.assignedUserId) ?? step.assignedUserId}`;
    case "tag":
      return `🏷️ ট্যাগ: ${step.tag}`;
    case "pipeline":
      return `📊 স্টেজ: ${step.stage}`;
    case "close":
      return `✅ বন্ধ করুন${step.outcome ? ` (${step.outcome})` : ""}`;
    case "snooze":
      return `😴 Snooze: ${step.minutes} মিনিট`;
    default:
      return "ধাপ";
  }
}

export interface MacroRunStepResult { index: number; type: string; ok: boolean; skipped?: boolean; error?: string }
export interface MacroRunResult {
  macroId: string; macroName: string; conversationId: string;
  success: boolean; completed: number; total: number; steps: MacroRunStepResult[];
}

/** The honest one-paragraph report of a macro run: success only
 * when every step succeeded; a failure names the step and its
 * real error, and skipped steps are called skipped. */
export function formatMacroRunResult(r: MacroRunResult): string {
  if (r.success) return `ম্যাক্রো “${r.macroName}” সম্পন্ন — ${r.completed}/${r.total} ধাপ সফল।`;
  const failed = r.steps.find((s) => !s.ok && !s.skipped);
  const skipped = r.steps.filter((s) => s.skipped).length;
  return `ম্যাক্রো “${r.macroName}” থেমেছে — ${r.completed}/${r.total} ধাপ হয়েছে${failed ? `; ধাপ ${failed.index + 1} (${MACRO_STEP_LABELS[failed.type] ?? failed.type}) ব্যর্থ: ${failed.error ?? "অজানা ত্রুটি"}` : ""}${skipped ? `; বাকি ${skipped}টি ধাপ হয়নি` : ""}।`;
}

/** Per-step lines for the result panel (✓ done / ✗ failed / ⏭ skipped). */
export function macroRunStepLines(r: MacroRunResult): string[] {
  return r.steps.map((s) => {
    const label = MACRO_STEP_LABELS[s.type] ?? s.type;
    if (s.skipped) return `⏭ ধাপ ${s.index + 1}: ${label} — হয়নি (আগের ধাপে থেমেছে)`;
    if (s.ok) return `✓ ধাপ ${s.index + 1}: ${label}`;
    return `✗ ধাপ ${s.index + 1}: ${label} — ${s.error ?? "ব্যর্থ"}`;
  });
}

/** IN3c bulk-reply summary line (counts are the server's). */
export function bulkReplySummary(succeeded: number, failed: number): string {
  return `বাল্ক রিপ্লাই সম্পন্ন: পাঠানো হয়েছে ${succeeded}টি${failed ? `, পাঠানো যায়নি ${failed}টি` : ""}।`;
}
