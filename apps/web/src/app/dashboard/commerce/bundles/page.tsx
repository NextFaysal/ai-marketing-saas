"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinorTaka, minorToTakaString, takaToMinorString } from "@/lib/storefront-money";
import { useConfirm, useToast } from "@repo/ui/client";
import { ResponsiveTable } from "@repo/ui";

// EC29 — bundle management. A bundle sells 2–10 component
// products together at one bundle price. regularTotalMinor comes
// from the API list response — no client-side price math for
// totals that matter; the form's bundle price is typed in taka
// and converted with the shared string-arithmetic helper.

interface BundleComponent {
  productId: string;
  name?: string;
  variantSku?: string | null;
  qty: number;
  unitPriceMinor?: string;
}
interface Bundle {
  id: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  bundlePriceMinor: string;
  regularTotalMinor: string;
  savingsMinor?: string | null;
  sortOrder: number;
  active: boolean;
  // The staff serialize carries the fixed items as `items`
  // ({ productId, variantSku, qty }) — `components` is kept
  // only as a legacy fallback name.
  items?: { productId: string; variantSku?: string | null; qty: number }[];
  components: BundleComponent[];
  // AB5 (AX8): mix-and-match slots with their CURRENT pools.
  slots?: BundleSlot[];
  createdAt?: string;
}
interface BundleSlotOption { productId: string; name: string | null; imageUrl: string | null; regularUnitMinor: string }
interface BundleSlot {
  id: string | null; label: string; chooseQty: number;
  sourceType: "category" | "products";
  sourceRef: { categoryId?: string; productIds?: string[] } | null;
  options: BundleSlotOption[];
}
interface ProductOpt { id: string; name: string }
interface CategoryOpt { id: string; name: string }
interface ComponentRow { productId: string; variantSku: string; qty: string }
interface SlotRow { label: string; chooseQty: string; sourceType: "category" | "products"; categoryId: string; productIds: string[] }

