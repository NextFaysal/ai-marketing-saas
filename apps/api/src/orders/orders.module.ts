import { Module } from "@nestjs/common";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";
import { RiskService } from "./risk.service";
import { IntegrationsModule } from "../integrations/integrations.module";

// Milestone 65: manual orders enter via the integrations upsert.
@Module({ imports: [IntegrationsModule], controllers: [OrdersController], providers: [OrdersService, RiskService], exports: [RiskService] })
export class OrdersModule {}
