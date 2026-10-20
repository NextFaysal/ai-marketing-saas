"use client";
import React from "react";
import type { SocialPageCtx } from "./shared";
import { PLATFORM_LABELS, AccountStatusPill, HealthPill, AccountAvatar, PlatformDot } from "./shared";
import { AUTO_DRAFT_TOGGLES, autoDraftToggleLabel } from "@/lib/social-posts-su5";
import { fmtDateTime, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";

/**
 * SU11 — accounts strip + approval setting + Commerce Auto-Draft settings (Settings & Accounts tab). Pure move from the former single-file page:
 * all state stays in page.tsx and arrives through the page
 * context prop `c` (every panel stays mounted, so no state is
 * lost on tab switches).
 *
 * SD7 — presentation only: account card v2 (large SD1 avatar +
 * platform chip, status + health pills and last-checked time from
 * the SAME accountHealth rows the health section below renders,
 * verbatim account errors in an alert block, disconnect moved into
 * a separated red danger zone), every settings group on a
 * .soc-section-card with one toggle shape, health rows gain the
 * avatar/chip identity, failure groups become ring cards with a
 * clear retry button. No handler, state or label changed. There is
 * no per-account reconnect handler in the page — reconnecting runs
 * through the connect buttons in the accounts header, as before.
 */

/** SD7: the platform chip — PlatformDot + the same PLATFORM_LABELS
 * text the old slate spans showed (same pattern as PostsPanel). */
function PlatformChip({ platform }: { platform?: string | null }) {
  if (!platform) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
      <PlatformDot platform={platform} />
      {PLATFORM_LABELS[platform] ?? platform}
    </span>
  );
}

/** SD7: one toggle shape for every settings switch in this panel. */
const TOGGLE_CLS = "h-4 w-4 shrink-0 accent-[var(--brand-from)]";

