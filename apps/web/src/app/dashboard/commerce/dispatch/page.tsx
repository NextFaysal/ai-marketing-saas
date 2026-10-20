"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { fmtDate, fmtDateTime, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatAge, slaStageLabel } from "@/lib/orders-on5";
import { summarizeAllocations, type AllocationLike } from "@/lib/warehouse-ab3";
import { ResponsiveTable } from "@repo/ui";

interface BoardLine { orderItemId: string; quantity: number; packed?: boolean; name: string }
interface Fulfillment {
  id: string; orderId: string; orderNumber: string | null; status: string;
  courierProvider: string | null; trackingCode: string | null;
  itemCount: number; lines: BoardLine[]; createdAt: string;
  // ON6: per-row SLA read-model from the board endpoint.
  sla?: { stage: string; stageSince: string | null; ageHours: number | null; breached: boolean } | null;
}
// ON6 pick waves / suggestions / escalations / SLA settings.
interface WaveRow {
  id: string; status: string; note?: string | null; createdAt: string; closedAt?: string | null;
  progress: { total: number; picked: number };
}
interface WaveOrderRow {
  id: string; orderId: string; orderNumber: string | null; status: string | null; pickedAt: string | null;
  // AB3 (AX4): order-level allocation labels from getWave
  // (active rows only) — shown as warehouse — bin ×qty chips.
  allocations?: AllocationLike[];
}
interface WaveDetail extends WaveRow { orders: WaveOrderRow[] }
interface SuggestionGroup { key: string; label: string; count: number; orderIds: string[] }
interface EscalationRow {
  id?: string; orderId: string; orderNumber: string | null; trackingCode: string | null;
  provider: string | null; status: string | null; escalatedForStatus?: string | null;
  escalatedAt?: string | null; ageDays: number | null;
}
interface FulfillmentSettings { confirmToPackHours: number; packToHandoverHours: number; stuckDays: number }
interface Board { date: string; total: number; fulfillments: Fulfillment[] }
interface Manifest {
  courier: string; date: string; totalParcels: number; totalItems: number;
  rows: { trackingCode: string | null; orderNumber: string | null; itemCount: number; status: string }[];
}

const NO_COURIER_KEY = "courierNotAssigned"; // ML6: commerce dict key for the unassigned-courier group

function statusBadge(status: string): string {
  switch (status) {
    case "pending": return "bg-amber-100 text-amber-700";
    case "packed": return "bg-blue-100 text-blue-700";
    case "handed_over": return "bg-indigo-100 text-indigo-700";
    case "in_transit": return "bg-purple-100 text-purple-700";
    case "delivered": return "bg-green-100 text-green-700";
    case "returned": return "bg-red-100 text-red-700";
    case "cancelled": return "bg-slate-200 text-slate-600";
    default: return "bg-slate-200 text-slate-600";
  }
}

