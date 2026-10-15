import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder Next CN9: cross-platform v2 — the CB6
 * budget carry-over fix (effective budget, labelled by
 * mode) and CB6 drafts as manageable objects: stored,
 * editable within the platform's real fields,
 * readiness-gated, previewed locally, re-created (never
 * edited in place) through PublishingService, with an
 * honest no-read-path status sync.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("not" in v) return row[k] !== (v as any).not;
      return true;
    }
    return row[k] === v;
  });
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findUnique: async ({ where }: any = {}) => rows.find((r) => r.id === where.id) ?? null,
    findMany: async ({ where, take }: any = {}) => { const f = rows.filter((r) => matches(r, where ?? {})); return take ? f.slice(0, take) : f; },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); rows.splice(i, 1); return {}; },
  };
}
function setup() {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "integration", "product", "dailyAdMetric", "dailyAdBreakdown", "audienceRecord", "socialAccount", "catalogRecord", "productSet", "leadForm", "customFieldDef", "conversionApiSetting", "conversionEventLog", "automationRule", "automationRun", "attributionCredit", "touchpoint", "crossPlatformDraft", "platformPublication"]) tables[n] = makeTable(n);
  tables.adAccount.rows.push(
    { id: "acc-1", organizationId: "org", platform: "meta", externalId: "act_777", name: "Meta Main", currency: "BDT", integrationId: "int-1" },
    { id: "acc-g", organizationId: "org", platform: "google", externalId: "123-456", name: "Google Main", currency: "BDT", integrationId: "int-g" },
    { id: "acc-t", organizationId: "org", platform: "tiktok", externalId: "tt-1", name: "TikTok Main", currency: "BDT", integrationId: "int-t" },
  );
  // CBO plan: campaign daily 80000, ad sets sum 50000.
  tables.campaignPlan.rows.push({ id: "plan-cbo", organizationId: "org", adAccountId: "acc-1", name: "CBO Launch", objective: "OUTCOME_SALES", status: "approved", budgetMode: "cbo", campaignDailyBudgetMinor: 80000n, createdById: "u1" });
  tables.campaignAdSet.rows.push({ id: "set-1", planId: "plan-cbo", name: "Set A", dailyBudgetMinor: 50000n, billingEvent: "IMPRESSIONS", optimizationGoal: "OFFSITE_CONVERSIONS", targeting: { countries: ["BD"], interests: ["Fashion", "Shoes"] } });
  tables.campaignAd.rows.push(
    { id: "ad-1", adSetId: "set-1", name: "Ad One", primaryText: "সেরা কালেকশন এখনই দেখুন", headline: "ঈদ কালেকশন ২০২৬", description: "সারা দেশে হোম ডেলিভারি", linkUrl: "https://shop.example.com/p1", callToAction: "SHOP_NOW", format: "link" },
    { id: "ad-2", adSetId: "set-1", name: "Ad Two", primaryText: "নতুন স্টক এসেছে", headline: "নতুন স্টক", description: "ক্যাশ অন ডেলিভারি সুবিধা", linkUrl: "https://shop.example.com/p2", callToAction: "SHOP_NOW", format: "link" },
  );
  const calls: any[] = [];
  const publishing = {
    publishGoogle: async (org: string, actor: string, fields: any) => { calls.push({ platform: "google", fields }); return { id: "pub-g1", status: "created_paused", externalCampaignId: "g-camp-1", detail: { steps: [] } }; },
    publishTikTok: async (org: string, actor: string, fields: any) => { calls.push({ platform: "tiktok", fields }); return { id: "pub-t1", status: "created_paused", externalCampaignId: "t-camp-1", detail: { steps: [], identityId: "ident-1" } }; },
  };
  tables.platformPublication.rows.push({ id: "pub-t1", organizationId: "org", platform: "tiktok", adAccountId: "acc-t", name: "CBO Launch", status: "created_paused", externalCampaignId: "t-camp-1", detail: { steps: [], identityId: "ident-1" }, createdById: "u1" });
  const audit = { log: async () => undefined } as any;
  const svc = new CampaignsService(tables as any, audit, { getProvider: () => new DevTemplateProvider() } as any, publishing as any);
  return { tables, svc, calls };
}

