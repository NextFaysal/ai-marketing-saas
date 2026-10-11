import { followUpSuggestions } from "./suggestions";
import { keywordPlan } from "./planner";

describe("followUpSuggestions (M45, deterministic)", () => {
  it("derives suggestions from the tools that actually ran", () => {
    const s = followUpSuggestions(["get_analytics_overview"], "bn");
    expect(s.length).toBe(3);
    expect(s.join(" ")).toContain("তুলনা");
  });
  it("works in English", () => {
    const s = followUpSuggestions(["get_campaign_performance"], "en");
    expect(s.length).toBeGreaterThan(0);
    expect(s.every((x) => !/[\u0980-\u09FF]/.test(x))).toBe(true);
  });
  it("falls back to the generic set when no tool ran, with no duplicates and a cap of 3", () => {
    const s = followUpSuggestions([], "bn");
    expect(s.length).toBe(3);
    expect(new Set(s).size).toBe(s.length);
    const many = followUpSuggestions(["get_analytics_overview", "get_campaign_performance", "get_anomalies", "list_products"], "en");
    expect(many.length).toBe(3);
    expect(new Set(many).size).toBe(3);
  });
  it("every Bengali suggestion maps back to a real read-only tool via the keyword planner", () => {
    const tools = ["get_analytics_overview", "get_campaign_performance", "get_attribution_report", "list_products", "get_orders_attention", "get_anomalies", "get_business_knowledge"];
    for (const tool of tools) {
      for (const s of followUpSuggestions([tool], "bn")) {
        expect(keywordPlan(s).length).toBeGreaterThan(0);
      }
    }
  });
});
