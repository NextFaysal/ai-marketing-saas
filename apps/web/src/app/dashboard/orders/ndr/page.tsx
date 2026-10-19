"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useLocale } from "@/lib/i18n/provider";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { fmtDate, fmtDateTime, fmtNumber, fmtTime, formatMinor } from "@repo/contracts";
import { EmptyState } from "@repo/ui";
import { useToast } from "@repo/ui/client";

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

const STATUS_BADGE = {
  OPEN: { labelKey: "riskyNew", bg: "bg-rose-50", text: "text-rose-700", dot: "bg-rose-500" },
  CUSTOMER_CONTACTED: { labelKey: "messageSent", bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
  RESCHEDULED: { labelKey: "rescheduled", bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500" },
  RESOLVED: { labelKey: "resolvedSuccessfully", bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  RETURNED: { labelKey: "returnConfirmed", bg: "bg-slate-100", text: "text-slate-600", dot: "bg-slate-400" },
} as const satisfies Record<string, { labelKey: string; bg: string; text: string; dot: string }>;

// ML5 i18n: values are dict.orders keys, resolved at render.
const REASON_MAP = {
  customer_unreachable: "customerDidNotAnswerUnreachable",
  hold: "heldAtCourier",
  delivery_failed: "deliveryAttemptFailed",
  failed_attempt: "firstAttemptFailed",
  address_issue: "addressIncompleteIncorrect",
  cancelled_by_customer: "customerRefusedToReceiveFor",
} as const satisfies Record<string, string>;

export default function NdrRecoveryPage() {
  const { dict, t, locale } = useLocale();
  const { toast } = useToast();
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
      toast({ title: e.message || dict.orders.messageSendingFailed, tone: "error" });
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
      toast({ title: e.message || dict.orders.rescheduleSaveFailed, tone: "error" });
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
      toast({ title: e.message || dict.orders.statusChangeFailed2, tone: "error" });
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
              {dict.orders.orderList}</Link>
            <span className="text-slate-300">/</span>
            <span className="text-slate-700">{dict.orders.courierNDRRecovery}</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              {dict.orders.nDRRiskyParcelRecoveryHub}</h1>
            {metrics && metrics.open > 0 && (
              <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-800 animate-pulse">
                {metrics.open}{dict.orders.urgentCases}</span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {dict.orders.directAutomaticFollowUpWhatsApp}</p>
        </div>

        <button
          type="button"
          onClick={() => void loadData()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-95 disabled:opacity-50"
        >
          <span>🔄</span>
          <span>{loading ? dict.orders.refreshing : dict.orders.refresh2}</span>
        </button>
      </div>

      {/* KPI Metrics Summary */}
      {metrics && (
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">{dict.orders.totalNDRCases}</span>
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600 text-sm">
                📦
              </span>
            </div>
            <div className="mt-2 text-2xl font-bold text-slate-900">{metrics.total}</div>
            <p className="mt-0.5 text-[11px] text-slate-500">{dict.orders.deliveryFailedParcels}</p>
          </div>

          <div className="rounded-2xl border border-rose-200/80 bg-rose-50/50 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-rose-700">{dict.orders.urgentAction}</span>
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-100 text-rose-700 text-sm">
                ⚠️
              </span>
            </div>
            <div className="mt-2 text-2xl font-bold text-rose-800">{metrics.open}</div>
            <p className="mt-0.5 text-[11px] text-rose-600 font-medium">{dict.orders.customerStillUnreached}</p>
          </div>

          <div className="rounded-2xl border border-amber-200/80 bg-amber-50/50 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-700">{dict.orders.messageSent2}</span>
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-700 text-sm">
                💬
              </span>
            </div>
            <div className="mt-2 text-2xl font-bold text-amber-800">{metrics.contacted}</div>
            <p className="mt-0.5 text-[11px] text-amber-600 font-medium">{dict.orders.waitingForResponse}</p>
          </div>

          <div className="rounded-2xl border border-blue-200/80 bg-blue-50/50 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-blue-700">{dict.orders.rescheduled}</span>
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-blue-700 text-sm">
                🗓️
              </span>
            </div>
            <div className="mt-2 text-2xl font-bold text-blue-800">{metrics.rescheduled}</div>
            <p className="mt-0.5 text-[11px] text-blue-600 font-medium">{dict.orders.newDeliveryDateFixed}</p>
          </div>

          <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/50 p-4 shadow-sm col-span-2 sm:col-span-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-700">{dict.orders.recoverySuccess}</span>
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 text-sm">
                🎯
              </span>
            </div>
            <div className="mt-2 text-2xl font-bold text-emerald-800">
              {metrics.recoveryRatePercent}%
            </div>
            <p className="mt-0.5 text-[11px] text-emerald-600 font-medium">{dict.orders.successfullyRecoveredFromReturn}</p>
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
              aria-label={dict.orders.searchNDRCasesByOrder}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/60 py-2 pl-9 pr-9 text-xs text-slate-900 placeholder:text-slate-400 transition hover:bg-white focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10"
              placeholder={dict.orders.searchByOrderNumberCustomer}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute inset-y-0 right-0 flex min-w-[44px] items-center justify-center pr-3 text-xs text-slate-500 hover:text-slate-600"
                aria-label={dict.orders.clearSearch}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Status Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs scrollbar-none">
          {[
            { key: "", label: dict.orders.all },
            { key: "OPEN", label: dict.orders.urgentOPEN },
            { key: "CUSTOMER_CONTACTED", label: dict.orders.messageSent3 },
            { key: "RESCHEDULED", label: dict.orders.rescheduled2 },
            { key: "RESOLVED", label: dict.orders.resolved2 },
            { key: "RETURNED", label: dict.orders.return4 },
          ].map((tab) => {
            const isActive = filterStatus === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilterStatus(tab.key)}
                className={`inline-flex min-h-[44px] shrink-0 items-center rounded-xl px-3 py-1.5 font-semibold transition ${
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
          <div className="p-8 text-center text-xs text-slate-500">{dict.orders.loadingData}</div>
        ) : filteredIncidents.length === 0 ? (
          <EmptyState
            title={searchQuery ? dict.orders.noMatchesFound2 : dict.orders.noRiskyNDRParcels}
            description={searchQuery
                ? t("orders.noCasesMatched", { searchQuery: searchQuery })
                : dict.orders.allParcelsAreOnTheir}
          />
        ) : (
          <>
            {/* Desktop View */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-100 bg-slate-50/75 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3">{dict.orders.orderCustomer}</th>
                    <th className="px-4 py-3">{dict.orders.courierTracking2}</th>
                    <th className="px-4 py-3">{dict.orders.failureReason}</th>
                    <th className="px-4 py-3">{dict.orders.currentStatus}</th>
                    <th className="px-4 py-3 text-right">{dict.orders.actionResolution}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredIncidents.map((inc) => {
                    const badge = STATUS_BADGE[inc.status as keyof typeof STATUS_BADGE] || {
                      labelKey: null as string | null, rawLabel: inc.status,
                      bg: "bg-slate-100",
                      text: "text-slate-600",
                      dot: "bg-slate-400",
                    };
                    const reasonLabel = REASON_MAP[inc.reason as keyof typeof REASON_MAP] ? dict.orders[REASON_MAP[inc.reason as keyof typeof REASON_MAP]] : inc.reason;

                    return (
                      <tr key={inc.id} className="transition hover:bg-slate-50/70">
                        {/* Order & Customer */}
                        <td className="px-4 py-3.5">
                          <div className="font-bold text-slate-900">#{inc.orderNumber}</div>
                          <div className="font-semibold text-slate-700">{inc.customerName}</div>
                          <div className="font-mono text-[11px] text-slate-500">
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
                            {fmtDateTime(locale, new Date(inc.createdAt))}
                          </div>
                        </td>

                        {/* Failure Reason */}
                        <td className="px-4 py-3.5 max-w-xs">
                          <span className="rounded-lg bg-rose-50 border border-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700 inline-block">
                            {reasonLabel}
                          </span>
                          {inc.customerFeedback && (
                            <div className="mt-1 text-[11px] font-medium text-blue-700">
                              {dict.orders.customerComment}{inc.customerFeedback}”
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
                            <span>{badge.labelKey ? dict.orders[badge.labelKey as keyof typeof dict.orders] : (badge as { rawLabel?: string }).rawLabel}</span>
                          </span>
                          {inc.rescheduleDate && (
                            <div className="mt-1 text-[11px] font-semibold text-blue-700">
                              {dict.orders.schedule}{fmtDate(locale, new Date(inc.rescheduleDate))}
                            </div>
                          )}
                          {inc.lastContactedAt && (
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              {dict.orders.message2}{fmtTime(locale, new Date(inc.lastContactedAt))}
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
                              <span>{actionBusy === inc.id ? dict.orders.sending2 : dict.orders.sendMessage}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setSelectedIncident(inc);
                                setRescheduleNote(inc.notes || "");
                              }}
                              className="rounded-xl border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 active:scale-95"
                            >
                              <span>{dict.orders.reschedule}</span>
                            </button>

                            {inc.status !== "RESOLVED" && (
                              <button
                                type="button"
                                onClick={() => void handleResolve(inc.id, "RESOLVED")}
                                disabled={actionBusy === inc.id}
                                className="rounded-xl bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
                              >
                                {dict.orders.resolved}</button>
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
                const badge = STATUS_BADGE[inc.status as keyof typeof STATUS_BADGE] || {
                  labelKey: null as string | null, rawLabel: inc.status,
                  bg: "bg-slate-100",
                  text: "text-slate-600",
                  dot: "bg-slate-400",
                };
                const reasonLabel = REASON_MAP[inc.reason as keyof typeof REASON_MAP] ? dict.orders[REASON_MAP[inc.reason as keyof typeof REASON_MAP]] : inc.reason;

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
                          <span>{badge.labelKey ? dict.orders[badge.labelKey as keyof typeof dict.orders] : (badge as { rawLabel?: string }).rawLabel}</span>
                        </span>
                        <div className="mt-1 font-bold text-slate-900 text-xs">
                          {formatMinor(BigInt(inc.totalAmountMinor || 0))}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl bg-slate-50 p-2.5 text-xs space-y-1">
                      <div className="flex items-center justify-between text-slate-500">
                        <span>{dict.orders.courier3}{inc.provider}</span>
                        <span className="font-mono font-semibold text-slate-800">{inc.trackingCode}</span>
                      </div>
                      <div className="text-rose-700 font-semibold">{dict.orders.reason}{reasonLabel}</div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => void handleContactCustomer(inc.id)}
                        disabled={actionBusy === inc.id}
                        className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700"
                      >
                        {dict.orders.message3}</button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedIncident(inc);
                          setRescheduleNote(inc.notes || "");
                        }}
                        className="inline-flex min-h-[44px] items-center rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700"
                      >
                        {dict.orders.reschedule}</button>
                      {inc.status !== "RESOLVED" && (
                        <button
                          type="button"
                          onClick={() => void handleResolve(inc.id, "RESOLVED")}
                          disabled={actionBusy === inc.id}
                          className="inline-flex min-h-[44px] items-center rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white"
                        >
                          {dict.orders.resolved}</button>
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
                {dict.orders.rescheduleParcelDelivery}</h3>
              <button
                type="button"
                onClick={() => setSelectedIncident(null)}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label={dict.orders.close}
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-500">
              {dict.orders.order3}{selectedIncident.orderNumber} ({selectedIncident.customerName}{dict.orders.setANewDeliveryDate}</p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {dict.orders.newDeliveryDate}</label>
                <input
                  type="date"
                  value={rescheduleDate}
                  onChange={(e) => setRescheduleDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {dict.orders.specialInstructionsOrNoteFor}</label>
                <textarea
                  rows={3}
                  value={rescheduleNote}
                  onChange={(e) => setRescheduleNote(e.target.value)}
                  placeholder={dict.orders.eGTheCustomerWill}
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
                {dict.common.cancel}</button>
              <button
                type="button"
                onClick={() => void handleRescheduleSubmit()}
                disabled={!rescheduleDate || actionBusy !== ""}
                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {actionBusy ? dict.orders.saving2 : dict.orders.confirm2}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
