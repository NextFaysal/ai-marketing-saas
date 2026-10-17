import { Module } from "@nestjs/common";
import { WebpushController } from "./webpush.controller";
import { WebpushPublicController } from "./webpush-public.controller";
import { WebPushService } from "./webpush.service";
import { AuditModule } from "../audit/audit.module";
import { MessagingModule } from "../messaging/messaging.module";

/** AB7 (AX16): web push for shop visitors. Leaf module (global
 * Prisma + Audit only) — AutomationModule imports it for the
 * web_push_sweep job; nothing here imports AutomationModule
 * back, so there is no cycle. The coordinator wires this module
 * into app.module.
 * MX12: MessagingModule is imported so WebPushService can
 * register as MessagingService's push-send port on init.
 * MessagingModule imports no module at all — no cycle. */
@Module({
  imports: [AuditModule, MessagingModule],
  controllers: [WebpushController, WebpushPublicController],
  providers: [WebPushService],
  exports: [WebPushService],
})
export class WebpushModule {}
