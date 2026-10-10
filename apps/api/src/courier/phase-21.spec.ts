process.env.ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
import { CourierService, normalizeBdPhone } from "./courier.service";
import { PathaoClient, mapPathaoStatus } from "./pathao.client";
import { RedxClient, mapRedxStatus } from "./redx.client";
import { encryptJson } from "../integrations/crypto";

const audit = { log: async () => undefined } as any;

describe("Phase 21 - status mapping + phone", () => {
  it("maps provider statuses into the shared vocabulary", () => {
    expect(mapPathaoStatus("Pending")).toBe("pending");
    expect(mapPathaoStatus("Delivered")).toBe("delivered");
    expect(mapPathaoStatus("Partial Delivered")).toBe("partial_delivered");
    expect(mapPathaoStatus("In Transit")).toBe("in_transit");
    expect(mapPathaoStatus("Returned")).toBe("returned");
    expect(mapRedxStatus("in-transit")).toBe("in_transit");
    expect(mapRedxStatus("delivered")).toBe("delivered");
    expect(mapRedxStatus("cancelled")).toBe("cancelled");
  });
  it("normalizes BD phones", () => {
    expect(normalizeBdPhone("+880 1712-345678")).toBe("01712345678");
    expect(normalizeBdPhone("০১৭১২৩৪৫৬৭৮")).toBe("01712345678");
  });
});

describe("Phase 21 - PathaoClient", () => {
  it("issues a token, creates an order without null locations, reads status", async () => {
    const calls: { url: string; body: any }[] = [];
    const fetchFn = async (url: string, init: any) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
      if (url.includes("issue-token")) return { ok: true, status: 200, json: async () => ({ access_token: "at-1", refresh_token: "rt-1", expires_in: 432000 }) } as any;
      if (url.includes("/stores")) return { ok: true, status: 200, json: async () => ({ code: 200, data: { data: [{ store_id: 42, store_name: "Main" }] } }) } as any;
      if (url.includes("/orders") && init?.method === "POST") return { ok: true, status: 200, json: async () => ({ code: 200, data: { consignment_id: "DL999", order_status: "Pending", delivery_fee: 70 } }) } as any;
      if (url.includes("/info")) return { ok: true, status: 200, json: async () => ({ code: 200, data: { order_status_slug: "In Transit" } }) } as any;
      return { ok: false, status: 404, json: async () => ({}) } as any;
    };
    const client = new PathaoClient({ baseUrl: "https://sandbox.example", clientId: "cid", clientSecret: "cs", username: "u@x.com", password: "pw" }, fetchFn as any);
    const v = await client.verify();
    expect(v.stores).toBe(1);
    const booked = await client.createOrder({
      store_id: 42, merchant_order_id: "ORD-1", recipient_name: "Karim", recipient_phone: "01712345678",
      recipient_address: "House 1, Dhaka 1205", delivery_type: 48, item_type: 2,
      item_quantity: 1, item_weight: 0.5, amount_to_collect: 900,
    });
    expect(booked.consignmentId).toBe("DL999");
    expect(booked.deliveryFee).toBe(70);
    const orderCall = calls.find((c) => c.url.endsWith("/orders"))!;
    expect("recipient_city" in orderCall.body).toBe(false);
    expect(await client.orderStatus("DL999")).toBe("in_transit");
    // Token was cached: only one issue-token call for all of the above.
    expect(calls.filter((c) => c.url.includes("issue-token")).length).toBe(1);
  });

  it("uses the refresh grant when the stored token is stale", async () => {
    const grants: string[] = [];
    const fetchFn = async (url: string, init: any) => {
      if (url.includes("issue-token")) {
        grants.push(JSON.parse(init.body).grant_type);
        return { ok: true, status: 200, json: async () => ({ access_token: "at-2", refresh_token: "rt-2", expires_in: 432000 }) } as any;
      }
      return { ok: true, status: 200, json: async () => ({ code: 200, data: { data: [] } }) } as any;
    };
    const client = new PathaoClient({
      baseUrl: "https://sandbox.example", clientId: "cid", clientSecret: "cs", username: "u@x.com", password: "pw",
      accessToken: "old", refreshToken: "rt-1", tokenIssuedAt: Date.now() - 10 * 86400000, expiresIn: 432000,
    }, fetchFn as any);
    await client.getStores();
    expect(grants).toEqual(["refresh_token"]);
  });
});

