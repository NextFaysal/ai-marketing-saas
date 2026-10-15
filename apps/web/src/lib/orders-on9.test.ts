import { describe, expect, it } from "vitest";
import {
  buildAnalyticsPath, dhakaDayString, digestResultLabel, districtBarPct,
  formatMoneyMinor, formatPct, rangeForPreset,
} from "./orders-on9";

describe("ON9 range helpers", () => {
  it("dhakaDayString renders the Dhaka calendar day", () => {
    // 2026-10-14 20:30 UTC is already Oct 15 in Dhaka.
    expect(dhakaDayString(new Date("2026-10-14T20:30:00Z"))).toBe("2026-10-15");
    expect(dhakaDayString(new Date("2026-10-14T10:00:00Z"))).toBe("2026-10-14");
  });

  it("rangeForPreset goes back N-1 days from the Dhaka today", () => {
    const now = new Date("2026-10-14T06:00:00Z"); // Oct 14 in Dhaka
    expect(rangeForPreset(7, now)).toEqual({ from: "2026-10-08", to: "2026-10-14" });
    expect(rangeForPreset(30, now)).toEqual({ from: "2026-09-15", to: "2026-10-14" });
  });

  it("buildAnalyticsPath carries the range as query params", () => {
    expect(buildAnalyticsPath("org-1", "2026-10-01", "2026-10-07"))
      .toBe("/organizations/org-1/orders/analytics?from=2026-10-01&to=2026-10-07");
  });
});

describe("ON9 display shaping", () => {
  it("formatPct: null is an honest dash, numbers keep their value", () => {
    expect(formatPct(null)).toBe("—");
    expect(formatPct(undefined)).toBe("—");
    expect(formatPct(0)).toBe("0%");
    expect(formatPct(12.5)).toBe("12.5%");
  });

  it("formatMoneyMinor formats via the ON1 taka helper", () => {
    expect(formatMoneyMinor("200000")).toBe("৳2000");
    expect(formatMoneyMinor("150050")).toBe("৳1500.50");
    expect(formatMoneyMinor(null)).toBe("—");
  });

  it("districtBarPct is proportional to the top district", () => {
    expect(districtBarPct(10, 10)).toBe(100);
    expect(districtBarPct(5, 10)).toBe(50);
    expect(districtBarPct(0, 10)).toBe(0);
    expect(districtBarPct(3, 0)).toBe(0);
  });

  it("digestResultLabel names ok / no-phone skip / failure honestly", () => {
    expect(digestResultLabel({ userId: "u1", channel: "email", ok: true })).toContain("পাঠানো হয়েছে");
    expect(digestResultLabel({ userId: "u1", channel: "sms", ok: false, skipped: true, error: "no_phone_on_record" })).toContain("ফোন নম্বর রেকর্ডে নেই");
    expect(digestResultLabel({ userId: "u1", channel: "email", ok: false, error: "SMTP rejected" })).toContain("ব্যর্থ হয়েছে");
  });
});
