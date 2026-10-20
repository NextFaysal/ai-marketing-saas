import { InventoryService } from "./inventory.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { normalizeWooOrder, normalizeWooProduct } from "../integrations/woocommerce/normalize";

/**
 * Sales & Data S1 — Inventory Movement specs.
 *
 * In-memory fake Prisma in the makeTable style of the CRM specs:
 * equality + null + `in` + `gte` where matching, orderBy
 * createdAt, skip/take, count.
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
    auditLog: makeTable("audit"),
  };
}

/** Audit fake that actually persists rows, so the low-stock
 * Dhaka-day dedupe marker (an AuditLog read) behaves for real. */
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

function seedMemberships(prisma: any) {
  prisma.membership.rows.push(
    { id: "m1", organizationId: "org-1", userId: "owner-1", role: "OWNER", status: "ACTIVE" },
    { id: "m2", organizationId: "org-1", userId: "admin-1", role: "ADMIN", status: "ACTIVE" },
    { id: "m3", organizationId: "org-1", userId: "agent-1", role: "SUPPORT_AGENT", status: "ACTIVE" },
    { id: "m4", organizationId: "org-1", userId: "gone-1", role: "ADMIN", status: "SUSPENDED" },
  );
}

describe("InventoryService.applyOrderPlaced", () => {
  it("decrements a tracked product and writes the movement", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    const out = await svc.applyOrderPlaced("org-1", "order-1", {
      items: [{ productId: p.id, quantity: 3 }], status: "processing",
    });
    expect(out).toEqual({ decremented: 1, skipped: 0 });
    expect(prisma.product.rows[0].stockQuantity).toBe(17);
    expect(prisma.stockMovement.rows).toHaveLength(1);
    expect(prisma.stockMovement.rows[0]).toMatchObject({
      organizationId: "org-1", productId: p.id, variantId: null,
      delta: -3, balanceAfter: 17, reason: "order_placed", orderId: "order-1",
    });
  });

  it("skips an untracked product (stockQuantity null) entirely", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: null });
    const out = await svc.applyOrderPlaced("org-1", "order-1", { items: [{ productId: p.id, quantity: 3 }] });
    expect(out.decremented).toBe(0);
    expect(prisma.product.rows[0].stockQuantity).toBeNull();
    expect(prisma.stockMovement.rows).toHaveLength(0);
  });

  it("skips lines with no product link", async () => {
    const { prisma, svc } = setup();
    const out = await svc.applyOrderPlaced("org-1", "order-1", { items: [{ productId: null, quantity: 2 }] });
    expect(out.decremented).toBe(0);
    expect(prisma.stockMovement.rows).toHaveLength(0);
  });

  it("routes to the variant row when a variantId is given; product untouched", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    const v = await prisma.productVariant.create({ data: { productId: p.id, name: "XL", sku: "PN-1-XL", stockQuantity: 7 } });
    await svc.applyOrderPlaced("org-1", "order-1", { items: [{ productId: p.id, variantId: v.id, quantity: 2 }] });
    expect(prisma.productVariant.rows[0].stockQuantity).toBe(5);
    expect(prisma.product.rows[0].stockQuantity).toBe(20);
    expect(prisma.stockMovement.rows[0]).toMatchObject({ variantId: v.id, delta: -2, balanceAfter: 5 });
  });

  it("an untracked variant is skipped WITHOUT falling back to the product", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    const v = await prisma.productVariant.create({ data: { productId: p.id, name: "XL", sku: "PN-1-XL", stockQuantity: null } });
    const out = await svc.applyOrderPlaced("org-1", "order-1", { items: [{ productId: p.id, variantId: v.id, quantity: 2 }] });
    expect(out.decremented).toBe(0);
    expect(prisma.product.rows[0].stockQuantity).toBe(20);
    expect(prisma.stockMovement.rows).toHaveLength(0);
  });

  it("resolves the variant from the order items by the SKU rule (DB-load path)", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    const v = await prisma.productVariant.create({ data: { productId: p.id, name: "XL", sku: "PN-1-XL", stockQuantity: 9 } });
    const order = await prisma.order.create({ data: { organizationId: "org-1", externalId: "900", source: "woocommerce", status: "processing" } });
    await prisma.orderItem.create({
      data: { orderId: order.id, productId: p.id, externalVariationId: "77", sku: "PN-1-XL", name: "Panjabi XL", quantity: 4 },
    });
    await svc.applyOrderPlaced("org-1", order.id, { status: "processing" });
    expect(prisma.productVariant.rows[0].stockQuantity).toBe(5);
    expect(prisma.product.rows[0].stockQuantity).toBe(20);
    expect(prisma.stockMovement.rows[0].variantId).toBe(v.id);
  });

  it("is idempotent: re-running placement never double-decrements", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    const items = [{ productId: p.id, quantity: 3 }];
    await svc.applyOrderPlaced("org-1", "order-1", { items });
    const second = await svc.applyOrderPlaced("org-1", "order-1", { items });
    expect(second.decremented).toBe(0);
    expect(prisma.product.rows[0].stockQuantity).toBe(17);
    expect(prisma.stockMovement.rows).toHaveLength(1);
  });

  it("an order created directly in a dead status takes no stock", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    for (const status of ["cancelled", "failed", "refunded", "returned"]) {
      const out = await svc.applyOrderPlaced("org-1", `order-${status}`, { items: [{ productId: p.id, quantity: 3 }], status });
      expect(out.decremented).toBe(0);
    }
    expect(prisma.product.rows[0].stockQuantity).toBe(20);
    expect(prisma.stockMovement.rows).toHaveLength(0);
  });

  it("records a negative balance truthfully (no clamping)", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 2 });
    await svc.applyOrderPlaced("org-1", "order-1", { items: [{ productId: p.id, quantity: 5 }] });
    expect(prisma.product.rows[0].stockQuantity).toBe(-3);
    expect(prisma.stockMovement.rows[0]).toMatchObject({ delta: -5, balanceAfter: -3 });
  });
});

