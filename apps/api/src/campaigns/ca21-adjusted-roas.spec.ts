import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder Advanced CA21 (CB5): COD
 * return-adjusted ROAS. LINKAGE FINDING pinned here:
 * Order carries NO campaign id — the two real linkages
 * are (1) AttributionCredit → touchpoint.campaign =
 * plan (the join planPerformance already uses) and
 * (2) the AB7 utm stamps on the order itself, matched
 * against the utm values THIS plan's ads emit with the
 * platform source checked. Adjusted revenue counts only
 * delivered COD orders (EC33 isSoldOrder), net of each
 * order's refundedMinor; returned orders (raw status or
 * a received/completed ReturnRequest) never enter gross.
 * The raw figure is carried beside the adjusted one —
 * never replaced.
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
    findMany: async ({ where, take }: any = {}) => { const f = rows.filter((r) => matches(r, where ?? {})); return take ? f.slice(0, take) : f; },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
  };
}
const NOW = new Date("2026-10-20T12:00:00.000Z");
const PUBLISHED = new Date("2026-10-01T00:00:00.000Z");

function setup() {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "organization", "dailyAdMetric", "order", "returnRequest", "courierShipment", "attributionCredit", "touchpoint"]) tables[n] = makeTable(n);
  tables.organization.rows.push({ id: "org", timezone: "Asia/Dhaka", attributionWindowDays: 30 });
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", externalId: "act_777", currency: "BDT", integrationId: "int-1" });
  const audit = { log: async () => undefined } as any;
  const svc: any = new CampaignsService(tables as any, audit, { getProvider: () => new DevTemplateProvider() } as any);
  return { tables, svc };
}

function plan(tables: any, id: string, ext: string | null, name = "Eid Sale Campaign") {
  tables.campaignPlan.rows.push({
    id, organizationId: "org", adAccountId: "acc-1", name, objective: "OUTCOME_SALES",
    status: ext ? "published" : "draft", externalCampaignId: ext, metaStatus: "ACTIVE", budgetMode: "abo",
    createdById: "u1", publishedAt: ext ? PUBLISHED : null, createdAt: new Date("2026-09-28T00:00:00Z"),
  });
}
function metric(tables: any, ext: string, date: Date, spend: bigint, adSetExternalId = "") {
  tables.dailyAdMetric.rows.push({ id: `m-${tables.dailyAdMetric.rows.length + 1}`, organizationId: "org", campaignExternalId: ext, adSetExternalId, adExternalId: "", date, spendMinor: spend });
}
function order(tables: any, o: any) {
  tables.order.rows.push({ organizationId: "org", isPractice: false, isCod: true, paymentMethod: "cod", refundedMinor: 0n, placedAt: new Date("2026-10-05T00:00:00Z"), createdAt: new Date("2026-10-05T00:00:00Z"), ...o });
}
const STAMP = { utmCampaign: "eid-sale-campaign", utmSource: "facebook" };

function seedMain(tables: any) {
  plan(tables, "plan-1", "camp-1");
  metric(tables, "camp-1", new Date("2026-10-03T00:00:00Z"), 30000n);
  metric(tables, "camp-1", new Date("2026-10-10T00:00:00Z"), 20000n);
  metric(tables, "camp-1", new Date("2026-10-10T00:00:00Z"), 99900n, "set-ext"); // ad-set row — excluded
  metric(tables, "camp-1", new Date("2026-09-01T00:00:00Z"), 77700n); // before publish — excluded from window spend
  order(tables, { id: "o-1", ...STAMP, status: "completed", totalMinor: 100000n });
  order(tables, { id: "o-2", ...STAMP, status: "processing", totalMinor: 50000n, refundedMinor: 10000n });
  tables.courierShipment.rows.push({ id: "sh-2", organizationId: "org", orderId: "o-2", status: "delivered" });
  order(tables, { id: "o-3", ...STAMP, status: "returned", totalMinor: 70000n });
  order(tables, { id: "o-4", status: "delivered", totalMinor: 20000n }); // credit-linked only (no utm)
  tables.touchpoint.rows.push({ id: "tp-1", organizationId: "org", campaign: "Eid Sale Campaign" });
  tables.attributionCredit.rows.push({ id: "cr-1", organizationId: "org", touchpointId: "tp-1", orderId: "o-4", revenueMinor: 20000n, createdAt: new Date("2026-10-06T00:00:00Z") });
  order(tables, { id: "o-5", utmCampaign: "eid-sale-campaign", utmSource: "google", status: "completed", totalMinor: 111000n }); // wrong source — excluded
  order(tables, { id: "o-6", ...STAMP, status: "completed", totalMinor: 222000n, placedAt: new Date("2026-09-15T00:00:00Z") }); // before window — excluded
  order(tables, { id: "o-7", ...STAMP, status: "completed", totalMinor: 90000n, isCod: false, paymentMethod: "sslcommerz" }); // non-COD — coverage only
  order(tables, { id: "o-8", ...STAMP, status: "processing", totalMinor: 45000n }); // not sold (no delivery proof)
  order(tables, { id: "o-9", ...STAMP, status: "completed", totalMinor: 333000n, isPractice: true }); // practice — excluded entirely
  order(tables, { id: "o-10", ...STAMP, status: "delivered", totalMinor: 30000n });
  tables.returnRequest.rows.push({ id: "rr-1", organizationId: "org", orderId: "o-10", status: "completed" });
}

