import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { effectiveBkashConfig, effectiveSslcommerzConfig, effectiveWalletFeeBps } from "../common/platform-config";

/**
 * CC10 — Platform Payment + Wallet.
 *
 * Money through the PLATFORM's gateways (the operator's
 * SSLCommerz / bKash, configured in the Admin Console) lands in
 * the platform's account. The tenant's share is tracked here as
 * a wallet: an append-only ledger (WalletTransaction) plus a
 * cached balance (WalletAccount.balanceMinor) that changes ONLY
 * inside the same database transaction as the ledger row(s)
 * justifying it.
 *
 * Non-negotiable money discipline (same as CC9, extended):
 * - A wallet is credited ONLY from a server-side VERIFIED
 *   platform payment (creditVerifiedPlatformPayment is called
 *   from the verified-confirmation path of TenantPaymentsService
 *   — never from initiation, a browser return, or an unverified
 *   IPN). The credit is idempotent: a re-delivered IPN finds the
 *   transaction already verified_paid inside the credit
 *   transaction and changes nothing.
 * - The platform fee is computed server-side from the CURRENT
 *   admin walletConfig feeBps at credit time (default 0 — a fee
 *   is never invented). Ledger shape: payment_credit (+gross),
 *   then fee_debit (−fee) ONLY when fee > 0; the tenant's net
 *   credit is gross − fee.
 * - Available balance = balance − Σ amounts held by payout
 *   requests in status pending | approved. A new request, an
 *   admin approval, and mark-paid each re-validate against the
 *   CURRENT balance inside a transaction, so the balance can
 *   never go negative and holds can never jointly overdraw.
 * - Money leaves ONLY at admin mark-paid (payout_debit + balance
 *   decrement, exactly once, payoutRef recorded). There is NO
 *   tenant endpoint that creates ledger rows or credits — the
 *   only manual correction path is the admin adjustment, which
 *   requires a note and records the acting admin.
 *
 * All minor amounts cross the API as decimal strings (BigInt is
 * not JSON-serializable).
 */

export const PLATFORM_PAYMENT_PROVIDERS = ["sslcommerz", "bkash"] as const;

const HELD_STATUSES = ["pending", "approved"];

