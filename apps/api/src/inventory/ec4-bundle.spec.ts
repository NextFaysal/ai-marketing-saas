import { InventoryService } from "./inventory.service";

/**
 * EC4 — bundle stock decrement + stock-push notification specs.
 *
 * Same in-memory fake-Prisma style as inventory.spec.ts (equality +
 * null + `in` + `gte` matching), extended with a bundleItem table.
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
    product: makeTable("product"), productVariant: makeTable("variant"),
    order: makeTable("order"), orderItem: makeTable("item"),
    customer: makeTable("customer"), stockMovement: makeTable("movement"),
    membership: makeTable("membership"), agentNotification: makeTable("notif"),
    auditLog: makeTable("audit"), bundleItem: makeTable("bundle"),
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

function setup(withPush = false) {
  const prisma: any = fakePrisma();
  const audit = fakeAudit(prisma);
  const catalogPush: any = withPush
    ? { enqueueInventoryPush: jest.fn(async () => ({ queued: true })) }
    : undefined;
  const svc = withPush
    ? new InventoryService(prisma as any, audit, catalogPush)
    : new InventoryService(prisma as any, audit); // 2-arg construction must keep working
  return { prisma, audit, svc, catalogPush };
}

async function seedProduct(prisma: any, over: Record<string, unknown> = {}) {
  return prisma.product.create({
    data: {
      organizationId: "org-1", name: "Item", sku: "SKU", priceMinor: 100000n,
      stockQuantity: 20, lowStockThreshold: null, ...over,
    },
  });
}

describe("EC4 bundle decrement", () => {
  it("decrements a component product by bundle qty × line qty, with a bundle_component movement", async () => {
    const { prisma, svc } = setup();
    const parent = await seedProduct(prisma, { name: "Combo", stockQuantity: 10 });
    const comp = await seedProduct(prisma, { name: "Shirt", stockQuantity: 30 });
    await prisma.bundleItem.create({
      data: { organizationId: "org-1", parentProductId: parent.id, componentProductId: comp.id, componentVariantId: null, quantity: 2 },
    });

    const out = await svc.applyOrderPlaced("org-1", "order-1", {
      items: [{ productId: parent.id, quantity: 3 }], status: "processing",
    });

    // Sold-line counts unchanged by bundle work.
    expect(out).toEqual({ decremented: 1, skipped: 0 });
    expect(prisma.product.rows.find((p: any) => p.id === parent.id).stockQuantity).toBe(7);
    expect(prisma.product.rows.find((p: any) => p.id === comp.id).stockQuantity).toBe(24); // 30 − 2×3
    const bundleMovements = prisma.stockMovement.rows.filter((m: any) => m.reason === "bundle_component");
    expect(bundleMovements).toHaveLength(1);
    expect(bundleMovements[0]).toMatchObject({
      organizationId: "org-1", productId: comp.id, variantId: null,
      delta: -6, balanceAfter: 24, orderId: "order-1",
    });
  });

  it("decrements a component VARIANT when componentVariantId is set; component product untouched", async () => {
    const { prisma, svc } = setup();
    const parent = await seedProduct(prisma, { name: "Combo", stockQuantity: 10 });
    const comp = await seedProduct(prisma, { name: "Shirt", stockQuantity: 30 });
    const cv = await prisma.productVariant.create({ data: { productId: comp.id, name: "XL", sku: "SH-XL", stockQuantity: 12 } });
    await prisma.bundleItem.create({
      data: { organizationId: "org-1", parentProductId: parent.id, componentProductId: comp.id, componentVariantId: cv.id, quantity: 1 },
    });

    await svc.applyOrderPlaced("org-1", "order-1", { items: [{ productId: parent.id, quantity: 4 }] });

    expect(prisma.productVariant.rows[0].stockQuantity).toBe(8);
    expect(prisma.product.rows.find((p: any) => p.id === comp.id).stockQuantity).toBe(30);
    expect(prisma.stockMovement.rows.find((m: any) => m.reason === "bundle_component"))
      .toMatchObject({ productId: comp.id, variantId: cv.id, delta: -4, balanceAfter: 8 });
  });

  it("expands the bundle even when a VARIANT of the parent sold (composition is per parent product)", async () => {
    const { prisma, svc } = setup();
    const parent = await seedProduct(prisma, { name: "Combo", stockQuantity: 10 });
    const pv = await prisma.productVariant.create({ data: { productId: parent.id, name: "Gift", sku: "CB-G", stockQuantity: 5 } });
    const comp = await seedProduct(prisma, { name: "Mug", stockQuantity: 9 });
    await prisma.bundleItem.create({
      data: { organizationId: "org-1", parentProductId: parent.id, componentProductId: comp.id, componentVariantId: null, quantity: 1 },
    });

    await svc.applyOrderPlaced("org-1", "order-1", { items: [{ productId: parent.id, variantId: pv.id, quantity: 2 }] });

    expect(prisma.productVariant.rows[0].stockQuantity).toBe(3);
    expect(prisma.product.rows.find((p: any) => p.id === comp.id).stockQuantity).toBe(7);
  });

  it("skips an untracked component (product-level and variant-level, no fallback)", async () => {
    const { prisma, svc } = setup();
    const parent = await seedProduct(prisma, { name: "Combo", stockQuantity: 10 });
    const compA = await seedProduct(prisma, { name: "Untracked", stockQuantity: null });
    const compB = await seedProduct(prisma, { name: "VarComp", stockQuantity: 30 });
    const cvB = await prisma.productVariant.create({ data: { productId: compB.id, name: "L", sku: "VC-L", stockQuantity: null } });
    await prisma.bundleItem.create({
      data: { organizationId: "org-1", parentProductId: parent.id, componentProductId: compA.id, componentVariantId: null, quantity: 1 },
    });
    await prisma.bundleItem.create({
      data: { organizationId: "org-1", parentProductId: parent.id, componentProductId: compB.id, componentVariantId: cvB.id, quantity: 1 },
    });

    const out = await svc.applyOrderPlaced("org-1", "order-1", { items: [{ productId: parent.id, quantity: 2 }] });

    expect(out).toEqual({ decremented: 1, skipped: 0 });
    expect(prisma.stockMovement.rows.filter((m: any) => m.reason === "bundle_component")).toHaveLength(0);
    expect(prisma.product.rows.find((p: any) => p.id === compB.id).stockQuantity).toBe(30); // no fallback
  });

  it("is idempotent: placing the same order twice never double-decrements components", async () => {
    const { prisma, svc } = setup();
    const parent = await seedProduct(prisma, { name: "Combo", stockQuantity: 10 });
    const comp = await seedProduct(prisma, { name: "Shirt", stockQuantity: 30 });
    await prisma.bundleItem.create({
      data: { organizationId: "org-1", parentProductId: parent.id, componentProductId: comp.id, componentVariantId: null, quantity: 2 },
    });
    const items = [{ productId: parent.id, quantity: 3 }];
    await svc.applyOrderPlaced("org-1", "order-1", { items });
    await svc.applyOrderPlaced("org-1", "order-1", { items });
    expect(prisma.product.rows.find((p: any) => p.id === comp.id).stockQuantity).toBe(24);
    expect(prisma.stockMovement.rows.filter((m: any) => m.reason === "bundle_component")).toHaveLength(1);
  });

  it("restore (order_cancelled) restores component stock exactly once", async () => {
    const { prisma, svc } = setup();
    const parent = await seedProduct(prisma, { name: "Combo", stockQuantity: 10 });
    const comp = await seedProduct(prisma, { name: "Shirt", stockQuantity: 30 });
    await prisma.bundleItem.create({
      data: { organizationId: "org-1", parentProductId: parent.id, componentProductId: comp.id, componentVariantId: null, quantity: 2 },
    });
    await svc.applyOrderPlaced("org-1", "order-1", { items: [{ productId: parent.id, quantity: 3 }] });
    expect(prisma.product.rows.find((p: any) => p.id === comp.id).stockQuantity).toBe(24);

    const out = await svc.applyOrderRestore("org-1", "order-1", "order_cancelled");
    expect(out.restored).toBe(2); // sold line + bundle component
    expect(prisma.product.rows.find((p: any) => p.id === parent.id).stockQuantity).toBe(10);
    expect(prisma.product.rows.find((p: any) => p.id === comp.id).stockQuantity).toBe(30);
    const compRestore = prisma.stockMovement.rows.find(
      (m: any) => m.reason === "order_cancelled" && m.productId === comp.id,
    );
    expect(compRestore).toMatchObject({ delta: 6, balanceAfter: 30 });

    const again = await svc.applyOrderRestore("org-1", "order-1", "order_returned");
    expect(again.restored).toBe(0);
    expect(prisma.product.rows.find((p: any) => p.id === comp.id).stockQuantity).toBe(30);
  });

  it("ONE LEVEL ONLY: a component that is itself a bundle parent does not cascade", async () => {
    const { prisma, svc } = setup();
    const parent = await seedProduct(prisma, { name: "Combo", stockQuantity: 10 });
    const middle = await seedProduct(prisma, { name: "Middle", stockQuantity: 30 });
    const leaf = await seedProduct(prisma, { name: "Leaf", stockQuantity: 50 });
    await prisma.bundleItem.create({
      data: { organizationId: "org-1", parentProductId: parent.id, componentProductId: middle.id, componentVariantId: null, quantity: 1 },
    });
    await prisma.bundleItem.create({
      data: { organizationId: "org-1", parentProductId: middle.id, componentProductId: leaf.id, componentVariantId: null, quantity: 5 },
    });

    await svc.applyOrderPlaced("org-1", "order-1", { items: [{ productId: parent.id, quantity: 2 }] });

    expect(prisma.product.rows.find((p: any) => p.id === middle.id).stockQuantity).toBe(28);
    expect(prisma.product.rows.find((p: any) => p.id === leaf.id).stockQuantity).toBe(50); // untouched
    expect(prisma.stockMovement.rows.filter((m: any) => m.productId === leaf.id)).toHaveLength(0);
  });

  it("a dead-on-arrival order does no bundle work", async () => {
    const { prisma, svc } = setup();
    const parent = await seedProduct(prisma, { name: "Combo", stockQuantity: 10 });
    const comp = await seedProduct(prisma, { name: "Shirt", stockQuantity: 30 });
    await prisma.bundleItem.create({
      data: { organizationId: "org-1", parentProductId: parent.id, componentProductId: comp.id, componentVariantId: null, quantity: 2 },
    });
    const out = await svc.applyOrderPlaced("org-1", "order-1", {
      items: [{ productId: parent.id, quantity: 3 }], status: "cancelled",
    });
    expect(out).toEqual({ decremented: 0, skipped: 0 });
    expect(prisma.product.rows.find((p: any) => p.id === comp.id).stockQuantity).toBe(30);
    expect(prisma.stockMovement.rows).toHaveLength(0);
  });

  it("works when the bundleItem table is absent from the prisma fake (failure-isolated)", async () => {
    const { prisma, svc } = setup();
    delete (prisma as any).bundleItem;
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    const out = await svc.applyOrderPlaced("org-1", "order-1", { items: [{ productId: p.id, quantity: 3 }] });
    expect(out).toEqual({ decremented: 1, skipped: 0 });
    expect(prisma.product.rows[0].stockQuantity).toBe(17);
  });
});

describe("EC4 stock-push notification", () => {
  it("notifies absolute balances for sold line, bundle component, adjust and restore — but NOT recordSyncedStock", async () => {
    const { prisma, svc, catalogPush } = setup(true);
    const parent = await seedProduct(prisma, { name: "Combo", stockQuantity: 10 });
    const comp = await seedProduct(prisma, { name: "Shirt", stockQuantity: 30 });
    await prisma.bundleItem.create({
      data: { organizationId: "org-1", parentProductId: parent.id, componentProductId: comp.id, componentVariantId: null, quantity: 2 },
    });

    await svc.applyOrderPlaced("org-1", "order-1", { items: [{ productId: parent.id, quantity: 3 }] });
    expect(catalogPush.enqueueInventoryPush).toHaveBeenCalledWith("org-1", parent.id, null, 7);
    expect(catalogPush.enqueueInventoryPush).toHaveBeenCalledWith("org-1", comp.id, null, 24);

    catalogPush.enqueueInventoryPush.mockClear();
    await svc.adjust("org-1", "owner-1", comp.id, { delta: 6 }); // 24 -> 30
    expect(catalogPush.enqueueInventoryPush).toHaveBeenCalledTimes(1);
    expect(catalogPush.enqueueInventoryPush).toHaveBeenCalledWith("org-1", comp.id, null, 30);

    catalogPush.enqueueInventoryPush.mockClear();
    await svc.applyOrderRestore("org-1", "order-1", "order_cancelled");
    expect(catalogPush.enqueueInventoryPush).toHaveBeenCalledWith("org-1", parent.id, null, 10);
    expect(catalogPush.enqueueInventoryPush).toHaveBeenCalledWith("org-1", comp.id, null, 36); // 30 + 6 restored

    catalogPush.enqueueInventoryPush.mockClear();
    await svc.recordSyncedStock("org-1", parent.id, null, 10, 4);
    expect(catalogPush.enqueueInventoryPush).not.toHaveBeenCalled();
  });

  it("a throwing catalogPush never breaks the stock write", async () => {
    const { prisma, svc, catalogPush } = setup(true);
    catalogPush.enqueueInventoryPush.mockRejectedValue(new Error("queue down"));
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    const out = await svc.applyOrderPlaced("org-1", "order-1", { items: [{ productId: p.id, quantity: 3 }] });
    expect(out).toEqual({ decremented: 1, skipped: 0 });
    expect(prisma.product.rows[0].stockQuantity).toBe(17);
  });
});
