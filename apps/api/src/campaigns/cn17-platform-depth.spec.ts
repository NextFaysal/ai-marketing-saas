import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder Frontier NB8 / CN17 — native platform
 * depth. Google Performance Max as a plan target (a draft
 * kind riding the EXISTING PublishingService PMax path,
 * whose guard list is the field contract) and TikTok
 * objective choice in the plan/draft path only. Fields a
 * platform type cannot carry are listed (never silently
 * dropped); an objective missing its required inputs is a
 * readiness failure, so the platform call is never made.
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
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "integration", "product", "dailyAdMetric", "dailyAdBreakdown", "audienceRecord", "socialAccount", "catalogRecord", "productSet", "leadForm", "customFieldDef", "conversionApiSetting", "conversionEventLog", "automationRule", "automationRun", "attributionCredit", "touchpoint", "crossPlatformDraft", "platformPublication", "organization"]) tables[n] = makeTable(n);
  tables.organization.rows.push({ id: "org", name: "Qosprey Fashion Ltd", brandName: "Qosprey", logoUrl: "https://cdn.example/logo.png" });
  tables.adAccount.rows.push(
    { id: "acc-1", organizationId: "org", platform: "meta", externalId: "act_777", name: "Meta Main", currency: "BDT", integrationId: "int-1" },
    { id: "acc-g", organizationId: "org", platform: "google", externalId: "123-456", name: "Google Main", currency: "BDT", integrationId: "int-g" },
    { id: "acc-t", organizationId: "org", platform: "tiktok", externalId: "tt-1", name: "TikTok Main", currency: "BDT", integrationId: "int-t" },
  );
  // ABO plan: one ad set at 500/day, two ads with images
  // and interests (the Search keywords), one video ad.
  tables.campaignPlan.rows.push({ id: "plan-1", organizationId: "org", adAccountId: "acc-1", name: "Eid Launch", objective: "OUTCOME_SALES", status: "approved", budgetMode: "abo", createdById: "u1" });
  tables.campaignAdSet.rows.push({ id: "set-1", planId: "plan-1", name: "Set A", dailyBudgetMinor: 50000n, billingEvent: "IMPRESSIONS", optimizationGoal: "OFFSITE_CONVERSIONS", targeting: { countries: ["BD"], interests: ["Fashion", "Shoes"] } });
  tables.campaignAd.rows.push(
    { id: "ad-1", adSetId: "set-1", name: "Ad One", primaryText: "সেরা কালেকশন এখনই দেখুন, সারা দেশে ডেলিভারি", headline: "ঈদ কালেকশন ২০২৬", description: "সারা দেশে হোম ডেলিভারি", linkUrl: "https://shop.example.com/p1", callToAction: "SHOP_NOW", format: "link", imageUrl: "https://cdn.example/hero.jpg" },
    { id: "ad-2", adSetId: "set-1", name: "Ad Two", primaryText: "নতুন স্টক এসেছে", headline: "নতুন স্টক", description: "ক্যাশ অন ডেলিভারি সুবিধা", linkUrl: "https://shop.example.com/p2", callToAction: "SHOP_NOW", format: "video", videoAssetId: "asset-v1" },
  );
  const calls: any[] = [];
  const publishing = {
    publishGoogle: async (org: string, actor: string, fields: any) => { calls.push({ method: "publishGoogle", fields }); return { id: "pub-g1", status: "created_paused", externalCampaignId: "g-camp-1", detail: { steps: [] } }; },
    publishGooglePmax: async (org: string, actor: string, fields: any) => { calls.push({ method: "publishGooglePmax", fields }); return { id: "pub-p1", status: "created_paused", externalCampaignId: "g-pmax-1", detail: { steps: [], kind: "performance_max" } }; },
    publishTikTok: async (org: string, actor: string, fields: any) => { calls.push({ method: "publishTikTok", fields }); return { id: "pub-t1", status: "created_paused", externalCampaignId: "t-camp-1", detail: { steps: [], identityId: "ident-1" } }; },
  };
  const audit = { log: async () => undefined } as any;
  const svc = new CampaignsService(tables as any, audit, { getProvider: () => new DevTemplateProvider() } as any, publishing as any);
  return { tables, svc, calls };
}

