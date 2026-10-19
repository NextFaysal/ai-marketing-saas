"use client";
import React from "react";
import Link from "next/link";
import { fmtDate, fmtMoneyMinor, fmtNumber } from "@repo/contracts";
import { EmptyState } from "@repo/ui";
import { useLocale } from "@/lib/i18n/provider";

interface CohortRow {
  cohort: string;
  size: number;
  totalRevenueMinor: string;
  retentionPercent: (number | null)[];
  cumulativeLtvMinor: (string | null)[];
}

interface CohortsData {
  revenueExcludedStatuses: string[];
  hasData: boolean;
  ordersConsidered: number;
  ordersWithoutCustomer: number;
  totalCustomers: number;
  maxMonthIndex: number;
  cohorts: CohortRow[];
}

interface ChurnCustomer {
  customerId: string;
  name: string;
  orders: number;
  lastOrderAt: string | null;
  daysSinceLastOrder: number | null;
  referenceGapDays: number | null;
  referenceSource: "own" | "org" | null;
  ratio: number | null;
  band: "low" | "medium" | "high" | "unknown";
}

interface ChurnData {
  heuristic: true;
  label: string;
  rule: string;
  orgMedianGapDays: number | null;
  summary: { low: number; medium: number; high: number; unknown: number };
  customers: ChurnCustomer[];
}

const BAND_BADGE: Record<ChurnCustomer["band"], { textKey: string; cls: string }> = {
  high: { textKey: "analytics.cohRiskHigh", cls: "badge-red" },
  medium: { textKey: "analytics.cohRiskMedium", cls: "badge-amber" },
  low: { textKey: "analytics.cohRiskLow", cls: "badge-green" },
  unknown: { textKey: "analytics.cohRiskUnknown", cls: "badge-slate" },
};

