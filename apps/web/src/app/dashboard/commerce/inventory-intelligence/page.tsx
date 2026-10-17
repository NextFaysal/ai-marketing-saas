"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { minorToTakaString } from "@/lib/storefront-money";
import {
  demandBasisLabel, pickStockoutDisplay, trendGrowthDisplay,
  type VelocityV2Fields,
} from "@/lib/ab7";
import { ResponsiveTable } from "@repo/ui";

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

interface Settings { leadTimeDays: number; allowBackorder?: boolean; reserveMinutes?: number }

interface AvailabilityItem {
  productId: string;
  productName: string;
  variantId: string | null;
  variantName: string | null;
  sku: string | null;
  onHand: number;
  reserved: number;
  available: number;
}

interface DamageItem {
  productId: string;
  productName: string;
  variantId: string | null;
  variantName: string | null;
  reason: string;
  quantity: number;
  costValueMinor: string | null;
  note: string | null;
  createdAt: string;
}

interface DamageReport {
  from: string;
  to: string;
  totals: {
    damagedQty: number;
    lostQty: number;
    expiredQty: number;
    totalQty: number;
    costValueMinor: string | null;
    uncostedMovements: number;
  };
  items: DamageItem[];
}

const DAMAGE_REASON_LABELS: Record<string, string> = {
  damaged: "নষ্ট",
  lost: "হারানো",
  expired: "মেয়াদোত্তীর্ণ",
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

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
  // AB7 (AX20): v2 forecast fields arrive alongside the v1 fields
  // above; optional here so a pre-v2 response still renders v1.
  trendGrowthPct?: number | null;
  weekdayFactors?: number[];
  projectedDailyDemand?: number;
  projectedStockoutDateV2?: string | null;
  daysOfStockLeftV2?: number | null;
  demandBasis?: VelocityV2Fields["demandBasis"];
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
      {variantName ? <span className="block text-xs font-normal text-slate-500">{variantName}</span> : null}
      {sku ? <span className="block text-xs font-normal text-slate-500">SKU: {sku}</span> : null}
    </td>
  );
}

// EB6: the mobile-card twin of ProductCell — same name/variant/SKU
// content, rendered as a card heading instead of a <td>.
function ProductCardHead({ name, variantName, sku }: { name: string; variantName?: string | null; sku?: string | null }) {
  return (
    <div className="font-medium">
      {name}
      {variantName ? <span className="block text-xs font-normal text-slate-500">{variantName}</span> : null}
      {sku ? <span className="block text-xs font-normal text-slate-500">SKU: {sku}</span> : null}
    </div>
  );
}

