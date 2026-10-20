"use client";
import React, { useCallback, useEffect, useState } from "react";
import { fmtDate, fmtMoney } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { ResponsiveTable } from "@repo/ui";

// EC7 — tenant store discounts. These are the merchant's OWN codes
// (StoreDiscount), unrelated to the SaaS-plan Coupon system.
interface DiscountSync {
  storeId: string; storeName?: string | null; externalId?: string | null;
  syncStatus: string; lastError?: string | null;
}
interface Discount {
  id: string; code: string; kind: string; value: number;
  minOrderMinor?: string | null; scopeType: string; scopeIds?: string[] | null;
  startsAt?: string | null; endsAt?: string | null;
  usageLimit?: number | null; usedCount: number; active: boolean; origin: string;
  // GB7 (GC17): eligibility + exclusion fields.
  firstOrderOnly?: boolean;
  repeatCustomerOnly?: boolean;
  // NF14 (FB5): app-only offer — display rule only.
  appOnly?: boolean;
  perCustomerLimit?: number | null;
  maxOrderMinor?: string | null;
  excludedProductIds?: string[];
  excludedCategoryIds?: string[];
  sourceRef?: string | null;
  syncs?: DiscountSync[];
}
interface Store { id: string; name: string; platform?: string; syncMode?: string }
interface ProductOpt { id: string; name: string }
interface CategoryOpt { id: string; name: string }

const ORIGIN_LABEL: Record<string, string> = {
  manual: "manual",
  woocommerce: "WooCommerce",
  shopify: "Shopify",
  abandoned_recovery: "abandonedCartRecovery",
};

const splitIds = (text: string): string[] =>
  text.split(",").map((x) => x.trim()).filter(Boolean);

const KIND_LABEL: Record<string, string> = {
  percent: "percentage",
  fixed: "fixedAmount2",
  free_shipping: "freeDelivery",
};

const money = (minor?: string | null, locale: "bn" | "en" = "bn") =>
  minor == null ? "—" : fmtMoney(locale, Number(minor) / 100, { maximumFractionDigits: 2 });

