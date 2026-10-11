"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinor } from "@repo/contracts";
import { EmptyState, KpiCard } from "@repo/ui";

interface OrderItem { id: string; name: string; quantity: number; totalMinor: string }
interface Order {
  id: string; externalNumber?: string | null; status: string; isCod: boolean;
  paymentMethod?: string | null; totalMinor: string; placedAt?: string | null;
  customer?: { firstName?: string | null; lastName?: string | null; phone?: string | null; email?: string | null } | null;
  items?: OrderItem[];
  risk?: { band: string; score: number | null } | null;
}
interface RiskDetail { band: string; score: number | null; decided: number; reasons: string[]; suggestion: string | null; phone?: string | null }
const RISK_LABEL: Record<string, { text: string; cls: string }> = {
  high: { text: "ঝুঁকি: উচ্চ", cls: "bg-red-100 text-red-700" },
  medium: { text: "ঝুঁকি: মাঝারি", cls: "bg-amber-100 text-amber-700" },
  low: { text: "ঝুঁকি: কম", cls: "bg-emerald-100 text-emerald-700" },
  unknown: { text: "ঝুঁকি: তথ্য নেই", cls: "bg-slate-100 text-slate-500" },
};
interface Stats { totalOrders: number; codOrders: number; codSharePercent: number; deliveredRevenueMinor: string; byStatus: { status: string; count: number }[] }
interface Shipment { id: string; orderId: string; trackingCode?: string | null; status: string; provider: string }

const STATUSES = ["", "pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed"];

