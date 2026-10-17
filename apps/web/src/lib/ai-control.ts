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

export function surfaceLabel(surface: string | null | undefined): string {
  switch (surface) {
    case "inbox": return "ইনবক্স";
    case "comment": return "কমেন্ট";
    default: return surface ?? "";
  }
}

export function riskLabel(riskClass: string): string {
  switch (riskClass) {
    case "low": return "কম ঝুঁকি";
    case "medium": return "মাঝারি ঝুঁকি";
    case "high": return "বেশি ঝুঁকি";
    default: return riskClass;
  }
}

export function proposedByLabel(proposedBy: string | null | undefined): string {
  switch (proposedBy) {
    case "ai": return "AI-এর প্রস্তাব";
    case "staff": return "টিমের প্রস্তাব";
    default: return proposedBy ?? "";
  }
}

export function proposalStatusLabel(status: string): string {
  switch (status) {
    case "proposed": return "সিদ্ধান্তের অপেক্ষায়";
    case "approved": return "অনুমোদিত";
    case "executing": return "কার্যকর হচ্ছে";
    case "executed": return "কার্যকর হয়েছে";
    case "failed": return "ব্যর্থ হয়েছে";
    case "rejected": return "বাতিল করা হয়েছে";
    default: return status;
  }
}

/** The decision levels a human may pick in the matrix. Level 3
 * exists in the plan (D5) but is NOT storable in this build —
 * the UI renders it as a disabled option with its reason. */
export const AUTONOMY_OPTIONS: { level: number; label: string }[] = [
  { level: 0, label: "বন্ধ" },
  { level: 1, label: "প্রস্তাব — মানুষ অনুমোদন দেবে" },
  { level: 2, label: "সীমিত নিজে — শুধু কম ঝুঁকির কাজ" },
];

