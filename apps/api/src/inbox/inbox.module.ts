import { Module } from "@nestjs/common";
import { InboxController } from "./inbox.controller";
import { MetaWebhookController } from "./meta-webhook.controller";
import { WebchatAdminController, PublicChatController } from "./webchat.controller";
import { InboxService } from "./inbox.service";
import { WebchatService } from "./webchat.service";
import { RealtimeService } from "./realtime.service";
import { LlmFactory } from "../ai/llm/llm.factory";
import { TelegramService } from "./channels/telegram.service";
import { EmailChannelService } from "./channels/email.service";
import { TelegramWebhookController } from "./channels/telegram-webhook.controller";
import { OrdersModule } from "../orders/orders.module";
import { CrmModule } from "../crm/crm.module";

@Module({
  // CRM C5: CrmModule provides LeadAssignmentService for the
  // leads the inbox ingestion paths create (CrmModule imports
  // nothing itself, so this adds no module cycle).
  imports: [OrdersModule, CrmModule],
  controllers: [InboxController, MetaWebhookController, WebchatAdminController, PublicChatController, TelegramWebhookController],
  providers: [InboxService, WebchatService, RealtimeService, LlmFactory, TelegramService, EmailChannelService],
  exports: [InboxService, RealtimeService, TelegramService, EmailChannelService],
})
export class InboxModule {}
