"use client";
import React, { useCallback, useEffect, useState } from "react";
import { fmtDate } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
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
  draft: "draft", ordered: "orderPlaced", partially_received: "partiallyDelivered",
  received: "fullyDelivered", cancelled: "cancel",
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
  const { dict, t, locale } = useLocale();
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
    if (!orgId) { setError(dict.commerce.noOrganizationSelected); return; }
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
    if (failed && failed.status === "rejected") setError(failed.reason instanceof Error ? failed.reason.message : dict.commerce.loadingFailed2);
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
        setNotice(dict.commerce.supplierUpdated);
      } else {
        await apiFetch(`/organizations/${orgId}/commerce/suppliers`, { method: "POST", body: JSON.stringify(body) });
        setNotice(dict.commerce.supplierAdded);
      }
      setSupForm({ name: "", phone: "", email: "", address: "", note: "" }); setEditingSup(null);
      await loadAll();
    } catch (err) { setError(err instanceof Error ? err.message : dict.commerce.saveFailed); }
    finally { setBusy(""); }
  }

  async function deactivateSupplier(s: Supplier) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`sup-${s.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/suppliers/${s.id}`, { method: "DELETE" });
      setNotice(dict.commerce.supplierDeactivated);
      await loadAll();
    } catch (err) { setError(err instanceof Error ? err.message : dict.commerce.couldNotDeactivate); }
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
    } catch (err) { setError(err instanceof Error ? err.message : dict.commerce.detailsLoadingFailed); }
  }

  async function createPo(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    const valid = rows.filter((r) => r.productId);
    if (!poForm.supplierId) { setError(dict.commerce.selectASupplier); return; }
    if (valid.length === 0) { setError(dict.commerce.addAtLeastOneProduct); return; }
    const items: { productId: string; variantId?: string; qty: number; unitCostMinor: string }[] = [];
    for (const r of valid) {
      const cost = takaToMinorString(r.unitCostTaka || "0");
      if (cost === null) { setError(dict.commerce.writeTheUnitPriceCorrectly); return; }
      items.push({ productId: r.productId, variantId: r.variantId || undefined, qty: Math.max(1, Number(r.qty) || 1), unitCostMinor: cost });
    }
    setBusy("po-create"); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/purchase-orders`, {
        method: "POST",
        body: JSON.stringify({ supplierId: poForm.supplierId, expectedDate: poForm.expectedDate || undefined, note: poForm.note.trim() || undefined, items }),
      });
      setNotice(dict.commerce.purchaseOrderDraftCreated);
      setRows([emptyRow()]); setPoForm({ supplierId: "", expectedDate: "", note: "" });
      await loadAll();
    } catch (err) { setError(err instanceof Error ? err.message : dict.commerce.creationFailed); }
    finally { setBusy(""); }
  }

  async function patchPo(po: PO, status: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`po-${po.id}`); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/purchase-orders/${po.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      setNotice(dict.commerce.statusUpdated);
      if (detail?.id === po.id) await openDetail(po);
      await loadAll();
    } catch (err) { setError(err instanceof Error ? err.message : dict.commerce.updateFailed2); }
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
    if (items.length === 0) { setError(dict.commerce.giveAReceiveQuantityOn); return; }
    setBusy("receive"); setError(""); setNotice("");
    try {
      const updated = await apiFetch<PO>(`/organizations/${orgId}/commerce/purchase-orders/${detail.id}/receive`, { method: "POST", body: JSON.stringify({ items }) });
      setDetail(updated);
      setNotice(dict.commerce.productReceiptRecordedStockUpdated);
      await loadAll();
    } catch (err) { setError(err instanceof Error ? err.message : dict.commerce.receiptRecordingFailed); }
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
      setNotice(t("commerce.draftPurchaseOrderCreated", { productName: s.productName }));
      await loadAll();
      setTab("orders");
    } catch (err) { setError(err instanceof Error ? err.message : dict.commerce.pOCreationFailed); }
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
      <button type="button" className="inline-flex min-h-[44px] items-center text-xs font-semibold text-blue-700" onClick={() => { setEditingSup(s); setSupForm({ name: s.name, phone: s.phone ?? "", email: s.email ?? "", address: s.address ?? "", note: s.note ?? "" }); }}>{dict.commerce.edit}</button>
      {s.active ? <button type="button" className="inline-flex min-h-[44px] items-center text-xs font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => deactivateSupplier(s)}>{dict.commerce.deactivate}</button> : null}
    </div>
  );
  const renderPoActions = (po: PO) => (
    <div className="flex flex-wrap gap-2">
      <button type="button" className="inline-flex min-h-[44px] items-center text-xs font-semibold text-blue-700" onClick={() => openDetail(po)}>{dict.commerce.detailsReceive}</button>
      {po.status === "draft" ? <>
        <button type="button" className="inline-flex min-h-[44px] items-center text-xs font-semibold text-indigo-700 disabled:opacity-50" disabled={busy !== ""} onClick={() => patchPo(po, "ordered")}>{dict.commerce.orderPlaced}</button>
        <button type="button" className="inline-flex min-h-[44px] items-center text-xs font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => patchPo(po, "cancelled")}>{dict.common.cancel}</button>
      </> : null}
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{dict.commerce.purchasing2}</h1>
        <p className="text-sm text-slate-500">{dict.commerce.suppliersPurchaseOrdersProductReceipt}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {tabBtn("suppliers", dict.commerce.supplier)}
        {tabBtn("orders", dict.commerce.purchaseOrder)}
        {tabBtn("suggestions", dict.commerce.reorderSuggestion)}
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      {tab === "suppliers" ? (
        <div className="space-y-4">
          <form onSubmit={saveSupplier} className="card grid gap-2 p-5 sm:grid-cols-3">
            <input aria-label={dict.commerce.supplierName} className="input" placeholder={dict.commerce.name2} value={supForm.name} onChange={(e) => setSupForm({ ...supForm, name: e.target.value })} required />
            <input aria-label={dict.commerce.supplierPhone} className="input" placeholder={dict.commerce.phone} value={supForm.phone} onChange={(e) => setSupForm({ ...supForm, phone: e.target.value })} />
            <input aria-label={dict.commerce.supplierEmail} className="input" placeholder={dict.commerce.email} value={supForm.email} onChange={(e) => setSupForm({ ...supForm, email: e.target.value })} />
            <input aria-label={dict.commerce.supplierAddress} className="input sm:col-span-2" placeholder={dict.commerce.address} value={supForm.address} onChange={(e) => setSupForm({ ...supForm, address: e.target.value })} />
            <input aria-label={dict.commerce.supplierNote} className="input" placeholder={dict.commerce.note} value={supForm.note} onChange={(e) => setSupForm({ ...supForm, note: e.target.value })} />
            <div className="flex gap-2 sm:col-span-3">
              <button className="btn-primary" disabled={busy !== ""}>{busy === "supplier" ? dict.commerce.ing : editingSup ? dict.commerce.update : dict.commerce.addSupplier}</button>
              {editingSup ? <button type="button" className="btn-secondary" onClick={() => { setEditingSup(null); setSupForm({ name: "", phone: "", email: "", address: "", note: "" }); }}>{dict.common.cancel}</button> : null}
            </div>
          </form>
          <div className="card p-5">
            {suppliers.length === 0 ? <p className="text-sm text-slate-500">{dict.commerce.noSuppliers}</p> : (
              <ResponsiveTable
                table={
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs text-slate-500"><th className="py-2 pr-3">{dict.commerce.name}</th><th className="py-2 pr-3">{dict.commerce.contact}</th><th className="py-2 pr-3">{dict.commerce.purchaseOrder}</th><th className="py-2 pr-3">{dict.commerce.status}</th><th className="py-2">{dict.commerce.action}</th></tr></thead>
                <tbody>{suppliers.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{s.name}{s.address ? <span className="block text-xs text-slate-500">{s.address}</span> : null}</td>
                    <td className="py-2 pr-3">{s.phone ?? "—"}{s.email ? <span className="block text-xs text-slate-500">{s.email}</span> : null}</td>
                    <td className="py-2 pr-3">{s.purchaseOrderCount ?? 0}{dict.commerce.text1ou8}</td>
                    <td className="py-2 pr-3"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${s.active ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}`}>{s.active ? dict.commerce.active : dict.commerce.inactive}</span></td>
                    <td className="py-2">{renderSupplierActions(s)}</td>
                  </tr>))}
                </tbody></table></div>
                }
                cards={suppliers.map((s) => (
                  <div key={s.id} className="rounded-xl border bg-white p-3 text-sm shadow-sm">
                    <dl className="space-y-1.5">
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.name}</dt><dd className="text-right font-medium">{s.name}{s.address ? <span className="block text-xs font-normal text-slate-500">{s.address}</span> : null}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.contact}</dt><dd className="text-right">{s.phone ?? "—"}{s.email ? <span className="block text-xs text-slate-500">{s.email}</span> : null}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.purchaseOrder}</dt><dd className="text-right">{s.purchaseOrderCount ?? 0}{dict.commerce.text1ou8}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.status}</dt><dd className="text-right"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${s.active ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}`}>{s.active ? dict.commerce.active : dict.commerce.inactive}</span></dd></div>
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
            <div className="font-semibold">{dict.commerce.newPurchaseOrderDraft}</div>
            <div className="grid gap-2 sm:grid-cols-3">
              <select className="input" value={poForm.supplierId} onChange={(e) => setPoForm({ ...poForm, supplierId: e.target.value })} required>
                <option value="">{dict.commerce.selectASupplier2}</option>
                {suppliers.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <label className="block text-sm">{dict.commerce.expectedDate}<input type="date" className="input mt-1" value={poForm.expectedDate} onChange={(e) => setPoForm({ ...poForm, expectedDate: e.target.value })} /></label>
              <input aria-label={dict.commerce.purchaseOrderNote} className="input self-end" placeholder={dict.commerce.note} value={poForm.note} onChange={(e) => setPoForm({ ...poForm, note: e.target.value })} />
            </div>
            <div className="space-y-2">
              {rows.map((r) => (
                <div key={r.key} className="grid gap-2 sm:grid-cols-5">
                  <select aria-label={dict.commerce.selectAProduct} className="input sm:col-span-2" value={r.productId} onChange={(e) => {
                    const pid = e.target.value;
                    setRows((prev) => prev.map((x) => (x.key === r.key ? { ...x, productId: pid, variantId: "", variants: [] } : x)));
                    const row = { ...r, productId: pid }; void loadVariants(row, pid);
                  }}>
                    <option value="">{dict.commerce.selectAProduct}</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ""}</option>)}
                  </select>
                  <select aria-label={dict.commerce.selectAVariant} className="input" value={r.variantId} onChange={(e) => setRows((prev) => prev.map((x) => (x.key === r.key ? { ...x, variantId: e.target.value } : x)))}>
                    <option value="">{dict.commerce.noVariantMainProduct}</option>
                    {r.variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                  <input aria-label={dict.commerce.quantity} className="input" type="number" min={1} placeholder={dict.commerce.quantity} value={r.qty} onChange={(e) => setRows((prev) => prev.map((x) => (x.key === r.key ? { ...x, qty: e.target.value } : x)))} />
                  <div className="flex gap-2">
                    <input aria-label={dict.commerce.unitPriceTaka} className="input" inputMode="decimal" placeholder={dict.commerce.unitPrice2} value={r.unitCostTaka} onChange={(e) => setRows((prev) => prev.map((x) => (x.key === r.key ? { ...x, unitCostTaka: e.target.value } : x)))} />
                    <button type="button" aria-label={dict.commerce.removeThisProductSLine} className="btn-ghost btn-sm inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-red-600" onClick={() => setRows((prev) => (prev.length > 1 ? prev.filter((x) => x.key !== r.key) : prev))}>✕</button>
                  </div>
                </div>
              ))}
              <button type="button" className="btn-secondary btn-sm" onClick={() => setRows((prev) => [...prev, emptyRow()])}>{dict.commerce.anotherProduct}</button>
            </div>
            <button className="btn-primary" disabled={busy !== ""}>{busy === "po-create" ? dict.commerce.creating : dict.commerce.createDraftPO}</button>
          </form>

          <div className="card p-5">
            {pos.length === 0 ? <p className="text-sm text-slate-500">{dict.commerce.noPurchaseOrders}</p> : (
              <ResponsiveTable
                table={
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs text-slate-500"><th className="py-2 pr-3">{dict.commerce.supplier}</th><th className="py-2 pr-3">{dict.commerce.status}</th><th className="py-2 pr-3">{dict.commerce.item}</th><th className="py-2 pr-3">{dict.commerce.orderTotal}</th><th className="py-2 pr-3">{dict.commerce.totalReceived}</th><th className="py-2">{dict.commerce.action}</th></tr></thead>
                <tbody>{pos.map((po) => (
                  <tr key={po.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{po.supplierName ?? po.supplierId}{po.expectedDate ? <span className="block text-xs text-slate-500">{dict.commerce.expected2}{fmtDate(locale, new Date(po.expectedDate))}</span> : null}</td>
                    <td className="py-2 pr-3"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${statusCls(po.status)}`}>{STATUS_BN[po.status] ? dict.commerce[STATUS_BN[po.status] as keyof typeof dict.commerce] : po.status}</span></td>
                    <td className="py-2 pr-3">{po.itemCount ?? po.items?.length ?? 0}{dict.commerce.text1ou8}</td>
                    <td className="py-2 pr-3">{formatMinorTaka(po.orderedTotalMinor)}</td>
                    <td className="py-2 pr-3">{formatMinorTaka(po.receivedTotalMinor)}</td>
                    <td className="py-2">{renderPoActions(po)}</td>
                  </tr>))}
                </tbody></table></div>
                }
                cards={pos.map((po) => (
                  <div key={po.id} className="rounded-xl border bg-white p-3 text-sm shadow-sm">
                    <dl className="space-y-1.5">
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.supplier}</dt><dd className="text-right font-medium">{po.supplierName ?? po.supplierId}{po.expectedDate ? <span className="block text-xs font-normal text-slate-500">{dict.commerce.expected2}{fmtDate(locale, new Date(po.expectedDate))}</span> : null}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.status}</dt><dd className="text-right"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${statusCls(po.status)}`}>{STATUS_BN[po.status] ? dict.commerce[STATUS_BN[po.status] as keyof typeof dict.commerce] : po.status}</span></dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.item}</dt><dd className="text-right">{po.itemCount ?? po.items?.length ?? 0}{dict.commerce.text1ou8}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.orderTotal}</dt><dd className="text-right">{formatMinorTaka(po.orderedTotalMinor)}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.totalReceived}</dt><dd className="text-right">{formatMinorTaka(po.receivedTotalMinor)}</dd></div>
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
                <div className="font-semibold">{dict.commerce.details2}{detail.supplierName ?? detail.supplierId} <span className={`ml-2 rounded px-2 py-0.5 text-xs font-semibold ${statusCls(detail.status)}`}>{STATUS_BN[detail.status] ? dict.commerce[STATUS_BN[detail.status] as keyof typeof dict.commerce] : detail.status}</span></div>
                <button type="button" className="btn-ghost btn-sm inline-flex min-h-[44px] items-center" onClick={() => setDetail(null)}>{dict.commerce.close}</button>
              </div>
              <ResponsiveTable
                table={
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs text-slate-500"><th className="py-2 pr-3">{dict.commerce.product}</th><th className="py-2 pr-3">{dict.commerce.order}</th><th className="py-2 pr-3">{dict.commerce.received}</th><th className="py-2 pr-3">{dict.commerce.due}</th><th className="py-2 pr-3">{dict.commerce.unitPrice}</th><th className="py-2 pr-3">{dict.commerce.receiveNow}</th><th className="py-2">{dict.commerce.priceOverride}</th></tr></thead>
                <tbody>{(detail.items ?? []).map((it) => (
                  <tr key={it.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{it.productName ?? it.productId}{it.variantName ? <span className="block text-xs text-slate-500">{it.variantName}</span> : null}{it.sku ? <span className="block text-xs text-slate-500">SKU: {it.sku}</span> : null}</td>
                    <td className="py-2 pr-3">{it.qtyOrdered}</td>
                    <td className="py-2 pr-3">{it.qtyReceived}</td>
                    <td className="py-2 pr-3 font-semibold">{it.remaining}</td>
                    <td className="py-2 pr-3">{it.unitCostMinor ? formatMinorTaka(it.unitCostMinor) : "—"}</td>
                    <td className="py-2 pr-3"><input aria-label={dict.commerce.receiveQuantityNow} className="input w-24" type="number" min={0} max={it.remaining} value={receiveQty[it.id] ?? ""} onChange={(e) => setReceiveQty({ ...receiveQty, [it.id]: e.target.value })} /></td>
                    <td className="py-2"><input aria-label={dict.commerce.priceOverrideTaka} className="input w-28" inputMode="decimal" placeholder={it.unitCostMinor ? minorToTakaString(it.unitCostMinor) : dict.commerce.optional} value={receiveCost[it.id] ?? ""} onChange={(e) => setReceiveCost({ ...receiveCost, [it.id]: e.target.value })} /></td>
                  </tr>))}
                </tbody></table></div>
                }
                cards={(detail.items ?? []).map((it) => (
                  <div key={it.id} className="rounded-xl border bg-white p-3 text-sm shadow-sm">
                    <dl className="space-y-1.5">
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.product}</dt><dd className="text-right font-medium">{it.productName ?? it.productId}{it.variantName ? <span className="block text-xs font-normal text-slate-500">{it.variantName}</span> : null}{it.sku ? <span className="block text-xs font-normal text-slate-500">SKU: {it.sku}</span> : null}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.order}</dt><dd className="text-right">{it.qtyOrdered}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.received}</dt><dd className="text-right">{it.qtyReceived}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.due}</dt><dd className="text-right font-semibold">{it.remaining}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.unitPrice}</dt><dd className="text-right">{it.unitCostMinor ? formatMinorTaka(it.unitCostMinor) : "—"}</dd></div>
                    </dl>
                    <label className="mt-2 block text-xs font-semibold text-slate-500">{dict.commerce.receiveNow}<input aria-label={dict.commerce.receiveQuantityNow} className="input mt-1 w-24" type="number" min={0} max={it.remaining} value={receiveQty[it.id] ?? ""} onChange={(e) => setReceiveQty({ ...receiveQty, [it.id]: e.target.value })} />
                    </label>
                    <label className="mt-2 block text-xs font-semibold text-slate-500">{dict.commerce.priceOverride}<input aria-label={dict.commerce.priceOverrideTaka} className="input mt-1 w-28" inputMode="decimal" placeholder={it.unitCostMinor ? minorToTakaString(it.unitCostMinor) : dict.commerce.optional} value={receiveCost[it.id] ?? ""} onChange={(e) => setReceiveCost({ ...receiveCost, [it.id]: e.target.value })} />
                    </label>
                  </div>
                ))}
              />
              {detail.status !== "received" && detail.status !== "cancelled" ? (
                <button type="button" className="btn-primary" disabled={busy !== ""} onClick={receivePo}>{busy === "receive" ? dict.commerce.recording : dict.commerce.recordReceipt}</button>
              ) : null}
              <p className="text-xs text-slate-500">{dict.commerce.whenAReceiptIsRecorded}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "suggestions" ? (
        <div className="card p-5">
          <div className="font-semibold">{dict.commerce.reorderSuggestion}</div>
          <p className="mt-1 text-sm text-slate-500">{dict.commerce.productsFallenBelowTheStock}</p>
          {suggestions.length === 0 ? <p className="mt-3 text-sm text-slate-500">{dict.commerce.noProductsNeedReorderingRight}</p> : (
            <ResponsiveTable
              table={
            <div className="mt-3 overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-slate-500"><th className="py-2 pr-3">{dict.commerce.product}</th><th className="py-2 pr-3">{dict.commerce.currentStock}</th><th className="py-2 pr-3">Threshold</th><th className="py-2 pr-3">{dict.commerce.suggestedQuantity}</th><th className="py-2 pr-3">{dict.commerce.lastSupplier}</th><th className="py-2">{dict.commerce.action}</th></tr></thead>
              <tbody>{suggestions.map((s) => (
                <tr key={`${s.productId}-${s.variantId ?? ""}`} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-medium">{s.productName}{s.variantName ? <span className="block text-xs text-slate-500">{s.variantName}</span> : null}{s.sku ? <span className="block text-xs text-slate-500">SKU: {s.sku}</span> : null}</td>
                  <td className="py-2 pr-3">{s.currentStock}</td>
                  <td className="py-2 pr-3">{s.threshold}</td>
                  <td className="py-2 pr-3 font-semibold">{s.suggestedQty}</td>
                  <td className="py-2 pr-3">{s.lastSupplier ? <>{s.lastSupplier.name}{s.lastUnitCostMinor ? <span className="block text-xs text-slate-500">{dict.commerce.lastPrice}{formatMinorTaka(s.lastUnitCostMinor)}</span> : null}</> : <span className="text-slate-400">{dict.commerce.unknown}</span>}</td>
                  <td className="py-2">
                    <button type="button" className="btn-primary btn-sm inline-flex min-h-[44px] items-center disabled:opacity-50" disabled={!s.lastSupplier || busy !== ""}
                      title={!s.lastSupplier ? dict.commerce.previousSupplierUnknown : undefined}
                      onClick={() => createPoFromSuggestion(s)}>
                      {busy === `sug-${s.productId}-${s.variantId ?? ""}` ? dict.commerce.creating : dict.commerce.createPO}
                    </button>
                    {!s.lastSupplier ? <span className="mt-1 block text-xs text-amber-700">{dict.commerce.previousSupplierUnknown}</span> : null}
                  </td>
                </tr>))}
              </tbody></table></div>
              }
              cards={suggestions.map((s) => (
                <div key={`${s.productId}-${s.variantId ?? ""}`} className="rounded-xl border bg-white p-3 text-sm shadow-sm">
                  <dl className="space-y-1.5">
                    <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.product}</dt><dd className="text-right font-medium">{s.productName}{s.variantName ? <span className="block text-xs font-normal text-slate-500">{s.variantName}</span> : null}{s.sku ? <span className="block text-xs font-normal text-slate-500">SKU: {s.sku}</span> : null}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.currentStock}</dt><dd className="text-right">{s.currentStock}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">Threshold</dt><dd className="text-right">{s.threshold}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.suggestedQuantity}</dt><dd className="text-right font-semibold">{s.suggestedQty}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.lastSupplier}</dt><dd className="text-right">{s.lastSupplier ? <>{s.lastSupplier.name}{s.lastUnitCostMinor ? <span className="block text-xs text-slate-500">{dict.commerce.lastPrice}{formatMinorTaka(s.lastUnitCostMinor)}</span> : null}</> : <span className="text-slate-400">{dict.commerce.unknown}</span>}</dd></div>
                  </dl>
                  <div className="mt-2">
                    <button type="button" className="btn-primary btn-sm inline-flex min-h-[44px] items-center disabled:opacity-50" disabled={!s.lastSupplier || busy !== ""}
                      title={!s.lastSupplier ? dict.commerce.previousSupplierUnknown : undefined}
                      onClick={() => createPoFromSuggestion(s)}>
                      {busy === `sug-${s.productId}-${s.variantId ?? ""}` ? dict.commerce.creating : dict.commerce.createPO}
                    </button>
                    {!s.lastSupplier ? <span className="mt-1 block text-xs text-amber-700">{dict.commerce.previousSupplierUnknown}</span> : null}
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
