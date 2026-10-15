import { Module } from "@nestjs/common";
import { ProductsController, PublicCheckoutController } from "./products.controller";
import { ProductsService } from "./products.service";
import { ProductImageMirrorService } from "./product-image-mirror.service";
import { StorageModule } from "../storage/storage.module";
import { InventoryModule } from "../inventory/inventory.module";
import { IntegrationsModule } from "../integrations/integrations.module";
import { CommerceModule } from "../commerce/commerce.module";
import { AffiliatesModule } from "../affiliates/affiliates.module";
import { FraudModule } from "../fraud/fraud.module";

@Module({
  imports: [InventoryModule, IntegrationsModule, CommerceModule, AffiliatesModule, FraudModule, StorageModule],
  controllers: [ProductsController, PublicCheckoutController],
  providers: [ProductsService, ProductImageMirrorService],
  exports: [ProductsService, ProductImageMirrorService],
})
export class ProductsModule {}
