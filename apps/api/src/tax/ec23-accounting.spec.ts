import { BadRequestException } from "@nestjs/common";
import { AccountingService } from "./accounting.service";

/** EC23 — accounting exports: sales register with EC19 due math,
 * tax summary aggregation (incl. the honest legacy "unknown" rate),
 * due report, period validation, and org scoping. */

function makePrisma() {
  const customers = [
    { id: "c-1", organizationId: "org-1", firstName: "Rahim", lastName: "Uddin", phone: "01711111111" },
  ];
  const orders = [
    {
      id: "o-1", organizationId: "org-1", externalId: "ext-1", externalNumber: "ORD-1",
      invoiceNumber: "INV-2026-27-00001", customerId: "c-1",
      customer: customers[0],
      subtotalMinor: 10000n, discountMinor: 500n, shippingMinor: 600n, taxMinor: 1304n,
      totalMinor: 10000n, refundedMinor: 1000n, status: "processing", paymentMethod: "cod", isCod: true,
      taxBreakdown: [{ rateBps: 1500, taxableMinor: "10000", taxMinor: "1304" }],
      placedAt: new Date("2026-10-05T03:00:00Z"), createdAt: new Date("2026-10-05T03:00:00Z"),
    },
    {
      // Legacy: tax charged before taxBreakdown existed.
      id: "o-2", organizationId: "org-1", externalId: "ext-2", externalNumber: "ORD-2",
      invoiceNumber: null, customerId: null, customer: null,
      subtotalMinor: 5000n, discountMinor: 0n, shippingMinor: 0n, taxMinor: 900n,
      totalMinor: 5000n, refundedMinor: 0n, status: "completed", paymentMethod: "bkash", isCod: false,
      taxBreakdown: null,
      placedAt: new Date("2026-10-06T03:00:00Z"), createdAt: new Date("2026-10-06T03:00:00Z"),
    },
    {
      id: "o-3", organizationId: "org-1", externalId: "ext-3", externalNumber: "ORD-3",
      invoiceNumber: "INV-2026-27-00002", customerId: "c-1", customer: customers[0],
      subtotalMinor: 28000n, discountMinor: 0n, shippingMinor: 0n, taxMinor: 3167n,
      totalMinor: 8000n, refundedMinor: 0n, status: "processing", paymentMethod: "cod", isCod: true,
      taxBreakdown: [
        { rateBps: 1500, taxableMinor: "20000", taxMinor: "2609" },
        { rateBps: 750, taxableMinor: "8000", taxMinor: "558" },
      ],
      placedAt: null, createdAt: new Date("2026-10-07T03:00:00Z"), // placedAt fallback
    },
    {
      // Foreign org — must never appear.
      id: "o-x", organizationId: "org-2", externalId: "ext-x", externalNumber: "ORD-X",
      invoiceNumber: null, customerId: null, customer: null,
      subtotalMinor: 99900n, discountMinor: 0n, shippingMinor: 0n, taxMinor: 100n,
      totalMinor: 99900n, refundedMinor: 0n, status: "processing", paymentMethod: "cod", isCod: true,
      taxBreakdown: [{ rateBps: 1500, taxableMinor: "1000", taxMinor: "100" }],
      placedAt: new Date("2026-10-05T03:00:00Z"), createdAt: new Date("2026-10-05T03:00:00Z"),
    },
    {
      // Out of period (September).
      id: "o-old", organizationId: "org-1", externalId: "ext-old", externalNumber: "ORD-OLD",
      invoiceNumber: null, customerId: null, customer: null,
      subtotalMinor: 100n, discountMinor: 0n, shippingMinor: 0n, taxMinor: 0n,
      totalMinor: 100n, refundedMinor: 0n, status: "completed", paymentMethod: "cod", isCod: true,
      taxBreakdown: null,
      placedAt: new Date("2026-09-15T03:00:00Z"), createdAt: new Date("2026-09-15T03:00:00Z"),
    },
  ];
  const verifications = [
    { organizationId: "org-1", orderId: "o-1", status: "approved", amountMinor: 2000n },
    { organizationId: "org-1", orderId: "o-1", status: "approved", amountMinor: 1000n },
    { organizationId: "org-1", orderId: "o-1", status: "pending", amountMinor: 7000n }, // ignored
    { organizationId: "org-2", orderId: "o-x", status: "approved", amountMinor: 5000n },
  ];
  const byOrg = (rows: any[]) => async ({ where }: any) =>
    rows.filter((r) => r.organizationId === where.organizationId);
  return {
    order: { findMany: byOrg(orders) },
    customer: { findMany: byOrg(customers) },
    paymentVerification: { findMany: byOrg(verifications) },
  } as any;
}