function syncChip(s: DiscountSync) {
  const cls = s.syncStatus === "synced" ? "bg-green-100 text-green-700"
    : s.syncStatus === "failed" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700";
  return (
    <span key={s.storeId} title={s.lastError ?? undefined} className={`rounded px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {s.storeName ?? s.storeId.slice(0, 6)}: {s.syncStatus}{s.syncStatus === "failed" && s.lastError ? ` — ${s.lastError}` : ""}
    </span>
  );
}

export default function DiscountsPage() {
  const { dict, t, locale } = useLocale();
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [categories, setCategories] = useState<CategoryOpt[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);

  // create/edit form
  const [editingId, setEditingId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [kind, setKind] = useState("percent");
  const [value, setValue] = useState("10");
  const [minOrder, setMinOrder] = useState("");
  const [scopeType, setScopeType] = useState("all");
  const [scopeIds, setScopeIds] = useState<string[]>([]);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [usageLimit, setUsageLimit] = useState("");
  const [targetStores, setTargetStores] = useState<string[]>([]);
  // GB7 (GC17): eligibility + exclusions + origin filter
  const [firstOrderOnly, setFirstOrderOnly] = useState(false);
  const [repeatCustomerOnly, setRepeatCustomerOnly] = useState(false);
  // NF14 (FB5)
  const [appOnly, setAppOnly] = useState(false);
  const [perCustomerLimit, setPerCustomerLimit] = useState("");
  const [maxOrder, setMaxOrder] = useState("");
  const [excludedProductIdsText, setExcludedProductIdsText] = useState("");
  const [excludedCategoryIdsText, setExcludedCategoryIdsText] = useState("");
  const [originFilter, setOriginFilter] = useState("");

  // campaign generator
  const [genPrefix, setGenPrefix] = useState("EID");
  const [genCount, setGenCount] = useState("50");
  const [genKind, setGenKind] = useState("percent");
  const [genValue, setGenValue] = useState("10");
  const [genResult, setGenResult] = useState<string>("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [d, s, p, c] = await Promise.all([
        apiFetch<{ items: Discount[] }>(`/organizations/${orgId}/commerce/discounts${originFilter ? `?origin=${encodeURIComponent(originFilter)}` : ""}`),
        apiFetch<Store[]>(`/organizations/${orgId}/stores`).catch(() => [] as Store[]),
        apiFetch<{ items: ProductOpt[] }>(`/organizations/${orgId}/products?pageSize=100`).catch(() => ({ items: [] as ProductOpt[] })),
        apiFetch<CategoryOpt[]>(`/organizations/${orgId}/products/categories`).catch(() => [] as CategoryOpt[]),
      ]);
      setDiscounts(d.items ?? []);
      setStores(s ?? []);
      setProducts(p.items ?? []);
      setCategories(c ?? []);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.loadingFailed); }
    finally { setLoading(false); }
  }, [originFilter]);
  useEffect(() => { load(); }, [load]);

  function resetForm() {
    setEditingId(null); setCode(""); setKind("percent"); setValue("10"); setMinOrder("");
    setScopeType("all"); setScopeIds([]); setStartsAt(""); setEndsAt(""); setUsageLimit(""); setTargetStores([]);
    setFirstOrderOnly(false); setRepeatCustomerOnly(false); setAppOnly(false); setPerCustomerLimit(""); setMaxOrder("");
    setExcludedProductIdsText(""); setExcludedCategoryIdsText("");
  }

  function startEdit(d: Discount) {
    setEditingId(d.id); setCode(d.code); setKind(d.kind); setValue(String(d.value));
    setMinOrder(d.minOrderMinor ? String(Number(d.minOrderMinor) / 100) : "");
    setScopeType(d.scopeType); setScopeIds(Array.isArray(d.scopeIds) ? d.scopeIds : []);
    setStartsAt(d.startsAt ? d.startsAt.slice(0, 16) : ""); setEndsAt(d.endsAt ? d.endsAt.slice(0, 16) : "");
    setUsageLimit(d.usageLimit != null ? String(d.usageLimit) : ""); setTargetStores([]);
    setFirstOrderOnly(!!d.firstOrderOnly); setRepeatCustomerOnly(!!d.repeatCustomerOnly);
    setAppOnly(!!d.appOnly);
    setPerCustomerLimit(d.perCustomerLimit != null ? String(d.perCustomerLimit) : "");
    setMaxOrder(d.maxOrderMinor ? String(Number(d.maxOrderMinor) / 100) : "");
    setExcludedProductIdsText((d.excludedProductIds ?? []).join(", "));
    setExcludedCategoryIdsText((d.excludedCategoryIds ?? []).join(", "));
  }

  async function save() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("save"); setError(""); setNotice("");
    const body: Record<string, unknown> = {
      code: code.trim(), kind,
      value: kind === "free_shipping" ? 0 : Math.max(0, parseInt(value || "0", 10) || 0),
      minOrderMinor: minOrder ? String(Math.round(parseFloat(minOrder) * 100)) : null,
      scopeType, scopeIds: scopeType === "all" ? [] : scopeIds,
      startsAt: startsAt ? new Date(startsAt).toISOString() : null,
      endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      usageLimit: usageLimit ? parseInt(usageLimit, 10) : null,
      firstOrderOnly,
      repeatCustomerOnly,
      appOnly,
      perCustomerLimit: perCustomerLimit ? parseInt(perCustomerLimit, 10) : null,
      maxOrderMinor: maxOrder ? String(Math.round(parseFloat(maxOrder) * 100)) : null,
      excludedProductIds: splitIds(excludedProductIdsText),
      excludedCategoryIds: splitIds(excludedCategoryIdsText),
      storeIds: targetStores,
    };
    try {
      const out = editingId
        ? await apiFetch<{ pushes?: { storeId: string; enqueued: boolean; reason?: string }[] }>(`/organizations/${orgId}/commerce/discounts/${editingId}`, { method: "PATCH", body: JSON.stringify(body) })
        : await apiFetch<{ pushes?: { storeId: string; enqueued: boolean; reason?: string }[] }>(`/organizations/${orgId}/commerce/discounts`, { method: "POST", body: JSON.stringify(body) });
      const skipped = (out.pushes ?? []).filter((p) => !p.enqueued);
      setNotice(skipped.length
        ? t("commerce.savedButItWasNot", { length: skipped.length, skipped: skipped.map((p) => p.reason ?? "").join(", ") })
        : dict.commerce.discountSaved);
      resetForm();
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.saveFailed3); }
    finally { setBusy(""); }
  }

  async function toggleActive(d: Discount) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`active-${d.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/discounts/${d.id}/active`, {
        method: "POST", body: JSON.stringify({ active: !d.active }),
      });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.failed); }
    finally { setBusy(""); }
  }

  async function pull(storeId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`pull-${storeId}`); setError(""); setNotice("");
    try {
      const out = await apiFetch<{ fetched: number; created: number; updated: number; skipped: number }>(
        `/organizations/${orgId}/commerce/discounts/pull/${storeId}`, { method: "POST" });
      setNotice(t("commerce.couponsPulledFromTheStore", { fetched: out.fetched, created: out.created, updated: out.updated, skipped: out.skipped }));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.pullFailed); }
    finally { setBusy(""); }
  }

  async function generate() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("gen"); setError(""); setGenResult("");
    try {
      const out = await apiFetch<{ created: number; codes: string[] }>(`/organizations/${orgId}/commerce/discounts/generate-campaign`, {
        method: "POST",
        body: JSON.stringify({
          prefix: genPrefix.trim(), count: parseInt(genCount || "0", 10),
          kind: genKind, value: genKind === "free_shipping" ? 0 : parseInt(genValue || "0", 10) || 0,
        }),
      });
      setGenResult(t("commerce.codesCreated", { created: out.created, out: out.codes.slice(0, 12).join(", "), out2: out.codes.length > 12 ? " …" : "" }));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.creationFailed); }
    finally { setBusy(""); }
  }

  const scopeOptions = scopeType === "products" ? products : scopeType === "categories" ? categories : [];

  // ED15/ED16 (EB6): origin cell + row actions shared verbatim by
  // the desktop table and the ResponsiveTable mobile card.
  const renderDiscountSource = (d: Discount) => (
    <>
      <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${d.origin === "abandoned_recovery" ? "bg-amber-100 text-amber-800" : d.origin === "manual" ? "bg-slate-100 text-slate-600" : "bg-indigo-100 text-indigo-700"}`}>
        {ORIGIN_LABEL[d.origin] ? dict.commerce[ORIGIN_LABEL[d.origin] as keyof typeof dict.commerce] : d.origin}
      </span>
      {d.sourceRef ? <div className="mt-1 font-mono text-[10px] text-slate-400">{d.sourceRef}</div> : null}
      {d.appOnly ? <div className="mt-1 text-[11px] font-semibold text-indigo-600">{dict.commerce.shownInTheAppOnly}</div> : null}
      {d.firstOrderOnly ? <div className="mt-1 text-[11px] text-slate-500">{dict.commerce.firstOrderOnly}</div> : null}
      {d.repeatCustomerOnly ? <div className="mt-1 text-[11px] text-slate-500">{dict.commerce.oldCustomersOnly}</div> : null}
      {d.perCustomerLimit != null ? <div className="mt-1 text-[11px] text-slate-500">{dict.commerce.maximumPerCustomer}{d.perCustomerLimit}{dict.commerce.times}</div> : null}
      {d.maxOrderMinor ? <div className="mt-1 text-[11px] text-slate-500">{dict.commerce.maximumOrders}{money(d.maxOrderMinor)}</div> : null}
    </>
  );
  const renderDiscountActions = (d: Discount) => (
    <div className="flex gap-2">
      <button className="inline-flex min-h-[44px] items-center rounded-lg border px-2 py-1 text-xs font-semibold" onClick={() => startEdit(d)}>{dict.commerce.edit}</button>
      <button className="inline-flex min-h-[44px] items-center rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => toggleActive(d)}>{d.active ? dict.commerce.close : dict.commerce.enable}</button>
    </div>
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">{dict.commerce.discountsStoreDiscountsCoupons}</h1>
          <p className="text-sm text-slate-500">
            {dict.commerce.createCouponsForYourOwn}</p>
        </div>
        <Link href="/dashboard/commerce/sync" className="btn-primary">Sync Center →</Link>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      <div className="card p-5 space-y-4">
        <div className="font-semibold">{editingId ? dict.commerce.editDiscount : dict.commerce.newDiscount}</div>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-sm">{dict.commerce.code}<input className="input mt-1" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="EID10" />
          </label>
          <label className="block text-sm">{dict.commerce.type}<select className="input mt-1" value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{dict.commerce[l as keyof typeof dict.commerce]}</option>)}
            </select>
          </label>
          <label className="block text-sm">{kind === "percent" ? dict.commerce.percentage190 : kind === "fixed" ? dict.commerce.amountInTakaNotPoisha : dict.commerce.valueNotNeededForFree}
            <input className="input mt-1" type="number" value={value} disabled={kind === "free_shipping"} onChange={(e) => setValue(e.target.value)} />
          </label>
          <label className="block text-sm">{dict.commerce.minimumOrderTakaEmptyNone}<input className="input mt-1" type="number" value={minOrder} onChange={(e) => setMinOrder(e.target.value)} />
          </label>
          <label className="block text-sm">{dict.commerce.effectiveFromEmptyNow}<input className="input mt-1" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </label>
          <label className="block text-sm">{dict.commerce.expiresEmptyUnlimited}<input className="input mt-1" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </label>
          <label className="block text-sm">{dict.commerce.usageLimitEmptyUnlimited}<input className="input mt-1" type="number" value={usageLimit} onChange={(e) => setUsageLimit(e.target.value)} />
          </label>
          <label className="block text-sm">{dict.commerce.willApplyTo}<select className="input mt-1" value={scopeType} onChange={(e) => { setScopeType(e.target.value); setScopeIds([]); }}>
              <option value="all">{dict.commerce.allProducts}</option>
              <option value="products">{dict.commerce.specificProducts2}</option>
              <option value="categories">{dict.commerce.specificCategories}</option>
            </select>
          </label>
          <label className="block text-sm">{dict.commerce.maximumOrderTakaEmptyNone}<input className="input mt-1" type="number" value={maxOrder} onChange={(e) => setMaxOrder(e.target.value)} />
          </label>
          <label className="block text-sm">{dict.commerce.perCustomerLimitEmptyUnlimited}<input className="input mt-1" type="number" min="1" value={perCustomerLimit} onChange={(e) => setPerCustomerLimit(e.target.value)} />
            <span className="mt-1 block text-xs font-normal text-slate-500">{dict.commerce.theLimitIsCountedFrom}</span>
          </label>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={firstOrderOnly} onChange={(e) => setFirstOrderOnly(e.target.checked)} />
            {dict.commerce.firstOrderOnlyFirstOrderOnly}</label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={repeatCustomerOnly} onChange={(e) => setRepeatCustomerOnly(e.target.checked)} />
            {dict.commerce.repeatCustomersOnlyRepeatCustomerOnly}</label>
        </div>
        {/* NF14 (FB5): app-only offer toggle + the honesty note,
            verbatim in meaning — display rule, NOT a code block. */}
        <div className="rounded-xl bg-indigo-50 p-4 text-sm dark:bg-slate-800">
          <label className="flex items-center gap-2 font-medium">
            <input type="checkbox" checked={appOnly} onChange={(e) => setAppOnly(e.target.checked)} />
            {dict.commerce.appOnlyOfferAppOnly}</label>
          <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            {dict.commerce.appOnlyOfferThisOffer}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm">{dict.commerce.excludedProductsIDs}<input className="input mt-1" value={excludedProductIdsText} onChange={(e) => setExcludedProductIdsText(e.target.value)} placeholder={dict.commerce.iDID} />
            <span className="mt-1 block text-xs font-normal text-slate-500">{dict.commerce.giveProductIDsSeparatedBy}</span>
          </label>
          <label className="block text-sm">{dict.commerce.excludedCategoriesIDs}<input className="input mt-1" value={excludedCategoryIdsText} onChange={(e) => setExcludedCategoryIdsText(e.target.value)} placeholder={dict.commerce.iDID} />
            <span className="mt-1 block text-xs font-normal text-slate-500">{dict.commerce.giveCategoryIDsSeparatedBy}</span>
          </label>
        </div>
        {scopeType !== "all" ? (
          <div>
            <div className="text-sm font-medium">{scopeType === "products" ? dict.commerce.selectAProduct : dict.commerce.selectACategory}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {scopeOptions.length === 0 ? <span className="text-xs text-slate-500">{dict.commerce.noOptions}</span> : scopeOptions.map((o) => {
                const on = scopeIds.includes(o.id);
                return (
                  <button key={o.id} type="button" onClick={() => setScopeIds(on ? scopeIds.filter((x) => x !== o.id) : [...scopeIds, o.id])}
                    className={`inline-flex min-h-[44px] items-center justify-center rounded-full px-3 py-1 text-xs font-semibold ${on ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                    {o.name}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        <div>
          <div className="text-sm font-medium">{dict.commerce.whichStoreItWillPush}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {stores.map((s) => {
              const on = targetStores.includes(s.id);
              const mode = s.syncMode ?? "mirror";
              return (
                <button key={s.id} type="button" onClick={() => setTargetStores(on ? targetStores.filter((x) => x !== s.id) : [...targetStores, s.id])}
                  className={`inline-flex min-h-[44px] items-center justify-center rounded-full px-3 py-1 text-xs font-semibold ${on ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                  {s.name} ({mode}){mode === "mirror" ? dict.commerce.willNotPush : ""}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" disabled={busy !== "" || !code.trim()} onClick={save}>{busy === "save" ? dict.commerce.saving2 : editingId ? dict.commerce.update : dict.commerce.create}</button>
          {editingId ? <button className="rounded-lg border px-3 py-2 text-sm" onClick={resetForm}>{dict.common.cancel}</button> : null}
        </div>
      </div>

      <div className="card p-5 space-y-3">
        <div className="font-semibold">{dict.commerce.campaignCodeGenerationManyAt}</div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-sm">Prefix
            <input className="input mt-1 w-28" value={genPrefix} onChange={(e) => setGenPrefix(e.target.value.toUpperCase())} />
          </label>
          <label className="block text-sm">{dict.commerce.countMaximum500}<input className="input mt-1 w-24" type="number" value={genCount} onChange={(e) => setGenCount(e.target.value)} />
          </label>
          <label className="block text-sm">{dict.commerce.type}<select className="input mt-1" value={genKind} onChange={(e) => setGenKind(e.target.value)}>
              {Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{dict.commerce[l as keyof typeof dict.commerce]}</option>)}
            </select>
          </label>
          <label className="block text-sm">{dict.commerce.value}<input className="input mt-1 w-24" type="number" value={genValue} disabled={genKind === "free_shipping"} onChange={(e) => setGenValue(e.target.value)} />
          </label>
          <button className="btn-primary" disabled={busy !== ""} onClick={generate}>{busy === "gen" ? dict.commerce.creating : dict.commerce.generateCodes}</button>
        </div>
        {genResult ? <p className="text-sm text-green-700">{genResult}</p> : null}
        <p className="text-xs text-slate-500">{dict.commerce.theseCodesCanBeUsed}</p>
      </div>

      <div className="card p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <div className="font-semibold">{dict.commerce.allDiscounts}{discounts.length})</div>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-500">{dict.commerce.source}<select className="input w-auto py-1 text-xs" value={originFilter} onChange={(e) => setOriginFilter(e.target.value)}>
                <option value="">{dict.commerce.allSources}</option>
                <option value="manual">{dict.commerce.manual}</option>
                <option value="woocommerce">WooCommerce</option>
                <option value="shopify">Shopify</option>
                <option value="abandoned_recovery">{dict.commerce.abandonedCartRecovery}</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            {stores.filter((s) => s.platform === "WOOCOMMERCE" || s.platform === "SHOPIFY").map((s) => (
              <button key={s.id} className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => pull(s.id)}>
                {busy === `pull-${s.id}` ? dict.commerce.pulling : t("commerce.pullCouponsFrom", { name: s.name })}
              </button>
            ))}
          </div>
        </div>
        {loading ? <p className="text-sm text-slate-400">{dict.common.loading}</p> : discounts.length === 0 ? (
          <p className="text-sm text-slate-500">{dict.commerce.noDiscountsYet}</p>
        ) : (
          <ResponsiveTable
            table={
              <div>
                <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 font-medium">{dict.commerce.code}</th><th className="py-2 font-medium">{dict.commerce.typeValue}</th>
                  <th className="py-2 font-medium">{dict.commerce.deadline}</th><th className="py-2 font-medium">{dict.commerce.uses}</th>
                  <th className="py-2 font-medium">{dict.commerce.source}</th><th className="py-2 font-medium">{dict.commerce.storeSync}</th><th className="py-2 font-medium">{dict.commerce.action}</th>
                </tr>
              </thead>
              <tbody>
                {discounts.map((d) => (
                  <tr key={d.id} className="border-b last:border-0 align-top">
                    <td className="py-2 font-mono font-semibold">{d.code}{!d.active ? <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600">{dict.commerce.closed}</span> : null}</td>
                    <td className="py-2">{KIND_LABEL[d.kind] ? dict.commerce[KIND_LABEL[d.kind] as keyof typeof dict.commerce] : d.kind}{d.kind === "percent" ? `: ${d.value}%` : d.kind === "fixed" ? `: ${money(String(d.value), locale)}` : ""}{d.minOrderMinor ? <div className="text-xs text-slate-500">{dict.commerce.atLeast}{money(d.minOrderMinor, locale)} {dict.commerce.inTheOrder}</div> : null}</td>
                    <td className="py-2 text-xs text-slate-500">{d.startsAt ? fmtDate(locale, new Date(d.startsAt)) : "—"} → {d.endsAt ? fmtDate(locale, new Date(d.endsAt)) : dict.commerce.unlimited}</td>
                    <td className="py-2">{d.usedCount}{d.usageLimit != null ? ` / ${d.usageLimit}` : ""}</td>
                    <td className="py-2 text-xs">
                      {renderDiscountSource(d)}
                    </td>
                    <td className="py-2"><div className="flex flex-wrap gap-1">{(d.syncs ?? []).length === 0 ? <span className="text-xs text-slate-500">{dict.commerce.notInAnyStore}</span> : (d.syncs ?? []).map(syncChip)}</div></td>
                    <td className="py-2">
                      {renderDiscountActions(d)}
                    </td>
                  </tr>
                ))}
                </tbody>
                </table>
              </div>
            }
            cards={discounts.map((d) => (
              <div key={d.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono font-semibold">{d.code}{!d.active ? <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600">{dict.commerce.closed}</span> : null}</span>
                  <span>{d.usedCount}{d.usageLimit != null ? ` / ${d.usageLimit}` : ""}</span>
                </div>
                <dl className="mt-2 space-y-1.5 text-sm">
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.typeValue}</dt>
                    <dd>{KIND_LABEL[d.kind] ? dict.commerce[KIND_LABEL[d.kind] as keyof typeof dict.commerce] : d.kind}{d.kind === "percent" ? `: ${d.value}%` : d.kind === "fixed" ? `: ${money(String(d.value), locale)}` : ""}{d.minOrderMinor ? <div className="text-xs text-slate-500">{dict.commerce.atLeast}{money(d.minOrderMinor, locale)} {dict.commerce.inTheOrder}</div> : null}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.deadline}</dt>
                    <dd className="text-xs text-slate-500">{d.startsAt ? fmtDate(locale, new Date(d.startsAt)) : "—"} → {d.endsAt ? fmtDate(locale, new Date(d.endsAt)) : dict.commerce.unlimited}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.source}</dt>
                    <dd className="text-xs">{renderDiscountSource(d)}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.storeSync}</dt>
                    <dd><div className="flex flex-wrap gap-1">{(d.syncs ?? []).length === 0 ? <span className="text-xs text-slate-500">{dict.commerce.notInAnyStore}</span> : (d.syncs ?? []).map(syncChip)}</div></dd>
                  </div>
                </dl>
                <div className="mt-2">{renderDiscountActions(d)}</div>
              </div>
            ))}
          />
        )}
      </div>
    </div>
  );
}