export function SettingsPanel({ c }: { c: SocialPageCtx }) {
  const { t, locale } = useLocale();
  const { accounts, autoDraftForm, autoDraftLoaded, busy, connectOAuth, connectSelectedPages, disconnectAccount, discoverPages, discovered, inputCls, metaToken, metaAppSource, setMetaAppSource, onTokenChange, pageSelected, platformModes, requireApproval, requireApprovalLoaded, saveApprovalSetting, saveAutoDraftSettings, selectYouTubeChannel, setAutoDraftForm, setPageSelected, setShowConnect, setYoutubePick, showConnect, youtubePick, approvalTwoStep, saveApprovalTwoStep, accountHealth, failureGroups, checkAccountHealth, retryFailedPost, posts, requireClientApproval, saveRequireClientApproval, telegramTokenInput, setTelegramTokenInput, telegramChannelInput, setTelegramChannelInput, showTelegramConnect, setShowTelegramConnect, connectTelegram, gbpPick, setGbpPick, selectGoogleBusinessLocation, } = c;
  return (
<>
      {/* Accounts strip — SD7: section card */}
      <div className="soc-section-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">{t("social.stConnectedAccounts", { count: fmtNumber(locale, accounts.length) })}</div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => setShowConnect((s) => !s)}>
              {t("social.stConnectMeta")}
            </button>
            <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== "" || platformModes?.tiktok.configured === false}
              title={platformModes && !platformModes.tiktok.configured ? t("social.stNotConfigured", { app: "TikTok" }) : undefined}
              onClick={() => connectOAuth("tiktok")}>
              {busy === "connect-tiktok" ? t("social.stGoingTiktok") : t("social.stConnectTiktok")}
            </button>
            <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== "" || platformModes?.youtube.configured === false}
              title={platformModes && !platformModes.youtube.configured ? t("social.stNotConfigured", { app: "Google" }) : undefined}
              onClick={() => connectOAuth("youtube")}>
              {busy === "connect-youtube" ? t("social.stGoingGoogle") : t("social.stConnectYoutube")}
            </button>
            <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => setShowTelegramConnect((s) => !s)}>
              {t("social.stConnectTelegram")}
            </button>
            <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== "" || platformModes?.threads?.configured === false}
              title={platformModes && !platformModes.threads?.configured ? t("social.stNotConfigured", { app: "Threads" }) : undefined}
              onClick={() => connectOAuth("threads")}>
              {busy === "connect-threads" ? t("social.stGoingThreads") : t("social.stConnectThreads")}
            </button>
            <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== "" || platformModes?.googleBusinessProfile?.configured === false}
              title={platformModes && !platformModes.googleBusinessProfile?.configured ? t("social.stNotConfigured", { app: "Google" }) : undefined}
              onClick={() => connectOAuth("google_business_profile")}>
              {busy === "connect-google_business_profile" ? t("social.stGoingGoogle") : t("social.stConnectGbp")}
            </button>
          </div>
        </div>
        {showTelegramConnect ? (
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <div className="text-sm font-semibold">{t("social.stTelegramTitle")}</div>
            <ol className="list-decimal space-y-1 pl-5 text-xs text-slate-500">
              <li>{t("social.stTelegramStep1")}</li>
              <li>{t("social.stTelegramStep2")}</li>
              <li>{t("social.stTelegramStep3")}</li>
            </ol>
            <p className="text-xs text-slate-400">{t("social.stTelegramVerifyNote")}</p>
            <form
              onSubmit={(e) => { e.preventDefault(); void connectTelegram(); }}
              className="flex flex-wrap items-end gap-2"
            >
              <label className="block min-w-[220px] flex-1 text-sm">{t("social.stBotToken")}
                <input type="password" className={inputCls} value={telegramTokenInput} onChange={(e) => setTelegramTokenInput(e.target.value)} placeholder="123456789:AA…" autoComplete="off" />
              </label>
              <label className="block min-w-[180px] text-sm">Channel Username / Chat ID
                <input type="text" className={inputCls} value={telegramChannelInput} onChange={(e) => setTelegramChannelInput(e.target.value)} placeholder="@mychannel" autoComplete="off" />
              </label>
              <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>
                {busy === "connect-telegram" ? t("social.stVerifying") : t("social.stVerifyConnect")}
              </button>
            </form>
          </div>
        ) : null}
        {platformModes && (!platformModes.tiktok.configured || !platformModes.youtube.configured || !platformModes.threads?.configured) ? (
          <p className="text-xs text-slate-400">
            {!platformModes.tiktok.configured ? t("social.stTiktokNotConfigured") : null}
            {!platformModes.youtube.configured ? t("social.stYoutubeNotConfigured") : null}
            {!platformModes.threads?.configured ? t("social.stThreadsNotConfigured") : null}
          </p>
        ) : null}
        {platformModes?.googleBusinessProfile && !platformModes.googleBusinessProfile.apiAccessApproved ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
            {t("social.stGbpNote")}
          </p>
        ) : null}
        {youtubePick ? (
          <div className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3">
            <div className="text-sm font-semibold text-indigo-900">{t("social.stYtPickTitle")}</div>
            <p className="text-xs text-indigo-700">{t("social.stYtPickDesc")}</p>
            {youtubePick.channels.length === 0 ? (
              <>
                <p className="text-xs text-indigo-700">{t("social.stChannelLoading")}</p>
                {/* SD8: skeleton rows on the picker's EXISTING loading
                    display (empty channel list renders the loading
                    text above) — no new loading state. */}
                <div className="space-y-2" aria-hidden="true">
                  <div className="soc-skeleton h-14 w-full" />
                  <div className="soc-skeleton h-14 w-full" />
                </div>
              </>
            ) : youtubePick.channels.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-lg bg-white p-2.5">
                <AccountAvatar name={c.title} pictureUrl={c.pictureUrl} platform="youtube" size="lg" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.title}</span>
                <button className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => selectYouTubeChannel(c.id)}>
                  {busy === `yt-pick-${c.id}` ? t("social.stConnecting") : t("social.stConnectThisChannel")}
                </button>
              </div>
            ))}
            <button className="text-xs font-semibold text-slate-500 underline" disabled={busy !== ""} onClick={() => setYoutubePick(null)}>{t("social.stCancel")}</button>
          </div>
        ) : null}
        {gbpPick ? (
          <div className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3">
            <div className="text-sm font-semibold text-indigo-900">{t("social.stGbpPickTitle")}</div>
            <p className="text-xs text-indigo-700">{t("social.stGbpPickDesc")}</p>
            {gbpPick.locations.length === 0 ? (
              <p className="text-xs text-indigo-700">{t("social.stLocationLoading")}</p>
            ) : gbpPick.locations.map((l) => (
              <div key={l.id} className="flex items-center gap-3 rounded-lg bg-white p-2.5">
                <AccountAvatar name={l.title} platform="google_business_profile" size="lg" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{l.title}{l.accountLabel ? <span className="text-xs text-slate-400"> — {l.accountLabel}</span> : null}</span>
                <button className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => selectGoogleBusinessLocation(l.id)}>
                  {busy === `gbp-pick-${l.id}` ? t("social.stConnecting") : t("social.stConnectThisLocation")}
                </button>
              </div>
            ))}
            <button className="text-xs font-semibold text-slate-500 underline" disabled={busy !== ""} onClick={() => setGbpPick(null)}>{t("social.stCancel")}</button>
          </div>
        ) : null}
        {accounts.length === 0 ? (
          <div className="soc-empty">
            <span className="soc-empty-icon">🔗</span>
            <p className="text-sm text-slate-500">{t("social.stNoAccounts")}</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {accounts.map((a) => {
              const health = accountHealth.find((h) => h.id === a.id);
              return (
              <div key={a.id} className="flex items-start gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200/50">
                <AccountAvatar name={a.name} pictureUrl={a.pictureUrl} platform={a.platform} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate font-medium">{a.name}</span>
                    <PlatformChip platform={a.platform} />
                    <AccountStatusPill status={a.status} />
                    {health ? <HealthPill health={health.health} /> : null}
                  </div>
                  {health?.healthCheckedAt ? <div className="mt-0.5 text-[11px] text-slate-400">{t("social.stLastChecked", { date: fmtDateTime(locale, health.healthCheckedAt) })}</div> : null}
                  {(a.platform === "instagram" || a.platform === "telegram" || a.platform === "threads") && a.username ? <div className="text-xs text-slate-500">@{a.username}</div> : null}
                  {a.platform === "tiktok" ? (
                    <div className="mt-1 text-xs text-slate-500">
                      {platformModes?.tiktok.audited
                        ? t("social.stTiktokDirect")
                        : t("social.stTiktokInbox")}
                    </div>
                  ) : null}
                  {a.platform === "youtube" ? (
                    <div className="mt-1 text-xs text-slate-500">
                      {t("social.stYoutubeNote")}
                    </div>
                  ) : null}
                  {a.platform === "telegram" ? (
                    <div className="mt-1 text-xs text-slate-500">
                      {t("social.stTelegramNote")}
                    </div>
                  ) : null}
                  {a.platform === "threads" ? (
                    <div className="mt-1 text-xs text-slate-500">
                      {t("social.stThreadsNote")}
                    </div>
                  ) : null}
                  {a.platform === "google_business_profile" ? (
                    <div className="mt-1 text-xs text-slate-500">
                      {t("social.stGbpAccountNote")}{platformModes?.googleBusinessProfile && !platformModes.googleBusinessProfile.apiAccessApproved ? t("social.stGbpNotApprovedSuffix") : ""}{t("social.stGbpNoteEnd")}
                    </div>
                  ) : null}
                  {a.lastError ? (
                    <div className="alert alert-red mt-2">
                      <span className="min-w-0 break-words">{a.lastError}</span>
                    </div>
                  ) : null}
                  {a.status === "connected" ? (
                    <div className="mt-3 rounded-lg bg-red-50/60 px-2.5 py-2 ring-1 ring-inset ring-red-100">
                      <button className="rounded-lg border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => disconnectAccount(a)}>
                        {busy === `disconnect-${a.id}` ? t("social.stDisconnecting") : t("social.stDisconnect")}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
              );
            })}
          </div>
        )}

        {showConnect ? (
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <form onSubmit={discoverPages} className="flex flex-wrap items-end gap-2">
              <label className="block min-w-0 flex-1 text-sm">{t("social.stMetaTokenLabel")}
                <input type="password" className={inputCls} value={metaToken} onChange={(e) => onTokenChange(e.target.value)} placeholder={t("social.stTokenPlaceholder")} autoComplete="off" />
              </label>
              <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>
                {busy === "discover" ? t("social.stSearching") : t("social.stFindPages")}
              </button>
            </form>
            <label className="block text-sm">{t("social.stTokenAppLabel")}
              <select className={inputCls} value={metaAppSource} onChange={(e) => setMetaAppSource(e.target.value as "platform" | "own")}>
                <option value="platform">{t("social.stTokenPlatform")}</option>
                <option value="own">{t("social.stTokenOwn")}</option>
              </select>
            </label>
            <p className="text-xs text-slate-400">{t("social.stTokenNote")}</p>
            {discovered ? (
              discovered.length === 0 ? (
                <div className="soc-empty-sm">
                  <p className="text-sm text-slate-500">{t("social.stNoPages")}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {discovered.map((p) => (
                    <div key={p.pageId} className="rounded-xl bg-slate-50 px-3 py-2.5">
                      <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                        <input type="checkbox" checked={pageSelected[p.pageId] ?? false} onChange={(e) => setPageSelected((s) => ({ ...s, [p.pageId]: e.target.checked }))} />
                        {p.pictureUrl ? <img src={p.pictureUrl} alt="" className="h-8 w-8 rounded-full object-cover" /> : null}
                        <span className="font-medium">{p.name}</span>
                        <span className="inline-flex items-center gap-1.5 rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-600"><PlatformDot platform="meta_page" />Facebook Page</span>
                        {p.alreadyConnectedPage ? <span className="rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-medium text-green-700">{t("social.stAlreadyConnected")}</span> : null}
                      </label>
                      <div className="ml-7 mt-1.5 border-l-2 border-slate-200 pl-3 text-sm">
                        {p.instagram ? (
                          <span className="flex flex-wrap items-center gap-2">
                            {p.instagram.pictureUrl ? <img src={p.instagram.pictureUrl} alt="" className="h-6 w-6 rounded-full object-cover" /> : null}
                            <span>Instagram{p.instagram.username ? ` — @${p.instagram.username}` : ""}</span>
                            {p.alreadyConnectedInstagram ? <span className="rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-medium text-green-700">{t("social.stAlreadyConnected")}</span> : null}
                          </span>
                        ) : (
                          <span className="text-slate-400">{t("social.stInstagramNone")}</span>
                        )}
                      </div>
                    </div>
                  ))}
                  <button className="btn-primary disabled:opacity-50" disabled={busy !== ""} onClick={connectSelectedPages}>
                    {busy === "connect" ? t("social.stConnecting") : t("social.stConnectPages")}
                  </button>
                </div>
              )
            ) : null}
          </div>
        ) : null}
      </div>

      {/* SP7 approval setting — SD7: section card, one toggle shape */}
      <div className="soc-section-card">
        <div className="font-semibold">{t("social.stApprovalTitle")}</div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className={TOGGLE_CLS} checked={requireApproval} disabled={busy !== "" || !requireApprovalLoaded}
            onChange={(e) => saveApprovalSetting(e.target.checked)} />
          <span>{t("social.stApprovalRequired")}</span>
          {busy === "approval-setting" ? <span className="text-xs text-slate-400">{t("social.stSaving")}</span> : null}
        </label>
        <p className="text-xs text-slate-500">{t("social.stApprovalHelp")}</p>
        {/* SU9: optional second step — Manager first, then Owner. */}
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className={TOGGLE_CLS} checked={approvalTwoStep} disabled={busy !== "" || !requireApprovalLoaded}
            onChange={(e) => saveApprovalTwoStep(e.target.checked)} />
          <span>{t("social.stTwoStep")}</span>
          {busy === "approval-two-step" ? <span className="text-xs text-slate-400">{t("social.stSaving")}</span> : null}
        </label>
        <p className="text-xs text-slate-500">{t("social.stTwoStepHelp")}</p>
        {/* SN2: optional third gate — the client's own sign-off via share link. */}
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className={TOGGLE_CLS} checked={requireClientApproval} disabled={busy !== "" || !requireApprovalLoaded}
            onChange={(e) => saveRequireClientApproval(e.target.checked)} />
          <span>{t("social.stClientApproval")}</span>
          {busy === "client-approval-requirement" ? <span className="text-xs text-slate-400">{t("social.stSaving")}</span> : null}
        </label>
        <p className="text-xs text-slate-500">{t("social.stClientApprovalHelp")}</p>
      </div>

      {/* SU5: Commerce Auto-Draft settings — SD7: section card */}
      <div className="soc-section-card">
        <div className="font-semibold">🤖 Commerce Auto-Draft</div>
        <p className="text-xs text-slate-500">{t("social.stAutoDraftHelp")}</p>
        <div className="space-y-2">
          {AUTO_DRAFT_TOGGLES.map((tg) => (
            <label key={tg.key} className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className={TOGGLE_CLS} checked={autoDraftForm[tg.key]} disabled={busy !== "" || !autoDraftLoaded}
                onChange={(e) => setAutoDraftForm((f) => ({ ...f, [tg.key]: e.target.checked }))} />
              <span>{autoDraftToggleLabel(tg.key, locale)}</span>
            </label>
          ))}
        </div>
        {/* SN8: the RSS/Atom feed the syndication sweep reads. */}
        <label className="block text-sm">RSS Feed URL
          <input type="text" className={inputCls} value={autoDraftForm.rssFeedUrl} disabled={busy !== "" || !autoDraftLoaded}
            onChange={(e) => setAutoDraftForm((f) => ({ ...f, rssFeedUrl: e.target.value }))}
            placeholder="https://example.com/feed.xml" />
        </label>
        <p className="text-xs text-slate-500">{t("social.stSyndicationNote")}</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-sm">{t("social.stDailyCap")}
            <input type="number" min={1} max={20} className="input mt-1 w-28" value={autoDraftForm.maxDraftsPerDay}
              disabled={busy !== "" || !autoDraftLoaded}
              onChange={(e) => setAutoDraftForm((f) => ({ ...f, maxDraftsPerDay: Number(e.target.value) }))} />
          </label>
          <label className="block min-w-[220px] flex-1 text-sm">{t("social.stDraftAccount")}
            <select className={inputCls} value={autoDraftForm.socialAccountId} disabled={busy !== "" || !autoDraftLoaded}
              onChange={(e) => setAutoDraftForm((f) => ({ ...f, socialAccountId: e.target.value }))}>
              <option value="">{t("social.stFirstFbPage")}</option>
              {accounts.filter((a) => a.platform === "meta_page").map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({PLATFORM_LABELS[a.platform] ?? a.platform})</option>
              ))}
            </select>
          </label>
          <button type="button" className="btn-primary disabled:opacity-50" disabled={busy !== "" || !autoDraftLoaded} onClick={saveAutoDraftSettings}>
            {busy === "auto-draft-settings" ? t("social.stSaving") : t("social.stSave")}
          </button>
        </div>
      </div>

      {/* SU10: Health & Failures center — SD7: section card, avatar
          identity on health rows, failure groups as ring cards */}
      <div className="soc-section-card">
        <div className="font-semibold">{t("social.stHealthTitle")}</div>
        <div className="space-y-2">
          <div className="text-sm font-medium">{t("social.stAccountHealth")}</div>
          {accountHealth.length === 0 ? (
            <div className="soc-empty-sm">
              <p className="text-sm text-slate-500">{t("social.stNoHealth")}</p>
            </div>
          ) : accountHealth.map((h) => {
            const acc = accounts.find((a) => a.id === h.id);
            return (
              <div key={h.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-sm ring-1 ring-inset ring-slate-200/50">
                <AccountAvatar name={h.name} pictureUrl={acc?.pictureUrl} platform={h.platform} />
                <span className="font-medium">{h.name}</span>
                <PlatformChip platform={h.platform} />
                <HealthPill health={h.health} />
                {h.healthCheckedAt ? <span className="text-[11px] text-slate-400">{t("social.stLastChecked", { date: fmtDateTime(locale, h.healthCheckedAt) })}</span> : null}
                {h.lastError ? <span className="min-w-0 flex-1 break-words text-xs text-red-600">{h.lastError}</span> : null}
                {acc ? (
                  <button type="button" className="btn-secondary btn-sm ml-auto disabled:opacity-50" disabled={busy !== ""} onClick={() => checkAccountHealth(acc)}>
                    {busy === `health-${h.id}` ? t("social.stChecking") : t("social.stCheckHealth")}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <div className="text-sm font-medium">{t("social.stFailureCenter")}</div>
          {failureGroups.length === 0 ? (
            <div className="soc-empty-sm">
              <p className="text-sm text-slate-500">{t("social.stNoFailures")}</p>
            </div>
          ) : failureGroups.map((g) => (
            <div key={g.signature} className="space-y-1.5 rounded-xl bg-red-50/60 px-3 py-2.5 ring-1 ring-inset ring-red-100">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 break-words font-medium text-red-800">{g.signature}</span>
                <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700">{t("social.stFailedPosts", { count: fmtNumber(locale, g.count) })}</span>
                <span className="text-[11px] text-slate-400">{t("social.stLatest", { date: fmtDateTime(locale, g.latestAt) })}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {g.postIds.map((postId) => {
                  const p = posts.find((x) => x.id === postId);
                  return (
                    <span key={postId} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2 py-1 text-xs text-slate-600 ring-1 ring-inset ring-red-100">
                      <span className="max-w-[220px] truncate" title={p?.caption ?? postId}>{p?.caption || t("social.stNoCaption")}</span>
                      <button type="button" className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-200 transition hover:bg-red-100 disabled:opacity-50" disabled={busy !== ""} onClick={() => retryFailedPost(postId)}>
                        {busy === `retry-${postId}` ? t("social.stRetrying") : "↻ Retry"}
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

</>
  );
}
