import { Module } from "@nestjs/common";
import { PurchasingController } from "./purchasing.controller";
import { PurchasingService } from "./purchasing.service";
import { InventoryIntelligenceService } from "./inventory-intelligence.service";
import { InventoryModule } from "../inventory/inventory.module";
import { AuditModule } from "../audit/audit.module";

/** EC20 — Purchasing & Suppliers. Receiving writes stock ONLY
 * through InventoryService (imported here), never directly.
 * EC33 — InventoryIntelligenceService lives in this same module:
 * it reuses InventoryService (threshold) and AuditService through
 * the imports already wired here.
 * Registration in app.module is done by the coordinator. */
@Module({
  imports: [InventoryModule, AuditModule],
  controllers: [PurchasingController],
  providers: [PurchasingService, InventoryIntelligenceService],
  exports: [PurchasingService, InventoryIntelligenceService],
})
export class PurchasingModule {}
