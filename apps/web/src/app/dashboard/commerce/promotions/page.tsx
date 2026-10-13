"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";

// EC16 — promotions engine UI: BOGO / tiered / flash-sale rules plus
// referrals (referral settings live on the storefront page). The
// cart simulator renders ONLY the server's preview response — no
// client-side price math anywhere on this page.

interface Promotion {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  startsAt?: string | null;
  endsAt?: string | null;
  active: boolean;
  priority: number;
  createdAt: string;
}
interface ProductOpt { id: string; name: string }
interface CategoryOpt { id: string; name: string }
interface TierRow { thresholdKind: "amount" | "qty"; threshold: string; percentOff: string }
interface PreviewResult {
  items: unknown[];
  subtotalMinor: string;
  promotionDiscountMinor: string;
  promotionsApplied: { promotionId: string; name: string; type: string; amountMinor: string }[];
  coupon: { code: string; discountMinor: string; freeShipping: boolean } | null;
  referral: { code: string; discountMinor: string } | null;
  referralDiscountMinor: string;
  totalDiscountMinor: string;
  merchandiseTotalMinor: string;
  currency: string;
  // EC29: free-gift outcome of the preview (null when no gift applies).
  gift?: { promotionName: string; productName: string; quantity: number } | null;
}

const TYPE_LABEL: Record<string, string> = {
  bogo: "BOGO (কিনলে ফ্রি/ছাড়)",
  tiered: "Tiered (পরিমাণ/মূল্যভিত্তিক)",
  flash: "Flash Sale (সময়সীমাবদ্ধ)",
  gift: "উপহার (Gift)",
};

const money = (minor?: string | null) =>
  minor == null ? "—" : `৳${(Number(minor) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const toMinorString = (taka: string): string => String(Math.round(parseFloat(taka || "0") * 100));
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function ChipPicker({ options, selected, onToggle }: {
  options: { id: string; name: string }[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  if (options.length === 0) return <span className="text-xs text-slate-400">কোনো অপশন নেই</span>;
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.includes(o.id);
        return (
          <button key={o.id} type="button" onClick={() => onToggle(o.id)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${on ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"}`}>
            {o.name}
          </button>
        );
      })}
    </div>
  );
}

