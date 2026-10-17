process.env.ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
import "reflect-metadata";
import { CourierService } from "./courier.service";
import {
  COURIER_PROVIDERS, COURIER_STATUSES, courierAdapter, createCourierClient,
} from "./courier-client";
import { SteadfastClient } from "./steadfast.client";
import { PathaoClient } from "./pathao.client";
import { RedxClient } from "./redx.client";
import { EcourierClient, mapEcourierStatus } from "./ecourier.client";
import { PaperflyDevAdapterClient } from "./paperfly.client";
import { encryptJson } from "../integrations/crypto";

/**
 * GB5 — GC13 adapter framework + eCourier + GC14 ops.
 * Fetch-stubbed throughout; no live provider is ever called.
 */

const audit = { log: async () => undefined } as any;

function jsonRes(body: any, status = 200) {
  return {
    ok: status >= 200 && status < 300, status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as any;
}

function table(name: string, rows: any[] = []) {
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => Object.entries(where ?? {}).every(([k, v]) => {
      if (v && typeof v === "object") return true;
      return r[k] === v;
    })) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => Object.entries(where ?? {}).every(([k, v]) => r[k] === v)),
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id || r.integrationId === where.integrationId);
      if (row) Object.assign(row, data);
      return row;
    },
  };
}

function servicePrisma() {
  const prisma: any = {
    integration: table("integration"), integrationCredential: table("cred"),
    order: table("order"), orderItem: table("item"), customer: table("customer"),
    courierShipment: table("shipment"), courierShipmentEvent: table("event"),
  };
  prisma.order.rows.push({ id: "ord-1", organizationId: "org-1", customerId: "cus-1", externalNumber: "1001", isCod: true, totalMinor: 90000n, conversationId: null });
  prisma.customer.rows.push({ id: "cus-1", organizationId: "org-1", firstName: "Karim", lastName: "Uddin", phone: "01712345678" });
  prisma.orderItem.rows.push({ orderId: "ord-1", name: "Panjabi", quantity: 1, totalMinor: 90000n });
  const origFindFirst = prisma.integration.findFirst.bind(prisma.integration);
  prisma.integration.findFirst = async (args: any) => {
    const row = await origFindFirst(args);
    if (!row) return null;
    const cred = prisma.integrationCredential.rows.find((c: any) => c.integrationId === row.id);
    return { ...row, credential: cred ?? row.credential ?? null };
  };
  return prisma;
}

function seedIntegration(prisma: any, provider: string, creds: any) {
  prisma.integration.rows.push({
    id: `int-${provider}`, organizationId: "org-1", provider, status: "CONNECTED",
    credential: { encryptedData: encryptJson(creds) },
  });
}

describe("GB5 registry", () => {
  it("enumerates exactly the buildable providers + the OU6 Paperfly development adapter", () => {
    // GB5 shipped the 4 buildable providers with Paperfly
    // NO-BUILD/absent. OU6 registers Paperfly as a labelled
    // DEVELOPMENT adapter (capabilities.live === false, every
    // operation refuses) — the buildable set is unchanged.
    expect([...COURIER_PROVIDERS]).toEqual(["steadfast", "pathao", "redx", "ecourier", "paperfly"]);
  });

  it("the factory builds each concrete client; unknown providers throw", () => {
    expect(createCourierClient("steadfast", { apiKey: "k", secretKey: "s" })).toBeInstanceOf(SteadfastClient);
    expect(createCourierClient("pathao", { clientId: "c" })).toBeInstanceOf(PathaoClient);
    expect(createCourierClient("redx", { accessToken: "t" })).toBeInstanceOf(RedxClient);
    expect(createCourierClient("ecourier", { apiKey: "k", apiSecret: "s", userId: "u" })).toBeInstanceOf(EcourierClient);
    // OU6: paperfly now builds the DEVELOPMENT adapter client
    // (never a live client — see ou6-courier.spec.ts).
    expect(createCourierClient("paperfly", {})).toBeInstanceOf(PaperflyDevAdapterClient);
    expect(() => createCourierClient("sundarban" as any, {})).toThrow(/Unknown courier provider/);
  });

  it("adapters expose the provider key and the neutral contract", async () => {
    const adapter = courierAdapter("steadfast", new SteadfastClient({ apiKey: "k", secretKey: "s" }));
    expect(adapter.provider).toBe("steadfast");
    expect(typeof adapter.book).toBe("function");
    expect(typeof adapter.statusOf).toBe("function");
  });

  it("the manual-status vocabulary is the internal one", () => {
    expect([...COURIER_STATUSES]).toContain("delivered");
    expect([...COURIER_STATUSES]).toContain("returned");
    expect([...COURIER_STATUSES]).not.toContain("On the way");
  });
});