function fmtPercent(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${v}%`;
}

function moneyMinor(locale: "bn" | "en", v: string | null | undefined): string {
  return v === null || v === undefined ? "—" : fmtMoneyMinor(locale, BigInt(v));
}

export default function CohortsPage() {
  const { t, locale } = useLocale();
  const [cohorts, setCohorts] = React.useState<CohortsData | null>(null);
  const [churn, setChurn] = React.useState<ChurnData | null>(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    (async () => {
      const { apiFetch } = await import("@/lib/api");
      const { getOrganizationId } = await import("@/lib/org");
      const orgId = getOrganizationId();
      if (!orgId) {
        setError(t("analytics.reportsNoOrg"));
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const [cohortRes, churnRes] = await Promise.all([
          apiFetch<CohortsData>(`/organizations/${orgId}/analytics/cohorts`),
          apiFetch<ChurnData>(`/organizations/${orgId}/analytics/churn-risk`),
        ]);
        setCohorts(cohortRes);
        setChurn(churnRes);
        setError("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const monthIndexes = cohorts
    ? Array.from({ length: cohorts.maxMonthIndex + 1 }, (_, i) => i)
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("analytics.cohTitle")}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {t("analytics.cohIntro")}
        </p>
        {cohorts ? (
          <p className="mt-1 text-xs text-slate-400">
            {t("analytics.cohExcludedStatuses")}{" "}
            {cohorts.revenueExcludedStatuses.length > 0
              ? cohorts.revenueExcludedStatuses.join(", ")
              : "—"}
            {" · "}{t("analytics.cohOrdersMeta", { considered: fmtNumber(locale, cohorts.ordersConsidered), without: fmtNumber(locale, cohorts.ordersWithoutCustomer), total: fmtNumber(locale, cohorts.totalCustomers) })}
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-500">{t("analytics.cohLoading")}</p>
      ) : cohorts ? (
        <>
          {cohorts.hasData === false ? (
            <div className="card p-4">
              <EmptyState
                title={t("analytics.cohEmptyTitle")}
                description={t("analytics.cohEmptyDesc")}
              />
            </div>
          ) : (
            <>
              <div className="space-y-3">
                <div>
                  <h2 className="font-semibold">Retention Matrix</h2>
                  <p className="mt-1 text-xs text-slate-400">
                    {t("analytics.cohRetentionNote")}
                  </p>
                </div>
                <div className="overflow-hidden card">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-4 py-3">Cohort</th>
                          <th className="px-4 py-3">{t("analytics.cohColSize")}</th>
                          <th className="px-4 py-3">{t("analytics.cohColRevenue")}</th>
                          {monthIndexes.map((m) => (
                            <th key={m} className="px-4 py-3">{t("analytics.cohColMonth", { month: fmtNumber(locale, m) })}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {cohorts.cohorts.map((row) => (
                          <tr key={row.cohort} className="border-t">
                            <td className="px-4 py-3 font-medium">{row.cohort}</td>
                            <td className="px-4 py-3">{t("analytics.cohSizePeople", { count: fmtNumber(locale, row.size) })}</td>
                            <td className="px-4 py-3">{fmtMoneyMinor(locale, BigInt(row.totalRevenueMinor))}</td>
                            {monthIndexes.map((m) => {
                              const v = row.retentionPercent[m] ?? null;
                              return (
                                <td
                                  key={m}
                                  className="px-4 py-3"
                                  style={
                                    v === null
                                      ? undefined
                                      : {
                                          backgroundColor: `rgba(16,185,129,${Math.max(0, Math.min(1, v / 100))})`,
                                          color: v >= 55 ? "#ffffff" : "#0f172a",
                                          fontWeight: 600,
                                        }
                                  }
                                >
                                  {fmtPercent(v)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <h2 className="font-semibold">Historical LTV</h2>
                  <p className="mt-1 text-xs text-slate-400">
                    {t("analytics.cohLtvNote")}
                  </p>
                </div>
                <div className="overflow-hidden card">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-4 py-3">Cohort</th>
                          <th className="px-4 py-3">{t("analytics.cohColSize")}</th>
                          {monthIndexes.map((m) => (
                            <th key={m} className="px-4 py-3">{t("analytics.cohColMonth", { month: fmtNumber(locale, m) })}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {cohorts.cohorts.map((row) => (
                          <tr key={row.cohort} className="border-t">
                            <td className="px-4 py-3 font-medium">{row.cohort}</td>
                            <td className="px-4 py-3">{t("analytics.cohSizePeople", { count: fmtNumber(locale, row.size) })}</td>
                            {monthIndexes.map((m) => (
                              <td key={m} className="px-4 py-3">
                                {moneyMinor(locale, row.cumulativeLtvMinor[m] ?? null)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>
          )}

          {churn ? (
            <div className="space-y-4">
              <h2 className="font-semibold">{t("analytics.cohChurnTitle")}</h2>

              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                {churn.label}
              </div>
              <p className="text-xs text-slate-500">{churn.rule}</p>
              {churn.orgMedianGapDays !== null ? (
                <p className="text-xs text-slate-400">
                  {t("analytics.cohMedianGap", { days: fmtNumber(locale, churn.orgMedianGapDays) })}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2 text-sm">
                <span className="badge-red">{t("analytics.cohSummaryHigh", { count: fmtNumber(locale, churn.summary.high) })}</span>
                <span className="badge-amber">{t("analytics.cohSummaryMedium", { count: fmtNumber(locale, churn.summary.medium) })}</span>
                <span className="badge-green">{t("analytics.cohSummaryLow", { count: fmtNumber(locale, churn.summary.low) })}</span>
                <span className="badge-slate">{t("analytics.cohSummaryUnknown", { count: fmtNumber(locale, churn.summary.unknown) })}</span>
              </div>

              {churn.customers.length === 0 ? (
                <div className="card p-4 text-sm text-slate-500">
                  {t("analytics.cohChurnEmpty")}
                </div>
              ) : (
                <div className="overflow-hidden card">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-4 py-3">{t("analytics.cohColCustomer")}</th>
                          <th className="px-4 py-3">{t("analytics.cohColOrders")}</th>
                          <th className="px-4 py-3">{t("analytics.cohColLastOrder")}</th>
                          <th className="px-4 py-3">{t("analytics.cohColGapRef")}</th>
                          <th className="px-4 py-3">{t("analytics.cohColRatio")}</th>
                          <th className="px-4 py-3">{t("analytics.cohColRisk")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {churn.customers.map((c) => {
                          const badge = BAND_BADGE[c.band] ?? BAND_BADGE.unknown;
                          return (
                            <tr key={c.customerId} className="border-t">
                              <td className="px-4 py-3 font-medium">
                                <Link
                                  href="/dashboard/customers"
                                  className="text-indigo-600 hover:underline"
                                >
                                  {c.name}
                                </Link>
                              </td>
                              <td className="px-4 py-3">{fmtNumber(locale, c.orders)}</td>
                              <td className="px-4 py-3">
                                {c.lastOrderAt
                                  ? fmtDate(locale, c.lastOrderAt)
                                  : "—"}
                                {c.daysSinceLastOrder !== null &&
                                c.daysSinceLastOrder !== undefined
                                  ? t("analytics.cohDaysAgo", { days: fmtNumber(locale, c.daysSinceLastOrder) })
                                  : ""}
                              </td>
                              <td className="px-4 py-3">
                                {c.referenceGapDays === null ||
                                c.referenceSource === null
                                  ? "—"
                                  : t("analytics.cohGapValue", { days: fmtNumber(locale, c.referenceGapDays), source: c.referenceSource === "own" ? t("analytics.cohGapOwn") : t("analytics.cohGapOrg") })}
                              </td>
                              <td className="px-4 py-3">
                                {c.ratio === null ? "—" : c.ratio}
                              </td>
                              <td className="px-4 py-3">
                                <span className={badge.cls}>{t(badge.textKey)}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <p className="text-xs text-slate-400">
                {t("analytics.cohFootnote")}
              </p>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
