import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";
import { ReportSharesService } from "../reports/report-shares.service";

/**
 * Campaign Builder Frontier NB8 / CN18 — insights &
 * sharing. (1) The budget simulator: deterministic
 * arithmetic over the org's OWN last-90-day rows only,
 * median + quartile ranges, and a hard refusal below
 * spec-pinned sample floors (no industry benchmarks, no
 * LLM numbers, no currency mixing). (2) A competitor-
 * response draft: the competitor contributes only an
 * angle note from OUR insight titles; its creative text
 * and notes never enter the draft — the copy comes from
 * the grounded own-product path. (3) Campaign report
 * shares on the EXISTING ReportShare lifecycle, with an
 * allowlisted public payload (no comments / mentions /
 * approval internals), windowed by the share's days.
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
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where, take }: any = {}) => { const f = rows.filter((r) => matches(r, where ?? {})); return take ? f.slice(0, take) : f; },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
    updateMany: async ({ where, data }: any) => { let n = 0; for (const r of rows) if (matches(r, where ?? {})) { Object.assign(r, data); n++; } return { count: n }; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); rows.splice(i, 1); return {}; },
  };
}
const day = 86400000;
const daysAgo = (n: number) => new Date(Date.now() - n * day);

function setup() {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "campaignPlanComment", "adAccount", "integration", "product", "businessProfile", "aIUsageRecord", "dailyAdMetric", "dailyAdBreakdown", "audienceRecord", "socialAccount", "catalogRecord", "productSet", "leadForm", "customFieldDef", "conversionApiSetting", "conversionEventLog", "automationRule", "automationRun", "attributionCredit", "touchpoint", "crossPlatformDraft", "platformPublication", "organization", "competitor", "competitorAd", "competitorInsight", "reportShare", "user", "notification"]) tables[n] = makeTable(n);
  tables.organization.rows.push({ id: "org", name: "Qosprey Fashion Ltd", brandName: "Qosprey", logoUrl: "https://cdn.example/logo.png" });
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", externalId: "act_777", name: "Meta Main", currency: "BDT", integrationId: "int-1" });
  const audit = { log: async () => undefined } as any;
  const svc = new CampaignsService(tables as any, audit, { getProvider: () => new DevTemplateProvider() } as any, {} as any);
  return { tables, svc, audit };
}

/** Three OUTCOME_SALES campaigns × 10 recent days each,
 *  with distinct CPM/CPA so medians/quartiles are exact:
 *  CPM 10000 / 20000 / 15000 (median 15000, Q1 10000,
 *  Q3 20000); CPA 10000 / 20000 / 10000. */
function seedSimulator(tables: any) {
  const defs = [
    { plan: "plan-c1", ext: "ext-c1", spend: 100000n, conv: 10 },
    { plan: "plan-c2", ext: "ext-c2", spend: 200000n, conv: 10 },
    { plan: "plan-c3", ext: "ext-c3", spend: 150000n, conv: 15 },
  ];
  for (const d of defs) {
    tables.campaignPlan.rows.push({ id: d.plan, organizationId: "org", adAccountId: "acc-1", name: d.plan, objective: "OUTCOME_SALES", status: "published", externalCampaignId: d.ext, createdById: "u1" });
    for (let i = 1; i <= 10; i++) {
      tables.dailyAdMetric.rows.push({
        organizationId: "org", adAccountId: "acc-1", platform: "meta", source: "api",
        campaignExternalId: d.ext, adSetExternalId: "", adExternalId: "",
        date: daysAgo(i), currency: "BDT", spendMinor: d.spend, impressions: 10000, clicks: 200, platformConversions: d.conv, reach: 5000,
      });
    }
  }
  // Noise that must NOT count: an out-of-window row and an
  // ad-set-level row inside the window.
  tables.dailyAdMetric.rows.push({ organizationId: "org", adAccountId: "acc-1", platform: "meta", source: "api", campaignExternalId: "ext-c1", adSetExternalId: "", adExternalId: "", date: daysAgo(100), currency: "BDT", spendMinor: 99999900n, impressions: 100, clicks: 1, platformConversions: 0, reach: 10 });
  tables.dailyAdMetric.rows.push({ organizationId: "org", adAccountId: "acc-1", platform: "meta", source: "api", campaignExternalId: "ext-c1", adSetExternalId: "ext-set-x", adExternalId: "", date: daysAgo(2), currency: "BDT", spendMinor: 55555500n, impressions: 100, clicks: 1, platformConversions: 0, reach: 10 });
}

