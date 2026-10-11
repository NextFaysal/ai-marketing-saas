import {
  buildCohortReport,
  computeChurn,
  median,
  monthDiff,
  monthKey,
  type RevenueOrderFact,
} from "./cohorts";
import { CohortService } from "./cohort.service";

describe("monthKey / monthDiff", () => {
  it("formats UTC YYYY-MM and computes diffs", () => {
    expect(monthKey(new Date("2026-01-10T00:00:00Z"))).toBe("2026-01");
    expect(monthKey(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12");
    expect(monthDiff("2026-01", "2026-03")).toBe(2);
    expect(monthDiff("2026-03", "2026-01")).toBe(-2);
    expect(monthDiff("2025-12", "2026-01")).toBe(1);
    expect(monthDiff("2026-01", "2026-01")).toBe(0);
  });
});

describe("median", () => {
  it("returns null for empty", () => {
    expect(median([])).toBeNull();
  });
  it("returns middle for odd count", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([10, 10, 30])).toBe(10);
    expect(median([5])).toBe(5);
  });
  it("averages two middles for even count", () => {
    expect(median([1, 3])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([10, 10])).toBe(10);
  });
});

describe("buildCohortReport", () => {
  it("matches the hand-computed fixture", () => {
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    const facts: RevenueOrderFact[] = [
      { customerId: "A", at: d("2026-01-10"), totalMinor: 100000n },
      { customerId: "A", at: d("2026-02-05"), totalMinor: 50000n },
      { customerId: "A", at: d("2026-03-05"), totalMinor: 50000n },
      { customerId: "B", at: d("2026-01-20"), totalMinor: 200000n },
      { customerId: "C", at: d("2026-02-14"), totalMinor: 300000n },
      { customerId: "C", at: d("2026-03-01"), totalMinor: 100000n },
    ];
    const report = buildCohortReport(facts);
    expect(report.totalCustomers).toBe(3);
    expect(report.maxMonthIndex).toBe(2);
    expect(report.cohorts).toHaveLength(2);

    const jan = report.cohorts[0];
    expect(jan.cohort).toBe("2026-01");
    expect(jan.size).toBe(2);
    expect(jan.totalRevenueMinor).toBe("400000");
    expect(jan.retentionPercent).toEqual([100, 50, 50]);
    expect(jan.cumulativeLtvMinor).toEqual(["150000", "175000", "200000"]);

    const feb = report.cohorts[1];
    expect(feb.cohort).toBe("2026-02");
    expect(feb.size).toBe(1);
    expect(feb.totalRevenueMinor).toBe("400000");
    expect(feb.retentionPercent).toEqual([100, 100, null]);
    expect(feb.cumulativeLtvMinor).toEqual(["300000", "400000", null]);
  });

  it("returns empty report for no facts", () => {
    const report = buildCohortReport([]);
    expect(report.totalCustomers).toBe(0);
    expect(report.cohorts).toEqual([]);
  });
});

describe("computeChurn", () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  const now = new Date("2026-04-01T00:00:00Z");

  it("matches the hand-computed fixture", () => {
    const result = computeChurn(
      [
        {
          customerId: "X",
          dates: [d("2026-01-01"), d("2026-01-11"), d("2026-01-21")],
        },
        { customerId: "Y", dates: [d("2026-03-01"), d("2026-03-31")] },
        { customerId: "Z", dates: [d("2026-02-01")] },
      ],
      now,
    );
    expect(result.orgMedianGapDays).toBe(10);

    const byId = new Map(result.rows.map((r) => [r.customerId, r]));

    const x = byId.get("X")!;
    expect(x.orders).toBe(3);
    expect(x.referenceGapDays).toBe(10);
    expect(x.referenceSource).toBe("own");
    expect(x.daysSinceLastOrder).toBe(70);
    expect(x.ratio).toBe(7);
    expect(x.band).toBe("high");
    expect(x.lastOrderAt).toBe(d("2026-01-21").toISOString());

    const y = byId.get("Y")!;
    expect(y.orders).toBe(2);
    expect(y.referenceGapDays).toBe(10);
    expect(y.referenceSource).toBe("org");
    expect(y.daysSinceLastOrder).toBe(1);
    expect(y.ratio).toBe(0.1);
    expect(y.band).toBe("low");

    const z = byId.get("Z")!;
    expect(z.orders).toBe(1);
    expect(z.referenceGapDays).toBe(10);
    expect(z.referenceSource).toBe("org");
    expect(z.daysSinceLastOrder).toBe(59);
    expect(z.ratio).toBe(5.9);
    expect(z.band).toBe("high");
  });

  it("all single-order customers -> org median null, all unknown", () => {
    const result = computeChurn(
      [
        { customerId: "P", dates: [d("2026-02-01")] },
        { customerId: "Q", dates: [d("2026-03-01")] },
      ],
      now,
    );
    expect(result.orgMedianGapDays).toBeNull();
    expect(result.rows).toHaveLength(2);
    for (const row of result.rows) {
      expect(row.band).toBe("unknown");
      expect(row.ratio).toBeNull();
      expect(row.referenceGapDays).toBeNull();
      expect(row.referenceSource).toBeNull();
    }
  });
});

