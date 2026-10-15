"use client";
import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { formatMinor } from "@repo/contracts";
import { API_URL } from "@/lib/api";
import { mediaSrc } from "@/lib/media-src";

interface Report {
  kind?: string;
  title: string; business: string; generatedAt: string; days: number;
  branding?: { name: string; logoUrl: string | null; primaryColor: string | null };
  delivery?: { shipments: number; delivered: number; returned: number; returnRatePercent: number | null };
  totals: { orders: number; revenueMinor: string; adSpendMinor: string; impressions: number; clicks: number; platformConversions: number };
  kpis: { mer: number | null; platformRoas: number | null; ctrPercent: number | null; cpcMinor: number | null; cpaMinor: number | null };
  campaigns: { name: string; platform: string; spendMinor: string; clicks: number; ctrPercent: number | null; platformConversions: number; cpaMinor: number | null; platformRoas: number | null }[];
  // RP6 executive kind
  range?: { from: string; to: string };
  sales?: { orders: number; revenueMinor: string; refundedMinor: string; averageOrderValueMinor: string };
  ads?: { spendMinor: string; impressions: number; clicks: number; platformConversions: number; mer: number | null; platformRoas: number | null; topCampaigns: { name: string; spendMinor: string; conversions: number; cpaMinor: string | null }[] };
  customers?: { newInRange: number; withOrders: number; segments: Record<string, number> };
  operations?: { ordersByStatus: Record<string, number>; topProducts: { name: string; quantity: number; totalMinor: string }[] };
  // Frontier NB8 / CN18: campaign kind — an allowlisted
  // payload (totals / per-ad-set / breakdowns / pacing).
  plan?: { name: string; objective: string };
  published?: boolean;
  perAdSet?: { name: string; spendMinor: string; impressions: number; clicks: number; conversions: number }[];
  breakdowns?: Record<string, { hasData: boolean; rows: { key: string; spendMinor: string; impressions: number; clicks: number; conversions: number; ctrPercent: number | null; cpaMinor: string | null }[] }>;
  pacing?: { status: string; budgetMode: string | null; currency: string | null; spentMinor: string; expectedMinor: string | null; varianceMinor: string | null; daysElapsed: number | null; daysTotal: number | null; label: string } | null;
  note: string;
}

interface CampaignTotals {
  spendMinor: string; impressions: number; clicks: number; conversions: number; reach: number;
  ctrPercent: number | null; cpmMinor: string | null; cpaMinor: string | null;
  firstPartyRevenueMinor: string; firstPartyOrders: number; roas: number | null;
}

