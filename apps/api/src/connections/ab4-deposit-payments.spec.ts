process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "test-secret";

import { BadRequestException } from "@nestjs/common";
import { ApiException } from "../i18n";
import { TenantPaymentsService } from "./tenant-payments.service";
import { WalletService } from "./wallet.service";
import { PaymentResendService } from "../orders/payment-resend.service";
import { setPlatformConfigSnapshot } from "../common/platform-config";

/**
 * AB4 (AX5a) — deposit payment wiring on TenantPaymentsService
 * + the resend scoping. Pinned:
 * - a deposit initiation stores the deposit amount + purpose;
 * - an explicit amount above the remaining balance → 400;
 * - a partial verified payment no longer blocks initiation —
 *   the remainder is collected; a fully settled order refuses;
 * - a verified deposit writes EXACTLY ONE approved
 *   gateway_deposit PaymentVerification (claim-idempotent
 *   across re-deliveries, incl. after a bookkeeping failure);
 * - the order's paymentMethod/isCod flip ONLY at full
 *   settlement — a partial verified payment appends a note;
 * - publicPaymentState reports deposit_paid + the deposit
 *   block math;
 * - resend: a deposit resend collects the OUTSTANDING deposit;
 *   a settled order refuses.
 */

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v === null) return row[k] === null || row[k] === undefined;
    if (typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
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
      const row = {
        id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(),
        depositVerificationId: null, purpose: "full", ...data,
      };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (row) Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const row of rows) {
        if (matches(row, where ?? {})) { Object.assign(row, data); count++; }
      }
      return { count };
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

