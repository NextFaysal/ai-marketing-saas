import { CampaignsService } from "./campaigns.service";
import { CampaignsController } from "./campaigns.controller";
import { AudiencesService } from "../audiences/audiences.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * DX3 🚩 mini-fix — the org-level CN6 source catalogue
 * (GET campaign-plans/audience-sources). The 🚩 (see
 * docs/campaign-design-dx3-acceptance.md): the CN16
 * funnel wizard needs the Audience Studio's real source
 * counts at layer-selection time, when no plan exists
 * yet, but sourceCatalog's only HTTP exposure was the
 * plan-scoped studio. This spec pins the fix: the new
 * endpoint returns the IDENTICAL sources array the
 * studio embeds (same AudiencesService.sourceCatalog
 * computation over real rows — no second counting),
 * org-isolated, with the studio's honest empty-source
 * semantics unchanged, and the honest unavailable state
 * when AudiencesService is not wired.
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
    groupBy: async ({ by, where }: any) => {
      const f = rows.filter((r) => matches(r, where ?? {}));
      const groups = new Map<string, any[]>();
      for (const r of f) { const k = r[by[0]]; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(r); }
      return [...groups.entries()].map(([k, g]) => ({
        [by[0]]: k, _count: { _all: g.length },
        _sum: { totalMinor: g.reduce((a, r) => a + BigInt(r.totalMinor ?? 0), 0n) },
        _max: { placedAt: g.reduce((a, r) => (r.placedAt && (!a || r.placedAt > a) ? r.placedAt : a), null), createdAt: g.reduce((a, r) => (r.createdAt && (!a || r.createdAt > a) ? r.createdAt : a), null) },
      }));
    },
  };
}
const day = 86_400_000;

function setup(withAudiences = true) {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "integration", "product", "dailyAdMetric", "audienceRecord", "customer", "lead", "order", "trackingEvent", "visitor", "abandonedStoreCheckout", "catalogRecord", "productSet", "leadForm", "customFieldDef", "conversionApiSetting", "conversionEventLog"]) tables[n] = makeTable(n);
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", externalId: "act_777", name: "Main", currency: "BDT", integrationId: "int-1" });
  const audit = { log: async () => undefined } as any;
  const audiences = withAudiences ? new AudiencesService(tables as any, audit) : undefined;
  const svc = new CampaignsService(tables as any, audit, { getProvider: () => new DevTemplateProvider() } as any, {} as any, audiences);
  return { tables, svc };
}

function seed(tables: any) {
  const now = Date.now();
  tables.customer.rows.push(
    { id: "c1", organizationId: "org", email: "a@x.com", phone: "01710000001", mergedIntoId: null },
    { id: "c2", organizationId: "org", email: "b@x.com", phone: null, mergedIntoId: null },
    { id: "c3", organizationId: "org", email: "c@x.com", phone: null, mergedIntoId: null },
    { id: "c9", organizationId: "org2", email: "z@x.com", phone: null, mergedIntoId: null },
  );
  tables.order.rows.push(
    { id: "o1", organizationId: "org", customerId: "c1", status: "completed", isPractice: false, totalMinor: 5000n, placedAt: new Date(now - 3 * day), createdAt: new Date(now - 3 * day) },
    { id: "o2", organizationId: "org", customerId: "c2", status: "completed", isPractice: false, totalMinor: 7000n, placedAt: new Date(now - 40 * day), createdAt: new Date(now - 40 * day) },
    // A cancelled-only customer never counts as a buyer.
    { id: "o3", organizationId: "org", customerId: "c3", status: "cancelled", isPractice: false, totalMinor: 1000n, placedAt: new Date(now - 1 * day), createdAt: new Date(now - 1 * day) },
    { id: "o9", organizationId: "org2", customerId: "c9", status: "completed", isPractice: false, totalMinor: 9000n, placedAt: new Date(now - 1 * day), createdAt: new Date(now - 1 * day) },
  );
  // Two product views by one identified visitor + one by
  // an anonymous visitor (no email/phone) → viewers = 1.
  tables.trackingEvent.rows.push(
    { id: "e1", organizationId: "org", type: "product_view", visitorId: "v1" },
    { id: "e2", organizationId: "org", type: "product_view", visitorId: "v1" },
    { id: "e3", organizationId: "org", type: "product_view", visitorId: "v2" },
  );
  tables.visitor.rows.push(
    { id: "v1", organizationId: "org", email: "view@x.com", phone: null },
    { id: "v2", organizationId: "org", email: null, phone: null },
  );
  tables.abandonedStoreCheckout.rows.push(
    { id: "co1", organizationId: "org", status: "open", email: "drop@x.com", phone: null },
    { id: "co2", organizationId: "org", status: "recovered", email: "back@x.com", phone: null },
    { id: "co9", organizationId: "org2", status: "open", email: "other@x.com", phone: null },
  );
}

