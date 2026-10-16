import { describe, expect, it } from "vitest";
import {
  canShowSocialProof,
  parseShownCount,
  socialProofDismissedKey,
  socialProofFeedFromPayload,
  socialProofItemAt,
  socialProofLines,
  socialProofShownKey,
  type SocialProofItem,
} from "./shop-social-proof";

/**
 * AB7 (AX17) — social-proof rules. Pinned: a disabled/empty
 * feed normalizes to null (render nothing), the session cap
 * and the dismissed flag both stop rotation, items wrap, and
 * the Bengali line format is exact (hoursAgo 0 = "কিছুক্ষণ আগে").
 */

const ITEM: SocialProofItem = {
  buyerFirstName: "রহিম",
  district: "চট্টগ্রাম",
  productName: "পাঞ্জাবি",
  hoursAgo: 3,
};

describe("socialProofFeedFromPayload", () => {
  it("normalizes an enabled feed with config + items", () => {
    const feed = socialProofFeedFromPayload({
      enabled: true,
      config: { intervalSec: 10, displaySec: 4, maxPerSession: 2 },
      items: [{ buyerFirstName: "রহিম", district: "চট্টগ্রাম", productName: "পাঞ্জাবি", hoursAgo: 3 }],
    });
    expect(feed?.config).toEqual({ intervalSec: 10, displaySec: 4, maxPerSession: 2 });
    expect(feed?.items).toEqual([ITEM]);
  });

  it("returns null when disabled, empty, or malformed", () => {
    expect(socialProofFeedFromPayload({ enabled: false })).toBeNull();
    expect(socialProofFeedFromPayload({ enabled: true, config: {}, items: [] })).toBeNull();
    expect(socialProofFeedFromPayload(null)).toBeNull();
    expect(socialProofFeedFromPayload("nope")).toBeNull();
    expect(
      socialProofFeedFromPayload({ enabled: true, items: [{ buyerFirstName: "", productName: "x" }] }),
    ).toBeNull();
  });

  it("drops unusable items, keeps usable ones, defaults config", () => {
    const feed = socialProofFeedFromPayload({
      enabled: true,
      items: [
        { buyerFirstName: "করিম", productName: "", hoursAgo: 1 },
        { buyerFirstName: "করিম", productName: "শাড়ি", hoursAgo: -2 },
        null,
        "junk",
      ],
    });
    expect(feed?.items).toEqual([
      { buyerFirstName: "করিম", district: null, productName: "শাড়ি", hoursAgo: 0 },
    ]);
    expect(feed?.config.maxPerSession).toBeGreaterThan(0);
  });
});

describe("session cap logic", () => {
  it("parseShownCount tolerates corruption", () => {
    expect(parseShownCount("3")).toBe(3);
    expect(parseShownCount("abc")).toBe(0);
    expect(parseShownCount(null)).toBe(0);
    expect(parseShownCount("-1")).toBe(0);
  });

  it("canShowSocialProof stops at the cap and on dismissal", () => {
    const base = { shownCount: 0, maxPerSession: 3, dismissed: false, itemCount: 2 };
    expect(canShowSocialProof(base)).toBe(true);
    expect(canShowSocialProof({ ...base, shownCount: 2 })).toBe(true);
    expect(canShowSocialProof({ ...base, shownCount: 3 })).toBe(false);
    expect(canShowSocialProof({ ...base, shownCount: 9 })).toBe(false);
    expect(canShowSocialProof({ ...base, dismissed: true })).toBe(false);
    expect(canShowSocialProof({ ...base, itemCount: 0 })).toBe(false);
  });

  it("storage keys are per-org", () => {
    expect(socialProofShownKey("a")).toBe("shop-social-proof-shown:a");
    expect(socialProofDismissedKey("a")).toBe("shop-social-proof-dismissed:a");
    expect(socialProofShownKey("a")).not.toBe(socialProofShownKey("b"));
  });

  it("rotation wraps through the items", () => {
    const items = [ITEM, { ...ITEM, buyerFirstName: "করিম" }];
    expect(socialProofItemAt(items, 0)?.buyerFirstName).toBe("রহিম");
    expect(socialProofItemAt(items, 1)?.buyerFirstName).toBe("করিম");
    expect(socialProofItemAt(items, 2)?.buyerFirstName).toBe("রহিম");
    expect(socialProofItemAt([], 0)).toBeNull();
  });
});

describe("socialProofLines", () => {
  it("formats buyer, product, district and hours", () => {
    expect(socialProofLines(ITEM)).toEqual({
      main: "রহিম কিনেছেন — পাঞ্জাবি",
      sub: "চট্টগ্রাম থেকে · ৩ ঘণ্টা আগে",
    });
  });
  it("omits the district segment when null", () => {
    expect(socialProofLines({ ...ITEM, district: null }).sub).toBe("৩ ঘণ্টা আগে");
  });
  it("hoursAgo 0 reads as কিছুক্ষণ আগে", () => {
    expect(socialProofLines({ ...ITEM, hoursAgo: 0 }).sub).toBe("চট্টগ্রাম থেকে · কিছুক্ষণ আগে");
  });
});