function snapshot() {
  setPlatformConfigSnapshot({
    llm: null, metaApp: null, smtp: null, sms: null,
    sslcommerz: { ...PLATFORM_SSL }, bkash: null,
    wallet: { feeBps: 0 }, loadedAt: Date.now(),
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
  snapshot();
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
    businessProfile: makeTable("bp"),
    paymentVerification: makeTable("pv"),
    membership: makeTable("mem"),
  };
  tables.$transaction = async (fn: any) => fn(tables);
  tables.organization.rows.push({ id: "org-1", slug: "myshop", name: "My Shop" });
  tables.customer.rows.push({
    id: "cust-1", organizationId: "org-1", firstName: "Rahim",
    phone: "01711111111", email: "rahim@example.com",
  });
  tables.order.rows.push({
    id: "order-1", organizationId: "org-1", customerId: "cust-1", totalMinor: 15000n, currency: "BDT",
    isCod: true, paymentMethod: "cod", internalNote: null, externalNumber: "ORD-1", isPractice: false,
    depositDueMinor: null,
  });
  const audit = { log: async () => undefined } as any;
  const wallet = new WalletService(tables as any, audit);
  const events: any = { emitted: [] as any[], emit(kind: string, payload: any) { this.emitted.push({ kind, payload }); } };
  const svc = new TenantPaymentsService(tables as any, audit, stub, wallet, events);
  return { svc, tables, wallet, events, audit };
}

function seedVerified(tables: any, over: Record<string, any> = {}) {
  const row = {
    id: `seed-${tables.tenantPaymentTransaction.rows.length + 1}`,
    organizationId: "org-1", gatewayId: null, orderId: "order-1", provider: "sslcommerz",
    source: "own", amountMinor: 5000n, currency: "BDT", status: "verified_paid",
    purpose: "balance", providerTxnId: null, valId: null, ipnPayload: null,
    depositVerificationId: null, feeMinor: null, netMinor: null,
    createdAt: new Date(Date.now() - 3600 * 1000), updatedAt: new Date(),
    ...over,
  };
  tables.tenantPaymentTransaction.rows.push(row);
  return row;
}

describe("AB4 initiation — amount + purpose scoping", () => {
  it("(i) public deposit initiation prices from the config and stores amount + purpose", async () => {
    const { svc, tables } = build();
    await svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL });
    tables.businessProfile.rows.push({
      id: "bp-1", organizationId: "org-1",
      depositMode: "percent", depositPercent: 20, depositFixedMinor: null,
      depositAppliesTo: "online", depositNote: null,
    });
    const out: any = await svc.initiatePublicPayment("myshop", "order-1", "ORD-1", "sslcommerz", "own", "deposit");
    expect(out.redirectUrl).toBe("https://ssl.example/pay");
    const txn = tables.tenantPaymentTransaction.rows[0];
    expect(txn.amountMinor).toBe(3000n); // 20% of 15000
    expect(txn.purpose).toBe("deposit");
    expect(txn.status).toBe("initiated");
  });

  it("(i) public deposit initiation refuses when no deposit applies", async () => {
    const { svc, tables } = build();
    await svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL });
    await expect(svc.initiatePublicPayment("myshop", "order-1", "ORD-1", "sslcommerz", "own", "deposit"))
      .rejects.toThrow("এই অর্ডারের জন্য ডিপোজিট প্রযোজ্য নয়");
    expect(tables.tenantPaymentTransaction.rows).toHaveLength(0);
  });

  it("(ii) explicit amount above the remaining balance → 400; zero → 400; bad purpose → 400", async () => {
    const { svc, tables } = build();
    await svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL });
    seedVerified(tables, { amountMinor: 5000n });
    await expect(svc.initiateOrderPayment("org-1", "order-1", "sslcommerz", { amountMinor: 10001n }))
      .rejects.toBeInstanceOf(ApiException);
    await expect(svc.initiateOrderPayment("org-1", "order-1", "sslcommerz", { amountMinor: 0n }))
      .rejects.toBeInstanceOf(ApiException);
    await expect(svc.initiateOrderPayment("org-1", "order-1", "sslcommerz", { purpose: "partial" }))
      .rejects.toBeInstanceOf(ApiException);
    // Only the seeded row exists — refused initiations create nothing.
    expect(tables.tenantPaymentTransaction.rows).toHaveLength(1);
  });

  it("(iii) after a PARTIAL verified payment the remainder initiates (derived purpose balance); after FULL it refuses", async () => {
    const { svc, tables } = build();
    await svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL });
    seedVerified(tables, { amountMinor: 5000n, purpose: "deposit" });
    const out: any = await svc.initiateOrderPayment("org-1", "order-1", "sslcommerz", {});
    expect(out.transactionId).toBeTruthy();
    const txn = tables.tenantPaymentTransaction.rows.find((r: any) => r.id === out.transactionId);
    expect(txn.amountMinor).toBe(10000n);
    expect(txn.purpose).toBe("balance");
    // Settle the order fully, then a further initiation refuses.
    seedVerified(tables, { amountMinor: 10000n, purpose: "balance" });
    await expect(svc.initiateOrderPayment("org-1", "order-1", "sslcommerz", {}))
      .rejects.toThrow("ইতিমধ্যে যাচাইকৃতভাবে সম্পন্ন হয়েছে");
  });

  it("legacy first full initiation is unchanged: full total, purpose full", async () => {
    const { svc, tables } = build();
    await svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL });
    await svc.initiateOrderPayment("org-1", "order-1", "sslcommerz", {});
    const txn = tables.tenantPaymentTransaction.rows[0];
    expect(txn.amountMinor).toBe(15000n);
    expect(txn.purpose).toBe("full");
  });
});

