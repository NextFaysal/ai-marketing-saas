import { Module } from "@nestjs/common";
import { PublicShopController, StorefrontStaffController } from "./storefront.controller";
import { StorefrontService } from "./storefront.service";
import { StorefrontDnsResolver, StorefrontRoutingFetcher } from "./storefront-dns";
import { AuditModule } from "../audit/audit.module";
import { IntegrationsModule } from "../integrations/integrations.module";
import { CommerceModule } from "../commerce/commerce.module";

/**
 * EC8 native storefront. Imports follow the ProductsModule
 * arrangement (IntegrationsModule for upsertOrder, CommerceModule
 * for DiscountsService); neither module imports this one, so the
 * graph stays acyclic.
 */
@Module({
  imports: [AuditModule, IntegrationsModule, CommerceModule],
  controllers: [PublicShopController, StorefrontStaffController],
  providers: [StorefrontService, StorefrontDnsResolver, StorefrontRoutingFetcher],
  exports: [StorefrontService],
})
export class StorefrontModule {}
