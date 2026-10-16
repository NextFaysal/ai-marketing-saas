import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { formatMinor } from "@repo/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EventsService } from "../common/events.service";
import { dhakaDayKey, dhakaDayStartUtc } from "../crm/lead-followups";
import { SocialImportService } from "./social-import.service";

export type AutoDraftKind = "new_product" | "sale" | "back_in_stock" | "review_milestone";

export interface AutoDraftEvent {
  kind: AutoDraftKind;
  productId?: string;
  promotionId?: string;
  reviewId?: string;
  orderId?: string;
  rating?: number;
  milestoneTotal?: number;
}

const TOGGLE_BY_KIND: Record<AutoDraftKind, string> = {
  new_product: "newProductEnabled",
  sale: "saleEnabled",
  back_in_stock: "backInStockEnabled",
  review_milestone: "reviewMilestoneEnabled",
};

/** The honest defaults when an org has NO config row: every
 * trigger off, cap 3, no pinned account. Returned by getSettings
 * WITHOUT writing a row. */
export const AUTO_DRAFT_DEFAULTS = {
  newProductEnabled: false,
  saleEnabled: false,
  backInStockEnabled: false,
  reviewMilestoneEnabled: false,
  rssEnabled: false,
  youtubeEnabled: false,
  rssFeedUrl: null as string | null,
  maxDraftsPerDay: 3,
  socialAccountId: null as string | null,
};

/** formatMinor with the social-ai discipline: a malformed price
 * simply contributes no price text — never a guessed number. */
function formatPrice(product: any): string | null {
  if (!product || product.priceMinor === null || product.priceMinor === undefined) return null;
  try {
    return formatMinor(BigInt(product.priceMinor), product.currency ?? "BDT");
  } catch {
    return null;
  }
}

function priceSuffix(product: any): string {
  const price = formatPrice(product);
  return price ? ` — দাম ${price}` : "";
}

/**
 * The discount percentage a promotion's REAL config carries, or
 * null (caption then names the promotion only — nothing is
 * invented). Shapes verified against commerce/promotions.ts:
 * flash → config.percentOff, bogo → config.getDiscountPercent,
 * tiered → the largest config.tiers[].percentOff.
 */
export function promotionDiscountPercent(promotion: any): number | null {
  const config = promotion?.config;
  if (!config || typeof config !== "object") return null;
  const valid = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 100 ? v : null;
  if (promotion.type === "flash") return valid(config.percentOff);
  if (promotion.type === "bogo") return valid(config.getDiscountPercent);
  if (promotion.type === "tiered") {
    const tiers = Array.isArray(config.tiers) ? config.tiers : [];
    const percents = tiers.map((t: any) => valid(t?.percentOff)).filter((v: number | null) => v !== null) as number[];
    return percents.length ? Math.max(...percents) : null;
  }
  return null;
}

/**
 * SU5 — Commerce-connected auto drafts.
 *
 * Producers (products / inventory / promotions / reviews) emit
 * fire-and-forget events on the global EventsService; this
 * engine turns an event into a DRAFT SocialPost — never a
 * publish, never a schedule. Every guard is honest:
 * - no config row (or the kind's toggle off) → nothing;
 * - a per-Dhaka-day cap bounds how many auto drafts can pile up;
 * - an idempotency ref (autoDraftRef) makes a re-delivered event
 *   a no-op;
 * - captions are grounded templates built ONLY from the real
 *   product / promotion / review rows — no invented numbers.
 *
 * The handlers never throw: the bus already isolates failures,
 * and maybeCreateDraft additionally converts unexpected errors
 * into a `{ created: false, reason: "error" }` result for its
 * direct callers (a commerce write must never fail because a
 * social draft could not be made).
 */
