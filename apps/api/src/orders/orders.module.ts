import { Module } from "@nestjs/common";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";
import { RiskService } from "./risk.service";
import { IntegrationsModule } from "../integrations/integrations.module";
import { InventoryModule } from "../inventory/inventory.module";

import { PackingScanController } from "./packing-scan.controller";
import { PackingScanService } from "./packing-scan.service";

// Milestone 65: manual orders enter via the integrations upsert.
// Sales & Data S2: InventoryModule supplies the stock-restore
// calls for cancel/return status changes.
// CX8: PackingScanController and PackingScanService for parcel packing verification.
@Module({
  imports: [IntegrationsModule, InventoryModule],
  controllers: [OrdersController, PackingScanController],
  providers: [OrdersService, RiskService, PackingScanService],
  exports: [RiskService, PackingScanService],
})
export class OrdersModule {}

