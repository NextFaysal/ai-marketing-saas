process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "<MASKED_SECRET_001>";

import { BadRequestException, NotFoundException } from "@nestjs/common";
import { TenantPaymentsService } from "../connections/tenant-payments.service";
import { WalletService } from "../connections/wallet.service";
import { PaymentResendService } from "./payment-resend.service";

/**
 * GC12 — payment-link recovery resend (Orders side). Pinned:
 * - an already-paid order refuses 400 ("ইতিমধ্যে পেমেন্ট সম্পন্ন
 *   হয়েছে") and creates NO new attempt;
 * - a resend creates a NEW TenantPaymentTransaction (attempt
 *   count +1) through a FRESH initiation and returns its link;
 * - provider/source default from the LATEST attempt and are
 *   re-validated server-side (assertPublicPaymentOption);
 * - the send is SMS-only (InboxService would cycle the module
 *   graph); SMS not configured / no phone → sentVia "none", the
 *   link is STILL returned, and the audit metadata carries the
 *   reason;
 * - an initiation failure surfaces as the API error (the failed
 *   attempt row initiation wrote is the record).
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

function gatewayStub(overrides: any = {}) {
  return {
    bkashGrantToken: async () => "token-1",
    bkashCreatePayment: async () => ({ statusCode: "0000", bkashURL: "https://bkash.example/pay", paymentID: "PAY123" }),
    bkashExecutePayment: async () => ({ statusCode: "0000", transactionStatus: "Completed", amount: "150.00", currency: "BDT" }),
    bkashQueryPayment: async () => ({ statusCode: "0000", transactionStatus: "Completed", amount: "150.00", currency: "BDT" }),
    sslInitSession: async () => ({ status: "SUCCESS", GatewayPageURL: "https://ssl.example/pay", sessionkey: "SK1" }),
    sslValidate: async () => ({ status: "VALID", tran_id: "", amount: "150.00", currency: "BDT", store_id: SSL.storeId }),
    ...overrides,
  };
}

function build(opts: { stub?: any; smsResult?: any; phone?: string | null } = {}) {
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
  tables.customer.rows.push({
    id: "cust-1", organizationId: "org-1", firstName: "Rahim", lastName: "Uddin",
    phone: opts.phone === undefined ? "01711111111" : opts.phone, email: "rahim@example.com",
  });
  tables.order.rows.push({
    id: "order-1", organizationId: "org-1", customerId: "cust-1", totalMinor: 15000n, currency: "BDT",
    isCod: true, paymentMethod: "cod", internalNote: null, externalNumber: "ORD-1", isPractice: false,
  });
  const auditLogs: any[] = [];
  const audit = { log: async (entry: any) => { auditLogs.push(entry); } } as any;
  const wallet = new WalletService(tables as any, audit);
  const payments = new TenantPaymentsService(tables as any, audit, opts.stub ?? gatewayStub(), wallet);
  const smsCalls: any[] = [];
  const shopAccounts: any = {
    sendShopSms: async (...args: any[]) => {
      smsCalls.push(args);
      return opts.smsResult ?? { sent: true };
    },
  };
  const resend = new PaymentResendService(tables as any, payments, shopAccounts, audit);
  return { tables, auditLogs, payments, resend, smsCalls };
}

async function seedGateway(payments: any) {
  await payments.putGateway("org-1", "owner", "sslcommerz", { ...SSL });
}

function seedAttempt(tables: any, over: Record<string, any> = {}) {
  const row = {
    id: `seed-${tables.tenantPaymentTransaction.rows.length + 1}`,
    organizationId: "org-1", gatewayId: null, orderId: "order-1", provider: "sslcommerz",
    source: "own", amountMinor: 15000n, currency: "BDT", status: "failed",
    providerTxnId: null, valId: null, ipnPayload: null, failureReason: "earlier failure",
    feeMinor: null, netMinor: null, createdAt: new Date(Date.now() - 3600 * 1000), updatedAt: new Date(),
    ...over,
  };
  tables.tenantPaymentTransaction.rows.push(row);
  return row;
}

describe("GC12 payment-link resend", () => {
  it("already-paid order → 400 and NO new attempt", async () => {
    const { tables, payments, resend } = build();
    await seedGateway(payments);
    seedAttempt(tables, { status: "verified_paid" });
    const before = tables.tenantPaymentTransaction.rows.length;
    await expect(resend.resendPaymentLink("org-1", "staff-1", "order-1", {})).rejects.toThrow(/ইতিমধ্যে পেমেন্ট সম্পন্ন হয়েছে/);
    expect(tables.tenantPaymentTransaction.rows.length).toBe(before);
  });

  it("resend creates a NEW txn, returns its link, sends SMS, audits metadata", async () => {
    const { tables, payments, resend, auditLogs, smsCalls } = build();
    await seedGateway(payments);
    seedAttempt(tables);
    const before = tables.tenantPaymentTransaction.rows.length;
    const out: any = await resend.resendPaymentLink("org-1", "staff-1", "order-1", {});
    expect(tables.tenantPaymentTransaction.rows.length).toBe(before + 1);
    expect(out.link).toBe("https://ssl.example/pay");
    expect(out.provider).toBe("sslcommerz");
    expect(out.source).toBe("own");
    expect(out.sentVia).toBe("sms");
    expect(out.sendNote).toContain("SMS");
    const newTxn = tables.tenantPaymentTransaction.rows.find((r: any) => r.id === out.transactionId);
    expect(newTxn).toBeTruthy();
    expect(newTxn.status).toBe("initiated");
    expect(smsCalls).toHaveLength(1);
    expect(smsCalls[0][1]).toBe("01711111111");
    expect(smsCalls[0][2]).toContain("https://ssl.example/pay");
    expect(smsCalls[0][2]).toContain("ORD-1");
    expect(smsCalls[0][3]).toBe("payment-resend-order-1");
    const entry = auditLogs.find((l: any) => l.action === "tenant_payment.link_resent");
    expect(entry).toBeTruthy();
    expect(entry.entityType).toBe("Order");
    expect(entry.metadata).toMatchObject({
      orderId: "order-1", provider: "sslcommerz", source: "own", transactionId: out.transactionId, sentVia: "sms",
    });
  });

  it("explicit body provider/source is used (and re-validated server-side)", async () => {
    const { payments, resend } = build();
    await seedGateway(payments);
    const out: any = await resend.resendPaymentLink("org-1", "staff-1", "order-1", { provider: "sslcommerz", source: "own" });
    expect(out.provider).toBe("sslcommerz");
    // a pair the shop does not offer is refused by the server truth
    await expect(resend.resendPaymentLink("org-1", "staff-1", "order-1", { provider: "bkash", source: "own" }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it("no attempts and no body → 400 with a clear message; missing order → 404; practice → 400", async () => {
    const { tables, payments, resend } = build();
    await seedGateway(payments);
    await expect(resend.resendPaymentLink("org-1", "staff-1", "order-1", {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(resend.resendPaymentLink("org-1", "staff-1", "order-404", {})).rejects.toBeInstanceOf(NotFoundException);
    tables.order.rows[0].isPractice = true;
    await expect(resend.resendPaymentLink("org-1", "staff-1", "order-1", { provider: "sslcommerz", source: "own" }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it("SMS not configured → sentVia 'none', link still returned, reason in audit metadata", async () => {
    const { tables, payments, resend, auditLogs } = build({ smsResult: { sent: false, notConfigured: true, reason: "no SMS sender configured" } });
    await seedGateway(payments);
    seedAttempt(tables);
    const out: any = await resend.resendPaymentLink("org-1", "staff-1", "order-1", {});
    expect(out.sentVia).toBe("none");
    expect(out.link).toBe("https://ssl.example/pay");
    expect(out.sendNote).toContain("কোনো চ্যানেলে পাঠানো যায়নি");
    const entry = auditLogs.find((l: any) => l.action === "tenant_payment.link_resent");
    expect(entry.metadata.sentVia).toBe("none");
    expect(entry.metadata.reason).toBe("no SMS sender configured");
  });

  it("no customer phone → sentVia 'none' with the link still returned", async () => {
    const { tables, payments, resend, auditLogs, smsCalls } = build({ phone: null });
    await seedGateway(payments);
    seedAttempt(tables);
    const out: any = await resend.resendPaymentLink("org-1", "staff-1", "order-1", {});
    expect(out.sentVia).toBe("none");
    expect(out.link).toBe("https://ssl.example/pay");
    expect(smsCalls).toHaveLength(0);
    const entry = auditLogs.find((l: any) => l.action === "tenant_payment.link_resent");
    expect(entry.metadata.reason).toContain("ফোন");
  });

  it("initiation failure on resend → the error surfaces and the failed attempt row is the record", async () => {
    const stub = gatewayStub({ sslInitSession: async () => ({ status: "FAILED", failed_reason: "gateway down" }) });
    const { tables, payments, resend } = build({ stub });
    await seedGateway(payments);
    seedAttempt(tables);
    const before = tables.tenantPaymentTransaction.rows.length;
    await expect(resend.resendPaymentLink("org-1", "staff-1", "order-1", {})).rejects.toBeInstanceOf(BadRequestException);
    expect(tables.tenantPaymentTransaction.rows.length).toBe(before + 1);
    const failed = tables.tenantPaymentTransaction.rows[tables.tenantPaymentTransaction.rows.length - 1];
    expect(failed.status).toBe("failed");
    expect(failed.failureReason).toContain("gateway down");
  });
});
