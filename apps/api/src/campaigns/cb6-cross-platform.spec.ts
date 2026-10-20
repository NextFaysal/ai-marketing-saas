import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder CB6: an approved plan maps onto
 * the existing Google/TikTok publish paths. Whatever
 * cannot be mapped blocks the call (export package) —
 * the publish stub must stay untouched in that case.
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
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
  };
}
function setup() {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "integration", "product", "aIUsageRecord"]) tables[n] = makeTable(n);
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
  tables.adAccount.rows.push(
    { id: "acc-meta", organizationId: "org", platform: "meta", sourceType: "api", externalId: "act_1", name: "Meta", currency: "BDT" },
    { id: "acc-google", organizationId: "org", platform: "google", sourceType: "api", externalId: "123", name: "Google", currency: "BDT" },
    { id: "acc-tiktok", organizationId: "org", platform: "tiktok", sourceType: "api", externalId: "adv-1", name: "TikTok", currency: "BDT" },
  );
  const calls: any[] = [];
  const publishing = {
    publishGoogle: async (_org: string, _actor: string, dto: any) => { calls.push({ platform: "google", dto }); return { id: "pub-1", status: "created_paused", externalCampaignId: "g-camp-1" }; },
    publishTikTok: async (_org: string, _actor: string, dto: any) => { calls.push({ platform: "tiktok", dto }); return { id: "pub-2", status: "created_paused", externalCampaignId: "t-camp-1" }; },
  };
  const svc = new CampaignsService(tables as any, { log: async () => undefined } as any, { getProvider: () => new DevTemplateProvider() } as any, publishing as any);
  return { tables, svc, calls };
}
async function approvedPlan(svc: CampaignsService, tables: any, opts: { interests?: string[]; imageUrl?: string } = {}) {
  const plan: any = await svc.createPlan("org", "u1", { name: "ঈদ কালেকশন সেল ক্যাম্পেইন", objective: "OUTCOME_SALES", adAccountId: "acc-meta" });
  const adSet: any = await svc.addAdSet("org", plan.id, { name: "S", dailyBudget: "1000", optimizationGoal: "LINK_CLICKS", pageId: "pg", countries: ["BD"], interests: opts.interests });
  await svc.addAd("org", plan.id, adSet.id, { name: "প্রধান বিজ্ঞাপন", primaryText: "ঈদের সেরা কালেকশন এখন পাওয়া যাচ্ছে — অর্ডার করুন আজই", headline: "ঈদ কালেকশন এসেছে", linkUrl: "https://shop.example/eid", imageUrl: opts.imageUrl });
  await svc.addAd("org", plan.id, adSet.id, { name: "দ্বিতীয় বিজ্ঞাপন", primaryText: "সব বয়সের জন্য আরামদায়ক পোশাক", headline: "আরামদায়ক পোশাক", linkUrl: "https://shop.example/eid2" });
  tables.campaignPlan.rows.find((r: any) => r.id === plan.id).status = "approved";
  return { plan, adSet };
}

describe("CB6 cross-platform drafts", () => {
  it("google: maps budget/countries/keywords and sliced RSA fields, logs the publish", async () => {
    const { svc, tables, calls } = setup();
    const { plan } = await approvedPlan(svc, tables, { interests: ["Fashion"] });
    const out = await svc.crossPlatformDraft("org", plan.id, "u1", { platform: "google", targetAdAccountId: "acc-google" });
    expect(out.status).toBe("created");
    expect(calls).toHaveLength(1);
    const dto = calls[0].dto;
    expect(dto.dailyBudget).toBe("1000.00");
    expect(dto.countryCodes).toEqual(["BD"]);
    expect(dto.keywords).toEqual([{ text: "Fashion" }]);
    expect(dto.headlines.length).toBeGreaterThanOrEqual(3);
    expect(dto.headlines.every((h: string) => h.length <= 30)).toBe(true);
    expect(dto.descriptions.length).toBeGreaterThanOrEqual(2);
    expect(tables.campaignPublishLog.rows.some((l: any) => l.step === "google" && l.status === "success" && l.externalId === "g-camp-1")).toBe(true);
  });

  it("google: without interests the call is blocked and the publish stub stays untouched", async () => {
    const { svc, tables, calls } = setup();
    const { plan } = await approvedPlan(svc, tables);
    const out = await svc.crossPlatformDraft("org", plan.id, "u1", { platform: "google", targetAdAccountId: "acc-google" });
    expect(out.status).toBe("blocked");
    expect(out.unmapped.join(" ")).toContain("Keyword");
    expect(out.mapped.keywords).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("tiktok: needs a direct image URL; with one it creates and logs", async () => {
    const { svc, tables, calls } = setup();
    const noImg = await approvedPlan(svc, tables);
    const blocked = await svc.crossPlatformDraft("org", noImg.plan.id, "u1", { platform: "tiktok", targetAdAccountId: "acc-tiktok" });
    expect(blocked.status).toBe("blocked");
    expect(calls).toHaveLength(0);
    const withImg = await approvedPlan(svc, tables, { imageUrl: "https://cdn.example/ad.jpg" });
    const out = await svc.crossPlatformDraft("org", withImg.plan.id, "u1", { platform: "tiktok", targetAdAccountId: "acc-tiktok" });
    expect(out.status).toBe("created");
    expect(calls[0].dto.imageUrl).toBe("https://cdn.example/ad.jpg");
    expect(tables.campaignPublishLog.rows.some((l: any) => l.step === "tiktok" && l.status === "success")).toBe(true);
  });

  it("an unapproved plan and a mismatched account are refused", async () => {
    const { svc, tables } = setup();
    const plan: any = await svc.createPlan("org", "u1", { name: "Draft", objective: "OUTCOME_SALES", adAccountId: "acc-meta" });
    await expect(svc.crossPlatformDraft("org", plan.id, "u1", { platform: "google", targetAdAccountId: "acc-google" })).rejects.toThrow(/approved/);
    const ok = await approvedPlan(svc, tables, { interests: ["Fashion"] });
    await expect(svc.crossPlatformDraft("org", ok.plan.id, "u1", { platform: "google", targetAdAccountId: "acc-tiktok" })).rejects.toMatchObject({ code: "campaigns.targetAccountIsAAccountNot" });
  });
});
