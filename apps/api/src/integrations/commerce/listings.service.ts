import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { stableContentHash } from "./content-hash";

@Injectable()
export class ListingsService {
  constructor(private readonly prisma: PrismaService) {}

  async recordInboundProduct(
    organizationId: string,
    storeId: string | null,
    productId: string,
    externalId: string | null,
    content: Record<string, unknown>,
    remoteUpdatedAt?: Date,
  ): Promise<void> {
    if (!storeId || !externalId) return;
    const hash = stableContentHash(content);
    const stock = (content as any)?.stockQuantity;
    const hasStock = typeof stock === "number";
    const now = new Date();
    const lastRemoteUpdatedAt = remoteUpdatedAt ?? now;
    const table = (this.prisma as any).storeListing;
    // EC3: an open conflict must survive inbound sync — load the
    // existing row first so the update branch can omit syncStatus
    // instead of silently clearing the conflict back to "synced".
    let existing: any = null;
    try {
      if (typeof table?.findUnique === "function") {
        existing = await table.findUnique({ where: { storeId_productId: { storeId, productId } } });
      } else if (typeof table?.findMany === "function") {
        const rows = await table.findMany({ where: { storeId, productId } });
        existing = (rows ?? []).find((r: any) => r.storeId === storeId && r.productId === productId) ?? null;
      }
    } catch { existing = null; }
    const preserveConflict = existing?.syncStatus === "conflict";
    await table.upsert({
      where: { storeId_productId: { storeId, productId } },
      create: {
        organizationId,
        storeId,
        productId,
        externalId,
        syncStatus: "synced",
        lastRemoteHash: hash,
        channelStock: hasStock ? stock : undefined,
        lastRemoteUpdatedAt,
        lastSyncError: null,
      },
      update: {
        organizationId,
        externalId,
        ...(preserveConflict ? {} : { syncStatus: "synced" }),
        lastRemoteHash: hash,
        ...(hasStock ? { channelStock: stock } : {}),
        lastRemoteUpdatedAt,
        lastSyncError: null,
      },
    });
  }

  /**
   * EC3: detect a genuine inbound conflict — the remote content
   * changed since we last saw it AND local work is in flight
   * (a pending/processing outbox push for this product) or the
   * local content has diverged from what we last pushed. A remote
   * change with a clean local side is NOT a conflict: the normal
   * inbound path (recordInboundProduct) simply applies it.
   * Returns the open SyncConflict row, or null when there is none.
   */
  async detectInboundConflict(input: {
    organizationId: string;
    storeId: string;
    productId: string;
    localContent: Record<string, unknown>;
    remoteContent: Record<string, unknown>;
    remoteUpdatedAt?: Date;
  }): Promise<any | null> {
    const { organizationId, storeId, productId } = input;
    const listingTable = (this.prisma as any).storeListing;
    const conflictTable = (this.prisma as any).syncConflict;
    if (!listingTable?.findFirst || !conflictTable?.findFirst || !conflictTable?.create) return null;
    const listing = await listingTable.findFirst({ where: { organizationId, storeId, productId } });
    if (!listing || !listing.externalId) return null;

    const newRemoteHash = stableContentHash(input.remoteContent);
    if (listing.lastRemoteHash === newRemoteHash) return null; // remote unchanged

    // Dedupe: one open conflict per listing is enough.
    const existing = await conflictTable.findFirst({ where: { listingId: listing.id, status: "open" } }).catch(() => null);
    if (existing) {
      if (listing.syncStatus !== "conflict") {
        await listingTable.update({ where: { id: listing.id }, data: { syncStatus: "conflict" } }).catch(() => undefined);
      }
      return existing;
    }

    // Pending local work? (findMany + JS filter — fake-friendly,
    // no reliance on the `in` operator.)
    let pendingWork = false;
    try {
      const outboxTable = (this.prisma as any).syncOutbox;
      if (typeof outboxTable?.findMany === "function") {
        const rows = await outboxTable.findMany({
          where: { organizationId, storeId, entityType: "product", entityId: productId },
        });
        pendingWork = (rows ?? []).some((r: any) => r.status === "pending" || r.status === "processing");
      }
    } catch { pendingWork = false; }

    const localDiverged = listing.lastPushedHash
      ? stableContentHash(input.localContent) !== listing.lastPushedHash
      : false;
    if (!pendingWork && !localDiverged) return null;

    const conflict = await conflictTable.create({
      data: {
        organizationId,
        storeId,
        listingId: listing.id,
        field: "product",
        localValue: input.localContent,
        remoteValue: input.remoteContent,
        status: "open",
      },
    });
    await listingTable.update({ where: { id: listing.id }, data: { syncStatus: "conflict" } }).catch(() => undefined);
    return conflict;
  }

  async touchForOrderItem(
    organizationId: string,
    storeId: string | null,
    productId: string,
    externalProductId: string | null,
    channelStock: number | null,
  ): Promise<void> {
    if (!storeId || !externalProductId || !productId) return;
    const hasStock = typeof channelStock === "number";
    await (this.prisma as any).storeListing.upsert({
      where: { storeId_productId: { storeId, productId } },
      create: {
        organizationId,
        storeId,
        productId,
        externalId: externalProductId,
        syncStatus: "synced",
        channelStock: hasStock ? channelStock : undefined,
        lastRemoteUpdatedAt: new Date(),
        lastSyncError: null,
      },
      update: {
        organizationId,
        externalId: externalProductId,
        ...(hasStock ? { channelStock } : {}),
      },
    });
  }
}
