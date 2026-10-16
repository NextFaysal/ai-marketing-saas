import { Module } from "@nestjs/common";
import { PosController } from "./pos.controller";
import { PosService } from "./pos.service";
import { PosOfflineService } from "./pos-offline.service";
import { AuditModule } from "../audit/audit.module";
import { FraudModule } from "../fraud/fraud.module";
import { IntegrationsModule } from "../integrations/integrations.module";
import { OrdersModule } from "../orders/orders.module";
import { CommerceModule } from "../commerce/commerce.module";

/**
 * EC34 — POS quick-sale. Placement rides IntegrationsModule
 * (upsertOrder: dedupe + customer + S1 stock hooks), completion
 * rides OrdersModule (updateOrder transition + EC19-shaped
 * getOne), pricing rides CommerceModule (the ONE
 * PromotionsService.evaluateCheckout + DiscountsService.redeem).
 * OrdersModule itself imports Integrations + Commerce — none of
 * them imports this module, so the graph stays acyclic.
 */
@Module({
  imports: [IntegrationsModule, OrdersModule, CommerceModule, AuditModule, FraudModule],
  controllers: [PosController],
  providers: [PosService, PosOfflineService],
  exports: [PosService, PosOfflineService],
})
export class PosModule {}