function parseMinor(value: unknown, field = "amountMinor"): bigint {
  const raw = typeof value === "bigint" ? value.toString() : String(value ?? "").trim();
  if (!/^-?\d+$/.test(raw)) throw new BadRequestException(`${field} must be an integer amount in minor units`);
  return BigInt(raw);
}

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Run `fn` inside a Prisma transaction when the client
   * supports it (production); spec fakes without $transaction
   * run it directly against the fake. */
  private async tx<T>(fn: (client: any) => Promise<T>): Promise<T> {
    const p: any = this.prisma as any;
    if (typeof p.$transaction === "function") return p.$transaction(fn);
    return fn(p);
  }

  // ---------- platform offer + tenant enablement ----------

  /** Which providers the PLATFORM can actually carry right now:
   * a provider is offered only when the operator has that
   * gateway configured in the admin platform config. Nagad and
   * Rocket are never offered — the platform checkout wires no
   * Nagad API flow (M36/M39 cover SSLCommerz + bKash only) and
   * Rocket is a manual-number path. */
  platformProviders(): { provider: string; offered: boolean }[] {
    return [
      { provider: "sslcommerz", offered: Boolean(effectiveSslcommerzConfig()) },
      { provider: "bkash", offered: Boolean(effectiveBkashConfig()) },
    ];
  }

  platformCreds(provider: string): { ssl?: any; bkash?: any } | null {
    if (provider === "sslcommerz") {
      const cfg = effectiveSslcommerzConfig();
      return cfg ? { ssl: { storeId: cfg.storeId, storePass: cfg.storePass, sandbox: cfg.sandbox } } : null;
    }
    if (provider === "bkash") {
      const cfg = effectiveBkashConfig();
      return cfg ? { bkash: { appKey: cfg.appKey, appSecret: cfg.appSecret, username: cfg.username, password: cfg.password, sandbox: cfg.sandbox } } : null;
    }
    return null;
  }

  async listPlatformPayments(organizationId: string) {
    let rows: any[] = [];
    try {
      rows = await (this.prisma as any).platformPaymentEnablement.findMany({ where: { organizationId } });
    } catch { rows = []; }
    const byProvider = new Map(rows.map((r: any) => [String(r.provider), r]));
    const feeBps = effectiveWalletFeeBps();
    return {
      feeBps,
      feePercent: feeBps / 100,
      providers: this.platformProviders().map(({ provider, offered }) => ({
        provider,
        offered,
        enabled: offered && byProvider.get(provider)?.isEnabled === true,
        enablementStatus: !offered ? "platform_not_configured" : byProvider.has(provider) ? (byProvider.get(provider).isEnabled ? "enabled" : "disabled") : "not_enabled",
      })),
    };
  }

  async isPlatformEnabled(organizationId: string, provider: string): Promise<boolean> {
    try {
      const row = await (this.prisma as any).platformPaymentEnablement.findFirst({ where: { organizationId, provider } });
      return row?.isEnabled === true;
    } catch { return false; }
  }

  async setPlatformEnabled(organizationId: string, actorId: string, providerRaw: string, isEnabled: boolean) {
    const provider = String(providerRaw ?? "").trim().toLowerCase();
    if (!(PLATFORM_PAYMENT_PROVIDERS as readonly string[]).includes(provider)) {
      throw new BadRequestException("প্ল্যাটফর্ম গেটওয়ে হিসেবে শুধু sslcommerz ও bkash চালু করা যায় — Nagad-এর কোনো প্ল্যাটফর্ম API চেকআউট সংযুক্ত নয়, Rocket ম্যানুয়াল নম্বরের পথ।");
    }
    if (isEnabled) {
      const offered = this.platformProviders().find((p) => p.provider === provider)?.offered === true;
      if (!offered) {
        throw new BadRequestException("প্ল্যাটফর্মের এই গেটওয়েটি এখনো কনফিগার করা হয়নি — প্ল্যাটফর্ম অ্যাডমিন গেটওয়ে যোগ না করা পর্যন্ত এটি চালু করা যাবে না।");
      }
    }
    const existing = await (this.prisma as any).platformPaymentEnablement.findFirst({ where: { organizationId, provider } }).catch(() => null);
    const row = existing
      ? await (this.prisma as any).platformPaymentEnablement.update({ where: { id: existing.id }, data: { isEnabled: Boolean(isEnabled) } })
      : await (this.prisma as any).platformPaymentEnablement.create({ data: { organizationId, provider, isEnabled: Boolean(isEnabled) } });
    await this.audit.log({
      organizationId, userId: actorId, action: "platform_payment.enablement_changed",
      entityType: "PlatformPaymentEnablement", entityId: row.id,
      metadata: { provider, isEnabled: Boolean(isEnabled) },
    });
    return this.listPlatformPayments(organizationId);
  }

  // ---------- wallet reads ----------

  private async getOrCreateWallet(client: any, organizationId: string, currency = "BDT"): Promise<any> {
    const found = await client.walletAccount.findUnique({ where: { organizationId } });
    if (found) return found;
    return client.walletAccount.create({ data: { organizationId, currency, balanceMinor: 0n } });
  }

  /** Σ amounts held by pending/approved payout requests. */
  private async heldMinor(client: any, organizationId: string, excludeRequestId?: string): Promise<bigint> {
    const rows = await client.payoutRequest.findMany({ where: { organizationId, status: { in: HELD_STATUSES } } });
    return (rows ?? []).reduce(
      (sum: bigint, r: any) => (excludeRequestId && r.id === excludeRequestId ? sum : sum + BigInt(r.amountMinor)),
      0n,
    );
  }

  private ledgerView(row: any) {
    return {
      id: row.id, type: row.type,
      amountMinor: String(row.amountMinor), balanceAfterMinor: String(row.balanceAfterMinor),
      refType: row.refType ?? null, refId: row.refId ?? null, note: row.note ?? null,
      createdAt: row.createdAt,
    };
  }

  async getWallet(organizationId: string) {
    const p: any = this.prisma as any;
    let account: any = null;
    try { account = await p.walletAccount.findUnique({ where: { organizationId } }); } catch { account = null; }
    const balance = account ? BigInt(account.balanceMinor) : 0n;
    const held = account ? await this.heldMinor(p, organizationId).catch(() => 0n) : 0n;
    let ledger: any[] = [];
    if (account) {
      try {
        ledger = await p.walletTransaction.findMany({
          where: { organizationId }, orderBy: { createdAt: "desc" }, take: 50,
        });
      } catch { ledger = []; }
    }
    return {
      currency: account?.currency ?? "BDT",
      balanceMinor: balance.toString(),
      heldMinor: held.toString(),
      availableMinor: (balance - held).toString(),
      feeBps: effectiveWalletFeeBps(),
      ledger: (ledger ?? []).map((r: any) => this.ledgerView(r)),
    };
  }

  // ---------- the verified-platform-payment credit ----------

  /**
   * THE credit path. Called ONLY from TenantPaymentsService's
   * verified-confirmation flow (markVerifiedPaid) for a
   * source="platform" transaction, after the gateway's
   * server-side verification chain has fully passed. Runs as ONE
   * database transaction: transaction → verified_paid, the order
   * evidence note, the wallet credit and its ledger rows either
   * all land or none do. Re-delivery is a no-op: the status
   * re-check happens INSIDE the transaction.
   */
  async creditVerifiedPlatformPayment(txn: any, evidence: { valId?: string; payload: any; providerTxnId?: string }) {
    return this.tx(async (client) => {
      const fresh = await client.tenantPaymentTransaction.findFirst({ where: { id: txn.id } });
      if (!fresh) return { ok: false, reason: "transaction not found" };
      if (fresh.status === "verified_paid") return { ok: true, alreadyProcessed: true };
      if (fresh.source !== "platform") return { ok: false, reason: "not a platform transaction" };

      const updated = await client.tenantPaymentTransaction.update({
        where: { id: fresh.id },
        data: {
          status: "verified_paid",
          valId: evidence.valId ?? fresh.valId ?? null,
          providerTxnId: evidence.providerTxnId ?? fresh.providerTxnId ?? null,
          ipnPayload: evidence.payload ?? null,
        },
      });

      const order = await client.order.findFirst({ where: { id: fresh.orderId, organizationId: fresh.organizationId } }).catch(() => null);
      if (order) {
        const note = `[অনলাইন পেমেন্ট যাচাইকৃত — প্ল্যাটফর্ম ${fresh.provider} · txn ${fresh.id}]`;
        const internalNote = String(order.internalNote ?? "").includes(fresh.id)
          ? order.internalNote
          : [String(order.internalNote ?? "").trim(), note].filter(Boolean).join(" | ");
        await client.order.update({
          where: { id: order.id },
          data: { paymentMethod: fresh.provider, isCod: false, internalNote },
        }).catch(() => undefined);
      }

      const wallet = await this.getOrCreateWallet(client, fresh.organizationId, String(fresh.currency ?? "BDT"));
      const amount = BigInt(fresh.amountMinor);
      const feeBps = effectiveWalletFeeBps();
      const fee = (amount * BigInt(feeBps)) / 10_000n;
      let balance = BigInt(wallet.balanceMinor) + amount;
      await client.walletTransaction.create({
        data: {
          organizationId: fresh.organizationId, walletId: wallet.id, type: "payment_credit",
          amountMinor: amount, balanceAfterMinor: balance,
          refType: "tenant_payment_transaction", refId: fresh.id,
          note: `প্ল্যাটফর্ম গেটওয়ে পেমেন্ট (${fresh.provider})`,
        },
      });
      if (fee > 0n) {
        balance -= fee;
        await client.walletTransaction.create({
          data: {
            organizationId: fresh.organizationId, walletId: wallet.id, type: "fee_debit",
            amountMinor: -fee, balanceAfterMinor: balance,
            refType: "tenant_payment_transaction", refId: fresh.id,
            note: `প্ল্যাটফর্ম ফি (${feeBps} bps)`,
          },
        });
      }
      await client.walletAccount.update({ where: { id: wallet.id }, data: { balanceMinor: balance } });
      return { ok: true, transaction: updated, creditedMinor: amount - fee, feeMinor: fee };
    });
  }

  // ---------- tenant payout requests ----------

  private payoutView(row: any, orgName?: string | null) {
    return {
      id: row.id, organizationId: row.organizationId,
      ...(orgName !== undefined ? { organizationName: orgName } : {}),
      amountMinor: String(row.amountMinor), method: row.method, destination: row.destination ?? null,
      status: row.status, adminNote: row.adminNote ?? null, payoutRef: row.payoutRef ?? null,
      requestedById: row.requestedById, decidedById: row.decidedById ?? null,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  async listPayoutRequests(organizationId: string) {
    let rows: any[] = [];
    try {
      rows = await (this.prisma as any).payoutRequest.findMany({
        where: { organizationId }, orderBy: { createdAt: "desc" }, take: 50,
      });
    } catch { rows = []; }
    return { requests: (rows ?? []).map((r: any) => this.payoutView(r)) };
  }

  async createPayoutRequest(organizationId: string, actorId: string, dto: { amountMinor?: unknown; method?: string; destination?: any }) {
    const amount = parseMinor(dto?.amountMinor);
    if (amount <= 0n) throw new BadRequestException("Payout-এর পরিমাণ শূন্যের বেশি হতে হবে।");
    const method = String(dto?.method ?? "").trim().toLowerCase();
    if (method !== "bkash" && method !== "bank") throw new BadRequestException("Payout method হতে হবে bkash অথবা bank।");
    const destination = dto?.destination;
    if (!destination || typeof destination !== "object" || Array.isArray(destination)) {
      throw new BadRequestException("Payout গন্তব্যের তথ্য প্রয়োজন।");
    }
    if (method === "bkash" && !String(destination.number ?? "").trim()) {
      throw new BadRequestException("bKash payout-এর জন্য নম্বর প্রয়োজন।");
    }
    if (method === "bank" && (!String(destination.accountNumber ?? "").trim() || !String(destination.bankName ?? "").trim())) {
      throw new BadRequestException("Bank payout-এর জন্য অ্যাকাউন্ট নম্বর ও ব্যাংকের নাম প্রয়োজন।");
    }
    const created = await this.tx(async (client) => {
      const wallet = await this.getOrCreateWallet(client, organizationId);
      const balance = BigInt(wallet.balanceMinor);
      const held = await this.heldMinor(client, organizationId);
      if (amount > balance - held) {
        throw new BadRequestException(`উপলব্ধ ব্যালেন্সের বেশি payout চাওয়া যাবে না — ব্যালেন্স ${balance}, আটকে থাকা (pending/approved) ${held}, উপলব্ধ ${balance - held}।`);
      }
      return client.payoutRequest.create({
        data: { organizationId, walletId: wallet.id, amountMinor: amount, method, destination, status: "pending", requestedById: actorId },
      });
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "wallet.payout_requested",
      entityType: "PayoutRequest", entityId: created.id,
      metadata: { amountMinor: amount.toString(), method },
    });
    return this.payoutView(created);
  }

  async cancelPayoutRequest(organizationId: string, actorId: string, requestId: string) {
    const row = await (this.prisma as any).payoutRequest.findFirst({ where: { id: requestId, organizationId } }).catch(() => null);
    if (!row) throw new NotFoundException("Payout request not found");
    if (row.status !== "pending") {
      throw new BadRequestException("শুধু pending অনুরোধই নিজে বাতিল করা যায় — approved অনুরোধের জন্য অ্যাডমিনের সিদ্ধান্ত লাগবে।");
    }
    const updated = await (this.prisma as any).payoutRequest.update({ where: { id: row.id }, data: { status: "cancelled" } });
    await this.audit.log({
      organizationId, userId: actorId, action: "wallet.payout_cancelled",
      entityType: "PayoutRequest", entityId: row.id, metadata: { amountMinor: String(row.amountMinor) },
    });
    return this.payoutView(updated);
  }

  // ---------- admin: decisions, mark-paid, adjustment ----------

  async adminListPayoutRequests(status?: string) {
    const p: any = this.prisma as any;
    const where = status ? { status: String(status) } : {};
    let rows: any[] = [];
    try { rows = await p.payoutRequest.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 }); } catch { rows = []; }
    const orgIds = [...new Set((rows ?? []).map((r: any) => r.organizationId))];
    const orgs = orgIds.length
      ? await p.organization.findMany({ where: { id: { in: orgIds } } }).catch(() => [])
      : [];
    const names = new Map<string, string | null>((orgs ?? []).map((o: any) => [o.id, o.name ?? null] as [string, string | null]));
    return { requests: (rows ?? []).map((r: any) => this.payoutView(r, names.get(r.organizationId) ?? null)) };
  }

  async adminDecidePayout(admin: { id: string }, requestId: string, action: "approve" | "reject", note?: string) {
    if (action === "reject" && !String(note ?? "").trim()) {
      throw new BadRequestException("Reject করতে হলে কারণ (note) আবশ্যক — tenant তা দেখতে পাবে।");
    }
    const result = await this.tx(async (client) => {
      const row = await client.payoutRequest.findFirst({ where: { id: requestId } });
      if (!row) throw new NotFoundException("Payout request not found");
      if (action === "approve") {
        if (row.status !== "pending") throw new BadRequestException(`শুধু pending অনুরোধ approve করা যায় (বর্তমান: ${row.status})।`);
        // Re-validate at decision time: the balance or other
        // holds may have changed since the request was made.
        const wallet = await client.walletAccount.findUnique({ where: { organizationId: row.organizationId } });
        if (!wallet) throw new BadRequestException("Wallet পাওয়া যায়নি।");
        const balance = BigInt(wallet.balanceMinor);
        const heldOthers = await this.heldMinor(client, row.organizationId, row.id);
        if (BigInt(row.amountMinor) > balance - heldOthers) {
          throw new BadRequestException("বর্তমান উপলব্ধ ব্যালেন্স এই payout-এর জন্য যথেষ্ট নয় — approve করা যাবে না।");
        }
        return client.payoutRequest.update({
          where: { id: row.id },
          data: { status: "approved", decidedById: admin.id, adminNote: String(note ?? "").trim() || row.adminNote || null },
        });
      }
      if (row.status !== "pending" && row.status !== "approved") {
        throw new BadRequestException(`এই অনুরোধের সিদ্ধান্ত ইতিমধ্যে হয়ে গেছে (বর্তমান: ${row.status})।`);
      }
      // Rejecting frees the hold automatically: the available
      // formula only counts pending | approved rows.
      return client.payoutRequest.update({
        where: { id: row.id },
        data: { status: "rejected", decidedById: admin.id, adminNote: String(note).trim() },
      });
    });
    await this.audit.log({
      organizationId: result.organizationId, userId: admin.id, action: `admin.wallet_payout_${action === "approve" ? "approved" : "rejected"}`,
      entityType: "PayoutRequest", entityId: result.id,
      metadata: { amountMinor: String(result.amountMinor), note: note ?? null },
    });
    return this.payoutView(result);
  }

  async adminMarkPaid(admin: { id: string }, requestId: string, payoutRef?: string) {
    const ref = String(payoutRef ?? "").trim();
    if (!ref) throw new BadRequestException("Mark-paid করতে হলে আসল payout-এর reference (payoutRef) আবশ্যক।");
    const result = await this.tx(async (client) => {
      const row = await client.payoutRequest.findFirst({ where: { id: requestId } });
      if (!row) throw new NotFoundException("Payout request not found");
      if (row.status === "paid") throw new BadRequestException("এই payout ইতিমধ্যে paid — আবার debit করা হবে না।");
      if (row.status !== "approved") throw new BadRequestException(`শুধু approved অনুরোধই paid করা যায় (বর্তমান: ${row.status})।`);
      const wallet = await client.walletAccount.findUnique({ where: { organizationId: row.organizationId } });
      if (!wallet) throw new BadRequestException("Wallet পাওয়া যায়নি।");
      const amount = BigInt(row.amountMinor);
      const balance = BigInt(wallet.balanceMinor);
      // Final overdraw guard, inside the same transaction: even
      // if the balance changed after approval, money cannot
      // leave beyond (balance − other holds).
      const heldOthers = await this.heldMinor(client, row.organizationId, row.id);
      if (amount > balance - heldOthers || amount > balance) {
        throw new BadRequestException("বর্তমান ব্যালেন্স এই payout-এর জন্য যথেষ্ট নয় — paid করা যাবে না।");
      }
      const balanceAfter = balance - amount;
      await client.walletTransaction.create({
        data: {
          organizationId: row.organizationId, walletId: wallet.id, type: "payout_debit",
          amountMinor: -amount, balanceAfterMinor: balanceAfter,
          refType: "payout_request", refId: row.id,
          note: `Payout (${row.method}) · ref ${ref}`,
        },
      });
      await client.walletAccount.update({ where: { id: wallet.id }, data: { balanceMinor: balanceAfter } });
      return client.payoutRequest.update({
        where: { id: row.id },
        data: { status: "paid", payoutRef: ref, decidedById: admin.id },
      });
    });
    await this.audit.log({
      organizationId: result.organizationId, userId: admin.id, action: "admin.wallet_payout_paid",
      entityType: "PayoutRequest", entityId: result.id,
      metadata: { amountMinor: String(result.amountMinor), payoutRef: ref },
    });
    return this.payoutView(result);
  }

  /**
   * The manual correction path — the ONLY way a ledger row is
   * created outside a verified payment or a payout. A note is
   * mandatory and the acting admin is recorded on the row itself
   * (createdById) and in the audit log. The result can never
   * drive the balance negative.
   */
  async adminAdjustWallet(admin: { id: string }, organizationId: string, dto: { amountMinor?: unknown; note?: string }) {
    const note = String(dto?.note ?? "").trim();
    if (!note) throw new BadRequestException("Adjustment-এর জন্য note আবশ্যক — কারণ ছাড়া কোনো সংশোধন হবে না।");
    const amount = parseMinor(dto?.amountMinor);
    if (amount === 0n) throw new BadRequestException("Adjustment-এর পরিমাণ শূন্য হতে পারবে না।");
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } }).catch(() => null);
    if (!org) throw new NotFoundException("Organization not found");
    const entry = await this.tx(async (client) => {
      const wallet = await this.getOrCreateWallet(client, organizationId);
      const balanceAfter = BigInt(wallet.balanceMinor) + amount;
      if (balanceAfter < 0n) throw new BadRequestException("এই adjustment ব্যালেন্সকে নেগেটিভ করে দেবে — করা যাবে না।");
      const row = await client.walletTransaction.create({
        data: {
          organizationId, walletId: wallet.id, type: "adjustment",
          amountMinor: amount, balanceAfterMinor: balanceAfter,
          refType: "admin_adjustment", note, createdById: admin.id,
        },
      });
      await client.walletAccount.update({ where: { id: wallet.id }, data: { balanceMinor: balanceAfter } });
      return row;
    });
    await this.audit.log({
      organizationId, userId: admin.id, action: "admin.wallet_adjustment",
      entityType: "WalletTransaction", entityId: entry.id,
      metadata: { amountMinor: amount.toString(), note },
    });
    return this.ledgerView(entry);
  }
}
