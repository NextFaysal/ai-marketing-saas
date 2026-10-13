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
    expect(await svc.getSettings("org-1")).toEqual({ briefingEnabled: true, anomalyAlertsEnabled: true, dailyReportEmailEnabled: false, telegramBriefEnabled: false, telegramBriefChatId: null, autonomyLevel: 0, assistantName: null });
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

describe("ProactiveService AP6 (radar / telegram / task inbox)", () => {
  const day = 86_400_000;
  const now = Date.now();
  function matchVal(v: any, cond: any): boolean {
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      if ("gte" in cond) return new Date(v) >= cond.gte;
      if ("lt" in cond) return new Date(v) < cond.lt;
      if ("in" in cond) return cond.in.includes(v);
      if ("contains" in cond) return String(v ?? "").includes(String(cond.contains));
      return true;
    }
    return v === cond;
  }
  function rowOk(row: any, where: any): boolean {
    return Object.entries<any>(where ?? {}).every(([k, v]) => (k === "OR" ? v.some((c: any) => rowOk(row, c)) : matchVal(row[k], v)));
  }
  function tbl(rows: any[]) {
    return {
      rows,
      findMany: async ({ where, take, orderBy }: any = {}) => {
        let out = rows.filter((r) => rowOk(r, where));
        if (orderBy?.count === "desc") out = [...out].sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
        return take ? out.slice(0, take) : out;
      },
      findFirst: async ({ where }: any = {}) => rows.find((r) => rowOk(r, where)) ?? null,
      findUnique: async ({ where }: any = {}) => rows.find((r) => rowOk(r, where)) ?? null,
      count: async ({ where }: any = {}) => rows.filter((r) => rowOk(r, where)).length,
      create: async ({ data }: any) => { const row = { id: `x-${rows.length + 1}`, createdAt: new Date(), ...data }; rows.push(row); return row; },
      upsert: async ({ where, create, update }: any) => {
        const ex = rows.find((r) => rowOk(r, where));
        if (ex) { Object.assign(ex, update); return ex; }
        const row = { id: "set-1", createdAt: new Date(), ...create }; rows.push(row); return row;
      },
    };
  }
  function setup6(withTelegram = false) {
    const prisma: any = {
      aIProactiveSetting: tbl([{ id: "s1", organizationId: "org-1", briefingEnabled: true, anomalyAlertsEnabled: false, dailyReportEmailEnabled: false, telegramBriefEnabled: withTelegram, telegramBriefChatId: withTelegram ? "555" : null }]),
      membership: tbl([{ id: "m1", organizationId: "org-1", userId: "owner-1", role: "OWNER", status: "ACTIVE" }]),
      agentNotification: tbl([]),
      product: tbl([{ id: "p1", organizationId: "org-1", status: "ACTIVE", name: "Panjabi", stockQuantity: 2, lowStockThreshold: 5 }]),
      order: tbl([
        { id: "o1", organizationId: "org-1", isPractice: false, status: "completed", totalMinor: 100000n, createdAt: new Date(now - 2 * day) },
        { id: "o2", organizationId: "org-1", isPractice: false, status: "completed", totalMinor: 100000n, createdAt: new Date(now - 3 * day) },
      ]),
      orderItem: tbl([{ id: "i1", orderId: "o1", productId: "p1", quantity: 9 }]),
      courierShipment: tbl([
        // prior week: 5 delivered of 5 terminal; recent week: 2 of 5 → rate falls 100 → 40
        ...Array.from({ length: 5 }, (_, i) => ({ id: `pa${i}`, organizationId: "org-1", provider: "steadfast", status: "delivered", createdAt: new Date(now - (8 + i) * day) })),
        ...Array.from({ length: 2 }, (_, i) => ({ id: `ra${i}`, organizationId: "org-1", provider: "steadfast", status: "delivered", createdAt: new Date(now - (1 + i) * day) })),
        ...Array.from({ length: 3 }, (_, i) => ({ id: `rb${i}`, organizationId: "org-1", provider: "steadfast", status: "returned", createdAt: new Date(now - (1 + i) * day) })),
      ]),
      aiUnansweredQuestion: tbl(Array.from({ length: 6 }, (_, i) => ({ id: `q${i}`, organizationId: "org-1", status: "open", normalizedQuestion: "ডেলিভারি চার্জ কত", count: 6 - i, channel: "whatsapp" }))),
      aIActionProposal: tbl([{ id: "pr1", organizationId: "org-1", status: "proposed" }]),
      integration: tbl(withTelegram ? [{ id: "int1", organizationId: "org-1", provider: "telegram", status: "CONNECTED", credential: { encryptedData: "SEEDED_BELOW" } }] : []),
      user: tbl([]),
    };
    const audit: any = { log: async () => undefined };
    const tools: any = {
      execute: async () => ({ orders: 5, revenue: "BDT 10000.00", adSpend: "BDT 1000.00", contributionProfit: "BDT 4000.00", contributionMarginPercent: 40, cogsCoveragePercent: 100 }),
      getAnomalies: async () => ({ anomalies: [], sufficientData: true }),
    };
    return { svc: new ProactiveService(prisma, audit, tools), prisma };
  }

  it("radar finds low-stock sellers, courier deterioration and the unanswered backlog", async () => {
    const { svc } = setup6();
    const lines = await svc.computeOpportunityRadar("org-1");
    expect(lines.join(" ")).toContain("স্টক মাত্র 2টি");
    expect(lines.join(" ")).toContain("ডেলিভারি রেট কমেছে");
    expect(lines.join(" ")).toContain("6টি প্রশ্নের উত্তর");
  });

  it("task inbox aggregates proposals, unanswered, radar, briefing state", async () => {
    const { svc } = setup6();
    const box = await svc.taskInbox("org-1");
    expect(box.pendingProposals).toBe(1);
    expect(box.unansweredOpen).toBe(6);
    expect(box.radar.length).toBeGreaterThan(0);
    expect(box.briefingToday).toBe(false);
  });

  it("telegram copy is honestly skipped without an integration", async () => {
    const { svc, prisma } = setup6(true);
    prisma.integration.rows.length = 0; // opted in + chat id set, but no connected bot
    const res: any = await svc.runDailyBriefing("org-1", "owner-1");
    expect(res.briefings).toBe(1);
    expect(res.telegramSent).toBe(0);
    expect(res.telegramSkipped).toBe("no_telegram_integration");
  });

  it("telegram copy sends through the connected bot (fetch stubbed)", async () => {
    const { encryptJson } = require("../integrations/crypto");
    const { svc, prisma } = setup6(true);
    prisma.integration.rows[0].credential.encryptedData = encryptJson({ botToken: "123:abc" });
    const fetchSpy = jest.spyOn(global, "fetch" as any).mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) } as any);
    try {
      const res: any = await svc.runDailyBriefing("org-1", "owner-1");
      expect(res.telegramSent).toBe(1);
      expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("api.telegram.org/bot123:abc/sendMessage"), expect.anything());
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
