import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
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

/**
 * AB5 (AX10) — Meta Catalog batch payload builder.
 *
 * API basis: the Catalog batch endpoint (/{catalog_id}/batch,
 * item_type "PRODUCT_ITEM") — the SAME endpoint the manual push
 * below already calls — accepts a per-request method of CREATE |
 * UPDATE | DELETE, all keyed by the same retailer_id identity
 * (sku ?? id) the existing push uses. AX10 extends the method
 * vocabulary of that endpoint: CREATE stays the manual-push
 * method, UPDATE is the change-driven method, and a DELETE
 * request carries the retailer_id with empty data.
 */
export type CatalogBatchMethod = "CREATE" | "UPDATE";

function minorNumber(v: unknown): number {
  return typeof v === "bigint" ? Number(v) : Number(v ?? 0);
}

function availabilityOf(stock: unknown): string {
  return stock == null || (stock as number) > 0 ? "in stock" : "out of stock";
}

/** The exact `data` object the pre-AX10 manual push built for a
 * product (field-for-field), factored out so variant items and
 * the auto-sync sweep build on the identical base. */
function productItemData(p: any, website: string): Record<string, unknown> {
  return {
    name: p.name,
    ...(p.description ? { description: String(p.description).slice(0, 5000) } : {}),
    ...(p.category ? { category: String(p.category) } : {}),
    price: minorNumber(p.priceMinor),
    currency: p.currency ?? "BDT",
    availability: availabilityOf(p.stockQuantity),
    condition: "new",
    url: `${website}/product/${p.slug ?? p.sku ?? p.id}`,
    ...(p.imageUrl ? { image_url: p.imageUrl } : {}),
  };
}

/**
 * Build batch requests for `method` (CREATE | UPDATE).
 * A product WITHOUT variants yields exactly ONE request — the
 * shape the manual push has always sent. WITH variants it yields
 * one request PER VARIANT: retailer_id = variant.sku ??
 * `${base}--v${variant.id}`, item_group_id = the product's base
 * retailer id, name/price/availability from the variant (falling
 * back to the product), every other field inherited from the
 * product exactly as the product-level builder builds it.
 */
export function buildBatchRequests(products: any[], website: string, method: CatalogBatchMethod): Record<string, any>[] {
  const requests: Record<string, any>[] = [];
  for (const p of products ?? []) {
    const base: string = p.sku ?? p.id;
    const variants: any[] = Array.isArray(p.variants) ? p.variants : [];
    if (variants.length === 0) {
      requests.push({ method, retailer_id: base, data: productItemData(p, website) });
      continue;
    }
    for (const v of variants) {
      requests.push({
        method,
        retailer_id: v.sku ?? `${base}--v${v.id}`,
        data: {
          ...productItemData(p, website),
          name: `${p.name} — ${v.name}`,
          price: minorNumber(v.priceMinor ?? p.priceMinor),
          availability: availabilityOf(v.stockQuantity ?? p.stockQuantity),
          item_group_id: base,
        },
      });
    }
  }
  return requests;
}

/**
 * DELETE requests for one product. When the product row still
 * loads, every external identity it owns is deleted: the base
 * retailer id plus one per variant. When the row is gone, only
 * the retailer id snapshotted at enqueue time remains.
 */
export function buildDeleteRequests(product: any | null, snapshotRetailerId?: string | null): Record<string, any>[] {
  if (!product) {
    return snapshotRetailerId ? [{ method: "DELETE", retailer_id: snapshotRetailerId, data: {} }] : [];
  }
  const base: string = product.sku ?? product.id;
  const variants: any[] = Array.isArray(product.variants) ? product.variants : [];
  const ids = [base, ...variants.map((v: any) => v.sku ?? `${base}--v${v.id}`)];
  return ids.map((retailer_id) => ({ method: "DELETE", retailer_id, data: {} }));
}

