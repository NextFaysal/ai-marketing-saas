import { Module } from "@nestjs/common";
import { IntegrationsController } from "./integrations.controller";
import { IntegrationsService } from "./integrations.service";
import { WooWebhooksController } from "./webhooks.controller";
import { WooAuthService } from "./woo-auth.service";
import { WooAuthController } from "./woo-auth.controller";
import { ShopifyService } from "./shopify/shopify.service";
import { ShopifyWebhookController } from "./shopify/shopify-webhook.controller";
import { ShopifyGdprController } from "./shopify/shopify-gdpr.controller";
import { ListingsService } from "./commerce/listings.service";
import { StoreHealthService } from "./commerce/health.service";
import { InventoryModule } from "../inventory/inventory.module";
import { ErasureService } from "../customers/erasure.service";
@Module({
  imports: [InventoryModule],
  controllers: [IntegrationsController, WooWebhooksController, WooAuthController, ShopifyWebhookController, ShopifyGdprController],
  // CP6: ErasureService is provided HERE (not via CustomersModule)
  // because Customers -> Orders -> Integrations would close a
  // module cycle; the service itself depends only on the global
  // Prisma/Audit modules.
  providers: [IntegrationsService, WooAuthService, ShopifyService, ListingsService, StoreHealthService, ErasureService],
  exports: [IntegrationsService, WooAuthService, ShopifyService],
})
export class IntegrationsModule {}
