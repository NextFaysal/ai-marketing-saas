import { Module } from "@nestjs/common";
import { MessagingController, PublicMessagingController } from "./messaging.controller";
import { MessagingService } from "./messaging.service";
import { EmailProvider } from "./email.provider";
import { SmsProvider } from "./sms.provider";
import { LlmFactory } from "../ai/llm/llm.factory";

@Module({
  controllers: [MessagingController, PublicMessagingController],
  // MS9: MessagingService needs the LLM factory for its AI draft
  // endpoints. AiModule imports THIS module (never the reverse),
  // so the factory class is provided here directly — it is
  // dependency-free and reads the same effective platform
  // config as AiModule's instance.
  providers: [MessagingService, EmailProvider, SmsProvider, LlmFactory],
  exports: [MessagingService, EmailProvider, SmsProvider],
})
export class MessagingModule {}
