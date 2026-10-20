process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "test-secret";

import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ApiException } from "../i18n";
import { TenantPaymentsService } from "./tenant-payments.service";
import { WalletService } from "./wallet.service";
import { setPlatformConfigSnapshot } from "../common/platform-config";

/**
 * GC10 — embedded checkout payment: public options + public
 * payment state on TenantPaymentsService.
 *
 * Pinned rules:
 * - options come from the REAL initiation gates: own = gateway
 *   row exists + enabled + creds decrypt; platform = enablement
 *   on + platform creds configured. Nagad is never an option.
 * - state: verified_paid (from a verified txn row) always wins;
 *   the latest txn otherwise maps initiated→pending,
 *   failed→failed, cancelled→cancelled; no txns → "none".
 * - order id + externalNumber must BOTH match (404 otherwise).
 * - a failed initiation leaves the order untouched (still COD,
 *   unpaid) with a "failed" transaction row — never a paid mark.
 */

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if ("in" in v) return v.in.includes(row[k]);
      return true;
    }
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
    return row[k] === v;
  });
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {}))[0] ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    findUnique: async ({ where }: any) => rows.filter((r) => matches(r, where ?? {}))[0] ?? null,
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (row) Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => matches(r, where));
      if (idx < 0) throw new Error("Record to delete does not exist.");
      return rows.splice(idx, 1)[0];
    },
    deleteMany: async () => ({ count: 0 }),
  };
}

const SSL = { storeId: "mystore", storePass: "store-pass-secret", sandbox: true };
const BKASH = { username: "01700000000", password: "bkash-pass-secret", appKey: "appkey1", appSecret: "appsecret-secret", sandbox: false };
const PLATFORM_SSL = { storeId: "platformstore", storePass: "platform-pass-secret", sandbox: true };

function snapshot(opts: { ssl?: boolean } = {}) {
  setPlatformConfigSnapshot({
    llm: null, metaApp: null, smtp: null, sms: null,
    sslcommerz: opts.ssl === false ? null : { ...PLATFORM_SSL },
    bkash: null,
    wallet: { feeBps: 0 },
    loadedAt: Date.now(),
  } as any);
}

function gatewayStub(overrides: any = {}) {
  return {
    bkashGrantToken: async () => "token-1",
    bkashCreatePayment: async () => ({ statusCode: "0000", bkashURL: "https://bkash.example/pay", paymentID: "PAY123" }),
    bkashExecutePayment: async () => ({ statusCode: "0000", transactionStatus: "Completed", amount: "150.00", currency: "BDT", trxID: "TRX1" }),
    bkashQueryPayment: async () => ({ statusCode: "0000", transactionStatus: "Completed", amount: "150.00", currency: "BDT", trxID: "TRX1" }),
    sslInitSession: async () => ({ status: "SUCCESS", GatewayPageURL: "https://ssl.example/pay", sessionkey: "SK1" }),
    sslValidate: async () => ({ status: "VALID", tran_id: "", amount: "150.00", currency: "BDT", store_id: SSL.storeId }),
    ...overrides,
  };
}

function build(stub: any = gatewayStub()) {
  const tables: any = {
    tenantPaymentGateway: makeTable("gw"),
    tenantPaymentTransaction: makeTable("txn"),
    platformPaymentEnablement: makeTable("enab"),
    walletAccount: makeTable("wallet"),
    walletTransaction: makeTable("ledger"),
    payoutRequest: makeTable("payout"),
    order: makeTable("order"),
    organization: makeTable("org"),
    customer: makeTable("cust"),
  };
  tables.$transaction = async (fn: any) => fn(tables);
  tables.organization.rows.push({ id: "org-1", slug: "myshop", name: "My Shop" });
  tables.order.rows.push({
    id: "order-1", organizationId: "org-1", totalMinor: 15000n, currency: "BDT",
    isCod: true, paymentMethod: "cod", internalNote: null, externalNumber: "ORD-1", isPractice: false,
  });
  const audit = { log: async () => undefined } as any;
  const wallet = new WalletService(tables as any, audit);
  const svc = new TenantPaymentsService(tables as any, audit, stub, wallet);
  return { svc, tables, wallet };
}

