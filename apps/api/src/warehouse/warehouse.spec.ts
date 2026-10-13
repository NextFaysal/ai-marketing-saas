import { WarehouseService } from "./warehouse.service";
import { InventoryService } from "../inventory/inventory.service";

/**
 * EC21 — Warehouse & Stock Ops specs.
 *
 * In-memory fake Prisma in the makeTable style of
 * inventory.spec.ts. The REAL InventoryService is constructed
 * over the same fake so stock-count closing is asserted
 * end-to-end: StockMovement rows (reason "stock_count") and the
 * resulting Product / ProductVariant balances.
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
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => r.id === where.id);
      if (idx < 0) throw new Error(`row not found in ${name}: ${where.id}`);
      const [row] = rows.splice(idx, 1);
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
    warehouse: makeTable("warehouse"), binLocation: makeTable("bin"),
    productBinAssignment: makeTable("assignment"),
    stockCountSession: makeTable("session"), stockCountLine: makeTable("line"),
    product: makeTable("product"), productVariant: makeTable("variant"),
    stockMovement: makeTable("movement"),
    membership: makeTable("membership"), agentNotification: makeTable("notif"),
    auditLog: makeTable("audit"),
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
  const svc = new WarehouseService(prisma as any, audit, inventory);
  return { prisma, audit, inventory, svc };
}

async function seedProduct(prisma: any, over: Record<string, unknown> = {}) {
  return prisma.product.create({
    data: {
      organizationId: "org-1", name: "Panjabi", sku: "PN-1", priceMinor: 100000n,
      stockQuantity: 20, lowStockThreshold: null, ...over,
    },
  });
}

async function seedWarehouseWithBins(svc: WarehouseService) {
  const wh = await svc.createWarehouse("org-1", "u1", { name: "প্রধান গুদাম", isDefault: true });
  const bin1 = await svc.createBin("org-1", "u1", wh.id, { code: "A-01" });
  const bin2 = await svc.createBin("org-1", "u1", wh.id, { code: "A-02" });
  return { wh, bin1, bin2 };
}

describe("EC21 warehouses", () => {
  it("isDefault=true unsets other defaults; DELETE is a soft active=false; foreign ids 404", async () => {
    const { prisma, svc } = setup();
    const w1 = await svc.createWarehouse("org-1", "u1", { name: "এক", isDefault: true });
    const w2 = await svc.createWarehouse("org-1", "u1", { name: "দুই", isDefault: true });
    expect(prisma.warehouse.rows.find((w: any) => w.id === w1.id).isDefault).toBe(false);
    expect(prisma.warehouse.rows.find((w: any) => w.id === w2.id).isDefault).toBe(true);

    const list = await svc.listWarehouses("org-1");
    expect(list.items).toHaveLength(2);
    expect(list.items[0]).toMatchObject({ binCount: 0, assignmentCount: 0 });

    await svc.deleteWarehouse("org-1", "u1", w2.id);
    expect(prisma.warehouse.rows.find((w: any) => w.id === w2.id).active).toBe(false);
    await expect(svc.updateWarehouse("org-2", "u1", w1.id, { name: "x" })).rejects.toThrow(/পাওয়া যায়নি/);
  });
});

describe("EC21 bins", () => {
  it("duplicate bin code in the same warehouse => 400 Bengali; same code in another warehouse is fine", async () => {
    const { svc } = setup();
    const { wh, bin1 } = await seedWarehouseWithBins(svc);
    expect(bin1.code).toBe("A-01");
    await expect(svc.createBin("org-1", "u1", wh.id, { code: "A-01" }))
      .rejects.toThrow("এই গুদামে এই কোডের বিন আগেই আছে");
    const other = await svc.createWarehouse("org-1", "u1", { name: "অন্য গুদাম" });
    const ok = await svc.createBin("org-1", "u1", other.id, { code: "A-01" });
    expect(ok.code).toBe("A-01");
    await expect(svc.createBin("org-1", "u1", "missing-warehouse", { code: "B-01" }))
      .rejects.toThrow(/পাওয়া যায়নি/);
  });
});

describe("EC21 bin assignments", () => {
  it("creates, then a second upsert for the same key MOVES the same row", async () => {
    const { prisma, svc } = setup();
    const { wh, bin1, bin2 } = await seedWarehouseWithBins(svc);
    const p = await seedProduct(prisma);
    const created = await svc.upsertAssignment("org-1", "u1", {
      warehouseId: wh.id, binLocationId: bin1.id, productId: p.id,
    });
    expect(created).toMatchObject({ binLocationId: bin1.id, binCode: "A-01", warehouseName: "প্রধান গুদাম", productName: "Panjabi", variantName: null });

    const moved = await svc.upsertAssignment("org-1", "u1", {
      warehouseId: wh.id, binLocationId: bin2.id, productId: p.id,
    });
    expect(moved.id).toBe(created.id);
    expect(moved.binLocationId).toBe(bin2.id);
    expect(moved.binCode).toBe("A-02");
    expect(prisma.productBinAssignment.rows).toHaveLength(1);
    const actions = prisma.auditLog.rows.map((a: any) => a.action);
    expect(actions).toContain("assignment.created");
    expect(actions).toContain("assignment.moved");

    const list = await svc.listAssignments("org-1", { warehouseId: wh.id });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ binCode: "A-02", productName: "Panjabi" });
  });

  it("product-level uniqueness: variant rows are a SEPARATE key from the null-variant row", async () => {
    const { prisma, svc } = setup();
    const { wh, bin1, bin2 } = await seedWarehouseWithBins(svc);
    const p = await seedProduct(prisma);
    const v = await prisma.productVariant.create({ data: { productId: p.id, name: "XL", sku: "PN-1-XL", stockQuantity: 7 } });

    const prodRow = await svc.upsertAssignment("org-1", "u1", { warehouseId: wh.id, binLocationId: bin1.id, productId: p.id });
    const varRow = await svc.upsertAssignment("org-1", "u1", { warehouseId: wh.id, binLocationId: bin1.id, productId: p.id, variantId: v.id });
    expect(varRow.id).not.toBe(prodRow.id);
    expect(varRow.variantName).toBe("XL");

    // Re-assigning the product-level key moves ONLY that row.
    const moved = await svc.upsertAssignment("org-1", "u1", { warehouseId: wh.id, binLocationId: bin2.id, productId: p.id });
    expect(moved.id).toBe(prodRow.id);
    expect(prisma.productBinAssignment.rows).toHaveLength(2);
    expect(prisma.productBinAssignment.rows.find((a: any) => a.id === varRow.id).binLocationId).toBe(bin1.id);
  });

  it("validates bin-in-warehouse (400) and variant-belongs-to-product (400); foreign product 404", async () => {
    const { prisma, svc } = setup();
    const { wh, bin1 } = await seedWarehouseWithBins(svc);
    const otherWh = await svc.createWarehouse("org-1", "u1", { name: "অন্য" });
    const foreignBin = await svc.createBin("org-1", "u1", otherWh.id, { code: "Z-99" });
    const p = await seedProduct(prisma);
    const otherProduct = await seedProduct(prisma, { name: "অন্য পণ্য", sku: "OT-1" });
    const vOther = await prisma.productVariant.create({ data: { productId: otherProduct.id, name: "M", sku: "OT-1-M", stockQuantity: 3 } });

    await expect(svc.upsertAssignment("org-1", "u1", { warehouseId: wh.id, binLocationId: foreignBin.id, productId: p.id }))
      .rejects.toThrow("বিনটি এই গুদামের নয়");
    await expect(svc.upsertAssignment("org-1", "u1", { warehouseId: wh.id, binLocationId: bin1.id, productId: p.id, variantId: vOther.id }))
      .rejects.toThrow("ভ্যারিয়েন্টটি এই পণ্যের নয়");
    await expect(svc.upsertAssignment("org-1", "u1", { warehouseId: wh.id, binLocationId: bin1.id, productId: "nope" }))
      .rejects.toThrow(/পাওয়া যায়নি/);
    await expect(svc.deleteAssignment("org-2", "u1", "anything")).rejects.toThrow(/পাওয়া যায়নি/);
    // the seeded foreign bin variable keeps the first 400 honest:
    expect(foreignBin.warehouseId).toBe(otherWh.id);
  });
});

describe("EC21 stock counts — line generation", () => {
  it("bin-scoped: lines come from that bin's assignments only, systemQty is a snapshot, untracked skipped", async () => {
    const { prisma, svc } = setup();
    const { wh, bin1, bin2 } = await seedWarehouseWithBins(svc);
    const p1 = await seedProduct(prisma, { name: "P1", sku: "P1", stockQuantity: 10 });
    const p2 = await seedProduct(prisma, { name: "P2", sku: "P2", stockQuantity: null });
    const v2 = await prisma.productVariant.create({ data: { productId: p2.id, name: "XL", sku: "P2-XL", stockQuantity: 7 } });
    const pUntracked = await seedProduct(prisma, { name: "P3", sku: "P3", stockQuantity: null });
    const pOtherBin = await seedProduct(prisma, { name: "P4", sku: "P4", stockQuantity: 99 });

    await svc.upsertAssignment("org-1", "u1", { warehouseId: wh.id, binLocationId: bin1.id, productId: p1.id });
    await svc.upsertAssignment("org-1", "u1", { warehouseId: wh.id, binLocationId: bin1.id, productId: p2.id, variantId: v2.id });
    await svc.upsertAssignment("org-1", "u1", { warehouseId: wh.id, binLocationId: bin1.id, productId: pUntracked.id });
    await svc.upsertAssignment("org-1", "u1", { warehouseId: wh.id, binLocationId: bin2.id, productId: pOtherBin.id });

    const created = await svc.createStockCount("org-1", "u1", { warehouseId: wh.id, binLocationId: bin1.id });
    expect(created.status).toBe("open");
    expect(created.skippedUntracked).toBe(1);
    expect(created.lines).toHaveLength(2);
    expect(created.lines.find((l: any) => l.productId === p1.id)).toMatchObject({ variantId: null, systemQty: 10, productName: "P1" });
    expect(created.lines.find((l: any) => l.productId === p2.id)).toMatchObject({ variantId: v2.id, systemQty: 7, variantName: "XL" });
    expect(created.totals).toMatchObject({ lineCount: 2, countedCount: 0, skippedCount: 2, totalVariance: 0 });

    // Snapshot: moving the live balance afterwards does not
    // rewrite the session's systemQty.
    prisma.product.rows.find((p: any) => p.id === p1.id).stockQuantity = 999;
    const view = await svc.getStockCount("org-1", created.id);
    expect(view.lines.find((l: any) => l.productId === p1.id).systemQty).toBe(10);

    await expect(svc.createStockCount("org-1", "u1", { warehouseId: wh.id, binLocationId: bin2.id.replace("bin", "nope") }))
      .rejects.toThrow("বিনটি এই গুদামের নয়");
  });

  it("unscoped: one line per tracked variant + product-level only for products with NO variants", async () => {
    const { prisma, svc } = setup();
    const { wh } = await seedWarehouseWithBins(svc);
    const a = await seedProduct(prisma, { name: "A", sku: "A", stockQuantity: 20 }); // no variants -> product line
    const b = await seedProduct(prisma, { name: "B", sku: "B", stockQuantity: null }); // no variants, untracked -> skipped
    const c = await seedProduct(prisma, { name: "C", sku: "C", stockQuantity: 50 }); // has variants -> NO product line
    const cv1 = await prisma.productVariant.create({ data: { productId: c.id, name: "S", sku: "C-S", stockQuantity: 5 } });
    await prisma.productVariant.create({ data: { productId: c.id, name: "M", sku: "C-M", stockQuantity: null } }); // untracked -> skipped
    const cv3 = await prisma.productVariant.create({ data: { productId: c.id, name: "L", sku: "C-L", stockQuantity: 3 } });
    const d = await seedProduct(prisma, { name: "D", sku: "D", stockQuantity: null }); // product untracked but variant tracked
    const dv = await prisma.productVariant.create({ data: { productId: d.id, name: "One", sku: "D-1", stockQuantity: 2 } });

    const created = await svc.createStockCount("org-1", "u1", { warehouseId: wh.id });
    expect(created.skippedUntracked).toBe(2); // B + C-M
    const keys = created.lines.map((l: any) => `${l.productId}::${l.variantId ?? ""}`).sort();
    expect(keys).toEqual([
      `${a.id}::`, `${c.id}::${cv1.id}`, `${c.id}::${cv3.id}`, `${d.id}::${dv.id}`,
    ].sort());
    expect(created.lines.find((l: any) => l.productId === a.id).systemQty).toBe(20);
    expect(created.lines.find((l: any) => l.variantId === cv3.id).systemQty).toBe(3);
    expect(b).toBeTruthy();

    const list = await svc.listStockCounts("org-1");
    expect(list.items[0]).toMatchObject({ id: created.id, lineCount: 4, countedCount: 0 });
  });
});

describe("EC21 stock counts — close", () => {
  it("partial counts: only counted lines are adjusted via stock_count movements; uncounted are skipped, never zeroed", async () => {
    const { prisma, svc } = setup();
    const { wh } = await seedWarehouseWithBins(svc);
    const p1 = await seedProduct(prisma, { name: "P1", sku: "P1", stockQuantity: 20 });
    const pv = await seedProduct(prisma, { name: "PV", sku: "PV", stockQuantity: 999 });
    const vv = await prisma.productVariant.create({ data: { productId: pv.id, name: "XL", sku: "PV-XL", stockQuantity: 10 } });
    const pSkip = await seedProduct(prisma, { name: "PS", sku: "PS", stockQuantity: 8 });

    const created = await svc.createStockCount("org-1", "u1", { warehouseId: wh.id });
    const lineP1 = created.lines.find((l: any) => l.productId === p1.id);
    const lineV = created.lines.find((l: any) => l.variantId === vv.id);
    const lineSkip = created.lines.find((l: any) => l.productId === pSkip.id);

    await svc.setCountedQty("org-1", "u1", created.id, lineP1.id, 17); // delta -3
    await svc.setCountedQty("org-1", "u1", created.id, lineV.id, 12); // delta +2 (variant)
    // lineSkip deliberately left uncounted.

    const before = await svc.getStockCount("org-1", created.id);
    expect(before.totals).toMatchObject({ lineCount: 3, countedCount: 2, skippedCount: 1, totalVariance: -1 });
    expect(before.lines.find((l: any) => l.id === lineP1.id).variance).toBe(-3);
    expect(before.lines.find((l: any) => l.id === lineSkip.id).variance).toBeNull();

    const result = await svc.closeStockCount("org-1", "u1", created.id);
    expect(result.applied).toEqual(expect.arrayContaining([
      { lineId: lineP1.id, delta: -3 },
      { lineId: lineV.id, delta: 2 },
    ]));
    expect(result.applied).toHaveLength(2);
    expect(result.skipped).toEqual([{ lineId: lineSkip.id, reason: "গণনা করা হয়নি" }]);
    expect(result.session.status).toBe("closed");
    expect(result.session.closedAt).toBeTruthy();
    expect(result.session.totals).toMatchObject({ countedCount: 2, skippedCount: 1, totalVariance: -1 });

    // Balances landed through the S1 writer only.
    expect(prisma.product.rows.find((p: any) => p.id === p1.id).stockQuantity).toBe(17);
    expect(prisma.productVariant.rows.find((v: any) => v.id === vv.id).stockQuantity).toBe(12);
    expect(prisma.product.rows.find((p: any) => p.id === pv.id).stockQuantity).toBe(999); // variant sale never touches product row
    expect(prisma.product.rows.find((p: any) => p.id === pSkip.id).stockQuantity).toBe(8); // uncounted NEVER zeroed

    const movements = prisma.stockMovement.rows.filter((m: any) => m.reason === "stock_count");
    expect(movements).toHaveLength(2);
    expect(movements.find((m: any) => m.productId === p1.id)).toMatchObject({ delta: -3, balanceAfter: 17, note: `স্টক গণনা ${created.id}` });
    expect(movements.find((m: any) => m.variantId === vv.id)).toMatchObject({ delta: 2, balanceAfter: 12 });

    const closedAudit = prisma.auditLog.rows.find((a: any) => a.action === "stock_count.closed");
    expect(closedAudit.metadata).toMatchObject({ appliedCount: 2, skippedCount: 1 });
  });

  it("a line whose row became untracked after the snapshot is skipped at close, not fatal", async () => {
    const { prisma, svc } = setup();
    const { wh } = await seedWarehouseWithBins(svc);
    const p1 = await seedProduct(prisma, { name: "P1", sku: "P1", stockQuantity: 10 });
    const created = await svc.createStockCount("org-1", "u1", { warehouseId: wh.id });
    const line = created.lines[0];
    await svc.setCountedQty("org-1", "u1", created.id, line.id, 4);
    prisma.product.rows.find((p: any) => p.id === p1.id).stockQuantity = null; // tracking switched off meanwhile
    const result = await svc.closeStockCount("org-1", "u1", created.id);
    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].lineId).toBe(line.id);
    expect(result.skipped[0].reason).toMatch(/স্টক ট্র্যাক করা হচ্ছে না/);
    expect(result.session.status).toBe("closed");
    expect(prisma.stockMovement.rows.filter((m: any) => m.reason === "stock_count")).toHaveLength(0);
  });

  it("closed sessions are immutable: setCountedQty and a second close both 400", async () => {
    const { prisma, svc } = setup();
    const { wh } = await seedWarehouseWithBins(svc);
    await seedProduct(prisma, { stockQuantity: 5 });
    const created = await svc.createStockCount("org-1", "u1", { warehouseId: wh.id });
    const line = created.lines[0];
    await svc.setCountedQty("org-1", "u1", created.id, line.id, 5); // delta 0 — no movement
    const result = await svc.closeStockCount("org-1", "u1", created.id);
    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    await expect(svc.setCountedQty("org-1", "u1", created.id, line.id, 3)).rejects.toThrow("এই গণনা বন্ধ হয়ে গেছে");
    await expect(svc.closeStockCount("org-1", "u1", created.id)).rejects.toThrow("এই গণনা বন্ধ হয়ে গেছে");
    // countedQty shape validation on an open session
    const open = await svc.createStockCount("org-1", "u1", { warehouseId: wh.id });
    await expect(svc.setCountedQty("org-1", "u1", open.id, open.lines[0].id, -1)).rejects.toThrow(/পূর্ণসংখ্যা/);
    await expect(svc.setCountedQty("org-1", "u1", open.id, "no-such-line", 1)).rejects.toThrow(/পাওয়া যায়নি/);
    expect(prisma.stockCountSession.rows).toHaveLength(2);
  });
});
