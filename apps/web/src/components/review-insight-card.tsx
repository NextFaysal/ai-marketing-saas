"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  insightNeedsRegeneration, sentimentPercents, themeLabels,
  type ReviewInsightPayload,
} from "@/lib/ab7";
import { useLocale } from "@/lib/i18n/provider";
import { fmtDateTime, fmtNumber } from "@repo/contracts";

// AB7 (AX15) — per-product AI review summary, on the staff
// reviews page. Consumes:
//   GET  organizations/:orgId/products/:productId/review-insight
//        -> { insight | null, currentReviewCount, reviewsSinceGeneration }
//   POST organizations/:orgId/products/:productId/review-insight/generate
//        -> the insight payload (or a server error shown VERBATIM —
//           e.g. "LLM কনফিগার করা নেই — AI সারসংক্ষেপ উপলব্ধ নয়").
// The card is labelled AI-generated; nothing here invents a
// summary — with no insight it only explains and offers the
// generate button.

interface ProductOpt { id: string; name: string }

export function ReviewInsightCard() {
  const { dict, t, locale } = useLocale();
  const S = dict.shared;
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [productId, setProductId] = useState("");
  const [payload, setPayload] = useState<ReviewInsightPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const orgId = getOrganizationId(); if (!orgId) return;
    (async () => {
      try {
        const out = await apiFetch<{ items: ProductOpt[] }>(`/organizations/${orgId}/products?pageSize=100`);
        setProducts(out.items ?? []);
      } catch { /* selector stays empty until the endpoint answers */ }
    })();
  }, []);

  const load = useCallback(async (pid: string) => {
    const orgId = getOrganizationId(); if (!orgId || !pid) return;
    setLoading(true); setError("");
    try {
      const out = await apiFetch<ReviewInsightPayload>(
        `/organizations/${orgId}/products/${encodeURIComponent(pid)}/review-insight`,
      );
      setPayload(out);
    } catch (e) { setError(e instanceof Error ? e.message : S.zzRicLoadFailed); setPayload(null); }
    finally { setLoading(false); }
  }, [S]);

  useEffect(() => { if (productId) void load(productId); }, [productId, load]);

  async function generate() {
    const orgId = getOrganizationId(); if (!orgId || !productId) return;
    setGenerating(true); setError("");
    try {
      const out = await apiFetch<ReviewInsightPayload>(
        `/organizations/${orgId}/products/${encodeURIComponent(productId)}/review-insight/generate`,
        { method: "POST", body: JSON.stringify({}) },
      );
      setPayload(out);
    } catch (e) {
      // Server message verbatim — the LLM-not-configured message
      // must reach the staff member exactly as the API sent it.
      setError(e instanceof Error ? e.message : S.zzRicGenerateFailed);
    } finally { setGenerating(false); }
  }

  const insight = payload?.insight ?? null;
  const stale = insightNeedsRegeneration(payload?.reviewsSinceGeneration);
  const shares = sentimentPercents(insight?.sentimentJson);
  const themes = themeLabels(insight?.themesJson);
  const noReviews = (payload?.currentReviewCount ?? 0) === 0;

  return (
    <div className="card space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{S.zzRicTitle} <span className="ml-1 rounded bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-700">{S.zzRicAiBadge}</span></div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {S.zzRicIntro}
          </p>
        </div>
        <label className="block text-sm">{S.zzRicProductLabel}
          <select className="input mt-1" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">{S.zzRicSelectProduct}</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>

      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      {!productId ? (
        <p className="text-sm text-slate-500">{S.zzRicPickProduct}</p>
      ) : loading ? (
        <p className="text-sm text-slate-400">{S.zzRicLoading}</p>
      ) : !payload ? (
        <p className="text-sm text-slate-500">{S.zzRicPayloadFailed}</p>
      ) : !insight ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {S.zzRicNoInsightPrefix}
            <b>{fmtNumber(locale, payload.currentReviewCount)}</b>{S.zzRicReviewCountSuffix}
            {noReviews ? S.zzRicNoReviewsNote : ""}
          </p>
          <button
            type="button"
            className="btn-primary disabled:opacity-50"
            disabled={generating || noReviews}
            onClick={() => void generate()}
          >
            {generating ? S.zzRicGenerating : S.zzRicGenerate}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {stale ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 p-3">
              <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                {S.zzRicStaleBadge}
              </span>
              <span className="text-xs text-amber-800">
                {t("shared.zzRicStaleText", { count: fmtNumber(locale, payload.reviewsSinceGeneration ?? 0) })}
              </span>
              <button
                type="button"
                className="rounded-lg border bg-white px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                disabled={generating}
                onClick={() => void generate()}
              >
                {generating ? S.zzRicGenerating : S.zzRicRegenerate}
              </button>
            </div>
          ) : null}

          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{insight.summaryText}</p>

          <div>
            <div className="flex flex-wrap gap-3 text-xs font-semibold">
              <span className="text-emerald-700">{t("shared.zzRicSentimentPositive", { count: fmtNumber(locale, insight.sentimentJson.positive), pct: fmtNumber(locale, shares.positive) })}</span>
              <span className="text-slate-600">{t("shared.zzRicSentimentNeutral", { count: fmtNumber(locale, insight.sentimentJson.neutral), pct: fmtNumber(locale, shares.neutral) })}</span>
              <span className="text-rose-700">{t("shared.zzRicSentimentNegative", { count: fmtNumber(locale, insight.sentimentJson.negative), pct: fmtNumber(locale, shares.negative) })}</span>
            </div>
            <div className="mt-1.5 flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
              <div className="h-full bg-emerald-500" style={{ width: `${shares.positive}%` }} />
              <div className="h-full bg-slate-400" style={{ width: `${shares.neutral}%` }} />
              <div className="h-full bg-rose-500" style={{ width: `${shares.negative}%` }} />
            </div>
          </div>

          {themes.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-500">{S.zzRicThemesLabel}</span>
              {themes.map((t) => (
                <span key={t} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">{t}</span>
              ))}
            </div>
          ) : null}

          <p className="text-[11px] text-slate-400">
            {t("shared.zzRicFooterMain", { date: fmtDateTime(locale, insight.generatedAt), count: fmtNumber(locale, insight.reviewCountAtGeneration) })}
            {insight.modelLabel ? <>{t("shared.zzRicFooterModel", { model: insight.modelLabel })}</> : null}
            {S.zzRicFooterSuffix}
          </p>

          {!stale ? (
            <button
              type="button"
              className="rounded-lg border bg-white px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
              disabled={generating}
              onClick={() => void generate()}
            >
              {generating ? S.zzRicGenerating : S.zzRicRegenerate}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
