import { Inject, Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { decryptJson } from "../crypto";
import { WooClient } from "../woocommerce/woo.client";
import { registerWooWebhooks } from "../woocommerce/woo-webhooks";
import { ShopifyGraphQLClient } from "../shopify/shopify-graphql.client";
import { ensureShopifyWebhookSubscriptions } from "../shopify/shopify-webhooks";
import * as wooCatalog from "./woo-catalog";
import * as shopifyCatalog from "./shopify-catalog";
import * as wooOrders from "./woo-orders";
import * as shopifyOrders from "./shopify-orders";
import * as wooCustomers from "./woo-customers";
import * as shopifyCustomers from "./shopify-customers";
import * as wooDiscounts from "./woo-discounts";
import * as shopifyDiscounts from "./shopify-discounts";
import {
  CAPABILITY_NOT_IMPLEMENTED,
  type AdapterExecuteResult,
  type CommerceAdapter,
  type CommerceAdapterContext,
} from "./adapter";

export { CAPABILITY_NOT_IMPLEMENTED };
export type { CommerceAdapter, CommerceAdapterContext, AdapterExecuteResult };

export function platformKeyForStore(storePlatform: string): string {
  switch (storePlatform) {
    case "WOOCOMMERCE": return "woocommerce";
    case "SHOPIFY": return "shopify";
    case "CUSTOM": return "native";
    default: return String(storePlatform ?? "").toLowerCase();
  }
}

function getEncrypted(integration: any): string | null {
  return integration?.credential?.encryptedData ?? integration?.credential?.encrypted_data ?? null;
}

const WRITE_OPERATIONS = [
  "push_product",
  "push_inventory",
  "push_category",
  "archive_product",
  "delete_product_remote",
] as const;

// EC6/EC7: customer + discount operations, dispatched to the
// *-customers / *-discounts modules (one op each).
const CUSTOMER_OPERATIONS = ["push_customer"] as const;
const DISCOUNT_OPERATIONS = ["push_discount"] as const;

// EC5: order-side operations, dispatched to the *-orders modules.
const ORDER_OPERATIONS = [
  "push_order_status",
  "create_fulfillment",
  "push_order_note",
  "push_refund",
  "cancel_order",
  "push_order_address",
  "create_draft_order",
] as const;

export class WooCommerceAdapter implements CommerceAdapter {
  platform = "woocommerce";
  capabilities: Record<string, boolean> = {
    read_products: true,
    read_orders: true,
    register_webhooks: true,
    push_product: true,
    push_inventory: true,
    push_category: true,
    archive_product: true,
    delete_product_remote: true,
    push_price: false,
    push_order_status: true,
    create_fulfillment: true,
    push_order_note: true,
    push_refund: true,
    cancel_order: true,
    push_order_address: true,
    create_draft_order: true,
    push_customer: true,
    push_discount: true,
  };

  constructor(private readonly prisma?: any) {}

  async execute(ctx: CommerceAdapterContext): Promise<AdapterExecuteResult> {
    if ((CUSTOMER_OPERATIONS as readonly string[]).includes(ctx.operation)) {
      if (!this.prisma) return { ok: false, error: "adapter_prisma_unavailable" };
      return wooCustomers.pushCustomer({
        prisma: this.prisma,
        organizationId: ctx.organizationId,
        store: ctx.store,
        integration: ctx.integration,
        payload: ctx.payload ?? {},
      });
    }
    if ((DISCOUNT_OPERATIONS as readonly string[]).includes(ctx.operation)) {
      if (!this.prisma) return { ok: false, error: "adapter_prisma_unavailable" };
      return wooDiscounts.pushDiscount({
        prisma: this.prisma,
        organizationId: ctx.organizationId,
        store: ctx.store,
        integration: ctx.integration,
        payload: ctx.payload ?? {},
      });
    }
    if ((ORDER_OPERATIONS as readonly string[]).includes(ctx.operation)) {
      if (!this.prisma) return { ok: false, error: "adapter_prisma_unavailable" };
      const args = {
        prisma: this.prisma,
        organizationId: ctx.organizationId,
        store: ctx.store,
        integration: ctx.integration,
        payload: ctx.payload ?? {},
      };
      switch (ctx.operation) {
        case "push_order_status": return wooOrders.pushOrderStatus(args);
        case "cancel_order": return wooOrders.cancelOrder(args);
        case "create_fulfillment": return wooOrders.createFulfillment(args);
        case "push_order_note": return wooOrders.pushOrderNote(args);
        case "push_refund": return wooOrders.pushRefund(args);
        case "push_order_address": return wooOrders.pushOrderAddress(args);
        case "create_draft_order": return wooOrders.createDraftOrder(args);
      }
    }
    if ((WRITE_OPERATIONS as readonly string[]).includes(ctx.operation)) {
      if (!this.prisma) return { ok: false, error: "adapter_prisma_unavailable" };
      const args = {
        prisma: this.prisma,
        organizationId: ctx.organizationId,
        store: ctx.store,
        integration: ctx.integration,
        payload: ctx.payload ?? {},
      };
      switch (ctx.operation) {
        case "push_product": return wooCatalog.pushProduct(args);
        case "archive_product": return wooCatalog.archiveProduct(args);
        case "delete_product_remote": return wooCatalog.deleteProductRemote(args);
        case "push_inventory": return wooCatalog.pushInventory(args);
        case "push_category": return wooCatalog.pushCategory(args);
      }
    }
    if (ctx.operation !== "register_webhooks") {
      return { ok: false, error: CAPABILITY_NOT_IMPLEMENTED };
    }
    const encrypted = getEncrypted(ctx.integration);
    if (!encrypted) return { ok: false, error: "webhook_secret_missing" };
    let secrets: any;
    try {
      secrets = decryptJson<any>(encrypted);
    } catch {
      return { ok: false, error: "webhook_secret_missing" };
    }
    if (!secrets?.webhookSecret) return { ok: false, error: "webhook_secret_missing" };
    const deliveryUrl = ctx.payload?.deliveryUrl as string | undefined;
    if (!deliveryUrl) return { ok: false, error: "delivery_url_missing" };
    const client = new WooClient(ctx.store.url, { consumerKey: secrets.consumerKey, consumerSecret: secrets.consumerSecret });
    const topics = await registerWooWebhooks(client, { deliveryUrl, secret: secrets.webhookSecret });
    const failed = topics.filter((t) => t.status === "failed");
    if (failed.length > 0) {
      return { ok: false, error: `webhook registration failed for: ${failed.map((t) => t.topic).join(", ")}`, responseSummary: { topics } };
    }
    return { ok: true, responseSummary: { topics } };
  }
}

export class ShopifyAdapter implements CommerceAdapter {
  platform = "shopify";
  capabilities: Record<string, boolean> = {
    read_products: true,
    read_orders: true,
    register_webhooks: true,
    push_product: true,
    push_inventory: true,
    push_category: true,
    archive_product: true,
    delete_product_remote: true,
    push_price: false,
    push_order_status: true,
    create_fulfillment: true,
    push_order_note: true,
    push_refund: true,
    cancel_order: true,
    push_order_address: true,
    create_draft_order: true,
    push_customer: true,
    push_discount: true,
  };

  constructor(private readonly prisma?: any) {}

  async execute(ctx: CommerceAdapterContext): Promise<AdapterExecuteResult> {
    if ((CUSTOMER_OPERATIONS as readonly string[]).includes(ctx.operation)) {
      if (!this.prisma) return { ok: false, error: "adapter_prisma_unavailable" };
      return shopifyCustomers.pushCustomer({
        prisma: this.prisma,
        organizationId: ctx.organizationId,
        store: ctx.store,
        integration: ctx.integration,
        payload: ctx.payload ?? {},
      });
    }
    if ((DISCOUNT_OPERATIONS as readonly string[]).includes(ctx.operation)) {
      if (!this.prisma) return { ok: false, error: "adapter_prisma_unavailable" };
      return shopifyDiscounts.pushDiscount({
        prisma: this.prisma,
        organizationId: ctx.organizationId,
        store: ctx.store,
        integration: ctx.integration,
        payload: ctx.payload ?? {},
      });
    }
    if ((ORDER_OPERATIONS as readonly string[]).includes(ctx.operation)) {
      if (!this.prisma) return { ok: false, error: "adapter_prisma_unavailable" };
      const args = {
        prisma: this.prisma,
        organizationId: ctx.organizationId,
        store: ctx.store,
        integration: ctx.integration,
        payload: ctx.payload ?? {},
      };
      switch (ctx.operation) {
        case "push_order_status": return shopifyOrders.pushOrderStatus(args);
        case "cancel_order": return shopifyOrders.cancelOrder(args);
        case "create_fulfillment": return shopifyOrders.createFulfillment(args);
        case "push_order_note": return shopifyOrders.pushOrderNote(args);
        case "push_refund": return shopifyOrders.pushRefund(args);
        case "push_order_address": return shopifyOrders.pushOrderAddress(args);
        case "create_draft_order": return shopifyOrders.createDraftOrder(args);
      }
    }
    if ((WRITE_OPERATIONS as readonly string[]).includes(ctx.operation)) {
      if (!this.prisma) return { ok: false, error: "adapter_prisma_unavailable" };
      const args = {
        prisma: this.prisma,
        organizationId: ctx.organizationId,
        store: ctx.store,
        integration: ctx.integration,
        payload: ctx.payload ?? {},
      };
      switch (ctx.operation) {
        case "push_product": return shopifyCatalog.pushProduct(args);
        case "archive_product": return shopifyCatalog.archiveProduct(args);
        case "delete_product_remote": return shopifyCatalog.deleteProductRemote(args);
        case "push_inventory": return shopifyCatalog.pushInventory(args);
        case "push_category": return shopifyCatalog.pushCategory(args);
      }
    }
    if (ctx.operation !== "register_webhooks") {
      return { ok: false, error: CAPABILITY_NOT_IMPLEMENTED };
    }
    const callbackUrl = ctx.payload?.callbackUrl as string | undefined;
    if (!callbackUrl) return { ok: false, error: "callback_url_missing" };
    const encrypted = getEncrypted(ctx.integration);
    if (!encrypted) return { ok: false, error: "access_token_missing" };
    let secrets: any;
    try {
      secrets = decryptJson<any>(encrypted);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "credential_decrypt_failed" };
    }
    const accessToken = secrets?.accessToken as string | undefined;
    if (!accessToken) return { ok: false, error: "access_token_missing" };
    const client = new ShopifyGraphQLClient(ctx.store.url, accessToken);
    const topics = await ensureShopifyWebhookSubscriptions(client, { callbackUrl });
    const failed = topics.filter((t) => t.status === "failed");
    if (failed.length > 0) {
      return { ok: false, error: `webhook subscription failed for: ${failed.map((t) => t.topic).join(", ")}`, responseSummary: { topics } };
    }
    return { ok: true, responseSummary: { topics } };
  }
}

