import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import {
  effectiveSslcommerzConfig, ensurePlatformConfig, sslcommerzBase,
  type SslcommerzConfig,
} from "../common/platform-config";
import { PLAN_TIERS, planPrices } from "../common/platform-settings";

/**
 * Milestone 36 (Phase N1): SSLCommerz subscription payments.
 *
 * Trust rules (non-negotiable):
 * - The browser success return NEVER activates anything. It only
 *   redirects back to the billing page.
 * - Activation happens ONLY in handleIpn, after ALL of:
 *   (1) the IPN signature verifies against the store password,
 *   (2) the gateway's own validation API confirms the val_id,
 *   (3) the confirmed amount and currency match this checkout,
 *   (4) the checkout is not already completed (idempotent).
 * - On activation the subscription extends by one 30-day period
 *   from the later of now / the current period end, and a real
 *   SaasPayment row is written.
 */

const PERIOD_DAYS = 30;

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

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private apiBase(): string {
    return (process.env.API_PUBLIC_URL ?? "http://localhost:4000").replace(/\/$/, "");
  }
  private webBase(): string {
    return (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
  }

  async createCheckout(organizationId: string, actor: { userId: string; email: string }, planRaw: string, phoneRaw: string) {
    await ensurePlatformConfig(this.prisma as any);
    const cfg = effectiveSslcommerzConfig();
    if (!cfg) {
      throw new BadRequestException("Online payment is not configured by the platform team yet. Please use the plan-change request on the Billing page — the team will confirm your payment manually.");
    }
    const plan = String(planRaw ?? "").toUpperCase();
    if (!(PLAN_TIERS as readonly string[]).includes(plan)) throw new BadRequestException("Unknown plan");
    if (plan === "FREE") throw new BadRequestException("The FREE plan needs no payment.");
    const phone = String(phoneRaw ?? "").trim();
    if (!/^[+\d][\d\s-]{10,14}$/.test(phone)) {
      throw new BadRequestException("A valid phone number is required for the payment receipt.");
    }
    const prices = await planPrices(this.prisma as any);
    const amountMinor = BigInt(prices[plan] ?? 0);
    if (amountMinor <= 0n) throw new BadRequestException("This plan has no price configured. Please ask the platform team.");
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException("Organization not found");
    const profile = await (this.prisma as any).businessProfile.findUnique({ where: { organizationId } }).catch(() => null);

    const tranId = `QC${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString("hex").toUpperCase()}`;
    const checkout = await (this.prisma as any).planCheckout.create({
      data: {
        organizationId, plan, amountMinor, currency: "BDT", tranId,
        status: "initiated", createdById: actor.userId,
      },
    });

    const form = new URLSearchParams({
      store_id: cfg.storeId,
      store_passwd: cfg.storePass,
      total_amount: (Number(amountMinor) / 100).toFixed(2),
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
      value_a: organizationId,
      value_b: plan,
      value_c: actor.userId,
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
      amountMinor: amountMinor.toString(),
      sandbox: cfg.sandbox,
    };
  }

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
    if (!validation || !["VALID", "VALIDATED"].includes(String(validation.status ?? "").toUpperCase())) {
      return { ok: false, reason: "gateway validation did not confirm this payment" };
    }
    if (validation.tran_id && String(validation.tran_id) !== tranId) {
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

  private async activate(checkout: any, valId: string) {
    const now = new Date();
    const sub = await (this.prisma as any).subscription.findFirst({
      where: { organizationId: checkout.organizationId }, orderBy: { createdAt: "desc" },
    });
    const base = sub?.currentPeriodEnd && new Date(sub.currentPeriodEnd) > now ? new Date(sub.currentPeriodEnd) : now;
    const newEnd = new Date(base.getTime() + PERIOD_DAYS * 86400000);
    if (sub) {
      await (this.prisma as any).subscription.update({
        where: { id: sub.id },
        data: { plan: checkout.plan, status: "ACTIVE", currentPeriodEnd: newEnd },
      });
    } else {
      await (this.prisma as any).subscription.create({
        data: { organizationId: checkout.organizationId, plan: checkout.plan, status: "ACTIVE", currentPeriodEnd: newEnd },
      });
    }
    await (this.prisma as any).saasPayment.create({
      data: {
        organizationId: checkout.organizationId,
        amountMinor: checkout.amountMinor,
        currency: checkout.currency,
        method: "sslcommerz",
        reference: checkout.tranId,
        periodEnd: newEnd,
        recordedById: checkout.createdById,
        note: `SSLCommerz online payment (val_id ${valId})`,
      },
    });
    await (this.prisma as any).planCheckout.update({
      where: { id: checkout.id },
      data: { status: "success", valId, completedAt: now },
    });
    await this.audit.log({
      organizationId: checkout.organizationId, userId: checkout.createdById,
      action: "billing.online_payment_completed", entityType: "PlanCheckout", entityId: checkout.id,
      metadata: { plan: checkout.plan, amountMinor: checkout.amountMinor.toString(), tranId: checkout.tranId, periodEnd: newEnd.toISOString() },
    });
    return { ok: true, activated: true, plan: checkout.plan, currentPeriodEnd: newEnd.toISOString() };
  }

  /** Browser return mapping — informational only. */
  returnRedirect(body: Record<string, any>): string {
    const status = String(body?.status ?? "").toUpperCase();
    const mapped = status === "VALID" || status === "VALIDATED" ? "received"
      : status === "FAILED" ? "failed"
      : status === "CANCELLED" ? "cancelled" : "unknown";
    return `${this.webBase()}/dashboard/billing?payment=${mapped}`;
  }
}