describe("InventoryService.applyOrderRestore", () => {
  async function placedOrder() {
    const ctx = setup();
    const p = await seedProduct(ctx.prisma, { stockQuantity: 20 });
    const order = await ctx.prisma.order.create({ data: { organizationId: "org-1", externalId: "900", source: "woocommerce", status: "processing" } });
    await ctx.prisma.orderItem.create({ data: { orderId: order.id, productId: p.id, name: "Panjabi", sku: "PN-1", quantity: 3 } });
    await ctx.svc.applyOrderPlaced("org-1", order.id, { status: "processing" });
    expect(ctx.prisma.product.rows[0].stockQuantity).toBe(17);
    return { ...ctx, p, order };
  }

  it("restores the exact PLACED quantity even after the order items were edited", async () => {
    const { prisma, svc, order } = await placedOrder();
    // Store upserts fully replace items — by cancel time they may say anything.
    prisma.orderItem.rows[0].quantity = 99;
    const out = await svc.applyOrderRestore("org-1", order.id, "order_cancelled");
    expect(out.restored).toBe(1);
    expect(prisma.product.rows[0].stockQuantity).toBe(20); // +3, not +99
    const restore = prisma.stockMovement.rows.find((m: any) => m.reason === "order_cancelled");
    expect(restore).toMatchObject({ delta: 3, balanceAfter: 20, orderId: order.id });
  });

  it("is idempotent across BOTH restore reasons (cancel then return = one restore)", async () => {
    const { prisma, svc, order } = await placedOrder();
    await svc.applyOrderRestore("org-1", order.id, "order_cancelled");
    const second = await svc.applyOrderRestore("org-1", order.id, "order_returned");
    const third = await svc.applyOrderRestore("org-1", order.id, "order_cancelled");
    expect(second.restored).toBe(0);
    expect(third.restored).toBe(0);
    expect(prisma.product.rows[0].stockQuantity).toBe(20);
    expect(prisma.stockMovement.rows.filter((m: any) => m.reason !== "order_placed")).toHaveLength(1);
  });

  it("restores variant stock onto the variant row", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    const v = await prisma.productVariant.create({ data: { productId: p.id, name: "XL", sku: "PN-1-XL", stockQuantity: 7 } });
    await svc.applyOrderPlaced("org-1", "order-1", { items: [{ productId: p.id, variantId: v.id, quantity: 2 }] });
    await svc.applyOrderRestore("org-1", "order-1", "order_returned");
    expect(prisma.productVariant.rows[0].stockQuantity).toBe(7);
    expect(prisma.product.rows[0].stockQuantity).toBe(20);
  });

  it("skips lines whose stock became untracked after the sale", async () => {
    const { prisma, svc, order } = await placedOrder();
    prisma.product.rows[0].stockQuantity = null; // tracking switched off meanwhile
    const out = await svc.applyOrderRestore("org-1", order.id, "order_cancelled");
    expect(out.restored).toBe(0);
    expect(out.skipped).toBe(1);
    expect(prisma.stockMovement.rows.filter((m: any) => m.reason === "order_cancelled")).toHaveLength(0);
  });

  it("an order with no placed movements restores nothing", async () => {
    const { prisma, svc } = setup();
    await seedProduct(prisma);
    const out = await svc.applyOrderRestore("org-1", "order-none", "order_cancelled");
    expect(out.restored).toBe(0);
    expect(prisma.stockMovement.rows).toHaveLength(0);
  });
});

