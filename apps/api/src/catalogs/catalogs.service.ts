import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { graphDelete, graphPost, metaTokenForOrg } from "../common/meta-graph";

/**
 * Build the Meta catalog product-set filter from a local set
 * definition (Milestone 32). Prices use the SAME unit the batch
 * push sends (minor units as a plain number), availability uses
 * the exact strings the push writes. Returns null when the set
 * has no criterion Meta can filter on.
 */
export function buildMetaProductSetFilter(set: { category?: string | null; maxPriceMinor?: bigint | number | null; inStockOnly?: boolean }): Record<string, unknown> | null {
  const conditions: Record<string, unknown>[] = [];
  if (set.category) conditions.push({ category: { i_contains: set.category } });
  if (set.maxPriceMinor !== null && set.maxPriceMinor !== undefined) conditions.push({ price: { lte: Number(set.maxPriceMinor) } });
  if (set.inStockOnly) conditions.push({ availability: { eq: "in stock" } });
  if (conditions.length === 0) return null;
  return conditions.length === 1 ? conditions[0] : { and: conditions };
}

@Injectable()
export class CatalogsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async list(organizationId: string) {
    return (this.prisma as any).catalogRecord.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 50 });
  }

  /** Create a catalog in the owner's Meta Business and record it.
   * Only the API-returned catalog id is stored. */
  async create(organizationId: string, actorId: string, dto: { name: string; businessId: string }) {
    const token = await metaTokenForOrg(this.prisma, organizationId).catch((e) => {
      throw new BadRequestException(e instanceof Error ? e.message : "Meta token resolution failed");
    });
    const res = await graphPost(token, `/${dto.businessId}/owned_product_catalogs`, { name: dto.name }).catch((e) => {
      throw new BadRequestException(`Meta catalog creation failed: ${e instanceof Error ? e.message : "unknown error"}`);
    });
    if (!res?.id) throw new BadRequestException("Meta returned no catalog id; creation is NOT confirmed");
    const record = await (this.prisma as any).catalogRecord.create({
      data: { organizationId, name: dto.name, externalCatalogId: String(res.id), businessId: dto.businessId },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "catalog.created", entityType: "CatalogRecord", entityId: record.id, metadata: { externalCatalogId: record.externalCatalogId } });
    return record;
  }

  /** Product sets (Phase K): LOCAL filter definitions over the
   * org's real catalog products (category / max price / in-stock).
   * Member counts are computed from the actual products, never
   * stored guesses. Meta-side creation lives in publishProductSet
   * (Milestone 32) and follows the same discipline: the set counts
   * as created only with a Meta-returned product set id, and
   * failures are recorded on the set with Meta's own error. */
  private async getCatalogOrThrow(organizationId: string, catalogId: string) {
    const record = await (this.prisma as any).catalogRecord.findFirst({ where: { id: catalogId, organizationId } });
    if (!record) throw new NotFoundException("Catalog not found");
    return record;
  }

  private matchesSet(p: any, set: any): boolean {
    if (p.status !== "ACTIVE") return false;
    if (set.inStockOnly && !(p.stockQuantity == null || p.stockQuantity > 0)) return false;
    if (set.category && String(p.category ?? "").toLowerCase() !== String(set.category).toLowerCase()) return false;
    if (set.maxPriceMinor !== null && set.maxPriceMinor !== undefined && BigInt(p.priceMinor ?? 0) > BigInt(set.maxPriceMinor)) return false;
    return true;
  }

  async listProductSets(organizationId: string, catalogId: string) {
    await this.getCatalogOrThrow(organizationId, catalogId);
    const sets = await (this.prisma as any).productSet.findMany({ where: { organizationId, catalogRecordId: catalogId }, orderBy: { createdAt: "desc" } });
    const products = await (this.prisma as any).product.findMany({ where: { organizationId }, take: 2000 });
    return (sets as any[]).map((s) => ({
      ...s,
      maxPriceMinor: s.maxPriceMinor?.toString() ?? null,
      memberCount: (products as any[]).filter((p) => this.matchesSet(p, s)).length,
    }));
  }

  async createProductSet(organizationId: string, actorId: string, catalogId: string, dto: { name: string; category?: string; maxPriceMajor?: string; inStockOnly?: boolean }) {
    await this.getCatalogOrThrow(organizationId, catalogId);
    if (!dto.name?.trim()) throw new BadRequestException("Product set name is required");
    const set = await (this.prisma as any).productSet.create({
      data: {
        organizationId, catalogRecordId: catalogId, name: dto.name.trim(),
        category: dto.category?.trim() || null,
        maxPriceMinor: dto.maxPriceMajor ? BigInt(Math.round(Number(dto.maxPriceMajor) * 100)) : null,
        inStockOnly: dto.inStockOnly !== false, createdById: actorId,
      },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "catalog.product_set_created", entityType: "ProductSet", entityId: set.id, metadata: { catalogId } });
    const [withCount] = await this.listProductSets(organizationId, catalogId).then((all) => all.filter((s: any) => s.id === set.id));
    return withCount ?? set;
  }

  /** Create this set on Meta (Milestone 32). The local definition
   * is translated to a catalog filter; Meta's returned product set
   * id is the only proof of creation. A rejection is stored on the
   * set (status "failed" + Meta's error) and surfaced, never hidden. */
  async publishProductSet(organizationId: string, actorId: string, catalogId: string, setId: string) {
    const catalog = await this.getCatalogOrThrow(organizationId, catalogId);
    const set = await (this.prisma as any).productSet.findFirst({ where: { id: setId, organizationId, catalogRecordId: catalogId } });
    if (!set) throw new NotFoundException("Product set not found");
    if (set.externalSetId && set.status === "created") return { ...set, maxPriceMinor: set.maxPriceMinor?.toString() ?? null, alreadyCreated: true };
    const filter = buildMetaProductSetFilter(set);
    if (!filter) throw new BadRequestException("This set has no filter criterion Meta can use (add a category, a max price, or in-stock-only)");
    const token = await metaTokenForOrg(this.prisma, organizationId).catch((e) => {
      throw new BadRequestException(e instanceof Error ? e.message : "Meta token resolution failed");
    });
    try {
      const res = await graphPost(token, `/${catalog.externalCatalogId}/product_sets`, { name: set.name, filter: JSON.stringify(filter) });
      if (!res?.id) throw new Error("Meta returned no product set id; creation is NOT confirmed");
      const updated = await (this.prisma as any).productSet.update({
        where: { id: setId }, data: { externalSetId: String(res.id), status: "created", error: null },
      });
      await this.audit.log({ organizationId, userId: actorId, action: "catalog.product_set_published", entityType: "ProductSet", entityId: setId, metadata: { externalSetId: String(res.id), filter } });
      return { ...updated, maxPriceMinor: updated.maxPriceMinor?.toString() ?? null };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Meta product set creation failed";
      await (this.prisma as any).productSet.update({ where: { id: setId }, data: { status: "failed", error: message } }).catch(() => undefined);
      throw new BadRequestException(`Meta product set creation did NOT succeed: ${message}`);
    }
  }

  async deleteProductSet(organizationId: string, catalogId: string, setId: string) {
    await this.getCatalogOrThrow(organizationId, catalogId);
    const set = await (this.prisma as any).productSet.findFirst({ where: { id: setId, organizationId, catalogRecordId: catalogId } });
    if (!set) throw new NotFoundException("Product set not found");
    let metaDeleted: boolean | null = null;
    if (set.externalSetId) {
      // Best-effort Meta cleanup; the outcome is reported, and a
      // Meta failure never traps the local record.
      try {
        const token = await metaTokenForOrg(this.prisma, organizationId);
        await graphDelete(token, `/${set.externalSetId}`);
        metaDeleted = true;
      } catch { metaDeleted = false; }
    }
    await (this.prisma as any).productSet.delete({ where: { id: setId } });
    return { deleted: true, metaDeleted };
  }

  async register(organizationId: string, dto: { name: string; externalCatalogId: string }) {
    return (this.prisma as any).catalogRecord.create({
      data: { organizationId, name: dto.name, externalCatalogId: dto.externalCatalogId },
    });
  }

  /** Push the org's active products to the catalog via the batch API.
   * Item URLs are built from the Business Profile website
   * (<website>/product/<slug-or-sku>) — without a website the push is
   * refused honestly, since Meta requires a URL per item. Counts come
   * from the batch response handles/errors, nothing is assumed. */
  async pushProducts(organizationId: string, actorId: string, catalogRecordId: string) {
    const catalog = await (this.prisma as any).catalogRecord.findFirst({ where: { id: catalogRecordId, organizationId } });
    if (!catalog) throw new NotFoundException("Catalog not found");
    const profile = await (this.prisma as any).businessProfile.findFirst({ where: { organizationId } });
    const website = (profile?.websiteUrl ?? "").replace(/\/$/, "");
    if (!website) throw new BadRequestException("Business Profile এ Website URL নেই — Catalog আইটেমের জন্য প্রতিটি প্রোডাক্টের URL দরকার। আগে Settings এ ওয়েবসাইট সেট করুন।");
    const token = await metaTokenForOrg(this.prisma, organizationId).catch((e) => {
      throw new BadRequestException(e instanceof Error ? e.message : "Meta token resolution failed");
    });
    const products = await (this.prisma as any).product.findMany({
      where: { organizationId, status: "ACTIVE" }, take: 500, orderBy: { createdAt: "asc" },
    });
    if (products.length === 0) throw new BadRequestException("No active products to push");
    const requests = products.map((p: any) => ({
      method: "CREATE",
      retailer_id: p.sku ?? p.id,
      data: {
        name: p.name,
        ...(p.description ? { description: String(p.description).slice(0, 5000) } : {}),
        ...(p.category ? { category: String(p.category) } : {}),
        price: Number(BigInt(p.priceMinor)),
        currency: p.currency ?? "BDT",
        availability: p.stockQuantity == null || p.stockQuantity > 0 ? "in stock" : "out of stock",
        condition: "new",
        url: `${website}/product/${p.slug ?? p.sku ?? p.id}`,
        ...(p.imageUrl ? { image_url: p.imageUrl } : {}),
      },
    }));
    const res = await graphPost(token, `/${catalog.externalCatalogId}/batch`, {
      requests: JSON.stringify(requests), item_type: "PRODUCT_ITEM",
    }).catch((e) => {
      throw new BadRequestException(`Catalog batch failed: ${e instanceof Error ? e.message : "unknown error"}`);
    });
    const handles: unknown[] = Array.isArray(res?.handles) ? res.handles : [];
    const errors: unknown[] = Array.isArray(res?.errors) ? res.errors : [];
    const summary = { pushed: handles.length, errors: errors.length, errorSample: errors.slice(0, 5), total: products.length, at: new Date().toISOString() };
    await (this.prisma as any).catalogRecord.update({
      where: { id: catalog.id }, data: { lastSyncAt: new Date(), lastSyncSummary: summary, status: "connected" },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "catalog.products_pushed", entityType: "CatalogRecord", entityId: catalog.id, metadata: { pushed: summary.pushed, errors: summary.errors } });
    return summary;
  }
}
