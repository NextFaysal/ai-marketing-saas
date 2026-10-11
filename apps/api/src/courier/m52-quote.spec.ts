process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.DISABLE_SCHEDULER = "true";

import { PathaoClient, PathaoError } from "./pathao.client";
import { RedxClient, RedxError } from "./redx.client";
import { CourierService } from "./courier.service";

/**
 * Milestone 52: pre-booking delivery-charge quotations.
 * Pathao via its documented merchant price-plan endpoint, RedX via
 * its documented charge calculator, Steadfast honestly not
 * quotable (no quote API exists). Every number in these tests
 * comes from the stubbed provider response - never from local math.
 */

const fetchCapture = (responder: (url: string, init: any) => any) => {
  const calls: { url: string; init: any }[] = [];
  const fn = (async (url: string, init: any = {}) => {
    calls.push({ url: String(url), init });
    const r = responder(String(url), init);
    return { ok: r.ok ?? true, status: r.status ?? 200, statusText: "X", json: async () => r.body };
  }) as any;
  return { fn, calls };
};

describe("PathaoClient.pricePlan (documented price-plan shape)", () => {
  const creds = {
    baseUrl: "https://pathao.test", clientId: "cid", clientSecret: "cs",
    username: "u", password: "p", accessToken: "tok", tokenIssuedAt: Date.now(), expiresIn: 432000,
  };
  it("posts the documented fields and returns final_price as the charge", async () => {
    const { fn, calls } = fetchCapture(() => ({
      body: { code: 200, data: { price: 80, discount: 0, promo_discount: 5, plan_id: 69, cod_enabled: 1, cod_percentage: 0.01, additional_charge: 10, final_price: 85 } },
    }));
    const client = new PathaoClient(creds, fn);
    const plan = await client.pricePlan({ store_id: 11, item_type: 2, delivery_type: 48, item_weight: 1.5, recipient_city: 1, recipient_zone: 22 });
    expect(calls[0].url).toContain("/aladdin/api/v1/merchant/price-plan");
    const sent = JSON.parse(calls[0].init.body);
    expect(sent).toEqual({ store_id: 11, item_type: 2, delivery_type: 48, item_weight: 1.5, recipient_city: 1, recipient_zone: 22 });
    expect(plan.finalPrice).toBe(85);
    expect(plan.price).toBe(80);
    expect(plan.promoDiscount).toBe(5);
    expect(plan.codEnabled).toBe(true);
    expect(plan.planId).toBe(69);
  });
  it("refuses a response without final_price instead of guessing", async () => {
    const { fn } = fetchCapture(() => ({ body: { code: 200, data: { price: 80 } } }));
    const client = new PathaoClient(creds, fn);
    await expect(client.pricePlan({ store_id: 1, item_type: 2, delivery_type: 48, item_weight: 0.5, recipient_city: 1, recipient_zone: 1 }))
      .rejects.toBeInstanceOf(PathaoError);
  });
  it("surfaces Pathao's own validation message verbatim", async () => {
    const { fn } = fetchCapture(() => ({ ok: false, status: 422, body: { message: "The recipient zone field is required.", errors: { recipient_zone: ["required"] } } }));
    const client = new PathaoClient(creds, fn);
    await expect(client.pricePlan({ store_id: 1, item_type: 2, delivery_type: 48, item_weight: 0.5, recipient_city: 1, recipient_zone: 1 }))
      .rejects.toThrow("The recipient zone field is required.");
  });
});

describe("RedxClient.calculateCharge (documented charge calculator)", () => {
  it("posts grams + collection amount and normalizes the returned charges", async () => {
    const { fn, calls } = fetchCapture(() => ({ body: { data: { delivery_charge: "55.50", cod_charge: 10, total_charge: 65.5 } } }));
    const client = new RedxClient({ baseUrl: "https://redx.test", accessToken: "t" }, fn);
    const charge = await client.calculateCharge({ delivery_area_id: 42, pickup_area_id: 7, cash_collection_amount: 2000, weight: 500 });
    expect(calls[0].url).toContain("/charge/charge_calculator");
    const sent = JSON.parse(calls[0].init.body);
    expect(sent).toEqual({ delivery_area_id: 42, pickup_area_id: 7, cash_collection_amount: 2000, weight: 500 });
    expect(charge).toEqual({ deliveryCharge: 55.5, codCharge: 10, totalCharge: 65.5 });
  });
  it("omits pickup_area_id when not provided and refuses a charge-less response", async () => {
    const { fn, calls } = fetchCapture(() => ({ body: { data: {} } }));
    const client = new RedxClient({ baseUrl: "https://redx.test", accessToken: "t" }, fn);
    await expect(client.calculateCharge({ delivery_area_id: 1, cash_collection_amount: 0, weight: 500 }))
      .rejects.toBeInstanceOf(RedxError);
    expect(JSON.parse(calls[0].init.body)).not.toHaveProperty("pickup_area_id");
  });
});

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(row[k]);
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
    findFirst: async (args: any = {}) => rows.find((r) => matches(r, args.where ?? {})) ?? null,
    findMany: async (args: any = {}) => rows.filter((r) => matches(r, args.where ?? {})),
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => matches(r, where ?? {})); if (row) Object.assign(row, data); return row ?? null; },
  };
}