@Injectable()
export class CatalogsService {
  private readonly logger = new Logger(CatalogsService.name);

  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async list(organizationId: string) {
    return (this.prisma as any).catalogRecord.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 50 });
  }

  /** Create a catalog in the owner's Meta Business and record it.
   * Only the API-returned catalog id is stored. */
  async create(organizationId: string, actorId: string, dto: { name: string; businessId: string; pageId?: string | null; pageName?: string | null; instagramId?: string | null; instagramName?: string | null }) {
    const token = await metaTokenForOrg(this.prisma, organizationId).catch((e) => {
      throw new BadRequestException(e instanceof Error ? e.message : "Meta token resolution failed");
    });
    const res = await graphPost(token, `/${dto.businessId}/owned_product_catalogs`, { name: dto.name }).catch((e) => {
      throw new BadRequestException(`Meta catalog creation failed: ${e instanceof Error ? e.message : "unknown error"}`);
    });
    if (!res?.id) throw new BadRequestException("Meta returned no catalog id; creation is NOT confirmed");
    const record = await (this.prisma as any).catalogRecord.create({
      data: {
        organizationId, name: dto.name, externalCatalogId: String(res.id), businessId: dto.businessId,
        // AB5 (AX10): staff-entered Page / Instagram link, stored verbatim.
        pageId: dto.pageId ?? null, pageName: dto.pageName ?? null,
        instagramId: dto.instagramId ?? null, instagramName: dto.instagramName ?? null,
      },
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

  async register(organizationId: string, dto: { name: string; externalCatalogId: string; pageId?: string | null; pageName?: string | null; instagramId?: string | null; instagramName?: string | null }) {
    return (this.prisma as any).catalogRecord.create({
      data: {
        organizationId, name: dto.name, externalCatalogId: dto.externalCatalogId,
        // AB5 (AX10): staff-entered Page / Instagram link, stored verbatim.
        pageId: dto.pageId ?? null, pageName: dto.pageName ?? null,
        instagramId: dto.instagramId ?? null, instagramName: dto.instagramName ?? null,
      },
    });
  }

  /** AB5 (AX10): partial catalog settings update — autoSync
   * opt-in and the staff-entered Page / Instagram link. Only
   * fields PRESENT in the dto are written; an explicit null
   * clears a link field. Org-scoped (a foreign catalog is a
   * 404, exactly like every other catalog write here). */
  async updateCatalog(
    organizationId: string,
    actorId: string,
    catalogId: string,
    dto: { autoSync?: boolean; pageId?: string | null; pageName?: string | null; instagramId?: string | null; instagramName?: string | null },
  ) {
    const catalog = await this.getCatalogOrThrow(organizationId, catalogId);
    const data: Record<string, unknown> = {};
    const fields: string[] = [];
    for (const key of ["autoSync", "pageId", "pageName", "instagramId", "instagramName"] as const) {
      if (dto[key] !== undefined) {
        data[key] = dto[key];
        fields.push(key);
      }
    }
    if (fields.length === 0) return catalog;
    const updated = await (this.prisma as any).catalogRecord.update({ where: { id: catalog.id }, data });
    await this.audit.log({ organizationId, userId: actorId, action: "catalog.updated", entityType: "CatalogRecord", entityId: catalog.id, metadata: { fields } });
    return updated;
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
      // AB5 (AX10): variants ride along so a product with
      // variants pushes one item PER VARIANT (see the builder).
      include: { variants: { orderBy: { createdAt: "asc" } } },
    });
    if (products.length === 0) throw new BadRequestException("No active products to push");
    // AB5 (AX10): the payload comes from buildBatchRequests with
    // "CREATE" — for a variant-less product the request is
    // byte-identical to the pre-AX10 inline builder. A manual
    // push writes NO CatalogSyncRecord rows: it updates
    // catalog-level state (lastSyncAt/lastSyncSummary) only.
    const requests = buildBatchRequests(products, website, "CREATE");
    const res = await graphPost(token, `/${catalog.externalCatalogId}/batch`, {
      requests: JSON.stringify(requests), item_type: "PRODUCT_ITEM",
    }).catch((e) => {
      throw new BadRequestException(`Catalog batch failed: ${e instanceof Error ? e.message : "unknown error"}`);
    });
    const handles: unknown[] = Array.isArray(res?.handles) ? res.handles : [];
    const errors: unknown[] = Array.isArray(res?.errors) ? res.errors : [];
    const summary = { pushed: handles.length, errors: errors.length, errorSample: errors.slice(0, 5), total: products.length, items: requests.length, at: new Date().toISOString() };
    await (this.prisma as any).catalogRecord.update({
      where: { id: catalog.id }, data: { lastSyncAt: new Date(), lastSyncSummary: summary, status: "connected" },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "catalog.products_pushed", entityType: "CatalogRecord", entityId: catalog.id, metadata: { pushed: summary.pushed, errors: summary.errors } });
    return summary;
  }

  // ---------- AB5 (AX10): change-driven catalog sync ----------
  // Product writes call noteProductChanged (failure-isolated);
  // the catalog_sync_sweep automation job drains the queue via
  // runCatalogSyncSweep through the same batch endpoint.

  /** Product row WITH its variants (the batch builder needs them
   * for per-variant items). Falls back to the variant table when
   * the row carries no variants array. */
  private async loadProductWithVariants(organizationId: string, productId: string): Promise<any | null> {
    const p = await (this.prisma as any).product.findFirst({
      where: { id: productId, organizationId },
      include: { variants: { orderBy: { createdAt: "asc" } } },
    });
    if (!p) return null;
    if (!Array.isArray(p.variants)) {
      const table = (this.prisma as any).productVariant;
      p.variants = table?.findMany ? await table.findMany({ where: { productId } }).catch(() => []) : [];
    }
    return p;
  }

  /**
   * Enqueue a product change for every autoSync catalog of the
   * org. FULLY failure-isolated: this runs inside product write
   * paths and must never fail one — any error is logged and
   * swallowed. Pending rows for the same (catalog, product)
   * COLLAPSE into one: the latest action wins, except a delete
   * is sticky (delete supersedes a pending update, and a later
   * update never resurrects a pending delete). The retailer id
   * is snapshotted NOW so a later DELETE still knows its
   * external identity after the product row is gone.
   */
  async noteProductChanged(organizationId: string, productId: string, action: "create" | "update" | "delete"): Promise<void> {
    try {
      const catalogs = await (this.prisma as any).catalogRecord.findMany({
        where: { organizationId, autoSync: true },
      });
      if (!catalogs?.length) return;
      let product: any = null;
      try {
        product = await this.loadProductWithVariants(organizationId, productId);
      } catch {
        product = null;
      }
      const retailerId: string = product ? (product.sku ?? product.id) : productId;
      for (const catalog of catalogs) {
        const existing = await (this.prisma as any).catalogSyncRecord.findFirst({
          where: { organizationId, catalogId: catalog.id, productId, status: "pending" },
        });
        if (existing) {
          const collapsed = existing.action === "delete" || action === "delete" ? "delete" : action;
          await (this.prisma as any).catalogSyncRecord.update({
            where: { id: existing.id },
            data: { action: collapsed, retailerId },
          });
        } else {
          await (this.prisma as any).catalogSyncRecord.create({
            data: { organizationId, catalogId: catalog.id, productId, retailerId, action, status: "pending" },
          });
        }
      }
    } catch (e) {
      this.logger.warn(
        `noteProductChanged(${action}) failed for product ${productId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * The per-product auto-sync state for one catalog, read from
   * the CatalogSyncRecord queue ONLY (basis "auto_sync_records").
   * Manual pushes never write these rows — they update
   * catalog-level state only — so a product pushed manually and
   * never queued honestly reads "never_queued".
   */
  async productSyncState(organizationId: string, catalogId: string, productId: string) {
    await this.getCatalogOrThrow(organizationId, catalogId);
    const rec = await (this.prisma as any).catalogSyncRecord.findFirst({
      where: { organizationId, catalogId, productId },
      orderBy: { createdAt: "desc" },
    });
    const note = "manual pushes update catalog-level state only";
    if (!rec) return { basis: "auto_sync_records", state: "never_queued", note };
    return {
      basis: "auto_sync_records",
      state: rec.status as string,
      action: rec.action as string,
      attempts: rec.attempts as number,
      lastError: (rec.lastError ?? null) as string | null,
      queuedAt: rec.createdAt as Date,
      processedAt: (rec.processedAt ?? null) as Date | null,
      note,
    };
  }

  /** Catalog-level auto-sync status for the sync-status route:
   * the opt-in flag, live queue counts, and the catalog's own
   * last-sync stamp (written by BOTH the manual push and the
   * sweep — each summary says which via its shape). */
  async syncStatus(organizationId: string, catalogId: string) {
    const catalog = await this.getCatalogOrThrow(organizationId, catalogId);
    const table = (this.prisma as any).catalogSyncRecord;
    const [pending, failed, done] = await Promise.all([
      table.count({ where: { organizationId, catalogId, status: "pending" } }),
      table.count({ where: { organizationId, catalogId, status: "failed" } }),
      table.count({ where: { organizationId, catalogId, status: "done" } }),
    ]);
    return {
      autoSync: Boolean(catalog.autoSync),
      counts: { pending, failed, done },
      lastSyncAt: catalog.lastSyncAt ?? null,
      lastSyncSummary: catalog.lastSyncSummary ?? null,
    };
  }

  /** One record's failure bookkeeping: the error is kept
   * (≤500 chars) and the record stays "pending" for the next
   * drain until its 3rd attempt, when it turns "failed". */
  private async failSyncRecord(recordId: string, attempts: number, message: string): Promise<"failed" | "pending"> {
    const status = attempts >= 3 ? "failed" : "pending";
    await (this.prisma as any).catalogSyncRecord
      .update({ where: { id: recordId }, data: { status, lastError: String(message).slice(0, 500) } })
      .catch(() => undefined);
    return status;
  }

  /**
   * The batch requests for one queued record, built from the
   * CURRENT product row:
   * - delete → DELETE requests (product row if it still loads,
   *   else the enqueue-time snapshot);
   * - create/update for a product that is gone or not ACTIVE →
   *   converted to the same DELETE (an inactive product must not
   *   be (re)added to the catalog; a gone one must be removed);
   * - create/update for an ACTIVE product → CREATE/UPDATE
   *   payload; returns null when the payload cannot be built
   *   because the org has no website (DELETEs never need one).
   */
  private async requestsForSyncRecord(organizationId: string, rec: any, website: string): Promise<Record<string, any>[] | null> {
    const product = await this.loadProductWithVariants(organizationId, rec.productId);
    if (rec.action === "delete") return buildDeleteRequests(product, rec.retailerId);
    if (!product || product.status !== "ACTIVE") return buildDeleteRequests(product, rec.retailerId);
    if (!website) return null;
    return buildBatchRequests([product], website, rec.action === "create" ? "CREATE" : "UPDATE");
  }

  /**
   * catalog_sync_sweep job body (per-org enablement — the
   * merchant installs the job template). For each autoSync
   * catalog: drain up to 100 pending records, oldest first, ONE
   * batch call per record. attempts is incremented up front;
   * a failure keeps the record pending until attempt 3 (see
   * failSyncRecord). A token-resolution failure fails the whole
   * catalog's drain under the same retry rule. After a drain
   * that processed at least one record, the catalog is stamped
   * with an auto_sync summary. Returns the per-org totals.
   */
  async runCatalogSyncSweep(organizationId: string): Promise<{ catalogs: number; done: number; failed: number; pending: number }> {
    const catalogs = await (this.prisma as any).catalogRecord.findMany({
      where: { organizationId, autoSync: true },
    });
    let done = 0;
    let failed = 0;
    let pending = 0;
    for (const catalog of catalogs ?? []) {
      try {
        const r = await this.drainCatalogSync(organizationId, catalog);
        done += r.done;
        failed += r.failed;
        pending += r.stillPending;
      } catch (e) {
        this.logger.warn(
          `catalog sync drain failed for catalog ${catalog.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    return { catalogs: (catalogs ?? []).length, done, failed, pending };
  }

  private async drainCatalogSync(organizationId: string, catalog: any): Promise<{ done: number; failed: number; stillPending: number }> {
    const profile = await (this.prisma as any).businessProfile.findFirst({ where: { organizationId } });
    const website = (profile?.websiteUrl ?? "").replace(/\/$/, "");
    const records = await (this.prisma as any).catalogSyncRecord.findMany({
      where: { organizationId, catalogId: catalog.id, status: "pending" },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    let done = 0;
    let failed = 0;
    let stillPending = 0;
    if (!records?.length) return { done, failed, stillPending };

    let token: string | null = null;
    let tokenError: string | null = null;
    try {
      token = await metaTokenForOrg(this.prisma, organizationId);
    } catch (e) {
      tokenError = e instanceof Error ? e.message : "Meta token resolution failed";
    }

    for (const rec of records) {
      const attempts = (rec.attempts ?? 0) + 1;
      await (this.prisma as any).catalogSyncRecord
        .update({ where: { id: rec.id }, data: { attempts } })
        .catch(() => undefined);
      const fail = async (message: string) => {
        const st = await this.failSyncRecord(rec.id, attempts, message);
        if (st === "failed") failed += 1;
        else stillPending += 1;
      };
      if (tokenError || !token) {
        await fail(tokenError ?? "Meta token resolution failed");
        continue;
      }
      let requests: Record<string, any>[] | null;
      try {
        requests = await this.requestsForSyncRecord(organizationId, rec, website);
      } catch (e) {
        await fail(e instanceof Error ? e.message : "payload build failed");
        continue;
      }
      if (requests === null) {
        // ACTIVE product but no website: the payload cannot be
        // built (Meta requires a URL per item). DELETE-converted
        // records never reach here — they need no URL.
        await fail("website_missing");
        continue;
      }
      if (requests.length === 0) {
        // Nothing external to change (e.g. a delete whose
        // snapshot is empty) — the record is complete, no call.
        await (this.prisma as any).catalogSyncRecord
          .update({ where: { id: rec.id }, data: { status: "done", processedAt: new Date(), lastError: null } })
          .catch(() => undefined);
        done += 1;
        continue;
      }
      try {
        const res = await graphPost(token, `/${catalog.externalCatalogId}/batch`, {
          requests: JSON.stringify(requests), item_type: "PRODUCT_ITEM",
        });
        const errors: unknown[] = Array.isArray(res?.errors) ? res.errors : [];
        if (errors.length > 0) {
          const first: any = errors[0] as any;
          await fail(first?.message ?? JSON.stringify(first));
        } else {
          await (this.prisma as any).catalogSyncRecord.update({
            where: { id: rec.id },
            data: { status: "done", processedAt: new Date(), lastError: null },
          });
          done += 1;
        }
      } catch (e) {
        await fail(e instanceof Error ? e.message : "Catalog batch failed");
      }
    }

    const summary = { via: "auto_sync", done, failed, stillPending, at: new Date().toISOString() };
    await (this.prisma as any).catalogRecord
      .update({ where: { id: catalog.id }, data: { lastSyncAt: new Date(), lastSyncSummary: summary } })
      .catch(() => undefined);
    return { done, failed, stillPending };
  }
}
