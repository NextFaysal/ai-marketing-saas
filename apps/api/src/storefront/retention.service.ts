import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EventsService } from "../common/events.service";
import { phoneKeyLoose } from "../commerce/promotions";
import { ShopAccountService } from "./shop-account.service";
import { StorefrontService } from "./storefront.service";
import { STOCK_INCREASED_EVENT } from "../inventory/inventory.service";
import { badRequest, notFound } from "../i18n";

export interface StockIncreasedPayload {
  organizationId: string;
  productId: string;
  variantId?: string | null;
  variantSku?: string | null;
  prevBalance?: number | null;
  balanceAfter?: number | null;
}

const OPEN_RETURN_STATUSES = ["requested", "approved", "return_shipped", "received"];

/**
 * EC28 — Retention Pack backend.
 *
 *  - Back-in-stock alerts: StockAlertSubscription rows are placed
 *    from the public product page ONLY while the item is out of
 *    stock. The firing hook is InventoryService's stock-increase
 *    paths (adjust — which purchase-receive, stock counts and
 *    return restock all route through — and applyOrderRestore),
 *    which emit `inventory.stock_increased` on a 0 → >0
 *    transition; this service subscribes in its constructor. The
 *    EventsService dispatch is failure-isolated by design, and
 *    onStockIncreased swallows its own errors too: an alert can
 *    NEVER break a stock write. Exactly-once: a subscription
 *    leaves "pending" on its first transition, whatever the send
 *    outcome — notified, or failed_no_channel with the reason.
 *  - Wishlist price-drop alerts: price writes land in several
 *    places (product update, variant update, bulk price edit,
 *    listing sale boundaries) — there is NO single choke point,
 *    so detection is a sweep job (wishlist_price_alert_sweep)
 *    comparing the current price against priceAtAddMinor /
 *    lastNotifiedPriceMinor. One alert per price point: a drop
 *    below the last alerted price alerts again; the same price
 *    never re-fires; an increase never alerts.
 *  - Customer self-service RMA: reuses StorefrontService's ONE
 *    phone+order-number matcher (constant-shape 404) and creates
 *    the EC9 ReturnRequest row shape with source "customer", so
 *    the staff queue sees it identically (plus the source).
 *  - Product Q&A: public asks land as "pending" and are invisible
 *    until staff answer (which publishes). The phone is staff-only
 *    context and is NEVER in a public payload.
 *
 * Every customer SMS goes through ShopAccountService.sendShopSms
 * (the EC25 helper: tenant sender config, else platform, else an
 * honest not-configured) — no second sender exists here.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly shopAccounts?: ShopAccountService,
    @Optional() private readonly storefront?: StorefrontService,
    @Optional() private readonly audit?: AuditService,
    @Optional() events?: EventsService,
  ) {
    events?.on(STOCK_INCREASED_EVENT, async (payload: StockIncreasedPayload) => {
      await this.onStockIncreased(payload);
    });
  }

  private t(name: string): any {
    return (this.prisma as any)[name];
  }

  private async requireEnabledShop(orgSlug: string): Promise<{ org: any; setting: any }> {
    const org = orgSlug
      ? await this.t("organization").findFirst({ where: { slug: orgSlug } }).catch(() => null)
      : null;
    if (!org) throw notFound("orders.storeNotFound");
    let setting: any = null;
    try {
      setting = await this.t("storefrontSetting").findFirst({ where: { organizationId: org.id } });
    } catch {
      setting = null;
    }
    if (!setting || setting.shopEnabled !== true) {
      throw notFound("orders.storeNotFound");
    }
    return { org, setting };
  }

  private async auditLog(input: any): Promise<void> {
    try {
      await this.audit?.log(input);
    } catch {
      /* audit is bookkeeping — never blocks the mutation */
    }
  }

  // ================= Back-in-stock alerts =================

  private serializeSubscription(row: any) {
    return {
      id: row.id,
      productId: row.productId,
      variantSku: row.variantSku ?? null,
      status: row.status,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    };
  }

  /** Effective stock of the subscription target (mirrors
   * StorefrontService.effectiveStock for the product-level case). */
  private async targetStock(product: any, variantSku: string | null): Promise<number | null> {
    if (variantSku) {
      const variant = await this.t("productVariant")
        .findFirst({ where: { productId: product.id, sku: variantSku } })
        .catch(() => null);
      if (!variant) throw notFound("storefront.variantNotFound");
      return variant.stockQuantity ?? null;
    }
    if (product.stockQuantity !== null && product.stockQuantity !== undefined) {
      return product.stockQuantity;
    }
    const variants: any[] =
      (await this.t("productVariant").findMany({ where: { productId: product.id } }).catch(() => [])) ?? [];
    const tracked = variants.filter((v) => v.stockQuantity !== null && v.stockQuantity !== undefined);
    if (tracked.length > 0) return tracked.reduce((sum, v) => sum + Number(v.stockQuantity), 0);
    return null;
  }

  async subscribeStockAlert(
    orgSlug: string,
    dto: { productId: string; variantSku?: string | null; phone: string },
    sessionToken?: string,
  ) {
    const { org } = await this.requireEnabledShop(orgSlug);
    const product = await this.t("product").findFirst({
      where: { id: String(dto.productId ?? ""), organizationId: org.id },
    });
    if (!product || product.status !== "ACTIVE") {
      throw notFound("commerce.productNotFoundShort");
    }
    const variantSku = dto.variantSku?.trim() ? dto.variantSku.trim() : null;
    const stock = await this.targetStock(product, variantSku);
    if (stock === null) {
      throw badRequest("storefront.stockNotTrackedNoAlert");
    }
    if (stock > 0) {
      throw badRequest("storefront.productNowInStock");
    }
    const phoneKey = phoneKeyLoose(dto.phone);
    if (phoneKey.length < 11) {
      throw badRequest("storefront.mobileNumberInvalid");
    }

    const table = this.t("stockAlertSubscription");
    const existing = await table
      .findFirst({
        where: {
          organizationId: org.id,
          productId: product.id,
          variantSku,
          phone: phoneKey,
          status: "pending",
        },
      })
      .catch(() => null);
    if (existing) return { subscription: this.serializeSubscription(existing), existing: true };

    // Optional: link the account customer when the subscriber is
    // logged in (failure-isolated — a bad session never blocks).
    let customerId: string | null = null;
    if (sessionToken && this.shopAccounts) {
      const customer = await this.shopAccounts.resolveSession(org.id, sessionToken).catch(() => null);
      customerId = customer?.id ?? null;
    }

    const row = await table.create({
      data: {
        organizationId: org.id,
        productId: product.id,
        variantSku,
        phone: phoneKey,
        customerId,
        status: "pending",
      },
    });
    return { subscription: this.serializeSubscription(row), existing: false };
  }

  /**
   * The restock hook body (also called directly by specs).
   * Fires ONLY on a 0 → >0 transition of the exact target
   * (product-level subscriptions match product-level increases;
   * variant subscriptions match their variant SKU). Fully
   * failure-isolated: returns counts, never throws.
   */
  async onStockIncreased(payload: StockIncreasedPayload): Promise<{ notified: number; failedNoChannel: number }> {
    const out = { notified: 0, failedNoChannel: 0 };
    try {
      const prev = payload?.prevBalance;
      const after = payload?.balanceAfter;
      if (prev === null || prev === undefined || after === null || after === undefined) return out;
      if (!(prev <= 0 && after > 0)) return out;

      const table = this.t("stockAlertSubscription");
      if (!table?.findMany) return out;
      const pending: any[] =
        (await table
          .findMany({
            where: { organizationId: payload.organizationId, productId: payload.productId, status: "pending" },
          })
          .catch(() => [])) ?? [];
      const wantedSku = payload.variantSku ?? null;
      const targets = pending.filter((s) => (s.variantSku ?? null) === wantedSku);
      if (targets.length === 0) return out;

      const product = await this.t("product")
        .findFirst({ where: { id: payload.productId, organizationId: payload.organizationId } })
        .catch(() => null);
      const productName = product?.name ?? "পণ্যটি";

      for (const sub of targets) {
        const text = `সুখবর! “${productName}” আবার স্টকে এসেছে। দোকানে গিয়ে এখনই অর্ডার করুন।`;
        const send = this.shopAccounts
          ? await this.shopAccounts
              .sendShopSms(payload.organizationId, sub.phone, text, `stock-alert-${sub.id}`)
              .catch((e) => ({
                sent: false as const,
                notConfigured: false,
                reason: e instanceof Error ? e.message : String(e),
              }))
          : { sent: false as const, notConfigured: true, reason: "SMS helper unavailable" };
        if (send.sent) {
          await table
            .update({ where: { id: sub.id }, data: { status: "notified", notifiedAt: new Date() } })
            .catch(() => undefined);
          out.notified++;
        } else {
          await table
            .update({
              where: { id: sub.id },
              data: { status: "failed_no_channel", failureReason: send.reason },
            })
            .catch(() => undefined);
          out.failedNoChannel++;
        }
      }
    } catch (e) {
      this.logger.warn(
        `back-in-stock alert failed for product ${payload?.productId}: ${e instanceof Error ? e.message : "unknown"}`,
      );
    }
    return out;
  }

  // ================= Wishlist price-drop alerts (sweep) =================

  /**
   * wishlist_price_alert_sweep body. For every wishlist row of
   * the org: current price < (lastNotifiedPriceMinor ??
   * priceAtAddMinor) ⇒ one SMS to the customer's phone via the
   * shared helper. On a successful send the new price point is
   * recorded (same price never re-fires; a further drop fires
   * again). No sender / no phone ⇒ the attempt is recorded as
   * failed_no_channel on the item and the price point is NOT
   * consumed, so a later sweep can deliver once a channel exists.
   */
  async runWishlistPriceAlerts(organizationId: string) {
    const out = { checked: 0, notified: 0, failedNoChannel: 0 };
    const table = this.t("wishlistItem");
    if (!table?.findMany) return out;
    const rows: any[] =
      (await table.findMany({ where: { organizationId } }).catch(() => [])) ?? [];
    for (const row of rows) {
      out.checked++;
      try {
        const product = await this.t("product")
          .findFirst({ where: { id: row.productId, organizationId } })
          .catch(() => null);
        if (!product) continue;
        const current = BigInt(product.priceMinor);
        const baseline =
          row.lastNotifiedPriceMinor !== null && row.lastNotifiedPriceMinor !== undefined
            ? BigInt(row.lastNotifiedPriceMinor)
            : BigInt(row.priceAtAddMinor);
        if (!(current < baseline)) continue; // same price, increase, or already alerted at this point

        const customer = await this.t("customer")
          .findFirst({ where: { id: row.customerId, organizationId } })
          .catch(() => null);
        const phone = customer?.phone ? String(customer.phone) : null;
        let sent = false;
        let reason = "গ্রাহকের ফোন নম্বর নেই";
        if (phone && this.shopAccounts) {
          const send = await this.shopAccounts
            .sendShopSms(
              organizationId,
              phone,
              `দাম কমেছে! আপনার উইশলিস্টের “${product.name}” এখন আগের চেয়ে কম দামে পাওয়া যাচ্ছে। দোকানে গিয়ে দেখুন।`,
              `wishlist-price-${row.id}-${current.toString()}`,
            )
            .catch((e) => ({
              sent: false as const,
              notConfigured: false,
              reason: e instanceof Error ? e.message : String(e),
            }));
          sent = send.sent;
          if (!send.sent) reason = send.reason;
        }
        if (sent) {
          await table
            .update({
              where: { id: row.id },
              data: {
                lastNotifiedPriceMinor: current,
                lastAlertStatus: "sent",
                lastAlertAt: new Date(),
              },
            })
            .catch(() => undefined);
          out.notified++;
        } else {
          await table
            .update({
              where: { id: row.id },
              data: { lastAlertStatus: "failed_no_channel", lastAlertAt: new Date() },
            })
            .catch(() => undefined);
          out.failedNoChannel++;
        }
      } catch (e) {
        this.logger.warn(
          `wishlist price alert failed for item ${row?.id}: ${e instanceof Error ? e.message : "unknown"}`,
        );
      }
    }
    return out;
  }

  // ================= Customer self-service RMA =================

  private async orderDelivered(order: any): Promise<boolean> {
    if (["completed", "delivered"].includes(String(order.status))) return true;
    let fulfillments: any[] = Array.isArray(order.fulfillments) ? order.fulfillments : [];
    if (!Array.isArray(order.fulfillments)) {
      try {
        const table = this.t("fulfillment");
        if (table?.findMany) {
          fulfillments = (await table.findMany({ where: { orderId: order.id } }).catch(() => [])) ?? [];
        }
      } catch { fulfillments = []; }
    }
    if (fulfillments.some((f: any) => f.status === "delivered")) return true;
    try {
      const table = this.t("courierShipment");
      if (table?.findMany) {
        const rows: any[] = (await table.findMany({ where: { orderId: order.id } }).catch(() => [])) ?? [];
        if (rows.some((s) => ["delivered", "partial_delivered"].includes(String(s.status)))) return true;
      }
    } catch { /* no shipment table — not delivered-proven */ }
    return false;
  }

  async createCustomerReturn(
    orgSlug: string,
    dto: {
      phone: string;
      orderNumber: string;
      type: "return" | "exchange";
      reason: string;
      items?: Array<{ orderItemId: string; quantity: number }> | null;
    },
  ) {
    if (!this.storefront) {
      throw badRequest("storefront.trackingServiceUnavailableNow");
    }
    // The ONE matcher: every failure is the same constant 404.
    const { org, order } = await this.storefront.matchTrackedOrder(orgSlug, {
      phone: dto.phone,
      orderNumber: dto.orderNumber,
    } as any);

    if (!(await this.orderDelivered(order))) {
      throw badRequest("storefront.returnNeedsDelivery");
    }
    const type = dto.type === "exchange" ? "exchange" : "return";
    const reason = String(dto.reason ?? "").trim();
    if (reason.length < 3) {
      throw badRequest("storefront.reasonRequiredText");
    }

    // The order's own items (embedded or the orderItem table).
    let orderItems: any[] = Array.isArray(order.items) ? order.items : [];
    if (!Array.isArray(order.items)) {
      try {
        const table = this.t("orderItem");
        if (table?.findMany) {
          orderItems = (await table.findMany({ where: { orderId: order.id } }).catch(() => [])) ?? [];
        }
      } catch { orderItems = []; }
    }
    const byId = new Map<string, any>(orderItems.map((i: any) => [String(i.id), i]));

    let lines: Array<{ orderItemId: string; quantity: number }>;
    if (Array.isArray(dto.items) && dto.items.length > 0) {
      lines = [];
      for (const line of dto.items) {
        const oi = byId.get(String(line.orderItemId));
        if (!oi) throw badRequest("storefront.itemNotInOrderShort");
        const qty = Math.floor(Number(line.quantity));
        if (!(qty > 0) || qty > Number(oi.quantity)) {
          throw badRequest("storefront.returnQtyExceedsOrder", { name: oi.name });
        }
        lines.push({ orderItemId: String(oi.id), quantity: qty });
      }
    } else {
      // No explicit selection = the whole order at full quantities.
      lines = orderItems.map((i: any) => ({ orderItemId: String(i.id), quantity: Number(i.quantity) }));
    }
    if (lines.length === 0) {
      throw badRequest("storefront.selectAtLeastOneItem");
    }

    // Duplicate OPEN request of the same type for this order.
    const table = this.t("returnRequest");
    const existing: any[] =
      (await table.findMany({ where: { organizationId: org.id, orderId: order.id } }).catch(() => [])) ?? [];
    const duplicate = existing.some(
      (r) => r.requestType === type && OPEN_RETURN_STATUSES.includes(String(r.status)),
    );
    if (duplicate) {
      throw badRequest("storefront.sameTypeRequestOpen");
    }

    const row = await table.create({
      data: {
        organizationId: org.id,
        orderId: order.id,
        customerId: order.customerId ?? null,
        source: "customer",
        requestType: type,
        status: "requested",
        reason,
        items: lines,
        token: randomBytes(24).toString("hex"),
        restockDecision: "pending",
      },
    });
    await this.auditLog({
      organizationId: org.id,
      userId: undefined,
      action: "returns.customer_requested",
      entityType: "ReturnRequest",
      entityId: row.id,
      metadata: { orderId: order.id, requestType: type, source: "customer" },
    });
    return {
      id: row.id,
      source: "customer",
      requestType: type,
      status: row.status,
      reason: row.reason,
      items: lines,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    };
  }

  // ================= Product Q&A =================

  private async requirePublicProduct(orgSlug: string, productSlug: string) {
    const { org } = await this.requireEnabledShop(orgSlug);
    const product = await this.t("product").findFirst({
      where: { organizationId: org.id, slug: productSlug, status: "ACTIVE" },
    });
    if (!product) throw notFound("commerce.productNotFoundShort");
    return { org, product };
  }

  /** Public ask: lands as PENDING — invisible until staff answer. */
  async askQuestion(
    orgSlug: string,
    productSlug: string,
    dto: { customerName: string; phone?: string | null; question: string },
  ) {
    const { org, product } = await this.requirePublicProduct(orgSlug, productSlug);
    const customerName = String(dto.customerName ?? "").trim();
    const question = String(dto.question ?? "").trim();
    if (customerName.length < 2) throw badRequest("storefront.nameRequiredText");
    if (question.length < 5) throw badRequest("storefront.questionTooShort");
    const phoneKey = dto.phone?.trim() ? phoneKeyLoose(dto.phone) : null;
    const row = await this.t("productQuestion").create({
      data: {
        organizationId: org.id,
        productId: product.id,
        customerName,
        phone: phoneKey,
        question,
        status: "pending",
      },
    });
    return { id: row.id, status: "pending" };
  }

  /** Public list: published only; the phone is NEVER in this shape. */
  async publicQuestions(orgSlug: string, productSlug: string) {
    const { org, product } = await this.requirePublicProduct(orgSlug, productSlug);
    const rows: any[] =
      (await this.t("productQuestion")
        .findMany({
          where: { organizationId: org.id, productId: product.id, status: "published" },
          orderBy: { createdAt: "desc" },
          take: 50,
        })
        .catch(() => [])) ?? [];
    return {
      items: rows.map((r) => ({
        id: r.id,
        customerName: r.customerName,
        question: r.question,
        answer: r.answer ?? null,
        createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
        answeredAt: r.answeredAt ? new Date(r.answeredAt).toISOString() : null,
      })),
    };
  }

  private serializeStaffQuestion(row: any, productName: string | null) {
    return {
      id: row.id,
      productId: row.productId,
      productName,
      customerName: row.customerName,
      phone: row.phone ?? null,
      question: row.question,
      answer: row.answer ?? null,
      status: row.status,
      answeredById: row.answeredById ?? null,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      answeredAt: row.answeredAt ? new Date(row.answeredAt).toISOString() : null,
    };
  }

  async staffListQuestions(organizationId: string, status?: string) {
    const rows: any[] =
      (await this.t("productQuestion")
        .findMany({
          where: status ? { organizationId, status } : { organizationId },
          orderBy: { createdAt: "desc" },
          take: 200,
        })
        .catch(() => [])) ?? [];
    const out = [];
    for (const row of rows) {
      const product = await this.t("product")
        .findFirst({ where: { id: row.productId, organizationId } })
        .catch(() => null);
      out.push(this.serializeStaffQuestion(row, product?.name ?? null));
    }
    return { items: out, total: out.length };
  }

  private async requireQuestion(organizationId: string, questionId: string) {
    const row = await this.t("productQuestion").findFirst({
      where: { id: questionId, organizationId },
    });
    if (!row) throw notFound("storefront.questionNotFound");
    return row;
  }

  /** Answering publishes the question (pending/hidden → published). */
  async staffAnswerQuestion(organizationId: string, actorId: string, questionId: string, answer: string) {
    const row = await this.requireQuestion(organizationId, questionId);
    const text = String(answer ?? "").trim();
    if (!text) throw badRequest("storefront.answerRequiredText");
    const updated = await this.t("productQuestion").update({
      where: { id: row.id },
      data: { answer: text, answeredById: actorId, answeredAt: new Date(), status: "published" },
    });
    await this.auditLog({
      organizationId,
      userId: actorId,
      action: "product_question.answered",
      entityType: "ProductQuestion",
      entityId: row.id,
      metadata: { productId: row.productId },
    });
    const product = await this.t("product")
      .findFirst({ where: { id: row.productId, organizationId } })
      .catch(() => null);
    return this.serializeStaffQuestion(updated ?? { ...row, answer: text, status: "published" }, product?.name ?? null);
  }

  async staffSetQuestionVisibility(
    organizationId: string,
    actorId: string,
    questionId: string,
    hidden: boolean,
  ) {
    const row = await this.requireQuestion(organizationId, questionId);
    const status = hidden ? "hidden" : row.answer ? "published" : "pending";
    const updated = await this.t("productQuestion").update({
      where: { id: row.id },
      data: { status },
    });
    await this.auditLog({
      organizationId,
      userId: actorId,
      action: hidden ? "product_question.hidden" : "product_question.unhidden",
      entityType: "ProductQuestion",
      entityId: row.id,
      metadata: { productId: row.productId, status },
    });
    const product = await this.t("product")
      .findFirst({ where: { id: row.productId, organizationId } })
      .catch(() => null);
    return this.serializeStaffQuestion(updated ?? { ...row, status }, product?.name ?? null);
  }

  async staffDeleteQuestion(organizationId: string, actorId: string, questionId: string) {
    const row = await this.requireQuestion(organizationId, questionId);
    await this.t("productQuestion").delete({ where: { id: row.id } });
    await this.auditLog({
      organizationId,
      userId: actorId,
      action: "product_question.deleted",
      entityType: "ProductQuestion",
      entityId: row.id,
      metadata: { productId: row.productId },
    });
    return { deleted: true };
  }
}
