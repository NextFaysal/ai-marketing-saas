import { InventoryService } from "./inventory.service";

/**
 * AB3 (AX4) — multi-warehouse stock specs (design
 * docs/advanced-ab3-design.md §8). The fake-Prisma harness of
 * inventory.spec.ts, EXTENDED with the AB3 tables (warehouse,
 * binLocation, productBinAssignment, stockBalance,
 * stockAllocation) + a $transaction passthrough, so the bin
 * layer is ACTIVE here — unlike the legacy suites, where its
 * absence must keep behaviour byte-identical.
 *
 * The invariant asserted after EVERY operation type:
 *   Σ StockBalance.onHand over all bins == the global counter.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v && !v.in.includes(row[k])) return false;
      if ("notIn" in v && v.notIn.includes(row[k])) return false;
      if ("gte" in v && !(row[k] != null && new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
      if ("gt" in v && !(row[k] != null && new Date(row[k]).getTime() > new Date(v.gt).getTime())) return false;
      if ("lt" in v && !(row[k] != null && new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false;
      if ("lte" in v && !(row[k] != null && new Date(row[k]).getTime() <= new Date(v.lte).getTime())) return false;
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
      rows.find((r) => r.id === where.id || (where.organizationId !== undefined && r.organizationId === where.organizationId)) ?? null,
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
      const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(Date.now() + seq * 1000), updatedAt: new Date(), ...data };
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
      return rows.splice(idx, 1)[0];
    },
    deleteMany: async ({ where }: any) => {
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1);
      return { count: 0 };
    },
  };
}

function fakePrisma() {
  const fake: any = {
    product: makeTable("product"), productVariant: makeTable("variant"),
    order: makeTable("order"), orderItem: makeTable("item"),
    customer: makeTable("customer"), stockMovement: makeTable("movement"),
    stockReservation: makeTable("reservation"), inventorySetting: makeTable("invsetting"),
    membership: makeTable("membership"), agentNotification: makeTable("notif"),
    auditLog: makeTable("audit"), bundleItem: makeTable("bundleItem"),
    organization: makeTable("organization"),
    warehouse: makeTable("warehouse"), binLocation: makeTable("bin"),
    productBinAssignment: makeTable("assignment"),
    stockBalance: makeTable("balance"), stockAllocation: makeTable("allocation"),
  };
  // $transaction passthrough: the callback runs against the
  // same fake (the loyalty pattern's fallback shape).
  fake.$transaction = async (cb: any) => cb(fake);
  return fake;
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

let clock = 1_700_000_000_000;
function at(minutes: number): Date { return new Date((clock += minutes * 60_000)); }

async function seedProduct(prisma: any, over: Record<string, unknown> = {}) {
  return prisma.product.create({
    data: {
      organizationId: "org-1", name: "Panjabi", sku: "PN-1", priceMinor: 100000n,
      stockQuantity: 20, lowStockThreshold: null, preorderEnabled: false, ...over,
    },
  });
}

function seedWarehouse(prisma: any, over: Record<string, unknown> = {}) {
  const row = {
    id: (over.id as string) ?? `wh-${prisma.warehouse.rows.length + 1}`,
    organizationId: "org-1", name: "গুদাম", address: null,
    isDefault: false, active: true, priority: 0, serviceDistricts: null,
    createdAt: at(1), updatedAt: new Date(),
    ...over,
  };
  prisma.warehouse.rows.push(row);
  return row;
}

function seedBin(prisma: any, warehouseId: string, code: string, over: Record<string, unknown> = {}) {
  const row = {
    id: (over.id as string) ?? `bin-${prisma.binLocation.rows.length + 1}`,
    organizationId: "org-1", warehouseId, code, note: null,
    createdAt: at(1), updatedAt: new Date(),
    ...over,
  };
  prisma.binLocation.rows.push(row);
  return row;
}

function seedAssignment(prisma: any, over: Record<string, unknown> = {}) {
  const row = {
    id: `as-${prisma.productBinAssignment.rows.length + 1}`,
    organizationId: "org-1", variantId: null,
    createdAt: at(1), updatedAt: new Date(),
    ...over,
  };
  prisma.productBinAssignment.rows.push(row);
  return row;
}

function seedBalance(prisma: any, over: Record<string, unknown> = {}) {
  const row = {
    id: `bal-${prisma.stockBalance.rows.length + 1}`,
    organizationId: "org-1", variantId: null, onHand: 0, reserved: 0,
    createdAt: at(1), updatedAt: new Date(),
    ...over,
  };
  prisma.stockBalance.rows.push(row);
  return row;
}

/** Σ balances for one stock key. */
function sumBalances(prisma: any, productId: string, variantId: string | null = null): number {
  return prisma.stockBalance.rows
    .filter((r: any) => r.organizationId === "org-1" && r.productId === productId && (r.variantId ?? null) === variantId)
    .reduce((s: number, r: any) => s + r.onHand, 0);
}

function balanceAt(prisma: any, productId: string, binId: string, variantId: string | null = null): any {
  return prisma.stockBalance.rows.find(
    (r: any) => r.productId === productId && r.binId === binId && (r.variantId ?? null) === variantId,
  ) ?? null;
}

function globalOf(prisma: any, productId: string, variantId: string | null = null): number | null {
  if (variantId) return prisma.productVariant.rows.find((r: any) => r.id === variantId)?.stockQuantity ?? null;
  return prisma.product.rows.find((r: any) => r.id === productId)?.stockQuantity ?? null;
}

