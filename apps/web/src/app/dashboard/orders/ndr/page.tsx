"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinor } from "@repo/contracts";

interface NdrIncident {
  id: string;
  organizationId: string;
  shipmentId: string;
  orderId: string;
  provider: string;
  trackingCode: string;
  reason: string;
  status: string;
  customerFeedback?: string | null;
  rescheduleDate?: string | null;
  notes?: string | null;
  lastContactedAt?: string | null;
  actionTaken?: string | null;
  createdAt: string;
  orderNumber: string;
  totalAmountMinor: string;
  customerName: string;
  customerPhone: string;
}

interface NdrMetrics {
  total: number;
  open: number;
  contacted: number;
  rescheduled: number;
  resolved: number;
  returned: number;
  recoveryRatePercent: number;
}

const STATUS_BADGE: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  OPEN: { label: "ঝুঁকিপূর্ণ / নতুন", bg: "bg-rose-50", text: "text-rose-700", dot: "bg-rose-500" },
  CUSTOMER_CONTACTED: { label: "মেসেজ পাঠানো হয়েছে", bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
  RESCHEDULED: { label: "পুনঃনির্ধারিত", bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500" },
  RESOLVED: { label: "সফল সমাধান", bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  RETURNED: { label: "ফেরত নিশ্চিত", bg: "bg-slate-100", text: "text-slate-600", dot: "bg-slate-400" },
};

const REASON_MAP: Record<string, string> = {
  customer_unreachable: "গ্রাহক ফোন ধরেননি / অপ্রাপ্য",
  hold: "কুরিয়ারে হোল্ড করা হয়েছে",
  delivery_failed: "ডেলিভারি চেষ্টা ব্যর্থ",
  failed_attempt: "প্রথম চেষ্টা ব্যর্থ",
  address_issue: "ঠিকানা অসম্পূর্ণ / ত্রুটিযুক্ত",
  cancelled_by_customer: "গ্রাহক আপাতত নিতে অস্বীকৃতি জানিয়েছেন",
};

export default function NdrRecoveryPage() {
  const [metrics, setMetrics] = useState<NdrMetrics | null>(null);
  const [incidents, setIncidents] = useState<NdrIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [actionBusy, setActionBusy] = useState<string>("");
  const [selectedIncident, setSelectedIncident] = useState<NdrIncident | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleNote, setRescheduleNote] = useState("");

  const orgId = typeof window !== "undefined" ? getOrganizationId() ?? "" : "";

  const loadData = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const url = filterStatus
        ? `/organizations/${orgId}/courier/ndr?status=${filterStatus}`
        : `/organizations/${orgId}/courier/ndr`;
      const res = await apiFetch<{ metrics: NdrMetrics; incidents: NdrIncident[] }>(url);
      setMetrics(res.metrics);
      setIncidents(res.incidents || []);
    } catch {
      // Graceful fallback
    } finally {
      setLoading(false);
    }
  }, [orgId, filterStatus]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleContactCustomer = async (id: string) => {
    if (!orgId) return;
    setActionBusy(id);
    try {
      await apiFetch(`/organizations/${orgId}/courier/ndr/${id}/contact`, { method: "POST" });
      await loadData();
    } catch (e: any) {
      alert(e.message || "মেসেজ পাঠানো ব্যর্থ হয়েছে");
    } finally {
      setActionBusy("");
    }
  };

  const handleRescheduleSubmit = async () => {
    if (!orgId || !selectedIncident || !rescheduleDate) return;
    setActionBusy(selectedIncident.id);
    try {
      await apiFetch(`/organizations/${orgId}/courier/ndr/${selectedIncident.id}/reschedule`, {
        method: "POST",
        body: JSON.stringify({
          rescheduleDate: new Date(rescheduleDate).toISOString(),
          notes: rescheduleNote,
        }),
      });
      setSelectedIncident(null);
      setRescheduleDate("");
      setRescheduleNote("");
      await loadData();
    } catch (e: any) {
      alert(e.message || "রি-শিডিউল সংরক্ষণ ব্যর্থ হয়েছে");
    } finally {
      setActionBusy("");
    }
  };

  const handleResolve = async (id: string, resolution: "RESOLVED" | "RETURNED") => {
    if (!orgId) return;
    setActionBusy(id);
    try {
      await apiFetch(`/organizations/${orgId}/courier/ndr/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ resolution }),
      });
      await loadData();
    } catch (e: any) {
      alert(e.message || "স্ট্যাটাস পরিবর্তন ব্যর্থ হয়েছে");
    } finally {
      setActionBusy("");
    }
  };

  // Filtered incidents
  const filteredIncidents = useMemo(() => {
    if (!searchQuery.trim()) return incidents;
    const q = searchQuery.toLowerCase().trim();
    return incidents.filter((i) => {
      const matchOrder = (i.orderNumber ?? "").toLowerCase().includes(q);
      const matchName = (i.customerName ?? "").toLowerCase().includes(q);
      const matchPhone = (i.customerPhone ?? "").toLowerCase().includes(q);
      const matchTrack = (i.trackingCode ?? "").toLowerCase().includes(q);
      return matchOrder || matchName || matchPhone || matchTrack;
    });
  }, [incidents, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Top Header & Breadcrumbs */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 mb-1.5">
            <Link href="/dashboard/orders" className="text-indigo-600 hover:underline">
              ← অর্ডার তালিকা
            </Link>
            <span className="text-slate-300">/</span>
            <span className="text-slate-700">কুরিয়ার NDR রিকভারি</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              🚨 NDR ও ঝুঁকিপূর্ণ পার্সেল রিকভারি হাব
            </h1>
            {metrics && metrics.open > 0 && (
              <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-800 animate-pulse">
                {metrics.open}টি জরুরি কেস
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            কুরিয়ার রাইডার কাস্টমারকে না পেলে বা ডেলিভারি ফেইল্ড হলে সরাসরি স্বয়ংক্রিয় ফলো-আপ, WhatsApp ও রি-শিডিউল ম্যানেজমেন্ট।
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadData()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-95 disabled:opacity-50"
        >
          <span>🔄</span>
          <span>{loading ? "রিফ্রেশ হচ্ছে..." : "রিফ্রেশ করুন"}</span>
        </button>
      </div>

      {/* KPI Metrics Summary */}
      {metrics && (
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">মোট NDR কেস</span>
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600 text-sm">
                📦
              </span>
            </div>
            <div className="mt-2 text-2xl font-bold text-slate-900">{metrics.total}</div>
            <p className="mt-0.5 text-[11px] text-slate-400">ডেলিভারি ব্যর্থ পার্সেল</p>
          </div>

          <div className="rounded-2xl border border-rose-200/80 bg-rose-50/50 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-rose-700">জরুরি পদক্ষেপ</span>
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-100 text-rose-700 text-sm">
                ⚠️
              </span>
            </div>
            <div className="mt-2 text-2xl font-bold text-rose-800">{metrics.open}</div>
            <p className="mt-0.5 text-[11px] text-rose-600 font-medium">কাস্টমার এখনও আনরিচড</p>
          </div>

          <div className="rounded-2xl border border-amber-200/80 bg-amber-50/50 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-700">মেসেজ পাঠানো</span>
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-700 text-sm">
                💬
              </span>
            </div>
            <div className="mt-2 text-2xl font-bold text-amber-800">{metrics.contacted}</div>
            <p className="mt-0.5 text-[11px] text-amber-600 font-medium">রেসপন্সের অপেক্ষায়</p>
          </div>

          <div className="rounded-2xl border border-blue-200/80 bg-blue-50/50 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-blue-700">পুনঃনির্ধারিত</span>
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-blue-700 text-sm">
                🗓️
              </span>
            </div>
            <div className="mt-2 text-2xl font-bold text-blue-800">{metrics.rescheduled}</div>
            <p className="mt-0.5 text-[11px] text-blue-600 font-medium">নতুন ডেলিভারি ডেট ফিক্সড</p>
          </div>

          <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/50 p-4 shadow-sm col-span-2 sm:col-span-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-700">রিকভারি সাকসেস</span>
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 text-sm">
                🎯
              </span>
            </div>
            <div className="mt-2 text-2xl font-bold text-emerald-800">
              {metrics.recoveryRatePercent}%
            </div>
            <p className="mt-0.5 text-[11px] text-emerald-600 font-medium">রিটার্ন থেকে সফল উদ্ধার</p>
          </div>
        </div>
      )}

      {/* Filter Bar & Search */}
      <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-sm">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
              🔍
            </span>
            <input
              type="text"
              className="w-full rounded-xl border border-slate-200 bg-slate-50/60 py-2 pl-9 pr-9 text-xs text-slate-900 placeholder:text-slate-400 transition hover:bg-white focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10"
              placeholder="অর্ডার নম্বর, কাস্টমার নাম, ফোন বা ট্র্যাকিং কোড দিয়ে খুঁজুন..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-xs text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Status Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs scrollbar-none">
          {[
            { key: "", label: "সবগুলো" },
            { key: "OPEN", label: "🚨 জরুরি (OPEN)" },
            { key: "CUSTOMER_CONTACTED", label: "💬 মেসেজ পাঠানো হয়েছে" },
            { key: "RESCHEDULED", label: "🗓️ পুনঃনির্ধারিত" },
            { key: "RESOLVED", label: "✓ সমাধান হয়েছে" },
            { key: "RETURNED", label: "✕ ফেরত" },
          ].map((tab) => {
            const isActive = filterStatus === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilterStatus(tab.key)}
                className={`shrink-0 rounded-xl px-3 py-1.5 font-semibold transition ${
                  isActive
                    ? "bg-slate-900 text-white shadow-sm"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200/80 hover:text-slate-900"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Incidents Table / Cards */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500">ডাটা লোড হচ্ছে...</div>
        ) : filteredIncidents.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-3xl">🎉</div>
            <p className="mt-2 text-sm font-bold text-slate-800">
              {searchQuery ? "কোনো মিল পাওয়া যায়নি" : "কোনো ঝুঁকিপূর্ণ NDR পার্সেল নেই!"}
            </p>
            <p className="text-xs text-slate-500">
              {searchQuery
                ? `"${searchQuery}" এর সাথে কোনো কেস মেলেনি।`
                : "সবগুলো পার্সেল ঠিক সময়ে ডেলিভারির পথে আছে।"}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop View */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-100 bg-slate-50/75 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3">অর্ডার ও কাস্টমার</th>
                    <th className="px-4 py-3">কুরিয়ার ও ট্র্যাকিং</th>
                    <th className="px-4 py-3">ব্যর্থতার কারণ</th>
                    <th className="px-4 py-3">বর্তমান অবস্থা</th>
                    <th className="px-4 py-3 text-right">অ্যাকশন ও সমাধান</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredIncidents.map((inc) => {
                    const badge = STATUS_BADGE[inc.status] || {
                      label: inc.status,
                      bg: "bg-slate-100",
                      text: "text-slate-600",
                      dot: "bg-slate-400",
                    };
                    const reasonLabel = REASON_MAP[inc.reason] || inc.reason;

                    return (
                      <tr key={inc.id} className="transition hover:bg-slate-50/70">
                        {/* Order & Customer */}
                        <td className="px-4 py-3.5">
                          <div className="font-bold text-slate-900">#{inc.orderNumber}</div>
                          <div className="font-semibold text-slate-700">{inc.customerName}</div>
                          <div className="font-mono text-[11px] text-slate-400">
                            {inc.customerPhone && (
                              <a
                                href={`tel:${inc.customerPhone}`}
                                className="hover:text-indigo-600 hover:underline"
                              >
                                📞 {inc.customerPhone}
                              </a>
                            )}
                          </div>
                          <div className="mt-1 font-bold text-emerald-700">
                            {formatMinor(BigInt(inc.totalAmountMinor || 0))}
                          </div>
                        </td>

                        {/* Courier & Tracking */}
                        <td className="px-4 py-3.5">
                          <div className="inline-flex rounded bg-slate-100 px-1.5 py-0.2 text-[10px] font-bold text-slate-600 uppercase">
                            {inc.provider}
                          </div>
                          <div className="font-mono text-slate-800 font-semibold select-all mt-0.5">
                            {inc.trackingCode}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-1">
                            {new Date(inc.createdAt).toLocaleString("bn-BD")}
                          </div>
                        </td>

                        {/* Failure Reason */}
                        <td className="px-4 py-3.5 max-w-xs">
                          <span className="rounded-lg bg-rose-50 border border-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700 inline-block">
                            {reasonLabel}
                          </span>
                          {inc.customerFeedback && (
                            <div className="mt-1 text-[11px] font-medium text-blue-700">
                              গ্রাহক মন্তব্য: “{inc.customerFeedback}”
                            </div>
                          )}
                          {inc.notes && (
                            <div className="mt-1 text-[11px] text-slate-500 line-clamp-2">
                              {inc.notes}
                            </div>
                          )}
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3.5">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${badge.bg} ${badge.text}`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
                            <span>{badge.label}</span>
                          </span>
                          {inc.rescheduleDate && (
                            <div className="mt-1 text-[11px] font-semibold text-blue-700">
                              🗓️ শিডিউল: {new Date(inc.rescheduleDate).toLocaleDateString("bn-BD")}
                            </div>
                          )}
                          {inc.lastContactedAt && (
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              মেসেজ: {new Date(inc.lastContactedAt).toLocaleTimeString("bn-BD")}
                            </div>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3.5 text-right">
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => void handleContactCustomer(inc.id)}
                              disabled={actionBusy === inc.id}
                              className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-95 disabled:opacity-50"
                            >
                              <span>💬</span>{" "}
                              <span>{actionBusy === inc.id ? "পাঠানো হচ্ছে..." : "মেসেজ পাঠান"}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setSelectedIncident(inc);
                                setRescheduleNote(inc.notes || "");
                              }}
                              className="rounded-xl border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 active:scale-95"
                            >
                              <span>🗓️ রি-শিডিউল</span>
                            </button>

                            {inc.status !== "RESOLVED" && (
                              <button
                                type="button"
                                onClick={() => void handleResolve(inc.id, "RESOLVED")}
                                disabled={actionBusy === inc.id}
                                className="rounded-xl bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
                              >
                                ✓ সমাধান
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile View (Cards) */}
            <div className="divide-y divide-slate-100 md:hidden">
              {filteredIncidents.map((inc) => {
                const badge = STATUS_BADGE[inc.status] || {
                  label: inc.status,
                  bg: "bg-slate-100",
                  text: "text-slate-600",
                  dot: "bg-slate-400",
                };
                const reasonLabel = REASON_MAP[inc.reason] || inc.reason;

                return (
                  <div key={inc.id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-bold text-slate-900 text-sm">#{inc.orderNumber}</div>
                        <div className="font-semibold text-slate-700 text-xs">{inc.customerName}</div>
                        {inc.customerPhone && (
                          <a
                            href={`tel:${inc.customerPhone}`}
                            className="text-xs font-mono text-indigo-600 hover:underline"
                          >
                            📞 {inc.customerPhone}
                          </a>
                        )}
                      </div>
                      <div className="text-right">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.bg} ${badge.text}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
                          <span>{badge.label}</span>
                        </span>
                        <div className="mt-1 font-bold text-slate-900 text-xs">
                          {formatMinor(BigInt(inc.totalAmountMinor || 0))}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl bg-slate-50 p-2.5 text-xs space-y-1">
                      <div className="flex items-center justify-between text-slate-500">
                        <span>কুরিয়ার: {inc.provider}</span>
                        <span className="font-mono font-semibold text-slate-800">{inc.trackingCode}</span>
                      </div>
                      <div className="text-rose-700 font-semibold">কারণ: {reasonLabel}</div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => void handleContactCustomer(inc.id)}
                        disabled={actionBusy === inc.id}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700"
                      >
                        💬 মেসেজ
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedIncident(inc);
                          setRescheduleNote(inc.notes || "");
                        }}
                        className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700"
                      >
                        🗓️ রি-শিডিউল
                      </button>
                      {inc.status !== "RESOLVED" && (
                        <button
                          type="button"
                          onClick={() => void handleResolve(inc.id, "RESOLVED")}
                          disabled={actionBusy === inc.id}
                          className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white"
                        >
                          ✓ সমাধান
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Reschedule Modal */}
      {selectedIncident && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs animate-fade">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl animate-rise space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                🗓️ পার্সেল ডেলিভারি রি-শিডিউল করুন
              </h3>
              <button
                type="button"
                onClick={() => setSelectedIncident(null)}
                className="rounded-xl border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-500">
              অর্ডার #{selectedIncident.orderNumber} ({selectedIncident.customerName}) এর জন্য নতুন ডেলিভারি তারিখ নির্ধারণ করুন।
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  নতুন ডেলিভারির তারিখ *
                </label>
                <input
                  type="date"
                  value={rescheduleDate}
                  onChange={(e) => setRescheduleDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  বিশেষ নির্দেশনা বা নোট (কুরিয়ারের জন্য)
                </label>
                <textarea
                  rows={3}
                  value={rescheduleNote}
                  onChange={(e) => setRescheduleNote(e.target.value)}
                  placeholder="যেমন: গ্রাহক আগামীকাল বিকাল ৩টার পর বাসায় থাকবেন..."
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => setSelectedIncident(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                বাতিল
              </button>
              <button
                type="button"
                onClick={() => void handleRescheduleSubmit()}
                disabled={!rescheduleDate || actionBusy !== ""}
                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {actionBusy ? "সংরক্ষণ হচ্ছে..." : "কনফার্ম করুন"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
