import {
  BadRequestException, Injectable, NotFoundException, Optional,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { isOrderLimitBlocked } from "../common/plan-limit-checks";
import { PosService } from "./pos.service";
import type {
  CreatePosSaleDto, DiscardOfflineSyncDto, OfflineSyncDto, RepostOfflineSyncDto,
} from "./pos.dto";

/**
 * AB4 (AX6) — offline POS sales sync ledger.
 *
 * The client's localStorage outbox is only the transport; this
 * PosOfflineSync row is the durable record staff act on. Every
 * sync attempt posts through PosService.createSale (the ONE
 * door — server prices, evaluator, stock hooks), with the
 * offline idempotencyKey riding the sale itself so a retried
 * sync replays instead of double-selling.
 *
 * Classification (deterministic, decided BEFORE/AROUND the
 * createSale call — see attempt()):
 *   unknown / inactive product or variant mismatch → rejected
 *   tracked-stock insufficiency                     → conflict
 *   plan order-limit block                          → conflict
 *   stock refusal racing in from createSale         → conflict
 *   any other createSale error                      → rejected
 *   success                                         → synced
 * A conflict is staff-actionable (repost, optionally forced, or
 * discard); a rejection is terminal except for discard.
 * Server totals are truth: varianceMinor = server − local is
 * recorded even when 0 (null only when the client sent no
 * local total).
 */

const PRODUCT_MISSING = "পণ্যটি পাওয়া যায়নি বা বন্ধ আছে";
const VARIANT_MISMATCH = "ভ্যারিয়েন্টটি এই পণ্যের নয়";
const STOCK_MARKER = "স্টকে মাত্র";

function stockMessage(name: string, stock: unknown): string {
  return `দুঃখিত, "${name}"-এর স্টকে মাত্র ${stock}টি আছে — এর বেশি অর্ডার করা যাবে না`;
}

function bigStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  try { return BigInt(v as any).toString(); } catch { return String(v); }
}

function toBigIntOrNull(v: unknown): bigint | null {
  if (v === null || v === undefined) return null;
  try { return BigInt(v as any); } catch { return null; }
}

