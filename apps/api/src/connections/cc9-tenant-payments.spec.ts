process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "cc9-test-secret";

import { createHash } from "node:crypto";
import { TenantPaymentsService } from "./tenant-payments.service";
import { decryptJson } from "../integrations/crypto";

/**
 * CC9 — the tenant's OWN payment gateways (stubbed gateway client
 * at the injectable boundary; the wire shapes are the real M36 /
 * M39 ones). Pinned trust rules:
 * (a) an unverified IPN (bad signature / no validation
 *     confirmation) NEVER marks anything paid;
 * (b) amount / currency / store mismatches refuse;
 * (c) a verified IPN marks paid exactly once — re-delivery is a
 *     no-op (idempotent);
 * (d) a failed config verify saves nothing;
 * (e) secrets never appear in any response.
 * bKash: the browser callback alone proves nothing — only the
 * server-to-server execute/query "Completed" with the exact
 * amount marks paid.
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
    create: async ({ data }: any) => { const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
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
const BKASH = { username: "01700000000", password: "bkash-pass-secret", appKey: "appkey1", appSecret: "appsecret-secret", sandbox: true };

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

function buildService(stub: any = gatewayStub()) {
  const tables: any = {
    tenantPaymentGateway: makeTable("gw"),
    tenantPaymentTransaction: makeTable("txn"),
    order: makeTable("order"),
    organization: makeTable("org"),
    customer: makeTable("cust"),
  };
  tables.organization.rows.push({ id: "org-1", slug: "myshop", name: "My Shop" });
  tables.order.rows.push({
    id: "order-1", organizationId: "org-1", totalMinor: 15000n, currency: "BDT",
    isCod: true, paymentMethod: "cod", internalNote: null, externalNumber: "ORD-1", isPractice: false,
  });
  const auditLogs: any[] = [];
  const audit = { log: async (entry: any) => { auditLogs.push(entry); } } as any;
  const svc = new TenantPaymentsService(tables as any, audit, stub);
  return { svc, tables, auditLogs, stub };
}

function signIpn(storePass: string, body: Record<string, any>): string {
  let acc = createHash("md5").update(storePass).digest("hex");
  for (const field of String(body.verify_key).split(",").map((s) => s.trim()).filter(Boolean)) {
    acc += String(body[field] ?? "");
  }
  return createHash("md5").update(acc).digest("hex");
}

function validIpnBody(tranId: string, overrides: Record<string, any> = {}) {
  const body: Record<string, any> = {
    tran_id: tranId, val_id: "VAL1", status: "VALID", amount: "150.00", currency: "BDT",
    verify_key: "tran_id,val_id,status,amount,currency", ...overrides,
  };
  body.verify_sign = signIpn(SSL.storePass, body);
  return body;
}

async function seedSsl(svc: any) {
  return svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL });
}

describe("CC9 config — per-provider verification truth", () => {
  it("(d) bKash verify failure saves nothing", async () => {
    const stub = gatewayStub({ bkashGrantToken: async () => { throw new Error("bKash token grant failed: Invalid credentials"); } });
    const { svc, tables } = buildService(stub);
    await expect(svc.putGateway("org-1", "owner", "bkash", { ...BKASH })).rejects.toThrow("Invalid credentials");
    expect(tables.tenantPaymentGateway.rows).toHaveLength(0);
  });

  it("bKash verified on a real grant-token success; (e) secrets never in views", async () => {
    const { svc, tables } = buildService();
    const view: any = await svc.putGateway("org-1", "owner", "bkash", { ...BKASH });
    expect(view.status).toBe("verified");
    expect(view.verificationNote).toBe("verified_with_gateway");
    expect(view.identifier).toBe("appkey1");
    const raw = JSON.stringify(view);
    expect(raw).not.toContain(BKASH.password);
    expect(raw).not.toContain(BKASH.appSecret);
    expect(decryptJson(tables.tenantPaymentGateway.rows[0].encryptedData)).toMatchObject({ appKey: "appkey1" });
    const list: any = await svc.listGateways("org-1");
    expect(JSON.stringify(list)).not.toContain(BKASH.password);
    expect(JSON.stringify(list)).not.toContain(BKASH.appSecret);
  });

  it("SSLCommerz saves honestly as configured (no pre-transaction check exists)", async () => {
    const { svc } = buildService();
    const view: any = await seedSsl(svc);
    expect(view.status).toBe("configured");
    expect(view.verificationNote).toBe("no_pre_transaction_check");
    expect(JSON.stringify(view)).not.toContain(SSL.storePass);
  });

  it("Nagad saves as configured; Rocket is refused as a manual-number path", async () => {
    const { svc, tables } = buildService();
    const view: any = await svc.putGateway("org-1", "owner", "nagad", { merchantId: "M123", privateKey: "pk-secret" });
    expect(view.status).toBe("configured");
    expect(JSON.stringify(view)).not.toContain("pk-secret");
    await expect(svc.putGateway("org-1", "owner", "rocket", { merchantId: "x" })).rejects.toThrow(/ম্যানুয়াল/);
    expect(tables.tenantPaymentGateway.rows).toHaveLength(1);
  });

  it("enable/disable + delete round-trip", async () => {
    const { svc } = buildService();
    await seedSsl(svc);
    const off: any = await svc.setGatewayEnabled("org-1", "owner", "sslcommerz", false);
    expect(off.isEnabled).toBe(false);
    await svc.deleteGateway("org-1", "owner", "sslcommerz");
    const list: any = await svc.listGateways("org-1");
    expect(list.gateways).toHaveLength(0);
  });
});

describe("CC9 SSLCommerz checkout + IPN trust chain", () => {
  it("initiate records an initiated txn and does NOT mark the order paid", async () => {
    const { svc, tables } = buildService();
    await seedSsl(svc);
    const out: any = await svc.initiateOrderPayment("org-1", "order-1", "sslcommerz", { customerPhone: "01700000000" });
    expect(out.redirectUrl).toBe("https://ssl.example/pay");
    const txn = tables.tenantPaymentTransaction.rows[0];
    expect(txn.status).toBe("initiated");
    expect(txn.providerTxnId).toBe(out.providerTxnId);
    const order = tables.order.rows[0];
    expect(order.paymentMethod).toBe("cod");
    expect(order.isCod).toBe(true);
  });

  it("(a) IPN with a bad signature changes nothing", async () => {
    const { svc, tables } = buildService();
    await seedSsl(svc);
    const out: any = await svc.initiateOrderPayment("org-1", "order-1", "sslcommerz");
    const body = validIpnBody(out.providerTxnId);
    body.verify_sign = "deadbeef";
    const res: any = await svc.handleSslIpn(body);
    expect(res.ok).toBe(false);
    expect(tables.tenantPaymentTransaction.rows[0].status).toBe("initiated");
    expect(tables.order.rows[0].paymentMethod).toBe("cod");
  });

  it("(a) IPN whose validation call does not confirm changes nothing", async () => {
    const stub = gatewayStub({ sslValidate: async () => ({ status: "INVALID", tran_id: "x" }) });
    const { svc, tables } = buildService(stub);
    await seedSsl(svc);
    const out: any = await svc.initiateOrderPayment("org-1", "order-1", "sslcommerz");
    const res: any = await svc.handleSslIpn(validIpnBody(out.providerTxnId));
    expect(res.ok).toBe(false);
    expect(tables.tenantPaymentTransaction.rows[0].status).toBe("initiated");
  });

  it("(b) validated amount mismatch refuses", async () => {
    const stub = gatewayStub({
      sslValidate: async (_c: any, _v: string) => ({ status: "VALID", tran_id: stub._tranId, amount: "999.00", currency: "BDT", store_id: SSL.storeId }),
    });
    const { svc, tables } = buildService(stub);
    await seedSsl(svc);
    const out: any = await svc.initiateOrderPayment("org-1", "order-1", "sslcommerz");
    (stub as any)._tranId = out.providerTxnId;
    const res: any = await svc.handleSslIpn(validIpnBody(out.providerTxnId));
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/amount/);
    expect(tables.tenantPaymentTransaction.rows[0].status).toBe("initiated");
    expect(tables.order.rows[0].paymentMethod).toBe("cod");
  });

  it("(c) verified IPN marks paid exactly once; re-delivery is a no-op", async () => {
    const stub = gatewayStub();
    const { svc, tables } = buildService(stub);
    await seedSsl(svc);
    const out: any = await svc.initiateOrderPayment("org-1", "order-1", "sslcommerz");
    stub.sslValidate = async () => ({ status: "VALID", tran_id: out.providerTxnId, amount: "150.00", currency: "BDT", store_id: SSL.storeId });
    const body = validIpnBody(out.providerTxnId);
    const res1: any = await svc.handleSslIpn(body);
    expect(res1.ok).toBe(true);
    const txn = tables.tenantPaymentTransaction.rows[0];
    expect(txn.status).toBe("verified_paid");
    expect(txn.valId).toBe("VAL1");
    expect(txn.ipnPayload?.validation?.status).toBe("VALID");
    const order = tables.order.rows[0];
    expect(order.paymentMethod).toBe("sslcommerz");
    expect(order.isCod).toBe(false);
    const res2: any = await svc.handleSslIpn(body);
    expect(res2.alreadyProcessed).toBe(true);
    expect(String(order.internalNote).split(txn.id).length - 1).toBe(1);
    // and a fresh initiation is refused once paid
    await expect(svc.initiateOrderPayment("org-1", "order-1", "sslcommerz")).rejects.toThrow(/ইতিমধ্যে/);
  });
});

describe("CC9 bKash checkout + callback trust chain", () => {
  async function seedBkash(svc: any) { return svc.putGateway("org-1", "owner", "bkash", { ...BKASH }); }

  it("callback with status=success but unconfirmed execute does NOT mark paid", async () => {
    const stub = gatewayStub({
      bkashExecutePayment: async () => ({ statusCode: "0000", transactionStatus: "Initiated", amount: "150.00" }),
      bkashQueryPayment: async () => ({ statusCode: "0000", transactionStatus: "Initiated", amount: "150.00" }),
    });
    const { svc, tables } = buildService(stub);
    await seedBkash(svc);
    const out: any = await svc.initiateOrderPayment("org-1", "order-1", "bkash", { customerPhone: "01700000000" });
    expect(out.redirectUrl).toBe("https://bkash.example/pay");
    const url = await svc.handleBkashCallback({ paymentID: "PAY123", status: "success" });
    expect(url).toContain("payment=failed");
    expect(tables.tenantPaymentTransaction.rows[0].status).toBe("initiated");
    expect(tables.order.rows[0].paymentMethod).toBe("cod");
  });

  it("execute Completed with the exact amount marks paid; amount mismatch refuses", async () => {
    const stub = gatewayStub();
    const { svc, tables } = buildService(stub);
    await seedBkash(svc);
    await svc.initiateOrderPayment("org-1", "order-1", "bkash", { customerPhone: "01700000000" });
    // mismatch first
    stub.bkashExecutePayment = async () => ({ statusCode: "0000", transactionStatus: "Completed", amount: "10.00", currency: "BDT" });
    stub.bkashQueryPayment = async () => ({ statusCode: "0000", transactionStatus: "Completed", amount: "10.00", currency: "BDT" });
    const bad = await svc.handleBkashCallback({ paymentID: "PAY123", status: "success" });
    expect(bad).toContain("payment=failed");
    expect(tables.tenantPaymentTransaction.rows[0].status).toBe("initiated");
    // exact amount
    stub.bkashExecutePayment = async () => ({ statusCode: "0000", transactionStatus: "Completed", amount: "150.00", currency: "BDT", trxID: "TRX9" });
    const good = await svc.handleBkashCallback({ paymentID: "PAY123", status: "success" });
    expect(good).toContain("payment=received");
    expect(tables.tenantPaymentTransaction.rows[0].status).toBe("verified_paid");
    expect(tables.order.rows[0].paymentMethod).toBe("bkash");
  });

  it("public initiation requires the matching order number", async () => {
    const { svc } = buildService();
    await seedBkash(svc);
    await expect(svc.initiatePublicPayment("myshop", "order-1", "WRONG-NUM", "bkash")).rejects.toThrow("Order not found");
    const out: any = await svc.initiatePublicPayment("myshop", "order-1", "ORD-1", "bkash");
    expect(out.redirectUrl).toBe("https://bkash.example/pay");
  });

  it("Nagad initiation refuses honestly (no checkout wired)", async () => {
    const { svc } = buildService();
    await svc.putGateway("org-1", "owner", "nagad", { merchantId: "M1", privateKey: "pk" });
    await expect(svc.initiateOrderPayment("org-1", "order-1", "nagad")).rejects.toThrow(/সংযুক্ত নয়/);
  });
});
