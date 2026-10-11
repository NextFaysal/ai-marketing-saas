import { Module } from "@nestjs/common";
import { WorkflowsController } from "./workflows.controller";
import { WorkflowsService } from "./workflows.service";
import { MessagingModule } from "../messaging/messaging.module";
import { InboxModule } from "../inbox/inbox.module";
import { AiModule } from "../ai/ai.module";

@Module({
  imports: [MessagingModule, InboxModule, AiModule],
  controllers: [WorkflowsController],
  providers: [WorkflowsService],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}

