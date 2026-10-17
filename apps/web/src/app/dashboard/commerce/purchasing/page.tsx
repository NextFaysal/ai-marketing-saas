"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinorTaka, takaToMinorString, minorToTakaString } from "@/lib/storefront-money";
import { ResponsiveTable } from "@repo/ui";

// EC20 — Purchasing: suppliers, purchase orders (+ receive), reorder suggestions.
// Money: API minor-unit strings (poisha); forms take taka, converted via takaToMinorString.

interface Supplier { id: string; name: string; phone?: string | null; email?: string | null; address?: string | null; note?: string | null; active: boolean; purchaseOrderCount?: number }
interface POItem { id: string; productId: string; productName?: string | null; variantId?: string | null; variantName?: string | null; sku?: string | null; qtyOrdered: number; qtyReceived: number; remaining: number; unitCostMinor?: string | null }
interface PO { id: string; supplierId: string; supplierName?: string | null; status: string; expectedDate?: string | null; note?: string | null; itemCount?: number; orderedTotalMinor?: string; receivedTotalMinor?: string; items?: POItem[] }
interface Suggestion { productId: string; productName: string; variantId?: string | null; variantName?: string | null; sku?: string | null; currentStock: number; threshold: number; suggestedQty: number; lastSupplier: { id: string; name: string } | null; lastUnitCostMinor?: string | null }
interface ProductItem { id: string; name: string; sku?: string | null; priceMinor?: string }
interface VariantItem { id: string; name: string; sku?: string | null }

const STATUS_BN: Record<string, string> = {
  draft: "খসড়া", ordered: "অর্ডার করা হয়েছে", partially_received: "আংশিক পৌঁছেছে",
  received: "সম্পূর্ণ পৌঁছেছে", cancelled: "বাতিল",
};
function statusCls(s: string): string {
  switch (s) {
    case "draft": return "bg-slate-200 text-slate-700";
    case "ordered": return "bg-blue-100 text-blue-700";
    case "partially_received": return "bg-amber-100 text-amber-700";
    case "received": return "bg-green-100 text-green-700";
    case "cancelled": return "bg-red-100 text-red-700";
    default: return "bg-slate-200 text-slate-600";
  }
}

interface DraftRow { key: number; productId: string; variantId: string; qty: string; unitCostTaka: string; variants: VariantItem[] }
let rowKey = 0;
const emptyRow = (): DraftRow => ({ key: ++rowKey, productId: "", variantId: "", qty: "1", unitCostTaka: "", variants: [] });

