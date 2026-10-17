"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { codBoardRows, coverageLabel, marginTone, type CodBoard, type ProfitReport } from "@/lib/orders-on7";
import { formatMinor } from "@repo/contracts";
import { ResponsiveTable } from "@repo/ui";

/** Minor-string display (bad input passes through raw). */
const fmtM = (minor?: string | null): string => {
  if (minor == null) return "—";
  try { return formatMinor(BigInt(minor)); } catch { return minor; }
};

// EC23 — কর ও হিসাব: org TaxSetting (আইনি নাম / TIN / BIN / ডিফল্ট
// VAT হার) + accounting CSV exports (বিক্রয় রেজিস্টার / কর সারাংশ /
// বকেয়া রিপোর্ট). VAT হার ফর্মে শতাংশে (দশমিকসহ, যেমন 7.5), API-তে
// basis points-এ (750) যায় — রূপান্তর এই পেজেই হয়।

interface TaxSettings {
  defaultVatBps: number | null;
  pricesIncludeVat: boolean;
  legalName: string | null;
  tin: string | null;
  binVatNo: string | null;
}

/** GC12 — gateway fee report / settlement rows (Payment Ops API). */
interface FeeReportRow {
  provider: string; source: string; count: number; grossMinor: string;
  withFeeCount: number; feeMinor: string | null; netMinor: string | null;
}
interface SettlementRow {
  provider: string; day: string; count: number; grossMinor: string;
  withFeeCount: number; feeMinor: string | null; netMinor: string | null;
}

type ExportType = "sales" | "tax" | "due" | "courier-collections";
const EXPORT_LABELS: Record<ExportType, string> = {
  sales: "বিক্রয় রেজিস্টার",
  tax: "কর সারাংশ",
  due: "বকেয়া রিপোর্ট",
  "courier-collections": "কুরিয়ার COD সংগ্রহ",
};

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** bps → percent input string (1500 → "15", 750 → "7.5"). */
function bpsToPercent(bps: number | null): string {
  if (bps == null) return "";
  return String(bps / 100);
}

