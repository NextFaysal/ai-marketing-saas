import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder Advanced CA20 (CB5): per-form lead
 * quality. The form link is Lead.leadFormId, stamped at
 * leadgen ingest when Meta's form_id resolves to a
 * modelled LeadForm (CA20 migration) — never parsed back
 * out of the notes text. Rates come only from real rows
 * and are WITHHELD below the stated minimum of 10
 * attributed leads per form; converted-to-order rides
 * the real Lead.customerId → Order.customerId chain;
 * cost per qualified rides ad set (leadFormId) → plan →
 * published campaign → stored DailyAdMetric spend.
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
    findMany: async ({ where, take, orderBy }: any = {}) => {
      let f = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "desc") f = [...f].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return take ? f.slice(0, take) : f;
    },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
  };
}

function setup() {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "organization", "leadForm", "lead", "order", "offlineConversionLog", "dailyAdMetric", "product", "businessProfile", "savedTargeting", "audiencePerformanceRollup", "dailyAdBreakdown", "aIUsageRecord"]) tables[n] = makeTable(n);
  tables.organization.rows.push({ id: "org", timezone: "Asia/Dhaka" });
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", externalId: "act_777", currency: "BDT", integrationId: "int-1" });
  const audit = { log: async () => undefined } as any;
  const svc: any = new CampaignsService(tables as any, audit, { getProvider: () => new DevTemplateProvider() } as any);
  return { tables, svc };
}

function lead(tables: any, id: string, formId: string | null, stage: string, customerId: string | null = null) {
  tables.lead.rows.push({ id, organizationId: "org", leadFormId: formId, source: "facebook_lead_ads", stage, customerId, name: `L${id}`, createdAt: new Date() });
}

function seedQuality(tables: any) {
  tables.leadForm.rows.push(
    { id: "form-1", organizationId: "org", name: "ঈদ লিড ফর্ম", pageId: "pg-1", status: "created", externalFormId: "meta-form-1", questions: [], createdAt: new Date() },
    { id: "form-2", organizationId: "org", name: "নতুন ফর্ম", pageId: "pg-1", status: "local", externalFormId: null, questions: [], createdAt: new Date() },
  );
  // form-1: 12 attributed leads — 5 qualified, 2 proposal,
  // 1 won (= 8 qualified-stage), 4 new. 3 carry customer c1
  // (who ordered), 2 carry c2 (who never ordered).
  const stages = ["qualified", "qualified", "qualified", "qualified", "qualified", "proposal", "proposal", "won", "new", "new", "new", "new"];
  stages.forEach((s, i) => lead(tables, `f1-${i + 1}`, "form-1", s, i < 3 ? "c1" : i < 5 ? "c2" : null));
  // form-2: only 3 attributed leads — below the minimum.
  lead(tables, "f2-1", "form-2", "qualified");
  lead(tables, "f2-2", "form-2", "new");
  lead(tables, "f2-3", "form-2", "new");
  // 7 lead-ads leads with NO form stamp (historical /
  // unmodelled forms) — coverage only, never attributed.
  for (let i = 0; i < 7; i++) lead(tables, `u-${i + 1}`, null, "new");
  tables.order.rows.push({ id: "o-1", organizationId: "org", customerId: "c1", totalMinor: 50000n });
  // form-1 rides a published plan's ad set; stored campaign
  // spend (campaign-level rows only) = 80000 minor.
  tables.campaignPlan.rows.push({ id: "plan-1", organizationId: "org", adAccountId: "acc-1", name: "Lead Plan", objective: "OUTCOME_LEADS", status: "published", externalCampaignId: "camp-1", createdById: "u1" });
  tables.campaignAdSet.rows.push({ id: "set-1", planId: "plan-1", name: "S", leadFormId: "form-1", optimizationGoal: "LEAD_GENERATION", targeting: { countries: ["BD"] } });
  tables.dailyAdMetric.rows.push(
    { id: "m-1", organizationId: "org", campaignExternalId: "camp-1", adSetExternalId: "", adExternalId: "", spendMinor: 50000n, date: new Date() },
    { id: "m-2", organizationId: "org", campaignExternalId: "camp-1", adSetExternalId: "", adExternalId: "", spendMinor: 30000n, date: new Date() },
    { id: "m-3", organizationId: "org", campaignExternalId: "camp-1", adSetExternalId: "set-ext", adExternalId: "", spendMinor: 99900n, date: new Date() },
  );
  // CN14 feedback logs for form-1 leads: 2 sent, 1 failed.
  tables.offlineConversionLog.rows.push(
    { id: "log-1", organizationId: "org", platform: "meta", eventId: "lead-feedback-f1-1-qualified", status: "sent", createdAt: new Date("2026-10-10T00:00:00Z") },
    { id: "log-2", organizationId: "org", platform: "meta", eventId: "lead-feedback-f1-8-won", status: "sent", createdAt: new Date("2026-10-12T00:00:00Z") },
    { id: "log-3", organizationId: "org", platform: "meta", eventId: "lead-feedback-f1-2-qualified", status: "failed", createdAt: new Date("2026-10-11T00:00:00Z") },
    { id: "log-4", organizationId: "org", platform: "meta", eventId: "order-purchase-xyz", status: "sent", createdAt: new Date("2026-10-12T00:00:00Z") },
  );
}