describe("CN9 budget carry-over fix", () => {
  it("CBO plans map the campaign budget (labelled), not the ad-set sum", async () => {
    const { svc, tables } = setup();
    const out = await svc.crossPlatformDraft("org", "plan-cbo", "u1", { platform: "google", targetAdAccountId: "acc-g" });
    expect(out.status).toBe("created");
    expect(out.mapped.dailyBudget).toBe("800.00");
    expect((out as any).budget).toEqual({ mode: "cbo", effectiveDailyMinor: "80000", adSetDailyTotalMinor: "50000", source: "campaign_budget" });
    expect(out.transformations.some((t: string) => t.includes("CBO"))).toBe(true);
    // and the creation is persisted as a manageable draft
    expect(out.draftId).toBeTruthy();
    const draft = tables.crossPlatformDraft.rows.find((d: any) => d.id === out.draftId);
    expect(draft.status).toBe("created");
    expect(draft.fields.dailyBudget).toBe("800.00");
    expect(draft.externalCampaignId).toBe("g-camp-1");
  });

  it("ABO plans keep the ad-set sum, labelled ad_set_sum", async () => {
    const { tables, svc } = setup();
    tables.campaignPlan.rows[0].budgetMode = "abo";
    tables.campaignPlan.rows[0].campaignDailyBudgetMinor = null;
    const out = await svc.crossPlatformDraft("org", "plan-cbo", "u1", { platform: "google", targetAdAccountId: "acc-g" });
    expect(out.mapped.dailyBudget).toBe("500.00");
    expect((out as any).budget.source).toBe("ad_set_sum");
  });

  it("a blocked mapping is stored as a draft whose fields are the export package", async () => {
    const { svc, tables } = setup();
    // TikTok needs an image/video URL; the ads carry none.
    const out = await svc.crossPlatformDraft("org", "plan-cbo", "u1", { platform: "tiktok", targetAdAccountId: "acc-t" });
    expect(out.status).toBe("blocked");
    const draft = tables.crossPlatformDraft.rows.find((d: any) => d.id === out.draftId);
    expect(draft.status).toBe("blocked");
    expect(draft.unmapped.length).toBeGreaterThan(0);
    expect(draft.fields.adText).toBeTruthy();
  });
});

describe("CN9 manageable drafts", () => {
  async function createdGoogleDraft(svc: any) {
    const out = await svc.crossPlatformDraft("org", "plan-cbo", "u1", { platform: "google", targetAdAccountId: "acc-g" });
    return out.draftId as string;
  }

  it("edit validates against the platform's real field rules and flips a created draft back to mapped", async () => {
    const { svc, tables } = setup();
    const draftId = await createdGoogleDraft(svc);
    const bad = await svc.updateCrossPlatformDraft("org", "u1", "plan-cbo", draftId, { headlines: ["a".repeat(31), "দুই", "তিন"] });
    expect(bad.problems.some((p: string) => p.includes("৩০ অক্ষরের বেশি"))).toBe(true);
    const row = tables.crossPlatformDraft.rows.find((d: any) => d.id === draftId);
    expect(row.status).toBe("mapped"); // external draft unchanged; this copy needs re-publish
    const ready = await svc.crossPlatformDraftReadiness("org", "plan-cbo", draftId);
    expect(ready.ready).toBe(false);
  });

  it("readiness gates publish: a broken draft is never sent; a fixed one re-creates PAUSED", async () => {
    const { svc, calls } = setup();
    const draftId = await createdGoogleDraft(svc);
    const before = calls.length;
    await svc.updateCrossPlatformDraft("org", "u1", "plan-cbo", draftId, { headlines: ["শুধু একটি"] });
    const blocked = await svc.publishCrossPlatformDraft("org", "u1", "plan-cbo", draftId);
    expect(blocked.status).toBe("blocked");
    expect(calls.length).toBe(before); // platform never called
    await svc.updateCrossPlatformDraft("org", "u1", "plan-cbo", draftId, { headlines: ["একটি ভালো হেডলাইন", "দ্বিতীয় হেডলাইন", "তৃতীয় হেডলাইন"] });
    const ready = await svc.crossPlatformDraftReadiness("org", "plan-cbo", draftId);
    expect(ready.ready).toBe(true);
    const published = await svc.publishCrossPlatformDraft("org", "u1", "plan-cbo", draftId);
    expect(published.status).toBe("created");
    expect(calls.length).toBe(before + 1);
    expect(published.note).toContain("নতুন PAUSED Draft");
  });

  it("preview renders stored fields locally with limits; sync honestly reports no read path", async () => {
    const { svc } = setup();
    const draftId = await createdGoogleDraft(svc);
    const preview = await svc.previewCrossPlatformDraft("org", "plan-cbo", draftId);
    expect(preview.kind).toBe("rsa");
    expect(preview.label).toContain("স্থানীয় Rendering");
    expect(preview.headlines[0].limit).toBe(30);
    const sync = await svc.syncCrossPlatformDraftStatus("org", "plan-cbo", draftId);
    expect(sync.available).toBe(false);
    expect(sync.statusLabel).toBe("as_created");
    expect(sync.externalCampaignId).toBe("g-camp-1");
  });

  it("field validation catches TikTok limits too", async () => {
    const { svc } = setup();
    expect(svc.validateCrossPlatformFields("tiktok", { name: "x", dailyBudget: "100", countryCodes: ["BD"], adText: "a".repeat(101), landingUrl: "https://x.com", imageUrl: "https://x.com/i.png" }).length).toBeGreaterThan(0);
    expect(svc.validateCrossPlatformFields("tiktok", { name: "x", dailyBudget: "100", countryCodes: ["BD"], adText: "ঠিক আছে", landingUrl: "https://x.com", imageUrl: "https://x.com/i.png" })).toEqual([]);
  });
});
