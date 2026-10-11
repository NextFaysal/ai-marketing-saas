import { describe, expect, it } from "vitest";
import {
  canSubmitForApproval,
  formatHourBn,
  hasInsights,
  insightChips,
  summaryMetricRows,
  weekdayNameBn,
  type SocialPostInsights,
} from "./social-post-insights";

describe("insightChips (SP7)", () => {
  it("null / empty insights → no chips (UI shows 'এখনো data আসেনি', never zeros)", () => {
    expect(insightChips(null)).toEqual([]);
    expect(insightChips(undefined)).toEqual([]);
    expect(insightChips({ platform: "meta_page" })).toEqual([]);
    expect(hasInsights(null)).toBe(false);
  });

  it("only present metrics appear, in display order", () => {
    const insights: SocialPostInsights = { platform: "instagram", plays: 40, likeCount: 12, commentsCount: 3, saved: 2 };
    expect(insightChips(insights).map((c) => c.key)).toEqual(["likeCount", "commentsCount", "saved", "plays"]);
    expect(insightChips(insights).map((c) => c.label)).toEqual(["👍 পছন্দ", "💬 মন্তব্য", "সেভ", "প্লে"]);
    expect(hasInsights(insights)).toBe(true);
  });

  it("a real 0 returned by the platform IS shown (absent ≠ 0)", () => {
    const chips = insightChips({ platform: "meta_page", reactions: 0, shares: 0 });
    expect(chips).toEqual([
      { key: "reactions", label: "👍 রিঅ্যাকশন", value: 0 },
      { key: "shares", label: "↗️ শেয়ার", value: 0 },
    ]);
  });

  it("page metrics map to their Bengali labels", () => {
    const chips = insightChips({ platform: "meta_page", reactions: 5, comments: 1, impressions: 900, reach: 700 });
    expect(chips.map((c) => c.label)).toEqual(["👍 রিঅ্যাকশন", "💬 মন্তব্য", "👁️ মোট দেখা", "পৌঁছেছে"]);
  });
});

describe("summaryMetricRows (SP7)", () => {
  it("orders known metrics and keeps the per-metric post counts", () => {
    const rows = summaryMetricRows({
      impressions: { total: 5000, posts: 4 },
      reactions: { total: 123, posts: 5 },
    });
    expect(rows).toEqual([
      { key: "reactions", label: "মোট রিঅ্যাকশন", total: 123, posts: 5 },
      { key: "impressions", label: "মোট দেখা", total: 5000, posts: 4 },
    ]);
  });

  it("empty / missing totals → no rows", () => {
    expect(summaryMetricRows({})).toEqual([]);
    expect(summaryMetricRows(null)).toEqual([]);
    expect(summaryMetricRows(undefined)).toEqual([]);
  });

  it("unknown metric keys are kept (raw key as label), after known ones", () => {
    const rows = summaryMetricRows({ videoViews: { total: 9, posts: 2 }, shares: { total: 3, posts: 2 } });
    expect(rows.map((r) => r.key)).toEqual(["shares", "videoViews"]);
    expect(rows[1].label).toBe("videoViews");
  });
});

describe("best-time formatting (SP7)", () => {
  it("weekday names follow 0=Sunday … 6=Saturday", () => {
    expect(weekdayNameBn(0)).toBe("রবিবার");
    expect(weekdayNameBn(1)).toBe("সোমবার");
    expect(weekdayNameBn(5)).toBe("শুক্রবার");
    expect(weekdayNameBn(6)).toBe("শনিবার");
    expect(weekdayNameBn(7)).toBe("");
  });

  it("hours render as Bengali day-part + 12-hour clock", () => {
    expect(formatHourBn(20)).toBe("রাত ৮টা");
    expect(formatHourBn(0)).toBe("রাত ১২টা");
    expect(formatHourBn(12)).toBe("দুপুর ১২টা");
    expect(formatHourBn(9)).toBe("সকাল ৯টা");
    expect(formatHourBn(16)).toBe("বিকেল ৪টা");
  });
});

describe("canSubmitForApproval (SP7)", () => {
  const draft = { status: "draft", approvalStatus: null };

  it("setting OFF → never", () => {
    expect(canSubmitForApproval(draft, false)).toBe(false);
  });

  it("draft with no approval state or a rejection → yes, when ON", () => {
    expect(canSubmitForApproval(draft, true)).toBe(true);
    expect(canSubmitForApproval({ status: "draft", approvalStatus: "rejected" }, true)).toBe(true);
  });

  it("pending / approved drafts and non-drafts → no", () => {
    expect(canSubmitForApproval({ status: "draft", approvalStatus: "pending" }, true)).toBe(false);
    expect(canSubmitForApproval({ status: "draft", approvalStatus: "approved" }, true)).toBe(false);
    expect(canSubmitForApproval({ status: "scheduled", approvalStatus: null }, true)).toBe(false);
    expect(canSubmitForApproval({ status: "published", approvalStatus: null }, true)).toBe(false);
  });
});
