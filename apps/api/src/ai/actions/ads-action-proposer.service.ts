import { Injectable, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { EventsService } from "../../common/events.service";
import { ActionEngineService } from "./action-engine.service";
import { ADS_ANOMALY_THRESHOLDS, isCampaignLevelRow } from "../ads-intelligence.service";
import { performancePeriod } from "../performance-learning.service";

/**
 * SA-B15 (Smart AI Phase 3, A2) — the deterministic ads
 * proposers. NO LLM anywhere in this file: two named rules over
 * the digest's own data, nothing else proposes anything.
 *
 * Where it runs: AdsIntelligenceService announces every digest
 * it computes on the findings path ("ads.digest_computed" —
 * the ads_intelligence_sweep job and the on-demand suggest
 * endpoint both land there). This service evaluates the
 * announcement's org and files pause_campaign proposals
 * through the Action Engine (proposedBy "ai"); the engine —
 * autonomy, campaign-key dedupe, approval, verification,
 * audit — decides what happens next. Subscription (rather
 * than a call from the digest service) keeps the module
 * direction acyclic, the SA-B11/B12 discipline.
 *
 * The rules (campaign grain): SA-B14's anomaly flags are
 * ORG-TOTALS-level — a totals-level "ROAS collapse" names no
 * campaign, and pausing "the worst" campaign on its strength
 * would be an inference, not a rule. So the proposer applies
 * SA-B14's OWN named thresholds (ADS_ANOMALY_THRESHOLDS) at
 * campaign grain over the SAME rows and windows the digest
 * computes from (the SA-B5 campaign-level row rule,
 * performancePeriod calendar windows, grouped per platform +
 * ad account + campaign):
 *
 *  - zero_conversion_spend: the campaign spent >= ৳1,000 in
 *    the window with 0 platform-reported conversions
 *    → propose pause_campaign for THAT campaign.
 *  - roas_collapse: the campaign's ROAS fell >= 40% vs its
 *    own prior window, from a prior ROAS >= 1.0, with both
 *    windows spending >= ৳1,000 → propose pause_campaign.
 *  - spend_spike ALONE proposes NOTHING: a spend rise with
 *    conversions intact may be legitimate growth. There is
 *    deliberately no rule for it (and none for ctr_drop —
 *    creative fatigue is SA-B16's surface, not a pause).
 *
 * Autonomy: the default is L1 — a proposed pause WAITS for a
 * human. pause_campaign is medium risk, so even an org at L2
 * never auto-executes it (the engine's L2 gate is low-risk
 * only; spec'd in sa-b15-ads-actions.spec.ts). At most
 * MAX_PAUSE_PROPOSALS_PER_DIGEST proposals are filed per
 * digest (zero-conversion burners first, then collapses,
 * largest spend first) so a bad week cannot flood the queue.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PAUSE_PROPOSALS_PER_DIGEST = 5;

const bi = (v: any): bigint => {
  try {
    return BigInt(v ?? 0);
  } catch {
    return 0n;
  }
};
const round2 = (n: number): number => Math.round(n * 100) / 100;
const pctChange = (current: number, prior: number): number | null =>
  prior === 0 ? null : Math.round(((current - prior) / prior) * 10000) / 100;

interface CampaignAgg {
  key: string;
  platform: string;
  adAccountId: string;
  campaignExternalId: string;
  spend: bigint;
  conversions: number;
  value: bigint;
}

export interface AdsPauseCandidate {
  rule: "zero_conversion_spend" | "roas_collapse";
  platform: string;
  adAccountId: string;
  campaignExternalId: string;
  spendMinor: string;
  evidence: Record<string, string | number | null>;
}

@Injectable()
export class AdsActionProposerService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: ActionEngineService,
    private readonly events: EventsService,
  ) {}

  onModuleInit() {
    this.events.on("ads.digest_computed", (payload) => this.onDigestComputed(payload));
  }

  private async onDigestComputed(payload: any): Promise<void> {
    const organizationId = payload?.organizationId;
    if (typeof organizationId !== "string" || !organizationId) return;
    const days = payload?.windowDays === 30 ? 30 : 7;
    // Fire-and-forget safe: the bus already isolates handler
    // failures; this catch is the second wall (the B11
    // discipline) so a proposer failure can never surface
    // into the digest path.
    await this.evaluateAndPropose(organizationId, { days }).catch(() => undefined);
  }

  /** The campaign-grain rules over the digest's own rows —
   *  exposed for specs and sweep observability. Pure reads +
   *  engine proposals; org-scoped throughout, so one org's
   *  evaluation can never touch another org's campaigns. */
  async evaluateCampaigns(
    organizationId: string,
    opts: { days?: number; now?: Date } = {},
  ): Promise<AdsPauseCandidate[]> {
    const days = opts.days === 30 ? 30 : 7;
    const now = opts.now ?? new Date();
    const cur = performancePeriod(days, now);
    const priorStart = new Date(cur.start.getTime() - days * DAY_MS);
    const rows = await (this.prisma as any).dailyAdMetric
      .findMany({ where: { organizationId, date: { gte: priorStart, lt: cur.end } } })
      .catch(() => []);
    const campaignRows = (rows ?? []).filter(isCampaignLevelRow);

    const curMap = new Map<string, CampaignAgg>();
    const priorMap = new Map<string, CampaignAgg>();
    for (const r of campaignRows) {
      const key = `${String(r.platform ?? "unknown")}::${String(r.adAccountId ?? "")}::${String(r.campaignExternalId)}`;
      const inCur = new Date(r.date).getTime() >= cur.start.getTime();
      const map = inCur ? curMap : priorMap;
      let a = map.get(key);
      if (!a) {
        a = {
          key,
          platform: String(r.platform ?? "unknown"),
          adAccountId: String(r.adAccountId ?? ""),
          campaignExternalId: String(r.campaignExternalId),
          spend: 0n,
          conversions: 0,
          value: 0n,
        };
        map.set(key, a);
      }
      a.spend += bi(r.spendMinor);
      a.conversions += Number(r.platformConversions ?? 0);
      a.value += bi(r.platformConversionValueMinor);
    }

    const T = ADS_ANOMALY_THRESHOLDS;
    const out: AdsPauseCandidate[] = [];
    for (const c of curMap.values()) {
      // Rule 1 — zero-conversion spend (campaign grain).
      if (c.conversions === 0 && c.spend >= BigInt(T.zeroConversionMinSpendMinor)) {
        out.push({
          rule: "zero_conversion_spend",
          platform: c.platform,
          adAccountId: c.adAccountId,
          campaignExternalId: c.campaignExternalId,
          spendMinor: c.spend.toString(),
          evidence: { spendMinor: c.spend.toString(), conversions: 0, windowDays: days },
        });
        continue;
      }
      // Rule 2 — ROAS collapse vs the campaign's OWN prior window.
      const p = priorMap.get(c.key);
      if (!p) continue;
      const curRoas = c.spend > 0n ? round2(Number(c.value) / Number(c.spend)) : null;
      const priorRoas = p.spend > 0n ? round2(Number(p.value) / Number(p.spend)) : null;
      if (
        curRoas !== null &&
        priorRoas !== null &&
        priorRoas >= T.roasCollapseMinPriorRoas &&
        c.spend >= BigInt(T.roasCollapseMinSpendMinor) &&
        p.spend >= BigInt(T.roasCollapseMinSpendMinor)
      ) {
        const drop = pctChange(curRoas, priorRoas);
        if (drop !== null && drop <= -T.roasCollapseDropPercent) {
          out.push({
            rule: "roas_collapse",
            platform: c.platform,
            adAccountId: c.adAccountId,
            campaignExternalId: c.campaignExternalId,
            spendMinor: c.spend.toString(),
            evidence: {
              currentRoas: curRoas,
              priorRoas,
              changePercent: drop,
              spendMinor: c.spend.toString(),
              priorSpendMinor: p.spend.toString(),
              windowDays: days,
            },
          });
        }
      }
      // spend_spike: deliberately NO rule — see the header.
    }
    // Zero-conversion burners first (money out, nothing back),
    // then collapses; largest spend first inside each rule.
    const rank = (r: AdsPauseCandidate["rule"]) => (r === "zero_conversion_spend" ? 0 : 1);
    out.sort((a, b) => rank(a.rule) - rank(b.rule) || Number(BigInt(b.spendMinor) - BigInt(a.spendMinor)));
    return out;
  }

  /** Evaluate + file the pause proposals for one digest.
   *  Returns how many NEW proposals were created (dedupe hits
   *  and builder refusals — e.g. a flagged campaign whose
   *  account is CSV-only — are normal outcomes, not errors). */
  async evaluateAndPropose(
    organizationId: string,
    opts: { days?: number; now?: Date } = {},
  ): Promise<{ candidates: number; proposed: number }> {
    const days = opts.days === 30 ? 30 : 7;
    const now = opts.now ?? new Date();
    const cur = performancePeriod(days, now);
    const candidates = await this.evaluateCampaigns(organizationId, { days, now });
    let proposed = 0;
    for (const cand of candidates.slice(0, MAX_PAUSE_PROPOSALS_PER_DIGEST)) {
      const created = await this.proposeQuietly(organizationId, cand, {
        days,
        periodStart: cur.start.toISOString(),
        periodEnd: cur.end.toISOString(),
      });
      if (created) proposed++;
    }
    return { candidates: candidates.length, proposed };
  }

  /** propose() with the proposer's failure discipline: typed
   *  refusals (autonomy off) and dedupe hits are results;
   *  builder rejections of unresolvable targets are expected —
   *  nothing here may ever surface into the digest path. */
  private async proposeQuietly(
    organizationId: string,
    cand: AdsPauseCandidate,
    period: { days: number; periodStart: string; periodEnd: string },
  ): Promise<boolean> {
    try {
      const res: any = await this.engine.propose(
        organizationId,
        "pause_campaign",
        {
          platform: cand.platform,
          campaignExternalId: cand.campaignExternalId,
          ...(cand.adAccountId ? { adAccountId: cand.adAccountId } : {}),
        },
        {
          proposedBy: "ai",
          actorUserId: null,
          sourceRef: {
            source: "ads_digest",
            rule: cand.rule,
            windowDays: period.days,
            periodStart: period.periodStart,
            periodEnd: period.periodEnd,
            platform: cand.platform,
            campaignExternalId: cand.campaignExternalId,
            evidence: cand.evidence,
          },
        },
      );
      return !!res?.ok && !res?.deduped;
    } catch {
      /* a target that no longer resolves (account disconnected,
         campaign record gone) simply yields no proposal */
      return false;
    }
  }
}
