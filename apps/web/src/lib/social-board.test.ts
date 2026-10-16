import { describe, expect, it } from "vitest";
import {
  boardColumnForPost,
  boardDropAction,
  boardMenuActions,
  isCalendarDraggable,
  rescheduledIsoKeepingTime,
} from "./social-board";

const DHAKA = "Asia/Dhaka";
const ON = { requireApproval: true };
const OFF = { requireApproval: false };

describe("boardColumnForPost (SN3)", () => {
  it("plain and rejected drafts sit in Draft", () => {
    expect(boardColumnForPost({ status: "draft", approvalStatus: null })).toBe("draft");
    expect(boardColumnForPost({ status: "draft", approvalStatus: "rejected" })).toBe("draft");
    expect(boardColumnForPost({ status: "draft" })).toBe("draft");
  });

  it("pending and manager_approved drafts sit in Pending", () => {
    expect(boardColumnForPost({ status: "draft", approvalStatus: "pending" })).toBe("pending");
    expect(boardColumnForPost({ status: "draft", approvalStatus: "manager_approved" })).toBe("pending");
  });

  it("approved drafts sit in Approved", () => {
    expect(boardColumnForPost({ status: "draft", approvalStatus: "approved" })).toBe("approved");
  });

  it("scheduled and publishing sit in Scheduled whatever the approval state", () => {
    expect(boardColumnForPost({ status: "scheduled", approvalStatus: "approved" })).toBe("scheduled");
    expect(boardColumnForPost({ status: "publishing", approvalStatus: null })).toBe("scheduled");
  });

  it("terminal outcomes share the last column", () => {
    for (const status of ["published", "failed", "sent_to_creator", "cancelled"]) {
      expect(boardColumnForPost({ status, approvalStatus: null })).toBe("done");
    }
  });
});

describe("boardDropAction (SN3)", () => {
  const draft = { status: "draft", approvalStatus: null };
  const rejected = { status: "draft", approvalStatus: "rejected" };
  const pending = { status: "draft", approvalStatus: "pending" };
  const mgr = { status: "draft", approvalStatus: "manager_approved" };
  const approved = { status: "draft", approvalStatus: "approved" };
  const scheduled = { status: "scheduled", approvalStatus: "approved" };
  const failed = { status: "failed", approvalStatus: "approved" };
  const published = { status: "published", approvalStatus: "approved" };

  it("dropping on the same column is a noop", () => {
    expect(boardDropAction(draft, "draft", ON)).toEqual({ kind: "noop" });
    expect(boardDropAction(scheduled, "scheduled", ON)).toEqual({ kind: "noop" });
  });

  it("draft → pending submits only when the approval flow is on", () => {
    expect(boardDropAction(draft, "pending", ON)).toEqual({ kind: "submit" });
    expect(boardDropAction(rejected, "pending", ON)).toEqual({ kind: "submit" });
    const off = boardDropAction(draft, "pending", OFF);
    expect(off.kind).toBe("invalid");
  });

  it("pending → approved approves; draft → approved is guided, never direct", () => {
    expect(boardDropAction(pending, "approved", ON)).toEqual({ kind: "approve" });
    expect(boardDropAction(mgr, "approved", ON)).toEqual({ kind: "approve" });
    expect(boardDropAction(draft, "approved", ON).kind).toBe("invalid");
    expect(boardDropAction(draft, "approved", OFF).kind).toBe("invalid");
  });

  it("schedule is offered from draft/pending/approved and for failed retries", () => {
    expect(boardDropAction(draft, "scheduled", OFF)).toEqual({ kind: "schedule" });
    expect(boardDropAction(pending, "scheduled", ON)).toEqual({ kind: "schedule" });
    expect(boardDropAction(approved, "scheduled", ON)).toEqual({ kind: "schedule" });
    expect(boardDropAction(failed, "scheduled", ON)).toEqual({ kind: "schedule" });
    expect(boardDropAction(published, "scheduled", ON).kind).toBe("invalid");
  });

  it("dropping on the last column publishes (a failed post already sits there — a drop is a noop, the retry lives in the menu)", () => {
    expect(boardDropAction(draft, "done", OFF)).toEqual({ kind: "publish" });
    expect(boardDropAction(scheduled, "done", ON)).toEqual({ kind: "publish" });
    expect(boardDropAction(failed, "done", ON)).toEqual({ kind: "noop" });
    // Terminal posts already sit in this column — dropping them on
    // it moves nothing (a noop, not an error).
    expect(boardDropAction(published, "done", ON)).toEqual({ kind: "noop" });
    expect(boardDropAction({ status: "cancelled", approvalStatus: null }, "done", ON)).toEqual({ kind: "noop" });
    expect(boardDropAction({ status: "sent_to_creator", approvalStatus: null }, "done", ON)).toEqual({ kind: "noop" });
  });

  it("the only road back to Draft is cancelling a schedule", () => {
    expect(boardDropAction(scheduled, "draft", ON)).toEqual({ kind: "cancel-schedule" });
    expect(boardDropAction(pending, "draft", ON).kind).toBe("invalid");
    expect(boardDropAction(approved, "draft", ON).kind).toBe("invalid");
    expect(boardDropAction(published, "draft", ON).kind).toBe("invalid");
  });

  it("a publishing post refuses every move", () => {
    const pub = { status: "publishing", approvalStatus: "approved" };
    expect(boardDropAction(pub, "done", ON).kind).toBe("invalid");
    expect(boardDropAction(pub, "draft", ON).kind).toBe("invalid");
  });
});

