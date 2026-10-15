import { Module } from "@nestjs/common";
import { OrderNotificationsController } from "./order-notifications.controller";
import { OrderNotificationService } from "./order-notifications.service";
import { AuditModule } from "../audit/audit.module";
import { StorefrontModule } from "../storefront/storefront.module";
import { MessagingModule } from "../messaging/messaging.module";
import { InboxModule } from "../inbox/inbox.module";

/**
 * ON5 — Transactional Notification Engine.
 * Imports: StorefrontModule (ShopAccountService.sendShopSms),
 * MessagingModule (EmailProvider), InboxModule (InboxService.
 * sendAutomatedMessage — the only WhatsApp-capable single-send
 * path). AuditModule is @Global but listed for clarity.
 * Cycle check: none of Storefront/Messaging/Inbox import this
 * module; Courier/Fulfillment import THIS module (one-way).
 * OrdersModule does NOT import it — OrdersService hooks are
 * event subscriptions only.
 */
@Module({
  imports: [AuditModule, StorefrontModule, MessagingModule, InboxModule],
  controllers: [OrderNotificationsController],
  providers: [OrderNotificationService],
  exports: [OrderNotificationService],
})
export class OrderNotificationsModule {}
