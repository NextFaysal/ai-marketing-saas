"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
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
      setError(e instanceof Error ? e.message : "প্রিন্ট সেন্টার লোড ব্যর্থ হয়েছে");
    }
  }, [base, orgId]);

  useEffect(() => { void load(); }, [load]);

  async function runJob() {
    if (merged.ids.length === 0) { setError("কমপক্ষে একটি অর্ডার বেছে নিন বা আইডি লিখুন"); return; }
    if (overCap) { setError(`একবারে সর্বোচ্চ ${MAX_ORDERS_PER_JOB}টি অর্ডার ছাপা যায়`); return; }
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
        throw new Error(`${body?.message ?? `HTTP ${res.status}`}${failed.length ? ` (ব্যর্থ অর্ডার: ${failed.join(", ")})` : ""}`);
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
        ? `PDF তৈরি হয়েছে — ${merged.ids.length - failedIds.length}টি ছাপা হয়েছে, ${failedIds.length}টি বাদ গেছে (${failedIds.join(", ")}): কারণ ইতিহাসে জব রেকর্ডে আছে।`
        : `PDF তৈরি হয়েছে — ${merged.ids.length}টি অর্ডারই ছাপা হয়েছে।`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "প্রিন্ট ব্যর্থ হয়েছে");
      await load();
    } finally {
      setBusy("");
    }
  }

  async function saveTemplate() {
    const invalid = validateTemplateForm(template);
    if (invalid) { setError(invalid); return; }
    setBusy("template"); setError("");
    try {
      const saved = await apiFetch<PrintTemplate>(`${base}/print-template`, { method: "PUT", body: JSON.stringify(templatePayload(template)) });
      setTemplate(saved);
      setNotice("টেমপ্লেট সেটিংস সংরক্ষিত হয়েছে — পরের প্রিন্ট জব থেকে প্রযোজ্য হবে।");
    } catch (e) {
      setError(e instanceof Error ? e.message : "টেমপ্লেট সংরক্ষণ ব্যর্থ হয়েছে");
    } finally {
      setBusy("");
    }
  }

  const typeHint = PRINT_TYPE_OPTIONS.find((o) => o.value === type)?.hint;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="প্রিন্ট সেন্টার">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">🖨️ প্রিন্ট সেন্টার</h2>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>বন্ধ করুন</button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          এক জবে ১–১০০টি অর্ডারের ডকুমেন্ট একটাই PDF-তে নামে। PDF সংরক্ষিত থাকে না — নিচের ইতিহাস শুধু জবের রেকর্ড
          (কোনগুলো ছাপা হয়েছে, কোনগুলো ব্যর্থ)। বাল্ক বারের প্রিন্টও এই একই জব তৈরি করে।
        </p>
        {error ? <p className="mt-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        {notice ? <p className="mt-2 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p> : null}

        {/* ---- new job ---- */}
        <div className="mt-4 rounded-xl border border-slate-200 p-3">
          <h3 className="text-sm font-semibold">নতুন প্রিন্ট জব</h3>
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
            <p className="mt-2 text-sm">তালিকা থেকে বেছে নেওয়া: <strong>{initialOrderIds.length}টি</strong> অর্ডার</p>
          ) : null}
          <label className="mt-2 block text-sm">
            অতিরিক্ত অর্ডার আইডি (কমা/নতুন লাইন দিয়ে একাধিক)
            <textarea
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
              rows={2} value={pasted} onChange={(e) => setPasted(e.target.value)}
              placeholder="অর্ডার আইডি পেস্ট করুন…"
            />
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button type="button" className="btn-primary btn-sm" disabled={busy === "job"} onClick={runJob}>
              {busy === "job" ? "তৈরি হচ্ছে…" : `🖨️ প্রিন্ট করুন (${merged.ids.length}টি)`}
            </button>
            <span className={`text-xs ${overCap ? "font-semibold text-red-600" : "text-slate-500"}`}>
              মোট {merged.ids.length}টি{merged.duplicatesDropped > 0 ? ` · ডুপ্লিকেট বাদ গেছে ${merged.duplicatesDropped}টি` : ""}
              {overCap ? ` · সর্বোচ্চ ${MAX_ORDERS_PER_JOB}টি` : ""}
            </span>
          </div>
        </div>

        {/* ---- template ---- */}
        <div className="mt-4 rounded-xl border border-slate-200 p-3">
          <h3 className="text-sm font-semibold">টেমপ্লেট সেটিংস</h3>
          <p className="mt-1 text-xs text-slate-500">
            ইনভয়েস / চালান / প্যাকিং স্লিপে প্রযোজ্য। লোগোর URL সংরক্ষিত হয়, তবে বর্তমান PDF টুলকিট ছবি বসাতে পারে না বলে
            লোগো এখনো ছাপায় আসে না — ফুটার, শর্ত ও ইনভয়েস নোট ছাপায় আসে।
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="text-sm">লোগোর URL
              <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm" value={template.logoUrl ?? ""} onChange={(e) => setTemplate({ ...template, logoUrl: e.target.value })} placeholder="https://…" />
            </label>
            <label className="text-sm">ফুটার লেখা
              <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm" value={template.footerText ?? ""} onChange={(e) => setTemplate({ ...template, footerText: e.target.value })} />
            </label>
            <label className="text-sm">ইনভয়েস নোট
              <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm" value={template.invoiceNote ?? ""} onChange={(e) => setTemplate({ ...template, invoiceNote: e.target.value })} />
            </label>
            <label className="text-sm">শর্তাবলি
              <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm" value={template.termsText ?? ""} onChange={(e) => setTemplate({ ...template, termsText: e.target.value })} />
            </label>
          </div>
          <button type="button" className="btn-secondary btn-sm mt-2" disabled={busy === "template"} onClick={saveTemplate}>
            {busy === "template" ? "সংরক্ষণ হচ্ছে…" : "টেমপ্লেট সংরক্ষণ করুন"}
          </button>
        </div>

        {/* ---- history ---- */}
        <div className="mt-4 rounded-xl border border-slate-200 p-3">
          <h3 className="text-sm font-semibold">জব ইতিহাস (সর্বশেষ ২০টি)</h3>
          {history && history.items.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">এখনো কোনো প্রিন্ট জব হয়নি।</p>
          ) : null}
          {history && history.items.length > 0 ? (
            <table className="mt-2 w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs text-slate-500">
                  <th className="py-1 pr-2">সময়</th><th className="py-1 pr-2">ধরন</th>
                  <th className="py-1 pr-2">অর্ডার</th><th className="py-1 pr-2">ব্যর্থ</th>
                  <th className="py-1 pr-2">অবস্থা</th><th className="py-1">ব্যর্থের কারণ / অর্ডার</th>
                </tr>
              </thead>
              <tbody>
                {history.items.map((j) => (
                  <tr key={j.id} className="border-b border-slate-100 align-top">
                    <td className="py-1 pr-2 whitespace-nowrap">{j.createdAt ? new Date(j.createdAt).toLocaleString("bn-BD") : "—"}</td>
                    <td className="py-1 pr-2">{printTypeLabel(j.type)}</td>
                    <td className="py-1 pr-2">{j.orderCount}টি</td>
                    <td className="py-1 pr-2">{j.failedOrderIds.length}টি</td>
                    <td className="py-1 pr-2">{printJobStatusLabel(j)}</td>
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