describe("CN18 — budget simulator (own data or refusal)", () => {
  it("computes median/quartile ranges from the org's own rows only", async () => {
    const { tables, svc } = setup();
    seedSimulator(tables);
    const out: any = await svc.budgetSimulator("org", { objective: "OUTCOME_SALES", dailyBudget: "1000", days: 30 });
    expect(out.available).toBe(true);
    expect(out.method).toContain("Industry Benchmark");
    expect(out.sample).toEqual({ campaigns: 3, campaignDays: 30 });
    expect(out.currency).toBe("BDT");
    expect(out.medians.cpmMinor).toBe("15000");
    expect(out.medians.cpaMinor).toBe("10000");
    // total budget 1000৳ × 30d = 3,000,000 minor;
    // impressions = budget×1000 / CPM quartile.
    expect(out.projected.impressions).toEqual({ low: 150000, high: 300000 });
    expect(out.projected.conversions).toEqual({ low: 150, high: 300 });
    expect(out.input.totalBudgetMinor).toBe("3000000");
  });

  it("refuses when the objective has no published campaigns", async () => {
    const { tables, svc } = setup();
    seedSimulator(tables);
    const out: any = await svc.budgetSimulator("org", { objective: "OUTCOME_TRAFFIC", dailyBudget: "1000" });
    expect(out.available).toBe(false);
    expect(out.reason).toContain("কোনো Published Campaign নেই");
  });

  it("refuses below the sample floors (2 campaigns is not a basis)", async () => {
    const { tables, svc } = setup();
    seedSimulator(tables);
    const i = tables.campaignPlan.rows.findIndex((pl: any) => pl.id === "plan-c3");
    tables.campaignPlan.rows.splice(i, 1);
    const out: any = await svc.budgetSimulator("org", { objective: "OUTCOME_SALES", dailyBudget: "1000" });
    expect(out.available).toBe(false);
    expect(out.sample.campaigns).toBe(2);
    expect(out.reason).toContain("যথেষ্ট নিজস্ব Data নেই");
  });

  it("refuses mixed currencies instead of blending them", async () => {
    const { tables, svc } = setup();
    seedSimulator(tables);
    tables.campaignPlan.rows.push({ id: "plan-c4", organizationId: "org", adAccountId: "acc-1", name: "USD One", objective: "OUTCOME_SALES", status: "published", externalCampaignId: "ext-c4", createdById: "u1" });
    tables.dailyAdMetric.rows.push({ organizationId: "org", adAccountId: "acc-1", platform: "meta", source: "api", campaignExternalId: "ext-c4", adSetExternalId: "", adExternalId: "", date: daysAgo(1), currency: "USD", spendMinor: 10000n, impressions: 5000, clicks: 50, platformConversions: 1, reach: 100 });
    const out: any = await svc.budgetSimulator("org", { objective: "OUTCOME_SALES", dailyBudget: "1000" });
    expect(out.available).toBe(false);
    expect(out.reason).toContain("Currency");
  });
});

