import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { BundleItemInput } from "./ec29-bundles";
import type { BundleDto } from "./commerce.dto";

/**
 * EC29 — staff Bundles CRUD + the public/storefront read models.
 * A bundle is a named SET of existing products (stored as a Json
 * items array on the Bundle row) sold for one bundlePriceMinor.
 * Components are always resolved against CURRENT product/variant
 * rows — a bundle never stores prices for its components.
 */
@Injectable()
export class BundlesService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private table(): any {
    return (this.prisma as any).bundle;
  }

  private async loadOr404(orgId: string, id: string): Promise<any> {
    const row = await this.table().findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException("Bundle not found in this organization");
    return row;
  }

  /**
   * Validate + normalize raw bundle items. 2..10 entries; every
   * product must exist in THIS org; a given variantSku must
   * resolve to a variant of that product; the same
   * (productId, variantSku) pair may not repeat.
   */
  async validateItems(orgId: string, raw: unknown): Promise<BundleItemInput[]> {
    if (!Array.isArray(raw)) {
      throw new BadRequestException("বান্ডলে পণ্যের তালিকা দিতে হবে");
    }
    if (raw.length < 2) {
      throw new BadRequestException("বান্ডলে কমপক্ষে ২টি পণ্য থাকতে হবে");
    }
    if (raw.length > 10) {
      throw new BadRequestException("বান্ডলে সর্বোচ্চ ১০টি পণ্য থাকতে পারবে");
    }
    const seen = new Set<string>();
    const out: BundleItemInput[] = [];
    for (const entry of raw as any[]) {
      const productId = entry?.productId;
      if (typeof productId !== "string" || !productId) {
        throw new BadRequestException("বান্ডলের প্রতিটি পণ্যের আইডি দিতে হবে");
      }
      const qty = entry?.qty;
      if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
        throw new BadRequestException("বান্ডলের প্রতিটি পণ্যের পরিমাণ ১–৯৯ হতে হবে");
      }
      let variantSku: string | null = null;
      if (entry?.variantSku !== null && entry?.variantSku !== undefined && entry?.variantSku !== "") {
        if (typeof entry.variantSku !== "string" || entry.variantSku.length > 100) {
          throw new BadRequestException("বান্ডলের ভ্যারিয়েন্ট SKU সঠিক নয়");
        }
        variantSku = entry.variantSku;
      }
      const pairKey = `${productId}::${variantSku ?? ""}`;
      if (seen.has(pairKey)) {
        throw new BadRequestException("একই পণ্য/ভ্যারিয়েন্ট বান্ডলে দুবার দেওয়া যাবে না");
      }
      seen.add(pairKey);
      const product = await (this.prisma as any).product.findFirst({
        where: { id: productId, organizationId: orgId },
      });
      if (!product) {
        throw new BadRequestException(`পণ্য পাওয়া যায়নি (এই সংস্থার নয়): ${productId}`);
      }
      if (variantSku) {
        const variantTable = (this.prisma as any).productVariant;
        const variant = variantTable?.findFirst
          ? await variantTable
              .findFirst({ where: { productId, sku: variantSku } })
              .catch(() => null)
          : null;
        if (!variant) {
          throw new BadRequestException("বান্ডলের ভ্যারিয়েন্ট SKU পাওয়া যায়নি");
        }
      }
      out.push({ productId, variantSku, qty });
    }
    return out;
  }

  /**
   * Resolve a bundle's stored items against CURRENT rows.
   * regularUnitMinor = variant price when a variant resolves,
   * else the product price, else 0 (unresolvable component).
   */
  async resolveComponents(orgId: string, bundle: any): Promise<any[]> {
    const items: any[] = Array.isArray(bundle?.items) ? bundle.items : [];
    const out: any[] = [];
    for (const item of items) {
      const product = await (this.prisma as any).product
        .findFirst({ where: { id: item.productId, organizationId: orgId } })
        .catch(() => null);
      let variant: any = null;
      if (item.variantSku) {
        const variantTable = (this.prisma as any).productVariant;
        variant = variantTable?.findFirst
          ? await variantTable
              .findFirst({ where: { productId: item.productId, sku: item.variantSku } })
              .catch(() => null)
          : null;
      }
      const regularUnitMinor =
        variant?.priceMinor != null
          ? BigInt(variant.priceMinor)
          : product?.priceMinor != null
            ? BigInt(product.priceMinor)
            : 0n;
      out.push({
        productId: item.productId,
        name: product?.name ?? null,
        product: product ?? null,
        variant: variant ?? null,
        variantSku: item.variantSku ?? null,
        qty: Number(item.qty ?? 0),
        regularUnitMinor,
      });
    }
    return out;
  }

  private async serialize(bundle: any): Promise<any> {
    const comps = await this.resolveComponents(bundle.organizationId, bundle);
    const regularTotalMinor = comps.reduce(
      (s, c) => s + c.regularUnitMinor * BigInt(c.qty),
      0n,
    );
    return {
      ...bundle,
      bundlePriceMinor: bundle.bundlePriceMinor != null ? String(bundle.bundlePriceMinor) : "0",
      items: Array.isArray(bundle.items) ? bundle.items : [],
      regularTotalMinor: regularTotalMinor.toString(),
      hasMissingComponents: comps.some((c) => !c.product),
    };
  }

  private parseBundlePrice(raw: unknown): bigint {
    const s = raw === null || raw === undefined ? "" : String(raw).trim();
    if (!/^\d+$/.test(s) || BigInt(s) <= 0n) {
      throw new BadRequestException("বান্ডলের দাম সঠিক ধনাত্মক সংখ্যা হতে হবে");
    }
    return BigInt(s);
  }

  async list(orgId: string) {
    const rows =
      (await this.table().findMany({
        where: { organizationId: orgId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      })) ?? [];
    const items = [];
    for (const r of rows) items.push(await this.serialize(r));
    return { items };
  }

  async getOne(orgId: string, id: string) {
    // Mirrors PromotionsService.getOne: the serialized row itself.
    return this.serialize(await this.loadOr404(orgId, id));
  }

  async create(orgId: string, actorId: string, dto: BundleDto) {
    const name = String(dto.name ?? "").trim();
    if (!name) throw new BadRequestException("বান্ডলের নাম আবশ্যক");
    const bundlePriceMinor = this.parseBundlePrice(dto.bundlePriceMinor);
    const items = await this.validateItems(orgId, dto.items);
    const row = await this.table().create({
      data: {
        organizationId: orgId,
        name,
        description: dto.description ?? null,
        imageUrl: dto.imageUrl ?? null,
        items,
        bundlePriceMinor,
        active: dto.active ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "bundle.created",
      entityType: "Bundle", entityId: row.id, metadata: { name },
    });
    return { bundle: await this.serialize(row) };
  }

  async update(orgId: string, actorId: string, id: string, dto: BundleDto) {
    const existing = await this.loadOr404(orgId, id);
    const data: Record<string, any> = {};
    if (dto.name !== undefined) {
      const name = String(dto.name ?? "").trim();
      if (!name) throw new BadRequestException("বান্ডলের নাম আবশ্যক");
      data.name = name;
    }
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl;
    if (dto.items !== undefined) data.items = await this.validateItems(orgId, dto.items);
    if (dto.bundlePriceMinor !== undefined) data.bundlePriceMinor = this.parseBundlePrice(dto.bundlePriceMinor);
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    void existing;
    const updated = await this.table().update({ where: { id }, data });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "bundle.updated",
      entityType: "Bundle", entityId: id,
    });
    return { bundle: await this.serialize(updated) };
  }

  async setActive(orgId: string, actorId: string, id: string, active: boolean) {
    await this.loadOr404(orgId, id);
    const updated = await this.table().update({ where: { id }, data: { active } });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "bundle.toggled",
      entityType: "Bundle", entityId: id, metadata: { active },
    });
    return { bundle: await this.serialize(updated) };
  }

  async remove(orgId: string, actorId: string, id: string) {
    await this.loadOr404(orgId, id);
    await this.table().delete({ where: { id } });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "bundle.deleted",
      entityType: "Bundle", entityId: id,
    });
    return { deleted: true };
  }

  /**
   * Public shop payload: ACTIVE bundles whose EVERY component
   * resolves to an ACTIVE product (a bundle with any missing /
   * inactive component is excluded entirely — never shown
   * half-broken).
   */
  async publicBundles(orgId: string): Promise<any[]> {
    const rows =
      (await this.table()
        .findMany({
          where: { organizationId: orgId, active: true },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        })
        .catch(() => [])) ?? [];
    const out: any[] = [];
    for (const bundle of rows) {
      const comps = await this.resolveComponents(orgId, bundle);
      if (comps.length === 0) continue;
      if (comps.some((c) => !c.product || c.product.status !== "ACTIVE")) continue;
      const regularTotalMinor = comps.reduce(
        (s, c) => s + c.regularUnitMinor * BigInt(c.qty),
        0n,
      );
      const bundlePriceMinor = BigInt(bundle.bundlePriceMinor ?? 0);
      out.push({
        id: bundle.id,
        name: bundle.name,
        description: bundle.description ?? null,
        imageUrl: bundle.imageUrl ?? null,
        bundlePriceMinor: bundlePriceMinor.toString(),
        regularTotalMinor: regularTotalMinor.toString(),
        savingsMinor:
          regularTotalMinor > bundlePriceMinor
            ? (regularTotalMinor - bundlePriceMinor).toString()
            : null,
        components: comps.map((c) => ({
          productId: c.productId,
          name: c.product.name,
          variantSku: c.variantSku,
          qty: c.qty,
          unitPriceMinor: c.regularUnitMinor.toString(),
        })),
      });
    }
    return out;
  }
}
