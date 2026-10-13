import { BadRequestException, NotFoundException } from "@nestjs/common";
import { CommerceService } from "./commerce.service";

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
    findMany: async ({ where, skip, take }: any = {}) => {
      let out = rows.filter((r) => matches(r, where ?? {}));
      if (typeof skip === "number") out = out.slice(skip);
      if (typeof take === "number") out = out.slice(0, take);
      return out;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => {
      const row = { id: `row-${++seq}`, createdAt: new Date(Date.now() + seq), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      let n = 0;
      for (const row of rows) if (matches(row, where)) { Object.assign(row, data); n++; }
      return { count: n };
    },
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => r.id === where.id);
      if (idx < 0) throw new Error("not found");
      return rows.splice(idx, 1)[0];
    },
  };
}

function fakePrisma() {
  return {
    storeListing: makeTable(),
    syncConflict: makeTable(),
    syncOutbox: makeTable(),
    product: makeTable(),
    store: makeTable(),
    storeLocation: makeTable(),
  } as any;
}

function makeCatalogPush(prisma: any, log: any[]) {
  return {
    enqueueProductPush: jest.fn(async (orgId: string, productId: string, opts: any) => {
      log.push({
        kind: "enqueueProductPush", orgId, productId, opts,
        conflictStatusAtCall: prisma.syncConflict.rows[0]?.status ?? null,
        listingStatusAtCall: prisma.storeListing.rows[0]?.syncStatus ?? null,
      });
      return { enqueued: true };
    }),
    publishListing: jest.fn(async (orgId: string, listingId: string) => {
      log.push({ kind: "publishListing", orgId, listingId });
      return { id: listingId, publishState: "published" };
    }),
    applySaleBoundary: jest.fn(async (listing: any, now: Date) => {
      log.push({ kind: "applySaleBoundary", listingId: listing.id, now });
      return listing;
    }),
    enqueueInventoryPush: jest.fn(async () => ({ enqueued: true })),
    processSaleBoundariesForOrg: jest.fn(async () => ({ processed: 0 })),
  };
}

function makeSvc() {
  const prisma = fakePrisma();
  const audits: any[] = [];
  const audit = { log: async (e: any) => { audits.push(e); } };
  const outboxCalls: any[] = [];
  const outbox = {
    enqueue: async (input: any) => { outboxCalls.push(input); return { id: "ob-1", ...input }; },
    replay: async () => ({}),
  };
  const pushLog: any[] = [];
  const catalogPush = makeCatalogPush(prisma, pushLog);
  const svc = new CommerceService(prisma, audit as any, outbox as any, catalogPush as any);
  return { svc, prisma, audits, outboxCalls, pushLog, catalogPush };
}

function seedListingAndConflict(prisma: any, conflictOverrides: Record<string, any> = {}) {
  prisma.storeListing.rows.push({
    id: "l1", organizationId: "org-1", storeId: "s1", productId: "p1", externalId: "ext-1",
    syncStatus: "conflict", publishState: "published", channelPriceMinor: null, channelStock: 5,
    product: { name: "Shirt", sku: "SKU-1", stockQuantity: 8 },
    createdAt: new Date(), updatedAt: new Date(),
  });
  prisma.syncConflict.rows.push({
    id: "c1", organizationId: "org-1", storeId: "s1", listingId: "l1", field: "product",
    status: "open", resolution: null,
    localValue: { name: "Shirt", priceMinor: "1000" },
    remoteValue: { name: "Remote Shirt", priceMinor: "2500", status: "draft", stockQuantity: 3, imageUrl: "https://x/y.png" },
    createdAt: new Date(), updatedAt: new Date(),
    ...conflictOverrides,
  });
  prisma.product.rows.push({
    id: "p1", organizationId: "org-1", name: "Shirt", priceMinor: 1000n, status: "publish", stockQuantity: 5, imageUrl: null,
  });
}

