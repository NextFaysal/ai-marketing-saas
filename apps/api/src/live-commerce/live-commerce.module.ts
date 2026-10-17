import { Module } from "@nestjs/common";
import { LiveCommerceController } from "./live-commerce.controller";
import { LiveCommerceService } from "./live-commerce.service";
import { LIVE_COMMENTS_PROVIDER, MetaLiveCommentsProvider } from "./live-comments.provider";
import { AuditModule } from "../audit/audit.module";
import { OrdersModule } from "../orders/orders.module";
import { MessagingModule } from "../messaging/messaging.module";
import { SocialModule } from "../social/social.module";

/**
 * NF1 (FB1) — Live Commerce. Dependencies ride EXISTING modules
 * only: OrdersModule (OrdersService.createManual — the one
 * order-creation door), MessagingModule (MessagingService
 * .createSavedAudience for the follow-up segment), SocialModule
 * (SocialPublishService.resolveAccountToken — the one sealed
 * Page-token path, consumed by MetaLiveCommentsProvider).
 * None of those modules imports this one, so the graph stays
 * acyclic (OrdersModule → MessagingModule already exists;
 * MessagingModule imports nothing here).
 */
@Module({
  imports: [AuditModule, OrdersModule, MessagingModule, SocialModule],
  controllers: [LiveCommerceController],
  providers: [
    LiveCommerceService,
    MetaLiveCommentsProvider,
    { provide: LIVE_COMMENTS_PROVIDER, useExisting: MetaLiveCommentsProvider },
  ],
  exports: [LiveCommerceService],
})
export class LiveCommerceModule {}
