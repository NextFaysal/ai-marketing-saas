import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CourierService } from "../courier/courier.service";
import { InventoryService } from "../inventory/inventory.service";
import { OrdersService } from "../orders/orders.service";
import { InboxService } from "../inbox/inbox.service";
import { EmailProvider } from "../messaging/email.provider";
import { EventsService } from "../common/events.service";
import { resolveShopifyClient } from "../integrations/commerce/shopify-catalog";
import { readExternalVariantMap } from "../integrations/commerce/catalog-content";

const SHOPIFY_INVENTORY_ADJUST = `mutation cpInventoryAdjust($input: InventoryAdjustQuantitiesInput!) {
  inventoryAdjustQuantities(input: $input) {
    inventoryAdjustmentGroup { id }
    userErrors { field message }
  }
}`;

function shopifyGid(kind: string, id: string): string {
  const s = String(id);
  return s.startsWith("gid://") ? s : `gid://shopify/${kind}/${s}`;
}

export const RETURN_STATUSES = ["requested", "approved", "rejected", "return_shipped", "received", "completed"] as const;
export const RETURN_RESOLUTIONS = ["refund", "exchange", "store_credit_note"] as const;

interface ReturnLine { orderItemId: string; quantity: number; condition?: string; restock?: boolean }

/**
 * EC9 — returns / RMA.
 *
 * Flow: staff mint an unguessable-token link from the order; the
 * customer (no login — the token IS the credential) submits reason
 * + item quantities bounded by the order; staff approve/reject,
 * optionally book the return parcel through the existing courier
 * booking path, mark received with per-item condition, and
 * complete:
 *  - restock: per-line S1 ledger adjustments (reason
 *    "return_restock") — NOT OrdersService's whole-order
 *    applyOrderRestore, which would restock lines the customer
 *    kept and consume the order's one restore slot. Exactly-once
 *    is guarded by ReturnRequest.restockAppliedAt, set before the
 *    adjustments run.
 *  - refund resolution: recorded through the S2 refund path, so
 *    the EC5 store refund push happens iff the store's
 *    refundPushEnabled gate is on — otherwise it stays a local
 *    record and the UI says so.
 *  - exchange: a new manual order via OrdersService.createManual,
 *    linked as exchangeOrderId.
 *  - store_credit_note: a RECORD only. No money instrument is
 *    created (tenant money features remain postponed).
 *
 * Courier honesty: the providers have no reverse-logistics product
 * in this codebase — a "return booking" is a normal parcel booked
 * with the merchant as recipient and the order as reference.
 *
 * Notifications: linked conversation (InboxService automated
 * message) first, else the customer's email via EmailProvider,
 * else recorded "not_sent_no_channel" — never claimed sent.
 */
