import { Module } from "@nestjs/common";
import { MessagingController } from "./messaging.controller";
import { MessagingService } from "./messaging.service";
import { EmailProvider } from "./email.provider";
import { SmsProvider } from "./sms.provider";

@Module({
  controllers: [MessagingController],
  providers: [MessagingService, EmailProvider, SmsProvider],
  exports: [MessagingService, EmailProvider, SmsProvider],
})
export class MessagingModule {}
