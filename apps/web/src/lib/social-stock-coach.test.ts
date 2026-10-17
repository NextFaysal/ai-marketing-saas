import { describe, expect, it } from "vitest";
import {
  OVERLAY_POSITIONS,
  coachSourceLabel,
  formatStockDuration,
} from "./social-stock-coach";

/**
 * SN5/SN9 web helpers (Batch N3): overlay positions are the
 * closed set the API accepts; the coach source label never
 * dresses the deterministic summary up as AI; duration renders
 * in Bengali digits.
 */
describe("SN5/SN9 — social-stock-coach helpers", () => {
  it("overlay positions are exactly the API's closed set", () => {
    expect(OVERLAY_POSITIONS.map((o) => o.value)).toEqual(["bottom", "top", "corner"]);
    for (const o of OVERLAY_POSITIONS) expect(o.label.length).toBeGreaterThan(0);
  });

  it("coach source label is honest about the deterministic text", () => {
    expect(coachSourceLabel("llm")).toContain("AI");
    expect(coachSourceLabel("deterministic")).toContain("সংখ্যা থেকে তৈরি");
    expect(coachSourceLabel("deterministic")).not.toContain("AI সারসংক্ষেপ");
    expect(coachSourceLabel(null)).toBe(coachSourceLabel("deterministic"));
  });

  it("formatStockDuration renders m:ss in Bengali digits and refuses junk", () => {
    expect(formatStockDuration(75)).toBe("১:১৫");
    expect(formatStockDuration(9)).toBe("০:০৯");
    expect(formatStockDuration(null)).toBeNull();
    expect(formatStockDuration(undefined)).toBeNull();
    expect(formatStockDuration(-3)).toBeNull();
  });
});
