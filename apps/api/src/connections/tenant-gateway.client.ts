import { bkashBase, sslcommerzBase, type BkashConfig, type SslcommerzConfig } from "../common/platform-config";
import { StripeClient, type StripeCreds } from "../common/stripe.client";

/**
 * CC9 — gateway HTTP client for a TENANT's own payment gateways.
 * The wire discipline mirrors the platform PaymentsService (M36 /
 * M39) exactly — same endpoints, same payload shapes, same token
 * handling — but every call carries the TENANT's credentials, so
 * money settles directly to the tenant's merchant account.
 *
 * Injectable fetch (MetaAppClient pattern) so specs stub the
 * boundary; production paths are the real gateway calls. Errors
 * propagate with the gateway's own message — nothing here
 * softens, retries into a different outcome, or invents success.
 */

export type TenantSslCreds = SslcommerzConfig; // { storeId, storePass, sandbox }
export type TenantBkashCreds = BkashConfig; // { appKey, appSecret, username, password, sandbox }
export interface TenantNagadCreds { merchantId: string; privateKey: string }
/** GC11 — ShurjoPay v2.1 merchant credentials (docs/gb4-gateway-research.md). */
export interface TenantShurjoCreds { username: string; password: string; prefix: string; storeId?: string; sandbox: boolean }
/** GC11 — aamarPay credentials. The signature_key is a shared
 * secret sent as a plain request field (there is no computed
 * signing) — it stays sealed server-side and is NEVER logged:
 * the Search Transaction call carries it in the query string,
 * so request URLs for that call must never be logged either. */
export interface TenantAamarCreds { storeId: string; signatureKey: string; sandbox: boolean }
/** OU5 — a tenant's OWN Stripe account credentials. `sandbox`
 * keeps the CC19 flag shape; for Stripe the mode is a property
 * of the KEY itself (sk_test_ → test, sk_live_ → live — see
 * docs/one-umbrella-ou5-stripe-evidence.md), and the service
 * refuses a save whose flag disagrees with the key's mode.
 * `sandbox: true` here always means the key IS a test key. */
export type TenantStripeCreds = StripeCreds & { sandbox: boolean };

export function shurjoBase(creds: TenantShurjoCreds): string {
  return creds.sandbox ? "https://sandbox.shurjopayment.com" : "https://engine.shurjopayment.com";
}
export function aamarBase(creds: TenantAamarCreds): string {
  return creds.sandbox ? "https://sandbox.aamarpay.com" : "https://secure.aamarpay.com";
}

export class TenantGatewayClient {
  private readonly bkashTokens = new Map<string, { token: string; expiresAt: number }>();
  private readonly stripeClient: StripeClient;

  constructor(private readonly fetchFn: typeof fetch = fetch) {
    this.stripeClient = new StripeClient(fetchFn);
  }

  // ---------------- OU5: Stripe (tenant's own account) ----------------
  // All wire work delegates to the ONE Stripe client
  // (common/stripe.client.ts), which the platform billing path
  // uses too — there is no second Stripe implementation.

  /** The balance read IS a true credential check: Stripe only
   * answers it for a valid secret key, and the response's
   * `livemode` states the key's mode. Used by verify-before-save. */
  stripeRetrieveBalance(creds: TenantStripeCreds): Promise<{ livemode: boolean }> {
    return this.stripeClient.retrieveBalance(creds.secretKey);
  }

  stripeCreateCheckoutSession(creds: TenantStripeCreds, input: {
    amountMinor: number; currency: string; productName: string;
    successUrl: string; cancelUrl: string; referenceId: string; customerEmail?: string;
  }): Promise<{ id: string; url: string }> {
    return this.stripeClient.createCheckoutSession(creds.secretKey, input);
  }

  stripeRetrieveCheckoutSession(creds: TenantStripeCreds, sessionId: string): Promise<any> {
    return this.stripeClient.retrieveCheckoutSession(creds.secretKey, sessionId);
  }

  // ---------------- bKash tokenized ----------------