export default function OrdersPage() {
  const [items, setItems] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [status, setStatus] = useState("");
  const [codOnly, setCodOnly] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [courier, setCourier] = useState<{ connected: boolean } | null>(null);
  const [courierForm, setCourierForm] = useState({ apiKey: "", secretKey: "" });
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [bookingFor, setBookingFor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkProvider, setBulkProvider] = useState("steadfast");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResults, setBulkResults] = useState<{ requested: number; booked: number; skipped: number; failed: number; results: { orderId: string; ok: boolean; skipped?: boolean; trackingCode?: string; error?: string }[] } | null>(null);
  const [bookForm, setBookForm] = useState({ name: "", phone: "", address: "", note: "", provider: "steadfast", pStoreId: "", pCityId: "", pZoneId: "", pAreaId: "", weightKg: "0.5", rAreaId: "", rAreaName: "", rStoreId: "" });
  const [conns, setConns] = useState<{ provider: string; connected: boolean }[]>([]);
  const [pathaoForm, setPathaoForm] = useState({ clientId: "", clientSecret: "", username: "", password: "", sandbox: false });
  const [redxForm, setRedxForm] = useState({ accessToken: "", baseUrl: "" });
  const [pStores, setPStores] = useState<any[]>([]);
  const [pCities, setPCities] = useState<any[]>([]);
  const [pZones, setPZones] = useState<any[]>([]);
  const [pAreas, setPAreas] = useState<any[]>([]);
  const [rAreas, setRAreas] = useState<any[]>([]);
  const [rStores, setRStores] = useState<any[]>([]);
  const [courierBusy, setCourierBusy] = useState("");
  const [courierNotice, setCourierNotice] = useState("");
  const [quoteOut, setQuoteOut] = useState<any>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [riskDetail, setRiskDetail] = useState<(RiskDetail & { orderLabel: string }) | null>(null);

  async function showRisk(o: Order) {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const r = await apiFetch<RiskDetail>(`/organizations/${orgId}/orders/${o.id}/risk`);
      setRiskDetail({ ...r, orderLabel: `#${o.externalNumber ?? o.id.slice(0, 8)}` });
    } catch { /* endpoint is advisory */ }
  }

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); setLoading(false); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ pageSize: "50" });
      if (status) params.set("status", status);
      if (codOnly) params.set("cod", "true");
      const [list, st] = await Promise.all([
        apiFetch<{ total: number; items: Order[] }>(`/organizations/${orgId}/orders?${params}`),
        apiFetch<Stats>(`/organizations/${orgId}/orders/stats`),
      ]);
      setItems(list.items); setTotal(list.total); setStats(st); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load orders"); }
    finally { setLoading(false); }
  }, [status, codOnly]);

  useEffect(() => { load(); }, [load]);

  const loadCourier = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const [conn, ships, allConns] = await Promise.all([
        apiFetch<{ connected: boolean }>(`/organizations/${orgId}/courier/connection`),
        apiFetch<Shipment[]>(`/organizations/${orgId}/courier/shipments`),
        apiFetch<{ provider: string; connected: boolean }[]>(`/organizations/${orgId}/courier/connections`).catch(() => []),
      ]);
      setCourier(conn); setShipments(ships); setConns(allConns as any);
    } catch { /* courier is optional */ }
  }, []);
  useEffect(() => { loadCourier(); }, [loadCourier]);
  const shipmentFor = (orderId: string) => shipments.find((s) => s.orderId === orderId);

  async function connectCourier(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setCourierBusy("connect"); setCourierNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/courier/connect`, { method: "POST", body: JSON.stringify(courierForm) });
      setCourierNotice("Steadfast যুক্ত হয়েছে (আসল API দিয়ে যাচাই করা)।");
      setCourierForm({ apiKey: "", secretKey: "" });
      await loadCourier();
    } catch (err) { setCourierNotice(err instanceof Error ? err.message : "Connect ব্যর্থ"); }
    finally { setCourierBusy(""); }
  }
  async function loadProviderLists(provider: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      if (provider === "pathao") {
        const [stores, cities] = await Promise.all([
          apiFetch<any[]>(`/organizations/${orgId}/courier/pathao/stores`).catch(() => []),
          apiFetch<any[]>(`/organizations/${orgId}/courier/pathao/cities`).catch(() => []),
        ]);
        setPStores(stores); setPCities(cities);
      } else if (provider === "redx") {
        const [areas, stores] = await Promise.all([
          apiFetch<any[]>(`/organizations/${orgId}/courier/redx/areas`).catch(() => []),
          apiFetch<any[]>(`/organizations/${orgId}/courier/redx/stores`).catch(() => []),
        ]);
        setRAreas(areas); setRStores(stores);
      }
    } catch { /* pickers stay empty; booking explains via API errors */ }
  }

  async function connectPathao(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setCourierBusy("pathao"); setCourierNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/courier/connect`, { method: "POST", body: JSON.stringify({ provider: "pathao", clientId: pathaoForm.clientId, clientSecret: pathaoForm.clientSecret, username: pathaoForm.username, password: pathaoForm.password, baseUrl: pathaoForm.sandbox ? "https://courier-api-sandbox.pathao.com" : undefined }) });
      setCourierNotice("Pathao যুক্ত হয়েছে (আসল API দিয়ে Token ও Store যাচাই করা)।");
      setPathaoForm({ clientId: "", clientSecret: "", username: "", password: "", sandbox: false });
      await loadCourier();
    } catch (err) { setCourierNotice(err instanceof Error ? err.message : "Pathao connect ব্যর্থ"); }
    finally { setCourierBusy(""); }
  }

  async function connectRedx(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setCourierBusy("redx"); setCourierNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/courier/connect`, { method: "POST", body: JSON.stringify({ provider: "redx", accessToken: redxForm.accessToken, baseUrl: redxForm.baseUrl || undefined }) });
      setCourierNotice("RedX যুক্ত হয়েছে (আসল API দিয়ে Area তালিকা যাচাই করা)।");
      setRedxForm({ accessToken: "", baseUrl: "" });
      await loadCourier();
    } catch (err) { setCourierNotice(err instanceof Error ? err.message : "RedX connect ব্যর্থ"); }
    finally { setCourierBusy(""); }
  }

  async function disconnectProvider(provider: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await apiFetch(`/organizations/${orgId}/courier/connection?provider=${provider}`, { method: "DELETE" }).catch(() => undefined);
    await loadCourier();
  }

  async function fetchQuote(order: Order) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setQuoteBusy(true); setQuoteOut(null);
    try {
      const q = await apiFetch<any>(`/organizations/${orgId}/courier/quote`, {
        method: "POST",
        body: JSON.stringify({
          provider: bookForm.provider, orderId: order.id,
          weightKg: Number(bookForm.weightKg) || 0.5,
          pathao: bookForm.provider === "pathao" ? {
            storeId: bookForm.pStoreId ? Number(bookForm.pStoreId) : undefined,
            cityId: bookForm.pCityId ? Number(bookForm.pCityId) : undefined,
            zoneId: bookForm.pZoneId ? Number(bookForm.pZoneId) : undefined,
            itemWeightKg: Number(bookForm.weightKg) || 0.5,
          } : undefined,
          redx: bookForm.provider === "redx" ? {
            deliveryAreaId: bookForm.rAreaId ? Number(bookForm.rAreaId) : undefined,
            parcelWeightKg: Number(bookForm.weightKg) || 0.5,
          } : undefined,
        }),
      });
      setQuoteOut(q);
    } catch (err) { setQuoteOut({ quotable: false, reason: err instanceof Error ? err.message : "চার্জ জানা যায়নি" }); }
    finally { setQuoteBusy(false); }
  }

  async function bookShipment(order: Order) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setCourierBusy("book"); setCourierNotice("");
    try {
      const s = await apiFetch<Shipment>(`/organizations/${orgId}/courier/shipments`, {
        method: "POST",
        body: JSON.stringify({
          orderId: order.id, provider: bookForm.provider,
          recipientName: bookForm.name || undefined, recipientPhone: bookForm.phone || undefined,
          recipientAddress: bookForm.address, note: bookForm.note || undefined,
          pathao: bookForm.provider === "pathao" ? {
            storeId: bookForm.pStoreId ? Number(bookForm.pStoreId) : undefined,
            cityId: bookForm.pCityId ? Number(bookForm.pCityId) : undefined,
            zoneId: bookForm.pZoneId ? Number(bookForm.pZoneId) : undefined,
            areaId: bookForm.pAreaId ? Number(bookForm.pAreaId) : undefined,
            itemWeightKg: Number(bookForm.weightKg) || 0.5,
          } : undefined,
          redx: bookForm.provider === "redx" ? {
            deliveryAreaId: bookForm.rAreaId ? Number(bookForm.rAreaId) : undefined,
            deliveryArea: bookForm.rAreaName || undefined,
            pickupStoreId: bookForm.rStoreId ? Number(bookForm.rStoreId) : undefined,
            parcelWeightKg: Number(bookForm.weightKg) || 0.5,
          } : undefined,
        }),
      });
      setCourierNotice(`পার্সেল বুক হয়েছে — Tracking: ${s.trackingCode} (স্ট্যাটাস: ${s.status})`);
      setBookingFor(null);
      await loadCourier();
    } catch (err) { setCourierNotice(err instanceof Error ? err.message : "Booking ব্যর্থ"); }
    finally { setCourierBusy(""); }
  }
  // Milestone 53: binary PDF download (apiFetch is JSON-only, so fetch the blob directly).
  async function downloadPdf(path: string, filename: string) {
    try {
      const res = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
      if (!res.ok) { const body: any = await res.json().catch(() => ({})); throw new Error(body?.message ?? `HTTP ${res.status}`); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) { setCourierNotice(err instanceof Error ? err.message : "PDF ডাউনলোড ব্যর্থ"); }
  }

  function toggleSelect(orderId: string, on: boolean) {
    setSelected((prev) => {
      if (on) return prev.includes(orderId) || prev.length >= 50 ? prev : [...prev, orderId];
      return prev.filter((x) => x !== orderId);
    });
  }

  async function bulkBook() {
    const orgId = getOrganizationId(); if (!orgId || selected.length === 0) return;
    setBulkBusy(true); setBulkResults(null);
    try {
      const out = await apiFetch<any>(`/organizations/${orgId}/courier/shipments/bulk`, {
        method: "POST",
        body: JSON.stringify({
          provider: bulkProvider, orderIds: selected,
          pathao: bulkProvider === "pathao" ? {} : undefined,
          redx: bulkProvider === "redx" ? {
            deliveryAreaId: bookForm.rAreaId ? Number(bookForm.rAreaId) : undefined,
            deliveryArea: bookForm.rAreaName || undefined,
            parcelWeightKg: 0.5,
          } : undefined,
        }),
      });
      setBulkResults(out);
      setCourierNotice(`বাল্ক বুকিং শেষ: ${out.booked}টি বুক হয়েছে, ${out.skipped}টি আগে থেকেই বুক ছিল, ${out.failed}টি ব্যর্থ${out.failed || out.skipped ? " (আংশিক সফল)" : ""}`);
      await loadCourier();
    } catch (err) { setCourierNotice(err instanceof Error ? err.message : "বাল্ক বুকিং ব্যর্থ"); }
    finally { setBulkBusy(false); }
  }

  async function bulkLabels() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const ids = selected.map((oid) => shipmentFor(oid)?.id).filter(Boolean) as string[];
    if (ids.length === 0) { setCourierNotice("বেছে নেওয়া অর্ডারগুলোর কোনো পার্সেল এখনো বুক হয়নি"); return; }
    await downloadPdf(`/organizations/${orgId}/courier/labels.pdf?ids=${ids.join(",")}`, "labels.pdf");
  }

  async function syncShipment(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setCourierBusy("sync");
    try { const s = await apiFetch<Shipment>(`/organizations/${orgId}/courier/shipments/${id}/sync`, { method: "POST" }); setCourierNotice(`স্ট্যাটাস আপডেট: ${s.status}`); await loadCourier(); }
    catch (err) { setCourierNotice(err instanceof Error ? err.message : "Sync ব্যর্থ"); }
    finally { setCourierBusy(""); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Orders</h1>
        <p className="text-sm text-slate-500">মোট {total}টি অর্ডার (বর্তমান ফিল্টারে)। Delivered Revenue শুধুমাত্র completed অর্ডার থেকে হিসাব হয়।</p>
        <a href="/dashboard/orders/manual" className="mt-2 inline-block text-sm font-semibold text-blue-600">+ ম্যানুয়াল অর্ডার / CSV ইমপোর্ট →</a>
      </div>
      {stats ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard label="মোট অর্ডার" value={String(stats.totalOrders)} />
          <KpiCard label="COD অর্ডার" value={String(stats.codOrders)} hint={`মোটের ${stats.codSharePercent}%`} />
          <KpiCard label="Delivered Revenue" value={formatMinor(BigInt(stats.deliveredRevenueMinor))} hint="শুধু completed" />
          <KpiCard label="স্ট্যাটাস" value={stats.byStatus.map((s) => `${s.status}: ${s.count}`).join(" · ") || "—"} />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <select className="rounded-lg border bg-white px-3 py-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s === "" ? "সব স্ট্যাটাস" : s}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={codOnly} onChange={(e) => setCodOnly(e.target.checked)} /> শুধু COD</label>
      </div>
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">🚚 কুরিয়ার — Steadfast</h2>
          <span className={courier?.connected ? "badge-green" : "badge-slate"}>{courier?.connected ? "যুক্ত আছে" : "যুক্ত নেই"}</span>
        </div>
        {courierNotice ? <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700">{courierNotice}</p> : null}
        {courier?.connected ? (
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary btn-sm" disabled={courierBusy !== ""} onClick={async () => {
              const orgId = getOrganizationId(); if (!orgId) return;
              setCourierBusy("syncall");
              try { const r = await apiFetch<{ checked: number; changed: number; errors: string[] }>(`/organizations/${orgId}/courier/sync-all`, { method: "POST" }); setCourierNotice(`Sync সম্পন্ন: ${r.checked}টি যাচাই, ${r.changed}টি স্ট্যাটাস বদলেছে${r.errors.length ? ` · ত্রুটি: ${r.errors[0]}` : ""}`); await loadCourier(); }
              catch (err) { setCourierNotice(err instanceof Error ? err.message : "Sync ব্যর্থ"); }
              finally { setCourierBusy(""); }
            }}>সব পার্সেলের স্ট্যাটাস Sync</button>
            <button className="btn-ghost btn-sm text-red-600" onClick={async () => {
              const orgId = getOrganizationId(); if (!orgId) return;
              await apiFetch(`/organizations/${orgId}/courier/connection`, { method: "DELETE" }).catch(() => undefined);
              await loadCourier();
            }}>সংযোগ বিচ্ছিন্ন</button>
          </div>
        ) : (
          <form onSubmit={connectCourier} className="grid gap-2 sm:grid-cols-3">
            <input className="input" placeholder="Steadfast API Key" value={courierForm.apiKey} onChange={(e) => setCourierForm({ ...courierForm, apiKey: e.target.value })} required />
            <input className="input" placeholder="Secret Key" value={courierForm.secretKey} onChange={(e) => setCourierForm({ ...courierForm, secretKey: e.target.value })} required />
            <button className="btn-primary" disabled={courierBusy !== ""}>{courierBusy === "connect" ? "যাচাই হচ্ছে..." : "যাচাই করে যুক্ত করুন"}</button>
            <p className="text-xs text-slate-400 sm:col-span-3">Key Steadfast Portal থেকে পাবেন। যুক্ত করার আগে আসল API দিয়ে Balance যাচাই করা হয়; ভুল Key হলে Steadfast এর নিজের ত্রুটিই দেখাবে।</p>
          </form>
        )}
      </div>
      <div className="card space-y-4">
        <h2 className="font-semibold">🚚 আরও কুরিয়ার — Pathao / RedX</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2 rounded-xl bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium">Pathao Courier</span>
              <span className={conns.find((c) => c.provider === "pathao")?.connected ? "badge-green" : "badge-slate"}>{conns.find((c) => c.provider === "pathao")?.connected ? "যুক্ত আছে" : "যুক্ত নেই"}</span>
            </div>
            {conns.find((c) => c.provider === "pathao")?.connected ? (
              <button className="btn-ghost btn-sm text-red-600" onClick={() => disconnectProvider("pathao")}>সংযোগ বিচ্ছিন্ন</button>
            ) : (
              <form onSubmit={connectPathao} className="grid gap-2">
                <input className="input" placeholder="Client ID" value={pathaoForm.clientId} onChange={(e) => setPathaoForm({ ...pathaoForm, clientId: e.target.value })} required />
                <input className="input" placeholder="Client Secret" value={pathaoForm.clientSecret} onChange={(e) => setPathaoForm({ ...pathaoForm, clientSecret: e.target.value })} required />
                <input className="input" placeholder="Merchant ইমেইল (Username)" value={pathaoForm.username} onChange={(e) => setPathaoForm({ ...pathaoForm, username: e.target.value })} required />
                <input className="input" type="password" placeholder="Merchant পাসওয়ার্ড" value={pathaoForm.password} onChange={(e) => setPathaoForm({ ...pathaoForm, password: e.target.value })} required />
                <label className="flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" checked={pathaoForm.sandbox} onChange={(e) => setPathaoForm({ ...pathaoForm, sandbox: e.target.checked })} /> Sandbox (টেস্ট) পরিবেশ</label>
                <button className="btn-primary btn-sm" disabled={courierBusy !== ""}>{courierBusy === "pathao" ? "যাচাই হচ্ছে..." : "যাচাই করে যুক্ত করুন"}</button>
                <p className="text-xs text-slate-400">Client ID/Secret Pathao Merchant Panel এর Developer API অংশে পাবেন। যুক্ত করার আগে আসল API তে Token নিয়ে Store তালিকা যাচাই করা হয়। পাসওয়ার্ড Token নবায়নের জন্য এনক্রিপ্ট করে রাখা হয়।</p>
              </form>
            )}
          </div>
          <div className="space-y-2 rounded-xl bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium">RedX</span>
              <span className={conns.find((c) => c.provider === "redx")?.connected ? "badge-green" : "badge-slate"}>{conns.find((c) => c.provider === "redx")?.connected ? "যুক্ত আছে" : "যুক্ত নেই"}</span>
            </div>
            {conns.find((c) => c.provider === "redx")?.connected ? (
              <button className="btn-ghost btn-sm text-red-600" onClick={() => disconnectProvider("redx")}>সংযোগ বিচ্ছিন্ন</button>
            ) : (
              <form onSubmit={connectRedx} className="grid gap-2">
                <input className="input" placeholder="API Access Token" value={redxForm.accessToken} onChange={(e) => setRedxForm({ ...redxForm, accessToken: e.target.value })} required />
                <input className="input" placeholder="Base URL (ঐচ্ছিক — Legacy অ্যাকাউন্টের জন্য)" value={redxForm.baseUrl} onChange={(e) => setRedxForm({ ...redxForm, baseUrl: e.target.value })} />
                <button className="btn-primary btn-sm" disabled={courierBusy !== ""}>{courierBusy === "redx" ? "যাচাই হচ্ছে..." : "যাচাই করে যুক্ত করুন"}</button>
                <p className="text-xs text-slate-400">Token RedX Merchant Panel এর API Settings থেকে পাবেন। যুক্ত করার আগে আসল API থেকে Delivery Area তালিকা এনে যাচাই করা হয়।</p>
              </form>
            )}
          </div>
        </div>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {riskDetail ? (
        <div className="card space-y-2 border-amber-200 bg-amber-50/60">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">↩️ রিটার্ন ঝুঁকি — অর্ডার {riskDetail.orderLabel} <span className={`ml-2 rounded px-2 py-0.5 text-xs font-semibold ${RISK_LABEL[riskDetail.band]?.cls ?? ""}`}>{RISK_LABEL[riskDetail.band]?.text ?? riskDetail.band}{riskDetail.score != null ? ` · স্কোর ${riskDetail.score}/১০০` : ""}</span></h3>
            <button className="btn-ghost btn-sm" onClick={() => setRiskDetail(null)}>বন্ধ করুন</button>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            {riskDetail.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
          {riskDetail.suggestion ? <p className="text-sm font-medium text-amber-800">{riskDetail.suggestion}</p> : null}
          <p className="text-xs text-slate-400">স্কোরটি শুধু এই দোকানের নিজের অর্ডার ইতিহাস থেকে হিসাব করা (ফোন নম্বর মিলিয়ে)। এটি কোনো অর্ডার আটকায় না — সিদ্ধান্ত সবসময় আপনার।</p>
        </div>
      ) : null}
      {loading ? <p className="text-sm text-slate-500">লোড হচ্ছে...</p> : items.length === 0 ? (
        <EmptyState title="কোনো অর্ডার নেই" description="Stores & Integrations থেকে WooCommerce কানেক্ট করে Sync Orders চালান। অর্ডার Sync হলে এখানে দেখা যাবে।" />
      ) : (
        <>
        {selected.length > 0 ? (
          <div className="card space-y-3 border-indigo-200 bg-indigo-50/60">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{selected.length}টি অর্ডার বেছে নেওয়া হয়েছে (সর্বোচ্চ ৫০)</span>
              <select className="input w-auto" value={bulkProvider} onChange={async (e) => { setBulkProvider(e.target.value); await loadProviderLists(e.target.value); }}>
                {(["steadfast", "pathao", "redx"] as const).map((p) => {
                  const c = conns.find((x) => x.provider === p);
                  const connected = c ? c.connected : p === "steadfast" ? !!courier?.connected : false;
                  return <option key={p} value={p} disabled={!connected}>{p === "steadfast" ? "Steadfast" : p === "pathao" ? "Pathao" : "RedX"}{connected ? "" : " (যুক্ত নেই)"}</option>;
                })}
              </select>
              {bulkProvider === "redx" ? (
                <select className="input w-auto" value={bookForm.rAreaId} onChange={(e) => { const area = rAreas.find((a: any) => String(a.id) === e.target.value); setBookForm({ ...bookForm, rAreaId: e.target.value, rAreaName: area?.name ?? "" }); }}>
                  <option value="">RedX ডেলিভারি এলাকা বেছে নিন</option>
                  {rAreas.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              ) : null}
              <button className="btn-primary btn-sm" disabled={bulkBusy} onClick={bulkBook}>{bulkBusy ? "বুক হচ্ছে..." : `🚚 একসাথে বুক করুন (${selected.length}টি)`}</button>
              <button className="btn-secondary btn-sm" onClick={bulkLabels}>🏷️ সব লেবেল এক PDF এ</button>
              <button className="btn-ghost btn-sm" onClick={() => { setSelected([]); setBulkResults(null); }}>সিলেকশন মুছুন</button>
            </div>
            <p className="text-xs text-slate-500">ঠিকানা প্রতিটি অর্ডারের নিজের সংরক্ষিত ঠিকানা থেকে নেওয়া হয়। যেটি আগে থেকেই বুক করা, সেটি আবার বুক হবে না — ফলাফলে আলাদা করে দেখানো হবে। একটি ব্যর্থ হলেও বাকিগুলো চলতে থাকবে।</p>
            {bulkResults ? (
              <div className="space-y-1 text-sm">
                <p className="font-medium">ফলাফল: {bulkResults.booked}টি বুক হয়েছে · {bulkResults.skipped}টি আগে থেকেই বুক ছিল · {bulkResults.failed}টি ব্যর্থ</p>
                <ul className="space-y-0.5">
                  {bulkResults.results.map((r) => { const o = items.find((x) => x.id === r.orderId); return (
                    <li key={r.orderId} className={r.ok ? "text-emerald-700" : r.skipped ? "text-amber-700" : "text-red-600"}>
                      {r.ok ? "✓" : r.skipped ? "⏭" : "✗"} #{o?.externalNumber ?? r.orderId.slice(0, 8)} — {r.ok ? `Tracking: ${r.trackingCode}` : r.error}
                    </li> ); })}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="overflow-hidden card">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500"><tr>
              <th className="px-4 py-3"><input type="checkbox" checked={items.length > 0 && items.every((o) => selected.includes(o.id))} onChange={(e) => setSelected(e.target.checked ? items.slice(0, 50).map((o) => o.id) : [])} /></th>
              <th className="px-4 py-3">অর্ডার</th><th className="px-4 py-3">কাস্টমার</th><th className="px-4 py-3">আইটেম</th>
              <th className="px-4 py-3">স্ট্যাটাস</th><th className="px-4 py-3">পেমেন্ট</th><th className="px-4 py-3">মোট</th><th className="px-4 py-3">তারিখ</th><th className="px-4 py-3">কুরিয়ার</th>
            </tr></thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.id} className="border-t">
                  <td className="px-4 py-3"><input type="checkbox" checked={selected.includes(o.id)} disabled={!selected.includes(o.id) && selected.length >= 50} onChange={(e) => toggleSelect(o.id, e.target.checked)} /></td>
                  <td className="px-4 py-3 font-medium">#{o.externalNumber ?? o.id.slice(0, 8)}<button className="block text-[11px] font-semibold text-brand-600 hover:underline" onClick={() => { const orgId = getOrganizationId(); if (orgId) void downloadPdf(`/organizations/${orgId}/courier/orders/${o.id}/invoice.pdf`, `invoice-${o.externalNumber ?? o.id}.pdf`); }}>🧾 ইনভয়েস PDF</button></td>
                  <td className="px-4 py-3">{[o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(" ") || "—"}<div className="text-xs text-slate-400">{o.customer?.phone ?? o.customer?.email ?? ""}</div></td>
                  <td className="px-4 py-3">{o.items?.map((i) => `${i.name} ×${i.quantity}`).join(", ") ?? "—"}</td>
                  <td className="px-4 py-3"><span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium">{o.status}</span>
                    {o.risk ? (
                      <button className={`mt-1 block rounded px-2 py-0.5 text-[11px] font-semibold ${RISK_LABEL[o.risk.band]?.cls ?? RISK_LABEL.unknown.cls}`}
                        title="রিটার্ন ঝুঁকির কারণ দেখুন" onClick={() => showRisk(o)}>
                        {RISK_LABEL[o.risk.band]?.text ?? "ঝুঁকি"}{o.risk.score != null ? ` · ${o.risk.score}` : ""}
                      </button>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{o.isCod ? <span className="font-semibold text-amber-600">COD</span> : (o.paymentMethod ?? "—")}</td>
                  <td className="px-4 py-3">{formatMinor(BigInt(o.totalMinor))}</td>
                  <td className="px-4 py-3">{o.placedAt ? new Date(o.placedAt).toLocaleDateString() : "—"}</td>
                  <td className="px-4 py-3">
                    {(() => { const sh = shipmentFor(o.id); return sh ? (
                      <span className="inline-flex items-center gap-1" title={sh.provider}>
                        <span className="badge-indigo" title={sh.trackingCode ?? ""}>🚚 {sh.status}</span>
                        <button className="text-xs font-semibold text-brand-600 hover:underline" disabled={courierBusy !== ""} onClick={() => syncShipment(sh.id)}>স্ট্যাটাস যাচাই</button>
                        <button className="text-xs font-semibold text-brand-600 hover:underline" onClick={() => { const orgId = getOrganizationId(); if (orgId) void downloadPdf(`/organizations/${orgId}/courier/shipments/${sh.id}/label.pdf`, `label-${sh.trackingCode ?? sh.id}.pdf`); }}>🏷️ লেবেল</button>
                      </span>
                    ) : courier?.connected ? (
                      <button className="text-xs font-semibold text-brand-600 hover:underline" onClick={async () => {
                        const opening = bookingFor !== o.id;
                        setBookingFor(opening ? o.id : null);
                        setQuoteOut(null);
                        const firstConnected = conns.find((c) => c.connected)?.provider ?? "steadfast";
                        setBookForm({ name: [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(" "), phone: o.customer?.phone ?? "", address: "", note: "", provider: firstConnected, pStoreId: "", pCityId: "", pZoneId: "", pAreaId: "", weightKg: "0.5", rAreaId: "", rAreaName: "", rStoreId: "" });
                        if (opening) await loadProviderLists(firstConnected);
                      }}>পার্সেল বুক করুন</button>
                    ) : <span className="text-xs text-slate-400">—</span>; })()}
                  </td>
                </tr>
              ))}
              {bookingFor ? (() => { const order = items.find((x) => x.id === bookingFor); if (!order) return null; return (
                <tr className="border-t bg-indigo-50/60"><td colSpan={9} className="px-4 py-3">
                  <div className="grid gap-2 sm:grid-cols-4">
                    <select className="input" value={bookForm.provider} onChange={async (e) => { setBookForm({ ...bookForm, provider: e.target.value }); setQuoteOut(null); await loadProviderLists(e.target.value); }}>
                      {(["steadfast", "pathao", "redx"] as const).map((p) => {
                        const c = conns.find((x) => x.provider === p);
                        return <option key={p} value={p} disabled={c ? !c.connected : p !== "steadfast" ? true : !(courier?.connected)}>{p === "steadfast" ? "Steadfast" : p === "pathao" ? "Pathao" : "RedX"}{c && !c.connected ? " (যুক্ত নেই)" : ""}</option>;
                      })}
                    </select>
                    <input className="input" placeholder="প্রাপকের নাম" value={bookForm.name} onChange={(e) => setBookForm({ ...bookForm, name: e.target.value })} />
                    <input className="input" placeholder="ফোন" value={bookForm.phone} onChange={(e) => setBookForm({ ...bookForm, phone: e.target.value })} />
                    <input className="input" placeholder="ওজন (কেজি)" type="number" step="0.5" min="0.5" value={bookForm.weightKg} onChange={(e) => setBookForm({ ...bookForm, weightKg: e.target.value })} />
                    <input className="input sm:col-span-2" placeholder="পূর্ণ ঠিকানা (বাসা, রোড, এলাকা, জেলা)" value={bookForm.address} onChange={(e) => setBookForm({ ...bookForm, address: e.target.value })} />
                    <input className="input sm:col-span-2" placeholder="নোট (ঐচ্ছিক)" value={bookForm.note} onChange={(e) => setBookForm({ ...bookForm, note: e.target.value })} />
                    {bookForm.provider === "pathao" ? (<>
                      <select className="input" value={bookForm.pStoreId} onChange={(e) => setBookForm({ ...bookForm, pStoreId: e.target.value })}>
                        <option value="">স্টোর: স্বয়ংক্রিয় (প্রথম সক্রিয়)</option>
                        {pStores.map((s: any) => <option key={s.store_id} value={s.store_id}>{s.store_name}</option>)}
                      </select>
                      <select className="input" value={bookForm.pCityId} onChange={async (e) => {
                        const cityId = e.target.value;
                        setBookForm({ ...bookForm, pCityId: cityId, pZoneId: "", pAreaId: "" }); setPZones([]); setPAreas([]);
                        if (cityId) { const orgId = getOrganizationId(); if (orgId) setPZones(await apiFetch<any[]>(`/organizations/${orgId}/courier/pathao/zones/${cityId}`).catch(() => [])); }
                      }}>
                        <option value="">শহর: ঠিকানা থেকে অনুমান (ঐচ্ছিক)</option>
                        {pCities.map((c: any) => <option key={c.city_id} value={c.city_id}>{c.city_name}</option>)}
                      </select>
                      <select className="input" value={bookForm.pZoneId} onChange={async (e) => {
                        const zoneId = e.target.value;
                        setBookForm({ ...bookForm, pZoneId: zoneId, pAreaId: "" }); setPAreas([]);
                        if (zoneId) { const orgId = getOrganizationId(); if (orgId) setPAreas(await apiFetch<any[]>(`/organizations/${orgId}/courier/pathao/areas/${zoneId}`).catch(() => [])); }
                      }}>
                        <option value="">জোন (ঐচ্ছিক)</option>
                        {pZones.map((z: any) => <option key={z.zone_id} value={z.zone_id}>{z.zone_name}</option>)}
                      </select>
                      <select className="input" value={bookForm.pAreaId} onChange={(e) => setBookForm({ ...bookForm, pAreaId: e.target.value })}>
                        <option value="">এলাকা (ঐচ্ছিক)</option>
                        {pAreas.map((a: any) => <option key={a.area_id} value={a.area_id}>{a.area_name}</option>)}
                      </select>
                    </>) : null}
                    {bookForm.provider === "redx" ? (<>
                      <select className="input sm:col-span-2" value={bookForm.rAreaId} onChange={(e) => {
                        const area = rAreas.find((a: any) => String(a.id) === e.target.value);
                        setBookForm({ ...bookForm, rAreaId: e.target.value, rAreaName: area?.name ?? "" });
                      }}>
                        <option value="">ডেলিভারি এলাকা বেছে নিন (আবশ্যক)</option>
                        {rAreas.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                      <select className="input" value={bookForm.rStoreId} onChange={(e) => setBookForm({ ...bookForm, rStoreId: e.target.value })}>
                        <option value="">পিকআপ স্টোর: ডিফল্ট</option>
                        {rStores.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </>) : null}
                    <div className="flex flex-wrap items-center gap-2 sm:col-span-4">
                      <button className="btn-secondary btn-sm" disabled={quoteBusy} onClick={() => fetchQuote(order)}>{quoteBusy ? "হিসাব হচ্ছে..." : "💰 ডেলিভারি চার্জ দেখুন"}</button>
                      {quoteOut ? (quoteOut.quotable ? (
                        <span className="text-xs font-semibold text-emerald-700">ডেলিভারি চার্জ: {formatMinor(BigInt(quoteOut.chargeMinor ?? 0))} <span className="font-normal text-slate-500">({quoteOut.provider === "pathao" ? "Pathao" : "RedX"} এর নিজের প্রাইস API থেকে — বুকিংয়ের আগে)</span></span>
                      ) : (
                        <span className="text-xs text-amber-700">{quoteOut.reason}</span>
                      )) : null}
                    </div>
                    <button className="btn-primary" disabled={courierBusy !== "" || bookForm.address.trim().length < 8 || (bookForm.provider === "redx" && !bookForm.rAreaId)} onClick={() => bookShipment(order)}>{courierBusy === "book" ? "বুক হচ্ছে..." : `${bookForm.provider === "pathao" ? "Pathao" : bookForm.provider === "redx" ? "RedX" : "Steadfast"} এ বুক করুন${order.isCod ? ` (COD ${formatMinor(BigInt(order.totalMinor))})` : ""}`}</button>
                  </div>
                </td></tr>
              ); })() : null}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