/** THE invariant (§3): Σ per-bin onHand == the global counter. */
function expectInvariant(prisma: any, productId: string, variantId: string | null = null) {
  expect(sumBalances(prisma, productId, variantId)).toBe(globalOf(prisma, productId, variantId));
}

describe("AB3 resolver pinning (§4.1)", () => {
  it("assignment wins; an assignment in the default warehouse beats one elsewhere; variant-exact beats product-level", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma);
    const v = await prisma.productVariant.create({ data: { productId: p.id, name: "XL", sku: "PN-1-XL", stockQuantity: 7 } });
    const whDefault = seedWarehouse(prisma, { isDefault: true });
    const binDefault = seedBin(prisma, whDefault.id, "D-01");
    const whOther = seedWarehouse(prisma);
    const binOther = seedBin(prisma, whOther.id, "O-01");
    const binOther2 = seedBin(prisma, whOther.id, "O-02");

    // Product-level assignment in the OTHER warehouse only.
    seedAssignment(prisma, { warehouseId: whOther.id, binLocationId: binOther.id, productId: p.id, variantId: null });
    expect((await svc.resolveDefaultBin("org-1", p.id, null))?.id).toBe(binOther.id);

    // An assignment in the DEFAULT warehouse now wins for the product key.
    seedAssignment(prisma, { warehouseId: whDefault.id, binLocationId: binDefault.id, productId: p.id, variantId: null });
    expect((await svc.resolveDefaultBin("org-1", p.id, null))?.id).toBe(binDefault.id);

    // Variant-exact assignment beats the product-level ones for the variant key.
    seedAssignment(prisma, { warehouseId: whOther.id, binLocationId: binOther2.id, productId: p.id, variantId: v.id });
    expect((await svc.resolveDefaultBin("org-1", p.id, v.id))?.id).toBe(binOther2.id);
    expect((await svc.resolveDefaultBin("org-1", p.id, null))?.id).toBe(binDefault.id);
  });

  it("no assignment → the default warehouse's earliest bin (isDefault first, else earliest warehouse)", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma);
    const whOld = seedWarehouse(prisma); // earliest, not default
    seedBin(prisma, whOld.id, "OLD-1");
    const whDefault = seedWarehouse(prisma, { isDefault: true });
    const binA = seedBin(prisma, whDefault.id, "A-01");
    seedBin(prisma, whDefault.id, "A-02");
    expect((await svc.resolveDefaultBin("org-1", p.id, null))?.id).toBe(binA.id);
  });

  it("no warehouse at all → lazily creates Main Warehouse (isDefault) + Main Bin (MAIN)", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma);
    const bin = await svc.resolveDefaultBin("org-1", p.id, null);
    expect(bin?.code).toBe("MAIN");
    const wh = prisma.warehouse.rows.find((w: any) => w.id === bin.warehouseId);
    expect(wh).toMatchObject({ name: "Main Warehouse", isDefault: true });
    // Second resolve reuses the same rows (no duplicates).
    const again = await svc.resolveDefaultBin("org-1", p.id, null);
    expect(again.id).toBe(bin.id);
    expect(prisma.warehouse.rows).toHaveLength(1);
    expect(prisma.binLocation.rows).toHaveLength(1);
  });
});

describe("AB3 adjust bin wiring (§6)", () => {
  it("adjust + and − post to the resolved default bin; Σ == global after each", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    const up = await svc.adjust("org-1", "owner-1", p.id, { delta: 5 });
    expect(up.stockQuantity).toBe(25);
    expectInvariant(prisma, p.id);
    expect(prisma.stockBalance.rows).toHaveLength(1);
    expect(prisma.stockBalance.rows[0].onHand).toBe(25);
    expect(up.movement.binId).toBe(prisma.stockBalance.rows[0].binId);

    const down = await svc.adjust("org-1", "owner-1", p.id, { delta: -3, reason: "damaged" });
    expect(down.stockQuantity).toBe(22);
    expect(down.movement).toMatchObject({ reason: "damaged", binId: prisma.stockBalance.rows[0].binId });
    expectInvariant(prisma, p.id);
  });

  it("setTo: the addressed (default) bin absorbs the difference", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    await svc.adjust("org-1", "owner-1", p.id, { setTo: 7 });
    expect(globalOf(prisma, p.id)).toBe(7);
    expect(prisma.stockBalance.rows).toHaveLength(1);
    expect(prisma.stockBalance.rows[0].onHand).toBe(7);
    expectInvariant(prisma, p.id);
  });

  it("explicit binId posts there (a second bin can hold stock while the global is set by Σ)", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    const wh = seedWarehouse(prisma, { isDefault: true });
    const bin1 = seedBin(prisma, wh.id, "A-01");
    const bin2 = seedBin(prisma, wh.id, "A-02");
    await svc.adjust("org-1", "owner-1", p.id, { delta: 10 }); // seeds 20 at bin1, +10 → 30
    expect(balanceAt(prisma, p.id, bin1.id)?.onHand).toBe(30);
    const out = await svc.adjust("org-1", "owner-1", p.id, { delta: 5, binId: bin2.id, reason: "damaged" });
    expect(out.movement.binId).toBe(bin2.id);
    expect(balanceAt(prisma, p.id, bin2.id)?.onHand).toBe(5);
    expect(balanceAt(prisma, p.id, bin1.id)?.onHand).toBe(30);
    expect(globalOf(prisma, p.id)).toBe(35);
    expectInvariant(prisma, p.id);
  });

  it("an explicit binId from another org (or unknown) is refused with the Bengali message", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    const foreign = seedBin(prisma, "wh-x", "F-01", { organizationId: "org-2" });
    await expect(svc.adjust("org-1", "owner-1", p.id, { delta: 1, binId: foreign.id }))
      .rejects.toThrow(/বিনটি এই প্রতিষ্ঠানে পাওয়া যায়নি/);
    await expect(svc.adjust("org-1", "owner-1", p.id, { delta: 1, binId: "nope" }))
      .rejects.toThrow(/বিনটি এই প্রতিষ্ঠানে পাওয়া যায়নি/);
    expect(globalOf(prisma, p.id)).toBe(20);
    expect(prisma.stockBalance.rows).toHaveLength(0);
  });

  it("variant adjust seeds + posts at the variant key only (no product-level balance)", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    const v = await prisma.productVariant.create({ data: { productId: p.id, name: "XL", sku: "PN-1-XL", stockQuantity: 7 } });
    await svc.adjust("org-1", "owner-1", p.id, { variantId: v.id, delta: 3 });
    expect(globalOf(prisma, p.id, v.id)).toBe(10);
    expectInvariant(prisma, p.id, v.id);
    expect(prisma.stockBalance.rows.filter((r: any) => r.variantId === null)).toHaveLength(0);
    expect(globalOf(prisma, p.id)).toBe(20); // product row untouched
  });
});

