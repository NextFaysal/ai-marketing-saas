"use client";
import React, { useState, useEffect, useMemo } from "react";
import { fmtMoney } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import Link from "next/link";

interface InventoryItem {
  id: string;
  name: string;
  sku: string | null;
  imageUrl: string | null;
  priceMinor: string;
  stockQuantity: number | null;
  category: string | null;
  unitsSoldInWindow: number;
  dailyVelocity: number;
  runoutDays: number | null;
  status: "out_of_stock" | "critical" | "low" | "healthy" | "dead_stock" | "untracked";
  suggestedReorder: number;
  supplierMessage: string;
}

interface InventoryForecastSummary {
  totalProducts: number;
  outOfStockCount: number;
  criticalCount: number;
  lowStockCount: number;
  healthyCount: number;
  deadStockCount: number;
  totalStockValueMinor: string;
  potentialLostRevenueMinor: string;
  lookbackDays: number;
  targetCoverDays: number;
}

interface ForecastResponse {
  summary: InventoryForecastSummary;
  items: InventoryItem[];
}

// ML5 i18n: label/desc hold dictionary keys (dict.inventory.*),
// resolved at render so the active locale drives the copy.
const STATUS_CONFIG = {
  out_of_stock: {
    label: "outOfStock",
    badgeCls: "bg-red-100 text-red-800 border-red-300",
    icon: "🚨",
    desc: "text6g02d1",
  },
  critical: {
    label: "urgentStockAlert",
    badgeCls: "bg-amber-100 text-amber-800 border-amber-300",
    icon: "⚠️",
    desc: "willRunOutWithin3",
  },
  low: {
    label: "lowStock",
    badgeCls: "bg-yellow-100 text-yellow-800 border-yellow-300",
    icon: "🟡",
    desc: "text1893n18",
  },
  healthy: {
    label: "sufficientStock",
    badgeCls: "bg-emerald-100 text-emerald-800 border-emerald-300",
    icon: "✅",
    desc: "sufficientInventoryAvailable",
  },
  dead_stock: {
    label: "slowSellingDeadStock",
    badgeCls: "bg-purple-100 text-purple-800 border-purple-300",
    icon: "💤",
    desc: "salesAreVeryLowClear",
  },
  untracked: {
    label: "untracked",
    badgeCls: "bg-slate-100 text-slate-700 border-slate-300",
    icon: "❓",
    desc: "stockTrackingIsOff",
  },
} as const satisfies Record<
  string,
  { label: string; badgeCls: string; icon: string; desc: string }
>;

const formatBDT = (
  locale: "bn" | "en",
  minorStr?: string | number | null,
) => {
  if (minorStr == null) return fmtMoney(locale, 0);
  return fmtMoney(locale, Number(minorStr) / 100, {
    maximumFractionDigits: 0,
  });
};

