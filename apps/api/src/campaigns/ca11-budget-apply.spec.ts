import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder Advanced CA11 (CB3): CN7 budget-shift
 * APPLY + the multi-plan budget allocator.
 *
 * The Meta-confirmed leg (updateAdSetBudget) is stubbed at
 * the service boundary — it converts the major-unit string
 * back to minor and writes the fake ad-set row, exactly the
 * local effect the real path has after Meta confirms (the
 * real path itself is covered by phase-i.spec.ts with a
 * stubbed fetch). What is proven here is CA11's own logic:
 * staleness refusal with the fresh proposal, donor-first
 * order, winner-failure rollback, post-apply verification,
 * and the allocator's deterministic arithmetic.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("gte" in v) return new Date(row[k]).getTime() >= new Date((v as any).gte).getTime();
      if ("lte" in v) return new Date(row[k]).getTime() <= new Date((v as any).lte).getTime();
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
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); rows.splice(i, 1); return {}; },
  };
}
const day = 86_400_000;

function setup() {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "integration", "product", "dailyAdMetric", "dailyAdBreakdown", "audienceRecord", "catalogRecord", "productSet", "leadForm", "automationRule", "automationRun", "attributionCredit", "touchpoint", "crossPlatformDraft", "platformPublication", "businessProfile", "organization", "savedAudience"]) tables[n] = makeTable(n);
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", externalId: "act_777", name: "Main", currency: "BDT", integrationId: "int-1" });
  const auditCalls: any[] = [];
  const audit = { log: async (e: any) => { auditCalls.push(e); } } as any;
  const svc: any = new CampaignsService(tables as any, audit, { getProvider: () => new DevTemplateProvider() } as any);
  // Stubbed Meta-confirmed budget leg (see header).
  const budgetCalls: { adSetId: string; dailyBudget?: string }[] = [];
  svc.updateAdSetBudget = async (_org: string, _actor: string, _planId: string, adSetId: string, dto: { dailyBudget?: string }) => {
    budgetCalls.push({ adSetId, dailyBudget: dto.dailyBudget });
    const row = tables.campaignAdSet.rows.find((s: any) => s.id === adSetId);
    if (dto.dailyBudget !== undefined) row.dailyBudgetMinor = BigInt(Math.round(Number(dto.dailyBudget) * 100));
    return {};
  };
  return { tables, svc, auditCalls, budgetCalls };
}

/** The CN7 fixture: winner set-1 (daily ৳1000, CPA ৳75),
 * donor set-2 (daily ৳500, zero conversions). */
function seedShiftPlan(tables: any) {
  tables.campaignPlan.rows.push({ id: "plan-1", organizationId: "org", adAccountId: "acc-1", name: "Eid Sale", objective: "OUTCOME_SALES", status: "published", externalCampaignId: "camp-1", budgetMode: "abo", createdById: "u1" });
  tables.campaignAdSet.rows.push(
    { id: "set-1", planId: "plan-1", name: "Winner Set", externalAdSetId: "ext-set-1", dailyBudgetMinor: 100000n, optimizationGoal: "OFFSITE_CONVERSIONS", targeting: { countries: ["BD"] } },
    { id: "set-2", planId: "plan-1", name: "Dead Set", externalAdSetId: "ext-set-2", dailyBudgetMinor: 50000n, optimizationGoal: "OFFSITE_CONVERSIONS", targeting: { countries: ["BD"] } },
  );
  const now = Date.now();
  tables.dailyAdMetric.rows.push(
    { organizationId: "org", campaignExternalId: "camp-1", adSetExternalId: "", adExternalId: "", spendMinor: 210000n, impressions: 10000, clicks: 450, platformConversions: 20, date: new Date(now - day) },
    { organizationId: "org", campaignExternalId: "camp-1", adSetExternalId: "ext-set-1", adExternalId: "", spendMinor: 150000n, impressions: 8000, clicks: 400, platformConversions: 20, date: new Date(now - day) },
    { organizationId: "org", campaignExternalId: "camp-1", adSetExternalId: "ext-set-2", adExternalId: "", spendMinor: 60000n, impressions: 2000, clicks: 50, platformConversions: 0, date: new Date(now - day) },
  );
}

