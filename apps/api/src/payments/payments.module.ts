import { Module } from "@nestjs/common";
import { BkashPublicController, PaymentsController, PaymentsPublicController, StripePublicController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { MessagingModule } from "../messaging/messaging.module";

@Module({
  imports: [MessagingModule],
  controllers: [PaymentsController, PaymentsPublicController, BkashPublicController, StripePublicController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
