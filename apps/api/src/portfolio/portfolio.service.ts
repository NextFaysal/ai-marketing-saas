import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EmailProvider } from "../messaging/email.provider";
import { orgFlagEnabled } from "../common/feature-flags";

/**
 * Agency portfolio (Phase L): a cross-organization rollup for the
 * signed-in user's OWN memberships — month-to-date spend, revenue,
 * platform conversions and published plans per client org, plus a
 * weekly digest email. It reads only orgs the user belongs to.
 */
@Injectable()
export class PortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly email?: EmailProvider,
  ) {}

  async portfolioForUser(userId: string) {
    const memberships = await (this.prisma as any).membership.findMany({ where: { userId } });
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const orgs: any[] = [];
    let totalSpend = 0n; let totalRevenue = 0n; let totalOrders = 0; let totalConv = 0n;
    for (const m of memberships as any[]) {
      const org = await (this.prisma as any).organization.findFirst({ where: { id: m.organizationId } });
      if (!org) continue;
      // Milestone 40: platform feature flag (agency_portfolio;
      // the legacy "portfolio" key disables it too).
      if (!(await orgFlagEnabled(this.prisma as any, org.id, "agency_portfolio"))) continue;
      if (!(await orgFlagEnabled(this.prisma as any, org.id, "portfolio"))) continue;
      const metrics = await (this.prisma as any).dailyAdMetric.findMany({
        where: { organizationId: org.id, date: { gte: monthStart } }, take: 20000,
      });
      let spend = 0n; let conv = 0n;
      for (const r of metrics as any[]) {
        if ((r.adExternalId ?? "") !== "") continue;
        spend += BigInt(r.spendMinor ?? 0); conv += BigInt(r.conversions ?? 0);
      }
      const orders = await (this.prisma as any).order.findMany({
        where: { organizationId: org.id, createdAt: { gte: monthStart } }, take: 10000,
      });
      let revenue = 0n; let orderCount = 0;
      for (const o of orders as any[]) {
        if (["cancelled", "refunded"].includes(String(o.status))) continue;
        revenue += BigInt(o.totalMinor ?? 0); orderCount++;
      }
      const plans = await (this.prisma as any).campaignPlan.count({ where: { organizationId: org.id, status: "published" } }).catch(() => 0);
      totalSpend += spend; totalRevenue += revenue; totalOrders += orderCount; totalConv += conv;
      orgs.push({
        organizationId: org.id, name: org.name, role: m.role,
        monthSpendMinor: spend.toString(), monthRevenueMinor: revenue.toString(),
        monthOrders: orderCount, platformConversions: Number(conv),
        roas: spend > 0n ? Math.round(Number(revenue) / Number(spend) * 100) / 100 : null,
        publishedPlans: plans,
      });
    }
    orgs.sort((a, b) => Number(BigInt(b.monthSpendMinor) - BigInt(a.monthSpendMinor)));
    return {
      organizations: orgs,
      totals: {
        monthSpendMinor: totalSpend.toString(), monthRevenueMinor: totalRevenue.toString(),
        monthOrders: totalOrders, platformConversions: Number(totalConv),
        roas: totalSpend > 0n ? Math.round(Number(totalRevenue) / Number(totalSpend) * 100) / 100 : null,
      },
    };
  }

  async sendWeeklyDigest(userId: string) {
    if (!this.email) throw new BadRequestException("Email is not configured in this deployment");
    const user = await (this.prisma as any).user.findFirst({ where: { id: userId } });
    if (!user?.email) throw new BadRequestException("User email not found");
    const portfolio = await this.portfolioForUser(userId);
    const fmt = (minor: string) => (Number(BigInt(minor)) / 100).toLocaleString("en-US");
    const lines = [
      "সাপ্তাহিক পোর্টফোলিও ডাইজেস্ট — এই মাসের অবস্থা (month-to-date)",
      "",
      ...portfolio.organizations.map((o: any) =>
        `• ${o.name}: খরচ ${fmt(o.monthSpendMinor)}, আয় ${fmt(o.monthRevenueMinor)}, অর্ডার ${o.monthOrders}, ROAS ${o.roas ?? "n/a"}, Published Plan ${o.publishedPlans}`),
      "",
      `মোট: খরচ ${fmt(portfolio.totals.monthSpendMinor)}, আয় ${fmt(portfolio.totals.monthRevenueMinor)}, ROAS ${portfolio.totals.roas ?? "n/a"}`,
      "",
      "সংখ্যাগুলো আপনার অ্যাকাউন্টের আসল ডেটা থেকে তৈরি (Campaign-level Ad খরচ + বাতিল/ফেরত বাদে অর্ডার আয়)।",
    ];
    const sent = await this.email.send({
      to: user.email,
      subject: "সাপ্তাহিক পোর্টফোলিও ডাইজেস্ট — Qosprey AI Marketing",
      text: lines.join("\n"),
    });
    return { sent: true, messageId: (sent as any)?.providerMessageId ?? null, organizations: portfolio.organizations.length };
  }
}
