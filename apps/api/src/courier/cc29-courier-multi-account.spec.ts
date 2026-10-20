process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "cc29-spec-secret";

import { BadRequestException } from "@nestjs/common";
import { ApiException } from "../i18n";
import { CourierService, courierAccountKey, pickPrimaryCourierAccount } from "./courier.service";
import { SteadfastClient } from "./steadfast.client";
import { PathaoClient } from "./pathao.client";
import { RedxClient } from "./redx.client";
import { encryptJson } from "../integrations/crypto";

/**
 * CC29 (Connect Center Next) — courier multi-account.
 *
 * Identity source per courier (investigated, see
 * docs/connect-center-b12-acceptance.md): NO courier's
 * verify/me response returns a real account id — Steadfast's
 * balance is a number, Pathao's stores are merchant outlets,
 * RedX's areas are geography. The account key is therefore a
 * credential FINGERPRINT (courierAccountKey): steadfast
 * sha256(apiKey), pathao sha256(clientId:username) — never the
 * rotating tokens — redx sha256(accessToken).
 *
 * Pins: two accounts of one provider coexist; reconnecting the
 * same credentials updates the same row; booking resolution
 * (explicit → EC22 rule-pinned → default → earliest connected);
 * the shipment records its account; status sync uses the
 * RECORDED account's credentials even when another account is
 * default and even after the recorded account is disconnected;
 * disconnecting one account leaves the others fully working.
 */

const ORG = "org-cc29";
const USER = "user-1";

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v && !(v as any).in.includes(row[k])) return false;
      if ("not" in v && row[k] === (v as any).not) return false;
      if ("lte" in v && !(new Date(row[k]).getTime() <= new Date((v as any).lte).getTime())) return false;
      if ("gte" in v && !(new Date(row[k]).getTime() >= new Date((v as any).gte).getTime())) return false;
      if ("lt" in v && !(new Date(row[k]).getTime() < new Date((v as any).lt).getTime())) return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
    return row[k] === v;
  });
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where, take }: any = {}) => {
      const out = rows.filter((r) => matches(r, where ?? {}));
      return take ? out.slice(0, take) : out;
    },
    findUnique: async ({ where }: any) => rows.find((r) => matches(r, where ?? {})) ?? null,
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(Date.now() + seq * 1000), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where ?? {}));
      if (row) Object.assign(row, data);
      return row ?? null;
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const row of rows) if (matches(row, where ?? {})) { Object.assign(row, data); count++; }
      return { count };
    },
    deleteMany: async ({ where }: any = {}) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where ?? {})) { rows.splice(i, 1); count++; }
      return { count };
    },
  };
}

function makeDb() {
  const db: any = {};
  for (const n of ["integration", "integrationCredential", "order", "customer", "courierShipment", "orderItem", "organization", "businessProfile"]) db[n] = makeTable(n);
  db.order.rows.push(
    { id: "ord-1", organizationId: ORG, customerId: "cus-1", isCod: true, totalMinor: 150000n, externalNumber: "1042", status: "processing", isPractice: false },
    { id: "ord-2", organizationId: ORG, customerId: "cus-1", isCod: true, totalMinor: 90000n, externalNumber: "1043", status: "processing", isPractice: false },
    { id: "ord-3", organizationId: ORG, customerId: "cus-1", isCod: true, totalMinor: 50000n, externalNumber: "1044", status: "processing", isPractice: false },
  );
  db.customer.rows.push({ id: "cus-1", organizationId: ORG, firstName: "Rahim", lastName: "Uddin", phone: "01711111111" });
  return db;
}

function makeAudit() {
  const entries: any[] = [];
  return { entries, audit: { log: jest.fn(async (input: any) => { entries.push(input); }) } };
}

