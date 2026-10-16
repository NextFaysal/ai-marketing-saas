import { describe, expect, it } from "vitest";
import {
  ScanDebouncer, barcodeDetectorSupported, normalizeScanCode, shouldAcceptScan,
} from "./pos-scan";

describe("normalizeScanCode", () => {
  it("trims whitespace and scanner control characters", () => {
    expect(normalizeScanCode("  8801001  ")).toBe("8801001");
    expect(normalizeScanCode("8801001\r\n")).toBe("8801001");
    expect(normalizeScanCode("\t\u00018801001\u0003\n")).toBe("8801001");
  });

  it("keeps interior characters untouched (Bengali / dashes / spaces)", () => {
    expect(normalizeScanCode("SKU- লাল -01")).toBe("SKU- লাল -01");
  });

  it("empty-ish input normalizes to empty", () => {
    expect(normalizeScanCode("")).toBe("");
    expect(normalizeScanCode("  \r\n ")).toBe("");
    expect(normalizeScanCode(null)).toBe("");
    expect(normalizeScanCode(undefined)).toBe("");
  });
});

describe("shouldAcceptScan", () => {
  it("accepts the first scan and any different code immediately", () => {
    expect(shouldAcceptScan(null, null, "A", 1000)).toBe(true);
    expect(shouldAcceptScan("A", 1000, "B", 1100)).toBe(true);
  });

  it("rejects the same code inside the default 1500ms window, accepts after it", () => {
    expect(shouldAcceptScan("A", 1000, "A", 2000)).toBe(false);
    expect(shouldAcceptScan("A", 1000, "A", 2499)).toBe(false);
    expect(shouldAcceptScan("A", 1000, "A", 2500)).toBe(true);
  });

  it("honors a custom window and rejects empty codes", () => {
    expect(shouldAcceptScan("A", 1000, "A", 1300, 200)).toBe(true);
    expect(shouldAcceptScan(null, null, "   ", 1000)).toBe(false);
    // A padded duplicate is still the same code.
    expect(shouldAcceptScan("A", 1000, " A \n", 1100)).toBe(false);
  });
});

describe("ScanDebouncer", () => {
  it("records accepted scans and suppresses duplicate frames until the window passes", () => {
    const d = new ScanDebouncer(1000);
    expect(d.accept("8801", 0)).toBe(true);
    expect(d.accept("8801", 500)).toBe(false);
    expect(d.accept("8802", 600)).toBe(true); // different code: immediate
    expect(d.accept("8802", 1000)).toBe(false);
    expect(d.accept("8802", 1600)).toBe(true);
  });

  it("reset clears the memory", () => {
    const d = new ScanDebouncer();
    expect(d.accept("X", 0)).toBe(true);
    d.reset();
    expect(d.accept("X", 10)).toBe(true);
  });
});

describe("barcodeDetectorSupported", () => {
  it("is true only when a BarcodeDetector constructor exists", () => {
    expect(barcodeDetectorSupported({ BarcodeDetector: class {} })).toBe(true);
    expect(barcodeDetectorSupported({})).toBe(false);
    expect(barcodeDetectorSupported({ BarcodeDetector: "nope" })).toBe(false);
    expect(barcodeDetectorSupported(null)).toBe(false);
    expect(barcodeDetectorSupported(undefined)).toBe(false); // no window in tests
  });
});
