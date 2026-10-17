import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { TenantGatewayClient, type TenantBkashCreds, type TenantSslCreds } from "./tenant-gateway.client";
import { TenantPaymentsService } from "./tenant-payments.service";

/**
 * CC24 (Connect Center Next) — gateway refunds for online-paid
 * orders, through the SAME gateway that carried the payment.
 *
 * The CC9 discipline, applied to money going back out:
 * - INITIATION IS NEVER PROOF. Initiating records a
 *   PaymentRefund ("initiated" → gateway acceptance →
 *   "processing" with the gateway's refund reference). Nothing
 *   about the order or the Wallet changes at initiation.
 * - ONLY a gateway status query confirming success moves the
 *   refund to "refunded" — and only then, in ONE database
 *   transaction: the refund row, the order's refundedMinor (the
 *   SAME cumulative field the EC5 local refund recording
 *   maintains — a gateway refund is recorded on the order from
 *   here, never in both places), and, for platform-source
 *   payments, a Wallet refund_debit.
 * - The platform refund debit MAY take the wallet balance
 *   negative: the platform already paid the money out to the
 *   customer from its own account, so a negative wallet balance
 *   is a real receivable the tenant owes the platform. The
 *   ledger row and the wallet view show it plainly; this is the
 *   ONE deliberate exception to the wallet's never-negative
 *   rule, and it exists only on this verified-refund path.
 *   Own-source refunds never touch the wallet — the money
 *   returns from the tenant's own merchant account.
 * - Cumulative verified + in-flight refunds for one payment
 *   may NEVER exceed the paid amount (checked inside a
 *   transaction at initiation; partial refunds are allowed).
 * - Nagad: no refund API is wired anywhere in this codebase,
 *   so initiation refuses honestly. Rocket has no API gateway
 *   at all (manual-number path) and can never appear here.
 * - Sandbox test transactions are refused: no real money ever
 *   moved for them, so there is nothing to refund.
 */

const IN_FLIGHT_STATUSES = ["initiated", "processing"];

/**
 * OU5 — providers with NO refund API evidenced in this codebase
 * (docs/gb4-gateway-research.md): their refunds can only happen
 * in the provider's own merchant dashboard. For them — and for
 * sslcommerz/bkash when staff deliberately choose the manual
 * route ("gateway-manual" cases) — the Refund Center tracks the
 * manual refund on the SAME PaymentRefund rows and completes it
 * through the SAME applyVerifiedRefund bookkeeping. No second
 * set of books, no new model: a manual row is marked by
 * gatewayStatusRaw.manual === true and carries the provider
 * dashboard reference in gatewayRefundRef.
 */
export const MANUAL_REFUND_PROVIDERS = ["shurjopay", "aamarpay", "nagad"] as const;

export function isManualRefundRow(row: any): boolean {
  return !!row && typeof row.gatewayStatusRaw === "object" && row.gatewayStatusRaw !== null && (row.gatewayStatusRaw as any).manual === true;
}

export const MANUAL_REFUND_TRACKING_LABEL = "provider dashboard-এ হাতে করা হয়েছে — প্ল্যাটফর্ম ট্র্যাক করছে";

function parsePositiveMinor(value: unknown, field = "amountMinor"): bigint {
  const raw = typeof value === "bigint" ? value.toString() : String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) throw new BadRequestException(`${field} অবশ্যই minor unit-এ ধনাত্মক পূর্ণসংখ্যা হতে হবে।`);
  const amount = BigInt(raw);
  if (amount <= 0n) throw new BadRequestException("Refund-এর পরিমাণ শূন্যের বেশি হতে হবে।");
  return amount;
}

