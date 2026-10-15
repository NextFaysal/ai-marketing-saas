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
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { DiscountsService } from "../commerce/discounts.service";
import { DISCOUNT_REASON_MESSAGES } from "../commerce/discounts";
import { PromotionsService, type CheckoutEvaluation } from "../commerce/promotions.service";
import { BundlesService } from "../commerce/bundles.service";
import { allocateBundle } from "../commerce/ec29-bundles";
import { phoneKeyLoose, type PromotionLine } from "../commerce/promotions";
import { isSoldOrder, rankBoughtTogether } from "./ec27-discovery";
import { DeliveryPricingService, cartWeightOf } from "./delivery-pricing.service";
import { AffiliatesService } from "../affiliates/affiliates.service";
import { BlockedPhoneService } from "../fraud/blocked-phone.service";
import { hashShopSecret } from "./shop-auth.util";
import { StorefrontDnsResolver, StorefrontRoutingFetcher } from "./storefront-dns";
import { assertPreorderLimit, preorderInfo, selectWholesaleTier } from "../commerce/ec24";
import { StorageService } from "../storage/storage.service";
import {
  PLATFORM_CUSTOM_DOMAIN_MESSAGE,
  customDomainCandidates,
  isPlatformHostedDomain,
  normalizeCustomDomainInput,
} from "../common/custom-domain";
import type {
  CartContactDto,
  CheckoutDto,
  CreateDeliverySlotDto,
  CreateZoneDto,
  PatchCartBundleDto,
  PatchCartLineDto,
  QuoteDto,
  TrackLookupDto,
  UpdateDeliverySlotDto,
  UpdateStorefrontSettingsDto,
  UpdateZoneDto,
} from "./storefront.dto";

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
    // RB6/RM9: presigned digital downloads. LAST param + Optional,
    // same discipline; absent (or local storage mode) keeps the
    // EC24b merchant-hosted reveal exactly as before.
    @Optional() private readonly storage?: StorageService,
  ) {}

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

  private async businessProfile(orgId: string): Promise<any | null> {
    try {
      return await this.t("businessProfile").findFirst({ where: { organizationId: orgId } });
    } catch {
      return null;
    }
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

  private serializeProduct(product: any, variants: any[], images?: any[]) {
    const gallery: string[] = [];
    if (product.imageUrl) gallery.push(product.imageUrl);
    for (const img of images ?? []) {
      if (img?.url && !gallery.includes(img.url)) gallery.push(img.url);
    }
    return {
      id: product.id,
      name: product.name,
      slug: product.slug ?? null,
      description: product.description ?? null,
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
      // EC24a: public pre-order info (null when not preorder).
      preorder: preorderInfo(product),
      // EC24b: ONLY the flag — digitalFileUrl is never serialized publicly.
      digital: !!product.digital,
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

  // ================= Public: shop home / product detail =================

  async shopHome(orgSlug: string, query: { q?: string; category?: string; page?: number; pageSize?: number }) {
    const { org, setting } = await this.requireEnabledShop(orgSlug);
    const bp = await this.businessProfile(org.id);
    const categoryRows = await this.categoryRows(org.id);
    const scanned = await this.activeProducts(org.id);
    const all = query.q?.trim()
      ? scanned.filter((p) => this.matchesSearch(p, query.q!, categoryRows))
      : scanned;
    const categories = this.buildCategories(categoryRows, all);

    let filtered = all;
    if (query.category) {
      filtered = all.filter((p) => this.matchesCategory(p, String(query.category), categoryRows));
    }
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
      for (const p of rows) out.push(this.serializeProduct(p, await this.variantsOf(p.id)));
      return out;
    };

    return {
      settings: {
        shopName: setting.shopName || org.brandName || org.name,
        announcementText: setting.announcementText ?? null,
        showFeatured: setting.showFeatured !== false,
        showCategories: setting.showCategories !== false,
        showSearch: setting.showSearch !== false,
        metaDescription: setting.metaDescription ?? null,
        locale: setting.locale ?? "bn",
        featuredMode: setting.featuredMode ?? "merchant_picks",
        trackingPageEnabled: setting.trackingPageEnabled !== false,
        returnPolicyText: setting.returnPolicyText ?? null,
        deliveryPromiseText: setting.deliveryPromiseText ?? null,
        supportPhone: setting.supportPhone ?? null,
      },
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        brandName: org.brandName ?? null,
        logoUrl: org.logoUrl ?? null,
        primaryColor: org.primaryColor ?? null,
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
      // EC29: public bundles (failure-isolated — a bundle problem
      // must never break the shop home).
      bundles: this.bundles
        ? await this.bundles.publicBundles(org.id).catch(() => [])
        : [],
      featuredProducts: await serializeList(featured),
      products: await serializeList(pageRows),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async productDetail(orgSlug: string, productSlug: string) {
    const { org, setting } = await this.requireEnabledShop(orgSlug);
    const product = await this.t("product").findFirst({
      where: { organizationId: org.id, slug: productSlug, status: "ACTIVE" },
    });
    if (!product) throw new NotFoundException("পণ্যটি পাওয়া যায়নি");
    const variants = await this.variantsOf(product.id);
    const images = await this.imagesOf(product.id);
    const serialized = this.serializeProduct(product, variants, images);

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
    for (const p of relatedRows) related.push(this.serializeProduct(p, await this.variantsOf(p.id)));

    // EC27: bought-together from real sold orders (failure-isolated).
    const boughtTogether = await this.boughtTogether(org.id, product, siblings).catch(() => []);

    return {
      product: {
        ...serialized,
        category: { ...category, legacy: product.category ?? null },
        seo: { title: product.seoTitle ?? null, description: product.seoDescription ?? null },
      },
      related,
      boughtTogether,
      // EC19: shop language + trust copy for the product page.
      settings: {
        locale: setting.locale ?? "bn",
        trackingPageEnabled: setting.trackingPageEnabled !== false,
        returnPolicyText: setting.returnPolicyText ?? null,
        deliveryPromiseText: setting.deliveryPromiseText ?? null,
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
  private async boughtTogether(orgId: string, product: any, active: any[]): Promise<any[]> {
    const orderTable = this.t("order");
    if (!orderTable?.findMany) return [];
    const since = new Date(Date.now() - 180 * 24 * 3600 * 1000);
    const orders: any[] =
      (await orderTable.findMany({ where: { organizationId: orgId, isPractice: false } }).catch(() => [])) ?? [];
    const inWindow = orders.filter((o) => {
      const d = new Date(o.placedAt ?? o.createdAt ?? 0);
      return !Number.isNaN(d.getTime()) && d.getTime() >= since.getTime();
    });
    if (inWindow.length === 0) return [];

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
    if (sold.length === 0) return [];

    const itemTable = this.t("orderItem");
    if (!itemTable?.findMany) return [];
    const items: any[] =
      (await itemTable.findMany({ where: { orderId: { in: sold.map((o) => o.id) } } }).catch(() => [])) ?? [];
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
      if (p) out.push(this.serializeProduct(p, await this.variantsOf(p.id)));
    }
    return out;
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
        productName: product?.name ?? null,
        variantName: variant?.name ?? null,
        imageUrl: product?.imageUrl ?? null,
        quantity: item.quantity,
        includeBump: !!item.includeBump,
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
      if (live && this.bundles) {
        const comps = await this.bundles.resolveComponents(cart.organizationId, live).catch(() => []);
        components = comps.map((c: any) => ({
          productId: c.productId,
          name: c.name,
          variantSku: c.variantSku,
          qty: c.qty,
        }));
      } else if (live) {
        const stored: any[] = Array.isArray(live.items) ? live.items : [];
        components = stored.map((i: any) => ({
          productId: i.productId,
          name: null,
          variantSku: i.variantSku ?? null,
          qty: Number(i.qty ?? 0),
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

    const table = this.t("storeCartBundle");
    const existing = await table
      .findFirst({ where: { cartId: cart.id, bundleId: bundle.id } })
      .catch(() => null);
    if (dto.quantity === 0) {
      if (existing) await table.delete({ where: { id: existing.id } });
    } else if (existing) {
      await table.update({ where: { id: existing.id }, data: { quantity: dto.quantity } });
    } else {
      await table.create({
        data: { cartId: cart.id, bundleId: bundle.id, quantity: dto.quantity },
      });
    }
    const fresh = await this.t("storeCart").update({
      where: { id: cart.id },
      data: { updatedAt: new Date() },
    });
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
   * decrement stock). */
  private assertStock(product: any, variant: any | null, quantity: number) {
    if (product?.preorderEnabled) return;
    const stock = variant ? variant.stockQuantity : product.stockQuantity;
    if (stock !== null && stock !== undefined && quantity > Number(stock)) {
      throw new BadRequestException(
        `দুঃখিত, "${product.name}"-এর স্টকে মাত্র ${stock}টি আছে — এর বেশি অর্ডার করা যাবে না`,
      );
    }
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

    if (dto.quantity === 0) {
      if (existing) await this.t("storeCartItem").delete({ where: { id: existing.id } });
    } else {
      this.assertStock(product, variant, dto.quantity);
      if (existing) {
        await this.t("storeCartItem").update({
          where: { id: existing.id },
          data: {
            quantity: dto.quantity,
            ...(dto.includeBump !== undefined ? { includeBump: dto.includeBump } : {}),
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
          },
        });
      }
    }
    // Touch the cart so abandoned-cart ageing follows real activity.
    const fresh = await this.t("storeCart").update({
      where: { id: cart.id },
      data: { updatedAt: new Date() },
    });
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
    ctx: { weightGrams: number | null; discountedSubtotal: bigint },
  ): Promise<{ deliveryMinor: bigint; rateRuleId: string | null; zoneFreeShipping: boolean }> {
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
    ec16?: { referralCode?: string | null; buyerPhone?: string | null; wholesaleCustomer?: any },
    opts?: { giftWrap?: boolean; deliveryMethod?: string; pickupPointId?: string },
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
      this.assertStock(product, variant, item.quantity);
      // EC24a: preorder open-unit limit (no-op for normal products).
      await assertPreorderLimit(this.prisma, orgId, product, item.quantity);
      let unit = variant?.priceMinor != null ? BigInt(variant.priceMinor) : BigInt(product.priceMinor);
      // EC24d: a qualifying tier REPLACES the line's unit price
      // entirely (regular AND sale/variant price) BEFORE the
      // promotions evaluator runs — promotions apply on top.
      if (ec16?.wholesaleCustomer?.isWholesale) {
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
        const comps = await this.bundles.resolveComponents(orgId, bundle);
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
          this.assertStock(product, variant, comp.qty * bundleQty);
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
      });
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
      });
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
    const cartWeight = cartWeightOf(
      lines.map((l) => ({ product: l.product, quantity: l.item.quantity })),
    );
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
    return {
      lines,
      zone,
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
      appliedDiscountId,
      appliedCode,
      ec16: ec16Evaluation,
      // EC24d: wholesale snapshot for the order stamp + response.
      wholesaleBreakdown,
      wholesaleApplied: wholesaleBreakdown.length > 0,
      promotionDiscountMinor: ec16Evaluation?.promotionDiscountMinor ?? 0n,
      promotionsApplied: ec16Evaluation?.promotionsApplied ?? [],
      referralDiscountMinor: ec16Evaluation?.referralDiscountMinor ?? 0n,
      referralAppliedCode: ec16Evaluation?.referral?.code ?? null,
    };
  }

  private serializeQuote(q: any, district: string, deliverySlots: any[] = []) {
    return {
      district,
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
        name: l.product.name,
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
      currency: "BDT",
    };
  }

  async quote(orgSlug: string, dto: QuoteDto) {
    const { org } = await this.requireEnabledShop(orgSlug);
    const cart = await this.requireCart(org.id, dto.cartToken);
    this.requireOpenCart(cart);
    const q = await this.computeQuote(org.id, cart, dto.district.trim(), dto.couponCode, {
      referralCode: dto.referralCode ?? null,
      buyerPhone: dto.buyerPhone ?? null,
    }, { giftWrap: dto.giftWrap, deliveryMethod: dto.deliveryMethod, pickupPointId: dto.pickupPointId });
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

  async checkout(orgSlug: string, dto: CheckoutDto, sessionToken?: string | null) {
    const { org, setting } = await this.requireEnabledShop(orgSlug);
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
    }, { giftWrap: dto.giftWrap, deliveryMethod: dto.deliveryMethod, pickupPointId: dto.pickupPointId });

    // EC18: a chosen slot is validated (scope / date / capacity)
    // BEFORE any order is written — a refusal means no order.
    let chosenSlot: any = null;
    if (dto.deliverySlotId || dto.deliveryDate) {
      if (!dto.deliverySlotId || !dto.deliveryDate) {
        throw new BadRequestException("স্লট বেছে নিলে তারিখও দিতে হবে");
      }
      chosenSlot = await this.validateSlotChoice(org.id, dto.deliverySlotId, dto.deliveryDate, district);
    }

    const paymentMethod = dto.paymentMethod ?? "cod";
    const isCod = paymentMethod === "cod";
    const advanceClaim = dto.advanceNote?.trim() || dto.paymentNote?.trim() || "";
    const noteParts: string[] = [];
    if (dto.note?.trim()) noteParts.push(dto.note.trim());
    if (!isCod && advanceClaim) {
      // Recorded verbatim as an UNVERIFIED claim — never as payment.
      noteParts.push(`[অযাচাইকৃত advance দাবি — ${paymentMethod}] ${advanceClaim}`);
    } else if (!isCod) {
      noteParts.push(`[${paymentMethod} — কাস্টমার ম্যানুয়াল পেমেন্ট বেছে নিয়েছেন; পেমেন্ট যাচাই হয়নি]`);
    }
    noteParts.push(`জেলা: ${district}`);

    const items: any[] = [];
    for (const l of q.lines) {
      items.push({
        name: l.product.name,
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
          name: placement.product.name,
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

    // The order exists now: convert the cart so a second checkout
    // attempt on the same token is refused, then redeem the coupon
    // (redeem failure must not fail a placed order — log only,
    // exactly like the single-product checkout).
    await this.t("storeCart").update({
      where: { id: cart.id },
      data: { status: "converted", updatedAt: new Date() },
    });
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
    } catch {
      orderId = orderId ?? null;
    }

    // EC16: the buyer's OWN referral code to share (additive,
    // failure-isolated; null when it cannot be resolved).
    const yourReferralCode = this.promotions
      ? await this.promotions.yourReferralCodeForPhone(org.id, cleanPhone)
      : null;

    return {
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
      paymentClaimStatus: isCod ? "cod_due" : "advance_unverified",
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
   */
  async digitalAccess(orgSlug: string, dto: TrackLookupDto) {
    const { order } = await this.matchTrackedOrder(orgSlug, dto);
    const lines = await this.digitalLinesOf(order);
    if (!lines.length) {
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
    try {
      await this.t("order").update({
        where: { id: order.id },
        data: { digitalAccessCount: used + 1, digitalLastAccessedAt: new Date() },
      });
    } catch { /* bookkeeping must not withhold an earned link */ }
    return {
      links: lines
        .map((l) => ({ productName: l.product.name, url: this.digitalDownloadUrl(l.product) }))
        .filter((l): l is { productName: any; url: string } => !!l.url),
    };
  }

  /** RB6/RM9: the download URL for ONE digital line, resolved
   * only here — after every EC24b gate above has passed (order +
   * phone match, delivery, access cap; the cap counter increments
   * before this runs, exactly as for merchant-hosted links). An
   * R2-hosted file (digitalStorageKey) wins and yields a 300s
   * presigned GET from the PRIVATE bucket — the brief's "302
   * redirect to presigned" realised at the reveal layer: this
   * endpoint has never proxied bytes, it reveals URLs, and the
   * revealed URL is now short-lived and unguessable instead of a
   * permanent merchant link. Without object storage (or in local
   * mode) the merchant-hosted URL is revealed exactly as EC24b
   * did; a product with neither yields no link. */
  private digitalDownloadUrl(product: any): string | null {
    const key = product?.digitalStorageKey ? String(product.digitalStorageKey) : "";
    if (key && this.storage && this.storage.mode === "s3") {
      const url = this.storage.signedGetUrl("private", key, 300);
      if (url) return url;
    }
    return product?.digitalFileUrl ? String(product.digitalFileUrl) : null;
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

    return {
      orderNumber: order.externalNumber ?? order.externalId,
      placedAt: iso(order.placedAt),
      status: order.status,
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
        domainVerifiedAt: null,
        hasDomainVerifyToken: false,
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
      domainVerifiedAt: setting.domainVerifiedAt
        ? new Date(setting.domainVerifiedAt).toISOString()
        : null,
      hasDomainVerifyToken: !!setting.domainVerifyToken,
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
    return {
      setting: this.serializeSetting(setting),
      zones: zones.map((z) => this.serializeZone(z)),
      slots: slots.map((s) => this.serializeSlot(s)),
      organization: { id: org.id, slug: org.slug, customDomain: org.customDomain ?? null },
      domain: {
        customDomain: org.customDomain ?? null,
        verifiedAt: setting?.domainVerifiedAt
          ? new Date(setting.domainVerifiedAt).toISOString()
          : null,
        verifyHost: org.customDomain ? `_qosprey-verify.${org.customDomain}` : null,
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
    ] as const) {
      if (dto[key] !== undefined) data[key] = dto[key];
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
    const existing = await this.getSetting(orgId);
    const saved = existing
      ? await this.t("storefrontSetting").update({ where: { id: existing.id }, data })
      : await this.t("storefrontSetting").create({ data: { organizationId: orgId, ...data } });
    await this.audit?.log({
      organizationId: orgId,
      userId: actorId,
      action: "storefront.settings_updated",
      entityType: "StorefrontSetting",
      entityId: saved.id,
      metadata: { fields: Object.keys(data) },
    });
    return { setting: this.serializeSetting(saved) };
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
          data: { domainVerifyToken: null, domainVerifiedAt: null },
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
    const data = { domainVerifyToken: token, domainVerifiedAt: null };
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
    return {
      verified: true,
      domain,
      verifiedAt: new Date(saved.domainVerifiedAt).toISOString(),
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
