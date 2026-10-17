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
import { OrgBrainModule } from "../ai/org-brain.module";

@Module({
  // Union: StorageModule (R2 media, ours) + ConnectionsModule /
  // CatalogsModule (AB5/AX10 catalog auto-sync hook, theirs —
  // CatalogsModule is a leaf, so no cycle). OrgBrainModule
  // (SA-B2) is likewise a leaf (global Prisma only) and supplies
  // the KnowledgeIndexingService for the product embedding hook.
  imports: [InventoryModule, IntegrationsModule, CommerceModule, AffiliatesModule, FraudModule, StorageModule, ConnectionsModule, CatalogsModule, OrgBrainModule],
  controllers: [ProductsController, PublicCheckoutController],
  providers: [ProductsService, ProductImageMirrorService],
  exports: [ProductsService, ProductImageMirrorService],
})
export class ProductsModule {}
