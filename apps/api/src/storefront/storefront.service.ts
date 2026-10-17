import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import { BD_DISTRICTS } from "@repo/contracts";
import { Prisma } from "@repo/db";
import { PrismaService } from "../prisma/prisma.service";
import { createAgentNotification } from "../common/agent-notify";
import { isOrderLimitBlocked, OrderLimitBlockedError, SHOPPER_ORDER_BLOCK_MESSAGE,} from "../common/plan-limit-checks";
import { normalizeAttribution } from "../common/attribution.dto";
import { AuditService } from "../audit/audit.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { DiscountsService } from "../commerce/discounts.service";
import { DISCOUNT_REASON_MESSAGES } from "../commerce/discounts";
import { PromotionsService, type CheckoutEvaluation, type LoyaltyRedeemInput } from "../commerce/promotions.service";
import { LoyaltyService } from "../commerce/loyalty.service";
import { GiftCardsService } from "../commerce/gift-cards.service";
import { StoreCreditService } from "../membership/store-credit.service";
import { LicenseKeysService } from "../commerce/license-keys.service";
import {
  downloadTokenSecret,
  mintDownloadToken,
  verifyDownloadToken,
} from "./digital-download-token";
import { isGiftCardAmountAllowed, validateGiftCardConfig, type GiftCardConfig } from "../commerce/gift-cards";
import { BundlesService } from "../commerce/bundles.service";
import { PriceListsService, pickGroupPrice } from "../commerce/price-lists.service";
import { allocateBundle } from "../commerce/ec29-bundles";
import { phoneKeyLoose, type PromotionLine } from "../commerce/promotions";
import { isSoldOrder, rankBoughtTogether, rankBoughtTogetherForSeeds } from "./ec27-discovery";
import { buildTsQuerySql, expandSynonymQueries, normalizeSearchTerm } from "./search-fts";
import { refreshOrgSearchVectors } from "../products/search-vector";
import { DeliveryPricingService, cartWeightOf } from "./delivery-pricing.service";
import { resolveShopLocale } from "../translations/translations";
import {
  approvedStorefrontStrings, attachDisplayPrices, displayCurrencyRates, overlayProductTranslations,
} from "../translations/public-translations";
import { AffiliatesService } from "../affiliates/affiliates.service";
import { BlockedPhoneService } from "../fraud/blocked-phone.service";
import { CheckoutGuardService } from "../fraud/checkout-guard.service";
import { normalizeDeviceHash } from "../fraud/identifier-utils";
import { IdempotencyService } from "../fraud/idempotency.service";
import { evaluateCodRules } from "../fraud/cod-rules";
import { depositFor } from "../fraud/deposit";
import { defsForSurface, publicFieldDef, validateFieldAnswers } from "./checkout-fields";
import { buildCheckoutTrust, loadPublishedTermsPage, termsRefFor } from "../fraud/checkout-trust";
import { TenantPaymentsService } from "../connections/tenant-payments.service";
import { parseBdAddress } from "../orders/bd-address";
import { bdPhoneMatchKey } from "../orders/phone-utils";
import { hashShopSecret } from "./shop-auth.util";
import { TRACKING_FIELDS, validateTrackingValue } from "./tracking";
import { StorefrontDnsResolver, StorefrontRoutingFetcher } from "./storefront-dns";
import { assertPreorderLimit, preorderInfo, selectWholesaleTier } from "../commerce/ec24";
import { StorageService } from "../storage/storage.service";
import { normalizeProductVideo } from "../products/product-video";
import { customerRiderLocation } from "../delivery/rider-location-visibility";
import { displayProductDescription, displayProductName } from "../products/product-display";
import { InventoryService } from "../inventory/inventory.service";
import { EmailProvider } from "../messaging/email.provider";
import {
  SHOP_PAGE_SLUG_PATTERN,
  SYSTEM_PAGES,
  slugifyShopPageTitle,
  validateShopPageBlocks,
} from "./shop-pages";
import {
  PLATFORM_CUSTOM_DOMAIN_MESSAGE,
  customDomainCandidates,
  isPlatformHostedDomain,
  normalizeCustomDomainInput,
} from "../common/custom-domain";
import {
  effectiveCloudflareSaasConfig,
  ensurePlatformConfig,
} from "../common/platform-config";
import {
  CloudflareForSaasClient,
  httpsStatusDetail,
  mapHttpsStatus,
  type DomainHttpsStatus,
} from "../common/cloudflare-for-saas.client";
import type {
  CartContactDto,
  CheckoutDto,
  ContactMessageDto,
  CreateSearchSynonymDto,
  UpdateSearchSynonymDto,
  CreateBlogPostDto,
  UpdateBlogPostDto,
  ExpressCheckoutDto,
  CreateDeliverySlotDto,
  CreateShopPageDto,
  CreateZoneDto,
  GiftCardBalanceDto,
  PatchCartBundleDto,
  PatchCartLineDto,
  QuoteDto,
  TrackLookupDto,
  NdrRecoveryDto,
  UpdateDeliverySlotDto,
  UpdateShopPageDto,
  UpdateStorefrontSettingsDto,
  UpdateZoneDto,
  UpsertStorePopupDto,
  PopupLeadDto,
} from "./storefront.dto";
import { sanitizeSectionOrder, isValidSectionOrder } from "./shop-sections";

/**
 * GB7: the promotions-side identity helpers, accessed through
 * this widened type — the exact contract PromotionsService
 * exposes (null priorOrderCount = identity unverifiable). The
 * widening keeps the storefront compiling against the contract
 * regardless of declaration order across the parallel GB7
 * changes.
 */
type PromotionsGb7 = PromotionsService & {
  priorOrderCountFor?: (
    orgId: string,
    customerId: string | null,
    excludeOrderId?: string,
  ) => Promise<number | null>;
  customerIdForPhone?: (
    orgId: string,
    phone: string | null | undefined,
  ) => Promise<string | null>;
};

export const DHAKA_DISTRICT = "ঢাকা";
export const STOREFRONT_SOURCE = "native_storefront";
const PRODUCT_SCAN_CAP = 1000;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function toBigIntOrNull(v: unknown): bigint | null {
  if (v === null || v === undefined || v === "") return null;
  try {
    return BigInt(String(v));
  } catch {
    return null;
  }
}

/** GB1: true only for a parseable http/https URL. */
function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function parseMinorField(value: string | null | undefined, field: string): bigint | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) {
    throw new BadRequestException(`${field} অবশ্যই অঋণাত্মক পূর্ণসংখ্যা (মাইনর একক) হতে হবে`);
  }
  return BigInt(raw);
}

/** Stock state for a tracked/untracked quantity. Null stock = untracked. */
export function stockStateOf(stock: number | null | undefined, lowThreshold?: number | null): string {
  if (stock === null || stock === undefined) return "untracked";
  if (stock <= 0) return "out_of_stock";
  if (stock <= (lowThreshold ?? 5)) return "low";
  return "in_stock";
}

/**
 * EC8 — Native Storefront v2 backend (Mode B).
 *
 * Honesty discipline (same as the rest of the EC package):
 *  - A shop exists publicly ONLY when a StorefrontSetting row has
 *    shopEnabled = true; otherwise every public route answers 404.
 *  - Prices are always recomputed server-side from current product /
 *    variant rows at quote and checkout time — the cart stores only
 *    product/variant ids + quantities, never prices.
 *  - Checkout is COD by default. A bkash/nagad "advance" is only the
 *    customer's unverified free-text claim, recorded in the order
 *    note; nothing here ever marks an order paid (no gateway).
 *  - A custom domain is "verified" only after a real DNS TXT lookup
 *    returns the exact token, and "routing active" only after a real
 *    HTTP fetch of the domain returns this shop's marker.
 */
@Injectable()
export class StorefrontService {
  private readonly logger = new Logger(StorefrontService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly integrations?: IntegrationsService,
    @Optional() private readonly discounts?: DiscountsService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly dnsResolver?: StorefrontDnsResolver,
    @Optional() private readonly routingFetcher?: StorefrontRoutingFetcher,
    // EC16: unified promotion/coupon/referral evaluation. LAST
    // param + Optional so positional spec constructions keep
    // working (they fall back to the EC7 coupon-only block below,
    // which is behaviour-identical when no promotion applies).
    @Optional() private readonly promotions?: PromotionsService,
    // EC29: bundle resolution for cart/quote/checkout. LAST param
    // + Optional, same discipline as promotions above; without it
    // bundle lines are honestly refused at quote time.
    @Optional() private readonly bundles?: BundlesService,
    // EC30: weight-based rate rules + pickup points. LAST param
    // + Optional, same discipline; without it delivery pricing
    // stays the legacy flat zone charge + free-above, and pickup
    // is honestly refused at quote time.
    @Optional() private readonly deliveryPricing?: DeliveryPricingService,
    // EC32: affiliate attribution stamp. LAST param + Optional,
    // same discipline; without it a presented affiliate code is
    // simply not stamped (the stamp itself never throws).
    @Optional() private readonly affiliates?: AffiliatesService,
    // ON4: checkout blocklist refusal. LAST param + Optional,
    // same discipline; absent keeps checkout exactly as before.
    @Optional() private readonly blockedPhones?: BlockedPhoneService,
    // GB1 (GC2): shop contact-form email delivery. LAST param +
    // Optional, same discipline; MessagingModule exports
    // EmailProvider and StorefrontModule already imports it.
    // Absent (or SMTP unconfigured) => the contact message is
    // honestly recorded as not email-delivered.
    @Optional() private readonly email?: EmailProvider,
    // GB2 (GC7): availability + cart reservations. LAST param +
    // Optional, same discipline; absent (older spec constructions)
    // availability falls back to raw on-hand exactly as before
    // GB2 and reservations simply never engage.
    @Optional() private readonly inventory?: InventoryService,
    // GB3 (GC8/GC9): checkout gate (blocked/trusted/policy/
    // CAPTCHA + fraud rules) + idempotency replay. LAST params
    // + Optional, same discipline; absent keeps checkout exactly
    // as before GB3.
    @Optional() private readonly checkoutGuard?: CheckoutGuardService,
    @Optional() private readonly idempotency?: IdempotencyService,
    // GC10: embedded online payment options + placement
    // re-validation. LAST param + Optional, same discipline;
    // absent keeps checkout exactly as before GC10 (no online
    // options offered, an onlinePayment selection refused).
    @Optional() private readonly tenantPayments?: TenantPaymentsService,
    // AB1 (AX1): loyalty snapshot + placement-time points spend.
    // LAST param + Optional, same discipline; absent (older spec
    // constructions) keeps quote/checkout exactly as before AB1.
    @Optional() private readonly loyalty?: LoyaltyService,
    // AB2 (AX3): gift-card redemption resolution, placement-time
    // balance spend, issuance intents and the buyer reveal. LAST
    // param + Optional, same discipline; absent keeps
    // quote/checkout exactly as before AB2 (a presented code is
    // then unresolvable — see computeQuote).
    @Optional() private readonly giftCards?: GiftCardsService,
    // AB5 (AX7): B2B group price lists as a checkout PRICE
    // SOURCE. LAST param + Optional, same discipline; absent
    // keeps quote/checkout exactly as before AB5.
    @Optional() private readonly priceLists?: PriceListsService,
    // AB5 (AX9): license-key assignment at the digital reveal.
    // LAST param + Optional, same discipline; absent keeps the
    // reveal exactly as before AB5 (file links + gift cards
    // only, no licenseKeys field content).
    @Optional() private readonly licenseKeys?: LicenseKeysService,
    // RB6 (INT7 union: LAST slot — the GC-line slots 12–20 keep their positions for GB1/GB2/GB3/GC10/AB2/AB5 positional spec constructions)/RM9: presigned digital downloads. LAST param + Optional,
    // same discipline; absent (or local storage mode) keeps the
    // EC24b merchant-hosted reveal exactly as before.
    @Optional() private readonly storage?: StorageService,
    // NF7 (FB3): store-credit snapshot + placement-time spend.
    // LAST param + Optional, same discipline; absent keeps
    // quote/checkout exactly as before NF7.
    @Optional() private readonly storeCredit?: StoreCreditService,
  ) {}

  /** GC10: failure-isolated payment options for payloads. */
  private async paymentOptionsFor(orgId: string) {
    if (!this.tenantPayments?.publicPaymentOptions) return { online: [] as any[] };
    return this.tenantPayments.publicPaymentOptions(orgId).catch(() => ({ online: [] as any[] }));
  }

  /** GC10: validate a checkout's online selection (400 when
   * the pair is not really offered); null when not selected. */
  private async resolveOnlineSelection(orgId: string, dto: CheckoutDto) {
    if (!dto.onlinePayment) return null;
    if (!this.tenantPayments?.assertPublicPaymentOption) {
      throw new BadRequestException("এই অনলাইন পেমেন্টের অপশনটি এই দোকানে উপলব্ধ নয় — অন্য পেমেন্ট পদ্ধতি বেছে নিন।");
    }
    return this.tenantPayments.assertPublicPaymentOption(orgId, dto.onlinePayment);
  }

  private t(name: string): any {
    return (this.prisma as any)[name];
  }

  // ================= Public: org / shop resolution =================

  private async findOrgBySlug(orgSlug: string): Promise<any | null> {
    if (!orgSlug) return null;
    return this.t("organization").findFirst({ where: { slug: orgSlug } });
  }

  private async getSetting(orgId: string): Promise<any | null> {
    try {
      return await this.t("storefrontSetting").findFirst({ where: { organizationId: orgId } });
    } catch {
      return null;
    }
  }

  /** Resolve org + setting for public routes; 404 unless the shop is enabled. */
  private async requireEnabledShop(orgSlug: string): Promise<{ org: any; setting: any }> {
    const org = await this.findOrgBySlug(orgSlug);
    if (!org) throw new NotFoundException("দোকানটি পাওয়া যায়নি");
    const setting = await this.getSetting(org.id);
    if (!setting || setting.shopEnabled !== true) {
      throw new NotFoundException("দোকানটি পাওয়া যায়নি");
    }
    return { org, setting };
  }

  /**
   * AB4 (AX5b): the org's ACTIVE custom checkout-field defs.
   * Failure-isolated by design: a missing table (partial
   * deployment) or a read error reads as NO defs and logs a
   * warning — checkout then validates against an empty def
   * set (a presented answer key is still rejected as unknown
   * only when defs loaded; with no defs an answers payload
   * carrying keys is rejected by validateFieldAnswers too,
   * since no key is known — see checkout()).
   */
  private async loadCheckoutFieldDefs(orgId: string): Promise<any[]> {
    try {
      const table = this.t("checkoutFieldDef");
      if (!table?.findMany) return [];
      const rows = await table
        .findMany({ where: { organizationId: orgId, active: true } })
        .catch(() => null);
      if (!rows) {
        this.logger.warn(`checkout field defs load failed for org ${orgId} — treating as no defs`);
        return [];
      }
      return rows;
    } catch (e) {
      this.logger.warn(`checkout field defs load failed for org ${orgId}: ${errMsg(e)}`);
      return [];
    }
  }

  private async businessProfile(orgId: string): Promise<any | null> {
    try {
      return await this.t("businessProfile").findFirst({ where: { organizationId: orgId } });
    } catch {
      return null;
    }
  }

  // ================= GB3 (GC8): terms trust =================

  /** The published terms page row (failure-isolated). */
  private async loadTermsPage(orgId: string): Promise<any | null> {
    return loadPublishedTermsPage(this.prisma, orgId);
  }

  /** Terms reference for a consent stamp: the published
   * ShopPage slug "terms" (`page:terms@<updatedAt ISO>`), else
   * the setting's termsUrl, else null. */
  private async resolveTermsRef(orgId: string, setting: any): Promise<string | null> {
    const page = await this.loadTermsPage(orgId);
    return termsRefFor(setting, page).ref;
  }

  /** Terms-trust facts for reuse by public payloads. */
  async termsTrust(orgId: string, setting: any) {
    const page = await this.loadTermsPage(orgId);
    const t = termsRefFor(setting, page);
    return {
      termsRequired: t.required,
      termsRef: t.ref,
      termsUrl: t.url,
      termsPageSlug: page ? ("terms" as const) : null,
    };
  }

  // ================= Public: serialization =================

  private async imagesOf(productId: string): Promise<any[]> {
    try {
      const rows = await this.t("productImage").findMany({
        where: { productId },
        orderBy: { position: "asc" },
      });
      return rows ?? [];
    } catch {
      return [];
    }
  }

