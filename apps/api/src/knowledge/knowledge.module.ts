import { Module } from "@nestjs/common";
import { KnowledgeController } from "./knowledge.controller";
import { KnowledgeService } from "./knowledge.service";
import { OrgBrainModule } from "../ai/org-brain.module";

/**
 * SA-B2 (P2): imports OrgBrainModule so KnowledgeService's
 * optional KnowledgeIndexingService resolves in the running app
 * (document mutations refresh the embedding index). Specs keep
 * constructing the service directly and get its lazy fallback.
 */
@Module({
  imports: [OrgBrainModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
})
export class KnowledgeModule {}
