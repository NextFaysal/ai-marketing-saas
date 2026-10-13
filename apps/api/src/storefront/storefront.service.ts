import {
  BadRequestException,
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
import { StorefrontDnsResolver, StorefrontRoutingFetcher } from "./storefront-dns";
import type {
  CartContactDto,
  CheckoutDto,
  CreateZoneDto,
  PatchCartLineDto,
  QuoteDto,
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
      compareAtMinor: product.compareAtMinor != null ? String(product.compareAtMinor) : null,
      currency: product.currency ?? "BDT",
      imageUrl: gallery[0] ?? null,
      images: gallery,
      stockQuantity: this.effectiveStock(product, variants),
      stockState: stockStateOf(this.effectiveStock(product, variants), product.lowStockThreshold),
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
  private async activeProducts(orgId: string, q?: string): Promise<any[]> {
    const where: any = { organizationId: orgId, status: "ACTIVE" };
    if (q?.trim()) {
      const needle = q.trim();
      where.OR = [
        { name: { contains: needle, mode: "insensitive" } },
        { description: { contains: needle, mode: "insensitive" } },
        { sku: { contains: needle, mode: "insensitive" } },
        { category: { contains: needle, mode: "insensitive" } },
      ];
    }
    const rows = await this.t("product").findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PRODUCT_SCAN_CAP,
    });
    return rows ?? [];
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

  // ================= Public: shop home / product detail =================

  async shopHome(orgSlug: string, query: { q?: string; category?: string; page?: number; pageSize?: number }) {
    const { org, setting } = await this.requireEnabledShop(orgSlug);
    const bp = await this.businessProfile(org.id);
    const categoryRows = await this.categoryRows(org.id);
    const all = await this.activeProducts(org.id, query.q);
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
    let featured: any[] = [];
    if (setting.showFeatured !== false) {
      const ids: string[] = Array.isArray(setting.featuredProductIds)
        ? setting.featuredProductIds.map((x: any) => String(x))
        : [];
      if (ids.length > 0) {
        const byId = new Map(all.map((p) => [String(p.id), p]));
        featured = ids.map((id) => byId.get(id)).filter(Boolean).slice(0, 8);
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
      featuredProducts: await serializeList(featured),
      products: await serializeList(pageRows),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async productDetail(orgSlug: string, productSlug: string) {
    const { org } = await this.requireEnabledShop(orgSlug);
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

    return {
      product: {
        ...serialized,
        category: { ...category, legacy: product.category ?? null },
        seo: { title: product.seoTitle ?? null, description: product.seoDescription ?? null },
      },
      related,
    };
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
    return {
      id: cart.id,
      status: cart.status,
      email: cart.email ?? null,
      phone: cart.phone ?? null,
      items: out,
      updatedAt: cart.updatedAt instanceof Date ? cart.updatedAt.toISOString() : cart.updatedAt,
    };
  }

  async getCart(orgSlug: string, token: string | undefined) {
    const { org } = await this.requireEnabledShop(orgSlug);
    const cart = await this.requireCart(org.id, token);
    return { cart: await this.serializeCart(cart) };
  }

  /** Tracked-stock guard: variant stock wins when a variant is chosen. */
  private assertStock(product: any, variant: any | null, quantity: number) {
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
  async computeQuote(orgId: string, cart: any, district: string, couponCode?: string) {
    const items = await this.cartItems(cart.id);
    if (items.length === 0) throw new BadRequestException("কার্ট খালি — আগে পণ্য যোগ করুন");

    const lines: any[] = [];
    let itemsSubtotal = 0n;
    let bumpMinor = 0n;
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
      const unit = variant?.priceMinor != null ? BigInt(variant.priceMinor) : BigInt(product.priceMinor);
      const lineTotal = unit * BigInt(item.quantity);
      itemsSubtotal += lineTotal;
      const hasBump = !!item.includeBump && product.bumpPriceMinor != null && !!product.bumpTitle;
      if (hasBump) bumpMinor += BigInt(product.bumpPriceMinor);
      lines.push({ item, product, variant, unitPriceMinor: unit, lineTotalMinor: lineTotal, hasBump });
    }

    const subtotal = itemsSubtotal + bumpMinor;

    let discountMinor = 0n;
    let freeShipping = false;
    let appliedDiscountId: string | null = null;
    let appliedCode: string | null = null;
    if (couponCode?.trim()) {
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

    const zone = await this.matchZone(orgId, district);
    if (!zone) {
      throw new BadRequestException(
        "এই এলাকায় ডেলিভারি সেট করা নেই — অন্য জেলা বেছে নিন অথবা দোকানে যোগাযোগ করুন",
      );
    }
    let deliveryMinor = BigInt(zone.chargeMinor ?? 0);
    const discountedSubtotal = subtotal - discountMinor;
    if (zone.freeAboveMinor != null && discountedSubtotal >= BigInt(zone.freeAboveMinor)) {
      deliveryMinor = 0n;
    }
    if (freeShipping) deliveryMinor = 0n;

    const total = subtotal - discountMinor + deliveryMinor;
    return {
      lines,
      zone,
      itemsSubtotalMinor: itemsSubtotal,
      bumpMinor,
      subtotalMinor: subtotal,
      discountMinor,
      deliveryMinor,
      totalMinor: total,
      freeShippingApplied: freeShipping,
      appliedDiscountId,
      appliedCode,
    };
  }

  private serializeQuote(q: any, district: string) {
    return {
      district,
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
      })),
      itemsSubtotalMinor: q.itemsSubtotalMinor.toString(),
      bumpMinor: q.bumpMinor.toString(),
      subtotalMinor: q.subtotalMinor.toString(),
      discountMinor: q.discountMinor.toString(),
      deliveryMinor: q.deliveryMinor.toString(),
      totalMinor: q.totalMinor.toString(),
      codDueMinor: q.totalMinor.toString(),
      coupon: q.appliedCode ? { code: q.appliedCode, freeShipping: q.freeShippingApplied } : null,
      currency: "BDT",
    };
  }

  async quote(orgSlug: string, dto: QuoteDto) {
    const { org } = await this.requireEnabledShop(orgSlug);
    const cart = await this.requireCart(org.id, dto.cartToken);
    this.requireOpenCart(cart);
    const q = await this.computeQuote(org.id, cart, dto.district.trim(), dto.couponCode);
    return this.serializeQuote(q, dto.district.trim());
  }

  async checkout(orgSlug: string, dto: CheckoutDto) {
    const { org, setting } = await this.requireEnabledShop(orgSlug);
    const cart = await this.requireCart(org.id, dto.cartToken);
    this.requireOpenCart(cart);
    if (!this.integrations) {
      throw new BadRequestException("অর্ডার নেওয়ার সুবিধা এই deployment-এ নেই");
    }
    const district = dto.district.trim();
    const q = await this.computeQuote(org.id, cart, district, dto.couponCode);

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

    const externalId = `native-${randomUUID()}`;
    const externalNumber = `ORD-${Date.now().toString().slice(-6)}-${randomBytes(2).toString("hex").toUpperCase()}`;
    const cleanPhone = dto.phone.trim();
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
        taxMinor: 0n,
        totalMinor: q.totalMinor,
        refundedMinor: 0n,
        placedAt: new Date(),
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
    } catch {
      orderId = null;
    }

    return {
      success: true,
      orderId,
      orderNumber: externalNumber,
      externalId,
      shopName: setting.shopName || org.brandName || org.name,
      paymentMethod,
      paymentClaimStatus: isCod ? "cod_due" : "advance_unverified",
      itemsSubtotalMinor: q.itemsSubtotalMinor.toString(),
      bumpMinor: q.bumpMinor.toString(),
      subtotalMinor: q.subtotalMinor.toString(),
      discountMinor: q.discountMinor.toString(),
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

  // ================= Public: by-domain =================

  async byDomain(domain: string) {
    const normalized = String(domain ?? "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "");
    if (!normalized) throw new NotFoundException("ডোমেইনটি পাওয়া যায়নি");
    const org = await this.t("organization").findFirst({ where: { customDomain: normalized } });
    if (!org) throw new NotFoundException("ডোমেইনটি পাওয়া যায়নি");
    const setting = await this.getSetting(org.id);
    // Only a VERIFIED domain resolves. Enabled-state is deliberately
    // not required here: routing to a disabled shop then honestly
    // 404s at the shop routes.
    if (!setting?.domainVerifiedAt) throw new NotFoundException("ডোমেইনটি পাওয়া যায়নি");
    return { organizationSlug: org.slug, domain: normalized };
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
      domainVerifiedAt: setting.domainVerifiedAt
        ? new Date(setting.domainVerifiedAt).toISOString()
        : null,
      hasDomainVerifyToken: !!setting.domainVerifyToken,
    };
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
    return {
      setting: this.serializeSetting(setting),
      zones: zones.map((z) => this.serializeZone(z)),
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
    ] as const) {
      if (dto[key] !== undefined) data[key] = dto[key];
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
    return String(raw ?? "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "");
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
