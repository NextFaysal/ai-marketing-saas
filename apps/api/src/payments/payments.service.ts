import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { EmailProvider } from "../messaging/email.provider";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import {
  effectiveBkashConfig, effectiveSslcommerzConfig, ensurePlatformConfig,
  bkashBase, sslcommerzBase, seal, unseal,
  type BkashConfig, type SslcommerzConfig,
} from "../common/platform-config";
import { PLAN_TIERS, planPrices, planYearlyPrices, cycleDays } from "../common/platform-settings";
import { maybeRewardReferral } from "../common/referral";

/**
 * Milestone 36 + 39: subscription payments (SSLCommerz + bKash).
 *
 * Trust rules (non-negotiable):
 * - A browser redirect NEVER activates anything by itself.
 *   SSLCommerz activates ONLY in handleIpn after signature +
 *   validation-API confirmation + exact amount/currency match.
 *   bKash activates ONLY after the server-to-server EXECUTE call
 *   (merchant credentials, documented bKash flow) confirms a
 *   Completed transaction with the exact amount — the callback
 *   query string alone proves nothing.
 * - Activation is idempotent: an already-successful checkout is
 *   a no-op on replay.
 * - Money math order: plan price − coupon discount − org credit
 *   = amount charged. The SaasPayment row records the FULL plan
 *   value; the audit entry breaks down discount/credit/gateway.
 * - On activation the subscription extends by one 30-day period
 *   from the later of now / the current period end.
 */

const PERIOD_DAYS = 30; // monthly quantum; yearly = cycleDays() (B3)

/** SSLCommerz's documented IPN signature scheme: md5 of the
 * store password, append the value of every field named in
 * verify_key (in order), md5 of the whole string. */
