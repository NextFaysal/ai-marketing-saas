"use client";
import React from "react";
import type { SocialPageCtx } from "./shared";
import { PLATFORM_LABELS, AccountAvatar, PlatformDot, PostStatusPill } from "./shared";
import { summaryMetricRows, weekdayNameBn, formatHourBn, insightMetricLabel } from "@/lib/social-post-insights";
import { contentTypeLabel, followerGrowth, formatBnNumber, monthLabelBn } from "@/lib/social-analytics";
import { coachSourceLabel } from "@/lib/social-stock-coach";

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
          <div className="ctx-tile-label">মোট post</div>
          <div className="ctx-tile-value">{posts.length.toLocaleString("bn-BD")}টি</div>
        </div>
        <div className="ctx-tile">
          <div className="ctx-tile-label">প্রকাশিত post</div>
          <div className="ctx-tile-value">{publishedCount.toLocaleString("bn-BD")}টি</div>
        </div>
        <div className="ctx-tile">
          <div className="ctx-tile-label">মোট Engagement</div>
          <div className="ctx-tile-value">{analyticsHasTimeseriesData ? formatBnNumber(engagementTotal) : "—"}</div>
          <p className="mt-0.5 text-xs text-slate-400">{analyticsHasTimeseriesData ? <>শেষ {formatBnNumber(analyticsTimeseries?.days ?? 30)} দিনে {formatBnNumber(engagementPosts)}টি post-এর data থেকে</> : "এখনো data আসেনি"}</p>
        </div>
        <div className="ctx-tile">
          <div className="ctx-tile-label">Follower বৃদ্ধি</div>
          <div className="ctx-tile-value">{followerDeltaTotal !== null ? `${followerDeltaTotal >= 0 ? "+" : "−"}${formatBnNumber(Math.abs(followerDeltaTotal))}` : "—"}</div>
          <p className="mt-0.5 text-xs text-slate-400">{followerDeltaTotal !== null ? "snapshot অনুযায়ী" : "যথেষ্ট snapshot নেই"}</p>
        </div>
      </div>

      {/* SN9: the weekly performance coach — the latest stored
          digest when there is one; otherwise the live compute
          preview (clearly labelled as a preview, with the honest
          note about the weekly job template). Every number comes
          from the coach compute over the org's own posts. */}
      <div className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">🧭 Social Coach — সাপ্তাহিক সারসংক্ষেপ</div>
          {coach?.latest ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              {coachSourceLabel(coach.latest.narrationSource)}
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
                এটি এখনকার হিসাবের পূর্বরূপ (preview) — এখনো কোনো সাপ্তাহিক digest তৈরি হয়নি। Automations-এ “Social Coach Weekly” template চালু করলে প্রতি সপ্তাহে digest এখানে জমা হবে এবং Owner/Admin-রা নোটিফিকেশন পাবেন। Coach নিজে থেকে কোনো post তৈরি বা publish করে না।
              </p>
            ) : null}
            {(() => {
              const data = (coach.latest?.data ?? coach.preview.data);
              return (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2 text-sm text-slate-700">
                    <span className="rounded-lg bg-slate-50 px-3 py-2">
                      গত ৭ দিন: <span className="font-semibold">{formatBnNumber(data.current.posts)}টি post</span> · engagement <span className="font-semibold">{formatBnNumber(data.current.engagement)}</span>
                      {data.engagementDeltaPct !== null ? (
                        <span className={data.engagementDeltaPct >= 0 ? "font-semibold text-green-700" : "font-semibold text-red-600"}>
                          {" "}({data.engagementDeltaPct >= 0 ? "+" : "−"}{formatBnNumber(Math.abs(data.engagementDeltaPct))}%)
                        </span>
                      ) : null}
                    </span>
                    {data.bestContentType ? (
                      <span className="rounded-lg bg-slate-50 px-3 py-2">সেরা ধরন: <span className="font-semibold">{contentTypeLabel(data.bestContentType.kind)}</span> (গড় {formatBnNumber(data.bestContentType.avgEngagement, 1)})</span>
                    ) : null}
                    {data.bestTime ? (
                      <span className="rounded-lg bg-slate-50 px-3 py-2">সেরা সময়: <span className="font-semibold">{weekdayNameBn(data.bestTime.dayOfWeek)} {formatHourBn(data.bestTime.hour)}</span></span>
                    ) : null}
                  </div>
                  {data.topPosts.length > 0 ? (
                    <div className="space-y-1">
                      <div className="text-sm font-medium">সেরা post (গত ৭ দিন)</div>
                      {data.topPosts.map((t) => (
                        <p key={t.id} className="truncate text-sm text-slate-600" title={t.captionExcerpt}>
                          🏆 {t.captionExcerpt || "(caption নেই)"} — engagement <span className="font-semibold">{formatBnNumber(t.engagement)}</span>
                        </p>
                      ))}
                    </div>
                  ) : null}
                  {data.hashtagMovers.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {data.hashtagMovers.map((m) => (
                        <span key={m.tag} className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                          {m.tag} · গড় {formatBnNumber(m.currentAvg, 1)}{m.previousAvg === null ? " · নতুন" : ` · আগে ${formatBnNumber(m.previousAvg, 1)}`}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {!data.dataSufficient ? (
                    <p className="text-xs text-amber-700">Data এখনো কম — গত ৭ দিনে engagement-data-সহ post মাত্র {formatBnNumber(data.current.scoredPosts)}টি, তাই Coach পরামর্শের বদলে শুধু এই অবস্থাটাই জানাচ্ছে।</p>
                  ) : null}
                </div>
              );
            })()}
          </>
        ) : (
          <div className="soc-empty">
            <span className="soc-empty-icon">🧭</span>
            <p className="text-sm text-slate-500">Coach-এর হিসাব এখনো লোড হয়নি।</p>
          </div>
        )}
      </div>

      {/* SP7 performance strip + best time */}
      <div className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">📊 পোস্টের পারফরম্যান্স</div>
          <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={refreshAllInsights}>
            {busy === "insights-bulk" ? "হালনাগাদ হচ্ছে..." : "সব post-এর data হালনাগাদ করুন"}
          </button>
        </div>
        {insightsSummary && insightsSummary.postsWithInsights > 0 ? (
          <>
            <p className="text-xs text-slate-400">যেসব post-এর data এসেছে তার ভিত্তিতে</p>
            <div className="flex flex-wrap gap-2">
              {summaryMetricRows(insightsSummary.totals).map((row) => (
                <span key={row.key} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  {row.label}: <span className="font-semibold">{row.total.toLocaleString("bn-BD")}</span>{" "}
                  <span className="text-xs text-slate-400">({row.posts.toLocaleString("bn-BD")}টি post-এর data থেকে)</span>
                </span>
              ))}
            </div>
          </>
        ) : (
          <div className="soc-empty">
            <span className="soc-empty-icon">📊</span>
            <p className="text-sm text-slate-500">এখনো কোনো post-এর performance data আসেনি — প্রকাশিত post-এর data হালনাগাদ হলে এখানে সারসংক্ষেপ দেখা যাবে।</p>
          </div>
        )}
        {insightsSummary?.bestTime ? (
          <div className="rounded-xl bg-indigo-50/60 p-3">
            <p className="text-sm text-slate-700">
              🏆 সেরা সময় (আপনার data অনুযায়ী):{" "}
              <span className="font-semibold">{weekdayNameBn(insightsSummary.bestTime.weekday)} {formatHourBn(insightsSummary.bestTime.hour)}</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              আপনার নিজের post-এর data থেকে আনুমানিক পরামর্শ — নিশ্চয়তা নয় · {insightsSummary.bestTime.postsConsidered.toLocaleString("bn-BD")}টি post-এর data বিবেচনা করা হয়েছে
            </p>
          </div>
        ) : hasPublishedOrInsights ? (
          <p className="text-sm text-slate-500">সেরা সময়: পর্যাপ্ত data নেই — অন্তত ১০টি post-এর data লাগবে</p>
        ) : null}

        {/* SU7: Analytics v2 — timeseries / content types / accounts / followers + monthly report */}
        <div className="space-y-5 border-t border-slate-100 pt-4">
          <div className="font-semibold">📈 Analytics v2 (শেষ {formatBnNumber(analyticsTimeseries?.days ?? 30)} দিন)</div>

          {/* Timeseries bar chart (plain divs — no chart library) */}
          <div className="space-y-2">
            <div className="text-sm font-medium">দিন অনুযায়ী Engagement</div>
            {analyticsTimeseries && analyticsHasTimeseriesData ? (
              <>
                <div className="flex h-36 items-end gap-1 overflow-x-auto pb-1">
                  {analyticsBars.map((b) => (
                    <div key={b.day} className="flex min-w-[22px] flex-1 flex-col items-center justify-end gap-1 self-stretch"
                      title={`${b.label} (${b.day}): engagement ${formatBnNumber(b.engagementTotal)} · ${formatBnNumber(b.posts)}টি post-এর data`}>
                      <span className="text-[11px] font-medium text-slate-500">{b.engagementTotal > 0 ? formatBnNumber(b.engagementTotal) : ""}</span>
                      <div className="flex w-full flex-1 items-end">
                        <div className="w-full rounded-t" style={{ height: `${b.heightPct}%`, minHeight: b.engagementTotal > 0 ? 4 : 0, backgroundImage: "linear-gradient(180deg, var(--brand-from), var(--brand-to))" }} />
                      </div>
                      <span className="whitespace-nowrap text-[10px] text-slate-400">{b.label}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-400">প্রতিটি bar-এ মাউস রাখলে দিন, মোট engagement ও কয়টা post-এর data থেকে এসেছে তা দেখা যাবে। সময়কালের timezone: {analyticsTimeseries.timeZone}</p>
              </>
            ) : (
              <div className="soc-empty">
                <span className="soc-empty-icon">📈</span>
                <p className="text-sm text-slate-500">গত {formatBnNumber(analyticsTimeseries?.days ?? 30)} দিনে কোনো post-এর engagement data আসেনি — প্রকাশিত post-এর data হালনাগাদ হলে এখানে দিন অনুযায়ী chart দেখা যাবে।</p>
              </div>
            )}
          </div>

          {/* Content-type comparison */}
          <div className="space-y-2">
            <div className="text-sm font-medium">কনটেন্টের ধরন অনুযায়ী</div>
            {analyticsContentTypes && analyticsContentTypes.types.length > 0 ? (
              <>
                <div className="overflow-x-auto rounded-xl ring-1 ring-slate-100">
                  <table className="w-full min-w-[480px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50 text-xs text-slate-500">
                        <th className="py-1.5 pl-3 pr-3 font-medium">ধরন</th>
                        <th className="py-1.5 pr-3 font-medium">Post</th>
                        <th className="py-1.5 pr-3 font-medium">মোট Engagement</th>
                        <th className="py-1.5 font-medium">গড় Engagement</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analyticsContentTypes.types.map((t) => (
                        <tr key={t.type} className="border-b border-slate-50">
                          <td className="py-1.5 pl-3 pr-3 font-medium">{contentTypeLabel(t.type)}</td>
                          <td className="py-1.5 pr-3">{formatBnNumber(t.posts)}টি <span className="text-xs text-slate-400">({formatBnNumber(t.withInsights)}টির data এসেছে)</span></td>
                          <td className="py-1.5 pr-3">{t.engagementTotal == null ? "—" : formatBnNumber(t.engagementTotal)}</td>
                          <td className="py-1.5">{t.engagementAvg == null ? "—" : formatBnNumber(t.engagementAvg, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-slate-400">Engagement শুধু যেসব post-এর platform data এসেছে সেগুলোর ভিত্তিতে — data না থাকলে “—” দেখানো হয়, ০ বানানো হয় না।</p>
              </>
            ) : (
              <div className="soc-empty">
                <span className="soc-empty-icon">🗂️</span>
                <p className="text-sm text-slate-500">এখনো ধরন অনুযায়ী তুলনা করার মতো data আসেনি।</p>
              </div>
            )}
          </div>

          {/* Per-account comparison */}
          <div className="space-y-2">
            <div className="text-sm font-medium">অ্যাকাউন্ট অনুযায়ী তুলনা</div>
            {analyticsAccounts && analyticsAccounts.accounts.length > 0 ? (
              <div className="overflow-x-auto rounded-xl ring-1 ring-slate-100">
                <table className="w-full min-w-[480px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-xs text-slate-500">
                      <th className="py-1.5 pl-3 pr-3 font-medium">অ্যাকাউন্ট</th>
                      <th className="py-1.5 pr-3 font-medium">Platform</th>
                      <th className="py-1.5 font-medium">মোট Engagement</th>
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
                        <td className="py-1.5">{formatBnNumber(a.engagement?.total ?? 0)} <span className="text-xs text-slate-400">({formatBnNumber(a.engagement?.posts ?? 0)}টি post-এর data থেকে)</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="soc-empty">
                <span className="soc-empty-icon">👥</span>
                <p className="text-sm text-slate-500">এখনো কোনো অ্যাকাউন্টের engagement data আসেনি।</p>
              </div>
            )}
          </div>

          {/* Follower growth from real daily snapshots only */}
          <div className="space-y-2">
            <div className="text-sm font-medium">Follower বৃদ্ধি</div>
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
                        <>: {formatBnNumber(growth.first)} → {formatBnNumber(growth.last)} follower{" "}
                          <span className={growth.delta >= 0 ? "font-semibold text-green-700" : "font-semibold text-red-600"}>
                            ({growth.delta >= 0 ? "+" : "−"}{formatBnNumber(Math.abs(growth.delta))}, {formatBnNumber(growth.days)} দিনে)
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-500">: এখনো যথেষ্ট snapshot নেই (পাওয়া গেছে {formatBnNumber(a.snapshots?.length ?? 0)}টি) — growth হিসাব করা যাচ্ছে না</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="soc-empty">
                <span className="soc-empty-icon">🌱</span>
                <p className="text-sm text-slate-500">এখনো কোনো follower snapshot পাওয়া যায়নি।</p>
              </div>
            )}
            {!followerHasGrowth ? (
              <p className="text-xs text-slate-500">প্রতিদিনের snapshot job (“Social Follower Snapshot” Automations template) চালু/চালালে এখানে growth আসবে — snapshot ছাড়া কোনো সংখ্যা বানানো হয় না।</p>
            ) : null}
          </div>

          {/* Monthly report export (CSV / PDF blob download) — SD6: its own export card */}
          <div className="space-y-2 rounded-2xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200/50">
            <div className="text-sm font-semibold text-slate-800">📄 মাসের রিপোর্ট ডাউনলোড</div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block text-sm">মাস
                <input type="month" className={inputCls} value={reportMonth} onChange={(e) => setReportMonth(e.target.value)} />
              </label>
              <button type="button" className="btn-secondary disabled:opacity-50" disabled={busy !== "" || !reportMonth} onClick={() => downloadReport("csv")}>
                {busy === "report-csv" ? "তৈরি হচ্ছে..." : "CSV ডাউনলোড"}
              </button>
              <button type="button" className="btn-secondary disabled:opacity-50" disabled={busy !== "" || !reportMonth} onClick={() => downloadReport("pdf")}>
                {busy === "report-pdf" ? "তৈরি হচ্ছে..." : "PDF ডাউনলোড"}
              </button>
              {reportMonth ? <span className="pb-2 text-xs text-slate-500">{monthLabelBn(reportMonth)}-এর রিপোর্ট</span> : null}
            </div>
          </div>
        </div>
      </div>

      {/* SN10: Caption Test — a pair of posts with different
          captions, shown side by side with the numbers exactly as
          the platforms returned them. No winner is declared here:
          both numbers are shown and the reader decides. */}
      <div className="card space-y-3 p-5">
        <div className="font-semibold">🧪 Caption Test (জোড়া পোস্ট তুলনা)</div>
        {captionTests.length === 0 ? (
          <div className="soc-empty">
            <span className="soc-empty-icon">🧪</span>
            <p className="text-sm text-slate-500">এখনো কোনো Caption Test নেই — Posts ট্যাবে কোনো Draft পোস্ট থেকে “Caption Test তৈরি করুন” দিয়ে জোড়া তৈরি করা যায়।</p>
          </div>
        ) : captionTests.map((t) => (
          <div key={t.captionTestId} className="space-y-2 rounded-2xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200/50">
            <div className="grid gap-3 sm:grid-cols-2">
              {t.posts.map((p) => (
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
                  <p className="whitespace-pre-wrap text-sm text-slate-700">{p.caption || <span className="text-slate-400">(ক্যাপশন নেই)</span>}</p>
                  {p.publishedAt ? (
                    <p className="text-xs text-slate-500">প্রকাশিত: {new Date(p.publishedAt).toLocaleString("bn-BD")}</p>
                  ) : null}
                  {p.engagement !== null && p.engagement !== undefined ? (
                    <p className="text-sm text-slate-700">
                      Engagement: <span className="font-semibold">{formatBnNumber(p.engagement)}</span>
                      {p.metricsPresent.length > 0 ? (
                        <span className="text-xs text-slate-400"> ({p.metricsPresent.map((k) => insightMetricLabel(k)).join(", ")} থেকে)</span>
                      ) : null}
                    </p>
                  ) : null}
                  {p.linkClicks > 0 ? (
                    <p className="text-sm text-slate-700">Link click: <span className="font-semibold">{formatBnNumber(p.linkClicks)}টি</span></p>
                  ) : null}
                  {p.platformUrl ? (
                    <a href={p.platformUrl} target="_blank" rel="noreferrer" className="inline-block text-xs font-semibold text-indigo-600 hover:underline">প্রকাশিত পোস্ট দেখুন ↗</a>
                  ) : null}
                </div>
              ))}
            </div>
            {!t.bothPublished ? (
              <p className="text-sm text-slate-500">দুটো পোস্টই প্রকাশিত হলে এখানে তুলনা দেখা যাবে।</p>
            ) : null}
            {t.closeCall === true ? (
              <p className="text-sm text-slate-600">দুটির ফল কাছাকাছি — পার্থক্য সামান্য, সংখ্যা দুটোই উপরে দেওয়া আছে।</p>
            ) : null}
          </div>
        ))}
      </div>

</>
  );
}
