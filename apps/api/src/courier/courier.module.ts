import { Module } from "@nestjs/common";
import { CourierController, PublicTrackingController } from "./courier.controller";
import { CourierService } from "./courier.service";
import { CourierNdrService } from "./courier-ndr.service";
import { CourierReconciliationService } from "./courier-reconciliation.service";
import { CourierRulesService } from "./courier-rules.service";
import { InboxModule } from "../inbox/inbox.module";
import { InventoryModule } from "../inventory/inventory.module";
import { MessagingModule } from "../messaging/messaging.module";

@Module({
  imports: [InboxModule, InventoryModule, MessagingModule],
  controllers: [CourierController, PublicTrackingController],
  providers: [CourierService, CourierNdrService, CourierReconciliationService, CourierRulesService],
  exports: [CourierService, CourierNdrService, CourierReconciliationService, CourierRulesService],
})
export class CourierModule {}
