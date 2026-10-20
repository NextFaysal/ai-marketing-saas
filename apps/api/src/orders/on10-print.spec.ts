import "reflect-metadata";
import { PrintCenterService } from "./print-center.service";
import { CourierService } from "../courier/courier.service";
import { OrdersBulkService } from "../fulfillment/orders-bulk.service";

/**
 * ON10 — Print & Document Center.
 * Fake-Prisma house style (the m53 table fakes): the REAL
 * CourierService builders run against in-memory tables, so the
 * PDFs asserted here are the genuine generator output.
 */

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v.in as any[]).includes(row[k]);
      return true;
    }
    return row[k] === v;
  });
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async (args: any = {}) => rows.find((r) => matches(r, args.where ?? {})) ?? null,
    findUnique: async (args: any = {}) => rows.find((r) => matches(r, args.where ?? {})) ?? null,
    findMany: async (args: any = {}) => rows.filter((r) => matches(r, args.where ?? {})),
    count: async (args: any = {}) => rows.filter((r) => matches(r, args.where ?? {})).length,
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where ?? {}));
      if (row) Object.assign(row, data);
      return row ?? null;
    },
    groupBy: async (args: any = {}) => {
      const sums = new Map<string, bigint>();
      for (const r of rows.filter((x) => matches(x, args.where ?? {}))) {
        const key = String(r[args.by[0]]);
        sums.set(key, (sums.get(key) ?? 0n) + BigInt(r.amountMinor ?? 0));
      }
      return [...sums.entries()].map(([k, v]) => ({ [args.by[0]]: k, _sum: { amountMinor: v } }));
    },
  };
}

function setup() {
  const tables: Record<string, any> = {};
  for (const n of ["order", "customer", "orderItem", "courierShipment", "paymentVerification", "organization", "businessProfile", "printJob", "printTemplateSetting"]) {
    tables[n] = makeTable(n);
  }
  tables.organization.rows.push({ id: "org-1", name: "Test Shop", currency: "BDT" });
  tables.organization.rows.push({ id: "org-2", name: "Other Shop", currency: "BDT" });
  tables.businessProfile.rows.push({ organizationId: "org-1", contactPhone: "01700000000" });
  tables.customer.rows.push({ id: "cus-1", organizationId: "org-1", firstName: "Rahim", lastName: "Uddin", phone: "01711111111", address: { address_1: "House 1, Road 2", district: "Dhaka" } });
  const base = { organizationId: "org-1", customerId: "cus-1", isCod: true, status: "processing", currency: "BDT", placedAt: new Date("2026-10-11T00:00:00Z") };
  tables.order.rows.push(
    { ...base, id: "ord-a", externalNumber: "A1", address: "House 1, Road 2, Mirpur, Dhaka", totalMinor: 150000n, subtotalMinor: 120000n, shippingMinor: 30000n, discountMinor: 0n, giftMessage: "Happy Birthday, Apu!" },
    { ...base, id: "ord-b", externalNumber: "B2", address: "House 9, Road 3, Uttara, Dhaka", totalMinor: 80000n, subtotalMinor: 80000n, shippingMinor: 0n, discountMinor: 0n },
    { ...base, id: "ord-foreign", organizationId: "org-2", externalNumber: "F9", totalMinor: 1000n },
  );
  tables.orderItem.rows.push(
    { id: "oi-1", orderId: "ord-a", name: "Cotton T-Shirt", sku: "TS-001", quantity: 2, priceMinor: 60000n, totalMinor: 120000n, isGift: true, bundleName: null },
    { id: "oi-2", orderId: "ord-b", name: "Mug", sku: "MG-1", quantity: 1, priceMinor: 80000n, totalMinor: 80000n, isGift: false, bundleName: null },
  );
  tables.courierShipment.rows.push({
    id: "ship-a", organizationId: "org-1", orderId: "ord-a", provider: "steadfast",
    consignmentId: "900", trackingCode: "TRKA1", status: "in_review",
    recipientName: "Rahim Uddin", recipientPhone: "01711111111", recipientAddress: "House 1, Road 2, Mirpur, Dhaka",
    codAmountMinor: 150000n, createdAt: new Date("2026-10-12T00:00:00Z"), updatedAt: new Date(),
  });
  // ord-a: ৳500 of the ৳1,500 total already approved → challan due = ৳1,000.
  tables.paymentVerification.rows.push(
    { id: "pv-1", organizationId: "org-1", orderId: "ord-a", status: "approved", amountMinor: 50000n, createdAt: new Date() },
    { id: "pv-2", organizationId: "org-1", orderId: "ord-a", status: "pending", amountMinor: 99900n, createdAt: new Date() },
  );
  const auditLog: any[] = [];
  const audit: any = { log: async (e: any) => { auditLog.push(e); } };
  const courier = new CourierService(tables as any, audit, undefined);
  const center = new PrintCenterService(tables as any, audit, undefined);
  (center as any).courierCache = courier;
  return { tables, auditLog, audit, courier, center };
}

