process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.DISABLE_SCHEDULER = "true";

import { CourierService } from "./courier.service";
import { CODE128_PATTERNS, encodeCode128 } from "./barcode";
import { buildPdf, invoicePage, shippingLabelPage } from "./pdf";

describe("Code128 encoder (known vectors)", () => {
  it("pattern table invariants: 107 symbols, 11 modules each, 13-module stop", () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    CODE128_PATTERNS.slice(0, 106).forEach((p) => {
      expect(p.split("").reduce((a, d) => a + Number(d), 0)).toBe(11);
    });
    expect(CODE128_PATTERNS[106].split("").reduce((a, d) => a + Number(d), 0)).toBe(13);
    expect(CODE128_PATTERNS[0]).toBe("212222");
    expect(CODE128_PATTERNS[104]).toBe("211214"); // Start B
    expect(CODE128_PATTERNS[105]).toBe("211232"); // Start C
    expect(CODE128_PATTERNS[106]).toBe("2331112"); // Stop
  });

  it("encodes 'HI' in set B with the textbook checksum", () => {
    const enc = encodeCode128("HI");
    expect(enc.codeSet).toBe("B");
    // Start B=104, H=40, I=41, checksum (104 + 40*1 + 41*2) % 103 = 226 % 103 = 20, Stop=106
    expect(enc.values).toEqual([104, 40, 41, 20, 106]);
  });

  it("encodes an even-length digit string in dense set C", () => {
    const enc = encodeCode128("123456");
    expect(enc.codeSet).toBe("C");
    // Start C=105, pairs 12/34/56, checksum (105 + 12 + 68 + 168) % 103 = 353 % 103 = 44
    expect(enc.values).toEqual([105, 12, 34, 56, 44, 106]);
    // every symbol contributes its pattern widths
    expect(enc.widths.length).toBe(6 * 6 + 1);
  });

  it("encodes a single char and rejects payloads outside set B", () => {
    expect(encodeCode128("A").values).toEqual([104, 33, 34, 106]);
    expect(() => encodeCode128("TRK-ঢাকা")).toThrow(/outside code set B/);
    expect(() => encodeCode128("")).toThrow(/empty/);
    // odd-length digits stay in set B
    expect(encodeCode128("12345").codeSet).toBe("B");
  });
});

describe("PDF generator", () => {
  it("label PDF is real PDF bytes containing the tracking id and a drawn barcode", () => {
    const buf = buildPdf([shippingLabelPage({
      orgName: "Test Shop", orgPhone: "01700000000", provider: "steadfast",
      recipientName: "Rahim Uddin", recipientPhone: "01711111111",
      recipientAddress: "House 1, Road 2, Mirpur, Dhaka",
      invoice: "1042", trackingCode: "TRK9XYZ", codAmountMinor: 150000n, currency: "BDT",
    })]);
    const s = buf.toString("latin1");
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s).toContain("TRK9XYZ");
    expect(s).toContain("COD: BDT 1,500.00");
    expect(s).toContain(" re f"); // vector rectangles = the barcode bars
    expect(s).toContain("%%EOF");
  });

  it("invoice PDF carries the stored order's items and totals", () => {
    const buf = buildPdf([invoicePage({
      orgName: "Test Shop", orgPhone: null, invoiceNo: "1042", date: "2026-10-11",
      customerName: "Rahim Uddin", customerPhone: "01711111111",
      items: [{ name: "Cotton T-Shirt", quantity: 2, totalMinor: 120000n }],
      subtotalMinor: 120000n, shippingMinor: 6000n, discountMinor: 0n, totalMinor: 126000n,
      paymentLabel: "Cash on Delivery (COD)", currency: "BDT",
    })]);
    const s = buf.toString("latin1");
    expect(s.startsWith("%PDF")).toBe(true);
    expect(s).toContain("Cotton T-Shirt");
    expect(s).toContain("BDT 1,260.00");
    expect(s).toContain("Invoice: 1042");
  });
});

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(row[k]);
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
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => matches(r, where ?? {})); if (row) Object.assign(row, data); return row ?? null; },
  };
}