describe("CA11 budget-shift apply", () => {
  it("applies the confirmed proposal donor-first, verifies by re-read, and audits before/after", async () => {
    const { tables, svc, auditCalls, budgetCalls } = setup();
    seedShiftPlan(tables);
    const recs = await svc.planRecommendations("org", "plan-1");
    const shift = recs.recommendations.find((r: any) => r.type === "budget_shift");
    const out = await svc.applyRecommendation("org", "u1", "plan-1", { kind: "budget_shift", proposal: shift.proposal });
    expect(out.applied).toBe(true);
    expect(out.verified).toBe(true);
    expect(out.before).toEqual({ fromDailyMinor: "50000", toDailyMinor: "100000" });
    expect(out.after).toEqual({ fromDailyMinor: "40000", toDailyMinor: "110000" });
    expect(budgetCalls.map((c: any) => c.adSetId)).toEqual(["set-2", "set-1"]);
    const row2 = tables.campaignAdSet.rows.find((s: any) => s.id === "set-2");
    const row1 = tables.campaignAdSet.rows.find((s: any) => s.id === "set-1");
    expect(row2.dailyBudgetMinor).toBe(40000n);
    expect(row1.dailyBudgetMinor).toBe(110000n);
    const auditRow = auditCalls.find((a: any) => a.action === "campaign.budget_shift_applied");
    expect(auditRow.metadata.verified).toBe(true);
    expect(auditRow.metadata.shiftMinor).toBe("10000");
  });

  it("refuses a tampered proposal and returns the FRESH proposal — nothing is applied", async () => {
    const { tables, svc, budgetCalls } = setup();
    seedShiftPlan(tables);
    const recs = await svc.planRecommendations("org", "plan-1");
    const shift = recs.recommendations.find((r: any) => r.type === "budget_shift");
    const tampered = { ...shift.proposal, shiftMinor: "9999", fromDailyAfterMinor: "40001" };
    const err = await svc.applyRecommendation("org", "u1", "plan-1", { kind: "budget_shift", proposal: tampered }).catch((e: any) => e);
    expect(err.getStatus()).toBe(400);
    const body = err.getResponse();
    expect(body.freshProposal.shiftMinor).toBe("10000");
    expect(body.freshProposal.fromDailyAfterMinor).toBe("40000");
    expect(budgetCalls).toHaveLength(0);
    expect(tables.campaignAdSet.rows.find((s: any) => s.id === "set-2").dailyBudgetMinor).toBe(50000n);
  });

  it("refuses when the numbers moved after the proposal was shown (donor budget edited meanwhile)", async () => {
    const { tables, svc, budgetCalls } = setup();
    seedShiftPlan(tables);
    const recs = await svc.planRecommendations("org", "plan-1");
    const shift = recs.recommendations.find((r: any) => r.type === "budget_shift");
    tables.campaignAdSet.rows.find((s: any) => s.id === "set-2").dailyBudgetMinor = 60000n;
    const err = await svc.applyRecommendation("org", "u1", "plan-1", { kind: "budget_shift", proposal: shift.proposal }).catch((e: any) => e);
    expect(err.getStatus()).toBe(400);
    // fresh: 20% of 60000 = 12000 shift, donor after 48000
    expect(err.getResponse().freshProposal.shiftMinor).toBe("12000");
    expect(err.getResponse().freshProposal.fromDailyAfterMinor).toBe("48000");
    expect(budgetCalls).toHaveLength(0);
  });

  it("winner-leg failure rolls the donor back and audits the failure honestly", async () => {
    const { tables, svc, auditCalls } = setup();
    seedShiftPlan(tables);
    const recs = await svc.planRecommendations("org", "plan-1");
    const shift = recs.recommendations.find((r: any) => r.type === "budget_shift");
    const original = svc.updateAdSetBudget;
    svc.updateAdSetBudget = async (org: string, actor: string, planId: string, adSetId: string, dto: any) => {
      if (adSetId === "set-1") throw new Error("Meta said no");
      return original(org, actor, planId, adSetId, dto);
    };
    const err = await svc.applyRecommendation("org", "u1", "plan-1", { kind: "budget_shift", proposal: shift.proposal }).catch((e: any) => e);
    expect(err.getStatus()).toBe(400);
    expect(err.message).toContain("ফিরিয়ে দেওয়া হয়েছে");
    expect(tables.campaignAdSet.rows.find((s: any) => s.id === "set-2").dailyBudgetMinor).toBe(50000n);
    expect(tables.campaignAdSet.rows.find((s: any) => s.id === "set-1").dailyBudgetMinor).toBe(100000n);
    const fail = auditCalls.find((a: any) => a.action === "campaign.budget_shift_failed");
    expect(fail.metadata.donorRolledBack).toBe(true);
    expect(fail.metadata.stage).toBe("winner_leg");
  });

  it("no proposal payload = refusal, nothing applied", async () => {
    const { tables, svc, budgetCalls } = setup();
    seedShiftPlan(tables);
    await expect(svc.applyRecommendation("org", "u1", "plan-1", { kind: "budget_shift" })).rejects.toThrow(/proposal/);
    expect(budgetCalls).toHaveLength(0);
  });
});

