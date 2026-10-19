"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { fmtDateTime, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  MAX_ORDERS_PER_JOB, PRINT_TYPE_OPTIONS, buildPrintJobsPath, mergeOrderIds,
  printJobStatusLabel, printTypeLabel, templatePayload, validateTemplateForm,
  type PrintJobList, type PrintJobType, type PrintTemplate,
} from "@/lib/orders-on10";

/**
 * ON10 — Print & Document Center panel (opened from the orders
 * page header or the bulk bar, same modal pattern as ON8/ON9).
 * Jobs are created server-side (PrintJob rows) and the PDF is
 * streamed back ONCE — the history below is the record of what
 * was printed (and what failed, by order id), never a stored
 * re-download. The bulk bar's print actions also land here:
 * they create jobs through the same API (see orders-bulk).
 * Bengali-first.
 */
export function OrderPrintPanel({ onClose, initialOrderIds = [] }: { onClose: () => void; initialOrderIds?: string[] }) {
  const { dict, t, locale } = useLocale();
  const orgId = getOrganizationId() ?? "";
  const base = `/organizations/${orgId}/orders`;
  const [type, setType] = useState<PrintJobType>("invoices");
  const [pasted, setPasted] = useState("");
  const [template, setTemplate] = useState<PrintTemplate>({ logoUrl: null, footerText: null, termsText: null, invoiceNote: null, updatedAt: null });
  const [history, setHistory] = useState<PrintJobList | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const merged = useMemo(() => mergeOrderIds(initialOrderIds, pasted), [initialOrderIds, pasted]);
  const overCap = merged.ids.length > MAX_ORDERS_PER_JOB;

  const load = useCallback(async () => {
    try {
      const [tpl, jobs] = await Promise.all([
        apiFetch<PrintTemplate>(`${base}/print-template`),
        apiFetch<PrintJobList>(buildPrintJobsPath(orgId, 1, 20)),
      ]);
      setTemplate(tpl);
      setHistory(jobs);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.orders.printCenterLoadFailed);
    }
  }, [base, orgId]);

  useEffect(() => { void load(); }, [load]);

  async function runJob() {
    if (merged.ids.length === 0) { setError(dict.orders.selectAtLeastOneOrder); return; }
    if (overCap) { setError(t("orders.atMostOrdersCanBe", { MAX_ORDERS_PER_JOB: MAX_ORDERS_PER_JOB })); return; }
    setBusy("job"); setError(""); setNotice("");
    try {
      // Binary PDF response — apiFetch is JSON-only, so fetch the
      // blob directly with the auth header (the page's own
      // downloadPdf pattern), as a POST this time.
      const res = await fetch(`${API_URL}${base}/print-jobs`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}`, "Content-Type": "application/json" },
        body: JSON.stringify({ type, orderIds: merged.ids }),
      });
      if (!res.ok) {
        const body: any = await res.json().catch(() => ({}));
        const failed: string[] = Array.isArray(body?.failedOrderIds) ? body.failedOrderIds : [];
        throw new Error(`${body?.message ?? `HTTP ${res.status}`}${failed.length ? t("orders.failedOrders", { failed: failed.join(", ") }) : ""}`);
      }
      const jobId = res.headers.get("X-Print-Job-Id") ?? "";
      const failedIds = (res.headers.get("X-Print-Job-Failed-Order-Ids") ?? "").split(",").filter(Boolean);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `print-${type}${jobId ? `-${jobId}` : ""}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setNotice(failedIds.length
        ? t("orders.pDFCreatedPrintedSkippedThe", { length: merged.ids.length - failedIds.length, length1: failedIds.length, failedIds: failedIds.join(", ") })
        : t("orders.pDFCreatedAllOrdersPrinted", { length: merged.ids.length }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.orders.printFailed);
      await load();
    } finally {
      setBusy("");
    }
  }

  async function saveTemplate() {
    const invalid = validateTemplateForm(template, locale);
    if (invalid) { setError(invalid); return; }
    setBusy("template"); setError("");
    try {
      const saved = await apiFetch<PrintTemplate>(`${base}/print-template`, { method: "PUT", body: JSON.stringify(templatePayload(template)) });
      setTemplate(saved);
      setNotice(dict.orders.templateSettingsSavedWillApply);
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.orders.templateSaveFailed);
    } finally {
      setBusy("");
    }
  }

  const typeHint = PRINT_TYPE_OPTIONS.find((o) => o.value === type)?.hint;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={dict.orders.printCenter2}>
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{dict.orders.printCenter}</h2>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>{dict.orders.close}</button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {dict.orders.inOneJobDocumentsFor}</p>
        {error ? <p className="mt-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        {notice ? <p className="mt-2 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p> : null}

        {/* ---- new job ---- */}
        <div className="mt-4 rounded-xl border border-slate-200 p-3">
          <h3 className="text-sm font-semibold">{dict.orders.newPrintJob}</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {PRINT_TYPE_OPTIONS.map((o) => (
              <button
                key={o.value} type="button"
                className={type === o.value ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
                onClick={() => setType(o.value)}
              >{o.label}</button>
            ))}
          </div>
          {typeHint ? <p className="mt-1 text-xs text-slate-500">{typeHint}</p> : null}
          {initialOrderIds.length > 0 ? (
            <p className="mt-2 text-sm">{dict.orders.selectedFromTheList}<strong>{initialOrderIds.length}{dict.orders.items}</strong> {dict.orders.order}</p>
          ) : null}
          <label className="mt-2 block text-sm">
            {dict.orders.additionalOrderIDsMultipleComma}<textarea
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
              rows={2} value={pasted} onChange={(e) => setPasted(e.target.value)}
              placeholder={dict.orders.pasteOrderIDs}
            />
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button type="button" className="btn-primary btn-sm" disabled={busy === "job"} onClick={runJob}>
              {busy === "job" ? dict.orders.creating : t("orders.print", { length: merged.ids.length })}
            </button>
            <span className={`text-xs ${overCap ? "font-semibold text-red-600" : "text-slate-500"}`}>
              {dict.orders.total}{merged.ids.length}{dict.orders.items}{merged.duplicatesDropped > 0 ? t("orders.duplicatesDropped", { duplicatesDropped: merged.duplicatesDropped }) : ""}
              {overCap ? t("orders.max", { MAX_ORDERS_PER_JOB: MAX_ORDERS_PER_JOB }) : ""}
            </span>
          </div>
        </div>

        {/* ---- template ---- */}
        <div className="mt-4 rounded-xl border border-slate-200 p-3">
          <h3 className="text-sm font-semibold">{dict.orders.templateSettings}</h3>
          <p className="mt-1 text-xs text-slate-500">
            {dict.orders.appliesToInvoiceDeliveryNote}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="text-sm">{dict.orders.logoURL}<input className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm" value={template.logoUrl ?? ""} onChange={(e) => setTemplate({ ...template, logoUrl: e.target.value })} placeholder="https://…" />
            </label>
            <label className="text-sm">{dict.orders.footerText}<input className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm" value={template.footerText ?? ""} onChange={(e) => setTemplate({ ...template, footerText: e.target.value })} />
            </label>
            <label className="text-sm">{dict.orders.invoiceNote}<input className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm" value={template.invoiceNote ?? ""} onChange={(e) => setTemplate({ ...template, invoiceNote: e.target.value })} />
            </label>
            <label className="text-sm">{dict.orders.terms}<input className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm" value={template.termsText ?? ""} onChange={(e) => setTemplate({ ...template, termsText: e.target.value })} />
            </label>
          </div>
          <button type="button" className="btn-secondary btn-sm mt-2" disabled={busy === "template"} onClick={saveTemplate}>
            {busy === "template" ? dict.orders.saving : dict.orders.saveTemplate}
          </button>
        </div>

        {/* ---- history ---- */}
        <div className="mt-4 rounded-xl border border-slate-200 p-3">
          <h3 className="text-sm font-semibold">{dict.orders.jobHistoryLast20}</h3>
          {history && history.items.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">{dict.orders.noPrintJobsYet}</p>
          ) : null}
          {history && history.items.length > 0 ? (
            <table className="mt-2 w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs text-slate-500">
                  <th className="py-1 pr-2">{dict.orders.time}</th><th className="py-1 pr-2">{dict.orders.type}</th>
                  <th className="py-1 pr-2">{dict.orders.order}</th><th className="py-1 pr-2">{dict.orders.failed}</th>
                  <th className="py-1 pr-2">{dict.orders.condition}</th><th className="py-1">{dict.orders.failureReasonOrder}</th>
                </tr>
              </thead>
              <tbody>
                {history.items.map((j) => (
                  <tr key={j.id} className="border-b border-slate-100 align-top">
                    <td className="py-1 pr-2 whitespace-nowrap">{j.createdAt ? fmtDateTime(locale, new Date(j.createdAt)) : "—"}</td>
                    <td className="py-1 pr-2">{printTypeLabel(j.type, locale)}</td>
                    <td className="py-1 pr-2">{j.orderCount}{dict.orders.items}</td>
                    <td className="py-1 pr-2">{j.failedOrderIds.length}{dict.orders.items}</td>
                    <td className="py-1 pr-2">{printJobStatusLabel(j, locale)}</td>
                    <td className="py-1 text-xs text-slate-600">
                      {j.status === "failed" ? (j.error ?? "—") : j.failedOrderIds.length ? j.failedOrderIds.join(", ") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>
    </div>
  );
}
