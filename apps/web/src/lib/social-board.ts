import { localInputToUtcIso, utcToLocalInput } from "./social-calendar";

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

export const BOARD_COLUMNS: { id: BoardColumnId; label: string }[] = [
  { id: "draft", label: "Draft (খসড়া)" },
  { id: "pending", label: "অনুমোদনের অপেক্ষায়" },
  { id: "approved", label: "অনুমোদিত" },
  { id: "scheduled", label: "শিডিউল করা" },
  { id: "done", label: "Published / Failed" },
];

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
): BoardDropResult {
  const from = boardColumnForPost(post);
  if (from === target) return { kind: "noop" };
  if (post.status === "publishing") {
    return { kind: "invalid", reason: "এই পোস্টটি এখন প্রকাশের কাজ চলছে — শেষ হলে আবার চেষ্টা করুন।" };
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
        return { kind: "invalid", reason: "এই Organization-এ অনুমোদন প্রক্রিয়া চালু নেই — Draft সরাসরি শিডিউল বা প্রকাশ করা যায়।" };
      }
      return { kind: "invalid", reason: "এই পোস্টটি এখন অনুমোদনের জন্য পাঠানো যাবে না।" };
    }
    case "approved": {
      if (from === "pending") return { kind: "approve" };
      if (from === "draft") {
        return opts.requireApproval
          ? { kind: "invalid", reason: "আগে পোস্টটি অনুমোদনের জন্য পাঠান — Pending কলামে ফেলুন, তারপর অনুমোদন করুন।" }
          : { kind: "invalid", reason: "এই Organization-এ অনুমোদন প্রক্রিয়া চালু নেই — আলাদা Approved ধাপ নেই।" };
      }
      return { kind: "invalid", reason: "এই ধাপ থেকে সরাসরি অনুমোদন করা যায় না।" };
    }
    case "scheduled": {
      if (from === "draft" || from === "pending" || from === "approved") return { kind: "schedule" };
      if (from === "done" && post.status === "failed") return { kind: "schedule" };
      return { kind: "invalid", reason: "প্রকাশিত/বাতিল পোস্ট আবার শিডিউল করা যায় না — দরকার হলে Clone করে নতুন Draft বানান।" };
    }
    case "done": {
      // Dropping on Published / Failed means "publish now" — the
      // same button the list view offers drafts, scheduled posts
      // and failed posts (a retry).
      if (from === "draft" || from === "pending" || from === "approved" || from === "scheduled") {
        return { kind: "publish" };
      }
      if (post.status === "failed") return { kind: "publish" };
      if (post.status === "published") return { kind: "invalid", reason: "পোস্টটি ইতিমধ্যে প্রকাশিত হয়েছে।" };
      if (post.status === "sent_to_creator") {
        return { kind: "invalid", reason: "পোস্টটি ইতিমধ্যে Creator-এর কাছে পাঠানো হয়েছে — TikTok অ্যাপে গিয়ে প্রকাশ শেষ করুন।" };
      }
      return { kind: "invalid", reason: "বাতিল করা পোস্ট প্রকাশ করা যায় না — Clone করে নতুন Draft বানান।" };
    }
    case "draft": {
      // The only road back to Draft is cancelling a schedule.
      if (from === "scheduled") return { kind: "cancel-schedule" };
      if (from === "pending") {
        return { kind: "invalid", reason: "প্রত্যাখ্যান করতে হলে কারণ লিখতে হয় — তালিকা ভিউ থেকে প্রত্যাখ্যান করুন; Board থেকে Pending পোস্ট Draft-এ ফেরানো যায় না।" };
      }
      if (from === "approved") {
        return { kind: "invalid", reason: "অনুমোদিত পোস্ট Draft-এ ফেরানোর কোনো পথ নেই।" };
      }
      return { kind: "invalid", reason: "প্রকাশিত/ব্যর্থ পোস্ট Draft-এ ফেরানো যায় না।" };
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
