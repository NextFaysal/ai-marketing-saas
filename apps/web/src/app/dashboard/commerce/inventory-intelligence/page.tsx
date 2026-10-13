"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { minorToTakaString } from "@/lib/storefront-money";

// EC33 — Inventory Intelligence: বিক্রির গতি (velocity), গতি-ভিত্তিক
// পুনঃঅর্ডার পরামর্শ, dead stock ও গুদামের মোট মূল্যায়ন। সব সংখ্যা
// আসল অর্ডার/স্টক/খরচ রেকর্ড থেকে — velocity একটি আনুমানিক হিসাব,
// সেটা পেজে স্পষ্ট করে বলা আছে।
//
// API shape notes (service-verified):
// - GET inventory/settings → { leadTimeDays, ... } (default 14).
// - reorder-suggestions?mode=velocity →
//   { mode:"velocity", noRecentSalesCount, items: [...] } — items
//   carry dailyVelocity / unitsSold / leadTimeDays / basis and
//   lastSupplier is always null in this mode (no threshold field).
// - GET inventory/velocity → { windowDays, generatedAt, items }.
// - GET inventory/dead-stock → { days, unvaluedCount, items }.
// - GET inventory/valuation → { totalValueMinor, currency,
//   valuedProducts, unvaluedProducts, items } (items are the
//   valued rows only, value desc, max 100).

interface Settings { leadTimeDays: number }

interface SimpleSuggestion {
  productId: string;
  productName: string;
  variantId?: string | null;
  variantName?: string | null;
  sku?: string | null;
  currentStock: number;
  threshold: number;
  suggestedQty: number;
  lastSupplier: { id: string; name: string } | null;
  lastUnitCostMinor?: string | null;
}

interface VelocitySuggestion {
  productId: string;
  productName: string;
  variantId: string | null;
  variantName: string | null;
  sku: string | null;
  currentStock: number;
  suggestedQty: number;
  basis: string;
  dailyVelocity: number;
  leadTimeDays: number;
  unitsSold: number;
  windowDays: number;
  lastSupplier: null;
  lastUnitCostMinor: null;
}

interface VelocityResponse {
  mode: "velocity";
  items: VelocitySuggestion[];
  noRecentSalesCount: number;
}

interface VelocityItem {
  productId: string;
  productName: string;
  variantId: string | null;
  variantName: string | null;
  sku: string | null;
  currentStock: number;
  unitsSold: number;
  dailyVelocity: number;
  daysOfStockLeft: number | null;
  projectedStockoutDate: string | null;
}

interface DeadStockItem {
  productId: string;
  productName: string;
  variantId: string | null;
  variantName: string | null;
  sku: string | null;
  currentStock: number;
  lastSaleAt: string | null;
  unitCostMinor: string | null;
  stuckValueMinor: string | null;
}

interface ValuationItem {
  productId: string;
  productName: string;
  variantId: string | null;
  variantName: string | null;
  sku: string | null;
  currentStock: number;
  unitCostMinor: string;
  valueMinor: string;
}

interface Valuation {
  totalValueMinor: string;
  currency: string;
  valuedProducts: number;
  unvaluedProducts: number;
  items: ValuationItem[];
}

/** minor string → "৳1,250.50"; null → "—". */
function taka(minor: string | null | undefined): string {
  if (minor === null || minor === undefined || minor === "") return "—";
  const s = minorToTakaString(minor);
  return s ? `৳${s}` : "—";
}

function velocityText(v: number): string {
  return String(Number(v.toFixed(2)));
}

function daysLeftText(v: number | null): string {
  if (v === null) return "—";
  return `${Number(v.toFixed(1))} দিন`;
}

const inputCls = "w-full rounded-lg border px-3 py-2 text-sm";
const labelCls = "mb-1 block text-xs font-semibold text-slate-700";

function ProductCell({ name, variantName, sku }: { name: string; variantName?: string | null; sku?: string | null }) {
  return (
    <td className="py-2 pr-3 font-medium">
      {name}
      {variantName ? <span className="block text-xs font-normal text-slate-400">{variantName}</span> : null}
      {sku ? <span className="block text-xs font-normal text-slate-400">SKU: {sku}</span> : null}
    </td>
  );
}