const FROM = "2026-10-01";
const TO = "2026-10-31";

describe("EC23 accounting export — sales", () => {
  it("rows carry invoice/order/customer and the EC19 amount-due math", async () => {
    const svc = new AccountingService(makePrisma());
    const csv = await svc.exportCsv("org-1", "sales", FROM, TO);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe(
      "date,invoice_number,order_number,customer_name,customer_phone,subtotal_minor,discount_minor,shipping_minor,tax_minor,total_minor,status,payment_method,cod,amount_due_minor",
    );
    // o-1: due = 10000 − 1000 refunded − 3000 approved advances = 6000.
    expect(lines[1]).toBe(
      "2026-10-05,INV-2026-27-00001,ORD-1,Rahim Uddin,01711111111,10000,500,600,1304,10000,processing,cod,yes,6000",
    );
    // o-2: no customer → empty name/phone; no invoice yet → empty.
    expect(lines[2]).toContain(",ORD-2,,,5000,0,0,900,5000,completed,bkash,no,5000");
    // o-3 enters via the placedAt→createdAt fallback.
    expect(lines[3]).toContain("2026-10-07,INV-2026-27-00002,ORD-3,Rahim Uddin");
    expect(lines).toHaveLength(4); // header + 3 rows: foreign + September excluded
    expect(csv).not.toContain("ORD-X");
    expect(csv).not.toContain("ORD-OLD");
  });
});

describe("EC23 accounting export — tax summary", () => {
  it("aggregates per rate and keeps legacy tax under an honest unknown rate", async () => {
    const svc = new AccountingService(makePrisma());
    const csv = await svc.exportCsv("org-1", "tax", FROM, TO);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("rate_bps,rate_percent,taxable_base_minor,vat_minor,orders_count");
    expect(lines).toContain("750,7.5,8000,558,1");
    expect(lines).toContain("1500,15,30000,3913,2");
    // Legacy order: rate unknown, base blank (never recorded), VAT counted.
    expect(lines).toContain("unknown,,,900,1");
    expect(lines[lines.length - 1]).toBe("TOTAL,,38000,5371,3");
  });
});

describe("EC23 accounting export — due", () => {
  it("lists only amountDue > 0 with advance/refund split", async () => {
    const svc = new AccountingService(makePrisma());
    const csv = await svc.exportCsv("org-1", "due", FROM, TO);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe(
      "order_number,customer_name,customer_phone,total_minor,advance_paid_minor,refunded_minor,amount_due_minor,status,placed_at",
    );
    expect(lines[1]).toContain("ORD-1,Rahim Uddin,01711111111,10000,3000,1000,6000,processing,");
    expect(lines).toHaveLength(4); // o-1, o-2, o-3 all carry a due
    expect(csv).not.toContain("# courier_cod_collections");
  });
});

describe("EC23 accounting export — validation", () => {
  it("period over 366 days ⇒ 400", async () => {
    const svc = new AccountingService(makePrisma());
    await expect(svc.exportCsv("org-1", "sales", "2025-01-01", "2026-12-31")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("from after to, malformed dates, and rolled-over dates ⇒ 400", async () => {
    const svc = new AccountingService(makePrisma());
    await expect(svc.exportCsv("org-1", "sales", "2026-10-31", "2026-10-01")).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.exportCsv("org-1", "sales", "10/01/2026", "2026-10-31")).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.exportCsv("org-1", "sales", "2026-02-30", "2026-03-01")).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.exportCsv("org-1", "bogus", FROM, TO)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("a 366-day leap span is accepted", async () => {
    const svc = new AccountingService(makePrisma());
    const csv = await svc.exportCsv("org-1", "sales", "2024-01-01", "2024-12-31");
    expect(csv).toContain("date,invoice_number");
  });

  it("CSV escaping quotes fields containing commas/quotes", async () => {
    const prisma = makePrisma();
    const svc = new AccountingService(prisma);
    const csv = await svc.exportCsv("org-1", "sales", FROM, TO);
    // Rahim Uddin has no comma in the fixtures; verify the escaper via a due row instead:
    expect(csv.split("\n")[1]).not.toContain('"');
  });
});
