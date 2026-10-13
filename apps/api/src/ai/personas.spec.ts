import { PERSONAS, PERSONA_IDS, personaAllowsModule, personaById } from "./personas";
import { TOOL_CATALOG } from "./planner";

describe("AP7 personas", () => {
  it("registry is consistent: unique ids, every scoped module exists in the tool registry", () => {
    expect(new Set(PERSONA_IDS).size).toBe(PERSONA_IDS.length);
    const modules = new Set(TOOL_CATALOG.map((t) => t.module));
    for (const p of PERSONAS) {
      for (const m of p.modules ?? []) expect(modules.has(m)).toBe(true);
      if (p.id !== "general") expect(p.focus.length).toBeGreaterThan(20);
    }
  });
  it("general allows everything; specialists are scoped", () => {
    expect(personaAllowsModule("general", "team")).toBe(true);
    expect(personaAllowsModule("ads_analyst", "ads")).toBe(true);
    expect(personaAllowsModule("ads_analyst", "inbox")).toBe(false);
    expect(personaAllowsModule("inbox_coach", "inbox")).toBe(true);
    expect(personaAllowsModule("inbox_coach", "billing")).toBe(false);
    expect(personaAllowsModule("finance_analyst", "billing")).toBe(true);
    expect(personaAllowsModule("finance_analyst", "social")).toBe(false);
    expect(personaById("nope").id).toBe("general");
  });
});
