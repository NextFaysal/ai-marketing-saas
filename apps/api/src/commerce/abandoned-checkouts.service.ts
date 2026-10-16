import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EmailProvider } from "../messaging/email.provider";
import { EventsService } from "../common/events.service";
import { AbandonedCartsService } from "../tracking/abandoned-carts.service";
import { minorToMajor } from "../imports/csv";
import { decryptJson, encryptJson } from "../integrations/crypto";
import { ShopifyClient } from "../integrations/shopify/shopify.client";
import {
  exchangeShopifyClientCredentials,
  normalizeShopifyHost,
} from "../integrations/shopify/shopify-auth";
import { upsertAbandonedStoreCheckout } from "../integrations/shopify/shopify-checkouts";

export const STORE_CHECKOUT_RECOVERY_ACTION = "commerce.store_checkout_recovery_sent";
export const NATIVE_CART_RECOVERY_ACTION = "commerce.native_cart_recovery_sent";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function toIso(value: any): string | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * EC10: abandoned checkouts from CONNECTED stores (today: Shopify),
 * unified with the S4 tracker-derived abandoned carts.
 *
 * Honesty rules mirror S4:
 *  - "recovered" is computed on read against real orders placed at
 *    or after the checkout was abandoned — never stored as a guess.
 *  - A recovery email is sent at most once per checkout (AuditLog
 *    marker); a failed send writes NO marker and emits NO event.
 *  - The "cart.abandoned" workflow event is emitted only after a
 *    provider-confirmed send.
 */