describe("InventoryService low-stock alerts", () => {
  it("fires on the crossing only, notifies ACTIVE OWNER/ADMIN, and dedupes per Dhaka day", async () => {
    const { prisma, svc } = setup();
    seedMemberships(prisma);
    const p = await seedProduct(prisma, { stockQuantity: 10 }); // default threshold 5
    await svc.applyOrderPlaced("org-1", "order-1", { items: [{ productId: p.id, quantity: 5 }] }); // 10 -> 5: crossing
    expect(prisma.agentNotification.rows).toHaveLength(2); // owner + admin, not agent / suspended
    expect(prisma.agentNotification.rows[0]).toMatchObject({ type: "low_stock", title: "স্টক কম: Panjabi" });
    expect(prisma.auditLog.rows.filter((a: any) => a.action === "inventory.low_stock_alert")).toHaveLength(1);

    // Back above the threshold, then cross again the same day: marker dedupes.
    await svc.adjust("org-1", "owner-1", p.id, { delta: 10 }); // -> 15
    await svc.applyOrderPlaced("org-1", "order-2", { items: [{ productId: p.id, quantity: 11 }] }); // -> 4: crossing again
    expect(prisma.product.rows[0].stockQuantity).toBe(4);
    expect(prisma.agentNotification.rows).toHaveLength(2); // unchanged
    expect(prisma.auditLog.rows.filter((a: any) => a.action === "inventory.low_stock_alert")).toHaveLength(1);
  });

  it("does not fire when the stock was already below the threshold (no crossing)", async () => {
    const { prisma, svc } = setup();
    seedMemberships(prisma);
    const p = await seedProduct(prisma, { stockQuantity: 4 });
    await svc.applyOrderPlaced("org-1", "order-1", { items: [{ productId: p.id, quantity: 1 }] }); // 4 -> 3
    expect(prisma.agentNotification.rows).toHaveLength(0);
  });

  it("honours a per-product lowStockThreshold", async () => {
    const { prisma, svc } = setup();
    seedMemberships(prisma);
    const p = await seedProduct(prisma, { stockQuantity: 3, lowStockThreshold: 2 });
    await svc.applyOrderPlaced("org-1", "order-1", { items: [{ productId: p.id, quantity: 1 }] }); // 3 -> 2: crossing at 2
    expect(prisma.agentNotification.rows).toHaveLength(2);
    expect(svc.resolveThreshold({ lowStockThreshold: null })).toBe(5);
    expect(svc.resolveThreshold({ lowStockThreshold: 2 })).toBe(2);
  });
});

