"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";

// GET /organizations/:id/stores returns the full Store rows
// (IntegrationsService.listStores), so refundPushEnabled /
// courierTrackingMetaKey are present at runtime.
interface Store { id: string; name: string; url?: string; platform?: string; syncMode?: string; refundPushEnabled?: boolean; courierTrackingMetaKey?: string | null }
interface Listing {
  id: string; storeId: string; productId: string; externalId: string | null;
  publishState: string; syncStatus: string; lastSyncError?: string | null;
  lastRemoteUpdatedAt?: string | null; updatedAt: string;
  product?: { name: string; sku: string | null } | null;
  store?: { name: string; platform: string } | null;
}
interface ListingSummary { total: number; synced: number; pending: number; failed: number; conflict: number }
interface OutboxItem {
  id: string; storeId: string; entityType: string; entityId: string; operation: string;
  status: string; attempts: number; lastError?: string | null; nextRetryAt?: string | null; createdAt: string;
}
interface Conflict {
  id: string; storeId: string; listingId: string; field: string; localValue: unknown; remoteValue: unknown; status: string; createdAt: string;
  listing?: { product?: { name: string } | null; store?: { name: string } | null } | null;
  store?: { name: string } | null;
  product?: { name: string } | null;
}
interface StoreLocation { id: string; name: string; externalLocationId: string | null; isDefault: boolean }

const PAGE_SIZE = 20;

const SYNC_MODES: { value: string; label: string; desc: string }[] = [
  { value: "mirror", label: "Mirror", desc: "শুধু স্টোর থেকে আসবে, এখানকার পরিবর্তন স্টোরে যাবে না" },
  { value: "co-manage", label: "Co-manage", desc: "অর্ডারের স্ট্যাটাস/ফুলফিলমেন্ট/রিফান্ড স্টোরে যাবে" },
  { value: "full-manage", label: "Full-manage", desc: "প্রোডাক্ট/দাম/স্টকসহ সব যাবে" },
];

function outboxBadge(status: string): string {
  switch (status) {
    case "pending": return "bg-amber-100 text-amber-700";
    case "processing": return "bg-blue-100 text-blue-700";
    case "done": return "bg-green-100 text-green-700";
    case "failed": return "bg-red-100 text-red-700";
    case "dead": return "bg-red-700 text-white";
    default: return "bg-slate-200 text-slate-600";
  }
}

function listingBadge(status: string): string {
  switch (status) {
    case "synced": return "bg-green-100 text-green-700";
    case "pending": return "bg-amber-100 text-amber-700";
    case "failed": return "bg-red-100 text-red-700";
    case "conflict": return "bg-purple-100 text-purple-700";
    default: return "bg-slate-200 text-slate-600";
  }
}