export function verifyIpnSignature(storePass: string, body: Record<string, any>): boolean {
  const verifyKey = String(body?.verify_key ?? "");
  const sign = String(body?.verify_sign ?? "");
  if (!verifyKey || !sign) return false;
  let acc = createHash("md5").update(storePass).digest("hex");
  for (const field of verifyKey.split(",").map((s) => s.trim()).filter(Boolean)) {
    acc += String(body[field] ?? "");
  }
  const expected = createHash("md5").update(acc).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(sign.toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface CheckoutResult {
  gatewayUrl?: string;
  tranId: string;
  plan: string;
  amountMinor: string;
  gateway?: string;
  sandbox?: boolean;
  viaCredit?: boolean;
  fullPriceMinor?: string;
  prorationMinor?: string;
  cycle?: string;
  ok?: boolean;
  activated?: boolean;
  currentPeriodEnd?: string;
}

@Injectable()
export class PaymentsService {
  private bkashTokens = new Map<string, { token: string; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly email?: EmailProvider,
  ) {}

  private apiBase(): string {
    return (process.env.API_PUBLIC_URL ?? "http://localhost:4000").replace(/\/$/, "");
  }
  private webBase(): string {
    return (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
  }

  // ---------------- Coupons ----------------

  /** Validate a coupon against a plan + price. Returns the
   * discount in minor units. Throws the honest reason. */
  async validateCoupon(codeRaw: string, plan: string, priceMinor: bigint): Promise<{ coupon: any; discountMinor: bigint }> {
    const code = String(codeRaw ?? "").trim().toUpperCase();
    if (!code) throw new BadRequestException("Coupon code is empty");
    const coupon = await (this.prisma as any).coupon?.findUnique({ where: { code } }).catch(() => null);
    if (!coupon) throw new BadRequestException(`Coupon ${code} was not found`);
    if (!coupon.active) throw new BadRequestException(`Coupon ${code} is not active`);
    if (coupon.expiresAt && new Date(coupon.expiresAt) <= new Date()) throw new BadRequestException(`Coupon ${code} has expired`);
    if (coupon.maxRedemptions != null && Number(coupon.redeemedCount ?? 0) >= Number(coupon.maxRedemptions)) {
      throw new BadRequestException(`Coupon ${code} has reached its redemption limit`);
    }
    if (coupon.planScope && String(coupon.planScope).toUpperCase() !== plan) {
      throw new BadRequestException(`Coupon ${code} does not apply to the ${plan} plan`);
    }
    let discount: bigint;
    if (coupon.kind === "percent") {
      const pct = Number(coupon.value);
      if (!(pct >= 1 && pct <= 90)) throw new BadRequestException(`Coupon ${code} has an invalid percent value`);
      discount = (priceMinor * BigInt(pct)) / 100n;
    } else if (coupon.kind === "fixed") {
      discount = BigInt(coupon.value);
      if (discount > priceMinor) discount = priceMinor;
    } else {
      throw new BadRequestException(`Coupon ${code} has an unknown kind`);
    }
    return { coupon, discountMinor: discount };
  }

  async previewCoupon(organizationId: string, codeRaw: string, planRaw: string) {
    const plan = String(planRaw ?? "").toUpperCase();
    if (!(PLAN_TIERS as readonly string[]).includes(plan) || plan === "FREE") throw new BadRequestException("Unknown plan");
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException("Organization not found");
    const prices = await planPrices(this.prisma as any);
    const priceMinor = BigInt(prices[plan] ?? 0);
    const { discountMinor } = await this.validateCoupon(codeRaw, plan, priceMinor);
    const credit = BigInt(org.creditMinor ?? 0);
    const afterDiscount = priceMinor - discountMinor;
    const creditApplied = credit > afterDiscount ? afterDiscount : credit;
    return {
      code: String(codeRaw).trim().toUpperCase(), plan,
      priceMinor: priceMinor.toString(), discountMinor: discountMinor.toString(),
      creditAppliedMinor: creditApplied.toString(),
      dueMinor: (afterDiscount - creditApplied).toString(),
    };
  }

  async listCoupons() {
    const rows = await (this.prisma as any).coupon.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
    return rows.map((c: any) => ({ ...c, value: Number(c.value) }));
  }

  async createCoupon(actor: { userId?: string; id?: string }, dto: { code: string; kind: string; value: number; planScope?: string; expiresAt?: string; maxRedemptions?: number }, ip?: string) {
    const actorId = actor.id ?? actor.userId ?? "";
    const code = String(dto.code ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9-]{3,24}$/.test(code)) throw new BadRequestException("Coupon code must be 3-24 chars (A-Z, 0-9, dash)");
    const kind = String(dto.kind ?? "");
    if (kind !== "percent" && kind !== "fixed") throw new BadRequestException("kind must be percent | fixed");
    const value = Number(dto.value);
    if (kind === "percent" && (!(value >= 1 && value <= 90))) throw new BadRequestException("percent value must be 1-90");
    if (kind === "fixed" && (!(value > 0))) throw new BadRequestException("fixed value must be a positive amount in minor units");
    let planScope: string | null = null;
    if (dto.planScope) {
      planScope = String(dto.planScope).toUpperCase();
      if (!(PLAN_TIERS as readonly string[]).includes(planScope)) throw new BadRequestException("planScope must be a plan tier");
    }
    let expiresAt: Date | null = null;
    if (dto.expiresAt) {
      expiresAt = new Date(dto.expiresAt);
      if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) throw new BadRequestException("expiresAt must be a future date");
    }
    const existing = await (this.prisma as any).coupon.findUnique({ where: { code } }).catch(() => null);
    if (existing) throw new BadRequestException(`Coupon ${code} already exists`);
    const coupon = await (this.prisma as any).coupon.create({
      data: {
        code, kind, value: Math.round(value), planScope, expiresAt,
        maxRedemptions: dto.maxRedemptions != null ? Math.max(1, Math.round(Number(dto.maxRedemptions))) : null,
        active: true, createdById: actorId,
      },
    });
    await this.audit.log({ userId: actorId, action: "admin.coupon_created", entityType: "Coupon", entityId: coupon.id, metadata: { code, kind, value }, ipAddress: ip });
    return coupon;
  }

  async setCouponActive(actor: { userId?: string; id?: string }, id: string, active: boolean, reasonRaw: string, ip?: string) {
    const actorId = actor.id ?? actor.userId ?? "";
    const reason = String(reasonRaw ?? "").trim();
    if (reason.length < 3) throw new BadRequestException("A reason is required for this admin action (it is stored in the audit trail)");
    const coupon = await (this.prisma as any).coupon.findUnique({ where: { id } });
    if (!coupon) throw new NotFoundException("Coupon not found");
    const updated = await (this.prisma as any).coupon.update({ where: { id }, data: { active } });
    await this.audit.log({ userId: actorId, action: "admin.coupon_status_changed", entityType: "Coupon", entityId: id, metadata: { code: coupon.code, active, reason }, ipAddress: ip });
    return updated;
  }

  // ---------------- Checkout creation ----------------

  async createCheckout(
    organizationId: string,
    actor: { userId: string; email: string },
    planRaw: string,
    phoneRaw: string,
    opts?: { couponCode?: string; gateway?: string; cycle?: string },
  ): Promise<CheckoutResult> {
    await ensurePlatformConfig(this.prisma as any);
    const gateway = String(opts?.gateway ?? "sslcommerz").toLowerCase();
    if (gateway !== "sslcommerz" && gateway !== "bkash") throw new BadRequestException("gateway must be sslcommerz | bkash");
    const sslCfg = gateway === "sslcommerz" ? effectiveSslcommerzConfig() : null;
    const bkashCfg = gateway === "bkash" ? effectiveBkashConfig() : null;
    if (gateway === "sslcommerz" && !sslCfg) {
      throw new BadRequestException("Online payment (SSLCommerz) is not configured by the platform team yet. Please use the plan-change request on the Billing page — the team will confirm your payment manually.");
    }
    if (gateway === "bkash" && !bkashCfg) {
      throw new BadRequestException("bKash payment is not configured by the platform team yet. Please choose SSLCommerz or use the plan-change request on the Billing page.");
    }
    const plan = String(planRaw ?? "").toUpperCase();
    if (!(PLAN_TIERS as readonly string[]).includes(plan)) throw new BadRequestException("Unknown plan");
    if (plan === "FREE") throw new BadRequestException("The FREE plan needs no payment.");
    const phone = String(phoneRaw ?? "").trim();
    if (!/^[+\d][\d\s-]{10,14}$/.test(phone)) {
      throw new BadRequestException("A valid phone number is required for the payment receipt.");
    }
    // Billing Package B3: the cycle picks the price book.
    const cycle = opts?.cycle === "yearly" ? "yearly" : "monthly";
    const prices = cycle === "yearly" ? await planYearlyPrices(this.prisma as any) : await planPrices(this.prisma as any);
    const priceMinor = BigInt(prices[plan] ?? 0);
    if (priceMinor <= 0n) throw new BadRequestException("This plan has no price configured. Please ask the platform team.");
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException("Organization not found");
    const profile = await (this.prisma as any).businessProfile.findUnique({ where: { organizationId } }).catch(() => null);

    // Billing Package B2: plan direction + proration. With a
    // live period, a LOWER plan is a scheduled change, never
    // an instant checkout; a HIGHER plan credits the unused
    // part of the current plan (30-day periods).
    const rank = (p: string) => (PLAN_TIERS as readonly string[]).indexOf(p);
    const currentSub = await (this.prisma as any).subscription.findFirst({
      where: { organizationId }, orderBy: { createdAt: "desc" },
    }).catch(() => null);
    const nowMs = Date.now();
    const periodLive = !!currentSub && ["ACTIVE", "TRIALING"].includes(currentSub.status)
      && currentSub.currentPeriodEnd && new Date(currentSub.currentPeriodEnd).getTime() > nowMs;
    let prorationMinor = 0n;
    if (periodLive) {
      if (rank(plan) < rank(String(currentSub.plan))) {
        throw new BadRequestException("Downgrades take effect at the period end — use the scheduled plan change on the Billing page (প্ল্যান বদল নির্ধারণ) so no paid days are lost.");
      }
      if (rank(plan) > rank(String(currentSub.plan))) {
        // The unused value is priced in the CURRENT
        // subscription's own cycle book over its own period
        // length (B3: a yearly period prorates over 365).
        const curCycle = String(currentSub.billingCycle ?? "monthly");
        const curPrices = curCycle === "yearly" ? await planYearlyPrices(this.prisma as any) : await planPrices(this.prisma as any);
        const oldPrice = BigInt(curPrices[String(currentSub.plan)] ?? 0);
        const remainingMs = new Date(currentSub.currentPeriodEnd).getTime() - nowMs;
        const raw = (oldPrice * BigInt(Math.max(0, remainingMs))) / BigInt(cycleDays(curCycle) * 86400000);
        prorationMinor = raw > priceMinor ? priceMinor : raw;
      }
    }

    let discountMinor = 0n;
    let couponCode: string | null = null;
    if (opts?.couponCode) {
      const v = await this.validateCoupon(opts.couponCode, plan, priceMinor);
      discountMinor = v.discountMinor;
      couponCode = v.coupon.code;
    }
    const afterDiscount = priceMinor - discountMinor - prorationMinor;
    const creditBalance = BigInt(org.creditMinor ?? 0);
    const creditApplied = creditBalance > afterDiscount ? afterDiscount : creditBalance;
    const dueMinor = afterDiscount - creditApplied;

    const tranId = `${gateway === "bkash" ? "QB" : "QC"}${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString("hex").toUpperCase()}`;
    const checkout = await (this.prisma as any).planCheckout.create({
      data: {
        organizationId, plan, amountMinor: dueMinor, currency: "BDT", tranId,
        status: "initiated", createdById: actor.userId, gateway,
        creditAppliedMinor: creditApplied, discountMinor, couponCode, prorationMinor, cycle,
      },
    });

    if (dueMinor === 0n) {
      // Fully covered by coupon/credit/proration: no gateway
      // involved, nothing external to trust — activate
      // directly and say so.
      const out = await this.activate(checkout, "—", { via: "coupon_credit" });
      return { ...out, viaCredit: true, tranId, plan, amountMinor: "0", fullPriceMinor: priceMinor.toString(), prorationMinor: prorationMinor.toString(), cycle };
    }

    if (gateway === "bkash") {
      const out = await this.startBkashCheckout(checkout, bkashCfg!, phone, dueMinor, tranId, plan);
      return { ...out, prorationMinor: prorationMinor.toString(), cycle };
    }
    const out = await this.startSslCheckout(checkout, sslCfg!, org, profile, actor, phone, dueMinor, tranId, plan);
    return { ...out, prorationMinor: prorationMinor.toString(), cycle };
  }

  private async startSslCheckout(checkout: any, cfg: SslcommerzConfig, org: any, profile: any, actor: { email: string }, phone: string, dueMinor: bigint, tranId: string, plan: string) {
    const form = new URLSearchParams({
      store_id: cfg.storeId,
      store_passwd: cfg.storePass,
      total_amount: (Number(dueMinor) / 100).toFixed(2),
      currency: "BDT",
      tran_id: tranId,
      success_url: `${this.apiBase()}/public/payments/sslcommerz/return`,
      fail_url: `${this.apiBase()}/public/payments/sslcommerz/return`,
      cancel_url: `${this.apiBase()}/public/payments/sslcommerz/return`,
      ipn_url: `${this.apiBase()}/public/payments/sslcommerz/ipn`,
      product_name: `AI Marketing SaaS — ${plan} plan (30 days)`,
      product_category: "subscription",
      product_profile: "general",
      cus_name: String(org.name ?? "Customer").slice(0, 50),
      cus_email: profile?.contactEmail ?? actor.email,
      cus_phone: phone,
      cus_add1: "Bangladesh",
      cus_city: "Dhaka",
      cus_country: "Bangladesh",
      ship_name: String(org.name ?? "Customer").slice(0, 50),
      ship_add1: "Bangladesh",
      ship_city: "Dhaka",
      ship_country: "Bangladesh",
      shipping_method: "NO",
      value_a: checkout.organizationId,
      value_b: plan,
      value_c: checkout.createdById,
    });
    let gateway: any = null;
    try {
      const res = await fetch(`${sslcommerzBase(cfg)}/gwprocess/v4/api.php`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        signal: AbortSignal.timeout(20_000),
      });
      gateway = await res.json().catch(() => null);
    } catch (e) {
      await (this.prisma as any).planCheckout.update({
        where: { id: checkout.id },
        data: { status: "failed", gatewayDetail: { error: e instanceof Error ? e.message : "network error" } },
      });
      throw new BadRequestException("Could not reach the payment gateway. Please try again later.");
    }
    if (!gateway || gateway.status !== "SUCCESS" || !gateway.GatewayPageURL) {
      await (this.prisma as any).planCheckout.update({
        where: { id: checkout.id },
        data: { status: "failed", gatewayDetail: gateway ?? { error: "empty gateway response" } },
      });
      throw new BadRequestException(`The payment gateway refused to start this payment: ${gateway?.failed_reason ?? gateway?.status ?? "unknown error"}`);
    }
    await (this.prisma as any).planCheckout.update({
      where: { id: checkout.id },
      data: { gatewayDetail: { sessionkey: gateway.sessionkey, sandbox: cfg.sandbox } },
    });
    return {
      gatewayUrl: String(gateway.GatewayPageURL),
      tranId,
      plan,
      amountMinor: dueMinor.toString(),
      gateway: "sslcommerz",
      sandbox: cfg.sandbox,
    };
  }

  // ---------------- bKash tokenized checkout ----------------

  private async bkashToken(cfg: BkashConfig): Promise<string> {
    const cached = this.bkashTokens.get(cfg.appKey);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    let res: any = null;
    try {
      const r = await fetch(`${bkashBase(cfg)}/token/grant`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", username: cfg.username, password: cfg.password },
        body: JSON.stringify({ app_key: cfg.appKey, app_secret: cfg.appSecret }),
        signal: AbortSignal.timeout(20_000),
      });
      res = await r.json().catch(() => null);
    } catch (e) {
      throw new BadRequestException(`Could not reach bKash: ${e instanceof Error ? e.message : "network error"}`);
    }
    if (!res?.id_token) {
      throw new BadRequestException(`bKash token grant failed: ${res?.statusMessage ?? res?.errorMessage ?? "unknown error"}`);
    }
    const ttlMs = Math.max(60, Number(res.expires_in ?? 3600) - 120) * 1000;
    this.bkashTokens.set(cfg.appKey, { token: String(res.id_token), expiresAt: Date.now() + ttlMs });
    return String(res.id_token);
  }

  private async bkashCall(cfg: BkashConfig, path: string, body: Record<string, unknown>): Promise<any> {
    const token = await this.bkashToken(cfg);
    try {
      const r = await fetch(`${bkashBase(cfg)}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: token, "X-APP-Key": cfg.appKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      return await r.json().catch(() => null);
    } catch (e) {
      throw new BadRequestException(`Could not reach bKash: ${e instanceof Error ? e.message : "network error"}`);
    }
  }

  private async startBkashCheckout(checkout: any, cfg: BkashConfig, phone: string, dueMinor: bigint, tranId: string, plan: string) {
    const created = await this.bkashCall(cfg, "/checkout/create", {
      mode: "0011",
      payerReference: phone,
      callbackURL: `${this.apiBase()}/public/payments/bkash/callback`,
      amount: (Number(dueMinor) / 100).toFixed(2),
      currency: "BDT",
      intent: "sale",
      merchantInvoiceNumber: tranId,
    });
    if (!created || String(created.statusCode) !== "0000" || !created.bkashURL || !created.paymentID) {
      await (this.prisma as any).planCheckout.update({
        where: { id: checkout.id },
        data: { status: "failed", gatewayDetail: created ?? { error: "empty bKash response" } },
      });
      throw new BadRequestException(`bKash refused to start this payment: ${created?.statusMessage ?? "unknown error"}`);
    }
    await (this.prisma as any).planCheckout.update({
      where: { id: checkout.id },
      data: { gatewayDetail: { paymentID: String(created.paymentID), sandbox: cfg.sandbox } },
    });
    return {
      gatewayUrl: String(created.bkashURL),
      tranId,
      plan,
      amountMinor: dueMinor.toString(),
      gateway: "bkash",
      sandbox: cfg.sandbox,
    };
  }

  /** bKash redirects the browser back with paymentID + status.
   * status=success alone activates NOTHING: the server-to-server
   * execute call must confirm a Completed transaction with the
   * exact amount before activate() runs. */
  async handleBkashCallback(query: Record<string, any>): Promise<string> {
    const paymentID = String(query?.paymentID ?? "");
    const status = String(query?.status ?? "").toLowerCase();
    const billing = (flag: string) => `${this.webBase()}/dashboard/billing?payment=${flag}`;
    if (!paymentID) return billing("unknown");
    const candidates = await (this.prisma as any).planCheckout.findMany({
      where: { gateway: "bkash", status: "initiated" }, orderBy: { createdAt: "desc" }, take: 200,
    }).catch(() => []);
    const checkout = (candidates as any[]).find((c) => String(c.gatewayDetail?.paymentID ?? "") === paymentID);
    if (!checkout) return billing("unknown");
    if (status !== "success") {
      await (this.prisma as any).planCheckout.update({
        where: { id: checkout.id },
        data: { status: status === "cancel" ? "cancelled" : "failed", gatewayDetail: { ...(checkout.gatewayDetail ?? {}), callbackStatus: status } },
      });
      return billing(status === "cancel" ? "cancelled" : "failed");
    }
    await ensurePlatformConfig(this.prisma as any);
    const cfg = effectiveBkashConfig();
    if (!cfg) return billing("unknown");
    const executed = await this.bkashCall(cfg, "/checkout/execute", { paymentID }).catch(() => null);
    if (!executed || String(executed.statusCode) !== "0000" || String(executed.transactionStatus) !== "Completed") {
      return billing("failed");
    }
    const confirmedMinor = Math.round(Number(executed.amount) * 100);
    if (!Number.isFinite(confirmedMinor) || confirmedMinor !== Number(checkout.amountMinor)) {
      return billing("failed");
    }
    await this.activate(checkout, String(executed.trxID ?? paymentID), { via: "bkash_execute", paymentID });
    return billing("received");
  }

  // ---------------- SSLCommerz IPN + validation ----------------

  /** Gateway -> validation API: the only confirmation we trust. */
  async validateWithGateway(cfg: SslcommerzConfig, valId: string): Promise<any | null> {
    if (!valId) return null;
    const url = `${sslcommerzBase(cfg)}/validator/api/validationserverAPI.php?val_id=${encodeURIComponent(valId)}&store_id=${encodeURIComponent(cfg.storeId)}&store_passwd=${encodeURIComponent(cfg.storePass)}&v=1&format=json`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      return await res.json().catch(() => null);
    } catch {
      return null;
    }
  }

  private async confirmSslAndActivate(checkout: any, valId: string, validation: any) {
    if (!validation || !["VALID", "VALIDATED"].includes(String(validation.status ?? "").toUpperCase())) {
      return { ok: false, reason: "gateway validation did not confirm this payment" };
    }
    if (validation.tran_id && String(validation.tran_id) !== checkout.tranId) {
      return { ok: false, reason: "validated transaction does not match this checkout" };
    }
    const confirmedMinor = Math.round(Number(validation.amount) * 100);
    if (!Number.isFinite(confirmedMinor) || confirmedMinor !== Number(checkout.amountMinor)) {
      return { ok: false, reason: "confirmed amount does not match this checkout" };
    }
    if (String(validation.currency ?? "BDT").toUpperCase() !== String(checkout.currency).toUpperCase()) {
      return { ok: false, reason: "confirmed currency does not match this checkout" };
    }
    return this.activate(checkout, valId);
  }

  async handleIpn(body: Record<string, any>) {
    const tranId = String(body?.tran_id ?? "");
    if (!tranId) return { ok: false, reason: "missing tran_id" };
    const checkout = await (this.prisma as any).planCheckout.findUnique({ where: { tranId } });
    if (!checkout) return { ok: false, ignored: true, reason: "unknown tran_id" };
    await ensurePlatformConfig(this.prisma as any);
    const cfg = effectiveSslcommerzConfig();
    if (!cfg) return { ok: false, reason: "gateway not configured" };
    if (!verifyIpnSignature(cfg.storePass, body)) {
      return { ok: false, reason: "signature verification failed" };
    }
    const status = String(body?.status ?? "").toUpperCase();
    if (status === "FAILED" || status === "CANCELLED") {
      if (checkout.status === "initiated") {
        await (this.prisma as any).planCheckout.update({
          where: { id: checkout.id },
          data: { status: status === "FAILED" ? "failed" : "cancelled", gatewayDetail: { ipnStatus: status } },
        });
      }
      return { ok: true, recorded: status.toLowerCase() };
    }
    if (status !== "VALID" && status !== "VALIDATED") {
      return { ok: false, reason: `unexpected IPN status: ${status || "(empty)"}` };
    }
    if (checkout.status === "success") return { ok: true, alreadyProcessed: true };
    const valId = String(body?.val_id ?? "");
    const validation = await this.validateWithGateway(cfg, valId);
    return this.confirmSslAndActivate(checkout, valId, validation);
  }

  // ---------------- Admin: reconciliation ----------------

  async listCheckouts(opts?: { status?: string; organizationId?: string; take?: number }) {
    const where: any = {};
    if (opts?.status) where.status = opts.status;
    if (opts?.organizationId) where.organizationId = opts.organizationId;
    const rows = await (this.prisma as any).planCheckout.findMany({
      where, orderBy: { createdAt: "desc" }, take: Math.min(200, Math.max(1, opts?.take ?? 100)),
    });
    const orgIds = [...new Set((rows as any[]).map((r) => r.organizationId))];
    const orgs = orgIds.length
      ? await (this.prisma as any).organization.findMany({ where: { id: { in: orgIds } } }).catch(() => [])
      : [];
    const nameOf = new Map((orgs as any[]).map((o) => [o.id, o.name]));
    const now = Date.now();
    return (rows as any[]).map((r) => ({
      id: r.id, organizationId: r.organizationId, organizationName: nameOf.get(r.organizationId) ?? null,
      plan: r.plan, gateway: r.gateway ?? "sslcommerz", tranId: r.tranId, status: r.status,
      amountMinor: BigInt(r.amountMinor ?? 0).toString(),
      creditAppliedMinor: BigInt(r.creditAppliedMinor ?? 0).toString(),
      discountMinor: BigInt(r.discountMinor ?? 0).toString(),
      couponCode: r.couponCode ?? null, valId: r.valId ?? null,
      createdAt: r.createdAt, completedAt: r.completedAt ?? null,
      stuck: r.status === "initiated" && now - new Date(r.createdAt).getTime() > 3600000,
    }));
  }

  /** Re-check ONE checkout against its gateway. Activates only
   * through the same confirmation path as the live webhook. */
  async reconcileCheckout(checkoutId: string) {
    const checkout = await (this.prisma as any).planCheckout.findUnique({ where: { id: checkoutId } });
    if (!checkout) throw new NotFoundException("Checkout not found");
    if (checkout.status === "success") return { ok: true, alreadyProcessed: true, status: checkout.status };
    if (checkout.status !== "initiated") return { ok: false, status: checkout.status, reason: `checkout is ${checkout.status} — nothing to reconcile` };
    await ensurePlatformConfig(this.prisma as any);
    if ((checkout.gateway ?? "sslcommerz") === "bkash") {
      const cfg = effectiveBkashConfig();
      if (!cfg) return { ok: false, reason: "bKash is not configured" };
      const paymentID = String(checkout.gatewayDetail?.paymentID ?? "");
      if (!paymentID) return { ok: false, reason: "checkout has no bKash paymentID" };
      const q = await this.bkashCall(cfg, "/checkout/payment/status", { paymentID }).catch(() => null);
      if (!q) return { ok: false, reason: "bKash query failed" };
      if (String(q.transactionStatus) !== "Completed") {
        return { ok: false, status: "initiated", gatewayStatus: String(q.transactionStatus ?? "unknown"), reason: "bKash does not show a completed payment" };
      }
      const confirmedMinor = Math.round(Number(q.amount) * 100);
      if (!Number.isFinite(confirmedMinor) || confirmedMinor !== Number(checkout.amountMinor)) {
        return { ok: false, reason: "confirmed amount does not match this checkout" };
      }
      const out = await this.activate(checkout, String(q.trxID ?? paymentID), { via: "bkash_reconcile", paymentID });
      return { ...out, reconciled: true };
    }
    const cfg = effectiveSslcommerzConfig();
    if (!cfg) return { ok: false, reason: "SSLCommerz is not configured" };
    const url = `${sslcommerzBase(cfg)}/validator/api/merchantTransIDvalidationAPI.php?tran_id=${encodeURIComponent(checkout.tranId)}&store_id=${encodeURIComponent(cfg.storeId)}&store_passwd=${encodeURIComponent(cfg.storePass)}&format=json`;
    let report: any = null;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      report = await res.json().catch(() => null);
    } catch {
      return { ok: false, reason: "gateway query failed" };
    }
    const elements: any[] = Array.isArray(report?.element) ? report.element : report?.element ? [report.element] : [];
    const el = elements.find((e) => String(e.tran_id) === checkout.tranId);
    if (!el) return { ok: false, status: "initiated", reason: "the gateway has no record of this transaction" };
    const elStatus = String(el.status ?? "").toUpperCase();
    if (elStatus !== "VALID" && elStatus !== "VALIDATED") {
      return { ok: false, status: "initiated", gatewayStatus: elStatus, reason: `gateway reports ${elStatus || "no status"}` };
    }
    const validation = await this.validateWithGateway(cfg, String(el.val_id ?? ""));
    const out = await this.confirmSslAndActivate(checkout, String(el.val_id ?? ""), validation);
    return { ...(out as any), reconciled: (out as any).ok === true };
  }

  // ---------------- Shared activation ----------------

  private async activate(checkout: any, refId: string, detail?: Record<string, unknown>) {
    const now = new Date();
    // Milestone 41: a referral reward fires on the org's FIRST payment.
    const priorPayments = (await (this.prisma as any).saasPayment.count?.({
      where: { organizationId: checkout.organizationId },
    })?.catch?.(() => 1)) ?? 1;
    const creditApplied = BigInt(checkout.creditAppliedMinor ?? 0);
    const discount = BigInt(checkout.discountMinor ?? 0);
    const proration = BigInt(checkout.prorationMinor ?? 0);
    const fullValue = BigInt(checkout.amountMinor ?? 0) + creditApplied + discount + proration;
    const gateway = String(checkout.gateway ?? "sslcommerz");
    const sub = await (this.prisma as any).subscription.findFirst({
      where: { organizationId: checkout.organizationId }, orderBy: { createdAt: "desc" },
    });
    // Billing Package B2: an UPGRADE that consumed proration
    // starts a FRESH period now — the unused old-plan days
    // were already returned as a discount, so extending from
    // the old period end would pay them twice. Renewals keep
    // extending from the current end. Any confirmed payment
    // also clears a scheduled plan change.
    const proratedUpgrade = BigInt(checkout.prorationMinor ?? 0) > 0n && sub && String(sub.plan) !== String(checkout.plan);
    const base = !proratedUpgrade && sub?.currentPeriodEnd && new Date(sub.currentPeriodEnd) > now ? new Date(sub.currentPeriodEnd) : now;
    // B3: the bought cycle sets the period length (365 for
    // yearly) and is remembered on the subscription.
    const newEnd = new Date(base.getTime() + cycleDays(checkout.cycle) * 86400000);
    const boughtCycle = String(checkout.cycle ?? "monthly");
    if (sub) {
      await (this.prisma as any).subscription.update({
        where: { id: sub.id },
        data: { plan: checkout.plan, status: "ACTIVE", currentPeriodEnd: newEnd, pendingPlan: null, pendingPlanAt: null, billingCycle: boughtCycle },
      });
    } else {
      await (this.prisma as any).subscription.create({
        data: { organizationId: checkout.organizationId, plan: checkout.plan, status: "ACTIVE", currentPeriodEnd: newEnd, billingCycle: boughtCycle },
      });
    }
    const paymentRow = await (this.prisma as any).saasPayment.create({
      data: {
        organizationId: checkout.organizationId,
        amountMinor: fullValue,
        currency: checkout.currency,
        method: gateway === "bkash" ? "bkash_gateway" : "sslcommerz",
        reference: checkout.tranId,
        periodEnd: newEnd,
        recordedById: checkout.createdById,
        note: detail?.via === "coupon_credit"
          ? "Paid in full by coupon/credit — no gateway charge"
          : gateway === "bkash"
            ? `bKash online payment (trx ${refId})`
            : `SSLCommerz online payment (val_id ${refId})`,
      },
    });
    if (creditApplied > 0n) {
      const org = await (this.prisma as any).organization.findUnique({ where: { id: checkout.organizationId } }).catch(() => null);
      const balance = BigInt(org?.creditMinor ?? 0);
      await (this.prisma as any).organization.update({
        where: { id: checkout.organizationId },
        data: { creditMinor: balance > creditApplied ? balance - creditApplied : 0n },
      }).catch(() => null);
      // Referral Advanced R1: the spend joins the credit ledger.
      await (this.prisma as any).creditLedger?.create?.({
        data: { organizationId: checkout.organizationId, deltaMinor: -creditApplied, reason: "checkout_credit_spend" },
      })?.catch?.(() => null);
    }
    if (discount > 0n && checkout.couponCode) {
      const coupon = await (this.prisma as any).coupon?.findUnique({ where: { code: checkout.couponCode } }).catch(() => null);
      if (coupon) {
        try {
          await (this.prisma as any).couponRedemption?.create({
            data: { couponId: coupon.id, organizationId: checkout.organizationId, checkoutId: checkout.id, amountMinor: discount },
          });
          await (this.prisma as any).coupon?.update({
            where: { id: coupon.id }, data: { redeemedCount: Number(coupon.redeemedCount ?? 0) + 1 },
          });
        } catch { /* redemption bookkeeping never blocks an activation the gateway confirmed */ }
      }
    }
    await (this.prisma as any).planCheckout.update({
      where: { id: checkout.id },
      data: {
        status: "success", completedAt: now,
        ...(refId && refId !== "—" ? { valId: refId } : {}),
        ...(detail ? { gatewayDetail: { ...(checkout.gatewayDetail ?? {}), ...detail } } : {}),
      },
    });
    await this.audit.log({
      organizationId: checkout.organizationId, userId: checkout.createdById,
      action: "billing.online_payment_completed", entityType: "PlanCheckout", entityId: checkout.id,
      metadata: {
        plan: checkout.plan, gateway, chargedMinor: BigInt(checkout.amountMinor ?? 0).toString(),
        creditAppliedMinor: creditApplied.toString(), discountMinor: discount.toString(), prorationMinor: proration.toString(),
        couponCode: checkout.couponCode ?? null, tranId: checkout.tranId, periodEnd: newEnd.toISOString(),
      },
    });
    if (priorPayments === 0) {
      try { await maybeRewardReferral(this.prisma as any, this.audit, checkout.organizationId, { amountMinor: fullValue, plan: String(checkout.plan) }); }
      catch { /* a referral reward must never break a confirmed payment */ }
    }
    // Billing Package B5: email the invoice (text form, the
    // same content as the printable invoice) to OWNER/ADMIN
    // members + the profile's billing recipients. A courtesy
    // copy only — a mail failure never affects the payment,
    // and the send is audited only when it actually went out.
    if (this.email) {
      try {
        const p = this.prisma as any;
        const memberships = (await p.membership.findMany({
          where: { organizationId: checkout.organizationId, role: { in: ["OWNER", "ADMIN"] }, status: "ACTIVE" }, include: { user: true },
        }).catch(() => [])) as any[];
        const prof = (await p.businessProfile?.findUnique?.({ where: { organizationId: checkout.organizationId } })?.catch?.(() => null)) ?? null;
        const extra: string[] = Array.isArray(prof?.billingEmails) ? prof.billingEmails : [];
        const recipients = [...new Set([...memberships.map((m) => m.user?.email).filter(Boolean), ...extra])] as string[];
        if (recipients.length && paymentRow?.id) {
          const fmt = (minor: bigint) => (Number(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
          const text = [
            `ইনভয়েস — ${checkout.plan} সাবস্ক্রিপশন`,
            ``,
            `ইনভয়েস নং: INV-${String(paymentRow.id).slice(-8).toUpperCase()}`,
            `প্ল্যান: ${checkout.plan} (${boughtCycle === "yearly" ? "বার্ষিক" : "মাসিক"})`,
            `পরিমাণ: BDT ${fmt(fullValue)}`,
            `মেয়াদ শেষ: ${newEnd.toISOString().slice(0, 10)}`,
            `রেফারেন্স: ${checkout.tranId}`,
            ``,
            `প্রিন্টযোগ্য ইনভয়েসটি Billing পেজের পেমেন্ট ইতিহাস থেকে যেকোনো সময় ডাউনলোড করা যাবে।`,
            `— Qosprey AI Marketing টিম`,
          ].join("\n");
          let sent = 0;
          for (const to of recipients) {
            try { await this.email.send({ to, subject: `ইনভয়েস INV-${String(paymentRow.id).slice(-8).toUpperCase()} — ${checkout.plan}`, text }); sent++; }
            catch { /* counted below — partial sends stay honest */ }
          }
          if (sent > 0) {
            await this.audit.log({
              organizationId: checkout.organizationId, action: "billing.invoice_emailed",
              entityType: "SaasPayment", entityId: paymentRow.id, metadata: { recipients: sent, tranId: checkout.tranId },
            });
          }
        }
      } catch { /* courtesy copy only */ }
    }
    return { ok: true, activated: true, plan: checkout.plan, currentPeriodEnd: newEnd.toISOString() };
  }

  /**
   * Billing Package B2: schedule a downgrade — or FREE,
   * which is a cancellation — for the current period's end.
   * Nothing changes today; the subscription sweep applies
   * the pending plan when the period closes, so no paid
   * day is ever lost. Upgrades are NOT schedulable: they
   * are immediate checkouts with proration.
   */
  async schedulePlanChange(organizationId: string, actorId: string, planRaw: string) {
    const plan = String(planRaw ?? "").toUpperCase();
    if (!(PLAN_TIERS as readonly string[]).includes(plan)) throw new BadRequestException("Unknown plan");
    const sub = await (this.prisma as any).subscription.findFirst({
      where: { organizationId }, orderBy: { createdAt: "desc" },
    }).catch(() => null);
    if (!sub) throw new BadRequestException("No subscription to change");
    const rank = (p: string) => (PLAN_TIERS as readonly string[]).indexOf(p);
    if (rank(plan) >= rank(String(sub.plan))) {
      throw new BadRequestException("Only a lower plan (or FREE to cancel) can be scheduled — upgrades are immediate via checkout.");
    }
    if (!sub.currentPeriodEnd) throw new BadRequestException("There is no live period to schedule against");
    const updated = await (this.prisma as any).subscription.update({
      where: { id: sub.id }, data: { pendingPlan: plan, pendingPlanAt: new Date() },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "billing.plan_change_scheduled",
      entityType: "Subscription", entityId: sub.id,
      metadata: { from: String(sub.plan), to: plan, effectiveAt: new Date(sub.currentPeriodEnd).toISOString() },
    });
    return { ok: true, pendingPlan: plan, effectiveAt: new Date(sub.currentPeriodEnd).toISOString(), subscriptionId: updated.id };
  }

  async cancelScheduledPlanChange(organizationId: string, actorId: string) {
    const sub = await (this.prisma as any).subscription.findFirst({
      where: { organizationId }, orderBy: { createdAt: "desc" },
    }).catch(() => null);
    if (!sub?.pendingPlan) throw new BadRequestException("No scheduled plan change to cancel");
    await (this.prisma as any).subscription.update({
      where: { id: sub.id }, data: { pendingPlan: null, pendingPlanAt: null },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "billing.plan_change_schedule_cancelled",
      entityType: "Subscription", entityId: sub.id, metadata: { was: String(sub.pendingPlan) },
    });
    return { ok: true, pendingPlan: null };
  }

  // ---------------- Billing Package B4: bKash auto-renew ----------------
  // Consent once via bKash's tokenized AGREEMENT flow; the
  // agreement id is stored sealed and never leaves the
  // server. Charges run through the normal PlanCheckout +
  // activate() path and count ONLY on bKash's own Completed
  // confirmation after execute — the same discipline as the
  // one-off checkout. Endpoint shapes follow bKash's
  // documented tokenized API (agreement/create,
  // agreement/execute, agreement/cancel, checkout/create
  // carrying agreementID); they must be confirmed against
  // the platform's real merchant sandbox before production
  // use (no live bKash merchant exists in development).

  async getAutoRenew(organizationId: string) {
    const row = await (this.prisma as any).autoRenewAgreement?.findUnique?.({ where: { organizationId } })?.catch?.(() => null) ?? null;
    if (!row) return null;
    return {
      status: row.status as string,
      payerReference: row.payerReference as string,
      lastChargeAt: row.lastChargeAt ?? null,
      lastError: row.lastError ?? null,
    };
  }

  async startAutoRenew(organizationId: string, actor: { userId: string }, phoneRaw: string): Promise<{ bkashURL: string }> {
    await ensurePlatformConfig(this.prisma as any);
    const cfg = effectiveBkashConfig();
    if (!cfg) throw new BadRequestException("bKash is not configured by the platform team yet, so auto-renew cannot be enabled.");
    const phone = String(phoneRaw ?? "").trim();
    if (!/^01\d{9}$/.test(phone.replace(/[\s-]/g, ""))) throw new BadRequestException("A valid bKash number (01XXXXXXXXX) is required.");
    const payerReference = phone.replace(/[\s-]/g, "");
    const created = await this.bkashCall(cfg, "/checkout/agreement/create", {
      payerReference,
      callbackURL: `${this.apiBase()}/public/payments/bkash/agreement/callback`,
    });
    if (!created || String(created.statusCode) !== "0000" || !created.bkashURL || !created.paymentID) {
      throw new BadRequestException(`bKash refused to start the agreement: ${created?.statusMessage ?? "unknown error"}`);
    }
    const data = { gateway: "bkash", payerReference, pendingPaymentId: String(created.paymentID), status: "pending", lastError: null as string | null };
    const existing = await (this.prisma as any).autoRenewAgreement.findUnique({ where: { organizationId } }).catch(() => null);
    if (existing) {
      await (this.prisma as any).autoRenewAgreement.update({ where: { organizationId }, data });
    } else {
      await (this.prisma as any).autoRenewAgreement.create({ data: { organizationId, ...data } });
    }
    await this.audit.log({
      organizationId, userId: actor.userId, action: "billing.autorenew_started",
      entityType: "AutoRenewAgreement", entityId: organizationId, metadata: { payerReference },
    });
    return { bkashURL: String(created.bkashURL) };
  }

  /** bKash returns the browser with paymentID + status.
   * Nothing is trusted from the redirect: the agreement is
   * EXECUTED server-to-server and stored only when bKash
   * confirms it. */
  async handleBkashAgreementCallback(query: Record<string, any>): Promise<string> {
    const paymentID = String(query?.paymentID ?? "");
    const status = String(query?.status ?? "").toLowerCase();
    const fail = `${this.webBase()}/dashboard/billing?autorenew=failed`;
    if (!paymentID) return fail;
    const row = await (this.prisma as any).autoRenewAgreement.findFirst({ where: { pendingPaymentId: paymentID } }).catch(() => null);
    if (!row) return fail;
    if (status !== "success") {
      await (this.prisma as any).autoRenewAgreement.update({
        where: { id: row.id }, data: { status: "failed", lastError: `bKash agreement ${status || "abandoned"} by user`, pendingPaymentId: null },
      }).catch(() => null);
      return fail;
    }
    const cfg = effectiveBkashConfig();
    if (!cfg) return fail;
    const executed = await this.bkashCall(cfg, "/checkout/agreement/execute", { paymentID }).catch(() => null);
    const agreementID = executed?.agreementID ? String(executed.agreementID) : "";
    if (!executed || String(executed.statusCode) !== "0000" || !agreementID) {
      await (this.prisma as any).autoRenewAgreement.update({
        where: { id: row.id }, data: { status: "failed", lastError: executed?.statusMessage ?? "agreement execute failed", pendingPaymentId: null },
      }).catch(() => null);
      return fail;
    }
    await (this.prisma as any).autoRenewAgreement.update({
      where: { id: row.id },
      data: { status: "active", agreementIdSealed: seal(agreementID), pendingPaymentId: null, lastError: null },
    });
    await this.audit.log({
      organizationId: row.organizationId, action: "billing.autorenew_active",
      entityType: "AutoRenewAgreement", entityId: row.id, metadata: { payerReference: row.payerReference },
    });
    return `${this.webBase()}/dashboard/billing?autorenew=active`;
  }

  async cancelAutoRenew(organizationId: string, actorId: string) {
    const row = await (this.prisma as any).autoRenewAgreement.findUnique({ where: { organizationId } }).catch(() => null);
    if (!row || row.status === "cancelled") throw new BadRequestException("Auto-renew is not active for this workspace");
    const cfg = effectiveBkashConfig();
    const agreementID = row.agreementIdSealed ? unseal(row.agreementIdSealed) : undefined;
    let gatewayCancelled = false;
    if (cfg && agreementID) {
      const res = await this.bkashCall(cfg, "/checkout/agreement/cancel", { agreementID }).catch(() => null);
      gatewayCancelled = !!res && String(res.statusCode) === "0000";
    }
    await (this.prisma as any).autoRenewAgreement.update({
      where: { id: row.id }, data: { status: "cancelled", agreementIdSealed: null },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "billing.autorenew_cancelled",
      entityType: "AutoRenewAgreement", entityId: row.id, metadata: { gatewayCancelled },
    });
    return { ok: true, gatewayCancelled };
  }

  /**
   * The auto_renew job's entry point. Charges the agreement
   * when the current period ends within 24h. The money
   * order mirrors checkout (cycle price − account credit;
   * no coupons for automated charges). Any failure is
   * recorded on the agreement + audited and reported — the
   * subscription then follows the normal sweep/dunning
   * path; nothing is silently retried or faked.
   */
  async chargeAutoRenew(organizationId: string): Promise<Record<string, unknown>> {
    await ensurePlatformConfig(this.prisma as any);
    const row = await (this.prisma as any).autoRenewAgreement?.findUnique?.({ where: { organizationId } })?.catch?.(() => null) ?? null;
    if (!row || row.status !== "active") return { charged: false, reason: "no_active_agreement" };
    const cfg = effectiveBkashConfig();
    if (!cfg) return { charged: false, reason: "bkash_not_configured" };
    const agreementID = row.agreementIdSealed ? unseal(row.agreementIdSealed) : undefined;
    if (!agreementID) return { charged: false, reason: "agreement_id_missing" };
    const sub = await (this.prisma as any).subscription.findFirst({
      where: { organizationId }, orderBy: { createdAt: "desc" },
    }).catch(() => null);
    if (!sub || !["ACTIVE", "TRIALING"].includes(sub.status) || !sub.currentPeriodEnd) return { charged: false, reason: "no_live_subscription" };
    if (String(sub.plan) === "FREE") return { charged: false, reason: "free_plan" };
    const msLeft = new Date(sub.currentPeriodEnd).getTime() - Date.now();
    if (msLeft > 24 * 3600_000) return { charged: false, reason: "not_due_yet", hoursLeft: Math.round(msLeft / 3600000) };
    const cycle = String(sub.billingCycle ?? "monthly");
    const prices = cycle === "yearly" ? await planYearlyPrices(this.prisma as any) : await planPrices(this.prisma as any);
    const priceMinor = BigInt(prices[String(sub.plan)] ?? 0);
    if (priceMinor <= 0n) return { charged: false, reason: "no_price_configured" };
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } }).catch(() => null);
    const creditBalance = BigInt(org?.creditMinor ?? 0);
    const creditApplied = creditBalance > priceMinor ? priceMinor : creditBalance;
    const dueMinor = priceMinor - creditApplied;
    const tranId = `QA${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString("hex").toUpperCase()}`;
    const checkout = await (this.prisma as any).planCheckout.create({
      data: {
        organizationId, plan: String(sub.plan), amountMinor: dueMinor, currency: "BDT", tranId,
        status: "initiated", createdById: "system", gateway: "bkash",
        creditAppliedMinor: creditApplied, discountMinor: 0n, prorationMinor: 0n, cycle,
      },
    });
    const fail = async (message: string) => {
      await (this.prisma as any).planCheckout.update({ where: { id: checkout.id }, data: { status: "failed", gatewayDetail: { autoRenew: true, error: message } } }).catch(() => null);
      await (this.prisma as any).autoRenewAgreement.update({ where: { id: row.id }, data: { lastError: message } }).catch(() => null);
      await this.audit.log({
        organizationId, action: "billing.autorenew_charge_failed", entityType: "PlanCheckout", entityId: checkout.id,
        metadata: { plan: String(sub.plan), cycle, error: message },
      });
      return { charged: false, reason: message };
    };
    if (dueMinor === 0n) {
      await this.activate(checkout, "—", { via: "autorenew_credit" });
      await (this.prisma as any).autoRenewAgreement.update({ where: { id: row.id }, data: { lastChargeAt: new Date(), lastError: null } }).catch(() => null);
      return { charged: true, viaCredit: true, tranId };
    }
    const created = await this.bkashCall(cfg, "/checkout/create", {
      mode: "0001",
      agreementID,
      payerReference: row.payerReference,
      callbackURL: `${this.apiBase()}/public/payments/bkash/callback`,
      amount: (Number(dueMinor) / 100).toFixed(2),
      currency: "BDT",
      intent: "sale",
      merchantInvoiceNumber: tranId,
    }).catch((e) => ({ statusMessage: e instanceof Error ? e.message : "network error" }));
    if (!created || String(created.statusCode) !== "0000" || !created.paymentID) {
      return fail(`bKash charge refused: ${created?.statusMessage ?? "unknown error"}`);
    }
    const executed = await this.bkashCall(cfg, "/checkout/execute", { paymentID: String(created.paymentID) }).catch(() => null);
    if (!executed || String(executed.statusCode) !== "0000" || String(executed.transactionStatus) !== "Completed") {
      return fail(`bKash charge not completed: ${executed?.statusMessage ?? "unknown error"}`);
    }
    await this.activate(checkout, String(executed.trxID ?? executed.paymentID), { via: "autorenew", paymentID: String(created.paymentID) });
    await (this.prisma as any).autoRenewAgreement.update({ where: { id: row.id }, data: { lastChargeAt: new Date(), lastError: null } }).catch(() => null);
    return { charged: true, tranId, amountMinor: dueMinor.toString() };
  }

  /** Printable invoice HTML for one payment (admin + tenant
   * routes both render through buildInvoiceHtml). */
  /**
   * Referral Advanced R2: the org's credit history — every
   * grant, spend, clawback and expiry the ledger recorded,
   * with the live balance. Pre-ledger movements (before R1)
   * are not listed; the balance remains authoritative.
   */
  async creditLedger(organizationId: string) {
    const p = this.prisma as any;
    const org = await p.organization.findUnique({ where: { id: organizationId } }).catch(() => null);
    const rows = (await p.creditLedger?.findMany?.({
      where: { organizationId }, orderBy: { createdAt: "desc" }, take: 100,
    })?.catch?.(() => [])) ?? [];
    return {
      balanceMinor: org?.creditMinor != null ? BigInt(org.creditMinor).toString() : "0",
      entries: (rows as any[]).map((r) => ({
        id: r.id, deltaMinor: BigInt(r.deltaMinor).toString(), reason: r.reason,
        referralId: r.referralId ?? null, expiresAt: r.expiresAt ?? null, createdAt: r.createdAt,
      })),
    };
  }

  async invoiceHtmlForOrgPayment(organizationId: string, paymentId: string): Promise<string> {
    const payment = await (this.prisma as any).saasPayment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.organizationId !== organizationId) throw new NotFoundException("Payment not found");
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } }).catch(() => null);
    const profile = await (this.prisma as any).businessProfile?.findUnique?.({ where: { organizationId } })?.catch?.(() => null) ?? null;
    return buildInvoiceHtml({ payment, orgName: org?.name ?? organizationId, buyer: { address: profile?.billingAddress ?? null, bin: profile?.billingBin ?? null } });
  }

  /** Browser return mapping — informational only (SSLCommerz). */
  returnRedirect(body: Record<string, any>): string {
    const status = String(body?.status ?? "").toUpperCase();
    const mapped = status === "VALID" || status === "VALIDATED" ? "received"
      : status === "FAILED" ? "failed"
      : status === "CANCELLED" ? "cancelled" : "unknown";
    return `${this.webBase()}/dashboard/billing?payment=${mapped}`;
  }
}

/** Milestone 39: printable invoice/receipt for ONE payment row.
 * Print-to-PDF from the browser is the delivery mechanism (no
 * PDF dependency); every value comes from the stored record,
 * refunds netted and shown — never hidden. */
export function buildInvoiceHtml(input: { payment: any; orgName: string; buyer?: { address?: string | null; bin?: string | null } }): string {
  const p = input.payment;
  const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const fmt = (minor: bigint) => (Number(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
  const gross = BigInt(p.amountMinor ?? 0);
  const refunded = BigInt(p.refundedMinor ?? 0);
  const invoiceNo = `INV-${String(p.id).slice(-8).toUpperCase()}`;
  const date = new Date(p.createdAt).toISOString().slice(0, 10);
  const rows = [
    ["Subscription payment", `${esc(p.currency ?? "BDT")} ${fmt(gross)}`],
    ...(refunded > 0n ? [["Refund", `− ${esc(p.currency ?? "BDT")} ${fmt(refunded)}`], ["Net paid", `${esc(p.currency ?? "BDT")} ${fmt(gross - refunded)}`]] : []),
  ].map(([a, b]) => `<tr><td>${a}</td><td class="r">${b}</td></tr>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${invoiceNo}</title>
<style>
  body { font-family: system-ui, sans-serif; color: #0f172a; margin: 40px auto; max-width: 720px; padding: 0 20px; }
  h1 { font-size: 22px; margin: 0 0 4px; } .muted { color: #64748b; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; }
  td { padding: 10px 8px; border-top: 1px solid #e2e8f0; font-size: 14px; } .r { text-align: right; font-weight: 600; }
  .box { border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 18px; margin-top: 18px; }
  @media print { .noprint { display: none; } }
</style></head><body>
  <h1>Qosprey — AI Marketing SaaS</h1>
  <div class="muted">Invoice ${invoiceNo} · Issued ${date}</div>
  <div class="box">
    <div><strong>Billed to:</strong> ${esc(input.orgName)}</div>
    ${input.buyer?.address ? `<div class="muted">${esc(input.buyer.address)}</div>` : ""}
    ${input.buyer?.bin ? `<div class="muted">BIN: ${esc(input.buyer.bin)}</div>` : ""}
    <div class="muted">Method: ${esc(p.method)}${p.reference ? ` · Reference: ${esc(p.reference)}` : ""}</div>
    ${p.periodEnd ? `<div class="muted">Service period ends: ${new Date(p.periodEnd).toISOString().slice(0, 10)}</div>` : ""}
    ${p.note ? `<div class="muted">Note: ${esc(p.note)}</div>` : ""}
    ${refunded > 0n && p.refundReason ? `<div class="muted">Refund reason: ${esc(p.refundReason)}</div>` : ""}
  </div>
  <table>${rows}</table>
  <p class="muted" style="margin-top:24px">Generated from the platform's payment records. Amounts are shown exactly as recorded.</p>
  <button class="noprint" onclick="window.print()">Print / Save as PDF</button>
</body></html>`;
}
