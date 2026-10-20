process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "test-secret-cc26b";

import { createHash } from "node:crypto";
import { TenantPaymentsService } from "./tenant-payments.service";
import { PaymentLinksService, hashPaymentLinkToken } from "./payment-links.service";
import { encryptJson } from "../integrations/crypto";
import { setPlatformConfigSnapshot } from "../common/platform-config";

/**
 * CC26(b) — shareable payment links. Pinned rules:
 * - the row stores ONLY sha256(token); the plaintext appears
 *   in the creation response and nowhere else (spec reads the
 *   stored row directly);
 * - links are live-only; creation refuses a paid order and a
 *   (provider, source) path that is not a real current option
 *   for the shop;
 * - the public read exposes shop name / order number / amount
 *   due — NO internal ids, NO hash, NO secrets;
 * - paying rides the existing public initiation + verified
 *   IPN chain: initiation alone changes NOTHING about the
 *   order or the link; only the verified IPN pays the order
 *   AND spends the link; a used / expired / revoked link can
 *   never initiate again.
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

const TENANT_SSL = { storeId: "mystore", storePass: "tenant-pass", sandbox: false };
const PLATFORM_SSL = { storeId: "platformstore", storePass: "platform-pass", sandbox: false };

function gatewayStub(overrides: any = {}) {
  return {
    bkashGrantToken: async () => "token-1",
    bkashCreatePayment: async () => ({ statusCode: "0000", bkashURL: "https://bkash.example/pay", paymentID: "PAY1" }),
    bkashExecutePayment: async () => ({ statusCode: "0000", transactionStatus: "Completed", amount: "1000.00", currency: "BDT", trxID: "TRX1" }),
    bkashQueryPayment: async () => ({ statusCode: "0000", transactionStatus: "Completed", amount: "1000.00", currency: "BDT", trxID: "TRX1" }),
    sslInitSession: async () => ({ status: "SUCCESS", GatewayPageURL: "https://ssl.example/pay", sessionkey: "SK1" }),
    sslValidate: async (_creds: any, _valId: string) => ({ status: "VALID", tran_id: "", amount: "1000.00", currency: "BDT", store_id: "", bank_tran_id: "BANK1" }),
    ...overrides,
  };
}

function build(stub: any = gatewayStub()) {
  const tables: any = {
    tenantPaymentGateway: makeTable("gw"),
    tenantPaymentTransaction: makeTable("txn"),
    paymentLink: makeTable("link"),
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
  tables.tenantPaymentGateway.rows.push({
    id: "gw-ssl", organizationId: "org-1", provider: "sslcommerz", environment: "live",
    encryptedData: encryptJson(TENANT_SSL), status: "verified", isEnabled: true,
  });
  tables.order.rows.push({
    id: "order-1", organizationId: "org-1", totalMinor: 100000n, currency: "BDT",
    isCod: true, paymentMethod: "cod", internalNote: null, externalNumber: "ORD-1", isPractice: false,
  });
  setPlatformConfigSnapshot({
    llm: null, metaApp: null, smtp: null, sms: null,
    sslcommerz: { ...PLATFORM_SSL }, bkash: null, wallet: { feeBps: 0 }, loadedAt: Date.now(),
  } as any);
  const auditLogs: any[] = [];
  const audit = { log: async (entry: any) => { auditLogs.push(entry); } } as any;
  const payments = new TenantPaymentsService(tables as any, audit, stub);
  const links = new PaymentLinksService(tables as any, audit, payments);
  return { tables, auditLogs, payments, links, stub };
}

function signIpn(storePass: string, body: Record<string, any>): string {
  let acc = createHash("md5").update(storePass).digest("hex");
  for (const field of String(body.verify_key).split(",").map((s) => s.trim()).filter(Boolean)) {
    acc += String(body[field] ?? "");
  }
  return createHash("md5").update(acc).digest("hex");
}

function validIpnBody(tranId: string, pass: string) {
  const body: Record<string, any> = {
    tran_id: tranId, val_id: "VAL1", status: "VALID", amount: "1000.00", currency: "BDT",
    verify_key: "tran_id,val_id,status,amount,currency",
  };
  body.verify_sign = signIpn(pass, body);
  return body;
}

/** Drive the created transaction to verified_paid via its IPN. */
async function payViaIpn(b: any, pass: string, storeId: string) {
  const txn = b.tables.tenantPaymentTransaction.rows[b.tables.tenantPaymentTransaction.rows.length - 1];
  b.stub.sslValidate = async () => ({ status: "VALID", tran_id: txn.providerTxnId, amount: "1000.00", currency: "BDT", store_id: storeId, bank_tran_id: "BANK1" });
  return b.payments.handleSslIpn(validIpnBody(txn.providerTxnId, pass));
}

