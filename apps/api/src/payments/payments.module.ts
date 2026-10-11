import { Module } from "@nestjs/common";
import { BkashPublicController, PaymentsController, PaymentsPublicController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { MessagingModule } from "../messaging/messaging.module";

@Module({
  imports: [MessagingModule],
  controllers: [PaymentsController, PaymentsPublicController, BkashPublicController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
