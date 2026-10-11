import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder CB3: the AI suggestion's skeleton
 * is server arithmetic (60/40 split at >= ৳1000), the
 * draft is an ordinary editable draft, and creative
 * health flags real weaknesses deterministically.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) return true;
    return row[k] === v;
  });
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
  };
}
function setup() {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "integration", "product", "aIUsageRecord", "businessProfile", "dailyAdMetric"]) tables[n] = makeTable(n);
  const planFind = tables.campaignPlan.findFirst;
  tables.campaignPlan.findFirst = async (args: any) => {
    const row = await planFind(args);
    if (row && args?.include) {
      const adSets = tables.campaignAdSet.rows.filter((s: any) => s.planId === row.id)
        .map((s: any) => ({ ...s, ads: tables.campaignAd.rows.filter((a: any) => a.adSetId === s.id) }));
      return { ...row, adSets, publishLogs: [] };
    }
    return row;
  };
  tables.businessProfile.findUnique = async () => ({ organizationId: "org", industry: "fashion retail", brandVoice: "friendly", websiteUrl: "https://shop.example" });
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", sourceType: "api", externalId: "act_1", name: "Main", currency: "BDT" });
  tables.product.rows.push({ id: "prod-1", organizationId: "org", status: "ACTIVE", name: "Cotton Panjabi", priceMinor: 150000n, currency: "BDT", category: "clothing", description: "Comfortable" });
  const svc = new CampaignsService(tables as any, { log: async () => undefined } as any, { getProvider: () => new DevTemplateProvider() } as any);
  return { tables, svc };
}

describe("CB3 AI planner + creative health", () => {
  it("suggestPlan builds a draft with server-computed 60/40 budgets and grounded facts", async () => {
    const { svc, tables } = setup();
    const out = await svc.suggestPlan("org", "u1", { adAccountId: "acc-1", productId: "prod-1", goal: "বিক্রি বাড়ানো", totalDailyBudget: "2000" });
    expect(out.plan.status).toBe("draft");
    expect(out.plan.adSets).toHaveLength(2);
    const budgets = out.plan.adSets.map((s: any) => String(s.dailyBudgetMinor)).sort();
    expect(budgets).toEqual(["120000", "80000"]);
    const interestSet = out.plan.adSets.find((s: any) => (s.targeting?.interests ?? []).length);
    expect(interestSet.targeting.interests).toContain("Fashion");
    const ads = tables.campaignAd.rows;
    expect(ads).toHaveLength(2);
    expect(ads.every((a: any) => a.createdByAi)).toBe(true);
    expect(ads[0].primaryText).toContain("BDT 1500.00");
    expect(out.facts.price).toBe("BDT 1500.00");
    expect(out.facts.pastPerformance).toBeNull();
  });

  it("a small budget yields a single ad set at 100%", async () => {
    const { svc } = setup();
    const out = await svc.suggestPlan("org", "u1", { adAccountId: "acc-1", productId: "prod-1", totalDailyBudget: "500" });
    expect(out.plan.adSets).toHaveLength(1);
    expect(String(out.plan.adSets[0].dailyBudgetMinor)).toBe("50000");
  });

  it("creativeHealth flags a long text, a missing image, and a foreign domain", async () => {
    const { svc } = setup();
    const plan: any = await svc.createPlan("org", "u1", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
    const adSet: any = await svc.addAdSet("org", plan.id, { name: "S", dailyBudget: "100", optimizationGoal: "LINK_CLICKS", pageId: "pg", countries: ["BD"] });
    await svc.addAd("org", plan.id, adSet.id, {
      name: "Weak Ad", primaryText: "x".repeat(200), headline: "ঠিক আছে",
      linkUrl: "https://other-shop.example/landing",
    });
    const out = await svc.creativeHealth("org", plan.id);
    expect(out.adsChecked).toBe(1);
    const messages = out.findings.map((f: any) => f.message).join(" | ");
    expect(messages).toContain("125 অক্ষরের বেশি");
    expect(messages).toContain("ছবি ছাড়া Link Ad");
    expect(messages).toContain("আলাদা");
  });
});
