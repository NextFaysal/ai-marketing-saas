import { Module } from "@nestjs/common";
import { IntegrationsController } from "./integrations.controller";
import { IntegrationsService } from "./integrations.service";
import { WooWebhooksController } from "./webhooks.controller";
import { ShopifyService } from "./shopify/shopify.service";
import { ShopifyWebhookController } from "./shopify/shopify-webhook.controller";
@Module({
  controllers: [IntegrationsController, WooWebhooksController, ShopifyWebhookController],
  providers: [IntegrationsService, ShopifyService],
  exports: [IntegrationsService, ShopifyService],
})
export class IntegrationsModule {}