describe("ON10 print jobs", () => {
  it("invoices job: streams a real PDF and writes a done row", async () => {
    const { center, tables } = setup();
    const { job, pdf } = await center.createJob("org-1", "actor", { type: "invoices", orderIds: ["ord-a", "ord-b"] });
    expect(pdf).not.toBeNull();
    expect(pdf!.toString("latin1").startsWith("%PDF")).toBe(true);
    expect(job).toMatchObject({ type: "invoices", status: "done", orderCount: 2, failedOrderIds: [] });
    expect(tables.printJob.rows).toHaveLength(1);
  });

  it("labels job: order without a shipment lands in failedOrderIds, the rest print", async () => {
    const { center } = setup();
    const { job, pdf, failedReasons } = await center.createJob("org-1", "actor", { type: "labels", orderIds: ["ord-a", "ord-b"] });
    expect(pdf).not.toBeNull();
    expect(pdf!.toString("latin1")).toContain("TRKA1");
    expect(job.status).toBe("done");
    expect(job.failedOrderIds).toEqual(["ord-b"]);
    expect(failedReasons["ord-b"]).toContain("বুকিং নেই");
  });

  it("labels job with NO printable order is a failed job with no PDF", async () => {
    const { center, tables } = setup();
    const { job, pdf } = await center.createJob("org-1", "actor", { type: "labels", orderIds: ["ord-b"] });
    expect(pdf).toBeNull();
    expect(job.status).toBe("failed");
    expect(job.error).toContain("লেবেল ছাপানো যায়নি");
    expect(tables.printJob.rows[0].failedOrderIds).toEqual(["ord-b"]);
  });

  it("foreign / nonexistent order ids fail the WHOLE request before any job row", async () => {
    const { center, tables } = setup();
    // MB4: coded ApiException — the missing ids travel in params.
    await expect(center.createJob("org-1", "actor", { type: "invoices", orderIds: ["ord-a", "ord-foreign"] }))
      .rejects.toMatchObject({ code: "print.ordersNotFoundInOrg", params: { ids: "ord-foreign" } });
    expect(tables.printJob.rows).toHaveLength(0);
  });

  it("a generation throw writes a failed row and returns no PDF", async () => {
    const { center, tables } = setup();
    (center as any).courierCache = { invoicesPdf: async () => { throw new Error("pdf engine exploded"); } };
    const { job, pdf } = await center.createJob("org-1", "actor", { type: "invoices", orderIds: ["ord-a"] });
    expect(pdf).toBeNull();
    expect(job).toMatchObject({ status: "failed", error: "pdf engine exploded" });
    expect(tables.printJob.rows).toHaveLength(1);
  });

  it("packing slips go through the server slip builder (gift message + gift marker + SKU)", async () => {
    const { center } = setup();
    const { job, pdf } = await center.createJob("org-1", "actor", { type: "packing_slips", orderIds: ["ord-a"] });
    expect(job.status).toBe("done");
    const s = pdf!.toString("latin1");
    expect(s).toContain("PACKING SLIP");
    expect(s).toContain("Gift message: Happy Birthday, Apu!");
    expect(s).toContain("GIFT - Cotton T-Shirt");
    expect(s).toContain("SKU: TS-001");
  });

  it("job history + getJob are org-scoped (foreign job → 404)", async () => {
    const { center } = setup();
    const { job } = await center.createJob("org-1", "actor", { type: "invoices", orderIds: ["ord-a"] });
    const list = await center.listJobs("org-1");
    expect(list.total).toBe(1);
    expect(list.items[0].id).toBe(job.id);
    await expect(center.getJob("org-2", job.id)).rejects.toMatchObject({ code: "print.jobNotFound" });
    expect((await center.listJobs("org-2")).total).toBe(0);
  });
});