export function autonomyLevelLabel(level: number): string {
  const found = AUTONOMY_OPTIONS.find((o) => o.level === level);
  if (found) return found.label;
  if (level === 3) return "তত্ত্বাবধানে নিজে";
  return `স্তর ${level}`;
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
export function proposalOutcomeText(p: Pick<ActionProposal, "status" | "result" | "error">): string {
  if (p.status === "executed") return "কার্যকর হয়েছে — কাজটি আসল পথে করা হয়েছে এবং ফলাফল যাচাই করে নিশ্চিত করা হয়েছে।";
  if (p.status === "failed") return `কার্যকর করা যায়নি — কারণ: ${p.error ?? "অজানা কারণ"}`;
  if (isProposalOnly(p)) return "অনুমোদন রেকর্ড হয়েছে — তবে এটি টাকা-সংক্রান্ত কাজ: AI নিজে এটি কার্যকর করে না (কখনোই করে না)। টিমকে প্রচলিত পথে নিজে করতে হবে।";
  if (p.status === "approved") return "অনুমোদিত হয়েছে।";
  if (p.status === "rejected") return "প্রস্তাবটি বাতিল করা হয়েছে — কিছুই করা হয়নি।";
  if (p.status === "executing") return "কার্যকর করা হচ্ছে…";
  if (p.status === "proposed") return "আপনার সিদ্ধান্তের অপেক্ষায় আছে।";
  return proposalStatusLabel(p.status);
}

const bnNum = (n: number) => n.toLocaleString("bn-BD");

/** Relative age of a proposal ("এইমাত্র / ৫ মিনিট আগে / …").
 * `now` is a parameter so the mapping is deterministic in tests. */
export function ageText(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diffMs = Math.max(0, now.getTime() - t);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "এইমাত্র";
  if (minutes < 60) return `${bnNum(minutes)} মিনিট আগে`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${bnNum(hours)} ঘণ্টা আগে`;
  const days = Math.floor(hours / 24);
  return `${bnNum(days)} দিন আগে`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("bn-BD", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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

export function activityKindLabel(kind: string): string {
  switch (kind) {
    case "proposal": return "কাজের প্রস্তাব";
    case "learned": return "শেখা";
    case "answer": return "উত্তর ভান্ডার";
    case "content": return "কনটেন্ট";
    default: return kind;
  }
}

/** LearnedItem sourceType vocabulary — mirrors ai-learning.ts's
 * learnedSourceLabel and extends it with the SA-B14/B16/B17
 * sources (ads / creative / competitor) in the same wording. */
export function activityLearnedSourceLabel(sourceType: string): string {
  switch (sourceType) {
    case "conversation": return "কথোপকথন থেকে শেখা";
    case "unanswered": return "উত্তর-না-পাওয়া প্রশ্ন থেকে";
    case "website": return "ওয়েবসাইট থেকে";
    case "product": return "পণ্য থেকে";
    case "performance": return "পারফরম্যান্স থেকে";
    case "ads": return "বিজ্ঞাপন থেকে";
    case "creative": return "ক্রিয়েটিভ থেকে";
    case "competitor": return "প্রতিযোগী থেকে";
    default: return sourceType;
  }
}

/** The short source chip for a feed row: where this event came
 * from, in the vocabulary of its own kind. */
export function activitySourceLabel(ev: Pick<ActivityEvent, "kind" | "meta">): string {
  const meta = ev.meta ?? {};
  switch (ev.kind) {
    case "learned":
      return meta.sourceType ? activityLearnedSourceLabel(String(meta.sourceType)) : "";
    case "proposal":
      if (meta.via === "copilot") return "Copilot";
      return surfaceLabel((meta.surface as string | null | undefined) ?? null);
    case "answer":
      return meta.channel ? surfaceLabel(String(meta.channel)) : "";
    case "content":
      return "AI কনটেন্ট";
    default:
      return "";
  }
}

/** One plain-Bengali sentence for a feed event. A decided
 * proposal whose decision is unknown, and any unknown
 * (kind, event) pair, falls back to the raw event string. */
export function activityEventText(ev: Pick<ActivityEvent, "kind" | "event" | "meta">): string {
  const meta = ev.meta ?? {};
  if (ev.kind === "proposal") {
    switch (ev.event) {
      case "filed": return "নতুন প্রস্তাব এসেছে";
      case "decided":
        if (meta.decision === "approved") {
          return meta.proposalOnly
            ? "অনুমোদন রেকর্ড হয়েছে — টাকা-সংক্রান্ত কাজ, AI নিজে কার্যকর করেনি"
            : "অনুমোদন দেওয়া হয়েছে";
        }
        if (meta.decision === "rejected") return "বাতিল করা হয়েছে";
        return ev.event;
      case "executed": return "কার্যকর হয়েছে (যাচাইকৃত)";
      case "failed": return "কার্যকর করা যায়নি";
      default: return ev.event;
    }
  }
  if (ev.kind === "learned") {
    switch (ev.event) {
      case "suggested": return "নতুন শেখার প্রস্তাব এসেছে";
      case "decided":
        if (meta.decision === "approved") return "শেখা অনুমোদিত হয়েছে";
        if (meta.decision === "rejected") return "শেখার প্রস্তাব বাতিল হয়েছে";
        return ev.event;
      default: return ev.event;
    }
  }
  if (ev.kind === "answer") {
    switch (ev.event) {
      case "captured": return "নতুন যাচাইকৃত উত্তর জমা হয়েছে";
      case "invalidated": return "সংরক্ষিত উত্তর বাতিল হয়েছে (তথ্য বদলে গেছে)";
      default: return ev.event;
    }
  }
  if (ev.kind === "content") {
    switch (ev.event) {
      case "draft_created": return "AI কনটেন্টের খসড়া তৈরি হয়েছে";
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

export const ADMIN_CONSOLE_DECISION_LABEL = "প্ল্যাটফর্ম অ্যাডমিনের সিদ্ধান্ত";

/** AIUsageRecord feature buckets that actually exist in the API
 * tree (chat / report / copilot are the long-standing buckets;
 * content_generation is social/content-generation.service.ts's
 * CONTENT_GENERATION_FEATURE; broadcast_personalization is
 * messaging/broadcast-personalization.service.ts's
 * BROADCAST_PERSONALIZATION_FEATURE; autopilot is the inbox
 * grounded-reply bucket and comment_autopilot its comment twin).
 * Anything unmapped falls back to the raw feature string. */
export function usageFeatureLabel(feature: string): string {
  switch (feature) {
    case "chat": return "চ্যাট";
    case "report": return "রিপোর্ট";
    case "copilot": return "কোপাইলট";
    case "content_generation": return "কনটেন্ট তৈরি";
    case "broadcast_personalization": return "ব্রডকাস্ট সাজানো";
    case "autopilot": return "ইনবক্স অটোপাইলট";
    case "comment_autopilot": return "কমেন্ট অটোপাইলট";
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
