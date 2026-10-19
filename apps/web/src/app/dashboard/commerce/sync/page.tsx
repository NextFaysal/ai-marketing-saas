"use client";
import React, { useCallback, useEffect, useState } from "react";
import { fmtDateTime, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { useConfirm, useToast } from "@repo/ui/client";
import { ResponsiveTable } from "@repo/ui";

// GET /organizations/:id/stores returns the full Store rows
// (IntegrationsService.listStores), so refundPushEnabled /
// courierTrackingMetaKey are present at runtime.
interface Store { id: string; name: string; url?: string; platform?: string; syncMode?: string; refundPushEnabled?: boolean; refundToCreditEnabled?: boolean; courierTrackingMetaKey?: string | null; weightUnit?: string | null }
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
interface ConflictFieldDiff { field: string; localValue: unknown; remoteValue: unknown }
interface Conflict {
  id: string; storeId: string; listingId: string; field: string; localValue: unknown; remoteValue: unknown; status: string; createdAt: string;
  fieldDiffs?: ConflictFieldDiff[] | null;
  listing?: { product?: { name: string } | null; store?: { name: string } | null } | null;
  store?: { name: string } | null;
  product?: { name: string } | null;
}

function fmtConflictValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}
interface StoreLocation { id: string; name: string; externalLocationId: string | null; isDefault: boolean }

const PAGE_SIZE = 20;

