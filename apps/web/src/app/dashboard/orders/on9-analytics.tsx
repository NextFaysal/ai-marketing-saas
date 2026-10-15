"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  buildAnalyticsPath, digestResultLabel, districtBarPct, formatMoneyMinor, formatPct,
  rangeForPreset, type AnalyticsPayload, type DigestRunSummary, type DigestStatus,
} from "@/lib/orders-on9";

/**
 * ON9 — Orders Analytics v2 + Owner Digest panel (opened from
 * the orders page header, same modal pattern as the ON8 studio).
 * Every number's definition is the API's (see
 * order-analytics.service.ts): revenue is the EC33 sold bucket,
 * courier rates use decided denominators, averages show their
 * pair counts, and nulls render as "—". The digest card is
 * honest about its v1 surface: daily auto-send is the per-org
 * `owner_order_digest` job (Jobs / স্বয়ংক্রিয় কাজ settings) —
 * this card only shows status, previews owner recipients, and
 * sends today's digest now. Bengali-first.
 */
export function OrderAnalyticsPanel({ onClose }: { onClose: () => void }) {
  const orgId = getOrganizationId() ?? "";
  const base = `/organizations/${orgId}/orders`;
  const [preset, setPreset] = useState<"7" | "30" | "custom">("30");
  const initial = rangeForPreset(30);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [digest, setDigest] = useState<DigestStatus | null>(null);
  const [runResult, setRunResult] = useState<DigestRunSummary | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async (f: string, t: string) => {
    try {
      const [a, d] = await Promise.all([
        apiFetch<AnalyticsPayload>(buildAnalyticsPath(orgId, f, t)),
        apiFetch<DigestStatus>(`${base}/digest/status`),
      ]);
      setData(a); setDigest(d); setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "অ্যানালিটিক্স লোড ব্যর্থ হয়েছে");
    }
  }, [base, orgId]);

  useEffect(() => { void load(from, to); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyPreset(p: "7" | "30" | "custom") {
    setPreset(p);
    if (p === "custom") return;
    const r = rangeForPreset(p === "7" ? 7 : 30);
    setFrom(r.from); setTo(r.to);
    void load(r.from, r.to);
  }

  async function sendNow() {
    setBusy("digest");
    try {
      const out = await apiFetch<DigestRunSummary>(`${base}/digest/send-now`, { method: "POST", body: JSON.stringify({}) });
      setRunResult(out);
      const d = await apiFetch<DigestStatus>(`${base}/digest/status`);
      setDigest(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ডাইজেস্ট পাঠানো যায়নি");
    } finally { setBusy(""); }
  }

  const maxDistrictOrders = data?.topDistricts[0]?.orders ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="অর্ডার অ্যানালিটিক্স">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">📊 অর্ডার অ্যানালিটিক্স</h2>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>বন্ধ করুন</button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          সব হিসাব Asia/Dhaka ক্যালেন্ডার দিনে। বিক্রি = ডেলিভারি-প্রমাণিত (EC33 sold) অর্ডার; প্র্যাকটিস অর্ডার সব হিসাবের বাইরে।
          বাতিলের কোনো কারণ-ফিল্ড নেই বলে বাতিলের ভাঙন উৎস অনুযায়ী দেখানো হয়েছে।
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={preset === "7" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => applyPreset("7")}>শেষ ৭ দিন</button>
          <button type="button" className={preset === "30" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => applyPreset("30")}>শেষ ৩০ দিন</button>
          <button type="button" className={preset === "custom" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => applyPreset("custom")}>কাস্টম</button>
          {preset === "custom" ? (
            <>
              <input type="date" className="input input-sm" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="শুরুর তারিখ" />
              <span className="text-sm text-slate-500">থেকে</span>
              <input type="date" className="input input-sm" value={to} onChange={(e) => setTo(e.target.value)} aria-label="শেষ তারিখ" />
              <button type="button" className="btn-secondary btn-sm" onClick={() => void load(from, to)}>দেখুন</button>
            </>
          ) : null}
          {data ? <span className="text-xs text-slate-500">{data.from} → {data.to}</span> : null}
        </div>

        {error ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p> : null}

        {data ? (
          <>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full bg-amber-50 px-3 py-1 text-sm text-amber-700">🚚 কুরিয়ারে আটকে থাকা পার্সেল এখন: {data.stuckNow}টি</span>
              <span className="rounded-full bg-red-50 px-3 py-1 text-sm text-red-700">⏱️ SLA ভঙ্গ হয়েছে এমন খোলা অর্ডার এখন: {data.slaBreachesNow}টি</span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
              <div className="rounded-xl border p-3"><p className="text-xs text-slate-500">মোট অর্ডার</p><p className="text-xl font-semibold">{data.ordersCount}</p></div>
              <div className="rounded-xl border p-3"><p className="text-xs text-slate-500">বিক্রি (ডেলিভারি-প্রমাণিত {data.soldCount}টি)</p><p className="text-xl font-semibold">{formatMoneyMinor(data.revenueMinor)}</p></div>
              <div className="rounded-xl border p-3"><p className="text-xs text-slate-500">গড় অর্ডার মূল্য (AOV)</p><p className="text-xl font-semibold">{formatMoneyMinor(data.aovMinor)}</p></div>
              <div className="rounded-xl border p-3"><p className="text-xs text-slate-500">পুনরাবৃত্ত গ্রাহকের হার</p><p className="text-xl font-semibold">{formatPct(data.repeatCustomerRate)}</p></div>
              <div className="rounded-xl border p-3"><p className="text-xs text-slate-500">বাতিলের হার</p><p className="text-xl font-semibold">{formatPct(data.cancellationRate)}</p></div>
              <div className="rounded-xl border p-3"><p className="text-xs text-slate-500">ফেরতের হার</p><p className="text-xl font-semibold">{formatPct(data.returnRate)}</p></div>
            </div>

            {data.cancelBreakdown.length ? (
              <p className="mt-3 text-sm text-slate-600">
                বাতিলের ভাঙন (উৎস অনুযায়ী): {data.cancelBreakdown.map((c) => `${c.source}: ${c.count}টি`).join(" · ")}
              </p>
            ) : null}

            <h3 className="mt-5 font-semibold">কুরিয়ার স্কোরকার্ড</h3>
            <p className="text-xs text-slate-500">হার = নিষ্পত্তি হওয়া (ডেলিভারি+ফেরত+বাতিল) শিপমেন্টের মধ্যে। গড় ট্রানজিট দিনের ভিত্তি শিপমেন্টের সর্বশেষ স্ট্যাটাস-আপডেটের সময় — জোড়ার সংখ্যা (n) পাশে দেওয়া আছে; জোড়া না থাকলে "—"।</p>
            {data.courierScorecard.length ? (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-slate-500">
                    <th className="py-1 pr-2">কুরিয়ার</th><th className="py-1 pr-2">শিপমেন্ট</th><th className="py-1 pr-2">ডেলিভারি %</th>
                    <th className="py-1 pr-2">ফেরত %</th><th className="py-1 pr-2">গড় ট্রানজিট (দিন)</th><th className="py-1">COD আদায়ের গড় ব্যবধান (দিন)</th>
                  </tr></thead>
                  <tbody>
                    {data.courierScorecard.map((c) => (
                      <tr key={c.provider} className="border-t">
                        <td className="py-1 pr-2 font-medium">{c.provider}</td>
                        <td className="py-1 pr-2">{c.shipments}</td>
                        <td className="py-1 pr-2">{formatPct(c.deliveredPct)}</td>
                        <td className="py-1 pr-2">{formatPct(c.returnedPct)}</td>
                        <td className="py-1 pr-2">{c.avgTransitDays === null ? "—" : `${c.avgTransitDays} (n=${c.transitPairs})`}</td>
                        <td className="py-1">{c.avgCodCollectLagDays === null ? "—" : `${c.avgCodCollectLagDays} (n=${c.codPairs})`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="mt-2 text-sm text-slate-500">এই সময়ে কোনো শিপমেন্ট বুক হয়নি।</p>}

            <h3 className="mt-5 font-semibold">শীর্ষ জেলা (বিক্রি অনুযায়ী)</h3>
            {data.topDistricts.length ? (
              <div className="mt-2 space-y-2">
                {data.topDistricts.map((d) => (
                  <div key={d.district}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{d.district}</span>
                      <span className="text-slate-600">{d.orders}টি অর্ডার · {formatMoneyMinor(d.revenueMinor)}</span>
                    </div>
                    <div className="h-2 rounded bg-slate-100">
                      <div className="h-2 rounded bg-blue-500" style={{ width: `${districtBarPct(d.orders, maxDistrictOrders)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="mt-2 text-sm text-slate-500">এই সময়ে জেলা শনাক্ত হওয়া কোনো বিক্রি নেই।</p>}

            <h3 className="mt-5 font-semibold">বেশি-ফেরত পণ্যের সতর্কতা</h3>
            <p className="text-xs text-slate-500">ফেরতের হার ≥ ২৫% এবং কমপক্ষে ১০টি অর্ডার থাকলেই সতর্কতা দেখায়।</p>
            {data.productReturnWarnings.length ? (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-slate-500"><th className="py-1 pr-2">পণ্য</th><th className="py-1 pr-2">অর্ডার</th><th className="py-1 pr-2">ফেরত</th><th className="py-1">হার</th></tr></thead>
                  <tbody>
                    {data.productReturnWarnings.map((w) => (
                      <tr key={w.productId} className="border-t">
                        <td className="py-1 pr-2 font-medium">{w.productName || w.productId}</td>
                        <td className="py-1 pr-2">{w.orders}</td>
                        <td className="py-1 pr-2">{w.returns}</td>
                        <td className="py-1 text-red-600">{w.ratePct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="mt-2 text-sm text-slate-500">এই সময়ে কোনো পণ্য সতর্কতার সীমা ছাড়ায়নি।</p>}
          </>
        ) : <p className="mt-4 text-sm text-slate-500">লোড হচ্ছে…</p>}

        <div className="mt-6 rounded-xl border p-4">
          <h3 className="font-semibold">📬 মালিকের দৈনিক ডাইজেস্ট</h3>
          <p className="mt-1 text-xs text-slate-500">
            প্রতিদিনের স্বয়ংক্রিয় পাঠানো চালু/বন্ধ হয় Jobs / স্বয়ংক্রিয় কাজ সেটিংসে `owner_order_digest` কাজটি দিয়ে
            (বর্তমানে: {digest ? (digest.jobInstalled ? (digest.jobEnabled ? "চালু আছে" : "বসানো আছে, বন্ধ") : "বসানো হয়নি") : "…"} )।
            SMS শুধুমাত্র মালিকের ফোন নম্বর রেকর্ডে থাকলেই যায়।
          </p>
          <p className="mt-2 text-sm text-slate-600">
            প্রাপক (মালিকদের ইমেইল): {digest && digest.ownerEmails.length ? digest.ownerEmails.join(", ") : "কোনো সক্রিয় মালিক পাওয়া যায়নি"}
          </p>
          {digest?.lastRun ? (
            <div className="mt-2 text-sm text-slate-600">
              <p>সর্বশেষ পাঠানো: {digest.lastRun.day ?? "—"} ({digest.lastRun.period === "yesterday" ? "গতকালের" : "আজকের"} সারাংশ) · {digest.lastRun.at ? new Date(digest.lastRun.at).toLocaleString("bn-BD") : ""}</p>
              <ul className="mt-1 list-inside list-disc">
                {digest.lastRun.results.map((r, i) => <li key={i}>{digestResultLabel(r)}</li>)}
              </ul>
            </div>
          ) : <p className="mt-2 text-sm text-slate-500">এখনো কোনো ডাইজেস্ট পাঠানো হয়নি।</p>}
          <button type="button" className="btn-primary btn-sm mt-3" disabled={busy === "digest"} onClick={() => void sendNow()}>
            {busy === "digest" ? "পাঠানো হচ্ছে…" : "এখনই পাঠান (আজকের সারাংশ)"}
          </button>
          {runResult ? (
            <div className="mt-2 text-sm">
              <p>এই রানের ফল: পাঠানো হয়েছে {runResult.sentCount}টি · ব্যর্থ {runResult.failedCount}টি · বাদ {runResult.skippedCount}টি</p>
              <ul className="mt-1 list-inside list-disc">
                {runResult.recipients.map((r, i) => <li key={i}>{digestResultLabel(r)}</li>)}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