describe("GB5 eCourier status mapping", () => {
  it("maps the eight statuses evidenced in eCourier's API documents", () => {
    expect(mapEcourierStatus("Initiated")).toBe("pending");
    expect(mapEcourierStatus("Initiated API")).toBe("pending");
    expect(mapEcourierStatus("Picked Up")).toBe("picked_up");
    expect(mapEcourierStatus("In Source Branch")).toBe("in_transit");
    expect(mapEcourierStatus("In Transit")).toBe("in_transit");
    expect(mapEcourierStatus("In Destination Branch")).toBe("in_transit");
    expect(mapEcourierStatus("On the way to Delivery")).toBe("out_for_delivery");
    expect(mapEcourierStatus("Delivered")).toBe("delivered");
  });
  it("free-text extras degrade safely; Return Pending is NOT yet returned", () => {
    expect(mapEcourierStatus("Partial delivered")).toBe("partial_delivered");
    expect(mapEcourierStatus("Cancelled")).toBe("cancelled");
    expect(mapEcourierStatus("Return")).toBe("returned");
    // RTO in flight — must not fire the return side effects.
    expect(mapEcourierStatus("Return Pending")).toBe("in_transit");
    expect(mapEcourierStatus("Something Unheard Of")).toBe("in_transit");
  });
});

describe("GB5 EcourierClient (documented shapes, fetch-stubbed)", () => {
  function clientWith(fetchFn: any) {
    const c = new EcourierClient({ baseUrl: "https://ecourier.example/api", apiKey: "K", apiSecret: "S", userId: "U1" });
    c.fetchImpl = fetchFn;
    return c;
  }

  it("verify POSTs the package list with the documented hyphenated auth headers", async () => {
    let headers: any = null; let method = "";
    const c = clientWith(async (url: string, init: any) => {
      headers = init.headers; method = init.method;
      expect(url).toBe("https://ecourier.example/api/packages");
      return jsonRes({ data: [{ package_code: "P1" }, { package_code: "P2" }] });
    });
    expect((await c.verify()).packages).toBe(2);
    expect(method).toBe("POST"); // every documented operation is a POST
    expect(headers["API-KEY"]).toBe("K");
    expect(headers["API-SECRET"]).toBe("S");
    expect(headers["USER-ID"]).toBe("U1");
  });

  it("placeOrder sends the documented mandatory fields and parses the ECR id", async () => {
    let body: any = null;
    const c = clientWith(async (url: string, init: any) => {
      expect(url).toContain("order-place");
      body = JSON.parse(init.body);
      return jsonRes({ response_code: 200, message: "Order placed", ID: "ECR900" });
    });
    const out = await c.placeOrder({
      recipient_name: "Karim", recipient_mobile: "01712345678", recipient_city: "Dhaka",
      recipient_thana: "Dhanmondi", recipient_area: "Dhanmondi", recipient_address: "House 9, Dhaka",
      recipient_zip: "1205", package_code: "P1", product_price: 900, payment_method: "COD",
    });
    expect(body.recipient_city).toBe("Dhaka");
    expect(body.recipient_thana).toBe("Dhanmondi");
    expect(body.recipient_zip).toBe("1205");
    expect(body.package_code).toBe("P1");
    expect(body.payment_method).toBe("COD");
    expect(body.product_price).toBe(900);
    expect("cod_amount" in body).toBe(false); // the doc has no such field
    expect(out.trackingId).toBe("ECR900");
    expect(out.status).toBe("pending");
  });

  it("placeOrder refuses a response without a tracking id", async () => {
    const c = clientWith(async () => jsonRes({ message: "queued somehow" }));
    await expect(c.placeOrder({
      recipient_name: "K", recipient_mobile: "01712345678", recipient_city: "Dhaka",
      recipient_thana: "Dhanmondi", recipient_area: "Dhanmondi", recipient_address: "House 9",
      recipient_zip: "1205", package_code: "P1", product_price: 1, payment_method: "COD",
    })).rejects.toThrow(/tracking id/);
  });

  it("trackParcel POSTs { ecr } and reads the newest status triple from query_data", async () => {
    let body: any = null;
    const c = clientWith(async (url: string, init: any) => {
      expect(url).toContain("/track");
      body = JSON.parse(init.body);
      return jsonRes({ response_code: 200, query_data: [{ status: [["On the way to Delivery", "", "2026-10-15 10:00"], ["In Transit", "", "2026-10-14 09:00"]] }] });
    });
    const out = await c.trackParcel("ECR900");
    expect(body.ecr).toBe("ECR900");
    expect(out.status).toBe("out_for_delivery");
    expect(out.rawStatus).toBe("On the way to Delivery");
  });

  it("provider errors surface with the provider's own message", async () => {
    const c = clientWith(async () => jsonRes({ message: "Invalid API credentials" }, 401));
    await expect(c.verify()).rejects.toThrow(/Invalid API credentials/);
  });
});

