import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * CA3 — Google RSA assembly from CN5 text options + TikTok
 * spike handling.
 *
 * Proven: the Google Search draft's headlines[]/
 * descriptions[] are assembled from the ads' textOptions
 * (merged with the legacy fields, deduped); Google's hard
 * limits (15 headlines ≤30 chars, 4 descriptions ≤90) are
 * enforced by listing over-limit/overflow options in
 * notCarried — never by silently truncating (the pre-CA3
 * behaviour); the SAME arrays reach PublishingService.
 * publishGoogle unchanged. TikTok stays single-text (the
 * standard /ad/create/ contract) and extra CN5 variants are
 * listed in notCarried with the ACO spike verdict, not
 * dropped and not claimed as sent.
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

function setup(ads: any[]) {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "integration", "product", "dailyAdMetric", "dailyAdBreakdown", "audienceRecord", "socialAccount", "catalogRecord", "productSet", "leadForm", "customFieldDef", "conversionApiSetting", "conversionEventLog", "automationRule", "automationRun", "attributionCredit", "touchpoint", "crossPlatformDraft", "platformPublication"]) tables[n] = makeTable(n);
  tables.adAccount.rows.push(
    { id: "acc-1", organizationId: "org", platform: "meta", externalId: "act_777", name: "Meta Main", currency: "BDT", integrationId: "int-1" },
    { id: "acc-g", organizationId: "org", platform: "google", externalId: "123-456", name: "Google Main", currency: "BDT", integrationId: "int-g" },
    { id: "acc-t", organizationId: "org", platform: "tiktok", externalId: "tt-1", name: "TikTok Main", currency: "BDT", integrationId: "int-t" },
  );
  tables.campaignPlan.rows.push({ id: "plan-1", organizationId: "org", adAccountId: "acc-1", name: "Launch Plan", objective: "OUTCOME_SALES", status: "approved", budgetMode: "abo", createdById: "u1" });
  tables.campaignAdSet.rows.push({ id: "set-1", planId: "plan-1", name: "Set A", dailyBudgetMinor: 50000n, billingEvent: "IMPRESSIONS", optimizationGoal: "OFFSITE_CONVERSIONS", targeting: { countries: ["BD"], interests: ["Fashion"] } });
  for (const ad of ads) tables.campaignAd.rows.push({ adSetId: "set-1", callToAction: "SHOP_NOW", format: "link", ...ad });
  const calls: any[] = [];
  const publishing = {
    publishGoogle: async (_org: string, _actor: string, fields: any) => { calls.push({ platform: "google", fields }); return { id: "pub-g1", status: "created_paused", externalCampaignId: "g-camp-1", detail: { steps: [] } }; },
    publishTikTok: async (_org: string, _actor: string, fields: any) => { calls.push({ platform: "tiktok", fields }); return { id: "pub-t1", status: "created_paused", externalCampaignId: "t-camp-1", detail: { steps: [], identityId: "ident-1" } }; },
  };
  const svc = new CampaignsService(tables as any, { log: async () => undefined } as any, { getProvider: () => new DevTemplateProvider() } as any, publishing as any);
  return { tables, svc, calls };
}

const baseAd = {
  id: "ad-1", name: "Ad One", primaryText: "সেরা কালেকশন এখনই দেখুন", headline: "ঈদ কালেকশন",
  description: "সারা দেশে হোম ডেলিভারি", linkUrl: "https://shop.example.com/p1",
  textOptions: {
    primaryTexts: ["অপশন প্রাইমারি এক", "অপশন প্রাইমারি দুই"],
    headlines: ["অপশন হেডলাইন এক", "অপশন হেডলাইন দুই"],
    descriptions: ["অপশন ডেসক্রিপশন এক"],
  },
};

