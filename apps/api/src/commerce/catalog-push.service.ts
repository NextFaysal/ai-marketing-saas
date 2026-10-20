import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SyncOutboxService } from "./sync-outbox.service";
import { loadPushContent } from "../integrations/commerce/catalog-content";
import { notFound } from "../i18n";

/**
 * EC3 — catalog push orchestration.
 *
 * ProductsService (and any other writer of canonical catalog
 * data) never talks to a store directly: it calls this service,
 * which decides — per StoreListing — whether a change needs an
 * outbound push at all and enqueues it on the durable SyncOutbox
 * (same dedupe / retry / verbatim-failure discipline as EC1).
 *
 * Rules (all deliberate, all documented here because they are
 * the contract the adapters and the Sync Center rely on):
 *  - Only stores whose syncMode is "full-manage" ever receive
 *    catalog pushes. mirror = inbound only, co-manage = order
 *    side only; neither is enqueued here, ever.
 *  - Only listings in publishState "published" are pushed,
 *    unless `force` is passed (publish flow / sale boundary).
 *  - A CONFLICTED listing is ALWAYS skipped — even with force.
 *    `force` bypasses the published-only rule, never the
 *    conflict pause: pushing over an unresolved local/remote
 *    divergence would silently pick a winner the merchant
 *    never approved. The conflict must be resolved first.
 *  - The idempotency key embeds the push-content hash, so
 *    re-enqueueing an unchanged product is a no-op at the
 *    outbox level (SyncOutboxService.enqueue returns the
 *    existing row for a known key).
 *
 * Fake-friendly data access (spec-ability): listings and
 * stores are loaded org-scoped with plain equality filters and
 * the syncMode filter is applied in JS — relation filters in
 * `where` are not assumed.
 */
