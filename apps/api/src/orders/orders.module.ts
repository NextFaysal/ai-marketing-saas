import { Module } from "@nestjs/common";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";
import { RiskService } from "./risk.service";
import { IntegrationsModule } from "../integrations/integrations.module";
import { InventoryModule } from "../inventory/inventory.module";

// Milestone 65: manual orders enter via the integrations upsert.
// Sales & Data S2: InventoryModule supplies the stock-restore
// calls for cancel/return status changes.
@Module({ imports: [IntegrationsModule, InventoryModule], controllers: [OrdersController], providers: [OrdersService, RiskService], exports: [RiskService] })
export class OrdersModule {}
