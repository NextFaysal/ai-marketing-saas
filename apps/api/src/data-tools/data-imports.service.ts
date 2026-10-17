import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { refreshOrgSearchVectors } from "../products/search-vector";
import {
  checkBundle, BUNDLE_TABLE_KEYS, IMPORT_TABLE_KEYS, type BundleCheckOk,
} from "./org-data-import";

/**
 * ORG16 (Organization Next OB5) — org bundle import/restore.
 *
 * Restores the requester's OWN exported bundle (the AB8 file:
 * { manifest, data }) into a brand-new, still-empty org they own.
 * Design: docs/org-ob5-import-design.md.
 *
 * Honesty rules:
 *  - Validation is pure: the validate path writes NOTHING — no
 *    job row, no audit row, no data.
 *  - The restore itself is ONE transaction: all rows land or
 *    none do. A failed import leaves the target org exactly as
 *    empty as it was; the failure lives on the job row with the
 *    real error, never as a fake success.
 *  - Tables the bundle cannot faithfully restore (people,
 *    billing, connections, transcript-less headers, media bytes)
 *    are reported as skipped with reasons — in the validate
 *    report, in the stored job report, and in the audit metadata
 *    counts — never silently dropped.
 *  - Skipped/search-refresh outcomes are recorded, not hidden:
 *    the post-restore FTS refresh is best-effort and its result
 *    is stamped on the job report either way.
 */

/** Profile fields whose presence means the org is already in use. */
const PROFILE_CONTENT_FIELDS = [
  "description", "industry", "contactEmail", "contactPhone",
  "tradeLicenseNo", "bkashNumber", "nagadNumber",
] as const;

export interface TargetEmptiness {
  empty: boolean;
  counts: { products: number; orders: number; customers: number; leads: number };
  profileFilled: boolean;
}

@Injectable()
export class DataImportsService {
  private readonly logger = new Logger(DataImportsService.name);

  /**
   * Substitutable seam (the DataExportsService.storeFactory
   * pattern): specs replace this with a stub so no raw SQL runs.
   */
  searchVectorRefresher: (prisma: any, orgId: string) => Promise<number> =
    (prisma, orgId) => refreshOrgSearchVectors(prisma, orgId);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------- target emptiness ----------

  async targetEmptiness(organizationId: string): Promise<TargetEmptiness> {
    const p = this.prisma as any;
    const org = await p.organization?.findUnique({ where: { id: organizationId } }).catch(() => null);
    if (!org) throw new NotFoundException("Organization not found");
    const count = async (table: string) => {
      try { return (await p[table]?.count({ where: { organizationId } })) ?? 0; }
      catch { return 0; }
    };
    const [products, orders, customers, leads] = await Promise.all([
      count("product"), count("order"), count("customer"), count("lead"),
    ]);
    let profileFilled = false;
    try {
      const profile = await p.businessProfile?.findUnique({ where: { organizationId } });
      if (profile) {
        profileFilled = PROFILE_CONTENT_FIELDS.some((f) => {
          const v = (profile as any)[f];
          return typeof v === "string" ? v.trim() !== "" : v != null;
        });
      }
    } catch { /* a missing profile is an empty profile */ }
    const counts = { products, orders, customers, leads };
    const empty = !profileFilled && Object.values(counts).every((n) => n === 0);
    return { empty, counts, profileFilled };
  }

  // ---------- report ----------

  private buildReport(check: ReturnType<typeof checkBundle>, target: TargetEmptiness | null) {
    const errors: string[] = [];
    let source: { organizationName: string | null; organizationId: string | null; exportedAt: string | null } | null = null;
    let tables: BundleCheckOk["tables"] = [];
    let totalImportRows = 0;
    let strippedSensitiveFields: string[] = [];
    let nulledReferenceCounts: Record<string, number> = {};
    let warnings: string[] = [];
    if (!check.ok) {
      errors.push(...check.errors);
    } else {
      source = {
        organizationName: check.sourceOrgName,
        organizationId: check.sourceOrgId,
        exportedAt: check.exportedAt,
      };
      tables = check.tables;
      totalImportRows = check.totalImportRows;
      strippedSensitiveFields = check.strippedSensitiveFields;
      nulledReferenceCounts = check.nulledReferenceCounts;
      warnings = check.warnings;
    }
    if (target && !target.empty) errors.push("target_org_not_empty");
    return {
      valid: check.ok && Boolean(target?.empty),
      errors,
      source,
      tables,
      totalImportRows,
      strippedSensitiveFields,
      nulledReferenceCounts,
      warnings,
      targetEmpty: target ? target.empty : null,
      targetCounts: target ? target.counts : null,
      targetProfileFilled: target ? target.profileFilled : null,
    };
  }

  private parseBundle(bundleJson: string): unknown {
    if (typeof bundleJson !== "string" || bundleJson.trim() === "") {
      throw new BadRequestException("bundleJson is required");
    }
    try {
      return JSON.parse(bundleJson);
    } catch {
      throw new BadRequestException("bundleJson is not valid JSON");
    }
  }

