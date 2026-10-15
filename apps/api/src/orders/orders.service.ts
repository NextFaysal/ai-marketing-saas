import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma } from "@repo/db";
import {
  QUEUE_KEYS, QUEUE_LABELS, STUCK_DAYS, TRANSIT_STATUSES, SHIPMENT_TERMINAL_STATUSES,
  OPEN_RETURN_STATUSES, isQueueKey, dhakaTodayString, type QueueKey,
} from "./order-queues";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { RiskService } from "./risk.service";
import { EventsService } from "../common/events.service";
import { InventoryService } from "../inventory/inventory.service";
import { OrderPushService } from "../commerce/order-push.service";
import { minorToMajor, toCsv } from "../imports/csv";
import { dhakaDayStartUtc } from "../crm/lead-followups";
import type { AdvanceVerificationDto, AssignAgentDto, BulkAssignAgentDto, CreateManualOrderDto, MergeDuplicateOrdersDto, StaffScoreboardQueryDto, UpdateOrderDto } from "./orders.dto";
import { parseBdAddress } from "./bd-address";
import { computeIntakeWarnings } from "./intake-warnings";
import { BlockedPhoneService } from "../fraud/blocked-phone.service";
// ON6: the SLA helper is PURE (no Nest/Prisma imports), so
// importing it from fulfillment/ creates no module cycle.
import { computeSlaStage, SLA_DEFAULTS } from "../fulfillment/sla";
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

