import { Module } from "@nestjs/common";
import { InboxModule } from "../../inbox/inbox.module";
import { OrgBrainModule } from "../org-brain.module";
import { CampaignsModule } from "../../campaigns/campaigns.module";
import { PublishingModule } from "../../publishing/publishing.module";
import { ActionEngineService } from "./action-engine.service";
import { ActionExecutorsService } from "./action-executors.service";
import { ActionEngineController } from "./action-engine.controller";
import { InboxActionProposerService } from "./inbox-action-proposer.service";
import { CommentActionProposerService } from "./comment-action-proposer.service";
import { AdsActionProposerService } from "./ads-action-proposer.service";
import { CompetitorActionProposerService } from "./competitor-action-proposer.service";
import { CopilotService } from "../copilot.service";
import { CopilotController } from "../copilot.controller";
import { AiActivityService } from "../ai-activity.service";
import { AiActivityController } from "../ai-activity.controller";
import { LlmFactory } from "../llm/llm.factory";

/**
 * SA-B10 (Smart AI Phase 2, W1) — the Action Engine module.
 *
 * Deliberately a LEAF consumer module: it imports InboxModule
 * (for the real InboxService / SocialCommentsService executors
 * call) and OrgBrainModule (the Brain the AI callers of B11/B12
 * will compose proposals from), and nothing imports it back —
 * it is registered only in AppModule, so no module cycle is
 * possible (InboxModule never imports AiModule or this module).
 * AiModule keeps its Milestone-47 ProposalsService untouched;
 * the engine extends the same AIActionProposal rails from here.
 *
 * SA-B11 (W2): InboxActionProposerService subscribes to the
 * inbox's event-bus announcements (EventsModule is global) —
 * the triggers reach the engine without InboxService ever
 * depending on it, so the no-cycle discipline above holds.
 * SA-B12 (W3): CommentActionProposerService joins it on the
 * same bus for the comment triggers (repeat spam author,
 * complaint DM follow-through) — SocialCommentsService only
 * ever emits, never imports this module.
 *
 * SA-B15 (A2): CampaignsModule + PublishingModule join the
 * imports — the ads executors ride the hub's own lifecycle
 * services (CampaignsService.setMetaStatus and friends,
 * PublishingService's cross-platform lifecycle). Neither module
 * imports this one (CampaignsModule imports PublishingModule,
 * AudiencesModule, StorageModule only), so the leaf discipline
 * holds: still registered only in AppModule, no cycle possible.
 * AdsActionProposerService joins the providers on the same bus
 * (AdsIntelligenceService announces computed digests from
 * OrgBrainModule; it never imports this module either).
 *
 * SA-B18 (C2): CompetitorActionProposerService joins on the
 * same bus — the one adopted competitor→engine bridge
 * (launch burst + an own Meta-confirmed paused campaign →
 * propose resume_campaign; CompetitorIntelligenceService
 * announces from OrgBrainModule and reaches this module only
 * through its export, never an import back).
 */
/**
 * SA-B21 (G3): CopilotService + CopilotController join HERE,
 * not in OrgBrainModule: the copilot stands on the Brain's
 * digest services (OrgBrainModule exports) AND the engine, and
 * this module is the one leaf that already imports both —
 * placing it in OrgBrainModule would force a cycle. LlmFactory
 * is provided directly, the MessagingModule/InboxModule
 * precedent for consuming modules.
 *
 * SA-B25 (T4): AiActivityController + AiActivityService join
 * HERE for the same leaf reason — the activity feed reads the
 * engine's proposals alongside learned items, stored answers,
 * AI content drafts and usage rows, and this module is
 * registered only in AppModule, so no cycle is possible.
 */
@Module({
  imports: [InboxModule, OrgBrainModule, CampaignsModule, PublishingModule],
  controllers: [ActionEngineController, CopilotController, AiActivityController],
  providers: [ActionEngineService, ActionExecutorsService, InboxActionProposerService, CommentActionProposerService, AdsActionProposerService, CompetitorActionProposerService, CopilotService, AiActivityService, LlmFactory],
  exports: [ActionEngineService, ActionExecutorsService, InboxActionProposerService, CommentActionProposerService, AdsActionProposerService, CompetitorActionProposerService],
})
export class ActionEngineModule {}
