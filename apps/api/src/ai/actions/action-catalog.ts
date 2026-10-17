/**
 * SA-B10 (Smart AI Phase 2, W1) — the Action Catalog.
 *
 * ONE typed list of everything the Smart AI may DO (not just say),
 * across the inbox and comment surfaces. Every entry names the
 * EXISTING staff service path its executor must call (plan law
 * L5: the AI acts only through real service paths, inside its
 * autonomy level, with the outcome verified from the actual
 * operation before success is claimed).
 *
 * Wiring discipline:
 *  - "b10"  — builder + executor + verifier are registered in
 *             ActionExecutorsService in this batch (the two
 *             reference actions: close_conversation,
 *             hide_comment).
 *  - "b11" / "b12" — the label names the batch that wires the
 *             entry: "b11" entries are wired as of SA-B11 (inbox
 *             set — assign / tag / reopen / mark-spam / block);
 *             "b12" entries are wired as of SA-B12 (comment set
 *             — unhide / reply / DM / delete). Any future entry
 *             whose wiring batch has not landed is refused by
 *             propose() with a typed "not_wired" result — never
 *             a fake run.
 *  - "never" — proposal-only by law (moneyAdjacent). The engine
 *             refuses to execute these at EVERY autonomy level;
 *             approval records the human decision and the act
 *             itself happens outside the engine (L5: the AI
 *             never moves money, executes refunds, or changes
 *             prices itself).
 *
 * Step-0 note (SA-B10 inventory): `set_conversation_priority`
 * from the draft list is NOT catalogued — conversation priority
 * has no staff-facing setter in this codebase (it is set only
 * by classification/escalation internals), so there is no real
 * service path to execute through. Recorded in the acceptance
 * doc rather than invented here.
 *
 * SA-B15 (Phase 3, A2) adds the "ads" surface below. Step-0
 * truth (docs/smart-ai-b15-acceptance.md): campaign lifecycle
 * (pause/resume) has a REAL hub path per platform — Meta via
 * CampaignsService (plan path + the account-scoped pair added
 * in B15), Google/TikTok via PublishingService's cross-platform
 * lifecycle — while a budget EDIT exists only for Meta plan ad
 * sets on this line (Google/TikTok edit is a platform gap, the
 * CA package is absent). Budget is money movement regardless,
 * so set_campaign_budget is proposal-only by law even where an
 * edit path exists. Namespace note: the ids "pause_campaign" /
 * "resume_campaign" intentionally match the Milestone-47
 * proposal TYPE strings — same acts, different rails. Engine
 * rows always carry actionId (M47 rows never do), and each
 * flow's lookups filter on exactly that (SA-B10's EXTEND
 * decision), so the shared names never cross-resolve.
 */

export type ActionSurface = "inbox" | "comment" | "ads";
export type ActionRiskClass = "low" | "medium" | "high";
export type ActionWiring = "b10" | "b11" | "b12" | "b15" | "never";

export interface CatalogAction {
  id: string;
  surface: ActionSurface;
  title: { bn: string; en: string };
  riskClass: ActionRiskClass;
  /** Money-adjacent entries are proposal-only forever (L5 wall). */
  moneyAdjacent: boolean;
  /** Registry keys in ActionExecutorsService; null for proposal-only. */
  executorKey: string | null;
  verifierKey: string | null;
  /** Human description of the payload contract (validated for real
   *  by the per-action builder in ActionExecutorsService). */
  payloadSummary: string;
  /** Whether the act can be undone through another catalog/service path. */
  undoable: boolean;
  wiring: ActionWiring;
}

