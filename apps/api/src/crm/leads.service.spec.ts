import { LeadsService } from "./leads.service";

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
function fakePrisma() { return { lead: makeTable(), leadActivity: makeTable(), customer: makeTable() }; }

describe("LeadsService", () => {
  it("creates a lead with parsed money and an activity record", async () => {
    const prisma = fakePrisma();
    const svc = new LeadsService(prisma as any);
    const lead = await svc.create("org-1", "user-1", { name: "Sara Ahmed", phone: "01710000000", value: "2500.50", source: "whatsapp" });
    expect(lead.valueMinor).toBe("250050");
    expect(prisma.leadActivity.rows[0].type).toBe("created");
  });

  it("logs stage changes and rejects invalid stages", async () => {
    const prisma = fakePrisma();
    const svc = new LeadsService(prisma as any);
    const lead = await svc.create("org-1", "user-1", { name: "A" });
    await svc.update("org-1", "user-1", lead.id, { stage: "qualified" });
    expect(prisma.leadActivity.rows.some((a: any) => a.type === "stage_change" && a.content.includes("new -> qualified"))).toBe(true);
    await expect(svc.update("org-1", "user-1", lead.id, { stage: "banana" })).rejects.toMatchObject({ code: "crm.invalidStage" });
  });

  it("pipeline summary counts stages and excludes lost value from open pipeline", async () => {
    const prisma = fakePrisma();
    const svc = new LeadsService(prisma as any);
    await svc.create("org-1", "u", { name: "A", value: "1000" });
    const b = await svc.create("org-1", "u", { name: "B", value: "2000" });
    await svc.update("org-1", "u", b.id, { stage: "lost" });
    const summary = await svc.pipeline("org-1");
    expect(summary.totalLeads).toBe(2);
    expect(summary.byStage.new.count).toBe(1);
    expect(summary.byStage.lost.valueMinor).toBe("200000");
    expect(summary.openPipelineValueMinor).toBe("100000");
  });

  it("conversion creates a customer once and is idempotent", async () => {
    const prisma = fakePrisma();
    const svc = new LeadsService(prisma as any);
    const lead = await svc.create("org-1", "u", { name: "Tanvir Hasan", email: "t@example.com", phone: "0171" });
    const first = await svc.convertToCustomer("org-1", "u", lead.id);
    expect(first.alreadyConverted).toBe(false);
    expect(first.customer).toMatchObject({ firstName: "Tanvir", lastName: "Hasan", source: "lead" });
    const second = await svc.convertToCustomer("org-1", "u", lead.id);
    expect(second.alreadyConverted).toBe(true);
    expect(prisma.customer.rows).toHaveLength(1);
  });

  it("leads are organization-scoped", async () => {
    const prisma = fakePrisma();
    const svc = new LeadsService(prisma as any);
    const lead = await svc.create("org-1", "u", { name: "A" });
    await expect(svc.getOne("org-2", lead.id)).rejects.toMatchObject({ code: "crm.leadNotFoundInThisOrganization" });
  });
});