describe("CN17 — Google Performance Max as a plan target", () => {
  it("maps the plan into the PMax field contract and creates PAUSED through the PMax path only", async () => {
    const { svc, tables, calls } = setup();
    const out: any = await svc.crossPlatformDraft("org", "plan-1", "u1", { platform: "google", targetAdAccountId: "acc-g", kind: "pmax" });
    expect(out.status).toBe("created");
    expect(out.kind).toBe("pmax");
    expect(calls.map((c) => c.method)).toEqual(["publishGooglePmax"]);
    const f = calls[0].fields;
    expect(f.businessName).toBe("Qosprey");
    expect(f.logoUrl).toBe("https://cdn.example/logo.png");
    expect(f.imageUrls).toEqual(["https://cdn.example/hero.jpg"]);
    expect(f.headlines.length).toBeGreaterThanOrEqual(3);
    expect(f.longHeadlines.length).toBeGreaterThanOrEqual(1);
    expect(f.descriptions.length).toBeGreaterThanOrEqual(2);
    // the CN9 budget honouring: the draft's daily budget IS
    // the plan's effective daily figure (ABO ad-set sum).
    expect(f.dailyBudget).toBe("500.00");
    const draft = tables.crossPlatformDraft.rows.find((d: any) => d.id === out.draftId);
    expect(draft.kind).toBe("pmax");
    expect(draft.status).toBe("created");
    // unmappable concepts are LISTED on the draft, not dropped
    expect(out.notCarried.some((n: string) => n.includes("Keyword"))).toBe(true);
    expect(out.notCarried.some((n: string) => n.includes("ভিডিও"))).toBe(true);
    expect(draft.unmapped.some((n: string) => n.includes("Keyword"))).toBe(true);
  });

  it("a missing full logo URL blocks creation — the draft is stored as the export package, platform never called", async () => {
    const { svc, tables, calls } = setup();
    tables.organization.rows[0].logoUrl = "/uploads/logo.png"; // API-relative path, as org logos often are
    const out: any = await svc.crossPlatformDraft("org", "plan-1", "u1", { platform: "google", targetAdAccountId: "acc-g", kind: "pmax" });
    expect(out.status).toBe("blocked");
    expect(calls.length).toBe(0);
    expect(out.unmapped.some((n: string) => n.includes("Logo"))).toBe(true);
    const draft = tables.crossPlatformDraft.rows.find((d: any) => d.id === out.draftId);
    expect(draft.kind).toBe("pmax");
    expect(draft.status).toBe("blocked");
  });

  it("readiness + preview speak PMax, and publish stays gated after a breaking edit", async () => {
    const { svc, calls } = setup();
    const out: any = await svc.crossPlatformDraft("org", "plan-1", "u1", { platform: "google", targetAdAccountId: "acc-g", kind: "pmax" });
    const ready = await svc.crossPlatformDraftReadiness("org", "plan-1", out.draftId);
    expect(ready.ready).toBe(true);
    const preview: any = await svc.previewCrossPlatformDraft("org", "plan-1", out.draftId);
    expect(preview.kind).toBe("pmax");
    expect(preview.longHeadlines.length).toBeGreaterThanOrEqual(1);
    expect(preview.notes.some((n: string) => n.includes("Keyword"))).toBe(true);
    const bad = await svc.updateCrossPlatformDraft("org", "u1", "plan-1", out.draftId, { headlines: ["এক", "দুই"] });
    expect(bad.problems.some((p: string) => p.includes("৩–১৫টি Headline"))).toBe(true);
    const before = calls.length;
    const pub: any = await svc.publishCrossPlatformDraft("org", "u1", "plan-1", out.draftId);
    expect(pub.status).toBe("blocked");
    expect(calls.length).toBe(before); // platform never called on failed readiness
  });

  it("validateCrossPlatformFields mirrors the PMax skeleton guards", () => {
    const { svc } = setup();
    const good = { name: "X", dailyBudget: "100", countryCodes: ["BD"], finalUrl: "https://s.example", businessName: "Shop", logoUrl: "https://cdn.example/l.png", headlines: ["a", "b", "c"], longHeadlines: ["long"], descriptions: ["d1", "d2"], imageUrls: ["https://cdn.example/i.jpg"] };
    expect(svc.validateCrossPlatformFields("google", good, "pmax")).toEqual([]);
    expect(svc.validateCrossPlatformFields("google", { ...good, logoUrl: "" }, "pmax").some((p) => p.includes("Logo"))).toBe(true);
    expect(svc.validateCrossPlatformFields("google", { ...good, descriptions: ["only"] }, "pmax").some((p) => p.includes("২–৫টি Description"))).toBe(true);
  });
});

