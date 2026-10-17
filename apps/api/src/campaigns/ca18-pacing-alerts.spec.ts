import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder Advanced CA18 (CB5): pacing alerts +
 * runway. The runway is deterministic arithmetic over REAL
 * DailyAdMetric rows (trailing-7-day burn over distinct
 * metric days); thin data is "তথ্য নেই", never a number.
 * The sweep reconciles firing conditions against
 * PlanPacingAlert: raise once, re-notify at most once per
 * 24h cooldown, clear when the condition stops firing —
 * and a plan whose pacing cannot be computed never has
 * its alerts silently cleared.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("gte" in v) return new Date(row[k]).getTime() >= new Date((v as any).gte).getTime();
      if ("lte" in v) return row[k] != null && new Date(row[k]).getTime() <= new Date((v as any).lte).getTime();
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
      if (orderBy?.raisedAt === "desc") f = [...f].sort((a, b) => new Date(b.raisedAt).getTime() - new Date(a.raisedAt).getTime());
      return take ? f.slice(0, take) : f;
    },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
    updateMany: async ({ where, data }: any) => { let count = 0; for (const r of rows) if (matches(r, where ?? {})) { Object.assign(r, data); count++; } return { count }; },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
  };
}
const day = 86_400_000;
const NOW = new Date("2026-10-20T12:00:00.000Z");

function setup() {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "organization", "dailyAdMetric", "planPacingAlert", "agentNotification", "membership"]) tables[n] = makeTable(n);
  tables.organization.rows.push({ id: "org", timezone: "Asia/Dhaka" });
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", externalId: "act_777", currency: "BDT", integrationId: "int-1" });
  const auditCalls: any[] = [];
  const audit = { log: async (e: any) => { auditCalls.push(e); } } as any;
  const svc: any = new CampaignsService(tables as any, audit, { getProvider: () => new DevTemplateProvider() } as any);
  return { tables, svc, auditCalls };
}

function metric(tables: any, daysAgo: number, spendMinor: bigint, campaignExternalId = "camp-1") {
  tables.dailyAdMetric.rows.push({
    id: `m-${tables.dailyAdMetric.rows.length + 1}`, organizationId: "org", campaignExternalId,
    adSetExternalId: "", adExternalId: "", date: new Date(NOW.getTime() - daysAgo * day), spendMinor,
  });
}

describe("CA18 computeRunway", () => {
  it("burn over distinct metric days → runway days + projected date", () => {
    const rows = [4, 3, 2, 1, 0].map((d) => ({ date: new Date(NOW.getTime() - d * day), spendMinor: 100000n }));
    const out = CampaignsService.computeRunway(rows, 2000000n, 7000000n, NOW);
    expect(out.available).toBe(true);
    if (out.available) {
      expect(out.metricDays).toBe(5);
      expect(out.burnMinorPerDay).toBe("100000");
      expect(out.remainingMinor).toBe("5000000");
      expect(out.runwayDays).toBe(50);
      expect(out.projectedExhaustionDate).toBe(new Date(NOW.getTime() + 50 * day).toISOString());
      expect(out.label).toContain("আনুমানিক projection");
    }
  });

  it("fewer than 3 distinct metric days is তথ্য নেই — never a number", () => {
    const rows = [1, 0].map((d) => ({ date: new Date(NOW.getTime() - d * day), spendMinor: 100000n }));
    const out = CampaignsService.computeRunway(rows, 0n, 7000000n, NOW);
    expect(out.available).toBe(false);
    if (!out.available) expect(out.reason).toContain("তথ্য নেই");
  });

  it("a daily-budget plan has no runway (budget refills) and zero burn is তথ্য নেই", () => {
    const rows = [2, 1, 0].map((d) => ({ date: new Date(NOW.getTime() - d * day), spendMinor: 100000n }));
    expect(CampaignsService.computeRunway(rows, 0n, null, NOW).available).toBe(false);
    const zero = [3, 2, 1, 0].map((d) => ({ date: new Date(NOW.getTime() - d * day), spendMinor: 0n }));
    expect(CampaignsService.computeRunway(zero, 0n, 7000000n, NOW).available).toBe(false);
  });

  it("rows outside the trailing window and ad-set-level rows do not feed the burn", () => {
    const rows = [
      { date: new Date(NOW.getTime() - 30 * day), spendMinor: 9000000n },
      ...[2, 1, 0].map((d) => ({ date: new Date(NOW.getTime() - d * day), spendMinor: 100000n })),
    ];
    const out = CampaignsService.computeRunway(rows, 300000n, 1300000n, NOW);
    expect(out.available).toBe(true);
    if (out.available) expect(out.runwayDays).toBe(10);
  });
});

