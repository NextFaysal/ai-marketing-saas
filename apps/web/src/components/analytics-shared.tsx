"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinor } from "@repo/contracts";

export interface Overview {
  range: { from: string; to: string };
  totals: { orders: number; revenueMinor: string; refundedMinor: string; averageOrderValueMinor: string; adSpendMinor: string; impressions: number; clicks: number; platformConversions: number; platformConversionValueMinor: string };
  kpis: { ctrPercent: number | null; cpcMinor: number | null; cpmMinor: number | null; cpaMinor: number | null; platformRoas: number | null; mer: number | null; costPerOrderMinor: number | null };
  profit: { revenueMinor: string; refundedMinor: string; cogsMinor: string; adSpendMinor: string; contributionProfitMinor: string; contributionMarginPercent: number | null; cogsCoverage: { ordersWithFullCost: number; ordersTotal: number; percent: number }; note: string };
  platforms: { platform: string; spendMinor: string; impressions: number; clicks: number; platformConversions: number; platformRoas: number | null }[];
  campaigns: { platform: string; source: string; campaignName: string | null; campaignExternalId: string; spendMinor: string; impressions: number; clicks: number; platformConversions: number; platformConversionValueMinor: string; ctrPercent: number | null; cpaMinor: number | null; platformRoas: number | null }[];
  dailySeries: { date: string; orders: number; revenueMinor: string; spendMinor: string }[];
  mixedCurrencies: boolean;
  currencies: string[];
}

export function last30(): { from: string; to: string } {
  const to = new Date(); const from = new Date(Date.now() - 29 * 86400000);
  const f = (d: Date) => d.toISOString().slice(0, 10);
  return { from: f(from), to: f(to) };
}

export function useOverview() {
  const [range, setRange] = useState(last30());
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await apiFetch<Overview>(`/organizations/${orgId}/analytics/overview?from=${range.from}&to=${range.to}`);
      setData(res); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setLoading(false); }
  }, [range]);
  useEffect(() => { load(); }, [load]);
  return { range, setRange, data, error, loading };
}

export function DailyBars({ data }: { data: Overview }) {
  const max = Math.max(1, ...data.dailySeries.map((d) => Math.max(Number(BigInt(d.revenueMinor)), Number(BigInt(d.spendMinor)))));
  if (data.dailySeries.length === 0) return null;
  return (
    <div className="card p-5">
      <div className="font-semibold">দৈনিক Revenue বনাম Ad Spend</div>
      <div className="mt-1 text-xs text-slate-400">সবুজ: Revenue · লাল: Spend</div>
      <div className="mt-4 flex h-36 items-end gap-1 overflow-x-auto">
        {data.dailySeries.map((d) => (
          <div key={d.date} className="flex min-w-4 flex-1 flex-col items-center gap-1" title={`${d.date} · অর্ডার ${d.orders} · Revenue ${formatMinor(BigInt(d.revenueMinor))} · Spend ${formatMinor(BigInt(d.spendMinor))}`}>
            <div className="flex items-end gap-0.5">
              <div className="w-2 rounded-t bg-green-500" style={{ height: `${Math.max(2, (Number(BigInt(d.revenueMinor)) / max) * 120)}px` }} />
              <div className="w-2 rounded-t bg-red-400" style={{ height: `${Math.max(2, (Number(BigInt(d.spendMinor)) / max) * 120)}px` }} />
            </div>
            <div className="text-[9px] text-slate-400">{d.date.slice(5)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

