import { Module } from "@nestjs/common";
import { ProductsController, PublicCheckoutController } from "./products.controller";
import { ProductsService } from "./products.service";
import { InventoryModule } from "../inventory/inventory.module";
import { IntegrationsModule } from "../integrations/integrations.module";

@Module({
  imports: [InventoryModule, IntegrationsModule],
  controllers: [ProductsController, PublicCheckoutController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
