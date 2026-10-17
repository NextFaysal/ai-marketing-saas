import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder Advanced CA19 (CB5): geo holdout.
 * SPIKE VERDICT pinned by this suite's design: Meta's Ad
 * Study contract (the CN15 path) splits the AUDIENCE
 * randomly across cells of campaigns — there is no geo
 * dimension, so NO study is ever created here. What is
 * built is the honest fallback: a holdout DEFINITION on
 * the plan + an OBSERVATIONAL comparison over stored
 * DailyAdBreakdown region rows. The definition changes
 * no delivery; holdout-region spend, when it exists in
 * the rows, is flagged — never hidden.
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
      if (orderBy?.createdAt === "desc") f = [...f].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return take ? f.slice(0, take) : f;
    },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
    updateMany: async ({ where, data }: any) => { let count = 0; for (const r of rows) if (matches(r, where ?? {})) { Object.assign(r, data); count++; } return { count }; },
  };
}
const day = 86_400_000;
const START = new Date("2026-10-01T00:00:00.000Z");
const END = new Date("2026-10-31T23:59:59.000Z");

function setup() {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "adAccount", "organization", "dailyAdBreakdown", "planGeoHoldout"]) tables[n] = makeTable(n);
  tables.organization.rows.push({ id: "org", timezone: "Asia/Dhaka" });
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", externalId: "act_777", currency: "BDT", integrationId: "int-1" });
  tables.campaignPlan.rows.push({
    id: "plan-1", organizationId: "org", adAccountId: "acc-1", name: "Geo Sale", objective: "OUTCOME_SALES",
    status: "published", externalCampaignId: "camp-1", metaStatus: "ACTIVE", budgetMode: "abo", createdById: "u1",
  });
  const auditCalls: any[] = [];
  const audit = { log: async (e: any) => { auditCalls.push(e); } } as any;
  const svc: any = new CampaignsService(tables as any, audit, { getProvider: () => new DevTemplateProvider() } as any);
  return { tables, svc, auditCalls };
}

function brow(tables: any, region: string, daysAfterStart: number, spendMinor: bigint, conversions: number) {
  tables.dailyAdBreakdown.rows.push({
    id: `b-${tables.dailyAdBreakdown.rows.length + 1}`, organizationId: "org", adAccountId: "acc-1", platform: "meta",
    dimension: "region", key: region, campaignExternalId: "camp-1",
    date: new Date(START.getTime() + daysAfterStart * day), spendMinor, impressions: 1000, clicks: 50, platformConversions: conversions,
  });
}

const dto = { testRegions: ["Dhaka", "Khulna"], holdoutRegions: ["Sylhet"], startsAt: START.toISOString(), endsAt: END.toISOString() };

describe("CA19 createGeoHoldout validation", () => {
  it("creates a definition and returns it with the spike method labels", async () => {
    const { svc, tables, auditCalls } = setup();
    const out = await svc.createGeoHoldout("org", "u1", "plan-1", dto);
    expect(out.available).toBe(true);
    expect(out.spikeVerdict).toBe("not_creatable_via_ad_study");
    expect(out.method).toContain("Meta Experiment নয়");
    expect(out.deliveryNote).toContain("Delivery বদলায় না");
    expect(out.holdout.testRegions).toEqual(["Dhaka", "Khulna"]);
    expect(out.holdout.holdoutRegions).toEqual(["Sylhet"]);
    expect(out.holdout.status).toBe("active");
    expect(tables.planGeoHoldout.rows).toHaveLength(1);
    expect(auditCalls.find((a: any) => a.action === "campaign.geo_holdout_created")).toBeTruthy();
  });

  it("refuses overlapping sets, empty sets, an inverted or over-long window, and a second active definition", async () => {
    const { svc } = setup();
    await expect(svc.createGeoHoldout("org", "u1", "plan-1", { ...dto, holdoutRegions: ["dhaka"] })).rejects.toThrow(/দুই দলেই/);
    await expect(svc.createGeoHoldout("org", "u1", "plan-1", { ...dto, testRegions: [] })).rejects.toThrow(/Test Region/);
    await expect(svc.createGeoHoldout("org", "u1", "plan-1", { ...dto, holdoutRegions: [] })).rejects.toThrow(/Holdout Region/);
    await expect(svc.createGeoHoldout("org", "u1", "plan-1", { ...dto, startsAt: END.toISOString(), endsAt: START.toISOString() })).rejects.toThrow(/পরে/);
    await expect(svc.createGeoHoldout("org", "u1", "plan-1", { ...dto, endsAt: new Date(START.getTime() + 120 * day).toISOString() })).rejects.toThrow(/৯২|92/);
    await svc.createGeoHoldout("org", "u1", "plan-1", dto);
    await expect(svc.createGeoHoldout("org", "u1", "plan-1", dto)).rejects.toThrow(/Active Holdout Definition আছে/);
  });

  it("comma/newline string input normalises and dedupes region names", async () => {
    const { svc, tables } = setup();
    await svc.createGeoHoldout("org", "u1", "plan-1", { ...dto, testRegions: "Dhaka, dhaka\nKhulna" as any, holdoutRegions: "Sylhet" as any });
    expect(tables.planGeoHoldout.rows[0].testRegions).toEqual([{ name: "Dhaka" }, { name: "Khulna" }]);
  });
});

