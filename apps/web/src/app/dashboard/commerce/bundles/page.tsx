"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinorTaka, minorToTakaString, takaToMinorString } from "@/lib/storefront-money";

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
  components: BundleComponent[];
  createdAt?: string;
}
interface ProductOpt { id: string; name: string }
interface ComponentRow { productId: string; variantSku: string; qty: string }

export default function BundlesPage() {
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
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
      const [list, p] = await Promise.all([
        apiFetch<{ items: Bundle[] }>(`/organizations/${orgId}/commerce/bundles`),
        apiFetch<{ items: ProductOpt[] }>(`/organizations/${orgId}/products?pageSize=100`).catch(() => ({ items: [] as ProductOpt[] })),
      ]);
      setBundles(list.items ?? []);
      setProducts(p.items ?? []);
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
    if (b.components?.length) {
      setRows(b.components.map((c) => ({
        productId: c.productId,
        variantSku: c.variantSku ?? "",
        qty: String(c.qty ?? 1),
      })));
    }
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
    setBusy("save"); setError(""); setNotice("");
    const body = {
      name: name.trim(),
      description: description.trim() || null,
      imageUrl: imageUrl.trim() || null,
      bundlePriceMinor,
      sortOrder: parseInt(sortOrder || "0", 10) || 0,
      active,
      components,
    };
    try {
      if (editingId) {
        await apiFetch(`/organizations/${orgId}/commerce/bundles/${editingId}`, { method: "PATCH", body: JSON.stringify(body) });
        setNotice("বান্ডল আপডেট হয়েছে।");
      } else {
        await apiFetch(`/organizations/${orgId}/commerce/bundles`, { method: "POST", body: JSON.stringify(body) });
        setNotice("বান্ডল তৈরি হয়েছে।");
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
    if (!window.confirm(`"${b.name}" বান্ডলটি মুছে ফেলবেন?`)) return;
    setBusy(`del-${b.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/bundles/${b.id}`, { method: "DELETE" });
      if (editingId === b.id) resetForm();
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "মুছে ফেলা ব্যর্থ"); }
    finally { setBusy(""); }
  }

  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? id;

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
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

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
              <button type="button" className="rounded-lg border px-3 py-2 text-xs font-semibold text-rose-600 disabled:opacity-50"
                disabled={rows.length <= 2}
                onClick={() => setRows(rows.filter((_, x) => x !== i))}>সারি মুছুন</button>
            </div>
          ))}
          <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            disabled={rows.length >= 10}
            onClick={() => setRows([...rows, { productId: "", variantSku: "", qty: "1" }])}>
            + আরও পণ্য যোগ করুন
          </button>
          <p className="text-xs text-slate-400">ভ্যারিয়েন্ট SKU দিলে বান্ডলটি ওই নির্দিষ্ট ভ্যারিয়েন্টই বিক্রি করবে; খালি রাখলে পণ্যের ডিফল্ট/মূল এন্ট্রি।</p>
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-400">
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
                      {(b.components ?? []).map((c, i) => (
                        <div key={i}>{c.name ?? productName(c.productId)}{c.variantSku ? ` (${c.variantSku})` : ""} × {c.qty}</div>
                      ))}
                    </td>
                    <td className="py-2 font-semibold">{formatMinorTaka(b.bundlePriceMinor)}</td>
                    <td className="py-2">{formatMinorTaka(b.regularTotalMinor)}</td>
                    <td className="py-2 text-emerald-700">{b.savingsMinor && Number(b.savingsMinor) > 0 ? formatMinorTaka(b.savingsMinor) : "—"}</td>
                    <td className="py-2">{b.sortOrder}</td>
                    <td className="py-2">{b.active ? <span className="rounded bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">সক্রিয়</span> : <span className="rounded bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600">বন্ধ</span>}</td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        <button className="rounded-lg border px-2 py-1 text-xs font-semibold" onClick={() => startEdit(b)}>সম্পাদনা</button>
                        <button className="rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => toggleActive(b)}>{b.active ? "বন্ধ করুন" : "চালু করুন"}</button>
                        <button className="rounded-lg border px-2 py-1 text-xs font-semibold text-rose-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => remove(b)}>মুছুন</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