describe("AB3 recordSyncedStock (§6)", () => {
  it("the sync delta lands in the default bin; the pre-sync distribution otherwise survives", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    await svc.adjust("org-1", "owner-1", p.id, { delta: 0 }); // force the lazy seed at 20
    expect(sumBalances(prisma, p.id)).toBe(20);
    // The caller writes the synced global itself, then ledgers.
    prisma.product.rows[0].stockQuantity = 14;
    await svc.recordSyncedStock("org-1", p.id, null, 20, 14);
    expect(sumBalances(prisma, p.id)).toBe(14);
    expectInvariant(prisma, p.id);
    const mv = prisma.stockMovement.rows.find((m: any) => m.reason === "sync_correction");
    expect(mv).toMatchObject({ delta: -6, balanceAfter: 14 });
  });

  it("baseline transitions still write nothing — no movement, no balance", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    await svc.recordSyncedStock("org-1", p.id, null, null, 20);
    await svc.recordSyncedStock("org-1", p.id, null, 20, null);
    await svc.recordSyncedStock("org-1", p.id, null, 20, 20);
    expect(prisma.stockMovement.rows).toHaveLength(0);
    expect(prisma.stockBalance.rows).toHaveLength(0);
  });

  it("a first sync correction on a never-seeded row seeds with `previous`, then applies the delta", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 30 }); // caller already wrote 30
    await svc.recordSyncedStock("org-1", p.id, null, 24, 30);
    expect(sumBalances(prisma, p.id)).toBe(30); // seeded 24, +6
    expectInvariant(prisma, p.id);
  });
});

describe("AB3 backfillStockBalances (§4.3b)", () => {
  it("seeds every tracked row once at its resolved bin; untracked rows skipped; second run is a no-op", async () => {
    const { prisma, svc } = setup();
    await prisma.organization.create({ data: { id: "org-1", name: "Shop" } });
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    const v = await prisma.productVariant.create({ data: { productId: p.id, name: "XL", sku: "PN-1-XL", stockQuantity: 7 } });
    await seedProduct(prisma, { name: "Free", sku: "FR-1", stockQuantity: null });
    const wh = seedWarehouse(prisma, { isDefault: true });
    const bin = seedBin(prisma, wh.id, "A-01");
    seedAssignment(prisma, { warehouseId: wh.id, binLocationId: bin.id, productId: p.id, variantId: v.id });

    const first = await svc.backfillStockBalances("org-1");
    expect(first).toEqual({ seeded: 2, skipped: 0 });
    expect(balanceAt(prisma, p.id, bin.id)?.onHand).toBe(20);
    expect(balanceAt(prisma, p.id, bin.id, v.id)?.onHand).toBe(7);
    expectInvariant(prisma, p.id);
    expectInvariant(prisma, p.id, v.id);
    expect(prisma.stockBalance.rows).toHaveLength(2); // untracked product got none

    const second = await svc.backfillStockBalances("org-1");
    expect(second).toEqual({ seeded: 0, skipped: 2 });
    expect(prisma.stockBalance.rows).toHaveLength(2);
  });

  it("an org with tracked stock but no warehouse gets Main Warehouse/Main Bin from the backfill", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 9 });
    const out = await svc.backfillStockBalances("org-1");
    expect(out.seeded).toBe(1);
    const wh = prisma.warehouse.rows[0];
    expect(wh).toMatchObject({ name: "Main Warehouse", isDefault: true });
    expect(prisma.binLocation.rows[0].code).toBe("MAIN");
    expectInvariant(prisma, p.id);
  });
});

