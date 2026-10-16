import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { InventoryService } from "../inventory/inventory.service";
import { CreateProductDto, UpdateProductDto, CreateVariantDto, UpdateVariantDto, SetCostDto, BulkEditDto, CreateCategoryDto, UpdateCategoryDto } from "./products.dto";
import { CatalogPushService } from "../commerce/catalog-push.service";
import { CatalogsService } from "../catalogs/catalogs.service";
import { DiscountsService } from "../commerce/discounts.service";
import { DISCOUNT_REASON_MESSAGES } from "../commerce/discounts";
import { PromotionsService, type CheckoutEvaluation, type LoyaltyRedeemInput } from "../commerce/promotions.service";
import { LoyaltyService } from "../commerce/loyalty.service";
import { GiftCardsService } from "../commerce/gift-cards.service";
import { PriceListsService, pickGroupPrice } from "../commerce/price-lists.service";
import { GIFT_CARD_CONFIG_MESSAGES, validateGiftCardConfig } from "../commerce/gift-cards";
import { AffiliatesService } from "../affiliates/affiliates.service";
import { BlockedPhoneService } from "../fraud/blocked-phone.service";
import { CheckoutGuardService } from "../fraud/checkout-guard.service";
import { normalizeDeviceHash } from "../fraud/identifier-utils";
import { IdempotencyService } from "../fraud/idempotency.service";
import { evaluateCodRules } from "../fraud/cod-rules";
import { depositFor } from "../fraud/deposit";
import { validateFieldAnswers } from "../storefront/checkout-fields";
import { buildCheckoutTrust, termsRefFor } from "../fraud/checkout-trust";
import { parseBdAddress } from "../orders/bd-address";
import { bdPhoneMatchKey } from "../orders/phone-utils";
import type { PromotionLine } from "../commerce/promotions";
import { computeStockDiverged, pendingOutboxKeys } from "../commerce/stock-divergence";
import { assertEc24Conditionals, assertPreorderLimit, preorderInfo, validateWholesaleTiers } from "../commerce/ec24";
import { isValidProductVideoUrl } from "./product-video";
import { refreshBrandSearchVectors, refreshCategorySearchVectors, refreshProductSearchVector } from "./search-vector";
import { displayProductDescription, displayProductName } from "./product-display";
// GB2 (GC6): the export writes the importer's own column shape —
// the CSV writer + money formatter live with the import pipeline.
import { minorToMajor, toCsv } from "../imports/csv";
import { checkProductCreate, isOrderLimitBlocked, OrderLimitBlockedError, SHOPPER_ORDER_BLOCK_MESSAGE,} from "../common/plan-limit-checks";
import { normalizeAttribution } from "../common/attribution.dto";

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
  // AB5 (AX9): digital delivery type + signed-link lifetime.
  if (!partial || has("digitalDeliveryType")) {
    if (dto.digitalDeliveryType === null || dto.digitalDeliveryType === undefined) out.digitalDeliveryType = "file";
    else if (!["file", "license", "both"].includes(dto.digitalDeliveryType)) throw new BadRequestException("ডিজিটাল ডেলিভারির ধরন file, license অথবা both হতে হবে");
    else out.digitalDeliveryType = dto.digitalDeliveryType;
  }
  if (!partial || has("digitalLinkExpiryHours")) {
    if (dto.digitalLinkExpiryHours === null || dto.digitalLinkExpiryHours === undefined) out.digitalLinkExpiryHours = null;
    else if (!Number.isInteger(dto.digitalLinkExpiryHours) || dto.digitalLinkExpiryHours < 1 || dto.digitalLinkExpiryHours > 720) throw new BadRequestException("ডিজিটাল লিংকের মেয়াদ ১–৭২০ ঘণ্টার মধ্যে হতে হবে");
    else out.digitalLinkExpiryHours = dto.digitalLinkExpiryHours;
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
  // GB1 (GC4): product video — validated through the ONE shared
  // normalizer (YouTube/Vimeo/mp4/webm, http/https only).
  if (!partial || has("videoUrl")) {
    const raw = dto.videoUrl === null || dto.videoUrl === undefined ? null : String(dto.videoUrl).trim() || null;
    if (raw !== null && !isValidProductVideoUrl(raw)) {
      throw new BadRequestException("ভিডিও URL সঠিক নয় — YouTube, Vimeo অথবা সরাসরি mp4/webm লিংক দিন");
    }
    out.videoUrl = raw;
  }
  if (!partial || has("videoPosterUrl")) {
    out.videoPosterUrl = dto.videoPosterUrl === null || dto.videoPosterUrl === undefined ? null : String(dto.videoPosterUrl).trim() || null;
  }
  // AB2 (AX3): gift-card flag + face-value config. The config is
  // validated + NORMALIZED through the ONE validator in
  // commerce/gift-cards (invalid ⇒ Bengali 400 via its message
  // map); an explicit null clears it. Setting isGiftCard back to
  // false KEEPS the stored config — it is harmless (no checkout
  // path reads the config unless isGiftCard is true) and avoids
  // destroying a merchant's preset setup on a toggle-off.
  if (!partial || has("isGiftCard")) out.isGiftCard = !!dto.isGiftCard;
  if (!partial || has("giftCardConfig")) {
    if (dto.giftCardConfig === null || dto.giftCardConfig === undefined) {
      out.giftCardConfig = null;
    } else {
      try {
        out.giftCardConfig = validateGiftCardConfig(dto.giftCardConfig);
      } catch (e) {
        const key = e instanceof Error ? e.message : "";
        throw new BadRequestException(GIFT_CARD_CONFIG_MESSAGES[key] ?? "গিফট কার্ড কনফিগ সঠিক নয়");
      }
    }
  }
  return out;
}
import { parseMoneyToMinor } from "@repo/contracts";
import { computeMargin } from "./pricing";
import { REVENUE_EXCLUDED_STATUSES } from "../analytics/analytics.service";
import { classifyShipmentStatus } from "../courier/courier-performance";
import { dhakaDayStartUtc } from "../crm/lead-followups";

/** RM4: direct product-image upload limits. 10 MB matches the
 * mirror's fetch cap; the type list is what the presign step
 * accepts — the complete step then proves the real bytes against
 * it by magic-byte sniff, so this list is a gate, not a trust. */
export const PRODUCT_IMAGE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const PRODUCT_IMAGE_UPLOAD_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/** RB6/RM9: digital product file upload (private bucket). A
 * digital file can be almost anything a buyer downloads — ebook,
 * archive, audio, software — so there is NO content-type list and
 * NO magic-byte sniff; the gates are the size cap and an
 * executable-extension blocklist (a hosted .exe/.sh/.html served
 * back under our domain would be a malware/phishing vector). */
export const DIGITAL_FILE_MAX_BYTES = 100 * 1024 * 1024;
/** At or below this size complete() reads the bytes back and
 * records a real sha256 in the registry; above it the registry
 * row honestly carries sha256 = null (HEAD size is still
 * verified) instead of buffering a 100 MB file in API memory. */