describe("AB4 markVerifiedPaid — deposit bookkeeping + settlement scoping", () => {
  function depositTxn(tables: any, over: Record<string, any> = {}) {
    const row = {
      id: "txn-dep-1", organizationId: "org-1", gatewayId: null, orderId: "order-1",
      provider: "bkash", source: "own", amountMinor: 3000n, currency: "BDT",
      status: "initiated", purpose: "deposit", providerTxnId: "PAY-DEP-1",
      valId: null, depositVerificationId: null,
      createdAt: new Date(), updatedAt: new Date(), ...over,
    };
    tables.tenantPaymentTransaction.rows.push(row);
    return row;
  }

  it("(iv) verified deposit → ONE approved gateway_deposit verification across re-delivery; order stamp unchanged while partial", async () => {
    const { svc, tables, events } = build();
    const txn = depositTxn(tables);
    await (svc as any).markVerifiedPaid(txn, { payload: { executeOrQuery: {} } });
    expect(tables.paymentVerification.rows).toHaveLength(1);
    const pv = tables.paymentVerification.rows[0];
    expect(pv.status).toBe("approved");
    expect(pv.source).toBe("gateway_deposit");
    expect(pv.verdict).toBe("matched");
    expect(pv.amountMinor).toBe(3000n);
    expect(pv.provider).toBe("bkash");
    expect(pv.trxId).toBe("PAY-DEP-1");
    expect(pv.id).toBe(tables.tenantPaymentTransaction.rows[0].depositVerificationId);
    // Partial: the order stamp does NOT flip.
    const order = tables.order.rows[0];
    expect(order.paymentMethod).toBe("cod");
    expect(order.isCod).toBe(true);
    expect(order.internalNote).toContain("আংশিক পেমেন্ট যাচাইকৃত");
    // The bus event carries the AB4 settlement context.
    const paid = events.emitted.find((e: any) => e.kind === "order.paid");
    expect(paid.payload.context).toMatchObject({ purpose: "deposit", fullySettled: false, orderTotalMinor: "15000" });
    // Re-delivery with the fresh (verified_paid) row: no second verification.
    const fresh = tables.tenantPaymentTransaction.rows[0];
    expect(fresh.status).toBe("verified_paid");
    await (svc as any).markVerifiedPaid(fresh, { payload: {} });
    expect(tables.paymentVerification.rows).toHaveLength(1);
  });

  it("(iv) bookkeeping failure on first delivery is retried on re-delivery (claim reverted, then exactly one row)", async () => {
    const { svc, tables } = build();
    const txn = depositTxn(tables);
    const realCreate = tables.paymentVerification.create;
    tables.paymentVerification.create = async () => { throw new Error("db down"); };
    await (svc as any).markVerifiedPaid(txn, { payload: {} });
    expect(tables.paymentVerification.rows).toHaveLength(0);
    expect(tables.tenantPaymentTransaction.rows[0].depositVerificationId).toBeNull();
    expect(tables.tenantPaymentTransaction.rows[0].status).toBe("verified_paid");
    tables.paymentVerification.create = realCreate;
    const fresh = tables.tenantPaymentTransaction.rows[0];
    await (svc as any).markVerifiedPaid(fresh, { payload: {} });
    expect(tables.paymentVerification.rows).toHaveLength(1);
  });

  it("(iv) a verified BALANCE payment that completes the total flips the order stamp", async () => {
    const { svc, tables, events } = build();
    seedVerified(tables, { amountMinor: 3000n, purpose: "deposit" });
    const bal = depositTxn(tables, { id: "txn-bal-1", amountMinor: 12000n, purpose: "balance", providerTxnId: "PAY-BAL-1" });
    await (svc as any).markVerifiedPaid(bal, { payload: {} });
    const order = tables.order.rows[0];
    expect(order.paymentMethod).toBe("bkash");
    expect(order.isCod).toBe(false);
    expect(order.internalNote).toContain("অনলাইন পেমেন্ট যাচাইকৃত");
    // A balance verification writes NO PaymentVerification.
    expect(tables.paymentVerification.rows).toHaveLength(0);
    const paid = events.emitted.find((e: any) => e.kind === "order.paid");
    expect(paid.payload.context).toMatchObject({ purpose: "balance", fullySettled: true, orderTotalMinor: "15000" });
  });

  it("(iv) platform deposit: wallet credited, ONE verification, order stamp unchanged while partial", async () => {
    const { svc, tables } = build();
    tables.platformPaymentEnablement.rows.push({ id: "e1", organizationId: "org-1", provider: "sslcommerz", isEnabled: true });
    const txn = depositTxn(tables, {
      id: "txn-plat-1", provider: "sslcommerz", source: "platform", providerTxnId: "TPX1",
    });
    await (svc as any).markVerifiedPaid(txn, { payload: {} });
    expect(tables.paymentVerification.rows).toHaveLength(1);
    const wallet = tables.walletAccount.rows[0];
    expect(wallet).toBeTruthy();
    expect(BigInt(wallet.balanceMinor)).toBe(3000n);
    const order = tables.order.rows[0];
    expect(order.paymentMethod).toBe("cod");
    expect(order.isCod).toBe(true);
    expect(order.internalNote).toContain("আংশিক পেমেন্ট যাচাইকৃত");
  });
});

