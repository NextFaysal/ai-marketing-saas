process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "gc11-test-secret";

import { validate } from "class-validator";
import { TenantPaymentsService } from "./tenant-payments.service";
import { WalletService } from "./wallet.service";
import { OnlinePaymentSelectionDto, PublicInitiatePaymentDto } from "./connections.dto";
import { decryptJson } from "../integrations/crypto";

/**
 * GC11 — ShurjoPay + aamarPay tenant gateways (stubbed gateway
 * client at the injectable boundary; shapes per
 * docs/gb4-gateway-research.md). Pinned trust rules, same as
 * CC9: an order is marked paid ONLY after the independent
 * server-side verification call (ShurjoPay /api/verification
 * sp_code "1000"; aamarPay Search Transaction pay_status
 * "Successful") confirms the EXACT amount + currency. Browser
 * returns / success POSTs / IPN posts are triggers only.
 * ShurjoPay verify-before-save is REAL (get_token); aamarPay
 * has no pre-transaction check → "configured" (like SSLCommerz).
 * Neither provider has a documented refund API → no refund
 * path exists to test, by design.
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

const SHURJO = { username: "sp_merchant", password: "shurjo-pass-secret", prefix: "SPX", sandbox: true };
const AAMAR = { storeId: "mystorebd", signatureKey: "aamar-signature-secret", sandbox: true };

function gatewayStub(overrides: any = {}) {
  return {
    bkashGrantToken: async () => "token-1",
    bkashCreatePayment: async () => ({ statusCode: "0000", bkashURL: "https://bkash.example/pay", paymentID: "PAY123" }),
    bkashExecutePayment: async () => ({ statusCode: "0000", transactionStatus: "Completed", amount: "150.00", currency: "BDT" }),
    bkashQueryPayment: async () => ({ statusCode: "0000", transactionStatus: "Completed", amount: "150.00", currency: "BDT" }),
    sslInitSession: async () => ({ status: "SUCCESS", GatewayPageURL: "https://ssl.example/pay", sessionkey: "SK1" }),
    sslValidate: async () => ({ status: "VALID", tran_id: "", amount: "150.00", currency: "BDT", store_id: "mystore" }),
    shurjoGetToken: async () => "sptoken-1",
    shurjoCreatePayment: async () => ({ checkout_url: "https://shurjo.example/pay", sp_order_id: "SPORD123" }),
    shurjoVerify: async () => ({ sp_code: "1000", amount: "150.00", currency: "BDT", sp_order_id: "SPORD123" }),
    aamarInit: async () => ({ result: "true", payment_url: "https://aamar.example/pay" }),
    aamarTrxCheck: async () => ({ pay_status: "Successful", amount: "150.00", currency: "BDT", status_code: "2" }),
    ...overrides,
  };
}

function buildService(stub: any = gatewayStub()) {
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
  return { svc, tables, stub };
}

async function seedShurjo(svc: any) { return svc.putGateway("org-1", "owner", "shurjopay", { ...SHURJO }); }
async function seedAamar(svc: any) { return svc.putGateway("org-1", "owner", "aamarpay", { ...AAMAR }); }

describe("GC11 config — verify-before-save truth", () => {
  it("ShurjoPay token failure saves NOTHING and surfaces the gateway message", async () => {
    const stub = gatewayStub({ shurjoGetToken: async () => { throw new Error("ShurjoPay token request failed: Invalid username or password"); } });
    const { svc, tables } = buildService(stub);
    await expect(svc.putGateway("org-1", "owner", "shurjopay", { ...SHURJO })).rejects.toThrow("Invalid username or password");
    expect(tables.tenantPaymentGateway.rows).toHaveLength(0);
  });

  it("ShurjoPay token success → verified; identifier is the username; secrets never in views", async () => {
    const { svc, tables } = buildService();
    const view: any = await seedShurjo(svc);
    expect(view.status).toBe("verified");
    expect(view.verificationNote).toBe("verified_with_gateway");
    expect(view.identifier).toBe("sp_merchant");
    expect(view.lastVerifiedAt).toBeTruthy();
    expect(JSON.stringify(view)).not.toContain(SHURJO.password);
    expect(decryptJson(tables.tenantPaymentGateway.rows[0].encryptedData)).toMatchObject({ username: "sp_merchant", prefix: "SPX" });
  });

  it("ShurjoPay requires username + password + prefix", async () => {
    const { svc, tables } = buildService();
    await expect(svc.putGateway("org-1", "owner", "shurjopay", { username: "u", password: "p" })).rejects.toThrow(/Prefix/);
    expect(tables.tenantPaymentGateway.rows).toHaveLength(0);
  });

  it("aamarPay saves honestly as configured (no pre-transaction check); secret never in views", async () => {
    const { svc } = buildService();
    const view: any = await seedAamar(svc);
    expect(view.status).toBe("configured");
    expect(view.verificationNote).toBe("no_pre_transaction_check");
    expect(view.identifier).toBe("mystorebd");
    expect(JSON.stringify(view)).not.toContain(AAMAR.signatureKey);
  });
});

describe("GC11 initiation", () => {
  it("ShurjoPay initiation returns checkout_url and stores sp_order_id as providerTxnId", async () => {
    const { svc, tables } = buildService();
    await seedShurjo(svc);
    const out: any = await svc.initiateOrderPayment("org-1", "order-1", "shurjopay", { customerPhone: "01700000000" });
    expect(out.redirectUrl).toBe("https://shurjo.example/pay");
    expect(out.providerTxnId).toBe("SPORD123");
    const txn = tables.tenantPaymentTransaction.rows[0];
    expect(txn.status).toBe("initiated");
    expect(txn.providerTxnId).toBe("SPORD123");
    expect(tables.order.rows[0].paymentMethod).toBe("cod");
  });

  it("ShurjoPay response without sp_order_id is refused (verification would be impossible)", async () => {
    const stub = gatewayStub({ shurjoCreatePayment: async () => ({ checkout_url: "https://shurjo.example/pay" }) });
    const { svc, tables } = buildService(stub);
    await seedShurjo(svc);
    await expect(svc.initiateOrderPayment("org-1", "order-1", "shurjopay")).rejects.toThrow(/sp_order_id/);
    expect(tables.tenantPaymentTransaction.rows[0].status).toBe("failed");
    expect(tables.order.rows[0].paymentMethod).toBe("cod");
  });

  it("aamarPay initiation returns payment_url and stores OUR tran_id as providerTxnId", async () => {
    const { svc, tables } = buildService();
    await seedAamar(svc);
    const out: any = await svc.initiateOrderPayment("org-1", "order-1", "aamarpay", { customerPhone: "01700000000" });
    expect(out.redirectUrl).toBe("https://aamar.example/pay");
    expect(out.providerTxnId).toBeTruthy();
    const txn = tables.tenantPaymentTransaction.rows[0];
    expect(txn.status).toBe("initiated");
    expect(txn.providerTxnId).toBe(out.providerTxnId);
  });

  it("aamarPay initiation refusal (result not true) marks nothing paid", async () => {
    const stub = gatewayStub({ aamarInit: async () => ({ result: "false", message: "Invalid store" }) });
    const { svc, tables } = buildService(stub);
    await seedAamar(svc);
    await expect(svc.initiateOrderPayment("org-1", "order-1", "aamarpay")).rejects.toThrow("Invalid store");
    expect(tables.order.rows[0].paymentMethod).toBe("cod");
  });
});

describe("GC11 ShurjoPay return — verification decides", () => {
  async function initiated(stubOverrides: any = {}) {
    const built = buildService(gatewayStub(stubOverrides));
    await seedShurjo(built.svc);
    const out: any = await built.svc.initiateOrderPayment("org-1", "order-1", "shurjopay");
    return { ...built, out };
  }

  it("sp_code 1000 + exact amount + currency → verified_paid exactly once", async () => {
    const { svc, tables, out } = await initiated();
    const url1 = await svc.handleShurjoReturn({ order_id: out.providerTxnId });
    expect(url1).toContain("payment=received");
    const txn = tables.tenantPaymentTransaction.rows[0];
    expect(txn.status).toBe("verified_paid");
    expect(txn.ipnPayload?.verification?.sp_code).toBe("1000");
    expect(tables.order.rows[0].paymentMethod).toBe("shurjopay");
    expect(tables.order.rows[0].isCod).toBe(false);
    const url2 = await svc.handleShurjoReturn({ order_id: out.providerTxnId });
    expect(url2).toContain("payment=received");
    expect(String(tables.order.rows[0].internalNote).split(txn.id).length - 1).toBe(1);
  });

  it("amount mismatch → NOT paid, order untouched", async () => {
    const { svc, tables, out } = await initiated({
      shurjoVerify: async () => ({ sp_code: "1000", amount: "999.00", currency: "BDT" }),
    });
    const url = await svc.handleShurjoReturn({ order_id: out.providerTxnId });
    expect(url).toContain("payment=failed");
    expect(tables.tenantPaymentTransaction.rows[0].status).toBe("initiated");
    expect(tables.order.rows[0].paymentMethod).toBe("cod");
  });

  it("currency mismatch → NOT paid", async () => {
    const { svc, tables, out } = await initiated({
      shurjoVerify: async () => ({ sp_code: "1000", amount: "150.00", currency: "USD" }),
    });
    await svc.handleShurjoReturn({ sp_order_id: out.providerTxnId });
    expect(tables.tenantPaymentTransaction.rows[0].status).toBe("initiated");
  });

  it("non-1000 sp_code → failed recorded, NOT paid", async () => {
    const { svc, tables, out } = await initiated({
      shurjoVerify: async () => ({ sp_code: "1061", amount: "150.00", currency: "BDT" }),
    });
    const url = await svc.handleShurjoReturn({ order_id: out.providerTxnId });
    expect(url).toContain("payment=failed");
    expect(tables.tenantPaymentTransaction.rows[0].status).toBe("failed");
    expect(tables.order.rows[0].paymentMethod).toBe("cod");
  });

  it("verification call failure → txn left initiated, buyer sees verifying", async () => {
    const { svc, tables, out } = await initiated({
      shurjoVerify: async () => { throw new Error("Could not reach ShurjoPay: timeout"); },
    });
    const url = await svc.handleShurjoReturn({ order_id: out.providerTxnId });
    expect(url).toContain("payment=verifying");
    expect(tables.tenantPaymentTransaction.rows[0].status).toBe("initiated");
  });

  it("unknown sp_order_id → dashboard fallback", async () => {
    const { svc } = await initiated();
    const url = await svc.handleShurjoReturn({ order_id: "NOPE" });
    expect(url).toContain("/dashboard/connections?payment=unknown");
  });
});

describe("GC11 aamarPay result/IPN — Search Transaction decides", () => {
  async function initiated(stubOverrides: any = {}) {
    const built = buildService(gatewayStub(stubOverrides));
    await seedAamar(built.svc);
    const out: any = await built.svc.initiateOrderPayment("org-1", "order-1", "aamarpay");
    return { ...built, out };
  }

  it("success POST + trxcheck Successful + exact amount/currency → paid", async () => {
    const { svc, tables, out } = await initiated();
    const url = await svc.handleAamarResult("success", { tran_id: out.providerTxnId });
    expect(url).toContain("payment=received");
    expect(tables.tenantPaymentTransaction.rows[0].status).toBe("verified_paid");
    expect(tables.order.rows[0].paymentMethod).toBe("aamarpay");
  });

  it("success POST + trxcheck amount mismatch → NOT paid (trigger alone never pays)", async () => {
    const { svc, tables, out } = await initiated({
      aamarTrxCheck: async () => ({ pay_status: "Successful", amount: "10.00", currency: "BDT" }),
    });
    const url = await svc.handleAamarResult("success", { tran_id: out.providerTxnId });
    expect(url).toContain("payment=failed");
    expect(tables.tenantPaymentTransaction.rows[0].status).toBe("initiated");
    expect(tables.order.rows[0].paymentMethod).toBe("cod");
  });

  it("success POST + trxcheck call failure → NOT paid", async () => {
    const { svc, tables, out } = await initiated({
      aamarTrxCheck: async () => { throw new Error("Could not reach aamarPay: timeout"); },
    });
    await svc.handleAamarResult("success", { tran_id: out.providerTxnId });
    expect(tables.tenantPaymentTransaction.rows[0].status).toBe("initiated");
    expect(tables.order.rows[0].paymentMethod).toBe("cod");
  });

  it("success POST + trxcheck failed status → failed recorded, NOT paid", async () => {
    const { svc, tables, out } = await initiated({
      aamarTrxCheck: async () => ({ pay_status: "Failed", amount: "150.00", currency: "BDT" }),
    });
    await svc.handleAamarResult("success", { tran_id: out.providerTxnId });
    expect(tables.tenantPaymentTransaction.rows[0].status).toBe("failed");
  });

  it("fail POST → failed recorded; cancel POST → cancelled recorded (fresh txn)", async () => {
    const a = await initiated();
    const urlA = await a.svc.handleAamarResult("fail", { tran_id: a.out.providerTxnId });
    expect(urlA).toContain("payment=failed");
    expect(a.tables.tenantPaymentTransaction.rows[0].status).toBe("failed");
    const b = await initiated();
    const urlB = await b.svc.handleAamarResult("cancel", { mer_txnid: b.out.providerTxnId });
    expect(urlB).toContain("payment=cancelled");
    expect(b.tables.tenantPaymentTransaction.rows[0].status).toBe("cancelled");
  });

  it("IPN is a trigger only: trxcheck Successful + exact → paid; re-delivery alreadyProcessed", async () => {
    const { svc, tables, out } = await initiated();
    const res1: any = await svc.handleAamarIpn({ tran_id: out.providerTxnId });
    expect(res1.ok).toBe(true);
    expect(tables.tenantPaymentTransaction.rows[0].status).toBe("verified_paid");
    const res2: any = await svc.handleAamarIpn({ tran_id: out.providerTxnId });
    expect(res2.alreadyProcessed).toBe(true);
  });

  it("IPN + trxcheck unconfirmed → ok:false, NOT paid", async () => {
    const { svc, tables, out } = await initiated({
      aamarTrxCheck: async () => ({ status: "Invalid-Data", request_id: "x", store_id: "mystorebd" }),
    });
    const res: any = await svc.handleAamarIpn({ tran_id: out.providerTxnId });
    expect(res.ok).toBe(false);
    expect(tables.tenantPaymentTransaction.rows[0].status).toBe("initiated");
  });
});

describe("GC11 GC10 surfaces + platform separation", () => {
  it("enabled OWN shurjopay/aamarpay appear in publicPaymentOptions (own only)", async () => {
    const { svc } = buildService();
    await seedShurjo(svc);
    await seedAamar(svc);
    const out = await svc.publicPaymentOptions("org-1");
    expect(out.online).toEqual(expect.arrayContaining([
      { provider: "shurjopay", source: "own", sandbox: true },
      { provider: "aamarpay", source: "own", sandbox: true },
    ]));
    expect(out.online.some((o: any) => o.source === "platform")).toBe(false);
    await expect(svc.assertPublicPaymentOption("org-1", { provider: "shurjopay", source: "own" }))
      .resolves.toEqual({ provider: "shurjopay", source: "own" });
    await expect(svc.assertPublicPaymentOption("org-1", { provider: "shurjopay", source: "platform" }))
      .rejects.toThrow(/উপলব্ধ নয়/);
  });

  it("platform initiation for shurjopay refuses (platform path stays sslcommerz/bkash)", async () => {
    const { svc } = buildService();
    await seedShurjo(svc);
    await expect(svc.initiatePlatformOrderPayment("org-1", "order-1", "shurjopay")).rejects.toThrow(/sslcommerz \| bkash/);
    await expect(svc.initiatePlatformOrderPayment("org-1", "order-1", "aamarpay")).rejects.toThrow(/sslcommerz \| bkash/);
  });

  it("DTO allowlists accept the new OWN providers and still refuse nagad/rocket", async () => {
    const pub = new PublicInitiatePaymentDto();
    pub.orderId = "order-1"; pub.orderNumber = "ORD-1"; pub.provider = "shurjopay";
    expect(await validate(pub)).toHaveLength(0);
    pub.provider = "aamarpay";
    expect(await validate(pub)).toHaveLength(0);
    pub.provider = "nagad";
    expect((await validate(pub)).length).toBeGreaterThan(0);
    const sel = new OnlinePaymentSelectionDto();
    sel.provider = "aamarpay"; sel.source = "own";
    expect(await validate(sel)).toHaveLength(0);
    sel.provider = "rocket";
    expect((await validate(sel)).length).toBeGreaterThan(0);
  });
});