describe("CN18 — competitor-response draft (angle only, never their creative)", () => {
  function seedCompetitor(tables: any) {
    tables.competitor.rows.push({ id: "comp-1", organizationId: "org", name: "Rival Fashion", notes: "RIVAL_SECRET_NOTES", websiteUrl: "https://rival.example" });
    tables.competitorAd.rows.push({ id: "cad-1", competitorId: "comp-1", externalAdId: "ra-1", creativeText: "RIVAL_SECRET_COPY_50_OFF", linkUrl: "https://rival.example/x", snapshotUrl: "https://snap.example/rival.png", isActive: true, platforms: ["facebook"] });
    tables.competitorInsight.rows.push({ id: "ci-1", organizationId: "org", competitorId: "comp-1", kind: "creative", title: "ছাড়-কেন্দ্রিক হুক ও স্বল্প মূল্য ঘোষণা", detail: "...", evidence: [], provider: "rules" });
    tables.product.rows.push({ id: "prod-1", organizationId: "org", name: "পাঞ্জাবি প্রিমিয়াম", priceMinor: 250000n, currency: "BDT", category: "Fashion", description: "ঈদের জন্য প্রিমিয়াম পাঞ্জাবি" });
    tables.businessProfile.rows.push({ organizationId: "org", websiteUrl: "https://shop.example.com", industry: "Fashion" });
  }

  it("builds an ordinary DRAFT from the org's own product; competitor text/notes/assets appear NOWHERE in it", async () => {
    const { tables, svc } = setup();
    seedCompetitor(tables);
    const out: any = await svc.competitorResponseDraft("org", "u1", { competitorId: "comp-1", productId: "prod-1", adAccountId: "acc-1" });
    expect(out.plan.status).toBe("draft");
    expect(out.angleNote).toContain("ছাড়-কেন্দ্রিক হুক");
    expect(out.rule).toContain("প্রতিযোগীর কোনো লেখা, ছবি বা Asset");
    const ads = tables.campaignAd.rows.filter((a: any) => a.adSetId === out.plan.adSets[0].id);
    expect(ads.length).toBeGreaterThanOrEqual(1);
    const everything = JSON.stringify({ plan: out.plan, ads, comments: tables.campaignPlanComment.rows });
    expect(everything).not.toContain("RIVAL_SECRET_COPY_50_OFF");
    expect(everything).not.toContain("RIVAL_SECRET_NOTES");
    expect(everything).not.toContain("snap.example");
    expect(everything).not.toContain("rival.example");
    for (const ad of ads) {
      expect(ad.productId).toBe("prod-1");
      expect(ad.primaryText).toContain("পাঞ্জাবি প্রিমিয়াম");
    }
    const comment = tables.campaignPlanComment.rows.find((c: any) => c.planId === out.plan.id);
    expect(comment.body).toContain("প্রতিযোগী-প্রতিক্রিয়া");
    expect(comment.body).toContain("ছাড়-কেন্দ্রিক হুক");
  });

  it("refuses a competitor or product from another org", async () => {
    const { tables, svc } = setup();
    seedCompetitor(tables);
    await expect(svc.competitorResponseDraft("other-org", "u1", { competitorId: "comp-1", productId: "prod-1", adAccountId: "acc-1" })).rejects.toThrow(/Competitor not found/);
    await expect(svc.competitorResponseDraft("org", "u1", { competitorId: "comp-1", productId: "nope", adAccountId: "acc-1" })).rejects.toThrow(/Product not found/);
  });
});

