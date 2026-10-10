import { Module } from "@nestjs/common";
import { CourierController } from "./courier.controller";
import { CourierService } from "./courier.service";
import { InboxModule } from "../inbox/inbox.module";

@Module({
  imports: [InboxModule],
  controllers: [CourierController],
  providers: [CourierService],
  exports: [CourierService],
})
export class CourierModule {}
