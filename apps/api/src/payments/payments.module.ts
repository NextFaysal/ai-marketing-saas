import { Module } from "@nestjs/common";
import { PaymentsController, PaymentsPublicController } from "./payments.controller";
import { PaymentsService } from "./payments.service";

@Module({
  controllers: [PaymentsController, PaymentsPublicController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
