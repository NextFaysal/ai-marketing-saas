import {
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CampaignsService } from "../campaigns/campaigns.service";
import { EventsService } from "../common/events.service";
import { badRequest, notFound } from "../i18n/api-exception";

@Injectable()
export class InventoryAdGuardService {
  private readonly logger = new Logger(InventoryAdGuardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly campaigns?: CampaignsService,
    @Optional() private readonly events?: EventsService,
  ) {}

  /**
   * Evaluates if product stock is depleted (<= 0), finds all active Meta ads
   * promoting this product, and automatically pauses them to stop burning ad budget.
   */
  async checkStockoutAndProtect(
    organizationId: string,
    productId: string,
    currentStock: number,
  ) {
    if (currentStock > 0) {
      return { protected: false, reason: "in_stock", currentStock };
    }

    const product = await (this.prisma as any).product.findFirst({
      where: { id: productId, organizationId },
    });
    if (!product) return { protected: false, reason: "product_not_found" };

    // Find all published campaigns with ads linked to this product
    const ads = await (this.prisma as any).campaignAd.findMany({
      where: {
        productId,
        adSet: {
          plan: {
            organizationId,
            status: "published",
          },
        },
      },
      include: {
        adSet: {
          include: {
            plan: true,
          },
        },
      },
    });

    if (ads.length === 0) {
      return { protected: false, reason: "no_active_ads_for_product" };
    }

    const pausedCampaigns: any[] = [];

    // Group by plan
    const plansToPause = new Map<string, any>();
    for (const ad of ads) {
      const plan = ad.adSet?.plan;
      if (plan && plan.metaStatus === "ACTIVE") {
        plansToPause.set(plan.id, { plan, ad });
      }
    }

    for (const [planId, { plan, ad }] of plansToPause.entries()) {
      try {
        if (this.campaigns) {
          await this.campaigns.setMetaStatus(
            organizationId,
            "system_ad_guard",
            planId,
            "PAUSED",
          );
        }

        const log = await (this.prisma as any).inventoryAdGuardLog.create({
          data: {
            organizationId,
            productId,
            productName: product.title || "Product",
            currentStock,
            action: "AUTO_PAUSED",
            campaignPlanId: planId,
            campaignName: plan.name,
            adId: ad.id,
            adName: ad.name,
            details: `স্টক ০ হয়ে যাওয়ায় ফেসবুক অ্যাড "${plan.name}" স্বয়ংক্রিয়ভাবে Pause করা হয়েছে।`,
          },
        });

        pausedCampaigns.push({
          planId,
          campaignName: plan.name,
          logId: log.id,
        });

        // Emit guard event
        if (this.events) {
          try {
            this.events.emit("ad_guard.auto_paused", {
              organizationId,
              productId,
              productName: product.title,
              planId,
              campaignName: plan.name,
            });
          } catch {}
        }
      } catch (err) {
        this.logger.warn(
          `Failed to auto-pause campaign ${planId} for out-of-stock product ${productId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    return {
      protected: pausedCampaigns.length > 0,
      productTitle: product.title,
      pausedCount: pausedCampaigns.length,
      pausedCampaigns,
    };
  }

  /**
   * When product is restocked, finds previously auto-paused campaigns and alerts merchant.
   */
  async checkRestockAndNotify(
    organizationId: string,
    productId: string,
    newStock: number,
  ) {
    if (newStock <= 0) return { notified: false };

    const product = await (this.prisma as any).product.findFirst({
      where: { id: productId, organizationId },
    });
    if (!product) return { notified: false };

    // Find any auto-paused log for this product
    const recentLogs = await (this.prisma as any).inventoryAdGuardLog.findMany({
      where: {
        organizationId,
        productId,
        action: "AUTO_PAUSED",
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    const eligibleCampaigns: any[] = [];
    for (const log of recentLogs) {
      if (log.campaignPlanId) {
        const plan = await (this.prisma as any).campaignPlan.findFirst({
          where: { id: log.campaignPlanId, organizationId },
        });
        if (plan && plan.metaStatus === "PAUSED") {
          eligibleCampaigns.push(plan);
        }
      }
    }

    if (eligibleCampaigns.length > 0) {
      await (this.prisma as any).inventoryAdGuardLog.create({
        data: {
          organizationId,
          productId,
          productName: product.title,
          currentStock: newStock,
          action: "ALERT_SENT",
          details: `প্রোডাক্ট রিস্টক হয়েছে (${newStock}টি)। ${eligibleCampaigns.length}টি মেটা ক্যাম্পেইন পুনরায় চালুর জন্য প্রস্তুত।`,
        },
      });

      if (this.events) {
        try {
          this.events.emit("ad_guard.restocked", {
            organizationId,
            productId,
            productName: product.title,
            newStock,
            campaignCount: eligibleCampaigns.length,
          });
        } catch {}
      }
    }

    return {
      notified: eligibleCampaigns.length > 0,
      eligibleCampaignCount: eligibleCampaigns.length,
      eligibleCampaigns: eligibleCampaigns.map((c) => ({ id: c.id, name: c.name })),
    };
  }

  /**
   * Returns list of inventory ad guard activities and protected campaigns.
   */
  async listLogs(organizationId: string) {
    const logs = await (this.prisma as any).inventoryAdGuardLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const totalProtectedCount = logs.filter((l: any) => l.action === "AUTO_PAUSED").length;

    return {
      totalProtectedCount,
      logs,
    };
  }

  /**
   * 1-click manual resume of a paused campaign from the guardrail log.
   */
  async resumeCampaign(organizationId: string, actorId: string, planId: string) {
    if (!this.campaigns) {
      throw badRequest("automation.campaignsServiceNotAvailable");
    }

    const plan = await (this.prisma as any).campaignPlan.findFirst({
      where: { id: planId, organizationId },
    });
    if (!plan) throw notFound("automation.campaignPlanNotFound");

    await this.campaigns.setMetaStatus(organizationId, actorId, planId, "ACTIVE");

    await (this.prisma as any).inventoryAdGuardLog.create({
      data: {
        organizationId,
        productId: "MANUAL",
        productName: "Manual Action",
        currentStock: 1,
        action: "AUTO_RESUMED",
        campaignPlanId: planId,
        campaignName: plan.name,
        details: `ক্যাম্পেইন "${plan.name}" মার্চেন্ট কর্তৃক পুনরায় সক্রিয় করা হয়েছে।`,
      },
    });

    return {
      success: true,
      message: `ক্যাম্পেইন "${plan.name}" সফলভাবে Meta-তে সচল (Active) করা হয়েছে।`,
    };
  }
}
