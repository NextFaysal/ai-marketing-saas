/**
 * IN7 — AI next-step helpers for the inbox UI (pure).
 *
 * The next-action endpoint is suggestion-only: it sends nothing
 * and writes nothing. These helpers turn a proposal into UI
 * decisions: which EXISTING path a click runs, what patch an
 * explicit Accept applies through updateConversation, and how a
 * handover-summary outcome is reported honestly (created / not
 * created — never dressed up).
 */

export type NextAction =
  | "share_tracking"
  | "cod_confirm"
  | "create_order"
  | "wait_customer"
  | "reply_manually"
  | "resolve";

export interface NextActionProposal {
  action: NextAction;
  label: string;
  reason: string;
  tags: string[];
  pipelineStage: string | null;
}

export interface NextActionResponse {
  proposal: NextActionProposal | null;
  provider: string | null;
  reason?: string;
}

export interface HandoverSummaryOutcome {
  attempted: boolean;
  created: boolean;
  reason?: string;
}

export const NEXT_ACTION_ICONS: Record<NextAction, string> = {
  share_tracking: "🚚",
  cod_confirm: "💵",
  create_order: "🧾",
  wait_customer: "⏳",
  reply_manually: "✍️",
  resolve: "✓",
};

/** wait_customer is informational — there is no button to run. */
export function isRunnableAction(action: NextAction): boolean {
  return action !== "wait_customer";
}

/**
 * The patch an explicit "গ্রহণ করুন" click applies through the
 * normal updateConversation (PATCH) path. Only fields the
 * proposal actually carries are included; tags merge with the
 * thread's current tags (never replace, never duplicate).
 * Returns null when there is nothing to accept.
 */
export function proposalAcceptPatch(
  proposal: NextActionProposal,
  currentTags: readonly string[],
): { tags?: string[]; pipelineStage?: string } | null {
  const patch: { tags?: string[]; pipelineStage?: string } = {};
  const newTags = (proposal.tags ?? []).filter((t) => t && !currentTags.includes(t));
  if (newTags.length) patch.tags = [...currentTags, ...newTags];
  if (proposal.pipelineStage) patch.pipelineStage = proposal.pipelineStage;
  return Object.keys(patch).length ? patch : null;
}

/** Honest one-line report of a handover-summary outcome, shown
 * after take-over / assign. null outcome (older responses, or no
 * handover happened) -> no line at all. */
export function handoverSummaryNotice(outcome: HandoverSummaryOutcome | null | undefined): string | null {
  if (!outcome) return null;
  if (outcome.created) return "🤖 AI হ্যান্ডওভার সারসংক্ষেপটি অভ্যন্তরীণ নোটে যোগ হয়েছে।";
  if (outcome.attempted) return "🤖 AI সারসংক্ষেপ তৈরি হয়নি — কারণসহ একটি সিস্টেম নোট যোগ হয়েছে।";
  return "🤖 AI সারসংক্ষেপ হয়নি (AI বন্ধ/সীমা) — হ্যান্ডওভার সম্পন্ন হয়েছে।";
}

/** IN7e: the body an accepted knowledge-kind draft proposal
 * sends to the EXISTING knowledge-documents endpoint. Nothing
 * is sent until a human clicks — this only shapes the payload. */
export function knowledgeBodyFromDraft(proposal: { title: string; content: string }): {
  title: string; content: string; kind: string;
} {
  return { title: proposal.title, content: proposal.content, kind: "faq" };
}