  private async variantsOf(productId: string): Promise<any[]> {
    try {
      const rows = await this.t("productVariant").findMany({
        where: { productId },
        orderBy: { createdAt: "asc" },
      });
      return rows ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Effective stock for stock-state display: the product's own stock,
   * or — when the product itself is untracked but variants exist —
   * the aggregate of tracked variant stock (null when nothing is
   * tracked anywhere, i.e. honestly "untracked").
   */
  private effectiveStock(product: any, variants: any[]): number | null {
    if (product.stockQuantity !== null && product.stockQuantity !== undefined) {
      return product.stockQuantity;
    }
    if (variants.length > 0) {
      const tracked = variants.filter((v) => v.stockQuantity !== null && v.stockQuantity !== undefined);
      if (tracked.length > 0) return tracked.reduce((sum, v) => sum + Number(v.stockQuantity), 0);
    }
    return null;
  }

  /**
   * AB6 (AX13): the shopper-facing product name for a locale —
   * the English alternate ONLY when the shop locale is "en" and
   * a non-empty nameEn exists; the primary name otherwise.
   */
  private displayNameOf(product: any, locale?: string | null): string {
    return displayProductName(product, locale);
  }

  /** AB6 (AX13): the description counterpart of displayNameOf. */
  private displayDescriptionOf(product: any, locale?: string | null): string | null {
    return displayProductDescription(product, locale);
  }

  private serializeProduct(
    product: any,
    variants: any[],
    images?: any[],
    extras?: {
      brand?: any | null;
      reservedByKey?: Map<string, number>;
      // GB7: live flash-sale decoration (null/absent ⇒ the
      // payload carries NO flashSale key at all — lean payloads).
      flash?: { promotionId: string; name: string; percentOff: number; endsAt: string } | null;
      // AB6 (AX13): shop locale for the name/description display
      // rule (see displayNameOf); absent ⇒ primary text.
      locale?: string | null;
    },
  ) {
    const gallery: string[] = [];
    if (product.imageUrl) gallery.push(product.imageUrl);
    for (const img of images ?? []) {
      if (img?.url && !gallery.includes(img.url)) gallery.push(img.url);
    }
    // GB2 (GC7): availability decoration. Reserved totals come
    // from the caller's batch map (active, unexpired cart
    // reservations); no map => no reservations tracked (0).
    const reservedOf = (variantId: string | null): number =>
      extras?.reservedByKey?.get(`${product.id}::${variantId ?? ""}`) ?? 0;
    const productTracked = variants.length === 0 && product.stockQuantity != null;
    const productReserved = productTracked ? reservedOf(null) : null;
    return {
      id: product.id,
      name: this.displayNameOf(product, extras?.locale),
      slug: product.slug ?? null,
      description: this.displayDescriptionOf(product, extras?.locale),
      category: product.category ?? null,
      categoryId: product.categoryId ?? null,
      sku: product.sku ?? null,
      priceMinor: String(product.priceMinor),
      // EC27: the sitemap's lastmod source (real row timestamp).
      updatedAt: product.updatedAt ? new Date(product.updatedAt).toISOString() : null,
      compareAtMinor: product.compareAtMinor != null ? String(product.compareAtMinor) : null,
      currency: product.currency ?? "BDT",
      imageUrl: gallery[0] ?? null,
      images: gallery,
      stockQuantity: this.effectiveStock(product, variants),
      stockState: stockStateOf(this.effectiveStock(product, variants), product.lowStockThreshold),
      // GB2 (GC7): product-level reservation view — only for
      // product-tracked rows (variant-tracked products expose
      // the numbers per variant below); nulls elsewhere.
      reservedQuantity: productReserved,
      availableQuantity: productTracked ? (product.stockQuantity as number) - (productReserved ?? 0) : null,
      // GB2 (GC6): free-shipping flag (PDP badge + delivery
      // semantics) and the product's brand (null when unbranded
      // or the brand could not be loaded).
      freeShipping: !!product.freeShipping,
      // GB7: flash-sale countdown decoration — included ONLY
      // when a live flash sale covers this product.
      ...(extras?.flash ? { flashSale: extras.flash } : {}),
      brand: extras?.brand
        ? { id: extras.brand.id, name: extras.brand.name, slug: extras.brand.slug, logoUrl: extras.brand.logoUrl ?? null }
        : null,
      // GB1 (GC4): normalized product video (null when the URL
      // is absent or not a playable YouTube/Vimeo/file URL).
      video: normalizeProductVideo(product),
      // EC24a: public pre-order info (null when not preorder).
      preorder: preorderInfo(product),
      // EC24b: ONLY the flag — digitalFileUrl is never serialized publicly.
      digital: !!product.digital,
      // AB2 (AX3): gift-card flag + face-value config (merchant-
      // authored pricing the shopper picks an amount from).
      isGiftCard: !!product.isGiftCard,
      giftCardConfig: product.giftCardConfig ?? null,
      bump:
        product.bumpPriceMinor != null && product.bumpTitle
          ? {
              title: product.bumpTitle,
              priceMinor: String(product.bumpPriceMinor),
              imageUrl: product.bumpImageUrl ?? null,
            }
          : null,
      variants: variants.map((v) => ({
        id: v.id,
        name: v.name,
        sku: v.sku ?? null,
        priceMinor: v.priceMinor != null ? String(v.priceMinor) : null,
        stockQuantity: v.stockQuantity ?? null,
        stockState: stockStateOf(v.stockQuantity, product.lowStockThreshold),
        // GB2 (GC7): per-variant reservation view (nulls when
        // the variant is untracked).
        reservedQuantity: v.stockQuantity != null ? reservedOf(v.id) : null,
        availableQuantity: v.stockQuantity != null ? (v.stockQuantity as number) - reservedOf(v.id) : null,
        attributes: v.attributes ?? null,
      })),
    };
  }

  /** ACTIVE products of the org (bounded scan), newest first. */
  private async activeProducts(orgId: string): Promise<any[]> {
    const rows = await this.t("product").findMany({
      where: { organizationId: orgId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      take: PRODUCT_SCAN_CAP,
    });
    return rows ?? [];
  }

  /**
   * EC27 shop search match (in-memory over the bounded ACTIVE
   * scan — plain contains matching, the same honesty as IN1: no
   * FTS is claimed). A product hits when the needle appears in
   * its name (the single name field carries Bengali and/or
   * English text), description, SKU, its legacy category string,
   * OR the NAME of its structured Category row (products linked
   * only by categoryId previously missed category-name searches).
   */
  private matchesSearch(product: any, q: string, categoryRows: any[]): boolean {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    const hit = (v: unknown) =>
      v !== null && v !== undefined && String(v).toLowerCase().includes(needle);
    if (hit(product.name) || hit(product.description) || hit(product.sku) || hit(product.category)) {
      return true;
    }
    if (product.categoryId) {
      const row = categoryRows.find((c) => String(c.id) === String(product.categoryId));
      if (row && hit(row.name)) return true;
    }
    return false;
  }

  private async categoryRows(orgId: string): Promise<any[]> {
    try {
      const rows = await this.t("category").findMany({
        where: { organizationId: orgId },
        orderBy: { name: "asc" },
      });
      return rows ?? [];
    } catch {
      return [];
    }
  }

  /** GB2 (GC6): org brands keyed by id (failure-isolated — a
   * brands problem never breaks a shop read). */
  private async loadBrandMap(orgId: string): Promise<Map<string, any>> {
    const map = new Map<string, any>();
    try {
      const table = this.t("brand");
      if (!table?.findMany) return map;
      const rows = (await table.findMany({ where: { organizationId: orgId } }).catch(() => [])) ?? [];
      for (const b of rows) map.set(String(b.id), b);
    } catch { /* decoration only */ }
    return map;
  }

  /** GB2 (GC7): active reservation totals for serialize maps
   * (empty when the inventory service is absent). */
  private async reservedTotals(orgId: string): Promise<Map<string, number>> {
    if (!this.inventory?.activeReservationTotals) return new Map();
    return this.inventory.activeReservationTotals(orgId).catch(() => new Map());
  }

  /**
   * Category list for the shop: canonical Category rows merged with
   * legacy Product.category strings (products that predate the
   * structured taxonomy). Legacy entries carry id: null and are
   * matched by name. Counts are ACTIVE products only.
   */
  private buildCategories(categoryRows: any[], products: any[]) {
    const out: Array<{ id: string | null; name: string; slug: string | null; productCount: number }> = [];
    const byId = new Map<string, (typeof out)[number]>();
    for (const c of categoryRows) {
      const entry = { id: c.id, name: c.name, slug: c.slug ?? null, productCount: 0 };
      out.push(entry);
      byId.set(String(c.id), entry);
    }
    const legacy = new Map<string, (typeof out)[number]>();
    for (const p of products) {
      if (p.categoryId && byId.has(String(p.categoryId))) {
        byId.get(String(p.categoryId))!.productCount++;
      } else if (p.category) {
        const name = String(p.category);
        if (!legacy.has(name)) {
          const entry = { id: null, name, slug: null, productCount: 0 };
          legacy.set(name, entry);
          out.push(entry);
        }
        legacy.get(name)!.productCount++;
      }
    }
    return out;
  }

  /** A category filter matches a Category id, its slug, or a legacy name. */
  private matchesCategory(product: any, filter: string, categoryRows: any[]): boolean {
    if (product.categoryId && String(product.categoryId) === filter) return true;
    if (product.category && String(product.category) === filter) return true;
    const row = categoryRows.find((c) => String(c.id) === filter || c.slug === filter);
    if (row) {
      if (product.categoryId && String(product.categoryId) === String(row.id)) return true;
      if (product.category && String(product.category) === String(row.name)) return true;
    }
    return false;
  }

  /**
   * EC19 top sellers: real sales of the last 30 days. An order
   * qualifies when it is not a practice order, was placed within
   * the window, its status is not cancelled/refunded/failed, AND
   * it is either status "completed" or has a Fulfillment in
   * "delivered". Items aggregate quantity + revenue per product:
   * item.productId wins; otherwise the item SKU resolves against
   * the ACTIVE product list (the bump pseudo-line never counts).
   * Sorted by quantity desc, then revenue desc; at most 8.
   */
  private async topSellerProducts(orgId: string, all: any[]): Promise<any[]> {
    const orderTable = this.t("order");
    if (!orderTable?.findMany) return [];
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const orders: any[] =
      (await orderTable
        .findMany({ where: { organizationId: orgId, isPractice: false, placedAt: { gte: since } } })
        .catch(() => [])) ?? [];
    const excluded = new Set(["cancelled", "refunded", "failed"]);
    const candidates = orders.filter((o) => !excluded.has(String(o.status)));
    if (candidates.length === 0) return [];

    let fulfillments: any[] = [];
    try {
      const table = this.t("fulfillment");
      if (table?.findMany) {
        fulfillments =
          (await table.findMany({ where: { orderId: { in: candidates.map((o) => o.id) } } }).catch(() => [])) ?? [];
      }
    } catch { fulfillments = []; }
    const deliveredOrderIds = new Set(
      fulfillments.filter((f) => f.status === "delivered").map((f) => String(f.orderId)),
    );
    const qualified = candidates.filter(
      (o) => o.status === "completed" || deliveredOrderIds.has(String(o.id)),
    );
    if (qualified.length === 0) return [];

    let items: any[] = [];
    try {
      const table = this.t("orderItem");
      if (table?.findMany) {
        items =
          (await table.findMany({ where: { orderId: { in: qualified.map((o) => o.id) } } }).catch(() => [])) ?? [];
      }
    } catch { items = []; }
    if (items.length === 0) return [];

    const byId = new Map(all.map((p) => [String(p.id), p]));
    const bySku = new Map<string, any>();
    for (const p of all) if (p.sku) bySku.set(String(p.sku), p);
    const agg = new Map<string, { product: any; quantity: number; revenue: bigint }>();
    for (const item of items) {
      if (item.sku && String(item.sku) === "ADD-ON-BUMP") continue;
      let product: any = null;
      if (item.productId) product = byId.get(String(item.productId)) ?? null;
      else if (item.sku) product = bySku.get(String(item.sku)) ?? null;
      if (!product) continue; // resolves to no ACTIVE product
      const key = String(product.id);
      const entry = agg.get(key) ?? { product, quantity: 0, revenue: 0n };
      entry.quantity += Number(item.quantity ?? 0);
      try { entry.revenue += BigInt(item.totalMinor ?? 0); } catch { /* unparseable line revenue counts 0 */ }
      agg.set(key, entry);
    }
    return [...agg.values()]
      .sort((a, b) => {
        if (b.quantity !== a.quantity) return b.quantity - a.quantity;
        if (a.revenue !== b.revenue) return a.revenue > b.revenue ? -1 : 1;
        return 0;
      })
      .slice(0, 8)
      .map((e) => e.product);
  }

  /**
   * GB1 (GC4) — sold stats per product for the "best_selling"
   * shop sort. Qualification mirrors topSellerProducts EXACTLY:
   * non-practice orders placed within 30 days, status not in
   * {cancelled, refunded, failed}, AND (status completed OR a
   * Fulfillment with status "delivered"). Quantity/revenue are
   * summed per resolved product (item.productId wins, else SKU
   * match against the scanned ACTIVE list; SKU "ADD-ON-BUMP"
   * never counts). Failure-isolated: any failure returns an
   * empty map and the caller falls back to the featured order.
   */
  private async soldStatsByProduct(
    orgId: string,
    all: any[],
  ): Promise<Map<string, { quantity: number; revenue: bigint }>> {
    const out = new Map<string, { quantity: number; revenue: bigint }>();
    try {
      const orderTable = this.t("order");
      if (!orderTable?.findMany) return out;
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
      const orders: any[] =
        (await orderTable
          .findMany({ where: { organizationId: orgId, isPractice: false, placedAt: { gte: since } } })
          .catch(() => [])) ?? [];
      const excluded = new Set(["cancelled", "refunded", "failed"]);
      const candidates = orders.filter((o) => !excluded.has(String(o.status)));
      if (candidates.length === 0) return out;

      let fulfillments: any[] = [];
      try {
        const table = this.t("fulfillment");
        if (table?.findMany) {
          fulfillments =
            (await table.findMany({ where: { orderId: { in: candidates.map((o) => o.id) } } }).catch(() => [])) ?? [];
        }
      } catch { fulfillments = []; }
      const deliveredOrderIds = new Set(
        fulfillments.filter((f) => f.status === "delivered").map((f) => String(f.orderId)),
      );
      const qualified = candidates.filter(
        (o) => o.status === "completed" || deliveredOrderIds.has(String(o.id)),
      );
      if (qualified.length === 0) return out;

      let items: any[] = [];
      try {
        const table = this.t("orderItem");
        if (table?.findMany) {
          items =
            (await table.findMany({ where: { orderId: { in: qualified.map((o) => o.id) } } }).catch(() => [])) ?? [];
        }
      } catch { items = []; }
      if (items.length === 0) return out;

      const byId = new Map(all.map((p) => [String(p.id), p]));
      const bySku = new Map<string, any>();
      for (const p of all) if (p.sku) bySku.set(String(p.sku), p);
      for (const item of items) {
        if (item.sku && String(item.sku) === "ADD-ON-BUMP") continue;
        let product: any = null;
        if (item.productId) product = byId.get(String(item.productId)) ?? null;
        else if (item.sku) product = bySku.get(String(item.sku)) ?? null;
        if (!product) continue;
        const key = String(product.id);
        const entry = out.get(key) ?? { quantity: 0, revenue: 0n };
        entry.quantity += Number(item.quantity ?? 0);
        try { entry.revenue += BigInt(item.totalMinor ?? 0); } catch { /* unparseable line revenue counts 0 */ }
        out.set(key, entry);
      }
      return out;
    } catch {
      return new Map();
    }
  }

  // ================= Public: shop home / product detail =================

  /** GB1 (GC4): order a filtered product list per the shop
   * sort parameter. `rows` is a caller-owned copy. */
  private async applyShopSort(orgId: string, rows: any[], sort: string | undefined, all: any[]): Promise<any[]> {
    const byCreatedDesc = (a: any, b: any) =>
      new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
    switch (sort) {
      case undefined:
      case "":
      case "featured":
        return rows;
      case "newest":
        return rows.sort(byCreatedDesc);
      case "price_asc":
      case "price_desc": {
        const dir = sort === "price_asc" ? 1 : -1;
        return rows.sort((a, b) => {
          let cmp = 0;
          try {
            const pa = BigInt(a.priceMinor ?? 0);
            const pb = BigInt(b.priceMinor ?? 0);
            cmp = pa < pb ? -1 : pa > pb ? 1 : 0;
          } catch { cmp = 0; }
          return cmp !== 0 ? cmp * dir : byCreatedDesc(a, b);
        });
      }
      case "name_asc":
        return rows.sort((a, b) => {
          const cmp = String(a.name ?? "").localeCompare(String(b.name ?? ""));
          return cmp !== 0 ? cmp : byCreatedDesc(a, b);
        });
      case "best_selling": {
        const stats = await this.soldStatsByProduct(orgId, all).catch(
          () => new Map<string, { quantity: number; revenue: bigint }>(),
        );
        if (stats.size === 0) return rows; // no sales evidence ⇒ featured order
        const withSales = rows.filter((p) => stats.has(String(p.id)));
        const rest = rows.filter((p) => !stats.has(String(p.id))).sort(byCreatedDesc);
        withSales.sort((a, b) => {
          const sa = stats.get(String(a.id))!;
          const sb = stats.get(String(b.id))!;
          if (sb.quantity !== sa.quantity) return sb.quantity - sa.quantity;
          if (sa.revenue !== sb.revenue) return sa.revenue > sb.revenue ? -1 : 1;
          return byCreatedDesc(a, b);
        });
        return [...withSales, ...rest];
      }
      default:
        return rows;
    }
  }

  /**
   * AB6 (AX11): FTS search over Product.searchVector. Returns
   * the ranked product ids, or null when FTS is unavailable or
   * failed — null (and an empty id list from a successful query)
   * both make the caller run the legacy substring fallback, so a
   * search NEVER hard-fails on the FTS path. Merchant synonyms
   * are loaded failure-isolated (absent table ⇒ no expansions).
   */
  private async searchViaFts(orgId: string, q: string): Promise<{ ids: string[] } | null> {
    try {
      const prismaAny = this.prisma as any;
      if (typeof prismaAny.$queryRaw !== "function") return null;
      let synonyms: Array<{ term: string; expansions: string[] }> = [];
      try {
        const table = this.t("searchSynonym");
        if (table?.findMany) {
          const rows: any[] = (await table.findMany({ where: { organizationId: orgId } })) ?? [];
          synonyms = rows.map((r: any) => ({
            term: String(r.term ?? ""),
            expansions: Array.isArray(r.expansions) ? r.expansions.map((x: any) => String(x)) : [],
          }));
        }
      } catch {
        synonyms = [];
      }
      const phrases = expandSynonymQueries(q, synonyms);
      const tsquery = buildTsQuerySql(phrases);
      const rows: any[] =
        (await prismaAny.$queryRaw(Prisma.sql`SELECT p."id" AS id FROM "Product" p WHERE p."organizationId" = ${orgId} AND p."status" = 'ACTIVE' AND p."searchVector" IS NOT NULL AND p."searchVector" @@ ${tsquery} ORDER BY ts_rank(p."searchVector", ${tsquery}) DESC, p."createdAt" DESC LIMIT 500`)) ?? [];
      return { ids: rows.map((r: any) => String(r.id)) };
    } catch (e) {
      this.logger.warn(`FTS search failed for org ${orgId}: ${errMsg(e)}`);
      return null;
    }
  }

  /**
   * AB6 (AX11): one SearchQueryLog row per public shop search.
   * Failure-isolated by construction — this NEVER throws, so a
   * logging problem can never break a shopper's search.
   */
  private async recordSearchQuery(
    orgId: string,
    rawTerm: string,
    resultsCount: number,
    viaFallback: boolean,
  ): Promise<void> {
    try {
      const term = normalizeSearchTerm(rawTerm).slice(0, 200);
      if (!term) return;
      const table = this.t("searchQueryLog");
      if (!table?.create) return;
      await table.create({ data: { organizationId: orgId, term, resultsCount, viaFallback } });
    } catch (e) {
      this.logger.warn(`search query log failed for org ${orgId}: ${errMsg(e)}`);
    }
  }

  async shopHome(orgSlug: string, query: { q?: string; category?: string; brand?: string; page?: number; pageSize?: number; sort?: string; ids?: string; locale?: string }) {
    const { org, setting } = await this.requireEnabledShop(orgSlug);
    // NF5 (FB3): the served locale — an explicit shopper choice
    // (?locale= on the SAME :orgSlug route) wins when supported;
    // otherwise the org's StorefrontSetting.locale (EC19 pattern).
    const shopLocale = resolveShopLocale(query.locale, (setting as any)?.locale ?? null);
    const bp = await this.businessProfile(org.id);
    const categoryRows = await this.categoryRows(org.id);
    const scanned = await this.activeProducts(org.id);
    // AB6 (AX14): ids mode — an explicit product-id list (the
    // cart cross-sell's deep link into the listing). The result
    // is the scanned ACTIVE products filtered to the id set,
    // ORDERED BY the requested ids order; q/category/brand
    // filters are SKIPPED in this mode (the caller named the
    // exact products it wants).
    const idsList = query.ids
      ? query.ids.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    let all: any[];
    if (idsList.length >= 1) {
      const byId = new Map(scanned.map((p) => [String(p.id), p]));
      const seenIds = new Set<string>();
      all = [];
      for (const id of idsList) {
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        const p = byId.get(id);
        if (p) all.push(p);
      }
    } else if (query.q?.trim()) {
      // AB6 (AX11): FTS first (rank order preserved); FTS
      // unavailable/failed OR a genuine zero falls back to the
      // legacy substring scan (matchesSearch, unchanged).
      const fts = await this.searchViaFts(org.id, query.q!).catch(() => null);
      let viaFallback = false;
      if (fts && fts.ids.length) {
        const byId = new Map(scanned.map((p) => [String(p.id), p]));
        all = fts.ids.map((id) => byId.get(String(id))).filter(Boolean);
      } else {
        all = scanned.filter((p) => this.matchesSearch(p, query.q!, categoryRows));
        viaFallback = true;
      }
      // AB6 (AX11): analytics — resultsCount is the search-stage
      // outcome (the `all` set BEFORE category/brand filters).
      void this.recordSearchQuery(org.id, query.q!, all.length, viaFallback);
    } else {
      all = scanned;
    }
    const categories = this.buildCategories(categoryRows, all);
    // GB2 (GC6/GC7): brand map + reservation totals for the
    // serialize extras (both failure-isolated loads).
    const brandMap = await this.loadBrandMap(org.id);
    const reservedByKey = await this.reservedTotals(org.id);
    // GB7: live flash-sale decoration map (failure-isolated).
    const flashMap = await this.activeFlashMap(org.id);
    // Brands payload: only brands carrying at least one ACTIVE
    // product, with their ACTIVE counts (shop nav honesty).
    const brands = [...brandMap.values()]
      .map((b) => ({
        id: b.id, name: b.name, slug: b.slug, logoUrl: b.logoUrl ?? null,
        productCount: all.filter((p) => String(p.brandId ?? "") === String(b.id)).length,
      }))
      .filter((b) => b.productCount > 0)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));

    let filtered = all;
    if (query.category) {
      filtered = all.filter((p) => this.matchesCategory(p, String(query.category), categoryRows));
    }
    // GB2 (GC6): brand filter by slug (unknown slug => empty
    // listing, never an error — same discipline as sort).
    if (query.brand) {
      const brand = [...brandMap.values()].find((b) => String(b.slug) === String(query.brand));
      filtered = brand
        ? filtered.filter((p) => String(p.brandId ?? "") === String(brand.id))
        : [];
    }
    // GB1 (GC4): shop sort. Unknown values are treated as
    // "featured" (the current scan order) — a public listing is
    // never 400'd over a sort parameter. Sorting works on a copy
    // so the featured section keeps its own ordering.
    filtered = await this.applyShopSort(org.id, [...filtered], query.sort, all);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(60, Math.max(1, query.pageSize ?? 24));
    const total = filtered.length;
    const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

    // Featured: the merchant's chosen ids (in their order) ∩ ACTIVE;
    // fallback = newest ACTIVE. Only when the section is enabled.
    // EC19: in "top_sellers" mode the section is filled from real
    // sales of the last 30 days instead; when there are no
    // qualifying sales it falls back to merchant picks, then newest.
    let featured: any[] = [];
    if (setting.showFeatured !== false) {
      if ((setting.featuredMode ?? "merchant_picks") === "top_sellers") {
        featured = await this.topSellerProducts(org.id, all).catch(() => []);
      }
      if (featured.length === 0) {
        const ids: string[] = Array.isArray(setting.featuredProductIds)
          ? setting.featuredProductIds.map((x: any) => String(x))
          : [];
        if (ids.length > 0) {
          const byId = new Map(all.map((p) => [String(p.id), p]));
          featured = ids.map((id) => byId.get(id)).filter(Boolean).slice(0, 8);
        }
      }
      if (featured.length === 0) featured = all.slice(0, 8);
    }

    const serializeList = async (rows: any[]) => {
      const out = [];
      for (const p of rows) {
        out.push(this.serializeProduct(p, await this.variantsOf(p.id), undefined, {
          brand: p.brandId ? (brandMap.get(String(p.brandId)) ?? null) : null,
          reservedByKey,
          flash: flashMap.get(String(p.id)) ?? null,
          // AB6 (AX13): shop-locale display names/descriptions.
          locale: shopLocale,
        }));
      }
      return out;
    };

    // NF5 (FB3): approved-translation overlay + display-currency
    // decoration for the public lists. Both are failure-isolated
    // (a translations problem never breaks the shop) and READ-ONLY:
    // only APPROVED translations are served (drafts never leak —
    // public-translations.ts filters on approved in the query),
    // missing rows keep the base text, and displayPrices are
    // labelled approximate strings that checkout never reads.
    const nf5Rates = await displayCurrencyRates(this.prisma as any, org.id).catch(() => []);
    const nf5Strings = await approvedStorefrontStrings(this.prisma as any, org.id, shopLocale).catch(() => new Map<string, string>());
    const serializePublic = async (rows: any[]) => {
      const list = await serializeList(rows);
      await overlayProductTranslations(this.prisma as any, org.id, list, shopLocale).catch(() => list);
      return attachDisplayPrices(list, nf5Rates, shopLocale);
    };

    // GC10: computed once — mirrored at the payload top level
    // below AND inside settings (see the return).
    const checkoutTrust = await buildCheckoutTrust(this.prisma, this.checkoutGuard, org.id, setting, bp);
    const paymentOptions = await this.paymentOptionsFor(org.id);
    // AB4 (AX5b): the shop surface's custom checkout fields
    // (public shape only; defs loaded failure-isolated).
    const checkoutFields = defsForSurface(await this.loadCheckoutFieldDefs(org.id), "shop").map(publicFieldDef);
    return {
      // GC10: real online-payment options for the checkout page
      // (failure-isolated — empty when no gateway is offered).
      paymentOptions,
      // AB4 (AX5b): custom checkout fields for the shop form.
      checkoutFields,
      // GB3 leftover fix: the shop checkout page reads
      // shop.checkoutTrust at the TOP level while shopHome used
      // to nest it only inside settings — mirror it here too
      // (additive; the settings copy stays for existing readers).
      checkoutTrust,
      settings: {
        shopName: setting.shopName || org.brandName || org.name,
        // NF5: an APPROVED storefront-string translation for the
        // served locale wins; otherwise the merchant's base text.
        announcementText: nf5Strings.get("announcementText") ?? setting.announcementText ?? null,
        showFeatured: setting.showFeatured !== false,
        showCategories: setting.showCategories !== false,
        showSearch: setting.showSearch !== false,
        // OU8: section customizer for the shop home render list.
        showHero: setting.showHero !== false,
        showBrands: setting.showBrands !== false,
        showBundles: setting.showBundles !== false,
        showFlashSale: setting.showFlashSale !== false,
        showRecentlyViewed: setting.showRecentlyViewed !== false,
        sectionOrder: Array.isArray(setting.sectionOrder) ? sanitizeSectionOrder(setting.sectionOrder) : null,
        metaDescription: setting.metaDescription ?? null,
        locale: shopLocale,
        featuredMode: setting.featuredMode ?? "merchant_picks",
        trackingPageEnabled: setting.trackingPageEnabled !== false,
        returnPolicyText: nf5Strings.get("returnPolicyText") ?? setting.returnPolicyText ?? null,
        deliveryPromiseText: nf5Strings.get("deliveryPromiseText") ?? setting.deliveryPromiseText ?? null,
        supportPhone: setting.supportPhone ?? null,
        // NF5: the human-entered display-currency rates behind
        // each product's displayPrices (provenance for shoppers /
        // staff debugging; empty = no converted price is shown).
        displayCurrencies: nf5Rates.map((r: any) => ({
          currency: String(r.currency).toUpperCase(),
          ratePerUnit: String(r.ratePerUnit),
          sourceNote: r.sourceNote ?? null,
          updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
        })),
        // GB1 (GC1/GC4): theme + favicon + direct contact channels.
        themeId: setting.themeId ?? "classic",
        faviconUrl: setting.faviconUrl ?? null,
        whatsappNumber: setting.whatsappNumber ?? null,
        messengerUrl: setting.messengerUrl ?? null,
        // GB7 (GC18): the merchant's own tracking ids for the
        // shop's tag rendering (null = unset = render nothing).
        tracking: {
          ga4MeasurementId: setting.ga4MeasurementId ?? null,
          gtmContainerId: setting.gtmContainerId ?? null,
          googleAdsId: setting.googleAdsId ?? null,
          googleAdsConversionLabel: setting.googleAdsConversionLabel ?? null,
          searchConsoleVerification: setting.searchConsoleVerification ?? null,
          metaPixelId: setting.metaPixelId ?? bp?.metaPixelId ?? null,
          tikTokPixelId: setting.tikTokPixelId ?? bp?.tikTokPixelId ?? null,
          clarityId: setting.clarityId ?? null,
        },
        // GB3 (GC8/GC9): shared checkout-trust payload (terms /
        // CAPTCHA / COD) — failure-isolated inside the builder.
        checkoutTrust,
        // AB8 (AX23): the merchant's OWN custom code — raw values
        // for the shop layout to render (public shop payload).
        customCss: setting.customCss ?? null,
        customJs: setting.customJs ?? null,
        customJsEnabled: setting.customJsEnabled === true,
      },
      // GB1 (GC2): published content pages for menu/footer
      // (failure-isolated — a pages problem never breaks home).
      pages: await this.publicPageLinks(org.id),
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        brandName: org.brandName ?? null,
        logoUrl: org.logoUrl ?? null,
        primaryColor: org.primaryColor ?? null,
        // AB8 (AX24): white-label flag for the shop surfaces.
        whiteLabel: org.whiteLabel === true,
        customDomain: org.customDomain ?? null,
        domainVerified: !!setting.domainVerifiedAt,
      },
      businessProfile: {
        codAvailable: bp?.codAvailable !== false,
        bkashNumber: bp?.bkashNumber ?? null,
        nagadNumber: bp?.nagadNumber ?? null,
        paymentNote: bp?.paymentNote ?? null,
      },
      districts: [...BD_DISTRICTS],
      categories,
      // GB2 (GC6): brands with ACTIVE products (shop filter/nav).
      brands,
      // EC29: public bundles (failure-isolated — a bundle problem
      // must never break the shop home).
      bundles: this.bundles
        ? await this.bundles.publicBundles(org.id).catch(() => [])
        : [],
      featuredProducts: await serializePublic(featured),
      products: await serializePublic(pageRows),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  /**
   * GB2 (GC6): public brand page — the brand's info + its ACTIVE
   * products through the same serialize machinery as the listing.
   * An unknown slug 404s (a brand page is a destination, unlike
   * the listing filter which answers an empty list).
   */
  async shopBrandPage(orgSlug: string, brandSlug: string) {
    const { org, setting } = await this.requireEnabledShop(orgSlug);
    const brandMap = await this.loadBrandMap(org.id);
    const brand = [...brandMap.values()].find((b) => String(b.slug) === String(brandSlug));
    if (!brand) throw new NotFoundException("ব্র্যান্ডটি পাওয়া যায়নি");
    const reservedByKey = await this.reservedTotals(org.id);
    const flashMap = await this.activeFlashMap(org.id);
    const rows = (await this.activeProducts(org.id)).filter(
      (p) => String(p.brandId ?? "") === String(brand.id),
    );
    const products = [];
    for (const p of rows) {
      products.push(this.serializeProduct(p, await this.variantsOf(p.id), undefined, {
        brand,
        reservedByKey,
        flash: flashMap.get(String(p.id)) ?? null,
        // AB6 (AX13): shop-locale display names/descriptions.
        locale: (setting as any)?.locale ?? null,
      }));
    }
    return {
      brand: {
        id: brand.id, name: brand.name, slug: brand.slug,
        logoUrl: brand.logoUrl ?? null, description: brand.description ?? null,
      },
      products,
    };
  }

  async productDetail(orgSlug: string, productSlug: string, locale?: string) {
    const { org, setting } = await this.requireEnabledShop(orgSlug);
    // NF5 (FB3): served locale — shopper ?locale= wins when
    // supported, else the org's StorefrontSetting.locale.
    const shopLocale = resolveShopLocale(locale, (setting as any)?.locale ?? null);
    const product = await this.t("product").findFirst({
      where: { organizationId: org.id, slug: productSlug, status: "ACTIVE" },
    });
    if (!product) throw new NotFoundException("পণ্যটি পাওয়া যায়নি");
    const variants = await this.variantsOf(product.id);
    const images = await this.imagesOf(product.id);
    // GB2: brand + reservation extras for the PDP.
    const brandMap = await this.loadBrandMap(org.id);
    const reservedByKey = await this.reservedTotals(org.id);
    // GB7: flash-sale decoration for the PDP (product.flashSale
    // only — no duplicate top-level copy; the PDP reads
    // detail.product.flashSale).
    const flashMap = await this.activeFlashMap(org.id);
    const serialized = this.serializeProduct(product, variants, images, {
      brand: product.brandId ? (brandMap.get(String(product.brandId)) ?? null) : null,
      reservedByKey,
      flash: flashMap.get(String(product.id)) ?? null,
      // AB6 (AX13): shop-locale display names/descriptions.
      locale: shopLocale,
    });

    let category: { id: string | null; name: string | null; slug: string | null } = {
      id: null,
      name: product.category ?? null,
      slug: null,
    };
    if (product.categoryId) {
      const row = await this.t("category")
        .findFirst({ where: { id: product.categoryId, organizationId: org.id } })
        .catch(() => null);
      if (row) category = { id: row.id, name: row.name, slug: row.slug ?? null };
    }

    const siblings = await this.activeProducts(org.id);
    const relatedRows = siblings
      .filter(
        (p) =>
          p.id !== product.id &&
          ((product.categoryId && p.categoryId === product.categoryId) ||
            (product.category && p.category === product.category)),
      )
      .slice(0, 4);
    const related = [];
    for (const p of relatedRows) {
      related.push(this.serializeProduct(p, await this.variantsOf(p.id), undefined, {
        brand: p.brandId ? (brandMap.get(String(p.brandId)) ?? null) : null,
        reservedByKey,
        flash: flashMap.get(String(p.id)) ?? null,
        // AB6 (AX13): shop-locale display names/descriptions.
        locale: shopLocale,
      }));
    }

    // EC27: bought-together from real sold orders (failure-isolated).
    const boughtTogetherRaw = await this.boughtTogether(org.id, product, siblings, shopLocale).catch(() => []);

    // NF5 (FB3): approved-translation overlay + display prices
    // on the PDP product, related and bought-together lists —
    // same public rules as shopHome (approved only, base-text
    // fallback, display-only conversion). Failure-isolated.
    const nf5Rates = await displayCurrencyRates(this.prisma as any, org.id).catch(() => []);
    const nf5Strings = await approvedStorefrontStrings(this.prisma as any, org.id, shopLocale).catch(() => new Map<string, string>());
    const overlayList = async (list: any[]) => {
      await overlayProductTranslations(this.prisma as any, org.id, list, shopLocale).catch(() => list);
      return attachDisplayPrices(list, nf5Rates, shopLocale);
    };
    const [productPublic] = await overlayList([serialized]);
    const relatedPublic = await overlayList(related);
    const boughtTogether = await overlayList(boughtTogetherRaw);

    return {
      product: {
        ...productPublic,
        category: { ...category, legacy: product.category ?? null },
        seo: { title: product.seoTitle ?? null, description: product.seoDescription ?? null },
      },
      related: relatedPublic,
      boughtTogether,
      // EC19: shop language + trust copy for the product page.
      settings: {
        locale: shopLocale,
        trackingPageEnabled: setting.trackingPageEnabled !== false,
        returnPolicyText: nf5Strings.get("returnPolicyText") ?? setting.returnPolicyText ?? null,
        deliveryPromiseText: nf5Strings.get("deliveryPromiseText") ?? setting.deliveryPromiseText ?? null,
        supportPhone: setting.supportPhone ?? null,
      },
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        brandName: org.brandName ?? null,
        logoUrl: org.logoUrl ?? null,
        primaryColor: org.primaryColor ?? null,
      },
    };
  }

  /**
   * EC27 — bought-together: products most frequently co-occurring
   * with this one in the same SOLD orders of the last 180 days
   * (EC33 sold definition; gift lines excluded — see
   * ec27-discovery.ts). Only ACTIVE products, in the public card
   * shape. Fewer than 2 co-occurrences ⇒ the product is omitted
   * (empty array overall when nothing qualifies — no filler).
   */
  /**
   * EC27/AB6: the sold-order line load shared by boughtTogether
   * and cartRecommendations — non-practice orders of the last
   * 180 days, filtered to SOLD orders (EC33 definition via
   * courier-shipment statuses), then their OrderItem rows. Any
   * empty stage yields an empty item list (both callers then
   * answer an empty recommendation set — no filler).
   */
  private async soldOrderItems(orgId: string): Promise<{ items: any[] }> {
    const orderTable = this.t("order");
    if (!orderTable?.findMany) return { items: [] };
    const since = new Date(Date.now() - 180 * 24 * 3600 * 1000);
    const orders: any[] =
      (await orderTable.findMany({ where: { organizationId: orgId, isPractice: false } }).catch(() => [])) ?? [];
    const inWindow = orders.filter((o) => {
      const d = new Date(o.placedAt ?? o.createdAt ?? 0);
      return !Number.isNaN(d.getTime()) && d.getTime() >= since.getTime();
    });
    if (inWindow.length === 0) return { items: [] };

    let shipments: any[] = [];
    try {
      const table = this.t("courierShipment");
      if (table?.findMany) {
        shipments =
          (await table.findMany({ where: { orderId: { in: inWindow.map((o) => o.id) } } }).catch(() => [])) ?? [];
      }
    } catch { shipments = []; }
    const statusesByOrder = new Map<string, string[]>();
    for (const s of shipments) {
      const arr = statusesByOrder.get(String(s.orderId)) ?? [];
      arr.push(String(s.status));
      statusesByOrder.set(String(s.orderId), arr);
    }
    const sold = inWindow.filter((o) => isSoldOrder(o, statusesByOrder.get(String(o.id)) ?? []));
    if (sold.length === 0) return { items: [] };

    const itemTable = this.t("orderItem");
    if (!itemTable?.findMany) return { items: [] };
    const items: any[] =
      (await itemTable.findMany({ where: { orderId: { in: sold.map((o) => o.id) } } }).catch(() => [])) ?? [];
    return { items };
  }

  private async boughtTogether(orgId: string, product: any, active: any[], locale?: string | null): Promise<any[]> {
    const { items } = await this.soldOrderItems(orgId);
    if (items.length === 0) return [];

    const activeById = new Map(active.map((p) => [String(p.id), p]));
    const ranked = rankBoughtTogether(
      items.map((i) => ({ orderId: String(i.orderId), productId: i.productId ?? null, isGift: !!i.isGift })),
      String(product.id),
      new Set(activeById.keys()),
    );
    const out = [];
    for (const r of ranked) {
      const p = activeById.get(r.productId);
      if (p) out.push(this.serializeProduct(p, await this.variantsOf(p.id), undefined, { locale: locale ?? null }));
    }
    return out;
  }

  /**
   * AB6 (AX14) — cart cross-sell: products most frequently
   * bought together with ANY of the cart's products, from the
   * same SOLD orders of the last 180 days as boughtTogether
   * (gift lines never count; >= 2 co-occurring orders; seeds
   * excluded). At most 8, out-of-stock products excluded, in the
   * public card shape with the shop-locale display rule. No
   * usable seed (empty/unknown/inactive ids) ⇒ an honest empty
   * list — never filler recommendations.
   */
  async cartRecommendations(orgSlug: string, productIdsRaw: string) {
    const { org, setting } = await this.requireEnabledShop(orgSlug);
    const parsed = [...new Set(
      String(productIdsRaw ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    )].slice(0, 20);
    const active = await this.activeProducts(org.id);
    const activeById = new Map(active.map((p) => [String(p.id), p]));
    const seeds = parsed.filter((id) => activeById.has(id));
    if (seeds.length === 0) return { products: [] as any[] };

    const { items } = await this.soldOrderItems(org.id);
    const ranked = rankBoughtTogetherForSeeds(
      items.map((i) => ({ orderId: String(i.orderId), productId: i.productId ?? null, isGift: !!i.isGift })),
      seeds,
      new Set(activeById.keys()),
      8,
    );
    const products: any[] = [];
    for (const r of ranked) {
      const p = activeById.get(r.productId);
      if (!p) continue;
      const variants = await this.variantsOf(p.id);
      if (stockStateOf(this.effectiveStock(p, variants), p.lowStockThreshold) === "out_of_stock") continue;
      products.push(this.serializeProduct(p, variants, undefined, {
        locale: (setting as any)?.locale ?? null,
      }));
    }
    return { products };
  }

  // ================= GB7: flash sales (public read) =================

  /**
   * GB7: parsed live flash sales of the org — ACTIVE promotions
   * of type "flash", in-window, with a defensively-parsed config
   * (percentOff must be an int in 1..90, else the row is
   * skipped). NOTE: a flash sale with a null endsAt has no
   * countdown — it still applies inside the ONE evaluator
   * (PromotionsService.evaluateCheckout), but it is EXCLUDED
   * here because every payload built from this list is a
   * countdown payload (product flashSale + /flash-sales) and
   * there is no honest endsAt to count down to. Category targets
   * resolve through ONE product.findMany over ACTIVE products.
   * Failure-isolated: any problem reads as "no flash sales".
   */
  private async flashSaleEntries(orgId: string): Promise<
    Array<{
      promotionId: string;
      name: string;
      percentOff: number;
      startsAt: Date | null;
      endsAt: string;
      productIds: Set<string>;
    }>
  > {
    try {
      const table = this.t("promotion");
      if (!table?.findMany) return [];
      const rows: any[] =
        (await table
          .findMany({
            where: { organizationId: orgId, type: "flash", active: true },
            orderBy: { priority: "desc" },
          })
          .catch(() => [])) ?? [];
      const now = new Date();
      const parsed: Array<{
        row: any;
        startsAt: Date | null;
        endsAt: Date;
        percentOff: number;
        productIds: Set<string>;
        categoryIds: string[];
      }> = [];
      for (const row of rows) {
        const startsAt = row.startsAt ? new Date(row.startsAt) : null;
        if (startsAt && startsAt.getTime() > now.getTime()) continue;
        const endsAt = row.endsAt ? new Date(row.endsAt) : null;
        if (!endsAt || Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= now.getTime()) continue;
        let cfg: any = row.config ?? {};
        if (typeof cfg === "string") {
          try {
            cfg = JSON.parse(cfg);
          } catch {
            continue;
          }
        }
        const percentOff = Number(cfg?.percentOff);
        if (!Number.isInteger(percentOff) || percentOff < 1 || percentOff > 90) continue;
        parsed.push({
          row,
          startsAt,
          endsAt,
          percentOff,
          productIds: new Set<string>(
            Array.isArray(cfg.productIds) ? cfg.productIds.map((x: any) => String(x)) : [],
          ),
          categoryIds: Array.isArray(cfg.categoryIds) ? cfg.categoryIds.map((x: any) => String(x)) : [],
        });
      }
      if (parsed.length === 0) return [];
      const allCategoryIds = [...new Set(parsed.flatMap((p) => p.categoryIds))];
      if (allCategoryIds.length > 0) {
        const catProducts: any[] =
          (await this.t("product")
            .findMany({
              where: { organizationId: orgId, status: "ACTIVE", categoryId: { in: allCategoryIds } },
            })
            .catch(() => [])) ?? [];
        for (const p of parsed) {
          if (p.categoryIds.length === 0) continue;
          const wanted = new Set(p.categoryIds);
          for (const prod of catProducts) {
            if (prod.categoryId && wanted.has(String(prod.categoryId))) {
              p.productIds.add(String(prod.id));
            }
          }
        }
      }
      return parsed.map((p) => ({
        promotionId: String(p.row.id),
        name: String(p.row.name ?? ""),
        percentOff: p.percentOff,
        startsAt: p.startsAt,
        endsAt: p.endsAt.toISOString(),
        productIds: p.productIds,
      }));
    } catch {
      return [];
    }
  }

  /**
   * GB7: productId → its live flash sale (the highest-priority
   * sale wins per product; entries arrive priority-desc).
   * Failure-isolated → empty Map.
   */
  private async activeFlashMap(
    orgId: string,
  ): Promise<Map<string, { promotionId: string; name: string; percentOff: number; endsAt: string }>> {
    const map = new Map<
      string,
      { promotionId: string; name: string; percentOff: number; endsAt: string }
    >();
    try {
      const entries = await this.flashSaleEntries(orgId);
      for (const e of entries) {
        for (const pid of e.productIds) {
          if (!map.has(pid)) {
            map.set(pid, {
              promotionId: e.promotionId,
              name: e.name,
              percentOff: e.percentOff,
              endsAt: e.endsAt,
            });
          }
        }
      }
    } catch {
      return new Map();
    }
    return map;
  }

  /**
   * GB7: public flash-sales payload for the shop countdown
   * surfaces. salePriceMinor is DISPLAY ONLY (the real discount
   * is applied by the ONE evaluator at quote/checkout):
   * price − floor(price × percentOff / 100), BigInt-exact.
   * Failure-isolated: an unexpected error answers an empty list
   * rather than breaking the shop.
   */
  async publicFlashSales(orgSlug: string) {
    const { org, setting } = await this.requireEnabledShop(orgSlug);
    const serverNow = new Date().toISOString();
    try {
      const entries = await this.flashSaleEntries(org.id);
      if (entries.length === 0) return { serverNow, sales: [] };
      const active = await this.activeProducts(org.id);
      const byId = new Map(active.map((p) => [String(p.id), p]));
      const sales: any[] = [];
      for (const e of entries) {
        const products: any[] = [];
        for (const pid of e.productIds) {
          const row = byId.get(pid);
          if (!row) continue;
          const serialized = this.serializeProduct(row, await this.variantsOf(row.id), undefined, {
            // AB6 (AX13): shop-locale display names/descriptions.
            locale: (setting as any)?.locale ?? null,
          });
          let price = 0n;
          try {
            price = BigInt(row.priceMinor ?? 0);
          } catch {
            price = 0n;
          }
          const salePriceMinor = (price - (price * BigInt(e.percentOff)) / 100n).toString();
          products.push({ ...serialized, salePriceMinor });
        }
        if (products.length === 0) continue;
        sales.push({
          promotionId: e.promotionId,
          name: e.name,
          percentOff: e.percentOff,
          startsAt: e.startsAt ? e.startsAt.toISOString() : null,
          endsAt: e.endsAt,
          products,
        });
      }
      return { serverNow, sales };
    } catch (err) {
      this.logger.warn(`publicFlashSales failed for org ${org.id}: ${errMsg(err)}`);
      return { serverNow, sales: [] };
    }
  }

  /**
   * NF14 (FB5): public offers payload — the shop's ACTIVE
   * StoreDiscount offers that a storefront may surface (in
   * window, usage limit not exhausted). Public-safe fields only
   * (no scope internals, no usedCount). `appOnly` rides along so
   * the storefront can apply the NF14 display rule: app-only
   * offers are shown only inside the installed app (standalone
   * display mode). This payload is DISPLAY data — checkout
   * redemption never consults it, and an appOnly code redeems
   * normally wherever it is entered. Failure-isolated like
   * publicFlashSales: an unexpected error answers an empty list
   * rather than breaking the shop.
   */
  async publicOffers(orgSlug: string) {
    const { org } = await this.requireEnabledShop(orgSlug);
    try {
      const table = this.t("storeDiscount");
      if (!table?.findMany) return { offers: [] as any[] };
      const now = new Date();
      const rows = (await table.findMany({
        where: { organizationId: org.id, active: true },
        orderBy: { createdAt: "desc" },
      })) ?? [];
      const offers = rows
        .filter((r: any) => {
          if (r.startsAt && new Date(r.startsAt) > now) return false;
          if (r.endsAt && new Date(r.endsAt) <= now) return false;
          if (r.usageLimit != null && (r.usedCount ?? 0) >= r.usageLimit) return false;
          return true;
        })
        .map((r: any) => ({
          id: r.id,
          code: r.code,
          kind: r.kind,
          value: r.value,
          minOrderMinor: r.minOrderMinor == null ? null : String(r.minOrderMinor),
          endsAt: r.endsAt ? new Date(r.endsAt).toISOString() : null,
          // NF14: legacy rows predate the column — absent = false.
          appOnly: r.appOnly ?? false,
        }));
      return { offers };
    } catch (err) {
      this.logger.warn(`publicOffers failed for org ${org.id}: ${errMsg(err)}`);
      return { offers: [] as any[] };
    }
  }

  // ================= Public: cart =================

  async createCart(orgSlug: string) {
    const { org } = await this.requireEnabledShop(orgSlug);
    const token = `${randomUUID()}.${randomBytes(32).toString("hex")}`;
    const cart = await this.t("storeCart").create({
      data: { organizationId: org.id, token, status: "open" },
    });
    return { cartToken: token, cart: await this.serializeCart(cart) };
  }

  /** Cart lookup is org-scoped: a token from another org is a 404 here. */
  private async requireCart(orgId: string, token: string | undefined): Promise<any> {
    if (!token?.trim()) throw new NotFoundException("কার্ট পাওয়া যায়নি");
    const cart = await this.t("storeCart").findFirst({
      where: { organizationId: orgId, token: token.trim() },
    });
    if (!cart) throw new NotFoundException("কার্ট পাওয়া যায়নি");
    return cart;
  }

  private requireOpenCart(cart: any) {
    if (cart.status !== "open") {
      throw new BadRequestException("এই কার্টটি ইতিমধ্যে অর্ডারে রূপান্তরিত হয়েছে");
    }
  }

  private async cartItems(cartId: string): Promise<any[]> {
    const rows = await this.t("storeCartItem").findMany({
      where: { cartId },
      orderBy: { createdAt: "asc" },
    });
    return rows ?? [];
  }

  /** EC29: bundle lines of a cart (separate table — see schema).
   * Failure-isolated: a missing table in a partial deployment
   * reads as no bundle lines. */
  private async cartBundleRows(cartId: string): Promise<any[]> {
    try {
      const table = this.t("storeCartBundle");
      if (!table?.findMany) return [];
      const rows = await table
        .findMany({ where: { cartId }, orderBy: { createdAt: "asc" } })
        .catch(() => []);
      return rows ?? [];
    } catch {
      return [];
    }
  }

  private async serializeCart(cart: any) {
    // AB6 (AX13): the org's shop locale, loaded ONCE per call
    // (failure-isolated ⇒ null ⇒ primary product names).
    let cartLocale: string | null = null;
    try {
      const setting = await this.t("storefrontSetting")
        .findFirst({ where: { organizationId: cart.organizationId } })
        .catch(() => null);
      cartLocale = setting?.locale ?? null;
    } catch { cartLocale = null; }
    const items = await this.cartItems(cart.id);
    const out = [];
    for (const item of items) {
      const product = await this.t("product")
        .findFirst({ where: { id: item.productId } })
        .catch(() => null);
      const variant = item.variantId
        ? await this.t("productVariant").findFirst({ where: { id: item.variantId } }).catch(() => null)
        : null;
      const unit = variant?.priceMinor != null ? BigInt(variant.priceMinor) : BigInt(product?.priceMinor ?? 0);
      out.push({
        id: item.id,
        productId: item.productId,
        variantId: item.variantId ?? null,
        productName: product ? this.displayNameOf(product, cartLocale) : null,
        variantName: variant?.name ?? null,
        imageUrl: product?.imageUrl ?? null,
        quantity: item.quantity,
        includeBump: !!item.includeBump,
        // AB2 (AX3): the gift-card face value + recipient chosen
        // for this line (null on ordinary lines).
        giftCardAmountMinor: item.giftCardAmountMinor != null ? String(item.giftCardAmountMinor) : null,
        giftCardRecipient: item.giftCardRecipient ?? null,
        bump:
          item.includeBump && product?.bumpPriceMinor != null && product?.bumpTitle
            ? { title: product.bumpTitle, priceMinor: String(product.bumpPriceMinor) }
            : null,
        unitPriceMinor: unit.toString(),
        lineTotalMinor: (unit * BigInt(item.quantity)).toString(),
      });
    }
    // EC29: bundle lines. A bundle that vanished (deleted, or
    // somehow pointing at another org) serializes like a vanished
    // product line: name null + "0" prices; its stored components
    // are still listed when they resolve.
    const bundleRows = await this.cartBundleRows(cart.id);
    const bundleItems: any[] = [];
    for (const row of bundleRows) {
      const bundleTable = this.t("bundle");
      const bundle = bundleTable?.findFirst
        ? await bundleTable.findFirst({ where: { id: row.bundleId } }).catch(() => null)
        : null;
      const live = bundle && bundle.organizationId === cart.organizationId ? bundle : null;
      let components: any[] = [];
      // AB5 (AX8): the row's stored picks, normalized-or-null.
      const storedPicks: any[] | null =
        Array.isArray(row.picks) && row.picks.length > 0 ? row.picks : null;
      if (live && this.bundles) {
        // Serialization must NEVER throw: stored picks that no
        // longer validate (a pick went inactive / out of pool)
        // degrade to fixed-only components — the QUOTE path is
        // the strict one and refuses there.
        let picksForSerialize: any[] | null = storedPicks;
        if (picksForSerialize && typeof (this.bundles as any).validatePicks === "function") {
          picksForSerialize = await (this.bundles as any)
            .validatePicks(cart.organizationId, live, picksForSerialize)
            .catch(() => null);
        }
        const resolver: any = (this.bundles as any).resolveComponentsWithPicks ?? this.bundles.resolveComponents;
        const comps = await resolver
          .call(this.bundles, cart.organizationId, live, picksForSerialize)
          .catch(() => []);
        components = comps.map((c: any) => ({
          productId: c.productId,
          name: c.name,
          variantSku: c.variantSku,
          qty: c.qty,
          // AB5 (AX8): the slot label a pick component came
          // through (null on fixed components).
          viaSlot: c.slotLabel ?? null,
        }));
      } else if (live) {
        const stored: any[] = Array.isArray(live.items) ? live.items : [];
        components = stored.map((i: any) => ({
          productId: i.productId,
          name: null,
          variantSku: i.variantSku ?? null,
          qty: Number(i.qty ?? 0),
          viaSlot: null,
        }));
      }
      const price = live ? BigInt(live.bundlePriceMinor ?? 0) : 0n;
      bundleItems.push({
        id: row.id,
        bundleId: row.bundleId,
        name: live?.name ?? null,
        imageUrl: live?.imageUrl ?? null,
        quantity: row.quantity,
        bundlePriceMinor: price.toString(),
        lineTotalMinor: (price * BigInt(row.quantity)).toString(),
        components,
        // AB5 (AX8): the stored normalized picks (or null).
        picks: storedPicks,
      });
    }
    return {
      id: cart.id,
      status: cart.status,
      email: cart.email ?? null,
      phone: cart.phone ?? null,
      items: out,
      bundleItems,
      updatedAt: cart.updatedAt instanceof Date ? cart.updatedAt.toISOString() : cart.updatedAt,
    };
  }

  /** EC29: set one bundle line on the cart. quantity 0 removes. */
  async patchCartBundle(orgSlug: string, token: string | undefined, dto: PatchCartBundleDto) {
    const { org } = await this.requireEnabledShop(orgSlug);
    const cart = await this.requireCart(org.id, token);
    this.requireOpenCart(cart);

    const bundle = await this.t("bundle").findFirst({
      where: { id: dto.bundleId, organizationId: org.id },
    });
    if (!bundle) throw new NotFoundException("বান্ডলটি পাওয়া যায়নি");
    if (dto.quantity > 0 && bundle.active === false) {
      throw new BadRequestException("বান্ডলটি এখন পাওয়া যাচ্ছে না");
    }

    // AB5 (AX8): pick validation on set. When the bundle has
    // slots OR picks were provided, validatePicks decides
    // (slotted ⇒ picks required + exact; slotless + picks ⇒
    // refusal). A bundle WITHOUT slots stores picks = null
    // exactly as today — the picks field is not touched on
    // that path, keeping pre-AB5 carts byte-identical.
    let slots: any[] = [];
    let normalizedPicks: any[] | null = null;
    if (dto.quantity > 0) {
      if ((dto as any).picks !== undefined && !this.bundles) {
        throw new BadRequestException("বান্ডল সুবিধা এই deployment-এ নেই");
      }
      if (this.bundles && typeof (this.bundles as any).loadSlots === "function") {
        slots = await (this.bundles as any)
          .loadSlots(org.id, bundle)
          .catch(() => []);
      }
      if (this.bundles && (slots.length > 0 || (dto as any).picks !== undefined)) {
        normalizedPicks = await this.bundles.validatePicks(org.id, bundle, (dto as any).picks);
      }
    }

    const table = this.t("storeCartBundle");
    const existing = await table
      .findFirst({ where: { cartId: cart.id, bundleId: bundle.id } })
      .catch(() => null);
    if (dto.quantity === 0) {
      if (existing) await table.delete({ where: { id: existing.id } });
    } else if (existing) {
      const data: Record<string, any> = { quantity: dto.quantity };
      if (slots.length > 0) data.picks = normalizedPicks;
      else if (existing.picks != null) data.picks = null;
      await table.update({ where: { id: existing.id }, data });
    } else {
      const data: Record<string, any> = {
        cartId: cart.id, bundleId: bundle.id, quantity: dto.quantity,
      };
      if (slots.length > 0) data.picks = normalizedPicks;
      await table.create({ data });
    }
    const fresh = await this.t("storeCart").update({
      where: { id: cart.id },
      data: { updatedAt: new Date() },
    });
    // GB2 (GC7): a bundle mutation does not change product lines,
    // but it IS cart activity — the sync refreshes reservation
    // expiry (sliding window) with the current lines.
    await this.syncReservations(org.id, cart.id);
    return { cart: await this.serializeCart(fresh ?? cart) };
  }

  async getCart(orgSlug: string, token: string | undefined) {
    const { org } = await this.requireEnabledShop(orgSlug);
    const cart = await this.requireCart(org.id, token);
    return { cart: await this.serializeCart(cart) };
  }

  /** Tracked-stock guard: variant stock wins when a variant is chosen.
   * EC24a: a preorder-enabled product bypasses this guard entirely
   * (it may be ordered at zero/negative stock; its lines never
   * decrement stock).
   * GB2 (GC7): when the inventory service is wired and the org is
   * known, the guard becomes AVAILABILITY-aware through the ONE
   * InventoryService.checkAvailability (allowBackorder setting +
   * other carts' active reservations; the caller's own cart is
   * excluded via excludeSessionRef). The refusal message keeps
   * its shape and cites the AVAILABLE count — with no
   * reservations and backorder off that number equals on-hand,
   * so the message is unchanged from before GB2. Without the
   * inventory service (older spec constructions) the legacy
   * on-hand check runs byte-identically. */
  private async assertStock(
    product: any,
    variant: any | null,
    quantity: number,
    orgId?: string,
    excludeSessionRef?: string,
  ) {
    if (product?.preorderEnabled) return;
    // AB2 (AX3): a gift-card product is minted value, not stock —
    // it bypasses the stock guard entirely (like preorder).
    if (product?.isGiftCard) return;
    const stock = variant ? variant.stockQuantity : product.stockQuantity;
    if (stock === null || stock === undefined) return;
    if (this.inventory && orgId) {
      const verdict = await this.inventory.checkAvailability(orgId, product, variant, quantity, {
        excludeSessionRef,
      });
      if (!verdict.ok) {
        throw new BadRequestException(
          `দুঃখিত, "${product.name}"-এর স্টকে মাত্র ${Math.max(0, verdict.available)}টি আছে — এর বেশি অর্ডার করা যাবে না`,
        );
      }
      return;
    }
    if (quantity > Number(stock)) {
      throw new BadRequestException(
        `দুঃখিত, "${product.name}"-এর স্টকে মাত্র ${stock}টি আছে — এর বেশি অর্ডার করা যাবে না`,
      );
    }
  }

  /** GB2 (GC7): reconcile this cart's stock reservations with
   * its current product lines. A no-op unless the org enabled
   * reserveMinutes (the service enforces that); bundle lines
   * reserve nothing. Failure-isolated — reservations never
   * block a cart mutation. */
  private async syncReservations(orgId: string, cartId: string) {
    if (!this.inventory?.syncCartReservations) return;
    try {
      const items = await this.cartItems(cartId).catch(() => []);
      await this.inventory.syncCartReservations(
        orgId,
        cartId,
        (items ?? []).map((i: any) => ({
          productId: i.productId,
          variantId: i.variantId ?? null,
          quantity: Number(i.quantity) || 0,
        })),
      );
    } catch { /* failure-isolated by design */ }
  }

  async patchCartLine(orgSlug: string, token: string | undefined, dto: PatchCartLineDto) {
    const { org } = await this.requireEnabledShop(orgSlug);
    const cart = await this.requireCart(org.id, token);
    this.requireOpenCart(cart);

    const product = await this.t("product").findFirst({
      where: { id: dto.productId, organizationId: org.id, status: "ACTIVE" },
    });
    if (!product) throw new NotFoundException("পণ্যটি পাওয়া যায়নি বা সক্রিয় নয়");

    let variant: any = null;
    if (dto.variantId) {
      variant = await this.t("productVariant").findFirst({
        where: { id: dto.variantId, productId: product.id },
      });
      if (!variant) throw new BadRequestException("ভ্যারিয়েন্টটি এই পণ্যের নয়");
    }

    const items = await this.cartItems(cart.id);
    // Application-level merge — SQL unique cannot enforce lines
    // whose variantId is NULL, so match (productId, variantId) here.
    const existing = items.find(
      (i) => i.productId === product.id && (i.variantId ?? null) === (dto.variantId ?? null),
    );

    // AB2 (AX3): gift-card line extras — the chosen face value
    // (decimal integer string → BigInt minor) and the recipient,
    // assembled from the DTO's flat fields with nulls dropped.
    // They persist ONLY when the DTO carries at least one of
    // them, so ordinary line patches stay byte-identical.
    const giftCardPatch: Record<string, any> = {};
    const hasGiftCardFields =
      dto.giftCardAmountMinor !== undefined ||
      dto.giftCardRecipientName !== undefined ||
      dto.giftCardRecipientEmail !== undefined ||
      dto.giftCardRecipientPhone !== undefined ||
      dto.giftCardRecipientMessage !== undefined;
    if (hasGiftCardFields) {
      if (dto.giftCardAmountMinor !== undefined) {
        const raw = String(dto.giftCardAmountMinor).trim();
        if (!/^\d+$/.test(raw)) {
          throw new BadRequestException("গিফট কার্ডের পরিমাণ সঠিক সংখ্যা হতে হবে");
        }
        giftCardPatch.giftCardAmountMinor = BigInt(raw);
      }
      const recipient: Record<string, string> = {};
      if (dto.giftCardRecipientName?.trim()) recipient.name = dto.giftCardRecipientName.trim();
      if (dto.giftCardRecipientEmail?.trim()) recipient.email = dto.giftCardRecipientEmail.trim();
      if (dto.giftCardRecipientPhone?.trim()) recipient.phone = dto.giftCardRecipientPhone.trim();
      if (dto.giftCardRecipientMessage?.trim()) recipient.message = dto.giftCardRecipientMessage.trim();
      // Merge over the existing line's recipient so a patch that
      // sets only the amount (or only one recipient field) does
      // not wipe the rest.
      const prevRecipient =
        existing?.giftCardRecipient && typeof existing.giftCardRecipient === "object"
          ? (existing.giftCardRecipient as Record<string, string>)
          : {};
      giftCardPatch.giftCardRecipient = { ...prevRecipient, ...recipient };
    }

    if (dto.quantity === 0) {
      if (existing) await this.t("storeCartItem").delete({ where: { id: existing.id } });
    } else {
      await this.assertStock(product, variant, dto.quantity, org.id, cart.id);
      if (existing) {
        await this.t("storeCartItem").update({
          where: { id: existing.id },
          data: {
            quantity: dto.quantity,
            ...(dto.includeBump !== undefined ? { includeBump: dto.includeBump } : {}),
            ...giftCardPatch,
          },
        });
      } else {
        await this.t("storeCartItem").create({
          data: {
            cartId: cart.id,
            productId: product.id,
            variantId: dto.variantId ?? null,
            quantity: dto.quantity,
            includeBump: dto.includeBump ?? false,
            ...giftCardPatch,
          },
        });
      }
    }
    // Touch the cart so abandoned-cart ageing follows real activity.
    const fresh = await this.t("storeCart").update({
      where: { id: cart.id },
      data: { updatedAt: new Date() },
    });
    // GB2 (GC7): reconcile reservations with the new cart state.
    await this.syncReservations(org.id, cart.id);
    return { cart: await this.serializeCart(fresh ?? cart) };
  }

  async setCartContact(orgSlug: string, token: string | undefined, dto: CartContactDto) {
    const { org } = await this.requireEnabledShop(orgSlug);
    const cart = await this.requireCart(org.id, token);
    this.requireOpenCart(cart);
    const email = dto.email?.trim() || undefined;
    const phone = dto.phone?.trim() || undefined;
    if (!email && !phone) {
      throw new BadRequestException("ইমেইল অথবা ফোন নম্বর — অন্তত একটি দিতে হবে");
    }
    const updated = await this.t("storeCart").update({
      where: { id: cart.id },
      data: {
        ...(email !== undefined ? { email } : {}),
        ...(phone !== undefined ? { phone } : {}),
        updatedAt: new Date(),
      },
    });
    return { cart: await this.serializeCart(updated ?? cart) };
  }

  // ================= Pricing: zones, quote, checkout =================

  /**
   * Zone matching, tier-first then position:
   *   1. district_list zones listing the district
   *   2. inside_dhaka (district === ঢাকা) / outside_dhaka (otherwise)
   *   3. all zones
   * Within a tier, zones are ordered by position asc, then createdAt.
   */
  async matchZone(orgId: string, district: string): Promise<any | null> {
    let zones: any[] = [];
    try {
      zones =
        (await this.t("shippingZone").findMany({
          where: { organizationId: orgId, active: true },
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        })) ?? [];
    } catch {
      zones = [];
    }
    const tiers: Array<(z: any) => boolean> = [
      (z) =>
        z.kind === "district_list" &&
        Array.isArray(z.districts) &&
        z.districts.map((d: any) => String(d)).includes(district),
      (z) => (district === DHAKA_DISTRICT ? z.kind === "inside_dhaka" : z.kind === "outside_dhaka"),
      (z) => z.kind === "all",
    ];
    for (const inTier of tiers) {
      const hit = zones.find(inTier);
      if (hit) return hit;
    }
    return null;
  }

  /**
   * EC30: the ONE home-delivery charge resolution, shared by the
   * storefront quote/checkout and the landing-page checkout.
   * Base = the zone's flat charge; a matching weight rate rule
   * (when the EC30 service is wired) REPLACES the base. The
   * zone's free-above threshold is judged on the DISCOUNTED
   * subtotal; when it zeroes the charge, the threshold — not the
   * rule — set the final price, so rateRuleId reports null and
   * zoneFreeShipping is true. Without the EC30 service this is
   * exactly the legacy flat + free-above behaviour.
   */
  async resolveDeliveryCharge(
    orgId: string,
    zone: any,
    ctx: { weightGrams: number | null; discountedSubtotal: bigint; allFreeShipping?: boolean },
  ): Promise<{ deliveryMinor: bigint; rateRuleId: string | null; zoneFreeShipping: boolean }> {
    // GB2 (GC6): EVERY product line in the cart is free-shipping
    // => the zone/rule delivery charge is 0. This is NOT the
    // zone free-above mechanism (zoneFreeShipping stays false —
    // the two are reported separately), and it never touches the
    // pickup fee or gift wrap, which never pass through here.
    if (ctx.allFreeShipping) {
      return { deliveryMinor: 0n, rateRuleId: null, zoneFreeShipping: false };
    }
    let base = BigInt(zone.chargeMinor ?? 0);
    let rateRuleId: string | null = null;
    if (this.deliveryPricing) {
      const rule = await this.deliveryPricing
        .matchRule(orgId, zone.id, ctx.weightGrams)
        .catch(() => null);
      if (rule) {
        base = BigInt(rule.chargeMinor ?? 0);
        rateRuleId = rule.id;
      }
    }
    const zoneFreeShipping =
      zone.freeAboveMinor != null && ctx.discountedSubtotal >= BigInt(zone.freeAboveMinor);
    if (zoneFreeShipping) {
      return { deliveryMinor: 0n, rateRuleId: null, zoneFreeShipping: true };
    }
    return { deliveryMinor: base, rateRuleId, zoneFreeShipping: false };
  }

  /**
   * The one pricing path shared by quote + checkout. Recomputes
   * everything from CURRENT product/variant rows.
   *
   * Money layout (mirrors the single-product checkout):
   *  - itemsSubtotalMinor: product lines only.
   *  - bumpMinor: accepted bumps, added into subtotalMinor BEFORE
   *    coupon validation (single checkout validates bump-included).
   *  - Coupon eligibility items are the product lines only (the bump
   *    pseudo-line is never coupon-eligible), as in single checkout.
   *  - Free-above is judged on the DISCOUNTED subtotal
   *    (subtotalMinor − discountMinor) >= freeAboveMinor.
   *  - A free_shipping coupon zeroes delivery regardless of zone.
   */
  /** EC24d: resolve the buyer customer by phone (same loose
   * normalization as order tracking). Returns null for guests /
   * unknown phones — wholesale pricing needs an IDENTIFIED
   * customer carrying the staff-set isWholesale flag. */
  private async findCustomerByPhone(orgId: string, phone: string | null | undefined): Promise<any | null> {
    if (!phone?.trim()) return null;
    try {
      const table = this.t("customer");
      if (!table?.findMany) return null;
      const normalize = (v: unknown): string => {
        let digits = String(v ?? "").replace(/\D/g, "");
        if (digits.startsWith("880") && digits.length === 13) digits = `0${digits.slice(3)}`;
        if (digits.length > 11) digits = digits.slice(-11);
        return digits;
      };
      const wanted = normalize(phone);
      if (!wanted) return null;
      const rows: any[] = (await table.findMany({ where: { organizationId: orgId } }).catch(() => [])) ?? [];
      return rows.find((c) => normalize(c.phone) === wanted) ?? null;
    } catch {
      return null;
    }
  }

  async computeQuote(
    orgId: string,
    cart: any,
    district: string,
    couponCode?: string,
    ec16?: {
      referralCode?: string | null;
      buyerPhone?: string | null;
      wholesaleCustomer?: any;
      // GB7: resolved buyer identity for evaluator rules that
      // depend on order history (first-order / repeat-buyer).
      customerId?: string | null;
      // AB1 (AX1): loyalty points the shopper asked to redeem.
      loyaltyPoints?: number | null;
      // AB2 (AX3): a gift-card code the shopper asked to redeem.
      giftCardCode?: string | null;
      // NF7 (FB3): the shopper asked to pay with store credit
      // (optionally capped at storeCreditMinor, a minor-unit
      // string). Credit belongs to the RESOLVED customer only —
      // there is no code and no way to spend anyone else's.
      useStoreCredit?: boolean | null;
      storeCreditMinor?: string | null;
    },
    opts?: { giftWrap?: boolean; deliveryMethod?: string; pickupPointId?: string; locale?: string | null },
  ) {
    const items = await this.cartItems(cart.id);
    const cartBundleRows = await this.cartBundleRows(cart.id);
    if (items.length === 0 && cartBundleRows.length === 0) {
      throw new BadRequestException("কার্ট খালি — আগে পণ্য যোগ করুন");
    }

    const lines: any[] = [];
    let itemsSubtotal = 0n;
    let bumpMinor = 0n;
    // EC24d: wholesale tier applications for this quote (only
    // when checkout identified a wholesale customer — the public
    // quote stays guest-priced, documented in commerce/ec24.ts).
    const wholesaleBreakdown: Array<{ productId: string; minQty: number; priceMinor: string }> = [];
    // AB5 (AX7) PRICE SOURCE precedence (implemented exactly,
    // here and at every other line-build site): gift-card lines
    // keep face value → an explicit price-list price REPLACES
    // catalog/variant price AND beats wholesale-tier math
    // (negotiated price is more specific than a quantity tier)
    // → wholesale tier applies only to lines with NO list price
    // → catalog price otherwise. The map is built ONCE before
    // the item loop from the resolved customer; the public
    // quote passes no customer, so it stays guest-priced —
    // exactly like wholesale. priceMapForCustomer is
    // failure-isolated (any error ⇒ null ⇒ today's behaviour).
    const priceListBreakdown: Array<{ productId: string; variantId: string | null; priceMinor: string }> = [];
    let groupPriceMap: Map<string, bigint> | null = null;
    const ax7CustomerId = (ec16 as any)?.customerId ?? (ec16 as any)?.wholesaleCustomer?.id ?? null;
    if (this.priceLists && ax7CustomerId) {
      groupPriceMap = await this.priceLists
        .priceMapForCustomer(orgId, String(ax7CustomerId))
        .catch(() => null);
    }
    // AB2 (AX3): does this cart buy gift-card value? (A gift card
    // can never be BOUGHT with a gift card — resolveForCheckout
    // refuses when this is true and a code is presented.)
    let cartHasGiftCardProduct = false;
    for (const item of items) {
      const product = await this.t("product").findFirst({
        where: { id: item.productId, organizationId: orgId, status: "ACTIVE" },
      });
      if (!product) {
        throw new BadRequestException("কার্টের একটি পণ্য আর পাওয়া যাচ্ছে না — কার্ট থেকে সরিয়ে আবার চেষ্টা করুন");
      }
      let variant: any = null;
      if (item.variantId) {
        variant = await this.t("productVariant").findFirst({
          where: { id: item.variantId, productId: product.id },
        });
        if (!variant) throw new BadRequestException(`"${product.name}"-এর ভ্যারিয়েন্টটি আর পাওয়া যাচ্ছে না`);
      }
      await this.assertStock(product, variant, item.quantity, orgId, cart.id);
      // EC24a: preorder open-unit limit (no-op for normal products).
      await assertPreorderLimit(this.prisma, orgId, product, item.quantity);
      let unit = variant?.priceMinor != null ? BigInt(variant.priceMinor) : BigInt(product.priceMinor);
      // AB2 (AX3): a gift-card line's unit price IS the card's
      // face value: the amount stored on the cart line when one
      // was chosen, else the product price — either way it must
      // be allowed by the product's giftCardConfig. The config
      // is parsed through the ONE validator; a MALFORMED stored
      // config is treated as no-config, i.e. only the product
      // price itself is allowed (never an arbitrary amount).
      if (product.isGiftCard) {
        cartHasGiftCardProduct = true;
        let cfg: GiftCardConfig | null = null;
        if (product.giftCardConfig != null) {
          try {
            cfg = validateGiftCardConfig(product.giftCardConfig);
          } catch {
            cfg = null; // malformed stored config ⇒ no-config fallback (see above)
          }
        }
        const storedAmount =
          item.giftCardAmountMinor != null ? BigInt(item.giftCardAmountMinor as any) : null;
        if (storedAmount != null) {
          const allowed = cfg
            ? isGiftCardAmountAllowed(cfg, storedAmount)
            : storedAmount === BigInt(product.priceMinor);
          if (!allowed) {
            throw new BadRequestException("গিফট কার্ডের পরিমাণটি এই পণ্যের জন্য প্রযোজ্য নয়");
          }
          unit = storedAmount;
        } else {
          const priceAllowed = cfg
            ? isGiftCardAmountAllowed(cfg, BigInt(product.priceMinor))
            : true; // no-config fallback: the product price is the face value
          if (!priceAllowed) {
            throw new BadRequestException("গিফট কার্ডের পরিমাণ পণ্যের পেজ থেকে বেছে নিন");
          }
          unit = BigInt(product.priceMinor);
        }
      }
      // AB5 (AX7): an explicit group price-list price REPLACES
      // the catalog/variant unit (precedence comment at the map
      // build above) — gift-card lines are exempt (face value).
      let listPriceApplied = false;
      if (!product.isGiftCard && groupPriceMap) {
        const listPrice = pickGroupPrice(groupPriceMap, product.id, variant?.id ?? null);
        if (listPrice != null) {
          unit = listPrice;
          listPriceApplied = true;
          priceListBreakdown.push({
            productId: product.id,
            variantId: variant?.id ?? null,
            priceMinor: listPrice.toString(),
          });
        }
      }
      // EC24d: a qualifying tier REPLACES the line's unit price
      // entirely (regular AND sale/variant price) BEFORE the
      // promotions evaluator runs — promotions apply on top.
      // AB2: gift-card lines skip the tier replacement — their
      // unit is the chosen face value, never a wholesale price.
      // AB5: the tier runs ONLY when no list price applied.
      if (ec16?.wholesaleCustomer?.isWholesale && !product.isGiftCard && !listPriceApplied) {
        const tier = selectWholesaleTier(product.wholesaleTiers, item.quantity);
        if (tier) {
          unit = BigInt(tier.priceMinor);
          wholesaleBreakdown.push({ productId: product.id, minQty: tier.minQty, priceMinor: tier.priceMinor });
        }
      }
      const lineTotal = unit * BigInt(item.quantity);
      itemsSubtotal += lineTotal;
      const hasBump = !!item.includeBump && product.bumpPriceMinor != null && !!product.bumpTitle;
      if (hasBump) bumpMinor += BigInt(product.bumpPriceMinor);
      lines.push({ item, product, variant, unitPriceMinor: unit, lineTotalMinor: lineTotal, hasBump });
    }

    // EC29: bundle expansion — BEFORE the evaluator runs, so
    // bundle components are ordinary evaluator lines (promotions
    // / coupon / referral / tax all see them). Each component
    // line is priced by allocateBundle: the line's total is the
    // EXACT allocated total × bundle quantity, so the bundle
    // contributes exactly bundlePrice × quantity to the
    // merchandise subtotal. Wholesale tiers never apply here —
    // bundle lines are not cart-item lines.
    if (cartBundleRows.length > 0) {
      const BUNDLE_GONE = "কার্টের একটি বান্ডল আর পাওয়া যাচ্ছে না — কার্ট থেকে সরিয়ে আবার চেষ্টা করুন";
      if (!this.bundles) {
        throw new BadRequestException("বান্ডল সুবিধা এই deployment-এ নেই");
      }
      for (const row of cartBundleRows) {
        const bundleQty = Number(row.quantity ?? 0);
        if (bundleQty <= 0) continue;
        const bundle = await this.t("bundle")
          .findFirst({ where: { id: row.bundleId, organizationId: orgId } })
          .catch(() => null);
        if (!bundle || bundle.active === false) throw new BadRequestException(BUNDLE_GONE);
        // AB5 (AX8): STRICT pick re-validation BEFORE expansion
        // — a pick that went inactive / out of pool refuses the
        // quote (and hence placement, which consumes this
        // quote's lines) with validatePicks' Bengali message,
        // wrapped so the refusal names the bundle. Fixed-only
        // bundles take the exact existing path. Picks then flow
        // through the same `lines` array as fixed components, so
        // they land as component OrderItems with bundleId set at
        // placement — no order-detail/packing change needed.
        let comps: any[];
        const rowPicks: any[] | null =
          Array.isArray((row as any).picks) && (row as any).picks.length > 0
            ? (row as any).picks
            : null;
        let quoteSlots: any[] = [];
        if (typeof (this.bundles as any).loadSlots === "function") {
          quoteSlots = await (this.bundles as any)
            .loadSlots(orgId, bundle)
            .catch(() => []);
        }
        if (quoteSlots.length > 0 || rowPicks) {
          let normalizedPicks: any[];
          try {
            normalizedPicks = await this.bundles.validatePicks(orgId, bundle, rowPicks);
          } catch (e) {
            if (e instanceof BadRequestException) {
              throw new BadRequestException(`বান্ডল "${bundle.name}": ${e.message}`);
            }
            throw e;
          }
          comps = await (this.bundles as any).resolveComponentsWithPicks(
            orgId, bundle, normalizedPicks,
          );
        } else {
          comps = await this.bundles.resolveComponents(orgId, bundle);
        }
        if (comps.length === 0) throw new BadRequestException(BUNDLE_GONE);
        const allocs = allocateBundle(
          BigInt(bundle.bundlePriceMinor ?? 0),
          comps.map((c: any) => ({ qty: c.qty, regularUnitMinor: c.regularUnitMinor })),
        );
        for (let ci = 0; ci < comps.length; ci++) {
          const comp = comps[ci];
          const product = comp.product;
          if (!product || product.status !== "ACTIVE") throw new BadRequestException(BUNDLE_GONE);
          if (comp.variantSku && !comp.variant) throw new BadRequestException(BUNDLE_GONE);
          const variant = comp.variant ?? null;
          await this.assertStock(product, variant, comp.qty * bundleQty, orgId, cart.id);
          await assertPreorderLimit(this.prisma, orgId, product, comp.qty * bundleQty);
          const allocatedUnit = allocs[ci].allocatedUnitMinor;
          const lineTotal = allocs[ci].allocatedTotalMinor * BigInt(bundleQty);
          itemsSubtotal += lineTotal;
          lines.push({
            item: { quantity: comp.qty * bundleQty, includeBump: false },
            product,
            variant,
            unitPriceMinor: allocatedUnit,
            lineTotalMinor: lineTotal,
            hasBump: false,
            bundleId: bundle.id,
            bundleName: bundle.name,
          });
        }
      }
    }

    const subtotal = itemsSubtotal + bumpMinor;

    let discountMinor = 0n;
    let freeShipping = false;
    let appliedDiscountId: string | null = null;
    let appliedCode: string | null = null;
    // EC16: the unified evaluation (promotions → coupon →
    // referral). `ec16Evaluation` is carried on the quote so
    // checkout can stamp the split onto the order.
    let ec16Evaluation: CheckoutEvaluation | null = null;
    // GB7: the buyer's prior-order count, computed ONCE here and
    // shared by the unified evaluator and the legacy coupon-only
    // fallback. null = identity unverifiable (no promotions
    // service, no resolved customer, or the lookup failed) —
    // history-dependent rules must then not fire.
    const gb7CustomerId = ec16?.customerId ?? null;
    let gb7PriorOrderCount: number | null = null;
    const promotionsGb7 = this.promotions as PromotionsGb7 | undefined;
    if (promotionsGb7?.priorOrderCountFor && gb7CustomerId) {
      gb7PriorOrderCount = await promotionsGb7
        .priorOrderCountFor(orgId, gb7CustomerId)
        .catch(() => null);
    }
    // AB1 (AX1): the loyalty snapshot for the SAME resolved
    // customer (null when the program is off, the shopper asked
    // for no points, or the identity is unverifiable) — the
    // evaluator prices from this snapshot only.
    let loyaltyInput: LoyaltyRedeemInput | null = null;
    if (
      this.loyalty &&
      ec16?.loyaltyPoints != null &&
      ec16.loyaltyPoints > 0 &&
      gb7CustomerId
    ) {
      const snap = await this.loyalty
        .checkoutSnapshot(orgId, gb7CustomerId)
        .catch(() => null);
      if (snap) loyaltyInput = { pointsToRedeem: ec16.loyaltyPoints, ...snap };
    }
    // AB2 (AX3): the gift-card redemption snapshot. Unlike the
    // loyalty snapshot (which degrades silently), a presented
    // code that cannot be redeemed REFUSES the quote/checkout
    // here — resolveForCheckout throws its Bengali BadRequest
    // and it propagates, exactly like an invalid coupon, BEFORE
    // any order is placed.
    let giftCardInput: { giftCardId: string; balanceMinor: bigint; codeLast4: string } | null = null;
    if (ec16?.giftCardCode?.trim()) {
      if (!this.giftCards) {
        throw new BadRequestException("গিফট কার্ড সুবিধা এই দোকানে নেই");
      }
      const snap = await this.giftCards.resolveForCheckout(orgId, ec16.giftCardCode, {
        cartHasGiftCardProduct,
      });
      giftCardInput = { giftCardId: snap.giftCardId, balanceMinor: snap.balanceMinor, codeLast4: snap.codeLast4 };
    }
    // NF7 (FB3): the store-credit snapshot for the SAME resolved
    // customer (null when the shopper did not ask, the identity
    // is unverifiable, or the derived balance is zero) — the
    // evaluator prices from this snapshot only, and the spend
    // posts against the order's own customer at placement, so
    // one customer can never spend another's credit.
    let storeCreditInput: { customerId: string; balanceMinor: bigint; requestedMinor?: bigint | null } | null = null;
    if (this.storeCredit && ec16?.useStoreCredit && gb7CustomerId) {
      const snap = await this.storeCredit
        .checkoutSnapshot(orgId, gb7CustomerId)
        .catch(() => null);
      if (snap) {
        let requestedMinor: bigint | null = null;
        const rawReq = String((ec16 as any)?.storeCreditMinor ?? "").trim();
        if (/^\d+$/.test(rawReq)) requestedMinor = BigInt(rawReq);
        storeCreditInput = { customerId: snap.customerId, balanceMinor: snap.balanceMinor, requestedMinor };
      }
    }
    if (this.promotions) {
      ec16Evaluation = await this.promotions.evaluateCheckout(orgId, {
        lines: lines.map((l): PromotionLine => ({
          productId: l.product.id,
          categoryId: l.product.categoryId ?? null,
          quantity: l.item.quantity,
          unitPriceMinor: l.unitPriceMinor,
          compareAtMinor: l.product.compareAtMinor != null ? BigInt(l.product.compareAtMinor) : null,
        })),
        bumpMinor,
        couponCode: couponCode ?? null,
        referralCode: ec16?.referralCode ?? null,
        buyerPhone: ec16?.buyerPhone ?? null,
        // GB7 contract fields on EvaluateCheckoutInput.
        customerId: gb7CustomerId,
        priorOrderCount: gb7PriorOrderCount,
        // AB1 contract field on EvaluateCheckoutInput.
        loyalty: loyaltyInput,
        // AB2 contract field on EvaluateCheckoutInput.
        giftCard: giftCardInput,
        // NF7 contract field on EvaluateCheckoutInput.
        storeCredit: storeCreditInput,
      } as Parameters<PromotionsService["evaluateCheckout"]>[1]);
      discountMinor = ec16Evaluation.totalDiscountMinor;
      freeShipping = ec16Evaluation.couponFreeShipping;
      appliedDiscountId = ec16Evaluation.appliedDiscountId;
      appliedCode = ec16Evaluation.appliedCouponCode;
    } else if (couponCode?.trim()) {
      // Legacy EC7-only path (spec harnesses without the EC16
      // service): identical math to the unified path when no
      // promotion applies.
      if (!this.discounts) throw new BadRequestException("কুপন সুবিধা এই deployment-এ নেই");
      const v = await this.discounts.validateForCheckout(orgId, couponCode, {
        subtotalMinor: subtotal,
        items: lines.map((l) => ({
          productId: l.product.id,
          categoryId: l.product.categoryId ?? null,
          totalMinor: l.lineTotalMinor,
        })),
        // GB7 contract fields on the validateForCheckout ctx.
        customerId: gb7CustomerId,
        priorOrderCount: gb7PriorOrderCount,
      } as Parameters<DiscountsService["validateForCheckout"]>[2]);
      if (!v.valid) {
        throw new BadRequestException(
          `কুপন প্রয়োগ করা যায়নি: ${DISCOUNT_REASON_MESSAGES[v.reason ?? ""] ?? v.reason}`,
        );
      }
      discountMinor = v.discountMinor;
      freeShipping = v.freeShipping;
      appliedDiscountId = v.discount?.id ?? null;
      appliedCode = couponCode.trim().toUpperCase();
    }

    const discountedSubtotal = subtotal - discountMinor;
    // EC30: cart weight from the built lines (bundle component
    // lines included — they are real shipped products; bump
    // pseudo-lines are not in `lines`). Unknown (null) when ANY
    // product lacks weightGrams — a weight is never invented.
    // GB2 (GC6): free-shipping lines are EXCLUDED from the weight
    // population entirely (their weight neither adds to the
    // total nor makes it unknown), and when EVERY line is
    // free-shipping the resolver zeroes the charge. With all
    // flags false both computations are byte-identical to EC30.
    const cartWeight = cartWeightOf(
      lines
        .filter((l) => !l.product?.freeShipping)
        .map((l) => ({ product: l.product, quantity: l.item.quantity })),
    );
    const allFreeShipping =
      lines.length > 0 && lines.every((l) => !!l.product?.freeShipping);
    let zone: any = null;
    let deliveryMinor = 0n;
    let rateRuleId: string | null = null;
    let zoneFreeShipping = false;
    let pickupPoint: {
      id: string; name: string; address: string; district: string; phone: string | null; feeMinor: string;
    } | null = null;
    const deliveryMethod = opts?.deliveryMethod === "pickup" ? "pickup" : "home";
    if (deliveryMethod === "pickup") {
      if (!this.deliveryPricing) {
        throw new BadRequestException("পিকআপ সুবিধা এই deployment-এ নেই");
      }
      const point = await this.deliveryPricing.getActivePickupPoint(orgId, opts?.pickupPointId ?? "");
      if (!point) {
        throw new BadRequestException("পিকআপ পয়েন্টটি পাওয়া যায়নি বা বন্ধ আছে — অন্য পয়েন্ট বেছে নিন");
      }
      pickupPoint = {
        id: point.id,
        name: point.name,
        address: point.address,
        district: point.district,
        phone: point.phone ?? null,
        feeMinor: String(point.feeMinor ?? 0),
      };
      // The pickup fee is the point's OWN fee, not a delivery
      // charge: zone free-above thresholds, weight rate rules and
      // free-shipping coupons therefore never zero it.
      deliveryMinor = BigInt(point.feeMinor ?? 0);
    } else {
      zone = await this.matchZone(orgId, district);
      if (!zone) {
        throw new BadRequestException(
          "এই এলাকায় ডেলিভারি সেট করা নেই — অন্য জেলা বেছে নিন অথবা দোকানে যোগাযোগ করুন",
        );
      }
      const res = await this.resolveDeliveryCharge(orgId, zone, {
        weightGrams: cartWeight.totalGrams,
        discountedSubtotal,
        allFreeShipping,
      });
      deliveryMinor = res.deliveryMinor;
      rateRuleId = res.rateRuleId;
      zoneFreeShipping = res.zoneFreeShipping;
      if (freeShipping) deliveryMinor = 0n;
    }

    // EC23: exclusive VAT grows the total; inclusive adds nothing.
    const taxMinor = ec16Evaluation?.taxMinor ?? 0n;
    const taxAddedMinor = ec16Evaluation?.taxAddedMinor ?? 0n;

    // EC29: gift-wrap fee — charged only when the buyer asked
    // for it AND the shop enabled gift wrap with a fee set. It
    // is part of totalMinor here so the displayed total always
    // equals the charged total (checkout adds it nowhere else).
    const wrapSetting = await this.getSetting(orgId);
    const giftWrapMinor =
      opts?.giftWrap && wrapSetting?.giftWrapEnabled === true && wrapSetting?.giftWrapFeeMinor != null
        ? BigInt(wrapSetting.giftWrapFeeMinor)
        : 0n;

    // EC29: gift display for quote/checkout responses (name
    // resolution only — placement happens at checkout).
    let giftDisplay: { promotionName: string; productName: string; quantity: number } | null = null;
    if (ec16Evaluation?.gift) {
      const giftProduct = await this.t("product")
        .findFirst({ where: { id: ec16Evaluation.gift.productId, organizationId: orgId } })
        .catch(() => null);
      giftDisplay = {
        promotionName: ec16Evaluation.gift.name,
        productName: giftProduct?.name ?? "",
        quantity: ec16Evaluation.gift.giftQty,
      };
    }

    const total = subtotal - discountMinor + deliveryMinor + taxAddedMinor + giftWrapMinor;
    // GB3 (GC8): the org's COD rule profile rides the quote so
    // serializeQuote can price the COD facts for THIS total
    // without a second read (failure-isolated via businessProfile).
    const codBp = await this.businessProfile(orgId).catch(() => null);
    const codProfile = codBp
      ? {
          codMaxOrderMinor: codBp.codMaxOrderMinor ?? null,
          codAdvanceRequiredAboveMinor: codBp.codAdvanceRequiredAboveMinor ?? null,
          codBlockedDistricts: codBp.codBlockedDistricts ?? null,
        }
      : null;
    // AB4 (AX5a): the SAME BusinessProfile read carries the
    // raw deposit fields on the quote — serializeQuote prices
    // the per-kind deposit amounts for THIS total from it and
    // checkout() stamps the placement's deposit due from it,
    // with no second read.
    const depositProfile = codBp
      ? {
          depositMode: codBp.depositMode ?? null,
          depositPercent: codBp.depositPercent ?? null,
          depositFixedMinor: codBp.depositFixedMinor ?? null,
          depositAppliesTo: codBp.depositAppliesTo ?? null,
          depositNote: codBp.depositNote ?? null,
        }
      : null;
    return {
      lines,
      zone,
      codProfile,
      depositProfile,
      // AB6 (AX13): the caller's shop locale, stamped for the
      // quote serializer's display-name rule.
      locale: opts?.locale ?? null,
      itemsSubtotalMinor: itemsSubtotal,
      bumpMinor,
      subtotalMinor: subtotal,
      discountMinor,
      deliveryMinor,
      giftWrapMinor,
      giftDisplay,
      taxMinor,
      taxAddedMinor,
      taxBreakdown: ec16Evaluation?.taxBreakdown ?? [],
      totalMinor: total,
      freeShippingApplied: freeShipping,
      // EC30: delivery method + pricing provenance for the order
      // stamp and the quote/checkout responses.
      deliveryMethod,
      pickupPoint,
      shippingRateRuleId: rateRuleId,
      zoneFreeShippingApplied: zoneFreeShipping,
      freeShippingZoneId: zoneFreeShipping && zone ? zone.id : null,
      // GB2 (GC6): every product line free-shipping (home
      // delivery only — a pickup fee is the point's own and is
      // never zeroed by product flags).
      productFreeShippingApplied: deliveryMethod === "home" && allFreeShipping,
      appliedDiscountId,
      appliedCode,
      ec16: ec16Evaluation,
      // EC24d: wholesale snapshot for the order stamp + response.
      wholesaleBreakdown,
      wholesaleApplied: wholesaleBreakdown.length > 0,
      // AB5 (AX7): group price-list snapshot, riding the quote
      // exactly like wholesaleBreakdown (order stamp + response).
      priceListBreakdown,
      priceListApplied: priceListBreakdown.length > 0,
      promotionDiscountMinor: ec16Evaluation?.promotionDiscountMinor ?? 0n,
      promotionsApplied: ec16Evaluation?.promotionsApplied ?? [],
      referralDiscountMinor: ec16Evaluation?.referralDiscountMinor ?? 0n,
      referralAppliedCode: ec16Evaluation?.referral?.code ?? null,
      // AB1 (AX1): the loyalty line of THIS quote/checkout
      // (null = redemption not offered for this cart).
      loyalty: loyaltyInput
        ? {
            balance: loyaltyInput.balance,
            pointsApplied: ec16Evaluation?.loyaltyPointsApplied ?? 0,
            discountMinor: ec16Evaluation?.loyaltyDiscountMinor ?? 0n,
          }
        : null,
      // AB2 (AX3): the gift-card line of THIS quote/checkout.
      // giftCardId rides the quote for checkout's post-placement
      // posting ONLY — serializeQuote strips it (internal).
      giftCard: giftCardInput
        ? {
            codeLast4: giftCardInput.codeLast4,
            balanceMinor: giftCardInput.balanceMinor,
            discountMinor: ec16Evaluation?.giftCardDiscountMinor ?? 0n,
            giftCardId: giftCardInput.giftCardId,
          }
        : null,
      // NF7 (FB3): the store-credit line of THIS quote/checkout
      // (null = credit not offered for this cart). customerId
      // rides the quote for checkout's post-placement posting
      // ONLY — serializeQuote strips it (internal).
      storeCredit: storeCreditInput
        ? {
            customerId: storeCreditInput.customerId,
            balanceMinor: storeCreditInput.balanceMinor,
            discountMinor: ec16Evaluation?.storeCreditDiscountMinor ?? 0n,
          }
        : null,
    };
  }

  private serializeQuote(q: any, district: string, deliverySlots: any[] = []) {
    // GB3 (GC8): COD facts for this quote's total + structured
    // district (no address parse on the quote path).
    const codEval = evaluateCodRules(q.codProfile ?? null, {
      totalMinor: q.totalMinor ?? 0n,
      district,
      parsedDistrict: null,
      parsedConfidence: null,
    });
    // AB4 (AX5a): per-kind deposit amounts for THIS total —
    // null overall when the deposit is inactive for every kind;
    // a kind's amount is null when that kind is not covered.
    const depositAmounts = (["cod", "online", "manual"] as const).map((kind) => {
      const d = depositFor(q.depositProfile ?? null, { totalMinor: q.totalMinor ?? 0n, kind });
      return { kind, active: d.active, amountMinor: d.active ? d.amountMinor.toString() : null, note: d.note };
    });
    const deposit = depositAmounts.some((d) => d.active)
      ? {
          note: depositAmounts.find((d) => d.active)?.note ?? null,
          amounts: {
            cod: depositAmounts[0].amountMinor,
            online: depositAmounts[1].amountMinor,
            manual: depositAmounts[2].amountMinor,
          },
        }
      : null;
    return {
      // AB4 (AX5a): deposit notice for this quote (see above).
      deposit,
      district,
      codRules: {
        maxOrderMinor: q.codProfile?.codMaxOrderMinor != null ? String(q.codProfile.codMaxOrderMinor) : null,
        advanceAboveMinor:
          q.codProfile?.codAdvanceRequiredAboveMinor != null
            ? String(q.codProfile.codAdvanceRequiredAboveMinor)
            : null,
        unavailableForTotal: codEval.refused !== null,
        advanceRequiredForTotal: codEval.advanceRequired,
      },
      deliverySlots: deliverySlots.map((s) => ({
        id: s.id, label: s.label, startTime: s.startTime, endTime: s.endTime,
      })),
      zone: q.zone
        ? {
            id: q.zone.id,
            name: q.zone.name,
            kind: q.zone.kind,
            deliveryDays: q.zone.deliveryDays ?? null,
          }
        : null,
      items: q.lines.map((l: any) => ({
        productId: l.product.id,
        variantId: l.variant?.id ?? null,
        name: this.displayNameOf(l.product, (q as any).locale ?? null),
        variantName: l.variant?.name ?? null,
        quantity: l.item.quantity,
        unitPriceMinor: l.unitPriceMinor.toString(),
        lineTotalMinor: l.lineTotalMinor.toString(),
        includeBump: !!l.item.includeBump,
        bumpMinor: l.hasBump ? String(l.product.bumpPriceMinor) : "0",
        // EC29: bundle markers (null on ordinary lines).
        bundleId: l.bundleId ?? null,
        bundleName: l.bundleName ?? null,
      })),
      // EC29: gift-wrap fee actually priced into totalMinor.
      giftWrapMinor: (q.giftWrapMinor ?? 0n).toString(),
      gift: q.giftDisplay ?? null,
      itemsSubtotalMinor: q.itemsSubtotalMinor.toString(),
      bumpMinor: q.bumpMinor.toString(),
      subtotalMinor: q.subtotalMinor.toString(),
      discountMinor: q.discountMinor.toString(),
      deliveryMinor: q.deliveryMinor.toString(),
      // EC23: VAT contained in / added to the total + per-rate split.
      taxMinor: (q.taxMinor ?? 0n).toString(),
      taxAddedMinor: (q.taxAddedMinor ?? 0n).toString(),
      taxBreakdown: (q.taxBreakdown ?? []).map((b: any) => ({
        rateBps: b.rateBps,
        taxableMinor: b.taxableMinor.toString(),
        taxMinor: b.taxMinor.toString(),
      })),
      totalMinor: q.totalMinor.toString(),
      codDueMinor: q.totalMinor.toString(),
      // EC30: delivery method + pickup point + pricing provenance
      // (additive; older quotes constructed without them read as
      // a plain home delivery with no rule applied).
      deliveryMethod: q.deliveryMethod ?? "home",
      pickupPoint: q.pickupPoint ?? null,
      shippingRateRuleId: q.shippingRateRuleId ?? null,
      zoneFreeShippingApplied: q.zoneFreeShippingApplied === true,
      freeShippingZoneId: q.freeShippingZoneId ?? null,
      // GB2 (GC6): product free-shipping provenance.
      productFreeShippingApplied: q.productFreeShippingApplied === true,
      coupon: q.appliedCode ? { code: q.appliedCode, freeShipping: q.freeShippingApplied } : null,
      // EC16: promotion + referral split of discountMinor.
      promotionDiscountMinor: (q.promotionDiscountMinor ?? 0n).toString(),
      promotionsApplied: (q.promotionsApplied ?? []).map((p: any) => ({
        promotionId: p.promotionId,
        name: p.name,
        type: p.type,
        amountMinor: p.amountMinor.toString(),
      })),
      referralDiscountMinor: (q.referralDiscountMinor ?? 0n).toString(),
      referral: q.referralAppliedCode ? { code: q.referralAppliedCode } : null,
      // AB1 (AX1): loyalty redemption priced into this quote.
      loyalty: q.loyalty
        ? {
            balance: q.loyalty.balance,
            pointsApplied: q.loyalty.pointsApplied,
            discountMinor: (q.loyalty.discountMinor ?? 0n).toString(),
          }
        : null,
      // AB2 (AX3): gift-card redemption priced into this quote
      // (codeLast4 + balances only — never the full code, and
      // never the internal giftCardId).
      giftCard: q.giftCard
        ? {
            codeLast4: q.giftCard.codeLast4,
            balanceMinor: (q.giftCard.balanceMinor ?? 0n).toString(),
            discountMinor: (q.giftCard.discountMinor ?? 0n).toString(),
          }
        : null,
      // NF7 (FB3): store-credit redemption priced into this
      // quote (balance + applied amount only — never another
      // customer's data; the internal customerId is stripped).
      storeCredit: q.storeCredit
        ? {
            balanceMinor: (q.storeCredit.balanceMinor ?? 0n).toString(),
            discountMinor: (q.storeCredit.discountMinor ?? 0n).toString(),
          }
        : null,
      currency: "BDT",
    };
  }

  async quote(orgSlug: string, dto: QuoteDto) {
    const { org, setting } = await this.requireEnabledShop(orgSlug);
    const cart = await this.requireCart(org.id, dto.cartToken);
    this.requireOpenCart(cart);
    // GB7: a quote carries no session, so the buyer identity is
    // resolved from the presented phone (only when a phone was
    // presented; failure ⇒ unverifiable ⇒ null, never an error).
    let quoteCustomerId: string | null = null;
    const promotionsGb7 = this.promotions as PromotionsGb7 | undefined;
    if (dto.buyerPhone && promotionsGb7?.customerIdForPhone) {
      quoteCustomerId = await promotionsGb7
        .customerIdForPhone(org.id, dto.buyerPhone)
        .catch(() => null);
    }
    const q = await this.computeQuote(org.id, cart, dto.district.trim(), dto.couponCode, {
      referralCode: dto.referralCode ?? null,
      buyerPhone: dto.buyerPhone ?? null,
      customerId: quoteCustomerId,
      loyaltyPoints: dto.loyaltyPoints ?? null,
      giftCardCode: dto.giftCardCode ?? null,
      useStoreCredit: dto.useStoreCredit ?? null,
      storeCreditMinor: dto.storeCreditMinor ?? null,
    }, { giftWrap: dto.giftWrap, deliveryMethod: dto.deliveryMethod, pickupPointId: dto.pickupPointId, locale: setting?.locale ?? null });
    const deliverySlots = await this.slotsForDistrict(org.id, dto.district.trim()).catch(() => []);
    return this.serializeQuote(q, dto.district.trim(), deliverySlots);
  }

  /**
   * EC25: resolve a storefront session token to its customer,
   * inline (validity rules identical to
   * ShopAccountService.resolveSession). Any problem — unknown
   * token, wrong org, revoked, expired, merged customer, or a
   * missing table in a partial deployment — returns null: an
   * invalid session is IGNORED at checkout, never an error.
   */
  private async resolveSessionCustomer(orgId: string, token: string | null | undefined): Promise<any | null> {
    if (!token?.trim()) return null;
    try {
      const table = this.t("shopSession");
      if (!table?.findFirst) return null;
      const session = await table
        .findFirst({ where: { tokenHash: hashShopSecret(token.trim()) } })
        .catch(() => null);
      if (!session) return null;
      if (session.organizationId !== orgId) return null;
      if (session.revokedAt) return null;
      if (new Date(session.expiresAt).getTime() <= Date.now()) return null;
      const customer = await this.t("customer")
        .findFirst({ where: { id: session.customerId, organizationId: orgId } })
        .catch(() => null);
      if (!customer || customer.mergedIntoId) return null;
      return customer;
    } catch {
      return null;
    }
  }

  async checkout(orgSlug: string, dto: CheckoutDto, sessionToken?: string | null, ctx?: { ip?: string | null }) {
    const { org, setting } = await this.requireEnabledShop(orgSlug);
    // GB3 (GC8): idempotency replay — a retry with a known key
    // returns the FIRST placement's response, before any cart
    // work (the cart is already converted by then).
    if (dto.idempotencyKey && this.idempotency) {
      const replay = await this.idempotency.findReplay(org.id, dto.idempotencyKey);
      if (replay) return replay;
    }
    // GB3 (GC8): terms consent — required shops refuse without
    // an explicit acceptance; the ref pins the consented version.
    const termsPage = await this.loadTermsPage(org.id);
    const terms = termsRefFor(setting, termsPage);
    const termsRef = terms.ref;
    if (setting.requireTermsConsent === true && dto.termsAccepted !== true) {
      throw new BadRequestException("অর্ডার সম্পূর্ণ করতে শর্তাবলি পড়ে সম্মতি দেওয়া বাধ্যতামূলক");
    }
    // GC10: an online selection is re-validated against the
    // REAL offered options before any order work (400 when the
    // pair is not offered — the client is never trusted).
    const onlinePayment = await this.resolveOnlineSelection(org.id, dto);
    // EC25: a valid session whose customer phone matches the
    // checkout phone pins the order to that customer. A stale or
    // mismatched token is ignored — the guest flow continues.
    let sessionCustomer: any = null;
    if (sessionToken) {
      const resolved = await this.resolveSessionCustomer(org.id, sessionToken);
      if (resolved && phoneKeyLoose(resolved.phone) === phoneKeyLoose(dto.phone)) {
        sessionCustomer = resolved;
      }
    }
    const cart = await this.requireCart(org.id, dto.cartToken);
    this.requireOpenCart(cart);
    // GB3 (GC9): the checkout gate (blocked / trusted / open-
    // order policy / waiting / daily limit / CAPTCHA) — the
    // guard throws the generic refusal + writes the attempt log.
    // AB8 (AX27): the normalized device hash (invalid/absent
    // = null = no gate signal, no stamp — never a failure).
    const deviceHash = normalizeDeviceHash((dto as any).deviceHash);
    if (this.checkoutGuard) {
      await this.checkoutGuard.evaluateGate(org.id, "shop", {
        phone: dto.phone,
        email: cart.email ?? null,
        ip: ctx?.ip ?? null,
        deviceHash,
        captchaToken: dto.captchaToken ?? null,
        surface: "checkout",
      });
    }
    if (!this.integrations) {
      throw new BadRequestException("অর্ডার নেওয়ার সুবিধা এই deployment-এ নেই");
    }
    const district = dto.district.trim();
    // EC24d: the buyer is identified by the checkout phone (the
    // same phone upsertOrder will match/create the customer by).
    // Only a staff-flagged wholesale customer gets tier pricing.
    const buyerCustomer = await this.findCustomerByPhone(org.id, dto.phone);
    const q = await this.computeQuote(org.id, cart, district, dto.couponCode, {
      referralCode: dto.referralCode ?? null,
      buyerPhone: dto.phone,
      wholesaleCustomer: buyerCustomer,
      // GB7: the session-pinned customer wins; else the customer
      // the checkout phone resolved to (both resolved above,
      // before computeQuote runs).
      customerId: sessionCustomer?.id ?? buyerCustomer?.id ?? null,
      loyaltyPoints: dto.loyaltyPoints ?? null,
      giftCardCode: dto.giftCardCode ?? null,
      useStoreCredit: dto.useStoreCredit ?? null,
      storeCreditMinor: dto.storeCreditMinor ?? null,
    }, { giftWrap: dto.giftWrap, deliveryMethod: dto.deliveryMethod, pickupPointId: dto.pickupPointId, locale: setting?.locale ?? null });

    // AB4 (AX5b): custom checkout-field answers — validated
    // against the org's ACTIVE defs for the shop surface BEFORE
    // any order is written; a refusal writes nothing. The
    // validated map (never the raw payload) is stamped below.
    const fieldDefs = await this.loadCheckoutFieldDefs(org.id);
    const fieldValidation = validateFieldAnswers(fieldDefs, "shop", dto.fieldAnswers);
    if (!fieldValidation.ok) throw new BadRequestException(fieldValidation.error);
    const checkoutFieldValues = fieldValidation.values;

    // EC18: a chosen slot is validated (scope / date / capacity)
    // BEFORE any order is written — a refusal means no order.
    let chosenSlot: any = null;
    if (dto.deliverySlotId || dto.deliveryDate) {
      if (!dto.deliverySlotId || !dto.deliveryDate) {
        throw new BadRequestException("স্লট বেছে নিলে তারিখও দিতে হবে");
      }
      chosenSlot = await this.validateSlotChoice(org.id, dto.deliverySlotId, dto.deliveryDate, district);
    }

    // GC10: an online order is non-COD with the provider as
    // its paymentMethod; COD rules + the manual-advance note
    // are skipped (the isCod guards below do this naturally).
    const paymentMethod = onlinePayment ? onlinePayment.provider : (dto.paymentMethod ?? "cod");
    const isCod = onlinePayment ? false : paymentMethod === "cod";
    // AB4 (AX5a): the deposit slice for THIS placement's kind
    // (online gateway / COD / manual claim), priced from the
    // quote's deposit profile. NOTICE + stamp only here — the
    // collection itself runs through the payment initiation
    // paths (deposit purpose) after placement.
    const depositKind = onlinePayment ? "online" : isCod ? "cod" : "manual";
    const deposit = depositFor(q.depositProfile ?? null, { totalMinor: q.totalMinor, kind: depositKind });
    // GB3 (GC8): COD trust rules — the quote already loaded the
    // profile (q.codProfile); the address parse supplies the
    // district candidate when the structured district is not
    // itself blocked. A refusal means no order is written.
    let codAdvanceRequired = false;
    if (isCod) {
      const parsed = parseBdAddress(dto.address);
      const codEval = evaluateCodRules(q.codProfile ?? null, {
        totalMinor: q.totalMinor,
        district,
        parsedDistrict: parsed.district,
        parsedConfidence: parsed.confidence,
      });
      if (codEval.refused) {
        throw new BadRequestException("দুঃখিত, এই অর্ডারের জন্য ক্যাশ অন ডেলিভারি প্রযোজ্য নয়");
      }
      codAdvanceRequired = codEval.advanceRequired;
    }
    const advanceClaim = dto.advanceNote?.trim() || dto.paymentNote?.trim() || "";
    const noteParts: string[] = [];
    if (dto.note?.trim()) noteParts.push(dto.note.trim());
    if (onlinePayment) {
      // GC10: pending-verification marker — NEVER a paid claim;
      // only a verified IPN may mark this order paid.
      noteParts.push(`[অনলাইন পেমেন্ট (${onlinePayment.provider}) — যাচাই বাকি]`);
    } else if (!isCod && advanceClaim) {
      // Recorded verbatim as an UNVERIFIED claim — never as payment.
      noteParts.push(`[অযাচাইকৃত advance দাবি — ${paymentMethod}] ${advanceClaim}`);
    } else if (!isCod) {
      noteParts.push(`[${paymentMethod} — কাস্টমার ম্যানুয়াল পেমেন্ট বেছে নিয়েছেন; পেমেন্ট যাচাই হয়নি]`);
    }
    noteParts.push(`জেলা: ${district}`);

    const items: any[] = [];
    for (const l of q.lines) {
      items.push({
        name: this.displayNameOf(l.product, setting.locale),
        sku: l.variant?.sku || l.product.sku || undefined,
        quantity: l.item.quantity,
        priceMinor: l.unitPriceMinor,
        totalMinor: l.lineTotalMinor,
        // EC24a: any order of a preorder-enabled product is a preorder line.
        isPreorder: !!l.product.preorderEnabled,
        // EC29: bundle component lines carry their bundle link
        // (ordinary lines leave these unset).
        ...(l.bundleId
          ? { productId: l.product.id, bundleId: l.bundleId, bundleName: l.bundleName ?? null }
          : {}),
        // AB2 (AX3): gift-card lines — and ONLY gift-card lines —
        // carry their productId so the placed order item is the
        // issuance claim the reconciler mints from. Every other
        // line stays exactly as before.
        ...(!l.bundleId && l.product.isGiftCard ? { productId: l.product.id } : {}),
      });
      if (l.hasBump) {
        items.push({
          name: `[Special Add-On] ${l.product.bumpTitle}`,
          sku: "ADD-ON-BUMP",
          quantity: 1,
          priceMinor: BigInt(l.product.bumpPriceMinor),
          totalMinor: BigInt(l.product.bumpPriceMinor),
        });
      }
    }

    // EC29: gift placement — attempted BEFORE the order write so
    // the gift line rides the same upsert; the outcome is stamped
    // onto the evaluation so stampOrder (called after) records
    // giftPromotionId / giftSkipped truthfully. A gift that
    // cannot be placed never fails the order.
    if (q.ec16?.gift && this.promotions) {
      const placement = await this.promotions.giftPlacement(org.id, q.ec16.gift);
      if (placement) {
        items.push({
          productId: placement.product.id,
          name: this.displayNameOf(placement.product, setting.locale),
          sku: placement.variant?.sku || placement.product.sku || undefined,
          quantity: q.ec16.gift.giftQty,
          priceMinor: 0n,
          totalMinor: 0n,
          isGift: true,
        });
        q.ec16.giftOutcome = "applied";
      } else {
        q.ec16.giftOutcome = "skipped";
      }
    }

    const externalId = `native-${randomUUID()}`;
    const externalNumber = `ORD-${Date.now().toString().slice(-6)}-${randomBytes(2).toString("hex").toUpperCase()}`;
    const cleanPhone = dto.phone.trim();
    // ON4: blocklist refusal — generic message, never reveals the blocklist.
    if (this.blockedPhones && (await this.blockedPhones.isBlocked(org.id, cleanPhone))) throw new BadRequestException("দুঃখিত, এই মুহূর্তে অর্ডারটি নেওয়া যাচ্ছে না");
    // GB3 (GC9): block_checkout fraud rules (hit + attempt rows
    // are written by the guard itself; the caller only refuses).
    if (this.checkoutGuard) {
      const stats = await this.checkoutGuard
        .phoneOrderStats(org.id, bdPhoneMatchKey(cleanPhone) ?? "")
        .catch(() => null);
      const { blockedBy } = await this.checkoutGuard.evaluateFraudRulesAtCheckout(org.id, {
        totalMinor: q.totalMinor,
        isCod,
        district,
        openOrderCount: stats?.openCount ?? 0,
        phone: cleanPhone,
        channel: "shop",
      });
      if (blockedBy) throw new BadRequestException("দুঃখিত, এই মুহূর্তে অর্ডারটি নেওয়া যাচ্ছে না");
    }
    // GC22: plan/order blocks on this PUBLIC storefront
    // checkout surface ONLY as the generic shopper message.
    try {
    await this.integrations.upsertOrder(
      org.id,
      null,
      {
        externalId,
        externalNumber,
        status: "processing",
        paymentMethod,
        isCod,
        currency: "BDT",
        subtotalMinor: q.subtotalMinor,
        shippingMinor: q.deliveryMinor,
        discountMinor: q.discountMinor,
        taxMinor: q.taxMinor ?? 0n,
        totalMinor: q.totalMinor,
        refundedMinor: 0n,
        placedAt: new Date(),
        // EC25: pin the order to the session customer when a
        // matching storefront session was presented (upsertOrder
        // honours a pinned customerId after an in-org check).
        ...(sessionCustomer ? { customerId: sessionCustomer.id } : {}),
        // AB7 (AX19): order-level attribution stamps — the
        // normalized block spreads ONLY the keys the client
        // actually presented (absent attribution = no keys =
        // the Order columns stay null).
        ...normalizeAttribution(dto.attribution),
        // AB8 (AX27): device fingerprint stamp (valid hash only).
        ...(deviceHash ? { deviceHash } : {}),
        customer: {
          externalId: cleanPhone,
          firstName: dto.name.trim(),
          phone: cleanPhone,
          email: cart.email ?? undefined,
          address: {
            address_1: dto.address.trim(),
            district,
            note: noteParts.join(" | "),
          },
        },
        items,
      } as any,
      STOREFRONT_SOURCE,
    );
    } catch (e) {
      if (isOrderLimitBlocked(e)) throw new BadRequestException((e as OrderLimitBlockedError).shopperMessage ?? SHOPPER_ORDER_BLOCK_MESSAGE);
      throw e;
    }

    // The order exists now: convert the cart so a second checkout
    // attempt on the same token is refused, then redeem the coupon
    // (redeem failure must not fail a placed order — log only,
    // exactly like the single-product checkout).
    await this.t("storeCart").update({
      where: { id: cart.id },
      data: { status: "converted", updatedAt: new Date() },
    });
    // GB2 (GC7): the cart's reservations are consumed by this
    // conversion — the stock decrement that follows owns the
    // quantities now (no double count: consumed rows leave the
    // active set the availability math reads).
    if (this.inventory?.settleCartReservations) {
      await this.inventory
        .settleCartReservations(org.id, cart.id, "consumed")
        .catch(() => undefined);
    }
    if (q.appliedDiscountId && this.discounts) {
      await this.discounts.redeem(org.id, q.appliedDiscountId).catch((e) => {
        this.logger.warn(`coupon redeem failed for discount ${q.appliedDiscountId}: ${errMsg(e)}`);
      });
    }

    let orderId: string | null = null;
    try {
      const order = await this.t("order").findFirst({
        where: { organizationId: org.id, source: STOREFRONT_SOURCE, externalId },
      });
      orderId = order?.id ?? null;
      // EC18: stamp the validated slot choice onto the order.
      if (order && chosenSlot) {
        await this.t("order").update({
          where: { id: order.id },
          data: { deliverySlotId: chosenSlot.id, deliveryDate: dto.deliveryDate },
        });
      }
      // EC30: stamp the delivery method + pricing provenance
      // (home orders too — the schema defaults would otherwise
      // hide which path priced the order).
      if (order) {
        await this.t("order").update({
          where: { id: order.id },
          data: {
            deliveryMethod: q.deliveryMethod,
            pickupPointId: q.pickupPoint?.id ?? null,
            freeShippingApplied: q.zoneFreeShippingApplied === true,
            freeShippingZoneId: q.freeShippingZoneId ?? null,
            shippingRateRuleId: q.shippingRateRuleId ?? null,
          },
        });
      }
      // EC29: stamp the gift-wrap charge + message (the fee was
      // already priced into totalMinor by computeQuote — exactly
      // once; this only records it on the order).
      if (order && (q.giftWrapMinor ?? 0n) > 0n) {
        await this.t("order").update({
          where: { id: order.id },
          data: {
            giftWrapMinor: q.giftWrapMinor,
            giftMessage: dto.giftMessage?.trim()?.slice(0, 200) || null,
          },
        });
      }
      // EC16: stamp the promotion/referral split onto the order
      // (failure-isolated inside PromotionsService.stampOrder).
      if (order && q.ec16 && this.promotions) {
        await this.promotions.stampOrder(org.id, STOREFRONT_SOURCE, externalId, q.ec16);
      }
      // AB1 (AX1): spend the redeemed points now that the order
      // exists (failure-isolated inside LoyaltyService — a
      // posting problem never fails a placed order, exactly like
      // the coupon redeem above).
      if (order && q.ec16 && (q.ec16.loyaltyPointsApplied ?? 0) > 0 && this.loyalty) {
        await this.loyalty.postPlacementRedeem(org.id, {
          orderId: order.id,
          customerId: order.customerId ?? null,
          points: q.ec16.loyaltyPointsApplied ?? 0,
        });
      }
      // AB2 (AX3a): spend the redeemed gift-card balance now
      // that the order exists (postPlacementRedeem is
      // failure-isolated inside GiftCardsService).
      if (order && this.giftCards && (q.ec16?.giftCardDiscountMinor ?? 0n) > 0n && q.giftCard?.giftCardId) {
        await this.giftCards.postPlacementRedeem(org.id, {
          orderId: order.id,
          giftCardId: q.giftCard.giftCardId,
          amountMinor: q.ec16!.giftCardDiscountMinor!,
        });
      }
      // NF7 (FB3): spend the applied store credit now that the
      // order exists (postPlacementSpend is failure-isolated
      // inside StoreCreditService and exactly-once per order;
      // it re-verifies the order's customer, so the priced
      // customer and the debited customer can never diverge).
      if (order && this.storeCredit && (q.ec16?.storeCreditDiscountMinor ?? 0n) > 0n) {
        await this.storeCredit.postPlacementSpend(org.id, {
          orderId: order.id,
          customerId: order.customerId ?? null,
          amountMinor: q.ec16!.storeCreditDiscountMinor!,
        });
      }
      // AB2 (AX3b): record the issuance intents for this order's
      // gift-card lines, with the recipient hints from the CART
      // lines (matched to order items by productId). Only when
      // the cart actually had gift-card lines. Failure-isolated
      // twice over: recordIntents never throws by contract, and
      // this wrap keeps that true even if the contract drifts.
      if (order && this.giftCards && q.lines.some((l: any) => !!l.product?.isGiftCard)) {
        try {
          const orderItems: any[] =
            (await this.t("orderItem")
              .findMany({ where: { orderId: order.id } })
              .catch(() => [])) ?? [];
          const hints = new Map<string, any>();
          for (const line of q.lines) {
            if (!line.product?.isGiftCard) continue;
            const recipient = line.item?.giftCardRecipient ?? null;
            const match = orderItems.find(
              (oi: any) => oi.productId && String(oi.productId) === String(line.product.id),
            );
            if (!match) continue;
            hints.set(String(match.id), {
              recipientName: recipient?.name ?? undefined,
              recipientEmail: recipient?.email ?? undefined,
              recipientPhone: recipient?.phone ?? undefined,
              recipientMessage: recipient?.message ?? undefined,
            });
          }
          await this.giftCards.recordIntents(org.id, order.id, hints);
        } catch (e) {
          this.logger.warn(`gift card intent recording failed for order ${order.id}: ${errMsg(e)}`);
        }
      }
      // EC32: stamp affiliate attribution (failure-isolated
      // inside AffiliatesService.stampAttribution).
      if (order && this.affiliates) {
        await this.affiliates.stampAttribution(org.id, STOREFRONT_SOURCE, externalId, dto.affiliateCode, cleanPhone);
      }
      // EC24d: stamp the wholesale tier snapshot onto the order.
      if (order && q.wholesaleBreakdown?.length) {
        await this.t("order").update({
          where: { id: order.id },
          data: { wholesaleBreakdown: q.wholesaleBreakdown },
        });
      }
      // AB5 (AX7): stamp the group price-list snapshot onto the
      // order (same failure-isolated block as the wholesale stamp).
      if (order && q.priceListBreakdown?.length) {
        await this.t("order").update({
          where: { id: order.id },
          data: { priceListBreakdown: q.priceListBreakdown },
        });
      }
      // GB3 (GC8): terms-consent + COD-advance stamps (inside
      // this same failure-isolated block, like the neighbours).
      if (order && dto.termsAccepted === true && (terms.required || termsRef)) {
        await this.t("order").update({
          where: { id: order.id },
          data: { termsConsentedAt: new Date(), termsRef },
        });
      }
      if (order && codAdvanceRequired) {
        await this.t("order").update({
          where: { id: order.id },
          data: { codAdvanceRequired: true },
        });
      }
      // AB4 (AX5a): stamp the placement's deposit due (the
      // amount initiation/resend later collect against).
      if (order && deposit.active) {
        await this.t("order").update({
          where: { id: order.id },
          data: { depositDueMinor: deposit.amountMinor },
        });
      }
      // AB4 (AX5b): stamp the VALIDATED field answers.
      if (order && Object.keys(checkoutFieldValues).length > 0) {
        await this.t("order").update({
          where: { id: order.id },
          data: { checkoutFields: checkoutFieldValues },
        });
      }
    } catch {
      orderId = orderId ?? null;
    }

    // EC16: the buyer's OWN referral code to share (additive,
    // failure-isolated; null when it cannot be resolved).
    const yourReferralCode = this.promotions
      ? await this.promotions.yourReferralCodeForPhone(org.id, cleanPhone)
      : null;

    const response = {
      success: true,
      orderId,
      orderNumber: externalNumber,
      externalId,
      // EC24b: the success screen shows the digital-delivery note.
      hasDigitalItems: q.lines.some((l: any) => !!l.product.digital),
      // EC24d: transparency — tier pricing was applied to this order.
      wholesaleApplied: !!q.wholesaleApplied,
      deliverySlot: chosenSlot
        ? { id: chosenSlot.id, label: chosenSlot.label, date: dto.deliveryDate }
        : null,
      // EC30: delivery method + chosen pickup point (public
      // outlet info) for the success screen.
      deliveryMethod: q.deliveryMethod,
      pickupPoint: q.pickupPoint ?? null,
      shopName: setting.shopName || org.brandName || org.name,
      paymentMethod,
      paymentClaimStatus: onlinePayment ? "online_pending" : isCod ? "cod_due" : "advance_unverified",
      // AB4 (AX5a): the deposit due on this placement + what
      // remains due after it (null when no deposit applies).
      deposit: deposit.active
        ? {
            amountMinor: deposit.amountMinor.toString(),
            kind: depositKind,
            note: deposit.note,
            dueAfterMinor: (q.totalMinor - deposit.amountMinor).toString(),
          }
        : null,
      itemsSubtotalMinor: q.itemsSubtotalMinor.toString(),
      bumpMinor: q.bumpMinor.toString(),
      subtotalMinor: q.subtotalMinor.toString(),
      discountMinor: q.discountMinor.toString(),
      // EC16: promotion + referral split + applied names for the
      // success screen, and the buyer's own code to share.
      promotionDiscountMinor: (q.promotionDiscountMinor ?? 0n).toString(),
      promotionsApplied: (q.promotionsApplied ?? []).map((p: any) => ({
        promotionId: p.promotionId,
        name: p.name,
        type: p.type,
        amountMinor: p.amountMinor.toString(),
      })),
      referralDiscountMinor: (q.referralDiscountMinor ?? 0n).toString(),
      referral: q.referralAppliedCode ? { code: q.referralAppliedCode } : null,
      yourReferralCode,
      // AB1 (AX1): the loyalty line of the placed order.
      loyaltyDiscountMinor: (q.ec16?.loyaltyDiscountMinor ?? 0n).toString(),
      loyaltyPointsUsed: q.ec16?.loyaltyPointsApplied ?? 0,
      // AB2 (AX3): the gift-card line of the placed order.
      giftCardDiscountMinor: (q.ec16?.giftCardDiscountMinor ?? 0n).toString(),
      giftCardCodeLast4: q.ec16?.giftCardCodeLast4 ?? null,
      // EC29: gift outcome + wrap charge for the success screen.
      gift: q.ec16?.giftOutcome === "applied" ? (q.giftDisplay ?? null) : null,
      giftSkipped: q.ec16?.giftOutcome === "skipped",
      giftWrapMinor: (q.giftWrapMinor ?? 0n).toString(),
      // EC23: VAT snapshot (breakdown rides stampOrder, like EC16).
      taxMinor: (q.taxMinor ?? 0n).toString(),
      taxAddedMinor: (q.taxAddedMinor ?? 0n).toString(),
      deliveryMinor: q.deliveryMinor.toString(),
      totalMinor: q.totalMinor.toString(),
      // For COD this is the cash due on delivery. For a manual
      // bkash/nagad claim the FULL total is still due — the claimed
      // advance is unverified and has no confirmed amount.
      codDueMinor: q.totalMinor.toString(),
      amountDueMinor: q.totalMinor.toString(),
      currency: "BDT",
    };
    // GB3 (GC8): record the placement under the idempotency key
    // (a concurrent winner's stored response wins the return).
    if (dto.idempotencyKey && this.idempotency) {
      return await this.idempotency.record(org.id, dto.idempotencyKey, "shop", orderId, response);
    }
    return response;
  }

  /**
   * AB4 (AX5c): express checkout — a signed-in shop customer
   * places the cart against one of their SAVED addresses in a
   * single call. All pricing/placement discipline is checkout()
   * itself: this method only resolves the session customer and
   * the address (explicit addressId must belong to the customer;
   * otherwise the default address, else the oldest saved one)
   * and then delegates with the address's fields.
   */
  async expressCheckout(orgSlug: string, token: string | null | undefined, dto: ExpressCheckoutDto, ctx?: { ip?: string | null }) {
    const { org } = await this.requireEnabledShop(orgSlug);
    const customer = await this.resolveSessionCustomer(org.id, token);
    if (!customer) {
      throw new BadRequestException("এক্সপ্রেস অর্ডারের জন্য আগে লগইন করুন");
    }
    const addresses: any[] =
      (await this.t("customerAddress")
        .findMany({
          where: { organizationId: org.id, customerId: customer.id },
          orderBy: { createdAt: "asc" },
        })
        .catch(() => [])) ?? [];
    let chosen: any = null;
    if (dto.addressId) {
      chosen = addresses.find((a) => a.id === dto.addressId) ?? null;
      if (!chosen) {
        throw new BadRequestException("ঠিকানাটি আপনার অ্যাকাউন্টে পাওয়া যায়নি");
      }
    } else {
      chosen = addresses.find((a) => a.isDefault) ?? addresses[0] ?? null;
    }
    if (!chosen) {
      throw new BadRequestException("কোনো সংরক্ষিত ঠিকানা নেই — আগে অ্যাকাউন্টে ঠিকানা যোগ করুন");
    }
    return this.checkout(orgSlug, {
      cartToken: dto.cartToken,
      name: chosen.recipientName,
      phone: chosen.phone,
      address: chosen.addressLine,
      district: chosen.district,
      paymentMethod: dto.paymentMethod,
      onlinePayment: dto.onlinePayment,
      fieldAnswers: dto.fieldAnswers,
      termsAccepted: dto.termsAccepted,
      idempotencyKey: dto.idempotencyKey,
      // AB7 (AX19): forward the attribution block into
      // checkout(), which stamps it at placement.
      attribution: dto.attribution,
      // AB8 (AX27): forward the device hash into checkout().
      deviceHash: dto.deviceHash,
    } as CheckoutDto, token, ctx);
  }

  // ================= Public: EC18 order tracking =================

  /**
   * Branded public order tracking: order number + the phone the
   * order was placed with. EVERY failure (tracking disabled,
   * unknown number, phone mismatch) answers the SAME constant
   * 404 message — the response never reveals which part failed.
   * The payload deliberately carries no address, no phone and no
   * email — only the order's own facts.
   */
  /** EC24b: the ONE order-number + phone match used by both
   * trackOrder and the digital-access reveal — same shop gate,
   * same constant not-found error, same phone normalization, so
   * the two surfaces can never drift apart. EC28: also used by
   * RetentionService for customer self-service RMA, so it is
   * public within the codebase (not an HTTP surface by itself). */
  async matchTrackedOrder(orgSlug: string, dto: TrackLookupDto) {
    const NOT_FOUND = "অর্ডারটি পাওয়া যায়নি — অর্ডার নম্বর ও ফোন নম্বর যাচাই করে আবার চেষ্টা করুন";
    const { org, setting } = await this.requireEnabledShop(orgSlug);
    if (setting.trackingPageEnabled === false) throw new NotFoundException(NOT_FOUND);

    const normalizePhone = (v: unknown): string => {
      let digits = String(v ?? "").replace(/\D/g, "");
      if (digits.startsWith("880") && digits.length === 13) digits = `0${digits.slice(3)}`;
      if (digits.length > 11) digits = digits.slice(-11);
      return digits;
    };
    const wantedPhone = normalizePhone(dto.phone);

    const q = String(dto.orderNumber ?? "").trim();
    if (!q || !wantedPhone) throw new NotFoundException(NOT_FOUND);
    const orderTable = this.t("order");
    if (!orderTable?.findMany) throw new NotFoundException(NOT_FOUND);
    const upper = q.toUpperCase();
    const raw: any[] =
      (await orderTable
        .findMany({
          where: {
            organizationId: org.id,
            OR: [
              { externalNumber: q },
              { externalNumber: upper },
              { externalId: q },
              { externalId: upper },
            ],
          },
        })
        .catch(() => [])) ?? [];
    const seen = new Set<string>();
    const candidates: any[] = [];
    for (const row of raw) {
      if (seen.has(String(row.id))) continue;
      seen.add(String(row.id));
      candidates.push(row);
      if (candidates.length >= 5) break;
    }

    // Phone match per candidate (customer may be embedded by an
    // include or resolvable via the customer table).
    let order: any = null;
    let matchedCustomer: any = null;
    for (const candidate of candidates) {
      let customer: any = candidate.customer ?? null;
      if (!customer && candidate.customerId) {
        try {
          const table = this.t("customer");
          if (table?.findFirst) {
            customer = await table.findFirst({ where: { id: candidate.customerId, organizationId: org.id } }).catch(() => null);
          }
        } catch { customer = null; }
      }
      if (customer && normalizePhone(customer.phone) === wantedPhone) {
        order = candidate;
        matchedCustomer = customer;
        break;
      }
    }
    if (!order) throw new NotFoundException(NOT_FOUND);
    void matchedCustomer; // identity is verified, never returned
    return { org, setting, order };
  }

  /** EC24b: the order's items whose product is digital, with the
   * product rows resolved org-scoped. digitalFileUrl stays on the
   * product row here — callers decide what may be exposed (the
   * tracking payload NEVER includes it; only the reveal does). */
  private async digitalLinesOf(order: any): Promise<Array<{ item: any; product: any }>> {
    let items: any[] = Array.isArray(order.items) ? order.items : [];
    if (!Array.isArray(order.items)) {
      try {
        const table = this.t("orderItem");
        if (table?.findMany) items = (await table.findMany({ where: { orderId: order.id } }).catch(() => [])) ?? [];
      } catch { items = []; }
    }
    const out: Array<{ item: any; product: any }> = [];
    for (const item of items) {
      if (!item?.productId) continue;
      const product = await this.t("product")
        .findFirst({ where: { id: item.productId, organizationId: order.organizationId } })
        .catch(() => null);
      if (product?.digital) out.push({ item, product });
    }
    return out;
  }

  /** EC24b delivery gate: order status completed/delivered, or any
   * Fulfillment of the order delivered. */
  private async digitalDelivered(order: any): Promise<boolean> {
    if (["completed", "delivered"].includes(String(order.status))) return true;
    let fulfillments: any[] = Array.isArray(order.fulfillments) ? order.fulfillments : [];
    if (!Array.isArray(order.fulfillments)) {
      try {
        const table = this.t("fulfillment");
        if (table?.findMany) fulfillments = (await table.findMany({ where: { orderId: order.id } }).catch(() => [])) ?? [];
      } catch { fulfillments = []; }
    }
    return fulfillments.some((f: any) => f.status === "delivered");
  }

  /** EC24b effective access cap: the MINIMUM non-null
   * digitalAccessLimit among the order's digital products;
   * null everywhere = unlimited. */
  private digitalAccessLimitOf(lines: Array<{ product: any }>): number | null {
    const limits = lines
      .map((l) => l.product.digitalAccessLimit)
      .filter((v) => v !== null && v !== undefined)
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v));
    return limits.length ? Math.min(...limits) : null;
  }

