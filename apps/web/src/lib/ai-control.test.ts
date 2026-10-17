import { describe, expect, it } from "vitest";
import {
  ADMIN_CONSOLE_DECISION_LABEL,
  activityEventText,
  activityKindLabel,
  activityQuery,
  activitySourceLabel,
  activitySummary,
  ageText,
  autonomyLevelLabel,
  canDecideControl,
  canSetControlAutonomy,
  isAdminConsoleDecision,
  isProposalOnly,
  proposalOutcomeText,
  proposalStatusLabel,
  proposedByLabel,
  riskLabel,
  surfaceLabel,
  usageFeatureLabel,
} from "./ai-control";

/**
 * SA-B13 (W4): the Control Center's pure mappings — role gates
 * mirror the engine API exactly, outcomes are said plainly
 * (a failure carries its recorded reason verbatim; a
 * money-adjacent approval is never dressed up as execution),
 * and activity counts come from the fetched list only.
 */

describe("ai-control roles (mirror the ActionEngineController)", () => {
  it("decisions: OWNER/ADMIN/MARKETING_MANAGER only", () => {
    expect(canDecideControl("OWNER")).toBe(true);
    expect(canDecideControl("ADMIN")).toBe(true);
    expect(canDecideControl("MARKETING_MANAGER")).toBe(true);
    expect(canDecideControl("SUPPORT_AGENT")).toBe(false);
    expect(canDecideControl("VIEWER")).toBe(false);
    expect(canDecideControl(null)).toBe(false);
    expect(canDecideControl(undefined)).toBe(false);
  });

  it("autonomy settings: OWNER/ADMIN only", () => {
    expect(canSetControlAutonomy("OWNER")).toBe(true);
    expect(canSetControlAutonomy("ADMIN")).toBe(true);
    expect(canSetControlAutonomy("MARKETING_MANAGER")).toBe(false);
    expect(canSetControlAutonomy("SUPPORT_AGENT")).toBe(false);
  });
});

describe("ai-control labels", () => {
  it("surfaces, risks, proposers, statuses and levels render in plain Bengali", () => {
    expect(surfaceLabel("inbox")).toBe("ইনবক্স");
    expect(surfaceLabel("comment")).toBe("কমেন্ট");
    expect(riskLabel("low")).toBe("কম ঝুঁকি");
    expect(riskLabel("medium")).toBe("মাঝারি ঝুঁকি");
    expect(riskLabel("high")).toBe("বেশি ঝুঁকি");
    expect(proposedByLabel("ai")).toBe("AI-এর প্রস্তাব");
    expect(proposedByLabel("staff")).toBe("টিমের প্রস্তাব");
    expect(proposalStatusLabel("proposed")).toBe("সিদ্ধান্তের অপেক্ষায়");
    expect(proposalStatusLabel("executed")).toBe("কার্যকর হয়েছে");
    expect(proposalStatusLabel("failed")).toBe("ব্যর্থ হয়েছে");
    expect(autonomyLevelLabel(0)).toBe("বন্ধ");
    expect(autonomyLevelLabel(1)).toContain("প্রস্তাব");
    expect(autonomyLevelLabel(2)).toContain("সীমিত নিজে");
    expect(autonomyLevelLabel(3)).toBe("তত্ত্বাবধানে নিজে");
  });

  it("unknown values fall back to the raw value — never hidden", () => {
    expect(surfaceLabel(" carrier_pigeon")).toBe(" carrier_pigeon");
    expect(riskLabel("extreme")).toBe("extreme");
    expect(proposalStatusLabel("mystery")).toBe("mystery");
  });
});

describe("ai-control outcomes", () => {
  it("executed = verified success wording", () => {
    const text = proposalOutcomeText({ status: "executed", result: { outcome: "verified_success" }, error: null });
    expect(text).toContain("কার্যকর হয়েছে");
    expect(text).toContain("যাচাই");
  });

  it("failed shows the recorded reason verbatim", () => {
    const text = proposalOutcomeText({ status: "failed", result: null, error: "অ্যাসাইন করা ব্যক্তি এই Organization-এর সদস্য নন" });
    expect(text).toBe("কার্যকর করা যায়নি — কারণ: অ্যাসাইন করা ব্যক্তি এই Organization-এর সদস্য নন");
  });

  it("a money-adjacent approval is proposal_only — recorded, never executed", () => {
    const p = { status: "approved", result: { outcome: "proposal_only" }, error: null };
    expect(isProposalOnly(p)).toBe(true);
    const text = proposalOutcomeText(p);
    expect(text).toContain("টাকা-সংক্রান্ত");
    expect(text).toContain("AI নিজে এটি কার্যকর করে না");
    expect(isProposalOnly({ status: "executed", result: { outcome: "verified_success" } })).toBe(false);
    expect(isProposalOnly({ status: "approved", result: { outcome: "verified_success" } })).toBe(false);
  });

  it("rejected says nothing was done", () => {
    expect(proposalOutcomeText({ status: "rejected", result: null, error: null })).toContain("কিছুই করা হয়নি");
  });
});