export default function PromotionsPage() {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [categories, setCategories] = useState<CategoryOpt[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);

  // create/edit form (common)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState("bogo");
  const [priority, setPriority] = useState("0");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [active, setActive] = useState(true);

  // BOGO config
  const [buyScope, setBuyScope] = useState<"product" | "category">("product");
  const [buyId, setBuyId] = useState("");
  const [buyQty, setBuyQty] = useState("1");
  const [getScope, setGetScope] = useState<"product" | "category">("product");
  const [getId, setGetId] = useState("");
  const [getQty, setGetQty] = useState("1");
  const [getDiscountPercent, setGetDiscountPercent] = useState("100");

  // Tiered config
  const [tierScope, setTierScope] = useState<"subtotal" | "category">("subtotal");
  const [tierCategoryId, setTierCategoryId] = useState("");
  const [tiers, setTiers] = useState<TierRow[]>([{ thresholdKind: "amount", threshold: "1000", percentOff: "10" }]);

  // Flash config
  const [flashPercentOff, setFlashPercentOff] = useState("20");
  const [flashProductIds, setFlashProductIds] = useState<string[]>([]);
  const [flashCategoryIds, setFlashCategoryIds] = useState<string[]>([]);

  // EC29: Gift config — free product over a minimum subtotal.
  const [giftMinSubtotal, setGiftMinSubtotal] = useState("1000");
  const [giftProductId, setGiftProductId] = useState("");
  const [giftVariantSku, setGiftVariantSku] = useState("");
  const [giftQty, setGiftQty] = useState("1");

  // Cart simulator
  const [simRows, setSimRows] = useState<{ productId: string; qty: string }[]>([{ productId: "", qty: "1" }]);
  const [simCoupon, setSimCoupon] = useState("");
  const [simReferral, setSimReferral] = useState("");
  const [simPhone, setSimPhone] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewError, setPreviewError] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [list, p, c] = await Promise.all([
        apiFetch<{ items: Promotion[] }>(`/organizations/${orgId}/commerce/promotions`),
        apiFetch<{ items: ProductOpt[] }>(`/organizations/${orgId}/products?pageSize=100`).catch(() => ({ items: [] as ProductOpt[] })),
        apiFetch<CategoryOpt[]>(`/organizations/${orgId}/products/categories`).catch(() => [] as CategoryOpt[]),
      ]);
      setPromotions(list.items ?? []);
      setProducts(p.items ?? []);
      setCategories(c ?? []);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "লোড ব্যর্থ"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function resetForm() {
    setEditingId(null); setName(""); setType("bogo"); setPriority("0");
    setStartsAt(""); setEndsAt(""); setActive(true);
    setBuyScope("product"); setBuyId(""); setBuyQty("1");
    setGetScope("product"); setGetId(""); setGetQty("1"); setGetDiscountPercent("100");
    setTierScope("subtotal"); setTierCategoryId("");
    setTiers([{ thresholdKind: "amount", threshold: "1000", percentOff: "10" }]);
    setFlashPercentOff("20"); setFlashProductIds([]); setFlashCategoryIds([]);
    setGiftMinSubtotal("1000"); setGiftProductId(""); setGiftVariantSku(""); setGiftQty("1");
  }

  function startEdit(p: Promotion) {
    resetForm();
    setEditingId(p.id); setName(p.name); setType(p.type);
    setPriority(String(p.priority)); setActive(p.active);
    setStartsAt(p.startsAt ? p.startsAt.slice(0, 16) : "");
    setEndsAt(p.endsAt ? p.endsAt.slice(0, 16) : "");
    const cfg = p.config ?? {};
    if (p.type === "bogo") {
      if (str(cfg.buyCategoryId)) { setBuyScope("category"); setBuyId(str(cfg.buyCategoryId)); }
      else if (str(cfg.buyProductId)) { setBuyScope("product"); setBuyId(str(cfg.buyProductId)); }
      if (str(cfg.getCategoryId)) { setGetScope("category"); setGetId(str(cfg.getCategoryId)); }
      else if (str(cfg.getProductId)) { setGetScope("product"); setGetId(str(cfg.getProductId)); }
      setBuyQty(String(num(cfg.buyQty, 1)));
      setGetQty(String(num(cfg.getQty, 1)));
      setGetDiscountPercent(String(num(cfg.getDiscountPercent, 100)));
    } else if (p.type === "tiered") {
      setTierScope(cfg.scope === "category" ? "category" : "subtotal");
      setTierCategoryId(str(cfg.categoryId));
      const rows = Array.isArray(cfg.tiers) ? cfg.tiers : [];
      if (rows.length > 0) {
        setTiers(rows.map((t) => {
          const row = (t ?? {}) as Record<string, unknown>;
          if (typeof row.minAmountMinor === "string") {
            return { thresholdKind: "amount" as const, threshold: String(Number(row.minAmountMinor) / 100), percentOff: String(num(row.percentOff, 0)) };
          }
          return { thresholdKind: "qty" as const, threshold: String(num(row.minQty, 0)), percentOff: String(num(row.percentOff, 0)) };
        }));
      }
    } else if (p.type === "flash") {
      setFlashPercentOff(String(num(cfg.percentOff, 0)));
      setFlashProductIds(strArr(cfg.productIds));
      setFlashCategoryIds(strArr(cfg.categoryIds));
    } else if (p.type === "gift") {
      setGiftMinSubtotal(typeof cfg.minSubtotalMinor === "string" ? String(Number(cfg.minSubtotalMinor) / 100) : "1000");
      setGiftProductId(str(cfg.giftProductId));
      setGiftVariantSku(str(cfg.giftVariantSku));
      setGiftQty(String(num(cfg.giftQty, 1)));
    }
  }

  function buildConfig(): Record<string, unknown> {
    if (type === "bogo") {
      return {
        ...(buyScope === "product" ? { buyProductId: buyId || undefined } : { buyCategoryId: buyId || undefined }),
        buyQty: Math.max(1, parseInt(buyQty || "1", 10) || 1),
        ...(getScope === "product" ? { getProductId: getId || undefined } : { getCategoryId: getId || undefined }),
        getQty: Math.max(1, parseInt(getQty || "1", 10) || 1),
        getDiscountPercent: Math.min(100, Math.max(0, parseInt(getDiscountPercent || "0", 10) || 0)),
      };
    }
    if (type === "tiered") {
      return {
        scope: tierScope,
        ...(tierScope === "category" ? { categoryId: tierCategoryId || undefined } : {}),
        tiers: tiers.map((t) => ({
          ...(t.thresholdKind === "amount"
            ? { minAmountMinor: toMinorString(t.threshold) }
            : { minQty: Math.max(0, parseInt(t.threshold || "0", 10) || 0) }),
          percentOff: Math.min(100, Math.max(0, parseInt(t.percentOff || "0", 10) || 0)),
        })),
      };
    }
    if (type === "gift") {
      return {
        minSubtotalMinor: toMinorString(giftMinSubtotal),
        giftProductId: giftProductId || undefined,
        ...(giftVariantSku.trim() ? { giftVariantSku: giftVariantSku.trim() } : {}),
        giftQty: Math.min(3, Math.max(1, parseInt(giftQty || "1", 10) || 1)),
      };
    }
    return {
      percentOff: Math.min(100, Math.max(0, parseInt(flashPercentOff || "0", 10) || 0)),
      ...(flashProductIds.length ? { productIds: flashProductIds } : {}),
      ...(flashCategoryIds.length ? { categoryIds: flashCategoryIds } : {}),
    };
  }

  async function save() {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (type === "flash" && (!startsAt || !endsAt)) {
      setError("Flash Sale-এর জন্য শুরু ও শেষের সময়সীমা আবশ্যক।");
      return;
    }
    if (type === "gift" && !giftProductId) {
      setError("উপহার প্রমোশনের জন্য উপহার পণ্য বেছে নিন।");
      return;
    }
    setBusy("save"); setError(""); setNotice("");
    const body = {
      name: name.trim(),
      type,
      config: buildConfig(),
      startsAt: startsAt ? new Date(startsAt).toISOString() : null,
      endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      active,
      priority: parseInt(priority || "0", 10) || 0,
    };
    try {
      if (editingId) {
        await apiFetch<{ promotion: Promotion }>(`/organizations/${orgId}/commerce/promotions/${editingId}`, { method: "PATCH", body: JSON.stringify(body) });
        setNotice("প্রমোশন আপডেট হয়েছে।");
      } else {
        await apiFetch<{ promotion: Promotion }>(`/organizations/${orgId}/commerce/promotions`, { method: "POST", body: JSON.stringify(body) });
        setNotice("প্রমোশন তৈরি হয়েছে।");
      }
      resetForm();
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "সেভ ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function toggleActive(p: Promotion) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`active-${p.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/promotions/${p.id}/active`, {
        method: "POST", body: JSON.stringify({ active: !p.active }),
      });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function remove(p: Promotion) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm(`"${p.name}" প্রমোশনটি মুছে ফেলবেন?`)) return;
    setBusy(`del-${p.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/promotions/${p.id}`, { method: "DELETE" });
      if (editingId === p.id) resetForm();
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "মুছে ফেলা ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function runPreview() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const items = simRows
      .filter((r) => r.productId)
      .map((r) => ({ productId: r.productId, quantity: Math.max(1, parseInt(r.qty || "1", 10) || 1) }));
    if (items.length === 0) { setPreviewError("সিমুলেটরে অন্তত একটি পণ্য বেছে নিন।"); setPreview(null); return; }
    setBusy("preview"); setPreviewError(""); setPreview(null);
    try {
      const out = await apiFetch<PreviewResult>(`/organizations/${orgId}/commerce/promotions/preview`, {
        method: "POST",
        body: JSON.stringify({
          items,
          couponCode: simCoupon.trim() || undefined,
          referralCode: simReferral.trim() || undefined,
          buyerPhone: simPhone.trim() || undefined,
        }),
      });
      setPreview(out);
    } catch (e) { setPreviewError(e instanceof Error ? e.message : "হিসাব ব্যর্থ"); }
    finally { setBusy(""); }
  }

  const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Promotions — প্রমোশন</h1>
          <p className="text-sm text-slate-500">
            BOGO, Tiered ও Flash Sale অফার — চেকআউটে সার্ভার নিজে হিসাব করে প্রয়োগ করে।
            রেফারেল ছাড়ের হার Storefront সেটিংসে (&ldquo;রেফারেল ছাড়&rdquo; অংশে)।
          </p>
        </div>
        <Link href="/dashboard/commerce" className="btn-primary">← Commerce Hub</Link>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      <div className="card p-5 space-y-4">
        <div className="font-semibold">{editingId ? "প্রমোশন সম্পাদনা" : "নতুন প্রমোশন"}</div>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-sm">নাম
            <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="যেমন: ২টি কিনলে ১টি ফ্রি" />
          </label>
          <label className="block text-sm">ধরন
            <select className="input mt-1" value={type} disabled={!!editingId} onChange={(e) => setType(e.target.value)}>
              {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="block text-sm">অগ্রাধিকার (priority — বড় = আগে)
            <input className="input mt-1" type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
          </label>
          <label className="block text-sm">শুরু {type === "flash" ? "(আবশ্যক)" : "(খালি = এখনই)"}
            <input className="input mt-1" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </label>
          <label className="block text-sm">শেষ {type === "flash" ? "(আবশ্যক)" : "(খালি = অসীম)"}
            <input className="input mt-1" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </label>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> সক্রিয়
          </label>
        </div>

        {type === "bogo" ? (
          <div className="space-y-3 border-t pt-4">
            <div className="font-semibold">BOGO সেটিং</div>
            <div className="grid gap-3 md:grid-cols-4">
              <label className="block text-sm">কিনবেন — ভিত্তি
                <select className="input mt-1" value={buyScope} onChange={(e) => { setBuyScope(e.target.value as "product" | "category"); setBuyId(""); }}>
                  <option value="product">পণ্য</option>
                  <option value="category">ক্যাটাগরি</option>
                </select>
              </label>
              <label className="block text-sm">{buyScope === "product" ? "পণ্য বেছে নিন" : "ক্যাটাগরি বেছে নিন"}
                <select className="input mt-1" value={buyId} onChange={(e) => setBuyId(e.target.value)}>
                  <option value="">— বেছে নিন —</option>
                  {(buyScope === "product" ? products : categories).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
              <label className="block text-sm">কয়টি কিনলে
                <input className="input mt-1" type="number" min="1" value={buyQty} onChange={(e) => setBuyQty(e.target.value)} />
              </label>
              <label className="block text-sm">পাবেন — ছাড়ের হার (%)
                <input className="input mt-1" type="number" min="0" max="100" value={getDiscountPercent} onChange={(e) => setGetDiscountPercent(e.target.value)} />
              </label>
              <label className="block text-sm">পাবেন — ভিত্তি
                <select className="input mt-1" value={getScope} onChange={(e) => { setGetScope(e.target.value as "product" | "category"); setGetId(""); }}>
                  <option value="product">পণ্য</option>
                  <option value="category">ক্যাটাগরি</option>
                </select>
              </label>
              <label className="block text-sm">{getScope === "product" ? "পণ্য বেছে নিন" : "ক্যাটাগরি বেছে নিন"}
                <select className="input mt-1" value={getId} onChange={(e) => setGetId(e.target.value)}>
                  <option value="">— বেছে নিন —</option>
                  {(getScope === "product" ? products : categories).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
              <label className="block text-sm">কয়টি পাবেন
                <input className="input mt-1" type="number" min="1" value={getQty} onChange={(e) => setGetQty(e.target.value)} />
              </label>
            </div>
            <p className="text-xs text-slate-400">ছাড়ের হার ১০০% = সম্পূর্ণ ফ্রি।</p>
          </div>
        ) : null}

        {type === "tiered" ? (
          <div className="space-y-3 border-t pt-4">
            <div className="font-semibold">Tiered সেটিং</div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-sm">ভিত্তি (scope)
                <select className="input mt-1" value={tierScope} onChange={(e) => setTierScope(e.target.value as "subtotal" | "category")}>
                  <option value="subtotal">পুরো কার্টের সাবটোটাল</option>
                  <option value="category">নির্দিষ্ট ক্যাটাগরি</option>
                </select>
              </label>
              {tierScope === "category" ? (
                <label className="block text-sm">ক্যাটাগরি বেছে নিন
                  <select className="input mt-1" value={tierCategoryId} onChange={(e) => setTierCategoryId(e.target.value)}>
                    <option value="">— বেছে নিন —</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              ) : null}
            </div>
            <div className="space-y-2">
              {tiers.map((t, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2">
                  <label className="block text-sm">শর্তের ধরন
                    <select className="input mt-1" value={t.thresholdKind} onChange={(e) => {
                      const next = [...tiers]; next[i] = { ...t, thresholdKind: e.target.value as "amount" | "qty" }; setTiers(next);
                    }}>
                      <option value="amount">ন্যূনতম মূল্য (টাকা)</option>
                      <option value="qty">ন্যূনতম পরিমাণ (টি)</option>
                    </select>
                  </label>
                  <label className="block text-sm">{t.thresholdKind === "amount" ? "ন্যূনতম মূল্য (টাকা)" : "ন্যূনতম পরিমাণ"}
                    <input className="input mt-1 w-36" type="number" value={t.threshold} onChange={(e) => {
                      const next = [...tiers]; next[i] = { ...t, threshold: e.target.value }; setTiers(next);
                    }} />
                  </label>
                  <label className="block text-sm">ছাড় (%)
                    <input className="input mt-1 w-24" type="number" min="0" max="100" value={t.percentOff} onChange={(e) => {
                      const next = [...tiers]; next[i] = { ...t, percentOff: e.target.value }; setTiers(next);
                    }} />
                  </label>
                  <button type="button" className="rounded-lg border px-3 py-2 text-xs font-semibold text-rose-600 disabled:opacity-50"
                    disabled={tiers.length <= 1}
                    onClick={() => setTiers(tiers.filter((_, x) => x !== i))}>সারি মুছুন</button>
                </div>
              ))}
              <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold"
                onClick={() => setTiers([...tiers, { thresholdKind: "amount", threshold: "", percentOff: "" }])}>
                + আরও স্তর যোগ করুন
              </button>
            </div>
          </div>
        ) : null}

        {type === "flash" ? (
          <div className="space-y-3 border-t pt-4">
            <div className="font-semibold">Flash Sale সেটিং</div>
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">সময়সীমা আবশ্যক — উপরে শুরু ও শেষের সময় অবশ্যই দিন।</p>
            <label className="block max-w-xs text-sm">ছাড়ের হার (%)
              <input className="input mt-1" type="number" min="0" max="100" value={flashPercentOff} onChange={(e) => setFlashPercentOff(e.target.value)} />
            </label>
            <div>
              <div className="text-sm font-medium">প্রযোজ্য পণ্য (কিছু না বাছলে = সব পণ্য)</div>
              <div className="mt-2">
                <ChipPicker options={products} selected={flashProductIds} onToggle={(id) => setFlashProductIds(toggleIn(flashProductIds, id))} />
              </div>
            </div>
            <div>
              <div className="text-sm font-medium">প্রযোজ্য ক্যাটাগরি (ঐচ্ছিক)</div>
              <div className="mt-2">
                <ChipPicker options={categories} selected={flashCategoryIds} onToggle={(id) => setFlashCategoryIds(toggleIn(flashCategoryIds, id))} />
              </div>
            </div>
          </div>
        ) : null}

        {type === "gift" ? (
          <div className="space-y-3 border-t pt-4">
            <div className="font-semibold">উপহার (Gift) সেটিং</div>
            <p className="text-xs text-slate-500">
              কার্টের সাবটোটাল ন্যূনতম অঙ্কে পৌঁছালে উপহার পণ্যটি ফ্রি (৳০) যোগ হবে — স্টক না থাকলে
              অর্ডার আটকায় না, শুধু উপহারটি বাদ যায় (ক্রেতা সাফল্য পেজে জানতে পারে)।
            </p>
            <div className="grid gap-3 md:grid-cols-4">
              <label className="block text-sm">ন্যূনতম সাবটোটাল (টাকা)
                <input className="input mt-1" inputMode="decimal" value={giftMinSubtotal} onChange={(e) => setGiftMinSubtotal(e.target.value)} placeholder="যেমন: 1000" />
              </label>
              <label className="block text-sm">উপহার পণ্য
                <select className="input mt-1" value={giftProductId} onChange={(e) => setGiftProductId(e.target.value)}>
                  <option value="">— বেছে নিন —</option>
                  {products.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
              <label className="block text-sm">ভ্যারিয়েন্ট SKU (ঐচ্ছিক)
                <input className="input mt-1" value={giftVariantSku} onChange={(e) => setGiftVariantSku(e.target.value)} placeholder="যেমন: RED-L" />
              </label>
              <label className="block text-sm">উপহারের পরিমাণ (১–৩)
                <input className="input mt-1" type="number" min="1" max="3" value={giftQty} onChange={(e) => setGiftQty(e.target.value)} />
              </label>
            </div>
          </div>
        ) : null}

        <div className="flex gap-2">
          <button className="btn-primary" disabled={busy !== "" || !name.trim()} onClick={save}>
            {busy === "save" ? "সেভ হচ্ছে…" : editingId ? "আপডেট করুন" : "তৈরি করুন"}
          </button>
          {editingId ? <button className="rounded-lg border px-3 py-2 text-sm" onClick={resetForm}>বাতিল</button> : null}
        </div>
      </div>

      <div className="card p-5 space-y-3">
        <div className="font-semibold">সব প্রমোশন ({promotions.length})</div>
        {loading ? <p className="text-sm text-slate-400">লোড হচ্ছে…</p> : promotions.length === 0 ? (
          <p className="text-sm text-slate-500">এখনো কোনো প্রমোশন নেই।</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-400">
                  <th className="py-2 font-medium">নাম</th><th className="py-2 font-medium">ধরন</th>
                  <th className="py-2 font-medium">অগ্রাধিকার</th><th className="py-2 font-medium">সময়সীমা</th>
                  <th className="py-2 font-medium">অবস্থা</th><th className="py-2 font-medium">অ্যাকশন</th>
                </tr>
              </thead>
              <tbody>
                {promotions.map((p) => (
                  <tr key={p.id} className="border-b last:border-0 align-top">
                    <td className="py-2 font-semibold">{p.name}</td>
                    <td className="py-2"><span className="rounded bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">{TYPE_LABEL[p.type] ?? p.type}</span></td>
                    <td className="py-2">{p.priority}</td>
                    <td className="py-2 text-xs text-slate-500">{p.startsAt ? new Date(p.startsAt).toLocaleString("bn-BD") : "—"} → {p.endsAt ? new Date(p.endsAt).toLocaleString("bn-BD") : "অসীম"}</td>
                    <td className="py-2">{p.active ? <span className="rounded bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">সক্রিয়</span> : <span className="rounded bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600">বন্ধ</span>}</td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        <button className="rounded-lg border px-2 py-1 text-xs font-semibold" onClick={() => startEdit(p)}>সম্পাদনা</button>
                        <button className="rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => toggleActive(p)}>{p.active ? "বন্ধ করুন" : "চালু করুন"}</button>
                        <button className="rounded-lg border px-2 py-1 text-xs font-semibold text-rose-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => remove(p)}>মুছুন</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card p-5 space-y-4">
        <div>
          <div className="font-semibold">🧮 কার্ট সিমুলেটর</div>
          <p className="text-xs text-slate-500">পণ্য ও পরিমাণ বেছে হিসাব করুন — সব সংখ্যা সার্ভারের প্রিভিউ API থেকে আসে, এখানে কোনো হিসাব করা হয় না।</p>
        </div>
        <div className="space-y-2">
          {simRows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <label className="block flex-1 text-sm">পণ্য
                <select className="input mt-1" value={r.productId} onChange={(e) => {
                  const next = [...simRows]; next[i] = { ...r, productId: e.target.value }; setSimRows(next);
                }}>
                  <option value="">— বেছে নিন —</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className="block text-sm">পরিমাণ
                <input className="input mt-1 w-24" type="number" min="1" value={r.qty} onChange={(e) => {
                  const next = [...simRows]; next[i] = { ...r, qty: e.target.value }; setSimRows(next);
                }} />
              </label>
              <button type="button" className="rounded-lg border px-3 py-2 text-xs font-semibold text-rose-600 disabled:opacity-50"
                disabled={simRows.length <= 1}
                onClick={() => setSimRows(simRows.filter((_, x) => x !== i))}>সরান</button>
            </div>
          ))}
          <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold"
            onClick={() => setSimRows([...simRows, { productId: "", qty: "1" }])}>+ পণ্য যোগ করুন</button>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-sm">কুপন কোড (ঐচ্ছিক)
            <input className="input mt-1" value={simCoupon} onChange={(e) => setSimCoupon(e.target.value.toUpperCase())} placeholder="যেমন: EID10" />
          </label>
          <label className="block text-sm">রেফারেল কোড (ঐচ্ছিক)
            <input className="input mt-1" value={simReferral} onChange={(e) => setSimReferral(e.target.value)} placeholder="বন্ধুর কোড" />
          </label>
          <label className="block text-sm">ক্রেতার ফোন (রেফারেল যাচাইয়ে লাগতে পারে)
            <input className="input mt-1" value={simPhone} onChange={(e) => setSimPhone(e.target.value)} placeholder="01XXXXXXXXX" />
          </label>
        </div>
        <button className="btn-primary" disabled={busy !== ""} onClick={runPreview}>
          {busy === "preview" ? "হিসাব হচ্ছে…" : "হিসাব করুন"}
        </button>
        {previewError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{previewError}</p> : null}
        {preview ? (
          <div className="space-y-2 rounded-xl border bg-slate-50 p-4 text-sm">
            <div className="flex justify-between"><span className="text-slate-600">সাবটোটাল:</span><span className="font-semibold">{money(preview.subtotalMinor)}</span></div>
            {preview.promotionsApplied.map((a) => (
              <div key={a.promotionId} className="flex justify-between text-emerald-700">
                <span>🎁 {a.name} ({TYPE_LABEL[a.type] ?? a.type}):</span><span className="font-semibold">− {money(a.amountMinor)}</span>
              </div>
            ))}
            {preview.gift ? (
              <div className="flex justify-between text-pink-700">
                <span>🎁 উপহার — {preview.gift.productName} × {preview.gift.quantity} ({preview.gift.promotionName}):</span>
                <span className="font-semibold">{money("0")}</span>
              </div>
            ) : null}
            {Number(preview.promotionDiscountMinor) === 0 && preview.promotionsApplied.length === 0 ? (
              <div className="flex justify-between text-slate-500"><span>প্রমোশন ছাড়:</span><span>{money(preview.promotionDiscountMinor)}</span></div>
            ) : null}
            {preview.coupon ? (
              <div className="flex justify-between text-emerald-700">
                <span>🏷️ কুপন ({preview.coupon.code}):</span>
                <span className="font-semibold">− {money(preview.coupon.discountMinor)}{preview.coupon.freeShipping ? " + ফ্রি ডেলিভারি" : ""}</span>
              </div>
            ) : null}
            {preview.referral ? (
              <div className="flex justify-between text-emerald-700">
                <span>🤝 রেফারেল ({preview.referral.code}):</span><span className="font-semibold">− {money(preview.referral.discountMinor)}</span>
              </div>
            ) : Number(preview.referralDiscountMinor) > 0 ? (
              <div className="flex justify-between text-emerald-700"><span>🤝 রেফারেল ছাড়:</span><span className="font-semibold">− {money(preview.referralDiscountMinor)}</span></div>
            ) : null}
            <div className="flex justify-between border-t pt-2"><span className="font-semibold">মোট ছাড়:</span><span className="font-semibold text-emerald-700">− {money(preview.totalDiscountMinor)}</span></div>
            <div className="flex justify-between text-base font-black"><span>পণ্যের মোট (ছাড়ের পর):</span><span className="text-indigo-700">{money(preview.merchandiseTotalMinor)}</span></div>
            <p className="text-xs text-slate-400">ডেলিভারি চার্জ এই প্রিভিউতে নেই — চেকআউটে জোন অনুযায়ী যোগ হয়। মুদ্রা: {preview.currency}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