const SYNC_MODES: { value: string; label: string; descKey: string }[] = [
  { value: "mirror", label: "Mirror", descKey: "willOnlyComeFromThe" },
  { value: "co-manage", label: "Co-manage", descKey: "orderStatusFulfillmentRefundWill" },
  { value: "full-manage", label: "Full-manage", descKey: "everythingIncludingProductsPricesStock" },
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
  const { dict, t, locale } = useLocale();
  const confirm = useConfirm();
  const { toast } = useToast();
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
  const [busy, setBusy] = useState("");
  // EC4: conflict resolve confirm + store locations.
  const [confirmConflict, setConfirmConflict] = useState<{ id: string; choice: "keep_local" | "take_remote" } | null>(null);
  // CP1: per-field resolution — expanded conflict + per-field picks.
  const [expandedConflictId, setExpandedConflictId] = useState("");
  const [fieldChoices, setFieldChoices] = useState<Record<string, Record<string, "local" | "remote">>>({});
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
  // CP3: manual weight-unit override.
  const [weightBusy, setWeightBusy] = useState(false);
  const [weightError, setWeightError] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError(dict.commerce.noOrganizationSelected); return; }
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
          setConflictsError(e instanceof Error ? e.message : dict.commerce.conflictListLoadingFailed);
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
    setRefundError(""); setTrackingError("");
  }, [storeId, selectedTrackingKey]);

  async function changeSyncMode(syncMode: string) {
    const orgId = getOrganizationId(); if (!orgId || !selectedStore) return;
    setError(""); setBusy("sync-mode");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/stores/${selectedStore.id}/sync-mode`, {
        method: "PATCH", body: JSON.stringify({ syncMode }),
      });
      toast({ title: t("commerce.theSyncModeOfThe", { name: selectedStore.name, syncMode: syncMode }), tone: "success" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.syncModeChangeFailed); }
    finally { setBusy(""); }
  }

  async function toggleRefundPush(enabled: boolean) {
    const orgId = getOrganizationId(); if (!orgId || !selectedStore) return;
    setRefundBusy(true); setRefundError("");
    try {
      // The PATCH response is the full updated Store row — trust it
      // for the local state instead of refetching everything.
      const updated = await apiFetch<Store>(`/organizations/${orgId}/commerce/stores/${selectedStore.id}/refund-push`, {
        method: "PATCH", body: JSON.stringify({ enabled }),
      });
      setStores((prev) => prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)));
      toast({ title: updated.refundPushEnabled ? t("commerce.refundPushEnabledForThe", { name: selectedStore.name }) : t("commerce.refundPushDisabledForThe", { name: selectedStore.name }), tone: "success" });
    } catch (e) {
      // Non-owners get the RolesGuard error here — show it verbatim,
      // honestly, rather than hiding the toggle's failure.
      setRefundError(e instanceof Error ? e.message : dict.commerce.refundPushChangeFailed);
    } finally { setRefundBusy(false); }
  }

  // NF7 (FB3): refund-to-credit opt-in — same per-store refund
  // settings area as Refund Push above. Default OFF: while off,
  // the orders UI does not render the credit option at all and
  // the API refuses refund-to-credit attempts.
  const [creditBusy, setCreditBusy] = useState(false);
  const [creditError, setCreditError] = useState("");
  async function toggleRefundToCredit(enabled: boolean) {
    const orgId = getOrganizationId(); if (!orgId || !selectedStore) return;
    setCreditBusy(true); setCreditError("");
    try {
      const updated = await apiFetch<Store>(`/organizations/${orgId}/commerce/stores/${selectedStore.id}/refund-to-credit`, {
        method: "PATCH", body: JSON.stringify({ enabled }),
      });
      setStores((prev) => prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)));
      toast({ title: updated.refundToCreditEnabled ? t("commerce.refundToCreditEnabledFor", { name: selectedStore.name }) : t("commerce.refundToCreditDisabledFor", { name: selectedStore.name }), tone: "success" });
    } catch (e) {
      setCreditError(e instanceof Error ? e.message : dict.commerce.refundToCreditChangeFailed);
    } finally { setCreditBusy(false); }
  }

  async function saveWeightUnit(unit: string) {
    const orgId = getOrganizationId(); if (!orgId || !selectedStore) return;
    setWeightBusy(true); setWeightError("");
    try {
      const updated = await apiFetch<Store>(`/organizations/${orgId}/commerce/stores/${selectedStore.id}/sync-mode`, {
        method: "PATCH", body: JSON.stringify({ weightUnit: unit === "" ? null : unit }),
      });
      setStores((prev) => prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)));
      toast({ title: t("commerce.theWeightUnitOfThe", { name: selectedStore.name, updated: updated.weightUnit ?? dict.commerce.kgDefault }), tone: "success" });
    } catch (e) { setWeightError(e instanceof Error ? e.message : dict.commerce.weightUnitChangeFailed); }
    finally { setWeightBusy(false); }
  }

  async function saveTrackingMetaKey() {
    const orgId = getOrganizationId(); if (!orgId || !selectedStore) return;
    setTrackingBusy(true); setTrackingError("");
    try {
      const value = trackingKey.trim();
      const updated = await apiFetch<Store>(`/organizations/${orgId}/commerce/stores/${selectedStore.id}/tracking-meta-key`, {
        method: "PATCH", body: JSON.stringify({ courierTrackingMetaKey: value === "" ? null : value }),
      });
      setStores((prev) => prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)));
      setTrackingKey(updated.courierTrackingMetaKey ?? "");
      toast({ title: dict.commerce.trackingMetaKeySaved, tone: "success" });
    } catch (e) { setTrackingError(e instanceof Error ? e.message : dict.commerce.trackingMetaKeySaveFailed); }
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
      setLocationsError(e instanceof Error ? e.message : dict.commerce.locationListLoadingFailed);
    }
  }, []);

  useEffect(() => {
    if (storeId) loadLocations(storeId);
    else { setLocations([]); setLocationsError(""); }
  }, [storeId, loadLocations]);

  async function resolveConflict() {
    const orgId = getOrganizationId(); if (!orgId || !confirmConflict) return;
    const { id, choice } = confirmConflict;
    setError(""); setBusy(`conflict-${id}`);
    try {
      await apiFetch(`/organizations/${orgId}/commerce/conflicts/${id}/resolve`, {
        method: "POST", body: JSON.stringify({ choice }),
      });
      toast({ title: choice === "keep_local" ? dict.commerce.conflictResolvedLocalValueKept : dict.commerce.conflictResolvedStoreValueTaken, tone: "success" });
      setConfirmConflict(null);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.conflictResolutionFailed); }
    finally { setBusy(""); }
  }

  async function applyPerField(c: Conflict) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const choices = fieldChoices[c.id] ?? {};
    setError(""); setBusy(`conflict-${c.id}`);
    try {
      await apiFetch(`/organizations/${orgId}/commerce/conflicts/${c.id}/resolve`, {
        method: "POST", body: JSON.stringify({ choice: "per_field", choices }),
      });
      toast({ title: dict.commerce.conflictResolvedThePerField, tone: "success" });
      setExpandedConflictId("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.conflictResolutionFailed); }
    finally { setBusy(""); }
  }

  async function refreshLocations() {
    const orgId = getOrganizationId(); if (!orgId || !storeId) return;
    setLocationsBusy("refresh"); setLocationsError("");
    try {
      const res = await apiFetch<{ locations: StoreLocation[]; imported: number }>(
        `/organizations/${orgId}/commerce/stores/${storeId}/locations/refresh`, { method: "POST" });
      setLocations(res.locations);
      toast({ title: t("commerce.newLocationsImportedFromShopify", { imported: res.imported }), tone: "success" });
    } catch (e) { setLocationsError(e instanceof Error ? e.message : dict.commerce.locationImportFailed); }
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
      toast({ title: dict.commerce.locationAdded, tone: "success" });
      await loadLocations(storeId);
    } catch (e) { setLocationsError(e instanceof Error ? e.message : dict.commerce.locationAddFailed); }
    finally { setLocationsBusy(""); }
  }

  async function setDefaultLocation(loc: StoreLocation) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setLocationsBusy(`default-${loc.id}`); setLocationsError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/locations/${loc.id}`, {
        method: "PATCH", body: JSON.stringify({ isDefault: true }),
      });
      toast({ title: t("commerce.isNowTheDefaultLocation", { name: loc.name }), tone: "success" });
      if (storeId) await loadLocations(storeId);
    } catch (e) { setLocationsError(e instanceof Error ? e.message : dict.commerce.defaultSetFailed); }
    finally { setLocationsBusy(""); }
  }

  async function deleteLocation(loc: StoreLocation) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!(await confirm({ title: t("commerce.deleteTheLocation", { name: loc.name }), danger: true, confirmLabel: dict.commerce.delete2 }))) return;
    setLocationsBusy(`delete-${loc.id}`); setLocationsError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/locations/${loc.id}`, { method: "DELETE" });
      toast({ title: t("commerce.locationDeleted", { name: loc.name }), tone: "success" });
      if (storeId) await loadLocations(storeId);
    } catch (e) { setLocationsError(e instanceof Error ? e.message : dict.commerce.locationDeleteFailed); }
    finally { setLocationsBusy(""); }
  }

  async function replay(item: OutboxItem) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setError(""); setBusy(`replay-${item.id}`);
    try {
      await apiFetch(`/organizations/${orgId}/commerce/outbox/${item.id}/replay`, { method: "POST" });
      toast({ title: dict.commerce.theItemHasBeenReturned, tone: "success" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.replayFailed); }
    finally { setBusy(""); }
  }

  // EB6: row actions / detail panels shared verbatim between each
  // desktop table and its ResponsiveTable mobile card — same
  // handlers, same order, same state.
  const renderOutboxAction = (o: OutboxItem) => (
    o.status === "failed" || o.status === "dead" ? (
      <button
        className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50"
        disabled={busy !== ""}
        onClick={() => replay(o)}
      >
        {busy === `replay-${o.id}` ? dict.commerce.sending : dict.commerce.retry2}
      </button>
    ) : null
  );

  const renderConflictActions = (c: Conflict, isOpen: boolean, diffs: ConflictFieldDiff[], expanded: boolean) => (
    isOpen ? (
      confirmConflict?.id === c.id ? (
        <div className="space-y-1.5">
          <p className="text-xs text-slate-600">
            {confirmConflict.choice === "keep_local"
              ? dict.commerce.theLocalValueWillBe
              : dict.commerce.theStoreValueWillBe}
          </p>
          <div className="flex gap-2">
            <button className="inline-flex min-h-[44px] items-center rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              disabled={busy !== ""} onClick={resolveConflict}>
              {busy === `conflict-${c.id}` ? dict.commerce.ing : dict.commerce.confirm}
            </button>
            <button className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-1.5 text-xs" onClick={() => setConfirmConflict(null)}>{dict.common.cancel}</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""}
            onClick={() => setConfirmConflict({ id: c.id, choice: "keep_local" })}>
            {dict.commerce.keepLocal}</button>
          <button className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""}
            onClick={() => setConfirmConflict({ id: c.id, choice: "take_remote" })}>
            {dict.commerce.takeTheStoreS}</button>
          {diffs.length > 0 ? (
            <button className="inline-flex min-h-[44px] items-center rounded-lg border border-purple-300 px-3 py-1.5 text-xs font-semibold text-purple-700 disabled:opacity-50" disabled={busy !== ""}
              onClick={() => setExpandedConflictId(expanded ? "" : c.id)}>
              {expanded ? dict.commerce.hideDetails : dict.commerce.choosePerField}
            </button>
          ) : null}
        </div>
      )
    ) : null
  );

  const renderConflictDetail = (c: Conflict, diffs: ConflictFieldDiff[]) => {
    const picks = fieldChoices[c.id] ?? {};
    const allPicked = diffs.length > 0 && diffs.every((d) => picks[d.field] === "local" || picks[d.field] === "remote");
    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-600">{dict.commerce.chooseWhichSideSValue}</p>
        {diffs.map((d) => (
          <div key={d.field} className="flex flex-wrap items-center gap-3 rounded-lg border bg-white px-3 py-2 text-xs">
            <span className="w-28 font-mono font-semibold">{d.field}</span>
            <label className="flex items-center gap-1.5">
              <input type="radio" name={`diff-${c.id}-${d.field}`} checked={picks[d.field] === "local"}
                onChange={() => setFieldChoices((prev) => ({ ...prev, [c.id]: { ...(prev[c.id] ?? {}), [d.field]: "local" } }))} />
              {dict.commerce.local}<span className="max-w-[220px] break-words font-medium">{fmtConflictValue(d.localValue)}</span>
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name={`diff-${c.id}-${d.field}`} checked={picks[d.field] === "remote"}
                onChange={() => setFieldChoices((prev) => ({ ...prev, [c.id]: { ...(prev[c.id] ?? {}), [d.field]: "remote" } }))} />
              {dict.commerce.storeS}<span className="max-w-[220px] break-words font-medium">{fmtConflictValue(d.remoteValue)}</span>
            </label>
          </div>
        ))}
        <button className="inline-flex min-h-[44px] items-center rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          disabled={busy !== "" || !allPicked} onClick={() => applyPerField(c)}>
          {busy === `conflict-${c.id}` ? dict.commerce.ing : dict.commerce.applyPerField}
        </button>
        {!allPicked ? <span className="ml-2 text-xs text-slate-500">{dict.commerce.theButtonWillActivateWhen}</span> : null}
      </div>
    );
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">{dict.commerce.syncCenterStoreSyncCenter}</h1>
        <p className="text-sm text-slate-500">
          {dict.commerce.everyChangeSentToThe}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/dashboard/commerce" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">📊 Commerce Hub</Link>
          <Link href="/dashboard/commerce/discounts" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">{dict.commerce.discountsCoupons}</Link>
          <Link href="/dashboard/commerce/abandoned" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">🛒 Abandoned Carts</Link>
          <Link href="/dashboard/commerce/dispatch" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">📦 Dispatch Board</Link>
          <Link href="/dashboard/commerce/storefront" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">{dict.commerce.storefrontShop3}</Link>
        </div>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      <div className="card p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="block text-sm">{dict.commerce.store}<select
              className="input mt-1"
              value={storeId}
              onChange={(e) => { setStoreId(e.target.value); setPage(1); }}
            >
              <option value="">{dict.commerce.allStores}</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}{s.platform ? ` (${s.platform})` : ""}</option>)}
            </select>
          </label>
        </div>

        {selectedStore ? (
          <div>
            <div className="font-semibold text-sm">{dict.commerce.syncMode}{selectedStore.name}</div>
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
                    <span className="block text-xs text-slate-500">{dict.commerce[m.descKey as keyof typeof dict.commerce]}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-slate-500">{dict.commerce.onlyOwnerAdminCanChange}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="block text-sm">{dict.commerce.weightUnitWooCommerce}<select
                  className="input mt-1"
                  value={selectedStore.weightUnit ?? ""}
                  disabled={weightBusy}
                  onChange={(e) => saveWeightUnit(e.target.value)}
                >
                  <option value="">{dict.commerce.defaultKg}</option>
                  <option value="g">{dict.commerce.gGrams}</option>
                  <option value="kg">{dict.commerce.kgKilograms}</option>
                  <option value="lb">{dict.commerce.lbPounds}</option>
                  <option value="oz">{dict.commerce.ozOunces}</option>
                </select>
              </label>
              {weightBusy ? <span className="pt-5 text-xs text-slate-500">{dict.commerce.saving}</span> : null}
            </div>
            <p className="text-xs text-slate-500">{dict.commerce.theStoreSRealUnit}</p>
            {weightError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{weightError}</p> : null}
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
                  <span className="font-semibold">{dict.commerce.refundPushToStore}</span>
                  <span className="block text-xs text-slate-500">{dict.commerce.ifOffRefundsWillOnly}</span>
                </span>
              </label>
              {refundBusy ? <p className="text-xs text-slate-500">{dict.commerce.changing}</p> : null}
              {refundError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{refundError}</p> : null}
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={selectedStore.refundToCreditEnabled === true}
                  disabled={creditBusy}
                  onChange={(e) => toggleRefundToCredit(e.target.checked)}
                />
                <span>
                  <span className="font-semibold">{dict.commerce.refundStoreCreditNF7}</span>
                  <span className="block text-xs text-slate-500">{dict.commerce.ifOffTheStoreCredit}</span>
                </span>
              </label>
              {creditBusy ? <p className="text-xs text-slate-500">{dict.commerce.changing}</p> : null}
              {creditError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{creditError}</p> : null}
              <div className="space-y-1">
                <label className="block text-sm font-medium">Courier Tracking Meta Key
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <input
                      className="input w-72"
                      value={trackingKey}
                      onChange={(e) => setTrackingKey(e.target.value)}
                      placeholder={dict.commerce.eGTrackingNumberOptional}
                    />
                    <button
                      type="button"
                      className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50"
                      disabled={trackingBusy}
                      onClick={saveTrackingMetaKey}
                    >
                      {trackingBusy ? dict.commerce.saving : dict.common.save}
                    </button>
                  </div>
                </label>
                <p className="text-xs text-slate-500">{dict.commerce.wooCommerceShipmentPluginSTracking}</p>
                {trackingError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{trackingError}</p> : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="card p-5">
        <div className="font-semibold">{dict.commerce.listingStatus}</div>
        {summary ? (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-lg bg-slate-50 p-3 text-center"><div className="text-2xl font-bold">{summary.total}</div><div className="text-xs text-slate-500">{dict.commerce.total}</div></div>
            <div className="rounded-lg bg-green-50 p-3 text-center"><div className="text-2xl font-bold text-green-700">{summary.synced}</div><div className="text-xs text-slate-500">Synced</div></div>
            <div className="rounded-lg bg-amber-50 p-3 text-center"><div className="text-2xl font-bold text-amber-700">{summary.pending}</div><div className="text-xs text-slate-500">Pending</div></div>
            <div className="rounded-lg bg-red-50 p-3 text-center"><div className="text-2xl font-bold text-red-700">{summary.failed}</div><div className="text-xs text-slate-500">Failed</div></div>
            <div className="rounded-lg bg-purple-50 p-3 text-center"><div className="text-2xl font-bold text-purple-700">{summary.conflict}</div><div className="text-xs text-slate-500">Conflict</div></div>
          </div>
        ) : <p className="mt-2 text-sm text-slate-500">{dict.common.loading}</p>}
        {listings.length > 0 ? (
          <ResponsiveTable
            className="mt-4"
            table={
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 pr-3">{dict.commerce.product3}</th>
                  <th className="py-2 pr-3">{dict.commerce.store}</th>
                  <th className="py-2 pr-3">External ID</th>
                  <th className="py-2 pr-3">{dict.commerce.status}</th>
                  <th className="py-2 pr-3">{dict.commerce.lastRemoteUpdate}</th>
                  <th className="py-2">{dict.commerce.error}</th>
                </tr>
              </thead>
              <tbody>
                {listings.map((l) => (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <span className="font-medium">{l.product?.name ?? "—"}</span>
                      {l.product?.sku ? <span className="block text-xs text-slate-500">SKU: {l.product.sku}</span> : null}
                    </td>
                    <td className="py-2 pr-3">{l.store?.name ?? "—"}{l.store?.platform ? <span className="text-slate-400"> ({l.store.platform})</span> : null}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{l.externalId ?? "—"}</td>
                    <td className="py-2 pr-3"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${listingBadge(l.syncStatus)}`}>{l.syncStatus}</span></td>
                    <td className="py-2 pr-3 text-xs text-slate-500">{l.lastRemoteUpdatedAt ? fmtDateTime(locale, new Date(l.lastRemoteUpdatedAt)) : "—"}</td>
                    <td className="py-2 text-xs text-red-600">{l.lastSyncError ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            }
            cards={listings.map((l) => (
              <div key={l.id} className="rounded-xl border bg-white p-3 text-sm shadow-sm">
                <dl className="space-y-1.5">
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.product3}</dt><dd className="text-right"><span className="font-medium">{l.product?.name ?? "—"}</span>{l.product?.sku ? <span className="block text-xs text-slate-500">SKU: {l.product.sku}</span> : null}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.store}</dt><dd className="text-right">{l.store?.name ?? "—"}{l.store?.platform ? <span className="text-slate-400"> ({l.store.platform})</span> : null}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">External ID</dt><dd className="text-right font-mono text-xs">{l.externalId ?? "—"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.status}</dt><dd className="text-right"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${listingBadge(l.syncStatus)}`}>{l.syncStatus}</span></dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.lastRemoteUpdate}</dt><dd className="text-right text-xs text-slate-500">{l.lastRemoteUpdatedAt ? fmtDateTime(locale, new Date(l.lastRemoteUpdatedAt)) : "—"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.error}</dt><dd className="text-right text-xs text-red-600">{l.lastSyncError ?? ""}</dd></div>
                </dl>
              </div>
            ))}
          />
        ) : <p className="mt-3 text-sm text-slate-500">{dict.commerce.noListingsYet}</p>}
      </div>

      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="font-semibold">{dict.commerce.outboxQueueToSendTo}</div>
          <label className="block text-sm">{dict.commerce.status}<select
              className="input mt-1"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            >
              <option value="">{dict.commerce.all}</option>
              <option value="pending">pending</option>
              <option value="processing">processing</option>
              <option value="done">done</option>
              <option value="failed">failed</option>
              <option value="dead">dead</option>
            </select>
          </label>
        </div>
        {outbox.length === 0 ? <p className="mt-3 text-sm text-slate-500">{dict.commerce.noOutboxItemsInThis}</p> : (
          <ResponsiveTable
            className="mt-3"
            table={
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 pr-3">Entity</th>
                  <th className="py-2 pr-3">Operation</th>
                  <th className="py-2 pr-3">{dict.commerce.status}</th>
                  <th className="py-2 pr-3">{dict.commerce.attempt}</th>
                  <th className="py-2 pr-3">{dict.commerce.nextAttempt}</th>
                  <th className="py-2 pr-3">{dict.commerce.error}</th>
                  <th className="py-2">{dict.commerce.action}</th>
                </tr>
              </thead>
              <tbody>
                {outbox.map((o) => (
                  <tr key={o.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <span className="font-medium">{o.entityType}</span>
                      <span className="block font-mono text-xs text-slate-500" title={o.entityId}>{o.entityId.slice(0, 8)}…</span>
                    </td>
                    <td className="py-2 pr-3">{o.operation}</td>
                    <td className="py-2 pr-3"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${outboxBadge(o.status)}`}>{o.status}</span></td>
                    <td className="py-2 pr-3">{o.attempts}</td>
                    <td className="py-2 pr-3 text-xs text-slate-500">{o.nextRetryAt ? fmtDateTime(locale, new Date(o.nextRetryAt)) : "—"}</td>
                    <td className="py-2 pr-3 max-w-xs truncate text-xs text-red-600" title={o.lastError ?? undefined}>{o.lastError ?? ""}</td>
                    <td className="py-2">
                      {renderOutboxAction(o)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            }
            cards={outbox.map((o) => (
              <div key={o.id} className="rounded-xl border bg-white p-3 text-sm shadow-sm">
                <dl className="space-y-1.5">
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">Entity</dt><dd className="text-right"><span className="font-medium">{o.entityType}</span><span className="block font-mono text-xs text-slate-500" title={o.entityId}>{o.entityId.slice(0, 8)}…</span></dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">Operation</dt><dd className="text-right">{o.operation}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.status}</dt><dd className="text-right"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${outboxBadge(o.status)}`}>{o.status}</span></dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.attempt}</dt><dd className="text-right">{o.attempts}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.nextAttempt}</dt><dd className="text-right text-xs text-slate-500">{o.nextRetryAt ? fmtDateTime(locale, new Date(o.nextRetryAt)) : "—"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.error}</dt><dd className="break-words text-right text-xs text-red-600">{o.lastError ?? ""}</dd></div>
                </dl>
                {renderOutboxAction(o) ? <div className="mt-2">{renderOutboxAction(o)}</div> : null}
              </div>
            ))}
          />
        )}
        <div className="mt-3 flex items-center gap-3 text-sm">
          <button className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-1.5 disabled:opacity-50" disabled={page <= 1 || busy !== ""} onClick={() => setPage((p) => Math.max(1, p - 1))}>{dict.commerce.previousPage}</button>
          <span className="text-slate-500">{dict.commerce.page}{page} / {totalPages} {dict.commerce.total2}{outboxTotal}{dict.commerce.text1ou8}</span>
          <button className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-1.5 disabled:opacity-50" disabled={page >= totalPages || busy !== ""} onClick={() => setPage((p) => p + 1)}>{dict.commerce.nextPage}</button>
        </div>
      </div>

      <div className="card p-5">
        <div className="font-semibold">Conflicts</div>
        {conflictsError ? (
          <p className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">{dict.commerce.couldNotLoadTheConflict}{conflictsError}</p>
        ) : conflicts.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">{dict.commerce.noOpenConflicts}</p>
        ) : (
          <ResponsiveTable
            className="mt-3"
            table={
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 pr-3">Field</th>
                  <th className="py-2 pr-3">{dict.commerce.productStore}</th>
                  <th className="py-2 pr-3">{dict.commerce.localValue}</th>
                  <th className="py-2 pr-3">{dict.commerce.storeValue}</th>
                  <th className="py-2 pr-3">{dict.commerce.status}</th>
                  <th className="py-2 pr-3">{dict.commerce.created2}</th>
                  <th className="py-2">{dict.commerce.action}</th>
                </tr>
              </thead>
              <tbody>
                {conflicts.map((c) => {
                  const isOpen = c.status.toLowerCase() === "open";
                  const productName = c.listing?.product?.name ?? c.product?.name ?? null;
                  const storeName = c.listing?.store?.name ?? c.store?.name ?? null;
                  const diffs = Array.isArray(c.fieldDiffs) ? c.fieldDiffs : [];
                  const expanded = expandedConflictId === c.id;
                  return (
                    <React.Fragment key={c.id}>
                    <tr className="border-b last:border-0">
                      <td className="py-2 pr-3">{c.field}</td>
                      <td className="py-2 pr-3">
                        {productName ?? "—"}
                        {storeName ? <span className="block text-xs text-slate-500">{storeName}</span> : null}
                      </td>
                      <td className="py-2 pr-3 max-w-xs break-words text-xs">{c.localValue == null ? "—" : String(typeof c.localValue === "object" ? JSON.stringify(c.localValue) : c.localValue)}</td>
                      <td className="py-2 pr-3 max-w-xs break-words text-xs">{c.remoteValue == null ? "—" : String(typeof c.remoteValue === "object" ? JSON.stringify(c.remoteValue) : c.remoteValue)}</td>
                      <td className="py-2 pr-3"><span className="rounded bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700">{c.status}</span></td>
                      <td className="py-2 pr-3 text-xs text-slate-500">{fmtDateTime(locale, new Date(c.createdAt))}</td>
                      <td className="py-2">
                        {renderConflictActions(c, isOpen, diffs, expanded)}
                      </td>
                    </tr>
                    {isOpen && expanded && diffs.length > 0 ? (
                      <tr className="border-b bg-purple-50/50">
                        <td colSpan={7} className="px-3 py-3">
                          {renderConflictDetail(c, diffs)}
                        </td>
                      </tr>
                    ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
            }
            cards={conflicts.map((c) => {
              const isOpen = c.status.toLowerCase() === "open";
              const productName = c.listing?.product?.name ?? c.product?.name ?? null;
              const storeName = c.listing?.store?.name ?? c.store?.name ?? null;
              const diffs = Array.isArray(c.fieldDiffs) ? c.fieldDiffs : [];
              const expanded = expandedConflictId === c.id;
              return (
                <div key={c.id} className="rounded-xl border bg-white p-3 text-sm shadow-sm">
                  <dl className="space-y-1.5">
                    <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">Field</dt><dd className="text-right">{c.field}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.productStore}</dt><dd className="text-right">{productName ?? "—"}{storeName ? <span className="block text-xs text-slate-500">{storeName}</span> : null}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.localValue}</dt><dd className="break-words text-right text-xs">{c.localValue == null ? "—" : String(typeof c.localValue === "object" ? JSON.stringify(c.localValue) : c.localValue)}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.storeValue}</dt><dd className="break-words text-right text-xs">{c.remoteValue == null ? "—" : String(typeof c.remoteValue === "object" ? JSON.stringify(c.remoteValue) : c.remoteValue)}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.status}</dt><dd className="text-right"><span className="rounded bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700">{c.status}</span></dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.created2}</dt><dd className="text-right text-xs text-slate-500">{fmtDateTime(locale, new Date(c.createdAt))}</dd></div>
                  </dl>
                  {renderConflictActions(c, isOpen, diffs, expanded) ? <div className="mt-2">{renderConflictActions(c, isOpen, diffs, expanded)}</div> : null}
                  {isOpen && expanded && diffs.length > 0 ? (
                    <div className="mt-3 border-t bg-purple-50/50 px-3 py-3">
                      {renderConflictDetail(c, diffs)}
                    </div>
                  ) : null}
                </div>
              );
            })}
          />
        )}
      </div>

      {selectedStore ? (
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="font-semibold">Locations — {selectedStore.name}</div>
            {selectedStore.platform === "SHOPIFY" ? (
              <button className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                disabled={locationsBusy !== ""} onClick={refreshLocations}>
                {locationsBusy === "refresh" ? dict.commerce.fetching : dict.commerce.fetchFromShopify}
              </button>
            ) : null}
          </div>
          {locationsError ? (
            <p className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">{locationsError}</p>
          ) : locations.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">{dict.commerce.thisStoreHasNoLocations}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {locations.map((loc) => (
                <li key={loc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5 text-sm">
                  <span>
                    <span className="font-medium">{loc.name}</span>
                    {loc.isDefault ? <span className="ml-2 rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">{dict.commerce.default}</span> : null}
                    <span className="block text-xs text-slate-500">External ID: {loc.externalLocationId ?? "—"}</span>
                  </span>
                  <span className="flex gap-2">
                    {!loc.isDefault ? (
                      <button className="inline-flex min-h-[44px] items-center rounded-lg border px-2.5 py-1 text-xs disabled:opacity-50" disabled={locationsBusy !== ""}
                        onClick={() => setDefaultLocation(loc)}>
                        {dict.commerce.makeDefault}</button>
                    ) : null}
                    <button className="inline-flex min-h-[44px] items-center rounded-lg border px-2.5 py-1 text-xs text-red-600 disabled:opacity-50" disabled={locationsBusy !== ""}
                      onClick={() => deleteLocation(loc)}>
                      {dict.commerce.delete}</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={addLocation} className="mt-4 flex flex-wrap items-end gap-2 border-t pt-3">
            <label className="block text-sm">{dict.commerce.name2}<input className="input mt-1" value={locForm.name} onChange={(e) => setLocForm({ ...locForm, name: e.target.value })} required placeholder={dict.commerce.eGDhakaWarehouse} />
            </label>
            <label className="block text-sm">External ID
              <input className="input mt-1" value={locForm.externalLocationId} onChange={(e) => setLocForm({ ...locForm, externalLocationId: e.target.value })} placeholder={dict.commerce.optional} />
            </label>
            <label className="flex items-center gap-1.5 pb-2 text-sm">
              <input type="checkbox" checked={locForm.isDefault} onChange={(e) => setLocForm({ ...locForm, isDefault: e.target.checked })} />
              {dict.commerce.default}</label>
            <button className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50" disabled={locationsBusy !== ""}>
              {locationsBusy === "add" ? dict.commerce.adding : dict.commerce.addLocation}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
