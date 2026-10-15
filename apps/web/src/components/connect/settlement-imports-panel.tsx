"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  formatTakaMinor, formatWhen, settlementStateLabel,
  type SettlementImportDetailView, type SettlementImportView, type SettlementRowView,
} from "@/lib/connections";

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
      setError(e instanceof Error ? e.message : "ইমপোর্টের তালিকা লোড হয়নি");
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
    if (!csvText.trim()) { setError("আগে CSV ফাইলটি বেছে নিন"); return; }
    if (!periodLabel.trim()) { setError("সময়কালের একটি লেবেল দিন (যেমন: অক্টোবর ২০২৬, সপ্তাহ ২)"); return; }
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
      setError(e instanceof Error ? e.message : "ইমপোর্ট করা যায়নি");
    } finally { setBusy(false); }
  }

  async function openDetail(importId: string) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const out = await apiFetch<SettlementImportDetailView>(`organizations/${orgId}/connections/settlement-imports/${importId}`);
      setDetail(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "বিবরণী লোড হয়নি");
    }
  }

  function rowLine(row: SettlementRowView) {
    return (
      <div key={row.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-xs">
        <span className="font-mono text-slate-600">{row.externalRef}</span>
        <span className="font-semibold text-slate-700">{formatTakaMinor(row.amountMinor)}</span>
        {row.rawStatus ? <span className="text-slate-400">ফাইলের status: {row.rawStatus}</span> : null}
        {row.matchedTransactionId ? <span className="font-mono text-slate-400">লেনদেন: {row.matchedTransactionId}</span> : null}
      </div>
    );
  }

  return (
    <div className="card space-y-3 p-4">
      <div className="font-semibold text-slate-800">🧮 সেটেলমেন্ট রিকনসিলিয়েশন (CSV)</div>
      {error ? <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">{error}</div> : null}
      <p className="text-xs leading-relaxed text-slate-500">
        গেটওয়ের ড্যাশবোর্ড থেকে ডাউনলোড করা সেটেলমেন্ট CSV আপলোড করুন — সিস্টেম প্রতিটি সারি যাচাইকৃত পেইড লেনদেনের
        সাথে মিলিয়ে দেখবে এবং অমিলগুলো আসল আইডিসহ তালিকায় দেখাবে। কোনো গেটওয়েতেই bulk settlement API সংযুক্ত নেই,
        তাই এখানে CSV-ই একমাত্র উৎস — কোনো স্বয়ংক্রিয় fetch দাবি করা হয় না। ফাইলের header চিনতে না পারলে ইমপোর্ট
        অস্বীকার করা হয়; কোনো সারি নীরবে বাদ যায় না (পড়া-না-যাওয়া সারি গোনা হয়ে দেখানো হয়)।
      </p>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-xs text-slate-500">গেটওয়ে
          <select value={provider} onChange={(e) => setProvider(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
            <option value="sslcommerz">SSLCommerz</option>
            <option value="bkash">বিকাশ</option>
          </select>
        </label>
        <label className="text-xs text-slate-500">উৎস
          <select value={source} onChange={(e) => setSource(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
            <option value="own">নিজের গেটওয়ে</option>
            <option value="platform">প্ল্যাটফর্ম গেটওয়ে</option>
          </select>
        </label>
        <label className="text-xs text-slate-500">সময়কালের লেবেল*
          <input value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)} placeholder="যেমন: অক্টোবর ২০২৬" className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-slate-500">সময়কাল — শুরু (ঐচ্ছিক)
          <input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-slate-500">সময়কাল — শেষ (ঐচ্ছিক)
          <input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-slate-500">CSV ফাইল*
          <input type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" disabled={busy} onClick={() => void submit()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
          {busy ? "মিলিয়ে দেখা হচ্ছে…" : "ইমপোর্ট করে মিলিয়ে দেখুন"}
        </button>
        {fileName ? <span className="text-xs text-slate-400">{fileName} · {csvText.length.toLocaleString()} অক্ষর</span> : null}
      </div>

      {loaded && imports.length === 0 && !detail ? (
        <p className="text-xs text-slate-400">এখনো কোনো সেটেলমেন্ট ইমপোর্ট হয়নি।</p>
      ) : null}

      {imports.length > 0 ? (
        <ul className="space-y-1">
          {imports.map((imp) => (
            <li key={imp.id}>
              <button type="button" onClick={() => void openDetail(imp.id)} className="flex w-full flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-left text-xs hover:bg-slate-100">
                <span className="font-semibold text-slate-700">{imp.periodLabel}</span>
                <span className="text-slate-500">{imp.provider === "bkash" ? "বিকাশ" : "SSLCommerz"} · {imp.source === "platform" ? "প্ল্যাটফর্ম" : "নিজের"}</span>
                <span className="text-slate-500">সারি: {imp.rowCount}</span>
                <span className="text-green-700">মিলেছে: {imp.matchedCount}</span>
                {imp.skippedCount > 0 ? <span className="text-amber-700">পড়া যায়নি: {imp.skippedCount}</span> : null}
                <span className="text-slate-400">{imp.fileName}</span>
                <span className="text-slate-400">{formatWhen(imp.createdAt) ?? ""}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {detail ? (
        <div className="space-y-2 rounded-xl bg-slate-50 p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-slate-800">{detail.import.periodLabel} — বিবরণী</span>
            <span className="rounded-full bg-green-100 px-2 py-0.5 font-semibold text-green-700">মিলেছে {detail.counts.matched}</span>
            <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700">পরিমাণে অমিল {detail.counts.amount_mismatch}</span>
            <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700">সিস্টেমে নেই {detail.counts.missing_in_system}</span>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">ফাইলে পুনরাবৃত্তি {detail.counts.duplicate}</span>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">রিপোর্টে নেই {detail.counts.missing_in_report}</span>
            <button type="button" onClick={() => setDetail(null)} className="ml-auto rounded-lg bg-slate-200 px-2 py-1 font-semibold text-slate-600">বন্ধ করুন</button>
          </div>
          {detail.amountMismatch.length > 0 ? (
            <div className="space-y-1"><div className="text-xs font-semibold text-red-700">পরিমাণে অমিল ({settlementStateLabel("amount_mismatch")})</div>{detail.amountMismatch.map(rowLine)}</div>
          ) : null}
          {detail.missingInSystem.length > 0 ? (
            <div className="space-y-1"><div className="text-xs font-semibold text-red-700">ফাইলে আছে, সিস্টেমে নেই</div>{detail.missingInSystem.map(rowLine)}</div>
          ) : null}
          {detail.duplicates.length > 0 ? (
            <div className="space-y-1"><div className="text-xs font-semibold text-amber-700">একই ref ফাইলে একাধিকবার</div>{detail.duplicates.map(rowLine)}</div>
          ) : null}
          {detail.missingInReport.length > 0 ? (
            <div className="space-y-1">
              <div className="text-xs font-semibold text-amber-700">সিস্টেমে যাচাইকৃত পেইড, কিন্তু এই রিপোর্টে নেই</div>
              {detail.missingInReport.map((m) => (
                <div key={m.transactionId} className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-xs">
                  <span className="font-mono text-slate-600">{m.providerTxnId ?? "—"}</span>
                  <span className="font-semibold text-slate-700">{formatTakaMinor(m.amountMinor)}</span>
                  <span className="font-mono text-slate-400">লেনদেন: {m.transactionId}</span>
                  <span className="text-slate-400">অর্ডার: {m.orderId}</span>
                  <span className="text-slate-400">{formatWhen(m.paidAt) ?? ""}</span>
                </div>
              ))}
            </div>
          ) : null}
          {detail.counts.amount_mismatch === 0 && detail.counts.missing_in_system === 0 && detail.counts.duplicate === 0 && detail.counts.missing_in_report === 0 ? (
            <p className="text-xs text-green-700">কোনো অমিল নেই — এই ফাইলের প্রতিটি সারি সিস্টেমের যাচাইকৃত লেনদেনের সাথে মিলেছে।</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
