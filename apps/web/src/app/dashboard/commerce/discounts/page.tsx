"use client";
import React, { useCallback, useEffect, useState } from "react";
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
  manual: "ম্যানুয়াল",
  woocommerce: "WooCommerce",
  shopify: "Shopify",
  abandoned_recovery: "পরিত্যক্ত কার্ট পুনরুদ্ধার",
};

const splitIds = (text: string): string[] =>
  text.split(",").map((x) => x.trim()).filter(Boolean);

const KIND_LABEL: Record<string, string> = {
  percent: "শতাংশ (%)",
  fixed: "নির্দিষ্ট টাকা",
  free_shipping: "ফ্রি ডেলিভারি",
};

const money = (minor?: string | null) =>
  minor == null ? "—" : `৳${(Number(minor) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

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
    } catch (e) { setError(e instanceof Error ? e.message : "লোড ব্যর্থ"); }
    finally { setLoading(false); }
  }, [originFilter]);
  useEffect(() => { load(); }, [load]);

  function resetForm() {
    setEditingId(null); setCode(""); setKind("percent"); setValue("10"); setMinOrder("");
    setScopeType("all"); setScopeIds([]); setStartsAt(""); setEndsAt(""); setUsageLimit(""); setTargetStores([]);
    setFirstOrderOnly(false); setRepeatCustomerOnly(false); setPerCustomerLimit(""); setMaxOrder("");
    setExcludedProductIdsText(""); setExcludedCategoryIdsText("");
  }

  function startEdit(d: Discount) {
    setEditingId(d.id); setCode(d.code); setKind(d.kind); setValue(String(d.value));
    setMinOrder(d.minOrderMinor ? String(Number(d.minOrderMinor) / 100) : "");
    setScopeType(d.scopeType); setScopeIds(Array.isArray(d.scopeIds) ? d.scopeIds : []);
    setStartsAt(d.startsAt ? d.startsAt.slice(0, 16) : ""); setEndsAt(d.endsAt ? d.endsAt.slice(0, 16) : "");
    setUsageLimit(d.usageLimit != null ? String(d.usageLimit) : ""); setTargetStores([]);
    setFirstOrderOnly(!!d.firstOrderOnly); setRepeatCustomerOnly(!!d.repeatCustomerOnly);
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
        ? `সেভ হয়েছে। তবে ${skipped.length}টি স্টোরে push হয়নি (${skipped.map((p) => p.reason ?? "").join(", ")}) — mirror মোডের স্টোরে push যায় না।`
        : "ডিসকাউন্ট সেভ হয়েছে।");
      resetForm();
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "সেভ ব্যর্থ"); }
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
    } catch (e) { setError(e instanceof Error ? e.message : "ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function pull(storeId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`pull-${storeId}`); setError(""); setNotice("");
    try {
      const out = await apiFetch<{ fetched: number; created: number; updated: number; skipped: number }>(
        `/organizations/${orgId}/commerce/discounts/pull/${storeId}`, { method: "POST" });
      setNotice(`স্টোর থেকে কুপন টানা হয়েছে: মোট ${out.fetched}, নতুন ${out.created}, আপডেট ${out.updated}, বাদ ${out.skipped} (Shopify-র automatic/BXGY ডিসকাউন্ট টানা হয় না — শুধু basic code)।`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "টানা ব্যর্থ"); }
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
      setGenResult(`${out.created}টি কোড তৈরি হয়েছে: ${out.codes.slice(0, 12).join(", ")}${out.codes.length > 12 ? " …" : ""}`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "তৈরি ব্যর্থ"); }
    finally { setBusy(""); }
  }

  const scopeOptions = scopeType === "products" ? products : scopeType === "categories" ? categories : [];

  // ED15/ED16 (EB6): origin cell + row actions shared verbatim by
  // the desktop table and the ResponsiveTable mobile card.
  const renderDiscountSource = (d: Discount) => (
    <>
      <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${d.origin === "abandoned_recovery" ? "bg-amber-100 text-amber-800" : d.origin === "manual" ? "bg-slate-100 text-slate-600" : "bg-indigo-100 text-indigo-700"}`}>
        {ORIGIN_LABEL[d.origin] ?? d.origin}
      </span>
      {d.sourceRef ? <div className="mt-1 font-mono text-[10px] text-slate-400">{d.sourceRef}</div> : null}
      {d.firstOrderOnly ? <div className="mt-1 text-[11px] text-slate-500">শুধু প্রথম অর্ডারে</div> : null}
      {d.repeatCustomerOnly ? <div className="mt-1 text-[11px] text-slate-500">শুধু পুরনো কাস্টমারের</div> : null}
      {d.perCustomerLimit != null ? <div className="mt-1 text-[11px] text-slate-500">প্রতি কাস্টমার সর্বোচ্চ {d.perCustomerLimit}বার</div> : null}
      {d.maxOrderMinor ? <div className="mt-1 text-[11px] text-slate-500">সর্বোচ্চ অর্ডার {money(d.maxOrderMinor)}</div> : null}
    </>
  );
  const renderDiscountActions = (d: Discount) => (
    <div className="flex gap-2">
      <button className="inline-flex min-h-[44px] items-center rounded-lg border px-2 py-1 text-xs font-semibold" onClick={() => startEdit(d)}>সম্পাদনা</button>
      <button className="inline-flex min-h-[44px] items-center rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => toggleActive(d)}>{d.active ? "বন্ধ করুন" : "চালু করুন"}</button>
    </div>
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Discounts — স্টোর ডিসকাউন্ট ও কুপন</h1>
          <p className="text-sm text-slate-500">
            আপনার নিজের স্টোরের কুপন এখান থেকে তৈরি করুন — WooCommerce/Shopify-তে push হবে (co-manage/full-manage স্টোরে),
            আর public checkout-এ কাস্টমার কোডটি ব্যবহার করতে পারবেন। এটি SaaS প্ল্যানের কুপন নয়।
          </p>
        </div>
        <Link href="/dashboard/commerce/sync" className="btn-primary">Sync Center →</Link>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      <div className="card p-5 space-y-4">
        <div className="font-semibold">{editingId ? "ডিসকাউন্ট সম্পাদনা" : "নতুন ডিসকাউন্ট"}</div>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-sm">কোড
            <input className="input mt-1" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="EID10" />
          </label>
          <label className="block text-sm">ধরন
            <select className="input mt-1" value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="block text-sm">{kind === "percent" ? "শতাংশ (১–৯০)" : kind === "fixed" ? "টাকার পরিমাণ (পয়সায় নয়, টাকায়)" : "মান (free shipping-এ লাগে না)"}
            <input className="input mt-1" type="number" value={value} disabled={kind === "free_shipping"} onChange={(e) => setValue(e.target.value)} />
          </label>
          <label className="block text-sm">সর্বনিম্ন অর্ডার (টাকা, খালি = নেই)
            <input className="input mt-1" type="number" value={minOrder} onChange={(e) => setMinOrder(e.target.value)} />
          </label>
          <label className="block text-sm">কার্যকর শুরু (খালি = এখনই)
            <input className="input mt-1" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </label>
          <label className="block text-sm">মেয়াদ শেষ (খালি = অসীম)
            <input className="input mt-1" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </label>
          <label className="block text-sm">ব্যবহারের সীমা (খালি = অসীম)
            <input className="input mt-1" type="number" value={usageLimit} onChange={(e) => setUsageLimit(e.target.value)} />
          </label>
          <label className="block text-sm">প্রযোজ্য হবে
            <select className="input mt-1" value={scopeType} onChange={(e) => { setScopeType(e.target.value); setScopeIds([]); }}>
              <option value="all">সব পণ্যে</option>
              <option value="products">নির্দিষ্ট পণ্যে</option>
              <option value="categories">নির্দিষ্ট ক্যাটাগরিতে</option>
            </select>
          </label>
          <label className="block text-sm">সর্বোচ্চ অর্ডার (টাকা, খালি = নেই)
            <input className="input mt-1" type="number" value={maxOrder} onChange={(e) => setMaxOrder(e.target.value)} />
          </label>
          <label className="block text-sm">প্রতি কাস্টমারের সীমা (খালি = অসীম)
            <input className="input mt-1" type="number" min="1" value={perCustomerLimit} onChange={(e) => setPerCustomerLimit(e.target.value)} />
            <span className="mt-1 block text-xs font-normal text-slate-500">সীমাটি অর্ডারে সংরক্ষিত কুপন-কোড স্ট্যাম্প থেকে গণনা করা হয়</span>
          </label>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={firstOrderOnly} onChange={(e) => setFirstOrderOnly(e.target.checked)} />
            শুধু প্রথম অর্ডারে (firstOrderOnly)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={repeatCustomerOnly} onChange={(e) => setRepeatCustomerOnly(e.target.checked)} />
            শুধু পুরনো কাস্টমারের জন্য (repeatCustomerOnly)
          </label>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm">বাদ যাবে এমন পণ্য (আইডি)
            <input className="input mt-1" value={excludedProductIdsText} onChange={(e) => setExcludedProductIdsText(e.target.value)} placeholder="আইডি, আইডি, …" />
            <span className="mt-1 block text-xs font-normal text-slate-500">কমা দিয়ে আলাদা করে পণ্যের আইডি দিন — কার্টে বাদ-তালিকার যেকোনো একটি পণ্য থাকলেই কুপনটি কাজ করবে না।</span>
          </label>
          <label className="block text-sm">বাদ যাবে এমন ক্যাটাগরি (আইডি)
            <input className="input mt-1" value={excludedCategoryIdsText} onChange={(e) => setExcludedCategoryIdsText(e.target.value)} placeholder="আইডি, আইডি, …" />
            <span className="mt-1 block text-xs font-normal text-slate-500">কমা দিয়ে আলাদা করে ক্যাটাগরির আইডি দিন — কার্টে বাদ-তালিকার যেকোনো একটি ক্যাটাগরির পণ্য থাকলেই কুপনটি কাজ করবে না।</span>
          </label>
        </div>
        {scopeType !== "all" ? (
          <div>
            <div className="text-sm font-medium">{scopeType === "products" ? "পণ্য বেছে নিন" : "ক্যাটাগরি বেছে নিন"}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {scopeOptions.length === 0 ? <span className="text-xs text-slate-500">কোনো অপশন নেই</span> : scopeOptions.map((o) => {
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
          <div className="text-sm font-medium">কোন স্টোরে push হবে</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {stores.map((s) => {
              const on = targetStores.includes(s.id);
              const mode = s.syncMode ?? "mirror";
              return (
                <button key={s.id} type="button" onClick={() => setTargetStores(on ? targetStores.filter((x) => x !== s.id) : [...targetStores, s.id])}
                  className={`inline-flex min-h-[44px] items-center justify-center rounded-full px-3 py-1 text-xs font-semibold ${on ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                  {s.name} ({mode}){mode === "mirror" ? " — push যাবে না" : ""}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" disabled={busy !== "" || !code.trim()} onClick={save}>{busy === "save" ? "সেভ হচ্ছে…" : editingId ? "আপডেট করুন" : "তৈরি করুন"}</button>
          {editingId ? <button className="rounded-lg border px-3 py-2 text-sm" onClick={resetForm}>বাতিল</button> : null}
        </div>
      </div>

      <div className="card p-5 space-y-3">
        <div className="font-semibold">ক্যাম্পেইন কোড তৈরি (একসাথে অনেকগুলো)</div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-sm">Prefix
            <input className="input mt-1 w-28" value={genPrefix} onChange={(e) => setGenPrefix(e.target.value.toUpperCase())} />
          </label>
          <label className="block text-sm">সংখ্যা (সর্বোচ্চ ৫০০)
            <input className="input mt-1 w-24" type="number" value={genCount} onChange={(e) => setGenCount(e.target.value)} />
          </label>
          <label className="block text-sm">ধরন
            <select className="input mt-1" value={genKind} onChange={(e) => setGenKind(e.target.value)}>
              {Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="block text-sm">মান
            <input className="input mt-1 w-24" type="number" value={genValue} disabled={genKind === "free_shipping"} onChange={(e) => setGenValue(e.target.value)} />
          </label>
          <button className="btn-primary" disabled={busy !== ""} onClick={generate}>{busy === "gen" ? "তৈরি হচ্ছে…" : "কোড তৈরি করুন"}</button>
        </div>
        {genResult ? <p className="text-sm text-green-700">{genResult}</p> : null}
        <p className="text-xs text-slate-500">এই কোডগুলো broadcast/ইনবক্স ক্যাম্পেইনে হাতে ব্যবহার করা যাবে; broadcast ইঞ্জিন থেকে স্বয়ংক্রিয় পাঠানো এই ব্যাচের বাইরে।</p>
      </div>

      <div className="card p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <div className="font-semibold">সব ডিসকাউন্ট ({discounts.length})</div>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-500">উৎস
              <select className="input w-auto py-1 text-xs" value={originFilter} onChange={(e) => setOriginFilter(e.target.value)}>
                <option value="">সব উৎস</option>
                <option value="manual">ম্যানুয়াল</option>
                <option value="woocommerce">WooCommerce</option>
                <option value="shopify">Shopify</option>
                <option value="abandoned_recovery">পরিত্যক্ত কার্ট পুনরুদ্ধার</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            {stores.filter((s) => s.platform === "WOOCOMMERCE" || s.platform === "SHOPIFY").map((s) => (
              <button key={s.id} className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => pull(s.id)}>
                {busy === `pull-${s.id}` ? "টানা হচ্ছে…" : `⬇ ${s.name} থেকে কুপন টানুন`}
              </button>
            ))}
          </div>
        </div>
        {loading ? <p className="text-sm text-slate-400">লোড হচ্ছে…</p> : discounts.length === 0 ? (
          <p className="text-sm text-slate-500">এখনো কোনো ডিসকাউন্ট নেই।</p>
        ) : (
          <ResponsiveTable
            table={
              <div>
                <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 font-medium">কোড</th><th className="py-2 font-medium">ধরন / মান</th>
                  <th className="py-2 font-medium">সময়সীমা</th><th className="py-2 font-medium">ব্যবহার</th>
                  <th className="py-2 font-medium">উৎস</th><th className="py-2 font-medium">স্টোর Sync</th><th className="py-2 font-medium">অ্যাকশন</th>
                </tr>
              </thead>
              <tbody>
                {discounts.map((d) => (
                  <tr key={d.id} className="border-b last:border-0 align-top">
                    <td className="py-2 font-mono font-semibold">{d.code}{!d.active ? <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600">বন্ধ</span> : null}</td>
                    <td className="py-2">{KIND_LABEL[d.kind] ?? d.kind}{d.kind === "percent" ? `: ${d.value}%` : d.kind === "fixed" ? `: ${money(String(d.value))}` : ""}{d.minOrderMinor ? <div className="text-xs text-slate-500">কমপক্ষে {money(d.minOrderMinor)} অর্ডারে</div> : null}</td>
                    <td className="py-2 text-xs text-slate-500">{d.startsAt ? new Date(d.startsAt).toLocaleDateString("bn-BD") : "—"} → {d.endsAt ? new Date(d.endsAt).toLocaleDateString("bn-BD") : "অসীম"}</td>
                    <td className="py-2">{d.usedCount}{d.usageLimit != null ? ` / ${d.usageLimit}` : ""}</td>
                    <td className="py-2 text-xs">
                      {renderDiscountSource(d)}
                    </td>
                    <td className="py-2"><div className="flex flex-wrap gap-1">{(d.syncs ?? []).length === 0 ? <span className="text-xs text-slate-500">কোনো স্টোরে নেই</span> : (d.syncs ?? []).map(syncChip)}</div></td>
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
                  <span className="font-mono font-semibold">{d.code}{!d.active ? <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600">বন্ধ</span> : null}</span>
                  <span>{d.usedCount}{d.usageLimit != null ? ` / ${d.usageLimit}` : ""}</span>
                </div>
                <dl className="mt-2 space-y-1.5 text-sm">
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 text-xs font-semibold text-slate-500">ধরন / মান</dt>
                    <dd>{KIND_LABEL[d.kind] ?? d.kind}{d.kind === "percent" ? `: ${d.value}%` : d.kind === "fixed" ? `: ${money(String(d.value))}` : ""}{d.minOrderMinor ? <div className="text-xs text-slate-500">কমপক্ষে {money(d.minOrderMinor)} অর্ডারে</div> : null}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 text-xs font-semibold text-slate-500">সময়সীমা</dt>
                    <dd className="text-xs text-slate-500">{d.startsAt ? new Date(d.startsAt).toLocaleDateString("bn-BD") : "—"} → {d.endsAt ? new Date(d.endsAt).toLocaleDateString("bn-BD") : "অসীম"}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 text-xs font-semibold text-slate-500">উৎস</dt>
                    <dd className="text-xs">{renderDiscountSource(d)}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 text-xs font-semibold text-slate-500">স্টোর Sync</dt>
                    <dd><div className="flex flex-wrap gap-1">{(d.syncs ?? []).length === 0 ? <span className="text-xs text-slate-500">কোনো স্টোরে নেই</span> : (d.syncs ?? []).map(syncChip)}</div></dd>
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
