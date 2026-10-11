import { scoreRisk, classifyOutcome, phoneKey, summarizeHistory } from "./risk-score";
import { RiskService } from "./risk.service";
import { CustomersService } from "../customers/customers.service";

describe("M50 risk scorer (pure)", () => {
  it("phoneKey matches codebase convention: digits, last 10, too-short = null", () => {
    expect(phoneKey("+880 1712-345678")).toBe("1712345678");
    expect(phoneKey("01712345678")).toBe("1712345678");
    expect(phoneKey("123")).toBeNull();
    expect(phoneKey(null)).toBeNull();
  });

  it("classifies outcomes from real vocabularies; shipment return wins", () => {
    expect(classifyOutcome({ status: "completed" })).toBe("delivered");
    expect(classifyOutcome({ status: "processing", shipmentStatuses: ["delivered"] })).toBe("delivered");
    expect(classifyOutcome({ status: "processing", shipmentStatuses: ["returned"] })).toBe("returned");
    expect(classifyOutcome({ status: "cancelled" })).toBe("cancelledOrFailed");
    expect(classifyOutcome({ status: "failed" })).toBe("cancelledOrFailed");
    expect(classifyOutcome({ status: "refunded" })).toBe("refunded");
    expect(classifyOutcome({ status: "pending" })).toBe("open");
    expect(classifyOutcome({ status: "processing", shipmentStatuses: ["in_transit"] })).toBe("open");
  });

  it("no history -> unknown, never low, score null", () => {
    const r = scoreRisk([]);
    expect(r.band).toBe("unknown");
    expect(r.score).toBeNull();
    expect(r.reasons.join(" ")).toContain("তথ্য নেই");
  });

  it("history with no decided outcomes -> unknown with the honest reason", () => {
    const r = scoreRisk([{ status: "pending" }, { status: "processing", isCod: true }]);
    expect(r.band).toBe("unknown");
    expect(r.reasons.join(" ")).toContain("চূড়ান্ত ফলাফল");
  });

  it("good customer: all delivered -> low, score 0", () => {
    const r = scoreRisk([
      { status: "completed", isCod: true }, { status: "completed" },
      { status: "processing", shipmentStatuses: ["delivered"] }, { status: "completed" },
    ]);
    expect(r.band).toBe("low");
    expect(r.score).toBe(0);
    expect(r.suggestion).toBeNull();
  });

  it("high-return history -> high with advance-charge suggestion and verbatim counts", () => {
    const r = scoreRisk([
      { status: "processing", shipmentStatuses: ["returned"], isCod: true },
      { status: "processing", shipmentStatuses: ["returned"], isCod: true },
      { status: "cancelled", isCod: true },
      { status: "completed", isCod: true },
    ]);
    expect(r.band).toBe("high");
    expect(r.score).toBe(75);
    expect(r.suggestion).toContain("ডেলিভারি চার্জ অগ্রিম");
    expect(r.reasons.join(" ")).toContain("রিটার্ন 2টি");
  });

  it("thin evidence is labelled and caps conclusions honestly", () => {
    const one = scoreRisk([{ status: "completed" }]);
    expect(one.band).toBe("low");
    expect(one.reasons.join(" ")).toContain("প্রমাণ খুবই কম");
    const oneReturn = scoreRisk([{ status: "processing", shipmentStatuses: ["returned"] }]);
    expect(oneReturn.band).toBe("high");
    expect(oneReturn.reasons.join(" ")).toContain("প্রমাণ খুবই কম");
    const mixed = scoreRisk([{ status: "completed" }, { status: "cancelled" }]);
    expect(mixed.band).toBe("medium");
  });

  it("decided>=3 thresholds: 25% -> medium, 50% -> high", () => {
    const med = scoreRisk([
      { status: "completed" }, { status: "completed" }, { status: "completed" }, { status: "cancelled" },
    ]);
    expect(med.band).toBe("medium");
    expect(med.score).toBe(25);
    const high = scoreRisk([
      { status: "completed" }, { status: "completed" }, { status: "cancelled" }, { status: "refunded" },
    ]);
    expect(high.band).toBe("high");
  });

  it("summarizeHistory counts COD separately", () => {
    const h = summarizeHistory([{ status: "completed", isCod: true }, { status: "pending" }]);
    expect(h).toMatchObject({ total: 2, delivered: 1, open: 1, codOrders: 1 });
  });
});

