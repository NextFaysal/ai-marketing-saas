import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * OU5 — Stripe wire client + webhook signature verification.
 *
 * The contract implemented here is evidenced from Stripe's
 * OFFICIAL docs in docs/one-umbrella-ou5-stripe-evidence.md:
 * - POST /v1/checkout/sessions (form-encoded), mode=payment,
 *   line_items price_data unit_amount in MINOR units, the
 *   response's hosted `url` is the buyer redirect;
 * - GET /v1/balance as the side-effect-free credential check
 *   (returns `livemode` for the authenticated account);
 * - GET /v1/checkout/sessions/{id} for reconciliation;
 * - webhook signature: `Stripe-Signature: t=<unix>,v1=<hex>`,
 *   signed_payload = "<t>.<RAW body>", HMAC-SHA256 hex keyed
 *   with the endpoint signing secret (whsec_...), constant-time
 *   comparison, 5-minute default timestamp tolerance.
 *
 * No Stripe SDK dependency: the codebase's gateway discipline
 * is injectable-fetch clients (TenantGatewayClient pattern),
 * and the three endpoints + the signature scheme above are
 * the whole surface this integration uses. Errors propagate
 * with Stripe's own message — nothing here softens, retries
 * into a different outcome, or invents success. Secret keys
 * and webhook secrets are NEVER logged.
 */

export interface StripeCreds {
  secretKey: string;
  webhookSecret: string;
  /** Non-secret; shown in views and sent nowhere by the server
   * (Checkout is hosted — the publishable key is recorded only
   * so the merchant can see which key pair is configured). */
  publishableKey?: string;
}

/** The mode a Stripe secret key belongs to, from its documented
 * prefix. Anything else is not a Stripe secret key. */
export function stripeKeyMode(secretKey: string): "test" | "live" | null {
  if (secretKey.startsWith("sk_test_") || secretKey.startsWith("rk_test_")) return "test";
  if (secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_")) return "live";
  return null;
}

export function stripeApiBase(): string {
  return "https://api.stripe.com";
}

/**
 * Verify a Stripe webhook signature over the RAW body.
 * Follows the documented manual-verification scheme exactly:
 * parse t + every v1 from the header, rebuild
 * `${t}.${rawBody}`, HMAC-SHA256 hex with the endpoint secret,
 * constant-time compare against each v1, and enforce the
 * timestamp tolerance (default 300s — Stripe's library
 * default). Any malformation is simply "not verified".
 */
export function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined | null,
  webhookSecret: string,
  nowSec: number = Math.floor(Date.now() / 1000),
  toleranceSec: number = 300,
): boolean {
  if (!rawBody || !signatureHeader || !webhookSecret) return false;
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of String(signatureHeader).split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") timestamp = value;
    if (key === "v1" && value) signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(nowSec - ts) > toleranceSec) return false;
  const expected = createHmac("sha256", webhookSecret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  const expectedBuf = Buffer.from(expected);
  return signatures.some((sig) => {
    const sigBuf = Buffer.from(sig);
    return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf);
  });
}

function encodeForm(fields: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) params.set(k, v);
  return params.toString();
}

export class StripeClient {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  private async call(secretKey: string, method: "GET" | "POST", path: string, form?: Record<string, string>): Promise<any> {
    let res: any = null;
    try {
      const r = await this.fetchFn(`${stripeApiBase()}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${secretKey}`,
          Accept: "application/json",
          ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        },
        ...(form ? { body: encodeForm(form) } : {}),
        signal: AbortSignal.timeout(20_000),
      } as any);
      res = await r.json().catch(() => null);
      if (typeof (r as any)?.status === "number" && ((r as any).status < 200 || (r as any).status >= 300)) {
        throw new Error(`Stripe refused the request (HTTP ${(r as any).status}): ${res?.error?.message ?? "unknown error"}`);
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Stripe refused")) throw e;
      throw new Error(`Could not reach Stripe: ${e instanceof Error ? e.message : "network error"}`);
    }
    if (res?.error) {
      throw new Error(`Stripe refused the request: ${res.error.message ?? res.error.type ?? "unknown error"}`);
    }
    return res;
  }

  /** The verify-before-save credential check: Stripe returns
   * the authenticated account's balance object, including
   * `livemode`. A bad key is refused by Stripe itself. */
  async retrieveBalance(secretKey: string): Promise<{ livemode: boolean }> {
    const res = await this.call(secretKey, "GET", "/v1/balance");
    if (!res || typeof res.livemode !== "boolean") {
      throw new Error("Stripe balance response did not confirm the account (no livemode flag)");
    }
    return { livemode: res.livemode === true };
  }

  /** Create a hosted Checkout Session (mode=payment). The
   * caller requires id + url on the response; amountMinor is
   * passed through as unit_amount verbatim (Stripe amounts
   * ARE minor units). metadata + client_reference_id carry
   * the caller's own record id back into the webhook. */
  async createCheckoutSession(secretKey: string, input: {
    amountMinor: number;
    currency: string;
    productName: string;
    successUrl: string;
    cancelUrl: string;
    referenceId: string;
    customerEmail?: string;
  }): Promise<{ id: string; url: string }> {
    const form: Record<string, string> = {
      mode: "payment",
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.referenceId,
      "metadata[reference_id]": input.referenceId,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": input.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": String(Math.round(input.amountMinor)),
      "line_items[0][price_data][product_data][name]": input.productName.slice(0, 250),
    };
    if (input.customerEmail) form.customer_email = input.customerEmail;
    const res = await this.call(secretKey, "POST", "/v1/checkout/sessions", form);
    if (!res?.id || !res?.url) {
      throw new Error("Stripe session response carried no id/url — the session is not usable");
    }
    return { id: String(res.id), url: String(res.url) };
  }

  /** Reconciliation read: the session object as Stripe holds
   * it (payment_status / amount_total / currency are judged by
   * the caller, never here). */
  async retrieveCheckoutSession(secretKey: string, sessionId: string): Promise<any> {
    return this.call(secretKey, "GET", `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
  }
}
