import { ExecutiveService } from "./executive.service";
import { ReportSharesService } from "./report-shares.service";

/** Reports Advanced RP6: executive payload assembles
 *  all four domains from the shared services; the
 *  public executive share strips profit/costs. */
function execSvc() {
  const prisma: any = {
    customer: { count: async () => 12 },
    order: {
      groupBy: async (args: any) => {
        if (args.by?.includes("customerId")) return []; // computeRfm partitions — no orders at customer level in this fixture
        return [{ status: "completed", _count: { _all: 40 } }, { status: "pending", _count: { _all: 3 } }];
      },
      findMany: async () => [],
    },
    orderItem: { groupBy: async () => [{ name: "শাড়ি", _sum: { quantity: 9, totalMinor: 450000n } }] },
  };
  const analytics: any = { computeRange: async () => ({
    totals: { orders: 43, revenueMinor: "900000", refundedMinor: "10000", averageOrderValueMinor: "20930", adSpendMinor: "200000", impressions: 5000, clicks: 250, platformConversions: 30 },
    profit: { contributionProfitMinor: "300000", contributionMarginPercent: 33.3 },
    kpis: { mer: 4.5, platformRoas: 2.1 },
  }) };
  const custom: any = { run: async () => ({ rows: [{ label: "Sale", values: { spend: "200000", conversions: 30, cpa: "6666" } }] }) };
  return new ExecutiveService(prisma, analytics, custom);
}

describe("RP6 executive", () => {
  it("assembles sales (with profit), ads, customers and operations", async () => {
    const out = await execSvc().executive("org", "2026-10-01", "2026-10-07");
    expect(out.sales.profit.contributionProfitMinor).toBe("300000");
    expect(out.ads.topCampaigns[0]).toMatchObject({ name: "Sale", spendMinor: "200000" });
    expect(out.customers.newInRange).toBe(12);
    expect(out.operations.ordersByStatus).toEqual({ completed: 40, pending: 3 });
    expect(out.operations.topProducts[0]).toMatchObject({ name: "শাড়ি", quantity: 9, totalMinor: "450000" });
  });

  it("the public executive share contains NO profit or cost fields anywhere", async () => {
    const exec = execSvc();
    const prisma: any = {
      reportShare: { findUnique: async () => ({ token: "t", kind: "executive", organizationId: "org", title: "Exec", days: 30, expiresAt: new Date(Date.now() + 86400000) }) },
      organization: { findUnique: async () => ({ name: "Shop", brandName: null, logoUrl: null, primaryColor: null }) },
    };
    const shares = new ReportSharesService(prisma, { log: async () => undefined } as any, {} as any, exec);
    const pub: any = await shares.publicReport("t");
    expect(pub.kind).toBe("executive");
    // No profit/cost KEYS anywhere (the explanatory note
    // sentence mentions the words — that is disclosure,
    // not data).
    const keys: string[] = [];
    const walk = (v: any) => { if (v && typeof v === "object") for (const [k, val] of Object.entries(v)) { keys.push(k.toLowerCase()); walk(val); } };
    walk(pub);
    expect(keys.some((k) => k.includes("profit") || k.includes("cogs"))).toBe(false);
    expect(pub.sales.profit).toBeUndefined();
    expect(pub.sales.revenueMinor).toBe("900000");
    expect(pub.ads.topCampaigns).toHaveLength(1);
  });

  it("share creation validates kind", async () => {
    const prisma: any = { reportShare: { create: async ({ data }: any) => ({ id: "s1", ...data }) } };
    const shares = new ReportSharesService(prisma, { log: async () => undefined } as any, {} as any);
    await expect(shares.create("org", "u", { title: "x", kind: "secret" })).rejects.toThrow(/kind/);
    const ok = await shares.create("org", "u", { title: "x", kind: "executive" });
    expect(ok.kind).toBe("executive");
  });
});