describe("CN18 — campaign report shares (existing lifecycle, allowlisted payload)", () => {
  function seedSharePlan(tables: any) {
    tables.campaignPlan.rows.push({ id: "plan-share", organizationId: "org", adAccountId: "acc-1", name: "Share Plan", objective: "OUTCOME_SALES", status: "published", externalCampaignId: "ext-share", budgetMode: "abo", createdById: "u1" });
    tables.campaignAdSet.rows.push({ id: "set-share", planId: "plan-share", name: "Set Share", externalAdSetId: "ext-set-share", dailyBudgetMinor: 50000n, targeting: { countries: ["BD"] } });
    // recent (in a 30-day window) + old (outside it)
    tables.dailyAdMetric.rows.push({ organizationId: "org", adAccountId: "acc-1", platform: "meta", source: "api", campaignExternalId: "ext-share", adSetExternalId: "", adExternalId: "", date: daysAgo(2), currency: "BDT", spendMinor: 100000n, impressions: 10000, clicks: 200, platformConversions: 10, reach: 5000 });
    tables.dailyAdMetric.rows.push({ organizationId: "org", adAccountId: "acc-1", platform: "meta", source: "api", campaignExternalId: "ext-share", adSetExternalId: "", adExternalId: "", date: daysAgo(60), currency: "BDT", spendMinor: 700000n, impressions: 70000, clicks: 900, platformConversions: 70, reach: 30000 });
    tables.dailyAdBreakdown.rows.push({ organizationId: "org", campaignExternalId: "ext-share", dimension: "placement", key: "feed", date: daysAgo(2), spendMinor: 100000n, impressions: 10000, clicks: 200, platformConversions: 10 });
    tables.dailyAdBreakdown.rows.push({ organizationId: "org", campaignExternalId: "ext-share", dimension: "placement", key: "reels", date: daysAgo(60), spendMinor: 700000n, impressions: 70000, clicks: 900, platformConversions: 70 });
    tables.campaignPlanComment.rows.push({ id: "cmt-1", organizationId: "org", planId: "plan-share", authorId: "u1", body: "INTERNAL_SECRET_COMMENT", createdAt: new Date() });
  }

  it("creates through the existing lifecycle, validates the plan, and the public payload is allowlisted + windowed", async () => {
    const { tables, svc, audit } = setup();
    seedSharePlan(tables);
    const shares = new ReportSharesService(tables as any, audit, {} as any, undefined, svc);
    await expect(shares.create("org", "u1", { title: "X", kind: "campaign" })).rejects.toThrow(/planId/);
    await expect(shares.create("other-org", "u1", { title: "X", kind: "campaign", planId: "plan-share" })).rejects.toThrow(/not found in this organization/);
    const share: any = await shares.create("org", "u1", { title: "Client — Share Plan", kind: "campaign", planId: "plan-share", days: 30, expiresInDays: 7 });
    expect(share.kind).toBe("campaign");
    expect(share.planId).toBe("plan-share");
    const pub: any = await shares.publicReport(share.token);
    expect(pub.kind).toBe("campaign");
    expect(pub.title).toBe("Client — Share Plan");
    expect(pub.plan).toEqual({ name: "Share Plan", objective: "OUTCOME_SALES" });
    // windowed: only the 2-day-old row counts (100000), not the 60-day one (700000)
    expect(pub.totals.spendMinor).toBe("100000");
    expect(pub.breakdowns.placement.hasData).toBe(true);
    expect(pub.breakdowns.placement.rows.map((r: any) => r.key)).toEqual(["feed"]);
    expect(pub.note).toContain("associated");
    // the allowlist: per-ad-set rows carry ONLY these keys,
    // and no internal content leaks anywhere in the payload
    for (const s of pub.perAdSet) expect(Object.keys(s).sort()).toEqual(["clicks", "conversions", "impressions", "name", "spendMinor"]);
    const raw = JSON.stringify(pub);
    expect(raw).not.toContain("INTERNAL_SECRET_COMMENT");
    expect(raw).not.toContain("campaignPlanComment");
    expect(raw).not.toContain("mentions");
    expect(raw).not.toContain("approval");
    expect(pub.pacing).not.toBeNull();
    // revoke runs through the same lifecycle as overview shares
    await shares.revoke("org", share.id);
    await expect(shares.publicReport(share.token)).rejects.toThrow(/invalid/);
  });

  it("an expired campaign share refuses like every other kind", async () => {
    const { tables, svc, audit } = setup();
    seedSharePlan(tables);
    const shares = new ReportSharesService(tables as any, audit, {} as any, undefined, svc);
    const share: any = await shares.create("org", "u1", { title: "Old", kind: "campaign", planId: "plan-share", days: 30 });
    tables.reportShare.rows[0].expiresAt = new Date(Date.now() - 1000);
    await expect(shares.publicReport(share.token)).rejects.toThrow(/expired/);
  });
});
