"use client";
import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_URL } from "@/lib/api";

interface UnsubscribeInfo { valid: boolean; channel: string; address: string }

/**
 * MS2 — public unsubscribe page. The signed token from the
 * broadcast email footer is the only credential. GET validates
 * and shows only the channel + masked address; the opt-out is
 * written only when the visitor confirms with the button (POST).
 */
export default function PublicUnsubscribePage() {
  const params = useParams();
  const token = String(params.token ?? "");
  const [info, setInfo] = useState<UnsubscribeInfo | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/public/messaging/unsubscribe/${token}`);
        if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.message ?? "লিংকটি ব্যবহার করা যাচ্ছে না"); }
        setInfo(await res.json());
      } catch (e) { setError(e instanceof Error ? e.message : "লিংকটি ব্যবহার করা যাচ্ছে না"); }
    })();
  }, [token]);

  async function confirm() {
    setBusy(true); setError("");
    try {
      const res = await fetch(`${API_URL}/public/messaging/unsubscribe/${token}`, { method: "POST" });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.message ?? "আনসাবস্ক্রাইব করা যায়নি");
      setDone(j?.message ?? "আপনাকে আনসাবস্ক্রাইব করা হয়েছে।");
    } catch (e) { setError(e instanceof Error ? e.message : "আনসাবস্ক্রাইব করা যায়নি"); }
    finally { setBusy(false); }
  }

  return (
    <main className="mx-auto max-w-xl space-y-5 p-6">
      <header>
        <p className="text-xs uppercase tracking-wide text-slate-400">Messaging</p>
        <h1 className="mt-1 text-2xl font-bold">📭 আনসাবস্ক্রাইব</h1>
      </header>
      {!info && !error ? <p className="text-sm text-slate-500">লোড হচ্ছে...</p> : null}
      {error && !done ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}
      {info && !done ? (
        <section className="space-y-4 rounded-2xl border bg-white p-4 shadow-sm">
          <p className="text-sm text-slate-700">
            <span className="font-medium">{info.address}</span> ঠিকানায় ({info.channel}) আর কোনো Broadcast বার্তা পাঠানো হবে না।
          </p>
          <p className="text-xs text-slate-400">অর্ডার বা অ্যাকাউন্ট সংক্রান্ত জরুরি বার্তা এর আওতায় পড়ে না।</p>
          <button className="btn-primary" disabled={busy} onClick={confirm}>{busy ? "কাজ চলছে..." : "আনসাবস্ক্রাইব নিশ্চিত করুন"}</button>
        </section>
      ) : null}
      {done ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <p className="text-sm font-semibold text-emerald-800">✅ {done}</p>
        </section>
      ) : null}
    </main>
  );
}
