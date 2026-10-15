import { PurchasingService } from "./purchasing.service";
import { InventoryService } from "../inventory/inventory.service";

/**
 * EC20 — Purchasing & Suppliers specs.
 *
 * In-memory fake Prisma in the makeTable style of the inventory
 * specs. The REAL InventoryService is constructed over the same
 * fake, so stock assertions (balances, StockMovement rows) are the
 * inventory ledger's own truth, not a mock's.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v && !v.in.includes(row[k])) return false;
      if ("notIn" in v && v.notIn.includes(row[k])) return false;
      if ("gte" in v && !(row[k] != null && new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
      if ("lt" in v && !(row[k] != null && new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
    findMany: async ({ where, take, skip, orderBy }: any = {}) => {
      let f = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "desc") f = [...f].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (orderBy?.createdAt === "asc") f = [...f].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      if (skip) f = f.slice(skip);
      if (take) f = f.slice(0, take);
      return f;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(Date.now() + seq * 10), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error(`row not found in ${name}: ${where.id}`);
      Object.assign(row, data);
      return row;
    },
    deleteMany: async ({ where }: any) => {
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1);
      return { count: 0 };
    },
  };
}

function fakePrisma() {
  return {
    supplier: makeTable("supplier"), purchaseOrder: makeTable("po"), purchaseOrderItem: makeTable("poi"),
    product: makeTable("product"), productVariant: makeTable("variant"), productCost: makeTable("cost"),
    stockMovement: makeTable("movement"), membership: makeTable("membership"),
    agentNotification: makeTable("notif"), auditLog: makeTable("audit"),
  };
}

function fakeAudit(prisma: any) {
  return {
    log: jest.fn(async (input: any) => {
      await prisma.auditLog.create({
        data: {
          organizationId: input.organizationId ?? null,
          userId: input.userId ?? null,
          action: input.action, entityType: input.entityType,
          entityId: input.entityId ?? null, metadata: input.metadata ?? null,
        },
      });
    }),
  } as any;
}

function setup() {
  const prisma: any = fakePrisma();
  const audit = fakeAudit(prisma);
  const inventory = new InventoryService(prisma as any, audit);
  const svc = new PurchasingService(prisma as any, audit, inventory);
  return { prisma, audit, inventory, svc };
}

async function seedSupplier(prisma: any, over: Record<string, unknown> = {}) {
  return prisma.supplier.create({
    data: { organizationId: "org-1", name: "Rahim Traders", active: true, ...over },
  });
}

async function seedProduct(prisma: any, over: Record<string, unknown> = {}) {
  return prisma.product.create({
    data: {
      organizationId: "org-1", name: "T-Shirt", sku: "TS-1", status: "ACTIVE",
      priceMinor: 100000n, stockQuantity: 0, lowStockThreshold: null, ...over,
    },
  });
}

describe("PurchasingService suppliers", () => {
  it("rejects an empty supplier name with a Bengali 400", async () => {
    const { svc } = setup();
    await expect(svc.createSupplier("org-1", "owner-1", { name: "   " } as any))
      .rejects.toThrow(/সরবরাহকারীর নাম আবশ্যক/);
  });

  it("delete deactivates (active=false) instead of hard-deleting, and list counts POs", async () => {
    const { prisma, svc } = setup();
    const s = await seedSupplier(prisma);
    const p = await seedProduct(prisma);
    await svc.createPurchaseOrder("org-1", "owner-1", {
      supplierId: s.id, items: [{ productId: p.id, qtyOrdered: 2, unitCostMinor: "500" }],
    } as any);
    const list = await svc.listSuppliers("org-1");
    expect(list.items[0].purchaseOrderCount).toBe(1);
    const del = await svc.deleteSupplier("org-1", "owner-1", s.id);
    expect(del.active).toBe(false);
    expect(prisma.supplier.rows).toHaveLength(1); // row survives — POs reference it
  });
});

describe("PurchasingService.createPurchaseOrder validation", () => {
  it("404s a foreign supplier", async () => {
    const { prisma, svc } = setup();
    const foreign = await seedSupplier(prisma, { organizationId: "org-2" });
    const p = await seedProduct(prisma);
    await expect(svc.createPurchaseOrder("org-1", "owner-1", {
      supplierId: foreign.id, items: [{ productId: p.id, qtyOrdered: 1, unitCostMinor: "100" }],
    } as any)).rejects.toThrow(/Supplier not found in this organization/);
  });

  it("404s a foreign product", async () => {
    const { prisma, svc } = setup();
    const s = await seedSupplier(prisma);
    const foreign = await seedProduct(prisma, { organizationId: "org-2" });
    await expect(svc.createPurchaseOrder("org-1", "owner-1", {
      supplierId: s.id, items: [{ productId: foreign.id, qtyOrdered: 1, unitCostMinor: "100" }],
    } as any)).rejects.toThrow(/Product not found in this organization/);
  });

  it("400s a bad qty and a bad unit cost, writing nothing", async () => {
    const { prisma, svc } = setup();
    const s = await seedSupplier(prisma);
    const p = await seedProduct(prisma);
    await expect(svc.createPurchaseOrder("org-1", "owner-1", {
      supplierId: s.id, items: [{ productId: p.id, qtyOrdered: 0, unitCostMinor: "100" }],
    } as any)).rejects.toThrow(/qtyOrdered/);
    await expect(svc.createPurchaseOrder("org-1", "owner-1", {
      supplierId: s.id, items: [{ productId: p.id, qtyOrdered: 1.5, unitCostMinor: "100" }],
    } as any)).rejects.toThrow(/qtyOrdered/);
    await expect(svc.createPurchaseOrder("org-1", "owner-1", {
      supplierId: s.id, items: [{ productId: p.id, qtyOrdered: 1, unitCostMinor: "-5" }],
    } as any)).rejects.toThrow(/unitCostMinor/);
    expect(prisma.purchaseOrder.rows).toHaveLength(0);
  });

  it("400s a variantId that belongs to another product; a bare sku resolves its variant", async () => {
    const { prisma, svc } = setup();
    const s = await seedSupplier(prisma);
    const p = await seedProduct(prisma);
    const other = await seedProduct(prisma, { name: "Other", sku: "OT-1" });
    const vOther = await prisma.productVariant.create({ data: { productId: other.id, name: "L", sku: "OT-1-L", stockQuantity: 3 } });
    await expect(svc.createPurchaseOrder("org-1", "owner-1", {
      supplierId: s.id, items: [{ productId: p.id, variantId: vOther.id, qtyOrdered: 1, unitCostMinor: "100" }],
    } as any)).rejects.toThrow(/ভ্যারিয়েন্টটি এই পণ্যের অন্তর্গত নয়/);

    const v = await prisma.productVariant.create({ data: { productId: p.id, name: "XL", sku: "TS-1-XL", stockQuantity: 3 } });
    const po = await svc.createPurchaseOrder("org-1", "owner-1", {
      supplierId: s.id, items: [{ productId: p.id, sku: "TS-1-XL", qtyOrdered: 4, unitCostMinor: "700" }],
    } as any);
    expect(po.status).toBe("draft");
    expect(po.items[0]).toMatchObject({ variantId: v.id, sku: "TS-1-XL", variantName: "XL", remainingQty: 4 });
    expect(po.orderedTotalMinor).toBe("2800");
  });
});

describe("PurchasingService.receive", () => {
  async function poWithStock() {
    const ctx = setup();
    const s = await seedSupplier(ctx.prisma);
    const p = await seedProduct(ctx.prisma, { stockQuantity: 10 });
    // Existing cost history: 100 minor at product level.
    await ctx.prisma.productCost.create({
      data: { productId: p.id, variantId: null, costMinor: 100n, effectiveFrom: new Date(), note: "seed" },
    });
    const po = await ctx.svc.createPurchaseOrder("org-1", "owner-1", {
      supplierId: s.id, items: [{ productId: p.id, qtyOrdered: 20, unitCostMinor: "200" }],
    } as any);
    return { ...ctx, s, p, po, itemId: po.items[0].id };
  }

  it("partial receive: partially_received, stock via purchase_receive movement, weighted-average cost 150", async () => {
    const { prisma, svc, p, po, itemId } = await poWithStock();
    const out = await svc.receive("org-1", "owner-1", po.id, { items: [{ itemId, qty: 10 }] } as any);
    expect(out.status).toBe("partially_received");
    expect(out.items[0]).toMatchObject({ qtyReceived: 10, remainingQty: 10 });
    expect(prisma.product.rows[0].stockQuantity).toBe(20);
    const movements = prisma.stockMovement.rows.filter((m: any) => m.reason === "purchase_receive");
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ productId: p.id, delta: 10, balanceAfter: 20 });
    // (10 × 100 + 10 × 200) / 20 = 150
    const costs = prisma.productCost.rows;
    expect(costs).toHaveLength(2);
    expect(costs[1].costMinor).toBe(150n);
    expect(costs[1].note).toContain("থেকে প্রাপ্তি");
    const auditRow = prisma.auditLog.rows.find((a: any) => a.action === "purchase_order.received");
    expect(auditRow.metadata.newStatus).toBe("partially_received");
    expect(auditRow.metadata.lines).toEqual([{ itemId, qty: 10, unitCostMinor: "200" }]);
  });

  it("zero-stock start: cost becomes the received unit cost (override honoured)", async () => {
    const { prisma, svc } = setup();
    const s = await seedSupplier(prisma);
    const p = await seedProduct(prisma, { stockQuantity: 0 });
    const po = await svc.createPurchaseOrder("org-1", "owner-1", {
      supplierId: s.id, items: [{ productId: p.id, qtyOrdered: 5, unitCostMinor: "300" }],
    } as any);
    await svc.receive("org-1", "owner-1", po.id, {
      items: [{ itemId: po.items[0].id, qty: 5, unitCostMinor: "450" }],
    } as any);
    expect(prisma.productCost.rows).toHaveLength(1);
    expect(prisma.productCost.rows[0].costMinor).toBe(450n); // override, no history
    expect(prisma.product.rows[0].stockQuantity).toBe(5);
  });

  it("full receive lands on status received", async () => {
    const { svc, po, itemId } = await poWithStock();
    const out = await svc.receive("org-1", "owner-1", po.id, { items: [{ itemId, qty: 20 }] } as any);
    expect(out.status).toBe("received");
    expect(out.items[0].remainingQty).toBe(0);
    expect(out.receivedTotalMinor).toBe("4000");
  });

  it("over-receive: 400 with the remaining amount, and NO writes at all", async () => {
    const { prisma, svc, po, itemId } = await poWithStock();
    await expect(svc.receive("org-1", "owner-1", po.id, { items: [{ itemId, qty: 21 }] } as any))
      .rejects.toThrow(/আর মাত্র 20টি গ্রহণ করা যাবে/);
    expect(prisma.product.rows[0].stockQuantity).toBe(10); // unchanged
    expect(prisma.purchaseOrderItem.rows[0].qtyReceived).toBe(0); // unchanged
    expect(prisma.stockMovement.rows).toHaveLength(0);
    expect(prisma.productCost.rows).toHaveLength(1); // only the seed row
    expect(prisma.purchaseOrder.rows[0].status).toBe("draft");
  });

  it("an item from another PO in the same request blocks the whole receive", async () => {
    const { prisma, svc, po, itemId } = await poWithStock();
    const s2item = await prisma.purchaseOrderItem.create({
      data: { purchaseOrderId: "po-elsewhere", productId: "x", qtyOrdered: 1, qtyReceived: 0, unitCostMinor: 1n },
    });
    await expect(svc.receive("org-1", "owner-1", po.id, {
      items: [{ itemId, qty: 5 }, { itemId: s2item.id, qty: 1 }],
    } as any)).rejects.toThrow(/ক্রয় অর্ডারের অন্তর্গত নয়/);
    expect(prisma.product.rows[0].stockQuantity).toBe(10);
    expect(prisma.purchaseOrderItem.rows[0].qtyReceived).toBe(0);
  });

  it("receive on a cancelled PO is a Bengali 400", async () => {
    const { svc, po, itemId } = await poWithStock();
    await svc.updatePurchaseOrder("org-1", "owner-1", po.id, { status: "cancelled" } as any);
    await expect(svc.receive("org-1", "owner-1", po.id, { items: [{ itemId, qty: 1 }] } as any))
      .rejects.toThrow(/বাতিল করা ক্রয় অর্ডারে পণ্য গ্রহণ করা যাবে না/);
  });

  it("an untracked product establishes tracking (baseline 0, no extra movement) and lands at qty", async () => {
    const { prisma, svc } = setup();
    const s = await seedSupplier(prisma);
    const p = await seedProduct(prisma, { stockQuantity: null });
    const po = await svc.createPurchaseOrder("org-1", "owner-1", {
      supplierId: s.id, items: [{ productId: p.id, qtyOrdered: 7, unitCostMinor: "250" }],
    } as any);
    const out = await svc.receive("org-1", "owner-1", po.id, {
      items: [{ itemId: po.items[0].id, qty: 7 }],
    } as any);
    expect(out.status).toBe("received");
    expect(prisma.product.rows[0].stockQuantity).toBe(7);
    // Exactly ONE movement: the receive itself (baseline writes none).
    expect(prisma.stockMovement.rows).toHaveLength(1);
    expect(prisma.stockMovement.rows[0]).toMatchObject({ reason: "purchase_receive", delta: 7, balanceAfter: 7 });
    expect(prisma.productCost.rows[0].costMinor).toBe(250n);
  });

  it("variant receive: stock and weighted-average cost land on the VARIANT granularity", async () => {
    const { prisma, svc } = setup();
    const s = await seedSupplier(prisma);
    const p = await seedProduct(prisma, { stockQuantity: 99 });
    const v = await prisma.productVariant.create({ data: { productId: p.id, name: "XL", sku: "TS-1-XL", stockQuantity: 4 } });
    await prisma.productCost.create({
      data: { productId: p.id, variantId: v.id, costMinor: 100n, effectiveFrom: new Date(), note: "seed" },
    });
    // A product-level cost row must NOT leak into the variant average.
    await prisma.productCost.create({
      data: { productId: p.id, variantId: null, costMinor: 999n, effectiveFrom: new Date(), note: "product-level" },
    });
    const po = await svc.createPurchaseOrder("org-1", "owner-1", {
      supplierId: s.id, items: [{ productId: p.id, variantId: v.id, qtyOrdered: 4, unitCostMinor: "300" }],
    } as any);
    await svc.receive("org-1", "owner-1", po.id, { items: [{ itemId: po.items[0].id, qty: 4 }] } as any);
    expect(prisma.productVariant.rows[0].stockQuantity).toBe(8);
    expect(prisma.product.rows[0].stockQuantity).toBe(99); // untouched
    const variantCosts = prisma.productCost.rows.filter((c: any) => c.variantId === v.id);
    expect(variantCosts).toHaveLength(2);
    expect(variantCosts[1].costMinor).toBe(200n); // (4×100 + 4×300) / 8
  });
});

describe("PurchasingService.updatePurchaseOrder", () => {
  it("manual received status is refused; items replace only in draft", async () => {
    const { prisma, svc } = setup();
    const s = await seedSupplier(prisma);
    const p = await seedProduct(prisma);
    const po = await svc.createPurchaseOrder("org-1", "owner-1", {
      supplierId: s.id, items: [{ productId: p.id, qtyOrdered: 2, unitCostMinor: "100" }],
    } as any);
    await expect(svc.updatePurchaseOrder("org-1", "owner-1", po.id, { status: "received" } as any))
      .rejects.toThrow(/ম্যানুয়ালি সেট করা যায় না/);
    const replaced = await svc.updatePurchaseOrder("org-1", "owner-1", po.id, {
      status: "ordered",
      items: [{ productId: p.id, qtyOrdered: 9, unitCostMinor: "111" }],
    } as any);
    expect(replaced.items).toHaveLength(1);
    expect(replaced.items[0].qtyOrdered).toBe(9);
    expect(prisma.purchaseOrderItem.rows).toHaveLength(1);
    await expect(svc.updatePurchaseOrder("org-1", "owner-1", po.id, {
      items: [{ productId: p.id, qtyOrdered: 1, unitCostMinor: "1" }],
    } as any)).rejects.toThrow(/শুধুমাত্র ড্রাফট অবস্থায়/);
  });
});

describe("PurchasingService tenant isolation", () => {
  it("foreign PO: getOne and receive both 404", async () => {
    const { prisma, svc } = setup();
    const foreign = await prisma.purchaseOrder.create({
      data: { organizationId: "org-2", supplierId: "s-x", status: "draft" },
    });
    await expect(svc.getPurchaseOrder("org-1", foreign.id)).rejects.toThrow(/not found in this organization/);
    await expect(svc.receive("org-1", "owner-1", foreign.id, { items: [{ itemId: "i", qty: 1 }] } as any))
      .rejects.toThrow(/not found in this organization/);
  });
});

describe("PurchasingService.reorderSuggestions", () => {
  it("product-level vs variant-level entries, default threshold, last supplier/cost, suggestedQty rule", async () => {
    const { prisma, svc } = setup();
    const s = await seedSupplier(prisma);
    // Product-level: stock 3 <= default threshold 5, no variants.
    const a = await seedProduct(prisma, { name: "T-Shirt", stockQuantity: 3 });
    const poA = await svc.createPurchaseOrder("org-1", "owner-1", {
      supplierId: s.id, items: [{ productId: a.id, qtyOrdered: 10, unitCostMinor: "12345" }],
    } as any);
    expect(poA.status).toBe("draft");
    // A LATER but CANCELLED purchase at another cost must be ignored.
    const poCancelled = await svc.createPurchaseOrder("org-1", "owner-1", {
      supplierId: s.id, items: [{ productId: a.id, qtyOrdered: 10, unitCostMinor: "99999" }],
    } as any);
    await svc.updatePurchaseOrder("org-1", "owner-1", poCancelled.id, { status: "cancelled" } as any);

    // Variant-level: product stock is an aggregate (50) — variants rule.
    const b = await seedProduct(prisma, { name: "Panjabi", sku: "PN-1", stockQuantity: 50, lowStockThreshold: 4 });
    const vLow = await prisma.productVariant.create({ data: { productId: b.id, name: "XL", sku: "PN-1-XL", stockQuantity: 1 } });
    await prisma.productVariant.create({ data: { productId: b.id, name: "M", sku: "PN-1-M", stockQuantity: 100 } });

    // Above threshold and archived products produce nothing.
    await seedProduct(prisma, { name: "Plenty", sku: "PL-1", stockQuantity: 100 });
    await seedProduct(prisma, { name: "Old", sku: "OL-1", status: "ARCHIVED", stockQuantity: 0 });

    const { items } = await svc.reorderSuggestions("org-1");
    expect(items).toHaveLength(2);

    const entryA = items.find((e: any) => e.productId === a.id);
    expect(entryA).toMatchObject({
      productName: "T-Shirt", variantId: null, variantName: null, sku: "TS-1",
      currentStock: 3, threshold: 5, suggestedQty: 7, // max(1, 5*2 - 3)
      lastUnitCostMinor: "12345",
    });
    expect(entryA.lastSupplier).toEqual({ id: s.id, name: "Rahim Traders" });

    const entryB = items.find((e: any) => e.productId === b.id);
    expect(entryB).toMatchObject({
      productName: "Panjabi", variantId: vLow.id, variantName: "XL", sku: "PN-1-XL",
      currentStock: 1, threshold: 4, suggestedQty: 7, // max(1, 4*2 - 1)
      lastSupplier: null, lastUnitCostMinor: null,
    });
  });

  it("untracked rows (stockQuantity null) never appear", async () => {
    const { prisma, svc } = setup();
    await seedProduct(prisma, { stockQuantity: null });
    const p2 = await seedProduct(prisma, { name: "V", sku: "V-1", stockQuantity: null });
    await prisma.productVariant.create({ data: { productId: p2.id, name: "S", sku: "V-1-S", stockQuantity: null } });
    const { items } = await svc.reorderSuggestions("org-1");
    expect(items).toHaveLength(0);
  });
});
