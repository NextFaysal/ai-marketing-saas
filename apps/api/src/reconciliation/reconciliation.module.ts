import { Module } from "@nestjs/common";
import { ReconciliationController } from "./reconciliation.controller";
import { ReconciliationService } from "./reconciliation.service";
import { AuditModule } from "../audit/audit.module";

/** EC26 — Courier COD Reconciliation: settlement-sheet imports
 * stamp CourierShipment.codCollected* (the only collection truth);
 * the accounting "courier-collections" export reads those stamps. */
@Module({
  imports: [AuditModule],
  controllers: [ReconciliationController],
  providers: [ReconciliationService],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