  /**
   * EC24b — digital link reveal. Same order-number + phone match
   * as trackOrder (shared matcher, same not-found error). The
   * merchant-hosted file URL is returned ONLY here, only after
   * delivery, and each successful reveal counts against the
   * order's access cap.
   *
   * AB5 (AX9) rework: the raw file URL is NEVER returned any
   * more. File-delivering lines ("file" / "both") get a signed,
   * expiring downloadPath (see digital-download-token.ts); the
   * download endpoint re-validates everything and 302s to the
   * stored URL. License-delivering lines ("license" / "both")
   * get their pool keys ASSIGNED here: there is no separate
   * delivery event choke point for native digital orders, so
   * this delivery-gated reveal IS the assignment point —
   * exactly where AB2's gift-card reveal also lives.
   */
  async digitalAccess(orgSlug: string, dto: TrackLookupDto) {
    const { order } = await this.matchTrackedOrder(orgSlug, dto);
    const lines = await this.digitalLinesOf(order);
    // AB2 (AX3): the buyer's issued gift cards ride this same
    // reveal surface (the ONLY place a full code is ever shown).
    // Issuance itself happens only at the sold transition, so
    // the delivery gate below is consistent for both.
    const giftCards = this.giftCards
      ? await this.giftCards.buyerRevealForOrder(order.organizationId, order.id).catch(() => [])
      : [];
    if (!lines.length && !giftCards.length) {
      throw new BadRequestException("এই অর্ডারে ডিজিটাল পণ্য নেই");
    }
    if (!(await this.digitalDelivered(order))) {
      throw new BadRequestException("ডেলিভারি সম্পন্ন হলে ডাউনলোড লিংক পাওয়া যাবে");
    }
    const limit = this.digitalAccessLimitOf(lines);
    const used = Number(order.digitalAccessCount ?? 0) || 0;
    if (limit !== null && used >= limit) {
      throw new BadRequestException("ডাউনলোডের সীমা শেষ হয়ে গেছে");
    }
    // AB2: the access-cap counting is a DIGITAL-download concept
    // — it runs only when the order actually has digital lines.
    // A gift-card-only reveal is not counted against it.
    if (lines.length) {
      try {
        await this.t("order").update({
          where: { id: order.id },
          data: { digitalAccessCount: used + 1, digitalLastAccessedAt: new Date() },
        });
      } catch { /* bookkeeping must not withhold an earned link */ }
    }
    // AB5 (AX9): license assignment rides this reveal, failure-
    // isolated — a license failure must NOT break the file
    // reveal the buyer already earned.
    let licenseKeys: any[] = [];
    let licenseShortages: any[] = [];
    const hasLicenseLines = lines.some((l) =>
      ["license", "both"].includes(String(l.product.digitalDeliveryType ?? "file")),
    );
    if (this.licenseKeys && hasLicenseLines) {
      try {
        const assigned = await this.licenseKeys.ensureAssignedForOrder(
          order.organizationId,
          order,
        );
        licenseKeys = (assigned?.byItem ?? []).map((entry: any) => ({
          itemId: entry.itemId,
          productName: entry.productName,
          keys: (entry.keys ?? []).map((k: any) => ({
            key: k.key,
            keyLast4: k.keyLast4,
          })),
        }));
        licenseShortages = (assigned?.shortages ?? []).map((s: any) => ({
          productName: s.productName,
          needed: s.needed,
          assigned: s.assigned,
        }));
      } catch (e) {
        this.logger.warn(
          `license assignment failed for order ${order.id} — file reveal continues: ${errMsg(e)}`,
        );
      }
    }
    return {
      // AB5 (AX9): signed download paths — NO raw digitalFileUrl
      // anywhere in this response any more. Only file-delivering
      // lines mint a token; license-only lines are carried by
      // licenseKeys below and must not need a URL. INT7 union
      // (RB6/RM9): a storage-key-only line mints ONLY when the
      // key can actually resolve at download time (storage wired
      // in s3 mode — the same condition digitalDownloadUrl uses),
      // so the reveal never hands out a path that cannot deliver.
      links: lines
        .filter(
          (l) =>
            ["file", "both"].includes(
              String(l.product.digitalDeliveryType ?? "file"),
            ) &&
            (!!l.product.digitalFileUrl ||
              (!!l.product.digitalStorageKey &&
                !!this.storage &&
                this.storage.mode === "s3")),
        )
        .map((l) => {
          const hours = Number(l.product.digitalLinkExpiryHours ?? 72) || 72;
          const expEpochSec = Math.floor(Date.now() / 1000) + hours * 3600;
          const token = mintDownloadToken(downloadTokenSecret(), {
            orderId: order.id,
            itemId: l.item.id,
            expEpochSec,
          });
          return {
            productName: l.product.name,
            itemId: l.item.id,
            downloadPath: `public/shop/${orgSlug}/orders/${order.id}/digital-download?token=${token}`,
            expiresAt: new Date(expEpochSec * 1000).toISOString(),
          };
        }),
      // AB5 (AX9): assigned license keys for this order (full
      // key — this surface only, after delivery, buyer-matched)
      // + honest shortages when the pool ran dry.
      licenseKeys,
      licenseShortages,
      // AB2 (AX3): issued gift cards for this order (full code —
      // this surface only, after delivery, buyer-matched).
      giftCards: giftCards.map((c: any) => ({
        code: c.code,
        codeLast4: c.codeLast4,
        initialAmountMinor: c.initialAmountMinor,
        balanceMinor: c.balanceMinor,
        status: c.status,
        expiresAt: c.expiresAt,
      })),
    };
  }