export default function PurchasingPage() {
  const [tab, setTab] = useState<"suppliers" | "orders" | "suggestions">("suppliers");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [products, setProducts] = useState<ProductItem[]>([]);

  // Suppliers
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supForm, setSupForm] = useState({ name: "", phone: "", email: "", address: "", note: "" });
  const [editingSup, setEditingSup] = useState<Supplier | null>(null);

  // Purchase orders
  const [pos, setPos] = useState<PO[]>([]);
  const [detail, setDetail] = useState<PO | null>(null);
  const [poForm, setPoForm] = useState({ supplierId: "", expectedDate: "", note: "" });
  const [rows, setRows] = useState<DraftRow[]>([emptyRow()]);
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});
  const [receiveCost, setReceiveCost] = useState<Record<string, string>>({});

  // Suggestions
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const loadAll = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); return; }
    const [sup, po, sug, prod] = await Promise.allSettled([
      apiFetch<{ items: Supplier[] }>(`/organizations/${orgId}/commerce/suppliers`),
      apiFetch<{ items: PO[] }>(`/organizations/${orgId}/commerce/purchase-orders`),
      apiFetch<{ items: Suggestion[] }>(`/organizations/${orgId}/inventory/reorder-suggestions`),
      apiFetch<{ total: number; items: ProductItem[] }>(`/organizations/${orgId}/products?pageSize=100`),
    ]);
    if (sup.status === "fulfilled") setSuppliers(sup.value?.items ?? []);
    if (po.status === "fulfilled") setPos(po.value?.items ?? []);
    if (sug.status === "fulfilled") setSuggestions(sug.value?.items ?? []);
    if (prod.status === "fulfilled") setProducts(prod.value.items ?? []);
    const failed = [sup, po, sug].find((r) => r.status === "rejected");
    if (failed && failed.status === "rejected") setError(failed.reason instanceof Error ? failed.reason.message : "লোড ব্যর্থ হয়েছে");
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  async function loadVariants(row: DraftRow, productId: string) {
    const orgId = getOrganizationId(); if (!orgId || !productId) return;
    try {
      const d = await apiFetch<ProductItem & { variants?: VariantItem[] }>(`/organizations/${orgId}/products/${productId}`);
      setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, variants: d.variants ?? [] } : r)));
    } catch { /* variants stay empty — base product only */ }
  }

  // ---- suppliers ----
  async function saveSupplier(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("supplier"); setError(""); setNotice("");
    const body = { name: supForm.name.trim(), phone: supForm.phone.trim() || undefined, email: supForm.email.trim() || undefined, address: supForm.address.trim() || undefined, note: supForm.note.trim() || undefined };
    try {
      if (editingSup) {
        await apiFetch(`/organizations/${orgId}/commerce/suppliers/${editingSup.id}`, { method: "PATCH", body: JSON.stringify(body) });
        setNotice("সরবরাহকারী আপডেট হয়েছে।");
      } else {
        await apiFetch(`/organizations/${orgId}/commerce/suppliers`, { method: "POST", body: JSON.stringify(body) });
        setNotice("সরবরাহকারী যোগ হয়েছে।");
      }
      setSupForm({ name: "", phone: "", email: "", address: "", note: "" }); setEditingSup(null);
      await loadAll();
    } catch (err) { setError(err instanceof Error ? err.message : "সংরক্ষণ ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function deactivateSupplier(s: Supplier) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`sup-${s.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/suppliers/${s.id}`, { method: "DELETE" });
      setNotice("সরবরাহকারী নিষ্ক্রিয় করা হয়েছে।");
      await loadAll();
    } catch (err) { setError(err instanceof Error ? err.message : "নিষ্ক্রিয় করা যায়নি"); }
    finally { setBusy(""); }
  }

  // ---- purchase orders ----
  async function openDetail(po: PO) {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const d = await apiFetch<PO>(`/organizations/${orgId}/commerce/purchase-orders/${po.id}`);
      setDetail(d);
      const qty: Record<string, string> = {}; const cost: Record<string, string> = {};
      for (const it of d.items ?? []) { qty[it.id] = String(it.remaining ?? 0); cost[it.id] = ""; }
      setReceiveQty(qty); setReceiveCost(cost);
    } catch (err) { setError(err instanceof Error ? err.message : "বিস্তারিত লোড ব্যর্থ"); }
  }

  async function createPo(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    const valid = rows.filter((r) => r.productId);
    if (!poForm.supplierId) { setError("সরবরাহকারী বেছে নিন।"); return; }
    if (valid.length === 0) { setError("অন্তত একটি পণ্য যোগ করুন।"); return; }
    const items: { productId: string; variantId?: string; qty: number; unitCostMinor: string }[] = [];
    for (const r of valid) {
      const cost = takaToMinorString(r.unitCostTaka || "0");
      if (cost === null) { setError("একক দাম ঠিকভাবে লিখুন (টাকায়)।"); return; }
      items.push({ productId: r.productId, variantId: r.variantId || undefined, qty: Math.max(1, Number(r.qty) || 1), unitCostMinor: cost });
    }
    setBusy("po-create"); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/purchase-orders`, {
        method: "POST",
        body: JSON.stringify({ supplierId: poForm.supplierId, expectedDate: poForm.expectedDate || undefined, note: poForm.note.trim() || undefined, items }),
      });
      setNotice("ক্রয় অর্ডার (খসড়া) তৈরি হয়েছে।");
      setRows([emptyRow()]); setPoForm({ supplierId: "", expectedDate: "", note: "" });
      await loadAll();
    } catch (err) { setError(err instanceof Error ? err.message : "তৈরি ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function patchPo(po: PO, status: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`po-${po.id}`); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/purchase-orders/${po.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      setNotice("অবস্থা আপডেট হয়েছে।");
      if (detail?.id === po.id) await openDetail(po);
      await loadAll();
    } catch (err) { setError(err instanceof Error ? err.message : "আপডেট ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function receivePo() {
    const orgId = getOrganizationId(); if (!orgId || !detail) return;
    const items = (detail.items ?? [])
      .filter((it) => Number(receiveQty[it.id]) > 0)
      .map((it) => {
        const c = receiveCost[it.id]?.trim();
        return { itemId: it.id, qty: Number(receiveQty[it.id]), unitCostMinor: c ? (takaToMinorString(c) ?? undefined) : undefined };
      });
    if (items.length === 0) { setError("অন্তত একটি লাইনে গ্রহণের পরিমাণ দিন।"); return; }
    setBusy("receive"); setError(""); setNotice("");
    try {
      const updated = await apiFetch<PO>(`/organizations/${orgId}/commerce/purchase-orders/${detail.id}/receive`, { method: "POST", body: JSON.stringify({ items }) });
      setDetail(updated);
      setNotice("পণ্য গ্রহণ রেকর্ড হয়েছে — স্টক আপডেট হয়েছে।");
      await loadAll();
    } catch (err) { setError(err instanceof Error ? err.message : "গ্রহণ রেকর্ড ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function createPoFromSuggestion(s: Suggestion) {
    const orgId = getOrganizationId(); if (!orgId || !s.lastSupplier) return;
    setBusy(`sug-${s.productId}-${s.variantId ?? ""}`); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/purchase-orders`, {
        method: "POST",
        body: JSON.stringify({
          supplierId: s.lastSupplier.id,
          items: [{ productId: s.productId, variantId: s.variantId ?? undefined, qty: s.suggestedQty, unitCostMinor: s.lastUnitCostMinor ?? "0" }],
        }),
      });
      setNotice(`খসড়া ক্রয় অর্ডার তৈরি হয়েছে — ${s.productName}।`);
      await loadAll();
      setTab("orders");
    } catch (err) { setError(err instanceof Error ? err.message : "PO তৈরি ব্যর্থ"); }
    finally { setBusy(""); }
  }

  const tabBtn = (key: typeof tab, label: string) => (
    <button type="button" key={key} onClick={() => setTab(key)}
      className={`inline-flex min-h-[44px] items-center rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === key ? "bg-slate-900 text-white" : "border bg-white"}`}>{label}</button>
  );

  // EB6: row actions shared verbatim between each desktop table and
  // its ResponsiveTable mobile card — same handlers, same order.
  const renderSupplierActions = (s: Supplier) => (
    <div className="flex gap-2">
      <button type="button" className="inline-flex min-h-[44px] items-center text-xs font-semibold text-blue-700" onClick={() => { setEditingSup(s); setSupForm({ name: s.name, phone: s.phone ?? "", email: s.email ?? "", address: s.address ?? "", note: s.note ?? "" }); }}>সম্পাদনা</button>
      {s.active ? <button type="button" className="inline-flex min-h-[44px] items-center text-xs font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => deactivateSupplier(s)}>নিষ্ক্রিয় করুন</button> : null}
    </div>
  );
  const renderPoActions = (po: PO) => (
    <div className="flex flex-wrap gap-2">
      <button type="button" className="inline-flex min-h-[44px] items-center text-xs font-semibold text-blue-700" onClick={() => openDetail(po)}>বিস্তারিত / গ্রহণ</button>
      {po.status === "draft" ? <>
        <button type="button" className="inline-flex min-h-[44px] items-center text-xs font-semibold text-indigo-700 disabled:opacity-50" disabled={busy !== ""} onClick={() => patchPo(po, "ordered")}>অর্ডার করা হয়েছে</button>
        <button type="button" className="inline-flex min-h-[44px] items-center text-xs font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => patchPo(po, "cancelled")}>বাতিল</button>
      </> : null}
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">🧾 ক্রয় / Purchasing</h1>
        <p className="text-sm text-slate-500">সরবরাহকারী, ক্রয় অর্ডার ও পণ্য গ্রহণ — গ্রহণ হলেই স্টক বাড়ে। সব টাকা আসল ক্রয় রেকর্ড থেকে।</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {tabBtn("suppliers", "সরবরাহকারী")}
        {tabBtn("orders", "ক্রয় অর্ডার")}
        {tabBtn("suggestions", "পুনঃঅর্ডার পরামর্শ")}
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      {tab === "suppliers" ? (
        <div className="space-y-4">
          <form onSubmit={saveSupplier} className="card grid gap-2 p-5 sm:grid-cols-3">
            <input aria-label="সরবরাহকারীর নাম" className="input" placeholder="নাম *" value={supForm.name} onChange={(e) => setSupForm({ ...supForm, name: e.target.value })} required />
            <input aria-label="সরবরাহকারীর ফোন" className="input" placeholder="ফোন" value={supForm.phone} onChange={(e) => setSupForm({ ...supForm, phone: e.target.value })} />
            <input aria-label="সরবরাহকারীর ইমেইল" className="input" placeholder="ইমেইল" value={supForm.email} onChange={(e) => setSupForm({ ...supForm, email: e.target.value })} />
            <input aria-label="সরবরাহকারীর ঠিকানা" className="input sm:col-span-2" placeholder="ঠিকানা" value={supForm.address} onChange={(e) => setSupForm({ ...supForm, address: e.target.value })} />
            <input aria-label="সরবরাহকারীর নোট" className="input" placeholder="নোট" value={supForm.note} onChange={(e) => setSupForm({ ...supForm, note: e.target.value })} />
            <div className="flex gap-2 sm:col-span-3">
              <button className="btn-primary" disabled={busy !== ""}>{busy === "supplier" ? "হচ্ছে…" : editingSup ? "আপডেট করুন" : "সরবরাহকারী যোগ করুন"}</button>
              {editingSup ? <button type="button" className="btn-secondary" onClick={() => { setEditingSup(null); setSupForm({ name: "", phone: "", email: "", address: "", note: "" }); }}>বাতিল</button> : null}
            </div>
          </form>
          <div className="card p-5">
            {suppliers.length === 0 ? <p className="text-sm text-slate-500">কোনো সরবরাহকারী নেই।</p> : (
              <ResponsiveTable
                table={
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs text-slate-500"><th className="py-2 pr-3">নাম</th><th className="py-2 pr-3">যোগাযোগ</th><th className="py-2 pr-3">ক্রয় অর্ডার</th><th className="py-2 pr-3">অবস্থা</th><th className="py-2">অ্যাকশন</th></tr></thead>
                <tbody>{suppliers.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{s.name}{s.address ? <span className="block text-xs text-slate-500">{s.address}</span> : null}</td>
                    <td className="py-2 pr-3">{s.phone ?? "—"}{s.email ? <span className="block text-xs text-slate-500">{s.email}</span> : null}</td>
                    <td className="py-2 pr-3">{s.purchaseOrderCount ?? 0}টি</td>
                    <td className="py-2 pr-3"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${s.active ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}`}>{s.active ? "সক্রিয়" : "নিষ্ক্রিয়"}</span></td>
                    <td className="py-2">{renderSupplierActions(s)}</td>
                  </tr>))}
                </tbody></table></div>
                }
                cards={suppliers.map((s) => (
                  <div key={s.id} className="rounded-xl border bg-white p-3 text-sm shadow-sm">
                    <dl className="space-y-1.5">
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">নাম</dt><dd className="text-right font-medium">{s.name}{s.address ? <span className="block text-xs font-normal text-slate-500">{s.address}</span> : null}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">যোগাযোগ</dt><dd className="text-right">{s.phone ?? "—"}{s.email ? <span className="block text-xs text-slate-500">{s.email}</span> : null}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">ক্রয় অর্ডার</dt><dd className="text-right">{s.purchaseOrderCount ?? 0}টি</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">অবস্থা</dt><dd className="text-right"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${s.active ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}`}>{s.active ? "সক্রিয়" : "নিষ্ক্রিয়"}</span></dd></div>
                    </dl>
                    <div className="mt-2">{renderSupplierActions(s)}</div>
                  </div>
                ))}
              />
            )}
          </div>
        </div>
      ) : null}

      {tab === "orders" ? (
        <div className="space-y-4">
          <form onSubmit={createPo} className="card space-y-3 p-5">
            <div className="font-semibold">নতুন ক্রয় অর্ডার (খসড়া)</div>
            <div className="grid gap-2 sm:grid-cols-3">
              <select className="input" value={poForm.supplierId} onChange={(e) => setPoForm({ ...poForm, supplierId: e.target.value })} required>
                <option value="">সরবরাহকারী বেছে নিন</option>
                {suppliers.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <label className="block text-sm">প্রত্যাশিত তারিখ<input type="date" className="input mt-1" value={poForm.expectedDate} onChange={(e) => setPoForm({ ...poForm, expectedDate: e.target.value })} /></label>
              <input aria-label="ক্রয় অর্ডারের নোট" className="input self-end" placeholder="নোট" value={poForm.note} onChange={(e) => setPoForm({ ...poForm, note: e.target.value })} />
            </div>
            <div className="space-y-2">
              {rows.map((r) => (
                <div key={r.key} className="grid gap-2 sm:grid-cols-5">
                  <select aria-label="পণ্য বেছে নিন" className="input sm:col-span-2" value={r.productId} onChange={(e) => {
                    const pid = e.target.value;
                    setRows((prev) => prev.map((x) => (x.key === r.key ? { ...x, productId: pid, variantId: "", variants: [] } : x)));
                    const row = { ...r, productId: pid }; void loadVariants(row, pid);
                  }}>
                    <option value="">পণ্য বেছে নিন</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ""}</option>)}
                  </select>
                  <select aria-label="ভ্যারিয়েন্ট বেছে নিন" className="input" value={r.variantId} onChange={(e) => setRows((prev) => prev.map((x) => (x.key === r.key ? { ...x, variantId: e.target.value } : x)))}>
                    <option value="">ভ্যারিয়েন্ট নেই / মূল পণ্য</option>
                    {r.variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                  <input aria-label="পরিমাণ" className="input" type="number" min={1} placeholder="পরিমাণ" value={r.qty} onChange={(e) => setRows((prev) => prev.map((x) => (x.key === r.key ? { ...x, qty: e.target.value } : x)))} />
                  <div className="flex gap-2">
                    <input aria-label="একক দাম (টাকা)" className="input" inputMode="decimal" placeholder="একক দাম (৳)" value={r.unitCostTaka} onChange={(e) => setRows((prev) => prev.map((x) => (x.key === r.key ? { ...x, unitCostTaka: e.target.value } : x)))} />
                    <button type="button" aria-label="এই পণ্যের লাইনটি সরান" className="btn-ghost btn-sm inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-red-600" onClick={() => setRows((prev) => (prev.length > 1 ? prev.filter((x) => x.key !== r.key) : prev))}>✕</button>
                  </div>
                </div>
              ))}
              <button type="button" className="btn-secondary btn-sm" onClick={() => setRows((prev) => [...prev, emptyRow()])}>+ আরেকটি পণ্য</button>
            </div>
            <button className="btn-primary" disabled={busy !== ""}>{busy === "po-create" ? "তৈরি হচ্ছে…" : "খসড়া PO তৈরি করুন"}</button>
          </form>

          <div className="card p-5">
            {pos.length === 0 ? <p className="text-sm text-slate-500">কোনো ক্রয় অর্ডার নেই।</p> : (
              <ResponsiveTable
                table={
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs text-slate-500"><th className="py-2 pr-3">সরবরাহকারী</th><th className="py-2 pr-3">অবস্থা</th><th className="py-2 pr-3">আইটেম</th><th className="py-2 pr-3">অর্ডার মোট</th><th className="py-2 pr-3">গৃহীত মোট</th><th className="py-2">অ্যাকশন</th></tr></thead>
                <tbody>{pos.map((po) => (
                  <tr key={po.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{po.supplierName ?? po.supplierId}{po.expectedDate ? <span className="block text-xs text-slate-500">প্রত্যাশিত: {new Date(po.expectedDate).toLocaleDateString("bn-BD")}</span> : null}</td>
                    <td className="py-2 pr-3"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${statusCls(po.status)}`}>{STATUS_BN[po.status] ?? po.status}</span></td>
                    <td className="py-2 pr-3">{po.itemCount ?? po.items?.length ?? 0}টি</td>
                    <td className="py-2 pr-3">{formatMinorTaka(po.orderedTotalMinor)}</td>
                    <td className="py-2 pr-3">{formatMinorTaka(po.receivedTotalMinor)}</td>
                    <td className="py-2">{renderPoActions(po)}</td>
                  </tr>))}
                </tbody></table></div>
                }
                cards={pos.map((po) => (
                  <div key={po.id} className="rounded-xl border bg-white p-3 text-sm shadow-sm">
                    <dl className="space-y-1.5">
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">সরবরাহকারী</dt><dd className="text-right font-medium">{po.supplierName ?? po.supplierId}{po.expectedDate ? <span className="block text-xs font-normal text-slate-500">প্রত্যাশিত: {new Date(po.expectedDate).toLocaleDateString("bn-BD")}</span> : null}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">অবস্থা</dt><dd className="text-right"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${statusCls(po.status)}`}>{STATUS_BN[po.status] ?? po.status}</span></dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">আইটেম</dt><dd className="text-right">{po.itemCount ?? po.items?.length ?? 0}টি</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">অর্ডার মোট</dt><dd className="text-right">{formatMinorTaka(po.orderedTotalMinor)}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">গৃহীত মোট</dt><dd className="text-right">{formatMinorTaka(po.receivedTotalMinor)}</dd></div>
                    </dl>
                    <div className="mt-2">{renderPoActions(po)}</div>
                  </div>
                ))}
              />
            )}
          </div>

          {detail ? (
            <div className="card space-y-3 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold">বিস্তারিত — {detail.supplierName ?? detail.supplierId} <span className={`ml-2 rounded px-2 py-0.5 text-xs font-semibold ${statusCls(detail.status)}`}>{STATUS_BN[detail.status] ?? detail.status}</span></div>
                <button type="button" className="btn-ghost btn-sm inline-flex min-h-[44px] items-center" onClick={() => setDetail(null)}>বন্ধ করুন</button>
              </div>
              <ResponsiveTable
                table={
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs text-slate-500"><th className="py-2 pr-3">পণ্য</th><th className="py-2 pr-3">অর্ডার</th><th className="py-2 pr-3">গৃহীত</th><th className="py-2 pr-3">বাকি</th><th className="py-2 pr-3">একক দাম</th><th className="py-2 pr-3">এবার গ্রহণ</th><th className="py-2">দাম override (৳)</th></tr></thead>
                <tbody>{(detail.items ?? []).map((it) => (
                  <tr key={it.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{it.productName ?? it.productId}{it.variantName ? <span className="block text-xs text-slate-500">{it.variantName}</span> : null}{it.sku ? <span className="block text-xs text-slate-500">SKU: {it.sku}</span> : null}</td>
                    <td className="py-2 pr-3">{it.qtyOrdered}</td>
                    <td className="py-2 pr-3">{it.qtyReceived}</td>
                    <td className="py-2 pr-3 font-semibold">{it.remaining}</td>
                    <td className="py-2 pr-3">{it.unitCostMinor ? formatMinorTaka(it.unitCostMinor) : "—"}</td>
                    <td className="py-2 pr-3"><input aria-label="এবার গ্রহণ পরিমাণ" className="input w-24" type="number" min={0} max={it.remaining} value={receiveQty[it.id] ?? ""} onChange={(e) => setReceiveQty({ ...receiveQty, [it.id]: e.target.value })} /></td>
                    <td className="py-2"><input aria-label="দাম override (টাকা)" className="input w-28" inputMode="decimal" placeholder={it.unitCostMinor ? minorToTakaString(it.unitCostMinor) : "ঐচ্ছিক"} value={receiveCost[it.id] ?? ""} onChange={(e) => setReceiveCost({ ...receiveCost, [it.id]: e.target.value })} /></td>
                  </tr>))}
                </tbody></table></div>
                }
                cards={(detail.items ?? []).map((it) => (
                  <div key={it.id} className="rounded-xl border bg-white p-3 text-sm shadow-sm">
                    <dl className="space-y-1.5">
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">পণ্য</dt><dd className="text-right font-medium">{it.productName ?? it.productId}{it.variantName ? <span className="block text-xs font-normal text-slate-500">{it.variantName}</span> : null}{it.sku ? <span className="block text-xs font-normal text-slate-500">SKU: {it.sku}</span> : null}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">অর্ডার</dt><dd className="text-right">{it.qtyOrdered}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">গৃহীত</dt><dd className="text-right">{it.qtyReceived}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">বাকি</dt><dd className="text-right font-semibold">{it.remaining}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">একক দাম</dt><dd className="text-right">{it.unitCostMinor ? formatMinorTaka(it.unitCostMinor) : "—"}</dd></div>
                    </dl>
                    <label className="mt-2 block text-xs font-semibold text-slate-500">এবার গ্রহণ
                      <input aria-label="এবার গ্রহণ পরিমাণ" className="input mt-1 w-24" type="number" min={0} max={it.remaining} value={receiveQty[it.id] ?? ""} onChange={(e) => setReceiveQty({ ...receiveQty, [it.id]: e.target.value })} />
                    </label>
                    <label className="mt-2 block text-xs font-semibold text-slate-500">দাম override (৳)
                      <input aria-label="দাম override (টাকা)" className="input mt-1 w-28" inputMode="decimal" placeholder={it.unitCostMinor ? minorToTakaString(it.unitCostMinor) : "ঐচ্ছিক"} value={receiveCost[it.id] ?? ""} onChange={(e) => setReceiveCost({ ...receiveCost, [it.id]: e.target.value })} />
                    </label>
                  </div>
                ))}
              />
              {detail.status !== "received" && detail.status !== "cancelled" ? (
                <button type="button" className="btn-primary" disabled={busy !== ""} onClick={receivePo}>{busy === "receive" ? "রেকর্ড হচ্ছে…" : "গ্রহণ রেকর্ড করুন"}</button>
              ) : null}
              <p className="text-xs text-slate-500">গ্রহণ রেকর্ড হলেই সংশ্লিষ্ট পণ্যের স্টক বাড়ে। দাম override না দিলে PO-র একক দামই ব্যবহৃত হয়।</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "suggestions" ? (
        <div className="card p-5">
          <div className="font-semibold">পুনঃঅর্ডার পরামর্শ</div>
          <p className="mt-1 text-sm text-slate-500">স্টক threshold-এর নিচে নেমে যাওয়া পণ্য — পরামর্শটি আসল স্টক ও শেষ ক্রয়ের রেকর্ড থেকে।</p>
          {suggestions.length === 0 ? <p className="mt-3 text-sm text-slate-500">এখন কোনো পণ্যের পুনঃঅর্ডার দরকার নেই।</p> : (
            <ResponsiveTable
              table={
            <div className="mt-3 overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-slate-500"><th className="py-2 pr-3">পণ্য</th><th className="py-2 pr-3">বর্তমান স্টক</th><th className="py-2 pr-3">Threshold</th><th className="py-2 pr-3">পরামর্শিত পরিমাণ</th><th className="py-2 pr-3">শেষ সরবরাহকারী</th><th className="py-2">অ্যাকশন</th></tr></thead>
              <tbody>{suggestions.map((s) => (
                <tr key={`${s.productId}-${s.variantId ?? ""}`} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-medium">{s.productName}{s.variantName ? <span className="block text-xs text-slate-500">{s.variantName}</span> : null}{s.sku ? <span className="block text-xs text-slate-500">SKU: {s.sku}</span> : null}</td>
                  <td className="py-2 pr-3">{s.currentStock}</td>
                  <td className="py-2 pr-3">{s.threshold}</td>
                  <td className="py-2 pr-3 font-semibold">{s.suggestedQty}</td>
                  <td className="py-2 pr-3">{s.lastSupplier ? <>{s.lastSupplier.name}{s.lastUnitCostMinor ? <span className="block text-xs text-slate-500">শেষ দাম: {formatMinorTaka(s.lastUnitCostMinor)}</span> : null}</> : <span className="text-slate-400">জানা নেই</span>}</td>
                  <td className="py-2">
                    <button type="button" className="btn-primary btn-sm inline-flex min-h-[44px] items-center disabled:opacity-50" disabled={!s.lastSupplier || busy !== ""}
                      title={!s.lastSupplier ? "আগের সরবরাহকারী জানা নেই" : undefined}
                      onClick={() => createPoFromSuggestion(s)}>
                      {busy === `sug-${s.productId}-${s.variantId ?? ""}` ? "তৈরি হচ্ছে…" : "PO তৈরি করুন"}
                    </button>
                    {!s.lastSupplier ? <span className="mt-1 block text-xs text-amber-700">আগের সরবরাহকারী জানা নেই</span> : null}
                  </td>
                </tr>))}
              </tbody></table></div>
              }
              cards={suggestions.map((s) => (
                <div key={`${s.productId}-${s.variantId ?? ""}`} className="rounded-xl border bg-white p-3 text-sm shadow-sm">
                  <dl className="space-y-1.5">
                    <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">পণ্য</dt><dd className="text-right font-medium">{s.productName}{s.variantName ? <span className="block text-xs font-normal text-slate-500">{s.variantName}</span> : null}{s.sku ? <span className="block text-xs font-normal text-slate-500">SKU: {s.sku}</span> : null}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">বর্তমান স্টক</dt><dd className="text-right">{s.currentStock}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">Threshold</dt><dd className="text-right">{s.threshold}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">পরামর্শিত পরিমাণ</dt><dd className="text-right font-semibold">{s.suggestedQty}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">শেষ সরবরাহকারী</dt><dd className="text-right">{s.lastSupplier ? <>{s.lastSupplier.name}{s.lastUnitCostMinor ? <span className="block text-xs text-slate-500">শেষ দাম: {formatMinorTaka(s.lastUnitCostMinor)}</span> : null}</> : <span className="text-slate-400">জানা নেই</span>}</dd></div>
                  </dl>
                  <div className="mt-2">
                    <button type="button" className="btn-primary btn-sm inline-flex min-h-[44px] items-center disabled:opacity-50" disabled={!s.lastSupplier || busy !== ""}
                      title={!s.lastSupplier ? "আগের সরবরাহকারী জানা নেই" : undefined}
                      onClick={() => createPoFromSuggestion(s)}>
                      {busy === `sug-${s.productId}-${s.variantId ?? ""}` ? "তৈরি হচ্ছে…" : "PO তৈরি করুন"}
                    </button>
                    {!s.lastSupplier ? <span className="mt-1 block text-xs text-amber-700">আগের সরবরাহকারী জানা নেই</span> : null}
                  </div>
                </div>
              ))}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
