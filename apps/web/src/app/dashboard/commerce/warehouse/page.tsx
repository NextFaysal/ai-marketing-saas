"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinorTaka } from "@/lib/storefront-money";

// EC21 + EC22 riders — Warehouses/bins, bin assignments, stock counts, rider board.

interface Warehouse { id: string; name: string; address?: string | null; isDefault: boolean; active: boolean; binCount?: number; assignmentCount?: number }
interface Bin { id: string; code: string; note?: string | null }
interface Assignment { id: string; warehouseId: string; binLocationId: string; binCode?: string | null; warehouseName?: string | null; productId: string; productName?: string | null; variantId?: string | null; variantName?: string | null }
interface CountLine { id: string; productId: string; productName?: string | null; variantId?: string | null; variantName?: string | null; systemQty: number; countedQty: number | null; variance: number | null }
interface CountSession { id: string; status: string; warehouseId: string; binLocationId?: string | null; lines?: CountLine[]; totals?: { lineCount: number; countedCount: number; skippedCount: number; totalVariance: number } }
interface ProductItem { id: string; name: string; sku?: string | null }
interface VariantItem { id: string; name: string; sku?: string | null }
interface Rider { id: string; name: string; phone?: string | null; active: boolean }
interface DeliveryAssignment { id: string; orderId: string; orderNumber?: string | null; orderStatus?: string | null; orderTotalMinor?: string; orderAddress?: string | null; riderId: string; riderName?: string | null; status: string; assignedAt?: string; note?: string | null }

const ASSIGN_STATUS_BN: Record<string, string> = { assigned: "বরাদ্দ হয়েছে", picked_up: "তোলা হয়েছে", delivered: "ডেলিভারি সম্পন্ন", returned: "ফেরত" };
function assignCls(s: string): string {
  switch (s) {
    case "assigned": return "bg-blue-100 text-blue-700";
    case "picked_up": return "bg-amber-100 text-amber-700";
    case "delivered": return "bg-green-100 text-green-700";
    case "returned": return "bg-red-100 text-red-700";
    default: return "bg-slate-200 text-slate-600";
  }
}