export const ACTION_CATALOG: CatalogAction[] = [
  // ---------------- inbox ----------------
  {
    id: "assign_conversation",
    surface: "inbox",
    title: { bn: "কথোপকথন অ্যাসাইন", en: "Assign conversation" },
    riskClass: "low",
    moneyAdjacent: false,
    executorKey: "inbox.assign_conversation",
    verifierKey: "inbox.assign_conversation.verify",
    payloadSummary: "{ conversationId, assignedUserId | null } — InboxService.updateConversation",
    undoable: true,
    wiring: "b11",
  },
  {
    id: "tag_conversation",
    surface: "inbox",
    title: { bn: "কথোপকথনে ট্যাগ যোগ", en: "Tag conversation" },
    riskClass: "low",
    moneyAdjacent: false,
    executorKey: "inbox.tag_conversation",
    verifierKey: "inbox.tag_conversation.verify",
    payloadSummary: "{ conversationId, addTags: string[] } — merged into the current tag set via InboxService.updateConversation",
    undoable: true,
    wiring: "b11",
  },
  {
    id: "close_conversation",
    surface: "inbox",
    title: { bn: "কথোপকথন বন্ধ করা", en: "Close conversation" },
    riskClass: "low",
    moneyAdjacent: false,
    executorKey: "inbox.close_conversation",
    verifierKey: "inbox.close_conversation.verify",
    payloadSummary: "{ conversationId } — InboxService.updateConversation({ status: \"closed\" })",
    undoable: true, // reopen_conversation
    wiring: "b10",
  },
  {
    id: "reopen_conversation",
    surface: "inbox",
    title: { bn: "কথোপকথন আবার খোলা", en: "Reopen conversation" },
    riskClass: "low",
    moneyAdjacent: false,
    executorKey: "inbox.reopen_conversation",
    verifierKey: "inbox.reopen_conversation.verify",
    payloadSummary: "{ conversationId } — InboxService.updateConversation({ status: \"open\" })",
    undoable: true,
    wiring: "b11",
  },
  {
    id: "mark_conversation_spam",
    surface: "inbox",
    title: { bn: "স্প্যাম হিসেবে চিহ্নিত", en: "Mark conversation as spam" },
    riskClass: "medium",
    moneyAdjacent: false,
    executorKey: "inbox.mark_conversation_spam",
    verifierKey: "inbox.mark_conversation_spam.verify",
    payloadSummary: "{ conversationId } — InboxService.updateConversation({ spamFlag: true })",
    undoable: true,
    wiring: "b11",
  },
  {
    id: "block_sender",
    surface: "inbox",
    title: { bn: "প্রেরককে ব্লক করা", en: "Block sender" },
    riskClass: "medium",
    moneyAdjacent: false,
    executorKey: "inbox.block_sender",
    verifierKey: "inbox.block_sender.verify",
    payloadSummary: "{ conversationId, reason? } — InboxService.setConversationBlocked({ blocked: true })",
    undoable: true,
    wiring: "b11",
  },
  {
    id: "request_refund",
    surface: "inbox",
    title: { bn: "রিফান্ডের অনুরোধ (প্রস্তাব মাত্র)", en: "Request a refund (proposal only)" },
    riskClass: "high",
    moneyAdjacent: true,
    executorKey: null,
    verifierKey: null,
    payloadSummary: "{ conversationId, orderId?, reason } — PROPOSAL ONLY: approval records the decision; the refund itself is executed by a human through the existing staff refund-request path, never by the engine (L5)",
    undoable: false,
    wiring: "never",
  },
  // ---------------- comment ----------------
  {
    id: "hide_comment",
    surface: "comment",
    title: { bn: "কমেন্ট লুকানো", en: "Hide comment" },
    riskClass: "low",
    moneyAdjacent: false,
    executorKey: "comment.hide_comment",
    verifierKey: "comment.hide_comment.verify",
    payloadSummary: "{ commentId } — SocialCommentsService.updateCommentStatus(HIDDEN), Graph-first",
    undoable: true, // unhide_comment
    wiring: "b10",
  },
  {
    id: "unhide_comment",
    surface: "comment",
    title: { bn: "কমেন্ট আবার দেখানো", en: "Unhide comment" },
    riskClass: "low",
    moneyAdjacent: false,
    executorKey: "comment.unhide_comment",
    verifierKey: "comment.unhide_comment.verify",
    payloadSummary: "{ commentId } — SocialCommentsService.updateCommentStatus(PENDING), Graph-first",
    undoable: true,
    wiring: "b12",
  },
  {
    id: "reply_to_comment",
    surface: "comment",
    title: { bn: "কমেন্টের উত্তর দেওয়া", en: "Reply to comment" },
    riskClass: "medium",
    moneyAdjacent: false,
    executorKey: "comment.reply_to_comment",
    verifierKey: "comment.reply_to_comment.verify",
    payloadSummary: "{ commentId, replyText } — SocialCommentsService.sendReply (the SA-B8 grounded compose is the AI's text source in B12)",
    undoable: false,
    wiring: "b12",
  },
  {
    id: "send_dm_to_commenter",
    surface: "comment",
    title: { bn: "কমেন্টকারীকে DM পাঠানো", en: "Send DM to commenter" },
    riskClass: "medium",
    moneyAdjacent: false,
    executorKey: "comment.send_dm_to_commenter",
    verifierKey: "comment.send_dm_to_commenter.verify",
    payloadSummary: "{ commentId, message } — SocialCommentsService.sendPrivateReply (one private reply per comment, Meta rule)",
    undoable: false,
    wiring: "b12",
  },
  {
    id: "delete_comment",
    surface: "comment",
    title: { bn: "কমেন্ট মুছে ফেলা", en: "Delete comment" },
    riskClass: "high",
    moneyAdjacent: false,
    executorKey: "comment.delete_comment",
    verifierKey: "comment.delete_comment.verify",
    payloadSummary: "{ commentId } — SocialCommentsService.deleteComment (platform delete; irreversible)",
    undoable: false,
    wiring: "b12",
  },
  // ---------------- ads (SA-B15) ----------------
  {
    id: "pause_campaign",
    surface: "ads",
    title: { bn: "বিজ্ঞাপন ক্যাম্পেইন বন্ধ (pause) করা", en: "Pause ad campaign" },
    riskClass: "medium",
    moneyAdjacent: false,
    executorKey: "ads.pause_campaign",
    verifierKey: "ads.pause_campaign.verify",
    payloadSummary: "{ platform, campaignExternalId, adAccountId? } — the hub's own lifecycle path per platform/route: Meta plan → CampaignsService.setMetaStatus; Meta synced campaign → CampaignsService.setMetaCampaignStatusByAccount; Google/TikTok → PublishingService.crossPlatformSetCampaignStatus (plan-created drafts ride CampaignsService.setCrossPlatformDraftLifecycle). Stops spend indirectly but moves no money and is reversible — hence medium, not money-adjacent.",
    undoable: true, // resume_campaign
    wiring: "b15",
  },
  {
    id: "resume_campaign",
    surface: "ads",
    title: { bn: "বিজ্ঞাপন ক্যাম্পেইন আবার চালু (resume) করা", en: "Resume ad campaign" },
    riskClass: "medium",
    moneyAdjacent: false,
    executorKey: "ads.resume_campaign",
    verifierKey: "ads.resume_campaign.verify",
    payloadSummary: "{ platform, campaignExternalId, adAccountId? } — same hub lifecycle paths as pause_campaign, target ACTIVE; activation carries the hub's CC27 account-access gate inside the service path, exactly as the dashboard's resume does.",
    undoable: true, // pause_campaign
    wiring: "b15",
  },
  {
    id: "set_campaign_budget",
    surface: "ads",
    title: { bn: "ক্যাম্পেইন বাজেট বদল (প্রস্তাব মাত্র)", en: "Change campaign budget (proposal only)" },
    riskClass: "high",
    moneyAdjacent: true,
    executorKey: null,
    verifierKey: null,
    payloadSummary: "{ platform, campaignExternalId, adAccountId?, requestedBudgetMinor, budgetKind? } — PROPOSAL ONLY: a budget change is money movement (L5), so approval records the decision and a human performs it in the ads manager/hub — never the engine, at any autonomy level, regardless of whether a platform edit path exists. The preview states the current budget from the hub's own record where one exists (Meta plan budgets); targets with no readable current budget are refused by the builder rather than dressed up.",
    undoable: false,
    wiring: "never",
  },
];

export function catalogAction(actionId: string): CatalogAction | null {
  return ACTION_CATALOG.find((a) => a.id === actionId) ?? null;
}

/** Autonomy levels (plan D5): 0 off · 1 propose (default) · 2 limited auto (low-risk only). Level 3 exists in the plan as catalog-only and is never enableable in this build. */
export const AUTONOMY_LEVELS = [0, 1, 2] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];
export const DEFAULT_AUTONOMY_LEVEL: AutonomyLevel = 1;