describe("AB4 publicPaymentState — deposit state + block math", () => {
  it("(v) verified deposit (unsettled) → deposit_paid with due/paid/outstanding", async () => {
    const { svc, tables } = build();
    tables.order.rows[0].depositDueMinor = 3000n;
    seedVerified(tables, { amountMinor: 1000n, purpose: "deposit" });
    const st: any = await svc.publicPaymentState("myshop", "order-1", "ORD-1");
    expect(st.state).toBe("deposit_paid");
    expect(st.deposit).toEqual({ dueMinor: "3000", paidMinor: "1000", outstandingMinor: "2000" });
  });

  it("(v) fully settled → verified_paid, deposit block still rides; no deposit stamp → deposit null", async () => {
    const { svc, tables } = build();
    tables.order.rows[0].depositDueMinor = 3000n;
    seedVerified(tables, { amountMinor: 3000n, purpose: "deposit" });
    seedVerified(tables, { amountMinor: 12000n, purpose: "balance" });
    const st: any = await svc.publicPaymentState("myshop", "order-1", "ORD-1");
    expect(st.state).toBe("verified_paid");
    expect(st.deposit).toEqual({ dueMinor: "3000", paidMinor: "3000", outstandingMinor: "0" });

    const fresh = build();
    const none: any = await fresh.svc.publicPaymentState("myshop", "order-1", "ORD-1");
    expect(none).toEqual({ state: "none", deposit: null });
  });
});

describe("AB4 resend — purpose scoping", () => {
  function buildResend() {
    const ctx = build();
    const shopAccounts: any = { sendShopSms: async () => ({ sent: true }) };
    const resend = new PaymentResendService(ctx.tables as any, ctx.svc, shopAccounts, ctx.audit);
    return { ...ctx, resend };
  }

  it("(vi) partial verified + purpose deposit → a deposit-amount initiation for the outstanding deposit", async () => {
    const { svc, tables, resend } = buildResend();
    await svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL });
    tables.order.rows[0].depositDueMinor = 3000n;
    seedVerified(tables, { amountMinor: 1000n, purpose: "deposit" });
    const out: any = await resend.resendPaymentLink("org-1", "staff-1", "order-1", { purpose: "deposit" });
    expect(out.link).toBe("https://ssl.example/pay");
    const txn = tables.tenantPaymentTransaction.rows.find((r: any) => r.id === out.transactionId);
    expect(txn.amountMinor).toBe(2000n); // 3000 due − 1000 verified deposit
    expect(txn.purpose).toBe("deposit");
  });

  it("(vi) deposit already fully paid → 400 before any new attempt", async () => {
    const { svc, tables, resend } = buildResend();
    await svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL });
    tables.order.rows[0].depositDueMinor = 3000n;
    seedVerified(tables, { amountMinor: 3000n, purpose: "deposit" });
    const before = tables.tenantPaymentTransaction.rows.length;
    await expect(resend.resendPaymentLink("org-1", "staff-1", "order-1", { purpose: "deposit" }))
      .rejects.toThrow("এই অর্ডারের ডিপোজিট ইতিমধ্যে পরিশোধ হয়েছে");
    expect(tables.tenantPaymentTransaction.rows.length).toBe(before);
  });

  it("(vi) fully settled → resend refuses; partial unscoped resend collects the balance", async () => {
    const { svc, tables, resend } = buildResend();
    await svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL });
    seedVerified(tables, { amountMinor: 4000n, purpose: "deposit" });
    const out: any = await resend.resendPaymentLink("org-1", "staff-1", "order-1", {});
    const txn = tables.tenantPaymentTransaction.rows.find((r: any) => r.id === out.transactionId);
    expect(txn.amountMinor).toBe(11000n);
    expect(txn.purpose).toBe("balance");
    seedVerified(tables, { amountMinor: 11000n, purpose: "balance" });
    await expect(resend.resendPaymentLink("org-1", "staff-1", "order-1", {}))
      .rejects.toThrow("ইতিমধ্যে পেমেন্ট সম্পন্ন হয়েছে");
  });
});
