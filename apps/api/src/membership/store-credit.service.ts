import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EventsService } from "../common/events.service";
import { MembershipService, SOLD_ORDER_STATUSES } from "./membership.service";

/**
 * NF7 (FB3) — Store credit, a customer-scoped money instrument.
 *
 * THE LEDGER IS THE SOLE TRUTH (the loyalty / gift-card
 * pattern, minus any cache): a customer's balance is ALWAYS
 * derived as Σ deltaMinor over StoreCreditEntry for that
 * (org, customer). There is no balance column to drift.
 * Entries are never edited or deleted; a correction is a new
 * compensating entry.
 *
 * Exactly-once rides the (organizationId, sourceRef) unique:
 *   spend          → "nf7:spend:<orderId>"
 *   spend reversal → "nf7:spend-reversal:<orderId>"
 *   refund→credit  → "nf7:refund-credit:<orderId>:<refundKey>"
 * Every writer checks for the sourceRef first inside its
 * transaction; the unique index is the backstop.
 *
 * Sources of credit:
 *  1. Manual staff grant (grantManual) — reason/note REQUIRED,
 *     audit-logged with the actor.
 *  2. Refund-to-credit (refundToCredit) — ONLY behind the
 *     per-store Store.refundToCreditEnabled setting, DEFAULT
 *     OFF (the EC5 refund-settings area; owner decision
 *     2026-10-13). While off, the attempt is REFUSED (403) and
 *     nothing is written; the refund UI does not render the
 *     option at all. When on, the refund and the credit post
 *     in ONE transaction: Order.refundedMinor moves by the
 *     amount (bounded by total − already refunded) and exactly
 *     one ledger entry is created for the caller's refundKey —
 *     a retry with the same key returns the first entry and
 *     moves nothing again.
 *     Gate resolution: an order linked to a Store reads THAT
 *     store's flag; a native shop order (storeId null — native
 *     orders carry no Store row) reads "any store of the org
 *     has it on", the merchant's opt-in signal for their shop.
 *
 * Spending (the checkout pattern loyalty / gift cards set):
 * the evaluator prices from a caller-supplied snapshot
 * (checkoutSnapshot — derived balance, failure-isolated); the
 * caller posts the spend AFTER the order exists
 * (postPlacementSpend — exactly-once per order, funds
 * re-checked inside the transaction against the derived
 * balance; the applied amount never exceeds min(balance,
 * order total) because the evaluator clamps and the poster
 * re-clamps). If the order is cancelled / failed BEFORE
 * delivery, the reconciler reverses the debit with a
 * compensating spend_reversal entry.
 *
 * The reconciler (onOrderTransition) also drives tier
 * recompute: it is subscribed to the same bus events as the
 * loyalty reconciler, so order completion moves tiers and
 * cancellation restores credit through ONE door.
 */

function toBig(v: unknown): bigint {
  try {
    return BigInt(v as any);
  } catch {
    return 0n;
  }
}

function isUniqueViolation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /unique|P2002/i.test(msg);
}

function parseAmountMinor(raw: unknown, field = "amountMinor"): bigint {
  const s = raw === null || raw === undefined ? "" : String(raw).trim();
  if (!/^\d+$/.test(s)) {
    throw new BadRequestException(`${field} অবশ্যই একটি ধনাত্মক পূর্ণসংখ্যা (পয়সায়) হতে হবে`);
  }
  const v = BigInt(s);
  if (v <= 0n) throw new BadRequestException(`${field} শূন্যের বেশি হতে হবে`);
  return v;
}

/** Pure cap: what a spend may apply — never more than the
 * balance, never more than the amount still payable. */
export function storeCreditApplication(balanceMinor: bigint, payableMinor: bigint, requestedMinor?: bigint | null): bigint {
  let cap = balanceMinor < payableMinor ? balanceMinor : payableMinor;
  if (requestedMinor !== null && requestedMinor !== undefined && requestedMinor < cap) {
    cap = requestedMinor;
  }
  return cap > 0n ? cap : 0n;
}