describe("Phase 21 - RedxClient", () => {
  it("verifies via areas and books with a tracking id", async () => {
    let seenHeader: string | undefined;
    const fetchFn = async (url: string, init: any) => {
      seenHeader = (init?.headers as any)?.["API-ACCESS-TOKEN"];
      if (url.endsWith("/areas")) return { ok: true, status: 200, json: async () => ({ areas: [{ id: 1, name: "Dhaka" }] }) } as any;
      if (url.endsWith("/parcel")) return { ok: true, status: 200, json: async () => ({ tracking_id: "RX123", status: "pending" }) } as any;
      if (url.includes("/parcel/info/")) return { ok: true, status: 200, json: async () => ({ data: { status: "in-transit" } }) } as any;
      return { ok: false, status: 404, json: async () => ({}) } as any;
    };
    const client = new RedxClient({ baseUrl: "https://redx.example/v1", accessToken: "tok" }, fetchFn as any);
    expect((await client.verify()).areas).toBe(1);
    const booked = await client.createParcel({
      customer_name: "Karim", customer_phone: "01712345678", delivery_area: "Dhaka", delivery_area_id: 1,
      customer_address: "House 1", merchant_invoice_id: "INV-1", cash_collection_amount: "900",
      parcel_weight: 500, value: 900,
    });
    expect(booked.trackingId).toBe("RX123");
    expect(await client.parcelStatus("RX123")).toBe("in_transit");
    expect(seenHeader).toBe("Bearer tok");
  });

  it("refuses a create response without a tracking id", async () => {
    const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ message: "queued" }) }) as any;
    const client = new RedxClient({ baseUrl: "https://redx.example", accessToken: "t" }, fetchFn as any);
    await expect(client.createParcel({
      customer_name: "K", customer_phone: "01712345678", delivery_area: "Dhaka", delivery_area_id: 1,
      customer_address: "House 1, Dhaka", merchant_invoice_id: "I-1", cash_collection_amount: "1",
      parcel_weight: 500, value: 1,
    })).rejects.toThrow(/tracking id/);
  });
});

// ---------- Service level ----------
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
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id || r.integrationId === where.integrationId); if (row) Object.assign(row, data); return row; },
  };
}

function servicePrisma() {
  const prisma: any = {
    integration: table("integration"), integrationCredential: table("cred"),
    order: table("order"), orderItem: table("item"), customer: table("customer"),
    courierShipment: table("shipment"),
  };
  prisma.order.rows.push({ id: "ord-1", organizationId: "org-1", customerId: "cus-1", externalNumber: "1001", isCod: true, totalMinor: 90000n, conversationId: null });
  prisma.customer.rows.push({ id: "cus-1", organizationId: "org-1", firstName: "Karim", lastName: "Uddin", phone: "01712345678" });
  prisma.orderItem.rows.push({ orderId: "ord-1", name: "Panjabi", quantity: 1, totalMinor: 90000n });
  // Model Prisma's include: { credential: true } on integration reads.
  const origFindFirst = prisma.integration.findFirst.bind(prisma.integration);
  prisma.integration.findFirst = async (args: any) => {
    const row = await origFindFirst(args);
    if (!row) return null;
    const cred = prisma.integrationCredential.rows.find((c: any) => c.integrationId === row.id);
    return { ...row, credential: cred ?? row.credential ?? null };
  };
  return prisma;
}

