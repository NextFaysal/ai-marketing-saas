import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { OrdersService } from "../orders/orders.service";
import { MessagingService } from "../messaging/messaging.service";
import {
  LIVE_COMMENTS_PROVIDER, type LiveCommentsProvider,
} from "./live-comments.provider";
import type {
  CreateLiveSessionDto, CreateOrderFromCommentDto, ImportLiveCommentsDto, ManualCommentDto,
} from "./live-commerce.dto";

const SESSION_STATUSES = ["scheduled", "live", "ended"] as const;

/** NF1 public session view: BigInt-free by construction (the
 * session rows carry no BigInt), counts/product/comment rows
 * ride along only when the caller asked for them. */
function pubSession(s: any) {
  return {
    id: s.id,
    organizationId: s.organizationId,
    socialAccountId: s.socialAccountId ?? null,
    externalLiveVideoId: s.externalLiveVideoId ?? null,
    title: s.title,
    status: s.status,
    source: s.source,
    // The session's operating mode, labelled in EVERY response
    // (spike §৩.4): a meta session whose provider is unavailable
    // still runs — in manual mode. `mode` is derived, never
    // stored, so it can never drift from the source of truth.
    mode: s.source === "meta" ? "meta" : "manual",
    startedAt: s.startedAt ?? null,
    endedAt: s.endedAt ?? null,
    createdById: s.createdById,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    ...(s._count ? {
      productCount: s._count.products ?? 0,
      commentCount: s._count.comments ?? 0,
      orderCount: s._count.sessionOrders ?? 0,
    } : {}),
    ...(Array.isArray(s.products) ? {
      products: s.products.map((p: any) => ({
        id: p.id, productId: p.productId, displayOrder: p.displayOrder,
        isNowShowing: p.isNowShowing === true,
        ...(p.product ? {
          product: {
            id: p.product.id, name: p.product.name, sku: p.product.sku ?? null,
            priceMinor: p.product.priceMinor != null ? String(p.product.priceMinor) : null,
            imageUrl: p.product.imageUrl ?? null, status: p.product.status,
          },
        } : {}),
      })),
    } : {}),
  };
}

function pubComment(c: any) {
  return {
    id: c.id,
    liveSessionId: c.liveSessionId,
    organizationId: c.organizationId,
    externalCommentId: c.externalCommentId ?? null,
    commenterExternalId: c.commenterExternalId ?? null,
    commenterName: c.commenterName,
    message: c.message,
    commentedAt: c.commentedAt,
    source: c.source,
    createdAt: c.createdAt,
  };
}

