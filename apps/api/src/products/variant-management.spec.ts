import { ConflictException, NotFoundException } from "@nestjs/common";
import { ApiException } from "../i18n";
import { ProductsService } from "./products.service";
import { InventoryService } from "../inventory/inventory.service";

// Fake Prisma in the inventory.spec makeTable style. Product
// rows carry variants: [] and costs: [] so ProductsService.getOne
// (findFirst with include; the fake returns the row as-is) works.
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v && !v.in.includes(row[k])) return false;
      if ("not" in v) { const ok = v.not === null ? row[k] !== null && row[k] !== undefined : row[k] !== v.not; if (!ok) return false; }
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
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where, take }: any = {}) => {
      const f = rows.filter((r) => matches(r, where ?? {}));
      return take ? f.slice(0, take) : f;
    },
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), ...data };
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
      const i = rows.findIndex((r) => r.id === where.id);
      if (i < 0) throw new Error(`row not found in ${name}: ${where.id}`);
      const [row] = rows.splice(i, 1);
      return row;
    },
  };
}

function fakePrisma() {
  return {
    product: makeTable("product"),
    productVariant: makeTable("variant"),
    stockMovement: makeTable("movement"),
    auditLog: { findFirst: async () => null },
    membership: { findMany: async () => [] },
    agentNotification: makeTable("notif"),
  };
}

const auditStub: any = { log: async () => {} };

function setup() {
  const prisma: any = fakePrisma();
  prisma.product.rows.push(
    { id: "p1", organizationId: "org-1", name: "Shirt", category: "Fashion", priceMinor: 100000n, compareAtMinor: null, stockQuantity: 50, lowStockThreshold: null, variants: [], costs: [] },
    { id: "p2", organizationId: "org-1", name: "Shoes", category: "Fashion", priceMinor: 150000n, compareAtMinor: null, stockQuantity: 20, lowStockThreshold: null, variants: [], costs: [] },
    { id: "p-other-org", organizationId: "org-2", name: "Foreign", category: null, priceMinor: 1000n, compareAtMinor: null, stockQuantity: 1, lowStockThreshold: null, variants: [], costs: [] },
  );
  prisma.productVariant.rows.push(
    { id: "v1", productId: "p1", name: "Red / M", sku: "SHIRT-RED-M", priceMinor: 100000n, stockQuantity: 10 },
    { id: "v2", productId: "p1", name: "Blue / M", sku: "SHIRT-BLUE-M", priceMinor: null, stockQuantity: null },
    { id: "v3", productId: "p2", name: "42", sku: "SHOES-42", priceMinor: null, stockQuantity: 3 },
    { id: "v-foreign", productId: "p-other-org", name: "X", sku: "FX-1", priceMinor: null, stockQuantity: 1 },
  );
  const inventory = new InventoryService(prisma as any, auditStub);
  const svc = new ProductsService(prisma as any, auditStub, inventory);
  return { prisma, svc, inventory };
}

describe("Sales & Data S6 — variant update", () => {
  it("updates name, sku and price (decimal string -> minor string)", async () => {
    const { prisma, svc } = setup();
    const out = await svc.updateVariant("org-1", "actor-1", "p1", "v1", { name: " Red / L ", sku: "SHIRT-RED-L", price: "1200.50" });
    expect(out.name).toBe("Red / L");
    expect(out.sku).toBe("SHIRT-RED-L");
    expect(out.priceMinor).toBe("120050");
    expect(prisma.productVariant.rows.find((v: any) => v.id === "v1").priceMinor).toBe(120050n);
  });

  it("price '' clears the price override to null", async () => {
    const { prisma, svc } = setup();
    const out = await svc.updateVariant("org-1", "actor-1", "p1", "v1", { price: "" });
    expect(out.priceMinor).toBeNull();
    expect(prisma.productVariant.rows.find((v: any) => v.id === "v1").priceMinor).toBeNull();
  });

  it("404s: unknown variant, variant of another product, product of another org", async () => {
    const { svc } = setup();
    await expect(svc.updateVariant("org-1", "actor-1", "p1", "v-nope", { name: "X" })).rejects.toThrow(ApiException);
    await expect(svc.updateVariant("org-1", "actor-1", "p1", "v3", { name: "X" })).rejects.toThrow(ApiException);
    await expect(svc.updateVariant("org-1", "actor-1", "p-other-org", "v-foreign", { name: "X" })).rejects.toThrow(ApiException);
  });

  it("duplicate SKU on the same product conflicts; same SKU on a different product succeeds", async () => {
    const { svc } = setup();
    await expect(svc.updateVariant("org-1", "actor-1", "p1", "v2", { sku: "SHIRT-RED-M" })).rejects.toThrow(ApiException);
    const out = await svc.updateVariant("org-1", "actor-1", "p2", "v3", { sku: "SHIRT-RED-M" });
    expect(out.sku).toBe("SHIRT-RED-M");
    // Keeping its own SKU is not a conflict (self excluded).
    const self = await svc.updateVariant("org-1", "actor-1", "p1", "v1", { sku: "SHIRT-RED-M" });
    expect(self.sku).toBe("SHIRT-RED-M");
  });

  it("tracked variant stock change routes through InventoryService (movement written)", async () => {
    const { prisma, svc } = setup();
    const out = await svc.updateVariant("org-1", "actor-1", "p1", "v1", { stockQuantity: 4 });
    expect(out.stockQuantity).toBe(4);
    expect(prisma.productVariant.rows.find((v: any) => v.id === "v1").stockQuantity).toBe(4);
    expect(prisma.stockMovement.rows).toHaveLength(1);
    expect(prisma.stockMovement.rows[0]).toMatchObject({
      variantId: "v1", productId: "p1", delta: -6, balanceAfter: 4, reason: "manual_adjustment",
    });
  });

  it("untracked variant stock set is a baseline plain write with NO movement", async () => {
    const { prisma, svc } = setup();
    const out = await svc.updateVariant("org-1", "actor-1", "p1", "v2", { stockQuantity: 7 });
    expect(out.stockQuantity).toBe(7);
    expect(prisma.productVariant.rows.find((v: any) => v.id === "v2").stockQuantity).toBe(7);
    expect(prisma.stockMovement.rows).toHaveLength(0);
  });

  it("stock set equal to the current value writes no movement", async () => {
    const { prisma, svc } = setup();
    const out = await svc.updateVariant("org-1", "actor-1", "p1", "v1", { stockQuantity: 10 });
    expect(out.stockQuantity).toBe(10);
    expect(prisma.stockMovement.rows).toHaveLength(0);
  });
});

describe("Sales & Data S6 — variant delete", () => {
  it("deletes the variant and returns the receipt; deleting again 404s", async () => {
    const { prisma, svc } = setup();
    const out = await svc.deleteVariant("org-1", "actor-1", "p1", "v1");
    expect(out).toEqual({ deleted: true, productId: "p1", variantId: "v1" });
    expect(prisma.productVariant.rows.find((v: any) => v.id === "v1")).toBeUndefined();
    await expect(svc.deleteVariant("org-1", "actor-1", "p1", "v1")).rejects.toThrow(ApiException);
  });

  it("404s for a variant of another product and a product of another org", async () => {
    const { svc } = setup();
    await expect(svc.deleteVariant("org-1", "actor-1", "p1", "v3")).rejects.toThrow(ApiException);
    await expect(svc.deleteVariant("org-1", "actor-1", "p-other-org", "v-foreign")).rejects.toThrow(ApiException);
  });
});
