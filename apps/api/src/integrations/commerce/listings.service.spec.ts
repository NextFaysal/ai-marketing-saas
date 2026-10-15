import { ListingsService } from "./listings.service";
import { stableContentHash } from "./content-hash";

function makeListingTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    upsert: async ({ where, create, update }: any) => {
      const key = where.storeId_productId;
      const idx = rows.findIndex((r) => r.storeId === key.storeId && r.productId === key.productId);
      if (idx >= 0) {
        Object.assign(rows[idx], update);
        return rows[idx];
      }
      const row = { id: `listing-${++seq}`, ...create };
      // undefined fields: keep as undefined (prisma would store null for nullable)
      rows.push(row);
      return row;
    },
    findMany: async () => rows,
  };
}

function fakePrisma() {
  return { storeListing: makeListingTable() } as any;
}

describe("ListingsService", () => {
  it("no-ops when storeId or externalId missing", async () => {
    const prisma = fakePrisma();
    const svc = new ListingsService(prisma);
    await svc.recordInboundProduct("org-1", null, "p1", "ext-1", { name: "X" });
    await svc.recordInboundProduct("org-1", "s1", "p1", null, { name: "X" });
    expect(prisma.storeListing.rows).toHaveLength(0);
  });
  it("creates a synced listing with hash and channelStock", async () => {
    const prisma = fakePrisma();
    const svc = new ListingsService(prisma);
    const content = { name: "Shirt", stockQuantity: 7 };
    await svc.recordInboundProduct("org-1", "s1", "p1", "ext-1", content);
    expect(prisma.storeListing.rows).toHaveLength(1);
    const row = prisma.storeListing.rows[0];
    expect(row.syncStatus).toBe("synced");
    expect(row.lastRemoteHash).toBe(stableContentHash(content));
    expect(row.channelStock).toBe(7);
    expect(row.lastSyncError).toBeNull();
    expect(row.externalId).toBe("ext-1");
  });
  it("updates existing listing, only overwriting stock when a number", async () => {
    const prisma = fakePrisma();
    const svc = new ListingsService(prisma);
    await svc.recordInboundProduct("org-1", "s1", "p1", "ext-1", { name: "Shirt", stockQuantity: 7 });
    await svc.recordInboundProduct("org-1", "s1", "p1", "ext-1", { name: "Shirt v2" });
    expect(prisma.storeListing.rows).toHaveLength(1);
    expect(prisma.storeListing.rows[0].channelStock).toBe(7);
    await svc.recordInboundProduct("org-1", "s1", "p1", "ext-1", { name: "Shirt v2", stockQuantity: 3 });
    expect(prisma.storeListing.rows[0].channelStock).toBe(3);
  });
  it("touchForOrderItem upserts keyed by store+product with external id", async () => {
    const prisma = fakePrisma();
    const svc = new ListingsService(prisma);
    await svc.touchForOrderItem("org-1", "s1", "p1", "ext-99", 12);
    expect(prisma.storeListing.rows).toHaveLength(1);
    expect(prisma.storeListing.rows[0].externalId).toBe("ext-99");
    expect(prisma.storeListing.rows[0].channelStock).toBe(12);
    await svc.touchForOrderItem("org-1", "s1", "p1", "ext-99", null);
    expect(prisma.storeListing.rows[0].channelStock).toBe(12);
  });
});

describe("stableContentHash", () => {
  it("is stable regardless of key order and handles BigInt/Date", () => {
    const a = stableContentHash({ b: 1, a: { d: 4n, c: new Date("2026-01-01T00:00:00.000Z") } });
    const b = stableContentHash({ a: { c: new Date("2026-01-01T00:00:00.000Z"), d: 4n }, b: 1 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it("drops undefined", () => {
    expect(stableContentHash({ a: 1, b: undefined })).toBe(stableContentHash({ a: 1 }));
  });
});