export default function BundlesPage() {
  const confirm = useConfirm();
  const { toast } = useToast();
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [categories, setCategories] = useState<CategoryOpt[]>([]);
  // AB5 (AX8): slot rows of the form (the form manages the
  // bundle's FULL slot set — saving replaces them wholesale).
  const [slotRows, setSlotRows] = useState<SlotRow[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [bundlePrice, setBundlePrice] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [active, setActive] = useState(true);
  const [rows, setRows] = useState<ComponentRow[]>([
    { productId: "", variantSku: "", qty: "1" },
    { productId: "", variantSku: "", qty: "1" },
  ]);

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [list, p, cats] = await Promise.all([
        apiFetch<{ items: Bundle[] }>(`/organizations/${orgId}/commerce/bundles`),
        apiFetch<{ items: ProductOpt[] }>(`/organizations/${orgId}/products?pageSize=100`).catch(() => ({ items: [] as ProductOpt[] })),
        apiFetch<CategoryOpt[]>(`/organizations/${orgId}/products/categories`).catch(() => [] as CategoryOpt[]),
      ]);
      setBundles(list.items ?? []);
      setProducts(p.items ?? []);
      setCategories(Array.isArray(cats) ? cats : []);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "লোড ব্যর্থ"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function resetForm() {
    setEditingId(null); setName(""); setDescription(""); setImageUrl("");
    setBundlePrice(""); setSortOrder("0"); setActive(true);
    setRows([
      { productId: "", variantSku: "", qty: "1" },
      { productId: "", variantSku: "", qty: "1" },
    ]);
    setSlotRows([]);
  }

  function startEdit(b: Bundle) {
    resetForm();
    setEditingId(b.id);
    setName(b.name);
    setDescription(b.description ?? "");
    setImageUrl(b.imageUrl ?? "");
    setBundlePrice(minorToTakaString(b.bundlePriceMinor));
    setSortOrder(String(b.sortOrder ?? 0));
    setActive(b.active);
    const fixed = b.items?.length ? b.items : b.components;
    if (fixed?.length) {
      setRows(fixed.map((c) => ({
        productId: c.productId,
        variantSku: c.variantSku ?? "",
        qty: String(c.qty ?? 1),
      })));
    }
    // AB5 (AX8): initialize the slots editor from the serialized slots.
    setSlotRows((b.slots ?? []).map((s) => ({
      label: s.label,
      chooseQty: String(s.chooseQty ?? 1),
      sourceType: s.sourceType,
      categoryId: s.sourceRef?.categoryId ?? "",
      productIds: s.sourceRef?.productIds ?? [],
    })));
  }

  async function save() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const components = rows
      .filter((r) => r.productId)
      .map((r) => ({
        productId: r.productId,
        variantSku: r.variantSku.trim() || null,
        qty: Math.max(1, parseInt(r.qty || "1", 10) || 1),
      }));
    if (components.length < 2 || components.length > 10) {
      setError("বান্ডলে ২–১০টি কম্পোনেন্ট পণ্য থাকতে হবে।");
      return;
    }
    const bundlePriceMinor = takaToMinorString(bundlePrice);
    if (bundlePriceMinor === null) {
      setError("বান্ডলের দাম টাকায় সঠিক সংখ্যা দিন (যেমন: 999 অথবা 999.50)।");
      return;
    }
    // AB5 (AX8): slots — the form manages the full set, so the
    // array is ALWAYS sent (the API replaces wholesale when the
    // field is present; [] clears all slots).
    const slots: { label: string; chooseQty: number; sourceType: "category" | "products"; sourceRef: { categoryId: string } | { productIds: string[] } }[] = [];
    for (const s of slotRows) {
      const label = s.label.trim();
      if (!label) { setError("প্রতিটি স্লটের লেবেল দিন।"); return; }
      const chooseQty = parseInt(s.chooseQty || "0", 10);
      if (!Number.isInteger(chooseQty) || chooseQty < 1 || chooseQty > 20) {
        setError(`"${label}" স্লটে বেছে নেওয়ার সংখ্যা ১–২০ হতে হবে।`); return;
      }
      if (s.sourceType === "category") {
        if (!s.categoryId) { setError(`"${label}" স্লটের জন্য ক্যাটাগরি বেছে নিন।`); return; }
        slots.push({ label, chooseQty, sourceType: "category", sourceRef: { categoryId: s.categoryId } });
      } else {
        if (s.productIds.length === 0) { setError(`"${label}" স্লটে কমপক্ষে একটি পণ্য বেছে নিন।`); return; }
        slots.push({ label, chooseQty, sourceType: "products", sourceRef: { productIds: s.productIds } });
      }
    }
    setBusy("save"); setError("");
    const body = {
      name: name.trim(),
      description: description.trim() || null,
      imageUrl: imageUrl.trim() || null,
      bundlePriceMinor,
      sortOrder: parseInt(sortOrder || "0", 10) || 0,
      active,
      // The API's BundleDto field is `items` (fixed components).
      items: components,
      slots,
    };
    try {
      if (editingId) {
        await apiFetch(`/organizations/${orgId}/commerce/bundles/${editingId}`, { method: "PATCH", body: JSON.stringify(body) });
        toast({ title: "বান্ডল আপডেট হয়েছে।", tone: "success" });
      } else {
        await apiFetch(`/organizations/${orgId}/commerce/bundles`, { method: "POST", body: JSON.stringify(body) });
        toast({ title: "বান্ডল তৈরি হয়েছে।", tone: "success" });
      }
      resetForm();
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "সেভ ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function toggleActive(b: Bundle) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`active-${b.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/bundles/${b.id}/active`, {
        method: "POST", body: JSON.stringify({ active: !b.active }),
      });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function remove(b: Bundle) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!(await confirm({ title: `"${b.name}" বান্ডলটি মুছে ফেলবেন?`, danger: true, confirmLabel: "মুছে ফেলুন" }))) return;
    setBusy(`del-${b.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/bundles/${b.id}`, { method: "DELETE" });
      if (editingId === b.id) resetForm();
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "মুছে ফেলা ব্যর্থ"); }
    finally { setBusy(""); }
  }

  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? id;

  // ED15/ED16 (EB6): bundle cell contents, status and row actions are
  // shared verbatim by the desktop table and the ResponsiveTable
  // mobile card — same handlers, same order.
  const renderBundleContents = (b: Bundle) => (
    <>
      {(b.items ?? b.components ?? []).map((c, i) => (
        <div key={i}>{(c as BundleComponent).name ?? productName(c.productId)}{c.variantSku ? ` (${c.variantSku})` : ""} × {c.qty}</div>
      ))}
      {(b.slots ?? []).map((s) => (
        <div key={s.id ?? s.label} className="mt-0.5 rounded bg-indigo-50 px-1.5 py-0.5 font-semibold text-indigo-700">
          🎛️ {s.label}: {s.chooseQty}টি বেছে নেবেন · পুলে {(s.options ?? []).length}টি পণ্য
        </div>
      ))}
    </>
  );
  const renderBundleStatus = (b: Bundle) => (
    b.active ? <span className="rounded bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">সক্রিয়</span> : <span className="rounded bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600">বন্ধ</span>
  );
  const renderBundleActions = (b: Bundle) => (
    <div className="flex gap-2">
      <button className="inline-flex min-h-[44px] items-center rounded-lg border px-2 py-1 text-xs font-semibold" onClick={() => startEdit(b)}>সম্পাদনা</button>
      <button className="inline-flex min-h-[44px] items-center rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => toggleActive(b)}>{b.active ? "বন্ধ করুন" : "চালু করুন"}</button>
      <button className="inline-flex min-h-[44px] items-center rounded-lg border px-2 py-1 text-xs font-semibold text-rose-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => remove(b)}>মুছুন</button>
    </div>
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Bundles — বান্ডল অফার</h1>
          <p className="text-sm text-slate-500">
            ২–১০টি পণ্য একসাথে একটি বান্ডল দামে বিক্রি করুন — দোকানের হোম পেজে বান্ডল স্ট্রিপে দেখাবে,
            ক্রেতা এক ক্লিকে কার্টে যোগ করতে পারবে। নিচের &ldquo;আলাদা মোট&rdquo; সার্ভার থেকে আসে।
          </p>
        </div>
        <Link href="/dashboard/commerce" className="btn-primary">← Commerce Hub</Link>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      <div className="card p-5 space-y-4">
        <div className="font-semibold">{editingId ? "বান্ডল সম্পাদনা" : "নতুন বান্ডল"}</div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm">নাম
            <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="যেমন: ঈদ কম্বো প্যাক" />
          </label>
          <label className="block text-sm">ছবির URL (ঐচ্ছিক)
            <input className="input mt-1" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
          </label>
          <label className="block text-sm md:col-span-2">বর্ণনা (ঐচ্ছিক)
            <textarea className="input mt-1" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="বান্ডলে যা যা থাকছে…" />
          </label>
          <label className="block text-sm">বান্ডলের দাম (টাকা)
            <input className="input mt-1" inputMode="decimal" value={bundlePrice} onChange={(e) => setBundlePrice(e.target.value)} placeholder="যেমন: 999" />
          </label>
          <label className="block text-sm">ক্রম (sortOrder — ছোট = আগে)
            <input className="input mt-1" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </label>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> সক্রিয় (দোকানে দেখাবে)
          </label>
        </div>

        <div className="space-y-2 border-t pt-4">
          <div className="font-semibold">কম্পোনেন্ট পণ্য ({rows.filter((r) => r.productId).length}টি বাছাই — ২–১০টি হতে হবে)</div>
          {rows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <label className="block flex-1 text-sm">পণ্য
                <select className="input mt-1" value={r.productId} onChange={(e) => {
                  const next = [...rows]; next[i] = { ...r, productId: e.target.value }; setRows(next);
                }}>
                  <option value="">— বেছে নিন —</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className="block text-sm">ভ্যারিয়েন্ট SKU (ঐচ্ছিক)
                <input className="input mt-1 w-40" value={r.variantSku} onChange={(e) => {
                  const next = [...rows]; next[i] = { ...r, variantSku: e.target.value }; setRows(next);
                }} placeholder="যেমন: RED-L" />
              </label>
              <label className="block text-sm">পরিমাণ
                <input className="input mt-1 w-24" type="number" min="1" value={r.qty} onChange={(e) => {
                  const next = [...rows]; next[i] = { ...r, qty: e.target.value }; setRows(next);
                }} />
              </label>
              <button type="button" className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-2 text-xs font-semibold text-rose-600 disabled:opacity-50"
                disabled={rows.length <= 2}
                onClick={() => setRows(rows.filter((_, x) => x !== i))}>সারি মুছুন</button>
            </div>
          ))}
          <button type="button" className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            disabled={rows.length >= 10}
            onClick={() => setRows([...rows, { productId: "", variantSku: "", qty: "1" }])}>
            + আরও পণ্য যোগ করুন
          </button>
          <p className="text-xs text-slate-500">ভ্যারিয়েন্ট SKU দিলে বান্ডলটি ওই নির্দিষ্ট ভ্যারিয়েন্টই বিক্রি করবে; খালি রাখলে পণ্যের ডিফল্ট/মূল এন্ট্রি।</p>
        </div>

        {/* AB5 (AX8): mix-and-match slots — the buyer picks
            chooseQty products from each slot's pool; the bundle
            price does not change with the picks. */}
        <div className="space-y-3 border-t pt-4">
          <div className="font-semibold">🎛️ স্লট (Mix-and-Match) — ক্রেতা নিজে বেছে নেবেন ({slotRows.length}টি স্লট, সর্বোচ্চ ৬টি)</div>
          <p className="text-xs text-slate-500">স্লট থাকলে ক্রেতাকে প্রতিটি স্লট থেকে ঠিক নির্দিষ্ট সংখ্যক পণ্য বেছে নিতে হবে — বান্ডলের দাম পিক অনুযায়ী বদলায় না। স্লট না রাখলে বান্ডলটি আগের মতোই শুধু নির্দিষ্ট পণ্যে বিক্রি হবে।</p>
          {slotRows.map((s, i) => (
            <div key={i} className="space-y-2 rounded-xl bg-slate-50 p-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="block flex-1 text-sm">স্লটের লেবেল
                  <input className="input mt-1" value={s.label} placeholder="যেমন: একটি পানীয় বেছে নিন"
                    onChange={(e) => { const n = [...slotRows]; n[i] = { ...s, label: e.target.value }; setSlotRows(n); }} />
                </label>
                <label className="block text-sm">কয়টি বেছে নেবেন
                  <input className="input mt-1 w-28" type="number" min="1" max="20" value={s.chooseQty}
                    onChange={(e) => { const n = [...slotRows]; n[i] = { ...s, chooseQty: e.target.value }; setSlotRows(n); }} />
                </label>
                <label className="block text-sm">পণ্যের উৎস
                  <select className="input mt-1 w-44" value={s.sourceType}
                    onChange={(e) => { const n = [...slotRows]; n[i] = { ...s, sourceType: e.target.value as SlotRow["sourceType"] }; setSlotRows(n); }}>
                    <option value="category">ক্যাটাগরি</option>
                    <option value="products">নির্দিষ্ট পণ্য</option>
                  </select>
                </label>
                <button type="button" className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-2 text-xs font-semibold text-rose-600"
                  onClick={() => setSlotRows(slotRows.filter((_, x) => x !== i))}>স্লট মুছুন</button>
              </div>
              {s.sourceType === "category" ? (
                <label className="block text-sm">ক্যাটাগরি
                  <select className="input mt-1 w-72" value={s.categoryId}
                    onChange={(e) => { const n = [...slotRows]; n[i] = { ...s, categoryId: e.target.value }; setSlotRows(n); }}>
                    <option value="">— ক্যাটাগরি বেছে নিন —</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <span className="mt-1 block text-xs font-normal text-slate-500">ওই ক্যাটাগরির সব সক্রিয় পণ্যই ক্রেতার পছন্দের তালিকায় থাকবে।</span>
                </label>
              ) : (
                <div>
                  <div className="mb-1 text-sm">পণ্য বেছে নিন ({s.productIds.length}টি নির্বাচিত)</div>
                  <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
                    {products.map((p) => {
                      const on = s.productIds.includes(p.id);
                      return (
                        <button key={p.id} type="button"
                          className={`inline-flex min-h-[44px] items-center rounded-full px-2.5 py-1 text-xs font-semibold ${on ? "bg-indigo-600 text-white" : "border bg-white text-slate-600"}`}
                          onClick={() => {
                            const n = [...slotRows];
                            n[i] = { ...s, productIds: on ? s.productIds.filter((x) => x !== p.id) : [...s.productIds, p.id] };
                            setSlotRows(n);
                          }}>
                          {on ? "✓ " : ""}{p.name}
                        </button>
                      );
                    })}
                    {products.length === 0 ? <span className="text-xs text-slate-500">কোনো পণ্য লোড হয়নি</span> : null}
                  </div>
                </div>
              )}
            </div>
          ))}
          <button type="button" className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            disabled={slotRows.length >= 6}
            onClick={() => setSlotRows([...slotRows, { label: "", chooseQty: "1", sourceType: "category", categoryId: "", productIds: [] }])}>
            + স্লট যোগ করুন
          </button>
        </div>

        <div className="flex gap-2">
          <button className="btn-primary" disabled={busy !== "" || !name.trim() || !bundlePrice.trim()} onClick={save}>
            {busy === "save" ? "সেভ হচ্ছে…" : editingId ? "আপডেট করুন" : "তৈরি করুন"}
          </button>
          {editingId ? <button className="rounded-lg border px-3 py-2 text-sm" onClick={resetForm}>বাতিল</button> : null}
        </div>
      </div>

      <div className="card p-5 space-y-3">
        <div className="font-semibold">সব বান্ডল ({bundles.length})</div>
        {loading ? <p className="text-sm text-slate-400">লোড হচ্ছে…</p> : bundles.length === 0 ? (
          <p className="text-sm text-slate-500">এখনো কোনো বান্ডল নেই।</p>
        ) : (
          <ResponsiveTable
            table={
              <div>
                <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 font-medium">নাম</th><th className="py-2 font-medium">কম্পোনেন্ট</th>
                  <th className="py-2 font-medium">বান্ডল দাম</th><th className="py-2 font-medium">আলাদা মোট</th>
                  <th className="py-2 font-medium">সাশ্রয়</th><th className="py-2 font-medium">ক্রম</th>
                  <th className="py-2 font-medium">অবস্থা</th><th className="py-2 font-medium">অ্যাকশন</th>
                </tr>
              </thead>
              <tbody>
                {bundles.map((b) => (
                  <tr key={b.id} className="border-b last:border-0 align-top">
                    <td className="py-2 font-semibold">{b.name}</td>
                    <td className="py-2 text-xs text-slate-600">
                      {renderBundleContents(b)}
                    </td>
                    <td className="py-2 font-semibold">{formatMinorTaka(b.bundlePriceMinor)}</td>
                    <td className="py-2">{formatMinorTaka(b.regularTotalMinor)}</td>
                    <td className="py-2 text-emerald-700">{b.savingsMinor && Number(b.savingsMinor) > 0 ? formatMinorTaka(b.savingsMinor) : "—"}</td>
                    <td className="py-2">{b.sortOrder}</td>
                    <td className="py-2">{renderBundleStatus(b)}</td>
                    <td className="py-2">
                      {renderBundleActions(b)}
                    </td>
                  </tr>
                ))}
                </tbody>
                </table>
              </div>
            }
            cards={bundles.map((b) => (
              <div key={b.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold">{b.name}</span>
                  {renderBundleStatus(b)}
                </div>
                <dl className="mt-2 space-y-1.5 text-sm">
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-xs font-semibold text-slate-500">কম্পোনেন্ট</dt>
                    <dd className="text-xs text-slate-600">{renderBundleContents(b)}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-xs font-semibold text-slate-500">বান্ডল দাম</dt>
                    <dd className="font-semibold">{formatMinorTaka(b.bundlePriceMinor)}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-xs font-semibold text-slate-500">আলাদা মোট</dt>
                    <dd>{formatMinorTaka(b.regularTotalMinor)}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-xs font-semibold text-slate-500">সাশ্রয়</dt>
                    <dd className="text-emerald-700">{b.savingsMinor && Number(b.savingsMinor) > 0 ? formatMinorTaka(b.savingsMinor) : "—"}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-xs font-semibold text-slate-500">ক্রম</dt>
                    <dd>{b.sortOrder}</dd>
                  </div>
                </dl>
                <div className="mt-2">{renderBundleActions(b)}</div>
              </div>
            ))}
          />
        )}
      </div>
    </div>
  );
}
