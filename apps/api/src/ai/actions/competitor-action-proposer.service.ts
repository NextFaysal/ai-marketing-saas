import { Injectable, OnModuleInit, Optional } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { EventsService } from "../../common/events.service";
import { ActionEngineService } from "./action-engine.service";
import {
  CompetitorIntelligenceService,
  COMPETITOR_LAUNCH_BURST_MIN_NEW_ADS,
  type CompetitorDigest,
} from "../competitor-intelligence.service";

/**
 * SA-B18 (Smart AI Phase 4, C2): the ONE engine bridge the
 * Step-0 mapping analysis adopts — launch burst → consider
 * resuming an own paused campaign.
 *
 * The rule, stated without invented linkage: a rival
 * STARTED something observable this week (a launch burst —
 * `COMPETITOR_LAUNCH_BURST_MIN_NEW_ADS` or more new ads in
 * 7 days, from the C1 digest) AND the org has a campaign
 * paused on Meta (`CampaignPlan.metaStatus === "PAUSED"` —
 * the only locally trustworthy paused state, because
 * SA-B15 established metaStatus is written only from
 * Meta-confirmed reads; a plan whose metaStatus says PAUSED
 * really is dark on Meta) → propose `resume_campaign` for
 * the most recently updated such plan. The proposal names
 * the burst in its sourceRef (competitor id/name, the
 * observed counts), so the human deciding sees exactly why
 * it exists. Cap: ONE proposal per digest event — the
 * loudest burst, the freshest paused plan.
 *
 * Everything the engine already enforces stays in force:
 * the proposal waits at the org's autonomy level (default
 * L1 = a human approves; resume_campaign is medium-risk, so
 * L2 never auto-executes it either), the engine's
 * open-proposal dedupe stops repeat proposals for the same
 * campaign while one is open, and the builder's no-op
 * refusal (the plan is meanwhile ACTIVE again) simply means
 * no proposal — quietly, here.
 *
 * Mappings evaluated and REJECTED in Step 0 (recorded in
 * docs/smart-ai-b18-acceptance.md): price_drop → any engine
 * action (no catalog action answers a rival's price; the
 * org's own price-setting is deliberately not in the
 * catalog — L5); launch_burst/silence → set_campaign_budget
 * (the builder requires a requested amount and any
 * proposer-chosen amount would be invented); launch_burst →
 * pause_campaign (going dark exactly when a rival gets loud
 * is backwards); silence → resume_campaign (nothing
 * happened — there is no observed rival act to answer).
 *
 * Trigger: CompetitorIntelligenceService announces every
 * computed digest on the findings path
 * ("competitor.findings_filed"); this proposer recomputes
 * the digest at handling time (the SA-B15 discipline, so
 * the payload evidence is always the digest's own numbers)
 * and applies the burst predicate over the digest's
 * competitor entries directly — NOT over the findings list,
 * which C1 caps at 3 organisation-wide. Fire-and-forget
 * safe: the whole evaluation is wrapped so a failure can
 * never surface into the findings path.
 */
@Injectable()
export class CompetitorActionProposerService implements OnModuleInit {
  private intelligenceFallback?: CompetitorIntelligenceService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: ActionEngineService,
    private readonly events: EventsService,
    @Optional() private readonly intelligence?: CompetitorIntelligenceService,
  ) {}

  onModuleInit() {
    this.events.on("competitor.findings_filed", (payload) => this.onDigestAnnounced(payload));
  }

  private db(): any {
    return this.prisma as any;
  }

  private intel(): CompetitorIntelligenceService {
    return (
      this.intelligence ??
      (this.intelligenceFallback ??= new CompetitorIntelligenceService(this.prisma as any))
    );
  }

  private async onDigestAnnounced(payload: any): Promise<void> {
    const organizationId = payload?.organizationId;
    if (typeof organizationId !== "string" || !organizationId) return;
    await this.evaluateAndPropose(organizationId).catch(() => undefined);
  }

  async evaluateAndPropose(
    organizationId: string,
    opts: { now?: Date } = {},
  ): Promise<{ bursts: number; pausedPlans: number; proposed: number; reason?: string }> {
    const digest: CompetitorDigest = await this.intel().computeDigest(organizationId, opts);
    if (!digest.hasData) return { bursts: 0, pausedPlans: 0, proposed: 0, reason: "no_competitors_tracked" };

    const burst = (digest.competitors ?? [])
      .filter((c) => c.newAds7d >= COMPETITOR_LAUNCH_BURST_MIN_NEW_ADS)
      .sort((a, b) => b.newAds7d - a.newAds7d)[0];
    if (!burst) return { bursts: 0, pausedPlans: 0, proposed: 0, reason: "no_launch_burst" };

    const plans = await this.db()
      .campaignPlan?.findMany?.({
        where: { organizationId, metaStatus: "PAUSED", externalCampaignId: { not: null } },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: { id: true, externalCampaignId: true, adAccountId: true },
      })
      .catch(() => []);
    const plan = (plans ?? [])[0];
    if (!plan?.externalCampaignId) {
      return { bursts: 1, pausedPlans: 0, proposed: 0, reason: "no_paused_campaign" };
    }

    const created = await this.proposeQuietly(organizationId, plan, burst, digest);
    return { bursts: 1, pausedPlans: 1, proposed: created ? 1 : 0 };
  }

  private async proposeQuietly(
    organizationId: string,
    plan: { id: string; externalCampaignId: string; adAccountId?: string | null },
    burst: { competitorId: string; name: string; newAds7d: number; activeAds: number },
    digest: CompetitorDigest,
  ): Promise<boolean> {
    try {
      const res: any = await this.engine.propose(
        organizationId,
        "resume_campaign",
        {
          platform: "meta",
          campaignExternalId: plan.externalCampaignId,
          ...(plan.adAccountId ? { adAccountId: plan.adAccountId } : {}),
        },
        {
          proposedBy: "ai",
          actorUserId: null,
          sourceRef: {
            source: "competitor_burst",
            rule: "launch_burst",
            competitorId: burst.competitorId,
            competitorName: burst.name,
            newAds7d: burst.newAds7d,
            activeAds: burst.activeAds,
            planId: plan.id,
            periodStart: digest.period.start,
            periodEnd: digest.period.end,
          },
        },
      );
      return !!(res?.ok && !res?.deduped);
    } catch {
      return false;
    }
  }
}
