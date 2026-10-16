import { Module } from "@nestjs/common";
import { WebhooksOutgoingController } from "./webhooks-outgoing.controller";
import { WebhooksOutgoingService } from "./webhooks-outgoing.service";

/**
 * GC23 — outgoing webhooks. Leaf module: PrismaModule, AuditModule
 * and EventsModule are global, so no imports are needed.
 * AutomationModule imports this module for the
 * `webhook_delivery_sweep` job; nothing here imports
 * AutomationModule back, so the graph stays acyclic.
 */
@Module({
  controllers: [WebhooksOutgoingController],
  providers: [WebhooksOutgoingService],
  exports: [WebhooksOutgoingService],
})
export class WebhooksOutgoingModule {}
