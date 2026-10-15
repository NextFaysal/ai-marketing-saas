import { Global, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { IntegrationsModule } from "../integrations/integrations.module";
import { IntegrationsService } from "../integrations/integrations.service";
import { ShopifyService } from "../integrations/shopify/shopify.service";
import { ListingsService } from "../integrations/commerce/listings.service";
import { StoreHealthService } from "../integrations/commerce/health.service";
import { CommerceModule } from "./commerce.module";
import { OrderPushService } from "./order-push.service";
import { FulfillmentModule } from "../fulfillment/fulfillment.module";
import { FulfillmentService } from "../fulfillment/fulfillment.service";
import { ReturnsService } from "../fulfillment/returns.service";
import { SyncOutboxService } from "./sync-outbox.service";
import { CommerceService } from "./commerce.service";
import { CommerceAdapterRegistry } from "../integrations/commerce/adapters";
import { PrismaService } from "../prisma/prisma.service";
import { AuditModule } from "../audit/audit.module";

/**
 * EC1/EC2 — DI regression spec (the M65 insurance, same approach
 * as s2-order-actions.di.spec.ts). Positional-construction unit
 * tests cannot prove Nest actually injects the @Optional
 * ListingsService into IntegrationsService, nor that the new
 * CommerceModule / health / outbox providers resolve in the real
 * graph. This spec compiles the real modules (with a fake global
 * PrismaService so no database is touched) and asserts the wiring.
 */
describe("EC module graph (Integrations + Commerce)", () => {
  it("resolves all EC providers and injects ListingsService into IntegrationsService", async () => {
    const fakePrisma: any = { auditLog: { create: jest.fn(async () => ({})) } };

    @Global()
    @Module({ providers: [{ provide: PrismaService, useValue: fakePrisma }], exports: [PrismaService] })
    class FakePrismaModule {}

    @Module({ imports: [FakePrismaModule, AuditModule, IntegrationsModule, CommerceModule, FulfillmentModule] })
    class EcGraphRootModule {}

    const ctx = await NestFactory.createApplicationContext(EcGraphRootModule, { logger: false });
    try {
      const integrations = ctx.get(IntegrationsService);
      expect((integrations as any).listings).toBeInstanceOf(ListingsService);
      expect(ctx.get(ShopifyService)).toBeInstanceOf(ShopifyService);
      expect(ctx.get(StoreHealthService)).toBeInstanceOf(StoreHealthService);
      const outbox = ctx.get(SyncOutboxService);
      expect(outbox).toBeInstanceOf(SyncOutboxService);
      expect(ctx.get(CommerceService)).toBeInstanceOf(CommerceService);
      const registry = ctx.get(CommerceAdapterRegistry);
      expect(registry.get("woocommerce")?.capabilities.register_webhooks).toBe(true);
      // EC3 (B2): Shopify/Woo write-back landed — push_product is
      // now implemented; B1 asserted false.
      expect(registry.get("shopify")?.capabilities.push_product).toBe(true);
      expect(registry.get("woocommerce")?.capabilities.push_product).toBe(true);
      expect(registry.get("native")?.capabilities.push_product).toBe(false);
      // EC5 (B3): order-side writes landed on both platforms.
      for (const platform of ["woocommerce", "shopify"]) {
        const caps = registry.get(platform)?.capabilities ?? {};
        for (const op of ["push_order_status", "create_fulfillment", "push_order_note", "push_refund", "cancel_order", "push_order_address", "create_draft_order"]) {
          expect(caps[op]).toBe(true);
        }
      }
      expect(registry.get("native")?.capabilities.push_order_status).toBe(false);
      // EC5/EC9 services resolve in the real graph.
      expect(ctx.get(OrderPushService)).toBeInstanceOf(OrderPushService);
      expect(ctx.get(FulfillmentService)).toBeInstanceOf(FulfillmentService);
      expect(ctx.get(ReturnsService)).toBeInstanceOf(ReturnsService);
      const ordersSvc: any = ctx.get((await import("../orders/orders.service")).OrdersService);
      expect(ordersSvc.orderPush).toBeInstanceOf(OrderPushService);
    } finally {
      await ctx.close();
    }
  });
});