@Injectable()
export class AbandonedCheckoutsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly email?: EmailProvider,
    @Optional() private readonly events?: EventsService,
    @Optional() private readonly trackerCarts?: AbandonedCartsService,
  ) {}

  /** Customer ids in this org matching the checkout's email/phone. */
  private async findCustomerIds(orgId: string, row: any): Promise<string[]> {
    const ids = new Set<string>();
    try {
      if (row?.email) {
        const byEmail = await (this.prisma as any).customer.findMany({
          where: { organizationId: orgId, email: row.email },
        });
        for (const c of byEmail ?? []) if (c?.id) ids.add(String(c.id));
      }
      if (row?.phone) {
        const byPhone = await (this.prisma as any).customer.findMany({
          where: { organizationId: orgId, phone: row.phone },
        });
        for (const c of byPhone ?? []) if (c?.id) ids.add(String(c.id));
      }
    } catch {
      return [];
    }
    return [...ids];
  }

  private async findRecoveryOrder(orgId: string, row: any): Promise<any | null> {
    if (!row?.email && !row?.phone) return null;
    try {
      const ids = await this.findCustomerIds(orgId, row);
      if (ids.length === 0) return null;
      const abandonedAt = row.abandonedAt instanceof Date ? row.abandonedAt : new Date(row.abandonedAt);
      const baseWhere: Record<string, any> = {
        organizationId: orgId,
        customerId: { in: ids },
        status: { not: "cancelled" },
      };
      // Primary path: orders whose placedAt is at/after the abandon.
      const placed = await (this.prisma as any).order.findMany({
        where: { ...baseWhere, placedAt: { gte: abandonedAt } },
        orderBy: { placedAt: "asc" },
        take: 1,
      });
      if (placed?.[0]) return placed[0];
      // Fallback (kept simple, bounded): some synced orders only
      // carry createdAt (placedAt is null). Fetch a small page of
      // placedAt-null orders and accept the first whose createdAt
      // is at/after the abandon, comparing (placedAt ?? createdAt)
      // in JS.
      const candidates = await (this.prisma as any).order.findMany({
        where: { ...baseWhere, placedAt: null },
        orderBy: { placedAt: "asc" },
        take: 5,
      });
      for (const order of candidates ?? []) {
        const effective = order?.placedAt ?? order?.createdAt;
        if (effective && new Date(effective).getTime() >= abandonedAt.getTime()) return order;
      }
      return null;
    } catch {
      return null;
    }
  }

  async listStoreCheckouts(orgId: string) {
    let rows: any[] = [];
    try {
      rows =
        (await (this.prisma as any).abandonedStoreCheckout.findMany({
          where: { organizationId: orgId },
          orderBy: { abandonedAt: "desc" },
          take: 200,
        })) ?? [];
    } catch {
      rows = [];
    }
    if (rows.length === 0) return [];

    // Store names.
    const storeById = new Map<string, any>();
    try {
      const storeIds = [...new Set(rows.map((r: any) => r.storeId).filter(Boolean))];
      if (storeIds.length > 0) {
        const stores = await (this.prisma as any).store.findMany({
          where: { organizationId: orgId, id: { in: storeIds } },
        });
        for (const s of stores ?? []) storeById.set(String(s.id), s);
      }
    } catch {
      /* names are best-effort */
    }

    // Recovery-sent markers (newest first wins per checkout).
    const sentAtById = new Map<string, any>();
    try {
      const rowIds = rows.map((r: any) => r.id).filter(Boolean);
      if (rowIds.length > 0) {
        const markers = await (this.prisma as any).auditLog.findMany({
          where: {
            organizationId: orgId,
            action: STORE_CHECKOUT_RECOVERY_ACTION,
            entityId: { in: rowIds },
          },
          orderBy: { createdAt: "desc" },
        });
        for (const m of markers ?? []) {
          if (m?.entityId && !sentAtById.has(String(m.entityId))) {
            sentAtById.set(String(m.entityId), m.createdAt);
          }
        }
      }
    } catch {
      /* markers are best-effort */
    }

    const out: any[] = [];
    for (const row of rows) {
      const order = await this.findRecoveryOrder(orgId, row);

      let conversationId: string | null = null;
      try {
        const customerIds = await this.findCustomerIds(orgId, row);
        if (customerIds.length > 0 && (this.prisma as any).channelConversation?.findFirst) {
          const conversation = await (this.prisma as any).channelConversation.findFirst({
            where: { organizationId: orgId, customerId: { in: customerIds } },
          });
          conversationId = conversation?.id ?? null;
        }
      } catch {
        conversationId = null;
      }

      out.push({
        ...row,
        totalMinor: String(row.totalMinor),
        storeName: storeById.get(String(row.storeId))?.name ?? null,
        recovered: !!order,
        recoveredOrderId: order?.id ?? row.recoveredOrderId ?? null,
        computedStatus: order ? "recovered" : row.status,
        recoverySentAt: toIso(sentAtById.get(String(row.id)) ?? null),
        conversationId,
      });
    }
    return out;
  }

  // ---------- EC8/EC10: native storefront carts ----------

  /** Price a native cart line from CURRENT product/variant rows. */
  private async nativeCartItems(cart: any): Promise<{ items: any[]; totalMinor: bigint }> {
    let rawItems: any[] = Array.isArray(cart?.items) ? cart.items : [];
    if (rawItems.length === 0 && cart?.id && (this.prisma as any).storeCartItem?.findMany) {
      rawItems =
        (await (this.prisma as any).storeCartItem
          .findMany({ where: { cartId: cart.id } })
          .catch(() => [])) ?? [];
    }
    const items: any[] = [];
    let total = 0n;
    for (const item of rawItems) {
      let product = item.product ?? null;
      if (!product && item.productId) {
        product = await (this.prisma as any).product
          .findFirst({ where: { id: item.productId } })
          .catch(() => null);
      }
      let variant = item.variant ?? null;
      if (!variant && item.variantId) {
        variant = await (this.prisma as any).productVariant
          .findFirst({ where: { id: item.variantId } })
          .catch(() => null);
      }
      const unit =
        variant?.priceMinor != null ? BigInt(variant.priceMinor) : BigInt(product?.priceMinor ?? 0);
      const qty = Number(item.quantity ?? 1);
      total += unit * BigInt(qty);
      items.push({
        name: product?.name ?? "item",
        quantity: qty,
        priceMinor: unit.toString(),
        productId: item.productId ?? null,
        variantId: item.variantId ?? null,
      });
    }
    return { items, totalMinor: total };
  }

  /**
   * Native (EC8 StoreCart) abandoned carts: still OPEN, has an email
   * or phone, has items, and the last activity is between 1h and 7d
   * ago. Converted carts are excluded by the status filter — a cart
   * that became an order is never "abandoned". Values are computed
   * from current prices (the cart stores no price truth).
   */
  async listNativeCarts(orgId: string) {
    const now = Date.now();
    let carts: any[] = [];
    try {
      carts =
        (await (this.prisma as any).storeCart.findMany({
          where: {
            organizationId: orgId,
            status: "open",
            updatedAt: { gte: new Date(now - 7 * 24 * 3600 * 1000), lte: new Date(now - 3600 * 1000) },
          },
          orderBy: { updatedAt: "desc" },
          take: 200,
        })) ?? [];
    } catch {
      return [];
    }
    const eligible = carts.filter((c: any) => c.email || c.phone);
    if (eligible.length === 0) return [];

    let orgSlug: string | null = null;
    try {
      const org = await (this.prisma as any).organization.findFirst({ where: { id: orgId } });
      orgSlug = org?.slug ?? null;
    } catch {
      orgSlug = null;
    }

    // Recovery markers: a marker only counts for the cart activity
    // it was sent against (metadata.lastCartActivity). New activity
    // after a send makes the cart sendable again.
    const sentAtByCartId = new Map<string, any>();
    try {
      const markers = await (this.prisma as any).auditLog.findMany({
        where: {
          organizationId: orgId,
          action: NATIVE_CART_RECOVERY_ACTION,
          entityId: { in: eligible.map((c: any) => c.id) },
        },
        orderBy: { createdAt: "desc" },
      });
      for (const m of markers ?? []) {
        const cart = eligible.find((c: any) => c.id === m.entityId);
        if (!cart) continue;
        const activity = m.metadata?.lastCartActivity;
        if (activity && toIso(cart.updatedAt) === activity && !sentAtByCartId.has(String(m.entityId))) {
          sentAtByCartId.set(String(m.entityId), m.createdAt);
        }
      }
    } catch {
      /* markers are best-effort */
    }

    const out: any[] = [];
    for (const cart of eligible) {
      const { items, totalMinor } = await this.nativeCartItems(cart);
      if (items.length === 0) continue;
      out.push({
        source: "native",
        id: cart.id,
        cartId: cart.id,
        email: cart.email ?? null,
        phone: cart.phone ?? null,
        items,
        totalMinor: totalMinor.toString(),
        currency: "BDT",
        checkoutUrl: orgSlug ? `/shop/${orgSlug}` : null,
        abandonedAt: toIso(cart.updatedAt),
        recovered: false,
        recoverySentAt: toIso(sentAtByCartId.get(String(cart.id)) ?? null),
        conversationId: null,
      });
    }
    return out;
  }

  async listUnified(orgId: string) {
    let trackerPart: any = { carts: [] };
    if (this.trackerCarts) {
      trackerPart = await this.trackerCarts.list(orgId).catch(() => ({ carts: [] }));
    }
    const trackerItems = ((trackerPart?.carts ?? []) as any[]).map((cart: any) => ({
      source: "tracker",
      id: cart.visitorId,
      visitorId: cart.visitorId,
      storeId: cart.storeId,
      storeName: cart.storeName,
      email: cart.contact?.email ?? null,
      phone: cart.contact?.phone ?? null,
      items: cart.items ?? [],
      totalMinor: cart.valueMinor != null ? String(cart.valueMinor) : null,
      currency: "BDT",
      checkoutUrl: cart.storeUrl ?? null,
      abandonedAt: cart.lastActivityAt,
      recovered: false,
      recoverySentAt: cart.recoverySentAt ?? null,
      conversationId: null,
    }));

    const storeRows = await this.listStoreCheckouts(orgId);
    const storeItems = (storeRows as any[]).map((row: any) => ({
      source: "shopify",
      id: row.id,
      storeId: row.storeId,
      storeName: row.storeName,
      email: row.email ?? null,
      phone: row.phone ?? null,
      items: row.items ?? [],
      totalMinor: row.totalMinor,
      currency: row.currency,
      checkoutUrl: row.checkoutUrl ?? null,
      abandonedAt: toIso(row.abandonedAt),
      recovered: row.recovered,
      recoveredOrderId: row.recoveredOrderId,
      recoverySentAt: row.recoverySentAt,
      conversationId: row.conversationId,
    }));

    const nativeItems = await this.listNativeCarts(orgId).catch(() => []);

    const items = [...trackerItems, ...storeItems, ...nativeItems].sort((a: any, b: any) => {
      const av = a.totalMinor == null ? -1 : Number(a.totalMinor);
      const bv = b.totalMinor == null ? -1 : Number(b.totalMinor);
      return bv - av;
    });
    return { generatedAt: new Date().toISOString(), items };
  }

  async sendStoreRecovery(orgId: string, actorId: string, checkoutId: string) {
    const row = await (this.prisma as any).abandonedStoreCheckout.findFirst({
      where: { id: checkoutId, organizationId: orgId },
    });
    if (!row) throw new NotFoundException("Abandoned checkout not found in this organization");

    const recoveredOrder = await this.findRecoveryOrder(orgId, row);
    if (recoveredOrder) {
      throw new BadRequestException("এই checkout-এর কাস্টমার ইতিমধ্যে অর্ডার করেছেন — recovery পাঠানোর দরকার নেই");
    }
    if (!row.email) {
      throw new BadRequestException("এই checkout-এ কোনো ইমেইল ঠিকানা নেই — recovery ইমেইল পাঠানো যাবে না");
    }

    let marker: any = null;
    try {
      marker = await (this.prisma as any).auditLog.findFirst({
        where: {
          organizationId: orgId,
          action: STORE_CHECKOUT_RECOVERY_ACTION,
          entityId: checkoutId,
        },
      });
    } catch {
      marker = null;
    }
    if (marker) {
      throw new BadRequestException("এই checkout-এর জন্য recovery ইমেইল ইতিমধ্যে পাঠানো হয়েছে");
    }
    if (!this.email) {
      throw new BadRequestException("ইমেইল পাঠানোর সুবিধা এই deployment-এ নেই");
    }

    let storeName = "আমাদের দোকান";
    try {
      const store = await (this.prisma as any).store.findFirst({
        where: { id: row.storeId, organizationId: orgId },
      });
      if (store?.name) storeName = String(store.name);
    } catch {
      /* fall back to the generic name */
    }

    const subject = `${storeName}: আপনার checkout-টি এখনও অপেক্ষা করছে`;
    const lines: string[] = [
      "আসসালামু আলাইকুম,",
      "",
      `${storeName}-এ আপনি checkout শুরু করেছিলেন, কিন্তু অর্ডারটি সম্পূর্ণ করেননি।`,
    ];
    const items: any[] = Array.isArray(row.items) ? row.items : [];
    if (items.length > 0) {
      lines.push("", "আপনার checkout-এ যা আছে:");
      for (const item of items) {
        lines.push(`- ${item?.name ?? "item"}${item?.quantity ? ` ×${item.quantity}` : ""}`);
      }
    }
    lines.push("", `মোট মূল্য: ৳${minorToMajor(BigInt(row.totalMinor ?? 0))}`);
    if (row.checkoutUrl) {
      lines.push("", `আপনার অর্ডারটি সম্পূর্ণ করতে এখানে ফিরে যান: ${row.checkoutUrl}`);
    }
    lines.push("", "ধন্যবাদান্তে,", storeName);
    const text = lines.join("\n");

    let providerMessageId: string;
    try {
      const result = await this.email.send({ to: row.email, subject, text });
      providerMessageId = result.providerMessageId;
    } catch (err) {
      // No audit marker and no event on failure — the checkout
      // stays recoverable and the error is surfaced honestly.
      throw new BadRequestException(`ইমেইল পাঠানো যায়নি: ${errMsg(err)}`);
    }

    if (this.audit) {
      await this.audit
        .log({
          organizationId: orgId,
          userId: actorId,
          action: STORE_CHECKOUT_RECOVERY_ACTION,
          entityType: "AbandonedStoreCheckout",
          entityId: checkoutId,
          metadata: {
            storeId: row.storeId,
            to: row.email,
            providerMessageId,
          },
        })
        .catch(() => undefined);
    }

    this.events?.emit("cart.abandoned", {
      organizationId: orgId,
      context: {
        source: "shopify",
        checkoutId: row.id,
        storeId: row.storeId,
        externalCheckoutId: row.externalCheckoutId,
        email: row.email,
        phone: row.phone,
        total: Number(row.totalMinor) / 100,
        currency: row.currency,
        checkoutUrl: row.checkoutUrl,
      },
    });

    return { sent: true, to: row.email, providerMessageId, eventEmitted: !!this.events };
  }

  /**
   * EC8: recovery email for a native storefront cart. Same marker
   * discipline as store checkouts, with one refinement: the marker
   * pins the cart's last activity (metadata.lastCartActivity), so a
   * cart that changes after a send can be recovered again for the
   * NEW activity — but never twice for the same activity.
   */
  async sendNativeRecovery(orgId: string, actorId: string, cartId: string) {
    const cart = await (this.prisma as any).storeCart.findFirst({
      where: { id: cartId, organizationId: orgId },
    });
    if (!cart) throw new NotFoundException("Abandoned cart not found in this organization");
    if (cart.status !== "open") {
      throw new BadRequestException("এই কার্টটি ইতিমধ্যে অর্ডারে রূপান্তরিত হয়েছে — recovery পাঠানোর দরকার নেই");
    }
    if (!cart.email) {
      throw new BadRequestException("এই কার্টে কোনো ইমেইল ঠিকানা নেই — recovery ইমেইল পাঠানো যাবে না");
    }
    const lastActivity = toIso(cart.updatedAt);

    let alreadySent = false;
    try {
      const markers = await (this.prisma as any).auditLog.findMany({
        where: {
          organizationId: orgId,
          action: NATIVE_CART_RECOVERY_ACTION,
          entityId: cartId,
        },
      });
      alreadySent = (markers ?? []).some(
        (m: any) => m?.metadata?.lastCartActivity === lastActivity,
      );
    } catch {
      alreadySent = false;
    }
    if (alreadySent) {
      throw new BadRequestException("এই কার্টের জন্য recovery ইমেইল ইতিমধ্যে পাঠানো হয়েছে");
    }
    if (!this.email) {
      throw new BadRequestException("ইমেইল পাঠানোর সুবিধা এই deployment-এ নেই");
    }

    const { items, totalMinor } = await this.nativeCartItems(cart);
    if (items.length === 0) {
      throw new BadRequestException("কার্টটি খালি — recovery পাঠানোর কিছু নেই");
    }

    let shopName = "আমাদের দোকান";
    let shopUrl = "";
    try {
      const org = await (this.prisma as any).organization.findFirst({ where: { id: orgId } });
      let setting: any = null;
      try {
        setting = await (this.prisma as any).storefrontSetting.findFirst({
          where: { organizationId: orgId },
        });
      } catch {
        setting = null;
      }
      shopName = setting?.shopName || org?.brandName || org?.name || shopName;
      if (org?.slug) {
        // Absolute URL only when the org has a VERIFIED custom
        // domain; otherwise the honest relative shop path.
        shopUrl =
          org.customDomain && setting?.domainVerifiedAt
            ? `https://${org.customDomain}/shop/${org.slug}`
            : `/shop/${org.slug}`;
      }
    } catch {
      /* fall back to the generic name / no URL */
    }

    const subject = `${shopName}: আপনার কার্টটি এখনও অপেক্ষা করছে`;
    const lines: string[] = [
      "আসসালামু আলাইকুম,",
      "",
      `${shopName}-এ আপনি কিছু পণ্য কার্টে রেখেছিলেন, কিন্তু অর্ডারটি সম্পূর্ণ করেননি।`,
      "",
      "আপনার কার্টে যা আছে:",
    ];
    for (const item of items) {
      lines.push(`- ${item.name}${item.quantity ? ` ×${item.quantity}` : ""}`);
    }
    lines.push("", `মোট মূল্য: ৳${minorToMajor(totalMinor)}`);
    if (shopUrl) lines.push("", `আপনার অর্ডারটি সম্পূর্ণ করতে এখানে ফিরে যান: ${shopUrl}`);
    lines.push("", "ধন্যবাদান্তে,", shopName);
    const text = lines.join("\n");

    let providerMessageId: string;
    try {
      const result = await this.email.send({ to: cart.email, subject, text });
      providerMessageId = result.providerMessageId;
    } catch (err) {
      throw new BadRequestException(`ইমেইল পাঠানো যায়নি: ${errMsg(err)}`);
    }

    if (this.audit) {
      await this.audit
        .log({
          organizationId: orgId,
          userId: actorId,
          action: NATIVE_CART_RECOVERY_ACTION,
          entityType: "StoreCart",
          entityId: cartId,
          metadata: { to: cart.email, providerMessageId, lastCartActivity: lastActivity },
        })
        .catch(() => undefined);
    }

    this.events?.emit("cart.abandoned", {
      organizationId: orgId,
      context: {
        source: "native",
        cartId: cart.id,
        email: cart.email,
        phone: cart.phone,
        total: Number(totalMinor) / 100,
        currency: "BDT",
        checkoutUrl: shopUrl || null,
      },
    });

    return { sent: true, to: cart.email, providerMessageId, eventEmitted: !!this.events };
  }

  /**
   * Unified recovery entry for the controller: the id may belong to
   * a connected-store checkout (EC10) or a native cart (EC8).
   */
  async sendRecovery(orgId: string, actorId: string, id: string) {
    let storeRow: any = null;
    try {
      storeRow = await (this.prisma as any).abandonedStoreCheckout.findFirst({
        where: { id, organizationId: orgId },
      });
    } catch {
      storeRow = null;
    }
    if (storeRow) return this.sendStoreRecovery(orgId, actorId, id);
    let nativeRow: any = null;
    try {
      nativeRow = await (this.prisma as any).storeCart.findFirst({
        where: { id, organizationId: orgId },
      });
    } catch {
      nativeRow = null;
    }
    if (nativeRow) return this.sendNativeRecovery(orgId, actorId, id);
    throw new NotFoundException("Abandoned checkout not found in this organization");
  }

  async backfillFromShopify(orgId: string, actorId: string, storeId: string) {
    const store = await (this.prisma as any).store.findFirst({
      where: { id: storeId, organizationId: orgId },
    });
    if (!store) throw new NotFoundException("Store not found in this organization");

    const integration = await (this.prisma as any).integration.findFirst({
      where: { organizationId: orgId, storeId, provider: "shopify" },
    });
    if (!integration) {
      throw new BadRequestException("এই স্টোরের কোনো Shopify integration নেই");
    }

    let credential = integration.credential ?? null;
    if (!credential && typeof (this.prisma as any).integrationCredential?.findFirst === "function") {
      credential = await (this.prisma as any).integrationCredential
        .findFirst({ where: { integrationId: integration.id } })
        .catch(() => null);
    }
    if (!credential?.encryptedData) {
      throw new BadRequestException("shopify_credentials_missing");
    }

    let secrets: any;
    try {
      secrets = decryptJson<any>(credential.encryptedData);
    } catch (e) {
      throw new BadRequestException(errMsg(e));
    }

    let accessToken: string | undefined = secrets?.accessToken;
    const authType = integration.authType ?? secrets?.authType;
    if (authType === "client_credentials") {
      const expiresAtMs = integration.tokenExpiresAt
        ? new Date(integration.tokenExpiresAt).getTime()
        : NaN;
      const needsExchange =
        !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() + 5 * 60 * 1000;
      if (needsExchange) {
        let exchanged: { accessToken: string; expiresIn: number | null };
        try {
          exchanged = await exchangeShopifyClientCredentials(
            normalizeShopifyHost(store.url),
            secrets.clientId,
            secrets.clientSecret,
          );
        } catch (e) {
          throw new BadRequestException(errMsg(e));
        }
        accessToken = exchanged.accessToken;
        const next = { ...secrets, accessToken };
        const tokenExpiresAt = exchanged.expiresIn
          ? new Date(Date.now() + exchanged.expiresIn * 1000)
          : null;
        // Persist like shopify-catalog / ShopifyService: credential
        // row via upsert keyed by integrationId, expiry on the
        // integration row. Guarded — the exchanged token is still
        // usable for this call if persistence fails.
        try {
          if ((this.prisma as any).integrationCredential?.upsert && integration.id) {
            await (this.prisma as any).integrationCredential.upsert({
              where: { integrationId: integration.id },
              update: { encryptedData: encryptJson(next) },
              create: { integrationId: integration.id, encryptedData: encryptJson(next) },
            });
          }
          if ((this.prisma as any).integration?.update && integration.id) {
            await (this.prisma as any).integration.update({
              where: { id: integration.id },
              data: { tokenExpiresAt },
            });
          }
        } catch {
          /* the exchanged token is still usable for this call */
        }
        secrets = next;
      }
    }

    const client = new ShopifyClient(store.url, {
      accessToken: accessToken as string,
      apiSecret: secrets?.apiSecret,
    });

    let raws: any[];
    try {
      raws = await client.listCheckouts();
    } catch (e) {
      // e.g. a token type for which REST checkouts is unavailable —
      // surfaced verbatim, never replaced with a fabricated list.
      throw new BadRequestException(errMsg(e));
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const raw of raws ?? []) {
      try {
        const result = await upsertAbandonedStoreCheckout(this.prisma as any, {
          organizationId: orgId,
          storeId,
          payload: raw,
        });
        if (result === "created") created++;
        else updated++;
      } catch (e) {
        skipped++;
        errors.push(errMsg(e));
      }
    }

    if (this.audit) {
      await this.audit
        .log({
          organizationId: orgId,
          userId: actorId,
          action: "commerce.abandoned_backfill",
          entityType: "Store",
          entityId: storeId,
          metadata: { storeId, fetched: (raws ?? []).length, created, updated },
        })
        .catch(() => undefined);
    }

    return {
      capability: "rest_backfill",
      storeId,
      fetched: (raws ?? []).length,
      created,
      updated,
      skipped,
      errors,
    };
  }

  async getWhatsAppRecoveryData(orgId: string, checkoutId: string, customDiscountCode = "SAVE10") {
    let row = await (this.prisma as any).abandonedStoreCheckout.findFirst({
      where: { id: checkoutId, organizationId: orgId },
    });
    let phone = row?.phone;
    let items = (row?.items as any[]) ?? [];
    let checkoutUrl = row?.checkoutUrl;

    if (!row) {
      const cart = await (this.prisma as any).storefrontCart.findFirst({
        where: { id: checkoutId, organizationId: orgId },
        include: { lines: { include: { product: true } } },
      });
      if (cart) {
        phone = cart.phone;
        items = (cart.lines || []).map((l: any) => ({ name: l.product?.name, quantity: l.quantity }));
        const org = await (this.prisma as any).organization.findUnique({ where: { id: orgId } });
        checkoutUrl = org?.slug ? `/shop/${org.slug}` : `/`;
      }
    }

    if (!phone) {
      throw new BadRequestException("এই কার্টে কোনো ফোন নম্বর নেই — WhatsApp রিকভারি সম্ভব নয়");
    }

    let cleanPhone = String(phone).replace(/\D/g, "");
    if (cleanPhone.startsWith("0")) cleanPhone = `88${cleanPhone}`;
    else if (!cleanPhone.startsWith("880") && cleanPhone.length === 10) cleanPhone = `880${cleanPhone}`;

    const itemNames = items.map((i) => i.name || "পণ্য").slice(0, 3).join(", ");
    const discount = (customDiscountCode || "SAVE10").toUpperCase();
    const text = `আসসালামু আলাইকুম! আপনার কার্টে থাকা (${itemNames || "পণ্যসমূহ"}) অর্ডার করার জন্য সংরক্ষিত আছে।\n\nএখনই অর্ডার নিশ্চিত করলে পাচ্ছেন বিশেষ ছাড়! চেকআউটে কুপন কোড ব্যবহার করুন: *${discount}*\n\n🛒 অর্ডার সম্পন্ন করার লিংক:\n${checkoutUrl || "আমাদের শপে ভিজিট করুন"}`;

    const waLink = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;

    if (this.audit) {
      await this.audit
        .log({
          organizationId: orgId,
          action: "commerce.whatsapp_recovery_generated",
          entityType: "AbandonedCheckout",
          entityId: checkoutId,
          metadata: { phone: cleanPhone, discountCode: discount },
        })
        .catch(() => undefined);
    }

    return {
      phone: cleanPhone,
      itemSummary: itemNames,
      discountCode: discount,
      messageText: text,
      waLink,
    };
  }
}