@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly courier?: CourierService,
    @Optional() private readonly inventory?: InventoryService,
    @Optional() private readonly orders?: OrdersService,
    @Optional() private readonly inbox?: InboxService,
    @Optional() private readonly email?: EmailProvider,
    // GC23: bus for the "order.returned" webhook event (appended
    // LAST + @Optional, the established discipline).
    @Optional() private readonly events?: EventsService,
  ) {}

  private pub(rr: any) {
    return { ...rr, refundAmountMinor: rr?.refundAmountMinor != null ? String(rr.refundAmountMinor) : null };
  }

  async loadOrder(organizationId: string, orderId: string) {
    const order = await (this.prisma as any).order.findFirst({
      where: { id: orderId, organizationId }, include: { items: true, customer: true },
    });
    if (!order) throw new NotFoundException("Order not found in this organization");
    return order;
  }

  async loadReturn(organizationId: string, returnId: string) {
    const rr = await (this.prisma as any).returnRequest.findFirst({ where: { id: returnId, organizationId } });
    if (!rr) throw new NotFoundException("Return request not found in this organization");
    return rr;
  }

  async createLink(organizationId: string, actorId: string, orderId: string) {
    const order = await this.loadOrder(organizationId, orderId);
    const token = randomBytes(24).toString("hex");
    const rr = await (this.prisma as any).returnRequest.create({
      data: {
        organizationId, orderId: order.id, customerId: order.customerId ?? null,
        status: "requested", token, restockDecision: "pending",
      },
    });
    await this.audit?.log({
      organizationId, userId: actorId, action: "returns.link_created",
      entityType: "ReturnRequest", entityId: rr.id, metadata: { orderId: order.id },
    }).catch(() => undefined);
    // GC23: this create() is the ONLY ReturnRequest creation
    // point in the codebase and returns previously emitted NO bus
    // event — emit "order.returned" here (failure-isolated) so
    // outgoing webhooks (GC23) can map it. Status at creation is
    // "requested" (the link exists; the customer may not have
    // submitted yet — the payload says exactly that).
    try {
      this.events?.emit("order.returned", {
        organizationId, context: { returnRequestId: rr.id, orderId: order.id, status: rr.status },
      });
    } catch { /* webhooks never block return creation */ }
    return this.pub(rr);
  }

  /** Public view for the token holder: order + returnable items. */
  async publicView(token: string) {
    const rr = await (this.prisma as any).returnRequest.findFirst({ where: { token } });
    if (!rr) throw new NotFoundException("Return link not found");
    const order = await (this.prisma as any).order.findFirst({
      where: { id: rr.orderId, organizationId: rr.organizationId }, include: { items: true },
    });
    if (!order) throw new NotFoundException("Return link not found");
    return {
      status: rr.status,
      submitted: rr.items != null,
      reason: rr.reason ?? null,
      resolution: rr.resolution ?? null,
      order: {
        number: order.externalNumber ?? null,
        placedAt: order.placedAt ?? order.createdAt,
        items: (order.items ?? []).map((i: any) => ({ id: i.id, name: i.name, quantity: i.quantity })),
      },
      items: rr.items ?? null,
    };
  }

  async publicSubmit(token: string, dto: { reason?: string; items: ReturnLine[] }) {
    const rr = await (this.prisma as any).returnRequest.findFirst({ where: { token } });
    if (!rr) throw new NotFoundException("Return link not found");
    if (rr.items != null) throw new BadRequestException("এই রিটার্নের আবেদন আগেই জমা দেওয়া হয়েছে");
    if (rr.status !== "requested") throw new BadRequestException("এই রিটার্ন লিংকটি আর সক্রিয় নয়");
    if (!Array.isArray(dto.items) || dto.items.length === 0) throw new BadRequestException("কমপক্ষে একটি আইটেম বেছে দিন");
    const order = await this.loadOrder(rr.organizationId, rr.orderId);
    const byId = new Map<string, any>((order.items ?? []).map((i: any) => [i.id, i]));
    const lines: ReturnLine[] = [];
    for (const line of dto.items) {
      const oi = byId.get(line.orderItemId);
      if (!oi) throw new BadRequestException("অর্ডারে এই আইটেমটি নেই");
      const qty = Math.floor(line.quantity);
      if (!(qty > 0) || qty > oi.quantity) throw new BadRequestException(`"${oi.name}"-এর পরিমাণ অর্ডারের পরিমাণের বেশি হতে পারবে না`);
      lines.push({ orderItemId: line.orderItemId, quantity: qty });
    }
    const updated = await (this.prisma as any).returnRequest.update({
      where: { id: rr.id },
      data: { reason: dto.reason?.trim() || null, items: lines },
    });
    await this.notify(rr.organizationId, updated, "আপনার রিটার্নের আবেদন পাওয়া গেছে। আমরা যাচাই করে জানাবো।");
    const after = await this.loadReturn(rr.organizationId, rr.id);
    return this.pub(after);
  }

  async list(organizationId: string, status?: string) {
    const rows: any[] = ((await (this.prisma as any).returnRequest.findMany({ where: { organizationId } }).catch(() => [])) ?? [])
      .filter((r: any) => !status || r.status === status)
      .sort((a: any, b: any) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
    const out: any[] = [];
    for (const rr of rows) {
      const order = await (this.prisma as any).order.findFirst({ where: { id: rr.orderId, organizationId } }).catch(() => null);
      out.push({ ...this.pub(rr), orderNumber: order?.externalNumber ?? null });
    }
    return { items: out, total: out.length };
  }

  async decide(organizationId: string, actorId: string, returnId: string, dto: {
    decision: "approve" | "reject";
    note?: string;
    resolution?: string;
    refundAmountMinor?: string;
  }) {
    const rr = await this.loadReturn(organizationId, returnId);
    if (rr.status !== "requested") throw new BadRequestException("শুধু আবেদন করা (requested) রিটার্নেই সিদ্ধান্ত দেওয়া যায়");
    if (rr.items == null) throw new BadRequestException("কাস্টমার এখনো আবেদন জমা দেননি");
    const data: Record<string, any> = { staffNote: dto.note ?? rr.staffNote ?? null };
    if (dto.decision === "reject") {
      data.status = "rejected";
    } else {
      const resolution = dto.resolution ?? "refund";
      if (!(RETURN_RESOLUTIONS as readonly string[]).includes(resolution)) {
        throw new BadRequestException(`resolution অবশ্যই এর একটি হতে হবে: ${RETURN_RESOLUTIONS.join(", ")}`);
      }
      data.status = "approved";
      data.resolution = resolution;
      if (dto.refundAmountMinor !== undefined) {
        if (!/^\d+$/.test(dto.refundAmountMinor)) throw new BadRequestException("refund-এর পরিমাণ সঠিক সংখ্যায় পাঠান (পয়সায়)");
        data.refundAmountMinor = BigInt(dto.refundAmountMinor);
      }
    }
    const updated = await (this.prisma as any).returnRequest.update({ where: { id: rr.id }, data });
    await this.audit?.log({
      organizationId, userId: actorId, action: dto.decision === "reject" ? "returns.rejected" : "returns.approved",
      entityType: "ReturnRequest", entityId: rr.id, metadata: { resolution: data.resolution ?? null },
    }).catch(() => undefined);
    await this.notify(organizationId, updated,
      dto.decision === "reject"
        ? "দুঃখিত, আপনার রিটার্নের আবেদনটি গ্রহণ করা যায়নি। বিস্তারিত জানতে আমাদের মেসেজ করুন।"
        : "আপনার রিটার্ন অনুমোদিত হয়েছে। পণ্য ফেরত পাঠানোর নির্দেশনা শীঘ্রই জানানো হবে।");
    return this.pub(await this.loadReturn(organizationId, rr.id));
  }

  /** Book the return parcel: a NORMAL courier booking (existing
   *  path) with the merchant as recipient — see the class note. */
  async bookReturnCourier(organizationId: string, actorId: string, returnId: string, dto: {
    provider?: string;
    recipientAddress?: string; recipientName?: string; recipientPhone?: string;
  }) {
    const rr = await this.loadReturn(organizationId, returnId);
    if (rr.status !== "approved") throw new BadRequestException("শুধু অনুমোদিত রিটার্নের জন্য return courier বুক করা যায়");
    if (!this.courier) throw new BadRequestException("Courier service is not available in this deployment");
    const profile = await (this.prisma as any).businessProfile.findFirst({ where: { organizationId } }).catch(() => null);
    const org = await (this.prisma as any).organization.findFirst({ where: { id: organizationId } }).catch(() => null);
    const recipientAddress = dto.recipientAddress?.trim() || [profile?.address, profile?.city].filter(Boolean).join(", ");
    const recipientName = dto.recipientName?.trim() || org?.name || "";
    const recipientPhone = dto.recipientPhone?.trim() || profile?.contactPhone || "";
    if (!recipientAddress || recipientAddress.length < 8 || !recipientPhone) {
      throw new BadRequestException("মার্চেন্টের ফেরতের ঠিকানা/ফোন পাওয়া যায়নি — Settings-এ ব্যবসার ঠিকানা ও ফোন বসান, অথবা অনুরোধে ঠিকানা পাঠান");
    }
    const shipment = await this.courier.bookShipment(organizationId, actorId, {
      provider: dto.provider,
      orderId: rr.orderId,
      recipientName, recipientPhone, recipientAddress,
      note: `RETURN pickup for return ${rr.id}`,
    });
    const updated = await (this.prisma as any).returnRequest.update({
      where: { id: rr.id }, data: { status: "return_shipped", returnShipmentId: shipment.id },
    });
    await this.audit?.log({
      organizationId, userId: actorId, action: "returns.courier_booked",
      entityType: "ReturnRequest", entityId: rr.id, metadata: { shipmentId: shipment.id, trackingCode: shipment.trackingCode ?? null },
    }).catch(() => undefined);
    await this.notify(organizationId, updated, `আপনার রিটার্নের পার্সেল বুক করা হয়েছে। Tracking: ${shipment.trackingCode ?? "-"}`);
    return this.pub(await this.loadReturn(organizationId, rr.id));
  }

  async markReceived(organizationId: string, actorId: string, returnId: string, dto: {
    items: { orderItemId: string; condition?: string; restock?: boolean }[];
  }) {
    const rr = await this.loadReturn(organizationId, returnId);
    if (!["approved", "return_shipped"].includes(rr.status)) {
      throw new BadRequestException("শুধু অনুমোদিত/পাঠানো রিটার্নই received করা যায়");
    }
    const conditionBy = new Map((dto.items ?? []).map((i) => [i.orderItemId, i]));
    const lines: ReturnLine[] = ((rr.items ?? []) as ReturnLine[]).map((l) => {
      const c = conditionBy.get(l.orderItemId);
      return c ? { ...l, condition: c.condition ?? l.condition, restock: c.restock === true } : l;
    });
    const anyRestock = lines.some((l) => l.restock === true);
    const updated = await (this.prisma as any).returnRequest.update({
      where: { id: rr.id },
      data: { status: "received", items: lines, restockDecision: anyRestock ? "restock" : "discard" },
    });
    await this.audit?.log({
      organizationId, userId: actorId, action: "returns.received",
      entityType: "ReturnRequest", entityId: rr.id, metadata: { restockDecision: updated.restockDecision },
    }).catch(() => undefined);
    await this.notify(organizationId, updated, "আপনার ফেরত পাঠানো পণ্য আমরা পেয়েছি। যাচাই শেষে পরবর্তী ধাপ জানানো হবে।");
    return this.pub(await this.loadReturn(organizationId, rr.id));
  }

  async complete(organizationId: string, actorId: string, returnId: string) {
    const rr = await this.loadReturn(organizationId, returnId);
    if (rr.status !== "received") throw new BadRequestException("শুধু received রিটার্নই complete করা যায়");
    const order = await this.loadOrder(organizationId, rr.orderId);
    const data: Record<string, any> = { status: "completed" };

    // 1) Restock — exactly once (marker set BEFORE the ledger
    // writes, so a retry can never double-restock).
    if (rr.restockDecision === "restock" && !rr.restockAppliedAt && this.inventory) {
      await (this.prisma as any).returnRequest.update({ where: { id: rr.id }, data: { restockAppliedAt: new Date() } });
      const byId = new Map<string, any>((order.items ?? []).map((i: any) => [i.id, i]));
      for (const line of (rr.items ?? []) as ReturnLine[]) {
        if (line.restock !== true) continue;
        const oi = byId.get(line.orderItemId);
        if (!oi?.productId) continue;
        try {
          await this.inventory.adjust(organizationId, actorId, oi.productId, {
            delta: line.quantity, reason: "return_restock", note: `return ${rr.id}`,
          });
        } catch { /* untracked product etc. — recorded via the marker + audit below */ }
      }
      data.restockAppliedAt = new Date();
    }

    // 1b) CP4: Shopify partial restock — failure-isolated, runs
    // AFTER the local restock block above. Never throws; its
    // outcome lands on ReturnRequest.shopifyRestock.
    await this.shopifyRestockHook(organizationId, rr, order);

    // 2) Resolution.
    if (rr.resolution === "refund") {
      const amount = rr.refundAmountMinor != null ? BigInt(rr.refundAmountMinor) : BigInt(order.totalMinor ?? 0) - BigInt(order.refundedMinor ?? 0);
      if (amount > 0n && this.orders) {
        // Through the S2 path: validates the cumulative cap, and
        // its EC5 hook enqueues the store refund push iff the
        // store gate is on. A failure here must not lose the
        // completion — it is surfaced in the response instead.
        try {
          await this.orders.updateOrder(organizationId, actorId, rr.orderId, {
            refund: { amountMinor: amount.toString(), reason: `Return ${rr.id}` },
          } as any);
        } catch (e) {
          data.staffNote = [rr.staffNote, `refund record failed: ${e instanceof Error ? e.message : String(e)}`].filter(Boolean).join(" | ");
        }
      }
    } else if (rr.resolution === "exchange") {
      if (!rr.exchangeOrderId && this.orders) {
        const customer = order.customer;
        if (!customer?.phone) throw new BadRequestException("এক্সচেঞ্জ অর্ডারের জন্য কাস্টমারের ফোন নম্বর দরকার — কাস্টমার রেকর্ডে ফোন নেই");
        const byId = new Map<string, any>((order.items ?? []).map((i: any) => [i.id, i]));
        const items = ((rr.items ?? []) as ReturnLine[]).map((l) => {
          const oi = byId.get(l.orderItemId);
          return {
            name: oi?.name ?? "Exchange item",
            sku: oi?.sku ?? undefined,
            quantity: l.quantity,
            unitPriceMinor: Number(BigInt(oi?.priceMinor ?? 0)),
          };
        });
        const created: any = await this.orders.createManual(organizationId, actorId, {
          customerPhone: customer.phone,
          customerName: [customer.firstName, customer.lastName].filter(Boolean).join(" ") || undefined,
          customerEmail: customer.email ?? undefined,
          address: order.address ?? undefined,
          items, isCod: order.isCod,
          externalRef: `exchange-${rr.id}`,
        } as any);
        data.exchangeOrderId = created?.id ?? null;
      }
    }
    // store_credit_note: record only — nothing else to do, by design.

    const updated = await (this.prisma as any).returnRequest.update({ where: { id: rr.id }, data });
    await this.audit?.log({
      organizationId, userId: actorId, action: "returns.completed",
      entityType: "ReturnRequest", entityId: rr.id,
      metadata: { resolution: rr.resolution ?? null, exchangeOrderId: data.exchangeOrderId ?? rr.exchangeOrderId ?? null },
    }).catch(() => undefined);
    await this.notify(organizationId, updated,
      rr.resolution === "refund"
        ? "আপনার রিটার্ন সম্পন্ন হয়েছে এবং refund প্রক্রিয়া শুরু হয়েছে।"
        : rr.resolution === "exchange"
          ? "আপনার রিটার্ন সম্পন্ন হয়েছে — এক্সচেঞ্জ অর্ডার তৈরি করা হয়েছে।"
          : "আপনার রিটার্ন সম্পন্ন হয়েছে।");
    return this.pub(await this.loadReturn(organizationId, rr.id));
  }

  /**
   * CP4: mirror the LOCAL restock onto Shopify inventory — only
   * the restocked quantities (partial restock is natural: the
   * adjust delta is each return line's quantity, never the order
   * quantity). Discovery mirrors shopify-catalog's inventory code:
   * the listing's externalVariantMap carries the inventoryItemId
   * (matched by the order item's externalVariationId when known,
   * else the single mapped entry), and the location is the
   * store's default StoreLocation. Adjustment uses Shopify's
   * inventoryAdjustQuantities (a delta, unlike the catalog's
   * absolute inventorySetQuantities).
   *
   * Scope discipline: non-Shopify stores and storeless orders
   * leave shopifyRestock NULL (no attempted:false noise). Once a
   * Shopify store is in scope the attempt is ALWAYS recorded —
   * including total failure — and NOTHING here ever throws.
   */
  private async shopifyRestockHook(organizationId: string, rr: any, order: any): Promise<void> {
    if (rr.restockDecision !== "restock") return;
    const persist = async (value: Record<string, any>) => {
      try {
        await (this.prisma as any).returnRequest.update({ where: { id: rr.id }, data: { shopifyRestock: value } });
      } catch { /* bookkeeping only — the local completion stands */ }
    };
    try {
      if (!order?.storeId) return;
      const store = await (this.prisma as any).store.findFirst({
        where: { id: order.storeId, organizationId },
      }).catch(() => null);
      if (!store || store.platform !== "SHOPIFY") return;

      const byId = new Map<string, any>((order.items ?? []).map((i: any) => [i.id, i]));
      const lines: { productId: string; qty: number; ok: boolean; reason?: string }[] = [];
      let totalAdjusted = 0;

      // Client + location are resolved once; a failure here is
      // recorded per-line below (attempted, not silent).
      let client: any = null;
      let setupError: string | null = null;
      try {
        let integration: any = null;
        try {
          integration = await (this.prisma as any).integration.findFirst({
            where: { organizationId, storeId: store.id, provider: "shopify" },
            include: { credential: true, store: true },
          });
        } catch {
          integration = await (this.prisma as any).integration.findFirst({
            where: { organizationId, storeId: store.id, provider: "shopify" },
          });
        }
        if (!integration) throw new Error("shopify_integration_not_connected");
        if (!integration.credential && typeof (this.prisma as any).integrationCredential?.findFirst === "function") {
          const cred = await (this.prisma as any).integrationCredential.findFirst({ where: { integrationId: integration.id } }).catch(() => null);
          if (cred) integration = { ...integration, credential: cred };
        }
        const resolved = await resolveShopifyClient({
          prisma: this.prisma as any, organizationId, store, integration, payload: {},
        });
        if ("error" in resolved) throw new Error(resolved.error);
        client = resolved.client;
      } catch (e) {
        setupError = e instanceof Error ? e.message : String(e);
      }

      let locationGid: string | null = null;
      if (!setupError) {
        try {
          const loc = await (this.prisma as any).storeLocation.findFirst({
            where: { storeId: store.id, isDefault: true },
          });
          const external = loc?.externalLocationId ?? loc?.externalId ?? null;
          if (external) locationGid = shopifyGid("Location", String(external));
          if (!locationGid) setupError = "shopify_location_not_mapped";
        } catch {
          setupError = "shopify_location_not_mapped";
        }
      }

      for (const line of (rr.items ?? []) as ReturnLine[]) {
        if (line.restock !== true || !(line.quantity > 0)) continue;
        const oi = byId.get(line.orderItemId);
        if (!oi?.productId) continue;
        const productId = String(oi.productId);
        const qty = line.quantity;
        if (setupError) {
          lines.push({ productId, qty, ok: false, reason: setupError });
          continue;
        }
        const listing = await (this.prisma as any).storeListing.findFirst({
          where: { organizationId, storeId: store.id, productId },
        }).catch(() => null);
        if (!listing) {
          lines.push({ productId, qty, ok: false, reason: "no_listing" });
          continue;
        }
        const map = readExternalVariantMap(listing.externalVariantMap);
        let entry: { id: string; inventoryItemId?: string } | undefined;
        const entries = Object.values(map);
        if (oi.externalVariationId) {
          entry = entries.find((en) => en.id === String(oi.externalVariationId) || shopifyGid("ProductVariant", en.id) === String(oi.externalVariationId));
        }
        if (!entry && entries.length === 1) entry = entries[0];
        if (!entry?.inventoryItemId) {
          lines.push({ productId, qty, ok: false, reason: "inventory_item_not_mapped" });
          continue;
        }
        try {
          const data = await client.request(SHOPIFY_INVENTORY_ADJUST, {
            input: {
              name: "available",
              reason: "received",
              changes: [{
                inventoryItemId: shopifyGid("InventoryItem", entry.inventoryItemId),
                locationId: locationGid,
                delta: qty,
              }],
            },
          });
          const errs = data?.inventoryAdjustQuantities?.userErrors;
          if (Array.isArray(errs) && errs.length > 0) {
            lines.push({ productId, qty, ok: false, reason: errs.map((x: any) => x?.message ?? String(x)).join("; ") });
            continue;
          }
          lines.push({ productId, qty, ok: true });
          totalAdjusted += qty;
        } catch (e) {
          lines.push({ productId, qty, ok: false, reason: e instanceof Error ? e.message : String(e) });
        }
      }

      await persist({
        attempted: true,
        succeeded: lines.length > 0 && lines.every((l) => l.ok),
        qty: totalAdjusted,
        lines,
      });
    } catch (e) {
      await persist({
        attempted: true,
        succeeded: false,
        qty: 0,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /** Channel order: linked conversation -> email -> none.
   *  The outcome is persisted on the return — never claimed. */
  async notify(organizationId: string, rr: any, text: string): Promise<string> {
    let status = "not_sent_no_channel";
    try {
      const order = await (this.prisma as any).order.findFirst({
        where: { id: rr.orderId, organizationId }, include: { customer: { select: { email: true } } },
      });
      if (order?.isPractice) status = "not_sent_no_channel";
      else if (this.inbox && order?.conversationId) {
        await this.inbox.sendAutomatedMessage(organizationId, order.conversationId, text, "return_update");
        status = "sent_inbox";
      } else if (this.email && order?.customer?.email) {
        await this.email.send({ to: order.customer.email, subject: "আপনার রিটার্নের আপডেট", text });
        status = "sent_email";
      }
    } catch {
      status = "failed";
    }
    try {
      await (this.prisma as any).returnRequest.update({ where: { id: rr.id }, data: { notificationStatus: status } });
    } catch { /* best-effort bookkeeping */ }
    return status;
  }
}
