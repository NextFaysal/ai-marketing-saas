"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";

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
    </div>
  );
}
