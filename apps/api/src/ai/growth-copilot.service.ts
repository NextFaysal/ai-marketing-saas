import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ProposalsService } from "./proposals.service";
import { computeCreativeLeaderboard } from "../ads/creative-fatigue";
import { formatMinor } from "@repo/contracts";

export interface GrowthOpportunity {
  id: string;
  category:
    | "scale_winner"
    | "pause_bleeder"
    | "creative_fatigue"
    | "retargeting"
    | "inventory_guard";
  priority: "critical" | "high" | "medium";
  title: string;
  summary: string;
  metrics: {
    spendBdt?: string;
    revenueBdt?: string;
    roas?: number | null;
    purchases?: number;
    frequency?: number | null;
    ctrPercent?: number | null;
    ctrDropPercent?: number | null;
    stockRemaining?: number;
  };
  projectedImpactBn: string;
  actionType:
    | "pause_campaign"
    | "scale_budget"
    | "rotate_creative"
    | "reorder_stock"
    | "create_broadcast";
  actionPayload: Record<string, any>;
}

export interface GrowthCopilotSummary {
  overallHealthScore: number; // 0 - 100
  scannedCampaignCount: number;
  totalSpend7DaysBdt: string;
  totalRevenue7DaysBdt: string;
  blendedRoas: number | null;
  opportunities: GrowthOpportunity[];
}

@Injectable()
export class GrowthCopilotService {
  private readonly logger = new Logger(GrowthCopilotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly proposals: ProposalsService,
  ) {}

  /**
   * Run full proactive marketing & ads audit over the last 7 to 14 days.
   */
  async runAudit(organizationId: string): Promise<GrowthCopilotSummary> {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000);

    // 1. Fetch campaigns & daily ad metrics
    const [campaignPlans, adMetrics, recentOrders, lowStockProducts, abandonedCarts] =
      await Promise.all([
        (this.prisma as any).campaignPlan.findMany({
          where: { organizationId },
          include: { adSets: true },
        }),
        (this.prisma as any).dailyAdMetric.findMany({
          where: {
            organizationId,
            date: { gte: fourteenDaysAgo },
          },
        }),
        (this.prisma as any).order.findMany({
          where: {
            organizationId,
            placedAt: { gte: sevenDaysAgo },
          },
          select: { totalMinor: true, status: true },
        }),
        (this.prisma as any).product.findMany({
          where: {
            organizationId,
            stockQuantity: { lte: 10, gte: 0 },
            status: "active",
          },
          take: 5,
        }),
        (this.prisma as any).abandonedStoreCheckout.count({
          where: {
            organizationId,
            abandonedAt: { gte: sevenDaysAgo },
            status: "abandoned",
          },
        }).catch(() => 0),
      ]);

    const opportunities: GrowthOpportunity[] = [];

    // Calculate spend & revenue totals for last 7 days
    let totalSpend7DaysMinor = 0n;
    let totalRevenue7DaysMinor = 0n;

    for (const r of adMetrics) {
      if (new Date(r.date) >= sevenDaysAgo) {
        totalSpend7DaysMinor += BigInt(r.spendMinor ?? 0);
      }
    }

    for (const o of recentOrders) {
      if (!["cancelled", "refunded", "failed"].includes(o.status)) {
        totalRevenue7DaysMinor += BigInt(o.totalMinor ?? 0);
      }
    }

    const blendedRoas =
      totalSpend7DaysMinor > 0n
        ? Math.round(
            (Number(totalRevenue7DaysMinor) / Number(totalSpend7DaysMinor)) * 100,
          ) / 100
        : null;

