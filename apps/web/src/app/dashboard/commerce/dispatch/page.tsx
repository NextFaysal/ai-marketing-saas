"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";

interface BoardLine { orderItemId: string; quantity: number; packed?: boolean; name: string }
interface Fulfillment {
  id: string; orderId: string; orderNumber: string | null; status: string;
  courierProvider: string | null; trackingCode: string | null;
  itemCount: number; lines: BoardLine[]; createdAt: string;
}
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
      </div>
    </div>
  );
}
