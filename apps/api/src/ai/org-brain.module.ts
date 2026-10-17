import { Module } from "@nestjs/common";
import { OrgBrainService } from "./org-brain.service";
import { EmbeddingsService } from "./embeddings.service";
import { PgVectorStore } from "./pgvector-store";
import { KnowledgeIndexingService } from "./knowledge-indexing.service";
import { AnswerStoreService } from "./answer-store.service";
import { LearningService } from "./learning.service";
import { LearningController, BrandVoiceController } from "./learning.controller";
import { WebsiteLearningService } from "./website-learning.service";
import { ConversationMiningService } from "./conversation-mining.service";
import { PerformanceLearningService } from "./performance-learning.service";
import { VoiceLearningService } from "./voice-learning.service";
import { CustomerMemoryService } from "./customer-memory.service";
import { BrainAdminService } from "./brain-admin.service";
import { BrainAdminController } from "./brain-admin.controller";
import { AdsIntelligenceService } from "./ads-intelligence.service";
import { AdsIntelligenceController } from "./ads-intelligence.controller";
import { CreativeLearningService } from "./creative-learning.service";
import { CreativeIntelligenceController } from "./creative-intelligence.controller";
import { CompetitorIntelligenceService } from "./competitor-intelligence.service";
import { CompetitorResponseService } from "./competitor-response.service";
import { CompetitorIntelligenceController } from "./competitor-intelligence.controller";
import { VECTOR_STORE } from "./vector-store";

/**
 * SA-B1 (P1): OrgBrainService lives in its own small module on
 * purpose. Both AiModule (tools) and InboxModule (fact pack) need
 * it, and neither may import the other; this module imports
 * nothing beyond the global PrismaModule, so wiring it into both
 * creates no module cycle.
 *
 * SA-B2 (P2): the module also carries the hybrid-retrieval stack
 * — EmbeddingsService, the VectorStore port bound to its
 * pgvector implementation, and the KnowledgeIndexingService —
 * so every consumer (AiModule, InboxModule, KnowledgeModule,
 * ProductsModule, AutomationModule) wires the Brain the same
 * one way, and the port can be re-bound to Qdrant later without
 * any consumer changing (plan §3).
 *
 * SA-B3 (P4): AnswerStoreService joins the same module — it is
 * part of the Brain (its rows are the org's verified answers),
 * it shares EmbeddingsService, and InboxModule already imports
 * this module, so the inbox gets the store with no new wiring.
 *
 * SA-B4 (P5/P6): LearningService + LearningController join —
 * mined knowledge waits in LearnedItem rows until a human
 * approves it (D3), and this module is where the Brain's
 * approval surface belongs; AutomationModule imports this
 * module for the learning sweeps.
 *
 * SA-B5 (P7/P8): PerformanceLearningService (deterministic
 * snapshots + findings), VoiceLearningService +
 * BrandVoiceController (suggested voice profile, human
 * activation) and CustomerMemoryService (per-customer commerce
 * facts) join the same module — all three are Brain data, and
 * AutomationModule reaches the new sweeps through it.
 *
 * SA-B6 (P9): BrainAdminService + BrainAdminController join —
 * the Learn Dashboard's read/management surface (overview,
 * Answer Store management, customer-memory forget) over the
 * same Brain data.
 *
 * SA-B14 (A1): AdsIntelligenceService + AdsIntelligenceController
 * join — the deterministic ads digest is Brain data (INTERNAL
 * class): OrgBrainService reads it for internal contexts,
 * AutomationModule reaches its findings sweep through this
 * module, and the tenant API serves dashboard/copilot
 * consumers.
 *
 * SA-B16 (A3): CreativeLearningService +
 * CreativeIntelligenceController join — deterministic creative
 * pattern mining over hub-built ad creatives (INTERNAL class):
 * patterns are SUGGESTED LearnedItems until approved, approved
 * patterns surface in internal Brain contexts, AutomationModule
 * reaches the mining sweep through this module, and the tenant
 * API serves the pattern report + exemplars Phase 5 consumes.
 *
 * SA-B17 (C1): CompetitorIntelligenceService +
 * CompetitorIntelligenceController join — the deterministic
 * competitor digest over rows the org already collects (Ad
 * Library sync + price scanner; INTERNAL class, strictly
 * per-org): findings are SUGGESTED LearnedItems until
 * approved, the digest + approved competitor facts surface in
 * internal Brain contexts, AutomationModule reaches the
 * findings sweep through this module, and the tenant API
 * serves the structured digest.
 *
 * SA-B18 (C2): CompetitorResponseService joins — the
 * review-queue half of Competitor → Action: it subscribes to
 * the digest announcement on the findings path and files a
 * RESPONSE suggestion per C1 finding (talking point /
 * counter-content idea / opportunity note; kind "fact",
 * sourceType "competitor", approval forces INTERNAL). The
 * one engine bridge lives in ActionEngineModule
 * (CompetitorActionProposerService) on the same event.
 */
@Module({
  controllers: [LearningController, BrandVoiceController, BrainAdminController, AdsIntelligenceController, CreativeIntelligenceController, CompetitorIntelligenceController],
  providers: [
    OrgBrainService,
    EmbeddingsService,
    PgVectorStore,
    { provide: VECTOR_STORE, useExisting: PgVectorStore },
    KnowledgeIndexingService,
    AnswerStoreService,
    LearningService,
    WebsiteLearningService,
    ConversationMiningService,
    PerformanceLearningService,
    VoiceLearningService,
    CustomerMemoryService,
    BrainAdminService,
    AdsIntelligenceService,
    CreativeLearningService,
    CompetitorIntelligenceService,
    CompetitorResponseService,
  ],
  exports: [OrgBrainService, EmbeddingsService, PgVectorStore, VECTOR_STORE, KnowledgeIndexingService, AnswerStoreService, LearningService, WebsiteLearningService, ConversationMiningService, PerformanceLearningService, VoiceLearningService, CustomerMemoryService, BrainAdminService, AdsIntelligenceService, CreativeLearningService, CompetitorIntelligenceService, CompetitorResponseService],
})
export class OrgBrainModule {}
