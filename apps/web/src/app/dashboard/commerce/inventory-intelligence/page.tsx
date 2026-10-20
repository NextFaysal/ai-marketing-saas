"use client";
import React, { useCallback, useEffect, useState } from "react";
import { fmtDate, fmtMoneyMinor } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
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
  damaged: "damaged",
  lost: "lost2",
  expired: "expired",
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
function taka(minor: string | null | undefined, locale: "bn" | "en" = "bn"): string {
  if (minor === null || minor === undefined || minor === "") return "—";
  return fmtMoneyMinor(locale, BigInt(minor));
}

function velocityText(v: number): string {
  return String(Number(v.toFixed(2)));
}

function daysLeftText(v: number | null, t?: (path: string, params?: Record<string, string | number>) => string): string {
  if (v === null) return "—";
  return t ? t("commerce.days3", { Number: Number(v.toFixed(1)) }) : `${Number(v.toFixed(1))} days`;
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
  const { dict, t, locale } = useLocale();
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
      setError(e instanceof Error ? e.message : dict.commerce.couldNotLoadSettings);
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
      setError(e instanceof Error ? e.message : dict.commerce.couldNotLoadAvailability);
    } finally { setAvailBusy(false); }
  }, []);

  const loadDamageReport = useCallback(async (from: string, to: string) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    if (!from || !to) { setError(dict.commerce.bothStartEndDatesAre); return; }
    setDamageBusy(true);
    try {
      const res = await apiFetch<DamageReport>(
        `/organizations/${orgId}/inventory/damage-report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      setDamageReport(res);
      setDamageLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.commerce.couldNotLoadTheLoss);
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
      setError(e instanceof Error ? e.message : dict.commerce.couldNotLoadSuggestions);
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
      setError(e instanceof Error ? e.message : dict.commerce.couldNotLoadSalesVelocity);
    } finally { setVelBusy(false); }
  }, []);

  const loadDeadStock = useCallback(async (days: string) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const d = Number(days);
    if (!Number.isInteger(d) || d < 1 || d > 365) { setError(dict.commerce.daysMustBeBetween1); return; }
    setDeadBusy(true);
    try {
      const res = await apiFetch<{ days: number; unvaluedCount: number; items: DeadStockItem[] }>(
        `/organizations/${orgId}/inventory/dead-stock?days=${d}`,
      );
      setDeadItems(res.items ?? []);
      setDeadUnvalued(res.unvaluedCount ?? 0);
      setDeadLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.commerce.couldNotLoadDeadStock);
    } finally { setDeadBusy(false); }
  }, []);

  const loadValuation = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError(dict.commerce.noOrganizationSelected); return; }
    try {
      const res = await apiFetch<Valuation>(`/organizations/${orgId}/inventory/valuation`);
      setValuation(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.commerce.couldNotLoadValuation);
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
      setError(dict.commerce.leadTimeMustBeAn);
      return;
    }
    const reserve = Number(reserveMinutes);
    if (!Number.isInteger(reserve) || reserve < 0) {
      setError(dict.commerce.cartReserveMinutesMustBe);
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
      setNotice(dict.commerce.inventorySettingsSaved);
      if (mode === "velocity") void loadSuggestions("velocity");
    } catch (err) {
      setError(err instanceof Error ? err.message : dict.commerce.saveFailed2);
    } finally { setSavingSettings(false); }
  }

  async function downloadDeadCsv() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const d = Number(deadDays);
    if (!Number.isInteger(d) || d < 1 || d > 365) { setError(dict.commerce.daysMustBeBetween1); return; }
    setDownloading(true); setError("");
    try {
      // CSV download mirrors the accounting page: raw fetch + blob.
      const res = await fetch(
        `${API_URL}/organizations/${orgId}/inventory/dead-stock.csv?days=${d}`,
        { headers: { Authorization: `Bearer ${getToken() ?? ""}` } },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? t("commerce.downloadFailedHTTP", { status: res.status }));
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "dead-stock.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setNotice(dict.commerce.deadStockCSVDownloaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : dict.commerce.downloadFailed);
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
        <h1 className="page-title">{dict.commerce.inventoryIntelligence}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {dict.commerce.whichProductIsSellingHow}</p>
      </div>

      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      <form onSubmit={saveSettings} className="card space-y-3 p-5">
        <h2 className="font-semibold">{dict.commerce.inventorySettings}</h2>
        <p className="text-xs text-slate-500">
          {dict.commerce.howManyDaysItTakes}</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48">
            <label className={labelCls}>{dict.commerce.leadTimeDays}</label>
            <input aria-label={dict.commerce.leadTimeDays} className={inputCls} type="number" min={1} max={180} value={leadTimeDays} onChange={(e) => setLeadTimeDays(e.target.value)} />
          </div>
          <div className="w-56">
            <label className={labelCls}>{dict.commerce.cartReserveMinutes}</label>
            <input aria-label={dict.commerce.cartReserveMinutes} className={inputCls} type="number" min={0} value={reserveMinutes} onChange={(e) => setReserveMinutes(e.target.value)} />
            <p className="mt-1 text-xs text-slate-500">{dict.commerce.cartReserveHowManyMinutes}</p>
          </div>
          <button type="submit" className="btn-primary" disabled={savingSettings}>
            {savingSettings ? dict.commerce.saving : dict.common.save}
          </button>
        </div>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5" checked={allowBackorder} onChange={(e) => setAllowBackorder(e.target.checked)} />
          <span>
            <span className="font-semibold">{dict.commerce.allowBackorder}</span>
            <span className="block text-xs text-slate-500">{dict.commerce.ifOnOrdersWillBe}</span>
          </span>
        </label>
      </form>

      <div className="card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">{dict.commerce.reorderSuggestion}</h2>
          <div className="flex gap-2">
            {modeBtn("simple", dict.commerce.simpleRule)}
            {modeBtn("velocity", dict.commerce.salesVelocity)}
          </div>
        </div>

        {mode === "velocity" ? (
          <>
            <p className="rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-800">
              {dict.commerce.estimatedBasedOnTheLast}</p>
            <p className="text-xs text-slate-500">
              {dict.commerce.suggestedQuantityDailySalesVelocity}</p>
            {velocityData && velocityData.noRecentSalesCount > 0 ? (
              <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-700">
                {velocityData.noRecentSalesCount}{dict.commerce.productsHaveNoRecentSales}</p>
            ) : null}
            {sugBusy ? <p className="text-sm text-slate-500">{dict.common.loading}</p> : null}
            {!sugBusy && velocityData && velocityData.items.length === 0 ? (
              <p className="text-sm text-slate-500">{dict.commerce.basedOnSalesVelocityNo}</p>
            ) : velocityData ? (
              <ResponsiveTable
                table={
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-slate-500">
                      <th className="py-2 pr-3">{dict.commerce.product}</th>
                      <th className="py-2 pr-3">{dict.commerce.currentStock}</th>
                      <th className="py-2 pr-3">{dict.commerce.dailyVelocity}</th>
                      <th className="py-2 pr-3">{dict.commerce.soldIn30Days}</th>
                      <th className="py-2">{dict.commerce.suggestedQuantity}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {velocityData.items.map((s) => (
                      <tr key={`${s.productId}-${s.variantId ?? ""}`} className="border-b last:border-0">
                        <ProductCell name={s.productName} variantName={s.variantName} sku={s.sku} />
                        <td className="py-2 pr-3">{s.currentStock}</td>
                        <td className="py-2 pr-3">{velocityText(s.dailyVelocity)} {dict.commerce.day}</td>
                        <td className="py-2 pr-3">{s.unitsSold}{dict.commerce.text1ou8}</td>
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
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.currentStock}</dt><dd className="text-right">{s.currentStock}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.dailyVelocity}</dt><dd className="text-right">{velocityText(s.dailyVelocity)} {dict.commerce.day}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.soldIn30Days}</dt><dd className="text-right">{s.unitsSold}{dict.commerce.text1ou8}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.suggestedQuantity}</dt><dd className="text-right font-semibold">{s.suggestedQty}</dd></div>
                    </dl>
                  </div>
                ))}
              />
            ) : null}
          </>
        ) : (
          <>
            <p className="text-xs text-slate-500">
              {dict.commerce.productsFallenBelowTheStock}</p>
            {sugBusy ? <p className="text-sm text-slate-500">{dict.common.loading}</p> : null}
            {!sugBusy && sugLoaded && simpleItems.length === 0 ? (
              <p className="text-sm text-slate-500">{dict.commerce.noProductsNeedReorderingRight}</p>
            ) : (
              <ResponsiveTable
                table={
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-slate-500">
                      <th className="py-2 pr-3">{dict.commerce.product}</th>
                      <th className="py-2 pr-3">{dict.commerce.currentStock}</th>
                      <th className="py-2 pr-3">Threshold</th>
                      <th className="py-2 pr-3">{dict.commerce.suggestedQuantity}</th>
                      <th className="py-2">{dict.commerce.lastSupplierCost}</th>
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
                            <>{s.lastSupplier.name}{s.lastUnitCostMinor ? <span className="block text-xs text-slate-500">{dict.commerce.lastCost}{taka(s.lastUnitCostMinor, locale)}</span> : null}</>
                          ) : <span className="text-slate-400">{dict.commerce.unknown}</span>}
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
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.currentStock}</dt><dd className="text-right">{s.currentStock}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">Threshold</dt><dd className="text-right">{s.threshold}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.suggestedQuantity}</dt><dd className="text-right font-semibold">{s.suggestedQty}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.lastSupplierCost}</dt><dd className="text-right">{s.lastSupplier ? <>{s.lastSupplier.name}{s.lastUnitCostMinor ? <span className="block text-xs text-slate-500">{dict.commerce.lastCost}{taka(s.lastUnitCostMinor, locale)}</span> : null}</> : <span className="text-slate-400">{dict.commerce.unknown}</span>}</dd></div>
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
          <h2 className="font-semibold">{dict.commerce.salesVelocity2}</h2>
          <div className="w-40">
            <select
              aria-label={dict.commerce.salesVelocityPeriod}
              className={inputCls}
              value={windowDays}
              onChange={(e) => { setWindowDays(e.target.value); void loadVelocity(e.target.value); }}
            >
              <option value="30">{dict.commerce.last30Days}</option>
              <option value="60">{dict.commerce.last60Days}</option>
              <option value="90">{dict.commerce.last90Days}</option>
            </select>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          {dict.commerce.onlyCompletedDeliveryProvenSales}</p>
        <p className="rounded-lg bg-amber-50 p-3 text-xs font-semibold text-amber-800">
          {dict.commerce.aboutTheForecastCellsStatistical}</p>
        {velBusy ? <p className="text-sm text-slate-500">{dict.common.loading}</p> : null}
        {!velBusy && velLoaded && velocityItems.length === 0 ? (
          <p className="text-sm text-slate-500">{dict.commerce.noProductsWithTrackedStock}</p>
        ) : (
          <ResponsiveTable
            table={
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 pr-3">{dict.commerce.product}</th>
                  <th className="py-2 pr-3">{dict.commerce.salesUnits}</th>
                  <th className="py-2 pr-3">{dict.commerce.dailyVelocity}</th>
                  <th className="py-2 pr-3">{dict.commerce.currentStock}</th>
                  <th className="py-2 pr-3">{dict.commerce.forecastBasis}</th>
                  <th className="py-2 pr-3">{dict.commerce.trend}</th>
                  <th className="py-2 pr-3">{dict.commerce.howLongItWillLast}</th>
                  <th className="py-2">{dict.commerce.possibleStockoutDate}</th>
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
                    <td className="py-2 pr-3">{it.unitsSold}{dict.commerce.text1ou8}</td>
                    <td className="py-2 pr-3">{velocityText(it.dailyVelocity)} {dict.commerce.day}</td>
                    <td className="py-2 pr-3">{it.currentStock}</td>
                    <td className="py-2 pr-3">
                      <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${it.demandBasis === "trend_seasonal" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600"}`}>
                        {demandBasisLabel(it.demandBasis, locale)}
                      </span>
                      {it.projectedDailyDemand != null ? (
                        <span className="block text-xs text-slate-500">{dict.commerce.estimatedDailyDemand}{velocityText(it.projectedDailyDemand)}</span>
                      ) : null}
                    </td>
                    <td className={`py-2 pr-3 font-semibold ${trendCls}`}>{trend.text}</td>
                    <td className="py-2 pr-3">
                      {daysLeftText(it.daysOfStockLeftV2 ?? it.daysOfStockLeft, t)}
                      {it.daysOfStockLeftV2 != null && it.daysOfStockLeft != null && it.daysOfStockLeftV2 !== it.daysOfStockLeft ? (
                        <span className="block text-xs font-normal text-slate-500">{dict.commerce.basedOnVelocity}{daysLeftText(it.daysOfStockLeft, t)}</span>
                      ) : null}
                    </td>
                    <td className="py-2">
                      {stockout.primary ? fmtDate(locale, new Date(stockout.primary)) : "—"}
                      {stockout.secondary ? (
                        <span className="block text-xs text-slate-500">
                          {dict.commerce.basedOnVelocity}{fmtDate(locale, new Date(stockout.secondary))}
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
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.salesUnits}</dt><dd className="text-right">{it.unitsSold}{dict.commerce.text1ou8}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.dailyVelocity}</dt><dd className="text-right">{velocityText(it.dailyVelocity)} {dict.commerce.day}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.currentStock}</dt><dd className="text-right">{it.currentStock}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.forecastBasis}</dt><dd className="text-right"><span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${it.demandBasis === "trend_seasonal" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600"}`}>{demandBasisLabel(it.demandBasis, locale)}</span>{it.projectedDailyDemand != null ? <span className="block text-xs text-slate-500">{dict.commerce.estimatedDailyDemand}{velocityText(it.projectedDailyDemand)}</span> : null}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.trend}</dt><dd className={`text-right font-semibold ${trendCls}`}>{trend.text}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.howLongItWillLast}</dt><dd className="text-right">{daysLeftText(it.daysOfStockLeftV2 ?? it.daysOfStockLeft, t)}{it.daysOfStockLeftV2 != null && it.daysOfStockLeft != null && it.daysOfStockLeftV2 !== it.daysOfStockLeft ? <span className="block text-xs font-normal text-slate-500">{dict.commerce.basedOnVelocity}{daysLeftText(it.daysOfStockLeft, t)}</span> : null}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.possibleStockoutDate}</dt><dd className="text-right">{stockout.primary ? fmtDate(locale, new Date(stockout.primary)) : "—"}{stockout.secondary ? <span className="block text-xs text-slate-500">{dict.commerce.basedOnVelocity}{fmtDate(locale, new Date(stockout.secondary))}</span> : null}</dd></div>
                </dl>
              </div>
            );
          })}
          />
        )}
      </div>

      <div className="card space-y-4 p-5">
        <h2 className="font-semibold">{dict.commerce.deadStockNotSelling}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <label className={labelCls}>{dict.commerce.daysWithoutSales}</label>
            <input aria-label={dict.commerce.daysWithoutSales} className={inputCls} type="number" min={1} max={365} value={deadDays} onChange={(e) => setDeadDays(e.target.value)} />
          </div>
          <button type="button" className="btn-primary" disabled={deadBusy} onClick={() => void loadDeadStock(deadDays)}>
            {deadBusy ? dict.common.loading : dict.commerce.view}
          </button>
          <button type="button" className="btn-secondary" disabled={downloading} onClick={() => void downloadDeadCsv()}>
            {downloading ? dict.commerce.creating : dict.commerce.downloadCSV}
          </button>
        </div>
        {deadLoaded && deadUnvalued > 0 ? (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
            {deadUnvalued}{dict.commerce.productsCostsAreUnknownTheir}</p>
        ) : null}
        {!deadBusy && deadLoaded && deadItems.length === 0 ? (
          <p className="text-sm text-slate-500">{dict.commerce.noDeadStockProductsIn}</p>
        ) : deadItems.length > 0 ? (
          <ResponsiveTable
            table={
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 pr-3">{dict.commerce.product}</th>
                  <th className="py-2 pr-3">{dict.commerce.stock}</th>
                  <th className="py-2 pr-3">{dict.commerce.lastSold}</th>
                  <th className="py-2 pr-3">{dict.commerce.unitCost}</th>
                  <th className="py-2">{dict.commerce.stuckValue}</th>
                </tr>
              </thead>
              <tbody>
                {deadItems.map((it) => (
                  <tr key={`${it.productId}-${it.variantId ?? ""}`} className="border-b last:border-0">
                    <ProductCell name={it.productName} variantName={it.variantName} sku={it.sku} />
                    <td className="py-2 pr-3">{it.currentStock}</td>
                    <td className="py-2 pr-3">
                      {it.lastSaleAt ? fmtDate(locale, new Date(it.lastSaleAt)) : <span className="text-amber-700">{dict.commerce.neverSold}</span>}
                    </td>
                    <td className="py-2 pr-3">{taka(it.unitCostMinor, locale)}</td>
                    <td className="py-2 font-medium">{taka(it.stuckValueMinor, locale)}</td>
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
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.stock}</dt><dd className="text-right">{it.currentStock}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.lastSold}</dt><dd className="text-right">{it.lastSaleAt ? fmtDate(locale, new Date(it.lastSaleAt)) : <span className="text-amber-700">{dict.commerce.neverSold}</span>}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.unitCost}</dt><dd className="text-right">{taka(it.unitCostMinor, locale)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.stuckValue}</dt><dd className="text-right font-medium">{taka(it.stuckValueMinor, locale)}</dd></div>
                </dl>
              </div>
            ))}
          />
        ) : null}
      </div>

      <div className="card space-y-4 p-5">
        <h2 className="font-semibold">{dict.commerce.totalWarehouseValuation}</h2>
        {valuation ? (
          <>
            <div className="text-3xl font-bold">{taka(valuation.totalValueMinor, locale)}</div>
            <p className="text-sm text-slate-500">
              {dict.commerce.costKnownProducts}{valuation.valuedProducts}{dict.commerce.costUnknown2}{valuation.unvaluedProducts}{dict.commerce.text1gfvo}</p>
            {valuation.unvaluedProducts > 0 ? (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
                {dict.commerce.theTotalValueIsOnly}</p>
            ) : null}
            {valuation.items.length > 0 ? (
              <ResponsiveTable
                table={
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-slate-500">
                      <th className="py-2 pr-3">{dict.commerce.product}</th>
                      <th className="py-2 pr-3">{dict.commerce.stock}</th>
                      <th className="py-2 pr-3">{dict.commerce.unitCost}</th>
                      <th className="py-2">{dict.commerce.price}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {valuation.items.map((it) => (
                      <tr key={`${it.productId}-${it.variantId ?? ""}`} className="border-b last:border-0">
                        <ProductCell name={it.productName} variantName={it.variantName} sku={it.sku} />
                        <td className="py-2 pr-3">{it.currentStock}</td>
                        <td className="py-2 pr-3">{taka(it.unitCostMinor, locale)}</td>
                        <td className="py-2 font-medium">{taka(it.valueMinor, locale)}</td>
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
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.stock}</dt><dd className="text-right">{it.currentStock}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.unitCost}</dt><dd className="text-right">{taka(it.unitCostMinor, locale)}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.price}</dt><dd className="text-right font-medium">{taka(it.valueMinor, locale)}</dd></div>
                    </dl>
                  </div>
                ))}
              />
            ) : (
              <p className="text-sm text-slate-500">{dict.commerce.noCostKnownStockProducts}</p>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-500">{dict.common.loading}</p>
        )}
      </div>

      <div className="card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">{dict.commerce.stockAvailability}</h2>
          <button type="button" className="btn-secondary" disabled={availBusy} onClick={() => void loadAvailability()}>
            {availBusy ? dict.common.loading : dict.commerce.refresh}
          </button>
        </div>
        <p className="text-xs text-slate-500">{dict.commerce.onlyTrackedStockRowsAre}</p>
        {availBusy && !availLoaded ? <p className="text-sm text-slate-500">{dict.common.loading}</p> : null}
        {availLoaded && availabilityItems.length === 0 ? (
          <p className="text-sm text-slate-500">{dict.commerce.noProductsWithTrackedStock}</p>
        ) : availabilityItems.length > 0 ? (
          <ResponsiveTable
            table={
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 pr-3">{dict.commerce.productVariant}</th>
                  <th className="py-2 pr-3">{dict.commerce.onHand}</th>
                  <th className="py-2 pr-3">{dict.commerce.reserved}</th>
                  <th className="py-2">{dict.commerce.willBeAvailable}</th>
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
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.onHand}</dt><dd className="text-right">{it.onHand}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.reserved}</dt><dd className="text-right">{it.reserved}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.willBeAvailable}</dt><dd className="text-right font-semibold">{it.available}</dd></div>
                </dl>
              </div>
            ))}
          />
        ) : null}
      </div>

      <div className="card space-y-4 p-5">
        <h2 className="font-semibold">{dict.commerce.damageLossReport}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-44">
            <label className={labelCls}>{dict.commerce.startDate}</label>
            <input aria-label={dict.commerce.startDate} className={inputCls} type="date" value={damageFrom} onChange={(e) => setDamageFrom(e.target.value)} />
          </div>
          <div className="w-44">
            <label className={labelCls}>{dict.commerce.endDate}</label>
            <input aria-label={dict.commerce.endDate} className={inputCls} type="date" value={damageTo} onChange={(e) => setDamageTo(e.target.value)} />
          </div>
          <button type="button" className="btn-primary" disabled={damageBusy} onClick={() => void loadDamageReport(damageFrom, damageTo)}>
            {damageBusy ? dict.common.loading : dict.commerce.viewReport}
          </button>
        </div>
        {damageBusy && !damageLoaded ? <p className="text-sm text-slate-500">{dict.common.loading}</p> : null}
        {damageLoaded && damageReport && damageReport.items.length === 0 ? (
          <p className="text-sm text-slate-500">{dict.commerce.noDamagedLostExpiredProduct}</p>
        ) : damageReport && damageReport.items.length > 0 ? (
          <>
            {damageReport.totals.uncostedMovements > 0 ? (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
                {damageReport.totals.uncostedMovements}{dict.commerce.movementsHaveNoCostRecords}</p>
            ) : null}
            <ResponsiveTable
              table={
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-slate-500">
                    <th className="py-2 pr-3">{dict.commerce.date}</th>
                    <th className="py-2 pr-3">{dict.commerce.product}</th>
                    <th className="py-2 pr-3">{dict.commerce.reason2}</th>
                    <th className="py-2 pr-3">{dict.commerce.quantity}</th>
                    <th className="py-2">{dict.commerce.estimatedCostPrice}</th>
                  </tr>
                </thead>
                <tbody>
                  {damageReport.items.map((it, i) => (
                    <tr key={`${it.productId}-${it.variantId ?? ""}-${it.createdAt}-${i}`} className="border-b last:border-0">
                      <td className="py-2 pr-3">{fmtDate(locale, new Date(it.createdAt))}</td>
                      <ProductCell name={it.productName} variantName={it.variantName} sku={null} />
                      <td className="py-2 pr-3">{DAMAGE_REASON_LABELS[it.reason] ? dict.commerce[DAMAGE_REASON_LABELS[it.reason] as keyof typeof dict.commerce] : it.reason}</td>
                      <td className="py-2 pr-3">{it.quantity}</td>
                      <td className="py-2">{it.costValueMinor != null ? taka(it.costValueMinor, locale) : "—"}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="py-2 pr-3" colSpan={3}>
                      {dict.commerce.totalDamaged}{damageReport.totals.damagedQty} {dict.commerce.lost}{damageReport.totals.lostQty} {dict.commerce.expired2}{damageReport.totals.expiredQty}
                    </td>
                    <td className="py-2 pr-3">{damageReport.totals.totalQty}</td>
                    <td className="py-2">{damageReport.totals.costValueMinor != null ? taka(damageReport.totals.costValueMinor, locale) : "—"}</td>
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
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.date}</dt><dd className="text-right">{fmtDate(locale, new Date(it.createdAt))}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.reason2}</dt><dd className="text-right">{DAMAGE_REASON_LABELS[it.reason] ? dict.commerce[DAMAGE_REASON_LABELS[it.reason] as keyof typeof dict.commerce] : it.reason}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.quantity}</dt><dd className="text-right">{it.quantity}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.estimatedCostPrice}</dt><dd className="text-right">{it.costValueMinor != null ? taka(it.costValueMinor, locale) : "—"}</dd></div>
                    </dl>
                  </div>
                ))}
                <div className="rounded-xl border bg-slate-50 p-3 text-sm font-semibold shadow-sm">
                  {dict.commerce.totalDamaged}{damageReport.totals.damagedQty} {dict.commerce.lost}{damageReport.totals.lostQty} {dict.commerce.expired2}{damageReport.totals.expiredQty}
                  <dl className="mt-2 space-y-1.5">
                    <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.quantity}</dt><dd className="text-right">{damageReport.totals.totalQty}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.estimatedCostPrice}</dt><dd className="text-right">{damageReport.totals.costValueMinor != null ? taka(damageReport.totals.costValueMinor, locale) : "—"}</dd></div>
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
