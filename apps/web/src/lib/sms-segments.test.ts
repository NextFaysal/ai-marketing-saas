import { describe, expect, it } from "vitest";
import { smsSegments } from "./sms-segments";

describe("smsSegments (web mirror of the API module)", () => {
  it("counts a short GSM-7 message as one part", () => {
    expect(smsSegments("Hello")).toEqual({ encoding: "gsm7", length: 5, parts: 1 });
  });
  it("splits GSM-7 at 160/153 boundaries", () => {
    expect(smsSegments("a".repeat(160)).parts).toBe(1);
    expect(smsSegments("a".repeat(161)).parts).toBe(2);
    expect(smsSegments("a".repeat(306)).parts).toBe(2);
    expect(smsSegments("a".repeat(307)).parts).toBe(3);
  });
  it("charges extension characters double", () => {
    expect(smsSegments("{}").length).toBe(4);
  });
  it("switches to unicode for Bengali and counts 70/67", () => {
    const one = smsSegments("ঈদ মোবারক");
    expect(one.encoding).toBe("unicode");
    expect(one.parts).toBe(1);
    expect(smsSegments("অ".repeat(70)).parts).toBe(1);
    expect(smsSegments("অ".repeat(71)).parts).toBe(2);
    expect(smsSegments("অ".repeat(135)).parts).toBe(3);
  });
  it("treats empty text as one part", () => {
    expect(smsSegments("")).toEqual({ encoding: "gsm7", length: 0, parts: 1 });
  });
});
