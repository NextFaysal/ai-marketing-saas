import { Module } from "@nestjs/common";
import { CourierController, PublicTrackingController } from "./courier.controller";
import { CourierService } from "./courier.service";
import { CourierRulesService } from "./courier-rules.service";
import { CourierNdrService } from "./courier-ndr.service";
import { CourierReconciliationService } from "./courier-reconciliation.service";
import { CourierOptimizerService } from "./courier-optimizer.service";
import { InboxModule } from "../inbox/inbox.module";
import { InventoryModule } from "../inventory/inventory.module";
import { MessagingModule } from "../messaging/messaging.module";
import { OrderNotificationsModule } from "../order-notifications/order-notifications.module";

@Module({
  imports: [InboxModule, InventoryModule, MessagingModule, OrderNotificationsModule],
  controllers: [CourierController, PublicTrackingController],
  providers: [CourierService, CourierRulesService, CourierNdrService, CourierReconciliationService, CourierOptimizerService],
  exports: [CourierService, CourierRulesService, CourierNdrService, CourierReconciliationService, CourierOptimizerService],
})
export class CourierModule {}

