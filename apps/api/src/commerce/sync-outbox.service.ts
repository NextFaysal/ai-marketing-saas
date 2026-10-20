import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { stableContentHash } from "../integrations/commerce/content-hash";
import { CAPABILITY_NOT_IMPLEMENTED } from "../integrations/commerce/adapter";
import { CommerceAdapterRegistry, platformKeyForStore } from "../integrations/commerce/adapters";
import { badRequest, notFound } from "../i18n";

export const MAX_ATTEMPTS = 5;

export function backoffSeconds(attempts: number): number {
  return Math.min(3600, 30 * Math.pow(2, Math.max(0, attempts - 1)));
}

@Injectable()
export class SyncOutboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: CommerceAdapterRegistry,
  ) {}

  async enqueue(input: {
    organizationId: string;
    storeId: string;
    entityType: string;
    entityId: string;
    operation: string;
    payload: Record<string, any>;
    idempotencyKey?: string;
  }) {
    const payloadHash = stableContentHash(input.payload);
    const key =
      input.idempotencyKey ??
      createHash("sha256")
        .update(`${input.organizationId}|${input.storeId}|${input.entityType}|${input.entityId}|${input.operation}|${payloadHash}`, "utf8")
        .digest("hex");
    const existing = await (this.prisma as any).syncOutbox.findFirst({ where: { idempotencyKey: key } });
    if (existing) return existing;
    // Also guard org-scoped duplicate check for fakes that match differently: findFirst above is the dedupe.
    return (this.prisma as any).syncOutbox.create({
      data: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        entityType: input.entityType,
        entityId: input.entityId,
        operation: input.operation,
        payload: input.payload,
        payloadHash,
        idempotencyKey: key,
        status: "pending",
        attempts: 0,
        nextRetryAt: new Date(),
      },
    });
  }

  async processDue(opts: { organizationId?: string; now?: Date; limit?: number; onlyId?: string } = {}): Promise<{ processed: number; done: number; failed: number; dead: number }> {
    const now = opts.now ?? new Date();
    const limit = opts.limit ?? 50;
    const where: Record<string, any> = {};
    if (opts.organizationId) where.organizationId = opts.organizationId;
    let rows: any[] = [];
    try {
      rows = await (this.prisma as any).syncOutbox.findMany({
        where,
        orderBy: { createdAt: "asc" },
      });
    } catch {
      rows = [];
    }
    const due = (rows ?? []).filter((r: any) => {
      if (opts.onlyId) return r.id === opts.onlyId && (r.status === "pending" || r.status === "failed");
      if (r.status === "pending") return true;
      if (r.status === "failed" && r.nextRetryAt != null && new Date(r.nextRetryAt).getTime() <= now.getTime()) return true;
      return false;
    });
    // Ensure createdAt asc ordering even if fake didn't sort
    due.sort((a: any, b: any) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime());
    const selected = due.slice(0, limit);

    let processed = 0;
    let done = 0;
    let failed = 0;
    let dead = 0;
    const perStore = new Map<string, number>();

    for (const row of selected) {
      const countForStore = perStore.get(row.storeId) ?? 0;
      if (countForStore >= 20) continue;
      perStore.set(row.storeId, countForStore + 1);

      const attempts = (row.attempts ?? 0) + 1;
      await (this.prisma as any).syncOutbox.update({ where: { id: row.id }, data: { status: "processing", attempts } }).catch(() => undefined);
      processed++;

      // Load store org-scoped
      let store: any = null;
      try {
        store = await (this.prisma as any).store.findFirst({ where: { id: row.storeId, organizationId: row.organizationId } });
      } catch { store = null; }
      if (!store) {
        const isDead = attempts >= MAX_ATTEMPTS;
        await (this.prisma as any).syncOutbox.update({
          where: { id: row.id },
          data: isDead
            ? { status: "dead", lastError: "store_not_found", nextRetryAt: null }
            : { status: "failed", lastError: "store_not_found", nextRetryAt: new Date(now.getTime() + backoffSeconds(attempts) * 1000) },
        });
        if (isDead) dead++; else failed++;
        continue;
      }

      const platformKey = platformKeyForStore(store.platform);
      const adapter = this.registry.get(platformKey);
      if (!adapter) {
        await (this.prisma as any).syncOutbox.update({
          where: { id: row.id },
          data: { status: "failed", lastError: CAPABILITY_NOT_IMPLEMENTED, nextRetryAt: null },
        });
        failed++;
        continue;
      }

      let integration: any = undefined;
      try {
        integration = await (this.prisma as any).integration.findFirst({
          where: { organizationId: row.organizationId, storeId: row.storeId, provider: platformKey },
          include: { credential: true, store: true },
        });
      } catch { integration = undefined; }
      if (integration === null) integration = undefined;

      let result: { ok: boolean; error?: string; responseSummary?: any };
      try {
        result = await adapter.execute({
          organizationId: row.organizationId,
          store,
          integration,
          operation: row.operation,
          payload: row.payload ?? {},
        });
      } catch (e) {
        result = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }

      if (result.ok) {
        await (this.prisma as any).syncOutbox.update({
          where: { id: row.id },
          data: { status: "done", responseSummary: result.responseSummary ?? undefined, lastError: null, nextRetryAt: null },
        });
        done++;
      } else if (result.error === CAPABILITY_NOT_IMPLEMENTED) {
        await (this.prisma as any).syncOutbox.update({
          where: { id: row.id },
          data: { status: "failed", lastError: result.error, nextRetryAt: null, responseSummary: result.responseSummary ?? undefined },
        });
        failed++;
      } else {
        const errMsg = result.error ?? "unknown_error";
        if (attempts >= MAX_ATTEMPTS) {
          await (this.prisma as any).syncOutbox.update({
            where: { id: row.id },
            data: { status: "dead", lastError: errMsg, nextRetryAt: null, responseSummary: result.responseSummary ?? undefined },
          });
          dead++;
        } else {
          await (this.prisma as any).syncOutbox.update({
            where: { id: row.id },
            data: { status: "failed", lastError: errMsg, nextRetryAt: new Date(now.getTime() + backoffSeconds(attempts) * 1000), responseSummary: result.responseSummary ?? undefined },
          });
          failed++;
        }
      }
    }
    return { processed, done, failed, dead };
  }

  async processDueForOrg(orgId: string) {
    return this.processDue({ organizationId: orgId });
  }

  async replay(organizationId: string, id: string) {
    const row = await (this.prisma as any).syncOutbox.findFirst({ where: { id, organizationId } });
    if (!row) throw notFound("commerce.syncOutboxItemNotFound");
    if (row.status !== "failed" && row.status !== "dead") {
      throw badRequest("commerce.outboxReplayStates");
    }
    return (this.prisma as any).syncOutbox.update({
      where: { id: row.id },
      data: { status: "pending", attempts: 0, nextRetryAt: new Date(), lastError: null },
    });
  }

  async list(organizationId: string, opts: { storeId?: string; status?: string; page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, Math.floor(opts.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Math.floor(opts.pageSize ?? 20) || 20));
    const where: Record<string, any> = { organizationId };
    if (opts.storeId) where.storeId = opts.storeId;
    if (opts.status) where.status = opts.status;
    let total: number;
    const table = (this.prisma as any).syncOutbox;
    if (typeof table.count === "function") {
      try { total = await table.count({ where }); } catch { total = 0; }
      const items = await table.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize });
      return { items, total, page, pageSize };
    }
    const all = await table.findMany({ where, orderBy: { createdAt: "desc" } });
    total = all.length;
    const items = all.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    return { items, total, page, pageSize };
  }
}
