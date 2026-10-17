import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";
import { encryptJson } from "../integrations/crypto";

/**
 * Campaign Builder Advanced CA14 (CB3): server-side bulk
 * operations over the existing single-item services.
 * Semantics under test: per-item results (partial failure
 * is reported as partial, never as full success), org
 * scoping per item, guardrail parity with the single ops
 * (percent via scalePlanBudgets; fixed adjust refuses a
 * <= 0 landing BEFORE changing anything), and per-item
 * audits from the underlying operations plus one summary
 * audit. Meta is stubbed at the global-fetch boundary —
 * the real updateAdSetBudget/setMetaStatus code runs.
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
    findMany: async ({ where, orderBy, take }: any = {}) => { let f = rows.filter((r) => matches(r, where ?? {})); if (orderBy?.createdAt === "desc") f = [...f].reverse(); return take ? f.slice(0, take) : f; },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => matches(r, where?.id ? { id: where.id } : where ?? {})); if (row) Object.assign(row, data, { updatedAt: new Date() }); return row; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => matches(r, where?.id ? { id: where.id } : where ?? {})); rows.splice(i, 1); return {}; },
  };
}

function setup() {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "organization", "integration"]) tables[n] = makeTable(n);
  tables.organization.rows.push({ id: "org", timezone: "Asia/Dhaka" });
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", externalId: "act_777", currency: "BDT", integrationId: "int-1" });
  tables.integration.rows.push({ id: "int-1", organizationId: "org", provider: "meta_ads", status: "connected", credential: { encryptedData: encryptJson({ accessToken: "tok" }) } });
  tables.campaignPlan.rows.push(
    { id: "plan-live", organizationId: "org", adAccountId: "acc-1", name: "Live", objective: "OUTCOME_SALES", status: "published", externalCampaignId: "camp-1", metaStatus: "ACTIVE", budgetMode: "abo", createdById: "u1" },
    { id: "plan-draft", organizationId: "org", adAccountId: "acc-1", name: "Draft", objective: "OUTCOME_SALES", status: "draft", createdById: "u1" },
    { id: "plan-foreign", organizationId: "org-2", adAccountId: "acc-9", name: "Foreign", objective: "OUTCOME_SALES", status: "published", externalCampaignId: "camp-9", metaStatus: "ACTIVE", createdById: "u9" },
  );
  tables.campaignAdSet.rows.push({ id: "s1", planId: "plan-live", name: "S1", dailyBudgetMinor: 50000n, externalAdSetId: "set-ext-1", optimizationGoal: "OFFSITE_CONVERSIONS", targeting: { countries: ["BD"] } });
  const auditCalls: any[] = [];
  const audit = { log: async (e: any) => { auditCalls.push(e); } } as any;
  const svc: any = new CampaignsService(tables as any, audit, { getProvider: () => new DevTemplateProvider() } as any);
  // Meta is stubbed at the global-fetch boundary (the
  // house pattern from campaigns.service.spec.ts): every
  // single-object POST succeeds; calls are recorded.
  const metaCalls: { url: string; body: string }[] = [];
  (global as any).fetch = async (url: string, init: any) => {
    metaCalls.push({ url: String(url), body: String(init?.body ?? "") });
    return { ok: true, status: 200, json: async () => ({ success: true, id: "ok" }) };
  };
  return { tables, svc, auditCalls, metaCalls };
}

describe("CA14 bulk operations", () => {
  it("pause: published pauses through Meta, draft is a per-item error — partial is reported as partial", async () => {
    const { svc, auditCalls, metaCalls } = setup();
    const out = await svc.bulkPlanAction("org", "u1", { planIds: ["plan-live", "plan-draft"], action: "pause" });
    expect(out.succeeded).toBe(1);
    expect(out.failed).toBe(1);
    expect(out.results.find((r: any) => r.planId === "plan-live")).toMatchObject({ ok: true, result: { metaStatus: "PAUSED" } });
    expect(out.results.find((r: any) => r.planId === "plan-draft")).toMatchObject({ ok: false, error: "not_published" });
    expect(metaCalls.some((c: any) => c.url.includes("camp-1") && c.body.includes("PAUSED"))).toBe(true);
    const summary = auditCalls.find((a: any) => a.action === "campaign.bulk_action");
    expect(summary.metadata).toMatchObject({ bulkAction: "pause", requested: 2, succeeded: 1, failed: 1 });
    expect(auditCalls.some((a: any) => a.action === "campaign.paused")).toBe(true); // per-item audit from the single op
  });

  it("activate mirrors pause for a PAUSED published plan", async () => {
    const { tables, svc } = setup();
    tables.campaignPlan.rows.find((p: any) => p.id === "plan-live").metaStatus = "PAUSED";
    const out = await svc.bulkPlanAction("org", "u1", { planIds: ["plan-live"], action: "activate" });
    expect(out.results[0]).toMatchObject({ ok: true, result: { metaStatus: "ACTIVE" } });
  });

  it("budget_percent rides scalePlanBudgets (+20% on the live set)", async () => {
    const { tables, svc } = setup();
    const out = await svc.bulkPlanAction("org", "u1", { planIds: ["plan-live"], action: "budget_percent", percent: 20 });
    expect(out.results[0].ok).toBe(true);
    expect(tables.campaignAdSet.rows.find((s: any) => s.id === "s1").dailyBudgetMinor).toBe(60000n);
  });

  it("budget_fixed: a delta that would zero a set refuses the whole plan item BEFORE any change; a valid delta applies", async () => {
    const { tables, svc } = setup();
    const bad = await svc.bulkPlanAction("org", "u1", { planIds: ["plan-live"], action: "budget_fixed", fixedMinor: "-60000" });
    expect(bad.results[0].ok).toBe(false);
    expect(bad.results[0].error).toMatch(/<= 0/);
    expect(tables.campaignAdSet.rows.find((s: any) => s.id === "s1").dailyBudgetMinor).toBe(50000n);
    const good = await svc.bulkPlanAction("org", "u1", { planIds: ["plan-live"], action: "budget_fixed", fixedMinor: "5000" });
    expect(good.results[0].ok).toBe(true);
    expect(tables.campaignAdSet.rows.find((s: any) => s.id === "s1").dailyBudgetMinor).toBe(55000n);
  });

  it("budget ops on a draft with no live sets report no_live_budget_path per item", async () => {
    const { svc } = setup();
    const out = await svc.bulkPlanAction("org", "u1", { planIds: ["plan-draft"], action: "budget_percent", percent: 10 });
    expect(out.results[0]).toMatchObject({ ok: false, error: "no_live_budget_path" });
    expect(out.failed).toBe(1);
  });

  it("duplicate creates a same-account draft copy per item via duplicatePlan", async () => {
    const { tables, svc } = setup();
    const out = await svc.bulkPlanAction("org", "u1", { planIds: ["plan-draft"], action: "duplicate" });
    expect(out.results[0].ok).toBe(true);
    const copy = tables.campaignPlan.rows.find((p: any) => p.id === out.results[0].result.newPlanId);
    expect(copy.status).toBe("draft");
    expect(copy.adAccountId).toBe("acc-1");
    expect(copy.name).toContain("(কপি)");
  });

  it("cross-org: a foreign plan id is a per-item plan_not_found and the foreign plan is untouched", async () => {
    const { tables, svc, metaCalls } = setup();
    const out = await svc.bulkPlanAction("org", "u1", { planIds: ["plan-foreign"], action: "pause" });
    expect(out.results[0]).toMatchObject({ ok: false, error: "plan_not_found" });
    expect(tables.campaignPlan.rows.find((p: any) => p.id === "plan-foreign").metaStatus).toBe("ACTIVE");
    expect(metaCalls).toHaveLength(0);
  });

  it("whole-call validation: unknown action, zero percent, zero fixed and empty ids refuse before any item runs", async () => {
    const { svc } = setup();
    await expect(svc.bulkPlanAction("org", "u1", { planIds: ["plan-live"], action: "explode" })).rejects.toThrow(/action must be/);
    await expect(svc.bulkPlanAction("org", "u1", { planIds: ["plan-live"], action: "budget_percent", percent: 0 })).rejects.toThrow(/non-zero/);
    await expect(svc.bulkPlanAction("org", "u1", { planIds: ["plan-live"], action: "budget_fixed", fixedMinor: "0" })).rejects.toThrow(/non-zero/);
    await expect(svc.bulkPlanAction("org", "u1", { planIds: [], action: "pause" })).rejects.toThrow(/planIds/);
  });
});