export default function InventoryIntelligencePage() {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Settings
  const [leadTimeDays, setLeadTimeDays] = useState("14");
  const [allowBackorder, setAllowBackorder] = useState(false);
  const [reserveMinutes, setReserveMinutes] = useState("0");
  const [savingSettings, setSavingSettings] = useState(false);

  // GC7: availability
  const [availabilityItems, setAvailabilityItems] = useState<AvailabilityItem[]>([]);
  const [availBusy, setAvailBusy] = useState(false);
  const [availLoaded, setAvailLoaded] = useState(false);

  // GC7: damage / loss report
  const [damageFrom, setDamageFrom] = useState(() => isoDate(new Date(Date.now() - 29 * 24 * 60 * 60 * 1000)));
  const [damageTo, setDamageTo] = useState(() => isoDate(new Date()));
  const [damageReport, setDamageReport] = useState<DamageReport | null>(null);
  const [damageBusy, setDamageBusy] = useState(false);
  const [damageLoaded, setDamageLoaded] = useState(false);

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
      setAllowBackorder(!!s.allowBackorder);
      setReserveMinutes(String(s.reserveMinutes ?? 0));
    } catch (e) {
      setError(e instanceof Error ? e.message : "সেটিংস লোড করা যায়নি");
    }
  }, []);

  const loadAvailability = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setAvailBusy(true);
    try {
      const res = await apiFetch<{ items: AvailabilityItem[] }>(`/organizations/${orgId}/inventory/availability`);
      setAvailabilityItems(res.items ?? []);
      setAvailLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "প্রাপ্যতা লোড করা যায়নি");
    } finally { setAvailBusy(false); }
  }, []);

  const loadDamageReport = useCallback(async (from: string, to: string) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    if (!from || !to) { setError("শুরুর ও শেষের তারিখ দুটোই দিতে হবে"); return; }
    setDamageBusy(true);
    try {
      const res = await apiFetch<DamageReport>(
        `/organizations/${orgId}/inventory/damage-report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      setDamageReport(res);
      setDamageLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ক্ষতির রিপোর্ট লোড করা যায়নি");
    } finally { setDamageBusy(false); }
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
    void loadAvailability();
    void loadDamageReport(
      isoDate(new Date(Date.now() - 29 * 24 * 60 * 60 * 1000)),
      isoDate(new Date()),
    );
  }, [loadSettings, loadSuggestions, loadVelocity, loadDeadStock, loadValuation, loadAvailability, loadDamageReport]);

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
    const reserve = Number(reserveMinutes);
    if (!Number.isInteger(reserve) || reserve < 0) {
      setError("কার্ট রিজার্ভ মিনিট ০ বা তার বেশি পূর্ণসংখ্যা হতে হবে");
      return;
    }
    setSavingSettings(true); setError(""); setNotice("");
    try {
      // Partial PUT — only the fields shown on this card are sent.
      const saved = await apiFetch<Settings>(`/organizations/${orgId}/inventory/settings`, {
        method: "PUT",
        body: JSON.stringify({ leadTimeDays: days, allowBackorder, reserveMinutes: reserve }),
      });
      setLeadTimeDays(String(saved.leadTimeDays ?? days));
      setAllowBackorder(!!saved.allowBackorder);
      setReserveMinutes(String(saved.reserveMinutes ?? reserve));
      setNotice("✅ ইনভেন্টরি সেটিংস সংরক্ষিত হয়েছে।");
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
      className={`inline-flex min-h-[44px] items-center rounded-lg px-3 py-1.5 text-sm font-semibold ${mode === key ? "bg-slate-900 text-white" : "border bg-white"}`}
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
        <h2 className="font-semibold">ইনভেন্টরি সেটিংস</h2>
        <p className="text-xs text-slate-500">
          সরবরাহকারীর কাছে অর্ডার দেওয়ার পর পণ্য হাতে পেতে যত দিন লাগে। এই সংখ্যাটাই velocity (বিক্রির গতি)
          মোডের পুনঃঅর্ডার পরামর্শ চালায় — স্টক যেন লিড টাইমের বিক্রি মেটাতে পারে, সেভাবে পরামর্শিত পরিমাণ হিসাব হয়।
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48">
            <label className={labelCls}>লিড টাইম (দিন)</label>
            <input aria-label="লিড টাইম (দিন)" className={inputCls} type="number" min={1} max={180} value={leadTimeDays} onChange={(e) => setLeadTimeDays(e.target.value)} />
          </div>
          <div className="w-56">
            <label className={labelCls}>কার্ট রিজার্ভ (মিনিট)</label>
            <input aria-label="কার্ট রিজার্ভ (মিনিট)" className={inputCls} type="number" min={0} value={reserveMinutes} onChange={(e) => setReserveMinutes(e.target.value)} />
            <p className="mt-1 text-xs text-slate-500">কার্ট রিজার্ভ: ক্রেতা কার্টে পণ্য রাখলে যত মিনিট স্টক তার জন্য রিজার্ভ থাকবে; ০ = বন্ধ</p>
          </div>
          <button type="submit" className="btn-primary" disabled={savingSettings}>
            {savingSettings ? "সংরক্ষণ হচ্ছে…" : "সংরক্ষণ করুন"}
          </button>
        </div>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5" checked={allowBackorder} onChange={(e) => setAllowBackorder(e.target.checked)} />
          <span>
            <span className="font-semibold">ব্যাকঅর্ডার অনুমোদন (Allow backorder)</span>
            <span className="block text-xs text-slate-500">চালু থাকলে স্টক শেষ হয়ে গেলেও অনলাইন চেকআউটে অর্ডার নেওয়া হবে এবং স্টক ঋণাত্মক হতে পারে</span>
          </span>
        </label>
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
              <ResponsiveTable
                table={
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
                }
                cards={velocityData.items.map((s) => (
                  <div key={`${s.productId}-${s.variantId ?? ""}`} className="rounded-xl border bg-white p-3 text-sm shadow-sm">
                    <ProductCardHead name={s.productName} variantName={s.variantName} sku={s.sku} />
                    <dl className="mt-2 space-y-1.5">
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">বর্তমান স্টক</dt><dd className="text-right">{s.currentStock}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">দৈনিক গতি</dt><dd className="text-right">{velocityText(s.dailyVelocity)} / দিন</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">৩০ দিনে বিক্রি</dt><dd className="text-right">{s.unitsSold}টি</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">পরামর্শিত পরিমাণ</dt><dd className="text-right font-semibold">{s.suggestedQty}</dd></div>
                    </dl>
                  </div>
                ))}
              />
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
              <ResponsiveTable
                table={
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
                            <>{s.lastSupplier.name}{s.lastUnitCostMinor ? <span className="block text-xs text-slate-500">শেষ খরচ: {taka(s.lastUnitCostMinor)}</span> : null}</>
                          ) : <span className="text-slate-400">জানা নেই</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
                }
                cards={simpleItems.map((s) => (
                  <div key={`${s.productId}-${s.variantId ?? ""}`} className="rounded-xl border bg-white p-3 text-sm shadow-sm">
                    <ProductCardHead name={s.productName} variantName={s.variantName} sku={s.sku} />
                    <dl className="mt-2 space-y-1.5">
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">বর্তমান স্টক</dt><dd className="text-right">{s.currentStock}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">Threshold</dt><dd className="text-right">{s.threshold}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">পরামর্শিত পরিমাণ</dt><dd className="text-right font-semibold">{s.suggestedQty}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">শেষ সরবরাহকারী / খরচ</dt><dd className="text-right">{s.lastSupplier ? <>{s.lastSupplier.name}{s.lastUnitCostMinor ? <span className="block text-xs text-slate-500">শেষ খরচ: {taka(s.lastUnitCostMinor)}</span> : null}</> : <span className="text-slate-400">জানা নেই</span>}</dd></div>
                    </dl>
                  </div>
                ))}
              />
            )}
          </>
        )}
      </div>

      <div className="card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">বিক্রির গতি (Velocity)</h2>
          <div className="w-40">
            <select
              aria-label="বিক্রির গতির সময়সীমা"
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
        <p className="rounded-lg bg-amber-50 p-3 text-xs font-semibold text-amber-800">
          পূর্বাভাসের ঘরগুলো সম্পর্কে: পরিসংখ্যানভিত্তিক অনুমান — নিশ্চয়তা নয়
        </p>
        {velBusy ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : null}
        {!velBusy && velLoaded && velocityItems.length === 0 ? (
          <p className="text-sm text-slate-500">ট্র্যাক করা স্টকসহ কোনো পণ্য নেই।</p>
        ) : (
          <ResponsiveTable
            table={
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 pr-3">পণ্য</th>
                  <th className="py-2 pr-3">বিক্রি (ইউনিট)</th>
                  <th className="py-2 pr-3">দৈনিক গতি</th>
                  <th className="py-2 pr-3">বর্তমান স্টক</th>
                  <th className="py-2 pr-3">পূর্বাভাসের ভিত্তি</th>
                  <th className="py-2 pr-3">ট্রেন্ড</th>
                  <th className="py-2 pr-3">কতদিন চলবে</th>
                  <th className="py-2">সম্ভাব্য Stockout তারিখ</th>
                </tr>
              </thead>
              <tbody>
                {velocityItems.map((it) => {
                  const trend = trendGrowthDisplay(it.trendGrowthPct);
                  const stockout = pickStockoutDisplay(it.projectedStockoutDate, it.projectedStockoutDateV2);
                  const trendCls = trend.tone === "up" ? "text-emerald-600"
                    : trend.tone === "down" ? "text-rose-600" : "text-slate-500";
                  return (
                  <tr key={`${it.productId}-${it.variantId ?? ""}`} className="border-b last:border-0">
                    <ProductCell name={it.productName} variantName={it.variantName} sku={it.sku} />
                    <td className="py-2 pr-3">{it.unitsSold}টি</td>
                    <td className="py-2 pr-3">{velocityText(it.dailyVelocity)} / দিন</td>
                    <td className="py-2 pr-3">{it.currentStock}</td>
                    <td className="py-2 pr-3">
                      <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${it.demandBasis === "trend_seasonal" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600"}`}>
                        {demandBasisLabel(it.demandBasis)}
                      </span>
                      {it.projectedDailyDemand != null ? (
                        <span className="block text-xs text-slate-500">আনুমানিক দৈনিক চাহিদা: {velocityText(it.projectedDailyDemand)}</span>
                      ) : null}
                    </td>
                    <td className={`py-2 pr-3 font-semibold ${trendCls}`}>{trend.text}</td>
                    <td className="py-2 pr-3">
                      {daysLeftText(it.daysOfStockLeftV2 ?? it.daysOfStockLeft)}
                      {it.daysOfStockLeftV2 != null && it.daysOfStockLeft != null && it.daysOfStockLeftV2 !== it.daysOfStockLeft ? (
                        <span className="block text-xs font-normal text-slate-500">গতি-ভিত্তিক হিসাবে: {daysLeftText(it.daysOfStockLeft)}</span>
                      ) : null}
                    </td>
                    <td className="py-2">
                      {stockout.primary ? new Date(stockout.primary).toLocaleDateString("bn-BD") : "—"}
                      {stockout.secondary ? (
                        <span className="block text-xs text-slate-500">
                          গতি-ভিত্তিক হিসাবে: {new Date(stockout.secondary).toLocaleDateString("bn-BD")}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          }
          cards={velocityItems.map((it) => {
            const trend = trendGrowthDisplay(it.trendGrowthPct);
            const stockout = pickStockoutDisplay(it.projectedStockoutDate, it.projectedStockoutDateV2);
            const trendCls = trend.tone === "up" ? "text-emerald-600"
              : trend.tone === "down" ? "text-rose-600" : "text-slate-500";
            return (
              <div key={`${it.productId}-${it.variantId ?? ""}`} className="rounded-xl border bg-white p-3 text-sm shadow-sm">
                <ProductCardHead name={it.productName} variantName={it.variantName} sku={it.sku} />
                <dl className="mt-2 space-y-1.5">
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">বিক্রি (ইউনিট)</dt><dd className="text-right">{it.unitsSold}টি</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">দৈনিক গতি</dt><dd className="text-right">{velocityText(it.dailyVelocity)} / দিন</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">বর্তমান স্টক</dt><dd className="text-right">{it.currentStock}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">পূর্বাভাসের ভিত্তি</dt><dd className="text-right"><span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${it.demandBasis === "trend_seasonal" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600"}`}>{demandBasisLabel(it.demandBasis)}</span>{it.projectedDailyDemand != null ? <span className="block text-xs text-slate-500">আনুমানিক দৈনিক চাহিদা: {velocityText(it.projectedDailyDemand)}</span> : null}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">ট্রেন্ড</dt><dd className={`text-right font-semibold ${trendCls}`}>{trend.text}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">কতদিন চলবে</dt><dd className="text-right">{daysLeftText(it.daysOfStockLeftV2 ?? it.daysOfStockLeft)}{it.daysOfStockLeftV2 != null && it.daysOfStockLeft != null && it.daysOfStockLeftV2 !== it.daysOfStockLeft ? <span className="block text-xs font-normal text-slate-500">গতি-ভিত্তিক হিসাবে: {daysLeftText(it.daysOfStockLeft)}</span> : null}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">সম্ভাব্য Stockout তারিখ</dt><dd className="text-right">{stockout.primary ? new Date(stockout.primary).toLocaleDateString("bn-BD") : "—"}{stockout.secondary ? <span className="block text-xs text-slate-500">গতি-ভিত্তিক হিসাবে: {new Date(stockout.secondary).toLocaleDateString("bn-BD")}</span> : null}</dd></div>
                </dl>
              </div>
            );
          })}
          />
        )}
      </div>

      <div className="card space-y-4 p-5">
        <h2 className="font-semibold">Dead Stock — বিক্রি হচ্ছে না</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <label className={labelCls}>কত দিন বিক্রি নেই</label>
            <input aria-label="কত দিন বিক্রি নেই" className={inputCls} type="number" min={1} max={365} value={deadDays} onChange={(e) => setDeadDays(e.target.value)} />
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
          <ResponsiveTable
            table={
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
            }
            cards={deadItems.map((it) => (
              <div key={`${it.productId}-${it.variantId ?? ""}`} className="rounded-xl border bg-white p-3 text-sm shadow-sm">
                <ProductCardHead name={it.productName} variantName={it.variantName} sku={it.sku} />
                <dl className="mt-2 space-y-1.5">
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">স্টক</dt><dd className="text-right">{it.currentStock}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">শেষ বিক্রি</dt><dd className="text-right">{it.lastSaleAt ? new Date(it.lastSaleAt).toLocaleDateString("bn-BD") : <span className="text-amber-700">কখনো বিক্রি হয়নি</span>}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">একক খরচ</dt><dd className="text-right">{taka(it.unitCostMinor)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">আটকে থাকা মূল্য</dt><dd className="text-right font-medium">{taka(it.stuckValueMinor)}</dd></div>
                </dl>
              </div>
            ))}
          />
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
              <ResponsiveTable
                table={
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
                }
                cards={valuation.items.map((it) => (
                  <div key={`${it.productId}-${it.variantId ?? ""}`} className="rounded-xl border bg-white p-3 text-sm shadow-sm">
                    <ProductCardHead name={it.productName} variantName={it.variantName} sku={it.sku} />
                    <dl className="mt-2 space-y-1.5">
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">স্টক</dt><dd className="text-right">{it.currentStock}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">একক খরচ</dt><dd className="text-right">{taka(it.unitCostMinor)}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">মূল্য</dt><dd className="text-right font-medium">{taka(it.valueMinor)}</dd></div>
                    </dl>
                  </div>
                ))}
              />
            ) : (
              <p className="text-sm text-slate-500">খরচ-জানা কোনো স্টক পণ্য নেই।</p>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-500">লোড হচ্ছে…</p>
        )}
      </div>

      <div className="card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">স্টক প্রাপ্যতা (Availability)</h2>
          <button type="button" className="btn-secondary" disabled={availBusy} onClick={() => void loadAvailability()}>
            {availBusy ? "লোড হচ্ছে…" : "রিফ্রেশ"}
          </button>
        </div>
        <p className="text-xs text-slate-500">শুধু ট্র্যাক করা স্টক Row দেখানো হয় — হাতে থাকা স্টক থেকে কার্ট রিজার্ভ বাদ দিলে যা সত্যিই পাওয়া যাবে।</p>
        {availBusy && !availLoaded ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : null}
        {availLoaded && availabilityItems.length === 0 ? (
          <p className="text-sm text-slate-500">ট্র্যাক করা স্টকসহ কোনো পণ্য নেই।</p>
        ) : availabilityItems.length > 0 ? (
          <ResponsiveTable
            table={
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 pr-3">পণ্য / ভ্যারিয়েন্ট</th>
                  <th className="py-2 pr-3">হাতে আছে</th>
                  <th className="py-2 pr-3">রিজার্ভ</th>
                  <th className="py-2">পাওয়া যাবে</th>
                </tr>
              </thead>
              <tbody>
                {availabilityItems.map((it) => (
                  <tr key={`${it.productId}-${it.variantId ?? ""}`} className="border-b last:border-0">
                    <ProductCell name={it.productName} variantName={it.variantName} sku={it.sku} />
                    <td className="py-2 pr-3">{it.onHand}</td>
                    <td className="py-2 pr-3">{it.reserved}</td>
                    <td className="py-2 font-semibold">{it.available}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            }
            cards={availabilityItems.map((it) => (
              <div key={`${it.productId}-${it.variantId ?? ""}`} className="rounded-xl border bg-white p-3 text-sm shadow-sm">
                <ProductCardHead name={it.productName} variantName={it.variantName} sku={it.sku} />
                <dl className="mt-2 space-y-1.5">
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">হাতে আছে</dt><dd className="text-right">{it.onHand}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">রিজার্ভ</dt><dd className="text-right">{it.reserved}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">পাওয়া যাবে</dt><dd className="text-right font-semibold">{it.available}</dd></div>
                </dl>
              </div>
            ))}
          />
        ) : null}
      </div>

      <div className="card space-y-4 p-5">
        <h2 className="font-semibold">ক্ষতি / হারানো রিপোর্ট (Damage &amp; Loss)</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-44">
            <label className={labelCls}>শুরুর তারিখ</label>
            <input aria-label="শুরুর তারিখ" className={inputCls} type="date" value={damageFrom} onChange={(e) => setDamageFrom(e.target.value)} />
          </div>
          <div className="w-44">
            <label className={labelCls}>শেষের তারিখ</label>
            <input aria-label="শেষের তারিখ" className={inputCls} type="date" value={damageTo} onChange={(e) => setDamageTo(e.target.value)} />
          </div>
          <button type="button" className="btn-primary" disabled={damageBusy} onClick={() => void loadDamageReport(damageFrom, damageTo)}>
            {damageBusy ? "লোড হচ্ছে…" : "রিপোর্ট দেখুন"}
          </button>
        </div>
        {damageBusy && !damageLoaded ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : null}
        {damageLoaded && damageReport && damageReport.items.length === 0 ? (
          <p className="text-sm text-slate-500">এই সময়ে কোনো নষ্ট / হারানো / মেয়াদোত্তীর্ণ পণ্যের রেকর্ড নেই।</p>
        ) : damageReport && damageReport.items.length > 0 ? (
          <>
            {damageReport.totals.uncostedMovements > 0 ? (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
                {damageReport.totals.uncostedMovements}টি Movement-এর খরচ রেকর্ড নেই — মোট খরচ মূল্য শুধু খরচ-জানা Movementগুলোর উপর হিসাব করা।
              </p>
            ) : null}
            <ResponsiveTable
              table={
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-slate-500">
                    <th className="py-2 pr-3">তারিখ</th>
                    <th className="py-2 pr-3">পণ্য</th>
                    <th className="py-2 pr-3">কারণ</th>
                    <th className="py-2 pr-3">পরিমাণ</th>
                    <th className="py-2">আনুমানিক খরচ মূল্য</th>
                  </tr>
                </thead>
                <tbody>
                  {damageReport.items.map((it, i) => (
                    <tr key={`${it.productId}-${it.variantId ?? ""}-${it.createdAt}-${i}`} className="border-b last:border-0">
                      <td className="py-2 pr-3">{new Date(it.createdAt).toLocaleDateString("bn-BD")}</td>
                      <ProductCell name={it.productName} variantName={it.variantName} sku={null} />
                      <td className="py-2 pr-3">{DAMAGE_REASON_LABELS[it.reason] ?? it.reason}</td>
                      <td className="py-2 pr-3">{it.quantity}</td>
                      <td className="py-2">{it.costValueMinor != null ? taka(it.costValueMinor) : "—"}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="py-2 pr-3" colSpan={3}>
                      মোট — নষ্ট {damageReport.totals.damagedQty} · হারানো {damageReport.totals.lostQty} · মেয়াদোত্তীর্ণ {damageReport.totals.expiredQty}
                    </td>
                    <td className="py-2 pr-3">{damageReport.totals.totalQty}</td>
                    <td className="py-2">{damageReport.totals.costValueMinor != null ? taka(damageReport.totals.costValueMinor) : "—"}</td>
                  </tr>
                </tbody>
              </table>
            </div>
              }
              cards={(<>
                {damageReport.items.map((it, i) => (
                  <div key={`${it.productId}-${it.variantId ?? ""}-${it.createdAt}-${i}`} className="rounded-xl border bg-white p-3 text-sm shadow-sm">
                    <ProductCardHead name={it.productName} variantName={it.variantName} sku={null} />
                    <dl className="mt-2 space-y-1.5">
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">তারিখ</dt><dd className="text-right">{new Date(it.createdAt).toLocaleDateString("bn-BD")}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">কারণ</dt><dd className="text-right">{DAMAGE_REASON_LABELS[it.reason] ?? it.reason}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">পরিমাণ</dt><dd className="text-right">{it.quantity}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">আনুমানিক খরচ মূল্য</dt><dd className="text-right">{it.costValueMinor != null ? taka(it.costValueMinor) : "—"}</dd></div>
                    </dl>
                  </div>
                ))}
                <div className="rounded-xl border bg-slate-50 p-3 text-sm font-semibold shadow-sm">
                  মোট — নষ্ট {damageReport.totals.damagedQty} · হারানো {damageReport.totals.lostQty} · মেয়াদোত্তীর্ণ {damageReport.totals.expiredQty}
                  <dl className="mt-2 space-y-1.5">
                    <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">পরিমাণ</dt><dd className="text-right">{damageReport.totals.totalQty}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">আনুমানিক খরচ মূল্য</dt><dd className="text-right">{damageReport.totals.costValueMinor != null ? taka(damageReport.totals.costValueMinor) : "—"}</dd></div>
                  </dl>
                </div>
              </>)}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