export default function InventoryIntelligencePage() {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Settings
  const [leadTimeDays, setLeadTimeDays] = useState("14");
  const [savingSettings, setSavingSettings] = useState(false);

  // Reorder suggestions
  const [mode, setMode] = useState<"simple" | "velocity">("simple");
  const [simpleItems, setSimpleItems] = useState<SimpleSuggestion[]>([]);
  const [velocityData, setVelocityData] = useState<VelocityResponse | null>(null);
  const [sugBusy, setSugBusy] = useState(false);
  const [sugLoaded, setSugLoaded] = useState(false);

  // Velocity table
  const [windowDays, setWindowDays] = useState("30");
  const [velocityItems, setVelocityItems] = useState<VelocityItem[]>([]);
  const [velBusy, setVelBusy] = useState(false);
  const [velLoaded, setVelLoaded] = useState(false);

  // Dead stock
  const [deadDays, setDeadDays] = useState("90");
  const [deadItems, setDeadItems] = useState<DeadStockItem[]>([]);
  const [deadUnvalued, setDeadUnvalued] = useState(0);
  const [deadBusy, setDeadBusy] = useState(false);
  const [deadLoaded, setDeadLoaded] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Valuation
  const [valuation, setValuation] = useState<Valuation | null>(null);

  const loadSettings = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const s = await apiFetch<Settings>(`/organizations/${orgId}/inventory/settings`);
      setLeadTimeDays(String(s.leadTimeDays ?? 14));
    } catch (e) {
      setError(e instanceof Error ? e.message : "সেটিংস লোড করা যায়নি");
    }
  }, []);

  const loadSuggestions = useCallback(async (m: "simple" | "velocity") => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setSugBusy(true);
    try {
      if (m === "simple") {
        const res = await apiFetch<{ items: SimpleSuggestion[] }>(`/organizations/${orgId}/inventory/reorder-suggestions?mode=simple`);
        setSimpleItems(res.items ?? []);
      } else {
        const res = await apiFetch<VelocityResponse>(`/organizations/${orgId}/inventory/reorder-suggestions?mode=velocity`);
        setVelocityData(res);
      }
      setSugLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "পরামর্শ লোড করা যায়নি");
    } finally { setSugBusy(false); }
  }, []);

  const loadVelocity = useCallback(async (days: string) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setVelBusy(true);
    try {
      const res = await apiFetch<{ windowDays: number; generatedAt: string; items: VelocityItem[] }>(
        `/organizations/${orgId}/inventory/velocity?windowDays=${days}`,
      );
      setVelocityItems(res.items ?? []);
      setVelLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "বিক্রির গতি লোড করা যায়নি");
    } finally { setVelBusy(false); }
  }, []);

  const loadDeadStock = useCallback(async (days: string) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const d = Number(days);
    if (!Number.isInteger(d) || d < 1 || d > 365) { setError("দিনের সংখ্যা ১ থেকে ৩৬৫-এর মধ্যে হতে হবে"); return; }
    setDeadBusy(true);
    try {
      const res = await apiFetch<{ days: number; unvaluedCount: number; items: DeadStockItem[] }>(
        `/organizations/${orgId}/inventory/dead-stock?days=${d}`,
      );
      setDeadItems(res.items ?? []);
      setDeadUnvalued(res.unvaluedCount ?? 0);
      setDeadLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dead stock লোড করা যায়নি");
    } finally { setDeadBusy(false); }
  }, []);

  const loadValuation = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); return; }
    try {
      const res = await apiFetch<Valuation>(`/organizations/${orgId}/inventory/valuation`);
      setValuation(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "মূল্যায়ন লোড করা যায়নি");
    }
  }, []);

  useEffect(() => {
    void loadSettings();
    void loadSuggestions("simple");
    void loadVelocity("30");
    void loadDeadStock("90");
    void loadValuation();
  }, [loadSettings, loadSuggestions, loadVelocity, loadDeadStock, loadValuation]);

  function onModeChange(m: "simple" | "velocity") {
    setMode(m);
    void loadSuggestions(m);
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId();
    if (!orgId) return;
    const days = Number(leadTimeDays);
    if (!Number.isInteger(days) || days < 1 || days > 180) {
      setError("লিড টাইম ১ থেকে ১৮০ দিনের মধ্যে পূর্ণসংখ্যা হতে হবে");
      return;
    }
    setSavingSettings(true); setError(""); setNotice("");
    try {
      const saved = await apiFetch<Settings>(`/organizations/${orgId}/inventory/settings`, {
        method: "PUT",
        body: JSON.stringify({ leadTimeDays: days }),
      });
      setLeadTimeDays(String(saved.leadTimeDays ?? days));
      setNotice("✅ লিড টাইম সংরক্ষিত হয়েছে।");
      if (mode === "velocity") void loadSuggestions("velocity");
    } catch (err) {
      setError(err instanceof Error ? err.message : "সংরক্ষণ ব্যর্থ হয়েছে");
    } finally { setSavingSettings(false); }
  }

  async function downloadDeadCsv() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const d = Number(deadDays);
    if (!Number.isInteger(d) || d < 1 || d > 365) { setError("দিনের সংখ্যা ১ থেকে ৩৬৫-এর মধ্যে হতে হবে"); return; }
    setDownloading(true); setError("");
    try {
      // CSV download mirrors the accounting page: raw fetch + blob.
      const res = await fetch(
        `${API_URL}/organizations/${orgId}/inventory/dead-stock.csv?days=${d}`,
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
      a.download = "dead-stock.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setNotice("✅ Dead stock CSV ডাউনলোড হয়েছে।");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ডাউনলোড ব্যর্থ হয়েছে");
    } finally { setDownloading(false); }
  }

  const modeBtn = (key: "simple" | "velocity", label: string) => (
    <button
      type="button" key={key} onClick={() => onModeChange(key)}
      className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${mode === key ? "bg-slate-900 text-white" : "border bg-white"}`}
    >{label}</button>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <div>
        <h1 className="page-title">📊 ইনভেন্টরি বুদ্ধিমত্তা (Inventory Intelligence)</h1>
        <p className="mt-1 text-sm text-slate-500">
          কোন পণ্য কত দ্রুত বিক্রি হচ্ছে, কবে ফুরিয়ে যেতে পারে, কোন স্টক আটকে আছে আর গুদামের মোট মূল্য কত —
          সবই আসল বিক্রি, স্টক ও খরচের রেকর্ড থেকে হিসাব করা।
        </p>
      </div>

      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      <form onSubmit={saveSettings} className="card space-y-3 p-5">
        <h2 className="font-semibold">লিড টাইম সেটিংস</h2>
        <p className="text-xs text-slate-500">
          সরবরাহকারীর কাছে অর্ডার দেওয়ার পর পণ্য হাতে পেতে যত দিন লাগে। এই সংখ্যাটাই velocity (বিক্রির গতি)
          মোডের পুনঃঅর্ডার পরামর্শ চালায় — স্টক যেন লিড টাইমের বিক্রি মেটাতে পারে, সেভাবে পরামর্শিত পরিমাণ হিসাব হয়।
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48">
            <label className={labelCls}>লিড টাইম (দিন)</label>
            <input className={inputCls} type="number" min={1} max={180} value={leadTimeDays} onChange={(e) => setLeadTimeDays(e.target.value)} />
          </div>
          <button type="submit" className="btn-primary" disabled={savingSettings}>
            {savingSettings ? "সংরক্ষণ হচ্ছে…" : "সংরক্ষণ করুন"}
          </button>
        </div>
      </form>

      <div className="card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">পুনঃঅর্ডার পরামর্শ</h2>
          <div className="flex gap-2">
            {modeBtn("simple", "সরল নিয়ম")}
            {modeBtn("velocity", "বিক্রির গতি (velocity)")}
          </div>
        </div>

        {mode === "velocity" ? (
          <>
            <p className="rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-800">
              আনুমানিক — শেষ ৩০ দিনের বিক্রির ভিত্তিতে
            </p>
            <p className="text-xs text-slate-500">
              পরামর্শিত পরিমাণ = দৈনিক বিক্রির গতি × লিড টাইম − বর্তমান স্টক। গতি শূন্য হলে পণ্যটি এই তালিকায় আসে না।
            </p>
            {velocityData && velocityData.noRecentSalesCount > 0 ? (
              <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-700">
                {velocityData.noRecentSalesCount}টি পণ্যের সাম্প্রতিক বিক্রি নেই — সাজেশনে আসেনি।
              </p>
            ) : null}
            {sugBusy ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : null}
            {!sugBusy && velocityData && velocityData.items.length === 0 ? (
              <p className="text-sm text-slate-500">বিক্রির গতির ভিত্তিতে এখন কোনো পণ্যের পুনঃঅর্ডার দরকার নেই।</p>
            ) : velocityData ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-slate-500">
                      <th className="py-2 pr-3">পণ্য</th>
                      <th className="py-2 pr-3">বর্তমান স্টক</th>
                      <th className="py-2 pr-3">দৈনিক গতি</th>
                      <th className="py-2 pr-3">৩০ দিনে বিক্রি</th>
                      <th className="py-2">পরামর্শিত পরিমাণ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {velocityData.items.map((s) => (
                      <tr key={`${s.productId}-${s.variantId ?? ""}`} className="border-b last:border-0">
                        <ProductCell name={s.productName} variantName={s.variantName} sku={s.sku} />
                        <td className="py-2 pr-3">{s.currentStock}</td>
                        <td className="py-2 pr-3">{velocityText(s.dailyVelocity)} / দিন</td>
                        <td className="py-2 pr-3">{s.unitsSold}টি</td>
                        <td className="py-2 font-semibold">{s.suggestedQty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-xs text-slate-500">
              স্টক threshold-এর নিচে নেমে যাওয়া পণ্য — পরামর্শটি আসল স্টক ও শেষ ক্রয়ের রেকর্ড থেকে।
            </p>
            {sugBusy ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : null}
            {!sugBusy && sugLoaded && simpleItems.length === 0 ? (
              <p className="text-sm text-slate-500">এখন কোনো পণ্যের পুনঃঅর্ডার দরকার নেই।</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-slate-500">
                      <th className="py-2 pr-3">পণ্য</th>
                      <th className="py-2 pr-3">বর্তমান স্টক</th>
                      <th className="py-2 pr-3">Threshold</th>
                      <th className="py-2 pr-3">পরামর্শিত পরিমাণ</th>
                      <th className="py-2">শেষ সরবরাহকারী / খরচ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {simpleItems.map((s) => (
                      <tr key={`${s.productId}-${s.variantId ?? ""}`} className="border-b last:border-0">
                        <ProductCell name={s.productName} variantName={s.variantName} sku={s.sku} />
                        <td className="py-2 pr-3">{s.currentStock}</td>
                        <td className="py-2 pr-3">{s.threshold}</td>
                        <td className="py-2 pr-3 font-semibold">{s.suggestedQty}</td>
                        <td className="py-2">
                          {s.lastSupplier ? (
                            <>{s.lastSupplier.name}{s.lastUnitCostMinor ? <span className="block text-xs text-slate-400">শেষ খরচ: {taka(s.lastUnitCostMinor)}</span> : null}</>
                          ) : <span className="text-slate-400">জানা নেই</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      <div className="card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">বিক্রির গতি (Velocity)</h2>
          <div className="w-40">
            <select
              className={inputCls}
              value={windowDays}
              onChange={(e) => { setWindowDays(e.target.value); void loadVelocity(e.target.value); }}
            >
              <option value="30">শেষ ৩০ দিন</option>
              <option value="60">শেষ ৬০ দিন</option>
              <option value="90">শেষ ৯০ দিন</option>
            </select>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          শুধু সম্পন্ন/ডেলিভারি-প্রমাণিত বিক্রি ধরা হয়। গতি শূন্য হলে stockout-এর কোনো সৎ পূর্বাভাস নেই — তাই সেই ঘরে "—" থাকে।
        </p>
        {velBusy ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : null}
        {!velBusy && velLoaded && velocityItems.length === 0 ? (
          <p className="text-sm text-slate-500">ট্র্যাক করা স্টকসহ কোনো পণ্য নেই।</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 pr-3">পণ্য</th>
                  <th className="py-2 pr-3">বিক্রি (ইউনিট)</th>
                  <th className="py-2 pr-3">দৈনিক গতি</th>
                  <th className="py-2 pr-3">বর্তমান স্টক</th>
                  <th className="py-2 pr-3">কতদিন চলবে</th>
                  <th className="py-2">সম্ভাব্য Stockout তারিখ</th>
                </tr>
              </thead>
              <tbody>
                {velocityItems.map((it) => (
                  <tr key={`${it.productId}-${it.variantId ?? ""}`} className="border-b last:border-0">
                    <ProductCell name={it.productName} variantName={it.variantName} sku={it.sku} />
                    <td className="py-2 pr-3">{it.unitsSold}টি</td>
                    <td className="py-2 pr-3">{velocityText(it.dailyVelocity)} / দিন</td>
                    <td className="py-2 pr-3">{it.currentStock}</td>
                    <td className="py-2 pr-3">{daysLeftText(it.daysOfStockLeft)}</td>
                    <td className="py-2">{it.projectedStockoutDate ? new Date(it.projectedStockoutDate).toLocaleDateString("bn-BD") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card space-y-4 p-5">
        <h2 className="font-semibold">Dead Stock — বিক্রি হচ্ছে না</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <label className={labelCls}>কত দিন বিক্রি নেই</label>
            <input className={inputCls} type="number" min={1} max={365} value={deadDays} onChange={(e) => setDeadDays(e.target.value)} />
          </div>
          <button type="button" className="btn-primary" disabled={deadBusy} onClick={() => void loadDeadStock(deadDays)}>
            {deadBusy ? "লোড হচ্ছে…" : "দেখুন"}
          </button>
          <button type="button" className="btn-secondary" disabled={downloading} onClick={() => void downloadDeadCsv()}>
            {downloading ? "তৈরি হচ্ছে…" : "CSV ডাউনলোড"}
          </button>
        </div>
        {deadLoaded && deadUnvalued > 0 ? (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
            {deadUnvalued}টি পণ্যের খরচ জানা নেই — তাদের মূল্য হিসাবের বাইরে রাখা হয়েছে।
          </p>
        ) : null}
        {!deadBusy && deadLoaded && deadItems.length === 0 ? (
          <p className="text-sm text-slate-500">এই সময়সীমায় কোনো Dead Stock পণ্য নেই।</p>
        ) : deadItems.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 pr-3">পণ্য</th>
                  <th className="py-2 pr-3">স্টক</th>
                  <th className="py-2 pr-3">শেষ বিক্রি</th>
                  <th className="py-2 pr-3">একক খরচ</th>
                  <th className="py-2">আটকে থাকা মূল্য</th>
                </tr>
              </thead>
              <tbody>
                {deadItems.map((it) => (
                  <tr key={`${it.productId}-${it.variantId ?? ""}`} className="border-b last:border-0">
                    <ProductCell name={it.productName} variantName={it.variantName} sku={it.sku} />
                    <td className="py-2 pr-3">{it.currentStock}</td>
                    <td className="py-2 pr-3">
                      {it.lastSaleAt ? new Date(it.lastSaleAt).toLocaleDateString("bn-BD") : <span className="text-amber-700">কখনো বিক্রি হয়নি</span>}
                    </td>
                    <td className="py-2 pr-3">{taka(it.unitCostMinor)}</td>
                    <td className="py-2 font-medium">{taka(it.stuckValueMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div className="card space-y-4 p-5">
        <h2 className="font-semibold">গুদামের মোট মূল্যায়ন (Valuation)</h2>
        {valuation ? (
          <>
            <div className="text-3xl font-bold">{taka(valuation.totalValueMinor)}</div>
            <p className="text-sm text-slate-500">
              খরচ-জানা পণ্য {valuation.valuedProducts}টি, খরচ-অজানা {valuation.unvaluedProducts}টি।
            </p>
            {valuation.unvaluedProducts > 0 ? (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
                মোট মূল্য শুধু খরচ-জানা stock-এর উপর — সম্পূর্ণ গুদাম মূল্য নয়। খরচ-অজানা পণ্যের মূল্য এতে ধরা হয়নি।
              </p>
            ) : null}
            {valuation.items.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-slate-500">
                      <th className="py-2 pr-3">পণ্য</th>
                      <th className="py-2 pr-3">স্টক</th>
                      <th className="py-2 pr-3">একক খরচ</th>
                      <th className="py-2">মূল্য</th>
                    </tr>
                  </thead>
                  <tbody>
                    {valuation.items.map((it) => (
                      <tr key={`${it.productId}-${it.variantId ?? ""}`} className="border-b last:border-0">
                        <ProductCell name={it.productName} variantName={it.variantName} sku={it.sku} />
                        <td className="py-2 pr-3">{it.currentStock}</td>
                        <td className="py-2 pr-3">{taka(it.unitCostMinor)}</td>
                        <td className="py-2 font-medium">{taka(it.valueMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500">খরচ-জানা কোনো স্টক পণ্য নেই।</p>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-500">লোড হচ্ছে…</p>
        )}
      </div>
    </div>
  );
}