describe("ON10 template settings", () => {
  it("rejects a non-http(s) logo URL and accepts a valid one (audited)", async () => {
    const { center, auditLog } = setup();
    await expect(center.updateTemplate("org-1", "actor", { logoUrl: "ftp://x/y.png" })).rejects.toMatchObject({ code: "print.logoUrlMustBeHttp" });
    const saved = await center.updateTemplate("org-1", "actor", { logoUrl: "https://shop.example/logo.png", footerText: "ধন্যবাদ" });
    expect(saved.logoUrl).toBe("https://shop.example/logo.png");
    expect((await center.getTemplate("org-1")).footerText).toBe("ধন্যবাদ");
    expect(auditLog.some((e) => e.action === "orders.print_template_updated")).toBe(true);
  });

  it("no template row → templateForPrint is null (pre-ON10 defaults)", async () => {
    const { center } = setup();
    expect(await center.templateForPrint("org-1")).toBeNull();
  });

  it("invoice bytes: empty template == no template; a set footer changes the output", async () => {
    const { courier } = setup();
    const plain = await courier.invoicesPdf("org-1", ["ord-a"]);
    const emptyTpl = await courier.invoicesPdf("org-1", ["ord-a"], { template: { logoUrl: null, footerText: null, termsText: null, invoiceNote: null } });
    expect(Buffer.compare(plain, emptyTpl)).toBe(0);
    const withFooter = await courier.invoicesPdf("org-1", ["ord-a"], { template: { footerText: "Dhonnobad Footer" } });
    expect(Buffer.compare(plain, withFooter)).not.toBe(0);
    expect(withFooter.toString("latin1")).toContain("Dhonnobad Footer");
    const withNote = await courier.invoicesPdf("org-1", ["ord-a"], { template: { invoiceNote: "Handle with care" } });
    expect(withNote.toString("latin1")).toContain("Note: Handle with care");
  });
});

describe("ON10 challans (real CourierService builders)", () => {
  it("COD due = total − APPROVED verifications only (pending never counts)", async () => {
    const { courier } = setup();
    const buf = await courier.challansPdf("org-1", ["ord-a"], null);
    const s = buf.toString("latin1");
    expect(s).toContain("DELIVERY CHALLAN");
    // 150000 total − 50000 approved = 100000 → BDT 1,000.00 (the 99900 pending row must not move it)
    expect(s).toContain("COD amount due: BDT 1,000.00");
  });

  it("a fully-paid order's challan says no COD due", async () => {
    const { courier, tables } = setup();
    tables.paymentVerification.rows.push({ id: "pv-3", organizationId: "org-1", orderId: "ord-b", status: "approved", amountMinor: 80000n, createdAt: new Date() });
    const s = (await courier.challansPdf("org-1", ["ord-b"], null)).toString("latin1");
    // PDF string literals escape parentheses: the stored text is
    // "No COD due (already paid)" → "No COD due \(already paid\)".
    expect(s).toContain("No COD due \\(already paid\\)");
  });
});

describe("ON10 bulk reroute (ON1 print actions create print jobs)", () => {
  function bulkSetup() {
    const env = setup();
    const ordersStub: any = {};
    const courierStub: any = {};
    const bulk = new OrdersBulkService(env.tables as any, ordersStub, courierStub, env.audit as any, env.center as any);
    return { ...env, bulk };
  }

  it("print_invoices: results carry the print job id and out.print names the job", async () => {
    const { bulk, tables } = bulkSetup();
    const out = await bulk.bulk("org-1", "actor", { orderIds: ["ord-a", "ord-b"], action: "print_invoices" });
    expect(out.succeeded).toBe(2);
    expect(out.print).toMatchObject({ type: "invoices", status: "done" });
    expect(out.results.every((r: any) => r.printJobId === out.print.jobId)).toBe(true);
    expect(tables.printJob.rows).toHaveLength(1);
  });

  it("print_labels: an order with no shipment fails per-order with the job's reason", async () => {
    const { bulk } = bulkSetup();
    const out = await bulk.bulk("org-1", "actor", { orderIds: ["ord-a", "ord-b"], action: "print_labels" });
    const byId = Object.fromEntries(out.results.map((r: any) => [r.orderId, r]));
    expect(byId["ord-a"].ok).toBe(true);
    expect(byId["ord-a"].printJobId).toBeTruthy();
    expect(byId["ord-b"].ok).toBe(false);
    expect(byId["ord-b"].error).toContain("বুকিং নেই");
    expect(out.print.status).toBe("done");
  });
});
