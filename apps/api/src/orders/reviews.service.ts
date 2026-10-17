import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EventsService } from "../common/events.service";
import { SmsProvider, normalizeBdPhone as normalizeSmsPhone } from "../messaging/sms.provider";
import { EmailProvider } from "../messaging/email.provider";
import { newTrackingToken, webBaseUrl } from "../courier/tracking-token";
import { StorageService } from "../storage/storage.service";
import { StorageRegistryService } from "../storage/storage-registry.service";
import { imageExtForContentType } from "../storage/media-url";
import { detectMediaKind } from "../inbox/media-sniff";
import {
  CREATIVE_IMAGE_UPLOAD_MAX_BYTES,
  CREATIVE_UPLOAD_CONTENT_TYPES,
  CREATIVE_VIDEO_UPLOAD_MAX_BYTES,
} from "../creatives/creatives.service";

/** NF8: at most this many photo/video attachments per review. */
export const REVIEW_MEDIA_MAX_ITEMS = 4;

export interface ReviewMediaItem {
  key: string;
  kind: string;
  contentType: string;
  sizeBytes: number;
}

/** The stored media shape on an OrderReview row (Json column):
 * private-bucket KEYS only — never URLs (see schema note). */
export function reviewMediaOf(row: any): ReviewMediaItem[] {
  const v = row?.media;
  if (!Array.isArray(v)) return [];
  return v.filter(
    (m: any) =>
      m && typeof m.key === "string" && typeof m.kind === "string" &&
      typeof m.contentType === "string" && Number.isFinite(Number(m.sizeBytes)),
  ).map((m: any) => ({ key: m.key, kind: m.kind, contentType: m.contentType, sizeBytes: Number(m.sizeBytes) }));
}

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
    // NF8: the EXISTING storage machinery for review media
    // (RB3 quarantine pattern). Optional + last so positional
    // spec constructions keep working; absent (or local storage
    // mode) the media endpoints refuse honestly, exactly like
    // the creative / media-library surfaces do.
    @Optional() private readonly storage?: StorageService,
    @Optional() private readonly storageRegistry?: StorageRegistryService,
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
      // NF8: media COUNT only — the token page learns its own
      // attachments exist; keys/URLs are never served here (the
      // review is not public yet, and may never be).
      mediaCount: reviewMediaOf(row).length,
      // NF8: the Google offer (see googleReviewOffer) — non-null
      // only for an already-submitted 4–5 star review when the
      // org configured its link. The thank-you screen renders it
      // as a plain link the customer may choose to open.
      googleReviewOffer: await this.googleReviewOffer(row.organizationId, row.rating ?? null),
    };
  }

  /**
   * NF8 — the happy-customer Google route. An OFFER, never a
   * redirect and never a reward: it exists only when BOTH the
   * customer's own already-submitted rating is 4–5 AND the org
   * pasted its own Google review link in Settings
   * (Organization.googleReviewUrl). Every other combination —
   * rating < 4, no rating yet, link unconfigured — offers
   * nothing (null). Nothing about the offer is conditioned on
   * the customer actually reviewing on Google, and NF8 attaches
   * no incentive to any rating anywhere.
   */
  async googleReviewOffer(organizationId: string, rating: number | null | undefined): Promise<{ url: string } | null> {
    if (!rating || !Number.isInteger(rating) || rating < 4) return null;
    const org = await this.p().organization?.findFirst({
      where: { id: organizationId }, select: { googleReviewUrl: true },
    }).catch(() => null);
    const url = typeof org?.googleReviewUrl === "string" ? org.googleReviewUrl.trim() : "";
    return url ? { url } : null;
  }

  // ---------- NF8: review photo/video upload ----------
  //
  // The EXISTING upload machinery, no new path: the RB3 pattern
  // every media surface uses — presign a quarantine PUT through
  // StorageService -> the browser PUTs straight to R2 ->
  // complete verifies (HEAD size + magic-byte sniff via
  // detectMediaKind) -> copy to the final key -> register in the
  // StoredFile registry. The type/size GUARDS are the creative
  // upload guards, imported from CreativesService (image
  // png/jpeg/webp ≤10MB, video mp4/mov/webm ≤50MB) — enforced
  // identically at presign AND complete, never relaxed.
  //
  // Differences from the staff surfaces, by design:
  // - the credential is the reviewToken (same as the review page
  //   itself), and the quarantine prefix binds the upload to the
  //   token's OWN org;
  // - the final object lands in the PRIVATE bucket and only its
  //   KEY is stored on the review row — a review and its media
  //   are never public before EC15's visibility rules say so;
  //   public/staff reads mint short-lived signed URLs at read
  //   time (ProductReviewsService).

  private reviewStorageOr400(): StorageService {
    if (!this.storage || this.storage.mode !== "s3") {
      throw new BadRequestException(
        "সরাসরি ফাইল আপলোড এখন চালু নেই — সার্ভারে object storage (Cloudflare R2) সেটআপ হয়নি।",
      );
    }
    return this.storage;
  }

  /** The creative-upload guard, shared verbatim: kind allow-list,
   * declared content type inside the kind's list, per-kind cap. */
  private normalizeReviewUpload(kind: unknown, contentType: unknown, sizeBytes: unknown) {
    const k = String(kind ?? "");
    const allowed = CREATIVE_UPLOAD_CONTENT_TYPES[k];
    if (!allowed) throw new BadRequestException("kind must be image or video");
    const ct = String(contentType ?? "").split(";")[0].trim().toLowerCase();
    if (!allowed.includes(ct)) {
      throw new BadRequestException(
        k === "image"
          ? "শুধু PNG, JPEG অথবা WebP ছবি আপলোড করা যাবে।"
          : "শুধু MP4, MOV অথবা WebM ভিডিও আপলোড করা যাবে।",
      );
    }
    const size = Number(sizeBytes);
    if (!Number.isInteger(size) || size < 1) {
      throw new BadRequestException("ফাইলের আকার (sizeBytes) সঠিক নয়।");
    }
    const cap = k === "image" ? CREATIVE_IMAGE_UPLOAD_MAX_BYTES : CREATIVE_VIDEO_UPLOAD_MAX_BYTES;
    if (size > cap) {
      throw new BadRequestException(
        k === "image"
          ? "ছবিটি অনেক বড় — সর্বোচ্চ ১০ MB পর্যন্ত আপলোড করা যাবে।"
          : "ভিডিওটি অনেক বড় — সরাসরি আপলোডে সর্বোচ্চ ৫০ MB পর্যন্ত আপলোড করা যাবে।",
      );
    }
    return { kind: k, contentType: ct, sizeBytes: size };
  }

  private async reviewRowByToken(token: string) {
    const row = await this.p().orderReview?.findFirst({ where: { reviewToken: token } });
    if (!row) throw new NotFoundException("এই রিভিউ লিংকটি পাওয়া যায়নি");
    return row;
  }

  /** Media attaches only BEFORE the review is submitted: once a
   * rating exists the record is what staff moderate, and the
   * token holder cannot silently change it afterwards. */
  private assertMediaAttachable(row: any) {
    if (row.rating != null) {
      throw new BadRequestException("রিভিউ ইতিমধ্যে জমা হয়ে গেছে — এখন আর ছবি/ভিডিও যোগ করা যাবে না।");
    }
    if (reviewMediaOf(row).length >= REVIEW_MEDIA_MAX_ITEMS) {
      throw new BadRequestException(`সর্বোচ্চ ${REVIEW_MEDIA_MAX_ITEMS}টি ছবি/ভিডিও যোগ করা যাবে।`);
    }
  }

  async presignReviewMedia(token: string, dto: { kind?: string; contentType?: string; sizeBytes?: number }) {
    const row = await this.reviewRowByToken(token);
    this.assertMediaAttachable(row);
    const { contentType, sizeBytes } = this.normalizeReviewUpload(dto?.kind, dto?.contentType, dto?.sizeBytes);
    const storage = this.reviewStorageOr400();
    const key = `_quarantine/${row.organizationId}/review/${randomUUID()}`;
    const uploadUrl = storage.presignedPutUrl("private", key);
    if (!uploadUrl) {
      throw new BadRequestException("আপলোডের URL তৈরি করা যায়নি — object storage সেটআপ যাচাই করুন।");
    }
    return { uploadUrl, key, contentType, sizeBytes, expiresInSeconds: 600 };
  }

  async completeReviewMedia(token: string, dto: { key?: string; kind?: string; contentType?: string; sizeBytes?: number }) {
    const row = await this.reviewRowByToken(token);
    this.assertMediaAttachable(row);
    const { kind, contentType, sizeBytes } = this.normalizeReviewUpload(dto?.kind, dto?.contentType, dto?.sizeBytes);
    const storage = this.reviewStorageOr400();
    const key = String(dto?.key ?? "");
    const quarantinePrefix = `_quarantine/${row.organizationId}/review/`;
    if (!key.startsWith(quarantinePrefix) || key.includes("..") || key.includes("\\")) {
      throw new BadRequestException("আপলোডের key সঠিক নয় — presign থেকে পাওয়া key-ই পাঠাতে হবে।");
    }
    const dropQuarantine = () => storage.delete("private", key).catch(() => undefined);

    const head = await storage.head("private", key).catch(() => null);
    if (!head) {
      throw new BadRequestException("আপলোড করা ফাইলটি পাওয়া যায়নি — আবার আপলোড করুন।");
    }
    if (head.sizeBytes !== sizeBytes) {
      await dropQuarantine();
      throw new BadRequestException("আপলোড করা ফাইলের আকার ঘোষিত আকারের সঙ্গে মিলছে না — ফাইলটি মোছা হয়েছে।");
    }
    const bytes = await storage.get("private", key).catch(() => null);
    if (!bytes || bytes.length !== sizeBytes) {
      await dropQuarantine();
      throw new BadRequestException("আপলোড করা ফাইলটি পড়া যায়নি — ফাইলটি মোছা হয়েছে, আবার চেষ্টা করুন।");
    }
    // Magic bytes decide, never the declaration — the same sniff
    // discipline as the creative / library completes.
    const detected = detectMediaKind(bytes, contentType);
    if (!detected || detected.kind !== kind || detected.contentType !== contentType) {
      await dropQuarantine();
      const what = detected ? detected.contentType : "অচেনা ফরম্যাটের ডেটা";
      throw new BadRequestException(`আপলোড করা ফাইলের আসল ফরম্যাট ঘোষিত টাইপের সঙ্গে মিলছে না (পাওয়া গেছে ${what}) — ফাইলটি মোছা হয়েছে।`);
    }

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const ext = kind === "video"
      ? (contentType === "video/quicktime" ? "mov" : contentType === "video/webm" ? "webm" : "mp4")
      : imageExtForContentType(detected.contentType);
    const finalKey = `${row.organizationId}/review/${randomUUID()}.${ext}`;
    try {
      await storage.copy({ visibility: "private", key }, { visibility: "private", key: finalKey });
      // Re-read before appending: the cap is judged on the
      // CURRENT row, so a burst of completes cannot exceed it.
      const fresh = await this.reviewRowByToken(token);
      this.assertMediaAttachable(fresh);
      const media = [...reviewMediaOf(fresh), { key: finalKey, kind, contentType: detected.contentType, sizeBytes: bytes.length }];
      const updated = await this.p().orderReview.update({ where: { id: fresh.id }, data: { media } });
      // Registry AFTER the row points at the object (the creative
      // discipline): a registry failure must not orphan the row's
      // media — best-effort bookkeeping only.
      if (this.storageRegistry) {
        await this.storageRegistry.register({
          organizationId: row.organizationId,
          bucket: storage.bucketFor("private"),
          key: finalKey,
          visibility: "private",
          surface: "review",
          contentType: detected.contentType,
          sizeBytes: bytes.length,
          sha256,
          status: "active",
          createdById: null,
          sourceRef: `orderReview:${row.id}`,
        }).catch(() => undefined);
      }
      await dropQuarantine();
      await this.audit?.log({
        organizationId: row.organizationId, userId: "system", action: "review.media_attached",
        entityType: "OrderReview", entityId: row.id,
        metadata: { kind, contentType: detected.contentType, sizeBytes: bytes.length },
      }).catch(() => undefined);
      return { ok: true, media: reviewMediaOf(updated) };
    } catch (e) {
      await storage.delete("private", finalKey).catch(() => undefined);
      await dropQuarantine();
      throw e;
    }
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
