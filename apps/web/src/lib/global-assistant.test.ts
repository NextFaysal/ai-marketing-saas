import { describe, expect, it } from "vitest";
import { pageContextFor, pageLabelFor, selectionQuote, suggestionsFor } from "./global-assistant";

describe("pageContextFor", () => {
  it("reduces nested dashboard paths to the section path", () => {
    expect(pageContextFor("/dashboard")).toBe("/dashboard");
    expect(pageContextFor("/dashboard/orders")).toBe("/dashboard/orders");
    expect(pageContextFor("/dashboard/orders/abc-123")).toBe("/dashboard/orders");
    expect(pageContextFor("/dashboard/inbox")).toBe("/dashboard/inbox");
  });
  it("returns undefined outside the dashboard or for odd shapes", () => {
    expect(pageContextFor("/login")).toBeUndefined();
    expect(pageContextFor("/")).toBeUndefined();
    expect(pageContextFor(null)).toBeUndefined();
    expect(pageContextFor(undefined)).toBeUndefined();
    expect(pageContextFor("")).toBeUndefined();
  });
});

describe("pageLabelFor", () => {
  it("resolves labels from the nav registry, longest prefix wins", () => {
    expect(pageLabelFor("/dashboard/orders")).toBe("Orders");
    expect(pageLabelFor("/dashboard/inbox")).toBe("Inbox");
    expect(pageLabelFor("/dashboard")).toBe("Overview");
    expect(pageLabelFor("/dashboard/unknown-xyz")).toBe("Dashboard");
    expect(pageLabelFor(null)).toBe("Dashboard");
  });
});

describe("suggestionsFor", () => {
  it("serves section-specific suggestions for curated sections", () => {
    expect(suggestionsFor("/dashboard/orders")).toContain("কোন অর্ডারগুলোর ফলো-আপ দরকার?");
    expect(suggestionsFor("/dashboard/products")).toContain("স্টকের অবস্থা কেমন?");
    expect(suggestionsFor("/dashboard/campaigns")).toContain("আমার সবচেয়ে ভালো ক্যাম্পেইন কোনগুলো?");
  });
  it("falls back to the defaults elsewhere", () => {
    expect(suggestionsFor("/dashboard/settings")).toEqual(suggestionsFor("/dashboard"));
    expect(suggestionsFor(null)).toHaveLength(3);
  });
});

import { pendingBadgeLabel, pickTodaysBriefing } from "./global-assistant";

describe("pendingBadgeLabel (G5)", () => {
  it("hides at zero/null and caps the display at 50+", () => {
    expect(pendingBadgeLabel(0)).toBeNull();
    expect(pendingBadgeLabel(null)).toBeNull();
    expect(pendingBadgeLabel(undefined)).toBeNull();
    expect(pendingBadgeLabel(1)).toBe("1");
    expect(pendingBadgeLabel(49)).toBe("49");
    expect(pendingBadgeLabel(50)).toBe("50+");
    expect(pendingBadgeLabel(80)).toBe("50+");
  });
});

describe("pickTodaysBriefing (G5)", () => {
  const now = new Date(2026, 9, 12, 21, 0, 0); // local 2026-10-12 21:00
  const mk = (id: string, type: string, createdAt: string) => ({ id, type, title: id, body: "b", readAt: null, createdAt });
  it("picks the latest ai_briefing of local today only", () => {
    const items = [
      mk("old", "ai_briefing", new Date(2026, 9, 12, 7, 0).toISOString()),
      mk("new", "ai_briefing", new Date(2026, 9, 12, 9, 30).toISOString()),
      mk("yesterday", "ai_briefing", new Date(2026, 9, 11, 9, 30).toISOString()),
      mk("mention", "mention", new Date(2026, 9, 12, 10, 0).toISOString()),
    ];
    expect(pickTodaysBriefing(items, now)?.id).toBe("new");
  });
  it("returns null when there is no briefing today", () => {
    expect(pickTodaysBriefing([mk("y", "ai_briefing", new Date(2026, 9, 11, 9).toISOString())], now)).toBeNull();
    expect(pickTodaysBriefing([], now)).toBeNull();
    expect(pickTodaysBriefing(null, now)).toBeNull();
  });
});

describe("selectionQuote (G6)", () => {
  it("collapses whitespace and trims", () => {
    expect(selectionQuote("  মোট বিক্রি\n  ৫০,০০০   টাকা ")).toBe("মোট বিক্রি ৫০,০০০ টাকা");
  });
  it("too short → null", () => {
    expect(selectionQuote("বিক্রি")).toBeNull();
    expect(selectionQuote("   ")).toBeNull();
  });
  it("caps at 500 chars with ellipsis", () => {
    const out = selectionQuote("a".repeat(600))!;
    expect(out).toHaveLength(501);
    expect(out.endsWith("…")).toBe(true);
  });
});
