import { Module } from "@nestjs/common";
import { BkashPublicController, PaymentsController, PaymentsPublicController } from "./payments.controller";
import { PaymentsService } from "./payments.service";

@Module({
  controllers: [PaymentsController, PaymentsPublicController, BkashPublicController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