describe("AB3 reservations (§6)", () => {
  async function setupReserved(prisma: any, svc: any) {
    const p = await seedProduct(prisma, { stockQuantity: 10 });
    await prisma.inventorySetting.create({ data: { organizationId: "org-1", reserveMinutes: 30 } });
    const wh = seedWarehouse(prisma, { isDefault: true });
    const bin = seedBin(prisma, wh.id, "A-01");
    seedBalance(prisma, { productId: p.id, binId: bin.id, onHand: 10 });
    return { p, bin };
  }

  it("create stamps the resolved bin, caps at the bin's promise, and maintains the reserved counter", async () => {
    const { prisma, svc } = setup();
    const { p, bin } = await setupReserved(prisma, svc);
    await svc.syncCartReservations("org-1", "sess-a", [{ productId: p.id, variantId: null, quantity: 4 }]);
    const rowA = prisma.stockReservation.rows.find((r: any) => r.sessionRef === "sess-a");
    expect(rowA).toMatchObject({ quantity: 4, binId: bin.id, state: "active" });
    expect(balanceAt(prisma, p.id, bin.id)?.reserved).toBe(4);

    // Session B wants 9 but the bin can only promise 10 − 4 = 6.
    await svc.syncCartReservations("org-1", "sess-b", [{ productId: p.id, variantId: null, quantity: 9 }]);
    const rowB = prisma.stockReservation.rows.find((r: any) => r.sessionRef === "sess-b");
    expect(rowB.quantity).toBe(6);
    expect(balanceAt(prisma, p.id, bin.id)?.reserved).toBe(10);

    // A empties its cart → released; the counter follows.
    await svc.syncCartReservations("org-1", "sess-a", []);
    expect(rowA.state).toBe("released");
    expect(balanceAt(prisma, p.id, bin.id)?.reserved).toBe(6);

    // B checks out (consumed) → the bin hold is gone.
    await svc.settleCartReservations("org-1", "sess-b", "consumed");
    expect(balanceAt(prisma, p.id, bin.id)?.reserved).toBe(0);
    expectInvariant(prisma, p.id);
  });

  it("lazy expiry frees the bin: an expired row stops counting at the next recompute", async () => {
    const { prisma, svc } = setup();
    const { p, bin } = await setupReserved(prisma, svc);
    await svc.syncCartReservations("org-1", "sess-a", [{ productId: p.id, variantId: null, quantity: 4 }]);
    expect(balanceAt(prisma, p.id, bin.id)?.reserved).toBe(4);
    // The row expires (no sweep exists — expiry is lazy).
    prisma.stockReservation.rows[0].expiresAt = new Date(Date.now() - 1000);
    // B's sync recomputes the bin: only B's live hold counts,
    // and B is NOT capped by A's expired hold (10 − 0, wants 3).
    await svc.syncCartReservations("org-1", "sess-b", [{ productId: p.id, variantId: null, quantity: 3 }]);
    const rowB = prisma.stockReservation.rows.find((r: any) => r.sessionRef === "sess-b");
    expect(rowB.quantity).toBe(3);
    expect(balanceAt(prisma, p.id, bin.id)?.reserved).toBe(3);
  });

  it("a reservation never promises more than the bin holds, even when the global is larger", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 50 });
    await prisma.inventorySetting.create({ data: { organizationId: "org-1", reserveMinutes: 30 } });
    const wh = seedWarehouse(prisma, { isDefault: true });
    const bin1 = seedBin(prisma, wh.id, "A-01");
    const bin2 = seedBin(prisma, wh.id, "A-02");
    seedBalance(prisma, { productId: p.id, binId: bin1.id, onHand: 8 });
    seedBalance(prisma, { productId: p.id, binId: bin2.id, onHand: 42 });
    // The resolver picks ONE bin (the assignment → default):
    // bin1 is the warehouse's earliest bin, so the cap is 8.
    await svc.syncCartReservations("org-1", "sess-a", [{ productId: p.id, variantId: null, quantity: 20 }]);
    const row = prisma.stockReservation.rows[0];
    expect(row).toMatchObject({ binId: bin1.id, quantity: 8 });
    expect(balanceAt(prisma, p.id, bin1.id)?.reserved).toBe(8);
  });
});

describe("AB3 applyBinOnlyDelta (transfer primitive)", () => {
  it("moves units between bins with the global untouched; refuseNegative refuses an over-draw", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    const wh = seedWarehouse(prisma, { isDefault: true });
    const bin1 = seedBin(prisma, wh.id, "A-01");
    const bin2 = seedBin(prisma, wh.id, "A-02");
    seedBalance(prisma, { productId: p.id, binId: bin1.id, onHand: 20 });

    await expect(svc.applyBinOnlyDelta("org-1", {
      productId: p.id, binId: bin1.id, delta: -25, reason: "transfer_out", refuseNegative: true,
    })).rejects.toThrow(/পর্যাপ্ত স্টক নেই/);
    expect(balanceAt(prisma, p.id, bin1.id)?.onHand).toBe(20); // refused: nothing moved

    const out = await svc.applyBinOnlyDelta("org-1", {
      productId: p.id, binId: bin1.id, delta: -6, reason: "transfer_out", refuseNegative: true,
    });
    expect(out.onHand).toBe(14);
    expect(out.movement).toMatchObject({ delta: -6, balanceAfter: 20, reason: "transfer_out", binId: bin1.id });
    await svc.applyBinOnlyDelta("org-1", {
      productId: p.id, binId: bin2.id, delta: 6, reason: "transfer_in",
    });
    expect(balanceAt(prisma, p.id, bin2.id)?.onHand).toBe(6);
    expect(globalOf(prisma, p.id)).toBe(20); // global NEVER moved
    expectInvariant(prisma, p.id);
  });

  it("throws when the bin layer is inactive — transfers never silently no-op", async () => {
    const legacy: any = {
      product: makeTable("product"), productVariant: makeTable("variant"),
      stockMovement: makeTable("movement"), auditLog: makeTable("audit"),
    };
    const svc2 = new InventoryService(legacy as any, fakeAudit(legacy));
    await expect(svc2.applyBinOnlyDelta("org-1", {
      productId: "p1", binId: "b1", delta: -1, reason: "transfer_out",
    })).rejects.toThrow(/সক্রিয় নয়/);
  });
});

