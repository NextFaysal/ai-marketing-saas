"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinor } from "@repo/contracts";

interface DisbursementBatch {
  id: string;
  provider: string;
  referenceNo: string;
  totalOrders: number;
  totalCollectedMinor: number;
  totalFeeMinor: number;
  netDisbursedMinor: number;
  matchedCount: number;
  discrepancyCount: number;
  unmatchedCount: number;
  status: string;
  createdAt: string;
}

interface DisbursementItem {
  id: string;
  trackingCode: string;
  orderId?: string | null;
  consignmentId?: string | null;
  systemCodMinor: number;
  courierCollectedMinor: number;
  courierFeeMinor: number;
  netPaidMinor: number;
  status: string; // MATCHED | UNDERPAID | OVERCHARGED_FEE | UNKNOWN_TRACKING
  discrepancyMinor: number;
  disputeStatus: string; // NONE | OPEN | CLAIMED | RESOLVED
  notes?: string | null;
  createdAt: string;
}

interface MissingParcel {
  id: string;
  orderId: string;
  trackingCode: string;
  provider: string;
  consignmentId?: string | null;
  recipientName: string;
  recipientPhone: string;
  codAmountMinor: number;
  status: string;
  deliveredAt: string;
  daysOverdue: number;
}

interface MissingDisbursementsData {
  totalMissingParcels: number;
  totalMissingAmountMinor: number;
  parcels: MissingParcel[];
}