@Injectable()
export class SocialCommerceDraftService {
  /**
   * Media seam (the library-service pattern): specs substitute
   * this field with a fake; the default calls the real PP3
   * importer as the "system" actor. No importer wired → throws,
   * which the engine treats as "no media" (see maybeCreateDraft).
   */
  importImage: (organizationId: string, productId: string) => Promise<any> = async (
    organizationId: string,
    productId: string,
  ) => {
    if (!this.importer) throw new Error("SocialImportService is not wired");
    return this.importer.importForProduct(organizationId, "system", productId);
  };

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly events?: EventsService,
    @Optional() private readonly importer?: SocialImportService,
  ) {
    if (this.events) {
      this.events.on("social_draft.product_created", (p) => {
        void this.maybeCreateDraft(p?.organizationId, { kind: "new_product", productId: p?.productId }).catch(() => {});
      });
      this.events.on("social_draft.promotion_activated", (p) => {
        void this.maybeCreateDraft(p?.organizationId, { kind: "sale", promotionId: p?.promotionId }).catch(() => {});
      });
      this.events.on("social_draft.back_in_stock", (p) => {
        void this.maybeCreateDraft(p?.organizationId, { kind: "back_in_stock", productId: p?.productId }).catch(() => {});
      });
      this.events.on("social_draft.review_received", (p) => {
        void this.handleReviewReceived(p).catch(() => {});
      });
    }
  }

  private p(): any {
    return this.prisma as any;
  }

  // ---------- settings ----------

  private serializeSettings(row: any) {
    if (!row) return { ...AUTO_DRAFT_DEFAULTS };
    return {
      newProductEnabled: row.newProductEnabled === true,
      saleEnabled: row.saleEnabled === true,
      backInStockEnabled: row.backInStockEnabled === true,
      reviewMilestoneEnabled: row.reviewMilestoneEnabled === true,
      rssEnabled: row.rssEnabled === true,
      youtubeEnabled: row.youtubeEnabled === true,
      rssFeedUrl: typeof row.rssFeedUrl === "string" ? row.rssFeedUrl : null,
      maxDraftsPerDay:
        Number.isInteger(row.maxDraftsPerDay) && row.maxDraftsPerDay > 0 ? row.maxDraftsPerDay : 3,
      socialAccountId: row.socialAccountId ?? null,
    };
  }

  async getSettings(organizationId: string) {
    const row = await this.p().socialAutoDraftConfig
      ?.findUnique({ where: { organizationId } })
      .catch(() => null);
    return this.serializeSettings(row ?? null);
  }

  async updateSettings(
    organizationId: string,
    actorId: string,
    dto: {
      newProductEnabled?: boolean;
      saleEnabled?: boolean;
      backInStockEnabled?: boolean;
      reviewMilestoneEnabled?: boolean;
      rssEnabled?: boolean;
      youtubeEnabled?: boolean;
      rssFeedUrl?: string | null;
      maxDraftsPerDay?: number;
      socialAccountId?: string | null;
    },
  ) {
    const data: Record<string, unknown> = {};
    for (const field of [
      "newProductEnabled",
      "saleEnabled",
      "backInStockEnabled",
      "reviewMilestoneEnabled",
      "rssEnabled",
      "youtubeEnabled",
    ] as const) {
      if (dto[field] !== undefined) data[field] = dto[field] === true;
    }
    if (dto.rssFeedUrl !== undefined) {
      if (dto.rssFeedUrl === null || dto.rssFeedUrl === "") {
        data.rssFeedUrl = null;
      } else {
        const trimmed = String(dto.rssFeedUrl).trim();
        if (!trimmed) {
          data.rssFeedUrl = null;
        } else {
          let parsed: URL;
          try {
            parsed = new URL(trimmed);
          } catch {
            throw new BadRequestException("RSS Feed URL-টি সঠিক http/https ঠিকানা নয়।");
          }
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            throw new BadRequestException("RSS Feed URL-টি সঠিক http/https ঠিকানা নয়।");
          }
          data.rssFeedUrl = trimmed;
        }
      }
    }
    if (dto.maxDraftsPerDay !== undefined) {
      const cap = Number(dto.maxDraftsPerDay);
      if (!Number.isInteger(cap) || cap < 1 || cap > 20) {
        throw new BadRequestException("প্রতিদিনের সর্বোচ্চ Draft সংখ্যা ১ থেকে ২০-এর মধ্যে হতে হবে।");
      }
      data.maxDraftsPerDay = cap;
    }
    if (dto.socialAccountId !== undefined) {
      if (dto.socialAccountId === null || dto.socialAccountId === "") {
        data.socialAccountId = null;
      } else {
        const account = await this.p().socialAccount.findFirst({
          where: { id: dto.socialAccountId, organizationId, status: "connected" },
        });
        if (!account) {
          throw new BadRequestException("নির্বাচিত Social অ্যাকাউন্টটি এই Organization-এর সংযুক্ত (connected) অ্যাকাউন্ট নয়।");
        }
        data.socialAccountId = dto.socialAccountId;
      }
    }
    const row = await this.p().socialAutoDraftConfig.upsert({
      where: { organizationId },
      update: data,
      create: { organizationId, ...data },
    });
    await this.audit?.log({
      organizationId, userId: actorId, action: "social.auto_draft_settings_updated",
      entityType: "SocialAutoDraftConfig", entityId: row?.id ?? organizationId,
      metadata: { fields: Object.keys(data) },
    }).catch(() => undefined);
    return this.serializeSettings(row);
  }

  // ---------- review event fan-in ----------

  /**
   * A review arrived: count the org's REAL reviews (received
   * OrderReviews + visible ExternalReviews). A total that lands
   * on a multiple of 50 is a milestone (and wins over the 5-star
   * path); otherwise a fresh 5-star review is itself the event.
   * Anything else creates nothing.
   */
  async handleReviewReceived(payload: any): Promise<{ created: boolean; reason?: string; postId?: string }> {
    const organizationId = payload?.organizationId;
    if (!organizationId) return { created: false, reason: "disabled" };
    try {
      const orderReviews = await this.p().orderReview
        .count({ where: { organizationId, rating: { not: null }, receivedAt: { not: null } } })
        .catch(() => 0);
      const externalReviews = (this.p().externalReview?.count
        ? await this.p().externalReview.count({ where: { organizationId, status: "visible" } }).catch(() => 0)
        : 0) as number;
      const total = (Number(orderReviews) || 0) + (Number(externalReviews) || 0);
      if (total > 0 && total % 50 === 0) {
        return this.maybeCreateDraft(organizationId, {
          kind: "review_milestone",
          reviewId: payload?.reviewId,
          orderId: payload?.orderId,
          rating: payload?.rating,
          milestoneTotal: total,
        });
      }
      if (payload?.rating === 5) {
        return this.maybeCreateDraft(organizationId, {
          kind: "review_milestone",
          reviewId: payload?.reviewId,
          orderId: payload?.orderId,
          rating: payload?.rating,
        });
      }
      return { created: false, reason: "no_milestone" };
    } catch {
      return { created: false, reason: "error" };
    }
  }

  // ---------- the engine ----------

  async maybeCreateDraft(
    organizationId: string,
    event: AutoDraftEvent,
  ): Promise<{ created: boolean; reason?: string; postId?: string; mediaAttached?: boolean }> {
    try {
      return await this.createDraftInner(organizationId, event);
    } catch {
      // The engine NEVER throws — see the class docstring.
      return { created: false, reason: "error" };
    }
  }

  private async createDraftInner(
    organizationId: string,
    event: AutoDraftEvent,
  ): Promise<{ created: boolean; reason?: string; postId?: string; mediaAttached?: boolean }> {
    if (!organizationId || !event?.kind) return { created: false, reason: "disabled" };

    // 1) Config + per-kind toggle. No row = everything off.
    const config = await this.p().socialAutoDraftConfig
      ?.findUnique({ where: { organizationId } })
      .catch(() => null);
    if (!config) return { created: false, reason: "disabled" };
    const toggle = TOGGLE_BY_KIND[event.kind];
    if (!toggle || config[toggle] !== true) return { created: false, reason: "disabled" };

    // Idempotency ref (per kind) — computed before the heavier
    // work so a duplicate event exits cheaply.
    let ref: string | null = null;
    if (event.kind === "new_product" || event.kind === "back_in_stock") {
      if (!event.productId) return { created: false, reason: "no_product" };
      ref =
        event.kind === "new_product"
          ? event.productId
          : `${event.productId}:bist:${dhakaDayKey(new Date())}`;
    } else if (event.kind === "sale") {
      if (!event.promotionId) return { created: false, reason: "no_promotion" };
      ref = event.promotionId;
    } else if (event.kind === "review_milestone") {
      if (event.milestoneTotal && event.milestoneTotal > 0) {
        ref = `milestone:${event.milestoneTotal}`;
      } else if (event.rating === 5 && event.reviewId) {
        ref = `review:${event.reviewId}`;
      } else {
        return { created: false, reason: "no_milestone" };
      }
    }
    if (!ref) return { created: false, reason: "disabled" };

    // 4) Idempotency: one draft per ref, ever.
    const duplicate = await this.p().socialPost.findFirst({
      where: { organizationId, autoDraftRef: ref },
    });
    if (duplicate) return { created: false, reason: "duplicate" };

    // 2) Target account: the configured one when it is this
    // org's + connected, else the org's first connected
    // meta_page account.
    let account: any = null;
    if (config.socialAccountId) {
      account = await this.p().socialAccount
        .findFirst({ where: { id: config.socialAccountId, organizationId, status: "connected" } })
        .catch(() => null);
    }
    if (!account) {
      account = await this.p().socialAccount.findFirst({
        where: { organizationId, platform: "meta_page", status: "connected" },
        orderBy: { createdAt: "asc" },
      });
    }
    if (!account) return { created: false, reason: "no_account" };

    // 3) Daily cap (Asia/Dhaka day, auto drafts only).
    const cap =
      Number.isInteger(config.maxDraftsPerDay) && config.maxDraftsPerDay > 0 ? config.maxDraftsPerDay : 3;
    const dayStart = dhakaDayStartUtc(new Date());
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const todayCount = await this.p().socialPost.count({
      where: {
        organizationId,
        autoDraftKind: { not: null },
        createdAt: { gte: dayStart, lt: dayEnd },
      },
    });
    if ((Number(todayCount) || 0) >= cap) return { created: false, reason: "daily_cap" };

    // 5) Grounded caption + the product (when the kind has one).
    let caption: string;
    let product: any = null;
    if (event.kind === "new_product" || event.kind === "back_in_stock") {
      product = await this.p().product.findFirst({
        where: { id: event.productId, organizationId },
      });
      if (!product) return { created: false, reason: "no_product" };
      caption =
        event.kind === "new_product"
          ? `নতুন এসেছে: ${product.name}${priceSuffix(product)}`
          : `আবার স্টকে এসেছে: ${product.name}${priceSuffix(product)}`;
    } else if (event.kind === "sale") {
      const promotion = await this.p().promotion.findFirst({
        where: { id: event.promotionId, organizationId },
      });
      if (!promotion) return { created: false, reason: "no_promotion" };
      const percent = promotionDiscountPercent(promotion);
      caption = `সেল চলছে: ${promotion.name}${percent ? ` — ${percent}% পর্যন্ত ছাড়!` : ""}`;
    } else {
      // review_milestone
      if (event.milestoneTotal && event.milestoneTotal > 0) {
        caption = `আমাদের ${event.milestoneTotal}টি রিভিউ পূর্ণ হলো — আপনাদের ভালোবাসা ও আস্থার জন্য ধন্যবাদ!`;
      } else {
        let quote = "";
        let productName = "";
        const review = event.reviewId
          ? await this.p().orderReview
              ?.findFirst({ where: { id: event.reviewId, organizationId } })
              .catch(() => null)
          : null;
        const text = typeof review?.comment === "string" ? review.comment.trim() : "";
        if (text) quote = ` “${text.slice(0, 120)}”`;
        const orderId = review?.orderId ?? event.orderId;
        if (orderId) {
          product = await this.productForOrder(organizationId, orderId);
          if (product?.name) productName = ` — ${product.name}`;
        }
        caption = `নতুন ৫-তারকা রিভিউ পেয়েছি!${quote}${productName} — ধন্যবাদ!`;
      }
    }

    // 6) Media: the product's real image, imported via PP3. A
    // failed import never blocks the draft — it just goes out
    // text-only, and the outcome reports mediaAttached: false.
    let mediaRefs: { assetId: string; kind: string }[] = [];
    let mediaAttached = false;
    if (product && typeof product.imageUrl === "string" && product.imageUrl.trim()) {
      try {
        const asset = await this.importImage(organizationId, product.id);
        if (asset?.id) {
          mediaRefs = [{ assetId: asset.id, kind: "image" }];
          mediaAttached = true;
        }
      } catch {
        mediaAttached = false;
      }
    }

    // 7) The draft itself. linkUrl stays null by design: there is
    // no storefront base URL to build an absolute link from here,
    // and SocialService.validateLinkUrl requires http(s) — the
    // tracked-link machinery (SU6) owns links. The caption
    // carries the grounded name + price.
    const post = await this.p().socialPost.create({
      data: {
        organizationId,
        socialAccountId: account.id,
        caption,
        linkUrl: null,
        mediaRefs,
        status: "draft",
        autoDraftKind: event.kind,
        autoDraftRef: ref,
        createdById: "system",
      },
    });
    await this.audit
      ?.log({
        organizationId, userId: "system", action: "social.auto_draft_created",
        entityType: "SocialPost", entityId: post.id,
        metadata: { kind: event.kind, ref },
      })
      .catch(() => undefined);
    return { created: true, postId: post.id, mediaAttached };
  }

  /** review → order → first item → product (null at any gap). */
  private async productForOrder(organizationId: string, orderId: string): Promise<any> {
    try {
      const itemTable = this.p().orderItem;
      let item: any = null;
      if (itemTable?.findFirst) {
        item = await itemTable.findFirst({ where: { orderId } }).catch(() => null);
      }
      if (!item?.productId) {
        const order = await this.p().order
          ?.findFirst({ where: { id: orderId, organizationId }, include: { items: true } })
          .catch(() => null);
        item = Array.isArray(order?.items) ? order.items[0] : null;
      }
      if (!item?.productId) return null;
      return await this.p().product
        .findFirst({ where: { id: item.productId, organizationId } })
        .catch(() => null);
    } catch {
      return null;
    }
  }
}
