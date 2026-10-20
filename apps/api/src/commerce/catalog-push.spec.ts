import { NotFoundException } from "@nestjs/common";
import { ApiException } from "../i18n";
import { CatalogPushService } from "./catalog-push.service";
import { SyncOutboxService } from "./sync-outbox.service";
import { computeStockDiverged, pendingOutboxKeys } from "./stock-divergence";

// NOTE: this spec runs against the REAL
// integrations/commerce/catalog-content loadPushContent (the
// parallel builder's module, contract-fixed as
// loadPushContent(prisma, organizationId, listing) ->
// { content, hash }). The fake prisma below therefore carries
// every table the real loader reads (product, productVariant,
// productImage, category, productTagAssignment), and hash
// assertions are on the sha256 hex shape + stability/change,
// never on a re-implemented hash.

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v && !v.in.includes(row[k])) return false;
      if ("not" in v) {
        const ok = v.not === null ? row[k] !== null && row[k] !== undefined : row[k] !== v.not;
        if (!ok) return false;
      }
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

function setup() {
  const prisma: any = {
    product: makeTable("product"),
    productVariant: makeTable("variant"),
    productImage: makeTable("image"),
    category: makeTable("category"),
    productTag: makeTable("tag"),
    productTagAssignment: makeTable("assignment"),
    store: makeTable("store"),
    storeListing: makeTable("listing"),
    syncConflict: makeTable("conflict"),
    syncOutbox: makeTable("outbox"),
  };
  prisma.product.rows.push({
    id: "p1", organizationId: "org-1", name: "Shirt", priceMinor: 10000n,
  });
  prisma.store.rows.push(
    { id: "st-full", organizationId: "org-1", name: "Full Store", platform: "WOOCOMMERCE", syncMode: "full-manage" },
    { id: "st-mirror", organizationId: "org-1", name: "Mirror Store", platform: "WOOCOMMERCE", syncMode: "mirror" },
    { id: "st-co", organizationId: "org-1", name: "Co Store", platform: "SHOPIFY", syncMode: "co-manage" },
    { id: "st-full2", organizationId: "org-1", name: "Full 2", platform: "SHOPIFY", syncMode: "full-manage" },
  );
  prisma.storeListing.rows.push(
    { id: "lst-full", organizationId: "org-1", storeId: "st-full", productId: "p1", externalId: "101", publishState: "published", syncStatus: "synced", channelPriceMinor: null, channelStock: 5, saleStartsAt: null, saleEndsAt: null, saleActive: false },
    { id: "lst-mirror", organizationId: "org-1", storeId: "st-mirror", productId: "p1", externalId: "102", publishState: "published", syncStatus: "synced", channelPriceMinor: null },
    { id: "lst-co", organizationId: "org-1", storeId: "st-co", productId: "p1", externalId: "103", publishState: "published", syncStatus: "synced", channelPriceMinor: null },
    { id: "lst-draft", organizationId: "org-1", storeId: "st-full2", productId: "p1", externalId: "", publishState: "draft", syncStatus: "pending", channelPriceMinor: null },
  );
  const outbox = new SyncOutboxService(prisma as any, {} as any);
  const svc = new CatalogPushService(prisma as any, outbox);
  return { prisma, svc, outbox };
}