export default function CourierReconciliationPage() {
  const [activeTab, setActiveTab] = useState<"batches" | "missing" | "upload">("batches");
  const [batches, setBatches] = useState<DisbursementBatch[]>([]);
  const [missingData, setMissingData] = useState<MissingDisbursementsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Selected batch for detail modal
  const [selectedBatch, setSelectedBatch] = useState<(DisbursementBatch & { items: DisbursementItem[] }) | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [claimSheet, setClaimSheet] = useState<any | null>(null);

  // Upload Form State
  const [uploadProvider, setUploadProvider] = useState("steadfast");
  const [referenceNo, setReferenceNo] = useState("");
  const [rawCsvText, setRawCsvText] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);

  // Dispute update modal state
  const [disputeItem, setDisputeItem] = useState<DisbursementItem | null>(null);
  const [disputeStatus, setDisputeStatus] = useState("OPEN");
  const [disputeNotes, setDisputeNotes] = useState("");
  const [disputeBusy, setDisputeBusy] = useState(false);

  const loadData = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const [batchesRes, missingRes] = await Promise.all([
        apiFetch<DisbursementBatch[]>(`/organizations/${orgId}/courier/reconciliation/batches`),
        apiFetch<MissingDisbursementsData>(`/organizations/${orgId}/courier/reconciliation/missing?days=7`),
      ]);
      setBatches(batchesRes || []);
      setMissingData(missingRes || null);
    } catch (err: any) {
      setError(err?.message || "রিকনসিলিয়েশন তথ্য লোড করতে সমস্যা হয়েছে।");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function openBatchDetail(batchId: string) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setDetailLoading(true);
    try {
      const res = await apiFetch<any>(`/organizations/${orgId}/courier/reconciliation/batches/${batchId}`);
      setSelectedBatch(res);
      setClaimSheet(null);
    } catch (err: any) {
      alert(err?.message || "ব্যাচ বিস্তারিত লোড করতে ব্যর্থ।");
    } finally {
      setDetailLoading(false);
    }
  }

  async function loadClaimSheet(batchId: string) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const sheet = await apiFetch<any>(`/organizations/${orgId}/courier/reconciliation/batches/${batchId}/claim-sheet`);
      setClaimSheet(sheet);
    } catch (err: any) {
      alert(err?.message || "ক্লেইম শিট লোড করতে ব্যর্থ।");
    }
  }

  async function handleDisputeSave() {
    if (!disputeItem) return;
    const orgId = getOrganizationId();
    if (!orgId) return;
    setDisputeBusy(true);
    try {
      await apiFetch(`/organizations/${orgId}/courier/reconciliation/items/${disputeItem.id}/dispute`, {
        method: "POST",
        body: JSON.stringify({
          disputeStatus,
          notes: disputeNotes,
        }),
      });
      setNotice(`ট্র্যাকিং ${disputeItem.trackingCode}-এর ডিসপিউট স্ট্যাটাস আপডেট হয়েছে।`);
      setDisputeItem(null);
      if (selectedBatch) {
        await openBatchDetail(selectedBatch.id);
      }
    } catch (err: any) {
      alert(err?.message || "ডিসপিউট আপডেট ব্যর্থ।");
    } finally {
      setDisputeBusy(false);
    }
  }

  async function handleUploadSubmit(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId();
    if (!orgId) return;
    if (!referenceNo.trim()) {
      alert("অনুগ্রহ করে স্টেটমেন্ট রেফারেন্স বা ইনভয়েস নম্বর দিন।");
      return;
    }
    if (!rawCsvText.trim()) {
      alert("অনুগ্রহ করে CSV ডাটা পেস্ট করুন।");
      return;
    }

    setUploadBusy(true);
    setError(null);
    try {
      // Parse CSV rows: trackingCode, courierCollectedMinor, courierFeeMinor, netPaidMinor
      const lines = rawCsvText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

      const items: any[] = [];
      for (const line of lines) {
        // Skip header if contains 'tracking'
        if (line.toLowerCase().includes("tracking")) continue;

        const parts = line.split(",").map((p) => p.trim());
        if (parts.length >= 2) {
          const trackingCode = parts[0];
          const collectedBdt = parseFloat(parts[1]) || 0;
          const feeBdt = parts[2] ? parseFloat(parts[2]) : 0;
          const netBdt = parts[3] ? parseFloat(parts[3]) : collectedBdt - feeBdt;

          items.push({
            trackingCode,
            courierCollectedMinor: Math.round(collectedBdt * 100),
            courierFeeMinor: Math.round(feeBdt * 100),
            netPaidMinor: Math.round(netBdt * 100),
          });
        }
      }

      if (items.length === 0) {
        alert("কোনো সঠিক ট্র্যাকিং ও অ্যামাউন্ট রেকর্ড পাওয়া যায়নি। ফরম্যাট পরীক্ষা করুন।");
        setUploadBusy(false);
        return;
      }

      const res = await apiFetch<any>(`/organizations/${orgId}/courier/reconciliation/upload`, {
        method: "POST",
        body: JSON.stringify({
          provider: uploadProvider,
          referenceNo,
          items,
        }),
      });

      setNotice(`স্টেটমেন্ট সফলভাবে রিকনসিল করা হয়েছে! মোট ${res.totalOrders}টি অর্ডার অডিট সম্পন্ন।`);
      setReferenceNo("");
      setRawCsvText("");
      setActiveTab("batches");
      await loadData();
      if (res?.id) {
        await openBatchDetail(res.id);
      }
    } catch (err: any) {
      setError(err?.message || "স্টেটমেন্ট প্রসেস করতে ব্যর্থ।");
    } finally {
      setUploadBusy(false);
    }
  }

  // Calculate high-level aggregates
  const totalCollectedAll = batches.reduce((sum, b) => sum + (b.totalCollectedMinor || 0), 0);
  const totalFeesAll = batches.reduce((sum, b) => sum + (b.totalFeeMinor || 0), 0);
  const totalNetAll = batches.reduce((sum, b) => sum + (b.netDisbursedMinor || 0), 0);
  const totalDiscrepanciesCount = batches.reduce((sum, b) => sum + (b.discrepancyCount || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/dashboard/orders" className="text-xs text-brand-600 hover:underline">
              ← অর্ডার তালিকা
            </Link>
            <span className="text-slate-300">/</span>
            <span className="text-xs font-semibold text-slate-500">কুরিয়ার ক্যাশ রিকনসিলিয়েশন</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-1">
            কুরিয়ার ক্যাশ রিকনসিলিয়েশন ও মিসিং পেমেন্ট ফাইন্ডার
          </h1>
          <p className="text-xs text-slate-500">
            Steadfast, Pathao ও RedX-এর পে-আউট স্টেটমেন্ট অডিট করুন। কম টাকা দেওয়া বা হারিয়ে যাওয়া ডেলিভারির টাকা ক্লেইম করুন।
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadData()}
            className="btn-ghost btn-sm text-xs font-semibold"
          >
            🔄 রিফ্রেশ
          </button>
          <button
            onClick={() => setActiveTab("upload")}
            className="btn-primary btn-sm text-xs font-bold"
          >
            + নতুন স্টেটমেন্ট আপলোড
          </button>
        </div>
      </div>

      {notice && (
        <div className="flex items-center justify-between rounded-xl bg-emerald-50 p-4 text-xs font-medium text-emerald-800 border border-emerald-200">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-emerald-600 hover:text-emerald-900 font-bold">✕</button>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-between rounded-xl bg-rose-50 p-4 text-xs font-medium text-rose-800 border border-rose-200">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-600 hover:text-rose-900 font-bold">✕</button>
        </div>
      )}

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs font-medium text-slate-500">মোট সংগৃহীত COD</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {formatMinor(totalCollectedAll)}
          </p>
          <p className="text-[11px] text-slate-400">সকল আপলোডকৃত স্টেটমেন্ট থেকে</p>
        </div>

        <div className="card p-4">
          <p className="text-xs font-medium text-slate-500">কুরিয়ার ডেলিভারি ফি কর্তন</p>
          <p className="mt-1 text-2xl font-bold text-slate-600">
            {formatMinor(totalFeesAll)}
          </p>
          <p className="text-[11px] text-slate-400">নেট পেয়েছেন: {formatMinor(totalNetAll)}</p>
        </div>

        <div className="card p-4 border-amber-200 bg-amber-50/20">
          <p className="text-xs font-medium text-amber-800">অডিটকৃত অমিল পার্সেল</p>
          <p className="mt-1 text-2xl font-bold text-amber-900">
            {totalDiscrepanciesCount} টি
          </p>
          <p className="text-[11px] text-amber-700">কম টাকা বা ফি নিয়ে আপত্তি</p>
        </div>

        <div className="card p-4 border-rose-200 bg-rose-50/40">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-rose-800">🚨 ডেলিভার্ড কিন্তু অদত্ত টাকা</p>
            <span className="animate-pulse rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-black text-white">ALERT</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-rose-900">
            {missingData ? formatMinor(missingData.totalMissingAmountMinor) : "৳০.০০"}
          </p>
          <p className="text-[11px] text-rose-700">
            {missingData ? missingData.totalMissingParcels : 0}টি পার্সেল ৭+ দিন পার হলেও টাকা আসেনি!
          </p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-slate-200">
        <nav className="flex space-x-6 text-sm">
          <button
            onClick={() => setActiveTab("batches")}
            className={`pb-3 font-semibold transition-colors border-b-2 ${
              activeTab === "batches"
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            📄 পে-আউট ব্যাচ অডিট ইতিহাস ({batches.length})
          </button>
          <button
            onClick={() => setActiveTab("missing")}
            className={`pb-3 font-semibold transition-colors border-b-2 flex items-center gap-1.5 ${
              activeTab === "missing"
                ? "border-rose-600 text-rose-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <span>🚨 মিসিং ক্যাশ ফাইন্ডার</span>
            {missingData && missingData.totalMissingParcels > 0 && (
              <span className="rounded-full bg-rose-600 px-1.5 py-0.2 text-[10px] font-bold text-white">
                {missingData.totalMissingParcels}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("upload")}
            className={`pb-3 font-semibold transition-colors border-b-2 ${
              activeTab === "upload"
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            ⬆️ নতুন ইনভয়েস/স্টেটমেন্ট আপলোড
          </button>
        </nav>
      </div>

      {/* Tab 1: Disbursement Batches */}
      {activeTab === "batches" && (
        <div className="space-y-4">
          {batches.length === 0 ? (
            <div className="card p-12 text-center">
              <span className="text-4xl">🧾</span>
              <h3 className="mt-3 text-base font-bold text-slate-800">কোনো রিকনসিলিয়েশন স্টেটমেন্ট নেই</h3>
              <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
                Steadfast বা Pathao থেকে পাওয়া সাপ্তাহিক/পাক্ষিক পেমেন্ট এক্সেল বা CSV আপলোড করে স্বয়ংক্রিয়ভাবে টাকা মিলিয়ে নিন।
              </p>
              <button
                onClick={() => setActiveTab("upload")}
                className="btn-primary btn-sm mt-4 text-xs font-bold"
              >
                + প্রথম স্টেটমেন্ট আপলোড করুন
              </button>
            </div>
          ) : (
            <div className="overflow-hidden card">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
                  <tr>
                    <th className="py-3 px-4">রেফারেন্স / ইনভয়েস</th>
                    <th className="py-3 px-4">কুরিয়ার</th>
                    <th className="py-3 px-4">মোট অর্ডার</th>
                    <th className="py-3 px-4">সংগৃহীত COD</th>
                    <th className="py-3 px-4">কর্তন ফি</th>
                    <th className="py-3 px-4">নেট ডিপোজিট</th>
                    <th className="py-3 px-4">স্ট্যাটাস</th>
                    <th className="py-3 px-4 text-right">অ্যাকশন</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {batches.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-slate-800">
                        {b.referenceNo}
                        <p className="text-[10px] text-slate-400 font-sans">
                          {new Date(b.createdAt).toLocaleDateString("bn-BD")}
                        </p>
                      </td>
                      <td className="py-3 px-4 uppercase font-semibold text-slate-700">
                        {b.provider}
                      </td>
                      <td className="py-3 px-4 font-medium">{b.totalOrders}টি</td>
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {formatMinor(b.totalCollectedMinor)}
                      </td>
                      <td className="py-3 px-4 text-slate-500">
                        {formatMinor(b.totalFeeMinor)}
                      </td>
                      <td className="py-3 px-4 font-bold text-emerald-700">
                        {formatMinor(b.netDisbursedMinor)}
                      </td>
                      <td className="py-3 px-4">
                        {b.discrepancyCount > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                            ⚠️ {b.discrepancyCount} অমিল
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                            ✓ শতভাগ মিলেছে
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => void openBatchDetail(b.id)}
                          className="btn-ghost btn-sm text-xs font-semibold text-brand-600 hover:text-brand-800"
                        >
                          বিস্তারিত ও অডিট →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Missing Money Alert */}
      {activeTab === "missing" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-5 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xl">🚨</span>
              <h3 className="text-sm font-bold text-rose-900">
                ডেলিভারি হওয়া কিন্তু অদত্ত টাকা সতর্কতা (Missing Money Finder)
              </h3>
            </div>
            <p className="text-xs text-rose-800 max-w-3xl leading-relaxed">
              এই পার্সেলগুলো কুরিয়ার দ্বারা সফলভাবে ডেলিভার্ড হয়েছে ৭ দিনেরও বেশি সময় আগে, কিন্তু কুরিয়ারের পাঠানো কোনো পে-আউট স্টেটমেন্টেই এই টাকা ক্রেডিট করা হয়নি। কুরিয়ার ম্যানেজারকে অবিলম্বে ট্র্যাকিং কোডগুলো পাঠিয়ে ক্লেইম করুন।
            </p>
          </div>

          {!missingData || missingData.parcels.length === 0 ? (
            <div className="card p-12 text-center">
              <span className="text-4xl">🎉</span>
              <h3 className="mt-3 text-base font-bold text-slate-800">কোনো মিসিং পেমেন্ট নেই!</h3>
              <p className="mt-1 text-xs text-slate-500">
                ডেলিভারি হওয়া সকল পার্সেলের টাকা সময়মতো কুরিয়ার স্টেটমেন্টে ক্রেডিট হয়েছে।
              </p>
            </div>
          ) : (
            <div className="overflow-hidden card">
              <div className="border-b bg-slate-50 px-4 py-3 font-semibold text-xs text-slate-700 flex items-center justify-between">
                <span>মিসিং পার্সেল তালিকা ({missingData.parcels.length}টি)</span>
                <span className="font-bold text-rose-700">
                  মোট অপরিশোধিত: {formatMinor(missingData.totalMissingAmountMinor)}
                </span>
              </div>
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
                  <tr>
                    <th className="py-3 px-4">ট্র্যাকিং কোড</th>
                    <th className="py-3 px-4">কুরিয়ার</th>
                    <th className="py-3 px-4">গ্রাহকের নাম ও ফোন</th>
                    <th className="py-3 px-4">প্রত্যাশিত COD</th>
                    <th className="py-3 px-4">ডেলিভারির তারিখ</th>
                    <th className="py-3 px-4">বিলম্বিত দিন</th>
                    <th className="py-3 px-4 text-right">অ্যাকশন</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {missingData.parcels.map((p) => (
                    <tr key={p.id} className="hover:bg-rose-50/20 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-slate-900">
                        {p.trackingCode}
                      </td>
                      <td className="py-3 px-4 uppercase font-semibold text-slate-600">
                        {p.provider}
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-medium text-slate-800">{p.recipientName}</span>
                        <p className="text-[10px] text-slate-400 font-mono">{p.recipientPhone}</p>
                      </td>
                      <td className="py-3 px-4 font-bold text-rose-700">
                        {formatMinor(p.codAmountMinor)}
                      </td>
                      <td className="py-3 px-4 text-slate-500">
                        {new Date(p.deliveredAt).toLocaleDateString("bn-BD")}
                      </td>
                      <td className="py-3 px-4">
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">
                          {p.daysOverdue} দিন বাকি
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(
                              `Courier: ${p.provider}\nTracking: ${p.trackingCode}\nCOD Amount: ৳${p.codAmountMinor / 100}\nDelivered: ${new Date(p.deliveredAt).toLocaleDateString()}`
                            );
                            setNotice(`ট্র্যাকিং ${p.trackingCode}-এর ক্লেইম বিবরণী ক্লিপবোর্ডে কপি হয়েছে।`);
                          }}
                          className="btn-ghost btn-sm text-xs font-semibold text-rose-700 hover:bg-rose-100"
                        >
                          📋 ক্লেইম টেক্সট কপি
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Upload Statement */}
      {activeTab === "upload" && (
        <div className="card p-6 space-y-6 max-w-3xl">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              কুরিয়ার পে-আউট স্টেটমেন্ট আপলোড ও স্বয়ংক্রিয় অডিট
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              কুরিয়ার পোর্টাল (Steadfast, Pathao, RedX) থেকে ডাউনলোড করা CSV ফাইলের টেক্সট পেস্ট করুন অথবা ম্যানুয়ালি লাইন যুক্ত করুন।
            </p>
          </div>

          <form onSubmit={handleUploadSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700">কুরিয়ার নির্বাচন করুন</label>
                <select
                  className="input mt-1 w-full text-xs"
                  value={uploadProvider}
                  onChange={(e) => setUploadProvider(e.target.value)}
                >
                  <option value="steadfast">Steadfast Courier</option>
                  <option value="pathao">Pathao Courier</option>
                  <option value="redx">RedX</option>
                  <option value="generic">অন্যান্য কুরিয়ার</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  ইনভয়েস / রেফারেন্স নম্বর <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="যেমন: INV-2026-OCT-15 বা Bank TR091"
                  className="input mt-1 w-full text-xs"
                  value={referenceNo}
                  onChange={(e) => setReferenceNo(e.target.value)}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold text-slate-700">
                  CSV ডাটা পেস্ট করুন <span className="text-red-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setReferenceNo(`ST-PAYOUT-${new Date().toISOString().slice(0, 10)}`);
                    setRawCsvText(
                      `tracking_code,collected_bdt,courier_fee_bdt,net_bdt\n` +
                      `ST-TEST-001,1500,120,1380\n` +
                      `ST-TEST-002,1200,100,1100\n` +
                      `ST-TEST-999,850,80,770`
                    );
                  }}
                  className="text-xs font-medium text-brand-600 hover:underline"
                >
                  📝 ডেমো ডাটা লোড করুন
                </button>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                ফরম্যাট: <code>tracking_code,collected_amount,courier_fee,net_paid</code> (প্রতি লাইনে একটি পার্সেল)
              </p>
              <textarea
                rows={8}
                required
                className="input mt-2 w-full font-mono text-xs"
                placeholder="ST-1001,1500,120,1380&#10;ST-1002,2200,150,2050"
                value={rawCsvText}
                onChange={(e) => setRawCsvText(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setActiveTab("batches")}
                className="btn-ghost btn-sm text-xs font-semibold"
              >
                বাতিল
              </button>
              <button
                type="submit"
                disabled={uploadBusy}
                className="btn-primary btn-sm text-xs font-bold"
              >
                {uploadBusy ? "অডিট হচ্ছে..." : "🔍 স্টেটমেন্ট অডিট ও রিকনসিল করুন"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Batch Detail Modal */}
      {selectedBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="border-b bg-slate-50 px-6 py-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-sm text-slate-900">{selectedBatch.referenceNo}</span>
                  <span className="uppercase text-[11px] font-bold text-slate-500">({selectedBatch.provider})</span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  মোট অর্ডার: {selectedBatch.totalOrders}টি | মিলেছে: {selectedBatch.matchedCount}টি | অমিল: {selectedBatch.discrepancyCount}টি
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => void loadClaimSheet(selectedBatch.id)}
                  className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100"
                >
                  📋 ক্লেইম শিট জেনারেট
                </button>
                <button
                  onClick={() => setSelectedBatch(null)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 font-bold"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Claim Sheet Preview if loaded */}
            {claimSheet && (
              <div className="bg-amber-50 border-b border-amber-200 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-amber-900">
                    কুরিয়ার সাপোর্ট ক্লেইম রিপোর্ট ({claimSheet.totalDiscrepancies}টি আপত্তি রেকর্ড)
                  </h4>
                  <span className="text-xs font-bold text-rose-700">
                    মোট দাবি: {formatMinor(claimSheet.totalShortfallMinor)}
                  </span>
                </div>
                <textarea
                  readOnly
                  rows={4}
                  className="w-full rounded-lg border border-amber-300 bg-white p-2 font-mono text-[11px] text-slate-700"
                  value={
                    `Subject: Disbursement Shortfall Claim - Batch ${claimSheet.referenceNo}\n` +
                    `Courier: ${claimSheet.provider}\n` +
                    `Total Discrepancies: ${claimSheet.totalDiscrepancies}\n` +
                    `Total Shortfall: ৳${claimSheet.totalShortfallMinor / 100}\n\n` +
                    claimSheet.claims
                      .map(
                        (c: any) =>
                          `Tracking: ${c.trackingCode} | Issue: ${c.issueType} | Expected: ৳${c.systemCodBdt} | Paid: ৳${c.courierPaidBdt} | Shortfall: ৳${c.shortfallBdt}`
                      )
                      .join("\n")
                  }
                />
              </div>
            )}

            {/* Modal Body - Items Table */}
            <div className="flex-1 overflow-y-auto p-6">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b text-slate-500 font-semibold sticky top-0">
                  <tr>
                    <th className="py-2.5 px-3">ট্র্যাকিং কোড</th>
                    <th className="py-2.5 px-3">প্রত্যাশিত COD</th>
                    <th className="py-2.5 px-3">কুরিয়ার জমা দিয়েছে</th>
                    <th className="py-2.5 px-3">কুরিয়ার ফি</th>
                    <th className="py-2.5 px-3">পার্থক্য / ঘাটতি</th>
                    <th className="py-2.5 px-3">স্ট্যাটাস</th>
                    <th className="py-2.5 px-3">ডিসপিউট</th>
                    <th className="py-2.5 px-3 text-right">অ্যাকশন</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selectedBatch.items?.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                        {item.trackingCode}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-slate-700">
                        {formatMinor(item.systemCodMinor)}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-slate-900">
                        {formatMinor(item.courierCollectedMinor)}
                      </td>
                      <td className="py-2.5 px-3 text-slate-500">
                        {formatMinor(item.courierFeeMinor)}
                      </td>
                      <td className="py-2.5 px-3 font-bold">
                        {item.discrepancyMinor > 0 ? (
                          <span className="text-rose-700">-{formatMinor(item.discrepancyMinor)}</span>
                        ) : (
                          <span className="text-slate-400">৳০.০০</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            item.status === "MATCHED"
                              ? "bg-emerald-100 text-emerald-800"
                              : item.status === "UNDERPAID"
                              ? "bg-rose-100 text-rose-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {item.status === "MATCHED"
                            ? "✓ MATCHED"
                            : item.status === "UNDERPAID"
                            ? "⚠️ কম টাকা"
                            : item.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-[10px] font-bold text-slate-600">
                          {item.disputeStatus}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          onClick={() => {
                            setDisputeItem(item);
                            setDisputeStatus(item.disputeStatus || "OPEN");
                            setDisputeNotes(item.notes || "");
                          }}
                          className="btn-ghost btn-sm text-[11px] font-semibold text-brand-600"
                        >
                          আপত্তি / নোট →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Dispute Modal */}
      {disputeItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <h3 className="font-bold text-slate-900 text-sm">
              কুরিয়ার আপত্তি ও ডিসপিউট ট্র্যাকিং
            </h3>
            <p className="text-xs text-slate-500">
              ট্র্যাকিং কোড: <strong className="font-mono text-slate-800">{disputeItem.trackingCode}</strong>
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700">ডিসপিউট স্ট্যাটাস</label>
                <select
                  className="input mt-1 w-full text-xs"
                  value={disputeStatus}
                  onChange={(e) => setDisputeStatus(e.target.value)}
                >
                  <option value="NONE">কোনো আপত্তি নেই (NONE)</option>
                  <option value="OPEN">আপত্তি চিহ্নিত (OPEN)</option>
                  <option value="CLAIMED">কুরিয়ারে টিকিট খোলা হয়েছে (CLAIMED)</option>
                  <option value="RESOLVED">কুরিয়ার টাকা ফেরত দিয়েছে (RESOLVED)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">নোট বা টিকিট নম্বর</label>
                <textarea
                  rows={3}
                  className="input mt-1 w-full text-xs"
                  placeholder="যেমন: Steadfast ticket #8741 - ম্যানেজার বলেছেন আগামী রবিবারে এডজাস্ট করবেন"
                  value={disputeNotes}
                  onChange={(e) => setDisputeNotes(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDisputeItem(null)}
                className="btn-ghost btn-sm text-xs font-semibold"
              >
                বাতিল
              </button>
              <button
                type="button"
                disabled={disputeBusy}
                onClick={() => void handleDisputeSave()}
                className="btn-primary btn-sm text-xs font-bold"
              >
                {disputeBusy ? "সংরক্ষণ হচ্ছে..." : "সংরক্ষণ করুন"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
