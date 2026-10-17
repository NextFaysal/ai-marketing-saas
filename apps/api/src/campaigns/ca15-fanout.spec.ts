import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder Advanced CA15 (CB4): one-click
 * fan-out — a PREVIEW that computes the Google + TikTok
 * mappings with their gaps and creates NOTHING, a CREATE
 * that runs only on confirmation and re-maps
 * server-side through the existing single-draft path,
 * CA13-templated names per target platform, the budget
 * copied in BDT (labelled, never converted), TikTok's
 * single text with extra CN5 variants in notCarried,
 * and the plan's audience signals carried VERBATIM into
 * PMax draft fields (never dropped, never sent to
 * Google as a fake user list).
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
    findUnique: async ({ where }: any = {}) => rows.find((r) => r.id === where.id || r.organizationId === where.organizationId) ?? null,
    findMany: async ({ where, take }: any = {}) => { const f = rows.filter((r) => matches(r, where ?? {})); return take ? f.slice(0, take) : f; },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id || r.organizationId === where.organizationId); if (row) Object.assign(row, data); return row; },
    updateMany: async ({ where, data }: any) => { let n = 0; for (const r of rows) if (matches(r, where ?? {})) { Object.assign(r, data); n++; } return { count: n }; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); rows.splice(i, 1); return {}; },
  };
}

function setup() {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "integration", "product", "audienceRecord", "savedAudience", "creativeAsset", "businessProfile", "organization", "crossPlatformDraft", "platformPublication"]) tables[n] = makeTable(n);
  tables.adAccount.rows.push(
    { id: "acc-1", organizationId: "org", platform: "meta", externalId: "act_777", name: "Meta Main", currency: "BDT", integrationId: "int-1" },
    { id: "acc-g", organizationId: "org", platform: "google", externalId: "123-456", name: "Google Main", currency: "BDT", integrationId: "int-g" },
    { id: "acc-t", organizationId: "org", platform: "tiktok", externalId: "tt-1", name: "TikTok Main", currency: "BDT", integrationId: "int-t" },
    { id: "acc-g2", organizationId: "other-org", platform: "google", externalId: "999", name: "Foreign Google", currency: "BDT", integrationId: "int-x" },
  );
  tables.organization.rows.push({ id: "org", name: "Qosprey Shop", brandName: "Qosprey", logoUrl: "https://cdn.example.com/logo.png", timezone: "Asia/Dhaka", attributionWindowDays: 30 });
  // A rich plan: saved + custom audiences, restricted
  // age, a lead form + catalog set (gaps), two distinct
  // landing URLs, CN5 text options, a video ad.
  tables.campaignPlan.rows.push({ id: "plan-1", organizationId: "org", adAccountId: "acc-1", name: "Eid Campaign", objective: "OUTCOME_SALES", status: "approved", budgetMode: "abo", createdById: "u1" });
  tables.campaignAdSet.rows.push(
    { id: "set-1", planId: "plan-1", name: "Set A", dailyBudgetMinor: 50000n, billingEvent: "IMPRESSIONS", optimizationGoal: "OFFSITE_CONVERSIONS", targeting: { countries: ["BD"], interests: ["Fashion"], ageMin: 25, ageMax: 40, customAudienceIds: ["aud-ext-1"], savedAudienceId: "saved-1" } },
    { id: "set-2", planId: "plan-1", name: "Set B", dailyBudgetMinor: 30000n, billingEvent: "IMPRESSIONS", optimizationGoal: "OFFSITE_CONVERSIONS", leadFormId: "form-1", targeting: { countries: ["BD"], interests: ["Shoes"] } },
  );
  tables.campaignAd.rows.push(
    { id: "ad-1", adSetId: "set-1", name: "Ad One", primaryText: "সেরা কালেকশন এখনই দেখুন", headline: "ঈদ কালেকশন ২০২৬", description: "সারা দেশে হোম ডেলিভারি", linkUrl: "https://shop.example.com/p1", callToAction: "SHOP_NOW", format: "link", textOptions: { primaryTexts: ["সেরা কালেকশন এখনই দেখুন", "দ্বিতীয় অপশন টেক্সট"], headlines: ["ঈদ কালেকশন ২০২৬", "নতুন অফার"], descriptions: ["সারা দেশে হোম ডেলিভারি"] }, imageUrl: "https://cdn.example.com/ad1.jpg" },
    { id: "ad-2", adSetId: "set-2", name: "Ad Two", primaryText: "ভিডিও অ্যাড টেক্সট", headline: "ভিডিও হেডলাইন", description: "ভিডিও বিবরণ", linkUrl: "https://shop.example.com/p2", callToAction: "SHOP_NOW", format: "video", videoAssetId: "vid-1" },
  );
  tables.savedAudience.rows.push({ id: "saved-1", organizationId: "org", name: "ঢাকার ক্রেতা", targeting: {}, createdById: "u1" });
  tables.audienceRecord.rows.push({ id: "rec-1", organizationId: "org", adAccountId: "acc-1", name: "ক্রেতা তালিকা", kind: "custom", source: "customers", externalAudienceId: "aud-ext-1", status: "ready", createdById: "u1" });
  tables.creativeAsset.rows.push({ id: "vid-1", organizationId: "org", adAccountId: "acc-1", kind: "video", name: "Promo Video", sourceUrl: "https://cdn.example.com/promo.mp4", status: "ready", createdById: "u1" });
  const calls: any[] = [];
  const publishing = {
    publishGoogle: async (org: string, actor: string, fields: any) => { calls.push({ platform: "google", fields }); return { id: "pub-g1", status: "created_paused", externalCampaignId: "g-camp-1", detail: { steps: [] } }; },
    publishGooglePmax: async (org: string, actor: string, fields: any) => { calls.push({ platform: "google-pmax", fields }); return { id: "pub-g2", status: "created_paused", externalCampaignId: "g-camp-2", detail: { steps: [] } }; },
    publishTikTok: async (org: string, actor: string, fields: any) => { calls.push({ platform: "tiktok", fields }); return { id: "pub-t1", status: "created_paused", externalCampaignId: "t-camp-1", detail: { steps: [], identityId: "ident-1" } }; },
  };
  const audit = { log: async () => undefined } as any;
  const svc = new CampaignsService(tables as any, audit, { getProvider: () => new DevTemplateProvider() } as any, publishing as any);
  return { tables, svc, calls };
}

