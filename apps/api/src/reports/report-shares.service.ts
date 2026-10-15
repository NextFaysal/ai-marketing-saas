import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AnalyticsService } from "../analytics/analytics.service";
import { ExecutiveService } from "./executive.service";
import { CampaignsService } from "../campaigns/campaigns.service";

@Injectable()
export class ReportSharesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
    @Optional() private readonly executiveSvc?: ExecutiveService,
    @Optional() private readonly campaignsSvc?: CampaignsService,
  ) {}

  async create(organizationId: string, actorId: string, dto: { title: string; days?: number; expiresInDays?: number; kind?: string; planId?: string }) {
    const days = dto.days ?? 30;
    if (![7, 14, 30, 60, 90].includes(days)) throw new BadRequestException("days must be one of 7, 14, 30, 60, 90");
    const kind = dto.kind ?? "overview";
    if (!["overview", "executive", "campaign"].includes(kind)) throw new BadRequestException("kind must be overview, executive or campaign");
    // Frontier NB8 / CN18: a campaign share names ONE
    // plan of this org (validated here, at creation —
    // a token must never resolve to another org's plan).
    let planId: string | null = null;
    if (kind === "campaign") {
      if (!dto.planId) throw new BadRequestException("A campaign report share needs a planId");
      const plan = await (this.prisma as any).campaignPlan?.findFirst?.({ where: { id: dto.planId, organizationId } }).catch(() => null);
      if (!plan) throw new BadRequestException("Campaign plan not found in this organization");
      planId = dto.planId;
    }
    const expiresInDays = Math.min(365, Math.max(1, dto.expiresInDays ?? 30));
    const token = randomBytes(24).toString("base64url");
    const share = await (this.prisma as any).reportShare.create({
      data: {
        organizationId, token, title: dto.title, days, kind, planId,
        expiresAt: new Date(Date.now() + expiresInDays * 86400000), createdById: actorId,
      },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "report_share.created", entityType: "ReportShare", entityId: share.id, metadata: { days, kind, planId } });
    return share;
  }

  /**
   * RP6: the public EXECUTIVE rendering. Built from the
   * same ExecutiveService payload as the tenant view,
   * with profit and every cost-derived field REMOVED —
   * the client-report discipline is identical to the
   * overview share's.
   */
  private async publicExecutive(share: any) {
    if (!this.executiveSvc) throw new NotFoundException("This report link is invalid");
    const to = new Date(); to.setUTCHours(0, 0, 0, 0);
    const from = new Date(to.getTime() - (share.days - 1) * 86400000);
    const exec = await this.executiveSvc.executive(share.organizationId, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10));
    const org = await (this.prisma as any).organization.findUnique({ where: { id: share.organizationId } });
    return {
      kind: "executive",
      title: share.title,
      business: org?.name ?? "",
      branding: {
        name: org?.brandName ?? org?.name ?? "",
        logoUrl: org?.logoUrl ?? null,
        primaryColor: org?.primaryColor ?? null,
      },
      generatedAt: new Date().toISOString(),
      days: share.days,
      range: exec.range,
      sales: {
        orders: exec.sales.orders, revenueMinor: exec.sales.revenueMinor,
        refundedMinor: exec.sales.refundedMinor, averageOrderValueMinor: exec.sales.averageOrderValueMinor,
      },
      ads: exec.ads,
      customers: exec.customers,
      operations: exec.operations,
      note: "Platform-reported conversions come from the ad platforms themselves and can differ from tracked store orders. Costs and profit margins are not part of this client report.",
    };
  }

  /**
   * Frontier NB8 / CN18: the public CAMPAIGN rendering.
   * The payload comes from CampaignsService.
   * publicCampaignReport, whose shape is an explicit
   * allowlist (totals / per-ad-set / breakdowns /
   * pacing) — no comments, mentions, approval internals
   * or publish logs can reach a public token. The share
   * row supplies only the title and the window.
   */
  private async publicCampaign(share: any) {
    if (!this.campaignsSvc || !share.planId) throw new NotFoundException("This report link is invalid");
    const payload = await this.campaignsSvc.publicCampaignReport(share.organizationId, share.planId, share.days);
    return { ...payload, title: share.title };
  }

  async list(organizationId: string) {
    return (this.prisma as any).reportShare.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 50 });
  }

  async revoke(organizationId: string, id: string) {
    const share = await (this.prisma as any).reportShare.findFirst({ where: { id, organizationId } });
    if (!share) throw new NotFoundException("Share link not found");
    await (this.prisma as any).reportShare.delete({ where: { id } });
    return { deleted: true };
  }

  /** Public client view: totals + platform KPIs + campaign rows.
   * Deliberately excludes COGS, profit and every internal field. */
  async publicReport(token: string) {
    const share = await (this.prisma as any).reportShare.findUnique({ where: { token } });
    if (!share) throw new NotFoundException("This report link is invalid");
    if (new Date(share.expiresAt).getTime() < Date.now()) throw new NotFoundException("This report link has expired");
    if (share.kind === "executive") return this.publicExecutive(share);
    if (share.kind === "campaign") return this.publicCampaign(share);
    const to = new Date(); to.setUTCHours(0, 0, 0, 0);
    const from = new Date(to.getTime() - (share.days - 1) * 86400000);
    const toExclusive = new Date(to.getTime() + 86400000);
    const result: any = await this.analytics.computeRange(share.organizationId, from, toExclusive);
    const org = await (this.prisma as any).organization.findUnique({ where: { id: share.organizationId } });
    // Milestone 59: delivery summary for the same window, from the
    // org's real CourierShipment rows (statuses as written by the
    // courier integrations: delivered / partial_delivered / returned).
    const shipmentTable = (this.prisma as any).courierShipment;
    const shipments = shipmentTable ? await shipmentTable.findMany({
      where: { organizationId: share.organizationId, createdAt: { gte: from, lt: toExclusive } },
      select: { status: true },
    }).catch(() => []) : [];
    const delivered = shipments.filter((s: any) => s.status === "delivered" || s.status === "partial_delivered").length;
    const returned = shipments.filter((s: any) => s.status === "returned").length;
    const decided = delivered + returned;
    return {
      title: share.title,
      business: org?.name ?? "",
      // Milestone 59: white-label branding for the public page.
      // logoUrl is the API-relative public path (or null).
      branding: {
        name: org?.brandName ?? org?.name ?? "",
        logoUrl: org?.logoUrl ?? null,
        primaryColor: org?.primaryColor ?? null,
      },
      delivery: {
        shipments: shipments.length,
        delivered,
        returned,
        returnRatePercent: decided > 0 ? Math.round((returned / decided) * 1000) / 10 : null,
      },
      generatedAt: new Date().toISOString(),
      days: share.days,
      totals: {
        orders: result.totals.orders,
        revenueMinor: String(result.totals.revenueMinor),
        adSpendMinor: String(result.totals.adSpendMinor),
        impressions: result.totals.impressions,
        clicks: result.totals.clicks,
        platformConversions: result.totals.platformConversions,
      },
      kpis: {
        mer: result.kpis.mer, platformRoas: result.kpis.platformRoas,
        ctrPercent: result.kpis.ctrPercent, cpcMinor: result.kpis.cpcMinor, cpaMinor: result.kpis.cpaMinor,
      },
      campaigns: (result.campaigns ?? []).slice(0, 25).map((c: any) => ({
        name: c.campaignName ?? c.campaignExternalId ?? "(account level)", platform: c.platform,
        spendMinor: String(c.spendMinor), clicks: c.clicks,
        ctrPercent: c.ctrPercent, platformConversions: c.platformConversions,
        cpaMinor: c.cpaMinor, platformRoas: c.platformRoas,
      })),
      note: "Platform-reported conversions come from the ad platforms themselves and can differ from tracked store orders. Costs and profit margins are not part of this client report.",
    };
  }
}
