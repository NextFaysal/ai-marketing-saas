import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { randomBytes } from "node:crypto";
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
const RECOVERY_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

@Injectable()
export class AbandonedCheckoutsService {
  private readonly logger = new Logger(AbandonedCheckoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly email?: EmailProvider,
    @Optional() private readonly events?: EventsService,
    @Optional() private readonly trackerCarts?: AbandonedCartsService,
  ) {}

  // ---------- GB7: abandoned recovery coupon setting ----------

  private serializeCouponSetting(row: any): any {
    if (!row) {
      return { enabled: false, kind: "percent", value: 0, expiryHours: 72, minOrderMinor: null };
    }
    return {
      enabled: row.enabled ?? false,
      kind: row.kind ?? "percent",
      value: row.value ?? 0,
      expiryHours: row.expiryHours ?? 72,
      minOrderMinor: row.minOrderMinor == null ? null : String(row.minOrderMinor),
    };
  }

  async getCouponSetting(orgId: string) {
    let row: any = null;
    try {
      const table = (this.prisma as any).abandonedCouponSetting;
      row = table?.findFirst ? await table.findFirst({ where: { organizationId: orgId } }) : null;
    } catch {
      row = null;
    }
    return this.serializeCouponSetting(row);
  }

  async updateCouponSetting(orgId: string, actorId: string, dto: any) {
    const existing = await this.getCouponSetting(orgId);
    const merged = {
      enabled: dto?.enabled !== undefined ? dto.enabled === true : existing.enabled,
      kind: dto?.kind !== undefined ? String(dto.kind) : existing.kind,
      value: dto?.value !== undefined ? dto.value : existing.value,
      expiryHours: dto?.expiryHours !== undefined ? dto.expiryHours : existing.expiryHours,
      minOrderMinor:
        dto?.minOrderMinor !== undefined ? dto.minOrderMinor : existing.minOrderMinor,
    };
    if (!["percent", "fixed"].includes(merged.kind)) {
      throw new BadRequestException("কুপনের ধরন percent অথবা fixed হতে হবে");
    }
    if (merged.enabled) {
      if (merged.kind === "percent") {
        if (!Number.isInteger(merged.value) || merged.value < 1 || merged.value > 90) {
          throw new BadRequestException("শতাংশ কুপনের মান ১–৯০ হতে হবে");
        }
      } else if (!Number.isInteger(merged.value) || merged.value < 1) {
        throw new BadRequestException("নির্দিষ্ট পরিমাণ কুপনের মান কমপক্ষে ১ হতে হবে");
      }
    }
    if (!Number.isInteger(merged.expiryHours) || merged.expiryHours < 1 || merged.expiryHours > 720) {
      throw new BadRequestException("কুপনের মেয়াদ ১–৭২০ ঘণ্টা হতে হবে");
    }
    let minOrderMinor: bigint | null = null;
    if (merged.minOrderMinor !== null && merged.minOrderMinor !== undefined && merged.minOrderMinor !== "") {
      try {
        minOrderMinor = BigInt(merged.minOrderMinor as any);
      } catch {
        throw new BadRequestException("ন্যূনতম অর্ডার পরিমাণ সঠিক সংখ্যা হতে হবে");
      }
      if (minOrderMinor < 0n) {
        throw new BadRequestException("ন্যূনতম অর্ডার পরিমাণ ০ বা তার বেশি হতে হবে");
      }
    }
    const data = {
      enabled: merged.enabled,
      kind: merged.kind,
      value: merged.value,
      expiryHours: merged.expiryHours,
      minOrderMinor,
    };
    const table = (this.prisma as any).abandonedCouponSetting;
    let row: any = null;
    if (table?.upsert) {
      row = await table.upsert({
        where: { organizationId: orgId },
        update: data,
        create: { organizationId: orgId, ...data },
      });
    } else if (table?.findFirst) {
      const found = await table.findFirst({ where: { organizationId: orgId } });
      row = found
        ? await table.update({ where: { id: found.id }, data })
        : await table.create({ data: { organizationId: orgId, ...data } });
    }
    if (this.audit) {
      await this.audit
        .log({
          organizationId: orgId,
          userId: actorId,
          action: "commerce.abandoned_coupon_setting_updated",
          entityType: "AbandonedCouponSetting",
          entityId: row?.id ?? orgId,
          metadata: { enabled: data.enabled, kind: data.kind, value: data.value, expiryHours: data.expiryHours },
        })
        .catch(() => undefined);
    }
    return this.serializeCouponSetting(row ?? { ...data, organizationId: orgId });
  }

