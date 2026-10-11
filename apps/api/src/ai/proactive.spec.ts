import { ProactiveService } from "./proactive.service";

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && "in" in (v as any)) return (v as any).in.includes(row[k]);
    if (v !== null && typeof v === "object" && !(v instanceof Date) && "gte" in (v as any)) return new Date(row[k]) >= (v as any).gte;
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
    create: async ({ data }: any) => { const row = { id: `n-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    upsert: async ({ where, create, update }: any) => {
      const existing = rows.find((r) => matches(r, where));
      if (existing) { Object.assign(existing, update); return existing; }
      const row = { id: `n-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...create }; rows.push(row); return row;
    },
  };
}
function setup(opts: { orders?: number; anomalies?: any[] } = {}) {
  const prisma: any = {
    aIProactiveSetting: makeTable(),
    membership: makeTable([
      { id: "m1", organizationId: "org-1", userId: "owner-1", role: "OWNER", status: "ACTIVE" },
      { id: "m2", organizationId: "org-1", userId: "admin-1", role: "ADMIN", status: "ACTIVE" },
      { id: "m3", organizationId: "org-1", userId: "analyst-1", role: "ANALYST", status: "ACTIVE" },
    ]),
    agentNotification: makeTable(),
  };
  const audit: any = { log: async () => undefined };
  const tools: any = {
    execute: async () => ({
      range: { from: "2026-10-09", to: "2026-10-09" },
      orders: opts.orders ?? 5, revenue: "BDT 10000.00", adSpend: "BDT 1000.00",
      contributionProfit: "BDT 4000.00", contributionMarginPercent: 40, cogsCoveragePercent: 100,
    }),
    getAnomalies: async () => ({ anomalies: opts.anomalies ?? [], sufficientData: true }),
  };
  const svc = new ProactiveService(prisma, audit, tools);
  return { svc, prisma };
}
const CRITICAL = { type: "spend_no_sales", severity: "critical", message: "Spend with no sales yesterday." };
const WARNING = { type: "spend_spike", severity: "warning", message: "Spend spiked." };

describe("ProactiveService (M48)", () => {
  it("defaults: briefing + alerts on when no settings row exists", async () => {
    const { svc } = setup();
    expect(await svc.getSettings("org-1")).toEqual({ briefingEnabled: true, anomalyAlertsEnabled: true });
  });

  it("delivers yesterday's briefing with real figures to OWNER/ADMIN only, deduped per day", async () => {
    const { svc, prisma } = setup();
    const first = await svc.runDailyBriefing("org-1", "owner-1");
    expect(first.briefings).toBe(2); // owner + admin, not the analyst
    const rows = prisma.agentNotification.rows.filter((r: any) => r.type === "ai_briefing");
    expect(rows.length).toBe(2);
    expect(rows[0].body).toContain("10000");
    expect(rows[0].body).toContain("অর্ডার 5টি");
    const second = await svc.runDailyBriefing("org-1", "owner-1");
    expect(second.briefings).toBe(0);
    expect(prisma.agentNotification.rows.filter((r: any) => r.type === "ai_briefing").length).toBe(2);
  });

  it("a no-order day still gets an honest no-data briefing (nothing invented)", async () => {
    const { svc, prisma } = setup({ orders: 0 });
    const res = await svc.runDailyBriefing("org-1", "owner-1");
    expect(res.briefings).toBe(2);
    expect(prisma.agentNotification.rows[0].body).toContain("কোনো অর্ডার রেকর্ড হয়নি");
  });

  it("critical anomalies alert (deduped per type/day); warning-tier does not alert", async () => {
    const a = setup({ anomalies: [CRITICAL, WARNING] });
    const res = await a.svc.runDailyBriefing("org-1", "owner-1");
    expect(res.anomalyAlerts).toBe(2); // one critical x two recipients
    const again = await a.svc.runDailyBriefing("org-1", "owner-1");
    expect(again.anomalyAlerts).toBe(0);
    const b = setup({ anomalies: [WARNING] });
    const resB = await b.svc.runDailyBriefing("org-1", "owner-1");
    expect(resB.anomalyAlerts).toBe(0);
    expect(b.prisma.agentNotification.rows.some((r: any) => r.type === "ai_anomaly")).toBe(false);
  });

  it("both switches off -> skipped, no notifications at all", async () => {
    const { svc, prisma } = setup({ anomalies: [CRITICAL] });
    await svc.updateSettings("org-1", "owner-1", { briefingEnabled: false, anomalyAlertsEnabled: false });
    const res = await svc.runDailyBriefing("org-1", "owner-1");
    expect((res as any).skipped).toBe("proactive_disabled");
    expect(prisma.agentNotification.rows.length).toBe(0);
  });

  it("briefing off + alerts on: alerts still fire, no briefing is sent", async () => {
    const { svc, prisma } = setup({ anomalies: [CRITICAL] });
    await svc.updateSettings("org-1", "owner-1", { briefingEnabled: false });
    const res = await svc.runDailyBriefing("org-1", "owner-1");
    expect(res.briefings).toBe(0);
    expect(res.anomalyAlerts).toBe(2);
    expect(prisma.agentNotification.rows.every((r: any) => r.type === "ai_anomaly")).toBe(true);
  });
});
