"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  insightNeedsRegeneration, sentimentPercents, themeLabels,
  type ReviewInsightPayload,
} from "@/lib/ab7";

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
    } catch (e) { setError(e instanceof Error ? e.message : "AI সারসংক্ষেপ লোড ব্যর্থ"); setPayload(null); }
    finally { setLoading(false); }
  }, []);

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
      setError(e instanceof Error ? e.message : "সারসংক্ষেপ তৈরি ব্যর্থ");
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
          <div className="font-semibold">🤖 AI সারসংক্ষেপ <span className="ml-1 rounded bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-700">AI দিয়ে তৈরি</span></div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            একটি পণ্য বেছে নিন — সেই পণ্যের আসল রিভিউগুলো পড়ে AI একটি সারসংক্ষেপ, ভাব-বিশ্লেষণ (sentiment)
            ও মূল থিমগুলো তৈরি করবে। এটি AI দিয়ে তৈরি সারসংক্ষেপ; আসল রিভিউগুলো নিচের তালিকাতেই আছে।
          </p>
        </div>
        <label className="block text-sm">পণ্য
          <select className="input mt-1" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">— পণ্য বেছে নিন —</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>

      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      {!productId ? (
        <p className="text-sm text-slate-500">সারসংক্ষেপ দেখতে উপরে একটি পণ্য বেছে নিন।</p>
      ) : loading ? (
        <p className="text-sm text-slate-400">লোড হচ্ছে…</p>
      ) : !payload ? (
        <p className="text-sm text-slate-500">এই পণ্যের সারসংক্ষেপের তথ্য লোড করা যায়নি।</p>
      ) : !insight ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            এই পণ্যের জন্য এখনো কোনো AI সারসংক্ষেপ তৈরি হয়নি। বর্তমানে রিভিউ আছে{" "}
            <b>{payload.currentReviewCount}</b>টি।
            {noReviews ? " রিভিউ না থাকলে সারসংক্ষেপ তৈরি করা যাবে না — আগে রিভিউ আসতে দিন।" : ""}
          </p>
          <button
            type="button"
            className="btn-primary disabled:opacity-50"
            disabled={generating || noReviews}
            onClick={() => void generate()}
          >
            {generating ? "তৈরি হচ্ছে…" : "AI সারসংক্ষেপ তৈরি করুন"}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {stale ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 p-3">
              <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                নতুন রিভিউ এসেছে — আবার তৈরি করুন
              </span>
              <span className="text-xs text-amber-800">
                এই সারসংক্ষেপের পর আরও {payload.reviewsSinceGeneration}টি রিভিউ এসেছে।
              </span>
              <button
                type="button"
                className="rounded-lg border bg-white px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                disabled={generating}
                onClick={() => void generate()}
              >
                {generating ? "তৈরি হচ্ছে…" : "আবার তৈরি করুন"}
              </button>
            </div>
          ) : null}

          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{insight.summaryText}</p>

          <div>
            <div className="flex flex-wrap gap-3 text-xs font-semibold">
              <span className="text-emerald-700">ইতিবাচক: {insight.sentimentJson.positive}টি ({shares.positive}%)</span>
              <span className="text-slate-600">নিরপেক্ষ: {insight.sentimentJson.neutral}টি ({shares.neutral}%)</span>
              <span className="text-rose-700">নেতিবাচক: {insight.sentimentJson.negative}টি ({shares.negative}%)</span>
            </div>
            <div className="mt-1.5 flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
              <div className="h-full bg-emerald-500" style={{ width: `${shares.positive}%` }} />
              <div className="h-full bg-slate-400" style={{ width: `${shares.neutral}%` }} />
              <div className="h-full bg-rose-500" style={{ width: `${shares.negative}%` }} />
            </div>
          </div>

          {themes.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-500">মূল থিম:</span>
              {themes.map((t) => (
                <span key={t} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">{t}</span>
              ))}
            </div>
          ) : null}

          <p className="text-[11px] text-slate-400">
            তৈরি হয়েছে: {new Date(insight.generatedAt).toLocaleString("bn-BD")} · তখন রিভিউ ছিল {insight.reviewCountAtGeneration}টি
            {insight.modelLabel ? <> · মডেল: {insight.modelLabel}</> : null}
            {" "}· এটি AI দিয়ে তৈরি সারসংক্ষেপ।
          </p>

          {!stale ? (
            <button
              type="button"
              className="rounded-lg border bg-white px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
              disabled={generating}
              onClick={() => void generate()}
            >
              {generating ? "তৈরি হচ্ছে…" : "আবার তৈরি করুন"}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
