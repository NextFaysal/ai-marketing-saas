process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import { createHmac } from "node:crypto";
import { PaymentsService } from "./payments.service";
import { setPlatformConfigSnapshot } from "../common/platform-config";

/**
 * OU5 item 3(b) — Stripe as a platform subscription-billing
 * gateway, alongside SSLCommerz/bKash in PaymentsService.
 * Contract: docs/one-umbrella-ou5-stripe-evidence.md.
 * Pinned trust rules (same as M36/M39, applied to Stripe):
 * - initiation alone activates NOTHING;
 * - activation happens ONLY in the webhook, after the
 *   signature verifies over the raw body AND payment_status is
 *   "paid" with the exact amount_total + currency;
 * - a duplicate webhook is idempotent (exactly one payment row,
 *   exactly one activation);
 * - an invalid signature is rejected and activates nothing;
 * - the browser return activates nothing;
 * - an unconfigured Stripe refuses checkout honestly.
 * Fetch is stubbed at the global boundary (the StripeClient's
 * injectable-fetch discipline).
 */

function match(row: any, where: any = {}): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("gte" in (v as any)) { if (!(new Date(row[k]).getTime() >= new Date((v as any).gte).getTime())) return false; }
      else if ("in" in (v as any)) { if (!(v as any).in.includes(row[k])) return false; }
      else return false;
    } else if (row[k] !== v) return false;
  }
  return true;
}
function table(seed: any[] = []) {
  const rows = [...seed];
  let seq = rows.length;
  return {
    rows,
    create: async ({ data }: any) => { const row = { id: `row-${++seq}`, createdAt: new Date(), ...data }; rows.push(row); return row; },
    findMany: async (args: any = {}) => {
      let out = rows.filter((r) => match(r, args.where ?? {}));
      if (args.orderBy?.createdAt === "desc") out = [...out].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (args.take) out = out.slice(0, args.take);
      return out;
    },
    findFirst: async (args: any = {}) => {
      const out = rows.filter((r) => match(r, args.where ?? {}));
      out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return out[0] ?? null;
    },
    findUnique: async ({ where }: any) => rows.find((r) =>
      (where.id !== undefined && r.id === where.id) ||
      (where.code !== undefined && r.code === where.code) ||
      (where.tranId !== undefined && r.tranId === where.tranId) ||
      (where.key !== undefined && r.key === where.key)) ?? null,
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (row) Object.assign(row, data);
      return row;
    },
    count: async (args: any = {}) => rows.filter((r) => match(r, args.where ?? {})).length,
  };
}

const ACTOR = { userId: "u-1", email: "owner@x.com" };
const STRIPE = { secretKey: "sk_test_ou5canary", webhookSecret: "whsec_ou5canary", publishableKey: "pk_test_ou5canary" };

let fetchCalls: { url: string; init?: any }[] = [];
function stubFetch(handler: (url: string, init?: any) => any) {
  fetchCalls = [];
  (global as any).fetch = async (url: string, init?: any) => {
    fetchCalls.push({ url: String(url), init });
    const body = handler(String(url), init);
    return { status: 200, json: async () => body };
  };
}

function makePayments(withStripe = true) {
  const p: any = {
    planCheckout: table(),
    organization: {
      rows: [{ id: "org-1", name: "Test Shop", creditMinor: 0n }],
      findUnique: async () => p.organization.rows[0],
      update: async ({ data }: any) => { Object.assign(p.organization.rows[0], data); return p.organization.rows[0]; },
      findMany: async () => p.organization.rows,
    },
    businessProfile: { findUnique: async () => ({ contactEmail: "owner@x.com", contactPhone: "01700000000" }) },
    subscription: table([{ id: "sub-1", organizationId: "org-1", plan: "FREE", status: "TRIALING", currentPeriodEnd: new Date(Date.now() - 86400000), createdAt: new Date() }]),
    saasPayment: table(),
    coupon: table(),
    couponRedemption: table(),
    systemSetting: { findUnique: async () => null },
  };
  const auditEntries: any[] = [];
  const audit: any = { log: async (e: any) => { auditEntries.push(e); } };
  setPlatformConfigSnapshot({
    llm: null, metaApp: null, smtp: null, sms: null,
    sslcommerz: { storeId: "teststore", storePass: "test-pass", sandbox: true },
    bkash: { appKey: "ak", appSecret: "as", username: "bu", password: "bp", sandbox: true },
    stripe: withStripe ? { ...STRIPE } : null,
    loadedAt: Date.now(),
  } as any);
  return { svc: new PaymentsService(p, audit), p, auditEntries };
}

function sign(raw: string, secret: string, ts = Math.floor(Date.now() / 1000)): string {
  return `t=${ts},v1=${createHmac("sha256", secret).update(`${ts}.${raw}`, "utf8").digest("hex")}`;
}

function completedEvent(checkoutId: string, overrides: Record<string, any> = {}): string {
  return JSON.stringify({
    id: "evt_1", type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_1", payment_status: "paid", amount_total: 300000, currency: "bdt",
        payment_intent: "pi_1", metadata: { reference_id: checkoutId }, client_reference_id: checkoutId,
        ...overrides,
      },
    },
  });
}

