"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useLocale } from "@/lib/i18n/provider";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber, formatMinor } from "@repo/contracts";
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
  const { dict, t, locale } = useLocale();
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
      setError(err?.message || dict.orders.thereWasAProblemLoading);
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
      toast({ title: err?.message || dict.orders.failedToLoadBatchDetails, tone: "error" });
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
      toast({ title: err?.message || dict.orders.failedToLoadClaimSheet, tone: "error" });
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
      toast({ title: t("orders.disputeStatusUpdatedForTracking", { trackingCode: disputeItem.trackingCode }), tone: "success" });
      setDisputeItem(null);
      if (selectedBatch) {
        await openBatchDetail(selectedBatch.id);
      }
    } catch (err: any) {
      toast({ title: err?.message || dict.orders.disputeUpdateFailed, tone: "error" });
    } finally {
      setDisputeBusy(false);
    }
  }

  async function handleUploadSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    if (!referenceNo.trim()) {
      toast({ title: dict.orders.pleaseGiveAStatementReference, tone: "error" });
      return;
    }
    if (!rawCsvText.trim()) {
      toast({ title: dict.orders.pleasePasteTheCSVData, tone: "error" });
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
        toast({ title: dict.orders.noValidTrackingAmountRecords, tone: "error" });
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

      toast({ title: t("orders.statementReconciledSuccessfullyAuditComplete", { totalOrders: res.totalOrders }), tone: "success" });
      setReferenceNo("");
      setRawCsvText("");
      setActiveTab("batches");
      await loadData();
      if (res?.id) {
        await openBatchDetail(res.id);
      }
    } catch (err: any) {
      setError(err?.message || dict.orders.failedToProcessTheStatement);
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
      {dict.orders.detailedAudit}</button>
  );
  const renderMissingActions = (p: MissingParcel) => (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(
          t("orders.courierTrackingCODAmountDelivered", { provider: p.provider, trackingCode: p.trackingCode, p: p.codAmountMinor / 100, p3: fmtDate(locale, new Date(p.deliveredAt)) })
        );
        toast({ title: t("orders.claimTextForTrackingCopied", { trackingCode: p.trackingCode }), tone: "success" });
      }}
      className="inline-flex min-h-[44px] items-center rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 shadow-sm transition hover:bg-rose-100 active:scale-95"
    >
      {dict.orders.copyClaim}</button>
  );

  return (
    <div className="space-y-6">
      {/* Top Header & Breadcrumbs */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 mb-1.5">
            <Link href="/dashboard/orders" className="text-indigo-600 hover:underline">
              {dict.orders.orderList}</Link>
            <span className="text-slate-300">/</span>
            <span className="text-slate-700">{dict.orders.courierCashReconciliation}</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              {dict.orders.courierCashReconciliationMissingPayments}</h1>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {dict.orders.auditSteadfastPathaoRedXPayout}</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadData()}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-95"
          >
            <span>🔄</span> {dict.orders.refresh}</button>
          <button
            type="button"
            onClick={() => setActiveTab("upload")}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 active:scale-95"
          >
            <span>+</span> {dict.orders.statementUpload}</button>
        </div>
      </div>


      {error && (
        <div className="flex items-center justify-between rounded-2xl bg-rose-50 border border-rose-200 p-4 text-xs font-semibold text-rose-800">
          <span>{error}</span>
          <button type="button" aria-label={dict.orders.close} onClick={() => setError(null)} className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-rose-600 hover:text-rose-900 font-bold">
            ✕
          </button>
        </div>
      )}

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">{dict.orders.totalCODCollected}</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 text-sm">
              💵
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">
            {formatMinor(totalCollectedAll)}
          </div>
          <p className="mt-0.5 text-[11px] text-slate-500">{dict.orders.fromTheUploadedStatement}</p>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">{dict.orders.courierFeeDeduction}</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600 text-sm">
              🏷️
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-600">
            {formatMinor(totalFeesAll)}
          </div>
          <p className="mt-0.5 text-[11px] text-emerald-700 font-medium">{dict.orders.netDeposit2}{formatMinor(totalNetAll)}</p>
        </div>

        <div className="rounded-2xl border border-amber-200/80 bg-amber-50/50 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-800">{dict.orders.auditedMismatchedParcels}</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-800 text-sm">
              ⚠️
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold text-amber-900">
            {totalDiscrepanciesCount} {dict.orders.items}</div>
          <p className="mt-0.5 text-[11px] text-amber-700 font-medium">{dict.orders.shortPaymentOrWrongFee}</p>
        </div>

        <div className="rounded-2xl border border-rose-200/80 bg-rose-50/60 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-rose-800">{dict.orders.deliveredButUnpaidMoney}</span>
            <span className="animate-pulse rounded-full bg-rose-500 px-1.5 py-0.2 text-[9px] font-black text-white">
              ALERT
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold text-rose-900">
            {missingData ? formatMinor(missingData.totalMissingAmountMinor) : dict.orders.text145goqj}
          </div>
          <p className="mt-0.5 text-[11px] text-rose-700 font-semibold">
            {missingData ? missingData.totalMissingParcels : 0}{dict.orders.parcelsPassed7DaysBut}</p>
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
          <span>{dict.orders.payoutBatchAuditHistory}{batches.length})</span>
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
          <span>{dict.orders.missingCashFinder}</span>
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
          <span>{dict.orders.uploadNewStatement}</span>
        </button>
      </div>

      {/* TAB 1: BATCHES */}
      {activeTab === "batches" && (
        <div className="space-y-4">
          {batches.length === 0 ? (
            <EmptyState
              title={dict.orders.noReconciliationStatements}
              description={dict.orders.uploadTheWeeklyPaymentExcel}
              action={(
                <button
                  type="button"
                  onClick={() => setActiveTab("upload")}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"
                >
                  {dict.orders.uploadFirstStatement}</button>
              )}
            />
          ) : (
            <ResponsiveTable table={<div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-100 bg-slate-50/75 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-4">{dict.orders.referenceInvoice}</th>
                      <th className="py-3 px-4">{dict.orders.courier2}</th>
                      <th className="py-3 px-4">{dict.orders.totalOrders}</th>
                      <th className="py-3 px-4">{dict.orders.collectedCOD}</th>
                      <th className="py-3 px-4">{dict.orders.deductionFee}</th>
                      <th className="py-3 px-4">{dict.orders.netDeposit}</th>
                      <th className="py-3 px-4">{dict.orders.status}</th>
                      <th className="py-3 px-4 text-right">{dict.orders.action}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {batches.map((b) => (
                      <tr key={b.id} className="transition hover:bg-slate-50/70">
                        <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                          {b.referenceNo}
                          <p className="text-[10px] text-slate-500 font-sans font-normal">
                            {fmtDateTime(locale, new Date(b.createdAt))}
                          </p>
                        </td>
                        <td className="py-3.5 px-4 uppercase font-bold text-slate-700 text-[11px]">
                          {b.provider}
                        </td>
                        <td className="py-3.5 px-4 font-semibold text-slate-800">{b.totalOrders}{dict.orders.items}</td>
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
                              ⚠️ {b.discrepancyCount} {dict.orders.mismatch}</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                              {dict.orders.fullyMatched}</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right">{renderBatchActions(b)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>} cards={batches.map((b) => (<div key={b.id} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.orders.referenceInvoice}</dt><dd className="text-right"><><span className="font-mono font-bold text-slate-900">{b.referenceNo}</span><span className="block text-[10px] font-normal text-slate-500">{fmtDateTime(locale, new Date(b.createdAt))}</span></></dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.orders.courier2}</dt><dd className="text-right"><span className="text-[11px] font-bold uppercase text-slate-700">{b.provider}</span></dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.orders.totalOrders}</dt><dd className="text-right">{b.totalOrders}{dict.orders.items}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.orders.collectedCOD}</dt><dd className="text-right">{formatMinor(b.totalCollectedMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.orders.deductionFee}</dt><dd className="text-right">{formatMinor(b.totalFeeMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.orders.netDeposit}</dt><dd className="text-right">{formatMinor(b.netDisbursedMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.orders.status}</dt><dd className="text-right">{b.discrepancyCount > 0 ? (<span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">⚠️ {b.discrepancyCount} {dict.orders.mismatch}</span>) : (<span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">{dict.orders.fullyMatched}</span>)}</dd></div></dl><div className="mt-2 text-right">{renderBatchActions(b)}</div></div>))} />
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
                {dict.orders.deliveredButUnpaidMoneyAlert}</h3>
            </div>
            <p className="text-xs text-rose-800 leading-relaxed">
              {dict.orders.theseParcelsWereSuccessfullyDelivered}</p>
          </div>

          {!missingData || missingData.parcels.length === 0 ? (
            <EmptyState title={dict.orders.noMissingPayments} description={dict.orders.allDeliveredParcelsMoneyHas} />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
              <div className="border-b bg-slate-50/75 px-4 py-3 font-semibold text-xs text-slate-700 flex items-center justify-between">
                <span>{dict.orders.missingParcelList}{missingData.parcels.length}{dict.orders.items2}</span>
                <span className="font-bold text-rose-700">
                  {dict.orders.totalUnpaid}{formatMinor(missingData.totalMissingAmountMinor)}
                </span>
              </div>
              <ResponsiveTable className="p-3 md:p-0" table={<div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50/75 border-b border-slate-200 text-slate-500 font-semibold">
                    <tr>
                      <th className="py-3 px-4">{dict.orders.trackingCode}</th>
                      <th className="py-3 px-4">{dict.orders.courier2}</th>
                      <th className="py-3 px-4">{dict.orders.customerNamePhone}</th>
                      <th className="py-3 px-4">{dict.orders.expectedCOD}</th>
                      <th className="py-3 px-4">{dict.orders.deliveryDate}</th>
                      <th className="py-3 px-4">{dict.orders.daysLate}</th>
                      <th className="py-3 px-4 text-right">{dict.orders.action}</th>
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
                          {fmtDate(locale, new Date(p.deliveredAt))}
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">
                            {p.daysOverdue} {dict.orders.daysLeft}</span>
                        </td>
                        <td className="py-3.5 px-4 text-right">{renderMissingActions(p)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>} cards={missingData.parcels.map((p) => (<div key={p.id} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.orders.trackingCode}</dt><dd className="text-right"><span className="font-mono font-bold text-slate-900">{p.trackingCode}</span></dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.orders.courier2}</dt><dd className="text-right"><span className="text-[11px] font-bold uppercase text-slate-600">{p.provider}</span></dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.orders.customerNamePhone}</dt><dd className="text-right"><><span className="font-semibold text-slate-800">{p.recipientName}</span><span className="block font-mono text-[10px] font-normal text-slate-500">{p.recipientPhone}</span></></dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.orders.expectedCOD}</dt><dd className="text-right">{formatMinor(p.codAmountMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.orders.deliveryDate}</dt><dd className="text-right">{fmtDate(locale, new Date(p.deliveredAt))}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.orders.daysLate}</dt><dd className="text-right"><span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">{p.daysOverdue} {dict.orders.daysLeft}</span></dd></div></dl><div className="mt-2 text-right">{renderMissingActions(p)}</div></div>))} />
            </div>
          )}
        </div>
      )}

      {/* TAB 3: UPLOAD STATEMENT */}
      {activeTab === "upload" && (
        <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm space-y-6 max-w-3xl">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              {dict.orders.courierPayoutStatementUploadAutomatic}</h3>
            <p className="text-xs text-slate-500 mt-1">
              {dict.orders.dropTheCSVFileDownloaded}</p>
          </div>

          <form onSubmit={handleUploadSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700">{dict.orders.selectCourier}</label>
                <select
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold focus:ring-2 focus:ring-indigo-500"
                  value={uploadProvider}
                  onChange={(e) => setUploadProvider(e.target.value)}
                >
                  <option value="steadfast">Steadfast Courier</option>
                  <option value="pathao">Pathao Courier</option>
                  <option value="redx">RedX</option>
                  <option value="generic">{dict.orders.otherCouriers}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  {dict.orders.invoiceReferenceNumber}<span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder={dict.orders.eGINV2026OCT}
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
                  {dict.orders.dropTheCSVFileOr2}</div>
                <div className="text-[11px] text-slate-500">
                  {dict.orders.selectASteadfastOrPathao}</div>
              </label>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold text-slate-700">
                  {dict.orders.cSVDataText}<span className="text-red-500">*</span>
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
                  {dict.orders.loadDemoData}</button>
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
                {dict.common.cancel}</button>
              <button
                type="submit"
                disabled={uploadBusy}
                className="rounded-xl bg-slate-900 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
              >
                {uploadBusy ? dict.orders.auditing : dict.orders.auditStatementReconcile}
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
                  {dict.orders.totalOrders2}{selectedBatch.totalOrders}{dict.orders.matched2}{selectedBatch.matchedCount}{dict.orders.mismatched}{" "}
                  {selectedBatch.discrepancyCount}{dict.orders.items}</p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadClaimSheet(selectedBatch.id)}
                  className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100"
                >
                  {dict.orders.generateClaimSheet}</button>
                <button
                  type="button"
                  onClick={() => setSelectedBatch(null)}
                  aria-label={dict.orders.close} className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-200 p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
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
                    {dict.orders.courierSupportClaimReport}{claimSheet.totalDiscrepancies}{dict.orders.disputeRecords}</h4>
                  <span className="text-xs font-bold text-rose-700">
                    {dict.orders.totalClaim}{formatMinor(claimSheet.totalShortfallMinor)}
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
                    t("orders.totalShortfall", { claimSheet: claimSheet.totalShortfallMinor / 100 }) +
                    claimSheet.claims
                      .map(
                        (c: any) =>
                          t("orders.trackingIssueExpectedPaidShortfall", { trackingCode: c.trackingCode, issueType: c.issueType, systemCodBdt: fmtMoney(locale, c.systemCodBdt), courierPaidBdt: fmtMoney(locale, c.courierPaidBdt), shortfallBdt: fmtMoney(locale, c.shortfallBdt) })
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
                    <th className="py-2.5 px-3">{dict.orders.trackingCode}</th>
                    <th className="py-2.5 px-3">{dict.orders.expectedCOD}</th>
                    <th className="py-2.5 px-3">{dict.orders.courierDeposited}</th>
                    <th className="py-2.5 px-3">{dict.orders.courierFee}</th>
                    <th className="py-2.5 px-3">{dict.orders.differenceShortfall}</th>
                    <th className="py-2.5 px-3">{dict.orders.status}</th>
                    <th className="py-2.5 px-3">{dict.orders.dispute}</th>
                    <th className="py-2.5 px-3 text-right">{dict.orders.action}</th>
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
                          <span className="text-slate-400">{dict.orders.text145goqj}</span>
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
                              ? dict.orders.shortPayment
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
                          {dict.orders.disputeNote}</button>
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
            <h3 className="font-bold text-slate-900 text-sm">{dict.orders.courierDisputesTracking}</h3>
            <p className="text-xs text-slate-500">
              {dict.orders.trackingCode2}<strong className="font-mono text-slate-800">{disputeItem.trackingCode}</strong>
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">{dict.orders.disputeStatus}</label>
                <select
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500"
                  value={disputeStatus}
                  onChange={(e) => setDisputeStatus(e.target.value)}
                >
                  <option value="NONE">{dict.orders.noDisputeNONE}</option>
                  <option value="OPEN">{dict.orders.disputeMarkedOPEN}</option>
                  <option value="CLAIMED">{dict.orders.ticketOpenedAtCourierCLAIMED}</option>
                  <option value="RESOLVED">{dict.orders.courierRefundedTheMoneyRESOLVED}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">{dict.orders.noteOrTicketNumber}</label>
                <textarea
                  rows={3}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:ring-2 focus:ring-indigo-500"
                  placeholder={dict.orders.eGSteadfastTicket8741}
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
                {dict.common.cancel}</button>
              <button
                type="button"
                disabled={disputeBusy}
                onClick={() => void handleDisputeSave()}
                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {disputeBusy ? dict.orders.saving2 : dict.common.save}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
