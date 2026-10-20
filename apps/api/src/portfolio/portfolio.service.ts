import { Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EmailProvider } from "../messaging/email.provider";
import { orgFlagEnabled } from "../common/feature-flags";
import { badRequest } from "../i18n/api-exception";

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
    // OU1 honesty fixes (verified in the Step-0 audit):
    // (1) Only ACTIVE memberships count — the same filter
    // OrganizationsService.listMine applies. A SUSPENDED (or
    // still-INVITED) membership must not leak its org into the
    // portfolio rollup.
    // (2) Money is grouped PER CURRENCY and never summed across
    // currencies — the product has no FX conversion anywhere
    // (see ads/spend-watch.ts: "currencies are never mixed"), so
    // a single mixed total would be a wrong number. The grouped
    // shape mirrors the CN8 campaign-portfolio `totalByCurrency`
    // convention. Counts that are currency-neutral (orders,
    // platform conversions) stay as plain totals.
    const memberships = await (this.prisma as any).membership.findMany({ where: { userId, status: "ACTIVE" } });
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const orgs: any[] = [];
    let totalOrders = 0; let totalConv = 0n;
    const byCurrency = new Map<string, { spend: bigint; revenue: bigint }>();
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
      const currency = org.currency ?? "BDT";
      totalOrders += orderCount; totalConv += conv;
      const group = byCurrency.get(currency) ?? { spend: 0n, revenue: 0n };
      group.spend += spend; group.revenue += revenue;
      byCurrency.set(currency, group);
      orgs.push({
        organizationId: org.id, name: org.name, role: m.role, currency,
        monthSpendMinor: spend.toString(), monthRevenueMinor: revenue.toString(),
        monthOrders: orderCount, platformConversions: Number(conv),
        roas: spend > 0n ? Math.round(Number(revenue) / Number(spend) * 100) / 100 : null,
        publishedPlans: plans,
      });
    }
    orgs.sort((a, b) => Number(BigInt(b.monthSpendMinor) - BigInt(a.monthSpendMinor)));
    const totalsByCurrency = [...byCurrency.entries()]
      .map(([currency, g]) => ({
        currency,
        monthSpendMinor: g.spend.toString(), monthRevenueMinor: g.revenue.toString(),
        roas: g.spend > 0n ? Math.round(Number(g.revenue) / Number(g.spend) * 100) / 100 : null,
      }))
      .sort((a, b) => Number(BigInt(b.monthSpendMinor) - BigInt(a.monthSpendMinor)));
    return {
      organizations: orgs,
      totalsByCurrency,
      totals: {
        monthOrders: totalOrders, platformConversions: Number(totalConv),
      },
    };
  }

  async sendWeeklyDigest(userId: string) {
    if (!this.email) throw badRequest("portfolio.emailIsNotConfiguredInThis");
    const user = await (this.prisma as any).user.findFirst({ where: { id: userId } });
    if (!user?.email) throw badRequest("portfolio.userEmailNotFound");
    const portfolio = await this.portfolioForUser(userId);
    const fmt = (minor: string, currency: string) => `${currency} ${(Number(BigInt(minor)) / 100).toLocaleString("en-US")}`;
    const lines = [
      "সাপ্তাহিক পোর্টফোলিও ডাইজেস্ট — এই মাসের অবস্থা (month-to-date)",
      "",
      ...portfolio.organizations.map((o: any) =>
        `• ${o.name}: খরচ ${fmt(o.monthSpendMinor, o.currency)}, আয় ${fmt(o.monthRevenueMinor, o.currency)}, অর্ডার ${o.monthOrders}, কনভার্সন ${o.platformConversions}, ROAS ${o.roas ?? "n/a"}, Published Plan ${o.publishedPlans}`),
      "",
      // Totals are stated per currency — currencies are never
      // mixed into one sum (there is no FX conversion).
      ...portfolio.totalsByCurrency.map((t: any) =>
        `মোট (${t.currency}): খরচ ${fmt(t.monthSpendMinor, t.currency)}, আয় ${fmt(t.monthRevenueMinor, t.currency)}, ROAS ${t.roas ?? "n/a"}`),
      `মোট অর্ডার ${portfolio.totals.monthOrders}, মোট কনভার্সন ${portfolio.totals.platformConversions}`,
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
