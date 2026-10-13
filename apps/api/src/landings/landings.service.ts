import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import { BD_DISTRICTS } from "@repo/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorefrontService } from "../storefront/storefront.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { DiscountsService } from "../commerce/discounts.service";
import { DISCOUNT_REASON_MESSAGES } from "../commerce/discounts";
import { PromotionsService, type CheckoutEvaluation } from "../commerce/promotions.service";
import { serializeTaxBreakdown } from "../commerce/tax";
import { assertPreorderLimit, preorderInfo } from "../commerce/ec24";
import type { PromotionLine } from "../commerce/promotions";
import { InventoryService } from "../inventory/inventory.service";
import { AffiliatesService } from "../affiliates/affiliates.service";
import { normalizeSections, validateSections } from "./sections";
import type {
  CreateLandingDto,
  CreateLandingVariantDto,
  LandingEventDto,
  LandingOrderDto,
  UpdateLandingDto,
  UpdateLandingVariantDto,
} from "./landings.dto";

/**
 * Injection token for the EC15 ProductReviewsService. The reviews
 * service is built in parallel (apps/api/src/orders/
 * product-reviews.service.ts) and wired by LandingsModule through
 * a lazy factory — when it is absent (or its call fails) the
 * landing payload serves an honest empty reviews block instead of
 * breaking the page.
 */
export const PRODUCT_REVIEWS_SERVICE = "PRODUCT_REVIEWS_SERVICE";

export interface ProductReviewsLike {
  getPublicProductReviews(
    organizationId: string,
    productId: string,
  ): Promise<{ summary: { average: number | null; count: number }; items: unknown[] }>;
}

export const LANDING_SOURCE = "landing";

/** Order statuses that are still "open" for a post-order upsell
 *  (the open end of the orders.service transition vocabulary:
 *  pending | on-hold | processing — every other status is a
 *  terminal/closed state there). */
export const OPEN_ORDER_STATUSES = ["pending", "processing", "on-hold"] as const;

export const UPSELL_WINDOW_MS = 2 * 3600 * 1000;

const EMPTY_REVIEWS = { summary: { average: null as number | null, count: 0 }, items: [] as unknown[] };

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** FNV-1a 32-bit — small, stable across processes and deploys. */
export function fnv1aHash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Stable A/B assignment: bucket = FNV-1a(visitorToken) % 100,
 * walked over the variants (createdAt order) accumulating
 * `weight`; the first variant whose cumulative weight exceeds the
 * bucket wins. A weight-0 variant can therefore never be picked.
 * When the bucket lands beyond the total weight (weights summing
 * to < 100, or all zero), the control variant — else the first
 * variant — serves. No variants ⇒ null.
 */
export function assignVariant(variants: any[], visitorToken?: string | null): any | null {
  if (!variants?.length) return null;
  const sorted = [...variants].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return ta - tb;
  });
  const bucket = fnv1aHash(visitorToken?.trim() || "anon") % 100;
  let cumulative = 0;
  for (const v of sorted) {
    cumulative += Math.max(0, Number(v.weight ?? 0));
    if (bucket < cumulative) return v;
  }
  return sorted.find((v) => v.isControl) ?? sorted[0];
}

function conversionPct(orders: number, views: number): number | null {
  if (!views) return null;
  return Math.round((orders / views) * 100 * 10) / 10;
}

/**
 * EC13 — Landing Page & Funnel Builder backend.
 *
 * Pricing honesty mirrors the two existing public checkouts:
 *  - the main line is priced server-side from the CURRENT product
 *    / variant rows (variant price wins, exactly like the
 *    storefront quote), never from the client;
 *  - the order bump is added to the subtotal BEFORE coupon
 *    validation, and coupon eligibility sees the product line only
 *    (placePublicOrder semantics);
 *  - delivery comes from ShippingZones when the org has ANY
 *    active zone (matchZone + freeAbove on the discounted
 *    subtotal + free-shipping coupon zeroing, mirroring
 *    StorefrontService.computeQuote); with no active zones it
 *    falls back to the BusinessProfile inside/outside fees exactly
 *    as placePublicOrder computes them.
 * Orders are created through IntegrationsService.upsertOrder with
 * source "landing" and attributed afterwards (landingPageId /
 * landingVariantId) — upsertOrder itself knows nothing of
 * landings.
 */
@Injectable()
export class LandingsService {
  private readonly logger = new Logger(LandingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly storefront?: StorefrontService,
    @Optional() private readonly discounts?: DiscountsService,
    @Optional() private readonly integrations?: IntegrationsService,
    @Optional() private readonly inventory?: InventoryService,
    @Optional()
    @Inject(PRODUCT_REVIEWS_SERVICE)
    private readonly reviews?: ProductReviewsLike | null,
    // EC16: unified promotion/coupon/referral evaluation. LAST
    // param + Optional, same discipline as the other hooks; spec
    // harnesses without it keep the EC7 coupon-only block.
    @Optional() private readonly promotions?: PromotionsService,
    // EC32: affiliate attribution stamp. LAST param + Optional,
    // same discipline; the stamp itself never throws.
    @Optional() private readonly affiliates?: AffiliatesService,
  ) {}

  private t(name: string): any {
    return (this.prisma as any)[name];
  }

  // ================= shared lookups =================

  private async getLandingOr404(organizationId: string, landingId: string): Promise<any> {
    const landing = await this.t("landingPage").findFirst({
      where: { id: landingId, organizationId },
    });
    if (!landing) throw new NotFoundException("Landing page not found in this organization");
    return landing;
  }

  private async getPublishedLanding(slug: string): Promise<any> {
    const landing = await this.t("landingPage").findFirst({ where: { slug } });
    if (!landing || landing.status !== "published") {
      throw new NotFoundException("ল্যান্ডিং পেজটি পাওয়া যায়নি");
    }
    return landing;
  }

