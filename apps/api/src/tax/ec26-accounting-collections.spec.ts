import { AccountingService } from "./accounting.service";

/** EC26 — accounting "courier-collections" export: per-provider
 * expected/collected/outstanding over DELIVERED shipments of
 * in-period orders (order effective date = placedAt ?? createdAt,
 * the house convention), discrepancy counts from amount_mismatch
 * reconciliation lines of in-period imports, and a TOTAL row. */

function makePrisma() {
  const T = (iso: string) => new Date(iso);
  const orders = [
    { id: "o-1", organizationId: "org-1", placedAt: T("2026-10-05T03:00:00Z"), createdAt: T("2026-10-05T03:00:00Z"), customer: null },
    { id: "o-2", organizationId: "org-1", placedAt: null, createdAt: T("2026-10-06T03:00:00Z"), customer: null }, // fallback date
    { id: "o-old", organizationId: "org-1", placedAt: T("2026-09-15T03:00:00Z"), createdAt: T("2026-09-15T03:00:00Z"), customer: null },
    { id: "o-x", organizationId: "org-2", placedAt: T("2026-10-05T03:00:00Z"), createdAt: T("2026-10-05T03:00:00Z"), customer: null },
  ];
  const shipments = [
    // steadfast, o-1: delivered + collected in full
    { id: "s-1", organizationId: "org-1", orderId: "o-1", provider: "steadfast", status: "delivered", codAmountMinor: 100000n, codCollectedMinor: 100000n },
    // steadfast, o-1: delivered, nothing collected yet
    { id: "s-2", organizationId: "org-1", orderId: "o-1", provider: "steadfast", status: "delivered", codAmountMinor: 50000n, codCollectedMinor: null },
    // steadfast, o-2: NOT delivered — counted as a shipment, excluded from expected/collected
    { id: "s-3", organizationId: "org-1", orderId: "o-2", provider: "steadfast", status: "in_transit", codAmountMinor: 70000n, codCollectedMinor: null },
    // pathao, o-2: partial_delivered counts as delivered; collected short
    { id: "s-4", organizationId: "org-1", orderId: "o-2", provider: "pathao", status: "partial_delivered", codAmountMinor: 30000n, codCollectedMinor: 25000n },
    // pathao, o-old: order out of period — excluded entirely
    { id: "s-5", organizationId: "org-1", orderId: "o-old", provider: "pathao", status: "delivered", codAmountMinor: 99000n, codCollectedMinor: 99000n },
    // foreign org — excluded
    { id: "s-x", organizationId: "org-2", orderId: "o-x", provider: "steadfast", status: "delivered", codAmountMinor: 11100n, codCollectedMinor: 11100n },
  ];
  const integrations = [
    { id: "int-sf", organizationId: "org-1", provider: "steadfast" },
    { id: "int-pa", organizationId: "org-1", provider: "pathao" },
  ];
  const imports = [
    { id: "imp-1", organizationId: "org-1", courierIntegrationId: "int-sf", createdAt: T("2026-10-10T03:00:00Z") },
    { id: "imp-2", organizationId: "org-1", courierIntegrationId: "int-pa", createdAt: T("2026-10-11T03:00:00Z") },
    { id: "imp-old", organizationId: "org-1", courierIntegrationId: "int-sf", createdAt: T("2026-09-20T03:00:00Z") }, // out of period
  ];
  const lines = [
    { organizationId: "org-1", importId: "imp-1", outcome: "amount_mismatch" },
    { organizationId: "org-1", importId: "imp-1", outcome: "amount_mismatch" },
    { organizationId: "org-1", importId: "imp-1", outcome: "matched" }, // not a discrepancy
    { organizationId: "org-1", importId: "imp-2", outcome: "amount_mismatch" },
    { organizationId: "org-1", importId: "imp-old", outcome: "amount_mismatch" }, // import out of period
  ];
  const byWhere = (rows: any[]) => async ({ where }: any) =>
    rows.filter((r) => Object.entries(where ?? {}).every(([k, v]) => r[k] === v));
  return {
    order: { findMany: byWhere(orders) },
    customer: { findMany: async () => [] },
    paymentVerification: { findMany: async () => [] },
    courierShipment: { findMany: byWhere(shipments) },
    integration: { findMany: byWhere(integrations) },
    reconciliationImport: { findMany: byWhere(imports) },
    reconciliationLine: { findMany: byWhere(lines) },
  } as any;
}

describe("EC26 accounting export — courier-collections", () => {
  it("per-provider math: delivered-only expected/collected, outstanding, discrepancies, TOTAL", async () => {
    const svc = new AccountingService(makePrisma());
    const csv = await svc.exportCsv("org-1", "courier-collections", "2026-10-01", "2026-10-31");
    const rows = csv.trim().split("\n");
    expect(rows[0]).toBe("provider,shipments,expected_cod_minor,collected_minor,outstanding_minor,discrepancy_count");
    // pathao: 1 shipment (s-4), expected 30000, collected 25000, outstanding 5000, 1 discrepancy.
    expect(rows).toContain("pathao,1,30000,25000,5000,1");
    // steadfast: 3 shipments (s-1,s-2,s-3), delivered expected 100000+50000,
    // collected 100000, outstanding 50000, 2 discrepancies (imp-old excluded).
    expect(rows).toContain("steadfast,3,150000,100000,50000,2");
    expect(rows[rows.length - 1]).toBe("TOTAL,4,180000,125000,55000,3");
    expect(rows).toHaveLength(4); // header + 2 providers + TOTAL
  });

  it("an empty period still emits header + zero TOTAL", async () => {
    const svc = new AccountingService(makePrisma());
    const csv = await svc.exportCsv("org-1", "courier-collections", "2026-08-01", "2026-08-31");
    const rows = csv.trim().split("\n");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toBe("TOTAL,0,0,0,0,0");
  });

  it("the new type passes export validation; period validation still applies", async () => {
    const svc = new AccountingService(makePrisma());
    await expect(svc.exportCsv("org-1", "courier-collections", "2026-10-31", "2026-10-01")).rejects.toThrow();
  });
});
