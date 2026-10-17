import { Module } from "@nestjs/common";
import { DropshipController } from "./dropship.controller";
import { PublicSupplierPortalController } from "./supplier-portal.controller";
import { DropshipService } from "./dropship.service";
import { SupplierPortalService } from "./supplier-portal.service";
import { AuditModule } from "../audit/audit.module";
import { OrdersModule } from "../orders/orders.module";

/**
 * NF12 (FB4) — Supplier portal + Dropship network.
 * OrdersModule supplies OrdersService (the canonical
 * createManual / updateOrder paths the fulfilment flow rides);
 * OrdersModule never imports this module, so the graph stays
 * acyclic. AuditModule supplies the tenant audit log.
 */
@Module({
  imports: [AuditModule, OrdersModule],
  controllers: [DropshipController, PublicSupplierPortalController],
  providers: [DropshipService, SupplierPortalService],
  exports: [DropshipService, SupplierPortalService],
})
export class DropshipModule {}
