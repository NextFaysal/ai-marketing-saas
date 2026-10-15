import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { decryptJson, encryptJson } from "../integrations/crypto";
import { verifyIpnSignature } from "../payments/payments.service";
import { TenantGatewayClient, type TenantBkashCreds, type TenantNagadCreds, type TenantSslCreds } from "./tenant-gateway.client";
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
 *
 * Credentials are sealed (encryptJson) at rest and NEVER returned:
 * a gateway view carries only the provider, its non-secret
 * identifier (store id / app key / merchant id), status and
 * verification state.
 */

export const TENANT_GATEWAY_PROVIDERS = ["sslcommerz", "bkash", "nagad"] as const;
export type TenantGatewayProvider = (typeof TENANT_GATEWAY_PROVIDERS)[number];

export type TenantGatewayCreds = TenantSslCreds | TenantBkashCreds | TenantNagadCreds;

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
};

@Injectable()
export class TenantPaymentsService {
  private readonly gateway: TenantGatewayClient;
  private readonly wallet: WalletService;
  private readonly stepUp: StepUpService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() gatewayClient?: TenantGatewayClient,
    @Optional() walletService?: WalletService,
    @Optional() stepUpService?: StepUpService,
  ) {
    this.gateway = gatewayClient ?? new TenantGatewayClient();
    this.wallet = walletService ?? new WalletService(prisma, audit);
    this.stepUp = stepUpService ?? new StepUpService(prisma as any);
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
   * CC19: gateway rows are per ENVIRONMENT. Production paths
   * resolve "live" EXPLICITLY (the default here, always); the
   * sandbox row is reachable only by passing "sandbox" — the
   * Doctor's check and the labelled test initiation are the only
   * callers that do.
   */
  private async findGatewayRow(organizationId: string, provider: string, environment = "live"): Promise<any | null> {
    try {
      return await (this.prisma as any).tenantPaymentGateway.findFirst({ where: { organizationId, provider, environment } });
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
      identifier = creds?.storeId ?? creds?.appKey ?? creds?.merchantId ?? null;
    } catch { identifier = null; }
    return {
      provider: row.provider,
      environment: row.environment === "sandbox" ? "sandbox" : "live",
      identifier,
      sandbox: (() => { try { return decryptJson<any>(row.encryptedData)?.sandbox === true; } catch { return false; } })(),
      status: row.status,
      isEnabled: row.isEnabled !== false,
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
      throw new BadRequestException("provider must be sslcommerz | bkash | nagad");
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
    } else {
      const merchantId = String(dto?.merchantId ?? "").trim();
      const privateKey = String(dto?.privateKey ?? "").trim();
      if (!merchantId || !privateKey) throw new BadRequestException("Nagad Merchant ID ও Private Key দুটোই প্রয়োজন।");
      creds = { merchantId, privateKey } satisfies TenantNagadCreds;
      // No merchant-API credential check is wired for Nagad in
      // this codebase — saved honestly as "configured".
    }

    const data = { encryptedData: encryptJson(creds), status, isEnabled: true, lastVerifiedAt, lastError: null };
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
   * Start a payment for one order through the tenant's OWN
   * gateway. Records a TenantPaymentTransaction "initiated" and
   * returns the gateway's real redirect URL. The order is NOT
   * marked paid here — only the verified IPN/callback path does
   * that (see handleSslIpn / handleBkashCallback).
   */
  async initiateOrderPayment(organizationId: string, orderId: string, providerRaw: string, opts?: { customerName?: string; customerPhone?: string; customerEmail?: string }) {
    const provider = String(providerRaw ?? "").trim().toLowerCase();
    if (provider === "nagad") {
      throw new BadRequestException("Nagad API চেকআউট এই সিস্টেমে সংযুক্ত নয় — Nagad কনফিগটি শুধু সংরক্ষিত আছে। আপাতত ম্যানুয়াল Nagad নম্বরের পথটি ব্যবহার করুন।");
    }
    if (provider !== "sslcommerz" && provider !== "bkash") {
      throw new BadRequestException("provider must be sslcommerz | bkash");
    }
    const resolved = await this.resolveGateway(organizationId, provider);
    if (!resolved) throw new BadRequestException("এই গেটওয়েটি কনফিগার করা নেই — আগে Connect Center-এ নিজের গেটওয়ে যোগ করুন।");
    if (resolved.row.isEnabled === false) throw new BadRequestException("এই গেটওয়েটি বন্ধ (disabled) করা আছে।");
    const order = await this.findOrder(organizationId, orderId);
    if (!order) throw new NotFoundException("Order not found");
    if (order.isPractice) throw new BadRequestException("Practice অর্ডারে আসল পেমেন্ট নেওয়া যায় না।");
    if (await this.hasVerifiedPayment(organizationId, orderId)) {
      throw new BadRequestException("এই অর্ডারের পেমেন্ট ইতিমধ্যে যাচাইকৃতভাবে সম্পন্ন হয়েছে — আবার পেমেন্ট শুরু করা যাবে না।");
    }
    const amountMinor = BigInt(order.totalMinor ?? 0);
    if (amountMinor <= 0n) throw new BadRequestException("অর্ডারের মোট পরিমাণ শূন্য বা তার কম — অনলাইন পেমেন্ট শুরু করা যাবে না।");
    const currency = String(order.currency ?? "BDT").toUpperCase();

    const txn = await (this.prisma as any).tenantPaymentTransaction.create({
      data: {
        organizationId, gatewayId: resolved.row.id, orderId: order.id, provider,
        environment: "live",
        amountMinor, currency, status: "initiated",
      },
    });

    try {
      if (provider === "sslcommerz") {
        return { ...(await this.startSslPayment(resolved.creds as TenantSslCreds, txn, order, opts)), environment: "live" };
      }
      return { ...(await this.startBkashPayment(resolved.creds as TenantBkashCreds, txn, order, opts)), environment: "live" };
    } catch (e) {
      await (this.prisma as any).tenantPaymentTransaction.update({
        where: { id: txn.id }, data: { status: "failed" },
      }).catch(() => undefined);
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
  async initiatePlatformOrderPayment(organizationId: string, orderId: string, providerRaw: string, opts?: { customerName?: string; customerPhone?: string; customerEmail?: string }) {
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
    if (await this.hasVerifiedPayment(organizationId, orderId)) {
      throw new BadRequestException("এই অর্ডারের পেমেন্ট ইতিমধ্যে যাচাইকৃতভাবে সম্পন্ন হয়েছে — আবার পেমেন্ট শুরু করা যাবে না।");
    }
    const amountMinor = BigInt(order.totalMinor ?? 0);
    if (amountMinor <= 0n) throw new BadRequestException("অর্ডারের মোট পরিমাণ শূন্য বা তার কম — অনলাইন পেমেন্ট শুরু করা যাবে না।");
    const currency = String(order.currency ?? "BDT").toUpperCase();

    const txn = await (this.prisma as any).tenantPaymentTransaction.create({
      data: {
        organizationId, gatewayId: null, orderId: order.id, provider, source: "platform",
        environment: "live",
        amountMinor, currency, status: "initiated",
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

  /**
   * Mark an order paid — called ONLY from the verified
   * confirmation paths below. The TenantPaymentTransaction row is
   * the payment source of truth; the order records the method and
   * an internal (merchant-only) evidence note, exactly once.
   */
  private async markVerifiedPaid(txn: any, evidence: { valId?: string; payload: any; providerTxnId?: string }) {
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
      // CC10: the verified_paid transition AND the wallet credit
      // happen atomically inside the wallet service (one Prisma
      // transaction; re-delivery is a no-op there too).
      const credited = await this.wallet.creditVerifiedPlatformPayment(txn, evidence);
      if (credited?.ok) {
        await this.audit.log({
          organizationId: txn.organizationId, userId: "gateway-ipn", action: "tenant_payment.verified_paid",
          entityType: "TenantPaymentTransaction", entityId: txn.id,
          metadata: { provider: txn.provider, orderId: txn.orderId, amountMinor: String(txn.amountMinor), source: "platform", creditedMinor: String(credited.creditedMinor ?? ""), feeMinor: String(credited.feeMinor ?? "") },
        }).catch(() => undefined);
        // CC26: a payment link that rode this payment is spent.
        if (!credited.alreadyProcessed) await this.markLinkUsed(txn);
      }
      return credited;
    }
    const updated = await (this.prisma as any).tenantPaymentTransaction.update({
      where: { id: txn.id },
      data: {
        status: "verified_paid",
        valId: evidence.valId ?? txn.valId ?? null,
        providerTxnId: evidence.providerTxnId ?? txn.providerTxnId ?? null,
        ipnPayload: evidence.payload ?? null,
      },
    });
    const order = await this.findOrder(txn.organizationId, txn.orderId);
    if (order) {
      const note = `[অনলাইন পেমেন্ট যাচাইকৃত — ${txn.provider} · txn ${txn.id}]`;
      const internalNote = String(order.internalNote ?? "").includes(txn.id)
        ? order.internalNote
        : [String(order.internalNote ?? "").trim(), note].filter(Boolean).join(" | ");
      await (this.prisma as any).order.update({
        where: { id: order.id },
        data: { paymentMethod: txn.provider, isCod: false, internalNote },
      }).catch(() => undefined);
    }
    await this.audit.log({
      organizationId: txn.organizationId, userId: "gateway-ipn", action: "tenant_payment.verified_paid",
      entityType: "TenantPaymentTransaction", entityId: txn.id,
      metadata: { provider: txn.provider, orderId: txn.orderId, amountMinor: String(txn.amountMinor) },
    }).catch(() => undefined);
    // CC26: a payment link that rode this payment is spent.
    await this.markLinkUsed(txn);
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

  /**
   * Public storefront initiation: a buyer pays for an order they
   * just placed. The order number must match the order row (the
   * tracking-lookup discipline) — the order id alone is not
   * enough to start a payment against someone else's order.
   */
  async initiatePublicPayment(orgSlug: string, orderId: string, orderNumber: string, provider: string, source?: string) {
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
    const opts = {
      customerName: customer?.firstName ?? customer?.name ?? undefined,
      customerPhone: customer?.phone ?? undefined,
      customerEmail: customer?.email ?? undefined,
    };
    // CC10: source "platform" routes to the platform gateway
    // (wallet credit on verified confirmation); anything else is
    // the CC9 own-gateway path.
    if (source === "platform") return this.initiatePlatformOrderPayment(org.id, order.id, provider, opts);
    return this.initiateOrderPayment(org.id, order.id, provider, opts);
  }

  /**
   * CC19: which online-payment options a shop's buyer may be
   * offered — the public counterpart of the Center's payment
   * section. An option appears ONLY when it would really work:
   * an own LIVE gateway that exists and is enabled, or a
   * platform provider the tenant enabled AND the platform
   * actually offers. Sandbox rows are never buyer options.
   * No identifiers or secrets — just provider + source pairs.
   */
  async publicPaymentOptions(orgSlug: string) {
    let org: any = null;
    try {
      org = await (this.prisma as any).organization.findFirst({ where: { slug: String(orgSlug ?? "").trim() } });
    } catch { org = null; }
    if (!org) throw new NotFoundException("Shop not found");
    const options: { provider: string; source: "own" | "platform" }[] = [];
    for (const provider of ["sslcommerz", "bkash"] as const) {
      const own = await this.resolveGateway(org.id, provider, "live").catch(() => null);
      if (own && own.row.isEnabled !== false) options.push({ provider, source: "own" });
      const offered = this.wallet.platformProviders().find((p) => p.provider === provider)?.offered === true;
      if (offered && (await this.wallet.isPlatformEnabled(org.id, provider))) {
        options.push({ provider, source: "platform" });
      }
    }
    return { options };
  }
}
