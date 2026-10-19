import { localInputToUtcIso, utcToLocalInput } from "./social-calendar";
import { fmtNumber, type UiLocale } from "@repo/contracts";
import { tr } from "./i18n/lookup";
import { socialBn, socialEn } from "./i18n/social";

const SOCIAL_DICTS = { bn: socialBn, en: socialEn };
const L = (locale: UiLocale, key: string, params?: Record<string, string | number>) =>
  tr(SOCIAL_DICTS, locale, key, params) ?? key;


/**
 * SN3 — Content pipeline board + calendar drag: the PURE decision
 * layer. The board never invents a transition: every drop resolves
 * to one of the actions the list view already offers (submit for
 * approval / approve / schedule / publish now / cancel schedule),
 * and the SERVER stays the final judge — its gates (SP7 approval,
 * SU9 two-step, SN2 client approval) refuse with verbatim errors
 * that the board shows while the card stays where it was. This
 * module only decides WHICH existing endpoint an attempted move
 * maps to, or why a move has no existing path at all.
 */

export type BoardColumnId = "draft" | "pending" | "approved" | "scheduled" | "done";

export const BOARD_COLUMNS: { id: BoardColumnId; label: string; labelEn: string }[] = [
  { id: "draft", label: "Draft (খসড়া)", labelEn: "Draft" },
  { id: "pending", label: "অনুমোদনের অপেক্ষায়", labelEn: "Awaiting approval" },
  { id: "approved", label: "অনুমোদিত", labelEn: "Approved" },
  { id: "scheduled", label: "শিডিউল করা", labelEn: "Scheduled" },
  { id: "done", label: "Published / Failed", labelEn: "Published / Failed" },
];

export function boardColumnLabel(id: BoardColumnId, locale: UiLocale = "bn"): string {
  const col = BOARD_COLUMNS.find((c) => c.id === id);
  if (!col) return id;
  return locale === "en" ? col.labelEn : col.label;
}

export interface BoardPostLike {
  status: string;
  approvalStatus?: string | null;
}

/**
 * Which column a post renders in. Approval state only subdivides
 * drafts: a scheduled post already passed every gate, and the last
 * column groups the terminal outcomes (published / failed /
 * sent_to_creator / cancelled) with their own status pills.
 */
export function boardColumnForPost(post: BoardPostLike): BoardColumnId {
  if (post.status === "scheduled" || post.status === "publishing") return "scheduled";
  if (
    post.status === "published" ||
    post.status === "failed" ||
    post.status === "sent_to_creator" ||
    post.status === "cancelled"
  ) {
    return "done";
  }
  // status === "draft" (and anything unexpected falls back here).
  if (post.approvalStatus === "pending" || post.approvalStatus === "manager_approved") return "pending";
  if (post.approvalStatus === "approved") return "approved";
  return "draft";
}

export type BoardActionKind = "submit" | "approve" | "schedule" | "publish" | "cancel-schedule";

export type BoardDropResult =
  | { kind: BoardActionKind }
  | { kind: "noop" }
  | { kind: "invalid"; reason: string };

export const BOARD_ACTION_LABELS: Record<BoardActionKind, string> = {
  submit: "অনুমোদনের জন্য পাঠান",
  approve: "অনুমোদন করুন",
  schedule: "শিডিউল করুন…",
  publish: "এখনই প্রকাশ করুন",
  "cancel-schedule": "শিডিউল বাতিল করে Draft-এ ফেরত নিন",
};

const BOARD_ACTION_KEYS: Record<BoardActionKind, string> = {
  submit: "boardActSubmit",
  approve: "boardActApprove",
  schedule: "boardActSchedule",
  publish: "boardActPublish",
  "cancel-schedule": "boardActCancelSchedule",
};

export function boardActionLabel(kind: BoardActionKind, locale: UiLocale = "bn"): string {
  return locale === "en" ? L(locale, BOARD_ACTION_KEYS[kind]) : BOARD_ACTION_LABELS[kind];
}

/**
 * Resolve a board move (drag drop or move-menu pick) to the ONE
 * existing action it maps to. `requireApproval` mirrors the org's
 * SP7 setting as the page knows it; it only shapes local guidance
 * for moves that have no path — every real call still goes to the
 * server, whose gates decide.
 */
