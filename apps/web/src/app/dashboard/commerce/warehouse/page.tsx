"use client";
import React, { useCallback, useEffect, useState } from "react";
import { fmtDate, fmtDateTime, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import Link from "next/link";
import { apiFetch, API_URL } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinorTaka } from "@/lib/storefront-money";
import {
  buildReceiveLines, countScopeLabel, parseDistrictInput,
  transferLineVariance, transferStatusCls, transferStatusLabel,
} from "@/lib/warehouse-ab3";
import { ResponsiveTable } from "@repo/ui";

// EC21 + EC22 riders — Warehouses/bins, bin assignments, stock counts, rider board.

interface Warehouse { id: string; name: string; address?: string | null; isDefault: boolean; active: boolean; binCount?: number; assignmentCount?: number; priority?: number; serviceDistricts?: string[] | null }
interface Bin { id: string; code: string; note?: string | null }
interface Assignment { id: string; warehouseId: string; binLocationId: string; binCode?: string | null; warehouseName?: string | null; productId: string; productName?: string | null; variantId?: string | null; variantName?: string | null }
interface CountLine { id: string; productId: string; productName?: string | null; variantId?: string | null; variantName?: string | null; systemQty: number; countedQty: number | null; variance: number | null }
interface CountSession { id: string; status: string; warehouseId: string; binLocationId?: string | null; scope?: string | null; binCode?: string | null; lineCount?: number; countedCount?: number; lines?: CountLine[]; totals?: { lineCount: number; countedCount: number; skippedCount: number; totalVariance: number } }
// AB3 (AX4): stock balances / by-location / transfers payloads.
interface StockBalance { productId: string; productName?: string | null; sku?: string | null; variantId?: string | null; variantName?: string | null; warehouseId?: string | null; warehouseName?: string | null; binId?: string | null; binCode?: string | null; onHand: number; reserved: number; seeded: boolean }
interface LocationRow { productId: string; productName?: string | null; variantId?: string | null; variantName?: string | null; warehouseId?: string | null; warehouseName?: string | null; onHand: number; reserved: number; inTransitOut: number }
interface TransferLine { id: string; productId: string; productName?: string | null; variantId?: string | null; variantName?: string | null; sku?: string | null; qtySent: number; qtyReceived: number | null }
interface TransferRow { id: string; status: string; fromBinId: string; toBinId: string; fromBinCode?: string | null; fromWarehouseName?: string | null; toBinCode?: string | null; toWarehouseName?: string | null; note?: string | null; createdAt?: string; dispatchedAt?: string | null; receivedAt?: string | null; lineCount: number; totalQtySent: number; totalQtyReceived?: number; varianceQty?: number; lines?: TransferLine[] }
interface AllBin { id: string; code: string; warehouseId: string; warehouseName: string }
interface TransferDraftLine { productId: string; variantId: string; qty: string }
interface ProductItem { id: string; name: string; sku?: string | null }
interface VariantItem { id: string; name: string; sku?: string | null }
interface Rider { id: string; name: string; phone?: string | null; active: boolean }
interface DeliveryAssignment { id: string; orderId: string; orderNumber?: string | null; orderStatus?: string | null; orderTotalMinor?: string; orderAddress?: string | null; riderId: string; riderName?: string | null; status: string; assignedAt?: string; note?: string | null }