describe("CommerceService.resolveConflict", () => {
  it("keep_local: conflict is resolved BEFORE the forced push is enqueued", async () => {
    const { svc, prisma, pushLog, audits } = makeSvc();
    seedListingAndConflict(prisma);
    const result = await svc.resolveConflict("org-1", "u1", "c1", "keep_local");
    expect(result.status).toBe("resolved");
    expect(result.resolution).toBe("local_wins");
    expect(pushLog).toHaveLength(1);
    expect(pushLog[0].kind).toBe("enqueueProductPush");
    expect(pushLog[0].productId).toBe("p1");
    expect(pushLog[0].opts).toEqual({ listingId: "l1", force: true });
    // Order of operations: at enqueue time the conflict was already
    // resolved and the listing already out of "conflict".
    expect(pushLog[0].conflictStatusAtCall).toBe("resolved");
    expect(pushLog[0].listingStatusAtCall).toBe("pending");
    expect(prisma.storeListing.rows[0].syncStatus).toBe("pending");
    expect(audits.some((a: any) => a.action === "commerce.conflict_resolve" && a.metadata?.choice === "keep_local")).toBe(true);
  });

  it("take_remote: applies the remote snapshot (incl. BigInt price) to the product", async () => {
    const { svc, prisma, audits } = makeSvc();
    seedListingAndConflict(prisma);
    const result = await svc.resolveConflict("org-1", "u1", "c1", "take_remote");
    expect(result.resolution).toBe("remote_wins");
    const product = prisma.product.rows[0];
    expect(product.name).toBe("Remote Shirt");
    expect(product.priceMinor).toBe(2500n);
    expect(typeof product.priceMinor).toBe("bigint");
    expect(product.status).toBe("draft");
    expect(product.stockQuantity).toBe(3);
    expect(product.imageUrl).toBe("https://x/y.png");
    expect(prisma.storeListing.rows[0].syncStatus).toBe("synced");
    expect(prisma.storeListing.rows[0].lastSyncError).toBeNull();
    expect(audits.some((a: any) => a.action === "commerce.conflict_resolve" && a.metadata?.choice === "take_remote")).toBe(true);
  });

  it("404s for a conflict in another organization", async () => {
    const { svc, prisma } = makeSvc();
    seedListingAndConflict(prisma, { organizationId: "org-2" });
    await expect(svc.resolveConflict("org-1", "u1", "c1", "keep_local")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("400s when the conflict is already resolved", async () => {
    const { svc, prisma } = makeSvc();
    seedListingAndConflict(prisma, { status: "resolved", resolution: "local_wins" });
    await expect(svc.resolveConflict("org-1", "u1", "c1", "keep_local")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("400s on an invalid choice", async () => {
    const { svc, prisma } = makeSvc();
    seedListingAndConflict(prisma);
    await expect(svc.resolveConflict("org-1", "u1", "c1", "merge_magic")).rejects.toBeInstanceOf(BadRequestException);
  });

  // ---------- CP1: per-field resolution ----------

  function seedPerField(prisma: any) {
    seedListingAndConflict(prisma, {
      fieldDiffs: [
        { field: "name", localValue: "Shirt", remoteValue: "Remote Shirt" },
        { field: "priceMinor", localValue: "1000", remoteValue: "2500" },
        { field: "stockQuantity", localValue: 5, remoteValue: 3 },
        { field: "description", localValue: "local desc", remoteValue: "remote desc" },
      ],
    });
    prisma.product.rows[0].description = "local desc";
    prisma.product.rows[0].compareAtMinor = null;
  }

  it("CP1 per_field: applies EXACTLY the chosen sides, resolves before enqueue, audits choices", async () => {
    const { svc, prisma, pushLog, audits } = makeSvc();
    seedPerField(prisma);
    const choices = { name: "remote", priceMinor: "local", stockQuantity: "remote", description: "local" };
    const result = await svc.resolveConflict("org-1", "u1", "c1", "per_field", choices);
    expect(result.status).toBe("resolved");
    expect(result.resolution).toBe("per_field");
    const product = prisma.product.rows[0];
    expect(product.name).toBe("Remote Shirt"); // remote chosen
    expect(product.priceMinor).toBe(1000n); // local chosen — untouched
    expect(product.stockQuantity).toBe(3); // remote chosen
    expect(product.description).toBe("local desc"); // local chosen — untouched
    // keep_local ordering: resolved + pending BEFORE the forced push.
    expect(pushLog).toHaveLength(1);
    expect(pushLog[0].kind).toBe("enqueueProductPush");
    expect(pushLog[0].opts).toEqual({ listingId: "l1", force: true });
    expect(pushLog[0].conflictStatusAtCall).toBe("resolved");
    expect(pushLog[0].listingStatusAtCall).toBe("pending");
    const audit = audits.find((a: any) => a.action === "commerce.conflict_resolve");
    expect(audit.metadata.choice).toBe("per_field");
    expect(audit.metadata.choices).toEqual(choices);
  });

  it("CP1 per_field: missing choice 400s naming the missing field (Bengali)", async () => {
    const { svc, prisma } = makeSvc();
    seedPerField(prisma);
    await expect(
      svc.resolveConflict("org-1", "u1", "c1", "per_field", { name: "remote", priceMinor: "local", stockQuantity: "remote" }),
    ).rejects.toThrow(/description/);
    await expect(
      svc.resolveConflict("org-1", "u1", "c1", "per_field", { name: "remote", priceMinor: "local", stockQuantity: "remote" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.syncConflict.rows[0].status).toBe("open");
  });

  it("CP1 per_field: unknown field 400s", async () => {
    const { svc, prisma } = makeSvc();
    seedPerField(prisma);
    await expect(
      svc.resolveConflict("org-1", "u1", "c1", "per_field", {
        name: "remote", priceMinor: "local", stockQuantity: "remote", description: "local", sku: "remote",
      }),
    ).rejects.toThrow(/sku/);
    expect(prisma.syncConflict.rows[0].status).toBe("open");
  });

  it("CP1 per_field: 400s when the conflict carries no fieldDiffs", async () => {
    const { svc, prisma } = makeSvc();
    seedListingAndConflict(prisma); // legacy row — no fieldDiffs
    await expect(svc.resolveConflict("org-1", "u1", "c1", "per_field", { name: "remote" }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("CommerceService listing actions", () => {
  it("channel-price: validates, stores BigInt, returns string, enqueues only when published", async () => {
    const { svc, prisma, pushLog } = makeSvc();
    seedListingAndConflict(prisma);
    const updated = await svc.updateChannelPrice("org-1", "u1", "l1", { channelPriceMinor: "5000" });
    expect(prisma.storeListing.rows[0].channelPriceMinor).toBe(5000n);
    expect(updated.channelPriceMinor).toBe("5000");
    expect(pushLog.filter((l: any) => l.kind === "enqueueProductPush")).toHaveLength(1);

    await expect(svc.updateChannelPrice("org-1", "u1", "l1", { channelPriceMinor: "12.5" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.updateChannelPrice("org-1", "u1", "l1", { channelPriceMinor: "abc" })).rejects.toBeInstanceOf(BadRequestException);

    // Draft listing: price stored, no push.
    prisma.storeListing.rows[0].publishState = "draft";
    pushLog.length = 0;
    const cleared = await svc.updateChannelPrice("org-1", "u1", "l1", { channelPriceMinor: null });
    expect(cleared.channelPriceMinor).toBeNull();
    expect(pushLog).toHaveLength(0);
  });

  it("delete-remote: outbox-only (nothing is deleted directly), key shape is stable", async () => {
    const { svc, prisma, outboxCalls } = makeSvc();
    seedListingAndConflict(prisma);
    const row = await svc.deleteListingRemote("org-1", "u1", "l1");
    expect(outboxCalls).toHaveLength(1);
    expect(outboxCalls[0].operation).toBe("delete_product_remote");
    expect(outboxCalls[0].idempotencyKey).toBe("delete_remote:l1:ext-1");
    expect(outboxCalls[0].payload).toEqual({ listingId: "l1", productId: "p1" });
    expect(row.operation).toBe("delete_product_remote");
    // The listing itself is untouched by this call.
    expect(prisma.storeListing.rows).toHaveLength(1);
  });

  it("unpublish: sets draft and force-enqueues the push", async () => {
    const { svc, prisma, pushLog } = makeSvc();
    seedListingAndConflict(prisma);
    const updated = await svc.unpublishListing("org-1", "u1", "l1");
    expect(updated.publishState).toBe("draft");
    expect(pushLog).toHaveLength(1);
    expect(pushLog[0].opts).toEqual({ listingId: "l1", force: true });
  });

  it("sale-schedule: rejects bad dates and end<start, applies boundary on success", async () => {
    const { svc, prisma, pushLog } = makeSvc();
    seedListingAndConflict(prisma);
    await expect(svc.updateSaleSchedule("org-1", "u1", "l1", { saleStartsAt: "not-a-date" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.updateSaleSchedule("org-1", "u1", "l1", {
      saleStartsAt: "2026-11-10T00:00:00.000Z", saleEndsAt: "2026-11-01T00:00:00.000Z",
    })).rejects.toBeInstanceOf(BadRequestException);
    const updated = await svc.updateSaleSchedule("org-1", "u1", "l1", {
      saleStartsAt: "2026-11-01T00:00:00.000Z", saleEndsAt: "2026-11-10T00:00:00.000Z",
    });
    expect(new Date(updated.saleStartsAt).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(pushLog.some((l: any) => l.kind === "applySaleBoundary" && l.listingId === "l1")).toBe(true);
  });

  it("404s listing actions for a foreign-org listing", async () => {
    const { svc, prisma } = makeSvc();
    seedListingAndConflict(prisma);
    prisma.storeListing.rows[0].organizationId = "org-2";
    await expect(svc.publishListing("org-1", "u1", "l1")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("CommerceService locations", () => {
  it("creating a default location unsets the previous default", async () => {
    const { svc, prisma, audits } = makeSvc();
    prisma.store.rows.push({ id: "s1", organizationId: "org-1", platform: "WOOCOMMERCE", name: "Shop" });
    prisma.storeLocation.rows.push({ id: "loc-a", organizationId: "org-1", storeId: "s1", name: "Main", isDefault: true, createdAt: new Date() });
    const created = await svc.createLocation("org-1", "u1", "s1", { name: "Warehouse", isDefault: true });
    expect(created.isDefault).toBe(true);
    expect(prisma.storeLocation.rows.find((r: any) => r.id === "loc-a").isDefault).toBe(false);
    expect(audits.some((a: any) => a.action === "commerce.location_create")).toBe(true);
  });

  it("patching a location to default unsets the others; delete removes the row", async () => {
    const { svc, prisma } = makeSvc();
    prisma.store.rows.push({ id: "s1", organizationId: "org-1", platform: "WOOCOMMERCE", name: "Shop" });
    prisma.storeLocation.rows.push(
      { id: "loc-a", organizationId: "org-1", storeId: "s1", name: "Main", isDefault: true, createdAt: new Date() },
      { id: "loc-b", organizationId: "org-1", storeId: "s1", name: "Branch", isDefault: false, createdAt: new Date() },
    );
    await svc.updateLocation("org-1", "u1", "loc-b", { isDefault: true });
    expect(prisma.storeLocation.rows.find((r: any) => r.id === "loc-a").isDefault).toBe(false);
    expect(prisma.storeLocation.rows.find((r: any) => r.id === "loc-b").isDefault).toBe(true);
    await svc.deleteLocation("org-1", "u1", "loc-b");
    expect(prisma.storeLocation.rows.map((r: any) => r.id)).toEqual(["loc-a"]);
  });

  it("refresh refuses non-Shopify stores", async () => {
    const { svc, prisma } = makeSvc();
    prisma.store.rows.push({ id: "s1", organizationId: "org-1", platform: "WOOCOMMERCE", name: "Shop" });
    await expect(svc.refreshLocations("org-1", "u1", "s1")).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("CommerceService CP3 weight-unit override (updateSyncMode surface)", () => {
  it("weightUnit-only update persists + audits; invalid unit 400s; syncMode still works", async () => {
    const { svc, prisma, audits } = makeSvc();
    prisma.store.rows.push({ id: "s1", organizationId: "org-1", platform: "WOOCOMMERCE", name: "Shop", syncMode: "mirror", weightUnit: null });
    const updated = await svc.updateSyncMode("org-1", "u1", "s1", { weightUnit: "lb" });
    expect(updated.weightUnit).toBe("lb");
    expect(updated.syncMode).toBe("mirror"); // untouched
    expect(audits.some((a: any) => a.action === "store.sync_mode" && a.metadata?.weightUnit === "lb")).toBe(true);
    await expect(svc.updateSyncMode("org-1", "u1", "s1", { weightUnit: "stone" })).rejects.toBeInstanceOf(BadRequestException);
    const cleared = await svc.updateSyncMode("org-1", "u1", "s1", { weightUnit: null });
    expect(cleared.weightUnit).toBeNull();
    const mode = await svc.updateSyncMode("org-1", "u1", "s1", { syncMode: "full-manage" });
    expect(mode.syncMode).toBe("full-manage");
  });
});

describe("CommerceService listings list stockDiverged", () => {
  it("flags diverged stock and suppresses the flag while a push is pending", async () => {
    const { svc, prisma } = makeSvc();
    prisma.storeListing.rows.push(
      {
        id: "l1", organizationId: "org-1", storeId: "s1", productId: "p1", externalId: "ext-1",
        syncStatus: "synced", publishState: "published", channelPriceMinor: 700n, channelStock: 5,
        product: { name: "A", sku: "A-1", stockQuantity: 8 }, createdAt: new Date(), updatedAt: new Date(),
      },
      {
        id: "l2", organizationId: "org-1", storeId: "s1", productId: "p2", externalId: "ext-2",
        syncStatus: "synced", publishState: "published", channelPriceMinor: null, channelStock: 5,
        product: { name: "B", sku: "B-1", stockQuantity: 8 }, createdAt: new Date(), updatedAt: new Date(),
      },
    );
    // p2 has a push in flight — its stock gap is expected, not diverged.
    prisma.syncOutbox.rows.push({ id: "o1", organizationId: "org-1", storeId: "s1", entityType: "product", entityId: "p2", status: "pending" });
    const result = await svc.listingsSummaryAndList("org-1", {});
    const byId = new Map(result.items.map((i: any) => [i.id, i]));
    expect(byId.get("l1").stockDiverged).toBe(true);
    expect(byId.get("l2").stockDiverged).toBe(false);
    expect(byId.get("l1").channelPriceMinor).toBe("700");
    expect(result.summary.total).toBe(2);
  });
});