describe("GB5 CourierService — eCourier end to end (stubbed)", () => {
  it("connect verifies via packages BEFORE saving; bad credentials save nothing", async () => {
    const prisma = servicePrisma();
    const svc = new CourierService(prisma, audit);
    (global as any).fetch = async (url: string) => {
      if (url.includes("/packages")) return jsonRes({ data: [{ package_code: "P1" }] });
      return jsonRes({}, 404);
    };
    const conn: any = await svc.connect("org-1", "owner", {
      provider: "ecourier", apiKey: "K", apiSecret: "S", userId: "U1", baseUrl: "https://ecourier.example/api",
    });
    expect(conn.connected).toBe(true);
    expect(prisma.integration.rows.filter((r: any) => r.provider === "ecourier")).toHaveLength(1);

    const prisma2 = servicePrisma();
    const svc2 = new CourierService(prisma2, audit);
    (global as any).fetch = async () => jsonRes({ message: "Invalid API credentials" }, 401);
    await expect(svc2.connect("org-1", "owner", {
      provider: "ecourier", apiKey: "bad", apiSecret: "bad", userId: "U1", baseUrl: "https://ecourier.example/api",
    })).rejects.toThrow(/Invalid API credentials/);
    expect(prisma2.integration.rows.filter((r: any) => r.provider === "ecourier")).toHaveLength(0);
  });

  it("booking requires the documented mandatory fields, stores no charge, writes the booking event", async () => {
    const prisma = servicePrisma();
    seedIntegration(prisma, "ecourier", { baseUrl: "https://ecourier.example/api", apiKey: "K", apiSecret: "S", userId: "U1" });
    const svc = new CourierService(prisma, audit);
    let placeBody: any = null;
    (global as any).fetch = async (url: string, init: any) => {
      if (url.includes("order-place")) { placeBody = JSON.parse(init.body); return jsonRes({ response_code: 200, message: "Order placed", ID: "ECR123" }); }
      return jsonRes({}, 404);
    };
    // Missing thana/zip/package -> refused before any provider call.
    await expect(svc.bookShipment("org-1", "owner", {
      provider: "ecourier", orderId: "ord-1", recipientAddress: "House 9, Road 5, Dhanmondi, Dhaka 1205",
      ecourier: { city: "Dhaka", area: "Dhanmondi" },
    })).rejects.toThrow(/Package Code/);
    const shipment: any = await svc.bookShipment("org-1", "owner", {
      provider: "ecourier", orderId: "ord-1", recipientAddress: "House 9, Road 5, Dhanmondi, Dhaka 1205",
      ecourier: { city: "Dhaka", thana: "Dhanmondi", area: "Dhanmondi", zip: "1205", packageCode: "P1" },
    });
    expect(placeBody.recipient_city).toBe("Dhaka");
    expect(placeBody.recipient_thana).toBe("Dhanmondi");
    expect(placeBody.package_code).toBe("P1");
    expect(placeBody.payment_method).toBe("COD"); // COD order -> documented default
    expect(placeBody.product_price).toBe(900); // the collect amount (no cod_amount field exists)
    expect(shipment.trackingCode).toBe("ECR123");
    expect(shipment.status).toBe("pending");
    // The booking response carries no charge field in the docs.
    const row = prisma.courierShipment.rows.find((r: any) => r.id === shipment.id);
    expect(row.chargeMinor).toBeNull();
    const events = prisma.courierShipmentEvent.rows.filter((e: any) => e.shipmentId === shipment.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "status", status: "pending", source: "booking" });
  });

  it("quote is honestly quotable:false for eCourier (no documented charge call)", async () => {
    const prisma = servicePrisma();
    seedIntegration(prisma, "ecourier", { baseUrl: "https://ecourier.example/api", apiKey: "K", apiSecret: "S", userId: "U1" });
    const svc = new CourierService(prisma, audit);
    const q: any = await svc.quote("org-1", { provider: "ecourier" });
    expect(q.quotable).toBe(false);
    expect(q.chargeMinor).toBeNull();
  });
});

