import { Module } from "@nestjs/common";
import { DeliveryController } from "./delivery.controller";
import { DeliveryService } from "./delivery.service";
import { OrdersModule } from "../orders/orders.module";
import { AuditModule } from "../audit/audit.module";

/**
 * EC22 — Delivery Ops. Deliberately NOT registered in
 * app.module.ts by this package (the integration step wires it);
 * OrdersModule exports OrdersService, whose updateOrder is the
 * delivered-transition path.
 */
@Module({
  imports: [OrdersModule, AuditModule],
  controllers: [DeliveryController],
  providers: [DeliveryService],
  exports: [DeliveryService],
})
export class DeliveryModule {}