/** ON1: the only filter keys a saved view may carry (list-v2 whitelist). */
export const LIST_V2_FILTER_KEYS = ["status", "isCod", "queue", "dateFrom", "dateTo", "district", "provider", "source", "paymentState", "minTotal", "maxTotal", "assigneeId", "tag", "search", "sort", "pageSize", "riskBand"];

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
    // ON4/ON11: blocklist reads for intake warnings. Appended
    // LAST + @Optional (FraudModule is imported by OrdersModule);
    // absent leaves warnings without the blocked check.
    @Optional() private readonly blockedPhones?: BlockedPhoneService,
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
        // ON11: district joins address_1 only when provided —
        // the stored shape otherwise stays exactly as before.
        address: dto.address || dto.district
          ? {
              ...(dto.address ? { address_1: dto.address } : {}),
              ...(dto.district ? { district: dto.district } : {}),
            }
          : undefined,
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
    // ON11: intake warnings ride the response (never blocking —
    // a warnings failure ships an empty list, creation stands).
    let intakeWarnings: any[] = [];
    let addressSuggestion: any = null;
    try {
      const custAddr = (order as any).customer?.address;
      const intake = await computeIntakeWarnings(this.prisma, this.blockedPhones, organizationId, {
        phone: (order as any).customer?.phone ?? phone,
        name: dto.customerName?.trim()
          || [(order as any).customer?.firstName, (order as any).customer?.lastName].filter(Boolean).join(" ")
          || null,
        addressText: dto.address ?? (order as any).address ?? null,
        customerDistrict: dto.district ?? (custAddr && typeof custAddr === "object" ? custAddr.district ?? null : null),
      });
      intakeWarnings = intake.warnings;
      addressSuggestion = intake.addressSuggestion;
    } catch { /* warnings are advisory only */ }
    return { ...pubOrder(order), upsertResult: result, warnings: intakeWarnings, addressSuggestion };
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
    // ON3: a merged-away order is terminal. Its verifications
    // (and goods) now live on the survivor, so reviving it or
    // recording a refund against it would corrupt the
    // survivor's due math. Note/address edits stay allowed.
    if ((order as any).mergedIntoId) {
      if (dto.status !== undefined && dto.status !== order.status) {
        throw new BadRequestException("এই অর্ডারটি অন্য অর্ডারে মার্জ হয়ে গেছে — এটি আর চালু করা যাবে না");
      }
      if (dto.refund !== undefined && dto.refund !== null) {
        throw new BadRequestException("এই অর্ডারটি অন্য অর্ডারে মার্জ হয়ে গেছে — এতে refund করা যাবে না");
      }
    }
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

  /** Shared list-page enrichment (EC18 slot, EC30 pickup point,
   * M50 risk, ON1 batch advance/due + tags/assignee). Failure-
   * isolated per block: a broken enrichment never fails the list. */
  private async enrichListRows(organizationId: string, items: any[], mapped: any[]) {
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
    // ON1: batch advance/due for the page (ONE groupBy, never
    // N+1) + tags/assignee surfaced from the new columns.
    try {
      const sums = await this.approvedSumsByOrder(organizationId, items.map((o: any) => String(o.id)));
      items.forEach((o: any, idx: number) => {
        const total = BigInt(o.totalMinor ?? 0);
        const paidRaw = sums.get(String(o.id)) ?? 0n;
        const paid = paidRaw > total ? total : paidRaw;
        (mapped[idx] as any).advancePaidMinor = paid.toString();
        (mapped[idx] as any).amountDueMinor = (total - paid).toString();
        (mapped[idx] as any).tags = Array.isArray(o.tags) ? o.tags : (o.tags ?? null);
        (mapped[idx] as any).assigneeId = o.assigneeId ?? null;
      });
    } catch {
      items.forEach((o: any, idx: number) => {
        (mapped[idx] as any).advancePaidMinor = "0";
        (mapped[idx] as any).amountDueMinor = BigInt(o.totalMinor ?? 0).toString();
        (mapped[idx] as any).tags = Array.isArray(o.tags) ? o.tags : (o.tags ?? null);
        (mapped[idx] as any).assigneeId = o.assigneeId ?? null;
      });
    }
  }

  async list(organizationId: string, q: {
    status?: string; isCod?: boolean; page?: number; pageSize?: number; includePractice?: boolean;
    // ON1 list v2 (all optional; absent = legacy behaviour/shape):
    queue?: string; dateFrom?: string; dateTo?: string; district?: string; provider?: string;
    source?: string; paymentState?: string; minTotal?: string; maxTotal?: string;
    assigneeId?: string; tag?: string; search?: string; sort?: string; riskBand?: string;
  }) {
    // ON1: any v2 param routes to the v2 path; legacy calls are
    // byte-for-byte the old behaviour below.
    const hasV2 = [q.queue, q.dateFrom, q.dateTo, q.district, q.provider, q.source, q.paymentState,
      q.minTotal, q.maxTotal, q.assigneeId, q.tag, q.search, q.sort, q.riskBand]
      .some((v) => v !== undefined && v !== null && v !== "");
    if (hasV2) return this.listV2(organizationId, q);
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
    await this.enrichListRows(organizationId, items, mapped);
    return { total, page, pageSize, items: mapped };
  }

  // ---------- ON1: Command Center v2 ----------

  /** Sum of APPROVED PaymentVerification amounts per order, ONE
   * groupBy for the whole id set (never N+1). A missing delegate
   * (partial deployment / fake) degrades to an empty map. */
  private async approvedSumsByOrder(organizationId: string, orderIds: string[]): Promise<Map<string, bigint>> {
    const out = new Map<string, bigint>();
    if (orderIds.length === 0) return out;
    try {
      const table = (this.prisma as any).paymentVerification;
      if (!table?.groupBy) return out;
      const rows = await table.groupBy({
        by: ["orderId"],
        where: { organizationId, status: "approved", orderId: { in: orderIds } },
        _sum: { amountMinor: true },
      });
      for (const r of rows ?? []) {
        if (r?.orderId == null) continue;
        try { out.set(String(r.orderId), BigInt(r._sum?.amountMinor ?? 0)); } catch { /* unparseable counts 0 */ }
      }
    } catch { /* advisory math only */ }
    return out;
  }

  /** S3 day parsing, shared shape: a "YYYY-MM-DD" string read as
   * an Asia/Dhaka calendar day (returns that day's start instant). */
  private parseDhakaDay(value: string, label: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException(`${label} তারিখটি সঠিক নয় — YYYY-MM-DD ফরম্যাটে দিন (যেমন 2026-10-05)`);
    }
    const [y, m, d] = value.split("-").map(Number);
    const probe = new Date(Date.UTC(y, m - 1, d));
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
      throw new BadRequestException(`${label} তারিখটি সঠিক নয় — YYYY-MM-DD ফরম্যাটে দিন (যেমন 2026-10-05)`);
    }
    return dhakaDayStartUtc(new Date(`${value}T12:00:00.000Z`));
  }

  /**
   * ON1 queues: resolve a queue key to its order ids (placedAt
   * desc). This is the SINGLE code path behind both the counts
   * endpoint and the queue-filtered list.
   *
   * Cost note (honest): the simple queues are one indexed query.
   * ready_to_pack / in_transit_stuck / returns_open first load
   * the org's candidate orders for the relevant statuses, then
   * resolve shipments / fulfillments / returns in bulk and do
   * the set logic in JS — bounded by the org's open-order volume,
   * not by total history. due_collection is ONE grouped raw SQL
   * query (orders LEFT JOIN grouped approved sums).
   */
  async resolveQueueOrderIds(organizationId: string, queueKey: string): Promise<string[]> {
    if (!isQueueKey(queueKey)) {
      throw new BadRequestException(`অজানা কিউ "${queueKey}" — সঠিক কিউ: ${QUEUE_KEYS.join(", ")}`);
    }
    const key = queueKey as QueueKey;
    const orderTable = (this.prisma as any).order;
    const byPlacedDesc = (a: any, b: any) =>
      new Date(b.placedAt ?? b.createdAt ?? 0).getTime() - new Date(a.placedAt ?? a.createdAt ?? 0).getTime();
    const idsOf = (rows: any[]) => [...rows].sort(byPlacedDesc).map((r: any) => String(r.id));

    if (key === "due_collection") {
      // ONE grouped raw SQL query: orders whose total exceeds the
      // sum of their APPROVED PaymentVerification amounts.
      const rows: any[] = await (this.prisma as any).$queryRaw(Prisma.sql`
        SELECT o."id" AS "id", o."placedAt" AS "placedAt", o."createdAt" AS "createdAt"
        FROM "Order" o
        LEFT JOIN (
          SELECT "orderId", SUM("amountMinor") AS paid
          FROM "PaymentVerification"
          WHERE "organizationId" = ${organizationId} AND "status" = 'approved' AND "amountMinor" IS NOT NULL
          GROUP BY "orderId"
        ) pv ON pv."orderId" = o."id"
        WHERE o."organizationId" = ${organizationId}
          AND o."isPractice" = false
          AND o."status" IN ('completed', 'delivered')
          AND o."totalMinor" > COALESCE(pv.paid, 0)
        ORDER BY o."placedAt" DESC NULLS LAST
      `);
      return (rows ?? []).map((r: any) => String(r.id));
    }

    if (key === "all") {
      const rows = await orderTable.findMany({ where: { organizationId, isPractice: false } });
      return idsOf(rows ?? []);
    }
    if (key === "all_open") {
      const rows = await orderTable.findMany({
        where: { organizationId, isPractice: false, status: { notIn: ["completed", "cancelled", "refunded", "failed", "returned"] } },
      });
      return idsOf(rows ?? []);
    }
    if (key === "needs_confirmation") {
      const rows = await orderTable.findMany({
        where: {
          organizationId, isPractice: false, isCod: true, codConfirmationStatus: "awaiting",
          status: { in: ["pending", "on-hold", "processing"] },
        },
      });
      return idsOf(rows ?? []);
    }
    if (key === "deliveries_today") {
      // Only the slot/date signal exists: the order vocabulary has
      // NO out-for-delivery status, so deliveryDate == today
      // (Asia/Dhaka string equality) is the whole predicate.
      const rows = await orderTable.findMany({
        where: {
          organizationId, isPractice: false, deliveryDate: dhakaTodayString(),
          status: { notIn: ["cancelled", "failed", "refunded", "returned"] },
        },
      });
      return idsOf(rows ?? []);
    }
    if (key === "ready_to_pack") {
      const candidates: any[] = (await orderTable.findMany({
        where: { organizationId, isPractice: false, status: { in: ["processing", "on-hold"] } },
        include: { items: true },
      })) ?? [];
      // ON4: review-held orders are NOT ready to pack (fake rows
      // may lack the field — undefined passes, only true excludes).
      const open = candidates.filter((o: any) => o.codConfirmationStatus !== "awaiting" && o.reviewHold !== true);
      if (open.length === 0) return [];
      const ids = open.map((o: any) => String(o.id));
      // Active shipment = a CourierShipment NOT in a terminal status.
      const shipments: any[] = ((await (this.prisma as any).courierShipment?.findMany({
        where: { organizationId, orderId: { in: ids } },
      }).catch(() => [])) ?? []);
      const hasActiveShipment = new Set(
        shipments.filter((s: any) => !(SHIPMENT_TERMINAL_STATUSES as readonly string[]).includes(s.status)).map((s: any) => String(s.orderId)),
      );
      const fulfillments: any[] = ((await (this.prisma as any).fulfillment?.findMany({
        where: { organizationId, orderId: { in: ids } },
      }).catch(() => [])) ?? []);
      // Coverage rule: across the order's NON-cancelled
      // fulfillments, sum the committed (packing) quantity per
      // orderItemId; covered iff EVERY order item's summed
      // quantity >= its ordered quantity. No fulfillments => not
      // covered => the order stays in the queue.
      const packedByOrder = new Map<string, Map<string, number>>();
      for (const f of fulfillments) {
        if (f.status === "cancelled") continue;
        const perItem = packedByOrder.get(String(f.orderId)) ?? new Map<string, number>();
        for (const line of (f.items ?? []) as any[]) {
          perItem.set(String(line.orderItemId), (perItem.get(String(line.orderItemId)) ?? 0) + (line.quantity ?? 0));
        }
        packedByOrder.set(String(f.orderId), perItem);
      }
      const ready = open.filter((o: any) => {
        if (hasActiveShipment.has(String(o.id))) return false;
        const perItem = packedByOrder.get(String(o.id));
        if (!perItem) return true;
        const items = o.items ?? [];
        if (items.length === 0) return true;
        return !items.every((i: any) => (perItem.get(String(i.id)) ?? 0) >= (i.quantity ?? 0));
      });
      return idsOf(ready);
    }
    if (key === "in_transit_stuck") {
      const cutoff = new Date(Date.now() - STUCK_DAYS * 24 * 3600 * 1000);
      const shipments: any[] = ((await (this.prisma as any).courierShipment?.findMany({
        where: { organizationId },
      }).catch(() => [])) ?? []);
      const stuckOrderIds = new Set(
        shipments
          .filter((s: any) => (TRANSIT_STATUSES as readonly string[]).includes(s.status) && s.updatedAt && new Date(s.updatedAt).getTime() < cutoff.getTime())
          .map((s: any) => String(s.orderId)),
      );
      if (stuckOrderIds.size === 0) return [];
      const rows = await orderTable.findMany({
        where: { organizationId, isPractice: false, id: { in: [...stuckOrderIds] } },
      });
      return idsOf(rows ?? []);
    }
    if (key === "review_hold") {
      const rows = await orderTable.findMany({
        where: {
          organizationId, isPractice: false, reviewHold: true,
          status: { notIn: ["completed", "delivered", "cancelled", "refunded", "failed", "returned"] },
        },
      });
      return idsOf(rows ?? []);
    }
    if (key === "incomplete_intake") {
      const rows: any[] = (await orderTable.findMany({
        where: {
          organizationId, isPractice: false,
          status: { notIn: ["completed", "delivered", "cancelled", "refunded", "failed", "returned"] },
        },
        include: { customer: true },
      })) ?? [];
      const custAddressText = (c: any): string => {
        const a = c?.address;
        if (!a) return "";
        if (typeof a === "string") return a;
        return String(a.address_1 ?? a.address1 ?? "");
      };
      const custDistrict = (c: any): string | null => {
        const a = c?.address;
        if (a && typeof a === "object" && a.district) return String(a.district);
        return null;
      };
      const incomplete = rows.filter((o: any) => {
        const customer = o.customer ?? null;
        const phoneMissing = !String(customer?.phone ?? "").trim();
        const orderAddr = String(o.address ?? "").trim();
        const custAddr = custAddressText(customer).trim();
        const addressMissing = !orderAddr && !custAddr;
        const addressText = orderAddr || custAddr;
        const districtMissing = !custDistrict(customer) && parseBdAddress(addressText).district === null;
        return phoneMissing || addressMissing || districtMissing;
      });
      return idsOf(incomplete);
    }
    if (key === "sla_breach") {
      // ON6 load shape (bounded, documented): the org's OPEN
      // orders (non-practice, status outside the sla.ts done
      // set) in ONE query, their fulfilments + shipments in ONE
      // bulk query each, and the org's FulfillmentSetting in
      // ONE read — then the PURE computeSlaStage decides per
      // order in JS. Bounded by the org's open-order volume,
      // exactly like ready_to_pack above; counts and the list
      // share this path, so they cannot drift.
      const candidates: any[] = (await orderTable.findMany({
        where: {
          organizationId, isPractice: false,
          status: { notIn: ["cancelled", "refunded", "failed", "returned", "delivered", "completed"] },
        },
      })) ?? [];
      if (candidates.length === 0) return [];
      const candidateIds = candidates.map((o: any) => String(o.id));
      const fulfillments: any[] = ((await (this.prisma as any).fulfillment?.findMany({
        where: { organizationId, orderId: { in: candidateIds } },
      }).catch(() => [])) ?? []);
      const shipments: any[] = ((await (this.prisma as any).courierShipment?.findMany({
        where: { organizationId, orderId: { in: candidateIds } },
      }).catch(() => [])) ?? []);
      let setting: any = { ...SLA_DEFAULTS };
      try {
        const settingTable = (this.prisma as any).fulfillmentSetting;
        const row = settingTable?.findFirst
          ? await settingTable.findFirst({ where: { organizationId } }).catch(() => null)
          : null;
        if (row) setting = row;
      } catch { /* in-code defaults */ }
      const byOrder = (rows: any[]) => {
        const map = new Map<string, any[]>();
        for (const r of rows) {
          const list = map.get(String(r.orderId)) ?? [];
          list.push(r);
          map.set(String(r.orderId), list);
        }
        return map;
      };
      const fulfillmentsByOrder = byOrder(fulfillments);
      const shipmentsByOrder = byOrder(shipments);
      const now = new Date();
      const breached = candidates.filter((o: any) =>
        computeSlaStage(o, fulfillmentsByOrder.get(String(o.id)) ?? [], shipmentsByOrder.get(String(o.id)) ?? [], setting, now).breached);
      return idsOf(breached);
    }
    // returns_open
    const returns: any[] = ((await (this.prisma as any).returnRequest?.findMany({
      where: { organizationId },
    }).catch(() => [])) ?? []);
    const openReturnOrderIds = new Set(
      returns.filter((r: any) => (OPEN_RETURN_STATUSES as readonly string[]).includes(r.status)).map((r: any) => String(r.orderId)),
    );
    if (openReturnOrderIds.size === 0) return [];
    const rows = await orderTable.findMany({
      where: { organizationId, isPractice: false, id: { in: [...openReturnOrderIds] } },
    });
    return idsOf(rows ?? []);
  }

  /** ON1: queue counts — shares resolveQueueOrderIds with the list. */
  async queueCounts(organizationId: string) {
    const out: { key: QueueKey; label: string; count: number }[] = [];
    for (const key of QUEUE_KEYS) {
      const ids = await this.resolveQueueOrderIds(organizationId, key);
      out.push({ key, label: QUEUE_LABELS[key], count: ids.length });
    }
    return out;
  }

  /**
   * ON1 list v2. Semantics:
   * - queue restricts to the resolveQueueOrderIds set first.
   * - dateFrom/dateTo filter the effective order date
   *   (placedAt ?? createdAt, S3 rule) as Asia/Dhaka days.
   * - district: native checkout stores the district on
   *   Customer.address Json as { address_1, district, note } —
   *   match that district (case-insensitive equality) OR the
   *   order's own address string containing the value
   *   (case-insensitive).
   * - provider: orders with >= 1 CourierShipment of that provider.
   * - paymentState (approved sums via ONE groupBy):
   *   paid = approvedSum >= totalMinor (a 0-total order is paid);
   *   partial = 0 < approvedSum < totalMinor;
   *   due = approvedSum == 0 AND totalMinor > 0.
   * - tag: the order's tags Json array contains the tag.
   * - search: externalNumber / externalId contains, or customer
   *   firstName / lastName / phone contains (all case-insensitive),
   *   AND-combined with every other filter.
   * Candidate rows are loaded once (org-scoped, base filters in
   * the query) and the v2 predicates applied in JS — the same
   * honest-cost shape as the queues.
   */
  private async listV2(organizationId: string, q: {
    status?: string; isCod?: boolean; page?: number; pageSize?: number; includePractice?: boolean;
    queue?: string; dateFrom?: string; dateTo?: string; district?: string; provider?: string;
    source?: string; paymentState?: string; minTotal?: string; maxTotal?: string;
    assigneeId?: string; tag?: string; search?: string; sort?: string; riskBand?: string;
  }) {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 20));
    const sort = q.sort ?? "placedAt_desc";
    if (!["placedAt_desc", "placedAt_asc", "total_desc", "total_asc"].includes(sort)) {
      throw new BadRequestException(`অজানা sort "${sort}" — সঠিক sort: placedAt_desc, placedAt_asc, total_desc, total_asc`);
    }
    if (q.paymentState && !["paid", "partial", "due"].includes(q.paymentState)) {
      throw new BadRequestException(`অজানা paymentState "${q.paymentState}" — সঠিক মান: paid, partial, due`);
    }
    if (q.riskBand && !["low", "medium", "high"].includes(q.riskBand)) {
      throw new BadRequestException(`অজানা riskBand "${q.riskBand}" — সঠিক মান: low, medium, high`);
    }
    let minTotal: bigint | null = null;
    let maxTotal: bigint | null = null;
    try { if (q.minTotal) minTotal = BigInt(q.minTotal); } catch { throw new BadRequestException("minTotal সঠিক সংখ্যায় পাঠান (পয়সায়)"); }
    try { if (q.maxTotal) maxTotal = BigInt(q.maxTotal); } catch { throw new BadRequestException("maxTotal সঠিক সংখ্যায় পাঠান (পয়সায়)"); }
    let start: Date | undefined;
    let endExclusive: Date | undefined;
    if (q.dateFrom) start = this.parseDhakaDay(q.dateFrom, "dateFrom");
    if (q.dateTo) endExclusive = new Date(this.parseDhakaDay(q.dateTo, "dateTo").getTime() + 24 * 3600 * 1000);
    if (q.dateFrom && q.dateTo && q.dateFrom > q.dateTo) {
      throw new BadRequestException("dateFrom তারিখ dateTo তারিখের পরে হতে পারবে না");
    }

    let queueSet: Set<string> | null = null;
    if (q.queue) queueSet = new Set(await this.resolveQueueOrderIds(organizationId, q.queue));

    const where: any = {
      organizationId,
      ...(q.includePractice ? {} : { isPractice: false }),
      ...(q.status ? { status: q.status } : {}),
      ...(q.isCod !== undefined ? { isCod: q.isCod } : {}),
      ...(q.source ? { source: q.source } : {}),
      ...(q.assigneeId ? { assigneeId: q.assigneeId } : {}),
      // ON4: riskBand is a real column — filter in the base where.
      ...(q.riskBand ? { riskBand: q.riskBand } : {}),
    };
    let rows: any[] = ((await (this.prisma as any).order.findMany({
      where, include: { customer: true, items: true },
    })) ?? []);

    if (queueSet) rows = rows.filter((o: any) => queueSet!.has(String(o.id)));
    if (start || endExclusive) {
      rows = rows.filter((o: any) => {
        const eff = o.placedAt ?? o.createdAt;
        if (!eff) return false;
        const t = new Date(eff).getTime();
        if (start && t < start.getTime()) return false;
        if (endExclusive && t >= endExclusive.getTime()) return false;
        return true;
      });
    }
    if (q.tag) {
      rows = rows.filter((o: any) => Array.isArray(o.tags) && o.tags.map((t: any) => String(t)).includes(q.tag!));
    }
    if (q.district) {
      const needle = q.district.toLowerCase();
      rows = rows.filter((o: any) => {
        const custDistrict = o.customer?.address?.district;
        if (custDistrict && String(custDistrict).toLowerCase() === needle) return true;
        return typeof o.address === "string" && o.address.toLowerCase().includes(needle);
      });
    }
    if (q.search) {
      const needle = q.search.toLowerCase();
      rows = rows.filter((o: any) => {
        const c = o.customer ?? {};
        return [o.externalNumber, o.externalId, c.firstName, c.lastName, c.phone]
          .some((v: any) => v != null && String(v).toLowerCase().includes(needle));
      });
    }
    if (minTotal !== null) rows = rows.filter((o: any) => BigInt(o.totalMinor ?? 0) >= minTotal!);
    if (maxTotal !== null) rows = rows.filter((o: any) => BigInt(o.totalMinor ?? 0) <= maxTotal!);
    if (q.provider) {
      const shipments: any[] = ((await (this.prisma as any).courierShipment?.findMany({
        where: { organizationId },
      }).catch(() => [])) ?? []);
      const withProvider = new Set(shipments.filter((s: any) => s.provider === q.provider).map((s: any) => String(s.orderId)));
      rows = rows.filter((o: any) => withProvider.has(String(o.id)));
    }
    if (q.paymentState) {
      const sums = await this.approvedSumsByOrder(organizationId, rows.map((o: any) => String(o.id)));
      rows = rows.filter((o: any) => {
        const total = BigInt(o.totalMinor ?? 0);
        const paid = sums.get(String(o.id)) ?? 0n;
        if (q.paymentState === "paid") return paid >= total;
        if (q.paymentState === "partial") return paid > 0n && paid < total;
        return paid === 0n && total > 0n; // due
      });
    }

    const effTime = (o: any) => new Date(o.placedAt ?? o.createdAt ?? 0).getTime();
    rows.sort((a: any, b: any) => {
      if (sort === "placedAt_asc") return effTime(a) - effTime(b);
      if (sort === "total_desc") return BigInt(b.totalMinor ?? 0) > BigInt(a.totalMinor ?? 0) ? 1 : BigInt(b.totalMinor ?? 0) < BigInt(a.totalMinor ?? 0) ? -1 : 0;
      if (sort === "total_asc") return BigInt(a.totalMinor ?? 0) > BigInt(b.totalMinor ?? 0) ? 1 : BigInt(a.totalMinor ?? 0) < BigInt(b.totalMinor ?? 0) ? -1 : 0;
      return effTime(b) - effTime(a); // placedAt_desc
    });

    const total = rows.length;
    const items = rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    const mapped = items.map(pubOrder);
    await this.enrichListRows(organizationId, items, mapped);
    return { total, page, pageSize, items: mapped };
  }

  /** ON1 tag validation (shared by the tags endpoint + bulk):
   * an array of at most 10 tags, each trimmed 1..30 chars, deduped. */
  validateTags(input: unknown): string[] {
    if (!Array.isArray(input)) throw new BadRequestException("tags একটি তালিকা (array) হতে হবে");
    if (input.length > 10) throw new BadRequestException("সর্বোচ্চ ১০টি ট্যাগ দেওয়া যাবে");
    const out: string[] = [];
    for (const raw of input) {
      const tag = String(raw ?? "").trim();
      if (tag.length < 1 || tag.length > 30) {
        throw new BadRequestException("প্রতিটি ট্যাগ ১–৩০ অক্ষরের হতে হবে");
      }
      if (!out.includes(tag)) out.push(tag);
    }
    return out;
  }

  /** ON1: replace an order's tags (org-scoped; foreign id = 404). */
  async setTags(organizationId: string, actorId: string, orderId: string, input: unknown) {
    const tags = this.validateTags(input);
    const order = await (this.prisma as any).order.findFirst({ where: { id: orderId, organizationId } });
    if (!order) throw new NotFoundException("Order not found in this organization");
    await (this.prisma as any).order.update({ where: { id: order.id }, data: { tags } });
    await this.audit?.log({
      organizationId, userId: actorId, action: "orders.tags_updated",
      entityType: "Order", entityId: orderId, metadata: { count: tags.length },
    }).catch(() => undefined);
    return this.getOne(organizationId, orderId);
  }

  /** ON1: assign / unassign an order. A non-null assignee must be
   * an ACTIVE member of the org. */
  async assignOrder(organizationId: string, actorId: string, orderId: string, assigneeId: string | null) {
    const order = await (this.prisma as any).order.findFirst({ where: { id: orderId, organizationId } });
    if (!order) throw new NotFoundException("Order not found in this organization");
    if (assigneeId !== null && assigneeId !== undefined) {
      await this.assertActiveMember(organizationId, assigneeId);
    }
    await (this.prisma as any).order.update({
      where: { id: order.id }, data: { assigneeId: assigneeId ?? null },
    });
    await this.audit?.log({
      organizationId, userId: actorId, action: "orders.assigned",
      entityType: "Order", entityId: orderId, metadata: { assigneeId: assigneeId ?? null },
    }).catch(() => undefined);
    return this.getOne(organizationId, orderId);
  }

  /** Shared ACTIVE-membership check (assign + bulk assign). */
  async assertActiveMember(organizationId: string, userId: string): Promise<void> {
    const member = await (this.prisma as any).membership?.findFirst({
      where: { userId, organizationId, status: "ACTIVE" },
    }).catch(() => null);
    if (!member) {
      throw new BadRequestException("দায়িত্বপ্রাপ্ত ব্যক্তি এই প্রতিষ্ঠানের সক্রিয় সদস্য নন");
    }
  }

  // ---------- ON1: saved views ----------

  async listSavedViews(organizationId: string, userId: string) {
    const table = (this.prisma as any).orderSavedView;
    if (!table?.findMany) return [];
    const rows = await table.findMany({ where: { organizationId, userId } });
    return [...(rows ?? [])].sort((a: any, b: any) =>
      new Date(b.updatedAt ?? b.createdAt ?? 0).getTime() - new Date(a.updatedAt ?? a.createdAt ?? 0).getTime());
  }

  async createSavedView(organizationId: string, userId: string, dto: { name?: string; queue?: string | null; filters?: unknown }) {
    const name = String(dto?.name ?? "").trim();
    if (name.length < 1 || name.length > 80) {
      throw new BadRequestException("ভিউয়ের নাম ১–৮০ অক্ষরের হতে হবে");
    }
    const filters = dto?.filters ?? {};
    if (typeof filters !== "object" || filters === null || Array.isArray(filters)) {
      throw new BadRequestException("filters একটি object হতে হবে");
    }
    for (const key of Object.keys(filters as Record<string, unknown>)) {
      if (!LIST_V2_FILTER_KEYS.includes(key)) {
        throw new BadRequestException(`অজানা filter "${key}" — সঠিক filter: ${LIST_V2_FILTER_KEYS.join(", ")}`);
      }
    }
    if (dto?.queue != null && !isQueueKey(dto.queue)) {
      throw new BadRequestException(`অজানা কিউ "${dto.queue}" — সঠিক কিউ: ${QUEUE_KEYS.join(", ")}`);
    }
    const table = (this.prisma as any).orderSavedView;
    if (!table?.create) throw new BadRequestException("Saved views are not available in this deployment");
    const row = await table.create({
      data: { organizationId, userId, name, queue: dto?.queue ?? null, filters },
    });
    await this.audit?.log({
      organizationId, userId, action: "orders.saved_view_created",
      entityType: "OrderSavedView", entityId: row.id, metadata: { name },
    }).catch(() => undefined);
    return row;
  }

  async deleteSavedView(organizationId: string, userId: string, viewId: string) {
    const table = (this.prisma as any).orderSavedView;
    const row = table?.findFirst
      ? await table.findFirst({ where: { id: viewId, organizationId, userId } }).catch(() => null)
      : null;
    if (!row) throw new NotFoundException("Saved view not found");
    await table.delete({ where: { id: row.id } });
    await this.audit?.log({
      organizationId, userId, action: "orders.saved_view_deleted",
      entityType: "OrderSavedView", entityId: viewId, metadata: {},
    }).catch(() => undefined);
    return { deleted: true, id: viewId };
  }

  // ---------- ON1: live feed ----------

  /** Orders created OR updated after `since` (max 50), newest
   * activity first. changeKind is "created" when the creation
   * itself is after `since`, else "updated". Practice excluded. */
  async feed(organizationId: string, sinceRaw?: string) {
    const since = sinceRaw ? new Date(sinceRaw) : null;
    if (!since || Number.isNaN(since.getTime())) {
      throw new BadRequestException("since একটি সঠিক ISO তারিখ-সময় হতে হবে");
    }
    const rows: any[] = ((await (this.prisma as any).order.findMany({
      where: { organizationId, isPractice: false },
      include: { customer: true },
    })) ?? []);
    const t = since.getTime();
    return rows
      .filter((o: any) => {
        const c = o.createdAt ? new Date(o.createdAt).getTime() : 0;
        const u = o.updatedAt ? new Date(o.updatedAt).getTime() : 0;
        return c > t || u > t;
      })
      .map((o: any) => {
        const c = o.createdAt ? new Date(o.createdAt).getTime() : 0;
        const u = o.updatedAt ? new Date(o.updatedAt).getTime() : 0;
        return { o, activity: Math.max(c, u), created: c > t };
      })
      .sort((a: any, b: any) => b.activity - a.activity)
      .slice(0, 50)
      .map(({ o, created }: any) => ({
        id: o.id,
        externalNumber: o.externalNumber ?? null,
        source: o.source ?? null,
        status: o.status,
        isCod: o.isCod ?? false,
        totalMinor: BigInt(o.totalMinor ?? 0).toString(),
        placedAt: o.placedAt ?? null,
        createdAt: o.createdAt ?? null,
        updatedAt: o.updatedAt ?? null,
        changeKind: created ? "created" : "updated",
        customerName: [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(" ") || null,
      }));
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
  async mergeOrders(organizationId: string, userId: string, dto: MergeDuplicateOrdersDto) {
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
