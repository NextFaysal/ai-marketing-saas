import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

/**
 * ON2 — Order Insights: unified timeline, Customer 360 and the
 * staff-only internal comment thread for one order.
 *
 * Honesty rules (package-wide):
 * - the timeline merges REAL records only — every source is
 *   failure-isolated, so a missing delegate degrades to "no
 *   entries from that source", never to fabricated entries;
 * - PaymentVerification rows are the ONLY payment entries (their
 *   audits, when any, live under entityType "PaymentVerification"
 *   and are never read here — no double counting);
 * - comment CONTENT is never written to audit metadata.
 */

type Entry = {
  at: Date;
  kind: string;
  title: string;
  detail: string | null;
  actorId: string | null;
};

const OPEN_RETURN_STATUSES = ["requested", "approved", "return_shipped", "received"];
const FULFILLMENT_STATUS_TITLES: Record<string, string> = {
  packed: "প্যাক করা হয়েছে",
  handed_over: "কুরিয়ারের হাতে দেওয়া হয়েছে",
  in_transit: "পথে আছে",
  delivered: "ডেলিভারি হয়েছে",
  returned: "ফেরত এসেছে",
  cancelled: "ফুলফিলমেন্ট বাতিল",
};
const RETURN_STATUS_TITLES: Record<string, string> = {
  approved: "রিটার্ন অনুমোদিত হয়েছে",
  rejected: "রিটার্ন বাতিল হয়েছে",
  return_shipped: "রিটার্ন পাঠানো হয়েছে",
  received: "রিটার্ন পৌঁছেছে",
  completed: "রিটার্ন সম্পন্ন হয়েছে",
};
/** ON6: delivery-attempt outcome titles (rescheduled appends
 * its date when one was recorded). */
const DELIVERY_ATTEMPT_TITLES: Record<string, string> = {
  customer_unavailable: "গ্রাহককে পাওয়া যায়নি",
  refused: "গ্রাহক ফিরিয়ে দিয়েছেন",
  address_issue: "ঠিকানায় সমস্যা",
  other: "ডেলিভারি চেষ্টা",
};
/** ON6: notification event / channel Bengali labels for the
 * timeline's notification entries. */
const NOTIFICATION_EVENT_LABELS: Record<string, string> = {
  order_placed: "অর্ডার গৃহীত",
  order_packed: "প্যাক হয়েছে",
  handed_to_courier: "কুরিয়ারে হস্তান্তর",
  out_for_delivery: "ডেলিভারির পথে",
  delivered: "ডেলিভারি সম্পন্ন",
  delivery_failed: "ডেলিভারি ব্যর্থ",
  parcel_stuck: "পার্সেল আটকে আছে",
  delivery_rescheduled: "ডেলিভারি পুনঃনির্ধারিত",
};
const NOTIFICATION_CHANNEL_LABELS: Record<string, string> = {
  sms: "SMS",
  whatsapp: "WhatsApp/চ্যাট",
  email: "ইমেইল",
  none: "—",
  legacy: "আগের সিস্টেম",
};
const PAYMENT_STATUS_TITLES: Record<string, string> = {
  approved: "পেমেন্ট যাচাই হয়েছে",
  pending: "পেমেন্ট যাচাই অপেক্ষমাণ",
  rejected: "পেমেন্ট যাচাই বাতিল হয়েছে",
};

function toDate(v: any): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
function moneyStr(v: any): string {
  try { return BigInt(v ?? 0).toString(); } catch { return "0"; }
}
/** EC33 sold predicate (mirrors storefront/ec27-discovery.isSoldOrder). */
function isSoldOrder(order: any, shipmentStatuses: string[]): boolean {
  const status = String(order?.status ?? "");
  if (["cancelled", "refunded", "failed"].includes(status)) return false;
  if (status === "completed" || status === "delivered") return true;
  return shipmentStatuses.some((s) => ["delivered", "partial_delivered"].includes(String(s)));
}

