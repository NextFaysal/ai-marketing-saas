import { CustomFieldsService, slugifyFieldKey, validateCustomFieldValue } from "./custom-fields.service";

function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object") return true;
    return row[k] === v;
  });
}
function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    create: async ({ data }: any) => { const row = { id: `def-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); Object.assign(row, data); return row; },
  };
}
function svc() {
  const prisma = { customFieldDef: makeTable() };
  return { prisma, fields: new CustomFieldsService(prisma as any) };
}

describe("slugifyFieldKey", () => {
  it("derives keys from labels", () => {
    expect(slugifyFieldKey("District / Area")).toBe("district_area");
    expect(slugifyFieldKey("  Preferred  Product ")).toBe("preferred_product");
    expect(slugifyFieldKey("FB Page")).toBe("fb_page");
  });
});

describe("CustomFieldsService defs (CRM C4)", () => {
  it("creates a def with a label-derived key; select options cleaned + deduped", async () => {
    const { fields } = svc();
    const def = await fields.createDef("org-1", { entity: "lead", label: "এলাকা (District)", type: "select", options: [" ঢাকা ", "ঢাকা", "খুলনা", ""] });
    expect(def.key).toBe("district");
    expect(def.options).toEqual(["ঢাকা", "খুলনা"]);
    expect(def.required).toBe(false);
  });

  it("forces options to null for non-select types and rejects empty select options", async () => {
    const { fields } = svc();
    const text = await fields.createDef("org-1", { entity: "lead", label: "Note Field", type: "text", options: ["x"] as any });
    expect(text.options).toBeNull();
    await expect(fields.createDef("org-1", { entity: "lead", label: "Empty Select", type: "select", options: [] }))
      .rejects.toThrow("at least one option");
  });

  it("rejects duplicate keys — including against archived defs — and bad entity/type/key", async () => {
    const { fields } = svc();
    const def = await fields.createDef("org-1", { entity: "customer", label: "City", type: "text" });
    await fields.archiveDef("org-1", def.id);
    await expect(fields.createDef("org-1", { entity: "customer", label: "City", type: "text" })).rejects.toThrow("already exists");
    await expect(fields.createDef("org-1", { entity: "order" as any, label: "X", type: "text" })).rejects.toThrow("Invalid entity");
    await expect(fields.createDef("org-1", { entity: "lead", label: "X", type: "boolean" as any })).rejects.toThrow("Invalid field type");
    await expect(fields.createDef("org-1", { entity: "lead", key: "9bad", label: "X", type: "text" })).rejects.toThrow("Invalid field key");
    // Same key on the OTHER entity is fine.
    const other = await fields.createDef("org-1", { entity: "lead", label: "City", type: "text" });
    expect(other.key).toBe("city");
  });

  it("key is immutable after create; label/required/sortOrder/archive are editable", async () => {
    const { fields } = svc();
    const def = await fields.createDef("org-1", { entity: "lead", label: "Source Detail", type: "text" });
    await expect(fields.updateDef("org-1", def.id, { key: "other_key" })).rejects.toThrow("cannot be changed");
    const updated = await fields.updateDef("org-1", def.id, { label: "বিস্তারিত", required: true, sortOrder: 3 });
    expect(updated).toMatchObject({ label: "বিস্তারিত", required: true, sortOrder: 3, key: "source_detail" });
    const archived = await fields.updateDef("org-1", def.id, { archived: true });
    expect(archived.archivedAt).toBeTruthy();
    expect(await fields.activeDefs("org-1", "lead")).toHaveLength(0);
    const back = await fields.updateDef("org-1", def.id, { archived: false });
    expect(back.archivedAt).toBeNull();
  });

  it("defs are org-scoped: another org sees and touches nothing", async () => {
    const { fields } = svc();
    const def = await fields.createDef("org-1", { entity: "lead", label: "Secret", type: "text" });
    expect(await fields.listDefs("org-2")).toHaveLength(0);
    await expect(fields.updateDef("org-2", def.id, { label: "Hacked" })).rejects.toThrow("not found");
  });
});

describe("validateCustomFieldValue (CRM C4 matrix)", () => {
  const text = { label: "নোট", type: "text", options: null };
  const num = { label: "বাজেট", type: "number", options: null };
  const date = { label: "তারিখ", type: "date", options: null };
  const sel = { label: "এলাকা", type: "select", options: ["ঢাকা", "খুলনা"] };

  it("text: trims, rejects non-strings and >500 chars", () => {
    expect(validateCustomFieldValue(text, "  hello  ")).toBe("hello");
    expect(() => validateCustomFieldValue(text, 42)).toThrow(/must be text/);
    expect(() => validateCustomFieldValue(text, "x".repeat(501))).toThrow(/too long/);
  });

  it("number: accepts numbers and numeric strings, stores a number; rejects the rest", () => {
    expect(validateCustomFieldValue(num, 42)).toBe(42);
    expect(validateCustomFieldValue(num, " 1250.50 ")).toBe(1250.5);
    expect(() => validateCustomFieldValue(num, "abc")).toThrow(/must be a number/);
    expect(() => validateCustomFieldValue(num, true)).toThrow(/must be a number/);
    expect(() => validateCustomFieldValue(num, NaN)).toThrow(/must be a number/);
  });

  it("date: only real YYYY-MM-DD calendar dates", () => {
    expect(validateCustomFieldValue(date, "2026-10-20")).toBe("2026-10-20");
    expect(() => validateCustomFieldValue(date, "2026-02-30")).toThrow(/YYYY-MM-DD/);
    expect(() => validateCustomFieldValue(date, "20-10-2026")).toThrow(/YYYY-MM-DD/);
    expect(() => validateCustomFieldValue(date, "2026-10-20T00:00:00Z")).toThrow(/YYYY-MM-DD/);
  });

  it("select: value must be one of the options", () => {
    expect(validateCustomFieldValue(sel, "ঢাকা")).toBe("ঢাকা");
    expect(() => validateCustomFieldValue(sel, "চট্টগ্রাম")).toThrow(/must be one of/);
  });
});

describe("validateAndSanitize (CRM C4)", () => {
  async function setup() {
    const { prisma, fields } = svc();
    await fields.createDef("org-1", { entity: "lead", label: "District", type: "select", options: ["ঢাকা", "খুলনা"], required: true });
    await fields.createDef("org-1", { entity: "lead", label: "Budget", type: "number" });
    const old = await fields.createDef("org-1", { entity: "lead", label: "Old Field", type: "text" });
    await fields.archiveDef("org-1", old.id);
    return { prisma, fields };
  }

  it("sanitizes known keys; null and empty string are clear markers", async () => {
    const { fields } = await setup();
    const out = await fields.validateAndSanitize("org-1", "lead", { district: "ঢাকা", budget: "5000" }, { forCreate: true });
    expect(out).toEqual({ district: "ঢাকা", budget: 5000 });
    const cleared = await fields.validateAndSanitize("org-1", "lead", { budget: null, district: "ঢাকা" }, {});
    expect(cleared).toEqual({ budget: null, district: "ঢাকা" });
  });

  it("unknown keys 400 — including keys of archived defs", async () => {
    const { fields } = await setup();
    await expect(fields.validateAndSanitize("org-1", "lead", { nope: "x" }, {})).rejects.toThrow('Unknown custom field: "nope"');
    await expect(fields.validateAndSanitize("org-1", "lead", { old_field: "x" }, {})).rejects.toThrow('Unknown custom field: "old_field"');
  });

  it("type mismatch 400s naming the label", async () => {
    const { fields } = await setup();
    await expect(fields.validateAndSanitize("org-1", "lead", { budget: "lots" }, {})).rejects.toThrow('"Budget" must be a number');
  });

  it("required is enforced on create only", async () => {
    const { fields } = await setup();
    await expect(fields.validateAndSanitize("org-1", "lead", {}, { forCreate: true })).rejects.toThrow('"District" is required');
    await expect(fields.validateAndSanitize("org-1", "lead", { district: null }, { forCreate: true })).rejects.toThrow('"District" is required');
    await expect(fields.validateAndSanitize("org-1", "lead", {}, { forCreate: false })).resolves.toEqual({});
    // Existing value satisfies required on create.
    await expect(fields.validateAndSanitize("org-1", "lead", {}, { forCreate: true, existing: { district: "খুলনা" } })).resolves.toEqual({});
  });

  it("another org's defs do not validate this org's values", async () => {
    const { fields } = await setup();
    await expect(fields.validateAndSanitize("org-2", "lead", { district: "ঢাকা" }, {})).rejects.toThrow('Unknown custom field: "district"');
  });

  it("mergeValues applies overwrites and clears; fillGaps only fills", () => {
    const { fields } = svc();
    expect(fields.mergeValues({ a: 1, b: 2 }, { b: null, c: 3 })).toEqual({ a: 1, c: 3 });
    expect(fields.fillGaps({ a: 1 }, { a: 9, b: 2 })).toEqual({ a: 1, b: 2 });
    expect(fields.fillGaps(null, { b: 2 })).toEqual({ b: 2 });
  });
});