@Injectable()
export class PaymentRefundsService {
  private readonly gateway: TenantGatewayClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenantPayments: TenantPaymentsService,
    @Optional() gatewayClient?: TenantGatewayClient,
  ) {
    this.gateway = gatewayClient ?? new TenantGatewayClient();
  }

  /** Same transaction discipline as WalletService: run inside
   * a Prisma transaction when the client supports it; spec
   * fakes without $transaction run directly. */
  private async tx<T>(fn: (client: any) => Promise<T>): Promise<T> {
    const p: any = this.prisma as any;
    if (typeof p.$transaction === "function") return p.$transaction(fn);
    return fn(p);
  }

  private refundView(row: any) {
    const manual = isManualRefundRow(row);
    const raw = manual ? (row.gatewayStatusRaw as any) : null;
    return {
      id: row.id,
      transactionId: row.tenantPaymentTransactionId,
      orderId: row.orderId,
      provider: row.provider,
      source: row.source === "platform" ? "platform" : "own",
      environment: row.environment === "sandbox" ? "sandbox" : "live",
      amountMinor: String(row.amountMinor),
      currency: row.currency ?? "BDT",
      status: row.status,
      // OU5: "gateway" = the CC24 API path; "manual" = Refund
      // Center tracking of a provider-dashboard refund.
      mode: manual ? "manual" : "gateway",
      trackingLabel: manual ? MANUAL_REFUND_TRACKING_LABEL : null,
      manualProviderRef: manual ? (row.gatewayRefundRef ?? null) : null,
      manualProofNote: manual ? (raw?.proofNote ?? null) : null,
      manualRecordedById: manual ? (raw?.recordedById ?? null) : null,
      manualRecordedAt: manual ? (raw?.recordedAt ?? null) : null,
      gatewayRefundRef: row.gatewayRefundRef ?? null,
      gatewayStatusRaw: row.gatewayStatusRaw ?? null,
      reason: row.reason ?? null,
      requestedById: row.requestedById,
      verifiedAt: row.verifiedAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** Σ verified + in-flight refund amounts for one transaction
   * — the amounts that already consume the refundable budget. */
  private async committedMinor(client: any, transactionId: string): Promise<bigint> {
    const rows = await client.paymentRefund.findMany({
      where: { tenantPaymentTransactionId: transactionId, status: { in: ["refunded", ...IN_FLIGHT_STATUSES] } },
    }).catch(() => []);
    return (rows ?? []).reduce((sum: bigint, r: any) => sum + BigInt(r.amountMinor), 0n);
  }

  /**
   * OU5: the ONE row-creation path for every refund — gateway
   * (CC24) and manual (Refund Center) alike. Cap check + create
   * in a single transaction against the shared committed budget
   * (verified + in-flight, both modes), so a manual request and
   * a gateway refund can never over-commit the same payment.
   */
  private async createRefundRowWithinCap(
    organizationId: string, actorId: string, txn: any,
    opts: { amountRaw?: unknown; reason?: string | null; manualRaw?: Record<string, unknown> | null },
  ) {
    return this.tx(async (client) => {
      const committed = await this.committedMinor(client, txn.id);
      const paid = BigInt(txn.amountMinor);
      const remaining = paid - committed;
      if (remaining <= 0n) {
        throw new BadRequestException("এই পেমেন্টের সম্পূর্ণ পরিমাণ ইতিমধ্যে refund হয়ে গেছে বা প্রক্রিয়াধীন আছে — আর refund করা যাবে না।");
      }
      const amount = opts.amountRaw === undefined || opts.amountRaw === null || String(opts.amountRaw).trim() === ""
        ? remaining
        : parsePositiveMinor(opts.amountRaw);
      if (amount > remaining) {
        throw new BadRequestException(`Refund-এর পরিমাণ অবশিষ্ট ফেরতযোগ্য পরিমাণের (${remaining.toString()} minor) বেশি হতে পারবে না।`);
      }
      return client.paymentRefund.create({
        data: {
          organizationId, tenantPaymentTransactionId: txn.id, orderId: txn.orderId,
          provider: String(txn.provider ?? ""), source: txn.source === "platform" ? "platform" : "own",
          environment: "live", amountMinor: amount, currency: String(txn.currency ?? "BDT"),
          status: "initiated", reason: opts.reason ?? null, requestedById: actorId,
          ...(opts.manualRaw ? { gatewayStatusRaw: opts.manualRaw } : {}),
        },
      });
    });
  }

  async initiateRefund(organizationId: string, actorId: string, transactionId: string, dto: { amountMinor?: unknown; reason?: string } = {}) {
    const p: any = this.prisma as any;
    const txn = await p.tenantPaymentTransaction.findFirst({
      where: { id: transactionId, organizationId },
    }).catch(() => null);
    if (!txn) throw new NotFoundException("Transaction not found");
    const provider = String(txn.provider ?? "");
    if (provider === "nagad") {
      throw new BadRequestException("Nagad-এর কোনো refund API এই সিস্টেমে সংযুক্ত নয় — Nagad পেমেন্টের refund গেটওয়ে দিয়ে শুরু করা যাবে না। Nagad মার্চেন্ট প্যানেল থেকে refund করে Refund Center-এর ম্যানুয়াল পথে রেকর্ড রাখুন — প্ল্যাটফর্ম সেটি ট্র্যাক করবে।");
    }
    if (provider !== "sslcommerz" && provider !== "bkash") {
      throw new BadRequestException("এই প্রোভাইডারের কোনো refund API সংযুক্ত নেই — শুধু sslcommerz ও bkash পেমেন্টের refund গেটওয়ে API দিয়ে শুরু করা যায়। এই প্রোভাইডারের refund প্রোভাইডার dashboard থেকে করে Refund Center-এর ম্যানুয়াল পথে রেকর্ড রাখুন।");
    }
    if (txn.status !== "verified_paid") {
      throw new BadRequestException("শুধু যাচাইকৃতভাবে সম্পন্ন (verified_paid) পেমেন্টই refund করা যায় — এই লেনদেনের অবস্থা তা নয়।");
    }
    if (txn.environment === "sandbox") {
      throw new BadRequestException("Sandbox টেস্ট লেনদেনে কোনো আসল টাকা আসেনি — refund করার কিছু নেই।");
    }
    const reason = dto?.reason !== undefined && dto?.reason !== null ? String(dto.reason).trim().slice(0, 200) || null : null;

    // The gateway references the refund call needs, taken from
    // the transaction's own stored verification evidence. A
    // payment whose evidence lacks them cannot be refunded
    // through the API — refuse honestly instead of guessing.
    let bankTranId: string | null = null;
    let bkashTrxId: string | null = null;
    if (provider === "sslcommerz") {
      bankTranId = txn.ipnPayload?.validation?.bank_tran_id ?? txn.ipnPayload?.ipn?.bank_tran_id ?? null;
      if (!bankTranId) {
        throw new BadRequestException("এই লেনদেনের রেকর্ডে SSLCommerz bank_tran_id নেই — gateway refund শুরু করা যাবে না।");
      }
    } else {
      bkashTrxId = txn.ipnPayload?.executeOrQuery?.trxID ?? null;
      if (!txn.providerTxnId || !bkashTrxId) {
        throw new BadRequestException("এই লেনদেনের রেকর্ডে bKash paymentID/trxID নেই — gateway refund শুরু করা যাবে না।");
      }
    }

    const creds = await this.tenantPayments.resolveCredsForTransaction(txn);
    if (!creds) {
      throw new BadRequestException("এই লেনদেনের গেটওয়ে credential এখন পাওয়া যাচ্ছে না — refund শুরু করা যাবে না।");
    }

    // Cap check + row creation in ONE transaction: the
    // refundable budget (paid − already verified/in-flight)
    // can never be over-committed, even by two clicks at once.
    const row = await this.createRefundRowWithinCap(organizationId, actorId, txn, { amountRaw: dto?.amountMinor, reason });

    // The gateway call itself. Acceptance moves the row to
    // "processing" with the gateway's reference; a gateway
    // refusal (or an unreachable gateway) marks it "failed"
    // with the raw answer kept verbatim as evidence. Neither
    // outcome touches the order or the wallet.
    let raw: any = null;
    let gatewayRef: string | null = null;
    try {
      if (provider === "sslcommerz") {
        raw = await this.gateway.sslInitiateRefund(creds as TenantSslCreds, {
          bankTranId: String(bankTranId), amountMajor: (Number(row.amountMinor) / 100).toFixed(2), remarks: reason ?? undefined,
        });
        if (raw && String(raw.status ?? "").toLowerCase() === "success" && raw.refund_ref_id) {
          gatewayRef = String(raw.refund_ref_id);
        }
      } else {
        raw = await this.gateway.bkashRefundPayment(creds as TenantBkashCreds, {
          paymentID: String(txn.providerTxnId), trxID: String(bkashTrxId),
          amount: (Number(row.amountMinor) / 100).toFixed(2), reason: reason ?? undefined,
        });
        if (raw && String(raw.statusCode) === "0000" && raw.refundTrxID) {
          gatewayRef = String(raw.refundTrxID);
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "gateway unreachable";
      await p.paymentRefund.update({
        where: { id: row.id }, data: { status: "failed", gatewayStatusRaw: { transportError: message } },
      }).catch(() => undefined);
      await this.audit.log({
        organizationId, userId: actorId, action: "payment_refund.initiation_failed",
        entityType: "PaymentRefund", entityId: row.id,
        metadata: { provider, transactionId: txn.id, amountMinor: String(row.amountMinor), error: message },
      }).catch(() => undefined);
      throw new BadRequestException(`গেটওয়ে refund গ্রহণ করেনি: ${message}`);
    }

    if (!gatewayRef) {
      await p.paymentRefund.update({
        where: { id: row.id }, data: { status: "failed", gatewayStatusRaw: raw ?? null },
      }).catch(() => undefined);
      await this.audit.log({
        organizationId, userId: actorId, action: "payment_refund.initiation_failed",
        entityType: "PaymentRefund", entityId: row.id,
        metadata: { provider, transactionId: txn.id, amountMinor: String(row.amountMinor) },
      }).catch(() => undefined);
      const why = raw?.errorReason ?? raw?.statusMessage ?? raw?.status ?? "unknown error";
      throw new BadRequestException(`গেটওয়ে refund গ্রহণ করেনি: ${String(why)}`);
    }

    const updated = await p.paymentRefund.update({
      where: { id: row.id }, data: { status: "processing", gatewayRefundRef: gatewayRef, gatewayStatusRaw: raw },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "payment_refund.initiated",
      entityType: "PaymentRefund", entityId: row.id,
      metadata: { provider, source: updated.source, transactionId: txn.id, orderId: txn.orderId, amountMinor: String(row.amountMinor), gatewayRefundRef: gatewayRef },
    });
    return this.refundView(updated);
  }

  /**
   * Verify ONE refund against the gateway's own status answer.
   * Terminal rows (refunded | failed) return as stored — no
   * gateway call, no side effects — which is what makes refresh
   * idempotent. Only a gateway-confirmed success applies the
   * verified-refund effects, exactly once (the transition is
   * re-checked inside the effects transaction).
   */
  async refreshRefund(organizationId: string, actorId: string, refundId: string) {
    const p: any = this.prisma as any;
    const row = await p.paymentRefund.findFirst({ where: { id: refundId, organizationId } }).catch(() => null);
    if (!row) throw new NotFoundException("Refund not found");
    if (row.status === "refunded" || row.status === "failed") return this.refundView(row);
    // OU5: a manual (Refund Center) row has NO gateway to ask —
    // its gatewayRefundRef is a provider-dashboard reference,
    // not a gateway refund id. Refreshing it against a gateway
    // would be a category error; it moves only via the manual
    // record/complete steps.
    if (isManualRefundRow(row)) return this.refundView(row);
    if (!row.gatewayRefundRef) return this.refundView(row);

    const txn = await p.tenantPaymentTransaction.findFirst({ where: { id: row.tenantPaymentTransactionId } }).catch(() => null);
    if (!txn) throw new NotFoundException("Transaction not found");
    const creds = await this.tenantPayments.resolveCredsForTransaction(txn);
    if (!creds) {
      throw new BadRequestException("এই লেনদেনের গেটওয়ে credential এখন পাওয়া যাচ্ছে না — refund-এর অবস্থা যাচাই করা যাচ্ছে না। কিছুই পরিবর্তন হয়নি।");
    }

    let raw: any = null;
    let outcome: "refunded" | "failed" | "pending" = "pending";
    if (row.provider === "sslcommerz") {
      raw = await this.gateway.sslRefundStatus(creds as TenantSslCreds, String(row.gatewayRefundRef)).catch(() => null);
      const state = String(raw?.status ?? "").toLowerCase();
      if (state === "refunded") outcome = "refunded";
      else if (state === "cancelled" || state === "failed") outcome = "failed";
    } else {
      raw = await this.gateway.bkashSearchTransaction(creds as TenantBkashCreds, String(row.gatewayRefundRef)).catch(() => null);
      if (raw && String(raw.statusCode) === "0000" && String(raw.trxID ?? "") === String(row.gatewayRefundRef)) {
        const state = String(raw.transactionStatus ?? "");
        if (state === "Completed") outcome = "refunded";
        else if (state === "Failed" || state === "Cancelled") outcome = "failed";
      }
    }
    // An unconfirmed answer (gateway unreachable, unknown
    // state) changes NOTHING except the stored evidence — the
    // refund stays in-flight and can be refreshed again.
    if (!raw) return this.refundView(row);

    if (outcome === "failed") {
      const updated = await p.paymentRefund.update({
        where: { id: row.id }, data: { status: "failed", gatewayStatusRaw: raw },
      });
      await this.audit.log({
        organizationId, userId: actorId, action: "payment_refund.failed",
        entityType: "PaymentRefund", entityId: row.id,
        metadata: { provider: row.provider, amountMinor: String(row.amountMinor) },
      }).catch(() => undefined);
      return this.refundView(updated);
    }
    if (outcome === "pending") {
      const updated = await p.paymentRefund.update({
        where: { id: row.id }, data: { gatewayStatusRaw: raw },
      }).catch(() => row);
      return this.refundView(updated);
    }
    return this.applyVerifiedRefund(row, raw, actorId);
  }

  /**
   * THE verified-refund effects — one database transaction:
   * refund row → "refunded" (+verifiedAt), the order's
   * refundedMinor advanced by the refund amount (capped at the
   * order total; the EC5 cumulative), an order evidence note,
   * and — platform source only — the Wallet refund_debit. The
   * status re-check inside the transaction makes the whole
   * thing exactly-once: a second refresh finds "refunded" and
   * changes nothing.
   *
   * Order status mapping (mirrors EC5's documented rule): a
   * FULL cumulative refund moves the order to "refunded"
   * unless its status is completed / cancelled / refunded /
   * returned, which keep their status (goods/lifecycle states
   * the refund alone does not rewrite).
   */
  private async applyVerifiedRefund(row: any, raw: any, actorId: string) {
    const result = await this.tx(async (client) => {
      const fresh = await client.paymentRefund.findFirst({ where: { id: row.id } });
      if (!fresh) return { view: null, alreadyRefunded: false };
      if (fresh.status === "refunded") return { view: fresh, alreadyRefunded: true };

      const updated = await client.paymentRefund.update({
        where: { id: fresh.id },
        data: { status: "refunded", verifiedAt: new Date(), gatewayStatusRaw: raw },
      });

      const order = await client.order.findFirst({
        where: { id: fresh.orderId, organizationId: fresh.organizationId },
      }).catch(() => null);
      if (order) {
        const amount = BigInt(fresh.amountMinor);
        const total = BigInt(order.totalMinor ?? 0);
        const cumulative = BigInt(order.refundedMinor ?? 0) + amount;
        const newRefunded = cumulative > total && total > 0n ? total : cumulative;
        const note = isManualRefundRow(fresh)
          ? `[ম্যানুয়াল রিফান্ড রেকর্ডকৃত — ${fresh.provider} · provider dashboard-এ হাতে করা হয়েছে, প্ল্যাটফর্ম ট্র্যাক করছে · refund ${fresh.id}]`
          : `[গেটওয়ে রিফান্ড যাচাইকৃত — ${fresh.provider} · refund ${fresh.id}]`;
        const internalNote = String(order.internalNote ?? "").includes(fresh.id)
          ? order.internalNote
          : [String(order.internalNote ?? "").trim(), note].filter(Boolean).join(" | ");
        const data: Record<string, unknown> = { refundedMinor: newRefunded, internalNote };
        if (total > 0n && newRefunded === total && !["completed", "cancelled", "refunded", "returned"].includes(String(order.status))) {
          data.status = "refunded";
        }
        await client.order.update({ where: { id: order.id }, data }).catch(() => undefined);
      }

      if (fresh.source === "platform") {
        // The wallet debit-back. Deliberately allowed to take
        // the balance NEGATIVE (platform receivable — see the
        // class doc): the platform refunded the customer from
        // its own account against money this wallet represents.
        let wallet = await client.walletAccount.findUnique({ where: { organizationId: fresh.organizationId } }).catch(() => null);
        if (!wallet) {
          wallet = await client.walletAccount.create({
            data: { organizationId: fresh.organizationId, currency: String(fresh.currency ?? "BDT"), balanceMinor: 0n },
          });
        }
        const amount = BigInt(fresh.amountMinor);
        const balanceAfter = BigInt(wallet.balanceMinor) - amount;
        await client.walletTransaction.create({
          data: {
            organizationId: fresh.organizationId, walletId: wallet.id, type: "refund_debit",
            amountMinor: -amount, balanceAfterMinor: balanceAfter,
            refType: "payment_refund", refId: fresh.id,
            note: `গেটওয়ে রিফান্ড ডেবিট-ব্যাক (${fresh.provider})`,
          },
        });
        await client.walletAccount.update({ where: { id: wallet.id }, data: { balanceMinor: balanceAfter } });
      }
      return { view: updated, alreadyRefunded: false };
    });
    if (result.view && !result.alreadyRefunded) {
      await this.audit.log({
        organizationId: row.organizationId, userId: actorId, action: "payment_refund.verified",
        entityType: "PaymentRefund", entityId: row.id,
        metadata: { provider: row.provider, source: row.source, amountMinor: String(row.amountMinor), orderId: row.orderId, mode: isManualRefundRow(row) ? "manual" : "gateway" },
      }).catch(() => undefined);
    }
    return result.view ? this.refundView(result.view) : this.refundView(row);
  }

  // ---------- OU5 Refund Center — manual (API-less) refunds ----------
  //
  // Flow, all on the SAME PaymentRefund rows + bookkeeping:
  //   1. createManualRefundRequest — staff opens a request
  //      ("initiated") against a REAL verified_paid transaction.
  //      Nothing about the order/wallet changes.
  //   2. recordManualRefundAction — staff records the refund
  //      they performed in the provider dashboard: provider
  //      reference (required) + proof note → "processing".
  //   3. completeManualRefund — staff attests the dashboard
  //      refund is done; the row completes through
  //      applyVerifiedRefund — the exact function the gateway
  //      path uses — so order refundedMinor, order status
  //      mapping and the platform wallet refund_debit are
  //      identical, exactly once. Honesty: the platform did NOT
  //      verify this with the provider (it cannot); the row,
  //      its label and the order note all say the refund was
  //      done by hand in the provider dashboard and is only
  //      TRACKED here, attested by the recording staff member.

  async createManualRefundRequest(organizationId: string, actorId: string, transactionId: string, dto: { amountMinor?: unknown; reason?: string } = {}) {
    const p: any = this.prisma as any;
    const txn = await p.tenantPaymentTransaction.findFirst({
      where: { id: transactionId, organizationId },
    }).catch(() => null);
    if (!txn) throw new NotFoundException("Transaction not found");
    const provider = String(txn.provider ?? "");
    if (!(MANUAL_REFUND_PROVIDERS as readonly string[]).includes(provider) && provider !== "sslcommerz" && provider !== "bkash") {
      throw new BadRequestException("এই প্রোভাইডারের পেমেন্টের জন্য ম্যানুয়াল refund ট্র্যাকিং প্রযোজ্য নয়।");
    }
    if (txn.status !== "verified_paid") {
      throw new BadRequestException("শুধু যাচাইকৃতভাবে সম্পন্ন (verified_paid) পেমেন্টেরই refund ট্র্যাক করা যায় — এই লেনদেনের অবস্থা তা নয়।");
    }
    if (txn.environment === "sandbox") {
      throw new BadRequestException("Sandbox টেস্ট লেনদেনে কোনো আসল টাকা আসেনি — refund করার কিছু নেই।");
    }
    const reason = dto?.reason !== undefined && dto?.reason !== null ? String(dto.reason).trim().slice(0, 200) || null : null;
    const row = await this.createRefundRowWithinCap(organizationId, actorId, txn, {
      amountRaw: dto?.amountMinor, reason,
      manualRaw: { manual: true, mode: "manual", trackingLabel: MANUAL_REFUND_TRACKING_LABEL, requestedAt: new Date().toISOString() },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "payment_refund.manual_requested",
      entityType: "PaymentRefund", entityId: row.id,
      metadata: { provider, source: row.source, transactionId: txn.id, orderId: txn.orderId, amountMinor: String(row.amountMinor), mode: "manual" },
    }).catch(() => undefined);
    return this.refundView(row);
  }

  async recordManualRefundAction(organizationId: string, actorId: string, refundId: string, dto: { providerRef?: string; proofNote?: string } = {}) {
    const p: any = this.prisma as any;
    const row = await p.paymentRefund.findFirst({ where: { id: refundId, organizationId } }).catch(() => null);
    if (!row) throw new NotFoundException("Refund not found");
    if (!isManualRefundRow(row)) {
      throw new BadRequestException("এটি ম্যানুয়াল (Refund Center) রিফান্ড নয় — গেটওয়ে রিফান্ডের অবস্থা Refresh দিয়ে আসে।");
    }
    if (row.status === "refunded") {
      throw new BadRequestException("এই রিফান্ডটি ইতিমধ্যে সম্পূর্ণ হিসেবে রেকর্ড হয়েছে — আবার রেকর্ড করা যাবে না।");
    }
    if (row.status !== "initiated") {
      throw new BadRequestException("Provider dashboard-এর কাজটি ইতিমধ্যে রেকর্ড করা হয়েছে — এখন শুধু সম্পূর্ণ করা বাকি।");
    }
    const providerRef = String(dto?.providerRef ?? "").trim().slice(0, 200);
    if (!providerRef) {
      throw new BadRequestException("Provider dashboard-এর refund reference/transaction ID আবশ্যক — রেফারেন্স ছাড়া ম্যানুয়াল refund রেকর্ড করা যাবে না।");
    }
    const proofNote = dto?.proofNote !== undefined && dto?.proofNote !== null ? String(dto.proofNote).trim().slice(0, 500) || null : null;
    const raw = { ...(row.gatewayStatusRaw as any), proofNote, recordedById: actorId, recordedAt: new Date().toISOString() };
    const updated = await p.paymentRefund.update({
      where: { id: row.id }, data: { status: "processing", gatewayRefundRef: providerRef, gatewayStatusRaw: raw },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "payment_refund.manual_recorded",
      entityType: "PaymentRefund", entityId: row.id,
      metadata: { provider: row.provider, amountMinor: String(row.amountMinor), providerRef, mode: "manual" },
    }).catch(() => undefined);
    return this.refundView(updated);
  }

  async completeManualRefund(organizationId: string, actorId: string, refundId: string) {
    const p: any = this.prisma as any;
    const row = await p.paymentRefund.findFirst({ where: { id: refundId, organizationId } }).catch(() => null);
    if (!row) throw new NotFoundException("Refund not found");
    if (!isManualRefundRow(row)) {
      throw new BadRequestException("এটি ম্যানুয়াল (Refund Center) রিফান্ড নয় — গেটওয়ে রিফান্ড শুধু গেটওয়ের যাচাইয়েই সম্পূর্ণ হয়।");
    }
    // Idempotent: a completed manual refund returns as stored —
    // applyVerifiedRefund's exactly-once claim is never re-run.
    if (row.status === "refunded") return this.refundView(row);
    if (row.status === "failed") {
      throw new BadRequestException("এই রিফান্ডটি ব্যর্থ হিসেবে চিহ্নিত — সম্পূর্ণ করা যাবে না।");
    }
    if (row.status !== "processing" || !row.gatewayRefundRef) {
      throw new BadRequestException("আগে provider dashboard-এ করা refund-এর reference রেকর্ড করুন — তারপরই সম্পূর্ণ করা যাবে।");
    }
    const raw = { ...(row.gatewayStatusRaw as any), completedById: actorId, completedAt: new Date().toISOString() };
    return this.applyVerifiedRefund(row, raw, actorId);
  }

  /**
   * Refund list for the Center. In-flight rows (with a gateway
   * reference) are refreshed against the gateway first — the
   * same refresh path as the POST endpoint, failure-isolated
   * per row: a gateway that cannot answer leaves the stored
   * state untouched and never fails the list.
   */
  async listRefunds(organizationId: string, actorId: string, query: { transactionId?: string; orderId?: string; limit?: number } = {}) {
    const p: any = this.prisma as any;
    const where: Record<string, unknown> = { organizationId };
    if (query.transactionId) where.tenantPaymentTransactionId = String(query.transactionId);
    if (query.orderId) where.orderId = String(query.orderId);
    const take = Math.min(200, Math.max(1, Math.round(Number(query.limit) || 50)));
    let rows: any[] = [];
    try {
      rows = await p.paymentRefund.findMany({ where, orderBy: { createdAt: "desc" }, take });
    } catch { rows = []; }
    const views: any[] = [];
    for (const row of rows ?? []) {
      if (IN_FLIGHT_STATUSES.includes(String(row.status)) && row.gatewayRefundRef && !isManualRefundRow(row)) {
        const refreshed = await this.refreshRefund(organizationId, actorId, row.id).catch(() => null);
        views.push(refreshed ?? this.refundView(row));
      } else {
        views.push(this.refundView(row));
      }
    }
    return { refunds: views };
  }
}
