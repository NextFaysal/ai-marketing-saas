import { Module } from "@nestjs/common";
import { WorkflowsController } from "./workflows.controller";
import { WorkflowsService } from "./workflows.service";
import { MessagingModule } from "../messaging/messaging.module";
import { InboxModule } from "../inbox/inbox.module";

@Module({
  imports: [MessagingModule, InboxModule],
  controllers: [WorkflowsController],
  providers: [WorkflowsService],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}
