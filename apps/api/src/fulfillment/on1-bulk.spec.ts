import "reflect-metadata";
import { OrdersBulkService } from "./orders-bulk.service";
import { OrdersService } from "../orders/orders.service";

/** ON1 — bulk actions (hosted in the Fulfillment module). */

function setup() {
  const rows: Record<string, any> = {
    o1: { id: "o1", organizationId: "org-1", status: "processing", totalMinor: 1000n, refundedMinor: 0n, subtotalMinor: 1000n, shippingMinor: 0n, discountMinor: 0n, taxMinor: 0n, items: [], customer: { firstName: "Rahim", lastName: "Uddin", phone: "01711000001", address: { address_1: "Road 1", district: "Dhaka" } }, address: "Road 1, Dhaka", tags: ["vip"], assigneeId: null },
    o2: { id: "o2", organizationId: "org-1", status: "completed", totalMinor: 1000n, refundedMinor: 0n, subtotalMinor: 1000n, shippingMinor: 0n, discountMinor: 0n, taxMinor: 0n, items: [], customer: { firstName: "Karim", lastName: "", phone: "01711000002", address: null }, address: "Road 2, Khulna", tags: [], assigneeId: null },
    "o-nophone": { id: "o-nophone", organizationId: "org-1", status: "processing", totalMinor: 1000n, refundedMinor: 0n, subtotalMinor: 1000n, shippingMinor: 0n, discountMinor: 0n, taxMinor: 0n, items: [], customer: { firstName: "No", lastName: "Phone", phone: null, address: { address_1: "Somewhere", district: "Dhaka" } }, address: "Somewhere, Dhaka", tags: [], assigneeId: null },
    "o-noaddr": { id: "o-noaddr", organizationId: "org-1", status: "processing", totalMinor: 1000n, refundedMinor: 0n, subtotalMinor: 1000n, shippingMinor: 0n, discountMinor: 0n, taxMinor: 0n, items: [], customer: { firstName: "No", lastName: "Addr", phone: "01711000009", address: null }, address: null, tags: [], assigneeId: null },
    "o-badcourier": { id: "o-badcourier", organizationId: "org-1", status: "processing", totalMinor: 1000n, refundedMinor: 0n, subtotalMinor: 1000n, shippingMinor: 0n, discountMinor: 0n, taxMinor: 0n, items: [], customer: { firstName: "Bad", lastName: "Courier", phone: "01711000010", address: null }, address: "Road 9, Dhaka", tags: [], assigneeId: null },
  };
  const shipments: any[] = [
    { id: "s-old", organizationId: "org-1", orderId: "o1", provider: "steadfast", createdAt: new Date("2026-10-01T10:00:00Z") },
    { id: "s-new", organizationId: "org-1", orderId: "o1", provider: "steadfast", createdAt: new Date("2026-10-03T10:00:00Z") },
  ];
  const prisma: any = {
    order: {
      findFirst: jest.fn(async ({ where }: any) => {
        const row = rows[where.id];
        if (!row) return null;
        if (where.organizationId && where.organizationId !== row.organizationId) return null;
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => { Object.assign(rows[where.id], data); return rows[where.id]; }),
    },
    courierShipment: { findMany: jest.fn(async ({ where }: any) => shipments.filter((s) => s.orderId === where.orderId)) },
    paymentVerification: { findMany: jest.fn(async () => []), groupBy: jest.fn(async () => []) },
    membership: { findFirst: jest.fn(async ({ where }: any) => (where.userId === "u-good" ? { userId: "u-good", role: "SUPPORT_AGENT", status: "ACTIVE" } : null)) },
  };
  const audit = { log: jest.fn(async () => undefined) };
  const orders = new OrdersService(prisma, undefined, undefined, audit as any, { applyOrderRestore: jest.fn(async () => ({})) } as any, { emit: jest.fn(), on: jest.fn() } as any);
  const courier: any = {
    bookShipment: jest.fn(async (_org: string, _actor: string, dto: any) => {
      if (dto.orderId === "o-badcourier") throw new Error("Steadfast API down");
      return { id: "s-booked", orderId: dto.orderId };
    }),
  };
  const bulk = new OrdersBulkService(prisma, orders, courier, audit as any);
  return { bulk, rows, prisma, audit, courier };
}

describe("ON1 bulk", () => {
  it("whole-request validation fails before any per-order work", async () => {
    const { bulk, prisma } = setup();
    await expect(bulk.bulk("org-1", "actor", { orderIds: [], action: "set_status", params: { status: "completed" } })).rejects.toThrow(/অর্ডার বেছে নিন/);
    await expect(bulk.bulk("org-1", "actor", { orderIds: ["o1"], action: "nope" })).rejects.toThrow(/bulk action/);
    await expect(bulk.bulk("org-1", "actor", { orderIds: ["o1"], action: "set_status", params: {} })).rejects.toThrow(/status/);
    await expect(bulk.bulk("org-1", "actor", { orderIds: ["o1"], action: "add_tag", params: {} })).rejects.toThrow(/ট্যাগ/);
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it("dedupes ids", async () => {
    const { bulk } = setup();
    const out = await bulk.bulk("org-1", "actor", { orderIds: ["o1", "o1"], action: "print_invoices" });
    expect(out.results).toHaveLength(1);
  });

  it("set_status: partial failure is honest — transition refusal ships verbatim per order + one summary audit", async () => {
    const { bulk, rows, audit } = setup();
    const out = await bulk.bulk("org-1", "actor", { orderIds: ["o1", "o2", "missing"], action: "set_status", params: { status: "pending" } });
    expect(rows.o1.status).toBe("pending");
    expect(out.succeeded).toBe(1);
    expect(out.failed).toBe(2);
    const o2 = out.results.find((r: any) => r.orderId === "o2");
    expect(o2.ok).toBe(false);
    expect(o2.error).toContain("নেওয়া যাবে না");
    const missing = out.results.find((r: any) => r.orderId === "missing");
    expect(missing.error).toBe("Order not found in this organization");
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: "orders.bulk", metadata: { action: "set_status", total: 3, succeeded: 1, failed: 2 },
    }));
  });

  it("add_tag / remove_tag mutate through setTags", async () => {
    const { bulk, rows } = setup();
    await bulk.bulk("org-1", "actor", { orderIds: ["o1"], action: "add_tag", params: { tag: "urgent" } });
    expect(rows.o1.tags).toEqual(["vip", "urgent"]);
    await bulk.bulk("org-1", "actor", { orderIds: ["o1"], action: "add_tag", params: { tag: "urgent" } });
    expect(rows.o1.tags).toEqual(["vip", "urgent"]);
    await bulk.bulk("org-1", "actor", { orderIds: ["o1"], action: "remove_tag", params: { tag: "vip" } });
    expect(rows.o1.tags).toEqual(["urgent"]);
  });

  it("assign: invalid assignee fails the WHOLE request once; valid assignee applies per order", async () => {
    const { bulk, rows } = setup();
    await expect(bulk.bulk("org-1", "actor", { orderIds: ["o1", "o2"], action: "assign", params: { assigneeId: "ghost" } }))
      .rejects.toThrow(/সক্রিয় সদস্য নন/);
    expect(rows.o1.assigneeId).toBeNull();
    const out = await bulk.bulk("org-1", "actor", { orderIds: ["o1"], action: "assign", params: { assigneeId: "u-good" } });
    expect(out.succeeded).toBe(1);
    expect(rows.o1.assigneeId).toBe("u-good");
    const un = await bulk.bulk("org-1", "actor", { orderIds: ["o1"], action: "assign", params: { assigneeId: null } });
    expect(un.succeeded).toBe(1);
    expect(rows.o1.assigneeId).toBeNull();
  });

  it("book_courier: phone/address errors are the pinned Bengali messages; courier errors verbatim", async () => {
    const { bulk, courier } = setup();
    const out = await bulk.bulk("org-1", "actor", {
      orderIds: ["o1", "o-nophone", "o-noaddr", "o-badcourier"], action: "book_courier", params: { provider: "steadfast" },
    });
    expect(out.succeeded).toBe(1);
    expect(out.failed).toBe(3);
    expect(out.results.find((r: any) => r.orderId === "o-nophone").error).toBe("গ্রাহকের ফোন নম্বর নেই");
    expect(out.results.find((r: any) => r.orderId === "o-noaddr").error).toBe("ডেলিভারির ঠিকানা নেই");
    expect(out.results.find((r: any) => r.orderId === "o-badcourier").error).toBe("Steadfast API down");
    expect(courier.bookShipment).toHaveBeenCalledWith("org-1", "actor", expect.objectContaining({
      orderId: "o1", recipientName: "Rahim Uddin", recipientPhone: "01711000001", recipientAddress: "Road 1, Dhaka", provider: "steadfast",
    }));
    await expect(bulk.bulk("org-1", "actor", { orderIds: ["o1"], action: "book_courier", params: { provider: "bogus" } })).rejects.toThrow(/প্রোভাইডার/);
  });

  it("book_courier: address falls back to the composed customer.address Json", async () => {
    const { bulk, rows, courier } = setup();
    rows.o2.address = null;
    rows.o2.customer.address = { address_1: "House 5", district: "Khulna" };
    const out = await bulk.bulk("org-1", "actor", { orderIds: ["o2"], action: "book_courier", params: {} });
    expect(out.succeeded).toBe(1);
    expect(courier.bookShipment).toHaveBeenCalledWith("org-1", "actor", expect.objectContaining({ recipientAddress: "House 5, Khulna" }));
  });

  it("print actions collect ids; missing booking is a per-order error", async () => {
    const { bulk } = setup();
    const labels = await bulk.bulk("org-1", "actor", { orderIds: ["o1", "o2"], action: "print_labels" });
    expect(labels.print).toEqual({ labelShipmentIds: ["s-new"] });
    expect(labels.results.find((r: any) => r.orderId === "o2").error).toBe("কুরিয়ার বুকিং নেই");
    const invoices = await bulk.bulk("org-1", "actor", { orderIds: ["o1", "missing"], action: "print_invoices" });
    expect(invoices.print).toEqual({ invoiceOrderIds: ["o1"] });
    expect(invoices.succeeded).toBe(1);
    expect(invoices.failed).toBe(1);
  });
});
