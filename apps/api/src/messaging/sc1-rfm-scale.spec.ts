import { computeRfm } from "./rfm";

/**
 * Scale SC1: RFM aggregates come from two partitioned
 * groupBy calls — no 2,000-customer cap, no 1,000-order
 * cap, no per-customer queries — with the old
 * placedAt ?? createdAt semantics preserved exactly.
 */
const DAY = 86400000;
const NOW = Date.now();

interface FakeOrder { customerId: string; status: string; totalMinor: bigint; placedAt: Date | null; createdAt: Date }
function fakePrisma(customers: any[], orders: FakeOrder[]) {
  const calls = { groupBy: 0, orderFindMany: 0, customerFindMany: 0 };
  const prisma: any = {
    order: {
      groupBy: async (args: any) => {
        calls.groupBy++;
        const wantPlaced = args.where.placedAt !== null && args.where.placedAt !== undefined;
        const wantNull = args.where.placedAt === null;
        const sel = orders.filter((o) => o.status !== "cancelled" && o.customerId && (wantNull ? o.placedAt === null : wantPlaced ? o.placedAt !== null : true));
        const byId = new Map<string, any>();
        for (const o of sel) {
          const g = byId.get(o.customerId) ?? { customerId: o.customerId, _count: { _all: 0 }, _sum: { totalMinor: 0n }, _max: {} };
          g._count._all++;
          g._sum.totalMinor += o.totalMinor;
          if (wantNull) { if (!g._max.createdAt || o.createdAt > g._max.createdAt) g._max.createdAt = o.createdAt; }
          else if (o.placedAt) { if (!g._max.placedAt || o.placedAt > g._max.placedAt) g._max.placedAt = o.placedAt; }
          byId.set(o.customerId, g);
        }
        return [...byId.values()];
      },
      findMany: async () => { calls.orderFindMany++; throw new Error("order.findMany must not be called by computeRfm anymore"); },
    },
    customer: {
      findMany: async (args: any) => {
        calls.customerFindMany++;
        const ids: string[] = args.where.id.in;
        return customers.filter((c) => ids.includes(c.id) && c.mergedIntoId === null);
      },
    },
  };
  return { prisma, calls };
}
const cust = (id: string, extra: any = {}) => ({ id, firstName: `C${id}`, lastName: "", phone: null, email: null, mergedIntoId: null, ...extra });

describe("SC1 computeRfm aggregation", () => {
  it("scores 2,500 customers — the old 2,000 cap is gone — with exactly 2 groupBy calls", async () => {
    const customers = Array.from({ length: 2500 }, (_, i) => cust(`c${i}`));
    const orders: FakeOrder[] = customers.map((c, i) => ({ customerId: c.id, status: "completed", totalMinor: BigInt(1000 + i), placedAt: new Date(NOW - DAY), createdAt: new Date(NOW - DAY) }));
    const { prisma, calls } = fakePrisma(customers, orders);
    const rows = await computeRfm(prisma, "org");
    expect(rows.length).toBe(2500);
    expect(calls.groupBy).toBe(2);
    expect(calls.orderFindMany).toBe(0);
    expect(calls.customerFindMany).toBe(3); // chunked at 1,000
  });

  it("a customer with 1,500 orders counts them ALL (the old 1,000 cap is gone)", async () => {
    const customers = [cust("whale")];
    const orders: FakeOrder[] = Array.from({ length: 1500 }, () => ({ customerId: "whale", status: "completed", totalMinor: 100n, placedAt: new Date(NOW - 2 * DAY), createdAt: new Date(NOW - 2 * DAY) }));
    const { prisma } = fakePrisma(customers, orders);
    const rows = await computeRfm(prisma, "org");
    expect(rows[0].frequency).toBe(1500);
    expect(rows[0].monetaryMinor).toBe("150000");
  });

  it("placedAt wins over a fresh createdAt (synced orders); placedAt-null falls back to createdAt; partitions add up", async () => {
    const customers = [cust("synced"), cust("local"), cust("both")];
    const orders: FakeOrder[] = [
      { customerId: "synced", status: "completed", totalMinor: 500n, placedAt: new Date(NOW - 100 * DAY), createdAt: new Date(NOW) },
      { customerId: "local", status: "completed", totalMinor: 700n, placedAt: null, createdAt: new Date(NOW - 5 * DAY) },
      { customerId: "both", status: "completed", totalMinor: 100n, placedAt: new Date(NOW - 50 * DAY), createdAt: new Date(NOW - 50 * DAY) },
      { customerId: "both", status: "completed", totalMinor: 200n, placedAt: null, createdAt: new Date(NOW - 3 * DAY) },
    ];
    const { prisma } = fakePrisma(customers, orders);
    const rows = await computeRfm(prisma, "org");
    const byId = Object.fromEntries(rows.map((r) => [r.customerId, r]));
    expect(byId.synced.recencyDays).toBe(100);
    expect(byId.local.recencyDays).toBe(5);
    expect(byId.both.frequency).toBe(2);
    expect(byId.both.monetaryMinor).toBe("300");
    expect(byId.both.recencyDays).toBe(3);
  });

  it("cancelled-only and merged customers stay absent", async () => {
    const customers = [cust("gone"), cust("merged", { mergedIntoId: "c-keeper" }), cust("keeper")];
    const orders: FakeOrder[] = [
      { customerId: "gone", status: "cancelled", totalMinor: 100n, placedAt: new Date(NOW - DAY), createdAt: new Date(NOW - DAY) },
      { customerId: "merged", status: "completed", totalMinor: 100n, placedAt: new Date(NOW - DAY), createdAt: new Date(NOW - DAY) },
      { customerId: "keeper", status: "completed", totalMinor: 100n, placedAt: new Date(NOW - DAY), createdAt: new Date(NOW - DAY) },
    ];
    const { prisma } = fakePrisma(customers, orders);
    const rows = await computeRfm(prisma, "org");
    expect(rows.map((r) => r.customerId)).toEqual(["keeper"]);
  });
});
