import { LeadsService } from "./leads.service";
import { CustomFieldsService } from "./custom-fields.service";

function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (k === "OR") return v.some((sub: any) => matches(row, sub));
    if (v !== null && typeof v === "object") {
      if ("contains" in v) return String(row[k] ?? "").toLowerCase().includes(String(v.contains).toLowerCase());
      return true;
    }
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
    findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
    create: async ({ data }: any) => { const row = { id: `id-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); Object.assign(row, data); return row; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); rows.splice(i, 1); return {}; },
  };
}

async function setup() {
  const prisma = {
    lead: makeTable(), leadActivity: makeTable(), customer: makeTable(),
    importJob: makeTable(), customFieldDef: makeTable(), channelConversation: makeTable(),
  };
  const fields = new CustomFieldsService(prisma as any);
  await fields.createDef("org-1", { entity: "lead", label: "District", type: "select", options: ["ঢাকা", "খুলনা"], required: true });
  await fields.createDef("org-1", { entity: "lead", label: "Budget", type: "number" });
  const audit = { calls: [] as any[], log: async (i: any) => { audit.calls.push(i); } };
  const svc = new LeadsService(prisma as any, undefined, audit as any, fields);
  return { prisma, fields, svc, audit };
}

describe("LeadsService + custom fields (CRM C4)", () => {
  it("create stores sanitized values (numeric string -> number)", async () => {
    const { svc } = await setup();
    const lead = await svc.create("org-1", "u", { name: "A", customFields: { district: "ঢাকা", budget: "5000" } });
    expect((lead as any).customFields).toEqual({ district: "ঢাকা", budget: 5000 });
  });

  it("create enforces required defs and value types; unknown keys 400", async () => {
    const { svc } = await setup();
    await expect(svc.create("org-1", "u", { name: "A" })).rejects.toMatchObject({ code: "crm.customFieldIsRequired" });
    await expect(svc.create("org-1", "u", { name: "A", customFields: { district: "ঢাকা", budget: "lots" } })).rejects.toMatchObject({ code: "crm.customFieldMustBeANumber" });
    await expect(svc.create("org-1", "u", { name: "A", customFields: { district: "ঢাকা", mystery: 1 } })).rejects.toMatchObject({ code: "crm.unknownCustomFieldFor" });
    await expect(svc.create("org-1", "u", { name: "A", customFields: { district: "চট্টগ্রাম" } })).rejects.toMatchObject({ code: "crm.customFieldMustBeOneOf" });
  });

  it("update merges partial values, clears single keys with null, and clears all with customFields: null; required is NOT enforced on update", async () => {
    const { svc } = await setup();
    const lead = await svc.create("org-1", "u", { name: "A", customFields: { district: "ঢাকা", budget: 100 } });
    const step1 = await svc.update("org-1", "u", lead.id, { customFields: { budget: 250 } });
    expect((step1 as any).customFields).toEqual({ district: "ঢাকা", budget: 250 });
    const step2 = await svc.update("org-1", "u", lead.id, { customFields: { district: null } });
    expect((step2 as any).customFields).toEqual({ budget: 250 });
    const step3 = await svc.update("org-1", "u", lead.id, { customFields: null });
    expect((step3 as any).customFields).toBeNull();
  });

  it("CSV import is NOT blocked by a required def (bulk rows carry no custom values)", async () => {
    const { svc } = await setup();
    const out = await svc.importLeadsCsv("org-1", "u", { csvText: "name,phone\nImported,01711000000" });
    expect(out.successRows).toBe(1);
    expect(out.failedRows).toBe(0);
  });

  it("merge gap-fills custom fields: survivor keeps its own, gains source-only keys", async () => {
    const { svc } = await setup();
    const target = await svc.create("org-1", "u", { name: "T", customFields: { district: "ঢাকা" } });
    const source = await svc.create("org-1", "u", { name: "S", customFields: { district: "খুলনা", budget: 700 } });
    const merged = await svc.merge("org-1", "u", target.id, source.id);
    expect((merged as any).customFields).toEqual({ district: "ঢাকা", budget: 700 });
  });

  it("export appends the def labels as columns with the stored values", async () => {
    const { svc } = await setup();
    await svc.create("org-1", "u", { name: "With Fields", customFields: { district: "খুলনা", budget: 42 } });
    const csv = await svc.exportCsv("org-1");
    const lines = csv.split("\n");
    expect(lines[0].endsWith(",District,Budget")).toBe(true);
    expect(lines[1].endsWith(",খুলনা,42")).toBe(true);
  });
});
