"use client";
import React, { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";

// EC15 — shared public product-reviews presentation. Used by the
// shop product page (via ProductReviewsSection, which fetches the
// public endpoint itself) and by the EC13 landing page (which
// receives reviews inside the landing payload). Shapes mirror
// apps/api/src/orders/product-reviews.service.ts exactly:
//   item    { source, id, authorName, rating, text, imageUrls,
//             verified, replyText, createdAt }
//   summary { average: number | null, count }

export interface PublicReviewItem {
  source: string;
  id?: string;
  authorName?: string | null;
  rating: number;
  text?: string | null;
  imageUrls?: string[];
  verified?: boolean;
  replyText?: string | null;
  createdAt?: string | null;
}

export interface PublicReviewsSummary {
  average: number | null;
  count: number;
}

export function reviewStars(rating: number): string {
  const r = Math.max(0, Math.min(5, Math.round(rating || 0)));
  return "★★★★★".slice(0, r) + "☆☆☆☆☆".slice(0, 5 - r);
}

export function reviewSourceLabel(source: string): string {
  switch (source) {
    case "store": return "আমাদের দোকান";
    case "woocommerce": return "WooCommerce";
    case "shopify": return "Shopify";
    default: return source;
  }
}

export function ReviewsBlock({
  summary,
  items,
  heading = "ক্রেতাদের রিভিউ",
}: {
  summary: PublicReviewsSummary;
  items: PublicReviewItem[];
  heading?: string;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-black text-slate-900">{heading}</h2>
        {summary.count > 0 && summary.average != null ? (
          <span className="flex items-center gap-2 text-sm">
            <span className="text-amber-500" aria-label={`${summary.average} / ৫`}>
              {reviewStars(summary.average)}
            </span>
            <b className="text-slate-800">{summary.average}</b>
            <span className="text-slate-500">({summary.count}টি রিভিউ)</span>
          </span>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">কোনো রিভিউ নেই</p>
      ) : (
        <ul className="space-y-3">
          {items.map((r, idx) => (
            <li key={r.id ?? `${r.source}-${idx}`} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-amber-500">{reviewStars(r.rating)}</span>
                <span className="text-sm font-bold text-slate-800">{r.authorName || "ক্রেতা"}</span>
                {r.verified ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                    ✓ যাচাইকৃত ক্রেতা
                  </span>
                ) : null}
                {r.source !== "store" ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                    {reviewSourceLabel(r.source)}
                  </span>
                ) : null}
                {r.createdAt ? (
                  <span className="text-[11px] text-slate-400">
                    {new Date(r.createdAt).toLocaleDateString("bn-BD")}
                  </span>
                ) : null}
              </div>
              {r.text ? <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">{r.text}</p> : null}
              {(r.imageUrls ?? []).length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {(r.imageUrls ?? []).map((src) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={src} src={src} alt="রিভিউয়ের ছবি" className="h-20 w-20 rounded-lg border border-slate-200 object-cover" />
                  ))}
                </div>
              ) : null}
              {r.replyText ? (
                <div className="mt-3 rounded-xl bg-indigo-50 p-3">
                  <div className="text-[11px] font-bold text-indigo-700">বিক্রেতার উত্তর</div>
                  <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{r.replyText}</p>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Shop product page section: fetches the EC15 public endpoint. */
export function ProductReviewsSection({ orgSlug, productSlug, heading }: { orgSlug: string; productSlug: string; heading?: string }) {
  const [summary, setSummary] = useState<PublicReviewsSummary | null>(null);
  const [items, setItems] = useState<PublicReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setFailed(false);
      try {
        const res = await fetch(
          `${API_URL}/public/shop/${encodeURIComponent(orgSlug)}/products/${encodeURIComponent(productSlug)}/reviews`,
        );
        if (!res.ok) throw new Error("রিভিউ লোড ব্যর্থ");
        const json = await res.json();
        if (!alive) return;
        setSummary(json.summary ?? { average: null, count: 0 });
        setItems(Array.isArray(json.items) ? json.items : []);
      } catch {
        if (alive) setFailed(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [orgSlug, productSlug]);

  if (loading) return <p className="text-sm text-slate-400">রিভিউ লোড হচ্ছে…</p>;
  if (failed || !summary) {
    return (
      <section className="space-y-4">
        <h2 className="text-xl font-black text-slate-900">{heading ?? "ক্রেতাদের রিভিউ"}</h2>
        <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">রিভিউ এখন লোড করা যাচ্ছে না।</p>
      </section>
    );
  }
  return <ReviewsBlock summary={summary} items={items} heading={heading} />;
}
