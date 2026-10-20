process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "<MASKED_SECRET_001>";

import { createHash } from "node:crypto";
import { ApiException } from "../i18n";
import { BadRequestException, NotFoundException, ValidationPipe } from "@nestjs/common";
import { TenantPaymentsService } from "./tenant-payments.service";
import { WalletService } from "./wallet.service";
import { PaymentOpsService } from "./payment-ops.service";
import { PutPaymentGatewayDto } from "./connections.dto";
import { setPlatformConfigSnapshot } from "../common/platform-config";

/**
 * GC12 — Payment Ops. Pinned rules:
 * - TenantPaymentTransaction is the attempt record; failureReason
 *   bookkeeping is written at initiation failure + gateway
 *   failure recordings, truncated to 300 chars, and never breaks
 *   the payment path.
 * - Fee at verified_paid: own path from the gateway row's
 *   feeBps/feeFixedMinor when either is set (both null → fee/net
 *   stay null); platform path stamps the wallet credit's fee.
 * - putGateway fee columns follow KEY-PRESENCE: absent keys leave
 *   stored fees untouched, explicit null clears, invalid
 *   feeFixedMinor → 400. The ValidationPipe (whitelist+transform,
 *   main.ts settings) keeps declared present-but-null fields.
 * - "expired" is a derived label only — the stored status of an
 *   old initiated attempt stays "initiated".
 * - Fee report / settlements are null-aware (no fee rows → null,
 *   never 0) and settlements group by Asia/Dhaka day.
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
const PLATFORM_SSL = { storeId: "platformstore", storePass: "platform-pass-secret", sandbox: true };

function gatewayStub(overrides: any = {}) {
  return {
    bkashGrantToken: async () => "token-1",
    bkashCreatePayment: async () => ({ statusCode: "0000", bkashURL: "https://bkash.example/pay", paymentID: "PAY123" }),
    bkashExecutePayment: async () => ({ statusCode: "0000", transactionStatus: "Completed", amount: "150.00", currency: "BDT", trxID: "TRX1" }),
    bkashQueryPayment: async () => ({ statusCode: "0000", transactionStatus: "Completed", amount: "150.00", currency: "BDT", trxID: "TRX1" }),
    sslInitSession: async () => ({ status: "SUCCESS", GatewayPageURL: "https://ssl.example/pay", sessionkey: "SK1" }),
    sslValidate: async () => ({ status: "VALID", tran_id: "", amount: "150.00", currency: "BDT", store_id: SSL.storeId }),
    shurjoGetToken: async () => "sptoken-1",
    shurjoCreatePayment: async () => ({ checkout_url: "https://shurjo.example/pay", sp_order_id: "SPORD123" }),
    shurjoVerify: async () => ({ sp_code: "1000", amount: "150.00", currency: "BDT", sp_order_id: "SPORD123" }),
    aamarInit: async () => ({ result: "true", payment_url: "https://aamar.example/pay" }),
    aamarTrxCheck: async () => ({ pay_status: "Successful", amount: "150.00", currency: "BDT", status_code: "2" }),
    ...overrides,
  };
}

function build(stub: any = gatewayStub(), orderTotal: bigint = 15000n) {
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
    id: "order-1", organizationId: "org-1", totalMinor: orderTotal, currency: "BDT",
    isCod: true, paymentMethod: "cod", internalNote: null, externalNumber: "ORD-1", isPractice: false,
  });
  const auditLogs: any[] = [];
  const audit = { log: async (entry: any) => { auditLogs.push(entry); } } as any;
  const wallet = new WalletService(tables as any, audit);
  const svc = new TenantPaymentsService(tables as any, audit, stub, wallet);
  const ops = new PaymentOpsService(tables as any);
  return { svc, ops, tables, auditLogs, wallet, stub };
}

function signIpn(storePass: string, body: Record<string, any>): string {
  let acc = createHash("md5").update(storePass).digest("hex");
  for (const field of String(body.verify_key).split(",").map((s) => s.trim()).filter(Boolean)) {
    acc += String(body[field] ?? "");
  }
  return createHash("md5").update(acc).digest("hex");
}

function validIpnBody(tranId: string, storePass: string, amount: string, storeId: string, overrides: Record<string, any> = {}) {
  const body: Record<string, any> = {
    tran_id: tranId, val_id: "VAL1", status: "VALID", amount, currency: "BDT",
    verify_key: "tran_id,val_id,status,amount,currency", ...overrides,
  };
  body.verify_sign = signIpn(storePass, body);
  return body;
}

async function payViaSsl(svc: any, stub: any, fees: Record<string, any> = {}) {
  await svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL, ...fees });
  const out: any = await svc.initiateOrderPayment("org-1", "order-1", "sslcommerz");
  stub.sslValidate = async () => ({ status: "VALID", tran_id: out.providerTxnId, amount: "150.00", currency: "BDT", store_id: SSL.storeId });
  const res: any = await svc.handleSslIpn(validIpnBody(out.providerTxnId, SSL.storePass, "150.00", SSL.storeId));
  expect(res.ok).toBe(true);
  return out;
}

describe("GC12 fee math at verified_paid (own path)", () => {
  it("bps-only: fee = amount*bps/10000, net = amount - fee", async () => {
    const { svc, tables, stub } = build();
    await payViaSsl(svc, stub, { feeBps: 250 });
    const txn = tables.tenantPaymentTransaction.rows[0];
    expect(txn.status).toBe("verified_paid");
    expect(txn.feeMinor).toBe(375n);
    expect(txn.netMinor).toBe(14625n);
  });

  it("fixed-only: fee = feeFixedMinor", async () => {
    const { svc, tables, stub } = build();
    await payViaSsl(svc, stub, { feeFixedMinor: "150" });
    const txn = tables.tenantPaymentTransaction.rows[0];
    expect(txn.feeMinor).toBe(150n);
    expect(txn.netMinor).toBe(14850n);
  });

  it("both: bps part + fixed part", async () => {
    const { svc, tables, stub } = build();
    await payViaSsl(svc, stub, { feeBps: 100, feeFixedMinor: "50" });
    const txn = tables.tenantPaymentTransaction.rows[0];
    expect(txn.feeMinor).toBe(200n);
    expect(txn.netMinor).toBe(14800n);
  });

  it("unset: fee/net stay null — never invented", async () => {
    const { svc, tables, stub } = build();
    await payViaSsl(svc, stub, {});
    const txn = tables.tenantPaymentTransaction.rows[0];
    expect(txn.status).toBe("verified_paid");
    expect(txn.feeMinor ?? null).toBeNull();
    expect(txn.netMinor ?? null).toBeNull();
  });
});

describe("GC12 platform stamp uses the wallet fee", () => {
  it("verified platform IPN stamps feeMinor/netMinor from creditVerifiedPlatformPayment", async () => {
    setPlatformConfigSnapshot({
      llm: null, metaApp: null, smtp: null, sms: null,
      sslcommerz: { ...PLATFORM_SSL }, bkash: null,
      wallet: { feeBps: 200 }, loadedAt: Date.now(),
    } as any);
    const stub = gatewayStub({
      sslValidate: async () => ({ status: "VALID", tran_id: "", amount: "1000.00", currency: "BDT", store_id: PLATFORM_SSL.storeId }),
    });
    const { svc, tables } = build(stub, 100000n);
    tables.platformPaymentEnablement.rows.push({ id: "enab-1", organizationId: "org-1", provider: "sslcommerz", isEnabled: true });
    const out: any = await svc.initiatePlatformOrderPayment("org-1", "order-1", "sslcommerz");
    stub.sslValidate = async () => ({ status: "VALID", tran_id: out.providerTxnId, amount: "1000.00", currency: "BDT", store_id: PLATFORM_SSL.storeId });
    const res: any = await svc.handleSslIpn(validIpnBody(out.providerTxnId, PLATFORM_SSL.storePass, "1000.00", PLATFORM_SSL.storeId));
    expect(res.ok).toBe(true);
    const txn = tables.tenantPaymentTransaction.rows[0];
    expect(txn.status).toBe("verified_paid");
    expect(txn.feeMinor).toBe(2000n);
    expect(txn.netMinor).toBe(98000n);
  });
});

describe("GC12 putGateway fee key-presence", () => {
  it("gatewayView carries feeBps/feeFixedMinor", async () => {
    const { svc } = build();
    const view: any = await svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL, feeBps: 150, feeFixedMinor: "30" });
    expect(view.feeBps).toBe(150);
    expect(view.feeFixedMinor).toBe("30");
  });

  it("creds-only re-save preserves fees (keys absent)", async () => {
    const { svc, tables } = build();
    await svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL, feeBps: 150, feeFixedMinor: "30" });
    const view: any = await svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL });
    expect(view.feeBps).toBe(150);
    expect(view.feeFixedMinor).toBe("30");
    expect(tables.tenantPaymentGateway.rows[0].feeBps).toBe(150);
  });

  it("explicit null clears each fee column independently", async () => {
    const { svc } = build();
    await svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL, feeBps: 150, feeFixedMinor: "30" });
    const view: any = await svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL, feeBps: null });
    expect(view.feeBps).toBeNull();
    expect(view.feeFixedMinor).toBe("30");
    const view2: any = await svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL, feeFixedMinor: null });
    expect(view2.feeFixedMinor).toBeNull();
  });

  it("invalid feeFixedMinor → 400 and saves nothing new", async () => {
    const { svc, tables } = build();
    await svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL, feeBps: 150 });
    await expect(svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL, feeFixedMinor: "12.5" }))
      .rejects.toBeInstanceOf(ApiException);
    await expect(svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL, feeFixedMinor: "-5" }))
      .rejects.toBeInstanceOf(ApiException);
    expect(tables.tenantPaymentGateway.rows[0].feeBps).toBe(150);
    expect(tables.tenantPaymentGateway.rows[0].feeFixedMinor ?? null).toBeNull();
  });

  it("invalid feeBps → 400", async () => {
    const { svc } = build();
    await expect(svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL, feeBps: 10001 }))
      .rejects.toBeInstanceOf(ApiException);
    await expect(svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL, feeBps: 2.5 }))
      .rejects.toBeInstanceOf(ApiException);
  });

  it("ValidationPipe (main.ts settings): absent fee keys arrive as undefined, explicit null stays null — and putGateway honours that on REAL DTO instances", async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
    const meta: any = { type: "body", metatype: PutPaymentGatewayDto, data: "" };
    const dtoNull: any = await pipe.transform({ storeId: "s1", storePass: "pw", feeBps: null, feeFixedMinor: null }, meta);
    // present-but-null survives the pipe as null (NOT undefined)
    expect(dtoNull.feeBps).toBeNull();
    expect(dtoNull.feeFixedMinor).toBeNull();
    const dtoVal: any = await pipe.transform({ storeId: "s1", storePass: "pw", feeBps: 250, feeFixedMinor: "150" }, meta);
    expect(dtoVal.feeBps).toBe(250);
    expect(dtoVal.feeFixedMinor).toBe("150");
    const dtoAbsent: any = await pipe.transform({ storeId: "s1", storePass: "pw" }, meta);
    // the pipe materialises declared fields as own properties, so
    // hasOwnProperty CANNOT distinguish absence — `undefined` can
    expect(dtoAbsent.feeBps).toBeUndefined();
    expect(dtoAbsent.feeFixedMinor).toBeUndefined();
    await expect(pipe.transform({ storeId: "s1", storePass: "pw", feeBps: 10001 }, meta)).rejects.toBeTruthy();
    await expect(pipe.transform({ storeId: "s1", storePass: "pw", bogusField: 1 }, meta)).rejects.toBeTruthy();

    // End-to-end through putGateway with REAL pipe-produced DTOs:
    const { svc } = build();
    await svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL, feeBps: 150, feeFixedMinor: "30" });
    const absentDto: any = await pipe.transform({ storeId: SSL.storeId, storePass: SSL.storePass, sandbox: true }, meta);
    const preserved: any = await svc.putGateway("org-1", "owner", "sslcommerz", absentDto);
    expect(preserved.feeBps).toBe(150);
    expect(preserved.feeFixedMinor).toBe("30");
    const nullDto: any = await pipe.transform({ storeId: SSL.storeId, storePass: SSL.storePass, sandbox: true, feeBps: null, feeFixedMinor: null }, meta);
    const cleared: any = await svc.putGateway("org-1", "owner", "sslcommerz", nullDto);
    expect(cleared.feeBps).toBeNull();
    expect(cleared.feeFixedMinor).toBeNull();
  });
});

describe("GC12 failureReason bookkeeping", () => {
  it("initiation failure records status failed + the gateway reason, truncated to 300 chars", async () => {
    const longReason = "X".repeat(400);
    const stub = gatewayStub({ sslInitSession: async () => ({ status: "FAILED", failed_reason: longReason }) });
    const { svc, tables } = build(stub);
    await svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL });
    await expect(svc.initiateOrderPayment("org-1", "order-1", "sslcommerz")).rejects.toBeInstanceOf(ApiException);
    const txn = tables.tenantPaymentTransaction.rows[0];
    expect(txn.status).toBe("failed");
    expect(typeof txn.failureReason).toBe("string");
    expect(txn.failureReason.length).toBe(300);
  });

  it("SSLCommerz IPN FAILED records 'gateway reported FAILED'", async () => {
    const { svc, tables, stub } = build();
    await svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL });
    const out: any = await svc.initiateOrderPayment("org-1", "order-1", "sslcommerz");
    const body = validIpnBody(out.providerTxnId, SSL.storePass, "150.00", SSL.storeId, { status: "FAILED" });
    const res: any = await svc.handleSslIpn(body);
    expect(res.recorded).toBe("failed");
    const txn = tables.tenantPaymentTransaction.rows[0];
    expect(txn.status).toBe("failed");
    expect(txn.failureReason).toBe("gateway reported FAILED");
    void stub;
  });

  it("bKash callback non-success records the callback status", async () => {
    const { svc, tables } = build();
    await svc.putGateway("org-1", "owner", "bkash", { username: "017", password: "pw", appKey: "ak", appSecret: "as", sandbox: true });
    const out: any = await svc.initiateOrderPayment("org-1", "order-1", "bkash", { customerPhone: "017" });
    await svc.handleBkashCallback({ paymentID: out.providerTxnId, status: "failure" });
    const txn = tables.tenantPaymentTransaction.rows[0];
    expect(txn.status).toBe("failed");
    expect(txn.failureReason).toContain("failure");
  });

  it("ShurjoPay non-1000 records sp_message when present", async () => {
    const stub = gatewayStub({ shurjoVerify: async () => ({ sp_code: "1001", sp_message: "Transaction declined by bank", amount: "150.00", currency: "BDT" }) });
    const { svc, tables } = build(stub);
    await svc.putGateway("org-1", "owner", "shurjopay", { username: "sp_merchant", password: "pw", prefix: "SPX", sandbox: true });
    const out: any = await svc.initiateOrderPayment("org-1", "order-1", "shurjopay");
    await svc.handleShurjoReturn({ order_id: out.providerTxnId });
    const txn = tables.tenantPaymentTransaction.rows[0];
    expect(txn.status).toBe("failed");
    expect(txn.failureReason).toBe("Transaction declined by bank");
  });

  it("aamarPay fail POST records the failure", async () => {
    const { svc, tables } = build();
    await svc.putGateway("org-1", "owner", "aamarpay", { storeId: "mystorebd", signatureKey: "sig", sandbox: true });
    const out: any = await svc.initiateOrderPayment("org-1", "order-1", "aamarpay");
    await svc.handleAamarResult("fail", { tran_id: out.providerTxnId });
    const txn = tables.tenantPaymentTransaction.rows[0];
    expect(txn.status).toBe("failed");
    expect(txn.failureReason).toBe("aamarPay reported fail");
  });
});

function seedTxn(tables: any, over: Record<string, any>) {
  const row = {
    id: over.id ?? `txn-${tables.tenantPaymentTransaction.rows.length + 1}`,
    organizationId: "org-1", gatewayId: null, orderId: "order-1", provider: "sslcommerz",
    source: "own", amountMinor: 10000n, currency: "BDT", status: "verified_paid",
    providerTxnId: null, valId: null, ipnPayload: null, failureReason: null,
    feeMinor: null, netMinor: null,
    createdAt: new Date(), updatedAt: new Date(),
    ...over,
  };
  tables.tenantPaymentTransaction.rows.push(row);
  return row;
}

describe("GC12 PaymentOpsService — attempts", () => {
  it("filters + expired derivation (stored status unchanged) + order number join + pageSize cap", async () => {
    const { ops, tables } = build();
    const now = new Date("2026-10-15T12:00:00Z");
    seedTxn(tables, { id: "t-old", status: "initiated", provider: "bkash", createdAt: new Date(now.getTime() - 25 * 3600 * 1000), updatedAt: new Date(now.getTime() - 25 * 3600 * 1000) });
    seedTxn(tables, { id: "t-fresh", status: "initiated", provider: "sslcommerz", createdAt: new Date(now.getTime() - 3600 * 1000), updatedAt: new Date(now.getTime() - 3600 * 1000) });
    seedTxn(tables, { id: "t-paid", status: "verified_paid", provider: "sslcommerz", createdAt: new Date(now.getTime() - 2 * 3600 * 1000), updatedAt: new Date(now.getTime() - 3600 * 1000) });

    const all: any = await ops.listAttempts("org-1", {}, now);
    expect(all.total).toBe(3);
    const old = all.items.find((i: any) => i.id === "t-old");
    expect(old.displayStatus).toBe("expired");
    expect(old.status).toBe("initiated");
    expect(old.orderNumber).toBe("ORD-1");
    // the stored row was NOT rewritten
    expect(tables.tenantPaymentTransaction.rows.find((r: any) => r.id === "t-old").status).toBe("initiated");
    const fresh = all.items.find((i: any) => i.id === "t-fresh");
    expect(fresh.displayStatus).toBe("initiated");

    const byProvider: any = await ops.listAttempts("org-1", { provider: "bkash" }, now);
    expect(byProvider.total).toBe(1);
    expect(byProvider.items[0].id).toBe("t-old");
    const byStatus: any = await ops.listAttempts("org-1", { status: "verified_paid" }, now);
    expect(byStatus.total).toBe(1);
    const capped: any = await ops.listAttempts("org-1", { pageSize: 500 }, now);
    expect(capped.pageSize).toBe(100);
  });

  it("detail adds valId + ipnPayload; a foreign attempt → 404", async () => {
    const { ops, tables } = build();
    seedTxn(tables, { id: "t-1", status: "verified_paid", valId: "VAL9", ipnPayload: { ipn: { status: "VALID" } } });
    seedTxn(tables, { id: "t-foreign", organizationId: "org-2", status: "failed" });
    const detail: any = await ops.getAttempt("org-1", "t-1");
    expect(detail.valId).toBe("VAL9");
    expect(detail.ipnPayload).toEqual({ ipn: { status: "VALID" } });
    await expect(ops.getAttempt("org-1", "t-foreign")).rejects.toBeInstanceOf(ApiException);
    await expect(ops.getAttempt("org-1", "missing")).rejects.toBeInstanceOf(ApiException);
  });
});

describe("GC12 PaymentOpsService — fee report + settlements", () => {
  it("fee report: null-aware aggregation + withFeeCount, grouped by provider+source, sorted", async () => {
    const { ops, tables } = build();
    const at = new Date("2026-10-10T10:00:00Z");
    // sslcommerz/own: two paid, one with fee, one without
    seedTxn(tables, { id: "a", provider: "sslcommerz", source: "own", amountMinor: 10000n, feeMinor: 300n, netMinor: 9700n, updatedAt: at });
    seedTxn(tables, { id: "b", provider: "sslcommerz", source: "own", amountMinor: 5000n, feeMinor: null, netMinor: null, updatedAt: at });
    // bkash/platform: fee known
    seedTxn(tables, { id: "c", provider: "bkash", source: "platform", amountMinor: 20000n, feeMinor: 400n, netMinor: 19600n, updatedAt: at });
    // nagad/own: no fee rows at all → null fee/net
    seedTxn(tables, { id: "d", provider: "nagad", source: "own", amountMinor: 7000n, updatedAt: at });
    // out of range + not verified_paid are excluded
    seedTxn(tables, { id: "e", provider: "bkash", source: "platform", amountMinor: 99000n, feeMinor: 1n, netMinor: 98999n, updatedAt: new Date("2026-09-01T10:00:00Z") });
    seedTxn(tables, { id: "f", provider: "bkash", source: "platform", status: "failed", amountMinor: 88000n, updatedAt: at });

    const report: any = await ops.feeReport("org-1", "2026-10-01", "2026-10-31");
    expect(report.rows.map((r: any) => `${r.provider}/${r.source}`)).toEqual(["bkash/platform", "nagad/own", "sslcommerz/own"]);
    const ssl = report.rows.find((r: any) => r.provider === "sslcommerz");
    expect(ssl.count).toBe(2);
    expect(ssl.grossMinor).toBe("15000");
    expect(ssl.withFeeCount).toBe(1);
    expect(ssl.feeMinor).toBe("300");
    expect(ssl.netMinor).toBe("9700");
    const nagad = report.rows.find((r: any) => r.provider === "nagad");
    expect(nagad.withFeeCount).toBe(0);
    expect(nagad.feeMinor).toBeNull();
    expect(nagad.netMinor).toBeNull();

    const csv = await ops.feeReportCsv("org-1", "2026-10-01", "2026-10-31");
    expect(csv.split("\n")[0]).toBe("provider,source,count,grossMinor,withFeeCount,feeMinor,netMinor");
    expect(csv).toContain("sslcommerz,own,2,15000,1,300,9700");
    expect(csv).toContain("nagad,own,1,7000,0,,");
  });

  it("settlements: OWN only, grouped by Dhaka day of updatedAt — near-midnight boundary pinned", async () => {
    const { ops, tables } = build();
    // 2026-10-15T18:30:00Z = 2026-10-16 00:30 in Dhaka → day 2026-10-16
    seedTxn(tables, { id: "late", provider: "sslcommerz", source: "own", amountMinor: 10000n, feeMinor: 100n, netMinor: 9900n, updatedAt: new Date("2026-10-15T18:30:00.000Z") });
    // 2026-10-15T17:59:00Z = 2026-10-15 23:59 in Dhaka → day 2026-10-15
    seedTxn(tables, { id: "early", provider: "sslcommerz", source: "own", amountMinor: 5000n, feeMinor: null, netMinor: null, updatedAt: new Date("2026-10-15T17:59:00.000Z") });
    // platform rows never appear in settlements
    seedTxn(tables, { id: "plat", provider: "bkash", source: "platform", amountMinor: 7000n, feeMinor: 70n, netMinor: 6930n, updatedAt: new Date("2026-10-15T18:30:00.000Z") });

    const out: any = await ops.settlements("org-1", "2026-10-15", "2026-10-16");
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0].day).toBe("2026-10-16"); // day desc first
    expect(out.rows[0].grossMinor).toBe("10000");
    expect(out.rows[0].feeMinor).toBe("100");
    expect(out.rows[1].day).toBe("2026-10-15");
    expect(out.rows[1].feeMinor).toBeNull();
  });

  it("fee report rejects an inverted range", async () => {
    const { ops } = build();
    await expect(ops.feeReport("org-1", "2026-10-20", "2026-10-01")).rejects.toBeInstanceOf(ApiException);
  });
});
