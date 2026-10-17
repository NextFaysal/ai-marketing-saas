"use client";
import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_URL } from "@/lib/api";
import { mediaSrc } from "@/lib/media-src";
import { COURIER_STEP_LABELS, courierStatusView } from "@/lib/courier-status";

interface Tracking {
  provider: string;
  trackingCode: string | null;
  status: string;
  invoice: string | null;
  orderNumber: string | null;
  bookedAt: string;
  statusAt: string;
  lastCheckedAt: string | null;
  business: string;
  branding?: { name: string; logoUrl: string | null; primaryColor: string | null };
  // NF9 (FB4): the own-rider's latest fix — present ONLY while
  // the parcel is out for delivery AND the rider is sharing
  // (server-decided); null/absent renders nothing at all.
  riderLocation?: {
    riderName: string | null;
    lat: number;
    lng: number;
    accuracy: number | null;
    recordedAt: string;
    ageMs: number | null;
    stale: boolean;
    mapsUrl: string;
  } | null;
}

/**
 * CX6 — public live-tracking page. The token in the URL is the
 * only credential (ReportShare pattern). Everything shown comes
 * from the shipment row as stored: the courier's own status words
 * drive the stepper through the SAME lib/courier-status mapping
 * the inbox widget uses (not forked); an unmapped status renders
 * the courier's words verbatim with no guessed step. The timeline
 * has exactly two honest entries — booked, and the current stored
 * status with the time it was last written/checked. No scan events
 * are invented.
 */
export default function PublicTrackingPage() {
  const params = useParams();
  const token = String(params.token ?? "");
  const [data, setData] = useState<Tracking | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/public/tracking/${token}`);
        if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.message ?? "Tracking unavailable"); }
        setData(await res.json());
      } catch (e) { setError(e instanceof Error ? e.message : "Tracking unavailable"); }
    })();
  }, [token]);
  const view = data ? courierStatusView(data.status) : null;
  const accent = data?.branding?.primaryColor ?? undefined;
  const fmt = (v?: string | null) => (v ? new Date(v).toLocaleString("bn-BD") : "—");
  return (
    <main className="mx-auto max-w-2xl space-y-5 p-6">
      <header>
        {data?.branding?.logoUrl ? (
          <img src={mediaSrc(API_URL, data.branding.logoUrl) ?? ""} alt="" className="h-14 w-14 rounded-2xl border bg-white object-contain p-1" />
        ) : null}
        <p className="mt-2 text-xs uppercase tracking-wide" style={accent ? { color: accent } : undefined}>
          {data?.branding?.name ?? data?.business ?? "লাইভ ট্র্যাকিং"}
        </p>
        <h1 className="mt-1 text-2xl font-bold">🚚 পার্সেল ট্র্যাকিং</h1>
        {data ? (
          <p className="text-sm text-slate-500">
            {data.provider} কুরিয়ার{data.trackingCode ? ` · Tracking: ${data.trackingCode}` : ""}{data.orderNumber ? ` · অর্ডার: ${data.orderNumber}` : ""}
          </p>
        ) : null}
      </header>
      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">এই ট্র্যাকিং লিংকটি পাওয়া যায়নি। ({error})</div> : null}
      {!data && !error ? <p className="text-sm text-slate-500">লোড হচ্ছে...</p> : null}
      {data && view ? (
        <>
          <section className="rounded-2xl border bg-white p-4 shadow-sm">
            {view.kind === "progress" ? (
              <>
                <div className="flex items-center gap-1">
                  {COURIER_STEP_LABELS.map((label, i) => (
                    <div key={label} className="flex flex-1 flex-col items-center gap-1">
                      <div className={`h-2 w-full rounded-full ${i <= view.step ? "bg-gradient-to-r from-emerald-500 to-teal-400" : "bg-slate-200"}`} />
                      <span className={`text-center text-[11px] leading-tight ${i === view.step ? "font-bold text-emerald-700" : "text-slate-400"}`}>{label}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-700">বর্তমান অবস্থা: {COURIER_STEP_LABELS[view.step]}{view.partial ? " (আংশিক ডেলিভার্ড)" : ""}</p>
              </>
            ) : view.kind === "returned" ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">↩️ পার্সেলটি রিটার্ন এসেছে (কুরিয়ারের স্ট্যাটাস: {data.status})</p>
            ) : view.kind === "cancelled" ? (
              <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600">✖️ শিপমেন্ট বাতিল হয়েছে (কুরিয়ারের স্ট্যাটাস: {data.status})</p>
            ) : (
              <p className="text-sm text-slate-600">কুরিয়ারের স্ট্যাটাস: <b>{data.status}</b></p>
            )}
          </section>
          {data.riderLocation ? (
            <section className="rounded-2xl border bg-white p-4 shadow-sm">
              <h2 className="mb-2 text-sm font-semibold text-slate-500">🛵 রাইডারের অবস্থান</h2>
              <p className="text-sm text-slate-700">
                {data.riderLocation.riderName ? <>রাইডার <b>{data.riderLocation.riderName}</b> · </> : null}
                <span className="font-mono font-semibold">{data.riderLocation.lat}, {data.riderLocation.lng}</span>
                {data.riderLocation.stale ? (
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">পুরনো অবস্থান</span>
                ) : null}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                অবস্থানের সময়: {fmt(data.riderLocation.recordedAt)} ·{" "}
                <a href={data.riderLocation.mapsUrl} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 underline">মানচিত্রে দেখুন</a>
              </p>
            </section>
          ) : null}
          <section className="rounded-2xl border bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-slate-500">টাইমলাইন</h2>
            <ul className="space-y-2 text-sm">
              <li className="flex items-baseline justify-between gap-3 border-b pb-2">
                <span>📦 বুক হয়েছে</span><span className="text-slate-500">{fmt(data.bookedAt)}</span>
              </li>
              <li className="flex items-baseline justify-between gap-3">
                <span>সর্বশেষ অবস্থা: <b>{data.status}</b></span><span className="text-slate-500">{fmt(data.statusAt)}</span>
              </li>
            </ul>
            <p className="mt-3 text-xs text-slate-400">সর্বশেষ যাচাই: {data.lastCheckedAt ? fmt(data.lastCheckedAt) : "এখনো যাচাই হয়নি"} · এই পেজে শুধু দোকানের সিস্টেমে সংরক্ষিত তথ্যই দেখানো হয়।</p>
          </section>
        </>
      ) : null}
    </main>
  );
}
