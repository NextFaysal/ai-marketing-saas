import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { parseProductsCsv, CsvRowError } from "./csv";
import { ImportProductsCsvDto } from "./imports.dto";

/**
 * Milestone 2 scope: synchronous import for files up to ~2 MB.
 * Duplicate SKUs inside the same organization are SKIPPED, never
 * overwritten, so an accidental re-upload cannot destroy edited data.
 * Larger files move to S3 + worker queue in a later milestone.
 */
@Injectable()
export class ImportsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

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