export default function SyncCenterPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState(""); // "" = সব স্টোর
  const [summary, setSummary] = useState<ListingSummary | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [outboxTotal, setOutboxTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [conflictsError, setConflictsError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  // EC4: conflict resolve confirm + store locations.
  const [confirmConflict, setConfirmConflict] = useState<{ id: string; choice: "keep_local" | "take_remote" } | null>(null);
  const [locations, setLocations] = useState<StoreLocation[]>([]);
  const [locationsError, setLocationsError] = useState("");
  const [locationsBusy, setLocationsBusy] = useState("");
  const [locForm, setLocForm] = useState({ name: "", externalLocationId: "", isDefault: false });
  // EC5: refund-push gate (OWNER-only) + courier tracking meta key.
  const [refundBusy, setRefundBusy] = useState(false);
  const [refundError, setRefundError] = useState("");
  const [trackingKey, setTrackingKey] = useState("");
  const [trackingBusy, setTrackingBusy] = useState(false);
  const [trackingError, setTrackingError] = useState("");
  const [trackingNotice, setTrackingNotice] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); return; }
    try {
      const qs = storeId ? `?storeId=${encodeURIComponent(storeId)}` : "";
      const [s, l, o, c] = await Promise.all([
        apiFetch<Store[]>(`/organizations/${orgId}/stores`),
        apiFetch<{ summary: ListingSummary; items: Listing[] }>(`/organizations/${orgId}/commerce/listings${qs}`),
        apiFetch<{ items: OutboxItem[]; total: number; page: number; pageSize: number }>(
          `/organizations/${orgId}/commerce/outbox?${new URLSearchParams({
            ...(storeId ? { storeId } : {}),
            ...(statusFilter ? { status: statusFilter } : {}),
            page: String(page), pageSize: String(PAGE_SIZE),
          }).toString()}`,
        ),
        apiFetch<Conflict[]>(`/organizations/${orgId}/commerce/conflicts`).then((rows) => { setConflictsError(""); return rows; }).catch((e) => {
          // A failed load must never render as "no conflicts".
          setConflictsError(e instanceof Error ? e.message : "Conflict তালিকা লোড ব্যর্থ হয়েছে");
          return [] as Conflict[];
        }),
      ]);
      setStores(s);
      setSummary(l.summary);
      setListings(l.items);
      setOutbox(o.items);
      setOutboxTotal(o.total);
      setConflicts(c);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
  }, [storeId, statusFilter, page]);

  useEffect(() => { load(); }, [load]);

  const selectedStore = stores.find((s) => s.id === storeId) ?? null;
  const totalPages = Math.max(1, Math.ceil(outboxTotal / PAGE_SIZE));

  // Keep the tracking-key input in step with the selected store.
  const selectedTrackingKey = selectedStore?.courierTrackingMetaKey ?? "";
  useEffect(() => {
    setTrackingKey(selectedTrackingKey);
    setRefundError(""); setTrackingError(""); setTrackingNotice("");
  }, [storeId, selectedTrackingKey]);

  async function changeSyncMode(syncMode: string) {
    const orgId = getOrganizationId(); if (!orgId || !selectedStore) return;
    setError(""); setNotice(""); setBusy("sync-mode");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/stores/${selectedStore.id}/sync-mode`, {
        method: "PATCH", body: JSON.stringify({ syncMode }),
      });
      setNotice(`"${selectedStore.name}" স্টোরের Sync মোড এখন ${syncMode}।`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Sync মোড বদলানো ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function toggleRefundPush(enabled: boolean) {
    const orgId = getOrganizationId(); if (!orgId || !selectedStore) return;
    setRefundBusy(true); setRefundError(""); setNotice("");
    try {
      // The PATCH response is the full updated Store row — trust it
      // for the local state instead of refetching everything.
      const updated = await apiFetch<Store>(`/organizations/${orgId}/commerce/stores/${selectedStore.id}/refund-push`, {
        method: "PATCH", body: JSON.stringify({ enabled }),
      });
      setStores((prev) => prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)));
      setNotice(updated.refundPushEnabled ? `"${selectedStore.name}" স্টোরে Refund Push চালু হয়েছে।` : `"${selectedStore.name}" স্টোরে Refund Push বন্ধ হয়েছে।`);
    } catch (e) {
      // Non-owners get the RolesGuard error here — show it verbatim,
      // honestly, rather than hiding the toggle's failure.
      setRefundError(e instanceof Error ? e.message : "Refund Push বদলানো ব্যর্থ");
    } finally { setRefundBusy(false); }
  }

  async function saveTrackingMetaKey() {
    const orgId = getOrganizationId(); if (!orgId || !selectedStore) return;
    setTrackingBusy(true); setTrackingError(""); setTrackingNotice("");
    try {
      const value = trackingKey.trim();
      const updated = await apiFetch<Store>(`/organizations/${orgId}/commerce/stores/${selectedStore.id}/tracking-meta-key`, {
        method: "PATCH", body: JSON.stringify({ courierTrackingMetaKey: value === "" ? null : value }),
      });
      setStores((prev) => prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)));
      setTrackingKey(updated.courierTrackingMetaKey ?? "");
      setTrackingNotice("Tracking Meta Key সংরক্ষণ হয়েছে।");
    } catch (e) { setTrackingError(e instanceof Error ? e.message : "Tracking Meta Key সংরক্ষণ ব্যর্থ"); }
    finally { setTrackingBusy(false); }
  }

  const loadLocations = useCallback(async (forStoreId: string) => {
    const orgId = getOrganizationId(); if (!orgId || !forStoreId) { setLocations([]); return; }
    try {
      const rows = await apiFetch<StoreLocation[]>(`/organizations/${orgId}/commerce/stores/${forStoreId}/locations`);
      setLocations(rows);
      setLocationsError("");
    } catch (e) {
      // A failed load must never render as "no locations".
      setLocations([]);
      setLocationsError(e instanceof Error ? e.message : "Location তালিকা লোড ব্যর্থ হয়েছে");
    }
  }, []);

  useEffect(() => {
    if (storeId) loadLocations(storeId);
    else { setLocations([]); setLocationsError(""); }
  }, [storeId, loadLocations]);

  async function resolveConflict() {
    const orgId = getOrganizationId(); if (!orgId || !confirmConflict) return;
    const { id, choice } = confirmConflict;
    setError(""); setNotice(""); setBusy(`conflict-${id}`);
    try {
      await apiFetch(`/organizations/${orgId}/commerce/conflicts/${id}/resolve`, {
        method: "POST", body: JSON.stringify({ choice }),
      });
      setNotice(choice === "keep_local" ? "Conflict নিষ্পত্তি হয়েছে — লোকাল মান রাখা হয়েছে।" : "Conflict নিষ্পত্তি হয়েছে — স্টোরের মান নেওয়া হয়েছে।");
      setConfirmConflict(null);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Conflict নিষ্পত্তি ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function refreshLocations() {
    const orgId = getOrganizationId(); if (!orgId || !storeId) return;
    setLocationsBusy("refresh"); setLocationsError("");
    try {
      const res = await apiFetch<{ locations: StoreLocation[]; imported: number }>(
        `/organizations/${orgId}/commerce/stores/${storeId}/locations/refresh`, { method: "POST" });
      setLocations(res.locations);
      setNotice(`Shopify থেকে ${res.imported}টি নতুন Location আনা হয়েছে।`);
    } catch (e) { setLocationsError(e instanceof Error ? e.message : "Location আনতে ব্যর্থ হয়েছে"); }
    finally { setLocationsBusy(""); }
  }

  async function addLocation(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId || !storeId || !locForm.name.trim()) return;
    setLocationsBusy("add"); setLocationsError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/stores/${storeId}/locations`, {
        method: "POST",
        body: JSON.stringify({
          name: locForm.name.trim(),
          externalLocationId: locForm.externalLocationId.trim() || undefined,
          isDefault: locForm.isDefault || undefined,
        }),
      });
      setLocForm({ name: "", externalLocationId: "", isDefault: false });
      setNotice("Location যোগ হয়েছে।");
      await loadLocations(storeId);
    } catch (e) { setLocationsError(e instanceof Error ? e.message : "Location যোগ ব্যর্থ হয়েছে"); }
    finally { setLocationsBusy(""); }
  }

  async function setDefaultLocation(loc: StoreLocation) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setLocationsBusy(`default-${loc.id}`); setLocationsError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/locations/${loc.id}`, {
        method: "PATCH", body: JSON.stringify({ isDefault: true }),
      });
      setNotice(`"${loc.name}" এখন ডিফল্ট Location।`);
      if (storeId) await loadLocations(storeId);
    } catch (e) { setLocationsError(e instanceof Error ? e.message : "ডিফল্ট সেট ব্যর্থ হয়েছে"); }
    finally { setLocationsBusy(""); }
  }

  async function deleteLocation(loc: StoreLocation) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm(`Location "${loc.name}" মুছে ফেলবেন?`)) return;
    setLocationsBusy(`delete-${loc.id}`); setLocationsError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/locations/${loc.id}`, { method: "DELETE" });
      setNotice(`Location "${loc.name}" মোছা হয়েছে।`);
      if (storeId) await loadLocations(storeId);
    } catch (e) { setLocationsError(e instanceof Error ? e.message : "Location মোছা ব্যর্থ হয়েছে"); }
    finally { setLocationsBusy(""); }
  }

  async function replay(item: OutboxItem) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setError(""); setNotice(""); setBusy(`replay-${item.id}`);
    try {
      await apiFetch(`/organizations/${orgId}/commerce/outbox/${item.id}/replay`, { method: "POST" });
      setNotice("আইটেমটি আবার চেষ্টার জন্য Outbox এ ফেরত দেওয়া হয়েছে।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Replay ব্যর্থ"); }
    finally { setBusy(""); }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Sync Center — স্টোর সিঙ্ক কেন্দ্র</h1>
        <p className="text-sm text-slate-500">
          এখান থেকে স্টোরে পাঠানো প্রতিটি পরিবর্তন প্রথমে Outbox এ জমা হয়, তারপর প্ল্যাটফর্মে যায়।
          কোনো আইটেম ব্যর্থ হলে প্ল্যাটফর্মের দেওয়া আসল (verbatim) এরর এখানেই দেখানো হয়।
          প্ল্যাটফর্ম যে অপারেশন সমর্থন করে না, তা সফল বলে দেখানো হয় না — সেটি failed হিসেবেই চিহ্নিত থাকে।
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/dashboard/commerce" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">📊 Commerce Hub</Link>
          <Link href="/dashboard/commerce/discounts" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">🏷️ Discounts / কুপন</Link>
          <Link href="/dashboard/commerce/abandoned" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">🛒 Abandoned Carts</Link>
          <Link href="/dashboard/commerce/dispatch" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">📦 Dispatch Board</Link>
          <Link href="/dashboard/commerce/storefront" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">🏪 Storefront / দোকান</Link>
        </div>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      <div className="card p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="block text-sm">স্টোর
            <select
              className="input mt-1"
              value={storeId}
              onChange={(e) => { setStoreId(e.target.value); setPage(1); }}
            >
              <option value="">সব স্টোর</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}{s.platform ? ` (${s.platform})` : ""}</option>)}
            </select>
          </label>
        </div>

        {selectedStore ? (
          <div>
            <div className="font-semibold text-sm">Sync মোড — {selectedStore.name}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {SYNC_MODES.map((m) => {
                const active = (selectedStore.syncMode ?? "mirror") === m.value;
                return (
                  <button
                    key={m.value}
                    type="button"
                    disabled={busy !== ""}
                    onClick={() => changeSyncMode(m.value)}
                    className={`rounded-lg border px-3 py-2 text-left text-sm disabled:opacity-50 ${active ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white"}`}
                  >
                    <span className="font-semibold">{active ? "● " : "○ "}{m.label}</span>
                    <span className="block text-xs text-slate-500">{m.desc}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-slate-400">মোড বদলানো শুধু Owner/Admin করতে পারেন।</p>
            <div className="mt-4 space-y-3 border-t pt-4">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={selectedStore.refundPushEnabled === true}
                  disabled={refundBusy}
                  onChange={(e) => toggleRefundPush(e.target.checked)}
                />
                <span>
                  <span className="font-semibold">স্টোরে Refund Push</span>
                  <span className="block text-xs text-slate-500">বন্ধ থাকলে refund শুধু SaaS-এ রেকর্ড হবে, স্টোরে যাবে না। শুধু OWNER বদলাতে পারেন।</span>
                </span>
              </label>
              {refundBusy ? <p className="text-xs text-slate-400">বদলানো হচ্ছে…</p> : null}
              {refundError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{refundError}</p> : null}
              <div className="space-y-1">
                <label className="block text-sm font-medium">Courier Tracking Meta Key
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <input
                      className="input w-72"
                      value={trackingKey}
                      onChange={(e) => setTrackingKey(e.target.value)}
                      placeholder="যেমন: _tracking_number (ঐচ্ছিক)"
                    />
                    <button
                      type="button"
                      className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50"
                      disabled={trackingBusy}
                      onClick={saveTrackingMetaKey}
                    >
                      {trackingBusy ? "সংরক্ষণ হচ্ছে…" : "সংরক্ষণ করুন"}
                    </button>
                  </div>
                </label>
                <p className="text-xs text-slate-400">WooCommerce shipment plugin-এর tracking meta key (ঐচ্ছিক)। খালি রেখে সংরক্ষণ করলে মুছে যাবে।</p>
                {trackingError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{trackingError}</p> : null}
                {trackingNotice ? <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">{trackingNotice}</p> : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="card p-5">
        <div className="font-semibold">Listing অবস্থা</div>
        {summary ? (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-lg bg-slate-50 p-3 text-center"><div className="text-2xl font-bold">{summary.total}</div><div className="text-xs text-slate-500">মোট</div></div>
            <div className="rounded-lg bg-green-50 p-3 text-center"><div className="text-2xl font-bold text-green-700">{summary.synced}</div><div className="text-xs text-slate-500">Synced</div></div>
            <div className="rounded-lg bg-amber-50 p-3 text-center"><div className="text-2xl font-bold text-amber-700">{summary.pending}</div><div className="text-xs text-slate-500">Pending</div></div>
            <div className="rounded-lg bg-red-50 p-3 text-center"><div className="text-2xl font-bold text-red-700">{summary.failed}</div><div className="text-xs text-slate-500">Failed</div></div>
            <div className="rounded-lg bg-purple-50 p-3 text-center"><div className="text-2xl font-bold text-purple-700">{summary.conflict}</div><div className="text-xs text-slate-500">Conflict</div></div>
          </div>
        ) : <p className="mt-2 text-sm text-slate-500">লোড হচ্ছে…</p>}
        {listings.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 pr-3">প্রোডাক্ট</th>
                  <th className="py-2 pr-3">স্টোর</th>
                  <th className="py-2 pr-3">External ID</th>
                  <th className="py-2 pr-3">অবস্থা</th>
                  <th className="py-2 pr-3">শেষ রিমোট আপডেট</th>
                  <th className="py-2">এরর</th>
                </tr>
              </thead>
              <tbody>
                {listings.map((l) => (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <span className="font-medium">{l.product?.name ?? "—"}</span>
                      {l.product?.sku ? <span className="block text-xs text-slate-400">SKU: {l.product.sku}</span> : null}
                    </td>
                    <td className="py-2 pr-3">{l.store?.name ?? "—"}{l.store?.platform ? <span className="text-slate-400"> ({l.store.platform})</span> : null}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{l.externalId ?? "—"}</td>
                    <td className="py-2 pr-3"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${listingBadge(l.syncStatus)}`}>{l.syncStatus}</span></td>
                    <td className="py-2 pr-3 text-xs text-slate-500">{l.lastRemoteUpdatedAt ? new Date(l.lastRemoteUpdatedAt).toLocaleString() : "—"}</td>
                    <td className="py-2 text-xs text-red-600">{l.lastSyncError ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="mt-3 text-sm text-slate-500">এখনো কোনো Listing নেই।</p>}
      </div>

      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="font-semibold">Outbox — স্টোরে পাঠানোর সারি</div>
          <label className="block text-sm">অবস্থা
            <select
              className="input mt-1"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            >
              <option value="">সব</option>
              <option value="pending">pending</option>
              <option value="processing">processing</option>
              <option value="done">done</option>
              <option value="failed">failed</option>
              <option value="dead">dead</option>
            </select>
          </label>
        </div>
        {outbox.length === 0 ? <p className="mt-3 text-sm text-slate-500">এই ফিল্টারে কোনো Outbox আইটেম নেই।</p> : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 pr-3">Entity</th>
                  <th className="py-2 pr-3">Operation</th>
                  <th className="py-2 pr-3">অবস্থা</th>
                  <th className="py-2 pr-3">চেষ্টা</th>
                  <th className="py-2 pr-3">পরের চেষ্টা</th>
                  <th className="py-2 pr-3">এরর</th>
                  <th className="py-2">অ্যাকশন</th>
                </tr>
              </thead>
              <tbody>
                {outbox.map((o) => (
                  <tr key={o.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <span className="font-medium">{o.entityType}</span>
                      <span className="block font-mono text-xs text-slate-400" title={o.entityId}>{o.entityId.slice(0, 8)}…</span>
                    </td>
                    <td className="py-2 pr-3">{o.operation}</td>
                    <td className="py-2 pr-3"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${outboxBadge(o.status)}`}>{o.status}</span></td>
                    <td className="py-2 pr-3">{o.attempts}</td>
                    <td className="py-2 pr-3 text-xs text-slate-500">{o.nextRetryAt ? new Date(o.nextRetryAt).toLocaleString() : "—"}</td>
                    <td className="py-2 pr-3 max-w-xs truncate text-xs text-red-600" title={o.lastError ?? undefined}>{o.lastError ?? ""}</td>
                    <td className="py-2">
                      {o.status === "failed" || o.status === "dead" ? (
                        <button
                          className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50"
                          disabled={busy !== ""}
                          onClick={() => replay(o)}
                        >
                          {busy === `replay-${o.id}` ? "পাঠানো হচ্ছে…" : "আবার চেষ্টা"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 flex items-center gap-3 text-sm">
          <button className="rounded-lg border px-3 py-1.5 disabled:opacity-50" disabled={page <= 1 || busy !== ""} onClick={() => setPage((p) => Math.max(1, p - 1))}>আগের পেজ</button>
          <span className="text-slate-500">পেজ {page} / {totalPages} · মোট {outboxTotal}টি</span>
          <button className="rounded-lg border px-3 py-1.5 disabled:opacity-50" disabled={page >= totalPages || busy !== ""} onClick={() => setPage((p) => p + 1)}>পরের পেজ</button>
        </div>
      </div>

      <div className="card p-5">
        <div className="font-semibold">Conflicts</div>
        {conflictsError ? (
          <p className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">Conflict তালিকা লোড করা যায়নি: {conflictsError}</p>
        ) : conflicts.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">কোনো খোলা Conflict নেই।</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 pr-3">Field</th>
                  <th className="py-2 pr-3">পণ্য / স্টোর</th>
                  <th className="py-2 pr-3">লোকাল মান</th>
                  <th className="py-2 pr-3">স্টোরের মান</th>
                  <th className="py-2 pr-3">অবস্থা</th>
                  <th className="py-2 pr-3">তৈরি হয়েছে</th>
                  <th className="py-2">অ্যাকশন</th>
                </tr>
              </thead>
              <tbody>
                {conflicts.map((c) => {
                  const isOpen = c.status.toLowerCase() === "open";
                  const productName = c.listing?.product?.name ?? c.product?.name ?? null;
                  const storeName = c.listing?.store?.name ?? c.store?.name ?? null;
                  return (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="py-2 pr-3">{c.field}</td>
                      <td className="py-2 pr-3">
                        {productName ?? "—"}
                        {storeName ? <span className="block text-xs text-slate-400">{storeName}</span> : null}
                      </td>
                      <td className="py-2 pr-3 max-w-xs break-words text-xs">{c.localValue == null ? "—" : String(typeof c.localValue === "object" ? JSON.stringify(c.localValue) : c.localValue)}</td>
                      <td className="py-2 pr-3 max-w-xs break-words text-xs">{c.remoteValue == null ? "—" : String(typeof c.remoteValue === "object" ? JSON.stringify(c.remoteValue) : c.remoteValue)}</td>
                      <td className="py-2 pr-3"><span className="rounded bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700">{c.status}</span></td>
                      <td className="py-2 pr-3 text-xs text-slate-500">{new Date(c.createdAt).toLocaleString()}</td>
                      <td className="py-2">
                        {isOpen ? (
                          confirmConflict?.id === c.id ? (
                            <div className="space-y-1.5">
                              <p className="text-xs text-slate-600">
                                {confirmConflict.choice === "keep_local"
                                  ? "লোকাল মানটিই রাখা হবে — নিশ্চিত তো?"
                                  : "স্টোরের মানটি নেওয়া হবে, লোকাল মান বদলে যাবে — নিশ্চিত তো?"}
                              </p>
                              <div className="flex gap-2">
                                <button className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                                  disabled={busy !== ""} onClick={resolveConflict}>
                                  {busy === `conflict-${c.id}` ? "হচ্ছে…" : "নিশ্চিত করুন"}
                                </button>
                                <button className="rounded-lg border px-3 py-1.5 text-xs" onClick={() => setConfirmConflict(null)}>বাতিল</button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              <button className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""}
                                onClick={() => setConfirmConflict({ id: c.id, choice: "keep_local" })}>
                                লোকাল রাখুন
                              </button>
                              <button className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""}
                                onClick={() => setConfirmConflict({ id: c.id, choice: "take_remote" })}>
                                স্টোরেরটা নিন
                              </button>
                            </div>
                          )
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedStore ? (
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="font-semibold">Locations — {selectedStore.name}</div>
            {selectedStore.platform === "SHOPIFY" ? (
              <button className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                disabled={locationsBusy !== ""} onClick={refreshLocations}>
                {locationsBusy === "refresh" ? "আনা হচ্ছে…" : "Shopify থেকে আনুন"}
              </button>
            ) : null}
          </div>
          {locationsError ? (
            <p className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">{locationsError}</p>
          ) : locations.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">এই স্টোরের কোনো Location নেই।</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {locations.map((loc) => (
                <li key={loc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5 text-sm">
                  <span>
                    <span className="font-medium">{loc.name}</span>
                    {loc.isDefault ? <span className="ml-2 rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">ডিফল্ট</span> : null}
                    <span className="block text-xs text-slate-400">External ID: {loc.externalLocationId ?? "—"}</span>
                  </span>
                  <span className="flex gap-2">
                    {!loc.isDefault ? (
                      <button className="rounded-lg border px-2.5 py-1 text-xs disabled:opacity-50" disabled={locationsBusy !== ""}
                        onClick={() => setDefaultLocation(loc)}>
                        ডিফল্ট করুন
                      </button>
                    ) : null}
                    <button className="rounded-lg border px-2.5 py-1 text-xs text-red-600 disabled:opacity-50" disabled={locationsBusy !== ""}
                      onClick={() => deleteLocation(loc)}>
                      মুছুন
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={addLocation} className="mt-4 flex flex-wrap items-end gap-2 border-t pt-3">
            <label className="block text-sm">নাম *
              <input className="input mt-1" value={locForm.name} onChange={(e) => setLocForm({ ...locForm, name: e.target.value })} required placeholder="যেমন: ঢাকা গুদাম" />
            </label>
            <label className="block text-sm">External ID
              <input className="input mt-1" value={locForm.externalLocationId} onChange={(e) => setLocForm({ ...locForm, externalLocationId: e.target.value })} placeholder="ঐচ্ছিক" />
            </label>
            <label className="flex items-center gap-1.5 pb-2 text-sm">
              <input type="checkbox" checked={locForm.isDefault} onChange={(e) => setLocForm({ ...locForm, isDefault: e.target.checked })} />
              ডিফল্ট
            </label>
            <button className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50" disabled={locationsBusy !== ""}>
              {locationsBusy === "add" ? "যোগ হচ্ছে…" : "Location যোগ করুন"}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