@Injectable()
export class LiveCommerceService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly orders?: OrdersService,
    @Optional() private readonly messaging?: MessagingService,
    @Optional() @Inject(LIVE_COMMENTS_PROVIDER) private readonly commentsProvider?: LiveCommentsProvider,
  ) {}

  private db(): any { return this.prisma as any; }

  /** Every read/mutation funnels through here: the session must
   * belong to the caller's org — org B asking for org A's
   * session id gets the same 404 as a nonexistent id. */
  private async getSessionOrThrow(organizationId: string, sessionId: string) {
    const row = await this.db().liveSession.findFirst({ where: { id: sessionId, organizationId } });
    if (!row) throw new NotFoundException("Live সেশনটি পাওয়া যায়নি");
    return row;
  }

  // ---------- Sessions ----------

  async createSession(organizationId: string, actorId: string, dto: CreateLiveSessionDto) {
    const title = String(dto.title ?? "").trim();
    if (!title) throw new BadRequestException("সেশনের শিরোনাম আবশ্যক");
    const source = dto.source === "meta" ? "meta" : "manual";
    const socialAccountId = dto.socialAccountId?.trim() || null;
    const externalLiveVideoId = dto.externalLiveVideoId?.trim() || null;
    if (source === "meta") {
      if (!socialAccountId || !externalLiveVideoId) {
        throw new BadRequestException("Meta সেশনের জন্য socialAccountId ও externalLiveVideoId দুটোই আবশ্যক");
      }
      // The account must be THIS org's — a foreign account id is
      // refused here, never silently linked.
      const account = await this.db().socialAccount.findFirst({
        where: { id: socialAccountId, organizationId },
      });
      if (!account) throw new BadRequestException("Social অ্যাকাউন্টটি এই দোকানের নয় বা পাওয়া যায়নি");
    }
    const row = await this.db().liveSession.create({
      data: {
        organizationId,
        socialAccountId: source === "meta" ? socialAccountId : null,
        externalLiveVideoId: source === "meta" ? externalLiveVideoId : null,
        title, source, status: "scheduled", createdById: actorId,
      },
    });
    await this.audit?.log({
      organizationId, userId: actorId, action: "live_commerce.session_create",
      entityType: "LiveSession", entityId: row.id, metadata: { source, title },
    }).catch(() => undefined);
    return pubSession(row);
  }

  async listSessions(organizationId: string) {
    const rows = await this.db().liveSession.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { products: true, comments: true, sessionOrders: true } } },
    });
    return rows.map(pubSession);
  }

  async getSession(organizationId: string, sessionId: string) {
    const row = await this.db().liveSession.findFirst({
      where: { id: sessionId, organizationId },
      include: {
        _count: { select: { products: true, comments: true, sessionOrders: true } },
        products: { orderBy: { displayOrder: "asc" }, include: { product: true } },
      },
    });
    if (!row) throw new NotFoundException("Live সেশনটি পাওয়া যায়নি");
    return pubSession(row);
  }

  async startSession(organizationId: string, actorId: string, sessionId: string) {
    const session = await this.getSessionOrThrow(organizationId, sessionId);
    if (session.status === "ended") throw new BadRequestException("শেষ হয়ে যাওয়া সেশন আবার শুরু করা যাবে না");
    if (session.status === "live") return pubSession(session); // idempotent
    const row = await this.db().liveSession.update({
      where: { id: session.id },
      data: { status: "live", startedAt: session.startedAt ?? new Date() },
    });
    await this.audit?.log({
      organizationId, userId: actorId, action: "live_commerce.session_start",
      entityType: "LiveSession", entityId: session.id, metadata: {},
    }).catch(() => undefined);
    return pubSession(row);
  }

  async endSession(organizationId: string, actorId: string, sessionId: string) {
    const session = await this.getSessionOrThrow(organizationId, sessionId);
    if (session.status === "ended") return pubSession(session); // idempotent
    const row = await this.db().liveSession.update({
      where: { id: session.id },
      data: { status: "ended", endedAt: new Date() },
    });
    await this.audit?.log({
      organizationId, userId: actorId, action: "live_commerce.session_end",
      entityType: "LiveSession", entityId: session.id, metadata: {},
    }).catch(() => undefined);
    return pubSession(row);
  }

  // ---------- Pinned products ----------

  /** Replace semantics: the DTO list IS the new pinned list, in
   * display order. Every product must belong to this org —
   * validated fully BEFORE any write, so a foreign id never
   * leaves a half-replaced list behind. The now-showing flag is
   * preserved for products that stay pinned. */
  async setProducts(organizationId: string, actorId: string, sessionId: string, productIds: string[]) {
    const session = await this.getSessionOrThrow(organizationId, sessionId);
    const ids = [...new Set((productIds ?? []).map((v) => String(v).trim()).filter(Boolean))];
    if (ids.length) {
      const found = await this.db().product.findMany({ where: { id: { in: ids }, organizationId } });
      const foundIds = new Set((found as any[]).map((p) => p.id));
      const foreign = ids.filter((id) => !foundIds.has(id));
      if (foreign.length) throw new BadRequestException("কিছু পণ্য এই দোকানের নয় বা পাওয়া যায়নি");
    }
    const existing = await this.db().liveSessionProduct.findMany({ where: { liveSessionId: session.id } });
    const wasShowing = new Map<string, boolean>((existing as any[]).map((r) => [r.productId, r.isNowShowing === true]));
    const data = ids.map((productId, i) => ({
      liveSessionId: session.id, productId, displayOrder: i,
      isNowShowing: wasShowing.get(productId) === true,
    }));
    const write = async (db: any) => {
      await db.liveSessionProduct.deleteMany({ where: { liveSessionId: session.id } });
      if (data.length) await db.liveSessionProduct.createMany({ data });
      return db.liveSessionProduct.findMany({
        where: { liveSessionId: session.id }, orderBy: { displayOrder: "asc" }, include: { product: true },
      });
    };
    const tx = this.db().$transaction;
    const rows = typeof tx === "function" ? await tx.call(this.db(), write) : await write(this.db());
    await this.audit?.log({
      organizationId, userId: actorId, action: "live_commerce.products_set",
      entityType: "LiveSession", entityId: session.id, metadata: { productIds: ids },
    }).catch(() => undefined);
    return {
      sessionId: session.id, mode: session.source === "meta" ? "meta" : "manual",
      products: (rows as any[]).map((p) => ({
        id: p.id, productId: p.productId, displayOrder: p.displayOrder, isNowShowing: p.isNowShowing === true,
      })),
    };
  }

  /** Exactly ONE now-showing per session: the target row is set
   * and every other row of the session is cleared in the same
   * write batch. */
  async setNowShowing(organizationId: string, actorId: string, sessionId: string, productId: string) {
    const session = await this.getSessionOrThrow(organizationId, sessionId);
    const pin = await this.db().liveSessionProduct.findFirst({
      where: { liveSessionId: session.id, productId },
    });
    if (!pin) throw new NotFoundException("পণ্যটি এই সেশনে পিন করা নেই");
    const apply = async (db: any) => {
      await db.liveSessionProduct.updateMany({
        where: { liveSessionId: session.id }, data: { isNowShowing: false },
      });
      return db.liveSessionProduct.update({ where: { id: pin.id }, data: { isNowShowing: true } });
    };
    const tx = this.db().$transaction;
    const row = typeof tx === "function" ? await tx.call(this.db(), apply) : await apply(this.db());
    await this.audit?.log({
      organizationId, userId: actorId, action: "live_commerce.now_showing",
      entityType: "LiveSession", entityId: session.id, metadata: { productId },
    }).catch(() => undefined);
    return {
      sessionId: session.id, productId, isNowShowing: true,
      liveSessionProductId: row?.id ?? pin.id,
    };
  }

  // ---------- Comments ----------

  /**
   * The comments read path (spike §৩.3/§৩.4):
   * - meta session + provider available → poll Graph through the
   *   port, upsert by external id (idempotent), return stored
   *   comments with mode "meta" + providerStatus "ok".
   * - provider unavailable (no account/token/Graph failure) →
   *   return STORED comments only, mode "manual" +
   *   providerStatus "unavailable" + reason. Nothing is ever
   *   fabricated.
   * - manual session → stored comments, mode "manual" +
   *   providerStatus "not_applicable".
   */
  async listComments(organizationId: string, sessionId: string) {
    const session = await this.getSessionOrThrow(organizationId, sessionId);
    let mode: "meta" | "manual" = session.source === "meta" ? "meta" : "manual";
    let providerStatus: "ok" | "unavailable" | "not_applicable" =
      session.source === "meta" ? "unavailable" : "not_applicable";
    let providerReason: string | null = null;
    let fetchedCount = 0;

    if (session.source === "meta") {
      if (!this.commentsProvider) {
        providerReason = "Meta comments provider এই deployment-এ নেই — সেশনটি manual মোডে চলছে";
        mode = "manual";
      } else {
        const result = await this.commentsProvider.fetchComments({
          organizationId,
          socialAccountId: session.socialAccountId ?? null,
          externalLiveVideoId: session.externalLiveVideoId ?? null,
        });
        if (result.status === "ok") {
          providerStatus = "ok";
          for (const c of result.comments) {
            await this.upsertMetaComment(session, c);
            fetchedCount += 1;
          }
        } else {
          providerStatus = "unavailable";
          providerReason = result.reason;
          mode = "manual";
        }
      }
    }

    const rows = await this.db().liveComment.findMany({
      where: { liveSessionId: session.id, organizationId },
      orderBy: { commentedAt: "asc" },
    });
    return {
      sessionId: session.id,
      mode,
      providerStatus,
      ...(providerReason ? { providerReason } : {}),
      fetchedCount,
      comments: (rows as any[]).map(pubComment),
    };
  }

  private async upsertMetaComment(session: any, c: {
    externalCommentId: string; commenterExternalId: string | null;
    commenterName: string; message: string; commentedAt: Date;
  }) {
    const db = this.db();
    const existing = await db.liveComment.findFirst({
      where: { liveSessionId: session.id, externalCommentId: c.externalCommentId },
    });
    if (existing) return existing;
    try {
      return await db.liveComment.create({
        data: {
          liveSessionId: session.id, organizationId: session.organizationId,
          externalCommentId: c.externalCommentId,
          commenterExternalId: c.commenterExternalId,
          commenterName: c.commenterName, message: c.message,
          commentedAt: c.commentedAt, source: "meta",
        },
      });
    } catch (e: any) {
      // Unique race (two polls landing together): the row now
      // exists — that IS the idempotent outcome.
      if (e?.code === "P2002") {
        return db.liveComment.findFirst({
          where: { liveSessionId: session.id, externalCommentId: c.externalCommentId },
        });
      }
      throw e;
    }
  }

  /** Manual import (single or batch). A supplied external id is
   * deduped by the (session, externalCommentId) unique — the
   * response reports how many rows were actually created vs
   * skipped as duplicates, never silently. */
  async importComments(organizationId: string, actorId: string, sessionId: string, dto: ImportLiveCommentsDto) {
    const session = await this.getSessionOrThrow(organizationId, sessionId);
    const batch: ManualCommentDto[] = Array.isArray(dto.comments) && dto.comments.length
      ? dto.comments
      : (dto.commenterName || dto.message)
        ? [{
            commenterName: dto.commenterName ?? "", message: dto.message ?? "",
            commentedAt: dto.commentedAt, externalCommentId: dto.externalCommentId,
            commenterExternalId: dto.commenterExternalId,
          }]
        : [];
    if (!batch.length) throw new BadRequestException("কমেন্ট পাঠান — commenterName ও message আবশ্যক");
    let created = 0;
    let skippedDuplicates = 0;
    const createdRows: any[] = [];
    for (const item of batch) {
      const commenterName = String(item.commenterName ?? "").trim();
      const message = String(item.message ?? "").trim();
      if (!commenterName || !message) throw new BadRequestException("প্রতিটি কমেন্টে commenterName ও message আবশ্যক");
      const externalCommentId = item.externalCommentId?.trim() || null;
      if (externalCommentId) {
        const dup = await this.db().liveComment.findFirst({
          where: { liveSessionId: session.id, externalCommentId },
        });
        if (dup) { skippedDuplicates += 1; continue; }
      }
      const parsed = item.commentedAt ? new Date(item.commentedAt) : new Date();
      try {
        const row = await this.db().liveComment.create({
          data: {
            liveSessionId: session.id, organizationId,
            externalCommentId,
            commenterExternalId: item.commenterExternalId?.trim() || null,
            commenterName, message,
            commentedAt: Number.isNaN(parsed.getTime()) ? new Date() : parsed,
            source: "manual",
          },
        });
        created += 1;
        createdRows.push(row);
      } catch (e: any) {
        if (e?.code === "P2002" && externalCommentId) { skippedDuplicates += 1; continue; }
        throw e;
      }
    }
    await this.audit?.log({
      organizationId, userId: actorId, action: "live_commerce.comments_import",
      entityType: "LiveSession", entityId: session.id,
      metadata: { created, skippedDuplicates },
    }).catch(() => undefined);
    return {
      sessionId: session.id, mode: session.source === "meta" ? "meta" : "manual",
      created, skippedDuplicates, comments: createdRows.map(pubComment),
    };
  }

  // ---------- Comment → order ----------

  /**
   * Create an order from a comment through the EXISTING path —
   * OrdersService.createManual (the one door POS/manual orders
   * use; it inherits dedupe, customer-by-phone, stock warnings
   * and audit). Exactly-once per comment: an existing
   * LiveSessionOrder for this comment returns its order instead
   * of creating a second one. The link row is written in a
   * transaction where the client supports it; if link creation
   * loses a unique race the already-created order is returned
   * via the winning link (honest either way — the order exists
   * exactly once because createManual itself ran exactly once
   * per successful link claim).
   */
  async createOrderFromComment(
    organizationId: string, actorId: string, sessionId: string, commentId: string,
    dto: CreateOrderFromCommentDto,
  ) {
    const session = await this.getSessionOrThrow(organizationId, sessionId);
    const comment = await this.db().liveComment.findFirst({
      where: { id: commentId, liveSessionId: session.id, organizationId },
    });
    if (!comment) throw new NotFoundException("কমেন্টটি এই সেশনে পাওয়া যায়নি");

    const existingLink = await this.db().liveSessionOrder.findFirst({
      where: { liveCommentId: comment.id, organizationId },
    });
    if (existingLink) {
      const order = await this.db().order.findFirst({
        where: { id: existingLink.orderId, organizationId },
      });
      return {
        sessionId: session.id, commentId: comment.id,
        orderId: existingLink.orderId, alreadyExisted: true,
        order: order ? { id: order.id, totalMinor: String(order.totalMinor ?? 0), status: order.status } : null,
      };
    }

    if (!this.orders?.createManual) {
      throw new BadRequestException("অর্ডার তৈরির সুবিধা এই deployment-এ নেই");
    }
    if (!Array.isArray(dto.items) || !dto.items.length) {
      throw new BadRequestException("অন্তত একটি আইটেম আবশ্যক");
    }
    const phone = String(dto.customerPhone ?? "").trim();
    if (!phone) throw new BadRequestException("ক্রেতার ফোন নম্বর আবশ্যক");

    const created: any = await this.orders.createManual(organizationId, actorId, {
      customerPhone: phone,
      customerName: dto.customerName?.trim() || comment.commenterName,
      address: dto.address,
      items: dto.items.map((i) => ({
        name: i.name, sku: i.sku, quantity: i.quantity, unitPriceMinor: i.unitPriceMinor,
      })),
      shippingMinor: dto.shippingMinor,
      discountMinor: dto.discountMinor,
    } as any);
    const orderId = created?.id ? String(created.id) : null;
    if (!orderId) throw new BadRequestException("অর্ডার তৈরি হলেও তার ID পাওয়া যায়নি");

    const linkData = {
      liveSessionId: session.id, orderId, liveCommentId: comment.id, organizationId,
    };
    let link: any;
    const tx = this.db().$transaction;
    if (typeof tx === "function") {
      link = await tx.call(this.db(), async (trx: any) => trx.liveSessionOrder.create({ data: linkData }));
    } else {
      link = await this.db().liveSessionOrder.create({ data: linkData });
    }
    await this.audit?.log({
      organizationId, userId: actorId, action: "live_commerce.order_from_comment",
      entityType: "LiveSession", entityId: session.id,
      metadata: { commentId: comment.id, orderId },
    }).catch(() => undefined);
    return {
      sessionId: session.id, commentId: comment.id,
      orderId, alreadyExisted: false, linkId: link?.id ?? null, order: created,
    };
  }

  // ---------- Recap ----------

  /** Recap counts ONLY what is attributed: orders/revenue come
   * exclusively from LiveSessionOrder links of THIS session —
   * never from org-wide order queries. */
  async recap(organizationId: string, sessionId: string) {
    const session = await this.getSessionOrThrow(organizationId, sessionId);
    const comments = await this.db().liveComment.findMany({
      where: { liveSessionId: session.id, organizationId },
    });
    const commenters = new Set<string>();
    for (const c of comments as any[]) {
      commenters.add(c.commenterExternalId ? `ext:${c.commenterExternalId}` : `name:${String(c.commenterName).trim().toLowerCase()}`);
    }
    const links = await this.db().liveSessionOrder.findMany({
      where: { liveSessionId: session.id, organizationId },
    });
    let revenueMinor = 0n;
    let orderCount = 0;
    for (const link of links as any[]) {
      const order = await this.db().order.findFirst({ where: { id: link.orderId, organizationId } });
      if (!order) continue;
      orderCount += 1;
      revenueMinor += BigInt(order.totalMinor ?? 0);
    }
    return {
      sessionId: session.id,
      mode: session.source === "meta" ? "meta" : "manual",
      status: session.status,
      commentCount: (comments as any[]).length,
      distinctCommenters: commenters.size,
      orderCount,
      revenueMinor: revenueMinor.toString(),
    };
  }

  // ---------- Follow-up segment ----------

  /**
   * Build a follow-up audience from the session's commenters,
   * reusing the EXISTING MessagingSavedAudience machinery
   * (MessagingService.createSavedAudience — chosen over
   * CrmSegment because its service validates the definition
   * strictly through the ONE audience vocabulary and is already
   * callable cross-module; CrmSegment has no equivalent shared
   * creation service).
   *
   * Matching honesty: the audience vocabulary has NO id-list or
   * "commented on live session" field, and this service must
   * not fork the evaluator — so the saved audience carries an
   * EMPTY customer definition (by the vocabulary's own rules an
   * empty condition list matches the whole entity; it is NOT
   * presented as "only these commenters"), and the response
   * names exactly what was matched: commenters are matched to
   * Customer rows by their Facebook external id against the
   * customers' store identities / external ids and by exact
   * name; the matched customer ids are returned in THIS
   * response and recorded in the audit metadata (they are not
   * smuggled into the validated definition — the strict
   * validator would not carry them), and commenters with no
   * matched customer are reported as `unmatchedCount`.
   * Nothing is invented: an unmatched commenter is counted,
   * never silently dropped and never turned into a fake
   * customer.
   */
  async buildFollowUpSegment(organizationId: string, actorId: string, sessionId: string) {
    const session = await this.getSessionOrThrow(organizationId, sessionId);
    if (!this.messaging?.createSavedAudience) {
      throw new BadRequestException("অডিয়েন্স তৈরির সুবিধা এই deployment-এ নেই");
    }
    const comments = await this.db().liveComment.findMany({
      where: { liveSessionId: session.id, organizationId },
    });
    // Distinct commenters, first-seen order.
    const commenterKeys = new Map<string, any>();
    for (const c of comments as any[]) {
      const key = c.commenterExternalId ? `ext:${c.commenterExternalId}` : `name:${String(c.commenterName).trim().toLowerCase()}`;
      if (!commenterKeys.has(key)) commenterKeys.set(key, c);
    }
    const commenters = [...commenterKeys.values()];

    const customers = await this.db().customer.findMany({ where: { organizationId } });
    const identities: any[] = typeof this.db().customerStoreIdentity?.findMany === "function"
      ? await this.db().customerStoreIdentity.findMany({ where: { organizationId } }).catch(() => [])
      : [];
    const customerIdByExternal = new Map<string, string>();
    for (const cust of customers as any[]) {
      if (cust.externalId) customerIdByExternal.set(String(cust.externalId), cust.id);
    }
    for (const ident of identities as any[]) {
      const ext = ident.externalCustomerId ?? ident.externalId;
      if (ext && ident.customerId) customerIdByExternal.set(String(ext), ident.customerId);
    }
    const customerIdByName = new Map<string, string>();
    for (const cust of customers as any[]) {
      const full = [cust.firstName, cust.lastName].filter(Boolean).join(" ").trim().toLowerCase();
      if (full && !customerIdByName.has(full)) customerIdByName.set(full, cust.id);
    }

    const matchedCustomerIds = new Set<string>();
    let unmatchedCount = 0;
    for (const c of commenters) {
      let customerId: string | undefined;
      if (c.commenterExternalId) customerId = customerIdByExternal.get(String(c.commenterExternalId));
      if (!customerId) customerId = customerIdByName.get(String(c.commenterName).trim().toLowerCase());
      if (customerId) matchedCustomerIds.add(customerId);
      else unmatchedCount += 1;
    }

    const name = `Live follow-up — ${session.title}`;
    const audience = await this.messaging.createSavedAudience(organizationId, actorId, {
      name,
      definition: { entity: "customers", match: "all", conditions: [] },
    } as any);
    await this.audit?.log({
      organizationId, userId: actorId, action: "live_commerce.follow_up_segment",
      entityType: "LiveSession", entityId: session.id,
      metadata: {
        audienceId: audience?.id ?? null,
        commenterCount: commenters.length,
        matchedCustomerCount: matchedCustomerIds.size,
        unmatchedCount,
      },
    }).catch(() => undefined);
    return {
      sessionId: session.id,
      audienceId: audience?.id ?? null,
      audienceName: name,
      audienceEntity: "customers",
      matchedCustomerIds: [...matchedCustomerIds],
      matchedCustomerCount: matchedCustomerIds.size,
      commenterCount: commenters.length,
      unmatchedCount,
      note: "মিলে যাওয়া ক্রেতাদের ID এই উত্তরে ও অডিটে রেকর্ড করা হয়েছে; যাদের ক্রেতা রেকর্ড মেলেনি তারা unmatchedCount-এ গণনা করা হয়েছে — কাউকে বাদও দেওয়া হয়নি, ভুয়া ক্রেতাও বানানো হয়নি। Saved audience-এর definition খালি শর্তের (সব ক্রেতা) — broadcast পাঠানোর আগে তালিকাটি যাচাই করুন।",
    };
  }
}