describe("ai-control SA-B25 activity feed (T4)", () => {
  const ev = (kind: string, event: string, meta: Record<string, unknown> = {}) =>
    ({ id: "x", kind, event, at: "2026-10-17T10:00:00Z", title: "t", detail: null, sourceId: "s", meta });

  it("kind labels are plain Bengali; unknown kinds fall back to raw", () => {
    expect(activityKindLabel("proposal")).toBe("কাজের প্রস্তাব");
    expect(activityKindLabel("learned")).toBe("শেখা");
    expect(activityKindLabel("answer")).toBe("উত্তর ভান্ডার");
    expect(activityKindLabel("content")).toBe("কনটেন্ট");
    expect(activityKindLabel("mystery")).toBe("mystery");
  });

  it("event texts: one plain sentence per (kind, event)", () => {
    expect(activityEventText(ev("proposal", "filed"))).toBe("নতুন প্রস্তাব এসেছে");
    expect(activityEventText(ev("proposal", "decided", { decision: "approved" }))).toBe("অনুমোদন দেওয়া হয়েছে");
    expect(activityEventText(ev("proposal", "decided", { decision: "rejected" }))).toBe("বাতিল করা হয়েছে");
    expect(activityEventText(ev("proposal", "executed"))).toBe("কার্যকর হয়েছে (যাচাইকৃত)");
    expect(activityEventText(ev("proposal", "failed"))).toBe("কার্যকর করা যায়নি");
    expect(activityEventText(ev("learned", "suggested"))).toBe("নতুন শেখার প্রস্তাব এসেছে");
    expect(activityEventText(ev("learned", "decided", { decision: "approved" }))).toBe("শেখা অনুমোদিত হয়েছে");
    expect(activityEventText(ev("learned", "decided", { decision: "rejected" }))).toBe("শেখার প্রস্তাব বাতিল হয়েছে");
    expect(activityEventText(ev("answer", "captured"))).toBe("নতুন যাচাইকৃত উত্তর জমা হয়েছে");
    expect(activityEventText(ev("answer", "invalidated"))).toBe("সংরক্ষিত উত্তর বাতিল হয়েছে (তথ্য বদলে গেছে)");
    expect(activityEventText(ev("content", "draft_created"))).toBe("AI কনটেন্টের খসড়া তৈরি হয়েছে");
  });

  it("a proposalOnly approval is recorded — never said to be executed by the AI", () => {
    const text = activityEventText(ev("proposal", "decided", { decision: "approved", proposalOnly: true }));
    expect(text).toBe("অনুমোদন রেকর্ড হয়েছে — টাকা-সংক্রান্ত কাজ, AI নিজে কার্যকর করেনি");
  });

  it("unknown (kind, event) falls back to the raw event string", () => {
    expect(activityEventText(ev("proposal", "teleported"))).toBe("teleported");
    expect(activityEventText(ev("mystery", "happened"))).toBe("happened");
    expect(activityEventText(ev("learned", "decided", { decision: "maybe" }))).toBe("decided");
  });

  it("source labels: copilot wins for proposals, learned maps its sourceType vocabulary, answers map their channel", () => {
    expect(activitySourceLabel(ev("proposal", "filed", { surface: "inbox" }))).toBe("ইনবক্স");
    expect(activitySourceLabel(ev("proposal", "filed", { surface: "comment" }))).toBe("কমেন্ট");
    expect(activitySourceLabel(ev("proposal", "filed", { surface: "inbox", via: "copilot" }))).toBe("Copilot");
    expect(activitySourceLabel(ev("learned", "suggested", { sourceType: "conversation" }))).toBe("কথোপকথন থেকে শেখা");
    expect(activitySourceLabel(ev("learned", "suggested", { sourceType: "website" }))).toBe("ওয়েবসাইট থেকে");
    expect(activitySourceLabel(ev("learned", "suggested", { sourceType: "product" }))).toBe("পণ্য থেকে");
    expect(activitySourceLabel(ev("learned", "suggested", { sourceType: "performance" }))).toBe("পারফরম্যান্স থেকে");
    expect(activitySourceLabel(ev("learned", "suggested", { sourceType: "ads" }))).toBe("বিজ্ঞাপন থেকে");
    expect(activitySourceLabel(ev("learned", "suggested", { sourceType: "creative" }))).toBe("ক্রিয়েটিভ থেকে");
    expect(activitySourceLabel(ev("learned", "suggested", { sourceType: "competitor" }))).toBe("প্রতিযোগী থেকে");
    expect(activitySourceLabel(ev("learned", "suggested", { sourceType: "unanswered" }))).toBe("উত্তর-না-পাওয়া প্রশ্ন থেকে");
    expect(activitySourceLabel(ev("learned", "suggested", { sourceType: "carrier_pigeon" }))).toBe("carrier_pigeon");
    expect(activitySourceLabel(ev("answer", "captured", { channel: "inbox" }))).toBe("ইনবক্স");
    expect(activitySourceLabel(ev("answer", "captured", { channel: "comment" }))).toBe("কমেন্ট");
    expect(activitySourceLabel(ev("content", "draft_created", {}))).toBe("AI কনটেন্ট");
  });

  it("isAdminConsoleDecision: only a learned decision stamped admin_console", () => {
    expect(isAdminConsoleDecision(ev("learned", "decided", { reviewedVia: "admin_console" }))).toBe(true);
    expect(isAdminConsoleDecision(ev("learned", "decided", { reviewedVia: "org" }))).toBe(false);
    expect(isAdminConsoleDecision(ev("learned", "decided", { reviewedVia: null }))).toBe(false);
    expect(isAdminConsoleDecision(ev("learned", "suggested", { reviewedVia: "admin_console" }))).toBe(false);
    expect(isAdminConsoleDecision(ev("proposal", "decided", { reviewedVia: "admin_console" }))).toBe(false);
    expect(ADMIN_CONSOLE_DECISION_LABEL).toBe("প্ল্যাটফর্ম অ্যাডমিনের সিদ্ধান্ত");
  });

  it("usage feature labels cover the real API buckets; unmapped falls back to raw", () => {
    expect(usageFeatureLabel("chat")).toBe("চ্যাট");
    expect(usageFeatureLabel("report")).toBe("রিপোর্ট");
    expect(usageFeatureLabel("copilot")).toBe("কোপাইলট");
    expect(usageFeatureLabel("content_generation")).toBe("কনটেন্ট তৈরি");
    expect(usageFeatureLabel("broadcast_personalization")).toBe("ব্রডকাস্ট সাজানো");
    expect(usageFeatureLabel("autopilot")).toBe("ইনবক্স অটোপাইলট");
    expect(usageFeatureLabel("comment_autopilot")).toBe("কমেন্ট অটোপাইলট");
    expect(usageFeatureLabel("some_future_bucket")).toBe("some_future_bucket");
  });

  it("activityQuery omits kind for the all filter and carries paging params", () => {
    expect(activityQuery({ days: 30, limit: 20, offset: 0 })).toBe("?days=30&limit=20&offset=0");
    expect(activityQuery({ kind: null, days: 30, limit: 20, offset: 0 })).toBe("?days=30&limit=20&offset=0");
    expect(activityQuery({ kind: "all", days: 7 })).toBe("?days=7");
    expect(activityQuery({ kind: "learned", days: 7, limit: 20, offset: 40 })).toBe("?kind=learned&days=7&limit=20&offset=40");
    expect(activityQuery({})).toBe("");
  });
});

describe("ai-control age + activity", () => {
  const now = new Date("2026-10-17T12:00:00Z");

  it("age renders in Bengali numerals, newest first buckets", () => {
    expect(ageText("2026-10-17T11:59:40Z", now)).toBe("এইমাত্র");
    expect(ageText("2026-10-17T11:55:00Z", now)).toBe("৫ মিনিট আগে");
    expect(ageText("2026-10-17T09:00:00Z", now)).toBe("৩ ঘণ্টা আগে");
    expect(ageText("2026-10-15T12:00:00Z", now)).toBe("২ দিন আগে");
    expect(ageText("not-a-date", now)).toBe("");
    expect(ageText(null, now)).toBe("");
  });

  it("activity counts only what the fetched list contains", () => {
    const list = [
      { status: "proposed" }, { status: "proposed" },
      { status: "executed" }, { status: "executed" }, { status: "executed" },
      { status: "failed" }, { status: "rejected" }, { status: "approved" },
    ];
    expect(activitySummary(list)).toEqual({ pending: 2, executed: 3, failed: 1, rejected: 1, decided: 6 });
    expect(activitySummary([])).toEqual({ pending: 0, executed: 0, failed: 0, rejected: 0, decided: 0 });
  });
});
