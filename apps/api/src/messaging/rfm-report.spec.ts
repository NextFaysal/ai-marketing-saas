import { MessagingService } from "./messaging.service";

describe("MessagingService.rfmReport", () => {
  it("computes rfm segmentation report with counts, segmentStats, and rows", async () => {
    const DAY = 86400000;
    const NOW = Date.now();
    const customers = [
      { id: "c1", firstName: "Rahim", lastName: "Ahmed", phone: "01711111111", email: "rahim@example.com", mergedIntoId: null },
      { id: "c2", firstName: "Karim", lastName: "Khan", phone: "01822222222", email: "karim@example.com", mergedIntoId: null },
      { id: "c3", firstName: "Salma", lastName: "Begum", phone: "01933333333", email: "salma@example.com", mergedIntoId: null },
    ];
    const orders = [
      { customerId: "c1", status: "delivered", totalMinor: 500000n, placedAt: new Date(NOW - 2 * DAY), createdAt: new Date(NOW - 2 * DAY) },
      { customerId: "c1", status: "delivered", totalMinor: 300000n, placedAt: new Date(NOW - 10 * DAY), createdAt: new Date(NOW - 10 * DAY) },
      { customerId: "c2", status: "delivered", totalMinor: 200000n, placedAt: new Date(NOW - 60 * DAY), createdAt: new Date(NOW - 60 * DAY) },
      { customerId: "c3", status: "delivered", totalMinor: 100000n, placedAt: new Date(NOW - 1 * DAY), createdAt: new Date(NOW - 1 * DAY) },
    ];

    const prisma: any = {
      order: {
        groupBy: async (args: any) => {
          const wantNull = args.where.placedAt === null;
          const sel = orders.filter((o) => (wantNull ? o.placedAt === null : o.placedAt !== null));
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
      },
      customer: {
        findMany: async (args: any) => {
          const ids: string[] = args.where.id.in;
          return customers.filter((c) => ids.includes(c.id));
        },
      },
    };

    const service = new MessagingService(prisma, null as any, null as any, null as any, null as any);
    const report = await service.rfmReport("org-123");

    expect(report.totalCustomers).toBe(3);
    expect(report.segments).toBeDefined();
    expect(report.segmentStats).toBeDefined();
    expect(Array.isArray(report.rows)).toBe(true);
    expect(report.rows.length).toBe(3);

    // Verify segment stats have proper shape
    for (const seg of ["champions", "loyal", "big_spenders", "at_risk", "lost", "new", "regular"]) {
      expect(report.segmentStats[seg]).toBeDefined();
      expect(typeof report.segmentStats[seg].count).toBe("number");
      expect(typeof report.segmentStats[seg].totalSpendMinor).toBe("string");
      expect(typeof report.segmentStats[seg].avgRecencyDays).toBe("number");
      expect(typeof report.segmentStats[seg].avgFrequency).toBe("number");
    }
  });
});
