import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export type LearningSourceStatus = "active" | "partial" | "not_built";

export interface LearningSourceRow {
  /** Plan §5 number, 1–14 — the registry is keyed to the plan. */
  id: number;
  nameBn: string;
  nameEn: string;
  status: LearningSourceStatus;
  /** The service that produces this source's learning, or null
   * when nothing produces it (not_built). */
  producingService: string | null;
  /** Where the learned material lives, or null. */
  storage: string | null;
  /** The real gate: a settings field name, a sweep/job name, or
   * "always_on"; null when the source does not exist. */
  gate: string | null;
  /** Orgs with the source's toggle ON — only where a per-org
   * toggle actually exists, else null (never estimated). */
  orgsEnabled: number | null;
  /** Items produced in the trailing 30 days, counted from the
   * source's real storage — only where that storage supports
   * counting, else null (never estimated). */
  itemsLast30Days: number | null;
  /** The honest limit (partial) or the recorded reason
   * (not_built); null for a fully active source. */
  note: string | null;
}

/**
 * SA-B22 (Smart AI Phase 6, plan T2 — Sources Registry): the
 * admin read over the plan's 14 learning sources (§5), computed
 * from REAL registrations, not a hand-written status page.
 * Step 0 for this batch walked every learning service in the
 * tree (ai/*-learning, conversation-mining, customer-memory,
 * the intelligence services, the Answer Store capture paths);
 * each row below names the producing service and storage that
 * walk actually found, the gate field / sweep that actually
 * controls it, and counters counted live from the storage rows.
 *
 * Honesty rules (the registry's whole point):
 *  - A source the plan names but no service feeds is
 *    "not_built" with its reason — support tickets and lead/CRM
 *    outcomes have product surfaces in this tree but NO learning
 *    path into the Brain (verified: no ai/* service reads
 *    SupportTicket or Lead rows).
 *  - A source that feeds the Brain only partially is "partial"
 *    with the limit named (comments: capture/reuse only, no
 *    mining; reviews: aggregates only; courier: return reasons
 *    only; broadcasts: delivery truth only — reply attribution
 *    does not exist, the SA-B5 record).
 *  - Counters are null wherever no honest count exists. The
 *    PerformanceSnapshot-fed rows share one storage, so their
 *    itemsLast30Days is the snapshot count, labelled shared in
 *    the row's storage text — never dressed up as per-source
 *    production.
 */
@Injectable()
export class LearningSourcesService {
  constructor(private readonly prisma: PrismaService) {}

  private db(): any {
    return this.prisma as any;
  }