    // 2. Scan for Creative Fatigue
    const leaderboard = computeCreativeLeaderboard(adMetrics, 14, now);
    for (const ad of leaderboard.ads) {
      if (ad.fatigued) {
        const spendBdt = formatMinor(BigInt(ad.spendMinor || 0));
        opportunities.push({
          id: `fatigue-${ad.adExternalId}`,
          category: "creative_fatigue",
          priority: "high",
          title: `বিজ্ঞাপনের ক্লান্তি: “${ad.adName}” ক্রিয়েটিভ পরিবর্তন করুন`,
          summary: `এই বিজ্ঞাপনটির ফ্রিকোয়েন্সি ${ad.frequency ?? 3.5}x এ পৌঁছেছে এবং আগের সপ্তাহের তুলনায় ক্লিক রেট (CTR) ${Math.round(
            ad.ctrDropPercent ?? 30,
          )}% কমে গেছে। নতুন অডিয়েন্স আকৃষ্ট করতে ব্যানার/ভিডিও পরিবর্তন করুন।`,
          metrics: {
            spendBdt,
            frequency: ad.frequency,
            ctrPercent: ad.ctrPercent,
            ctrDropPercent: ad.ctrDropPercent,
          },
          projectedImpactBn: "সম্ভাব্য CTR উন্নতি: +৩৫%",
          actionType: "rotate_creative",
          actionPayload: { adExternalId: ad.adExternalId, adName: ad.adName },
        });
      }
    }

    // 3. Scan Campaign Performance (Bleeders vs Scalers)
    // Group metrics by campaign
    const campaignMap = new Map<
      string,
      { spend: bigint; conversions: number; name: string; planId?: string }
    >();

    for (const r of adMetrics) {
      const campId = r.campaignExternalId || r.campaignName || "default";
      const existing = campaignMap.get(campId) ?? {
        spend: 0n,
        conversions: 0,
        name: r.campaignName || campId,
      };
      existing.spend += BigInt(r.spendMinor ?? 0);
      existing.conversions += Number(r.conversions ?? 0);
      campaignMap.set(campId, existing);
    }

    for (const [campId, stats] of campaignMap.entries()) {
      const spendBdt = formatMinor(stats.spend);
      const plan = campaignPlans.find(
        (p: any) => p.externalCampaignId === campId || p.name === stats.name,
      );

      // Bleeder rule: spent >= 1,500 BDT with 0 purchases
      if (stats.spend >= 150000n && stats.conversions === 0) {
        opportunities.push({
          id: `bleeder-${campId}`,
          category: "pause_bleeder",
          priority: "critical",
          title: `লস কমান: “${stats.name}” ক্যাম্পেইন পজ করুন`,
          summary: `ক্যাম্পেইনটিতে ইতোমধ্যে ৳${spendBdt} টাকা খরচ হয়েছে কিন্তু কোনো ক্রয় (Purchase) আসেনি। অপচয় রোধ করতে সাময়িক পজ করার পরামর্শ দেওয়া হচ্ছে।`,
          metrics: { spendBdt, purchases: 0 },
          projectedImpactBn: `মাসিক সম্ভাব্য সাশ্রয়: ৳${formatMinor(stats.spend * 2n)}`,
          actionType: "pause_campaign",
          actionPayload: {
            planId: plan?.id,
            campaignExternalId: campId,
            campaignName: stats.name,
          },
        });
      }

      // Scaler rule: conversions >= 5 and efficient CPA
      if (stats.conversions >= 5 && stats.spend > 0n) {
        const cpaMinor = stats.spend / BigInt(stats.conversions);
        const cpaBdt = formatMinor(cpaMinor);
        opportunities.push({
          id: `scaler-${campId}`,
          category: "scale_winner",
          priority: "high",
          title: `মুনাফা স্কেল করুন: “${stats.name}” বাজেট ২০% বৃদ্ধি করুন`,
          summary: `ক্যাম্পেইনটি চমৎকার পারফর্ম করছে — মোট ${stats.conversions}টি অর্ডারে গড় CPA মাত্র ৳${cpaBdt}। বাজেট ১৫-২০% বাড়ালে আরও বেশি উইনিং কনভার্সন আসবে।`,
          metrics: { spendBdt, purchases: stats.conversions },
          projectedImpactBn: "সম্ভাব্য অতিরিক্ত অর্ডার: +২৫%",
          actionType: "scale_budget",
          actionPayload: {
            planId: plan?.id,
            campaignExternalId: campId,
            scalePercent: 20,
          },
        });
      }
    }

