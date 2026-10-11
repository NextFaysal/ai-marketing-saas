import { RiskService } from "./risk.service";
import { summarizeHistory } from "./risk-score";
import { CustomersService } from "../customers/customers.service";

/**
 * CX1 — Customer Courier Record.
 *
 * The record must reuse the EXACT M50 classification (asserted by
 * comparing against summarizeHistory over the same fixture),
 * compute the delivery success rate honestly (null when nothing
 * decided — never a fake 0), split per courier by the LATEST
 * shipment's provider (provider-less shipments group as "অন্যান্য";
 * shipment-less orders count in totals only), and keep M50's
 * tenant isolation (another org's orders on the same phone are
 * invisible). The success rate is NOT the inverse of the risk
 * score — the fixture is chosen so the two numbers differ (57 vs
 * 43) and both are asserted.
 */
describe("CX1 courierRecordForCustomer", () => {
  const ORG = "org-1";
  const PHONE = "01712345678";
  const customers = [
    { id: "c1", organizationId: ORG, phone: PHONE, firstName: "Record" },
    { id: "c2", organizationId: ORG, phone: "01899999999", firstName: "New" },
  ];
  const mkOrder = (id: string, organizationId: string, status: string, extra: any = {}) => ({
    id, organizationId, status, isCod: true, customerId: "c1", conversationId: null, address: null,
    customer: { phone: PHONE }, ...extra,
  });
  const orders = [
    mkOrder("o1", ORG, "completed"),
    mkOrder("o2", ORG, "processing"),
    // no customer link — the phone resolves via the shipment recipient
    mkOrder("o3", ORG, "cancelled", { customerId: null, customer: null }),
    mkOrder("o4", ORG, "refunded"),
    mkOrder("o5", ORG, "pending"),
    mkOrder("o7", ORG, "processing"),
    mkOrder("o8", ORG, "processing"),
    // delivered with NO shipment: totals only, never attributed
    mkOrder("o9", ORG, "completed"),
    // c2's only order — still open, so c2 has no decided history
    mkOrder("o10", ORG, "pending", { customerId: "c2", customer: { phone: "01899999999" } }),
    // another org's cancelled order on the SAME phone — invisible
    mkOrder("ox1", "org-2", "cancelled"),
  ];
  const shipments = [
    { orderId: "o1", organizationId: ORG, provider: "Steadfast", status: "delivered", recipientPhone: PHONE, recipientAddress: "", createdAt: new Date("2026-09-01T10:00:00Z"), updatedAt: new Date("2026-09-03T10:00:00Z") },
    { orderId: "o2", organizationId: ORG, provider: "Pathao", status: "returned", recipientPhone: PHONE, recipientAddress: "", createdAt: new Date("2026-09-05T10:00:00Z"), updatedAt: new Date("2026-09-08T10:00:00Z") },
    { orderId: "o3", organizationId: ORG, provider: "Steadfast", status: "cancelled", recipientPhone: PHONE, recipientAddress: "", createdAt: new Date("2026-09-06T10:00:00Z"), updatedAt: new Date("2026-09-06T10:00:00Z") },
    { orderId: "o7", organizationId: ORG, provider: "RedX", status: "in_transit", recipientPhone: PHONE, recipientAddress: "", createdAt: new Date("2026-09-10T10:00:00Z"), updatedAt: new Date("2026-09-11T10:00:00Z") },
    { orderId: "o7", organizationId: ORG, provider: "Pathao", status: "delivered", recipientPhone: PHONE, recipientAddress: "", createdAt: new Date("2026-09-12T10:00:00Z"), updatedAt: new Date("2026-09-14T09:30:00Z") },
    { orderId: "o8", organizationId: ORG, provider: "", status: "delivered", recipientPhone: PHONE, recipientAddress: "", createdAt: new Date("2026-09-15T10:00:00Z"), updatedAt: new Date("2026-09-16T08:00:00Z") },
  ];
  const prismaStub = {
    customer: { findFirst: async ({ where }: any) => customers.find((c) => c.id === where.id && c.organizationId === where.organizationId) ?? null },
    order: { findMany: async ({ where }: any) => orders.filter((o) => o.organizationId === where.organizationId) },
    courierShipment: { findMany: async ({ where }: any) => shipments.filter((s) => s.organizationId === where.organizationId) },
    channelConversation: { findMany: async () => [] },
  };
  const svc = new RiskService(prismaStub as any);

  it("counts reuse the exact M50 classification (same fixture -> same buckets)", async () => {
    const rec = await svc.courierRecordForCustomer(ORG, "c1");
    const historyOrders = orders.filter((o) => o.organizationId === ORG && o.id !== "o10");
    const expected = summarizeHistory(historyOrders.map((o) => ({
      status: o.status, isCod: true,
      shipmentStatuses: shipments.filter((s) => s.orderId === o.id).map((s) => s.status),
    })));
    expect(rec.delivered).toBe(expected.delivered);
    expect(rec.returned).toBe(expected.returned);
    expect(rec.cancelledOrFailed).toBe(expected.cancelledOrFailed);
    expect(rec.refunded).toBe(expected.refunded);
    expect(rec.decided).toBe(expected.delivered + expected.returned + expected.cancelledOrFailed + expected.refunded);
    // org-2's cancelled order on the same phone never leaks in
    expect(rec.cancelledOrFailed).toBe(1);
  });

  it("success rate = delivered/decided rounded; distinct from the risk score", async () => {
    const rec = await svc.courierRecordForCustomer(ORG, "c1");
    expect(rec.decided).toBe(7);
    expect(rec.delivered).toBe(4);
    expect(rec.successRatePct).toBe(57);
    // M50 risk on the same history: negatives 3/7 -> score 43, band medium.
    // The success rate (57) is NOT 100 - score; both ride the payload.
    expect(rec.riskScore).toBe(43);
    expect(rec.riskBand).toBe("medium");
  });

  it("per-courier split attributes by the LATEST shipment; provider-less groups as অন্যান্য", async () => {
    const rec = await svc.courierRecordForCustomer(ORG, "c1");
    const byProvider = new Map(rec.perCourier.map((p) => [p.provider, p]));
    expect(byProvider.get("Steadfast")).toEqual({ provider: "Steadfast", decided: 2, delivered: 1, successRatePct: 50 });
    // o7 counts under Pathao (its latest shipment), never RedX
    expect(byProvider.get("Pathao")).toEqual({ provider: "Pathao", decided: 2, delivered: 1, successRatePct: 50 });
    expect(byProvider.has("RedX")).toBe(false);
    expect(byProvider.get("অন্যান্য")).toEqual({ provider: "অন্যান্য", decided: 1, delivered: 1, successRatePct: 100 });
    // decided across buckets = decided orders WITH a shipment (o4 refunded + o9 delivered have none)
    expect(rec.perCourier.reduce((s, p) => s + p.decided, 0)).toBe(5);
    expect(rec.totalShipments).toBe(6);
    expect(rec.lastDeliveryAt).toBe("2026-09-16T08:00:00.000Z");
  });

  it("decided = 0 -> successRatePct null (never fake 0), band unknown", async () => {
    const rec = await svc.courierRecordForCustomer(ORG, "c2");
    expect(rec.decided).toBe(0);
    expect(rec.successRatePct).toBeNull();
    expect(rec.perCourier).toEqual([]);
    expect(rec.riskBand).toBe("unknown");
    expect(rec.riskScore).toBeNull();
    expect(rec.lastDeliveryAt).toBeNull();
  });

  it("unknown customer id -> the empty record shape, no throw", async () => {
    const rec = await svc.courierRecordForCustomer(ORG, "nope");
    expect(rec).toEqual({
      decided: 0, delivered: 0, returned: 0, cancelledOrFailed: 0, refunded: 0,
      successRatePct: null, perCourier: [], lastDeliveryAt: null, totalShipments: 0,
      riskBand: "unknown", riskScore: null,
    });
  });

  it("customers detail carries courierRecord additively next to risk", async () => {
    const customer = customers[0];
    const detailOrders = [
      { id: "o1", organizationId: ORG, customerId: "c1", status: "completed", isCod: true, totalMinor: 500n, subtotalMinor: 500n, shippingMinor: 0n, discountMinor: 0n, taxMinor: 0n, refundedMinor: 0n, createdAt: new Date() },
    ];
    const prisma = {
      customer: { findFirst: async () => customer },
      order: {
        findMany: async ({ where }: any) => where.customerId
          ? detailOrders
          : orders.filter((o) => o.organizationId === where.organizationId),
      },
      channelConversation: { findMany: async () => [] },
      courierShipment: {
        findMany: async ({ where }: any) => where.orderId
          ? shipments.filter((s) => where.orderId.in.includes(s.orderId))
          : shipments.filter((s) => s.organizationId === where.organizationId),
      },
      lead: { findFirst: async () => null },
    };
    const svc2 = new CustomersService(prisma as any, { log: async () => undefined } as any, new RiskService(prisma as any));
    const detail: any = await svc2.detail(ORG, "c1");
    expect(detail.risk).toBeTruthy();
    expect(detail.courierRecord).toBeTruthy();
    expect(detail.courierRecord.successRatePct).toBe(57);
    expect(detail.courierRecord.decided).toBe(7);
    expect(() => JSON.stringify(detail)).not.toThrow();
  });
});
