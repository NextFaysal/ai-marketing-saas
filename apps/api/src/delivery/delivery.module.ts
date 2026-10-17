import { Module } from "@nestjs/common";
import { DeliveryController } from "./delivery.controller";
import { DeliveryService } from "./delivery.service";
import { RiderGpsService } from "./rider-gps.service";
import { PublicRiderGpsController } from "./rider-gps.controller";
import { OrdersModule } from "../orders/orders.module";
import { AuditModule } from "../audit/audit.module";

/**
 * EC22 — Delivery Ops. Deliberately NOT registered in
 * app.module.ts by this package (the integration step wires it);
 * OrdersModule exports OrdersService, whose updateOrder is the
 * delivered-transition path.
 * NF9 (FB4): RiderGpsService + the public rider share
 * controller join this module (DeliveryModule IS registered in
 * app.module.ts since EC22's integration).
 */
@Module({
  imports: [OrdersModule, AuditModule],
  controllers: [DeliveryController, PublicRiderGpsController],
  providers: [DeliveryService, RiderGpsService],
  exports: [DeliveryService, RiderGpsService],
})
export class DeliveryModule {}
