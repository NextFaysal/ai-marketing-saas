"use client";
import React, { useCallback, useEffect, useState } from "react";
import { fmtDate, fmtDateTime, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  REPORT_TYPES,
  SCHEDULED_REPORT_TYPES,
  cadenceLabel,
  reportTypeLabel,
  scheduledRunStatusLabel,
  type ScheduledReport,
  type ScheduledReportRun,
} from "@/lib/finance-gb8";

// GB8 / GC19 — Reports hub: index of every commerce report +
// the scheduled-reports manager. This page is an index, not a
// re-render of any single report.

const EXTRA_CARDS: { href: string; titleKey: string; descriptionKey: string }[] = [
  { href: "/dashboard/commerce/promotions", titleKey: "promotionReport2", descriptionKey: "promotionPerformanceApplicationAccounts" },
  { href: "/dashboard/commerce/accounting", titleKey: "gatewayFeeReportSettlements", descriptionKey: "gatewayFeesExpectedSettlementsOn" },
  { href: "/dashboard/commerce/accounting", titleKey: "profitReportON7", descriptionKey: "profitAccountsExcludingProductCost" },
  { href: "/dashboard/orders", titleKey: "orderAnalyticsON9", descriptionKey: "overallOrderAnalysisOnThe" },
  { href: "/dashboard/commerce/finance", titleKey: "financeLedger2", descriptionKey: "salesLedgerCODDuesSettlements" },
  { href: "/dashboard/commerce/gift-cards", titleKey: "giftCardLiability2", descriptionKey: "outstandingGiftCardBalancesPeriod" },
];