describe("M50 RiskService — tenant isolation + phone resolution", () => {
  const ORG = "org-1";
  const OTHER = "org-2";
  const mkOrder = (id: string, organizationId: string, status: string, phone: string, extra: any = {}) => ({
    id, organizationId, status, isCod: true, customerId: `${id}-cust`, conversationId: null, address: null,
    customer: { phone }, ...extra,
  });
  const rows = {
    orders: [
      mkOrder("o-target", ORG, "pending", "01712345678"),
      mkOrder("o-p1", ORG, "processing", "+8801712345678"),
      mkOrder("o-p2", ORG, "completed", "01712345678"),
      // same phone, ANOTHER org — must never leak into org-1's score
      mkOrder("x-1", OTHER, "cancelled", "01712345678"),
      mkOrder("x-2", OTHER, "cancelled", "01712345678"),
      mkOrder("x-3", OTHER, "cancelled", "01712345678"),
    ],
    shipments: [
      { orderId: "o-p1", status: "returned", recipientPhone: "01712345678", recipientAddress: "" },
    ],
    conversations: [],
  };
  const prismaStub = {
    order: { findMany: async ({ where }: any) => rows.orders.filter((o) => o.organizationId === where.organizationId) },
    courierShipment: { findMany: async ({ where }: any) => rows.shipments.filter((s) => {
      const o = rows.orders.find((x) => x.id === s.orderId); return o?.organizationId === where.organizationId;
    }) },
    channelConversation: { findMany: async () => rows.conversations },
  };

  it("scores from the org's own rows only (other org's cancels invisible)", async () => {
    const svc = new RiskService(prismaStub as any);
    const target = rows.orders[0];
    const r = await svc.forOrder(ORG, target);
    // org-1 history: 1 returned + 1 delivered => decided 2, rate 0.5, thin => medium
    expect(r.history.total).toBe(2);
    expect(r.history.returned).toBe(1);
    expect(r.history.delivered).toBe(1);
    expect(r.band).toBe("medium");
    expect(r.phone).toBe("01712345678");
  });

  it("customer 360 detail carries the risk summary and stays JSON-serializable (BigInt regression)", async () => {
    const customer = { id: "c1", organizationId: ORG, firstName: "Risk", phone: "01712345678", source: "manual" };
    const detailOrders = [
      { id: "d1", organizationId: ORG, customerId: "c1", status: "completed", isCod: true, totalMinor: 500n, subtotalMinor: 500n, shippingMinor: 0n, discountMinor: 0n, taxMinor: 0n, refundedMinor: 0n, createdAt: new Date() },
      { id: "d2", organizationId: ORG, customerId: "c1", status: "cancelled", isCod: true, totalMinor: 300n, subtotalMinor: 300n, shippingMinor: 0n, discountMinor: 0n, taxMinor: 0n, refundedMinor: 0n, createdAt: new Date() },
    ];
    const prisma = {
      customer: { findFirst: async () => customer },
      order: { findMany: async ({ where }: any) => where.customerId ? detailOrders : rows.orders.filter((o) => o.organizationId === where.organizationId) },
      channelConversation: { findMany: async () => [] },
      courierShipment: { findMany: async () => [] },
      lead: { findFirst: async () => null },
    };
    const svc = new CustomersService(prisma as any, { log: async () => undefined } as any, new RiskService(prismaStub as any));
    const detail: any = await svc.detail(ORG, "c1");
    expect(detail.risk).toBeTruthy();
    expect(() => JSON.stringify(detail)).not.toThrow();
    expect(detail.orders[0].totalMinor).toBe("500");
  });

  it("an order with no resolvable phone is unknown, not low", async () => {
    const svc = new RiskService(prismaStub as any);
    const noPhone = { id: "np", organizationId: ORG, status: "pending", isCod: true, customer: { phone: null }, conversationId: null };
    const r = await svc.forOrder(ORG, noPhone as any);
    expect(r.band).toBe("unknown");
    expect(r.reasons.join(" ")).toContain("ফোন নম্বর পাওয়া যায়নি");
  });
});