describe("CourierService bulk booking + PDFs (M53)", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  function setup() {
    const tables: Record<string, any> = {};
    for (const n of ["integration", "integrationCredential", "order", "customer", "courierShipment", "organization", "businessProfile", "orderItem"]) tables[n] = makeTable(n);
    const origFindFirst = tables.integration.findFirst;
    tables.integration.findFirst = async (args: any) => {
      const row = await origFindFirst(args);
      if (row && args?.include?.credential) {
        const cred = tables.integrationCredential.rows.find((c: any) => c.integrationId === row.id);
        return { ...row, credential: cred ?? null };
      }
      return row;
    };
    tables.organization.rows.push({ id: "org-1", name: "Test Shop", currency: "BDT" });
    tables.businessProfile.rows.push({ organizationId: "org-1", contactPhone: "01700000000" });
    tables.customer.rows.push({ id: "cus-1", organizationId: "org-1", firstName: "Rahim", lastName: "Uddin", phone: "01711111111" });
    const base = { organizationId: "org-1", customerId: "cus-1", isCod: true, totalMinor: 150000n, status: "processing" };
    tables.order.rows.push(
      { ...base, id: "ord-a", externalNumber: "A1", address: "House 1, Road 2, Mirpur, Dhaka" },
      { ...base, id: "ord-b", externalNumber: "FAILME", address: "House 9, Road 3, Uttara, Dhaka" },
      { ...base, id: "ord-c", externalNumber: "C3", address: null },
      { ...base, id: "ord-d", externalNumber: "D4", address: "House 4, Road 5, Banani, Dhaka" },
    );
    tables.orderItem.rows.push({ id: "oi-1", orderId: "ord-a", name: "Cotton T-Shirt", quantity: 2, priceMinor: 60000n, totalMinor: 120000n });
    tables.order.rows.find((o: any) => o.id === "ord-a").subtotalMinor = 120000n;
    tables.order.rows.find((o: any) => o.id === "ord-a").shippingMinor = 6000n;
    tables.order.rows.find((o: any) => o.id === "ord-a").discountMinor = 0n;
    tables.order.rows.find((o: any) => o.id === "ord-a").placedAt = new Date("2026-10-11T00:00:00Z");
    tables.courierShipment.rows.push({
      id: "ship-d", organizationId: "org-1", orderId: "ord-d", provider: "steadfast",
      consignmentId: "900", trackingCode: "OLD1", invoice: "D4", status: "in_review",
      recipientName: "Rahim Uddin", recipientPhone: "01711111111", recipientAddress: "House 4, Road 5, Banani, Dhaka",
      codAmountMinor: 150000n, createdAt: new Date(), updatedAt: new Date(),
    });
    const auditLog: any[] = [];
    const svc = new CourierService(tables as any, { log: async (e: any) => { auditLog.push(e); } } as any, undefined);
    return { tables, svc, auditLog };
  }

  function stubSteadfast() {
    global.fetch = (async (url: string, init?: any) => {
      const u = String(url);
      if (u.includes("/get_balance")) return { ok: true, status: 200, json: async () => ({ status: 200, current_balance: 750 }) };
      if (u.includes("/create_order")) {
        const body = String(init?.body ?? "");
        if (body.includes("FAILME")) return { ok: false, status: 422, json: async () => ({ status: 422, message: "Recipient phone is invalid" }) };
        return { ok: true, status: 200, json: async () => ({ status: 200, consignment: { consignment_id: 777, tracking_code: "TRKBULK", status: "in_review" } }) };
      }
      throw new Error("unexpected url " + u);
    }) as any;
  }

  it("partial-failure matrix: one books, provider error + missing address fail per-order, already-booked skips, unknown order errors — nothing stops the rest", async () => {
    const { tables, svc, auditLog } = setup();
    stubSteadfast();
    await svc.connect("org-1", "owner", { provider: "steadfast", apiKey: "k", secretKey: "s" });
    const out = await svc.bookBulk("org-1", "agent", { provider: "steadfast", orderIds: ["ord-a", "ord-b", "ord-c", "ord-d", "ord-missing"] });
    expect(out).toMatchObject({ requested: 5, booked: 1, skipped: 1, failed: 3 });
    const byId = Object.fromEntries(out.results.map((r) => [r.orderId, r]));
    expect(byId["ord-a"]).toMatchObject({ ok: true, trackingCode: "TRKBULK" });
    expect(byId["ord-b"].ok).toBe(false);
    expect(byId["ord-b"].error).toContain("Recipient phone is invalid"); // provider's own words
    expect(byId["ord-c"].error).toContain("ঠিকানা"); // booking validation, verbatim
    expect(byId["ord-d"].skipped).toBe(true);
    expect(byId["ord-d"].error).toContain("ইতিমধ্যে বুক করা আছে");
    expect(byId["ord-d"].trackingCode).toBe("OLD1");
    expect(byId["ord-missing"].error).toContain("Order not found");
    // exactly one NEW shipment was created (ord-a); ord-d was never double-booked
    expect(tables.courierShipment.rows).toHaveLength(2);
    const batch = auditLog.find((e) => e.action === "courier.shipments.bulk_booked");
    expect(batch?.metadata).toMatchObject({ provider: "steadfast", requested: 5, booked: 1, skipped: 1, failed: 3 });
  });

  it("a second bulk run over a just-booked order skips it (no double booking ever)", async () => {
    const { tables, svc } = setup();
    stubSteadfast();
    await svc.connect("org-1", "owner", { provider: "steadfast", apiKey: "k", secretKey: "s" });
    const first = await svc.bookBulk("org-1", "agent", { provider: "steadfast", orderIds: ["ord-a"] });
    expect(first.booked).toBe(1);
    const second = await svc.bookBulk("org-1", "agent", { provider: "steadfast", orderIds: ["ord-a"] });
    expect(second).toMatchObject({ booked: 0, skipped: 1, failed: 0 });
    expect(tables.courierShipment.rows.filter((r: any) => r.orderId === "ord-a")).toHaveLength(1);
  });

  it("enforces the 50-order cap and the empty-batch refusal", async () => {
    const { svc } = setup();
    stubSteadfast();
    await svc.connect("org-1", "owner", { provider: "steadfast", apiKey: "k", secretKey: "s" });
    const ids = Array.from({ length: 51 }, (_, i) => `ord-${i}`);
    await expect(svc.bookBulk("org-1", "agent", { provider: "steadfast", orderIds: ids })).rejects.toThrow(/৫০/);
    await expect(svc.bookBulk("org-1", "agent", { provider: "steadfast", orderIds: [] })).rejects.toThrow(/কমপক্ষে একটি/);
  });

  it("labelPdf / labelsPdf return %PDF bytes containing the tracking id; invoicePdf renders the stored order", async () => {
    const { svc } = setup();
    const single = await svc.labelPdf("org-1", "ship-d");
    expect(single.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(single.toString("latin1")).toContain("OLD1");
    const combined = await svc.labelsPdf("org-1", ["ship-d"]);
    expect(combined.toString("latin1")).toContain("OLD1");
    expect(combined.toString("latin1").match(/\/Type \/Page[^s]/g)?.length).toBe(1);
    const invoice = await svc.invoicePdf("org-1", "ord-a");
    const inv = invoice.toString("latin1");
    expect(inv.startsWith("%PDF")).toBe(true);
    expect(inv).toContain("Cotton T-Shirt");
    expect(inv).toContain("Invoice: A1");
    await expect(svc.labelPdf("org-1", "nope")).rejects.toThrow(/not found/i);
    await expect(svc.invoicePdf("org-2", "ord-a")).rejects.toThrow(/not found/i); // org isolation
  });
});