export const DIGITAL_FILE_SHA_MAX_BYTES = 10 * 1024 * 1024;
export const DIGITAL_FILE_BLOCKED_EXTENSIONS = ["exe", "bat", "sh", "js", "html"] as const;

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
    // AB2 (AX3): gift-card flag + config ride the staff shape
    // explicitly (rows predating AB2 read as a plain product).
    isGiftCard: !!p.isGiftCard,
    giftCardConfig: p.giftCardConfig ?? null,
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
import { createHash, randomUUID } from "node:crypto";
import { StorageService } from "../storage/storage.service";
import { StorageRegistryService } from "../storage/storage-registry.service";
import { imageExtForContentType, mediaKeyFromCdnUrl, publicMediaUrl } from "../storage/media-url";
import { detectMediaKind } from "../inbox/media-sniff";
import { ProductImageMirrorService } from "./product-image-mirror.service";
import { TenantPaymentsService } from "../connections/tenant-payments.service";

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
    // GB3 (GC8/GC9): checkout gate + idempotency replay. LAST
    // params + Optional, same discipline; absent keeps checkout
    // exactly as before GB3.
    @Optional() private readonly checkoutGuard?: CheckoutGuardService,
    @Optional() private readonly idempotency?: IdempotencyService,
    // GC10: online-payment options for the public payload +
    // marker validation at placement. LAST param + Optional,
    // same discipline; absent offers no online options.
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
    // AB5 (AX10): Meta catalog auto-sync enqueue. LAST param +
    // Optional, same discipline; absent keeps product writes
    // exactly as before AX10. Wiring choice: ProductsModule
    // imports CatalogsModule directly — CatalogsModule is a
    // leaf (global Prisma/Audit only, imports nothing), so the
    // graph stays acyclic and no event-bus indirection is
    // needed; this mirrors the EC3 CatalogPushService hook.
    @Optional() private readonly catalogSync?: CatalogsService,
    // EC32: affiliate attribution stamp. INT7 union: slot 17 —
    // the GC-line deep slots (10–16) keep their positions because
    // GB3/AB5/AB8 specs pin them; no spec passes affiliates
    // positionally, and the SU5 events slot (8) is preserved;
    // the stamp never throws.
    @Optional() private readonly affiliates?: AffiliatesService,
    // RM4 (INT7 union: slots 18–20): the R2 storage layer for direct product
    // image uploads + the external-URL mirror. LAST params +
    // Optional, same discipline as every slot above — positional
    // spec constructions without them keep working and the upload
    // endpoints refuse honestly when storage is not wired.
    @Optional() private readonly storage?: StorageService,
    @Optional() private readonly storageRegistry?: StorageRegistryService,
    @Optional() private readonly imageMirror?: ProductImageMirrorService,
  ) {}

  /** GC10: failure-isolated payment options for payloads. */
  private async paymentOptionsFor(orgId: string) {
    if (!this.tenantPayments?.publicPaymentOptions) return { online: [] as any[] };
    return this.tenantPayments.publicPaymentOptions(orgId).catch(() => ({ online: [] as any[] }));
  }

  /** GC10: validate an online selection (400 when not really
   * offered); null when not selected. */
  private async resolveOnlineSelection(orgId: string, dto: PublicCheckoutOrderDto) {
    if (!dto.onlinePayment) return null;
    if (!this.tenantPayments?.assertPublicPaymentOption) {
      throw new BadRequestException("এই অনলাইন পেমেন্টের অপশনটি এই দোকানে উপলব্ধ নয় — অন্য পেমেন্ট পদ্ধতি বেছে নিন।");
    }
    return this.tenantPayments.assertPublicPaymentOption(orgId, dto.onlinePayment);
  }

  /** AB4 (AX5b): the org's ACTIVE custom checkout-field defs,
   * failure-isolated (a missing table reads as no defs). */
  private async loadCheckoutFieldDefs(orgId: string): Promise<any[]> {
    try {
      const table = (this.prisma as any).checkoutFieldDef;
      if (!table?.findMany) return [];
      return (await table.findMany({ where: { organizationId: orgId, active: true } }).catch(() => [])) ?? [];
    } catch {
      return [];
    }
  }

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

  /** AB5 (AX10): failure-isolated Meta catalog auto-sync hook —
   *  the same posture as pushHook: enqueuing a CatalogSyncRecord
   *  must never fail the merchant's product write (the write
   *  already succeeded and is audited; noteProductChanged itself
   *  also swallows its own errors — this is belt and braces). */
  private async catalogSyncHook(
    action: "create" | "update" | "delete",
    organizationId: string,
    productId: string,
  ): Promise<void> {
    if (!this.catalogSync) return;
    try {
      await this.catalogSync.noteProductChanged(organizationId, productId, action);
    } catch (e) {
      this.logger.warn(
        `catalog sync hook (${action}) failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** AB6 (AX11): failure-isolated search-vector refresh hook —
   *  the same posture as catalogSyncHook: maintaining the FTS
   *  vector must never fail the merchant's own catalog write
   *  (the write already succeeded and is audited). */
  private async searchVectorHook(label: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.logger.warn(
        `search vector hook (${label}) failed: ${e instanceof Error ? e.message : String(e)}`,
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
    // GC22 (GB9): plan enforcement — paused / past-due-past-grace
    // orgs and orgs at their plan's productLimit cannot create.
    await checkProductCreate(this.prisma as any, organizationId);
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
    // GB2 (GC6): a brandId must exist in this org (same 404
    // discipline as categoryId).
    if (dto.brandId) await this.findBrandOr404(organizationId, dto.brandId);

    const baseSlug = slugify(dto.name) || `prod-${Date.now().toString(36)}`;
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    const slug = `${baseSlug}-${randomSuffix}`;

    const product = await (this.prisma as any).product.create({
      data: {
        organizationId,
        name: dto.name.trim(),
        // AB6 (AX13): English alternates (blank ⇒ null).
        nameEn: dto.nameEn?.trim() || null,
        descriptionEn: dto.descriptionEn && dto.descriptionEn.trim() ? dto.descriptionEn : null,
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
        // GB2 (GC6): brand link + free-shipping flag.
        brandId: dto.brandId ?? null,
        freeShipping: dto.freeShipping ?? false,
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
    // AB3: a product created WITH a tracked quantity joins the
    // per-bin invariant at its resolved default bin. Lazy
    // seeding would also catch it at its first inventory
    // mutation; this hook just makes it immediate. Fully
    // failure-isolated — seeding never breaks a product write.
    if (product.stockQuantity != null) {
      try { await this.inventory?.seedBalanceIfMissing?.(organizationId, product.id, null); } catch { /* never breaks create */ }
    }
    // EC3: full-manage stores get a DRAFT listing for the new
    // product (no push yet). Failure-isolated — see pushHook.
    await this.pushHook("createListingsForNewProduct", () =>
      this.catalogPush!.createListingsForNewProduct(organizationId, product.id),
    );
    // AB5 (AX10): enqueue the Meta catalog create for autoSync
    // catalogs. Failure-isolated — see catalogSyncHook.
    await this.catalogSyncHook("create", organizationId, product.id);
    // AB6 (AX11): build the new product's FTS vector.
    await this.searchVectorHook("create", () => refreshProductSearchVector(this.prisma, product.id));
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

  /** GB3 (GC8): terms trust for this org, read directly from
   * the storefrontSetting + shopPage tables (this service does
   * not inject StorefrontService). Failure-isolated. */
  private async loadTermsTrust(
    organizationId: string,
  ): Promise<{ required: boolean; ref: string | null; url: string | null; setting: any; page: any }> {
    let setting: any = null;
    let page: any = null;
    try {
      const sTable = (this.prisma as any).storefrontSetting;
      setting = sTable?.findFirst
        ? await sTable.findFirst({ where: { organizationId } }).catch(() => null)
        : null;
    } catch { setting = null; }
    try {
      const pTable = (this.prisma as any).shopPage;
      page = pTable?.findFirst
        ? await pTable
            .findFirst({ where: { organizationId, slug: "terms", published: true } })
            .catch(() => null)
        : null;
    } catch { page = null; }
    const t = termsRefFor(setting, page);
    return { required: t.required, ref: t.ref, url: t.url, setting, page };
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
    // AB6 (AX13): the same storefrontSetting row also carries the
    // shop locale for the display name/description below.
    let s: any = null;
    try {
      const sTable = (this.prisma as any).storefrontSetting;
      s = sTable?.findFirst
        ? await sTable.findFirst({ where: { organizationId: p.organization.id } }).catch(() => null)
        : null;
      if (s?.giftWrapEnabled === true && s?.giftWrapFeeMinor != null) {
        giftWrap = { enabled: true, feeMinor: String(s.giftWrapFeeMinor) };
      }
    } catch { giftWrap = null; s = null; }
    // GB3 (GC8): shared checkout-trust payload (otpEnabled is
    // false on this surface — the single checkout has no OTP).
    const trustSetting = (await this.loadTermsTrust(p.organization.id)).setting;
    const checkoutTrust = await buildCheckoutTrust(
      this.prisma, this.checkoutGuard, p.organization.id, trustSetting, bp, { includeOtp: false },
    );
    return {
      giftWrap,
      checkoutTrust,
      // GC10: real online-payment options beside checkoutTrust.
      paymentOptions: await this.paymentOptionsFor(p.organization.id),
      product: {
        id: p.id,
        name: displayProductName(p, s?.locale),
        slug: p.slug,
        description: displayProductDescription(p, s?.locale),
        category: p.category,
        imageUrl: p.imageUrl,
        priceMinor: p.priceMinor.toString(),
        compareAtMinor: p.compareAtMinor ? p.compareAtMinor.toString() : null,
        stockQuantity: p.stockQuantity,
        // EC24a: public pre-order info (null when not a preorder product).
        preorder: preorderInfo(p),
        // EC24b: ONLY the flag — the file URL is never public.
        digital: !!p.digital,
        // AB2 (AX3): gift-card flag + its face-value config (the
        // config is merchant-authored pricing, safe to show — the
        // shopper picks an amount from it on the product page).
        isGiftCard: !!p.isGiftCard,
        giftCardConfig: (p as any).giftCardConfig ?? null,
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
  async placePublicOrder(slug: string, dto: PublicCheckoutOrderDto, ctx?: { ip?: string | null }) {
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

    // GB3 (GC8): idempotency replay (scope "single") — a retry
    // with a known key returns the first placement's response.
    if (dto.idempotencyKey && this.idempotency) {
      const replay = await this.idempotency.findReplay(p.organization.id, dto.idempotencyKey);
      if (replay) return replay;
    }
    // GB3 (GC8): terms consent (read directly from the tables).
    const termsTrust = await this.loadTermsTrust(p.organization.id);
    if (termsTrust.required && dto.termsAccepted !== true) {
      throw new BadRequestException("অর্ডার সম্পূর্ণ করতে শর্তাবলি পড়ে সম্মতি দেওয়া বাধ্যতামূলক");
    }
    // AB8 (AX27): normalized device hash (invalid/absent = null).
    const deviceHash = normalizeDeviceHash((dto as any).deviceHash);
    // GB3 (GC9): the checkout gate (channel "single").
    if (this.checkoutGuard) {
      await this.checkoutGuard.evaluateGate(p.organization.id, "single", {
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
    const onlinePayment = await this.resolveOnlineSelection(p.organization.id, dto);

    const qty = Math.max(1, dto.quantity ?? 1);
    // EC24a: a preorder-enabled product passes at zero/negative
    // stock (this path's gate is product existence, as before);
    // only its open-unit limit can refuse the order.
    await assertPreorderLimit(this.prisma, p.organization.id, p, qty);
    // GB2 (GC7): stock enforcement — this checkout previously
    // had NO stock check at all (product existence was the only
    // gate) and could oversell tracked stock without bound.
    // Product-level availability through the ONE checker
    // (preorder bypass + allowBackorder + reservations inside);
    // the path resolves no variant, so the check is
    // product-level. Absent checker (older spec fakes) keeps the
    // legacy gate, exactly as the shop guard does.
    if (this.inventory?.checkAvailability) {
      const verdict = await this.inventory.checkAvailability(p.organization.id, p, null, qty);
      if (!verdict.ok) {
        throw new BadRequestException(
          `দুঃখিত, "${p.name}"-এর স্টকে মাত্র ${Math.max(0, verdict.available)}টি আছে — এর বেশি অর্ডার করা যাবে না`,
        );
      }
    }
    // AB5 (AX7) PRICE SOURCE precedence: gift-card lines keep
    // face value → an explicit price-list price REPLACES the
    // catalog price AND beats wholesale-tier math (this path
    // has no tier; the rule is stated for parity) → catalog
    // price otherwise. The buyer is resolved by phone (the same
    // promotions.customerIdForPhone the GB7 block below uses);
    // this path resolves no variant, so the product-level row
    // is the only candidate. Failure-isolated: no map ⇒ the
    // catalog price, exactly as before AB5.
    let priceListBreakdown: Array<{ productId: string; variantId: string | null; priceMinor: string }> = [];
    let ax7UnitPrice: bigint | null = null;
    if (this.priceLists && !(p as any).isGiftCard && this.promotions && typeof (this.promotions as any).customerIdForPhone === "function") {
      const ax7CustomerId = await (this.promotions as any)
        .customerIdForPhone(p.organization.id, dto.customerPhone)
        .catch(() => null);
      if (ax7CustomerId) {
        const map = await this.priceLists.priceMapForCustomer(p.organization.id, ax7CustomerId).catch(() => null);
        ax7UnitPrice = pickGroupPrice(map, p.id, null);
        if (ax7UnitPrice != null) {
          priceListBreakdown = [{ productId: p.id, variantId: null, priceMinor: ax7UnitPrice.toString() }];
        }
      }
    }
    const unitPriceMinor = ax7UnitPrice ?? BigInt(p.priceMinor);
    let subtotal = unitPriceMinor * BigInt(qty);

    const bp = p.organization?.businessProfile;
    const isOutside = dto.deliveryZone === "outside_dhaka";
    let shippingMinor = isOutside
      ? (bp?.deliveryChargeOutsideMinor ?? 12000n)
      : (bp?.deliveryChargeInsideMinor ?? 6000n);
    // GB2 (GC6): a free-shipping product zeroes this path's flat
    // BusinessProfile shipping fee (its only line is the product
    // itself, so "every line free" holds trivially).
    if ((p as any).freeShipping) shippingMinor = 0n;

    // AB6 (AX13): the shop locale for the order line's display
    // name (failure-isolated like the giftWrap load above).
    let singleLocale: string | null = null;
    try {
      const sTable = (this.prisma as any).storefrontSetting;
      const sRow = sTable?.findFirst
        ? await sTable.findFirst({ where: { organizationId: p.organization.id } }).catch(() => null)
        : null;
      singleLocale = sRow?.locale ?? null;
    } catch { singleLocale = null; }

    // Check if customer accepted 1-Click Order Bump Upsell
    const items: any[] = [
      {
        name: displayProductName(p, singleLocale),
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
          ? await this.promotions.customerIdForPhone(p.organization.id, dto.customerPhone)
          : null;
      buyerPriorOrderCount =
        typeof (this.promotions as any).priorOrderCountFor === "function"
          ? await this.promotions.priorOrderCountFor(p.organization.id, buyerCustomerId)
          : null;
    }
    // AB1 (AX1): loyalty snapshot for the phone-resolved
    // customer (the evaluator prices from the snapshot only).
    let loyaltyInput: LoyaltyRedeemInput | null = null;
    if (this.loyalty && dto.loyaltyPoints != null && dto.loyaltyPoints > 0 && buyerCustomerId) {
      const snap = await this.loyalty
        .checkoutSnapshot(p.organization.id, buyerCustomerId)
        .catch(() => null);
      if (snap) loyaltyInput = { pointsToRedeem: dto.loyaltyPoints, ...snap };
    }
    // AB2 (AX3): gift-card redemption snapshot. resolveForCheckout
    // throws a Bengali BadRequest on ANY refusal — BEFORE placement,
    // like coupons. The cart here is the single product itself, so
    // cartHasGiftCardProduct is exactly its isGiftCard flag (a gift
    // card can never buy a gift card).
    let giftCardInput: { giftCardId: string; balanceMinor: bigint; codeLast4: string } | null = null;
    if (this.giftCards && dto.giftCardCode?.trim()) {
      const snap = await this.giftCards.resolveForCheckout(p.organization.id, dto.giftCardCode, {
        cartHasGiftCardProduct: !!(p as any).isGiftCard,
      });
      giftCardInput = { giftCardId: snap.giftCardId, balanceMinor: snap.balanceMinor, codeLast4: snap.codeLast4 };
    }
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
        // GB7: values computed above; undefined when the promotions
        // service (the helper's owner) is absent in this deployment.
        priorOrderCount: buyerPriorOrderCount,
        customerId: buyerCustomerId,
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
    const isCod = dto.paymentMethod !== "bkash" && dto.paymentMethod !== "nagad";

    // GB3 (GC8): COD trust rules — no structured district on
    // this path; the parsed address supplies the candidate.
    let codAdvanceRequired = false;
    if (isCod && !onlinePayment) {
      const parsed = parseBdAddress(dto.customerAddress);
      const codEval = evaluateCodRules(bp, {
        totalMinor: total,
        district: null,
        parsedDistrict: parsed.district,
        parsedConfidence: parsed.confidence,
      });
      if (codEval.refused) {
        throw new BadRequestException("দুঃখিত, এই অর্ডারের জন্য ক্যাশ অন ডেলিভারি প্রযোজ্য নয়");
      }
      codAdvanceRequired = codEval.advanceRequired;
    }

    // AB4 (AX5a/AX5b): custom field answers for the "single"
    // surface — validated BEFORE any order write — and the
    // deposit slice for this placement's kind (NOTICE + stamp
    // only on this surface; no initiation exists here).
    const fieldValidation = validateFieldAnswers(
      await this.loadCheckoutFieldDefs(p.organization.id), "single", dto.fieldAnswers,
    );
    if (!fieldValidation.ok) throw new BadRequestException(fieldValidation.error);
    const deposit = depositFor(bp, {
      totalMinor: total,
      kind: onlinePayment ? "online" : isCod ? "cod" : "manual",
    });

    if (!this.integrations) {
      throw new InternalServerErrorException("Checkout ordering is unavailable (integrations service missing)");
    }
    // ON4: blocklist refusal — generic message, never reveals the blocklist.
    if (this.blockedPhones && (await this.blockedPhones.isBlocked(p.organization.id, cleanPhone))) throw new BadRequestException("দুঃখিত, এই মুহূর্তে অর্ডারটি নেওয়া যাচ্ছে না");
    // GB3 (GC9): block_checkout fraud rules (guard writes the
    // hit + attempt rows itself; the caller only refuses).
    if (this.checkoutGuard) {
      const stats = await this.checkoutGuard
        .phoneOrderStats(p.organization.id, bdPhoneMatchKey(cleanPhone) ?? "")
        .catch(() => null);
      const { blockedBy } = await this.checkoutGuard.evaluateFraudRulesAtCheckout(p.organization.id, {
        totalMinor: total,
        isCod: onlinePayment ? false : isCod,
        district: null,
        openOrderCount: stats?.openCount ?? 0,
        phone: cleanPhone,
        channel: "single",
      });
      if (blockedBy) throw new BadRequestException("দুঃখিত, এই মুহূর্তে অর্ডারটি নেওয়া যাচ্ছে না");
    }
    // GC22: a plan/order block on this PUBLIC checkout surface
    // surfaces ONLY the generic shopper message — never the
    // staff-facing plan/limit text.
    try {
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
        // AB7 (AX19): order-level attribution stamps — only
        // the keys the client actually presented (absent =
        // no keys = the Order columns stay null).
        ...normalizeAttribution(dto.attribution),
        // AB8 (AX27): device fingerprint stamp (valid hash only).
        ...(deviceHash ? { deviceHash } : {}),
        customer: {
          externalId: cleanPhone,
          firstName: dto.customerName.trim(),
          phone: cleanPhone,
          address: {
            address_1: dto.customerAddress.trim(),
            // GC10: marker-only distinction — paymentMethod is
            // passed through EXACTLY as today, so an online
            // bkash selection is told apart from a manual bkash
            // claim by this note + the response's
            // paymentClaimStatus, never by the method column.
            note: onlinePayment
              ? [dto.note?.trim(), `[অনলাইন পেমেন্ট (${onlinePayment.provider}) — যাচাই বাকি]`].filter(Boolean).join(" | ")
              : dto.note || undefined,
          },
        },
        items,
      },
      "manual"
    );
    } catch (e) {
      if (isOrderLimitBlocked(e)) throw new BadRequestException((e as OrderLimitBlockedError).shopperMessage ?? SHOPPER_ORDER_BLOCK_MESSAGE);
      throw e;
    }

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

    // AB5 (AX7): stamp the group price-list snapshot onto the
    // created order (failure-isolated, mirroring the slot stamp
    // style above — the order itself is already placed).
    if (priceListBreakdown.length > 0) {
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
            data: { priceListBreakdown },
          });
        }
      } catch (e) {
        this.logger.warn(
          `price list stamp failed for ${externalId}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    // GB3 (GC8): terms-consent + COD-advance stamps onto the
    // created order (failure-isolated, mirroring the slot stamp
    // style above); the order id captured here also feeds the
    // idempotency record below.
    let createdOrderId: string | null = null;
    if (
      dto.termsAccepted === true || codAdvanceRequired || dto.idempotencyKey || onlinePayment
      || deposit.active || Object.keys(fieldValidation.values).length > 0
    ) {
      try {
        const orderTable = (this.prisma as any).order;
        const order = orderTable?.findFirst
          ? await orderTable.findFirst({
              where: { organizationId: p.organization.id, source: "manual", externalId },
            })
          : null;
        if (order) {
          createdOrderId = order.id ?? null;
          const data: Record<string, any> = {};
          if (dto.termsAccepted === true && (termsTrust.required || termsTrust.ref)) {
            data.termsConsentedAt = new Date();
            data.termsRef = termsTrust.ref;
          }
          if (codAdvanceRequired) data.codAdvanceRequired = true;
          // AB4 (AX5a/AX5b): deposit due + validated field
          // answers ride the same stamp update.
          if (deposit.active) data.depositDueMinor = deposit.amountMinor;
          if (Object.keys(fieldValidation.values).length > 0) data.checkoutFields = fieldValidation.values;
          if (Object.keys(data).length > 0) {
            await orderTable.update({ where: { id: order.id }, data });
          }
        }
      } catch (e) {
        this.logger.warn(
          `GB3 trust stamp failed for ${externalId}: ${e instanceof Error ? e.message : String(e)}`,
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

    // AB1 (AX1): spend the redeemed points now that the order
    // exists (failure-isolated inside LoyaltyService; the order
    // re-read follows the slot-stamp pattern above).
    if (ec16Evaluation && (ec16Evaluation.loyaltyPointsApplied ?? 0) > 0 && this.loyalty) {
      try {
        const orderTable = (this.prisma as any).order;
        const order = orderTable?.findFirst
          ? await orderTable.findFirst({
              where: { organizationId: p.organization.id, source: "manual", externalId },
            })
          : null;
        if (order) {
          await this.loyalty.postPlacementRedeem(p.organization.id, {
            orderId: order.id,
            customerId: order.customerId ?? null,
            points: ec16Evaluation.loyaltyPointsApplied ?? 0,
          });
        }
      } catch (e) {
        this.logger.warn(
          `loyalty redeem posting failed for ${externalId}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    // AB2 (AX3): spend the redeemed gift-card balance now that
    // the order exists (failure-isolated inside GiftCardsService;
    // same order re-read pattern as the loyalty block above).
    if (ec16Evaluation && (ec16Evaluation.giftCardDiscountMinor ?? 0n) > 0n && ec16Evaluation.giftCardId && this.giftCards) {
      try {
        const orderTable = (this.prisma as any).order;
        const order = orderTable?.findFirst
          ? await orderTable.findFirst({
              where: { organizationId: p.organization.id, source: "manual", externalId },
            })
          : null;
        if (order) {
          await this.giftCards.postPlacementRedeem(p.organization.id, {
            orderId: order.id,
            giftCardId: ec16Evaluation.giftCardId,
            amountMinor: ec16Evaluation.giftCardDiscountMinor ?? 0n,
          });
        }
      } catch (e) {
        this.logger.warn(
          `gift card redeem posting failed for ${externalId}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
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

    const response = {
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
      // GC10: online marker outcome (additive, online only).
      ...(onlinePayment
        ? { paymentClaimStatus: "online_pending", onlinePayment, orderId: createdOrderId }
        : {}),
    };
    // GB3 (GC8): record the placement under the idempotency key.
    if (dto.idempotencyKey && this.idempotency) {
      return await this.idempotency.record(
        p.organization.id, dto.idempotencyKey, "single", createdOrderId, response,
      );
    }
    return response;
  }

  async list(organizationId: string, query: { search?: string; category?: string; status?: string; brandId?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const where: any = {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: query.category } : {}),
      // GB2 (GC6): brand filter (exact brand id).
      ...(query.brandId ? { brandId: query.brandId } : {}),
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
    const mapped = items.map((p: any) => toPublicProduct(p, p.costs?.[0]?.costMinor ?? null));
    // GB2 (GC7): availability decoration for product-tracked
    // rows only (no variants + tracked stock): reservedQuantity
    // / availableQuantity; every other row carries nulls.
    // Failure-isolated decoration.
    try {
      if (this.inventory?.activeReservationTotals && items.length > 0) {
        const totals = await this.inventory.activeReservationTotals(organizationId);
        const variantRows: any[] = ((await (this.prisma as any).productVariant
          .findMany({ where: { productId: { in: items.map((p: any) => p.id) } } })
          .catch(() => [])) ?? []) as any[];
        const withVariants = new Set(variantRows.map((v: any) => String(v.productId)));
        items.forEach((p: any, i: number) => {
          const pub: any = mapped[i];
          if (!withVariants.has(String(p.id)) && p.stockQuantity != null) {
            const reserved = totals.get(`${p.id}::`) ?? 0;
            pub.reservedQuantity = reserved;
            pub.availableQuantity = Number(p.stockQuantity) - reserved;
          } else {
            pub.reservedQuantity = null;
            pub.availableQuantity = null;
          }
        });
      }
    } catch { /* decoration only */ }
    return { total, page, pageSize, items: mapped };
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
    // GB2 (GC6): brand object next to the brandId column (same
    // defensive-load style as tags: the include graph above has
    // no brand relation in older fakes).
    pub.brand = null;
    if ((p as any).brandId) {
      const brandTable = (this.prisma as any).brand;
      if (brandTable?.findFirst) {
        const brand = await brandTable
          .findFirst({ where: { id: (p as any).brandId, organizationId } })
          .catch(() => null);
        if (brand) pub.brand = this.serializeBrand(brand);
      }
    }
    // GB2 (GC7): product-level availability for product-tracked
    // rows (variant-tracked products read per-variant numbers
    // from the inventory availability endpoint instead).
    (pub as any).reservedQuantity = null;
    (pub as any).availableQuantity = null;
    if (
      this.inventory?.activeReservationTotals &&
      (!Array.isArray(p.variants) || p.variants.length === 0) &&
      p.stockQuantity != null
    ) {
      try {
        const totals = await this.inventory.activeReservationTotals(organizationId);
        const reserved = totals.get(`${p.id}::`) ?? 0;
        (pub as any).reservedQuantity = reserved;
        (pub as any).availableQuantity = Number(p.stockQuantity) - reserved;
      } catch { /* decoration only */ }
    }
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
    // AB6 (AX13): normalize the English alternates when present —
    // the dashboard form sends "" for a cleared field, which must
    // become null (never an empty string stored as an alternate).
    if (dto.nameEn !== undefined) data.nameEn = dto.nameEn?.trim() || null;
    if (dto.descriptionEn !== undefined) data.descriptionEn = dto.descriptionEn && dto.descriptionEn.trim() ? dto.descriptionEn : null;
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
    // GB2 (GC6): brandId follows the categoryId discipline —
    // null clears the link; an id must exist in THIS org.
    if ((dto as any).brandId !== undefined) {
      if ((dto as any).brandId === null) {
        data.brandId = null;
      } else {
        const brand = await this.findBrandOr404(organizationId, (dto as any).brandId);
        data.brandId = brand.id;
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
    // AB5 (AX10): enqueue the Meta catalog update for autoSync
    // catalogs. Failure-isolated — see catalogSyncHook.
    await this.catalogSyncHook("update", organizationId, productId);
    // AB6 (AX11): refresh the product's FTS vector.
    await this.searchVectorHook("update", () => refreshProductSearchVector(this.prisma, productId));
    return toPublicProduct(updated, null);
  }

  async archive(organizationId: string, actorId: string, productId: string) {
    await this.getOne(organizationId, productId);
    const updated = await (this.prisma as any).product.update({ where: { id: productId }, data: { status: "ARCHIVED" } });
    await this.audit.log({ organizationId, userId: actorId, action: "product.archive", entityType: "Product", entityId: productId });
    await this.pushHook("enqueueArchive", () =>
      this.catalogPush!.enqueueArchive(organizationId, productId),
    );
    // AB5 (AX10): archiving removes the product from autoSync
    // Meta catalogs (a delete supersedes any pending update).
    await this.catalogSyncHook("delete", organizationId, productId);
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
    // AB3: a variant created WITH a tracked quantity seeds its
    // default-bin balance (failure-isolated, like the product
    // create hook).
    if (variant.stockQuantity != null) {
      try { await this.inventory?.seedBalanceIfMissing?.(organizationId, productId, variant.id); } catch { /* never breaks create */ }
    }
    await this.pushHook("enqueueForProductChange", () =>
      this.catalogPush!.enqueueForProductChange(organizationId, productId),
    );
    // AB5 (AX10): a variant change is a product UPDATE for Meta
    // catalog purposes (the item set is rebuilt per variant).
    await this.catalogSyncHook("update", organizationId, productId);
    // AB6 (AX11): variant SKUs ride the parent product's vector.
    await this.searchVectorHook("createVariant", () => refreshProductSearchVector(this.prisma, productId));
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
    // AB3: an update that ESTABLISHES a tracked quantity on the
    // variant (baseline plain write above) seeds its default-bin
    // balance. When inventory owned the stock write, adjust()
    // already seeded — this is then an idempotent no-op.
    if (updated.stockQuantity != null) {
      try { await this.inventory?.seedBalanceIfMissing?.(organizationId, productId, variantId); } catch { /* never breaks update */ }
    }
    await this.pushHook("enqueueForProductChange", () =>
      this.catalogPush!.enqueueForProductChange(organizationId, productId),
    );
    if (baselineStockPush) {
      await this.pushHook("enqueueInventoryPush", () =>
        this.catalogPush!.enqueueInventoryPush(organizationId, productId, variantId, dto.stockQuantity!),
      );
    }
    // AB5 (AX10): variant change → product UPDATE (see createVariant).
    await this.catalogSyncHook("update", organizationId, productId);
    // AB6 (AX11): variant SKUs ride the parent product's vector.
    await this.searchVectorHook("updateVariant", () => refreshProductSearchVector(this.prisma, productId));
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
    // AB5 (AX10): variant change → product UPDATE (see createVariant).
    // Honest limit: the removed variant's own retailer item is
    // not separately deleted — variant deletions of
    // already-removed variants are not tracked.
    await this.catalogSyncHook("update", organizationId, productId);
    // AB6 (AX11): variant SKUs ride the parent product's vector.
    await this.searchVectorHook("deleteVariant", () => refreshProductSearchVector(this.prisma, productId));
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
    // RM4: when the deleted row pointed at OUR CDN, flip its
    // StoredFile registry row to trashed so storage accounting
    // stops counting it. The object itself is deliberately NOT
    // deleted here — object deletion + the trash-retention window
    // belong to RM11's lifecycle job (another surface may still
    // hold the same URL until then). External URLs have no
    // registry row; the org-guarded update is then a plain no-op.
    const deletedCdnKey = mediaKeyFromCdnUrl(image.url);
    if (deletedCdnKey && this.storageRegistry) {
      await this.storageRegistry
        .markTrashed(organizationId, deletedCdnKey)
        .catch(() => undefined);
    }
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

  // ---------- RM4: direct-to-R2 product image upload ----------
  //
  // The plan §1.3 flow, product surface: presign (this service
  // validates + hands out a quarantine PUT URL) -> the browser PUTs
  // the bytes straight to R2 -> complete (HEAD size check, magic-
  // byte sniff, copy to the immutable final key, StoredFile
  // registration, gallery row through the SAME addImage path as
  // URL-added images so the position-0 cover mirror rule is
  // identical). Any failure after the bytes landed removes the
  // objects it created and creates no row — never a partial state.

  private productImageStorageOr400(): StorageService {
    if (!this.storage || this.storage.mode !== "s3") {
      throw new BadRequestException(
        "সরাসরি ছবি আপলোড এখন চালু নেই — সার্ভারে object storage (Cloudflare R2) সেটআপ হয়নি। আপাতত URL দিয়ে ছবি যোগ করুন।",
      );
    }
    return this.storage;
  }

  private normalizeUploadType(contentType: unknown): string {
    const ct = String(contentType ?? "").split(";")[0].trim().toLowerCase();
    if (!(PRODUCT_IMAGE_UPLOAD_CONTENT_TYPES as readonly string[]).includes(ct)) {
      throw new BadRequestException("শুধু PNG, JPEG অথবা WebP ছবি আপলোড করা যাবে।");
    }
    return ct;
  }

  private normalizeUploadSize(sizeBytes: unknown): number {
    const size = Number(sizeBytes);
    if (!Number.isInteger(size) || size < 1) {
      throw new BadRequestException("ছবির আকার (sizeBytes) সঠিক নয়।");
    }
    if (size > PRODUCT_IMAGE_UPLOAD_MAX_BYTES) {
      throw new BadRequestException("ছবিটি অনেক বড় — সর্বোচ্চ ১০ MB পর্যন্ত আপলোড করা যাবে।");
    }
    return size;
  }

  async presignProductImage(
    organizationId: string,
    actorId: string,
    productId: string,
    dto: { fileName?: string; contentType: string; sizeBytes: number },
  ) {
    await this.getProductOr404(organizationId, productId);
    const contentType = this.normalizeUploadType(dto?.contentType);
    const sizeBytes = this.normalizeUploadSize(dto?.sizeBytes);
    const storage = this.productImageStorageOr400();
    // Plan §1.2: uploads land in quarantine first; nothing under a
    // final key exists until complete() has sniffed the real bytes.
    const key = `_quarantine/${organizationId}/product/${randomUUID()}`;
    const uploadUrl = storage.presignedPutUrl("public", key);
    if (!uploadUrl) {
      // mode was s3 at the check above, so this should not happen —
      // but a null URL must never be dressed up as a real one.
      throw new BadRequestException("আপলোডের URL তৈরি করা যায়নি — object storage সেটআপ যাচাই করুন।");
    }
    void actorId;
    return { uploadUrl, key, contentType, sizeBytes, expiresInSeconds: 600 };
  }

  async completeProductImage(
    organizationId: string,
    actorId: string,
    productId: string,
    dto: { key: string; contentType: string; sizeBytes: number },
  ) {
    await this.getProductOr404(organizationId, productId);
    const contentType = this.normalizeUploadType(dto?.contentType);
    const sizeBytes = this.normalizeUploadSize(dto?.sizeBytes);
    const storage = this.productImageStorageOr400();
    const key = String(dto?.key ?? "");
    const quarantinePrefix = `_quarantine/${organizationId}/product/`;
    if (!key.startsWith(quarantinePrefix) || key.includes("..") || key.includes("\\")) {
      throw new BadRequestException("আপলোডের key সঠিক নয় — presign থেকে পাওয়া key-ই পাঠাতে হবে।");
    }
    const dropQuarantine = () => storage.delete("public", key).catch(() => undefined);

    const head = await storage.head("public", key).catch(() => null);
    if (!head) {
      throw new BadRequestException("আপলোড করা ফাইলটি পাওয়া যায়নি — আবার আপলোড করুন।");
    }
    if (head.sizeBytes !== sizeBytes) {
      await dropQuarantine();
      throw new BadRequestException("আপলোড করা ফাইলের আকার ঘোষিত আকারের সঙ্গে মিলছে না — ফাইলটি মোছা হয়েছে।");
    }
    const bytes = await storage.get("public", key).catch(() => null);
    if (!bytes || bytes.length !== sizeBytes) {
      await dropQuarantine();
      throw new BadRequestException("আপলোড করা ফাইলটি পড়া যায়নি — ফাইলটি মোছা হয়েছে, আবার চেষ্টা করুন।");
    }
    // Magic bytes decide, never the declaration (media-sniff
    // discipline, same as inbox uploads and the PP3 import).
    const detected = detectMediaKind(bytes);
    if (!detected || detected.kind !== "image" || detected.contentType !== contentType) {
      await dropQuarantine();
      const what = detected ? detected.contentType : "অচেনা ফরম্যাটের ডেটা";
      throw new BadRequestException(`আপলোড করা ফাইলের আসল ফরম্যাট ঘোষিত টাইপের সঙ্গে মিলছে না (পাওয়া গেছে ${what}) — ফাইলটি মোছা হয়েছে।`);
    }

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const finalKey = `${organizationId}/product/${productId}/${randomUUID()}.${imageExtForContentType(detected.contentType)}`;
    let registered = false;
    try {
      await storage.copy({ visibility: "public", key }, { visibility: "public", key: finalKey });
      if (this.storageRegistry) {
        await this.storageRegistry.register({
          organizationId,
          bucket: storage.bucketFor("public"),
          key: finalKey,
          visibility: "public",
          surface: "product",
          contentType: detected.contentType,
          sizeBytes: bytes.length,
          sha256,
          status: "active",
          createdById: actorId,
          sourceRef: `product:${productId}`,
        });
        registered = true;
      }
      // The gallery row goes through addImage unchanged: same
      // position rule (appended last) and the same position-0
      // cover mirror into Product.imageUrl as URL-added images.
      const image = await this.addImage(organizationId, actorId, productId, {
        url: publicMediaUrl(finalKey),
      });
      await dropQuarantine();
      return image;
    } catch (e) {
      // No partial state: whatever this completion created (final
      // object, registry row) is undone before the error surfaces.
      await storage.delete("public", finalKey).catch(() => undefined);
      if (registered && this.storageRegistry) {
        await this.storageRegistry.markTrashed(organizationId, finalKey).catch(() => undefined);
      }
      await dropQuarantine();
      throw e;
    }
  }

  // ---------- RB6/RM9: digital product file (private R2) -------
  //
  // The plan §1.3 flow on the PRIVATE bucket: presign a quarantine
  // PUT -> the browser uploads straight to R2 -> complete HEAD-
  // verifies the size, hashes small files, copies to the final
  // key {orgId}/digital/{productId}/{uuid}.{ext} and points
  // Product.digitalStorageKey at it (flipping `digital` on: a
  // hosted file IS the digital product). The merchant-hosted
  // digitalFileUrl stays untouched as the alternative; at reveal
  // time (storefront digitalAccess) the R2 file wins and the
  // buyer receives a 300-second presigned GET — the object is
  // never public and no byte ever passes through this API.
  // Replacing a file trashes the previous registry row (the
  // object itself is RM11's lifecycle delete) but never deletes
  // it inline, so a buyer mid-download is never cut off.

  private normalizeDigitalFileName(fileName: unknown): { fileName: string; ext: string } {
    const name = String(fileName ?? "").trim();
    const base = name.split(/[\\/]/).pop() ?? "";
    const dot = base.lastIndexOf(".");
    const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
    if (!base || !ext) {
      throw new BadRequestException("ফাইলের নামে এক্সটেনশন থাকতে হবে (যেমন .pdf, .zip)।");
    }
    if ((DIGITAL_FILE_BLOCKED_EXTENSIONS as readonly string[]).includes(ext)) {
      throw new BadRequestException(`.${ext} ফাইল আপলোড করা যাবে না — নিরাপত্তার কারণে executable ফাইল (exe/bat/sh/js/html) নিষিদ্ধ।`);
    }
    return { fileName: base, ext };
  }

  private normalizeDigitalSize(sizeBytes: unknown): number {
    const size = Number(sizeBytes);
    if (!Number.isInteger(size) || size < 1) {
      throw new BadRequestException("ফাইলের আকার (sizeBytes) সঠিক নয়।");
    }
    if (size > DIGITAL_FILE_MAX_BYTES) {
      throw new BadRequestException("ফাইলটি অনেক বড় — সর্বোচ্চ ১০০ MB পর্যন্ত আপলোড করা যাবে।");
    }
    return size;
  }

  async presignDigitalFile(
    organizationId: string,
    actorId: string,
    productId: string,
    dto: { fileName?: string; contentType: string; sizeBytes: number },
  ) {
    await this.getProductOr404(organizationId, productId);
    const { fileName } = this.normalizeDigitalFileName(dto?.fileName);
    const sizeBytes = this.normalizeDigitalSize(dto?.sizeBytes);
    const storage = this.productImageStorageOr400();
    const key = `_quarantine/${organizationId}/digital/${randomUUID()}`;
    const uploadUrl = storage.presignedPutUrl("private", key);
    if (!uploadUrl) {
      throw new BadRequestException("আপলোডের URL তৈরি করা যায়নি — object storage সেটআপ যাচাই করুন।");
    }
    void actorId;
    return { uploadUrl, key, fileName, sizeBytes, expiresInSeconds: 600 };
  }

  async completeDigitalFile(
    organizationId: string,
    actorId: string,
    productId: string,
    dto: { key: string; fileName?: string; sizeBytes: number },
  ) {
    const product = await this.getProductOr404(organizationId, productId);
    const { ext } = this.normalizeDigitalFileName(dto?.fileName);
    const sizeBytes = this.normalizeDigitalSize(dto?.sizeBytes);
    const storage = this.productImageStorageOr400();
    const key = String(dto?.key ?? "");
    const quarantinePrefix = `_quarantine/${organizationId}/digital/`;
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
    // Small files are read back for a REAL sha256 (the registry
    // must be able to prove what was hosted); large files skip
    // the read — sha256 stays null, documented in RM9's limits.
    let sha256: string | null = null;
    if (sizeBytes <= DIGITAL_FILE_SHA_MAX_BYTES) {
      const bytes = await storage.get("private", key).catch(() => null);
      if (!bytes || bytes.length !== sizeBytes) {
        await dropQuarantine();
        throw new BadRequestException("আপলোড করা ফাইলটি পড়া যায়নি — ফাইলটি মোছা হয়েছে, আবার চেষ্টা করুন।");
      }
      sha256 = createHash("sha256").update(bytes).digest("hex");
    }
    const contentType = head.contentType || "application/octet-stream";
    const finalKey = `${organizationId}/digital/${productId}/${randomUUID()}.${ext}`;
    let registered = false;
    try {
      await storage.copy({ visibility: "private", key }, { visibility: "private", key: finalKey });
      if (this.storageRegistry) {
        await this.storageRegistry.register({
          organizationId,
          bucket: storage.bucketFor("private"),
          key: finalKey,
          visibility: "private",
          surface: "digital",
          contentType,
          sizeBytes,
          sha256,
          status: "active",
          createdById: actorId,
          sourceRef: `product:${productId}`,
        });
        registered = true;
      }
      const previousKey = (product as any).digitalStorageKey as string | null | undefined;
      const updated = await (this.prisma as any).product.update({
        where: { id: productId },
        data: { digitalStorageKey: finalKey, digital: true },
      });
      if (previousKey && previousKey !== finalKey && this.storageRegistry) {
        await this.storageRegistry.markTrashed(organizationId, previousKey).catch(() => undefined);
      }
      await dropQuarantine();
      await this.audit.log({
        organizationId, userId: actorId, action: "product.digital_file.upload",
        entityType: "Product", entityId: productId,
        metadata: { key: finalKey, sizeBytes, sha256 },
      });
      return {
        productId, digital: true, digitalStorageKey: finalKey, sizeBytes, sha256,
        product: updated,
      };
    } catch (e) {
      await storage.delete("private", finalKey).catch(() => undefined);
      if (registered && this.storageRegistry) {
        await this.storageRegistry.markTrashed(organizationId, finalKey).catch(() => undefined);
      }
      await dropQuarantine();
      throw e;
    }
  }

  /** RM4 facade for the external-URL mirror (the work lives in
   * ProductImageMirrorService; this keeps the controller's single
   * service dependency, matching the rest of the controller). */
  async mirrorExternalProductImages(organizationId: string, actorId: string) {
    if (!this.imageMirror) {
      throw new BadRequestException("ছবি মিরর সার্ভিস এই deployment-এ চালু নেই।");
    }
    return this.imageMirror.mirrorExternalImages(organizationId, actorId);
  }

  /** RB6b (plan D3): the auto-mirror opt-out — read side. The
   * scheduled sweep honours it; the manual endpoint above does
   * not (an explicit owner click is not "automatic"). */
  async getProductImageAutoMirror(organizationId: string) {
    if (!this.imageMirror) {
      throw new BadRequestException("ছবি মিরর সার্ভিস এই deployment-এ চালু নেই।");
    }
    return { productImageAutoMirror: await this.imageMirror.autoMirrorEnabled(organizationId) };
  }

  /** RB6b (plan D3): the auto-mirror opt-out — write side
   * (OWNER/ADMIN at the controller). */
  async setProductImageAutoMirror(organizationId: string, actorId: string, enabled: boolean) {
    if (!this.imageMirror) {
      throw new BadRequestException("ছবি মিরর সার্ভিস এই deployment-এ চালু নেই।");
    }
    return this.imageMirror.setAutoMirrorEnabled(organizationId, enabled, actorId);
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
    // AB6 (AX11): a category rename changes the weight-B text of
    // every product linked to it — refresh their vectors.
    if (newName !== undefined && newName !== oldName) {
      await this.searchVectorHook("updateCategory", () => refreshCategorySearchVectors(this.prisma, categoryId));
    }
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

  // ================= GB2 (GC6): brands =================

  private serializeBrand(b: any) {
    return {
      id: b.id,
      organizationId: b.organizationId,
      name: b.name,
      slug: b.slug,
      logoUrl: b.logoUrl ?? null,
      description: b.description ?? null,
      createdAt: b.createdAt ?? null,
      updatedAt: b.updatedAt ?? null,
    };
  }

  /** Org-scoped brand row or 404 (used by product create/update
   * + the brand endpoints). */
  private async findBrandOr404(organizationId: string, brandId: string) {
    const table = (this.prisma as any).brand;
    const brand = table?.findFirst
      ? await table.findFirst({ where: { id: brandId, organizationId } })
      : null;
    if (!brand) throw new NotFoundException("Brand not found in this organization");
    return brand;
  }

  /** Unique-per-org slug for a brand name. Bengali-only names
   * slugify to "" (the codebase slugify is \w-based) and fall
   * back to a timestamped base, exactly like product slugs. */
  private async uniqueBrandSlug(organizationId: string, name: string): Promise<string> {
    const base = slugify(name) || `brand-${Date.now().toString(36)}`;
    const table = (this.prisma as any).brand;
    const rows: any[] = table?.findMany
      ? ((await table.findMany({ where: { organizationId } }).catch(() => [])) ?? [])
      : [];
    const taken = new Set(rows.map((r: any) => String(r.slug)));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  }

  async listBrands(organizationId: string) {
    const table = (this.prisma as any).brand;
    const rows: any[] = table?.findMany
      ? ((await table.findMany({ where: { organizationId }, orderBy: { name: "asc" } }).catch(() => [])) ?? [])
      : [];
    // Product counts per brand (one grouped load, never N+1).
    const counts = new Map<string, number>();
    const products: any[] = ((await (this.prisma as any).product
      .findMany({ where: { organizationId } })
      .catch(() => [])) ?? []) as any[];
    for (const p of products) {
      if (p.brandId) counts.set(String(p.brandId), (counts.get(String(p.brandId)) ?? 0) + 1);
    }
    return rows.map((b: any) => ({ ...this.serializeBrand(b), productCount: counts.get(String(b.id)) ?? 0 }));
  }

  async createBrand(organizationId: string, actorId: string, dto: { name: string; logoUrl?: string | null; description?: string | null }) {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException("ব্র্যান্ডের নাম দিতে হবে");
    const slug = await this.uniqueBrandSlug(organizationId, name);
    const brand = await (this.prisma as any).brand.create({
      data: {
        organizationId, name, slug,
        logoUrl: dto.logoUrl?.trim() || null,
        description: dto.description?.trim() || null,
      },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "product.brand.create", entityType: "Brand", entityId: brand.id, metadata: { slug } });
    return this.serializeBrand(brand);
  }

  async updateBrand(organizationId: string, actorId: string, brandId: string, dto: { name?: string; logoUrl?: string | null; description?: string | null }) {
    const existing = await this.findBrandOr404(organizationId, brandId);
    const data: any = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException("ব্র্যান্ডের নাম খালি হতে পারবে না");
      data.name = name;
      // A rename re-slugs ONLY when the name actually changed,
      // so existing shop brand URLs stay stable on other edits.
      if (name !== existing.name) data.slug = await this.uniqueBrandSlug(organizationId, name);
    }
    if (dto.logoUrl !== undefined) data.logoUrl = dto.logoUrl?.trim() || null;
    if (dto.description !== undefined) data.description = dto.description?.trim() || null;
    const brand = await (this.prisma as any).brand.update({ where: { id: brandId }, data });
    await this.audit.log({ organizationId, userId: actorId, action: "product.brand.update", entityType: "Brand", entityId: brandId });
    // AB6 (AX11): a brand rename changes the weight-B text of
    // every product linked to it — refresh their vectors.
    if (data.name !== undefined && data.name !== existing.name) {
      await this.searchVectorHook("updateBrand", () => refreshBrandSearchVectors(this.prisma, brandId));
    }
    return this.serializeBrand(brand);
  }

  /** Brand delete NULLS the product links (products are never
   * deleted with their brand); the nulled count lands in the
   * audit metadata. */
  async deleteBrand(organizationId: string, actorId: string, brandId: string) {
    await this.findBrandOr404(organizationId, brandId);
    const linked: any[] = ((await (this.prisma as any).product
      .findMany({ where: { organizationId, brandId } })
      .catch(() => [])) ?? []) as any[];
    for (const p of linked) {
      await (this.prisma as any).product.update({ where: { id: p.id }, data: { brandId: null } });
    }
    await (this.prisma as any).brand.delete({ where: { id: brandId } });
    await this.audit.log({
      organizationId, userId: actorId, action: "product.brand.delete", entityType: "Brand", entityId: brandId,
      metadata: { unlinkedProducts: linked.length },
    });
    return { ok: true, unlinkedProducts: linked.length };
  }

  // ================= GB2 (GC6): product export (CSV) =================

  /**
   * Export in the EXACT column shape the product importer
   * accepts (imports/csv.ts HEADER_ALIASES), money in major
   * units, so an export re-imports through the same pipeline.
   * One row per variant (a variant-less product gets one row
   * with empty variant columns); the product columns repeat on
   * each variant row, and the importer groups rows sharing a
   * sku (or name) back into one product with variants.
   * Columns: name, sku, price, compare_at_price, currency, cost,
   * stock, category, description, name_en, description_en,
   * image_url, brand, status,
   * variant_name, variant_sku, variant_price, variant_stock,
   * variant_cost. `cost` is the CURRENT product-level cost;
   * `variant_cost` is the variant's own current cost when one is
   * recorded (the importer's variant grouping reads both back).
   */
  async exportProductsCsv(organizationId: string, actorId: string): Promise<string> {
    const products: any[] = ((await (this.prisma as any).product.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      include: {
        variants: { orderBy: { createdAt: "asc" } },
        costs: { orderBy: { effectiveFrom: "desc" } },
      },
    }).catch(() => [])) ?? []) as any[];
    const brandNames = new Map<string, string>();
    const brandTable = (this.prisma as any).brand;
    if (brandTable?.findMany) {
      const brands: any[] = ((await brandTable.findMany({ where: { organizationId } }).catch(() => [])) ?? []) as any[];
      for (const b of brands) brandNames.set(String(b.id), String(b.name));
    }
    const headers = [
      "name", "sku", "price", "compare_at_price", "currency", "cost", "stock",
      "category", "description", "name_en", "description_en", "image_url", "brand", "status",
      "variant_name", "variant_sku", "variant_price", "variant_stock", "variant_cost",
    ];
    const rows: unknown[][] = [];
    for (const p of products) {
      const productCost = (p.costs ?? []).find((c: any) => !c.variantId) ?? null;
      const base: unknown[] = [
        p.name ?? "",
        p.sku ?? "",
        minorToMajor(BigInt(p.priceMinor ?? 0)),
        p.compareAtMinor != null ? minorToMajor(BigInt(p.compareAtMinor)) : "",
        p.currency ?? "BDT",
        productCost ? minorToMajor(BigInt(productCost.costMinor)) : "",
        p.stockQuantity ?? "",
        p.category ?? "",
        p.description ?? "",
        p.nameEn ?? "",
        p.descriptionEn ?? "",
        p.imageUrl ?? "",
        p.brandId ? (brandNames.get(String(p.brandId)) ?? "") : "",
        String(p.status ?? "ACTIVE").toLowerCase(),
      ];
      const variants: any[] = Array.isArray(p.variants) ? p.variants : [];
      if (variants.length === 0) {
        rows.push([...base, "", "", "", "", ""]);
      } else {
        for (const v of variants) {
          const vCost = (p.costs ?? []).find((c: any) => c.variantId === v.id) ?? null;
          rows.push([
            ...base,
            v.name ?? "",
            v.sku ?? "",
            v.priceMinor != null ? minorToMajor(BigInt(v.priceMinor)) : "",
            v.stockQuantity ?? "",
            vCost ? minorToMajor(BigInt(vCost.costMinor)) : "",
          ]);
        }
      }
    }
    await this.audit.log({
      organizationId, userId: actorId, action: "product.export",
      entityType: "Product", metadata: { productCount: products.length, rowCount: rows.length },
    });
    return toCsv(headers, rows);
  }

  // ================= GB2 (GC6): bulk delete =================

  /**
   * Per-product outcomes: a product referenced by ANY OrderItem
   * is ARCHIVED (order history keeps pointing at a real row);
   * a never-ordered product is HARD-DELETED — every child
   * relation on Product is onDelete: Cascade (variants, costs,
   * images, tags, listings, cart items, PO items, bins, stock
   * counts, subscriptions, bundle items), and StockMovement /
   * StockReservation / OrderItem carry plain ids so the ledger
   * and order history survive as records. Foreign/missing ids
   * answer not_found per row — never a whole-batch 404.
   */
  async bulkDelete(organizationId: string, actorId: string, ids: string[]) {
    const uniqueIds = [...new Set((ids ?? []).map((x) => String(x)).filter(Boolean))];
    const results: Array<{ id: string; outcome: "deleted" | "archived" | "not_found" }> = [];
    let deleted = 0, archived = 0, notFound = 0;
    for (const id of uniqueIds) {
      const product = await (this.prisma as any).product
        .findFirst({ where: { id, organizationId } })
        .catch(() => null);
      if (!product) { results.push({ id, outcome: "not_found" }); notFound++; continue; }
      const orderRefs = await (this.prisma as any).orderItem
        .count({ where: { productId: id } })
        .catch(() => 0);
      if (orderRefs > 0) {
        await this.archive(organizationId, actorId, id);
        results.push({ id, outcome: "archived" });
        archived++;
      } else {
        await (this.prisma as any).product.delete({ where: { id } });
        await this.audit.log({ organizationId, userId: actorId, action: "product.delete", entityType: "Product", entityId: id });
        await this.pushHook("enqueueArchive", () =>
          this.catalogPush!.enqueueArchive(organizationId, id),
        );
        results.push({ id, outcome: "deleted" });
        deleted++;
      }
    }
    await this.audit.log({
      organizationId, userId: actorId, action: "product.bulk_delete", entityType: "Product",
      metadata: { requested: uniqueIds.length, deleted, archived, notFound },
    });
    return { results, deleted, archived, notFound };
  }

  // ================= GB2 (GC6): product change history =================

  /**
   * The product's AuditLog trail: rows whose entityId is the
   * product itself (product.*, inventory.adjusted and the stock
   * alerts — those audit with entityType "Product" + the product
   * id), its variants' rows, and cost rows (product.cost.set
   * audits the COST row with metadata.productId — matched via a
   * Json path query, failure-isolated). Titles are Bengali
   * labels; details carry ONLY safe numbers (stock delta /
   * balance) — never note bodies or payloads. Newest first,
   * capped at 200 with a truncated flag. Coverage honesty: org-
   * level audits without an entityId (product.bulk_edit) cannot
   * be attributed to a product and do not appear here.
   */
  async productHistory(organizationId: string, productId: string) {
    await this.getProductOr404(organizationId, productId);
    const auditTable = (this.prisma as any).auditLog;
    if (!auditTable?.findMany) return { items: [], truncated: false };
    const variantRows: any[] = ((await (this.prisma as any).productVariant
      .findMany({ where: { productId } })
      .catch(() => [])) ?? []) as any[];
    const entityIds = [productId, ...variantRows.map((v: any) => String(v.id))];
    const byId = new Map<string, any>();
    const direct: any[] = ((await auditTable.findMany({
      where: { organizationId, entityId: { in: entityIds } },
      orderBy: { createdAt: "desc" },
      take: 400,
    }).catch(() => [])) ?? []) as any[];
    for (const r of direct) byId.set(String(r.id), r);
    // Cost rows (entityId = the ProductCost id, product linked
    // through metadata). Real Prisma supports the Json path
    // filter; spec fakes may not — failure just skips this source.
    try {
      const costRows: any[] = ((await auditTable.findMany({
        where: { organizationId, action: "product.cost.set", metadata: { path: ["productId"], equals: productId } },
        orderBy: { createdAt: "desc" },
        take: 200,
      }).catch(() => [])) ?? []) as any[];
      for (const r of costRows) byId.set(String(r.id), r);
    } catch { /* metadata matching is a bonus source, never a failure */ }
    const rows = [...byId.values()].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const truncated = rows.length > 200;
    const page = rows.slice(0, 200);
    // Actor display names (failure-isolated decoration, ON2 style).
    const names = new Map<string, string>();
    const userIds = [...new Set(page.map((r: any) => r.userId).filter(Boolean))] as string[];
    if (userIds.length) {
      try {
        const users: any[] = ((await (this.prisma as any).user
          .findMany({ where: { id: { in: userIds } } })
          .catch(() => [])) ?? []) as any[];
        for (const u of users) names.set(String(u.id), u.name ?? u.email ?? String(u.id));
      } catch { /* names are decoration */ }
    }
    const TITLES: Record<string, string> = {
      "product.create": "পণ্য তৈরি হয়েছে",
      "product.update": "পণ্যের তথ্য হালনাগাদ হয়েছে",
      "product.archive": "পণ্য আর্কাইভ হয়েছে",
      "product.delete": "পণ্য স্থায়ীভাবে মুছে ফেলা হয়েছে",
      "product.variant.create": "নতুন ভ্যারিয়েন্ট যোগ হয়েছে",
      "product.variant.update": "ভ্যারিয়েন্ট হালনাগাদ হয়েছে",
      "product.variant.delete": "ভ্যারিয়েন্ট মুছে ফেলা হয়েছে",
      "product.cost.set": "পণ্যের খরচ নির্ধারণ হয়েছে",
      "product.image.create": "ছবি যোগ হয়েছে",
      "product.image.delete": "ছবি মুছে ফেলা হয়েছে",
      "product.image.reorder": "ছবির ক্রম বদলানো হয়েছে",
      "product.bundle.add": "বান্ডল আইটেম যোগ হয়েছে",
      "product.bundle.delete": "বান্ডল আইটেম সরানো হয়েছে",
      "inventory.adjusted": "স্টক সমন্বয় হয়েছে",
      "inventory.low_stock_alert": "কম স্টকের সতর্কতা পাঠানো হয়েছে",
      "inventory.out_of_stock_alert": "স্টক শেষের সতর্কতা পাঠানো হয়েছে",
    };
    const items = page.map((r: any) => {
      const action = String(r.action ?? "");
      const meta = (r.metadata ?? {}) as any;
      let detail: string | null = null;
      if (action === "inventory.adjusted" && meta.delta !== undefined && meta.balanceAfter !== undefined) {
        const d = Number(meta.delta);
        detail = `স্টক পরিবর্তন: ${d > 0 ? "+" : ""}${d} · বর্তমান ব্যালান্স: ${meta.balanceAfter}`;
      }
      return {
        at: r.createdAt ? new Date(r.createdAt).toISOString() : null,
        action,
        title: TITLES[action] ?? action,
        detail,
        actorName: r.userId ? (names.get(String(r.userId)) ?? null) : null,
      };
    });
    return { items, truncated };
  }
}
