import { ListingsService } from "./listings.service";
import { stableContentHash } from "./content-hash";

/** Generic flat-where matcher (supports equality + { in: [...] }). */
function matches(row: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if ("in" in (v as any)) return (v as any).in.includes(row[k]);
      return true;
    }
    return row[k] === v;
  });
}

function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    findUnique: async ({ where }: any) => {
      if (where?.storeId_productId) {
        const k = where.storeId_productId;
        return rows.find((r) => r.storeId === k.storeId && r.productId === k.productId) ?? null;
      }
      return rows.find((r) => r.id === where?.id) ?? null;
    },
    create: async ({ data }: any) => {
      const row = { id: `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    },
    upsert: async ({ where, create, update }: any) => {
      const key = where.storeId_productId;
      const idx = rows.findIndex((r) => r.storeId === key.storeId && r.productId === key.productId);
      if (idx >= 0) {
        Object.assign(rows[idx], update);
        return rows[idx];
      }
      const row = { id: `row-${++seq}`, ...create };
      rows.push(row);
      return row;
    },
  };
}

function fakePrisma() {
  return {
    storeListing: makeTable(),
    syncConflict: makeTable(),
    syncOutbox: makeTable(),
  } as any;
}

const BASE = { name: "Shirt", priceMinor: "1000", status: "publish", stockQuantity: 5, imageUrl: null as string | null };
const REMOTE_CHANGED = { ...BASE, priceMinor: "1200" };

function seedListing(prisma: any, overrides: Record<string, any> = {}) {
  const row = {
    id: "l1",
    organizationId: "org-1",
    storeId: "s1",
    productId: "p1",
    externalId: "ext-1",
    syncStatus: "synced",
    lastRemoteHash: stableContentHash(BASE),
    lastPushedHash: stableContentHash(BASE),
    channelStock: 5,
    ...overrides,
  };
  prisma.storeListing.rows.push(row);
  return row;
}

describe("ListingsService.detectInboundConflict", () => {
  it("returns null when the remote content is unchanged", async () => {
    const prisma = fakePrisma();
    seedListing(prisma);
    prisma.syncOutbox.rows.push({ id: "o1", organizationId: "org-1", storeId: "s1", entityType: "product", entityId: "p1", status: "pending" });
    const svc = new ListingsService(prisma);
    const result = await svc.detectInboundConflict({
      organizationId: "org-1", storeId: "s1", productId: "p1", localContent: BASE, remoteContent: { ...BASE },
    });
    expect(result).toBeNull();
    expect(prisma.syncConflict.rows).toHaveLength(0);
  });

  it("returns null when the remote changed but the local side is clean", async () => {
    const prisma = fakePrisma();
    seedListing(prisma);
    const svc = new ListingsService(prisma);
    const result = await svc.detectInboundConflict({
      organizationId: "org-1", storeId: "s1", productId: "p1", localContent: { ...BASE }, remoteContent: REMOTE_CHANGED,
    });
    expect(result).toBeNull();
    expect(prisma.syncConflict.rows).toHaveLength(0);
    expect(prisma.storeListing.rows[0].syncStatus).toBe("synced");
  });

  it("creates a conflict when remote changed and a push is pending", async () => {
    const prisma = fakePrisma();
    const listing = seedListing(prisma);
    prisma.syncOutbox.rows.push({ id: "o1", organizationId: "org-1", storeId: "s1", entityType: "product", entityId: "p1", status: "pending" });
    const svc = new ListingsService(prisma);
    const conflict = await svc.detectInboundConflict({
      organizationId: "org-1", storeId: "s1", productId: "p1", localContent: { ...BASE }, remoteContent: REMOTE_CHANGED,
    });
    expect(conflict).not.toBeNull();
    expect(conflict.status).toBe("open");
    expect(conflict.field).toBe("product");
    expect(conflict.listingId).toBe("l1");
    expect(conflict.remoteValue).toEqual(REMOTE_CHANGED);
    expect(listing.syncStatus).toBe("conflict");
  });

  it("creates a conflict when remote changed and local content diverged from last push", async () => {
    const prisma = fakePrisma();
    seedListing(prisma);
    const svc = new ListingsService(prisma);
    const conflict = await svc.detectInboundConflict({
      organizationId: "org-1", storeId: "s1", productId: "p1",
      localContent: { ...BASE, name: "Locally renamed" }, remoteContent: REMOTE_CHANGED,
    });
    expect(conflict).not.toBeNull();
    expect(conflict.status).toBe("open");
    expect(prisma.storeListing.rows[0].syncStatus).toBe("conflict");
  });

  it("does not treat a completed outbox row as pending work", async () => {
    const prisma = fakePrisma();
    seedListing(prisma);
    prisma.syncOutbox.rows.push({ id: "o1", organizationId: "org-1", storeId: "s1", entityType: "product", entityId: "p1", status: "done" });
    const svc = new ListingsService(prisma);
    const result = await svc.detectInboundConflict({
      organizationId: "org-1", storeId: "s1", productId: "p1", localContent: { ...BASE }, remoteContent: REMOTE_CHANGED,
    });
    expect(result).toBeNull();
  });

  it("dedupes: a second detection returns the existing open conflict", async () => {
    const prisma = fakePrisma();
    seedListing(prisma);
    prisma.syncOutbox.rows.push({ id: "o1", organizationId: "org-1", storeId: "s1", entityType: "product", entityId: "p1", status: "processing" });
    const svc = new ListingsService(prisma);
    const input = {
      organizationId: "org-1", storeId: "s1", productId: "p1", localContent: { ...BASE }, remoteContent: REMOTE_CHANGED,
    };
    const first = await svc.detectInboundConflict(input);
    const second = await svc.detectInboundConflict(input);
    expect(second.id).toBe(first.id);
    expect(prisma.syncConflict.rows).toHaveLength(1);
  });

  it("returns null when there is no listing (or no externalId)", async () => {
    const prisma = fakePrisma();
    const svc = new ListingsService(prisma);
    const result = await svc.detectInboundConflict({
      organizationId: "org-1", storeId: "s1", productId: "nope", localContent: BASE, remoteContent: REMOTE_CHANGED,
    });
    expect(result).toBeNull();
  });
});

describe("ListingsService.recordInboundProduct conflict preservation", () => {
  it("keeps syncStatus=conflict on update while refreshing hash/stock", async () => {
    const prisma = fakePrisma();
    const svc = new ListingsService(prisma);
    await svc.recordInboundProduct("org-1", "s1", "p1", "ext-1", { ...BASE, stockQuantity: 5 });
    expect(prisma.storeListing.rows[0].syncStatus).toBe("synced");
    // A conflict opens out-of-band (detection path).
    prisma.storeListing.rows[0].syncStatus = "conflict";

    const next = { ...BASE, name: "Shirt v2", stockQuantity: 9 };
    await svc.recordInboundProduct("org-1", "s1", "p1", "ext-1", next);
    const row = prisma.storeListing.rows[0];
    expect(row.syncStatus).toBe("conflict");
    expect(row.channelStock).toBe(9);
    expect(row.lastRemoteHash).toBe(stableContentHash(next));
    expect(row.externalId).toBe("ext-1");
  });

  it("still flips a non-conflicted listing back to synced on update", async () => {
    const prisma = fakePrisma();
    const svc = new ListingsService(prisma);
    await svc.recordInboundProduct("org-1", "s1", "p1", "ext-1", { ...BASE });
    prisma.storeListing.rows[0].syncStatus = "pending";
    await svc.recordInboundProduct("org-1", "s1", "p1", "ext-1", { ...BASE, stockQuantity: 2 });
    expect(prisma.storeListing.rows[0].syncStatus).toBe("synced");
  });
});
