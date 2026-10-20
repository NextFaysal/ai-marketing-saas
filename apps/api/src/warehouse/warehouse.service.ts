import { Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { InventoryService } from "../inventory/inventory.service";
import { BD_DISTRICT_ENTRIES } from "../orders/bd-address-data";
import { toCsv } from "../imports/csv";
import type {
  CreateBinAssignmentDto, CreateBinDto, CreateStockCountDto,
  CreateWarehouseDto, UpdateBinDto, UpdateWarehouseDto,
} from "./warehouse.dto";
import { badRequest, notFound } from "../i18n/api-exception";

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
    if (!row) throw notFound("warehouse.theWarehouseWasNotFoundIn");
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

  /** AB3: validate a priority value (optional int, Min(0)). */
  private validatePriority(priority: unknown): number {
    if (!Number.isInteger(priority) || (priority as number) < 0) {
      throw badRequest("warehouse.theWarehousePriorityMustBeAn");
    }
    return priority as number;
  }

  /**
   * AB3: validate serviceDistricts against the BD district
   * vocabulary (orders/bd-address-data — a pure data module, so
   * importing it here creates no module cycle). Entries may be
   * the canonical English name, the Bengali spelling, or a known
   * English variant; the CANONICAL name is what gets stored, so
   * the §4.2 district matching (which compares against the
   * canonical district derived from an order address) works.
   * Unknown district → Bengali BadRequest. Returns the canonical
   * list (deduped, order preserved), or null for null input.
   */
  private validateServiceDistricts(input: string[] | null | undefined): string[] | null {
    if (input == null) return null;
    if (!Array.isArray(input)) {
      throw badRequest("warehouse.theServiceDistrictListMustBe");
    }
    const out: string[] = [];
    for (const raw of input) {
      const entry = String(raw ?? "").trim();
      if (!entry) throw badRequest("warehouse.aServiceDistrictNameCannotBe");
      const wanted = entry.toLowerCase();
      const match = BD_DISTRICT_ENTRIES.find((d) =>
        d.canonical.toLowerCase() === wanted
        || d.bn.some((b) => b === entry)
        || d.variants.some((v) => v.toLowerCase() === wanted));
      if (!match) throw badRequest("warehouse.unknownDistrictGiveAValidDistrict", { entry: entry });
      if (!out.includes(match.canonical)) out.push(match.canonical);
    }
    return out;
  }

  async createWarehouse(organizationId: string, actorId: string, dto: CreateWarehouseDto) {
    const name = (dto.name ?? "").trim();
    if (!name) throw badRequest("warehouse.aWarehouseNameIsRequired");
    const row = await (this.prisma as any).warehouse.create({
      data: {
        organizationId, name, address: dto.address ?? null,
        isDefault: dto.isDefault === true, active: true,
        priority: dto.priority !== undefined ? this.validatePriority(dto.priority) : 0,
        serviceDistricts: dto.serviceDistricts !== undefined
          ? this.validateServiceDistricts(dto.serviceDistricts)
          : null,
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
      if (!name) throw badRequest("warehouse.aWarehouseNameIsRequired");
      data.name = name;
    }
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.isDefault !== undefined) data.isDefault = dto.isDefault === true;
    if (dto.active !== undefined) data.active = dto.active === true;
    if (dto.priority !== undefined) data.priority = this.validatePriority(dto.priority);
    if (dto.serviceDistricts !== undefined) {
      data.serviceDistricts = this.validateServiceDistricts(dto.serviceDistricts);
    }
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
    if (!row) throw notFound("warehouse.theBinWasNotFoundIn");
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
    if (!code) throw badRequest("warehouse.aBinCodeIsRequired");
    const duplicate = await (this.prisma as any).binLocation.findFirst({ where: { warehouseId, code } });
    if (duplicate) throw badRequest("warehouse.aBinWithThisCodeAlready");
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
      if (!code) throw badRequest("warehouse.aBinCodeIsRequired");
      if (code !== existing.code) {
        const duplicate = await (this.prisma as any).binLocation.findFirst({ where: { warehouseId, code } });
        if (duplicate && duplicate.id !== existing.id) {
          throw badRequest("warehouse.aBinWithThisCodeAlready");
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
    if (!bin) throw badRequest("warehouse.theBinDoesNotBelongTo");
    const product = await (this.prisma as any).product.findFirst({ where: { id: dto.productId, organizationId } });
    if (!product) throw notFound("warehouse.theProductWasNotFoundIn");
    const variantId = dto.variantId ?? null;
    if (variantId) {
      const variant = await (this.prisma as any).productVariant.findFirst({ where: { id: variantId, productId: product.id } });
      if (!variant) throw badRequest("warehouse.theVariantDoesNotBelongTo");
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
    if (!row) throw notFound("warehouse.theAssignmentWasNotFoundIn");
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
    if (!row) throw notFound("warehouse.theStockCountWasNotFound");
    return row;
  }

  async createStockCount(organizationId: string, actorId: string, dto: CreateStockCountDto) {
    const warehouse = await this.loadWarehouseOr404(organizationId, dto.warehouseId);
    let bin: any = null;
    if (dto.binLocationId) {
      bin = await (this.prisma as any).binLocation.findFirst({
        where: { id: dto.binLocationId, organizationId, warehouseId: warehouse.id },
      });
      if (!bin) throw badRequest("warehouse.theBinDoesNotBelongTo");
    }

    // Candidate lines: { productId, variantId, systemQty } with
    // systemQty SNAPSHOTTED now; untracked (null stock) rows are
    // skipped and counted, never given a line.
    const candidates: { productId: string; variantId: string | null; systemQty: number }[] = [];
    let skippedUntracked = 0;

    if (bin) {
      // AB3 (design §6): with the bin layer present, a bin-scoped
      // session is TRULY bin-scoped — its line set is the UNION of
      // (tracked rows with a StockBalance in this bin) and
      // (tracked rows with a ProductBinAssignment in this bin),
      // and systemQty snapshots the BIN's onHand (a balance row's
      // onHand, else 0 for assignment-only rows). When the
      // StockBalance table is absent (pre-migration deploy / older
      // fakes) the layer is inactive and the legacy EC21 behaviour
      // below applies byte-identically (assignment lines only,
      // GLOBAL snapshot) — the design §3 missing-table tolerance.
      const balanceTable = (this.prisma as any).stockBalance;
      const binLayer = Boolean(balanceTable?.findMany);
      const seen = new Set<string>();
      const trackedStockOf = async (productId: string, variantId: string | null): Promise<number | null> => {
        if (variantId) {
          const variant = await (this.prisma as any).productVariant.findFirst({ where: { id: variantId } }).catch(() => null);
          return variant?.stockQuantity ?? null;
        }
        const product = await (this.prisma as any).product.findFirst({ where: { id: productId, organizationId } }).catch(() => null);
        return product?.stockQuantity ?? null;
      };
      if (binLayer) {
        const balances: any[] = ((await balanceTable.findMany({
          where: { organizationId, binId: bin.id },
        }).catch(() => [])) ?? []);
        for (const b of balances) {
          const key = `${b.productId}::${b.variantId ?? ""}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const stock = await trackedStockOf(b.productId, b.variantId ?? null);
          if (stock == null) { skippedUntracked++; continue; }
          candidates.push({ productId: b.productId, variantId: b.variantId ?? null, systemQty: b.onHand as number });
        }
      }
      const assignments: any[] = ((await (this.prisma as any).productBinAssignment.findMany({
        where: { organizationId, warehouseId: warehouse.id, binLocationId: bin.id },
      })) ?? []);
      for (const a of assignments) {
        const key = `${a.productId}::${a.variantId ?? ""}`;
        if (binLayer && seen.has(key)) continue;
        seen.add(key);
        const stock = await trackedStockOf(a.productId, a.variantId ?? null);
        if (stock == null) { skippedUntracked++; continue; }
        // Bin layer: an assignment-only row holds 0 in this bin.
        // Legacy (no bin layer): the global counter, as EC21 did.
        candidates.push({ productId: a.productId, variantId: a.variantId ?? null, systemQty: binLayer ? 0 : stock });
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
    // AB3: label the session's scope so the web can say whether
    // this count was bin-scoped (systemQty = the bin's onHand) or
    // warehouse-scoped (systemQty = the global counter).
    const bin = session.binLocationId
      ? await (this.prisma as any).binLocation.findFirst({ where: { id: session.binLocationId, organizationId } }).catch(() => null)
      : null;
    return {
      ...session,
      binId: session.binLocationId ?? null,
      binCode: bin?.code ?? null,
      scope: session.binLocationId ? "bin" as const : "warehouse" as const,
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
    if (session.status !== "open") throw badRequest("warehouse.thisCountIsClosed");
    if (!Number.isInteger(countedQty) || countedQty < 0) {
      throw badRequest("warehouse.theCountedQuantityMustBeAn");
    }
    const line = await (this.prisma as any).stockCountLine.findFirst({ where: { id: lineId, sessionId: session.id } });
    if (!line) throw notFound("warehouse.theCountLineWasNotFound");
    const updated = await (this.prisma as any).stockCountLine.update({
      where: { id: line.id }, data: { countedQty },
    });
    return updated;
  }

  async closeStockCount(organizationId: string, actorId: string, sessionId: string) {
    const session = await this.loadSessionOr404(organizationId, sessionId);
    if (session.status !== "open") throw badRequest("warehouse.thisCountIsClosed");
    if (!this.inventory) throw badRequest("warehouse.theInventoryServiceIsNotAvailable");
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
        // AB3 (design §6): a BIN-scoped session posts its variance
        // as a DELTA addressed at that bin (adjust's binId form) —
        // never setTo, whose semantics are global; the addressed
        // bin absorbs the variance so Σ balances == global keeps
        // holding. A warehouse-scoped session keeps the legacy
        // form byte-identically (no binId — the delta lands on
        // the resolved default bin inside adjust).
        await this.inventory.adjust(organizationId, actorId, line.productId, {
          variantId: line.variantId ?? null,
          delta,
          reason: "stock_count",
          note: `স্টক গণনা ${sessionId}`,
          ...(session.binLocationId ? { binId: session.binLocationId } : {}),
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

  // ---------- AB3: stock balances + stock-by-location reads ----------

  private byCreatedThenId(a: any, b: any): number {
    const dt = new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();
    return dt !== 0 ? dt : String(a.id ?? "").localeCompare(String(b.id ?? ""));
  }

  /**
   * Read-only §4.1-style default-bin resolution for READ paths:
   * assignment bin (default-warehouse assignment preferred, else
   * earliest) → default warehouse's earliest bin. NEVER creates
   * a warehouse or bin — the lazy Main creation belongs to the
   * write paths (InventoryService.resolveDefaultBin); a balance
   * read must not write (design brief for this surface: the only
   * write a read may make is the §3 reserved correction).
   */
  private async resolveDefaultBinReadOnly(
    organizationId: string, productId: string, variantId: string | null,
    warehouses: any[], binsByWarehouse: Map<string, any[]>, assignments: any[],
  ): Promise<any | null> {
    const mine = assignments.filter((a: any) =>
      a.productId === productId && (a.variantId ?? null) === variantId);
    const defaultIds = new Set(warehouses.filter((w: any) => w.isDefault).map((w: any) => w.id));
    const sorted = [...mine].sort((a, b) => this.byCreatedThenId(a, b));
    const chosen = sorted.find((a: any) => defaultIds.has(a.warehouseId)) ?? sorted[0];
    if (chosen) {
      for (const bins of binsByWarehouse.values()) {
        const bin = bins.find((b: any) => b.id === chosen.binLocationId);
        if (bin) return bin;
      }
    }
    const sortedWarehouses = [...warehouses].sort((a, b) => {
      const dd = Number(b.isDefault === true) - Number(a.isDefault === true);
      return dd !== 0 ? dd : this.byCreatedThenId(a, b);
    });
    const warehouse = sortedWarehouses[0];
    if (!warehouse) return null;
    const bins = [...(binsByWarehouse.get(warehouse.id) ?? [])].sort((a, b) => this.byCreatedThenId(a, b));
    return bins[0] ?? null;
  }

  /**
   * The shared computation behind GET commerce/stock-balances
   * and the stock-by-location report:
   * - every StockBalance row, enriched with product/variant/bin/
   *   warehouse labels, its `reserved` shown as the LIVE Σ of
   *   active unexpired StockReservation rows for that
   *   (product, variant, bin) — with the stored counter lazily
   *   corrected (persisted, failure-isolated per row) when it
   *   differs (design §3);
   * - PLUS, for every TRACKED product/variant row with NO balance
   *   rows, one synthesized row at its resolved default bin with
   *   onHand = the global counter (display truth pre-backfill),
   *   marked seeded:false (real rows seeded:true).
   */
  private async computeBalanceRows(organizationId: string): Promise<any[]> {
    const p: any = this.prisma as any;
    const warehouses: any[] = ((await p.warehouse?.findMany({ where: { organizationId } }).catch(() => [])) ?? []) as any[];
    const warehouseById = new Map(warehouses.map((w: any) => [w.id, w]));
    const bins: any[] = ((await p.binLocation?.findMany({ where: { organizationId } }).catch(() => [])) ?? []) as any[];
    const binById = new Map(bins.map((b: any) => [b.id, b]));
    const binsByWarehouse = new Map<string, any[]>();
    for (const b of bins) {
      const list = binsByWarehouse.get(b.warehouseId) ?? [];
      list.push(b);
      binsByWarehouse.set(b.warehouseId, list);
    }
    const products: any[] = ((await p.product?.findMany({ where: { organizationId } }).catch(() => [])) ?? []) as any[];
    const productById = new Map(products.map((x: any) => [x.id, x]));
    const variantsByProduct = new Map<string, any[]>();
    const variantById = new Map<string, any>();
    for (const product of products) {
      const variants: any[] = ((await p.productVariant?.findMany({ where: { productId: product.id } }).catch(() => [])) ?? []) as any[];
      variantsByProduct.set(product.id, variants);
      for (const v of variants) variantById.set(v.id, v);
    }
    const assignments: any[] = ((await p.productBinAssignment?.findMany({ where: { organizationId } }).catch(() => [])) ?? []) as any[];

    // Live reserved per (product, variant, bin): active +
    // unexpired reservation rows only (lazy expiry — §3).
    const liveReserved = new Map<string, number>();
    const reservationTable = p.stockReservation;
    if (reservationTable?.findMany) {
      const rows: any[] = ((await reservationTable.findMany({
        where: { organizationId, state: "active", expiresAt: { gt: new Date() } },
      }).catch(() => [])) ?? []) as any[];
      for (const r of rows) {
        if (!r.binId) continue; // pre-AB3 rows count org-globally, never per-bin
        const key = `${r.productId}::${r.variantId ?? ""}::${r.binId}`;
        liveReserved.set(key, (liveReserved.get(key) ?? 0) + (Number(r.quantity) || 0));
      }
    }

    const label = (productId: string, variantId: string | null, bin: any) => {
      const product = productById.get(productId);
      const variant = variantId ? variantById.get(variantId) : null;
      const warehouse = bin ? warehouseById.get(bin.warehouseId) : null;
      return {
        productId,
        productName: product?.name ?? null,
        sku: variant ? (variant.sku ?? null) : (product?.sku ?? null),
        variantId: variantId ?? null,
        variantName: variant?.name ?? null,
        warehouseId: bin?.warehouseId ?? null,
        warehouseName: warehouse?.name ?? null,
        binId: bin?.id ?? null,
        binCode: bin?.code ?? null,
      };
    };

    const out: any[] = [];
    const balances: any[] = ((await p.stockBalance?.findMany({ where: { organizationId } }).catch(() => [])) ?? []) as any[];
    const keysWithBalances = new Set<string>();
    for (const bal of balances) {
      const variantId = bal.variantId ?? null;
      keysWithBalances.add(`${bal.productId}::${variantId ?? ""}`);
      const live = liveReserved.get(`${bal.productId}::${variantId ?? ""}::${bal.binId}`) ?? 0;
      if ((bal.reserved ?? 0) !== live) {
        // §3 lazy correction — the ONLY write a read may make,
        // failure-isolated per row.
        try {
          await p.stockBalance.update({ where: { id: bal.id }, data: { reserved: live } });
          bal.reserved = live;
        } catch { /* the displayed live value stands regardless */ }
      }
      out.push({
        ...label(bal.productId, variantId, binById.get(bal.binId)),
        onHand: bal.onHand as number,
        reserved: live,
        seeded: true,
      });
    }

    // Synthesized rows for tracked rows with NO balance rows.
    const trackedKeys: { productId: string; variantId: string | null; global: number }[] = [];
    for (const product of products) {
      if (product.stockQuantity != null) {
        trackedKeys.push({ productId: product.id, variantId: null, global: product.stockQuantity as number });
      }
      for (const variant of variantsByProduct.get(product.id) ?? []) {
        if (variant.stockQuantity != null) {
          trackedKeys.push({ productId: product.id, variantId: variant.id, global: variant.stockQuantity as number });
        }
      }
    }
    for (const key of trackedKeys) {
      if (keysWithBalances.has(`${key.productId}::${key.variantId ?? ""}`)) continue;
      const bin = await this.resolveDefaultBinReadOnly(
        organizationId, key.productId, key.variantId, warehouses, binsByWarehouse, assignments,
      );
      out.push({
        ...label(key.productId, key.variantId, bin),
        onHand: key.global,
        reserved: bin ? (liveReserved.get(`${key.productId}::${key.variantId ?? ""}::${bin.id}`) ?? 0) : 0,
        seeded: false,
      });
    }

    out.sort((a, b) =>
      String(a.productName ?? "").localeCompare(String(b.productName ?? ""))
      || String(a.variantName ?? "").localeCompare(String(b.variantName ?? ""))
      || String(a.warehouseName ?? "").localeCompare(String(b.warehouseName ?? ""))
      || String(a.binCode ?? "").localeCompare(String(b.binCode ?? "")));
    return out;
  }

  /** GET commerce/stock-balances payload. */
  /** AB3 coordinator polish: label raw StockAllocation rows with
   * warehouseName/binCode so the reallocate endpoint's response
   * matches the labelled allocations[] on the staff order detail
   * (OrdersService.allocationsForOrder). Failure-isolated: any
   * lookup problem returns the rows unchanged. */
  async labelAllocationRows(organizationId: string, rows: any[]): Promise<any[]> {
    try {
      if (!Array.isArray(rows) || rows.length === 0) return rows ?? [];
      const p: any = this.prisma as any;
      const warehouseIds = [...new Set(rows.map((r) => r.warehouseId).filter(Boolean))];
      const binIds = [...new Set(rows.map((r) => r.binId).filter(Boolean))];
      const warehouses: any[] = warehouseIds.length
        ? ((await p.warehouse?.findMany({ where: { organizationId, id: { in: warehouseIds } } }).catch(() => [])) ?? [])
        : [];
      const bins: any[] = binIds.length
        ? ((await p.binLocation?.findMany({ where: { organizationId, id: { in: binIds } } }).catch(() => [])) ?? [])
        : [];
      const warehouseNameById = new Map<string, string>(warehouses.map((w: any) => [w.id, w.name]));
      const binCodeById = new Map<string, string>(bins.map((b: any) => [b.id, b.code]));
      return rows.map((r) => ({
        ...r,
        warehouseName: warehouseNameById.get(r.warehouseId) ?? null,
        binCode: binCodeById.get(r.binId) ?? null,
      }));
    } catch {
      return rows;
    }
  }

  async listStockBalances(organizationId: string) {
    const items = await this.computeBalanceRows(organizationId);
    const totalOnHand = items.reduce((s, r) => s + (Number(r.onHand) || 0), 0);
    const totalReserved = items.reduce((s, r) => s + (Number(r.reserved) || 0), 0);
    return { items, orgTotals: { totalOnHand, totalReserved } };
  }

  /** GET commerce/stock-by-location payload: per
   * (product, variant, warehouse) onHand/reserved (Σ over that
   * warehouse's bins, reserved live-computed as in the balances
   * read) + inTransitOut from in_transit transfer lines whose
   * fromBin belongs to that warehouse. */
  async stockByLocation(organizationId: string) {
    const p: any = this.prisma as any;
    const balanceRows = await this.computeBalanceRows(organizationId);
    const groups = new Map<string, any>();
    const ensure = (r: any) => {
      const key = `${r.productId}::${r.variantId ?? ""}::${r.warehouseId ?? ""}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          productId: r.productId, productName: r.productName,
          variantId: r.variantId ?? null, variantName: r.variantName ?? null,
          warehouseId: r.warehouseId ?? null, warehouseName: r.warehouseName ?? null,
          onHand: 0, reserved: 0, inTransitOut: 0,
        };
        groups.set(key, g);
      }
      return g;
    };
    for (const r of balanceRows) {
      if (!r.warehouseId) continue; // unresolvable default bin — nowhere to attribute
      const g = ensure(r);
      g.onHand += Number(r.onHand) || 0;
      g.reserved += Number(r.reserved) || 0;
    }

    // In-transit: transfers still in_transit, grouped by the
    // FROM bin's warehouse.
    const binWarehouse = new Map<string, string>();
    const bins: any[] = ((await p.binLocation?.findMany({ where: { organizationId } }).catch(() => [])) ?? []) as any[];
    for (const b of bins) binWarehouse.set(b.id, b.warehouseId);
    const warehouseNameById = new Map<string, string>();
    const warehouses: any[] = ((await p.warehouse?.findMany({ where: { organizationId } }).catch(() => [])) ?? []) as any[];
    for (const w of warehouses) warehouseNameById.set(w.id, w.name);
    const productNameById = new Map<string, string>();
    const variantNameById = new Map<string, string>();
    const transfers: any[] = ((await p.stockTransfer?.findMany({
      where: { organizationId, status: "in_transit" },
    }).catch(() => [])) ?? []) as any[];
    for (const t of transfers) {
      const fromWarehouseId = binWarehouse.get(t.fromBinId);
      if (!fromWarehouseId) continue;
      const lines: any[] = ((await p.stockTransferLine?.findMany({ where: { transferId: t.id } }).catch(() => [])) ?? []) as any[];
      for (const line of lines) {
        const outstanding = (Number(line.qtySent) || 0) - (Number(line.qtyReceived) || 0);
        if (outstanding <= 0) continue;
        if (!productNameById.has(line.productId)) {
          const product = await p.product?.findFirst({ where: { id: line.productId, organizationId } }).catch(() => null);
          productNameById.set(line.productId, product?.name ?? null);
          if (line.variantId) {
            const variant = await p.productVariant?.findFirst({ where: { id: line.variantId } }).catch(() => null);
            variantNameById.set(line.variantId, variant?.name ?? null);
          }
        }
        const g = ensure({
          productId: line.productId,
          productName: productNameById.get(line.productId) ?? null,
          variantId: line.variantId ?? null,
          variantName: line.variantId ? (variantNameById.get(line.variantId) ?? null) : null,
          warehouseId: fromWarehouseId,
          warehouseName: warehouseNameById.get(fromWarehouseId) ?? null,
        });
        g.inTransitOut += outstanding;
      }
    }

    const items = [...groups.values()].sort((a, b) =>
      String(a.productName ?? "").localeCompare(String(b.productName ?? ""))
      || String(a.variantName ?? "").localeCompare(String(b.variantName ?? ""))
      || String(a.warehouseName ?? "").localeCompare(String(b.warehouseName ?? "")));
    return {
      items,
      orgTotals: {
        totalOnHand: items.reduce((s, r) => s + r.onHand, 0),
        totalReserved: items.reduce((s, r) => s + r.reserved, 0),
        totalInTransit: items.reduce((s, r) => s + r.inTransitOut, 0),
      },
    };
  }

  /** The .csv twin of stockByLocation (plain CSV download, the
   * orders-export header pattern on the controller). */
  async stockByLocationCsv(organizationId: string): Promise<string> {
    const { items } = await this.stockByLocation(organizationId);
    return toCsv(
      ["product", "variant", "warehouse", "on_hand", "reserved", "in_transit_out"],
      items.map((r: any) => [
        r.productName ?? "", r.variantName ?? "", r.warehouseName ?? "",
        r.onHand, r.reserved, r.inTransitOut,
      ]),
    );
  }
}
