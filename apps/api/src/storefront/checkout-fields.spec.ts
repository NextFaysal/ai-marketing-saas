import {
  CHECKOUT_FIELD_SURFACES,
  CHECKOUT_FIELD_TYPES,
  defsForSurface,
  publicFieldDef,
  validateFieldAnswers,
} from "./checkout-fields";

/**
 * AB4 (AX5b) — pure checkout-field helper matrix:
 * validateFieldAnswers + defsForSurface + publicFieldDef.
 * (The helper itself is the coordinator's; this spec pins its
 * contract so the placement wiring and the staff CRUD agree.)
 */
describe("AB4 checkout-fields helpers", () => {
  const defs: any[] = [
    { key: "district_note", label: "জেলার নোট", type: "text", required: false, appliesTo: "shop", active: true, sortOrder: 2 },
    { key: "delivery_area", label: "ডেলিভারি এলাকা", type: "select", options: ["ঢাকার ভিতরে", "ঢাকার বাইরে"], required: true, appliesTo: "all", active: true, sortOrder: 1 },
    { key: "gift_wrap", label: "উপহারের মোড়ক", type: "checkbox", required: false, appliesTo: "all", active: true, sortOrder: 3 },
    { key: "agree_call", label: "কল করে নিশ্চিত করুন", type: "checkbox", required: true, appliesTo: "landing", active: true, sortOrder: 1 },
    { key: "long_note", label: "বিস্তারিত নোট", type: "textarea", required: false, appliesTo: "single", active: true, sortOrder: 1 },
    { key: "retired_field", label: "পুরনো ফিল্ড", type: "text", required: true, appliesTo: "all", active: false, sortOrder: 0 },
  ];

  it("exposes the type/surface vocabularies", () => {
    expect(CHECKOUT_FIELD_TYPES).toEqual(["text", "textarea", "select", "checkbox"]);
    expect(CHECKOUT_FIELD_SURFACES).toEqual(["shop", "single", "landing", "all"]);
  });

  describe("defsForSurface", () => {
    it("filters by surface + 'all', drops inactive, orders by sortOrder then key", () => {
      const shop = defsForSurface(defs, "shop");
      expect(shop.map((d) => d.key)).toEqual(["delivery_area", "district_note", "gift_wrap"]);
      const landing = defsForSurface(defs, "landing");
      expect(landing.map((d) => d.key)).toEqual(["agree_call", "delivery_area", "gift_wrap"]);
      // sortOrder tie (both 1 on landing) breaks by key.
      expect(landing[0].key).toBe("agree_call");
      const single = defsForSurface(defs, "single");
      expect(single.map((d) => d.key)).toEqual(["delivery_area", "long_note", "gift_wrap"]);
    });

    it("tolerates null/undefined def lists", () => {
      expect(defsForSurface(null, "shop")).toEqual([]);
      expect(defsForSurface(undefined, "shop")).toEqual([]);
    });
  });

  describe("publicFieldDef", () => {
    it("shapes the public def: options as strings, required as a strict boolean", () => {
      expect(publicFieldDef(defs[1])).toEqual({
        key: "delivery_area", label: "ডেলিভারি এলাকা", type: "select",
        options: ["ঢাকার ভিতরে", "ঢাকার বাইরে"], required: true,
      });
      expect(publicFieldDef({ key: "x", label: "X", type: "text", options: null, required: null })).toEqual({
        key: "x", label: "X", type: "text", options: [], required: false,
      });
    });
  });

  describe("validateFieldAnswers", () => {
    it("accepts a valid shop answer set, trims text, and returns only validated values", () => {
      const out = validateFieldAnswers(defs, "shop", {
        delivery_area: " ঢাকার ভিতরে ",
        district_note: "  বাসার পাশে  ",
        gift_wrap: "true",
      });
      expect(out).toEqual({
        ok: true,
        values: { delivery_area: "ঢাকার ভিতরে", district_note: "বাসার পাশে", gift_wrap: true },
      });
    });

    it("rejects an UNKNOWN key (never silently dropped)", () => {
      const out = validateFieldAnswers(defs, "shop", { delivery_area: "ঢাকার ভিতরে", mystery: "x" });
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.error).toContain("mystery");
    });

    it("rejects a key whose def is INACTIVE (inactive defs are ignored entirely)", () => {
      const out = validateFieldAnswers(defs, "shop", { delivery_area: "ঢাকার ভিতরে", retired_field: "x" });
      expect(out.ok).toBe(false);
    });

    it("rejects a missing REQUIRED field; an inactive required def imposes nothing", () => {
      const missing = validateFieldAnswers(defs, "shop", { district_note: "নোট" });
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.error).toContain("ডেলিভারি এলাকা");
      // retired_field is required but inactive: a bare valid set passes.
      expect(validateFieldAnswers(defs, "shop", { delivery_area: "ঢাকার বাইরে" }).ok).toBe(true);
      // Whitespace-only counts as missing.
      expect(validateFieldAnswers(defs, "shop", { delivery_area: "   " }).ok).toBe(false);
    });

    it("rejects a select value outside the def's options", () => {
      const out = validateFieldAnswers(defs, "shop", { delivery_area: "চট্টগ্রাম" });
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.error).toContain("তালিকার বাইরে");
    });

    it("checkbox coercions: boolean / 'true' / 'false' only", () => {
      const base = { delivery_area: "ঢাকার ভিতরে" };
      expect(validateFieldAnswers(defs, "shop", { ...base, gift_wrap: true })).toEqual({
        ok: true, values: { ...base, gift_wrap: true },
      });
      expect(validateFieldAnswers(defs, "shop", { ...base, gift_wrap: "false" })).toEqual({
        ok: true, values: { ...base, gift_wrap: false },
      });
      expect(validateFieldAnswers(defs, "shop", { ...base, gift_wrap: "yes" }).ok).toBe(false);
      expect(validateFieldAnswers(defs, "shop", { ...base, gift_wrap: 1 }).ok).toBe(false);
    });

    it("a REQUIRED checkbox must end up true (false / missing both rejected)", () => {
      const base = { delivery_area: "ঢাকার ভিতরে" };
      expect(validateFieldAnswers(defs, "landing", { ...base, agree_call: false }).ok).toBe(false);
      expect(validateFieldAnswers(defs, "landing", { ...base, agree_call: "false" }).ok).toBe(false);
      expect(validateFieldAnswers(defs, "landing", base).ok).toBe(false);
      expect(validateFieldAnswers(defs, "landing", { ...base, agree_call: true }).ok).toBe(true);
    });

    it("surface filtering: a landing-only required field is not demanded on shop, and vice versa", () => {
      // agree_call (landing, required) is not part of the shop surface.
      expect(validateFieldAnswers(defs, "shop", { delivery_area: "ঢাকার ভিতরে", agree_call: true }).ok).toBe(false);
      // long_note is single-only: unknown on shop, valid on single.
      expect(validateFieldAnswers(defs, "shop", { delivery_area: "ঢাকার ভিতরে", long_note: "x" }).ok).toBe(false);
      expect(validateFieldAnswers(defs, "single", { delivery_area: "ঢাকার ভিতরে", long_note: "x" }).ok).toBe(true);
    });

    it("text is length-capped (1000) and textarea at 4000; non-string text is rejected", () => {
      const base = { delivery_area: "ঢাকার ভিতরে" };
      expect(validateFieldAnswers(defs, "shop", { ...base, district_note: "a".repeat(1000) }).ok).toBe(true);
      expect(validateFieldAnswers(defs, "shop", { ...base, district_note: "a".repeat(1001) }).ok).toBe(false);
      expect(validateFieldAnswers(defs, "single", { ...base, long_note: "a".repeat(4000) }).ok).toBe(true);
      expect(validateFieldAnswers(defs, "single", { ...base, long_note: "a".repeat(4001) }).ok).toBe(false);
      expect(validateFieldAnswers(defs, "shop", { ...base, district_note: 42 }).ok).toBe(false);
    });

    it("optional missing fields are simply absent from the values (no null stuffing)", () => {
      const out = validateFieldAnswers(defs, "shop", { delivery_area: "ঢাকার ভিতরে" });
      expect(out).toEqual({ ok: true, values: { delivery_area: "ঢাকার ভিতরে" } });
    });

    it("a non-object answers payload validates as empty (required fields then fail)", () => {
      expect(validateFieldAnswers(defs, "shop", null).ok).toBe(false);
      expect(validateFieldAnswers(defs, "shop", "nope").ok).toBe(false);
      expect(validateFieldAnswers([], "shop", null)).toEqual({ ok: true, values: {} });
    });
  });
});