@Injectable()
export class OrderInsightsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private async loadOrder(organizationId: string, orderId: string) {
    const order = await (this.prisma as any).order.findFirst({ where: { id: orderId, organizationId } });
    if (!order) throw new NotFoundException("Order not found in this organization");
    return order;
  }

  /** findMany that never throws: a missing/broken delegate = []. */
  private async safeRows(tableName: string, args: any): Promise<any[]> {
    try {
      const table = (this.prisma as any)[tableName];
      if (!table?.findMany) return [];
      return (await table.findMany(args)) ?? [];
    } catch { return []; }
  }

  /** Batch-resolve user ids -> display names. Failure-isolated. */
  private async actorNames(userIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const ids = [...new Set(userIds.filter(Boolean))];
    if (ids.length === 0) return out;
    try {
      const table = (this.prisma as any).user;
      if (!table?.findMany) return out;
      const rows = (await table.findMany({ where: { id: { in: ids } } })) ?? [];
      for (const u of rows) out.set(String(u.id), u.name ?? u.email ?? String(u.id));
    } catch { /* names are decoration; entries ship without them */ }
    return out;
  }

  // ---------- Timeline 360 ----------

  async timeline(organizationId: string, orderId: string) {
    const order = await this.loadOrder(organizationId, orderId);
    const entries: Entry[] = [];
    const push = (at: any, kind: string, title: string, detail: string | null = null, actorId: string | null = null) => {
      const d = toDate(at);
      if (d) entries.push({ at: d, kind, title, detail, actorId });
    };

    // (1) creation
    push(order.placedAt ?? order.createdAt, "created", "অর্ডার তৈরি হয়েছে", order.source ? String(order.source) : null);

    // (2) order audits (note content + manual creation excluded —
    // creation already has its own entry above)
    try {
      const rows = await this.safeRows("auditLog", { where: { organizationId, entityType: "Order", entityId: orderId } });
      for (const r of rows) {
        if (String(r.entityType) !== "Order" || String(r.entityId) !== String(orderId)) continue;
        const action = String(r.action ?? "");
        if (action === "orders.internal_note_updated" || action === "orders.manual_created") continue;
        const meta = (r.metadata ?? {}) as any;
        if (action === "orders.status_changed") {
          push(r.createdAt, "status", `অবস্থা পরিবর্তন: ${meta.from ?? "?"} → ${meta.to ?? "?"}`, null, r.userId ?? null);
        } else if (action === "orders.refund_recorded") {
          push(r.createdAt, "refund", "রিফান্ড রেকর্ড হয়েছে", meta.amountMinor != null ? moneyStr(meta.amountMinor) : null, r.userId ?? null);
        } else if (action === "orders.address_updated") {
          push(r.createdAt, "audit", "ঠিকানা হালনাগাদ হয়েছে", null, r.userId ?? null);
        } else if (action === "orders.tags_updated") {
          push(r.createdAt, "audit", "ট্যাগ হালনাগাদ হয়েছে", null, r.userId ?? null);
        } else if (action === "orders.assigned") {
          push(r.createdAt, "audit", "দায়িত্ব দেওয়া হয়েছে", null, r.userId ?? null);
        } else {
          push(r.createdAt, "audit", action, null, r.userId ?? null);
        }
      }
    } catch { /* isolated source */ }

    // (3) payment verifications (the rows themselves — never audits)
    try {
      const rows = await this.safeRows("paymentVerification", { where: { organizationId, orderId } });
      for (const r of rows) {
        if (String(r.orderId) !== String(orderId)) continue;
        const title = PAYMENT_STATUS_TITLES[String(r.status)] ?? "পেমেন্ট যাচাই অপেক্ষমাণ";
        const parts = [r.amountMinor != null ? moneyStr(r.amountMinor) : null, r.source ?? r.provider ?? null].filter(Boolean);
        push(r.createdAt, "payment", title, parts.length ? parts.join(" · ") : null);
      }
    } catch { /* isolated source */ }

    // (4) fulfillments
    try {
      const rows = await this.safeRows("fulfillment", { where: { organizationId, orderId } });
      for (const f of rows) {
        if (String(f.orderId) !== String(orderId)) continue;
        push(f.createdAt, "fulfillment", "ফুলফিলমেন্ট তৈরি হয়েছে");
        if (f.status && f.status !== "pending") {
          push(f.updatedAt ?? f.createdAt, "fulfillment", FULFILLMENT_STATUS_TITLES[String(f.status)] ?? `ফুলফিলমেন্ট: ${f.status}`);
        }
      }
    } catch { /* isolated source */ }

    // (5) courier shipments
    try {
      const rows = await this.safeRows("courierShipment", { where: { organizationId, orderId } });
      const shipmentIds: string[] = [];
      const providerByShipment = new Map<string, string>();
      for (const s of rows) {
        if (String(s.orderId) !== String(orderId)) continue;
        shipmentIds.push(String(s.id));
        providerByShipment.set(String(s.id), String(s.provider ?? ""));
        const detail = [s.provider, s.trackingCode ?? s.consignmentId].filter(Boolean).join(" · ") || null;
        push(s.createdAt, "shipment", "কুরিয়ার বুক করা হয়েছে", detail);
        if (s.codCollectedMinor !== null && s.codCollectedMinor !== undefined) {
          push(s.codCollectedAt ?? s.updatedAt ?? s.createdAt, "cod_collected", "COD টাকা সংগ্রহ (মিলকরণ)", moneyStr(s.codCollectedMinor));
        }
      }
      // (5b) GB5 (GC14): shipment status events — the GC14 event
      // log's status-kind rows for this order's shipments (the
      // booking event duplicates the "বুক করা হয়েছে" entry
      // above by design of the log, so source=booking rows are
      // skipped here; sync/manual transitions are the news).
      if (shipmentIds.length) {
        try {
          const events = await this.safeRows("courierShipmentEvent", {
            where: { organizationId, shipmentId: { in: shipmentIds }, kind: "status" },
          });
          for (const e of events) {
            if (!shipmentIds.includes(String(e.shipmentId))) continue;
            if (String(e.source) === "booking") continue;
            const origin = e.source === "manual" ? "ম্যানুয়াল হালনাগাদ" : "কুরিয়ার সিঙ্ক";
            const detail = [providerByShipment.get(String(e.shipmentId)), origin].filter(Boolean).join(" · ") || null;
            push(e.createdAt, "shipment_event", `পার্সেল স্ট্যাটাস: ${e.status ?? "—"}`, detail);
          }
        } catch { /* isolated source */ }
      }
    } catch { /* isolated source */ }

    // (6) return requests
    try {
      const rows = await this.safeRows("returnRequest", { where: { organizationId, orderId } });
      for (const r of rows) {
        if (String(r.orderId) !== String(orderId)) continue;
        push(r.createdAt, "return", "রিটার্ন অনুরোধ তৈরি হয়েছে", r.source ? String(r.source) : null);
        if (r.status && r.status !== "requested") {
          push(r.updatedAt ?? r.createdAt, "return", RETURN_STATUS_TITLES[String(r.status)] ?? `রিটার্ন: ${r.status}`);
        }
        if (r.restockAppliedAt) push(r.restockAppliedAt, "return", "পণ্য স্টকে ফেরত নেওয়া হয়েছে");
      }
    } catch { /* isolated source */ }

    // (7) order review
    try {
      const rows = await this.safeRows("orderReview", { where: { organizationId, orderId } });
      for (const r of rows) {
        if (String(r.orderId) !== String(orderId)) continue;
        if (r.requestedAt) push(r.requestedAt, "review", "রিভিউ অনুরোধ পাঠানো হয়েছে");
        if (r.receivedAt) push(r.receivedAt, "review", "গ্রাহক রিভিউ দিয়েছেন", r.rating != null ? `রেটিং: ${r.rating}` : null);
      }
    } catch { /* isolated source */ }

    // (8) installment plan + paid items
    try {
      const plans = await this.safeRows("installmentPlan", { where: { organizationId, orderId } });
      for (const p of plans) {
        if (String(p.orderId) !== String(orderId)) continue;
        push(p.createdAt, "installment", "কিস্তি পরিকল্পনা তৈরি হয়েছে");
        let items: any[] = Array.isArray(p.items) ? p.items : [];
        if (items.length === 0) {
          items = await this.safeRows("installmentItem", { where: { planId: p.id } });
          items = items.filter((i: any) => String(i.planId) === String(p.id));
        }
        for (const item of items) {
          if (item.paidAt) push(item.paidAt, "installment", `কিস্তি #${item.seq} পরিশোধ হয়েছে`, item.amountMinor != null ? moneyStr(item.amountMinor) : null);
        }
      }
    } catch { /* isolated source */ }

    // (9) delivery (rider) assignments
    try {
      const rows = await this.safeRows("deliveryAssignment", { where: { organizationId, orderId } });
      for (const a of rows) {
        if (String(a.orderId) !== String(orderId)) continue;
        if (a.assignedAt) push(a.assignedAt, "delivery", "রাইডারকে দেওয়া হয়েছে");
        if (a.pickedUpAt) push(a.pickedUpAt, "delivery", "রাইডার পণ্য সংগ্রহ করেছেন");
        if (a.deliveredAt) push(a.deliveredAt, "delivery", "রাইডার ডেলিভারি করেছেন");
        if (a.returnedAt) push(a.returnedAt, "delivery", "রাইডার ফেরত এনেছেন");
      }
    } catch { /* isolated source */ }

    // (10) ON6 delivery attempts
    try {
      const rows = await this.safeRows("deliveryAttempt", { where: { organizationId, orderId } });
      for (const r of rows) {
        if (String(r.orderId) !== String(orderId)) continue;
        const outcome = String(r.outcome ?? "");
        const title = outcome === "rescheduled"
          ? (r.rescheduleDate ? `পুনঃনির্ধারিত — ${r.rescheduleDate}` : "পুনঃনির্ধারিত")
          : (DELIVERY_ATTEMPT_TITLES[outcome] ?? "ডেলিভারি চেষ্টা");
        push(r.attemptedAt ?? r.createdAt, "delivery_attempt", title, r.note ?? null, r.recordedById ?? null);
      }
    } catch { /* isolated source */ }

    // (11) ON6 customer-notification log (the ON5 engine's rows)
    try {
      const rows = await this.safeRows("orderNotificationLog", { where: { organizationId, orderId } });
      for (const r of rows) {
        if (String(r.orderId) !== String(orderId)) continue;
        const eventLabel = NOTIFICATION_EVENT_LABELS[String(r.event ?? "")] ?? String(r.event ?? "");
        const channelLabel = NOTIFICATION_CHANNEL_LABELS[String(r.channel ?? "")] ?? String(r.channel ?? "");
        const status = String(r.status ?? "");
        let title: string;
        if (status === "sent") title = `গ্রাহককে জানানো হয়েছে — ${eventLabel} (${channelLabel})`;
        else if (status === "skipped_setting_off") title = `বিজ্ঞপ্তি বন্ধ ছিল — ${eventLabel}`;
        else if (status === "covered_existing") title = `আগের বার্তায় জানানো হয়েছে — ${eventLabel}`;
        else if (status.startsWith("failed") || status.startsWith("skipped")) title = `গ্রাহককে জানানো যায়নি — ${eventLabel} (${channelLabel})`;
        else title = `বিজ্ঞপ্তি — ${eventLabel} (${channelLabel})`;
        push(r.createdAt, "notification", title);
      }
    } catch { /* isolated source */ }

    // (12) ON8 automation firings (OrderAutomationLog rows —
    // title = the rule's name, detail = the per-action outcome
    // summary). Rule names resolve from the org's rule rows;
    // a deleted rule degrades to a generic title, never a
    // fabricated name.
    try {
      const rows = await this.safeRows("orderAutomationLog", { where: { organizationId, orderId } });
      if (rows.length > 0) {
        const ruleRows = await this.safeRows("orderAutomationRule", { where: { organizationId } });
        const nameById = new Map<string, string>();
        for (const r of ruleRows) if (r?.id) nameById.set(String(r.id), String(r.name ?? "অটোমেশন নিয়ম"));
        for (const r of rows) {
          if (String(r.orderId) !== String(orderId)) continue;
          const results = Array.isArray(r.actionsResult) ? r.actionsResult : [];
          const summary = results
            .map((a: any) => `${String(a?.type ?? "?")}${a?.ok ? " ✓" : " ✗"}`)
            .join(" · ") || null;
          push(r.createdAt, "automation", nameById.get(String(r.ruleId)) ?? "অটোমেশন নিয়ম", summary);
        }
      }
    } catch { /* isolated source */ }

    // (13) GB3 (GC9) fraud-rule hits for this order — title
    // carries the rule's name (a deleted rule degrades to a
    // generic title), detail is the action's Bengali label.
    try {
      const rows = await this.safeRows("fraudRuleHit", { where: { organizationId, orderId } });
      if (rows.length > 0) {
        const ruleRows = await this.safeRows("fraudRule", { where: { organizationId } });
        const nameById = new Map<string, string>();
        for (const r of ruleRows) if (r?.id) nameById.set(String(r.id), String(r.name ?? ""));
        const ACTION_LABELS: Record<string, string> = {
          hold: "অর্ডার আটকানো হয়েছে",
          tag: "ট্যাগ যোগ হয়েছে",
          block_checkout: "চেকআউট আটকানো হয়েছিল",
        };
        for (const r of rows) {
          if (String(r.orderId) !== String(orderId)) continue;
          const name = nameById.get(String(r.ruleId));
          push(
            r.createdAt, "fraud_rule",
            `জালিয়াতি নিয়ম: ${name ?? "নিয়ম"}`,
            ACTION_LABELS[String(r.action ?? "")] ?? null,
          );
        }
      }
    } catch { /* isolated source */ }

    entries.sort((a, b) => b.at.getTime() - a.at.getTime());
    const truncated = entries.length > 200;
    const capped = entries.slice(0, 200);
    const names = await this.actorNames(capped.map((e) => e.actorId).filter(Boolean) as string[]);
    return {
      entries: capped.map((e) => ({
        at: e.at.toISOString(),
        kind: e.kind,
        title: e.title,
        detail: e.detail,
        actor: e.actorId ? (names.get(e.actorId) ?? null) : null,
        actorId: e.actorId,
      })),
      truncated,
    };
  }

  // ---------- Customer 360 ----------

  async customer360(organizationId: string, orderId: string) {
    const order = await this.loadOrder(organizationId, orderId);
    const empty = {
      customer: null as any, orderCount: 0, deliveredCount: 0, cancelledCount: 0, returnedCount: 0,
      lifetimeValueMinor: "0", reliabilityPercent: null as number | null, openDueMinor: "0", openReturns: 0, lastOrders: [] as any[],
    };
    if (!order.customerId) return empty;

    let customer: any = null;
    try {
      customer = await (this.prisma as any).customer?.findFirst({ where: { id: order.customerId, organizationId } });
    } catch { customer = null; }
    if (!customer) return empty;

    const allOrders = (await this.safeRows("order", { where: { organizationId, customerId: order.customerId } }))
      .filter((o: any) => String(o.customerId) === String(order.customerId));
    const orderCount = allOrders.length;
    const cancelledCount = allOrders.filter((o: any) => o.status === "cancelled").length;
    const returnedCount = allOrders.filter((o: any) => o.status === "returned").length;

    // Sold math needs shipment statuses per order (one bulk fetch).
    const ids = allOrders.map((o: any) => String(o.id));
    const shipments = await this.safeRows("courierShipment", { where: { organizationId, orderId: { in: ids } } });
    const statusesByOrder = new Map<string, string[]>();
    for (const s of shipments) {
      const list = statusesByOrder.get(String(s.orderId)) ?? [];
      list.push(String(s.status));
      statusesByOrder.set(String(s.orderId), list);
    }
    const sold = allOrders.filter((o: any) => isSoldOrder(o, statusesByOrder.get(String(o.id)) ?? []));
    const deliveredCount = sold.length;
    let ltv = 0n;
    for (const o of sold) { try { ltv += BigInt(o.totalMinor ?? 0); } catch { /* skip */ } }

    const denom = deliveredCount + cancelledCount + returnedCount;
    const reliabilityPercent = denom === 0 ? null : Math.round((deliveredCount / denom) * 1000) / 10;

    // Open due: ONE groupBy over the customer's non-dead orders.
    const dueCandidates = allOrders.filter((o: any) => !["cancelled", "failed", "refunded"].includes(String(o.status)));
    const paidByOrder = new Map<string, bigint>();
    try {
      const table = (this.prisma as any).paymentVerification;
      if (table?.groupBy && dueCandidates.length > 0) {
        const rows = await table.groupBy({
          by: ["orderId"],
          where: { organizationId, status: "approved", orderId: { in: dueCandidates.map((o: any) => String(o.id)) } },
          _sum: { amountMinor: true },
        });
        for (const r of rows ?? []) {
          if (r?.orderId == null) continue;
          try { paidByOrder.set(String(r.orderId), BigInt(r._sum?.amountMinor ?? 0)); } catch { /* 0 */ }
        }
      } else if (table?.findMany) {
        const rows = (await table.findMany({ where: { organizationId, status: "approved" } }).catch(() => [])) ?? [];
        for (const r of rows) {
          if (r?.orderId == null) continue;
          try { paidByOrder.set(String(r.orderId), (paidByOrder.get(String(r.orderId)) ?? 0n) + BigInt(r.amountMinor ?? 0)); } catch { /* 0 */ }
        }
      }
    } catch { /* due degrades to full totals */ }
    let openDue = 0n;
    for (const o of dueCandidates) {
      const total = (() => { try { return BigInt(o.totalMinor ?? 0); } catch { return 0n; } })();
      const paid = paidByOrder.get(String(o.id)) ?? 0n;
      if (total > paid) openDue += total - paid;
    }

    const returns = await this.safeRows("returnRequest", { where: { organizationId, customerId: order.customerId } });
    const openReturns = returns.filter((r: any) =>
      String(r.customerId) === String(order.customerId) && OPEN_RETURN_STATUSES.includes(String(r.status))).length;

    const lastOrders = [...allOrders]
      .sort((a: any, b: any) => new Date(b.placedAt ?? b.createdAt ?? 0).getTime() - new Date(a.placedAt ?? a.createdAt ?? 0).getTime())
      .slice(0, 10)
      .map((o: any) => ({
        id: o.id, externalNumber: o.externalNumber ?? null, status: o.status,
        totalMinor: moneyStr(o.totalMinor), placedAt: o.placedAt ?? null,
      }));

    const name = [customer.firstName, customer.lastName].filter(Boolean).join(" ") || null;
    return {
      customer: { id: customer.id, name, phone: customer.phone ?? null, email: customer.email ?? null },
      orderCount, deliveredCount, cancelledCount, returnedCount,
      lifetimeValueMinor: ltv.toString(),
      reliabilityPercent,
      openDueMinor: openDue.toString(),
      openReturns,
      lastOrders,
    };
  }

  // ---------- Internal comments ----------

  async listComments(organizationId: string, orderId: string) {
    await this.loadOrder(organizationId, orderId);
    const rows = (await this.safeRows("orderComment", { where: { organizationId, orderId } }))
      .filter((r: any) => String(r.orderId) === String(orderId))
      .sort((a: any, b: any) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime());
    const names = await this.actorNames(rows.map((r: any) => r.authorId));
    return rows.map((r: any) => ({
      id: r.id, orderId: r.orderId, authorId: r.authorId,
      authorName: names.get(String(r.authorId)) ?? null,
      body: r.body, createdAt: r.createdAt, updatedAt: r.updatedAt ?? null,
    }));
  }

  async createComment(organizationId: string, actorId: string, orderId: string, bodyRaw: unknown) {
    await this.loadOrder(organizationId, orderId);
    const body = String(bodyRaw ?? "").trim();
    if (body.length < 1 || body.length > 2000) {
      throw new BadRequestException("মন্তব্য ১–২০০০ অক্ষরের হতে হবে");
    }
    const table = (this.prisma as any).orderComment;
    if (!table?.create) throw new BadRequestException("মন্তব্য সুবিধাটি এই ডিপ্লয়মেন্টে নেই");
    const row = await table.create({ data: { organizationId, orderId, authorId: actorId, body } });
    await this.audit?.log({
      organizationId, userId: actorId, action: "orders.comment_created",
      entityType: "Order", entityId: orderId, metadata: { orderId },
    }).catch(() => undefined);
    const names = await this.actorNames([actorId]);
    return {
      id: row.id, orderId: row.orderId ?? orderId, authorId: row.authorId ?? actorId,
      authorName: names.get(String(actorId)) ?? null,
      body: row.body ?? body, createdAt: row.createdAt, updatedAt: row.updatedAt ?? null,
    };
  }

  async deleteComment(organizationId: string, actorId: string, orderId: string, commentId: string) {
    await this.loadOrder(organizationId, orderId);
    const table = (this.prisma as any).orderComment;
    const row = table?.findFirst
      ? await table.findFirst({ where: { id: commentId, organizationId, orderId } }).catch(() => null)
      : null;
    if (!row) throw new NotFoundException("Comment not found");
    if (String(row.authorId) !== String(actorId)) {
      // Not the author: only OWNER / ADMIN members may delete.
      let role: string | null = null;
      try {
        const member = await (this.prisma as any).membership?.findFirst({
          where: { userId: actorId, organizationId, status: "ACTIVE" },
        });
        role = member?.role ?? null;
      } catch { role = null; }
      if (role !== "OWNER" && role !== "ADMIN") {
        throw new ForbiddenException("শুধু মন্তব্যের লেখক অথবা অ্যাডমিন এই মন্তব্য মুছতে পারবেন");
      }
    }
    await table.delete({ where: { id: row.id } });
    await this.audit?.log({
      organizationId, userId: actorId, action: "orders.comment_deleted",
      entityType: "Order", entityId: orderId, metadata: { orderId },
    }).catch(() => undefined);
    return { deleted: true, id: commentId };
  }
}