/** Allocator fixture: A efficient (CPA ৳100, 30 conv),
 * F efficient (CPA ৳100, 9 conv), B inefficient (CPA ৳200),
 * C zero conversions, D draft, E CBO. */
function seedAllocatorPlans(tables: any) {
  const now = Date.now();
  const plan = (id: string, name: string, extra: any = {}) => tables.campaignPlan.rows.push({ id, organizationId: "org", adAccountId: "acc-1", name, objective: "OUTCOME_SALES", status: "published", budgetMode: "abo", createdById: "u1", ...extra });
  const set = (id: string, planId: string, daily: bigint) => tables.campaignAdSet.rows.push({ id, planId, name: `Set ${id}`, externalAdSetId: `ext-${id}`, dailyBudgetMinor: daily, optimizationGoal: "OFFSITE_CONVERSIONS", targeting: { countries: ["BD"] } });
  const campRow = (camp: string, spend: bigint, conv: number) => tables.dailyAdMetric.rows.push({ organizationId: "org", campaignExternalId: camp, adSetExternalId: "", adExternalId: "", spendMinor: spend, impressions: 9000, clicks: 300, platformConversions: conv, date: new Date(now - day) });
  const setRow = (camp: string, extSet: string, spend: bigint, conv: number) => tables.dailyAdMetric.rows.push({ organizationId: "org", campaignExternalId: camp, adSetExternalId: extSet, adExternalId: "", spendMinor: spend, impressions: 4000, clicks: 150, platformConversions: conv, date: new Date(now - day) });

  plan("plan-a", "Plan A", { externalCampaignId: "camp-a" });
  set("a1", "plan-a", 100000n); set("a2", "plan-a", 50000n);
  campRow("camp-a", 300000n, 30); setRow("camp-a", "ext-a1", 200000n, 25); setRow("camp-a", "ext-a2", 100000n, 5);

  plan("plan-f", "Plan F", { externalCampaignId: "camp-f" });
  set("f1", "plan-f", 40000n);
  campRow("camp-f", 90000n, 9);

  plan("plan-b", "Plan B", { externalCampaignId: "camp-b" });
  set("b1", "plan-b", 80000n);
  campRow("camp-b", 200000n, 10);

  plan("plan-c", "Plan C", { externalCampaignId: "camp-c" });
  set("c1", "plan-c", 60000n);
  campRow("camp-c", 50000n, 0);

  plan("plan-d", "Plan D", { status: "draft", externalCampaignId: null });
  plan("plan-e", "Plan E", { externalCampaignId: "camp-e", budgetMode: "cbo", campaignDailyBudgetMinor: 70000n });
}