async function startStripeCheckout(svc: any, p: any) {
  stubFetch((url: string) => {
    if (url === "https://api.stripe.com/v1/checkout/sessions") return { id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" };
    throw new Error(`unexpected fetch ${url}`);
  });
  const out = await svc.createCheckout("org-1", ACTOR, "GROWTH", "01712345678", { gateway: "stripe" });
  return { out, checkout: p.planCheckout.rows[0] };
}

describe("OU5(b) Stripe platform checkout", () => {
  it("creates a real Checkout Session (minor units verbatim) and activates NOTHING", async () => {
    const { svc, p } = makePayments();
    const { out, checkout } = await startStripeCheckout(svc, p);
    expect(out.gatewayUrl).toBe("https://checkout.stripe.com/c/pay/cs_1");
    expect(out.gateway).toBe("stripe");
    expect(out.sandbox).toBe(true); // sk_test_ — honestly labelled test mode
    expect(checkout.gateway).toBe("stripe");
    expect(checkout.status).toBe("initiated");
    expect(checkout.gatewayDetail.sessionId).toBe("cs_1");
    const body = String(fetchCalls[0].init.body);
    expect(body).toContain("mode=payment");
    expect(body).toContain("unit_amount");
    expect(body).toContain("300000");
    expect(body).toContain(encodeURIComponent(checkout.id));
    // Nothing activated by initiation.
    expect(p.subscription.rows[0].plan).toBe("FREE");
    expect(p.saasPayment.rows).toHaveLength(0);
  });

  it("refuses honestly when Stripe is not configured", async () => {
    const { svc } = makePayments(false);
    await expect(svc.createCheckout("org-1", ACTOR, "GROWTH", "01712345678", { gateway: "stripe" }))
      .rejects.toMatchObject({ code: "payments.stripeNotConfiguredPlatform", status: 400 });
  });

  it("a validly-signed webhook activates exactly once; duplicate is idempotent", async () => {
    const { svc, p } = makePayments();
    const { checkout } = await startStripeCheckout(svc, p);
    const raw = completedEvent(checkout.id);
    const out: any = await svc.handleStripeWebhook(raw, sign(raw, STRIPE.webhookSecret));
    expect(out.ok).toBe(true);
    expect(out.activated).toBe(true);
    expect(p.planCheckout.rows[0].status).toBe("success");
    expect(p.subscription.rows[0].plan).toBe("GROWTH");
    expect(p.subscription.rows[0].status).toBe("ACTIVE");
    expect(p.saasPayment.rows).toHaveLength(1);
    expect(p.saasPayment.rows[0].method).toBe("stripe");
    expect(BigInt(p.saasPayment.rows[0].amountMinor)).toBe(300000n);
    const again: any = await svc.handleStripeWebhook(raw, sign(raw, STRIPE.webhookSecret));
    expect(again).toEqual({ ok: true, alreadyProcessed: true });
    expect(p.saasPayment.rows).toHaveLength(1);
  });

  it("an INVALID signature is rejected and activates nothing", async () => {
    const { svc, p } = makePayments();
    const { checkout } = await startStripeCheckout(svc, p);
    const raw = completedEvent(checkout.id);
    const out: any = await svc.handleStripeWebhook(raw, sign(raw, "whsec_wrong"));
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/signature/);
    expect(p.planCheckout.rows[0].status).toBe("initiated");
    expect(p.subscription.rows[0].plan).toBe("FREE");
    expect(p.saasPayment.rows).toHaveLength(0);
  });

  it("amount / currency / payment_status mismatches never activate", async () => {
    const { svc, p } = makePayments();
    const { checkout } = await startStripeCheckout(svc, p);
    for (const overrides of [{ amount_total: 299999 }, { currency: "usd" }, { payment_status: "unpaid" }]) {
      const raw = completedEvent(checkout.id, overrides);
      const out: any = await svc.handleStripeWebhook(raw, sign(raw, STRIPE.webhookSecret));
      expect(out.ok).toBe(false);
      expect(p.planCheckout.rows[0].status).toBe("initiated");
    }
    expect(p.subscription.rows[0].plan).toBe("FREE");
    expect(p.saasPayment.rows).toHaveLength(0);
  });

  it("the browser return activates nothing", async () => {
    const { svc, p } = makePayments();
    await startStripeCheckout(svc, p);
    const url = svc.stripeReturnRedirect({ session_id: "cs_1" });
    expect(url).toBe("http://localhost:3000/dashboard/billing?payment=received");
    expect(p.planCheckout.rows[0].status).toBe("initiated");
    expect(p.subscription.rows[0].plan).toBe("FREE");
  });

  it("reconcile re-reads the session and activates only on paid + exact amount", async () => {
    const { svc, p } = makePayments();
    const { checkout } = await startStripeCheckout(svc, p);
    stubFetch((url: string) => {
      if (url === "https://api.stripe.com/v1/checkout/sessions/cs_1") {
        return { id: "cs_1", payment_status: "paid", amount_total: 300000, currency: "bdt", payment_intent: "pi_1" };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const out: any = await svc.reconcileCheckout(checkout.id);
    expect(out.ok).toBe(true);
    expect(out.reconciled).toBe(true);
    expect(p.subscription.rows[0].plan).toBe("GROWTH");
  });
});
