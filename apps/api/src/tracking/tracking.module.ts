import { Module } from "@nestjs/common";
import { TrackingController } from "./tracking.controller";
import { TrackingService } from "./tracking.service";
import { AbandonedCartsController } from "./abandoned-carts.controller";
import { AbandonedCartsService } from "./abandoned-carts.service";
import { AttributionModule } from "../attribution/attribution.module";
import { MessagingModule } from "../messaging/messaging.module";
@Module({
  imports: [AttributionModule, MessagingModule],
  controllers: [TrackingController, AbandonedCartsController],
  providers: [TrackingService, AbandonedCartsService],
  exports: [AbandonedCartsService],
})
export class TrackingModule {}