describe("CA11 budget allocator", () => {
  it("allocates proportionally to conversions among efficient plans only; exclusions carry reasons + evidence", async () => {
    const { tables, svc } = setup();
    seedAllocatorPlans(tables);
    const out = await svc.budgetAllocatorProposal("org", { planIds: ["plan-a", "plan-f", "plan-b", "plan-c", "plan-d", "plan-e"], totalShiftMinor: "39000" });
    expect(out.label).toBe("proposal_only");
    const byId = new Map<string, any>(out.allocations.map((a: any) => [a.planId, a]));
    // weights 30 : 9 over 39000 -> 30000 : 9000 exactly
    expect(byId.get("plan-a").amountMinor).toBe("30000");
    expect(byId.get("plan-a").currentDailyTotalMinor).toBe("150000");
    expect(byId.get("plan-a").newDailyTotalMinor).toBe("180000");
    expect(byId.get("plan-a").targetAdSetId).toBe("a1");
    expect(byId.get("plan-a").targetBasis).toBe("lowest_cpa");
    expect(byId.get("plan-f").amountMinor).toBe("9000");
    expect(out.allocatedMinor).toBe("39000");
    expect(out.unallocatedMinor).toBe("0");
    const ex = new Map<string, any>(out.excluded.map((x: any) => [x.planId, x]));
    expect(ex.get("plan-b").reason).toBe("below_efficiency");
    expect(ex.get("plan-b").evidence.cpaMinor).toBe("20000");
    expect(ex.get("plan-c").reason).toBe("no_evidence");
    expect(ex.get("plan-c").evidence.conversions).toBe(0);
    expect(ex.get("plan-d").reason).toBe("not_published");
    expect(ex.get("plan-e").reason).toBe("cbo_no_live_budget_path");
    // proposal mutates nothing
    expect(tables.campaignAdSet.rows.find((s: any) => s.id === "a1").dailyBudgetMinor).toBe(100000n);
  });

  it("caps each plan at its current daily total and reports the genuinely unallocatable remainder", async () => {
    const { tables, svc } = setup();
    seedAllocatorPlans(tables);
    const out = await svc.budgetAllocatorProposal("org", { planIds: ["plan-a", "plan-f"], totalShiftMinor: "1000000" });
    const byId = new Map<string, any>(out.allocations.map((a: any) => [a.planId, a]));
    expect(byId.get("plan-a").amountMinor).toBe("150000");
    expect(byId.get("plan-f").amountMinor).toBe("40000");
    expect(out.unallocatedMinor).toBe("810000");
  });

  it("apply: per-plan success + stale refusal side by side; the good plan still applies and audits", async () => {
    const { tables, svc, auditCalls } = setup();
    seedAllocatorPlans(tables);
    const out = await svc.applyBudgetAllocator("org", "u1", {
      allocations: [
        { planId: "plan-a", amountMinor: "30000", expectedDailyTotalMinor: "150000" },
        { planId: "plan-f", amountMinor: "9000", expectedDailyTotalMinor: "999999" },
      ],
    });
    expect(out.appliedCount).toBe(1);
    expect(out.failedCount).toBe(1);
    const a = out.results.find((r: any) => r.planId === "plan-a");
    expect(a.ok).toBe(true);
    expect(a.targetAdSetId).toBe("a1");
    expect(a.beforeDailyMinor).toBe("100000");
    expect(a.afterDailyMinor).toBe("130000");
    expect(a.verified).toBe(true);
    const f = out.results.find((r: any) => r.planId === "plan-f");
    expect(f.ok).toBe(false);
    expect(f.error).toBe("stale_daily_total");
    expect(f.currentDailyTotalMinor).toBe("40000");
    expect(tables.campaignAdSet.rows.find((s: any) => s.id === "a1").dailyBudgetMinor).toBe(130000n);
    expect(tables.campaignAdSet.rows.find((s: any) => s.id === "f1").dailyBudgetMinor).toBe(40000n);
    const auditRow = auditCalls.find((x: any) => x.action === "campaign.budget_allocator_applied");
    expect(auditRow.entityId).toBe("plan-a");
    expect(auditRow.metadata.amountMinor).toBe("30000");
  });

  it("apply refuses an allocation above the plan's cap even with a matching total", async () => {
    const { tables, svc } = setup();
    seedAllocatorPlans(tables);
    const out = await svc.applyBudgetAllocator("org", "u1", {
      allocations: [{ planId: "plan-f", amountMinor: "40001", expectedDailyTotalMinor: "40000" }],
    });
    expect(out.results[0].ok).toBe(false);
    expect(out.results[0].error).toBe("exceeds_cap");
    expect(tables.campaignAdSet.rows.find((s: any) => s.id === "f1").dailyBudgetMinor).toBe(40000n);
  });

  it("cross-org isolation: a foreign plan id is excluded as not found, never allocated", async () => {
    const { tables, svc } = setup();
    seedAllocatorPlans(tables);
    tables.campaignPlan.rows.push({ id: "plan-x", organizationId: "other-org", adAccountId: "acc-1", name: "Foreign", objective: "OUTCOME_SALES", status: "published", externalCampaignId: "camp-x", budgetMode: "abo", createdById: "u9" });
    const out = await svc.budgetAllocatorProposal("org", { planIds: ["plan-x"], totalShiftMinor: "10000" });
    expect(out.allocations).toHaveLength(0);
    expect(out.excluded[0]).toMatchObject({ planId: "plan-x", reason: "plan_not_found" });
  });
});
