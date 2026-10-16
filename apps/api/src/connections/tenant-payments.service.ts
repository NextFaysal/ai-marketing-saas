import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import { depositFor } from "../fraud/deposit";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { decryptJson, encryptJson } from "../integrations/crypto";
import { verifyIpnSignature } from "../payments/payments.service";
import { EventsService } from "../common/events.service";
import { createAgentNotification } from "../common/agent-notify";
import { TenantGatewayClient, type TenantAamarCreds, type TenantBkashCreds, type TenantNagadCreds, type TenantShurjoCreds, type TenantSslCreds } from "./tenant-gateway.client";
import { WalletService } from "./wallet.service";
import { StepUpService, stepUpMarker } from "./step-up.service";

/**
 * CC9 — the tenant's OWN payment gateways.
 *
 * Money through these gateways settles DIRECTLY to the tenant's
 * merchant account — the platform never holds it (platform
 * payment + wallet is CC10, deliberately separate).
 *
 * Verification truth per provider (never fabricated):
 * - bKash tokenized: a REAL grant-token call is a true credential
 *   check → "verified" on success; on failure NOTHING is saved.
 * - SSLCommerz: NO pre-transaction credential check exists — its
 *   validation API needs a val_id from a real transaction — so
 *   the config saves as "configured" and says so.
 * - Nagad: this codebase wires no merchant-API credential check
 *   (and no Nagad checkout), so the config saves as "configured";
 *   initiating a Nagad payment refuses honestly.
 * - Rocket: Rocket merchant payment is a manual-number flow in
 *   Bangladesh — there is no API gateway to configure. It stays
 *   on the existing BusinessProfile manual path (Settings →
 *   payment note) and this API refuses it rather than pretending.
 * - ShurjoPay (GC11, v2.1): a REAL get_token call is a true
 *   credential check → "verified" on success; on failure NOTHING
 *   is saved. A payment is marked paid ONLY after the
 *   server-side /api/verification call returns sp_code "1000"
 *   with the exact amount + currency — the browser return is a
 *   trigger only.
 * - aamarPay (GC11): NO pre-transaction credential check exists
 *   (like SSLCommerz) → "configured". A payment is marked paid
 *   ONLY after the Search Transaction call confirms pay_status
 *   "Successful" with the exact amount + currency — the
 *   success-URL POST and the IPN are triggers only.
 * - NEITHER ShurjoPay nor aamarPay documents a refund API
 *   (docs/gb4-gateway-research.md) — there is deliberately NO
 *   refund path for them here; refunds for those providers are
 *   a manual provider-dashboard process.
 *
 * Credentials are sealed (encryptJson) at rest and NEVER returned:
 * a gateway view carries only the provider, its non-secret
 * identifier (store id / app key / merchant id), status and
 * verification state.
 */

export const TENANT_GATEWAY_PROVIDERS = ["sslcommerz", "bkash", "nagad", "shurjopay", "aamarpay"] as const;
export type TenantGatewayProvider = (typeof TENANT_GATEWAY_PROVIDERS)[number];

export type TenantGatewayCreds = TenantSslCreds | TenantBkashCreds | TenantNagadCreds | TenantShurjoCreds | TenantAamarCreds;

/**
 * CC19: redact credential-shaped KEYS by name (any depth) from
 * a stored gateway payload before it is shown in the IPN
 * viewer. Values under keys like store_passwd / password /
 * app_secret / verify_sign / token never leave the service;
 * everything else is the gateway's own payload, verbatim.
 */
const SENSITIVE_KEY_PATTERN = /(passwd|password|secret|sign|signature|token|auth|credential|private|api[-_]?key|app[-_]?key)/i;

export function redactSensitiveKeys(value: any, depth = 0): any {
  if (depth > 8) return "…";
  if (Array.isArray(value)) return value.map((v) => redactSensitiveKeys(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY_PATTERN.test(k) ? "***" : redactSensitiveKeys(v, depth + 1);
    }
    return out;
  }
  return value;
}

const VERIFICATION_NOTES: Record<string, string> = {
  bkash: "verified_with_gateway",
  sslcommerz: "no_pre_transaction_check",
  nagad: "no_pre_transaction_check",
  shurjopay: "verified_with_gateway",
  aamarpay: "no_pre_transaction_check",
};

