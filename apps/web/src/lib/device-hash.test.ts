import { describe, expect, it } from "vitest";
import { buildDeviceParts, bucketConcurrency } from "./device-hash";
import { buildExpressPayload } from "./express-checkout";

describe("AB8 bucketConcurrency", () => {
  it("maps counts onto the coarse buckets", () => {
    expect(bucketConcurrency(0)).toBe("0");
    expect(bucketConcurrency(1)).toBe("2");
    expect(bucketConcurrency(2)).toBe("2");
    expect(bucketConcurrency(3)).toBe("4");
    expect(bucketConcurrency(4)).toBe("4");
    expect(bucketConcurrency(6)).toBe("8");
    expect(bucketConcurrency(8)).toBe("8");
    expect(bucketConcurrency(12)).toBe("16+");
    expect(bucketConcurrency(32)).toBe("16+");
  });

  it("unknown / invalid counts bucket as 0", () => {
    expect(bucketConcurrency(undefined)).toBe("0");
    expect(bucketConcurrency(null)).toBe("0");
    expect(bucketConcurrency(Number.NaN)).toBe("0");
    expect(bucketConcurrency(-4)).toBe("0");
  });
});

describe("AB8 buildDeviceParts", () => {
  it("joins ua, screen, timezone, language and the bucketed core count in order", () => {
    const parts = buildDeviceParts({
      userAgent: "Mozilla/5.0 (Test)",
      screenSize: "1920x1080",
      timeZone: "Asia/Dhaka",
      language: "bn-BD",
      hardwareConcurrency: 8,
    });
    expect(parts).toEqual(["Mozilla/5.0 (Test)", "1920x1080", "Asia/Dhaka", "bn-BD", "8"]);
    expect(parts.join("|")).toBe("Mozilla/5.0 (Test)|1920x1080|Asia/Dhaka|bn-BD|8");
  });

  it("express payload carries deviceHash only when one was computed", () => {
    expect(buildExpressPayload({ cartToken: "t", deviceHash: "abc123" }))
      .toEqual({ cartToken: "t", deviceHash: "abc123" });
    expect(buildExpressPayload({ cartToken: "t" })).toEqual({ cartToken: "t" });
  });

  it("missing signals become empty strings, never 'undefined'", () => {
    const parts = buildDeviceParts({
      userAgent: "",
      screenSize: "",
      timeZone: "",
      language: "",
      hardwareConcurrency: undefined,
    });
    expect(parts).toEqual(["", "", "", "", "0"]);
  });
});
