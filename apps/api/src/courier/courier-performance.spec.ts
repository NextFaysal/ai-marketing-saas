import { BadRequestException } from "@nestjs/common";
import { ApiException } from "../i18n";
import { CourierService } from "./courier.service";
import { classifyShipmentStatus } from "./courier-performance";

// Fake Prisma honouring the where CourierService.performance
// uses (organizationId equality + createdAt gte/lt) and take.
// Mirrors the lead-funnel.spec fake pattern.
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("lt" in v && !(row[k] != null && new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false;
      if ("gte" in v && !(row[k] != null && new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
      return true;
    }
    return row[k] === v;
  });
}
function fakePrisma() {
  const rows: any[] = [];
  return {
    courierShipment: {
      rows,
      findMany: async ({ where, take }: any = {}) => {
        const f = rows.filter((r) => matches(r, where ?? {}));
        return take ? f.slice(0, take) : f;
      },
    },
  };
}

// Fixed "now": 2026-10-11 10:00 UTC = 16:00 Dhaka. For days=30
// the window is [2026-09-11T18:00Z, 2026-10-11T18:00Z).
const NOW = new Date("2026-10-11T10:00:00.000Z");
const utc = (iso: string) => new Date(iso);
const auditStub = { log: async () => {} };

let seq = 0;
function shipment(prisma: any, over: Record<string, unknown>) {
  prisma.courierShipment.rows.push({
    id: `ship-${++seq}`, organizationId: "org-1", provider: "steadfast", status: "in_review",
    createdAt: utc("2026-10-05T10:00:00.000Z"), ...over,
  });
}

function seed(prisma: any) {
  // steadfast: 2 delivered (incl. a partial), 1 returned,
  // 1 cancelled, 2 in-flight -> booked 6, decided 4.
  shipment(prisma, { provider: "steadfast", status: "delivered" });
  shipment(prisma, { provider: "steadfast", status: "partial_delivered" });
  shipment(prisma, { provider: "steadfast", status: "returned" });
  shipment(prisma, { provider: "steadfast", status: "cancelled" });
  shipment(prisma, { provider: "steadfast", status: "in_transit" });
  shipment(prisma, { provider: "steadfast", status: "in_review" });
  // pathao: in-flight only -> decided 0, both rates null.
  shipment(prisma, { provider: "pathao", status: "in_transit" });
  // redx: 3 delivered, 1 returned.
  shipment(prisma, { provider: "redx", status: "delivered" });
  shipment(prisma, { provider: "redx", status: "delivered" });
  shipment(prisma, { provider: "redx", status: "delivered" });
  shipment(prisma, { provider: "redx", status: "returned" });
  // ecourier (an "other" provider): weird free-form statuses —
  // "Out for Delivery" (spaces/case) is in-flight, uppercase
  // "RETURNED" is returned.
  shipment(prisma, { provider: "ecourier", status: "Out for Delivery" });
  shipment(prisma, { provider: "ecourier", status: "RETURNED" });
  // zedex: window-boundary probes — exactly at start (in),
  // exactly at end (out), one second before start (out).
  shipment(prisma, { provider: "zedex", status: "delivered", createdAt: utc("2026-09-11T18:00:00.000Z") });
  shipment(prisma, { provider: "zedex", status: "delivered", createdAt: utc("2026-10-11T18:00:00.000Z") });
  shipment(prisma, { provider: "zedex", status: "delivered", createdAt: utc("2026-09-11T17:59:59.000Z") });
  // another org — must never be counted for org-1.
  shipment(prisma, { organizationId: "org-2", provider: "steadfast", status: "delivered" });
  shipment(prisma, { organizationId: "org-2", provider: "pathao", status: "returned" });
}

describe("classifyShipmentStatus", () => {
  it("maps the delivered synonyms (normalized)", () => {
    expect(classifyShipmentStatus("delivered")).toBe("delivered");
    expect(classifyShipmentStatus("partial_delivered")).toBe("delivered");
    expect(classifyShipmentStatus("partially_delivered")).toBe("delivered");
    expect(classifyShipmentStatus(" Delivered ")).toBe("delivered");
    expect(classifyShipmentStatus("PARTIAL-DELIVERED")).toBe("delivered");
  });

  it("maps the returned synonyms", () => {
    expect(classifyShipmentStatus("returned")).toBe("returned");
    expect(classifyShipmentStatus("return")).toBe("returned");
    expect(classifyShipmentStatus("RETURNED")).toBe("returned");
  });

  it("maps the cancelled synonyms", () => {
    expect(classifyShipmentStatus("cancelled")).toBe("cancelled");
    expect(classifyShipmentStatus("canceled")).toBe("cancelled");
    expect(classifyShipmentStatus("cancel")).toBe("cancelled");
    expect(classifyShipmentStatus(" Cancelled ")).toBe("cancelled");
  });

  it("treats anything else as in_flight", () => {
    expect(classifyShipmentStatus("in_transit")).toBe("in_flight");
    expect(classifyShipmentStatus("in_review")).toBe("in_flight");
    expect(classifyShipmentStatus("Out for Delivery")).toBe("in_flight");
    expect(classifyShipmentStatus("pending")).toBe("in_flight");
    expect(classifyShipmentStatus("some_unknown_status")).toBe("in_flight");
    expect(classifyShipmentStatus("")).toBe("in_flight");
    expect(classifyShipmentStatus(null)).toBe("in_flight");
    expect(classifyShipmentStatus(undefined)).toBe("in_flight");
  });
});

