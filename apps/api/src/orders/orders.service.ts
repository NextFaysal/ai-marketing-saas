import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { RiskService } from "./risk.service";
import { EventsService } from "../common/events.service";
import { InventoryService } from "../inventory/inventory.service";
import { OrderPushService } from "../commerce/order-push.service";
import { minorToMajor, toCsv } from "../imports/csv";
import { dhakaDayStartUtc } from "../crm/lead-followups";
import type {
  AdvanceVerificationDto,
  CreateManualOrderDto,
  UpdateOrderDto,
  MergeOrdersDto,
  AssignAgentDto,
  BulkAssignAgentDto,
  StaffScoreboardQueryDto,
} from "./orders.dto";
import { phoneKey } from "./risk-score";

function pubOrder(o: any) {
  return {
    ...o,
    subtotalMinor: o.subtotalMinor?.toString(), shippingMinor: o.shippingMinor?.toString(),
    discountMinor: o.discountMinor?.toString(), taxMinor: o.taxMinor?.toString(),
    // EC16: the promotion/referral split of discountMinor.
    promotionDiscountMinor: o.promotionDiscountMinor?.toString() ?? "0",
    referralDiscountMinor: o.referralDiscountMinor?.toString() ?? "0",
    // EC29: gift-wrap charge as a string (other gift fields —
    // giftPromotionId / giftSkipped / giftMessage — ride the
    // spread above untouched).
    giftWrapMinor: o.giftWrapMinor?.toString() ?? "0",
    totalMinor: o.totalMinor?.toString(), refundedMinor: o.refundedMinor?.toString(),
    items: o.items?.map((i: any) => ({ ...i, priceMinor: i.priceMinor?.toString(), totalMinor: i.totalMinor?.toString() })),
  };
}

/**
 * Sales & Data S2 transition table (see updateOrder + the
 * acceptance doc). A stored status missing from this map is a
 * legacy platform string outside the PATCH vocabulary — the
 * escape hatch in updateOrder allows it to move anywhere in the
 * vocabulary. Empty array = terminal (no different status).
 */