@Injectable()
export class PosOfflineService {
  constructor(
    private readonly pos: PosService,
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private t(name: string): any {
    return (this.prisma as any)[name];
  }

  private ledger(): any {
    return this.t("posOfflineSync");
  }

  private serialize(row: any, sale?: any) {
    if (!row) return row;
    return {
      id: row.id,
      organizationId: row.organizationId,
      idempotencyKey: row.idempotencyKey,
      cashierId: row.cashierId ?? null,
      localReceiptNo: row.localReceiptNo ?? null,
      localTotalMinor: bigStr(row.localTotalMinor),
      payload: row.payload ?? null,
      status: row.status,
      reason: row.reason ?? null,
      serverOrderId: row.serverOrderId ?? null,
      serverTotalMinor: bigStr(row.serverTotalMinor),
      varianceMinor: bigStr(row.varianceMinor),
      discardNote: row.discardNote ?? null,
      attempts: row.attempts ?? 0,
      createdAt: row.createdAt ?? null,
      updatedAt: row.updatedAt ?? null,
      syncedAt: row.syncedAt ?? null,
      ...(sale !== undefined ? { sale } : {}),
    };
  }

  private async findByKey(orgId: string, key: string): Promise<any | null> {
    const table = this.ledger();
    if (!table?.findFirst) return null;
    return (await table.findFirst({
      where: { organizationId: orgId, idempotencyKey: key },
    }).catch(() => null)) ?? null;
  }

  private async findById(orgId: string, id: string): Promise<any | null> {
    const table = this.ledger();
    if (!table?.findFirst) return null;
    return (await table.findFirst({
      where: { id, organizationId: orgId },
    }).catch(() => null)) ?? null;
  }

  private async saveRow(id: string, data: Record<string, any>): Promise<any> {
    const table = this.ledger();
    if (table?.update) {
      return table.update({ where: { id }, data }).catch(() => null);
    }
    return null;
  }

  /**
   * Deterministic pre-checks + the createSale attempt for one
   * stored payload. Returns the outcome fields to persist on
   * the ledger row (plus the sale result when one was posted).
   * Never throws for a sale-level failure — the failure IS the
   * classification.
   */
  private async attempt(
    orgId: string,
    actorId: string,
    saleDto: CreatePosSaleDto,
    idempotencyKey: string,
    localTotalMinor: bigint | null,
    opts?: { forceStock?: boolean },
  ): Promise<{
    status: string; reason: string | null;
    serverOrderId: string | null; serverTotalMinor: bigint | null;
    varianceMinor: bigint | null; syncedAt: Date | null; sale: any;
  }> {
    const rejected = (reason: string) => ({
      status: "rejected", reason: reason.slice(0, 500),
      serverOrderId: null, serverTotalMinor: null, varianceMinor: null,
      syncedAt: null, sale: null,
    });
    const conflict = (reason: string) => ({
      status: "conflict", reason: reason.slice(0, 500),
      serverOrderId: null, serverTotalMinor: null, varianceMinor: null,
      syncedAt: null, sale: null,
    });

    // --- pre-checks (mirror createSale's own rules) ---
    const items = Array.isArray(saleDto?.items) ? saleDto.items : [];
    if (items.length === 0) return rejected("কমপক্ষে একটি পণ্য যোগ করুন");
    // Aggregate duplicate (product, variant) lines before the
    // stock check — same rule as createSale.
    const aggregated = new Map<string, { productId: string; variantId: string | null; quantity: number }>();
    for (const item of items as any[]) {
      const key = `${item?.productId}::${item?.variantId ?? ""}`;
      const prev = aggregated.get(key);
      if (prev) prev.quantity += Number(item?.quantity ?? 0);
      else aggregated.set(key, {
        productId: item?.productId, variantId: item?.variantId ?? null,
        quantity: Number(item?.quantity ?? 0),
      });
    }
    for (const line of aggregated.values()) {
      const product = await this.t("product").findFirst({
        where: { id: line.productId, organizationId: orgId, status: "ACTIVE" },
      }).catch(() => null);
      if (!product) return rejected(PRODUCT_MISSING);
      let variant: any = null;
      if (line.variantId) {
        variant = await this.t("productVariant").findFirst({
          where: { id: line.variantId, productId: product.id },
        }).catch(() => null);
        if (!variant) return rejected(VARIANT_MISMATCH);
      }
      if (!opts?.forceStock && !product.preorderEnabled) {
        const stock = variant ? variant.stockQuantity : product.stockQuantity;
        if (stock !== null && stock !== undefined && line.quantity > Number(stock)) {
          return conflict(stockMessage(product.name, stock));
        }
      }
    }

    // --- the ONE door ---
    try {
      const result: any = await this.pos.createSale(
        orgId, actorId,
        { ...saleDto, idempotencyKey },
        opts?.forceStock ? { forceStock: true } : undefined,
      );
      const serverTotal = toBigIntOrNull(result?.receipt?.totalMinor) ?? 0n;
      return {
        status: "synced", reason: null,
        serverOrderId: result?.id ?? null,
        serverTotalMinor: serverTotal,
        varianceMinor: localTotalMinor !== null ? serverTotal - localTotalMinor : null,
        syncedAt: new Date(),
        sale: result,
      };
    } catch (e: any) {
      const message = e instanceof Error ? e.message : String(e ?? "");
      if (isOrderLimitBlocked(e)) return conflict(message);
      if (message.includes(STOCK_MARKER)) return conflict(message);
      return rejected(message);
    }
  }

  // ---------- sync ----------

  async sync(orgId: string, actorId: string, dto: OfflineSyncDto) {
    const table = this.ledger();
    const localTotal = dto.localTotalMinor !== null && dto.localTotalMinor !== undefined
      ? BigInt(dto.localTotalMinor)
      : null;

    let row = await this.findByKey(orgId, dto.idempotencyKey);
    // Idempotent retry: a synced row is returned unchanged —
    // no new attempt, no second sale.
    if (row && row.status === "synced") return this.serialize(row);

    if (!row) {
      row = await table.create({
        data: {
          organizationId: orgId,
          idempotencyKey: dto.idempotencyKey,
          cashierId: actorId,
          localReceiptNo: dto.localReceiptNo ?? null,
          localTotalMinor: localTotal,
          payload: dto.sale as any,
          status: "pending",
          attempts: 1,
        },
      });
    } else {
      const updated = await this.saveRow(row.id, {
        cashierId: actorId,
        localReceiptNo: dto.localReceiptNo ?? row.localReceiptNo ?? null,
        localTotalMinor: localTotal ?? toBigIntOrNull(row.localTotalMinor),
        payload: dto.sale as any,
        attempts: Number(row.attempts ?? 0) + 1,
      });
      if (updated) row = updated;
      else row = { ...row, attempts: Number(row.attempts ?? 0) + 1, payload: dto.sale };
    }

    const outcome = await this.attempt(orgId, actorId, dto.sale, dto.idempotencyKey, localTotal);
    const saved = await this.saveRow(row.id, {
      status: outcome.status,
      reason: outcome.reason,
      serverOrderId: outcome.serverOrderId,
      serverTotalMinor: outcome.serverTotalMinor,
      varianceMinor: outcome.varianceMinor,
      syncedAt: outcome.syncedAt,
    });
    return this.serialize(saved ?? { ...row, ...outcome }, outcome.sale ?? null);
  }

  // ---------- list ----------

  async list(orgId: string, status?: string) {
    const table = this.ledger();
    if (!table?.findMany) return { rows: [] };
    const rows = (await table.findMany({
      where: { organizationId: orgId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
    }).catch(() => [])) ?? [];
    return { rows: rows.map((r: any) => this.serialize(r)) };
  }

  // ---------- repost ----------

  async repost(orgId: string, actorId: string, id: string, dto: RepostOfflineSyncDto) {
    const row = await this.findById(orgId, id);
    if (!row) throw new NotFoundException("সিঙ্ক রেকর্ডটি পাওয়া যায়নি");
    if (row.status !== "conflict") {
      throw new BadRequestException("শুধু দ্বন্দ্ব (conflict) অবস্থার রেকর্ড আবার পোস্ট করা যায়");
    }
    const forced = dto?.force === true;
    const localTotal = toBigIntOrNull(row.localTotalMinor);
    const attempts = Number(row.attempts ?? 0) + 1;
    await this.saveRow(row.id, { attempts });

    const outcome = await this.attempt(
      orgId, actorId, row.payload as CreatePosSaleDto, row.idempotencyKey, localTotal,
      forced ? { forceStock: true } : undefined,
    );
    const saved = await this.saveRow(row.id, {
      status: outcome.status,
      reason: outcome.reason,
      serverOrderId: outcome.serverOrderId,
      serverTotalMinor: outcome.serverTotalMinor,
      varianceMinor: outcome.varianceMinor,
      syncedAt: outcome.syncedAt,
    });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "pos.offline_repost",
      entityType: "PosOfflineSync", entityId: row.id,
      metadata: { forced, status: outcome.status },
    }).catch(() => undefined);
    return this.serialize(saved ?? { ...row, attempts, ...outcome }, outcome.sale ?? null);
  }

  // ---------- discard ----------

  async discard(orgId: string, actorId: string, id: string, dto: DiscardOfflineSyncDto) {
    const row = await this.findById(orgId, id);
    if (!row) throw new NotFoundException("সিঙ্ক রেকর্ডটি পাওয়া যায়নি");
    if (row.status === "synced") {
      throw new BadRequestException("সিঙ্ক হয়ে গেছে — বাদ দেওয়া যাবে না");
    }
    if (!["conflict", "rejected", "pending"].includes(row.status)) {
      throw new BadRequestException("এই অবস্থার রেকর্ড বাদ দেওয়া যাবে না");
    }
    const saved = await this.saveRow(row.id, {
      status: "discarded",
      discardNote: dto?.note ?? null,
    });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "pos.offline_discard",
      entityType: "PosOfflineSync", entityId: row.id,
      metadata: { note: dto?.note ?? null, previousStatus: row.status },
    }).catch(() => undefined);
    return this.serialize(saved ?? { ...row, status: "discarded", discardNote: dto?.note ?? null });
  }
}