export default function InventoryForecastingPage() {
  const { dict, t, locale } = useLocale();
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lookbackDays, setLookbackDays] = useState(14);
  const [targetCoverDays, setTargetCoverDays] = useState(21);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Supplier WhatsApp Modal State
  const [poModalItem, setPoModalItem] = useState<InventoryItem | null>(null);
  const [supplierPhone, setSupplierPhone] = useState("");
  const [customPoMessage, setCustomPoMessage] = useState("");
  const [reorderQtyInput, setReorderQtyInput] = useState<number>(0);

  // Quick Stock Adjustment Modal State
  const [adjModalItem, setAdjModalItem] = useState<InventoryItem | null>(null);
  const [newStockQty, setNewStockQty] = useState<number>(0);
  const [adjReason, setAdjReason] = useState("manual_count");
  const [adjBusy, setAdjBusy] = useState(false);
  const [adjNotice, setAdjNotice] = useState("");

  const loadForecast = async () => {
    const orgId = getOrganizationId();
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch<ForecastResponse>(
        `/organizations/${orgId}/inventory/forecast?lookbackDays=${lookbackDays}&targetCoverDays=${targetCoverDays}`
      );
      setData(res);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.inventory.failedToLoadInventoryForecast);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadForecast();
  }, [lookbackDays, targetCoverDays]);

  const filteredItems = useMemo(() => {
    if (!data?.items) return [];
    let list = data.items;
    if (statusFilter !== "all") {
      list = list.filter((i) => i.status === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          (i.sku && i.sku.toLowerCase().includes(q)) ||
          (i.category && i.category.toLowerCase().includes(q))
      );
    }
    return list;
  }, [data?.items, statusFilter, searchQuery]);

  const openPoModal = (item: InventoryItem) => {
    setPoModalItem(item);
    setReorderQtyInput(item.suggestedReorder || 20);
    setCustomPoMessage(item.supplierMessage);
    setSupplierPhone("");
  };

  const sendSupplierWhatsApp = () => {
    if (!poModalItem) return;
    let phone = supplierPhone.replace(/[^0-9]/g, "");
    if (phone.startsWith("0")) phone = "88" + phone;
    else if (!phone.startsWith("880") && phone.length === 10) phone = "880" + phone;

    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(customPoMessage)}`
      : `https://wa.me/?text=${encodeURIComponent(customPoMessage)}`;
    window.open(url, "_blank");
    setPoModalItem(null);
  };

  const openAdjModal = (item: InventoryItem) => {
    setAdjModalItem(item);
    setNewStockQty(item.stockQuantity ?? 0);
    setAdjReason("manual_count");
    setAdjNotice("");
  };

  const saveStockAdjustment = async () => {
    if (!adjModalItem) return;
    const orgId = getOrganizationId();
    if (!orgId) return;

    setAdjBusy(true);
    setAdjNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/products/${adjModalItem.id}/stock-adjustment`, {
        method: "POST",
        body: JSON.stringify({
          newStockQuantity: Number(newStockQty),
          reason: adjReason,
        }),
      });
      setAdjNotice(dict.inventory.stockUpdatedSuccessfully);
      setTimeout(() => {
        setAdjModalItem(null);
        loadForecast();
      }, 1000);
    } catch (e) {
      alert(e instanceof Error ? e.message : dict.inventory.stockUpdateFailed);
    } finally {
      setAdjBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-700">
            📦 Smart Stock & Reorder Copilot
          </span>
          <h1 className="mt-1 text-2xl font-black text-slate-900">
            {dict.inventory.inventoryForecastingSupplierReorderHub}</h1>
          <p className="text-xs text-slate-500">
            {dict.inventory.trackRealTimeOrderVelocity}</p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/products"
            className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 transition"
          >
            {dict.inventory.productCatalog}</Link>
          <button
            onClick={loadForecast}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 transition"
          >
            {dict.inventory.refreshData}</button>
        </div>
      </div>

      {error ? (
        <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-bold">{dict.inventory.error}</p>
          <p>{error}</p>
        </div>
      ) : null}

      {/* KPI Overview Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="card border-l-4 border-l-red-500 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{dict.inventory.outOfStock2}</p>
          <p className="mt-1 text-2xl font-black text-red-600">
            {data?.summary.outOfStockCount ?? 0} {dict.inventory.products}</p>
          <p className="mt-1 text-[11px] text-red-500 font-medium">{dict.inventory.riskOfLosingOrders}</p>
        </div>

        <div className="card border-l-4 border-l-amber-500 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{dict.inventory.urgentReorderCritical}</p>
          <p className="mt-1 text-2xl font-black text-amber-600">
            {data?.summary.criticalCount ?? 0} {dict.inventory.products}</p>
          <p className="mt-1 text-[11px] text-amber-600">{dict.inventory.willRunOutWithin32}</p>
        </div>

        <div className="card border-l-4 border-l-yellow-500 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{dict.inventory.lowStock2}</p>
          <p className="mt-1 text-2xl font-black text-yellow-600">
            {data?.summary.lowStockCount ?? 0} {dict.inventory.products}</p>
          <p className="mt-1 text-[11px] text-slate-500">{dict.inventory.text11rgx86}</p>
        </div>

        <div className="card border-l-4 border-l-emerald-500 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{dict.inventory.sufficientStockHealthy}</p>
          <p className="mt-1 text-2xl font-black text-emerald-700">
            {data?.summary.healthyCount ?? 0} {dict.inventory.products}</p>
          <p className="mt-1 text-[11px] text-emerald-600 font-medium">{dict.inventory.sufficientSalesBufferInStock}</p>
        </div>

        <div className="card border-l-4 border-l-indigo-600 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{dict.inventory.totalStockValueLTV}</p>
          <p className="mt-1 text-xl font-black text-indigo-900">
            {formatBDT(locale, data?.summary.totalStockValueMinor)}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            {dict.inventory.total}{data?.summary.totalProducts ?? 0} {dict.inventory.itemsInStock}</p>
        </div>
      </div>

      {/* Lookback & Planning Window Controls */}
      <div className="card space-y-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b pb-4">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase">
                {dict.inventory.salesAnalysisPeriod}</label>
              <select
                className="input mt-1 py-1 text-xs"
                value={lookbackDays}
                onChange={(e) => setLookbackDays(Number(e.target.value))}
              >
                <option value={7}>{dict.inventory.last7DaysFastTrend}</option>
                <option value={14}>{dict.inventory.last14DaysStandard}</option>
                <option value={30}>{dict.inventory.last30DaysMonthlyAverage}</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase">
                {dict.inventory.targetStockCoverage}</label>
              <select
                className="input mt-1 py-1 text-xs"
                value={targetCoverDays}
                onChange={(e) => setTargetCoverDays(Number(e.target.value))}
              >
                <option value={14}>{dict.inventory.text6239kg}</option>
                <option value={21}>{dict.inventory.textcq9sw1}</option>
                <option value={30}>{dict.inventory.text13zovna}</option>
              </select>
            </div>
          </div>

          <div className="w-full md:w-64">
            <label className="block text-[11px] font-bold text-slate-500 uppercase">{dict.inventory.searchProducts}</label>
            <input
              type="text"
              placeholder={dict.inventory.nameSKUOrCategory}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input mt-1 w-full py-1 text-xs"
            />
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setStatusFilter("all")}
            className={`rounded-full px-3 py-1 text-xs font-bold transition ${
              statusFilter === "all" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {dict.inventory.allProducts}{data?.items.length ?? 0})
          </button>
          <button
            onClick={() => setStatusFilter("out_of_stock")}
            className={`rounded-full px-3 py-1 text-xs font-bold transition ${
              statusFilter === "out_of_stock"
                ? "bg-red-600 text-white"
                : "bg-red-50 text-red-700 border border-red-200 hover:bg-red-100"
            }`}
          >
            {dict.inventory.outOfStock3}{data?.summary.outOfStockCount ?? 0})
          </button>
          <button
            onClick={() => setStatusFilter("critical")}
            className={`rounded-full px-3 py-1 text-xs font-bold transition ${
              statusFilter === "critical"
                ? "bg-amber-600 text-white"
                : "bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100"
            }`}
          >
            {dict.inventory.urgentAlerts}{data?.summary.criticalCount ?? 0})
          </button>
          <button
            onClick={() => setStatusFilter("low")}
            className={`rounded-full px-3 py-1 text-xs font-bold transition ${
              statusFilter === "low"
                ? "bg-yellow-600 text-white"
                : "bg-yellow-50 text-yellow-700 border border-yellow-200 hover:bg-yellow-100"
            }`}
          >
            {dict.inventory.lowStock3}{data?.summary.lowStockCount ?? 0})
          </button>
          <button
            onClick={() => setStatusFilter("dead_stock")}
            className={`rounded-full px-3 py-1 text-xs font-bold transition ${
              statusFilter === "dead_stock"
                ? "bg-purple-600 text-white"
                : "bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100"
            }`}
          >
            {dict.inventory.slowSelling}{data?.summary.deadStockCount ?? 0})
          </button>
          <button
            onClick={() => setStatusFilter("healthy")}
            className={`rounded-full px-3 py-1 text-xs font-bold transition ${
              statusFilter === "healthy"
                ? "bg-emerald-600 text-white"
                : "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
            }`}
          >
            {dict.inventory.sufficient}{data?.summary.healthyCount ?? 0})
          </button>
        </div>

        {/* Table of Forecasted Inventory */}
        {loading ? (
          <div className="p-8 text-center text-slate-500">
            <div className="mx-auto mb-2 h-7 w-7 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
            {dict.inventory.calculatingInventorySalesVelocityForecast}</div>
        ) : filteredItems.length === 0 ? (
          <div className="p-8 text-center text-slate-400 border border-dashed rounded-xl">
            {dict.inventory.noProductsFound}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b bg-slate-50 font-bold text-slate-600 uppercase">
                <tr>
                  <th className="py-3 px-3">{dict.inventory.productSKU}</th>
                  <th className="py-3 px-3">{dict.inventory.currentStock}</th>
                  <th className="py-3 px-3">{dict.inventory.salesVelocity}{lookbackDays} {dict.inventory.days}</th>
                  <th className="py-3 px-3">{dict.inventory.timeUntilStockRunsOut}</th>
                  <th className="py-3 px-3">{dict.inventory.stockStatus}</th>
                  <th className="py-3 px-3">{dict.inventory.recommendedReorder}</th>
                  <th className="py-3 px-3 text-right">{dict.inventory.textk30llm}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredItems.map((item) => {
                  const cfg = STATUS_CONFIG[item.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.untracked;
                  return (
                    <tr key={item.id} className="hover:bg-slate-50/70 transition">
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2.5">
                          {item.imageUrl ? (
                            <img
                              src={item.imageUrl}
                              alt=""
                              className="h-10 w-10 rounded-lg object-cover border border-slate-200"
                            />
                          ) : (
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 font-bold text-slate-400">
                              🛍️
                            </div>
                          )}
                          <div>
                            <div className="font-bold text-slate-900">{item.name}</div>
                            <div className="text-[11px] text-slate-400 font-mono">
                              {item.sku ? `SKU: ${item.sku}` : dict.inventory.noSKU} · {formatBDT(locale, item.priceMinor)}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`font-black text-sm ${
                              (item.stockQuantity ?? 0) <= 0
                                ? "text-red-600"
                                : (item.stockQuantity ?? 0) <= 5
                                ? "text-amber-600"
                                : "text-slate-900"
                            }`}
                          >
                            {item.stockQuantity !== null ? t("inventory.pcs2", { stockQuantity: item.stockQuantity }) : dict.inventory.untracked}
                          </span>
                          <button
                            onClick={() => openAdjModal(item)}
                            title={dict.inventory.updateStock}
                            className="text-[10px] text-indigo-600 hover:underline"
                          >
                            ✏️
                          </button>
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <div className="font-bold text-slate-800">
                          {item.dailyVelocity} {dict.inventory.pcsDay}</div>
                        <div className="text-[10px] text-slate-400">
                          {dict.inventory.totalSold}{item.unitsSoldInWindow} {dict.inventory.pcs}</div>
                      </td>

                      <td className="py-3 px-3">
                        {item.runoutDays !== null ? (
                          item.runoutDays >= 999 ? (
                            <span className="text-slate-400">{dict.inventory.noSales}</span>
                          ) : (
                            <div>
                              <span
                                className={`font-bold ${
                                  item.runoutDays <= 4
                                    ? "text-red-600"
                                    : item.runoutDays <= 10
                                    ? "text-amber-600"
                                    : "text-slate-700"
                                }`}
                              >
                                {item.runoutDays} {dict.inventory.daysLeft}</span>
                              <div className="text-[10px] text-slate-400">
                                {item.runoutDays <= 4 ? dict.inventory.runningOutFast : dict.inventory.normal}
                              </div>
                            </div>
                          )
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      <td className="py-3 px-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${cfg.badgeCls}`}
                        >
                          <span>{cfg.icon}</span>
                          <span>{dict.inventory[cfg.label]}</span>
                        </span>
                      </td>

                      <td className="py-3 px-3">
                        {item.suggestedReorder > 0 ? (
                          <span className="font-black text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-lg">
                            +{item.suggestedReorder} {dict.inventory.pcs}</span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">{dict.inventory.notNeeded}</span>
                        )}
                      </td>

                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => openPoModal(item)}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 transition shadow-sm"
                          >
                            <span>💬</span> WhatsApp PO
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Supplier WhatsApp Purchase Order Modal */}
      {poModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl space-y-4 animate-scale-up">
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {dict.inventory.sendAWhatsAppPurchaseOrder}</h3>
                <p className="text-xs text-slate-500">{dict.inventory.product}{poModalItem.name}</p>
              </div>
              <button
                onClick={() => setPoModalItem(null)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {dict.inventory.supplierPhoneNumberOptional}</label>
              <input
                type="text"
                placeholder={dict.inventory.text11oib7h}
                value={supplierPhone}
                onChange={(e) => setSupplierPhone(e.target.value)}
                className="input w-full text-xs"
              />
              <p className="mt-1 text-[10px] text-slate-400">
                {dict.inventory.leaveItEmptyAndWhatsApp}</p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {dict.inventory.reorderQuantityPcs}</label>
              <input
                type="number"
                min={1}
                value={reorderQtyInput}
                onChange={(e) => {
                  const qty = Number(e.target.value);
                  setReorderQtyInput(qty);
                  setCustomPoMessage(
                    poModalItem.supplierMessage.replace(
                      /\d+ পিস প্রস্তুত করে/g,
                      t("inventory.preparePcsAnd", { qty: qty })
                    )
                  );
                }}
                className="input w-32 text-xs font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {dict.inventory.purchaseOrderMessagePreview}</label>
              <textarea
                rows={5}
                value={customPoMessage}
                onChange={(e) => setCustomPoMessage(e.target.value)}
                className="input w-full text-xs"
              />
            </div>

            <div className="flex items-center justify-end gap-2 border-t pt-3">
              <button
                type="button"
                onClick={() => setPoModalItem(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                {dict.common.cancel}</button>
              <button
                type="button"
                onClick={sendSupplierWhatsApp}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow hover:bg-emerald-700 transition"
              >
                <span>💬</span> {dict.inventory.sendOnWhatsApp}</button>
            </div>
          </div>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {adjModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4 animate-scale-up">
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">{dict.inventory.stockAdjustment}</h3>
                <p className="text-xs text-slate-500">{adjModalItem.name}</p>
              </div>
              <button
                onClick={() => setAdjModalItem(null)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {adjNotice && (
              <div className="rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-800">
                ✅ {adjNotice}
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{dict.inventory.newStockQuantity}</label>
              <input
                type="number"
                min={0}
                value={newStockQty}
                onChange={(e) => setNewStockQty(Number(e.target.value))}
                className="input w-full text-sm font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{dict.inventory.reason}</label>
              <select
                className="input w-full text-xs"
                value={adjReason}
                onChange={(e) => setAdjReason(e.target.value)}
              >
                <option value="manual_count">{dict.inventory.physicalCountWarehouseCheckManual}</option>
                <option value="restock">{dict.inventory.newShipmentRestockRestock}</option>
                <option value="damage">{dict.inventory.damagedOrSpoiledProductsDamaged}</option>
                <option value="return">{dict.inventory.customerReturnIntakeCustomerReturn}</option>
              </select>
            </div>

            <div className="flex items-center justify-end gap-2 border-t pt-3">
              <button
                type="button"
                onClick={() => setAdjModalItem(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                {dict.common.cancel}</button>
              <button
                type="button"
                disabled={adjBusy}
                onClick={saveStockAdjustment}
                className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow hover:bg-indigo-700 transition"
              >
                {adjBusy ? dict.inventory.saving : dict.inventory.updateStock}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
