import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { TenantPaymentsService } from "../connections/tenant-payments.service";
import { ShopAccountService } from "../storefront/shop-account.service";
import { badRequest, notFound } from "../i18n";

/**
 * GC12 — recovery resend of an order's online-payment link.
 *
 * A FRESH initiation is made (which creates the NEW attempt row —
 * exactly the record we want); the returned gateway link is then
 * sent to the customer. NO automatic retries anywhere: one staff
 * action = one initiation + at most one send attempt.
 *
 * Channel verdict (documented, deliberate): SMS-only.
 * InboxService is NOT injectable here without module surgery —
 * InboxModule imports OrdersModule, so OrdersModule importing
 * InboxModule would cycle. The order-chase/reviews precedent
 * (a structural sender passed in by AutomationService) does not
 * apply to a synchronous staff endpoint. So the send goes
 * through the ONE shared shop SMS helper (ShopAccountService.
 * sendShopSms, exported by StorefrontModule which OrdersModule
 * already imports) and the outcome is reported honestly:
 * sentVia "sms" only when the helper confirms the send,
 * otherwise "none" with the reason kept in the audit metadata
 * and the link still returned for manual sharing.
 */
@Injectable()
export class PaymentResendService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPayments: TenantPaymentsService,
    @Optional() private readonly shopAccounts?: ShopAccountService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private t(name: string): any { return (this.prisma as any)[name]; }

  async resendPaymentLink(
    organizationId: string,
    actorId: string,
    orderId: string,
    body?: { provider?: unknown; source?: unknown; purpose?: unknown } | null,
  ) {
    let order: any = null;
    try {
      order = await this.t("order").findFirst({ where: { id: orderId, organizationId } });
    } catch { order = null; }
    if (!order) throw notFound("courier.orderNotFoundShort");
    if (order.isPractice) throw badRequest("orders.practiceOrderPaymentLinkBlocked");

    let attempts: any[] = [];
    try {
      attempts = (await this.t("tenantPaymentTransaction").findMany({
        where: { organizationId, orderId: order.id },
      })) ?? [];
    } catch { attempts = []; }
    // AB4 (AX5a): a PARTIAL verified payment no longer blocks a
    // resend — only a fully settled order (Σ verified ≥ total)
    // refuses. The verified sums also drive the purpose-scoped
    // amounts below (deposit outstanding / balance remainder).
    let totalMinor = 0n;
    try { totalMinor = BigInt(order.totalMinor ?? 0); } catch { totalMinor = 0n; }
    let verifiedSum = 0n;
    let verifiedDepositSum = 0n;
    for (const a of attempts) {
      if (String(a.status) !== "verified_paid") continue;
      let amt = 0n;
      try { amt = BigInt(a.amountMinor ?? 0); } catch { amt = 0n; }
      verifiedSum += amt;
      if (String(a.purpose ?? "full") === "deposit") verifiedDepositSum += amt;
    }
    if (totalMinor > 0n && verifiedSum >= totalMinor) {
      throw badRequest("orders.paymentAlreadyCompleted");
    }
    const sorted = [...attempts].sort(
      (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
    );
    const latest = sorted[0];

    const providerRaw = String(body?.provider ?? "").trim().toLowerCase() || (latest ? String(latest.provider ?? "") : "");
    const sourceRaw = String(body?.source ?? "").trim().toLowerCase() || (latest ? String(latest.source ?? "own") : "");
    if (!providerRaw || !sourceRaw) {
      throw badRequest("orders.paymentLinkGatewayUnknown");
    }
    // Server truth, never the client's word: the pair must be an
    // option this shop actually offers right now.
    const pair = await this.tenantPayments.assertPublicPaymentOption(organizationId, { provider: providerRaw, source: sourceRaw });

    const customer = order.customerId
      ? await this.t("customer").findFirst({ where: { id: order.customerId } }).catch(() => null)
      : null;
    const opts: {
      customerName?: string; customerPhone?: string; customerEmail?: string;
      amountMinor?: bigint; purpose?: string;
    } = {
      customerName: customer?.firstName ?? customer?.name ?? undefined,
      customerPhone: customer?.phone ?? undefined,
      customerEmail: customer?.email ?? undefined,
    };
    // AB4 (AX5a): purpose-scoped resend. "deposit" collects the
    // OUTSTANDING deposit only (due − Σ verified deposit); a
    // deposit already fully paid refuses here, before any new
    // attempt is created. "balance" (or an unscoped resend after
    // a partial verified payment) collects the remainder —
    // the amount defaults to remaining inside initiate.
    const wantedPurpose = String(body?.purpose ?? "").trim().toLowerCase();
    if (wantedPurpose === "deposit") {
      let due = 0n;
      try { due = BigInt(order.depositDueMinor ?? 0); } catch { due = 0n; }
      const outstanding = due - verifiedDepositSum;
      if (outstanding <= 0n) {
        throw badRequest("orders.depositAlreadyPaid");
      }
      opts.amountMinor = outstanding;
      opts.purpose = "deposit";
    } else if (wantedPurpose === "balance" || verifiedSum > 0n) {
      opts.purpose = "balance";
    }

    // Fresh initiation — an initiation error propagates as the
    // API error (the failed attempt row initiation itself writes
    // is the record of the failure).
    const initiation: any = pair.source === "platform"
      ? await this.tenantPayments.initiatePlatformOrderPayment(organizationId, order.id, pair.provider, opts)
      : await this.tenantPayments.initiateOrderPayment(organizationId, order.id, pair.provider, opts);
    const link = String(initiation?.redirectUrl ?? "");
    const transactionId = String(initiation?.transactionId ?? "");

    const orderNumber = String(order.externalNumber ?? order.id);
    const phone = String(customer?.phone ?? "").trim();
    let sentVia: "sms" | "none" = "none";
    let reason: string | undefined;
    if (!phone) {
      reason = "গ্রাহকের ফোন নম্বর নেই";
    } else if (!this.shopAccounts) {
      reason = "SMS পাঠানোর সেবা এই ডিপ্লয়মেন্টে নেই";
    } else {
      const text = `আপনার অর্ডার ${orderNumber}-এর পেমেন্ট লিংক: ${link} — অনুগ্রহ করে লিংকে গিয়ে পেমেন্ট সম্পন্ন করুন।`;
      try {
        const result: any = await this.shopAccounts.sendShopSms(organizationId, phone, text, `payment-resend-${order.id}`);
        if (result?.sent) {
          sentVia = "sms";
        } else {
          reason = String(result?.reason ?? "SMS পাঠানো যায়নি");
        }
      } catch (e) {
        reason = e instanceof Error ? e.message : String(e);
      }
    }

    const sendNote = sentVia === "sms"
      ? "SMS-এ পেমেন্ট লিংক পাঠানো হয়েছে।"
      : "কোনো চ্যানেলে পাঠানো যায়নি — লিংকটি নিজে শেয়ার করুন।";

    if (this.audit) {
      await this.audit.log({
        organizationId, userId: actorId, action: "tenant_payment.link_resent",
        entityType: "Order", entityId: order.id,
        metadata: {
          orderId: order.id, provider: pair.provider, source: pair.source, transactionId, sentVia,
          ...(reason ? { reason } : {}),
        },
      }).catch(() => undefined);
    }

    return { link, transactionId, provider: pair.provider, source: pair.source, sentVia, sendNote };
  }
}
