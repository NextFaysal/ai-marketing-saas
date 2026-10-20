import {
  Injectable,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { InventoryService } from "../inventory/inventory.service";
import type {
  CreatePurchaseOrderDto,
  CreateSupplierDto,
  PurchaseOrderItemDto,
  ReceivePurchaseOrderDto,
  UpdatePurchaseOrderDto,
  UpdateSupplierDto,
} from "./purchasing.dto";
import { badRequest, notFound } from "../i18n/api-exception";

/**
 * EC20 — Purchasing & Suppliers.
 *
 * A PurchaseOrder is a promise from one supplier; RECEIVING is what
 * makes it real. Receiving never writes stock directly: every unit
 * lands through the S1 InventoryService (the ONLY stock writer)
 * under reason "purchase_receive", and each received line appends a
 * ProductCost history row carrying the new WEIGHTED-AVERAGE unit
 * cost at that line's granularity (variant rows for variant items,
 * variantId=null rows for product-level items).
 *
 * Money is BigInt in the DB and strings on the wire. No
 * $transaction: receive validates ALL lines first, then applies —
 * an invalid line means NOTHING is written.
 */

const PO_STATUSES = ["draft", "ordered", "partially_received", "received", "cancelled"] as const;
/** Manual status moves a human may make. received /
 * partially_received are deliberately absent — receiving drives
 * them, never a PATCH. */
const MANUAL_TRANSITIONS: Record<string, string[]> = {
  draft: ["ordered", "cancelled"],
  ordered: ["cancelled"],
};

@Injectable()
export class PurchasingService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit: AuditService,
    private readonly inventory: InventoryService,
  ) {}

  // ---------- helpers ----------

  private parseUnitCostMinor(value: unknown): bigint {
    if (typeof value === "bigint" && value >= 0n) return value;
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) return BigInt(value);
    if (typeof value === "string" && /^\d+$/.test(value.trim())) return BigInt(value.trim());
    throw badRequest("purchasing.theUnitCostUnitcostminorMustBe");
  }

  private parseExpectedDate(value: string | null | undefined): Date | null {
    if (value === undefined || value === null) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw badRequest("purchasing.theExpectedDateExpecteddateIsNot");
    return d;
  }

  private async loadSupplierOr404(orgId: string, supplierId: string): Promise<any> {
    const row = await (this.prisma as any).supplier.findFirst({
      where: { id: supplierId, organizationId: orgId },
    });
    if (!row) throw notFound("purchasing.supplierNotFoundInThisOrganization");
    return row;
  }

  private async loadPoOr404(orgId: string, poId: string): Promise<any> {
    const row = await (this.prisma as any).purchaseOrder.findFirst({
      where: { id: poId, organizationId: orgId },
    });
    if (!row) throw notFound("purchasing.purchaseOrderNotFoundInThis");
    return row;
  }

  /** Validate + resolve a set of PO item inputs (shared by create
   * and draft item replacement). Variant resolution mirrors the S1
   * SKU rule: an explicit variantId must belong to the product; a
   * bare sku resolves the variant by (productId, sku) and the sku
   * is snapshotted onto the line either way. */
  private async buildItems(orgId: string, rawItems: PurchaseOrderItemDto[]): Promise<any[]> {
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      throw badRequest("purchasing.aPurchaseOrderMustHaveAt");
    }
    const out: any[] = [];
    for (const raw of rawItems as any[]) {
      const product = await (this.prisma as any).product.findFirst({
        where: { id: raw.productId, organizationId: orgId },
      });
      if (!product) throw notFound("purchasing.productNotFoundInThisOrganization");
      let variant: any = null;
      if (raw.variantId) {
        variant = await (this.prisma as any).productVariant.findFirst({
          where: { id: raw.variantId, productId: product.id },
        });
        if (!variant) throw badRequest("purchasing.theVariantDoesNotBelongTo");
      } else if (raw.sku) {
        variant = await (this.prisma as any).productVariant
          .findFirst({ where: { productId: product.id, sku: raw.sku } })
          .catch(() => null);
      }
      if (!Number.isInteger(raw.qtyOrdered) || raw.qtyOrdered <= 0) {
        throw badRequest("purchasing.theQuantityQtyorderedMustBeAn");
      }
      out.push({
        productId: product.id,
        variantId: variant?.id ?? null,
        sku: variant?.sku ?? raw.sku ?? null,
        qtyOrdered: raw.qtyOrdered,
        qtyReceived: 0,
        unitCostMinor: this.parseUnitCostMinor(raw.unitCostMinor),
      });
    }
    return out;
  }

  /** Latest ProductCost at the SAME granularity (variant rows for
   * variant items, variantId=null rows for product-level items),
   * ordered by effectiveFrom desc, then createdAt desc. Sorted in
   * JS so the rule is identical on every Prisma version. */
  private async latestCostMinor(productId: string, variantId: string | null): Promise<bigint | null> {
    const rows = (((await (this.prisma as any).productCost
      .findMany({ where: { productId, variantId } })) ?? []) as any[])
      .slice()
      .sort((a, b) => {
        const eff = new Date(b.effectiveFrom ?? b.createdAt).getTime() - new Date(a.effectiveFrom ?? a.createdAt).getTime();
        if (eff !== 0) return eff;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    if (!rows.length) return null;
    return BigInt(rows[0].costMinor);
  }

  // ---------- Suppliers ----------

  async listSuppliers(orgId: string) {
    const rows = ((await (this.prisma as any).supplier.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
    })) ?? []) as any[];
    const items = await Promise.all(rows.map(async (s: any) => ({
      ...s,
      purchaseOrderCount: await (this.prisma as any).purchaseOrder.count({
        where: { organizationId: orgId, supplierId: s.id },
      }),
    })));
    return { items };
  }

  async createSupplier(orgId: string, actorId: string, dto: CreateSupplierDto) {
    const name = (dto.name ?? "").trim();
    if (!name) throw badRequest("purchasing.theSupplierNameIsRequiredAn");
    const row = await (this.prisma as any).supplier.create({
      data: {
        organizationId: orgId,
        name,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        address: dto.address ?? null,
        note: dto.note ?? null,
        active: dto.active ?? true,
      },
    });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "supplier.created",
      entityType: "Supplier", entityId: row.id, metadata: { name: row.name },
    }).catch(() => undefined);
    return row;
  }

  async updateSupplier(orgId: string, actorId: string, supplierId: string, dto: UpdateSupplierDto) {
    await this.loadSupplierOr404(orgId, supplierId);
    const data: Record<string, any> = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw badRequest("purchasing.theSupplierNameIsRequiredAn");
      data.name = name;
    }
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.note !== undefined) data.note = dto.note;
    if (dto.active !== undefined) data.active = dto.active;
    const updated = await (this.prisma as any).supplier.update({ where: { id: supplierId }, data });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "supplier.updated",
      entityType: "Supplier", entityId: supplierId,
    }).catch(() => undefined);
    return updated;
  }

  /** Delete = deactivate: PurchaseOrders reference suppliers with
   * onDelete Restrict, so a supplier with history can never be
   * hard-deleted — it is retired instead. */
  async deleteSupplier(orgId: string, actorId: string, supplierId: string) {
    await this.loadSupplierOr404(orgId, supplierId);
    const updated = await (this.prisma as any).supplier.update({
      where: { id: supplierId }, data: { active: false },
    });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "supplier.deactivated",
      entityType: "Supplier", entityId: supplierId,
    }).catch(() => undefined);
    return updated;
  }

  // ---------- Purchase orders ----------

  async createPurchaseOrder(orgId: string, actorId: string, dto: CreatePurchaseOrderDto) {
    const supplier = await this.loadSupplierOr404(orgId, dto.supplierId);
    const items = await this.buildItems(orgId, dto.items);
    const po = await (this.prisma as any).purchaseOrder.create({
      data: {
        organizationId: orgId,
        supplierId: supplier.id,
        status: "draft",
        expectedDate: this.parseExpectedDate(dto.expectedDate),
        note: dto.note ?? null,
        createdById: actorId,
      },
    });
    for (const item of items) {
      await (this.prisma as any).purchaseOrderItem.create({
        data: { purchaseOrderId: po.id, ...item },
      });
    }
    const orderedTotal = items.reduce((sum, i) => sum + BigInt(i.qtyOrdered) * i.unitCostMinor, 0n);
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "purchase_order.created",
      entityType: "PurchaseOrder", entityId: po.id,
      metadata: { supplierId: supplier.id, itemCount: items.length, orderedTotalMinor: String(orderedTotal) },
    }).catch(() => undefined);
    return this.getPurchaseOrder(orgId, po.id);
  }

  async listPurchaseOrders(orgId: string, status?: string) {
    const where: any = { organizationId: orgId };
    if (status) where.status = status;
    const rows = ((await (this.prisma as any).purchaseOrder.findMany({
      where, orderBy: { createdAt: "desc" },
    })) ?? []) as any[];
    const items = await Promise.all(rows.map(async (po: any) => {
      const supplier = await (this.prisma as any).supplier.findFirst({ where: { id: po.supplierId } });
      const lines = ((await (this.prisma as any).purchaseOrderItem.findMany({
        where: { purchaseOrderId: po.id },
      })) ?? []) as any[];
      const orderedTotal = lines.reduce((s, i) => s + BigInt(i.qtyOrdered) * BigInt(i.unitCostMinor), 0n);
      const receivedTotal = lines.reduce((s, i) => s + BigInt(i.qtyReceived) * BigInt(i.unitCostMinor), 0n);
      return {
        ...po,
        supplierName: supplier?.name ?? null,
        itemCount: lines.length,
        orderedTotalMinor: String(orderedTotal),
        receivedTotalMinor: String(receivedTotal),
      };
    }));
    return { items };
  }

  async getPurchaseOrder(orgId: string, poId: string) {
    const po = await this.loadPoOr404(orgId, poId);
    const supplier = await (this.prisma as any).supplier.findFirst({ where: { id: po.supplierId } });
    const lines = ((await (this.prisma as any).purchaseOrderItem.findMany({
      where: { purchaseOrderId: po.id },
    })) ?? []) as any[];
    const items = await Promise.all(lines.map(async (item: any) => {
      const product = await (this.prisma as any).product.findFirst({
        where: { id: item.productId, organizationId: orgId },
      });
      const variant = item.variantId
        ? await (this.prisma as any).productVariant.findFirst({ where: { id: item.variantId } })
        : null;
      return {
        ...item,
        unitCostMinor: String(item.unitCostMinor),
        productName: product?.name ?? null,
        variantName: variant?.name ?? null,
        remainingQty: item.qtyOrdered - item.qtyReceived,
      };
    }));
    const orderedTotal = lines.reduce((s, i) => s + BigInt(i.qtyOrdered) * BigInt(i.unitCostMinor), 0n);
    const receivedTotal = lines.reduce((s, i) => s + BigInt(i.qtyReceived) * BigInt(i.unitCostMinor), 0n);
    return {
      ...po,
      supplierName: supplier?.name ?? null,
      itemCount: lines.length,
      orderedTotalMinor: String(orderedTotal),
      receivedTotalMinor: String(receivedTotal),
      items,
    };
  }

  async updatePurchaseOrder(orgId: string, actorId: string, poId: string, dto: UpdatePurchaseOrderDto) {
    const po = await this.loadPoOr404(orgId, poId);
    if (!["draft", "ordered"].includes(po.status)) {
      throw badRequest("purchasing.onlyADraftOrOrderedPurchase");
    }
    // Validate EVERYTHING before writing anything.
    let nextItems: any[] | null = null;
    if (dto.items !== undefined) {
      if (po.status !== "draft") {
        throw badRequest("purchasing.itemsCanOnlyBeChangedIn");
      }
      nextItems = await this.buildItems(orgId, dto.items);
    }
    let nextStatus: string | undefined;
    if (dto.status !== undefined && dto.status !== po.status) {
      if (dto.status === "received" || dto.status === "partially_received") {
        throw badRequest("purchasing.theReceivedPartiallyReceivedStatusCannot");
      }
      const allowed = MANUAL_TRANSITIONS[po.status] ?? [];
      if (!allowed.includes(dto.status)) {
        throw badRequest("purchasing.theStatusCannotBeChangedFrom", { poStatus: po.status, dtoStatus: dto.status });
      }
      nextStatus = dto.status;
    }
    const data: Record<string, any> = {};
    if (dto.expectedDate !== undefined) data.expectedDate = this.parseExpectedDate(dto.expectedDate);
    if (dto.note !== undefined) data.note = dto.note;
    if (nextStatus !== undefined) data.status = nextStatus;
    if (nextItems) {
      await (this.prisma as any).purchaseOrderItem.deleteMany({ where: { purchaseOrderId: po.id } });
      for (const item of nextItems) {
        await (this.prisma as any).purchaseOrderItem.create({
          data: { purchaseOrderId: po.id, ...item },
        });
      }
    }
    if (Object.keys(data).length) {
      await (this.prisma as any).purchaseOrder.update({ where: { id: po.id }, data });
    }
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "purchase_order.updated",
      entityType: "PurchaseOrder", entityId: po.id,
      metadata: { status: nextStatus ?? po.status, itemsReplaced: nextItems !== null },
    }).catch(() => undefined);
    return this.getPurchaseOrder(orgId, poId);
  }

  // ---------- Receiving ----------

  async receive(orgId: string, actorId: string, poId: string, dto: ReceivePurchaseOrderDto) {
    const po = await this.loadPoOr404(orgId, poId);
    if (po.status === "cancelled") {
      throw badRequest("purchasing.productsCannotBeReceivedInA");
    }
    if (po.status === "received") {
      throw badRequest("purchasing.allProductsOfThisPurchaseOrder");
    }
    if (!["draft", "ordered", "partially_received"].includes(po.status)) {
      throw badRequest("purchasing.productsCannotBeReceivedInThis", { poStatus: po.status });
    }
    if (!Array.isArray(dto.items) || dto.items.length === 0) {
      throw badRequest("purchasing.giveAtLeastOneItemTo");
    }
    const poItems = ((await (this.prisma as any).purchaseOrderItem.findMany({
      where: { purchaseOrderId: po.id },
    })) ?? []) as any[];
    const byId = new Map(poItems.map((i: any) => [i.id, i]));

    // VALIDATE ALL LINES FIRST — if any line is invalid, NOTHING
    // below runs and nothing is written. Quantities for the same
    // item appearing twice are aggregated before the remaining
    // check, so a split line cannot smuggle an over-receive.
    const plan = new Map<string, { item: any; qty: number; unitCostOverride: bigint | null }>();
    for (const raw of dto.items as any[]) {
      const item = byId.get(raw.itemId);
      if (!item) throw badRequest("purchasing.theItemDoesNotBelongTo");
      if (!Number.isInteger(raw.qty) || raw.qty <= 0) {
        throw badRequest("purchasing.theReceivedQuantityMustBeAn");
      }
      const entry = plan.get(item.id) ?? { item, qty: 0, unitCostOverride: null };
      entry.qty += raw.qty;
      if (raw.unitCostMinor !== undefined && raw.unitCostMinor !== null) {
        entry.unitCostOverride = this.parseUnitCostMinor(raw.unitCostMinor);
      }
      plan.set(item.id, entry);
    }
    for (const { item, qty } of plan.values()) {
      const remaining = item.qtyOrdered - item.qtyReceived;
      if (qty > remaining) {
        throw badRequest("purchasing.atMostMoreCanBeReceived", { remaining: remaining, itemQtyOrdered: item.qtyOrdered, itemQtyReceived: item.qtyReceived });
      }
    }

    // APPLY — one line at a time, stock only via InventoryService.
    const applied: { itemId: string; qty: number; unitCostMinor: string }[] = [];
    for (const { item, qty, unitCostOverride } of plan.values()) {
      const effectiveCost = unitCostOverride ?? BigInt(item.unitCostMinor);
      const product = await (this.prisma as any).product.findFirst({
        where: { id: item.productId, organizationId: orgId },
      });
      if (!product) throw notFound("purchasing.productNotFoundInThisOrganization");
      const variant = item.variantId
        ? await (this.prisma as any).productVariant.findFirst({
            where: { id: item.variantId, productId: item.productId },
          })
        : null;

      let stockBefore: number | null = variant ? variant.stockQuantity : product.stockQuantity;
      if (stockBefore == null) {
        // Establishing tracking writes NO movement — the S1
        // baseline rule (same as recordSyncedStock's null→value
        // transition): the row simply becomes tracked at 0, and
        // the receive movement below explains the full balance.
        if (variant) {
          await (this.prisma as any).productVariant.update({
            where: { id: variant.id }, data: { stockQuantity: 0 },
          });
        } else {
          await (this.prisma as any).product.update({
            where: { id: product.id }, data: { stockQuantity: 0 },
          });
        }
        stockBefore = 0;
      }

      // Weighted-average cost at this line's granularity.
      const oldCost = await this.latestCostMinor(item.productId, item.variantId ?? null);
      const newCost = stockBefore <= 0 || oldCost == null
        ? effectiveCost
        : (BigInt(stockBefore) * oldCost + BigInt(qty) * effectiveCost) / BigInt(stockBefore + qty);

      await this.inventory.adjust(orgId, actorId, item.productId, {
        variantId: item.variantId ?? null,
        delta: qty,
        reason: "purchase_receive",
        note: `ক্রয় অর্ডার ${poId}`,
      });
      await (this.prisma as any).productCost.create({
        data: {
          productId: item.productId,
          variantId: item.variantId ?? null,
          costMinor: newCost,
          note: `ক্রয় অর্ডার ${poId} থেকে প্রাপ্তি`,
        },
      });
      const newReceived = item.qtyReceived + qty;
      await (this.prisma as any).purchaseOrderItem.update({
        where: { id: item.id }, data: { qtyReceived: newReceived },
      });
      item.qtyReceived = newReceived;
      applied.push({ itemId: item.id, qty, unitCostMinor: String(effectiveCost) });
    }

    const newStatus = poItems.every((i: any) => i.qtyReceived >= i.qtyOrdered)
      ? "received"
      : "partially_received";
    await (this.prisma as any).purchaseOrder.update({
      where: { id: po.id }, data: { status: newStatus },
    });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "purchase_order.received",
      entityType: "PurchaseOrder", entityId: po.id,
      metadata: { lines: applied, newStatus },
    }).catch(() => undefined);
    return this.getPurchaseOrder(orgId, poId);
  }

  // ---------- Reorder suggestions ----------

  /** Most recent non-cancelled purchase of a product (+variant when
   * given): its supplier and the unit cost actually paid. */
  private async lastPurchaseInfo(productId: string, variantId: string | null) {
    const where: any = { productId };
    if (variantId) where.variantId = variantId;
    const items = (((await (this.prisma as any).purchaseOrderItem.findMany({ where })) ?? []) as any[]);
    let best: { item: any; po: any } | null = null;
    for (const item of items) {
      const po = await (this.prisma as any).purchaseOrder.findFirst({
        where: { id: item.purchaseOrderId },
      });
      if (!po || po.status === "cancelled") continue;
      if (!best || new Date(po.createdAt).getTime() > new Date(best.po.createdAt).getTime()) {
        best = { item, po };
      }
    }
    if (!best) return { lastSupplier: null, lastUnitCostMinor: null };
    const supplier = await (this.prisma as any).supplier.findFirst({ where: { id: best.po.supplierId } });
    return {
      lastSupplier: supplier ? { id: supplier.id, name: supplier.name } : null,
      lastUnitCostMinor: String(best.item.unitCostMinor),
    };
  }

  async reorderSuggestions(orgId: string) {
    const products = (((await (this.prisma as any).product.findMany({
      where: { organizationId: orgId, status: "ACTIVE" },
    })) ?? []) as any[]);
    const entries: any[] = [];
    for (const product of products) {
      const threshold = this.inventory.resolveThreshold(product);
      const variants = (((await (this.prisma as any).productVariant.findMany({
        where: { productId: product.id },
      })) ?? []) as any[]);
      const trackedVariants = variants.filter((v: any) => v.stockQuantity != null);
      if (trackedVariants.length > 0) {
        // Variants are the tracked granularity — the product row is
        // an aggregate of them and gets NO entry of its own.
        for (const variant of trackedVariants) {
          if (variant.stockQuantity > threshold) continue;
          const info = await this.lastPurchaseInfo(product.id, variant.id);
          entries.push({
            productId: product.id,
            productName: product.name,
            variantId: variant.id,
            variantName: variant.name ?? null,
            sku: variant.sku ?? null,
            currentStock: variant.stockQuantity,
            threshold,
            suggestedQty: Math.max(1, threshold * 2 - variant.stockQuantity),
            ...info,
          });
        }
      } else if (product.stockQuantity != null && product.stockQuantity <= threshold) {
        const info = await this.lastPurchaseInfo(product.id, null);
        entries.push({
          productId: product.id,
          productName: product.name,
          variantId: null,
          variantName: null,
          sku: product.sku ?? null,
          currentStock: product.stockQuantity,
          threshold,
          suggestedQty: Math.max(1, threshold * 2 - product.stockQuantity),
          ...info,
        });
      }
    }
    return { items: entries };
  }
}

export { PO_STATUSES };
