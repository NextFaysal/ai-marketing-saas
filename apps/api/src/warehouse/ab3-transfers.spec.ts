import { WarehouseService } from "./warehouse.service";
import { StockTransfersService } from "./stock-transfers.service";
import { InventoryService } from "../inventory/inventory.service";

/**
 * AB3 slice 3 — warehouse surfaces + transfers specs.
 *
 * Harness: the warehouse.spec / ab3-multi-warehouse makeTable
 * style, EXTENDED with the AB3 tables (stockBalance,
 * stockAllocation, stockReservation, stockTransfer,
 * stockTransferLine) + a $transaction passthrough, so the bin
 * layer is ACTIVE and the REAL InventoryService performs every
 * stock write (single-writer discipline is asserted, not
 * mocked).
 *
 * The invariant (design §3 + §6 extended form):
 * - no transfer in transit: Σ StockBalance.onHand == global;
 * - while in_transit: Σ balances + Σ in-transit outstanding ==
 *   global;
 * - after a receive WITH VARIANCE the transfer is closed, so
 *   nothing is in transit any more and the variance units are
 *   GONE from every balance: Σ balances == global − variance.
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
    warehouse: makeTable("warehouse"), binLocation: makeTable("bin"),
    productBinAssignment: makeTable("assignment"),
    stockCountSession: makeTable("session"), stockCountLine: makeTable("line"),
    product: makeTable("product"), productVariant: makeTable("variant"),
    stockMovement: makeTable("movement"),
    stockBalance: makeTable("balance"), stockAllocation: makeTable("allocation"),
    stockReservation: makeTable("reservation"),
    stockTransfer: makeTable("transfer"), stockTransferLine: makeTable("tline"),
    order: makeTable("order"), orderItem: makeTable("item"), customer: makeTable("customer"),
    membership: makeTable("membership"), agentNotification: makeTable("notif"),
    auditLog: makeTable("audit"),
  };
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
  const inventory = new InventoryService(prisma as any, audit);
  const warehouse = new WarehouseService(prisma as any, audit, inventory);
  const transfers = new StockTransfersService(prisma as any, audit, inventory);
  return { prisma, audit, inventory, warehouse, transfers };
}

async function seedProduct(prisma: any, over: Record<string, unknown> = {}) {
  return prisma.product.create({
    data: {
      organizationId: "org-1", name: "Panjabi", sku: "PN-1", priceMinor: 100000n,
      stockQuantity: 20, lowStockThreshold: null, ...over,
    },
  });
}

/** Two warehouses, one bin each: wh1 (default) binA, wh2 binB. */
async function seedWarehouses(warehouse: WarehouseService) {
  const wh1 = await warehouse.createWarehouse("org-1", "u1", { name: "Main Warehouse", isDefault: true });
  const binA = await warehouse.createBin("org-1", "u1", wh1.id, { code: "A-01" });
  const wh2 = await warehouse.createWarehouse("org-1", "u1", { name: "Second Warehouse" });
  const binB = await warehouse.createBin("org-1", "u1", wh2.id, { code: "B-01" });
  return { wh1, binA, wh2, binB };
}

function sumBalances(prisma: any, productId: string, variantId: string | null = null): number {
  return prisma.stockBalance.rows
    .filter((b: any) => b.productId === productId && (b.variantId ?? null) === variantId)
    .reduce((s: number, b: any) => s + b.onHand, 0);
}

function binOnHand(prisma: any, binId: string, productId: string, variantId: string | null = null): number {
  const row = prisma.stockBalance.rows.find(
    (b: any) => b.binId === binId && b.productId === productId && (b.variantId ?? null) === variantId,
  );
  return row?.onHand ?? 0;
}

/** Σ outstanding (qtySent − qtyReceived) over in_transit transfers. */
function inTransitOutstanding(prisma: any): number {
  const ids = new Set(
    prisma.stockTransfer.rows.filter((t: any) => t.status === "in_transit").map((t: any) => t.id),
  );
  return prisma.stockTransferLine.rows
    .filter((l: any) => ids.has(l.transferId))
    .reduce((s: number, l: any) => s + (l.qtySent - (l.qtyReceived ?? 0)), 0);
}

