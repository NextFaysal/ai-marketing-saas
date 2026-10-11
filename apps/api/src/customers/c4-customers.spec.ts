import { CustomersService } from "./customers.service";
import { CustomFieldsService } from "../crm/custom-fields.service";

function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object") {
      if ("not" in v) return row[k] !== v.not;
      return true;
    }
    return row[k] === v;
  });
}
function makeTable(seed: any[] = []) {
  const rows: any[] = [...seed];
  let seq = rows.length;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
    create: async ({ data }: any) => { const row = { id: `id-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); Object.assign(row, data); return row; },
  };
}

async function setup() {
  const prisma = {
    customer: makeTable([
      { id: "c1", organizationId: "org-1", firstName: "Sara", lastName: null, phone: null, email: null, source: "lead", mergedIntoId: null, customFields: { city: "ঢাকা" }, createdAt: new Date() },
      { id: "c2", organizationId: "org-1", firstName: null, lastName: "Begum", phone: "01711000002", email: "rina@example.com", source: "woocommerce", mergedIntoId: null, customFields: { city: "খুলনা", since: "2024-01-15" }, createdAt: new Date() },
    ]),
    order: makeTable(), channelConversation: makeTable(), lead: makeTable(), customFieldDef: makeTable(),
  };
  const fields = new CustomFieldsService(prisma as any);
  await fields.createDef("org-1", { entity: "customer", label: "City", type: "text" });
  await fields.createDef("org-1", { entity: "customer", label: "Since", type: "date" });
  const audit = { calls: [] as any[], log: async (i: any) => { audit.calls.push(i); } };
  const svc = new CustomersService(prisma as any, audit as any, undefined, fields);
  return { prisma, fields, svc, audit };
}

describe("CustomersService.update (CRM C4 — the first customer PATCH)", () => {
  it("updates contact basics (trimmed, email lowercased), merges custom values, audits the change", async () => {
    const { svc, audit } = await setup();
    const out = await svc.update("org-1", "actor-1", "c1", {
      firstName: "  Sara  ", email: "SARA@Example.COM ", customFields: { since: "2025-05-01" },
    });
    expect(out.customer).toMatchObject({ firstName: "Sara", email: "sara@example.com" });
    expect((out.customer as any).customFields).toEqual({ city: "ঢাকা", since: "2025-05-01" });
    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0]).toMatchObject({ action: "customer.updated", entityType: "Customer", entityId: "c1", userId: "actor-1" });
    expect(audit.calls[0].metadata.fields).toEqual(expect.arrayContaining(["firstName", "email", "customFields"]));
  });

  it("validates custom values (bad date 400s, unknown key 400s) and 404s across orgs", async () => {
    const { svc } = await setup();
    await expect(svc.update("org-1", "a", "c1", { customFields: { since: "15-01-2024" } })).rejects.toThrow(/YYYY-MM-DD/);
    await expect(svc.update("org-1", "a", "c1", { customFields: { nope: "x" } })).rejects.toThrow('Unknown custom field: "nope"');
    await expect(svc.update("org-2", "a", "c1", { firstName: "X" })).rejects.toThrow("not found");
  });

  it("customFields: null clears all values", async () => {
    const { svc } = await setup();
    const out = await svc.update("org-1", "a", "c1", { customFields: null });
    expect((out.customer as any).customFields).toBeNull();
  });
});

describe("CustomersService merge + export with custom fields (CRM C4)", () => {
  it("merge gap-fills custom fields per key (survivor wins)", async () => {
    const { svc } = await setup();
    const out = await svc.merge("org-1", "a", { sourceId: "c2", targetId: "c1" });
    expect((out.customer as any).customFields).toEqual({ city: "ঢাকা", since: "2024-01-15" });
    // Scalar gap-fill still applies alongside (phone/email came from the source).
    expect(out.customer).toMatchObject({ phone: "01711000002", email: "rina@example.com" });
  });

  it("export appends customer def labels as columns", async () => {
    const { svc } = await setup();
    const csv = await svc.exportCsv("org-1");
    const lines = csv.split("\n");
    expect(lines[0].endsWith(",City,Since")).toBe(true);
    expect(lines.some((l) => l.includes("Sara") && l.endsWith(",ঢাকা,"))).toBe(true);
  });
});