describe("CN17 — TikTok objective choice (draft path only)", () => {
  it("defaults to TRAFFIC — the stored fields carry the objective explicitly", async () => {
    const { svc, calls } = setup();
    const out: any = await svc.crossPlatformDraft("org", "plan-1", "u1", { platform: "tiktok", targetAdAccountId: "acc-t" });
    expect(out.status).toBe("created");
    expect(out.mapped.objectiveType).toBe("TRAFFIC");
    expect(calls[0].fields.objectiveType).toBe("TRAFFIC");
  });

  it("WEB_CONVERSIONS without pixel/event is blocked before any platform call, with the missing inputs named", async () => {
    const { svc, calls } = setup();
    const out: any = await svc.crossPlatformDraft("org", "plan-1", "u1", { platform: "tiktok", targetAdAccountId: "acc-t", objectiveType: "WEB_CONVERSIONS" });
    expect(out.status).toBe("blocked");
    expect(calls.length).toBe(0);
    expect(out.unmapped.some((n: string) => n.includes("Pixel ID"))).toBe(true);
    expect(out.unmapped.some((n: string) => n.includes("Optimization Event"))).toBe(true);
  });

  it("WEB_CONVERSIONS with pixel + event creates, and the create call receives them (budget honoured)", async () => {
    const { svc, calls } = setup();
    const out: any = await svc.crossPlatformDraft("org", "plan-1", "u1", { platform: "tiktok", targetAdAccountId: "acc-t", objectiveType: "WEB_CONVERSIONS", pixelId: "px-9", optimizationEvent: "COMPLETE_PAYMENT" });
    expect(out.status).toBe("created");
    expect(calls[0].fields).toMatchObject({ objectiveType: "WEB_CONVERSIONS", pixelId: "px-9", optimizationEvent: "COMPLETE_PAYMENT", dailyBudget: "500.00" });
  });

  it("LEAD_GENERATION is stored as the draft's choice but blocked with the Instant Form reason — never sent to fail", async () => {
    const { svc, tables, calls } = setup();
    const out: any = await svc.crossPlatformDraft("org", "plan-1", "u1", { platform: "tiktok", targetAdAccountId: "acc-t", objectiveType: "LEAD_GENERATION" });
    expect(out.status).toBe("blocked");
    expect(calls.length).toBe(0);
    expect(out.unmapped.some((n: string) => n.includes("Instant Form"))).toBe(true);
    const draft = tables.crossPlatformDraft.rows.find((d: any) => d.id === out.draftId);
    expect(draft.fields.objectiveType).toBe("LEAD_GENERATION");
    // and readiness on the stored draft keeps refusing
    const ready = await svc.crossPlatformDraftReadiness("org", "plan-1", out.draftId);
    expect(ready.ready).toBe(false);
  });

  it("a pixel id on a TRAFFIC draft is a readiness failure (TikTok rejects an ad-group pixel there)", async () => {
    const { svc, calls } = setup();
    const out: any = await svc.crossPlatformDraft("org", "plan-1", "u1", { platform: "tiktok", targetAdAccountId: "acc-t", objectiveType: "TRAFFIC", pixelId: "px-9" });
    expect(out.status).toBe("blocked");
    expect(calls.length).toBe(0);
    expect(out.unmapped.some((n: string) => n.includes("Reject"))).toBe(true);
  });

  it("an unknown objective is refused at the door", async () => {
    const { svc } = setup();
    await expect(svc.crossPlatformDraft("org", "plan-1", "u1", { platform: "tiktok", targetAdAccountId: "acc-t", objectiveType: "APP_PROMOTION" })).rejects.toThrow(/objectiveType/);
  });
});
