/**
 * SA-B13 (Smart AI Phase 2, W4): pure display helpers for the
 * tenant AI Control Center (Organization Settings → "🤖 AI
 * নিয়ন্ত্রণ"). Everything here is a deterministic mapping
 * from the Action Engine's API vocabulary (SA-B10 catalog /
 * autonomy / proposals) to plain Bengali labels — no data is
 * invented; unknown values fall back to the raw value so a new
 * state can never be silently hidden. Counts are computed
 * from the proposals list the API actually returned (its
 * window is the latest 50) and are labelled as such in the UI.
 */

import { fmtDateTime, fmtNumber } from "@repo/contracts";
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

// Roles mirror the ActionEngineController discipline exactly:
// decisions (approve/reject) OWNER/ADMIN/MARKETING_MANAGER;
// autonomy settings OWNER/ADMIN.
export const CONTROL_DECIDE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"];
export const CONTROL_SETTINGS_ROLES = ["OWNER", "ADMIN"];

export function canDecideControl(role: string | null | undefined): boolean {
  return !!role && CONTROL_DECIDE_ROLES.includes(role);
}

export function canSetControlAutonomy(role: string | null | undefined): boolean {
  return !!role && CONTROL_SETTINGS_ROLES.includes(role);
}

export interface CatalogAction {
  id: string;
  surface: string;
  title: { bn: string; en: string };
  riskClass: string;
  moneyAdjacent: boolean;
  executorKey: string | null;
  verifierKey: string | null;
  payloadSummary: string;
  undoable: boolean;
  wiring: string;
}

export interface AutonomyRow {
  actionId: string;
  surface: string;
  title: { bn: string; en: string };
  riskClass: string;
  moneyAdjacent: boolean;
  undoable: boolean;
  wiring: string;
  level: number;
  levelIsDefault: boolean;
  updatedById: string | null;
  updatedAt: string | null;
}