@Injectable()
export class CatalogPushService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: SyncOutboxService,
  ) {}

  /** All listings of a product whose store is full-manage.
   *  Each returned listing carries its `store` row attached. */
  async fullManageListings(organizationId: string, productId: string): Promise<any[]> {
    const listingTable = (this.prisma as any).storeListing;
    if (!listingTable?.findMany) return [];
    const listings: any[] =
      (await listingTable.findMany({ where: { organizationId, productId } })) ?? [];
    if (!listings.length) return [];
    const storeTable = (this.prisma as any).store;
    let stores: any[] = [];
    if (storeTable?.findMany) {
      stores = (await storeTable.findMany({ where: { organizationId } })) ?? [];
    }
    const byId = new Map<string, any>((stores ?? []).map((s: any) => [s.id, s]));
    return listings
      .filter((l: any) => byId.get(l.storeId)?.syncMode === "full-manage")
      .map((l: any) => ({ ...l, store: byId.get(l.storeId) }));
  }

  /** Conflicted = the listing itself is flagged conflict, or an
   *  open SyncConflict row exists for it. */
  async isConflicted(organizationId: string, listing: any): Promise<boolean> {
    if (!listing) return false;
    if (listing.syncStatus === "conflict") return true;
    const table = (this.prisma as any).syncConflict;
    if (!table?.findFirst) return false;
    try {
      const open = await table.findFirst({
        where: { organizationId, listingId: listing.id, status: "open" },
      });
      return !!open;
    } catch {
      return false;
    }
  }

  private async markPending(listing: any): Promise<void> {
    if (listing.syncStatus === "pending") return;
    try {
      await (this.prisma as any).storeListing.update({
        where: { id: listing.id },
        data: { syncStatus: "pending" },
      });
    } catch {
      /* bookkeeping only — the outbox row is the durable record */
    }
  }

  async enqueueProductPush(
    organizationId: string,
    productId: string,
    opts: { listingId?: string; force?: boolean } = {},
  ): Promise<{ enqueued: number; skipped: number }> {
    let enqueued = 0;
    let skipped = 0;
    let listings = await this.fullManageListings(organizationId, productId);
    if (opts.listingId) listings = listings.filter((l: any) => l.id === opts.listingId);
    for (const listing of listings) {
      if (listing.publishState !== "published" && !opts.force) {
        skipped++;
        continue;
      }
      // Conflict pause is absolute — see the class docblock.
      if (await this.isConflicted(organizationId, listing)) {
        skipped++;
        continue;
      }
      const { hash } = await loadPushContent(this.prisma, organizationId, listing);
      const row = await this.outbox.enqueue({
        organizationId,
        storeId: listing.storeId,
        entityType: "product",
        entityId: productId,
        operation: "push_product",
        payload: { listingId: listing.id, productId },
        idempotencyKey: `push_product:${listing.id}:${hash}`,
      });
      if (row?.status === "pending") {
        await this.markPending(listing);
        enqueued++;
      } else {
        // A row already exists in a non-pending state for this
        // exact content hash (e.g. already pushed) — deduped.
        skipped++;
      }
    }
    return { enqueued, skipped };
  }

  /** Hook for "the canonical product changed" — published-only
   *  by default; content-hash dedupe makes no-change calls
   *  cheap no-ops. */
  async enqueueForProductChange(organizationId: string, productId: string) {
    return this.enqueueProductPush(organizationId, productId);
  }

  async enqueueArchive(
    organizationId: string,
    productId: string,
  ): Promise<{ enqueued: number; skipped: number }> {
    let enqueued = 0;
    let skipped = 0;
    const listings = await this.fullManageListings(organizationId, productId);
    for (const listing of listings) {
      if (listing.publishState !== "published") {
        skipped++;
        continue;
      }
      if (await this.isConflicted(organizationId, listing)) {
        skipped++;
        continue;
      }
      const { hash } = await loadPushContent(this.prisma, organizationId, listing);
      const row = await this.outbox.enqueue({
        organizationId,
        storeId: listing.storeId,
        entityType: "product",
        entityId: productId,
        operation: "archive_product",
        payload: { listingId: listing.id, productId },
        idempotencyKey: `archive_product:${listing.id}:${hash}`,
      });
      if (row?.status === "pending") {
        await this.markPending(listing);
        enqueued++;
      } else {
        skipped++;
      }
    }
    return { enqueued, skipped };
  }

  async enqueueInventoryPush(
    organizationId: string,
    productId: string,
    variantId: string | null,
    quantity: number,
  ): Promise<{ enqueued: number; skipped: number }> {
    let enqueued = 0;
    let skipped = 0;
    const listings = await this.fullManageListings(organizationId, productId);
    for (const listing of listings) {
      if (listing.publishState !== "published") {
        skipped++;
        continue;
      }
      if (await this.isConflicted(organizationId, listing)) {
        skipped++;
        continue;
      }
      const row = await this.outbox.enqueue({
        organizationId,
        storeId: listing.storeId,
        entityType: "product",
        entityId: productId,
        operation: "push_inventory",
        payload: { listingId: listing.id, productId, variantId, quantity },
        idempotencyKey: `push_inventory:${listing.id}:${variantId ?? "-"}:${quantity}`,
      });
      if (row?.status === "pending") {
        await this.markPending(listing);
        enqueued++;
      } else {
        skipped++;
      }
    }
    return { enqueued, skipped };
  }

  /**
   * A brand-new canonical product gets a DRAFT listing on every
   * full-manage store that doesn't have one yet, so the merchant
   * can review/publish per channel. No push is enqueued here —
   * publishing is the explicit step that pushes.
   * Returns the number of listings created.
   */
  async createListingsForNewProduct(organizationId: string, productId: string): Promise<number> {
    const storeTable = (this.prisma as any).store;
    const listingTable = (this.prisma as any).storeListing;
    if (!storeTable?.findMany || !listingTable?.findMany || !listingTable?.create) return 0;
    const stores: any[] =
      (await storeTable.findMany({ where: { organizationId } })) ?? [];
    const fullManage = stores.filter((s: any) => s.syncMode === "full-manage");
    if (!fullManage.length) return 0;
    const existing: any[] =
      (await listingTable.findMany({ where: { organizationId, productId } })) ?? [];
    const haveStore = new Set(existing.map((l: any) => l.storeId));
    let created = 0;
    for (const store of fullManage) {
      if (haveStore.has(store.id)) continue;
      await listingTable.create({
        data: {
          organizationId,
          storeId: store.id,
          productId,
          externalId: "",
          publishState: "draft",
          syncStatus: "pending",
        },
      });
      created++;
    }
    return created;
  }

  /** Publish one listing (draft → published) and push it.
   *  Throws NotFoundException for a foreign/absent listing —
   *  this is a direct API-facing operation. */
  async publishListing(organizationId: string, listingId: string) {
    const listing = await (this.prisma as any).storeListing.findFirst({
      where: { id: listingId, organizationId },
    });
    if (!listing) throw notFound("commerce.listingNotFoundInOrg");
    await (this.prisma as any).storeListing.update({
      where: { id: listing.id },
      data: { publishState: "published" },
    });
    return this.enqueueProductPush(organizationId, listing.productId, {
      listingId: listing.id,
      force: true,
    });
  }

  /**
   * EC3 scheduled sale: a listing's sale is active exactly when
   * a window exists and `now` is inside it (start inclusive,
   * end exclusive). When the computed state differs from the
   * stored saleActive, persist the flip and re-push the listing
   * (the compareAt/sale price in the push content follows the
   * boundary). Returns whether the state changed.
   */
  async applySaleBoundary(listing: any, now: Date): Promise<boolean> {
    const start = listing.saleStartsAt != null ? new Date(listing.saleStartsAt) : null;
    const end = listing.saleEndsAt != null ? new Date(listing.saleEndsAt) : null;
    const shouldActive =
      (start != null || end != null) &&
      (start == null || start.getTime() <= now.getTime()) &&
      (end == null || now.getTime() < end.getTime());
    if (shouldActive === Boolean(listing.saleActive)) return false;
    await (this.prisma as any).storeListing.update({
      where: { id: listing.id },
      data: { saleActive: shouldActive },
    });
    await this.enqueueProductPush(listing.organizationId, listing.productId, {
      listingId: listing.id,
      force: true,
    });
    return true;
  }

  async processSaleBoundariesForOrg(
    organizationId: string,
    now: Date = new Date(),
  ): Promise<{ checked: number; changed: number }> {
    const table = (this.prisma as any).storeListing;
    if (!table?.findMany) return { checked: 0, changed: 0 };
    const all: any[] =
      (await table.findMany({ where: { organizationId } })) ?? [];
    const withWindow = all.filter(
      (l: any) => l.saleStartsAt != null || l.saleEndsAt != null,
    );
    let changed = 0;
    for (const listing of withWindow) {
      if (await this.applySaleBoundary(listing, now)) changed++;
    }
    return { checked: withWindow.length, changed };
  }
}