// Provider clients are spied at the prototype seam: construction
// is real (the service builds them from the decrypted stored
// credentials), the HTTP methods are fixtures that RECORD which
// account's credentials the client was built with.
const createOrderCalls: { apiKey: string }[] = [];
const statusCalls: { apiKey: string; code: string }[] = [];
let consignmentSeq = 0;
jest.spyOn(SteadfastClient.prototype, "getBalance").mockImplementation(async function (this: any) {
  return { status: 200, current_balance: 500 };
});
jest.spyOn(SteadfastClient.prototype, "createOrder").mockImplementation(async function (this: any) {
  createOrderCalls.push({ apiKey: (this as any).creds.apiKey });
  consignmentSeq++;
  return { consignment_id: 900 + consignmentSeq, tracking_code: `TRK-${consignmentSeq}`, status: "in_review" };
});
jest.spyOn(SteadfastClient.prototype, "statusByTrackingCode").mockImplementation(async function (this: any, code: string) {
  statusCalls.push({ apiKey: (this as any).creds.apiKey, code });
  return "delivered";
});
jest.spyOn(PathaoClient.prototype, "verify").mockImplementation(async function (this: any) {
  return { stores: 2 };
});
jest.spyOn(RedxClient.prototype, "verify").mockImplementation(async function (this: any) {
  return { areas: 12 };
});

function service(db: any, rules?: any) {
  const { audit, entries } = makeAudit();
  const svc = new CourierService(db as any, audit as any, undefined, undefined, undefined, undefined, undefined, rules);
  return { svc, entries };
}

async function connectSteadfast(svc: CourierService, apiKey: string, secretKey = "sk") {
  return svc.connect(ORG, USER, { provider: "steadfast", apiKey, secretKey });
}

const BOOK = { recipientName: "Rahim Uddin", recipientPhone: "01711111111", recipientAddress: "House 1, Road 2, Dhaka 1212" };

describe("CC29 courierAccountKey — fingerprint identity (documented per courier)", () => {
  it("steadfast: keyed on the apiKey, stable, fp_-prefixed, never contains the credential", () => {
    const k = courierAccountKey("steadfast", { apiKey: "KEY-A", secretKey: "s1" });
    expect(k).toMatch(/^fp_[0-9a-f]{24}$/);
    expect(k).not.toContain("KEY-A");
    expect(courierAccountKey("steadfast", { apiKey: "KEY-A", secretKey: "ROTATED" })).toBe(k); // secret is not the identity
    expect(courierAccountKey("steadfast", { apiKey: "KEY-B", secretKey: "s1" })).not.toBe(k);
  });

  it("pathao: keyed on clientId + username — the ROTATING tokens never fork the account", () => {
    const a = courierAccountKey("pathao", { clientId: "cid", username: "shop@x.co", accessToken: "tok-1", refreshToken: "ref-1" });
    const b = courierAccountKey("pathao", { clientId: "cid", username: "shop@x.co", accessToken: "tok-2", refreshToken: "ref-2" });
    expect(a).toBe(b);
    expect(courierAccountKey("pathao", { clientId: "cid", username: "other@x.co" })).not.toBe(a);
  });

  it("redx: keyed on the access token", () => {
    expect(courierAccountKey("redx", { accessToken: "tok-1" })).not.toBe(courierAccountKey("redx", { accessToken: "tok-2" }));
    expect(courierAccountKey("redx", { accessToken: "tok-1" })).toBe(courierAccountKey("redx", { accessToken: "tok-1" }));
  });

  it("pickPrimaryCourierAccount: connected default > earliest connected > earliest row", () => {
    const t = (s: number) => new Date(Date.now() + s * 1000);
    expect(pickPrimaryCourierAccount([])).toBeNull();
    const rows = [
      { id: "a", status: "DISCONNECTED", isDefault: true, createdAt: t(0) },
      { id: "b", status: "CONNECTED", isDefault: false, createdAt: t(1) },
      { id: "c", status: "CONNECTED", isDefault: true, createdAt: t(2) },
    ];
    expect(pickPrimaryCourierAccount(rows).id).toBe("c"); // a disconnected default never wins over a connected account
    expect(pickPrimaryCourierAccount(rows.filter((r) => r.id !== "c")).id).toBe("b");
  });
});

