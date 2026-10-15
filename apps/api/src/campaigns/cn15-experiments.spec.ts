import { CampaignsService } from "./campaigns.service";
import { CampaignFrontierService } from "./frontier.service";
import { encryptJson } from "../integrations/crypto";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

/**
 * Campaign Builder Frontier CN15 (NB7): Meta Experiments.
 * Spike basis — Meta's official Ad Study documentation
 * (developers.facebook.com: the "Ad Study" guide + the
 * Graph API Reference for Business/ad_studies, read at
 * build time): POST /{business_id}/ad_studies with
 * type=SPLIT_TEST, cells [{ name, treatment_percentage,
 * campaigns }] and objectives [{ type: CONVERSIONS,
 * adspixels: [{ id, event_names }] }] returns the study
 * id; read-back is GET /{study_id} + GET /{study_id}/cells.
 * Verdict: CONFIRMED — the study path is built. These specs
 * pin: the row exists ONLY when Meta returns a study id,
 * Meta's payloads are stored/returned verbatim, the plans
 * themselves are never touched, and refusals carry Meta's
 * own message.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
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

const STUDY_NODE = { id: "study-1", name: "Plan A বনাম Plan B", type: "SPLIT_TEST", start_time: 1760000000, end_time: 1760604800, results_first_available_date: "2026-10-20" };
const STUDY_CELLS = [
  { id: "cell-1", name: "A — Plan A", treatment_percentage: 50, campaigns: [{ id: "camp-A" }] },
  { id: "cell-2", name: "B — Plan B", treatment_percentage: 50, campaigns: [{ id: "camp-B" }] },
];

function setup(opts: { business?: boolean; studyCreate?: "ok" | "refuse"; pixelOnA?: boolean; publishedB?: boolean } = {}) {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "integration", "campaignExperiment", "dailyAdMetric", "attributionCredit", "touchpoint"]) tables[n] = makeTable(n);
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", sourceType: "api", externalId: "act_777", name: "Main", currency: "BDT", platformStatusBucket: "active", integrationId: "int-meta" });
  tables.integration.rows.push({ id: "int-meta", organizationId: "org", provider: "meta", status: "CONNECTED", credential: { encryptedData: encryptJson({ accessToken: "tok-ads" }) } });
  tables.campaignPlan.rows.push(
    { id: "plan-A", organizationId: "org", adAccountId: "acc-1", name: "Plan A", objective: "OUTCOME_SALES", status: "published", createdById: "u1", abGroupId: "ab-1", abVariant: "A", abMetric: "first_party_cpa", externalCampaignId: "camp-A", budgetMode: "abo", advantagePlus: false },
    { id: "plan-B", organizationId: "org", adAccountId: "acc-1", name: "Plan B", objective: "OUTCOME_SALES", status: "published", createdById: "u1", abGroupId: "ab-1", abVariant: "B", abMetric: "first_party_cpa", externalCampaignId: opts.publishedB === false ? null : "camp-B", budgetMode: "abo", advantagePlus: false },
  );
  tables.campaignAdSet.rows.push(
    { id: "set-A", planId: "plan-A", name: "Set A", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg-1", pixelId: opts.pixelOnA === false ? null : "px-1", conversionEvent: "PURCHASE", targeting: { countries: ["BD"] }, billingEvent: "IMPRESSIONS" },
    { id: "set-B", planId: "plan-B", name: "Set B", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg-1", pixelId: "px-1", conversionEvent: "PURCHASE", targeting: { countries: ["BD"] }, billingEvent: "IMPRESSIONS" },
  );
  tables.dailyAdMetric.rows.push(
    { id: "m1", organizationId: "org", campaignExternalId: "camp-A", adSetExternalId: "ext-set-A", adExternalId: "", date: new Date(), spendMinor: 15000n, impressions: 1000, clicks: 50, platformConversions: 5n, reach: 900 },
    { id: "m2", organizationId: "org", campaignExternalId: "camp-B", adSetExternalId: "ext-set-B", adExternalId: "", date: new Date(), spendMinor: 12000n, impressions: 800, clicks: 30, platformConversions: 6n, reach: 700 },
  );
  const auditEntries: any[] = [];
  const audit = { log: async (e: any) => { auditEntries.push(e); } } as any;
  const campaigns = new CampaignsService(tables as any, audit, { getProvider: () => new DevTemplateProvider() } as any, undefined, undefined);
  const frontier = new CampaignFrontierService(tables as any, audit, campaigns, undefined);
  const calls: { url: string; method: string; body: URLSearchParams | null }[] = [];
  const fetchFn = async (url: string, init: any) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    calls.push({ url: u, method, body: init?.body ? new URLSearchParams(String(init.body)) : null });
    if (method === "POST" && u.includes("/ad_studies")) {
      if (opts.studyCreate === "refuse") return { ok: false, status: 400, json: async () => ({ error: { message: "(#100) Invalid parameter: cells are frozen", code: 100 } }) };
      return { ok: true, status: 200, json: async () => ({ id: "study-1" }) };
    }
    if (u.includes("/cells")) return { ok: true, status: 200, json: async () => ({ data: STUDY_CELLS }) };
    if (u.includes("/study-1")) return { ok: true, status: 200, json: async () => STUDY_NODE };
    if (u.includes("act_777")) return { ok: true, status: 200, json: async () => (opts.business === false ? {} : { business: { id: "biz-1" } }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return { tables, frontier, campaigns, auditEntries, calls, fetchFn };
}
const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

describe("CN15 Meta Experiments", () => {
  it("creates the study on the business node with documented cells + objectives, stores the row only on Meta's id, and never touches the plans", async () => {
    const s = setup(); global.fetch = s.fetchFn as any;
    const beforeA = { ...s.tables.campaignPlan.rows.find((r: any) => r.id === "plan-A") };
    const out: any = await s.frontier.createExperiment("org", "u1", { planAId: "plan-A", planBId: "plan-B" });
    expect(out.metaStudyId).toBe("study-1");
    expect(out.metaBusinessId).toBe("biz-1");
    expect(out.splitA).toBe(50);
    expect(out.metricEvent).toBe("PURCHASE");
    expect(out.createResponse).toEqual({ id: "study-1" });
    expect(s.tables.campaignExperiment.rows).toHaveLength(1);
    const post = s.calls.find((c) => c.method === "POST" && c.url.includes("/biz-1/ad_studies"));
    expect(post).toBeTruthy();
    expect(post!.body!.get("type")).toBe("SPLIT_TEST");
    const cells = JSON.parse(post!.body!.get("cells")!);
    expect(cells).toHaveLength(2);
    expect(cells[0].campaigns).toEqual(["camp-A"]);
    expect(cells[1].campaigns).toEqual(["camp-B"]);
    expect(cells[0].treatment_percentage + cells[1].treatment_percentage).toBe(100);
    const objectives = JSON.parse(post!.body!.get("objectives")!);
    expect(objectives[0].type).toBe("CONVERSIONS");
    expect(objectives[0].adspixels).toEqual([{ id: "px-1", event_names: ["PURCHASE"] }]);
    // The plans themselves are untouched: no status change,
    // no publish-log writes, nothing activated.
    const afterA = s.tables.campaignPlan.rows.find((r: any) => r.id === "plan-A");
    expect(afterA.status).toBe(beforeA.status);
    expect(s.tables.campaignPublishLog.rows).toHaveLength(0);
  });

  it("honours an explicit split (30/70) and metric event override", async () => {
    const s = setup(); global.fetch = s.fetchFn as any;
    const out: any = await s.frontier.createExperiment("org", "u1", { planAId: "plan-A", planBId: "plan-B", splitA: 30, metricEvent: "ADD_TO_CART" });
    expect(out.splitA).toBe(30);
    const post = s.calls.find((c) => c.method === "POST" && c.url.includes("/ad_studies"));
    const cells = JSON.parse(post!.body!.get("cells")!);
    expect([cells[0].treatment_percentage, cells[1].treatment_percentage]).toEqual([30, 70]);
    const objectives = JSON.parse(post!.body!.get("objectives")!);
    expect(objectives[0].adspixels[0].event_names).toEqual(["ADD_TO_CART"]);
  });

  it("refuses out-of-range splits, same-plan pairs, cross-group pairs, unpublished variants and pixel-less variants", async () => {
    const s = setup(); global.fetch = s.fetchFn as any;
    await expect(s.frontier.createExperiment("org", "u1", { planAId: "plan-A", planBId: "plan-B", splitA: 5 })).rejects.toThrow(/between 10 and 90/);
    await expect(s.frontier.createExperiment("org", "u1", { planAId: "plan-A", planBId: "plan-A" })).rejects.toThrow(/TWO different/);
    s.tables.campaignPlan.rows.find((r: any) => r.id === "plan-B").abGroupId = "ab-OTHER";
    await expect(s.frontier.createExperiment("org", "u1", { planAId: "plan-A", planBId: "plan-B" })).rejects.toThrow(/SAME A\/B group/);
    expect(s.tables.campaignExperiment.rows).toHaveLength(0);

    const unpub = setup({ publishedB: false }); global.fetch = unpub.fetchFn as any;
    await expect(unpub.frontier.createExperiment("org", "u1", { planAId: "plan-A", planBId: "plan-B" })).rejects.toThrow(/not published yet/);
    expect(unpub.tables.campaignExperiment.rows).toHaveLength(0);

    const nopx = setup({ pixelOnA: false }); global.fetch = nopx.fetchFn as any;
    await expect(nopx.frontier.createExperiment("org", "u1", { planAId: "plan-A", planBId: "plan-B" })).rejects.toThrow(/no pixel/);
    expect(nopx.tables.campaignExperiment.rows).toHaveLength(0);
  });

  it("refuses honestly when Meta returns no business for the account — no row, no guessed business id", async () => {
    const s = setup({ business: false }); global.fetch = s.fetchFn as any;
    await expect(s.frontier.createExperiment("org", "u1", { planAId: "plan-A", planBId: "plan-B" })).rejects.toThrow(/Business/);
    expect(s.tables.campaignExperiment.rows).toHaveLength(0);
    expect(s.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("Meta's refusal propagates with Meta's own message, leaves no row, and is audit-logged", async () => {
    const s = setup({ studyCreate: "refuse" }); global.fetch = s.fetchFn as any;
    await expect(s.frontier.createExperiment("org", "u1", { planAId: "plan-A", planBId: "plan-B" })).rejects.toThrow(/cells are frozen/);
    expect(s.tables.campaignExperiment.rows).toHaveLength(0);
    expect(s.auditEntries.some((e) => e.action === "campaign.experiment_create_failed")).toBe(true);
  });

  it("read-back stores Meta's response verbatim and pairs it with labelled raw local totals — no computed winner", async () => {
    const s = setup(); global.fetch = s.fetchFn as any;
    const created: any = await s.frontier.createExperiment("org", "u1", { planAId: "plan-A", planBId: "plan-B" });
    const out: any = await s.frontier.refreshExperiment("org", "u1", created.id);
    expect(out.metaVerbatim.study).toEqual(STUDY_NODE);
    expect(out.metaVerbatim.cells).toEqual(STUDY_CELLS);
    const row = s.tables.campaignExperiment.rows[0];
    expect(row.lastReadback).toEqual({ study: STUDY_NODE, cells: STUDY_CELLS });
    expect(row.lastReadbackAt).toBeTruthy();
    expect(out.localNumbers.planA.spendMinor).toBe("15000");
    expect(out.localNumbers.planB.spendMinor).toBe("12000");
    expect(out.localNumbers.note).toMatch(/Significance Test নয়/);
    expect(out.experiment.significanceNote).toMatch(/Winner হিসাব করে না/);
    // No winner field is invented anywhere in the payload.
    expect(JSON.stringify(out)).not.toMatch(/"winnerPlanId"/);
  });

  it("lists experiments per plan and per org; unknown org sees nothing", async () => {
    const s = setup(); global.fetch = s.fetchFn as any;
    await s.frontier.createExperiment("org", "u1", { planAId: "plan-A", planBId: "plan-B" });
    expect(await s.frontier.listExperiments("org")).toHaveLength(1);
    expect(await s.frontier.listExperimentsForPlan("org", "plan-B")).toHaveLength(1);
    expect(await s.frontier.listExperiments("other-org")).toHaveLength(0);
    await expect(s.frontier.getExperiment("other-org", "campaignExperiment-1")).rejects.toThrow(/not found/i);
  });
});