// ---------- Order-path allocation (§5) ----------

function activeAllocations(prisma: any, orderId: string, productId?: string) {
  return prisma.stockAllocation.rows.filter(
    (r: any) => r.orderId === orderId && r.status === "active" && (!productId || r.productId === productId),
  );
}

async function seedOrder(prisma: any, id: string, over: Record<string, unknown> = {}) {
  const order = await prisma.order.create({
    data: { id, organizationId: "org-1", externalId: id, source: "manual", status: "processing", ...over },
  });
  return order;
}

describe("AB3 order placement (§5.1)", () => {
  it("single-bin placement: one movement with binId, one allocation matched to the OrderItem, Σ == global", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    const wh = seedWarehouse(prisma, { isDefault: true });
    const bin = seedBin(prisma, wh.id, "A-01");
    seedBalance(prisma, { productId: p.id, binId: bin.id, onHand: 20 });
    const order = await seedOrder(prisma, "order-1");
    const item = await prisma.orderItem.create({
      data: { orderId: order.id, productId: p.id, name: "Panjabi", sku: "PN-1", quantity: 3 },
    });
    const out = await svc.applyOrderPlaced("org-1", order.id, { status: "processing" });
    expect(out).toEqual({ decremented: 1, skipped: 0 });
    expect(globalOf(prisma, p.id)).toBe(17);
    expect(balanceAt(prisma, p.id, bin.id)?.onHand).toBe(17);
    expectInvariant(prisma, p.id);
    const movements = prisma.stockMovement.rows.filter((m: any) => m.reason === "order_placed");
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ delta: -3, balanceAfter: 17, binId: bin.id });
    expect(activeAllocations(prisma, order.id)).toHaveLength(1);
    expect(activeAllocations(prisma, order.id)[0]).toMatchObject({
      orderItemId: item.id, binId: bin.id, warehouseId: wh.id, qty: 3,
    });
    // Idempotency unchanged: a re-run writes nothing more.
    const again = await svc.applyOrderPlaced("org-1", order.id, { status: "processing" });
    expect(again.decremented).toBe(0);
    expect(prisma.stockMovement.rows.filter((m: any) => m.reason === "order_placed")).toHaveLength(1);
    expectInvariant(prisma, p.id);
  });

  it("district routing: serviceDistricts beats priority; without a district, priority decides", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    const whDhaka = seedWarehouse(prisma, { isDefault: true, priority: 0 });
    const binDhaka = seedBin(prisma, whDhaka.id, "D-01");
    const whKhulna = seedWarehouse(prisma, { priority: 5, serviceDistricts: ["Khulna"] });
    const binKhulna = seedBin(prisma, whKhulna.id, "K-01");
    seedBalance(prisma, { productId: p.id, binId: binDhaka.id, onHand: 10 });
    seedBalance(prisma, { productId: p.id, binId: binKhulna.id, onHand: 10 });
    prisma.customer.rows.push({ id: "cust-1", organizationId: "org-1", name: "Rahim", address: { district: "Khulna" } });
    await seedOrder(prisma, "order-k", { customerId: "cust-1" });
    await seedOrder(prisma, "order-d");

    await svc.applyOrderPlaced("org-1", "order-k", { items: [{ productId: p.id, quantity: 4 }] });
    expect(balanceAt(prisma, p.id, binKhulna.id)?.onHand).toBe(6); // district served first
    expect(balanceAt(prisma, p.id, binDhaka.id)?.onHand).toBe(10);
    expect(activeAllocations(prisma, "order-k")[0].warehouseId).toBe(whKhulna.id);
    expectInvariant(prisma, p.id);

    await svc.applyOrderPlaced("org-1", "order-d", { items: [{ productId: p.id, quantity: 4 }] });
    expect(balanceAt(prisma, p.id, binDhaka.id)?.onHand).toBe(6); // priority 0 wins with no district
    expect(balanceAt(prisma, p.id, binKhulna.id)?.onHand).toBe(6);
    expectInvariant(prisma, p.id);
  });

  it("placement spanning two warehouses draws each bin to zero before falling through; oversell over-draws the first candidate's default bin", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 13 });
    const whA = seedWarehouse(prisma, { priority: 0, isDefault: true });
    const binA = seedBin(prisma, whA.id, "A-01");
    const whB = seedWarehouse(prisma, { priority: 1 });
    const binB = seedBin(prisma, whB.id, "B-01");
    seedBalance(prisma, { productId: p.id, binId: binA.id, onHand: 3 });
    seedBalance(prisma, { productId: p.id, binId: binB.id, onHand: 10 });

    await svc.applyOrderPlaced("org-1", "order-1", { items: [{ productId: p.id, quantity: 5 }] });
    expect(balanceAt(prisma, p.id, binA.id)?.onHand).toBe(0);
    expect(balanceAt(prisma, p.id, binB.id)?.onHand).toBe(8);
    const movements = prisma.stockMovement.rows.filter((m: any) => m.reason === "order_placed");
    expect(movements.map((m: any) => [m.binId, m.delta])).toEqual([[binA.id, -3], [binB.id, -2]]);
    expect(activeAllocations(prisma, "order-1").map((a: any) => [a.binId, a.qty])).toEqual([[binA.id, 3], [binB.id, 2]]);
    expectInvariant(prisma, p.id);

    // Oversell: 20 wanted, 8 remain across all bins → bins to
    // zero, remainder −12 into the FIRST candidate's default bin.
    await svc.applyOrderPlaced("org-1", "order-2", { items: [{ productId: p.id, quantity: 20 }] });
    expect(globalOf(prisma, p.id)).toBe(-12);
    expect(balanceAt(prisma, p.id, binA.id)?.onHand).toBe(-12);
    expect(balanceAt(prisma, p.id, binB.id)?.onHand).toBe(0);
    expectInvariant(prisma, p.id);
  });

  it("bundle placement: components draw by the same rule with orderItemId null allocations", async () => {
    const { prisma, svc } = setup();
    const parent = await seedProduct(prisma, { name: "Set", sku: "SET-1", stockQuantity: 20 });
    const comp = await seedProduct(prisma, { name: "Comp", sku: "CP-1", stockQuantity: 30 });
    await prisma.bundleItem.create({
      data: { organizationId: "org-1", parentProductId: parent.id, componentProductId: comp.id, componentVariantId: null, quantity: 2 },
    });
    const wh = seedWarehouse(prisma, { isDefault: true });
    const bin = seedBin(prisma, wh.id, "A-01");
    seedBalance(prisma, { productId: parent.id, binId: bin.id, onHand: 20 });
    seedBalance(prisma, { productId: comp.id, binId: bin.id, onHand: 30 });

    await svc.applyOrderPlaced("org-1", "order-1", { items: [{ productId: parent.id, quantity: 5 }] });
    expect(globalOf(prisma, comp.id)).toBe(20);
    expect(balanceAt(prisma, comp.id, bin.id)?.onHand).toBe(20);
    expectInvariant(prisma, parent.id);
    expectInvariant(prisma, comp.id);
    const compMovement = prisma.stockMovement.rows.find((m: any) => m.reason === "bundle_component");
    expect(compMovement).toMatchObject({ delta: -10, binId: bin.id });
    const compAlloc = activeAllocations(prisma, "order-1", comp.id);
    expect(compAlloc).toHaveLength(1);
    expect(compAlloc[0]).toMatchObject({ qty: 10, orderItemId: null, binId: bin.id });
  });

  it("variant placement allocates at the variant key only", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    const v = await prisma.productVariant.create({ data: { productId: p.id, name: "XL", sku: "PN-1-XL", stockQuantity: 7 } });
    const wh = seedWarehouse(prisma, { isDefault: true });
    const bin = seedBin(prisma, wh.id, "A-01");
    seedBalance(prisma, { productId: p.id, variantId: v.id, binId: bin.id, onHand: 7 });
    await svc.applyOrderPlaced("org-1", "order-1", { items: [{ productId: p.id, variantId: v.id, quantity: 2 }] });
    expect(balanceAt(prisma, p.id, bin.id, v.id)?.onHand).toBe(5);
    expectInvariant(prisma, p.id, v.id);
    expect(prisma.stockBalance.rows.filter((r: any) => r.variantId === null)).toHaveLength(0);
    expect(activeAllocations(prisma, "order-1")[0]).toMatchObject({ variantId: v.id, qty: 2 });
  });
});

