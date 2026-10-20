import { ReportsService } from "./reports.service";
import { DevTemplateProvider } from "./llm/dev.provider";

function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v === undefined) return true;
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
    if (v !== null && typeof v === "object") return true; // nested filters not needed here
    return row[k] === v;
  });
}
function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    create: async ({ data }: any) => { const row = { id: `id-${++seq}`, createdAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); Object.assign(row, data); return row; },
    deleteMany: async ({ where }: any) => {
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1);
      return { count: 0 };
    },
  };
}
function fakePrisma() { return { aIReport: makeTable(), aIRecommendation: makeTable(), aIUsageRecord: makeTable() }; }

const analyticsStub = {
  computeRange: async () => ({
    range: { from: "2026-10-09", to: "2026-10-09" },
    totals: { orders: 12, revenueMinor: "500000", adSpendMinor: "100000", averageOrderValueMinor: "41666", platformConversions: 9 },
    kpis: { mer: 5, platformRoas: 4.5, cpaMinor: 11111 },
    profit: { contributionProfitMinor: "180000", contributionMarginPercent: 36, cogsCoverage: { percent: 50, ordersWithFullCost: 6, ordersTotal: 12 } },
    campaigns: [{ campaignName: "Eid Sale", platform: "meta", source: "api", spendMinor: "100000", platformRoas: 4.5 }],
  }),
} as any;
const toolsStub = { getAnomalies: async () => ({ anomalies: [], sufficientData: false }) } as any;
const llmStub = { getProvider: () => new DevTemplateProvider() } as any;

describe("ReportsService with the dev template provider", () => {
  it("generates a grounded Bengali report, stores missing-data notes and recommendations", async () => {
    const prisma = fakePrisma();
    const svc = new ReportsService(prisma as any, analyticsStub, llmStub, toolsStub);
    const report = await svc.generate("org-1", "user-1", { type: "daily", date: "2026-10-09", language: "bn" });
    expect(report.provider).toBe("dev-template");
    expect(report.content).toContain("5000.00");
    expect(report.content).toContain("যেসব ডেটা নেই");
    expect(report.version).toBe(1);
    // COGS coverage is 50%, so a cost recommendation must exist
    const recs = await svc.listRecommendations("org-1");
    expect(recs.length).toBeGreaterThanOrEqual(1);
    expect(prisma.aIUsageRecord.rows[0]).toMatchObject({ feature: "report", estimated: true });
  });

  it("regenerating the same period bumps the version instead of duplicating the report", async () => {
    const prisma = fakePrisma();
    const svc = new ReportsService(prisma as any, analyticsStub, llmStub, toolsStub);
    await svc.generate("org-1", "user-1", { type: "daily", date: "2026-10-09" });
    const second = await svc.generate("org-1", "user-1", { type: "daily", date: "2026-10-09" });
    expect(second.version).toBe(2);
    expect(prisma.aIReport.rows).toHaveLength(1);
  });

  // MB5 (ML13, CD-8 #16): with no input.language, the default is
  // the OWNER chain — here Organization.dashboardLocale "en"
  // (aiReplyLanguage unset) yields an English report, while an
  // explicit input.language still wins over every rung.
  it("MB5: absent language resolves via the owner chain (dashboardLocale en); explicit dto still wins", async () => {
    const prisma: any = {
      ...fakePrisma(),
      businessProfile: { findUnique: async () => ({ aiReplyLanguage: null }) },
      organization: { findUnique: async () => ({ dashboardLocale: "en" }) },
      user: { findUnique: async () => ({ preferredLocale: "bn" }) },
    };
    const svc = new ReportsService(prisma as any, analyticsStub, llmStub, toolsStub);
    const report = await svc.generate("org-1", "user-1", { type: "daily", date: "2026-10-09" });
    expect(report.content).toContain("## What happened");
    expect(report.title).toContain("daily report");

    const prisma2: any = {
      ...fakePrisma(),
      businessProfile: { findUnique: async () => ({ aiReplyLanguage: null }) },
      organization: { findUnique: async () => ({ dashboardLocale: "en" }) },
      user: { findUnique: async () => ({ preferredLocale: "en" }) },
    };
    const svc2 = new ReportsService(prisma2 as any, analyticsStub, llmStub, toolsStub);
    const bnReport = await svc2.generate("org-1", "user-1", { type: "daily", date: "2026-10-09", language: "bn" });
    expect(bnReport.content).toContain("যেসব ডেটা নেই");
  });
});
