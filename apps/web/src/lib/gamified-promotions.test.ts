import { describe, expect, it } from "vitest";
import {
  GROUP_BUY_NO_PREPAYMENT_NOTE,
  buildGroupBuyConfig,
  buildQuizConfig,
  buildWheelConfig,
  segmentSharePercent,
} from "./gamified-promotions";

// NF6 (FB3) — pure payload-builder pins: the dashboard forms
// must send exactly the config shapes the API validates.

describe("NF6 gamified promotions lib", () => {
  it("buildWheelConfig trims labels, zeroes the prize on none segments, keeps weights", () => {
    const cfg = buildWheelConfig(
      [
        { label: " ১০% ছাড় ", weight: 30, prizeKind: "percent", prizeValue: 10 },
        { label: "কিছু না", weight: 70, prizeKind: "none", prizeValue: 999 },
      ],
      48,
    );
    expect(cfg.couponExpiryHours).toBe(48);
    expect(cfg.segments[0]).toEqual({ label: "১০% ছাড়", weight: 30, prizeKind: "percent", prizeValue: 10 });
    expect(cfg.segments[1].prizeValue).toBe(0);
  });

  it("segmentSharePercent is a display share of total weight", () => {
    const segments = [
      { label: "a", weight: 25, prizeKind: "none" as const, prizeValue: 0 },
      { label: "b", weight: 75, prizeKind: "none" as const, prizeValue: 0 },
    ];
    expect(segmentSharePercent(segments, 0)).toBe(25);
    expect(segmentSharePercent(segments, 1)).toBe(75);
    expect(segmentSharePercent([{ label: "x", weight: 0, prizeKind: "none", prizeValue: 0 }], 0)).toBe(0);
  });

  it("buildQuizConfig maps each option to exactly one target (categoryId wins)", () => {
    const cfg = buildQuizConfig(
      [{ text: "কী খুঁজছেন?", options: [{ text: "শার্ট", categoryId: "cat-1", tagSlug: "shirt" }] }],
      { kind: "percent", value: 10 },
      72,
    );
    expect(cfg.questions[0].options[0]).toEqual({ text: "শার্ট", categoryId: "cat-1" });
    expect(cfg.completionCoupon).toEqual({ kind: "percent", value: 10 });
  });

  it("buildGroupBuyConfig floors requiredBuyers at 2 and the note promises no prepayment", () => {
    const cfg = buildGroupBuyConfig({
      productId: "p-1", requiredBuyers: 1, discountKind: "percent", discountValue: 15, couponExpiryHours: 72,
    });
    expect(cfg.requiredBuyers).toBe(2);
    expect(GROUP_BUY_NO_PREPAYMENT_NOTE).toContain("কোনো অগ্রিম পেমেন্ট নেওয়া হয় না");
  });
});