describe("CA3 Google RSA assembly", () => {
  it("assembles headlines/descriptions from textOptions merged with legacy fields, and publish receives the same arrays", async () => {
    const { svc, calls } = setup([baseAd]);
    const out = await svc.crossPlatformDraft("org", "plan-1", "u1", { platform: "google", targetAdAccountId: "acc-g" });
    expect(out.status).toBe("created");
    const h: string[] = out.mapped.headlines;
    expect(h).toContain("অপশন হেডলাইন এক");
    expect(h).toContain("অপশন হেডলাইন দুই");
    expect(h).toContain("ঈদ কালেকশন"); // legacy headline carried too
    expect(h[0]).toBe("Launch Plan"); // plan name first, as before
    const d: string[] = out.mapped.descriptions;
    expect(d).toContain("অপশন ডেসক্রিপশন এক");
    expect(d).toContain("অপশন প্রাইমারি এক"); // primary texts join the description pool
    expect(d).toContain("সারা দেশে হোম ডেলিভারি");
    const sent = calls.find((c: any) => c.platform === "google");
    expect(sent.fields.headlines).toEqual(h);
    expect(sent.fields.descriptions).toEqual(d);
    expect(out.transformations.some((t: string) => t.includes("Pinning"))).toBe(true);
  });

  it("over-limit options are NOT truncated into the RSA — they land in notCarried with the length reason", async () => {
    const longHeadline = "এই হেডলাইনটি ত্রিশ অক্ষরের সীমা ছাড়িয়ে যাওয়া একটি লম্বা হেডলাইন";
    const longDesc = "ব".repeat(95);
    const ad = { ...baseAd, textOptions: { primaryTexts: ["ঠিক আছে প্রাইমারি"], headlines: [longHeadline, "ছোট হেডলাইন"], descriptions: [longDesc, "ছোট ডেসক্রিপশন"] } };
    const { svc } = setup([ad]);
    const out = await svc.crossPlatformDraft("org", "plan-1", "u1", { platform: "google", targetAdAccountId: "acc-g" });
    expect(out.mapped.headlines).not.toContain(longHeadline);
    expect(out.mapped.headlines.every((x: string) => x.length <= 30)).toBe(true);
    expect(out.mapped.descriptions.every((x: string) => x.length <= 90)).toBe(true);
    expect(out.notCarried.some((t: string) => t.includes("Google-এর সীমা 30"))).toBe(true);
    expect(out.notCarried.some((t: string) => t.includes("Google-এর সীমা 90"))).toBe(true);
    // No silent slice: no truncated prefix of the long headline was sent.
    expect(out.mapped.headlines.some((x: string) => longHeadline.startsWith(x) && x.length === 30)).toBe(false);
  });

  it("cap overflow (more than 15 valid headlines) is listed in notCarried, array stays at the cap", async () => {
    const ads = Array.from({ length: 6 }, (_, i) => ({
      id: `ad-x${i}`, name: `Ad X${i}`, primaryText: `প্রাইমারি ${i}`, headline: `হেড ${i}`,
      description: `ডেস ${i}`, linkUrl: "https://shop.example.com/p",
      textOptions: { primaryTexts: [`প্রাইমারি অপশন ${i}`], headlines: [`অপশন A${i}`, `অপশন B${i}`, `অপশন C${i}`], descriptions: [] },
    }));
    const { svc } = setup(ads);
    const out = await svc.crossPlatformDraft("org", "plan-1", "u1", { platform: "google", targetAdAccountId: "acc-g" });
    expect(out.mapped.headlines.length).toBe(15);
    expect(out.notCarried.some((t: string) => t.includes("সর্বোচ্চ 15"))).toBe(true);
  });

  it("the persisted draft carries the assembled arrays + notCarried record", async () => {
    const { svc, tables } = setup([baseAd]);
    const out = await svc.crossPlatformDraft("org", "plan-1", "u1", { platform: "google", targetAdAccountId: "acc-g" });
    const draft = tables.crossPlatformDraft.rows.find((d: any) => d.id === out.draftId);
    expect(draft.fields.headlines).toContain("অপশন হেডলাইন এক");
    expect(Array.isArray(draft.fields.descriptions)).toBe(true);
  });
});

describe("CA3 TikTok (spike verdict applied)", () => {
  it("single adText is published; extra CN5 variants are listed in notCarried with the ACO reason", async () => {
    const ad = { ...baseAd, imageUrl: "https://cdn.example.com/img.jpg" };
    const { svc, calls } = setup([ad]);
    const out = await svc.crossPlatformDraft("org", "plan-1", "u1", { platform: "tiktok", targetAdAccountId: "acc-t" });
    expect(out.status).toBe("created");
    const sent = calls.find((c: any) => c.platform === "tiktok");
    expect(sent.fields.adText).toBe("সেরা কালেকশন এখনই দেখুন"); // the plan ad's primary text — ONE text
    expect(sent.fields.adTexts).toBeUndefined(); // no multi-text field is fabricated
    expect(out.notCarried.some((t: string) => t.includes("ACO") && t.includes("অপশন প্রাইমারি এক"))).toBe(true);
    expect(out.notCarried.some((t: string) => t.includes("অপশন প্রাইমারি দুই"))).toBe(true);
  });
});
