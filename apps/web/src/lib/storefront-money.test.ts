import { describe, expect, it } from "vitest";
import { formatMinorTaka, minorToTakaString, takaToMinorString } from "./storefront-money";

describe("takaToMinorString", () => {
  it("converts whole taka and decimals exactly (string arithmetic, no floats)", () => {
    expect(takaToMinorString("60")).toBe("6000");
    expect(takaToMinorString("60.5")).toBe("6050");
    expect(takaToMinorString("60.50")).toBe("6050");
    expect(takaToMinorString("0.07")).toBe("7");
    expect(takaToMinorString("0")).toBe("0");
    expect(takaToMinorString("1250.50")).toBe("125050");
    expect(takaToMinorString("1,250.50")).toBe("125050");
    expect(takaToMinorString(" 120 ")).toBe("12000");
    expect(takaToMinorString(80)).toBe("8000");
  });

  it("rejects invalid input instead of rounding or guessing", () => {
    expect(takaToMinorString("")).toBeNull();
    expect(takaToMinorString("   ")).toBeNull();
    expect(takaToMinorString(null)).toBeNull();
    expect(takaToMinorString(undefined)).toBeNull();
    expect(takaToMinorString("abc")).toBeNull();
    expect(takaToMinorString("-60")).toBeNull();
    expect(takaToMinorString("60.505")).toBeNull(); // 3 decimals — never silently rounded
    expect(takaToMinorString("60.")).toBeNull();
    expect(takaToMinorString(".5")).toBeNull();
    expect(takaToMinorString("6 0")).toBeNull();
  });
});

describe("minorToTakaString", () => {
  it("formats minor strings back to taka for form prefill", () => {
    expect(minorToTakaString("6000")).toBe("60");
    expect(minorToTakaString("6050")).toBe("60.50");
    expect(minorToTakaString("6005")).toBe("60.05");
    expect(minorToTakaString("7")).toBe("0.07");
    expect(minorToTakaString(null)).toBe("");
    expect(minorToTakaString("")).toBe("");
    expect(minorToTakaString("abc")).toBe("");
  });

  it("round-trips with takaToMinorString", () => {
    for (const taka of ["60", "60.50", "0.07", "1250.50", "0"]) {
      expect(minorToTakaString(takaToMinorString(taka))).toBe(
        taka.includes(".") ? taka : taka,
      );
    }
  });
});

describe("formatMinorTaka", () => {
  it("renders taka with the ৳ sign", () => {
    expect(formatMinorTaka("6000")).toBe("৳60");
    expect(formatMinorTaka("125050")).toBe("৳1,250.50");
    expect(formatMinorTaka(null)).toBe("—");
  });
});
