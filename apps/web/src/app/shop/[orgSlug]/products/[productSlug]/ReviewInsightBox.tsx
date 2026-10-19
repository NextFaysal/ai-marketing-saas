"use client";
import React, { useEffect, useState } from "react";
import { fmtDate, fmtNumber } from "@repo/contracts";
import { shopT } from "@/lib/shop-i18n";
const t = shopT("bn");
function bn(n: number): string { return fmtNumber("bn", n); }
import { API_URL } from "@/lib/api";

/**
 * AB7 (AX15) — AI review-insight box on the product page.
 *
 * Fetches GET /public/shop/:orgSlug/products/:productSlug/
 * review-insight and, ONLY when the endpoint returns an actual
 * insight, renders a clearly-labelled AI summary near the
 * reviews section: the fixed Bengali heading names it as
 * AI-generated (never weakened), the generation date, the
 * summary text, a proportional sentiment bar with labelled
 * counts, and theme chips. `{ insight: null }` (or any failure)
 * renders NOTHING.
 */

import {
  reviewInsightFromPayload,
  sentimentPercents,
  type ReviewInsight,
} from "@/lib/shop-review-insight";



export function ReviewInsightBox({ orgSlug, productSlug }: { orgSlug: string; productSlug: string }) {
  const [insight, setInsight] = useState<ReviewInsight | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(
          `${API_URL}/public/shop/${encodeURIComponent(orgSlug)}/products/${encodeURIComponent(productSlug)}/review-insight`,
        );
        if (!res.ok) return;
        const parsed = reviewInsightFromPayload(await res.json().catch(() => null));
        if (alive) setInsight(parsed);
      } catch {
        /* no insight box on any failure */
      }
    })();
    return () => {
      alive = false;
    };
  }, [orgSlug, productSlug]);

  if (!insight) return null;
  const { sentiment } = insight;
  const total = sentiment.total || sentiment.positive + sentiment.neutral + sentiment.negative;
  const percents = sentimentPercents(sentiment);
  const generatedLabel = insight.generatedAt
    ? fmtDate("bn", insight.generatedAt)
    : null;

  return (
    <section className="space-y-3 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-base font-black text-slate-900">{t.shopWidgets.reviewSummaryTitle}</h2>
        {generatedLabel ? <span className="text-xs text-slate-500">{t.shopWidgets.reviewGeneratedPrefix}{generatedLabel}</span> : null}
        {insight.reviewCount > 0 ? (
          <span className="text-xs text-slate-500">{bn(insight.reviewCount)}{t.shopWidgets.reviewAnalyzedSuffix}</span>
        ) : null}
      </div>
      <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{insight.summaryText}</p>
      {total > 0 ? (
        <div className="space-y-1.5">
          <div
            className="flex h-3 w-full overflow-hidden rounded-full bg-slate-200"
            role="img"
            aria-label={`${t.shopWidgets.sentimentAriaPrefix}${bn(sentiment.positive)}${t.shopWidgets.sentimentAriaMid1}${bn(sentiment.neutral)}${t.shopWidgets.sentimentAriaMid2}${bn(sentiment.negative)}`}
          >
            <div className="h-full bg-emerald-500" style={{ width: `${percents.positive}%` }} />
            <div className="h-full bg-slate-400" style={{ width: `${percents.neutral}%` }} />
            <div className="h-full bg-rose-500" style={{ width: `${percents.negative}%` }} />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-slate-600">
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />{t.shopWidgets.sentimentPositive}{bn(sentiment.positive)}</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-slate-400" />{t.shopWidgets.sentimentNeutral}{bn(sentiment.neutral)}</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-rose-500" />{t.shopWidgets.sentimentNegative}{bn(sentiment.negative)}</span>
          </div>
        </div>
      ) : null}
      {insight.themes.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {insight.themes.map((theme) => (
            <span key={theme} className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200">
              {theme}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
