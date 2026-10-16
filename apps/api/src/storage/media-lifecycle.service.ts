import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService, type StorageVisibility } from "./storage.service";
import { serializeStoredFile } from "./storage-registry.service";

/**
 * RM11 — media lifecycle: the sweep that turns the registry's
 * soft states into real storage hygiene. Runs as the
 * `media_lifecycle_sweep` job (AutomationService dispatches here;
 * like audit_retention it is platform-level work — the job row's
 * org is just the scheduler tenant).
 *
 *  (a) Trash purge: StoredFile rows in status "trashed" whose
 *      trash flip (updatedAt — markTrashed is the only writer of
 *      that transition) is older than the retention window get
 *      their object deleted and the row hard-deleted. A failed
 *      object delete KEEPS the row, so the next sweep retries —
 *      a row is never dropped while its bytes may still exist.
 *  (b) Quarantine cleanup: presign flows land uploads under
 *      `_quarantine/`; completes delete their own object, but an
 *      abandoned upload (browser closed mid-flow) leaves one.
 *      Anything under the prefix older than the window is
 *      deleted in BOTH buckets. (The plan also allows an R2
 *      lifecycle rule for this; the sweep keeps the guarantee
 *      inside our own code, independent of dashboard config.)
 *  (c) Orphan REPORT — counts only, never auto-deletes: active
 *      registry rows whose object is gone, and rows whose
 *      owning surface row (product / creative, via sourceRef)
 *      no longer exists. Deleting on suspicion is exactly what
 *      the trash window exists to avoid.
 *  (d) Backup (only when MEDIA_R2_BACKUP_BUCKET is configured):
 *      a JSON snapshot of the whole registry plus a same-key
 *      copy of every private object created in the last 24h.
 *      Unconfigured is reported as "not-configured", plainly.
 */

export const MEDIA_TRASH_RETENTION_DAYS = 30;
export const MEDIA_QUARANTINE_RETENTION_HOURS = 24;
export const MEDIA_BACKUP_PRIVATE_WINDOW_HOURS = 24;
const TRASH_PURGE_TAKE = 1000;
const ORPHAN_SAMPLE_TAKE = 200;
const QUARANTINE_PAGE_LIMIT = 1000;
const QUARANTINE_MAX_PAGES = 20;

export function trashRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const n = Math.floor(Number(env.MEDIA_TRASH_RETENTION_DAYS ?? MEDIA_TRASH_RETENTION_DAYS));
  return Number.isFinite(n) ? Math.min(3650, Math.max(1, n)) : MEDIA_TRASH_RETENTION_DAYS;
}

export function quarantineRetentionHours(env: NodeJS.ProcessEnv = process.env): number {
  const n = Math.floor(Number(env.MEDIA_QUARANTINE_RETENTION_HOURS ?? MEDIA_QUARANTINE_RETENTION_HOURS));
  return Number.isFinite(n) ? Math.min(24 * 30, Math.max(1, n)) : MEDIA_QUARANTINE_RETENTION_HOURS;
}