describe("CatalogPushService — store mode + publish gating", () => {
  it("mirror / co-manage stores get NO enqueue; full-manage published enqueues with the content hash in the key", async () => {
    const { prisma, svc } = setup();
    const out = await svc.enqueueProductPush("org-1", "p1");
    // lst-full enqueues; the full-manage DRAFT listing counts as
    // skipped; mirror/co-manage listings are not considered at all.
    expect(out).toEqual({ enqueued: 1, skipped: 1 });
    expect(prisma.syncOutbox.rows).toHaveLength(1);
    const row = prisma.syncOutbox.rows[0];
    expect(row.storeId).toBe("st-full");
    expect(row.operation).toBe("push_product");
    expect(row.entityType).toBe("product");
    expect(row.entityId).toBe("p1");
    expect(row.payload).toEqual({ listingId: "lst-full", productId: "p1" });
    // Key embeds the real loadPushContent hash (sha256 hex).
    expect(row.idempotencyKey).toMatch(/^push_product:lst-full:[0-9a-f]{64}$/);
    // The listing is marked pending once a pending row exists.
    expect(prisma.storeListing.rows.find((l: any) => l.id === "lst-full").syncStatus).toBe("pending");
  });

  it("unchanged hash dedupes: a second enqueue creates no new outbox row; after the row is done, re-enqueue reports skipped", async () => {
    const { prisma, svc } = setup();
    await svc.enqueueProductPush("org-1", "p1");
    await svc.enqueueProductPush("org-1", "p1");
    expect(prisma.syncOutbox.rows).toHaveLength(1);
    prisma.syncOutbox.rows[0].status = "done";
    const third = await svc.enqueueProductPush("org-1", "p1");
    // lst-full deduped (done row, same hash) + lst-draft skipped.
    expect(third).toEqual({ enqueued: 0, skipped: 2 });
    expect(prisma.syncOutbox.rows).toHaveLength(1);
    // A real content change produces a new hash and a new row.
    prisma.product.rows[0].priceMinor = 12000n;
    const fourth = await svc.enqueueProductPush("org-1", "p1");
    expect(fourth.enqueued).toBe(1);
    expect(prisma.syncOutbox.rows).toHaveLength(2);
    expect(prisma.syncOutbox.rows[1].idempotencyKey).toMatch(/^push_product:lst-full:[0-9a-f]{64}$/);
    expect(prisma.syncOutbox.rows[1].idempotencyKey).not.toBe(prisma.syncOutbox.rows[0].idempotencyKey);
  });

  it("draft listing is not enqueued without force, and is enqueued with force", async () => {
    const { prisma, svc } = setup();
    const plain = await svc.enqueueProductPush("org-1", "p1", { listingId: "lst-draft" });
    expect(plain).toEqual({ enqueued: 0, skipped: 1 });
    expect(prisma.syncOutbox.rows).toHaveLength(0);
    const forced = await svc.enqueueProductPush("org-1", "p1", { listingId: "lst-draft", force: true });
    expect(forced).toEqual({ enqueued: 1, skipped: 0 });
    expect(prisma.syncOutbox.rows).toHaveLength(1);
    expect(prisma.syncOutbox.rows[0].payload.listingId).toBe("lst-draft");
  });

  it("enqueueForProductChange is the published-only default", async () => {
    const { prisma, svc } = setup();
    const out = await svc.enqueueForProductChange("org-1", "p1");
    expect(out.enqueued).toBe(1);
    expect(prisma.syncOutbox.rows.map((r: any) => r.payload.listingId)).toEqual(["lst-full"]);
  });
});

describe("CatalogPushService — conflict pause is absolute", () => {
  it("a listing flagged syncStatus=conflict is skipped even with force", async () => {
    const { prisma, svc } = setup();
    prisma.storeListing.rows.find((l: any) => l.id === "lst-full").syncStatus = "conflict";
    const out = await svc.enqueueProductPush("org-1", "p1", { listingId: "lst-full", force: true });
    expect(out).toEqual({ enqueued: 0, skipped: 1 });
    expect(prisma.syncOutbox.rows).toHaveLength(0);
  });

  it("an open SyncConflict row pauses the listing even when syncStatus is not conflict; a resolved one does not", async () => {
    const { prisma, svc } = setup();
    prisma.syncConflict.rows.push({ id: "cf-1", organizationId: "org-1", listingId: "lst-full", status: "open" });
    const out = await svc.enqueueProductPush("org-1", "p1", { listingId: "lst-full", force: true });
    expect(out).toEqual({ enqueued: 0, skipped: 1 });
    prisma.syncConflict.rows[0].status = "resolved";
    const after = await svc.enqueueProductPush("org-1", "p1", { listingId: "lst-full" });
    expect(after.enqueued).toBe(1);
  });

  it("conflicted listings are also skipped for inventory pushes", async () => {
    const { prisma, svc } = setup();
    prisma.storeListing.rows.find((l: any) => l.id === "lst-full").syncStatus = "conflict";
    const out = await svc.enqueueInventoryPush("org-1", "p1", null, 10);
    expect(out.enqueued).toBe(0);
    expect(prisma.syncOutbox.rows).toHaveLength(0);
  });
});

