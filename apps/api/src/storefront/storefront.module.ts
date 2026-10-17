import { Module } from "@nestjs/common";
import { ProductQuestionsStaffController, PublicShopController, StorefrontStaffController } from "./storefront.controller";
import { StorefrontService } from "./storefront.service";
import { CheckoutFieldsService } from "./checkout-fields.service";
import { CheckoutFieldsController } from "./checkout-fields.controller";
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
import { StorageModule } from "../storage/storage.module";
import { InventoryModule } from "../inventory/inventory.module";
import { ConnectionsModule } from "../connections/connections.module";
import { MembershipModule } from "../membership/membership.module";

/**
 * EC8 native storefront. Imports follow the ProductsModule
 * arrangement (IntegrationsModule for upsertOrder, CommerceModule
 * for DiscountsService); neither module imports this one, so the
 * graph stays acyclic. GB2: InventoryModule joins for the
 * availability/reservation reads (it imports only CommerceModule,
 * so the graph stays acyclic).
 */
@Module({
  imports: [AuditModule, IntegrationsModule, CommerceModule, MessagingModule, AffiliatesModule, FraudModule, StorageModule, InventoryModule, ConnectionsModule, MembershipModule],
  controllers: [PublicShopController, StorefrontStaffController, ProductQuestionsStaffController, CheckoutFieldsController],
  providers: [StorefrontService, DeliveryPricingService, ShopAccountService, RetentionService, StorefrontDnsResolver, StorefrontRoutingFetcher, CheckoutFieldsService],
  // EC28: RetentionService is exported for the AutomationModule
  // wishlist_price_alert_sweep job (AutomationModule imports this
  // module; nothing in this module's chain imports it back).
  // EC31: ShopAccountService is exported so InstallmentsModule can
  // send customer reminder SMS through the ONE shared sendShopSms
  // helper instead of growing a second sender.
  exports: [StorefrontService, RetentionService, ShopAccountService],
})
export class StorefrontModule {}
