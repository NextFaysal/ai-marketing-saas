process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
import { AudiencesService } from "./audiences.service";
import { encryptJson } from "../integrations/crypto";

/**
 * Campaign Builder Next CN6: the Audience Studio sources
 * gather REAL first-party contacts through the existing
 * AudiencesService — buyers / recent purchasers from Order
 * rows (cancelled/refunded/failed/practice never count),
 * product viewers from tracker events joined to identified
 * Visitors, cart abandoners from EC10's open abandoned
 * checkouts — and createCustom uploads them through the
 * same Meta path as every other source. Empty sources
 * refuse honestly; the catalogue reports real counts.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("notIn" in v) return !(v as any).notIn.includes(row[k]);
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
function setup() {
  const tables: any = {};
  for (const n of ["customer", "lead", "audienceRecord", "order", "trackingEvent", "visitor", "abandonedStoreCheckout", "adAccount", "integration", "integrationCredential"]) tables[n] = makeTable(n);
  tables.integration.rows.push({ id: "int-1", organizationId: "org", provider: "meta", status: "CONNECTED", credential: { encryptedData: encryptJson({ accessToken: "tok-123" }) } });
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", externalId: "act_777", integrationId: "int-1" });
  const svc = new AudiencesService(tables as any, { log: async () => undefined } as any);
  return { tables, svc };
}
const day = 86_400_000;
function seedShoppers(t: any) {
  t.customer.rows.push(
    { id: "c1", organizationId: "org", email: "a@x.com", phone: "01710000001", mergedIntoId: null, firstName: "A" },
    { id: "c2", organizationId: "org", email: "b@x.com", phone: null, mergedIntoId: null, firstName: "B" },
    { id: "c3", organizationId: "org", email: null, phone: null, mergedIntoId: null, firstName: "C" },
    { id: "c4", organizationId: "org", email: "d@x.com", phone: null, mergedIntoId: null, firstName: "D" },
  );
  const now = Date.now();
  t.order.rows.push(
    { id: "o1", organizationId: "org", customerId: "c1", status: "completed", isPractice: false, totalMinor: 5000n, placedAt: new Date(now - 5 * day), createdAt: new Date(now - 5 * day) },
    { id: "o2", organizationId: "org", customerId: "c2", status: "completed", isPractice: false, totalMinor: 9000n, placedAt: new Date(now - 80 * day), createdAt: new Date(now - 80 * day) },
    { id: "o3", organizationId: "org", customerId: "c3", status: "cancelled", isPractice: false, totalMinor: 1000n, placedAt: new Date(now - 2 * day), createdAt: new Date(now - 2 * day) },
    { id: "o4", organizationId: "org", customerId: "c4", status: "completed", isPractice: true, totalMinor: 1000n, placedAt: new Date(now - 1 * day), createdAt: new Date(now - 1 * day) },
    { id: "o5", organizationId: "org", customerId: "c4", status: "refunded", isPractice: false, totalMinor: 1000n, placedAt: new Date(now - 1 * day), createdAt: new Date(now - 1 * day) },
  );
}
const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });
function metaOk() {
  const calls: { url: string; body: string }[] = [];
  (global as any).fetch = async (url: string, init: any) => {
    calls.push({ url: String(url), body: String(init?.body ?? "") });
    if (String(url).includes("/customaudiences") && !String(url).includes("/users")) return { ok: true, status: 200, json: async () => ({ id: "aud-meta-1" }) };
    if (String(url).includes("/users")) return { ok: true, status: 200, json: async () => ({ num_received: 1 }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return calls;
}

describe("CN6 audience studio sources", () => {
  it("buyers = customers with a revenue-bearing order (cancelled/practice/refunded excluded)", async () => {
    const { tables, svc } = setup(); seedShoppers(tables); metaOk();
    const rec: any = await svc.createCustom("org", "u1", { adAccountId: "acc-1", name: "Buyers", source: "buyers" });
    expect(rec.externalAudienceId).toBe("aud-meta-1");
    expect(rec.source).toBe("buyers");
    // c1 + c2 uploaded (2 batches of 1 contact each in this stub's count); c3 (cancelled only) and c4 (practice/refunded) never counted.
    const cat = await svc.sourceCatalog("org");
    expect(cat.find((c) => c.key === "buyers")?.contactCount).toBe(2);
  });

  it("recent_purchasers honours the window and refuses an unknown window", async () => {
    const { tables, svc } = setup(); seedShoppers(tables);
    const cat = await svc.sourceCatalog("org");
    expect(cat.find((c) => c.key === "recent_purchasers_30")?.contactCount).toBe(1); // only c1 (5 days)
    expect(cat.find((c) => c.key === "recent_purchasers_90")?.contactCount).toBe(2); // c1 + c2 (80 days)
    await expect(svc.createCustom("org", "u1", { adAccountId: "acc-1", name: "X", source: "recent_purchasers", segment: "7" })).rejects.toThrow(/window/);
  });

  it("product_viewers come from tracker events joined to identified visitors only", async () => {
    const { tables, svc } = setup();
    tables.visitor.rows.push(
      { id: "v1", organizationId: "org", email: "view@x.com", phone: null },
      { id: "v2", organizationId: "org", email: null, phone: null },
      { id: "v3", organizationId: "org", email: "cart@x.com", phone: null },
    );
    tables.trackingEvent.rows.push(
      { id: "e1", organizationId: "org", type: "product_view", visitorId: "v1" },
      { id: "e2", organizationId: "org", type: "product_view", visitorId: "v2" },
      { id: "e3", organizationId: "org", type: "add_to_cart", visitorId: "v3" },
      { id: "e4", organizationId: "org", type: "product_view", visitorId: "v1" },
    );
    const cat = await svc.sourceCatalog("org");
    const pv = cat.find((c) => c.key === "product_viewers");
    expect(pv?.contactCount).toBe(1); // v1 once; v2 has no contact data; add_to_cart is not a view
    expect(pv?.available).toBe(true);
  });

  it("cart_abandoners come from OPEN abandoned checkouts only", async () => {
    const { tables, svc } = setup();
    tables.abandonedStoreCheckout.rows.push(
      { id: "a1", organizationId: "org", status: "open", email: "open@x.com", phone: null },
      { id: "a2", organizationId: "org", status: "recovered", email: "rec@x.com", phone: null },
      { id: "a3", organizationId: "org", status: "open", email: null, phone: null },
    );
    const cat = await svc.sourceCatalog("org");
    expect(cat.find((c) => c.key === "cart_abandoners")?.contactCount).toBe(1);
  });

  it("an empty source refuses creation honestly and the catalogue says why", async () => {
    const { svc } = setup();
    await expect(svc.createCustom("org", "u1", { adAccountId: "acc-1", name: "Buyers", source: "buyers" })).rejects.toMatchObject({ code: "audiences.noContactsWithAnEmailOr" });
    const cat = await svc.sourceCatalog("org");
    const buyers = cat.find((c) => c.key === "buyers");
    expect(buyers?.available).toBe(false);
    expect(buyers?.contactCount).toBe(0);
    expect(buyers?.reason).toBeTruthy();
  });

  it("membership refresh works for a studio source (stored source + window re-gathered)", async () => {
    const { tables, svc } = setup(); seedShoppers(tables); metaOk();
    const rec: any = await svc.createCustom("org", "u1", { adAccountId: "acc-1", name: "Recent 30", source: "recent_purchasers", segment: "30" });
    const refreshed: any = await svc.refreshMembership("org", "u1", rec.id);
    expect(refreshed.uploaded).toBe(1);
    expect(refreshed.lastMembershipCount).toBe(1);
  });
});
