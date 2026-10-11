import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_STATUS_META,
  CAMPAIGN_OBJECTIVES,
  getCampaignStatusBadge,
  getCampaignObjectiveMeta,
} from "./campaign-status";

describe("Campaign Status Helpers", () => {
  it("should have all standard lifecycle statuses defined", () => {
    const requiredStatuses = [
      "draft",
      "pending_approval",
      "approved",
      "rejected",
      "publishing",
      "published",
      "publish_failed",
    ];
    for (const st of requiredStatuses) {
      expect(CAMPAIGN_STATUS_META[st]).toBeDefined();
      expect(CAMPAIGN_STATUS_META[st]?.label.length).toBeGreaterThan(0);
      expect(CAMPAIGN_STATUS_META[st]?.badgeCls.length).toBeGreaterThan(0);
    }
  });

  it("should return fallback for unknown status", () => {
    const fallback = getCampaignStatusBadge("unknown_status_xyz");
    expect(fallback.label).toBe("unknown_status_xyz");
    expect(fallback.icon).toBe("•");
  });

  it("should have all 5 Meta objectives mapped", () => {
    const objectives = [
      "OUTCOME_SALES",
      "OUTCOME_LEADS",
      "OUTCOME_ENGAGEMENT",
      "OUTCOME_TRAFFIC",
      "OUTCOME_AWARENESS",
    ];
    for (const obj of objectives) {
      const meta = getCampaignObjectiveMeta(obj);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.icon.length).toBeGreaterThan(0);
    }
  });

  it("should return fallback for unknown objective", () => {
    const fallback = getCampaignObjectiveMeta("CUSTOM_OBJ");
    expect(fallback.label).toBe("CUSTOM_OBJ");
    expect(fallback.icon).toBe("🎯");
  });
});