describe("InventoryService.adjust", () => {
  it("applies a delta, writes the movement and the audit entry", async () => {
    const { prisma, svc, audit } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    const out = await svc.adjust("org-1", "owner-1", p.id, { delta: -4, note: "ভাঙা পণ্য বাদ" });
    expect(out.stockQuantity).toBe(16);
    expect(out.movement).toMatchObject({ delta: -4, balanceAfter: 16, reason: "manual_adjustment", actorUserId: "owner-1", note: "ভাঙা পণ্য বাদ" });
    expect(prisma.product.rows[0].stockQuantity).toBe(16);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: "inventory.adjusted", entityId: p.id }));
  });

  it("setTo sets an exact balance (delta derived) and may target a variant", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    const v = await prisma.productVariant.create({ data: { productId: p.id, name: "XL", sku: "PN-1-XL", stockQuantity: 7 } });
    const out = await svc.adjust("org-1", "owner-1", p.id, { variantId: v.id, setTo: 12 });
    expect(out).toMatchObject({ stockQuantity: 12, variantId: v.id });
    expect(out.movement.delta).toBe(5);
    expect(prisma.productVariant.rows[0].stockQuantity).toBe(12);
    expect(prisma.product.rows[0].stockQuantity).toBe(20);
  });

  it("rejects an untracked product with the Bengali guidance", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: null });
    await expect(svc.adjust("org-1", "owner-1", p.id, { delta: 1 }))
      .rejects.toThrow(/স্টক ট্র্যাক করা হচ্ছে না/);
  });

  it("rejects both delta+setTo and neither", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma);
    await expect(svc.adjust("org-1", "owner-1", p.id, { delta: 1, setTo: 5 })).rejects.toThrow(/ঠিক একটি/);
    await expect(svc.adjust("org-1", "owner-1", p.id, {})).rejects.toThrow(/ঠিক একটি/);
    await expect(svc.adjust("org-1", "owner-1", p.id, { setTo: -1 })).rejects.toThrow(/০ বা তার বেশি/);
  });

  it("404s for another organization's product (tenant isolation)", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { organizationId: "org-2" });
    await expect(svc.adjust("org-1", "owner-1", p.id, { delta: 1 })).rejects.toMatchObject({ code: "inventory.productNotFoundInThisOrganization" });
    await expect(svc.listMovements("org-1", p.id)).rejects.toMatchObject({ code: "inventory.productNotFoundInThisOrganization" });
  });
});

describe("InventoryService.recordSyncedStock", () => {
  it("a real difference writes a sync_correction without touching stock", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    await svc.recordSyncedStock("org-1", p.id, null, 20, 14);
    expect(prisma.stockMovement.rows).toHaveLength(1);
    expect(prisma.stockMovement.rows[0]).toMatchObject({ delta: -6, balanceAfter: 14, reason: "sync_correction", actorUserId: null, note: "store sync" });
    expect(prisma.product.rows[0].stockQuantity).toBe(20); // caller writes the synced value
  });

  it("equal values and null transitions (baseline / untracking) write nothing", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma);
    await svc.recordSyncedStock("org-1", p.id, null, 20, 20);
    await svc.recordSyncedStock("org-1", p.id, null, null, 20);
    await svc.recordSyncedStock("org-1", p.id, null, 20, null);
    expect(prisma.stockMovement.rows).toHaveLength(0);
  });
});

