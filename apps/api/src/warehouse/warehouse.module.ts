import { Module } from "@nestjs/common";
import { WarehouseController } from "./warehouse.controller";
import { WarehouseService } from "./warehouse.service";
import { StockTransfersService } from "./stock-transfers.service";
import { AuditModule } from "../audit/audit.module";
import { InventoryModule } from "../inventory/inventory.module";

/**
 * EC21 — Warehouse & Stock Ops. Imports InventoryModule because
 * stock-count closing applies counted deltas ONLY through
 * InventoryService.adjust (the one stock writer). Registration
 * in app.module.ts is a separate step (not done here).
 *
 * AB3 (AX4): StockTransfersService joins — it writes stock ONLY
 * through InventoryService.applyBinOnlyDelta (single-writer
 * discipline), and the controller's re-allocation endpoint
 * delegates to InventoryService.reallocateOrderBins.
 */
@Module({
  imports: [InventoryModule, AuditModule],
  controllers: [WarehouseController],
  providers: [WarehouseService, StockTransfersService],
  exports: [WarehouseService, StockTransfersService],
})
export class WarehouseModule {}
