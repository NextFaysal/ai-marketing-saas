import { ProductsService } from "./products.service";

// Fake Prisma for salesReport(): order.findMany evaluates the
// OR where the service builds (placedAt range / placedAt null +
// createdAt range) and respects organizationId; the captured
// where is asserted so the test pins the query shape. Product
// and courierShipment findMany filter by their `in` lists.
function fakePrisma() {
  const products: any[] = [];
  const orders: any[] = [];
  const shipments: any[] = [];
  const orderCalls: any[] = [];
  return {
    products, orders, shipments, orderCalls,
    order: {
      findMany: async (args: any = {}) => {
        orderCalls.push(args);
        const { where, take } = args;
        const or = where?.OR ?? [];
        const placed = or.find((c: any) => c.placedAt && typeof c.placedAt === "object");
        const fallback = or.find((c: any) => c.placedAt === null);
        const start = placed?.placedAt?.gte ?? fallback?.createdAt?.gte;
        const end = placed?.placedAt?.lt ?? fallback?.createdAt?.lt;
        const inRange = (d: any) => d != null && new Date(d).getTime() >= new Date(start).getTime() && new Date(d).getTime() < new Date(end).getTime();
        const inWindow = (o: any) => (o.placedAt ? inRange(o.placedAt) : inRange(o.createdAt));
        let f = orders.filter((o) => o.organizationId === where.organizationId && inWindow(o));
        if (take) f = f.slice(0, take);
        return f;
      },
    },
    product: {
      findMany: async ({ where }: any = {}) => products.filter(
        (p) => p.organizationId === where.organizationId && (where.id?.in ? where.id.in.includes(p.id) : true),
      ),
    },
    courierShipment: {
      findMany: async ({ where }: any = {}) => shipments.filter(
        (s) => s.organizationId === where.organizationId && (where.orderId?.in ? where.orderId.in.includes(s.orderId) : true),
      ),
    },
  };
}

const NOW = new Date("2026-10-11T10:00:00.000Z");
const utc = (iso: string) => new Date(iso);
const auditStub: any = { log: async () => {} };

function seed(prisma: any) {
  prisma.products.push(
    { id: "p1", organizationId: "org-1", name: "Shirt", category: "Fashion" },
    { id: "p2", organizationId: "org-1", name: "Shoes", category: "Fashion" },
    { id: "p3", organizationId: "org-1", name: "Watch", category: null },
  );
  const item = (productId: string | null, name: string, quantity: number, totalMinor: bigint) =>
    ({ productId, name, quantity, priceMinor: 0n, totalMinor });
  const order = (id: string, over: any) => prisma.orders.push({
    id, organizationId: "org-1", status: "completed", placedAt: utc("2026-10-05T10:00:00.000Z"),
    createdAt: utc("2026-10-05T10:00:00.000Z"), items: [], ...over,
  });
  order("o1", { placedAt: utc("2026-10-05T10:00:00.000Z"), status: "completed", items: [
    item("p1", "Shirt", 2, 200000n), item("p2", "Shoes", 1, 150000n),
  ] });
  order("o2", { placedAt: null, createdAt: utc("2026-10-06T10:00:00.000Z"), status: "processing", items: [
    item("p1", "Shirt", 1, 100000n),
  ] });
  prisma.shipments.push({ id: "s2", organizationId: "org-1", orderId: "o2", status: "returned" });
  order("o3", { placedAt: utc("2026-10-07T10:00:00.000Z"), status: "cancelled", items: [
    item("p3", "Watch", 5, 99900n),
  ] });
  order("o4", { placedAt: utc("2026-10-08T10:00:00.000Z"), status: "returned", items: [
    item("p2", "Shoes", 2, 300000n),
  ] });
  order("o5", { placedAt: utc("2026-10-09T10:00:00.000Z"), status: "completed", items: [
    item(null, "Mystery", 3, 5000n), item("p3", "Watch", 1, 20000n),
  ] });
  order("o6", { placedAt: utc("2026-09-01T10:00:00.000Z"), status: "completed", items: [
    item("p1", "Shirt", 10, 1000000n),
  ] });
  order("o7", { organizationId: "org-2", placedAt: utc("2026-10-05T10:00:00.000Z"), status: "completed", items: [
    item("p1", "Shirt", 7, 700000n),
  ] });
  order("o8", { placedAt: utc("2026-10-09T10:00:00.000Z"), status: "completed", items: [
    item("p-deleted", "Legacy Item", 1, 7000n),
  ] });
}

