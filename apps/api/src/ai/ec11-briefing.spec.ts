import { ProactiveService } from "./proactive.service";

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && "in" in (v as any)) return (v as any).in.includes(row[k]);
    if (v !== null && typeof v === "object" && !(v instanceof Date) && "gte" in (v as any)) return new Date(row[k]) >= (v as any).gte;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && "lt" in (v as any)) return new Date(row[k]) < (v as any).lt;
    return row[k] === v;
  });
}
function makeTable(seed: any[] = []) {
  const rows: any[] = [...seed];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where)),
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where)).length,
    create: async ({ data }: any) => { const row = { id: `n-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    upsert: async ({ where, create, update }: any) => {
      const existing = rows.find((r) => matches(r, where));
      if (existing) { Object.assign(existing, update); return existing; }
      const row = { id: `n-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...create }; rows.push(row); return row;
    },
  };
}

const SIGNALS = { hasCommerceData: true, failedSyncs24h: 2, openConflicts: 1, stockDivergedCount: 3, unfulfilledOlderThan48h: 4 };

function setup(opts: { signals?: any; withCommerce?: boolean } = {}) {
  const prisma: any = {
    aIProactiveSetting: makeTable(),
    membership: makeTable([
      { id: "m1", organizationId: "org-1", userId: "owner-1", role: "OWNER", status: "ACTIVE" },
    ]),
    agentNotification: makeTable(),
    product: makeTable([]),
    order: makeTable([]),
    orderItem: makeTable([]),
    courierShipment: makeTable([]),
    aiUnansweredQuestion: makeTable([]),
    aIActionProposal: makeTable([]),
  };
  const audit: any = { log: async () => undefined };
  const tools: any = {
    execute: async () => ({ orders: 5, revenue: "BDT 10000.00", adSpend: "BDT 1000.00", contributionProfit: "BDT 4000.00", contributionMarginPercent: 40, cogsCoveragePercent: 100 }),
    getAnomalies: async () => ({ anomalies: [], sufficientData: true }),
  };
  const commerceAnalytics: any = opts.withCommerce === false ? undefined : {
    commerceSignals: async () => opts.signals ?? SIGNALS,
  };
  const svc = new ProactiveService(prisma, audit, tools, undefined, commerceAnalytics);
  return { svc, prisma };
}

describe("EC11 ProactiveService commerce briefing line", () => {
  it("absent commerceAnalytics service -> null (briefing unchanged)", async () => {
    const { svc } = setup({ withCommerce: false });
    expect(await svc.commerceBriefingLine("org-1")).toBeNull();
  });

  it("hasCommerceData false -> null", async () => {
    const { svc } = setup({ signals: { ...SIGNALS, hasCommerceData: false } });
    expect(await svc.commerceBriefingLine("org-1")).toBeNull();
  });

  it("all-zero signals -> null (no noise line)", async () => {
    const { svc } = setup({ signals: { hasCommerceData: true, failedSyncs24h: 0, openConflicts: 0, stockDivergedCount: 0, unfulfilledOlderThan48h: 0 } });
    expect(await svc.commerceBriefingLine("org-1")).toBeNull();
  });

  it("signals present -> Bengali line containing the counts", async () => {
    const { svc } = setup();
    const line = await svc.commerceBriefingLine("org-1");
    expect(line).toContain("কমার্স অবস্থা");
    expect(line).toContain("ব্যর্থ সিঙ্ক 2টি");
    expect(line).toContain("খোলা কনফ্লিক্ট 1টি");
    expect(line).toContain("স্টক-বিচ্যুত লিস্টিং 3টি");
    expect(line).toContain("অপূর্ণ অর্ডার 4টি");
    expect(line).toContain("Commerce Hub / Sync Center");
  });

  it("runDailyBriefing body includes the commerce line when signals exist", async () => {
    const { svc, prisma } = setup();
    const res: any = await svc.runDailyBriefing("org-1", "owner-1");
    expect(res.briefings).toBe(1);
    const body = prisma.agentNotification.rows.find((r: any) => r.type === "ai_briefing")?.body ?? "";
    expect(body).toContain("কমার্স অবস্থা");
    expect(body).toContain("ব্যর্থ সিঙ্ক 2টি");
  });

  it("runDailyBriefing body excludes the commerce line when there is no commerce data", async () => {
    const { svc, prisma } = setup({ signals: { ...SIGNALS, hasCommerceData: false } });
    const res: any = await svc.runDailyBriefing("org-1", "owner-1");
    expect(res.briefings).toBe(1);
    const body = prisma.agentNotification.rows.find((r: any) => r.type === "ai_briefing")?.body ?? "";
    expect(body).not.toContain("কমার্স অবস্থা");
    expect(body).toContain("অর্ডার 5টি");
  });
});
