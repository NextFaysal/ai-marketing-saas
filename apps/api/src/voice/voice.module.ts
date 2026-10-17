import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AuditModule } from "../audit/audit.module";
import { OrdersModule } from "../orders/orders.module";
import { OrgBrainModule } from "../ai/org-brain.module";
import { VoiceService } from "./voice.service";
import { VoiceConversationService } from "./voice-conversation.service";
import {
  VoiceTenantController,
  VoiceWebhookController,
} from "./voice.controller";

@Module({
  // NF3: OrgBrainModule is a leaf (imports only PrismaModule),
  // so importing it here keeps the graph acyclic.
  imports: [PrismaModule, AuditModule, OrdersModule, OrgBrainModule],
  controllers: [VoiceTenantController, VoiceWebhookController],
  providers: [VoiceService, VoiceConversationService],
  exports: [VoiceService, VoiceConversationService],
})
export class VoiceModule {}
