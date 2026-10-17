process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "test-secret-ou5";

import "reflect-metadata";
import { TenantPaymentsService } from "./tenant-payments.service";
import { PaymentRefundsService, MANUAL_REFUND_TRACKING_LABEL } from "./payment-refunds.service";
import { ConnectionsController } from "./connections.controller";
import { ROLES_KEY } from "../common/decorators";
import { encryptJson } from "../integrations/crypto";

/**
 * OU5 — Refund Center (manual / API-less refunds).
 * Pinned rules:
 * - a manual refund lives on the SAME PaymentRefund rows and
 *   completes through the SAME applyVerifiedRefund bookkeeping
 *   as the CC24 gateway path (order refundedMinor + status
 *   mapping + platform wallet debit) — no second books;
 * - the flow is request (initiated) → record the provider
 *   dashboard action (provider reference REQUIRED → processing)
 *   → complete (refunded); each earlier step changes NOTHING
 *   about the order or wallet;
 * - duplicate completion is idempotent (no double effects);
 * - refresh/list NEVER gateway-refresh a manual row;
 * - the gateway API path (sslcommerz/bkash) is untouched, and
 *   both modes share ONE refundable cap.
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
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const r of rows) if (matches(r, where)) { Object.assign(r, data); count++; }
      return { count };
    },
  };
}

const TENANT_SSL = { storeId: "mystore", storePass: "my-pass", sandbox: false };

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
    shurjoGetToken: async () => ({ token: "t" }),
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

function paidTxn(b: any, overrides: any = {}) {
  const txn = {
    id: "txn-1", organizationId: "org-1", gatewayId: "gw-1", orderId: "order-1",
    provider: "shurjopay", source: "own", environment: "live", amountMinor: 100000n,
    currency: "BDT", status: "verified_paid", providerTxnId: "SP-1", valId: null,
    ipnPayload: { verification: { sp_code: "1000" } },
    ...overrides,
  };
  b.tables.tenantPaymentTransaction.rows.push(txn);
  return txn;
}

function addOrder(b: any, overrides: any = {}) {
  const order = {
    id: "order-1", organizationId: "org-1", totalMinor: 100000n, currency: "BDT",
    status: "processing", isCod: false, paymentMethod: "shurjopay", internalNote: null,
    refundedMinor: 0n, externalNumber: "ORD-1", isPractice: false, ...overrides,
  };
  b.tables.order.rows.push(order);
  return order;
}

describe("OU5 Refund Center — manual flow (ShurjoPay, no refund API)", () => {
  it("request → record → complete updates the order exactly like the shared bookkeeping", async () => {
    const b = build();
    paidTxn(b); const order = addOrder(b);

    const req: any = await b.refunds.createManualRefundRequest("org-1", "admin-1", "txn-1", { amountMinor: "40000", reason: "damaged" });
    expect(req.status).toBe("initiated");
    expect(req.mode).toBe("manual");
    expect(req.trackingLabel).toBe(MANUAL_REFUND_TRACKING_LABEL);
    expect(order.refundedMinor).toBe(0n); // request alone moves nothing

    // Cannot complete before the dashboard action is recorded.
    await expect(b.refunds.completeManualRefund("org-1", "admin-1", req.id)).rejects.toThrow(/আগে provider dashboard/);
    // Cannot record without a provider reference.
    await expect(b.refunds.recordManualRefundAction("org-1", "admin-1", req.id, { providerRef: "  " })).rejects.toThrow(/reference/);

    const rec: any = await b.refunds.recordManualRefundAction("org-1", "admin-1", req.id, { providerRef: "SP-RF-778", proofNote: "dashboard screenshot kept" });
    expect(rec.status).toBe("processing");
    expect(rec.manualProviderRef).toBe("SP-RF-778");
    expect(rec.manualProofNote).toBe("dashboard screenshot kept");
    expect(order.refundedMinor).toBe(0n); // recording alone still moves nothing

    const done: any = await b.refunds.completeManualRefund("org-1", "admin-1", req.id);
    expect(done.status).toBe("refunded");
    expect(done.verifiedAt).toBeTruthy();
    expect(order.refundedMinor).toBe(40000n);
    expect(order.status).toBe("processing"); // partial — status mapping unchanged
    expect(String(order.internalNote)).toContain("ম্যানুয়াল রিফান্ড রেকর্ডকৃত");
    expect(b.tables.walletTransaction.rows.length).toBe(0); // own source — wallet untouched

    const actions = b.auditLogs.map((l: any) => l.action);
    expect(actions).toContain("payment_refund.manual_requested");
    expect(actions).toContain("payment_refund.manual_recorded");
    expect(actions).toContain("payment_refund.verified");
  });

  it("a full manual refund moves the order to refunded; duplicate completion is idempotent", async () => {
    const b = build();
    paidTxn(b); const order = addOrder(b);
    const req: any = await b.refunds.createManualRefundRequest("org-1", "admin-1", "txn-1", {});
    expect(req.amountMinor).toBe("100000"); // default = full remaining
    await b.refunds.recordManualRefundAction("org-1", "admin-1", req.id, { providerRef: "SP-RF-1" });
    const done: any = await b.refunds.completeManualRefund("org-1", "admin-1", req.id);
    expect(done.status).toBe("refunded");
    expect(order.refundedMinor).toBe(100000n);
    expect(order.status).toBe("refunded");
    // Duplicate completion: returns as stored, NO double effect.
    const again: any = await b.refunds.completeManualRefund("org-1", "admin-1", req.id);
    expect(again.status).toBe("refunded");
    expect(order.refundedMinor).toBe(100000n);
    // Recording after completion is refused.
    await expect(b.refunds.recordManualRefundAction("org-1", "admin-1", req.id, { providerRef: "X" })).rejects.toThrow(/ইতিমধ্যে সম্পূর্ণ/);
  });

  it("Nagad manual tracking works while the Nagad API path still refuses; unpaid/sandbox refuse", async () => {
    const b = build();
    paidTxn(b, { id: "txn-nagad", provider: "nagad", ipnPayload: null });
    paidTxn(b, { id: "txn-unpaid", provider: "aamarpay", status: "initiated" });
    paidTxn(b, { id: "txn-sandbox", provider: "aamarpay", environment: "sandbox" });
    addOrder(b);
    await expect(b.refunds.initiateRefund("org-1", "admin-1", "txn-nagad", {})).rejects.toThrow(/Nagad/);
    const req: any = await b.refunds.createManualRefundRequest("org-1", "admin-1", "txn-nagad", { amountMinor: "1000" });
    expect(req.provider).toBe("nagad");
    expect(req.mode).toBe("manual");
    await expect(b.refunds.createManualRefundRequest("org-1", "admin-1", "txn-unpaid", {})).rejects.toThrow(/verified_paid/);
    await expect(b.refunds.createManualRefundRequest("org-1", "admin-1", "txn-sandbox", {})).rejects.toThrow(/Sandbox/);
  });

  it("refresh and list NEVER gateway-refresh a manual row", async () => {
    const b = build();
    paidTxn(b); addOrder(b);
    const req: any = await b.refunds.createManualRefundRequest("org-1", "admin-1", "txn-1", { amountMinor: "1000" });
    await b.refunds.recordManualRefundAction("org-1", "admin-1", req.id, { providerRef: "SP-RF-9" });
    const out: any = await b.refunds.refreshRefund("org-1", "admin-1", req.id);
    expect(out.status).toBe("processing"); // unchanged — no gateway exists to ask
    const list: any = await b.refunds.listRefunds("org-1", "admin-1", {});
    expect(list.refunds[0].status).toBe("processing");
    expect(b.stub.calls.sslRefundStatus ?? 0).toBe(0);
    expect(b.stub.calls.bkashSearch ?? 0).toBe(0);
  });
});

describe("OU5 Refund Center — shared cap + gateway path untouched", () => {
  it("manual in-flight consumes the SAME cap the gateway path checks", async () => {
    const b = build();
    paidTxn(b, { id: "txn-ssl", provider: "sslcommerz", ipnPayload: { ipn: { bank_tran_id: "BANK1" }, validation: { bank_tran_id: "BANK1", status: "VALID" } } });
    addOrder(b);
    const manual: any = await b.refunds.createManualRefundRequest("org-1", "admin-1", "txn-ssl", { amountMinor: "60000" });
    expect(manual.mode).toBe("manual");
    await expect(b.refunds.initiateRefund("org-1", "admin-1", "txn-ssl", { amountMinor: "50000" }))
      .rejects.toThrow(/বেশি হতে পারবে না/);
    const gw: any = await b.refunds.initiateRefund("org-1", "admin-1", "txn-ssl", { amountMinor: "40000" });
    expect(gw.status).toBe("processing"); // gateway path works exactly as CC24
    expect(gw.mode).toBe("gateway");
    expect(gw.gatewayRefundRef).toBe("REF1");
  });

  it("manual steps refuse on a gateway-mode row and vice versa", async () => {
    const b = build();
    paidTxn(b, { id: "txn-ssl", provider: "sslcommerz", ipnPayload: { ipn: { bank_tran_id: "BANK1" }, validation: { bank_tran_id: "BANK1", status: "VALID" } } });
    addOrder(b);
    const gw: any = await b.refunds.initiateRefund("org-1", "admin-1", "txn-ssl", {});
    await expect(b.refunds.recordManualRefundAction("org-1", "admin-1", gw.id, { providerRef: "X" })).rejects.toThrow(/ম্যানুয়াল \(Refund Center\) রিফান্ড নয়/);
    await expect(b.refunds.completeManualRefund("org-1", "admin-1", gw.id)).rejects.toThrow(/ম্যানুয়াল \(Refund Center\) রিফান্ড নয়/);
  });
});

describe("OU5 Refund Center — role gate (same floor as CC24 refund actions)", () => {
  it("all three manual endpoints carry @Roles(OWNER, ADMIN)", () => {
    expect(Reflect.getMetadata(ROLES_KEY, ConnectionsController.prototype.createManualRefund)).toEqual(["OWNER", "ADMIN"]);
    expect(Reflect.getMetadata(ROLES_KEY, ConnectionsController.prototype.recordManualRefund)).toEqual(["OWNER", "ADMIN"]);
    expect(Reflect.getMetadata(ROLES_KEY, ConnectionsController.prototype.completeManualRefund)).toEqual(["OWNER", "ADMIN"]);
    // …identical to the existing gateway refund actions.
    expect(Reflect.getMetadata(ROLES_KEY, ConnectionsController.prototype.initiateRefund)).toEqual(["OWNER", "ADMIN"]);
    expect(Reflect.getMetadata(ROLES_KEY, ConnectionsController.prototype.refreshRefund)).toEqual(["OWNER", "ADMIN"]);
  });
});
