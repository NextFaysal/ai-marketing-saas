import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EventsService } from "../common/events.service";
import { SmsProvider, normalizeBdPhone as normalizeSmsPhone } from "../messaging/sms.provider";
import { EmailProvider } from "../messaging/email.provider";
import { newTrackingToken, webBaseUrl } from "../courier/tracking-token";

/** The one inbox capability the sweep needs — typed structurally
 * so this service never imports InboxService (InboxModule imports
 * OrdersModule; a reverse import would cycle). AutomationService
 * passes its InboxService, which satisfies this shape. */
export interface ReviewChatSender {
  sendAutomatedMessage(organizationId: string, conversationId: string, content: string, sourceTag: string): Promise<any>;
}

/** A rating reply counts only within 7 days of the ask. */
export const REVIEW_WINDOW_MS = 7 * 24 * 3600 * 1000;
/** A free-text comment counts only within 24h AFTER the rating —
 * short on purpose: the customer was just asked for feedback, and
 * a later message is a new enquiry, not a review comment. */
export const REVIEW_COMMENT_WINDOW_MS = 24 * 3600 * 1000;

const BN_RATING: Record<string, number> = { "১": 1, "২": 2, "৩": 3, "৪": 4, "৫": 5 };

/**
 * The TINY, honest rating parser: a reply that is EXACTLY one
 * digit — Latin 1-5 or Bengali ১-৫ — and nothing else. "5 star",
 * "৫/৫", "ভালো 5" are NOT ratings; they flow on as normal
 * messages. Same discipline as the CSAT capture (M-series).
 */
export function parseReviewRating(text: string): number | null {
  const t = String(text ?? "").trim();
  if (/^[1-5]$/.test(t)) return Number(t);
  if (t.length === 1 && BN_RATING[t] !== undefined) return BN_RATING[t];
  return null;
}

export function reviewLinkFor(token: string): string {
  return `${webBaseUrl()}/review/${token}`;
}

/**
 * CX12b — automatic post-delivery review requests.
 *
 * Trigger: BOTH delivery paths are hooked without touching the
 * producers — the service subscribes (ConversionsService pattern)
 * to `order.delivered` (order-status path: manual PATCH + every
 * store/chat upsert) and to `shipment.status_changed` with
 * shipmentStatus "delivered" (courier-sync path; a shipment
 * delivery does not change the order's status). The OrderReview
 * orderId UNIQUE constraint is the guard: double events create
 * exactly one row.
 *
 * Honesty rules:
 * - Opt-in: rows are created ONLY when the org enabled
 *   reviewRequestEnabled (InboxSetting, default OFF — this
 *   messages customers).
 * - A row is born `pending_send` and is marked `requested` ONLY
 *   after a confirmed send. Channel-less orders stay pending_send
 *   forever (visible as such in the org's review list) — never
 *   silently marked sent, never dropped.
 * - Sends follow the CX6 channel precedence: conversation ->
 *   SMS -> email; unconfigured SMS/SMTP is skipped silently.
 */