describe("AB3 restore (§5.2)", () => {
  it("cancel restores into the allocation bins, settles the allocations, and counts the key once", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    const wh = seedWarehouse(prisma, { isDefault: true });
    const bin = seedBin(prisma, wh.id, "A-01");
    seedBalance(prisma, { productId: p.id, binId: bin.id, onHand: 20 });
    await svc.applyOrderPlaced("org-1", "order-1", { items: [{ productId: p.id, quantity: 3 }] });
    const out = await svc.applyOrderRestore("org-1", "order-1", "order_cancelled");
    expect(out).toEqual({ restored: 1, skipped: 0 });
    expect(globalOf(prisma, p.id)).toBe(20);
    expect(balanceAt(prisma, p.id, bin.id)?.onHand).toBe(20);
    expectInvariant(prisma, p.id);
    const restore = prisma.stockMovement.rows.find((m: any) => m.reason === "order_cancelled");
    expect(restore).toMatchObject({ delta: 3, binId: bin.id });
    expect(activeAllocations(prisma, "order-1")).toHaveLength(0);
    expect(prisma.stockAllocation.rows[0].status).toBe("settled");
    const again = await svc.applyOrderRestore("org-1", "order-1", "order_cancelled");
    expect(again).toEqual({ restored: 0, skipped: 0 });
    expectInvariant(prisma, p.id);
  });

  it("return restores a spanning placement across BOTH bins", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 13 });
    const whA = seedWarehouse(prisma, { priority: 0, isDefault: true });
    const binA = seedBin(prisma, whA.id, "A-01");
    const whB = seedWarehouse(prisma, { priority: 1 });
    const binB = seedBin(prisma, whB.id, "B-01");
    seedBalance(prisma, { productId: p.id, binId: binA.id, onHand: 3 });
    seedBalance(prisma, { productId: p.id, binId: binB.id, onHand: 10 });
    await svc.applyOrderPlaced("org-1", "order-1", { items: [{ productId: p.id, quantity: 5 }] });
    const out = await svc.applyOrderRestore("org-1", "order-1", "order_returned");
    expect(out.restored).toBe(1); // ONE key, though the restore wrote two movements
    expect(balanceAt(prisma, p.id, binA.id)?.onHand).toBe(3);
    expect(balanceAt(prisma, p.id, binB.id)?.onHand).toBe(10);
    expect(globalOf(prisma, p.id)).toBe(13);
    expectInvariant(prisma, p.id);
    expect(activeAllocations(prisma, "order-1")).toHaveLength(0);
  });

  it("a pre-AB3 order (placed movement, NO allocations) restores its remainder into the default bin", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 17 }); // already deducted pre-AB3
    const wh = seedWarehouse(prisma, { isDefault: true });
    const bin = seedBin(prisma, wh.id, "A-01");
    seedBalance(prisma, { productId: p.id, binId: bin.id, onHand: 17 });
    await prisma.stockMovement.create({
      data: { organizationId: "org-1", productId: p.id, variantId: null, delta: -3, balanceAfter: 17, reason: "order_placed", orderId: "order-old" },
    });
    const out = await svc.applyOrderRestore("org-1", "order-old", "order_cancelled");
    expect(out.restored).toBe(1);
    expect(globalOf(prisma, p.id)).toBe(20);
    expect(balanceAt(prisma, p.id, bin.id)?.onHand).toBe(20);
    expectInvariant(prisma, p.id);
  });
});

