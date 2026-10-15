import { Module } from "@nestjs/common";
import { WarehouseController } from "./warehouse.controller";
import { WarehouseService } from "./warehouse.service";
import { AuditModule } from "../audit/audit.module";
import { InventoryModule } from "../inventory/inventory.module";

/**
 * EC21 — Warehouse & Stock Ops. Imports InventoryModule because
 * stock-count closing applies counted deltas ONLY through
 * InventoryService.adjust (the one stock writer). Registration
 * in app.module.ts is a separate step (not done here).
 */
@Module({
  imports: [InventoryModule, AuditModule],
  controllers: [WarehouseController],
  providers: [WarehouseService],
  exports: [WarehouseService],
})
export class WarehouseModule {}
