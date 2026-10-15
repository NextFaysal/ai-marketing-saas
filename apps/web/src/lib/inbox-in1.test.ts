/**
 * IN1 web helpers: UI↔API filter conversion (taka→minor, day
 * boundaries), saved-view restore shape-safety, snippet splitting.
 */
import { describe, expect, it } from "vitest";
import { EMPTY_UI_FILTERS, hasAdvancedFilters, savedToUiFilters, splitSnippet, uiFiltersToParams, uiFiltersToSaved, type InboxUiFilters } from "./inbox-in1";

const ui = (patch: Partial<InboxUiFilters>): InboxUiFilters => ({ ...EMPTY_UI_FILTERS, ...patch });

describe("uiFiltersToParams", () => {
  it("sends only non-default values", () => {
    const p = uiFiltersToParams(EMPTY_UI_FILTERS, "");
    expect(p.toString()).toBe("");
  });
  it("converts taka amounts to minor units and widens dateTo to the day's end", () => {
    const p = uiFiltersToParams(ui({ amountMin: "1500", amountMax: "2000.50", dateFrom: "2026-10-01", dateTo: "2026-10-12", intent: "price", sentiment: "negative", unreadOnly: true }), "sla");
    expect(p.get("amountMin")).toBe("150000");
    expect(p.get("amountMax")).toBe("200050");
    expect(new Date(p.get("dateFrom") as string).getTime()).toBeLessThanOrEqual(new Date("2026-10-01T00:00:00Z").getTime());
    expect(p.get("dateTo")).toBeTruthy();
    expect(new Date(p.get("dateTo") as string).getTime()).toBeGreaterThan(new Date("2026-10-12T00:00:00Z").getTime());
    expect(p.get("intent")).toBe("price");
    expect(p.get("sentiment")).toBe("negative");
    expect(p.get("unread")).toBe("1");
    expect(p.get("folder")).toBe("sla");
  });
  it("ignores garbage amounts and dates instead of sending NaN", () => {
    const p = uiFiltersToParams(ui({ amountMin: "abc", amountMax: "-5", dateFrom: "not-a-date" }), "");
    expect(p.has("amountMin")).toBe(false);
    expect(p.has("amountMax")).toBe(false);
    expect(p.has("dateFrom")).toBe(false);
  });
});

describe("saved view round-trip", () => {
  it("UI → saved → UI preserves the meaningful values", () => {
    const saved = uiFiltersToSaved(ui({ q: "ঢাকা", amountMin: "999", intent: "complaint", unreadOnly: true }), "vip");
    expect(saved.amountMin).toBe(99900);
    expect(saved.folder).toBe("vip");
    const back = savedToUiFilters(saved);
    expect(back.filters.q).toBe("ঢাকা");
    expect(back.filters.amountMin).toBe("999");
    expect(back.filters.intent).toBe("complaint");
    expect(back.filters.unreadOnly).toBe(true);
    expect(back.folder).toBe("vip");
  });
  it("a partial or hostile saved object restores over the empty defaults", () => {
    const back = savedToUiFilters({ amountMin: "not-a-number", folder: "evil", sort: "drop-table" } as any);
    expect(back.filters).toEqual(EMPTY_UI_FILTERS);
    expect(back.folder).toBe("");
    expect(savedToUiFilters(null).filters).toEqual(EMPTY_UI_FILTERS);
  });
  it("empty UI filters save as an empty object (an honest 'all' view)", () => {
    expect(uiFiltersToSaved(EMPTY_UI_FILTERS, "")).toEqual({});
  });
});

describe("hasAdvancedFilters + splitSnippet", () => {
  it("detects any advanced field", () => {
    expect(hasAdvancedFilters(EMPTY_UI_FILTERS)).toBe(false);
    expect(hasAdvancedFilters(ui({ sentiment: "positive" }))).toBe(true);
    expect(hasAdvancedFilters(ui({ dateFrom: "2026-10-01" }))).toBe(true);
  });
  it("splits at the server offsets", () => {
    expect(splitSnippet("…দাম কত টাকা…", 3, 2)).toEqual({ before: "…দা", match: "ম ", after: "কত টাকা…" });
  });
  it("degrades to no-highlight on bad offsets without altering text", () => {
    expect(splitSnippet("hello", 99, 2)).toEqual({ before: "hello", match: "", after: "" });
    expect(splitSnippet("hello", -1, 2).match).toBe("");
  });
});