describe("CA18 scanPacingAlerts", () => {
  function dailyPlan(tables: any) {
    tables.campaignPlan.rows.push({
      id: "plan-1", organizationId: "org", adAccountId: "acc-1", name: "Daily Sale", objective: "OUTCOME_SALES",
      status: "published", externalCampaignId: "camp-1", metaStatus: "ACTIVE", budgetMode: "abo", createdById: "u1", publishedAt: new Date(NOW.getTime() - 10 * day),
    });
    tables.campaignAdSet.rows.push({
      id: "set-1", planId: "plan-1", name: "S", dailyBudgetMinor: 10000n, lifetimeBudgetMinor: null,
      optimizationGoal: "LINK_CLICKS", targeting: { countries: ["BD"] },
      startTime: new Date(NOW.getTime() - 10 * day), endTime: null,
    });
  }

  it("overspend pace (>20% over expected-to-date) raises ONE alert, notifies the creator, dedupes on re-run, re-notifies only after the 24h cooldown", async () => {
    const { tables, svc, auditCalls } = setup();
    dailyPlan(tables);
    // daysElapsed = 11 (UTC-midnight count, start 10 days ago)
    // × ৳100/day expected = 110000; spent 160000 = +45.5% —
    // still >20% over a day later (expected 120000, +33%),
    // so the cooldown re-notify leg is what the third scan
    // exercises, not a clear.
    metric(tables, 9, 40000n); metric(tables, 5, 40000n); metric(tables, 1, 80000n);
    const first = await svc.scanPacingAlerts("org", NOW);
    expect(first.raised).toBe(1);
    expect(first.evaluated).toBe(1);
    const alerts = tables.planPacingAlert.rows;
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("overspend_pace");
    expect(alerts[0].status).toBe("active");
    expect(alerts[0].detail.overPercent).toBe(45.5);
    expect(alerts[0].detail.thresholdPercent).toBe(20);
    expect(tables.agentNotification.rows.filter((n: any) => n.type === "campaign_pacing_alert")).toHaveLength(1);
    expect(auditCalls.find((a: any) => a.action === "campaign.pacing_alert_raised")).toBeTruthy();
    // immediate re-run: same single alert, no re-notify
    const second = await svc.scanPacingAlerts("org", NOW);
    expect(second.raised).toBe(0);
    expect(second.renotified).toBe(0);
    expect(tables.planPacingAlert.rows).toHaveLength(1);
    expect(tables.agentNotification.rows.filter((n: any) => n.type === "campaign_pacing_alert")).toHaveLength(1);
    // after the cooldown the still-firing alert re-notifies — still one row
    const third = await svc.scanPacingAlerts("org", new Date(NOW.getTime() + 25 * 3_600_000));
    expect(third.renotified).toBe(1);
    expect(tables.planPacingAlert.rows).toHaveLength(1);
    expect(tables.agentNotification.rows.filter((n: any) => n.type === "campaign_pacing_alert")).toHaveLength(2);
  });

  it("when the condition stops firing the alert CLEARS (history kept), and listPlanPacingAlerts separates active from recent", async () => {
    const { tables, svc, auditCalls } = setup();
    dailyPlan(tables);
    metric(tables, 9, 40000n); metric(tables, 5, 40000n); metric(tables, 1, 60000n);
    await svc.scanPacingAlerts("org", NOW);
    expect(tables.planPacingAlert.rows[0].status).toBe("active");
    // the owner raises the daily budget — expected-to-date now
    // exceeds spend, the overspend condition stops firing.
    tables.campaignAdSet.rows[0].dailyBudgetMinor = 100000n;
    const out = await svc.scanPacingAlerts("org", NOW);
    expect(out.cleared).toBe(1);
    expect(tables.planPacingAlert.rows[0].status).toBe("cleared");
    expect(tables.planPacingAlert.rows[0].clearedAt).toBeTruthy();
    expect(auditCalls.find((a: any) => a.action === "campaign.pacing_alert_cleared")).toBeTruthy();
    const listed = await svc.listPlanPacingAlerts("org", "plan-1");
    expect(listed.active).toHaveLength(0);
    expect(listed.recent).toHaveLength(1);
    expect(listed.thresholds.overspendPercent).toBe(20);
  });

  it("projected exhaustion at least 2 days before the end date raises early_exhaustion (and only that)", async () => {
    const { tables, svc } = setup();
    tables.campaignPlan.rows.push({
      id: "plan-1", organizationId: "org", adAccountId: "acc-1", name: "Lifetime Sale", objective: "OUTCOME_SALES",
      status: "published", externalCampaignId: "camp-1", metaStatus: "ACTIVE", budgetMode: "abo", createdById: "u1", publishedAt: new Date(NOW.getTime() - 5 * day),
    });
    tables.campaignAdSet.rows.push({
      id: "set-1", planId: "plan-1", name: "S", dailyBudgetMinor: null, lifetimeBudgetMinor: 7000000n,
      optimizationGoal: "LINK_CLICKS", targeting: { countries: ["BD"] },
      startTime: new Date(NOW.getTime() - 5 * day), endTime: new Date(NOW.getTime() + 40 * day),
    });
    // trailing burn 200000/day over the last 3 days; total spent
    // 600000 < expected-to-date (7000000 × 6/46 ≈ 913043) → no
    // overspend. Remaining 6400000 / 200000 = 32 runway days,
    // projected NOW+32d < end NOW+40d − 2d margin → fires.
    metric(tables, 2, 200000n); metric(tables, 1, 200000n); metric(tables, 0, 200000n);
    const out = await svc.scanPacingAlerts("org", NOW);
    expect(out.raised).toBe(1);
    const kinds = tables.planPacingAlert.rows.map((a: any) => a.kind);
    expect(kinds).toEqual(["early_exhaustion"]);
    expect(tables.planPacingAlert.rows[0].detail.runwayDays).toBe(32);
    expect(tables.planPacingAlert.rows[0].detail.marginDays).toBe(2);
  });

  it("a plan with no metric rows is skipped and its existing alert is NOT silently cleared", async () => {
    const { tables, svc } = setup();
    dailyPlan(tables);
    tables.planPacingAlert.rows.push({
      id: "alert-old", organizationId: "org", planId: "plan-1", kind: "overspend_pace", status: "active",
      message: "old", detail: {}, raisedAt: new Date(NOW.getTime() - day), lastNotifiedAt: new Date(NOW.getTime() - day),
    });
    const out = await svc.scanPacingAlerts("org", NOW);
    expect(out.evaluated).toBe(0);
    expect(out.cleared).toBe(0);
    expect(tables.planPacingAlert.rows[0].status).toBe("active");
  });

  it("org scoping: another org's plans are not evaluated", async () => {
    const { tables, svc } = setup();
    dailyPlan(tables);
    tables.campaignPlan.rows.push({
      id: "plan-foreign", organizationId: "other", adAccountId: "acc-1", name: "Foreign", objective: "OUTCOME_SALES",
      status: "published", externalCampaignId: "camp-9", metaStatus: "ACTIVE", budgetMode: "abo", createdById: "u9", publishedAt: new Date(NOW.getTime() - 10 * day),
    });
    tables.campaignAdSet.rows.push({
      id: "set-9", planId: "plan-foreign", name: "S", dailyBudgetMinor: 10000n, lifetimeBudgetMinor: null,
      optimizationGoal: "LINK_CLICKS", targeting: { countries: ["BD"] }, startTime: new Date(NOW.getTime() - 10 * day), endTime: null,
    });
    metric(tables, 1, 500000n, "camp-9");
    const out = await svc.scanPacingAlerts("org", NOW);
    expect(out.evaluated).toBe(0);
    expect(tables.planPacingAlert.rows).toHaveLength(0);
  });

  it("planPacing payload carries the runway additively (CN2 fields untouched)", async () => {
    const { tables, svc } = setup();
    dailyPlan(tables);
    metric(tables, 1, 5000n);
    const pacing = await svc.planPacing("org", "plan-1", NOW);
    expect(pacing.status).toBe("ok");
    expect(pacing.spentMinor).toBe("5000");
    expect(pacing.runway).toBeTruthy();
    expect(pacing.runway.available).toBe(false); // daily-budget plan: no runway, stated
    const runway = await svc.planRunway("org", "plan-1", NOW);
    expect(runway.available ?? runway.runway.available).toBe(false);
  });
});