@Injectable()
export class TenantPaymentsService {
  private readonly logger = new Logger(TenantPaymentsService.name);
  private readonly gateway: TenantGatewayClient;
  private readonly wallet: WalletService;
  private readonly stepUp: StepUpService;
  private readonly events?: EventsService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() gatewayClient?: TenantGatewayClient,
    @Optional() walletService?: WalletService,
    @Optional() stepUpService?: StepUpService,
    // GC23: bus for the "order.paid" webhook event + nothing else
    // (appended LAST + @Optional, the established discipline).
    @Optional() eventsService?: EventsService,
  ) {
    this.gateway = gatewayClient ?? new TenantGatewayClient();
    this.wallet = walletService ?? new WalletService(prisma, audit);
    // INT7 union: slot 5 is claimed by BOTH lines' positional spec
    // constructions — CC23 (main) passes a StepUpService there,
    // GC23/AB4 (gc) passes the EventsService bus there (on the gc
    // line events was slot 5). Nest injects by TYPE in production
    // (StepUpService at 5, the bus at 6), so an events-shaped
    // slot-5 value can only come from a positional construction:
    // route it to the bus instead of mistaking it for step-up.
    const slot5: any = stepUpService as any;
    const slot5IsEvents = !!slot5
      && !(slot5 instanceof StepUpService)
      && typeof slot5.emit === "function"
      && typeof slot5.check !== "function";
    this.events = eventsService ?? (slot5IsEvents ? slot5 : undefined);
    this.stepUp = slot5IsEvents ? new StepUpService(prisma as any) : (stepUpService ?? new StepUpService(prisma as any));
  }

  /**
   * CC23: append one REJECTED-notification event to the
   * transaction's ipnEvents record. This is the ONLY trace a
   * rejected IPN leaves — it changes no status, no order, no
   * wallet; it exists so the CC23 anomaly counter (and a human
   * reviewing the transaction) can see that forgery/mismatch
   * attempts happened. Recording is failure-isolated: an IPN
   * endpoint must answer the gateway even if the audit write
   * fails. The list is capped at the last 50 events.
   */
  async recordIpnEvent(txn: any, kind: "signature_invalid" | "amount_mismatch", detail?: string): Promise<void> {
    try {
      const prior: any[] = Array.isArray(txn?.ipnEvents) ? txn.ipnEvents : [];
      const events = [...prior, { kind, at: new Date().toISOString(), ...(detail ? { detail: String(detail).slice(0, 200) } : {}) }].slice(-50);
      await (this.prisma as any).tenantPaymentTransaction.update({
        where: { id: txn.id }, data: { ipnEvents: events },
      });
      txn.ipnEvents = events;
    } catch { /* recording never breaks the gateway response */ }
  }

  /**
   * CC10: credentials for a transaction, by its source. "own"
   * uses the tenant's sealed gateway config (CC9); "platform"
   * uses the PLATFORM's admin-configured gateway — the tenant
   * stores no secret for platform payments.
   */
  private async resolveCredsForTxn(txn: any): Promise<TenantGatewayCreds | null> {
    if (txn?.source === "platform") {
      const creds = this.wallet.platformCreds(String(txn.provider));
      if (!creds) return null;
      return (creds.ssl ?? creds.bkash) as TenantGatewayCreds;
    }
    // CC19: verification must use the credential set the
    // transaction was CREATED under — a sandbox txn verifies
    // against the sandbox creds (and then markVerifiedPaid's
    // sandbox guard keeps it away from orders and wallets).
    const resolved = await this.resolveGateway(
      txn.organizationId, String(txn.provider), txn.environment === "sandbox" ? "sandbox" : "live",
    );
    return resolved?.creds ?? null;
  }

  /**
   * CC24: the credential resolution for one transaction, exposed
   * for the refund path — a refund must travel on the SAME
   * credentials that carried the payment (tenant's own gateway
   * for source "own" in the transaction's environment;
   * platform credentials for source "platform"). Internal use
   * only between connections services; credentials are never
   * returned by any controller.
   */
  async resolveCredsForTransaction(txn: any): Promise<TenantGatewayCreds | null> {
    return this.resolveCredsForTxn(txn);
  }

  private apiBase(): string {
    return (process.env.API_PUBLIC_URL ?? "http://localhost:4000").replace(/\/$/, "");
  }
  private webBase(): string {
    return (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
  }

  /**
   * GC12 — failure bookkeeping. Writes failureReason (truncated
   * to 300 chars) onto a transaction row. ALWAYS failure-isolated
   * by the caller's `.catch(() => undefined)` discipline AND by
   * the internal try/catch here: a bookkeeping failure must
   * never break a payment.
   */
  private async recordFailure(txnId: string, reason: unknown): Promise<void> {
    try {
      const text = String(reason instanceof Error ? reason.message : reason ?? "").trim().slice(0, 300);
      if (!txnId || !text) return;
      await (this.prisma as any).tenantPaymentTransaction.update({
        where: { id: txnId }, data: { failureReason: text },
      }).catch(() => undefined);
    } catch { /* bookkeeping only */ }
  }

  /**
   * GC23 — "order.paid" bus event, emitted at the verified_paid
   * transition points inside markVerifiedPaid (there was no bus
   * event for a verified payment before this). Consumed by the
   * outgoing-webhooks module. Failure-isolated by construction:
   * the EventsService itself never throws, and the try/catch here
   * is belt-and-braces — a webhook concern must never break a
   * payment confirmation.
   */
  private emitOrderPaid(txn: any, extra?: { purpose?: string; fullySettled?: boolean; orderTotalMinor?: string }): void {
    try {
      this.events?.emit("order.paid", {
        organizationId: txn.organizationId,
        context: {
          orderId: txn.orderId, transactionId: txn.id,
          provider: txn.provider, amountMinor: String(txn.amountMinor ?? 0),
          // AB4 (AX5a): what slice of the order this verified
          // payment was (deposit / balance / full) and whether
          // the order is now fully settled by verified payments.
          purpose: extra?.purpose ?? txn.purpose ?? "full",
          fullySettled: extra?.fullySettled ?? false,
          orderTotalMinor: extra?.orderTotalMinor ?? "0",
        },
      });
    } catch { /* isolated */ }
  }

  /**
   * GC23 — payment-failure alert to the org's ACTIVE OWNER/ADMIN
   * memberships, EXACTLY ONCE per transaction: the
   * failureNotifiedAt stamp is claimed with a conditional
   * updateMany (where failureNotifiedAt is null) and only the
   * caller that wins the claim notifies. Called from every point
   * where a transaction concludes as "failed" (initiation errors,
   * signed gateway FAILED reports, bKash / ShurjoPay / aamarPay
   * terminal failures — own AND platform paths share those
   * handlers). "cancelled" conclusions deliberately do NOT alert
   * (a buyer abandoning checkout is not a failure). Fully
   * failure-isolated: any error here is swallowed — notification
   * must never affect the payment path.
   */
  private async notifyPaymentFailure(txn: any): Promise<void> {
    try {
      if (!txn?.id || !txn?.organizationId) return;
      const claimed = await (this.prisma as any).tenantPaymentTransaction.updateMany({
        where: { id: txn.id, failureNotifiedAt: null },
        data: { failureNotifiedAt: new Date() },
      }).catch(() => null);
      if (!claimed || claimed.count !== 1) return;
      const memberships = await (this.prisma as any).membership.findMany({
        where: { organizationId: txn.organizationId, role: { in: ["OWNER", "ADMIN"] }, status: "ACTIVE" },
      }).catch(() => []);
      let orderRef = String(txn.orderId ?? "");
      try {
        const order = await this.findOrder(txn.organizationId, txn.orderId);
        if (order?.externalNumber) orderRef = String(order.externalNumber);
      } catch { /* orderId is an acceptable reference */ }
      const amount = (Number(txn.amountMinor ?? 0) / 100).toFixed(2);
      const body = `${txn.provider} পেমেন্ট ব্যর্থ হয়েছে — পরিমাণ ${amount} ${txn.currency ?? "BDT"}, অর্ডার: ${orderRef}। বিস্তারিত Connections পেজে দেখুন।`;
      for (const m of memberships as any[]) {
        if (!m?.userId) continue;
        await createAgentNotification(this.prisma as any, {
          organizationId: txn.organizationId, userId: m.userId,
          type: "billing", title: "💳 পেমেন্ট ব্যর্থ হয়েছে", body,
        }).catch(() => null);
      }
    } catch { /* notification never affects the payment path */ }
  }

  /** GC12 — own-path fee from the gateway row's contract
   * numbers. Returns null when NEITHER feeBps nor feeFixedMinor
   * is set (no rate known — fee/net stay null, never invented). */
  private computeOwnFee(gatewayRow: any, amountMinor: bigint): { feeMinor: bigint; netMinor: bigint } | null {
    if (!gatewayRow) return null;
    if (gatewayRow.feeBps == null && gatewayRow.feeFixedMinor == null) return null;
    const feeMinor = (amountMinor * BigInt(gatewayRow.feeBps ?? 0)) / 10000n + BigInt(gatewayRow.feeFixedMinor ?? 0);
    return { feeMinor, netMinor: amountMinor - feeMinor };
  }


  /**
   * CC19: gateway rows are per ENVIRONMENT. Production paths
   * resolve "live" EXPLICITLY (the default here, always); the
   * sandbox row is reachable only by passing "sandbox" — the
   * Doctor's check and the labelled test initiation are the only
   * callers that do.
   */
  private async findGatewayRow(organizationId: string, provider: string, environment = "live"): Promise<any | null> {
    try {
      const exact = await (this.prisma as any).tenantPaymentGateway.findFirst({ where: { organizationId, provider, environment } });
      if (exact) return exact;
      // INT7 union fallback (LIVE lookups only): a row whose
      // environment was never recorded (GC12-era saves predate the
      // CC19 per-environment rows; the DB column defaults to
      // "live", so this only ever fires for such rows) still
      // resolves as the live row. A SANDBOX row (environment
      // "sandbox") is never matched here — CC19's isolation holds.
      if (environment !== "live") return null;
      const rows = await (this.prisma as any).tenantPaymentGateway.findMany({ where: { organizationId, provider } }).catch(() => null);
      const legacy = (rows ?? []).find((r: any) => r && (r.environment === null || r.environment === undefined || r.environment === "live"));
      return legacy ?? null;
    } catch { return null; }
  }

  /** Decrypted credentials for immediate in-memory use — the
   * tenant-app-config reader discipline. Never logged/returned. */
  async resolveGateway(organizationId: string, provider: string, environment = "live"): Promise<{ row: any; creds: TenantGatewayCreds } | null> {
    const row = await this.findGatewayRow(organizationId, provider, environment);
    if (!row?.encryptedData) return null;
    try {
      const creds = decryptJson<any>(row.encryptedData);
      if (!creds || typeof creds !== "object") return null;
      return { row, creds: creds as TenantGatewayCreds };
    } catch { return null; }
  }

  /** The only outward shape of a gateway row. */
  private gatewayView(row: any) {
    let identifier: string | null = null;
    try {
      const creds = decryptJson<any>(row.encryptedData);
      // GC11: ShurjoPay's non-secret identifier is its merchant
      // username (its optional storeId must not shadow it);
      // aamarPay's is its storeId (the first chain entry).
      identifier = String(row.provider) === "shurjopay"
        ? (creds?.username ?? null)
        : (creds?.storeId ?? creds?.appKey ?? creds?.merchantId ?? null);
    } catch { identifier = null; }
    return {
      provider: row.provider,
      environment: row.environment === "sandbox" ? "sandbox" : "live",
      identifier,
      sandbox: (() => { try { return decryptJson<any>(row.encryptedData)?.sandbox === true; } catch { return false; } })(),
      status: row.status,
      isEnabled: row.isEnabled !== false,
      // GC12: merchant gateway-contract fee numbers (plain
      // columns; null = no fee rate configured).
      feeBps: row.feeBps ?? null,
      feeFixedMinor: row.feeFixedMinor != null ? String(row.feeFixedMinor) : null,
      lastVerifiedAt: row.lastVerifiedAt ?? null,
      lastError: row.lastError ?? null,
      verificationNote: VERIFICATION_NOTES[String(row.provider)] ?? "no_pre_transaction_check",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async listGateways(organizationId: string) {
    let rows: any[] = [];
    try {
      rows = await (this.prisma as any).tenantPaymentGateway.findMany({
        where: { organizationId }, orderBy: { createdAt: "asc" },
      });
    } catch { rows = []; }
    return { gateways: rows.map((r: any) => this.gatewayView(r)) };
  }

  /**
   * Verify-before-save, per provider (see class doc):
   * bKash verifies for real; SSLCommerz/Nagad save honestly as
   * "configured". A failed bKash check saves NOTHING.
   */
  async putGateway(organizationId: string, actorId: string, providerRaw: string, dto: any) {
    const provider = String(providerRaw ?? "").trim().toLowerCase();
    if (provider === "rocket") {
      throw new BadRequestException("Rocket-এর কোনো API গেটওয়ে নেই — এটি ম্যানুয়াল নম্বরের পেমেন্ট। Settings → পেমেন্ট নোটে Rocket নম্বর/নির্দেশনা দিন; এটিকে API গেটওয়ে হিসেবে দেখানো হবে না।");
    }
    if (!(TENANT_GATEWAY_PROVIDERS as readonly string[]).includes(provider)) {
      throw new BadRequestException("provider must be sslcommerz | bkash | nagad | shurjopay | aamarpay");
    }
    // GC12: fee columns — KEY-PRESENCE semantics. A key present
    // in the body (even as explicit null) sets/clears the
    // column; a key absent leaves the stored column untouched,
    // so a creds-only re-save can never wipe fees. Validated
    // here, before any gateway verification call, so an invalid
    // fee saves nothing.
    // DISCRIMINATOR (verified in gc12-payment-ops.spec.ts): the
    // global ValidationPipe (whitelist+transform) materialises
    // EVERY declared DTO field as an own property — absent keys
    // arrive as `undefined`, explicit JSON null arrives as
    // `null`. So `!== undefined` is the only reliable presence
    // test on the DTO instance (hasOwnProperty is always true);
    // this is the same discipline UpdateOrderDto documents for
    // internalNote. Plain-object callers behave identically:
    // an absent key reads back undefined.
    const hasFeeBps = dto != null && dto.feeBps !== undefined;
    const hasFeeFixed = dto != null && dto.feeFixedMinor !== undefined;
    let feeBpsValue: number | null = null;
    let feeFixedValue: bigint | null = null;
    if (hasFeeBps && dto.feeBps != null) {
      const n = Number(dto.feeBps);
      if (!Number.isInteger(n) || n < 0 || n > 10000) {
        throw new BadRequestException("feeBps 0–10000-এর মধ্যে পূর্ণসংখ্যা হতে হবে।");
      }
      feeBpsValue = n;
    }
    if (hasFeeFixed && dto.feeFixedMinor != null) {
      const raw = String(dto.feeFixedMinor).trim();
      if (!/^\d+$/.test(raw)) {
        throw new BadRequestException("feeFixedMinor অ-ঋণাত্মক পূর্ণসংখ্যা (পয়সায়, decimal string) হতে হবে।");
      }
      feeFixedValue = BigInt(raw);
    }
    // CC19: the row's environment comes ONLY from an explicit
    // dto.environment. Without one the save targets the LIVE
    // row — the tenant's primary credential set — and the
    // CC9-era dto.sandbox flag keeps its original meaning
    // inside the creds (those credentials point at the
    // provider's sandbox hosts), exactly as CC9 behaved.
    // A row is a SANDBOX set only when the caller explicitly
    // asks for it (the CC19 UI does); saving one forces its
    // creds' sandbox flag on, since a sandbox set must talk
    // to the sandbox hosts.
    const environment = dto?.environment === "sandbox" ? "sandbox" : "live";
    const sandbox = environment === "sandbox" ? true : dto?.sandbox === true;
    let creds: TenantGatewayCreds;
    let status = "configured";
    let lastVerifiedAt: Date | null = null;

    if (provider === "sslcommerz") {
      const storeId = String(dto?.storeId ?? "").trim();
      const storePass = String(dto?.storePass ?? "").trim();
      if (!storeId || !storePass) throw new BadRequestException("SSLCommerz Store ID ও Store Password দুটোই প্রয়োজন।");
      creds = { storeId, storePass, sandbox } satisfies TenantSslCreds;
      // No pre-transaction credential check exists for
      // SSLCommerz — saved honestly as "configured".
    } else if (provider === "bkash") {
      const username = String(dto?.username ?? "").trim();
      const password = String(dto?.password ?? "").trim();
      const appKey = String(dto?.appKey ?? "").trim();
      const appSecret = String(dto?.appSecret ?? "").trim();
      if (!username || !password || !appKey || !appSecret) {
        throw new BadRequestException("bKash-এর Username, Password, App Key ও App Secret — চারটিই প্রয়োজন।");
      }
      creds = { username, password, appKey, appSecret, sandbox } satisfies TenantBkashCreds;
      // REAL credential check: the grant-token call.
      await this.gateway.bkashGrantToken(creds as TenantBkashCreds).catch((e) => {
        throw new BadRequestException(e instanceof Error ? e.message : "bKash verification failed");
      });
      status = "verified";
      lastVerifiedAt = new Date();
    } else if (provider === "shurjopay") {
      const username = String(dto?.username ?? "").trim();
      const password = String(dto?.password ?? "").trim();
      const prefix = String(dto?.prefix ?? "").trim();
      const storeId = String(dto?.storeId ?? "").trim();
      if (!username || !password || !prefix) {
        throw new BadRequestException("ShurjoPay Username, Password ও Prefix — তিনটিই প্রয়োজন (Store ID ঐচ্ছিক)।");
      }
      creds = { username, password, prefix, ...(storeId ? { storeId } : {}), sandbox } satisfies TenantShurjoCreds;
      // REAL credential check: the get_token call. A failure
      // saves NOTHING and surfaces the gateway's own message.
      await this.gateway.shurjoGetToken(creds as TenantShurjoCreds).catch((e) => {
        throw new BadRequestException(e instanceof Error ? e.message : "ShurjoPay verification failed");
      });
      status = "verified";
      lastVerifiedAt = new Date();
    } else if (provider === "aamarpay") {
      const storeId = String(dto?.storeId ?? "").trim();
      const signatureKey = String(dto?.signatureKey ?? "").trim();
      if (!storeId || !signatureKey) throw new BadRequestException("aamarPay Store ID ও Signature Key দুটোই প্রয়োজন।");
      creds = { storeId, signatureKey, sandbox } satisfies TenantAamarCreds;
      // No pre-transaction credential check exists for
      // aamarPay (its Search Transaction call needs a real
      // tran_id) — saved honestly as "configured", exactly
      // like SSLCommerz.
    } else {
      const merchantId = String(dto?.merchantId ?? "").trim();
      const privateKey = String(dto?.privateKey ?? "").trim();
      if (!merchantId || !privateKey) throw new BadRequestException("Nagad Merchant ID ও Private Key দুটোই প্রয়োজন।");
      creds = { merchantId, privateKey } satisfies TenantNagadCreds;
      // No merchant-API credential check is wired for Nagad in
      // this codebase — saved honestly as "configured".
    }

    const data: Record<string, any> = { encryptedData: encryptJson(creds), status, isEnabled: true, lastVerifiedAt, lastError: null };
    if (hasFeeBps) data.feeBps = feeBpsValue;
    if (hasFeeFixed) data.feeFixedMinor = feeFixedValue;
    const existing = await this.findGatewayRow(organizationId, provider, environment);
    const row = existing
      ? await (this.prisma as any).tenantPaymentGateway.update({ where: { id: existing.id }, data })
      : await (this.prisma as any).tenantPaymentGateway.create({ data: { organizationId, provider, environment, ...data } });
    await this.audit.log({
      organizationId, userId: actorId, action: "tenant_payment_gateway.saved",
      entityType: "TenantPaymentGateway", entityId: row.id,
      metadata: { provider, status, environment },
    });
    return this.gatewayView(row);
  }

  async setGatewayEnabled(organizationId: string, actorId: string, providerRaw: string, isEnabled: boolean, environment = "live", totpCode?: string | null) {
    const provider = String(providerRaw ?? "").trim().toLowerCase();
    // CC23: DISABLING a gateway is the sensitive direction (it
    // silently stops a store taking money) — step-up first,
    // before any mutation. Re-enabling needs no step-up.
    const stepUp = isEnabled ? "not_required" as const : await this.stepUp.check(actorId, totpCode);
    const existing = await this.findGatewayRow(organizationId, provider, environment);
    if (!existing) throw new NotFoundException("Payment gateway not found");
    const row = await (this.prisma as any).tenantPaymentGateway.update({
      where: { id: existing.id }, data: { isEnabled: Boolean(isEnabled) },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "tenant_payment_gateway.enabled_changed",
      entityType: "TenantPaymentGateway", entityId: existing.id,
      metadata: { provider, isEnabled: Boolean(isEnabled), environment, ...(stepUp !== "not_required" ? { stepUp } : {}) },
    });
    return { ...this.gatewayView(row), ...(stepUp !== "not_required" ? stepUpMarker(stepUp) : {}) };
  }

  async deleteGateway(organizationId: string, actorId: string, providerRaw: string, environment = "live", totpCode?: string | null) {
    const provider = String(providerRaw ?? "").trim().toLowerCase();
    // CC23: TOTP step-up BEFORE the delete — a refused check
    // deletes nothing.
    const stepUp = await this.stepUp.check(actorId, totpCode);
    const existing = await this.findGatewayRow(organizationId, provider, environment);
    if (!existing) throw new NotFoundException("Payment gateway not found");
    await (this.prisma as any).tenantPaymentGateway.delete({ where: { id: existing.id } });
    await this.audit.log({
      organizationId, userId: actorId, action: "tenant_payment_gateway.deleted",
      entityType: "TenantPaymentGateway", entityId: existing.id,
      metadata: { provider, stepUp },
    });
    return { provider, deleted: true, ...stepUpMarker(stepUp) };
  }

  // ---------- CC9 checkout: initiate + verified confirmation ----------

  private async findOrder(organizationId: string, orderId: string): Promise<any | null> {
    try {
      return await (this.prisma as any).order.findFirst({ where: { id: orderId, organizationId } });
    } catch { return null; }
  }

  private async hasVerifiedPayment(organizationId: string, orderId: string): Promise<boolean> {
    try {
      const rows = await (this.prisma as any).tenantPaymentTransaction.findMany({
        where: { organizationId, orderId, status: "verified_paid" }, take: 1,
      });
      return Array.isArray(rows) && rows.length > 0;
    } catch { return false; }
  }

  /**
   * AB4 (AX5a): Σ amountMinor of an order's verified_paid
   * transactions — the gateway-side mirror of the order due
   * math (total − Σ APPROVED PaymentVerifications). A read
   * failure reads as 0n (callers then take the legacy path /
   * refuse nothing they did not refuse before AB4).
   */
  private async verifiedPaidSum(organizationId: string, orderId: string): Promise<bigint> {
    try {
      const rows = await (this.prisma as any).tenantPaymentTransaction.findMany({
        where: { organizationId, orderId, status: "verified_paid" },
      });
      let sum = 0n;
      for (const r of (rows ?? []) as any[]) {
        try { sum += BigInt(r.amountMinor ?? 0); } catch { /* a malformed row counts 0 */ }
      }
      return sum;
    } catch { return 0n; }
  }

  /**
   * AB4 (AX5a): initiation amount + purpose resolution, shared
   * by the own and platform initiation paths. Verified money
   * already on the order shrinks what may still be collected:
   * a fully-settled order refuses with the legacy "already
   * completed" message; otherwise the default amount is the
   * REMAINING balance. An explicit amount must be > 0 and
   * ≤ remaining. Purpose: explicit full|deposit|balance wins
   * (anything else → 400); absent → "full" only for a
   * first, whole-total payment, else "balance".
   */
  private async resolveInitiationAmount(
    organizationId: string,
    order: any,
    opts?: { amountMinor?: bigint | string; purpose?: string },
  ): Promise<{ amountMinor: bigint; purpose: string }> {
    let total = 0n;
    try { total = BigInt(order.totalMinor ?? 0); } catch { total = 0n; }
    const verifiedSum = await this.verifiedPaidSum(organizationId, String(order.id));
    if (total > 0n && verifiedSum >= total) {
      throw new BadRequestException("এই অর্ডারের পেমেন্ট ইতিমধ্যে যাচাইকৃতভাবে সম্পন্ন হয়েছে — আবার পেমেন্ট শুরু করা যাবে না।");
    }
    if (total <= 0n) {
      throw new BadRequestException("অর্ডারের মোট পরিমাণ শূন্য বা তার কম — অনলাইন পেমেন্ট শুরু করা যাবে না।");
    }
    const remaining = total - verifiedSum;
    let amountMinor: bigint;
    if (opts?.amountMinor != null) {
      try {
        amountMinor = BigInt(opts.amountMinor as any);
      } catch {
        throw new BadRequestException("পেমেন্টের পরিমাণটি সঠিক পূর্ণসংখ্যায় (পয়সায়) দিতে হবে।");
      }
      if (amountMinor <= 0n) {
        throw new BadRequestException("পেমেন্টের পরিমাণ শূন্যের বেশি হতে হবে।");
      }
      if (amountMinor > remaining) {
        throw new BadRequestException("পেমেন্টের পরিমাণ এই অর্ডারের বাকি পরিমাণের চেয়ে বেশি হতে পারবে না।");
      }
    } else {
      amountMinor = remaining;
    }
    let purpose: string;
    if (opts?.purpose != null) {
      purpose = String(opts.purpose).trim().toLowerCase();
      if (!["full", "deposit", "balance"].includes(purpose)) {
        throw new BadRequestException("পেমেন্টের purpose সঠিক নয় — full, deposit বা balance হতে হবে।");
      }
    } else {
      purpose = verifiedSum === 0n && amountMinor === total ? "full" : "balance";
    }
    return { amountMinor, purpose };
  }

  /**
   * AB4 (AX5a): deposit bookkeeping for a VERIFIED deposit
   * transaction — exactly ONE approved PaymentVerification
   * (source "gateway_deposit") per transaction, so the order
   * due math (total − Σ APPROVED verifications, used by
   * orders.service / ON1 / surgery) counts the gateway deposit
   * exactly like a staff-approved manual advance.
   *
   * Idempotency is a CLAIM on the transaction row itself:
   * depositVerificationId is set (to the verification's own id)
   * with a conditional updateMany (only while still null);
   * only the caller that wins the claim creates the row. A
   * create failure reverts the claim so a later re-delivery can
   * retry. FULLY failure-isolated: bookkeeping never throws
   * out of markVerifiedPaid and never un-verifies a payment.
   */
  private async ensureDepositVerification(txn: any): Promise<void> {
    try {
      if (!txn?.id || txn.purpose !== "deposit") return;
      if (txn.depositVerificationId) return; // already booked (this snapshot knows)
      const pvId = randomUUID();
      const claimed = await (this.prisma as any).tenantPaymentTransaction.updateMany({
        where: { id: txn.id, depositVerificationId: null },
        data: { depositVerificationId: pvId },
      }).catch(() => null);
      if (!claimed || claimed.count !== 1) return; // another delivery booked it
      try {
        await (this.prisma as any).paymentVerification.create({
          data: {
            id: pvId,
            organizationId: txn.organizationId,
            orderId: txn.orderId,
            conversationId: null,
            messageId: null,
            provider: txn.provider,
            trxId: txn.providerTxnId ?? null,
            amountMinor: txn.amountMinor,
            expectedAmountMinor: txn.amountMinor,
            verdict: "matched",
            status: "approved",
            source: "gateway_deposit",
            reviewedById: null,
            createdById: null,
            modelProvider: "gateway_verified",
            note: `ডিপোজিট (অনলাইন যাচাইকৃত) — ${txn.provider}`,
          },
        });
        txn.depositVerificationId = pvId;
      } catch (e) {
        // Revert the claim so a re-delivery can complete the
        // bookkeeping; the payment itself stays verified_paid.
        await (this.prisma as any).tenantPaymentTransaction.updateMany({
          where: { id: txn.id, depositVerificationId: pvId },
          data: { depositVerificationId: null },
        }).catch(() => undefined);
        this.logger.warn(
          `deposit verification bookkeeping failed for txn ${txn.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    } catch { /* bookkeeping only — never breaks a verified payment */ }
  }

  /**
   * Start a payment for one order through the tenant's OWN
   * gateway. Records a TenantPaymentTransaction "initiated" and
   * returns the gateway's real redirect URL. The order is NOT
   * marked paid here — only the verified IPN/callback path does
   * that (see handleSslIpn / handleBkashCallback).
   */
  async initiateOrderPayment(organizationId: string, orderId: string, providerRaw: string, opts?: { customerName?: string; customerPhone?: string; customerEmail?: string; amountMinor?: bigint | string; purpose?: string }) {
    const provider = String(providerRaw ?? "").trim().toLowerCase();
    if (provider === "nagad") {
      throw new BadRequestException("Nagad API চেকআউট এই সিস্টেমে সংযুক্ত নয় — Nagad কনফিগটি শুধু সংরক্ষিত আছে। আপাতত ম্যানুয়াল Nagad নম্বরের পথটি ব্যবহার করুন।");
    }
    if (provider !== "sslcommerz" && provider !== "bkash" && provider !== "shurjopay" && provider !== "aamarpay") {
      throw new BadRequestException("provider must be sslcommerz | bkash | shurjopay | aamarpay");
    }
    const resolved = await this.resolveGateway(organizationId, provider);
    if (!resolved) throw new BadRequestException("এই গেটওয়েটি কনফিগার করা নেই — আগে Connect Center-এ নিজের গেটওয়ে যোগ করুন।");
    if (resolved.row.isEnabled === false) throw new BadRequestException("এই গেটওয়েটি বন্ধ (disabled) করা আছে।");
    const order = await this.findOrder(organizationId, orderId);
    if (!order) throw new NotFoundException("Order not found");
    if (order.isPractice) throw new BadRequestException("Practice অর্ডারে আসল পেমেন্ট নেওয়া যায় না।");
    // AB4 (AX5a): partial verified money no longer blocks a
    // further initiation — only a FULLY settled order refuses
    // (inside resolveInitiationAmount); the amount defaults
    // to the remaining balance and purpose is stored on the txn.
    const { amountMinor, purpose } = await this.resolveInitiationAmount(organizationId, order, opts);
    const currency = String(order.currency ?? "BDT").toUpperCase();

    const txn = await (this.prisma as any).tenantPaymentTransaction.create({
      data: {
        organizationId, gatewayId: resolved.row.id, orderId: order.id, provider,
        environment: "live",
        amountMinor, currency, status: "initiated", purpose,
      },
    });

    try {
      if (provider === "sslcommerz") {
        return { ...(await this.startSslPayment(resolved.creds as TenantSslCreds, txn, order, opts)), environment: "live" };
      }
      if (provider === "shurjopay") {
        return await this.startShurjoPayment(resolved.creds as TenantShurjoCreds, txn, order, opts);
      }
      if (provider === "aamarpay") {
        return await this.startAamarPayment(resolved.creds as TenantAamarCreds, txn, order, opts);
      }
      return { ...(await this.startBkashPayment(resolved.creds as TenantBkashCreds, txn, order, opts)), environment: "live" };
    } catch (e) {
      await (this.prisma as any).tenantPaymentTransaction.update({
        where: { id: txn.id }, data: { status: "failed" },
      }).catch(() => undefined);
      await this.recordFailure(txn.id, e instanceof Error ? e.message : String(e)).catch(() => undefined);
      await this.notifyPaymentFailure(txn);
      throw e;
    }
  }

  /** The orderId a sandbox test transaction carries — never a
   * real order id, so no order lookup can ever match it. */
  static readonly SANDBOX_TEST_ORDER_ID = "sandbox-test";

  /**
   * CC19 — the labelled TEST initiation against the SANDBOX
   * credential set. Safety discipline, in layers:
   * 1. It resolves ONLY the environment="sandbox" gateway row
   *    (production resolution is live-only everywhere else).
   * 2. The transaction is created with environment="sandbox"
   *    and the sentinel orderId above — it is not attached to
   *    any real order.
   * 3. markVerifiedPaid refuses order transitions and wallet
   *    credits for sandbox transactions even if a fully verified
   *    sandbox IPN/callback arrives (see there).
   * The amount defaults to ৳100.00 and is capped so a test can
   * never move a large sum through the sandbox by accident.
   */
  async initiateTestPayment(organizationId: string, actorId: string, providerRaw: string, amountMinorRaw?: unknown) {
    const provider = String(providerRaw ?? "").trim().toLowerCase();
    if (provider === "nagad") {
      throw new BadRequestException("Nagad-এর কোনো API চেকআউটই সংযুক্ত নয় — sandbox টেস্টও সম্ভব নয়।");
    }
    if (provider !== "sslcommerz" && provider !== "bkash") {
      throw new BadRequestException("provider must be sslcommerz | bkash");
    }
    const resolved = await this.resolveGateway(organizationId, provider, "sandbox");
    if (!resolved) {
      throw new BadRequestException("এই প্রোভাইডারের sandbox credential সেট করা নেই — আগে Connect Center-এ sandbox গেটওয়ে যোগ করুন।");
    }
    let amountMinor = 10000n; // ৳100.00
    if (amountMinorRaw !== undefined && amountMinorRaw !== null && String(amountMinorRaw).trim() !== "") {
      const raw = String(amountMinorRaw).trim();
      if (!/^\d+$/.test(raw)) throw new BadRequestException("amountMinor অবশ্যই minor unit-এ পূর্ণসংখ্যা হতে হবে।");
      amountMinor = BigInt(raw);
    }
    if (amountMinor <= 0n || amountMinor > 100000n) {
      throw new BadRequestException("Sandbox টেস্টের পরিমাণ ৳০.০১–৳১,০০০-এর মধ্যে হতে হবে।");
    }
    const txn = await (this.prisma as any).tenantPaymentTransaction.create({
      data: {
        organizationId, gatewayId: resolved.row.id, orderId: TenantPaymentsService.SANDBOX_TEST_ORDER_ID,
        provider, environment: "sandbox", amountMinor, currency: "BDT", status: "initiated",
      },
    });
    const fakeOrder = { id: TenantPaymentsService.SANDBOX_TEST_ORDER_ID, externalNumber: "SANDBOX-TEST" };
    try {
      const started = provider === "sslcommerz"
        ? await this.startSslPayment(resolved.creds as TenantSslCreds, txn, fakeOrder, { customerName: "Sandbox Test" })
        : await this.startBkashPayment(resolved.creds as TenantBkashCreds, txn, fakeOrder, {});
      await this.audit.log({
        organizationId, userId: actorId, action: "tenant_payment.test_initiated",
        entityType: "TenantPaymentTransaction", entityId: txn.id,
        metadata: { provider, environment: "sandbox", amountMinor: amountMinor.toString() },
      });
      return { ...started, test: true, environment: "sandbox" };
    } catch (e) {
      await (this.prisma as any).tenantPaymentTransaction.update({
        where: { id: txn.id }, data: { status: "failed" },
      }).catch(() => undefined);
      throw e;
    }
  }

  private paymentTransactionView(row: any) {
    return {
      id: row.id, orderId: row.orderId, provider: row.provider,
      source: row.source === "platform" ? "platform" : "own",
      environment: row.environment === "sandbox" ? "sandbox" : "live",
      amountMinor: String(row.amountMinor), currency: row.currency ?? "BDT",
      status: row.status, providerTxnId: row.providerTxnId ?? null, valId: row.valId ?? null,
      hasIpnPayload: row.ipnPayload != null,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  /**
   * CC19: gateway transaction history for the Center — the
   * org's TenantPaymentTransaction rows (own + platform,
   * live + sandbox), newest first, filterable by status /
   * source / environment. Amounts are the rows' own recorded
   * values; nothing is recomputed or invented here.
   */
  async listTransactions(organizationId: string, query: { status?: string; source?: string; environment?: string; limit?: number } = {}) {
    const where: Record<string, unknown> = { organizationId };
    if (query.status) where.status = String(query.status);
    if (query.source) where.source = String(query.source);
    if (query.environment) where.environment = String(query.environment);
    const take = Math.min(200, Math.max(1, Math.round(Number(query.limit) || 50)));
    let rows: any[] = [];
    try {
      rows = await (this.prisma as any).tenantPaymentTransaction.findMany({
        where, orderBy: { createdAt: "desc" }, take,
      });
    } catch { rows = []; }
    return { transactions: (rows ?? []).map((r: any) => this.paymentTransactionView(r)) };
  }

  /**
   * CC19: the IPN evidence viewer — the STORED verified payload
   * for one transaction, with credential-shaped keys redacted by
   * NAME (store_passwd / password / app_secret / secret / sign /
   * key …) at any depth. The payload is the gateway's own POST
   * body as the verified-confirmation path stored it; the raw
   * row never leaves this service unredacted.
   */
  async getTransactionIpn(organizationId: string, transactionId: string) {
    let row: any = null;
    try {
      row = await (this.prisma as any).tenantPaymentTransaction.findFirst({
        where: { id: transactionId, organizationId },
      });
    } catch { row = null; }
    if (!row) throw new NotFoundException("Transaction not found");
    return {
      transaction: this.paymentTransactionView(row),
      ipnPayload: row.ipnPayload != null ? redactSensitiveKeys(row.ipnPayload) : null,
    };
  }

  /**
   * CC10 — start a payment through the PLATFORM's gateway. The
   * money lands in the platform account; the tenant's share is
   * credited to their Wallet only when the verified-confirmation
   * path completes (see markVerifiedPaid → WalletService). Two
   * gates, both honest: the tenant must have ENABLED platform
   * payments for this provider, and the platform must actually
   * have that gateway configured — otherwise this refuses rather
   * than producing a fake checkout.
   */
  async initiatePlatformOrderPayment(organizationId: string, orderId: string, providerRaw: string, opts?: { customerName?: string; customerPhone?: string; customerEmail?: string; amountMinor?: bigint | string; purpose?: string }) {
    const provider = String(providerRaw ?? "").trim().toLowerCase();
    if (provider === "nagad") {
      throw new BadRequestException("প্ল্যাটফর্মের Nagad API চেকআউট সংযুক্ত নয় — প্ল্যাটফর্ম গেটওয়ে হিসেবে আপাতত SSLCommerz ও bKash-ই আছে।");
    }
    if (provider !== "sslcommerz" && provider !== "bkash") {
      throw new BadRequestException("provider must be sslcommerz | bkash");
    }
    if (!(await this.wallet.isPlatformEnabled(organizationId, provider))) {
      throw new BadRequestException("আপনি এই প্রোভাইডারে প্ল্যাটফর্ম পেমেন্ট চালু করেননি — আগে Connect Center-এ প্ল্যাটফর্ম গেটওয়ে চালু করুন।");
    }
    const creds = this.wallet.platformCreds(provider);
    if (!creds) {
      throw new BadRequestException("প্ল্যাটফর্মের এই গেটওয়েটি এখনো কনফিগার করা হয়নি — এই মুহূর্তে এই পথে পেমেন্ট নেওয়া যাচ্ছে না।");
    }
    const order = await this.findOrder(organizationId, orderId);
    if (!order) throw new NotFoundException("Order not found");
    if (order.isPractice) throw new BadRequestException("Practice অর্ডারে আসল পেমেন্ট নেওয়া যায় না।");
    // AB4 (AX5a): same partial-payment scoping as the own path.
    const { amountMinor, purpose } = await this.resolveInitiationAmount(organizationId, order, opts);
    const currency = String(order.currency ?? "BDT").toUpperCase();

    const txn = await (this.prisma as any).tenantPaymentTransaction.create({
      data: {
        organizationId, gatewayId: null, orderId: order.id, provider, source: "platform",
        environment: "live",
        amountMinor, currency, status: "initiated", purpose,
      },
    });
    try {
      if (provider === "sslcommerz") {
        return { ...(await this.startSslPayment(creds.ssl as TenantSslCreds, txn, order, opts)), environment: "live" };
      }
      return { ...(await this.startBkashPayment(creds.bkash as TenantBkashCreds, txn, order, opts)), environment: "live" };
    } catch (e) {
      await (this.prisma as any).tenantPaymentTransaction.update({
        where: { id: txn.id }, data: { status: "failed" },
      }).catch(() => undefined);
      await this.recordFailure(txn.id, e instanceof Error ? e.message : String(e)).catch(() => undefined);
      await this.notifyPaymentFailure(txn);
      throw e;
    }
  }

  private async startSslPayment(creds: TenantSslCreds, txn: any, order: any, opts?: { customerName?: string; customerPhone?: string; customerEmail?: string }) {
    const tranId = `TP${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString("hex").toUpperCase()}`;
    const form = new URLSearchParams({
      store_id: creds.storeId,
      store_passwd: creds.storePass,
      total_amount: (Number(txn.amountMinor) / 100).toFixed(2),
      currency: String(txn.currency ?? "BDT"),
      tran_id: tranId,
      success_url: `${this.apiBase()}/public/tenant-payments/sslcommerz/return`,
      fail_url: `${this.apiBase()}/public/tenant-payments/sslcommerz/return`,
      cancel_url: `${this.apiBase()}/public/tenant-payments/sslcommerz/return`,
      ipn_url: `${this.apiBase()}/public/tenant-payments/sslcommerz/ipn`,
      product_name: `Order ${order.externalNumber ?? order.id}`,
      product_category: "order",
      product_profile: "general",
      cus_name: String(opts?.customerName ?? "Customer").slice(0, 50),
      cus_email: String(opts?.customerEmail ?? "customer@example.com"),
      cus_phone: String(opts?.customerPhone ?? ""),
      cus_add1: "Bangladesh",
      cus_city: "Dhaka",
      cus_country: "Bangladesh",
      ship_name: String(opts?.customerName ?? "Customer").slice(0, 50),
      ship_add1: "Bangladesh",
      ship_city: "Dhaka",
      ship_country: "Bangladesh",
      shipping_method: "NO",
      value_a: txn.id,
    });
    const gateway = await this.gateway.sslInitSession(creds, form);
    if (!gateway || gateway.status !== "SUCCESS" || !gateway.GatewayPageURL) {
      throw new BadRequestException(`SSLCommerz পেমেন্ট শুরু করতে অস্বীকার করেছে: ${gateway?.failed_reason ?? gateway?.status ?? "unknown error"}`);
    }
    await (this.prisma as any).tenantPaymentTransaction.update({
      where: { id: txn.id }, data: { providerTxnId: tranId },
    });
    return { redirectUrl: String(gateway.GatewayPageURL), transactionId: txn.id, provider: "sslcommerz", providerTxnId: tranId, sandbox: creds.sandbox };
  }

  private async startBkashPayment(creds: TenantBkashCreds, txn: any, order: any, opts?: { customerPhone?: string }) {
    const created = await this.gateway.bkashCreatePayment(creds, {
      amount: (Number(txn.amountMinor) / 100).toFixed(2),
      merchantInvoiceNumber: txn.id,
      payerReference: String(opts?.customerPhone ?? "order"),
      callbackURL: `${this.apiBase()}/public/tenant-payments/bkash/callback`,
    });
    if (!created || String(created.statusCode) !== "0000" || !created.bkashURL || !created.paymentID) {
      throw new BadRequestException(`bKash পেমেন্ট শুরু করতে অস্বীকার করেছে: ${created?.statusMessage ?? "unknown error"}`);
    }
    await (this.prisma as any).tenantPaymentTransaction.update({
      where: { id: txn.id }, data: { providerTxnId: String(created.paymentID) },
    });
    return { redirectUrl: String(created.bkashURL), transactionId: txn.id, provider: "bkash", providerTxnId: String(created.paymentID), sandbox: creds.sandbox };
  }

  /** GC11 — ShurjoPay hosted checkout. Our merchant order_id
   * is unique and ≤30 chars; the row's providerTxnId is the
   * SHURJO order id (sp_order_id) from the response — without
   * it the independent verification call would be impossible,
   * so a response lacking it is refused rather than recorded. */
  private async startShurjoPayment(creds: TenantShurjoCreds, txn: any, order: any, opts?: { customerName?: string; customerPhone?: string }) {
    const merchantOrderId = `SP${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString("hex").toUpperCase()}`;
    const res = await this.gateway.shurjoCreatePayment(creds, {
      prefix: creds.prefix,
      store_id: creds.storeId ?? creds.prefix,
      amount: Number((Number(txn.amountMinor) / 100).toFixed(2)),
      order_id: merchantOrderId,
      currency: String(txn.currency ?? "BDT"),
      return_url: `${this.apiBase()}/public/tenant-payments/shurjopay/return`,
      cancel_url: `${this.apiBase()}/public/tenant-payments/shurjopay/return`,
      customer_name: String(opts?.customerName ?? "Customer").slice(0, 100),
      customer_phone: String(opts?.customerPhone ?? ""),
      customer_address: "Bangladesh",
      customer_city: "Dhaka",
      customer_postcode: "1200",
      client_ip: "127.0.0.1",
    });
    if (!res?.checkout_url) {
      throw new BadRequestException(`ShurjoPay পেমেন্ট শুরু করতে অস্বীকার করেছে: ${res?.message ?? res?.msg ?? "unknown error"}`);
    }
    const spOrderId = String(res?.sp_order_id ?? "").trim();
    if (!spOrderId) {
      throw new BadRequestException("ShurjoPay সাড়া দিয়েছে কিন্তু sp_order_id দেয়নি — যাচাই অসম্ভব বলে এই পেমেন্টটি গ্রহণ করা যাচ্ছে না।");
    }
    await (this.prisma as any).tenantPaymentTransaction.update({
      where: { id: txn.id }, data: { providerTxnId: spOrderId },
    });
    return { redirectUrl: String(res.checkout_url), transactionId: txn.id, provider: "shurjopay", providerTxnId: spOrderId, sandbox: creds.sandbox };
  }

  /** GC11 — aamarPay hosted checkout. tran_id is OUR unique id
   * (SSL-style generator, ≤32 chars) and is stored as the
   * providerTxnId — the Search Transaction call keys on it. */
  private async startAamarPayment(creds: TenantAamarCreds, txn: any, order: any, opts?: { customerName?: string; customerPhone?: string; customerEmail?: string }) {
    const tranId = `TP${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString("hex").toUpperCase()}`;
    const res = await this.gateway.aamarInit(creds, {
      tran_id: tranId,
      amount: (Number(txn.amountMinor) / 100).toFixed(2),
      currency: String(txn.currency ?? "BDT"),
      desc: `Order ${order.externalNumber ?? order.id}`,
      cus_name: String(opts?.customerName ?? "Customer").slice(0, 100),
      cus_email: String(opts?.customerEmail ?? "customer@example.com"),
      cus_phone: String(opts?.customerPhone ?? ""),
      cus_add1: "Bangladesh",
      cus_city: "Dhaka",
      success_url: `${this.apiBase()}/public/tenant-payments/aamarpay/success`,
      fail_url: `${this.apiBase()}/public/tenant-payments/aamarpay/fail`,
      cancel_url: `${this.apiBase()}/public/tenant-payments/aamarpay/cancel`,
    });
    if (!res || String(res.result ?? "").toLowerCase() !== "true" || !res.payment_url) {
      throw new BadRequestException(`aamarPay পেমেন্ট শুরু করতে অস্বীকার করেছে: ${res?.message ?? res?.msg ?? "unknown error"}`);
    }
    await (this.prisma as any).tenantPaymentTransaction.update({
      where: { id: txn.id }, data: { providerTxnId: tranId },
    });
    return { redirectUrl: String(res.payment_url), transactionId: txn.id, provider: "aamarpay", providerTxnId: tranId, sandbox: creds.sandbox };
  }

  /**
   * Mark an order paid — called ONLY from the verified
   * confirmation paths below. The TenantPaymentTransaction row is
   * the payment source of truth; the order records the method and
   * an internal (merchant-only) evidence note, exactly once.
   */
  private async markVerifiedPaid(txn: any, evidence: { valId?: string; payload: any; providerTxnId?: string }) {
    // AB4 (AX5a): DEPOSIT BOOKKEEPING FIRST — before the
    // alreadyProcessed early return, so a re-delivery after a
    // bookkeeping failure can still complete it. This runs only
    // on verified paths: on first entry the caller has just
    // verified the payment with the gateway; on re-delivery
    // txn.status is already verified_paid. Failure-isolated
    // inside ensureDepositVerification (never throws).
    if (txn.purpose === "deposit") {
      await this.ensureDepositVerification(txn);
    }
    if (txn.status === "verified_paid") return { ok: true, alreadyProcessed: true };
    // CC19 hard guard: a SANDBOX transaction can be verified by
    // its (sandbox) gateway all day — the verification is real
    // for the test — but it must NEVER transition a real order
    // or credit a wallet. The txn row itself records the
    // verified outcome + payload as evidence; nothing else moves.
    if (txn.environment === "sandbox") {
      await (this.prisma as any).tenantPaymentTransaction.update({
        where: { id: txn.id },
        data: {
          status: "verified_paid",
          valId: evidence.valId ?? txn.valId ?? null,
          providerTxnId: evidence.providerTxnId ?? txn.providerTxnId ?? null,
          ipnPayload: evidence.payload ?? null,
        },
      }).catch(() => undefined);
      await this.audit.log({
        organizationId: txn.organizationId, userId: "gateway-ipn", action: "tenant_payment.test_verified",
        entityType: "TenantPaymentTransaction", entityId: txn.id,
        metadata: { provider: txn.provider, environment: "sandbox", amountMinor: String(txn.amountMinor) },
      }).catch(() => undefined);
      return { ok: true, test: true, environment: "sandbox" };
    }
    if (txn.source === "platform") {
      // AB4: capture the order's pre-credit payment stamp so a
      // PARTIAL settlement can leave paymentMethod/isCod exactly
      // as they were (the wallet credit stamps them itself).
      // Primitive snapshot — the row object itself may be
      // mutated by the credit, its scalar fields cannot.
      const preOrder = await this.findOrder(txn.organizationId, txn.orderId).catch(() => null);
      const preStamp = {
        paymentMethod: preOrder?.paymentMethod ?? null,
        isCod: preOrder?.isCod ?? null,
      };
      // CC10: the verified_paid transition AND the wallet credit
      // happen atomically inside the wallet service (one Prisma
      // transaction; re-delivery is a no-op there too).
      const credited = await this.wallet.creditVerifiedPlatformPayment(txn, evidence);
      // GC12: stamp fee/net from the wallet credit's fee onto
      // the txn — failure-isolated: the wallet credit is already
      // final, so a stamp failure must not fail the IPN.
      if (credited?.ok && !credited.alreadyProcessed && credited.feeMinor != null) {
        try {
          const fee = BigInt(credited.feeMinor as any);
          const amount = BigInt(txn.amountMinor ?? 0);
          await (this.prisma as any).tenantPaymentTransaction.update({
            where: { id: txn.id }, data: { feeMinor: fee, netMinor: amount - fee },
          }).catch(() => undefined);
        } catch { /* stamp is bookkeeping only */ }
      }
      if (credited?.ok) {
        // AB4 (AX5a): settlement scoping for the order stamp,
        // failure-isolated (read order, settled = Σ verified —
        // which now includes this txn — ≥ total).
        let settled = false;
        let orderTotalMinor = "0";
        try {
          const order = await this.findOrder(txn.organizationId, txn.orderId);
          if (order) {
            let total = 0n;
            try { total = BigInt(order.totalMinor ?? 0); } catch { total = 0n; }
            orderTotalMinor = total.toString();
            const sum = await this.verifiedPaidSum(txn.organizationId, String(order.id));
            settled = total > 0n && sum >= total;
            if (!credited.alreadyProcessed) {
              if (settled) {
                const note = `[অনলাইন পেমেন্ট যাচাইকৃত — ${txn.provider} · txn ${txn.id}]`;
                const internalNote = String(order.internalNote ?? "").includes(txn.id)
                  ? order.internalNote
                  : [String(order.internalNote ?? "").trim(), note].filter(Boolean).join(" | ");
                await (this.prisma as any).order.update({
                  where: { id: order.id },
                  data: { paymentMethod: txn.provider, isCod: false, internalNote },
                }).catch(() => undefined);
              } else {
                const note = `[আংশিক পেমেন্ট যাচাইকৃত — ${txn.provider} · txn ${txn.id}]`;
                const internalNote = String(order.internalNote ?? "").includes(note)
                  ? order.internalNote
                  : [String(order.internalNote ?? "").trim(), note].filter(Boolean).join(" | ");
                await (this.prisma as any).order.update({
                  where: { id: order.id },
                  data: {
                    // Restore the pre-credit stamp: a partial
                    // payment must not re-label the order's
                    // payment method / COD flag.
                    paymentMethod: preStamp.paymentMethod ?? order.paymentMethod,
                    isCod: preStamp.isCod ?? order.isCod,
                    internalNote,
                  },
                }).catch(() => undefined);
              }
            }
          }
        } catch { /* stamp scoping is bookkeeping only */ }
        await this.audit.log({
          organizationId: txn.organizationId, userId: "gateway-ipn", action: "tenant_payment.verified_paid",
          entityType: "TenantPaymentTransaction", entityId: txn.id,
          metadata: { provider: txn.provider, orderId: txn.orderId, amountMinor: String(txn.amountMinor), source: "platform", creditedMinor: String(credited.creditedMinor ?? ""), feeMinor: String(credited.feeMinor ?? "") },
        }).catch(() => undefined);
        // CC26 + GC23: on a FRESH verified_paid transition the
        // payment link that rode this payment is spent and the
        // "order.paid" bus event fires (never on a re-delivery).
        if (!credited.alreadyProcessed) {
          await this.markLinkUsed(txn);
          this.emitOrderPaid(txn, {
            purpose: txn.purpose ?? "full", fullySettled: settled, orderTotalMinor,
          });
        }
      }
      return credited;
    }
    // GC12 (own path): fee from the gateway row's contract
    // numbers, stamped in the SAME update that sets
    // verified_paid. Both fee fields null on the row → fee/net
    // stay null (never invent a rate). The gateway read is
    // failure-isolated: a read failure leaves fee null rather
    // than blocking a verified payment.
    let feeFields: { feeMinor: bigint; netMinor: bigint } | null = null;
    try {
      let gatewayRow: any = null;
      if (txn.gatewayId) {
        gatewayRow = await (this.prisma as any).tenantPaymentGateway.findFirst({ where: { id: txn.gatewayId } }).catch(() => null);
      }
      if (!gatewayRow) gatewayRow = await this.findGatewayRow(txn.organizationId, String(txn.provider));
      feeFields = this.computeOwnFee(gatewayRow, BigInt(txn.amountMinor ?? 0));
    } catch { feeFields = null; }
    const updated = await (this.prisma as any).tenantPaymentTransaction.update({
      where: { id: txn.id },
      data: {
        status: "verified_paid",
        valId: evidence.valId ?? txn.valId ?? null,
        providerTxnId: evidence.providerTxnId ?? txn.providerTxnId ?? null,
        ipnPayload: evidence.payload ?? null,
        ...(feeFields ? { feeMinor: feeFields.feeMinor, netMinor: feeFields.netMinor } : {}),
      },
    });
    const order = await this.findOrder(txn.organizationId, txn.orderId);
    // AB4 (AX5a): settlement scoping — the order's payment
    // stamp flips to the gateway ONLY when verified payments
    // (Σ including this txn, whose row was just updated above)
    // cover the full total. A partial verified payment (a
    // deposit, an instalment slice) appends an evidence note
    // and leaves paymentMethod/isCod untouched.
    let settled = false;
    let orderTotalMinor = "0";
    if (order) {
      let total = 0n;
      try { total = BigInt(order.totalMinor ?? 0); } catch { total = 0n; }
      orderTotalMinor = total.toString();
      const sum = await this.verifiedPaidSum(txn.organizationId, String(order.id));
      settled = total > 0n && sum >= total;
      if (settled) {
        const note = `[অনলাইন পেমেন্ট যাচাইকৃত — ${txn.provider} · txn ${txn.id}]`;
        const internalNote = String(order.internalNote ?? "").includes(txn.id)
          ? order.internalNote
          : [String(order.internalNote ?? "").trim(), note].filter(Boolean).join(" | ");
        await (this.prisma as any).order.update({
          where: { id: order.id },
          data: { paymentMethod: txn.provider, isCod: false, internalNote },
        }).catch(() => undefined);
      } else {
        const note = `[আংশিক পেমেন্ট যাচাইকৃত — ${txn.provider} · txn ${txn.id}]`;
        const internalNote = String(order.internalNote ?? "").includes(note)
          ? order.internalNote
          : [String(order.internalNote ?? "").trim(), note].filter(Boolean).join(" | ");
        await (this.prisma as any).order.update({
          where: { id: order.id },
          data: { internalNote },
        }).catch(() => undefined);
      }
    }
    await this.audit.log({
      organizationId: txn.organizationId, userId: "gateway-ipn", action: "tenant_payment.verified_paid",
      entityType: "TenantPaymentTransaction", entityId: txn.id,
      metadata: { provider: txn.provider, orderId: txn.orderId, amountMinor: String(txn.amountMinor) },
    }).catch(() => undefined);
    // CC26: a payment link that rode this payment is spent.
    await this.markLinkUsed(txn);
    // GC23: the verified_paid transition just happened above.
    this.emitOrderPaid(txn, {
      purpose: txn.purpose ?? "full", fullySettled: settled, orderTotalMinor,
    });
    return { ok: true, transaction: updated };
  }

  /**
   * CC26 — when a payment reaches verified_paid, the ACTIVE
   * payment link for the same (org, order, provider, source)
   * becomes "used". This runs ONLY from the verified-paid
   * transitions above — initiation never calls it, so a link
   * is never spent by an unpaid attempt. Failure-isolated like
   * the order-note write: a link-bookkeeping error must never
   * break the gateway's IPN response (and re-initiation stays
   * impossible anyway, because hasVerifiedPayment blocks a
   * second payment for the order).
   */
  private async markLinkUsed(txn: any): Promise<void> {
    try {
      const link = await (this.prisma as any).paymentLink.findFirst({
        where: {
          organizationId: txn.organizationId, orderId: txn.orderId, provider: txn.provider,
          source: txn.source === "platform" ? "platform" : "own", status: "active",
        },
      });
      if (!link) return;
      await (this.prisma as any).paymentLink.update({
        where: { id: link.id }, data: { status: "used", usedAt: new Date() },
      });
    } catch { /* link bookkeeping never breaks the gateway response */ }
  }

  /**
   * SSLCommerz IPN for a TENANT gateway. Trust chain (the M36
   * discipline, with the tenant's own credentials): signature
   * with the tenant's store password → status → validation API
   * confirmation → tran_id / exact amount / currency / store_id
   * match. Anything less changes nothing (except a signed
   * FAILED/CANCELLED, which is recorded as such).
   */
  async handleSslIpn(body: Record<string, any>) {
    const tranId = String(body?.tran_id ?? "");
    if (!tranId) return { ok: false, reason: "missing tran_id" };
    let txn: any = null;
    try {
      txn = await (this.prisma as any).tenantPaymentTransaction.findFirst({
        where: { provider: "sslcommerz", providerTxnId: tranId },
      });
    } catch { txn = null; }
    if (!txn) return { ok: false, ignored: true, reason: "unknown tran_id" };
    if (txn.status === "verified_paid") return { ok: true, alreadyProcessed: true };
    const creds = (await this.resolveCredsForTxn(txn)) as TenantSslCreds | null;
    if (!creds) return { ok: false, reason: "gateway not configured" };
    if (!verifyIpnSignature(creds.storePass, body)) {
      // CC23: a forged/unsigned IPN is recorded on the
      // transaction (the anomaly counter reads these); it
      // changes nothing else.
      await this.recordIpnEvent(txn, "signature_invalid", "sslcommerz ipn signature verification failed");
      return { ok: false, reason: "signature verification failed" };
    }
    const status = String(body?.status ?? "").toUpperCase();
    if (status === "FAILED" || status === "CANCELLED") {
      if (txn.status === "initiated") {
        await (this.prisma as any).tenantPaymentTransaction.update({
          where: { id: txn.id }, data: { status: status === "FAILED" ? "failed" : "cancelled" },
        });
        await this.recordFailure(txn.id, `gateway reported ${status}`).catch(() => undefined);
        if (status === "FAILED") await this.notifyPaymentFailure(txn);
      }
      return { ok: true, recorded: status.toLowerCase() };
    }
    if (status !== "VALID" && status !== "VALIDATED") {
      return { ok: false, reason: `unexpected IPN status: ${status || "(empty)"}` };
    }
    const valId = String(body?.val_id ?? "");
    const validation = await this.gateway.sslValidate(creds, valId);
    if (!validation || !["VALID", "VALIDATED"].includes(String(validation.status ?? "").toUpperCase())) {
      return { ok: false, reason: "gateway validation did not confirm this payment" };
    }
    if (String(validation.tran_id ?? "") !== tranId) {
      return { ok: false, reason: "validated transaction does not match this transaction" };
    }
    if (validation.store_id && String(validation.store_id) !== creds.storeId) {
      return { ok: false, reason: "validated store does not match the tenant gateway" };
    }
    const confirmedMinor = Math.round(Number(validation.amount) * 100);
    if (!Number.isFinite(confirmedMinor) || confirmedMinor !== Number(txn.amountMinor)) {
      await this.recordIpnEvent(txn, "amount_mismatch", `sslcommerz validated amount ${String(validation.amount)} != transaction ${String(txn.amountMinor)} minor`);
      return { ok: false, reason: "confirmed amount does not match this transaction" };
    }
    if (String(validation.currency ?? "BDT").toUpperCase() !== String(txn.currency).toUpperCase()) {
      return { ok: false, reason: "confirmed currency does not match this transaction" };
    }
    return this.markVerifiedPaid(txn, { valId, payload: { ipn: body, validation } });
  }

  /** SSLCommerz browser return URL — informational ONLY. It
   * never marks anything paid; the buyer lands back on the shop
   * with a "being verified" flag and the IPN does the real work. */
  async sslReturnRedirect(body: Record<string, any>): Promise<string> {
    const tranId = String(body?.tran_id ?? "");
    let slug = "";
    try {
      const txn = tranId
        ? await (this.prisma as any).tenantPaymentTransaction.findFirst({ where: { provider: "sslcommerz", providerTxnId: tranId } })
        : null;
      if (txn?.organizationId) {
        const org = await (this.prisma as any).organization.findUnique({ where: { id: txn.organizationId } });
        slug = org?.slug ? `/shop/${org.slug}/success?payment=verifying` : "";
      }
    } catch { slug = ""; }
    return `${this.webBase()}${slug || "/dashboard/connections?payment=verifying"}`;
  }

  /**
   * bKash callback for a TENANT gateway. The redirect proves
   * nothing: the server-to-server EXECUTE call (falling back to a
   * status QUERY when execute reports the payment already
   * executed) must confirm transactionStatus "Completed" with the
   * exact amount before anything is marked paid (M39 discipline).
   * Returns the browser redirect URL.
   */
  async handleBkashCallback(query: Record<string, any>): Promise<string> {
    const paymentID = String(query?.paymentID ?? "");
    const status = String(query?.status ?? "").toLowerCase();
    const fallback = `${this.webBase()}/dashboard/connections?payment=unknown`;
    if (!paymentID) return fallback;
    let txn: any = null;
    try {
      txn = await (this.prisma as any).tenantPaymentTransaction.findFirst({
        where: { provider: "bkash", providerTxnId: paymentID },
      });
    } catch { txn = null; }
    if (!txn) return fallback;
    const done = async (flag: string) => {
      try {
        const org = await (this.prisma as any).organization.findUnique({ where: { id: txn.organizationId } });
        if (org?.slug) return `${this.webBase()}/shop/${org.slug}/success?payment=${flag}`;
      } catch { /* fall through */ }
      return `${this.webBase()}/dashboard/connections?payment=${flag}`;
    };
    if (txn.status === "verified_paid") return done("received");
    if (status !== "success") {
      if (txn.status === "initiated") {
        await (this.prisma as any).tenantPaymentTransaction.update({
          where: { id: txn.id }, data: { status: status === "cancel" ? "cancelled" : "failed" },
        }).catch(() => undefined);
        await this.recordFailure(txn.id, `bKash callback status: ${status || "(empty)"}`).catch(() => undefined);
        if (status !== "cancel") await this.notifyPaymentFailure(txn);
      }
      return done(status === "cancel" ? "cancelled" : "failed");
    }
    const creds = (await this.resolveCredsForTxn(txn)) as TenantBkashCreds | null;
    if (!creds) return done("unknown");
    let confirmation: any = await this.gateway.bkashExecutePayment(creds, paymentID).catch(() => null);
    if (!confirmation || String(confirmation.statusCode) !== "0000" || String(confirmation.transactionStatus) !== "Completed") {
      // Execute can legitimately refuse an already-executed
      // payment; the status query is then the confirming source.
      const queried = await this.gateway.bkashQueryPayment(creds, paymentID).catch(() => null);
      if (queried && String(queried.transactionStatus) === "Completed") confirmation = queried;
    }
    if (!confirmation || String(confirmation.transactionStatus) !== "Completed") {
      return done("failed");
    }
    const confirmedMinor = Math.round(Number(confirmation.amount) * 100);
    if (!Number.isFinite(confirmedMinor) || confirmedMinor !== Number(txn.amountMinor)) {
      await this.recordIpnEvent(txn, "amount_mismatch", `bkash confirmed amount ${String(confirmation.amount)} != transaction ${String(txn.amountMinor)} minor`);
      return done("failed");
    }
    if (confirmation.currency && String(confirmation.currency).toUpperCase() !== String(txn.currency).toUpperCase()) {
      return done("failed");
    }
    await this.markVerifiedPaid(txn, { payload: { executeOrQuery: confirmation } });
    return done("received");
  }

  /** Shop success-page redirect for a known transaction (the
   * bkash handler's `done()` shape), with the dashboard as the
   * fallback when the org/slug cannot be resolved. */
  private async shopRedirectForTxn(txn: any, flag: string): Promise<string> {
    try {
      const org = await (this.prisma as any).organization.findUnique({ where: { id: txn.organizationId } });
      if (org?.slug) return `${this.webBase()}/shop/${org.slug}/success?payment=${flag}`;
    } catch { /* fall through */ }
    return `${this.webBase()}/dashboard/connections?payment=${flag}`;
  }

  /**
   * GC11 — ShurjoPay browser return (GET query or POST body).
   * The return itself proves NOTHING: the server-to-server
   * /api/verification call must return sp_code "1000" with the
   * EXACT amount + currency before anything is marked paid —
   * the same discipline as the bKash callback. A definitive
   * non-1000 sp_code records the txn failed; a failed or
   * unparseable verification call leaves the txn initiated
   * ("verifying") so a later return/IPN-style retry can still
   * confirm it. Credentials resolve on the OWN path only —
   * the platform gateway never carries these providers.
   */
  async handleShurjoReturn(params: Record<string, any>): Promise<string> {
    const spOrderId = String(params?.order_id ?? params?.sp_order_id ?? "").trim();
    const fallback = `${this.webBase()}/dashboard/connections?payment=unknown`;
    if (!spOrderId) return fallback;
    let txn: any = null;
    try {
      txn = await (this.prisma as any).tenantPaymentTransaction.findFirst({
        where: { provider: "shurjopay", providerTxnId: spOrderId },
      });
    } catch { txn = null; }
    if (!txn) return fallback;
    const done = (flag: string) => this.shopRedirectForTxn(txn, flag);
    if (txn.status === "verified_paid") return done("received");
    const resolved = await this.resolveGateway(txn.organizationId, "shurjopay");
    if (!resolved) return done("verifying");
    const creds = resolved.creds as TenantShurjoCreds;
    let record: any = null;
    try {
      record = await this.gateway.shurjoVerify(creds, spOrderId);
    } catch { record = null; }
    if (!record || typeof record !== "object") return done("verifying");
    const spCode = String(record.sp_code ?? "").trim();
    if (!spCode) return done("verifying");
    if (spCode !== "1000") {
      if (txn.status === "initiated") {
        await (this.prisma as any).tenantPaymentTransaction.update({
          where: { id: txn.id }, data: { status: "failed" },
        }).catch(() => undefined);
        const spMsg = String((record as any)?.sp_message ?? (record as any)?.message ?? "").trim();
        await this.recordFailure(txn.id, spMsg || `ShurjoPay verification sp_code ${spCode}`).catch(() => undefined);
        await this.notifyPaymentFailure(txn);
      }
      return done("failed");
    }
    const confirmedMinor = Math.round(Number(record.amount) * 100);
    if (!Number.isFinite(confirmedMinor) || confirmedMinor !== Number(txn.amountMinor)) {
      return done("failed");
    }
    if (String(record.currency ?? "BDT").toUpperCase() !== String(txn.currency).toUpperCase()) {
      return done("failed");
    }
    await this.markVerifiedPaid(txn, { payload: { verification: record } });
    return done("received");
  }

  /**
   * GC11 — one aamarPay confirmation attempt against a txn.
   * The Search Transaction call DECIDES; the success-POST / IPN
   * that triggered this is evidence of nothing on its own.
   * Outcomes: "paid" (verified + marked), "failed"/"cancelled"
   * (the gateway record itself shows a terminal failure —
   * recorded as such), "unconfirmed" (call failed, record
   * pending, or amount/currency mismatch — NOT paid, txn left
   * initiated so a later trigger can still confirm).
   */
  private async confirmAamarPayment(txn: any, tranId: string): Promise<"paid" | "failed" | "cancelled" | "unconfirmed"> {
    const resolved = await this.resolveGateway(txn.organizationId, "aamarpay");
    if (!resolved) return "unconfirmed";
    const creds = resolved.creds as TenantAamarCreds;
    let record: any = null;
    try {
      record = await this.gateway.aamarTrxCheck(creds, tranId);
    } catch { return "unconfirmed"; }
    if (!record || typeof record !== "object") return "unconfirmed";
    const payStatus = String(record.pay_status ?? record.status ?? "").trim().toLowerCase();
    if (payStatus === "successful") {
      const confirmedMinor = Math.round(Number(record.amount ?? record.amount_bdt) * 100);
      if (!Number.isFinite(confirmedMinor) || confirmedMinor !== Number(txn.amountMinor)) return "unconfirmed";
      if (String(record.currency ?? "BDT").toUpperCase() !== String(txn.currency).toUpperCase()) return "unconfirmed";
      await this.markVerifiedPaid(txn, { payload: { verification: record } });
      return "paid";
    }
    // NOTE: a record like the sandbox-pinned { status:
    // "Invalid-Data" } for an unknown tran_id is NOT a payment
    // failure — it is "no such transaction", i.e. unconfirmed.
    if (payStatus === "failed" || payStatus === "failure" || payStatus === "declined") {
      if (txn.status === "initiated") {
        await (this.prisma as any).tenantPaymentTransaction.update({
          where: { id: txn.id }, data: { status: "failed" },
        }).catch(() => undefined);
        await this.recordFailure(txn.id, `aamarPay pay_status ${payStatus}`).catch(() => undefined);
        await this.notifyPaymentFailure(txn);
      }
      return "failed";
    }
    if (payStatus === "cancelled" || payStatus === "canceled") {
      if (txn.status === "initiated") {
        await (this.prisma as any).tenantPaymentTransaction.update({
          where: { id: txn.id }, data: { status: "cancelled" },
        }).catch(() => undefined);
        await this.recordFailure(txn.id, `aamarPay pay_status ${payStatus}`).catch(() => undefined);
      }
      return "cancelled";
    }
    return "unconfirmed";
  }

  private async findAamarTxn(body: Record<string, any>): Promise<{ txn: any; tranId: string } | null> {
    const tranId = String(body?.tran_id ?? body?.mer_txnid ?? "").trim();
    if (!tranId) return null;
    let txn: any = null;
    try {
      txn = await (this.prisma as any).tenantPaymentTransaction.findFirst({
        where: { provider: "aamarpay", providerTxnId: tranId },
      });
    } catch { txn = null; }
    return txn ? { txn, tranId } : null;
  }

  /**
   * GC11 — aamarPay success / fail / cancel POSTs (browser
   * redirects). fail/cancel carry no verification — they only
   * record the buyer's abandonment/failure against an
   * initiated txn. success is a TRIGGER ONLY: the Search
   * Transaction confirmation inside confirmAamarPayment is
   * what may mark the order paid.
   */
  async handleAamarResult(kind: "success" | "fail" | "cancel", body: Record<string, any>): Promise<string> {
    const found = await this.findAamarTxn(body ?? {});
    if (!found) return `${this.webBase()}/dashboard/connections?payment=unknown`;
    const { txn, tranId } = found;
    const done = (flag: string) => this.shopRedirectForTxn(txn, flag);
    if (txn.status === "verified_paid") return done("received");
    if (kind === "fail") {
      if (txn.status === "initiated") {
        await (this.prisma as any).tenantPaymentTransaction.update({
          where: { id: txn.id }, data: { status: "failed" },
        }).catch(() => undefined);
        await this.recordFailure(txn.id, "aamarPay reported fail").catch(() => undefined);
        await this.notifyPaymentFailure(txn);
      }
      return done("failed");
    }
    if (kind === "cancel") {
      // Per aamarPay's own docs NOTHING is posted to the cancel
      // URL — this branch is defensive and records honestly
      // if a cancel notification ever arrives.
      if (txn.status === "initiated") {
        await (this.prisma as any).tenantPaymentTransaction.update({
          where: { id: txn.id }, data: { status: "cancelled" },
        }).catch(() => undefined);
        await this.recordFailure(txn.id, "aamarPay reported cancel").catch(() => undefined);
      }
      return done("cancelled");
    }
    const outcome = await this.confirmAamarPayment(txn, tranId);
    if (outcome === "paid") return done("received");
    if (outcome === "cancelled") return done("cancelled");
    return done("failed");
  }

  /**
   * GC11 — aamarPay IPN. NOTE: per aamarPay's docs the IPN
   * listener URL is NOT configured in code or in a merchant
   * panel field here — it is registered MANUALLY with
   * aamarPay technical support during onboarding. The IPN is
   * a trigger only: exactly like the success POST, the
   * Search Transaction call decides, and this handler answers
   * JSON ({ ok }) instead of redirecting a browser.
   */
  async handleAamarIpn(body: Record<string, any>) {
    const found = await this.findAamarTxn(body ?? {});
    if (!found) return { ok: false, ignored: true, reason: "unknown tran_id" };
    const { txn, tranId } = found;
    if (txn.status === "verified_paid") return { ok: true, alreadyProcessed: true };
    const outcome = await this.confirmAamarPayment(txn, tranId);
    if (outcome === "paid") return { ok: true };
    if (outcome === "failed" || outcome === "cancelled") return { ok: true, recorded: outcome };
    return { ok: false, reason: "gateway check did not confirm this payment" };
  }

  // ---------- GC10: embedded checkout options + public state ----------

  /**
   * GC10 — the online-payment options a public checkout may
   * offer for this org, computed from the REAL initiation gates
   * (never from config presence alone):
   * - own (CC9/GC11): a TenantPaymentGateway row exists, isEnabled,
   *   and its sealed credentials decrypt — exactly what
   *   initiateOrderPayment requires before it will start.
   *   sslcommerz + bkash + shurjopay + aamarpay can initiate;
   *   a saved Nagad config is NOT an option (initiation
   *   refuses it honestly).
   * - platform (CC10): WalletService.isPlatformEnabled(org,
   *   provider) AND WalletService.platformCreds(provider)
   *   non-null — exactly initiatePlatformOrderPayment's gates.
   *   The platform path stays sslcommerz + bkash ONLY: the
   *   platform gateway never carries shurjopay/aamarpay.
   * Failure-isolated: any error reads as no online options, so
   * a payments problem can never break a checkout page.
   */
  async publicPaymentOptions(organizationId: string): Promise<{
    online: Array<{ provider: "sslcommerz" | "bkash" | "shurjopay" | "aamarpay"; source: "own" | "platform"; sandbox: boolean }>;
    options: Array<{ provider: string; source: "own" | "platform" }>;
  }> {
    // Union (GC10 + CC19): GC10 checkout callers pass an org ID;
    // the CC19 public controller + payment-links caller pass an
    // org SLUG. Resolve slug → id when the identifier is not an
    // org id. When the organization table answers and NEITHER id
    // nor slug matches, the CC19 contract applies (404); when the
    // lookup itself is unavailable (partial fakes), the given
    // identifier is used as-is (GC10 failure isolation).
    let orgId = String(organizationId ?? "");
    let lookupAnswered = false;
    let orgFound = false;
    try {
      const byId = await (this.prisma as any).organization.findFirst({ where: { id: orgId } });
      lookupAnswered = true;
      if (byId?.id) orgFound = true;
    } catch { /* identifier used as-is */ }
    if (!orgFound) {
      try {
        const bySlug = await (this.prisma as any).organization.findFirst({ where: { slug: orgId } });
        lookupAnswered = true;
        if (bySlug?.id) { orgId = String(bySlug.id); orgFound = true; }
      } catch { /* identifier used as-is */ }
    }
    if (lookupAnswered && !orgFound) throw new NotFoundException("Shop not found");
    const online: Array<{ provider: "sslcommerz" | "bkash" | "shurjopay" | "aamarpay"; source: "own" | "platform"; sandbox: boolean }> = [];
    try {
      for (const provider of ["sslcommerz", "bkash", "shurjopay", "aamarpay"] as const) {
        try {
          const resolved = await this.resolveGateway(orgId, provider);
          if (resolved && resolved.row.isEnabled !== false) {
            online.push({ provider, source: "own", sandbox: (resolved.creds as any)?.sandbox === true });
          }
        } catch { /* one broken gateway never hides the others */ }
      }
      for (const provider of ["sslcommerz", "bkash"] as const) {
        try {
          if (await this.wallet.isPlatformEnabled(orgId, provider)) {
            const creds = this.wallet.platformCreds(provider);
            if (creds) {
              const inner: any = (creds as any).ssl ?? (creds as any).bkash ?? {};
              online.push({ provider, source: "platform", sandbox: inner?.sandbox === true });
            }
          }
        } catch { /* platform gate failure reads as not offered */ }
      }
    } catch { return { online: [], options: [] }; }
    // CC19: the buyer-facing pair list (LIVE own rows only —
    // sandbox rows are never buyer options — plus platform pairs
    // the platform actually offers and the tenant enabled).
    const options: Array<{ provider: string; source: "own" | "platform" }> = [];
    try {
      for (const provider of ["sslcommerz", "bkash"] as const) {
        const own = await this.resolveGateway(orgId, provider, "live").catch(() => null);
        if (own && own.row.isEnabled !== false) options.push({ provider, source: "own" });
        const offered = this.wallet.platformProviders().find((p) => p.provider === provider)?.offered === true;
        if (offered && (await this.wallet.isPlatformEnabled(orgId, provider))) {
          options.push({ provider, source: "platform" });
        }
      }
    } catch { /* options stay empty on failure */ }
    return { online, options };
  }

  /**
   * GC10 — server-side re-validation of a checkout's chosen
   * (provider, source) pair against publicPaymentOptions. A
   * pair the shop does not actually offer is refused 400 —
   * the client's selection is never trusted on its own.
   */
  async assertPublicPaymentOption(
    organizationId: string,
    sel: { provider?: unknown; source?: unknown } | null | undefined,
  ): Promise<{ provider: "sslcommerz" | "bkash" | "shurjopay" | "aamarpay"; source: "own" | "platform" }> {
    const provider = String(sel?.provider ?? "").trim().toLowerCase();
    const source = String(sel?.source ?? "").trim().toLowerCase();
    const { online } = await this.publicPaymentOptions(organizationId);
    const hit = online.find((o) => o.provider === provider && o.source === source);
    if (!hit) {
      throw new BadRequestException("এই অনলাইন পেমেন্টের অপশনটি এই দোকানে উপলব্ধ নয় — অন্য পেমেন্ট পদ্ধতি বেছে নিন।");
    }
    return { provider: hit.provider, source: hit.source };
  }

  /**
   * GC10 — the public payment state of ONE order, for the shop
   * success page's polling. Same discipline as
   * initiatePublicPayment: the org resolves by slug and the
   * order must match BOTH id and externalNumber, else 404.
   * A verified_paid transaction always wins; otherwise the
   * latest transaction's status is mapped honestly
   * (initiated → "pending" — a browser return NEVER upgrades
   * this; only the verified IPN/callback path writes
   * verified_paid).
   */
  async publicPaymentState(orgSlug: string, orderId: string, orderNumber: string) {
    let org: any = null;
    try {
      org = await (this.prisma as any).organization.findFirst({ where: { slug: String(orgSlug ?? "").trim() } });
    } catch { org = null; }
    if (!org) throw new NotFoundException("Shop not found");
    const order = await this.findOrder(org.id, String(orderId ?? ""));
    if (!order || String(order.externalNumber ?? "") !== String(orderNumber ?? "").trim()) {
      throw new NotFoundException("Order not found");
    }
    let rows: any[] = [];
    try {
      rows = await (this.prisma as any).tenantPaymentTransaction.findMany({
        where: { organizationId: org.id, orderId: order.id },
      });
    } catch { rows = []; }
    const txns = [...(rows ?? [])].sort(
      (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
    );
    // AB4 (AX5a): the deposit block rides EVERY return (null
    // when the order carries no deposit stamp): what was due
    // as deposit, what verified deposit-purpose money has
    // arrived, and what deposit amount is still outstanding.
    let deposit: { dueMinor: string; paidMinor: string; outstandingMinor: string } | null = null;
    if (order.depositDueMinor != null) {
      let due = 0n;
      try { due = BigInt(order.depositDueMinor as any); } catch { due = 0n; }
      let paid = 0n;
      for (const t of txns) {
        if (t.status !== "verified_paid" || (t.purpose ?? "full") !== "deposit") continue;
        try { paid += BigInt(t.amountMinor ?? 0); } catch { /* counts 0 */ }
      }
      const outstanding = due > paid ? due - paid : 0n;
      deposit = { dueMinor: due.toString(), paidMinor: paid.toString(), outstandingMinor: outstanding.toString() };
    }
    const view = (txn: any, state: string) => ({
      state,
      provider: String(txn.provider ?? ""),
      source: String(txn.source ?? "own"),
      deposit,
    });
    // AB4 (AX5a): "verified_paid" now means SETTLED — Σ verified
    // ≥ the order total. A verified deposit that does not settle
    // the order reads honestly as "deposit_paid" instead.
    const verifiedRows = txns.filter((t) => t.status === "verified_paid");
    if (verifiedRows.length > 0) {
      let total = 0n;
      try { total = BigInt(order.totalMinor ?? 0); } catch { total = 0n; }
      let sum = 0n;
      for (const t of verifiedRows) {
        try { sum += BigInt(t.amountMinor ?? 0); } catch { /* counts 0 */ }
      }
      const settled = total > 0n && sum >= total;
      const firstVerified = verifiedRows[0];
      if (settled) return view(firstVerified, "verified_paid");
      const verifiedDeposit = verifiedRows.find((t) => (t.purpose ?? "full") === "deposit");
      if (verifiedDeposit) return view(verifiedDeposit, "deposit_paid");
      return view(firstVerified, "verified_paid");
    }
    const latest = txns[0];
    if (!latest) return { state: "none" as const, deposit };
    const mapped = latest.status === "failed" ? "failed"
      : latest.status === "cancelled" ? "cancelled"
      : "pending";
    return view(latest, mapped);
  }

  /**
   * Public storefront initiation: a buyer pays for an order they
   * just placed. The order number must match the order row (the
   * tracking-lookup discipline) — the order id alone is not
   * enough to start a payment against someone else's order.
   */
  async initiatePublicPayment(orgSlug: string, orderId: string, orderNumber: string, provider: string, source?: string, purpose?: string) {
    let org: any = null;
    try {
      org = await (this.prisma as any).organization.findFirst({ where: { slug: String(orgSlug ?? "").trim() } });
    } catch { org = null; }
    if (!org) throw new NotFoundException("Shop not found");
    const order = await this.findOrder(org.id, orderId);
    if (!order || String(order.externalNumber ?? "") !== String(orderNumber ?? "").trim()) {
      throw new NotFoundException("Order not found");
    }
    const customer = order.customerId
      ? await (this.prisma as any).customer.findFirst({ where: { id: order.customerId } }).catch(() => null)
      : null;
    const opts: {
      customerName?: string; customerPhone?: string; customerEmail?: string;
      amountMinor?: bigint | string; purpose?: string;
    } = {
      customerName: customer?.firstName ?? customer?.name ?? undefined,
      customerPhone: customer?.phone ?? undefined,
      customerEmail: customer?.email ?? undefined,
    };
    // AB4 (AX5a): a purpose-scoped public initiation. "deposit"
    // prices from the org's deposit config (online kind) and
    // never exceeds the remaining balance; "balance" collects
    // exactly what is left; absent/"full" is the legacy path
    // (no amount opts — the initiate methods derive as before).
    const wantedPurpose = purpose != null ? String(purpose).trim().toLowerCase() : "";
    if (wantedPurpose === "deposit") {
      let total = 0n;
      try { total = BigInt(order.totalMinor ?? 0); } catch { total = 0n; }
      const profile = await (this.prisma as any).businessProfile
        .findFirst({ where: { organizationId: org.id } })
        .catch(() => null);
      const deposit = depositFor(profile, { totalMinor: total, kind: "online" });
      if (!deposit.active) {
        throw new BadRequestException("এই অর্ডারের জন্য ডিপোজিট প্রযোজ্য নয়");
      }
      const verifiedSum = await this.verifiedPaidSum(org.id, String(order.id));
      const remaining = total - verifiedSum;
      const amount = deposit.amountMinor < remaining ? deposit.amountMinor : remaining;
      opts.amountMinor = amount;
      opts.purpose = "deposit";
    } else if (wantedPurpose === "balance") {
      let total = 0n;
      try { total = BigInt(order.totalMinor ?? 0); } catch { total = 0n; }
      const verifiedSum = await this.verifiedPaidSum(org.id, String(order.id));
      const remaining = total - verifiedSum;
      if (remaining <= 0n) {
        throw new BadRequestException("এই অর্ডারের কোনো বাকি পরিমাণ নেই — ব্যালান্স পেমেন্ট শুরু করা যাবে না।");
      }
      opts.amountMinor = remaining;
      opts.purpose = "balance";
    }
    // CC10: source "platform" routes to the platform gateway
    // (wallet credit on verified confirmation); anything else is
    // the CC9 own-gateway path.
    if (source === "platform") return this.initiatePlatformOrderPayment(org.id, order.id, provider, opts);
    return this.initiateOrderPayment(org.id, order.id, provider, opts);
  }

}