function globalOf(prisma: any, productId: string): number {
  return prisma.product.rows.find((p: any) => p.id === productId).stockQuantity;
}

// ---------- warehouse settings (priority + serviceDistricts) ----------

describe("AB3 warehouse settings", () => {
  it("priority + serviceDistricts persist (canonicalized), list carries them, unknown district rejected", async () => {
    const { prisma, warehouse } = setup();
    const wh = await warehouse.createWarehouse("org-1", "u1", {
      name: "Dhaka Hub", priority: 2, serviceDistricts: ["dhaka", "খুলনা"],
    });
    expect(wh.priority).toBe(2);
    // Canonical English names are stored (bn + case variants resolve).
    expect(wh.serviceDistricts).toEqual(["Dhaka", "Khulna"]);

    const list = await warehouse.listWarehouses("org-1");
    expect(list.items[0]).toMatchObject({ priority: 2, serviceDistricts: ["Dhaka", "Khulna"] });

    await expect(warehouse.createWarehouse("org-1", "u1", { name: "Bad", serviceDistricts: ["Narnia"] }))
      .rejects.toThrow(/অজানা জেলা/);
    await expect(warehouse.updateWarehouse("org-1", "u1", wh.id, { serviceDistricts: ["Atlantis"] }))
      .rejects.toThrow(/অজানা জেলা/);
    await expect(warehouse.updateWarehouse("org-1", "u1", wh.id, { priority: -1 }))
      .rejects.toThrow(/অগ্রাধিকার/);

    const updated = await warehouse.updateWarehouse("org-1", "u1", wh.id, { priority: 1, serviceDistricts: [] });
    expect(updated.priority).toBe(1);
    expect(updated.serviceDistricts).toEqual([]);
    const cleared = await warehouse.updateWarehouse("org-1", "u1", wh.id, { serviceDistricts: null });
    expect(cleared.serviceDistricts).toBeNull();
    expect(prisma.warehouse.rows).toHaveLength(1); // the rejected create wrote nothing
  });
});

// ---------- transfer lifecycle ----------

