import { describe, expect, it } from "vitest";
import { bnDigits, coordsLabel, fixAgeLabel, RIDER_FIX_STALE_THRESHOLD_MS } from "./rider-gps";

// NF9 (FB4) — formatting helpers only; the stale DECISION is
// the server's (the payload's `stale` flag), pinned here only
// as the documented 5-minute threshold mirror.
describe("rider-gps lib", () => {
  it("the mirrored stale threshold is 5 minutes", () => {
    expect(RIDER_FIX_STALE_THRESHOLD_MS).toBe(5 * 60 * 1000);
  });

  it("age labels are Bengali and honest about unknown ages", () => {
    expect(fixAgeLabel(null)).toBe("সময় পাওয়া যায়নি");
    expect(fixAgeLabel(10_000)).toBe("সবেমাত্র");
    expect(fixAgeLabel(3 * 60_000)).toBe("৩ মিনিট আগে");
    expect(fixAgeLabel(2 * 3600_000)).toBe("২ ঘণ্টা আগে");
    expect(fixAgeLabel(26 * 3600_000)).toBe("১ দিন আগে");
  });

  it("digits and coordinates render verbatim", () => {
    expect(bnDigits(1042)).toBe("১০৪২");
    expect(coordsLabel({ lat: 23.8103, lng: 90.4125 })).toBe("23.8103, 90.4125");
  });
});