describe("CA15 fan-out preview", () => {
  it("creates NOTHING: no draft rows, no publishing calls, no publish logs", async () => {
    const { svc, tables, calls } = setup();
    const out = await svc.fanoutPreview("org", "plan-1", "u1", { googleAccountId: "acc-g", tiktokAccountId: "acc-t" });
    expect(out.platforms).toHaveLength(2);
    expect(calls).toHaveLength(0);
    expect(tables.crossPlatformDraft.rows).toHaveLength(0);
    expect(tables.campaignPublishLog.rows).toHaveLength(0);
  });

  it("maps Google Search RSA from CN5 textOptions and TikTok's single text + variants in notCarried", async () => {
    const { svc } = setup();
    const out = await svc.fanoutPreview("org", "plan-1", "u1", { googleAccountId: "acc-g", tiktokAccountId: "acc-t" });
    const g = out.platforms.find((b: any) => b.platform === "google");
    expect(g.status).toBe("ready");
    expect(g.mapped.headlines).toContain("ঈদ কালেকশন ২০২৬");
    expect(g.mapped.headlines).toContain("নতুন অফার");
    expect(g.mapped.keywords).toEqual(expect.arrayContaining([{ text: "Fashion" }, { text: "Shoes" }]));
    const t = out.platforms.find((b: any) => b.platform === "tiktok");
    expect(t.mapped.adText).toBe("সেরা কালেকশন এখনই দেখুন");
    expect(t.notCarried.some((n: string) => n.includes("ACO"))).toBe(true);
    // the video creative rides TikTok by resolved URL
    expect(t.mapped.videoUrl).toBe("https://cdn.example.com/promo.mp4");
  });

  it("budget is copied in BDT and labelled — never converted", async () => {
    const { svc } = setup();
    const out = await svc.fanoutPreview("org", "plan-1", "u1", { googleAccountId: "acc-g", tiktokAccountId: "acc-t" });
    for (const b of out.platforms) {
      expect(b.mapped.dailyBudget).toBe("800.00"); // 50000 + 30000 minor
      expect(b.budget.source).toBe("ad_set_sum");
      expect(b.budget.effectiveDailyMinor).toBe("80000");
    }
  });

  it("gaps are complete: audience, restricting age, lead form, distinct URLs all listed", async () => {
    const { svc } = setup();
    const out = await svc.fanoutPreview("org", "plan-1", "u1", { googleAccountId: "acc-g", tiktokAccountId: "acc-t" });
    for (const b of out.platforms) {
      expect(b.notCarried.some((n: string) => n.includes("Audience Signal"))).toBe(true);
      expect(b.notCarried.some((n: string) => n.includes("বয়স/লিঙ্গ"))).toBe(true);
      expect(b.notCarried.some((n: string) => n.includes("Lead Form"))).toBe(true);
      expect(b.notCarried.some((n: string) => n.includes("Landing URL এক নয়"))).toBe(true);
    }
  });

  it("PMax carries the plan's audience signals VERBATIM into the draft fields", async () => {
    const { svc } = setup();
    const out = await svc.fanoutPreview("org", "plan-1", "u1", { googleAccountId: "acc-g", googleKind: "pmax" });
    const g = out.platforms[0];
    expect(g.kind).toBe("pmax");
    expect(g.mapped.audienceSignals).toEqual([
      { source: "saved_audience", savedAudienceId: "saved-1", name: "ঢাকার ক্রেতা" },
      { source: "custom_audience", externalAudienceId: "aud-ext-1", name: "ক্রেতা তালিকা", kind: "custom", recordId: "rec-1", excluded: false },
    ]);
    // and the honesty note: stored on the draft, NOT sent to Google
    expect(g.transformations.some((t: string) => t.includes("Google-এ পাঠানো হয়নি"))).toBe(true);
  });

  it("uses the CA13 naming template per target platform when set", async () => {
    const { svc, tables } = setup();
    tables.businessProfile.rows.push({ id: "bp-1", organizationId: "org", campaignNamingTemplate: "{product} - {platform} - {date}" });
    tables.product.rows.push({ id: "prod-1", organizationId: "org", name: "Panjabi" });
    tables.campaignAd.rows[0].productId = "prod-1";
    const out = await svc.fanoutPreview("org", "plan-1", "u1", { googleAccountId: "acc-g", tiktokAccountId: "acc-t" });
    const g = out.platforms.find((b: any) => b.platform === "google");
    const t = out.platforms.find((b: any) => b.platform === "tiktok");
    // plan-level tokens: product/audience are ad/ad-set
    // level values in CA13, so the plan render has no
    // product — what renders is platform + date.
    expect(g.mapped.name).toContain("Google");
    expect(t.mapped.name).toContain("TikTok");
    expect(g.mapped.name).not.toBe(t.mapped.name);
    expect(g.transformations.some((x: string) => x.includes("Naming Template"))).toBe(true);
  });

  it("a foreign or wrong-platform account is a per-platform error, not a whole-preview failure", async () => {
    const { svc } = setup();
    const out = await svc.fanoutPreview("org", "plan-1", "u1", { googleAccountId: "acc-g2", tiktokAccountId: "acc-t" });
    const g = out.platforms.find((b: any) => b.platform === "google");
    const t = out.platforms.find((b: any) => b.platform === "tiktok");
    expect(g.status).toBe("error");
    expect(t.status).toBe("ready");
  });

  it("refuses an unapproved plan and an empty target set", async () => {
    const { svc, tables } = setup();
    tables.campaignPlan.rows.push({ id: "plan-draft", organizationId: "org", adAccountId: "acc-1", name: "Draft Plan", objective: "OUTCOME_SALES", status: "draft", budgetMode: "abo", createdById: "u1" });
    await expect(svc.fanoutPreview("org", "plan-draft", "u1", { googleAccountId: "acc-g" })).rejects.toThrow(/Approved Plan/);
    await expect(svc.fanoutPreview("org", "plan-1", "u1", {})).rejects.toThrow(/Target Account/);
  });
});