describe("Sales & Data S5 — courier performance report", () => {
  it("matches hand computation per provider and in totals (boundaries exact, org-isolated)", async () => {
    const prisma = fakePrisma();
    seed(prisma);
    const svc = new CourierService(prisma as any, auditStub as any);
    const out = await svc.performance("org-1", 30, NOW);

    expect(out.days).toBe(30);
    expect(out.windowStart).toBe("2026-09-11T18:00:00.000Z");
    expect(out.windowEnd).toBe("2026-10-11T18:00:00.000Z");
    expect(out.deliveryTimeAvailable).toBe(false);

    // Known providers first in fixed order, then other
    // providers present in the data, alphabetically.
    expect(out.providers.map((p: any) => p.provider)).toEqual([
      "steadfast", "pathao", "redx", "ecourier", "zedex",
    ]);

    const byProvider = new Map(out.providers.map((p: any) => [p.provider, p]));
    expect(byProvider.get("steadfast")).toEqual({
      provider: "steadfast", booked: 6, delivered: 2, returned: 1, cancelled: 1,
      inFlight: 2, decided: 4, deliveryRate: 0.5, returnRate: 0.25, avgDeliveryHours: null,
    });
    expect(byProvider.get("pathao")).toEqual({
      provider: "pathao", booked: 1, delivered: 0, returned: 0, cancelled: 0,
      inFlight: 1, decided: 0, deliveryRate: null, returnRate: null, avgDeliveryHours: null,
    });
    expect(byProvider.get("redx")).toEqual({
      provider: "redx", booked: 4, delivered: 3, returned: 1, cancelled: 0,
      inFlight: 0, decided: 4, deliveryRate: 0.75, returnRate: 0.25, avgDeliveryHours: null,
    });
    expect(byProvider.get("ecourier")).toEqual({
      provider: "ecourier", booked: 2, delivered: 0, returned: 1, cancelled: 0,
      inFlight: 1, decided: 1, deliveryRate: 0, returnRate: 1, avgDeliveryHours: null,
    });
    // Boundary: exactly-at-start is in; before-start and
    // exactly-at-end are out -> zedex booked is exactly 1.
    expect(byProvider.get("zedex")).toEqual({
      provider: "zedex", booked: 1, delivered: 1, returned: 0, cancelled: 0,
      inFlight: 0, decided: 1, deliveryRate: 1, returnRate: 0, avgDeliveryHours: null,
    });

    // Totals are hand-summed over ALL org-1 rows in the window
    // (org-2's 2 shipments are not in here).
    expect(out.totals).toEqual({
      provider: "total", booked: 14, delivered: 6, returned: 3, cancelled: 1,
      inFlight: 4, decided: 10, deliveryRate: 0.6, returnRate: 0.3, avgDeliveryHours: null,
    });
  });

  it("cross-org isolation: org-2 sees only its own shipments", async () => {
    const prisma = fakePrisma();
    seed(prisma);
    const svc = new CourierService(prisma as any, auditStub as any);
    const out = await svc.performance("org-2", 30, NOW);
    expect(out.totals.booked).toBe(2);
    expect(out.totals.delivered).toBe(1);
    expect(out.totals.returned).toBe(1);
    expect(out.providers.map((p: any) => p.provider)).toEqual(["steadfast", "pathao"]);
  });

  it("empty org: no provider rows, honest zero totals with null rates", async () => {
    const svc = new CourierService(fakePrisma() as any, auditStub as any);
    const out = await svc.performance("org-3", undefined, NOW);
    expect(out.days).toBe(30);
    expect(out.providers).toEqual([]);
    expect(out.totals).toEqual({
      provider: "total", booked: 0, delivered: 0, returned: 0, cancelled: 0,
      inFlight: 0, decided: 0, deliveryRate: null, returnRate: null, avgDeliveryHours: null,
    });
    expect(out.deliveryTimeAvailable).toBe(false);
  });

  it("validates days: integer 1..365 only, undefined defaults to 30", async () => {
    const svc = new CourierService(fakePrisma() as any, auditStub as any);
    await expect(svc.performance("org-1", "0", NOW)).rejects.toThrow(ApiException);
    await expect(svc.performance("org-1", "0", NOW)).rejects.toMatchObject({ code: "commerce.daysRange" });
    await expect(svc.performance("org-1", "366", NOW)).rejects.toMatchObject({ code: "commerce.daysRange" });
    await expect(svc.performance("org-1", "abc", NOW)).rejects.toMatchObject({ code: "commerce.daysRange" });
    await expect(svc.performance("org-1", "30.5", NOW)).rejects.toMatchObject({ code: "commerce.daysRange" });
    await expect(svc.performance("org-1", undefined, NOW)).resolves.toMatchObject({ days: 30 });
    await expect(svc.performance("org-1", "90", NOW)).resolves.toMatchObject({ days: 90 });
  });
});