describe("CC29 connect — accounts coexist, keyed by fingerprint", () => {
  it("two different Steadfast credential sets = two accounts; the first is default; reconnecting the same set updates the SAME row", async () => {
    const db = makeDb();
    const { svc } = service(db);
    await connectSteadfast(svc, "KEY-A");
    await connectSteadfast(svc, "KEY-B");
    let rows = db.integration.rows.filter((r: any) => r.provider === "steadfast");
    expect(rows).toHaveLength(2);
    expect(rows[0].externalAccountId).toBe(courierAccountKey("steadfast", { apiKey: "KEY-A" }));
    expect(rows[0].isDefault).toBe(true);
    expect(rows[1].isDefault).toBe(false);

    // Reconnect KEY-A with a rotated SECRET — same identity.
    await connectSteadfast(svc, "KEY-A", "sk-rotated");
    rows = db.integration.rows.filter((r: any) => r.provider === "steadfast");
    expect(rows).toHaveLength(2);
    expect(rows[0].isDefault).toBe(true);

    const view: any = await svc.getConnection(ORG, "steadfast");
    expect(view.accounts).toHaveLength(2);
    expect(view.accounts.map((a: any) => a.isDefault)).toEqual([true, false]);
    expect(view.id).toBe(rows[0].id); // primary = the default account
  });

  it("Pathao: reconnecting after a token rotation keeps ONE account row (the fingerprint excludes tokens)", async () => {
    const db = makeDb();
    const { svc } = service(db);
    const dto = { provider: "pathao", clientId: "cid-1", clientSecret: "cs", username: "shop@x.co", password: "pw" };
    await svc.connect(ORG, USER, dto as any);
    await svc.connect(ORG, USER, dto as any);
    const rows = db.integration.rows.filter((r: any) => r.provider === "pathao");
    expect(rows).toHaveLength(1);
    expect(rows[0].externalAccountId).toBe(courierAccountKey("pathao", { clientId: "cid-1", username: "shop@x.co" }));
    // A second Pathao account (different client) coexists.
    await svc.connect(ORG, USER, { ...dto, clientId: "cid-2" } as any);
    expect(db.integration.rows.filter((r: any) => r.provider === "pathao")).toHaveLength(2);
  });

  it("RedX: two tokens = two accounts", async () => {
    const db = makeDb();
    const { svc } = service(db);
    await svc.connect(ORG, USER, { provider: "redx", accessToken: "tok-1" });
    await svc.connect(ORG, USER, { provider: "redx", accessToken: "tok-2" });
    expect(db.integration.rows.filter((r: any) => r.provider === "redx")).toHaveLength(2);
  });
});

describe("CC29 booking — account resolution + recorded on the shipment", () => {
  async function twoAccounts() {
    const db = makeDb();
    const { svc, entries } = service(db);
    await connectSteadfast(svc, "KEY-A"); // default
    await connectSteadfast(svc, "KEY-B");
    const [a, b] = db.integration.rows;
    createOrderCalls.length = 0;
    return { db, svc, entries, a, b };
  }

  it("no choice → the DEFAULT account books; the shipment records it", async () => {
    const { svc, a } = await twoAccounts();
    const out: any = await svc.bookShipment(ORG, USER, { provider: "steadfast", orderId: "ord-1", ...BOOK });
    expect(createOrderCalls).toEqual([{ apiKey: "KEY-A" }]);
    expect(out.integrationId).toBe(a.id);
  });

  it("explicit courierIntegrationId wins over the default", async () => {
    const { svc, b } = await twoAccounts();
    const out: any = await svc.bookShipment(ORG, USER, { provider: "steadfast", orderId: "ord-1", courierIntegrationId: b.id, ...BOOK });
    expect(createOrderCalls).toEqual([{ apiKey: "KEY-B" }]);
    expect(out.integrationId).toBe(b.id);
  });

  it("an EC22 rule's pinned account is honored (provider chosen by the rule, account follows the pin)", async () => {
    const db = makeDb();
    const rulesStub = {
      factsForOrder: jest.fn(async () => ({})),
      evaluate: jest.fn(async () => ({
        rule: { id: "rule-1", name: "Heavy → B" }, provider: "steadfast",
        courierAccountId: null as string | null, reason: "matched",
      })),
    };
    const { svc } = service(db, rulesStub);
    await connectSteadfast(svc, "KEY-A");
    await connectSteadfast(svc, "KEY-B");
    const b = db.integration.rows[1];
    rulesStub.evaluate.mockResolvedValue({
      rule: { id: "rule-1", name: "Heavy → B" }, provider: "steadfast", courierAccountId: b.id, reason: "matched",
    });
    createOrderCalls.length = 0;
    const out: any = await svc.bookShipment(ORG, USER, { orderId: "ord-1", ...BOOK }); // no provider → rule runs
    expect(createOrderCalls).toEqual([{ apiKey: "KEY-B" }]);
    expect(out.integrationId).toBe(b.id);
    expect(out.courierRuleId).toBe("rule-1");
  });

  it("explicit choice of a DISCONNECTED or unknown account is an honest 400 — never a silent reroute", async () => {
    const { svc, b } = await twoAccounts();
    await svc.disconnect(ORG, USER, "steadfast", b.id);
    await expect(svc.bookShipment(ORG, USER, { provider: "steadfast", orderId: "ord-1", courierIntegrationId: b.id, ...BOOK }))
      .rejects.toBeInstanceOf(ApiException);
    await expect(svc.bookShipment(ORG, USER, { provider: "steadfast", orderId: "ord-2", courierIntegrationId: "no-such-id", ...BOOK }))
      .rejects.toThrow(/পাওয়া যায়নি/);
    expect(createOrderCalls).toHaveLength(0);
  });
});

