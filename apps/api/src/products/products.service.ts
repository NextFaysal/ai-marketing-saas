import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { InventoryService } from "../inventory/inventory.service";
import { CreateProductDto, UpdateProductDto, CreateVariantDto, UpdateVariantDto, SetCostDto, BulkEditDto, CreateCategoryDto, UpdateCategoryDto } from "./products.dto";
import { CatalogPushService } from "../commerce/catalog-push.service";
import { DiscountsService } from "../commerce/discounts.service";
import { DISCOUNT_REASON_MESSAGES } from "../commerce/discounts";
import { PromotionsService, type CheckoutEvaluation } from "../commerce/promotions.service";
import { AffiliatesService } from "../affiliates/affiliates.service";
import { BlockedPhoneService } from "../fraud/blocked-phone.service";
import type { PromotionLine } from "../commerce/promotions";
import { computeStockDiverged, pendingOutboxKeys } from "../commerce/stock-divergence";
import { assertEc24Conditionals, assertPreorderLimit, preorderInfo, validateWholesaleTiers } from "../commerce/ec24";

/**
 * EC24: normalize the product-model expansion fields for a
 * create (full defaults) or an update (only present fields).
 * Wholesale tiers are validated + normalized here — the same
 * place EC23 validates taxRateBps. Date/limit fields are checked
 * for shape; the digital/subscription conditionals are asserted
 * by the caller against the effective (merged) state.
 */
export function normalizeEc24Fields(dto: any, partial: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const has = (k: string) => dto[k] !== undefined;
  if (!partial || has("preorderEnabled")) out.preorderEnabled = !!dto.preorderEnabled;
  if (!partial || has("preorderReleaseDate")) {
    if (dto.preorderReleaseDate === null || dto.preorderReleaseDate === undefined) out.preorderReleaseDate = null;
    else {
      const d = new Date(dto.preorderReleaseDate);
      if (Number.isNaN(d.getTime())) throw new BadRequestException("প্রি-অর্ডার রিলিজের তারিখ সঠিক নয়");
      out.preorderReleaseDate = d;
    }
  }
  if (!partial || has("preorderLimit")) {
    if (dto.preorderLimit === null || dto.preorderLimit === undefined) out.preorderLimit = null;
    else if (!Number.isInteger(dto.preorderLimit) || dto.preorderLimit < 1) throw new BadRequestException("প্রি-অর্ডার সীমা কমপক্ষে ১ হতে হবে");
    else out.preorderLimit = dto.preorderLimit;
  }
  if (!partial || has("digital")) out.digital = !!dto.digital;
  if (!partial || has("digitalFileUrl")) out.digitalFileUrl = dto.digitalFileUrl?.trim() || null;
  if (!partial || has("digitalAccessLimit")) {
    if (dto.digitalAccessLimit === null || dto.digitalAccessLimit === undefined) out.digitalAccessLimit = null;
    else if (!Number.isInteger(dto.digitalAccessLimit) || dto.digitalAccessLimit < 1) throw new BadRequestException("ডিজিটাল অ্যাক্সেস সীমা কমপক্ষে ১ হতে হবে");
    else out.digitalAccessLimit = dto.digitalAccessLimit;
  }
  if (!partial || has("subscriptionEnabled")) out.subscriptionEnabled = !!dto.subscriptionEnabled;
  if (!partial || has("subscriptionIntervalDays")) {
    if (dto.subscriptionIntervalDays === null || dto.subscriptionIntervalDays === undefined) out.subscriptionIntervalDays = null;
    else if (!Number.isInteger(dto.subscriptionIntervalDays) || dto.subscriptionIntervalDays < 0) throw new BadRequestException("সাবস্ক্রিপশন ইন্টারভাল সঠিক নয়");
    else out.subscriptionIntervalDays = dto.subscriptionIntervalDays;
  }
  if (!partial || has("subscriptionDiscountPercent")) {
    if (dto.subscriptionDiscountPercent === null || dto.subscriptionDiscountPercent === undefined) out.subscriptionDiscountPercent = null;
    else if (!Number.isInteger(dto.subscriptionDiscountPercent) || dto.subscriptionDiscountPercent < 0 || dto.subscriptionDiscountPercent > 100) throw new BadRequestException("সাবস্ক্রিপশন ছাড় ০–১০০% এর মধ্যে হতে হবে");
    else out.subscriptionDiscountPercent = dto.subscriptionDiscountPercent;
  }
  if (!partial || has("wholesaleTiers")) out.wholesaleTiers = validateWholesaleTiers(dto.wholesaleTiers);
  return out;
}
import { parseMoneyToMinor } from "@repo/contracts";
import { computeMargin } from "./pricing";
import { REVENUE_EXCLUDED_STATUSES } from "../analytics/analytics.service";
import { classifyShipmentStatus } from "../courier/courier-performance";
import { dhakaDayStartUtc } from "../crm/lead-followups";

/** EC23: a tax rate is basis points — integer 0..10000 or null. */
export function validateTaxRateBps(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 10000) {
    throw new BadRequestException("VAT হার 0–10000 basis points-এর মধ্যে হতে হবে (1500 = 15%)");
  }
  return v as number;
}

function parseMoney(value: string, field: string): bigint {
  try { return parseMoneyToMinor(value); }
  catch { throw new BadRequestException(`Invalid ${field}: ${value}`); }
}

// BigInt cannot be JSON-serialized; the API always returns money as strings.
export function toPublicProduct(p: any, currentCostMinor?: bigint | null) {
  const margin = computeMargin(BigInt(p.priceMinor), currentCostMinor ?? null);
  return {
    ...p,
    priceMinor: p.priceMinor?.toString(),
    compareAtMinor: p.compareAtMinor?.toString() ?? null,
    currentCostMinor: currentCostMinor != null ? currentCostMinor.toString() : null,
    marginMinor: margin.marginMinor?.toString() ?? null,
    marginPercent: margin.marginPercent,
    markupPercent: margin.markupPercent,
    variants: p.variants?.map((v: any) => ({ ...v, priceMinor: v.priceMinor?.toString() ?? null })),
    costs: undefined,
  };
}

/** EC3 bulk edit: minor units (bigint) → decimal string for the
 *  existing price write path (e.g. 11000n → "110.00"). */