// ---- Service-level tests with a hand-rolled fake prisma ----

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    return row[k] === v;
  });
}

function makeFakePrisma(orders: any[], customers: any[]) {
  return {
    order: {
      findMany: async ({ where }: any = {}) =>
        orders.filter((r) => matches(r, where ?? {})),
    },
    customer: {
      findMany: async ({ where }: any = {}) =>
        customers.filter((r) => matches(r, where ?? {})),
    },
  };
}

describe("CohortService tenant isolation", () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  function setup() {
    const orders: any[] = [
      {
        id: "o1",
        organizationId: "org-1",
        customerId: "cust-A",
        status: "delivered",
        totalMinor: 100000n,
        placedAt: d("2026-01-10"),
        createdAt: d("2026-01-10"),
        currency: "BDT",
      },
      {
        id: "o2",
        organizationId: "org-1",
        customerId: "cust-A",
        status: "delivered",
        totalMinor: 50000n,
        placedAt: d("2026-02-10"),
        createdAt: d("2026-02-10"),
        currency: "BDT",
      },
      {
        id: "o3",
        organizationId: "org-1",
        customerId: "cust-A",
        status: "cancelled",
        totalMinor: 999999n,
        placedAt: d("2026-03-01"),
        createdAt: d("2026-03-01"),
        currency: "BDT",
      },
      {
        id: "o4",
        organizationId: "org-1",
        customerId: null,
        status: "delivered",
        totalMinor: 12345n,
        placedAt: d("2026-01-15"),
        createdAt: d("2026-01-15"),
        currency: "BDT",
      },
      {
        id: "o5",
        organizationId: "org-2",
        customerId: "cust-X",
        status: "delivered",
        totalMinor: 777777n,
        placedAt: d("2026-01-05"),
        createdAt: d("2026-01-05"),
        currency: "BDT",
      },
    ];
    const customers: any[] = [
      {
        id: "cust-A",
        organizationId: "org-1",
        firstName: "Ayesha",
        lastName: "Rahman",
        mergedIntoId: null,
      },
      {
        id: "cust-X",
        organizationId: "org-2",
        firstName: "Other",
        lastName: "Org",
        mergedIntoId: null,
      },
    ];
    const prisma = makeFakePrisma(orders, customers);
    const svc = new CohortService(prisma as any);
    return { svc };
  }

  it("cohorts only includes org-1, excludes cancelled, counts ordersWithoutCustomer", async () => {
    const { svc } = setup();
    const res: any = await svc.cohorts("org-1");
    expect(res.hasData).toBe(true);
    expect(res.totalCustomers).toBe(1);
    expect(res.ordersConsidered).toBe(3);
    expect(res.ordersWithoutCustomer).toBe(1);
    expect(res.revenueExcludedStatuses).toEqual([
      "cancelled",
      "refunded",
      "failed",
    ]);
    // Only org-1 cohort data: total revenue should be 100000+50000, not
    // including cancelled 999999 or org-2 777777.
    const total = res.cohorts.reduce(
      (s: bigint, c: any) => s + BigInt(c.totalRevenueMinor),
      0n,
    );
    expect(total.toString()).toBe("150000");
    expect(res.cohorts).toHaveLength(1);
    expect(res.cohorts[0].cohort).toBe("2026-01");
    expect(res.cohorts[0].size).toBe(1);
  });

  it("churnRisk only includes org-1 customers", async () => {
    const { svc } = setup();
    const res: any = await svc.churnRisk("org-1");
    expect(res.heuristic).toBe(true);
    expect(res.customers).toHaveLength(1);
    expect(res.customers[0].customerId).toBe("cust-A");
    expect(res.customers[0].name).toBe("Ayesha Rahman");
    expect(res.customers[0].orders).toBe(2);
    const totalSummary =
      res.summary.low + res.summary.medium + res.summary.high + res.summary.unknown;
    expect(totalSummary).toBe(1);
  });

  it("empty org -> hasData false", async () => {
    const { svc } = setup();
    const res: any = await svc.cohorts("org-empty");
    expect(res.hasData).toBe(false);
    expect(res.totalCustomers).toBe(0);
    expect(res.cohorts).toEqual([]);
    expect(res.ordersConsidered).toBe(0);

    const churn: any = await svc.churnRisk("org-empty");
    expect(churn.customers).toEqual([]);
    expect(churn.orgMedianGapDays).toBeNull();
  });
});
