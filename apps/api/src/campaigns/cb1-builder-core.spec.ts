import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder CB1: in-place ad set / ad edits,
 * single-item duplicates, and placement targeting
 * (stored + mapped into the Graph payload).
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if (k === "adSet") return matches(row.__adSet ?? {}, v);
      return true;
    }
    return row[k] === v;
  });
}
function makeTable(name: string, adSets?: any) {
  const rows: any[] = [];
  let seq = 0;
  const table: any = {
    rows,
    findFirst: async ({ where, include }: any = {}) => {
      const row = rows.find((r) => matches(r, where ?? {})) ?? null;
      if (row && include?.ads && adSets) return { ...row, ads: adSets.campaignAd.rows.filter((a: any) => a.adSetId === row.id) };
      return row;
    },
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); rows.splice(i, 1); return {}; },
  };
  return table;
}
function setup() {
  const tables: any = {};
  tables.campaignAdSet = makeTable("adset", tables);
  tables.campaignAd = makeTable("ad", tables);
  // Ads resolve their ad set for the nested plan check.
  const adFindFirst = tables.campaignAd.findFirst;
  tables.campaignAd.findFirst = async (args: any) => {
    for (const row of tables.campaignAd.rows) {
      row.__adSet = tables.campaignAdSet.rows.find((s: any) => s.id === row.adSetId) ?? {};
    }
    return adFindFirst(args);
  };
  tables.campaignPlan = makeTable("plan", tables);
  // getPlanFull includes ad sets with ads.
  const planFindFirst = tables.campaignPlan.findFirst;
  tables.campaignPlan.findFirst = async (args: any) => {
    const row = await planFindFirst(args);
    if (row && args?.include) {
      const adSets = tables.campaignAdSet.rows.filter((s: any) => s.planId === row.id)
        .map((s: any) => ({ ...s, ads: tables.campaignAd.rows.filter((a: any) => a.adSetId === s.id) }));
      return { ...row, adSets, publishLogs: [] };
    }
    return row;
  };
  tables.campaignPublishLog = makeTable("log", tables);
  tables.adAccount = makeTable("account", tables);
  tables.integration = makeTable("integration", tables);
  tables.product = makeTable("product", tables);
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", sourceType: "api", externalId: "act_1", name: "Main", currency: "BDT" });
  const svc = new CampaignsService(tables as any, { log: async () => undefined } as any, { getProvider: () => new DevTemplateProvider() } as any);
  return { tables, svc };
}

async function draftWithAd(svc: CampaignsService) {
  const plan: any = await svc.createPlan("org", "u1", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
  const adSet: any = await svc.addAdSet("org", plan.id, {
    name: "S1", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg", pixelId: "px",
    countries: ["BD"], interests: ["Fashion"],
  });
  const ad: any = await svc.addAd("org", plan.id, adSet.id, { name: "A1", primaryText: "হ্যালো", linkUrl: "https://shop.example/x" });
  return { plan, adSet, ad };
}

describe("CB1 builder core", () => {
  it("updateAdSet edits in place: budget pair replaced, targeting layered, placements stored", async () => {
    const { svc } = setup();
    const { plan, adSet } = await draftWithAd(svc);
    const updated: any = await svc.updateAdSet("org", plan.id, adSet.id, "u1", {
      lifetimeBudget: "9000", positions: ["feed", "reels"], platforms: ["instagram"], devices: ["mobile"],
    });
    expect(updated.dailyBudgetMinor).toBeNull();
    expect(updated.lifetimeBudgetMinor).toBe("900000");
    expect(updated.targeting.positions).toEqual(["feed", "reels"]);
    expect(updated.targeting.interests).toEqual(["Fashion"]); // untouched key survives
    expect(updated.targeting.countries).toEqual(["BD"]);
    await expect(svc.updateAdSet("org", plan.id, adSet.id, "u1", { positions: ["moon"] as any })).rejects.toMatchObject({ code: "campaigns.invalidAllowed" });
    await expect(svc.updateAdSet("org", plan.id, adSet.id, "u1", { dailyBudget: "", lifetimeBudget: "" })).rejects.toMatchObject({ code: "campaigns.eitherADailyOrALifetime" });
  });

  it("placements map into the Graph targeting payload per platform", async () => {
    const { svc } = setup();
    const graph = (svc as any).toGraphTargeting({ countries: ["BD"], platforms: ["facebook", "instagram"], positions: ["feed", "reels", "search"], devices: ["mobile"] });
    expect(graph.publisher_platforms).toEqual(["facebook", "instagram"]);
    expect(graph.facebook_positions).toEqual(["feed", "facebook_reels", "search"]);
    expect(graph.instagram_positions).toEqual(["stream", "reels", "ig_search"]);
    expect(graph.device_platforms).toEqual(["mobile"]);
    const bare = (svc as any).toGraphTargeting({ countries: ["BD"] });
    expect(bare.publisher_platforms).toBeUndefined();
    expect(bare.facebook_positions).toBeUndefined();
  });

  it("updateAd edits fields and enforces format rules on the merged ad", async () => {
    const { svc } = setup();
    const { plan, ad } = await draftWithAd(svc);
    const updated: any = await svc.updateAd("org", plan.id, ad.id, "u1", { headline: "নতুন হেডলাইন", primaryText: "বদলানো টেক্সট" });
    expect(updated.headline).toBe("নতুন হেডলাইন");
    await expect(svc.updateAd("org", plan.id, ad.id, "u1", { format: "video" })).rejects.toThrow(/videoAssetId/);
    await expect(svc.updateAd("org", plan.id, "foreign-ad", "u1", { headline: "x" })).rejects.toMatchObject({ code: "campaigns.adNotFoundInThisPlan" });
  });

  it("duplicateAdSet copies ads without external ids; duplicateAd clones inside the set", async () => {
    const { svc, tables } = setup();
    const { plan, adSet, ad } = await draftWithAd(svc);
    const copy: any = await svc.duplicateAdSet("org", plan.id, adSet.id, "u1");
    expect(copy.name).toContain("(কপি)");
    expect(copy.ads).toHaveLength(1);
    expect(copy.externalAdSetId ?? null).toBeNull();
    const adCopy: any = await svc.duplicateAd("org", plan.id, ad.id, "u1");
    expect(adCopy.adSetId).toBe(adSet.id);
    expect(tables.campaignAd.rows).toHaveLength(3);
  });

  it("edits are refused once the plan leaves draft", async () => {
    const { svc } = setup();
    const { plan, adSet } = await draftWithAd(svc);
    await svc.submitForApproval("org", "u1", plan.id);
    await expect(svc.updateAdSet("org", plan.id, adSet.id, "u1", { name: "X" })).rejects.toMatchObject({ code: "campaigns.planIsAndCanNoLonger" });
  });
});
