import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { InventoryService } from "../inventory/inventory.service";
import { CreateProductDto, UpdateProductDto, CreateVariantDto, UpdateVariantDto, SetCostDto } from "./products.dto";
import { parseMoneyToMinor } from "@repo/contracts";
import { computeMargin } from "./pricing";
import { REVENUE_EXCLUDED_STATUSES } from "../analytics/analytics.service";
import { classifyShipmentStatus } from "../courier/courier-performance";
import { dhakaDayStartUtc } from "../crm/lead-followups";

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

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

import { IntegrationsService } from "../integrations/integrations.service";
import { PublicCheckoutOrderDto } from "./products.dto";
import { randomUUID } from "node:crypto";

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly inventory?: InventoryService,
    // Owner series: public checkout ingestion flows orders through
    // IntegrationsService.upsertOrder. Optional so positional spec
    // constructions keep working; the Nest module always provides it.
    @Optional() private readonly integrations?: IntegrationsService,
  ) {}

  async create(organizationId: string, actorId: string, dto: CreateProductDto) {
    if (dto.sku) {
      const dup = await (this.prisma as any).product.findUnique({
        where: { organizationId_sku: { organizationId, sku: dto.sku } },
      });
      if (dup) throw new ConflictException(`A product with SKU ${dto.sku} already exists in this organization`);
    }

    const baseSlug = slugify(dto.name) || `prod-${Date.now().toString(36)}`;
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    const slug = `${baseSlug}-${randomSuffix}`;

    const product = await (this.prisma as any).product.create({
      data: {
        organizationId,
        name: dto.name.trim(),
        slug,
        description: dto.description, category: dto.category, sku: dto.sku || null,
        status: dto.status ?? "ACTIVE",
        priceMinor: parseMoney(dto.price, "price"),
        compareAtMinor: dto.compareAtPrice ? parseMoney(dto.compareAtPrice, "compareAtPrice") : null,
        currency: dto.currency ?? "BDT",
        stockQuantity: dto.stockQuantity, lowStockThreshold: dto.lowStockThreshold,
        imageUrl: dto.imageUrl || null,
        bumpTitle: dto.bumpTitle?.trim() || null,
        bumpPriceMinor: dto.bumpPrice ? parseMoney(dto.bumpPrice, "bumpPrice") : null,
        bumpImageUrl: dto.bumpImageUrl?.trim() || null,
        source: "manual",
      },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "product.create", entityType: "Product", entityId: product.id });
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
    return {
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
        insideDhakaFee: bp?.insideDhakaFeeMinor ? (Number(bp.insideDhakaFeeMinor) / 100).toString() : "60",
        outsideDhakaFee: bp?.outsideDhakaFeeMinor ? (Number(bp.outsideDhakaFeeMinor) / 100).toString() : "120",
        codAvailable: bp?.codAvailable !== false,
        bkashNumber: bp?.bkashNumber || null,
        nagadNumber: bp?.nagadNumber || null,
        paymentNote: bp?.paymentNote || null,
        metaPixelId: bp?.metaPixelId || null,
        tikTokPixelId: bp?.tikTokPixelId || null,
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
    const unitPriceMinor = BigInt(p.priceMinor);
    let subtotal = unitPriceMinor * BigInt(qty);

    const bp = p.organization?.businessProfile;
    const isOutside = dto.deliveryZone === "outside_dhaka";
    const shippingMinor = isOutside
      ? (bp?.outsideDhakaFeeMinor ?? 12000n)
      : (bp?.insideDhakaFeeMinor ?? 6000n);

    // Check if customer accepted 1-Click Order Bump Upsell
    const items = [
      {
        name: p.name,
        sku: p.sku || undefined,
        quantity: qty,
        priceMinor: unitPriceMinor,
        totalMinor: subtotal,
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

    const total = subtotal + BigInt(shippingMinor);
    const externalId = `checkout-${randomUUID()}`;
    const cleanPhone = dto.customerPhone.trim();

    if (!this.integrations) {
      throw new InternalServerErrorException("Checkout ordering is unavailable (integrations service missing)");
    }
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
        shippingMinor: BigInt(shippingMinor),
        discountMinor: 0n,
        taxMinor: 0n,
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

    // Stock: NO manual decrement here (merge integration fix).
    // upsertOrder's S1 inventory hook (applyOrderPlaced) already
    // decrements Product.stockQuantity once for the SKU-matched
    // main item and writes the StockMovement; the owner's original
    // direct decrement double-counted every checkout order.

    return {
      success: true,
      orderNumber: externalId,
      productName: p.name,
      quantity: qty,
      hasBump: !!(dto.includeBump && p.bumpPriceMinor),
      totalMinor: total.toString(),
      totalFormatted: `${(Number(total) / 100).toLocaleString("en-IN")} BDT`,
      customerName: dto.customerName,
      customerPhone: cleanPhone,
      deliveryAddress: dto.customerAddress,
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
      },
    });
    if (!p) throw new NotFoundException("Product not found in this organization");
    const pub = toPublicProduct(p, p.costs?.[0]?.costMinor ?? null);
    pub.costHistory = p.costs.map((c: any) => ({ ...c, costMinor: c.costMinor.toString() }));
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
    const data: any = { ...dto };
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
    const updated = await (this.prisma as any).product.update({ where: { id: productId }, data });
    if (inventoryOwnsStock) {
      const result = await this.inventory!.adjust(organizationId, actorId, productId, {
        setTo: dto.stockQuantity, note: "পণ্য সম্পাদনা থেকে স্টক হালনাগাদ",
      });
      updated.stockQuantity = result.stockQuantity;
    }
    await this.audit.log({ organizationId, userId: actorId, action: "product.update", entityType: "Product", entityId: productId });
    return toPublicProduct(updated, null);
  }

  async archive(organizationId: string, actorId: string, productId: string) {
    await this.getOne(organizationId, productId);
    const updated = await (this.prisma as any).product.update({ where: { id: productId }, data: { status: "ARCHIVED" } });
    await this.audit.log({ organizationId, userId: actorId, action: "product.archive", entityType: "Product", entityId: productId });
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
    const updated = await (this.prisma as any).productVariant.update({ where: { id: variantId }, data });
    if (inventoryOwnsStock) {
      const result = await this.inventory!.adjust(organizationId, actorId, productId, {
        variantId, setTo: dto.stockQuantity, note: "ভ্যারিয়েন্ট সম্পাদনা থেকে স্টক হালনাগাদ",
      });
      updated.stockQuantity = result.stockQuantity;
    }
    await this.audit.log({ organizationId, userId: actorId, action: "product.variant.update", entityType: "ProductVariant", entityId: variantId, metadata: { productId } });
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
    return { deleted: true, productId, variantId };
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
