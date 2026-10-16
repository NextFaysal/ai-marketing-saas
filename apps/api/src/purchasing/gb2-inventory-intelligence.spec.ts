import { InventoryIntelligenceService } from "./inventory-intelligence.service";
import { InventoryService } from "../inventory/inventory.service";

/**
 * GB2 (GC7) — inventory intelligence specs: the widened settings
 * surface (partial updates incl. allowBackorder/reserveMinutes),
 * the availability read (on-hand / reserved / available), and
 * the damaged/lost report with ON7 as-of costing. Fake prisma
 * in the EC33 makeTable style (matcher extended with gt/lte).
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
    deleteMany: async ({ where }: any) => {
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1);
      return { count: 0 };
    },
  };
}

function fakePrisma() {
  return {
    product: makeTable("product"), productVariant: makeTable("variant"),
    productCost: makeTable("cost"), stockMovement: makeTable("movement"),
    stockReservation: makeTable("reservation"), inventorySetting: makeTable("invsetting"),
    order: makeTable("order"), orderItem: makeTable("item"),
    auditLog: makeTable("audit"), membership: makeTable("membership"),
    agentNotification: makeTable("notif"),
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
  const inventory = new InventoryService(prisma as any, audit);
  const svc = new InventoryIntelligenceService(prisma as any, audit, inventory as any);
  return { prisma, audit, svc, inventory };
}

const ORG = "org-1";

describe("GB2 settings surface", () => {
  it("GET serializes the GB2 fields with defaults when no row exists", async () => {
    const { svc } = setup();
    const out: any = await svc.getSettings(ORG);
    expect(out).toMatchObject({ leadTimeDays: 14, allowBackorder: false, reserveMinutes: 0 });
  });

  it("partial PUT changes only the provided fields and audits field names", async () => {
    const { prisma, svc } = setup();
    const first: any = await svc.updateSettings(ORG, "owner-1", { allowBackorder: true, reserveMinutes: 45 });
    expect(first).toMatchObject({ leadTimeDays: 14, allowBackorder: true, reserveMinutes: 45 });
    const second: any = await svc.updateSettings(ORG, "owner-1", { leadTimeDays: 10 });
    expect(second).toMatchObject({ leadTimeDays: 10, allowBackorder: true, reserveMinutes: 45 });
    const audits = prisma.auditLog.rows.filter((r: any) => r.action === "inventory_settings.updated");
    expect(audits).toHaveLength(2);
    expect(audits[0].metadata).toEqual({ changed: ["allowBackorder", "reserveMinutes"] });
  });

  it("invalid values 400 (leadTimeDays range, reserveMinutes range, non-boolean backorder, empty patch)", async () => {
    const { svc } = setup();
    await expect(svc.updateSettings(ORG, "o", { leadTimeDays: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(svc.updateSettings(ORG, "o", { leadTimeDays: 181 })).rejects.toMatchObject({ status: 400 });
    await expect(svc.updateSettings(ORG, "o", { reserveMinutes: 1441 })).rejects.toMatchObject({ status: 400 });
    await expect(svc.updateSettings(ORG, "o", { allowBackorder: "yes" as any })).rejects.toMatchObject({ status: 400 });
    await expect(svc.updateSettings(ORG, "o", {})).rejects.toMatchObject({ status: 400 });
  });
});

describe("GB2 availability read", () => {
  it("reports onHand / reserved / available per tracked row (variant rows for variant products)", async () => {
    const { prisma, svc } = setup();
    prisma.product.rows.push(
      { id: "p-1", organizationId: ORG, name: "শাড়ি", sku: "S-1", stockQuantity: 10, lowStockThreshold: null, createdAt: new Date() },
      { id: "p-2", organizationId: ORG, name: "শার্ট", sku: "SH-1", stockQuantity: null, lowStockThreshold: null, createdAt: new Date() },
      { id: "p-3", organizationId: ORG, name: "অট্র্যাক", sku: "UN-1", stockQuantity: null, lowStockThreshold: null, createdAt: new Date() },
    );
    prisma.productVariant.rows.push(
      { id: "v-1", productId: "p-2", name: "M", sku: "SH-M", stockQuantity: 5, createdAt: new Date() },
    );
    const future = new Date(Date.now() + 600_000);
    prisma.stockReservation.rows.push(
      { id: "r-1", organizationId: ORG, sessionRef: "c-1", productId: "p-1", variantId: null, quantity: 3, state: "active", expiresAt: future, createdAt: new Date() },
      { id: "r-2", organizationId: ORG, sessionRef: "c-1", productId: "p-2", variantId: "v-1", quantity: 5, state: "active", expiresAt: future, createdAt: new Date() },
      { id: "r-3", organizationId: ORG, sessionRef: "c-1", productId: "p-1", variantId: null, quantity: 9, state: "active", expiresAt: new Date(Date.now() - 1000), createdAt: new Date() },
    );
    const out: any = await svc.availability(ORG);
    const byKey = new Map(out.items.map((i: any) => [`${i.productId}::${i.variantId ?? ""}`, i]));
    expect(byKey.get("p-1::")).toMatchObject({ onHand: 10, reserved: 3, available: 7 });
    expect(byKey.get("p-2::v-1")).toMatchObject({ onHand: 5, reserved: 5, available: 0 });
    // Untracked product contributes no row.
    expect(byKey.has("p-3::")).toBe(false);
  });
});

describe("GB2 damage report", () => {
  it("totals count stock-out damage movements only, costed by the as-of rule; uncosted counted honestly", async () => {
    const { prisma, svc } = setup();
    prisma.product.rows.push(
      { id: "p-1", organizationId: ORG, name: "শাড়ি", sku: "S-1", stockQuantity: 10, createdAt: new Date(), variants: [] },
      { id: "p-2", organizationId: ORG, name: "কুর্তি", sku: "K-1", stockQuantity: 4, createdAt: new Date(), variants: [] },
    );
    // Cost history: 100.00 from Jan, 120.00 from Jun (as-of picks per movement date).
    prisma.productCost.rows.push(
      { id: "c-1", productId: "p-1", variantId: null, costMinor: 10000n, effectiveFrom: new Date("2026-01-01T00:00:00Z"), createdAt: new Date() },
      { id: "c-2", productId: "p-1", variantId: null, costMinor: 12000n, effectiveFrom: new Date("2026-06-01T00:00:00Z"), createdAt: new Date() },
    );
    const mv = (id: string, over: any) => ({
      id, organizationId: ORG, productId: "p-1", variantId: null, orderId: null,
      reason: "damaged", createdAt: new Date("2026-03-01T00:00:00Z"), ...over,
    });
    prisma.stockMovement.rows.push(
      mv("m-1", { delta: -2, balanceAfter: 8 }),                                        // damaged, costed @10000 → 20000
      mv("m-2", { delta: -1, balanceAfter: 7, reason: "lost", createdAt: new Date("2026-07-01T00:00:00Z") }), // lost, costed @12000 → 12000
      mv("m-3", { delta: 3, balanceAfter: 10, reason: "damaged", createdAt: new Date("2026-07-02T00:00:00Z") }), // positive correction — listed, not totalled
      mv("m-4", { delta: -5, balanceAfter: 5, reason: "manual_adjustment" }),           // not a damage reason — excluded entirely
      mv("m-5", { delta: -4, balanceAfter: 0, reason: "expired", productId: "p-2", createdAt: new Date("2026-08-01T00:00:00Z") }),   // expired, NO cost rows → uncosted
      mv("m-6", { delta: -9, balanceAfter: 0, reason: "damaged", createdAt: new Date("2025-01-01T00:00:00Z") }), // outside range
    );
    const out: any = await svc.damageReport(ORG, "2026-01-01T00:00:00Z", "2026-12-31T00:00:00Z");
    expect(out.rows.map((r: any) => r.reason)).toEqual(["damaged", "lost", "damaged", "expired"]);
    expect(out.totals).toEqual({
      damaged: 2, lost: 1, expired: 4, totalQuantity: 7,
      costValueMinor: "32000", uncostedMovements: 1,
    });
    const correction = out.rows.find((r: any) => r.delta === 3);
    expect(correction.quantity).toBe(0);
    expect(correction.costValueMinor).toBeNull();
  });

  it("bad dates 400 in Bengali", async () => {
    const { svc } = setup();
    await expect(svc.damageReport(ORG, "not-a-date")).rejects.toThrow(/তারিখ সঠিক নয়/);
  });
});
