import { describe, expect, it } from "vitest";
import {
  TRANSLATION_LOCALES, canApprove, displayPriceCaption, findTranslation, sourceLabel, statusLabel,
  type TranslationView,
} from "./translations";

/**
 * NF5 (FB3) — web helpers for the translation panel + shop
 * display prices. The load-bearing honesty rules: drafts are
 * labelled as NOT public, and a display-price caption exists
 * only when the API actually sent a converted display price
 * (no rate configured → nothing is shown, never computed here).
 */

const row = (over: Partial<TranslationView> = {}): TranslationView => ({
  id: "t1", entityType: "product", entityId: "p1", field: "name", locale: "hi",
  text: "चमड़े का वॉलेट", status: "draft", source: "ai", updatedAt: null, ...over,
});

describe("NF5 translations lib", () => {
  it("ships bn + en + hi (the third locale is Hindi)", () => {
    expect(TRANSLATION_LOCALES.map((l) => l.code)).toEqual(["bn", "en", "hi"]);
  });

  it("status labels are honest: a draft says it is NOT shown in the shop", () => {
    expect(statusLabel("draft")).toContain("দোকানে দেখাবে না");
    expect(statusLabel("approved")).toContain("দোকানে দেখাচ্ছে");
    expect(sourceLabel("ai")).toBe("AI খসড়া");
    expect(sourceLabel("human")).toBe("নিজে লেখা");
  });

  it("findTranslation matches field + locale exactly", () => {
    const items = [row(), row({ id: "t2", field: "description", text: "…" })];
    expect(findTranslation(items, "name", "hi")?.id).toBe("t1");
    expect(findTranslation(items, "name", "en")).toBeNull();
    expect(findTranslation(items, "description", "hi")?.id).toBe("t2");
  });

  it("canApprove only for an existing draft", () => {
    expect(canApprove(row())).toBe(true);
    expect(canApprove(row({ status: "approved" }))).toBe(false);
    expect(canApprove(null)).toBe(false);
  });

  it("displayPriceCaption: null without an API display price; labelled caption with one", () => {
    expect(displayPriceCaption({})).toBeNull();
    expect(displayPriceCaption({ displayPrices: [] })).toBeNull();
    const caption = displayPriceCaption({
      displayPrices: [{ currency: "USD", amount: "5.00", label: "আনুমানিক মূল্য — চেকআউটে দোকানের মূল মুদ্রায় (BDT) চার্জ করা হবে" }],
    });
    expect(caption).toContain("USD 5.00");
    expect(caption).toContain("আনুমানিক");
    expect(caption).toContain("BDT");
  });
});