describe("CA21 planAdjustedRoas", () => {
  it("unions both linkages, subtracts refunds per delivered order, and excludes returns from gross entirely", async () => {
    const { tables, svc } = setup();
    seedMain(tables);
    const out = await svc.planAdjustedRoas("org", "plan-1", NOW);
    expect(out.available).toBe(true);
    expect(out.spendMinor).toBe("50000");
    expect(out.matchedOrders).toBe(7);        // o-1,o-2,o-3,o-4,o-7,o-8,o-10
    expect(out.codMatchedOrders).toBe(6);     // o-7 is non-COD
    expect(out.nonCodMatchedOrders).toBe(1);
    expect(out.deliveredOrders).toBe(3);      // o-1, o-2 (courier-delivered), o-4
    expect(out.returnedOrders).toBe(2);       // o-3 (status), o-10 (ReturnRequest)
    expect(out.grossRevenueMinor).toBe("170000");
    expect(out.refundedMinor).toBe("10000");
    expect(out.returnedValueMinor).toBe("100000"); // 70000 + 30000
    expect(out.adjustedRevenueMinor).toBe("160000"); // 100000 + (50000-10000) + 20000
    expect(out.rawRoas).toBe(3.4);
    expect(out.adjustedRoas).toBe(3.2);
    expect(out.coverage.viaUtmStamp).toBe(6);
    expect(out.coverage.viaAttributionCredit).toBe(1);
    expect(out.coverage.expectedSource).toBe("facebook");
    expect(out.scope).toContain("Click-Attribution নয়");
    expect(out.definitions.adjusted).toContain("refundedMinor");
  });

  it("carries the existing first-party (raw) figure beside the adjusted one — never replaces it", async () => {
    const { tables, svc } = setup();
    seedMain(tables);
    const out = await svc.planAdjustedRoas("org", "plan-1", NOW);
    expect(out.existingFirstParty).toBeTruthy();
    expect(out.existingFirstParty.revenueMinor).toBe("20000"); // the credit's revenueMinor, as planPerformance sums it
    expect(out.existingFirstParty.note).toContain("প্রতিস্থাপন করে না");
  });

  it("zero stored spend → revenues still real, ROAS null with the stated reason (never a divide-by-zero number)", async () => {
    const { tables, svc } = setup();
    plan(tables, "plan-2", "camp-2", "Zero Spend Plan");
    order(tables, { id: "z-1", utmCampaign: "zero-spend-plan", utmSource: "facebook", status: "completed", totalMinor: 40000n });
    const out = await svc.planAdjustedRoas("org", "plan-2", NOW);
    expect(out.available).toBe(true);
    expect(out.spendMinor).toBe("0");
    expect(out.adjustedRevenueMinor).toBe("40000");
    expect(out.rawRoas).toBeNull();
    expect(out.adjustedRoas).toBeNull();
    expect(out.zeroSpendNote).toContain("ROAS হিসাব হয় না");
  });

  it("no linked orders → honest unavailable with coverage; an unpublished plan says so", async () => {
    const { tables, svc } = setup();
    plan(tables, "plan-3", "camp-3", "Lonely Plan");
    const out = await svc.planAdjustedRoas("org", "plan-3", NOW);
    expect(out.available).toBe(false);
    expect(out.reason).toContain("আন্দাজে");
    expect(out.coverage.viaUtmStamp).toBe(0);
    plan(tables, "plan-4", null, "Draft Plan");
    const draft = await svc.planAdjustedRoas("org", "plan-4", NOW);
    expect(draft.available).toBe(false);
    expect(draft.reason).toContain("Publish হয়নি");
  });

  it("a same-named plan in another org never leaks: stamped orders are org-scoped", async () => {
    const { tables, svc } = setup();
    seedMain(tables);
    tables.order.rows.push({ id: "o-foreign", organizationId: "other", ...STAMP, status: "completed", totalMinor: 999000n, isCod: true, paymentMethod: "cod", refundedMinor: 0n, isPractice: false, placedAt: new Date("2026-10-05T00:00:00Z"), createdAt: new Date("2026-10-05T00:00:00Z") });
    const out = await svc.planAdjustedRoas("org", "plan-1", NOW);
    expect(out.matchedOrders).toBe(7);
    expect(out.grossRevenueMinor).toBe("170000");
  });
});
