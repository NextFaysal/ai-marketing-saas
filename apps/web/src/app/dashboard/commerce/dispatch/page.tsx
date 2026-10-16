"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatAge, slaStageLabel } from "@/lib/orders-on5";
import { summarizeAllocations, type AllocationLike } from "@/lib/warehouse-ab3";

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

const NO_COURIER = "কুরিয়ার বরাদ্দ হয়নি";

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
    if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); setLoading(false); return; }
    try {
      const data = await apiFetch<Board>(`/organizations/${orgId}/fulfillments/board`);
      setBoard(data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "ডিসপ্যাচ বোর্ড লোড করা যায়নি");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Group by courier; the null-courier group keeps its own label and
  // can never be used for a manifest (the API requires a provider).
  const groups = useMemo(() => {
    const map = new Map<string, Fulfillment[]>();
    for (const f of board?.fulfillments ?? []) {
      const key = f.courierProvider ?? NO_COURIER;
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
      setError(e instanceof Error ? e.message : "আপডেট করা যায়নি");
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
      setManifestError(e instanceof Error ? e.message : "ম্যানিফেস্ট লোড করা যায়নি");
    } finally { setManifestBusy(false); }
  }

  // ---- ON6: pick waves, escalations, SLA settings ----
  const loadWaves = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const data = await apiFetch<WaveRow[]>(`/organizations/${orgId}/pick-waves`);
      setWaves(data ?? []);
    } catch (e) { setWaveError(e instanceof Error ? e.message : "পিক ওয়েভ লোড করা যায়নি"); }
  }, []);

  const loadSuggestions = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const data = await apiFetch<{ groups: SuggestionGroup[]; capped: boolean }>(`/organizations/${orgId}/pick-wave-suggestions`);
      setSuggestions(data?.groups ?? []);
      setSuggestionsCapped(Boolean(data?.capped));
    } catch (e) { setWaveError(e instanceof Error ? e.message : "ওয়েভ প্রস্তাব লোড করা যায়নি"); }
  }, []);

  const loadEscalations = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const data = await apiFetch<EscalationRow[]>(`/organizations/${orgId}/fulfillment-escalations`);
      setEscalations(data ?? []);
    } catch (e) { setEscalationsError(e instanceof Error ? e.message : "এসকেলেশন লোড করা যায়নি"); }
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
    } catch (e) { setFsError(e instanceof Error ? e.message : "SLA সেটিংস লোড করা যায়নি"); }
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
    } catch (e) { setRtoError(e instanceof Error ? e.message : "RTO রিপোর্ট লোড করা যায়নি"); }
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
      catch (e) { setWaveError(e instanceof Error ? e.message : "ওয়েভের বিবরণ লোড করা যায়নি"); }
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
        `ওয়েভ তৈরি হয়েছে: ${added}টি অর্ডার যোগ হয়েছে।` +
        (failed.length ? ` যোগ হয়নি: ${failed.map((r) => `#${r.orderId.slice(0, 8)} — ${r.error ?? "অজানা ত্রুটি"}`).join("; ")}` : ""),
      );
      await loadWaves();
      void loadSuggestions();
    } catch (e) { setWaveError(e instanceof Error ? e.message : "ওয়েভ তৈরি ব্যর্থ"); }
    finally { setWaveBusy(""); }
  }

  async function waveAction(waveId: string, path: string, method: string, busyKey: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setWaveBusy(busyKey); setWaveError(""); setWaveNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/pick-waves/${waveId}${path}`, { method });
      await loadWaveDetail(waveId);
      await loadWaves();
    } catch (e) { setWaveError(e instanceof Error ? e.message : "ওয়েভ অ্যাকশন ব্যর্থ"); }
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
      setFsNotice("SLA সেটিংস সংরক্ষণ হয়েছে।");
      void load();
    } catch (e) { setFsError(e instanceof Error ? e.message : "SLA সেটিংস সংরক্ষণ ব্যর্থ"); }
    finally { setFsBusy(false); }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Dispatch বোর্ড — পিক / প্যাক</h1>
        <p className="text-sm text-slate-500">
          আজকের ফুলফিলমেন্ট ও ডিসপ্যাচের অপেক্ষায় থাকা পার্সেলগুলো কুরিয়ার অনুযায়ী সাজানো।
          প্রতিটি লাইন প্যাক হলে টিক দিন — সব লাইন প্যাক হলেই ফুলফিলমেন্টটি Packed হয়ে যাবে।
        </p>
        {board ? (
          <p className="mt-1 text-sm text-slate-500">
            তারিখ: {new Date(board.date).toLocaleDateString("bn-BD")} · মোট {board.total}টি ফুলফিলমেন্ট
          </p>
        ) : null}
      </div>

      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      {loading ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : null}
      {!loading && board && board.fulfillments.length === 0 ? (
        <div className="card p-5"><p className="text-sm text-slate-500">আজ ডিসপ্যাচের জন্য কোনো ফুলফিলমেন্ট নেই।</p></div>
      ) : null}

      {groups.map(([courier, items]) => (
        <div key={courier} className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">{courier}</div>
            <span className="text-xs text-slate-500">{items.length}টি পার্সেল</span>
          </div>
          <div className="mt-4 space-y-4">
            {items.map((f) => (
              <div key={f.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm">
                    <span className="font-semibold">অর্ডার: {f.orderNumber ?? f.orderId}</span>
                    <span className={`ml-3 rounded px-2 py-0.5 text-xs font-semibold ${statusBadge(f.status)}`}>{f.status}</span>
                    {f.sla && (f.sla.stage === "awaiting_pack" || f.sla.stage === "awaiting_handover") ? (
                      <span className={`ml-2 rounded px-2 py-0.5 text-xs font-semibold ${f.sla.breached ? "bg-red-100 text-red-700" : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"}`}>
                        {slaStageLabel(f.sla.stage)} · {formatAge(f.sla.ageHours)}{f.sla.breached ? " · SLA ভঙ্গ" : ""}
                      </span>
                    ) : null}
                    <span className="mt-1 block text-xs text-slate-500">
                      Tracking: {f.trackingCode ?? "—"} · মোট আইটেম: {f.itemCount} · {new Date(f.createdAt).toLocaleString("bn-BD")}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                      disabled={busy !== ""}
                      onClick={() => patchFulfillment(f, { status: "packed" }, `status-${f.id}-packed`)}
                    >
                      {busy === `status-${f.id}-packed` ? "হচ্ছে…" : "Packed"}
                    </button>
                    <button
                      type="button"
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                      disabled={busy !== ""}
                      onClick={() => patchFulfillment(f, { status: "handed_over" }, `status-${f.id}-handed_over`)}
                    >
                      {busy === `status-${f.id}-handed_over` ? "হচ্ছে…" : "কুরিয়ারে হস্তান্তর"}
                    </button>
                  </div>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {f.lines.map((line) => (
                    <li key={line.orderItemId} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(line.packed)}
                        disabled={busy !== ""}
                        onChange={(e) => togglePacked(f, line, e.target.checked)}
                      />
                      <span className={line.packed ? "text-slate-400 line-through" : ""}>
                        {line.name} × {line.quantity}
                      </span>
                      {line.packed ? <span className="text-xs font-semibold text-green-700">প্যাক হয়েছে</span> : null}
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
            <div className="font-semibold">পিক ওয়েভ</div>
            <p className="mt-1 text-sm text-slate-500">কুরিয়ার/জেলা অনুযায়ী প্রস্তাবিত গ্রুপ থেকে ওয়েভ তৈরি করুন, অর্ডার পিক করুন, শেষ হলে ওয়েভ বন্ধ করুন।</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-600">SLA সেটিংস</p>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="text-xs text-slate-500">নিশ্চিত → প্যাক (ঘণ্টা)
                <input className="input mt-1 w-24" type="number" min={1} max={720} value={fsForm.confirmToPackHours}
                  onChange={(e) => setFsForm({ ...fsForm, confirmToPackHours: e.target.value })} />
              </label>
              <label className="text-xs text-slate-500">প্যাক → হস্তান্তর (ঘণ্টা)
                <input className="input mt-1 w-24" type="number" min={1} max={720} value={fsForm.packToHandoverHours}
                  onChange={(e) => setFsForm({ ...fsForm, packToHandoverHours: e.target.value })} />
              </label>
              <label className="text-xs text-slate-500">আটকে থাকা সীমা (দিন)
                <input className="input mt-1 w-24" type="number" min={1} max={720} value={fsForm.stuckDays}
                  onChange={(e) => setFsForm({ ...fsForm, stuckDays: e.target.value })} />
              </label>
              <button type="button" className="btn-primary btn-sm" disabled={fsBusy} onClick={() => void saveFsSettings()}>
                {fsBusy ? "সংরক্ষণ হচ্ছে…" : "সংরক্ষণ"}
              </button>
            </div>
            {fsError ? <p className="mt-2 text-xs text-red-600">{fsError}</p> : null}
            {fsNotice ? <p className="mt-2 text-xs text-green-700">{fsNotice}</p> : null}
          </div>
        </div>

        {waveError ? <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{waveError}</p> : null}
        {waveNotice ? <p className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-700">{waveNotice}</p> : null}

        <div className="mt-4">
          <p className="text-sm font-semibold text-slate-700">প্রস্তাবিত গ্রুপ (প্যাকের অপেক্ষায়)</p>
          {suggestions === null ? (
            <p className="mt-1 text-sm text-slate-400">লোড হচ্ছে…</p>
          ) : suggestions.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">এখন প্যাকের অপেক্ষায় কোনো অর্ডার নেই — কোনো গ্রুপ প্রস্তাব করা যাচ্ছে না।</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {suggestions.map((g) => (
                <li key={g.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                  <span><span className="font-medium">{g.label}</span> <span className="text-slate-500">· {g.count}টি অর্ডার</span></span>
                  <button type="button" className="btn-secondary btn-sm" disabled={waveBusy !== ""}
                    onClick={() => void createWaveFromGroup(g)}>
                    {waveBusy === `suggest-${g.key}` ? "তৈরি হচ্ছে…" : "ওয়েভ তৈরি"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {suggestionsCapped ? (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">অনেক অর্ডার অপেক্ষায় — প্রস্তাবে সর্বশেষ ২০০টি অর্ডারই ধরা হয়েছে।</p>
          ) : null}
        </div>

        <div className="mt-5">
          <p className="text-sm font-semibold text-slate-700">ওয়েভসমূহ</p>
          {waves === null ? (
            <p className="mt-1 text-sm text-slate-400">লোড হচ্ছে…</p>
          ) : waves.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">এখনো কোনো পিক ওয়েভ তৈরি হয়নি।</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {waves.map((w) => {
                const detail = waveDetails[w.id];
                const open = expandedWave === w.id;
                return (
                  <li key={w.id} className="rounded-lg border px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <button type="button" className="text-left font-medium hover:underline" onClick={() => void toggleWave(w.id)}>
                        {open ? "▾" : "▸"} ওয়েভ · {new Date(w.createdAt).toLocaleString("bn-BD")}
                        {w.note ? <span className="ml-2 font-normal text-slate-500">{w.note}</span> : null}
                      </button>
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${w.status === "open" ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-600"}`}>
                          {w.status === "open" ? "খোলা" : "বন্ধ"}
                        </span>
                        <span className="text-xs text-slate-500">পিক: {w.progress.picked}/{w.progress.total}</span>
                        {w.status === "open" ? (
                          <button type="button" className="rounded-lg border px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
                            disabled={waveBusy !== ""} onClick={() => void waveAction(w.id, "/close", "POST", `close-${w.id}`)}>
                            {waveBusy === `close-${w.id}` ? "হচ্ছে…" : "ওয়েভ বন্ধ"}
                          </button>
                        ) : null}
                      </span>
                    </div>
                    {open ? (
                      detail ? (
                        <ul className="mt-2 space-y-1.5 border-t pt-2">
                          {detail.orders.length === 0 ? <li className="text-xs text-slate-400">এই ওয়েভে কোনো অর্ডার নেই।</li> : null}
                          {detail.orders.map((o) => (
                            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                              <span>
                                <span className="font-medium">#{o.orderNumber ?? o.orderId.slice(0, 8)}</span>
                                {o.status ? <span className="ml-2 text-xs text-slate-500">{o.status}</span> : null}
                                {o.pickedAt ? <span className="ml-2 text-xs font-semibold text-green-700">পিক হয়েছে · {new Date(o.pickedAt).toLocaleString("bn-BD")}</span> : null}
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
                                    <button type="button" className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                                      disabled={waveBusy !== ""} onClick={() => void waveAction(w.id, `/orders/${o.orderId}/pick`, "POST", `pick-${w.id}-${o.orderId}`)}>
                                      {waveBusy === `pick-${w.id}-${o.orderId}` ? "হচ্ছে…" : "পিক সম্পন্ন"}
                                    </button>
                                  ) : null}
                                  {!o.pickedAt ? (
                                    <button type="button" className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50"
                                      disabled={waveBusy !== ""} onClick={() => void waveAction(w.id, `/orders/${o.orderId}`, "DELETE", `remove-${w.id}-${o.orderId}`)}>
                                      {waveBusy === `remove-${w.id}-${o.orderId}` ? "সরানো হচ্ছে…" : "সরিয়ে দিন"}
                                    </button>
                                  ) : null}
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : <p className="mt-2 text-xs text-slate-400">লোড হচ্ছে…</p>
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
        <div className="font-semibold">এসকেলেশন (আটকে থাকা পার্সেল)</div>
        <p className="mt-1 text-sm text-slate-500">নির্ধারিত দিনের বেশি সময় একই অবস্থায় থাকা পার্সেলগুলো এখানে ওঠে আসে — কুরিয়ারের সাথে খোঁজ নিন।</p>
        {escalationsError ? <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{escalationsError}</p> : null}
        {escalations === null && !escalationsError ? (
          <p className="mt-3 text-sm text-slate-400">লোড হচ্ছে…</p>
        ) : (escalations ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">এখন কোনো পার্সেল আটকে থাকার এসকেলেশন নেই।</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 pr-3">অর্ডার নম্বর</th>
                  <th className="py-2 pr-3">কুরিয়ার</th>
                  <th className="py-2 pr-3">Tracking</th>
                  <th className="py-2 pr-3">অবস্থা</th>
                  <th className="py-2">কত দিন আটকে</th>
                </tr>
              </thead>
              <tbody>
                {(escalations ?? []).map((s, i) => (
                  <tr key={s.id ?? `${s.orderId}-${i}`} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{s.orderNumber ?? s.orderId.slice(0, 8)}</td>
                    <td className="py-2 pr-3">{s.provider ?? "—"}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{s.trackingCode ?? "—"}</td>
                    <td className="py-2 pr-3">{s.status ?? "—"}</td>
                    <td className="py-2">{s.ageDays == null ? "—" : `${s.ageDays} দিন`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card p-5 print:shadow-none">
        <div className="font-semibold">হস্তান্তর ম্যানিফেস্ট</div>
        <p className="mt-1 text-sm text-slate-500">কুরিয়ার বেছে নিয়ে আজকের হস্তান্তরের তালিকা দেখুন ও প্রিন্ট করুন।</p>
        <div className="mt-3 flex flex-wrap items-end gap-3 print:hidden">
          <label className="block text-sm">কুরিয়ার
            <select className="input mt-1" value={manifestCourier} onChange={(e) => setManifestCourier(e.target.value)}>
              {couriers.length === 0 ? <option value="">কোনো কুরিয়ার বরাদ্দ হয়নি</option> : null}
              {couriers.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <button
            type="button"
            className="btn-primary disabled:opacity-50"
            disabled={manifestBusy || !manifestCourier}
            onClick={loadManifest}
          >
            {manifestBusy ? "লোড হচ্ছে…" : "ম্যানিফেস্ট দেখুন"}
          </button>
        </div>
        {manifestError ? <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{manifestError}</p> : null}
        {manifest ? (
          <div className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <span className="font-semibold">{manifest.courier}</span>
                <span className="ml-2 text-slate-500">{manifest.date}</span>
                <span className="ml-2 text-slate-500">মোট পার্সেল: {manifest.totalParcels} · মোট আইটেম: {manifest.totalItems}</span>
              </div>
              <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold print:hidden" onClick={() => window.print()}>
                প্রিন্ট করুন
              </button>
            </div>
            {manifest.rows.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">এই কুরিয়ারের জন্য আজ কোনো পার্সেল নেই।</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-slate-500">
                      <th className="py-2 pr-3">Tracking কোড</th>
                      <th className="py-2 pr-3">অর্ডার নম্বর</th>
                      <th className="py-2 pr-3">আইটেম সংখ্যা</th>
                      <th className="py-2">অবস্থা</th>
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
            )}
          </div>
        ) : null}

        {/* GB5 (GC14): RTO report — per provider, booked-cohort. */}
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">↩️ RTO রিপোর্ট — ফেরত আসা পার্সেল</h2>
            <span className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-slate-500">থেকে <input type="date" className="input w-auto" value={rtoFrom} onChange={(e) => setRtoFrom(e.target.value)} /></label>
              <label className="flex items-center gap-1.5 text-xs text-slate-500">পর্যন্ত <input type="date" className="input w-auto" value={rtoTo} onChange={(e) => setRtoTo(e.target.value)} /></label>
              <button type="button" className="btn-secondary btn-sm" disabled={rtoBusy} onClick={() => void loadRto(rtoFrom || undefined, rtoTo || undefined)}>{rtoBusy ? "লোড হচ্ছে..." : "দেখুন"}</button>
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            বুকিংয়ের তারিখ অনুযায়ী হিসাব (ডিফল্ট: শেষ ৩০ দিন)। RTO হার = ফেরত ÷ বুকিং। গড় ফেরত-সময় শুধু সেই পার্সেলগুলো থেকে হিসাব হয় যাদের বুকিং ও ফেরত — দুটো ঘটনাই GC14 ইভেন্ট লগে আছে (n দেখানো হয়েছে); আগের পার্সেলের সময় আন্দাজ করা হয় না।
            যেসব ফেরত পার্সেলের কাজ বাকি, সেগুলো Orders পেজের &quot;RTO — ফেরত পার্সেল দেখা বাকি&quot; কিউতে পাবেন।
          </p>
          {rtoError ? <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{rtoError}</p> : null}
          {rto ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-slate-500">
                    <th className="py-2 pr-3">কুরিয়ার</th>
                    <th className="py-2 pr-3">বুক হয়েছে</th>
                    <th className="py-2 pr-3">ডেলিভারি হয়েছে</th>
                    <th className="py-2 pr-3">ফেরত (RTO)</th>
                    <th className="py-2 pr-3">RTO হার</th>
                    <th className="py-2">গড় ফেরত-সময়</th>
                  </tr>
                </thead>
                <tbody>
                  {[...(rto.providers ?? []), ...(rto.totals ? [{ ...rto.totals, provider: "মোট" }] : [])].map((row: any) => (
                    <tr key={row.provider} className={`border-b last:border-0 ${row.provider === "মোট" ? "font-semibold" : ""}`}>
                      <td className="py-2 pr-3">{row.provider === "steadfast" ? "Steadfast" : row.provider === "pathao" ? "Pathao" : row.provider === "redx" ? "RedX" : row.provider === "ecourier" ? "eCourier" : row.provider}</td>
                      <td className="py-2 pr-3">{row.booked}</td>
                      <td className="py-2 pr-3">{row.delivered}</td>
                      <td className="py-2 pr-3">{row.returned}</td>
                      <td className="py-2 pr-3">{row.rtoRatePct != null ? `${row.rtoRatePct}%` : "—"}</td>
                      <td className="py-2">{row.avgDaysToReturn != null ? `${row.avgDaysToReturn} দিন (n=${row.timingN})` : `— (n=${row.timingN ?? 0})`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(rto.providers ?? []).length === 0 ? <p className="mt-2 text-sm text-slate-500">এই সময়ে কোনো পার্সেল বুক হয়নি।</p> : null}
            </div>
          ) : rtoBusy ? <p className="mt-2 text-sm text-slate-500">লোড হচ্ছে...</p> : null}
        </div>
      </div>
    </div>
  );
}