describe("CA20 leadFormQuality", () => {
  it("computes per-form rates from real rows: qualified rate, order conversion via the customer chain, stage distribution", async () => {
    const { tables, svc } = setup();
    seedQuality(tables);
    const out = await svc.leadFormQuality("org");
    const f1 = out.forms.find((f: any) => f.formId === "form-1");
    expect(f1.totalLeads).toBe(12);
    expect(f1.belowThreshold).toBe(false);
    expect(f1.qualified).toBe(8);
    expect(f1.qualifiedRate).toBe(66.7);
    expect(f1.convertedToOrder).toBe(3);
    expect(f1.orderRate).toBe(25);
    expect(f1.stages).toEqual({ qualified: 5, proposal: 2, won: 1, new: 4 });
    expect(out.coverage.attributedLeads).toBe(15);
    expect(out.coverage.unattributedLeadAdsLeads).toBe(7);
    expect(out.minLeads).toBe(10);
  });

  it("cost per qualified lead rides ad set → plan → stored campaign spend; a form with no linked campaign says খরচের তথ্য নেই", async () => {
    const { tables, svc } = setup();
    seedQuality(tables);
    const out = await svc.leadFormQuality("org");
    const f1 = out.forms.find((f: any) => f.formId === "form-1");
    expect(f1.spendMinor).toBe("80000"); // ad-set-level row m-3 excluded
    expect(f1.linkedCampaigns).toBe(1);
    expect(f1.costPerQualifiedMinor).toBe("10000"); // 80000 / 8 qualified
    const f2 = out.forms.find((f: any) => f.formId === "form-2");
    expect(f2.costPerQualifiedMinor).toBeNull();
    expect(f2.costNote).toContain("খরচের তথ্য নেই");
  });

  it("below the stated minimum the rates are WITHHELD (null) with the threshold note — counts still show", async () => {
    const { tables, svc } = setup();
    seedQuality(tables);
    const out = await svc.leadFormQuality("org");
    const f2 = out.forms.find((f: any) => f.formId === "form-2");
    expect(f2.totalLeads).toBe(3);
    expect(f2.belowThreshold).toBe(true);
    expect(f2.qualifiedRate).toBeNull();
    expect(f2.orderRate).toBeNull();
    expect(f2.thresholdNote).toContain("পর্যাপ্ত তথ্য নেই");
    expect(f2.thresholdNote).toContain("10");
  });

  it("CN14 feedback status aggregates from OfflineConversionLog rows for the form's own leads only", async () => {
    const { tables, svc } = setup();
    seedQuality(tables);
    const out = await svc.leadFormQuality("org");
    const f1 = out.forms.find((f: any) => f.formId === "form-1");
    expect(f1.feedback.sent).toBe(2);
    expect(f1.feedback.failed).toBe(1);
    expect(f1.feedback.lastSentAt).toBe("2026-10-12T00:00:00.000Z");
    const f2 = out.forms.find((f: any) => f.formId === "form-2");
    expect(f2.feedback.sent).toBe(0);
    expect(f2.feedback.lastSentAt).toBeNull();
  });

  it("org scoping: another org's forms and leads never enter the numbers", async () => {
    const { tables, svc } = setup();
    seedQuality(tables);
    tables.leadForm.rows.push({ id: "form-x", organizationId: "other", name: "Foreign", pageId: "pg", status: "created", externalFormId: "fx", questions: [], createdAt: new Date() });
    for (let i = 0; i < 15; i++) tables.lead.rows.push({ id: `x-${i}`, organizationId: "other", leadFormId: "form-x", source: "facebook_lead_ads", stage: "won", customerId: null, name: "X", createdAt: new Date() });
    const out = await svc.leadFormQuality("org");
    expect(out.forms.map((f: any) => f.formId)).toEqual(["form-1", "form-2"]);
    expect(out.coverage.attributedLeads).toBe(15);
  });
});

describe("CA20 suggestPlan facts", () => {
  it("a LEADS suggestion carries per-form quality facts for threshold-meeting forms; a SALES suggestion does not", async () => {
    const { tables, svc } = setup();
    seedQuality(tables);
    tables.businessProfile.rows.push({ organizationId: "org", industry: "fashion", brandVoice: "friendly", websiteUrl: "https://shop.example" });
    tables.product.rows.push({ id: "prod-1", organizationId: "org", status: "ACTIVE", name: "Cotton Panjabi", priceMinor: 150000n, currency: "BDT", category: "clothing" });
    const leads = await svc.suggestPlan("org", "u1", { adAccountId: "acc-1", goal: "লিড সংগ্রহ", totalDailyBudget: "500" });
    expect(leads.facts.objective).toBe("OUTCOME_LEADS");
    expect(leads.facts.leadFormFacts).toHaveLength(1);
    expect(leads.facts.leadFormFacts[0].name).toBe("ঈদ লিড ফর্ম");
    expect(leads.facts.leadFormFacts[0].qualifiedRate).toBe(66.7);
    const sales = await svc.suggestPlan("org", "u1", { adAccountId: "acc-1", productId: "prod-1", goal: "বিক্রি", totalDailyBudget: "500" });
    expect(sales.facts.leadFormFacts).toEqual([]);
  });
});
