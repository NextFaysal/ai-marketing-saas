"use client";
import React, { useState, useEffect, useMemo } from "react";
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

const STATUS_CONFIG: Record<
  string,
  { label: string; badgeCls: string; icon: string; desc: string }
> = {
  out_of_stock: {
    label: "স্টক শেষ",
    badgeCls: "bg-red-100 text-red-800 border-red-300",
    icon: "🚨",
    desc: "০ পিস স্টক - অবিলম্বে নতুন লট প্রস্তুত করুন!",
  },
  critical: {
    label: "জরুরি স্টক অ্যালার্ট",
    badgeCls: "bg-amber-100 text-amber-800 border-amber-300",
    icon: "⚠️",
    desc: "৩-৪ দিনের মধ্যে শেষ হবে - রিরর্ডার প্রয়োজন",
  },
  low: {
    label: "লো স্টক",
    badgeCls: "bg-yellow-100 text-yellow-800 border-yellow-300",
    icon: "🟡",
    desc: "৫-১০ দিনের স্টক বাকি আছে",
  },
  healthy: {
    label: "পর্যাপ্ত স্টক",
    badgeCls: "bg-emerald-100 text-emerald-800 border-emerald-300",
    icon: "✅",
    desc: "পর্যাপ্ত ইনভেন্টরি মজুত রয়েছে",
  },
  dead_stock: {
    label: "ধীর বিক্রি / ডেড স্টক",
    badgeCls: "bg-purple-100 text-purple-800 border-purple-300",
    icon: "💤",
    desc: "বিক্রি অত্যন্ত কম - ডিসকাউন্ট দিয়ে স্টক ক্লিয়ার করুন",
  },
  untracked: {
    label: "আনট্র্যাকড",
    badgeCls: "bg-slate-100 text-slate-700 border-slate-300",
    icon: "❓",
    desc: "স্টক ট্র্যাকিং চালু নেই",
  },
};

