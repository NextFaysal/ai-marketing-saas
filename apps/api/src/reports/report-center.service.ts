import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Reports Advanced RP1 — the Report Center payload: one
 * place that lists every report the product offers,
 * the org's own recent AI reports and active share
 * links, its report jobs, and how fresh the underlying
 * data is. Freshness comes from real rows only — a
 * source that has never synced says so (null), it is
 * never backdated or guessed.
 */
export const REPORT_CATALOG = [
  { key: "analytics", title: "Analytics Overview", route: "/dashboard/analytics", description: "Revenue, orders, ad spend, profit ও platform KPIs" },
  { key: "cohorts", title: "Cohorts ও Churn Risk", route: "/dashboard/analytics/cohorts", description: "কোন মাসের customer কতটা ধরে রেখেছেন, কারা ঝুঁকিতে" },
  { key: "ai-reports", title: "AI Reports", route: "/dashboard/reports", description: "Daily/weekly/monthly AI report, recommendation ও anomaly" },
  { key: "builder", title: "Custom Report Builder", route: "/dashboard/reports/builder", description: "নিজের Metric × Dimension দিয়ে রিপোর্ট বানিয়ে সেভ করুন" },
  { key: "attribution", title: "Attribution", route: "/dashboard/attribution", description: "কোন touchpoint বিক্রিতে কতটা ভূমিকা রাখল" },
  { key: "funnel", title: "Lead Funnel", route: "/dashboard/leads", description: "Source অনুযায়ী lead conversion" },
  { key: "products", title: "Product Sales", route: "/dashboard/products", description: "Product ও variant অনুযায়ী বিক্রি" },
  { key: "courier", title: "Courier Performance", route: "/dashboard/orders", description: "Courier অনুযায়ী success ও return হার" },
  { key: "campaigns", title: "Campaign Performance", route: "/dashboard/campaign-builder", description: "Plan-ভিত্তিক spend, CPA, ROAS" },
  { key: "portfolio", title: "Agency Portfolio", route: "/dashboard/portfolio", description: "সব client org-এর একত্রিত চিত্র" },
  { key: "profit", title: "Profit", route: "/dashboard/profit", description: "Contribution profit-এর বিস্তারিত ভাঙন" },
] as const;

const REPORT_JOB_TYPES = ["daily_report", "weekly_ads_report", "monthly_report", "saved_report_delivery"];

@Injectable()
export class ReportCenterService {
  constructor(private readonly prisma: PrismaService) {}

  async center(organizationId: string) {
    const p = this.prisma as any;
    const now = new Date();
    const [aiReports, shares, jobs, storeSync, latestAdMetric, latestOrder] = await Promise.all([
      p.aIReport.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 5,
        select: { id: true, type: true, title: true, periodStart: true, periodEnd: true, createdAt: true, provider: true } }),
      p.reportShare.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 20,
        select: { id: true, title: true, days: true, expiresAt: true, createdAt: true } }),
      p.scheduledJob.findMany({ where: { organizationId, type: { in: REPORT_JOB_TYPES } }, orderBy: { createdAt: "desc" },
        select: { id: true, name: true, type: true, enabled: true, lastRunAt: true, nextRunAt: true, lastStatus: true } }).catch(() => []),
      p.integration.findMany({ where: { organizationId, provider: { in: ["woocommerce", "shopify"] } },
        select: { provider: true, lastSyncAt: true, status: true } }),
      p.dailyAdMetric.findFirst({ where: { organizationId }, orderBy: { date: "desc" }, select: { date: true } }).catch(() => null),
      p.order.findFirst({ where: { organizationId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }).catch(() => null),
    ]);
    const activeShares = (shares ?? []).filter((s: any) => new Date(s.expiresAt) > now);
    const storeLastSync = (storeSync ?? []).reduce((max: number, i: any) => Math.max(max, i.lastSyncAt ? new Date(i.lastSyncAt).getTime() : 0), 0);
    return {
      catalog: REPORT_CATALOG,
      aiReports: aiReports ?? [],
      shares: { activeCount: activeShares.length, recent: (shares ?? []).slice(0, 5) },
      jobs: jobs ?? [],
      freshness: {
        storeLastSyncAt: storeLastSync ? new Date(storeLastSync).toISOString() : null,
        storeIntegrations: storeSync ?? [],
        latestAdMetricDate: latestAdMetric?.date ? new Date(latestAdMetric.date).toISOString() : null,
        latestOrderAt: latestOrder?.createdAt ? new Date(latestOrder.createdAt).toISOString() : null,
      },
    };
  }
}
