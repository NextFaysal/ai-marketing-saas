import { Module } from "@nestjs/common";
import { ProductsController, PublicCheckoutController } from "./products.controller";
import { ProductsService } from "./products.service";
import { InventoryModule } from "../inventory/inventory.module";
import { IntegrationsModule } from "../integrations/integrations.module";
import { CommerceModule } from "../commerce/commerce.module";
import { AffiliatesModule } from "../affiliates/affiliates.module";

@Module({
  imports: [InventoryModule, IntegrationsModule, CommerceModule, AffiliatesModule],
  controllers: [ProductsController, PublicCheckoutController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