describe("CC26 payment links — own gateway", () => {
  it("creation returns the token ONCE; the row stores only its sha256 hash", async () => {
    const b = build();
    const out: any = await b.links.createLink("org-1", "owner-1", { orderId: "order-1", provider: "sslcommerz" });
    expect(out.token).toMatch(/^[a-f0-9]{64}$/);
    expect(out.payUrl).toContain(`/pay/${out.token}`);
    expect(out.status).toBe("active");
    expect(out.environment).toBe("live");
    const row = b.tables.paymentLink.rows[0];
    expect(row.tokenHash).toBe(hashPaymentLinkToken(out.token));
    expect(row.tokenHash).toBe(createHash("sha256").update(out.token).digest("hex"));
    expect(JSON.stringify(row)).not.toContain(out.token);
    expect(out.tokenHash).toBeUndefined(); // the creation view itself carries no hash field
    const list: any = await b.links.listLinks("org-1");
    expect(JSON.stringify(list)).not.toContain(out.token);
    expect(JSON.stringify(list)).not.toContain(row.tokenHash);
  });

  it("public read: shop/order/amount only — no internal ids, no hash", async () => {
    const b = build();
    const out: any = await b.links.createLink("org-1", "owner-1", { orderId: "order-1", provider: "sslcommerz" });
    const pub: any = await b.links.getPublicLink(out.token);
    expect(pub.status).toBe("active");
    expect(pub.shopName).toBe("My Shop");
    expect(pub.orderNumber).toBe("ORD-1");
    expect(pub.amountDueMinor).toBe("100000");
    expect(pub.provider).toBe("sslcommerz");
    const serialized = JSON.stringify(pub);
    expect(serialized).not.toContain("org-1");
    expect(serialized).not.toContain("order-1");
    expect(serialized).not.toContain(b.tables.paymentLink.rows[0].tokenHash);
    await expect(b.links.getPublicLink("deadbeef".repeat(8))).rejects.toMatchObject({ code: "connections.paymentLinkNotFound" });
  });

  it("the full ride: initiation pays NOTHING; the verified IPN pays the order AND spends the link", async () => {
    const b = build();
    const out: any = await b.links.createLink("org-1", "owner-1", { orderId: "order-1", provider: "sslcommerz" });
    const started: any = await b.links.initiatePublicLink(out.token);
    expect(started.redirectUrl).toContain("ssl.example/pay");
    // Initiation alone: order untouched, link still active.
    const order = b.tables.order.rows[0];
    expect(order.paymentMethod).toBe("cod");
    expect(b.tables.paymentLink.rows[0].status).toBe("active");
    expect(b.tables.tenantPaymentTransaction.rows[0].status).toBe("initiated");
    // The verified IPN does both.
    const ipnRes: any = await payViaIpn(b, TENANT_SSL.storePass, TENANT_SSL.storeId);
    expect(ipnRes.ok).toBe(true);
    expect(b.tables.tenantPaymentTransaction.rows[0].status).toBe("verified_paid");
    expect(order.paymentMethod).toBe("sslcommerz");
    const linkRow = b.tables.paymentLink.rows[0];
    expect(linkRow.status).toBe("used");
    expect(linkRow.usedAt).toBeTruthy();
    // A used link can never initiate again.
    await expect(b.links.initiatePublicLink(out.token)).rejects.toThrow(/ইতিমধ্যে পেমেন্ট সম্পন্ন/);
    const pub: any = await b.links.getPublicLink(out.token);
    expect(pub.status).toBe("used");
  });

  it("an UNVERIFIED ipn spends nothing: forged signature leaves order unpaid and link active", async () => {
    const b = build();
    const out: any = await b.links.createLink("org-1", "owner-1", { orderId: "order-1", provider: "sslcommerz" });
    await b.links.initiatePublicLink(out.token);
    const txn = b.tables.tenantPaymentTransaction.rows[0];
    const forged = validIpnBody(txn.providerTxnId, "wrong-pass");
    const res: any = await b.payments.handleSslIpn(forged);
    expect(res.ok).toBe(false);
    expect(txn.status).toBe("initiated");
    expect(b.tables.paymentLink.rows[0].status).toBe("active");
    expect(b.tables.order.rows[0].paymentMethod).toBe("cod");
  });

  it("expired and revoked links refuse initiation and read honestly", async () => {
    const b = build();
    const out: any = await b.links.createLink("org-1", "owner-1", { orderId: "order-1", provider: "sslcommerz", expiresInHours: 1 });
    b.tables.paymentLink.rows[0].expiresAt = new Date(Date.now() - 60_000);
    const pub: any = await b.links.getPublicLink(out.token);
    expect(pub.status).toBe("expired");
    expect(b.tables.paymentLink.rows[0].status).toBe("expired"); // lazily persisted
    await expect(b.links.initiatePublicLink(out.token)).rejects.toThrow(/মেয়াদ শেষ/);

    const out2: any = await b.links.createLink("org-1", "owner-1", { orderId: "order-1", provider: "sslcommerz" });
    await b.links.revokeLink("org-1", "owner-1", out2.id);
    await expect(b.links.initiatePublicLink(out2.token)).rejects.toThrow(/বাতিল/);
    const pub2: any = await b.links.getPublicLink(out2.token);
    expect(pub2.status).toBe("revoked");
    await expect(b.links.revokeLink("org-1", "owner-1", out.id)).rejects.toThrow(/মেয়াদ ইতিমধ্যে শেষ/);
  });

  it("creation refuses: paid order, missing gateway path, bad expiry", async () => {
    const b = build();
    // bkash own path is NOT configured for this shop → the link could never work.
    await expect(b.links.createLink("org-1", "owner-1", { orderId: "order-1", provider: "bkash" }))
      .rejects.toThrow(/গেটওয়ে/);
    await expect(b.links.createLink("org-1", "owner-1", { orderId: "order-1", provider: "sslcommerz", expiresInHours: 24 * 31 }))
      .rejects.toThrow(/মেয়াদ/);
    // Pay the order through the ordinary public path, then a link must refuse.
    const started: any = await b.payments.initiatePublicPayment("myshop", "order-1", "ORD-1", "sslcommerz");
    expect(started.redirectUrl).toBeTruthy();
    await payViaIpn(b, TENANT_SSL.storePass, TENANT_SSL.storeId);
    await expect(b.links.createLink("org-1", "owner-1", { orderId: "order-1", provider: "sslcommerz" }))
      .rejects.toThrow(/ইতিমধ্যে যাচাইকৃতভাবে সম্পন্ন/);
    expect(b.tables.paymentLink.rows.length).toBe(0);
  });
});