export default function WarehousePage() {
  const [tab, setTab] = useState<"warehouses" | "assignments" | "counts" | "riders">("warehouses");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [products, setProducts] = useState<ProductItem[]>([]);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [whForm, setWhForm] = useState({ name: "", address: "" });
  const [editingWh, setEditingWh] = useState<Warehouse | null>(null);
  const [selectedWh, setSelectedWh] = useState("");
  const [bins, setBins] = useState<Bin[]>([]);
  const [binForm, setBinForm] = useState({ code: "", note: "" });

  const [assignWh, setAssignWh] = useState("");
  const [assignBins, setAssignBins] = useState<Bin[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [assignForm, setAssignForm] = useState({ productId: "", variantId: "", binLocationId: "" });
  const [assignVariants, setAssignVariants] = useState<VariantItem[]>([]);
  const [checkedProducts, setCheckedProducts] = useState<Set<string>>(new Set());

  const [sessions, setSessions] = useState<CountSession[]>([]);
  const [countDetail, setCountDetail] = useState<CountSession | null>(null);
  const [countForm, setCountForm] = useState({ warehouseId: "", binLocationId: "" });
  const [countBins, setCountBins] = useState<Bin[]>([]);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [closeResult, setCloseResult] = useState<{ applied: { lineId: string; delta: number }[]; skipped: { lineId: string; reason: string }[] } | null>(null);

  const [riders, setRiders] = useState<Rider[]>([]);
  const [riderForm, setRiderForm] = useState({ name: "", phone: "" });
  const [editingRider, setEditingRider] = useState<Rider | null>(null);
  const [board, setBoard] = useState<DeliveryAssignment[]>([]);

  const org = () => getOrganizationId();

  const loadWarehouses = useCallback(async () => {
    const orgId = org(); if (!orgId) return;
    try {
      const data = (await apiFetch<{ items: Warehouse[] }>(`/organizations/${orgId}/commerce/warehouses`))?.items ?? [];
      setWarehouses(data);
      if (data?.length && !selectedWh) setSelectedWh(data.find((w) => w.isDefault)?.id ?? data[0].id);
      if (data?.length && !assignWh) setAssignWh(data.find((w) => w.isDefault)?.id ?? data[0].id);
      if (data?.length) setCountForm((f) => (f.warehouseId ? f : { ...f, warehouseId: data.find((w) => w.isDefault)?.id ?? data[0].id }));
    } catch (e) { setError(e instanceof Error ? e.message : "গুদাম লোড ব্যর্থ"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadBinsFor = useCallback(async (wid: string, setter: (b: Bin[]) => void) => {
    const orgId = org(); if (!orgId || !wid) { setter([]); return; }
    try { setter((await apiFetch<{ items: Bin[] }>(`/organizations/${orgId}/commerce/warehouses/${wid}/bins`))?.items ?? []); } catch { setter([]); }
  }, []);

  const loadAssignments = useCallback(async (wid: string) => {
    const orgId = org(); if (!orgId) return;
    try {
      const q = wid ? `?warehouseId=${encodeURIComponent(wid)}` : "";
      setAssignments((await apiFetch<{ items: Assignment[] }>(`/organizations/${orgId}/commerce/bin-assignments${q}`))?.items ?? []);
    } catch { setAssignments([]); }
  }, []);

  const loadCounts = useCallback(async () => {
    const orgId = org(); if (!orgId) return;
    try { setSessions((await apiFetch<{ items: CountSession[] }>(`/organizations/${orgId}/commerce/stock-counts`))?.items ?? []); } catch { setSessions([]); }
  }, []);

  const loadRiders = useCallback(async () => {
    const orgId = org(); if (!orgId) return;
    try {
      setRiders(await apiFetch<Rider[]>(`/organizations/${orgId}/delivery/riders`));
      const today = new Date().toISOString().slice(0, 10);
      setBoard(await apiFetch<DeliveryAssignment[]>(`/organizations/${orgId}/delivery/assignments?date=${today}`));
    } catch { /* riders optional */ }
  }, []);

  useEffect(() => {
    if (!org()) { setError("কোনো Organization নির্বাচিত নেই।"); return; }
    void loadWarehouses(); void loadCounts(); void loadRiders();
    (async () => {
      const orgId = org(); if (!orgId) return;
      try {
        const d = await apiFetch<{ total: number; items: ProductItem[] }>(`/organizations/${orgId}/products?pageSize=100`);
        setProducts(d.items ?? []);
      } catch { /* picker stays empty */ }
    })();
  }, [loadWarehouses, loadCounts, loadRiders]);

  useEffect(() => { if (selectedWh) void loadBinsFor(selectedWh, setBins); }, [selectedWh, loadBinsFor]);
  useEffect(() => { if (assignWh) { void loadBinsFor(assignWh, setAssignBins); void loadAssignments(assignWh); } }, [assignWh, loadBinsFor, loadAssignments]);
  useEffect(() => { if (countForm.warehouseId) void loadBinsFor(countForm.warehouseId, setCountBins); }, [countForm.warehouseId, loadBinsFor]);

  // ---- warehouses / bins ----
  async function saveWarehouse(e: React.FormEvent) {
    e.preventDefault(); const orgId = org(); if (!orgId) return;
    setBusy("wh"); setError(""); setNotice("");
    try {
      if (editingWh) {
        await apiFetch(`/organizations/${orgId}/commerce/warehouses/${editingWh.id}`, { method: "PATCH", body: JSON.stringify({ name: whForm.name.trim(), address: whForm.address.trim() || undefined }) });
        setNotice("গুদাম আপডেট হয়েছে।");
      } else {
        await apiFetch(`/organizations/${orgId}/commerce/warehouses`, { method: "POST", body: JSON.stringify({ name: whForm.name.trim(), address: whForm.address.trim() || undefined }) });
        setNotice("গুদাম তৈরি হয়েছে।");
      }
      setWhForm({ name: "", address: "" }); setEditingWh(null); await loadWarehouses();
    } catch (err) { setError(err instanceof Error ? err.message : "সংরক্ষণ ব্যর্থ"); }
    finally { setBusy(""); }
  }
  async function patchWarehouse(w: Warehouse, body: Record<string, unknown>, msg: string) {
    const orgId = org(); if (!orgId) return;
    setBusy(`wh-${w.id}`); setError(""); setNotice("");
    try { await apiFetch(`/organizations/${orgId}/commerce/warehouses/${w.id}`, { method: "PATCH", body: JSON.stringify(body) }); setNotice(msg); await loadWarehouses(); }
    catch (err) { setError(err instanceof Error ? err.message : "আপডেট ব্যর্থ"); }
    finally { setBusy(""); }
  }
  async function deleteWarehouse(w: Warehouse) {
    const orgId = org(); if (!orgId) return;
    setBusy(`wh-${w.id}`); setError("");
    try { await apiFetch(`/organizations/${orgId}/commerce/warehouses/${w.id}`, { method: "DELETE" }); setNotice("গুদাম নিষ্ক্রিয় করা হয়েছে।"); await loadWarehouses(); }
    catch (err) { setError(err instanceof Error ? err.message : "মুছতে ব্যর্থ"); }
    finally { setBusy(""); }
  }
  async function createBin(e: React.FormEvent) {
    e.preventDefault(); const orgId = org(); if (!orgId || !selectedWh) return;
    setBusy("bin"); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/warehouses/${selectedWh}/bins`, { method: "POST", body: JSON.stringify({ code: binForm.code.trim(), note: binForm.note.trim() || undefined }) });
      setBinForm({ code: "", note: "" }); setNotice("বিন তৈরি হয়েছে।");
      await loadBinsFor(selectedWh, setBins); await loadWarehouses();
    } catch (err) { setError(err instanceof Error ? err.message : "বিন তৈরি ব্যর্থ"); }
    finally { setBusy(""); }
  }
  async function deleteBin(b: Bin) {
    const orgId = org(); if (!orgId || !selectedWh) return;
    setBusy(`bin-${b.id}`); setError("");
    try { await apiFetch(`/organizations/${orgId}/commerce/warehouses/${selectedWh}/bins/${b.id}`, { method: "DELETE" }); await loadBinsFor(selectedWh, setBins); await loadWarehouses(); }
    catch (err) { setError(err instanceof Error ? err.message : "বিন মুছতে ব্যর্থ"); }
    finally { setBusy(""); }
  }

  // ---- assignments ----
  async function onAssignProduct(productId: string) {
    setAssignForm((f) => ({ ...f, productId, variantId: "" })); setAssignVariants([]);
    const orgId = org(); if (!orgId || !productId) return;
    try {
      const d = await apiFetch<ProductItem & { variants?: VariantItem[] }>(`/organizations/${orgId}/products/${productId}`);
      setAssignVariants(d.variants ?? []);
    } catch { /* base product only */ }
  }
  async function saveAssignment(e: React.FormEvent) {
    e.preventDefault(); const orgId = org(); if (!orgId) return;
    if (!assignWh || !assignForm.binLocationId || !assignForm.productId) { setError("গুদাম, বিন ও পণ্য বেছে নিন।"); return; }
    setBusy("assign"); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/bin-assignments`, { method: "POST", body: JSON.stringify({ warehouseId: assignWh, binLocationId: assignForm.binLocationId, productId: assignForm.productId, variantId: assignForm.variantId || undefined }) });
      setNotice("বরাদ্দ হয়েছে — একই পণ্য আগে অন্য বিনে থাকলে সেটি এখানে সরে এসেছে।");
      await loadAssignments(assignWh);
    } catch (err) { setError(err instanceof Error ? err.message : "বরাদ্দ ব্যর্থ"); }
    finally { setBusy(""); }
  }
  async function removeAssignment(a: Assignment) {
    const orgId = org(); if (!orgId) return;
    setBusy(`asg-${a.id}`); setError("");
    try { await apiFetch(`/organizations/${orgId}/commerce/bin-assignments/${a.id}`, { method: "DELETE" }); await loadAssignments(assignWh); }
    catch (err) { setError(err instanceof Error ? err.message : "মুছতে ব্যর্থ"); }
    finally { setBusy(""); }
  }

  // ---- stock counts ----
  async function createSession(e: React.FormEvent) {
    e.preventDefault(); const orgId = org(); if (!orgId || !countForm.warehouseId) return;
    setBusy("count-create"); setError(""); setNotice("");
    try {
      const s = await apiFetch<CountSession>(`/organizations/${orgId}/commerce/stock-counts`, { method: "POST", body: JSON.stringify({ warehouseId: countForm.warehouseId, binLocationId: countForm.binLocationId || undefined }) });
      setNotice("গণনা সেশন তৈরি হয়েছে।"); await loadCounts(); await openSession(s.id);
    } catch (err) { setError(err instanceof Error ? err.message : "সেশন তৈরি ব্যর্থ"); }
    finally { setBusy(""); }
  }
  async function openSession(id: string) {
    const orgId = org(); if (!orgId) return;
    try {
      const d = await apiFetch<CountSession>(`/organizations/${orgId}/commerce/stock-counts/${id}`);
      setCountDetail(d); setCloseResult(null);
      const map: Record<string, string> = {};
      for (const l of d.lines ?? []) map[l.id] = l.countedQty != null ? String(l.countedQty) : "";
      setCounted(map);
    } catch (err) { setError(err instanceof Error ? err.message : "সেশন লোড ব্যর্থ"); }
  }
  async function saveLine(line: CountLine) {
    const orgId = org(); if (!orgId || !countDetail) return;
    const raw = counted[line.id];
    if (raw === "" || raw == null) { setError("গণনা করা পরিমাণ লিখুন।"); return; }
    setBusy(`line-${line.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/stock-counts/${countDetail.id}/lines/${line.id}`, { method: "PATCH", body: JSON.stringify({ countedQty: Number(raw) }) });
      await openSession(countDetail.id);
    } catch (err) { setError(err instanceof Error ? err.message : "লাইন সংরক্ষণ ব্যর্থ"); }
    finally { setBusy(""); }
  }
  async function closeSession() {
    const orgId = org(); if (!orgId || !countDetail) return;
    setBusy("count-close"); setError(""); setNotice("");
    try {
      const out = await apiFetch<{ session: CountSession; applied: { lineId: string; delta: number }[]; skipped: { lineId: string; reason: string }[] }>(`/organizations/${orgId}/commerce/stock-counts/${countDetail.id}/close`, { method: "POST", body: JSON.stringify({}) });
      setCountDetail(out.session); setCloseResult({ applied: out.applied ?? [], skipped: out.skipped ?? [] });
      setNotice(`গণনা বন্ধ হয়েছে — ${out.applied?.length ?? 0}টি লাইনে স্টক সমন্বয় হয়েছে, ${out.skipped?.length ?? 0}টি বাদ গেছে।`);
      await loadCounts();
    } catch (err) { setError(err instanceof Error ? err.message : "বন্ধ করা ব্যর্থ"); }
    finally { setBusy(""); }
  }

  // ---- riders ----
  async function saveRider(e: React.FormEvent) {
    e.preventDefault(); const orgId = org(); if (!orgId) return;
    setBusy("rider"); setError(""); setNotice("");
    try {
      if (editingRider) {
        await apiFetch(`/organizations/${orgId}/delivery/riders/${editingRider.id}`, { method: "PATCH", body: JSON.stringify({ name: riderForm.name.trim(), phone: riderForm.phone.trim() || undefined }) });
        setNotice("রাইডার আপডেট হয়েছে।");
      } else {
        await apiFetch(`/organizations/${orgId}/delivery/riders`, { method: "POST", body: JSON.stringify({ name: riderForm.name.trim(), phone: riderForm.phone.trim() || undefined }) });
        setNotice("রাইডার যোগ হয়েছে।");
      }
      setRiderForm({ name: "", phone: "" }); setEditingRider(null); await loadRiders();
    } catch (err) { setError(err instanceof Error ? err.message : "সংরক্ষণ ব্যর্থ"); }
    finally { setBusy(""); }
  }
  async function toggleRider(r: Rider) {
    const orgId = org(); if (!orgId) return;
    setBusy(`rider-${r.id}`); setError("");
    try { await apiFetch(`/organizations/${orgId}/delivery/riders/${r.id}`, { method: "PATCH", body: JSON.stringify({ active: !r.active }) }); await loadRiders(); }
    catch (err) { setError(err instanceof Error ? err.message : "আপডেট ব্যর্থ"); }
    finally { setBusy(""); }
  }
  async function transition(a: DeliveryAssignment, status: string) {
    const orgId = org(); if (!orgId) return;
    setBusy(`asg-${a.id}`); setError(""); setNotice("");
    try { await apiFetch(`/organizations/${orgId}/delivery/assignments/${a.id}/transition`, { method: "POST", body: JSON.stringify({ status }) }); await loadRiders(); }
    catch (err) { setError(err instanceof Error ? err.message : "অবস্থা বদল ব্যর্থ"); }
    finally { setBusy(""); }
  }

  const tabBtn = (key: typeof tab, label: string) => (
    <button type="button" key={key} onClick={() => setTab(key)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === key ? "bg-slate-900 text-white" : "border bg-white"}`}>{label}</button>
  );
  const boardByRider = new Map<string, DeliveryAssignment[]>();
  for (const a of board) { const arr = boardByRider.get(a.riderName ?? a.riderId) ?? []; arr.push(a); boardByRider.set(a.riderName ?? a.riderId, arr); }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">🏭 গুদাম / Warehouse</h1>
        <p className="text-sm text-slate-500">গুদাম, বিন বরাদ্দ, স্টক গণনা আর নিজস্ব রাইডার ডেলিভারি বোর্ড।</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {tabBtn("warehouses", "গুদাম ও বিন")}
        {tabBtn("assignments", "বিন বরাদ্দ")}
        {tabBtn("counts", "স্টক গণনা")}
        {tabBtn("riders", "রাইডার")}
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      {tab === "warehouses" ? (
        <div className="space-y-4">
          <form onSubmit={saveWarehouse} className="card grid gap-2 p-5 sm:grid-cols-3">
            <input className="input" placeholder="গুদামের নাম *" value={whForm.name} onChange={(e) => setWhForm({ ...whForm, name: e.target.value })} required />
            <input className="input sm:col-span-2" placeholder="ঠিকানা" value={whForm.address} onChange={(e) => setWhForm({ ...whForm, address: e.target.value })} />
            <div className="flex gap-2">
              <button className="btn-primary" disabled={busy !== ""}>{busy === "wh" ? "হচ্ছে…" : editingWh ? "আপডেট করুন" : "গুদাম যোগ করুন"}</button>
              {editingWh ? <button type="button" className="btn-secondary" onClick={() => { setEditingWh(null); setWhForm({ name: "", address: "" }); }}>বাতিল</button> : null}
            </div>
          </form>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card p-5">
              <div className="font-semibold">গুদামসমূহ</div>
              <ul className="mt-3 space-y-2">
                {warehouses.map((w) => (
                  <li key={w.id} className={`rounded-lg border p-3 ${selectedWh === w.id ? "border-slate-900" : ""}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button type="button" className="font-medium" onClick={() => setSelectedWh(w.id)}>{w.name} {w.isDefault ? <span className="ml-1 rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">ডিফল্ট</span> : null} {!w.active ? <span className="ml-1 rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">নিষ্ক্রিয়</span> : null}</button>
                      <span className="text-xs text-slate-500">বিন {w.binCount ?? 0} · বরাদ্দ {w.assignmentCount ?? 0}</span>
                    </div>
                    {w.address ? <p className="mt-1 text-xs text-slate-500">{w.address}</p> : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {!w.isDefault && w.active ? <button type="button" className="text-xs font-semibold text-indigo-700 disabled:opacity-50" disabled={busy !== ""} onClick={() => patchWarehouse(w, { isDefault: true }, "ডিফল্ট গুদাম বদলেছে।")}>ডিফল্ট করুন</button> : null}
                      <button type="button" className="text-xs font-semibold text-blue-700" onClick={() => { setEditingWh(w); setWhForm({ name: w.name, address: w.address ?? "" }); }}>সম্পাদনা</button>
                      {w.active ? <button type="button" className="text-xs font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => deleteWarehouse(w)}>নিষ্ক্রিয় করুন</button> : null}
                    </div>
                  </li>
                ))}
                {warehouses.length === 0 ? <li className="text-sm text-slate-500">কোনো গুদাম নেই।</li> : null}
              </ul>
            </div>
            <div className="card p-5">
              <div className="font-semibold">বিন — {warehouses.find((w) => w.id === selectedWh)?.name ?? "গুদাম বেছে নিন"}</div>
              <form onSubmit={createBin} className="mt-3 grid gap-2 sm:grid-cols-3">
                <input className="input" placeholder="বিন কোড (যেমন A-01) *" value={binForm.code} onChange={(e) => setBinForm({ ...binForm, code: e.target.value })} required />
                <input className="input" placeholder="নোট" value={binForm.note} onChange={(e) => setBinForm({ ...binForm, note: e.target.value })} />
                <button className="btn-primary" disabled={busy !== "" || !selectedWh}>বিন যোগ করুন</button>
              </form>
              <ul className="mt-3 space-y-1.5">
                {bins.map((b) => (
                  <li key={b.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <span className="font-mono font-semibold">{b.code}</span>
                    <span className="text-xs text-slate-500">{b.note ?? ""}</span>
                    <button type="button" className="text-xs font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => deleteBin(b)}>মুছুন</button>
                  </li>
                ))}
                {bins.length === 0 ? <li className="text-sm text-slate-500">এই গুদামে কোনো বিন নেই।</li> : null}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      {tab === "assignments" ? (
        <div className="space-y-4">
          <div className="card space-y-3 p-5">
            <div className="flex flex-wrap items-end gap-3">
              <label className="block text-sm">গুদাম
                <select className="input mt-1" value={assignWh} onChange={(e) => setAssignWh(e.target.value)}>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </label>
              {checkedProducts.size > 0 ? (
                <Link href={`/dashboard/commerce/warehouse/labels?productIds=${[...checkedProducts].join(",")}`} className="btn-secondary btn-sm">🏷️ বেছে নেওয়া {checkedProducts.size}টি পণ্যের লেবেল</Link>
              ) : null}
            </div>
            <form onSubmit={saveAssignment} className="grid gap-2 sm:grid-cols-4">
              <select className="input" value={assignForm.productId} onChange={(e) => void onAssignProduct(e.target.value)} required>
                <option value="">পণ্য বেছে নিন</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ""}</option>)}
              </select>
              <select className="input" value={assignForm.variantId} onChange={(e) => setAssignForm({ ...assignForm, variantId: e.target.value })}>
                <option value="">মূল পণ্য</option>
                {assignVariants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              <select className="input" value={assignForm.binLocationId} onChange={(e) => setAssignForm({ ...assignForm, binLocationId: e.target.value })} required>
                <option value="">বিন বেছে নিন</option>
                {assignBins.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
              </select>
              <button className="btn-primary" disabled={busy !== ""}>{busy === "assign" ? "হচ্ছে…" : "বরাদ্দ করুন"}</button>
            </form>
            <p className="text-xs text-slate-400">একই পণ্য আবার বরাদ্দ করলে সেটি আগের বিন থেকে নতুন বিনে সরে যায় (MOVE)।</p>
          </div>
          <div className="card p-5">
            {assignments.length === 0 ? <p className="text-sm text-slate-500">এই গুদামে কোনো বরাদ্দ নেই।</p> : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs text-slate-500"><th className="py-2 pr-2">লেবেল</th><th className="py-2 pr-3">পণ্য</th><th className="py-2 pr-3">বিন</th><th className="py-2 pr-3">গুদাম</th><th className="py-2">অ্যাকশন</th></tr></thead>
                <tbody>{assignments.map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="py-2 pr-2"><input type="checkbox" checked={checkedProducts.has(a.productId)} onChange={(e) => setCheckedProducts((prev) => { const n = new Set(prev); if (e.target.checked) n.add(a.productId); else n.delete(a.productId); return n; })} /></td>
                    <td className="py-2 pr-3 font-medium">{a.productName ?? a.productId}{a.variantName ? <span className="block text-xs text-slate-400">{a.variantName}</span> : null}</td>
                    <td className="py-2 pr-3 font-mono">{a.binCode ?? a.binLocationId}</td>
                    <td className="py-2 pr-3">{a.warehouseName ?? ""}</td>
                    <td className="py-2"><div className="flex flex-wrap gap-2">
                      <Link href={`/dashboard/commerce/warehouse/labels?warehouseId=${a.warehouseId}&binId=${a.binLocationId}`} className="text-xs font-semibold text-indigo-700">🏷️ লেবেল প্রিন্ট</Link>
                      <button type="button" className="text-xs font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => removeAssignment(a)}>মুছুন</button>
                    </div></td>
                  </tr>))}
                </tbody></table></div>
            )}
            {assignBins.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2 border-t pt-3">
                <span className="text-sm font-medium">বিন অনুযায়ী লেবেল:</span>
                {assignBins.map((b) => (
                  <Link key={b.id} href={`/dashboard/commerce/warehouse/labels?warehouseId=${assignWh}&binId=${b.id}`} className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold">🏷️ {b.code}</Link>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === "counts" ? (
        <div className="space-y-4">
          <form onSubmit={createSession} className="card flex flex-wrap items-end gap-3 p-5">
            <label className="block text-sm">গুদাম
              <select className="input mt-1" value={countForm.warehouseId} onChange={(e) => setCountForm({ warehouseId: e.target.value, binLocationId: "" })}>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>
            <label className="block text-sm">বিন (ঐচ্ছিক)
              <select className="input mt-1" value={countForm.binLocationId} onChange={(e) => setCountForm({ ...countForm, binLocationId: e.target.value })}>
                <option value="">পুরো গুদাম</option>
                {countBins.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
              </select>
            </label>
            <button className="btn-primary" disabled={busy !== "" || !countForm.warehouseId}>নতুন গণনা শুরু করুন</button>
          </form>
          <div className="card p-5">
            <div className="font-semibold">গণনা সেশনসমূহ</div>
            <ul className="mt-2 space-y-1.5">
              {sessions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span>{warehouses.find((w) => w.id === s.warehouseId)?.name ?? s.warehouseId} · <span className="font-medium">{s.status}</span>{s.totals ? ` · লাইন ${s.totals.lineCount}, গণনা ${s.totals.countedCount}` : ""}</span>
                  <button type="button" className="text-xs font-semibold text-blue-700" onClick={() => openSession(s.id)}>খুলুন</button>
                </li>
              ))}
              {sessions.length === 0 ? <li className="text-sm text-slate-500">কোনো সেশন নেই।</li> : null}
            </ul>
          </div>
          {countDetail ? (
            <div className="card space-y-3 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold">সেশন বিস্তারিত — অবস্থা: {countDetail.status}</div>
                <button type="button" className="btn-ghost btn-sm" onClick={() => setCountDetail(null)}>বন্ধ করুন</button>
              </div>
              {countDetail.totals ? <p className="text-sm text-slate-600">মোট লাইন {countDetail.totals.lineCount} · গণনা হয়েছে {countDetail.totals.countedCount} · বাদ {countDetail.totals.skippedCount} · মোট পার্থক্য {countDetail.totals.totalVariance}</p> : null}
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs text-slate-500"><th className="py-2 pr-3">পণ্য</th><th className="py-2 pr-3">সিস্টেমে</th><th className="py-2 pr-3">গণনা করা</th><th className="py-2 pr-3">পার্থক্য</th><th className="py-2">সংরক্ষণ</th></tr></thead>
                <tbody>{(countDetail.lines ?? []).map((l) => (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{l.productName ?? l.productId}{l.variantName ? <span className="block text-xs text-slate-400">{l.variantName}</span> : null}</td>
                    <td className="py-2 pr-3">{l.systemQty}</td>
                    <td className="py-2 pr-3"><input className="input w-24" type="number" min={0} value={counted[l.id] ?? ""} onChange={(e) => setCounted({ ...counted, [l.id]: e.target.value })} disabled={countDetail.status === "closed"} /></td>
                    <td className="py-2 pr-3">{l.variance == null ? "—" : <span className={l.variance === 0 ? "text-green-700" : "font-semibold text-red-600"}>{l.variance > 0 ? `+${l.variance}` : l.variance}</span>}</td>
                    <td className="py-2">{countDetail.status !== "closed" ? <button type="button" className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => saveLine(l)}>সংরক্ষণ</button> : null}</td>
                  </tr>))}
                </tbody></table></div>
              {closeResult ? (
                <div className="rounded-lg bg-slate-50 p-3 text-sm">
                  <p className="font-semibold">বন্ধের ফলাফল</p>
                  <p>প্রয়োগ হয়েছে: {closeResult.applied.length}টি লাইন{closeResult.applied.length ? ` (ডেল্টা: ${closeResult.applied.map((a) => a.delta).join(", ")})` : ""}</p>
                  <p>বাদ গেছে: {closeResult.skipped.length}টি{closeResult.skipped.length ? ` — ${closeResult.skipped.map((s) => s.reason).join("; ")}` : ""}</p>
                </div>
              ) : null}
              {countDetail.status !== "closed" ? (
                <button type="button" className="btn-primary" disabled={busy !== ""} onClick={closeSession}>{busy === "count-close" ? "বন্ধ হচ্ছে…" : "গণনা বন্ধ করুন (স্টক সমন্বয় প্রয়োগ)"}</button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "riders" ? (
        <div className="space-y-4">
          <form onSubmit={saveRider} className="card grid gap-2 p-5 sm:grid-cols-3">
            <input className="input" placeholder="রাইডারের নাম *" value={riderForm.name} onChange={(e) => setRiderForm({ ...riderForm, name: e.target.value })} required />
            <input className="input" placeholder="ফোন" value={riderForm.phone} onChange={(e) => setRiderForm({ ...riderForm, phone: e.target.value })} />
            <div className="flex gap-2">
              <button className="btn-primary" disabled={busy !== ""}>{editingRider ? "আপডেট করুন" : "রাইডার যোগ করুন"}</button>
              {editingRider ? <button type="button" className="btn-secondary" onClick={() => { setEditingRider(null); setRiderForm({ name: "", phone: "" }); }}>বাতিল</button> : null}
            </div>
          </form>
          <div className="card p-5">
            <div className="font-semibold">রাইডার তালিকা</div>
            <ul className="mt-2 space-y-1.5">
              {riders.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span className="font-medium">{r.name} <span className="text-slate-500">{r.phone ?? ""}</span> <span className={`ml-1 rounded px-2 py-0.5 text-xs font-semibold ${r.active ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}`}>{r.active ? "সক্রিয়" : "নিষ্ক্রিয়"}</span></span>
                  <span className="flex gap-2">
                    <button type="button" className="text-xs font-semibold text-blue-700" onClick={() => { setEditingRider(r); setRiderForm({ name: r.name, phone: r.phone ?? "" }); }}>সম্পাদনা</button>
                    <button type="button" className="text-xs font-semibold text-slate-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => toggleRider(r)}>{r.active ? "নিষ্ক্রিয় করুন" : "সক্রিয় করুন"}</button>
                  </span>
                </li>
              ))}
              {riders.length === 0 ? <li className="text-sm text-slate-500">কোনো রাইডার নেই। অর্ডার পেজ থেকে অর্ডারে রাইডার বরাদ্দ করা যায়।</li> : null}
            </ul>
          </div>
          <div className="card p-5">
            <div className="font-semibold">আজকের বোর্ড — {new Date().toLocaleDateString("bn-BD")}</div>
            {board.length === 0 ? <p className="mt-2 text-sm text-slate-500">আজ কোনো ডেলিভারি বরাদ্দ নেই।</p> : (
              <div className="mt-3 space-y-4">
                {[...boardByRider.entries()].map(([riderName, list]) => (
                  <div key={riderName}>
                    <div className="text-sm font-semibold">{riderName} — {list.length}টি ডেলিভারি</div>
                    <div className="mt-2 space-y-2">
                      {list.map((a) => (
                        <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
                          <div>
                            <span className="font-semibold">#{a.orderNumber ?? a.orderId.slice(0, 8)}</span>
                            <span className={`ml-2 rounded px-2 py-0.5 text-xs font-semibold ${assignCls(a.status)}`}>{ASSIGN_STATUS_BN[a.status] ?? a.status}</span>
                            <span className="mt-1 block text-xs text-slate-500">{a.orderAddress ?? ""} · মোট {a.orderTotalMinor ? formatMinorTaka(a.orderTotalMinor) : "—"}</span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {a.status === "assigned" ? <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => transition(a, "picked_up")}>তোলা হয়েছে</button> : null}
                            {a.status === "picked_up" ? <>
                              <button type="button" className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" disabled={busy !== ""} onClick={() => transition(a, "delivered")}>ডেলিভারি সম্পন্ন</button>
                              <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => transition(a, "returned")}>ফেরত</button>
                            </> : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