export default function ReportsHubPage() {
  const { dict, t, locale } = useLocale();
  const [items, setItems] = useState<ScheduledReport[] | null>(null);
  const [listError, setListError] = useState("");
  const [busy, setBusy] = useState(false);

  const [reportType, setReportType] = useState("discounts");
  const [cadence, setCadence] = useState("weekly");
  const [format, setFormat] = useState("csv");
  const [recipients, setRecipients] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [createMsg, setCreateMsg] = useState("");
  const [createError, setCreateError] = useState("");

  const [actionMsg, setActionMsg] = useState("");
  const [actionError, setActionError] = useState("");
  const [runsById, setRunsById] = useState<Record<string, ScheduledReportRun[]>>({});
  const [runsError, setRunsError] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setListError(dict.commerce.noOrganizationSelected); return; }
    try {
      const r = await apiFetch<{ items: ScheduledReport[] }>(`/organizations/${orgId}/finance/scheduled-reports`);
      setItems(r.items ?? []);
      setListError("");
    } catch (e) { setListError(e instanceof Error ? e.message : dict.commerce.scheduledReportLoadingFailed); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setCreateMsg(""); setCreateError("");
    const emails = recipients.split(",").map((s) => s.trim()).filter(Boolean);
    if (emails.length === 0) { setCreateError(dict.commerce.giveAtLeastOneEmail); return; }
    setBusy(true);
    try {
      await apiFetch(`/organizations/${orgId}/finance/scheduled-reports`, {
        method: "POST",
        body: JSON.stringify({ reportType, cadence, format, recipients: emails, enabled }),
      });
      setCreateMsg(dict.commerce.scheduledReportCreated);
      setRecipients("");
      await load();
    } catch (err) { setCreateError(err instanceof Error ? err.message : dict.commerce.creationFailed2); }
    finally { setBusy(false); }
  }

  async function toggle(item: ScheduledReport) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setActionMsg(""); setActionError("");
    try {
      await apiFetch(`/organizations/${orgId}/finance/scheduled-reports/${item.id}`, {
        method: "PATCH", body: JSON.stringify({ enabled: !item.enabled }),
      });
      await load();
    } catch (err) { setActionError(err instanceof Error ? err.message : dict.commerce.updateFailed3); }
  }

  async function remove(item: ScheduledReport) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setActionMsg(""); setActionError("");
    try {
      await apiFetch(`/organizations/${orgId}/finance/scheduled-reports/${item.id}`, { method: "DELETE" });
      setActionMsg(dict.commerce.scheduledReportDeleted);
      await load();
    } catch (err) { setActionError(err instanceof Error ? err.message : dict.commerce.deleteFailed3); }
  }

  async function sendNow(item: ScheduledReport) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setActionMsg(""); setActionError("");
    try {
      const run = await apiFetch<ScheduledReportRun>(`/organizations/${orgId}/finance/scheduled-reports/${item.id}/send-now`, { method: "POST" });
      setActionMsg(t("commerce.sendNowResult", { scheduledRunStatusLabel: scheduledRunStatusLabel(run.status), run: run.periodLabel ? ` (${run.periodLabel})` : "" }));
      await loadRuns(item.id);
      await load();
    } catch (err) { setActionError(err instanceof Error ? err.message : dict.commerce.sendFailed3); }
  }

  async function loadRuns(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setRunsError("");
    try {
      const r = await apiFetch<{ items: ScheduledReportRun[] }>(`/organizations/${orgId}/finance/scheduled-reports/${id}/runs`);
      setRunsById((prev) => ({ ...prev, [id]: r.items ?? [] }));
    } catch (err) { setRunsError(err instanceof Error ? err.message : dict.commerce.historyLoadingFailed); }
  }

  const inputCls = "w-full rounded-lg border px-3 py-2 text-sm";
  const labelCls = "mb-1 block text-xs font-semibold text-slate-700";

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <div>
        <h1 className="page-title">{dict.commerce.reports2}</h1>
        <p className="text-sm text-slate-500">{dict.commerce.allReportsOfSalesDiscounts}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORT_TYPES.map((r) => (
          <Link key={r.type} href={`/dashboard/commerce/reports/${r.type}`} className="card block p-5 transition hover:shadow-md">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold">{r.label}</div>
              <span className="text-slate-400">→</span>
            </div>
            <p className="mt-2 text-sm text-slate-500">{r.description}</p>
          </Link>
        ))}
        {EXTRA_CARDS.map((c) => (
          <Link key={c.titleKey} href={c.href} className="card block p-5 transition hover:shadow-md">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold">{dict.commerce[c.titleKey as keyof typeof dict.commerce]}</div>
              <span className="text-slate-400">→</span>
            </div>
            <p className="mt-2 text-sm text-slate-500">{dict.commerce[c.descriptionKey as keyof typeof dict.commerce]}</p>
          </Link>
        ))}
      </div>

      {/* Scheduled reports manager */}
      <div className="card space-y-4 p-5">
        <h2 className="font-semibold">{dict.commerce.scheduledReports}</h2>
        <p className="text-xs text-slate-500">
          {dict.commerce.theReportIsSentAs}</p>

        <form onSubmit={create} className="grid grid-cols-1 gap-4 rounded-lg bg-slate-50 p-4 md:grid-cols-2">
          <div>
            <label className={labelCls}>{dict.commerce.reportType}</label>
            <select className={inputCls} value={reportType} onChange={(e) => setReportType(e.target.value)}>
              {SCHEDULED_REPORT_TYPES.map((r) => <option key={r.type} value={r.type}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>{dict.commerce.whenToSend}</label>
            <select className={inputCls} value={cadence} onChange={(e) => setCadence(e.target.value)}>
              <option value="daily">{dict.commerce.everyDay}</option>
              <option value="weekly">{dict.commerce.everyWeek}</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>{dict.commerce.format}</label>
            <select className={inputCls} value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="csv">CSV</option>
              <option value="xlsx">XLSX</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>{dict.commerce.recipientEmailsSeparateWithCommas}</label>
            <textarea className={inputCls} rows={2} value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="owner@example.com, accounts@example.com" />
          </div>
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            {dict.commerce.keepEnabled}</label>
          {createMsg ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700 md:col-span-2">{createMsg}</p> : null}
          {createError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 md:col-span-2">{createError}</p> : null}
          <div className="md:col-span-2">
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? dict.commerce.creating : dict.commerce.addScheduledReport}</button>
          </div>
        </form>

        {listError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{listError}</p> : null}
        {actionMsg ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{actionMsg}</p> : null}
        {actionError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{actionError}</p> : null}
        {!items && !listError ? <p className="text-sm text-slate-400">{dict.common.loading}</p> : null}
        {items && items.length === 0 ? <p className="text-sm text-slate-400">{dict.commerce.noScheduledReportsYet}</p> : null}
        {items && items.length > 0 ? (
          <div className="space-y-3">
            {items.map((item) => (
              <div key={item.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-semibold">{reportTypeLabel(item.reportType)}</span>
                    <span className="text-slate-500"> · {cadenceLabel(item.cadence)} · {item.format.toUpperCase()} · {item.enabled ? dict.commerce.on : dict.commerce.closed}</span>
                    <div className="mt-1 text-xs text-slate-500">{dict.commerce.recipient}{item.recipients.join(", ")}</div>
                    <div className="text-xs text-slate-400">{dict.commerce.lastSent}{item.lastRunAt ? fmtDateTime(locale, new Date(item.lastRunAt)) : dict.commerce.notSentYet} {dict.commerce.created3}{fmtDate(locale, new Date(item.createdAt))}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary" onClick={() => void toggle(item)}>{item.enabled ? dict.commerce.close : dict.commerce.enable}</button>
                    <button type="button" className="btn-secondary" onClick={() => void sendNow(item)}>{dict.commerce.sendNow}</button>
                    <button type="button" className="btn-secondary" onClick={() => void loadRuns(item.id)}>{dict.commerce.history}</button>
                    <button type="button" className="btn-secondary text-red-600" onClick={() => void remove(item)}>{dict.commerce.delete}</button>
                  </div>
                </div>
                {runsById[item.id] ? (
                  <div className="mt-3 border-t pt-3">
                    {runsError ? <p className="text-xs text-red-600">{runsError}</p> : null}
                    {runsById[item.id].length === 0 ? <p className="text-xs text-slate-400">{dict.commerce.noRunHistory}</p> : (
                      <ul className="space-y-1 text-xs text-slate-600">
                        {runsById[item.id].map((run) => (
                          <li key={run.id} className="flex flex-wrap gap-2">
                            <span className="font-medium">{run.periodLabel}</span>
                            <span>{scheduledRunStatusLabel(run.status)}</span>
                            {run.testRun ? <span className="rounded bg-slate-100 px-1">{dict.commerce.sendNow2}</span> : null}
                            <span className="text-slate-400">{fmtDateTime(locale, new Date(run.createdAt))}</span>
                            {run.detail ? <span className="text-slate-500">— {run.detail}</span> : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
