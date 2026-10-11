import { LeadsService, LEAD_IMPORT_ROW_CAP } from "./leads.service";

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
function fakePrisma() {
  return { lead: makeTable(), leadActivity: makeTable(), customer: makeTable(), importJob: makeTable(), auditLog: makeTable() };
}
function fakeAudit() {
  const calls: any[] = [];
  return { calls, log: async (input: any) => { calls.push(input); } };
}

const HEADER = "name,phone,email,source,stage,tags,value,next_follow_up_at";

describe("LeadsService.importLeadsCsv (CRM C3)", () => {
  it("creates leads through the manual-create path (activity row, owner = importer, money parsed)", async () => {
    const prisma = fakePrisma(); const audit = fakeAudit();
    const svc = new LeadsService(prisma as any, undefined, audit as any);
    const out = await svc.importLeadsCsv("org-1", "user-9", {
      fileName: "leads.csv",
      csvText: `${HEADER}\nSara Ahmed,01711000000,sara@example.com,whatsapp,qualified,vip|hot,2500.50,2026-10-20`,
    });
    expect(out.status).toBe("COMPLETED");
    expect(out.kind).toBe("leads");
    expect(out.successRows).toBe(1);
    expect(out.failedRows).toBe(0);
    expect(out.skippedRows).toBe(0);
    const lead = prisma.lead.rows[0];
    expect(lead).toMatchObject({ name: "Sara Ahmed", source: "whatsapp", stage: "qualified", ownerUserId: "user-9" });
    expect(String(lead.valueMinor)).toBe("250050");
    expect(lead.tags).toEqual(["vip", "hot"]);
    expect(prisma.leadActivity.rows.some((a: any) => a.type === "created" && a.leadId === lead.id)).toBe(true);
    expect(out.details.created).toEqual([{ row: 1, leadId: lead.id }]);
    // Exactly one audit entry for the whole batch, with the counts.
    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0]).toMatchObject({ action: "leads_import", entityType: "ImportJob", entityId: out.id });
    expect(audit.calls[0].metadata).toMatchObject({ totalRows: 1, created: 1, skipped: 0, failed: 0 });
  });

  it("skips phone duplicates against existing non-merged leads and reports the existing id; never overwrites", async () => {
    const prisma = fakePrisma();
    const svc = new LeadsService(prisma as any, undefined, fakeAudit() as any);
    const existing = await svc.create("org-1", "u", { name: "Original", phone: "+880 1711-000000" });
    const out = await svc.importLeadsCsv("org-1", "u", {
      csvText: `name,phone\nCopy Cat,01711000000\nFresh,01711000099`,
    });
    expect(out.successRows).toBe(1);
    expect(out.skippedRows).toBe(1);
    expect(out.details.skipped).toEqual([{ row: 1, leadId: existing.id, phone: "01711000000" }]);
    expect(prisma.lead.rows.filter((l: any) => l.name === "Original")).toHaveLength(1);
    expect(prisma.lead.rows.some((l: any) => l.name === "Copy Cat")).toBe(false);
  });

  it("a phone repeated inside the same file skips against the just-created lead; merged leads do not block", async () => {
    const prisma = fakePrisma();
    const svc = new LeadsService(prisma as any, undefined, fakeAudit() as any);
    const ghost = await svc.create("org-1", "u", { name: "Ghost", phone: "01711000077" });
    await (prisma as any).lead.update({ where: { id: ghost.id }, data: { mergedIntoId: "someone" } });
    const out = await svc.importLeadsCsv("org-1", "u", {
      csvText: `name,phone\nFirst,01711000055\nSecond,01711000055\nGhost Returns,01711000077`,
    });
    expect(out.successRows).toBe(2); // First + Ghost Returns (merged record is not a dedupe target)
    expect(out.skippedRows).toBe(1);
    expect(out.details.skipped[0].row).toBe(2);
  });

  it("rows without a phone are never deduped; parse failures count as failed rows", async () => {
    const prisma = fakePrisma();
    const svc = new LeadsService(prisma as any, undefined, fakeAudit() as any);
    const out = await svc.importLeadsCsv("org-1", "u", {
      csvText: `name,phone,source\nNo Phone One,,manual\nNo Phone Two,,manual\nBad Row,,tiktok`,
    });
    expect(out.successRows).toBe(2);
    expect(out.skippedRows).toBe(0);
    expect(out.failedRows).toBe(1);
    expect(out.errors[0]).toMatchObject({ row: 3 });
    expect(out.errors[0].message).toContain("Invalid source");
  });

  it("dedupe is org-scoped: another org's lead with the same phone does not skip", async () => {
    const prisma = fakePrisma();
    const svc = new LeadsService(prisma as any, undefined, fakeAudit() as any);
    await svc.create("org-2", "u", { name: "Other Org", phone: "01711000000" });
    const out = await svc.importLeadsCsv("org-1", "u", { csvText: `name,phone\nMine,01711000000` });
    expect(out.successRows).toBe(1);
    expect(out.skippedRows).toBe(0);
  });

  it(`rejects files over the ${LEAD_IMPORT_ROW_CAP}-row cap with a 400 before creating anything`, async () => {
    const prisma = fakePrisma();
    const svc = new LeadsService(prisma as any, undefined, fakeAudit() as any);
    const lines = ["name,phone", ...Array.from({ length: LEAD_IMPORT_ROW_CAP + 1 }, (_, i) => `Lead ${i},0171100${String(i).padStart(4, "0")}`)];
    await expect(svc.importLeadsCsv("org-1", "u", { csvText: lines.join("\n") })).rejects.toThrow(/সর্বোচ্চ/);
    expect(prisma.lead.rows).toHaveLength(0);
    expect(prisma.importJob.rows).toHaveLength(0);
  });
});

describe("LeadsService.exportCsv (CRM C3)", () => {
  it("exports core columns with taka values, excludes merged leads and other orgs", async () => {
    const prisma = fakePrisma();
    const svc = new LeadsService(prisma as any, undefined, fakeAudit() as any);
    const a = await svc.create("org-1", "u", { name: "Export Me", phone: "01711000000", value: "2500.50", source: "whatsapp" });
    await svc.create("org-2", "u", { name: "Other Org Lead", phone: "01711000001" });
    const merged = await svc.create("org-1", "u", { name: "Merged Away", phone: "01711000002" });
    await (prisma as any).lead.update({ where: { id: merged.id }, data: { mergedIntoId: a.id } });
    const csv = await svc.exportCsv("org-1");
    const lines = csv.split("\n");
    expect(lines[0]).toBe("id,name,phone,email,source,stage,tags,value,currency,next_follow_up_at,notes,created_at");
    expect(csv).toContain("Export Me");
    expect(csv).toContain("2500.50");
    expect(csv).not.toContain("Other Org Lead");
    expect(csv).not.toContain("Merged Away");
    expect(lines).toHaveLength(2);
  });
});