  /** RB6/RM9: the download URL for ONE digital line, resolved
   * only here — after every EC24b gate above has passed (order +
   * phone match, delivery, access cap; the cap counter increments
   * before this runs, exactly as for merchant-hosted links). An
   * R2-hosted file (digitalStorageKey) wins and yields a 300s
   * presigned GET from the PRIVATE bucket. Without object storage
   * (or in local mode) the merchant-hosted URL is revealed exactly
   * as EC24b did; a product with neither yields no link. */
  private digitalDownloadUrl(product: any): string | null {
    const key = product?.digitalStorageKey ? String(product.digitalStorageKey) : "";
    if (key && this.storage && this.storage.mode === "s3") {
      const url = this.storage.signedGetUrl("private", key, 300);
      if (url) return url;
    }
    return product?.digitalFileUrl ? String(product.digitalFileUrl) : null;
  }

  /**
   * AB5 (AX9) — signed digital download. Validates the token
   * (signature + expiry), that it names THIS order, that the
   * order belongs to the org behind orgSlug, that the item is on
   * the order with a digital product carrying a file URL, and
   * that the order is STILL delivered; then enforces the
   * PER-ITEM limit (the item product's digitalAccessLimit
   * against the item's own digitalAccessCount). ANY failure
   * answers the SAME generic 403 page — never which check
   * failed. On success the item counter is incremented BEFORE
   * the redirect; the increment is the enforcement record, but
   * following the codebase's reveal posture the count is
   * best-effort bookkeeping (the CHECK is on the stored count):
   * if the update itself fails the buyer still gets the file
   * they earned, rather than a dead link.
   */
  async digitalDownload(
    orgSlug: string,
    orderId: string,
    token: string | undefined,
    res: any,
  ): Promise<void> {
    const fail = () => {
      const html =
        `<!doctype html><html lang="bn"><head><meta charset="utf-8">` +
        `<title>লিংকটি বৈধ নয়</title></head><body>` +
        `<p>লিংকটি বৈধ নয় বা মেয়াদ শেষ</p></body></html>`;
      try {
        res.status(403);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        if (typeof res.send === "function") res.send(html);
        else res.end(html);
      } catch {
        /* the response is already gone — nothing left to say */
      }
    };

    let targetUrl: string | null = null;
    try {
      if (!token) return fail();
      const payload = verifyDownloadToken(downloadTokenSecret(), token);
      if (!payload) return fail();
      if (payload.orderId !== orderId) return fail();

      const { org } = await this.requireEnabledShop(orgSlug);
      const order = await this.t("order")
        .findFirst({ where: { id: orderId, organizationId: org.id } })
        .catch(() => null);
      if (!order) return fail();

      const lines = await this.digitalLinesOf(order);
      const line = lines.find((l) => String(l.item.id) === payload.itemId);
      if (!line) return fail();
      if (!line.product.digitalFileUrl && !line.product.digitalStorageKey) return fail();
      if (!(await this.digitalDelivered(order))) return fail();

      const limitRaw = line.product.digitalAccessLimit;
      const itemUsed = Number(line.item.digitalAccessCount ?? 0) || 0;
      if (limitRaw !== null && limitRaw !== undefined) {
        const limit = Number(limitRaw);
        if (Number.isFinite(limit) && itemUsed >= limit) return fail();
      }

      try {
        await this.t("orderItem").update({
          where: { id: line.item.id },
          data: {
            digitalAccessCount: itemUsed + 1,
            digitalLastAccessedAt: new Date(),
          },
        });
      } catch {
        /* best-effort bookkeeping — see the method doc above */
      }
      targetUrl = this.digitalDownloadUrl(line.product);
      if (!targetUrl) return fail();
    } catch {
      return fail();
    }

    if (typeof res.redirect === "function") {
      res.redirect(302, targetUrl);
    } else {
      res.status(302);
      res.setHeader("Location", targetUrl);
      res.end();
    }
  }

