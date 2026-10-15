import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { StorageVisibility } from "./storage.service";

/**
 * RM3 — the StoredFile registry: bookkeeping for every object the
 * platform stores, whichever surface put it there. This service is
 * deliberately small and honest about its limits:
 *
 *  - register() is called AFTER an object's bytes actually landed
 *    (never before), and is an upsert on the unique key, so a retried
 *    registration corrects the row instead of duplicating it.
 *  - markTrashed() only flips the status flag; the actual object
 *    deletion and the trash-retention window are RM11's lifecycle
 *    job, not this service.
 *  - usageForOrg() MEASURES. There is no quota enforcement here —
 *    plan-tier storage limits are the owner's values to set (plan
 *    RM3), and until he does, nothing is blocked by size.
 *
 * sizeBytes travels as BigInt end to end (see the schema note) and
 * is serialized to a decimal string at this boundary so no caller
 * ever trips over JSON's BigInt blindness.
 */

export type StoredFileStatus = "quarantine" | "active" | "trashed";

export interface RegisterStoredFileInput {
  organizationId: string;
  bucket: string;
  key: string;
  visibility: StorageVisibility;
  surface: string;
  contentType: string;
  sizeBytes: number | bigint;
  width?: number | null;
  height?: number | null;
  sha256?: string | null;
  status?: StoredFileStatus;
  createdById?: string | null;
  sourceRef?: string | null;
}

export function serializeStoredFile(row: any): any {
  if (!row) return row;
  return {
    ...row,
    sizeBytes: row.sizeBytes != null ? BigInt(row.sizeBytes).toString() : null,
  };
}

@Injectable()
export class StorageRegistryService {
  constructor(private readonly prisma: PrismaService) {}

  private table(): any {
    return (this.prisma as any).storedFile;
  }

  async register(input: RegisterStoredFileInput): Promise<any> {
    const data = {
      organizationId: input.organizationId,
      bucket: input.bucket,
      key: input.key,
      visibility: input.visibility,
      surface: input.surface,
      contentType: input.contentType,
      sizeBytes: BigInt(input.sizeBytes),
      width: input.width ?? null,
      height: input.height ?? null,
      sha256: input.sha256 ?? null,
      status: input.status ?? "active",
      createdById: input.createdById ?? null,
      sourceRef: input.sourceRef ?? null,
    };
    const row = await this.table().upsert({
      where: { key: input.key },
      create: data,
      update: data,
    });
    return serializeStoredFile(row);
  }

  /** Flip a file to trashed (org-guarded). Returns whether a row
   * was actually flipped — a wrong-org or unknown key is a plain
   * false, never a silent "success". */
  async markTrashed(organizationId: string, key: string): Promise<{ key: string; trashed: boolean }> {
    const res = await this.table().updateMany({
      where: { organizationId, key },
      data: { status: "trashed" },
    });
    return { key, trashed: (res?.count ?? 0) > 0 };
  }

  async findByKey(key: string): Promise<any | null> {
    const row = await this.table().findUnique({ where: { key } });
    return serializeStoredFile(row);
  }

  /**
   * Per-org storage usage: total bytes + file count over everything
   * that is NOT trashed, plus a per-surface breakdown. Totals are
   * decimal strings (BigInt-safe). Measurement only — see header.
   */
  async usageForOrg(organizationId: string): Promise<{
    organizationId: string;
    totalBytes: string;
    fileCount: number;
    bySurface: Record<string, { totalBytes: string; fileCount: number }>;
  }> {
    const where = { organizationId, status: { not: "trashed" } };
    const [agg, surfaceRows] = await Promise.all([
      this.table().aggregate({ where, _sum: { sizeBytes: true }, _count: { _all: true } }),
      this.table().groupBy({ by: ["surface"], where, _sum: { sizeBytes: true }, _count: { _all: true } }),
    ]);
    const bySurface: Record<string, { totalBytes: string; fileCount: number }> = {};
    for (const row of surfaceRows ?? []) {
      bySurface[row.surface] = {
        totalBytes: BigInt(row?._sum?.sizeBytes ?? 0).toString(),
        fileCount: row?._count?._all ?? 0,
      };
    }
    return {
      organizationId,
      totalBytes: BigInt(agg?._sum?.sizeBytes ?? 0).toString(),
      fileCount: agg?._count?._all ?? 0,
      bySurface,
    };
  }
}