@Injectable()
export class StoreCreditService {
  private readonly logger = new Logger(StoreCreditService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly events?: EventsService,
    @Optional() private readonly membership?: MembershipService,
  ) {
    // The loyalty pattern: subscribe in the constructor,
    // revalidate everything from the DB inside the handler.
    if (this.events) {
      const reconcile = (p: any) => {
        void this.onOrderTransition(p?.organizationId, p?.context?.orderId);
      };
      this.events.on("order.delivered", reconcile);
      this.events.on("order.ingested", reconcile);
      this.events.on("order.created", reconcile);
      this.events.on("order.status_changed", reconcile);
      this.events.on("order.refunded", reconcile);
    }
  }

  private t(name: string): any {
    return (this.prisma as any)[name];
  }

  private async safeAudit(input: Parameters<AuditService["log"]>[0]): Promise<void> {
    try {
      await this.audit?.log(input);
    } catch {
      /* audit never breaks the write it describes */
    }
  }

  private async loadCustomerOr404(orgId: string, customerId: string): Promise<any> {
    const customer = await this.t("customer").findFirst({
      where: { id: customerId, organizationId: orgId },
    });
    if (!customer) throw new NotFoundException("কাস্টমার পাওয়া যায়নি");
    return customer;
  }

  // ---------- the ledger ----------

  /** Derived balance: Σ deltaMinor. The ONLY balance there is. */
  async balanceFor(orgId: string, customerId: string, tx?: any): Promise<bigint> {
    const table = tx ? (tx as any).storeCreditEntry : this.t("storeCreditEntry");
    const rows: any[] =
      (await table
        .findMany({ where: { organizationId: orgId, customerId } })
        .catch(() => [])) ?? [];
    let sum = 0n;
    for (const r of rows) sum += toBig(r.deltaMinor);
    return sum;
  }

  private serializeEntry(row: any) {
    return {
      id: row.id,
      customerId: row.customerId,
      deltaMinor: toBig(row.deltaMinor).toString(),
      reason: row.reason,
      orderId: row.orderId ?? null,
      sourceRef: row.sourceRef ?? null,
      balanceAfter: toBig(row.balanceAfter).toString(),
      createdById: row.createdById ?? null,
      note: row.note ?? null,
      createdAt: row.createdAt,
    };
  }

  /** Post one entry inside a transaction. The caller supplies
   * the derived balance BEFORE this entry; balanceAfter is the
   * stamped snapshot. Returns the created row. */
  private async postEntryTx(tx: any, data: {
    organizationId: string;
    customerId: string;
    deltaMinor: bigint;
    reason: string;
    orderId?: string | null;
    sourceRef?: string | null;
    createdById?: string | null;
    note?: string | null;
    balanceBefore: bigint;
  }): Promise<any> {
    return tx.storeCreditEntry.create({
      data: {
        organizationId: data.organizationId,
        customerId: data.customerId,
        deltaMinor: data.deltaMinor,
        reason: data.reason,
        orderId: data.orderId ?? null,
        sourceRef: data.sourceRef ?? null,
        balanceAfter: data.balanceBefore + data.deltaMinor,
        createdById: data.createdById ?? null,
        note: data.note ?? null,
      },
    });
  }

  private async findBySourceRef(orgId: string, sourceRef: string, tx?: any): Promise<any | null> {
    const table = tx ? (tx as any).storeCreditEntry : this.t("storeCreditEntry");
    return table
      .findFirst({ where: { organizationId: orgId, sourceRef } })
      .catch(() => null);
  }

  // ---------- source 1: manual staff grant ----------

