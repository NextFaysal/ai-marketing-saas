"use client";
import React from "react";
import Link from "next/link";
import { formatMinor } from "@repo/contracts";
import { EmptyState } from "@repo/ui";

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

const BAND_BADGE: Record<ChurnCustomer["band"], { text: string; cls: string }> = {
  high: { text: "বেশি", cls: "badge-red" },
  medium: { text: "মাঝারি", cls: "badge-amber" },
  low: { text: "কম", cls: "badge-green" },
  unknown: { text: "তথ্য নেই", cls: "badge-slate" },
};

function fmtPercent(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${v}%`;
}

function fmtMoneyMinor(v: string | null | undefined): string {
  return v === null || v === undefined ? "—" : formatMinor(BigInt(v));
}

export default function CohortsPage() {
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
        setError("কোনো Organization নির্বাচিত নেই।");
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
        <h1 className="page-title">📊 Cohort ও গ্রাহক ধরে রাখা (Retention)</h1>
        <p className="mt-1 text-sm text-slate-500">
          সব সংখ্যা এই দোকানের আসল অর্ডার থেকে হিসাব করা (বাতিল/রিফান্ড/ব্যর্থ অর্ডার বাদ)।
        </p>
        {cohorts ? (
          <p className="mt-1 text-xs text-slate-400">
            Revenue থেকে বাদ দেওয়া অর্ডারের অবস্থা:{" "}
            {cohorts.revenueExcludedStatuses.length > 0
              ? cohorts.revenueExcludedStatuses.join(", ")
              : "—"}
            {" · "}বিবেচিত অর্ডার {cohorts.ordersConsidered}টি · গ্রাহক ছাড়া অর্ডার{" "}
            {cohorts.ordersWithoutCustomer}টি · মোট গ্রাহক {cohorts.totalCustomers} জন
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-500">লোড হচ্ছে...</p>
      ) : cohorts ? (
        <>
          {cohorts.hasData === false ? (
            <div className="card p-4">
              <EmptyState
                title="এখনো পর্যাপ্ত ডেটা নেই — গ্রাহকদের অর্ডার এলেই এখানে Cohort বিশ্লেষণ দেখা যাবে।"
                description="অর্ডার আসার পর Cohort, Retention ও Historical LTV এখানে স্বয়ংক্রিয়ভাবে তৈরি হবে। কোনো ভুয়া বা শূন্য সংখ্যার টেবিল দেখানো হচ্ছে না।"
              />
            </div>
          ) : (
            <>
              <div className="space-y-3">
                <div>
                  <h2 className="font-semibold">Retention Matrix</h2>
                  <p className="mt-1 text-xs text-slate-400">
                    মাস ০ = প্রথম কেনার মাস। প্রতিটি সারি একটি Cohort (প্রথম কেনার মাস), প্রতিটি ঘর ওই মাসে আবার কেনা গ্রাহকের শতাংশ।
                  </p>
                </div>
                <div className="overflow-hidden card">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-4 py-3">Cohort</th>
                          <th className="px-4 py-3">আকার</th>
                          <th className="px-4 py-3">মোট Revenue</th>
                          {monthIndexes.map((m) => (
                            <th key={m} className="px-4 py-3">মাস {m}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {cohorts.cohorts.map((row) => (
                          <tr key={row.cohort} className="border-t">
                            <td className="px-4 py-3 font-medium">{row.cohort}</td>
                            <td className="px-4 py-3">{row.size} জন</td>
                            <td className="px-4 py-3">{formatMinor(BigInt(row.totalRevenueMinor))}</td>
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
                    Historical LTV — Cohort-এর প্রতি গ্রাহকের গড় মোট কেনা (ক্রমপুঞ্জিত)।
                  </p>
                </div>
                <div className="overflow-hidden card">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-4 py-3">Cohort</th>
                          <th className="px-4 py-3">আকার</th>
                          {monthIndexes.map((m) => (
                            <th key={m} className="px-4 py-3">মাস {m}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {cohorts.cohorts.map((row) => (
                          <tr key={row.cohort} className="border-t">
                            <td className="px-4 py-3 font-medium">{row.cohort}</td>
                            <td className="px-4 py-3">{row.size} জন</td>
                            {monthIndexes.map((m) => (
                              <td key={m} className="px-4 py-3">
                                {fmtMoneyMinor(row.cumulativeLtvMinor[m] ?? null)}
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
              <h2 className="font-semibold">Churn ঝুঁকি</h2>

              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                {churn.label}
              </div>
              <p className="text-xs text-slate-500">{churn.rule}</p>
              {churn.orgMedianGapDays !== null ? (
                <p className="text-xs text-slate-400">
                  দোকানের মধ্যম ব্যবধান: {churn.orgMedianGapDays} দিন
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2 text-sm">
                <span className="badge-red">বেশি ঝুঁকি {churn.summary.high}</span>
                <span className="badge-amber">মাঝারি {churn.summary.medium}</span>
                <span className="badge-green">কম {churn.summary.low}</span>
                <span className="badge-slate">তথ্য নেই {churn.summary.unknown}</span>
              </div>

              {churn.customers.length === 0 ? (
                <div className="card p-4 text-sm text-slate-500">
                  এখনো কোনো গ্রাহকের Churn ঝুঁকি হিসাব করার মতো ডেটা নেই।
                </div>
              ) : (
                <div className="overflow-hidden card">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-4 py-3">গ্রাহক</th>
                          <th className="px-4 py-3">অর্ডার সংখ্যা</th>
                          <th className="px-4 py-3">শেষ অর্ডার</th>
                          <th className="px-4 py-3">ব্যবধানের রেফারেন্স</th>
                          <th className="px-4 py-3">অনুপাত</th>
                          <th className="px-4 py-3">ঝুঁকি</th>
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
                              <td className="px-4 py-3">{c.orders}</td>
                              <td className="px-4 py-3">
                                {c.lastOrderAt
                                  ? new Date(c.lastOrderAt).toLocaleDateString()
                                  : "—"}
                                {c.daysSinceLastOrder !== null &&
                                c.daysSinceLastOrder !== undefined
                                  ? ` · ${c.daysSinceLastOrder} দিন আগে`
                                  : ""}
                              </td>
                              <td className="px-4 py-3">
                                {c.referenceGapDays === null ||
                                c.referenceSource === null
                                  ? "—"
                                  : `${c.referenceGapDays} দিন · ${
                                      c.referenceSource === "own"
                                        ? "নিজের ব্যবধান"
                                        : "দোকানের গড় ব্যবধান"
                                    }`}
                              </td>
                              <td className="px-4 py-3">
                                {c.ratio === null ? "—" : c.ratio}
                              </td>
                              <td className="px-4 py-3">
                                <span className={badge.cls}>{badge.text}</span>
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
                এটি শুধু দেখার সংকেত — এই স্কোর দিয়ে কোনো স্বয়ংক্রিয় কাজ হয় না।
              </p>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
