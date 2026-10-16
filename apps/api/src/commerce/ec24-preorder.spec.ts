import { BadRequestException } from "@nestjs/common";
import { InventoryService } from "../inventory/inventory.service";
import { ProductsService } from "../products/products.service";
import { LandingsService } from "../landings/landings.service";
import { StorefrontService } from "../storefront/storefront.service";
import { assertPreorderLimit, openPreorderQty } from "./ec24";

/** EC24a — pre-order specs. Minimal equality-matcher fake prisma. */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(row[k]);
      if ("not" in v) return row[k] !== v.not;
      return matches(row[k] ?? {}, v);
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
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id) ?? rows.find((r) => matches(r, where));
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    },
    deleteMany: async ({ where }: any = {}) => {
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
    auditLog: makeTable("audit"), organization: makeTable("org"),
    businessProfile: makeTable("bp"), shippingZone: makeTable("zone"),
    landingPage: makeTable("landing"), landingVariant: makeTable("lv"),
    bundleItem: makeTable("bundle"),
  } as any;
}
const auditStub: any = { log: jest.fn(async () => undefined) };

function integrationsStub(prisma: any) {
  return {
    upsertOrder: jest.fn(async (orgId: string, _s: any, o: any, source: string) => {
      const order = await prisma.order.create({
        data: {
          organizationId: orgId, source, externalId: o.externalId, externalNumber: o.externalNumber,
          status: o.status, totalMinor: o.totalMinor, subtotalMinor: o.subtotalMinor,
        },
      });
      for (const item of o.items) {
        const prod = item.sku ? await prisma.product.findFirst({ where: { organizationId: orgId, sku: item.sku } }) : null;
        await prisma.orderItem.create({
          data: {
            orderId: order.id, productId: prod?.id ?? null, name: item.name, sku: item.sku ?? null,
            quantity: item.quantity, priceMinor: item.priceMinor, totalMinor: item.totalMinor,
            isPreorder: !!item.isPreorder,
          },
        });
      }
      return "created";
    }),
  };
}

describe("EC24a InventoryService — preorder lines skip stock", () => {
  it("explicit items: preorder line skipped entirely, normal line decrements", async () => {
    const prisma = fakePrisma();
    const svc = new InventoryService(prisma, auditStub);
    const pre = await prisma.product.create({ data: { organizationId: "org-1", name: "Pre", sku: "PRE-1", priceMinor: 1000n, stockQuantity: 0, preorderEnabled: true } });
    const norm = await prisma.product.create({ data: { organizationId: "org-1", name: "Norm", sku: "N-1", priceMinor: 1000n, stockQuantity: 10 } });
    const out = await svc.applyOrderPlaced("org-1", "o-1", {
      items: [
        { productId: pre.id, quantity: 5, isPreorder: true },
        { productId: norm.id, quantity: 2 },
      ],
      status: "processing",
    });
    expect(out).toEqual({ decremented: 1, skipped: 1 });
    expect(prisma.product.rows.find((r: any) => r.id === pre.id).stockQuantity).toBe(0);
    expect(prisma.product.rows.find((r: any) => r.id === norm.id).stockQuantity).toBe(8);
    expect(prisma.stockMovement.rows).toHaveLength(1);
    expect(prisma.stockMovement.rows[0].productId).toBe(norm.id);
  });

  it("DB-loaded lines: OrderItem.isPreorder is carried and skipped", async () => {
    const prisma = fakePrisma();
    const svc = new InventoryService(prisma, auditStub);
    const pre = await prisma.product.create({ data: { organizationId: "org-1", name: "Pre", sku: "PRE-1", priceMinor: 1000n, stockQuantity: 0, preorderEnabled: true } });
    const order = await prisma.order.create({ data: { organizationId: "org-1", externalId: "1", source: "manual", status: "processing" } });
    await prisma.orderItem.create({ data: { orderId: order.id, productId: pre.id, name: "Pre", sku: "PRE-1", quantity: 3, isPreorder: true } });
    const out = await svc.applyOrderPlaced("org-1", order.id, { status: "processing" });
    expect(out).toEqual({ decremented: 0, skipped: 1 });
    expect(prisma.stockMovement.rows).toHaveLength(0);
  });
});

describe("EC24a preorder limit — open qty accounting", () => {
  async function seed(prisma: any, status: string, qty: number) {
    const order = await prisma.order.create({ data: { organizationId: "org-1", externalId: `e-${status}`, source: "manual", status } });
    await prisma.orderItem.create({ data: { orderId: order.id, productId: "p-1", name: "P", quantity: qty, isPreorder: true } });
    return order;
  }
  it("counts open orders only: cancelled/refunded/failed/completed excluded", async () => {
    const prisma = fakePrisma();
    await seed(prisma, "processing", 3);
    await seed(prisma, "pending", 2);
    await seed(prisma, "cancelled", 10);
    await seed(prisma, "completed", 10);
    await seed(prisma, "refunded", 10);
    await seed(prisma, "failed", 10);
    expect(await openPreorderQty(prisma, "org-1", "p-1")).toBe(5);
  });

  it("open + requested > limit refuses; after cancelling the open order it passes", async () => {
    const prisma = fakePrisma();
    const order = await seed(prisma, "processing", 4);
    const product = { id: "p-1", preorderEnabled: true, preorderLimit: 5 };
    await expect(assertPreorderLimit(prisma, "org-1", product, 2)).rejects.toBeInstanceOf(BadRequestException);
    await expect(assertPreorderLimit(prisma, "org-1", product, 2)).rejects.toThrow(/প্রি-অর্ডারের সীমা শেষ/);
    order.status = "cancelled";
    await expect(assertPreorderLimit(prisma, "org-1", product, 2)).resolves.toBeUndefined();
    // completed orders do not count either
    await seed(prisma, "completed", 5);
    await expect(assertPreorderLimit(prisma, "org-1", product, 5)).resolves.toBeUndefined();
  });

  it("no limit / not preorder = no-op", async () => {
    const prisma = fakePrisma();
    await expect(assertPreorderLimit(prisma, "org-1", { id: "p-1", preorderEnabled: true, preorderLimit: null }, 999)).resolves.toBeUndefined();
    await expect(assertPreorderLimit(prisma, "org-1", { id: "p-1", preorderEnabled: false, preorderLimit: 1 }, 999)).resolves.toBeUndefined();
  });
});