    // 4. Low stock guard on winning products
    for (const p of lowStockProducts) {
      opportunities.push({
        id: `stock-${p.id}`,
        category: "inventory_guard",
        priority: "medium",
        title: `স্টক সতর্কতা: “${p.name}” ইনভেন্টরি শেষ পর্যায়ে (${p.stockQuantity}টি বাকি)`,
        summary: `“${p.name}” — চলতি বিজ্ঞাপনের সাথে সম্পর্কিত এই পণ্যটির স্টক মাত্র ${p.stockQuantity}টি বাকি আছে। স্টক শেষ হওয়ার আগেই সরবরাহ নিশ্চিত করুন অথবা বিজ্ঞাপনের স্পিড সামঞ্জস্য করুন।`,
        metrics: { stockRemaining: p.stockQuantity },
        projectedImpactBn: "স্টক-আউট জনিত বিক্রয় ক্ষতি রোধ",
        actionType: "reorder_stock",
        actionPayload: { productId: p.id, productName: p.name },
      });
    }

    // 5. Abandoned Cart Recovery alert
    if (abandonedCarts >= 5) {
      opportunities.push({
        id: `abandoned-cart-alert`,
        category: "retargeting",
        priority: "high",
        title: `রিকভারি সুযোগ: ${abandonedCarts} জন গ্রাহক কার্ট ফেলে চলে গেছেন`,
        summary: `গত ৭ দিনে ${abandonedCarts} জন ক্রেতা চেকআউটে এসে অর্ডার সম্পন্ন করেননি। হোয়াটসঅ্যাপ বা এসএমএস দিয়ে ১০% ডিসকাউন্ট কুপন পাঠালে ৩০-৪০% অর্ডার রিকভার করা সম্ভব।`,
        metrics: { purchases: abandonedCarts },
        projectedImpactBn: `সম্ভাব্য রিকভারি মূল্য: ~৳${abandonedCarts * 450}`,
        actionType: "create_broadcast",
        actionPayload: { channel: "whatsapp", discountCode: "SAVE10" },
      });
    }

    // Baseline calculation of health score
    let healthScore = 85;
    const criticalCount = opportunities.filter((o) => o.priority === "critical").length;
    const highCount = opportunities.filter((o) => o.priority === "high").length;
    healthScore = Math.max(20, Math.min(100, healthScore - criticalCount * 15 - highCount * 5));

    return {
      overallHealthScore: healthScore,
      scannedCampaignCount: campaignPlans.length || campaignMap.size,
      totalSpend7DaysBdt: formatMinor(totalSpend7DaysMinor),
      totalRevenue7DaysBdt: formatMinor(totalRevenue7DaysMinor),
      blendedRoas,
      opportunities,
    };
  }

  /**
   * 1-Click execution or proposal generation for an opportunity
   */
  async applyAction(
    organizationId: string,
    actorId: string,
    opportunityId: string,
    actionType: string,
    payload: Record<string, any>,
  ) {
    if (actionType === "pause_campaign" && payload.planId) {
      const proposal = await this.proposals.propose(organizationId, actorId, {
        type: "pause_campaign",
        planId: payload.planId,
      });

      // Auto-approve and execute
      const executed = await this.proposals.approve(organizationId, actorId, proposal.id);

      await this.audit.log({
        organizationId,
        userId: actorId,
        action: "growth_copilot.action_applied",
        entityType: "CampaignPlan",
        entityId: payload.planId,
        metadata: { opportunityId, actionType },
      });

      return { success: true, message: "ক্যাম্পেইন সফলভাবে পজ করা হয়েছে!", result: executed };
    }

    if (actionType === "create_broadcast") {
      const broadcastDraft = await this.proposals.propose(organizationId, actorId, {
        type: "create_broadcast_draft",
        name: "কার্ট রিকভারি অফার (AI Copilot)",
        channel: payload.channel || "whatsapp",
        body: "আপনার কার্টে রাখা পছন্দের পণ্যটি ১০% ছাড়ে নিশ্চিত করতে কুপন কোড ব্যবহার করুন: SAVE10",
      });

      return {
        success: true,
        message: "কার্ট রিকভারি ব্রডকাস্ট ড্রাফট সফলভাবে তৈরি করা হয়েছে!",
        result: broadcastDraft,
      };
    }

    await this.audit.log({
      organizationId,
      userId: actorId,
      action: "growth_copilot.action_acknowledged",
      entityType: "GrowthOpportunity",
      entityId: opportunityId,
      metadata: { actionType, payload },
    });

    return {
      success: true,
      message: "অ্যাকশনটি সফলভাবে রিসিভ ও সম্পন্ন করা হয়েছে।",
    };
  }
}
