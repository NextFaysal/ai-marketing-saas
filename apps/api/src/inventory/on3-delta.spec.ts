import { InventoryService } from "./inventory.service";

/**
 * ON3 — order_edit delta path + restore netting + ledger-only
 * stock transfer. Fake-Prisma style mirrors inventory.spec.ts.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v && !v.in.includes(row[k])) return false;
      if ("notIn" in v && v.notIn.includes(row[k])) return false;
      if ("gte" in v && !(row[k] != null && new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
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
    findMany: async ({ where, take, skip }: any = {}) => {
      let f = rows.filter((r) => matches(r, where ?? {}));
      if (skip) f = f.slice(skip);
      if (take) f = f.slice(0, take);
      return f;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(Date.now() + seq * 10), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error(`row not found in ${name}: ${where.id}`);
      Object.assign(row, data);
      return row;
    },
  };
}

function fakePrisma() {
  return {
    product: makeTable("product"), productVariant: makeTable("variant"),
    order: makeTable("order"), orderItem: makeTable("item"),
    stockMovement: makeTable("movement"), bundleItem: makeTable("bundleItem"),
    membership: makeTable("membership"), agentNotification: makeTable("notif"),
    auditLog: makeTable("audit"),
  };
}

function fakeAudit(prisma: any) {
  return {
    log: jest.fn(async (input: any) => {
      await prisma.auditLog.create({
        data: {
          organizationId: input.organizationId ?? null, userId: input.userId ?? null,
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
  const svc = new InventoryService(prisma as any, audit);
  return { prisma, audit, svc };
}

async function seedProduct(prisma: any, over: Record<string, unknown> = {}) {
  return prisma.product.create({
    data: {
      organizationId: "org-1", name: "Panjabi", sku: "PN-1", priceMinor: 100000n,
      stockQuantity: 20, lowStockThreshold: null, ...over,
    },
  });
}

describe("ON3 applyOrderEditDelta", () => {
  it("qty up decreases stock, qty down increases it, movements are stock-signed order_edit", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    await svc.applyOrderPlaced("org-1", "order-1", { items: [{ productId: p.id, quantity: 5 }] });
    expect(prisma.product.rows[0].stockQuantity).toBe(15);

    const up = await svc.applyOrderEditDelta("org-1", "order-1", [{ productId: p.id, sku: "PN-1", deltaQty: 3 }]);
    expect(up).toEqual({ adjusted: 1, skipped: 0 });
    expect(prisma.product.rows[0].stockQuantity).toBe(12);
    const mv = prisma.stockMovement.rows.find((m: any) => m.reason === "order_edit");
    expect(mv).toMatchObject({ delta: -3, balanceAfter: 12, orderId: "order-1", productId: p.id });

    const down = await svc.applyOrderEditDelta("org-1", "order-1", [{ productId: p.id, sku: "PN-1", deltaQty: -2 }]);
    expect(down.adjusted).toBe(1);
    expect(prisma.product.rows[0].stockQuantity).toBe(14);
  });

  it("routes variant lines by (productId, sku); an untracked variant is skipped with no product fallback", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    const v = await prisma.productVariant.create({ data: { productId: p.id, name: "XL", sku: "PN-1-XL", stockQuantity: 7 } });
    const out = await svc.applyOrderEditDelta("org-1", "order-1", [{ productId: p.id, sku: "PN-1-XL", deltaQty: 2 }]);
    expect(out.adjusted).toBe(1);
    expect(prisma.productVariant.rows[0].stockQuantity).toBe(5);
    expect(prisma.product.rows[0].stockQuantity).toBe(20);
    expect(prisma.stockMovement.rows[0]).toMatchObject({ variantId: v.id, delta: -2 });

    prisma.productVariant.rows[0].stockQuantity = null;
    const skipped = await svc.applyOrderEditDelta("org-1", "order-1", [{ productId: p.id, sku: "PN-1-XL", deltaQty: 1 }]);
    expect(skipped).toEqual({ adjusted: 0, skipped: 1 });
    expect(prisma.product.rows[0].stockQuantity).toBe(20); // no fallback
  });

  it("skips preorder, product-less, zero-delta and untracked lines", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    const untracked = await seedProduct(prisma, { name: "Free", sku: "FR-1", stockQuantity: null });
    const out = await svc.applyOrderEditDelta("org-1", "order-1", [
      { productId: p.id, deltaQty: 2, isPreorder: true },
      { productId: null, deltaQty: 2 },
      { productId: p.id, deltaQty: 0 },
      { productId: untracked.id, deltaQty: 2 },
    ]);
    expect(out).toEqual({ adjusted: 0, skipped: 4 });
    expect(prisma.product.rows[0].stockQuantity).toBe(20);
    expect(prisma.stockMovement.rows).toHaveLength(0);
  });

  it("EC4 bundle components move signed by componentQty × deltaQty, without the placement idempotency skip", async () => {
    const { prisma, svc } = setup();
    const parent = await seedProduct(prisma, { name: "Set", sku: "SET-1", stockQuantity: 20 });
    const comp = await seedProduct(prisma, { name: "Comp", sku: "CP-1", stockQuantity: 30 });
    await prisma.bundleItem.create({
      data: { organizationId: "org-1", parentProductId: parent.id, componentProductId: comp.id, componentVariantId: null, quantity: 2 },
    });
    await svc.applyOrderPlaced("org-1", "order-1", { items: [{ productId: parent.id, quantity: 5 }] });
    expect(prisma.product.rows.find((r: any) => r.id === comp.id).stockQuantity).toBe(20); // 30 − 2×5

    await svc.applyOrderEditDelta("org-1", "order-1", [{ productId: parent.id, sku: "SET-1", deltaQty: 2 }]);
    expect(prisma.product.rows.find((r: any) => r.id === comp.id).stockQuantity).toBe(16); // − 2×2
    // A second identical edit applies AGAIN (no idempotency skip).
    await svc.applyOrderEditDelta("org-1", "order-1", [{ productId: parent.id, sku: "SET-1", deltaQty: 2 }]);
    expect(prisma.product.rows.find((r: any) => r.id === comp.id).stockQuantity).toBe(12);
    const edits = prisma.stockMovement.rows.filter((m: any) => m.reason === "order_edit" && m.productId === comp.id);
    expect(edits).toHaveLength(2);
    expect(edits[0].delta).toBe(-4);
  });
});

describe("ON3 restore netting (Phase B)", () => {
  async function placed(prisma: any, svc: any, qty: number) {
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    await svc.applyOrderPlaced("org-1", "order-1", { items: [{ productId: p.id, quantity: qty }] });
    return p;
  }

  it("place 5 → edit to 8 → cancel restores back to the start exactly", async () => {
    const { prisma, svc } = setup();
    const p = await placed(prisma, svc, 5);
    await svc.applyOrderEditDelta("org-1", "order-1", [{ productId: p.id, sku: "PN-1", deltaQty: 3 }]);
    expect(prisma.product.rows[0].stockQuantity).toBe(12);
    await svc.applyOrderRestore("org-1", "order-1", "order_cancelled");
    expect(prisma.product.rows[0].stockQuantity).toBe(20);
  });

  it("place 5 → edit to 2 → cancel restores back to the start exactly (Phase A over-restore is netted)", async () => {
    const { prisma, svc } = setup();
    const p = await placed(prisma, svc, 5);
    await svc.applyOrderEditDelta("org-1", "order-1", [{ productId: p.id, sku: "PN-1", deltaQty: -3 }]);
    expect(prisma.product.rows[0].stockQuantity).toBe(18);
    await svc.applyOrderRestore("org-1", "order-1", "order_cancelled");
    expect(prisma.product.rows[0].stockQuantity).toBe(20);
    const restores = prisma.stockMovement.rows.filter((m: any) => m.reason === "order_cancelled");
    // Phase A +5 and the Phase B −3 correction.
    expect(restores.map((m: any) => m.delta).sort()).toEqual([-3, 5]);
  });

  it("double restore is a no-op", async () => {
    const { prisma, svc } = setup();
    const p = await placed(prisma, svc, 5);
    await svc.applyOrderEditDelta("org-1", "order-1", [{ productId: p.id, sku: "PN-1", deltaQty: 3 }]);
    await svc.applyOrderRestore("org-1", "order-1", "order_cancelled");
    const second = await svc.applyOrderRestore("org-1", "order-1", "order_cancelled");
    expect(second.restored).toBe(0);
    expect(prisma.product.rows[0].stockQuantity).toBe(20);
  });
});

describe("ON3 recordStockTransfer", () => {
  it("writes ledger movements on both orders, balances unchanged; each side's cancel restores its own net", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    await svc.applyOrderPlaced("org-1", "order-A", { items: [{ productId: p.id, quantity: 5 }] });
    expect(prisma.product.rows[0].stockQuantity).toBe(15);

    const out = await svc.recordStockTransfer("org-1", "order-A", "order-B", [
      { productId: p.id, sku: "PN-1", quantity: 2 },
    ]);
    expect(out).toEqual({ recorded: 1, skipped: 0 });
    expect(prisma.product.rows[0].stockQuantity).toBe(15); // unchanged
    const from = prisma.stockMovement.rows.find((m: any) => m.orderId === "order-A" && m.reason === "order_edit");
    expect(from).toMatchObject({ delta: 2, balanceAfter: 15 });
    const to = prisma.stockMovement.rows.find((m: any) => m.orderId === "order-B");
    expect(to).toMatchObject({ delta: -2, balanceAfter: 15, reason: "order_placed" });

    // Child (to-order) cancel restores exactly the moved qty.
    await svc.applyOrderRestore("org-1", "order-B", "order_cancelled");
    expect(prisma.product.rows[0].stockQuantity).toBe(17);
    // Original cancel restores exactly the remainder (5 − 2).
    await svc.applyOrderRestore("org-1", "order-A", "order_cancelled");
    expect(prisma.product.rows[0].stockQuantity).toBe(20);
  });

  it("skips preorder / product-less / untracked lines entirely", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: null });
    const out = await svc.recordStockTransfer("org-1", "order-A", "order-B", [
      { productId: p.id, sku: "PN-1", quantity: 2 },
      { productId: null, quantity: 1 },
      { productId: "p-x", quantity: 1, isPreorder: true },
    ]);
    expect(out).toEqual({ recorded: 0, skipped: 3 });
    expect(prisma.stockMovement.rows).toHaveLength(0);
  });
});
