import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AuditModule } from "../audit/audit.module";
import { OrdersModule } from "../orders/orders.module";
import { VoiceService } from "./voice.service";
import {
  VoiceTenantController,
  VoiceWebhookController,
} from "./voice.controller";

@Module({
  imports: [PrismaModule, AuditModule, OrdersModule],
  controllers: [VoiceTenantController, VoiceWebhookController],
  providers: [VoiceService],
  exports: [VoiceService],
})
export class VoiceModule {}