export function boardDropAction(
  post: BoardPostLike,
  target: BoardColumnId,
  opts: { requireApproval: boolean },
  locale: UiLocale = "bn",
): BoardDropResult {
  const from = boardColumnForPost(post);
  if (from === target) return { kind: "noop" };
  if (post.status === "publishing") {
    return { kind: "invalid", reason: L(locale, "boardReasonPublishing") };
  }

  switch (target) {
    case "pending": {
      // The only road into Pending is the existing submit action:
      // a draft in an org with the approval flow on, not yet (or
      // no longer, after a rejection) submitted.
      if (
        post.status === "draft" &&
        opts.requireApproval &&
        (post.approvalStatus == null || post.approvalStatus === "rejected")
      ) {
        return { kind: "submit" };
      }
      if (post.status === "draft" && !opts.requireApproval) {
        return { kind: "invalid", reason: L(locale, "boardReasonNoFlow") };
      }
      return { kind: "invalid", reason: L(locale, "boardReasonCannotSubmit") };
    }
    case "approved": {
      if (from === "pending") return { kind: "approve" };
      if (from === "draft") {
        return opts.requireApproval
          ? { kind: "invalid", reason: L(locale, "boardReasonSubmitFirst") }
          : { kind: "invalid", reason: L(locale, "boardReasonNoApprovedStep") };
      }
      return { kind: "invalid", reason: L(locale, "boardReasonCannotApprove") };
    }
    case "scheduled": {
      if (from === "draft" || from === "pending" || from === "approved") return { kind: "schedule" };
      if (from === "done" && post.status === "failed") return { kind: "schedule" };
      return { kind: "invalid", reason: L(locale, "boardReasonCannotReschedule") };
    }
    case "done": {
      // Dropping on Published / Failed means "publish now" — the
      // same button the list view offers drafts, scheduled posts
      // and failed posts (a retry).
      if (from === "draft" || from === "pending" || from === "approved" || from === "scheduled") {
        return { kind: "publish" };
      }
      if (post.status === "failed") return { kind: "publish" };
      if (post.status === "published") return { kind: "invalid", reason: L(locale, "boardReasonAlreadyPublished") };
      if (post.status === "sent_to_creator") {
        return { kind: "invalid", reason: L(locale, "boardReasonSentToCreator") };
      }
      return { kind: "invalid", reason: L(locale, "boardReasonCancelledPublish") };
    }
    case "draft": {
      // The only road back to Draft is cancelling a schedule.
      if (from === "scheduled") return { kind: "cancel-schedule" };
      if (from === "pending") {
        return { kind: "invalid", reason: L(locale, "boardReasonRejectNeedsReason") };
      }
      if (from === "approved") {
        return { kind: "invalid", reason: L(locale, "boardReasonApprovedNoDraft") };
      }
      return { kind: "invalid", reason: L(locale, "boardReasonTerminalNoDraft") };
    }
  }
}

const BOARD_ACTION_PRIORITY: Record<BoardActionKind, number> = {
  submit: 0,
  approve: 1,
  schedule: 2,
  publish: 3,
  "cancel-schedule": 4,
};

/**
 * The move-menu entries for one card: every non-invalid move,
 * forward steps first. A failed post also gets its publish retry
 * — that action lives INSIDE its own column, so no drop produces
 * it; it is added explicitly here.
 */
export function boardMenuActions(
  post: BoardPostLike,
  opts: { requireApproval: boolean },
): { action: BoardActionKind; label: string; target: BoardColumnId }[] {
  const out: { action: BoardActionKind; label: string; target: BoardColumnId }[] = [];
  for (const col of BOARD_COLUMNS) {
    const r = boardDropAction(post, col.id, opts);
    if (r.kind === "noop" || r.kind === "invalid") continue;
    out.push({ action: r.kind, label: BOARD_ACTION_LABELS[r.kind], target: col.id });
  }
  if (post.status === "failed" && !out.some((a) => a.action === "publish")) {
    out.push({ action: "publish", label: BOARD_ACTION_LABELS.publish, target: "done" });
  }
  return out.sort((a, b) => BOARD_ACTION_PRIORITY[a.action] - BOARD_ACTION_PRIORITY[b.action]);
}

/**
 * SN3 calendar drag: the same wall-clock time on another day, in
 * the org timezone — built from the existing tz helpers so DST
 * edges behave exactly like the schedule form does.
 */
export function rescheduledIsoKeepingTime(scheduledAtIso: string, targetDayKey: string, timeZone: string): string {
  const local = utcToLocalInput(scheduledAtIso, timeZone); // "yyyy-mm-ddThh:mm"
  const time = local.slice(11, 16);
  return localInputToUtcIso(`${targetDayKey}T${time}`, timeZone);
}

/** Calendar chips are draggable only for scheduled posts. */
export function isCalendarDraggable(post: BoardPostLike): boolean {
  return post.status === "scheduled";
}