  // ---------- validate (writes NOTHING) ----------

  async validateImport(organizationId: string, bundleJson: string) {
    let parsed: unknown = null;
    let parseError: string | null = null;
    try {
      parsed = this.parseBundle(bundleJson);
    } catch (e) {
      parseError = e instanceof Error ? e.message : "bundleJson is not valid JSON";
    }
    const target = await this.targetEmptiness(organizationId);
    if (parseError) {
      return {
        valid: false,
        errors: [parseError],
        source: null,
        tables: [],
        totalImportRows: 0,
        strippedSensitiveFields: [],
        nulledReferenceCounts: {},
        warnings: [],
        targetEmpty: target.empty,
        targetCounts: target.counts,
        targetProfileFilled: target.profileFilled,
      };
    }
    const check = checkBundle(parsed);
    return this.buildReport(check, target);
  }

  // ---------- create (job row + one transaction) ----------

  async createImport(organizationId: string, userId: string, fileName: string | undefined, bundleJson: string) {
    const p = this.prisma as any;
    const parsed = this.parseBundle(bundleJson);
    const check = checkBundle(parsed);
    if (!check.ok) {
      throw new BadRequestException(`Invalid bundle: ${check.errors.join(", ")}`);
    }
    const target = await this.targetEmptiness(organizationId);
    if (!target.empty) {
      throw new ConflictException(
        "Target organization is not empty — bundle restore is only allowed into a brand-new organization",
      );
    }

    const job = await p.dataImport.create({
      data: {
        organizationId,
        requestedById: userId || null,
        status: "running",
        fileName: fileName || null,
        sourceOrgName: check.sourceOrgName,
      },
    });

    const plan = check.plan;
    try {
      await p.$transaction(async (tx: any) => {
        if (plan.profile) {
          const existing = await tx.businessProfile.findUnique({ where: { organizationId } });
          if (existing) {
            await tx.businessProfile.update({ where: { organizationId }, data: plan.profile });
          } else {
            await tx.businessProfile.create({ data: { organizationId, ...plan.profile } });
          }
        }
        if (plan.customers.length) await tx.customer.createMany({ data: plan.customers.map((r) => ({ ...r, organizationId })) });
        if (plan.products.length) await tx.product.createMany({ data: plan.products.map((r) => ({ ...r, organizationId })) });
        if (plan.leads.length) await tx.lead.createMany({ data: plan.leads.map((r) => ({ ...r, organizationId })) });
        if (plan.orders.length) await tx.order.createMany({ data: plan.orders.map((r) => ({ ...r, organizationId })) });
        if (plan.orderItems.length) await tx.orderItem.createMany({ data: plan.orderItems });
      });
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      this.logger.error(`Data import ${job.id} failed: ${message}`);
      try {
        return await p.dataImport.update({
          where: { id: job.id },
          data: { status: "failed", error: message, completedAt: new Date() },
        });
      } catch {
        // The job row vanished mid-restore — surface the failure.
        throw e;
      }
    }

    // Post-restore: rebuild the shop FTS vectors for the restored
    // products (raw-SQL maintained; createMany cannot write them).
    // Best-effort: the restore already committed, so a refresh
    // failure is recorded on the report, never hidden, and does
    // not un-happen the import.
    let searchVectorRefreshed = false;
    if (plan.products.length) {
      try {
        await this.searchVectorRefresher(p, organizationId);
        searchVectorRefreshed = true;
      } catch (e) {
        this.logger.warn(
          `Search-vector refresh after import ${job.id} failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    const tables: Record<string, number> = {};
    for (const t of IMPORT_TABLE_KEYS) tables[t] = check.tables.find((x) => x.table === t)?.rows ?? 0;
    const skippedTables = BUNDLE_TABLE_KEYS.filter(
      (t) => !(IMPORT_TABLE_KEYS as readonly string[]).includes(t),
    );
    const report = {
      ...this.buildReport(check, target),
      searchVectorRefreshed,
      skippedTables,
    };
    const completed = await p.dataImport.update({
      where: { id: job.id },
      data: { status: "completed", report, completedAt: new Date() },
    });
    await this.audit.log({
      organizationId, userId: userId || undefined,
      action: "org.data_imported", entityType: "DataImport", entityId: job.id,
      metadata: { jobId: job.id, tables, rows: check.totalImportRows, skippedTables },
    });
    return completed;
  }

  // ---------- read one job ----------

  async getImport(organizationId: string, importId: string) {
    const p = this.prisma as any;
    const row = await p.dataImport?.findUnique({ where: { id: importId } }).catch(() => null);
    // Foreign-org rows are indistinguishable from missing ones.
    if (!row || row.organizationId !== organizationId) throw new NotFoundException("Import not found");
    return row;
  }
}
