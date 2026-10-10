"use client";
import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { formatMinor } from "@repo/contracts";
import { API_URL } from "@/lib/api";

interface Report {
  title: string; business: string; generatedAt: string; days: number;
  totals: { orders: number; revenueMinor: string; adSpendMinor: string; impressions: number; clicks: number; platformConversions: number };
  kpis: { mer: number | null; platformRoas: number | null; ctrPercent: number | null; cpcMinor: number | null; cpaMinor: number | null };
  campaigns: { name: string; platform: string; spendMinor: string; clicks: number; ctrPercent: number | null; platformConversions: number; cpaMinor: number | null; platformRoas: number | null }[];
  note: string;
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
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <p className="text-xs uppercase tracking-wide text-slate-400">{report?.business ?? "Campaign Report"}</p>
        <h1 className="mt-1 text-2xl font-bold">{report?.title ?? "Campaign Report"}</h1>
        {report ? <p className="text-sm text-slate-500">শেষ {report.days} দিন · তৈরি: {new Date(report.generatedAt).toLocaleString()}</p> : null}
      </header>
      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">এই রিপোর্ট লিংকটি পাওয়া যায়নি বা মেয়াদ শেষ হয়ে গেছে। ({error})</div> : null}
      {!report && !error ? <p className="text-sm text-slate-500">লোড হচ্ছে...</p> : null}
      {report ? (<>
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
              <div className="mt-1 text-lg font-bold">{value}</div>
            </div>
          ))}
        </section>
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
