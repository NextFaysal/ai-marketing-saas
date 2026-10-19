"use client";
import React, { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import { sharedBn, sharedEn } from "@/lib/i18n/shared";
import { interpolate } from "@/lib/i18n/lookup";
import { useLocale } from "@/lib/i18n/provider";
import { fmtDate, fmtNumber, type UiLocale } from "@repo/contracts";

/**
 * MB2 F3-β: UI copy lives in the `shared` dictionary (zzPrv* keys).
 * This module renders on PUBLIC shop/landing pages, which have no
 * dashboard LocaleProvider — so the components resolve the locale
 * through the provider when one is mounted and fall back to bn
 * (the previous hardcoded behaviour) when it is not. The pure
 * `reviewSourceLabel` takes a trailing locale param defaulting to
 * "bn", so existing dashboard callers stay byte-identical.
 */
const SD = (locale?: string): typeof sharedBn => (locale === "en" ? sharedEn : sharedBn);
function usePrvLocale(): UiLocale {
  try {
    return useLocale().locale === "en" ? "en" : "bn";
  } catch {
    return "bn";
  }
}

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

export function reviewSourceLabel(source: string, locale?: string): string {
  switch (source) {
    case "store": return SD(locale).zzPrvSourceStore;
    case "woocommerce": return "WooCommerce";
    case "shopify": return "Shopify";
    default: return source;
  }
}

export function ReviewsBlock({
  summary,
  items,
  heading,
}: {
  summary: PublicReviewsSummary;
  items: PublicReviewItem[];
  heading?: string;
}) {
  const locale = usePrvLocale();
  const sd = SD(locale);
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-black text-slate-900">{heading ?? sd.zzPrvHeading}</h2>
        {summary.count > 0 && summary.average != null ? (
          <span className="flex items-center gap-2 text-sm">
            <span className="text-amber-500" aria-label={interpolate(sd.zzPrvRatingAria, { average: fmtNumber(locale, summary.average), total: fmtNumber(locale, 5) })}>
              {reviewStars(summary.average)}
            </span>
            <b className="text-slate-800">{fmtNumber(locale, summary.average)}</b>
            <span className="text-slate-500">{interpolate(sd.zzPrvCountReviews, { count: fmtNumber(locale, summary.count) })}</span>
          </span>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">{sd.zzPrvNoReviews}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((r, idx) => (
            <li key={r.id ?? `${r.source}-${idx}`} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-amber-500">{reviewStars(r.rating)}</span>
                <span className="text-sm font-bold text-slate-800">{r.authorName || sd.zzPrvBuyerFallback}</span>
                {r.verified ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                    {sd.zzPrvVerifiedBuyer}
                  </span>
                ) : null}
                {r.source !== "store" ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                    {reviewSourceLabel(r.source)}
                  </span>
                ) : null}
                {r.createdAt ? (
                  <span className="text-[11px] text-slate-400">
                    {fmtDate(locale, r.createdAt)}
                  </span>
                ) : null}
              </div>
              {r.text ? <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">{r.text}</p> : null}
              {(r.imageUrls ?? []).length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {(r.imageUrls ?? []).map((src) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={src} src={src} alt={sd.zzPrvImageAlt} className="h-20 w-20 rounded-lg border border-slate-200 object-cover" />
                  ))}
                </div>
              ) : null}
              {r.replyText ? (
                <div className="mt-3 rounded-xl bg-indigo-50 p-3">
                  <div className="text-[11px] font-bold text-indigo-700">{sd.zzPrvSellerReply}</div>
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
  const locale = usePrvLocale();
  const sd = SD(locale);
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
        if (!res.ok) throw new Error(sd.zzPrvLoadFailed);
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

  if (loading) return <p className="text-sm text-slate-400">{sd.zzPrvLoading}</p>;
  if (failed || !summary) {
    return (
      <section className="space-y-4">
        <h2 className="text-xl font-black text-slate-900">{heading ?? sd.zzPrvHeading}</h2>
        <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">{sd.zzPrvLoadUnavailable}</p>
      </section>
    );
  }
  return <ReviewsBlock summary={summary} items={items} heading={heading} />;
}
