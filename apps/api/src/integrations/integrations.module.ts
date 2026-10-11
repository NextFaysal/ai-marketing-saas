import { Module } from "@nestjs/common";
import { IntegrationsController } from "./integrations.controller";
import { IntegrationsService } from "./integrations.service";
import { WooWebhooksController } from "./webhooks.controller";
import { ShopifyService } from "./shopify/shopify.service";
import { ShopifyWebhookController } from "./shopify/shopify-webhook.controller";
import { InventoryModule } from "../inventory/inventory.module";
@Module({
  imports: [InventoryModule],
  controllers: [IntegrationsController, WooWebhooksController, ShopifyWebhookController],
  providers: [IntegrationsService, ShopifyService],
  exports: [IntegrationsService, ShopifyService],
})
export class IntegrationsModule {}
