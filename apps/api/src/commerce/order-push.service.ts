import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SyncOutboxService } from "./sync-outbox.service";
import { badRequest, notFound } from "../i18n";

/**
 * EC5 — order push orchestration (the CatalogPushService sibling).
 *
 * Rules:
 *  - Order-side pushes happen only for stores in "co-manage" or
 *    "full-manage" (plan §২: orders are the co-manage tier;
 *    catalog needs full-manage and lives in CatalogPushService).
 *    mirror = nothing is ever enqueued; callers surface that state
 *    to the UI rather than pretending a push happened.
 *  - REFUND GATE (plan §৯, owner decision): a platform refund is
 *    enqueued ONLY when Store.refundPushEnabled is true. The flag
 *    defaults false in the schema; this service treats anything
 *    other than literal true as OFF. When gated, the local refund
 *    record stands (S2 behaviour) and the caller reports the
 *    "স্টোরে refund push বন্ধ আছে" state.
 *  - Internal order notes NEVER reach this service — there is no
 *    code path from internalNote to a store note here.
 *  - Every hook is failure-isolated by its CALLER; this service
 *    itself throws only for direct API actions (draft creation,
 *    manual note push), where the merchant asked and must see why.
 */
@Injectable()
export class OrderPushService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: SyncOutboxService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  async loadOrder(organizationId: string, orderId: string): Promise<any | null> {
    try {
      return await (this.prisma as any).order.findFirst({ where: { id: orderId, organizationId } });
    } catch {
      return null;
    }
  }

  async loadStore(organizationId: string, storeId: string | null | undefined): Promise<any | null> {
    if (!storeId) return null;
    try {
      return await (this.prisma as any).store.findFirst({ where: { id: storeId, organizationId } });
    } catch {
      return null;
    }
  }

  static orderEligible(store: any): boolean {
    return !!store && (store.syncMode === "co-manage" || store.syncMode === "full-manage");
  }

  private async enqueue(organizationId: string, store: any, order: any, operation: string, payload: Record<string, any>) {
    const row = await this.outbox.enqueue({
      organizationId,
      storeId: store.id,
      entityType: "order",
      entityId: order.id,
      operation,
      payload: { orderId: order.id, ...payload },
      idempotencyKey: `${operation}:${order.id}:${randomUUID()}`,
    });
    return row;
  }

  /** The resolution every order hook shares: order -> store ->
   *  eligible? Returns a reason string when no push can happen. */
  async resolve(organizationId: string, order: any): Promise<{ store: any } | { reason: string }> {
    if (!order) return { reason: "order_not_found" };
    if (!order.storeId) return { reason: "order_has_no_store" };
    const store = await this.loadStore(organizationId, order.storeId);
    if (!store) return { reason: "store_not_found" };
    if (!OrderPushService.orderEligible(store)) return { reason: "sync_mode_mirror" };
    return { store };
  }

  async enqueueStatus(organizationId: string, orderId: string, status: string) {
    const order = await this.loadOrder(organizationId, orderId);
    const resolved = await this.resolve(organizationId, order);
    if ("reason" in resolved) return { enqueued: 0, reason: resolved.reason };
    const operation = status === "cancelled" ? "cancel_order" : "push_order_status";
    await this.enqueue(organizationId, resolved.store, order, operation, { status });
    return { enqueued: 1 };
  }

  /** THE REFUND GATE — see the class docblock. */
  async enqueueRefund(organizationId: string, orderId: string, input: { amountMinor: string; reason?: string; restock?: boolean }) {
    const order = await this.loadOrder(organizationId, orderId);
    const resolved = await this.resolve(organizationId, order);
    if ("reason" in resolved) return { enqueued: 0, reason: resolved.reason };
    if (resolved.store.refundPushEnabled !== true) {
      return { enqueued: 0, reason: "refund_push_disabled", gated: true };
    }
    await this.enqueue(organizationId, resolved.store, order, "push_refund", {
      amountMinor: input.amountMinor,
      reason: input.reason,
      restock: input.restock === true,
    });
    return { enqueued: 1 };
  }

  async enqueueNote(organizationId: string, orderId: string, note: string) {
    const order = await this.loadOrder(organizationId, orderId);
    if (!order) throw notFound("commerce.orderNotFoundInOrg");
    const resolved = await this.resolve(organizationId, order);
    if ("reason" in resolved) {
      if (resolved.reason === "sync_mode_mirror") throw badRequest("commerce.storeNoteMirrorBlocked");
      throw badRequest("commerce.storeNotePushFailed", { reason: resolved.reason });
    }
    const row = await this.enqueue(organizationId, resolved.store, order, "push_order_note", { note });
    return { enqueued: 1, outboxId: row?.id };
  }

  async enqueueAddress(organizationId: string, orderId: string, address: string) {
    const order = await this.loadOrder(organizationId, orderId);
    const resolved = await this.resolve(organizationId, order);
    if ("reason" in resolved) return { enqueued: 0, reason: resolved.reason };
    // Structured parts exist only when the linked customer's stored
    // address is an object with address_1 — Shopify needs them,
    // Woo takes the free string. Both are sent; each adapter uses
    // what its platform can truthfully accept.
    let addressParts: Record<string, any> | undefined;
    if (order.customerId) {
      try {
        const customer = await (this.prisma as any).customer.findFirst({ where: { id: order.customerId, organizationId } });
        const a = customer?.address;
        if (a && typeof a === "object" && (a.address_1 || a.address1)) {
          addressParts = {
            address1: a.address_1 ?? a.address1,
            city: a.city ?? undefined,
            province: a.state ?? a.province ?? undefined,
            zip: a.postcode ?? a.zip ?? undefined,
            country: a.country ?? undefined,
            phone: customer?.phone ?? undefined,
            firstName: customer?.firstName ?? undefined,
            lastName: customer?.lastName ?? undefined,
          };
        }
      } catch { /* parts are optional */ }
    }
    await this.enqueue(organizationId, resolved.store, order, "push_order_address", { address, ...(addressParts ? { addressParts } : {}) });
    return { enqueued: 1 };
  }

  async enqueueFulfillment(organizationId: string, orderId: string, input: { trackingCode: string; courierProvider?: string; fulfillmentId?: string }) {
    const order = await this.loadOrder(organizationId, orderId);
    const resolved = await this.resolve(organizationId, order);
    if ("reason" in resolved) return { enqueued: 0, reason: resolved.reason };
    await this.enqueue(organizationId, resolved.store, order, "create_fulfillment", {
      trackingCode: input.trackingCode,
      courierProvider: input.courierProvider,
      fulfillmentId: input.fulfillmentId,
    });
    return { enqueued: 1 };
  }

  /**
   * Turn a chat/manual order into a store draft order, NOW (not
   * via the background sweep): enqueue + process this one row,
   * then return the reloaded order. The adapter writes the
   * platform identity back onto the order (Shopify:
   * storeDraftId + storeInvoiceUrl; Woo: externalId link).
   */
  async createStoreDraft(organizationId: string, actorId: string, orderId: string, storeId?: string) {
    const order = await this.loadOrder(organizationId, orderId);
    if (!order) throw notFound("commerce.orderNotFoundInOrg");
    if (order.storeDraftId || (order.storeId && (order.source === "woocommerce" || order.source === "shopify"))) {
      throw badRequest("commerce.orderAlreadyInStore");
    }
    let store: any = null;
    if (storeId || order.storeId) {
      store = await this.loadStore(organizationId, storeId ?? order.storeId);
      if (!store) throw notFound("commerce.storeNotFoundInOrg");
      if (!OrderPushService.orderEligible(store)) {
        throw badRequest("commerce.mirrorModeDraftBlocked");
      }
    } else {
      const stores: any[] = (await (this.prisma as any).store.findMany({ where: { organizationId } }).catch(() => [])) ?? [];
      const eligible = stores.filter((s: any) => OrderPushService.orderEligible(s));
      if (eligible.length === 0) throw badRequest("commerce.noCoManageStore");
      if (eligible.length > 1) throw badRequest("commerce.multipleStoresPickOne");
      store = eligible[0];
    }
    const row = await this.outbox.enqueue({
      organizationId,
      storeId: store.id,
      entityType: "order",
      entityId: order.id,
      operation: "create_draft_order",
      payload: { orderId: order.id },
      idempotencyKey: `create_draft_order:${order.id}`,
    });
    if (row?.status === "done") {
      throw badRequest("commerce.orderDraftAlreadyCreated");
    }
    await this.outbox.processDue({ organizationId, onlyId: row.id });
    const after = await this.loadOrder(organizationId, orderId);
    const finalRow = await (this.prisma as any).syncOutbox.findFirst({ where: { id: row.id, organizationId } }).catch(() => row);
    await this.audit?.log({
      organizationId, userId: actorId, action: "commerce.store_draft_created",
      entityType: "Order", entityId: orderId,
      metadata: { storeId: store.id, status: finalRow?.status ?? null, error: finalRow?.lastError ?? null },
    }).catch(() => undefined);
    if (finalRow?.status !== "done") {
      throw badRequest("commerce.storeDraftFailed", { detail: finalRow?.lastError ?? "unknown_error" });
    }
    return after;
  }

  /** What the orders UI shows in the store-sync panel. */
  async pushState(organizationId: string, orderId: string) {
    const order = await this.loadOrder(organizationId, orderId);
    if (!order) throw notFound("commerce.orderNotFoundInOrg");
    const store = await this.loadStore(organizationId, order.storeId);
    let recent: any[] = [];
    try {
      recent = ((await (this.prisma as any).syncOutbox.findMany({ where: { organizationId, entityType: "order", entityId: orderId } })) ?? [])
        .slice()
        .sort((a: any, b: any) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
        .slice(0, 10)
        .map((r: any) => ({ id: r.id, operation: r.operation, status: r.status, lastError: r.lastError ?? null, createdAt: r.createdAt }));
    } catch { recent = []; }
    // NF7: the refund-to-credit gate for THIS order, computed
    // with the same rule StoreCreditService enforces (the API
    // stays the authority — it re-checks and refuses): the
    // order's store flag, or — for native orders with no linked
    // store — any store of the org having it on. The orders UI
    // renders the credit option only when this is true.
    let refundToCreditEnabled = false;
    try {
      if (store) {
        refundToCreditEnabled = store.refundToCreditEnabled === true;
      } else {
        const stores: any[] =
          (await (this.prisma as any).store.findMany({ where: { organizationId } }).catch(() => [])) ?? [];
        refundToCreditEnabled = stores.some((s: any) => s.refundToCreditEnabled === true);
      }
    } catch { refundToCreditEnabled = false; }
    return {
      orderId,
      refundToCreditEnabled,
      store: store ? {
        id: store.id, name: store.name, platform: store.platform,
        syncMode: store.syncMode ?? "mirror",
        refundPushEnabled: store.refundPushEnabled === true,
        refundToCreditEnabled: store.refundToCreditEnabled === true,
        courierTrackingMetaKey: store.courierTrackingMetaKey ?? null,
      } : null,
      storeSyncStatus: order.storeSyncStatus ?? null,
      storeSyncError: order.storeSyncError ?? null,
      storeDraftId: order.storeDraftId ?? null,
      storeInvoiceUrl: order.storeInvoiceUrl ?? null,
      recentPushes: recent,
    };
  }
}
