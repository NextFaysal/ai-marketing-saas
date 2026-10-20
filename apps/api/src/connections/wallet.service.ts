import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import {
  assertPayoutAutomationAllowed, payoutLegalGateState, readPayoutLegalGate,
  PAYOUT_GATE_NO_CONFIRMATION_MSG,
} from "./payout-legal-gate";
import { AuditService } from "../audit/audit.service";
import { effectiveBkashConfig, effectivePayoutFourEyesThresholdMinor, effectiveSslcommerzConfig, effectiveWalletFeeBps } from "../common/platform-config";
import { StepUpService, stepUpMarker } from "./step-up.service";
import { buildPdf, moneyText, PdfCanvas } from "../courier/pdf";
import { dhakaDayKey, dhakaDayStartUtc } from "../crm/lead-followups";
import { badRequest, notFound } from "../i18n";

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
  if (!/^-?\d+$/.test(raw)) throw badRequest("connections.fieldIntegerMinorAmount", { field: field });
  return BigInt(raw);
}

@Injectable()
export class WalletService {
  private readonly stepUp: StepUpService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() stepUpService?: StepUpService,
  ) {
    this.stepUp = stepUpService ?? new StepUpService(prisma as any);
  }

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
      throw badRequest("connections.platformGatewayProvidersOnly");
    }
    if (isEnabled) {
      const offered = this.platformProviders().find((p) => p.provider === provider)?.offered === true;
      if (!offered) {
        throw badRequest("connections.platformGatewayNotConfiguredAdmin");
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

  // ---------- CC19: wallet statement (read + export only) ----------

  /**
   * The statement for a period, computed FROM THE LEDGER: the
   * opening balance is the balanceAfterMinor of the last ledger
   * row BEFORE the period (0 when none — the ledger starts at
   * zero by construction), the entries are the period's rows in
   * order, and the closing balance is the last entry's
   * balanceAfterMinor (or the opening when the period is
   * empty). Nothing is recomputed from anywhere else: if the
   * ledger chain says it, the statement says it.
   * Range: `from` inclusive, `to` EXCLUSIVE (the controllers
   * pass a date-only `to` as the following midnight).
   */
  async getStatement(organizationId: string, range: { from?: Date | null; to?: Date | null } = {}) {
    const p: any = this.prisma as any;
    let account: any = null;
    try { account = await p.walletAccount.findUnique({ where: { organizationId } }); } catch { account = null; }
    let rows: any[] = [];
    try {
      rows = await p.walletTransaction.findMany({
        where: { organizationId }, orderBy: { createdAt: "asc" }, take: 10000,
      });
    } catch { rows = []; }
    const from = range.from ?? new Date(0);
    const to = range.to ?? new Date();
    let opening = 0n;
    const entries: any[] = [];
    for (const row of rows ?? []) {
      const at = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
      if (at < from) { opening = BigInt(row.balanceAfterMinor); continue; }
      if (at >= to) break;
      entries.push(row);
    }
    const closing = entries.length ? BigInt(entries[entries.length - 1].balanceAfterMinor) : opening;
    return {
      organizationId,
      currency: account?.currency ?? "BDT",
      from, to,
      openingMinor: opening.toString(),
      closingMinor: closing.toString(),
      entries: entries.map((r: any) => this.ledgerView(r)),
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
      // CC26: the saved destination this request was made
      // against (details themselves are the snapshot in
      // `destination`) + whether the payout sweep created it.
      destinationId: row.destinationId ?? null,
      createdBySystem: row.createdBySystem === true,
      status: row.status, adminNote: row.adminNote ?? null, payoutRef: row.payoutRef ?? null,
      requestedById: row.requestedById, decidedById: row.decidedById ?? null,
      approvedById: row.approvedById ?? null,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  /** The per-method destination-details contract, shared by
   * free-form payout requests (CC10) and saved destinations
   * (CC26): bKash needs a number; bank needs account number +
   * bank name. */
  private assertDestinationDetails(method: string, destination: any): void {
    if (!destination || typeof destination !== "object" || Array.isArray(destination)) {
      throw badRequest("connections.payoutDestinationDetailsRequired");
    }
    if (method === "bkash" && !String(destination.number ?? "").trim()) {
      throw badRequest("connections.bkashPayoutNumberRequired");
    }
    if (method === "bank" && (!String(destination.accountNumber ?? "").trim() || !String(destination.bankName ?? "").trim())) {
      throw badRequest("connections.bankPayoutDetailsRequired");
    }
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

  async createPayoutRequest(organizationId: string, actorId: string, dto: { amountMinor?: unknown; method?: string; destination?: any; destinationId?: string | null; totpCode?: string | null }) {
    // CC23: asking money OUT of the wallet is a sensitive
    // action — TOTP step-up runs before any validation or row
    // creation (a refused check creates nothing).
    const stepUp = await this.stepUp.check(actorId, dto?.totpCode);
    const amount = parseMinor(dto?.amountMinor);
    if (amount <= 0n) throw badRequest("connections.payoutAmountPositive");
    // CC26: a saved destination supplies the method + details
    // (snapshotted onto the request — later edits to the
    // destination never rewrite this request); without one the
    // CC10 free-form contract applies unchanged.
    let method: string;
    let destination: any;
    let destinationId: string | null = null;
    if (dto?.destinationId) {
      const dest = await (this.prisma as any).payoutDestination.findFirst({
        where: { id: String(dto.destinationId), organizationId },
      }).catch(() => null);
      if (!dest) throw notFound("connections.payoutDestinationNotFound");
      method = String(dest.method);
      destination = dest.details;
      destinationId = dest.id;
    } else {
      method = String(dto?.method ?? "").trim().toLowerCase();
      if (method !== "bkash" && method !== "bank") throw badRequest("connections.payoutMethodInvalid");
      destination = dto?.destination;
      this.assertDestinationDetails(method, destination);
    }
    const created = await this.tx(async (client) => {
      const wallet = await this.getOrCreateWallet(client, organizationId);
      const balance = BigInt(wallet.balanceMinor);
      const held = await this.heldMinor(client, organizationId);
      if (amount > balance - held) {
        throw badRequest("connections.payoutExceedsAvailable", { balance: balance, held: held, available: balance - held });
      }
      return client.payoutRequest.create({
        data: { organizationId, walletId: wallet.id, amountMinor: amount, method, destination, destinationId, status: "pending", requestedById: actorId },
      });
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "wallet.payout_requested",
      entityType: "PayoutRequest", entityId: created.id,
      metadata: { amountMinor: amount.toString(), method, stepUp },
    });
    return { ...this.payoutView(created), ...stepUpMarker(stepUp) };
  }

  async cancelPayoutRequest(organizationId: string, actorId: string, requestId: string) {
    const row = await (this.prisma as any).payoutRequest.findFirst({ where: { id: requestId, organizationId } }).catch(() => null);
    if (!row) throw notFound("connections.payoutRequestNotFound");
    if (row.status !== "pending") {
      throw badRequest("connections.payoutCancelPendingOnly");
    }
    const updated = await (this.prisma as any).payoutRequest.update({ where: { id: row.id }, data: { status: "cancelled" } });
    await this.audit.log({
      organizationId, userId: actorId, action: "wallet.payout_cancelled",
      entityType: "PayoutRequest", entityId: row.id, metadata: { amountMinor: String(row.amountMinor) },
    });
    return this.payoutView(updated);
  }

  // ---------- CC26: payout destinations ----------

  /** Mask an account identifier beyond its last 4 characters
   * for list views. The full value stays on the row (payouts
   * need it) and on the tenant's own edit form read; lists —
   * the shoulder-surfing surface — show only the tail. */
  private maskIdentifier(value: unknown): string {
    const s = String(value ?? "");
    if (!s) return "";
    if (s.length <= 4) return "••••";
    return `${"•".repeat(Math.min(8, s.length - 4))}${s.slice(-4)}`;
  }

  private destinationView(row: any, mask = true) {
    const details = (row.details && typeof row.details === "object") ? { ...row.details } : {};
    if (mask) {
      if (details.number !== undefined) details.number = this.maskIdentifier(details.number);
      if (details.accountNumber !== undefined) details.accountNumber = this.maskIdentifier(details.accountNumber);
    }
    return {
      id: row.id, label: row.label, method: row.method, details,
      isDefault: row.isDefault === true, createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  async listDestinations(organizationId: string) {
    let rows: any[] = [];
    try {
      rows = await (this.prisma as any).payoutDestination.findMany({
        where: { organizationId }, orderBy: { createdAt: "asc" }, take: 50,
      });
    } catch { rows = []; }
    return { destinations: (rows ?? []).map((r: any) => this.destinationView(r)) };
  }

  /** One destination, UNMASKED — for the owner's own edit form.
   * Tenant-scoped like every read here; never cross-org. */
  async getDestination(organizationId: string, destinationId: string) {
    const row = await (this.prisma as any).payoutDestination.findFirst({
      where: { id: destinationId, organizationId },
    }).catch(() => null);
    if (!row) throw notFound("connections.payoutDestinationNotFound");
    return this.destinationView(row, false);
  }

  async createDestination(organizationId: string, actorId: string, dto: { label?: string; method?: string; details?: any; isDefault?: boolean }) {
    const label = String(dto?.label ?? "").trim();
    if (!label) throw badRequest("connections.destinationLabelNeeded");
    const method = String(dto?.method ?? "").trim().toLowerCase();
    if (method !== "bkash" && method !== "bank") throw badRequest("connections.destinationMethodInvalid");
    this.assertDestinationDetails(method, dto?.details);
    const created = await this.tx(async (client) => {
      const existing = await client.payoutDestination.findMany({ where: { organizationId } });
      const makeDefault = dto?.isDefault === true || (existing ?? []).length === 0;
      if (makeDefault) {
        for (const other of existing ?? []) {
          if (other.isDefault) await client.payoutDestination.update({ where: { id: other.id }, data: { isDefault: false } });
        }
      }
      return client.payoutDestination.create({
        data: { organizationId, label, method, details: dto.details, isDefault: makeDefault },
      });
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "wallet.destination_created",
      entityType: "PayoutDestination", entityId: created.id,
      metadata: { method, isDefault: created.isDefault === true },
    });
    return this.destinationView(created, false);
  }

  async updateDestination(organizationId: string, actorId: string, destinationId: string, dto: { label?: string; details?: any; isDefault?: boolean }) {
    const p: any = this.prisma as any;
    const row = await p.payoutDestination.findFirst({ where: { id: destinationId, organizationId } }).catch(() => null);
    if (!row) throw notFound("connections.payoutDestinationNotFound");
    const data: Record<string, unknown> = {};
    if (dto?.label !== undefined) {
      const label = String(dto.label).trim();
      if (!label) throw badRequest("connections.destinationLabelNeeded");
      data.label = label;
    }
    if (dto?.details !== undefined) {
      this.assertDestinationDetails(String(row.method), dto.details);
      data.details = dto.details;
    }
    const updated = await this.tx(async (client) => {
      if (dto?.isDefault === true && !row.isDefault) {
        const others = await client.payoutDestination.findMany({ where: { organizationId, isDefault: true } });
        for (const other of others ?? []) {
          if (other.id !== row.id) await client.payoutDestination.update({ where: { id: other.id }, data: { isDefault: false } });
        }
        data.isDefault = true;
      } else if (dto?.isDefault === false) {
        // Explicitly un-defaulting is allowed: the org then
        // has NO default until one is chosen (the sweep falls
        // back to a schedule-named destination only).
        data.isDefault = false;
      }
      return client.payoutDestination.update({ where: { id: row.id }, data });
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "wallet.destination_updated",
      entityType: "PayoutDestination", entityId: row.id,
      metadata: { fields: Object.keys(data) },
    });
    return this.destinationView(updated, false);
  }

  async deleteDestination(organizationId: string, actorId: string, destinationId: string) {
    const p: any = this.prisma as any;
    const row = await p.payoutDestination.findFirst({ where: { id: destinationId, organizationId } }).catch(() => null);
    if (!row) throw notFound("connections.payoutDestinationNotFound");
    await this.tx(async (client) => {
      await client.payoutDestination.delete({ where: { id: row.id } });
      // A schedule pointing at a deleted destination falls
      // back to "org default" rather than dangling.
      const schedule = await client.payoutSchedule.findUnique({ where: { organizationId } }).catch(() => null);
      if (schedule && schedule.destinationId === row.id) {
        await client.payoutSchedule.update({ where: { id: schedule.id }, data: { destinationId: null } });
      }
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "wallet.destination_deleted",
      entityType: "PayoutDestination", entityId: row.id, metadata: { method: row.method },
    });
    return { id: row.id, deleted: true };
  }

  // ---------- CC26: payout schedule + the sweep ----------

  private scheduleView(row: any) {
    return {
      id: row.id, enabled: row.enabled === true, cadence: row.cadence,
      dayOfWeek: row.dayOfWeek ?? null, dayOfMonth: row.dayOfMonth ?? null,
      thresholdMinor: String(row.thresholdMinor ?? 0), destinationId: row.destinationId ?? null,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  async getSchedule(organizationId: string) {
    let row: any = null;
    try { row = await (this.prisma as any).payoutSchedule.findUnique({ where: { organizationId } }); } catch { row = null; }
    return { schedule: row ? this.scheduleView(row) : null };
  }

  async putSchedule(organizationId: string, actorId: string, dto: {
    enabled?: boolean; cadence?: string; dayOfWeek?: number | null; dayOfMonth?: number | null;
    thresholdMinor?: unknown; destinationId?: string | null;
  }) {
    const cadence = String(dto?.cadence ?? "").trim().toLowerCase();
    if (cadence !== "weekly" && cadence !== "monthly") throw badRequest("connections.scheduleCadenceInvalid");
    let dayOfWeek: number | null = null;
    let dayOfMonth: number | null = null;
    if (cadence === "weekly") {
      dayOfWeek = Number(dto?.dayOfWeek);
      if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
        throw badRequest("connections.weeklyNeedsDayOfWeek");
      }
    } else {
      dayOfMonth = Number(dto?.dayOfMonth);
      if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28) {
        throw badRequest("connections.monthlyNeedsDayOfMonth");
      }
    }
    const threshold = parseMinor(dto?.thresholdMinor ?? "0", "thresholdMinor");
    if (threshold < 0n) throw badRequest("connections.thresholdMinorNegative");
    let destinationId: string | null = null;
    if (dto?.destinationId) {
      const dest = await (this.prisma as any).payoutDestination.findFirst({
        where: { id: String(dto.destinationId), organizationId },
      }).catch(() => null);
      if (!dest) throw notFound("connections.payoutDestinationNotFound");
      destinationId = dest.id;
    }
    const data = {
      enabled: dto?.enabled === true, cadence, dayOfWeek, dayOfMonth,
      thresholdMinor: threshold, destinationId,
    };
    const p: any = this.prisma as any;
    const existing = await p.payoutSchedule.findUnique({ where: { organizationId } }).catch(() => null);
    const row = existing
      ? await p.payoutSchedule.update({ where: { id: existing.id }, data })
      : await p.payoutSchedule.create({ data: { organizationId, ...data } });
    await this.audit.log({
      organizationId, userId: actorId, action: "wallet.payout_schedule_saved",
      entityType: "PayoutSchedule", entityId: row.id,
      metadata: { enabled: data.enabled, cadence, thresholdMinor: threshold.toString() },
    });
    return this.scheduleView(row);
  }

  /**
   * The wallet_payout_sweep job body (CC26). On the org's
   * scheduled Asia/Dhaka day, when the AVAILABLE balance
   * (balance − pending/approved holds, the CC10 formula) is at
   * or above the schedule threshold, it creates ONE pending
   * PayoutRequest for the FULL available balance against the
   * schedule's (or the org's default) destination.
   *
   * The sweep NEVER approves or pays — the request joins the
   * ordinary human chain (admin approve → mark-paid). One slot
   * creates at most one request: a second run inside the same
   * Dhaka day finds the system request it already made and
   * stops. Every skip is a returned reason, never a silent
   * nothing — and a skipped sweep creates no rows.
   */
  async runPayoutSweep(organizationId: string, now: Date = new Date()) {
    const p: any = this.prisma as any;
    const schedule = await p.payoutSchedule.findUnique({ where: { organizationId } }).catch(() => null);
    if (!schedule) return { skipped: true, reason: "no_schedule" };
    if (schedule.enabled !== true) return { skipped: true, reason: "schedule_disabled" };

    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Dhaka", weekday: "short", day: "numeric",
    }).formatToParts(now);
    const weekdayName = parts.find((x) => x.type === "weekday")?.value ?? "";
    const dayOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayName);
    const dayOfMonth = Number(parts.find((x) => x.type === "day")?.value ?? 0);
    const isSlotDay = schedule.cadence === "weekly"
      ? dayOfWeek === Number(schedule.dayOfWeek)
      : dayOfMonth === Number(schedule.dayOfMonth);
    if (!isSlotDay) return { skipped: true, reason: "not_scheduled_day", cadence: schedule.cadence };

    const slotStart = dhakaDayStartUtc(now).getTime();
    const prior = await p.payoutRequest.findMany({
      where: { organizationId, createdBySystem: true },
    }).catch(() => []);
    const already = (prior ?? []).find((r: any) => {
      const at = new Date(r.createdAt).getTime();
      return at >= slotStart && at < slotStart + 24 * 3600 * 1000;
    });
    if (already) return { skipped: true, reason: "already_created_for_slot", requestId: already.id };

    const destinations = await p.payoutDestination.findMany({ where: { organizationId } }).catch(() => []);
    const destination = (destinations ?? []).find((d: any) => d.id === schedule.destinationId)
      ?? (destinations ?? []).find((d: any) => d.isDefault === true)
      ?? null;
    if (!destination) return { skipped: true, reason: "no_destination" };

    const created = await this.tx(async (client) => {
      const wallet = await this.getOrCreateWallet(client, organizationId);
      const balance = BigInt(wallet.balanceMinor);
      const held = await this.heldMinor(client, organizationId);
      const available = balance - held;
      if (available <= 0n || available < BigInt(schedule.thresholdMinor)) return null;
      return client.payoutRequest.create({
        data: {
          organizationId, walletId: wallet.id, amountMinor: available,
          method: String(destination.method), destination: destination.details,
          destinationId: destination.id, status: "pending",
          requestedById: "system", createdBySystem: true,
        },
      });
    });
    if (!created) {
      const wallet = await p.walletAccount.findUnique({ where: { organizationId } }).catch(() => null);
      const balance = wallet ? BigInt(wallet.balanceMinor) : 0n;
      const held = await this.heldMinor(p, organizationId).catch(() => 0n);
      return { skipped: true, reason: "below_threshold", availableMinor: (balance - held).toString(), thresholdMinor: String(schedule.thresholdMinor) };
    }
    await this.audit.log({
      organizationId, userId: "system", action: "wallet.payout_auto_requested",
      entityType: "PayoutRequest", entityId: created.id,
      metadata: {
        scheduleId: schedule.id, cadence: schedule.cadence, slotDay: dhakaDayKey(now),
        amountMinor: String(created.amountMinor), destinationId: destination.id,
      },
    });
    return { created: true, requestId: created.id, amountMinor: String(created.amountMinor), destinationId: destination.id };
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
      throw badRequest("connections.rejectReasonRequired");
    }
    const result = await this.tx(async (client) => {
      const row = await client.payoutRequest.findFirst({ where: { id: requestId } });
      if (!row) throw notFound("connections.payoutRequestNotFound");
      if (action === "approve") {
        if (row.status !== "pending") throw badRequest("connections.payoutApprovePendingOnly", { status: row.status });
        // Re-validate at decision time: the balance or other
        // holds may have changed since the request was made.
        const wallet = await client.walletAccount.findUnique({ where: { organizationId: row.organizationId } });
        if (!wallet) throw badRequest("connections.walletNotFound");
        const balance = BigInt(wallet.balanceMinor);
        const heldOthers = await this.heldMinor(client, row.organizationId, row.id);
        if (BigInt(row.amountMinor) > balance - heldOthers) {
          throw badRequest("connections.payoutApproveInsufficientBalance");
        }
        return client.payoutRequest.update({
          where: { id: row.id },
          // CC23: approvedById is persisted SEPARATELY from
          // decidedById (which later decisions overwrite) —
          // the four-eyes mark-paid check reads this column.
          data: { status: "approved", decidedById: admin.id, approvedById: admin.id, adminNote: String(note ?? "").trim() || row.adminNote || null },
        });
      }
      if (row.status !== "pending" && row.status !== "approved") {
        throw badRequest("connections.payoutAlreadyDecided", { status: row.status });
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
    if (!ref) throw badRequest("connections.markPaidReferenceRequired");
    // CC23 four-eyes: when the operator has set
    // walletConfig.payoutFourEyesThresholdMinor and this
    // payout is at/above it, the admin who APPROVED the
    // request may not also mark it paid — a second admin must
    // complete it. The rule reads the approver recorded at
    // approve time (approvedById); rows with no recorded
    // approver (approved before CC23) cannot be checked and
    // are not blocked. Feature off (threshold unset/null) =
    // no change to the CC10 behaviour.
    const fourEyesThreshold = effectivePayoutFourEyesThresholdMinor();
    if (fourEyesThreshold !== null) {
      const peek = await (this.prisma as any).payoutRequest.findFirst({ where: { id: requestId } }).catch(() => null);
      if (peek && peek.approvedById && String(peek.approvedById) === String(admin.id)
        && BigInt(peek.amountMinor) >= BigInt(fourEyesThreshold)) {
        throw badRequest("connections.payoutFourEyesRule", { amount: String(peek.amountMinor), threshold: fourEyesThreshold });
      }
    }
    const result = await this.tx(async (client) => {
      const row = await client.payoutRequest.findFirst({ where: { id: requestId } });
      if (!row) throw notFound("connections.payoutRequestNotFound");
      if (row.status === "paid") throw badRequest("connections.payoutAlreadyPaid");
      if (row.status !== "approved") throw badRequest("connections.payoutPayApprovedOnly", { status: row.status });
      const wallet = await client.walletAccount.findUnique({ where: { organizationId: row.organizationId } });
      if (!wallet) throw badRequest("connections.walletNotFound");
      const amount = BigInt(row.amountMinor);
      const balance = BigInt(wallet.balanceMinor);
      // Final overdraw guard, inside the same transaction: even
      // if the balance changed after approval, money cannot
      // leave beyond (balance − other holds).
      const heldOthers = await this.heldMinor(client, row.organizationId, row.id);
      if (amount > balance - heldOthers || amount > balance) {
        throw badRequest("connections.payoutPayInsufficientBalance");
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

  // ---------- OU11: the legal gate for payout AUTOMATION ----------

  /**
   * OU11 — the legal gate. The platform wallet holds tenant
   * money and the Connect Center program carries an OPEN legal
   * item (legal review of holding tenant funds). Until a SUPER
   * admin records that the review happened AND separately turns
   * the automation switch on, NO disbursement execution path
   * (instruction issue / execution confirm, wallet or affiliate)
   * may run — enforced by assertPayoutAutomationAllowed in
   * payout-legal-gate.ts, called from the service layer on every
   * entry point. The MANUAL chain above (adminDecidePayout +
   * adminMarkPaid) is deliberately NOT gated: it is the existing
   * human process and stays exactly as it is.
   */

  async getPayoutLegalGate() {
    return payoutLegalGateState(await readPayoutLegalGate(this.prisma as any));
  }

  /** SUPER-only at the controller. Records that the wallet
   * legal review HAS been completed by a human reviewer — the
   * code records the confirmation (who/when/reference); it does
   * not perform or replace the review. Recording NEVER enables
   * automation by itself: the switch is a separate act below. */
  async recordPayoutLegalConfirmation(admin: { id: string }, dto: { reference?: string; note?: string }) {
    const reference = String(dto?.reference ?? "").trim();
    if (!reference) {
      throw badRequest("connections.legalReviewReferenceRequired");
    }
    const row = await this.tx(async (client) => {
      const existing = await readPayoutLegalGate(client);
      const data = {
        legalConfirmedById: admin.id, legalConfirmedAt: new Date(),
        legalReference: reference, legalNote: String(dto?.note ?? "").trim() || null,
      };
      return existing
        ? client.payoutLegalGate.update({ where: { id: existing.id }, data })
        : client.payoutLegalGate.create({ data: { scope: "platform", ...data } });
    });
    await this.audit.log({
      userId: admin.id, action: "admin.payout_legal_gate_confirmed",
      entityType: "PayoutLegalGate", entityId: row.id,
      metadata: { reference },
    });
    return payoutLegalGateState(row);
  }

  /** SUPER-only at the controller. Removing the confirmation
   * closes the gate completely: the automation switch is forced
   * off in the same write, so a later re-confirmation can never
   * silently resurrect a previously-enabled automation. */
  async revokePayoutLegalConfirmation(admin: { id: string }) {
    const existing = await readPayoutLegalGate(this.prisma as any);
    if (!existing?.legalConfirmedAt) {
      throw badRequest("connections.legalReviewNothingToRevoke");
    }
    const row = await (this.prisma as any).payoutLegalGate.update({
      where: { id: existing.id },
      data: {
        legalConfirmedById: null, legalConfirmedAt: null, legalReference: null, legalNote: null,
        automationEnabled: false, automationEnabledById: null, automationEnabledAt: null,
      },
    });
    await this.audit.log({
      userId: admin.id, action: "admin.payout_legal_gate_revoked",
      entityType: "PayoutLegalGate", entityId: row.id, metadata: {},
    });
    return payoutLegalGateState(row);
  }

  /** SUPER-only at the controller. The automation switch:
   * enabling REQUIRES a recorded legal confirmation (enabling
   * without one is refused with the gate's own message);
   * disabling is always allowed and takes effect on the very
   * next execution attempt (the gate is read from the DB on
   * every call, never from a cached snapshot). */
  async setPayoutAutomationEnabled(admin: { id: string }, enabled: boolean) {
    const existing = await readPayoutLegalGate(this.prisma as any);
    const state = payoutLegalGateState(existing);
    if (enabled && !state.recorded) throw badRequest("connections.payoutGateNoConfirmation");
    const data = enabled
      ? { automationEnabled: true, automationEnabledById: admin.id, automationEnabledAt: new Date() }
      : { automationEnabled: false, automationEnabledById: null, automationEnabledAt: null };
    const row = existing
      ? await (this.prisma as any).payoutLegalGate.update({ where: { id: existing.id }, data })
      : await (this.prisma as any).payoutLegalGate.create({ data: { scope: "platform", ...data } });
    await this.audit.log({
      userId: admin.id, action: enabled ? "admin.payout_automation_enabled" : "admin.payout_automation_disabled",
      entityType: "PayoutLegalGate", entityId: row.id, metadata: { enabled: Boolean(enabled) },
    });
    return payoutLegalGateState(row);
  }

  // ---------- OU11: disbursement executions (bank-instruction rail) ----------

  private executionView(row: any) {
    return {
      id: row.id, organizationId: row.organizationId, subjectType: row.subjectType,
      payoutRequestId: row.payoutRequestId ?? null,
      partnerId: row.partnerId ?? null, affiliatePayoutId: row.affiliatePayoutId ?? null,
      amountMinor: String(row.amountMinor), method: row.method,
      destination: row.destination ?? null, currency: row.currency ?? "BDT",
      rail: row.rail, status: row.status, instructionRef: row.instructionRef,
      bankReference: row.bankReference ?? null, failureReason: row.failureReason ?? null,
      issuedById: row.issuedById, confirmedById: row.confirmedById ?? null, failedById: row.failedById ?? null,
      issuedAt: row.issuedAt, confirmedAt: row.confirmedAt ?? null, failedAt: row.failedAt ?? null,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  /**
   * Issue the bank instruction for an APPROVED wallet payout.
   *
   * v1 rail honesty: bKash disbursement is NOT evidenced
   * anywhere in this codebase (the bKash clients — tenant and
   * platform — wire tokenized CHECKOUT only: grant / create /
   * execute / query / refund / search; no disbursement or B2C
   * endpoint exists), so there is NO automated provider payout.
   * This rail generates the instruction the operator executes at
   * the bank by hand; confirmPayoutExecution below completes
   * the payout through adminMarkPaid — the existing bookkeeping.
   *
   * Rules: legal gate open (asserted FIRST); the request must be
   * in status "approved" — the four-eyes discipline already ran
   * at approval, and completion re-checks it in adminMarkPaid;
   * one execution row per request — re-issuing while one is
   * open returns it unchanged, re-issuing after a failure resets
   * the same row, and a confirmed execution can never re-issue.
   */
  async issuePayoutInstruction(admin: { id: string }, requestId: string) {
    const p: any = this.prisma as any;
    await assertPayoutAutomationAllowed(p);
    const request = await p.payoutRequest.findFirst({ where: { id: requestId } }).catch(() => null);
    if (!request) throw notFound("connections.payoutRequestNotFound");
    if (request.status === "paid") {
      throw badRequest("connections.payoutPaidNoInstruction");
    }
    if (request.status !== "approved") {
      throw badRequest("connections.instructionApprovedOnly", { status: request.status });
    }
    const existing = await p.payoutExecution.findFirst({ where: { payoutRequestId: request.id } }).catch(() => null);
    if (existing?.status === "confirmed") {
      throw badRequest("connections.executionAlreadyConfirmed");
    }
    if (existing?.status === "instruction_issued") {
      return this.executionView(existing); // duplicate issue attempt = the same instruction, no second row
    }
    const data = {
      organizationId: request.organizationId, subjectType: "wallet_payout",
      amountMinor: BigInt(request.amountMinor), method: String(request.method),
      destination: request.destination, currency: "BDT", rail: "bank_instruction",
      status: "instruction_issued", instructionRef: `BANK-${randomUUID()}`,
      bankReference: null, failureReason: null,
      issuedById: admin.id, confirmedById: null, failedById: null,
      issuedAt: new Date(), confirmedAt: null, failedAt: null,
    };
    const row = existing
      ? await p.payoutExecution.update({ where: { id: existing.id }, data })
      : await p.payoutExecution.create({ data: { payoutRequestId: request.id, ...data } });
    await this.audit.log({
      organizationId: request.organizationId, userId: admin.id,
      action: existing ? "admin.payout_execution_reissued" : "admin.payout_execution_issued",
      entityType: "PayoutExecution", entityId: row.id,
      metadata: { payoutRequestId: request.id, amountMinor: String(request.amountMinor), instructionRef: row.instructionRef, rail: "bank_instruction" },
    });
    return this.executionView(row);
  }

  async getPayoutExecutionForRequest(requestId: string) {
    const row = await (this.prisma as any).payoutExecution.findFirst({ where: { payoutRequestId: requestId } }).catch(() => null);
    return { execution: row ? this.executionView(row) : null };
  }

  /**
   * Confirm an issued execution: the operator HAS executed the
   * instruction at the bank and supplies the BANK's reference.
   * Completion runs through adminMarkPaid — the one and only
   * ledger-debit path (four-eyes, overdraw guard and exactly-
   * once status check all live there and are NOT duplicated
   * here) — so the wallet is debited exactly once, with the
   * bank reference recorded as the payoutRef. If mark-paid
   * refuses (four-eyes, balance, status), the execution stays
   * instruction_issued: truthful and retryable, nothing debited.
   */
  async confirmPayoutExecution(admin: { id: string }, requestId: string, bankReference?: string) {
    const p: any = this.prisma as any;
    await assertPayoutAutomationAllowed(p);
    const ref = String(bankReference ?? "").trim();
    if (!ref) throw badRequest("connections.executionBankReferenceRequired");
    const execution = await p.payoutExecution.findFirst({ where: { payoutRequestId: requestId } }).catch(() => null);
    if (!execution) throw notFound("connections.payoutNoBankInstruction");
    if (execution.status === "confirmed") {
      // Duplicate confirmation: converge on the stored truth,
      // never a second debit (adminMarkPaid would refuse too).
      const request = await p.payoutRequest.findFirst({ where: { id: requestId } }).catch(() => null);
      return { execution: this.executionView(execution), payout: request ? this.payoutView(request) : null, alreadyConfirmed: true };
    }
    if (execution.status !== "instruction_issued") {
      throw badRequest("connections.executionNotConfirmable", { status: execution.status });
    }
    const payout = await this.adminMarkPaid(admin, requestId, ref);
    const updated = await p.payoutExecution.update({
      where: { id: execution.id },
      data: { status: "confirmed", bankReference: ref, confirmedById: admin.id, confirmedAt: new Date(), failureReason: null, failedById: null, failedAt: null },
    });
    await this.audit.log({
      organizationId: updated.organizationId, userId: admin.id,
      action: "admin.payout_execution_confirmed",
      entityType: "PayoutExecution", entityId: updated.id,
      metadata: { payoutRequestId: requestId, bankReference: ref, amountMinor: String(updated.amountMinor) },
    });
    return { execution: this.executionView(updated), payout };
  }

  /**
   * Record that the bank execution FAILED / was rejected (e.g.
   * the bank refused the instruction). The payout request is
   * untouched — it stays "approved", its hold stays in place,
   * NO ledger row is written — and a fresh instruction can be
   * issued for it. The error is recorded on the execution.
   */
  async failPayoutExecution(admin: { id: string }, requestId: string, reason?: string) {
    const p: any = this.prisma as any;
    await assertPayoutAutomationAllowed(p);
    const failureReason = String(reason ?? "").trim();
    if (!failureReason) throw badRequest("connections.executionFailReasonRequired");
    const execution = await p.payoutExecution.findFirst({ where: { payoutRequestId: requestId } }).catch(() => null);
    if (!execution) throw notFound("connections.payoutNoBankInstructionShort");
    if (execution.status === "confirmed") {
      throw badRequest("connections.confirmedExecutionNotFailable");
    }
    if (execution.status === "failed") return this.executionView(execution);
    const updated = await p.payoutExecution.update({
      where: { id: execution.id },
      data: { status: "failed", failureReason, failedById: admin.id, failedAt: new Date() },
    });
    await this.audit.log({
      organizationId: updated.organizationId, userId: admin.id,
      action: "admin.payout_execution_failed",
      entityType: "PayoutExecution", entityId: updated.id,
      metadata: { payoutRequestId: requestId, failureReason },
    });
    return this.executionView(updated);
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
    if (!note) throw badRequest("connections.walletAdjustmentNoteRequired");
    const amount = parseMinor(dto?.amountMinor);
    if (amount === 0n) throw badRequest("connections.walletAdjustmentAmountZero");
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } }).catch(() => null);
    if (!org) throw notFound("common.orgNotFound");
    const entry = await this.tx(async (client) => {
      const wallet = await this.getOrCreateWallet(client, organizationId);
      const balanceAfter = BigInt(wallet.balanceMinor) + amount;
      if (balanceAfter < 0n) throw badRequest("connections.walletAdjustmentNegative");
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

/** Parse the statement query range: `from`/`to` as ISO or
 * date-only (YYYY-MM-DD). A date-only `to` means "that whole
 * day", so it becomes the FOLLOWING midnight (the service range
 * is end-exclusive). Unparseable values degrade to unbounded. */
export function statementRange(fromRaw?: string | null, toRaw?: string | null): { from: Date | null; to: Date | null } {
  const parse = (raw?: string | null, endOfDay = false): Date | null => {
    const v = String(raw ?? "").trim();
    if (!v) return null;
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00.000Z` : v);
    if (Number.isNaN(d.getTime())) return null;
    if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(v)) d.setUTCDate(d.getUTCDate() + 1);
    return d;
  };
  return { from: parse(fromRaw), to: parse(toRaw, true) };
}

function csvCell(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The CSV statement — lossless: full notes, exact minor-unit
 * amounts, and the ledger's own balance chain. No credentials
 * exist in ledger rows, so nothing needs redacting here. */
export function buildStatementCsv(statement: {
  organizationId: string; currency: string; from: Date; to: Date;
  openingMinor: string; closingMinor: string; entries: any[];
}): string {
  const lines: string[] = [
    "Wallet Statement",
    `Organization,${csvCell(statement.organizationId)}`,
    `Currency,${csvCell(statement.currency)}`,
    `Period From,${statement.from.toISOString()}`,
    `Period To (exclusive),${statement.to.toISOString()}`,
    `Opening Balance (minor),${statement.openingMinor}`,
    "",
    ["Date", "Type", "Amount (minor)", "Balance After (minor)", "Reference Type", "Reference Id", "Note"].join(","),
  ];
  for (const e of statement.entries) {
    lines.push([
      csvCell(new Date(e.createdAt).toISOString()),
      csvCell(e.type),
      csvCell(e.amountMinor),
      csvCell(e.balanceAfterMinor),
      csvCell(e.refType ?? ""),
      csvCell(e.refId ?? ""),
      csvCell(e.note ?? ""),
    ].join(","));
  }
  lines.push("", `Closing Balance (minor),${statement.closingMinor}`);
  return lines.join("\n") + "\n";
}

/**
 * OU11: the bank-instruction export for ONE payout execution —
 * the document the operator takes to the bank. It carries the
 * destination snapshot exactly as stored on the payout request
 * (these details are the point of the instruction — the export
 * is an admin-only surface, like the unmasked destination read),
 * our instructionRef (to quote in the bank transfer so the
 * bank's reference can be matched back at confirmation), and a
 * face statement that the system has NOT sent any money: the
 * transfer happens at the bank, by hand.
 */
export function buildPayoutInstructionCsv(execution: {
  instructionRef: string; amountMinor: string; currency?: string | null; method: string;
  destination?: any; organizationId: string; payoutRequestId?: string | null;
  partnerId?: string | null; issuedAt?: unknown;
}): string {
  const dest = execution.destination && typeof execution.destination === "object" ? execution.destination : {};
  const lines: string[] = [
    "Bank Payout Instruction (OU11) — execute at the bank, then confirm in the Admin Console with the bank reference",
    `Instruction Reference,${csvCell(execution.instructionRef)}`,
    `Organization,${csvCell(execution.organizationId)}`,
    ...(execution.payoutRequestId ? [`Payout Request,${csvCell(execution.payoutRequestId)}`] : []),
    ...(execution.partnerId ? [`Affiliate Partner,${csvCell(execution.partnerId)}`] : []),
    `Amount (minor),${csvCell(execution.amountMinor)}`,
    `Currency,${csvCell(execution.currency ?? "BDT")}`,
    `Method,${csvCell(execution.method)}`,
    `Issued At,${csvCell(execution.issuedAt ? new Date(execution.issuedAt as any).toISOString() : "")}`,
    "",
    "Destination",
  ];
  for (const [k, v] of Object.entries(dest)) {
    lines.push(`${csvCell(k)},${csvCell(v)}`);
  }
  return lines.join("\n") + "\n";
}

/**
 * The PDF statement, composed with the codebase's dependency-
 * free PDF writer (courier/pdf.ts). Its Type1 fonts are
 * WinAnsi-only, so the PDF carries the ASCII-safe columns
 * (date / type / amounts / reference) and states on its face
 * that full notes live in the CSV export — a Bengali note is
 * never mangled into "?" and presented as the real text.
 */
export function buildStatementPdf(statement: {
  organizationId: string; currency: string; from: Date; to: Date;
  openingMinor: string; closingMinor: string; entries: any[];
}): Buffer {
  const header = (page: PdfCanvas, pageNo: number) => {
    page.text(48, 800, 16, "Wallet Statement", true);
    page.text(48, 782, 9, `Organization: ${statement.organizationId}`);
    page.text(48, 770, 9, `Period: ${statement.from.toISOString()} to ${statement.to.toISOString()} (exclusive)`);
    page.text(48, 758, 9, `Opening balance: ${moneyText(statement.openingMinor, statement.currency)}   Closing balance: ${moneyText(statement.closingMinor, statement.currency)}`);
    page.text(48, 746, 8, "Full entry notes are in the CSV statement export.");
    page.text(48, 730, 9, "Date                     Type                    Amount            Balance After        Reference", true);
    page.text(520, 800, 8, `Page ${pageNo}`);
  };
  const pages: { width: number; height: number; content: string }[] = [];
  const perPage = 42;
  const chunks: any[][] = [];
  for (let i = 0; i < Math.max(1, statement.entries.length); i += perPage) {
    chunks.push(statement.entries.slice(i, i + perPage));
  }
  chunks.forEach((chunk, idx) => {
    const canvas = new PdfCanvas();
    header(canvas, idx + 1);
    let y = 714;
    if (chunk.length === 0) {
      canvas.text(48, y, 9, "No ledger entries in this period.");
    }
    for (const e of chunk) {
      const date = new Date(e.createdAt).toISOString().slice(0, 19).replace("T", " ");
      const ref = e.refId ? String(e.refId).slice(0, 18) : "-";
      canvas.text(48, y, 8, date);
      canvas.text(150, y, 8, String(e.type).slice(0, 22));
      canvas.text(280, y, 8, moneyText(e.amountMinor, statement.currency));
      canvas.text(380, y, 8, moneyText(e.balanceAfterMinor, statement.currency));
      canvas.text(480, y, 8, ref);
      y -= 14;
    }
    pages.push({ width: 595, height: 842, content: canvas.build() });
  });
  return buildPdf(pages);
}
