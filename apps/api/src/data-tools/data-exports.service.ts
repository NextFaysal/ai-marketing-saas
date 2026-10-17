import { BadRequestException, ConflictException, GoneException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { MediaStore } from "../inbox/media-store";
import { buildOrgDataBundle } from "../organizations/org-data-export";

/**
 * AB8 (AX25) — Merchant Data Tools.
 *
 * Self-service org data exports (the file pipeline over the same
 * bundle the platform admin export builds — see
 * organizations/org-data-export.ts), a weekly scheduled-backup
 * preference with retention, and the org-scoped audit viewer.
 *
 * Honesty rules:
 *  - An export file exists only when generate() actually stored
 *    it; a failed generation is a `failed` row with the real
 *    error (truncated to 500 chars), never a fake `ready`.
 *  - Downloads verify the row, the org, the status and the
 *    expiry against the real stored bytes: an expired export is
 *    marked expired and answers 410; a `ready` row whose stored
 *    bytes are missing is ALSO marked expired (with an error
 *    note recording the loss) and answers 410 — the file is
 *    gone either way, and `failed` would wrongly imply the
 *    generation itself failed.
 *  - The audit viewer shows ORG-STAMPED AuditLog rows ONLY
 *    (AuditLog.organizationId = this org). Platform-level rows
 *    without org context are never shown and never re-scoped;
 *    responses carry scopeNote "org_stamped_only" so the UI can
 *    label the coverage honestly.
 *
 * Exports are generated INLINE when the estimated org size is
 * at most 25,000 rows; larger exports stay `pending` for the
 * `data_export_generate` automation job. Files expire 7 days
 * after generation.
 */

/**
 * OU12: bundle sections that can NEVER be restored from the
 * export file, with the reason — surfaced verbatim by backup
 * verification so the limit is part of the recorded result,
 * not fine print. (Products/orders/customers are not listed:
 * they are plain records, but no import engine accepts the
 * bundle format, so their restore is equally unbuilt — the
 * verification result's `restoreSupported: false` covers the
 * whole bundle.)
 */
export const OU12_NON_RESTORABLE_SECTIONS: Array<{ section: string; reason: string }> = [
  { section: "integrations", reason: "Export carries provider/status metadata only — credentials are never exported, so connections cannot be recreated from the file." },
  { section: "mediaAssets", reason: "Export carries media metadata only (no file bytes), so media cannot be recreated from the file." },
  { section: "members", reason: "Member rows reference global user accounts; the bundle contains no credentials and cannot recreate users." },
  { section: "payments", reason: "SaaS payment rows are billing records of truth; recreating them would fabricate payment history." },
  { section: "subscription", reason: "The SaaS plan subscription is live billing state, not restorable data." },
  { section: "organization", reason: "The organization row carries live state (e.g. credit balance and verification status) from the source org." },
];

export const DATA_EXPORT_INLINE_MAX_ROWS = 25_000;
export const DATA_EXPORT_TTL_MS = 7 * 86_400_000;
export const BACKUP_INTERVAL_MS = 7 * 86_400_000;
export const BACKUP_RETENTION_READY = 4;

export interface DataExportStore {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

/** Org-scoped tables whose `count` feeds the size estimate. */
const COUNTABLE_TABLES = [
  "membership", "product", "order", "customer", "lead", "channelConversation",
  "campaignPlan", "integration", "saasPayment", "supportTicket", "mediaAsset",
  "businessProfile", "subscription",
] as const;

@Injectable()
export class DataExportsService {
  private readonly logger = new Logger(DataExportsService.name);

  /**
   * Substitutable store seam (the EmailProvider.tenantTransportFactory
   * pattern): specs replace this factory with an in-memory store so
   * they never touch disk or S3.
   */
  storeFactory: () => DataExportStore = () => MediaStore.fromEnv();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------- size estimate ----------

  /** Total estimated rows over the export tables (counts only). */
  async estimateExportRows(organizationId: string): Promise<number> {
    const p = this.prisma as any;
    let total = 1; // the organization row itself
    for (const table of COUNTABLE_TABLES) {
      try {
        const n = await p[table]?.count({ where: { organizationId } });
        if (typeof n === "number") total += n;
      } catch { /* a missing delegate counts as 0 — the estimate stays an estimate */ }
    }
    try {
      // OrderItem has no organizationId — count through its order.
      const n = await p.orderItem?.count({ where: { order: { organizationId } } });
      if (typeof n === "number") total += n;
    } catch { /* relation count unavailable — estimate proceeds without it */ }
    return total;
  }

  // ---------- create / generate ----------

  async createExport(organizationId: string, userId: string, kind: "manual" | "backup") {
    const p = this.prisma as any;
    const estimate = await this.estimateExportRows(organizationId);
    const mode: "inline" | "queued" = estimate <= DATA_EXPORT_INLINE_MAX_ROWS ? "inline" : "queued";
    const row = await p.dataExport.create({
      data: { organizationId, requestedById: userId || null, kind, status: "pending" },
    });
    await this.audit.log({
      organizationId, userId: userId || undefined,
      action: "data_export.create", entityType: "DataExport", entityId: row.id,
      metadata: { kind, mode, estimatedRows: estimate },
    });
    if (mode === "inline") {
      const generated = await this.generate(row.id);
      return generated ?? row;
    }
    return row;
  }

  /**
   * Build + store the export file for one row. NEVER throws:
   * both the inline path and the automation job call this, and a
   * failure must land on the row (`failed` + real error), not in
   * the caller's face. Returns the updated row, or null when the
   * export row itself does not exist.
   */
  async generate(exportId: string): Promise<any | null> {
    const p = this.prisma as any;
    let row: any = null;
    try {
      row = await p.dataExport.findUnique({ where: { id: exportId } });
      if (!row) return null;
      const exportedBy = await this.resolveExporterLabel(row);
      const bundle = await buildOrgDataBundle(p, row.organizationId, { exportedBy });
      const fileBody = { manifest: bundle.manifest, data: bundle.data };
      const bytes = Buffer.from(JSON.stringify(fileBody), "utf8");
      const key = `data-exports/${row.organizationId}/${exportId}.json`;
      await this.storeFactory().put(key, bytes, "application/json");
      const now = new Date();
      return await p.dataExport.update({
        where: { id: exportId },
        data: {
          status: "ready", fileRef: key, sizeBytes: bytes.length, error: null,
          completedAt: now, expiresAt: new Date(now.getTime() + DATA_EXPORT_TTL_MS),
        },
      });
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      this.logger.error(`Data export ${exportId} failed: ${message}`);
      if (row) {
        try {
          return await p.dataExport.update({
            where: { id: exportId },
            data: { status: "failed", error: message },
          });
        } catch { /* the row vanished mid-generation — nothing left to mark */ }
      }
      return null;
    }
  }

  private async resolveExporterLabel(row: any): Promise<string> {
    if (!row.requestedById) return row.kind === "backup" ? "backup-sweep" : "system";
    try {
      const user = await (this.prisma as any).user?.findUnique({
        where: { id: row.requestedById },
        select: { email: true },
      });
      return user?.email ?? row.requestedById;
    } catch {
      return row.requestedById;
    }
  }

  // ---------- list / download ----------

  async listExports(organizationId: string) {
    const p = this.prisma as any;
    const exports = await p.dataExport.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }).catch(() => []);
    const pref = await p.orgBackupPreference?.findUnique({ where: { organizationId } }).catch(() => null) ?? null;
    return {
      exports,
      backupPreference: {
        enabled: Boolean(pref?.enabled),
        lastBackupAt: pref?.lastBackupAt ?? null,
      },
    };
  }

  async download(organizationId: string, exportId: string) {
    const p = this.prisma as any;
    const row = await p.dataExport.findUnique({ where: { id: exportId } }).catch(() => null);
    // Foreign-org rows are indistinguishable from missing ones.
    if (!row || row.organizationId !== organizationId) throw new NotFoundException("Export not found");
    if (row.status === "expired") throw new GoneException("This export has expired");
    if (row.status !== "ready") throw new ConflictException(`Export is not ready for download (status: ${row.status})`);
    if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) {
      await p.dataExport.update({ where: { id: exportId }, data: { status: "expired" } }).catch(() => undefined);
      throw new GoneException("This export has expired");
    }
    if (!row.fileRef) {
      await p.dataExport.update({
        where: { id: exportId },
        data: { status: "expired", error: "Export record has no stored file reference" },
      }).catch(() => undefined);
      throw new GoneException("The stored export file is missing");
    }
    const bytes = await this.storeFactory().get(row.fileRef);
    if (!bytes) {
      // The row said ready but the bytes are gone: mark expired
      // (the download window is over in practice) with the loss
      // recorded in `error`, and answer 410 honestly.
      await p.dataExport.update({
        where: { id: exportId },
        data: { status: "expired", error: "Stored export file is missing" },
      }).catch(() => undefined);
      throw new GoneException("The stored export file is missing");
    }
    return {
      bytes,
      filename: `qosprey-data-export-${organizationId}-${exportId}.json`,
      sizeBytes: typeof row.sizeBytes === "number" ? row.sizeBytes : bytes.length,
    };
  }

  // ---------- OU12: backup verification (NOT a restore) ----------

  /**
   * OU12 — verify a stored export/backup file: the honest
   * subset of "backup restore" that the bundle actually
   * supports. Step-0 evidence (docs/one-umbrella-ou12-section.md):
   * the bundle does NOT round-trip — there is no bundle import
   * machinery anywhere in the repo, integration credentials are
   * never exported, media is metadata-only, member rows point at
   * global User records, payments/subscription are billing
   * records of truth, and every id is the source org's own (a
   * same-org restore would collide on primary keys; a cross-org
   * one would need a full id-remapping import engine that does
   * not exist). Building a "restore" on top of that would be a
   * fake feature, so OU12 builds VERIFICATION instead:
   *
   *  - OWNER-only (controller) + the caller must type the org
   *    slug exactly — the same confirm discipline a restore
   *    would have required.
   *  - READ-ONLY against org data: nothing is created, updated
   *    or deleted except this export row's own verification
   *    record (backupVerifiedAt + backupVerification) and the
   *    audit entry. No pre-restore safety export is needed
   *    precisely because nothing is overwritten — that step
   *    belongs to a real restore, which is NOT BUILT.
   *  - The check itself: row ownership/status/expiry, stored
   *    bytes present, bytes parse as JSON, manifest + data
   *    present, per-table row counts in `data` match the
   *    manifest, truncated tables surfaced, and the
   *    non-restorable sections listed WITH reasons.
   *  - `restoreSupported` is always false in the result — the
   *    field exists so no client can mistake a passed
   *    verification for restore capability.
   */
  async verifyBackup(organizationId: string, userId: string, exportId: string, confirmSlug: unknown) {
    const p = this.prisma as any;
    const org = await p.organization?.findUnique({ where: { id: organizationId } }).catch(() => null);
    if (!org) throw new NotFoundException("Organization not found");
    if (typeof confirmSlug !== "string" || confirmSlug.trim() !== String(org.slug)) {
      throw new BadRequestException("নিশ্চিত করতে প্রতিষ্ঠানের slug হুবহু লিখুন");
    }
    const row = await p.dataExport.findUnique({ where: { id: exportId } }).catch(() => null);
    // Foreign-org rows are indistinguishable from missing ones (download parity).
    if (!row || row.organizationId !== organizationId) throw new NotFoundException("Export not found");

    const problems: string[] = [];
    const counts: Record<string, { manifest: number; actual: number }> = {};
    let truncatedTables: string[] = [];
    let sectionsPresent: string[] = [];

    if (row.status !== "ready") problems.push(`status_not_ready:${row.status}`);
    if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) problems.push("export_expired");
    if (!row.fileRef) problems.push("no_file_ref");

    let bundle: any = null;
    if (row.fileRef) {
      const bytes = await this.storeFactory().get(row.fileRef).catch(() => null);
      if (!bytes) {
        problems.push("stored_file_missing");
      } else {
        try {
          bundle = JSON.parse(bytes.toString("utf8"));
        } catch {
          problems.push("file_not_valid_json");
        }
      }
    }
    if (bundle) {
      const manifest = bundle.manifest;
      const data = bundle.data;
      if (!manifest || typeof manifest !== "object") problems.push("manifest_missing");
      if (!data || typeof data !== "object") problems.push("data_missing");
      if (manifest && data) {
        sectionsPresent = Object.keys(data);
        const tables: Record<string, any> = manifest.tables ?? {};
        truncatedTables = Object.entries(tables).filter(([, v]: any) => v?.truncated).map(([k]) => k);
        for (const [key, stat] of Object.entries(tables) as Array<[string, any]>) {
          const value = (data as any)[key];
          const actual = Array.isArray(value) ? value.length : value == null ? 0 : 1;
          const manifestRows = Number(stat?.rows ?? 0);
          counts[key] = { manifest: manifestRows, actual };
          if (actual !== manifestRows) problems.push(`count_mismatch:${key}`);
        }
      }
    }

    const verification = {
      ok: problems.length === 0,
      problems,
      counts,
      truncatedTables,
      sectionsPresent,
      nonRestorableSections: OU12_NON_RESTORABLE_SECTIONS.filter((s) => sectionsPresent.includes(s.section)),
    };
    const verifiedAt = new Date();
    const updated = await p.dataExport.update({
      where: { id: exportId },
      data: { backupVerifiedAt: verifiedAt, backupVerification: verification },
    }).catch(() => null);
    await this.audit.log({
      organizationId, userId: userId || undefined,
      action: "data_export.backup_verified", entityType: "DataExport", entityId: exportId,
      metadata: {
        ok: verification.ok, problems, truncatedTables,
        restoreSupported: false, recordedOnRow: Boolean(updated),
      },
    });
    return {
      exportId,
      kind: row.kind as string,
      verifiedAt: verifiedAt.toISOString(),
      verification,
      restoreSupported: false as const,
      restoreNote:
        "এই যাচাই শুধু ফাইলটি অক্ষত ও পাঠযোগ্য কিনা নিশ্চিত করে — restore সুবিধা নেই, কারণ এক্সপোর্ট বান্ডলটি restore-এর জন্য তৈরি নয় (তথ্য docs/one-umbrella-ou12-section.md-তে)।",
    };
  }

  // ---------- backup preference + sweeps ----------

  async setBackupPreference(organizationId: string, userId: string, enabled: boolean) {
    const p = this.prisma as any;
    const pref = await p.orgBackupPreference.upsert({
      where: { organizationId },
      create: { organizationId, enabled },
      update: { enabled },
    });
    await this.audit.log({
      organizationId, userId: userId || undefined,
      action: "data_export.backup_preference", entityType: "OrgBackupPreference", entityId: pref.id,
      metadata: { enabled },
    });
    return pref;
  }

  /** `data_export_generate` job body: generate every pending row for the org. */
  async runPendingForOrg(organizationId: string) {
    const p = this.prisma as any;
    const pending = await p.dataExport.findMany({
      where: { organizationId, status: "pending" },
      orderBy: { createdAt: "asc" },
    }).catch(() => []);
    let ready = 0;
    let failed = 0;
    for (const row of pending as any[]) {
      const out = await this.generate(row.id);
      if (out?.status === "ready") ready++;
      else failed++;
    }
    return { total: (pending as any[]).length, ready, failed };
  }

  /**
   * `org_backup_sweep` job body. When the org's weekly backup is
   * enabled and due (no lastBackupAt, or ≥ 7 days old): create +
   * generate a backup export, stamp lastBackupAt on success, and
   * enforce retention — the newest 4 READY backups are kept;
   * older ready backups lose their stored file and are marked
   * expired. Failure-isolated: this method reports, never throws,
   * so one org's failure cannot stop the sweep for other orgs.
   */
  async runBackupSweepForOrg(organizationId: string) {
    const p = this.prisma as any;
    try {
      const pref = await p.orgBackupPreference?.findUnique({ where: { organizationId } }).catch(() => null) ?? null;
      if (!pref?.enabled) return { skipped: "backup_disabled" as const };
      const last = pref.lastBackupAt ? new Date(pref.lastBackupAt).getTime() : 0;
      if (last && Date.now() - last < BACKUP_INTERVAL_MS) {
        return { skipped: "not_due" as const, lastBackupAt: pref.lastBackupAt };
      }
      const created = await this.createExport(organizationId, "system", "backup");
      const finalRow = created?.status === "ready" || created?.status === "failed"
        ? created
        : await this.generate(created.id);
      if (!finalRow || finalRow.status !== "ready") {
        return { created: created?.id ?? null, ready: false, error: finalRow?.error ?? "backup generation failed" };
      }
      await p.orgBackupPreference.upsert({
        where: { organizationId },
        create: { organizationId, enabled: true, lastBackupAt: new Date() },
        update: { lastBackupAt: new Date() },
      });
      // Retention: keep the newest 4 READY backup exports.
      const readyBackups = await p.dataExport.findMany({
        where: { organizationId, kind: "backup", status: "ready" },
        orderBy: { createdAt: "desc" },
      }).catch(() => []);
      const store = this.storeFactory();
      let expiredOld = 0;
      for (const old of (readyBackups as any[]).slice(BACKUP_RETENTION_READY)) {
        if (old.fileRef) await store.delete(old.fileRef).catch(() => undefined);
        await p.dataExport.update({ where: { id: old.id }, data: { status: "expired" } }).catch(() => undefined);
        expiredOld++;
      }
      return { created: finalRow.id, ready: true, expiredOld };
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      this.logger.error(`Backup sweep failed for org ${organizationId}: ${message}`);
      return { ready: false, error: message };
    }
  }

  // ---------- AX25a: org-scoped audit viewer ----------

  /**
   * The org audit viewer: AuditLog rows STAMPED with this org's
   * id only. Rows without org context (platform auth events,
   * admin actions logged without an org, …) are NOT shown —
   * their scoping is never fabricated. `scopeNote` states this
   * in the payload so the UI can label coverage honestly.
   */
  async listAuditLogs(organizationId: string, filters: {
    entity?: string; actorId?: string; from?: string; to?: string;
    page?: number; pageSize?: number;
  } = {}) {
    const p = this.prisma as any;
    const page = Math.max(1, Math.floor(filters.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Math.floor(filters.pageSize ?? 50) || 50));
    const where: any = { organizationId };
    if (filters.entity) where.entityType = filters.entity;
    if (filters.actorId) where.userId = filters.actorId;
    const createdAt: any = {};
    const from = filters.from ? new Date(filters.from) : null;
    const to = filters.to ? new Date(filters.to) : null;
    if (from && !Number.isNaN(from.getTime())) createdAt.gte = from;
    if (to && !Number.isNaN(to.getTime())) createdAt.lte = to;
    if (Object.keys(createdAt).length) where.createdAt = createdAt;

    const total = await p.auditLog.count({ where }).catch(() => 0);
    const rows = await p.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }).catch(() => []);

    const actorIds = [...new Set((rows as any[]).map((r) => r.userId).filter(Boolean))] as string[];
    const actors = actorIds.length
      ? await p.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, email: true, name: true },
        }).catch(() => [])
      : [];
    const actorById = new Map((actors as any[]).map((u) => [u.id, u]));

    return {
      total,
      page,
      pageSize,
      scopeNote: "org_stamped_only" as const,
      items: (rows as any[]).map((r) => {
        const actor = r.userId ? actorById.get(r.userId) : undefined;
        return {
          id: r.id,
          createdAt: r.createdAt,
          actor: actor ? { id: actor.id, email: actor.email, name: actor.name } : null,
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId ?? null,
          metadata: r.metadata ?? null,
        };
      }),
    };
  }
}
