import { CampaignsService } from "./campaigns.service";
import { CampaignFrontierService } from "./frontier.service";
import { AudiencesService } from "../audiences/audiences.service";
import { parseSeriesRule, seriesOccurrenceDate, SeriesValidationError } from "./series-dates";
import { encryptJson } from "../integrations/crypto";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

/**
 * Campaign Builder Frontier CN16 (NB7): the full-funnel
 * wizard + recurring series.
 *
 * Wizard pins: ONE plan; three labelled layers built ONLY
 * through CampaignsService.createPlan/addAdSet/addAd and
 * AudiencesService (sourceCatalog + createCustom); a layer
 * whose source data is missing lands as an INCOMPLETE ad
 * set with the reason stored on the row (readiness reports
 * it as an error) — never dropped, never fabricated.
 *
 * Series pins: occurrence dates are computed FROM the
 * anchor (weekly/monthly clamp included) or the explicit
 * dates list — no drift; the sweep materializes at most
 * ONE pending draft instance per series and HOLDS while
 * that draft sits untouched; instances are full-field
 * DRAFT clones (external ids / publishAt never carried)
 * that still owe the full approval flow.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("not" in v) return row[k] !== (v as any).not;
      if ("lte" in v) return row[k] != null && row[k] <= (v as any).lte;
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
    updateMany: async ({ where, data }: any) => { let n = 0; for (const r of rows) if (matches(r, where)) { Object.assign(r, data); n++; } return { count: n }; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); rows.splice(i, 1); return {}; },
  };
}

function setup(opts: { buyers?: boolean; viewers?: boolean; abandoners?: boolean } = {}) {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "integration", "audienceRecord", "customer", "order", "trackingEvent", "visitor", "abandonedStoreCheckout", "catalogRecord", "productSet", "campaignPlanSeries", "dailyAdMetric", "conversionApiSetting", "conversionEventLog", "attributionCredit", "touchpoint", "campaignPlanVersion", "campaignPlanComment"]) tables[n] = makeTable(n);
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", sourceType: "api", externalId: "act_777", name: "Main", currency: "BDT", platformStatusBucket: "active", integrationId: "int-meta" });
  tables.integration.rows.push({ id: "int-meta", organizationId: "org", provider: "meta", status: "CONNECTED", credential: { encryptedData: encryptJson({ accessToken: "tok-ads" }) } });
  if (opts.buyers !== false) {
    tables.customer.rows.push({ id: "c1", organizationId: "org", email: "buyer@x.com", phone: "01710000001", mergedIntoId: null, firstName: "B" });
    tables.order.rows.push({ id: "o1", organizationId: "org", customerId: "c1", status: "completed", isPractice: false, totalMinor: 9000n, placedAt: new Date(), createdAt: new Date() });
  }
  if (opts.viewers) {
    tables.trackingEvent.rows.push({ id: "te1", organizationId: "org", type: "product_view", visitorId: "v1" });
    tables.visitor.rows.push({ id: "v1", organizationId: "org", email: "viewer@x.com", phone: null });
  }
  if (opts.abandoners) {
    tables.abandonedStoreCheckout.rows.push({ id: "ab1", organizationId: "org", status: "open", email: "cart@x.com", phone: "01710000002" });
  }
  const auditEntries: any[] = [];
  const audit = { log: async (e: any) => { auditEntries.push(e); } } as any;
  const audiences = new AudiencesService(tables as any, audit);
  const campaigns = new CampaignsService(tables as any, audit, { getProvider: () => new DevTemplateProvider() } as any, undefined, audiences);
  const frontier = new CampaignFrontierService(tables as any, audit, campaigns, audiences);
  let audSeq = 0;
  const fetchFn = async (url: string, init: any) => {
    const u = String(url);
    if (u.includes("/customaudiences") && !u.includes("/users")) return { ok: true, status: 200, json: async () => ({ id: `aud-meta-${++audSeq}` }) };
    if (u.includes("/users")) return { ok: true, status: 200, json: async () => ({ num_received: 1 }) };
    if (u.includes("/delivery_estimate")) return { ok: true, status: 200, json: async () => ({ data: [] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return { tables, frontier, campaigns, audiences, auditEntries, fetchFn };
}
const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

const FUNNEL_DTO = {
  name: "Eid Funnel", adAccountId: "acc-1", objective: "OUTCOME_SALES",
  pageId: "pg-1", pixelId: "px-1", conversionEvent: "PURCHASE",
  primaryText: "ঈদের কালেকশন এসেছে", headline: "এখনই অর্ডার করুন", linkUrl: "https://shop.example/p",
  prospecting: { dailyBudget: "500", countries: ["BD"] },
  retargeting: { dailyBudget: "300" },
  retention: { dailyBudget: "200" },
};

describe("CN16 full-funnel wizard", () => {
  it("builds ONE plan with three labelled, complete layers when every source has data", async () => {
    const s = setup({ viewers: true, abandoners: true }); global.fetch = s.fetchFn as any;
    const out: any = await s.frontier.createFunnelPlan("org", "u1", { ...FUNNEL_DTO, dailyBudgetCap: "5000" } as any);
    expect(out.layers.map((l: any) => `${l.layer}:${l.status}`)).toEqual(["prospecting:complete", "retargeting:complete", "retention:complete"]);
    const sets = s.tables.campaignAdSet.rows.filter((r: any) => r.planId === out.plan.id);
    expect(sets).toHaveLength(3);
    expect(sets.map((r: any) => r.funnelLayer).sort()).toEqual(["prospecting", "retargeting", "retention"]);
    expect(sets.every((r: any) => r.funnelIncomplete == null)).toBe(true);
    const retargeting = sets.find((r: any) => r.funnelLayer === "retargeting");
    expect(retargeting.targeting.customAudienceIds).toHaveLength(2); // viewers + abandoners
    const retention = sets.find((r: any) => r.funnelLayer === "retention");
    expect(retention.targeting.customAudienceIds).toHaveLength(1); // buyers
    expect(s.tables.audienceRecord.rows).toHaveLength(3);
    expect(s.tables.campaignAd.rows.filter((r: any) => sets.some((x: any) => x.id === r.adSetId))).toHaveLength(3);
    expect(String(out.plan.dailyBudgetCapMinor)).toBe("500000");
    expect(out.plan.status).toBe("draft");
  });

  it("missing buyers data lands retention as an INCOMPLETE ad set (reason stored, readiness error) — never dropped, never fabricated", async () => {
    const s = setup({ buyers: false, viewers: true }); global.fetch = s.fetchFn as any;
    const out: any = await s.frontier.createFunnelPlan("org", "u1", FUNNEL_DTO as any);
    expect(out.layers.map((l: any) => `${l.layer}:${l.status}`)).toEqual(["prospecting:complete", "retargeting:complete", "retention:incomplete"]);
    const retention = s.tables.campaignAdSet.rows.find((r: any) => r.planId === out.plan.id && r.funnelLayer === "retention");
    expect(retention).toBeTruthy();
    expect(retention.funnelIncomplete).toMatch(/Buyers/);
    expect(retention.targeting.customAudienceIds ?? []).toHaveLength(0);
    const readiness: any = await s.campaigns.readiness("org", out.plan.id);
    const funnelErrors = readiness.checks.filter((c: any) => c.key === "funnel" && c.level === "error");
    expect(funnelErrors).toHaveLength(1);
    expect(funnelErrors[0].detail).toMatch(/Retention/);
  });

  it("with no audience data at all, both audience layers are incomplete and the plan still exists as a draft", async () => {
    const s = setup({ buyers: false }); global.fetch = s.fetchFn as any;
    const out: any = await s.frontier.createFunnelPlan("org", "u1", FUNNEL_DTO as any);
    expect(out.layers.map((l: any) => l.status)).toEqual(["complete", "incomplete", "incomplete"]);
    expect(s.tables.campaignAdSet.rows.filter((r: any) => r.planId === out.plan.id)).toHaveLength(3);
    expect(s.tables.audienceRecord.rows).toHaveLength(0);
  });

  it("retention carries a REAL catalog when the set is Meta-created, and an invalid set retries without it as an incomplete layer", async () => {
    const s = setup({ viewers: true }); global.fetch = s.fetchFn as any;
    s.tables.catalogRecord.rows.push({ id: "cat-1", organizationId: "org", name: "Shop Catalog", externalCatalogId: "ext-cat-1" });
    s.tables.productSet.rows.push({ id: "ps-1", organizationId: "org", catalogRecordId: "cat-1", name: "All Products", externalSetId: "setext-1", status: "created" });
    const ok: any = await s.frontier.createFunnelPlan("org", "u1", { ...FUNNEL_DTO, retention: { dailyBudget: "200", catalogRecordId: "cat-1", productSetId: "ps-1" } } as any);
    const okRetention = s.tables.campaignAdSet.rows.find((r: any) => r.planId === ok.plan.id && r.funnelLayer === "retention");
    expect(okRetention.catalogRecordId).toBe("cat-1");
    expect(okRetention.productSetId).toBe("ps-1");
    expect(okRetention.conversionEvent ?? null).toBeNull(); // CN3: a catalog set carries no conversionEvent
    expect(ok.layers.find((l: any) => l.layer === "retention").status).toBe("complete");

    const bad: any = await s.frontier.createFunnelPlan("org", "u1", { ...FUNNEL_DTO, name: "Funnel 2", retention: { dailyBudget: "200", catalogRecordId: "cat-1", productSetId: "missing-set" } } as any);
    const badRetention = s.tables.campaignAdSet.rows.find((r: any) => r.planId === bad.plan.id && r.funnelLayer === "retention");
    expect(badRetention).toBeTruthy();
    expect(badRetention.catalogRecordId ?? null).toBeNull();
    expect(badRetention.funnelIncomplete).toMatch(/Catalog/);
    expect(bad.layers.find((l: any) => l.layer === "retention").status).toBe("incomplete");
  });

  it("refuses a wizard without the owner's own copy, link or prospecting market", async () => {
    const s = setup({}); global.fetch = s.fetchFn as any;
    await expect(s.frontier.createFunnelPlan("org", "u1", { ...FUNNEL_DTO, primaryText: " " } as any)).rejects.toThrow(/primaryText/);
    await expect(s.frontier.createFunnelPlan("org", "u1", { ...FUNNEL_DTO, linkUrl: "" } as any)).rejects.toThrow(/linkUrl/);
    await expect(s.frontier.createFunnelPlan("org", "u1", { ...FUNNEL_DTO, prospecting: undefined } as any)).rejects.toThrow(/prospecting/);
    expect(s.tables.campaignPlan.rows).toHaveLength(0);
  });
});

describe("CN16 series date math (anchor-based, no drift)", () => {
  it("weekly occurrences step from the anchor by interval weeks", () => {
    const anchor = new Date("2026-10-20T09:00:00.000Z");
    const s = { cadence: "weekly", interval: 2, anchorDate: anchor };
    expect(seriesOccurrenceDate(s, 0)?.toISOString()).toBe(anchor.toISOString());
    expect(seriesOccurrenceDate(s, 1)?.toISOString()).toBe("2026-11-03T09:00:00.000Z");
    expect(seriesOccurrenceDate(s, 3)?.toISOString()).toBe("2026-12-01T09:00:00.000Z");
  });

  it("monthly clamping recomputes from the anchor every time (Jan 31 -> Feb 28 -> Mar 31)", () => {
    const s = { cadence: "monthly", interval: 1, anchorDate: new Date("2027-01-31T10:30:00.000Z") };
    expect(seriesOccurrenceDate(s, 1)?.toISOString()).toBe("2027-02-28T10:30:00.000Z");
    expect(seriesOccurrenceDate(s, 2)?.toISOString()).toBe("2027-03-31T10:30:00.000Z");
    expect(seriesOccurrenceDate(s, 13)?.toISOString()).toBe("2028-02-29T10:30:00.000Z"); // leap year, still from the anchor
  });

  it("dates cadence reads the list and exhausts to null; parseSeriesRule validates strictly and normalizes", () => {
    const s = { cadence: "dates", dates: ["2026-11-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z"] };
    expect(seriesOccurrenceDate(s, 1)?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(seriesOccurrenceDate(s, 2)).toBeNull();
    const rule = parseSeriesRule({ cadence: "dates", dates: ["2026-12-01", "2026-11-01", "2026-11-01"], leadDays: 5 });
    expect(rule.dates).toEqual(["2026-11-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z"]);
    expect(rule.leadDays).toBe(5);
    expect(() => parseSeriesRule({ cadence: "daily" })).toThrow(SeriesValidationError);
    expect(() => parseSeriesRule({ cadence: "dates", dates: [] })).toThrow(/non-empty/);
    expect(() => parseSeriesRule({ cadence: "weekly" })).toThrow(/anchorDate/);
    expect(() => parseSeriesRule({ cadence: "weekly", anchorDate: "2026-10-20", leadDays: 31 })).toThrow(/leadDays/);
  });
});

describe("CN16 recurring series sweep", () => {
  function seedTemplate(s: any) {
    s.tables.campaignPlan.rows.push({
      id: "tpl-1", organizationId: "org", adAccountId: "acc-1", name: "Weekly Promo", objective: "OUTCOME_SALES",
      status: "draft", createdById: "u1", budgetMode: "abo", advantagePlus: false,
      externalCampaignId: "camp-should-not-carry", publishAt: new Date(Date.now() - 1000),
    });
    s.tables.campaignAdSet.rows.push({
      id: "tpl-set", planId: "tpl-1", name: "Main Set", optimizationGoal: "OFFSITE_CONVERSIONS", billingEvent: "IMPRESSIONS",
      pageId: "pg-1", pixelId: "px-1", targeting: { countries: ["BD"] }, dailyBudgetMinor: 50000n,
      destinationType: "WHATSAPP", whatsappPhoneNumber: "+8801710000000", funnelLayer: "prospecting", externalAdSetId: "ext-should-not-carry",
    });
    s.tables.campaignAd.rows.push({ id: "tpl-ad", adSetId: "tpl-set", name: "Main Ad", primaryText: "অফার", headline: "কিনুন", linkUrl: "https://shop.example/p", callToAction: "SHOP_NOW", format: "link", externalAdId: "ext-ad" });
  }

  it("generates exactly ONE pending DRAFT instance in the lead window, holds while it sits in draft, and resumes when it moves on", async () => {
    const s = setup({}); global.fetch = s.fetchFn as any;
    seedTemplate(s);
    const anchor = new Date(Date.now() + 2 * 86_400_000);
    const series: any = await s.frontier.createSeries("org", "u1", "tpl-1", { cadence: "weekly", anchorDate: anchor.toISOString(), leadDays: 3 });
    expect(series.status).toBe("active");
    expect(series.nextInstanceDate).toBe(anchor.toISOString());

    const first = await s.frontier.scanCampaignSeries(new Date());
    expect(first.generated).toBe(1);
    const instances = s.tables.campaignPlan.rows.filter((r: any) => r.seriesId === series.id);
    expect(instances).toHaveLength(1);
    const inst = instances[0];
    expect(inst.status).toBe("draft"); // a series NEVER publishes — the instance owes the full approval flow
    expect(new Date(inst.seriesInstanceDate).toISOString()).toBe(anchor.toISOString());
    expect(inst.externalCampaignId ?? null).toBeNull();
    expect(inst.publishAt ?? null).toBeNull();
    const instSet = s.tables.campaignAdSet.rows.find((r: any) => r.planId === inst.id);
    expect(instSet.destinationType).toBe("WHATSAPP"); // full-field copy
    expect(instSet.funnelLayer).toBe("prospecting");
    expect(instSet.externalAdSetId ?? null).toBeNull();

    // One pending instance at a time: once occurrence 2 is
    // inside its own lead window (anchor + 4d), the sweep
    // HOLDS — the untouched draft blocks the next instance.
    const heldScan = await s.frontier.scanCampaignSeries(new Date(anchor.getTime() + 5 * 86_400_000));
    expect(heldScan).toMatchObject({ generated: 0, held: 1 });
    expect(s.tables.campaignPlan.rows.filter((r: any) => r.seriesId === series.id)).toHaveLength(1);

    // The instance moves into the approval flow; occurrence
    // 2 (anchor + 7d) then generates inside its window.
    s.tables.campaignPlan.rows.find((r: any) => r.id === inst.id).status = "pending_approval";
    const early = await s.frontier.scanCampaignSeries(new Date());
    expect(early.generated).toBe(0);
    const inWindow = await s.frontier.scanCampaignSeries(new Date(anchor.getTime() + 5 * 86_400_000));
    expect(inWindow.generated).toBe(1);
    const all = s.tables.campaignPlan.rows.filter((r: any) => r.seriesId === series.id);
    expect(all).toHaveLength(2);
    expect(new Date(all[1].seriesInstanceDate).toISOString()).toBe(new Date(anchor.getTime() + 7 * 86_400_000).toISOString());
  });

  it("pause stops generation, resume restarts it, end is terminal; existing drafts are never touched", async () => {
    const s = setup({}); global.fetch = s.fetchFn as any;
    seedTemplate(s);
    const anchor = new Date(Date.now() + 1 * 86_400_000);
    const series: any = await s.frontier.createSeries("org", "u1", "tpl-1", { cadence: "weekly", anchorDate: anchor.toISOString(), leadDays: 3 });
    await s.frontier.seriesAction("org", "u1", series.id, "pause");
    expect((await s.frontier.scanCampaignSeries(new Date())).generated).toBe(0);
    await s.frontier.seriesAction("org", "u1", series.id, "resume");
    expect((await s.frontier.scanCampaignSeries(new Date())).generated).toBe(1);
    const draftId = s.tables.campaignPlan.rows.find((r: any) => r.seriesId === series.id).id;
    await s.frontier.seriesAction("org", "u1", series.id, "end");
    expect(s.tables.campaignPlan.rows.find((r: any) => r.id === draftId).status).toBe("draft"); // untouched
    await expect(s.frontier.seriesAction("org", "u1", series.id, "resume")).rejects.toThrow(/ended series cannot be resumed/);
    await expect(s.frontier.seriesAction("org", "u1", series.id, "bogus")).rejects.toThrow(/pause, resume or end/);
  });

  it("a dates series (Eid pack) generates its listed instance and auto-ends when the list is exhausted", async () => {
    const s = setup({}); global.fetch = s.fetchFn as any;
    seedTemplate(s);
    const d1 = new Date(Date.now() + 1 * 86_400_000);
    const series: any = await s.frontier.createSeries("org", "u1", "tpl-1", { cadence: "dates", dates: [d1.toISOString()], leadDays: 3 });
    expect((await s.frontier.scanCampaignSeries(new Date())).generated).toBe(1);
    const inst = s.tables.campaignPlan.rows.find((r: any) => r.seriesId === series.id);
    inst.status = "approved"; // the owner took it through the flow
    const out = await s.frontier.scanCampaignSeries(new Date(Date.now() + 2 * 86_400_000));
    expect(out.ended).toBe(1);
    const row = s.tables.campaignPlanSeries.rows.find((r: any) => r.id === series.id);
    expect(row.status).toBe("ended");
    expect(s.tables.campaignPlan.rows.filter((r: any) => r.seriesId === series.id)).toHaveLength(1);
  });

  it("a failing template never breaks the sweep for other series (failure isolation, audit-logged)", async () => {
    const s = setup({}); global.fetch = s.fetchFn as any;
    seedTemplate(s);
    s.tables.campaignPlan.rows.push({
      id: "tpl-2", organizationId: "org", adAccountId: "acc-1", name: "Good Template", objective: "OUTCOME_SALES",
      status: "draft", createdById: "u1", budgetMode: "abo", advantagePlus: false,
    });
    const anchor = new Date(Date.now() + 1 * 86_400_000);
    const broken: any = await s.frontier.createSeries("org", "u1", "tpl-1", { name: "Broken", cadence: "weekly", anchorDate: anchor.toISOString(), leadDays: 3 });
    const good: any = await s.frontier.createSeries("org", "u1", "tpl-2", { name: "Good", cadence: "weekly", anchorDate: anchor.toISOString(), leadDays: 3 });
    // Break the first series' template AFTER creation.
    s.tables.campaignPlan.rows.splice(s.tables.campaignPlan.rows.findIndex((r: any) => r.id === "tpl-1"), 1);
    const out = await s.frontier.scanCampaignSeries(new Date());
    expect(out.failed).toBe(1);
    expect(out.generated).toBe(1);
    expect(s.tables.campaignPlan.rows.some((r: any) => r.seriesId === good.id)).toBe(true);
    expect(s.tables.campaignPlan.rows.some((r: any) => r.seriesId === broken.id)).toBe(false);
    expect(s.auditEntries.some((e: any) => e.action === "campaign.series_generation_failed")).toBe(true);
  });
});
