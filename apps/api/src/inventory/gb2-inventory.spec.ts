import { InventoryService } from "./inventory.service";
import { StockAdjustmentDto } from "./inventory.dto";
import { validate } from "class-validator";

/**
 * GB2 (GC7) — inventory completion specs: settings reads,
 * availability (backorder + reservations), the cart reservation
 * lifecycle, the out-of-stock staff alert, and the merchant
 * adjustment-reason vocabulary. In-memory fake Prisma in the
 * inventory.spec makeTable style (matcher extended with gt/lte
 * for reservation expiry).
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v && !v.in.includes(row[k])) return false;
      if ("notIn" in v && v.notIn.includes(row[k])) return false;
      if ("gte" in v && !(row[k] != null && new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
      if ("gt" in v && !(row[k] != null && new Date(row[k]).getTime() > new Date(v.gt).getTime())) return false;
      if ("lte" in v && !(row[k] != null && new Date(row[k]).getTime() <= new Date(v.lte).getTime())) return false;
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
    findUnique: async ({ where }: any) =>
      rows.find((r) => r.id === where.id || r.organizationId === where.organizationId) ?? null,
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
      const row = { id: `${name}-${++seq}`, createdAt: new Date(Date.now() + seq * 10), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error(`row not found in ${name}: ${where.id}`);
      Object.assign(row, data);
      return row;
    },
    upsert: async ({ where, create, update }: any) => {
      const existing = rows.find((r) => r.organizationId === where.organizationId);
      if (existing) { Object.assign(existing, update); return existing; }
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      rows.push(row);
      return row;
    },
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => r.id === where.id);
      if (idx < 0) throw new Error(`row not found in ${name}`);
      return rows.splice(idx, 1)[0];
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
    stockReservation: makeTable("reservation"), inventorySetting: makeTable("invsetting"),
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
  const svc = new InventoryService(prisma as any, audit);
  return { prisma, audit, svc };
}

async function seedProduct(prisma: any, over: Record<string, unknown> = {}) {
  return prisma.product.create({
    data: {
      organizationId: "org-1", name: "Panjabi", sku: "PN-1", priceMinor: 100000n,
      stockQuantity: 10, lowStockThreshold: null, preorderEnabled: false, ...over,
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

describe("GB2 settings reads", () => {
  it("defaults when no settings row exists (enforcement ON, reservations OFF)", async () => {
    const { svc } = setup();
    await expect(svc.getInventorySettings("org-1")).resolves.toEqual({
      leadTimeDays: 14, allowBackorder: false, reserveMinutes: 0,
    });
  });

  it("reads the row's GB2 fields", async () => {
    const { prisma, svc } = setup();
    prisma.inventorySetting.rows.push({ id: "s1", organizationId: "org-1", leadTimeDays: 3, allowBackorder: true, reserveMinutes: 45 });
    await expect(svc.getInventorySettings("org-1")).resolves.toEqual({
      leadTimeDays: 3, allowBackorder: true, reserveMinutes: 45,
    });
  });
});

describe("GB2 checkAvailability", () => {
  it("untracked + preorder lines are always fine", async () => {
    const { svc } = setup();
    await expect(svc.checkAvailability("org-1", { id: "p1", stockQuantity: null }, null, 99)).resolves.toEqual({ ok: true });
    await expect(svc.checkAvailability("org-1", { id: "p1", stockQuantity: 0, preorderEnabled: true }, null, 99)).resolves.toEqual({ ok: true });
  });

  it("refuses beyond on-hand with the available count; variant stock wins", async () => {
    const { svc } = setup();
    await expect(svc.checkAvailability("org-1", { id: "p1", stockQuantity: 5 }, null, 5)).resolves.toEqual({ ok: true });
    await expect(svc.checkAvailability("org-1", { id: "p1", stockQuantity: 5 }, null, 6)).resolves.toEqual({ ok: false, available: 5 });
    await expect(
      svc.checkAvailability("org-1", { id: "p1", stockQuantity: 50 }, { id: "v1", stockQuantity: 2 }, 3),
    ).resolves.toEqual({ ok: false, available: 2 });
  });

  it("allowBackorder ON permits oversell", async () => {
    const { prisma, svc } = setup();
    prisma.inventorySetting.rows.push({ id: "s1", organizationId: "org-1", leadTimeDays: 7, allowBackorder: true, reserveMinutes: 0 });
    await expect(svc.checkAvailability("org-1", { id: "p1", stockQuantity: 1 }, null, 50)).resolves.toEqual({ ok: true });
  });

  it("active reservations reduce availability; the own session is excluded; expired rows don't count", async () => {
    const { prisma, svc } = setup();
    const future = new Date(Date.now() + 10 * 60_000);
    const past = new Date(Date.now() - 60_000);
    prisma.stockReservation.rows.push(
      { id: "r1", organizationId: "org-1", sessionRef: "cart-A", productId: "p1", variantId: null, quantity: 4, state: "active", expiresAt: future, createdAt: new Date() },
      { id: "r2", organizationId: "org-1", sessionRef: "cart-B", productId: "p1", variantId: null, quantity: 3, state: "active", expiresAt: past, createdAt: new Date() },
      { id: "r3", organizationId: "org-1", sessionRef: "cart-C", productId: "p1", variantId: null, quantity: 2, state: "consumed", expiresAt: future, createdAt: new Date() },
    );
    // 10 on hand − 4 active (expired + consumed ignored) = 6.
    await expect(svc.checkAvailability("org-1", { id: "p1", stockQuantity: 10 }, null, 7)).resolves.toEqual({ ok: false, available: 6 });
    await expect(svc.checkAvailability("org-1", { id: "p1", stockQuantity: 10 }, null, 6)).resolves.toEqual({ ok: true });
    // The reserving cart itself is excluded from its own check.
    await expect(
      svc.checkAvailability("org-1", { id: "p1", stockQuantity: 10 }, null, 10, { excludeSessionRef: "cart-A" }),
    ).resolves.toEqual({ ok: true });
  });
});

describe("GB2 cart reservations lifecycle", () => {
  async function enabledSetup() {
    const ctx = setup();
    ctx.prisma.inventorySetting.rows.push({ id: "s1", organizationId: "org-1", leadTimeDays: 7, allowBackorder: false, reserveMinutes: 30 });
    return ctx;
  }

  it("reserveMinutes = 0 → sync writes nothing", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma);
    await svc.syncCartReservations("org-1", "cart-1", [{ productId: p.id, variantId: null, quantity: 3 }]);
    expect(prisma.stockReservation.rows).toHaveLength(0);
  });

  it("sync reserves, caps at on-hand, releases removed lines, settle consumes", async () => {
    const { prisma, svc } = await enabledSetup();
    const p = await seedProduct(prisma, { stockQuantity: 4 });
    await svc.syncCartReservations("org-1", "cart-1", [{ productId: p.id, variantId: null, quantity: 9 }]);
    expect(prisma.stockReservation.rows).toHaveLength(1);
    expect(prisma.stockReservation.rows[0]).toMatchObject({ sessionRef: "cart-1", quantity: 4, state: "active" });
    expect(new Date(prisma.stockReservation.rows[0].expiresAt).getTime()).toBeGreaterThan(Date.now() + 25 * 60_000);
    // Another cart now sees only 0 available.
    await expect(svc.checkAvailability("org-1", { id: p.id, stockQuantity: 4 }, null, 1)).resolves.toEqual({ ok: false, available: 0 });
    // Quantity change updates the same row in place.
    await svc.syncCartReservations("org-1", "cart-1", [{ productId: p.id, variantId: null, quantity: 2 }]);
    expect(prisma.stockReservation.rows).toHaveLength(1);
    expect(prisma.stockReservation.rows[0].quantity).toBe(2);
    // Line removed → released.
    await svc.syncCartReservations("org-1", "cart-1", []);
    expect(prisma.stockReservation.rows[0].state).toBe("released");
    // Reserve again, then settle as consumed on conversion.
    await svc.syncCartReservations("org-1", "cart-1", [{ productId: p.id, variantId: null, quantity: 1 }]);
    const active = prisma.stockReservation.rows.filter((r: any) => r.state === "active");
    expect(active).toHaveLength(1);
    await svc.settleCartReservations("org-1", "cart-1", "consumed");
    expect(prisma.stockReservation.rows.every((r: any) => r.state !== "active")).toBe(true);
    await expect(svc.reservedQuantity("org-1", p.id, null)).resolves.toBe(0);
  });

  it("preorder + untracked lines never reserve; variant lines reserve against the variant row", async () => {
    const { prisma, svc } = await enabledSetup();
    const pre = await seedProduct(prisma, { name: "Pre", sku: "PRE-1", stockQuantity: 0, preorderEnabled: true });
    const untr = await seedProduct(prisma, { name: "Untracked", sku: "UN-1", stockQuantity: null });
    const withVar = await seedProduct(prisma, { name: "Shirt", sku: "SH-1", stockQuantity: null });
    const variant = await prisma.productVariant.create({
      data: { productId: withVar.id, name: "M", sku: "SH-M", priceMinor: null, stockQuantity: 3 },
    });
    await svc.syncCartReservations("org-1", "cart-9", [
      { productId: pre.id, variantId: null, quantity: 2 },
      { productId: untr.id, variantId: null, quantity: 2 },
      { productId: withVar.id, variantId: variant.id, quantity: 2 },
    ]);
    expect(prisma.stockReservation.rows).toHaveLength(1);
    expect(prisma.stockReservation.rows[0]).toMatchObject({ productId: withVar.id, variantId: variant.id, quantity: 2 });
  });
});

describe("GB2 out-of-stock alert", () => {
  it("placement crossing >0 → 0 notifies ACTIVE OWNER/ADMIN once, stamps, re-arms on restock", async () => {
    const { prisma, svc } = setup();
    seedMemberships(prisma);
    const p = await seedProduct(prisma, { stockQuantity: 2 });
    const order: any = { id: "o-1", organizationId: "org-1", status: "processing", source: "storefront" };
    prisma.order.rows.push(order);

    await svc.applyOrderPlaced("org-1", "o-1", { items: [{ productId: p.id, quantity: 2 }], status: "processing" } as any);
    const notifs = prisma.agentNotification.rows.filter((n: any) => n.type === "out_of_stock");
    expect(notifs.map((n: any) => n.userId).sort()).toEqual(["admin-1", "owner-1"]);
    const row = prisma.product.rows.find((r: any) => r.id === p.id);
    expect(row.stockQuantity).toBe(0);
    expect(row.lastOosNotifiedAt).toBeTruthy();

    // Further decrement at/below zero: no second alert (no new crossing).
    await svc.applyOrderPlaced("org-1", "o-2", { items: [{ productId: p.id, quantity: 1 }], status: "processing" } as any);
    expect(prisma.agentNotification.rows.filter((n: any) => n.type === "out_of_stock")).toHaveLength(2);

    // Restock re-arms (stamp cleared by the write landing above 0).
    await svc.adjust("org-1", "staff-1", p.id, { delta: 5, reason: "manual_adjustment" });
    expect(prisma.product.rows.find((r: any) => r.id === p.id).lastOosNotifiedAt).toBeNull();

    // Crossing again fires again (balance is 4 after the -1 + 5
    // sequence, so -4 lands exactly on zero).
    await svc.adjust("org-1", "staff-1", p.id, { delta: -4, reason: "damaged" });
    expect(prisma.agentNotification.rows.filter((n: any) => n.type === "out_of_stock")).toHaveLength(4);
    // The audit trail carries the alert rows for the history tab.
    expect(prisma.auditLog.rows.some((a: any) => a.action === "inventory.out_of_stock_alert" && a.entityId === p.id)).toBe(true);
  });

  it("variant crossing stamps + alerts on the variant row", async () => {
    const { prisma, svc } = setup();
    seedMemberships(prisma);
    const p = await seedProduct(prisma, { stockQuantity: null });
    const v = await prisma.productVariant.create({
      data: { productId: p.id, name: "L", sku: "PN-L", priceMinor: null, stockQuantity: 1 },
    });
    await svc.applyOrderPlaced("org-1", "o-9", { items: [{ productId: p.id, variantId: v.id, quantity: 1 }], status: "processing" } as any);
    const vRow = prisma.productVariant.rows.find((r: any) => r.id === v.id);
    expect(vRow.stockQuantity).toBe(0);
    expect(vRow.lastOosNotifiedAt).toBeTruthy();
    expect(prisma.agentNotification.rows.filter((n: any) => n.type === "out_of_stock")).toHaveLength(2);
  });

  it("no crossing → no alert (2 → 1 stays silent)", async () => {
    const { prisma, svc } = setup();
    seedMemberships(prisma);
    const p = await seedProduct(prisma, { stockQuantity: 2 });
    await svc.adjust("org-1", "staff-1", p.id, { delta: -1, reason: "correction" });
    expect(prisma.agentNotification.rows.filter((n: any) => n.type === "out_of_stock")).toHaveLength(0);
  });
});

describe("GB2 adjustment reason vocabulary (DTO)", () => {
  async function errorsFor(reason: unknown) {
    const dto = new StockAdjustmentDto();
    (dto as any).delta = -2;
    (dto as any).reason = reason;
    const errs = await validate(dto);
    return errs.filter((e) => e.property === "reason");
  }

  it("accepts the coded vocabulary + omission", async () => {
    for (const r of ["damaged", "lost", "expired", "supplier_return", "correction", "other", "manual_adjustment", undefined]) {
      expect(await errorsFor(r)).toHaveLength(0);
    }
  });

  it("rejects free-text reasons at the merchant boundary", async () => {
    expect(await errorsFor("পণ্যটি নষ্ট")).not.toHaveLength(0);
    expect(await errorsFor("order_placed")).not.toHaveLength(0);
  });
});
