"use client";

import React, { useState, useMemo } from "react";
import { fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
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
  const { dict, t, locale } = useLocale();
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
    return recommendBestCourier(destAddress, parcelWeight, 1500, priority, locale);
  }, [destAddress, parcelWeight, priority, locale]);

  // Live RTO loss calculation
  const rtoReport = useMemo(() => {
    return calculateRtoLoss({
      totalShipments: monthlyShipments,
      returnRatePct: returnRate,
      outboundShippingTaka: outboundCharge,
      returnFeeTaka: returnFee,
      packagingLossTaka: 30,
      locale,
    });
  }, [monthlyShipments, returnRate, outboundCharge, returnFee, locale]);

  return (
    <div className="space-y-6">
      {/* Top Header & Breadcrumb */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="page-title">{dict.orders.courierPerformanceDistrictWiseSLA}</h1>
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
              {dict.orders.aIDispatchHub}</span>
          </div>
          <p className="text-xs text-slate-500">
            {dict.orders.districtWiseDeliverySuccessRates}</p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/orders"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm"
          >
            {dict.orders.orderList2}</Link>
          <Link
            href="/dashboard/order-notifications"
            className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
          >
            {dict.orders.courierSMSNotification}</Link>
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
                {cp.overallSuccessRate}{dict.orders.success}</span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs border-t border-slate-100 pt-2">
              <div>
                <span className="text-slate-400 block text-[10px]">{dict.orders.dhakaMetroCharge}</span>
                <span className="font-bold text-slate-800">{dict.orders.text1yr}{cp.dhakaChargeTaka}</span>
                <span className="text-[10px] text-slate-400 block">({cp.avgSlaDaysDhaka} {dict.orders.days}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">{dict.orders.outsideDhakaCharge}</span>
                <span className="font-bold text-slate-800">{dict.orders.text1yr}{cp.outsideDhakaChargeTaka}</span>
                <span className="text-[10px] text-slate-400 block">({cp.avgSlaDaysOutside} {dict.orders.days}</span>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-[11px]">
              <span className="text-slate-500">{dict.orders.averageReturnRTO}</span>
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
              <h3 className="text-sm font-bold text-slate-900">{dict.orders.smartCourierDispatchRecommender}</h3>
              <p className="text-xs text-slate-500">{dict.orders.automaticallySelectTheBestCourier}</p>
            </div>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="block font-semibold text-slate-700">{dict.orders.enterTheDeliveryDistrictAddress}</label>
              <input
                type="text"
                value={destAddress}
                onChange={(e) => setDestAddress(e.target.value)}
                placeholder={dict.orders.eGDhanmondiDhakaOr}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700">{dict.orders.parcelWeight}</label>
                <select
                  value={parcelWeight}
                  onChange={(e) => setParcelWeight(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold"
                >
                  <option value={500}>{dict.orders.upTo500Grams}</option>
                  <option value={1000}>{dict.orders.text1ti00i6}</option>
                  <option value={2000}>{dict.orders.text1tz1mwd}</option>
                  <option value={3000}>{dict.orders.text1yzngtb}</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700">{dict.orders.priority}</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as any)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold"
                >
                  <option value="speed">{dict.orders.fastestDeliverySpeed}</option>
                  <option value="cost">{dict.orders.lowestCostCost}</option>
                  <option value="safety">{dict.orders.highestSuccessRateSafety}</option>
                </select>
              </div>
            </div>

            {/* Recommendation Result Card */}
            <div className="rounded-2xl border-2 border-indigo-500 bg-gradient-to-b from-indigo-50/60 to-white p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">
                    {dict.orders.aIRecommendedBestCourier}</span>
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
                  <span className="text-[10px] text-slate-500">{dict.orders.estimatedCharge2}</span>
                  <div className="text-base font-black text-indigo-700">{dict.orders.text1yr}{recommendation.estimatedCostTaka}</div>
                </div>
              </div>

              <p className="text-xs text-slate-700 leading-relaxed font-medium">
                💡 {recommendation.reasonBangla}
              </p>

              <div className="grid grid-cols-2 gap-2 border-t border-indigo-100 pt-2 text-[11px]">
                <div>
                  <span className="text-slate-400">{dict.orders.deliveryTime}</span>
                  <span className="font-bold text-slate-800">{recommendation.estimatedDeliveryDays}</span>
                </div>
                <div>
                  <span className="text-slate-400">{dict.orders.expectedSuccess}</span>
                  <span className="font-bold text-emerald-700">{recommendation.successRateExpected}%</span>
                </div>
              </div>

              <div className="rounded-lg bg-white/80 p-2 text-[10px] text-slate-600 border border-slate-200">
                <strong>{dict.orders.alternativeCouriers}</strong>
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
              <h3 className="text-sm font-bold text-slate-900">{dict.orders.rTOFinancialLossMarginCalculator}</h3>
              <p className="text-xs text-slate-500">{dict.orders.calculateDeliveryFeesWastedFrom}</p>
            </div>
          </div>

          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700">{dict.orders.monthlyTotalShipments}</label>
                <input
                  type="number"
                  min="1"
                  value={monthlyShipments}
                  onChange={(e) => setMonthlyShipments(Math.max(1, Number(e.target.value) || 1))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 font-bold"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700">{dict.orders.currentReturnRateRTO}</label>
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
                <span className="text-[10px] font-bold text-rose-800 uppercase">{dict.orders.monthlyTotalFinancialLoss}</span>
                <div className="text-xl font-black text-rose-700 mt-1">
                  {dict.orders.text1yr}{fmtNumber(locale, rtoReport.totalNetLossTaka)}
                </div>
                <p className="text-[10px] text-rose-600 mt-0.5">
                  {rtoReport.returnedOrdersCount}{dict.orders.lossFromReturnedParcels}</p>
              </div>

              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                <span className="text-[10px] font-bold text-emerald-800 uppercase">{dict.orders.savingsIfAdvanceChargeIs}</span>
                <div className="text-xl font-black text-emerald-700 mt-1">
                  {dict.orders.text1yr}{fmtNumber(locale, rtoReport.savingsWithAdvanceChargeTaka)}
                </div>
                <p className="text-[10px] text-emerald-600 mt-0.5">{dict.orders.monthlyNetProfitWillIncrease}</p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-600">{dict.orders.outboundDeliveryCostWaste}</span>
                <span className="font-bold text-slate-800">{dict.orders.text1yr}{fmtNumber(locale, rtoReport.shippingLossTaka)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">{dict.orders.courierReturnHandlingCharge50}</span>
                <span className="font-bold text-slate-800">{dict.orders.text1yr}{fmtNumber(locale, rtoReport.returnFeeLossTaka)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">{dict.orders.forDamagedPackagingMaterial}</span>
                <span className="font-bold text-slate-800">{dict.orders.text1yr}{fmtNumber(locale, rtoReport.packagingLossTaka)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1.5 font-bold">
                <span>{dict.orders.wasteImpactPerSuccessfulOrder}</span>
                <span className="text-rose-600">{dict.orders.text2zs}{rtoReport.lossPerSuccessfulOrderTaka} {dict.orders.order4}</span>
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
            <h3 className="text-sm font-bold text-slate-900">{dict.orders.districtWiseDeliverySLASuccess}</h3>
            <p className="text-xs text-slate-500">{dict.orders.courierDeliveryPerformanceForBangladesh}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedZone}
              onChange={(e) => setSelectedZone(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700"
            >
              <option value="all">{dict.orders.allZones}</option>
              <option value="dhaka_metro">{dict.orders.dhakaMetro}</option>
              <option value="dhaka_suburb">{dict.orders.dhakaSuburb}</option>
              <option value="divisional_city">{dict.orders.divisionalCities}</option>
              <option value="remote_district">{dict.orders.hillyRemote}</option>
            </select>
            <input
              type="text"
              placeholder={dict.orders.searchDistrictOrZone}
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
                <th className="py-2.5 px-3">{dict.orders.districtRegion}</th>
                <th className="py-2.5 px-3">{dict.orders.logisticsZone}</th>
                <th className="py-2.5 px-3">{dict.orders.bestCourierPartner}</th>
                <th className="py-2.5 px-3">{dict.orders.averageDeliveryTime}</th>
                <th className="py-2.5 px-3">{dict.orders.deliverySuccessRate}</th>
                <th className="py-2.5 px-3">{dict.orders.returnRTORate}</th>
                <th className="py-2.5 px-3 text-right">{dict.orders.averageShippingCharge}</th>
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
                    <td className="py-3 px-3 font-semibold text-slate-700">{d.avgDeliveryHours} {dict.orders.hours}</td>
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
                      {dict.orders.text1yr}{d.avgShippingCostTaka}
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
