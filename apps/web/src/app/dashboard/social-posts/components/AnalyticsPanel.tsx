"use client";
import React from "react";
import type { SocialPageCtx } from "./shared";
import { PLATFORM_LABELS, AccountAvatar, PlatformDot, PostStatusPill } from "./shared";
import { summaryMetricRows, weekdayNameBn, formatHourBn, insightMetricLabel } from "@/lib/social-post-insights";
import { contentTypeLabel, followerGrowth, formatBnNumber, monthLabelBn } from "@/lib/social-analytics";
import { coachSourceLabel } from "@/lib/social-stock-coach";
import { fmtDateTime, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";

/**
 * SU11 — performance strip + Analytics v2 card (SP7/SU7). Pure move from the former single-file page:
 * all state stays in page.tsx and arrives through the page
 * context prop `c` (every panel stays mounted, so no state is
 * lost on tab switches).
 *
 * SD6 — presentation only: a .ctx-tile summary row on top (post /
 * published counts from the loaded posts, total engagement summed
 * from the SAME timeseries bars, follower delta summed from the
 * SAME per-account snapshot growth — "—" when the data is not
 * there, never an invented number), brand-gradient chart bars,
 * avatar/platform identity in the account rows, designed empty
 * states with the same honest texts, and the monthly report as its
 * own export card. No handler, state or label changed.
 *
 * SD8 — presentation only: the two tile subtexts join the 12px
 * type floor; the chart's value/day labels stay at meta size
 * (data labels on a chart, documented in the batch acceptance).
 */
export function AnalyticsPanel({ c }: { c: SocialPageCtx }) {
  const { t, locale } = useLocale();
  const fb = (v: number, f = 0) => formatBnNumber(v, f, locale);
  const { accounts, analyticsAccounts, analyticsBars, analyticsContentTypes, analyticsFollowers, analyticsHasTimeseriesData, analyticsTimeseries, busy, captionTests, coach, downloadReport, followerHasGrowth, hasPublishedOrInsights, inputCls, insightsSummary, posts, refreshAllInsights, reportMonth, setReportMonth } = c;
  // SD6 tiles: pure sums over data this panel already receives.
  const publishedCount = posts.filter((p) => p.status === "published").length;
  const engagementTotal = analyticsBars.reduce((s, b) => s + b.engagementTotal, 0);
  const engagementPosts = analyticsBars.reduce((s, b) => s + b.posts, 0);
  const followerDeltas = (analyticsFollowers?.accounts ?? [])
    .map((a) => followerGrowth(a.snapshots))
    .filter((g): g is NonNullable<typeof g> => g !== null);
  const followerDeltaTotal = followerDeltas.length > 0 ? followerDeltas.reduce((s, g) => s + g.delta, 0) : null;
  return (
<>
      {/* SD6: summary tiles — loaded data only, "—" when absent */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="ctx-tile">
          <div className="ctx-tile-label">{t("social.anTotalPosts")}</div>
          <div className="ctx-tile-value">{t("social.anCountSuffix", { count: fmtNumber(locale, posts.length) })}</div>
        </div>
        <div className="ctx-tile">
          <div className="ctx-tile-label">{t("social.anPublishedPosts")}</div>
          <div className="ctx-tile-value">{t("social.anCountSuffix", { count: fmtNumber(locale, publishedCount) })}</div>
        </div>
        <div className="ctx-tile">
          <div className="ctx-tile-label">{t("social.anTotalEngagement")}</div>
          <div className="ctx-tile-value">{analyticsHasTimeseriesData ? fb(engagementTotal) : "—"}</div>
          <p className="mt-0.5 text-xs text-slate-400">{analyticsHasTimeseriesData ? <>{t("social.anTileFromData", { days: fb(analyticsTimeseries?.days ?? 30), posts: fb(engagementPosts) })}</> : t("social.anNoDataYet")}</p>
        </div>
        <div className="ctx-tile">
          <div className="ctx-tile-label">{t("social.anFollowerGrowth")}</div>
          <div className="ctx-tile-value">{followerDeltaTotal !== null ? `${followerDeltaTotal >= 0 ? "+" : "−"}${fb(Math.abs(followerDeltaTotal))}` : "—"}</div>
          <p className="mt-0.5 text-xs text-slate-400">{followerDeltaTotal !== null ? t("social.anPerSnapshot") : t("social.anNotEnoughSnapshots")}</p>
        </div>
      </div>

      {/* SN9: the weekly performance coach — the latest stored
          digest when there is one; otherwise the live compute
          preview (clearly labelled as a preview, with the honest
          note about the weekly job template). Every number comes
          from the coach compute over the org's own posts. */}
      <div className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">{t("social.anCoachTitle")}</div>
          {coach?.latest ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              {coachSourceLabel(coach.latest.narrationSource, locale)}
            </span>
          ) : null}
        </div>
        {coach ? (
          <>
            <p className="text-sm leading-relaxed text-slate-700">
              {(coach.latest ?? coach.preview).summary}
            </p>
            {!coach.latest ? (
              <p className="text-xs text-slate-500">
                {t("social.anCoachPreviewNote")}
              </p>
            ) : null}
            {(() => {
              const data = (coach.latest?.data ?? coach.preview.data);
              return (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2 text-sm text-slate-700">
                    <span className="rounded-lg bg-slate-50 px-3 py-2">
                      {t("social.anLast7Days")}<span className="font-semibold">{t("social.anPostsSuffix", { count: fb(data.current.posts) })}</span> · engagement <span className="font-semibold">{fb(data.current.engagement)}</span>
                      {data.engagementDeltaPct !== null ? (
                        <span className={data.engagementDeltaPct >= 0 ? "font-semibold text-green-700" : "font-semibold text-red-600"}>
                          {" "}({data.engagementDeltaPct >= 0 ? "+" : "−"}{fb(Math.abs(data.engagementDeltaPct))}%)
                        </span>
                      ) : null}
                    </span>
                    {data.bestContentType ? (
                      <span className="rounded-lg bg-slate-50 px-3 py-2">{t("social.anBestType")}<span className="font-semibold">{contentTypeLabel(data.bestContentType.kind, locale)}</span> {t("social.anAvgParen", { avg: fb(data.bestContentType.avgEngagement, 1) })}</span>
                    ) : null}
                    {data.bestTime ? (
                      <span className="rounded-lg bg-slate-50 px-3 py-2">{t("social.anBestTime")}<span className="font-semibold">{weekdayNameBn(data.bestTime.dayOfWeek, locale)} {formatHourBn(data.bestTime.hour, locale)}</span></span>
                    ) : null}
                  </div>
                  {data.topPosts.length > 0 ? (
                    <div className="space-y-1">
                      <div className="text-sm font-medium">{t("social.anTopPosts")}</div>
                      {data.topPosts.map((tp) => (
                        <p key={tp.id} className="truncate text-sm text-slate-600" title={tp.captionExcerpt}>
                          🏆 {tp.captionExcerpt || t("social.anNoCaption")} — engagement <span className="font-semibold">{fb(tp.engagement)}</span>
                        </p>
                      ))}
                    </div>
                  ) : null}
                  {data.hashtagMovers.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {data.hashtagMovers.map((m) => (
                        <span key={m.tag} className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                          {m.tag} · {t("social.anAvg")} {fb(m.currentAvg, 1)}{m.previousAvg === null ? t("social.anNewTag") : t("social.anBeforeTag", { avg: fb(m.previousAvg, 1) })}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {!data.dataSufficient ? (
                    <p className="text-xs text-amber-700">{t("social.anLowData", { count: fb(data.current.scoredPosts) })}</p>
                  ) : null}
                </div>
              );
            })()}
          </>
        ) : (
          <div className="soc-empty">
            <span className="soc-empty-icon">🧭</span>
            <p className="text-sm text-slate-500">{t("social.anCoachNotLoaded")}</p>
          </div>
        )}
      </div>

      {/* SP7 performance strip + best time */}
      <div className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">{t("social.anPerformanceTitle")}</div>
          <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={refreshAllInsights}>
            {busy === "insights-bulk" ? t("social.anRefreshing") : t("social.anRefreshAll")}
          </button>
        </div>
        {insightsSummary && insightsSummary.postsWithInsights > 0 ? (
          <>
            <p className="text-xs text-slate-400">{t("social.anBasedOnData")}</p>
            <div className="flex flex-wrap gap-2">
              {summaryMetricRows(insightsSummary.totals, locale).map((row) => (
                <span key={row.key} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  {row.label}: <span className="font-semibold">{fmtNumber(locale, row.total)}</span>{" "}
                  <span className="text-xs text-slate-400">{t("social.anFromPostsData", { count: fmtNumber(locale, row.posts) })}</span>
                </span>
              ))}
            </div>
          </>
        ) : (
          <div className="soc-empty">
            <span className="soc-empty-icon">📊</span>
            <p className="text-sm text-slate-500">{t("social.anNoPerformanceData")}</p>
          </div>
        )}
        {insightsSummary?.bestTime ? (
          <div className="rounded-xl bg-indigo-50/60 p-3">
            <p className="text-sm text-slate-700">
              {t("social.anBestTimeTitle")}{" "}
              <span className="font-semibold">{weekdayNameBn(insightsSummary.bestTime.weekday, locale)} {formatHourBn(insightsSummary.bestTime.hour, locale)}</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {t("social.anBestTimeNote", { count: fmtNumber(locale, insightsSummary.bestTime.postsConsidered) })}
            </p>
          </div>
        ) : hasPublishedOrInsights ? (
          <p className="text-sm text-slate-500">{t("social.anBestTimeNoData")}</p>
        ) : null}

        {/* SU7: Analytics v2 — timeseries / content types / accounts / followers + monthly report */}
        <div className="space-y-5 border-t border-slate-100 pt-4">
          <div className="font-semibold">{t("social.anV2Title", { days: fb(analyticsTimeseries?.days ?? 30) })}</div>

          {/* Timeseries bar chart (plain divs — no chart library) */}
          <div className="space-y-2">
            <div className="text-sm font-medium">{t("social.anByDay")}</div>
            {analyticsTimeseries && analyticsHasTimeseriesData ? (
              <>
                <div className="flex h-36 items-end gap-1 overflow-x-auto pb-1">
                  {analyticsBars.map((b) => (
                    <div key={b.day} className="flex min-w-[22px] flex-1 flex-col items-center justify-end gap-1 self-stretch"
                      title={t("social.anBarTitle", { label: b.label, day: b.day, eng: fb(b.engagementTotal), posts: fb(b.posts) })}>
                      <span className="text-[11px] font-medium text-slate-500">{b.engagementTotal > 0 ? fb(b.engagementTotal) : ""}</span>
                      <div className="flex w-full flex-1 items-end">
                        <div className="w-full rounded-t" style={{ height: `${b.heightPct}%`, minHeight: b.engagementTotal > 0 ? 4 : 0, backgroundImage: "linear-gradient(180deg, var(--brand-from), var(--brand-to))" }} />
                      </div>
                      <span className="whitespace-nowrap text-[10px] text-slate-400">{b.label}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-400">{t("social.anBarHint", { tz: analyticsTimeseries.timeZone })}</p>
              </>
            ) : (
              <div className="soc-empty">
                <span className="soc-empty-icon">📈</span>
                <p className="text-sm text-slate-500">{t("social.anNoEngagementDays", { days: fb(analyticsTimeseries?.days ?? 30) })}</p>
              </div>
            )}
          </div>

          {/* Content-type comparison */}
          <div className="space-y-2">
            <div className="text-sm font-medium">{t("social.anByType")}</div>
            {analyticsContentTypes && analyticsContentTypes.types.length > 0 ? (
              <>
                <div className="overflow-x-auto rounded-xl ring-1 ring-slate-100">
                  <table className="w-full min-w-[480px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50 text-xs text-slate-500">
                        <th className="py-1.5 pl-3 pr-3 font-medium">{t("social.anColType")}</th>
                        <th className="py-1.5 pr-3 font-medium">Post</th>
                        <th className="py-1.5 pr-3 font-medium">{t("social.anColTotalEng")}</th>
                        <th className="py-1.5 font-medium">{t("social.anColAvgEng")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analyticsContentTypes.types.map((ct) => (
                        <tr key={ct.type} className="border-b border-slate-50">
                          <td className="py-1.5 pl-3 pr-3 font-medium">{contentTypeLabel(ct.type, locale)}</td>
                          <td className="py-1.5 pr-3">{t("social.anPostsWithData", { count: fb(ct.posts) })}<span className="text-xs text-slate-400">{t("social.anDataArrived", { count: fb(ct.withInsights) })}</span></td>
                          <td className="py-1.5 pr-3">{ct.engagementTotal == null ? "—" : fb(ct.engagementTotal)}</td>
                          <td className="py-1.5">{ct.engagementAvg == null ? "—" : fb(ct.engagementAvg, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-slate-400">{t("social.anEngagementNote")}</p>
              </>
            ) : (
              <div className="soc-empty">
                <span className="soc-empty-icon">🗂️</span>
                <p className="text-sm text-slate-500">{t("social.anNoTypeData")}</p>
              </div>
            )}
          </div>

          {/* Per-account comparison */}
          <div className="space-y-2">
            <div className="text-sm font-medium">{t("social.anByAccount")}</div>
            {analyticsAccounts && analyticsAccounts.accounts.length > 0 ? (
              <div className="overflow-x-auto rounded-xl ring-1 ring-slate-100">
                <table className="w-full min-w-[480px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-xs text-slate-500">
                      <th className="py-1.5 pl-3 pr-3 font-medium">{t("social.anColAccount")}</th>
                      <th className="py-1.5 pr-3 font-medium">Platform</th>
                      <th className="py-1.5 font-medium">{t("social.anColTotalEng")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analyticsAccounts.accounts.map((a) => (
                      <tr key={a.accountId} className="border-b border-slate-50">
                        <td className="py-1.5 pl-3 pr-3 font-medium">
                          <span className="flex items-center gap-2">
                            <AccountAvatar name={a.name} platform={a.platform} />
                            {a.name}
                          </span>
                        </td>
                        <td className="py-1.5 pr-3"><span className="inline-flex items-center gap-1.5"><PlatformDot platform={a.platform} />{PLATFORM_LABELS[a.platform] ?? a.platform}</span></td>
                        <td className="py-1.5">{fb(a.engagement?.total ?? 0)} <span className="text-xs text-slate-400">{t("social.anFromPostsData", { count: fb(a.engagement?.posts ?? 0) })}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="soc-empty">
                <span className="soc-empty-icon">👥</span>
                <p className="text-sm text-slate-500">{t("social.anNoAccountData")}</p>
              </div>
            )}
          </div>

          {/* Follower growth from real daily snapshots only */}
          <div className="space-y-2">
            <div className="text-sm font-medium">{t("social.anFollowerGrowth")}</div>
            {analyticsFollowers && analyticsFollowers.accounts.length > 0 ? (
              <div className="space-y-1.5">
                {analyticsFollowers.accounts.map((a) => {
                  const growth = followerGrowth(a.snapshots);
                  return (
                    <div key={a.accountId} className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
                      <AccountAvatar name={a.name} platform={a.platform} />
                      <span className="font-medium">{a.name}</span>{" "}
                      <span className="text-xs text-slate-500">({PLATFORM_LABELS[a.platform] ?? a.platform})</span>{" "}
                      {growth ? (
                        <>: {fb(growth.first)} → {fb(growth.last)} follower{" "}
                          <span className={growth.delta >= 0 ? "font-semibold text-green-700" : "font-semibold text-red-600"}>
                            ({growth.delta >= 0 ? "+" : "−"}{fb(Math.abs(growth.delta))}, {t("social.anInDays", { days: fb(growth.days) })})
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-500">: {t("social.anSnapshotFew", { count: fb(a.snapshots?.length ?? 0) })}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="soc-empty">
                <span className="soc-empty-icon">🌱</span>
                <p className="text-sm text-slate-500">{t("social.anNoSnapshots")}</p>
              </div>
            )}
            {!followerHasGrowth ? (
              <p className="text-xs text-slate-500">{t("social.anSnapshotJobNote")}</p>
            ) : null}
          </div>

          {/* Monthly report export (CSV / PDF blob download) — SD6: its own export card */}
          <div className="space-y-2 rounded-2xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200/50">
            <div className="text-sm font-semibold text-slate-800">{t("social.anReportTitle")}</div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block text-sm">{t("social.anMonth")}
                <input type="month" className={inputCls} value={reportMonth} onChange={(e) => setReportMonth(e.target.value)} />
              </label>
              <button type="button" className="btn-secondary disabled:opacity-50" disabled={busy !== "" || !reportMonth} onClick={() => downloadReport("csv")}>
                {busy === "report-csv" ? t("social.anGenerating") : t("social.anCsvDownload")}
              </button>
              <button type="button" className="btn-secondary disabled:opacity-50" disabled={busy !== "" || !reportMonth} onClick={() => downloadReport("pdf")}>
                {busy === "report-pdf" ? t("social.anGenerating") : t("social.anPdfDownload")}
              </button>
              {reportMonth ? <span className="pb-2 text-xs text-slate-500">{t("social.anMonthReport", { month: monthLabelBn(reportMonth, locale) })}</span> : null}
            </div>
          </div>
        </div>
      </div>

      {/* SN10: Caption Test — a pair of posts with different
          captions, shown side by side with the numbers exactly as
          the platforms returned them. No winner is declared here:
          both numbers are shown and the reader decides. */}
      <div className="card space-y-3 p-5">
        <div className="font-semibold">{t("social.anCaptionTestTitle")}</div>
        {captionTests.length === 0 ? (
          <div className="soc-empty">
            <span className="soc-empty-icon">🧪</span>
            <p className="text-sm text-slate-500">{t("social.anNoCaptionTest")}</p>
          </div>
        ) : captionTests.map((ctest) => (
          <div key={ctest.captionTestId} className="space-y-2 rounded-2xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200/50">
            <div className="grid gap-3 sm:grid-cols-2">
              {ctest.posts.map((p) => (
                <div key={p.id} className="space-y-1.5 rounded-xl bg-white p-3 ring-1 ring-inset ring-slate-200/50">
                  <div className="flex flex-wrap items-center gap-2">
                    {p.accountName ? <AccountAvatar name={p.accountName} platform={p.platform ?? ""} /> : null}
                    <span className="font-medium">{p.accountName ?? "—"}</span>
                    {p.platform ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                        <PlatformDot platform={p.platform} />
                        {PLATFORM_LABELS[p.platform] ?? p.platform}
                      </span>
                    ) : null}
                    <PostStatusPill status={p.status} />
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-slate-700">{p.caption || <span className="text-slate-400">{t("social.anNoCaption2")}</span>}</p>
                  {p.publishedAt ? (
                    <p className="text-xs text-slate-500">{t("social.anPublishedAt", { date: fmtDateTime(locale, p.publishedAt) })}</p>
                  ) : null}
                  {p.engagement !== null && p.engagement !== undefined ? (
                    <p className="text-sm text-slate-700">
                      Engagement: <span className="font-semibold">{fb(p.engagement)}</span>
                      {p.metricsPresent.length > 0 ? (
                        <span className="text-xs text-slate-400">{t("social.anFromMetrics", { metrics: p.metricsPresent.map((k) => insightMetricLabel(k, locale)).join(", ") })}</span>
                      ) : null}
                    </p>
                  ) : null}
                  {p.linkClicks > 0 ? (
                    <p className="text-sm text-slate-700">{t("social.anLinkClicks")}<span className="font-semibold">{t("social.anLinkClickCount", { count: fb(p.linkClicks) })}</span></p>
                  ) : null}
                  {p.platformUrl ? (
                    <a href={p.platformUrl} target="_blank" rel="noreferrer" className="inline-block text-xs font-semibold text-indigo-600 hover:underline">{t("social.anViewPost")}</a>
                  ) : null}
                </div>
              ))}
            </div>
            {!ctest.bothPublished ? (
              <p className="text-sm text-slate-500">{t("social.anBothPublished")}</p>
            ) : null}
            {ctest.closeCall === true ? (
              <p className="text-sm text-slate-600">{t("social.anCloseCall")}</p>
            ) : null}
          </div>
        ))}
      </div>

</>
  );
}
