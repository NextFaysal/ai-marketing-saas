"use client";

import React, { useEffect, useState, useCallback } from "react";
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

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  OPEN: { label: "ঝুঁকিপূর্ণ / নতুন", cls: "bg-rose-100 text-rose-700 border-rose-200" },
  CUSTOMER_CONTACTED: { label: "মেসেজ পাঠানো হয়েছে", cls: "bg-amber-100 text-amber-700 border-amber-200" },
  RESCHEDULED: { label: "পুনঃনির্ধারিত", cls: "bg-blue-100 text-blue-700 border-blue-200" },
  RESOLVED: { label: "সফলভাবে সমাধান", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  RETURNED: { label: "ফেরত নিশ্চিত", cls: "bg-slate-100 text-slate-600 border-slate-200" },
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
  const [actionBusy, setActionBusy] = useState<string>("");
  const [selectedIncident, setSelectedIncident] = useState<NdrIncident | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleNote, setRescheduleNote] = useState("");

  const orgId = getOrganizationId();

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

  return (
    <div className="space-y-6">
      {/* Top Header & Breadcrumb */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 mb-1">
            <Link href="/dashboard/orders" className="hover:text-slate-800">
              ← অর্ডার তালিকা
            </Link>
            <span>/</span>
            <span>কুরিয়ার NDR রিকভারি</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            🚨 NDR ও ঝুঁকিপূর্ণ ডেলিভারি রিকভারি হাব
          </h1>
          <p className="text-sm text-slate-500">
            কুরিয়ার রাইডার কাস্টমারকে না পেলে বা ডেলিভারি ফেইল্ড হলে সরাসরি স্বয়ংক্রিয় ফলো-আপ ও পার্সেল উদ্ধার ব্যবস্থা।
          </p>
        </div>

        <button
          onClick={() => void loadData()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
        >
          🔄 রিফ্রেশ করুন
        </button>
      </div>

      {/* KPI Summary Cards */}
      {metrics && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-slate-500">মোট NDR কেস</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{metrics.total}</p>
            <p className="mt-0.5 text-[11px] text-slate-400">ডেলিভারি ব্যর্থ পার্সেল</p>
          </div>
          <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-4 shadow-sm">
            <p className="text-xs font-medium text-rose-700">জরুরি পদক্ষেপ প্রয়োজন</p>
            <p className="mt-1 text-2xl font-bold text-rose-800">{metrics.open}</p>
            <p className="mt-0.5 text-[11px] text-rose-600">কাস্টমার এখনও আনরিচড</p>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 shadow-sm">
            <p className="text-xs font-medium text-amber-700">মেসেজ পাঠানো হয়েছে</p>
            <p className="mt-1 text-2xl font-bold text-amber-800">{metrics.contacted}</p>
            <p className="mt-0.5 text-[11px] text-amber-600">রেসপন্সের অপেক্ষায়</p>
          </div>
          <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 shadow-sm">
            <p className="text-xs font-medium text-blue-700">পুনঃনির্ধারিত</p>
            <p className="mt-1 text-2xl font-bold text-blue-800">{metrics.rescheduled}</p>
            <p className="mt-0.5 text-[11px] text-blue-600">নতুন ডেলিভারি ডেট ফিক্সড</p>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-sm col-span-2 sm:col-span-1">
            <p className="text-xs font-medium text-emerald-700">রিকভারি সাকসেস রেট</p>
            <p className="mt-1 text-2xl font-bold text-emerald-800">{metrics.recoveryRatePercent}%</p>
            <p className="mt-0.5 text-[11px] text-emerald-600">রিটার্ন থেকে উদ্ধার</p>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 pb-2 text-xs">
        {[
          { key: "", label: "সবগুলো" },
          { key: "OPEN", label: "জরুরি (OPEN)" },
          { key: "CUSTOMER_CONTACTED", label: "মেসেজ পাঠানো হয়েছে" },
          { key: "RESCHEDULED", label: "পুনঃনির্ধারিত" },
          { key: "RESOLVED", label: "সমাধান হয়েছে" },
          { key: "RETURNED", label: "ফেরত" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilterStatus(tab.key)}
            className={`rounded-lg px-3 py-1.5 font-medium transition-colors ${
              filterStatus === tab.key
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Incidents Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">ডাটা লোড হচ্ছে...</div>
        ) : incidents.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-3xl">🎉</div>
            <p className="mt-2 font-semibold text-slate-800">কোনো ঝুঁকিপূর্ণ NDR পার্সেল নেই!</p>
            <p className="text-xs text-slate-500">সবগুলো পার্সেল ঠিক সময়ে ডেলিভারির পথে আছে।</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-left text-xs">
              <thead className="border-b border-slate-100 bg-slate-50 text-slate-500 font-semibold">
                <tr>
                  <th className="px-4 py-3">অর্ডার ও কাস্টমার</th>
                  <th className="px-4 py-3">কুরিয়ার ও ট্র্যাকিং</th>
                  <th className="px-4 py-3">ব্যর্থতার কারণ</th>
                  <th className="px-4 py-3">বর্তমান অবস্থা</th>
                  <th className="px-4 py-3">অ্যাকশন ও সমাধান</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {incidents.map((inc) => {
                  const badge = STATUS_BADGE[inc.status] || {
                    label: inc.status,
                    cls: "bg-slate-100 text-slate-600 border-slate-200",
                  };
                  const reasonLabel = REASON_MAP[inc.reason] || inc.reason;

                  return (
                    <tr key={inc.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-900">#{inc.orderNumber}</div>
                        <div className="text-slate-600 font-medium">{inc.customerName}</div>
                        <div className="text-slate-400 font-mono text-[11px]">{inc.customerPhone}</div>
                        <div className="mt-1 font-semibold text-brand-600">
                          {formatMinor(BigInt(inc.totalAmountMinor || 0))}
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <div className="uppercase font-bold text-slate-700 tracking-wide text-[11px]">
                          {inc.provider}
                        </div>
                        <div className="font-mono text-slate-600 select-all">{inc.trackingCode}</div>
                        <div className="text-[10px] text-slate-400 mt-1">
                          তারিখ: {new Date(inc.createdAt).toLocaleDateString("bn-BD")}
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <div className="font-medium text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-2.5 py-1 inline-block">
                          {reasonLabel}
                        </div>
                        {inc.customerFeedback && (
                          <div className="mt-1 text-[11px] text-blue-700 font-medium">
                            গ্রাহকের রেসপন্স: {inc.customerFeedback}
                          </div>
                        )}
                        {inc.notes && (
                          <div className="mt-1 text-[11px] text-slate-500 whitespace-pre-wrap max-w-xs">
                            {inc.notes}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${badge.cls}`}
                        >
                          {badge.label}
                        </span>
                        {inc.rescheduleDate && (
                          <div className="mt-1 text-[11px] text-slate-600">
                            🗓️ শিডিউল: {new Date(inc.rescheduleDate).toLocaleDateString("bn-BD")}
                          </div>
                        )}
                        {inc.lastContactedAt && (
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            যোগাযোগ: {new Date(inc.lastContactedAt).toLocaleTimeString("bn-BD")}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            onClick={() => void handleContactCustomer(inc.id)}
                            disabled={actionBusy === inc.id}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            💬 {actionBusy === inc.id ? "পাঠানো হচ্ছে..." : "মেসেজ পাঠান"}
                          </button>

                          <button
                            onClick={() => {
                              setSelectedIncident(inc);
                              setRescheduleNote(inc.notes || "");
                            }}
                            className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                          >
                            🗓️ রি-শিডিউল
                          </button>

                          {inc.status !== "RESOLVED" && (
                            <button
                              onClick={() => void handleResolve(inc.id, "RESOLVED")}
                              disabled={actionBusy === inc.id}
                              className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
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
        )}
      </div>

      {/* Reschedule Modal */}
      {selectedIncident && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl animate-rise">
            <h3 className="text-base font-bold text-slate-900">
              🗓️ পার্সেল ডেলিভারি রি-শিডিউল করুন
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              অর্ডার #{selectedIncident.orderNumber} ({selectedIncident.customerName}) এর জন্য নতুন ডেলিভারি তারিখ নির্ধারণ করুন।
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  নতুন ডেলিভারির তারিখ *
                </label>
                <input
                  type="date"
                  value={rescheduleDate}
                  onChange={(e) => setRescheduleDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  বিশেষ নোট বা নির্দেশনা (কুরিয়ারের জন্য)
                </label>
                <textarea
                  rows={3}
                  value={rescheduleNote}
                  onChange={(e) => setRescheduleNote(e.target.value)}
                  placeholder="যেমন: গ্রাহক আগামীকাল দুপুর ২টার পর রিসিভ করবেন"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium focus:border-brand-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                onClick={() => setSelectedIncident(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                বাতিল
              </button>
              <button
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