describe("CA15 fan-out create (confirmed)", () => {
  it("creates both platforms' PAUSED drafts, linked to the plan, only on create", async () => {
    const { svc, tables, calls } = setup();
    const out = await svc.fanoutCreate("org", "plan-1", "u1", { googleAccountId: "acc-g", tiktokAccountId: "acc-t" });
    expect(out.created).toBe(2);
    expect(calls.map((c: any) => c.platform).sort()).toEqual(["google", "tiktok"]);
    const drafts = tables.crossPlatformDraft.rows;
    expect(drafts).toHaveLength(2);
    expect(drafts.every((d: any) => d.planId === "plan-1" && d.status === "created")).toBe(true);
    // TikTok draft carries the resolved video URL
    const td = drafts.find((d: any) => d.platform === "tiktok");
    expect(td.fields.videoUrl).toBe("https://cdn.example.com/promo.mp4");
  });

  it("one platform's blocked mapping never masks the other's creation", async () => {
    const { svc, tables } = setup();
    // Remove all interests → Google Search is blocked;
    // TikTok does not need interests and still creates.
    for (const s of tables.campaignAdSet.rows) s.targeting = { ...s.targeting, interests: [] };
    const out = await svc.fanoutCreate("org", "plan-1", "u1", { googleAccountId: "acc-g", tiktokAccountId: "acc-t" });
    const g = out.platforms.find((b: any) => b.platform === "google");
    const t = out.platforms.find((b: any) => b.platform === "tiktok");
    expect(g.status).toBe("blocked");
    expect(g.unmapped.some((u: string) => u.includes("Keyword"))).toBe(true);
    expect(t.status).toBe("created");
    expect(out.created).toBe(1);
  });

  it("cross-org: another org's plan is not found", async () => {
    const { svc } = setup();
    await expect(svc.fanoutCreate("other-org", "plan-1", "u1", { googleAccountId: "acc-g" })).rejects.toThrow();
  });
});
