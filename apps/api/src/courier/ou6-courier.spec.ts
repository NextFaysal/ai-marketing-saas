process.env.ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
import "reflect-metadata";
import { ApiException } from "../i18n";
import { BadRequestException } from "@nestjs/common";
import {
  COURIER_CAPABILITIES, COURIER_PROVIDERS, courierAdapter, courierCapabilities, createCourierClient,
} from "./courier-client";
import { SteadfastClient } from "./steadfast.client";
import { PathaoClient } from "./pathao.client";
import { RedxClient } from "./redx.client";
import { EcourierClient } from "./ecourier.client";
import {
  PAPERFLY_DEV_NOT_LIVE_MESSAGE, PaperflyDevAdapterClient, PaperflyDevAdapterError,
} from "./paperfly.client";
import { CourierService } from "./courier.service";
import { encryptJson } from "../integrations/crypto";

/**
 * OU6 (One-Umbrella OB2) — generic courier adapter framework
 * capabilities + Paperfly DEVELOPMENT adapter.
 * Fetch-stubbed throughout; no live provider is ever called.
 */

function jsonRes(body: any, status = 200) {
  return {
    ok: status >= 200 && status < 300, status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as any;
}

describe("OU6 capabilities descriptor", () => {
  it("covers exactly the registered providers", () => {
    expect(Object.keys(COURIER_CAPABILITIES).sort()).toEqual([...COURIER_PROVIDERS].sort());
    for (const p of COURIER_PROVIDERS) expect(courierCapabilities(p)).toBe(COURIER_CAPABILITIES[p]);
  });

  it("balance is true ONLY where a client balance read exists in-repo (Steadfast /get_balance)", () => {
    expect(COURIER_CAPABILITIES.steadfast.balance).toBe(true);
    expect(COURIER_CAPABILITIES.pathao.balance).toBe(false);
    expect(COURIER_CAPABILITIES.redx.balance).toBe(false);
    expect(COURIER_CAPABILITIES.ecourier.balance).toBe(false);
    expect(COURIER_CAPABILITIES.paperfly.balance).toBe(false);
  });

  it("cancel is false everywhere — no in-repo client implements a provider cancel call", () => {
    for (const p of COURIER_PROVIDERS) expect(COURIER_CAPABILITIES[p].cancel).toBe(false);
  });

  it("codReconcile matches the reconciliation service's documented provider set", () => {
    expect(COURIER_CAPABILITIES.steadfast.codReconcile).toBe(true);
    expect(COURIER_CAPABILITIES.pathao.codReconcile).toBe(true);
    expect(COURIER_CAPABILITIES.redx.codReconcile).toBe(true);
    expect(COURIER_CAPABILITIES.ecourier.codReconcile).toBe(false);
  });

  it("quote matches CourierService.quote's real pricing surfaces (Pathao plan, RedX calculator)", () => {
    expect(COURIER_CAPABILITIES.pathao.quote).toBe(true);
    expect(COURIER_CAPABILITIES.redx.quote).toBe(true);
    expect(COURIER_CAPABILITIES.steadfast.quote).toBe(false);
    expect(COURIER_CAPABILITIES.ecourier.quote).toBe(false);
  });

  it("every adapter carries its descriptor; balance() exists only on the Steadfast adapter", () => {
    const adapters = [
      courierAdapter("steadfast", new SteadfastClient({ apiKey: "k", secretKey: "s" })),
      courierAdapter("pathao", new PathaoClient({} as any)),
      courierAdapter("redx", new RedxClient({ accessToken: "t" } as any)),
      courierAdapter("ecourier", new EcourierClient({ apiKey: "k", apiSecret: "s", userId: "u" })),
      courierAdapter("paperfly", new PaperflyDevAdapterClient({})),
    ];
    for (const a of adapters) expect(a.capabilities).toBe(COURIER_CAPABILITIES[a.provider]);
    expect(typeof (adapters[0] as any).balance).toBe("function");
    for (const a of adapters.slice(1)) expect((a as any).balance).toBeUndefined();
  });
});

describe("OU6 Steadfast adapter balance (the existing balance-read, on the framework)", () => {
  it("parses current_balance (major) into minor units", async () => {
    const client = new SteadfastClient({ apiKey: "k", secretKey: "s" }, (async (url: string) => {
      expect(String(url)).toContain("/get_balance");
      return jsonRes({ status: 200, current_balance: 1250.5 });
    }) as any);
    const adapter = courierAdapter("steadfast", client);
    await expect(adapter.balance!()).resolves.toEqual({ balanceMinor: 125050, currency: "BDT" });
  });

  it("a response without a numeric balance is an error — never a fabricated 0", async () => {
    const client = new SteadfastClient({ apiKey: "k", secretKey: "s" }, (async () =>
      jsonRes({ status: 200 })) as any);
    const adapter = courierAdapter("steadfast", client);
    await expect(adapter.balance!()).rejects.toThrow(/no numeric current_balance/);
  });
});

describe("OU6 Paperfly DEVELOPMENT adapter — refuses honestly, never calls the network", () => {
  it("is labelled as a development adapter and not live", () => {
    const client = new PaperflyDevAdapterClient({ apiKey: "k", apiSecret: "s" });
    expect(client.developmentAdapter).toBe(true);
    expect(client.live).toBe(false);
    expect(COURIER_CAPABILITIES.paperfly.live).toBe(false);
    expect(COURIER_CAPABILITIES.paperfly.book).toBe(false);
  });

  it("every operation refuses with the not-live message; fetch is never invoked", async () => {
    let fetchCalls = 0;
    const client = new PaperflyDevAdapterClient({ apiKey: "k" }, (async () => {
      fetchCalls += 1;
      return jsonRes({});
    }) as any);
    await expect(client.verify()).rejects.toThrow(PaperflyDevAdapterError);
    await expect(client.verify()).rejects.toThrow(/Development Adapter/);
    await expect(client.createOrder({})).rejects.toThrow(/লাইভ নয়/);
    await expect(client.statusByTrackingCode("PF1")).rejects.toThrow(/লাইভ নয়/);
    await expect(client.getBalance()).rejects.toThrow(/লাইভ নয়/);
    expect(fetchCalls).toBe(0);
    expect(PAPERFLY_DEV_NOT_LIVE_MESSAGE).toContain("partner-gated");
  });

  it("the framework adapter surfaces booking/tracking attempts as a BadRequest with the dev message", async () => {
    const adapter = courierAdapter("paperfly", createCourierClient("paperfly", { apiKey: "k", apiSecret: "s" }) as PaperflyDevAdapterClient);
    expect(adapter.developmentAdapter).toBe(true);
    await expect(adapter.book({
      invoice: "1001", recipientName: "Karim", recipientPhone: "01712345678",
      recipientAddress: "House 9, Dhaka", codAmountMajor: 900, orderTotalMajor: 900,
      itemCount: 1, itemDescription: "Panjabi x1", items: [],
    })).rejects.toThrow(ApiException);
    await expect(adapter.book({
      invoice: "1001", recipientName: "Karim", recipientPhone: "01712345678",
      recipientAddress: "House 9, Dhaka", codAmountMajor: 900, orderTotalMajor: 900,
      itemCount: 1, itemDescription: "Panjabi x1", items: [],
    })).rejects.toThrow(/Development Adapter/);
    await expect(adapter.statusOf({ consignmentId: null, trackingCode: "PF1" })).rejects.toThrow(/Development Adapter/);
  });
});

describe("OU6 CourierService — Paperfly development adapter surface", () => {
  const audit = { log: async () => undefined } as any;

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
    return prisma;
  }

  it("connect refuses honestly and saves NOTHING (no Integration row, no credential)", async () => {
    const prisma = servicePrisma();
    const svc = new CourierService(prisma, audit);
    await expect(svc.connect("org-1", "owner", {
      provider: "paperfly", apiKey: "k", apiSecret: "s",
    })).rejects.toThrow(/Development Adapter/);
    expect(prisma.integration.rows).toHaveLength(0);
    expect(prisma.integrationCredential.rows).toHaveLength(0);
  });

  it("a booking attempt surfaces the not-live reason and creates no shipment", async () => {
    const prisma = servicePrisma();
    const svc = new CourierService(prisma, audit);
    await expect(svc.bookShipment("org-1", "owner", {
      provider: "paperfly", orderId: "ord-1",
      recipientAddress: "House 9, Road 5, Dhanmondi, Dhaka 1205",
    })).rejects.toThrow(/লাইভ নয়/);
    expect(prisma.courierShipment.rows).toHaveLength(0);
  });

  it("quote is honestly quotable:false with the dev reason", async () => {
    const svc = new CourierService(servicePrisma(), audit);
    const q: any = await svc.quote("org-1", { provider: "paperfly" });
    expect(q.quotable).toBe(false);
    expect(q.chargeMinor).toBeNull();
    expect(q.reason).toContain("Development Adapter");
  });

  it("the connections view lists Paperfly labelled development / not live, never connected", async () => {
    const svc = new CourierService(servicePrisma(), audit);
    const all: any[] = await svc.getConnections("org-1");
    const pf = all.find((c) => c.provider === "paperfly");
    expect(pf).toBeDefined();
    expect(pf.connected).toBe(false);
    expect(pf.live).toBe(false);
    expect(pf.developmentAdapter).toBe(true);
    expect(pf.capabilities).toMatchObject({ book: false, balance: false, live: false });
    const sf = all.find((c) => c.provider === "steadfast");
    expect(sf.live).toBe(true);
    expect(sf.capabilities.balance).toBe(true);
  });
});

