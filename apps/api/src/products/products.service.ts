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

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

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