describe("CatalogPushService — publish, archive, inventory, listings-for-new-product", () => {
  it("publishListing flips draft → published and enqueues the push; foreign listing 404s", async () => {
    const { prisma, svc } = setup();
    const out = await svc.publishListing("org-1", "lst-draft");
    expect(out).toEqual({ enqueued: 1, skipped: 0 });
    expect(prisma.storeListing.rows.find((l: any) => l.id === "lst-draft").publishState).toBe("published");
    expect(prisma.syncOutbox.rows).toHaveLength(1);
    await expect(svc.publishListing("org-2", "lst-draft")).rejects.toThrow(ApiException);
    await expect(svc.publishListing("org-1", "lst-nope")).rejects.toThrow(ApiException);
  });

  it("enqueueArchive only targets published full-manage listings, keyed with the hash", async () => {
    const { prisma, svc } = setup();
    const out = await svc.enqueueArchive("org-1", "p1");
    expect(out).toEqual({ enqueued: 1, skipped: 1 });
    expect(prisma.syncOutbox.rows).toHaveLength(1);
    expect(prisma.syncOutbox.rows[0].operation).toBe("archive_product");
    expect(prisma.syncOutbox.rows[0].idempotencyKey).toMatch(/^archive_product:lst-full:[0-9a-f]{64}$/);
  });

  it("inventory push only goes to published listings, with variant + quantity in payload and key", async () => {
    const { prisma, svc } = setup();
    const out = await svc.enqueueInventoryPush("org-1", "p1", "v1", 42);
    expect(out).toEqual({ enqueued: 1, skipped: 1 });
    const row = prisma.syncOutbox.rows[0];
    expect(row.operation).toBe("push_inventory");
    expect(row.payload).toEqual({ listingId: "lst-full", productId: "p1", variantId: "v1", quantity: 42 });
    expect(row.idempotencyKey).toBe("push_inventory:lst-full:v1:42");
    const productLevel = await svc.enqueueInventoryPush("org-1", "p1", null, 7);
    expect(productLevel.enqueued).toBe(1);
    expect(prisma.syncOutbox.rows[1].idempotencyKey).toBe("push_inventory:lst-full:-:7");
  });

  it("createListingsForNewProduct creates draft listings only on full-manage stores lacking one, and enqueues nothing", async () => {
    const { prisma, svc } = setup();
    prisma.product.rows.push({ id: "p2", organizationId: "org-1", name: "Hat", priceMinor: 5000n });
    const created = await svc.createListingsForNewProduct("org-1", "p2");
    expect(created).toBe(2);
    const listings = prisma.storeListing.rows.filter((l: any) => l.productId === "p2");
    expect(listings.map((l: any) => l.storeId).sort()).toEqual(["st-full", "st-full2"]);
    expect(listings[0]).toMatchObject({ publishState: "draft", syncStatus: "pending", externalId: "" });
    expect(prisma.syncOutbox.rows).toHaveLength(0);
    // Idempotent: a second run creates nothing new.
    expect(await svc.createListingsForNewProduct("org-1", "p2")).toBe(0);
    // Existing product p1 already has listings on both full-manage stores.
    expect(await svc.createListingsForNewProduct("org-1", "p1")).toBe(0);
  });
});

