import { describe, expect, it } from "vitest";
import {
  isGroupEligibleForVerdict,
  findAbWinner,
  getVerdictLabel,
  MIN_SPEND_FOR_VERDICT_MINOR,
  AbVariantSummary,
} from "./ab-test-winner";

describe("A/B Test Winner Detection", () => {
  const variantA: AbVariantSummary = {
    planId: "plan-a",
    name: "Summer Campaign - Variant A",
    variant: "A",
    spendMinor: "15000", // ৳150
    platformConversions: 5,
    platformCpaMinor: "3000", // ৳30
    firstPartyOrders: 4,
    firstPartyCpaMinor: "3750", // ৳37.5
  };

  const variantB: AbVariantSummary = {
    planId: "plan-b",
    name: "Summer Campaign - Variant B (New Banner)",
    variant: "B",
    spendMinor: "20000", // ৳200
    platformConversions: 10,
    platformCpaMinor: "2000", // ৳20
    firstPartyOrders: 10,
    firstPartyCpaMinor: "2000", // ৳20
  };

  it("should enforce minimum spend threshold (10000 minor units / ৳100)", () => {
    const lowSpendVariant: AbVariantSummary = {
      ...variantA,
      spendMinor: "5000", // ৳50 - below minimum
    };
    expect(isGroupEligibleForVerdict([lowSpendVariant, variantB])).toBe(false);
  });

  it("should be eligible when both variants exceed minimum spend and have CPA", () => {
    expect(isGroupEligibleForVerdict([variantA, variantB])).toBe(true);
  });

  it("should identify lowest CPA variant as winner", () => {
    // Variant B has 2000 CPA vs Variant A's 3750 CPA -> Variant B wins
    const result = findAbWinner([variantA, variantB], "first_party_cpa");
    expect(result.winnerPlanId).toBe("plan-b");
    expect(result.verdict).toBe("winner_by_first_party_cpa");
  });

  it("should return insufficient_data when eligibility fails", () => {
    const freshVariant: AbVariantSummary = {
      ...variantA,
      firstPartyCpaMinor: null,
    };
    const result = findAbWinner([freshVariant, variantB]);
    expect(result.winnerPlanId).toBeNull();
    expect(result.verdict).toBe("insufficient_data");
  });

  it("should correctly format Bengali human-readable verdict labels", () => {
    expect(getVerdictLabel("winner_by_first_party_cpa").label).toContain("আসল অর্ডার");
    expect(getVerdictLabel("winner_by_platform_cpa").label).toContain("মেটা প্ল্যাটফর্ম");
    expect(getVerdictLabel("insufficient_data").label).toContain("পর্যাপ্ত ডেটা সংগ্রহ চলছে");
  });
});
