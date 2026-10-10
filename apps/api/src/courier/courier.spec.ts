process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.DISABLE_SCHEDULER = "true";

import { SteadfastClient, SteadfastError } from "./steadfast.client";
import { CourierService } from "./courier.service";
import { decryptJson } from "../integrations/crypto";

const fetchReturning = (body: any, ok = true, status = 200) =>
  (async () => ({ ok, status, statusText: "X", json: async () => body })) as any;

describe("SteadfastClient (verified API shape)", () => {
  it("creates an order and returns the consignment only on a real 200 envelope", async () => {
    const client = new SteadfastClient({ apiKey: "k", secretKey: "s" }, fetchReturning({
      status: 200, consignment: { consignment_id: 123, tracking_code: "TRK1", status: "in_review" },
    }));
    const c = await client.createOrder({ invoice: "1", recipient_name: "A", recipient_phone: "017", recipient_address: "Dhaka", cod_amount: 100 });
    expect(c.tracking_code).toBe("TRK1");
  });
  it("throws the courier's own message on API errors", async () => {
    const client = new SteadfastClient({ apiKey: "k", secretKey: "s" }, fetchReturning({ status: 422, message: "Invalid phone" }, false, 422));
    await expect(client.createOrder({ invoice: "1", recipient_name: "A", recipient_phone: "x", recipient_address: "y", cod_amount: 0 }))
      .rejects.toThrow("Invalid phone");
  });
  it("refuses a 200 envelope without a consignment", async () => {
    const client = new SteadfastClient({ apiKey: "k", secretKey: "s" }, fetchReturning({ status: 200, message: "ok" }));
    await expect(client.createOrder({ invoice: "1", recipient_name: "A", recipient_phone: "x", recipient_address: "y", cod_amount: 0 }))
      .rejects.toBeInstanceOf(SteadfastError);
  });
  it("reads delivery status by tracking code", async () => {
    const client = new SteadfastClient({ apiKey: "k", secretKey: "s" }, fetchReturning({ status: 200, delivery_status: "delivered" }));
    await expect(client.statusByTrackingCode("TRK1")).resolves.toBe("delivered");
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

describe("CourierService", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  function setup() {
    const tables: Record<string, any> = {};
    for (const n of ["integration", "integrationCredential", "order", "customer", "courierShipment"]) tables[n] = makeTable(n);
    // findFirst with include: emulate credential attachment
    const origFindFirst = tables.integration.findFirst;
    tables.integration.findFirst = async (args: any) => {
      const row = await origFindFirst(args);
      if (row && args?.include?.credential) {
        const cred = tables.integrationCredential.rows.find((c: any) => c.integrationId === row.id);
        return { ...row, credential: cred ?? null };
      }
      return row;
    };
    tables.customer.rows.push({ id: "cus-1", organizationId: "org-1", firstName: "Rahim", lastName: "Uddin", phone: "01711111111" });
    tables.order.rows.push({
      id: "ord-1", organizationId: "org-1", customerId: "cus-1", isCod: true,
      totalMinor: 150000n, externalNumber: "1042", conversationId: "conv-1", status: "processing",
    });
    const inboxCalls: any[] = [];
    const inboxStub = { sendAutomatedMessage: async (...a: any[]) => { inboxCalls.push(a); return { id: "m" }; } } as any;
    const svc = new CourierService(tables as any, { log: async () => undefined } as any, inboxStub);
    return { tables, svc, inboxCalls };
  }

  function stubSteadfast(balanceOk = true) {
    global.fetch = (async (url: string) => {
      const u = String(url);
      if (u.includes("/get_balance")) {
        return balanceOk
          ? { ok: true, status: 200, json: async () => ({ status: 200, current_balance: 750 }) }
          : { ok: false, status: 401, statusText: "Unauthorized", json: async () => ({ message: "Invalid API key" }) };
      }
      if (u.includes("/create_order")) {
        return { ok: true, status: 200, json: async () => ({ status: 200, consignment: { consignment_id: 555, tracking_code: "TRK9", status: "in_review" } }) };
      }
      if (u.includes("/status_by_trackingcode/")) {
        return { ok: true, status: 200, json: async () => ({ status: 200, delivery_status: "delivered" }) };
      }
      throw new Error("unexpected url " + u);
    }) as any;
  }

  it("connect verifies credentials against the real API and stores them encrypted", async () => {
    const { tables, svc } = setup();
    stubSteadfast();
    const conn = await svc.connect("org-1", "owner", { apiKey: "key-1", secretKey: "secret-1" });
    expect(conn.connected).toBe(true);
    const cred = tables.integrationCredential.rows[0];
    expect(cred.encryptedData).not.toContain("secret-1");
    expect((decryptJson(cred.encryptedData) as any).apiKey).toBe("key-1");
  });

  it("connect refuses invalid credentials with Steadfast's message", async () => {
    const { tables, svc } = setup();
    stubSteadfast(false);
    await expect(svc.connect("org-1", "owner", { apiKey: "bad", secretKey: "bad" })).rejects.toThrow("Invalid API key");
    expect(tables.integration.rows).toHaveLength(0);
  });

  it("books a shipment with the courier's tracking code and refuses duplicates", async () => {
    const { tables, svc } = setup();
    stubSteadfast();
    await svc.connect("org-1", "owner", { apiKey: "k", secretKey: "s" });
    const shipment = await svc.bookShipment("org-1", "agent", { orderId: "ord-1", recipientAddress: "বাসা ৫, রোড ২, মিরপুর, ঢাকা" });
    expect(shipment.trackingCode).toBe("TRK9");
    expect(shipment.recipientName).toBe("Rahim Uddin"); // defaulted from the customer
    expect(shipment.codAmountMinor).toBe("150000"); // COD total in minor units
    await expect(svc.bookShipment("org-1", "agent", { orderId: "ord-1", recipientAddress: "বাসা ৫, রোড ২, মিরপুর, ঢাকা" }))
      .rejects.toThrow("ইতিমধ্যে বুক করা");
    expect(tables.courierShipment.rows).toHaveLength(1);
  });

  it("sync updates the status and notifies the chat customer once", async () => {
    const { svc, inboxCalls } = setup();
    stubSteadfast();
    await svc.connect("org-1", "owner", { apiKey: "k", secretKey: "s" });
    const shipment = await svc.bookShipment("org-1", "agent", { orderId: "ord-1", recipientAddress: "বাসা ৫, রোড ২, মিরপুর, ঢাকা" });
    const synced = await svc.syncShipment("org-1", shipment.id);
    expect(synced.status).toBe("delivered");
    expect(inboxCalls).toHaveLength(1);
    expect(inboxCalls[0][2]).toContain("ডেলিভারি সম্পন্ন");
    const again = await svc.syncShipment("org-1", shipment.id);
    expect(again.status).toBe("delivered");
    expect(inboxCalls).toHaveLength(1); // no duplicate notification
  });
});