  private async getProductOr404(organizationId: string, productId: string): Promise<any> {
    const p = await this.t("product").findFirst({ where: { id: productId, organizationId } });
    if (!p) throw new NotFoundException("Product not found in this organization");
    return p;
  }

  private async businessProfile(organizationId: string): Promise<any | null> {
    try {
      return await this.t("businessProfile").findFirst({ where: { organizationId } });
    } catch {
      return null;
    }
  }

  /** EC18: the org's merchant-written trust copy from
   * StorefrontSetting. Failure-isolated — a missing table/row
   * degrades to nulls (the web hides empty trust blocks). */
  private async storefrontTrust(
    organizationId: string,
  ): Promise<{ returnPolicyText: string | null; deliveryPromiseText: string | null; supportPhone: string | null }> {
    const empty = { returnPolicyText: null, deliveryPromiseText: null, supportPhone: null };
    try {
      const s = await this.t("storefrontSetting")
        .findFirst({ where: { organizationId } })
        .catch(() => null);
      if (!s) return empty;
      return {
        returnPolicyText: s.returnPolicyText ?? null,
        deliveryPromiseText: s.deliveryPromiseText ?? null,
        supportPhone: s.supportPhone ?? null,
      };
    } catch {
      return empty;
    }
  }

  // ---------- EC18: delivery slots (local equivalents of the
  // storefront helpers; this service already optionally uses
  // StorefrontService for zones, but slot validation stays local
  // so a missing storefront dependency cannot break landings) --

  /** ALL active slots of the org for the public landing payload
   * (the client filters by the shopper's district). */
  private async publicDeliverySlots(organizationId: string): Promise<any[]> {
    try {
      const table = this.t("deliverySlot");
      if (!table?.findMany) return [];
      const rows: any[] =
        (await table.findMany({ where: { organizationId, active: true } }).catch(() => [])) ?? [];
      return rows.map((s: any) => ({
        id: s.id,
        label: s.label,
        startTime: s.startTime,
        endTime: s.endTime,
        districtScope: Array.isArray(s.districtScope) ? s.districtScope.map((d: any) => String(d)) : null,
      }));
    } catch {
      return [];
    }
  }