describe("AB3 stock transfers — lifecycle", () => {
  it("create → dispatch → PARTIAL receive with variance: global never moves; Σ == global − variance after close", async () => {
    const s = setup();
    const { binA, binB } = await seedWarehouses(s.warehouse);
    const p = await seedProduct(s.prisma, { stockQuantity: 20 });
    await s.inventory.backfillStockBalances("org-1"); // 20 → default bin (binA)
    expect(binOnHand(s.prisma, binA.id, p.id)).toBe(20);
    expect(sumBalances(s.prisma, p.id)).toBe(globalOf(s.prisma, p.id));

    const created = await s.transfers.createTransfer("org-1", "u1", {
      fromBinId: binA.id, toBinId: binB.id,
      lines: [{ productId: p.id, qtySent: 8 }],
    });
    expect(created.status).toBe("draft");
    expect(created).toMatchObject({ fromBinCode: "A-01", toBinCode: "B-01", lineCount: 1, totalQtySent: 8 });
    expect(binOnHand(s.prisma, binA.id, p.id)).toBe(20); // draft moves nothing

    const dispatched = await s.transfers.dispatchTransfer("org-1", "u1", created.id);
    expect(dispatched.status).toBe("in_transit");
    expect(dispatched.dispatchedAt).toBeTruthy();
    expect(binOnHand(s.prisma, binA.id, p.id)).toBe(12);
    expect(globalOf(s.prisma, p.id)).toBe(20); // transfers NEVER touch the global
    // Extended invariant while in transit:
    expect(sumBalances(s.prisma, p.id) + inTransitOutstanding(s.prisma)).toBe(globalOf(s.prisma, p.id));
    // Stock-by-location sees the in-transit qty on the FROM warehouse.
    const byLoc = await s.warehouse.stockByLocation("org-1");
    const wh1Row = byLoc.items.find((r: any) => r.productId === p.id && r.warehouseName === "Main Warehouse");
    expect(wh1Row).toMatchObject({ onHand: 12, inTransitOut: 8 });
    expect(byLoc.orgTotals.totalInTransit).toBe(8);

    const lineId = dispatched.lines[0].id;
    const received = await s.transfers.receiveTransfer("org-1", "u1", created.id, {
      lines: [{ lineId, qtyReceived: 5 }],
    });
    expect(received.status).toBe("received_with_variance");
    expect(received.lines[0].qtyReceived).toBe(5);
    expect(received.varianceQty).toBe(3);
    expect(binOnHand(s.prisma, binB.id, p.id)).toBe(5);
    expect(globalOf(s.prisma, p.id)).toBe(20);
    // After a variance receive the transfer is CLOSED — nothing
    // is in transit, and the 3 variance units are gone from every
    // balance (recorded on the line, returned to NO bin):
    //   Σ balances == global − variance   (17 == 20 − 3)
    expect(inTransitOutstanding(s.prisma)).toBe(0);
    expect(sumBalances(s.prisma, p.id)).toBe(globalOf(s.prisma, p.id) - 3);

    const actions = s.prisma.auditLog.rows.map((a: any) => a.action);
    expect(actions).toContain("stock_transfer.created");
    expect(actions).toContain("stock_transfer.dispatched");
    const recvAudit = s.prisma.auditLog.rows.find((a: any) => a.action === "stock_transfer.received");
    expect(recvAudit.metadata).toMatchObject({ varianceTotal: 3, totalReceived: 5 });
    // Movements explain both legs, global balanceAfter unchanged.
    const outs = s.prisma.stockMovement.rows.filter((m: any) => m.reason === "transfer_out");
    const ins = s.prisma.stockMovement.rows.filter((m: any) => m.reason === "transfer_in");
    expect(outs).toHaveLength(1);
    expect(outs[0]).toMatchObject({ delta: -8, binId: binA.id, balanceAfter: 20, note: `transfer:${created.id}` });
    expect(ins).toHaveLength(1);
    expect(ins[0]).toMatchObject({ delta: 5, binId: binB.id, balanceAfter: 20 });
  });

  it("full receive (lines omitted → default qtySent): status received, Σ == global", async () => {
    const s = setup();
    const { binA, binB } = await seedWarehouses(s.warehouse);
    const p = await seedProduct(s.prisma, { stockQuantity: 10 });
    await s.inventory.backfillStockBalances("org-1");
    const created = await s.transfers.createTransfer("org-1", "u1", {
      fromBinId: binA.id, toBinId: binB.id, lines: [{ productId: p.id, qtySent: 4 }],
    });
    await s.transfers.dispatchTransfer("org-1", "u1", created.id);
    const received = await s.transfers.receiveTransfer("org-1", "u1", created.id, {});
    expect(received.status).toBe("received");
    expect(received.lines[0].qtyReceived).toBe(4);
    expect(binOnHand(s.prisma, binA.id, p.id)).toBe(6);
    expect(binOnHand(s.prisma, binB.id, p.id)).toBe(4);
    expect(sumBalances(s.prisma, p.id)).toBe(globalOf(s.prisma, p.id));
  });

  it("variant lines transfer against the VARIANT row only (no product fallback)", async () => {
    const s = setup();
    const { binA, binB } = await seedWarehouses(s.warehouse);
    const p = await seedProduct(s.prisma, { stockQuantity: 999 });
    const v = await s.prisma.productVariant.create({
      data: { productId: p.id, name: "XL", sku: "PN-1-XL", stockQuantity: 7 },
    });
    await s.inventory.backfillStockBalances("org-1");
    const created = await s.transfers.createTransfer("org-1", "u1", {
      fromBinId: binA.id, toBinId: binB.id,
      lines: [{ productId: p.id, variantId: v.id, qtySent: 2 }],
    });
    await s.transfers.dispatchTransfer("org-1", "u1", created.id);
    const received = await s.transfers.receiveTransfer("org-1", "u1", created.id, {});
    expect(received.status).toBe("received");
    expect(received.lines[0]).toMatchObject({ variantName: "XL", productName: "Panjabi" });
    expect(binOnHand(s.prisma, binB.id, p.id, v.id)).toBe(2);
    expect(sumBalances(s.prisma, p.id, v.id)).toBe(7);
    expect(s.prisma.productVariant.rows.find((x: any) => x.id === v.id).stockQuantity).toBe(7);
    expect(globalOf(s.prisma, p.id)).toBe(999); // product row untouched by a variant transfer
  });

  it("cancel from draft moves nothing; cancel from in_transit returns the units to the fromBin", async () => {
    const s = setup();
    const { binA, binB } = await seedWarehouses(s.warehouse);
    const p = await seedProduct(s.prisma, { stockQuantity: 10 });
    await s.inventory.backfillStockBalances("org-1");

    const draft = await s.transfers.createTransfer("org-1", "u1", {
      fromBinId: binA.id, toBinId: binB.id, lines: [{ productId: p.id, qtySent: 3 }],
    });
    const cancelledDraft = await s.transfers.cancelTransfer("org-1", "u1", draft.id);
    expect(cancelledDraft.status).toBe("cancelled");
    expect(s.prisma.stockMovement.rows.filter((m: any) => m.reason.startsWith("transfer"))).toHaveLength(0);
    expect(binOnHand(s.prisma, binA.id, p.id)).toBe(10);

    const t2 = await s.transfers.createTransfer("org-1", "u1", {
      fromBinId: binA.id, toBinId: binB.id, lines: [{ productId: p.id, qtySent: 4 }],
    });
    await s.transfers.dispatchTransfer("org-1", "u1", t2.id);
    expect(binOnHand(s.prisma, binA.id, p.id)).toBe(6);
    const cancelled = await s.transfers.cancelTransfer("org-1", "u1", t2.id);
    expect(cancelled.status).toBe("cancelled");
    expect(binOnHand(s.prisma, binA.id, p.id)).toBe(10);
    expect(sumBalances(s.prisma, p.id)).toBe(globalOf(s.prisma, p.id));
    const back = s.prisma.stockMovement.rows.filter(
      (m: any) => m.reason === "transfer_in" && m.note === `transfer:${t2.id} cancel`,
    );
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ delta: 4, binId: binA.id });
  });

  it("over-draw dispatch is refused WHOLE (nothing moves, still draft); the pre-check seeds an unseeded row at its default bin", async () => {
    const s = setup();
    const { binA, binB, wh1 } = await seedWarehouses(s.warehouse);
    void wh1;
    const p = await seedProduct(s.prisma, { stockQuantity: 10 });
    // Hand-distributed: binA holds only 3 of the 10 (binB holds 7).
    await s.prisma.stockBalance.create({ data: { organizationId: "org-1", productId: p.id, variantId: null, binId: binA.id, onHand: 3, reserved: 0 } });
    await s.prisma.stockBalance.create({ data: { organizationId: "org-1", productId: p.id, variantId: null, binId: binB.id, onHand: 7, reserved: 0 } });
    const t = await s.transfers.createTransfer("org-1", "u1", {
      fromBinId: binA.id, toBinId: binB.id, lines: [{ productId: p.id, qtySent: 5 }],
    });
    await expect(s.transfers.dispatchTransfer("org-1", "u1", t.id))
      .rejects.toThrow(/「Panjabi」.*পর্যাপ্ত স্টক নেই/);
    expect(binOnHand(s.prisma, binA.id, p.id)).toBe(3);
    expect(binOnHand(s.prisma, binB.id, p.id)).toBe(7);
    expect(s.prisma.stockMovement.rows.filter((m: any) => m.reason === "transfer_out")).toHaveLength(0);
    const view = await s.transfers.getTransfer("org-1", t.id);
    expect(view.status).toBe("draft");

    // Unseeded tracked row: dispatch pre-check seeds the balance
    // at the DEFAULT bin — a transfer FROM the other bin then
    // still refuses (its own balance is 0), and nothing moved.
    const p2 = await seedProduct(s.prisma, { name: "Fresh", sku: "FR-1", stockQuantity: 6 });
    const t2 = await s.transfers.createTransfer("org-1", "u1", {
      fromBinId: binB.id, toBinId: binA.id, lines: [{ productId: p2.id, qtySent: 2 }],
    });
    await expect(s.transfers.dispatchTransfer("org-1", "u1", t2.id)).rejects.toThrow(/পর্যাপ্ত স্টক নেই/);
    expect(binOnHand(s.prisma, binA.id, p2.id)).toBe(6); // seeded at the default bin by the pre-check
    expect(sumBalances(s.prisma, p2.id)).toBe(6);
  });

  it("state refusals: receive on draft, dispatch on in_transit, cancel on received, receive qty > sent", async () => {
    const s = setup();
    const { binA, binB } = await seedWarehouses(s.warehouse);
    const p = await seedProduct(s.prisma, { stockQuantity: 10 });
    await s.inventory.backfillStockBalances("org-1");
    const t = await s.transfers.createTransfer("org-1", "u1", {
      fromBinId: binA.id, toBinId: binB.id, lines: [{ productId: p.id, qtySent: 4 }],
    });
    await expect(s.transfers.receiveTransfer("org-1", "u1", t.id, {})).rejects.toThrow(/in_transit/);
    await s.transfers.dispatchTransfer("org-1", "u1", t.id);
    await expect(s.transfers.dispatchTransfer("org-1", "u1", t.id)).rejects.toThrow(/draft/);
    const lineId = (await s.transfers.getTransfer("org-1", t.id)).lines[0].id;
    await expect(s.transfers.receiveTransfer("org-1", "u1", t.id, { lines: [{ lineId, qtyReceived: 5 }] }))
      .rejects.toThrow(/০–4/);
    // The refused receive moved nothing.
    expect(binOnHand(s.prisma, binB.id, p.id)).toBe(0);
    await s.transfers.receiveTransfer("org-1", "u1", t.id, {});
    await expect(s.transfers.cancelTransfer("org-1", "u1", t.id)).rejects.toThrow(/বাতিল করা যাবে না/);
  });

  it("create validation: untracked row, duplicate lines, same-bin, bad qty — all Bengali refusals, nothing persisted", async () => {
    const s = setup();
    const { binA, binB } = await seedWarehouses(s.warehouse);
    const tracked = await seedProduct(s.prisma, { stockQuantity: 5 });
    const untracked = await seedProduct(s.prisma, { name: "Loose", sku: "LO-1", stockQuantity: null });
    await expect(s.transfers.createTransfer("org-1", "u1", {
      fromBinId: binA.id, toBinId: binB.id, lines: [{ productId: untracked.id, qtySent: 1 }],
    })).rejects.toThrow(/স্টক ট্র্যাক করা হচ্ছে না/);
    await expect(s.transfers.createTransfer("org-1", "u1", {
      fromBinId: binA.id, toBinId: binB.id,
      lines: [{ productId: tracked.id, qtySent: 1 }, { productId: tracked.id, qtySent: 2 }],
    })).rejects.toThrow(/একই পণ্যের একাধিক লাইন/);
    await expect(s.transfers.createTransfer("org-1", "u1", {
      fromBinId: binA.id, toBinId: binA.id, lines: [{ productId: tracked.id, qtySent: 1 }],
    })).rejects.toThrow(/একই বিনে/);
    await expect(s.transfers.createTransfer("org-1", "u1", {
      fromBinId: binA.id, toBinId: binB.id, lines: [{ productId: tracked.id, qtySent: 0 }],
    })).rejects.toThrow(/qtySent/);
    expect(s.prisma.stockTransfer.rows).toHaveLength(0);

    const list = await s.transfers.listTransfers("org-1");
    expect(list.items).toHaveLength(0);
    const ok = await s.transfers.createTransfer("org-1", "u1", {
      fromBinId: binA.id, toBinId: binB.id, note: "rebalance", lines: [{ productId: tracked.id, qtySent: 2 }],
    });
    const listed = await s.transfers.listTransfers("org-1");
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({
      id: ok.id, status: "draft", fromBinCode: "A-01", toWarehouseName: "Second Warehouse",
      lineCount: 1, totalQtySent: 2,
    });
    expect(listed.items[0].lines).toBeUndefined(); // list is the summary shape
  });
});