describe("GC10 publicPaymentOptions — real initiation gates", () => {
  it("no gateways configured → no online options", async () => {
    snapshot({ ssl: false });
    const { svc } = build();
    await expect(svc.publicPaymentOptions("org-1")).resolves.toEqual({ online: [], options: [] });
  });

  it("own sslcommerz enabled → own option with its sandbox flag; nagad config is never an option", async () => {
    snapshot({ ssl: false });
    const { svc } = build();
    await svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL });
    await svc.putGateway("org-1", "owner", "nagad", { merchantId: "M1", privateKey: "pk" });
    const out = await svc.publicPaymentOptions("org-1");
    expect(out.online).toEqual([{ provider: "sslcommerz", source: "own", sandbox: true }]);
    expect(out.online.some((o) => (o.provider as string) === "nagad")).toBe(false);
  });

  it("own gateway disabled → absent (mirrors initiate's refusal)", async () => {
    snapshot({ ssl: false });
    const { svc } = build();
    await svc.putGateway("org-1", "owner", "bkash", { ...BKASH });
    let out = await svc.publicPaymentOptions("org-1");
    expect(out.online).toEqual([{ provider: "bkash", source: "own", sandbox: false }]);
    await svc.setGatewayEnabled("org-1", "owner", "bkash", false);
    out = await svc.publicPaymentOptions("org-1");
    expect(out.online).toEqual([]);
  });

  it("platform: enablement on + platform creds → platform option; creds missing → absent even when enabled", async () => {
    const { svc, tables } = build();
    tables.platformPaymentEnablement.rows.push({ id: "e1", organizationId: "org-1", provider: "sslcommerz", isEnabled: true });
    snapshot({ ssl: true });
    let out = await svc.publicPaymentOptions("org-1");
    expect(out.online).toEqual([{ provider: "sslcommerz", source: "platform", sandbox: true }]);
    snapshot({ ssl: false });
    out = await svc.publicPaymentOptions("org-1");
    expect(out.online).toEqual([]);
  });

  it("platform: creds configured but tenant enablement off → absent", async () => {
    snapshot({ ssl: true });
    const { svc } = build();
    await expect(svc.publicPaymentOptions("org-1")).resolves.toEqual({ online: [], options: [] });
  });

  it("assertPublicPaymentOption: offered pair passes, unoffered pair → 400", async () => {
    snapshot({ ssl: false });
    const { svc } = build();
    await svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL });
    await expect(svc.assertPublicPaymentOption("org-1", { provider: "sslcommerz", source: "own" }))
      .resolves.toEqual({ provider: "sslcommerz", source: "own" });
    await expect(svc.assertPublicPaymentOption("org-1", { provider: "sslcommerz", source: "platform" }))
      .rejects.toBeInstanceOf(ApiException);
    await expect(svc.assertPublicPaymentOption("org-1", { provider: "bkash", source: "own" }))
      .rejects.toBeInstanceOf(ApiException);
  });
});

describe("GC10 publicPaymentState — honest polling state", () => {
  function seedTxn(tables: any, over: any) {
    tables.tenantPaymentTransaction.rows.push({
      id: over.id, organizationId: "org-1", orderId: "order-1", provider: "sslcommerz",
      source: "own", status: "initiated", amountMinor: 15000n, currency: "BDT",
      createdAt: new Date(), updatedAt: new Date(), ...over,
    });
  }

  it("no transactions → none", async () => {
    const { svc } = build();
    // AB4: every state return carries the deposit block (null
    // when the order has no deposit stamp).
    await expect(svc.publicPaymentState("myshop", "order-1", "ORD-1")).resolves.toEqual({ state: "none", deposit: null });
  });

  it("latest initiated → pending (a browser return never upgrades it)", async () => {
    const { svc, tables } = build();
    seedTxn(tables, { id: "t1", status: "initiated" });
    await expect(svc.publicPaymentState("myshop", "order-1", "ORD-1"))
      .resolves.toEqual({ state: "pending", provider: "sslcommerz", source: "own", deposit: null });
  });

  it("latest failed / cancelled map through", async () => {
    const { svc, tables } = build();
    seedTxn(tables, { id: "t1", status: "failed", createdAt: new Date(Date.now() - 1000) });
    await expect(svc.publicPaymentState("myshop", "order-1", "ORD-1"))
      .resolves.toMatchObject({ state: "failed" });
    seedTxn(tables, { id: "t2", status: "cancelled", createdAt: new Date(Date.now() + 1000) });
    await expect(svc.publicPaymentState("myshop", "order-1", "ORD-1"))
      .resolves.toMatchObject({ state: "cancelled" });
  });

  it("verified_paid wins even when a newer initiated txn exists", async () => {
    const { svc, tables } = build();
    seedTxn(tables, { id: "t1", status: "verified_paid", provider: "bkash", source: "platform", createdAt: new Date(Date.now() - 5000) });
    seedTxn(tables, { id: "t2", status: "initiated", createdAt: new Date() });
    await expect(svc.publicPaymentState("myshop", "order-1", "ORD-1"))
      .resolves.toEqual({ state: "verified_paid", provider: "bkash", source: "platform", deposit: null });
  });

  it("wrong orderNumber → 404; unknown slug → 404; unknown order → 404", async () => {
    const { svc } = build();
    await expect(svc.publicPaymentState("myshop", "order-1", "ORD-WRONG")).rejects.toBeInstanceOf(ApiException);
    await expect(svc.publicPaymentState("nope", "order-1", "ORD-1")).rejects.toBeInstanceOf(ApiException);
    await expect(svc.publicPaymentState("myshop", "order-x", "ORD-1")).rejects.toBeInstanceOf(ApiException);
  });
});

describe("GC10 initiation failure — clean unpaid order + failed txn", () => {
  it("gateway refusal at initiation: order stays COD/unpaid, txn row is failed, nothing verified", async () => {
    snapshot({ ssl: false });
    const stub = gatewayStub({
      sslInitSession: async () => ({ status: "FAILED", failed_reason: "Store id invalid" }),
    });
    const { svc, tables } = build(stub);
    await svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL });
    await expect(svc.initiatePublicPayment("myshop", "order-1", "ORD-1", "sslcommerz"))
      .rejects.toBeInstanceOf(ApiException);
    expect(tables.tenantPaymentTransaction.rows).toHaveLength(1);
    expect(tables.tenantPaymentTransaction.rows[0].status).toBe("failed");
    const order = tables.order.rows[0];
    expect(order.paymentMethod).toBe("cod");
    expect(order.isCod).toBe(true);
    await expect(svc.publicPaymentState("myshop", "order-1", "ORD-1"))
      .resolves.toMatchObject({ state: "failed" });
  });
});