export default function DispatchBoardPage() {
  const { dict, t, locale } = useLocale();
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [manifestCourier, setManifestCourier] = useState("");
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manifestError, setManifestError] = useState("");
  const [manifestBusy, setManifestBusy] = useState(false);
  // ON6 state: suggestions, waves, escalations, SLA settings.
  const [suggestions, setSuggestions] = useState<SuggestionGroup[] | null>(null);
  const [suggestionsCapped, setSuggestionsCapped] = useState(false);
  const [waves, setWaves] = useState<WaveRow[] | null>(null);
  const [waveDetails, setWaveDetails] = useState<Record<string, WaveDetail>>({});
  const [expandedWave, setExpandedWave] = useState("");
  const [waveError, setWaveError] = useState("");
  const [waveNotice, setWaveNotice] = useState("");
  const [waveBusy, setWaveBusy] = useState("");
  const [escalations, setEscalations] = useState<EscalationRow[] | null>(null);
  const [escalationsError, setEscalationsError] = useState("");
  const [fsForm, setFsForm] = useState({ confirmToPackHours: "", packToHandoverHours: "", stuckDays: "" });
  const [fsError, setFsError] = useState("");
  const [fsNotice, setFsNotice] = useState("");
  const [fsBusy, setFsBusy] = useState(false);
  // GB5 (GC14): RTO report state.
  const [rto, setRto] = useState<any>(null);
  const [rtoError, setRtoError] = useState("");
  const [rtoFrom, setRtoFrom] = useState("");
  const [rtoTo, setRtoTo] = useState("");
  const [rtoBusy, setRtoBusy] = useState(false);

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError(dict.commerce.noOrganizationSelected); setLoading(false); return; }
    try {
      const data = await apiFetch<Board>(`/organizations/${orgId}/fulfillments/board`);
      setBoard(data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.commerce.couldNotLoadTheDispatch);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Group by courier; the null-courier group keeps its own label and
  // can never be used for a manifest (the API requires a provider).
  const groups = useMemo(() => {
    const map = new Map<string, Fulfillment[]>();
    for (const f of board?.fulfillments ?? []) {
      const key = f.courierProvider ?? NO_COURIER_KEY;
      const arr = map.get(key) ?? [];
      arr.push(f);
      map.set(key, arr);
    }
    return [...map.entries()];
  }, [board]);

  const couriers = useMemo(
    () => [...new Set((board?.fulfillments ?? []).map((f) => f.courierProvider).filter((c): c is string => Boolean(c)))],
    [board],
  );

  useEffect(() => {
    if (!manifestCourier && couriers.length > 0) setManifestCourier(couriers[0]);
  }, [couriers, manifestCourier]);

  async function patchFulfillment(f: Fulfillment, body: Record<string, unknown>, busyKey: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setError(""); setNotice(""); setBusy(busyKey);
    try {
      await apiFetch(`/organizations/${orgId}/fulfillments/${f.id}`, {
        method: "PATCH", body: JSON.stringify(body),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.commerce.couldNotUpdate);
    } finally { setBusy(""); }
  }

  function togglePacked(f: Fulfillment, line: BoardLine, packed: boolean) {
    void patchFulfillment(f, { packed: [{ orderItemId: line.orderItemId, packed }] }, `packed-${f.id}-${line.orderItemId}`);
  }

  async function loadManifest() {
    const orgId = getOrganizationId(); if (!orgId || !manifestCourier) return;
    setManifestError(""); setManifestBusy(true);
    try {
      const data = await apiFetch<Manifest>(
        `/organizations/${orgId}/fulfillments/manifest?courier=${encodeURIComponent(manifestCourier)}`,
      );
      setManifest(data);
    } catch (e) {
      setManifest(null);
      setManifestError(e instanceof Error ? e.message : dict.commerce.couldNotLoadTheManifest);
    } finally { setManifestBusy(false); }
  }

  // ---- ON6: pick waves, escalations, SLA settings ----
  const loadWaves = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const data = await apiFetch<WaveRow[]>(`/organizations/${orgId}/pick-waves`);
      setWaves(data ?? []);
    } catch (e) { setWaveError(e instanceof Error ? e.message : dict.commerce.couldNotLoadPickWaves); }
  }, []);

  const loadSuggestions = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const data = await apiFetch<{ groups: SuggestionGroup[]; capped: boolean }>(`/organizations/${orgId}/pick-wave-suggestions`);
      setSuggestions(data?.groups ?? []);
      setSuggestionsCapped(Boolean(data?.capped));
    } catch (e) { setWaveError(e instanceof Error ? e.message : dict.commerce.couldNotLoadWaveSuggestions); }
  }, []);

  const loadEscalations = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const data = await apiFetch<EscalationRow[]>(`/organizations/${orgId}/fulfillment-escalations`);
      setEscalations(data ?? []);
    } catch (e) { setEscalationsError(e instanceof Error ? e.message : dict.commerce.couldNotLoadEscalations); }
  }, []);

  const loadFsSettings = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const s = await apiFetch<FulfillmentSettings>(`/organizations/${orgId}/fulfillment-settings`);
      setFsForm({
        confirmToPackHours: String(s.confirmToPackHours),
        packToHandoverHours: String(s.packToHandoverHours),
        stuckDays: String(s.stuckDays),
      });
    } catch (e) { setFsError(e instanceof Error ? e.message : dict.commerce.couldNotLoadSLASettings); }
  }, []);

  const loadRto = useCallback(async (from?: string, to?: string) => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setRtoBusy(true); setRtoError("");
    try {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const q = qs.toString();
      const data = await apiFetch<any>(`/organizations/${orgId}/courier/rto-report${q ? `?${q}` : ""}`);
      setRto(data);
    } catch (e) { setRtoError(e instanceof Error ? e.message : dict.commerce.couldNotLoadTheRTO); }
    finally { setRtoBusy(false); }
  }, []);

  useEffect(() => { void loadWaves(); void loadSuggestions(); void loadEscalations(); void loadFsSettings(); void loadRto(); },
    [loadWaves, loadSuggestions, loadEscalations, loadFsSettings, loadRto]);

  async function loadWaveDetail(waveId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const data = await apiFetch<WaveDetail>(`/organizations/${orgId}/pick-waves/${waveId}`);
    setWaveDetails((prev) => ({ ...prev, [waveId]: data }));
  }

  async function toggleWave(waveId: string) {
    if (expandedWave === waveId) { setExpandedWave(""); return; }
    setExpandedWave(waveId);
    if (!waveDetails[waveId]) {
      setWaveError("");
      try { await loadWaveDetail(waveId); }
      catch (e) { setWaveError(e instanceof Error ? e.message : dict.commerce.couldNotLoadWaveDetails); }
    }
  }

  /** Create a wave from a suggestion group; per-order failures
   * from the server are shown verbatim. */
  async function createWaveFromGroup(g: SuggestionGroup) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setWaveBusy(`suggest-${g.key}`); setWaveError(""); setWaveNotice("");
    try {
      const out = await apiFetch<{ wave: { id: string }; results: { orderId: string; ok: boolean; error?: string }[] }>(
        `/organizations/${orgId}/pick-waves`,
        { method: "POST", body: JSON.stringify({ orderIds: g.orderIds }) },
      );
      const failed = out.results.filter((r) => !r.ok);
      const added = out.results.length - failed.length;
      setWaveNotice(
        t("commerce.waveCreatedOrdersAdded", { added: added }) +
        (failed.length ? t("commerce.notAdded", { failed: failed.map((r) => `#${r.orderId.slice(0, 8)} — ${r.error ?? dict.commerce.unknownError}`).join("; ") }) : ""),
      );
      await loadWaves();
      void loadSuggestions();
    } catch (e) { setWaveError(e instanceof Error ? e.message : dict.commerce.waveCreationFailed); }
    finally { setWaveBusy(""); }
  }

  async function waveAction(waveId: string, path: string, method: string, busyKey: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setWaveBusy(busyKey); setWaveError(""); setWaveNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/pick-waves/${waveId}${path}`, { method });
      await loadWaveDetail(waveId);
      await loadWaves();
    } catch (e) { setWaveError(e instanceof Error ? e.message : dict.commerce.waveActionFailed); }
    finally { setWaveBusy(""); }
  }

  async function saveFsSettings() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setFsBusy(true); setFsError(""); setFsNotice("");
    try {
      const updated = await apiFetch<FulfillmentSettings>(`/organizations/${orgId}/fulfillment-settings`, {
        method: "PUT",
        body: JSON.stringify({
          confirmToPackHours: Number(fsForm.confirmToPackHours),
          packToHandoverHours: Number(fsForm.packToHandoverHours),
          stuckDays: Number(fsForm.stuckDays),
        }),
      });
      setFsForm({
        confirmToPackHours: String(updated.confirmToPackHours),
        packToHandoverHours: String(updated.packToHandoverHours),
        stuckDays: String(updated.stuckDays),
      });
      setFsNotice(dict.commerce.sLASettingsSaved);
      void load();
    } catch (e) { setFsError(e instanceof Error ? e.message : dict.commerce.sLASettingsSaveFailed); }
    finally { setFsBusy(false); }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">{dict.commerce.dispatchBoardPickPack}</h1>
        <p className="text-sm text-slate-500">
          {dict.commerce.todaySFulfillmentsParcelsWaiting}</p>
        {board ? (
          <p className="mt-1 text-sm text-slate-500">
            {dict.commerce.date2}{fmtDate(locale, new Date(board.date))} {dict.commerce.total2}{board.total}{dict.commerce.fulfillments}</p>
        ) : null}
      </div>

      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      {loading ? <p className="text-sm text-slate-500">{dict.common.loading}</p> : null}
      {!loading && board && board.fulfillments.length === 0 ? (
        <div className="card p-5"><p className="text-sm text-slate-500">{dict.commerce.noFulfillmentsToDispatchToday}</p></div>
      ) : null}

      {groups.map(([courier, items]) => (
        <div key={courier} className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">{courier === NO_COURIER_KEY ? dict.commerce.courierNotAssigned : courier}</div>
            <span className="text-xs text-slate-500">{items.length}{dict.commerce.parcels}</span>
          </div>
          <div className="mt-4 space-y-4">
            {items.map((f) => (
              <div key={f.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm">
                    <span className="font-semibold">{dict.commerce.order3}{f.orderNumber ?? f.orderId}</span>
                    <span className={`ml-3 rounded px-2 py-0.5 text-xs font-semibold ${statusBadge(f.status)}`}>{f.status}</span>
                    {f.sla && (f.sla.stage === "awaiting_pack" || f.sla.stage === "awaiting_handover") ? (
                      <span className={`ml-2 rounded px-2 py-0.5 text-xs font-semibold ${f.sla.breached ? "bg-red-100 text-red-700" : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"}`}>
                        {slaStageLabel(f.sla.stage)} · {formatAge(f.sla.ageHours)}{f.sla.breached ? dict.commerce.sLABreach : ""}
                      </span>
                    ) : null}
                    <span className="mt-1 block text-xs text-slate-500">
                      Tracking: {f.trackingCode ?? "—"} {dict.commerce.totalItems}{f.itemCount} · {fmtDateTime(locale, new Date(f.createdAt))}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                      disabled={busy !== ""}
                      onClick={() => patchFulfillment(f, { status: "packed" }, `status-${f.id}-packed`)}
                    >
                      {busy === `status-${f.id}-packed` ? dict.commerce.ing : "Packed"}
                    </button>
                    <button
                      type="button"
                      className="inline-flex min-h-[44px] items-center rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                      disabled={busy !== ""}
                      onClick={() => patchFulfillment(f, { status: "handed_over" }, `status-${f.id}-handed_over`)}
                    >
                      {busy === `status-${f.id}-handed_over` ? dict.commerce.ing : dict.commerce.handedToCourier}
                    </button>
                  </div>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {f.lines.map((line) => (
                    <li key={line.orderItemId} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        aria-label={t("commerce.packed", { name: line.name })}
                        checked={Boolean(line.packed)}
                        disabled={busy !== ""}
                        onChange={(e) => togglePacked(f, line, e.target.checked)}
                      />
                      <span className={line.packed ? "text-slate-400 line-through" : ""}>
                        {line.name} × {line.quantity}
                      </span>
                      {line.packed ? <span className="text-xs font-semibold text-green-700">{dict.commerce.packed2}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* ON6: pick waves + SLA settings */}
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-semibold">{dict.commerce.pickWave}</div>
            <p className="mt-1 text-sm text-slate-500">{dict.commerce.createWavesFromSuggestedGroups}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-600">{dict.commerce.sLASettings}</p>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="text-xs text-slate-500">{dict.commerce.confirmPackHours}<input className="input mt-1 w-24" type="number" min={1} max={720} value={fsForm.confirmToPackHours}
                  onChange={(e) => setFsForm({ ...fsForm, confirmToPackHours: e.target.value })} />
              </label>
              <label className="text-xs text-slate-500">{dict.commerce.packHandoverHours}<input className="input mt-1 w-24" type="number" min={1} max={720} value={fsForm.packToHandoverHours}
                  onChange={(e) => setFsForm({ ...fsForm, packToHandoverHours: e.target.value })} />
              </label>
              <label className="text-xs text-slate-500">{dict.commerce.stuckThresholdDays}<input className="input mt-1 w-24" type="number" min={1} max={720} value={fsForm.stuckDays}
                  onChange={(e) => setFsForm({ ...fsForm, stuckDays: e.target.value })} />
              </label>
              <button type="button" className="btn-primary btn-sm" disabled={fsBusy} onClick={() => void saveFsSettings()}>
                {fsBusy ? dict.commerce.saving : dict.commerce.save}
              </button>
            </div>
            {fsError ? <p className="mt-2 text-xs text-red-600">{fsError}</p> : null}
            {fsNotice ? <p className="mt-2 text-xs text-green-700">{fsNotice}</p> : null}
          </div>
        </div>

        {waveError ? <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{waveError}</p> : null}
        {waveNotice ? <p className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-700">{waveNotice}</p> : null}

        <div className="mt-4">
          <p className="text-sm font-semibold text-slate-700">{dict.commerce.suggestedGroupsWaitingToPack}</p>
          {suggestions === null ? (
            <p className="mt-1 text-sm text-slate-400">{dict.common.loading}</p>
          ) : suggestions.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">{dict.commerce.noOrdersAreWaitingTo}</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {suggestions.map((g) => (
                <li key={g.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                  <span><span className="font-medium">{g.label}</span> <span className="text-slate-500">· {g.count}{dict.commerce.orders}</span></span>
                  <button type="button" className="btn-secondary btn-sm inline-flex min-h-[44px] items-center" disabled={waveBusy !== ""}
                    onClick={() => void createWaveFromGroup(g)}>
                    {waveBusy === `suggest-${g.key}` ? dict.commerce.creating : dict.commerce.createWave}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {suggestionsCapped ? (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{dict.commerce.manyOrdersAreWaitingOnly}</p>
          ) : null}
        </div>

        <div className="mt-5">
          <p className="text-sm font-semibold text-slate-700">{dict.commerce.waves}</p>
          {waves === null ? (
            <p className="mt-1 text-sm text-slate-400">{dict.common.loading}</p>
          ) : waves.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">{dict.commerce.noPickWavesCreatedYet}</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {waves.map((w) => {
                const detail = waveDetails[w.id];
                const open = expandedWave === w.id;
                return (
                  <li key={w.id} className="rounded-lg border px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <button type="button" className="text-left font-medium hover:underline" onClick={() => void toggleWave(w.id)}>
                        {open ? "▾" : "▸"} {dict.commerce.wave}{fmtDateTime(locale, new Date(w.createdAt))}
                        {w.note ? <span className="ml-2 font-normal text-slate-500">{w.note}</span> : null}
                      </button>
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${w.status === "open" ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-600"}`}>
                          {w.status === "open" ? dict.commerce.open3 : dict.commerce.closed}
                        </span>
                        <span className="text-xs text-slate-500">{dict.commerce.pick}{w.progress.picked}/{w.progress.total}</span>
                        {w.status === "open" ? (
                          <button type="button" className="inline-flex min-h-[44px] items-center rounded-lg border px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
                            disabled={waveBusy !== ""} onClick={() => void waveAction(w.id, "/close", "POST", `close-${w.id}`)}>
                            {waveBusy === `close-${w.id}` ? dict.commerce.ing : dict.commerce.waveClosed}
                          </button>
                        ) : null}
                      </span>
                    </div>
                    {open ? (
                      detail ? (
                        <ul className="mt-2 space-y-1.5 border-t pt-2">
                          {detail.orders.length === 0 ? <li className="text-xs text-slate-500">{dict.commerce.noOrdersInThisWave}</li> : null}
                          {detail.orders.map((o) => (
                            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                              <span>
                                <span className="font-medium">#{o.orderNumber ?? o.orderId.slice(0, 8)}</span>
                                {o.status ? <span className="ml-2 text-xs text-slate-500">{o.status}</span> : null}
                                {o.pickedAt ? <span className="ml-2 text-xs font-semibold text-green-700">{dict.commerce.picked2}{fmtDateTime(locale, new Date(o.pickedAt))}</span> : null}
                                {summarizeAllocations(o.allocations).length > 0 ? (
                                  <span className="mt-1 flex flex-wrap gap-1">
                                    {summarizeAllocations(o.allocations).map((chip) => (
                                      <span key={chip.key} className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700">{chip.label} ×{chip.qty}</span>
                                    ))}
                                  </span>
                                ) : null}
                              </span>
                              {w.status === "open" ? (
                                <span className="flex gap-2">
                                  {!o.pickedAt ? (
                                    <button type="button" className="inline-flex min-h-[44px] items-center rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                                      disabled={waveBusy !== ""} onClick={() => void waveAction(w.id, `/orders/${o.orderId}/pick`, "POST", `pick-${w.id}-${o.orderId}`)}>
                                      {waveBusy === `pick-${w.id}-${o.orderId}` ? dict.commerce.ing : dict.commerce.pickComplete}
                                    </button>
                                  ) : null}
                                  {!o.pickedAt ? (
                                    <button type="button" className="inline-flex min-h-[44px] items-center text-xs font-semibold text-red-600 hover:underline disabled:opacity-50"
                                      disabled={waveBusy !== ""} onClick={() => void waveAction(w.id, `/orders/${o.orderId}`, "DELETE", `remove-${w.id}-${o.orderId}`)}>
                                      {waveBusy === `remove-${w.id}-${o.orderId}` ? dict.commerce.removing : dict.commerce.remove2}
                                    </button>
                                  ) : null}
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : <p className="mt-2 text-xs text-slate-500">{dict.common.loading}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* ON6: escalated (stuck) parcels */}
      <div className="card p-5">
        <div className="font-semibold">{dict.commerce.escalationsStuckParcels}</div>
        <p className="mt-1 text-sm text-slate-500">{dict.commerce.parcelsStuckInTheSame}</p>
        {escalationsError ? <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{escalationsError}</p> : null}
        {escalations === null && !escalationsError ? (
          <p className="mt-3 text-sm text-slate-400">{dict.common.loading}</p>
        ) : (escalations ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">{dict.commerce.noStuckParcelEscalationsRight}</p>
        ) : (
          <ResponsiveTable
            className="mt-3"
            table={
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 pr-3">{dict.commerce.orderNumber}</th>
                  <th className="py-2 pr-3">{dict.commerce.courier}</th>
                  <th className="py-2 pr-3">Tracking</th>
                  <th className="py-2 pr-3">{dict.commerce.status}</th>
                  <th className="py-2">{dict.commerce.daysStuck}</th>
                </tr>
              </thead>
              <tbody>
                {(escalations ?? []).map((s, i) => (
                  <tr key={s.id ?? `${s.orderId}-${i}`} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{s.orderNumber ?? s.orderId.slice(0, 8)}</td>
                    <td className="py-2 pr-3">{s.provider ?? "—"}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{s.trackingCode ?? "—"}</td>
                    <td className="py-2 pr-3">{s.status ?? "—"}</td>
                    <td className="py-2">{s.ageDays == null ? "—" : t("commerce.days2", { ageDays: s.ageDays })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            }
            cards={(escalations ?? []).map((s, i) => (
              <div key={s.id ?? `${s.orderId}-${i}`} className="rounded-xl border bg-white p-3 text-sm shadow-sm">
                <dl className="space-y-1.5">
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.orderNumber}</dt><dd className="text-right font-medium">{s.orderNumber ?? s.orderId.slice(0, 8)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.courier}</dt><dd className="text-right">{s.provider ?? "—"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">Tracking</dt><dd className="text-right font-mono text-xs">{s.trackingCode ?? "—"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.status}</dt><dd className="text-right">{s.status ?? "—"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.daysStuck}</dt><dd className="text-right">{s.ageDays == null ? "—" : t("commerce.days2", { ageDays: s.ageDays })}</dd></div>
                </dl>
              </div>
            ))}
          />
        )}
      </div>

      <div className="card p-5 print:shadow-none">
        <div className="font-semibold">{dict.commerce.handoverManifest}</div>
        <p className="mt-1 text-sm text-slate-500">{dict.commerce.selectACourierToSee}</p>
        <div className="mt-3 flex flex-wrap items-end gap-3 print:hidden">
          <label className="block text-sm">{dict.commerce.courier}<select className="input mt-1" value={manifestCourier} onChange={(e) => setManifestCourier(e.target.value)}>
              {couriers.length === 0 ? <option value="">{dict.commerce.noCourierAssigned}</option> : null}
              {couriers.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <button
            type="button"
            className="btn-primary disabled:opacity-50"
            disabled={manifestBusy || !manifestCourier}
            onClick={loadManifest}
          >
            {manifestBusy ? dict.common.loading : dict.commerce.viewManifest}
          </button>
        </div>
        {manifestError ? <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{manifestError}</p> : null}
        {manifest ? (
          <div className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <span className="font-semibold">{manifest.courier}</span>
                <span className="ml-2 text-slate-500">{manifest.date}</span>
                <span className="ml-2 text-slate-500">{dict.commerce.totalParcels}{manifest.totalParcels} {dict.commerce.totalItems}{manifest.totalItems}</span>
              </div>
              <button type="button" className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-1.5 text-xs font-semibold print:hidden" onClick={() => window.print()}>
                {dict.commerce.print}</button>
            </div>
            {manifest.rows.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">{dict.commerce.noParcelsForThisCourier}</p>
            ) : (
              <ResponsiveTable
                className="mt-3"
                table={
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-slate-500">
                      <th className="py-2 pr-3">{dict.commerce.trackingCode}</th>
                      <th className="py-2 pr-3">{dict.commerce.orderNumber}</th>
                      <th className="py-2 pr-3">{dict.commerce.itemCount}</th>
                      <th className="py-2">{dict.commerce.status}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {manifest.rows.map((r, i) => (
                      <tr key={`${r.trackingCode ?? "na"}-${i}`} className="border-b last:border-0">
                        <td className="py-2 pr-3 font-mono text-xs">{r.trackingCode ?? "—"}</td>
                        <td className="py-2 pr-3">{r.orderNumber ?? "—"}</td>
                        <td className="py-2 pr-3">{r.itemCount}</td>
                        <td className="py-2"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${statusBadge(r.status)}`}>{r.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
                }
                cards={manifest.rows.map((r, i) => (
                  <div key={`${r.trackingCode ?? "na"}-${i}`} className="rounded-xl border bg-white p-3 text-sm shadow-sm">
                    <dl className="space-y-1.5">
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.trackingCode}</dt><dd className="text-right font-mono text-xs">{r.trackingCode ?? "—"}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.orderNumber}</dt><dd className="text-right">{r.orderNumber ?? "—"}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.itemCount}</dt><dd className="text-right">{r.itemCount}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.status}</dt><dd className="text-right"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${statusBadge(r.status)}`}>{r.status}</span></dd></div>
                    </dl>
                  </div>
                ))}
              />
            )}
          </div>
        ) : null}

        {/* GB5 (GC14): RTO report — per provider, booked-cohort. */}
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{dict.commerce.rTOReportReturnedParcels}</h2>
            <span className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-slate-500">{dict.commerce.from}<input type="date" className="input w-auto" value={rtoFrom} onChange={(e) => setRtoFrom(e.target.value)} /></label>
              <label className="flex items-center gap-1.5 text-xs text-slate-500">{dict.commerce.until}<input type="date" className="input w-auto" value={rtoTo} onChange={(e) => setRtoTo(e.target.value)} /></label>
              <button type="button" className="btn-secondary btn-sm inline-flex min-h-[44px] items-center" disabled={rtoBusy} onClick={() => void loadRto(rtoFrom || undefined, rtoTo || undefined)}>{rtoBusy ? dict.common.loading : dict.commerce.view}</button>
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {dict.commerce.accountsByBookingDateDefault}</p>
          {rtoError ? <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{rtoError}</p> : null}
          {rto ? (
            <ResponsiveTable
              className="mt-3"
              table={
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-slate-500">
                    <th className="py-2 pr-3">{dict.commerce.courier}</th>
                    <th className="py-2 pr-3">{dict.commerce.booked}</th>
                    <th className="py-2 pr-3">{dict.commerce.delivered2}</th>
                    <th className="py-2 pr-3">{dict.commerce.returnedRTO}</th>
                    <th className="py-2 pr-3">{dict.commerce.rTORate}</th>
                    <th className="py-2">{dict.commerce.averageReturnTime}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...(rto.providers ?? []), ...(rto.totals ? [{ ...rto.totals, provider: dict.commerce.total }] : [])].map((row: any) => (
                    <tr key={row.provider} className={`border-b last:border-0 ${row.provider === dict.commerce.total ? "font-semibold" : ""}`}>
                      <td className="py-2 pr-3">{row.provider === "steadfast" ? "Steadfast" : row.provider === "pathao" ? "Pathao" : row.provider === "redx" ? "RedX" : row.provider === "ecourier" ? "eCourier" : row.provider}</td>
                      <td className="py-2 pr-3">{row.booked}</td>
                      <td className="py-2 pr-3">{row.delivered}</td>
                      <td className="py-2 pr-3">{row.returned}</td>
                      <td className="py-2 pr-3">{row.rtoRatePct != null ? `${row.rtoRatePct}%` : "—"}</td>
                      <td className="py-2">{row.avgDaysToReturn != null ? t("commerce.daysN", { avgDaysToReturn: row.avgDaysToReturn, timingN: row.timingN }) : `— (n=${row.timingN ?? 0})`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(rto.providers ?? []).length === 0 ? <p className="mt-2 text-sm text-slate-500">{dict.commerce.noParcelsBookedInThis}</p> : null}
            </div>
              }
              cards={(<>
              {[...(rto.providers ?? []), ...(rto.totals ? [{ ...rto.totals, provider: dict.commerce.total }] : [])].map((row: any) => (
                <div key={row.provider} className={`rounded-xl border bg-white p-3 text-sm shadow-sm ${row.provider === dict.commerce.total ? "font-semibold" : ""}`}>
                  <dl className="space-y-1.5">
                    <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.courier}</dt><dd className="text-right">{row.provider === "steadfast" ? "Steadfast" : row.provider === "pathao" ? "Pathao" : row.provider === "redx" ? "RedX" : row.provider === "ecourier" ? "eCourier" : row.provider}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.booked}</dt><dd className="text-right">{row.booked}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.delivered2}</dt><dd className="text-right">{row.delivered}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.returnedRTO}</dt><dd className="text-right">{row.returned}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.rTORate}</dt><dd className="text-right">{row.rtoRatePct != null ? `${row.rtoRatePct}%` : "—"}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.averageReturnTime}</dt><dd className="text-right">{row.avgDaysToReturn != null ? t("commerce.daysN", { avgDaysToReturn: row.avgDaysToReturn, timingN: row.timingN }) : `— (n=${row.timingN ?? 0})`}</dd></div>
                  </dl>
                </div>
              ))}
              {(rto.providers ?? []).length === 0 ? <p className="text-sm text-slate-500">{dict.commerce.noParcelsBookedInThis}</p> : null}
              </>)}
            />
          ) : rtoBusy ? <p className="mt-2 text-sm text-slate-500">{dict.common.loading}</p> : null}
        </div>
      </div>
    </div>
  );
}