describe("CourierService.quote (M52)", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  function setup() {
    const tables: Record<string, any> = {};
    for (const n of ["integration", "integrationCredential", "order", "customer", "courierShipment"]) tables[n] = makeTable(n);
    const origFindFirst = tables.integration.findFirst;
    tables.integration.findFirst = async (args: any) => {
      const row = await origFindFirst(args);
      if (row && args?.include?.credential) {
        const cred = tables.integrationCredential.rows.find((c: any) => c.integrationId === row.id);
        return { ...row, credential: cred ?? null };
      }
      return row;
    };
    tables.order.rows.push({ id: "ord-1", organizationId: "org-1", isCod: true, totalMinor: 200000n });
    const svc = new CourierService(tables as any, { log: async () => undefined } as any, undefined);
    return { tables, svc };
  }

  function stubProviders(opts: { pricePlanFails?: boolean } = {}) {
    global.fetch = (async (url: string) => {
      const u = String(url);
      if (u.includes("/get_balance")) return { ok: true, status: 200, json: async () => ({ status: 200, current_balance: 10 }) };
      if (u.includes("/issue-token")) return { ok: true, status: 200, json: async () => ({ access_token: "tok", refresh_token: "ref", expires_in: 432000 }) };
      if (u.includes("/stores")) return { ok: true, status: 200, json: async () => ({ data: { data: [{ store_id: 77, is_active: 1 }] } }) };
      if (u.includes("/merchant/price-plan")) {
        return opts.pricePlanFails
          ? { ok: false, status: 422, statusText: "Unprocessable", json: async () => ({ message: "Invalid price plan for this store" }) }
          : { ok: true, status: 200, json: async () => ({ code: 200, data: { price: 80, discount: 0, promo_discount: 0, plan_id: 69, cod_enabled: 1, cod_percentage: 0.01, additional_charge: 0, final_price: 80 } }) };
      }
      if (u.includes("/areas")) return { ok: true, status: 200, json: async () => ({ areas: [{ id: 1, name: "Dhaka" }] }) };
      if (u.includes("/charge/charge_calculator")) return { ok: true, status: 200, json: async () => ({ data: { delivery_charge: 60, cod_charge: 20, total_charge: 80 } }) };
      throw new Error("unexpected url " + u);
    }) as any;
  }

  it("steadfast: connected but honestly not quotable - no number is returned", async () => {
    const { svc } = setup();
    stubProviders();
    await svc.connect("org-1", "owner", { apiKey: "k", secretKey: "s" });
    const out: any = await svc.quote("org-1", { provider: "steadfast" });
    expect(out.quotable).toBe(false);
    expect(out.chargeMinor).toBeNull();
    expect(out.reason).toMatch(/বুকিংয়ের পরে চার্জ জানা যাবে/);
  });

  it("an unconnected provider refuses with the connect-first error", async () => {
    const { svc } = setup();
    stubProviders();
    await expect(svc.quote("org-1", { provider: "pathao", pathao: { cityId: 1, zoneId: 2 } })).rejects.toThrow(/যুক্ত নেই/);
  });

  it("pathao: quote comes from the price-plan API (final_price), store defaults like booking", async () => {
    const { svc, tables } = setup();
    stubProviders();
    await svc.connect("org-1", "owner", { provider: "pathao", clientId: "cid", clientSecret: "cs", username: "u@x.com", password: "pw" });
    const out: any = await svc.quote("org-1", { provider: "pathao", weightKg: 1, pathao: { cityId: 1, zoneId: 22 } });
    expect(out).toMatchObject({ quotable: true, chargeMinor: 8000, currency: "BDT", source: "pathao_price_plan" });
    expect(out.detail.finalPriceBdt).toBe(80);
    expect(out.detail.storeId).toBe(77); // first active store, same defaulting as bookShipment
    expect(tables.courierShipment.rows).toHaveLength(0); // a quote never saves a shipment
  });

  it("pathao: missing city/zone is a clear 400, and a provider failure surfaces verbatim saving nothing", async () => {
    const { svc, tables } = setup();
    stubProviders({ pricePlanFails: true });
    await svc.connect("org-1", "owner", { provider: "pathao", clientId: "cid", clientSecret: "cs", username: "u@x.com", password: "pw" });
    await expect(svc.quote("org-1", { provider: "pathao", pathao: {} })).rejects.toThrow(/শহর ও জোন/);
    await expect(svc.quote("org-1", { provider: "pathao", pathao: { cityId: 1, zoneId: 2 } })).rejects.toThrow("Invalid price plan for this store");
    expect(tables.courierShipment.rows).toHaveLength(0);
  });

  it("redx: quote comes from the charge calculator with grams + the order's COD amount", async () => {
    const { svc } = setup();
    stubProviders();
    await svc.connect("org-1", "owner", { provider: "redx", accessToken: "tok" });
    const out: any = await svc.quote("org-1", { provider: "redx", orderId: "ord-1", weightKg: 0.5, redx: { deliveryAreaId: 42 } });
    expect(out).toMatchObject({ quotable: true, chargeMinor: 8000, source: "redx_charge_calculator" });
    expect(out.detail).toMatchObject({ deliveryChargeBdt: 60, codChargeBdt: 20, totalChargeBdt: 80, weightGrams: 500 });
  });
});