describe("GB5 CourierService — booking charge discipline (GC14 §3)", () => {
  it("Pathao: the booking delivery_fee is stored as chargeMinor; Steadfast: null", async () => {
    const prisma = servicePrisma();
    const svc = new CourierService(prisma, audit);
    (global as any).fetch = async (url: string) => {
      if (url.includes("issue-token")) return jsonRes({ access_token: "at", refresh_token: "rt", expires_in: 432000 });
      if (url.includes("/stores")) return jsonRes({ code: 200, data: { data: [{ store_id: 7, store_name: "Main", is_active: 1 }] } });
      if (url.endsWith("/orders")) return jsonRes({ code: 200, data: { consignment_id: "DL555", order_status: "Pending", delivery_fee: 80 } });
      return jsonRes({}, 404);
    };
    await svc.connect("org-1", "owner", { provider: "pathao", clientId: "cid", clientSecret: "cs", username: "u@x.com", password: "pw", baseUrl: "https://sandbox.example" });
    const shipment: any = await svc.bookShipment("org-1", "owner", {
      provider: "pathao", orderId: "ord-1", recipientAddress: "House 9, Road 5, Dhanmondi, Dhaka 1205",
      pathao: { itemWeightKg: 1 },
    });
    expect(shipment.deliveryFeeMajor).toBe(80); // pre-GB5 response field, unchanged
    expect(shipment.chargeMinor).toBe("8000"); // serialized BigInt
    const row = prisma.courierShipment.rows.find((r: any) => r.id === shipment.id);
    expect(row.chargeMinor).toBe(8000n);
  });
});