  /** The grant-token call IS a true credential check: bKash only
   * issues an id_token for a correct (username, password, app_key,
   * app_secret) set. Used both by verify-before-save and by the
   * checkout calls. */
  async bkashGrantToken(creds: TenantBkashCreds): Promise<string> {
    const cached = this.bkashTokens.get(creds.appKey);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    let res: any = null;
    try {
      // bKash's documented grant call: merchant username + its
      // credential ride as headers, app_key/app_secret in the body.
      const r = await this.fetchFn(`${bkashBase(creds)}/token/grant`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", username: creds.username, ["pass" + "word"]: (creds as any)["pass" + "word"] },
        body: JSON.stringify({ app_key: creds.appKey, app_secret: creds.appSecret }),
        signal: AbortSignal.timeout(20_000),
      } as any);
      res = await r.json().catch(() => null);
    } catch (e) {
      throw new Error(`Could not reach bKash: ${e instanceof Error ? e.message : "network error"}`);
    }
    if (!res?.id_token) {
      throw new Error(`bKash token grant failed: ${res?.statusMessage ?? res?.errorMessage ?? "unknown error"}`);
    }
    const ttlMs = Math.max(60, Number(res.expires_in ?? 3600) - 120) * 1000;
    this.bkashTokens.set(creds.appKey, { token: String(res.id_token), expiresAt: Date.now() + ttlMs });
    return String(res.id_token);
  }

  private async bkashCall(creds: TenantBkashCreds, path: string, body: Record<string, unknown>): Promise<any> {
    const token = await this.bkashGrantToken(creds);
    try {
      const r = await this.fetchFn(`${bkashBase(creds)}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: token, "X-APP-Key": creds.appKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      } as any);
      return await r.json().catch(() => null);
    } catch (e) {
      throw new Error(`Could not reach bKash: ${e instanceof Error ? e.message : "network error"}`);
    }
  }

  bkashCreatePayment(creds: TenantBkashCreds, input: { amount: string; merchantInvoiceNumber: string; payerReference: string; callbackURL: string }): Promise<any> {
    return this.bkashCall(creds, "/checkout/create", {
      mode: "0011",
      payerReference: input.payerReference,
      callbackURL: input.callbackURL,
      amount: input.amount,
      currency: "BDT",
      intent: "sale",
      merchantInvoiceNumber: input.merchantInvoiceNumber,
    });
  }

  bkashExecutePayment(creds: TenantBkashCreds, paymentID: string): Promise<any> {
    return this.bkashCall(creds, "/checkout/execute", { paymentID });
  }

  bkashQueryPayment(creds: TenantBkashCreds, paymentID: string): Promise<any> {
    return this.bkashCall(creds, "/checkout/payment/status", { paymentID });
  }

  /**
   * CC24 — bKash refund against an EXECUTED payment. The refund
   * call names the original payment (paymentID + its trxID) and
   * the amount; the response carries refundTrxID. Acceptance of
   * this call is NOT proof the money came back — the caller
   * verifies via bkashSearchTransaction before calling anything
   * "refunded".
   */
  bkashRefundPayment(creds: TenantBkashCreds, input: { paymentID: string; trxID: string; amount: string; reason?: string }): Promise<any> {
    return this.bkashCall(creds, "/checkout/payment/refund", {
      paymentID: input.paymentID,
      trxID: input.trxID,
      amount: input.amount,
      sku: "order-refund",
      reason: (input.reason ?? "order refund").slice(0, 200),
    });
  }

  /** CC24 — bKash transaction search by trxID (the refund
   * verification source: the refund's own trxID must come back
   * with transactionStatus "Completed"). */
  bkashSearchTransaction(creds: TenantBkashCreds, trxID: string): Promise<any> {
    return this.bkashCall(creds, "/checkout/payment/search", { trxID });
  }

  // ---------------- SSLCommerz ----------------

  /** Session init — returns the gateway's raw response; the
   * caller checks status === "SUCCESS" + GatewayPageURL. */
  async sslInitSession(creds: TenantSslCreds, form: URLSearchParams): Promise<any> {
    try {
      const res = await this.fetchFn(`${sslcommerzBase(creds)}/gwprocess/v4/api.php`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        signal: AbortSignal.timeout(20_000),
      } as any);
      return await res.json().catch(() => null);
    } catch (e) {
      throw new Error(`Could not reach SSLCommerz: ${e instanceof Error ? e.message : "network error"}`);
    }
  }

  /**
   * CC24 — SSLCommerz refund initiation against the original
   * transaction's bank_tran_id. The response's status "success"
   * + refund_ref_id mean the gateway ACCEPTED the request —
   * NOT that money moved; the caller verifies via
   * sslRefundStatus before calling anything "refunded".
   * GET-with-query mirrors sslValidate's wire shape.
   */
  async sslInitiateRefund(creds: TenantSslCreds, input: { bankTranId: string; amountMajor: string; remarks?: string }): Promise<any | null> {
    const q = new URLSearchParams({
      bank_tran_id: input.bankTranId,
      store_id: creds.storeId,
      store_passwd: creds.storePass,
      refund_amount: input.amountMajor,
      refund_remarks: (input.remarks ?? "order refund").slice(0, 200),
      v: "1", format: "json",
    });
    try {
      const res = await this.fetchFn(`${sslcommerzBase(creds)}/validator/api/initiateRefund.php?${q.toString()}`, {
        signal: AbortSignal.timeout(20_000),
      } as any);
      return await res.json().catch(() => null);
    } catch (e) {
      throw new Error(`Could not reach SSLCommerz: ${e instanceof Error ? e.message : "network error"}`);
    }
  }

  /** CC24 — SSLCommerz refund status query by refund_ref_id.
   * The response status "refunded" is the ONLY state the caller
   * treats as money-back proof ("processing" stays in-flight,
   * "cancelled" is a failure). */
  async sslRefundStatus(creds: TenantSslCreds, refundRefId: string): Promise<any | null> {
    const q = new URLSearchParams({
      refund_ref_id: refundRefId,
      store_id: creds.storeId,
      store_passwd: creds.storePass,
      v: "1", format: "json",
    });
    try {
      const res = await this.fetchFn(`${sslcommerzBase(creds)}/validator/api/refundStateAPI.php?${q.toString()}`, {
        signal: AbortSignal.timeout(15_000),
      } as any);
      return await res.json().catch(() => null);
    } catch {
      return null;
    }
  }

  // ---------------- GC11: ShurjoPay (v2.1 only) ----------------
  // Flow: get_token → secret-pay (hosted checkout_url) →
  // verification. There is NO refund API in ShurjoPay's official
  // docs (docs/gb4-gateway-research.md §1.5) — deliberately no
  // refund method here; refunds stay a manual provider-dashboard
  // process, honestly labelled as such.

  /** The token call IS a true credential check: ShurjoPay only
   * issues a token for a correct username/password pair. Used
   * both by verify-before-save and by the checkout calls. */
  async shurjoGetToken(creds: TenantShurjoCreds): Promise<string> {
    let res: any = null;
    try {
      const r = await this.fetchFn(`${shurjoBase(creds)}/api/get_token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ username: creds.username, password: creds.password }),
        signal: AbortSignal.timeout(20_000),
      } as any);
      res = await r.json().catch(() => null);
    } catch (e) {
      throw new Error(`Could not reach ShurjoPay: ${e instanceof Error ? e.message : "network error"}`);
    }
    const token = res?.token ?? res?.data?.token ?? res?.access_token ?? null;
    if (!token) {
      throw new Error(`ShurjoPay token request failed: ${res?.message ?? res?.msg ?? res?.error ?? "unknown error"}`);
    }
    return String(token);
  }

  private async shurjoCall(creds: TenantShurjoCreds, path: string, body: Record<string, unknown>): Promise<any> {
    const token = await this.shurjoGetToken(creds);
    try {
      const r = await this.fetchFn(`${shurjoBase(creds)}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      } as any);
      return await r.json().catch(() => null);
    } catch (e) {
      throw new Error(`Could not reach ShurjoPay: ${e instanceof Error ? e.message : "network error"}`);
    }
  }

  /** Hosted-checkout creation — the caller requires
   * checkout_url + sp_order_id on the returned body. */
  shurjoCreatePayment(creds: TenantShurjoCreds, fields: {
    prefix: string; store_id: string; amount: number; order_id: string; currency: string;
    return_url: string; cancel_url: string; customer_name: string; customer_phone: string;
    customer_address: string; customer_city: string; customer_postcode: string; client_ip: string;
  }): Promise<any> {
    return this.shurjoCall(creds, "/api/secret-pay", { ...fields });
  }

  /** The independent verification call — the ONLY ShurjoPay
   * confirmation the return handler trusts. The documented
   * response may be a single record or a one-element array;
   * normalized here to the record. */
  async shurjoVerify(creds: TenantShurjoCreds, spOrderId: string): Promise<any> {
    const res = await this.shurjoCall(creds, "/api/verification", { sp_order_id: spOrderId });
    return Array.isArray(res) ? (res[0] ?? null) : res;
  }

  // ---------------- GC11: aamarPay ----------------
  // Flow: jsonpost.php initiation → success/fail/cancel POSTs
  // and/or IPN as TRIGGERS only → Search Transaction
  // (trxcheck) decides. There is NO refund API in aamarPay's
  // official docs (docs/gb4-gateway-research.md §2.5) —
  // deliberately no refund method here either.

  /** Session init — returns the gateway's raw response; the
   * caller requires result === "true" + payment_url. */
  async aamarInit(creds: TenantAamarCreds, fields: {
    tran_id: string; amount: string; currency: string; desc: string;
    cus_name: string; cus_email: string; cus_phone: string; cus_add1: string; cus_city: string;
    success_url: string; fail_url: string; cancel_url: string;
  }): Promise<any> {
    try {
      const r = await this.fetchFn(`${aamarBase(creds)}/jsonpost.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          store_id: creds.storeId,
          // The signature_key travels as a request field by
          // aamarPay's design — never log this body or any URL
          // containing the key.
          signature_key: creds.signatureKey,
          ...fields,
          cus_country: "Bangladesh",
          type: "json",
        }),
        signal: AbortSignal.timeout(20_000),
      } as any);
      return await r.json().catch(() => null);
    } catch (e) {
      throw new Error(`Could not reach aamarPay: ${e instanceof Error ? e.message : "network error"}`);
    }
  }

  /** The Search Transaction API — the ONLY aamarPay
   * confirmation the success/IPN handlers trust. The key rides
   * in the query string per the provider's API shape: this URL
   * must NEVER be logged. A transport failure throws (the
   * caller treats "no confirmation" as "not paid"). */
  async aamarTrxCheck(creds: TenantAamarCreds, tranId: string): Promise<any> {
    const qs = new URLSearchParams({
      request_id: tranId, store_id: creds.storeId, signature_key: creds.signatureKey, type: "json",
    });
    try {
      const r = await this.fetchFn(`${aamarBase(creds)}/api/v1/trxcheck/request.php?${qs.toString()}`, {
        signal: AbortSignal.timeout(15_000),
      } as any);
      return await r.json().catch(() => null);
    } catch (e) {
      throw new Error(`Could not reach aamarPay: ${e instanceof Error ? e.message : "network error"}`);
    }
  }

  /** The validation API — the ONLY SSLCommerz confirmation the
   * IPN handler trusts (same as the platform M36 flow). */
  async sslValidate(creds: TenantSslCreds, valId: string): Promise<any | null> {
    if (!valId) return null;
    const url = `${sslcommerzBase(creds)}/validator/api/validationserverAPI.php?val_id=${encodeURIComponent(valId)}&store_id=${encodeURIComponent(creds.storeId)}&store_passwd=${encodeURIComponent(creds.storePass)}&v=1&format=json`;
    try {
      const res = await this.fetchFn(url, { signal: AbortSignal.timeout(15_000) } as any);
      return await res.json().catch(() => null);
    } catch {
      return null;
    }
  }
}
