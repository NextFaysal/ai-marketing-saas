process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "cc10-test-secret";

import { createHash } from "node:crypto";
import { TenantPaymentsService } from "./tenant-payments.service";
import { WalletService } from "./wallet.service";
import { setPlatformConfigSnapshot } from "../common/platform-config";

/**
 * CC10 — Platform Payment + Wallet (stubbed gateway client at
 * the injectable boundary; platform credentials come from the
 * platform-config snapshot, exactly like production). Pinned
 * money rules:
 * - an unverified IPN credits NOTHING;
 * - a verified platform IPN credits gross − fee EXACTLY ONCE
 *   (payment_credit +gross, fee_debit −fee when fee > 0), and a
 *   re-delivered IPN is a no-op;
 * - fee math is server-side from the CURRENT walletConfig
 *   (200 bps on 100000 minor = 2000 fee, 98000 net credit);
 * - payout holds: available = balance − Σ(pending|approved);
 *   two requests cannot jointly exceed the balance; rejection
 *   or cancellation frees the hold;
 * - approve re-validates; mark-paid debits EXACTLY ONCE inside
 *   a transaction and cannot overdraw even if the balance
 *   changed after approval;
 * - a tenant can never forge a credit (no tenant path creates
 *   ledger rows);
 * - admin adjustment requires a note and records the actor.
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

const PLATFORM_SSL = { storeId: "platformstore", storePass: "platform-pass-secret", sandbox: true };
const PLATFORM_BKASH = { appKey: "platkey", appSecret: "platsecret", username: "platuser", password: "platpass", sandbox: true };

function snapshot(opts: { ssl?: boolean; bkash?: boolean; feeBps?: number } = {}) {
  setPlatformConfigSnapshot({
    llm: null, metaApp: null, smtp: null, sms: null,
    sslcommerz: opts.ssl === false ? null : { ...PLATFORM_SSL },
    bkash: opts.bkash === false ? null : { ...PLATFORM_BKASH },
    wallet: { feeBps: opts.feeBps ?? 0 },
    loadedAt: Date.now(),
  } as any);
}

function gatewayStub(overrides: any = {}) {
  return {
    bkashGrantToken: async () => "token-1",
    bkashCreatePayment: async () => ({ statusCode: "0000", bkashURL: "https://bkash.example/pay", paymentID: "PLATPAY1" }),
    bkashExecutePayment: async () => ({ statusCode: "0000", transactionStatus: "Completed", amount: "1000.00", currency: "BDT", trxID: "PTRX1" }),
    bkashQueryPayment: async () => ({ statusCode: "0000", transactionStatus: "Completed", amount: "1000.00", currency: "BDT", trxID: "PTRX1" }),
    sslInitSession: async () => ({ status: "SUCCESS", GatewayPageURL: "https://ssl.example/pay", sessionkey: "SK1" }),
    sslValidate: async () => ({ status: "VALID", tran_id: "", amount: "1000.00", currency: "BDT", store_id: PLATFORM_SSL.storeId }),
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
    id: "order-1", organizationId: "org-1", totalMinor: 100000n, currency: "BDT",
    isCod: true, paymentMethod: "cod", internalNote: null, externalNumber: "ORD-1", isPractice: false,
  });
  const auditLogs: any[] = [];
  const audit = { log: async (entry: any) => { auditLogs.push(entry); } } as any;
  const wallet = new WalletService(tables as any, audit);
  const payments = new TenantPaymentsService(tables as any, audit, stub, wallet);
  return { tables, auditLogs, wallet, payments, stub };
}

function signIpn(storePass: string, body: Record<string, any>): string {
  let acc = createHash("md5").update(storePass).digest("hex");
  for (const field of String(body.verify_key).split(",").map((s) => s.trim()).filter(Boolean)) {
    acc += String(body[field] ?? "");
  }
  return createHash("md5").update(acc).digest("hex");
}

function validIpnBody(tranId: string, pass = PLATFORM_SSL.storePass) {
  const body: Record<string, any> = {
    tran_id: tranId, val_id: "VAL1", status: "VALID", amount: "1000.00", currency: "BDT",
    verify_key: "tran_id,val_id,status,amount,currency",
  };
  body.verify_sign = signIpn(pass, body);
  return body;
}

async function enableAndInitiateSsl(b: any) {
  await b.wallet.setPlatformEnabled("org-1", "owner", "sslcommerz", true);
  return b.payments.initiatePlatformOrderPayment("org-1", "order-1", "sslcommerz");
}

async function payOrderViaSsl(b: any, feeBps = 200) {
  snapshot({ feeBps });
  const out: any = await enableAndInitiateSsl(b);
  b.stub.sslValidate = async () => ({ status: "VALID", tran_id: out.providerTxnId, amount: "1000.00", currency: "BDT", store_id: PLATFORM_SSL.storeId });
  const res: any = await b.payments.handleSslIpn(validIpnBody(out.providerTxnId));
  return { out, res };
}

describe("CC10 enablement — only what the platform actually offers", () => {
  it("refuses to enable a provider the platform has not configured", async () => {
    snapshot({ ssl: false });
    const b = build();
    await expect(b.wallet.setPlatformEnabled("org-1", "owner", "sslcommerz", true)).rejects.toThrow(/কনফিগার করা হয়নি/);
    const list: any = await b.wallet.listPlatformPayments("org-1");
    expect(list.providers.find((p: any) => p.provider === "sslcommerz").offered).toBe(false);
  });

  it("enables a configured provider; nagad can never be a platform gateway", async () => {
    snapshot({});
    const b = build();
    const list: any = await b.wallet.setPlatformEnabled("org-1", "owner", "sslcommerz", true);
    expect(list.providers.find((p: any) => p.provider === "sslcommerz").enabled).toBe(true);
    await expect(b.wallet.setPlatformEnabled("org-1", "owner", "nagad", true)).rejects.toThrow(/Nagad/);
  });

  it("initiation refuses when not enabled, and when the platform config disappears", async () => {
    snapshot({});
    const b = build();
    await expect(b.payments.initiatePlatformOrderPayment("org-1", "order-1", "sslcommerz")).rejects.toThrow(/চালু করেননি/);
    await b.wallet.setPlatformEnabled("org-1", "owner", "sslcommerz", true);
    snapshot({ ssl: false });
    await expect(b.payments.initiatePlatformOrderPayment("org-1", "order-1", "sslcommerz")).rejects.toThrow(/কনফিগার করা হয়নি/);
    expect(b.tables.tenantPaymentTransaction.rows).toHaveLength(0);
  });
});

describe("CC10 platform checkout + verified credit", () => {
  it("initiation records a source=platform txn with no tenant gateway and does NOT credit", async () => {
    snapshot({});
    const b = build();
    const out: any = await enableAndInitiateSsl(b);
    expect(out.redirectUrl).toBe("https://ssl.example/pay");
    const txn = b.tables.tenantPaymentTransaction.rows[0];
    expect(txn.source).toBe("platform");
    expect(txn.gatewayId).toBeNull();
    expect(txn.status).toBe("initiated");
    expect(b.tables.walletTransaction.rows).toHaveLength(0);
    expect(b.tables.walletAccount.rows).toHaveLength(0);
  });

  it("an unverified IPN (bad signature / unconfirmed validation) credits nothing", async () => {
    snapshot({ feeBps: 200 });
    const b = build();
    const out: any = await enableAndInitiateSsl(b);
    const bad = validIpnBody(out.providerTxnId, "wrong-pass");
    expect((await b.payments.handleSslIpn(bad)).ok).toBe(false);
    b.stub.sslValidate = async () => ({ status: "INVALID", tran_id: out.providerTxnId });
    expect((await b.payments.handleSslIpn(validIpnBody(out.providerTxnId))).ok).toBe(false);
    expect(b.tables.tenantPaymentTransaction.rows[0].status).toBe("initiated");
    expect(b.tables.walletTransaction.rows).toHaveLength(0);
    expect(b.tables.walletAccount.rows).toHaveLength(0);
  });

  it("verified IPN credits gross then fee (200 bps on 100000 = 2000 fee, 98000 net), exactly once", async () => {
    const b = build();
    const { out, res } = await payOrderViaSsl(b, 200);
    expect(res.ok).toBe(true);
    const wallet = b.tables.walletAccount.rows[0];
    expect(String(wallet.balanceMinor)).toBe("98000");
    const ledger = b.tables.walletTransaction.rows;
    expect(ledger).toHaveLength(2);
    const credit = ledger.find((r: any) => r.type === "payment_credit");
    const fee = ledger.find((r: any) => r.type === "fee_debit");
    expect(String(credit.amountMinor)).toBe("100000");
    expect(String(credit.balanceAfterMinor)).toBe("100000");
    expect(credit.refId).toBe(b.tables.tenantPaymentTransaction.rows[0].id);
    expect(String(fee.amountMinor)).toBe("-2000");
    expect(String(fee.balanceAfterMinor)).toBe("98000");
    expect(b.tables.order.rows[0].paymentMethod).toBe("sslcommerz");
    // re-delivery is a no-op
    const again: any = await b.payments.handleSslIpn(validIpnBody(out.providerTxnId));
    expect(again.alreadyProcessed).toBe(true);
    expect(b.tables.walletTransaction.rows).toHaveLength(2);
    expect(String(b.tables.walletAccount.rows[0].balanceMinor)).toBe("98000");
    const view: any = await b.wallet.getWallet("org-1");
    expect(view.balanceMinor).toBe("98000");
    expect(view.feeBps).toBe(200);
  });

  it("feeBps 0 produces exactly one ledger row and the full credit", async () => {
    const b = build();
    await payOrderViaSsl(b, 0);
    expect(b.tables.walletTransaction.rows).toHaveLength(1);
    expect(String(b.tables.walletAccount.rows[0].balanceMinor)).toBe("100000");
  });

  it("bKash platform callback credits only after execute confirms Completed + exact amount", async () => {
    snapshot({ feeBps: 0 });
    const b = build();
    await b.wallet.setPlatformEnabled("org-1", "owner", "bkash", true);
    const out: any = await b.payments.initiatePlatformOrderPayment("org-1", "order-1", "bkash", { customerPhone: "01700000000" });
    expect(out.redirectUrl).toBe("https://bkash.example/pay");
    expect(b.tables.walletTransaction.rows).toHaveLength(0);
    const url = await b.payments.handleBkashCallback({ paymentID: "PLATPAY1", status: "success" });
    expect(url).toContain("payment=received");
    expect(b.tables.tenantPaymentTransaction.rows[0].status).toBe("verified_paid");
    expect(String(b.tables.walletAccount.rows[0].balanceMinor)).toBe("100000");
  });
});

describe("CC10 payout holds + admin decision chain", () => {
  async function funded() {
    const b = build();
    await payOrderViaSsl(b, 200); // balance 98000
    return b;
  }
  const bkashDest = { number: "01700000000" };

  it("a request above available is refused; two pending requests cannot jointly exceed the balance", async () => {
    const b = await funded();
    await expect(b.wallet.createPayoutRequest("org-1", "owner", { amountMinor: "99000", method: "bkash", destination: bkashDest })).rejects.toThrow(/উপলব্ধ/);
    const a: any = await b.wallet.createPayoutRequest("org-1", "owner", { amountMinor: "60000", method: "bkash", destination: bkashDest });
    expect(a.status).toBe("pending");
    await expect(b.wallet.createPayoutRequest("org-1", "owner", { amountMinor: "40000", method: "bkash", destination: bkashDest })).rejects.toThrow(/উপলব্ধ/);
    const view: any = await b.wallet.getWallet("org-1");
    expect(view.heldMinor).toBe("60000");
    expect(view.availableMinor).toBe("38000");
  });

  it("cancelling a pending request frees its hold", async () => {
    const b = await funded();
    const a: any = await b.wallet.createPayoutRequest("org-1", "owner", { amountMinor: "60000", method: "bkash", destination: bkashDest });
    await b.wallet.cancelPayoutRequest("org-1", "owner", a.id);
    const ok: any = await b.wallet.createPayoutRequest("org-1", "owner", { amountMinor: "90000", method: "bkash", destination: bkashDest });
    expect(ok.status).toBe("pending");
  });

  it("approve → mark-paid debits exactly once; a second mark-paid refuses", async () => {
    const b = await funded();
    const a: any = await b.wallet.createPayoutRequest("org-1", "owner", { amountMinor: "50000", method: "bkash", destination: bkashDest });
    await expect(b.wallet.adminMarkPaid({ id: "admin-1" }, a.id, "REF1")).rejects.toThrow(/approved/);
    await b.wallet.adminDecidePayout({ id: "admin-1" }, a.id, "approve");
    await expect(b.wallet.adminMarkPaid({ id: "admin-1" }, a.id, "")).rejects.toThrow(/payoutRef/);
    const paid: any = await b.wallet.adminMarkPaid({ id: "admin-1" }, a.id, "BK-REF-9");
    expect(paid.status).toBe("paid");
    expect(paid.payoutRef).toBe("BK-REF-9");
    expect(String(b.tables.walletAccount.rows[0].balanceMinor)).toBe("48000");
    const debits = b.tables.walletTransaction.rows.filter((r: any) => r.type === "payout_debit");
    expect(debits).toHaveLength(1);
    expect(String(debits[0].amountMinor)).toBe("-50000");
    await expect(b.wallet.adminMarkPaid({ id: "admin-1" }, a.id, "BK-REF-10")).rejects.toThrow(/ইতিমধ্যে paid/);
    expect(b.tables.walletTransaction.rows.filter((r: any) => r.type === "payout_debit")).toHaveLength(1);
  });

  it("mark-paid cannot overdraw when the balance dropped after approval", async () => {
    const b = await funded();
    const a: any = await b.wallet.createPayoutRequest("org-1", "owner", { amountMinor: "90000", method: "bkash", destination: bkashDest });
    await b.wallet.adminDecidePayout({ id: "admin-1" }, a.id, "approve");
    await b.wallet.adminAdjustWallet({ id: "admin-1" }, "org-1", { amountMinor: "-50000", note: "চার্জব্যাক সংশোধন" });
    expect(String(b.tables.walletAccount.rows[0].balanceMinor)).toBe("48000");
    await expect(b.wallet.adminMarkPaid({ id: "admin-1" }, a.id, "REF-X")).rejects.toThrow(/যথেষ্ট নয়/);
    expect(String(b.tables.walletAccount.rows[0].balanceMinor)).toBe("48000");
    expect(b.tables.walletTransaction.rows.filter((r: any) => r.type === "payout_debit")).toHaveLength(0);
  });

  it("reject requires a note and frees the hold", async () => {
    const b = await funded();
    const a: any = await b.wallet.createPayoutRequest("org-1", "owner", { amountMinor: "50000", method: "bkash", destination: bkashDest });
    await expect(b.wallet.adminDecidePayout({ id: "admin-1" }, a.id, "reject")).rejects.toThrow(/note/);
    const rej: any = await b.wallet.adminDecidePayout({ id: "admin-1" }, a.id, "reject", "গন্তব্য নম্বর যাচাই হয়নি");
    expect(rej.status).toBe("rejected");
    const view: any = await b.wallet.getWallet("org-1");
    expect(view.availableMinor).toBe("98000");
  });

  it("a tenant cannot forge a credit: payout paths never create ledger rows, negative amounts refuse", async () => {
    const b = await funded();
    const before = b.tables.walletTransaction.rows.length;
    await expect(b.wallet.createPayoutRequest("org-1", "owner", { amountMinor: "-5000", method: "bkash", destination: bkashDest })).rejects.toThrow();
    await expect(b.wallet.createPayoutRequest("org-1", "owner", { amountMinor: "0", method: "bkash", destination: bkashDest })).rejects.toThrow();
    await b.wallet.createPayoutRequest("org-1", "owner", { amountMinor: "1000", method: "bkash", destination: bkashDest });
    expect(b.tables.walletTransaction.rows).toHaveLength(before);
    expect(String(b.tables.walletAccount.rows[0].balanceMinor)).toBe("98000");
  });

  it("admin adjustment requires a note, records the actor, and cannot drive the balance negative", async () => {
    const b = await funded();
    await expect(b.wallet.adminAdjustWallet({ id: "admin-9" }, "org-1", { amountMinor: "1000" })).rejects.toThrow(/note/);
    const entry: any = await b.wallet.adminAdjustWallet({ id: "admin-9" }, "org-1", { amountMinor: "2500", note: "ম্যানুয়াল সংশোধন — টিকেট #42" });
    expect(entry.type).toBe("adjustment");
    const row = b.tables.walletTransaction.rows.find((r: any) => r.type === "adjustment");
    expect(row.createdById).toBe("admin-9");
    expect(row.note).toContain("টিকেট #42");
    expect(String(b.tables.walletAccount.rows[0].balanceMinor)).toBe("100500");
    await expect(b.wallet.adminAdjustWallet({ id: "admin-9" }, "org-1", { amountMinor: "-999999", note: "x" })).rejects.toThrow(/নেগেটিভ/);
    expect(b.auditLogs.some((l: any) => l.action === "admin.wallet_adjustment")).toBe(true);
  });
});
