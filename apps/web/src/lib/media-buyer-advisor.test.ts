import { describe, expect, it } from "vitest";
import {
  generateMediaBuyerRecommendations,
  PlanMetricInput,
} from "./media-buyer-advisor";

describe("Predictive AI Media Buyer Advisor", () => {
  const basePlan: PlanMetricInput = {
    id: "plan-1",
    name: "Summer Collection 2026",
    status: "published",
    metaStatus: "ACTIVE",
    performance: {
      spendMinor: "15000",
      impressions: 2500,
      clicks: 80,
      conversions: 3,
      ctrPercent: 3.2,
      cpaMinor: "5000",
    },
  };

  it("should detect creative fatigue and recommend creative refresh", () => {
    const fatiguedPlan: PlanMetricInput = {
      ...basePlan,
      fatigue: {
        frequency: 3.8,
        ctrDropPercent: 35,
        fatigued: true,
      },
    };

    const recs = generateMediaBuyerRecommendations([fatiguedPlan]);
    expect(recs.length).toBeGreaterThan(0);
    const fatigueRec = recs.find((r) => r.type === "creative_refresh");
    expect(fatigueRec).toBeDefined();
    expect(fatigueRec?.severity).toBe("high");
    expect(fatigueRec?.actionUrl).toContain("/dashboard/creative-studio");
  });

  it("should detect budget leak on zero-conversion high spend campaigns", () => {
    const leakingPlan: PlanMetricInput = {
      ...basePlan,
      performance: {
        spendMinor: "25000", // ৳250 spent
        impressions: 3000,
        clicks: 40,
        conversions: 0, // 0 orders!
        ctrPercent: 1.3,
        cpaMinor: null,
      },
    };

    const recs = generateMediaBuyerRecommendations([leakingPlan]);
    const leakRec = recs.find((r) => r.type === "pause_loss");
    expect(leakRec).toBeDefined();
    expect(leakRec?.severity).toBe("high");
    expect(leakRec?.proposalType).toBe("pause_campaign");
  });

  it("should recommend budget scale for high-performing campaigns", () => {
    const winningPlan: PlanMetricInput = {
      ...basePlan,
      performance: {
        spendMinor: "18000",
        impressions: 4000,
        clicks: 120,
        conversions: 6, // 6 orders!
        ctrPercent: 3.0,
        cpaMinor: "3000",
      },
    };

    const recs = generateMediaBuyerRecommendations([winningPlan]);
    const scaleRec = recs.find((r) => r.type === "scale_budget");
    expect(scaleRec).toBeDefined();
    expect(scaleRec?.severity).toBe("opportunity");
    expect(scaleRec?.suggestedActionLabel).toContain("বাজেট বাড়ান");
  });

  it("should return empty list when no campaigns meet warning/scaling criteria", () => {
    const draftPlan: PlanMetricInput = {
      ...basePlan,
      status: "draft",
      metaStatus: null,
      performance: null,
    };
    const recs = generateMediaBuyerRecommendations([draftPlan]);
    expect(recs.length).toBe(0);
  });
});
