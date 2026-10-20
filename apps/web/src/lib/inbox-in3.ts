import { inboxBn, inboxEn } from "./i18n/inbox";
import { interpolate } from "./i18n/lookup";

type Loc = "bn" | "en";
const D = (locale?: string) => (locale === "en" ? inboxEn : inboxBn);
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
  reply: inboxBn.macroReply,
  assign: inboxBn.macroAssign,
  tag: inboxBn.macroTag,
  pipeline: inboxBn.macroPipeline,
  close: inboxBn.macroClose,
  snooze: "😴 Snooze",
};
export const macroStepLabels = (locale?: string): Record<string, string> => {
  const dd = D(locale);
  return { reply: dd.macroReply, assign: dd.macroAssign, tag: dd.macroTag, pipeline: dd.macroPipeline, close: dd.macroClose, snooze: "😴 Snooze" };
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
  locale: Loc = "bn",
): string {
  const dd = D(locale);
  switch (step.type) {
    case "reply": {
      const title = lookups.quickReplyTitle?.(step.quickReplyId);
      return `${dd.macroReplyWord}${title ? `: “${title}”` : ""}`;
    }
    case "assign":
      if (step.assignedUserId === null) return dd.macroUnassign;
      if (step.assignedUserId === "me") return dd.macroAssignMe;
      return `${dd.macroAssignTo}: ${lookups.memberName?.(step.assignedUserId) ?? step.assignedUserId}`;
    case "tag":
      return `${dd.macroTagWord}: ${step.tag}`;
    case "pipeline":
      return `${dd.macroStageWord}: ${step.stage}`;
    case "close":
      return `${dd.macroClose}${step.outcome ? ` (${step.outcome})` : ""}`;
    case "snooze":
      return `😴 Snooze: ${step.minutes} ${dd.macroMinutes}`;
    default:
      return dd.macroStepWord;
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
export function formatMacroRunResult(r: MacroRunResult, locale: Loc = "bn"): string {
  const dd = D(locale);
  const macroWord = dd.macroWord;
  if (r.success) return `${macroWord} “${r.macroName}” ${interpolate(dd.macroDoneSuffix, { completed: r.completed, total: r.total })}`;
  const failed = r.steps.find((s) => !s.ok && !s.skipped);
  const skipped = r.steps.filter((s) => s.skipped).length;
  return `${macroWord} “${r.macroName}” ${interpolate(dd.macroStoppedSuffix, { completed: r.completed, total: r.total })}${failed ? `; ${dd.macroStepWord} ${failed.index + 1} (${macroStepLabels(locale)[failed.type] ?? failed.type}) ${dd.macroFailedWord}: ${failed.error ?? dd.macroUnknownError}` : ""}${skipped ? `; ${interpolate(dd.macroSkippedSuffix, { count: skipped })}` : ""}${locale === "en" ? "." : "।"}`;
}

/** Per-step lines for the result panel (✓ done / ✗ failed / ⏭ skipped). */
export function macroRunStepLines(r: MacroRunResult, locale: Loc = "bn"): string[] {
  const dd = D(locale);
  return r.steps.map((s) => {
    const label = macroStepLabels(locale)[s.type] ?? s.type;
    if (s.skipped) return `⏭ ${dd.macroStepWord} ${s.index + 1}: ${label} — ${dd.macroStepSkipped}`;
    if (s.ok) return `✓ ${dd.macroStepWord} ${s.index + 1}: ${label}`;
    return `✗ ${dd.macroStepWord} ${s.index + 1}: ${label} — ${s.error ?? dd.macroStepFailed}`;
  });
}

/** IN3c bulk-reply summary line (counts are the server's). */
export function bulkReplySummary(succeeded: number, failed: number, locale: Loc = "bn"): string {
  const dd = D(locale);
  return `${interpolate(dd.bulkReplyDone, { sent: succeeded })}${failed ? interpolate(dd.bulkReplyFailedPart, { failed }) : ""}${locale === "en" ? "." : "।"}`;
}