export interface ActionProposal {
  id: string;
  actionId: string | null;
  surface: string | null;
  proposedBy: string | null;
  autonomyLevel: number | null;
  conversationId: string | null;
  title: string;
  preview: string;
  status: string;
  decidedById: string | null;
  decidedAt: string | null;
  executedAt: string | null;
  result: { outcome?: string; note?: string } | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export function surfaceLabel(surface: string | null | undefined, locale: UiLocale = "bn"): string {
  switch (surface) {
    case "inbox": return L(locale, "ctrlSurfaceInbox");
    case "comment": return L(locale, "ctrlSurfaceComment");
    default: return surface ?? "";
  }
}

export function riskLabel(riskClass: string, locale: UiLocale = "bn"): string {
  switch (riskClass) {
    case "low": return L(locale, "ctrlRiskLow");
    case "medium": return L(locale, "ctrlRiskMedium");
    case "high": return L(locale, "ctrlRiskHigh");
    default: return riskClass;
  }
}

export function proposedByLabel(proposedBy: string | null | undefined, locale: UiLocale = "bn"): string {
  switch (proposedBy) {
    case "ai": return L(locale, "ctrlProposedByAi");
    case "staff": return L(locale, "ctrlProposedByStaff");
    default: return proposedBy ?? "";
  }
}

export function proposalStatusLabel(status: string, locale: UiLocale = "bn"): string {
  switch (status) {
    case "proposed": return L(locale, "ctrlStatusProposed");
    case "approved": return L(locale, "ctrlStatusApproved");
    case "executing": return L(locale, "ctrlStatusExecuting");
    case "executed": return L(locale, "ctrlStatusExecuted");
    case "failed": return L(locale, "ctrlStatusFailed");
    case "rejected": return L(locale, "ctrlStatusRejected");
    default: return status;
  }
}

/** The decision levels a human may pick in the matrix. Level 3
 * exists in the plan (D5) but is NOT storable in this build —
 * the UI renders it as a disabled option with its reason. */
export const AUTONOMY_OPTIONS: { level: number; label: string; labelEn: string }[] = [
  { level: 0, label: aiBn.ctrlAutonomyOff, labelEn: aiEn.ctrlAutonomyOff },
  { level: 1, label: aiBn.ctrlAutonomyPropose, labelEn: aiEn.ctrlAutonomyPropose },
  { level: 2, label: aiBn.ctrlAutonomyLimited, labelEn: aiEn.ctrlAutonomyLimited },
];

export function autonomyLevelLabel(level: number, locale: UiLocale = "bn"): string {
  const found = AUTONOMY_OPTIONS.find((o) => o.level === level);
  if (found) return locale === "en" ? found.labelEn : found.label;
  if (level === 3) return L(locale, "ctrlAutonomySupervised");
  return L(locale, "ctrlAutonomyLevelFallback", { level });
}

/** A money-adjacent proposal that was approved: the decision is
 * recorded, but the engine never executes it (L5) — the row
 * stays "approved" with result.outcome "proposal_only". */
export function isProposalOnly(p: Pick<ActionProposal, "status" | "result">): boolean {
  return p.status === "approved" && p.result?.outcome === "proposal_only";
}

/** What actually happened to a decided proposal, in plain
 * language. A failure shows the recorded reason verbatim —
 * never dressed up, never hidden. */
export function proposalOutcomeText(p: Pick<ActionProposal, "status" | "result" | "error">, locale: UiLocale = "bn"): string {
  if (p.status === "executed") return L(locale, "ctrlOutcomeExecuted");
  if (p.status === "failed") return L(locale, "ctrlOutcomeFailed", { error: p.error ?? L(locale, "ctrlOutcomeUnknownError") });
  if (isProposalOnly(p)) return L(locale, "ctrlOutcomeProposalOnly");
  if (p.status === "approved") return L(locale, "ctrlOutcomeApproved");
  if (p.status === "rejected") return L(locale, "ctrlOutcomeRejected");
  if (p.status === "executing") return L(locale, "ctrlOutcomeExecuting");
  if (p.status === "proposed") return L(locale, "ctrlOutcomeProposed");
  return proposalStatusLabel(p.status, locale);
}

/** Relative age of a proposal ("এইমাত্র / ৫ মিনিট আগে / …").
 * `now` is a parameter so the mapping is deterministic in tests. */
export function ageText(iso: string | null | undefined, now: Date = new Date(), locale: UiLocale = "bn"): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diffMs = Math.max(0, now.getTime() - t);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return L(locale, "ctrlAgeJustNow");
  if (minutes < 60) return L(locale, "ctrlAgeMinutes", { count: fmtNumber(locale, minutes) });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return L(locale, "ctrlAgeHours", { count: fmtNumber(locale, hours) });
  const days = Math.floor(hours / 24);
  return L(locale, "ctrlAgeDays", { count: fmtNumber(locale, days) });
}

export function formatDateTime(value: string | null | undefined, locale: UiLocale = "bn"): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return fmtDateTime(locale, d);
}

/* ------------------------------------------------------------------ */
/* SA-B25 (T4): the unified AI Activity feed + usage overview          */
/* (Item 1's AiActivityService). Same honesty rules as above: every    */
/* label is a deterministic mapping of the API's vocabulary, and an   */
/* unknown value falls back to the raw value — never hidden.          */
/* ------------------------------------------------------------------ */

export interface ActivityEvent {
  id: string;
  kind: string;
  event: string;
  at: string;
  title: string;
  detail: string | null;
  sourceId: string;
  meta: {
    actionId?: string | null;
    surface?: string | null;
    proposedBy?: string | null;
    status?: string;
    via?: string | null;
    decision?: string;
    proposalOnly?: boolean;
    decidedById?: string | null;
    itemKind?: string;
    sourceType?: string;
    reviewedVia?: string | null;
    appliedRef?: string | null;
    channel?: string;
    origin?: string;
    hitCount?: number;
    autoDraftRef?: string | null;
    [key: string]: unknown;
  };
}

