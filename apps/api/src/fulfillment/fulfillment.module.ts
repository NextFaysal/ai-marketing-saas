import { Module } from "@nestjs/common";
import { FulfillmentController, PublicReturnsController } from "./fulfillment.controller";
import { FulfillmentService } from "./fulfillment.service";
import { ReturnsService } from "./returns.service";
import { AuditModule } from "../audit/audit.module";
import { CommerceModule } from "../commerce/commerce.module";
import { CourierModule } from "../courier/courier.module";
import { InventoryModule } from "../inventory/inventory.module";
import { OrdersModule } from "../orders/orders.module";
import { InboxModule } from "../inbox/inbox.module";
import { MessagingModule } from "../messaging/messaging.module";
import { OrdersBulkController } from "./orders-bulk.controller";
import { OrdersBulkService } from "./orders-bulk.service";
import { FulfillmentExcellenceController } from "./fulfillment-excellence.controller";
import { FulfillmentExcellenceService } from "./fulfillment-excellence.service";
import { OrderNotificationsModule } from "../order-notifications/order-notifications.module";

/**
 * EC9 — Fulfillment + Returns. All imports are one-directional:
 * Courier/Orders/Inbox modules do not import this one, so the
 * return flow can reuse booking (CourierService), the S1 ledger
 * (InventoryService), manual orders + the S2 refund path
 * (OrdersService), EC5 pushes (CommerceModule's OrderPushService)
 * and customer messaging (InboxService / EmailProvider) without a
 * cycle.
 */
@Module({
  imports: [AuditModule, CommerceModule, CourierModule, InventoryModule, OrdersModule, InboxModule, MessagingModule, OrderNotificationsModule],
  controllers: [FulfillmentController, PublicReturnsController, OrdersBulkController, FulfillmentExcellenceController],
  providers: [FulfillmentService, ReturnsService, OrdersBulkService, FulfillmentExcellenceService],
  exports: [FulfillmentService, ReturnsService, OrdersBulkService, FulfillmentExcellenceService],
})
export class FulfillmentModule {}
