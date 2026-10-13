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
@Module({
  imports: [InventoryModule],
  controllers: [IntegrationsController, WooWebhooksController, WooAuthController, ShopifyWebhookController, ShopifyGdprController],
  providers: [IntegrationsService, WooAuthService, ShopifyService, ListingsService, StoreHealthService],
  exports: [IntegrationsService, WooAuthService, ShopifyService],
})
export class IntegrationsModule {}