describe("Phase 21 - CourierService providers", () => {
  it("pathao: connect verifies + booking stores consignment as tracking", async () => {
    const prisma = servicePrisma();
    const svc = new CourierService(prisma, audit);
    (global as any).fetch = async (url: string, init: any) => {
      if (url.includes("issue-token")) return { ok: true, status: 200, json: async () => ({ access_token: "at", refresh_token: "rt", expires_in: 432000 }) } as any;
      if (url.includes("/stores")) return { ok: true, status: 200, json: async () => ({ code: 200, data: { data: [{ store_id: 7, store_name: "Main", is_active: 1 }] } }) } as any;
      if (url.endsWith("/orders")) return { ok: true, status: 200, json: async () => ({ code: 200, data: { consignment_id: "DL555", order_status: "Pending", delivery_fee: 80 } }) } as any;
      return { ok: false, status: 404, json: async () => ({}) } as any;
    };
    const conn = await svc.connect("org-1", "owner", { provider: "pathao", clientId: "cid", clientSecret: "cs", username: "u@x.com", password: "pw", baseUrl: "https://sandbox.example" });
    expect(conn.connected).toBe(true);
    const shipment: any = await svc.bookShipment("org-1", "owner", {
      provider: "pathao", orderId: "ord-1", recipientAddress: "House 9, Road 5, Dhanmondi, Dhaka 1205",
      pathao: { itemWeightKg: 1 },
    });
    expect(shipment.provider).toBe("pathao");
    expect(shipment.trackingCode).toBe("DL555");
    expect(shipment.deliveryFeeMajor).toBe(80);
    await expect(svc.bookShipment("org-1", "owner", {
      provider: "pathao", orderId: "ord-1", recipientAddress: "House 9, Road 5, Dhanmondi, Dhaka 1205",
    })).rejects.toThrow(/ইতিমধ্যে/);
  });

  it("redx: booking needs an area, converts kg to grams, sync maps status", async () => {
    const prisma = servicePrisma();
    const creds = encryptJson({ baseUrl: "https://redx.example/v1", accessToken: "tok" });
    prisma.integration.rows.push({ id: "int-r", organizationId: "org-1", provider: "redx", status: "CONNECTED", credential: { encryptedData: creds } });
    const svc = new CourierService(prisma, audit);
    let parcelBody: any = null;
    (global as any).fetch = async (url: string, init: any) => {
      if (url.endsWith("/parcel")) { parcelBody = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ tracking_id: "RX9", status: "pending" }) } as any; }
      if (url.includes("/parcel/info/")) return { ok: true, status: 200, json: async () => ({ data: { status: "delivered" } }) } as any;
      return { ok: false, status: 404, json: async () => ({}) } as any;
    };
    await expect(svc.bookShipment("org-1", "owner", {
      provider: "redx", orderId: "ord-1", recipientAddress: "House 9, Road 5, Dhanmondi, Dhaka 1205",
    })).rejects.toThrow(/এলাকা/);
    const shipment: any = await svc.bookShipment("org-1", "owner", {
      provider: "redx", orderId: "ord-1", recipientAddress: "House 9, Road 5, Dhanmondi, Dhaka 1205",
      redx: { deliveryAreaId: 1, deliveryArea: "Dhaka", parcelWeightKg: 0.5 },
    });
    expect(parcelBody.parcel_weight).toBe(500);
    expect(shipment.trackingCode).toBe("RX9");
    const synced = await svc.syncShipment("org-1", shipment.id);
    expect(synced.status).toBe("delivered");
  });

  it("redx: a bad token fails connect with RedX's own message and saves nothing", async () => {
    const prisma = servicePrisma();
    const svc = new CourierService(prisma, audit);
    (global as any).fetch = async () => ({ ok: false, status: 401, json: async () => ({ message: "Unauthorized" }) }) as any;
    await expect(svc.connect("org-1", "owner", { provider: "redx", accessToken: "bad" })).rejects.toThrow(/Unauthorized/);
    expect(prisma.integration.rows.length).toBe(0);
  });
});