export default function PublicReportPage() {
  const params = useParams();
  const token = String(params.token ?? "");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/public/reports/${token}`);
        if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.message ?? "Report unavailable"); }
        setReport(await res.json());
      } catch (e) { setError(e instanceof Error ? e.message : "Report unavailable"); }
    })();
  }, [token]);
  const money = (v: string) => formatMinor(BigInt(v));
  const accent = report?.branding?.primaryColor ?? undefined;
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        {/* Milestone 59: white-label header — the agency's own logo
            + brand name lead; the legal business name stays as the
            small line so the report's owner is never ambiguous. */}
        {report?.branding?.logoUrl ? (
          <img src={mediaSrc(API_URL, report.branding.logoUrl) ?? ""} alt="" className="h-14 w-14 rounded-2xl border bg-white object-contain p-1" />
        ) : null}
        <p className="mt-2 text-xs uppercase tracking-wide" style={accent ? { color: accent } : undefined}>
          {report?.branding?.name ?? report?.business ?? "Campaign Report"}
        </p>
        <h1 className="mt-1 text-2xl font-bold">{report?.title ?? "Campaign Report"}</h1>
        {report ? <p className="text-sm text-slate-500">শেষ {report.days} দিন · তৈরি: {new Date(report.generatedAt).toLocaleString()}</p> : null}
      </header>
      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">এই রিপোর্ট লিংকটি পাওয়া যায়নি বা মেয়াদ শেষ হয়ে গেছে। ({error})</div> : null}
      {!report && !error ? <p className="text-sm text-slate-500">লোড হচ্ছে...</p> : null}
      {report?.kind === "executive" && report.sales && report.ads ? (<>
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["Revenue", money(report.sales.revenueMinor)],
            ["Orders", String(report.sales.orders)],
            ["AOV", money(report.sales.averageOrderValueMinor)],
            ["Refunds", money(report.sales.refundedMinor)],
            ["Ad Spend", money(report.ads.spendMinor)],
            ["MER", report.ads.mer === null ? "—" : String(report.ads.mer)],
            ["Platform ROAS", report.ads.platformRoas === null ? "—" : String(report.ads.platformRoas)],
            ["নতুন Customer", String(report.customers?.newInRange ?? 0)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border bg-white p-4">
              <div className="text-xs text-slate-400">{label}</div>
              <div className="mt-1 text-lg font-bold" style={accent ? { color: accent } : undefined}>{value}</div>
            </div>
          ))}
        </section>
        {report.ads.topCampaigns.length > 0 ? (
          <section className="overflow-hidden rounded-xl border bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500"><tr><th className="px-4 py-3">Top Campaign</th><th className="px-4 py-3">Spend</th><th className="px-4 py-3">Conv.</th><th className="px-4 py-3">CPA</th></tr></thead>
              <tbody>{report.ads.topCampaigns.map((c, i) => (
                <tr key={i} className="border-t"><td className="px-4 py-3 font-medium">{c.name}</td><td className="px-4 py-3">{money(c.spendMinor)}</td><td className="px-4 py-3">{c.conversions}</td><td className="px-4 py-3">{c.cpaMinor === null ? "—" : money(c.cpaMinor)}</td></tr>
              ))}</tbody>
            </table>
          </section>
        ) : null}
        {report.operations && report.operations.topProducts.length > 0 ? (
          <section className="overflow-hidden rounded-xl border bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500"><tr><th className="px-4 py-3">Top Product</th><th className="px-4 py-3">পরিমাণ</th><th className="px-4 py-3">বিক্রি</th></tr></thead>
              <tbody>{report.operations.topProducts.map((p, i) => (
                <tr key={i} className="border-t"><td className="px-4 py-3 font-medium">{p.name}</td><td className="px-4 py-3">{p.quantity}</td><td className="px-4 py-3">{money(p.totalMinor)}</td></tr>
              ))}</tbody>
            </table>
          </section>
        ) : null}
        <p className="text-xs text-slate-400">{report.note}</p>
      </>) : null}
      {report?.kind === "campaign" ? (() => {
        const ct = report.totals as unknown as CampaignTotals | null;
        return (<>
          <p className="text-sm text-slate-500">Campaign: <b>{report.plan?.name}</b> · Objective: {report.plan?.objective}</p>
          {!report.published || !ct ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">এই Campaign-এর কোনো সিঙ্ক হওয়া Performance Data এখনো নেই।</p> : (<>
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                ["Ad Spend", money(ct.spendMinor)],
                ["Impressions", ct.impressions.toLocaleString()],
                ["Clicks", ct.clicks.toLocaleString()],
                ["CTR", ct.ctrPercent === null ? "—" : `${ct.ctrPercent}%`],
                ["Conversions (Platform)", String(ct.conversions)],
                ["CPA", ct.cpaMinor === null ? "—" : money(ct.cpaMinor)],
                ["নিজস্ব অর্ডার (Associated)", String(ct.firstPartyOrders)],
                ["Revenue (Associated)", money(ct.firstPartyRevenueMinor)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border bg-white p-4">
                  <div className="text-xs text-slate-400">{label}</div>
                  <div className="mt-1 text-lg font-bold" style={accent ? { color: accent } : undefined}>{value}</div>
                </div>
              ))}
            </section>
            {report.perAdSet && report.perAdSet.length ? (
              <section className="overflow-hidden rounded-xl border bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500"><tr><th className="px-4 py-3">Ad Set</th><th className="px-4 py-3">Spend</th><th className="px-4 py-3">Impressions</th><th className="px-4 py-3">Clicks</th><th className="px-4 py-3">Conv.</th></tr></thead>
                  <tbody>{report.perAdSet.map((s, i) => (
                    <tr key={i} className="border-t"><td className="px-4 py-3 font-medium">{s.name}</td><td className="px-4 py-3">{money(s.spendMinor)}</td><td className="px-4 py-3">{s.impressions.toLocaleString()}</td><td className="px-4 py-3">{s.clicks.toLocaleString()}</td><td className="px-4 py-3">{s.conversions}</td></tr>
                  ))}</tbody>
                </table>
              </section>
            ) : null}
            {report.breakdowns ? Object.entries(report.breakdowns).map(([dim, d]) => (
              <section key={dim}>
                <h2 className="mb-2 text-sm font-bold capitalize text-slate-700">{dim.replace("_", " / ")}</h2>
                {d.hasData ? (
                  <div className="overflow-hidden rounded-xl border bg-white">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-slate-500"><tr><th className="px-4 py-3">Segment</th><th className="px-4 py-3">Spend</th><th className="px-4 py-3">Clicks</th><th className="px-4 py-3">CTR</th><th className="px-4 py-3">Conv.</th><th className="px-4 py-3">CPA</th></tr></thead>
                      <tbody>{d.rows.map((r, i) => (
                        <tr key={i} className="border-t"><td className="px-4 py-3 font-medium">{r.key}</td><td className="px-4 py-3">{money(r.spendMinor)}</td><td className="px-4 py-3">{r.clicks.toLocaleString()}</td><td className="px-4 py-3">{r.ctrPercent === null ? "—" : `${r.ctrPercent}%`}</td><td className="px-4 py-3">{r.conversions}</td><td className="px-4 py-3">{r.cpaMinor === null ? "—" : money(r.cpaMinor)}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                ) : <p className="text-xs text-slate-400">এই ভাগে কোনো Data নেই।</p>}
              </section>
            )) : null}
            {report.pacing ? <p className="text-xs text-slate-500">Pacing ({report.pacing.label}): অবস্থা {report.pacing.status} · খরচ হয়েছে {money(report.pacing.spentMinor)}{report.pacing.expectedMinor ? ` · এই সময়ে প্রত্যাশিত ${money(report.pacing.expectedMinor)}` : ""}{report.pacing.daysElapsed !== null ? ` · দিন ${report.pacing.daysElapsed}${report.pacing.daysTotal ? `/${report.pacing.daysTotal}` : ""}` : ""}</p> : null}
          </>)}
          <p className="text-xs text-slate-400">{report.note}</p>
        </>);
      })() : null}
      {report && report.kind !== "executive" && report.kind !== "campaign" ? (<>
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["Revenue", money(report.totals.revenueMinor)],
            ["Ad Spend", money(report.totals.adSpendMinor)],
            ["Orders", String(report.totals.orders)],
            ["MER", report.kpis.mer === null ? "—" : String(report.kpis.mer)],
            ["Platform ROAS", report.kpis.platformRoas === null ? "—" : String(report.kpis.platformRoas)],
            ["CTR", report.kpis.ctrPercent === null ? "—" : `${report.kpis.ctrPercent}%`],
            ["CPA (Platform)", report.kpis.cpaMinor === null ? "—" : money(String(Math.round(report.kpis.cpaMinor)))],
            ["Platform Conversions", String(report.totals.platformConversions)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border bg-white p-4">
              <div className="text-xs text-slate-400">{label}</div>
              <div className="mt-1 text-lg font-bold" style={accent ? { color: accent } : undefined}>{value}</div>
            </div>
          ))}
        </section>
        {report.delivery ? (
          <section>
            <h2 className="mb-2 text-sm font-bold text-slate-700">🚚 ডেলিভারি সারসংক্ষেপ (এই সময়ে)</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                ["মোট পার্সেল পাঠানো হয়েছে", String(report.delivery.shipments)],
                ["ডেলিভারি হয়েছে", String(report.delivery.delivered)],
                ["রিটার্ন এসেছে", String(report.delivery.returned)],
                ["রিটার্ন হার", report.delivery.returnRatePercent === null ? "—" : `${report.delivery.returnRatePercent}%`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border bg-white p-4">
                  <div className="text-xs text-slate-400">{label}</div>
                  <div className="mt-1 text-lg font-bold" style={accent ? { color: accent } : undefined}>{value}</div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        <section className="overflow-hidden rounded-xl border bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500"><tr><th className="px-4 py-3">Campaign</th><th className="px-4 py-3">Spend</th><th className="px-4 py-3">Clicks</th><th className="px-4 py-3">CTR</th><th className="px-4 py-3">Conv.</th><th className="px-4 py-3">ROAS</th></tr></thead>
            <tbody>{report.campaigns.map((c, i) => (
              <tr key={i} className="border-t"><td className="px-4 py-3 font-medium">{c.name}</td><td className="px-4 py-3">{money(c.spendMinor)}</td><td className="px-4 py-3">{c.clicks.toLocaleString()}</td><td className="px-4 py-3">{c.ctrPercent === null ? "—" : `${c.ctrPercent}%`}</td><td className="px-4 py-3">{c.platformConversions}</td><td className="px-4 py-3">{c.platformRoas === null ? "—" : c.platformRoas}</td></tr>
            ))}</tbody>
          </table>
        </section>
        <p className="text-xs text-slate-400">{report.note}</p>
      </>) : null}
    </main>
  );
}