describe("GB5 GC14 — event log + manual status through the shared applicator", () => {
  function steadfastSvc() {
    const prisma = servicePrisma();
    seedIntegration(prisma, "steadfast", { apiKey: "k", secretKey: "s" });
    const svc = new CourierService(prisma, audit);
    (global as any).fetch = async (url: string) => {
      if (url.includes("create_order")) return jsonRes({ status: 200, consignment: { consignment_id: 11, tracking_code: "SF1", status: "in_review" } });
      return jsonRes({}, 404);
    };
    return { prisma, svc };
  }

  it("sync writes a transition event with rawStatus; an unchanged poll writes nothing; an error writes an error event", async () => {
    const { prisma, svc } = steadfastSvc();
    const shipment: any = await svc.bookShipment("org-1", "owner", {
      provider: "steadfast", orderId: "ord-1", recipientAddress: "House 9, Road 5, Dhanmondi, Dhaka 1205",
    });
    expect(prisma.courierShipmentEvent.rows).toHaveLength(1); // booking event

    (global as any).fetch = async () => jsonRes({ status: 200, delivery_status: "delivered" });
    const synced: any = await svc.syncShipment("org-1", shipment.id);
    expect(synced.status).toBe("delivered");
    let events = prisma.courierShipmentEvent.rows.filter((e: any) => e.shipmentId === shipment.id);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ kind: "status", status: "delivered", rawStatus: "delivered", source: "api_sync" });

    // Same status again -> no new event.
    await svc.syncShipment("org-1", shipment.id);
    events = prisma.courierShipmentEvent.rows.filter((e: any) => e.shipmentId === shipment.id);
    expect(events).toHaveLength(2);

    // Provider failure -> error event + the provider message surfaces.
    (global as any).fetch = async () => jsonRes({ status: 500, message: "steadfast exploded" }, 500);
    await expect(svc.syncShipment("org-1", shipment.id)).rejects.toThrow();
    events = prisma.courierShipmentEvent.rows.filter((e: any) => e.shipmentId === shipment.id);
    expect(events).toHaveLength(3);
    expect(events[2].kind).toBe("error");
    expect(events[2].source).toBe("api_sync");
    expect(String(events[2].message)).toContain("exploded");
  });

  it("manual delivered behaves like a sync: same applicator, manual event + audit; manual returned restores stock", async () => {
    const { prisma, svc } = steadfastSvc();
    const audits: any[] = [];
    (svc as any).audit = { log: async (e: any) => { audits.push(e); } };
    const restores: any[] = [];
    (svc as any).inventory = { applyOrderRestore: async (...a: any[]) => { restores.push(a); } };
    const shipment: any = await svc.bookShipment("org-1", "owner", {
      provider: "steadfast", orderId: "ord-1", recipientAddress: "House 9, Road 5, Dhanmondi, Dhaka 1205",
    });
    const out: any = await svc.applyManualStatus("org-1", "staff-9", shipment.id, { status: "delivered", note: "ক্রেতা ফোনে নিশ্চিত করেছেন" });
    expect(out.changed).toBe(true);
    expect(out.status).toBe("delivered");
    const ev = prisma.courierShipmentEvent.rows.at(-1);
    expect(ev).toMatchObject({ kind: "status", status: "delivered", source: "manual", actorId: "staff-9" });
    expect(ev.message).toContain("নিশ্চিত");
    expect(audits.some((a: any) => a.action === "courier.shipment.manual_status")).toBe(true);

    const back: any = await svc.applyManualStatus("org-1", "staff-9", shipment.id, { status: "returned" });
    expect(back.status).toBe("returned");
    expect(restores).toHaveLength(1); // the S1 hook fired through the shared applicator
    expect(restores[0][1]).toBe("ord-1");
  });

  it("manual: unknown status refused; same status + note writes only a note event", async () => {
    const { prisma, svc } = steadfastSvc();
    const shipment: any = await svc.bookShipment("org-1", "owner", {
      provider: "steadfast", orderId: "ord-1", recipientAddress: "House 9, Road 5, Dhanmondi, Dhaka 1205",
    });
    await expect(svc.applyManualStatus("org-1", "staff-9", shipment.id, { status: "On the way" }))
      .rejects.toThrow(/স্ট্যাটাসটি চেনা যাচ্ছে না/);
    const before = prisma.courierShipmentEvent.rows.length;
    const out: any = await svc.applyManualStatus("org-1", "staff-9", shipment.id, {
      status: "in_review", note: "কুরিয়ার অফিসে ফোন করা হয়েছে",
    });
    expect(out.changed).toBe(false);
    const rows = prisma.courierShipmentEvent.rows;
    expect(rows.length).toBe(before + 1);
    expect(rows.at(-1)).toMatchObject({ kind: "note", source: "manual", actorId: "staff-9" });
  });

  it("listShipmentEvents is org-scoped and returns the serialized shipment (charge visible)", async () => {
    const { prisma, svc } = steadfastSvc();
    const shipment: any = await svc.bookShipment("org-1", "owner", {
      provider: "steadfast", orderId: "ord-1", recipientAddress: "House 9, Road 5, Dhanmondi, Dhaka 1205",
    });
    const out: any = await svc.listShipmentEvents("org-1", shipment.id);
    expect(out.shipment.id).toBe(shipment.id);
    expect(out.events.length).toBeGreaterThanOrEqual(1);
    await expect(svc.listShipmentEvents("org-2", shipment.id)).rejects.toThrow(/not found/i);
  });
});

