"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinorTaka } from "@/lib/storefront-money";

// EC24c — গ্রাহক সাবস্ক্রিপশন (শুধুমাত্র স্টাফ তৈরি করে; দোকানে
// self-serve সাইনআপ নেই)। নবায়ন হলে sweep একটি COD অর্ডার তৈরি
// করে — কোনো স্বয়ংক্রিয় পেমেন্ট চার্জ হয় না।

interface SubscriptionRow {
  id: string;
  customerId: string;
  customerName: string | null;
  customerPhone: string | null;
  productId: string;
  productName: string | null;
  variantSku: string | null;
  qty: number;
  unitPriceMinor: string;
  discountPercent: number | null;
  status: string;
  nextRunAt: string | null;
  lastOrderId: string | null;
  failureCount: number;
}
interface CustomerRow { id: string; name: string | null; phone: string | null }
interface ProductRow {
  id: string; name: string;
  subscriptionEnabled?: boolean; subscriptionIntervalDays?: number | null;
}

const STATUS_LABEL: Record<string, string> = {
  active: "সক্রিয়",
  paused: "বিরতি",
  cancelled: "বাতিল",
};

export default function SubscriptionsPage() {
  const [items, setItems] = useState<SubscriptionRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const [customerId, setCustomerId] = useState("");
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("1");
  const [variantSku, setVariantSku] = useState("");
  const [createdFromOrderId, setCreatedFromOrderId] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createMsg, setCreateMsg] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); setLoading(false); return; }
    setLoading(true);
    try {
      const [subs, custs, prods] = await Promise.all([
        apiFetch<{ items: SubscriptionRow[] }>(`/organizations/${orgId}/subscriptions`),
        apiFetch<CustomerRow[]>(`/organizations/${orgId}/customers`).catch(() => [] as CustomerRow[]),
        apiFetch<{ items: ProductRow[] }>(`/organizations/${orgId}/products?pageSize=100`).catch(() => ({ items: [] as ProductRow[] })),
      ]);
      setItems(subs.items ?? []);
      setCustomers(custs ?? []);
      setProducts((prods.items ?? []).filter((p) => p.subscriptionEnabled));
    } catch (e) {
      setError(e instanceof Error ? e.message : "সাবস্ক্রিপশন লোড করা যায়নি");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId();
    if (!orgId) return;
    setCreating(true); setCreateError(""); setCreateMsg("");
    try {
      await apiFetch(`/organizations/${orgId}/subscriptions`, {
        method: "POST",
        body: JSON.stringify({
          customerId,
          productId,
          qty: Math.max(1, parseInt(qty, 10) || 1),
          ...(variantSku.trim() ? { variantSku: variantSku.trim() } : {}),
          ...(createdFromOrderId.trim() ? { createdFromOrderId: createdFromOrderId.trim() } : {}),
        }),
      });
      setCreateMsg("সাবস্ক্রিপশন তৈরি হয়েছে");
      setVariantSku(""); setCreatedFromOrderId(""); setQty("1");
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "তৈরি করা যায়নি");
    } finally { setCreating(false); }
  }

  async function act(id: string, action: "pause" | "resume" | "cancel") {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusyId(id); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/subscriptions/${id}/${action}`, { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "কাজটি করা যায়নি");
    } finally { setBusyId(""); }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-slate-900">🔁 গ্রাহক সাবস্ক্রিপশন</h1>
          <p className="text-sm text-slate-500">স্টাফ তৈরি করে — সময় হলে sweep একটি COD নবায়ন অর্ডার তৈরি করে (স্বয়ংক্রিয় পেমেন্ট চার্জ নেই)।</p>
        </div>
        <Link href="/dashboard/commerce" className="text-sm font-semibold text-indigo-700 hover:underline">← Commerce Hub</Link>
      </div>

      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p> : null}

      <form onSubmit={create} className="space-y-3 rounded-2xl border bg-white p-5">
        <h2 className="text-sm font-bold text-slate-900">নতুন সাবস্ক্রিপশন</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block text-xs font-bold text-slate-700">
            গ্রাহক
            <select required value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm">
              <option value="">— বেছে নিন —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name ?? c.id}{c.phone ? ` (${c.phone})` : ""}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-bold text-slate-700">
            পণ্য (শুধু সাবস্ক্রিপশন-চালু)
            <select required value={productId} onChange={(e) => setProductId(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm">
              <option value="">— বেছে নিন —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.subscriptionIntervalDays ? ` · প্রতি ${p.subscriptionIntervalDays} দিন` : ""}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-bold text-slate-700">
            পরিমাণ
            <input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm" />
          </label>
          <label className="block text-xs font-bold text-slate-700">
            ভ্যারিয়েন্ট SKU (ঐচ্ছিক)
            <input value={variantSku} onChange={(e) => setVariantSku(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm" />
          </label>
          <label className="block text-xs font-bold text-slate-700">
            উৎস অর্ডার আইডি (ঐচ্ছিক — দাম সেই অর্ডারের লাইন থেকে)
            <input value={createdFromOrderId} onChange={(e) => setCreatedFromOrderId(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm" />
          </label>
        </div>
        {createError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{createError}</p> : null}
        {createMsg ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">{createMsg}</p> : null}
        <button type="submit" disabled={creating} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
          {creating ? "তৈরি হচ্ছে…" : "সাবস্ক্রিপশন তৈরি করুন"}
        </button>
      </form>

      <div className="overflow-x-auto rounded-2xl border bg-white">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b bg-slate-50 text-xs text-slate-600">
              <th className="p-3">গ্রাহক</th>
              <th className="p-3">পণ্য</th>
              <th className="p-3">পরিমাণ</th>
              <th className="p-3">দাম (স্ন্যাপশট)</th>
              <th className="p-3">পরবর্তী নবায়ন</th>
              <th className="p-3">অবস্থা</th>
              <th className="p-3">ব্যর্থতা</th>
              <th className="p-3">কাজ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="p-4 text-slate-500">লোড হচ্ছে…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={8} className="p-4 text-slate-500">কোনো সাবস্ক্রিপশন নেই</td></tr>
            ) : items.map((s) => (
              <tr key={s.id} className="border-b last:border-0">
                <td className="p-3">{s.customerName ?? s.customerId}{s.customerPhone ? <span className="block text-xs text-slate-500">{s.customerPhone}</span> : null}</td>
                <td className="p-3">{s.productName ?? s.productId}{s.variantSku ? <span className="block text-xs text-slate-500">SKU: {s.variantSku}</span> : null}</td>
                <td className="p-3">{s.qty}</td>
                <td className="p-3">{formatMinorTaka(s.unitPriceMinor)}{s.discountPercent ? <span className="block text-xs text-slate-500">ছাড় {s.discountPercent}%</span> : null}</td>
                <td className="p-3">{s.nextRunAt ? new Date(s.nextRunAt).toLocaleString("bn-BD") : "—"}</td>
                <td className="p-3">{STATUS_LABEL[s.status] ?? s.status}</td>
                <td className="p-3">{s.failureCount}</td>
                <td className="p-3">
                  <div className="flex gap-1.5">
                    {s.status === "active" ? (
                      <button type="button" disabled={busyId === s.id} onClick={() => act(s.id, "pause")} className="rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800 disabled:opacity-50">বিরতি</button>
                    ) : null}
                    {s.status === "paused" ? (
                      <button type="button" disabled={busyId === s.id} onClick={() => act(s.id, "resume")} className="rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800 disabled:opacity-50">আবার চালু</button>
                    ) : null}
                    {s.status !== "cancelled" ? (
                      <button type="button" disabled={busyId === s.id} onClick={() => act(s.id, "cancel")} className="rounded-lg bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-800 disabled:opacity-50">বাতিল</button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