describe("CC26 payment links — platform gateway", () => {
  it("platform link: verified IPN credits the wallet and spends the link", async () => {
    const b = build();
    b.tables.platformPaymentEnablement.rows.push({
      id: "enab-1", organizationId: "org-1", provider: "sslcommerz", isEnabled: true,
    });
    const out: any = await b.links.createLink("org-1", "owner-1", { orderId: "order-1", provider: "sslcommerz", source: "platform" });
    expect(out.source).toBe("platform");
    const started: any = await b.links.initiatePublicLink(out.token);
    expect(started.redirectUrl).toContain("ssl.example/pay");
    const res: any = await payViaIpn(b, PLATFORM_SSL.storePass, PLATFORM_SSL.storeId);
    expect(res.ok).toBe(true);
    // Wallet credited the gross (fee 0 in this snapshot) exactly once.
    const wallet = b.tables.walletAccount.rows[0];
    expect(wallet.balanceMinor).toBe(100000n);
    expect(b.tables.walletTransaction.rows.filter((r: any) => r.type === "payment_credit").length).toBe(1);
    expect(b.tables.paymentLink.rows[0].status).toBe("used");
  });

  it("platform link refuses when the tenant has not enabled the platform provider", async () => {
    const b = build();
    await expect(b.links.createLink("org-1", "owner-1", { orderId: "order-1", provider: "sslcommerz", source: "platform" }))
      .rejects.toThrow(/প্ল্যাটফর্ম/);
    expect(b.tables.paymentLink.rows.length).toBe(0);
  });
});
