"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinor } from "@repo/contracts";
import { EmptyState, ResponsiveTable } from "@repo/ui";
import { useToast } from "@repo/ui/client";

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
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"batches" | "missing" | "upload">("batches");
  const [batches, setBatches] = useState<DisbursementBatch[]>([]);
  const [missingData, setMissingData] = useState<MissingDisbursementsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const orgId = typeof window !== "undefined" ? getOrganizationId() ?? "" : "";

  const loadData = useCallback(async () => {
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
  }, [orgId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function openBatchDetail(batchId: string) {
    if (!orgId) return;
    setDetailLoading(true);
    try {
      const res = await apiFetch<any>(`/organizations/${orgId}/courier/reconciliation/batches/${batchId}`);
      setSelectedBatch(res);
      setClaimSheet(null);
    } catch (err: any) {
      toast({ title: err?.message || "ব্যাচ বিস্তারিত লোড করতে ব্যর্থ।", tone: "error" });
    } finally {
      setDetailLoading(false);
    }
  }

  async function loadClaimSheet(batchId: string) {
    if (!orgId) return;
    try {
      const sheet = await apiFetch<any>(`/organizations/${orgId}/courier/reconciliation/batches/${batchId}/claim-sheet`);
      setClaimSheet(sheet);
    } catch (err: any) {
      toast({ title: err?.message || "ক্লেইম শিট লোড করতে ব্যর্থ।", tone: "error" });
    }
  }

  async function handleDisputeSave() {
    if (!disputeItem || !orgId) return;
    setDisputeBusy(true);
    try {
      await apiFetch(`/organizations/${orgId}/courier/reconciliation/items/${disputeItem.id}/dispute`, {
        method: "POST",
        body: JSON.stringify({
          disputeStatus,
          notes: disputeNotes,
        }),
      });
      toast({ title: `ট্র্যাকিং ${disputeItem.trackingCode}-এর ডিসপিউট স্ট্যাটাস আপডেট হয়েছে।`, tone: "success" });
      setDisputeItem(null);
      if (selectedBatch) {
        await openBatchDetail(selectedBatch.id);
      }
    } catch (err: any) {
      toast({ title: err?.message || "ডিসপিউট আপডেট ব্যর্থ।", tone: "error" });
    } finally {
      setDisputeBusy(false);
    }
  }

  async function handleUploadSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    if (!referenceNo.trim()) {
      toast({ title: "অনুগ্রহ করে স্টেটমেন্ট রেফারেন্স বা ইনভয়েস নম্বর দিন।", tone: "error" });
      return;
    }
    if (!rawCsvText.trim()) {
      toast({ title: "অনুগ্রহ করে CSV ডাটা পেস্ট করুন।", tone: "error" });
      return;
    }

    setUploadBusy(true);
    setError(null);
    try {
      const lines = rawCsvText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

      const items: any[] = [];
      for (const line of lines) {
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
        toast({ title: "কোনো সঠিক ট্র্যাকিং ও অ্যামাউন্ট রেকর্ড পাওয়া যায়নি। ফরম্যাট পরীক্ষা করুন।", tone: "error" });
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

      toast({ title: `স্টেটমেন্ট সফলভাবে রিকনসিল করা হয়েছে! মোট ${res.totalOrders}টি অর্ডার অডিট সম্পন্ন।`, tone: "success" });
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

  // Handle file drop/upload
  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (text) {
        setRawCsvText(text);
        if (!referenceNo) {
          setReferenceNo(file.name.replace(/\.[^/.]+$/, ""));
        }
      }
    };
    reader.readAsText(file);
  };

  // Aggregates
  const totalCollectedAll = batches.reduce((sum, b) => sum + (b.totalCollectedMinor || 0), 0);
  const totalFeesAll = batches.reduce((sum, b) => sum + (b.totalFeeMinor || 0), 0);
  const totalNetAll = batches.reduce((sum, b) => sum + (b.netDisbursedMinor || 0), 0);
  const totalDiscrepanciesCount = batches.reduce((sum, b) => sum + (b.discrepancyCount || 0), 0);

  // EB6/ED13: row actions shared verbatim by the desktop table
  // cells and the ResponsiveTable mobile cards — same handlers.
  const renderBatchActions = (b: DisbursementBatch) => (
    <button
      type="button"
      onClick={() => void openBatchDetail(b.id)}
      className="inline-flex min-h-[44px] items-center rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:border-slate-300 active:scale-95"
    >
      বিস্তারিত অডিট →
    </button>
  );
  const renderMissingActions = (p: MissingParcel) => (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(
          `Courier: ${p.provider}\nTracking: ${p.trackingCode}\nCOD Amount: ৳${p.codAmountMinor / 100}\nDelivered: ${new Date(p.deliveredAt).toLocaleDateString()}`
        );
        toast({ title: `ট্র্যাকিং ${p.trackingCode}-এর ক্লেইম টেক্সট ক্লিপবোর্ডে কপি হয়েছে।`, tone: "success" });
      }}
      className="inline-flex min-h-[44px] items-center rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 shadow-sm transition hover:bg-rose-100 active:scale-95"
    >
      📋 ক্লেইম কপি
    </button>
  );

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
            <span className="text-slate-700">কুরিয়ার ক্যাশ রিকনসিলিয়েশন</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              💰 কুরিয়ার ক্যাশ রিকনসিলিয়েশন ও মিসিং পেমেন্ট
            </h1>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Steadfast, Pathao ও RedX-এর পে-আউট স্টেটমেন্ট অডিট করুন। কম টাকা দেওয়া বা হারিয়ে যাওয়া পার্সেলের টাকা ক্লেইম করুন।
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadData()}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-95"
          >
            <span>🔄</span> রিফ্রেশ
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("upload")}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 active:scale-95"
          >
            <span>+</span> স্টেটমেন্ট আপলোড
          </button>
        </div>
      </div>


      {error && (
        <div className="flex items-center justify-between rounded-2xl bg-rose-50 border border-rose-200 p-4 text-xs font-semibold text-rose-800">
          <span>{error}</span>
          <button type="button" aria-label="বন্ধ করুন" onClick={() => setError(null)} className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-rose-600 hover:text-rose-900 font-bold">
            ✕
          </button>
        </div>
      )}

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">মোট সংগৃহীত COD</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 text-sm">
              💵
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">
            {formatMinor(totalCollectedAll)}
          </div>
          <p className="mt-0.5 text-[11px] text-slate-500">আপলোডকৃত স্টেটমেন্ট থেকে</p>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">কুরিয়ার ফি কর্তন</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600 text-sm">
              🏷️
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-600">
            {formatMinor(totalFeesAll)}
          </div>
          <p className="mt-0.5 text-[11px] text-emerald-700 font-medium">নেট ডিপোজিট: {formatMinor(totalNetAll)}</p>
        </div>

        <div className="rounded-2xl border border-amber-200/80 bg-amber-50/50 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-800">অডিটকৃত অমিল পার্সেল</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-800 text-sm">
              ⚠️
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold text-amber-900">
            {totalDiscrepanciesCount} টি
          </div>
          <p className="mt-0.5 text-[11px] text-amber-700 font-medium">কম টাকা বা ভুল ফি আপত্তি</p>
        </div>

        <div className="rounded-2xl border border-rose-200/80 bg-rose-50/60 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-rose-800">🚨 ডেলিভার্ড কিন্তু অদত্ত টাকা</span>
            <span className="animate-pulse rounded-full bg-rose-500 px-1.5 py-0.2 text-[9px] font-black text-white">
              ALERT
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold text-rose-900">
            {missingData ? formatMinor(missingData.totalMissingAmountMinor) : "৳০.০০"}
          </div>
          <p className="mt-0.5 text-[11px] text-rose-700 font-semibold">
            {missingData ? missingData.totalMissingParcels : 0}টি পার্সেল ৭+ দিন পার হলেও টাকা আসেনি!
          </p>
        </div>
      </div>

      {/* Segmented Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto rounded-2xl border border-slate-200/80 bg-white p-1.5 shadow-sm">
        <button
          type="button"
          onClick={() => setActiveTab("batches")}
          className={`flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition ${
            activeTab === "batches"
              ? "bg-slate-900 text-white shadow-sm"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          }`}
        >
          <span>📄 পে-আউট ব্যাচ অডিট ইতিহাস ({batches.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("missing")}
          className={`flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition ${
            activeTab === "missing"
              ? "bg-rose-700 text-white shadow-sm"
              : "text-rose-700 hover:bg-rose-50"
          }`}
        >
          <span>🚨 মিসিং ক্যাশ ফাইন্ডার</span>
          {missingData && missingData.totalMissingParcels > 0 && (
            <span className="rounded-full bg-rose-900 px-2 py-0.2 text-[10px] font-bold text-white">
              {missingData.totalMissingParcels}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("upload")}
          className={`flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition ${
            activeTab === "upload"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          }`}
        >
          <span>⬆️ নতুন স্টেটমেন্ট আপলোড</span>
        </button>
      </div>

      {/* TAB 1: BATCHES */}
      {activeTab === "batches" && (
        <div className="space-y-4">
          {batches.length === 0 ? (
            <EmptyState
              title="কোনো রিকনসিলিয়েশন স্টেটমেন্ট নেই"
              description="Steadfast বা Pathao থেকে পাওয়া সাপ্তাহিক পেমেন্ট এক্সেল বা CSV আপলোড করে স্বয়ংক্রিয়ভাবে টাকা মিলিয়ে নিন।"
              action={(
                <button
                  type="button"
                  onClick={() => setActiveTab("upload")}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"
                >
                  + প্রথম স্টেটমেন্ট আপলোড করুন
                </button>
              )}
            />
          ) : (
            <ResponsiveTable table={<div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-100 bg-slate-50/75 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
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
                      <tr key={b.id} className="transition hover:bg-slate-50/70">
                        <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                          {b.referenceNo}
                          <p className="text-[10px] text-slate-500 font-sans font-normal">
                            {new Date(b.createdAt).toLocaleString("bn-BD")}
                          </p>
                        </td>
                        <td className="py-3.5 px-4 uppercase font-bold text-slate-700 text-[11px]">
                          {b.provider}
                        </td>
                        <td className="py-3.5 px-4 font-semibold text-slate-800">{b.totalOrders}টি</td>
                        <td className="py-3.5 px-4 font-semibold text-slate-900">
                          {formatMinor(b.totalCollectedMinor)}
                        </td>
                        <td className="py-3.5 px-4 text-slate-500 font-medium">
                          {formatMinor(b.totalFeeMinor)}
                        </td>
                        <td className="py-3.5 px-4 font-bold text-emerald-700">
                          {formatMinor(b.netDisbursedMinor)}
                        </td>
                        <td className="py-3.5 px-4">
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
                        <td className="py-3.5 px-4 text-right">{renderBatchActions(b)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>} cards={batches.map((b) => (<div key={b.id} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">রেফারেন্স / ইনভয়েস</dt><dd className="text-right"><><span className="font-mono font-bold text-slate-900">{b.referenceNo}</span><span className="block text-[10px] font-normal text-slate-500">{new Date(b.createdAt).toLocaleString("bn-BD")}</span></></dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">কুরিয়ার</dt><dd className="text-right"><span className="text-[11px] font-bold uppercase text-slate-700">{b.provider}</span></dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">মোট অর্ডার</dt><dd className="text-right">{b.totalOrders}টি</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">সংগৃহীত COD</dt><dd className="text-right">{formatMinor(b.totalCollectedMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">কর্তন ফি</dt><dd className="text-right">{formatMinor(b.totalFeeMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">নেট ডিপোজিট</dt><dd className="text-right">{formatMinor(b.netDisbursedMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">স্ট্যাটাস</dt><dd className="text-right">{b.discrepancyCount > 0 ? (<span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">⚠️ {b.discrepancyCount} অমিল</span>) : (<span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">✓ শতভাগ মিলেছে</span>)}</dd></div></dl><div className="mt-2 text-right">{renderBatchActions(b)}</div></div>))} />
          )}
        </div>
      )}

      {/* TAB 2: MISSING MONEY FINDER */}
      {activeTab === "missing" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-5 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xl">🚨</span>
              <h3 className="text-sm font-bold text-rose-900">
                ডেলিভারি হওয়া কিন্তু অদত্ত টাকা সতর্কতা (Missing Money Finder)
              </h3>
            </div>
            <p className="text-xs text-rose-800 leading-relaxed">
              এই পার্সেলগুলো কুরিয়ার দ্বারা সফলভাবে ডেলিভার্ড হয়েছে ৭ দিনেরও বেশি সময় আগে, কিন্তু কুরিয়ারের কোনো পে-আউট স্টেটমেন্টেই এই টাকা জমা দেওয়া হয়নি। কুরিয়ার ম্যানেজারকে অবিলম্বে ট্র্যাকিং কোডগুলো পাঠিয়ে ক্লেইম করুন।
            </p>
          </div>

          {!missingData || missingData.parcels.length === 0 ? (
            <EmptyState title="কোনো মিসিং পেমেন্ট নেই!" description="ডেলিভারি হওয়া সকল পার্সেলের টাকা সময়মতো কুরিয়ার স্টেটমেন্টে ক্রেডিট হয়েছে।" />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
              <div className="border-b bg-slate-50/75 px-4 py-3 font-semibold text-xs text-slate-700 flex items-center justify-between">
                <span>মিসিং পার্সেল তালিকা ({missingData.parcels.length}টি)</span>
                <span className="font-bold text-rose-700">
                  মোট অপরিশোধিত: {formatMinor(missingData.totalMissingAmountMinor)}
                </span>
              </div>
              <ResponsiveTable className="p-3 md:p-0" table={<div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50/75 border-b border-slate-200 text-slate-500 font-semibold">
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
                      <tr key={p.id} className="transition hover:bg-rose-50/20">
                        <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                          {p.trackingCode}
                        </td>
                        <td className="py-3.5 px-4 uppercase font-bold text-slate-600 text-[11px]">
                          {p.provider}
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="font-semibold text-slate-800">{p.recipientName}</span>
                          <p className="text-[10px] text-slate-500 font-mono">{p.recipientPhone}</p>
                        </td>
                        <td className="py-3.5 px-4 font-bold text-rose-700">
                          {formatMinor(p.codAmountMinor)}
                        </td>
                        <td className="py-3.5 px-4 text-slate-500">
                          {new Date(p.deliveredAt).toLocaleDateString("bn-BD")}
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">
                            {p.daysOverdue} দিন বাকি
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right">{renderMissingActions(p)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>} cards={missingData.parcels.map((p) => (<div key={p.id} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">ট্র্যাকিং কোড</dt><dd className="text-right"><span className="font-mono font-bold text-slate-900">{p.trackingCode}</span></dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">কুরিয়ার</dt><dd className="text-right"><span className="text-[11px] font-bold uppercase text-slate-600">{p.provider}</span></dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">গ্রাহকের নাম ও ফোন</dt><dd className="text-right"><><span className="font-semibold text-slate-800">{p.recipientName}</span><span className="block font-mono text-[10px] font-normal text-slate-500">{p.recipientPhone}</span></></dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">প্রত্যাশিত COD</dt><dd className="text-right">{formatMinor(p.codAmountMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">ডেলিভারির তারিখ</dt><dd className="text-right">{new Date(p.deliveredAt).toLocaleDateString("bn-BD")}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">বিলম্বিত দিন</dt><dd className="text-right"><span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">{p.daysOverdue} দিন বাকি</span></dd></div></dl><div className="mt-2 text-right">{renderMissingActions(p)}</div></div>))} />
            </div>
          )}
        </div>
      )}

      {/* TAB 3: UPLOAD STATEMENT */}
      {activeTab === "upload" && (
        <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm space-y-6 max-w-3xl">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              কুরিয়ার পে-আউট স্টেটমেন্ট আপলোড ও স্বয়ংক্রিয় অডিট
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              কুরিয়ার পোর্টাল থেকে ডাউনলোড করা CSV ফাইল ড্রপ করুন অথবা টেক্সট পেস্ট করে অডিট চালান।
            </p>
          </div>

          <form onSubmit={handleUploadSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700">কুরিয়ার নির্বাচন করুন</label>
                <select
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold focus:ring-2 focus:ring-indigo-500"
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
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500"
                  value={referenceNo}
                  onChange={(e) => setReferenceNo(e.target.value)}
                />
              </div>
            </div>

            {/* Drag & drop file zone */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) handleFileUpload(f);
              }}
              className="rounded-2xl border-2 border-dashed border-slate-200 p-6 text-center hover:border-indigo-400 bg-slate-50/50 transition cursor-pointer"
            >
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                id="csv-file-input"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileUpload(f);
                }}
              />
              <label htmlFor="csv-file-input" className="cursor-pointer block space-y-1">
                <span className="text-2xl">📁</span>
                <div className="text-xs font-bold text-slate-700">
                  CSV ফাইল ড্রপ করুন বা ব্রাউজ করুন
                </div>
                <div className="text-[11px] text-slate-500">
                  Steadfast বা Pathao পেমেন্ট স্টেটমেন্ট CSV ফাইল সিলেক্ট করুন
                </div>
              </label>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold text-slate-700">
                  CSV ডাটা টেক্সট <span className="text-red-500">*</span>
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
                  className="text-xs font-medium text-indigo-600 hover:underline"
                >
                  📝 ডেমো ডাটা লোড করুন
                </button>
              </div>
              <textarea
                rows={6}
                required
                className="mt-1.5 w-full rounded-2xl border border-slate-200 p-3 font-mono text-xs focus:ring-2 focus:ring-indigo-500"
                placeholder="ST-1001,1500,120,1380&#10;ST-1002,2200,150,2050"
                value={rawCsvText}
                onChange={(e) => setRawCsvText(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setActiveTab("batches")}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                বাতিল
              </button>
              <button
                type="submit"
                disabled={uploadBusy}
                className="rounded-xl bg-slate-900 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
              >
                {uploadBusy ? "অডিট হচ্ছে..." : "🔍 স্টেটমেন্ট অডিট ও রিকনসিল করুন"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Batch Detail Modal */}
      {selectedBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs animate-fade">
          <div className="max-h-[88vh] w-full max-w-4xl flex flex-col rounded-3xl bg-white shadow-2xl overflow-hidden animate-rise">
            {/* Header */}
            <div className="border-b border-slate-100 bg-slate-50/80 px-6 py-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-sm text-slate-900">{selectedBatch.referenceNo}</span>
                  <span className="uppercase text-[10px] font-bold text-slate-500 rounded bg-slate-200 px-1.5 py-0.2">
                    {selectedBatch.provider}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  মোট অর্ডার: {selectedBatch.totalOrders}টি | মিলেছে: {selectedBatch.matchedCount}টি | অমিল:{" "}
                  {selectedBatch.discrepancyCount}টি
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadClaimSheet(selectedBatch.id)}
                  className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100"
                >
                  📋 ক্লেইম শিট জেনারেট
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedBatch(null)}
                  aria-label="বন্ধ করুন" className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-200 p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Claim Sheet Preview */}
            {claimSheet && (
              <div className="bg-amber-50/80 border-b border-amber-200 p-4 space-y-2">
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
                  className="w-full rounded-xl border border-amber-300 bg-white p-2.5 font-mono text-[11px] text-slate-700"
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

            {/* Items Table */}
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
                    <tr key={item.id} className="hover:bg-slate-50/70 transition">
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-900">{item.trackingCode}</td>
                      <td className="py-2.5 px-3 font-semibold text-slate-700">
                        {formatMinor(item.systemCodMinor)}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-slate-900">
                        {formatMinor(item.courierCollectedMinor)}
                      </td>
                      <td className="py-2.5 px-3 text-slate-500">{formatMinor(item.courierFeeMinor)}</td>
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
                      <td className="py-2.5 px-3 font-bold text-slate-600 text-[10px]">
                        {item.disputeStatus}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setDisputeItem(item);
                            setDisputeStatus(item.disputeStatus || "OPEN");
                            setDisputeNotes(item.notes || "");
                          }}
                          className="inline-flex min-h-[44px] items-center font-semibold text-indigo-600 hover:underline"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs animate-fade">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-4 animate-rise">
            <h3 className="font-bold text-slate-900 text-sm">কুরিয়ার আপত্তি ও ডিসপিউট ট্র্যাকিং</h3>
            <p className="text-xs text-slate-500">
              ট্র্যাকিং কোড: <strong className="font-mono text-slate-800">{disputeItem.trackingCode}</strong>
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">ডিসপিউট স্ট্যাটাস</label>
                <select
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500"
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
                <label className="block text-xs font-semibold text-slate-700 mb-1">নোট বা টিকিট নম্বর</label>
                <textarea
                  rows={3}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:ring-2 focus:ring-indigo-500"
                  placeholder="যেমন: Steadfast ticket #8741 - ম্যানেজার বলেছেন রবিবারে এডজাস্ট হবে..."
                  value={disputeNotes}
                  onChange={(e) => setDisputeNotes(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDisputeItem(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                বাতিল
              </button>
              <button
                type="button"
                disabled={disputeBusy}
                onClick={() => void handleDisputeSave()}
                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50"
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
