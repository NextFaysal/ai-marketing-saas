import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorageService } from "../storage/storage.service";
import { SocialService } from "../social/social.service";
import { webBaseUrl } from "../courier/tracking-token";
import { reviewMediaOf } from "./reviews.service";

/**
 * EC15 — unified product reviews (own CX12b OrderReviews +
 * pulled ExternalReviews) for public product surfaces and staff
 * moderation.
 *
 * VERIFIED RULE (own reviews): an OrderReview row is created
 * ONLY by ReviewsService.noteDelivered, which fires on a
 * delivery event (order.delivered / shipment delivered) — see
 * reviews.service.ts (CX12b). A row that has a rating and a
 * receivedAt therefore exists only for an order that was
 * delivered to a real customer. So a received own review is
 * delivery-backed: verified = the row carries its deliveredAt
 * stamp (always set at creation) OR the order's current status
 * is "completed". External reviews are NEVER verified here —
 * we did not witness that purchase; the platform source is
 * labelled instead.
 *
 * PRIVACY (public): own-review authors are shown by FIRST NAME
 * ONLY. Email / phone / last name never leave this service on a
 * public surface.
 */
@Injectable()
export class ProductReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    // NF8: the EXISTING Social Posts engine for the staff
    // share-as-draft action, and the storage service for minting
    // signed media URLs at read time. Optional + last so
    // positional spec constructions keep working.
    @Optional() private readonly social?: SocialService,
    @Optional() private readonly storage?: StorageService,
  ) {}

  private p(): any { return this.prisma as any; }

  /**
   * NF8: a review's media as display items. URLs are SHORT-LIVED
   * signed GETs minted NOW from the private-bucket keys — never
   * stored, never the raw key. In local storage mode there is no
   * signed URL to hand out, so url is null (the MediaLibrary
   * discipline) rather than a fabricated link.
   *
   * CALLER DISCIPLINE (the EC15 rule, unchanged): this is only
   * invoked for rows the caller is already allowed to show —
   * the public path maps ONLY received + isVisible rows, so an
   * unapproved/hidden review's media URL is never minted on a
   * public surface; the staff list is a staff surface.
   */
  private mediaItemsOf(row: any): { kind: string; contentType: string; url: string | null }[] {
    return reviewMediaOf(row).map((m) => ({
      kind: m.kind,
      contentType: m.contentType,
      url: this.storage && this.storage.mode === "s3"
        ? this.storage.signedGetUrl("private", m.key, 900)
        : null,
    }));
  }

  private imageUrlsOf(row: any): string[] {
    const v = row?.imageUrls;
    if (Array.isArray(v)) return v.filter((x: any) => typeof x === "string");
    return [];
  }

  /** Platform label for an external row, from its store. */
  private platformOf(store: any): string {
    const platform = String(store?.platform ?? "").toLowerCase();
    if (platform === "woocommerce" || platform === "shopify") return platform;
    return platform || "external";
  }

  /** Org-scoped orders that contain this product. */
  private async orderIdsForProduct(organizationId: string, productId: string): Promise<string[]> {
    const items = await (this.p().orderItem?.findMany({
      where: { productId }, select: { orderId: true },
    }).catch(() => []) ?? []);
    const orderIds = [...new Set(items.map((i: any) => i.orderId).filter(Boolean))] as string[];
    if (!orderIds.length) return [];
    // Re-scope through the org's orders: an OrderItem row alone
    // never proves org ownership of the order.
    const orders = await (this.p().order?.findMany({
      where: { organizationId, id: { in: orderIds } }, select: { id: true },
    }).catch(() => []) ?? []);
    const owned = new Set(orders.map((o: any) => o.id));
    return orderIds.filter((id) => owned.has(id));
  }

  private async ownReviewsRaw(organizationId: string, productId: string) {
    const orderIds = await this.orderIdsForProduct(organizationId, productId);
    if (!orderIds.length) return { rows: [], orders: new Map<string, any>(), customers: new Map<string, any>() };
    const rows = (await (this.p().orderReview?.findMany({
      where: { organizationId }, orderBy: { receivedAt: "desc" }, take: 500,
    }).catch(() => []) ?? [])).filter((r: any) =>
      orderIds.includes(r.orderId) && r.rating != null && r.receivedAt != null);
    const ordersList = await (this.p().order?.findMany({
      where: { organizationId, id: { in: [...new Set(rows.map((r: any) => r.orderId))] } },
    }).catch(() => []) ?? []);
    const orders = new Map<string, any>(ordersList.map((o: any) => [o.id, o] as [string, any]));
    const customerIds = [...new Set(rows.map((r: any) => r.customerId ?? orders.get(r.orderId)?.customerId).filter(Boolean))] as string[];
    const customersList = customerIds.length
      ? await (this.p().customer?.findMany({ where: { organizationId, id: { in: customerIds } } }).catch(() => []) ?? [])
      : [];
    const customers = new Map<string, any>(customersList.map((c: any) => [c.id, c] as [string, any]));
    return { rows, orders, customers };
  }

  private ownItem(row: any, order: any, customer: any, opts?: { staff?: boolean }) {
    const mediaItems = this.mediaItemsOf(row);
    return {
      source: "store",
      id: row.id,
      // Public privacy: first name only. Staff see the full name
      // they already have in the orders list.
      authorName: opts?.staff
        ? ([customer?.firstName, customer?.lastName].filter(Boolean).join(" ") || null)
        : (customer?.firstName ?? null),
      rating: row.rating,
      text: row.comment ?? null,
      // NF8: the review's OWN uploaded media (was: no field —
      // never invented; now the field exists). imageUrls carries
      // the image items' URLs for the existing PDP/staff
      // renderers; `media` carries every item incl. video.
      imageUrls: mediaItems.filter((m) => m.kind === "image" && m.url).map((m) => m.url as string),
      media: mediaItems,
      socialDraftPostId: row.socialDraftPostId ?? null,
      // Verified rule documented on the class: rows are only
      // created after a delivery event.
      verified: row.deliveredAt != null || order?.status === "completed",
      replyText: row.replyText ?? null,
      repliedAt: row.repliedAt ?? null,
      isVisible: row.isVisible !== false,
      createdAt: row.receivedAt,
      orderId: row.orderId,
    };
  }

  private externalItem(row: any, store: any, opts?: { staff?: boolean }) {
    return {
      source: this.platformOf(store),
      id: row.id,
      authorName: row.authorName ?? null,
      rating: row.rating,
      text: row.text ?? null,
      imageUrls: this.imageUrlsOf(row),
      media: [] as { kind: string; contentType: string; url: string | null }[], // external media rides imageUrls (platform URLs), unchanged
      socialDraftPostId: null,
      verified: false, // a pulled review's purchase cannot be verified by us
      replyText: null,
      repliedAt: null,
      isVisible: row.status !== "hidden",
      createdAt: row.createdAtRemote ?? row.createdAt,
      orderId: null,
    };
  }

  private async storesById(storeIds: string[]): Promise<Map<string, any>> {
    if (!storeIds.length) return new Map();
    const stores = await (this.p().store?.findMany({
      where: { id: { in: storeIds } },
    }).catch(() => []) ?? []);
    return new Map<string, any>(stores.map((s: any) => [s.id, s] as [string, any]));
  }

  private summarize(items: any[]) {
    const count = items.length;
    if (!count) return { average: null as number | null, count: 0 };
    const sum = items.reduce((acc, i) => acc + Number(i.rating ?? 0), 0);
    return { average: Math.round((sum / count) * 10) / 10, count };
  }

  /**
   * Unified PUBLIC reviews for one product: visible own reviews
   * + visible external reviews, newest first, capped at 50.
   * The summary is computed over ALL visible items (before the
   * cap) so the average never silently drops reviews.
   */
  async getPublicProductReviews(organizationId: string, productId: string) {
    const { rows, orders, customers } = await this.ownReviewsRaw(organizationId, productId);
    const own = rows
      .filter((r: any) => r.isVisible !== false)
      .map((r: any) => this.ownItem(r, orders.get(r.orderId), customers.get(r.customerId ?? orders.get(r.orderId)?.customerId)));
    const extRows = await (this.p().externalReview?.findMany({
      where: { organizationId, productId, status: "visible" },
    }).catch(() => []) ?? []);
    const stores = await this.storesById([...new Set(extRows.map((r: any) => r.storeId).filter(Boolean))] as string[]);
    const external = extRows.map((r: any) => this.externalItem(r, stores.get(r.storeId)));
    const all = [...own, ...external].sort(
      (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
    );
    return { summary: this.summarize(all), items: all.slice(0, 50) };
  }

  /** Public route resolution: org by slug + product by slug. */
  async getPublicBySlug(orgSlug: string, productSlug: string) {
    const org = await (this.p().organization?.findFirst({ where: { slug: orgSlug } }).catch(() => null) ?? null);
    if (!org) throw new NotFoundException("দোকানটি পাওয়া যায়নি");
    const product = await (this.p().product?.findFirst({
      where: { organizationId: org.id, slug: productSlug, status: "ACTIVE" },
    }).catch(() => null) ?? null);
    if (!product) throw new NotFoundException("পণ্যটি পাওয়া যায়নি");
    const { summary, items } = await this.getPublicProductReviews(org.id, product.id);
    return {
      product: { id: product.id, name: product.name, slug: product.slug ?? null },
      summary,
      items,
    };
  }

  // ---------------- Staff moderation ----------------

  /** Unified staff list: own received + external, with product
   * names and hidden state. Filters: productId, source, rating,
   * hidden (true = only hidden, false = only visible). */
  async listStaffReviews(organizationId: string, filters?: { productId?: string; source?: string; rating?: number; hidden?: boolean }) {
    // ---- own ----
    let ownItems: any[] = [];
    const productIds = filters?.productId ? [filters.productId] : null;
    // Gather candidate products per order for names/filtering.
    const allOwn = (await (this.p().orderReview?.findMany({
      where: { organizationId }, orderBy: { receivedAt: "desc" }, take: 500,
    }).catch(() => []) ?? [])).filter((r: any) => r.rating != null && r.receivedAt != null);
    const orderIds = [...new Set(allOwn.map((r: any) => r.orderId))] as string[];
    const itemsRows = orderIds.length
      ? await (this.p().orderItem?.findMany({ where: { orderId: { in: orderIds } } }).catch(() => []) ?? [])
      : [];
    const productIdsOfOrder = new Map<string, string[]>();
    for (const it of itemsRows) {
      if (!it.productId) continue;
      const arr = productIdsOfOrder.get(it.orderId) ?? [];
      arr.push(it.productId);
      productIdsOfOrder.set(it.orderId, arr);
    }
    const allProductIds = [...new Set(itemsRows.map((i: any) => i.productId).filter(Boolean))] as string[];
    const productsList = allProductIds.length
      ? await (this.p().product?.findMany({ where: { organizationId, id: { in: allProductIds } } }).catch(() => []) ?? [])
      : [];
    const productById = new Map<string, any>(productsList.map((pr: any) => [pr.id, pr] as [string, any]));
    const ordersList = orderIds.length
      ? await (this.p().order?.findMany({ where: { organizationId, id: { in: orderIds } } }).catch(() => []) ?? [])
      : [];
    const orders = new Map<string, any>(ordersList.map((o: any) => [o.id, o] as [string, any]));
    const customerIds = [...new Set(allOwn.map((r: any) => r.customerId ?? orders.get(r.orderId)?.customerId).filter(Boolean))] as string[];
    const customersList = customerIds.length
      ? await (this.p().customer?.findMany({ where: { organizationId, id: { in: customerIds } } }).catch(() => []) ?? [])
      : [];
    const customers = new Map<string, any>(customersList.map((c: any) => [c.id, c] as [string, any]));

    for (const r of allOwn) {
      const pIds = productIdsOfOrder.get(r.orderId) ?? [];
      if (productIds && !pIds.some((id) => productIds.includes(id))) continue;
      const base = this.ownItem(r, orders.get(r.orderId), customers.get(r.customerId ?? orders.get(r.orderId)?.customerId), { staff: true });
      ownItems.push({
        ...base,
        productId: pIds[0] ?? null,
        productIds: pIds,
        productName: pIds.map((id) => productById.get(id)?.name).filter(Boolean)[0] ?? null,
        productNames: pIds.map((id) => productById.get(id)?.name).filter(Boolean),
        hidden: base.isVisible === false,
      });
    }

    // ---- external ----
    const extRows = await (this.p().externalReview?.findMany({
      where: { organizationId }, take: 500,
    }).catch(() => []) ?? []);
    const stores = await this.storesById([...new Set(extRows.map((r: any) => r.storeId).filter(Boolean))] as string[]);
    const extProductIds = [...new Set(extRows.map((r: any) => r.productId).filter(Boolean))] as string[];
    const extProducts = extProductIds.length
      ? await (this.p().product?.findMany({ where: { organizationId, id: { in: extProductIds } } }).catch(() => []) ?? [])
      : [];
    const extProductById = new Map<string, any>(extProducts.map((pr: any) => [pr.id, pr] as [string, any]));
    const externalItems = extRows.map((r: any) => {
      const base = this.externalItem(r, stores.get(r.storeId), { staff: true });
      return {
        ...base,
        productId: r.productId,
        productIds: [r.productId],
        productName: extProductById.get(r.productId)?.name ?? null,
        productNames: [extProductById.get(r.productId)?.name].filter(Boolean),
        hidden: r.status === "hidden",
        storeId: r.storeId,
      };
    });

    let all = [...ownItems, ...externalItems];
    if (filters?.source) all = all.filter((i) => i.source === filters.source);
    if (filters?.rating) all = all.filter((i) => i.rating === filters.rating);
    if (filters?.hidden === true) all = all.filter((i) => i.hidden);
    if (filters?.hidden === false) all = all.filter((i) => !i.hidden);
    if (filters?.productId) all = all.filter((i) => (i.productIds ?? []).includes(filters.productId));
    all.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
    return all.slice(0, 200);
  }

  /** Staff moderation: hide/show either source; reply own only. */
  async moderate(organizationId: string, source: string, id: string, dto: { isVisible?: boolean; replyText?: string }, actorId?: string) {
    if (source === "store") {
      const row = await (this.p().orderReview?.findFirst({ where: { id, organizationId } }).catch(() => null) ?? null);
      if (!row) throw new NotFoundException("রিভিউটি পাওয়া যায়নি");
      const data: any = {};
      if (dto.isVisible !== undefined) data.isVisible = dto.isVisible === true;
      if (dto.replyText !== undefined) {
        const text = String(dto.replyText ?? "").trim().slice(0, 2000) || null;
        data.replyText = text;
        data.repliedAt = text ? new Date() : null;
      }
      const updated = Object.keys(data).length
        ? await this.p().orderReview.update({ where: { id: row.id }, data })
        : row;
      await this.audit?.log({
        organizationId, userId: actorId ?? "system", action: "review.moderate",
        entityType: "OrderReview", entityId: row.id,
        metadata: { source: "store", ...(dto.isVisible !== undefined ? { isVisible: data.isVisible } : {}), ...(dto.replyText !== undefined ? { replied: !!data.replyText } : {}) },
      }).catch(() => undefined);
      return { ok: true, source: "store", id: row.id, isVisible: updated.isVisible !== false, replyText: updated.replyText ?? null, repliedAt: updated.repliedAt ?? null };
    }
    // External sources: woocommerce / shopify / any platform label.
    const row = await (this.p().externalReview?.findFirst({ where: { id, organizationId } }).catch(() => null) ?? null);
    if (!row) throw new NotFoundException("রিভিউটি পাওয়া যায়নি");
    if (dto.replyText !== undefined) {
      throw new BadRequestException("বাইরের রিভিউতে উত্তর দেওয়া যায় না");
    }
    const data: any = {};
    if (dto.isVisible !== undefined) data.status = dto.isVisible ? "visible" : "hidden";
    const updated = Object.keys(data).length
      ? await this.p().externalReview.update({ where: { id: row.id }, data })
      : row;
    await this.audit?.log({
      organizationId, userId: actorId ?? "system", action: "review.moderate",
      entityType: "ExternalReview", entityId: row.id,
      metadata: { source, ...(dto.isVisible !== undefined ? { isVisible: dto.isVisible } : {}) },
    }).catch(() => undefined);
    return { ok: true, source, id: row.id, isVisible: updated.status !== "hidden", replyText: null, repliedAt: null };
  }

  // ---------------- NF8: share an approved review as a social draft ----------------

  /** review → order → first item → product (null at any gap) —
   * the SU5 resolution shape, org-scoped at every hop. */
  private async productForOrder(organizationId: string, orderId: string): Promise<any> {
    const item = await (this.p().orderItem?.findFirst({ where: { orderId } }).catch(() => null) ?? null);
    if (!item?.productId) return null;
    return await (this.p().product?.findFirst({
      where: { id: item.productId, organizationId },
    }).catch(() => null) ?? null);
  }

  /**
   * One staff action on an APPROVED (received + visible, per
   * EC15) own review → ONE draft social post through the
   * EXISTING Social Posts engine (SocialService.createPost —
   * the draft is born status "draft" there; staff review and
   * publish it themselves in the Social composer). The caption
   * is grounded in the review row only: the star rating, the
   * customer's own words, the product name. The product link
   * follows the MS5 rule: `${webBaseUrl}/checkout/${slug}` only
   * when the product has a slug — never a fabricated URL.
   *
   * Exactly-once per review: OrderReview.socialDraftPostId is
   * the claim. A repeat action finds the claim, loads that post
   * org-scoped, and returns it as `reused` — SocialService is
   * never called twice for one review. (Review media is NOT
   * attached: SocialPost mediaRefs reference MediaAsset rows of
   * the social library, and review media are StoredFiles — the
   * draft is text + link, as scoped; staff can attach media in
   * the composer.)
   */
  async createSocialDraft(organizationId: string, reviewId: string, actorId: string, dto?: { socialAccountId?: string }) {
    const row = await (this.p().orderReview?.findFirst({ where: { id: reviewId, organizationId } }).catch(() => null) ?? null);
    if (!row) throw new NotFoundException("রিভিউটি পাওয়া যায়নি");
    if (row.rating == null || !row.receivedAt) {
      throw new BadRequestException("এই রিভিউটি এখনো জমা হয়নি — জমা হওয়া রিভিউ থেকেই সোশ্যাল ড্রাফট তৈরি করা যায়।");
    }
    if (row.isVisible === false) {
      throw new BadRequestException("লুকানো রিভিউ থেকে সোশ্যাল ড্রাফট তৈরি করা যাবে না — আগে রিভিউটি দেখান।");
    }
    if (!this.social) {
      throw new BadRequestException("সোশ্যাল পোস্ট ইঞ্জিন উপলব্ধ নয়।");
    }
    // Exactly-once: an existing claim is the answer.
    if (row.socialDraftPostId) {
      const existing = await (this.p().socialPost?.findFirst({
        where: { id: row.socialDraftPostId, organizationId },
      }).catch(() => null) ?? null);
      if (existing) {
        return { created: false, reused: true, postId: existing.id, status: existing.status };
      }
      // The claimed post is gone (deleted by staff): fall
      // through and create a fresh draft, overwriting the claim.
    }
    // Target account: the staff-picked one (org-scoped +
    // connected, validated), else the org's first connected
    // account — the SU5 resolution order.
    let account: any = null;
    if (dto?.socialAccountId) {
      account = await (this.p().socialAccount?.findFirst({
        where: { id: dto.socialAccountId, organizationId, status: "connected" },
      }).catch(() => null) ?? null);
      if (!account) {
        throw new BadRequestException("নির্বাচিত Social অ্যাকাউন্টটি এই Organization-এর সংযুক্ত (connected) অ্যাকাউন্ট নয়।");
      }
    } else {
      account = await (this.p().socialAccount?.findFirst({
        where: { organizationId, status: "connected" },
        orderBy: { createdAt: "asc" },
      }).catch(() => null) ?? null);
      if (!account) {
        throw new BadRequestException("কোনো সংযুক্ত (connected) সোশ্যাল অ্যাকাউন্ট নেই — আগে Connect Center থেকে একটি অ্যাকাউন্ট সংযুক্ত করুন।");
      }
    }
    const product = await this.productForOrder(organizationId, row.orderId);
    const stars = "★".repeat(row.rating) + "☆".repeat(5 - row.rating);
    const comment = typeof row.comment === "string" ? row.comment.trim() : "";
    const caption = [
      `${stars} আমাদের কাস্টমারের রিভিউ`,
      comment ? `“${comment.slice(0, 500)}”` : null,
      product?.name ? `পণ্য: ${product.name}` : null,
    ].filter(Boolean).join("\n");
    const linkUrl = product?.slug ? `${webBaseUrl()}/checkout/${product.slug}` : undefined;
    const post: any = await this.social.createPost(organizationId, actorId, {
      socialAccountId: account.id,
      caption,
      ...(linkUrl ? { linkUrl } : {}),
    });
    if (!post?.id) {
      throw new BadRequestException("সোশ্যাল ড্রাফট তৈরি করা যায়নি।");
    }
    await this.p().orderReview.update({ where: { id: row.id }, data: { socialDraftPostId: post.id } });
    await this.audit?.log({
      organizationId, userId: actorId ?? "system", action: "review.social_draft_created",
      entityType: "OrderReview", entityId: row.id,
      metadata: { postId: post.id, socialAccountId: account.id },
    }).catch(() => undefined);
    return { created: true, reused: false, postId: post.id, status: post.status ?? "draft" };
  }
}
