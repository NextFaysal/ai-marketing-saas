import { describe, expect, it } from "vitest";
import { fmtMoneyBn, fmtNumBn } from "./money-bn";

describe("fmtMoneyBn (DX3 §5 money format)", () => {
  it("renders ৳ with bn-BD grouping and 2 decimals", () => {
    expect(fmtMoneyBn("125050")).toBe("৳১,২৫০.৫০");
    expect(fmtMoneyBn(100000n)).toBe("৳১,০০০.০০");
    expect(fmtMoneyBn("0")).toBe("৳০.০০");
    expect(fmtMoneyBn(500)).toBe("৳৫.০০");
  });
  it("handles negatives and missing values honestly", () => {
    expect(fmtMoneyBn("-50000")).toBe("৳-৫০০.০০");
    expect(fmtMoneyBn(null)).toBe("—");
    expect(fmtMoneyBn(undefined)).toBe("—");
    expect(fmtMoneyBn("")).toBe("—");
  });
});

describe("fmtNumBn", () => {
  it("groups counts in bn-BD digits", () => {
    expect(fmtNumBn(1250)).toBe("১,২৫০");
    expect(fmtNumBn(0)).toBe("০");
    expect(fmtNumBn(null)).toBe("—");
  });
});