describe("OU6 CourierService — balance visibility", () => {
  const audit = { log: async () => undefined } as any;

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
    const origFindFirst = prisma.integration.findFirst.bind(prisma.integration);
    prisma.integration.findFirst = async (args: any) => {
      const row = await origFindFirst(args);
      if (!row) return null;
      const cred = prisma.integrationCredential.rows.find((c: any) => c.integrationId === row.id);
      return { ...row, credential: cred ?? row.credential ?? null };
    };
    return prisma;
  }

  function seed(prisma: any, provider: string, creds: any) {
    const row = {
      id: `int-${provider}`, organizationId: "org-1", provider, status: "CONNECTED",
      credential: { encryptedData: encryptJson(creds) },
    };
    prisma.integration.rows.push(row);
    prisma.integrationCredential.rows.push({ id: `cred-${provider}`, integrationId: row.id, encryptedData: encryptJson(creds) });
  }

  it("Steadfast connected: state ok with the REAL balance from /get_balance", async () => {
    const prisma = servicePrisma();
    seed(prisma, "steadfast", { apiKey: "k", secretKey: "s" });
    const svc = new CourierService(prisma, audit);
    (global as any).fetch = async (url: string) => {
      expect(String(url)).toContain("/get_balance");
      return jsonRes({ status: 200, current_balance: 2500 });
    };
    const view: any = await svc.getBalance("org-1", "steadfast");
    expect(view.state).toBe("ok");
    expect(view.balanceMinor).toBe(250000);
    expect(view.currency).toBe("BDT");
    expect(view.supported).toBe(true);
    expect(view.fetchedAt).toBeTruthy();
  });

  it("Steadfast provider failure: state error, provider message carried, figure stays null", async () => {
    const prisma = servicePrisma();
    seed(prisma, "steadfast", { apiKey: "bad", secretKey: "bad" });
    const svc = new CourierService(prisma, audit);
    (global as any).fetch = async () => jsonRes({ status: 401, message: "Invalid API key" }, 401);
    const view: any = await svc.getBalance("org-1", "steadfast");
    expect(view.state).toBe("error");
    expect(view.balanceMinor).toBeNull();
    expect(String(view.message)).toContain("Invalid API key");
  });

  it("connected Pathao / RedX / eCourier: not_supported — no balance API in-repo, never a number", async () => {
    const prisma = servicePrisma();
    seed(prisma, "pathao", { clientId: "c", clientSecret: "s", username: "u", password: "p" });
    const svc = new CourierService(prisma, audit);
    const view: any = await svc.getBalance("org-1", "pathao");
    expect(view.state).toBe("not_supported");
    expect(view.supported).toBe(false);
    expect(view.balanceMinor).toBeNull();
  });

  it("no connected account: not_configured (Steadfast and Paperfly alike)", async () => {
    const svc = new CourierService(servicePrisma(), audit);
    const sf: any = await svc.getBalance("org-1", "steadfast");
    expect(sf.state).toBe("not_configured");
    expect(sf.balanceMinor).toBeNull();
    const pf: any = await svc.getBalance("org-1", "paperfly");
    expect(pf.state).toBe("not_supported");
    expect(pf.developmentAdapter).toBe(true);
    expect(pf.live).toBe(false);
    expect(pf.balanceMinor).toBeNull();
    expect(pf.message).toContain("Development Adapter");
  });

  it("getBalances covers every registered provider, one view each", async () => {
    const svc = new CourierService(servicePrisma(), audit);
    const all: any[] = await svc.getBalances("org-1");
    expect(all.map((v) => v.provider)).toEqual(["steadfast", "pathao", "redx", "ecourier", "paperfly"]);
    for (const v of all) expect(v.balanceMinor).toBeNull();
  });
});
