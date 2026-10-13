"use client";
import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_URL } from "@/lib/api";

interface ReviewPageData {
  status: string;
  rating: number | null;
  comment: string | null;
  receivedAt: string | null;
  orderNumber: string | null;
  business: string;
  branding?: { name: string; logoUrl: string | null; primaryColor: string | null };
}

/**
 * CX12b — public review page. The reviewToken is the only
 * credential (CX6/ReportShare pattern). One rating per link: once
 * a review exists, the page renders it read-only and the API
 * refuses a second submit — the first honest answer stands.
 */
export default function PublicReviewPage() {
  const params = useParams();
  const token = String(params.token ?? "");
  const [data, setData] = useState<ReviewPageData | null>(null);
  const [error, setError] = useState("");
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/public/review/${token}`);
        if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.message ?? "Review unavailable"); }
        setData(await res.json());
      } catch (e) { setError(e instanceof Error ? e.message : "Review unavailable"); }
    })();
  }, [token]);
  async function submit() {
    if (!rating) { setError("অনুগ্রহ করে ১–৫ তারার মধ্যে একটি রেটিং বেছে নিন"); return; }
    setBusy(true); setError("");
    try {
      const res = await fetch(`${API_URL}/public/review/${token}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, comment: comment.trim() || undefined }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.message ?? "পাঠানো যায়নি");
      setDone(true);
    } catch (e) { setError(e instanceof Error ? e.message : "পাঠানো যায়নি"); }
    finally { setBusy(false); }
  }
  const accent = data?.branding?.primaryColor ?? undefined;
  const already = data?.rating != null;
  return (
    <main className="mx-auto max-w-xl space-y-5 p-6">
      <header>
        {data?.branding?.logoUrl ? (
          <img src={`${API_URL}${data.branding.logoUrl}`} alt="" className="h-14 w-14 rounded-2xl border bg-white object-contain p-1" />
        ) : null}
        <p className="mt-2 text-xs uppercase tracking-wide" style={accent ? { color: accent } : undefined}>
          {data?.branding?.name ?? data?.business ?? "রিভিউ"}
        </p>
        <h1 className="mt-1 text-2xl font-bold">⭐ আপনার অভিজ্ঞতা জানান</h1>
        {data?.orderNumber ? <p className="text-sm text-slate-500">অর্ডার: {data.orderNumber}</p> : null}
      </header>
      {!data && !error ? <p className="text-sm text-slate-500">লোড হচ্ছে...</p> : null}
      {error && !done ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}
      {data && already && !done ? (
        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          <p className="text-lg text-amber-500">{"★★★★★".slice(0, data.rating ?? 0)}{"☆☆☆☆☆".slice(0, 5 - (data.rating ?? 0))}</p>
          <p className="mt-1 text-sm font-semibold">আপনার রিভিউ ইতিমধ্যে পাওয়া গেছে — ধন্যবাদ!</p>
          {data.comment ? <p className="mt-1 text-sm text-slate-700">“{data.comment}”</p> : null}
          {data.receivedAt ? <p className="mt-1 text-xs text-slate-400">{new Date(data.receivedAt).toLocaleString("bn-BD")}</p> : null}
        </section>
      ) : null}
      {data && !already && !done ? (
        <section className="space-y-4 rounded-2xl border bg-white p-4 shadow-sm">
          <div>
            <div className="mb-1 text-sm font-medium">কেনাকাটার অভিজ্ঞতা কেমন ছিল?</div>
            <div className="flex gap-1" role="radiogroup" aria-label="রেটিং">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} তারা`}
                  className={`text-4xl leading-none transition ${(hover || rating) >= n ? "text-amber-400" : "text-slate-300"}`}
                  onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)} onClick={() => setRating(n)}>★</button>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-400">৫ = সবচেয়ে ভালো, ১ = খুব খারাপ</p>
          </div>
          <label className="block text-sm font-medium">মতামত (ঐচ্ছিক)
            <textarea className="input mt-1" rows={4} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="আপনার অভিজ্ঞতা লিখুন..." />
          </label>
          <button className="btn-primary" disabled={busy} onClick={submit}>{busy ? "পাঠানো হচ্ছে..." : "রিভিউ পাঠান"}</button>
        </section>
      ) : null}
      {done ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <p className="text-sm font-semibold text-emerald-800">✅ ধন্যবাদ! আপনার রিভিউ পাওয়া গেছে।</p>
          <p className="mt-1 text-sm text-emerald-700">আপনার মতামত আমাদের সেবা আরও ভালো করতে সাহায্য করবে।</p>
        </section>
      ) : null}
    </main>
  );
}
