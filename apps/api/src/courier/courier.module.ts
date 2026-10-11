import { Module } from "@nestjs/common";
import { CourierController } from "./courier.controller";
import { CourierService } from "./courier.service";
import { InboxModule } from "../inbox/inbox.module";
import { InventoryModule } from "../inventory/inventory.module";

@Module({
  imports: [InboxModule, InventoryModule],
  controllers: [CourierController],
  providers: [CourierService],
  exports: [CourierService],
})
export class CourierModule {}
