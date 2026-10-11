import { CustomersService } from "./customers.service";

function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object") {
      if ("not" in v) return row[k] !== v.not;
      if ("contains" in v) return String(row[k] ?? "").toLowerCase().includes(String(v.contains).toLowerCase());
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
const audit = { log: async () => undefined };

describe("CustomersService.exportCsv (CRM C3)", () => {
  it("exports the list computation: lifetime excludes cancelled orders, taka formatting, org-scoped", async () => {
    const customers = makeTable([
      { id: "c1", organizationId: "org-1", firstName: "Sara", lastName: "Ahmed", phone: "01711000000", email: "sara@example.com", source: "woocommerce", mergedIntoId: null, createdAt: new Date("2026-09-01T00:00:00Z") },
      { id: "c2", organizationId: "org-2", firstName: "Other", lastName: "Org", phone: "01711000001", email: null, source: "woocommerce", mergedIntoId: null, createdAt: new Date() },
      { id: "c3", organizationId: "org-1", firstName: "Merged", lastName: "Shell", phone: "01711000002", email: null, source: "woocommerce", mergedIntoId: "c1", createdAt: new Date() },
    ]);
    const orders = makeTable([
      { id: "o1", organizationId: "org-1", customerId: "c1", status: "completed", totalMinor: 150050n },
      { id: "o2", organizationId: "org-1", customerId: "c1", status: "cancelled", totalMinor: 99900n },
      { id: "o3", organizationId: "org-1", customerId: "c1", status: "processing", totalMinor: 50000n },
    ]);
    const svc = new CustomersService({ customer: customers, order: orders } as any, audit as any);
    const csv = await svc.exportCsv("org-1");
    const lines = csv.split("\n");
    expect(lines[0]).toBe("id,name,first_name,last_name,phone,email,source,order_count,total_spent,created_at");
    expect(lines).toHaveLength(2); // header + Sara only (merged shell + other org excluded)
    expect(lines[1]).toContain("Sara Ahmed");
    expect(lines[1]).toContain(",2,2000.50,"); // 2 non-cancelled orders, (150050+50000) poisha = 2000.50 taka
    expect(csv).not.toContain("Other");
    expect(csv).not.toContain("Merged");
  });
});