export interface ActivityFeed {
  items: ActivityEvent[];
  total: number;
  limit: number;
  offset: number;
  days: number;
  kind: string | null;
}

export interface AiUsageFeatureRow {
  feature: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCalls: number;
}

export interface AiUsageDailyRow {
  date: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AiUsageOverview {
  days: number;
  since: string;
  totals: { calls: number; inputTokens: number; outputTokens: number; estimatedCalls: number };
  features: AiUsageFeatureRow[];
  daily: AiUsageDailyRow[];
}

export function activityKindLabel(kind: string, locale: UiLocale = "bn"): string {
  switch (kind) {
    case "proposal": return L(locale, "ctrlKindProposal");
    case "learned": return L(locale, "ctrlKindLearned");
    case "answer": return L(locale, "ctrlKindAnswer");
    case "content": return L(locale, "ctrlKindContent");
    default: return kind;
  }
}

/** LearnedItem sourceType vocabulary — mirrors ai-learning.ts's
 * learnedSourceLabel and extends it with the SA-B14/B16/B17
 * sources (ads / creative / competitor) in the same wording. */
export function activityLearnedSourceLabel(sourceType: string, locale: UiLocale = "bn"): string {
  switch (sourceType) {
    case "conversation": return L(locale, "learnSourceConversation");
    case "unanswered": return L(locale, "learnSourceUnanswered");
    case "website": return L(locale, "learnSourceWebsite");
    case "product": return L(locale, "learnSourceProduct");
    case "performance": return L(locale, "learnSourcePerformance");
    case "ads": return L(locale, "ctrlLearnedSourceAds");
    case "creative": return L(locale, "ctrlLearnedSourceCreative");
    case "competitor": return L(locale, "ctrlLearnedSourceCompetitor");
    default: return sourceType;
  }
}

/** The short source chip for a feed row: where this event came
 * from, in the vocabulary of its own kind. */
export function activitySourceLabel(ev: Pick<ActivityEvent, "kind" | "meta">, locale: UiLocale = "bn"): string {
  const meta = ev.meta ?? {};
  switch (ev.kind) {
    case "learned":
      return meta.sourceType ? activityLearnedSourceLabel(String(meta.sourceType), locale) : "";
    case "proposal":
      if (meta.via === "copilot") return "Copilot";
      return surfaceLabel((meta.surface as string | null | undefined) ?? null, locale);
    case "answer":
      return meta.channel ? surfaceLabel(String(meta.channel), locale) : "";
    case "content":
      return L(locale, "ctrlContentSource");
    default:
      return "";
  }
}

/** One plain-Bengali sentence for a feed event. A decided
 * proposal whose decision is unknown, and any unknown
 * (kind, event) pair, falls back to the raw event string. */
export function activityEventText(ev: Pick<ActivityEvent, "kind" | "event" | "meta">, locale: UiLocale = "bn"): string {
  const meta = ev.meta ?? {};
  if (ev.kind === "proposal") {
    switch (ev.event) {
      case "filed": return L(locale, "ctrlEventProposalFiled");
      case "decided":
        if (meta.decision === "approved") {
          return meta.proposalOnly
            ? L(locale, "ctrlEventProposalApprovedProposalOnly")
            : L(locale, "ctrlEventProposalApproved");
        }
        if (meta.decision === "rejected") return L(locale, "ctrlEventProposalRejected");
        return ev.event;
      case "executed": return L(locale, "ctrlEventProposalExecuted");
      case "failed": return L(locale, "ctrlEventProposalFailed");
      default: return ev.event;
    }
  }
  if (ev.kind === "learned") {
    switch (ev.event) {
      case "suggested": return L(locale, "ctrlEventLearnedSuggested");
      case "decided":
        if (meta.decision === "approved") return L(locale, "ctrlEventLearnedApproved");
        if (meta.decision === "rejected") return L(locale, "ctrlEventLearnedRejected");
        return ev.event;
      default: return ev.event;
    }
  }
  if (ev.kind === "answer") {
    switch (ev.event) {
      case "captured": return L(locale, "ctrlEventAnswerCaptured");
      case "invalidated": return L(locale, "ctrlEventAnswerInvalidated");
      default: return ev.event;
    }
  }
  if (ev.kind === "content") {
    switch (ev.event) {
      case "draft_created": return L(locale, "ctrlEventContentDraft");
      default: return ev.event;
    }
  }
  return ev.event;
}

/** A learned decision made by a platform admin (SA-B23's admin
 * console) must be VISIBLE to the org as such — never passed
 * off as a staff decision. Pre-SA-B23 rows carry reviewedVia
 * null, and null is not admin_console. */
export function isAdminConsoleDecision(ev: Pick<ActivityEvent, "kind" | "event" | "meta">): boolean {
  return ev.kind === "learned" && ev.event === "decided" && ev.meta?.reviewedVia === "admin_console";
}

export const ADMIN_CONSOLE_DECISION_LABEL = aiBn.ctrlAdminConsoleLabel;
export const ADMIN_CONSOLE_DECISION_LABEL_EN = aiEn.ctrlAdminConsoleLabel;
/** Locale-aware accessor for ADMIN_CONSOLE_DECISION_LABEL. */
export function adminConsoleDecisionLabel(locale: UiLocale = "bn"): string {
  return L(locale, "ctrlAdminConsoleLabel");
}

/** AIUsageRecord feature buckets that actually exist in the API
 * tree (chat / report / copilot are the long-standing buckets;
 * content_generation is social/content-generation.service.ts's
 * CONTENT_GENERATION_FEATURE; broadcast_personalization is
 * messaging/broadcast-personalization.service.ts's
 * BROADCAST_PERSONALIZATION_FEATURE; autopilot is the inbox
 * grounded-reply bucket and comment_autopilot its comment twin).
 * Anything unmapped falls back to the raw feature string. */
export function usageFeatureLabel(feature: string, locale: UiLocale = "bn"): string {
  switch (feature) {
    case "chat": return L(locale, "ctrlUsageChat");
    case "report": return L(locale, "ctrlUsageReport");
    case "copilot": return L(locale, "ctrlUsageCopilot");
    case "content_generation": return L(locale, "ctrlUsageContentGeneration");
    case "broadcast_personalization": return L(locale, "ctrlUsageBroadcastPersonalization");
    case "autopilot": return L(locale, "ctrlUsageAutopilot");
    case "comment_autopilot": return L(locale, "ctrlUsageCommentAutopilot");
    default: return feature;
  }
}

/** Query string for the activity feed endpoint — shared by the
 * section and its tests so the paging contract is one place.
 * `kind` is omitted for the "সব" filter (null / "" / "all"). */
export function activityQuery(opts: { kind?: string | null; days?: number; limit?: number; offset?: number }): string {
  const params: string[] = [];
  if (opts.kind && opts.kind !== "all") params.push(`kind=${encodeURIComponent(opts.kind)}`);
  if (opts.days !== undefined) params.push(`days=${opts.days}`);
  if (opts.limit !== undefined) params.push(`limit=${opts.limit}`);
  if (opts.offset !== undefined) params.push(`offset=${opts.offset}`);
  return params.length ? `?${params.join("&")}` : "";
}

/** Outcome counts over the proposals list that was actually
 * fetched (the API's window is the latest 50) — the UI labels
 * them with that window, never as all-time totals. */
export function activitySummary(proposals: Pick<ActionProposal, "status">[]): { pending: number; executed: number; failed: number; rejected: number; decided: number } {
  const pending = proposals.filter((p) => p.status === "proposed").length;
  const executed = proposals.filter((p) => p.status === "executed").length;
  const failed = proposals.filter((p) => p.status === "failed").length;
  const rejected = proposals.filter((p) => p.status === "rejected").length;
  return { pending, executed, failed, rejected, decided: proposals.length - pending };
}