  /** GB7: issue a REAL recovery coupon when the setting is on.
   * Failure-isolated: any failure (read or create) → null, and
   * the recovery send continues WITHOUT a coupon.
   *
   * AX18: made PUBLIC as issueRecoveryCoupon so the workflow
   * engine's issue_recovery_coupon action can reuse the exact
   * same machinery. NOTE — this method does NOT dedupe by
   * sourceRef: the EC10 call sites pass the checkout/cart id
   * (String(checkoutId) / String(cartId)) and rely on their
   * audit-marker duplicate-send guards, so calling this twice
   * with the same ref issues TWO coupons. Exactly-once is the
   * CALLER's job when it needs it — the workflow action does
   * its own StoreDiscount pre-check keyed on its wf: sourceRef
   * before calling here (see workflows.service.ts). */
  async issueRecoveryCoupon(
    orgId: string,
    sourceRef: string,
  ): Promise<{ code: string; kind: string; value: number; expiryHours: number } | null> {
    try {
      const table = (this.prisma as any).abandonedCouponSetting;
      const setting = table?.findFirst
        ? await table.findFirst({ where: { organizationId: orgId } }).catch(() => null)
        : null;
      if (!setting?.enabled) return null;
      const expiryHours = Number(setting.expiryHours ?? 72);
      let minOrderMinor: bigint | null = null;
      if (setting.minOrderMinor != null) {
        try { minOrderMinor = BigInt(setting.minOrderMinor); } catch { minOrderMinor = null; }
      }
      const discountTable = (this.prisma as any).storeDiscount;
      if (!discountTable?.create) return null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const bytes = randomBytes(8);
        let suffix = "";
        for (let i = 0; i < 8; i++) suffix += RECOVERY_CODE_ALPHABET[bytes[i] % RECOVERY_CODE_ALPHABET.length];
        const code = `RCV-${suffix}`;
        try {
          await discountTable.create({
            data: {
              organizationId: orgId,
              code,
              kind: setting.kind,
              value: setting.value,
              minOrderMinor,
              endsAt: new Date(Date.now() + expiryHours * 3600_000),
              perCustomerLimit: 1,
              firstOrderOnly: false,
              active: true,
              origin: "abandoned_recovery",
              sourceRef: String(sourceRef),
            },
          });
          return { code, kind: String(setting.kind), value: Number(setting.value), expiryHours };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const isUnique = /unique|P2002/i.test(msg);
          if (isUnique && attempt < 4) continue;
          this.logger.warn(`recovery coupon issuance failed for org ${orgId}: ${msg}`);
          return null;
        }
      }
      return null;
    } catch (e) {
      this.logger.warn(
        `recovery coupon issuance failed for org ${orgId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  private couponLines(coupon: { code: string; kind: string; value: number; expiryHours: number }): string[] {
    const discountText = coupon.kind === "percent" ? `${coupon.value}% ছাড়` : `৳${coupon.value} ছাড়`;
    return [
      `আপনার জন্য একটি কুপন কোড: ${coupon.code} (${discountText})`,
      `কোডটি ${coupon.expiryHours} ঘণ্টা পর্যন্ত বৈধ`,
    ];
  }

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

    // GB7: after the duplicate-send guard, before composing the
    // message — issue a real recovery coupon when enabled.
    const recoveryCoupon = await this.issueRecoveryCoupon(orgId, String(checkoutId));

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
    if (recoveryCoupon) {
      lines.push("", ...this.couponLines(recoveryCoupon));
    }
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
            ...(recoveryCoupon ? { couponCode: recoveryCoupon.code } : {}),
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

    // GB7: after the duplicate-send guard, before composing the
    // message — issue a real recovery coupon when enabled.
    const recoveryCoupon = await this.issueRecoveryCoupon(orgId, String(cartId));

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
    if (recoveryCoupon) {
      lines.push("", ...this.couponLines(recoveryCoupon));
    }
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
          metadata: {
            to: cart.email,
            providerMessageId,
            lastCartActivity: lastActivity,
            ...(recoveryCoupon ? { couponCode: recoveryCoupon.code } : {}),
          },
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

  /**
   * AX18: EC10 sequence state for one checkout — is it enrolled
   * in a workflow sequence, and where has that run got to?
   *
   * Achieved depth (following the real data): WorkflowRun has
   * NO subject/checkout column and NO updatedAt column — the
   * only link is the run's `context` Json. Runs are therefore
   * matched IN JS against the context keys the real producers
   * store: the EC10 recovery sends emit cart.abandoned with
   * context.checkoutId (store checkout) / context.cartId
   * (native cart), and sendStoreRecovery also stamps
   * externalCheckoutId; `abandonedCheckoutId` is accepted too
   * for forward compatibility. Tracker-derived carts carry
   * visitorId/sessionKey instead and are NOT checkouts in this
   * service, so they 404 here like any unknown id.
   *
   * stepsLog entries are { step, status, detail } (+ optional
   * branch) with NO per-step timestamp, so no per-step `at` can
   * be returned; lastActivityAt falls back to the run's
   * createdAt (the only timestamp the model carries).
   * currentStepIndex is the stored nextStepIndex verbatim —
   * for a waiting run it is the NEXT step to execute; runs
   * that never paused keep the schema default 0.
   */
  async getCheckoutSequence(orgId: string, checkoutId: string) {
    const p = this.prisma as any;
    let checkout: any = null;
    try {
      checkout = await p.abandonedStoreCheckout?.findFirst?.({
        where: { id: checkoutId, organizationId: orgId },
      });
    } catch {
      checkout = null;
    }
    if (!checkout) {
      try {
        checkout = await p.storeCart?.findFirst?.({
          where: { id: checkoutId, organizationId: orgId },
        });
      } catch {
        checkout = null;
      }
    }
    if (!checkout) throw new NotFoundException("Abandoned checkout not found in this organization");

    let runs: any[] = [];
    try {
      runs =
        (await p.workflowRun?.findMany?.({
          where: { organizationId: orgId },
          orderBy: { createdAt: "desc" },
          take: 200,
        })) ?? [];
    } catch {
      runs = [];
    }
    const referencesCheckout = (run: any): boolean => {
      const ctx = (run?.context ?? {}) as Record<string, any>;
      return (
        ctx.checkoutId === checkoutId ||
        ctx.cartId === checkoutId ||
        ctx.abandonedCheckoutId === checkoutId ||
        (checkout.externalCheckoutId != null && ctx.externalCheckoutId === checkout.externalCheckoutId)
      );
    };
    const run = (runs as any[]).find(referencesCheckout);
    if (!run) return { enrolled: false };

    let workflowName: string | undefined;
    try {
      const workflow = await p.workflow?.findFirst?.({
        where: { id: run.workflowId, organizationId: orgId },
      });
      workflowName = workflow?.name ?? undefined;
    } catch {
      workflowName = undefined;
    }

    const steps = (Array.isArray(run.stepsLog) ? run.stepsLog : []).map((entry: any) => {
      const out: Record<string, any> = {};
      if (entry?.step !== undefined) out.step = entry.step;
      if (entry?.status !== undefined) out.status = entry.status;
      if (entry?.detail !== undefined) out.detail = entry.detail;
      if (entry?.branch !== undefined) out.branch = entry.branch;
      return out;
    });
    const lastActivity = run.updatedAt ?? run.createdAt;
    return {
      enrolled: true,
      ...(workflowName ? { workflowName } : {}),
      runStatus: run.status,
      currentStepIndex: run.nextStepIndex ?? null,
      steps,
      lastActivityAt: toIso(lastActivity),
    };
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

  async getWhatsAppRecoveryData(orgId: string, checkoutId: string, customDiscountCode = "SAVE10", customDiscountText?: string) {
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

    if (!phone && this.trackerCarts?.list) {
      try {
        const trackerPart = await this.trackerCarts.list(orgId);
        const trackerCart = ((trackerPart as any)?.carts || []).find((c: any) => c.visitorId === checkoutId || c.id === checkoutId);
        if (trackerCart) {
          phone = trackerCart.contact?.phone;
          items = trackerCart.items ?? [];
          checkoutUrl = trackerCart.storeUrl ?? null;
        }
      } catch {
        // ignore
      }
    }

    if (!phone) {
      try {
        const chase = await (this.prisma as any).orderChase?.findFirst({
          where: { id: checkoutId, organizationId: orgId },
        });
        const sessionId = chase?.sessionId || checkoutId;
        const session = await (this.prisma as any).botSession?.findFirst({
          where: { id: sessionId, organizationId: orgId },
        });
        if (session) {
          phone = (session.data as any)?.phone || (session.data as any)?.customerPhone || (session.data as any)?.contactPhone;
          const pid = (session.data as any)?.productId;
          if (pid) {
            const prod = await (this.prisma as any).product?.findUnique({ where: { id: pid } });
            if (prod) items = [{ name: prod.name, quantity: (session.data as any)?.quantity || 1 }];
          }
          const org = await (this.prisma as any).organization.findUnique({ where: { id: orgId } });
          checkoutUrl = org?.slug ? `/shop/${org.slug}` : `/`;
        }
      } catch {
        // ignore
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
    const discountPhrase = customDiscountText ? ` (${customDiscountText})` : "";
    const text = `আসসালামু আলাইকুম! আপনার কার্টে থাকা (${itemNames || "পণ্যসমূহ"}) অর্ডার করার জন্য সংরক্ষিত আছে।\n\nএখনই অর্ডার নিশ্চিত করলে পাচ্ছেন বিশেষ ছাড়! চেকআউটে কুপন কোড ব্যবহার করুন: *${discount}*${discountPhrase}\n\n🛒 অর্ডার সম্পন্ন করার লিংক:\n${checkoutUrl || "আমাদের শপে ভিজিট করুন"}`;

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