  /**
   * AB2 (AX3) — public gift-card balance lookup. Same shop gate
   * as every public route; the service answers a generic Bengali
   * error for an unknown / wrong-org code, so this surface never
   * reveals whether a code exists elsewhere.
   */
  async giftCardBalance(orgSlug: string, dto: GiftCardBalanceDto) {
    const { org } = await this.requireEnabledShop(orgSlug);
    if (!this.giftCards) {
      throw new BadRequestException("গিফট কার্ড সুবিধা এই দোকানে নেই");
    }
    return this.giftCards.publicBalance(org.id, dto.code);
  }

  async trackOrder(orgSlug: string, dto: TrackLookupDto) {
    const { org, setting, order } = await this.matchTrackedOrder(orgSlug, dto);

    // Items (embedded include or the orderItem table).
    let items: any[] = Array.isArray(order.items) ? order.items : [];
    if (!Array.isArray(order.items)) {
      try {
        const table = this.t("orderItem");
        if (table?.findMany) {
          items = (await table.findMany({ where: { orderId: order.id } }).catch(() => [])) ?? [];
        }
      } catch { items = []; }
    }

    // Fulfillments (embedded or table), latest first.
    let fulfillments: any[] = Array.isArray(order.fulfillments) ? [...order.fulfillments] : [];
    if (!Array.isArray(order.fulfillments)) {
      try {
        const table = this.t("fulfillment");
        if (table?.findMany) {
          fulfillments = (await table.findMany({ where: { orderId: order.id } }).catch(() => [])) ?? [];
        }
      } catch { fulfillments = []; }
    }
    fulfillments.sort(
      (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
    );
    const latestFulfillment = fulfillments[0] ?? null;

    // Latest courier shipment; synthesized from the fulfillment
    // when the parcel was booked without a shipment row.
    let shipment: any = null;
    try {
      const table = this.t("courierShipment");
      if (table?.findMany) {
        const rows: any[] = (await table.findMany({ where: { orderId: order.id } }).catch(() => [])) ?? [];
        rows.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
        shipment = rows[0] ?? null;
      }
    } catch { shipment = null; }
    const iso = (v: any) => (v instanceof Date ? v.toISOString() : v ?? null);
    // EC22: when the courier account carries a tracking URL
    // template, the public page links straight to the courier's
    // own tracking page. No template => null, and the page keeps
    // showing just the number — a link is never invented.
    const trackingUrlFor = async (provider: unknown, trackingCode: unknown): Promise<string | null> => {
      if (!provider || !trackingCode) return null;
      try {
        const table = this.t("integration");
        if (!table?.findFirst) return null;
        const integration = await table
          .findFirst({ where: { organizationId: org.id, provider: String(provider) } })
          .catch(() => null);
        const template = (integration as any)?.trackingUrlTemplate;
        if (!template) return null;
        return String(template).split("{trackingId}").join(encodeURIComponent(String(trackingCode)));
      } catch { return null; }
    };
    let shipmentOut: any = null;
    if (shipment) {
      shipmentOut = {
        provider: shipment.provider ?? null,
        trackingCode: shipment.trackingCode ?? null,
        trackingUrl: await trackingUrlFor(shipment.provider, shipment.trackingCode),
        status: shipment.status ?? null,
        bookedAt: iso(shipment.createdAt),
      };
    } else if (latestFulfillment && (latestFulfillment.courierProvider || latestFulfillment.trackingCode)) {
      shipmentOut = {
        provider: latestFulfillment.courierProvider ?? null,
        trackingCode: latestFulfillment.trackingCode ?? null,
        trackingUrl: await trackingUrlFor(latestFulfillment.courierProvider, latestFulfillment.trackingCode),
        status: latestFulfillment.status ?? null,
        bookedAt: iso(latestFulfillment.createdAt),
      };
    }

    // Advance / COD due — same math as OrdersService.getOne:
    // APPROVED verifications for THIS order only, capped at total.
    let advancePaid = 0n;
    try {
      const table = this.t("paymentVerification");
      if (table?.findMany) {
        const rows: any[] =
          (await table.findMany({ where: { organizationId: org.id, orderId: order.id } }).catch(() => [])) ?? [];
        for (const row of rows) {
          if (row.status !== "approved" || row.amountMinor == null) continue;
          try { advancePaid += BigInt(row.amountMinor as any); } catch { /* counts 0 */ }
        }
      }
    } catch { advancePaid = 0n; }
    const total = (() => { try { return BigInt(order.totalMinor ?? 0); } catch { return 0n; } })();
    if (advancePaid > total) advancePaid = total;
    const codDue = total - advancePaid;

    // Delivery slot summary (no scope/capacity internals).
    let deliverySlot: any = null;
    if (order.deliverySlotId) {
      try {
        const table = this.t("deliverySlot");
        const slot = table?.findFirst
          ? await table.findFirst({ where: { id: order.deliverySlotId, organizationId: org.id } }).catch(() => null)
          : null;
        if (slot) {
          deliverySlot = {
            label: slot.label, startTime: slot.startTime, endTime: slot.endTime,
            date: order.deliveryDate ?? null,
          };
        }
      } catch { deliverySlot = null; }
    }

    // EC30: pickup point summary for pickup orders. The point's
    // address is PUBLIC outlet info; a point deactivated since
    // the order was placed still shows (any-status read), and a
    // missing row reads as null. Failure-isolated like the slot.
    let pickupPoint: any = null;
    if (order.deliveryMethod === "pickup" && order.pickupPointId) {
      try {
        const table = this.t("pickupPoint");
        const point = table?.findFirst
          ? await table.findFirst({ where: { id: order.pickupPointId, organizationId: org.id } }).catch(() => null)
          : null;
        if (point) {
          pickupPoint = {
            name: point.name,
            address: point.address,
            district: point.district,
            phone: point.phone ?? null,
          };
        }
      } catch { pickupPoint = null; }
    }

    // EC31: installment (কিস্তি) summary — present only when this
    // order carries an ACTIVE plan; the customer sees how much of
    // the schedule is paid and what is due next (their own money
    // facts, like codDueMinor above). Read straight from the
    // plan/item tables, failure-isolated like every summary in
    // this payload (a missing table reads as "no plan"). The math
    // mirrors InstallmentsService.summaryForOrder: fully-paid =
    // paidMinor >= amountMinor; next due = the earliest-seq item
    // still carrying a remainder; dates are Asia/Dhaka days (the
    // plan stores dueDate at UTC midnight of the Dhaka day).
    let installmentSummary: any = null;
    try {
      const planTable = this.t("installmentPlan");
      const plan = planTable?.findFirst
        ? await planTable
            .findFirst({ where: { orderId: order.id, organizationId: org.id, status: "active" } })
            .catch(() => null)
        : null;
      if (plan) {
        const itemTable = this.t("installmentItem");
        const planItems: any[] = itemTable?.findMany
          ? ((await itemTable.findMany({ where: { planId: plan.id } }).catch(() => [])) ?? [])
          : [];
        const sorted = [...planItems].sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0));
        let remaining = 0n;
        let paidCount = 0;
        let nextDue: { item: any; remaining: bigint } | null = null;
        for (const it of sorted) {
          let amount = 0n;
          let paid = 0n;
          try { amount = BigInt(it.amountMinor as any); } catch { /* counts 0 */ }
          try { paid = BigInt(it.paidMinor as any); } catch { /* counts 0 */ }
          const rem = amount > paid ? amount - paid : 0n;
          if (amount > 0n && rem === 0n) paidCount += 1;
          remaining += rem;
          if (rem > 0n && !nextDue) nextDue = { item: it, remaining: rem };
        }
        const dueDay = (d: any): string | null => {
          if (!d) return null;
          const date = d instanceof Date ? d : new Date(d);
          if (Number.isNaN(date.getTime())) return null;
          return new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit",
          }).format(date);
        };
        installmentSummary = {
          totalInstallments: Number(plan.installmentCount ?? sorted.length),
          paidInstallments: paidCount,
          nextDueDate: nextDue ? dueDay(nextDue.item.dueDate) : null,
          nextDueAmountMinor: nextDue ? nextDue.remaining.toString() : null,
          remainingMinor: remaining.toString(),
        };
      }
    } catch { installmentSummary = null; }

    const fStatus = latestFulfillment?.status ?? null;
    const steps = [
      { key: "placed", reached: true },
      {
        key: "confirmed",
        reached: ["processing", "completed"].includes(String(order.status)) || fulfillments.length > 0,
      },
      {
        key: "packed",
        reached: fStatus !== null && ["packed", "handed_over", "in_transit", "delivered"].includes(fStatus),
      },
      {
        key: "shipped",
        reached:
          (fStatus !== null && ["handed_over", "in_transit", "delivered"].includes(fStatus)) || shipmentOut !== null,
      },
      {
        key: "delivered",
        reached:
          String(order.status) === "completed" ||
          fulfillments.some((f) => f.status === "delivered") ||
          shipment?.status === "delivered",
      },
    ];

    // EC24b: digital items summary — names + availability ONLY.
    // The file URL is never part of this payload; it is revealed
    // exclusively by POST .../track/digital-access after delivery.
    const digitalLines = await this.digitalLinesOf(order);
    const digitalLimit = this.digitalAccessLimitOf(digitalLines);
    const digitalUsed = Number(order.digitalAccessCount ?? 0) || 0;
    const digitalAvailable =
      digitalLines.length > 0 &&
      (await this.digitalDelivered(order)) &&
      (digitalLimit === null || digitalUsed < digitalLimit);
    const digitalItems = digitalLines.map((l) => ({ name: l.product.name, available: digitalAvailable }));
    const digitalNote = digitalLines.length
      ? digitalAvailable
        ? "ডিজিটাল পণ্য: “লিংক দেখুন” বোতামে ডাউনলোড লিংক পাওয়া যাবে"
        : "ডিজিটাল পণ্য: ডেলিভারি সম্পন্ন হলে ডাউনলোড লিংক পাওয়া যাবে"
      : null;

    // AB2 (AX3): gift-card items summary — names + issuance ONLY.
    // A gift-card CODE is never part of this payload; codes are
    // revealed exclusively by POST .../track/digital-access
    // after delivery (see digitalAccess). Failure-isolated like
    // the returnRequests block below: a missing giftCard table
    // reads as no gift-card lines issued.
    let giftCardItems: Array<{ name: string; issued: boolean }> = [];
    let giftCardNote: string | null = null;
    try {
      const giftLines: Array<{ item: any; product: any }> = [];
      for (const item of items) {
        if (!item?.productId) continue;
        const product = await this.t("product")
          .findFirst({ where: { id: item.productId, organizationId: order.organizationId } })
          .catch(() => null);
        if (product?.isGiftCard) giftLines.push({ item, product });
      }
      if (giftLines.length) {
        let issued = false;
        const gcTable = this.t("giftCard");
        if (gcTable?.count) {
          const n = await gcTable
            .count({ where: { organizationId: order.organizationId, issuedOrderId: order.id } })
            .catch(() => 0);
          issued = Number(n) > 0;
        } else if (gcTable?.findMany) {
          const rows: any[] =
            (await gcTable
              .findMany({ where: { organizationId: order.organizationId, issuedOrderId: order.id } })
              .catch(() => [])) ?? [];
          issued = rows.length > 0;
        }
        giftCardItems = giftLines.map((l) => ({ name: l.product.name, issued }));
        giftCardNote = issued
          ? "গিফট কার্ড: “লিংক দেখুন” বোতামে আপনার গিফট কার্ডের কোড পাওয়া যাবে"
          : "গিফট কার্ড: অর্ডার সম্পন্ন হলে গিফট কার্ডের কোড পাওয়া যাবে";
      }
    } catch { giftCardItems = []; giftCardNote = null; }

    // EC28: the customer's own return/exchange requests for THIS
    // order (any source — staff-created ones included, so the
    // customer sees the status of a request staff opened for
    // them). Failure-isolated: a missing table reads as none.
    let returnRequests: any[] = [];
    try {
      const table = this.t("returnRequest");
      if (table?.findMany) {
        const rows: any[] =
          (await table.findMany({ where: { organizationId: org.id, orderId: order.id } }).catch(() => [])) ?? [];
        returnRequests = rows
          .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
          .map((r) => ({
            id: r.id,
            source: r.source ?? "staff",
            requestType: r.requestType ?? null,
            status: r.status,
            reason: r.reason ?? null,
            items: Array.isArray(r.items) ? r.items : null,
            createdAt: iso(r.createdAt),
          }));
      }
    } catch { returnRequests = []; }

    // NF9 (FB4): the own-rider's latest fix — ONLY under the
    // shared visibility rule (order/shipment out_for_delivery
    // or the rider's assignment picked_up, rider sharing, an
    // active assignment for this order); null otherwise and
    // the page renders nothing. Failure-isolated like every
    // summary above: a missing NF9 table reads as no location.
    const riderLocation = await customerRiderLocation(
      this.prisma as any, org.id, order.id,
      { orderStatus: order.status, shipmentStatus: shipmentOut?.status ?? null },
    ).catch(() => null);

    return {
      orderNumber: order.externalNumber ?? order.externalId,
      placedAt: iso(order.placedAt),
      status: order.status,
      // NF9: rider live location (null unless the rule above passes).
      riderLocation,
      currency: order.currency ?? "BDT",
      // EC28: item ids so the tracking page can build a return /
      // exchange request against the order's own lines.
      items: items.map((i: any) => ({
        id: i.id,
        name: i.name,
        quantity: i.quantity,
        totalMinor: i.totalMinor != null ? String(i.totalMinor) : "0",
      })),
      returnRequests,
      totalMinor: total.toString(),
      advancePaidMinor: advancePaid.toString(),
      codDueMinor: codDue.toString(),
      // EC24b: digital summary (no URLs — see digitalAccess).
      digitalItems,
      digitalNote,
      // AB2 (AX3): gift-card summary (no codes — see digitalAccess).
      giftCardItems,
      giftCardNote,
      deliverySlot,
      // EC30: delivery method + pickup point (pickup orders only).
      deliveryMethod: order.deliveryMethod ?? "home",
      pickupPoint,
      // EC31: installment summary (active plans only, else null).
      installmentSummary,
      steps,
      fulfillment: latestFulfillment ? { status: latestFulfillment.status } : null,
      shipment: shipmentOut,
      shop: {
        name: setting.shopName || org.brandName || org.name,
        logoUrl: org.logoUrl ?? null,
        primaryColor: org.primaryColor ?? null,
        supportPhone: setting.supportPhone ?? null,
        returnPolicyText: setting.returnPolicyText ?? null,
        deliveryPromiseText: setting.deliveryPromiseText ?? null,
      },
      notes: order.notes ?? null,
    };
  }

  /** Automated Customer NDR Delivery Reschedule & Alternative Contact */
  async ndrRecovery(orgSlug: string, dto: NdrRecoveryDto) {
    const { order } = await this.matchTrackedOrder(orgSlug, {
      phone: dto.phone,
      orderNumber: dto.orderNumber,
    });

    const isTerminal = ["delivered", "cancelled", "canceled", "refunded", "returned"].includes(
      String(order.status || "").toLowerCase(),
    );
    if (isTerminal) {
      throw new BadRequestException("এই অর্ডারের জন্য ডেলিভারি নির্দেশনা পরিবর্তনযোগ্য নয়।");
    }

    let noteEntry = "";
    if (dto.action === "reschedule") {
      noteEntry = `[গ্রাহক NDR সহায়তা] ডেলিভারি রিশিডিউল: ${dto.rescheduleDate || "পরবর্তী কার্যদিবসে"}`;
    } else if (dto.action === "alt_phone") {
      noteEntry = `[গ্রাহক NDR সহায়তা] বিকল্প যোগাযোগ নম্বর: ${dto.altPhone}`;
    } else if (dto.action === "update_address") {
      noteEntry = `[গ্রাহক NDR সহায়তা] সংশোধিত ঠিকানা/ল্যান্ডমার্ক: ${dto.updatedAddress}`;
    } else {
      noteEntry = `[গ্রাহক NDR সহায়তা] বিশেষ নির্দেশনা: ${dto.instruction}`;
    }

    const currentNotes = order.notes ? `${order.notes}\n${noteEntry}` : noteEntry;

    try {
      await this.t("order").update({
        where: { id: order.id },
        data: {
          notes: currentNotes,
          updatedAt: new Date(),
        },
      });
    } catch {
      // safe fallback
    }

    return {
      success: true,
      message: "আপনার ডেলিভারি নির্দেশনা সফলভাবে গ্রহণ করা হয়েছে এবং ডেলিভারি টিমকে অবহিত করা হয়েছে।",
      action: dto.action,
      updatedNotes: noteEntry,
    };
  }

  // ================= Public: by-domain =================

  /**
   * TD9: the ONE verified-domain resolution, shared by byDomain
   * and domainAllowed. A domain resolves ONLY when an org's stored
   * customDomain matches the input OR its www/apex variant AND
   * that org's StorefrontSetting has domainVerifiedAt set (the
   * EC8 condition). Returns null — never throws — when nothing
   * verified matches.
   */
  async resolveVerifiedDomain(domain: string): Promise<{ org: any; setting: any } | null> {
    const candidates = customDomainCandidates(domain);
    if (candidates.length === 0) return null;
    const org = await this.t("organization").findFirst({
      where: { customDomain: { in: candidates } },
    });
    if (!org) return null;
    const setting = await this.getSetting(org.id);
    if (!setting?.domainVerifiedAt) return null;
    return { org, setting };
  }

  async byDomain(domain: string) {
    const resolved = await this.resolveVerifiedDomain(domain);
    if (!resolved) throw new NotFoundException("ডোমেইনটি পাওয়া যায়নি");
    // Only a VERIFIED domain resolves. Enabled-state is deliberately
    // not required here: routing to a disabled shop then honestly
    // 404s at the shop routes. The returned domain is the STORED
    // value (normalised), not the caller's variant: a shop stored
    // as www.example.com answers an apex lookup with its www form.
    return {
      organizationSlug: resolved.org.slug,
      domain: normalizeCustomDomainInput(resolved.org.customDomain ?? ""),
    };
  }

  /**
   * TD10: the ask endpoint's service half — true exactly when the
   * domain (or its www/apex variant) resolves to a VERIFIED shop,
   * false for unverified / unknown / empty input. Never throws.
   */
  async domainAllowed(rawDomain: string): Promise<boolean> {
    try {
      return (await this.resolveVerifiedDomain(rawDomain)) !== null;
    } catch {
      return false;
    }
  }

  /**
   * EC30: the shop's ACTIVE pickup points for the checkout
   * picker — public outlet info only (name/address/district/
   * phone/fee). Inactive and other orgs' points never appear;
   * a missing table reads as an empty list (the picker simply
   * offers home delivery only).
   */
  async listPublicPickupPoints(orgSlug: string) {
    const { org } = await this.requireEnabledShop(orgSlug);
    let rows: any[] = [];
    try {
      const table = this.t("pickupPoint");
      if (table?.findMany) {
        rows = (await table
          .findMany({ where: { organizationId: org.id, active: true } })
          .catch(() => [])) ?? [];
      }
    } catch { rows = []; }
    const items = rows
      .map((p: any) => ({
        id: p.id,
        name: p.name,
        address: p.address,
        district: p.district,
        phone: p.phone ?? null,
        feeMinor: p.feeMinor != null ? String(p.feeMinor) : "0",
      }))
      .sort((a: any, b: any) =>
        String(a.district).localeCompare(String(b.district), "bn") ||
        String(a.name).localeCompare(String(b.name), "bn"),
      );
    return { items };
  }

  // ================= Staff: state / settings =================

  private serializeSetting(setting: any | null) {
    if (!setting) {
      return {
        exists: false,
        shopEnabled: false,
        shopName: null,
        announcementText: null,
        showFeatured: true,
        showCategories: true,
        showSearch: true,
        // OU8: section customizer defaults (all on, canonical order).
        showHero: true,
        showBrands: true,
        showBundles: true,
        showFlashSale: true,
        showRecentlyViewed: true,
        sectionOrder: null,
        metaDescription: null,
        featuredProductIds: [],
        featuredMode: "merchant_picks",
        locale: "bn",
        trackingPageEnabled: true,
        returnPolicyText: null,
        deliveryPromiseText: null,
        supportPhone: null,
        referralDiscountPercent: null,
        referralMinSubtotalMinor: null,
        affiliateEnabled: false,
        affiliateDefaultPercent: null,
        affiliateAttributionDays: 30,
        giftWrapEnabled: false,
        giftWrapFeeMinor: null,
        themeId: "classic",
        faviconUrl: null,
        whatsappNumber: null,
        messengerUrl: null,
        requireTermsConsent: false,
        termsUrl: null,
        // GB7 (GC18): tracking ids unset when no row exists.
        ga4MeasurementId: null,
        gtmContainerId: null,
        googleAdsId: null,
        googleAdsConversionLabel: null,
        searchConsoleVerification: null,
        metaPixelId: null,
        tikTokPixelId: null,
        clarityId: null,
        domainVerifiedAt: null,
        hasDomainVerifyToken: false,
        // AB8 (AX23): no setting row ⇒ no custom code.
        customCss: null,
        customJs: null,
        customJsEnabled: false,
      };
    }
    return {
      exists: true,
      id: setting.id,
      shopEnabled: !!setting.shopEnabled,
      shopName: setting.shopName ?? null,
      announcementText: setting.announcementText ?? null,
      showFeatured: setting.showFeatured !== false,
      showCategories: setting.showCategories !== false,
      showSearch: setting.showSearch !== false,
      // OU8: section customizer (absent on pre-migration rows = on).
      showHero: setting.showHero !== false,
      showBrands: setting.showBrands !== false,
      showBundles: setting.showBundles !== false,
      showFlashSale: setting.showFlashSale !== false,
      showRecentlyViewed: setting.showRecentlyViewed !== false,
      sectionOrder: Array.isArray(setting.sectionOrder) ? sanitizeSectionOrder(setting.sectionOrder) : null,
      metaDescription: setting.metaDescription ?? null,
      featuredProductIds: Array.isArray(setting.featuredProductIds)
        ? setting.featuredProductIds.map((x: any) => String(x))
        : [],
      featuredMode: setting.featuredMode ?? "merchant_picks",
      locale: setting.locale ?? "bn",
      trackingPageEnabled: setting.trackingPageEnabled !== false,
      returnPolicyText: setting.returnPolicyText ?? null,
      deliveryPromiseText: setting.deliveryPromiseText ?? null,
      supportPhone: setting.supportPhone ?? null,
      referralDiscountPercent: setting.referralDiscountPercent ?? null,
      referralMinSubtotalMinor:
        setting.referralMinSubtotalMinor != null ? String(setting.referralMinSubtotalMinor) : null,
      affiliateEnabled: setting.affiliateEnabled === true,
      affiliateDefaultPercent: setting.affiliateDefaultPercent ?? null,
      affiliateAttributionDays: setting.affiliateAttributionDays ?? 30,
      giftWrapEnabled: setting.giftWrapEnabled === true,
      giftWrapFeeMinor:
        setting.giftWrapFeeMinor != null ? String(setting.giftWrapFeeMinor) : null,
      themeId: setting.themeId ?? "classic",
      faviconUrl: setting.faviconUrl ?? null,
      whatsappNumber: setting.whatsappNumber ?? null,
      messengerUrl: setting.messengerUrl ?? null,
      requireTermsConsent: setting?.requireTermsConsent === true,
      termsUrl: setting.termsUrl ?? null,
      // GB7 (GC18): the merchant's own tracking ids (null = unset).
      ga4MeasurementId: setting.ga4MeasurementId ?? null,
      gtmContainerId: setting.gtmContainerId ?? null,
      googleAdsId: setting.googleAdsId ?? null,
      googleAdsConversionLabel: setting.googleAdsConversionLabel ?? null,
      searchConsoleVerification: setting.searchConsoleVerification ?? null,
      metaPixelId: setting.metaPixelId ?? null,
      tikTokPixelId: setting.tikTokPixelId ?? null,
      clarityId: setting.clarityId ?? null,
      domainVerifiedAt: setting.domainVerifiedAt
        ? new Date(setting.domainVerifiedAt).toISOString()
        : null,
      hasDomainVerifyToken: !!setting.domainVerifyToken,
      // AB8 (AX23): staff read their own custom code back.
      customCss: setting.customCss ?? null,
      customJs: setting.customJs ?? null,
      customJsEnabled: setting.customJsEnabled === true,
    };
  }

  // ================= EC18: delivery slots =================

  private serializeSlot(s: any) {
    return {
      id: s.id,
      label: s.label,
      startTime: s.startTime,
      endTime: s.endTime,
      districtScope: Array.isArray(s.districtScope) ? s.districtScope.map((d: any) => String(d)) : null,
      capacityPerDay: s.capacityPerDay ?? null,
      active: s.active !== false,
    };
  }

  private slotScope(slot: any): string[] {
    return Array.isArray(slot?.districtScope) ? slot.districtScope.map((d: any) => String(d)) : [];
  }

  /** Active slots applicable to a district. A null/empty scope
   * applies everywhere; a scoped slot applies only when the
   * district is known and listed. */
  async slotsForDistrict(orgId: string, district: string | null): Promise<any[]> {
    const table = this.t("deliverySlot");
    if (!table?.findMany) return [];
    const rows: any[] =
      (await table.findMany({ where: { organizationId: orgId, active: true } }).catch(() => [])) ?? [];
    return rows.filter((slot) => {
      const scope = this.slotScope(slot);
      if (scope.length === 0) return true;
      return district !== null && scope.includes(district);
    });
  }

  private dhakaTodayString(): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
  }

  private addDaysToDateString(dateStr: string, days: number): string {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d) + days * 24 * 3600 * 1000).toISOString().slice(0, 10);
  }

  /** Delivery date must be a real calendar date within
   * [today, today+7] on the Asia/Dhaka calendar. */
  private assertDeliveryDate(dateStr: string) {
    const msg = "ডেলিভারির তারিখ আজ থেকে আগামী ৭ দিনের মধ্যে হতে হবে";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr ?? ""))) {
      throw new BadRequestException(msg);
    }
    const [y, m, d] = dateStr.split("-").map(Number);
    const probe = new Date(Date.UTC(y, m - 1, d));
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
      throw new BadRequestException(msg);
    }
    const today = this.dhakaTodayString();
    if (dateStr < today || dateStr > this.addDaysToDateString(today, 7)) {
      throw new BadRequestException(msg);
    }
  }

  /**
   * Validate a shopper's slot choice for a checkout. Returns the
   * slot row or throws a Bengali BadRequest: unknown/inactive
   * slot, district outside the slot's scope, date outside
   * [today, today+7] (Asia/Dhaka), or the day's capacity full.
   */
  async validateSlotChoice(orgId: string, slotId: string, dateStr: string, district: string | null): Promise<any> {
    const table = this.t("deliverySlot");
    const slot = table?.findFirst
      ? await table.findFirst({ where: { id: slotId, organizationId: orgId } }).catch(() => null)
      : null;
    if (!slot || slot.active === false) {
      throw new BadRequestException("ডেলিভারি স্লটটি পাওয়া যায়নি বা বন্ধ আছে");
    }
    const scope = this.slotScope(slot);
    if (scope.length > 0 && (district === null || !scope.includes(district))) {
      throw new BadRequestException("এই স্লটটি আপনার এলাকার জন্য প্রযোজ্য নয়");
    }
    this.assertDeliveryDate(dateStr);
    if (slot.capacityPerDay !== null && slot.capacityPerDay !== undefined) {
      const orderTable = this.t("order");
      const count = orderTable?.count
        ? await orderTable.count({
            where: {
              organizationId: orgId, deliverySlotId: slotId, deliveryDate: dateStr,
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

  private validateSlotDistricts(districts: string[] | null | undefined): string[] | null {
    if (districts === undefined || districts === null) return null;
    const list = districts.map((d) => String(d).trim()).filter(Boolean);
    if (list.length === 0) return null;
    const invalid = list.filter((d) => !(BD_DISTRICTS as readonly string[]).includes(d));
    if (invalid.length > 0) {
      throw new BadRequestException(`অজানা জেলা: ${invalid.join(", ")}`);
    }
    return [...new Set(list)];
  }

  async createSlot(orgId: string, actorId: string, dto: CreateDeliverySlotDto) {
    const districtScope = this.validateSlotDistricts(dto.districtScope);
    const slot = await this.t("deliverySlot").create({
      data: {
        organizationId: orgId,
        label: dto.label.trim(),
        startTime: dto.startTime,
        endTime: dto.endTime,
        districtScope,
        capacityPerDay: dto.capacityPerDay ?? null,
        active: dto.active ?? true,
      },
    });
    await this.audit?.log({
      organizationId: orgId,
      userId: actorId,
      action: "storefront.slot_created",
      entityType: "DeliverySlot",
      entityId: slot.id,
      metadata: { label: slot.label },
    });
    return { slot: this.serializeSlot(slot) };
  }

  private async requireSlot(orgId: string, slotId: string): Promise<any> {
    const slot = await this.t("deliverySlot").findFirst({
      where: { id: slotId, organizationId: orgId },
    });
    if (!slot) throw new NotFoundException("Delivery slot not found in this organization");
    return slot;
  }

  async updateSlot(orgId: string, actorId: string, slotId: string, dto: UpdateDeliverySlotDto) {
    const slot = await this.requireSlot(orgId, slotId);
    const data: Record<string, any> = {};
    if (dto.label !== undefined) data.label = dto.label.trim();
    if (dto.startTime !== undefined) data.startTime = dto.startTime;
    if (dto.endTime !== undefined) data.endTime = dto.endTime;
    if (dto.districtScope !== undefined) data.districtScope = this.validateSlotDistricts(dto.districtScope);
    if (dto.capacityPerDay !== undefined) data.capacityPerDay = dto.capacityPerDay;
    if (dto.active !== undefined) data.active = dto.active;
    const saved = await this.t("deliverySlot").update({ where: { id: slot.id }, data });
    await this.audit?.log({
      organizationId: orgId,
      userId: actorId,
      action: "storefront.slot_updated",
      entityType: "DeliverySlot",
      entityId: slot.id,
      metadata: { fields: Object.keys(data) },
    });
    return { slot: this.serializeSlot(saved) };
  }

  async deleteSlot(orgId: string, actorId: string, slotId: string) {
    const slot = await this.requireSlot(orgId, slotId);
    await this.t("deliverySlot").delete({ where: { id: slot.id } });
    await this.audit?.log({
      organizationId: orgId,
      userId: actorId,
      action: "storefront.slot_deleted",
      entityType: "DeliverySlot",
      entityId: slot.id,
      metadata: { label: slot.label },
    });
    return { deleted: true, slotId: slot.id };
  }

  private serializeZone(z: any) {
    return {
      id: z.id,
      name: z.name,
      kind: z.kind,
      districts: Array.isArray(z.districts) ? z.districts.map((d: any) => String(d)) : [],
      chargeMinor: String(z.chargeMinor),
      deliveryDays: z.deliveryDays ?? null,
      freeAboveMinor: z.freeAboveMinor != null ? String(z.freeAboveMinor) : null,
      active: z.active !== false,
      position: z.position ?? 0,
    };
  }

  async staffState(orgId: string) {
    const org = await this.t("organization").findFirst({ where: { id: orgId } });
    if (!org) throw new NotFoundException("Organization not found");
    const setting = await this.getSetting(orgId);
    let zones: any[] = [];
    try {
      zones =
        (await this.t("shippingZone").findMany({
          where: { organizationId: orgId },
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        })) ?? [];
    } catch {
      zones = [];
    }
    let slots: any[] = [];
    try {
      const table = this.t("deliverySlot");
      slots = table?.findMany
        ? ((await table.findMany({
            where: { organizationId: orgId },
            orderBy: { createdAt: "asc" },
          })) ?? [])
        : [];
    } catch {
      slots = [];
    }
    // GB1: content-page counts + popup summary (null-safe —
    // a missing table reads as zero counts / default popup).
    let pages = { total: 0, published: 0 };
    try {
      const table = this.t("shopPage");
      if (table?.findMany) {
        const rows: any[] = (await table.findMany({ where: { organizationId: orgId } }).catch(() => [])) ?? [];
        pages = { total: rows.length, published: rows.filter((p: any) => p.published).length };
      }
    } catch { pages = { total: 0, published: 0 }; }
    let popup: any = null;
    try {
      popup = (await this.getPopupConfig(orgId)).popup;
    } catch { popup = null; }
    return {
      setting: this.serializeSetting(setting),
      zones: zones.map((z) => this.serializeZone(z)),
      slots: slots.map((s) => this.serializeSlot(s)),
      pages,
      popup,
      organization: { id: org.id, slug: org.slug, customDomain: org.customDomain ?? null },
      domain: {
        customDomain: org.customDomain ?? null,
        verifiedAt: setting?.domainVerifiedAt
          ? new Date(setting.domainVerifiedAt).toISOString()
          : null,
        verifyHost: org.customDomain ? `_qosprey-verify.${org.customDomain}` : null,
        // OU2: persisted CfS HTTPS state (null status = never
        // attempted for the current domain — the UI says exactly
        // that, never a default "active").
        httpsStatus: setting?.httpsStatus ?? null,
        httpsStatusDetail: setting?.httpsStatusDetail ?? null,
        httpsUpdatedAt: setting?.httpsUpdatedAt
          ? new Date(setting.httpsUpdatedAt).toISOString()
          : null,
        customHostnameId: setting?.customHostnameId ?? null,
      },
      districts: [...BD_DISTRICTS],
    };
  }

  async updateSettings(orgId: string, actorId: string, dto: UpdateStorefrontSettingsDto) {
    if (dto.featuredProductIds !== undefined) {
      if (dto.featuredProductIds.length > 50) {
        throw new BadRequestException("Featured পণ্য সর্বোচ্চ ৫০টি হতে পারবে");
      }
      for (const pid of dto.featuredProductIds) {
        const p = await this.t("product").findFirst({
          where: { id: pid, organizationId: orgId },
        });
        if (!p) {
          throw new BadRequestException(`Featured পণ্য পাওয়া যায়নি (এই সংস্থার নয়): ${pid}`);
        }
      }
    }
    const data: Record<string, any> = {};
    for (const key of [
      "shopEnabled",
      "shopName",
      "announcementText",
      "showFeatured",
      "showCategories",
      "showSearch",
      // OU8: section toggles ride the same loop; sectionOrder is
      // validated + sanitized just below (not a raw copy).
      "showHero",
      "showBrands",
      "showBundles",
      "showFlashSale",
      "showRecentlyViewed",
      "metaDescription",
      "featuredProductIds",
      "featuredMode",
      "locale",
      "trackingPageEnabled",
      "returnPolicyText",
      "deliveryPromiseText",
      "supportPhone",
      "referralDiscountPercent",
      "giftWrapEnabled",
      // EC32: affiliate program config rides the same loop.
      "affiliateEnabled",
      "affiliateDefaultPercent",
      "affiliateAttributionDays",
      // GB1 (GC1/GC4): theme + favicon + contact channels ride
      // the same loop; their shape checks run just below.
      "themeId",
      "faviconUrl",
      "whatsappNumber",
      "messengerUrl",
      // GB3 (GC8): terms consent requirement rides the same loop;
      // termsUrl is validated/normalized just below.
      "requireTermsConsent",
      "termsUrl",
    ] as const) {
      if (dto[key] !== undefined) data[key] = dto[key];
    }
    // OU8: section order — every entry must be a known section
    // key (Bengali refusal otherwise); stored deduped/sanitized.
    if (dto.sectionOrder !== undefined) {
      if (!isValidSectionOrder(dto.sectionOrder)) {
        throw new BadRequestException("সেকশনের ক্রমে অজানা সেকশন আছে — hero, categories, brands, bundles, flash, featured, recently-এর মধ্য থেকে দিন");
      }
      data.sectionOrder = sanitizeSectionOrder(dto.sectionOrder);
    }
    // GB7 (GC18): tracking ids ride OUTSIDE the generic loop —
    // each present key is shape-validated (Bengali refusal on a
    // malformed id) and stored normalized; an empty value clears
    // the field to null.
    for (const field of TRACKING_FIELDS) {
      const raw = (dto as any)[field];
      if (raw !== undefined) {
        const v = validateTrackingValue(field, raw);
        if (!v.ok) throw new BadRequestException(v.message);
        data[field] = v.value;
      }
    }
    // GB3 (GC8): termsUrl must be a real http(s) URL when set.
    if (dto.termsUrl !== undefined) {
      const v = dto.termsUrl;
      if (v !== null && String(v).trim() !== "" && !isHttpUrl(String(v).trim())) {
        throw new BadRequestException("শর্তাবলির URL সঠিক নয় — http/https দিয়ে শুরু হওয়া সম্পূর্ণ URL দিন");
      }
      data.termsUrl = v === null || String(v).trim() === "" ? null : String(v).trim();
    }
    // GB1: favicon / Messenger must be real http(s) URLs when set;
    // WhatsApp must look like a phone number when set.
    for (const key of ["faviconUrl", "messengerUrl"] as const) {
      const v = dto[key];
      if (v !== undefined && v !== null && String(v).trim() !== "" && !isHttpUrl(String(v).trim())) {
        throw new BadRequestException(
          key === "faviconUrl"
            ? "ফেভিকন URL সঠিক নয় — http/https দিয়ে শুরু হওয়া সম্পূর্ণ URL দিন"
            : "Messenger URL সঠিক নয় — http/https দিয়ে শুরু হওয়া সম্পূর্ণ URL দিন",
        );
      }
      if (v !== undefined) data[key] = v === null || String(v).trim() === "" ? null : String(v).trim();
    }
    if (dto.whatsappNumber !== undefined) {
      const v = dto.whatsappNumber;
      if (v === null || String(v).trim() === "") {
        data.whatsappNumber = null;
      } else if (!/^[+\d][\d\s-]{5,}$/.test(String(v).trim())) {
        throw new BadRequestException("WhatsApp নম্বর সঠিক নয় — দেশের কোডসহ ফোন নম্বর দিন");
      } else {
        data.whatsappNumber = String(v).trim();
      }
    }
    // EC16: the referral minimum travels as a decimal string.
    if (dto.referralMinSubtotalMinor !== undefined) {
      const raw = dto.referralMinSubtotalMinor;
      if (raw === null || raw === "") {
        data.referralMinSubtotalMinor = null;
      } else if (/^\d+$/.test(String(raw).trim())) {
        data.referralMinSubtotalMinor = BigInt(String(raw).trim());
      } else {
        throw new BadRequestException("রেফারেলের ন্যূনতম অর্ডার পরিমাণ সঠিক সংখ্যা হতে হবে");
      }
    }
    // EC29: gift-wrap config — the enabled flag rides the generic
    // loop below; the fee travels as a decimal string, mirroring
    // the referral minimum handling exactly.
    if (dto.giftWrapFeeMinor !== undefined) {
      const raw = dto.giftWrapFeeMinor;
      if (raw === null || raw === "") {
        data.giftWrapFeeMinor = null;
      } else if (/^\d+$/.test(String(raw).trim())) {
        data.giftWrapFeeMinor = BigInt(String(raw).trim());
      } else {
        throw new BadRequestException("গিফট র‍্যাপের ফি সঠিক সংখ্যা হতে হবে");
      }
    }
    // AB8 (AX23): custom CSS/JS ride OUTSIDE the generic loop —
    // length-capped (≤50,000 chars each) and breakout-checked:
    // a closing </style / </script tag (or an HTML comment opener
    // in CSS) would escape the shop layout's rendering context.
    // null (or empty) clears the field.
    if (dto.customCss !== undefined) {
      if (dto.customCss === null || dto.customCss === "") {
        data.customCss = null;
      } else {
        if (typeof dto.customCss !== "string") {
          throw new BadRequestException("কাস্টম CSS লেখা (string) হতে হবে");
        }
        if (dto.customCss.length > 50000) {
          throw new BadRequestException("কাস্টম CSS সর্বোচ্চ ৫০,০০০ অক্ষরের হতে পারবে");
        }
        const lowerCss = dto.customCss.toLowerCase();
        if (lowerCss.includes("</style") || lowerCss.includes("<!--")) {
          throw new BadRequestException("কাস্টম CSS-এ </style> বা <!-- ব্যবহার করা যাবে না");
        }
        data.customCss = dto.customCss;
      }
    }
    if (dto.customJs !== undefined) {
      if (dto.customJs === null || dto.customJs === "") {
        data.customJs = null;
      } else {
        if (typeof dto.customJs !== "string") {
          throw new BadRequestException("কাস্টম JS লেখা (string) হতে হবে");
        }
        if (dto.customJs.length > 50000) {
          throw new BadRequestException("কাস্টম JS সর্বোচ্চ ৫০,০০০ অক্ষরের হতে পারবে");
        }
        if (dto.customJs.toLowerCase().includes("</script")) {
          throw new BadRequestException("কাস্টম JS-এ </script> ব্যবহার করা যাবে না");
        }
        data.customJs = dto.customJs;
      }
    }
    if (dto.customJsEnabled !== undefined) {
      if (typeof dto.customJsEnabled !== "boolean") {
        throw new BadRequestException("customJsEnabled boolean হতে হবে");
      }
      data.customJsEnabled = dto.customJsEnabled;
    }
    const existing = await this.getSetting(orgId);
    const saved = existing
      ? await this.t("storefrontSetting").update({ where: { id: existing.id }, data })
      : await this.t("storefrontSetting").create({ data: { organizationId: orgId, ...data } });
    // AB8 (AX23): when custom code changed, the audit metadata
    // carries LENGTHS + the enabled flag ONLY (the GB3 sealed-
    // secret pattern) — code values never enter the audit body.
    const customCodeChanged =
      dto.customCss !== undefined || dto.customJs !== undefined || dto.customJsEnabled !== undefined;
    await this.audit?.log({
      organizationId: orgId,
      userId: actorId,
      action: "storefront.settings_updated",
      entityType: "StorefrontSetting",
      entityId: saved.id,
      metadata: {
        fields: Object.keys(data),
        ...(customCodeChanged
          ? {
              customCssLength: saved.customCss ? String(saved.customCss).length : 0,
              customJsLength: saved.customJs ? String(saved.customJs).length : 0,
              customJsEnabled: saved.customJsEnabled === true,
            }
          : {}),
      },
    });
    return { setting: this.serializeSetting(saved) };
  }

  // ================= GB1: content pages (GC2) =================

  private serializeShopPage(page: any) {
    return {
      id: page.id,
      slug: page.slug,
      title: page.title,
      blocks: Array.isArray(page.blocks) ? page.blocks : [],
      published: !!page.published,
      showInFooter: !!page.showInFooter,
      showInMenu: !!page.showInMenu,
      sortOrder: page.sortOrder ?? 0,
      isSystem: !!page.isSystem,
      updatedAt: page.updatedAt ? new Date(page.updatedAt).toISOString() : null,
    };
  }

  private sortPages(rows: any[]): any[] {
    return [...rows].sort((a, b) => {
      const so = Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0);
      if (so !== 0) return so;
      return new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();
    });
  }

  /** Seed the system pages that do not exist yet for this org.
   * Idempotent: existing slugs (system or merchant-made) are
   * never overwritten. */
  async ensureSystemPages(orgId: string): Promise<void> {
    const table = this.t("shopPage");
    if (!table?.findMany || !table?.create) return;
    const existing: any[] =
      (await table.findMany({ where: { organizationId: orgId } }).catch(() => [])) ?? [];
    const slugs = new Set(existing.map((p: any) => String(p.slug)));
    for (let i = 0; i < SYSTEM_PAGES.length; i++) {
      const def = SYSTEM_PAGES[i];
      if (slugs.has(def.slug)) continue;
      await table
        .create({
          data: {
            organizationId: orgId,
            slug: def.slug,
            title: def.title,
            blocks: def.blocks,
            published: false,
            showInFooter: def.showInFooter,
            showInMenu: def.showInMenu,
            sortOrder: i,
            isSystem: true,
          },
        })
        .catch(() => null);
    }
  }

  async listPages(orgId: string) {
    await this.ensureSystemPages(orgId);
    const rows: any[] =
      (await this.t("shopPage")
        .findMany({ where: { organizationId: orgId } })
        .catch(() => [])) ?? [];
    return { pages: this.sortPages(rows).map((p) => this.serializeShopPage(p)) };
  }

  async createPage(orgId: string, actorId: string, dto: CreateShopPageDto) {
    await this.ensureSystemPages(orgId);
    const title = String(dto.title ?? "").trim();
    if (!title) throw new BadRequestException("পেজের শিরোনাম দিতে হবে");
    let slug: string;
    if (dto.slug !== undefined && dto.slug !== null && String(dto.slug).trim() !== "") {
      slug = String(dto.slug).trim().toLowerCase();
    } else {
      slug = slugifyShopPageTitle(title);
    }
    if (!slug || !SHOP_PAGE_SLUG_PATTERN.test(slug)) {
      throw new BadRequestException("slug সঠিক নয় — শুধু ছোট হাতের ইংরেজি অক্ষর, সংখ্যা ও হাইফেন ব্যবহার করুন");
    }
    const existing = await this.t("shopPage").findFirst({
      where: { organizationId: orgId, slug },
    });
    if (existing) {
      throw new BadRequestException("এই slug-এ ইতিমধ্যে একটি পেজ আছে");
    }
    const blocks = validateShopPageBlocks(dto.blocks ?? []);
    const page = await this.t("shopPage").create({
      data: {
        organizationId: orgId,
        slug,
        title,
        blocks,
        published: dto.published ?? false,
        showInFooter: dto.showInFooter ?? false,
        showInMenu: dto.showInMenu ?? false,
        sortOrder: dto.sortOrder ?? 0,
        isSystem: false,
      },
    });
    await this.audit?.log({
      organizationId: orgId,
      userId: actorId,
      action: "storefront.page_created",
      entityType: "ShopPage",
      entityId: page.id,
      metadata: { slug: page.slug },
    });
    return { page: this.serializeShopPage(page) };
  }

  private async requirePage(orgId: string, pageId: string): Promise<any> {
    const page = await this.t("shopPage").findFirst({
      where: { id: pageId, organizationId: orgId },
    });
    if (!page) throw new NotFoundException("পেজটি পাওয়া যায়নি");
    return page;
  }

  async updatePage(orgId: string, actorId: string, pageId: string, dto: UpdateShopPageDto) {
    const page = await this.requirePage(orgId, pageId);
    const data: Record<string, any> = {};
    if (dto.title !== undefined) data.title = String(dto.title).trim();
    if (dto.slug !== undefined && dto.slug !== null && String(dto.slug).trim() !== "") {
      const slug = String(dto.slug).trim().toLowerCase();
      if (slug !== page.slug) {
        if (page.isSystem) {
          throw new BadRequestException("সিস্টেম পেজের slug বদলানো যায় না");
        }
        if (!SHOP_PAGE_SLUG_PATTERN.test(slug)) {
          throw new BadRequestException("slug সঠিক নয় — শুধু ছোট হাতের ইংরেজি অক্ষর, সংখ্যা ও হাইফেন ব্যবহার করুন");
        }
        const clash = await this.t("shopPage").findFirst({
          where: { organizationId: orgId, slug },
        });
        if (clash && String(clash.id) !== String(page.id)) {
          throw new BadRequestException("এই slug-এ ইতিমধ্যে একটি পেজ আছে");
        }
        data.slug = slug;
      }
    }
    if (dto.blocks !== undefined) data.blocks = validateShopPageBlocks(dto.blocks);
    if (dto.published !== undefined) data.published = dto.published;
    if (dto.showInFooter !== undefined) data.showInFooter = dto.showInFooter;
    if (dto.showInMenu !== undefined) data.showInMenu = dto.showInMenu;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    const saved = await this.t("shopPage").update({ where: { id: page.id }, data });
    await this.audit?.log({
      organizationId: orgId,
      userId: actorId,
      action: "storefront.page_updated",
      entityType: "ShopPage",
      entityId: page.id,
      metadata: { fields: Object.keys(data) },
    });
    return { page: this.serializeShopPage(saved) };
  }

  async deletePage(orgId: string, actorId: string, pageId: string) {
    const page = await this.requirePage(orgId, pageId);
    if (page.isSystem) {
      throw new BadRequestException("সিস্টেম পেজ মুছে ফেলা যায় না — প্রয়োজনে আনপাবলিশ করুন");
    }
    await this.t("shopPage").delete({ where: { id: page.id } });
    await this.audit?.log({
      organizationId: orgId,
      userId: actorId,
      action: "storefront.page_deleted",
      entityType: "ShopPage",
      entityId: page.id,
      metadata: { slug: page.slug },
    });
    return { deleted: true, pageId: page.id };
  }

  /** Published page links for the shop menu/footer (failure-isolated). */
  private async publicPageLinks(orgId: string): Promise<{ menu: Array<{ slug: string; title: string }>; footer: Array<{ slug: string; title: string }>; blog: boolean }> {
    // AB6 (AX12): blog flag — true when the shop has at least one
    // PUBLISHED blog post (failure-isolated; a missing blogPost
    // table or a read error reads as no blog).
    let blog = false;
    try {
      const blogTable = this.t("blogPost");
      if (blogTable?.findMany) {
        const brows: any[] =
          (await blogTable
            .findMany({ where: { organizationId: orgId, status: "published" }, take: 1 })
            .catch(() => [])) ?? [];
        blog = brows.length > 0;
      }
    } catch {
      blog = false;
    }
    try {
      const table = this.t("shopPage");
      if (!table?.findMany) return { menu: [], footer: [], blog };
      const rows: any[] =
        (await table.findMany({ where: { organizationId: orgId, published: true } }).catch(() => [])) ?? [];
      const sorted = this.sortPages(rows);
      const pick = (rowsIn: any[]) => rowsIn.map((p) => ({ slug: p.slug, title: p.title }));
      return {
        menu: pick(sorted.filter((p) => p.showInMenu)),
        footer: pick(sorted.filter((p) => p.showInFooter)),
        blog,
      };
    } catch {
      return { menu: [], footer: [], blog };
    }
  }

  async getPublicPage(orgSlug: string, pageSlug: string) {
    const { org, setting } = await this.requireEnabledShop(orgSlug);
    const page = await this.t("shopPage").findFirst({
      where: { organizationId: org.id, slug: pageSlug, published: true },
    });
    if (!page) throw new NotFoundException("পেজটি পাওয়া যায়নি");
    const bp = await this.businessProfile(org.id);
    const rawBlocks: any[] = Array.isArray(page.blocks) ? page.blocks : [];
    const blocks = rawBlocks.map((b: any) => {
      if (b?.type === "contact_info") {
        return {
          ...b,
          data: {
            phone: bp?.contactPhone ?? setting.supportPhone ?? null,
            email: bp?.contactEmail ?? null,
            address: bp?.address ?? null,
          },
        };
      }
      return b;
    });
    return {
      page: { slug: page.slug, title: page.title, blocks },
      settings: {
        shopName: setting.shopName || org.brandName || org.name,
        locale: setting.locale ?? "bn",
      },
    };
  }

  // ================= AB6 (AX12): blog posts =================

  /** Defensive tag parse for a stored Json value: only an
   * array of strings survives; anything else reads as []. */
  private blogTagsOf(row: any): string[] {
    return Array.isArray(row?.tags) ? row.tags.map((x: any) => String(x)) : [];
  }

  private serializeBlogPost(row: any) {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt ?? null,
      coverImageUrl: row.coverImageUrl ?? null,
      blocks: Array.isArray(row.blocks) ? row.blocks : [],
      tags: this.blogTagsOf(row),
      status: row.status,
      publishedAt: row.publishedAt ? new Date(row.publishedAt).toISOString() : null,
      seoTitle: row.seoTitle ?? null,
      seoDescription: row.seoDescription ?? null,
      authorName: row.authorName ?? null,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    };
  }

  /** Blog tags, normalized: strings trimmed, empties dropped,
   * deduped, at most 10 tags of at most 40 chars each (Bengali
   * 400 on violation). A non-array (when present) is a 400. */
  private normalizeBlogTags(raw: unknown): string[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) {
      throw new BadRequestException("ট্যাগের তালিকা সঠিক নয়");
    }
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      if (typeof item !== "string") {
        throw new BadRequestException("প্রতিটি ট্যাগ লেখা (string) হতে হবে");
      }
      const tag = item.trim();
      if (!tag) continue;
      if (tag.length > 40) {
        throw new BadRequestException("প্রতিটি ট্যাগ সর্বোচ্চ ৪০ অক্ষরের হতে পারবে");
      }
      if (seen.has(tag)) continue;
      seen.add(tag);
      out.push(tag);
    }
    if (out.length > 10) {
      throw new BadRequestException("ট্যাগ সর্বোচ্চ ১০টি দেওয়া যাবে");
    }
    return out;
  }

  async listBlogPosts(orgId: string, status?: string) {
    if (status !== undefined && status !== null && status !== "" && status !== "draft" && status !== "published") {
      throw new BadRequestException("স্ট্যাটাস সঠিক নয় — draft অথবা published হতে হবে");
    }
    const where: Record<string, any> = { organizationId: orgId };
    if (status) where.status = status;
    const rows: any[] =
      (await this.t("blogPost")
        .findMany({ where, orderBy: { updatedAt: "desc" } })
        .catch(() => [])) ?? [];
    return { posts: rows.map((r) => this.serializeBlogPost(r)) };
  }

  async createBlogPost(orgId: string, actorId: string, dto: CreateBlogPostDto) {
    const title = String(dto.title ?? "").trim();
    if (!title) throw new BadRequestException("পোস্টের শিরোনাম দিতে হবে");
    let slug: string;
    if (dto.slug !== undefined && dto.slug !== null && String(dto.slug).trim() !== "") {
      slug = String(dto.slug).trim().toLowerCase();
    } else {
      slug = slugifyShopPageTitle(title);
    }
    if (!slug || !SHOP_PAGE_SLUG_PATTERN.test(slug)) {
      throw new BadRequestException("slug সঠিক নয় — শুধু ছোট হাতের ইংরেজি অক্ষর, সংখ্যা ও হাইফেন ব্যবহার করুন");
    }
    const existing = await this.t("blogPost").findFirst({
      where: { organizationId: orgId, slug },
    });
    if (existing) {
      throw new BadRequestException("এই slug-এ ইতিমধ্যে একটি পোস্ট আছে");
    }
    const blocks = validateShopPageBlocks(dto.blocks ?? []);
    const tags = this.normalizeBlogTags(dto.tags);
    const status = dto.status === "published" ? "published" : "draft";
    const post = await this.t("blogPost").create({
      data: {
        organizationId: orgId,
        slug,
        title,
        excerpt: dto.excerpt ?? null,
        coverImageUrl: dto.coverImageUrl ?? null,
        blocks,
        tags,
        status,
        publishedAt: status === "published" ? new Date() : null,
        seoTitle: dto.seoTitle ?? null,
        seoDescription: dto.seoDescription ?? null,
        authorName: dto.authorName ?? null,
      },
    });
    await this.audit?.log({
      organizationId: orgId,
      userId: actorId,
      action: "storefront.blog_created",
      entityType: "BlogPost",
      entityId: post.id,
      metadata: { slug: post.slug },
    });
    return { post: this.serializeBlogPost(post) };
  }

  private async requireBlogPost(orgId: string, postId: string): Promise<any> {
    const post = await this.t("blogPost").findFirst({
      where: { id: postId, organizationId: orgId },
    });
    if (!post) throw new NotFoundException("ব্লগ পোস্টটি পাওয়া যায়নি");
    return post;
  }

  async updateBlogPost(orgId: string, actorId: string, postId: string, dto: UpdateBlogPostDto) {
    const post = await this.requireBlogPost(orgId, postId);
    const data: Record<string, any> = {};
    if (dto.title !== undefined) data.title = String(dto.title).trim();
    if (dto.slug !== undefined && dto.slug !== null && String(dto.slug).trim() !== "") {
      const slug = String(dto.slug).trim().toLowerCase();
      if (slug !== post.slug) {
        if (!SHOP_PAGE_SLUG_PATTERN.test(slug)) {
          throw new BadRequestException("slug সঠিক নয় — শুধু ছোট হাতের ইংরেজি অক্ষর, সংখ্যা ও হাইফেন ব্যবহার করুন");
        }
        const clash = await this.t("blogPost").findFirst({
          where: { organizationId: orgId, slug },
        });
        if (clash && String(clash.id) !== String(post.id)) {
          throw new BadRequestException("এই slug-এ ইতিমধ্যে একটি পোস্ট আছে");
        }
        data.slug = slug;
      }
    }
    if (dto.excerpt !== undefined) data.excerpt = dto.excerpt;
    if (dto.coverImageUrl !== undefined) data.coverImageUrl = dto.coverImageUrl;
    if (dto.blocks !== undefined) data.blocks = validateShopPageBlocks(dto.blocks);
    if (dto.tags !== undefined) data.tags = this.normalizeBlogTags(dto.tags);
    if (dto.seoTitle !== undefined) data.seoTitle = dto.seoTitle;
    if (dto.seoDescription !== undefined) data.seoDescription = dto.seoDescription;
    if (dto.authorName !== undefined) data.authorName = dto.authorName;
    if (dto.status !== undefined) {
      data.status = dto.status;
      if (dto.status === "published" && post.status !== "published") {
        data.publishedAt = new Date();
      }
      // Unpublishing (→ draft) keeps publishedAt unchanged: it
      // records the LAST publish time, not the current state.
    }
    const saved = await this.t("blogPost").update({ where: { id: post.id }, data });
    await this.audit?.log({
      organizationId: orgId,
      userId: actorId,
      action: "storefront.blog_updated",
      entityType: "BlogPost",
      entityId: post.id,
      metadata: { fields: Object.keys(data) },
    });
    return { post: this.serializeBlogPost(saved) };
  }

  async deleteBlogPost(orgId: string, actorId: string, postId: string) {
    const post = await this.requireBlogPost(orgId, postId);
    await this.t("blogPost").delete({ where: { id: post.id } });
    await this.audit?.log({
      organizationId: orgId,
      userId: actorId,
      action: "storefront.blog_deleted",
      entityType: "BlogPost",
      entityId: post.id,
      metadata: { slug: post.slug },
    });
    return { deleted: true, postId: post.id };
  }

  private blogEnvelope(org: any, setting: any) {
    return {
      settings: {
        shopName: setting.shopName || org.brandName || org.name,
        locale: setting.locale ?? "bn",
      },
      organization: {
        name: org.name,
        slug: org.slug,
        brandName: org.brandName ?? null,
        logoUrl: org.logoUrl ?? null,
        primaryColor: org.primaryColor ?? null,
      },
    };
  }

  async listPublicBlogPosts(orgSlug: string) {
    const { org, setting } = await this.requireEnabledShop(orgSlug);
    const rows: any[] =
      (await this.t("blogPost")
        .findMany({
          where: { organizationId: org.id, status: "published" },
          orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        })
        .catch(() => [])) ?? [];
    return {
      posts: rows.map((r) => ({
        slug: r.slug,
        title: r.title,
        excerpt: r.excerpt ?? null,
        coverImageUrl: r.coverImageUrl ?? null,
        tags: this.blogTagsOf(r),
        publishedAt: r.publishedAt ? new Date(r.publishedAt).toISOString() : null,
        authorName: r.authorName ?? null,
        updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
      })),
      ...this.blogEnvelope(org, setting),
    };
  }

  async getPublicBlogPost(orgSlug: string, postSlug: string) {
    const { org, setting } = await this.requireEnabledShop(orgSlug);
    const row = await this.t("blogPost").findFirst({
      where: { organizationId: org.id, slug: postSlug, status: "published" },
    });
    if (!row) throw new NotFoundException("ব্লগ পোস্টটি পাওয়া যায়নি");
    return {
      post: {
        slug: row.slug,
        title: row.title,
        excerpt: row.excerpt ?? null,
        coverImageUrl: row.coverImageUrl ?? null,
        blocks: Array.isArray(row.blocks) ? row.blocks : [],
        tags: this.blogTagsOf(row),
        publishedAt: row.publishedAt ? new Date(row.publishedAt).toISOString() : null,
        authorName: row.authorName ?? null,
        updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
        seo: { title: row.seoTitle ?? null, description: row.seoDescription ?? null },
      },
      ...this.blogEnvelope(org, setting),
    };
  }

  // ================= AB6 (AX11): search synonyms / analytics / reindex (staff) =================

  private serializeSynonym(row: any) {
    return {
      id: row.id,
      term: row.term,
      expansions: Array.isArray(row.expansions) ? row.expansions.map((x: any) => String(x)) : [],
    };
  }

  /** Synonym expansions, normalized: each entry normalized like
   * a search term, empties dropped, deduped, at most 10 items of
   * at most 100 chars each (Bengali 400 on violation). */
  private normalizeSynonymExpansions(raw: unknown): string[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) {
      throw new BadRequestException("সমার্থক শব্দের তালিকা সঠিক নয়");
    }
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      const e = normalizeSearchTerm(item);
      if (!e) continue;
      if (e.length > 100) {
        throw new BadRequestException("প্রতিটি সমার্থক শব্দ সর্বোচ্চ ১০০ অক্ষরের হতে পারবে");
      }
      if (seen.has(e)) continue;
      seen.add(e);
      out.push(e);
    }
    if (out.length > 10) {
      throw new BadRequestException("সমার্থক শব্দ সর্বোচ্চ ১০টি দেওয়া যাবে");
    }
    return out;
  }

  private normalizeSynonymTerm(raw: unknown): string {
    const term = normalizeSearchTerm(raw);
    if (!term) throw new BadRequestException("মূল শব্দটি দিতে হবে");
    if (term.length > 100) {
      throw new BadRequestException("মূল শব্দ সর্বোচ্চ ১০০ অক্ষরের হতে পারবে");
    }
    return term;
  }

  private async synonymRows(orgId: string): Promise<any[]> {
    const table = this.t("searchSynonym");
    if (!table?.findMany) return [];
    return (await table.findMany({ where: { organizationId: orgId } }).catch(() => [])) ?? [];
  }

  async listSynonyms(orgId: string) {
    const rows = await this.synonymRows(orgId);
    const synonyms = [...rows]
      .sort((a, b) => String(a.term).localeCompare(String(b.term)))
      .map((r) => this.serializeSynonym(r));
    return { synonyms };
  }

  async createSynonym(orgId: string, actorId: string, dto: CreateSearchSynonymDto) {
    const term = this.normalizeSynonymTerm(dto.term);
    const expansions = this.normalizeSynonymExpansions(dto.expansions);
    const existing = await this.synonymRows(orgId);
    if (existing.some((r: any) => String(r.term) === term)) {
      throw new BadRequestException("এই শব্দের জন্য ইতিমধ্যে সমার্থক শব্দ আছে");
    }
    const row = await this.t("searchSynonym").create({
      data: { organizationId: orgId, term, expansions },
    });
    await this.audit?.log({
      organizationId: orgId,
      userId: actorId,
      action: "storefront.synonym_created",
      entityType: "SearchSynonym",
      entityId: row.id,
      metadata: { term },
    });
    return { synonym: this.serializeSynonym(row) };
  }

  private async requireSynonym(orgId: string, synonymId: string): Promise<any> {
    const row = await this.t("searchSynonym").findFirst({
      where: { id: synonymId, organizationId: orgId },
    });
    if (!row) throw new NotFoundException("সমার্থক শব্দটি পাওয়া যায়নি");
    return row;
  }

  async updateSynonym(orgId: string, actorId: string, synonymId: string, dto: UpdateSearchSynonymDto) {
    const existing = await this.requireSynonym(orgId, synonymId);
    const data: Record<string, any> = {};
    if (dto.term !== undefined) {
      const term = this.normalizeSynonymTerm(dto.term);
      if (term !== String(existing.term)) {
        const rows = await this.synonymRows(orgId);
        if (rows.some((r: any) => String(r.id) !== String(existing.id) && String(r.term) === term)) {
          throw new BadRequestException("এই শব্দের জন্য ইতিমধ্যে সমার্থক শব্দ আছে");
        }
      }
      data.term = term;
    }
    if (dto.expansions !== undefined) {
      data.expansions = this.normalizeSynonymExpansions(dto.expansions);
    }
    const saved = await this.t("searchSynonym").update({ where: { id: existing.id }, data });
    await this.audit?.log({
      organizationId: orgId,
      userId: actorId,
      action: "storefront.synonym_updated",
      entityType: "SearchSynonym",
      entityId: existing.id,
      metadata: { fields: Object.keys(data) },
    });
    return { synonym: this.serializeSynonym(saved) };
  }

  async deleteSynonym(orgId: string, actorId: string, synonymId: string) {
    const existing = await this.requireSynonym(orgId, synonymId);
    await this.t("searchSynonym").delete({ where: { id: existing.id } });
    await this.audit?.log({
      organizationId: orgId,
      userId: actorId,
      action: "storefront.synonym_deleted",
      entityType: "SearchSynonym",
      entityId: existing.id,
      metadata: { term: existing.term },
    });
    return { deleted: true };
  }

  /**
   * Search analytics over the last 30 days of SearchQueryLog:
   * top terms by search count, and the zero-result terms (rows
   * whose search-stage outcome was 0) ranked the same way.
   */
  async searchAnalytics(orgId: string) {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    let rows: any[] = [];
    try {
      const table = this.t("searchQueryLog");
      if (table?.findMany) {
        rows =
          (await table
            .findMany({
              where: { organizationId: orgId, createdAt: { gte: since } },
              orderBy: { createdAt: "desc" },
              take: 5000,
            })
            .catch(() => [])) ?? [];
      }
    } catch {
      rows = [];
    }
    const counts = new Map<string, number>();
    const zeroCounts = new Map<string, number>();
    for (const r of rows) {
      const term = String(r.term ?? "");
      if (!term) continue;
      counts.set(term, (counts.get(term) ?? 0) + 1);
      if (Number(r.resultsCount) === 0) {
        zeroCounts.set(term, (zeroCounts.get(term) ?? 0) + 1);
      }
    }
    const rank = (m: Map<string, number>) =>
      [...m.entries()]
        .map(([term, count]) => ({ term, count }))
        .sort((a, b) => (b.count - a.count) || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
        .slice(0, 20);
    return {
      windowDays: 30,
      totalSearches: rows.length,
      topTerms: rank(counts),
      zeroResultTerms: rank(zeroCounts),
    };
  }

  /** Rebuild every product search vector of the org (raw SQL). */
  async reindexSearch(orgId: string, actorId: string) {
    const updated = await refreshOrgSearchVectors(this.prisma, orgId);
    await this.audit?.log({
      organizationId: orgId,
      userId: actorId,
      action: "storefront.search_reindexed",
      entityType: "Organization",
      entityId: orgId,
      metadata: { updated },
    });
    return { updated };
  }

  // ================= GB1: popup (GC3) =================

  private serializePopup(row: any | null) {
    if (!row) {
      return {
        enabled: false,
        title: null,
        body: null,
        imageUrl: null,
        ctaText: null,
        ctaUrl: null,
        trigger: "delay_seconds",
        delaySeconds: 5,
        scrollPercent: 50,
        frequencyDays: 7,
        startsAt: null,
        endsAt: null,
        showOn: "home",
        impressions: 0,
        clicks: 0,
        mode: "promo",
        captureName: true,
        capturePhone: true,
        captureEmail: false,
        successMessage: null,
        captures: 0,
      };
    }
    return {
      id: row.id,
      enabled: !!row.enabled,
      title: row.title ?? null,
      body: row.body ?? null,
      imageUrl: row.imageUrl ?? null,
      ctaText: row.ctaText ?? null,
      ctaUrl: row.ctaUrl ?? null,
      trigger: row.trigger ?? "delay_seconds",
      delaySeconds: row.delaySeconds ?? 5,
      scrollPercent: row.scrollPercent ?? 50,
      frequencyDays: row.frequencyDays ?? 7,
      startsAt: row.startsAt ? new Date(row.startsAt).toISOString() : null,
      endsAt: row.endsAt ? new Date(row.endsAt).toISOString() : null,
      showOn: row.showOn ?? "home",
      impressions: row.impressions ?? 0,
      clicks: row.clicks ?? 0,
      mode: row.mode ?? "promo",
      captureName: row.captureName !== false,
      capturePhone: row.capturePhone !== false,
      captureEmail: row.captureEmail === true,
      successMessage: row.successMessage ?? null,
      captures: row.captures ?? 0,
    };
  }

  private async popupRow(orgId: string): Promise<any | null> {
    try {
      const table = this.t("storePopup");
      if (!table?.findFirst) return null;
      return (await table.findFirst({ where: { organizationId: orgId } }).catch(() => null)) ?? null;
    } catch {
      return null;
    }
  }

  async getPopupConfig(orgId: string) {
    const row = await this.popupRow(orgId);
    return { popup: this.serializePopup(row) };
  }

  async upsertPopup(orgId: string, actorId: string, dto: UpsertStorePopupDto) {
    const existing = await this.popupRow(orgId);
    const data: Record<string, any> = {};
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.title !== undefined) data.title = dto.title === null ? null : String(dto.title).trim() || null;
    if (dto.body !== undefined) data.body = dto.body === null ? null : String(dto.body) || null;
    if (dto.ctaText !== undefined) data.ctaText = dto.ctaText === null ? null : String(dto.ctaText).trim() || null;
    for (const key of ["imageUrl", "ctaUrl"] as const) {
      if (dto[key] !== undefined) {
        const v = dto[key];
        if (v === null || String(v).trim() === "") {
          data[key] = null;
        } else if (!isHttpUrl(String(v).trim())) {
          throw new BadRequestException(
            key === "imageUrl"
              ? "পপআপের ছবির URL সঠিক নয় — http/https দিয়ে শুরু হওয়া সম্পূর্ণ URL দিন"
              : "পপআপের বাটনের URL সঠিক নয় — http/https দিয়ে শুরু হওয়া সম্পূর্ণ URL দিন",
          );
        } else {
          data[key] = String(v).trim();
        }
      }
    }
    if (dto.trigger !== undefined) data.trigger = dto.trigger;
    if (dto.delaySeconds !== undefined) data.delaySeconds = dto.delaySeconds;
    if (dto.scrollPercent !== undefined) data.scrollPercent = dto.scrollPercent;
    if (dto.frequencyDays !== undefined) data.frequencyDays = dto.frequencyDays;
    if (dto.showOn !== undefined) data.showOn = dto.showOn;
    // OU8: lead-capture mode fields.
    if (dto.mode !== undefined) data.mode = dto.mode;
    if (dto.captureName !== undefined) data.captureName = dto.captureName;
    if (dto.capturePhone !== undefined) data.capturePhone = dto.capturePhone;
    if (dto.captureEmail !== undefined) data.captureEmail = dto.captureEmail;
    if (dto.successMessage !== undefined) data.successMessage = dto.successMessage === null ? null : String(dto.successMessage).trim() || null;
    const parseWhen = (v: string | null | undefined, label: string): Date | null => {
      if (v === null || v === undefined || String(v).trim() === "") return null;
      const d = new Date(String(v));
      if (Number.isNaN(d.getTime())) throw new BadRequestException(`${label} সঠিক তারিখ নয়`);
      return d;
    };
    if (dto.startsAt !== undefined) data.startsAt = parseWhen(dto.startsAt, "শুরুর সময়");
    if (dto.endsAt !== undefined) data.endsAt = parseWhen(dto.endsAt, "শেষের সময়");
    const effStarts: Date | null =
      data.startsAt !== undefined ? data.startsAt : existing?.startsAt ? new Date(existing.startsAt) : null;
    const effEnds: Date | null =
      data.endsAt !== undefined ? data.endsAt : existing?.endsAt ? new Date(existing.endsAt) : null;
    if (effStarts && effEnds && effEnds.getTime() <= effStarts.getTime()) {
      throw new BadRequestException("পপআপের শেষের সময় শুরুর সময়ের পরে হতে হবে");
    }
    // OU8: a lead-mode popup that captures nothing is a fake form.
    const effMode = data.mode !== undefined ? data.mode : existing?.mode ?? "promo";
    if (effMode === "lead") {
      const effName = data.captureName !== undefined ? data.captureName : existing?.captureName !== false;
      const effPhone = data.capturePhone !== undefined ? data.capturePhone : existing?.capturePhone !== false;
      const effEmail = data.captureEmail !== undefined ? data.captureEmail : existing?.captureEmail === true;
      if (!effName && !effPhone && !effEmail) {
        throw new BadRequestException("লিড পপআপে অন্তত একটি তথ্য (নাম, ফোন বা ইমেইল) নেওয়ার অপশন চালু রাখতে হবে");
      }
    }
    const saved = existing
      ? await this.t("storePopup").update({ where: { id: existing.id }, data })
      : await this.t("storePopup").create({ data: { organizationId: orgId, ...data } });
    await this.audit?.log({
      organizationId: orgId,
      userId: actorId,
      action: "storefront.popup_updated",
      entityType: "StorePopup",
      entityId: saved.id,
      metadata: { fields: Object.keys(data) },
    });
    return { popup: this.serializePopup(saved) };
  }

  async getPublicPopup(orgSlug: string) {
    const { org } = await this.requireEnabledShop(orgSlug);
    const row = await this.popupRow(org.id);
    if (!row || !row.enabled) return { popup: null };
    const now = Date.now();
    if (row.startsAt && new Date(row.startsAt).getTime() > now) return { popup: null };
    if (row.endsAt && new Date(row.endsAt).getTime() < now) return { popup: null };
    return {
      popup: {
        title: row.title ?? null,
        body: row.body ?? null,
        imageUrl: row.imageUrl ?? null,
        ctaText: row.ctaText ?? null,
        ctaUrl: row.ctaUrl ?? null,
        trigger: row.trigger ?? "delay_seconds",
        delaySeconds: row.delaySeconds ?? 5,
        scrollPercent: row.scrollPercent ?? 50,
        frequencyDays: row.frequencyDays ?? 7,
        showOn: row.showOn ?? "home",
        // OU8: lead-capture shape (present in both modes; the
        // client renders the form only when mode === "lead").
        mode: row.mode ?? "promo",
        captureName: row.captureName !== false,
        capturePhone: row.capturePhone !== false,
        captureEmail: row.captureEmail === true,
        successMessage: row.successMessage ?? null,
      },
    };
  }

  /** Fire-and-forget popup counter: ALWAYS { ok: true } — a
   * disabled shop, a missing popup or a failed increment must
   * never surface as an error to a shopper. */
  async recordPopupEvent(orgSlug: string, kind: string) {
    try {
      const { org } = await this.requireEnabledShop(orgSlug);
      const row = await this.popupRow(org.id);
      if (row) {
        const field = kind === "click" ? "clicks" : "impressions";
        await this.t("storePopup")
          .update({ where: { id: row.id }, data: { [field]: { increment: 1 } } })
          .catch(() => null);
      }
    } catch { /* swallowed by design */ }
    return { ok: true };
  }

  /**
   * OU8: lead-capture popup submission. Creates a REAL Lead row
   * through the same table the CRM uses (source "website", stage
   * "new" — the LeadsService.create vocabulary) plus its "created"
   * LeadActivity, and increments the popup's captures counter —
   * the counter therefore counts real Lead creations only, never
   * impressions. Required fields follow the popup's capture flags;
   * a name is synthesised from phone/email when name capture is
   * off (Lead.name is non-nullable).
   */
  async submitPopupLead(orgSlug: string, dto: PopupLeadDto) {
    const { org } = await this.requireEnabledShop(orgSlug);
    const row = await this.popupRow(org.id);
    if (!row || !row.enabled || (row.mode ?? "promo") !== "lead") {
      throw new BadRequestException("এই দোকানে লিড পপআপ চালু নেই");
    }
    const now = Date.now();
    if (row.startsAt && new Date(row.startsAt).getTime() > now) throw new BadRequestException("এই দোকানে লিড পপআপ চালু নেই");
    if (row.endsAt && new Date(row.endsAt).getTime() < now) throw new BadRequestException("এই দোকানে লিড পপআপ চালু নেই");
    const name = String(dto.name ?? "").trim();
    const phone = String(dto.phone ?? "").trim();
    const email = String(dto.email ?? "").trim();
    if (row.captureName !== false && !name) throw new BadRequestException("আপনার নামটি দিন");
    if (row.capturePhone !== false && phone.length < 6) throw new BadRequestException("সঠিক ফোন নম্বর দিন");
    if (row.captureEmail === true && !email) throw new BadRequestException("আপনার ইমেইলটি দিন");
    if (!name && !phone && !email) throw new BadRequestException("অন্তত একটি তথ্য দিন");
    const lead = await this.t("lead").create({
      data: {
        organizationId: org.id,
        name: name || phone || email,
        phone: phone || null,
        email: email || null,
        source: "website",
        stage: "new",
        notes: "দোকানের লিড পপআপ থেকে এসেছে",
      },
    });
    await this.t("leadActivity")
      .create({ data: { leadId: lead.id, userId: null, type: "created", content: "দোকানের লিড পপআপ থেকে তৈরি" } })
      .catch(() => null);
    await this.t("storePopup")
      .update({ where: { id: row.id }, data: { captures: { increment: 1 } } })
      .catch(() => null);
    return { ok: true, leadId: lead.id, successMessage: row.successMessage ?? null };
  }

  // ================= GB1: contact form (GC2) =================

  async submitContactMessage(orgSlug: string, dto: ContactMessageDto) {
    const { org } = await this.requireEnabledShop(orgSlug);
    const name = String(dto.name ?? "").trim();
    const phone = String(dto.phone ?? "").trim();
    const message = String(dto.message ?? "").trim();

    // Staff notifications to ACTIVE OWNER/ADMIN members.
    let notified = 0;
    try {
      const memberships: any[] =
        (await this.t("membership")
          .findMany({ where: { organizationId: org.id, status: "ACTIVE" } })
          .catch(() => [])) ?? [];
      const recipients = [
        ...new Set(
          memberships
            .filter((m: any) => ["OWNER", "ADMIN"].includes(String(m.role)))
            .map((m: any) => String(m.userId)),
        ),
      ];
      const body = `${phone}: ${message}`.slice(0, 500);
      for (const userId of recipients) {
        const made = await createAgentNotification(this.prisma as any, {
              organizationId: org.id,
              userId,
              type: "mention",
              title: `নতুন যোগাযোগ বার্তা — ${name}`,
              body,
              conversationId: null,
            })
          .catch(() => null);
        if (made) notified++;
      }
    } catch { notified = 0; }

    // Email to the business profile's contact address, when an
    // EmailProvider is wired AND the profile has an address.
    let emailed = false;
    const bp = await this.businessProfile(org.id);
    if (bp?.contactEmail && this.email) {
      try {
        await this.email.send({
          to: String(bp.contactEmail),
          subject: `ওয়েবসাইট থেকে নতুন বার্তা — ${name}`,
          text: `নাম: ${name}\nফোন: ${phone}\n\n${message}`,
        });
        emailed = true;
      } catch { emailed = false; }
    }

    const parts: string[] = [];
    if (notified >= 1) parts.push("agent_notification");
    if (emailed) parts.push("email");
    const deliveredVia = parts.length > 0 ? parts.join("+") : "stored_only";
    await this.t("shopContactMessage").create({
      data: { organizationId: org.id, name, phone, message, deliveredVia },
    });
    return { ok: true, deliveredVia };
  }

  // ================= Staff: zones =================

  private validateZoneDistricts(kind: string, districts: string[] | null | undefined): string[] | null {
    if (kind !== "district_list") return null;
    const list = (districts ?? []).map((d) => String(d).trim()).filter(Boolean);
    if (list.length === 0) {
      throw new BadRequestException("district_list জোনের জন্য অন্তত একটি জেলা বেছে নিন");
    }
    const invalid = list.filter((d) => !(BD_DISTRICTS as readonly string[]).includes(d));
    if (invalid.length > 0) {
      throw new BadRequestException(`অজানা জেলা: ${invalid.join(", ")}`);
    }
    return [...new Set(list)];
  }

  async createZone(orgId: string, actorId: string, dto: CreateZoneDto) {
    const charge = parseMinorField(dto.chargeMinor, "chargeMinor");
    const freeAbove =
      dto.freeAboveMinor === undefined ? null : parseMinorField(dto.freeAboveMinor, "freeAboveMinor");
    const districts = this.validateZoneDistricts(dto.kind, dto.districts);
    const zone = await this.t("shippingZone").create({
      data: {
        organizationId: orgId,
        name: dto.name.trim(),
        kind: dto.kind,
        districts,
        chargeMinor: charge,
        deliveryDays: dto.deliveryDays ?? null,
        freeAboveMinor: freeAbove,
        active: dto.active ?? true,
        position: dto.position ?? 0,
      },
    });
    await this.audit?.log({
      organizationId: orgId,
      userId: actorId,
      action: "storefront.zone_created",
      entityType: "ShippingZone",
      entityId: zone.id,
      metadata: { kind: zone.kind, name: zone.name },
    });
    return { zone: this.serializeZone(zone) };
  }

  private async requireZone(orgId: string, zoneId: string): Promise<any> {
    const zone = await this.t("shippingZone").findFirst({
      where: { id: zoneId, organizationId: orgId },
    });
    if (!zone) throw new NotFoundException("শিপিং জোন পাওয়া যায়নি");
    return zone;
  }

  async updateZone(orgId: string, actorId: string, zoneId: string, dto: UpdateZoneDto) {
    const zone = await this.requireZone(orgId, zoneId);
    const data: Record<string, any> = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.chargeMinor !== undefined) data.chargeMinor = parseMinorField(dto.chargeMinor, "chargeMinor");
    if (dto.deliveryDays !== undefined) data.deliveryDays = dto.deliveryDays;
    if (dto.freeAboveMinor !== undefined) {
      data.freeAboveMinor = parseMinorField(dto.freeAboveMinor, "freeAboveMinor");
    }
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.position !== undefined) data.position = dto.position;
    const kind = data.kind ?? zone.kind;
    if (dto.districts !== undefined || data.kind !== undefined) {
      data.districts = this.validateZoneDistricts(
        kind,
        dto.districts !== undefined ? dto.districts : (zone.districts as string[] | null),
      );
    }
    const saved = await this.t("shippingZone").update({ where: { id: zone.id }, data });
    await this.audit?.log({
      organizationId: orgId,
      userId: actorId,
      action: "storefront.zone_updated",
      entityType: "ShippingZone",
      entityId: zone.id,
      metadata: { fields: Object.keys(data) },
    });
    return { zone: this.serializeZone(saved) };
  }

  async deleteZone(orgId: string, actorId: string, zoneId: string) {
    const zone = await this.requireZone(orgId, zoneId);
    await this.t("shippingZone").delete({ where: { id: zone.id } });
    await this.audit?.log({
      organizationId: orgId,
      userId: actorId,
      action: "storefront.zone_deleted",
      entityType: "ShippingZone",
      entityId: zone.id,
      metadata: { kind: zone.kind, name: zone.name },
    });
    return { deleted: true, zoneId: zone.id };
  }

  /**
   * Seed the two standard zones from the BusinessProfile delivery
   * charges. Creates only the kinds that do not exist yet — running
   * it twice never duplicates.
   */
  async createDefaultZones(orgId: string, actorId: string) {
    const bp = await this.businessProfile(orgId);
    if (!bp?.deliveryChargeInsideMinor || !bp?.deliveryChargeOutsideMinor) {
      throw new BadRequestException(
        "আগে Business Profile-এ ঢাকার ভিতরে ও বাইরের ডেলিভারি চার্জ সেট করুন, তারপর ডিফল্ট জোন তৈরি করুন",
      );
    }
    const existing =
      (await this.t("shippingZone").findMany({ where: { organizationId: orgId } })) ?? [];
    const kinds = new Set(existing.map((z: any) => z.kind));
    const created: any[] = [];
    const specs = [
      {
        kind: "inside_dhaka",
        name: "ঢাকার ভিতরে",
        chargeMinor: BigInt(bp.deliveryChargeInsideMinor),
        deliveryDays: bp.deliveryDaysInside ?? null,
        position: 1,
      },
      {
        kind: "outside_dhaka",
        name: "ঢাকার বাইরে",
        chargeMinor: BigInt(bp.deliveryChargeOutsideMinor),
        deliveryDays: bp.deliveryDaysOutside ?? null,
        position: 2,
      },
    ];
    for (const spec of specs) {
      if (kinds.has(spec.kind)) continue;
      const zone = await this.t("shippingZone").create({
        data: {
          organizationId: orgId,
          name: spec.name,
          kind: spec.kind,
          districts: null,
          chargeMinor: spec.chargeMinor,
          deliveryDays: spec.deliveryDays,
          freeAboveMinor: bp.freeDeliveryAboveMinor != null ? BigInt(bp.freeDeliveryAboveMinor) : null,
          active: true,
          position: spec.position,
        },
      });
      created.push(zone);
    }
    await this.audit?.log({
      organizationId: orgId,
      userId: actorId,
      action: "storefront.zones_defaults_created",
      entityType: "ShippingZone",
      metadata: { createdKinds: created.map((z) => z.kind) },
    });
    const all =
      (await this.t("shippingZone").findMany({
        where: { organizationId: orgId },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      })) ?? [];
    return {
      created: created.map((z) => this.serializeZone(z)),
      zones: all.map((z: any) => this.serializeZone(z)),
    };
  }

  // ================= Staff: custom domain =================

  private normalizeDomain(raw: string): string {
    return normalizeCustomDomainInput(raw);
  }

  /**
   * TD9: the storefront-owned write path for Organization.
   * customDomain — the ONLY one that resets verification on
   * change. (The branding path in OrganizationsService predates
   * this and now applies the same reset; see TD9 there.)
   *
   * Rules, mirroring the branding path's messages where they
   * overlap:
   *  - raw null/empty REMOVES the domain.
   *  - Format must match the branding regex exactly.
   *  - The platform's own domain / any platform subdomain is
   *    refused (PLATFORM_CUSTOM_DOMAIN_MESSAGE, shared wording).
   *  - Another org holding the domain OR its www/apex variant is
   *    a Conflict.
   *  - A real CHANGE (old normalised value ≠ new value, removal
   *    included) resets the StorefrontSetting's verify token +
   *    verifiedAt: the old domain's proof must never carry over
   *    to a new domain. Re-setting the SAME value resets nothing.
   */
  async setCustomDomain(orgId: string, actorId: string, raw: string | null) {
    const org = await this.t("organization").findFirst({ where: { id: orgId } });
    if (!org) throw new NotFoundException("Organization not found");
    const previousDomain = org.customDomain
      ? normalizeCustomDomainInput(org.customDomain) || null
      : null;

    let domain: string | null = null;
    const normalized = normalizeCustomDomainInput(raw ?? "");
    if (normalized !== "") {
      if (!/^(?=.{4,253}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/.test(normalized)) {
        throw new BadRequestException(
          "ডোমেইনটি সঠিক ফরম্যাটে লিখুন (যেমন reports.youragency.com) — প্রোটোকল বা পাথ ছাড়া",
        );
      }
      if (isPlatformHostedDomain(normalized)) {
        throw new BadRequestException(PLATFORM_CUSTOM_DOMAIN_MESSAGE);
      }
      const taken = await this.t("organization").findFirst({
        where: {
          customDomain: { in: customDomainCandidates(normalized) },
          NOT: { id: orgId },
        },
      });
      if (taken) {
        throw new ConflictException("এই ডোমেইনটি অন্য একটি Organization ইতিমধ্যে সংরক্ষণ করেছে");
      }
      domain = normalized;
    }

    const changed = previousDomain !== domain;
    const verificationReset = changed;
    await this.t("organization").update({
      where: { id: orgId },
      data: { customDomain: domain },
    });
    if (changed) {
      const setting = await this.getSetting(orgId);
      if (setting) {
        await this.t("storefrontSetting").update({
          where: { id: setting.id },
          // OU2: a domain change also clears the OLD domain's CfS
          // hostname + HTTPS state — it must never carry over.
          data: { domainVerifyToken: null, domainVerifiedAt: null, customHostnameId: null, httpsStatus: null, httpsStatusDetail: null, httpsUpdatedAt: null },
        });
      }
    }
    await this.audit?.log({
      organizationId: orgId,
      userId: actorId,
      action: domain === null ? "storefront.custom_domain_removed" : "storefront.custom_domain_set",
      entityType: "Organization",
      entityId: orgId,
      metadata: { domain, previousDomain, verificationReset },
    });
    return { domain, previousDomain, verificationReset };
  }

  async issueDomainVerifyToken(orgId: string, actorId: string) {
    const org = await this.t("organization").findFirst({ where: { id: orgId } });
    if (!org) throw new NotFoundException("Organization not found");
    const domain = org.customDomain ? this.normalizeDomain(org.customDomain) : "";
    if (!domain) {
      throw new BadRequestException(
        "আগে সংস্থার ব্র্যান্ডিং/সেটিংসে Custom Domain সেট করুন, তারপর যাচাই টোকেন নিন",
      );
    }
    const token = randomBytes(32).toString("hex");
    const existing = await this.getSetting(orgId);
    // Issuing a NEW token resets verification: the old proof no
    // longer vouches for the domain until the new token is seen.
    // OU2: the HTTPS state resets with it — the certificate state
    // was earned under the old proof and is re-earned on the next
    // successful verification.
    const data = { domainVerifyToken: token, domainVerifiedAt: null, customHostnameId: null, httpsStatus: null, httpsStatusDetail: null, httpsUpdatedAt: null };
    const saved = existing
      ? await this.t("storefrontSetting").update({ where: { id: existing.id }, data })
      : await this.t("storefrontSetting").create({ data: { organizationId: orgId, ...data } });
    await this.audit?.log({
      organizationId: orgId,
      userId: actorId,
      action: "storefront.domain_verify_token_issued",
      entityType: "StorefrontSetting",
      entityId: saved.id,
      metadata: { domain },
    });
    return {
      domain,
      recordHost: `_qosprey-verify.${domain}`,
      recordType: "TXT",
      recordValue: token,
      token,
    };
  }

  // ================= OU2: Cloudflare for SaaS HTTPS =================

  /** OU2: the operator's CfS config, snapshot-fresh (google-sso
   * precedent: ensurePlatformConfig + the effective resolver).
   * Null = NOT configured (absent / disabled / half-filled) —
   * callers must then persist not_configured and NEVER call the
   * adapter or claim HTTPS is active. */
  private async cfsConfig() {
    await ensurePlatformConfig(this.prisma as any).catch(() => undefined);
    return effectiveCloudflareSaasConfig();
  }

  /**
   * OU2: provision / refresh the verified domain's HTTPS state via
   * the ONE CfS adapter and persist the REAL outcome on the
   * setting row. This method NEVER throws for adapter failures —
   * a provider failure is persisted as status "failed" with the
   * provider's words in the detail, so a domain verification that
   * already succeeded is never rolled back by a certificate
   * problem. (A persistence failure itself still propagates —
   * the verifyDomain caller isolates that; see there.)
   */
  async provisionDomainHttps(setting: any, domain: string) {
    const now = new Date();
    const cfg = await this.cfsConfig();
    if (!cfg) {
      const detail =
        "প্ল্যাটফর্মে Cloudflare for SaaS configure/চালু করা নেই — এই ডোমেইনের জন্য HTTPS সার্টিফিকেট provisioning হয়নি। ডোমেইন যাচাই সফল, কিন্তু সার্টিফিকেটের জন্য প্ল্যাটফর্ম অপারেটরের CfS সেটআপ বাকি আছে।";
      await this.t("storefrontSetting").update({
        where: { id: setting.id },
        data: { customHostnameId: null, httpsStatus: "not_configured", httpsStatusDetail: detail, httpsUpdatedAt: now },
      });
      return { httpsStatus: "not_configured" as DomainHttpsStatus, httpsStatusDetail: detail, customHostnameId: null as string | null, httpsUpdatedAt: now.toISOString() };
    }
    try {
      const client = new CloudflareForSaasClient();
      let record = setting.customHostnameId
        ? await client.getCustomHostname(cfg, setting.customHostnameId).catch(() => null)
        : null;
      if (!record || record.hostname !== domain) {
        record = await client.createCustomHostname(cfg, domain);
      }
      const mapped = mapHttpsStatus(record);
      const detail = httpsStatusDetail(record, mapped);
      await this.t("storefrontSetting").update({
        where: { id: setting.id },
        data: { customHostnameId: record.id, httpsStatus: mapped, httpsStatusDetail: detail, httpsUpdatedAt: now },
      });
      return { httpsStatus: mapped as DomainHttpsStatus, httpsStatusDetail: detail, customHostnameId: record.id as string | null, httpsUpdatedAt: now.toISOString() };
    } catch (e) {
      const detail = `Cloudflare custom hostname তৈরি/পড়া ব্যর্থ হয়েছে: ${errMsg(e)}`.slice(0, 900);
      await this.t("storefrontSetting").update({
        where: { id: setting.id },
        data: { httpsStatus: "failed", httpsStatusDetail: detail, httpsUpdatedAt: now },
      });
      return { httpsStatus: "failed" as DomainHttpsStatus, httpsStatusDetail: detail, customHostnameId: (setting.customHostnameId ?? null) as string | null, httpsUpdatedAt: now.toISOString() };
    }
  }

  /** OU2: manual HTTPS status refresh (staff button). Same
   * provisioning path as the verification hook — no webhooks, no
   * polling; the state changes only when a human asks or a domain
   * is (re-)verified. Requires a VERIFIED domain, like
   * checkDomainRouting. */
  async refreshDomainHttps(orgId: string, actorId: string) {
    const org = await this.t("organization").findFirst({ where: { id: orgId } });
    if (!org) throw new NotFoundException("Organization not found");
    const domain = org.customDomain ? this.normalizeDomain(org.customDomain) : "";
    if (!domain) {
      throw new BadRequestException("এই সংস্থার কোনো Custom Domain সেট করা নেই");
    }
    const setting = await this.getSetting(orgId);
    if (!setting?.domainVerifiedAt) {
      throw new BadRequestException("আগে ডোমেইনটি যাচাই করুন, তারপর HTTPS অবস্থা refresh করুন");
    }
    const out = await this.provisionDomainHttps(setting, domain);
    await this.audit?.log({
      organizationId: orgId,
      userId: actorId,
      action: "storefront.domain_https_refreshed",
      entityType: "StorefrontSetting",
      entityId: setting.id,
      metadata: { domain, httpsStatus: out.httpsStatus, customHostnameId: out.customHostnameId },
    });
    return { domain, ...out };
  }

  async verifyDomain(orgId: string, actorId: string) {
    const org = await this.t("organization").findFirst({ where: { id: orgId } });
    if (!org) throw new NotFoundException("Organization not found");
    const domain = org.customDomain ? this.normalizeDomain(org.customDomain) : "";
    if (!domain) {
      throw new BadRequestException("এই সংস্থার কোনো Custom Domain সেট করা নেই");
    }
    const setting = await this.getSetting(orgId);
    if (!setting?.domainVerifyToken) {
      throw new BadRequestException("আগে যাচাই টোকেন তৈরি করুন এবং DNS-এ TXT রেকর্ড যোগ করুন");
    }
    if (!this.dnsResolver) {
      throw new BadRequestException("DNS যাচাই এই deployment-এ নেই");
    }
    const host = `_qosprey-verify.${domain}`;
    let found: string[] = [];
    try {
      found = await this.dnsResolver.resolveTxt(host);
    } catch (e: any) {
      const code = e?.code ?? "";
      if (code === "ENODATA" || code === "ENOTFOUND") {
        found = [];
      } else {
        throw new BadRequestException(`DNS lookup ব্যর্থ হয়েছে: ${errMsg(e)}`);
      }
    }
    if (!found.includes(setting.domainVerifyToken)) {
      throw new BadRequestException(
        found.length > 0
          ? `TXT রেকর্ডে যাচাই টোকেন মেলেনি। পাওয়া গেছে: ${found.join(" | ")}`
          : "কোনো TXT রেকর্ড পাওয়া যায়নি — রেকর্ড যোগ করে DNS propagate হওয়া পর্যন্ত অপেক্ষা করুন",
      );
    }
    const saved = await this.t("storefrontSetting").update({
      where: { id: setting.id },
      data: { domainVerifiedAt: new Date() },
    });
    await this.audit?.log({
      organizationId: orgId,
      userId: actorId,
      action: "storefront.domain_verified",
      entityType: "StorefrontSetting",
      entityId: saved.id,
      metadata: { domain, host },
    });
    // OU2 hook — the TXT verification above has SUCCEEDED and is
    // already persisted; HTTPS provisioning runs strictly after
    // it and is failure-isolated: an adapter failure records
    // httpsStatus "failed" (inside provisionDomainHttps), and
    // even a hook/persistence error is only logged — verification
    // NEVER rolls back because of a certificate problem.
    let https: Awaited<ReturnType<StorefrontService["provisionDomainHttps"]>> | null = null;
    try {
      https = await this.provisionDomainHttps(saved, domain);
    } catch (e) {
      this.logger.warn(`OU2 CfS provisioning hook failed for org ${orgId} domain ${domain}: ${errMsg(e)}`);
    }
    return {
      verified: true,
      domain,
      verifiedAt: new Date(saved.domainVerifiedAt).toISOString(),
      httpsStatus: https?.httpsStatus ?? null,
      httpsStatusDetail: https?.httpsStatusDetail ?? null,
    };
  }

  /**
   * Diagnostic only: fetch the domain over HTTP(S) and report
   * whether it actually serves THIS shop (the response must carry
   * the shop path / name marker). A failure is reported as
   * routingActive: false with the reason — never thrown, never
   * reported as success without evidence.
   */
  async checkDomainRouting(orgId: string) {
    const org = await this.t("organization").findFirst({ where: { id: orgId } });
    if (!org) throw new NotFoundException("Organization not found");
    const domain = org.customDomain ? this.normalizeDomain(org.customDomain) : "";
    const setting = await this.getSetting(orgId);
    if (!domain || !setting?.domainVerifiedAt) {
      throw new BadRequestException("আগে ডোমেইনটি যাচাই করুন, তারপর routing পরীক্ষা করুন");
    }
    if (!this.routingFetcher) {
      return { routingActive: false, checkedUrl: null, reason: "HTTP পরীক্ষার সুবিধা এই deployment-এ নেই" };
    }
    const shopName = setting.shopName || org.brandName || org.name;
    const markers = [`/shop/${org.slug}`, String(shopName)];
    let lastError = "";
    for (const scheme of ["https", "http"]) {
      const url = `${scheme}://${domain}/shop/${org.slug}`;
      try {
        const res = await this.routingFetcher.fetchText(url);
        const hit = markers.some((m) => m && res.body.includes(m));
        if (res.status >= 200 && res.status < 400 && hit) {
          return {
            routingActive: true,
            checkedUrl: url,
            status: res.status,
            finalUrl: res.finalUrl,
            evidence: `প্রতিক্রিয়ায় এই দোকানের চিহ্ন পাওয়া গেছে (${markers.find((m) => res.body.includes(m))})`,
          };
        }
        lastError = `HTTP ${res.status}${hit ? "" : " — প্রতিক্রিয়ায় এই দোকানের কোনো চিহ্ন পাওয়া যায়নি"}`;
      } catch (e) {
        lastError = errMsg(e);
      }
    }
    return {
      routingActive: false,
      checkedUrl: `https://${domain}/shop/${org.slug}`,
      reason: lastError || "ডোমেইন থেকে কোনো প্রতিক্রিয়া পাওয়া যায়নি",
    };
  }
}