@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly events?: EventsService,
    @Optional() private readonly sms?: SmsProvider,
    @Optional() private readonly email?: EmailProvider,
    @Optional() private readonly audit?: AuditService,
  ) {
    if (this.events) {
      this.events.on("order.delivered", (p) => { void this.noteDelivered(p?.organizationId, p?.context?.orderId); });
      this.events.on("shipment.status_changed", (p) => {
        if (p?.context?.shipmentStatus === "delivered") void this.noteDelivered(p?.organizationId, p?.context?.orderId);
      });
    }
  }

  private p(): any { return this.prisma as any; }

  async reviewSettings(organizationId: string): Promise<{ enabled: boolean; delayHours: number }> {
    // Defensive (codebase ?.delegate pattern): a partial fake or a
    // stale generated client without the delegate reads as
    // DISABLED — never a throw inside an event handler.
    try {
      const row = await this.p().inboxSetting?.findUnique({ where: { organizationId } }).catch(() => null);
      const delay = Number(row?.reviewRequestDelayHours ?? 24);
      return {
        enabled: row?.reviewRequestEnabled === true,
        delayHours: Number.isInteger(delay) ? Math.min(168, Math.max(0, delay)) : 24,
      };
    } catch { return { enabled: false, delayHours: 24 }; }
  }

  /**
   * Delivery hook (both event paths). Creates the pending_send
   * row when the org opted in. Failure-isolated by the event bus;
   * a duplicate delivery event hits the unique guard and is a
   * no-op. The order is re-read org-scoped: a mismatched event
   * can never create a cross-tenant row.
   */
  async noteDelivered(organizationId?: string, orderId?: string): Promise<void> {
    if (!organizationId || !orderId) return;
    // Event-handler discipline: this must NEVER throw (the bus
    // fires it with `void` — a rejection would be unhandled).
    try {
      const settings = await this.reviewSettings(organizationId);
      if (!settings.enabled) return;
      const order = await this.p().order.findFirst({ where: { id: orderId, organizationId }, select: { id: true, customerId: true, conversationId: true, isPractice: true } }).catch(() => null);
      if (!order) return;
      // CX12a: practice orders never get a review ask — there is
      // no real customer on the other end.
      if ((order as any).isPractice) return;
      try {
        await this.p().orderReview.create({
          data: {
            organizationId, orderId, customerId: order.customerId ?? null,
            conversationId: order.conversationId ?? null,
            status: "pending_send", reviewToken: newTrackingToken(), deliveredAt: new Date(),
          },
        });
      } catch { /* unique guard: a second delivery event for this order is a no-op */ }
    } catch { /* a review-row problem never affects order processing */ }
  }

  /**
   * The review_request_sweep job body. Sends every due
   * pending_send ask (deliveredAt + the org's delay <= now),
   * newest-due last, bounded at 100 per run. Per-row failures are
   * isolated and counted; a row that reaches no channel stays
   * pending_send and is retried by the next run.
   */
  async runReviewSweep(organizationId: string, sender?: ReviewChatSender) {
    const settings = await this.reviewSettings(organizationId);
    if (!settings.enabled) return { skipped: "review_requests_disabled", checked: 0, sent: 0, stillPending: 0, failed: 0 };
    const dueBefore = new Date(Date.now() - settings.delayHours * 3600 * 1000);
    const rows = await (this.p().orderReview?.findMany({
      where: { organizationId, status: "pending_send", deliveredAt: { lte: dueBefore } },
      orderBy: { deliveredAt: "asc" }, take: 100,
    }).catch(() => []) ?? []);
    let sent = 0; let stillPending = 0; let failed = 0;
    for (const row of rows) {
      try {
        const ok = await this.sendAsk(organizationId, row, sender);
        if (ok) sent++; else stillPending++;
      } catch (e) {
        failed++;
        this.logger.warn(`review ask failed for order ${row.orderId}: ${e instanceof Error ? e.message : "unknown"}`);
      }
    }
    return { checked: rows.length, sent, stillPending, failed };
  }

  /** One ask on the best channel (CX6 precedence). Returns true
   * only when a send was CONFIRMED and the row stamped requested. */
  private async sendAsk(organizationId: string, row: any, sender?: ReviewChatSender): Promise<boolean> {
    const order = await this.p().order.findFirst({
      where: { id: row.orderId, organizationId },
      include: { customer: { select: { phone: true, email: true } } },
    }).catch(() => null);
    if (!order) return false;
    // CX12a defense-in-depth (noteDelivered is the creation gate):
    // a pending ask for a practice order is never sent on any
    // channel; the row is closed out as "skipped_practice" so the
    // sweep does not retry it forever.
    if ((order as any).isPractice) {
      await this.p().orderReview.update({ where: { id: row.id }, data: { status: "skipped_practice" } }).catch(() => undefined);
      return false;
    }
    const link = reviewLinkFor(row.reviewToken);
    const stamp = async (source: string, conversationId?: string | null) => {
      await this.p().orderReview.update({
        where: { id: row.id },
        data: { status: "requested", source, requestedAt: new Date(), ...(conversationId ? { conversationId } : {}) },
      });
    };
    // 1) conversation first
    const conversationId = order.conversationId ?? row.conversationId ?? null;
    if (sender && conversationId) {
      const text = `আসসালামু আলাইকুম! আপনার অর্ডারটি ডেলিভারি হয়েছে 📦\nকেনাকাটার অভিজ্ঞতা কেমন ছিল? শুধু ১–৫ এর মধ্যে একটি সংখ্যা পাঠালেই আপনার রেটিং রেকর্ড হয়ে যাবে (৫ = সবচেয়ে ভালো)।\nচাইলে এই লিংকেও রেটিং ও মতামত দিতে পারেন: ${link}`;
      await sender.sendAutomatedMessage(organizationId, conversationId, text, "review_request");
      await stamp("chat", conversationId);
      return true;
    }
    // 2) SMS with the review link
    const phone = normalizeSmsPhone(order.customer?.phone ?? "");
    if (phone && this.sms) {
      if (this.sms.isConfigured()) {
        const text = `আপনার অর্ডারটি ডেলিভারি হয়েছে 📦 কেনাকাটার অভিজ্ঞতার রিভিউ দিন (১–৫ ★): ${link}`;
        await this.sms.send({ to: phone, text, reference: `review:${row.id}` });
        await stamp("link");
        return true;
      }
      this.logger.log(`review ask for order ${row.orderId} skipped: SMS is not configured`);
    }
    // 3) email with the review link
    const emailTo = order.customer?.email ?? null;
    if (emailTo && this.email) {
      if (this.email.isConfigured()) {
        await this.email.send({
          to: emailTo, subject: "আপনার কেনাকাটার অভিজ্ঞতার রিভিউ দিন ⭐",
          text: `আসসালামু আলাইকুম! আপনার অর্ডারটি ডেলিভারি হয়েছে।\nকেনাকাটার অভিজ্ঞতা কেমন ছিল? এই লিংকে ১–৫ রেটিং ও মতামত দিন: ${link}`,
        });
        await stamp("link");
        return true;
      }
      this.logger.log(`review ask for order ${row.orderId} skipped: SMTP is not configured`);
    }
    return false;
  }

  /**
   * Chat capture, called from the inbox ingest chain with CSAT's
   * consume semantics: returns true when the message WAS a review
   * reply (so the bot/autopilot skip it).
   * - A standalone ১-৫/1-5 reply within 7 days of the ask, while
   *   no rating exists yet -> the rating (status received).
   * - One free-text reply within 24h AFTER the rating -> stored
   *   as the comment. Anything else -> false (a normal message).
   */
  async tryCaptureReply(organizationId: string, conversation: any, text: string): Promise<boolean> {
    const t = String(text ?? "").trim();
    if (!t || !conversation?.id) return false;
    const row = await (this.p().orderReview?.findFirst({
      where: { organizationId, conversationId: conversation.id, status: { in: ["requested", "received"] } },
      orderBy: { requestedAt: "desc" },
    }).catch(() => null) ?? null);
    if (!row || !row.requestedAt) return false;
    if (Date.now() - new Date(row.requestedAt).getTime() > REVIEW_WINDOW_MS) return false;
    if (row.rating == null) {
      const rating = parseReviewRating(t);
      if (!rating) return false;
      await this.p().orderReview.update({ where: { id: row.id }, data: { rating, status: "received", source: "chat", receivedAt: new Date() } });
      await this.audit?.log({ organizationId, userId: "system", action: "review.received", entityType: "OrderReview", entityId: row.id, metadata: { orderId: row.orderId, rating, via: "chat" } }).catch(() => undefined);
      // SU5: a received rating may become a social DRAFT
      // (milestone / 5-star) when the org enabled the trigger.
      this.events?.emit?.("social_draft.review_received", { organizationId, reviewId: row.id, orderId: row.orderId, rating });
      return true;
    }
    if (row.comment == null && row.receivedAt && Date.now() - new Date(row.receivedAt).getTime() <= REVIEW_COMMENT_WINDOW_MS) {
      if (parseReviewRating(t)) return false; // a second digit is not a comment
      await this.p().orderReview.update({ where: { id: row.id }, data: { comment: t.slice(0, 1000) } });
      return true;
    }
    return false;
  }

  /** Tenant review list (orders page + customer 360), newest
   * first, optional rating / customer filters. */
  async listReviews(organizationId: string, filters?: { rating?: number; customerId?: string }) {
    const where: any = { organizationId };
    if (filters?.rating) where.rating = filters.rating;
    if (filters?.customerId) where.customerId = filters.customerId;
    const rows = await (this.p().orderReview?.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 }).catch(() => []) ?? []);
    if (!rows.length) return [];
    const orderIds = [...new Set(rows.map((r: any) => r.orderId))];
    const orders = await this.p().order.findMany({ where: { organizationId, id: { in: orderIds } }, select: { id: true, externalNumber: true, customerId: true } }).catch(() => []);
    const orderById = new Map<string, any>(orders.map((o: any) => [o.id, o] as [string, any]));
    const customerIds = [...new Set(rows.map((r: any) => r.customerId ?? orderById.get(r.orderId)?.customerId).filter(Boolean))];
    const customers = customerIds.length ? await this.p().customer.findMany({ where: { organizationId, id: { in: customerIds } }, select: { id: true, firstName: true, lastName: true } }).catch(() => []) : [];
    const customerById = new Map<string, string | null>(customers.map((c: any) => [c.id, [c.firstName, c.lastName].filter(Boolean).join(" ") || null] as [string, string | null]));
    return rows.map((r: any) => ({
      ...r,
      orderNumber: orderById.get(r.orderId)?.externalNumber ?? null,
      customerName: customerById.get(r.customerId ?? orderById.get(r.orderId)?.customerId) ?? null,
    }));
  }

  /** Public review page data (token = credential). Stored facts
   * only; an already-received review renders read-only. */
  async publicReview(token: string) {
    const row = await this.p().orderReview?.findFirst({ where: { reviewToken: token } });
    if (!row) throw new NotFoundException("এই রিভিউ লিংকটি পাওয়া যায়নি");
    const org = await this.p().organization.findFirst({ where: { id: row.organizationId } }).catch(() => null);
    const order = await this.p().order.findFirst({ where: { id: row.orderId, organizationId: row.organizationId }, select: { externalNumber: true } }).catch(() => null);
    const rewardCoupon = {
      code: "REVIEW10",
      discount: "১০% ছাড়",
      desc: "আপনার পরবর্তী অর্ডারে ১০% বিশেষ ছাড় উপভোগ করুন!",
    };
    return {
      status: row.status,
      rating: row.rating ?? null,
      comment: row.comment ?? null,
      receivedAt: row.receivedAt ?? null,
      orderNumber: order?.externalNumber ?? null,
      business: org?.name ?? "Store",
      branding: {
        name: org?.brandName ?? org?.name ?? "Store",
        logoUrl: org?.logoUrl ?? null,
        primaryColor: org?.primaryColor ?? null,
      },
      rewardCoupon,
    };
  }

  /** Public review submit: one rating per link — a second submit
   * is refused honestly instead of overwriting the first. */
  async submitPublicReview(token: string, dto: { rating?: number; comment?: string }) {
    const row = await this.p().orderReview?.findFirst({ where: { reviewToken: token } });
    if (!row) throw new NotFoundException("এই রিভিউ লিংকটি পাওয়া যায়নি");
    const rating = Number(dto?.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new BadRequestException("রেটিং ১ থেকে ৫ এর মধ্যে হতে হবে");
    if (row.rating != null) throw new BadRequestException("এই অর্ডারের রিভিউ ইতিমধ্যে দেওয়া হয়েছে — ধন্যবাদ!");
    const comment = String(dto?.comment ?? "").trim().slice(0, 1000) || null;
    const updated = await this.p().orderReview.update({
      where: { id: row.id },
      data: { rating, comment, status: "received", source: "link", receivedAt: new Date() },
    });
    await this.audit?.log({ organizationId: row.organizationId, userId: "system", action: "review.received", entityType: "OrderReview", entityId: row.id, metadata: { orderId: row.orderId, rating, via: "link" } }).catch(() => undefined);
    // SU5: same producer hook as the chat path.
    this.events?.emit?.("social_draft.review_received", { organizationId: row.organizationId, reviewId: row.id, orderId: row.orderId, rating });
    const rewardCoupon = {
      code: "REVIEW10",
      discount: "১০% ছাড়",
      desc: "আপনার পরবর্তী অর্ডারে ১০% বিশেষ ছাড় উপভোগ করুন!",
    };
    return { ok: true, rating: updated.rating, status: updated.status, rewardCoupon };
  }
}
