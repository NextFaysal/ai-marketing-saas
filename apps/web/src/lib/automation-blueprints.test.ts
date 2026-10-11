import { describe, expect, it } from "vitest";
import {
  SCHEDULED_JOB_BLUEPRINTS,
  AD_RULE_BLUEPRINTS,
  ALL_AUTOMATION_BLUEPRINTS,
} from "./automation-blueprints";

describe("Automation Blueprints Catalog", () => {
  it("should have scheduled job blueprints and ad rule blueprints", () => {
    expect(SCHEDULED_JOB_BLUEPRINTS.length).toBeGreaterThanOrEqual(10);
    expect(AD_RULE_BLUEPRINTS.length).toBeGreaterThanOrEqual(10);
    expect(ALL_AUTOMATION_BLUEPRINTS.length).toBe(
      SCHEDULED_JOB_BLUEPRINTS.length + AD_RULE_BLUEPRINTS.length
    );
  });

  it("should have unique keys across all blueprints", () => {
    const keys = new Set<string>();
    for (const bp of ALL_AUTOMATION_BLUEPRINTS) {
      expect(keys.has(bp.key)).toBe(false);
      keys.add(bp.key);
    }
  });

  it("should validate all scheduled job blueprints have required fields", () => {
    const validTargetKinds = new Set(["org", "integration", "account", "competitor"]);
    for (const job of SCHEDULED_JOB_BLUEPRINTS) {
      expect(job.kind).toBe("job");
      expect(job.name.trim().length).toBeGreaterThan(0);
      expect(job.problemBn.trim().length).toBeGreaterThan(0);
      expect(job.solutionBn.trim().length).toBeGreaterThan(0);
      expect(job.impactBn.trim().length).toBeGreaterThan(0);
      expect(job.type.trim().length).toBeGreaterThan(0);
      expect(validTargetKinds.has(job.targetKind)).toBe(true);
      expect(job.defaultIntervalMinutes).toBeGreaterThanOrEqual(5);
    }
  });

  it("should validate all ad rule blueprints have valid metric, comparator, and action", () => {
    const validComparators = new Set(["gt", "lt"]);
    const validActions = new Set(["pause_campaign", "alert", "activate_campaign", "scale_budget", "pause_ad"]);

    for (const rule of AD_RULE_BLUEPRINTS) {
      expect(rule.kind).toBe("rule");
      expect(rule.name.trim().length).toBeGreaterThan(0);
      expect(rule.problemBn.trim().length).toBeGreaterThan(0);
      expect(rule.solutionBn.trim().length).toBeGreaterThan(0);
      expect(rule.impactBn.trim().length).toBeGreaterThan(0);
      expect(rule.metric.trim().length).toBeGreaterThan(0);
      expect(validComparators.has(rule.comparator)).toBe(true);
      expect(validActions.has(rule.action)).toBe(true);
      expect(rule.windowDays).toBeGreaterThanOrEqual(1);
      expect(rule.threshold.trim().length).toBeGreaterThan(0);
    }
  });
});
