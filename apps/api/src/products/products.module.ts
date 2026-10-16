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
import { ConnectionsModule } from "../connections/connections.module";
import { CatalogsModule } from "../catalogs/catalogs.module";

@Module({
  // Union: StorageModule (R2 media, ours) + ConnectionsModule /
  // CatalogsModule (AB5/AX10 catalog auto-sync hook, theirs —
  // CatalogsModule is a leaf, so no cycle).
  imports: [InventoryModule, IntegrationsModule, CommerceModule, AffiliatesModule, FraudModule, StorageModule, ConnectionsModule, CatalogsModule],
  controllers: [ProductsController, PublicCheckoutController],
  providers: [ProductsService, ProductImageMirrorService],
  exports: [ProductsService, ProductImageMirrorService],
})
export class ProductsModule {}