describe("InventoryService.listMovements", () => {
  it("paginates newest-first and enriches variant names", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    const v = await prisma.productVariant.create({ data: { productId: p.id, name: "XL", sku: "PN-1-XL", stockQuantity: 7 } });
    await svc.applyOrderPlaced("org-1", "order-1", { items: [{ productId: p.id, quantity: 1 }] });
    await svc.applyOrderPlaced("org-1", "order-2", { items: [{ productId: p.id, variantId: v.id, quantity: 1 }] });
    const page = await svc.listMovements("org-1", p.id, { page: 1, pageSize: 1 });
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].variantName).toBe("XL"); // newest first
    const page2 = await svc.listMovements("org-1", p.id, { page: 2, pageSize: 1 });
    expect(page2.items[0].variantName).toBeNull();
  });
});

describe("S1 hooks: IntegrationsService + InventoryService over one fake", () => {
  function hookSetup() {
    const prisma: any = fakePrisma();
    const audit = fakeAudit(prisma);
    const inventory = new InventoryService(prisma as any, audit);
    const integrations = new IntegrationsService(prisma as any, audit, undefined, inventory);
    return { prisma, audit, inventory, integrations };
  }
  const rawProduct = { id: 42, name: "Shirt", status: "publish", price: "850", sku: "TS-1", manage_stock: true, stock_quantity: 20 };
  const rawOrder = {
    id: 900, number: "900", status: "processing", payment_method: "cod", currency: "BDT",
    total: "1700", shipping_total: "0", discount_total: "0", total_tax: "0",
    customer_id: 7, billing: { first_name: "Rahim", email: "r@example.com", phone: "017" },
    line_items: [{ product_id: 42, name: "Shirt", sku: "TS-1", quantity: 2, price: "850", subtotal: "1700", total: "1700" }],
    refunds: [],
  };

  it("order create decrements, cancel restores exactly once, product sync ledgers a correction", async () => {
    const { prisma, integrations } = hookSetup();
    await integrations.upsertProduct("org-1", normalizeWooProduct(rawProduct));
    expect(prisma.product.rows[0].stockQuantity).toBe(20);

    await integrations.upsertOrder("org-1", null, normalizeWooOrder(rawOrder));
    expect(prisma.product.rows[0].stockQuantity).toBe(18);
    expect(prisma.stockMovement.rows.filter((m: any) => m.reason === "order_placed")).toHaveLength(1);

    await integrations.upsertOrder("org-1", null, normalizeWooOrder({ ...rawOrder, status: "cancelled" }));
    expect(prisma.product.rows[0].stockQuantity).toBe(20);
    expect(prisma.stockMovement.rows.filter((m: any) => m.reason === "order_cancelled")).toHaveLength(1);

    // Re-upserting the same cancelled order must not restore again.
    await integrations.upsertOrder("org-1", null, normalizeWooOrder({ ...rawOrder, status: "cancelled" }));
    expect(prisma.product.rows[0].stockQuantity).toBe(20);
    expect(prisma.stockMovement.rows.filter((m: any) => m.reason === "order_cancelled")).toHaveLength(1);

    // A later product sync to a different stock ledgers the jump.
    await integrations.upsertProduct("org-1", normalizeWooProduct({ ...rawProduct, stock_quantity: 15 }));
    expect(prisma.product.rows[0].stockQuantity).toBe(15);
    const corrections = prisma.stockMovement.rows.filter((m: any) => m.reason === "sync_correction");
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toMatchObject({ delta: -5, balanceAfter: 15 });
  });

  it("an order created already-cancelled takes no stock", async () => {
    const { prisma, integrations } = hookSetup();
    await integrations.upsertProduct("org-1", normalizeWooProduct(rawProduct));
    await integrations.upsertOrder("org-1", null, normalizeWooOrder({ ...rawOrder, status: "cancelled" }));
    expect(prisma.product.rows[0].stockQuantity).toBe(20);
    expect(prisma.stockMovement.rows).toHaveLength(0);
  });
});
