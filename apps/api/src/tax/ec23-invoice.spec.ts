import { NotFoundException } from "@nestjs/common";
import { InvoicesService, fiscalYearFor } from "./invoices.service";

/** EC23 — fiscal invoice numbering: BD fiscal year (Jul–Jun,
 * Asia/Dhaka), per-org InvoiceCounter sequence, idempotent re-issue,
 * foreign-order 404. Fake Prisma implements the exact calls the
 * service makes (upsert + atomic increment + guarded updateMany). */

function makePrisma() {
  const orders: any[] = [];
  const counters: any[] = [];
  const prisma: any = {
    order: {
      findFirst: async ({ where }: any) =>
        orders.find(
          (o) => o.id === where.id && o.organizationId === where.organizationId,
        ) ?? null,
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const o of orders) {
          if (o.id !== where.id || o.organizationId !== where.organizationId) continue;
          if (where.invoiceNumber === null && o.invoiceNumber != null) continue;
          o.invoiceNumber = data.invoiceNumber;
          o.updatedAt = new Date();
          count += 1;
        }
        return { count };
      },
    },
    invoiceCounter: {
      upsert: async ({ where, create }: any) => {
        const key = where.organizationId_fiscalYear;
        let row = counters.find(
          (c) => c.organizationId === key.organizationId && c.fiscalYear === key.fiscalYear,
        );
        if (!row) {
          row = { id: `counter-${counters.length + 1}`, ...create };
          counters.push(row);
        }
        return row;
      },
      update: async ({ where, data }: any) => {
        const key = where.organizationId_fiscalYear;
        const row = counters.find(
          (c) => c.organizationId === key.organizationId && c.fiscalYear === key.fiscalYear,
        );
        if (!row) throw new Error("counter not found");
        if (data.lastSeq?.increment) row.lastSeq += data.lastSeq.increment;
        return row;
      },
    },
    taxSetting: {
      findFirst: async () => ({
        legalName: "Qosprey Ltd",
        tin: "TIN-123",
        binVatNo: "BIN-456",
        defaultVatBps: 1500,
        pricesIncludeVat: true,
      }),
    },
    $transaction: async (fn: any) => fn(prisma),
    __orders: orders,
    __counters: counters,
  };
  return prisma;
}

function seedOrder(prisma: any, id: string, orgId = "org-1") {
  prisma.__orders.push({
    id,
    organizationId: orgId,
    externalId: `ext-${id}`,
    externalNumber: `ORD-${id}`,
    status: "processing",
    isCod: true,
    paymentMethod: "cod",
    subtotalMinor: 10000n,
    shippingMinor: 600n,
    discountMinor: 0n,
    taxMinor: 1304n,
    promotionDiscountMinor: 0n,
    referralDiscountMinor: 0n,
    totalMinor: 10600n,
    refundedMinor: 0n,
    invoiceNumber: null,
    taxBreakdown: [{ rateBps: 1500, taxableMinor: "10000", taxMinor: "1304" }],
    placedAt: new Date("2026-10-05T03:00:00Z"),
    createdAt: new Date("2026-10-05T03:00:00Z"),
    updatedAt: new Date("2026-10-05T03:00:00Z"),
    customer: { firstName: "Rahim", lastName: "Uddin", phone: "01711111111" },
    items: [{ id: "i-1", name: "শার্ট", quantity: 1, priceMinor: 10000n, totalMinor: 10000n }],
  });
}

describe("EC23 fiscalYearFor (Asia/Dhaka, Jul–Jun)", () => {
  it("Oct 2026 → 2026-27; Jun 2027 → 2026-27; Jul 2027 → 2027-28", () => {
    expect(fiscalYearFor(new Date("2026-10-13T04:00:00Z"))).toBe("2026-27");
    expect(fiscalYearFor(new Date("2027-06-15T04:00:00Z"))).toBe("2026-27");
    expect(fiscalYearFor(new Date("2027-07-01T04:00:00Z"))).toBe("2027-28");
  });

  it("the Dhaka boundary decides, not UTC: Jun 30 19:30 UTC is already Jul 1 in Dhaka", () => {
    expect(fiscalYearFor(new Date("2027-06-30T19:30:00Z"))).toBe("2027-28");
    expect(fiscalYearFor(new Date("2027-06-30T17:30:00Z"))).toBe("2026-27");
  });
});

describe("EC23 ensureInvoiceNumber", () => {
  it("assigns INV-2026-27-00001 / 00002 in sequence for Oct 2026", async () => {
    const prisma = makePrisma();
    seedOrder(prisma, "o-1");
    seedOrder(prisma, "o-2");
    const svc = new InvoicesService(prisma);
    const now = new Date("2026-10-13T04:00:00Z");
    await expect(svc.ensureInvoiceNumber("org-1", "o-1", now)).resolves.toBe("INV-2026-27-00001");
    await expect(svc.ensureInvoiceNumber("org-1", "o-2", now)).resolves.toBe("INV-2026-27-00002");
    expect(prisma.__counters[0].lastSeq).toBe(2);
  });

  it("re-issue returns the same number WITHOUT incrementing", async () => {
    const prisma = makePrisma();
    seedOrder(prisma, "o-1");
    const svc = new InvoicesService(prisma);
    const now = new Date("2026-10-13T04:00:00Z");
    const first = await svc.ensureInvoiceNumber("org-1", "o-1", now);
    const second = await svc.ensureInvoiceNumber("org-1", "o-1", now);
    expect(second).toBe(first);
    expect(prisma.__counters[0].lastSeq).toBe(1);
  });

  it("a new fiscal year starts a fresh sequence at 00001", async () => {
    const prisma = makePrisma();
    seedOrder(prisma, "o-1");
    seedOrder(prisma, "o-2");
    const svc = new InvoicesService(prisma);
    await expect(
      svc.ensureInvoiceNumber("org-1", "o-1", new Date("2027-06-15T04:00:00Z")),
    ).resolves.toBe("INV-2026-27-00001");
    await expect(
      svc.ensureInvoiceNumber("org-1", "o-2", new Date("2027-07-01T04:00:00Z")),
    ).resolves.toBe("INV-2027-28-00001");
  });

  it("foreign order ⇒ 404, and no counter is touched", async () => {
    const prisma = makePrisma();
    seedOrder(prisma, "o-9", "org-2");
    const svc = new InvoicesService(prisma);
    await expect(svc.ensureInvoiceNumber("org-1", "o-9")).rejects.toMatchObject({ code: "tax.orderNotFoundInThisOrganization" });
    await expect(svc.getInvoice("org-1", "o-9")).rejects.toMatchObject({ code: "tax.orderNotFoundInThisOrganization" });
    expect(prisma.__counters).toHaveLength(0);
  });

  it("getInvoice returns the number, seller identity and string money", async () => {
    const prisma = makePrisma();
    seedOrder(prisma, "o-1");
    const svc = new InvoicesService(prisma);
    const inv = await svc.getInvoice("org-1", "o-1");
    expect(inv.invoiceNumber).toMatch(/^INV-2026-2[67]-\d{5}$/);
    expect(inv.seller).toEqual({ legalName: "Qosprey Ltd", tin: "TIN-123", binVatNo: "BIN-456" });
    expect(inv.totalMinor).toBe("10600");
    expect(inv.taxMinor).toBe("1304");
    expect(inv.items[0].priceMinor).toBe("10000");
    expect(inv.taxBreakdown).toEqual([{ rateBps: 1500, taxableMinor: "10000", taxMinor: "1304" }]);
    expect(typeof inv.issuedAt).toBe("string");
  });
});
