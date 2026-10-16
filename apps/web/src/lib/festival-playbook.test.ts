import { describe, it, expect } from "vitest";
import {
  FESTIVAL_PLAYBOOKS,
  calculateCourierCutoff,
  generateFestivalAdCopy,
  type FestivalKey,
} from "./festival-playbook";

describe("Festival Playbook engine & BD courier calculators", () => {
  it("provides all 7 essential Bangladeshi festival playbooks with phases and niches", () => {
    const keys: FestivalKey[] = [
      "eid_ul_fitr",
      "eid_ul_adha",
      "pohela_boishakh",
      "durga_puja",
      "winter_clearance",
      "black_friday_11_11",
      "falgun_valentin",
    ];

    for (const key of keys) {
      const p = FESTIVAL_PLAYBOOKS[key];
      expect(p).toBeDefined();
      expect(p.name).toBeTruthy();
      expect(p.icon).toBeTruthy();
      expect(p.targetNiches.length).toBeGreaterThanOrEqual(3);
      expect(p.phases.length).toBeGreaterThanOrEqual(1);
      expect(p.adCopies.length).toBeGreaterThanOrEqual(1);
      expect(p.suggestedDailyBudgetBDT).toBeGreaterThan(0);
      expect(
        p.budgetSplit.prospectingPercent +
          p.budgetSplit.engagementPercent +
          p.budgetSplit.retargetingPercent
      ).toBe(100);
    }
  });

  it("calculates courier cutoff dates and days remaining accurately before cutoff", () => {
    // Current date: 2026-10-16
    const currentDate = new Date("2026-10-16T12:00:00Z");
    // Target festival: 10 days later -> 2026-10-26
    const festivalDate = new Date("2026-10-26T00:00:00Z");

    const result = calculateCourierCutoff(
      "শারদীয় দুর্গাপূজা",
      festivalDate,
      5, // 5 days lead for outside Dhaka -> 2026-10-21
      2, // 2 days lead for inside Dhaka -> 2026-10-24
      currentDate
    );

    expect(result.isOutsideDeadlinePassed).toBe(false);
    expect(result.isInsideDeadlinePassed).toBe(false);
    expect(result.daysRemainingOutside).toBeGreaterThanOrEqual(4);
    expect(result.urgencyAdCopy).toContain("কুরিয়ার কাট-অফ এলার্ট");
    expect(result.urgencyAdCopy).toContain("ঢাকার বাইরে");
    expect(result.smsBroadcastCopy).toContain("শারদীয় দুর্গাপূজা");
  });

  it("handles urgency copy when outside Dhaka cutoff has passed", () => {
    // Current date: 2026-10-23
    const currentDate = new Date("2026-10-23T12:00:00Z");
    // Festival date: 2026-10-26 (Outside cutoff was 2026-10-21, which passed)
    const festivalDate = new Date("2026-10-26T00:00:00Z");

    const result = calculateCourierCutoff(
      "শারদীয় দুর্গাপূজা",
      festivalDate,
      5,
      2,
      currentDate
    );

    expect(result.isOutsideDeadlinePassed).toBe(true);
    expect(result.urgencyAdCopy).toContain("শুধুমাত্র ঢাকা মেট্রোর জন্য");
    expect(result.smsBroadcastCopy).toContain("ঢাকা সিটিতে ২৪ ঘণ্টায় এক্সপ্রেস");
  });

  it("generates personalized festival ad copy with product and offer", () => {
    const copy = generateFestivalAdCopy(
      "eid_ul_fitr",
      "প্রিমিয়াম কটন পাঞ্জাবি",
      "১৫% ছাড় + ফ্রি ডেলিভারি"
    );

    expect(copy.headline).toContain("🌙 প্রিমিয়াম কটন পাঞ্জাবি — ঈদ-উল-ফিতর মেগা সেল স্পেশাল অফার!");
    expect(copy.primaryText).toContain("ঈদ-উল-ফিতর মেগা সেল উপলক্ষে প্রিমিয়াম কটন পাঞ্জাবি-এ চলছে ১৫% ছাড় + ফ্রি ডেলিভারি!");
    expect(copy.primaryText).toContain("ক্যাশ অন ডেলিভারিতে");
    expect(copy.callToAction).toBe("SHOP_NOW");
  });
});
