import { Module } from "@nestjs/common";
import { WorkflowsController } from "./workflows.controller";
import { WorkflowsService } from "./workflows.service";
import { MessagingModule } from "../messaging/messaging.module";
import { InboxModule } from "../inbox/inbox.module";
import { AiModule } from "../ai/ai.module";
import { CommerceModule } from "../commerce/commerce.module";

@Module({
  // AX18: CommerceModule supplies AbandonedCheckoutsService
  // for the issue_recovery_coupon step. CommerceModule does
  // not import WorkflowsModule (directly or transitively), so
  // this import introduces no cycle.
  imports: [MessagingModule, InboxModule, AiModule, CommerceModule],
  controllers: [WorkflowsController],
  providers: [WorkflowsService],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}

