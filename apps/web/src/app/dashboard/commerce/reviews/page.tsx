"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { reviewSourceLabel, reviewStars } from "@/components/product-reviews";
import { ReviewInsightCard } from "@/components/review-insight-card";

// EC15 — staff review moderation. Consumes
// apps/api/src/orders/product-reviews.controller.ts:
//   GET   organizations/:orgId/product-reviews
//         ?source=&rating=&hidden=true|false   -> unified ARRAY
//         (own "store" OrderReviews + pulled ExternalReviews)
//   PATCH organizations/:orgId/product-reviews/:source/:id
//         { isVisible } / { replyText } — reply is own-store only;
//         the server refuses external replies and that message is
//         shown verbatim.

interface StaffReview {
  source: string;
  id: string;
  authorName?: string | null;
  rating: number;
  text?: string | null;
  imageUrls?: string[];
  verified?: boolean;
  replyText?: string | null;
  isVisible: boolean;
  createdAt?: string | null;
  productId?: string | null;
  productName?: string | null;
  hidden: boolean;
}

export default function ReviewsModerationPage() {
  const [reviews, setReviews] = useState<StaffReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});

  // filters -> server query params (source / rating / hidden)
  const [fSource, setFSource] = useState("");
  const [fRating, setFRating] = useState("");
  const [fHidden, setFHidden] = useState(""); // "" = all, "false" = visible, "true" = hidden

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) { setLoading(false); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (fSource) params.set("source", fSource);
      if (fRating) params.set("rating", fRating);
      if (fHidden) params.set("hidden", fHidden);
      const qs = params.toString();
      const rows = await apiFetch<StaffReview[]>(`/organizations/${orgId}/product-reviews${qs ? `?${qs}` : ""}`);
      setReviews(Array.isArray(rows) ? rows : []);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "লোড ব্যর্থ"); }
    finally { setLoading(false); }
  }, [fSource, fRating, fHidden]);
  useEffect(() => { load(); }, [load]);

  async function toggleVisible(r: StaffReview) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`vis-${r.source}-${r.id}`); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/product-reviews/${encodeURIComponent(r.source)}/${encodeURIComponent(r.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ isVisible: r.hidden }),
      });
      setNotice(r.hidden ? "রিভিউটি এখন পাবলিক পেজে দেখা যাবে।" : "রিভিউটি লুকানো হয়েছে — পাবলিক পেজে আর দেখা যাবে না।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function saveReply(r: StaffReview) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const key = `${r.source}-${r.id}`;
    setBusy(`reply-${key}`); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/product-reviews/${encodeURIComponent(r.source)}/${encodeURIComponent(r.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ replyText: replyDrafts[key] ?? "" }),
      });
      setNotice("উত্তর সংরক্ষণ হয়েছে।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "উত্তর সংরক্ষণ ব্যর্থ"); }
    finally { setBusy(""); }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">রিভিউ মডারেশন</h1>
          <p className="text-sm text-slate-500">
            নিজের দোকানের ডেলিভারি-পরবর্তী রিভিউ আর WooCommerce/Shopify থেকে টানা রিভিউ — একই তালিকায়।
            লুকালে পাবলিক পণ্য/ল্যান্ডিং পেজে আর দেখা যাবে না। উত্তর শুধু নিজের দোকানের রিভিউতেই দেওয়া যায়।
          </p>
        </div>
        <Link href="/dashboard/commerce" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">← Commerce Hub</Link>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      {/* AB7 (AX15): per-product AI review summary */}
      <ReviewInsightCard />

      <div className="card flex flex-wrap items-end gap-3 p-5">
        <label className="block text-sm">উৎস
          <select className="input mt-1" value={fSource} onChange={(e) => setFSource(e.target.value)}>
            <option value="">সব উৎস</option>
            <option value="store">নিজের দোকান (store)</option>
            <option value="woocommerce">WooCommerce</option>
            <option value="shopify">Shopify</option>
          </select>
        </label>
        <label className="block text-sm">রেটিং
          <select className="input mt-1" value={fRating} onChange={(e) => setFRating(e.target.value)}>
            <option value="">সব রেটিং</option>
            {[5, 4, 3, 2, 1].map((n) => <option key={n} value={String(n)}>{n} স্টার</option>)}
          </select>
        </label>
        <label className="block text-sm">দৃশ্যমানতা
          <select className="input mt-1" value={fHidden} onChange={(e) => setFHidden(e.target.value)}>
            <option value="">সব</option>
            <option value="false">শুধু দেখা যাচ্ছে এমন</option>
            <option value="true">শুধু লুকানো</option>
          </select>
        </label>
        <span className="pb-2 text-sm text-slate-500">{loading ? "লোড হচ্ছে…" : `মোট ${reviews.length}টি রিভিউ`}</span>
      </div>

      <div className="card space-y-3 p-5">
        {loading ? <p className="text-sm text-slate-400">লোড হচ্ছে…</p> : reviews.length === 0 ? (
          <p className="text-sm text-slate-500">এই ফিল্টারে কোনো রিভিউ নেই।</p>
        ) : (
          <ul className="divide-y">
            {reviews.map((r) => {
              const key = `${r.source}-${r.id}`;
              const own = r.source === "store";
              return (
                <li key={key} className={`py-4 ${r.hidden ? "opacity-60" : ""}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-amber-500">{reviewStars(r.rating)}</span>
                        <span className="text-sm font-bold text-slate-800">{r.authorName || "ক্রেতা"}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${own ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-600"}`}>
                          {reviewSourceLabel(r.source)}
                        </span>
                        {r.verified ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">✓ যাচাইকৃত ক্রেতা</span>
                        ) : null}
                        {r.hidden ? (
                          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">লুকানো</span>
                        ) : null}
                        {r.createdAt ? (
                          <span className="text-[11px] text-slate-400">{new Date(r.createdAt).toLocaleDateString("bn-BD")}</span>
                        ) : null}
                      </div>
                      <div className="text-xs text-slate-500">পণ্য: <span className="font-semibold text-slate-700">{r.productName ?? "—"}</span></div>
                      {r.text ? <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{r.text}</p> : (
                        <p className="text-sm italic text-slate-400">(লেখা ছাড়া শুধু রেটিং)</p>
                      )}
                      {(r.imageUrls ?? []).length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {(r.imageUrls ?? []).map((src) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={src} src={src} alt="রিভিউয়ের ছবি" className="h-16 w-16 rounded-lg border border-slate-200 object-cover" />
                          ))}
                        </div>
                      ) : null}
                      {r.replyText ? (
                        <div className="rounded-xl bg-indigo-50 p-3">
                          <div className="text-[11px] font-bold text-indigo-700">বিক্রেতার উত্তর</div>
                          <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{r.replyText}</p>
                        </div>
                      ) : null}
                    </div>
                    <button
                      className="rounded-lg border bg-white px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                      disabled={busy !== ""}
                      onClick={() => toggleVisible(r)}
                    >
                      {busy === `vis-${key}` ? "হচ্ছে…" : r.hidden ? "দেখান" : "লুকান"}
                    </button>
                  </div>

                  <div className="mt-3">
                    {own ? (
                      <div className="flex flex-wrap items-start gap-2">
                        <textarea
                          className="input min-w-64 flex-1"
                          rows={2}
                          placeholder="ক্রেতাকে ধন্যবাদ জানিয়ে উত্তর লিখুন…"
                          value={replyDrafts[key] ?? r.replyText ?? ""}
                          onChange={(e) => setReplyDrafts((d) => ({ ...d, [key]: e.target.value }))}
                        />
                        <button
                          className="btn-primary disabled:opacity-50"
                          disabled={busy !== ""}
                          onClick={() => saveReply(r)}
                        >
                          {busy === `reply-${key}` ? "সংরক্ষণ হচ্ছে…" : r.replyText ? "উত্তর আপডেট করুন" : "উত্তর পাঠান"}
                        </button>
                      </div>
                    ) : (
                      <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                        বাইরের রিভিউতে উত্তর দেওয়া যায় না — উত্তর শুধু নিজের দোকানের (store) রিভিউতে দেওয়া যায়।
                        এই রিভিউটি {reviewSourceLabel(r.source)} থেকে এসেছে; চাইলে লুকিয়ে রাখতে পারেন।
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