describe("Sales & Data S6 — product sales report", () => {
  it("matches hand computation: products, categories, unlinked, totals", async () => {
    const prisma = fakePrisma();
    seed(prisma);
    const svc = new ProductsService(prisma as any, auditStub);
    const out = await svc.salesReport("org-1", 30, NOW);

    expect(out.days).toBe(30);
    expect(out.windowStart).toBe("2026-09-11T18:00:00.000Z");
    expect(out.windowEnd).toBe("2026-10-11T18:00:00.000Z");
    expect(out.revenueExcludedStatuses).toEqual(["cancelled", "refunded", "failed"]);

    // The service must pass the OR effective-date where.
    const where = prisma.orderCalls[0].where;
    expect(where.organizationId).toBe("org-1");
    expect(where.OR).toHaveLength(2);
    expect(where.OR[0].placedAt.gte.toISOString()).toBe("2026-09-11T18:00:00.000Z");
    expect(where.OR[0].placedAt.lt.toISOString()).toBe("2026-10-11T18:00:00.000Z");
    expect(where.OR[1].placedAt).toBeNull();
    expect(where.OR[1].createdAt.gte.toISOString()).toBe("2026-09-11T18:00:00.000Z");
    expect(where.OR[1].createdAt.lt.toISOString()).toBe("2026-10-11T18:00:00.000Z");
    expect(prisma.orderCalls[0].take).toBe(20000);

    expect(out.products.map((p: any) => p.productId)).toEqual(["p2", "p1", "p3", "p-deleted"]);
    const byId = new Map(out.products.map((p: any) => [p.productId, p]));
    expect(byId.get("p2")).toEqual({ productId: "p2", name: "Shoes", category: "Fashion", units: 3, orders: 2, revenueMinor: "450000", returnedUnits: 2 });
    expect(byId.get("p1")).toEqual({ productId: "p1", name: "Shirt", category: "Fashion", units: 3, orders: 2, revenueMinor: "300000", returnedUnits: 1 });
    expect(byId.get("p3")).toEqual({ productId: "p3", name: "Watch", category: null, units: 1, orders: 1, revenueMinor: "20000", returnedUnits: 0 });
    expect(byId.get("p-deleted")).toEqual({ productId: "p-deleted", name: "Legacy Item", category: null, units: 1, orders: 1, revenueMinor: "7000", returnedUnits: 0 });

    expect(out.categories).toEqual([
      { category: "Fashion", units: 6, orders: 3, revenueMinor: "750000", returnedUnits: 3 },
      { category: null, units: 2, orders: 2, revenueMinor: "27000", returnedUnits: 0 },
    ]);
    expect(out.unlinked).toEqual({ units: 3, orders: 1, revenueMinor: "5000", returnedUnits: 0 });
    expect(out.totals).toEqual({ units: 11, orders: 5, revenueMinor: "782000", returnedUnits: 3 });
  });

  it("validates days: integer 1..365 only, default 30", async () => {
    const svc = new ProductsService(fakePrisma() as any, auditStub);
    await expect(svc.salesReport("org-1", "0", NOW)).rejects.toMatchObject({ code: "commerce.daysRange" });
    await expect(svc.salesReport("org-1", "abc", NOW)).rejects.toMatchObject({ code: "commerce.daysRange" });
    await expect(svc.salesReport("org-1", 0, NOW)).rejects.toMatchObject({ code: "commerce.daysRange" });
    await expect(svc.salesReport("org-1", 366, NOW)).rejects.toMatchObject({ code: "commerce.daysRange" });
    await expect(svc.salesReport("org-1", undefined, NOW)).resolves.toMatchObject({ days: 30 });
    await expect(svc.salesReport("org-1", "", NOW)).resolves.toMatchObject({ days: 30 });
    await expect(svc.salesReport("org-1", "90", NOW)).resolves.toMatchObject({ days: 90 });
  });

  it("empty org: no products, zero totals as strings, no crash", async () => {
    const svc = new ProductsService(fakePrisma() as any, auditStub);
    const out = await svc.salesReport("org-empty", 30, NOW);
    expect(out.products).toEqual([]);
    expect(out.categories).toEqual([]);
    expect(out.unlinked).toEqual({ units: 0, orders: 0, revenueMinor: "0", returnedUnits: 0 });
    expect(out.totals).toEqual({ units: 0, orders: 0, revenueMinor: "0", returnedUnits: 0 });
  });
});