// ---------- bin-scoped stock counts ----------

describe("AB3 bin-scoped stock counts", () => {
  it("bin scope: lines = balances ∪ assignments in that bin, systemQty = bin onHand; close posts the VARIANCE to that bin only", async () => {
    const s = setup();
    const { wh1, binA, binB } = await (async () => {
      const wh1 = await s.warehouse.createWarehouse("org-1", "u1", { name: "Main Warehouse", isDefault: true });
      const binA = await s.warehouse.createBin("org-1", "u1", wh1.id, { code: "A-01" });
      const binB = await s.warehouse.createBin("org-1", "u1", wh1.id, { code: "A-02" });
      return { wh1, binA, binB };
    })();
    const p = await seedProduct(s.prisma, { stockQuantity: 20 });
    const q = await seedProduct(s.prisma, { name: "Kurti", sku: "KU-1", stockQuantity: 5 });
    const r = await seedProduct(s.prisma, { name: "Sari", sku: "SA-1", stockQuantity: 9 });
    // Distribution: P 12 in binA + 8 in binB; R only in binB; Q
    // assigned to binA but with NO balance row there (holds 0).
    await s.prisma.stockBalance.create({ data: { organizationId: "org-1", productId: p.id, variantId: null, binId: binA.id, onHand: 12, reserved: 0 } });
    await s.prisma.stockBalance.create({ data: { organizationId: "org-1", productId: p.id, variantId: null, binId: binB.id, onHand: 8, reserved: 0 } });
    await s.prisma.stockBalance.create({ data: { organizationId: "org-1", productId: r.id, variantId: null, binId: binB.id, onHand: 9, reserved: 0 } });
    await s.warehouse.upsertAssignment("org-1", "u1", { warehouseId: wh1.id, binLocationId: binA.id, productId: q.id });

    const created = await s.warehouse.createStockCount("org-1", "u1", { warehouseId: wh1.id, binLocationId: binA.id });
    expect(created.scope).toBe("bin");
    expect(created.binId).toBe(binA.id);
    expect(created.binCode).toBe("A-01");
    expect(created.lines).toHaveLength(2);
    expect(created.lines.find((l: any) => l.productId === p.id).systemQty).toBe(12); // the BIN's onHand, not the global 20
    expect(created.lines.find((l: any) => l.productId === q.id).systemQty).toBe(0); // assignment-only ⇒ 0 in this bin
    expect(created.lines.some((l: any) => l.productId === r.id)).toBe(false);

    const lineP = created.lines.find((l: any) => l.productId === p.id);
    const lineQ = created.lines.find((l: any) => l.productId === q.id);
    await s.warehouse.setCountedQty("org-1", "u1", created.id, lineP.id, 10); // variance −2
    await s.warehouse.setCountedQty("org-1", "u1", created.id, lineQ.id, 3); // variance +3
    const result = await s.warehouse.closeStockCount("org-1", "u1", created.id);
    expect(result.applied).toHaveLength(2);

    // Only binA (and the globals, by the same variance) moved.
    expect(binOnHand(s.prisma, binA.id, p.id)).toBe(10);
    expect(binOnHand(s.prisma, binB.id, p.id)).toBe(8);
    expect(globalOf(s.prisma, p.id)).toBe(18);
    expect(sumBalances(s.prisma, p.id)).toBe(globalOf(s.prisma, p.id));
    expect(globalOf(s.prisma, q.id)).toBe(8);
    expect(sumBalances(s.prisma, q.id)).toBe(8);
    expect(globalOf(s.prisma, r.id)).toBe(9); // untouched

    const countMovements = s.prisma.stockMovement.rows.filter((m: any) => m.reason === "stock_count");
    expect(countMovements.find((m: any) => m.productId === p.id)).toMatchObject({ delta: -2, binId: binA.id });
  });

  it("warehouse scope keeps the legacy behaviour: global snapshot, close lands the counted value", async () => {
    const s = setup();
    const { wh1, binA } = await (async () => {
      const wh1 = await s.warehouse.createWarehouse("org-1", "u1", { name: "Main Warehouse", isDefault: true });
      const binA = await s.warehouse.createBin("org-1", "u1", wh1.id, { code: "A-01" });
      return { wh1, binA };
    })();
    const p = await seedProduct(s.prisma, { stockQuantity: 20 });
    await s.inventory.backfillStockBalances("org-1"); // 20 at the default bin
    const created = await s.warehouse.createStockCount("org-1", "u1", { warehouseId: wh1.id });
    expect(created.scope).toBe("warehouse");
    expect(created.binId).toBeNull();
    const line = created.lines.find((l: any) => l.productId === p.id);
    expect(line.systemQty).toBe(20); // GLOBAL snapshot, as EC21
    await s.warehouse.setCountedQty("org-1", "u1", created.id, line.id, 15);
    await s.warehouse.closeStockCount("org-1", "u1", created.id);
    expect(globalOf(s.prisma, p.id)).toBe(15);
    expect(binOnHand(s.prisma, binA.id, p.id)).toBe(15); // default bin absorbed the delta
    expect(sumBalances(s.prisma, p.id)).toBe(globalOf(s.prisma, p.id));
  });
});