export class NativeAdapter implements CommerceAdapter {
  platform = "native";
  capabilities: Record<string, boolean> = {
    read_products: true,
    read_orders: true,
    register_webhooks: false,
    push_product: false,
    push_inventory: false,
    push_price: false,
    push_order_status: false,
    create_fulfillment: false,
    push_order_note: false,
    push_refund: false,
    cancel_order: false,
    push_order_address: false,
    create_draft_order: false,
    push_customer: false,
    push_discount: false,
  };

  async execute(_ctx: CommerceAdapterContext): Promise<AdapterExecuteResult> {
    return { ok: false, error: CAPABILITY_NOT_IMPLEMENTED };
  }
}

@Injectable()
export class CommerceAdapterRegistry {
  private readonly adapters = new Map<string, CommerceAdapter>();

  constructor(@Optional() @Inject(PrismaService) prisma?: any) {
    this.register(new WooCommerceAdapter(prisma));
    this.register(new ShopifyAdapter(prisma));
    this.register(new NativeAdapter());
  }

  get(platform: string): CommerceAdapter | undefined {
    return this.adapters.get(platform);
  }

  register(adapter: CommerceAdapter): void {
    this.adapters.set(adapter.platform, adapter);
  }

  capabilitiesFor(platform: string): Record<string, boolean> {
    return this.adapters.get(platform)?.capabilities ?? {};
  }
}
