import { Module } from "@nestjs/common";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";
import { CommerceModule } from "../commerce/commerce.module";

// PrismaModule / AuditModule are @Global — no imports needed.
// CommerceModule provides CatalogPushService (EC4 stock-push
// notifications); it does not import InventoryModule — no cycle.
@Module({
  imports: [CommerceModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