describe("CC29 status sync — the shipment's RECORDED account answers", () => {
  it("sync uses the booked account's credentials even when another account is default — and even after that account is disconnected", async () => {
    const db = makeDb();
    const { svc } = service(db);
    await connectSteadfast(svc, "KEY-A"); // default
    await connectSteadfast(svc, "KEY-B");
    const b = db.integration.rows[1];
    const booked: any = await svc.bookShipment(ORG, USER, { provider: "steadfast", orderId: "ord-1", courierIntegrationId: b.id, ...BOOK });
    expect(booked.integrationId).toBe(b.id);

    statusCalls.length = 0;
    const synced: any = await svc.syncShipment(ORG, booked.id);
    expect(statusCalls).toEqual([{ apiKey: "KEY-B", code: booked.trackingCode }]);
    expect(synced.status).toBe("delivered");

    // Disconnect the recorded account: sync of ITS parcel still
    // resolves its credentials (the parcel lives on that account).
    await svc.disconnect(ORG, USER, "steadfast", b.id);
    db.courierShipment.rows[0].status = "in_review";
    statusCalls.length = 0;
    await svc.syncShipment(ORG, booked.id);
    expect(statusCalls).toEqual([{ apiKey: "KEY-B", code: booked.trackingCode }]);
  });

  it("a pre-CC29 shipment (integrationId null) syncs through the primary account, exactly as before", async () => {
    const db = makeDb();
    const { svc } = service(db);
    await connectSteadfast(svc, "KEY-A");
    await connectSteadfast(svc, "KEY-B");
    db.courierShipment.rows.push({
      id: "ship-old", organizationId: ORG, orderId: "ord-9", provider: "steadfast", integrationId: null,
      trackingCode: "TRK-OLD", consignmentId: "1", status: "in_review", codAmountMinor: 0n,
      recipientName: "R", recipientPhone: "017", recipientAddress: "Dhaka", invoice: "9",
    });
    statusCalls.length = 0;
    await svc.syncShipment(ORG, "ship-old");
    expect(statusCalls).toEqual([{ apiKey: "KEY-A", code: "TRK-OLD" }]); // default account
  });

  it("disconnecting ONE account leaves the other fully working (booking + listing)", async () => {
    const db = makeDb();
    const { svc } = service(db);
    await connectSteadfast(svc, "KEY-A");
    await connectSteadfast(svc, "KEY-B");
    const [a, b] = db.integration.rows;
    const out: any = await svc.disconnect(ORG, USER, "steadfast", b.id);
    expect(out).toMatchObject({ connected: false, integrationId: b.id });
    const view: any = await svc.getConnection(ORG, "steadfast");
    expect(view.accounts.find((x: any) => x.id === b.id).status).toBe("DISCONNECTED");
    expect(view.accounts.find((x: any) => x.id === a.id).status).toBe("CONNECTED");
    createOrderCalls.length = 0;
    const booked: any = await svc.bookShipment(ORG, USER, { provider: "steadfast", orderId: "ord-1", ...BOOK });
    expect(createOrderCalls).toEqual([{ apiKey: "KEY-A" }]);
    expect(booked.integrationId).toBe(a.id);
  });
});
