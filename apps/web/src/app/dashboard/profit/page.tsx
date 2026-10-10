"use client";
import React from "react";
import { formatMinor } from "@repo/contracts";
import { KpiCard } from "@repo/ui";
import { useOverview, DailyBars } from "@/components/analytics-shared";

export default function ProfitPage() {
  const { data, error, loading } = useOverview();
  if (loading) return <p className="text-sm text-slate-500">লোড হচ্ছে...</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return null;
  const p = data.profit;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Profit Intelligence</h1>
        <p className="text-sm text-slate-500">{data.range.from} থেকে {data.range.to}। শুধু Revenue দেখলে লাভ বোঝা যায় না, Refund, প্রোডাক্ট কস্ট (COGS) ও Ad Spend বাদ দিয়ে আসল চিত্র এখানে।</p>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <KpiCard label="Contribution Profit" value={formatMinor(BigInt(p.contributionProfitMinor))} hint={`Margin ${p.contributionMarginPercent === null ? "—" : p.contributionMarginPercent + "%"}`} />
        <KpiCard label="COGS Coverage" value={`${p.cogsCoverage.percent}%`} hint={`${p.cogsCoverage.ordersWithFullCost}/${p.cogsCoverage.ordersTotal} অর্ডারের পূর্ণ কস্ট জানা`} />
        <KpiCard label="Refund" value={formatMinor(BigInt(p.refundedMinor))} hint="ডেলিভারি ব্যর্থ ও রিটার্নসহ" />
      </div>
      {p.cogsCoverage.percent < 100 ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
          সতর্কতা: {100 - p.cogsCoverage.percent}% অর্ডারের প্রোডাক্ট কস্ট জানা নেই, তাই Contribution Profit আসলের চেয়ে বেশি দেখাতে পারে।
          Products পেজে প্রতিটি প্রোডাক্টের কস্ট দিন, তাহলে এই সংখ্যা বিশ্বাসযোগ্য হবে।
        </p>
      ) : null}
      <DailyBars data={data} />
      <p className="text-xs text-slate-400">{p.note}</p>
    </div>
  );
}
