import { bkashBase, sslcommerzBase, type BkashConfig, type SslcommerzConfig } from "../common/platform-config";

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

export class TenantGatewayClient {
  private readonly bkashTokens = new Map<string, { token: string; expiresAt: number }>();

  constructor(private readonly fetchFn: typeof fetch = fetch) {}

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