  async grantManual(
    orgId: string,
    actorId: string,
    customerId: string,
    dto: { amountMinor?: unknown; note?: string },
  ) {
    const customer = await this.loadCustomerOr404(orgId, customerId);
    if (customer.mergedIntoId) {
      throw new BadRequestException("এই কাস্টমারটি অন্য কাস্টমারের সাথে মার্জ হয়ে গেছে — সারভাইভর কাস্টমারে ক্রেডিট দিন");
    }
    const amount = parseAmountMinor(dto?.amountMinor);
    const note = String(dto?.note ?? "").trim();
    if (!note) throw new BadRequestException("ক্রেডিট দেওয়ার কারণ (note) আবশ্যক");
    const entry = await (this.prisma as any).$transaction(async (tx: any) => {
      const balanceBefore = await this.balanceFor(orgId, customerId, tx);
      return this.postEntryTx(tx, {
        organizationId: orgId,
        customerId,
        deltaMinor: amount,
        reason: "grant_manual",
        createdById: actorId,
        note,
        balanceBefore,
      });
    });
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "store_credit.granted",
      entityType: "Customer", entityId: customerId,
      metadata: { amountMinor: amount.toString(), note, entryId: entry.id },
    });
    return { entry: this.serializeEntry(entry), balanceMinor: (await this.balanceFor(orgId, customerId)).toString() };
  }

  // ---------- source 2: refund-to-credit (gated) ----------

  /** The gate. Exported for the orders UI state + specs. */
  async refundToCreditEnabledForOrder(orgId: string, order: any): Promise<boolean> {
    try {
      if (order?.storeId) {
        const store = await this.t("store").findFirst({
          where: { id: order.storeId, organizationId: orgId },
        });
        return store?.refundToCreditEnabled === true;
      }
      const stores: any[] =
        (await this.t("store").findMany({ where: { organizationId: orgId } }).catch(() => [])) ?? [];
      return stores.some((s) => s.refundToCreditEnabled === true);
    } catch {
      return false;
    }
  }

  async refundToCredit(
    orgId: string,
    actorId: string,
    orderId: string,
    dto: { amountMinor?: unknown; refundKey?: string; note?: string },
  ) {
    const order = await this.t("order").findFirst({
      where: { id: orderId, organizationId: orgId },
    });
    if (!order) throw new NotFoundException("অর্ডারটি পাওয়া যায়নি");
    if (!order.customerId) {
      throw new BadRequestException("এই অর্ডারের সাথে কোনো কাস্টমার যুক্ত নেই — স্টোর ক্রেডিট কাস্টমার-ভিত্তিক, তাই ক্রেডিটে রিফান্ড সম্ভব নয়");
    }
    const customer = await this.loadCustomerOr404(orgId, String(order.customerId));
    if (customer.mergedIntoId) {
      throw new BadRequestException("এই কাস্টমারটি অন্য কাস্টমারের সাথে মার্জ হয়ে গেছে — আগে মার্জ-পরবর্তী কাস্টমার দিয়ে চেষ্টা করুন");
    }
    const refundKey = String(dto?.refundKey ?? "").trim();
    if (!refundKey) {
      throw new BadRequestException("refundKey আবশ্যক — একই রিফান্ডের পুনঃচেষ্টা যাতে দ্বিতীয়বার ক্রেডিট না দেয়, তার জন্য এই চাবিটি দরকার");
    }
    const sourceRef = `nf7:refund-credit:${order.id}:${refundKey}`;
    // Exactly-once replay check BEFORE the gate: a retry of an
    // already-posted refund answers with the first entry even
    // if the setting has since been turned off.
    const prior = await this.findBySourceRef(orgId, sourceRef);
    if (prior) {
      return {
        entry: this.serializeEntry(prior),
        balanceMinor: (await this.balanceFor(orgId, String(order.customerId))).toString(),
        replayed: true,
      };
    }
    const enabled = await this.refundToCreditEnabledForOrder(orgId, order);
    if (!enabled) {
      throw new ForbiddenException("স্টোর ক্রেডিটে রিফান্ড এই দোকানে চালু নেই — Store settings-এ Refund-to-Credit চালু করলেই এই অপশনটি পাওয়া যাবে");
    }
    const amount = parseAmountMinor(dto?.amountMinor);
    const total = toBig(order.totalMinor);
    const alreadyRefunded = toBig(order.refundedMinor);
    if (amount > total - alreadyRefunded) {
      throw new BadRequestException("রিফান্ডের পরিমাণ অর্ডারের অবশিষ্ট রিফান্ডযোগ্য পরিমাণের বেশি হতে পারবে না");
    }
    const note = String(dto?.note ?? "").trim() || null;
    const entry = await (this.prisma as any).$transaction(async (tx: any) => {
      const raced = await this.findBySourceRef(orgId, sourceRef, tx);
      if (raced) return raced;
      // Re-read the order inside the transaction: the refund
      // bound is judged on the freshest refundedMinor.
      const fresh = await tx.order.findFirst({ where: { id: order.id, organizationId: orgId } });
      const freshRefunded = toBig(fresh?.refundedMinor);
      if (amount > total - freshRefunded) {
        throw new BadRequestException("রিফান্ডের পরিমাণ অর্ডারের অবশিষ্ট রিফান্ডযোগ্য পরিমাণের বেশি হতে পারবে না");
      }
      await tx.order.update({
        where: { id: order.id },
        data: { refundedMinor: freshRefunded + amount },
      });
      const balanceBefore = await this.balanceFor(orgId, String(order.customerId), tx);
      return this.postEntryTx(tx, {
        organizationId: orgId,
        customerId: String(order.customerId),
        deltaMinor: amount,
        reason: "refund_credit",
        orderId: order.id,
        sourceRef,
        createdById: actorId,
        note,
        balanceBefore,
      });
    });
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "store_credit.refund_to_credit",
      entityType: "Order", entityId: order.id,
      metadata: { amountMinor: amount.toString(), customerId: String(order.customerId), refundKey, entryId: entry.id },
    });
    return {
      entry: this.serializeEntry(entry),
      balanceMinor: (await this.balanceFor(orgId, String(order.customerId))).toString(),
      replayed: false,
    };
  }

  // ---------- spending at checkout ----------

  /** The snapshot a checkout caller hands to
   * PromotionsService.evaluateCheckout (the loyalty pattern:
   * the evaluator reads no credit tables). Failure-isolated:
   * any problem ⇒ null ⇒ no credit line, checkout unaffected. */
  async checkoutSnapshot(
    orgId: string,
    customerId: string | null,
  ): Promise<{ customerId: string; balanceMinor: bigint } | null> {
    try {
      if (!customerId) return null;
      const customer = await this.t("customer")
        .findFirst({ where: { id: customerId, organizationId: orgId } })
        .catch(() => null);
      if (!customer || customer.mergedIntoId) return null;
      const balanceMinor = await this.balanceFor(orgId, customerId);
      if (balanceMinor <= 0n) return null;
      return { customerId, balanceMinor };
    } catch (e) {
      this.logger.warn(
        `store credit checkout snapshot failed for org ${orgId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  /**
   * Spend the credit an evaluation applied, AFTER the order
   * exists (placement-time posting — a failed placement posts
   * nothing). Failure-isolated by contract, like loyalty's
   * postPlacementRedeem. Exactly-once per order via the
   * sourceRef claim; the amount is re-clamped inside the
   * transaction to the CURRENT derived balance and the order
   * total, so a concurrent spend can never drive the balance
   * negative or over-apply.
   */
  async postPlacementSpend(
    orgId: string,
    input: { orderId: string | null; customerId: string | null; amountMinor: bigint },
  ): Promise<any | null> {
    try {
      if (!input.orderId || !input.customerId || !(input.amountMinor > 0n)) return null;
      const customer = await this.t("customer")
        .findFirst({ where: { id: input.customerId, organizationId: orgId } })
        .catch(() => null);
      if (!customer || customer.mergedIntoId) return null;
      const order = await this.t("order")
        .findFirst({ where: { id: input.orderId, organizationId: orgId } })
        .catch(() => null);
      if (!order || String(order.customerId ?? "") !== String(input.customerId)) return null;
      const sourceRef = `nf7:spend:${input.orderId}`;
      return await (this.prisma as any).$transaction(async (tx: any) => {
        const existing = await this.findBySourceRef(orgId, sourceRef, tx);
        if (existing) return existing;
        const balance = await this.balanceFor(orgId, String(input.customerId), tx);
        const applied = storeCreditApplication(balance, toBig(order.totalMinor), input.amountMinor);
        if (applied <= 0n) return null;
        return this.postEntryTx(tx, {
          organizationId: orgId,
          customerId: String(input.customerId),
          deltaMinor: -applied,
          reason: "spend",
          orderId: input.orderId,
          sourceRef,
          balanceBefore: balance,
        });
      });
    } catch (e) {
      if (isUniqueViolation(e)) return null;
      this.logger.warn(
        `store credit spend posting failed for order ${input.orderId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  /** Reverse a placement spend whose order died BEFORE
   * delivery. Compensating entry only — the original debit row
   * is never touched. Exactly-once via its own sourceRef. */
  private async reverseSpendIfNeeded(orgId: string, order: any): Promise<void> {
    const spend = await this.findBySourceRef(orgId, `nf7:spend:${order.id}`);
    if (!spend) return;
    const reversalRef = `nf7:spend-reversal:${order.id}`;
    const existing = await this.findBySourceRef(orgId, reversalRef);
    if (existing) return;
    // "Before delivery" guard: an order that was ever sold
    // (completed/delivered status, or a delivered shipment) is
    // NOT reversed here — its spend stands; a later refund is a
    // staff decision (refund-to-credit is the door for that).
    const status = String(order.status ?? "");
    if ((SOLD_ORDER_STATUSES as readonly string[]).includes(status)) return;
    const shipments: any[] =
      (await this.t("courierShipment")
        .findMany({ where: { organizationId: orgId, orderId: order.id } })
        .catch(() => [])) ?? [];
    if (shipments.some((s) => ["delivered", "partial_delivered"].includes(String(s.status ?? "")))) return;
    const amount = -toBig(spend.deltaMinor);
    if (amount <= 0n) return;
    try {
      await (this.prisma as any).$transaction(async (tx: any) => {
        const raced = await this.findBySourceRef(orgId, reversalRef, tx);
        if (raced) return;
        const balanceBefore = await this.balanceFor(orgId, String(spend.customerId), tx);
        await this.postEntryTx(tx, {
          organizationId: orgId,
          customerId: String(spend.customerId),
          deltaMinor: amount,
          reason: "spend_reversal",
          orderId: order.id,
          sourceRef: reversalRef,
          note: "অর্ডার ডেলিভারির আগেই বাতিল/ব্যর্থ — খরচ করা ক্রেডিট ফেরত",
          balanceBefore,
        });
      });
      await this.safeAudit({
        organizationId: orgId, userId: "system", action: "store_credit.spend_reversed",
        entityType: "Order", entityId: order.id,
        metadata: { amountMinor: amount.toString(), customerId: String(spend.customerId) },
      });
    } catch (e) {
      if (isUniqueViolation(e)) return;
      this.logger.warn(
        `store credit spend reversal failed for order ${order.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // ---------- the reconciler (tiers + reversal) ----------

  /**
   * Re-derive state from the CURRENT order row, called by the
   * bus events above and directly by specs. Idempotent and
   * failure-isolated by contract (the loyalty reconciler's
   * shape): tier recompute for the order's customer + the
   * cancellation-before-delivery spend reversal.
   */
  async onOrderTransition(orgId: string | null | undefined, orderId: string | null | undefined): Promise<void> {
    try {
      if (!orgId || !orderId) return;
      const order = await this.t("order")
        .findFirst({ where: { id: orderId, organizationId: orgId } })
        .catch(() => null);
      if (!order || order.isPractice) return;
      const status = String(order.status ?? "");
      if (status === "cancelled" || status === "failed") {
        await this.reverseSpendIfNeeded(orgId, order);
      }
      if (order.customerId && this.membership) {
        await this.membership
          .recomputeCustomer(orgId, String(order.customerId))
          .catch(() => undefined);
      }
    } catch (e) {
      this.logger.warn(
        `NF7 order reconcile failed for order ${orderId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // ---------- reads ----------

  /** Staff view: one customer's derived balance + history +
   * tier (the customers-surface shape). */
  async getCustomerCredit(orgId: string, customerId: string) {
    const customer = await this.loadCustomerOr404(orgId, customerId);
    const rows: any[] =
      (await this.t("storeCreditEntry")
        .findMany({
          where: { organizationId: orgId, customerId },
          orderBy: { createdAt: "desc" },
          take: 100,
        })
        .catch(() => [])) ?? [];
    const balance = await this.balanceFor(orgId, customerId);
    return {
      customerId: customer.id,
      balanceMinor: balance.toString(),
      entries: rows.map((r) => this.serializeEntry(r)),
    };
  }

  /** The signed-in customer's OWN view for the shop account
   * page. The caller (ShopAccountService) resolves the session
   * customer first — this method only ever reads the given
   * customer's rows, so customer A can never see B's credit. */
  async accountCredit(orgId: string, customer: any) {
    const rows: any[] =
      (await this.t("storeCreditEntry")
        .findMany({
          where: { organizationId: orgId, customerId: customer.id },
          orderBy: { createdAt: "desc" },
          take: 50,
        })
        .catch(() => [])) ?? [];
    const balance = await this.balanceFor(orgId, customer.id);
    let tier: any = null;
    if (this.membership) {
      tier = await this.membership.getCustomerTier(orgId, customer.id)
        .then((v) => v.tier)
        .catch(() => null);
    }
    return {
      balanceMinor: balance.toString(),
      entries: rows.map((r) => this.serializeEntry(r)),
      tier,
    };
  }
}
