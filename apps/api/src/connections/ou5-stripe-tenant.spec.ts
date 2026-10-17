process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "test-secret-value-for-ou5-stripe";

import { createHmac } from "node:crypto";
import { TenantPaymentsService } from "./tenant-payments.service";
import { decryptJson } from "../integrations/crypto";

/**
 * OU5 item 3(a) — Stripe as a tenant's OWN gateway.
 * Contract: docs/one-umbrella-ou5-stripe-evidence.md.
 * Pinned trust rules (the brief's spec list):
 * - verify-before-save: a REAL balance call verifies the key;
 *   a failure (or a key-mode / livemode mismatch) saves NOTHING;
 * - initiation alone NEVER marks anything paid;
 * - a webhook with a VALID signature (documented HMAC scheme
 *   over the raw body) marks paid exactly once — a duplicate
 *   delivery is idempotent;
 * - an INVALID signature is rejected and marks nothing;
 * - amount / currency / payment_status mismatches never pay;
 * - the browser return never marks anything paid;
 * - secrets never appear in any outward view.
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
      for (const row of rows) {
        if (matches(row, where)) {
          const nullChecks = Object.entries(where ?? {}).filter(([, v]) => v === null).map(([k]) => k);
          if (nullChecks.every((k) => row[k] === null || row[k] === undefined)) { Object.assign(row, data); count++; }
        }
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

const LIVE = { secretKey: "sk_live_ou5canary", webhookSecret: "whsec_ou5canary", publishableKey: "pk_live_ou5canary" };
const TEST = { secretKey: "sk_test_ou5canary", webhookSecret: "whsec_ou5testcanary", publishableKey: "pk_test_ou5canary" };

function gatewayStub(overrides: any = {}) {
  return {
    stripeRetrieveBalance: async (creds: any) => ({ livemode: String(creds.secretKey).startsWith("sk_live_") }),
    stripeCreateCheckoutSession: async () => ({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" }),
    stripeRetrieveCheckoutSession: async () => null,
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
    membership: makeTable("membership"),
    paymentLink: makeTable("link"),
  };
  tables.organization.rows.push({ id: "org-1", slug: "myshop", name: "My Shop" });
  tables.order.rows.push({
    id: "order-1", organizationId: "org-1", totalMinor: 15000n, currency: "USD",
    isCod: true, paymentMethod: "cod", internalNote: null, externalNumber: "ORD-1", isPractice: false,
  });
  const auditLogs: any[] = [];
  const audit = { log: async (entry: any) => { auditLogs.push(entry); } } as any;
  const svc = new TenantPaymentsService(tables as any, audit, stub);
  return { svc, tables, auditLogs, stub };
}

function stripeHeader(rawBody: string, secret: string, ts = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac("sha256", secret).update(`${ts}.${rawBody}`, "utf8").digest("hex");
  return `t=${ts},v1=${sig}`;
}

function completedBody(txnId: string, sessionOverrides: Record<string, any> = {}, type = "checkout.session.completed"): string {
  return JSON.stringify({
    id: "evt_1",
    type,
    data: {
      object: {
        id: "cs_1",
        payment_status: "paid",
        amount_total: 15000,
        currency: "usd",
        payment_intent: "pi_1",
        metadata: { reference_id: txnId },
        client_reference_id: txnId,
        ...sessionOverrides,
      },
    },
  });
}

async function seedLive(svc: any) {
  return svc.putGateway("org-1", "owner", "stripe", { ...LIVE, environment: "live" });
}

async function initiate(svc: any, tables: any) {
  const out = await svc.initiateOrderPayment("org-1", "order-1", "stripe", { customerEmail: "buyer@example.com" });
  const txn = tables.tenantPaymentTransaction.rows[0];
  return { out, txn };
}

describe("OU5(a) config — verify-before-save", () => {
  it("a verified live key saves as verified; secrets sealed and never shown", async () => {
    const { svc, tables } = buildService();
    const view: any = await seedLive(svc);
    expect(view.status).toBe("verified");
    expect(view.provider).toBe("stripe");
    expect(view.identifier).toBe(LIVE.publishableKey);
    expect(view.verificationNote).toBe("verified_with_gateway");
    expect(JSON.stringify(view)).not.toContain(LIVE.secretKey);
    expect(JSON.stringify(view)).not.toContain(LIVE.webhookSecret);
    const row = tables.tenantPaymentGateway.rows[0];
    expect(JSON.stringify(row.encryptedData)).not.toContain(LIVE.secretKey);
    const creds = decryptJson<any>(row.encryptedData);
    expect(creds.secretKey).toBe(LIVE.secretKey);
    expect(creds.sandbox).toBe(false);
  });

  it("a refused balance call saves NOTHING", async () => {
    const stub = gatewayStub({ stripeRetrieveBalance: async () => { throw new Error("Stripe refused the request: Invalid API Key provided"); } });
    const { svc, tables } = buildService(stub);
    await expect(svc.putGateway("org-1", "owner", "stripe", { ...LIVE })).rejects.toThrow(/Invalid API Key/);
    expect(tables.tenantPaymentGateway.rows).toHaveLength(0);
  });

  it("a test key in the LIVE set is refused before any Stripe call", async () => {
    let calls = 0;
    const stub = gatewayStub({ stripeRetrieveBalance: async () => { calls++; return { livemode: false }; } });
    const { svc, tables } = buildService(stub);
    await expect(svc.putGateway("org-1", "owner", "stripe", { ...TEST, environment: "live" })).rejects.toThrow(/LIVE key/);
    expect(calls).toBe(0);
    expect(tables.tenantPaymentGateway.rows).toHaveLength(0);
  });

  it("a live key in the SANDBOX set is refused; a test key verifies there", async () => {
    const { svc, tables } = buildService();
    await expect(svc.putGateway("org-1", "owner", "stripe", { ...LIVE, environment: "sandbox" })).rejects.toThrow(/TEST key/);
    const view: any = await svc.putGateway("org-1", "owner", "stripe", { ...TEST, environment: "sandbox" });
    expect(view.status).toBe("verified");
    expect(view.environment).toBe("sandbox");
    expect(view.sandbox).toBe(true);
    expect(tables.tenantPaymentGateway.rows).toHaveLength(1);
  });

  it("missing webhook secret refuses the save (no unverifiable gateway)", async () => {
    const { svc, tables } = buildService();
    await expect(svc.putGateway("org-1", "owner", "stripe", { secretKey: LIVE.secretKey })).rejects.toThrow(/Webhook Signing Secret/);
    expect(tables.tenantPaymentGateway.rows).toHaveLength(0);
  });

  it("a livemode answer that disagrees with the key refuses the save", async () => {
    const stub = gatewayStub({ stripeRetrieveBalance: async () => ({ livemode: false }) });
    const { svc, tables } = buildService(stub);
    await expect(svc.putGateway("org-1", "owner", "stripe", { ...LIVE })).rejects.toThrow(/livemode/);
    expect(tables.tenantPaymentGateway.rows).toHaveLength(0);
  });
});

describe("OU5(a) checkout + webhook — the verified_paid discipline", () => {
  it("initiation alone marks NOTHING paid", async () => {
    const { svc, tables } = buildService();
    await seedLive(svc);
    const { out, txn } = await initiate(svc, tables);
    expect(out.redirectUrl).toBe("https://checkout.stripe.com/c/pay/cs_1");
    expect(txn.status).toBe("initiated");
    expect(txn.providerTxnId).toBe("cs_1");
    expect(tables.order.rows[0].paymentMethod).toBe("cod");
  });

  it("a validly-signed checkout.session.completed marks paid exactly once; duplicate is idempotent", async () => {
    const { svc, tables } = buildService();
    await seedLive(svc);
    const { txn } = await initiate(svc, tables);
    const raw = completedBody(txn.id);
    const out: any = await svc.handleStripeWebhook(raw, stripeHeader(raw, LIVE.webhookSecret));
    expect(out.ok).toBe(true);
    expect(tables.tenantPaymentTransaction.rows[0].status).toBe("verified_paid");
    expect(tables.tenantPaymentTransaction.rows[0].valId).toBe("pi_1");
    expect(tables.order.rows[0].paymentMethod).toBe("stripe");
    expect(tables.order.rows[0].isCod).toBe(false);
    const again: any = await svc.handleStripeWebhook(raw, stripeHeader(raw, LIVE.webhookSecret));
    expect(again).toEqual({ ok: true, alreadyProcessed: true });
    expect(tables.tenantPaymentTransaction.rows).toHaveLength(1);
  });

  it("an INVALID signature is rejected and marks nothing", async () => {
    const { svc, tables } = buildService();
    await seedLive(svc);
    const { txn } = await initiate(svc, tables);
    const raw = completedBody(txn.id);
    const out: any = await svc.handleStripeWebhook(raw, stripeHeader(raw, "whsec_wrong_secret"));
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/signature/);
    expect(tables.tenantPaymentTransaction.rows[0].status).toBe("initiated");
    expect(tables.order.rows[0].paymentMethod).toBe("cod");
    // The forgery attempt is recorded on the transaction (CC23).
    const events = tables.tenantPaymentTransaction.rows[0].ipnEvents ?? [];
    expect(events.some((e: any) => e.kind === "signature_invalid")).toBe(true);
  });

  it("a tampered body (re-signed amount changed after signing) never pays", async () => {
    const { svc, tables } = buildService();
    await seedLive(svc);
    const { txn } = await initiate(svc, tables);
    const signed = completedBody(txn.id);
    const header = stripeHeader(signed, LIVE.webhookSecret);
    const tampered = signed.replace("15000", "100");
    const out: any = await svc.handleStripeWebhook(tampered, header);
    expect(out.ok).toBe(false);
    expect(tables.tenantPaymentTransaction.rows[0].status).toBe("initiated");
  });

  it("amount / currency / payment_status mismatches never pay", async () => {
    const { svc, tables } = buildService();
    await seedLive(svc);
    const { txn } = await initiate(svc, tables);
    for (const overrides of [{ amount_total: 14000 }, { currency: "eur" }, { payment_status: "unpaid" }]) {
      const raw = completedBody(txn.id, overrides);
      const out: any = await svc.handleStripeWebhook(raw, stripeHeader(raw, LIVE.webhookSecret));
      expect(out.ok).toBe(false);
      expect(tables.tenantPaymentTransaction.rows[0].status).toBe("initiated");
    }
    expect(tables.order.rows[0].paymentMethod).toBe("cod");
  });

  it("the browser return never marks anything paid", async () => {
    const { svc, tables } = buildService();
    await seedLive(svc);
    await initiate(svc, tables);
    const url = await svc.stripeReturnRedirect({ session_id: "cs_1" });
    expect(url).toContain("/shop/myshop/success?payment=verifying");
    expect(tables.tenantPaymentTransaction.rows[0].status).toBe("initiated");
    expect(tables.order.rows[0].paymentMethod).toBe("cod");
  });

  it("an expired session records the failure honestly", async () => {
    const { svc, tables } = buildService();
    await seedLive(svc);
    const { txn } = await initiate(svc, tables);
    const raw = completedBody(txn.id, {}, "checkout.session.expired");
    const out: any = await svc.handleStripeWebhook(raw, stripeHeader(raw, LIVE.webhookSecret));
    expect(out).toEqual({ ok: true, recorded: "failed" });
    expect(tables.tenantPaymentTransaction.rows[0].status).toBe("failed");
  });

  it("the labelled sandbox test runs on test keys and can never touch a real order", async () => {
    const { svc, tables } = buildService();
    await svc.putGateway("org-1", "owner", "stripe", { ...TEST, environment: "sandbox" });
    const started: any = await svc.initiateTestPayment("org-1", "owner", "stripe");
    expect(started.redirectUrl).toContain("checkout.stripe.com");
    const txn = tables.tenantPaymentTransaction.rows[0];
    expect(txn.environment).toBe("sandbox");
    expect(txn.orderId).toBe(TenantPaymentsService.SANDBOX_TEST_ORDER_ID);
    const raw = JSON.stringify({
      id: "evt_test", type: "checkout.session.completed",
      data: { object: { id: "cs_1", payment_status: "paid", amount_total: 10000, currency: "bdt", payment_intent: "pi_t", metadata: { reference_id: txn.id }, client_reference_id: txn.id } },
    });
    const out: any = await svc.handleStripeWebhook(raw, stripeHeader(raw, TEST.webhookSecret));
    expect(out.ok).toBe(true);
    expect(out.test).toBe(true);
    expect(tables.order.rows[0].paymentMethod).toBe("cod");
  });

  it("public options offer stripe ONLY as an own gateway", async () => {
    const { svc } = buildService();
    await seedLive(svc);
    const opts = await svc.publicPaymentOptions("org-1");
    expect(opts.online).toContainEqual({ provider: "stripe", source: "own", sandbox: false });
    expect(opts.online.some((o: any) => o.provider === "stripe" && o.source === "platform")).toBe(false);
    expect(opts.options).toContainEqual({ provider: "stripe", source: "own" });
    const pair = await svc.assertPublicPaymentOption("org-1", { provider: "stripe", source: "own" });
    expect(pair.provider).toBe("stripe");
    await expect(svc.assertPublicPaymentOption("org-1", { provider: "stripe", source: "platform" })).rejects.toThrow();
  });
});