describe("CA19 observational measurement", () => {
  it("buckets stored rows into test / holdout / other, computes per-1000 arithmetic, and flags holdout spend", async () => {
    const { tables, svc } = setup();
    await svc.createGeoHoldout("org", "u1", "plan-1", dto);
    brow(tables, "Dhaka", 2, 100000n, 10);   // test: ৳1000, 10 conv
    brow(tables, "Khulna", 3, 100000n, 6);    // test: ৳1000, 6 conv
    brow(tables, "Sylhet", 4, 50000n, 2);     // holdout: ৳500, 2 conv — spend in holdout!
    brow(tables, "Rajshahi", 5, 30000n, 3);   // other: in neither set
    brow(tables, "Dhaka", 60, 999999n, 99);   // outside the window — must not count
    const out = await svc.getGeoHoldout("org", "plan-1");
    const m = out.measurement;
    expect(m.available).toBe(true);
    expect(m.windowRows).toBe(4);
    expect(m.groups.test.conversions).toBe(16);
    expect(m.groups.test.spendMinor).toBe("200000");
    expect(m.groups.test.conversionsPer1000Spend).toBe(8); // 16 conv / ৳2000 × 1000
    expect(m.groups.holdout.conversions).toBe(2);
    expect(m.groups.holdout.conversionsPer1000Spend).toBe(4); // 2 / ৳500 × 1000
    expect(m.observedDifferencePer1000).toBe(4);
    expect(m.observedDifferenceLabel).toContain("Lift নয়");
    expect(m.groups.other.conversions).toBe(3);
    expect(m.groups.other.regions.map((r: any) => r.region)).toEqual(["Rajshahi"]);
    expect(m.holdoutSpendDetected).toBe(true);
    expect(m.holdoutSpendNote).toContain("Delivery থামায় না");
  });

  it("no stored rows → groups are zero, the difference is null (never an invented lift), and the method label rides along", async () => {
    const { svc } = setup();
    await svc.createGeoHoldout("org", "u1", "plan-1", dto);
    const out = await svc.getGeoHoldout("org", "plan-1");
    expect(out.measurement.available).toBe(true);
    expect(out.measurement.groups.test.conversions).toBe(0);
    expect(out.measurement.observedDifferencePer1000).toBeNull();
    expect(out.measurement.holdoutSpendDetected).toBe(false);
    expect(out.method).toContain("observational");
  });

  it("no definition → honest unavailable; ending a definition keeps the measurement readable and frees the slot", async () => {
    const { tables, svc, auditCalls } = setup();
    const none = await svc.getGeoHoldout("org", "plan-1");
    expect(none.available).toBe(false);
    expect(none.holdout).toBeNull();
    const created = await svc.createGeoHoldout("org", "u1", "plan-1", dto);
    const ended = await svc.endGeoHoldout("org", "u1", "plan-1", created.holdout.id);
    expect(ended.holdout.status).toBe("ended");
    expect(ended.measurement.available).toBe(true);
    expect(auditCalls.find((a: any) => a.action === "campaign.geo_holdout_ended")).toBeTruthy();
    await expect(svc.endGeoHoldout("org", "u1", "plan-1", created.holdout.id)).rejects.toThrow(/আগেই শেষ/);
    // a new definition can now be created
    const again = await svc.createGeoHoldout("org", "u1", "plan-1", dto);
    expect(again.holdout.status).toBe("active");
    expect(tables.planGeoHoldout.rows).toHaveLength(2);
  });

  it("an unpublished plan keeps the definition but reports measurement unavailable", async () => {
    const { tables, svc } = setup();
    tables.campaignPlan.rows[0].status = "draft";
    tables.campaignPlan.rows[0].externalCampaignId = null;
    const out = await svc.createGeoHoldout("org", "u1", "plan-1", dto);
    expect(out.holdout.status).toBe("active");
    expect(out.measurement.available).toBe(false);
    expect(out.measurement.reason).toContain("Publish হয়নি");
  });
});