  /** A count that may not exist (delegate absent on a partial
   * double, table missing) is null — unknown, never 0. */
  private async countOrNull(fn: () => Promise<number>): Promise<number | null> {
    try {
      const n = await fn();
      return typeof n === "number" && Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }

  async registry(now = new Date()) {
    const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const p = this.db();

    const conversationOrgs = await this.countOrNull(() =>
      p.businessProfile.count({ where: { conversationLearningEnabled: true } }),
    );
    const websiteOrgs = await this.countOrNull(() =>
      p.businessProfile.count({ where: { websiteLearningEnabled: true } }),
    );
    const answerStoreOrgs = await this.countOrNull(() =>
      p.businessProfile.count({ where: { answerStoreEnabled: true } }),
    );
    const snapshots30d = await this.countOrNull(() =>
      p.performanceSnapshot.count({ where: { createdAt: { gte: since } } }),
    );
    const learned = (sourceTypes: string[]) =>
      this.countOrNull(() =>
        p.learnedItem.count({ where: { sourceType: { in: sourceTypes }, createdAt: { gte: since } } }),
      );

    const sources: LearningSourceRow[] = [
      {
        id: 1,
        nameBn: "প্রতিষ্ঠানের তথ্য ও নীতি",
        nameEn: "Organization Settings / Business Profile & Policy",
        status: "active",
        producingService: "OrgBrainService (live read at context time)",
        storage: "BusinessProfile + BusinessPolicy rows",
        gate: "always_on",
        orgsEnabled: null,
        itemsLast30Days: null,
        note: null,
      },
      {
        id: 2,
        nameBn: "পণ্য ও ক্যাটালগ",
        nameEn: "Products & Catalog",
        status: "active",
        producingService: "KnowledgeIndexingService (product text index) + OrgBrainService live product read",
        storage: "KnowledgeEmbedding (sourceType=product) + Product rows",
        gate: "always_on on product writes (ProductsService fire-and-forget) + knowledge_index_sweep backfill (per-org job enable)",
        orgsEnabled: null,
        itemsLast30Days: await this.countOrNull(() =>
          p.knowledgeEmbedding.count({ where: { sourceType: "product", createdAt: { gte: since } } }),
        ),
        note: null,
      },
      {
        id: 3,
        nameBn: "অর্ডার ও customer",
        nameEn: "Orders & Customers",
        status: "active",
        producingService: "CustomerMemoryService + PerformanceLearningService",
        storage: "CustomerMemory rows + PerformanceSnapshot (shared)",
        gate: "BusinessProfile.conversationLearningEnabled",
        orgsEnabled: conversationOrgs,
        itemsLast30Days: await this.countOrNull(() =>
          p.customerMemory.count({ where: { updatedAt: { gte: since } } }),
        ),
        note: null,
      },
      {
        id: 4,
        nameBn: "ইনবক্স কথোপকথন",
        nameEn: "Inbox Conversations",
        status: "active",
        producingService: "ConversationMiningService (+ staff-edit capture into the Answer Store)",
        storage: "LearnedItem (conversation, unanswered) + LearningState",
        gate: "BusinessProfile.conversationLearningEnabled",
        orgsEnabled: conversationOrgs,
        itemsLast30Days: await learned(["conversation", "unanswered"]),
        note: null,
      },
      {
        id: 5,
        nameBn: "Facebook/Instagram comment",
        nameEn: "Facebook/Instagram Comments",
        status: "partial",
        producingService: "SocialCommentsService (verified-answer capture, Answer Store channel=comment)",
        storage: "AiStoredAnswer (channel=comment)",
        gate: "BusinessProfile.answerStoreEnabled",
        orgsEnabled: answerStoreOrgs,
        itemsLast30Days: await this.countOrNull(() =>
          p.aiStoredAnswer.count({ where: { channel: "comment", createdAt: { gte: since } } }),
        ),
        note: "Capture/reuse only: grounded comment answers are stored and re-served, but comment threads are not mined into the LearnedItem review queue (inbox conversations are, source 4).",
      },
      {
        id: 6,
        nameBn: "সোশ্যাল পোস্ট ও performance",
        nameEn: "Social Posts & Performance",
        status: "active",
        producingService: "PerformanceLearningService (socialMetrics)",
        storage: "PerformanceSnapshot (shared with sources 3, 7, 10, 12, 14)",
        gate: "performance_learning_sweep (per-org job enable)",
        orgsEnabled: null,
        itemsLast30Days: snapshots30d,
        note: null,
      },
      {
        id: 7,
        nameBn: "বিজ্ঞাপন ও campaign",
        nameEn: "Ads & Campaigns",
        status: "active",
        producingService: "AdsIntelligenceService + CreativeLearningService",
        storage: "LearnedItem (ads, creative) + PerformanceSnapshot (shared)",
        gate: "ads_intelligence_sweep + creative_learning_sweep (per-org job enables)",
        orgsEnabled: null,
        itemsLast30Days: await learned(["ads", "creative"]),
        note: null,
      },
      {
        id: 8,
        nameBn: "প্রতিদ্বন্দ্বীর ডেটা",
        nameEn: "Competitor Data",
        status: "active",
        producingService: "CompetitorIntelligenceService + CompetitorResponseService",
        storage: "Competitor / CompetitorAd / CompetitorPriceObservation + LearnedItem (competitor)",
        gate: "competitor_intelligence_sweep (per-org job enable; upstream Meta Ad Library sync + price scanner unchanged)",
        orgsEnabled: null,
        itemsLast30Days: await learned(["competitor"]),
        note: null,
      },
      {
        id: 9,
        nameBn: "নিজের website / storefront",
        nameEn: "Own Website / Storefront Pages",
        status: "active",
        producingService: "WebsiteLearningService",
        storage: "KnowledgeDocument (kind=website)",
        gate: "BusinessProfile.websiteLearningEnabled",
        orgsEnabled: websiteOrgs,
        itemsLast30Days: await this.countOrNull(() =>
          p.knowledgeDocument.count({ where: { kind: "website", createdAt: { gte: since } } }),
        ),
        note: null,
      },
      {
        id: 10,
        nameBn: "রিভিউ ও রেটিং",
        nameEn: "Reviews & Ratings",
        status: "partial",
        producingService: "PerformanceLearningService (OrderReview aggregates in the snapshot)",
        storage: "PerformanceSnapshot.sales.reviews + OrderReview rows",
        gate: "performance_learning_sweep (per-org job enable)",
        orgsEnabled: null,
        itemsLast30Days: await this.countOrNull(() =>
          p.orderReview.count({ where: { receivedAt: { gte: since } } }),
        ),
        note: "Aggregates only (count / average / distribution in the internal performance facts): no review-pattern mining into the LearnedItem queue exists.",
      },
      {
        id: 11,
        nameBn: "সাপোর্ট টিকিট",
        nameEn: "Support Tickets",
        status: "not_built",
        producingService: null,
        storage: null,
        gate: null,
        orgsEnabled: null,
        itemsLast30Days: null,
        note: "Not built: SupportTicket rows exist (Support module) but no service reads them for learning — verified in the SA-B22 Step-0 walk (no ai/* service references the ticket tables). Ticket problem/solution patterns never reach the Brain.",
      },
      {
        id: 12,
        nameBn: "কুরিয়ার / ডেলিভারি / রিটার্ন",
        nameEn: "Courier / Delivery / Returns",
        status: "partial",
        producingService: "PerformanceLearningService (ReturnRequest reason aggregates in the snapshot)",
        storage: "PerformanceSnapshot.sales.returns + ReturnRequest rows",
        gate: "performance_learning_sweep (per-org job enable)",
        orgsEnabled: null,
        itemsLast30Days: await this.countOrNull(() =>
          p.returnRequest.count({ where: { createdAt: { gte: since } } }),
        ),
        note: "Return reasons only: courier / area-wise delivery problems are not learned — no service aggregates delivery failures into the Brain.",
      },
      {
        id: 13,
        nameBn: "লিড / CRM",
        nameEn: "Leads / CRM",
        status: "not_built",
        producingService: null,
        storage: null,
        gate: null,
        orgsEnabled: null,
        itemsLast30Days: null,
        note: "Not built: Lead rows exist (CRM) and the inbox can create leads (an Action Engine act), but why a lead bought or did not buy is never learned into the Brain — verified in the SA-B22 Step-0 walk (no ai/* service reads Lead rows).",
      },
      {
        id: 14,
        nameBn: "Broadcast / বার্তার ফলাফল",
        nameEn: "Broadcast / Messaging Results",
        status: "partial",
        producingService: "PerformanceLearningService (broadcastMetrics)",
        storage: "PerformanceSnapshot (shared with sources 3, 6, 7, 10, 12)",
        gate: "performance_learning_sweep (per-org job enable)",
        orgsEnabled: null,
        itemsLast30Days: snapshots30d,
        note: "Delivery truth only (sent / delivered / read / failed from MessageDelivery): broadcast reply attribution does not exist in this tree, so 'which message earned replies' is not learned (the SA-B5 record).",
      },
    ];

    return {
      generatedAt: now.toISOString(),
      windowDays: 30,
      sources,
      totals: {
        active: sources.filter((s) => s.status === "active").length,
        partial: sources.filter((s) => s.status === "partial").length,
        notBuilt: sources.filter((s) => s.status === "not_built").length,
      },
    };
  }
}