const formatBDT = (minorStr?: string | number | null) => {
  if (minorStr == null) return "৳০";
  const num = Number(minorStr) / 100;
  return `৳${num.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};

export default function InventoryForecastingPage() {
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
      setError(e instanceof Error ? e.message : "ইনভেন্টরি পূর্বাভাস লোড করতে ব্যর্থ");
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
      setAdjNotice("স্টক সফলভাবে আপডেট হয়েছে!");
      setTimeout(() => {
        setAdjModalItem(null);
        loadForecast();
      }, 1000);
    } catch (e) {
      alert(e instanceof Error ? e.message : "স্টক আপডেট ব্যর্থ হয়েছে");
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
            ইনভেন্টরি ফোরকাস্টিং ও সাপ্লায়ার রিরর্ডার হাব
          </h1>
          <p className="text-xs text-slate-500">
            রিয়েল-টাইম অর্ডার ভেলোসিটি ট্র্যাক করে স্টক শেষ হওয়ার পূর্বাভাস এবং ১-ক্লিকে সাপ্লায়ারকে WhatsApp PO পাঠান।
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/products"
            className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 transition"
          >
            🛍️ প্রোডাক্ট ক্যাটালগ
          </Link>
          <button
            onClick={loadForecast}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 transition"
          >
            🔄 রিফ্রেশ ডাটা
          </button>
        </div>
      </div>

      {error ? (
        <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-bold">ত্রুটি:</p>
          <p>{error}</p>
        </div>
      ) : null}

      {/* KPI Overview Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="card border-l-4 border-l-red-500 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">🚨 স্টক শেষ (Out of Stock)</p>
          <p className="mt-1 text-2xl font-black text-red-600">
            {data?.summary.outOfStockCount ?? 0} টি প্রোডাক্ট
          </p>
          <p className="mt-1 text-[11px] text-red-500 font-medium">অর্ডার নষ্ট হওয়ার ঝুঁকি!</p>
        </div>

        <div className="card border-l-4 border-l-amber-500 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">⚠️ জরুরি রিরর্ডার (Critical)</p>
          <p className="mt-1 text-2xl font-black text-amber-600">
            {data?.summary.criticalCount ?? 0} টি প্রোডাক্ট
          </p>
          <p className="mt-1 text-[11px] text-amber-600">৩-৪ দিনের মধ্যে শেষ হবে</p>
        </div>

        <div className="card border-l-4 border-l-yellow-500 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">🟡 লো স্টক (Low Stock)</p>
          <p className="mt-1 text-2xl font-black text-yellow-600">
            {data?.summary.lowStockCount ?? 0} টি প্রোডাক্ট
          </p>
          <p className="mt-1 text-[11px] text-slate-500">৫-১০ দিনের কভারেজ বাকি</p>
        </div>

        <div className="card border-l-4 border-l-emerald-500 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">✅ পর্যাপ্ত স্টক (Healthy)</p>
          <p className="mt-1 text-2xl font-black text-emerald-700">
            {data?.summary.healthyCount ?? 0} টি প্রোডাক্ট
          </p>
          <p className="mt-1 text-[11px] text-emerald-600 font-medium">পর্যাপ্ত সেলস বাফার মজুদ</p>
        </div>

        <div className="card border-l-4 border-l-indigo-600 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">💰 মোট স্টক ভ্যালু (LTV)</p>
          <p className="mt-1 text-xl font-black text-indigo-900">
            {formatBDT(data?.summary.totalStockValueMinor)}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            মোট {data?.summary.totalProducts ?? 0} টি আইটেমের মজুদ
          </p>
        </div>
      </div>

      {/* Lookback & Planning Window Controls */}
      <div className="card space-y-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b pb-4">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase">
                বিক্রি অ্যানালাইসিস সময়সীমা:
              </label>
              <select
                className="input mt-1 py-1 text-xs"
                value={lookbackDays}
                onChange={(e) => setLookbackDays(Number(e.target.value))}
              >
                <option value={7}>গত ৭ দিন (দ্রুত ট্রেন্ড)</option>
                <option value={14}>গত ১৪ দিন (স্ট্যান্ডার্ড)</option>
                <option value={30}>গত ৩০ দিন (মাসিক গড়)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase">
                লক্ষ্যমাত্রা স্টক কভারেজ:
              </label>
              <select
                className="input mt-1 py-1 text-xs"
                value={targetCoverDays}
                onChange={(e) => setTargetCoverDays(Number(e.target.value))}
              >
                <option value={14}>১৪ দিনের নিরাপত্তা মজুদ</option>
                <option value={21}>২১ দিনের নিরাপত্তা মজুদ (সুপারিশকৃত)</option>
                <option value={30}>৩০ দিনের নিরাপত্তা মজুদ</option>
              </select>
            </div>
          </div>

          <div className="w-full md:w-64">
            <label className="block text-[11px] font-bold text-slate-500 uppercase">পণ্য খুঁজুন:</label>
            <input
              type="text"
              placeholder="নাম, SKU বা ক্যাটাগরি..."
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
            সকল প্রোডাক্ট ({data?.items.length ?? 0})
          </button>
          <button
            onClick={() => setStatusFilter("out_of_stock")}
            className={`rounded-full px-3 py-1 text-xs font-bold transition ${
              statusFilter === "out_of_stock"
                ? "bg-red-600 text-white"
                : "bg-red-50 text-red-700 border border-red-200 hover:bg-red-100"
            }`}
          >
            🚨 স্টক শেষ ({data?.summary.outOfStockCount ?? 0})
          </button>
          <button
            onClick={() => setStatusFilter("critical")}
            className={`rounded-full px-3 py-1 text-xs font-bold transition ${
              statusFilter === "critical"
                ? "bg-amber-600 text-white"
                : "bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100"
            }`}
          >
            ⚠️ জরুরি অ্যালার্ট ({data?.summary.criticalCount ?? 0})
          </button>
          <button
            onClick={() => setStatusFilter("low")}
            className={`rounded-full px-3 py-1 text-xs font-bold transition ${
              statusFilter === "low"
                ? "bg-yellow-600 text-white"
                : "bg-yellow-50 text-yellow-700 border border-yellow-200 hover:bg-yellow-100"
            }`}
          >
            🟡 লো স্টক ({data?.summary.lowStockCount ?? 0})
          </button>
          <button
            onClick={() => setStatusFilter("dead_stock")}
            className={`rounded-full px-3 py-1 text-xs font-bold transition ${
              statusFilter === "dead_stock"
                ? "bg-purple-600 text-white"
                : "bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100"
            }`}
          >
            💤 ধীর বিক্রি ({data?.summary.deadStockCount ?? 0})
          </button>
          <button
            onClick={() => setStatusFilter("healthy")}
            className={`rounded-full px-3 py-1 text-xs font-bold transition ${
              statusFilter === "healthy"
                ? "bg-emerald-600 text-white"
                : "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
            }`}
          >
            ✅ পর্যাপ্ত ({data?.summary.healthyCount ?? 0})
          </button>
        </div>

        {/* Table of Forecasted Inventory */}
        {loading ? (
          <div className="p-8 text-center text-slate-500">
            <div className="mx-auto mb-2 h-7 w-7 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
            ইনভেন্টরি সেলস ভেলোসিটি ও ফোরকাস্ট গণনা করা হচ্ছে...
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-8 text-center text-slate-400 border border-dashed rounded-xl">
            কোনো প্রোডাক্ট পাওয়া যায়নি।
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b bg-slate-50 font-bold text-slate-600 uppercase">
                <tr>
                  <th className="py-3 px-3">পণ্য ও SKU</th>
                  <th className="py-3 px-3">বর্তমান স্টক</th>
                  <th className="py-3 px-3">বিক্রি ভেলোসিটি ({lookbackDays} দিন)</th>
                  <th className="py-3 px-3">স্টক শেষ হতে বাকি</th>
                  <th className="py-3 px-3">স্টক স্ট্যাটাস</th>
                  <th className="py-3 px-3">সুপারিশকৃত রিরর্ডার</th>
                  <th className="py-3 px-3 text-right">১-ক্লিক অ্যাকশন</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredItems.map((item) => {
                  const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.untracked;
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
                              {item.sku ? `SKU: ${item.sku}` : "SKU নেই"} · {formatBDT(item.priceMinor)}
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
                            {item.stockQuantity !== null ? `${item.stockQuantity} পিস` : "আনট্র্যাকড"}
                          </span>
                          <button
                            onClick={() => openAdjModal(item)}
                            title="স্টক আপডেট করুন"
                            className="text-[10px] text-indigo-600 hover:underline"
                          >
                            ✏️
                          </button>
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <div className="font-bold text-slate-800">
                          {item.dailyVelocity} পিস / দিন
                        </div>
                        <div className="text-[10px] text-slate-400">
                          মোট বিক্রি: {item.unitsSoldInWindow} পিস
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        {item.runoutDays !== null ? (
                          item.runoutDays >= 999 ? (
                            <span className="text-slate-400">বিক্রি নেই</span>
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
                                {item.runoutDays} দিন বাকি
                              </span>
                              <div className="text-[10px] text-slate-400">
                                {item.runoutDays <= 4 ? "🚨 দ্রুত ফুরাচ্ছে" : "স্বাভাবিক"}
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
                          <span>{cfg.label}</span>
                        </span>
                      </td>

                      <td className="py-3 px-3">
                        {item.suggestedReorder > 0 ? (
                          <span className="font-black text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-lg">
                            +{item.suggestedReorder} পিস
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">প্রয়োজন নেই</span>
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
                  💬 সাপ্লায়ারকে WhatsApp পারচেজ অর্ডার (PO) পাঠান
                </h3>
                <p className="text-xs text-slate-500">পণ্য: {poModalItem.name}</p>
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
                সাপ্লায়ারের ফোন নম্বর (ঐচ্ছিক):
              </label>
              <input
                type="text"
                placeholder="017... বা 018..."
                value={supplierPhone}
                onChange={(e) => setSupplierPhone(e.target.value)}
                className="input w-full text-xs"
              />
              <p className="mt-1 text-[10px] text-slate-400">
                খালি রাখলে WhatsApp ওপেন হয়ে যেকোনো সাপ্লায়ার চ্যাটে ফরোয়ার্ড করা যাবে।
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                রিরর্ডার সংখ্যা (পিস):
              </label>
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
                      `${qty} পিস প্রস্তুত করে`
                    )
                  );
                }}
                className="input w-32 text-xs font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                পারচেজ অর্ডার বার্তা প্রিভিউ:
              </label>
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
                বাতিল
              </button>
              <button
                type="button"
                onClick={sendSupplierWhatsApp}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow hover:bg-emerald-700 transition"
              >
                <span>💬</span> WhatsApp এ পাঠান
              </button>
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
                <h3 className="text-base font-bold text-slate-900">✏️ স্টক অ্যাডজাস্টমেন্ট</h3>
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
              <label className="block text-xs font-bold text-slate-700 mb-1">নতুন স্টক সংখ্যা:</label>
              <input
                type="number"
                min={0}
                value={newStockQty}
                onChange={(e) => setNewStockQty(Number(e.target.value))}
                className="input w-full text-sm font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">কারণ:</label>
              <select
                className="input w-full text-xs"
                value={adjReason}
                onChange={(e) => setAdjReason(e.target.value)}
              >
                <option value="manual_count">শারীরিক গণনা / গুদাম যাচাই (Manual Count)</option>
                <option value="restock">নতুন চালান রিস্টক (Restock)</option>
                <option value="damage">ক্ষতিগ্রস্ত বা নষ্ট পণ্য (Damaged)</option>
                <option value="return">কাস্টমার রিটার্ন ইনটেক (Customer Return)</option>
              </select>
            </div>

            <div className="flex items-center justify-end gap-2 border-t pt-3">
              <button
                type="button"
                onClick={() => setAdjModalItem(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                বাতিল
              </button>
              <button
                type="button"
                disabled={adjBusy}
                onClick={saveStockAdjustment}
                className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow hover:bg-indigo-700 transition"
              >
                {adjBusy ? "সংরক্ষণ হচ্ছে..." : "স্টক আপডেট করুন"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
