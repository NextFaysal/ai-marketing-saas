import { Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { InventoryService } from "../inventory/inventory.service";
import type {
  CreateStockTransferDto, ReceiveStockTransferDto,
} from "./warehouse.dto";
import { badRequest, notFound } from "../i18n/api-exception";

/**
 * AB3 (AX4) — warehouse-to-warehouse stock transfers
 * (design docs/advanced-ab3-design.md §6).
 *
 * Lifecycle: draft (no stock moves) → dispatch (in_transit: the
 * fromBin balance drops per line via a "transfer_out" movement;
 * the global Product counter NEVER moves) → receive (the toBin
 * balance rises per received unit via "transfer_in"; a short
 * receive closes as received_with_variance and the variance
 * units are GONE — recorded on the lines, never returned to any
 * bin) | cancelled (from draft: nothing to undo; from in_transit:
 * the outstanding units return to the fromBin).
 *
 * SINGLE-WRITER DISCIPLINE: every stock write goes through
 * InventoryService.applyBinOnlyDelta — this service never writes
 * StockBalance / StockMovement / Product rows itself.
 *
 * While a transfer is in_transit the invariant takes its
 * extended form: Σ balances + Σ in-transit outstanding == the
 * global counter (see the ab3-transfers spec for the exact
 * assertions across the lifecycle).
 */
@Injectable()
export class StockTransfersService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly inventory?: InventoryService,
  ) {}

  private async log(input: Parameters<AuditService["log"]>[0]): Promise<void> {
    try { await this.audit?.log(input); } catch { /* audit is failure-isolated */ }
  }

  private t(name: string): any { return (this.prisma as any)[name]; }

  private requireInventory(): InventoryService {
    if (!this.inventory) throw badRequest("warehouse.theInventoryServiceIsNotAvailable");
    return this.inventory;
  }

  private async loadBinOr400(organizationId: string, binId: string): Promise<any> {
    const bin = await this.t("binLocation")?.findFirst({ where: { id: binId, organizationId } }).catch(() => null);
    if (!bin) throw badRequest("warehouse.theBinWasNotFoundIn2");
    return bin;
  }

  private async loadTransferOr404(organizationId: string, transferId: string): Promise<any> {
    const row = await this.t("stockTransfer")?.findFirst({ where: { id: transferId, organizationId } }).catch(() => null);
    if (!row) throw notFound("warehouse.theTransferWasNotFoundIn");
    return row;
  }

  private async linesOf(transferId: string): Promise<any[]> {
    const rows: any[] = ((await this.t("stockTransferLine")?.findMany({ where: { transferId } }).catch(() => [])) ?? []) as any[];
    return [...rows].sort((a, b) =>
      new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime()
      || String(a.id ?? "").localeCompare(String(b.id ?? "")));
  }

  private async binLabel(organizationId: string, binId: string) {
    const bin = await this.t("binLocation")?.findFirst({ where: { id: binId, organizationId } }).catch(() => null);
    const warehouse = bin
      ? await this.t("warehouse")?.findFirst({ where: { id: bin.warehouseId, organizationId } }).catch(() => null)
      : null;
    return {
      binId, binCode: bin?.code ?? null,
      warehouseId: bin?.warehouseId ?? null, warehouseName: warehouse?.name ?? null,
    };
  }

  private async enrichLine(organizationId: string, line: any): Promise<any> {
    const product = await this.t("product")?.findFirst({ where: { id: line.productId, organizationId } }).catch(() => null);
    const variant = line.variantId
      ? await this.t("productVariant")?.findFirst({ where: { id: line.variantId } }).catch(() => null)
      : null;
    return {
      ...line,
      variantId: line.variantId ?? null,
      productName: product?.name ?? null,
      variantName: variant?.name ?? null,
      sku: variant ? (variant.sku ?? null) : (product?.sku ?? null),
    };
  }

  private async detail(organizationId: string, transfer: any): Promise<any> {
    const from = await this.binLabel(organizationId, transfer.fromBinId);
    const to = await this.binLabel(organizationId, transfer.toBinId);
    const rawLines = await this.linesOf(transfer.id);
    const lines: any[] = [];
    for (const line of rawLines) lines.push(await this.enrichLine(organizationId, line));
    return {
      ...transfer,
      fromBinCode: from.binCode, fromWarehouseId: from.warehouseId, fromWarehouseName: from.warehouseName,
      toBinCode: to.binCode, toWarehouseId: to.warehouseId, toWarehouseName: to.warehouseName,
      lines,
      lineCount: lines.length,
      totalQtySent: lines.reduce((s, l) => s + (Number(l.qtySent) || 0), 0),
      totalQtyReceived: lines.reduce((s, l) => s + (Number(l.qtyReceived) || 0), 0),
      varianceQty: lines.reduce(
        (s, l) => s + (l.qtyReceived == null ? 0 : Math.max(0, (Number(l.qtySent) || 0) - (Number(l.qtyReceived) || 0))),
        0,
      ),
    };
  }

  // ---------- create / read ----------

  async createTransfer(organizationId: string, actorId: string, dto: CreateStockTransferDto) {
    const fromBin = await this.loadBinOr400(organizationId, dto.fromBinId);
    const toBin = await this.loadBinOr400(organizationId, dto.toBinId);
    if (fromBin.id === toBin.id) {
      throw badRequest("warehouse.transferWithinTheSameBinIs");
    }
    const rawLines = Array.isArray(dto.lines) ? dto.lines : [];
    if (rawLines.length === 0) {
      throw badRequest("warehouse.aTransferNeedsAtLeastOne");
    }
    // Validate EVERY line up front — a draft is only created
    // when the whole body is sound.
    const seen = new Set<string>();
    const lines: { productId: string; variantId: string | null; qtySent: number }[] = [];
    for (const raw of rawLines) {
      const variantId = raw.variantId ?? null;
      const key = `${raw.productId}::${variantId ?? ""}`;
      if (seen.has(key)) {
        throw badRequest("warehouse.multipleLinesForTheSameProduct");
      }
      seen.add(key);
      if (!Number.isInteger(raw.qtySent) || (raw.qtySent as number) <= 0) {
        throw badRequest("warehouse.theSentQuantityQtysentMustBe");
      }
      const product = await this.t("product")?.findFirst({ where: { id: raw.productId, organizationId } }).catch(() => null);
      if (!product) throw notFound("warehouse.theProductWasNotFoundIn");
      let tracked: number | null;
      if (variantId) {
        const variant = await this.t("productVariant")?.findFirst({ where: { id: variantId, productId: product.id } }).catch(() => null);
        if (!variant) throw badRequest("warehouse.theVariantDoesNotBelongTo");
        tracked = variant.stockQuantity ?? null;
      } else {
        tracked = product.stockQuantity ?? null;
      }
      if (tracked == null) {
        // A transfer is a physical claim on TRACKED stock only
        // (design §6: dispatch/receive refuse untracked rows).
        throw badRequest("warehouse.theStockOfIsNotTracked", { productName: product.name });
      }
      lines.push({ productId: product.id, variantId, qtySent: raw.qtySent });
    }

    const transfer = await this.t("stockTransfer").create({
      data: {
        organizationId, fromBinId: fromBin.id, toBinId: toBin.id,
        status: "draft", createdById: actorId, note: dto.note ?? null,
      },
    });
    for (const line of lines) {
      await this.t("stockTransferLine").create({ data: { transferId: transfer.id, ...line, qtyReceived: null } });
    }
    await this.log({
      organizationId, userId: actorId, action: "stock_transfer.created",
      entityType: "StockTransfer", entityId: transfer.id,
      metadata: {
        fromBinId: fromBin.id, toBinId: toBin.id,
        lineCount: lines.length,
        totalQtySent: lines.reduce((s, l) => s + l.qtySent, 0),
      },
    });
    return this.detail(organizationId, transfer);
  }

  async listTransfers(organizationId: string) {
    const rows: any[] = ((await this.t("stockTransfer")?.findMany({ where: { organizationId } }).catch(() => [])) ?? []) as any[];
    const sorted = [...rows].sort((a, b) =>
      new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
      || String(b.id ?? "").localeCompare(String(a.id ?? "")));
    const items: any[] = [];
    for (const row of sorted) {
      const d = await this.detail(organizationId, row);
      const { lines: _lines, ...summary } = d;
      items.push(summary);
    }
    return { items };
  }

  async getTransfer(organizationId: string, transferId: string) {
    const transfer = await this.loadTransferOr404(organizationId, transferId);
    return this.detail(organizationId, transfer);
  }

  // ---------- lifecycle ----------

  async dispatchTransfer(organizationId: string, actorId: string, transferId: string) {
    const inventory = this.requireInventory();
    const transfer = await this.loadTransferOr404(organizationId, transferId);
    if (transfer.status !== "draft") {
      throw badRequest("warehouse.onlyADraftTransferCanBe", { transferStatus: transfer.status });
    }
    const lines = await this.linesOf(transfer.id);

    // Pre-check EVERY line BEFORE any stock moves: seed the
    // fromBin's balance row if the stock row has none yet, then
    // require onHand >= qtySent. A transfer is a physical claim
    // — unlike order oversell it may NOT drive a bin negative
    // (design §6) — and a short line refuses the WHOLE dispatch.
    for (const line of lines) {
      await inventory.seedBalanceIfMissing(organizationId, line.productId, line.variantId ?? null);
      const bal = await this.t("stockBalance")?.findFirst({
        where: { organizationId, productId: line.productId, variantId: line.variantId ?? null, binId: transfer.fromBinId },
      }).catch(() => null);
      const onHand = (bal?.onHand as number) ?? 0;
      if (onHand < line.qtySent) {
        const product = await this.t("product")?.findFirst({ where: { id: line.productId, organizationId } }).catch(() => null);
        throw badRequest("warehouse.thereIsNotEnoughStockIn", { p1: product?.name ?? line.productId, onHand: onHand, lineQtySent: line.qtySent });
      }
    }

    // Apply line by line through the ONE bin writer. If an apply
    // throws mid-way, COMPENSATE the already-applied lines with
    // the mirror credit back into the fromBin (reason
    // "transfer_in", note "transfer:<id> rollback") so the bins
    // return to their pre-dispatch state, then rethrow — the
    // transfer row itself stays in draft.
    const applied: any[] = [];
    try {
      for (const line of lines) {
        await inventory.applyBinOnlyDelta(organizationId, {
          productId: line.productId, variantId: line.variantId ?? null,
          binId: transfer.fromBinId, delta: -line.qtySent,
          reason: "transfer_out", refuseNegative: true,
          actorUserId: actorId, note: `transfer:${transfer.id}`,
        });
        applied.push(line);
      }
    } catch (e) {
      for (const line of applied) {
        await inventory.applyBinOnlyDelta(organizationId, {
          productId: line.productId, variantId: line.variantId ?? null,
          binId: transfer.fromBinId, delta: line.qtySent,
          reason: "transfer_in", actorUserId: actorId,
          note: `transfer:${transfer.id} rollback`,
        }).catch(() => null);
      }
      throw e;
    }

    const updated = await this.t("stockTransfer").update({
      where: { id: transfer.id },
      data: { status: "in_transit", dispatchedAt: new Date() },
    });
    await this.log({
      organizationId, userId: actorId, action: "stock_transfer.dispatched",
      entityType: "StockTransfer", entityId: transfer.id,
      metadata: {
        fromBinId: transfer.fromBinId, toBinId: transfer.toBinId,
        lineCount: lines.length,
        totalQtySent: lines.reduce((s, l) => s + (Number(l.qtySent) || 0), 0),
      },
    });
    return this.detail(organizationId, updated ?? { ...transfer, status: "in_transit" });
  }

  async receiveTransfer(organizationId: string, actorId: string, transferId: string, dto?: ReceiveStockTransferDto) {
    const inventory = this.requireInventory();
    const transfer = await this.loadTransferOr404(organizationId, transferId);
    if (transfer.status !== "in_transit") {
      throw badRequest("warehouse.onlyAnInTransitTransferCan", { transferStatus: transfer.status });
    }
    const lines = await this.linesOf(transfer.id);
    const requested = new Map<string, number>();
    for (const entry of dto?.lines ?? []) {
      if (!lines.some((l) => l.id === entry.lineId)) {
        throw badRequest("warehouse.theLineDoesNotBelongTo");
      }
      requested.set(entry.lineId, entry.qtyReceived);
    }
    // Resolve + validate the FULL receive plan before any stock
    // moves. Lines not listed default to their qtySent. A line
    // whose qtyReceived was already persisted (a previous receive
    // attempt that failed after applying it) is never applied
    // twice — its recorded value stands.
    const plan: { line: any; qtyReceived: number; alreadyApplied: boolean }[] = [];
    for (const line of lines) {
      const alreadyApplied = line.qtyReceived != null;
      const qtyReceived = alreadyApplied
        ? (line.qtyReceived as number)
        : (requested.has(line.id) ? (requested.get(line.id) as number) : (line.qtySent as number));
      if (!Number.isInteger(qtyReceived) || qtyReceived < 0 || qtyReceived > line.qtySent) {
        const product = await this.t("product")?.findFirst({ where: { id: line.productId, organizationId } }).catch(() => null);
        throw badRequest("warehouse.theReceivedQuantityForMustBe", { p1: product?.name ?? line.productId, lineQtySent: line.qtySent });
      }
      plan.push({ line, qtyReceived, alreadyApplied });
    }

    let totalReceived = 0;
    let varianceTotal = 0;
    for (const { line, qtyReceived, alreadyApplied } of plan) {
      if (!alreadyApplied) {
        if (qtyReceived > 0) {
          await inventory.applyBinOnlyDelta(organizationId, {
            productId: line.productId, variantId: line.variantId ?? null,
            binId: transfer.toBinId, delta: qtyReceived,
            reason: "transfer_in", actorUserId: actorId,
            note: `transfer:${transfer.id}`,
          });
        }
        // Persist qtyReceived on EVERY line, including 0.
        await this.t("stockTransferLine").update({
          where: { id: line.id }, data: { qtyReceived },
        });
      }
      totalReceived += qtyReceived;
      varianceTotal += (line.qtySent as number) - qtyReceived;
    }

    // The variance units are recorded on the lines and are NOT
    // returned to any bin (design §6) — they are gone.
    const status = varianceTotal === 0 ? "received" : "received_with_variance";
    const updated = await this.t("stockTransfer").update({
      where: { id: transfer.id },
      data: { status, receivedAt: new Date() },
    });
    await this.log({
      organizationId, userId: actorId, action: "stock_transfer.received",
      entityType: "StockTransfer", entityId: transfer.id,
      metadata: { status, totalReceived, varianceTotal },
    });
    return this.detail(organizationId, updated ?? { ...transfer, status });
  }

  async cancelTransfer(organizationId: string, actorId: string, transferId: string) {
    const transfer = await this.loadTransferOr404(organizationId, transferId);
    if (transfer.status === "draft") {
      // Nothing ever moved — just close the draft.
      const updated = await this.t("stockTransfer").update({
        where: { id: transfer.id }, data: { status: "cancelled" },
      });
      await this.log({
        organizationId, userId: actorId, action: "stock_transfer.cancelled",
        entityType: "StockTransfer", entityId: transfer.id,
        metadata: { fromStatus: "draft" },
      });
      return this.detail(organizationId, updated ?? { ...transfer, status: "cancelled" });
    }
    if (transfer.status === "in_transit") {
      const inventory = this.requireInventory();
      const lines = await this.linesOf(transfer.id);
      for (const line of lines) {
        // Outstanding = what dispatch took and no receive has
        // landed yet (normally the full qtySent).
        const outstanding = (Number(line.qtySent) || 0) - (Number(line.qtyReceived) || 0);
        if (outstanding <= 0) continue;
        await inventory.applyBinOnlyDelta(organizationId, {
          productId: line.productId, variantId: line.variantId ?? null,
          binId: transfer.fromBinId, delta: outstanding,
          reason: "transfer_in", actorUserId: actorId,
          note: `transfer:${transfer.id} cancel`,
        });
      }
      const updated = await this.t("stockTransfer").update({
        where: { id: transfer.id }, data: { status: "cancelled" },
      });
      await this.log({
        organizationId, userId: actorId, action: "stock_transfer.cancelled",
        entityType: "StockTransfer", entityId: transfer.id,
        metadata: { fromStatus: "in_transit" },
      });
      return this.detail(organizationId, updated ?? { ...transfer, status: "cancelled" });
    }
    throw badRequest("warehouse.aTransferInThisStatusCannot", { transferStatus: transfer.status });
  }
}
