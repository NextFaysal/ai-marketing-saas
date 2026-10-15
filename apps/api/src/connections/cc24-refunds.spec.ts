process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "test-secret-cc24";

import { TenantPaymentsService } from "./tenant-payments.service";
import { PaymentRefundsService } from "./payment-refunds.service";
import { encryptJson } from "../integrations/crypto";
import { setPlatformConfigSnapshot } from "../common/platform-config";

/**
 * CC24 — gateway refunds (stubbed gateway client at the
 * injectable boundary). Pinned money rules:
 * - initiation NEVER marks anything refunded and touches
 *   neither the order nor the wallet — acceptance only moves
 *   the row to "processing" with the gateway's reference;
 * - ONLY a gateway status query confirming success moves a
 *   refund to "refunded", exactly once (a second refresh is a
 *   no-op with NO gateway call and NO repeated effects);
 * - cumulative verified + in-flight refunds NEVER exceed the
 *   paid amount (partial refunds allowed);
 * - a verified refund advances Order.refundedMinor (the EC5
 *   cumulative) and, for platform source ONLY, debits the
 *   wallet — the debit may take the balance NEGATIVE (platform
 *   receivable, documented);
 * - own-source refunds never touch the wallet;
 * - Nagad (no wired refund API), sandbox test transactions and
 *   unpaid transactions refuse honestly and create nothing.
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

const TENANT_SSL = { storeId: "mystore", storePass: "my-pass", sandbox: false };
const PLATFORM_BKASH = { appKey: "platkey", appSecret: "platsecret", username: "platuser", password: "platpass", sandbox: false };

function gatewayStub(overrides: any = {}) {
  const calls: Record<string, number> = {};
  const count = (k: string) => { calls[k] = (calls[k] ?? 0) + 1; };
  return {
    calls,
    bkashGrantToken: async () => "token-1",
    bkashCreatePayment: async () => ({ statusCode: "0000", bkashURL: "https://bkash.example/pay", paymentID: "PAY1" }),
    bkashExecutePayment: async () => ({ statusCode: "0000", transactionStatus: "Completed", amount: "1000.00", currency: "BDT", trxID: "TRX1" }),
    bkashQueryPayment: async () => ({ statusCode: "0000", transactionStatus: "Completed", amount: "1000.00", currency: "BDT", trxID: "TRX1" }),
    bkashRefundPayment: async () => { count("bkashRefund"); return { statusCode: "0000", statusMessage: "Successful", refundTrxID: "RTRX1", transactionStatus: "Completed", amount: "300.00" }; },
    bkashSearchTransaction: async () => { count("bkashSearch"); return { statusCode: "0000", trxID: "RTRX1", transactionStatus: "Completed", amount: "300.00" }; },
    sslInitSession: async () => ({ status: "SUCCESS", GatewayPageURL: "https://ssl.example/pay", sessionkey: "SK1" }),
    sslValidate: async () => ({ status: "VALID", tran_id: "", amount: "1000.00", currency: "BDT", store_id: TENANT_SSL.storeId, bank_tran_id: "BANK1" }),
    sslInitiateRefund: async () => { count("sslInitRefund"); return { APIConnect: "DONE", status: "success", refund_ref_id: "REF1" }; },
    sslRefundStatus: async () => { count("sslRefundStatus"); return { status: "refunded", refund_ref_id: "REF1" }; },
    ...overrides,
  };
}

function build(stub: any = gatewayStub()) {
  const tables: any = {
    tenantPaymentGateway: makeTable("gw"),
    tenantPaymentTransaction: makeTable("txn"),
    paymentRefund: makeTable("refund"),
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
  const auditLogs: any[] = [];
  const audit = { log: async (entry: any) => { auditLogs.push(entry); } } as any;
  const payments = new TenantPaymentsService(tables as any, audit, stub);
  const refunds = new PaymentRefundsService(tables as any, audit, payments, stub);
  return { tables, auditLogs, payments, refunds, stub };
}

function ownSslTxn(b: any, overrides: any = {}) {
  const txn = {
    id: "txn-ssl-1", organizationId: "org-1", gatewayId: "gw-ssl", orderId: "order-1",
    provider: "sslcommerz", source: "own", environment: "live", amountMinor: 100000n,
    currency: "BDT", status: "verified_paid", providerTxnId: "TP1", valId: "VAL1",
    ipnPayload: { ipn: { bank_tran_id: "BANK1" }, validation: { bank_tran_id: "BANK1", status: "VALID" } },
    ...overrides,
  };
  b.tables.tenantPaymentTransaction.rows.push(txn);
  return txn;
}

function addOrder(b: any, overrides: any = {}) {
  const order = {
    id: "order-1", organizationId: "org-1", totalMinor: 100000n, currency: "BDT",
    status: "processing", isCod: false, paymentMethod: "sslcommerz", internalNote: null,
    refundedMinor: 0n, externalNumber: "ORD-1", isPractice: false, ...overrides,
  };
  b.tables.order.rows.push(order);
  return order;
}

describe("CC24 gateway refunds — SSLCommerz (own gateway)", () => {
  it("initiation records processing + gateway ref and changes NOTHING else", async () => {
    const b = build();
    ownSslTxn(b); const order = addOrder(b);
    const out: any = await b.refunds.initiateRefund("org-1", "owner-1", "txn-ssl-1", {});
    expect(out.status).toBe("processing");
    expect(out.gatewayRefundRef).toBe("REF1");
    expect(out.amountMinor).toBe("100000"); // default = full remaining
    expect(order.refundedMinor).toBe(0n);
    expect(b.tables.walletTransaction.rows.length).toBe(0);
    expect(b.tables.walletAccount.rows.length).toBe(0);
  });

  it("only a gateway-confirmed status moves it to refunded — exactly once", async () => {
    let state = "processing";
    const stub = gatewayStub({ sslRefundStatus: async () => { stub.calls.sslRefundStatus = (stub.calls.sslRefundStatus ?? 0) + 1; return { status: state, refund_ref_id: "REF1" }; } });
    const b = build(stub);
    ownSslTxn(b); const order = addOrder(b);
    const initiated: any = await b.refunds.initiateRefund("org-1", "owner-1", "txn-ssl-1", {});
    // Gateway still processing → refresh changes nothing.
    const still: any = await b.refunds.refreshRefund("org-1", "owner-1", initiated.id);
    expect(still.status).toBe("processing");
    expect(order.refundedMinor).toBe(0n);
    // Gateway confirms → verified effects land.
    state = "refunded";
    const done: any = await b.refunds.refreshRefund("org-1", "owner-1", initiated.id);
    expect(done.status).toBe("refunded");
    expect(done.verifiedAt).toBeTruthy();
    expect(order.refundedMinor).toBe(100000n);
    expect(String(order.internalNote)).toContain(initiated.id);
    // Full refund from "processing" → order status auto-moves (EC5 rule).
    expect(order.status).toBe("refunded");
    // Second refresh: terminal — NO gateway call, NO repeated effect.
    const callsBefore = stub.calls.sslRefundStatus;
    const again: any = await b.refunds.refreshRefund("org-1", "owner-1", initiated.id);
    expect(again.status).toBe("refunded");
    expect(stub.calls.sslRefundStatus).toBe(callsBefore);
    expect(order.refundedMinor).toBe(100000n);
  });

  it("partial refunds accumulate; the cumulative cap (verified + in-flight) is enforced", async () => {
    const b = build();
    ownSslTxn(b); const order = addOrder(b);
    const r1: any = await b.refunds.initiateRefund("org-1", "owner-1", "txn-ssl-1", { amountMinor: "60000" });
    expect(r1.status).toBe("processing"); // in-flight 60000
    await expect(b.refunds.initiateRefund("org-1", "owner-1", "txn-ssl-1", { amountMinor: "50000" }))
      .rejects.toThrow(/বেশি হতে পারবে না/);
    const r2: any = await b.refunds.initiateRefund("org-1", "owner-1", "txn-ssl-1", { amountMinor: "40000" });
    expect(r2.status).toBe("processing"); // committed = 100000 now
    await expect(b.refunds.initiateRefund("org-1", "owner-1", "txn-ssl-1", { amountMinor: "1" }))
      .rejects.toThrow(/ইতিমধ্যে refund হয়ে গেছে বা প্রক্রিয়াধীন/);
    // Verify the first partially: order tracks 60000, stays processing.
    await b.refunds.refreshRefund("org-1", "owner-1", r1.id);
    expect(order.refundedMinor).toBe(60000n);
    expect(order.status).toBe("processing");
  });

  it("a full refund on a COMPLETED order keeps its status (EC5 exception list)", async () => {
    const b = build();
    ownSslTxn(b); const order = addOrder(b, { status: "completed" });
    const r: any = await b.refunds.initiateRefund("org-1", "owner-1", "txn-ssl-1", {});
    await b.refunds.refreshRefund("org-1", "owner-1", r.id);
    expect(order.refundedMinor).toBe(100000n);
    expect(order.status).toBe("completed");
  });

  it("gateway refusal at initiation records a FAILED row with the raw answer verbatim", async () => {
    const stub = gatewayStub({ sslInitiateRefund: async () => ({ status: "failed", errorReason: "Refund amount exceeds settled amount" }) });
    const b = build(stub);
    ownSslTxn(b); addOrder(b);
    await expect(b.refunds.initiateRefund("org-1", "owner-1", "txn-ssl-1", {}))
      .rejects.toThrow(/Refund amount exceeds settled amount/);
    const rows = b.tables.paymentRefund.rows;
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].gatewayStatusRaw).toEqual({ status: "failed", errorReason: "Refund amount exceeds settled amount" });
  });

  it("gateway 'cancelled' on refresh marks failed with no order/wallet effect", async () => {
    const stub = gatewayStub({ sslRefundStatus: async () => ({ status: "cancelled", refund_ref_id: "REF1" }) });
    const b = build(stub);
    ownSslTxn(b); const order = addOrder(b);
    const r: any = await b.refunds.initiateRefund("org-1", "owner-1", "txn-ssl-1", {});
    const out: any = await b.refunds.refreshRefund("org-1", "owner-1", r.id);
    expect(out.status).toBe("failed");
    expect(order.refundedMinor).toBe(0n);
    expect(b.tables.walletTransaction.rows.length).toBe(0);
  });

  it("refuses honestly: nagad, sandbox, unpaid, and missing bank_tran_id create nothing", async () => {
    const b = build();
    ownSslTxn(b, { id: "txn-nagad", provider: "nagad", ipnPayload: null });
    ownSslTxn(b, { id: "txn-sandbox", environment: "sandbox" });
    ownSslTxn(b, { id: "txn-unpaid", status: "initiated" });
    ownSslTxn(b, { id: "txn-noref", ipnPayload: { ipn: {}, validation: {} } });
    await expect(b.refunds.initiateRefund("org-1", "owner-1", "txn-nagad", {})).rejects.toThrow(/Nagad/);
    await expect(b.refunds.initiateRefund("org-1", "owner-1", "txn-sandbox", {})).rejects.toThrow(/Sandbox/);
    await expect(b.refunds.initiateRefund("org-1", "owner-1", "txn-unpaid", {})).rejects.toThrow(/verified_paid/);
    await expect(b.refunds.initiateRefund("org-1", "owner-1", "txn-noref", {})).rejects.toThrow(/bank_tran_id/);
    expect(b.tables.paymentRefund.rows.length).toBe(0);
  });
});

describe("CC24 gateway refunds — bKash (platform gateway) + wallet debit-back", () => {
  function platformBkashTxn(b: any, overrides: any = {}) {
    setPlatformConfigSnapshot({
      llm: null, metaApp: null, smtp: null, sms: null, sslcommerz: null,
      bkash: { ...PLATFORM_BKASH }, wallet: { feeBps: 0 }, loadedAt: Date.now(),
    } as any);
    const txn = {
      id: "txn-bk-1", organizationId: "org-1", gatewayId: null, orderId: "order-1",
      provider: "bkash", source: "platform", environment: "live", amountMinor: 100000n,
      currency: "BDT", status: "verified_paid", providerTxnId: "PAYID1", valId: null,
      ipnPayload: { executeOrQuery: { trxID: "TRX1", transactionStatus: "Completed" } },
      ...overrides,
    };
    b.tables.tenantPaymentTransaction.rows.push(txn);
    return txn;
  }

  it("verified platform refund debits the wallet exactly once", async () => {
    const b = build();
    platformBkashTxn(b); addOrder(b);
    b.tables.walletAccount.rows.push({ id: "wallet-1", organizationId: "org-1", currency: "BDT", balanceMinor: 100000n });
    const r: any = await b.refunds.initiateRefund("org-1", "owner-1", "txn-bk-1", { amountMinor: "30000" });
    expect(r.status).toBe("processing");
    expect(r.gatewayRefundRef).toBe("RTRX1");
    // Initiation alone moved no money.
    expect(b.tables.walletAccount.rows[0].balanceMinor).toBe(100000n);
    const done: any = await b.refunds.refreshRefund("org-1", "owner-1", r.id);
    expect(done.status).toBe("refunded");
    expect(b.tables.walletAccount.rows[0].balanceMinor).toBe(70000n);
    const ledger = b.tables.walletTransaction.rows;
    expect(ledger.length).toBe(1);
    expect(ledger[0].type).toBe("refund_debit");
    expect(ledger[0].amountMinor).toBe(-30000n);
    expect(ledger[0].balanceAfterMinor).toBe(70000n);
    expect(ledger[0].refId).toBe(r.id);
    // Refresh again — nothing repeats.
    await b.refunds.refreshRefund("org-1", "owner-1", r.id);
    expect(b.tables.walletTransaction.rows.length).toBe(1);
    expect(b.tables.walletAccount.rows[0].balanceMinor).toBe(70000n);
  });

  it("the platform debit MAY take the wallet negative — a plain receivable", async () => {
    const b = build();
    platformBkashTxn(b); addOrder(b);
    b.tables.walletAccount.rows.push({ id: "wallet-1", organizationId: "org-1", currency: "BDT", balanceMinor: 20000n });
    const r: any = await b.refunds.initiateRefund("org-1", "owner-1", "txn-bk-1", {});
    await b.refunds.refreshRefund("org-1", "owner-1", r.id);
    expect(b.tables.walletAccount.rows[0].balanceMinor).toBe(-80000n);
    expect(b.tables.walletTransaction.rows[0].balanceAfterMinor).toBe(-80000n);
  });

  it("a search answer naming a DIFFERENT trxID never verifies the refund", async () => {
    const stub = gatewayStub({ bkashSearchTransaction: async () => ({ statusCode: "0000", trxID: "SOMEONE-ELSE", transactionStatus: "Completed" }) });
    const b = build(stub);
    platformBkashTxn(b); addOrder(b);
    b.tables.walletAccount.rows.push({ id: "wallet-1", organizationId: "org-1", currency: "BDT", balanceMinor: 100000n });
    const r: any = await b.refunds.initiateRefund("org-1", "owner-1", "txn-bk-1", {});
    const out: any = await b.refunds.refreshRefund("org-1", "owner-1", r.id);
    expect(out.status).toBe("processing");
    expect(b.tables.walletAccount.rows[0].balanceMinor).toBe(100000n);
    expect(b.tables.walletTransaction.rows.length).toBe(0);
  });
});
