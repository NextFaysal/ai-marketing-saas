"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  formatTakaMinor, formatWhen, settlementStateLabel,
  type SettlementImportDetailView, type SettlementImportView, type SettlementRowView,
} from "@/lib/connections";
import { useLocale } from "@/lib/i18n/provider";
import { fmtNumber } from "@repo/contracts";

/**
 * CC25 — সেটেলমেন্ট CSV মিলিয়ে দেখা (রিকনসিলিয়েশন)।
 *
 * v1-এর একমাত্র উৎস গেটওয়ে থেকে ডাউনলোড করা CSV ফাইল —
 * কোনো গেটওয়েতেই bulk settlement API সংযুক্ত নেই, তাই এই
 * প্যানেল কোনো "অটো fetch" দাবি করে না। ফাইলটি ব্রাউজারেই
 * পড়ে টেক্সট হিসেবে পাঠানো হয় (সার্ভিসে পাঠানোর আগে কোনো
 * সারি যোগ/বাদ হয় না)। মিলানো হয় শুধু যাচাইকৃত পেইড
 * লেনদেনের বিপরীতে; মিলন-বিবরণীতে অমিলের প্রতিটি সারি আসল
 * লেনদেন আইডিসহ দেখানো হয়।
 */
export function SettlementImportsPanel() {
  const { dict, t, locale } = useLocale();
  const D = dict.connections;
  const [imports, setImports] = useState<SettlementImportView[]>([]);
  const [detail, setDetail] = useState<SettlementImportDetailView | null>(null);
  const [provider, setProvider] = useState("sslcommerz");
  const [source, setSource] = useState("own");
  const [periodLabel, setPeriodLabel] = useState("");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const res = await apiFetch<{ imports: SettlementImportView[] }>(`organizations/${orgId}/connections/settlement-imports`);
      setImports(res.imports ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : D.stLoadFailed);
    } finally { setLoaded(true); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function onFile(file: File) {
    setFileName(file.name);
    setCsvText(await file.text());
    setError("");
  }

  async function submit() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    if (!csvText.trim()) { setError(D.stPickFile); return; }
    if (!periodLabel.trim()) { setError(D.stPeriodLabelRequired); return; }
    setBusy(true); setError("");
    try {
      const body: Record<string, unknown> = { provider, source, periodLabel: periodLabel.trim(), csv: csvText, fileName: fileName || null };
      if (periodFrom) body.periodFrom = new Date(`${periodFrom}T00:00:00.000Z`).toISOString();
      if (periodTo) body.periodTo = new Date(`${periodTo}T23:59:59.999Z`).toISOString();
      const out = await apiFetch<SettlementImportView>(`organizations/${orgId}/connections/settlement-imports`, {
        method: "POST", body: JSON.stringify(body),
      });
      setCsvText(""); setFileName("");
      await load();
      await openDetail(out.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : D.stImportFailed);
    } finally { setBusy(false); }
  }

  async function openDetail(importId: string) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const out = await apiFetch<SettlementImportDetailView>(`organizations/${orgId}/connections/settlement-imports/${importId}`);
      setDetail(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : D.stDetailFailed);
    }
  }

  function rowLine(row: SettlementRowView) {
    return (
      <div key={row.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-xs">
        <span className="font-mono text-slate-600">{row.externalRef}</span>
        <span className="font-semibold text-slate-700">{formatTakaMinor(row.amountMinor, locale)}</span>
        {row.rawStatus ? <span className="text-slate-400">{D.stFileStatus}{row.rawStatus}</span> : null}
        {row.matchedTransactionId ? <span className="font-mono text-slate-400">{D.stTxnLabel}{row.matchedTransactionId}</span> : null}
      </div>
    );
  }

  return (
    <div className="card space-y-3 p-4">
      <div className="font-semibold text-slate-800">{D.stTitle}</div>
      {error ? <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">{error}</div> : null}
      <p className="text-xs leading-relaxed text-slate-500">{D.stIntro}</p>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-xs text-slate-500">{D.plGatewayLabel}
          <select value={provider} onChange={(e) => setProvider(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
            <option value="sslcommerz">SSLCommerz</option>
            <option value="bkash">{D.payBkash}</option>
          </select>
        </label>
        <label className="text-xs text-slate-500">{D.plSourceLabel}
          <select value={source} onChange={(e) => setSource(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
            <option value="own">{D.phOwnGateway}</option>
            <option value="platform">{D.plPlatformGateway}</option>
          </select>
        </label>
        <label className="text-xs text-slate-500">{D.stPeriodLabel}
          <input value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)} placeholder={D.stPeriodPlaceholder} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-slate-500">{D.stPeriodFrom}
          <input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-slate-500">{D.stPeriodTo}
          <input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-slate-500">{D.stCsvLabel}
          <input type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" disabled={busy} onClick={() => void submit()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
          {busy ? D.stMatching : D.stImportBtn}
        </button>
        {fileName ? <span className="text-xs text-slate-400">{t("connections.stFileChars", { name: fileName, count: fmtNumber(locale, csvText.length) })}</span> : null}
      </div>

      {loaded && imports.length === 0 && !detail ? (
        <p className="text-xs text-slate-400">{D.stEmpty}</p>
      ) : null}

      {imports.length > 0 ? (
        <ul className="space-y-1">
          {imports.map((imp) => (
            <li key={imp.id}>
              <button type="button" onClick={() => void openDetail(imp.id)} className="flex w-full flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-left text-xs hover:bg-slate-100">
                <span className="font-semibold text-slate-700">{imp.periodLabel}</span>
                <span className="text-slate-500">{imp.provider === "bkash" ? D.payBkash : "SSLCommerz"} · {imp.source === "platform" ? D.phPlatform : D.stOwnShort}</span>
                <span className="text-slate-500">{D.stRowsLabel}{fmtNumber(locale, imp.rowCount)}</span>
                <span className="text-green-700">{D.stMatchedLabel}{fmtNumber(locale, imp.matchedCount)}</span>
                {imp.skippedCount > 0 ? <span className="text-amber-700">{D.stSkippedLabel}{fmtNumber(locale, imp.skippedCount)}</span> : null}
                <span className="text-slate-400">{imp.fileName}</span>
                <span className="text-slate-400">{formatWhen(imp.createdAt, locale) ?? ""}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {detail ? (
        <div className="space-y-2 rounded-xl bg-slate-50 p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-slate-800">{detail.import.periodLabel}{D.stDetailSuffix}</span>
            <span className="rounded-full bg-green-100 px-2 py-0.5 font-semibold text-green-700">{t("connections.stBadgeMatched", { count: fmtNumber(locale, detail.counts.matched) })}</span>
            <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700">{t("connections.stBadgeMismatch", { count: fmtNumber(locale, detail.counts.amount_mismatch) })}</span>
            <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700">{t("connections.stBadgeMissing", { count: fmtNumber(locale, detail.counts.missing_in_system) })}</span>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">{t("connections.stBadgeDuplicate", { count: fmtNumber(locale, detail.counts.duplicate) })}</span>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">{t("connections.stBadgeNotInReport", { count: fmtNumber(locale, detail.counts.missing_in_report) })}</span>
            <button type="button" onClick={() => setDetail(null)} className="ml-auto rounded-lg bg-slate-200 px-2 py-1 font-semibold text-slate-600">{dict.common.close}</button>
          </div>
          {detail.amountMismatch.length > 0 ? (
            <div className="space-y-1"><div className="text-xs font-semibold text-red-700">{D.stMismatchTitle} ({settlementStateLabel("amount_mismatch", locale)})</div>{detail.amountMismatch.map(rowLine)}</div>
          ) : null}
          {detail.missingInSystem.length > 0 ? (
            <div className="space-y-1"><div className="text-xs font-semibold text-red-700">{D.stMissingTitle}</div>{detail.missingInSystem.map(rowLine)}</div>
          ) : null}
          {detail.duplicates.length > 0 ? (
            <div className="space-y-1"><div className="text-xs font-semibold text-amber-700">{D.stDupTitle}</div>{detail.duplicates.map(rowLine)}</div>
          ) : null}
          {detail.missingInReport.length > 0 ? (
            <div className="space-y-1">
              <div className="text-xs font-semibold text-amber-700">{D.stNotInReportTitle}</div>
              {detail.missingInReport.map((m) => (
                <div key={m.transactionId} className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-xs">
                  <span className="font-mono text-slate-600">{m.providerTxnId ?? "—"}</span>
                  <span className="font-semibold text-slate-700">{formatTakaMinor(m.amountMinor, locale)}</span>
                  <span className="font-mono text-slate-400">{D.stTxnLabel}{m.transactionId}</span>
                  <span className="text-slate-400">{D.phOrderLabel}{m.orderId}</span>
                  <span className="text-slate-400">{formatWhen(m.paidAt, locale) ?? ""}</span>
                </div>
              ))}
            </div>
          ) : null}
          {detail.counts.amount_mismatch === 0 && detail.counts.missing_in_system === 0 && detail.counts.duplicate === 0 && detail.counts.missing_in_report === 0 ? (
            <p className="text-xs text-green-700">{D.stAllMatched}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
