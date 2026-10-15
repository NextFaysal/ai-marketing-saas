import { FulfillmentService } from "./fulfillment.service";

/**
 * EC21 — dispatch board bin enrichment.
 *
 * Fake Prisma in the ec9.spec.ts makeTable style. Board lines
 * gain a binCode resolved in the org's default active warehouse
 * (variant-exact assignment first, then product-level), sorted
 * by binCode ascending with "—" LAST (walk order). Any bin-table
 * problem degrades to all "—" in the original order — the board
 * must never break.
 */
function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) { if (!(v as any).in.includes(row[k])) return false; continue; }
      return false;
    } else if (row[k] !== v) return false;
  }
  return true;
}
function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matchWhere(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where)),
    create: async ({ data }: any) => { const row = { id: data.id ?? `row-${++seq}`, createdAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return row;
    },
  };
}

const ITEMS = [
  { id: "oi1", orderId: "o1", productId: "p2", name: "P2 item", sku: "P2", quantity: 1 },
  { id: "oi2", orderId: "o1", productId: "p1", name: "P1 variant item", sku: "P1-XL", quantity: 1 },
  { id: "oi3", orderId: "o1", productId: "p3", name: "No-bin item", sku: "P3", quantity: 1 },
  { id: "oi4", orderId: "o1", productId: "p1", name: "P1 fallback item", sku: "OTHER", quantity: 1 },
];

function basePrisma(withWarehouseTables: boolean) {
  const prisma: any = {
    order: makeTable(), fulfillment: makeTable(),
  };
  if (withWarehouseTables) {
    prisma.warehouse = makeTable();
    prisma.binLocation = makeTable();
    prisma.productBinAssignment = makeTable();
    prisma.productVariant = makeTable();
  }
  prisma.order.rows.push({
    id: "o1", organizationId: "org-1", externalNumber: "1001", status: "processing",
    items: ITEMS,
  });
  prisma.fulfillment.rows.push({
    id: "f1", organizationId: "org-1", orderId: "o1", status: "pending",
    items: ITEMS.map((i) => ({ orderItemId: i.id, quantity: 1, packed: false })),
    createdAt: new Date(),
  });
  return prisma;
}

function seedBins(prisma: any) {
  prisma.warehouse.rows.push(
    { id: "wh-old", organizationId: "org-1", name: "Old", isDefault: false, active: true, createdAt: new Date(Date.now() - 10000) },
    { id: "wh-1", organizationId: "org-1", name: "Main", isDefault: true, active: true, createdAt: new Date() },
  );
  prisma.binLocation.rows.push(
    { id: "bin-a", organizationId: "org-1", warehouseId: "wh-1", code: "A-01" },
    { id: "bin-b", organizationId: "org-1", warehouseId: "wh-1", code: "B-02" },
    { id: "bin-old", organizationId: "org-1", warehouseId: "wh-old", code: "Z-99" },
  );
  prisma.productVariant.rows.push({ id: "v1", productId: "p1", name: "XL", sku: "P1-XL", stockQuantity: 5 });
  prisma.productBinAssignment.rows.push(
    // variant-exact for p1/XL -> B-02
    { id: "as1", organizationId: "org-1", warehouseId: "wh-1", binLocationId: "bin-b", productId: "p1", variantId: "v1" },
    // product-level for p1 -> A-01 (fallback when sku resolves no variant)
    { id: "as2", organizationId: "org-1", warehouseId: "wh-1", binLocationId: "bin-a", productId: "p1", variantId: null },
    // product-level for p2 -> A-01
    { id: "as3", organizationId: "org-1", warehouseId: "wh-1", binLocationId: "bin-a", productId: "p2", variantId: null },
    // a decoy assignment in the NON-default warehouse — must be ignored
    { id: "as4", organizationId: "org-1", warehouseId: "wh-old", binLocationId: "bin-old", productId: "p3", variantId: null },
  );
}

describe("EC21 board bin enrichment", () => {
  it("lines get their binCode (variant-exact, then product-level fallback) and sort with — last", async () => {
    const prisma = basePrisma(true);
    seedBins(prisma);
    const svc = new FulfillmentService(prisma, { log: async () => undefined } as any, undefined);
    const board = await svc.board("org-1");
    expect(board.total).toBe(1);
    const lines = board.fulfillments[0].lines;
    // Walk order: A-01 lines (original relative order kept),
    // then B-02, then the unassigned line LAST.
    expect(lines.map((l: any) => [l.orderItemId, l.binCode])).toEqual([
      ["oi1", "A-01"], // p2 product-level
      ["oi4", "A-01"], // p1, sku resolves no variant -> product-level fallback
      ["oi2", "B-02"], // p1 variant-exact
      ["oi3", "—"],    // p3: only assigned in the non-default warehouse
    ]);
    // Other board behaviour is untouched.
    expect(board.fulfillments[0]).toMatchObject({ orderNumber: "1001", itemCount: 4 });
    expect(lines[0].name).toBe("P2 item");
  });

  it("no warehouse at all => every line — and the original order is kept", async () => {
    const prisma = basePrisma(true); // tables exist, zero warehouse rows
    const svc = new FulfillmentService(prisma, { log: async () => undefined } as any, undefined);
    const board = await svc.board("org-1");
    const lines = board.fulfillments[0].lines;
    expect(lines.map((l: any) => l.binCode)).toEqual(["—", "—", "—", "—"]);
    expect(lines.map((l: any) => l.orderItemId)).toEqual(["oi1", "oi2", "oi3", "oi4"]);
  });

  it("EC21 tables missing entirely (older deploy) => board still works, all —, original order", async () => {
    const prisma = basePrisma(false);
    const svc = new FulfillmentService(prisma, { log: async () => undefined } as any, undefined);
    const board = await svc.board("org-1");
    expect(board.total).toBe(1);
    const lines = board.fulfillments[0].lines;
    expect(lines.map((l: any) => l.binCode)).toEqual(["—", "—", "—", "—"]);
    expect(lines.map((l: any) => l.orderItemId)).toEqual(["oi1", "oi2", "oi3", "oi4"]);
  });
});