describe("AB3 re-allocation (§5.3) + the §1.5 family pin", () => {
  async function placedFixture() {
    const ctx = setup();
    const { prisma, svc } = ctx;
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    const wh1 = seedWarehouse(prisma, { isDefault: true, priority: 0 });
    const bin1 = seedBin(prisma, wh1.id, "A-01");
    const wh2 = seedWarehouse(prisma, { priority: 1 });
    const bin2 = seedBin(prisma, wh2.id, "B-01");
    seedBalance(prisma, { productId: p.id, binId: bin1.id, onHand: 20 });
    await svc.applyOrderPlaced("org-1", "order-1", { items: [{ productId: p.id, quantity: 5 }] });
    return { ...ctx, p, wh1, bin1, wh2, bin2 };
  }

  it("re-allocation moves the claim, never the global; a later restore credits the CURRENT bins exactly once", async () => {
    const { prisma, svc, audit, p, bin1, wh2, bin2 } = await placedFixture();
    const out = await svc.reallocateOrderBins("org-1", "order-1", wh2.id, "owner-1");
    expect(out.moved).toBe(5);
    expect(out.allocations).toHaveLength(1);
    expect(out.allocations[0]).toMatchObject({ binId: bin2.id, warehouseId: wh2.id, qty: 5 });
    expect(balanceAt(prisma, p.id, bin1.id)?.onHand).toBe(20); // credited back
    expect(balanceAt(prisma, p.id, bin2.id)?.onHand).toBe(-5); // over-drawn in target
    expect(globalOf(prisma, p.id)).toBe(15); // NEVER moved
    expectInvariant(prisma, p.id);
    const outMv = prisma.stockMovement.rows.find((m: any) => m.reason === "reallocation_out");
    const inMv = prisma.stockMovement.rows.find((m: any) => m.reason === "reallocation_in");
    expect(outMv).toMatchObject({ delta: -5, binId: bin1.id, balanceAfter: 15 });
    expect(inMv).toMatchObject({ delta: 5, binId: bin2.id, balanceAfter: 15 });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: "inventory.reallocated",
      metadata: expect.objectContaining({ orderId: "order-1", targetWarehouseId: wh2.id, movedQty: 5 }),
    }));

    // §1.5 pin: reallocation reasons are OUTSIDE the restore /
    // netting families — the restore target is still exactly
    // the placed qty, restored into the CURRENT (new) bin.
    const restored = await svc.applyOrderRestore("org-1", "order-1", "order_cancelled");
    expect(restored.restored).toBe(1);
    expect(globalOf(prisma, p.id)).toBe(20);
    expect(balanceAt(prisma, p.id, bin2.id)?.onHand).toBe(0); // credited where the claim NOW lives
    expect(balanceAt(prisma, p.id, bin1.id)?.onHand).toBe(20);
    expectInvariant(prisma, p.id);
    const restoreTotal = prisma.stockMovement.rows
      .filter((m: any) => m.reason === "order_cancelled")
      .reduce((s: number, m: any) => s + m.delta, 0);
    expect(restoreTotal).toBe(5); // exactly the placed qty, once
    const second = await svc.applyOrderRestore("org-1", "order-1", "order_returned");
    expect(second.restored).toBe(0);
    expect(globalOf(prisma, p.id)).toBe(20);
    expectInvariant(prisma, p.id);
  });

  it("refusals: no active allocations → Bengali BadRequest; unknown warehouse → 404; inactive warehouse → BadRequest", async () => {
    const { prisma, svc, wh2 } = await placedFixture();
    await expect(svc.reallocateOrderBins("org-1", "order-none", wh2.id, "owner-1"))
      .rejects.toThrow(/সক্রিয় স্টক বরাদ্দ নেই/);
    await expect(svc.reallocateOrderBins("org-1", "order-1", "wh-nope", "owner-1"))
      .rejects.toThrow(/not found/i);
    prisma.warehouse.rows.find((w: any) => w.id === wh2.id).active = false;
    await expect(svc.reallocateOrderBins("org-1", "order-1", wh2.id, "owner-1"))
      .rejects.toThrow(/নিষ্ক্রিয়/);
  });
});

