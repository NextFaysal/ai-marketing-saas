"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import {
  COURIER_PROVIDERS,
  POPULAR_DISTRICTS_DATA,
  CourierProvider,
  recommendBestCourier,
  calculateRtoLoss,
  DistrictSlaMetric,
} from "@/lib/courier-analytics";

export default function CourierAnalyticsPage() {
  // District search & filter
  const [searchDistrict, setSearchDistrict] = useState("");
  const [selectedZone, setSelectedZone] = useState<string>("all");

  // Smart dispatch recommendation interactive state
  const [destAddress, setDestAddress] = useState("Dhanmondi, Dhaka");
  const [parcelWeight, setParcelWeight] = useState(500);
  const [priority, setPriority] = useState<"speed" | "cost" | "safety">("speed");

  // RTO Loss Calculator state
  const [monthlyShipments, setMonthlyShipments] = useState(600);
  const [returnRate, setReturnRate] = useState(12);
  const [outboundCharge, setOutboundCharge] = useState(120);
  const [returnFee, setReturnFee] = useState(60);

  // Filtered district table
  const filteredDistricts = useMemo(() => {
    return POPULAR_DISTRICTS_DATA.filter((d) => {
      const matchSearch =
        d.district.toLowerCase().includes(searchDistrict.toLowerCase()) ||
        d.zoneNameBangla.includes(searchDistrict);
      const matchZone = selectedZone === "all" || d.zone === selectedZone;
      return matchSearch && matchZone;
    });
  }, [searchDistrict, selectedZone]);

  // Live recommendation
  const recommendation = useMemo(() => {
    return recommendBestCourier(destAddress, parcelWeight, 1500, priority);
  }, [destAddress, parcelWeight, priority]);

  // Live RTO loss calculation
  const rtoReport = useMemo(() => {
    return calculateRtoLoss({
      totalShipments: monthlyShipments,
      returnRatePct: returnRate,
      outboundShippingTaka: outboundCharge,
      returnFeeTaka: returnFee,
      packagingLossTaka: 30,
    });
  }, [monthlyShipments, returnRate, outboundCharge, returnFee]);

  return (
    <div className="space-y-6">
      {/* Top Header & Breadcrumb */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="page-title">🚚 কুরিয়ার পারফরম্যান্স ও জেলাভিত্তিক SLA অ্যানালিটিক্স</h1>
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
              AI ডিসপ্যাচ হাব
            </span>
          </div>
          <p className="text-xs text-slate-500">
            পাঠাও, স্টিডফাস্ট ও রেডেক্সের জেলাভিত্তিক ডেলিভারি সাকসেস রেট, দ্রুততম ট্র্যাকিং এবং আরটিও (RTO) লস প্রিভেনশন
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/orders"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm"
          >
            ← অর্ডার লিস্ট
          </Link>
          <Link
            href="/dashboard/order-notifications"
            className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
          >
            🔔 কুরিয়ার SMS নোটিফিকেশন
          </Link>
        </div>
      </div>

      {/* Courier Partners Comparison Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Object.values(COURIER_PROVIDERS).map((cp) => (
          <div key={cp.provider} className="card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">{cp.logo}</span>
                <span className="font-bold text-sm text-slate-900">{cp.nameBangla}</span>
              </div>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                {cp.overallSuccessRate}% সাকসেস
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs border-t border-slate-100 pt-2">
              <div>
                <span className="text-slate-400 block text-[10px]">ঢাকা মেট্রো চার্জ:</span>
                <span className="font-bold text-slate-800">৳{cp.dhakaChargeTaka}</span>
                <span className="text-[10px] text-slate-400 block">({cp.avgSlaDaysDhaka} দিন)</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">ঢাকার বাইরে চার্জ:</span>
                <span className="font-bold text-slate-800">৳{cp.outsideDhakaChargeTaka}</span>
                <span className="text-[10px] text-slate-400 block">({cp.avgSlaDaysOutside} দিন)</span>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-[11px]">
              <span className="text-slate-500">গড় রিটার্ন (RTO):</span>
              <span className={`font-bold ${cp.rtoRate <= 10 ? "text-emerald-700" : "text-amber-700"}`}>
                {cp.rtoRate}%
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Main Grid: Smart Dispatch Recommender & RTO Loss Calculator */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Smart Dispatch Recommendation Assistant */}
        <div className="card space-y-4">
          <div className="flex items-center gap-2 border-b pb-3">
            <span className="text-xl">🎯</span>
            <div>
              <h3 className="text-sm font-bold text-slate-900">স্মার্ট কুরিয়ার ডিসপ্যাচ রেকমেন্ডার</h3>
              <p className="text-xs text-slate-500">গ্রাহকের ঠিকানা ও ওজন অনুযায়ী সেরা কুরিয়ার স্বয়ংক্রিয়ভাবে নির্বাচন করুন</p>
            </div>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="block font-semibold text-slate-700">ডেলিভারি জেলা / ঠিকানা লিখুন</label>
              <input
                type="text"
                value={destAddress}
                onChange={(e) => setDestAddress(e.target.value)}
                placeholder="যেমন: Dhanmondi, Dhaka বা Chittagong GEC"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700">পার্সেলের ওজন</label>
                <select
                  value={parcelWeight}
                  onChange={(e) => setParcelWeight(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold"
                >
                  <option value={500}>৫০০ গ্রাম পর্যন্ত</option>
                  <option value={1000}>১ কেজি</option>
                  <option value={2000}>২ কেজি</option>
                  <option value={3000}>৩ কেজি+</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700">অগ্রাধিকার</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as any)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold"
                >
                  <option value="speed">দ্রুততম ডেলিভারি (Speed)</option>
                  <option value="cost">সাশ্রয়ী খরচ (Cost)</option>
                  <option value="safety">সর্বোচ্চ সাকসেস রেট (Safety)</option>
                </select>
              </div>
            </div>

            {/* Recommendation Result Card */}
            <div className="rounded-2xl border-2 border-indigo-500 bg-gradient-to-b from-indigo-50/60 to-white p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">
                    এআই সুপারিশকৃত সেরা কুরিয়ার
                  </span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xl">
                      {COURIER_PROVIDERS[recommendation.recommendedProvider].logo}
                    </span>
                    <span className="text-base font-extrabold text-slate-900">
                      {recommendation.providerNameBangla}
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-[10px] text-slate-500">আনুমানিক চার্জ</span>
                  <div className="text-base font-black text-indigo-700">৳{recommendation.estimatedCostTaka}</div>
                </div>
              </div>

              <p className="text-xs text-slate-700 leading-relaxed font-medium">
                💡 {recommendation.reasonBangla}
              </p>

              <div className="grid grid-cols-2 gap-2 border-t border-indigo-100 pt-2 text-[11px]">
                <div>
                  <span className="text-slate-400">ডেলিভারি সময়: </span>
                  <span className="font-bold text-slate-800">{recommendation.estimatedDeliveryDays}</span>
                </div>
                <div>
                  <span className="text-slate-400">প্রত্যাশিত সাকসেস: </span>
                  <span className="font-bold text-emerald-700">{recommendation.successRateExpected}%</span>
                </div>
              </div>

              <div className="rounded-lg bg-white/80 p-2 text-[10px] text-slate-600 border border-slate-200">
                <strong>বিকল্প কুরিয়ার: </strong>
                {COURIER_PROVIDERS[recommendation.alternativeProvider].nameBangla} — {recommendation.alternativeReasonBangla}
              </div>
            </div>
          </div>
        </div>

        {/* RTO Financial Loss & Margin Shield Calculator */}
        <div className="card space-y-4">
          <div className="flex items-center gap-2 border-b pb-3">
            <span className="text-xl">🛡️</span>
            <div>
              <h3 className="text-sm font-bold text-slate-900">আরটিও (RTO) আর্থিক ক্ষতি ও মার্জিন ক্যালকুলেটর</h3>
              <p className="text-xs text-slate-500">ব্যর্থ ডেলিভারির ফলে অপচয় হওয়া ডেলিভারি ফি ও সম্ভাব্য সাশ্রয় হিসাব করুন</p>
            </div>
          </div>

          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700">মাসিক মোট শিপমেন্ট সংখ্যা</label>
                <input
                  type="number"
                  min="1"
                  value={monthlyShipments}
                  onChange={(e) => setMonthlyShipments(Math.max(1, Number(e.target.value) || 1))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 font-bold"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700">বর্তমান রিটার্ন হার (RTO %)</label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="range"
                    min="2"
                    max="30"
                    value={returnRate}
                    onChange={(e) => setReturnRate(Number(e.target.value))}
                    className="w-full accent-indigo-600"
                  />
                  <span className="w-12 text-right font-black text-rose-600">{returnRate}%</span>
                </div>
              </div>
            </div>

            {/* Financial Loss Metrics */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3">
                <span className="text-[10px] font-bold text-rose-800 uppercase">মাসিক মোট আর্থিক ক্ষতি</span>
                <div className="text-xl font-black text-rose-700 mt-1">
                  ৳{rtoReport.totalNetLossTaka.toLocaleString("en-IN")}
                </div>
                <p className="text-[10px] text-rose-600 mt-0.5">
                  {rtoReport.returnedOrdersCount}টি ফেরত আসা পার্সেলের ক্ষতি
                </p>
              </div>

              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                <span className="text-[10px] font-bold text-emerald-800 uppercase">অগ্রিম চার্জ নিলে সাশ্রয়</span>
                <div className="text-xl font-black text-emerald-700 mt-1">
                  ৳{rtoReport.savingsWithAdvanceChargeTaka.toLocaleString("en-IN")}
                </div>
                <p className="text-[10px] text-emerald-600 mt-0.5">মাসিক নেট প্রফিট বৃদ্ধি পাবে</p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-600">আউটবাউন্ড ডেলিভারি খরচ অপচয়:</span>
                <span className="font-bold text-slate-800">৳{rtoReport.shippingLossTaka.toLocaleString("en-IN")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">কুরিয়ারের রিটার্ন হ্যান্ডলিং চার্জ (৫০%):</span>
                <span className="font-bold text-slate-800">৳{rtoReport.returnFeeLossTaka.toLocaleString("en-IN")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">নষ্ট হওয়া প্যাকেজিং ম্যাটেরিয়াল বাবদ:</span>
                <span className="font-bold text-slate-800">৳{rtoReport.packagingLossTaka.toLocaleString("en-IN")}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1.5 font-bold">
                <span>প্রতি সফল অর্ডারে অপচয়ের প্রভাব:</span>
                <span className="text-rose-600">+৳{rtoReport.lossPerSuccessfulOrderTaka} / অর্ডার</span>
              </div>
            </div>

            <div className="rounded-lg bg-indigo-50 p-2.5 text-xs text-indigo-900 border border-indigo-200">
              {rtoReport.recommendationBangla}
            </div>
          </div>
        </div>
      </div>

      {/* District Delivery SLA Matrix Table */}
      <div className="card space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">📊 জেলাভিত্তিক ডেলিভারি SLA ও সাকসেস মেট্রিক্স</h3>
            <p className="text-xs text-slate-500">বাংলাদেশের প্রধান শহর ও অঞ্চলভিত্তিক কুরিয়ার ডেলিভারি পারফরম্যান্স</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedZone}
              onChange={(e) => setSelectedZone(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700"
            >
              <option value="all">সব জোন</option>
              <option value="dhaka_metro">ঢাকা মেট্রো</option>
              <option value="dhaka_suburb">ঢাকা উপশহর</option>
              <option value="divisional_city">বিভাগীয় শহর</option>
              <option value="remote_district">পার্বত্য ও প্রত্যন্ত</option>
            </select>
            <input
              type="text"
              placeholder="জেলা বা জোন খুঁজুন..."
              value={searchDistrict}
              onChange={(e) => setSearchDistrict(e.target.value)}
              className="input w-48 text-xs"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b bg-slate-50 font-semibold text-slate-600">
              <tr>
                <th className="py-2.5 px-3">জেলা / অঞ্চল</th>
                <th className="py-2.5 px-3">লজিস্টিকস জোন</th>
                <th className="py-2.5 px-3">সেরা কুরিয়ার পার্টনার</th>
                <th className="py-2.5 px-3">গড় ডেলিভারি সময়</th>
                <th className="py-2.5 px-3">ডেলিভারি সাকসেস হার</th>
                <th className="py-2.5 px-3">রিটার্ন (RTO) হার</th>
                <th className="py-2.5 px-3 text-right">গড় শিপিং চার্জ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredDistricts.map((d) => {
                const cp = COURIER_PROVIDERS[d.bestCourier];
                return (
                  <tr key={d.district} className="hover:bg-slate-50/70 transition">
                    <td className="py-3 px-3 font-bold text-slate-900">{d.district}</td>
                    <td className="py-3 px-3">
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
                        {d.zoneNameBangla}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1.5">
                        <span>{cp.logo}</span>
                        <span className="font-semibold text-slate-800">{cp.nameBangla}</span>
                      </div>
                    </td>
                    <td className="py-3 px-3 font-semibold text-slate-700">{d.avgDeliveryHours} ঘণ্টা</td>
                    <td className="py-3 px-3">
                      <span className="rounded bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800">
                        {d.deliverySuccessRate}%
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <span className="rounded bg-rose-100 px-2 py-0.5 font-bold text-rose-800">
                        {d.rtoRate}%
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-black text-slate-900">
                      ৳{d.avgShippingCostTaka}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
