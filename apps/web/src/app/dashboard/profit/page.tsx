"use client";
import React, { useState } from "react";
import Link from "next/link";
import { formatMinor } from "@repo/contracts";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { useOverview, DailyBars } from "@/components/analytics-shared";
import {
  computeProfitWaterfall,
  computeUnitEconomics,
  getDateRangePreset,
  type DatePresetKey,
} from "@/lib/profit-intelligence";

export default function ProfitPage() {
  const { range, setRange, data, error, loading } = useOverview();
  const [activePreset, setActivePreset] = useState<DatePresetKey>("last30");
  const [recomputing, setRecomputing] = useState(false);
  const [actionNotice, setActionNotice] = useState("");

  const applyPreset = (key: DatePresetKey) => {
    setActivePreset(key);
    const p = getDateRangePreset(key);
    setRange({ from: p.from, to: p.to });
  };

  const handleRecompute = async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setRecomputing(true);
    setActionNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/analytics/recompute`, {
        method: "POST",
        body: JSON.stringify({ from: range.from, to: range.to }),
      });
      setActionNotice("অ্যাগ্রিগেট ডেটা সফলভাবে রিক্যালকুলেট ও রিফ্রেশ করা হয়েছে!");
      // Trigger reload
      setRange({ ...range });
    } catch (e) {
      setActionNotice(e instanceof Error ? e.message : "রিক্যালকুলেট সম্পন্ন হয়নি");
    } finally {
      setRecomputing(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
          <span>প্রফিট ইন্টেলিজেন্স লোড হচ্ছে...</span>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-xl bg-red-50 p-6 text-sm text-red-700 border border-red-200">
        <p className="font-bold">ডাটা লোড করতে সমস্যা হয়েছে:</p>
        <p className="mt-1">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const p = data.profit;
  const waterfall = computeProfitWaterfall(p);
  const unitEconomics = computeUnitEconomics(waterfall, data.totals.orders);

  // Proportional percentages for visual waterfall
  const grossRevNum = Number(waterfall.grossRevenue) || 1;
  const refundPct = Math.min(100, Math.round((Number(waterfall.refunded) / grossRevNum) * 100));
  const cogsPct = Math.min(100, Math.round((Number(waterfall.cogs) / grossRevNum) * 100));
  const spendPct = Math.min(100, Math.round((Number(waterfall.adSpend) / grossRevNum) * 100));
  const profitPct = Math.max(0, 100 - refundPct - cogsPct - spendPct);

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">প্রফিট ইন্টেলিজেন্স (Profit Intelligence)</h1>
            <span className="badge badge-brand font-bold">আসল নিট মুনাফা</span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            শুধু Revenue দেখে ব্যবসা চলে না — রিটার্ন, পণ্যের ক্রয়মূল্য (COGS) ও বিজ্ঞাপন খরচ বাদ দিয়ে ব্যবসার আসল নিট ক্যাশফ্লো।
          </p>
        </div>

        {/* Date Range & Recompute Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Presets */}
          <div className="flex rounded-xl bg-slate-100 p-1 text-xs font-semibold">
            {(
              [
                { id: "today", label: "আজকে" },
                { id: "last7", label: "৭ দিন" },
                { id: "last30", label: "৩০ দিন" },
                { id: "thisMonth", label: "চলতি মাস" },
                { id: "lastMonth", label: "গত মাস" },
              ] as const
            ).map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset.id)}
                className={`rounded-lg px-2.5 py-1.5 transition ${
                  activePreset === preset.id
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Recompute button */}
          <button
            type="button"
            className="btn-secondary btn-sm font-semibold flex items-center gap-1.5"
            disabled={recomputing}
            onClick={handleRecompute}
            title="সার্ভারে সমস্ত সাম্প্রতিক অর্ডার ও অ্যাড স্পেন্ড পুনরায় হিসাব করুন"
          >
            <span>{recomputing ? "হিসাব হচ্ছে..." : "🔄 রিক্যালকুলেট"}</span>
          </button>
        </div>
      </div>

      {/* Date Range Indicator & Action notice */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 bg-slate-50 px-4 py-2 rounded-xl border border-slate-200/80">
        <div>
          সময়কাল: <strong className="text-slate-800">{range.from}</strong> থেকে <strong className="text-slate-800">{range.to}</strong> (মোট {data.totals.orders}টি অর্ডার বিশ্লেষিত)
        </div>
        {actionNotice && (
          <span className="text-emerald-700 font-semibold">{actionNotice}</span>
        )}
      </div>

      {/* Primary KPI Cards Bar */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* KPI 1: Net Contribution Profit */}
        <div className={`card p-4 border-2 ${waterfall.isProfitable ? "border-emerald-200 bg-emerald-50/20" : "border-rose-200 bg-rose-50/20"}`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">নিট কন্ট্রিবিউশন লাভ</span>
            <span className="text-lg">{waterfall.isProfitable ? "🎉" : "⚠️"}</span>
          </div>
          <div className={`text-2xl font-bold mt-1 ${waterfall.isProfitable ? "text-emerald-700" : "text-rose-700"}`}>
            {formatMinor(waterfall.contributionProfit)}
          </div>
          <div className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
            <span>মার্জিন:</span>
            <strong className={`rounded px-1.5 py-0.2 font-mono ${waterfall.isProfitable ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
              {waterfall.contributionMarginPercent != null ? `${waterfall.contributionMarginPercent}%` : "—"}
            </strong>
          </div>
        </div>

        {/* KPI 2: Gross Revenue */}
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">মোট গ্রস রেভিনিউ</span>
            <span className="text-lg">💰</span>
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            {formatMinor(waterfall.grossRevenue)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {data.totals.orders} টি অর্ডারের মোট বিক্রয়
          </div>
        </div>

        {/* KPI 3: Total Ad Spend */}
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">বিজ্ঞাপন খরচ (Ad Spend)</span>
            <span className="text-lg">📢</span>
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            {formatMinor(waterfall.adSpend)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            রেভিনিউয়ের {unitEconomics.adSpendRatioPercent != null ? `${unitEconomics.adSpendRatioPercent}%` : "০%"} বিজ্ঞাপনে ব্যয়
          </div>
        </div>

        {/* KPI 4: COGS & Inventory Cost */}
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">পণ্য কেনা খরচ (COGS)</span>
            <span className="text-lg">📦</span>
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            {formatMinor(waterfall.cogs)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            রেভিনিউয়ের {unitEconomics.cogsRatioPercent != null ? `${unitEconomics.cogsRatioPercent}%` : "০%"} পণ্য তৈরি/ক্রয়
          </div>
        </div>
      </div>

      {/* COGS Coverage Warning if incomplete */}
      {p.cogsCoverage.percent < 100 && (
        <div className="card p-4 border-amber-200 bg-amber-50/70 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs text-amber-900">
          <div className="flex items-start gap-2">
            <span className="text-base">⚠️</span>
            <div>
              <strong className="font-bold">সতর্কতা: {100 - p.cogsCoverage.percent}% অর্ডারের পণ্যের ক্রয়মূল্য (COGS) ডাটাবেসে সেট করা নেই!</strong>
              <p className="text-amber-800 mt-0.5">
                মোট {p.cogsCoverage.ordersTotal} টির মধ্যে {p.cogsCoverage.ordersWithFullCost} টি অর্ডারের পূর্ণ কস্ট জানা আছে। বাকি পণ্যগুলোর কেনা দাম সেট করলে আপনার আসল লাভ নির্ভুল দেখা যাবে।
              </p>
            </div>
          </div>
          <Link
            href="/dashboard/products"
            className="btn-secondary btn-sm bg-white font-semibold self-start sm:self-center shrink-0 border-amber-300 hover:bg-amber-100"
          >
            পণ্যগুলোর COGS দিন →
          </Link>
        </div>
      )}

      {/* True Profit Waterfall Breakdown Card */}
      <div className="card p-5 sm:p-6 space-y-5">
        <div>
          <h2 className="text-lg font-bold text-slate-900">📊 True Profit Waterfall (মুনাফার পূর্ণ বিবরণ)</h2>
          <p className="text-xs text-slate-500">গ্রস সেলস থেকে প্রতিটি খরচের খাত বাদ দিয়ে অবশিষ্ট আসল নিট প্রফিট কিভাবে তৈরি হলো:</p>
        </div>

        {/* Step-by-Step Waterfall Row Cards */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {/* Step 1 */}
          <div className="rounded-xl bg-slate-50 p-3.5 border border-slate-200 space-y-1">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center justify-between">
              <span>১. গ্রস রেভিনিউ</span>
              <span className="text-emerald-600 font-mono">+100%</span>
            </div>
            <div className="text-lg font-bold text-slate-900 font-mono">
              {formatMinor(waterfall.grossRevenue)}
            </div>
            <div className="text-[11px] text-slate-400">সর্বমোট ইনভয়েস মূল্য</div>
          </div>

          {/* Step 2 */}
          <div className="rounded-xl bg-rose-50/50 p-3.5 border border-rose-100 space-y-1">
            <div className="text-[11px] font-bold text-rose-700 uppercase tracking-wider flex items-center justify-between">
              <span>২. বাদ: রিটার্ন ও রিফান্ড</span>
              <span className="text-rose-600 font-mono">-{refundPct}%</span>
            </div>
            <div className="text-lg font-bold text-rose-700 font-mono">
              - {formatMinor(waterfall.refunded)}
            </div>
            <div className="text-[11px] text-slate-400">রিটার্ন ও ক্যান্সেল হওয়া অর্ডার</div>
          </div>

          {/* Step 3 */}
          <div className="rounded-xl bg-amber-50/50 p-3.5 border border-amber-100 space-y-1">
            <div className="text-[11px] font-bold text-amber-800 uppercase tracking-wider flex items-center justify-between">
              <span>৩. বাদ: পণ্য ক্রয় (COGS)</span>
              <span className="text-amber-700 font-mono">-{cogsPct}%</span>
            </div>
            <div className="text-lg font-bold text-amber-800 font-mono">
              - {formatMinor(waterfall.cogs)}
            </div>
            <div className="text-[11px] text-slate-400">পণ্য কেনা বা ম্যানুফ্যাকচারিং কস্ট</div>
          </div>

          {/* Step 4 */}
          <div className="rounded-xl bg-indigo-50/50 p-3.5 border border-indigo-100 space-y-1">
            <div className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider flex items-center justify-between">
              <span>৪. বাদ: বিজ্ঞাপন খরচ</span>
              <span className="text-indigo-600 font-mono">-{spendPct}%</span>
            </div>
            <div className="text-lg font-bold text-indigo-700 font-mono">
              - {formatMinor(waterfall.adSpend)}
            </div>
            <div className="text-[11px] text-slate-400">মেটা ও গুগল বিজ্ঞাপনে খরচ</div>
          </div>

          {/* Step 5 */}
          <div className={`rounded-xl p-3.5 border space-y-1 ${waterfall.isProfitable ? "bg-emerald-100/40 border-emerald-300" : "bg-rose-100/40 border-rose-300"}`}>
            <div className="text-[11px] font-bold uppercase tracking-wider flex items-center justify-between">
              <span className={waterfall.isProfitable ? "text-emerald-900" : "text-rose-900"}>৫. নিট লাভ (Profit)</span>
              <span className={`font-mono font-bold ${waterfall.isProfitable ? "text-emerald-700" : "text-rose-700"}`}>
                {waterfall.contributionMarginPercent != null ? `${waterfall.contributionMarginPercent}%` : "—"}
              </span>
            </div>
            <div className={`text-lg font-bold font-mono ${waterfall.isProfitable ? "text-emerald-900" : "text-rose-900"}`}>
              = {formatMinor(waterfall.contributionProfit)}
            </div>
            <div className="text-[11px] text-slate-500">আপনার পকেটে থাকা আসল লাভ</div>
          </div>
        </div>

        {/* Visual Multi-Segment Waterfall Progress Bar */}
        <div className="space-y-1.5 pt-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-semibold text-slate-700">রেভিনিউয়ের খাতভিত্তিক বন্টন চিত্র:</span>
            <div className="flex flex-wrap items-center gap-3 text-[11px]">
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-rose-400" /> রিফান্ড ({refundPct}%)</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-400" /> COGS ({cogsPct}%)</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-indigo-500" /> অ্যাড স্পেন্ড ({spendPct}%)</span>
              <span className="flex items-center gap-1 font-bold text-emerald-800"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> নিট প্রফিট ({profitPct}%)</span>
            </div>
          </div>

          <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-slate-100 border border-slate-200">
            <div className="bg-rose-400 transition-all duration-300" style={{ width: `${refundPct}%` }} title={`Refunds: ${refundPct}%`} />
            <div className="bg-amber-400 transition-all duration-300" style={{ width: `${cogsPct}%` }} title={`COGS: ${cogsPct}%`} />
            <div className="bg-indigo-500 transition-all duration-300" style={{ width: `${spendPct}%` }} title={`Ad Spend: ${spendPct}%`} />
            <div className="bg-emerald-500 transition-all duration-300" style={{ width: `${profitPct}%` }} title={`Profit: ${profitPct}%`} />
          </div>
        </div>
      </div>

      {/* Unit Economics Section */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Metric 1 */}
        <div className="card p-4 space-y-1">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">গড় অর্ডার ভ্যালু (AOV)</span>
          <div className="text-xl font-bold text-slate-900 font-mono">
            {formatMinor(unitEconomics.averageOrderValue)}
          </div>
          <p className="text-[11px] text-slate-400">প্রতি অর্ডারে কাস্টমারের গড় খরচ</p>
        </div>

        {/* Metric 2 */}
        <div className="card p-4 space-y-1">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">প্রতি অর্ডারে গড় নিট লাভ</span>
          <div className={`text-xl font-bold font-mono ${unitEconomics.profitPerOrder > 0n ? "text-emerald-700" : "text-rose-700"}`}>
            {formatMinor(unitEconomics.profitPerOrder)}
          </div>
          <p className="text-[11px] text-slate-400">সব খরচ বাদ দিয়ে প্রতি অর্ডারে মুনাফা</p>
        </div>

        {/* Metric 3 */}
        <div className="card p-4 space-y-1">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">প্রতি অর্ডারে বিজ্ঞাপন ব্যয়</span>
          <div className="text-xl font-bold text-slate-900 font-mono">
            {formatMinor(unitEconomics.adSpendPerOrder)}
          </div>
          <p className="text-[11px] text-slate-400">একটি অর্ডার পেতে বিজ্ঞাপনী খরচ</p>
        </div>

        {/* Metric 4 */}
        <div className="card p-4 space-y-1">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">রিটার্ন লস রেশিও</span>
          <div className="text-xl font-bold text-slate-900 font-mono">
            {unitEconomics.returnLossRatePercent != null ? `${unitEconomics.returnLossRatePercent}%` : "০%"}
          </div>
          <p className="text-[11px] text-slate-400">রিটার্ন বা রিফান্ডে অপচয় হওয়া অনুপাত</p>
        </div>
      </div>

      {/* Campaign-Level Profitability & Efficiency Table */}
      {data.campaigns.length > 0 && (
        <div className="card p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-slate-900">🎯 ক্যাম্পেইন-ভিত্তিক লাভ ও পারফরম্যান্স টেবিল</h3>
              <p className="text-xs text-slate-500">কোন ক্যাম্পেইনে বিজ্ঞাপন চালিয়ে বেশি সেলস ও আরওএএস আসছে:</p>
            </div>
            <span className="badge badge-slate text-xs font-bold">{data.campaigns.length}টি সক্রিয় ক্যাম্পেইন</span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50 font-semibold text-slate-700">
                <tr>
                  <th className="px-4 py-3">ক্যাম্পেইনের নাম</th>
                  <th className="px-3 py-3">প্ল্যাটফর্ম</th>
                  <th className="px-3 py-3 text-right">খরচ (Spend)</th>
                  <th className="px-3 py-3 text-right">কনভার্সন ভ্যালু</th>
                  <th className="px-3 py-3 text-right">ROAS</th>
                  <th className="px-3 py-3 text-right">CPA</th>
                  <th className="px-3 py-3 text-center">স্ট্যাটাস</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {data.campaigns.slice(0, 15).map((c, i) => {
                  const roas = c.platformRoas;
                  const isHighProfit = roas != null && roas >= 3.0;
                  const isModerate = roas != null && roas >= 1.8 && roas < 3.0;
                  const isLow = roas != null && roas < 1.8;

                  return (
                    <tr key={i} className="hover:bg-slate-50 transition">
                      <td className="px-4 py-3 font-medium text-slate-900 max-w-xs truncate" title={c.campaignName ?? c.campaignExternalId}>
                        {c.campaignName ?? c.campaignExternalId}
                      </td>
                      <td className="px-3 py-3 capitalize text-slate-600">
                        <span className="badge badge-slate text-[10px]">{c.platform}</span>
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-slate-800">
                        {formatMinor(BigInt(c.spendMinor))}
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-medium text-slate-900">
                        {formatMinor(BigInt(c.platformConversionValueMinor))}
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-bold">
                        <span className={isHighProfit ? "text-emerald-700" : isModerate ? "text-amber-700" : "text-rose-700"}>
                          {roas != null ? `${roas}x` : "—"}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-slate-600">
                        {c.cpaMinor != null ? formatMinor(BigInt(c.cpaMinor)) : "—"}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            isHighProfit
                              ? "bg-emerald-100 text-emerald-800"
                              : isModerate
                                ? "bg-amber-100 text-amber-800"
                                : isLow
                                  ? "bg-rose-100 text-rose-800"
                                  : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {isHighProfit ? "লাভজনক" : isModerate ? "মাঝারি" : isLow ? "লস/সতর্ক" : "তথ্য নেই"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Daily Revenue vs Spend Trends */}
      <DailyBars data={data} />

      {/* Financial Footnote */}
      <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-400 border border-slate-100 space-y-1">
        <p>💡 <strong>অ্যাকাউন্টিং নোট:</strong> {p.note}</p>
        <p>Contribution Profit = Net Revenue (Gross Revenue - Refund) - COGS (পণ্য ক্রয়মূল্য) - Total Ad Spend। এটি ট্যাক্স ও ফিক্সড অফিস খরচের পূর্বের অপারেশনাল লাভ নির্দেশ করে।</p>
      </div>
    </div>
  );
}