describe("AB3 edit delta (§5.2)", () => {
  it("positive delta draws more and extends allocations; negative credits allocation bins and shrinks them", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    const wh = seedWarehouse(prisma, { isDefault: true });
    const bin = seedBin(prisma, wh.id, "A-01");
    seedBalance(prisma, { productId: p.id, binId: bin.id, onHand: 20 });
    await svc.applyOrderPlaced("org-1", "order-1", { items: [{ productId: p.id, quantity: 5 }] });

    const up = await svc.applyOrderEditDelta("org-1", "order-1", [{ productId: p.id, sku: "PN-1", deltaQty: 3 }]);
    expect(up).toEqual({ adjusted: 1, skipped: 0 });
    expect(globalOf(prisma, p.id)).toBe(12);
    expect(balanceAt(prisma, p.id, bin.id)?.onHand).toBe(12);
    expect(activeAllocations(prisma, "order-1").reduce((s: number, a: any) => s + a.qty, 0)).toBe(8);
    const editMv = prisma.stockMovement.rows.find((m: any) => m.reason === "order_edit");
    expect(editMv).toMatchObject({ delta: -3, binId: bin.id });
    expectInvariant(prisma, p.id);

    const down = await svc.applyOrderEditDelta("org-1", "order-1", [{ productId: p.id, sku: "PN-1", deltaQty: -2 }]);
    expect(down.adjusted).toBe(1);
    expect(globalOf(prisma, p.id)).toBe(14);
    expect(balanceAt(prisma, p.id, bin.id)?.onHand).toBe(14);
    expect(activeAllocations(prisma, "order-1").reduce((s: number, a: any) => s + a.qty, 0)).toBe(6);
    expectInvariant(prisma, p.id);

    // Cancel now restores exactly the NET sold qty (5 + 3 − 2).
    await svc.applyOrderRestore("org-1", "order-1", "order_cancelled");
    expect(globalOf(prisma, p.id)).toBe(20);
    expect(balanceAt(prisma, p.id, bin.id)?.onHand).toBe(20);
    expectInvariant(prisma, p.id);
  });

  it("a negative edit releases the NEWEST allocation first (reverse order)", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 13 });
    const whA = seedWarehouse(prisma, { priority: 0, isDefault: true });
    const binA = seedBin(prisma, whA.id, "A-01");
    const whB = seedWarehouse(prisma, { priority: 1 });
    const binB = seedBin(prisma, whB.id, "B-01");
    seedBalance(prisma, { productId: p.id, binId: binA.id, onHand: 3 });
    seedBalance(prisma, { productId: p.id, binId: binB.id, onHand: 10 });
    await svc.applyOrderPlaced("org-1", "order-1", { items: [{ productId: p.id, quantity: 5 }] }); // A:3 then B:2
    await svc.applyOrderEditDelta("org-1", "order-1", [{ productId: p.id, sku: "PN-1", deltaQty: -2 }]);
    const allocs = activeAllocations(prisma, "order-1");
    expect(allocs).toHaveLength(1);
    expect(allocs[0]).toMatchObject({ binId: binA.id, qty: 3 }); // B's newer claim released first
    expect(balanceAt(prisma, p.id, binB.id)?.onHand).toBe(10);
    expect(globalOf(prisma, p.id)).toBe(10);
    expectInvariant(prisma, p.id);
  });
});

describe("AB3 recordStockTransfer surgery (§5.2)", () => {
  it("allocations move to the to-order on the same bins; balances never move; each side's cancel restores its own net", async () => {
    const { prisma, svc } = setup();
    const p = await seedProduct(prisma, { stockQuantity: 20 });
    const wh = seedWarehouse(prisma, { isDefault: true });
    const bin = seedBin(prisma, wh.id, "A-01");
    seedBalance(prisma, { productId: p.id, binId: bin.id, onHand: 20 });
    await svc.applyOrderPlaced("org-1", "order-A", { items: [{ productId: p.id, quantity: 5 }] });
    expect(balanceAt(prisma, p.id, bin.id)?.onHand).toBe(15);

    const out = await svc.recordStockTransfer("org-1", "order-A", "order-B", [
      { productId: p.id, sku: "PN-1", quantity: 2 },
    ]);
    expect(out).toEqual({ recorded: 1, skipped: 0 });
    expect(globalOf(prisma, p.id)).toBe(15);
    expect(balanceAt(prisma, p.id, bin.id)?.onHand).toBe(15); // balances do NOT move
    expect(activeAllocations(prisma, "order-A").reduce((s: number, a: any) => s + a.qty, 0)).toBe(3);
    const bAllocs = activeAllocations(prisma, "order-B");
    expect(bAllocs).toHaveLength(1);
    expect(bAllocs[0]).toMatchObject({ binId: bin.id, qty: 2 });
    const from = prisma.stockMovement.rows.find((m: any) => m.orderId === "order-A" && m.reason === "order_edit");
    const to = prisma.stockMovement.rows.find((m: any) => m.orderId === "order-B" && m.reason === "order_placed");
    expect(from.binId).toBe(bin.id);
    expect(to.binId).toBe(bin.id);
    expectInvariant(prisma, p.id);

    await svc.applyOrderRestore("org-1", "order-B", "order_cancelled");
    expect(globalOf(prisma, p.id)).toBe(17);
    expect(balanceAt(prisma, p.id, bin.id)?.onHand).toBe(17);
    await svc.applyOrderRestore("org-1", "order-A", "order_cancelled");
    expect(globalOf(prisma, p.id)).toBe(20);
    expect(balanceAt(prisma, p.id, bin.id)?.onHand).toBe(20);
    expectInvariant(prisma, p.id);
    expect(activeAllocations(prisma, "order-A")).toHaveLength(0);
    expect(activeAllocations(prisma, "order-B")).toHaveLength(0);
  });
});