describe("GB5 GC14 — RTO report math", () => {
  it("rates per provider; avgDaysToReturn only from shipments with BOTH events (n stated)", async () => {
    const now = Date.now();
    const day = 86400000;
    const shipments = [
      { id: "sh-a", organizationId: "org-1", provider: "pathao", status: "returned", createdAt: new Date(now - 6 * day) },
      { id: "sh-b", organizationId: "org-1", provider: "pathao", status: "delivered", createdAt: new Date(now - 6 * day) },
      { id: "sh-c", organizationId: "org-1", provider: "pathao", status: "returned", createdAt: new Date(now - 6 * day) }, // no events -> excluded from timing
      { id: "sh-d", organizationId: "org-1", provider: "steadfast", status: "in_transit", createdAt: new Date(now - 2 * day) },
    ];
    const events = [
      { id: "e1", organizationId: "org-1", shipmentId: "sh-a", kind: "status", status: "pending", source: "booking", createdAt: new Date(now - 6 * day) },
      { id: "e2", organizationId: "org-1", shipmentId: "sh-a", kind: "status", status: "returned", source: "api_sync", createdAt: new Date(now - 2 * day) }, // 4 days
      { id: "e3", organizationId: "org-1", shipmentId: "sh-b", kind: "status", status: "pending", source: "booking", createdAt: new Date(now - 6 * day) },
      { id: "e4", organizationId: "org-1", shipmentId: "sh-b", kind: "status", status: "delivered", source: "api_sync", createdAt: new Date(now - 3 * day) },
    ];
    const inWindow = (r: any, where: any) => {
      if (where?.organizationId && r.organizationId !== where.organizationId) return false;
      const c = where?.createdAt;
      if (c?.gte && new Date(r.createdAt) < c.gte) return false;
      if (c?.lt && new Date(r.createdAt) >= c.lt) return false;
      if (where?.shipmentId?.in && !where.shipmentId.in.includes(r.shipmentId)) return false;
      if (where?.kind && r.kind !== where.kind) return false;
      return true;
    };
    const prisma: any = {
      courierShipment: { findMany: async ({ where }: any) => shipments.filter((r) => inWindow(r, where)) },
      courierShipmentEvent: { findMany: async ({ where }: any) => events.filter((r) => inWindow(r, where)) },
    };
    const svc = new CourierService(prisma, audit);
    const report: any = await svc.rtoReport("org-1", {});
    const pathao = report.providers.find((p: any) => p.provider === "pathao");
    expect(pathao.booked).toBe(3);
    expect(pathao.delivered).toBe(1);
    expect(pathao.returned).toBe(2);
    expect(pathao.rtoRatePct).toBe(66.67);
    expect(pathao.avgDaysToReturn).toBe(4);
    expect(pathao.timingN).toBe(1); // sh-c has no events -> excluded, not estimated
    expect(report.totals.booked).toBe(4);
    expect(report.totals.returned).toBe(2);
  });
});
