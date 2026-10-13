import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SyncOutboxService } from "./sync-outbox.service";
import { CatalogPushService } from "./catalog-push.service";
import { computeStockDiverged, pendingOutboxKeys } from "./stock-divergence";
import { decryptJson, encryptJson } from "../integrations/crypto";
import { exchangeShopifyClientCredentials, normalizeShopifyHost } from "../integrations/shopify/shopify-auth";
import { ShopifyGraphQLClient } from "../integrations/shopify/shopify-graphql.client";

const SYNC_MODES = ["mirror", "co-manage", "full-manage"] as const;

/** Listing rows carry BigInt money — the API shape is a string. */
function serializeListing(row: any): any {
  if (!row || typeof row !== "object") return row;
  return {
    ...row,
    channelPriceMinor: row.channelPriceMinor === null || row.channelPriceMinor === undefined ? null : String(row.channelPriceMinor),
  };
}

function pendingHas(pending: any, listing: any): boolean {
  if (!pending) return false;
  const has = typeof pending.has === "function"
    ? (k: string) => pending.has(k)
    : Array.isArray(pending)
      ? (k: string) => pending.includes(k)
      : () => false;
  const candidates = [
    `${listing.storeId}:${listing.productId}`,
    `${listing.storeId}|${listing.productId}`,
    `${listing.productId}:${listing.storeId}`,
    listing.productId,
    listing.id,
  ];
  return candidates.some((k) => { try { return has(k); } catch { return false; } });
}