@Injectable()
export class MediaLifecycleService {
  private readonly logger = new Logger(MediaLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private table(): any {
    return (this.prisma as any).storedFile;
  }

  async runSweep(opts: { now?: Date } = {}) {
    const now = opts.now ?? new Date();
    const days = trashRetentionDays();
    const qHours = quarantineRetentionHours();

    // (a) trash purge ------------------------------------------------
    const trashCutoff = new Date(now.getTime() - days * 86400000);
    const trashed: any[] =
      (await this.table().findMany({
        where: { status: "trashed", updatedAt: { lt: trashCutoff } },
        take: TRASH_PURGE_TAKE,
      }).catch(() => [])) ?? [];
    let trashedPurged = 0;
    let trashedErrors = 0;
    for (const row of trashed) {
      try {
        await this.storage.delete((row.visibility as StorageVisibility) ?? "private", String(row.key));
        await this.table().delete({ where: { id: row.id } });
        trashedPurged += 1;
      } catch (e) {
        trashedErrors += 1;
        this.logger.warn(`trash purge kept ${row.key}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // (b) quarantine cleanup -----------------------------------------
    const quarantineCutoff = new Date(now.getTime() - qHours * 3600000);
    const quarantineDeleted: Record<StorageVisibility, number> = { public: 0, private: 0 };
    for (const visibility of ["public", "private"] as StorageVisibility[]) {
      let cursor: string | undefined;
      for (let page = 0; page < QUARANTINE_MAX_PAGES; page += 1) {
        const res = await this.storage
          .list(visibility, "_quarantine/", { limit: QUARANTINE_PAGE_LIMIT, cursor })
          .catch(() => null);
        if (!res) break;
        for (const obj of res.objects) {
          const modified = obj.lastModified ? new Date(obj.lastModified) : null;
          if (modified && modified < quarantineCutoff) {
            await this.storage.delete(visibility, obj.key).catch(() => undefined);
            quarantineDeleted[visibility] += 1;
          }
        }
        if (!res.truncated || !res.nextCursor) break;
        cursor = res.nextCursor;
      }
    }

    // (c) orphan report (counts only) --------------------------------
    const sample: any[] =
      (await this.table().findMany({
        where: { status: "active" },
        orderBy: { createdAt: "asc" },
        take: ORPHAN_SAMPLE_TAKE,
      }).catch(() => [])) ?? [];
    let missingObjects = 0;
    for (const row of sample) {
      const head = await this.storage
        .head((row.visibility as StorageVisibility) ?? "private", String(row.key))
        .catch(() => null);
      if (!head) missingObjects += 1;
    }
    const danglingSurfaceRows = await this.countDanglingSurfaceRows(sample);

    // (d) backup ------------------------------------------------------
    const backup = await this.runBackup(now);

    return {
      retentionDays: days,
      quarantineHours: qHours,
      trashedPurged,
      trashedErrors,
      quarantineDeleted,
      orphans: {
        sampled: sample.length,
        missingObjects,
        danglingSurfaceRows,
      },
      backup,
    };
  }

  /** Active rows (from the sample) whose owning surface row is
   * gone. Only the two surfaces with a parseable sourceRef
   * convention are checkable — product:{id} and creative:{id};
   * every other row is simply not counted either way. */
  private async countDanglingSurfaceRows(sample: any[]): Promise<number> {
    const wanted: { table: string; id: string }[] = [];
    for (const row of sample) {
      const ref = String(row?.sourceRef ?? "");
      if (row?.surface === "product" && ref.startsWith("product:")) {
        wanted.push({ table: "product", id: ref.slice("product:".length) });
      } else if (row?.surface === "creative" && ref.startsWith("creative:")) {
        wanted.push({ table: "creativeAsset", id: ref.slice("creative:".length) });
      }
    }
    if (!wanted.length) return 0;
    let dangling = 0;
    for (const table of ["product", "creativeAsset"]) {
      const ids = [...new Set(wanted.filter((w) => w.table === table).map((w) => w.id))];
      if (!ids.length) continue;
      const rows: any[] =
        (await (this.prisma as any)[table]?.findMany({ where: { id: { in: ids } } }).catch(() => [])) ?? [];
      const alive = new Set(rows.map((r: any) => String(r.id)));
      dangling += ids.filter((id) => !alive.has(id)).length;
    }
    return dangling;
  }

  private async runBackup(now: Date) {
    const bucket = this.storage.backupBucket();
    if (!bucket) return "not-configured" as const;
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");
    const snapshotKey = `backup/registry-${yyyy}-${mm}-${dd}.json`;

    const all: any[] =
      (await this.table().findMany({ take: 100000 }).catch(() => [])) ?? [];
    const snapshot = Buffer.from(
      JSON.stringify(
        {
          exportedAt: now.toISOString(),
          count: all.length,
          files: all.map((r: any) => serializeStoredFile(r)),
        },
        null,
        2,
      ),
      "utf8",
    );
    await this.storage.putBackupObject(snapshotKey, snapshot, "application/json");

    const windowStart = new Date(now.getTime() - MEDIA_BACKUP_PRIVATE_WINDOW_HOURS * 3600000);
    const fresh: any[] =
      (await this.table().findMany({
        where: { visibility: "private", status: "active", createdAt: { gte: windowStart } },
        take: 5000,
      }).catch(() => [])) ?? [];
    let privateCopied = 0;
    let privateFailed = 0;
    for (const row of fresh) {
      try {
        const ok = await this.storage.copyToBackupObject(
          { visibility: "private", key: String(row.key) },
          String(row.key),
        );
        if (ok) privateCopied += 1;
        else privateFailed += 1;
      } catch {
        privateFailed += 1;
      }
    }
    return { bucket, snapshotKey, registryRows: all.length, privateCopied, privateFailed };
  }
}