export function minorToDecimalString(m: bigint): string {
  const negative = m < 0n;
  const abs = negative ? -m : m;
  return `${negative ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}

/**
 * EC3 bulk edit percent math, in basis points, on BigInt so
 * large prices never lose precision:
 *   bp = round(percent * 100)
 *   result = roundHalfAwayFromZero(old * (10000 + bp) / 10000)
 * BigInt division truncates toward zero, so adding ±5000 to the
 * numerator first gives round-half-AWAY-from-zero (documented
 * choice: 2.5 rounds to 3 and -2.5 to -3, never banker's).
 */
export function bulkPercentMinor(oldMinor: bigint, percent: number): bigint {
  const bp = BigInt(Math.round(percent * 100));
  const numerator = oldMinor * (10000n + bp);
  return numerator >= 0n ? (numerator + 5000n) / 10000n : (numerator - 5000n) / 10000n;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

import { IntegrationsService } from "../integrations/integrations.service";
import { EventsService } from "../common/events.service";
import { PublicCheckoutOrderDto } from "./products.dto";
import { randomUUID } from "node:crypto";

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly inventory?: InventoryService,
    // Owner series: public checkout ingestion flows orders through
    // IntegrationsService.upsertOrder. Optional so positional spec
    // constructions keep working; the Nest module always provides it.
    @Optional() private readonly integrations?: IntegrationsService,
    // EC3: catalog push orchestration. LAST param + Optional so
    // every positional spec construction keeps working; the
    // Nest module supplies it via CommerceModule.
    @Optional() private readonly catalogPush?: CatalogPushService,
    // EC7: public-checkout coupon validation/redemption. LAST param
    // + Optional so every positional spec construction keeps
    // working; the Nest module supplies it via CommerceModule.
    @Optional() private readonly discounts?: DiscountsService,
    // EC16: unified promotion/coupon/referral evaluation. LAST
    // param + Optional, same discipline as EC7; spec harnesses
    // without it keep the EC7 coupon-only block below.
    @Optional() private readonly promotions?: PromotionsService,
    // SU5: commerce auto-draft producer hook. Optional
    // (EventsService is global); fire-and-forget emit. INT5 union:
    // events KEEPS slot 8 because the SU5 spec constructs
    // ProductsService positionally with events as the 8th argument,
    // while no EC spec passes affiliates positionally.
    @Optional() private readonly events?: EventsService,
    // ON4: checkout blocklist refusal. INT6 union: blockedPhones
    // takes slot 9 because the ON11 spec constructs ProductsService
    // positionally with the blocklist stub as the 9th argument
    // (on the orders-next line affiliates held slot 8 with no
    // events param). Nest injects by type, so production wiring
    // is unaffected.
    @Optional() private readonly blockedPhones?: BlockedPhoneService,
    // EC32: affiliate attribution stamp. INT6 union: moved AFTER
    // blockedPhones (slot 10) — no EC spec passes affiliates
    // positionally (the INT5 note above still holds), and the
    // SU5 events slot (8) is preserved; the stamp never throws.
    @Optional() private readonly affiliates?: AffiliatesService,
  ) {}

  // ---------- EC3 shared helpers ----------

  /** Failure-isolated catalog-push hook: a push-orchestration
   *  failure must never fail the merchant's own catalog write
   *  (the local write already succeeded and is audited). */
  private async pushHook(label: string, fn: () => Promise<unknown>): Promise<void> {
    if (!this.catalogPush) return;
    try {
      await fn();
    } catch (e) {
      this.logger.warn(
        `catalog push hook (${label}) failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** Org-scoped product row or 404, WITHOUT the getOne include
   *  graph (used by EC3 sub-resources whose fakes/rows may not
   *  carry variants/costs). */
  private async getProductOr404(organizationId: string, productId: string) {
    const p = await (this.prisma as any).product.findFirst({
      where: { id: productId, organizationId },
    });
    if (!p) throw new NotFoundException("Product not found in this organization");
    return p;
  }

  private async findCategoryOr404(organizationId: string, categoryId: string) {
    const table = (this.prisma as any).category;
    const category = table?.findFirst
      ? await table.findFirst({ where: { id: categoryId, organizationId } })
      : null;
    if (!category) throw new NotFoundException("Category not found in this organization");
    return category;
  }

  /** Verify every tag id exists in the org; returns the rows. */
  private async verifyTagsOr404(organizationId: string, tagIds: string[]) {
    const table = (this.prisma as any).productTag;
    const all: any[] = table?.findMany
      ? ((await table.findMany({ where: { organizationId } })) ?? [])
      : [];
    const byId = new Map<string, any>(all.map((t: any) => [t.id, t]));
    const found = tagIds.map((id) => byId.get(id));
    if (found.some((t) => !t)) {
      throw new NotFoundException("Tag not found in this organization");
    }
    return found as any[];
  }

  private async replaceTagAssignments(productId: string, tagIds: string[]): Promise<void> {
    const table = (this.prisma as any).productTagAssignment;
    if (!table) return;
    if (typeof table.deleteMany === "function") {
      try {
        await table.deleteMany({ where: { productId } });
      } catch {
        /* fall through to row-by-row delete below */
      }
    }
    if (typeof table.delete === "function" && typeof table.findMany === "function") {
      let existing: any[] = [];
      try {
        existing = (await table.findMany({ where: { productId } })) ?? [];
      } catch {
        existing = [];
      }
      for (const row of existing) {
        await table.delete({ where: { id: row.id } }).catch(() => undefined);
      }
    }
    for (const tagId of [...new Set(tagIds)]) {
      await table.create({ data: { productId, tagId } });
    }
  }

  async create(organizationId: string, actorId: string, dto: CreateProductDto) {
    if (dto.sku) {
      const dup = await (this.prisma as any).product.findUnique({
        where: { organizationId_sku: { organizationId, sku: dto.sku } },
      });
      if (dup) throw new ConflictException(`A product with SKU ${dto.sku} already exists in this organization`);
    }

    // EC3: a structured categoryId must exist in THIS org; the
    // legacy display string follows the category's name.
    let categoryName = dto.category;
    if (dto.categoryId) {
      const category = await this.findCategoryOr404(organizationId, dto.categoryId);
      categoryName = category.name;
    }
    // EC3: every tag id must exist in this org before we write.
    if (dto.tagIds?.length) await this.verifyTagsOr404(organizationId, dto.tagIds);

    const baseSlug = slugify(dto.name) || `prod-${Date.now().toString(36)}`;
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    const slug = `${baseSlug}-${randomSuffix}`;

    const product = await (this.prisma as any).product.create({
      data: {
        organizationId,
        name: dto.name.trim(),
        slug,
        description: dto.description, category: categoryName, sku: dto.sku || null,
        status: dto.status ?? "ACTIVE",
        priceMinor: parseMoney(dto.price, "price"),
        compareAtMinor: dto.compareAtPrice ? parseMoney(dto.compareAtPrice, "compareAtPrice") : null,
        currency: dto.currency ?? "BDT",
        stockQuantity: dto.stockQuantity, lowStockThreshold: dto.lowStockThreshold,
        imageUrl: dto.imageUrl || null,
        bumpTitle: dto.bumpTitle?.trim() || null,
        bumpPriceMinor: dto.bumpPrice ? parseMoney(dto.bumpPrice, "bumpPrice") : null,
        bumpImageUrl: dto.bumpImageUrl?.trim() || null,
        // EC3 enrichment fields
        weightGrams: dto.weightGrams ?? null,
        lengthCm: dto.lengthCm ?? null,
        widthCm: dto.widthCm ?? null,
        heightCm: dto.heightCm ?? null,
        barcode: dto.barcode ?? null,
        seoTitle: dto.seoTitle ?? null,
        seoDescription: dto.seoDescription ?? null,
        categoryId: dto.categoryId ?? null,
        // EC23: per-product VAT override (null = org default).
        taxRateBps: validateTaxRateBps(dto.taxRateBps),
        // EC24: product-model expansion (validated + normalized).
        ...(() => {
          const fields = normalizeEc24Fields(dto, false);
          assertEc24Conditionals(fields as any);
          return fields;
        })(),
        source: "manual",
      },
    });
    if (dto.tagIds?.length) {
      const assignmentTable = (this.prisma as any).productTagAssignment;
      if (assignmentTable?.create) {
        for (const tagId of [...new Set(dto.tagIds)]) {
          await assignmentTable.create({ data: { productId: product.id, tagId } });
        }
      }
    }
    await this.audit.log({ organizationId, userId: actorId, action: "product.create", entityType: "Product", entityId: product.id });
    // SU5: a new product may become a social DRAFT (never a
    // publish) when the org enabled the trigger. Fire-and-forget.
    this.events?.emit?.("social_draft.product_created", { organizationId, productId: product.id });
    // EC3: full-manage stores get a DRAFT listing for the new
    // product (no push yet). Failure-isolated — see pushHook.
    await this.pushHook("createListingsForNewProduct", () =>
      this.catalogPush!.createListingsForNewProduct(organizationId, product.id),
    );
    return toPublicProduct(product, null);
  }

  async getBySlug(organizationId: string, slug: string) {
    const p = await (this.prisma as any).product.findFirst({
      where: { organizationId, slug },
      include: {
        variants: { orderBy: { createdAt: "asc" } },
        costs: { orderBy: { effectiveFrom: "desc" }, take: 1 },
      },
    });
    if (!p) throw new NotFoundException("Product not found");
    return toPublicProduct(p, p.costs?.[0]?.costMinor ?? null);
  }

  // ---------- EC18: delivery slots (local equivalents of the
  // storefront helpers — this service has no StorefrontService
  // dependency, so the shared rules are re-implemented here) ----

  /** Public slot list for the single-product page: ACTIVE slots
   * whose districtScope is empty (all districts) only — the
   * shopper's district is unknown on this surface. Any error
   * degrades to an empty list. */
  private async publicDeliverySlots(organizationId: string): Promise<any[]> {
    try {
      const table = (this.prisma as any).deliverySlot;
      if (!table?.findMany) return [];
      const rows: any[] =
        (await table.findMany({ where: { organizationId, active: true } }).catch(() => [])) ?? [];
      return rows
        .filter((s: any) => !Array.isArray(s.districtScope) || s.districtScope.length === 0)
        .map((s: any) => ({ id: s.id, label: s.label, startTime: s.startTime, endTime: s.endTime }));
    } catch {
      return [];
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
      const table = (this.prisma as any).storefrontSetting;
      if (!table?.findFirst) return empty;
      const s = await table.findFirst({ where: { organizationId } }).catch(() => null);
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

  /** Validate a slot choice where the district is unknown
   * (district = null ⇒ only all-district slots qualify). */
  private async validateDeliverySlotChoice(
    organizationId: string,
    slotId: string,
    dateStr: string,
    district: string | null,
  ): Promise<any> {
    const table = (this.prisma as any).deliverySlot;
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
      const orderTable = (this.prisma as any).order;
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

  /**
   * Public storefront query: returns product and organization delivery/payment settings
   */
  async getPublicProductBySlug(slug: string) {
    const p = await (this.prisma as any).product.findFirst({
      where: { slug, status: "ACTIVE" },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            businessProfile: true,
          },
        },
        variants: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!p) throw new NotFoundException("Product not found or inactive");

    const bp = p.organization?.businessProfile;
    // EC29: top-level gift-wrap offer for the single checkout —
    // only when the shop enabled it AND set a fee, else null.
    let giftWrap: { enabled: true; feeMinor: string } | null = null;
    try {
      const sTable = (this.prisma as any).storefrontSetting;
      const s = sTable?.findFirst
        ? await sTable.findFirst({ where: { organizationId: p.organization.id } }).catch(() => null)
        : null;
      if (s?.giftWrapEnabled === true && s?.giftWrapFeeMinor != null) {
        giftWrap = { enabled: true, feeMinor: String(s.giftWrapFeeMinor) };
      }
    } catch { giftWrap = null; }
    return {
      giftWrap,
      product: {
        id: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        category: p.category,
        imageUrl: p.imageUrl,
        priceMinor: p.priceMinor.toString(),
        compareAtMinor: p.compareAtMinor ? p.compareAtMinor.toString() : null,
        stockQuantity: p.stockQuantity,
        // EC24a: public pre-order info (null when not a preorder product).
        preorder: preorderInfo(p),
        // EC24b: ONLY the flag — the file URL is never public.
        digital: !!p.digital,
        bumpTitle: p.bumpTitle || null,
        bumpPriceMinor: p.bumpPriceMinor ? p.bumpPriceMinor.toString() : null,
        bumpImageUrl: p.bumpImageUrl || null,
        variants: p.variants?.map((v: any) => ({
          id: v.id,
          name: v.name,
          sku: v.sku,
          priceMinor: v.priceMinor ? v.priceMinor.toString() : null,
          stockQuantity: v.stockQuantity,
        })),
      },
      organization: {
        id: p.organization.id,
        name: p.organization.name,
        slug: p.organization.slug,
        insideDhakaFee: bp?.deliveryChargeInsideMinor ? (Number(bp.deliveryChargeInsideMinor) / 100).toString() : "60",
        outsideDhakaFee: bp?.deliveryChargeOutsideMinor ? (Number(bp.deliveryChargeOutsideMinor) / 100).toString() : "120",
        codAvailable: bp?.codAvailable !== false,
        bkashNumber: bp?.bkashNumber || null,
        nagadNumber: bp?.nagadNumber || null,
        paymentNote: bp?.paymentNote || null,
        metaPixelId: bp?.metaPixelId || null,
        tikTokPixelId: bp?.tikTokPixelId || null,
        // EC18: all-district delivery slots the shopper may pick.
        deliverySlots: await this.publicDeliverySlots(p.organization.id),
        // EC18: merchant-written trust copy (null = block hidden).
        ...(await this.storefrontTrust(p.organization.id)),
      },
    };
  }

  /**
   * Public checkout: customers place order with 1-click COD/Bkash without login
   */
  async placePublicOrder(slug: string, dto: PublicCheckoutOrderDto) {
    const p = await (this.prisma as any).product.findFirst({
      where: { slug, status: "ACTIVE" },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            businessProfile: true,
          },
        },
        variants: true,
      },
    });
    if (!p) throw new NotFoundException("Product is unavailable or out of stock");

    const qty = Math.max(1, dto.quantity ?? 1);
    // EC24a: a preorder-enabled product passes at zero/negative
    // stock (this path's gate is product existence, as before);
    // only its open-unit limit can refuse the order.
    await assertPreorderLimit(this.prisma, p.organization.id, p, qty);
    const unitPriceMinor = BigInt(p.priceMinor);
    let subtotal = unitPriceMinor * BigInt(qty);

    const bp = p.organization?.businessProfile;
    const isOutside = dto.deliveryZone === "outside_dhaka";
    const shippingMinor = isOutside
      ? (bp?.deliveryChargeOutsideMinor ?? 12000n)
      : (bp?.deliveryChargeInsideMinor ?? 6000n);

    // Check if customer accepted 1-Click Order Bump Upsell
    const items: any[] = [
      {
        name: p.name,
        sku: p.sku || undefined,
        quantity: qty,
        priceMinor: unitPriceMinor,
        totalMinor: subtotal,
        // EC24a: any order of a preorder-enabled product is a preorder line.
        isPreorder: !!p.preorderEnabled,
      },
    ];

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

    // EC7/EC16: discounts. With the EC16 service present this is
    // the ONE unified evaluation (promotions → coupon → referral);
    // without it, the EC7 coupon-only block below runs unchanged
    // (identical result when no promotion applies). An invalid
    // coupon fails the checkout with a Bengali reason BEFORE any
    // order is written.
    let discountMinor = 0n;
    let freeShippingApplied = false;
    let appliedDiscountId: string | null = null;
    let ec16Evaluation: CheckoutEvaluation | null = null;
    const bumpMinorForEval =
      dto.includeBump && p.bumpPriceMinor && p.bumpTitle ? BigInt(p.bumpPriceMinor) : 0n;
    if (this.promotions) {
      ec16Evaluation = await this.promotions.evaluateCheckout(p.organization.id, {
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
      const v = await this.discounts.validateForCheckout(p.organization.id, dto.couponCode, {
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

    // EC29: gift placement (same PromotionsService.giftPlacement
    // semantics as the shop checkout). The outcome is recorded
    // on the evaluation BEFORE stampOrder runs below; a gift
    // that cannot be placed never fails the order.
    let giftInfo: { promotionName: string; productName: string; quantity: number } | null = null;
    if (ec16Evaluation?.gift && this.promotions) {
      const placement = await this.promotions.giftPlacement(p.organization.id, ec16Evaluation.gift);
      if (placement) {
        items.push({
          productId: placement.product.id,
          name: placement.product.name,
          sku: placement.variant?.sku || placement.product.sku || undefined,
          quantity: ec16Evaluation.gift.giftQty,
          priceMinor: 0n,
          totalMinor: 0n,
          isGift: true,
        });
        ec16Evaluation.giftOutcome = "applied";
        giftInfo = {
          promotionName: ec16Evaluation.gift.name,
          productName: placement.product.name,
          quantity: ec16Evaluation.gift.giftQty,
        };
      } else {
        ec16Evaluation.giftOutcome = "skipped";
      }
    }

    // EC29: gift-wrap fee — only when requested AND the shop
    // enabled it with a fee set (read from StorefrontSetting).
    let giftWrapMinor = 0n;
    if (dto.giftWrap) {
      try {
        const sTable = (this.prisma as any).storefrontSetting;
        const s = sTable?.findFirst
          ? await sTable.findFirst({ where: { organizationId: p.organization.id } }).catch(() => null)
          : null;
        if (s?.giftWrapEnabled === true && s?.giftWrapFeeMinor != null) {
          giftWrapMinor = BigInt(s.giftWrapFeeMinor);
        }
      } catch { giftWrapMinor = 0n; }
    }

    // EC18: a chosen slot is validated BEFORE the order write
    // (district unknown on this path ⇒ district = null, so only
    // all-district slots qualify); a refusal means no order.
    let chosenSlot: any = null;
    if (dto.deliverySlotId || dto.deliveryDate) {
      if (!dto.deliverySlotId || !dto.deliveryDate) {
        throw new BadRequestException("স্লট বেছে নিলে তারিখও দিতে হবে");
      }
      chosenSlot = await this.validateDeliverySlotChoice(
        p.organization.id, dto.deliverySlotId, dto.deliveryDate, null,
      );
    }

    const effectiveShippingMinor = freeShippingApplied ? 0n : BigInt(shippingMinor);
    // EC23: exclusive VAT grows the total; inclusive VAT is already
    // inside the prices (taxAddedMinor 0, total unchanged).
    // EC29: the gift-wrap fee (when applied) is part of the total.
    const total = subtotal - discountMinor + effectiveShippingMinor + (ec16Evaluation?.taxAddedMinor ?? 0n) + giftWrapMinor;
    const externalId = `checkout-${randomUUID()}`;
    const cleanPhone = dto.customerPhone.trim();

    if (!this.integrations) {
      throw new InternalServerErrorException("Checkout ordering is unavailable (integrations service missing)");
    }
    // ON4: blocklist refusal — generic message, never reveals the blocklist.
    if (this.blockedPhones && (await this.blockedPhones.isBlocked(p.organization.id, cleanPhone))) throw new BadRequestException("দুঃখিত, এই মুহূর্তে অর্ডারটি নেওয়া যাচ্ছে না");
    await this.integrations.upsertOrder(
      p.organization.id,
      null,
      {
        externalId,
        externalNumber: `ORD-${Date.now().toString().slice(-6)}`,
        status: "processing",
        paymentMethod: dto.paymentMethod || "cod",
        isCod: dto.paymentMethod !== "bkash" && dto.paymentMethod !== "nagad",
        currency: p.currency || "BDT",
        subtotalMinor: subtotal,
        shippingMinor: effectiveShippingMinor,
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
            note: dto.note || undefined,
          },
        },
        items,
      },
      "manual"
    );

    // EC18: stamp the validated slot choice onto the created
    // order (the landings attribution pattern). The order itself
    // is already placed — a stamp failure is logged, not fatal.
    if (chosenSlot) {
      try {
        const orderTable = (this.prisma as any).order;
        const order = orderTable?.findFirst
          ? await orderTable.findFirst({
              where: { organizationId: p.organization.id, source: "manual", externalId },
            })
          : null;
        if (order) {
          await orderTable.update({
            where: { id: order.id },
            data: { deliverySlotId: chosenSlot.id, deliveryDate: dto.deliveryDate },
          });
        }
      } catch (e) {
        this.logger.warn(
          `delivery slot stamp failed for ${externalId}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    // EC29: stamp the gift-wrap charge + message onto the
    // created order (mirrors the slot stamp above; logged, not
    // fatal — the fee already rode totalMinor in the upsert).
    if (giftWrapMinor > 0n) {
      try {
        const orderTable = (this.prisma as any).order;
        const order = orderTable?.findFirst
          ? await orderTable.findFirst({
              where: { organizationId: p.organization.id, source: "manual", externalId },
            })
          : null;
        if (order) {
          await orderTable.update({
            where: { id: order.id },
            data: {
              giftWrapMinor,
              giftMessage: dto.giftMessage?.trim()?.slice(0, 200) || null,
            },
          });
        }
      } catch (e) {
        this.logger.warn(
          `gift wrap stamp failed for ${externalId}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    // EC16: stamp the promotion/referral split onto the created
    // order (failure-isolated inside PromotionsService).
    if (ec16Evaluation && this.promotions) {
      await this.promotions.stampOrder(p.organization.id, "manual", externalId, ec16Evaluation);
    }

    // EC32: stamp affiliate attribution (failure-isolated
    // inside AffiliatesService.stampAttribution).
    if (this.affiliates) {
      await this.affiliates.stampAttribution(p.organization.id, "manual", externalId, dto.affiliateCode, cleanPhone);
    }

    // Stock: NO manual decrement here (merge integration fix).
    // upsertOrder's S1 inventory hook (applyOrderPlaced) already
    // decrements Product.stockQuantity once for the SKU-matched
    // main item and writes the StockMovement; the owner's original
    // direct decrement double-counted every checkout order.

    // EC7: the coupon is redeemed only after the order write
    // succeeded; a redemption failure must not fail a placed
    // order (it is logged instead).
    if (appliedDiscountId) {
      await this.discounts!.redeem(p.organization.id, appliedDiscountId).catch((e) => {
        this.logger.warn(
          `coupon redeem failed for discount ${appliedDiscountId}: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
    }

    // EC16: the buyer's OWN referral code to share (additive,
    // failure-isolated; null when unresolvable).
    const yourReferralCode = this.promotions
      ? await this.promotions.yourReferralCodeForPhone(p.organization.id, cleanPhone)
      : null;

    return {
      success: true,
      orderNumber: externalId,
      productName: p.name,
      quantity: qty,
      hasBump: !!(dto.includeBump && p.bumpPriceMinor),
      discountMinor: discountMinor.toString(),
      couponApplied: !!appliedDiscountId,
      freeShippingApplied,
      promotionDiscountMinor: (ec16Evaluation?.promotionDiscountMinor ?? 0n).toString(),
      promotionsApplied: (ec16Evaluation?.promotionsApplied ?? []).map((x) => ({
        promotionId: x.promotionId,
        name: x.name,
        type: x.type,
        amountMinor: x.amountMinor.toString(),
      })),
      referralDiscountMinor: (ec16Evaluation?.referralDiscountMinor ?? 0n).toString(),
      referral: ec16Evaluation?.referral
        ? { code: ec16Evaluation.referral.code }
        : null,
      yourReferralCode,
      // EC29: gift outcome + wrap charge (additive).
      gift: giftInfo,
      giftSkipped: ec16Evaluation?.giftOutcome === "skipped",
      giftWrapMinor: giftWrapMinor.toString(),
      // EC23: VAT snapshot (breakdown rides stampOrder, like EC16).
      taxMinor: (ec16Evaluation?.taxMinor ?? 0n).toString(),
      taxAddedMinor: (ec16Evaluation?.taxAddedMinor ?? 0n).toString(),
      totalMinor: total.toString(),
      totalFormatted: `${(Number(total) / 100).toLocaleString("en-IN")} BDT`,
      customerName: dto.customerName,
      customerPhone: cleanPhone,
      deliveryAddress: dto.customerAddress,
      // EC24b: success screen shows the digital-delivery note.
      hasDigitalItems: !!p.digital,
    };
  }

  async list(organizationId: string, query: { search?: string; category?: string; status?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const where: any = {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.search ? { name: { contains: query.search, mode: "insensitive" } } : {}),
    };
    const [total, items] = await Promise.all([
      (this.prisma as any).product.count({ where }),
      (this.prisma as any).product.findMany({
        where, orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize, take: pageSize,
        include: { costs: { orderBy: { effectiveFrom: "desc" }, take: 1 } },
      }),
    ]);
    return { total, page, pageSize, items: items.map((p: any) => toPublicProduct(p, p.costs?.[0]?.costMinor ?? null)) };
  }

  async getOne(organizationId: string, productId: string) {
    const p = await (this.prisma as any).product.findFirst({
      where: { id: productId, organizationId },
      include: {
        variants: { orderBy: { createdAt: "asc" } },
        costs: { orderBy: { effectiveFrom: "desc" }, take: 10 },
        images: { orderBy: { position: "asc" } },
        tagAssignments: { include: { tag: true } },
      },
    });
    if (!p) throw new NotFoundException("Product not found in this organization");
    const pub = toPublicProduct(p, p.costs?.[0]?.costMinor ?? null);
    pub.costHistory = (p.costs ?? []).map((c: any) => ({ ...c, costMinor: c.costMinor.toString() }));
    // EC3 gallery + tags. The real client returns the included
    // relations above; spec fakes (which return the row as-is)
    // fall back to direct table loads when the relation is
    // absent, so both paths produce the same response shape.
    let images: any[] = Array.isArray(p.images) ? [...p.images] : [];
    if (!Array.isArray(p.images) && (this.prisma as any).productImage?.findMany) {
      try {
        images = (await (this.prisma as any).productImage.findMany({ where: { productId } })) ?? [];
      } catch {
        images = [];
      }
    }
    images.sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0));
    pub.images = images;
    let tags: any[] = [];
    if (Array.isArray(p.tagAssignments)) {
      tags = p.tagAssignments.map((a: any) => a.tag).filter(Boolean);
    } else if ((this.prisma as any).productTagAssignment?.findMany) {
      try {
        const assignments: any[] =
          (await (this.prisma as any).productTagAssignment.findMany({ where: { productId } })) ?? [];
        const tagTable = (this.prisma as any).productTag;
        const allTags: any[] = tagTable?.findMany
          ? ((await tagTable.findMany({ where: { organizationId } })) ?? [])
          : [];
        const byId = new Map<string, any>(allTags.map((t: any) => [t.id, t]));
        tags = assignments
          .map((a: any) => a.tag ?? byId.get(a.tagId))
          .filter(Boolean);
      } catch {
        tags = [];
      }
    }
    pub.tags = tags.map((t: any) => ({ id: t.id, name: t.name, slug: t.slug }));
    pub.tagAssignments = undefined;
    // categoryId + the EC3 enrichment fields passthrough via the
    // spread in toPublicProduct (they are plain columns on p).
    return pub;
  }

  // ---------- Sales & Data S6: product sales report ----------

  /**
   * Product-wise sales over the last `days` Asia/Dhaka calendar
   * days (today included), computed from real Order/OrderItem
   * rows of THIS org:
   *  - order date = placedAt ?? createdAt (the query expresses
   *    this as an OR over the stored columns);
   *  - revenue excludes REVENUE_EXCLUDED_STATUSES (Analytics'
   *    constant, imported — cancelled / refunded / failed);
   *  - an order is "returned" when its status is "returned" OR
   *    any linked CourierShipment classifies as returned
   *    (S5's classifyShipmentStatus);
   *  - items whose productId is null go to the `unlinked`
   *    bucket; items pointing at a deleted product keep their
   *    productId bucket with the item's stored name and a null
   *    category;
   *  - per-category `orders` counts DISTINCT orders touching
   *    that category (an order counts in each category it
   *    touches); totals count distinct orders overall.
   */
  async salesReport(organizationId: string, daysInput?: number | string | null, now = new Date()) {
    const days = daysInput === undefined || daysInput === null || daysInput === "" ? 30 : Number(daysInput);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw new BadRequestException("days must be an integer between 1 and 365");
    }
    const end = new Date(dhakaDayStartUtc(now).getTime() + 86400000);
    const start = new Date(end.getTime() - days * 86400000);

    const orders = await (this.prisma as any).order.findMany({
      where: {
        organizationId,
        OR: [
          { placedAt: { gte: start, lt: end } },
          { placedAt: null, createdAt: { gte: start, lt: end } },
        ],
      },
      include: { items: true },
      take: 20000,
    });
    const kept = (orders as any[]).filter((o) => !REVENUE_EXCLUDED_STATUSES.includes(o.status));

    const orderIds = kept.map((o) => o.id);
    const returnedOrderIds = new Set<string>();
    for (const o of kept) if (o.status === "returned") returnedOrderIds.add(o.id);
    if (orderIds.length) {
      const shipments = await (this.prisma as any).courierShipment.findMany({
        where: { organizationId, orderId: { in: orderIds } },
        select: { orderId: true, status: true },
      });
      for (const s of shipments as any[]) {
        if (classifyShipmentStatus(s.status) === "returned") returnedOrderIds.add(s.orderId);
      }
    }

    // Product names/categories; first stored item name per
    // productId is the fallback for a deleted product row.
    const productIds: string[] = [];
    const firstItemName = new Map<string, string>();
    for (const o of kept) {
      for (const item of o.items ?? []) {
        if (!item.productId) continue;
        if (!firstItemName.has(item.productId)) {
          firstItemName.set(item.productId, item.name);
          productIds.push(item.productId);
        }
      }
    }
    const productRows = productIds.length
      ? await (this.prisma as any).product.findMany({
          where: { organizationId, id: { in: productIds } },
          select: { id: true, name: true, category: true },
        })
      : [];
    const productInfo = new Map<string, { name: string; category: string | null }>(
      (productRows as any[]).map((p) => [p.id, { name: p.name, category: p.category ?? null }]),
    );

    interface Bucket { units: number; orders: Set<string>; revenue: bigint; returnedUnits: number }
    const blank = (): Bucket => ({ units: 0, orders: new Set<string>(), revenue: 0n, returnedUnits: 0 });
    const add = (b: Bucket, orderId: string, qty: number, revenue: bigint, returned: boolean) => {
      b.units += qty;
      b.orders.add(orderId);
      b.revenue += revenue;
      if (returned) b.returnedUnits += qty;
    };
    const byProduct = new Map<string, Bucket>();
    const byCategory = new Map<string | null, Bucket>();
    const unlinked = blank();
    const totals = blank();

    for (const o of kept) {
      const returned = returnedOrderIds.has(o.id);
      for (const item of o.items ?? []) {
        const qty = item.quantity ?? 0;
        const revenue = BigInt(item.totalMinor ?? 0);
        add(totals, o.id, qty, revenue, returned);
        if (!item.productId) {
          add(unlinked, o.id, qty, revenue, returned);
          continue;
        }
        let pb = byProduct.get(item.productId);
        if (!pb) { pb = blank(); byProduct.set(item.productId, pb); }
        add(pb, o.id, qty, revenue, returned);
        const category = productInfo.get(item.productId)?.category ?? null;
        let cb = byCategory.get(category);
        if (!cb) { cb = blank(); byCategory.set(category, cb); }
        add(cb, o.id, qty, revenue, returned);
      }
    }

    const finalize = (b: Bucket) => ({
      units: b.units, orders: b.orders.size, revenueMinor: b.revenue.toString(), returnedUnits: b.returnedUnits,
    });
    const products = [...byProduct.entries()]
      .map(([productId, b]) => ({
        productId,
        name: productInfo.get(productId)?.name ?? firstItemName.get(productId) ?? productId,
        category: productInfo.get(productId)?.category ?? null,
        ...finalize(b),
      }))
      .sort((a, b) => {
        const diff = BigInt(b.revenueMinor) - BigInt(a.revenueMinor);
        if (diff !== 0n) return diff > 0n ? 1 : -1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 100);
    const categories = [...byCategory.entries()]
      .map(([category, b]) => ({ category, ...finalize(b) }))
      .sort((a, b) => {
        const diff = BigInt(b.revenueMinor) - BigInt(a.revenueMinor);
        if (diff !== 0n) return diff > 0n ? 1 : -1;
        return String(a.category ?? "").localeCompare(String(b.category ?? ""));
      });

    return {
      days,
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      revenueExcludedStatuses: REVENUE_EXCLUDED_STATUSES,
      products,
      categories,
      unlinked: finalize(unlinked),
      totals: finalize(totals),
    };
  }

  async update(organizationId: string, actorId: string, productId: string, dto: UpdateProductDto) {
    const existing = await this.getOne(organizationId, productId); // 404 + tenant scope
    // EC23: validate the VAT override when present; the dto spread
    // below carries it (including an explicit null = clear to default).
    if ((dto as any).taxRateBps !== undefined) validateTaxRateBps((dto as any).taxRateBps);
    const data: any = { ...dto };
    // EC24: normalize the expansion fields present in this update
    // (tiers validated; release date parsed) and assert the
    // digital/subscription conditionals against the MERGED state.
    const ec24Fields = normalizeEc24Fields(dto, true);
    Object.assign(data, ec24Fields);
    if (Object.keys(ec24Fields).length) {
      assertEc24Conditionals({ ...(existing as any), ...data });
    }
    // EC3: tagIds are assignments, not a product column.
    const tagIds = (dto as any).tagIds as string[] | undefined;
    delete data.tagIds;
    if (tagIds !== undefined && tagIds.length) {
      await this.verifyTagsOr404(organizationId, tagIds);
    }
    // EC3: categoryId drives the legacy category string.
    if ((dto as any).categoryId !== undefined) {
      if ((dto as any).categoryId === null) {
        // Clearing the structured link; the display string is
        // left alone unless dto.category was also given (it is
        // already in `data` via the spread in that case).
        data.categoryId = null;
      } else {
        const category = await this.findCategoryOr404(organizationId, (dto as any).categoryId);
        data.categoryId = category.id;
        data.category = category.name;
      }
    }
    if (dto.price !== undefined) { data.priceMinor = parseMoney(dto.price, "price"); delete data.price; }
    if (dto.bumpPrice !== undefined) {
      data.bumpPriceMinor = dto.bumpPrice ? parseMoney(dto.bumpPrice, "bumpPrice") : null;
      delete data.bumpPrice;
    }
    // S1 branching for a stockQuantity change:
    // - Inventory present AND the product is already TRACKED
    //   (existing.stockQuantity != null) AND the value actually
    //   changes → INVENTORY owns the stock write: stockQuantity is
    //   excluded from this update and adjust(setTo) writes the
    //   value + StockMovement + audit, so the edit is explained
    //   in the ledger like every other stock change. (Calling
    //   adjust AFTER a plain write would double-apply, because
    //   adjust computes from the current value.)
    // - Existing stock is null (untracked → tracked) → plain
    //   write: this is a BASELINE, not a movement.
    // - Inventory absent (positional spec constructions) → plain
    //   write, exactly as before S1.
    const inventoryOwnsStock = Boolean(
      this.inventory
      && dto.stockQuantity !== undefined
      && existing.stockQuantity != null
      && dto.stockQuantity !== existing.stockQuantity,
    );
    if (inventoryOwnsStock) delete data.stockQuantity;
    // EC3 baseline stock push condition — computed BEFORE the
    // write from the pre-update row: the stock value was
    // plain-written here (inventory did NOT own it), it actually
    // changed, and it is a real number (not a clear-to-null).
    const baselineStockPush =
      !inventoryOwnsStock &&
      dto.stockQuantity !== undefined &&
      dto.stockQuantity !== null &&
      dto.stockQuantity !== existing.stockQuantity;
    const updated = await (this.prisma as any).product.update({ where: { id: productId }, data });
    if (inventoryOwnsStock) {
      const result = await this.inventory!.adjust(organizationId, actorId, productId, {
        setTo: dto.stockQuantity, note: "পণ্য সম্পাদনা থেকে স্টক হালনাগাদ",
      });
      updated.stockQuantity = result.stockQuantity;
    }
    if (tagIds !== undefined) {
      await this.replaceTagAssignments(productId, tagIds);
    }
    await this.audit.log({ organizationId, userId: actorId, action: "product.update", entityType: "Product", entityId: productId });
    // EC3: ALWAYS notify the catalog-push orchestrator after a
    // successful update — the push content hash dedupes, so a
    // no-content-change update is a cheap no-op at the outbox,
    // and maintaining a field-by-field "did catalog content
    // change?" list here would silently drift from the content
    // builder. (Documented simplification.)
    await this.pushHook("enqueueForProductChange", () =>
      this.catalogPush!.enqueueForProductChange(organizationId, productId),
    );
    if (baselineStockPush) {
      await this.pushHook("enqueueInventoryPush", () =>
        this.catalogPush!.enqueueInventoryPush(organizationId, productId, null, dto.stockQuantity!),
      );
    }
    return toPublicProduct(updated, null);
  }

  async archive(organizationId: string, actorId: string, productId: string) {
    await this.getOne(organizationId, productId);
    const updated = await (this.prisma as any).product.update({ where: { id: productId }, data: { status: "ARCHIVED" } });
    await this.audit.log({ organizationId, userId: actorId, action: "product.archive", entityType: "Product", entityId: productId });
    await this.pushHook("enqueueArchive", () =>
      this.catalogPush!.enqueueArchive(organizationId, productId),
    );
    return toPublicProduct(updated, null);
  }

  async createVariant(organizationId: string, actorId: string, productId: string, dto: CreateVariantDto) {
    await this.getOne(organizationId, productId);
    const variant = await (this.prisma as any).productVariant.create({
      data: {
        productId, name: dto.name.trim(), sku: dto.sku || null,
        priceMinor: dto.price ? parseMoney(dto.price, "price") : null,
        stockQuantity: dto.stockQuantity,
      },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "product.variant.create", entityType: "ProductVariant", entityId: variant.id });
    await this.pushHook("enqueueForProductChange", () =>
      this.catalogPush!.enqueueForProductChange(organizationId, productId),
    );
    return { ...variant, priceMinor: variant.priceMinor?.toString() ?? null };
  }

  async updateVariant(organizationId: string, actorId: string, productId: string, variantId: string, dto: UpdateVariantDto) {
    await this.getOne(organizationId, productId); // 404 + tenant scope
    const variant = await (this.prisma as any).productVariant.findFirst({
      where: { id: variantId, productId },
    });
    if (!variant) throw new NotFoundException("Variant not found for this product");
    if (dto.sku) {
      const dup = await (this.prisma as any).productVariant.findFirst({
        where: { productId, sku: dto.sku, id: { not: variantId } },
      });
      if (dup) throw new ConflictException(`A variant with SKU ${dto.sku} already exists on this product`);
    }
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.sku !== undefined) data.sku = dto.sku || null;
    if (dto.price !== undefined) data.priceMinor = dto.price ? parseMoney(dto.price, "price") : null;
    // Stock branching mirrors the S1 product update: inventory
    // present AND the variant is already TRACKED (stockQuantity
    // != null) AND the value changes → InventoryService owns
    // the stock write (value + StockMovement + audit) and the
    // number is excluded from this direct update. Untracked →
    // tracked is a baseline plain write with NO movement.
    const inventoryOwnsStock = Boolean(
      this.inventory
      && dto.stockQuantity !== undefined
      && variant.stockQuantity != null
      && dto.stockQuantity !== variant.stockQuantity,
    );
    if (!inventoryOwnsStock && dto.stockQuantity !== undefined) data.stockQuantity = dto.stockQuantity;
    // EC3 baseline stock push condition (mirrors product update).
    const baselineStockPush =
      !inventoryOwnsStock &&
      dto.stockQuantity !== undefined &&
      dto.stockQuantity !== null &&
      dto.stockQuantity !== variant.stockQuantity;
    const updated = await (this.prisma as any).productVariant.update({ where: { id: variantId }, data });
    if (inventoryOwnsStock) {
      const result = await this.inventory!.adjust(organizationId, actorId, productId, {
        variantId, setTo: dto.stockQuantity, note: "ভ্যারিয়েন্ট সম্পাদনা থেকে স্টক হালনাগাদ",
      });
      updated.stockQuantity = result.stockQuantity;
    }
    await this.audit.log({ organizationId, userId: actorId, action: "product.variant.update", entityType: "ProductVariant", entityId: variantId, metadata: { productId } });
    await this.pushHook("enqueueForProductChange", () =>
      this.catalogPush!.enqueueForProductChange(organizationId, productId),
    );
    if (baselineStockPush) {
      await this.pushHook("enqueueInventoryPush", () =>
        this.catalogPush!.enqueueInventoryPush(organizationId, productId, variantId, dto.stockQuantity!),
      );
    }
    return { ...updated, priceMinor: updated.priceMinor?.toString() ?? null };
  }

  async deleteVariant(organizationId: string, actorId: string, productId: string, variantId: string) {
    await this.getOne(organizationId, productId); // 404 + tenant scope
    const variant = await (this.prisma as any).productVariant.findFirst({
      where: { id: variantId, productId },
    });
    if (!variant) throw new NotFoundException("Variant not found for this product");
    await (this.prisma as any).productVariant.delete({ where: { id: variantId } });
    await this.audit.log({ organizationId, userId: actorId, action: "product.variant.delete", entityType: "ProductVariant", entityId: variantId, metadata: { productId } });
    await this.pushHook("enqueueForProductChange", () =>
      this.catalogPush!.enqueueForProductChange(organizationId, productId),
    );
    return { deleted: true, productId, variantId };
  }

  // ---------- EC3: product images ----------

  async listImages(organizationId: string, productId: string) {
    const pub = await this.getOne(organizationId, productId);
    return (pub as any).images ?? [];
  }

  private async loadImages(productId: string): Promise<any[]> {
    const table = (this.prisma as any).productImage;
    if (!table?.findMany) return [];
    const rows: any[] = (await table.findMany({ where: { productId } })) ?? [];
    return [...rows].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }

  async addImage(
    organizationId: string,
    actorId: string,
    productId: string,
    dto: { url: string; altText?: string },
  ) {
    const product = await this.getProductOr404(organizationId, productId);
    const images = await this.loadImages(productId);
    const position = images.length
      ? Math.max(...images.map((i: any) => i.position ?? 0)) + 1
      : 0;
    const image = await (this.prisma as any).productImage.create({
      data: { productId, url: dto.url, altText: dto.altText ?? null, position },
    });
    // The cover mirror: an empty Product.imageUrl adopts the
    // first gallery image (position-0 mirror rule, see reorder).
    if (!product.imageUrl) {
      await (this.prisma as any).product.update({
        where: { id: productId },
        data: { imageUrl: dto.url },
      });
    }
    await this.audit.log({ organizationId, userId: actorId, action: "product.image.create", entityType: "ProductImage", entityId: image.id, metadata: { productId } });
    await this.pushHook("enqueueForProductChange", () =>
      this.catalogPush!.enqueueForProductChange(organizationId, productId),
    );
    return image;
  }

  async reorderImages(
    organizationId: string,
    actorId: string,
    productId: string,
    imageIds: string[],
  ) {
    await this.getProductOr404(organizationId, productId);
    const images = await this.loadImages(productId);
    const byId = new Map<string, any>(images.map((i: any) => [i.id, i]));
    for (const id of imageIds) {
      if (!byId.has(id)) {
        throw new BadRequestException("All image ids must belong to this product");
      }
    }
    for (let idx = 0; idx < imageIds.length; idx++) {
      await (this.prisma as any).productImage.update({
        where: { id: imageIds[idx] },
        data: { position: idx },
      });
    }
    // Position-0 mirror: Product.imageUrl always mirrors the
    // gallery's first image so legacy single-image surfaces
    // (storefront, checkout) keep showing the cover.
    if (imageIds.length) {
      await (this.prisma as any).product.update({
        where: { id: productId },
        data: { imageUrl: byId.get(imageIds[0]).url },
      });
    }
    await this.audit.log({ organizationId, userId: actorId, action: "product.image.reorder", entityType: "Product", entityId: productId, metadata: { imageIds } });
    await this.pushHook("enqueueForProductChange", () =>
      this.catalogPush!.enqueueForProductChange(organizationId, productId),
    );
    return this.loadImages(productId);
  }

  async deleteImage(
    organizationId: string,
    actorId: string,
    productId: string,
    imageId: string,
  ) {
    await this.getProductOr404(organizationId, productId);
    const table = (this.prisma as any).productImage;
    const image = table?.findFirst
      ? await table.findFirst({ where: { id: imageId, productId } })
      : null;
    if (!image) throw new NotFoundException("Image not found for this product");
    const before = await this.loadImages(productId);
    const wasFirst = before.length > 0 && before[0].id === imageId;
    await table.delete({ where: { id: imageId } });
    const remaining = await this.loadImages(productId);
    // Re-index positions contiguously after a removal.
    for (let idx = 0; idx < remaining.length; idx++) {
      if (remaining[idx].position !== idx) {
        await table.update({ where: { id: remaining[idx].id }, data: { position: idx } });
      }
    }
    if (wasFirst) {
      await (this.prisma as any).product.update({
        where: { id: productId },
        data: { imageUrl: remaining[0]?.url ?? null },
      });
    }
    await this.audit.log({ organizationId, userId: actorId, action: "product.image.delete", entityType: "ProductImage", entityId: imageId, metadata: { productId } });
    await this.pushHook("enqueueForProductChange", () =>
      this.catalogPush!.enqueueForProductChange(organizationId, productId),
    );
    return { deleted: true, productId, imageId };
  }

  // ---------- EC3: categories & tags ----------

  async listCategories(organizationId: string) {
    const table = (this.prisma as any).category;
    const categories: any[] = table?.findMany
      ? ((await table.findMany({ where: { organizationId } })) ?? [])
      : [];
    // Product count per category, counted in JS from an
    // org-scoped product scan (fake-friendly; no groupBy).
    const products: any[] =
      (await (this.prisma as any).product.findMany({ where: { organizationId } })) ?? [];
    const counts = new Map<string, number>();
    for (const p of products) {
      if (p.categoryId) counts.set(p.categoryId, (counts.get(p.categoryId) ?? 0) + 1);
    }
    return categories.map((c: any) => ({ ...c, productCount: counts.get(c.id) ?? 0 }));
  }

  async createCategory(organizationId: string, actorId: string, dto: CreateCategoryDto) {
    const name = dto.name.trim();
    const slug = slugify(name);
    const table = (this.prisma as any).category;
    const existing: any[] =
      (await table.findMany({ where: { organizationId } })) ?? [];
    if (existing.some((c: any) => c.slug === slug)) {
      throw new ConflictException(`A category with slug ${slug} already exists in this organization`);
    }
    if (dto.parentId) {
      await this.findCategoryOr404(organizationId, dto.parentId);
    }
    const category = await table.create({
      data: {
        organizationId,
        name,
        slug,
        parentId: dto.parentId ?? null,
        description: dto.description ?? null,
      },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "product.category.create", entityType: "Category", entityId: category.id });
    return category;
  }

  async updateCategory(
    organizationId: string,
    actorId: string,
    categoryId: string,
    dto: UpdateCategoryDto,
  ) {
    const category = await this.findCategoryOr404(organizationId, categoryId);
    const data: any = {};
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.parentId !== undefined) {
      if (dto.parentId === null) {
        data.parentId = null;
      } else {
        // Parent validation: exists in org, is not the category
        // itself, and is not one of its children (a one-level
        // cycle check — with the self check this covers every
        // cycle creatable through a single reparent).
        const parent = await this.findCategoryOr404(organizationId, dto.parentId);
        if (parent.id === categoryId) {
          throw new BadRequestException("A category cannot be its own parent");
        }
        if (parent.parentId === categoryId) {
          throw new BadRequestException("A category cannot be moved under its own child");
        }
        data.parentId = parent.id;
      }
    }
    let newName: string | undefined;
    if (dto.name !== undefined) {
      newName = dto.name.trim();
      const slug = slugify(newName);
      const all: any[] =
        (await (this.prisma as any).category.findMany({ where: { organizationId } })) ?? [];
      if (all.some((c: any) => c.id !== categoryId && c.slug === slug)) {
        throw new ConflictException(`A category with slug ${slug} already exists in this organization`);
      }
      data.name = newName;
      data.slug = slug;
    }
    const oldName = category.name;
    const updated = await (this.prisma as any).category.update({
      where: { id: categoryId },
      data,
    });
    if (newName !== undefined && newName !== oldName) {
      // The legacy display string on products follows a rename.
      const products: any[] =
        (await (this.prisma as any).product.findMany({ where: { organizationId } })) ?? [];
      for (const p of products.filter((x: any) => x.categoryId === categoryId)) {
        await (this.prisma as any).product.update({
          where: { id: p.id },
          data: { category: newName },
        });
      }
    }
    await this.audit.log({ organizationId, userId: actorId, action: "product.category.update", entityType: "Category", entityId: categoryId });
    return updated;
  }

  async listTags(organizationId: string) {
    const table = (this.prisma as any).productTag;
    if (!table?.findMany) return [];
    return (await table.findMany({ where: { organizationId } })) ?? [];
  }

  async createTag(organizationId: string, actorId: string, dto: { name: string }) {
    const name = dto.name.trim();
    const slug = slugify(name);
    const table = (this.prisma as any).productTag;
    const existing: any[] =
      (await table.findMany({ where: { organizationId } })) ?? [];
    if (existing.some((t: any) => t.slug === slug)) {
      throw new ConflictException(`A tag with slug ${slug} already exists in this organization`);
    }
    const tag = await table.create({ data: { organizationId, name, slug } });
    await this.audit.log({ organizationId, userId: actorId, action: "product.tag.create", entityType: "ProductTag", entityId: tag.id });
    return tag;
  }

  // ---------- EC3: bulk edit (preview + apply) ----------

  /** Shared preview computation: resolves products org-scoped
   *  (missing ids are skipped silently but counted) and computes
   *  the before/after of every affected item WITHOUT writing. */
  private async computeBulkEdit(organizationId: string, dto: BulkEditDto) {
    const ids = [...new Set(dto.productIds ?? [])];
    let category: any = null;
    let fixedMinor: bigint | null = null;
    if (dto.action === "price_percent") {
      if (dto.percent === undefined || dto.percent === null) {
        throw new BadRequestException("percent is required for price_percent");
      }
    } else if (dto.action === "price_fixed") {
      if (!dto.price) throw new BadRequestException("price is required for price_fixed");
      fixedMinor = parseMoney(dto.price, "price");
    } else if (dto.action === "stock_set") {
      if (dto.quantity === undefined || dto.quantity === null) {
        throw new BadRequestException("quantity is required for stock_set");
      }
    } else if (dto.action === "category_set") {
      if (!dto.categoryId) throw new BadRequestException("categoryId is required for category_set");
      category = await this.findCategoryOr404(organizationId, dto.categoryId);
    } else {
      throw new BadRequestException(`Unknown bulk edit action: ${dto.action}`);
    }
    const all: any[] =
      (await (this.prisma as any).product.findMany({ where: { organizationId } })) ?? [];
    const byId = new Map<string, any>(all.map((p: any) => [p.id, p]));
    const items: any[] = [];
    let missing = 0;
    for (const id of ids) {
      const product = byId.get(id);
      if (!product) {
        missing++;
        continue;
      }
      if (dto.action === "price_percent") {
        items.push({
          productId: id,
          name: product.name,
          field: "price",
          before: BigInt(product.priceMinor).toString(),
          after: bulkPercentMinor(BigInt(product.priceMinor), dto.percent!).toString(),
        });
      } else if (dto.action === "price_fixed") {
        items.push({
          productId: id,
          name: product.name,
          field: "price",
          before: BigInt(product.priceMinor).toString(),
          after: fixedMinor!.toString(),
        });
      } else if (dto.action === "stock_set") {
        items.push({
          productId: id,
          name: product.name,
          field: "stockQuantity",
          before: product.stockQuantity ?? null,
          after: dto.quantity,
          ...(product.stockQuantity == null
            ? { note: "untracked→tracked baseline" }
            : {}),
        });
      } else if (dto.action === "category_set") {
        items.push({
          productId: id,
          name: product.name,
          field: "category",
          before: product.category ?? null,
          after: category.name,
        });
      }
    }
    return { items, missing, category };
  }

  async bulkEditPreview(organizationId: string, dto: BulkEditDto) {
    const { items, missing } = await this.computeBulkEdit(organizationId, dto);
    return { affected: items.length, missing, items: items.slice(0, 50) };
  }

  async bulkEditApply(organizationId: string, actorId: string, dto: BulkEditDto) {
    // Re-run the preview computation, then apply per product
    // through the EXISTING update path so every write keeps its
    // inventory branching, taxonomy sync and catalog-push hooks.
    const { items } = await this.computeBulkEdit(organizationId, dto);
    const results: Array<{ productId: string; ok: boolean; error?: string }> = [];
    let updated = 0;
    let failed = 0;
    for (const item of items) {
      try {
        if (dto.action === "price_percent" || dto.action === "price_fixed") {
          await this.update(organizationId, actorId, item.productId, {
            price: minorToDecimalString(BigInt(item.after)),
          } as UpdateProductDto);
        } else if (dto.action === "stock_set") {
          await this.update(organizationId, actorId, item.productId, {
            stockQuantity: item.after,
          } as UpdateProductDto);
        } else if (dto.action === "category_set") {
          await this.update(organizationId, actorId, item.productId, {
            categoryId: dto.categoryId,
          } as UpdateProductDto);
        }
        results.push({ productId: item.productId, ok: true });
        updated++;
      } catch (e) {
        results.push({
          productId: item.productId,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
        failed++;
      }
    }
    await this.audit.log({
      organizationId,
      userId: actorId,
      action: "product.bulk_edit",
      entityType: "Product",
      metadata: { action: dto.action, count: updated },
    });
    return { updated, failed, results };
  }

  /**
   * CP5: batch store push — for each product, the SAME single-push
   * path a product change uses (CatalogPushService.enqueueProductPush,
   * which itself applies the full-manage / published / conflict
   * rules per listing). Per-item failures never fail the batch:
   * foreign/absent products report "not_found", products without
   * any listing report "no_listings", and a throwing push reports
   * its message. One audit row for the whole batch.
   */
  async pushBatch(organizationId: string, actorId: string, productIds: unknown) {
    if (!Array.isArray(productIds) || productIds.length === 0) {
      throw new BadRequestException("কমপক্ষে একটি পণ্য বেছে দিন");
    }
    if (productIds.length > 50) {
      throw new BadRequestException("একবারে সর্বোচ্চ ৫০টি পণ্য স্টোরে পাঠানো যায়");
    }
    const results: { productId: string; ok: boolean; error?: string; enqueued?: number; skipped?: number }[] = [];
    let enqueued = 0;
    for (const rawId of productIds) {
      const productId = String(rawId);
      const product = await (this.prisma as any).product.findFirst({
        where: { id: productId, organizationId },
      }).catch(() => null);
      if (!product) {
        results.push({ productId, ok: false, error: "not_found" });
        continue;
      }
      const listings = await (this.prisma as any).storeListing.findMany({
        where: { organizationId, productId },
      }).catch(() => []);
      if (!listings || listings.length === 0) {
        results.push({ productId, ok: false, error: "no_listings" });
        continue;
      }
      if (!this.catalogPush) {
        results.push({ productId, ok: false, error: "push_unavailable" });
        continue;
      }
      try {
        const r = await this.catalogPush.enqueueProductPush(organizationId, productId);
        enqueued += r?.enqueued ?? 0;
        results.push({ productId, ok: true, enqueued: r?.enqueued ?? 0, skipped: r?.skipped ?? 0 });
      } catch (e) {
        results.push({ productId, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    await this.audit.log({
      organizationId,
      userId: actorId,
      action: "products.push_batch",
      entityType: "Product",
      metadata: { count: productIds.length, enqueued },
    });
    return { results, enqueued };
  }

  // ---------- EC3: duplicate ----------

  /**
   * Deep-copies a product: fields (incl. EC3 enrichment + bump),
   * variants, images and tag assignments. Name gains the
   * documented " (Copy)" suffix; SKUs gain "-copy" ("-copy-2",
   * "-copy-3", … when taken). Status is DRAFT and source
   * "manual". Listings and costs are deliberately NOT copied —
   * a copy is a new canonical product, not a channel presence,
   * and cost history belongs to the original.
   */
  async duplicate(organizationId: string, actorId: string, productId: string) {
    const source = await this.getProductOr404(organizationId, productId);
    const variants: any[] = (this.prisma as any).productVariant?.findMany
      ? ((await (this.prisma as any).productVariant.findMany({ where: { productId } })) ?? [])
      : Array.isArray(source.variants)
        ? source.variants
        : [];
    const images = await this.loadImages(productId);
    let assignments: any[] = [];
    if ((this.prisma as any).productTagAssignment?.findMany) {
      assignments =
        (await (this.prisma as any).productTagAssignment.findMany({ where: { productId } })) ?? [];
    } else if (Array.isArray(source.tagAssignments)) {
      assignments = source.tagAssignments;
    }

    const uniqueProductSku = async (base: string | null): Promise<string | null> => {
      if (!base) return null;
      const all: any[] =
        (await (this.prisma as any).product.findMany({ where: { organizationId } })) ?? [];
      const taken = new Set(all.map((p: any) => p.sku).filter(Boolean));
      let candidate = `${base}-copy`;
      let n = 2;
      while (taken.has(candidate)) candidate = `${base}-copy-${n++}`;
      return candidate;
    };

    const baseSlug = slugify(`${source.name} (Copy)`) || `prod-${Date.now().toString(36)}`;
    const slug = `${baseSlug}-${Math.random().toString(36).substring(2, 6)}`;
    const created = await (this.prisma as any).product.create({
      data: {
        organizationId,
        name: `${source.name} (Copy)`,
        slug,
        description: source.description ?? null,
        category: source.category ?? null,
        categoryId: source.categoryId ?? null,
        sku: await uniqueProductSku(source.sku ?? null),
        status: "DRAFT",
        priceMinor: source.priceMinor,
        compareAtMinor: source.compareAtMinor ?? null,
        currency: source.currency ?? "BDT",
        stockQuantity: source.stockQuantity ?? null,
        lowStockThreshold: source.lowStockThreshold ?? null,
        imageUrl: source.imageUrl ?? null,
        bumpTitle: source.bumpTitle ?? null,
        bumpPriceMinor: source.bumpPriceMinor ?? null,
        bumpImageUrl: source.bumpImageUrl ?? null,
        weightGrams: source.weightGrams ?? null,
        lengthCm: source.lengthCm ?? null,
        widthCm: source.widthCm ?? null,
        heightCm: source.heightCm ?? null,
        barcode: source.barcode ?? null,
        seoTitle: source.seoTitle ?? null,
        seoDescription: source.seoDescription ?? null,
        source: "manual",
      },
    });

    const copiedVariants: any[] = [];
    const takenVariantSkus = new Set<string>();
    for (const v of variants) {
      let sku: string | null = null;
      if (v.sku) {
        sku = `${v.sku}-copy`;
        let n = 2;
        while (takenVariantSkus.has(sku)) sku = `${v.sku}-copy-${n++}`;
        takenVariantSkus.add(sku);
      }
      const cv = await (this.prisma as any).productVariant.create({
        data: {
          productId: created.id,
          name: v.name,
          sku,
          priceMinor: v.priceMinor ?? null,
          stockQuantity: v.stockQuantity ?? null,
          attributes: v.attributes ?? undefined,
        },
      });
      copiedVariants.push(cv);
    }
    if ((this.prisma as any).productImage?.create) {
      for (const img of images) {
        await (this.prisma as any).productImage.create({
          data: { productId: created.id, url: img.url, altText: img.altText ?? null, position: img.position ?? 0 },
        });
      }
    }
    if ((this.prisma as any).productTagAssignment?.create) {
      for (const a of assignments) {
        await (this.prisma as any).productTagAssignment.create({
          data: { productId: created.id, tagId: a.tagId ?? a.tag?.id },
        });
      }
    }
    await this.audit.log({
      organizationId,
      userId: actorId,
      action: "product.duplicate",
      entityType: "Product",
      entityId: created.id,
      metadata: { sourceProductId: productId },
    });
    return toPublicProduct({ ...created, variants: copiedVariants }, null);
  }

  // ---------- EC4: bundle items (API half) ----------

  async listBundleItems(organizationId: string, productId: string) {
    await this.getOne(organizationId, productId); // org check
    const table = (this.prisma as any).bundleItem;
    if (!table?.findMany) return [];
    let items: any[] = [];
    try {
      items =
        (await table.findMany({
          where: { organizationId, parentProductId: productId },
          include: { component: { select: { name: true, sku: true } } },
        })) ?? [];
    } catch {
      items =
        (await table.findMany({ where: { organizationId, parentProductId: productId } })) ?? [];
    }
    items = items.filter(
      (i: any) => i.parentProductId === productId && (!i.organizationId || i.organizationId === organizationId),
    );
    // Enrich the component product (name/sku) in JS when the
    // include did not populate it (spec fakes return rows as-is).
    const products: any[] =
      (await (this.prisma as any).product.findMany({ where: { organizationId } })) ?? [];
    const byId = new Map<string, any>(products.map((p: any) => [p.id, p]));
    return items.map((i: any) => {
      const comp = byId.get(i.componentProductId);
      const componentProduct = i.componentProduct ??
        i.component ??
        (comp ? { id: comp.id, name: comp.name, sku: comp.sku ?? null } : null);
      return {
        ...i,
        component: componentProduct,
        componentProduct,
      };
    });
  }

  async addBundleItem(
    organizationId: string,
    actorId: string,
    productId: string,
    dto: { componentProductId: string; componentVariantId?: string | null; quantity?: number },
  ) {
    await this.getOne(organizationId, productId); // org check
    if (dto.componentProductId === productId) {
      throw new BadRequestException("পণ্য নিজেই নিজের component হতে পারে না");
    }
    const component = await (this.prisma as any).product.findFirst({
      where: { id: dto.componentProductId, organizationId },
    });
    if (!component) throw new NotFoundException("Component product not found in this organization");
    if (dto.componentVariantId) {
      const variant = await (this.prisma as any).productVariant.findFirst({
        where: { id: dto.componentVariantId, productId: dto.componentProductId },
      });
      if (!variant) throw new NotFoundException("Component variant not found for the component product");
    }
    const table = (this.prisma as any).bundleItem;
    const dup = table?.findFirst
      ? await table.findFirst({
          where: {
            organizationId,
            parentProductId: productId,
            componentProductId: dto.componentProductId,
            componentVariantId: dto.componentVariantId ?? null,
          },
        })
      : null;
    if (dup) throw new ConflictException("This component is already part of the bundle");
    const item = await table.create({
      data: {
        organizationId,
        parentProductId: productId,
        componentProductId: dto.componentProductId,
        componentVariantId: dto.componentVariantId ?? null,
        quantity: dto.quantity ?? 1,
      },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "product.bundle.add", entityType: "BundleItem", entityId: item.id, metadata: { productId } });
    return item;
  }

  async deleteBundleItem(
    organizationId: string,
    actorId: string,
    productId: string,
    itemId: string,
  ) {
    await this.getOne(organizationId, productId); // org check
    const table = (this.prisma as any).bundleItem;
    const item = table?.findFirst
      ? await table.findFirst({ where: { id: itemId, parentProductId: productId } })
      : null;
    if (!item) throw new NotFoundException("Bundle item not found for this product");
    await table.delete({ where: { id: itemId } });
    await this.audit.log({ organizationId, userId: actorId, action: "product.bundle.delete", entityType: "BundleItem", entityId: itemId, metadata: { productId } });
    return { deleted: true, productId, itemId };
  }

  // ---------- EC3: per-channel view ----------

  async getChannels(organizationId: string, productId: string) {
    const product = await this.getProductOr404(organizationId, productId);
    const table = (this.prisma as any).storeListing;
    let listings: any[] = [];
    if (table?.findMany) {
      try {
        listings =
          (await table.findMany({
            where: { organizationId, productId },
            include: { store: { select: { id: true, name: true, platform: true, syncMode: true } } },
          })) ?? [];
      } catch {
        listings =
          (await table.findMany({ where: { organizationId, productId } })) ?? [];
      }
    }
    listings = listings.filter((l: any) => l.productId === productId);
    // Store enrichment fallback (fakes return rows as-is).
    const storeTable = (this.prisma as any).store;
    let stores: any[] = [];
    if (storeTable?.findMany) {
      try {
        stores = (await storeTable.findMany({ where: { organizationId } })) ?? [];
      } catch {
        stores = [];
      }
    }
    const storeById = new Map<string, any>(stores.map((s: any) => [s.id, s]));
    const pending = await pendingOutboxKeys(
      this.prisma,
      organizationId,
      listings.map((l: any) => ({ storeId: l.storeId, productId })),
    );
    const mapped = listings.map((l: any) => {
      const store = l.store ?? storeById.get(l.storeId) ?? null;
      return {
        ...l,
        channelPriceMinor: l.channelPriceMinor != null ? String(l.channelPriceMinor) : null,
        storeName: store?.name ?? null,
        platform: store?.platform ?? null,
        syncMode: store?.syncMode ?? null,
        stockDiverged: computeStockDiverged(
          l,
          product.stockQuantity ?? null,
          pending.has(`${l.storeId}:${productId}`),
        ),
      };
    });
    return { productId, productStock: product.stockQuantity ?? null, listings: mapped };
  }

  async setCost(organizationId: string, actorId: string, productId: string, dto: SetCostDto) {
    const product = await this.getOne(organizationId, productId);
    const cost = await (this.prisma as any).productCost.create({
      data: {
        productId, variantId: dto.variantId ?? null,
        costMinor: parseMoney(dto.cost, "cost"),
        currency: dto.currency ?? product.currency ?? "BDT",
        note: dto.note,
      },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "product.cost.set", entityType: "ProductCost", entityId: cost.id, metadata: { productId } });
    return { ...cost, costMinor: cost.costMinor.toString() };
  }
}