@Injectable()
export class CommerceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: SyncOutboxService,
    private readonly catalogPush: CatalogPushService,
  ) {}

  private async auditLog(organizationId: string, actorId: string, action: string, entityType: string, entityId: string, metadata?: Record<string, unknown>) {
    await this.audit.log({ organizationId, userId: actorId, action, entityType, entityId, metadata }).catch(() => undefined);
  }

  private async findListingOrThrow(organizationId: string, listingId: string): Promise<any> {
    const listing = await (this.prisma as any).storeListing.findFirst({ where: { id: listingId, organizationId } });
    if (!listing) throw new NotFoundException("Listing not found in this organization");
    return listing;
  }

  private async findStoreOrThrow(organizationId: string, storeId: string): Promise<any> {
    const store = await (this.prisma as any).store.findFirst({ where: { id: storeId, organizationId } });
    if (!store) throw new NotFoundException("Store not found in this organization");
    return store;
  }

  async listingsSummaryAndList(
    organizationId: string,
    opts: { storeId?: string; status?: string; page?: number; pageSize?: number } = {},
  ) {
    const page = Math.max(1, Math.floor(opts.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Math.floor(opts.pageSize ?? 20) || 20));
    const baseWhere: Record<string, any> = { organizationId };
    if (opts.storeId) baseWhere.storeId = opts.storeId;

    const table = (this.prisma as any).storeListing;
    const countFor = async (extra: Record<string, any>) => {
      if (typeof table?.count === "function") {
        try { return await table.count({ where: { ...baseWhere, ...extra } }); } catch { /* fall through */ }
      }
      const rows = await table.findMany({ where: { ...baseWhere, ...extra } });
      return rows.length;
    };

    const [total, synced, pending, failed, conflict] = await Promise.all([
      countFor({}),
      countFor({ syncStatus: "synced" }),
      countFor({ syncStatus: "pending" }),
      countFor({ syncStatus: "failed" }),
      countFor({ syncStatus: "conflict" }),
    ]);

    const itemWhere: Record<string, any> = { ...baseWhere };
    if (opts.status) itemWhere.syncStatus = opts.status;
    let items: any[];
    try {
      items = await table.findMany({
        where: itemWhere,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { product: { select: { name: true, sku: true, stockQuantity: true } }, store: { select: { name: true, platform: true } } },
      });
    } catch {
      items = await table.findMany({ where: itemWhere, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize });
    }
    // EC4: per-item stock divergence (channel stock vs canonical
    // stock), suppressed while a push for the pair is still pending.
    let pendingKeys: any = null;
    try {
      pendingKeys = await pendingOutboxKeys(
        this.prisma as any,
        organizationId,
        (items ?? []).map((i: any) => ({ storeId: i.storeId, productId: i.productId })),
      );
    } catch { pendingKeys = null; }
    const mapped = (items ?? []).map((item: any) => {
      let stockDiverged = false;
      try {
        stockDiverged = computeStockDiverged(item, item.product?.stockQuantity ?? null, pendingHas(pendingKeys, item));
      } catch { stockDiverged = false; }
      return { ...serializeListing(item), stockDiverged };
    });
    return { summary: { total, synced, pending, failed, conflict }, items: mapped, page, pageSize };
  }

  async listConflicts(organizationId: string, opts: { status?: string } = {}) {
    const where: Record<string, any> = { organizationId };
    if (opts.status) where.status = opts.status;
    const table = (this.prisma as any).syncConflict;
    let rows: any[];
    try {
      rows = await table.findMany({
        where,
        take: 100,
        include: { listing: { select: { externalId: true, product: { select: { name: true } } } } },
      });
    } catch {
      try {
        rows = await table.findMany({ where, take: 100, include: { listing: { select: { externalId: true } } } });
      } catch {
        rows = await table.findMany({ where, take: 100 });
      }
    }
    const statusRank = (s: string) => (s === "open" ? 0 : 1);
    rows = [...(rows ?? [])].sort((a: any, b: any) => {
      const d = statusRank(a.status) - statusRank(b.status);
      if (d !== 0) return d;
      return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
    });
    return rows.slice(0, 100);
  }

  // ---------- EC3: conflict resolution ----------

  async resolveConflict(organizationId: string, actorId: string, conflictId: string, choice: string) {
    if (choice !== "keep_local" && choice !== "take_remote") {
      throw new BadRequestException('choice must be "keep_local" or "take_remote"');
    }
    const conflict = await (this.prisma as any).syncConflict.findFirst({ where: { id: conflictId, organizationId } });
    if (!conflict) throw new NotFoundException("Conflict not found in this organization");
    if (conflict.status !== "open") throw new BadRequestException("Conflict is already resolved");
    const listing = await (this.prisma as any).storeListing.findFirst({ where: { id: conflict.listingId, organizationId } });
    if (!listing) throw new NotFoundException("Listing not found in this organization");

    let resolved: any;
    if (choice === "keep_local") {
      // Resolution order matters: CatalogPushService skips listings
      // with an OPEN conflict even when forced — so the conflict is
      // marked resolved and the listing leaves "conflict" FIRST,
      // and only then is the (forced) push enqueued.
      resolved = await (this.prisma as any).syncConflict.update({
        where: { id: conflict.id },
        data: { status: "resolved", resolution: "local_wins" },
      });
      await (this.prisma as any).storeListing.update({ where: { id: listing.id }, data: { syncStatus: "pending" } });
      await this.catalogPush.enqueueProductPush(organizationId, listing.productId, { listingId: listing.id, force: true });
    } else {
      const product = await (this.prisma as any).product.findFirst({ where: { id: listing.productId, organizationId } });
      if (!product) throw new BadRequestException("Product no longer exists");
      const rv = (conflict.remoteValue ?? {}) as { name?: string; priceMinor?: string | number | bigint; status?: string; stockQuantity?: number; imageUrl?: string | null };
      const data: Record<string, any> = {};
      if (rv.name !== undefined && rv.name !== null) data.name = rv.name;
      if (rv.priceMinor !== undefined && rv.priceMinor !== null) data.priceMinor = BigInt(rv.priceMinor as any);
      if (rv.status !== undefined && rv.status !== null) data.status = rv.status;
      if (rv.stockQuantity !== undefined) data.stockQuantity = rv.stockQuantity;
      if (rv.imageUrl !== undefined) data.imageUrl = rv.imageUrl;
      if (Object.keys(data).length > 0) {
        await (this.prisma as any).product.update({ where: { id: product.id }, data });
      }
      resolved = await (this.prisma as any).syncConflict.update({
        where: { id: conflict.id },
        data: { status: "resolved", resolution: "remote_wins" },
      });
      await (this.prisma as any).storeListing.update({
        where: { id: listing.id },
        data: { syncStatus: "synced", lastSyncError: null },
      });
    }
    await this.auditLog(organizationId, actorId, "commerce.conflict_resolve", "SyncConflict", conflict.id, { choice, listingId: listing.id });
    return resolved;
  }

  // ---------- EC3/EC4: listing actions ----------

  async publishListing(organizationId: string, actorId: string, listingId: string) {
    const listing = await this.findListingOrThrow(organizationId, listingId);
    const result: any = await this.catalogPush.publishListing(organizationId, listingId);
    await this.auditLog(organizationId, actorId, "commerce.listing_publish", "StoreListing", listing.id);
    if (result === undefined || result === null) return serializeListing(listing);
    // CatalogPushService returns an { enqueued, skipped } summary —
    // pass it through verbatim; only listing-shaped results are
    // serialized (BigInt channel price → string).
    if (typeof result === "object" && ("publishState" in result || "channelPriceMinor" in result)) {
      return serializeListing(result);
    }
    return result;
  }

  async unpublishListing(organizationId: string, actorId: string, listingId: string) {
    const listing = await this.findListingOrThrow(organizationId, listingId);
    const updated = await (this.prisma as any).storeListing.update({
      where: { id: listing.id },
      data: { publishState: "draft" },
    });
    // force:true — enqueueProductPush skips non-published listings
    // without it; unpublishing must still reach the store.
    await this.catalogPush.enqueueProductPush(organizationId, listing.productId, { listingId: listing.id, force: true });
    await this.auditLog(organizationId, actorId, "commerce.listing_unpublish", "StoreListing", listing.id);
    return serializeListing(updated);
  }

  async updateChannelPrice(organizationId: string, actorId: string, listingId: string, dto: { channelPriceMinor?: string | null }) {
    const listing = await this.findListingOrThrow(organizationId, listingId);
    const raw = dto?.channelPriceMinor ?? null;
    let value: bigint | null = null;
    if (raw !== null) {
      if (typeof raw !== "string" || !/^-?\d+$/.test(raw.trim())) {
        throw new BadRequestException("channelPriceMinor must be an integer decimal string or null");
      }
      value = BigInt(raw.trim());
    }
    const updated = await (this.prisma as any).storeListing.update({
      where: { id: listing.id },
      data: { channelPriceMinor: value },
    });
    if ((updated?.publishState ?? listing.publishState) === "published") {
      await this.catalogPush.enqueueProductPush(organizationId, listing.productId, { listingId: listing.id });
    }
    await this.auditLog(organizationId, actorId, "commerce.listing_channel_price", "StoreListing", listing.id, {
      channelPriceMinor: value === null ? null : String(value),
    });
    return serializeListing(updated);
  }

  async updateSaleSchedule(
    organizationId: string,
    actorId: string,
    listingId: string,
    dto: { saleStartsAt?: string | null; saleEndsAt?: string | null },
  ) {
    const listing = await this.findListingOrThrow(organizationId, listingId);
    const parse = (v: string | null | undefined, field: string): Date | null | undefined => {
      if (v === undefined) return undefined;
      if (v === null) return null;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) throw new BadRequestException(`${field} is not a valid date`);
      return d;
    };
    const startsAt = parse(dto?.saleStartsAt, "saleStartsAt");
    const endsAt = parse(dto?.saleEndsAt, "saleEndsAt");
    const effectiveStart = startsAt !== undefined ? startsAt : (listing.saleStartsAt ? new Date(listing.saleStartsAt) : null);
    const effectiveEnd = endsAt !== undefined ? endsAt : (listing.saleEndsAt ? new Date(listing.saleEndsAt) : null);
    if (effectiveStart && effectiveEnd && effectiveEnd.getTime() < effectiveStart.getTime()) {
      throw new BadRequestException("saleEndsAt must not be before saleStartsAt");
    }
    const data: Record<string, any> = {};
    if (startsAt !== undefined) data.saleStartsAt = startsAt;
    if (endsAt !== undefined) data.saleEndsAt = endsAt;
    const updated = await (this.prisma as any).storeListing.update({ where: { id: listing.id }, data });
    const applied: any = this.catalogPush?.applySaleBoundary
      ? await this.catalogPush.applySaleBoundary(updated, new Date())
      : undefined;
    await this.auditLog(organizationId, actorId, "commerce.listing_sale_schedule", "StoreListing", listing.id, {
      saleStartsAt: updated?.saleStartsAt ?? null,
      saleEndsAt: updated?.saleEndsAt ?? null,
    });
    return serializeListing(applied && typeof applied === "object" ? applied : updated);
  }

  async deleteListingRemote(organizationId: string, actorId: string, listingId: string) {
    const listing = await this.findListingOrThrow(organizationId, listingId);
    // Outbox-only: the remote delete happens when the outbox is
    // processed by the platform adapter — never a direct call here.
    const row = await this.outbox.enqueue({
      organizationId,
      storeId: listing.storeId,
      entityType: "product",
      entityId: listing.productId,
      operation: "delete_product_remote",
      payload: { listingId: listing.id, productId: listing.productId },
      idempotencyKey: `delete_remote:${listing.id}:${listing.externalId}`,
    });
    await this.auditLog(organizationId, actorId, "commerce.listing_delete_remote", "StoreListing", listing.id);
    return row;
  }

  // ---------- EC4: store locations ----------

  async listLocations(organizationId: string, storeId: string) {
    await this.findStoreOrThrow(organizationId, storeId);
    return (this.prisma as any).storeLocation.findMany({
      where: { organizationId, storeId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
  }

  private async unsetOtherDefaults(organizationId: string, storeId: string) {
    const table = (this.prisma as any).storeLocation;
    if (typeof table?.updateMany === "function") {
      await table.updateMany({ where: { organizationId, storeId, isDefault: true }, data: { isDefault: false } });
      return;
    }
    const rows = await table.findMany({ where: { organizationId, storeId, isDefault: true } });
    for (const row of rows ?? []) {
      await table.update({ where: { id: row.id }, data: { isDefault: false } });
    }
  }

  async createLocation(organizationId: string, actorId: string, storeId: string, dto: { name: string; externalLocationId?: string; isDefault?: boolean }) {
    await this.findStoreOrThrow(organizationId, storeId);
    if (!dto?.name?.trim()) throw new BadRequestException("Location name is required");
    if (dto.isDefault) await this.unsetOtherDefaults(organizationId, storeId);
    const created = await (this.prisma as any).storeLocation.create({
      data: {
        organizationId,
        storeId,
        name: dto.name.trim(),
        externalLocationId: dto.externalLocationId ?? null,
        isDefault: !!dto.isDefault,
      },
    });
    await this.auditLog(organizationId, actorId, "commerce.location_create", "StoreLocation", created.id);
    return created;
  }

  async updateLocation(organizationId: string, actorId: string, locationId: string, dto: { name?: string; isDefault?: boolean }) {
    const location = await (this.prisma as any).storeLocation.findFirst({ where: { id: locationId, organizationId } });
    if (!location) throw new NotFoundException("Location not found in this organization");
    if (dto?.isDefault === true) await this.unsetOtherDefaults(organizationId, location.storeId);
    const data: Record<string, any> = {};
    if (dto?.name !== undefined) data.name = dto.name.trim();
    if (dto?.isDefault !== undefined) data.isDefault = dto.isDefault;
    const updated = await (this.prisma as any).storeLocation.update({ where: { id: location.id }, data });
    await this.auditLog(organizationId, actorId, "commerce.location_update", "StoreLocation", location.id);
    return updated;
  }

  async deleteLocation(organizationId: string, actorId: string, locationId: string) {
    const location = await (this.prisma as any).storeLocation.findFirst({ where: { id: locationId, organizationId } });
    if (!location) throw new NotFoundException("Location not found in this organization");
    await (this.prisma as any).storeLocation.delete({ where: { id: location.id } });
    await this.auditLog(organizationId, actorId, "commerce.location_delete", "StoreLocation", location.id);
    return { deleted: true };
  }

  /**
   * EC4: pull the shop's real locations from Shopify GraphQL and
   * upsert them as StoreLocation rows. Mirrors ShopifyService's
   * client-credentials refresh (exchange + persist) so an expired
   * Dev Dashboard token is renewed the same way everywhere.
   */
  async refreshLocations(organizationId: string, actorId: string, storeId: string) {
    const store = await this.findStoreOrThrow(organizationId, storeId);
    if (store.platform !== "SHOPIFY") {
      throw new BadRequestException("শুধুমাত্র Shopify স্টোরের লোকেশন সিঙ্ক করা যায়");
    }
    let integration: any = null;
    try {
      integration = await (this.prisma as any).integration.findFirst({
        where: { organizationId, storeId, provider: "shopify" },
        include: { credential: true, store: true },
      });
    } catch {
      integration = await (this.prisma as any).integration.findFirst({ where: { organizationId, storeId, provider: "shopify" } });
    }
    if (!integration) throw new BadRequestException("Shopify integration not connected");
    let credential = integration.credential ?? null;
    if (!credential && typeof (this.prisma as any).integrationCredential?.findFirst === "function") {
      credential = await (this.prisma as any).integrationCredential.findFirst({ where: { integrationId: integration.id } }).catch(() => null);
    }
    if (!credential?.encryptedData) throw new BadRequestException("Shopify integration not connected");

    const secrets = decryptJson<any>(credential.encryptedData);
    let accessToken: string = secrets.accessToken;
    const authType = secrets.authType ?? integration.authType;
    if (authType === "client_credentials") {
      const expiresAt = integration.tokenExpiresAt ? new Date(integration.tokenExpiresAt) : null;
      const nonExpiring = !!accessToken && (integration.tokenExpiresAt === null || integration.tokenExpiresAt === undefined);
      const stillValid = !!accessToken && !!expiresAt && expiresAt.getTime() > Date.now() + 5 * 60 * 1000;
      if (!nonExpiring && !stillValid) {
        if (!secrets.clientId || !secrets.clientSecret) {
          throw new BadRequestException("Shopify client credentials are missing; reconnect with clientId/clientSecret");
        }
        const host = normalizeShopifyHost(integration.store?.url ?? store.url);
        let exchanged: { accessToken: string; expiresIn: number | null; scope: string | null };
        try {
          exchanged = await exchangeShopifyClientCredentials(host, secrets.clientId, secrets.clientSecret);
        } catch (e) {
          throw new BadRequestException(e instanceof Error ? e.message : "unknown error");
        }
        const next = { ...secrets, accessToken: exchanged.accessToken, apiSecret: secrets.clientSecret };
        const tokenExpiresAt = exchanged.expiresIn ? new Date(Date.now() + exchanged.expiresIn * 1000) : null;
        await (this.prisma as any).integrationCredential.upsert({
          where: { integrationId: integration.id },
          update: { encryptedData: encryptJson(next) },
          create: { integrationId: integration.id, encryptedData: encryptJson(next) },
        });
        await (this.prisma as any).integration.update({ where: { id: integration.id }, data: { tokenExpiresAt } });
        accessToken = exchanged.accessToken;
      }
    }

    const client = new ShopifyGraphQLClient(integration.store?.url ?? store.url, accessToken);
    const data = await client.request<any>(
      `query { locations(first: 50) { edges { node { id name isActive } } } }`,
    );
    const edges: any[] = data?.locations?.edges ?? [];
    const table = (this.prisma as any).storeLocation;
    let imported = 0;
    for (const edge of edges) {
      const node = edge?.node;
      if (!node || node.isActive === false) continue;
      const externalLocationId = String(node.id ?? "").split("/").pop() ?? "";
      if (!externalLocationId) continue;
      const existing = await table.findFirst({ where: { storeId, externalLocationId } });
      if (existing) {
        await table.update({ where: { id: existing.id }, data: { name: node.name } });
      } else {
        await table.create({
          data: { organizationId, storeId, name: node.name, externalLocationId, isDefault: false },
        });
      }
      imported++;
    }
    let locations = await table.findMany({ where: { organizationId, storeId } });
    if (imported > 0 && (locations ?? []).length > 0 && !(locations as any[]).some((l: any) => l.isDefault)) {
      const first = (locations as any[])[0];
      await table.update({ where: { id: first.id }, data: { isDefault: true } });
      locations = await table.findMany({ where: { organizationId, storeId } });
    }
    await this.auditLog(organizationId, actorId, "commerce.locations_refresh", "Store", store.id, { imported });
    return { locations, imported };
  }

  async replayOutbox(organizationId: string, actorId: string, id: string) {
    const result = await this.outbox.replay(organizationId, id);
    await this.audit.log({
      organizationId,
      userId: actorId,
      action: "commerce.outbox_replay",
      entityType: "SyncOutbox",
      entityId: id,
    }).catch(() => undefined);
    return result;
  }

  /** EC5 (plan §৯): the refund-push gate toggle. OWNER-only at the
   *  route; audit-logged here with from/to, like updateSyncMode. */
  async updateRefundPush(organizationId: string, actorId: string, storeId: string, enabled: boolean) {
    const store = await (this.prisma as any).store.findFirst({ where: { id: storeId, organizationId } });
    if (!store) throw new NotFoundException("Store not found in this organization");
    const from = store.refundPushEnabled === true;
    const updated = await (this.prisma as any).store.update({ where: { id: store.id }, data: { refundPushEnabled: enabled } });
    await this.auditLog(organizationId, actorId, "store.refund_push_toggle", "Store", store.id, { from, to: enabled });
    return updated;
  }

  /** EC5: shipment-plugin tracking meta key for Woo fulfilments. */
  async updateTrackingMetaKey(organizationId: string, actorId: string, storeId: string, key: string | null) {
    const store = await (this.prisma as any).store.findFirst({ where: { id: storeId, organizationId } });
    if (!store) throw new NotFoundException("Store not found in this organization");
    const value = key != null && String(key).trim() !== "" ? String(key).trim() : null;
    const updated = await (this.prisma as any).store.update({ where: { id: store.id }, data: { courierTrackingMetaKey: value } });
    await this.auditLog(organizationId, actorId, "store.tracking_meta_key", "Store", store.id, { set: value !== null });
    return updated;
  }

  async updateSyncMode(
    organizationId: string,
    actorId: string,
    storeId: string,
    dto: { syncMode: string; fieldOwnership?: Record<string, unknown> },
  ) {
    const store = await (this.prisma as any).store.findFirst({ where: { id: storeId, organizationId } });
    if (!store) throw new NotFoundException("Store not found in this organization");
    if (!(SYNC_MODES as readonly string[]).includes(dto.syncMode)) {
      throw new BadRequestException("syncMode must be mirror, co-manage, or full-manage");
    }
    const from = store.syncMode ?? "mirror";
    const data: Record<string, any> = { syncMode: dto.syncMode };
    if (dto.fieldOwnership !== undefined) data.fieldOwnership = dto.fieldOwnership;
    const updated = await (this.prisma as any).store.update({ where: { id: store.id }, data });
    await this.audit.log({
      organizationId,
      userId: actorId,
      action: "store.sync_mode",
      entityType: "Store",
      entityId: store.id,
      metadata: { from, to: dto.syncMode },
    }).catch(() => undefined);
    return updated;
  }
}
