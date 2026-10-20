import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
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
import { PromotionsService, type CheckoutEvaluation, type LoyaltyRedeemInput } from "../commerce/promotions.service";
import { LoyaltyService } from "../commerce/loyalty.service";
import { GiftCardsService } from "../commerce/gift-cards.service";
import { PriceListsService, pickGroupPrice } from "../commerce/price-lists.service";
import { serializeTaxBreakdown } from "../commerce/tax";
import { assertPreorderLimit, preorderInfo } from "../commerce/ec24";
import type { PromotionLine } from "../commerce/promotions";
import { InventoryService } from "../inventory/inventory.service";
import { AffiliatesService } from "../affiliates/affiliates.service";
import { BlockedPhoneService } from "../fraud/blocked-phone.service";
import { CheckoutGuardService } from "../fraud/checkout-guard.service";
import { normalizeDeviceHash } from "../fraud/identifier-utils";
import { IdempotencyService } from "../fraud/idempotency.service";
import { evaluateCodRules } from "../fraud/cod-rules";
import { depositFor } from "../fraud/deposit";
import { validateFieldAnswers } from "../storefront/checkout-fields";
import { buildCheckoutTrust, termsRefFor } from "../fraud/checkout-trust";
import { TenantPaymentsService } from "../connections/tenant-payments.service";
import { parseBdAddress } from "../orders/bd-address";
import { bdPhoneMatchKey } from "../orders/phone-utils";
import { normalizeSections, validateSections } from "./sections";
import { conversionRate, twoProportionZTest } from "./significance";
import { displayProductDescription, displayProductName } from "../products/product-display";
import { isOrderLimitBlocked, OrderLimitBlockedError, SHOPPER_ORDER_BLOCK_MESSAGE,} from "../common/plan-limit-checks";
import { normalizeAttribution } from "../common/attribution.dto";
import type {
  CreateLandingDto,
  CreateLandingVariantDto,
  LandingEventDto,
  LandingOrderDto,
  UpdateLandingDto,
  UpdateLandingVariantDto,
} from "./landings.dto";
import { badRequest, conflict, internalError, notFound } from "../i18n/api-exception";

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
    // ON4: checkout blocklist refusal. LAST param + Optional,
    // same discipline; absent keeps checkout exactly as before.
    @Optional() private readonly blockedPhones?: BlockedPhoneService,
    // GB3 (GC8/GC9): checkout gate + idempotency replay. LAST
    // params + Optional, same discipline; absent keeps checkout
    // exactly as before GB3.
    @Optional() private readonly checkoutGuard?: CheckoutGuardService,
    @Optional() private readonly idempotency?: IdempotencyService,
    // GC10: online-payment options + marker validation. LAST
    // param + Optional, same discipline; absent offers none.
    @Optional() private readonly tenantPayments?: TenantPaymentsService,
    // AB1 (AX1): loyalty snapshot + placement-time points spend.
    // LAST param + Optional, same discipline; absent keeps the
    // checkout exactly as before AB1.
    @Optional() private readonly loyalty?: LoyaltyService,
    // AB2 (AX3): gift-card redemption resolution + placement-time
    // balance spend. LAST param + Optional, same discipline;
    // absent keeps the checkout exactly as before AB2.
    @Optional() private readonly giftCards?: GiftCardsService,
    // AB5 (AX7): B2B group price lists as a checkout PRICE
    // SOURCE. LAST param + Optional, same discipline; absent
    // keeps the checkout exactly as before AB5.
    @Optional() private readonly priceLists?: PriceListsService,
  ) {}

  /** GC10: failure-isolated payment options for payloads. */
  private async paymentOptionsFor(orgId: string) {
    if (!this.tenantPayments?.publicPaymentOptions) return { online: [] as any[] };
    return this.tenantPayments.publicPaymentOptions(orgId).catch(() => ({ online: [] as any[] }));
  }

  /** GC10: validate an online selection (400 when not really
   * offered); null when not selected. */
  private async resolveOnlineSelection(orgId: string, dto: LandingOrderDto) {
    if (!dto.onlinePayment) return null;
    if (!this.tenantPayments?.assertPublicPaymentOption) {
      throw badRequest("landings.thisOnlinePaymentOptionIsNot");
    }
    return this.tenantPayments.assertPublicPaymentOption(orgId, dto.onlinePayment);
  }

  /** AB4 (AX5b): the org's ACTIVE custom checkout-field defs,
   * failure-isolated (a missing table reads as no defs). */
  private async loadCheckoutFieldDefs(orgId: string): Promise<any[]> {
    try {
      const table = this.t("checkoutFieldDef");
      if (!table?.findMany) return [];
      return (await table.findMany({ where: { organizationId: orgId, active: true } }).catch(() => [])) ?? [];
    } catch {
      return [];
    }
  }

  private t(name: string): any {
    return (this.prisma as any)[name];
  }

  // ================= shared lookups =================

  private async getLandingOr404(organizationId: string, landingId: string): Promise<any> {
    const landing = await this.t("landingPage").findFirst({
      where: { id: landingId, organizationId },
    });
    if (!landing) throw notFound("landings.landingPageNotFoundInThis");
    return landing;
  }

  private async getPublishedLanding(slug: string): Promise<any> {
    const landing = await this.t("landingPage").findFirst({ where: { slug } });
    if (!landing || landing.status !== "published") {
      throw notFound("landings.theLandingPageWasNotFound");
    }
    return landing;
  }

  private async getProductOr404(organizationId: string, productId: string): Promise<any> {
    const p = await this.t("product").findFirst({ where: { id: productId, organizationId } });
    if (!p) throw notFound("landings.productNotFoundInThisOrganization");
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
  ): Promise<{ returnPolicyText: string | null; deliveryPromiseText: string | null; supportPhone: string | null; locale: string | null }> {
    const empty = { returnPolicyText: null, deliveryPromiseText: null, supportPhone: null, locale: null };
    try {
      const s = await this.t("storefrontSetting")
        .findFirst({ where: { organizationId } })
        .catch(() => null);
      if (!s) return empty;
      return {
        returnPolicyText: s.returnPolicyText ?? null,
        deliveryPromiseText: s.deliveryPromiseText ?? null,
        supportPhone: s.supportPhone ?? null,
        // MB4 (CD-3): the shop locale the web landing page reads
        // defensively (defaults bn when unset).
        locale: s.locale ?? null,
      };
    } catch {
      return empty;
    }
  }

  /** GB3 (GC8): terms trust for this org from the
   * storefrontSetting + shopPage tables. Failure-isolated. */
  private async loadTermsTrust(
    organizationId: string,
  ): Promise<{ required: boolean; ref: string | null; url: string | null; setting: any }> {
    let setting: any = null;
    let page: any = null;
    try {
      setting = await this.t("storefrontSetting")
        .findFirst({ where: { organizationId } })
        .catch(() => null);
    } catch { setting = null; }
    try {
      const pTable = this.t("shopPage");
      page = pTable?.findFirst
        ? await pTable
            .findFirst({ where: { organizationId, slug: "terms", published: true } })
            .catch(() => null)
        : null;
    } catch { page = null; }
    const t = termsRefFor(setting, page);
    return { required: t.required, ref: t.ref, url: t.url, setting };
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
      throw badRequest("landings.theDeliverySlotWasNotFound");
    }
    const scope: string[] = Array.isArray(slot.districtScope) ? slot.districtScope.map((d: any) => String(d)) : [];
    if (scope.length > 0 && (district === null || !scope.includes(district))) {
      throw badRequest("landings.thisSlotDoesNotApplyTo");
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
        throw badRequest("landings.thisSlotIsFullChooseAnother");
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
      throw conflict("landings.aLandingPageWithSlugAlready", { slug: slug });
    }
  }

  private validateSlug(slug: string): string {
    const s = slug.trim();
    if (!SLUG_PATTERN.test(s)) {
      throw badRequest("landings.slugMustBeUrlFriendlyLowercase");
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
      throw badRequest("landings.unknownLandingStatus", { status: status });
    }
    return status;
  }

  private validateWeight(weight: unknown): number {
    const w = weight === undefined || weight === null ? 100 : Number(weight);
    if (!Number.isInteger(w) || w < 0 || w > 100) {
      throw badRequest("landings.weightMustBeAnIntegerBetween");
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
    if (!variant) throw notFound("landings.variantNotFoundForThisLanding");
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

    // AB7 (AX20): per-variant conversionRate + vs-control
    // significance (DISPLAY ONLY — serving/weights untouched).
    // Conversions reuse the EXISTING definition above: orders
    // attributed to the variant (landingVariantId) over its
    // "view" events.
    //
    // Control rule: the variant with the MOST VIEWS is the
    // control for significance purposes (this is independent of
    // the isControl serving flag); ties go to the earliest
    // created variant (variantsOf returns createdAt asc, so the
    // first strict maximum wins). The control's own vsControl
    // is null.
    //
    // Significance rule: significant = two-sided p < 0.05 AND
    // both variants have >= 30 views. When either side has
    // < 30 views no test is reported at all: pValue null,
    // significant false, note "insufficient_data" — not enough
    // data to test honestly.
    //
    // Winner rule (winnerId): the highest-conversionRate variant
    // that is DISTINGUISHABLE from the control —
    //  - a non-control variant qualifies when its vsControl is
    //    significant AND its rate is HIGHER than the control's;
    //  - the control qualifies when at least one rival is
    //    significant with a LOWER rate AND the control holds
    //    the top rate.
    // If the top-rate variant is not distinguishable, winnerId
    // is null (no honest winner yet).
    const rawVariants: Array<{
      variantId: string; name: string; views: number; orders: number;
      revenueMinor: string; conversionPct: number | null; conversionRate: number;
    }> = [];
    for (const v of await this.variantsOf(landing.id)) {
      const vViews = events.filter((e) => e.kind === "view" && e.variantId === v.id).length;
      const vOrders = orders.filter((o) => o.landingVariantId === v.id);
      const vRevenue = vOrders.reduce((sum, o) => sum + BigInt(o.totalMinor ?? 0), 0n);
      rawVariants.push({
        variantId: v.id,
        name: v.name,
        views: vViews,
        orders: vOrders.length,
        revenueMinor: vRevenue.toString(),
        conversionPct: conversionPct(vOrders.length, vViews),
        conversionRate: conversionRate(vOrders.length, vViews),
      });
    }
    let controlIdx = -1;
    for (let i = 0; i < rawVariants.length; i++) {
      if (controlIdx < 0 || rawVariants[i].views > rawVariants[controlIdx].views) controlIdx = i;
    }
    const control = controlIdx >= 0 ? rawVariants[controlIdx] : null;
    const variants = rawVariants.map((row, i) => {
      if (!control || i === controlIdx) return { ...row, vsControl: null as null | { pValue: number | null; significant: boolean; note?: "insufficient_data" } };
      if (row.views < 30 || control.views < 30) {
        return { ...row, vsControl: { pValue: null, significant: false, note: "insufficient_data" as const } };
      }
      const { pValue } = twoProportionZTest(row.orders, row.views, control.orders, control.views);
      return {
        ...row,
        vsControl: {
          pValue: Math.round(pValue * 1e6) / 1e6,
          significant: pValue < 0.05,
        },
      };
    });
    let winnerId: string | null = null;
    if (control) {
      const topRate = Math.max(...rawVariants.map((r) => r.conversionRate));
      const qualified: Array<{ variantId: string; rate: number }> = [];
      variants.forEach((row, i) => {
        if (i === controlIdx) return;
        if (row.vsControl?.significant && row.conversionRate > control.conversionRate) {
          qualified.push({ variantId: row.variantId, rate: row.conversionRate });
        }
      });
      const controlDistinguishable =
        control.conversionRate >= topRate &&
        variants.some(
          (row, i) => i !== controlIdx && row.vsControl?.significant && row.conversionRate < control.conversionRate,
        );
      if (controlDistinguishable) qualified.push({ variantId: control.variantId, rate: control.conversionRate });
      qualified.sort((a, b) => b.rate - a.rate);
      winnerId = qualified[0]?.variantId ?? null;
    }

    return {
      landingId: landing.id,
      views,
      checkoutStarted,
      orders: orders.length,
      revenueMinor: revenue.toString(),
      conversionPct: conversionPct(orders.length, views),
      variants,
      winnerId,
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
    if (!p) throw notFound("landings.theLandingPageWasNotFound");

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

    // GB3 (GC8): shared checkout-trust payload.
    const trustSetting = (await this.loadTermsTrust(organizationId)).setting;
    const checkoutTrust = await buildCheckoutTrust(
      this.prisma, this.checkoutGuard, organizationId, trustSetting, bp,
    );

    return {
      checkoutTrust,
      // GC10: real online-payment options beside checkoutTrust.
      paymentOptions: await this.paymentOptionsFor(organizationId),
      landing: { id: landing.id, slug: landing.slug, title: landing.title },
      product: {
        id: p.id,
        // AB6 (AX13): shop-locale display name/description —
        // the locale rides the loadTermsTrust setting loaded above.
        name: displayProductName(p, trustSetting?.locale),
        slug: p.slug,
        description: displayProductDescription(p, trustSetting?.locale),
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
        // AB2 (AX3): gift-card flag + face-value config.
        isGiftCard: !!(p as any).isGiftCard,
        giftCardConfig: (p as any).giftCardConfig ?? null,
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
        locale: trust.locale ?? "bn",
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

  async placeOrder(slug: string, dto: LandingOrderDto, ctx?: { ip?: string | null }) {
    const landing = await this.getPublishedLanding(slug);
    const organizationId = landing.organizationId;

    // GB3 (GC8): idempotency replay (scope "landing").
    if (dto.idempotencyKey && this.idempotency) {
      const replay = await this.idempotency.findReplay(organizationId, dto.idempotencyKey);
      if (replay) return replay;
    }
    // GB3 (GC8): terms consent.
    const termsTrust = await this.loadTermsTrust(organizationId);
    if (termsTrust.required && dto.termsAccepted !== true) {
      throw badRequest("landings.readingTheTermsAndAgreeingIs");
    }
    // AB8 (AX27): normalized device hash (invalid/absent = null).
    const deviceHash = normalizeDeviceHash((dto as any).deviceHash);
    // GB3 (GC9): the checkout gate (channel "landing").
    if (this.checkoutGuard) {
      await this.checkoutGuard.evaluateGate(organizationId, "landing", {
        phone: dto.customerPhone,
        email: null,
        ip: ctx?.ip ?? null,
        deviceHash,
        captchaToken: dto.captchaToken ?? null,
        surface: "checkout",
      });
    }
    // GC10: re-validate an online selection server-side (400
    // when the pair is not really offered).
    const onlinePayment = await this.resolveOnlineSelection(organizationId, dto);

    const p = await this.t("product").findFirst({
      where: { id: landing.productId, organizationId, status: "ACTIVE" },
    });
    if (!p) throw notFound("landings.productIsUnavailableOrOutOf");

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
        throw badRequest("landings.theVariantDoesNotBelongTo");
      }
    }
    // AB5 (AX7) PRICE SOURCE precedence (variant-aware here):
    // gift-card lines keep face value → an explicit price-list
    // price REPLACES catalog/variant price AND beats
    // wholesale-tier math (negotiated price is more specific
    // than a quantity tier) → catalog/variant price otherwise.
    // The buyer is resolved by phone via the same
    // promotions.customerIdForPhone the GB7 block below uses.
    // Failure-isolated: no map ⇒ today's price, byte-identical.
    let priceListBreakdown: Array<{ productId: string; variantId: string | null; priceMinor: string }> = [];
    let ax7UnitPrice: bigint | null = null;
    if (this.priceLists && !(p as any).isGiftCard && this.promotions && typeof (this.promotions as any).customerIdForPhone === "function") {
      const ax7CustomerId = await (this.promotions as any)
        .customerIdForPhone(organizationId, dto.customerPhone)
        .catch(() => null);
      if (ax7CustomerId) {
        const map = await this.priceLists.priceMapForCustomer(organizationId, ax7CustomerId).catch(() => null);
        ax7UnitPrice = pickGroupPrice(map, p.id, productVariant?.id ?? null);
        if (ax7UnitPrice != null) {
          priceListBreakdown = [{
            productId: p.id,
            variantId: productVariant?.id ?? null,
            priceMinor: ax7UnitPrice.toString(),
          }];
        }
      }
    }
    const unitPriceMinor =
      ax7UnitPrice ??
      (productVariant?.priceMinor != null ? BigInt(productVariant.priceMinor) : BigInt(p.priceMinor));
    let subtotal = unitPriceMinor * BigInt(qty);

    // GB2 (GC7): stock enforcement — landing checkouts
    // previously had NO stock check (preorder limit only) and
    // could oversell tracked stock without bound. Assert-stock
    // semantics through the ONE checker: variant stock wins when
    // a variant is chosen; preorder bypasses; allowBackorder is
    // the merchant's own setting. There is no cart session here,
    // so no reservation exclusion applies (and none is created —
    // documented coverage window).
    if (this.inventory?.checkAvailability) {
      const verdict = await this.inventory.checkAvailability(organizationId, p, productVariant, qty);
      if (!verdict.ok) {
        throw badRequest("landings.sorryHasOnlyInStockMore", { pName: p.name, p2: Math.max(0, verdict.available) });
      }
    }

    const items: any[] = [
      {
        // AB6 (AX13): shop-locale display name — the locale
        // rides the termsTrust setting loaded at the top.
        name: displayProductName(p, termsTrust.setting?.locale),
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
    // GB7: resolve the buyer's customer + prior-order count ONCE
    // before the evaluation. When the promotions service is absent
    // there is no such helper (DiscountsService has none), so the
    // values stay undefined and customer-conditioned coupons then
    // refuse conservatively in the pure validator.
    let buyerCustomerId: string | null | undefined;
    let buyerPriorOrderCount: number | null | undefined;
    if (this.promotions) {
      buyerCustomerId =
        typeof (this.promotions as any).customerIdForPhone === "function"
          ? await this.promotions.customerIdForPhone(organizationId, dto.customerPhone)
          : null;
      buyerPriorOrderCount =
        typeof (this.promotions as any).priorOrderCountFor === "function"
          ? await this.promotions.priorOrderCountFor(organizationId, buyerCustomerId)
          : null;
    }
    // AB1 (AX1): loyalty snapshot for the phone-resolved
    // customer (the evaluator prices from the snapshot only).
    let loyaltyInput: LoyaltyRedeemInput | null = null;
    if (this.loyalty && dto.loyaltyPoints != null && dto.loyaltyPoints > 0 && buyerCustomerId) {
      const snap = await this.loyalty
        .checkoutSnapshot(organizationId, buyerCustomerId)
        .catch(() => null);
      if (snap) loyaltyInput = { pointsToRedeem: dto.loyaltyPoints, ...snap };
    }
    // AB2 (AX3): gift-card redemption snapshot (dto.giftCardCode
    // is inherited from PublicCheckoutOrderDto). Refusals throw
    // BEFORE placement, like coupons. The cart is the landing's
    // single product, so cartHasGiftCardProduct is its flag.
    let giftCardInput: { giftCardId: string; balanceMinor: bigint; codeLast4: string } | null = null;
    if (this.giftCards && dto.giftCardCode?.trim()) {
      const snap = await this.giftCards.resolveForCheckout(organizationId, dto.giftCardCode, {
        cartHasGiftCardProduct: !!(p as any).isGiftCard,
      });
      giftCardInput = { giftCardId: snap.giftCardId, balanceMinor: snap.balanceMinor, codeLast4: snap.codeLast4 };
    }
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
        customerId: buyerCustomerId,
        priorOrderCount: buyerPriorOrderCount,
        loyalty: loyaltyInput,
        giftCard: giftCardInput,
      });
      discountMinor = ec16Evaluation.totalDiscountMinor;
      freeShippingApplied = ec16Evaluation.couponFreeShipping;
      appliedDiscountId = ec16Evaluation.appliedDiscountId;
    } else if (dto.couponCode?.trim()) {
      if (!this.discounts) {
        throw badRequest("landings.theCouponFacilityIsNotAvailable");
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
        // GB7: values computed above; undefined when the promotions
        // service (the helper's owner) is absent in this deployment.
        priorOrderCount: buyerPriorOrderCount,
        customerId: buyerCustomerId,
      });
      if (!v.valid) {
        throw badRequest("landings.theCouponCouldNotBeApplied", { p1: DISCOUNT_REASON_MESSAGES[v.reason ?? ""] ?? v.reason });
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
        throw badRequest("landings.yourDistrictMustBeGivenTo");
      }
      if (!this.storefront) {
        throw internalError("landings.deliveryZonesAreUnavailableStorefrontService");
      }
      const zone = await this.storefront.matchZone(organizationId, district);
      if (!zone) {
        throw badRequest("landings.deliveryIsNotSetUpFor");
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
          // GB2 (GC6): the landing's only product line decides
          // the all-free test on its own flag.
          allFreeShipping: !!(p as any).freeShipping,
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
      // GB2 (GC6): the legacy-fallback branch honors the flag
      // too (the resolver branch zeroes inside the resolver).
      if ((p as any).freeShipping) shippingMinor = 0n;
    } else {
      const bp = await this.businessProfile(organizationId);
      const isOutside = dto.deliveryZone === "outside_dhaka";
      shippingMinor = isOutside
        ? ((bp as any)?.deliveryChargeOutsideMinor ?? 12000n)
        : ((bp as any)?.deliveryChargeInsideMinor ?? 6000n);
      if (freeShippingApplied) shippingMinor = 0n;
      // GB2 (GC6): free-shipping product zeroes the flat fee.
      if ((p as any).freeShipping) shippingMinor = 0n;
    }

    // EC18: a chosen slot is validated after pricing, BEFORE
    // the order write — a refusal means no order. The scope
    // district is the landing's district field (null when absent).
    let chosenSlot: any = null;
    if (dto.deliverySlotId || dto.deliveryDate) {
      if (!dto.deliverySlotId || !dto.deliveryDate) {
        throw badRequest("landings.ifASlotIsChosenThe");
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

    // GB3 (GC8): COD trust rules — structured district wins,
    // else the parsed address at high|medium confidence.
    let codAdvanceRequired = false;
    if (isCod && !onlinePayment) {
      const bp = await this.businessProfile(organizationId);
      const parsed = parseBdAddress(dto.customerAddress);
      const codEval = evaluateCodRules(bp, {
        totalMinor: total,
        district: dto.district?.trim() || null,
        parsedDistrict: parsed.district,
        parsedConfidence: parsed.confidence,
      });
      if (codEval.refused) {
        throw badRequest("landings.sorryCashOnDeliveryDoesNot");
      }
      codAdvanceRequired = codEval.advanceRequired;
    }

    // AB4 (AX5a/AX5b): custom field answers for the "landing"
    // surface — validated BEFORE any order write — and the
    // deposit slice for this placement's kind (NOTICE + stamp
    // only on this surface; no initiation exists here). The
    // profile is the one this flow already fetches for COD /
    // delivery (re-read here so the deposit judges identically
    // even on the zone-delivery branch).
    const fieldValidation = validateFieldAnswers(
      await this.loadCheckoutFieldDefs(organizationId), "landing", dto.fieldAnswers,
    );
    if (!fieldValidation.ok) throw new BadRequestException(fieldValidation.error);
    const deposit = depositFor(await this.businessProfile(organizationId), {
      totalMinor: total,
      kind: onlinePayment ? "online" : isCod ? "cod" : "manual",
    });

    if (!this.integrations) {
      throw internalError("landings.checkoutOrderingIsUnavailableIntegrationsService");
    }
    // ON4: blocklist refusal — generic message, never reveals the blocklist.
    if (this.blockedPhones && (await this.blockedPhones.isBlocked(organizationId, cleanPhone))) throw badRequest("landings.sorryTheOrderCannotBeTaken");
    // GB3 (GC9): block_checkout fraud rules (guard writes the
    // hit + attempt rows itself; the caller only refuses).
    if (this.checkoutGuard) {
      const stats = await this.checkoutGuard
        .phoneOrderStats(organizationId, bdPhoneMatchKey(cleanPhone) ?? "")
        .catch(() => null);
      const { blockedBy } = await this.checkoutGuard.evaluateFraudRulesAtCheckout(organizationId, {
        totalMinor: total,
        isCod: onlinePayment ? false : isCod,
        district: dto.district?.trim() || null,
        openOrderCount: stats?.openCount ?? 0,
        phone: cleanPhone,
        channel: "landing",
      });
      if (blockedBy) throw badRequest("landings.sorryTheOrderCannotBeTaken");
    }
    // GC22: plan/order blocks on this PUBLIC landing checkout
    // surface ONLY as the generic shopper message.
    try {
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
        // AB7 (AX19): order-level attribution stamps
        // (inherited DTO field — see LandingOrderDto) — only
        // the keys actually presented; absent = columns null.
        ...normalizeAttribution(dto.attribution),
        // AB8 (AX27): device fingerprint stamp (valid hash only).
        ...(deviceHash ? { deviceHash } : {}),
        customer: {
          externalId: cleanPhone,
          firstName: dto.customerName.trim(),
          phone: cleanPhone,
          address: {
            address_1: dto.customerAddress.trim(),
            ...(dto.district?.trim() ? { district: dto.district.trim() } : {}),
            // GC10: marker-only distinction (paymentMethod
            // passes through exactly as today) — see Products.
            note: onlinePayment
              ? [dto.note?.trim(), `[অনলাইন পেমেন্ট (${onlinePayment.provider}) — যাচাই বাকি]`].filter(Boolean).join(" | ")
              : dto.note || undefined,
          },
        },
        items,
      } as any,
      LANDING_SOURCE,
    );
    } catch (e) {
      if (isOrderLimitBlocked(e)) throw new BadRequestException((e as OrderLimitBlockedError).shopperMessage ?? SHOPPER_ORDER_BLOCK_MESSAGE);
      throw e;
    }

    // Attribution: fetch the created order and stamp it. The
    // served variant counts only when it belongs to THIS landing.
    let orderId: string | null = null;
    let placedCustomerId: string | null = null;
    try {
      const order = await this.t("order").findFirst({
        where: { organizationId, source: LANDING_SOURCE, externalId },
      });
      if (order) {
        orderId = order.id;
        placedCustomerId = order.customerId ?? null;
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
            // GB3 (GC8): terms-consent + COD-advance stamps ride
            // the same attribution update.
            ...(dto.termsAccepted === true && (termsTrust.required || termsTrust.ref)
              ? { termsConsentedAt: new Date(), termsRef: termsTrust.ref }
              : {}),
            ...(codAdvanceRequired ? { codAdvanceRequired: true } : {}),
            // AB4 (AX5a/AX5b): deposit due + validated field
            // answers ride the same attribution update.
            ...(deposit.active ? { depositDueMinor: deposit.amountMinor } : {}),
            ...(Object.keys(fieldValidation.values).length > 0
              ? { checkoutFields: fieldValidation.values }
              : {}),
            // EC18: the slot stamp rides the same attribution update.
            ...(chosenSlot ? { deliverySlotId: chosenSlot.id, deliveryDate: dto.deliveryDate } : {}),
            // AB5 (AX7): the group price-list snapshot rides the
            // same attribution update (failure-isolated by the
            // surrounding try/catch, like every stamp here).
            ...(priceListBreakdown.length > 0 ? { priceListBreakdown } : {}),
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
                  // AB1 (AX2): the resolved referrer rides the
                  // same inline stamp (this path has no
                  // stampOrder call — the split is stamped here).
                  ...(ec16Evaluation.referrerCustomerIdToRecord
                    ? { referrerCustomerId: ec16Evaluation.referrerCustomerIdToRecord }
                    : {}),
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

    // AB1 (AX1): spend the redeemed points now that the order
    // exists (failure-isolated inside LoyaltyService).
    if (ec16Evaluation && (ec16Evaluation.loyaltyPointsApplied ?? 0) > 0 && this.loyalty && orderId) {
      await this.loyalty.postPlacementRedeem(organizationId, {
        orderId,
        customerId: placedCustomerId,
        points: ec16Evaluation.loyaltyPointsApplied ?? 0,
      });
    }

    // AB2 (AX3): spend the redeemed gift-card balance now that
    // the order exists (failure-isolated inside GiftCardsService;
    // orderId comes from the same attribution re-read as loyalty).
    if (ec16Evaluation && (ec16Evaluation.giftCardDiscountMinor ?? 0n) > 0n && ec16Evaluation.giftCardId && this.giftCards && orderId) {
      await this.giftCards.postPlacementRedeem(organizationId, {
        orderId,
        giftCardId: ec16Evaluation.giftCardId,
        amountMinor: ec16Evaluation.giftCardDiscountMinor ?? 0n,
      });
    }

    // EC16: the buyer's OWN referral code to share (additive,
    // failure-isolated; null when unresolvable).
    const yourReferralCode = this.promotions
      ? await this.promotions.yourReferralCodeForPhone(organizationId, cleanPhone)
      : null;

    const response = {
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
      // AB1 (AX1): the loyalty line of the placed order.
      loyaltyDiscountMinor: (ec16Evaluation?.loyaltyDiscountMinor ?? 0n).toString(),
      loyaltyPointsUsed: ec16Evaluation?.loyaltyPointsApplied ?? 0,
      // AB2 (AX3): the gift-card line of the placed order.
      giftCardDiscountMinor: (ec16Evaluation?.giftCardDiscountMinor ?? 0n).toString(),
      giftCardCodeLast4: ec16Evaluation?.giftCardCodeLast4 ?? null,
      // AB4 (AX5a): deposit NOTICE for this placement (no
      // initiation exists on this surface — collection runs
      // through the shop / resend / public payment paths).
      deposit: deposit.active
        ? { amountMinor: deposit.amountMinor.toString(), note: deposit.note }
        : null,
      upsellEligible: !!landing.upsellProductId,
      // EC24b: success screen shows the digital-delivery note.
      hasDigitalItems: !!p.digital,
      // GC10: online marker outcome (additive, online only) —
      // this response already carries orderId + orderNumber
      // (externalNumber), so it is initiation-ready.
      ...(onlinePayment ? { paymentClaimStatus: "online_pending", onlinePayment } : {}),
    };
    // GB3 (GC8): record the placement under the idempotency key.
    if (dto.idempotencyKey && this.idempotency) {
      return await this.idempotency.record(organizationId, dto.idempotencyKey, "landing", orderId, response);
    }
    return response;
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
    if (!landing) throw notFound("landings.theLandingPageWasNotFound");

    const order = await this.t("order").findFirst({ where: { id: orderId } });
    if (!order) {
      throw badRequest("landings.theOrderWasNotFound");
    }
    if (order.landingPageId !== landing.id) {
      throw badRequest("landings.thisOrderDidNotComeFrom");
    }
    if (order.organizationId !== landing.organizationId) {
      throw badRequest("landings.theOrderDoesNotBelongTo");
    }
    if (!OPEN_ORDER_STATUSES.includes(order.status)) {
      throw badRequest("landings.theOrderIsNowInStatus", { orderStatus: order.status });
    }
    const fulfillments: any[] =
      (await this.t("fulfillment")
        ?.findMany({ where: { orderId: order.id } })
        .catch(() => [])) ?? [];
    if (fulfillments.length > 0) {
      throw badRequest("landings.theOrderSFulfillmentHasStarted");
    }
    const placedAt = order.placedAt ?? order.createdAt;
    if (placedAt && Date.now() - new Date(placedAt).getTime() > UPSELL_WINDOW_MS) {
      throw badRequest("landings.theUpsellTimeLimit2Hours");
    }
    if (!landing.upsellProductId) {
      throw badRequest("landings.noUpsellProductIsSetOn");
    }
    const upsellProduct = await this.t("product").findFirst({
      where: { id: landing.upsellProductId, organizationId: landing.organizationId },
    });
    if (!upsellProduct || upsellProduct.status !== "ACTIVE") {
      throw badRequest("landings.theUpsellProductIsNotAvailable");
    }
    const existingItems: any[] =
      (await this.t("orderItem").findMany({ where: { orderId: order.id } }).catch(() => [])) ?? [];
    if (existingItems.some((i) => i.productId === upsellProduct.id)) {
      throw badRequest("landings.thisUpsellProductHasAlreadyBeen");
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
        throw badRequest("landings.theStockCouldNotBeUpdated");
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
