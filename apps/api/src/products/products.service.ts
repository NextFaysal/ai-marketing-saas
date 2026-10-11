import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateProductDto, UpdateProductDto, CreateVariantDto, SetCostDto } from "./products.dto";
import { parseMoneyToMinor } from "@repo/contracts";
import { computeMargin } from "./pricing";

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
    private readonly integrations: IntegrationsService,
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
        stockQuantity: dto.stockQuantity, imageUrl: dto.imageUrl || null,
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

    // If stockQuantity is tracked, reduce stock
    if (p.stockQuantity !== null && p.stockQuantity !== undefined && p.stockQuantity >= qty) {
      await (this.prisma as any).product.update({
        where: { id: p.id },
        data: { stockQuantity: p.stockQuantity - qty },
      });
    }

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

  async update(organizationId: string, actorId: string, productId: string, dto: UpdateProductDto) {
    await this.getOne(organizationId, productId); // 404 + tenant scope
    const data: any = { ...dto };
    if (dto.price !== undefined) { data.priceMinor = parseMoney(dto.price, "price"); delete data.price; }
    if (dto.bumpPrice !== undefined) {
      data.bumpPriceMinor = dto.bumpPrice ? parseMoney(dto.bumpPrice, "bumpPrice") : null;
      delete data.bumpPrice;
    }
    const updated = await (this.prisma as any).product.update({ where: { id: productId }, data });
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