export default function AccountingPage() {
  const [settings, setSettings] = useState<TaxSettings | null>(null);
  const [legalName, setLegalName] = useState("");
  const [tin, setTin] = useState("");
  const [binVatNo, setBinVatNo] = useState("");
  const [vatPercent, setVatPercent] = useState("");
  const [pricesIncludeVat, setPricesIncludeVat] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [saveError, setSaveError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [exportType, setExportType] = useState<ExportType>("sales");
  const [from, setFrom] = useState(isoDaysAgo(29));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [downloading, setDownloading] = useState(false);
  const [exportError, setExportError] = useState("");
  const [exportMsg, setExportMsg] = useState("");

  // ON7: COD board + profit report (orders reports endpoints).
  const [codBoard, setCodBoard] = useState<CodBoard | null>(null);
  const [codError, setCodError] = useState("");
  const [profitReport, setProfitReport] = useState<ProfitReport | null>(null);
  const [profitFrom, setProfitFrom] = useState(isoDaysAgo(29));
  const [profitTo, setProfitTo] = useState(isoDaysAgo(0));
  const [profitBusy, setProfitBusy] = useState(false);
  const [profitError, setProfitError] = useState("");
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvMsg, setCsvMsg] = useState("");
  const [csvError, setCsvError] = useState("");

  // GC12: gateway fee report + expected settlements.
  const [feeFrom, setFeeFrom] = useState(isoDaysAgo(29));
  const [feeTo, setFeeTo] = useState(isoDaysAgo(0));
  const [feeRows, setFeeRows] = useState<FeeReportRow[] | null>(null);
  const [settlementRows, setSettlementRows] = useState<SettlementRow[] | null>(null);
  const [feeBusy, setFeeBusy] = useState(false);
  const [feeError, setFeeError] = useState("");
  const [feeCsvBusy, setFeeCsvBusy] = useState(false);
  const [feeCsvMsg, setFeeCsvMsg] = useState("");
  const [feeCsvError, setFeeCsvError] = useState("");

  useEffect(() => {
    const orgId = getOrganizationId(); if (!orgId) return;
    apiFetch<CodBoard>(`/organizations/${orgId}/orders/reports/cod-board`)
      .then((b) => { setCodBoard(b); setCodError(""); })
      .catch((e) => { setCodBoard(null); setCodError(e instanceof Error ? e.message : "COD বোর্ড লোড ব্যর্থ"); });
  }, []);

  const loadProfit = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!profitFrom || !profitTo) { setProfitError("শুরু ও শেষের তারিখ দুটোই দিন"); return; }
    setProfitBusy(true); setProfitError("");
    try {
      const r = await apiFetch<ProfitReport>(
        `/organizations/${orgId}/orders/reports/profit?from=${encodeURIComponent(profitFrom)}&to=${encodeURIComponent(profitTo)}`,
      );
      setProfitReport(r);
    } catch (e) { setProfitError(e instanceof Error ? e.message : "লাভের রিপোর্ট লোড ব্যর্থ"); }
    finally { setProfitBusy(false); }
  }, [profitFrom, profitTo]);
  useEffect(() => { void loadProfit(); }, [loadProfit]);

  const loadFeeReport = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!feeFrom || !feeTo) { setFeeError("শুরু ও শেষের তারিখ দুটোই দিন"); return; }
    setFeeBusy(true); setFeeError("");
    try {
      const qs = `from=${encodeURIComponent(feeFrom)}&to=${encodeURIComponent(feeTo)}`;
      const [fee, settlements] = await Promise.all([
        apiFetch<{ rows: FeeReportRow[] }>(`/organizations/${orgId}/connections/payment-fee-report?${qs}`),
        apiFetch<{ rows: SettlementRow[] }>(`/organizations/${orgId}/connections/payment-settlements?${qs}`),
      ]);
      setFeeRows(fee.rows ?? []);
      setSettlementRows(settlements.rows ?? []);
    } catch (e) { setFeeError(e instanceof Error ? e.message : "ফি রিপোর্ট লোড ব্যর্থ"); }
    finally { setFeeBusy(false); }
  }, [feeFrom, feeTo]);
  useEffect(() => { void loadFeeReport(); }, [loadFeeReport]);

  /** GC12 fee-report CSV — same raw-fetch + blob pattern as the
   * other exports on this page. */
  async function downloadFeeCsv() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setFeeCsvError(""); setFeeCsvMsg("");
    if (!feeFrom || !feeTo) { setFeeCsvError("শুরু ও শেষের তারিখ দুটোই দিন"); return; }
    setFeeCsvBusy(true);
    try {
      const res = await fetch(
        `${API_URL}/organizations/${orgId}/connections/payment-fee-report.csv?from=${encodeURIComponent(feeFrom)}&to=${encodeURIComponent(feeTo)}`,
        { headers: { Authorization: `Bearer ${getToken() ?? ""}` } },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `ডাউনলোড ব্যর্থ (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payment-fee-report-${feeFrom}-${feeTo}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setFeeCsvMsg("✅ ফি রিপোর্ট (CSV) ডাউনলোড হয়েছে");
    } catch (err) {
      setFeeCsvError(err instanceof Error ? err.message : "ডাউনলোড ব্যর্থ হয়েছে");
    } finally { setFeeCsvBusy(false); }
  }

  /** Profit CSV — same raw-fetch + blob pattern as the
   * accounting exports above. */
  async function downloadProfitCsv() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setCsvError(""); setCsvMsg("");
    if (!profitFrom || !profitTo) { setCsvError("শুরু ও শেষের তারিখ দুটোই দিন"); return; }
    setCsvBusy(true);
    try {
      const res = await fetch(
        `${API_URL}/organizations/${orgId}/orders/reports/profit.csv?from=${encodeURIComponent(profitFrom)}&to=${encodeURIComponent(profitTo)}`,
        { headers: { Authorization: `Bearer ${getToken() ?? ""}` } },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `ডাউনলোড ব্যর্থ (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `profit-report-${profitFrom}-${profitTo}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setCsvMsg("✅ লাভের রিপোর্ট (CSV) ডাউনলোড হয়েছে");
    } catch (err) {
      setCsvError(err instanceof Error ? err.message : "ডাউনলোড ব্যর্থ হয়েছে");
    } finally { setCsvBusy(false); }
  }

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setLoadError("কোনো Organization নির্বাচিত নেই।"); setLoading(false); return; }
    try {
      const s = await apiFetch<TaxSettings>(`/organizations/${orgId}/commerce/tax-settings`);
      setSettings(s);
      setLegalName(s.legalName ?? "");
      setTin(s.tin ?? "");
      setBinVatNo(s.binVatNo ?? "");
      setVatPercent(bpsToPercent(s.defaultVatBps));
      setPricesIncludeVat(s.pricesIncludeVat !== false);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "কর সেটিংস লোড করা যায়নি");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId();
    if (!orgId) return;
    setSaveMsg(""); setSaveError("");
    // শতাংশ (দশমিকসহ) → basis points; ফাঁকা = VAT বন্ধ (null)।
    let defaultVatBps: number | null = null;
    const raw = vatPercent.trim();
    if (raw) {
      const pct = Number(raw);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        setSaveError("VAT হার 0–100% এর মধ্যে হতে হবে");
        return;
      }
      defaultVatBps = Math.round(pct * 100);
    }
    setSaving(true);
    try {
      const saved = await apiFetch<TaxSettings>(`/organizations/${orgId}/commerce/tax-settings`, {
        method: "PUT",
        body: JSON.stringify({
          legalName: legalName.trim() || null,
          tin: tin.trim() || null,
          binVatNo: binVatNo.trim() || null,
          defaultVatBps,
          pricesIncludeVat,
        }),
      });
      setSettings(saved);
      setSaveMsg("✅ কর সেটিংস সংরক্ষিত হয়েছে");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "সংরক্ষণ ব্যর্থ হয়েছে");
    } finally { setSaving(false); }
  }

  async function download() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setExportError(""); setExportMsg("");
    if (!from || !to) { setExportError("শুরু ও শেষের তারিখ দুটোই দিন"); return; }
    setDownloading(true);
    try {
      // CSV download mirrors the reports builder: raw fetch + blob.
      const res = await fetch(
        `${API_URL}/organizations/${orgId}/commerce/reports/accounting-export?type=${exportType}&from=${from}&to=${to}`,
        { headers: { Authorization: `Bearer ${getToken() ?? ""}` } },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `ডাউনলোড ব্যর্থ (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `accounting-${exportType}-${from}-${to}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setExportMsg(`✅ ${EXPORT_LABELS[exportType]} ডাউনলোড হয়েছে`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "ডাউনলোড ব্যর্থ হয়েছে");
    } finally { setDownloading(false); }
  }

  const inputCls = "w-full rounded-lg border px-3 py-2 text-sm";
  const labelCls = "mb-1 block text-xs font-semibold text-slate-700";

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4">
      <h1 className="page-title">কর ও হিসাব (Tax & Accounting)</h1>
      <div className="flex flex-wrap gap-2">
        <Link href="/dashboard/commerce/reports" className="inline-flex min-h-[44px] items-center rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">📑 সব রিপোর্ট</Link>
        <Link href="/dashboard/commerce/finance" className="inline-flex min-h-[44px] items-center rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">💰 ফাইন্যান্স ও লেজার</Link>
      </div>
      {loading ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : null}
      {loadError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{loadError}</p> : null}

      <form onSubmit={save} className="card space-y-4 p-5">
        <h2 className="font-semibold">কর সেটিংস</h2>
        <p className="text-xs text-slate-500">
          এই তথ্য ইনভয়েসে ছাপা হয় এবং চেকআউটে VAT হিসাব হয়। পণ্য-ভিত্তিক আলাদা হার পণ্যের ফর্মে দেওয়া যায় —
          সেটা এই ডিফল্ট হারকে override করে। ডিফল্ট হার ফাঁকা রাখলে কোনো VAT ধরা হয় না।
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className={labelCls}>ব্যবসার আইনি নাম (Legal Name)</label>
            <input className={inputCls} value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="যেমন: Qosprey Ltd" />
          </div>
          <div>
            <label className={labelCls}>TIN</label>
            <input className={inputCls} value={tin} onChange={(e) => setTin(e.target.value)} placeholder="ট্যাক্স শনাক্তকরণ নম্বর" />
          </div>
          <div>
            <label className={labelCls}>BIN / VAT নিবন্ধন নং</label>
            <input className={inputCls} value={binVatNo} onChange={(e) => setBinVatNo(e.target.value)} placeholder="BIN / VAT Registration No" />
          </div>
          <div>
            <label className={labelCls}>ডিফল্ট VAT হার % (ফাঁকা = VAT বন্ধ)</label>
            <input
              className={inputCls} type="number" step="0.01" min="0" max="100"
              value={vatPercent} onChange={(e) => setVatPercent(e.target.value)} placeholder="যেমন: 15 বা 7.5"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={pricesIncludeVat} onChange={(e) => setPricesIncludeVat(e.target.checked)} />
          দামে VAT অন্তর্ভুক্ত আছে (ইনক্লুসিভ) — বন্ধ করলে চেকআউটে VAT আলাদা যোগ হবে
        </label>
        {saveMsg ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{saveMsg}</p> : null}
        {saveError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{saveError}</p> : null}
        <button type="submit" className="btn-primary" disabled={saving || loading}>
          {saving ? "সংরক্ষণ হচ্ছে…" : "সংরক্ষণ করুন"}
        </button>
        {settings && settings.defaultVatBps == null ? (
          <p className="text-xs text-amber-600">বর্তমানে ডিফল্ট VAT সেট নেই — পণ্যে আলাদা হার না থাকলে চেকআউটে কর ধরা হচ্ছে না।</p>
        ) : null}
      </form>

      <div className="card space-y-4 p-5">
        <h2 className="font-semibold">হিসাব রিপোর্ট (CSV এক্সপোর্ট)</h2>
        <p className="text-xs text-slate-500">সর্বোচ্চ ৩৬৬ দিনের রিপোর্ট একবারে নেওয়া যায়। তারিখ ঢাকা সময় অনুযায়ী ধরা হয়।</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className={labelCls}>রিপোর্টের ধরন</label>
            <select className={inputCls} value={exportType} onChange={(e) => setExportType(e.target.value as ExportType)}>
              <option value="sales">বিক্রয় রেজিস্টার</option>
              <option value="tax">কর সারাংশ</option>
              <option value="due">বকেয়া রিপোর্ট</option>
              <option value="courier-collections">কুরিয়ার COD সংগ্রহ</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>শুরুর তারিখ</label>
            <input className={inputCls} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>শেষের তারিখ</label>
            <input className={inputCls} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        {exportMsg ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{exportMsg}</p> : null}
        {exportError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{exportError}</p> : null}
        <button type="button" className="btn-primary" onClick={download} disabled={downloading}>
          {downloading ? "তৈরি হচ্ছে…" : "CSV ডাউনলোড করুন"}
        </button>
      </div>

      {/* ON7: COD board — courier-এর কাছে আটকে থাকা টাকার
          হিসাব, provider অনুযায়ী। এটি শুধু বর্তমান অবস্থা;
          কোন টাকা কবে হাতে আসবে তার কোনো প্রতিশ্রুতি নয়। */}
      <div className="card space-y-4 p-5">
        <h2 className="font-semibold">🚚 COD বোর্ড</h2>
        <p className="text-xs text-slate-500">
          courier-এর কাছে আটকে থাকা টাকার বর্তমান হিসাব — কোন টাকা পথে আছে, কোনটা ডেলিভারি হয়ে গেলেও
          এখনো courier-এর কাছ থেকে হাতে আসেনি, আর গত ৭ দিনে কত এসেছে।
        </p>
        {codError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{codError}</p> : null}
        {!codBoard && !codError ? <p className="text-sm text-slate-400">লোড হচ্ছে…</p> : null}
        {codBoard ? (
          <ResponsiveTable table={<div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 pr-2 font-semibold">কুরিয়ার</th>
                  <th className="py-2 pr-2 font-semibold">পথে আছে</th>
                  <th className="py-2 pr-2 font-semibold">ডেলিভারি হয়েছে, টাকা আসেনি</th>
                  <th className="py-2 pr-2 font-semibold">গত ৭ দিনে এসেছে</th>
                  <th className="py-2 font-semibold">মোট বকেয়া</th>
                </tr>
              </thead>
              <tbody>
                {codBoardRows(codBoard).map((r) => (
                  <tr key={r.key} className={r.kind === "total" ? "border-t-2 bg-slate-50 font-semibold" : "border-b last:border-0"}>
                    <td className="py-2 pr-2">
                      {r.provider}
                      {r.kind === "unassigned" ? (
                        <span className="block text-xs font-normal text-slate-500">এখনো courier-এ যায়নি — অর্ডারের বকেয়া {fmtM(r.outstandingMinor)} ({r.unassignedOrders}টি)</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2">{r.kind === "unassigned" ? "—" : fmtM(r.inTransitCodMinor)}</td>
                    <td className="py-2 pr-2">{r.kind === "unassigned" ? "—" : fmtM(r.deliveredUncollectedMinor)}</td>
                    <td className="py-2 pr-2">{r.kind === "unassigned" ? "—" : fmtM(r.collectedLast7dMinor)}</td>
                    <td className="py-2">{fmtM(r.outstandingMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>} cards={codBoardRows(codBoard).map((r) => (
  <div key={r.key} className={`rounded-xl border bg-white p-3 shadow-sm ${r.kind === "total" ? "bg-slate-50 font-semibold" : ""}`}>
    <dl className="space-y-1 text-sm">
      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">কুরিয়ার</dt><dd className="text-right">{r.provider}{r.kind === "unassigned" ? (<span className="block text-xs font-normal text-slate-500">এখনো courier-এ যায়নি — অর্ডারের বকেয়া {fmtM(r.outstandingMinor)} ({r.unassignedOrders}টি)</span>) : null}</dd></div>
      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">পথে আছে</dt><dd className="text-right">{r.kind === "unassigned" ? "—" : fmtM(r.inTransitCodMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">ডেলিভারি হয়েছে, টাকা আসেনি</dt><dd className="text-right">{r.kind === "unassigned" ? "—" : fmtM(r.deliveredUncollectedMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">গত ৭ দিনে এসেছে</dt><dd className="text-right">{r.kind === "unassigned" ? "—" : fmtM(r.collectedLast7dMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">মোট বকেয়া</dt><dd className="text-right">{fmtM(r.outstandingMinor)}</dd></div>
    </dl>
  </div>
))} />
        ) : null}
      </div>

      {/* ON7: profit report — revenue vs product cost per
          product. A null cost is "খরচ জানা নেই", never 0. */}
      <div className="card space-y-4 p-5">
        <h2 className="font-semibold">📈 লাভের রিপোর্ট</h2>
        <p className="text-xs text-slate-500">নির্বাচিত সময়ের বিক্রিতে পণ্যের খরচ বাদ দিয়ে লাভের হিসাব। যেসব পণ্যের খরচ জানা নেই, সেগুলো আলাদা করে বলা হয়েছে — অনুমান করা হয়নি।</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div>
            <label className={labelCls}>শুরুর তারিখ</label>
            <input className={inputCls} type="date" value={profitFrom} onChange={(e) => setProfitFrom(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>শেষের তারিখ</label>
            <input className={inputCls} type="date" value={profitTo} onChange={(e) => setProfitTo(e.target.value)} />
          </div>
          <div className="flex items-end gap-2 md:col-span-2">
            <button type="button" className="btn-primary" disabled={profitBusy} onClick={() => void loadProfit()}>
              {profitBusy ? "লোড হচ্ছে…" : "রিপোর্ট দেখুন"}
            </button>
            <button type="button" className="btn-secondary" disabled={csvBusy} onClick={() => void downloadProfitCsv()}>
              {csvBusy ? "তৈরি হচ্ছে…" : "CSV ডাউনলোড"}
            </button>
          </div>
        </div>
        {csvMsg ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{csvMsg}</p> : null}
        {csvError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{csvError}</p> : null}
        {profitError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{profitError}</p> : null}
        {profitBusy && !profitReport ? <p className="text-sm text-slate-400">লোড হচ্ছে…</p> : null}
        {profitReport ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-xl bg-slate-50 px-3 py-2">
                <div className="text-xs text-slate-500">আয় ({profitReport.totals.orders}টি অর্ডার)</div>
                <div className="text-lg font-bold">{fmtM(profitReport.totals.revenueMinor)}</div>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2">
                <div className="text-xs text-slate-500">পণ্যের খরচ (জানা অংশ)</div>
                <div className="text-lg font-bold">{fmtM(profitReport.totals.productCostMinor)}</div>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2">
                <div className="text-xs text-slate-500">মোট লাভ (গ্রস মার্জিন)</div>
                <div className={`text-lg font-bold ${marginTone(profitReport.totals.grossMarginMinor) === "negative" ? "text-rose-600" : "text-emerald-700"}`}>{fmtM(profitReport.totals.grossMarginMinor)}</div>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2">
                <div className="text-xs text-slate-500">খরচ জানা নেই এমন অর্ডার</div>
                <div className="text-lg font-bold text-amber-700">{profitReport.totals.uncostedOrders}টি</div>
              </div>
            </div>
            <p className="text-xs text-slate-500">{coverageLabel(profitReport.totals.costCoveragePercent)} — খরচ-জানা আয়ের পরিমাণ {fmtM(profitReport.totals.costedRevenueMinor)}।</p>
            {profitReport.finance ? (
              <div className="space-y-2 rounded-xl border bg-slate-50 p-4">
                <h3 className="font-semibold">আনুমানিক নিট লাভ</h3>
                {profitReport.finance.estimatedNetMinor != null ? (
                  <>
                    <div className="text-2xl font-bold">{fmtM(profitReport.finance.estimatedNetMinor)}</div>
                    <p className="text-xs text-slate-500">খরচ ও গেটওয়ে ফি বাদ দিয়ে; পণ্যের খরচ সম্পূর্ণ কভার হলেই এই হিসাব দেখানো হয়। এই সময়ের খরচ {fmtM(profitReport.finance.periodExpensesMinor)}, গেটওয়ে ফি {profitReport.finance.gatewayFeesMinor != null ? fmtM(profitReport.finance.gatewayFeesMinor) : "ফি হার সেট করা হয়নি"}।</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm">এই সময়ের খরচ: <span className="font-semibold">{fmtM(profitReport.finance.periodExpensesMinor)}</span></p>
                    <p className="text-sm">গেটওয়ে ফি: <span className="font-semibold">{profitReport.finance.gatewayFeesMinor != null ? fmtM(profitReport.finance.gatewayFeesMinor) : "ফি হার সেট করা হয়নি"}</span></p>
                    <p className="text-xs text-slate-500">আনুমানিক নিট লাভ দেখানো হচ্ছে না — কারণ:</p>
                  </>
                )}
                {profitReport.finance.reasons.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
                    {profitReport.finance.reasons.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {profitReport.perProductBasis ? <p className="text-xs text-slate-500">{profitReport.perProductBasis}</p> : null}
            {profitReport.truncated ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">তালিকাটি সীমিত — সব পণ্য দেখানো হয়নি; মোট হিসাব সব অর্ডার মিলিয়েই করা।</p>
            ) : null}
            {profitReport.perProduct.length === 0 ? (
              <p className="text-sm text-slate-400">এই সময়ে কোনো বিক্রি নেই।</p>
            ) : (
              <ResponsiveTable table={<div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-slate-500">
                      <th className="py-2 pr-2 font-semibold">পণ্য</th>
                      <th className="py-2 pr-2 font-semibold">পরিমাণ</th>
                      <th className="py-2 pr-2 font-semibold">আয়</th>
                      <th className="py-2 pr-2 font-semibold">খরচ</th>
                      <th className="py-2 font-semibold">লাভ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profitReport.perProduct.map((p) => (
                      <tr key={p.productId} className="border-b last:border-0">
                        <td className="py-2 pr-2 font-medium">{p.name}{p.sku ? <span className="ml-2 text-xs font-normal text-slate-500">SKU: {p.sku}</span> : null}</td>
                        <td className="py-2 pr-2">{p.quantity}</td>
                        <td className="py-2 pr-2">{fmtM(p.revenueMinor)}</td>
                        <td className="py-2 pr-2">{p.costMinor != null ? fmtM(p.costMinor) : <span className="font-semibold text-amber-700">খরচ জানা নেই</span>}</td>
                        <td className="py-2">
                          {p.marginMinor != null ? (
                            <span className={`rounded px-2 py-0.5 font-bold ${marginTone(p.marginMinor) === "negative" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>{fmtM(p.marginMinor)}</span>
                          ) : <span className="text-slate-400">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>} cards={profitReport.perProduct.map((p) => (<div key={p.productId} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">পণ্য</dt><dd className="text-right"><>{p.name}{p.sku ? <span className="ml-2 text-xs font-normal text-slate-500">SKU: {p.sku}</span> : null}</></dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">পরিমাণ</dt><dd className="text-right">{p.quantity}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">আয়</dt><dd className="text-right">{fmtM(p.revenueMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">খরচ</dt><dd className="text-right">{p.costMinor != null ? fmtM(p.costMinor) : <span className="font-semibold text-amber-700">খরচ জানা নেই</span>}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">লাভ</dt><dd className="text-right">{p.marginMinor != null ? (<span className={`rounded px-2 py-0.5 font-bold ${marginTone(p.marginMinor) === "negative" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>{fmtM(p.marginMinor)}</span>) : <span className="text-slate-400">—</span>}</dd></div></dl></div>))} />
            )}
          </div>
        ) : null}
      </div>

      {/* GC12: gateway fee report + expected settlements (own
          gateways). Fee is shown ONLY where a fee rate was
          actually configured — a null fee says so, never a
          fabricated 0. Platform-path money settles through the
          wallet, not this table. */}
      <div className="card space-y-4 p-5">
        <h2 className="font-semibold">💳 গেটওয়ে ফি ও সেটেলমেন্ট</h2>
        <p className="text-xs text-slate-500">
          যাচাইকৃত অনলাইন পেমেন্টে গেটওয়ের ফি কেটে নেট কত থাকল — প্রোভাইডার অনুযায়ী। ফি হার Connect Center-এ
          নিজের গেটওয়ের ফর্মে সেট করা থাকে; সেট না থাকলে সেই গেটওয়ের ফি এখানে দেখানো হবে না।
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div>
            <label className={labelCls}>শুরুর তারিখ</label>
            <input className={inputCls} type="date" value={feeFrom} onChange={(e) => setFeeFrom(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>শেষের তারিখ</label>
            <input className={inputCls} type="date" value={feeTo} onChange={(e) => setFeeTo(e.target.value)} />
          </div>
          <div className="flex items-end gap-2 md:col-span-2">
            <button type="button" className="btn-primary" disabled={feeBusy} onClick={() => void loadFeeReport()}>
              {feeBusy ? "লোড হচ্ছে…" : "রিপোর্ট দেখুন"}
            </button>
            <button type="button" className="btn-secondary" disabled={feeCsvBusy} onClick={() => void downloadFeeCsv()}>
              {feeCsvBusy ? "তৈরি হচ্ছে…" : "CSV ডাউনলোড"}
            </button>
          </div>
        </div>
        {feeCsvMsg ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{feeCsvMsg}</p> : null}
        {feeCsvError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{feeCsvError}</p> : null}
        {feeError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{feeError}</p> : null}
        {feeBusy && !feeRows ? <p className="text-sm text-slate-400">লোড হচ্ছে…</p> : null}
        {feeRows ? (
          feeRows.length === 0 ? (
            <p className="text-sm text-slate-400">এই সময়ে কোনো যাচাইকৃত অনলাইন পেমেন্ট নেই।</p>
          ) : (
            <ResponsiveTable table={<div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-slate-500">
                    <th className="py-2 pr-2 font-semibold">প্রোভাইডার</th>
                    <th className="py-2 pr-2 font-semibold">উৎস</th>
                    <th className="py-2 pr-2 font-semibold">পেমেন্ট সংখ্যা</th>
                    <th className="py-2 pr-2 font-semibold">মোট (গ্রস)</th>
                    <th className="py-2 pr-2 font-semibold">ফি</th>
                    <th className="py-2 font-semibold">নেট</th>
                  </tr>
                </thead>
                <tbody>
                  {feeRows.map((r) => (
                    <tr key={`${r.provider}-${r.source}`} className="border-b last:border-0">
                      <td className="py-2 pr-2 font-medium">{r.provider}</td>
                      <td className="py-2 pr-2">{r.source === "platform" ? "প্ল্যাটফর্ম" : "নিজের"}</td>
                      <td className="py-2 pr-2">{r.count}টি</td>
                      <td className="py-2 pr-2">{fmtM(r.grossMinor)}</td>
                      <td className="py-2 pr-2">{r.feeMinor != null ? fmtM(r.feeMinor) : <span className="font-semibold text-amber-700">ফি হার সেট করা হয়নি</span>}</td>
                      <td className="py-2">{r.netMinor != null ? fmtM(r.netMinor) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>} cards={feeRows.map((r) => (<div key={`${r.provider}-${r.source}`} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">প্রোভাইডার</dt><dd className="text-right">{r.provider}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">উৎস</dt><dd className="text-right">{r.source === "platform" ? "প্ল্যাটফর্ম" : "নিজের"}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">পেমেন্ট সংখ্যা</dt><dd className="text-right">{r.count}টি</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">মোট (গ্রস)</dt><dd className="text-right">{fmtM(r.grossMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">ফি</dt><dd className="text-right">{r.feeMinor != null ? fmtM(r.feeMinor) : <span className="font-semibold text-amber-700">ফি হার সেট করা হয়নি</span>}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">নেট</dt><dd className="text-right">{r.netMinor != null ? fmtM(r.netMinor) : "—"}</dd></div></dl></div>))} />
          )
        ) : null}

        <div className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-semibold">প্রত্যাশিত settlement (নিজের গেটওয়ে, দিন অনুযায়ী)</h3>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">আপনাদের রেকর্ড অনুযায়ী প্রত্যাশিত settlement — gateway-এর নিজস্ব প্যানেলের সঙ্গে মিলিয়ে দেখুন</p>
          {settlementRows ? (
            settlementRows.length === 0 ? (
              <p className="text-sm text-slate-400">এই সময়ে নিজের গেটওয়েতে কোনো settlement নেই।</p>
            ) : (
              <ResponsiveTable table={<div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-slate-500">
                      <th className="py-2 pr-2 font-semibold">দিন</th>
                      <th className="py-2 pr-2 font-semibold">প্রোভাইডার</th>
                      <th className="py-2 pr-2 font-semibold">পেমেন্ট সংখ্যা</th>
                      <th className="py-2 pr-2 font-semibold">মোট (গ্রস)</th>
                      <th className="py-2 pr-2 font-semibold">ফি</th>
                      <th className="py-2 font-semibold">নেট</th>
                    </tr>
                  </thead>
                  <tbody>
                    {settlementRows.map((r) => (
                      <tr key={`${r.day}-${r.provider}`} className="border-b last:border-0">
                        <td className="py-2 pr-2 font-medium">{r.day}</td>
                        <td className="py-2 pr-2">{r.provider}</td>
                        <td className="py-2 pr-2">{r.count}টি</td>
                        <td className="py-2 pr-2">{fmtM(r.grossMinor)}</td>
                        <td className="py-2 pr-2">{r.feeMinor != null ? fmtM(r.feeMinor) : <span className="font-semibold text-amber-700">ফি হার সেট করা হয়নি</span>}</td>
                        <td className="py-2">{r.netMinor != null ? fmtM(r.netMinor) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>} cards={settlementRows.map((r) => (<div key={`${r.day}-${r.provider}`} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">দিন</dt><dd className="text-right">{r.day}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">প্রোভাইডার</dt><dd className="text-right">{r.provider}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">পেমেন্ট সংখ্যা</dt><dd className="text-right">{r.count}টি</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">মোট (গ্রস)</dt><dd className="text-right">{fmtM(r.grossMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">ফি</dt><dd className="text-right">{r.feeMinor != null ? fmtM(r.feeMinor) : <span className="font-semibold text-amber-700">ফি হার সেট করা হয়নি</span>}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">নেট</dt><dd className="text-right">{r.netMinor != null ? fmtM(r.netMinor) : "—"}</dd></div></dl></div>))} />
            )
          ) : null}
          <p className="text-xs text-slate-500">
            প্ল্যাটফর্ম গেটওয়ে দিয়ে নেওয়া পেমেন্টের settlement এই তালিকায় নয় — সেগুলোর হিসাব Wallet-এ জমা হয়;
            বিবরণী দেখুন <Link href="/dashboard/connections" className="font-semibold text-indigo-600 hover:underline">Connect Center-এর Wallet অংশে</Link>।
          </p>
        </div>
      </div>
    </div>
  );
}