const ORDER_TRANSITIONS: Record<string, string[]> = {
  pending: ["pending", "on-hold", "processing", "completed", "cancelled", "refunded", "failed", "returned"],
  "on-hold": ["pending", "on-hold", "processing", "completed", "cancelled", "refunded", "failed", "returned"],
  processing: ["pending", "on-hold", "processing", "completed", "cancelled", "refunded", "failed", "returned"],
  completed: ["refunded", "returned"],
  cancelled: ["pending", "on-hold", "processing"],
  failed: ["pending", "on-hold", "processing"],
  refunded: [],
  returned: [],
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly risk?: RiskService,
    // Milestone 65: manual orders enter through the integrations
    // upsert (dedupe + order.created + risk all inherit).
    @Optional() private readonly integrations?: IntegrationsService,
    @Optional() private readonly audit?: AuditService,
    // Sales & Data S2: stock restore on cancel/return + domain
    // events. REAL imports (M65 lesson: an inline import() type
    // makes Nest inject undefined and events silently never
    // fire). Both @Optional so positional test construction and
    // partial deployments keep working.
    @Optional() private readonly inventory?: InventoryService,
    @Optional() private readonly events?: EventsService,
    // EC5: store push orchestration — appended LAST + @Optional
    // (same discipline as the S2 hooks; every call is wrapped so a
    // store problem can never break the local order flow).
    @Optional() private readonly orderPush?: OrderPushService,
  ) {}

  /**
   * Record an order taken outside any store/chat (phone,
   * counter, messenger). Totals are computed server-side from
   * the item lines. The customer is keyed by phone (as the
   * upsert's source-scoped externalId) so repeat buyers
   * converge on one record; an externalRef makes re-submits
   * update instead of duplicating.
   */
  async createManual(organizationId: string, actorId: string, dto: CreateManualOrderDto) {
    if (!this.integrations) throw new BadRequestException("Manual orders are not available in this deployment");
    if (!Array.isArray(dto.items) || dto.items.length === 0) throw new BadRequestException("At least one item is required");
    const phone = String(dto.customerPhone ?? "").trim();
    if (!phone) throw new BadRequestException("customerPhone is required");
    let subtotal = 0n;
    const items = dto.items.map((item) => {
      const lineTotal = BigInt(item.unitPriceMinor) * BigInt(item.quantity);
      subtotal += lineTotal;
      return {
        name: item.name, sku: item.sku, quantity: item.quantity,
        priceMinor: BigInt(item.unitPriceMinor), totalMinor: lineTotal,
      };
    });
    const shippingMinor = BigInt(dto.shippingMinor ?? 0);
    const discountMinor = BigInt(dto.discountMinor ?? 0);
    const total = subtotal + shippingMinor - discountMinor;
    const externalId = dto.externalRef?.trim() ? dto.externalRef.trim() : `manual-${randomUUID()}`;
    const result = await this.integrations.upsertOrder(organizationId, null, {
      externalId,
      externalNumber: dto.externalRef?.trim() || undefined,
      status: dto.status ?? "processing",
      paymentMethod: dto.isCod === false ? "prepaid" : "cod",
      isCod: dto.isCod !== false,
      currency: (dto.currency ?? "BDT").toUpperCase(),
      subtotalMinor: subtotal,
      shippingMinor,
      discountMinor,
      taxMinor: 0n,
      totalMinor: total > 0n ? total : 0n,
      refundedMinor: 0n,
      placedAt: dto.placedAt ? new Date(dto.placedAt) : new Date(),
      customer: {
        externalId: phone,
        firstName: dto.customerName?.trim() || phone,
        email: dto.customerEmail,
        phone,
        address: dto.address ? { address_1: dto.address } : undefined,
      },
      items,
    }, "manual");
    const order = await (this.prisma as any).order.findFirst({
      where: { organizationId, source: "manual", externalId },
      include: { items: true, customer: true },
    });
    await this.audit?.log({
      organizationId, userId: actorId, action: "orders.manual_created",
      entityType: "Order", entityId: order?.id ?? externalId,
      metadata: { externalId, result, totalMinor: (total > 0n ? total : 0n).toString() },
    }).catch(() => undefined);
    if (!order) throw new NotFoundException("Order was recorded but could not be reloaded");
    return { ...pubOrder(order), upsertResult: result };
  }

  // ---------- Sales & Data S2: order actions (PATCH) ----------

  /**
   * Merchant order actions: status change, refund recording and
   * the internal note — one PATCH, each action independent.
   *
   * Transition table (from → allowed to; same→same is a no-op
   * success that skips status side effects):
   *   pending | on-hold | processing → any vocabulary status
   *   completed                      → refunded, returned
   *   cancelled | failed             → pending, on-hold, processing (revival)
   *   refunded                       → (none — terminal)
   *   returned                       → (none — terminal; goods are back)
   * Escape hatch: a stored status OUTSIDE the vocabulary (legacy
   * platform strings like Woo "checkout-draft") may move to any
   * vocabulary status — we cannot judge a lifecycle we don't own.
   *
   * Refund records MONEY ONLY: it never restores stock by
   * itself. Full refund (cumulative == total) with no explicit
   * status auto-moves the order to "refunded" — except from
   * completed/cancelled/refunded/returned, which keep their
   * status. An explicit dto.status always wins over the
   * auto-transition (and is judged by the table above).
   */
  async updateOrder(organizationId: string, actorId: string, orderId: string, dto: UpdateOrderDto) {
    const hasStatus = dto.status !== undefined;
    const hasRefund = dto.refund !== undefined && dto.refund !== null;
    const hasNote = dto.internalNote !== undefined;
    const hasAddress = dto.address !== undefined;
    if (!hasStatus && !hasRefund && !hasNote && !hasAddress) {
      throw new BadRequestException("কিছুই পাঠানো হয়নি — status, refund অথবা internalNote-এর যেকোনো একটি পাঠান");
    }
    const order = await (this.prisma as any).order.findFirst({ where: { id: orderId, organizationId } });
    if (!order) throw new NotFoundException("Order not found in this organization");
    const from: string = order.status;

    // --- Refund: validate fully before any write. ---
    let refundAmount: bigint | null = null;
    let newRefunded: bigint | null = null;
    if (hasRefund) {
      try { refundAmount = BigInt(dto.refund!.amountMinor as any); } catch { refundAmount = null; }
      if (refundAmount === null) {
        throw new BadRequestException("refund-এর পরিমাণ সঠিক সংখ্যায় পাঠান (পয়সায়)");
      }
      if (refundAmount <= 0n) {
        throw new BadRequestException("refund-এর পরিমাণ সঠিক সংখ্যায় পাঠান (পয়সায়)");
      }
      newRefunded = BigInt(order.refundedMinor ?? 0) + refundAmount;
      if (newRefunded > BigInt(order.totalMinor ?? 0)) {
        throw new BadRequestException("মোট refund অর্ডারের মোট মূল্যের বেশি হতে পারবে না");
      }
    }

    // --- Status: judge the explicit transition, if any. ---
    let targetStatus: string | null = null;
    let autoStatus: "refunded" | null = null;
    if (hasStatus && dto.status !== from) {
      if (ORDER_TRANSITIONS[from]) {
        if (!ORDER_TRANSITIONS[from].includes(dto.status!)) {
          throw new BadRequestException(`অর্ডারের অবস্থা "${from}" থেকে "${dto.status}"-তে নেওয়া যাবে না`);
        }
      }
      // from outside the vocabulary → escape hatch, any target allowed.
      targetStatus = dto.status!;
    }
    // --- Full-refund auto-status (explicit status wins). ---
    if (
      hasRefund && newRefunded !== null && newRefunded === BigInt(order.totalMinor ?? 0)
      && !hasStatus && !["completed", "cancelled", "refunded", "returned"].includes(from)
    ) {
      targetStatus = "refunded";
      autoStatus = "refunded";
    }
    const finalStatus = targetStatus ?? from;
    const statusChanges = finalStatus !== from;

    // --- One write for every field change. ---
    const data: Record<string, unknown> = {};
    if (statusChanges) data.status = finalStatus;
    if (hasRefund) data.refundedMinor = newRefunded;
    let noteCleared = false;
    if (hasNote) {
      if (dto.internalNote === null) { data.internalNote = null; noteCleared = true; }
      else {
        const trimmed = String(dto.internalNote).trim();
        // Empty-after-trim stores null (documented): a note of
        // only whitespace is no note at all.
        data.internalNote = trimmed === "" ? null : trimmed;
        noteCleared = trimmed === "";
      }
    }
    if (hasAddress) {
      data.address = dto.address === null ? null : String(dto.address).trim() || null;
    }
    if (Object.keys(data).length > 0) {
      await (this.prisma as any).order.update({ where: { id: order.id }, data });
    }

    // --- Status side effects (only on an actual change). ---
    if (statusChanges) {
      if (finalStatus === "cancelled" || finalStatus === "failed") {
        try { await this.inventory?.applyOrderRestore(organizationId, orderId, "order_cancelled"); }
        catch { /* restore is failure-isolated: the status change stands */ }
      } else if (finalStatus === "returned") {
        try { await this.inventory?.applyOrderRestore(organizationId, orderId, "order_returned"); }
        catch { /* failure-isolated, as above */ }
      }
      if (finalStatus === "completed") {
        this.safeEmit("order.delivered", organizationId, { orderId });
      }
      this.safeEmit("order.status_changed", organizationId, { orderId, from, to: finalStatus });
    }
    if (hasRefund) {
      this.safeEmit("order.refunded", organizationId, {
        orderId, amountMinor: refundAmount!.toString(), cumulativeRefundedMinor: newRefunded!.toString(),
      });
    }

    // --- Audit: one entry per action kind. The note's CONTENT
    // is never written to audit metadata — only that it changed
    // and whether it was cleared. ---
    if (statusChanges) {
      await this.audit?.log({
        organizationId, userId: actorId, action: "orders.status_changed",
        entityType: "Order", entityId: orderId, metadata: { from, to: finalStatus },
      }).catch(() => undefined);
    }
    if (hasRefund) {
      await this.audit?.log({
        organizationId, userId: actorId, action: "orders.refund_recorded",
        entityType: "Order", entityId: orderId,
        metadata: {
          amountMinor: refundAmount!.toString(), cumulativeRefundedMinor: newRefunded!.toString(),
          reason: dto.refund!.reason ?? null, autoStatus,
        },
      }).catch(() => undefined);
    }
    if (hasNote) {
      await this.audit?.log({
        organizationId, userId: actorId, action: "orders.internal_note_updated",
        entityType: "Order", entityId: orderId, metadata: { cleared: noteCleared },
      }).catch(() => undefined);
    }
    if (hasAddress) {
      await this.audit?.log({
        organizationId, userId: actorId, action: "orders.address_updated",
        entityType: "Order", entityId: orderId, metadata: {},
      }).catch(() => undefined);
    }

    // --- EC5 store pushes (failure-isolated; the local change
    // above stands whatever the store does). internalNote is
    // NEVER pushed — there is deliberately no hook for it. ---
    if (this.orderPush) {
      if (statusChanges) {
        try { await this.orderPush.enqueueStatus(organizationId, orderId, finalStatus); } catch { /* isolated */ }
      }
      if (hasRefund && refundAmount !== null) {
        // The refund GATE (Store.refundPushEnabled, default off)
        // is enforced inside enqueueRefund — not here.
        try { await this.orderPush.enqueueRefund(organizationId, orderId, { amountMinor: refundAmount.toString(), reason: dto.refund?.reason }); } catch { /* isolated */ }
      }
      if (hasAddress && data.address) {
        try { await this.orderPush.enqueueAddress(organizationId, orderId, String(data.address)); } catch { /* isolated */ }
      }
    }

    return this.getOne(organizationId, orderId);
  }

  /** EC5: turn this chat/manual order into a store draft order. */
  async createStoreDraft(organizationId: string, actorId: string, orderId: string, storeId?: string) {
    if (!this.orderPush) throw new BadRequestException("Store push is not available in this deployment");
    const order = await this.orderPush.createStoreDraft(organizationId, actorId, orderId, storeId);
    return pubOrder({ ...order, items: (await (this.prisma as any).orderItem.findMany({ where: { orderId: order.id } }).catch(() => [])) ?? [] });
  }

  /** EC5: send a customer-visible note to the store order.
   * Distinct from internalNote, which never leaves the SaaS. */
  async pushStoreNote(organizationId: string, actorId: string, orderId: string, note: string) {
    if (!this.orderPush) throw new BadRequestException("Store push is not available in this deployment");
    const result = await this.orderPush.enqueueNote(organizationId, orderId, note);
    await this.audit?.log({
      organizationId, userId: actorId, action: "orders.store_note_queued",
      entityType: "Order", entityId: orderId, metadata: {},
    }).catch(() => undefined);
    return result;
  }

  // ---------- EC19: staff-recorded advance verification ----------

  /** All PaymentVerification rows for one order (newest first),
   * serialized with BigInt money as strings. A missing delegate
   * (partial deployment) degrades to an empty list. */
  private async verificationRowsForOrder(organizationId: string, orderId: string): Promise<any[]> {
    const table = (this.prisma as any).paymentVerification;
    if (!table?.findMany) return [];
    const rows = await table
      .findMany({ where: { organizationId, orderId }, orderBy: { createdAt: "desc" } })
      .catch(() => []);
    return rows ?? [];
  }

  private serializeVerification(row: any) {
    return {
      ...row,
      amountMinor: row.amountMinor != null ? String(row.amountMinor) : null,
      expectedAmountMinor: row.expectedAmountMinor != null ? String(row.expectedAmountMinor) : null,
    };
  }

  /** Sum of APPROVED verification amounts (null amounts count 0). */
  private approvedAdvanceSum(rows: any[]): bigint {
    let sum = 0n;
    for (const row of rows) {
      if (row.status !== "approved") continue;
      if (row.amountMinor === null || row.amountMinor === undefined) continue;
      try { sum += BigInt(row.amountMinor as any); } catch { /* unparseable stored amount counts 0 */ }
    }
    return sum;
  }

  /** Resolve the DeliverySlot row for an order (org-scoped),
   * failure-isolated: any problem yields null, never a 500. */
  private async deliverySlotForOrder(organizationId: string, order: any): Promise<any | null> {
    if (!order?.deliverySlotId) return null;
    try {
      const table = (this.prisma as any).deliverySlot;
      if (!table?.findFirst) return null;
      const slot = await table.findFirst({ where: { id: order.deliverySlotId, organizationId } });
      if (!slot) return null;
      return {
        id: slot.id, label: slot.label, startTime: slot.startTime, endTime: slot.endTime,
        date: order.deliveryDate ?? null,
      };
    } catch {
      return null;
    }
  }

  /** EC30: resolve the PickupPoint row for an order (org-scoped,
   * any status — a since-deactivated point still displays),
   * failure-isolated exactly like deliverySlotForOrder. */
  private async pickupPointForOrder(organizationId: string, order: any): Promise<any | null> {
    if (!order?.pickupPointId) return null;
    try {
      const table = (this.prisma as any).pickupPoint;
      if (!table?.findFirst) return null;
      const point = await table.findFirst({ where: { id: order.pickupPointId, organizationId } });
      if (!point) return null;
      return {
        id: point.id, name: point.name, address: point.address, district: point.district,
        phone: point.phone ?? null,
        feeMinor: point.feeMinor != null ? String(point.feeMinor) : "0",
      };
    } catch {
      return null;
    }
  }

  /**
   * EC19: record an advance the customer paid directly to the
   * merchant (bKash/Nagad/…) and that the recording staff member
   * has verified. Backed by a PaymentVerification row created
   * already "approved" (source "manual_advance") — the staff
   * member IS the verifier; there is no gateway involved. The
   * amount may never exceed what is still due on the order.
   */
  async recordAdvanceVerification(organizationId: string, actorId: string, orderId: string, dto: AdvanceVerificationDto) {
    const order = await (this.prisma as any).order.findFirst({
      where: { id: orderId, organizationId },
    });
    if (!order) throw new NotFoundException("Order not found in this organization");

    let amount: bigint;
    try { amount = BigInt(dto.amountMinor as any); } catch { amount = 0n; }
    if (amount <= 0n) {
      throw new BadRequestException("Advance amount must be a positive amount in minor units");
    }

    const table = (this.prisma as any).paymentVerification;
    if (!table?.create) throw new BadRequestException("Payment verification is not available in this deployment");

    const existingRows: any[] = table.findMany
      ? ((await table.findMany({ where: { organizationId, orderId } }).catch(() => [])) ?? [])
      : [];
    const paidSoFar = this.approvedAdvanceSum(existingRows);
    const total = BigInt(order.totalMinor ?? 0);
    const due = total > paidSoFar ? total - paidSoFar : 0n;
    if (amount > due) {
      throw new BadRequestException(
        `Advance ${amount.toString()} exceeds the amount still due on this order (${due.toString()})`,
      );
    }

    if (dto.reference) {
      let duplicate: any = null;
      if (table.findFirst) {
        duplicate = await table.findFirst({
          where: { organizationId, trxId: dto.reference, status: "approved" },
        }).catch(() => null);
      } else if (table.findMany) {
        const rows = (await table.findMany({ where: { organizationId } }).catch(() => [])) ?? [];
        duplicate = rows.find((r: any) => r.trxId === dto.reference && r.status === "approved") ?? null;
      }
      if (duplicate) {
        throw new BadRequestException("This transaction reference has already been recorded as a verified payment");
      }
    }

    const row = await table.create({
      data: {
        organizationId,
        orderId,
        conversationId: order.conversationId ?? order.codConversationId ?? null,
        messageId: null,
        provider: dto.method,
        trxId: dto.reference ?? null,
        amountMinor: amount,
        expectedAmountMinor: order.totalMinor ?? null,
        verdict: "matched",
        status: "approved",
        source: "manual_advance",
        reviewedById: actorId,
        createdById: actorId,
        modelProvider: "manual_staff",
        note: dto.note ?? null,
      },
    });
    await this.audit?.log({
      organizationId, userId: actorId, action: "orders.advance_verification_recorded",
      entityType: "PaymentVerification", entityId: row.id,
      metadata: { orderId, amountMinor: amount.toString(), method: dto.method },
    }).catch(() => undefined);
    return this.getOne(organizationId, orderId);
  }

  /** Events must never throw into the request path. */
  private safeEmit(event: string, organizationId: string, context: Record<string, unknown>) {
    try { this.events?.emit(event, { organizationId, context }); } catch { /* fire-and-forget */ }
  }

  async list(organizationId: string, q: { status?: string; isCod?: boolean; page?: number; pageSize?: number; includePractice?: boolean }) {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 20));
    const where: any = {
      organizationId,
      // CX12a: practice orders are excluded by default; only an
      // explicit includePractice (the "প্র্যাক্টিস অর্ডার দেখান"
      // filter) surfaces them.
      ...(q.includePractice ? {} : { isPractice: false }),
      ...(q.status ? { status: q.status } : {}),
      ...(q.isCod !== undefined ? { isCod: q.isCod } : {}),
    };
    const [total, items] = await Promise.all([
      (this.prisma as any).order.count({ where }),
      (this.prisma as any).order.findMany({
        where, orderBy: { placedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize,
        include: { customer: true, items: true },
      }),
    ]);
    const mapped = items.map(pubOrder);
    // Feature 2: In-memory duplicate tagging for the current batch
    const phoneGroups = new Map<string, string[]>();
    for (const item of items) {
      const p = phoneKey(item.customer?.phone);
      if (p) {
        const ids = phoneGroups.get(p) ?? [];
        ids.push(item.id);
        phoneGroups.set(p, ids);
      }
    }
    for (const item of mapped) {
      const p = phoneKey(item.customer?.phone);
      if (p && (phoneGroups.get(p)?.length ?? 0) > 1) {
        (item as any).duplicate = {
          isDuplicate: true,
          count: phoneGroups.get(p)!.length,
          duplicateOrderIds: phoneGroups.get(p)!.filter((id) => id !== item.id),
        };
      }
    }
    // EC18: attach the chosen delivery slot per row (one batched
    // fetch for the page). Failure-isolated: rows ship with a null
    // slot rather than failing the listing.
    try {
      const slotIds = [...new Set(items.map((o: any) => o.deliverySlotId).filter(Boolean).map((x: any) => String(x)))];
      const slotById = new Map<string, any>();
      if (slotIds.length > 0) {
        const table = (this.prisma as any).deliverySlot;
        const slots = table?.findMany
          ? ((await table.findMany({ where: { organizationId, id: { in: slotIds } } }).catch(() => [])) ?? [])
          : [];
        for (const slot of slots) slotById.set(String(slot.id), slot);
      }
      items.forEach((o: any, idx: number) => {
        const slot = o.deliverySlotId ? slotById.get(String(o.deliverySlotId)) : null;
        (mapped[idx] as any).deliverySlot = slot
          ? { id: slot.id, label: slot.label, startTime: slot.startTime, endTime: slot.endTime, date: o.deliveryDate ?? null }
          : null;
      });
    } catch {
      for (const item of mapped) (item as any).deliverySlot = null;
    }
    // EC30: attach the chosen pickup point per row (one batched
    // fetch for the page), mirroring the delivery slot attach.
    try {
      const pointIds = [...new Set(items.map((o: any) => o.pickupPointId).filter(Boolean).map((x: any) => String(x)))];
      const pointById = new Map<string, any>();
      if (pointIds.length > 0) {
        const table = (this.prisma as any).pickupPoint;
        const points = table?.findMany
          ? ((await table.findMany({ where: { organizationId, id: { in: pointIds } } }).catch(() => [])) ?? [])
          : [];
        for (const point of points) pointById.set(String(point.id), point);
      }
      items.forEach((o: any, idx: number) => {
        const point = o.pickupPointId ? pointById.get(String(o.pickupPointId)) : null;
        (mapped[idx] as any).pickupPoint = point
          ? {
              id: point.id, name: point.name, address: point.address, district: point.district,
              phone: point.phone ?? null,
              feeMinor: point.feeMinor != null ? String(point.feeMinor) : "0",
            }
          : null;
      });
    } catch {
      for (const item of mapped) (item as any).pickupPoint = null;
    }
    // M50: light risk summary per row (band + score). Enrichment must
    // never break the listing — on any failure rows ship without it.
    if (this.risk) {
      try {
        const summaries = await this.risk.summariesForOrders(organizationId, items);
        for (const item of mapped) {
          const s = summaries.get(item.id);
          if (s) (item as any).risk = s;
        }
      } catch { /* risk is advisory only */ }
    }
    return { total, page, pageSize, items: mapped };
  }

  // ---------- Sales & Data S3: orders CSV export ----------

  /**
   * CSV export of the org's orders (newest first by placedAt,
   * capped at 5000 rows — the same cap as the leads export).
   * Filters mirror `list` (status, isCod) plus an export-only
   * date range: `from`/`to` are date-only strings ("YYYY-MM-DD")
   * interpreted as Asia/Dhaka calendar days. The effective order
   * date is placedAt ?? createdAt, so an order with no placedAt
   * falls back to its createdAt for range inclusion.
   * Every money column is a stored Order field, written in major
   * units (taka) via minorToMajor — nothing is fabricated.
   */
  async exportCsv(organizationId: string, q: { status?: string; isCod?: boolean; from?: string; to?: string }): Promise<string> {
    const parseDay = (value: string, label: string): Date => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new BadRequestException(`${label} তারিখটি সঠিক নয় — YYYY-MM-DD ফরম্যাটে দিন (যেমন 2026-10-05)`);
      }
      const [y, m, d] = value.split("-").map(Number);
      const probe = new Date(Date.UTC(y, m - 1, d));
      if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
        throw new BadRequestException(`${label} তারিখটি সঠিক নয় — YYYY-MM-DD ফরম্যাটে দিন (যেমন 2026-10-05)`);
      }
      // Noon UTC keeps the instant inside the intended Dhaka
      // calendar date when solved to that day's Dhaka midnight.
      return dhakaDayStartUtc(new Date(`${value}T12:00:00.000Z`));
    };
    let start: Date | undefined;
    let endExclusive: Date | undefined;
    if (q.from) start = parseDay(q.from, "from");
    if (q.to) endExclusive = new Date(parseDay(q.to, "to").getTime() + 24 * 3600 * 1000);
    if (q.from && q.to && q.from > q.to) {
      throw new BadRequestException("from তারিখ to তারিখের পরে হতে পারবে না");
    }
    const where: any = {
      organizationId,
      // CX12a: exports never include practice orders.
      isPractice: false,
      ...(q.status ? { status: q.status } : {}),
      ...(q.isCod !== undefined ? { isCod: q.isCod } : {}),
    };
    if (start || endExclusive) {
      const range: any = {
        ...(start ? { gte: start } : {}),
        ...(endExclusive ? { lt: endExclusive } : {}),
      };
      where.OR = [
        { placedAt: { ...range } },
        { placedAt: null, createdAt: { ...range } },
      ];
    }
    const orders = await (this.prisma as any).order.findMany({
      where, orderBy: { placedAt: "desc" }, take: 5000, // cap mirrors the leads export (5000 rows, newest first)
      include: { customer: true, items: true },
    });
    const headers = ["order_id", "external_id", "external_number", "source", "status", "is_cod", "payment_method", "customer_name", "customer_phone", "customer_email", "items", "subtotal", "shipping", "discount", "tax", "total", "refunded", "currency", "placed_at", "created_at"];
    const rows = (orders as any[]).map((o) => {
      const customer = o.customer ?? {};
      const customerName = [customer.firstName, customer.lastName].filter(Boolean).join(" ") || customer.name || "";
      return [
        o.id ?? "", o.externalId ?? "", o.externalNumber ?? "", o.source ?? "", o.status ?? "",
        o.isCod ? "yes" : "no", o.paymentMethod ?? "",
        customerName, customer.phone ?? "", customer.email ?? "",
        (o.items ?? []).map((i: any) => `${i.name} ×${i.quantity}`).join(" | "),
        minorToMajor(BigInt(o.subtotalMinor ?? 0)),
        minorToMajor(BigInt(o.shippingMinor ?? 0)),
        minorToMajor(BigInt(o.discountMinor ?? 0)),
        minorToMajor(BigInt(o.taxMinor ?? 0)),
        minorToMajor(BigInt(o.totalMinor ?? 0)),
        minorToMajor(BigInt(o.refundedMinor ?? 0)),
        o.currency ?? "",
        o.placedAt ? new Date(o.placedAt).toISOString() : "",
        o.createdAt ? new Date(o.createdAt).toISOString() : "",
      ];
    });
    return toCsv(headers, rows);
  }

  async getOne(organizationId: string, orderId: string) {
    const o = await (this.prisma as any).order.findFirst({
      where: { id: orderId, organizationId }, include: { customer: true, items: true, store: true },
    });
    if (!o) throw new NotFoundException("Order not found in this organization");
    const out: any = pubOrder(o);
    // EC19: payment verifications + advance/due math. The paid
    // advance is the sum of APPROVED rows only, capped at the
    // order total; the due is what remains (>= 0).
    const verificationRows = await this.verificationRowsForOrder(organizationId, orderId);
    const total = BigInt(o.totalMinor ?? 0);
    const paidSum = this.approvedAdvanceSum(verificationRows);
    const advancePaid = paidSum > total ? total : paidSum;
    out.paymentVerifications = verificationRows.map((row: any) => this.serializeVerification(row));
    out.advancePaidMinor = advancePaid.toString();
    out.amountDueMinor = (total - advancePaid).toString();
    // EC18: the chosen delivery slot, when one was picked.
    out.deliverySlot = await this.deliverySlotForOrder(organizationId, o);
    // EC30: the chosen pickup point, when the order is a pickup.
    out.pickupPoint = await this.pickupPointForOrder(organizationId, o);
    if (this.risk) {
      try { out.risk = await this.risk.forOrder(organizationId, o); } catch { /* advisory only */ }
    }
    return out;
  }

  /** M50 dedicated endpoint: the full assessment with verbatim reasons. */
  async riskForOrder(organizationId: string, orderId: string) {
    const o = await (this.prisma as any).order.findFirst({ where: { id: orderId, organizationId } });
    if (!o) throw new NotFoundException("Order not found in this organization");
    if (!this.risk) throw new NotFoundException("Risk service unavailable");
    return this.risk.forOrder(organizationId, o);
  }

  async stats(organizationId: string) {
    // CX12a: dashboard order stats never count practice orders.
    const grouped = await (this.prisma as any).order.groupBy({
      by: ["status"], where: { organizationId, isPractice: false }, _count: true, _sum: { totalMinor: true },
    });
    const cod = await (this.prisma as any).order.groupBy({
      by: ["isCod"], where: { organizationId, isPractice: false }, _count: true,
    });
    const byStatus = grouped.map((g: any) => ({
      status: g.status, count: g._count, totalMinor: (g._sum.totalMinor ?? 0n).toString(),
    }));
    const totalOrders = byStatus.reduce((s: number, g: any) => s + g.count, 0);
    const codCount = cod.find((c: any) => c.isCod)?._count ?? 0;
    // Delivered revenue = completed orders only. Cancelled/refunded money is
    // reported separately by status above, never merged into revenue.
    const delivered = byStatus.find((g: any) => g.status === "completed");
    return {
      totalOrders,
      codOrders: codCount,
      codSharePercent: totalOrders > 0 ? Math.round((codCount / totalOrders) * 10000) / 100 : 0,
      deliveredRevenueMinor: delivered?.totalMinor ?? "0",
      byStatus,
    };
  }

  /**
   * Feature 2: Find duplicate or conflicting orders placed by the same customer/phone
   * within recent active window across all sales channels.
   */
  async findDuplicates(organizationId: string) {
    const orders = await (this.prisma as any).order.findMany({
      where: {
        organizationId,
        status: { notIn: ["cancelled", "refunded"] },
      },
      orderBy: { placedAt: "desc" },
      take: 200,
      include: {
        customer: true,
        items: true,
      },
    });

    const groupsMap = new Map<string, any[]>();
    for (const o of orders) {
      const phone = phoneKey(o.customer?.phone);
      if (!phone) continue;
      const list = groupsMap.get(phone) ?? [];
      list.push(o);
      groupsMap.set(phone, list);
    }

    const duplicates: any[] = [];
    for (const [phone, ords] of groupsMap.entries()) {
      if (ords.length > 1) {
        const sorted = ords.sort(
          (a, b) =>
            new Date(b.placedAt ?? b.createdAt).getTime() -
            new Date(a.placedAt ?? a.createdAt).getTime(),
        );
        duplicates.push({
          phoneKey: phone,
          customerName:
            [sorted[0]?.customer?.firstName, sorted[0]?.customer?.lastName].filter(Boolean).join(" ") ||
            "Customer",
          count: sorted.length,
          orders: sorted.map((o) => ({
            id: o.id,
            externalNumber: o.externalNumber,
            totalAmountMinor: o.totalAmountMinor.toString(),
            status: o.status,
            placedAt: o.placedAt ?? o.createdAt,
            items: o.items.map((it: any) => ({
              id: it.id,
              name: it.name,
              quantity: it.quantity,
              totalMinor: it.totalMinor.toString(),
            })),
          })),
        });
      }
    }

    return {
      totalGroups: duplicates.length,
      totalDuplicateOrders: duplicates.reduce((acc, g) => acc + g.count, 0),
      groups: duplicates,
    };
  }

  /**
   * Feature 2: Merge duplicate orders into one primary order.
   * Cancels duplicate orders with clear audit reason, aggregates items, updates total.
   */
  async mergeOrders(organizationId: string, userId: string, dto: MergeOrdersDto) {
    const primary = await (this.prisma as any).order.findFirst({
      where: { id: dto.primaryOrderId, organizationId },
      include: { items: true, customer: true },
    });
    if (!primary) throw new NotFoundException("Primary order not found");

    const duplicates = await (this.prisma as any).order.findMany({
      where: {
        id: { in: dto.duplicateOrderIds },
        organizationId,
      },
      include: { items: true },
    });

    if (duplicates.length === 0) {
      throw new BadRequestException("No valid duplicate orders found to merge");
    }

    let additionalAmountMinor = 0n;
    const mergedOrderNumbers: string[] = [];

    for (const dup of duplicates) {
      if (dup.id === primary.id) continue;
      mergedOrderNumbers.push(dup.externalNumber || dup.id.slice(0, 8));

      // Append items to primary
      for (const item of dup.items) {
        await (this.prisma as any).orderItem.create({
          data: {
            orderId: primary.id,
            productId: item.productId,
            name: item.name,
            sku: item.sku,
            quantity: item.quantity,
            priceMinor: item.priceMinor,
            totalMinor: item.totalMinor,
          },
        });
        additionalAmountMinor += BigInt(item.totalMinor);
      }

      // Mark duplicate as cancelled
      await (this.prisma as any).order.update({
        where: { id: dup.id },
        data: {
          status: "cancelled",
          internalNote: `[MERGED] Merged into Order #${primary.externalNumber || primary.id} on ${new Date().toISOString()}${dto.mergeReason ? ` - Note: ${dto.mergeReason}` : ""}`,
        },
      });
    }

    // Update primary order total
    const newTotalMinor = BigInt(primary.totalMinor) + additionalAmountMinor;
    const updatedPrimary = await (this.prisma as any).order.update({
      where: { id: primary.id },
      data: {
        totalMinor: newTotalMinor,
        internalNote: `${primary.internalNote || ""}\n[MERGE_NOTE] Merged with duplicate orders: ${mergedOrderNumbers.join(", ")}`.trim(),
      },
      include: { items: true, customer: true },
    });

    await this.audit?.log({
      organizationId,
      userId,
      action: "orders.merged",
      entityType: "Order",
      entityId: primary.id,
      metadata: {
        primaryOrderId: primary.id,
        mergedOrderIds: dto.duplicateOrderIds,
        mergedCount: duplicates.length,
      },
    });

    return {
      success: true,
      message: `সফলভাবে ${duplicates.length}টি ডুপ্লিকেট অর্ডার #${primary.externalNumber || primary.id}-এ মার্জ করা হয়েছে।`,
      primaryOrder: pubOrder(updatedPrimary),
      mergedCount: duplicates.length,
    };
  }

  /**
   * Feature 5: Assign an agent/staff to an order with optional custom commission.
   */
  async assignAgent(
    organizationId: string,
    orderId: string,
    agentId: string,
    commissionMinor?: number,
  ) {
    const order = await (this.prisma as any).order.findFirst({
      where: { id: orderId, organizationId },
    });
    if (!order) throw new NotFoundException("Order not found");

    const updated = await (this.prisma as any).order.update({
      where: { id: orderId },
      data: {
        agentId,
        confirmedAt: new Date(),
        commissionMinor:
          commissionMinor !== undefined ? BigInt(commissionMinor) : order.commissionMinor,
      },
    });

    return pubOrder(updated);
  }

  /**
   * Bulk assign multiple orders to an agent.
   */
  async bulkAssignAgent(
    organizationId: string,
    orderIds: string[],
    agentId: string,
  ) {
    if (!orderIds || orderIds.length === 0) {
      throw new BadRequestException("No order IDs provided");
    }

    const result = await (this.prisma as any).order.updateMany({
      where: {
        organizationId,
        id: { in: orderIds },
      },
      data: {
        agentId,
        confirmedAt: new Date(),
      },
    });

    return {
      success: true,
      updatedCount: result.count,
    };
  }

  /**
   * Feature 5: Get Team Performance & Sales Attribution Scoreboard.
   * Compares staff performance by delivered orders, delivery rate %, return rate %,
   * total revenue generated, and earned commission.
   */
  async getStaffScoreboard(
    organizationId: string,
    query?: StaffScoreboardQueryDto,
  ) {
    const whereClause: any = { organizationId };

    if (query?.from || query?.to) {
      whereClause.placedAt = {};
      if (query.from) whereClause.placedAt.gte = new Date(query.from);
      if (query.to) whereClause.placedAt.lte = new Date(query.to);
    }

    // 1. Fetch all active memberships with their user details
    const memberships = await (this.prisma as any).membership.findMany({
      where: { organizationId, status: "ACTIVE" },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    const membersMap = new Map<string, any>();
    for (const m of memberships) {
      if (m.user) {
        membersMap.set(m.userId, {
          userId: m.userId,
          name: m.user.name || "Unknown",
          email: m.user.email,
          role: m.role,
        });
      }
    }

    // 2. Fetch orders within criteria
    const orders = await (this.prisma as any).order.findMany({
      where: whereClause,
      select: {
        id: true,
        agentId: true,
        status: true,
        totalMinor: true,
        commissionMinor: true,
        confirmedAt: true,
      },
    });

    const defaultCommissionBdt = query?.commissionPerDeliveryBdt ?? 50;

    const agentStats = new Map<
      string,
      {
        agentId: string;
        name: string;
        email: string;
        role: string;
        totalOrders: number;
        confirmedOrders: number;
        deliveredOrders: number;
        returnedOrders: number;
        inFlightOrders: number;
        deliveredRevenueMinor: bigint;
        totalCommissionMinor: bigint;
      }
    >();

    // Seed all active organization members
    for (const [userId, mem] of membersMap.entries()) {
      agentStats.set(userId, {
        agentId: userId,
        name: mem.name,
        email: mem.email,
        role: mem.role,
        totalOrders: 0,
        confirmedOrders: 0,
        deliveredOrders: 0,
        returnedOrders: 0,
        inFlightOrders: 0,
        deliveredRevenueMinor: 0n,
        totalCommissionMinor: 0n,
      });
    }

    // Seed unassigned bucket
    const UNASSIGNED_KEY = "unassigned";
    agentStats.set(UNASSIGNED_KEY, {
      agentId: UNASSIGNED_KEY,
      name: "অনির্ধারিত / আনঅ্যাসাইনড (Unassigned)",
      email: "-",
      role: "-",
      totalOrders: 0,
      confirmedOrders: 0,
      deliveredOrders: 0,
      returnedOrders: 0,
      inFlightOrders: 0,
      deliveredRevenueMinor: 0n,
      totalCommissionMinor: 0n,
    });

    for (const order of orders) {
      const key =
        order.agentId && agentStats.has(order.agentId)
          ? order.agentId
          : order.agentId || UNASSIGNED_KEY;

      if (!agentStats.has(key)) {
        agentStats.set(key, {
          agentId: key,
          name: `সাবেক এজেন্ট (${key.slice(0, 8)})`,
          email: "-",
          role: "STAFF",
          totalOrders: 0,
          confirmedOrders: 0,
          deliveredOrders: 0,
          returnedOrders: 0,
          inFlightOrders: 0,
          deliveredRevenueMinor: 0n,
          totalCommissionMinor: 0n,
        });
      }

      const stat = agentStats.get(key)!;
      stat.totalOrders++;

      if (order.confirmedAt) {
        stat.confirmedOrders++;
      }

      const st = (order.status || "").toLowerCase();
      const totMinor = BigInt(order.totalMinor || 0);

      if (st === "completed" || st === "delivered") {
        stat.deliveredOrders++;
        stat.deliveredRevenueMinor += totMinor;
        const comm =
          order.commissionMinor && order.commissionMinor > 0n
            ? BigInt(order.commissionMinor)
            : BigInt(defaultCommissionBdt * 100);
        stat.totalCommissionMinor += comm;
      } else if (
        st === "returned" ||
        st === "refunded" ||
        st === "failed" ||
        st === "cancelled"
      ) {
        stat.returnedOrders++;
      } else {
        stat.inFlightOrders++;
      }
    }

    const leaderboard = Array.from(agentStats.values())
      .filter((s) => s.totalOrders > 0 || s.agentId !== UNASSIGNED_KEY)
      .map((s) => {
        const finished = s.deliveredOrders + s.returnedOrders;
        const deliveryRate =
          finished > 0 ? (s.deliveredOrders / finished) * 100 : 0;
        const returnRate =
          finished > 0 ? (s.returnedOrders / finished) * 100 : 0;
        return {
          agentId: s.agentId,
          name: s.name,
          email: s.email,
          role: s.role,
          totalOrders: s.totalOrders,
          confirmedOrders: s.confirmedOrders,
          deliveredOrders: s.deliveredOrders,
          returnedOrders: s.returnedOrders,
          inFlightOrders: s.inFlightOrders,
          deliveredRevenueMinor: s.deliveredRevenueMinor.toString(),
          deliveredRevenueBdt: Number(s.deliveredRevenueMinor) / 100,
          deliveryRatePercent: Math.round(deliveryRate * 10) / 10,
          returnRatePercent: Math.round(returnRate * 10) / 10,
          totalCommissionMinor: s.totalCommissionMinor.toString(),
          totalCommissionBdt: Number(s.totalCommissionMinor) / 100,
        };
      })
      .sort((a, b) => b.deliveredRevenueBdt - a.deliveredRevenueBdt);

    return {
      totalAgents: leaderboard.filter((l) => l.agentId !== UNASSIGNED_KEY).length,
      defaultCommissionPerDeliveryBdt: defaultCommissionBdt,
      leaderboard,
    };
  }
}