describe("CatalogPushService — sale boundaries", () => {
  const now = new Date("2026-10-13T10:00:00.000Z");

  it("flips saleActive on when the window opens and off when it ends, re-pushing each time", async () => {
    const { prisma, svc } = setup();
    const listing = prisma.storeListing.rows.find((l: any) => l.id === "lst-full");
    listing.saleStartsAt = new Date("2026-10-13T09:00:00.000Z");
    listing.saleEndsAt = new Date("2026-10-13T12:00:00.000Z");
    listing.saleActive = false;

    const turnedOn = await svc.applySaleBoundary({ ...listing }, now);
    expect(turnedOn).toBe(true);
    expect(prisma.storeListing.rows.find((l: any) => l.id === "lst-full").saleActive).toBe(true);
    expect(prisma.syncOutbox.rows).toHaveLength(1);

    // No change inside the window → no flip, no extra work.
    const current = prisma.storeListing.rows.find((l: any) => l.id === "lst-full");
    expect(await svc.applySaleBoundary({ ...current }, now)).toBe(false);

    // After the end (exclusive) → flips off.
    const afterEnd = new Date("2026-10-13T12:00:00.000Z");
    const turnedOff = await svc.applySaleBoundary({ ...current }, afterEnd);
    expect(turnedOff).toBe(true);
    expect(prisma.storeListing.rows.find((l: any) => l.id === "lst-full").saleActive).toBe(false);
  });

  it("a listing with no sale window is never active; processSaleBoundariesForOrg counts checked/changed", async () => {
    const { prisma, svc } = setup();
    const listing = prisma.storeListing.rows.find((l: any) => l.id === "lst-full");
    listing.saleActive = true; // stale flag, no window → must flip off
    const out = await svc.processSaleBoundariesForOrg("org-1", now);
    // Only lst-full has no window either — no window means it is
    // not even checked by the org sweep.
    expect(out).toEqual({ checked: 0, changed: 0 });

    listing.saleStartsAt = new Date("2026-10-13T09:00:00.000Z");
    listing.saleEndsAt = null;
    listing.saleActive = false;
    const swept = await svc.processSaleBoundariesForOrg("org-1", now);
    expect(swept).toEqual({ checked: 1, changed: 1 });
    expect(prisma.storeListing.rows.find((l: any) => l.id === "lst-full").saleActive).toBe(true);
  });
});

describe("stock-divergence helpers", () => {
  it("computeStockDiverged requires a channel stock, a product stock, a difference, and no pending push", () => {
    expect(computeStockDiverged({ channelStock: 5 }, 5, false)).toBe(false);
    expect(computeStockDiverged({ channelStock: 5 }, 9, false)).toBe(true);
    expect(computeStockDiverged({ channelStock: 5 }, 9, true)).toBe(false);
    expect(computeStockDiverged({ channelStock: null }, 9, false)).toBe(false);
    expect(computeStockDiverged({ channelStock: 5 }, null, false)).toBe(false);
  });

  it("pendingOutboxKeys returns only pending/processing product rows for the requested pairs", async () => {
    const { prisma } = setup();
    prisma.syncOutbox.rows.push(
      { id: "o1", organizationId: "org-1", storeId: "st-full", entityType: "product", entityId: "p1", status: "pending" },
      { id: "o2", organizationId: "org-1", storeId: "st-full2", entityType: "product", entityId: "p1", status: "done" },
      { id: "o3", organizationId: "org-1", storeId: "st-full", entityType: "order", entityId: "p1", status: "pending" },
    );
    const keys = await pendingOutboxKeys(prisma, "org-1", [
      { storeId: "st-full", productId: "p1" },
      { storeId: "st-full2", productId: "p1" },
    ]);
    expect([...keys]).toEqual(["st-full:p1"]);
    expect(await pendingOutboxKeys(prisma, "org-1", [])).toEqual(new Set());
  });
});
