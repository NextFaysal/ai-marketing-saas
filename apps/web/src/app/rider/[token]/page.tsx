"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { API_URL } from "@/lib/api";
import { coordsLabel, fixAgeLabel, type RiderFixView } from "@/lib/rider-gps";

interface RiderShareData {
  rider: { id: string; name: string };
  business: string;
  sharingEnabled: boolean;
  shareExpiresAt: string;
  hasActiveAssignment: boolean;
  assignment: { id: string; status: string; orderId: string; orderNumber: string | null; orderStatus: string | null } | null;
  latestLocation: RiderFixView | null;
}

/**
 * NF9 (FB4) — the rider's own share page. The token in the URL
 * is the only credential (resolved by hash server-side).
 *
 * HONEST TRACKING MODEL, stated on the page itself: location
 * is posted ONLY while this page is open on the rider's phone
 * (watchPosition, throttled to one post per 10s) and ONLY while
 * sharing is ON and a delivery assignment is active. Closing
 * the page stops everything — there is NO background tracking
 * and no native app, and the page never claims otherwise.
 */
export default function RiderSharePage() {
  const params = useParams();
  const token = String(params.token ?? "");
  const [data, setData] = useState<RiderShareData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [geoError, setGeoError] = useState("");
  const [lastSentAt, setLastSentAt] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastPostRef = useRef(0);
  const postingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/public/rider/${encodeURIComponent(token)}`);
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.message ?? "লিংকটি পাওয়া যায়নি");
      }
      setData((await res.json()) as RiderShareData);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "লিংকটি পাওয়া যায়নি");
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const postPing = useCallback(async (pos: GeolocationPosition) => {
    if (postingRef.current) return;
    const now = Date.now();
    if (now - lastPostRef.current < 10_000) return; // throttle: at most one post / 10s
    postingRef.current = true;
    try {
      const res = await fetch(`${API_URL}/public/rider/${encodeURIComponent(token)}/ping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          recordedAt: new Date(pos.timestamp).toISOString(),
        }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.message ?? "লোকেশন পাঠানো যায়নি");
      lastPostRef.current = Date.now();
      setLastSentAt(new Date().toISOString());
      setGeoError("");
    } catch (e) {
      setGeoError(e instanceof Error ? e.message : "লোকেশন পাঠানো যায়নি");
    } finally {
      postingRef.current = false;
    }
  }, [token]);

  const sharingOn = Boolean(data?.sharingEnabled);
  const activeAssignment = Boolean(data?.hasActiveAssignment);

  useEffect(() => {
    if (!sharingOn || !activeAssignment) return;
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setGeoError("এই ফোনে/ব্রাউজারে লোকেশন (GPS) সুবিধা পাওয়া যাচ্ছে না");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => { void postPing(pos); },
      (err) => {
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? "লোকেশনের অনুমতি দেওয়া হয়নি — ফোনের সেটিংসে ব্রাউজারের জন্য লোকেশন চালু করুন"
            : "লোকেশন পাওয়া যাচ্ছে না — GPS চালু করে আবার চেষ্টা করুন",
        );
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
    watchIdRef.current = id;
    return () => {
      navigator.geolocation.clearWatch(id);
      watchIdRef.current = null;
    };
  }, [sharingOn, activeAssignment, postPing]);

  async function setSharing(enabled: boolean) {
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/public/rider/${encodeURIComponent(token)}/${enabled ? "start" : "stop"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.message ?? "অবস্থা বদলানো যায়নি");
      if (!enabled && watchIdRef.current != null && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      await load();
    } catch (e) {
      setGeoError(e instanceof Error ? e.message : "অবস্থা বদলানো যায়নি");
    } finally {
      setBusy(false);
    }
  }

  const fmt = (v?: string | null) => (v ? new Date(v).toLocaleString("bn-BD") : "—");

  return (
    <main className="mx-auto max-w-xl space-y-5 p-6">
      <header>
        <p className="text-xs uppercase tracking-wide text-slate-500">{data?.business ?? "রাইডার লোকেশন শেয়ার"}</p>
        <h1 className="mt-1 text-2xl font-bold">🛵 লোকেশন শেয়ারিং</h1>
        {data ? <p className="text-sm text-slate-500">রাইডার: <b className="text-slate-700">{data.rider.name}</b></p> : null}
      </header>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          এই লিংকটি দিয়ে লোকেশন শেয়ার করা যাচ্ছে না। ({error}) দোকান থেকে নতুন লিংক নিন।
        </div>
      ) : null}
      {!data && !error ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : null}

      {data ? (
        <>
          <section className={`rounded-2xl border p-5 shadow-sm ${sharingOn ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}>
            <p className="text-lg font-black">
              {sharingOn ? "🟢 শেয়ারিং চালু আছে" : "⚪ শেয়ারিং বন্ধ আছে"}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              {sharingOn
                ? "এই পেজটি খোলা থাকলে আপনার ফোনের লোকেশন দোকানে পাঠানো হচ্ছে — যাতে ডেলিভারির সময় গ্রাহক ও দোকান আপনার অবস্থান দেখতে পারে।"
                : "এখন কোনো লোকেশন পাঠানো হচ্ছে না।"}
            </p>
            <p className="mt-2 rounded-lg bg-white/70 px-3 py-2 text-xs leading-relaxed text-slate-500">
              সত্যি কথা: লোকেশন কেবল এই পেজটি খোলা থাকলেই পাঠানো হয়। পেজ বন্ধ করলে, ব্রাউজার বন্ধ করলে
              বা নিচের বোতামে শেয়ারিং বন্ধ করলে কোনো লোকেশন পাঠানো হয় না — কোনো ব্যাকগ্রাউন্ড ট্র্যাকিং নেই।
            </p>
            {sharingOn ? (
              <button
                type="button" disabled={busy} onClick={() => setSharing(false)}
                className="mt-4 w-full rounded-2xl bg-rose-600 py-3 text-sm font-extrabold text-white shadow disabled:opacity-50"
              >
                {busy ? "অপেক্ষা করুন…" : "⏹️ শেয়ারিং বন্ধ করুন"}
              </button>
            ) : (
              <button
                type="button" disabled={busy} onClick={() => setSharing(true)}
                className="mt-4 w-full rounded-2xl bg-emerald-600 py-3 text-sm font-extrabold text-white shadow disabled:opacity-50"
              >
                {busy ? "অপেক্ষা করুন…" : "▶️ শেয়ারিং চালু করুন"}
              </button>
            )}
          </section>

          <section className="rounded-2xl border bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-slate-500">বর্তমান ডেলিভারি</h2>
            {data.assignment ? (
              <ul className="space-y-1 text-sm text-slate-700">
                <li>অর্ডার: <b>{data.assignment.orderNumber ?? data.assignment.orderId}</b></li>
                <li>অবস্থা: <b>{data.assignment.status === "picked_up" ? "পার্সেল হাতে — ডেলিভারির পথে" : "অ্যাসাইন করা হয়েছে"}</b></li>
              </ul>
            ) : (
              <p className="text-sm text-slate-500">
                এখন কোনো সক্রিয় ডেলিভারি অ্যাসাইনমেন্ট নেই — তাই লোকেশন পাঠানো হচ্ছে না। অ্যাসাইনমেন্ট পেলে এই পেজেই দেখা যাবে।
              </p>
            )}
            {geoError ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{geoError}</p> : null}
            {lastSentAt ? <p className="mt-3 text-xs text-emerald-700">✅ সর্বশেষ লোকেশন পাঠানো হয়েছে: {fmt(lastSentAt)}</p> : null}
            {data.latestLocation ? (
              <p className="mt-2 text-xs text-slate-500">
                দোকানে সংরক্ষিত সর্বশেষ অবস্থান: {coordsLabel(data.latestLocation)} · {fixAgeLabel(data.latestLocation.ageMs)}
                {data.latestLocation.stale ? " (পুরনো)" : ""} ·{" "}
                <a href={data.latestLocation.mapsUrl} target="_blank" rel="noreferrer" className="font-semibold text-indigo-700 underline">মানচিত্রে দেখুন</a>
              </p>
            ) : null}
            <p className="mt-3 text-[11px] text-slate-400">এই লিংকের মেয়াদ: {fmt(data.shareExpiresAt)} পর্যন্ত। লিংকটি অন্য কারো সঙ্গে শেয়ার করবেন না।</p>
          </section>
        </>
      ) : null}
    </main>
  );
}
