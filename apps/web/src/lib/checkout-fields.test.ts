import { describe, expect, it } from "vitest";
import {
  buildFieldAnswers,
  formatFieldAnswer,
  isFieldAnswered,
  missingRequiredFields,
  normalizeCheckoutFields,
} from "./checkout-fields";

const defs = normalizeCheckoutFields([
  { key: "gift_note", label: "উপহারের বার্তা", type: "text", options: [], required: false },
  { key: "size", label: "সাইজ", type: "select", options: ["M", "L"], required: true },
  { key: "fragile", label: "ভঙ্গুর পণ্য", type: "checkbox", options: null, required: true },
  { key: "", label: "bad", type: "text", options: [], required: false },
  null,
]);

describe("AB4 checkout fields", () => {
  it("normalizes defs and drops unusable entries", () => {
    expect(defs).toHaveLength(3);
    expect(defs[2].options).toEqual([]);
  });

  it("checkbox answers count only when true; text needs non-empty", () => {
    expect(isFieldAnswered(defs[2], { fragile: true })).toBe(true);
    expect(isFieldAnswered(defs[2], { fragile: false })).toBe(false);
    expect(isFieldAnswered(defs[0], { gift_note: "  " })).toBe(false);
    expect(isFieldAnswered(defs[0], { gift_note: "শুভেচ্ছা" })).toBe(true);
  });

  it("missing required lists labels in def order", () => {
    expect(missingRequiredFields(defs, {})).toEqual(["সাইজ", "ভঙ্গুর পণ্য"]);
    expect(missingRequiredFields(defs, { size: "M", fragile: true })).toEqual([]);
  });

  it("buildFieldAnswers sends only answered fields, trimmed; undefined when empty", () => {
    expect(buildFieldAnswers(defs, {})).toBeUndefined();
    expect(buildFieldAnswers(defs, { gift_note: "  হাই  ", size: "L", fragile: false }))
      .toEqual({ gift_note: "হাই", size: "L" });
  });

  it("formats stored answers for the dashboard", () => {
    expect(formatFieldAnswer(true)).toBe("হ্যাঁ");
    expect(formatFieldAnswer(false)).toBe("না");
    expect(formatFieldAnswer("")).toBe("—");
    expect(formatFieldAnswer("M")).toBe("M");
  });
});
