import { Module } from "@nestjs/common";
import { CourierController, PublicTrackingController } from "./courier.controller";
import { CourierService } from "./courier.service";
import { InboxModule } from "../inbox/inbox.module";
import { InventoryModule } from "../inventory/inventory.module";
import { MessagingModule } from "../messaging/messaging.module";

@Module({
  imports: [InboxModule, InventoryModule, MessagingModule],
  controllers: [CourierController, PublicTrackingController],
  providers: [CourierService],
  exports: [CourierService],
})
export class CourierModule {}
