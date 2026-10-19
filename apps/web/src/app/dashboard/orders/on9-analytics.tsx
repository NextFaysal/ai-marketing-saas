"use client";
import React, { useCallback, useEffect, useState } from "react";
import { fmtDateTime, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import { ResponsiveTable } from "@repo/ui";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  buildAnalyticsPath, digestResultLabel, districtBarPct, formatMoneyMinor, formatPct,
  rangeForPreset, type AnalyticsPayload, type DigestRunSummary, type DigestStatus,
} from "@/lib/orders-on9";
import type { SourcesPayload } from "@/lib/ab7";

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
  const { dict, t, locale } = useLocale();
  const orgId = getOrganizationId() ?? "";
  const base = `/organizations/${orgId}/orders`;
  const [preset, setPreset] = useState<"7" | "30" | "custom">("30");
  const initial = rangeForPreset(30);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  // AB7 (AX19): বিক্রির উৎস — loads independently so a failure
  // here never blanks the rest of the analytics panel.
  const [sources, setSources] = useState<SourcesPayload | null>(null);
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
      setError(e instanceof Error ? e.message : dict.orders.analyticsLoadFailed);
    }
    try {
      const s = await apiFetch<SourcesPayload>(`/organizations/${orgId}/commerce/analytics/sources`);
      setSources(s);
    } catch { /* sources section stays hidden until the endpoint answers */ }
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
      setError(e instanceof Error ? e.message : dict.orders.digestCouldNotBeSent);
    } finally { setBusy(""); }
  }

  const maxDistrictOrders = data?.topDistricts[0]?.orders ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={dict.orders.orderAnalytics}>
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{dict.orders.orderAnalytics2}</h2>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>{dict.orders.close}</button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {dict.orders.allCalculationsAreByAsia2}</p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={preset === "7" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => applyPreset("7")}>{dict.orders.last7Days}</button>
          <button type="button" className={preset === "30" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => applyPreset("30")}>{dict.orders.last30Days}</button>
          <button type="button" className={preset === "custom" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => applyPreset("custom")}>{dict.orders.custom}</button>
          {preset === "custom" ? (
            <>
              <input type="date" className="input input-sm" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={dict.orders.startDate} />
              <span className="text-sm text-slate-500">{dict.orders.from}</span>
              <input type="date" className="input input-sm" value={to} onChange={(e) => setTo(e.target.value)} aria-label={dict.orders.endDate} />
              <button type="button" className="btn-secondary btn-sm" onClick={() => void load(from, to)}>{dict.orders.view}</button>
            </>
          ) : null}
          {data ? <span className="text-xs text-slate-500">{data.from} → {data.to}</span> : null}
        </div>

        {error ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p> : null}

        {data ? (
          <>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full bg-amber-50 px-3 py-1 text-sm text-amber-700">{dict.orders.parcelsNowStuckAtCourier}{data.stuckNow}{dict.orders.items}</span>
              <span className="rounded-full bg-red-50 px-3 py-1 text-sm text-red-700">{dict.orders.openOrdersWithBreachedSLA}{data.slaBreachesNow}{dict.orders.items}</span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
              <div className="rounded-xl border p-3"><p className="text-xs text-slate-500">{dict.orders.totalOrders}</p><p className="text-xl font-semibold">{data.ordersCount}</p></div>
              <div className="rounded-xl border p-3"><p className="text-xs text-slate-500">{dict.orders.salesDeliveryProven}{data.soldCount}{dict.orders.items2}</p><p className="text-xl font-semibold">{formatMoneyMinor(data.revenueMinor, locale)}</p></div>
              <div className="rounded-xl border p-3"><p className="text-xs text-slate-500">{dict.orders.averageOrderValueAOV}</p><p className="text-xl font-semibold">{formatMoneyMinor(data.aovMinor, locale)}</p></div>
              <div className="rounded-xl border p-3"><p className="text-xs text-slate-500">{dict.orders.repeatCustomerRate}</p><p className="text-xl font-semibold">{formatPct(data.repeatCustomerRate)}</p></div>
              <div className="rounded-xl border p-3"><p className="text-xs text-slate-500">{dict.orders.cancellationRate}</p><p className="text-xl font-semibold">{formatPct(data.cancellationRate)}</p></div>
              <div className="rounded-xl border p-3"><p className="text-xs text-slate-500">{dict.orders.returnRate3}</p><p className="text-xl font-semibold">{formatPct(data.returnRate)}</p></div>
            </div>

            {data.cancelBreakdown.length ? (
              <p className="mt-3 text-sm text-slate-600">
                {dict.orders.cancellationBreakdownBySource}{data.cancelBreakdown.map((c) => t("orders.text1mmyp3w", { source: c.source, count: c.count })).join(" · ")}
              </p>
            ) : null}

            <h3 className="mt-5 font-semibold">{dict.orders.courierScorecard}</h3>
            <p className="text-xs text-slate-500">{dict.orders.rateShareAmongSettledShipments}</p>
            {data.courierScorecard.length ? (
              <ResponsiveTable
                className="mt-2"
                table={
                  <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-slate-500">
                    <th className="py-1 pr-2">{dict.orders.courier}</th><th className="py-1 pr-2">{dict.orders.shipment}</th><th className="py-1 pr-2">{dict.orders.delivery}</th>
                    <th className="py-1 pr-2">{dict.orders.return3}</th><th className="py-1 pr-2">{dict.orders.averageTransitDays}</th><th className="py-1">{dict.orders.averageCODCollectionGapDays}</th>
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
                }
                cards={data.courierScorecard.map((c) => (
                  <div key={c.provider} className="rounded-xl border bg-white p-3 shadow-sm">
                    <div className="font-bold text-slate-900">{c.provider}</div>
                    <dl className="mt-2 space-y-1 text-xs">
                      <div className="flex justify-between gap-2"><dt className="text-slate-500">{dict.orders.shipment}</dt><dd className="font-medium">{c.shipments}</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-slate-500">{dict.orders.delivery}</dt><dd className="font-medium">{formatPct(c.deliveredPct)}</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-slate-500">{dict.orders.return3}</dt><dd className="font-medium">{formatPct(c.returnedPct)}</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-slate-500">{dict.orders.averageTransitDays}</dt><dd className="font-medium">{c.avgTransitDays === null ? "—" : `${c.avgTransitDays} (n=${c.transitPairs})`}</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-slate-500">{dict.orders.averageCODCollectionGapDays}</dt><dd className="font-medium">{c.avgCodCollectLagDays === null ? "—" : `${c.avgCodCollectLagDays} (n=${c.codPairs})`}</dd></div>
                    </dl>
                  </div>
                ))}
              />
            ) : <p className="mt-2 text-sm text-slate-500">{dict.orders.noShipmentsBookedInThis}</p>}

            <h3 className="mt-5 font-semibold">{dict.orders.topDistrictsBySales}</h3>
            {data.topDistricts.length ? (
              <div className="mt-2 space-y-2">
                {data.topDistricts.map((d) => (
                  <div key={d.district}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{d.district}</span>
                      <span className="text-slate-600">{d.orders}{dict.orders.orders2}{formatMoneyMinor(d.revenueMinor, locale)}</span>
                    </div>
                    <div className="h-2 rounded bg-slate-100">
                      <div className="h-2 rounded bg-blue-500" style={{ width: `${districtBarPct(d.orders, maxDistrictOrders)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="mt-2 text-sm text-slate-500">{dict.orders.noDistrictIdentifiedSalesIn}</p>}

            <h3 className="mt-5 font-semibold">{dict.orders.highReturnProductAlerts}</h3>
            <p className="text-xs text-slate-500">{dict.orders.theAlertShowsOnlyWhen}</p>
            {data.productReturnWarnings.length ? (
              <ResponsiveTable
                className="mt-2"
                table={
                  <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-slate-500"><th className="py-1 pr-2">{dict.orders.product}</th><th className="py-1 pr-2">{dict.orders.order}</th><th className="py-1 pr-2">{dict.orders.return}</th><th className="py-1">{dict.orders.rate}</th></tr></thead>
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
                }
                cards={data.productReturnWarnings.map((w) => (
                  <div key={w.productId} className="rounded-xl border bg-white p-3 shadow-sm">
                    <div className="font-bold text-slate-900">{w.productName || w.productId}</div>
                    <dl className="mt-2 space-y-1 text-xs">
                      <div className="flex justify-between gap-2"><dt className="text-slate-500">{dict.orders.order}</dt><dd className="font-medium">{w.orders}</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-slate-500">{dict.orders.return}</dt><dd className="font-medium">{w.returns}</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-slate-500">{dict.orders.rate}</dt><dd className="font-medium text-red-600">{w.ratePct}%</dd></div>
                    </dl>
                  </div>
                ))}
              />
            ) : <p className="mt-2 text-sm text-slate-500">{dict.orders.noProductsCrossedTheAlert}</p>}

            {/* AB7 (AX19): বিক্রির উৎস */}
            <h3 className="mt-5 font-semibold">{dict.orders.salesSources}</h3>
            <p className="text-xs text-slate-500">
              {dict.orders.onlyOrdersFromThisShop}</p>
            {sources && sources.rows.length ? (
              <>
                <ResponsiveTable
                  className="mt-2"
                  table={
                    <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-slate-500">
                      <th className="py-1 pr-2">{dict.orders.source}</th><th className="py-1 pr-2">{dict.orders.order}</th><th className="py-1">{dict.orders.revenue2}</th>
                    </tr></thead>
                    <tbody>
                      {sources.rows.map((r) => (
                        <tr key={r.source} className="border-t">
                          <td className="py-1 pr-2 font-medium">{r.source}</td>
                          <td className="py-1 pr-2">{r.orders}{dict.orders.items}</td>
                          <td className="py-1">{formatMoneyMinor(r.revenueMinor, locale)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                    </div>
                  }
                  cards={sources.rows.map((r) => (
                    <div key={r.source} className="rounded-xl border bg-white p-3 shadow-sm">
                      <div className="font-bold text-slate-900">{r.source}</div>
                      <dl className="mt-2 space-y-1 text-xs">
                        <div className="flex justify-between gap-2"><dt className="text-slate-500">{dict.orders.order}</dt><dd className="font-medium">{r.orders}{dict.orders.items}</dd></div>
                        <div className="flex justify-between gap-2"><dt className="text-slate-500">{dict.orders.revenue2}</dt><dd className="font-medium">{formatMoneyMinor(r.revenueMinor, locale)}</dd></div>
                      </dl>
                    </div>
                  ))}
                />
                <p className="mt-2 text-sm text-slate-600">
                  {dict.orders.total3}{sources.totals.orders}{dict.orders.orders2}{formatMoneyMinor(sources.totals.revenueMinor, locale)} {dict.orders.withClickID}{sources.totals.withClickId}{dict.orders.withSourceImprint}{sources.totals.stampedOrders}{dict.orders.ofThem}</p>
              </>
            ) : <p className="mt-2 text-sm text-slate-500">{dict.orders.noOrderDataFoundBy}</p>}
          </>
        ) : <p className="mt-4 text-sm text-slate-500">{dict.common.loading}</p>}

        <div className="mt-6 rounded-xl border p-4">
          <h3 className="font-semibold">{dict.orders.ownerSDailyDigest}</h3>
          <p className="mt-1 text-xs text-slate-500">
            {dict.orders.dailyAutomaticSendingIsTurned}{digest ? (digest.jobInstalled ? (digest.jobEnabled ? dict.orders.active2 : dict.orders.setButOff) : dict.orders.notSet) : "…"} {dict.orders.sMSGoesOnlyIfThe}</p>
          <p className="mt-2 text-sm text-slate-600">
            {dict.orders.recipientsOwnersEmails}{digest && digest.ownerEmails.length ? digest.ownerEmails.join(", ") : dict.orders.noActiveOwnerFound}
          </p>
          {digest?.lastRun ? (
            <div className="mt-2 text-sm text-slate-600">
              <p>{dict.orders.lastSent}{digest.lastRun.day ?? "—"} ({digest.lastRun.period === "yesterday" ? dict.orders.yesterdayS : dict.orders.todayS} {dict.orders.summary}{digest.lastRun.at ? fmtDateTime(locale, new Date(digest.lastRun.at)) : ""}</p>
              <ul className="mt-1 list-inside list-disc">
                {digest.lastRun.results.map((r, i) => <li key={i}>{digestResultLabel(r, locale)}</li>)}
              </ul>
            </div>
          ) : <p className="mt-2 text-sm text-slate-500">{dict.orders.noDigestSentYet}</p>}
          <button type="button" className="btn-primary btn-sm mt-3" disabled={busy === "digest"} onClick={() => void sendNow()}>
            {busy === "digest" ? dict.orders.sending : dict.orders.sendNowTodaySSummary}
          </button>
          {runResult ? (
            <div className="mt-2 text-sm">
              <p>{dict.orders.thisRunSResultSent}{runResult.sentCount}{dict.orders.failed3}{runResult.failedCount}{dict.orders.skipped}{runResult.skippedCount}{dict.orders.items}</p>
              <ul className="mt-1 list-inside list-disc">
                {runResult.recipients.map((r, i) => <li key={i}>{digestResultLabel(r, locale)}</li>)}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
