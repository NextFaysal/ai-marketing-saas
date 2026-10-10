"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinor } from "@repo/contracts";
import { EmptyState } from "@repo/ui";

interface ProductItem {
  id: string; name: string; sku?: string | null; category?: string | null;
  priceMinor: string; currentCostMinor?: string | null;
  marginPercent?: number | null; stockQuantity?: number | null; status: string;
}

export default function ProductsPage() {
  const [items, setItems] = useState<ProductItem[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", sku: "", price: "", cost: "", category: "", stockQuantity: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (q = "") => {
    const orgId = getOrganizationId();
    if (!orgId) { setError("কোনো Organization নির্বাচিত নেই। আবার লগইন করে Onboarding শেষ করুন।"); setLoading(false); return; }
    setLoading(true);
    try {
      const data = await apiFetch<{ total: number; items: ProductItem[] }>(
        `/organizations/${orgId}/products?pageSize=50${q ? `&search=${encodeURIComponent(q)}` : ""}`);
      setItems(data.items); setTotal(data.total); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load products"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setSaving(true); setError("");
    try {
      const created = await apiFetch<ProductItem>(`/organizations/${orgId}/products`, {
        method: "POST",
        body: JSON.stringify({
          name: form.name, sku: form.sku || undefined, price: form.price,
          category: form.category || undefined,
          stockQuantity: form.stockQuantity ? Number(form.stockQuantity) : undefined,
        }),
      });
      if (form.cost) {
        await apiFetch(`/organizations/${orgId}/products/${created.id}/costs`, {
          method: "POST", body: JSON.stringify({ cost: form.cost }),
        });
      }
      setForm({ name: "", sku: "", price: "", cost: "", category: "", stockQuantity: "" });
      await load(search);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to create product"); }
    finally { setSaving(false); }
  }

  async function onArchive(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await apiFetch(`/organizations/${orgId}/products/${id}`, { method: "DELETE" });
    await load(search);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Products</h1>
          <p className="text-sm text-slate-500">মোট {total}টি পণ্য। কস্ট দিলে মার্জিন অটোমেটিক হিসাব হবে।</p>
        </div>
        <a href="/dashboard/products/import" className="btn-primary">CSV Import</a>
      </div>

      <form onSubmit={onCreate} className="grid grid-cols-2 gap-3 card p-4 lg:grid-cols-4">
        <input className="rounded-lg border px-3 py-2 text-sm" placeholder="পণ্যের নাম *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <input className="rounded-lg border px-3 py-2 text-sm" placeholder="SKU" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
        <input className="rounded-lg border px-3 py-2 text-sm" placeholder="বিক্রয়মূল্য (BDT) *" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
        <input className="rounded-lg border px-3 py-2 text-sm" placeholder="ইউনিট কস্ট (BDT)" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
        <input className="rounded-lg border px-3 py-2 text-sm" placeholder="ক্যাটাগরি" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        <input className="rounded-lg border px-3 py-2 text-sm" placeholder="স্টক" type="number" min="0" value={form.stockQuantity} onChange={(e) => setForm({ ...form, stockQuantity: e.target.value })} />
        <button className="btn-primary disabled:opacity-50" disabled={saving}>
          {saving ? "সেভ হচ্ছে..." : "পণ্য যোগ করুন"}
        </button>
      </form>

      <div className="flex gap-2">
        <input className="w-72 rounded-lg border px-3 py-2 text-sm" placeholder="নাম দিয়ে খুঁজুন..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="rounded-lg border bg-white px-4 py-2 text-sm" onClick={() => load(search)}>খুঁজুন</button>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {loading ? <p className="text-sm text-slate-500">লোড হচ্ছে...</p> : items.length === 0 ? (
        <EmptyState title="এখনো কোনো পণ্য নেই" description="উপরের ফর্মে ম্যানুয়ালি যোগ করুন অথবা CSV Import দিয়ে একসাথে অনেক পণ্য আনুন। নমুনা ফাইল: docs/examples/products-sample.csv" />
      ) : (
        <div className="overflow-hidden card">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500"><tr>
              <th className="px-4 py-3">নাম</th><th className="px-4 py-3">SKU</th><th className="px-4 py-3">মূল্য</th>
              <th className="px-4 py-3">কস্ট</th><th className="px-4 py-3">মার্জিন</th><th className="px-4 py-3">স্টক</th><th className="px-4 py-3"></th>
            </tr></thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="px-4 py-3 font-medium">{p.name}<div className="text-xs text-slate-400">{p.category ?? ""}</div></td>
                  <td className="px-4 py-3">{p.sku ?? "—"}</td>
                  <td className="px-4 py-3">{formatMinor(BigInt(p.priceMinor))}</td>
                  <td className="px-4 py-3">{p.currentCostMinor ? formatMinor(BigInt(p.currentCostMinor)) : <span className="text-amber-600">কস্ট দেওয়া হয়নি</span>}</td>
                  <td className="px-4 py-3">{p.marginPercent === null || p.marginPercent === undefined ? "—" : `${p.marginPercent}%`}</td>
                  <td className="px-4 py-3">{p.stockQuantity ?? "—"}</td>
                  <td className="px-4 py-3"><button className="text-red-600" onClick={() => onArchive(p.id)}>Archive</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