const byKey = (sources: any[], key: string) => sources.find((s: any) => s.key === key);

describe("DX3 🚩 mini-fix — org-level audience source catalogue", () => {
  it("returns REAL counts computed from orders / tracker events / open checkouts", async () => {
    const { tables, svc } = setup();
    seed(tables);
    const out: any = await svc.audienceSourceCatalog("org");
    expect(out.available).toBe(true);
    expect(byKey(out.sources, "buyers").contactCount).toBe(2); // c3 (cancelled only) is not a buyer
    expect(byKey(out.sources, "recent_purchasers_30").contactCount).toBe(1);
    expect(byKey(out.sources, "product_viewers").contactCount).toBe(1); // anonymous visitor v2 cannot be counted
    expect(byKey(out.sources, "cart_abandoners").contactCount).toBe(1); // the recovered checkout is not open
  });

  it("returns the IDENTICAL sources array the plan-scoped studio embeds (one computation)", async () => {
    const { tables, svc } = setup();
    seed(tables);
    const plan: any = await svc.createPlan("org", "creator", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
    const studio: any = await svc.audienceStudio("org", plan.id);
    const orgLevel: any = await svc.audienceSourceCatalog("org");
    expect(orgLevel.sources).toEqual(studio.sources);
  });

  it("is org-isolated — the other org's rows never enter the counts", async () => {
    const { tables, svc } = setup();
    seed(tables);
    const other: any = await svc.audienceSourceCatalog("org2");
    expect(byKey(other.sources, "buyers").contactCount).toBe(1);
    expect(byKey(other.sources, "cart_abandoners").contactCount).toBe(1);
    expect(byKey(other.sources, "product_viewers").contactCount).toBe(0);
    const own: any = await svc.audienceSourceCatalog("org");
    expect(byKey(own.sources, "buyers").contactCount).toBe(2);
  });

  it("keeps the studio's honest empty-source semantics (zero = zero, stated reason)", async () => {
    const { svc } = setup();
    const out: any = await svc.audienceSourceCatalog("empty-org");
    expect(out.available).toBe(true);
    for (const key of ["buyers", "product_viewers", "cart_abandoners"]) {
      const s = byKey(out.sources, key);
      expect(s.contactCount).toBe(0);
      expect(s.available).toBe(false);
      expect(s.reason).toBe("এই Source-এ Email/Phone-সহ কোনো Contact পাওয়া যায়নি");
    }
  });

  it("reports the honest unavailable state when AudiencesService is not wired", async () => {
    const { svc } = setup(false);
    const out: any = await svc.audienceSourceCatalog("org");
    expect(out).toEqual({ available: false, reason: "AudiencesService এই Deployment-এ যুক্ত নেই", sources: [] });
  });

  it("the controller route delegates to the same service payload", async () => {
    const { tables, svc } = setup();
    seed(tables);
    const controller = new CampaignsController(svc, {} as any);
    const viaRoute: any = await controller.audienceSources("org");
    const direct: any = await svc.audienceSourceCatalog("org");
    expect(viaRoute).toEqual(direct);
    expect(byKey(viaRoute.sources, "buyers").contactCount).toBe(2);
  });
});
