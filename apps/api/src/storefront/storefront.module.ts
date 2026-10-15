import { Module } from "@nestjs/common";
import { ProductQuestionsStaffController, PublicShopController, StorefrontStaffController } from "./storefront.controller";
import { StorefrontService } from "./storefront.service";
import { DeliveryPricingService } from "./delivery-pricing.service";
import { ShopAccountService } from "./shop-account.service";
import { RetentionService } from "./retention.service";
import { StorefrontDnsResolver, StorefrontRoutingFetcher } from "./storefront-dns";
import { AuditModule } from "../audit/audit.module";
import { IntegrationsModule } from "../integrations/integrations.module";
import { CommerceModule } from "../commerce/commerce.module";
import { MessagingModule } from "../messaging/messaging.module";
import { AffiliatesModule } from "../affiliates/affiliates.module";
import { FraudModule } from "../fraud/fraud.module";

/**
 * EC8 native storefront. Imports follow the ProductsModule
 * arrangement (IntegrationsModule for upsertOrder, CommerceModule
 * for DiscountsService); neither module imports this one, so the
 * graph stays acyclic.
 */
@Module({
  imports: [AuditModule, IntegrationsModule, CommerceModule, MessagingModule, AffiliatesModule, FraudModule],
  controllers: [PublicShopController, StorefrontStaffController, ProductQuestionsStaffController],
  providers: [StorefrontService, DeliveryPricingService, ShopAccountService, RetentionService, StorefrontDnsResolver, StorefrontRoutingFetcher],
  // EC28: RetentionService is exported for the AutomationModule
  // wishlist_price_alert_sweep job (AutomationModule imports this
  // module; nothing in this module's chain imports it back).
  // EC31: ShopAccountService is exported so InstallmentsModule can
  // send customer reminder SMS through the ONE shared sendShopSms
  // helper instead of growing a second sender.
  exports: [StorefrontService, RetentionService, ShopAccountService],
})
export class StorefrontModule {}