  private async validateDeliverySlotChoice(
    organizationId: string,
    slotId: string,
    dateStr: string,
    district: string | null,
  ): Promise<any> {
    const table = this.t("deliverySlot");
    const slot = table?.findFirst
      ? await table.findFirst({ where: { id: slotId, organizationId } }).catch(() => null)
      : null;
    if (!slot || slot.active === false) {
      throw new BadRequestException("ডেলিভারি স্লটটি পাওয়া যায়নি বা বন্ধ আছে");
    }
    const scope: string[] = Array.isArray(slot.districtScope) ? slot.districtScope.map((d: any) => String(d)) : [];
    if (scope.length > 0 && (district === null || !scope.includes(district))) {
      throw new BadRequestException("এই স্লটটি আপনার এলাকার জন্য প্রযোজ্য নয়");
    }
    const dateMsg = "ডেলিভারির তারিখ আজ থেকে আগামী ৭ দিনের মধ্যে হতে হবে";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr ?? ""))) {
      throw new BadRequestException(dateMsg);
    }
    const [y, m, d] = dateStr.split("-").map(Number);
    const probe = new Date(Date.UTC(y, m - 1, d));
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
      throw new BadRequestException(dateMsg);
    }
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
    const [ty, tm, td] = today.split("-").map(Number);
    const maxDate = new Date(Date.UTC(ty, tm - 1, td) + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    if (dateStr < today || dateStr > maxDate) {
      throw new BadRequestException(dateMsg);
    }
    if (slot.capacityPerDay !== null && slot.capacityPerDay !== undefined) {
      const orderTable = this.t("order");
      const count = orderTable?.count
        ? await orderTable.count({
            where: {
              organizationId, deliverySlotId: slotId, deliveryDate: dateStr,
              status: { not: "cancelled" },
            },
          }).catch(() => 0)
        : 0;
      if (Number(count) >= Number(slot.capacityPerDay)) {
        throw new BadRequestException("এই স্লটটি পূর্ণ — অন্য স্লট বা তারিখ বেছে নিন");
      }
    }
    return slot;
  }

  private async variantsOf(landingId: string): Promise<any[]> {
    try {
      const rows = await this.t("landingVariant").findMany({
        where: { landingId },
        orderBy: { createdAt: "asc" },
      });
      return rows ?? [];
    } catch {
      return [];
    }
  }

  private serializeVariant(v: any) {
    return {
      id: v.id,
      landingId: v.landingId,
      name: v.name,
      isControl: !!v.isControl,
      weight: v.weight ?? 100,
      headline: v.headline ?? null,
      heroImageUrl: v.heroImageUrl ?? null,
      ctaText: v.ctaText ?? null,
      showCompareAt: v.showCompareAt !== false,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
    };
  }

  private serializeLanding(landing: any, variants?: any[]) {
    return {
      id: landing.id,
      organizationId: landing.organizationId,
      productId: landing.productId,
      slug: landing.slug,
      title: landing.title,
      status: landing.status,
      sections: landing.sections ?? null,
      upsellProductId: landing.upsellProductId ?? null,
      createdAt: landing.createdAt,
      updatedAt: landing.updatedAt,
      ...(variants ? { variants: variants.map((v) => this.serializeVariant(v)) } : {}),
    };
  }

  private async assertSlugAvailable(slug: string, exceptLandingId?: string): Promise<void> {
    const existing = await this.t("landingPage").findFirst({ where: { slug } });
    if (existing && existing.id !== exceptLandingId) {
      throw new ConflictException(`A landing page with slug "${slug}" already exists`);
    }
  }

  private validateSlug(slug: string): string {
    const s = slug.trim();
    if (!SLUG_PATTERN.test(s)) {
      throw new BadRequestException(
        "slug অবশ্যই URL-বান্ধব হতে হবে (ছোট হাতের অক্ষর, সংখ্যা ও হাইফেন)",
      );
    }
    return s;
  }

  private async generateSlug(title: string): Promise<string> {
    const base = slugify(title) || "landing";
    for (let attempt = 0; attempt < 5; attempt++) {
      const suffix =
        attempt === 0
          ? Math.random().toString(36).substring(2, 6)
          : randomUUID().replace(/-/g, "").slice(0, 6);
      const candidate = `${base}-${suffix}`;
      const clash = await this.t("landingPage").findFirst({ where: { slug: candidate } });
      if (!clash) return candidate;
    }
    return `${base}-${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  }

  private validateStatus(status: string): string {
    if (!["draft", "published", "archived"].includes(status)) {
      throw new BadRequestException(`অজানা landing status: ${status}`);
    }
    return status;
  }

  private validateWeight(weight: unknown): number {
    const w = weight === undefined || weight === null ? 100 : Number(weight);
    if (!Number.isInteger(w) || w < 0 || w > 100) {
      throw new BadRequestException("weight অবশ্যই ০ থেকে ১০০-এর মধ্যে পূর্ণসংখ্যা হতে হবে");
    }
    return w;
  }

  // ================= Staff: CRUD =================

  async create(organizationId: string, actorId: string, dto: CreateLandingDto) {
    await this.getProductOr404(organizationId, dto.productId);
    if (dto.upsellProductId) {
      await this.getProductOr404(organizationId, dto.upsellProductId);
    }
    const slug = dto.slug?.trim()
      ? this.validateSlug(dto.slug)
      : await this.generateSlug(dto.title);
    if (dto.slug?.trim()) await this.assertSlugAvailable(slug);
    const status = dto.status ? this.validateStatus(dto.status) : "draft";
    const sections =
      dto.sections !== undefined && dto.sections !== null
        ? validateSections(dto.sections)
        : null;

    const landing = await this.t("landingPage").create({
      data: {
        organizationId,
        productId: dto.productId,
        slug,
        title: dto.title.trim(),
        status,
        sections,
        upsellProductId: dto.upsellProductId ?? null,
      },
    });
    await this.audit?.log({
      organizationId,
      userId: actorId,
      action: "landing.create",
      entityType: "LandingPage",
      entityId: landing.id,
      metadata: { productId: landing.productId, slug: landing.slug },
    });
    return this.serializeLanding(landing, []);
  }

  async list(organizationId: string) {
    const landings: any[] =
      (await this.t("landingPage").findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
      })) ?? [];
    const items = [];
    for (const landing of landings) {
      const product = await this.t("product")
        .findFirst({ where: { id: landing.productId, organizationId } })
        .catch(() => null);
      // Light aggregates: order count + revenue from attributed
      // Order rows (findMany scan — the fake-prisma spec style has
      // no groupBy; landing counts per org stay small).
      const orders: any[] =
        (await this.t("order").findMany({
          where: { organizationId, landingPageId: landing.id },
        }).catch(() => [])) ?? [];
      const revenue = orders.reduce((sum, o) => sum + BigInt(o.totalMinor ?? 0), 0n);
      items.push({
        ...this.serializeLanding(landing),
        productName: product?.name ?? null,
        orders: orders.length,
        orderCount: orders.length,
        revenueMinor: revenue.toString(),
      });
    }
    return { total: items.length, items };
  }

  async getOne(organizationId: string, landingId: string) {
    const landing = await this.getLandingOr404(organizationId, landingId);
    return this.serializeLanding(landing, await this.variantsOf(landingId));
  }

  async update(organizationId: string, actorId: string, landingId: string, dto: UpdateLandingDto) {
    const landing = await this.getLandingOr404(organizationId, landingId);
    const data: Record<string, any> = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.status !== undefined) data.status = this.validateStatus(dto.status);
    if (dto.slug !== undefined) {
      const slug = this.validateSlug(dto.slug);
      await this.assertSlugAvailable(slug, landingId);
      data.slug = slug;
    }
    if (dto.upsellProductId !== undefined) {
      if (dto.upsellProductId === null) {
        data.upsellProductId = null;
      } else {
        await this.getProductOr404(organizationId, dto.upsellProductId);
        data.upsellProductId = dto.upsellProductId;
      }
    }
    if (dto.sections !== undefined) {
      data.sections = dto.sections === null ? null : validateSections(dto.sections);
    }
    const saved = await this.t("landingPage").update({ where: { id: landing.id }, data });
    await this.audit?.log({
      organizationId,
      userId: actorId,
      action: "landing.update",
      entityType: "LandingPage",
      entityId: landingId,
      metadata: { fields: Object.keys(data) },
    });
    return this.serializeLanding(saved, await this.variantsOf(landingId));
  }

  /**
   * DELETE is an ARCHIVE, not a hard delete: Orders carry
   * landingPageId attribution, and hard-deleting the landing
   * would orphan the funnel history those orders point at. The
   * row stays, status becomes "archived", and public routes 404
   * it (published-only) exactly like a draft.
   */
  async archive(organizationId: string, actorId: string, landingId: string) {
    const landing = await this.getLandingOr404(organizationId, landingId);
    const saved = await this.t("landingPage").update({
      where: { id: landing.id },
      data: { status: "archived" },
    });
    await this.audit?.log({
      organizationId,
      userId: actorId,
      action: "landing.archive",
      entityType: "LandingPage",
      entityId: landingId,
    });
    return { ...this.serializeLanding(saved), archived: true };
  }

  // ================= Staff: variants =================

  private async clearOtherControls(landingId: string, exceptVariantId: string): Promise<void> {
    const rows = await this.variantsOf(landingId);
    for (const v of rows) {
      if (v.id !== exceptVariantId && v.isControl) {
        await this.t("landingVariant").update({
          where: { id: v.id },
          data: { isControl: false },
        });
      }
    }
  }

  async createVariant(
    organizationId: string,
    actorId: string,
    landingId: string,
    dto: CreateLandingVariantDto,
  ) {
    const landing = await this.getLandingOr404(organizationId, landingId);
    const variant = await this.t("landingVariant").create({
      data: {
        landingId: landing.id,
        name: dto.name.trim(),
        isControl: !!dto.isControl,
        weight: this.validateWeight(dto.weight),
        headline: dto.headline ?? null,
        heroImageUrl: dto.heroImageUrl ?? null,
        ctaText: dto.ctaText ?? null,
        showCompareAt: dto.showCompareAt ?? true,
      },
    });
    if (variant.isControl) await this.clearOtherControls(landing.id, variant.id);
    await this.audit?.log({
      organizationId,
      userId: actorId,
      action: "landing.variant.create",
      entityType: "LandingVariant",
      entityId: variant.id,
      metadata: { landingId },
    });
    return this.serializeVariant(variant);
  }

  private async getVariantOr404(landingId: string, variantId: string): Promise<any> {
    const variant = await this.t("landingVariant").findFirst({
      where: { id: variantId, landingId },
    });
    if (!variant) throw new NotFoundException("Variant not found for this landing page");
    return variant;
  }

  async updateVariant(
    organizationId: string,
    actorId: string,
    landingId: string,
    variantId: string,
    dto: UpdateLandingVariantDto,
  ) {
    await this.getLandingOr404(organizationId, landingId);
    const variant = await this.getVariantOr404(landingId, variantId);
    const data: Record<string, any> = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.isControl !== undefined) data.isControl = !!dto.isControl;
    if (dto.weight !== undefined) data.weight = this.validateWeight(dto.weight);
    if (dto.headline !== undefined) data.headline = dto.headline;
    if (dto.heroImageUrl !== undefined) data.heroImageUrl = dto.heroImageUrl;
    if (dto.ctaText !== undefined) data.ctaText = dto.ctaText;
    if (dto.showCompareAt !== undefined) data.showCompareAt = !!dto.showCompareAt;
    const saved = await this.t("landingVariant").update({ where: { id: variant.id }, data });
    if (saved.isControl) await this.clearOtherControls(landingId, variantId);
    await this.audit?.log({
      organizationId,
      userId: actorId,
      action: "landing.variant.update",
      entityType: "LandingVariant",
      entityId: variantId,
      metadata: { landingId },
    });
    return this.serializeVariant(saved);
  }

  async deleteVariant(
    organizationId: string,
    actorId: string,
    landingId: string,
    variantId: string,
  ) {
    await this.getLandingOr404(organizationId, landingId);
    const variant = await this.getVariantOr404(landingId, variantId);
    await this.t("landingVariant").delete({ where: { id: variant.id } });
    await this.audit?.log({
      organizationId,
      userId: actorId,
      action: "landing.variant.delete",
      entityType: "LandingVariant",
      entityId: variantId,
      metadata: { landingId },
    });
    return { deleted: true, landingId, variantId };
  }

  // ================= Staff: stats =================

  async stats(organizationId: string, landingId: string) {
    const landing = await this.getLandingOr404(organizationId, landingId);
    const events: any[] =
      (await this.t("landingEvent").findMany({ where: { landingId: landing.id } }).catch(() => [])) ?? [];
    const orders: any[] =
      (await this.t("order").findMany({
        where: { organizationId, landingPageId: landing.id },
      }).catch(() => [])) ?? [];
    const views = events.filter((e) => e.kind === "view").length;
    const checkoutStarted = events.filter((e) => e.kind === "checkout_started").length;
    const revenue = orders.reduce((sum, o) => sum + BigInt(o.totalMinor ?? 0), 0n);

    const variants = [];
    for (const v of await this.variantsOf(landing.id)) {
      const vViews = events.filter((e) => e.kind === "view" && e.variantId === v.id).length;
      const vOrders = orders.filter((o) => o.landingVariantId === v.id);
      const vRevenue = vOrders.reduce((sum, o) => sum + BigInt(o.totalMinor ?? 0), 0n);
      variants.push({
        variantId: v.id,
        name: v.name,
        views: vViews,
        orders: vOrders.length,
        revenueMinor: vRevenue.toString(),
        conversionPct: conversionPct(vOrders.length, vViews),
      });
    }

    return {
      landingId: landing.id,
      views,
      checkoutStarted,
      orders: orders.length,
      revenueMinor: revenue.toString(),
      conversionPct: conversionPct(orders.length, views),
      variants,
    };
  }

  // ================= Public: payload =================

  private async hasActiveZones(organizationId: string): Promise<boolean> {
    try {
      const zones = await this.t("shippingZone").findMany({
        where: { organizationId, active: true },
      });
      return (zones ?? []).length > 0;
    } catch {
      return false;
    }
  }

  private async reviewsFor(organizationId: string, productId: string) {
    if (!this.reviews) return EMPTY_REVIEWS;
    try {
      const r = await this.reviews.getPublicProductReviews(organizationId, productId);
      return {
        summary: {
          average: r?.summary?.average ?? null,
          count: r?.summary?.count ?? 0,
        },
        items: Array.isArray(r?.items) ? r.items : [],
      };
    } catch (e) {
      // Fail-safe by contract: reviews must never break a landing.
      this.logger.warn(
        `product reviews failed for product ${productId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return EMPTY_REVIEWS;
    }
  }

  async getPublicLanding(slug: string, visitorToken?: string) {
    const landing = await this.getPublishedLanding(slug);
    const organizationId = landing.organizationId;

    const p = await this.t("product").findFirst({
      where: { id: landing.productId, organizationId, status: "ACTIVE" },
    });
    if (!p) throw new NotFoundException("ল্যান্ডিং পেজটি পাওয়া যায়নি");

    const org = await this.t("organization")
      .findFirst({ where: { id: organizationId } })
      .catch(() => null);
    const bp = await this.businessProfile(organizationId);
    const trust = await this.storefrontTrust(organizationId);

    const productVariants: any[] =
      (await this.t("productVariant")
        .findMany({ where: { productId: p.id }, orderBy: { createdAt: "asc" } })
        .catch(() => [])) ?? [];
    const images: any[] =
      (await this.t("productImage")
        .findMany({ where: { productId: p.id }, orderBy: { position: "asc" } })
        .catch(() => [])) ?? [];
    const galleryUrls = images.map((i: any) => i.url).filter(Boolean);

    const landingVariants = await this.variantsOf(landing.id);
    const assigned = assignVariant(landingVariants, visitorToken);

    let upsell: any = null;
    if (landing.upsellProductId) {
      const up = await this.t("product")
        .findFirst({
          where: { id: landing.upsellProductId, organizationId, status: "ACTIVE" },
        })
        .catch(() => null);
      if (up) {
        upsell = {
          productId: up.id,
          name: up.name,
          priceMinor: BigInt(up.priceMinor).toString(),
          imageUrl: up.imageUrl ?? null,
        };
      }
    }

    let sections;
    try {
      sections = normalizeSections(landing.sections).filter((s) => s.enabled);
    } catch {
      sections = normalizeSections(null);
    }

    return {
      landing: { id: landing.id, slug: landing.slug, title: landing.title },
      product: {
        id: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description ?? null,
        category: p.category ?? null,
        imageUrl: p.imageUrl ?? null,
        images: galleryUrls.length ? galleryUrls : p.imageUrl ? [p.imageUrl] : [],
        priceMinor: BigInt(p.priceMinor).toString(),
        compareAtMinor: p.compareAtMinor != null ? BigInt(p.compareAtMinor).toString() : null,
        stockQuantity: p.stockQuantity ?? null,
        // EC24a: public pre-order info (null when not preorder).
        preorder: preorderInfo(p),
        // EC24b: ONLY the flag — the file URL is never public.
        digital: !!p.digital,
        bumpTitle: p.bumpTitle || null,
        bumpPriceMinor: p.bumpPriceMinor != null ? BigInt(p.bumpPriceMinor).toString() : null,
        bumpImageUrl: p.bumpImageUrl || null,
        variants: productVariants.map((v: any) => ({
          id: v.id,
          name: v.name,
          sku: v.sku ?? null,
          priceMinor: v.priceMinor != null ? BigInt(v.priceMinor).toString() : null,
          stockQuantity: v.stockQuantity ?? null,
        })),
      },
      organization: {
        name: org?.name ?? null,
        // EC18: slug powers the success-screen tracking link;
        // trust fields are the merchant's own StorefrontSetting
        // copy (null = the web hides the block, never a placeholder).
        slug: org?.slug ?? null,
        metaPixelId: bp?.metaPixelId || null,
        tikTokPixelId: bp?.tikTokPixelId || null,
        returnPolicyText: trust.returnPolicyText,
        deliveryPromiseText: trust.deliveryPromiseText,
        supportPhone: trust.supportPhone,
      },
      sections,
      variant: assigned
        ? {
            id: assigned.id,
            isControl: !!assigned.isControl,
            headline: assigned.headline ?? null,
            heroImageUrl: assigned.heroImageUrl ?? null,
            ctaText: assigned.ctaText ?? null,
            showCompareAt: assigned.showCompareAt !== false,
          }
        : null,
      upsell,
      reviews: await this.reviewsFor(organizationId, p.id),
      districts: [...BD_DISTRICTS],
      delivery: { hasZones: await this.hasActiveZones(organizationId) },
      // EC18: all active slots; the client filters by district.
      deliverySlots: await this.publicDeliverySlots(organizationId),
    };
  }

  // ================= Public: events =================

  async recordEvent(slug: string, kind: "view" | "checkout_started", dto: LandingEventDto) {
    const landing = await this.getPublishedLanding(slug);
    let variantId: string | null = null;
    if (dto.variantId) {
      const variant = await this.t("landingVariant")
        .findFirst({ where: { id: dto.variantId, landingId: landing.id } })
        .catch(() => null);
      variantId = variant?.id ?? null;
    }
    await this.t("landingEvent").create({
      data: { landingId: landing.id, variantId, kind },
    });
    return { ok: true };
  }

  // ================= Public: order =================

  async placeOrder(slug: string, dto: LandingOrderDto) {
    const landing = await this.getPublishedLanding(slug);
    const organizationId = landing.organizationId;

    const p = await this.t("product").findFirst({
      where: { id: landing.productId, organizationId, status: "ACTIVE" },
    });
    if (!p) throw new NotFoundException("Product is unavailable or out of stock");

    const qty = Math.max(1, dto.quantity ?? 1);
    // EC24a: preorder-enabled products pass at zero stock; only
    // the open-unit limit can refuse (before any order is written).
    await assertPreorderLimit(this.prisma, organizationId, p, qty);

    // Variant pricing mirrors the storefront quote: a chosen
    // variant must belong to this product, and its price wins
    // over the product price when set.
    let productVariant: any = null;
    if (dto.variantId) {
      productVariant = await this.t("productVariant").findFirst({
        where: { id: dto.variantId, productId: p.id },
      });
      if (!productVariant) {
        throw new BadRequestException("ভ্যারিয়েন্টটি এই পণ্যের নয়");
      }
    }
    const unitPriceMinor =
      productVariant?.priceMinor != null ? BigInt(productVariant.priceMinor) : BigInt(p.priceMinor);
    let subtotal = unitPriceMinor * BigInt(qty);

    const items: any[] = [
      {
        name: p.name,
        sku: productVariant?.sku || p.sku || undefined,
        quantity: qty,
        priceMinor: unitPriceMinor,
        totalMinor: unitPriceMinor * BigInt(qty),
        // EC24a: any order of a preorder-enabled product is a preorder line.
        isPreorder: !!p.preorderEnabled,
      },
    ];

    // 1-click order bump — identical to placePublicOrder: added
    // to the subtotal BEFORE coupon validation.
    if (dto.includeBump && p.bumpPriceMinor && p.bumpTitle) {
      const bumpPrice = BigInt(p.bumpPriceMinor);
      subtotal += bumpPrice;
      items.push({
        name: `[Special Add-On] ${p.bumpTitle}`,
        sku: "ADD-ON-BUMP",
        quantity: 1,
        priceMinor: bumpPrice,
        totalMinor: bumpPrice,
      });
    }

    // Discounts — with the EC16 service present this is the ONE
    // unified evaluation (promotions → coupon → referral);
    // without it the EC7 coupon-only block below runs unchanged.
    let discountMinor = 0n;
    let freeShippingApplied = false;
    let appliedDiscountId: string | null = null;
    let ec16Evaluation: CheckoutEvaluation | null = null;
    const bumpMinorForEval =
      dto.includeBump && p.bumpPriceMinor && p.bumpTitle ? BigInt(p.bumpPriceMinor) : 0n;
    if (this.promotions) {
      ec16Evaluation = await this.promotions.evaluateCheckout(organizationId, {
        lines: [
          {
            productId: p.id,
            categoryId: (p as any).categoryId ?? null,
            quantity: qty,
            unitPriceMinor,
            compareAtMinor: (p as any).compareAtMinor != null ? BigInt((p as any).compareAtMinor) : null,
          },
        ],
        bumpMinor: bumpMinorForEval,
        couponCode: dto.couponCode ?? null,
        referralCode: dto.referralCode ?? null,
        buyerPhone: dto.customerPhone,
      });
      discountMinor = ec16Evaluation.totalDiscountMinor;
      freeShippingApplied = ec16Evaluation.couponFreeShipping;
      appliedDiscountId = ec16Evaluation.appliedDiscountId;
    } else if (dto.couponCode?.trim()) {
      if (!this.discounts) {
        throw new BadRequestException("কুপন সুবিধা এই deployment-এ নেই");
      }
      const v = await this.discounts.validateForCheckout(organizationId, dto.couponCode, {
        subtotalMinor: subtotal,
        items: [
          {
            productId: p.id,
            categoryId: (p as any).categoryId ?? null,
            totalMinor: unitPriceMinor * BigInt(qty),
          },
        ],
      });
      if (!v.valid) {
        throw new BadRequestException(
          `কুপন প্রয়োগ করা যায়নি: ${DISCOUNT_REASON_MESSAGES[v.reason ?? ""] ?? v.reason}`,
        );
      }
      discountMinor = v.discountMinor;
      freeShippingApplied = v.freeShipping;
      appliedDiscountId = v.discount?.id ?? null;
    }

    // Delivery: zones when the org has ANY active ShippingZone,
    // else the BusinessProfile inside/outside fees exactly as
    // placePublicOrder computes them.
    let shippingMinor: bigint;
    // EC30: pricing provenance of the zone branch, stamped onto
    // the order after the upsert (null on the BusinessProfile
    // branch, where no zone/rule priced the delivery).
    let deliveryStamp: { zoneFreeShipping: boolean; zoneId: string; rateRuleId: string | null } | null = null;
    if (await this.hasActiveZones(organizationId)) {
      const district = dto.district?.trim();
      if (!district) {
        throw new BadRequestException("ডেলিভারি জোন নির্ধারণে আপনার জেলা দিতে হবে");
      }
      if (!this.storefront) {
        throw new InternalServerErrorException("Delivery zones are unavailable (storefront service missing)");
      }
      const zone = await this.storefront.matchZone(organizationId, district);
      if (!zone) {
        throw new BadRequestException(
          "এই এলাকায় ডেলিভারি সেট করা নেই — অন্য জেলা বেছে নিন অথবা দোকানে যোগাযোগ করুন",
        );
      }
      const discountedSubtotal = subtotal - discountMinor;
      // EC30: the charge resolves through the ONE storefront
      // pricing path (weight rate rules + free-above). The
      // landing's single product gives the cart weight directly:
      // weightGrams × qty, or null (unknown) when the product
      // carries no weight — a weight is never invented. Older
      // spec harnesses may carry a storefront fake without
      // resolveDeliveryCharge; only then fall back to the legacy
      // flat + free-above math.
      const weightGrams = p.weightGrams != null ? Number(p.weightGrams) * qty : null;
      const resolver = (this.storefront as any)?.resolveDeliveryCharge;
      let res: { deliveryMinor: bigint; rateRuleId: string | null; zoneFreeShipping: boolean };
      if (typeof resolver === "function") {
        res = await resolver.call(this.storefront, organizationId, zone, {
          weightGrams,
          discountedSubtotal,
        });
      } else {
        const free =
          zone.freeAboveMinor != null && discountedSubtotal >= BigInt(zone.freeAboveMinor);
        res = {
          deliveryMinor: free ? 0n : BigInt(zone.chargeMinor ?? 0),
          rateRuleId: null,
          zoneFreeShipping: free,
        };
      }
      shippingMinor = res.deliveryMinor;
      deliveryStamp = { zoneFreeShipping: res.zoneFreeShipping, zoneId: zone.id, rateRuleId: res.rateRuleId };
      if (freeShippingApplied) shippingMinor = 0n;
    } else {
      const bp = await this.businessProfile(organizationId);
      const isOutside = dto.deliveryZone === "outside_dhaka";
      shippingMinor = isOutside
        ? ((bp as any)?.deliveryChargeOutsideMinor ?? 12000n)
        : ((bp as any)?.deliveryChargeInsideMinor ?? 6000n);
      if (freeShippingApplied) shippingMinor = 0n;
    }

    // EC18: a chosen slot is validated after pricing, BEFORE
    // the order write — a refusal means no order. The scope
    // district is the landing's district field (null when absent).
    let chosenSlot: any = null;
    if (dto.deliverySlotId || dto.deliveryDate) {
      if (!dto.deliverySlotId || !dto.deliveryDate) {
        throw new BadRequestException("স্লট বেছে নিলে তারিখও দিতে হবে");
      }
      chosenSlot = await this.validateDeliverySlotChoice(
        organizationId, dto.deliverySlotId, dto.deliveryDate, dto.district?.trim() || null,
      );
    }

    // EC23: exclusive VAT grows the total; inclusive adds nothing.
    const total = subtotal - discountMinor + shippingMinor + (ec16Evaluation?.taxAddedMinor ?? 0n);
    const externalId = `landing-${randomUUID()}`;
    const externalNumber = `ORD-${Date.now().toString().slice(-6)}-${randomBytes(2).toString("hex").toUpperCase()}`;
    const cleanPhone = dto.customerPhone.trim();
    const isCod = dto.paymentMethod !== "bkash" && dto.paymentMethod !== "nagad";

    if (!this.integrations) {
      throw new InternalServerErrorException("Checkout ordering is unavailable (integrations service missing)");
    }
    await this.integrations.upsertOrder(
      organizationId,
      null,
      {
        externalId,
        externalNumber,
        status: "processing",
        paymentMethod: dto.paymentMethod || "cod",
        isCod,
        currency: p.currency || "BDT",
        subtotalMinor: subtotal,
        shippingMinor,
        discountMinor,
        taxMinor: ec16Evaluation?.taxMinor ?? 0n,
        totalMinor: total,
        refundedMinor: 0n,
        placedAt: new Date(),
        customer: {
          externalId: cleanPhone,
          firstName: dto.customerName.trim(),
          phone: cleanPhone,
          address: {
            address_1: dto.customerAddress.trim(),
            ...(dto.district?.trim() ? { district: dto.district.trim() } : {}),
            note: dto.note || undefined,
          },
        },
        items,
      } as any,
      LANDING_SOURCE,
    );

    // Attribution: fetch the created order and stamp it. The
    // served variant counts only when it belongs to THIS landing.
    let orderId: string | null = null;
    try {
      const order = await this.t("order").findFirst({
        where: { organizationId, source: LANDING_SOURCE, externalId },
      });
      if (order) {
        orderId = order.id;
        let landingVariantId: string | null = null;
        if (dto.servedVariantId) {
          const served = await this.t("landingVariant")
            .findFirst({ where: { id: dto.servedVariantId, landingId: landing.id } })
            .catch(() => null);
          landingVariantId = served?.id ?? null;
        }
        await this.t("order").update({
          where: { id: order.id },
          data: {
            landingPageId: landing.id,
            landingVariantId,
            // EC18: the slot stamp rides the same attribution update.
            ...(chosenSlot ? { deliverySlotId: chosenSlot.id, deliveryDate: dto.deliveryDate } : {}),
            // EC16: the promotion/referral split rides it too.
            ...(ec16Evaluation
              ? {
                  promotionDiscountMinor: ec16Evaluation.promotionDiscountMinor,
                  promotionsApplied:
                    ec16Evaluation.promotionsApplied.length > 0
                      ? ec16Evaluation.promotionsApplied.map((x) => ({
                          ...x,
                          amountMinor: x.amountMinor.toString(),
                        }))
                      : null,
                  referralDiscountMinor: ec16Evaluation.referralDiscountMinor,
                  referralCode: ec16Evaluation.referralCodeToRecord,
                  // EC23: per-rate tax snapshot (amounts as strings).
                  taxBreakdown:
                    ec16Evaluation.taxBreakdown && ec16Evaluation.taxBreakdown.length > 0
                      ? serializeTaxBreakdown(ec16Evaluation.taxBreakdown)
                      : null,
                }
              : {}),
          },
        });
        // EC30: stamp the delivery pricing provenance (the
        // shipping money itself already rides shippingMinor).
        if (deliveryStamp) {
          await this.t("order")
            .update({
              where: { id: order.id },
              data: {
                freeShippingApplied: deliveryStamp.zoneFreeShipping,
                freeShippingZoneId: deliveryStamp.zoneFreeShipping ? deliveryStamp.zoneId : null,
                shippingRateRuleId: deliveryStamp.rateRuleId,
              },
            })
            .catch(() => undefined);
        }
      }
    } catch (e) {
      this.logger.warn(
        `landing attribution failed for ${externalId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // EC32: stamp affiliate attribution (failure-isolated
    // inside AffiliatesService.stampAttribution).
    if (this.affiliates) {
      await this.affiliates.stampAttribution(organizationId, LANDING_SOURCE, externalId, dto.affiliateCode, cleanPhone);
    }

    // Coupon redemption after a successful order write; failure
    // is log-only and never fails a placed order.
    if (appliedDiscountId && this.discounts) {
      await this.discounts.redeem(organizationId, appliedDiscountId).catch((e) => {
        this.logger.warn(
          `coupon redeem failed for discount ${appliedDiscountId}: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
    }

    // EC16: the buyer's OWN referral code to share (additive,
    // failure-isolated; null when unresolvable).
    const yourReferralCode = this.promotions
      ? await this.promotions.yourReferralCodeForPhone(organizationId, cleanPhone)
      : null;

    return {
      success: true,
      orderId,
      orderNumber: externalNumber,
      productName: p.name,
      totals: {
        subtotalMinor: subtotal.toString(),
        discountMinor: discountMinor.toString(),
        shippingMinor: shippingMinor.toString(),
        totalMinor: total.toString(),
        // COD: the full total is the cash due on delivery.
        codDueMinor: total.toString(),
      },
      // EC16: promotion + referral split for the success screen.
      promotionDiscountMinor: (ec16Evaluation?.promotionDiscountMinor ?? 0n).toString(),
      promotionsApplied: (ec16Evaluation?.promotionsApplied ?? []).map((x) => ({
        promotionId: x.promotionId,
        name: x.name,
        type: x.type,
        amountMinor: x.amountMinor.toString(),
      })),
      referralDiscountMinor: (ec16Evaluation?.referralDiscountMinor ?? 0n).toString(),
      referral: ec16Evaluation?.referral ? { code: ec16Evaluation.referral.code } : null,
      yourReferralCode,
      upsellEligible: !!landing.upsellProductId,
      // EC24b: success screen shows the digital-delivery note.
      hasDigitalItems: !!p.digital,
    };
  }

  // ================= Public: post-order upsell =================

  /**
   * One-click post-order upsell: appends ONE unit of the landing's
   * upsell product to a fresh landing order.
   *
   * Stock-failure choice (documented): the stock step runs FIRST,
   * through InventoryService.applyOrderPlaced — the lowest-level
   * honest order-placed primitive (tracked rows decrement with a
   * StockMovement ledger entry; untracked rows are skipped by
   * design; the call is idempotent per order+product+variant).
   * If that step THROWS, the upsell aborts with 400 and NO order
   * item is written — we never promise a line whose stock
   * bookkeeping failed. The inverse risk (stock moved, then the
   * item write fails) is a plain DB write on the same database
   * right after, and the movement's idempotency key makes a retry
   * safe.
   */
  async addUpsell(slug: string, orderId: string) {
    const landing = await this.t("landingPage").findFirst({ where: { slug } });
    if (!landing) throw new NotFoundException("ল্যান্ডিং পেজটি পাওয়া যায়নি");

    const order = await this.t("order").findFirst({ where: { id: orderId } });
    if (!order) {
      throw new BadRequestException("অর্ডারটি পাওয়া যায়নি");
    }
    if (order.landingPageId !== landing.id) {
      throw new BadRequestException("এই অর্ডারটি এই ল্যান্ডিং পেজ থেকে আসেনি");
    }
    if (order.organizationId !== landing.organizationId) {
      throw new BadRequestException("অর্ডারটি এই ল্যান্ডিং পেজের সংস্থার নয়");
    }
    if (!OPEN_ORDER_STATUSES.includes(order.status)) {
      throw new BadRequestException(
        `অর্ডারটি এখন "${order.status}" অবস্থায় আছে — আপসেল শুধু খোলা (pending/processing/on-hold) অর্ডারে যোগ করা যায়`,
      );
    }
    const fulfillments: any[] =
      (await this.t("fulfillment")
        ?.findMany({ where: { orderId: order.id } })
        .catch(() => [])) ?? [];
    if (fulfillments.length > 0) {
      throw new BadRequestException("অর্ডারটির ফুলফিলমেন্ট শুরু হয়ে গেছে — এখন আপসেল যোগ করা যাবে না");
    }
    const placedAt = order.placedAt ?? order.createdAt;
    if (placedAt && Date.now() - new Date(placedAt).getTime() > UPSELL_WINDOW_MS) {
      throw new BadRequestException("আপসেলের সময়সীমা (২ ঘণ্টা) পার হয়ে গেছে");
    }
    if (!landing.upsellProductId) {
      throw new BadRequestException("এই ল্যান্ডিং পেজে কোনো আপসেল পণ্য সেট করা নেই");
    }
    const upsellProduct = await this.t("product").findFirst({
      where: { id: landing.upsellProductId, organizationId: landing.organizationId },
    });
    if (!upsellProduct || upsellProduct.status !== "ACTIVE") {
      throw new BadRequestException("আপসেল পণ্যটি এখন পাওয়া যাচ্ছে না");
    }
    const existingItems: any[] =
      (await this.t("orderItem").findMany({ where: { orderId: order.id } }).catch(() => [])) ?? [];
    if (existingItems.some((i) => i.productId === upsellProduct.id)) {
      throw new BadRequestException("এই আপসেল পণ্যটি ইতিমধ্যে অর্ডারে যোগ করা হয়েছে");
    }

    // Stock FIRST (see the documented choice above).
    if (this.inventory) {
      try {
        await this.inventory.applyOrderPlaced(landing.organizationId, order.id, {
          items: [{ productId: upsellProduct.id, variantId: null, quantity: 1, isPreorder: !!upsellProduct.preorderEnabled }],
          status: order.status,
        });
      } catch (e) {
        this.logger.warn(
          `upsell stock step failed for order ${order.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
        throw new BadRequestException("স্টক আপডেট করা যায়নি — আপসেল যোগ করা হয়নি");
      }
    }

    const lineTotal = BigInt(upsellProduct.priceMinor);
    const item = await this.t("orderItem").create({
      data: {
        orderId: order.id,
        productId: upsellProduct.id,
        name: upsellProduct.name,
        sku: upsellProduct.sku ?? null,
        quantity: 1,
        priceMinor: lineTotal,
        totalMinor: lineTotal,
      },
    });
    const newSubtotal = BigInt(order.subtotalMinor ?? 0) + lineTotal;
    const newTotal = BigInt(order.totalMinor ?? 0) + lineTotal;
    await this.t("order").update({
      where: { id: order.id },
      data: { subtotalMinor: newSubtotal, totalMinor: newTotal },
    });
    await this.audit?.log({
      organizationId: landing.organizationId,
      action: "landing.upsell_added",
      entityType: "Order",
      entityId: order.id,
      metadata: {
        landingId: landing.id,
        upsellProductId: upsellProduct.id,
        orderItemId: item.id,
        totalMinor: lineTotal.toString(),
      },
    });

    return {
      success: true,
      orderId: order.id,
      totalMinor: newTotal.toString(),
      addedItem: { name: upsellProduct.name, totalMinor: lineTotal.toString() },
    };
  }
}
