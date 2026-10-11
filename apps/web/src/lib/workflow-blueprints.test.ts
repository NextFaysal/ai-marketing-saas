import { describe, expect, it } from "vitest";
import { WORKFLOW_BLUEPRINTS_CATALOG } from "./workflow-blueprints";

describe("WORKFLOW_BLUEPRINTS_CATALOG", () => {
  it("should contain at least 100 problem-based blueprints", () => {
    expect(WORKFLOW_BLUEPRINTS_CATALOG.length).toBeGreaterThanOrEqual(100);
  });

  it("should have unique keys across all blueprints", () => {
    const keys = new Set<string>();
    for (const bp of WORKFLOW_BLUEPRINTS_CATALOG) {
      expect(keys.has(bp.key)).toBe(false);
      keys.add(bp.key);
    }
    expect(keys.size).toBe(WORKFLOW_BLUEPRINTS_CATALOG.length);
  });

  it("should validate that every blueprint has valid problem, solution, impact, and pipeline steps", () => {
    const validCategories = new Set(["ecommerce", "courier", "leads", "inbox", "ai", "ops", "schedule"]);
    for (const bp of WORKFLOW_BLUEPRINTS_CATALOG) {
      expect(bp.name.trim().length).toBeGreaterThan(0);
      expect(bp.problemBn.trim().length).toBeGreaterThan(0);
      expect(bp.solutionBn.trim().length).toBeGreaterThan(0);
      expect(bp.impactBn.trim().length).toBeGreaterThan(0);
      expect(validCategories.has(bp.category)).toBe(true);
      expect(bp.trigger.trim().length).toBeGreaterThan(0);
      expect(Array.isArray(bp.steps)).toBe(true);
      expect(bp.steps.length).toBeGreaterThan(0);

      for (const step of bp.steps) {
        expect(typeof step.type).toBe("string");
        expect(step.type.length).toBeGreaterThan(0);
      }
    }
  });

  it("should cover all 7 key problem domains", () => {
    const counts = WORKFLOW_BLUEPRINTS_CATALOG.reduce<Record<string, number>>((acc, bp) => {
      acc[bp.category] = (acc[bp.category] || 0) + 1;
      return acc;
    }, {});

    expect(counts["ecommerce"]).toBeGreaterThanOrEqual(15);
    expect(counts["courier"]).toBeGreaterThanOrEqual(10);
    expect(counts["leads"]).toBeGreaterThanOrEqual(10);
    expect(counts["inbox"]).toBeGreaterThanOrEqual(10);
    expect(counts["ai"]).toBeGreaterThanOrEqual(10);
    expect(counts["ops"]).toBeGreaterThanOrEqual(10);
    expect(counts["schedule"]).toBeGreaterThanOrEqual(8);
  });
});