// ---------- balances endpoint ----------

describe("AB3 stock balances read", () => {
  it("seeded:false synthesis for an unseeded tracked product + live reserved correction (persisted)", async () => {
    const s = setup();
    const { binA } = await seedWarehouses(s.warehouse);
    const p1 = await seedProduct(s.prisma, { stockQuantity: 20 });
    await s.prisma.stockBalance.create({
      data: { organizationId: "org-1", productId: p1.id, variantId: null, binId: binA.id, onHand: 20, reserved: 0 },
    });
    // Active unexpired reservation of 3 on binA + an EXPIRED one
    // of 4 (lazy expiry: must not count).
    await s.prisma.stockReservation.create({
      data: {
        organizationId: "org-1", sessionRef: "cart-1", productId: p1.id, variantId: null,
        binId: binA.id, quantity: 3, state: "active", expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    await s.prisma.stockReservation.create({
      data: {
        organizationId: "org-1", sessionRef: "cart-2", productId: p1.id, variantId: null,
        binId: binA.id, quantity: 4, state: "active", expiresAt: new Date(Date.now() - 3600_000),
      },
    });
    const p2 = await seedProduct(s.prisma, { name: "Unseeded", sku: "UN-1", stockQuantity: 9 });

    const out = await s.warehouse.listStockBalances("org-1");
    const row1 = out.items.find((r: any) => r.productId === p1.id);
    expect(row1).toMatchObject({
      productName: "Panjabi", sku: "PN-1", binCode: "A-01", warehouseName: "Main Warehouse",
      onHand: 20, reserved: 3, seeded: true,
    });
    // The lazy correction PERSISTED (§3).
    expect(s.prisma.stockBalance.rows.find((b: any) => b.productId === p1.id).reserved).toBe(3);

    const row2 = out.items.find((r: any) => r.productId === p2.id);
    expect(row2).toMatchObject({ onHand: 9, seeded: false, binCode: "A-01" }); // resolved default bin
    expect(out.orgTotals.totalOnHand).toBe(29);
    // A read never seeds: p2 still has NO balance row.
    expect(s.prisma.stockBalance.rows.some((b: any) => b.productId === p2.id)).toBe(false);
  });

  it("stock-by-location.csv: header + rows with in_transit_out", async () => {
    const s = setup();
    const { binA, binB } = await seedWarehouses(s.warehouse);
    const p = await seedProduct(s.prisma, { stockQuantity: 20 });
    await s.inventory.backfillStockBalances("org-1");
    const t = await s.transfers.createTransfer("org-1", "u1", {
      fromBinId: binA.id, toBinId: binB.id, lines: [{ productId: p.id, qtySent: 8 }],
    });
    await s.transfers.dispatchTransfer("org-1", "u1", t.id);
    const csv = await s.warehouse.stockByLocationCsv("org-1");
    const lines = csv.split("\n");
    expect(lines[0]).toBe("product,variant,warehouse,on_hand,reserved,in_transit_out");
    expect(lines).toContain("Panjabi,,Main Warehouse,12,0,8");
  });
});
