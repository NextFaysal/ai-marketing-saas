import { Module } from "@nestjs/common";
import { InboxController } from "./inbox.controller";
import { MetaWebhookController } from "./meta-webhook.controller";
import { WebchatAdminController, PublicChatController } from "./webchat.controller";
import { InboxService } from "./inbox.service";
import { WebchatService } from "./webchat.service";
import { RealtimeService } from "./realtime.service";
import { LlmFactory } from "../ai/llm/llm.factory";

@Module({
  controllers: [InboxController, MetaWebhookController, WebchatAdminController, PublicChatController],
  providers: [InboxService, WebchatService, RealtimeService, LlmFactory],
  exports: [InboxService, RealtimeService],
})
export class InboxModule {}
