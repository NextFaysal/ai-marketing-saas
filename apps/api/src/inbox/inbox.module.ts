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
import { SocialCommentsController } from "./social-comments.controller";
import { SocialCommentsService } from "./social-comments.service";
import { AiInstructionsController } from "./ai-instructions.controller";
import { AiInstructionsService } from "./ai-instructions.service";
import { PracticeController } from "./practice.controller";
import { PracticeService } from "./practice.service";
import { OrdersModule } from "../orders/orders.module";
import { CrmModule } from "../crm/crm.module";
import { InventoryModule } from "../inventory/inventory.module";
import { MessagingModule } from "../messaging/messaging.module";

import { PracticeModeController } from "./practice-mode.controller";
import { PracticeModeService } from "./practice-mode.service";
import { CustomersModule } from "../customers/customers.module";
import { FraudModule } from "../fraud/fraud.module";
import { OrgBrainModule } from "../ai/org-brain.module";

@Module({
  // CRM C5: CrmModule provides LeadAssignmentService for the
  // leads the inbox ingestion paths create (CrmModule imports
  // nothing itself, so this adds no module cycle).
  // MS2: MessagingModule provides MessagingService for the
  // WhatsApp STOP/START preference hook (no cycle).
  // IN2: CustomersModule provides CustomersService (the canonical
  // customer merge/unmerge) for the inbox merge endpoints. It
  // imports Orders + Crm only — no cycle back into Inbox.
  // SA-B1 (P1): OrgBrainModule provides OrgBrainService for the
  // inbox fact pack. It imports nothing but the global Prisma
  // module, so this adds no cycle.
  imports: [OrdersModule, CrmModule, InventoryModule, MessagingModule, CustomersModule, FraudModule, OrgBrainModule],
  controllers: [InboxController, MetaWebhookController, WebchatAdminController, PublicChatController, TelegramWebhookController, SocialCommentsController, AiInstructionsController, PracticeController, PracticeModeController],
  providers: [InboxService, WebchatService, RealtimeService, LlmFactory, TelegramService, EmailChannelService, SocialCommentsService, AiInstructionsService, PracticeService, PracticeModeService],
  exports: [InboxService, RealtimeService, TelegramService, EmailChannelService, SocialCommentsService, PracticeModeService],
})
export class InboxModule {}

