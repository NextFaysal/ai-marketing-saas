import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { InventoryService } from "../inventory/inventory.service";
import type {
  CreateBinAssignmentDto, CreateBinDto, CreateStockCountDto,
  CreateWarehouseDto, UpdateBinDto, UpdateWarehouseDto,
} from "./warehouse.dto";

/**
 * EC21 — Warehouse & Stock Ops.
 *
 * IMPORTANT inventory fact: stock balances are ORG-GLOBAL on
 * Product.stockQuantity / ProductVariant.stockQuantity (the S1
 * model) — there is NO per-warehouse stock. Warehouses own bins
 * and stock-count sessions only. A row is "untracked" when its
 * stockQuantity is null.
 *
 * Stock-count closing is the only place this service changes
 * balances, and it does so exclusively through
 * InventoryService.adjust (the ONE stock writer) with reason
 * "stock_count" — never by writing Product rows directly.
 */
@Injectable()
export class WarehouseService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly inventory?: InventoryService,
  ) {}

  private async log(input: Parameters<AuditService["log"]>[0]): Promise<void> {
    try { await this.audit?.log(input); } catch { /* audit is failure-isolated */ }
  }

  // ---------- Warehouses ----------

  private async loadWarehouseOr404(organizationId: string, warehouseId: string): Promise<any> {
    const row = await (this.prisma as any).warehouse.findFirst({ where: { id: warehouseId, organizationId } });
    if (!row) throw new NotFoundException("গুদামটি এই প্রতিষ্ঠানে পাওয়া যায়নি");
    return row;
  }

  /** Making one warehouse the default unsets every other
   * default in the org (one default per org, by convention). */
  private async unsetOtherDefaults(organizationId: string, exceptId: string): Promise<void> {
    const rows: any[] = (await (this.prisma as any).warehouse.findMany({ where: { organizationId } })) ?? [];
    for (const row of rows) {
      if (row.id !== exceptId && row.isDefault === true) {
        await (this.prisma as any).warehouse.update({ where: { id: row.id }, data: { isDefault: false } });
      }
    }
  }

  async listWarehouses(organizationId: string) {
    const rows: any[] = ((await (this.prisma as any).warehouse.findMany({ where: { organizationId } })) ?? [])
      .slice()
      .sort((a: any, b: any) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime());
    const items: any[] = [];
    for (const w of rows) {
      const bins: any[] = (await (this.prisma as any).binLocation.findMany({ where: { organizationId, warehouseId: w.id } }).catch(() => [])) ?? [];
      const assignments: any[] = (await (this.prisma as any).productBinAssignment.findMany({ where: { organizationId, warehouseId: w.id } }).catch(() => [])) ?? [];
      items.push({ ...w, binCount: bins.length, assignmentCount: assignments.length });
    }
    return { items };
  }

  async createWarehouse(organizationId: string, actorId: string, dto: CreateWarehouseDto) {
    const name = (dto.name ?? "").trim();
    if (!name) throw new BadRequestException("গুদামের নাম দরকার");
    const row = await (this.prisma as any).warehouse.create({
      data: {
        organizationId, name, address: dto.address ?? null,
        isDefault: dto.isDefault === true, active: true,
      },
    });
    if (row.isDefault) await this.unsetOtherDefaults(organizationId, row.id);
    await this.log({
      organizationId, userId: actorId, action: "warehouse.created",
      entityType: "Warehouse", entityId: row.id, metadata: { name: row.name },
    });
    return row;
  }

  async updateWarehouse(organizationId: string, actorId: string, warehouseId: string, dto: UpdateWarehouseDto) {
    const existing = await this.loadWarehouseOr404(organizationId, warehouseId);
    const data: Record<string, any> = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException("গুদামের নাম দরকার");
      data.name = name;
    }
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.isDefault !== undefined) data.isDefault = dto.isDefault === true;
    if (dto.active !== undefined) data.active = dto.active === true;
    const updated = await (this.prisma as any).warehouse.update({ where: { id: existing.id }, data });
    if (data.isDefault === true) await this.unsetOtherDefaults(organizationId, existing.id);
    await this.log({
      organizationId, userId: actorId, action: "warehouse.updated",
      entityType: "Warehouse", entityId: existing.id,
    });
    return updated;
  }

  /** Soft delete: the row (and its bins / count history) stays;
   * it just stops being usable / listed as active. */
  async deleteWarehouse(organizationId: string, actorId: string, warehouseId: string) {
    const existing = await this.loadWarehouseOr404(organizationId, warehouseId);
    await (this.prisma as any).warehouse.update({ where: { id: existing.id }, data: { active: false } });
    await this.log({
      organizationId, userId: actorId, action: "warehouse.deleted",
      entityType: "Warehouse", entityId: existing.id,
    });
    return { deleted: true };
  }

  // ---------- Bins ----------

  private async loadBinOr404(organizationId: string, warehouseId: string, binId: string): Promise<any> {
    const row = await (this.prisma as any).binLocation.findFirst({
      where: { id: binId, organizationId, warehouseId },
    });
    if (!row) throw new NotFoundException("বিনটি এই গুদামে পাওয়া যায়নি");
    return row;
  }

  async listBins(organizationId: string, warehouseId: string) {
    await this.loadWarehouseOr404(organizationId, warehouseId);
    const rows: any[] = ((await (this.prisma as any).binLocation.findMany({ where: { organizationId, warehouseId } })) ?? [])
      .slice()
      .sort((a: any, b: any) => String(a.code).localeCompare(String(b.code)));
    return { items: rows };
  }

  async createBin(organizationId: string, actorId: string, warehouseId: string, dto: CreateBinDto) {
    await this.loadWarehouseOr404(organizationId, warehouseId);
    const code = (dto.code ?? "").trim();
    if (!code) throw new BadRequestException("বিনের কোড দরকার");
    const duplicate = await (this.prisma as any).binLocation.findFirst({ where: { warehouseId, code } });
    if (duplicate) throw new BadRequestException("এই গুদামে এই কোডের বিন আগেই আছে");
    const row = await (this.prisma as any).binLocation.create({
      data: { organizationId, warehouseId, code, note: dto.note ?? null },
    });
    await this.log({
      organizationId, userId: actorId, action: "bin.created",
      entityType: "BinLocation", entityId: row.id, metadata: { warehouseId, code },
    });
    return row;
  }

  async updateBin(organizationId: string, actorId: string, warehouseId: string, binId: string, dto: UpdateBinDto) {
    await this.loadWarehouseOr404(organizationId, warehouseId);
    const existing = await this.loadBinOr404(organizationId, warehouseId, binId);
    const data: Record<string, any> = {};
    if (dto.code !== undefined) {
      const code = dto.code.trim();
      if (!code) throw new BadRequestException("বিনের কোড দরকার");
      if (code !== existing.code) {
        const duplicate = await (this.prisma as any).binLocation.findFirst({ where: { warehouseId, code } });
        if (duplicate && duplicate.id !== existing.id) {
          throw new BadRequestException("এই গুদামে এই কোডের বিন আগেই আছে");
        }
      }
      data.code = code;
    }
    if (dto.note !== undefined) data.note = dto.note;
    const updated = await (this.prisma as any).binLocation.update({ where: { id: existing.id }, data });
    await this.log({
      organizationId, userId: actorId, action: "bin.updated",
      entityType: "BinLocation", entityId: existing.id, metadata: { warehouseId },
    });
    return updated;
  }

  /** Hard delete — ProductBinAssignment rows cascade in the DB. */
  async deleteBin(organizationId: string, actorId: string, warehouseId: string, binId: string) {
    await this.loadWarehouseOr404(organizationId, warehouseId);
    const existing = await this.loadBinOr404(organizationId, warehouseId, binId);
    await (this.prisma as any).binLocation.delete({ where: { id: existing.id } });
    await this.log({
      organizationId, userId: actorId, action: "bin.deleted",
      entityType: "BinLocation", entityId: existing.id, metadata: { warehouseId },
    });
    return { deleted: true };
  }

  // ---------- Bin assignments ----------

  private async enrichAssignment(organizationId: string, row: any): Promise<any> {
    const bin = await (this.prisma as any).binLocation.findFirst({ where: { id: row.binLocationId, organizationId } }).catch(() => null);
    const warehouse = await (this.prisma as any).warehouse.findFirst({ where: { id: row.warehouseId, organizationId } }).catch(() => null);
    const product = await (this.prisma as any).product.findFirst({ where: { id: row.productId, organizationId } }).catch(() => null);
    const variant = row.variantId
      ? await (this.prisma as any).productVariant.findFirst({ where: { id: row.variantId } }).catch(() => null)
      : null;
    return {
      ...row,
      binCode: bin?.code ?? null,
      warehouseName: warehouse?.name ?? null,
      productName: product?.name ?? null,
      variantName: variant?.name ?? null,
    };
  }

  async listAssignments(
    organizationId: string,
    filters: { warehouseId?: string; binLocationId?: string; productId?: string } = {},
  ) {
    const where: Record<string, any> = { organizationId };
    if (filters.warehouseId) where.warehouseId = filters.warehouseId;
    if (filters.binLocationId) where.binLocationId = filters.binLocationId;
    if (filters.productId) where.productId = filters.productId;
    const rows: any[] = ((await (this.prisma as any).productBinAssignment.findMany({ where })) ?? [])
      .slice()
      .sort((a: any, b: any) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime());
    const items: any[] = [];
    for (const row of rows) items.push(await this.enrichAssignment(organizationId, row));
    return { items };
  }

  /**
   * ONE primary bin per (warehouse, product, variant). If an
   * assignment already exists for that exact key (null variantId
   * matches null — the product-level row), this is a MOVE: its
   * binLocationId is updated in place and the row returned.
   */
  async upsertAssignment(organizationId: string, actorId: string, dto: CreateBinAssignmentDto) {
    const warehouse = await this.loadWarehouseOr404(organizationId, dto.warehouseId);
    const bin = await (this.prisma as any).binLocation.findFirst({
      where: { id: dto.binLocationId, organizationId, warehouseId: warehouse.id },
    });
    if (!bin) throw new BadRequestException("বিনটি এই গুদামের নয়");
    const product = await (this.prisma as any).product.findFirst({ where: { id: dto.productId, organizationId } });
    if (!product) throw new NotFoundException("পণ্যটি এই প্রতিষ্ঠানে পাওয়া যায়নি");
    const variantId = dto.variantId ?? null;
    if (variantId) {
      const variant = await (this.prisma as any).productVariant.findFirst({ where: { id: variantId, productId: product.id } });
      if (!variant) throw new BadRequestException("ভ্যারিয়েন্টটি এই পণ্যের নয়");
    }
    const siblings: any[] = ((await (this.prisma as any).productBinAssignment.findMany({
      where: { organizationId, warehouseId: warehouse.id, productId: product.id },
    })) ?? []);
    const existing = siblings.find((a: any) => (a.variantId ?? null) === variantId) ?? null;
    if (existing) {
      const updated = await (this.prisma as any).productBinAssignment.update({
        where: { id: existing.id }, data: { binLocationId: bin.id },
      });
      await this.log({
        organizationId, userId: actorId, action: "assignment.moved",
        entityType: "ProductBinAssignment", entityId: existing.id,
        metadata: { warehouseId: warehouse.id, binLocationId: bin.id, productId: product.id, variantId },
      });
      return this.enrichAssignment(organizationId, updated);
    }
    const row = await (this.prisma as any).productBinAssignment.create({
      data: {
        organizationId, warehouseId: warehouse.id, binLocationId: bin.id,
        productId: product.id, variantId,
      },
    });
    await this.log({
      organizationId, userId: actorId, action: "assignment.created",
      entityType: "ProductBinAssignment", entityId: row.id,
      metadata: { warehouseId: warehouse.id, binLocationId: bin.id, productId: product.id, variantId },
    });
    return this.enrichAssignment(organizationId, row);
  }

  async deleteAssignment(organizationId: string, actorId: string, assignmentId: string) {
    const row = await (this.prisma as any).productBinAssignment.findFirst({ where: { id: assignmentId, organizationId } });
    if (!row) throw new NotFoundException("অ্যাসাইনমেন্টটি এই প্রতিষ্ঠানে পাওয়া যায়নি");
    await (this.prisma as any).productBinAssignment.delete({ where: { id: row.id } });
    await this.log({
      organizationId, userId: actorId, action: "assignment.deleted",
      entityType: "ProductBinAssignment", entityId: row.id,
      metadata: { warehouseId: row.warehouseId, productId: row.productId, variantId: row.variantId ?? null },
    });
    return { deleted: true };
  }

  // ---------- Stock counts ----------

  private async loadSessionOr404(organizationId: string, sessionId: string): Promise<any> {
    const row = await (this.prisma as any).stockCountSession.findFirst({ where: { id: sessionId, organizationId } });
    if (!row) throw new NotFoundException("স্টক গণনাটি এই প্রতিষ্ঠানে পাওয়া যায়নি");
    return row;
  }

  async createStockCount(organizationId: string, actorId: string, dto: CreateStockCountDto) {
    const warehouse = await this.loadWarehouseOr404(organizationId, dto.warehouseId);
    let bin: any = null;
    if (dto.binLocationId) {
      bin = await (this.prisma as any).binLocation.findFirst({
        where: { id: dto.binLocationId, organizationId, warehouseId: warehouse.id },
      });
      if (!bin) throw new BadRequestException("বিনটি এই গুদামের নয়");
    }

    // Candidate lines: { productId, variantId, systemQty } with
    // systemQty SNAPSHOTTED now; untracked (null stock) rows are
    // skipped and counted, never given a line.
    const candidates: { productId: string; variantId: string | null; systemQty: number }[] = [];
    let skippedUntracked = 0;

    if (bin) {
      const assignments: any[] = ((await (this.prisma as any).productBinAssignment.findMany({
        where: { organizationId, warehouseId: warehouse.id, binLocationId: bin.id },
      })) ?? []);
      for (const a of assignments) {
        let stock: number | null = null;
        if (a.variantId) {
          const variant = await (this.prisma as any).productVariant.findFirst({ where: { id: a.variantId } }).catch(() => null);
          stock = variant?.stockQuantity ?? null;
        } else {
          const product = await (this.prisma as any).product.findFirst({ where: { id: a.productId, organizationId } }).catch(() => null);
          stock = product?.stockQuantity ?? null;
        }
        if (stock == null) { skippedUntracked++; continue; }
        candidates.push({ productId: a.productId, variantId: a.variantId ?? null, systemQty: stock });
      }
    } else {
      const products: any[] = ((await (this.prisma as any).product.findMany({ where: { organizationId } })) ?? []);
      for (const product of products) {
        const variants: any[] = ((await (this.prisma as any).productVariant.findMany({ where: { productId: product.id } })) ?? []);
        if (variants.length > 0) {
          for (const variant of variants) {
            if (variant.stockQuantity == null) { skippedUntracked++; continue; }
            candidates.push({ productId: product.id, variantId: variant.id, systemQty: variant.stockQuantity });
          }
        } else if (product.stockQuantity == null) {
          skippedUntracked++;
        } else {
          candidates.push({ productId: product.id, variantId: null, systemQty: product.stockQuantity });
        }
      }
    }

    const session = await (this.prisma as any).stockCountSession.create({
      data: {
        organizationId, warehouseId: warehouse.id, binLocationId: bin?.id ?? null,
        status: "open", createdById: actorId,
      },
    });
    for (const c of candidates) {
      await (this.prisma as any).stockCountLine.create({
        data: { sessionId: session.id, productId: c.productId, variantId: c.variantId, systemQty: c.systemQty, countedQty: null },
      });
    }
    await this.log({
      organizationId, userId: actorId, action: "stock_count.created",
      entityType: "StockCountSession", entityId: session.id,
      metadata: { warehouseId: warehouse.id, binLocationId: bin?.id ?? null, lineCount: candidates.length, skippedUntracked },
    });
    const view = await this.getStockCount(organizationId, session.id);
    return { ...view, skippedUntracked };
  }

  async listStockCounts(organizationId: string) {
    const rows: any[] = ((await (this.prisma as any).stockCountSession.findMany({ where: { organizationId } })) ?? [])
      .slice()
      .sort((a: any, b: any) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
    const items: any[] = [];
    for (const s of rows) {
      const lines: any[] = ((await (this.prisma as any).stockCountLine.findMany({ where: { sessionId: s.id } }).catch(() => [])) ?? []);
      items.push({
        ...s,
        lineCount: lines.length,
        countedCount: lines.filter((l: any) => l.countedQty != null).length,
      });
    }
    return { items };
  }

  async getStockCount(organizationId: string, sessionId: string) {
    const session = await this.loadSessionOr404(organizationId, sessionId);
    const lines: any[] = ((await (this.prisma as any).stockCountLine.findMany({ where: { sessionId: session.id } })) ?? [])
      .slice()
      .sort((a: any, b: any) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime());
    const enriched: any[] = [];
    let totalVariance = 0;
    let countedCount = 0;
    for (const line of lines) {
      const product = await (this.prisma as any).product.findFirst({ where: { id: line.productId, organizationId } }).catch(() => null);
      const variant = line.variantId
        ? await (this.prisma as any).productVariant.findFirst({ where: { id: line.variantId } }).catch(() => null)
        : null;
      const variance = line.countedQty == null ? null : line.countedQty - line.systemQty;
      if (variance != null) { totalVariance += variance; countedCount++; }
      enriched.push({
        ...line,
        productName: product?.name ?? null,
        variantName: variant?.name ?? null,
        variance,
      });
    }
    return {
      ...session,
      lines: enriched,
      totals: {
        lineCount: enriched.length,
        countedCount,
        skippedCount: enriched.length - countedCount,
        totalVariance,
      },
    };
  }

  async setCountedQty(organizationId: string, actorId: string, sessionId: string, lineId: string, countedQty: number) {
    const session = await this.loadSessionOr404(organizationId, sessionId);
    if (session.status !== "open") throw new BadRequestException("এই গণনা বন্ধ হয়ে গেছে");
    if (!Number.isInteger(countedQty) || countedQty < 0) {
      throw new BadRequestException("গণনা করা সংখ্যা অবশ্যই ০ বা তার বেশি পূর্ণসংখ্যা হতে হবে");
    }
    const line = await (this.prisma as any).stockCountLine.findFirst({ where: { id: lineId, sessionId: session.id } });
    if (!line) throw new NotFoundException("গণনার লাইনটি পাওয়া যায়নি");
    const updated = await (this.prisma as any).stockCountLine.update({
      where: { id: line.id }, data: { countedQty },
    });
    return updated;
  }

  async closeStockCount(organizationId: string, actorId: string, sessionId: string) {
    const session = await this.loadSessionOr404(organizationId, sessionId);
    if (session.status !== "open") throw new BadRequestException("এই গণনা বন্ধ হয়ে গেছে");
    if (!this.inventory) throw new BadRequestException("ইনভেন্টরি সার্ভিস পাওয়া যাচ্ছে না");
    const lines: any[] = ((await (this.prisma as any).stockCountLine.findMany({ where: { sessionId: session.id } })) ?? []);

    const applied: { lineId: string; delta: number }[] = [];
    const skipped: { lineId: string; reason: string }[] = [];
    for (const line of lines) {
      // Uncounted lines are skipped — NEVER zeroed.
      if (line.countedQty == null) {
        skipped.push({ lineId: line.id, reason: "গণনা করা হয়নি" });
        continue;
      }
      // NOTE: delta is computed against the SNAPSHOT systemQty
      // taken at session creation, per the brief — stock that
      // moved after the snapshot shifts the landing balance
      // accordingly ( counted - snapshot, applied onto the
      // CURRENT balance by InventoryService.adjust ).
      const delta = line.countedQty - line.systemQty;
      if (delta === 0) continue;
      try {
        await this.inventory.adjust(organizationId, actorId, line.productId, {
          variantId: line.variantId ?? null,
          delta,
          reason: "stock_count",
          note: `স্টক গণনা ${sessionId}`,
        });
        applied.push({ lineId: line.id, delta });
      } catch (e) {
        // Per-line isolation: e.g. the row became untracked after
        // the snapshot — record it as skipped, never abort the
        // whole close.
        skipped.push({ lineId: line.id, reason: e instanceof Error ? e.message : "অজানা ত্রুটি" });
      }
    }

    await (this.prisma as any).stockCountSession.update({
      where: { id: session.id }, data: { status: "closed", closedAt: new Date() },
    });
    await this.log({
      organizationId, userId: actorId, action: "stock_count.closed",
      entityType: "StockCountSession", entityId: session.id,
      metadata: { appliedCount: applied.length, skippedCount: skipped.length },
    });
    const view = await this.getStockCount(organizationId, session.id);
    return { session: view, applied, skipped };
  }
}
