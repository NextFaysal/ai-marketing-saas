import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { REVENUE_EXCLUDED_STATUSES } from "./analytics.service";
import {
  CHURN_RULE_TEXT,
  buildCohortReport,
  computeChurn,
  type RevenueOrderFact,
} from "./cohorts";

@Injectable()
export class CohortService {
  constructor(private readonly prisma: PrismaService) {}

  private async revenueOrders(orgId: string): Promise<any[]> {
    const orders = await (this.prisma as any).order.findMany({
      where: { organizationId: orgId },
      take: 20000,
    });
    return (orders ?? []).filter(
      (o: any) => !REVENUE_EXCLUDED_STATUSES.includes(o.status),
    );
  }

  async cohorts(orgId: string) {
    const revenue = await this.revenueOrders(orgId);
    const facts: RevenueOrderFact[] = revenue
      .filter((o: any) => o.customerId)
      .map((o: any) => ({
        customerId: o.customerId as string,
        at: new Date(o.placedAt ?? o.createdAt),
        totalMinor: BigInt(o.totalMinor),
      }));
    const report = buildCohortReport(facts);
    return {
      revenueExcludedStatuses: REVENUE_EXCLUDED_STATUSES,
      hasData: report.totalCustomers > 0,
      ordersConsidered: revenue.length,
      ordersWithoutCustomer: revenue.length - facts.length,
      totalCustomers: report.totalCustomers,
      maxMonthIndex: report.maxMonthIndex,
      cohorts: report.cohorts,
    };
  }

  async churnRisk(orgId: string) {
    const revenue = await this.revenueOrders(orgId);

    // Group revenue order dates by customerId.
    const datesByCustomer = new Map<string, Date[]>();
    for (const o of revenue) {
      if (!o.customerId) continue;
      const list = datesByCustomer.get(o.customerId) ?? [];
      list.push(new Date(o.placedAt ?? o.createdAt));
      datesByCustomer.set(o.customerId, list);
    }
    const inputs = [...datesByCustomer.entries()].map(([customerId, dates]) => ({
      customerId,
      dates,
    }));

    const customers = await (this.prisma as any).customer.findMany({
      where: { organizationId: orgId, mergedIntoId: null },
      take: 5000,
    });
    const nameById = new Map<string, string>();
    for (const c of customers ?? []) {
      const name =
        [c.firstName, c.lastName].filter(Boolean).join(" ") || "Customer";
      nameById.set(c.id, name);
    }

    const result = computeChurn(inputs, new Date());

    const summary = { low: 0, medium: 0, high: 0, unknown: 0 };
    for (const r of result.rows) {
      summary[r.band]++;
    }

    const severity: Record<string, number> = {
      high: 0,
      medium: 1,
      low: 2,
      unknown: 3,
    };
    const enriched = result.rows.map((r) => ({
      ...r,
      name: nameById.get(r.customerId) ?? "Customer",
    }));
    enriched.sort((a, b) => {
      const sev = severity[a.band] - severity[b.band];
      if (sev !== 0) return sev;
      if (a.ratio === null && b.ratio === null) return 0;
      if (a.ratio === null) return 1;
      if (b.ratio === null) return -1;
      return b.ratio - a.ratio;
    });

    return {
      heuristic: true,
      label: "আনুমানিক হিসাব (heuristic) — মেশিন লার্নিং নয়",
      rule: CHURN_RULE_TEXT,
      orgMedianGapDays: result.orgMedianGapDays,
      summary,
      customers: enriched.slice(0, 200),
    };
  }
}