describe("boardMenuActions (SN3)", () => {
  it("a plain draft without the approval flow offers schedule + publish only", () => {
    const actions = boardMenuActions({ status: "draft", approvalStatus: null }, OFF).map((a) => a.action);
    expect(actions).toEqual(["schedule", "publish"]);
  });

  it("a plain draft with the approval flow offers submit first", () => {
    const actions = boardMenuActions({ status: "draft", approvalStatus: null }, ON).map((a) => a.action);
    expect(actions).toEqual(["submit", "schedule", "publish"]);
  });

  it("a scheduled post offers publish + back-to-draft", () => {
    const actions = boardMenuActions({ status: "scheduled", approvalStatus: "approved" }, ON).map((a) => a.action);
    expect(actions).toEqual(["publish", "cancel-schedule"]);
  });

  it("a published post offers nothing", () => {
    expect(boardMenuActions({ status: "published", approvalStatus: "approved" }, ON)).toEqual([]);
  });

  it("a failed post offers re-schedule and the publish retry", () => {
    const actions = boardMenuActions({ status: "failed", approvalStatus: "approved" }, ON).map((a) => a.action);
    expect(actions).toEqual(["schedule", "publish"]);
  });
});

describe("rescheduledIsoKeepingTime (SN3)", () => {
  it("keeps the Dhaka wall time on the target day", () => {
    // 2026-10-20T04:30:00Z = 10:30 in Dhaka.
    expect(rescheduledIsoKeepingTime("2026-10-20T04:30:00.000Z", "2026-10-22", DHAKA)).toBe("2026-10-22T04:30:00.000Z");
  });

  it("a late-evening UTC instant keeps its Dhaka morning time across days", () => {
    // 2026-10-20T19:30:00Z = 2026-10-21 01:30 in Dhaka; moving to
    // the 25th keeps 01:30 Dhaka = 19:30Z on the 24th.
    expect(rescheduledIsoKeepingTime("2026-10-20T19:30:00.000Z", "2026-10-25", DHAKA)).toBe("2026-10-24T19:30:00.000Z");
  });

  it("same-day target returns the same instant", () => {
    expect(rescheduledIsoKeepingTime("2026-10-20T04:30:00.000Z", "2026-10-20", DHAKA)).toBe("2026-10-20T04:30:00.000Z");
  });
});

describe("isCalendarDraggable (SN3)", () => {
  it("only scheduled posts drag on the calendar", () => {
    expect(isCalendarDraggable({ status: "scheduled" })).toBe(true);
    expect(isCalendarDraggable({ status: "draft" })).toBe(false);
    expect(isCalendarDraggable({ status: "published" })).toBe(false);
  });
});