const ASSIGN_STATUS_BN: Record<string, string> = { assigned: "allocated", picked_up: "picked", delivered: "deliveryComplete", returned: "refund" };
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
  const { dict, t, locale } = useLocale();
  const [tab, setTab] = useState<"warehouses" | "assignments" | "counts" | "stock" | "transfers" | "riders">("warehouses");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [products, setProducts] = useState<ProductItem[]>([]);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [whForm, setWhForm] = useState({ name: "", address: "", priority: "0", districtsText: "" });

  // AB3 state: balances, by-location, transfers, all-org bins.
  const [balances, setBalances] = useState<StockBalance[] | null>(null);
  const [balanceTotals, setBalanceTotals] = useState<{ totalOnHand: number; totalReserved: number } | null>(null);
  const [locationRows, setLocationRows] = useState<LocationRow[] | null>(null);
  const [locationTotals, setLocationTotals] = useState<{ totalOnHand: number; totalReserved: number; totalInTransit: number } | null>(null);
  const [allBins, setAllBins] = useState<AllBin[]>([]);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [transferDetail, setTransferDetail] = useState<TransferRow | null>(null);
  const [transferForm, setTransferForm] = useState<{ fromBinId: string; toBinId: string; note: string; lines: TransferDraftLine[] }>({ fromBinId: "", toBinId: "", note: "", lines: [{ productId: "", variantId: "", qty: "1" }] });
  const [lineVariants, setLineVariants] = useState<Record<number, VariantItem[]>>({});
  const [receiveInputs, setReceiveInputs] = useState<Record<string, string>>({});
  const [csvBusy, setCsvBusy] = useState(false);
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
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.warehouseLoadingFailed); }
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

  // ---- AB3: balances / by-location / transfers ----
  const loadBalances = useCallback(async () => {
    const orgId = org(); if (!orgId) return;
    try {
      const d = await apiFetch<{ items: StockBalance[]; orgTotals: { totalOnHand: number; totalReserved: number } }>(`/organizations/${orgId}/commerce/stock-balances`);
      setBalances(d.items ?? []); setBalanceTotals(d.orgTotals ?? null);
    } catch { setBalances([]); }
  }, []);
  const loadByLocation = useCallback(async () => {
    const orgId = org(); if (!orgId) return;
    try {
      const d = await apiFetch<{ items: LocationRow[]; orgTotals: { totalOnHand: number; totalReserved: number; totalInTransit: number } }>(`/organizations/${orgId}/commerce/stock-by-location`);
      setLocationRows(d.items ?? []); setLocationTotals(d.orgTotals ?? null);
    } catch { setLocationRows([]); }
  }, []);
  const loadAllBins = useCallback(async (whs: Warehouse[]) => {
    const orgId = org(); if (!orgId) return;
    const out: AllBin[] = [];
    for (const w of whs) {
      try {
        const d = await apiFetch<{ items: Bin[] }>(`/organizations/${orgId}/commerce/warehouses/${w.id}/bins`);
        for (const b of d.items ?? []) out.push({ id: b.id, code: b.code, warehouseId: w.id, warehouseName: w.name });
      } catch { /* bins of this warehouse stay unlisted */ }
    }
    setAllBins(out);
  }, []);
  const loadTransfers = useCallback(async () => {
    const orgId = org(); if (!orgId) return;
    try { setTransfers((await apiFetch<{ items: TransferRow[] }>(`/organizations/${orgId}/commerce/stock-transfers`))?.items ?? []); } catch { setTransfers([]); }
  }, []);
  async function openTransfer(id: string) {
    const orgId = org(); if (!orgId) return;
    setBusy(`tr-open-${id}`); setError("");
    try {
      const d = await apiFetch<TransferRow>(`/organizations/${orgId}/commerce/stock-transfers/${id}`);
      setTransferDetail(d);
      const inputs: Record<string, string> = {};
      for (const l of d.lines ?? []) inputs[l.id] = l.qtyReceived != null ? String(l.qtyReceived) : String(l.qtySent);
      setReceiveInputs(inputs);
    } catch (err) { setError(err instanceof Error ? err.message : dict.commerce.transferLoadingFailed); }
    finally { setBusy(""); }
  }
  async function refreshStock() { await Promise.all([loadBalances(), loadByLocation(), loadTransfers()]); }
  async function transferAction(t: TransferRow, action: "dispatch" | "cancel") {
    const orgId = org(); if (!orgId) return;
    setBusy(`tr-${action}-${t.id}`); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/stock-transfers/${t.id}/${action}`, { method: "POST", body: JSON.stringify({}) });
      setNotice(action === "dispatch" ? dict.commerce.transferDispatchedStockIsNow : dict.commerce.transferCancelled);
      await refreshStock();
      if (transferDetail?.id === t.id) await openTransfer(t.id);
    } catch (err) { setError(err instanceof Error ? err.message : dict.commerce.actionFailed); }
    finally { setBusy(""); }
  }
  async function receiveTransfer(t: TransferRow) {
    const orgId = org(); if (!orgId || !t.lines) return;
    setBusy(`tr-receive-${t.id}`); setError(""); setNotice("");
    try {
      const lines = buildReceiveLines(t.lines, receiveInputs);
      await apiFetch(`/organizations/${orgId}/commerce/stock-transfers/${t.id}/receive`, { method: "POST", body: JSON.stringify({ lines }) });
      setNotice(dict.commerce.transferReceiptCompleted);
      await refreshStock(); await openTransfer(t.id);
    } catch (err) { setError(err instanceof Error ? err.message : dict.commerce.receiptFailed); }
    finally { setBusy(""); }
  }
  async function onTransferProduct(idx: number, productId: string) {
    setTransferForm((f) => { const lines = f.lines.slice(); lines[idx] = { ...lines[idx], productId, variantId: "" }; return { ...f, lines }; });
    const orgId = org(); if (!orgId || !productId) return;
    try {
      const d = await apiFetch<ProductItem & { variants?: VariantItem[] }>(`/organizations/${orgId}/products/${productId}`);
      setLineVariants((m) => ({ ...m, [idx]: d.variants ?? [] }));
    } catch { setLineVariants((m) => ({ ...m, [idx]: [] })); }
  }
  async function createTransfer(e: React.FormEvent) {
    e.preventDefault(); const orgId = org(); if (!orgId) return;
    if (!transferForm.fromBinId || !transferForm.toBinId) { setError(dict.commerce.selectTheSourceDestinationBins); return; }
    const lines = transferForm.lines.filter((l) => l.productId).map((l) => ({ productId: l.productId, variantId: l.variantId || undefined, qtySent: Number(l.qty) }));
    if (lines.length === 0 || lines.some((l) => !Number.isInteger(l.qtySent) || l.qtySent < 1)) { setError(dict.commerce.giveAProductAWhole); return; }
    setBusy("tr-create"); setError(""); setNotice("");
    try {
      const created = await apiFetch<TransferRow>(`/organizations/${orgId}/commerce/stock-transfers`, { method: "POST", body: JSON.stringify({ fromBinId: transferForm.fromBinId, toBinId: transferForm.toBinId, note: transferForm.note.trim() || undefined, lines }) });
      setNotice(dict.commerce.draftTransferCreatedNoStock);
      setTransferForm({ fromBinId: transferForm.fromBinId, toBinId: "", note: "", lines: [{ productId: "", variantId: "", qty: "1" }] });
      setLineVariants({});
      await loadTransfers(); await openTransfer(created.id);
    } catch (err) { setError(err instanceof Error ? err.message : dict.commerce.transferCreationFailed); }
    finally { setBusy(""); }
  }
  async function downloadLocationCsv() {
    const orgId = org(); if (!orgId) return;
    setCsvBusy(true); setError("");
    try {
      // Same authenticated-blob download idiom as the billing
      // invoice PDF: apiFetch cannot return a CSV body.
      const token = localStorage.getItem("accessToken");
      const res = await fetch(`${API_URL}/organizations/${orgId}/commerce/stock-by-location.csv`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) { setError(dict.commerce.couldNotDownloadCSV); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "stock-by-location.csv";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch { setError(dict.commerce.couldNotDownloadCSV); }
    finally { setCsvBusy(false); }
  }

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
    if (!org()) { setError(dict.commerce.noOrganizationSelected); return; }
    void loadWarehouses(); void loadCounts(); void loadRiders();
    void loadBalances(); void loadByLocation(); void loadTransfers();
    (async () => {
      const orgId = org(); if (!orgId) return;
      try {
        const d = await apiFetch<{ total: number; items: ProductItem[] }>(`/organizations/${orgId}/products?pageSize=100`);
        setProducts(d.items ?? []);
      } catch { /* picker stays empty */ }
    })();
  }, [loadWarehouses, loadCounts, loadRiders, loadBalances, loadByLocation, loadTransfers]);

  useEffect(() => { if (warehouses.length) void loadAllBins(warehouses); }, [warehouses, loadAllBins]);

  useEffect(() => { if (selectedWh) void loadBinsFor(selectedWh, setBins); }, [selectedWh, loadBinsFor]);
  useEffect(() => { if (assignWh) { void loadBinsFor(assignWh, setAssignBins); void loadAssignments(assignWh); } }, [assignWh, loadBinsFor, loadAssignments]);
  useEffect(() => { if (countForm.warehouseId) void loadBinsFor(countForm.warehouseId, setCountBins); }, [countForm.warehouseId, loadBinsFor]);

  // ---- warehouses / bins ----
  async function saveWarehouse(e: React.FormEvent) {
    e.preventDefault(); const orgId = org(); if (!orgId) return;
    setBusy("wh"); setError(""); setNotice("");
    const priority = Number(whForm.priority);
    if (!Number.isInteger(priority) || priority < 0) { setError(dict.commerce.priorityMustBeAWhole); setBusy(""); return; }
    // The API validates + canonicalizes district names against
    // the BD vocabulary; its Bengali error is shown as-is below.
    const serviceDistricts = parseDistrictInput(whForm.districtsText);
    try {
      if (editingWh) {
        await apiFetch(`/organizations/${orgId}/commerce/warehouses/${editingWh.id}`, { method: "PATCH", body: JSON.stringify({ name: whForm.name.trim(), address: whForm.address.trim() || undefined, priority, serviceDistricts }) });
        setNotice(dict.commerce.warehouseUpdated);
      } else {
        await apiFetch(`/organizations/${orgId}/commerce/warehouses`, { method: "POST", body: JSON.stringify({ name: whForm.name.trim(), address: whForm.address.trim() || undefined, priority, serviceDistricts }) });
        setNotice(dict.commerce.warehouseCreated);
      }
      setWhForm({ name: "", address: "", priority: "0", districtsText: "" }); setEditingWh(null); await loadWarehouses();
    } catch (err) { setError(err instanceof Error ? err.message : dict.commerce.saveFailed); }
    finally { setBusy(""); }
  }
  async function patchWarehouse(w: Warehouse, body: Record<string, unknown>, msg: string) {
    const orgId = org(); if (!orgId) return;
    setBusy(`wh-${w.id}`); setError(""); setNotice("");
    try { await apiFetch(`/organizations/${orgId}/commerce/warehouses/${w.id}`, { method: "PATCH", body: JSON.stringify(body) }); setNotice(msg); await loadWarehouses(); }
    catch (err) { setError(err instanceof Error ? err.message : dict.commerce.updateFailed2); }
    finally { setBusy(""); }
  }
  async function deleteWarehouse(w: Warehouse) {
    const orgId = org(); if (!orgId) return;
    setBusy(`wh-${w.id}`); setError("");
    try { await apiFetch(`/organizations/${orgId}/commerce/warehouses/${w.id}`, { method: "DELETE" }); setNotice(dict.commerce.warehouseDeactivated); await loadWarehouses(); }
    catch (err) { setError(err instanceof Error ? err.message : dict.commerce.deleteFailed2); }
    finally { setBusy(""); }
  }
  async function createBin(e: React.FormEvent) {
    e.preventDefault(); const orgId = org(); if (!orgId || !selectedWh) return;
    setBusy("bin"); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/warehouses/${selectedWh}/bins`, { method: "POST", body: JSON.stringify({ code: binForm.code.trim(), note: binForm.note.trim() || undefined }) });
      setBinForm({ code: "", note: "" }); setNotice(dict.commerce.binCreated);
      await loadBinsFor(selectedWh, setBins); await loadWarehouses();
    } catch (err) { setError(err instanceof Error ? err.message : dict.commerce.binCreationFailed); }
    finally { setBusy(""); }
  }
  async function deleteBin(b: Bin) {
    const orgId = org(); if (!orgId || !selectedWh) return;
    setBusy(`bin-${b.id}`); setError("");
    try { await apiFetch(`/organizations/${orgId}/commerce/warehouses/${selectedWh}/bins/${b.id}`, { method: "DELETE" }); await loadBinsFor(selectedWh, setBins); await loadWarehouses(); }
    catch (err) { setError(err instanceof Error ? err.message : dict.commerce.binDeleteFailed); }
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
    if (!assignWh || !assignForm.binLocationId || !assignForm.productId) { setError(dict.commerce.selectAWarehouseBinProduct); return; }
    setBusy("assign"); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/bin-assignments`, { method: "POST", body: JSON.stringify({ warehouseId: assignWh, binLocationId: assignForm.binLocationId, productId: assignForm.productId, variantId: assignForm.variantId || undefined }) });
      setNotice(dict.commerce.allocatedIfTheSameProduct);
      await loadAssignments(assignWh);
    } catch (err) { setError(err instanceof Error ? err.message : dict.commerce.allocationFailed); }
    finally { setBusy(""); }
  }
  async function removeAssignment(a: Assignment) {
    const orgId = org(); if (!orgId) return;
    setBusy(`asg-${a.id}`); setError("");
    try { await apiFetch(`/organizations/${orgId}/commerce/bin-assignments/${a.id}`, { method: "DELETE" }); await loadAssignments(assignWh); }
    catch (err) { setError(err instanceof Error ? err.message : dict.commerce.deleteFailed2); }
    finally { setBusy(""); }
  }

  // ---- stock counts ----
  async function createSession(e: React.FormEvent) {
    e.preventDefault(); const orgId = org(); if (!orgId || !countForm.warehouseId) return;
    setBusy("count-create"); setError(""); setNotice("");
    try {
      const s = await apiFetch<CountSession>(`/organizations/${orgId}/commerce/stock-counts`, { method: "POST", body: JSON.stringify({ warehouseId: countForm.warehouseId, binLocationId: countForm.binLocationId || undefined }) });
      setNotice(dict.commerce.countSessionCreated); await loadCounts(); await openSession(s.id);
    } catch (err) { setError(err instanceof Error ? err.message : dict.commerce.sessionCreationFailed); }
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
    } catch (err) { setError(err instanceof Error ? err.message : dict.commerce.sessionLoadingFailed); }
  }
  async function saveLine(line: CountLine) {
    const orgId = org(); if (!orgId || !countDetail) return;
    const raw = counted[line.id];
    if (raw === "" || raw == null) { setError(dict.commerce.writeTheCountedQuantity); return; }
    setBusy(`line-${line.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/stock-counts/${countDetail.id}/lines/${line.id}`, { method: "PATCH", body: JSON.stringify({ countedQty: Number(raw) }) });
      await openSession(countDetail.id);
    } catch (err) { setError(err instanceof Error ? err.message : dict.commerce.lineSaveFailed); }
    finally { setBusy(""); }
  }
  async function closeSession() {
    const orgId = org(); if (!orgId || !countDetail) return;
    setBusy("count-close"); setError(""); setNotice("");
    try {
      const out = await apiFetch<{ session: CountSession; applied: { lineId: string; delta: number }[]; skipped: { lineId: string; reason: string }[] }>(`/organizations/${orgId}/commerce/stock-counts/${countDetail.id}/close`, { method: "POST", body: JSON.stringify({}) });
      setCountDetail(out.session); setCloseResult({ applied: out.applied ?? [], skipped: out.skipped ?? [] });
      setNotice(t("commerce.countClosedStockAdjustedOn", { out: out.applied?.length ?? 0, out1: out.skipped?.length ?? 0 }));
      await loadCounts();
    } catch (err) { setError(err instanceof Error ? err.message : dict.commerce.closeFailed); }
    finally { setBusy(""); }
  }

  // ---- riders ----
  async function saveRider(e: React.FormEvent) {
    e.preventDefault(); const orgId = org(); if (!orgId) return;
    setBusy("rider"); setError(""); setNotice("");
    try {
      if (editingRider) {
        await apiFetch(`/organizations/${orgId}/delivery/riders/${editingRider.id}`, { method: "PATCH", body: JSON.stringify({ name: riderForm.name.trim(), phone: riderForm.phone.trim() || undefined }) });
        setNotice(dict.commerce.riderUpdated);
      } else {
        await apiFetch(`/organizations/${orgId}/delivery/riders`, { method: "POST", body: JSON.stringify({ name: riderForm.name.trim(), phone: riderForm.phone.trim() || undefined }) });
        setNotice(dict.commerce.riderAdded);
      }
      setRiderForm({ name: "", phone: "" }); setEditingRider(null); await loadRiders();
    } catch (err) { setError(err instanceof Error ? err.message : dict.commerce.saveFailed); }
    finally { setBusy(""); }
  }
  async function toggleRider(r: Rider) {
    const orgId = org(); if (!orgId) return;
    setBusy(`rider-${r.id}`); setError("");
    try { await apiFetch(`/organizations/${orgId}/delivery/riders/${r.id}`, { method: "PATCH", body: JSON.stringify({ active: !r.active }) }); await loadRiders(); }
    catch (err) { setError(err instanceof Error ? err.message : dict.commerce.updateFailed2); }
    finally { setBusy(""); }
  }
  async function transition(a: DeliveryAssignment, status: string) {
    const orgId = org(); if (!orgId) return;
    setBusy(`asg-${a.id}`); setError(""); setNotice("");
    try { await apiFetch(`/organizations/${orgId}/delivery/assignments/${a.id}/transition`, { method: "POST", body: JSON.stringify({ status }) }); await loadRiders(); }
    catch (err) { setError(err instanceof Error ? err.message : dict.commerce.statusChangeFailed); }
    finally { setBusy(""); }
  }

  const tabBtn = (key: typeof tab, label: string) => (
    <button type="button" key={key} onClick={() => setTab(key)} className={`inline-flex min-h-[44px] items-center rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === key ? "bg-slate-900 text-white" : "border bg-white"}`}>{label}</button>
  );

  // EB6: row actions shared verbatim between each desktop table and
  // its ResponsiveTable mobile card — same handlers, same order.
  const renderAssignActions = (a: Assignment) => (
    <div className="flex flex-wrap gap-2">
      <Link href={`/dashboard/commerce/warehouse/labels?warehouseId=${a.warehouseId}&binId=${a.binLocationId}`} className="inline-flex min-h-[44px] items-center text-xs font-semibold text-indigo-700">{dict.commerce.labelPrint}</Link>
      <button type="button" className="inline-flex min-h-[44px] items-center text-xs font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => removeAssignment(a)}>{dict.commerce.delete}</button>
    </div>
  );
  const renderCountSave = (l: CountLine) => (
    countDetail && countDetail.status !== "closed" ? <button type="button" className="btn-secondary btn-sm inline-flex min-h-[44px] items-center" disabled={busy !== ""} onClick={() => saveLine(l)}>{dict.commerce.save}</button> : null
  );
  const boardByRider = new Map<string, DeliveryAssignment[]>();
  for (const a of board) { const arr = boardByRider.get(a.riderName ?? a.riderId) ?? []; arr.push(a); boardByRider.set(a.riderName ?? a.riderId, arr); }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{dict.commerce.warehouse3}</h1>
        <p className="text-sm text-slate-500">{dict.commerce.warehousesBinAllocationStockCounts}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {tabBtn("warehouses", dict.commerce.warehousesBins)}
        {tabBtn("assignments", dict.commerce.binAllocation)}
        {tabBtn("counts", dict.commerce.stockCount)}
        {tabBtn("stock", dict.commerce.stockBalance)}
        {tabBtn("transfers", dict.commerce.transfers)}
        {tabBtn("riders", dict.commerce.rider)}
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      {tab === "warehouses" ? (
        <div className="space-y-4">
          <form onSubmit={saveWarehouse} className="card grid gap-2 p-5 sm:grid-cols-3">
            <input aria-label={dict.commerce.warehouseName} className="input" placeholder={dict.commerce.warehouseName2} value={whForm.name} onChange={(e) => setWhForm({ ...whForm, name: e.target.value })} required />
            <input aria-label={dict.commerce.warehouseAddress} className="input sm:col-span-2" placeholder={dict.commerce.address} value={whForm.address} onChange={(e) => setWhForm({ ...whForm, address: e.target.value })} />
            <label className="block text-sm">{dict.commerce.priority2}<input className="input mt-1" type="number" min={0} step={1} value={whForm.priority} onChange={(e) => setWhForm({ ...whForm, priority: e.target.value })} />
              <span className="mt-1 block text-xs text-slate-500">{dict.commerce.smallerNumberShippedFromEarlier}</span>
            </label>
            <label className="block text-sm sm:col-span-2">{dict.commerce.serviceDistricts}<input className="input mt-1" placeholder={dict.commerce.districtNamesSeparatedByCommas} value={whForm.districtsText} onChange={(e) => setWhForm({ ...whForm, districtsText: e.target.value })} />
              <span className="mt-1 block text-xs text-slate-500">{dict.commerce.ordersFromTheseDistrictsWill}</span>
            </label>
            <div className="flex gap-2">
              <button className="btn-primary" disabled={busy !== ""}>{busy === "wh" ? dict.commerce.ing : editingWh ? dict.commerce.update : dict.commerce.addWarehouse}</button>
              {editingWh ? <button type="button" className="btn-secondary" onClick={() => { setEditingWh(null); setWhForm({ name: "", address: "", priority: "0", districtsText: "" }); }}>{dict.common.cancel}</button> : null}
            </div>
          </form>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card p-5">
              <div className="font-semibold">{dict.commerce.warehouses}</div>
              <ul className="mt-3 space-y-2">
                {warehouses.map((w) => (
                  <li key={w.id} className={`rounded-lg border p-3 ${selectedWh === w.id ? "border-slate-900" : ""}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button type="button" className="font-medium" onClick={() => setSelectedWh(w.id)}>{w.name} {w.isDefault ? <span className="ml-1 rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">{dict.commerce.default}</span> : null} {!w.active ? <span className="ml-1 rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">{dict.commerce.inactive}</span> : null}</button>
                      <span className="text-xs text-slate-500">{dict.commerce.bin}{w.binCount ?? 0} {dict.commerce.allocated2}{w.assignmentCount ?? 0}</span>
                    </div>
                    {w.address ? <p className="mt-1 text-xs text-slate-500">{w.address}</p> : null}
                    <p className="mt-1 text-xs text-slate-500">{dict.commerce.priority3}{w.priority ?? 0}
                      {(w.serviceDistricts ?? []).length > 0 ? <> {dict.commerce.serviceDistricts2}{(w.serviceDistricts ?? []).map((d) => <span key={d} className="ml-1 rounded bg-indigo-50 px-1.5 py-0.5 font-semibold text-indigo-700">{d}</span>)}</> : null}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {!w.isDefault && w.active ? <button type="button" className="inline-flex min-h-[44px] items-center text-xs font-semibold text-indigo-700 disabled:opacity-50" disabled={busy !== ""} onClick={() => patchWarehouse(w, { isDefault: true }, dict.commerce.defaultWarehouseChanged)}>{dict.commerce.makeDefault}</button> : null}
                      <button type="button" className="inline-flex min-h-[44px] items-center text-xs font-semibold text-blue-700" onClick={() => { setEditingWh(w); setWhForm({ name: w.name, address: w.address ?? "", priority: String(w.priority ?? 0), districtsText: (w.serviceDistricts ?? []).join(", ") }); }}>{dict.commerce.edit}</button>
                      {w.active ? <button type="button" className="inline-flex min-h-[44px] items-center text-xs font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => deleteWarehouse(w)}>{dict.commerce.deactivate}</button> : null}
                    </div>
                  </li>
                ))}
                {warehouses.length === 0 ? <li className="text-sm text-slate-500">{dict.commerce.noWarehouses}</li> : null}
              </ul>
            </div>
            <div className="card p-5">
              <div className="font-semibold">{dict.commerce.bins}{warehouses.find((w) => w.id === selectedWh)?.name ?? dict.commerce.selectAWarehouse}</div>
              <form onSubmit={createBin} className="mt-3 grid gap-2 sm:grid-cols-3">
                <input aria-label={dict.commerce.binCode} className="input" placeholder={dict.commerce.binCodeEGA} value={binForm.code} onChange={(e) => setBinForm({ ...binForm, code: e.target.value })} required />
                <input aria-label={dict.commerce.binNote} className="input" placeholder={dict.commerce.note} value={binForm.note} onChange={(e) => setBinForm({ ...binForm, note: e.target.value })} />
                <button className="btn-primary" disabled={busy !== "" || !selectedWh}>{dict.commerce.addBin}</button>
              </form>
              <ul className="mt-3 space-y-1.5">
                {bins.map((b) => (
                  <li key={b.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <span className="font-mono font-semibold">{b.code}</span>
                    <span className="text-xs text-slate-500">{b.note ?? ""}</span>
                    <button type="button" className="inline-flex min-h-[44px] items-center text-xs font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => deleteBin(b)}>{dict.commerce.delete}</button>
                  </li>
                ))}
                {bins.length === 0 ? <li className="text-sm text-slate-500">{dict.commerce.noBinsInThisWarehouse}</li> : null}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      {tab === "assignments" ? (
        <div className="space-y-4">
          <div className="card space-y-3 p-5">
            <div className="flex flex-wrap items-end gap-3">
              <label className="block text-sm">{dict.commerce.warehouse}<select className="input mt-1" value={assignWh} onChange={(e) => setAssignWh(e.target.value)}>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </label>
              {checkedProducts.size > 0 ? (
                <Link href={`/dashboard/commerce/warehouse/labels?productIds=${[...checkedProducts].join(",")}`} className="btn-secondary btn-sm">{dict.commerce.selected3}{checkedProducts.size}{dict.commerce.productLabels}</Link>
              ) : null}
            </div>
            <form onSubmit={saveAssignment} className="grid gap-2 sm:grid-cols-4">
              <select aria-label={dict.commerce.selectAProduct} className="input" value={assignForm.productId} onChange={(e) => void onAssignProduct(e.target.value)} required>
                <option value="">{dict.commerce.selectAProduct}</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ""}</option>)}
              </select>
              <select aria-label={dict.commerce.selectAVariant} className="input" value={assignForm.variantId} onChange={(e) => setAssignForm({ ...assignForm, variantId: e.target.value })}>
                <option value="">{dict.commerce.mainProduct}</option>
                {assignVariants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              <select aria-label={dict.commerce.selectABin} className="input" value={assignForm.binLocationId} onChange={(e) => setAssignForm({ ...assignForm, binLocationId: e.target.value })} required>
                <option value="">{dict.commerce.selectABin}</option>
                {assignBins.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
              </select>
              <button className="btn-primary" disabled={busy !== ""}>{busy === "assign" ? dict.commerce.ing : dict.commerce.allocate}</button>
            </form>
            <p className="text-xs text-slate-500">{dict.commerce.allocatingTheSameProductAgain}</p>
          </div>
          <div className="card p-5">
            {assignments.length === 0 ? <p className="text-sm text-slate-500">{dict.commerce.noAllocationsInThisWarehouse}</p> : (
              <ResponsiveTable
                table={
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs text-slate-500"><th className="py-2 pr-2">{dict.commerce.label}</th><th className="py-2 pr-3">{dict.commerce.product}</th><th className="py-2 pr-3">{dict.commerce.bin}</th><th className="py-2 pr-3">{dict.commerce.warehouse}</th><th className="py-2">{dict.commerce.action}</th></tr></thead>
                <tbody>{assignments.map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="py-2 pr-2"><input type="checkbox" aria-label={t("commerce.selectForTheLabel", { productId: a.productName ?? a.productId })} checked={checkedProducts.has(a.productId)} onChange={(e) => setCheckedProducts((prev) => { const n = new Set(prev); if (e.target.checked) n.add(a.productId); else n.delete(a.productId); return n; })} /></td>
                    <td className="py-2 pr-3 font-medium">{a.productName ?? a.productId}{a.variantName ? <span className="block text-xs text-slate-500">{a.variantName}</span> : null}</td>
                    <td className="py-2 pr-3 font-mono">{a.binCode ?? a.binLocationId}</td>
                    <td className="py-2 pr-3">{a.warehouseName ?? ""}</td>
                    <td className="py-2">{renderAssignActions(a)}</td>
                  </tr>))}
                </tbody></table></div>
                }
                cards={assignments.map((a) => (
                  <div key={a.id} className="rounded-xl border bg-white p-3 text-sm shadow-sm">
                    <label className="flex min-h-[44px] items-center gap-2 font-medium">
                      <input type="checkbox" aria-label={t("commerce.selectForTheLabel", { productId: a.productName ?? a.productId })} checked={checkedProducts.has(a.productId)} onChange={(e) => setCheckedProducts((prev) => { const n = new Set(prev); if (e.target.checked) n.add(a.productId); else n.delete(a.productId); return n; })} />
                      {a.productName ?? a.productId}{a.variantName ? <span className="block text-xs font-normal text-slate-500">{a.variantName}</span> : null}
                    </label>
                    <dl className="mt-1 space-y-1.5">
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.bin}</dt><dd className="text-right font-mono">{a.binCode ?? a.binLocationId}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.warehouse}</dt><dd className="text-right">{a.warehouseName ?? ""}</dd></div>
                    </dl>
                    <div className="mt-2">{renderAssignActions(a)}</div>
                  </div>
                ))}
              />
            )}
            {assignBins.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2 border-t pt-3">
                <span className="text-sm font-medium">{dict.commerce.labelsByBin}</span>
                {assignBins.map((b) => (
                  <Link key={b.id} href={`/dashboard/commerce/warehouse/labels?warehouseId=${assignWh}&binId=${b.id}`} className="inline-flex min-h-[44px] items-center rounded-lg border bg-white px-2 py-1 text-xs font-semibold">🏷️ {b.code}</Link>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === "counts" ? (
        <div className="space-y-4">
          <form onSubmit={createSession} className="card flex flex-wrap items-end gap-3 p-5">
            <label className="block text-sm">{dict.commerce.warehouse}<select className="input mt-1" value={countForm.warehouseId} onChange={(e) => setCountForm({ warehouseId: e.target.value, binLocationId: "" })}>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>
            <label className="block text-sm">{dict.commerce.binOptional}<select className="input mt-1" value={countForm.binLocationId} onChange={(e) => setCountForm({ ...countForm, binLocationId: e.target.value })}>
                <option value="">{dict.commerce.wholeWarehouse}</option>
                {countBins.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
              </select>
            </label>
            <button className="btn-primary" disabled={busy !== "" || !countForm.warehouseId}>{dict.commerce.startANewCount}</button>
            <p className="w-full text-xs text-slate-500">{dict.commerce.ifABinIsSelected}<b>{dict.commerce.countByBin}</b> {dict.commerce.systemCountThatBinS}<b>{dict.commerce.countByWarehouse}</b> {dict.commerce.systemCountTotalStock}</p>
          </form>
          <div className="card p-5">
            <div className="font-semibold">{dict.commerce.countSessions}</div>
            <ul className="mt-2 space-y-1.5">
              {sessions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span>{warehouses.find((w) => w.id === s.warehouseId)?.name ?? s.warehouseId} · <span className="font-medium">{s.status}</span> · <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-semibold text-slate-600">{countScopeLabel(s.scope, s.binLocationId)}</span>{s.totals ? t("commerce.linesCounted", { lineCount: s.totals.lineCount, countedCount: s.totals.countedCount }) : s.lineCount != null ? t("commerce.linesCounted2", { lineCount: s.lineCount, s: s.countedCount ?? 0 }) : ""}</span>
                  <button type="button" className="inline-flex min-h-[44px] items-center text-xs font-semibold text-blue-700" onClick={() => openSession(s.id)}>{dict.commerce.open}</button>
                </li>
              ))}
              {sessions.length === 0 ? <li className="text-sm text-slate-500">{dict.commerce.noSessions}</li> : null}
            </ul>
          </div>
          {countDetail ? (
            <div className="card space-y-3 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold">{dict.commerce.sessionDetailsStatus}{countDetail.status} · {countScopeLabel(countDetail.scope, countDetail.binLocationId)}{countDetail.scope === "bin" && countDetail.binCode ? t("commerce.bin2", { binCode: countDetail.binCode }) : ""}</div>
                <button type="button" className="btn-ghost btn-sm" onClick={() => setCountDetail(null)}>{dict.commerce.close}</button>
              </div>
              {countDetail.totals ? <p className="text-sm text-slate-600">{dict.commerce.totalLines}{countDetail.totals.lineCount} {dict.commerce.counted2}{countDetail.totals.countedCount} {dict.commerce.skipped3}{countDetail.totals.skippedCount} {dict.commerce.totalDifference2}{countDetail.totals.totalVariance}</p> : null}
              <ResponsiveTable
                table={
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs text-slate-500"><th className="py-2 pr-3">{dict.commerce.product}</th><th className="py-2 pr-3">{dict.commerce.inTheSystem}</th><th className="py-2 pr-3">{dict.commerce.counted}</th><th className="py-2 pr-3">{dict.commerce.difference}</th><th className="py-2">{dict.commerce.save}</th></tr></thead>
                <tbody>{(countDetail.lines ?? []).map((l) => (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{l.productName ?? l.productId}{l.variantName ? <span className="block text-xs text-slate-500">{l.variantName}</span> : null}</td>
                    <td className="py-2 pr-3">{l.systemQty}</td>
                    <td className="py-2 pr-3"><input aria-label={dict.commerce.countedQuantity} className="input w-24" type="number" min={0} value={counted[l.id] ?? ""} onChange={(e) => setCounted({ ...counted, [l.id]: e.target.value })} disabled={countDetail.status === "closed"} /></td>
                    <td className="py-2 pr-3">{l.variance == null ? "—" : <span className={l.variance === 0 ? "text-green-700" : "font-semibold text-red-600"}>{l.variance > 0 ? `+${l.variance}` : l.variance}</span>}</td>
                    <td className="py-2">{renderCountSave(l)}</td>
                  </tr>))}
                </tbody></table></div>
                }
                cards={(countDetail.lines ?? []).map((l) => (
                  <div key={l.id} className="rounded-xl border bg-white p-3 text-sm shadow-sm">
                    <div className="font-medium">{l.productName ?? l.productId}{l.variantName ? <span className="block text-xs font-normal text-slate-500">{l.variantName}</span> : null}</div>
                    <dl className="mt-2 space-y-1.5">
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.inTheSystem}</dt><dd className="text-right">{l.systemQty}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.difference}</dt><dd className="text-right">{l.variance == null ? "—" : <span className={l.variance === 0 ? "text-green-700" : "font-semibold text-red-600"}>{l.variance > 0 ? `+${l.variance}` : l.variance}</span>}</dd></div>
                    </dl>
                    <label className="mt-2 block text-xs font-semibold text-slate-500">{dict.commerce.counted}<input aria-label={dict.commerce.countedQuantity} className="input mt-1 w-24" type="number" min={0} value={counted[l.id] ?? ""} onChange={(e) => setCounted({ ...counted, [l.id]: e.target.value })} disabled={countDetail.status === "closed"} />
                    </label>
                    {renderCountSave(l) ? <div className="mt-2">{renderCountSave(l)}</div> : null}
                  </div>
                ))}
              />
              {closeResult ? (
                <div className="rounded-lg bg-slate-50 p-3 text-sm">
                  <p className="font-semibold">{dict.commerce.closeResult}</p>
                  <p>{dict.commerce.applied}{closeResult.applied.length}{dict.commerce.lines}{closeResult.applied.length ? t("commerce.delta", { closeResult: closeResult.applied.map((a) => a.delta).join(", ") }) : ""}</p>
                  <p>{dict.commerce.skipped4}{closeResult.skipped.length}{dict.commerce.text1ou8}{closeResult.skipped.length ? ` — ${closeResult.skipped.map((s) => s.reason).join("; ")}` : ""}</p>
                </div>
              ) : null}
              {countDetail.status !== "closed" ? (
                <button type="button" className="btn-primary" disabled={busy !== ""} onClick={closeSession}>{busy === "count-close" ? dict.commerce.closing : dict.commerce.closeCountApplyStockAdjustment}</button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "stock" ? (
        <div className="space-y-4">
          <div className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold">{dict.commerce.stockBalanceProductWarehouseBin}</div>
              <button type="button" className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => void refreshStock()}>{dict.commerce.refresh}</button>
            </div>
            {balances === null ? <p className="mt-2 text-sm text-slate-400">{dict.common.loading}</p> : balances.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">{dict.commerce.noBalancesYetBalancesWill}</p>
            ) : (
              <ResponsiveTable
                className="mt-3"
                table={
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs text-slate-500"><th className="py-2 pr-3">{dict.commerce.product}</th><th className="py-2 pr-3">{dict.commerce.warehouse}</th><th className="py-2 pr-3">{dict.commerce.bin}</th><th className="py-2 pr-3">{dict.commerce.onHand}</th><th className="py-2">{dict.commerce.reserved}</th></tr></thead>
                <tbody>
                  {balances.map((b, i) => (
                    <tr key={`${b.productId}-${b.variantId ?? ""}-${b.binId ?? ""}-${i}`} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-medium">{b.productName ?? b.productId}{b.variantName ? <span className="block text-xs text-slate-500">{b.variantName}</span> : null}{b.sku ? <span className="block text-xs text-slate-500">{b.sku}</span> : null}
                        {!b.seeded ? <span className="mt-0.5 inline-block rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">{dict.commerce.notDistributed}</span> : null}
                      </td>
                      <td className="py-2 pr-3">{b.warehouseName ?? "—"}</td>
                      <td className="py-2 pr-3 font-mono">{b.binCode ?? "—"}</td>
                      <td className="py-2 pr-3 font-semibold">{b.onHand}</td>
                      <td className="py-2">{b.reserved}</td>
                    </tr>
                  ))}
                  {balanceTotals ? (
                    <tr className="font-semibold"><td className="py-2 pr-3">{dict.commerce.total}</td><td className="py-2 pr-3" /><td className="py-2 pr-3" /><td className="py-2 pr-3">{balanceTotals.totalOnHand}</td><td className="py-2">{balanceTotals.totalReserved}</td></tr>
                  ) : null}
                </tbody></table></div>
                }
                cards={(<>
                  {balances.map((b, i) => (
                    <div key={`${b.productId}-${b.variantId ?? ""}-${b.binId ?? ""}-${i}`} className="rounded-xl border bg-white p-3 text-sm shadow-sm">
                      <div className="font-medium">{b.productName ?? b.productId}{b.variantName ? <span className="block text-xs font-normal text-slate-500">{b.variantName}</span> : null}{b.sku ? <span className="block text-xs font-normal text-slate-500">{b.sku}</span> : null}
                        {!b.seeded ? <span className="mt-0.5 inline-block rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">{dict.commerce.notDistributed}</span> : null}
                      </div>
                      <dl className="mt-2 space-y-1.5">
                        <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.warehouse}</dt><dd className="text-right">{b.warehouseName ?? "—"}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.bin}</dt><dd className="text-right font-mono">{b.binCode ?? "—"}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.onHand}</dt><dd className="text-right font-semibold">{b.onHand}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.reserved}</dt><dd className="text-right">{b.reserved}</dd></div>
                      </dl>
                    </div>
                  ))}
                  {balanceTotals ? (
                    <div className="rounded-xl border bg-slate-50 p-3 text-sm font-semibold shadow-sm">
                      <dl className="space-y-1.5">
                        <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.totalOnHand}</dt><dd className="text-right">{balanceTotals.totalOnHand}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.totalReserved}</dt><dd className="text-right">{balanceTotals.totalReserved}</dd></div>
                      </dl>
                    </div>
                  ) : null}
                </>)}
              />
            )}
            <p className="mt-2 text-xs text-slate-500">{dict.commerce.notDistributedMeansThisStock}</p>
          </div>

          <div className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold">{dict.commerce.stockByLocationProductWarehouse}</div>
              <button type="button" className="btn-secondary btn-sm" disabled={csvBusy} onClick={() => void downloadLocationCsv()}>{csvBusy ? dict.commerce.ing : dict.commerce.downloadCSV3}</button>
            </div>
            {locationRows === null ? <p className="mt-2 text-sm text-slate-400">{dict.common.loading}</p> : locationRows.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">{dict.commerce.noStockAtAnyLocation}</p>
            ) : (
              <ResponsiveTable
                className="mt-3"
                table={
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs text-slate-500"><th className="py-2 pr-3">{dict.commerce.product}</th><th className="py-2 pr-3">{dict.commerce.warehouse}</th><th className="py-2 pr-3">{dict.commerce.onHand}</th><th className="py-2 pr-3">{dict.commerce.reserved}</th><th className="py-2">{dict.commerce.outOnTheRoad}</th></tr></thead>
                <tbody>
                  {locationRows.map((r, i) => (
                    <tr key={`${r.productId}-${r.variantId ?? ""}-${r.warehouseId ?? ""}-${i}`} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-medium">{r.productName ?? r.productId}{r.variantName ? <span className="block text-xs text-slate-500">{r.variantName}</span> : null}</td>
                      <td className="py-2 pr-3">{r.warehouseName ?? "—"}</td>
                      <td className="py-2 pr-3 font-semibold">{r.onHand}</td>
                      <td className="py-2 pr-3">{r.reserved}</td>
                      <td className="py-2">{r.inTransitOut}</td>
                    </tr>
                  ))}
                  {locationTotals ? (
                    <tr className="font-semibold"><td className="py-2 pr-3">{dict.commerce.total}</td><td className="py-2 pr-3" /><td className="py-2 pr-3">{locationTotals.totalOnHand}</td><td className="py-2 pr-3">{locationTotals.totalReserved}</td><td className="py-2">{locationTotals.totalInTransit}</td></tr>
                  ) : null}
                </tbody></table></div>
                }
                cards={(<>
                  {locationRows.map((r, i) => (
                    <div key={`${r.productId}-${r.variantId ?? ""}-${r.warehouseId ?? ""}-${i}`} className="rounded-xl border bg-white p-3 text-sm shadow-sm">
                      <div className="font-medium">{r.productName ?? r.productId}{r.variantName ? <span className="block text-xs font-normal text-slate-500">{r.variantName}</span> : null}</div>
                      <dl className="mt-2 space-y-1.5">
                        <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.warehouse}</dt><dd className="text-right">{r.warehouseName ?? "—"}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.onHand}</dt><dd className="text-right font-semibold">{r.onHand}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.reserved}</dt><dd className="text-right">{r.reserved}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.outOnTheRoad}</dt><dd className="text-right">{r.inTransitOut}</dd></div>
                      </dl>
                    </div>
                  ))}
                  {locationTotals ? (
                    <div className="rounded-xl border bg-slate-50 p-3 text-sm font-semibold shadow-sm">
                      <dl className="space-y-1.5">
                        <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.totalOnHand}</dt><dd className="text-right">{locationTotals.totalOnHand}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.totalReserved}</dt><dd className="text-right">{locationTotals.totalReserved}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.totalInTransit}</dt><dd className="text-right">{locationTotals.totalInTransit}</dd></div>
                      </dl>
                    </div>
                  ) : null}
                </>)}
              />
            )}
          </div>
        </div>
      ) : null}

      {tab === "transfers" ? (
        <div className="space-y-4">
          <form onSubmit={createTransfer} className="card space-y-3 p-5">
            <div className="font-semibold">{dict.commerce.newTransferDraft}</div>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="block text-sm">{dict.commerce.sourceBin}<select className="input mt-1" value={transferForm.fromBinId} onChange={(e) => setTransferForm({ ...transferForm, fromBinId: e.target.value })} required>
                  <option value="">{dict.commerce.selectABin}</option>
                  {warehouses.map((w) => (
                    <optgroup key={w.id} label={w.name}>
                      {allBins.filter((b) => b.warehouseId === w.id).map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="block text-sm">{dict.commerce.destinationBin}<select className="input mt-1" value={transferForm.toBinId} onChange={(e) => setTransferForm({ ...transferForm, toBinId: e.target.value })} required>
                  <option value="">{dict.commerce.selectABin}</option>
                  {warehouses.map((w) => (
                    <optgroup key={w.id} label={w.name}>
                      {allBins.filter((b) => b.warehouseId === w.id).map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="block text-sm">{dict.commerce.noteOptional}<input className="input mt-1" value={transferForm.note} onChange={(e) => setTransferForm({ ...transferForm, note: e.target.value })} />
              </label>
            </div>
            <div className="space-y-2">
              {transferForm.lines.map((line, idx) => (
                <div key={idx} className="grid gap-2 sm:grid-cols-4">
                  <select aria-label={dict.commerce.selectAProduct} className="input" value={line.productId} onChange={(e) => void onTransferProduct(idx, e.target.value)} required>
                    <option value="">{dict.commerce.selectAProduct}</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ""}</option>)}
                  </select>
                  <select aria-label={dict.commerce.selectAVariant} className="input" value={line.variantId} onChange={(e) => setTransferForm((f) => { const lines = f.lines.slice(); lines[idx] = { ...lines[idx], variantId: e.target.value }; return { ...f, lines }; })}>
                    <option value="">{dict.commerce.mainProduct}</option>
                    {(lineVariants[idx] ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                  <input aria-label={dict.commerce.quantity} className="input" type="number" min={1} step={1} placeholder={dict.commerce.quantity} value={line.qty} onChange={(e) => setTransferForm((f) => { const lines = f.lines.slice(); lines[idx] = { ...lines[idx], qty: e.target.value }; return { ...f, lines }; })} required />
                  <button type="button" className="btn-secondary" disabled={transferForm.lines.length <= 1} onClick={() => setTransferForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }))}>{dict.commerce.removeLine}</button>
                </div>
              ))}
              <button type="button" className="inline-flex min-h-[44px] items-center text-xs font-semibold text-indigo-700" onClick={() => setTransferForm((f) => ({ ...f, lines: [...f.lines, { productId: "", variantId: "", qty: "1" }] }))}>{dict.commerce.addAnotherLine2}</button>
            </div>
            <button className="btn-primary" disabled={busy !== ""}>{busy === "tr-create" ? dict.commerce.ing : dict.commerce.createDraft}</button>
            <p className="text-xs text-slate-500">{dict.commerce.noStockMovesInA}</p>
          </form>

          <div className="card p-5">
            <div className="font-semibold">{dict.commerce.transferList}</div>
            {transfers.length === 0 ? <p className="mt-2 text-sm text-slate-500">{dict.commerce.noTransfers}</p> : (
              <ul className="mt-3 space-y-2">
                {transfers.map((tf) => (
                  <li key={tf.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button type="button" className="font-medium hover:underline" onClick={() => void openTransfer(tf.id)}>
                        {tf.fromWarehouseName ?? "?"} · {tf.fromBinCode ?? "?"} → {tf.toWarehouseName ?? "?"} · {tf.toBinCode ?? "?"}
                      </button>
                      <span className={`rounded px-2 py-0.5 text-xs font-semibold ${transferStatusCls(tf.status)}`}>{transferStatusLabel(tf.status)}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {dict.commerce.lines2}{tf.lineCount} {dict.commerce.sent3}{tf.totalQtySent}{tf.status === "received" || tf.status === "received_with_variance" ? t("commerce.received2", { t: tf.totalQtyReceived ?? 0 }) : ""}{(tf.varianceQty ?? 0) > 0 ? t("commerce.difference2", { varianceQty: tf.varianceQty ?? 0 }) : ""} · {tf.createdAt ? fmtDateTime(locale, new Date(tf.createdAt)) : ""}
                      {tf.note ? ` · ${tf.note}` : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" className="inline-flex min-h-[44px] items-center text-xs font-semibold text-blue-700 disabled:opacity-50" disabled={busy !== ""} onClick={() => void openTransfer(tf.id)}>{busy === `tr-open-${tf.id}` ? dict.common.loading : dict.commerce.details}</button>
                      {tf.status === "draft" ? <>
                        <button type="button" className="inline-flex min-h-[44px] items-center text-xs font-semibold text-indigo-700 disabled:opacity-50" disabled={busy !== ""} onClick={() => void transferAction(tf, "dispatch")}>{busy === `tr-dispatch-${tf.id}` ? dict.commerce.ing : dict.commerce.dispatch}</button>
                        <button type="button" className="inline-flex min-h-[44px] items-center text-xs font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => void transferAction(tf, "cancel")}>{dict.common.cancel}</button>
                      </> : null}
                      {tf.status === "in_transit" ? <button type="button" className="inline-flex min-h-[44px] items-center text-xs font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => void transferAction(tf, "cancel")}>{dict.common.cancel}</button> : null}
                    </div>
                    {transferDetail?.id === tf.id ? (
                      <div className="mt-3 space-y-2 border-t pt-3">
                        <ResponsiveTable
                          table={
                        <div className="overflow-x-auto"><table className="w-full text-sm">
                          <thead><tr className="border-b text-left text-xs text-slate-500"><th className="py-2 pr-3">{dict.commerce.product}</th><th className="py-2 pr-3">{dict.commerce.send}</th><th className="py-2 pr-3">{dict.commerce.receive}</th><th className="py-2">{dict.commerce.difference}</th></tr></thead>
                          <tbody>{(transferDetail.lines ?? []).map((l) => {
                            const variance = transferLineVariance(l);
                            return (
                              <tr key={l.id} className="border-b last:border-0">
                                <td className="py-2 pr-3 font-medium">{l.productName ?? l.productId}{l.variantName ? <span className="block text-xs text-slate-500">{l.variantName}</span> : null}</td>
                                <td className="py-2 pr-3">{l.qtySent}</td>
                                <td className="py-2 pr-3">
                                  {transferDetail.status === "in_transit" ? (
                                    <input aria-label={dict.commerce.receivedQuantity} className="input w-24" type="number" min={0} step={1} value={receiveInputs[l.id] ?? String(l.qtySent)} onChange={(e) => setReceiveInputs({ ...receiveInputs, [l.id]: e.target.value })} />
                                  ) : l.qtyReceived ?? "—"}
                                </td>
                                <td className="py-2">{transferDetail.status === "received_with_variance" || transferDetail.status === "received" ? (variance > 0 ? <span className="font-semibold text-orange-700">−{variance}</span> : "—") : "—"}</td>
                              </tr>
                            );
                          })}</tbody></table></div>
                          }
                          cards={(transferDetail.lines ?? []).map((l) => {
                            const variance = transferLineVariance(l);
                            return (
                              <div key={l.id} className="rounded-xl border bg-white p-3 text-sm shadow-sm">
                                <div className="font-medium">{l.productName ?? l.productId}{l.variantName ? <span className="block text-xs font-normal text-slate-500">{l.variantName}</span> : null}</div>
                                <dl className="mt-2 space-y-1.5">
                                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.send}</dt><dd className="text-right">{l.qtySent}</dd></div>
                                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.difference}</dt><dd className="text-right">{transferDetail.status === "received_with_variance" || transferDetail.status === "received" ? (variance > 0 ? <span className="font-semibold text-orange-700">−{variance}</span> : "—") : "—"}</dd></div>
                                </dl>
                                <label className="mt-2 block text-xs font-semibold text-slate-500">{dict.commerce.receive}{transferDetail.status === "in_transit" ? (
                                    <input aria-label={dict.commerce.receivedQuantity} className="input mt-1 w-24" type="number" min={0} step={1} value={receiveInputs[l.id] ?? String(l.qtySent)} onChange={(e) => setReceiveInputs({ ...receiveInputs, [l.id]: e.target.value })} />
                                  ) : <span className="mt-1 block text-sm font-normal text-slate-900">{l.qtyReceived ?? "—"}</span>}
                                </label>
                              </div>
                            );
                          })}
                        />
                        {transferDetail.status === "in_transit" ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <button type="button" className="btn-primary btn-sm" disabled={busy !== ""} onClick={() => void receiveTransfer(transferDetail)}>{busy === `tr-receive-${transferDetail.id}` ? dict.commerce.ing : dict.commerce.accept}</button>
                            <span className="text-xs text-slate-500">{dict.commerce.ifTheFieldIsLeft}</span>
                          </div>
                        ) : null}
                        {transferDetail.status === "received_with_variance" ? <p className="rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-700">{dict.commerce.someProductsArrivedLessThe}</p> : null}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {tab === "riders" ? (
        <div className="space-y-4">
          <form onSubmit={saveRider} className="card grid gap-2 p-5 sm:grid-cols-3">
            <input aria-label={dict.commerce.riderName} className="input" placeholder={dict.commerce.riderName2} value={riderForm.name} onChange={(e) => setRiderForm({ ...riderForm, name: e.target.value })} required />
            <input aria-label={dict.commerce.riderPhone} className="input" placeholder={dict.commerce.phone} value={riderForm.phone} onChange={(e) => setRiderForm({ ...riderForm, phone: e.target.value })} />
            <div className="flex gap-2">
              <button className="btn-primary" disabled={busy !== ""}>{editingRider ? dict.commerce.update : dict.commerce.addRider}</button>
              {editingRider ? <button type="button" className="btn-secondary" onClick={() => { setEditingRider(null); setRiderForm({ name: "", phone: "" }); }}>{dict.common.cancel}</button> : null}
            </div>
          </form>
          <div className="card p-5">
            <div className="font-semibold">{dict.commerce.riderList}</div>
            <ul className="mt-2 space-y-1.5">
              {riders.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span className="font-medium">{r.name} <span className="text-slate-500">{r.phone ?? ""}</span> <span className={`ml-1 rounded px-2 py-0.5 text-xs font-semibold ${r.active ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}`}>{r.active ? dict.commerce.active : dict.commerce.inactive}</span></span>
                  <span className="flex gap-2">
                    <button type="button" className="inline-flex min-h-[44px] items-center text-xs font-semibold text-blue-700" onClick={() => { setEditingRider(r); setRiderForm({ name: r.name, phone: r.phone ?? "" }); }}>{dict.commerce.edit}</button>
                    <button type="button" className="inline-flex min-h-[44px] items-center text-xs font-semibold text-slate-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => toggleRider(r)}>{r.active ? dict.commerce.deactivate : dict.commerce.activate}</button>
                  </span>
                </li>
              ))}
              {riders.length === 0 ? <li className="text-sm text-slate-500">{dict.commerce.noRidersRidersCanBe}</li> : null}
            </ul>
          </div>
          <div className="card p-5">
            <div className="font-semibold">{dict.commerce.todaySBoard}{fmtDate(locale, new Date())}</div>
            {board.length === 0 ? <p className="mt-2 text-sm text-slate-500">{dict.commerce.noDeliveriesAssignedToday}</p> : (
              <div className="mt-3 space-y-4">
                {[...boardByRider.entries()].map(([riderName, list]) => (
                  <div key={riderName}>
                    <div className="text-sm font-semibold">{riderName} — {list.length}{dict.commerce.deliveries}</div>
                    <div className="mt-2 space-y-2">
                      {list.map((a) => (
                        <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
                          <div>
                            <span className="font-semibold">#{a.orderNumber ?? a.orderId.slice(0, 8)}</span>
                            <span className={`ml-2 rounded px-2 py-0.5 text-xs font-semibold ${assignCls(a.status)}`}>{ASSIGN_STATUS_BN[a.status] ? dict.commerce[ASSIGN_STATUS_BN[a.status] as keyof typeof dict.commerce] : a.status}</span>
                            <span className="mt-1 block text-xs text-slate-500">{a.orderAddress ?? ""} {dict.commerce.total2}{a.orderTotalMinor ? formatMinorTaka(a.orderTotalMinor) : "—"}</span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {a.status === "assigned" ? <button type="button" className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => transition(a, "picked_up")}>{dict.commerce.picked}</button> : null}
                            {a.status === "picked_up" ? <>
                              <button type="button" className="inline-flex min-h-[44px] items-center rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" disabled={busy !== ""} onClick={() => transition(a, "delivered")}>{dict.commerce.deliveryComplete}</button>
                              <button type="button" className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-1.5 text-xs font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => transition(a, "returned")}>{dict.commerce.refund}</button>
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
