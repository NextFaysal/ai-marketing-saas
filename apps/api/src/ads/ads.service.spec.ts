import { AdsService } from "./ads.service";

function fakePrisma() {
  const accounts: any[] = [{ id: "acc-1", organizationId: "org-1", platform: "meta", currency: "BDT", name: "CSV Account" }];
  const campaigns: any[] = [];
  const metrics: any[] = [];
  let seq = 0;
  return {
    _metrics: metrics, _campaigns: campaigns,
    adAccount: {
      findFirst: async ({ where }: any) => accounts.find((a) => a.id === where.id && a.organizationId === where.organizationId) ?? null,
      findMany: async () => accounts,
      create: async ({ data }: any) => { const a = { id: `acc-${++seq}`, ...data }; accounts.push(a); return a; },
    },
    adCampaign: {
      upsert: async ({ where, update, create }: any) => {
        const key = where.adAccountId_externalId;
        const found = campaigns.find((c) => c.adAccountId === key.adAccountId && c.externalId === key.externalId);
        if (found) { Object.assign(found, update); return found; }
        const c = { id: `camp-${++seq}`, ...create }; campaigns.push(c); return c;
      },
    },
    dailyAdMetric: {
      findUnique: async ({ where }: any) => {
        const k = where.organizationId_adAccountId_campaignExternalId_adSetExternalId_adExternalId_date_source;
        return metrics.find((m) => m.organizationId === k.organizationId && m.adAccountId === k.adAccountId &&
          m.campaignExternalId === k.campaignExternalId && (m.adSetExternalId ?? "") === k.adSetExternalId && (m.adExternalId ?? "") === k.adExternalId && m.date.getTime() === k.date.getTime() && m.source === k.source) ?? null;
      },
      create: async ({ data }: any) => { const m = { id: `met-${++seq}`, ...data }; metrics.push(m); return m; },
      update: async ({ where, data }: any) => {
        const k = where.organizationId_adAccountId_campaignExternalId_adSetExternalId_adExternalId_date_source;
        const m = metrics.find((x) => x.organizationId === k.organizationId && x.adAccountId === k.adAccountId &&
          x.campaignExternalId === k.campaignExternalId && (x.adSetExternalId ?? "") === k.adSetExternalId && (x.adExternalId ?? "") === k.adExternalId && x.date.getTime() === k.date.getTime() && x.source === k.source);
        Object.assign(m, data); return m;
      },
    },
  };
}
const audit = { log: async () => {} } as any;

describe("AdsService ad-spend CSV import", () => {
  it("creates rows, then RESTATES them on re-import with corrected numbers", async () => {
    const prisma = fakePrisma();
    const svc = new AdsService(prisma as any, audit);
    const csv1 = "date,campaign_id,campaign_name,spend,impressions,clicks,conversions,conversion_value\n2026-10-01,c1,Eid,1000,10000,200,10,15000";
    const first = await svc.importCsv("org-1", "user-1", "acc-1", { csvText: csv1 });
    expect(first).toMatchObject({ created: 1, updated: 0, failed: 0 });
    // Meta restates the day with higher spend later:
    const csv2 = csv1.replace("1000", "1200");
    const second = await svc.importCsv("org-1", "user-1", "acc-1", { csvText: csv2 });
    expect(second).toMatchObject({ created: 0, updated: 1 });
    expect((prisma as any)._metrics).toHaveLength(1);
    expect((prisma as any)._metrics[0].spendMinor).toBe(120000n);
  });
  it("manual entry upserts by date for the account", async () => {
    const prisma = fakePrisma();
    const svc = new AdsService(prisma as any, audit);
    await svc.manualEntry("org-1", "user-1", "acc-1", { date: "2026-10-02", spend: "500" });
    const r = await svc.manualEntry("org-1", "user-1", "acc-1", { date: "2026-10-02", spend: "550" });
    expect(r.result).toBe("updated");
    expect((prisma as any)._metrics[0].spendMinor).toBe(55000n);
  });
  it("blocks access to another organization's account", async () => {
    const prisma = fakePrisma();
    const svc = new AdsService(prisma as any, audit);
    await expect(svc.manualEntry("org-OTHER", "user-1", "acc-1", { date: "2026-10-02", spend: "1" })).rejects.toMatchObject({ code: "ads.adAccountNotFoundInThis" });
  });
});