describe("EC24a single-product checkout (ProductsService.placePublicOrder)", () => {
  function setup() {
    const prisma = fakePrisma();
    const integrations = integrationsStub(prisma);
    const svc = new ProductsService(prisma, auditStub, undefined, integrations as any);
    return { prisma, svc, integrations };
  }
  const dto: any = { customerName: "রহিম", customerPhone: "01700000000", customerAddress: "ঢাকা", quantity: 2 };

  it("zero-stock preorder product is accepted, item stamped, no stock movement", async () => {
    const { prisma, svc, integrations } = setup();
    prisma.product.rows.push({
      id: "p-pre", organizationId: "org-1", name: "Pre", slug: "pre", sku: "PRE-1", status: "ACTIVE",
      priceMinor: 10000n, currency: "BDT", stockQuantity: 0, preorderEnabled: true, preorderLimit: null,
      organization: { id: "org-1", name: "Org", businessProfile: null },
    });
    const res: any = await svc.placePublicOrder("pre", dto);
    expect(res.success).toBe(true);
    const payload = (integrations.upsertOrder as jest.Mock).mock.calls[0][2];
    expect(payload.items[0].isPreorder).toBe(true);
    expect(prisma.orderItem.rows[0].isPreorder).toBe(true);
    expect(prisma.stockMovement.rows).toHaveLength(0);
  });

  it("preorder limit refusal happens before any order is written", async () => {
    const { prisma, svc, integrations } = setup();
    prisma.product.rows.push({
      id: "p-pre", organizationId: "org-1", name: "Pre", slug: "pre", sku: "PRE-1", status: "ACTIVE",
      priceMinor: 10000n, currency: "BDT", stockQuantity: 0, preorderEnabled: true, preorderLimit: 3,
      organization: { id: "org-1", name: "Org", businessProfile: null },
    });
    const order = await prisma.order.create({ data: { organizationId: "org-1", externalId: "x", source: "manual", status: "processing" } });
    await prisma.orderItem.create({ data: { orderId: order.id, productId: "p-pre", name: "Pre", quantity: 2, isPreorder: true } });
    await expect(svc.placePublicOrder("pre", dto)).rejects.toThrow(/প্রি-অর্ডারের সীমা শেষ/);
    expect(integrations.upsertOrder).not.toHaveBeenCalled();
  });

  it("public payload carries preorder info and never for normal products", async () => {
    const { prisma, svc } = setup();
    prisma.product.rows.push({
      id: "p-pre", organizationId: "org-1", name: "Pre", slug: "pre", sku: "PRE-1", status: "ACTIVE",
      priceMinor: 10000n, currency: "BDT", stockQuantity: 0, preorderEnabled: true,
      preorderReleaseDate: new Date("2026-12-01T00:00:00Z"),
      organization: { id: "org-1", name: "Org", slug: "org", businessProfile: null }, variants: [],
    });
    const pub: any = await svc.getPublicProductBySlug("pre");
    expect(pub.product.preorder).toEqual({ enabled: true, releaseDate: "2026-12-01T00:00:00.000Z" });
  });
});

describe("EC24a storefront stock gate", () => {
  it("preorder product bypasses assertStock at zero stock; normal zero-stock product is refused as today", async () => {
    const prisma = fakePrisma();
    const svc = new StorefrontService(prisma);
    // GB2 (GC7): assertStock became async (availability-aware);
    // the intent of these assertions is unchanged — preorder
    // bypasses, a normal zero-stock product is refused.
    await expect(
      (svc as any).assertStock({ name: "Pre", stockQuantity: 0, preorderEnabled: true }, null, 5),
    ).resolves.toBeUndefined();
    await expect(
      (svc as any).assertStock({ name: "Norm", stockQuantity: 0, preorderEnabled: false }, null, 1),
    ).rejects.toThrow(BadRequestException);
  });
});

describe("EC24a landing checkout (LandingsService.placeOrder)", () => {
  it("zero-stock preorder accepted with the line stamped", async () => {
    const prisma = fakePrisma();
    prisma.landingPage.rows.push({ id: "l-1", organizationId: "org-1", productId: "p-pre", slug: "offer", status: "published", sections: null, upsellProductId: null });
    prisma.product.rows.push({
      id: "p-pre", organizationId: "org-1", name: "Pre", slug: "pre", sku: "PRE-1", status: "ACTIVE",
      priceMinor: 10000n, currency: "BDT", stockQuantity: 0, preorderEnabled: true, preorderLimit: null,
    });
    const integrations = integrationsStub(prisma);
    const svc = new LandingsService(prisma, auditStub, undefined, undefined, integrations as any, undefined, null, undefined);
    const res: any = await svc.placeOrder("offer", {
      customerName: "রহিম", customerPhone: "01700000000", customerAddress: "ঢাকা", quantity: 2,
    } as any);
    expect(res.success).toBe(true);
    expect(prisma.orderItem.rows[0].isPreorder).toBe(true);
  });
});
