import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { parseProductsCsv, parseOrdersCsv, CsvRowError } from "./csv";
import { ImportProductsCsvDto } from "./imports.dto";

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
    const job = await (this.prisma as any).importJob.create({
      data: { organizationId, kind: "products", status: "PENDING", fileName: dto.fileName ?? null, createdById: actorId },
    });
    const { rows, errors, totalRows } = parseProductsCsv(dto.csvText);
    const rowErrors: CsvRowError[] = [...errors];
    let success = 0, skipped = 0;

    for (const row of rows) {
      try {
        if (row.sku) {
          const dup = await (this.prisma as any).product.findUnique({
            where: { organizationId_sku: { organizationId, sku: row.sku } },
          });
          if (dup) { skipped++; continue; }
        }
        const product = await (this.prisma as any).product.create({
          data: {
            organizationId, name: row.name, sku: row.sku ?? null,
            priceMinor: row.priceMinor, compareAtMinor: row.compareAtMinor ?? null,
            currency: row.currency, stockQuantity: row.stockQuantity ?? null,
            category: row.category ?? null, description: row.description ?? null,
            imageUrl: row.imageUrl ?? null, source: "csv", status: "ACTIVE",
          },
        });
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
      organizationId, userId: actorId, action: "import.products.csv",
      entityType: "ImportJob", entityId: job.id,
      metadata: { totalRows, success, failed, skipped },
    });
    return updated;
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
