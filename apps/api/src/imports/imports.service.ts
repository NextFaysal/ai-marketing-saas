import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { parseProductsCsv, parseOrdersCsv, CsvRowError, ParseResult, ParsedProductRow } from "./csv";
import { parseProductsXlsx } from "./xlsx";
import { ImportProductsCsvDto, ImportProductsXlsxDto } from "./imports.dto";
import { refreshProductSearchVector } from "../products/search-vector";

const XLSX_UNREADABLE = "Excel ফাইলটি পড়া যায়নি — সঠিক .xlsx ফাইল আপলোড করুন";

function slugifyBrandName(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function hasVariantFields(row: ParsedProductRow): boolean {
  return (
    row.variantName !== undefined ||
    row.variantSku !== undefined ||
    row.variantPriceMinor !== undefined ||
    row.variantStockQuantity !== undefined ||
    row.variantCostMinor !== undefined
  );
}

/**
 * Milestone 2 scope: synchronous import for files up to ~2 MB.
 * Duplicate SKUs inside the same organization are SKIPPED, never
 * overwritten, so an accidental re-upload cannot destroy edited data.
 * Larger files move to S3 + worker queue in a later milestone.
 */
@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    // Milestone 65: orders enter through the integrations
    // upsert so dedupe + order.created come for free.
    @Optional() private readonly integrations?: IntegrationsService,
  ) {}

  async importProducts(organizationId: string, actorId: string, dto: ImportProductsCsvDto) {
    const parsed = parseProductsCsv(dto.csvText);
    return this.runProductImport(organizationId, actorId, dto.fileName ?? null, parsed, "import.products.csv");
  }

  /** GB2 (GC6 §3): Excel (.xlsx) product import — same job + processing
   * pipeline as CSV; only the front-end parser and audit action differ. */
  async importProductsXlsx(organizationId: string, actorId: string, dto: ImportProductsXlsxDto) {
    let buffer: Buffer;
    try {
      buffer = Buffer.from(dto.fileBase64 ?? "", "base64");
    } catch {
      throw new BadRequestException(XLSX_UNREADABLE);
    }
    if (!buffer || buffer.length === 0) throw new BadRequestException(XLSX_UNREADABLE);
    let parsed: ParseResult;
    try {
      parsed = await parseProductsXlsx(buffer);
    } catch {
      throw new BadRequestException(XLSX_UNREADABLE);
    }
    return this.runProductImport(organizationId, actorId, dto.fileName ?? null, parsed, "import.products.xlsx");
  }

  /**
   * Shared product-import pipeline (CSV + XLSX).
   *
   * Counting choice (GB2): successRows counts ROWS whose data was
   * persisted. A standalone row persists one product (success += 1).
   * For a variant group, EVERY row persists exactly one ProductVariant
   * (the first row additionally persists the Product itself, which is
   * not double-counted), so success += 1 per variant row whose variant
   * was actually created; a variant row whose variant creation fails
   * (e.g. duplicate variant SKU) becomes a rowError instead. A group
   * skipped for a duplicate product SKU counts every group row as
   * skipped.
   */
  private async runProductImport(
    organizationId: string,
    actorId: string,
    fileName: string | null,
    parsed: ParseResult,
    auditAction: string,
  ) {
    const job = await (this.prisma as any).importJob.create({
      data: { organizationId, kind: "products", status: "PENDING", fileName, createdById: actorId },
    });
    const { rows, errors, totalRows } = parsed;
    const rowErrors: CsvRowError[] = [...errors];
    let success = 0, skipped = 0;
    const brandCache = new Map<string, string | undefined>();

    const standaloneRows = rows.filter((r) => !hasVariantFields(r));
    const variantRows = rows.filter((r) => hasVariantFields(r));

    // ---- Standalone rows: the original per-row loop, plus the GB2
    // status column (honoured when present) and brand link. ----
    for (const row of standaloneRows) {
      try {
        if (row.sku) {
          const dup = await (this.prisma as any).product.findUnique({
            where: { organizationId_sku: { organizationId, sku: row.sku } },
          });
          if (dup) { skipped++; continue; }
        }
        const brandId = row.brand ? await this.resolveBrandId(organizationId, row.brand, brandCache) : undefined;
        const product = await (this.prisma as any).product.create({
          data: {
            organizationId, name: row.name, sku: row.sku ?? null,
            // AB6 (AX13): English alternates from the import columns.
            nameEn: row.nameEn ?? null, descriptionEn: row.descriptionEn ?? null,
            priceMinor: row.priceMinor, compareAtMinor: row.compareAtMinor ?? null,
            currency: row.currency, stockQuantity: row.stockQuantity ?? null,
            category: row.category ?? null, description: row.description ?? null,
            imageUrl: row.imageUrl ?? null, source: "csv", status: row.status ?? "ACTIVE",
            ...(brandId ? { brandId } : {}),
          },
        });
        // AB6 (AX11): build the imported product's FTS vector —
        // failure-isolated, a refresh problem never breaks the import.
        try { await refreshProductSearchVector(this.prisma as any, product.id); } catch { /* never breaks the import */ }
        if (row.costMinor !== undefined) {
          await (this.prisma as any).productCost.create({
            data: { productId: product.id, costMinor: row.costMinor, currency: row.currency },
          });
        }
        success++;
      } catch (e) {
        rowErrors.push({ row: row.rowNumber, message: e instanceof Error ? e.message : "Failed to save row" });
      }
    }

    // ---- Variant rows: grouped by product SKU (or normalized name
    // when no SKU), first-seen order preserved. ----
    const groups = new Map<string, ParsedProductRow[]>();
    for (const row of variantRows) {
      const key = row.sku ? `sku:${row.sku}` : `name:${row.name.trim().toLowerCase()}`;
      const group = groups.get(key);
      if (group) group.push(row); else groups.set(key, [row]);
    }

    for (const group of groups.values()) {
      const first = group[0];
      try {
        if (first.sku) {
          const dup = await (this.prisma as any).product.findUnique({
            where: { organizationId_sku: { organizationId, sku: first.sku } },
          });
          if (dup) { skipped += group.length; continue; }
        }
      } catch (e) {
        for (const row of group) {
          rowErrors.push({ row: row.rowNumber, message: e instanceof Error ? e.message : "Failed to save row" });
        }
        continue;
      }

      let product: any;
      try {
        const brandId = first.brand ? await this.resolveBrandId(organizationId, first.brand, brandCache) : undefined;
        product = await (this.prisma as any).product.create({
          data: {
            organizationId, name: first.name, sku: first.sku ?? null,
            // AB6 (AX13): English alternates — the FIRST row's values for the group.
            nameEn: first.nameEn ?? null, descriptionEn: first.descriptionEn ?? null,
            priceMinor: first.priceMinor, compareAtMinor: first.compareAtMinor ?? null,
            currency: first.currency, stockQuantity: first.stockQuantity ?? null,
            category: first.category ?? null, description: first.description ?? null,
            imageUrl: first.imageUrl ?? null, source: "csv", status: first.status ?? "ACTIVE",
            ...(brandId ? { brandId } : {}),
          },
        });
        // AB6 (AX11): build the imported product's FTS vector —
        // failure-isolated, a refresh problem never breaks the import.
        try { await refreshProductSearchVector(this.prisma as any, product.id); } catch { /* never breaks the import */ }
        if (first.costMinor !== undefined) {
          await (this.prisma as any).productCost.create({
            data: { productId: product.id, costMinor: first.costMinor, currency: first.currency },
          });
        }
      } catch (e) {
        for (const row of group) {
          rowErrors.push({ row: row.rowNumber, message: e instanceof Error ? e.message : "Failed to save row" });
        }
        continue;
      }

      // One ProductVariant per group row (including the first row —
      // every row of a variant group describes one variant).
      for (const row of group) {
        try {
          const variant = await (this.prisma as any).productVariant.create({
            data: {
              productId: product.id, name: row.variantName,
              sku: row.variantSku ?? null,
              priceMinor: row.variantPriceMinor ?? null,
              stockQuantity: row.variantStockQuantity ?? null,
            },
          });
          if (row.variantCostMinor !== undefined) {
            await (this.prisma as any).productCost.create({
              data: { productId: product.id, variantId: variant.id, costMinor: row.variantCostMinor, currency: row.currency },
            });
          }
          success++;
        } catch (e) {
          rowErrors.push({ row: row.rowNumber, message: e instanceof Error ? e.message : "Failed to save row" });
        }
      }
    }

    const failed = rowErrors.length;
    const updated = await (this.prisma as any).importJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED", totalRows, successRows: success,
        failedRows: failed, skippedRows: skipped,
        errors: rowErrors.slice(0, 200), completedAt: new Date(),
      },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: auditAction,
      entityType: "ImportJob", entityId: job.id,
      metadata: { totalRows, success, failed, skipped },
    });
    return updated;
  }

  /**
   * GB2: resolve a brand name to an org Brand id — case-insensitive
   * name match first; when absent, CREATE the brand (slugified name,
   * "-2"/"-3"… appended while the slug is taken by another brand in
   * the org). Results are cached per distinct name per import. Any
   * failure (e.g. the Brand table is unavailable) resolves to
   * undefined — the product is then created without a brandId; brand
   * resolution NEVER fails the row.
   */
  private async resolveBrandId(
    organizationId: string,
    brandName: string,
    cache: Map<string, string | undefined>,
  ): Promise<string | undefined> {
    const displayName = brandName.trim();
    const cacheKey = displayName.toLowerCase();
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    let brandId: string | undefined;
    try {
      const brandTable = (this.prisma as any).brand;
      if (!brandTable) throw new Error("Brand table unavailable");
      let brands: any[] = [];
      if (typeof brandTable.findMany === "function") {
        brands = (await brandTable.findMany({ where: { organizationId } })) ?? [];
      } else if (typeof brandTable.findFirst === "function") {
        const found = await brandTable.findFirst({ where: { organizationId, name: displayName } });
        brands = found ? [found] : [];
      }
      const existing = brands.find(
        (b: any) => typeof b?.name === "string" && b.name.trim().toLowerCase() === cacheKey,
      );
      if (existing) {
        brandId = existing.id;
      } else {
        const baseSlug = slugifyBrandName(displayName) || "brand";
        let slug = baseSlug;
        let suffix = 2;
        const slugTakenLocally = (s: string) => brands.some((b: any) => b.slug === s);
        while (slugTakenLocally(slug)) { slug = `${baseSlug}-${suffix}`; suffix++; }
        // Create, advancing the suffix on a unique-slug collision that
        // the local list did not show (e.g. a concurrent create).
        for (let attempt = 0; attempt < 25; attempt++) {
          try {
            const created = await brandTable.create({
              data: { organizationId, name: displayName, slug },
            });
            brandId = created.id;
            brands.push(created);
            break;
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            const looksLikeSlugConflict = /unique|slug/i.test(message);
            if (!looksLikeSlugConflict || attempt === 24) throw e;
            slug = `${baseSlug}-${suffix}`; suffix++;
          }
        }
      }
    } catch {
      brandId = undefined;
    }
    cache.set(cacheKey, brandId);
    return brandId;
  }

  /**
   * Milestone 65: bulk order import. Every row goes through
   * IntegrationsService.upsertOrder (source "csv"), so repeat
   * imports update in place and `order.created` fires exactly
   * once per genuinely new, recent order — workflows, CAPI
   * and offline conversions included. The order's externalId
   * is the row's order_ref; the customer is keyed by phone so
   * repeat buyers converge on one customer record.
   */
  async importOrders(organizationId: string, actorId: string, dto: ImportProductsCsvDto) {
    if (!this.integrations) throw new BadRequestException("Order import is not available in this deployment");
    const job = await (this.prisma as any).importJob.create({
      data: { organizationId, kind: "orders", status: "PENDING", fileName: dto.fileName ?? null, createdById: actorId },
    });
    const { rows, errors, totalRows } = parseOrdersCsv(dto.csvText);
    const rowErrors: CsvRowError[] = [...errors];
    let success = 0, skipped = 0;
    for (const row of rows) {
      try {
        const subtotal = row.unitPriceMinor * BigInt(row.quantity);
        const total = subtotal + row.shippingMinor - row.discountMinor;
        const result = await this.integrations.upsertOrder(organizationId, null, {
          externalId: row.externalRef,
          externalNumber: row.externalRef,
          status: row.status,
          isCod: row.isCod,
          currency: row.currency,
          subtotalMinor: subtotal,
          shippingMinor: row.shippingMinor,
          discountMinor: row.discountMinor,
          taxMinor: 0n,
          totalMinor: total > 0n ? total : 0n,
          refundedMinor: 0n,
          placedAt: row.placedAt ?? new Date(),
          customer: {
            externalId: row.customerPhone,
            firstName: row.customerName ?? row.customerPhone,
            email: row.customerEmail,
            phone: row.customerPhone,
          },
          items: [{
            name: row.itemName, sku: row.itemSku, quantity: row.quantity,
            priceMinor: row.unitPriceMinor, totalMinor: subtotal,
          }],
        }, "csv");
        if (result === "created") success++; else skipped++;
      } catch (e) {
        rowErrors.push({ row: row.rowNumber, message: e instanceof Error ? e.message : "Failed to save row" });
      }
    }
    const failed = rowErrors.length;
    const updated = await (this.prisma as any).importJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED", totalRows, successRows: success,
        failedRows: failed, skippedRows: skipped,
        errors: rowErrors.slice(0, 200), completedAt: new Date(),
      },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "import.orders.csv",
      entityType: "ImportJob", entityId: job.id,
      metadata: { totalRows, success, failed, skipped },
    });
    return updated;
  }

  async listJobs(organizationId: string) {
    return (this.prisma as any).importJob.findMany({
      where: { organizationId }, orderBy: { createdAt: "desc" }, take: 50,
    });
  }

  async getJob(organizationId: string, jobId: string) {
    const job = await (this.prisma as any).importJob.findFirst({ where: { id: jobId, organizationId } });
    if (!job) throw new NotFoundException("Import job not found in this organization");
    return job;
  }
}
