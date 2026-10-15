"use client";
import React from "react";
import type { SocialPageCtx } from "./shared";
import { PLATFORM_LABELS, AccountStatusPill, HealthPill, AccountAvatar, PlatformDot } from "./shared";
import { AUTO_DRAFT_TOGGLES } from "@/lib/social-posts-su5";

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
  const { accounts, autoDraftForm, autoDraftLoaded, busy, connectOAuth, connectSelectedPages, disconnectAccount, discoverPages, discovered, inputCls, metaToken, metaAppSource, setMetaAppSource, onTokenChange, pageSelected, platformModes, requireApproval, requireApprovalLoaded, saveApprovalSetting, saveAutoDraftSettings, selectYouTubeChannel, setAutoDraftForm, setPageSelected, setShowConnect, setYoutubePick, showConnect, youtubePick, approvalTwoStep, saveApprovalTwoStep, accountHealth, failureGroups, checkAccountHealth, retryFailedPost, posts, requireClientApproval, saveRequireClientApproval, telegramTokenInput, setTelegramTokenInput, telegramChannelInput, setTelegramChannelInput, showTelegramConnect, setShowTelegramConnect, connectTelegram, } = c;
  return (
<>
      {/* Accounts strip — SD7: section card */}
      <div className="soc-section-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">সংযুক্ত অ্যাকাউন্ট ({accounts.length})</div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => setShowConnect((s) => !s)}>
              Meta অ্যাকাউন্ট যুক্ত করুন
            </button>
            <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== "" || platformModes?.tiktok.configured === false}
              title={platformModes && !platformModes.tiktok.configured ? "TikTok app এখনো configure করা হয়নি — Platform Operator-এর সাথে যোগাযোগ করুন।" : undefined}
              onClick={() => connectOAuth("tiktok")}>
              {busy === "connect-tiktok" ? "TikTok-এ যাচ্ছে..." : "🎵 TikTok যুক্ত করুন"}
            </button>
            <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== "" || platformModes?.youtube.configured === false}
              title={platformModes && !platformModes.youtube.configured ? "Google app এখনো configure করা হয়নি — Platform Operator-এর সাথে যোগাযোগ করুন।" : undefined}
              onClick={() => connectOAuth("youtube")}>
              {busy === "connect-youtube" ? "Google-এ যাচ্ছে..." : "▶️ YouTube যুক্ত করুন"}
            </button>
            <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => setShowTelegramConnect((s) => !s)}>
              ✈️ Telegram Channel যুক্ত করুন
            </button>
            <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== "" || platformModes?.threads?.configured === false}
              title={platformModes && !platformModes.threads?.configured ? "Threads app এখনো configure করা হয়নি — Platform Operator-এর সাথে যোগাযোগ করুন।" : undefined}
              onClick={() => connectOAuth("threads")}>
              {busy === "connect-threads" ? "Threads-এ যাচ্ছে..." : "🧵 Threads যুক্ত করুন"}
            </button>
          </div>
        </div>
        {showTelegramConnect ? (
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <div className="text-sm font-semibold">✈️ Telegram Channel যুক্ত করুন (নিজের Bot দিয়ে)</div>
            <ol className="list-decimal space-y-1 pl-5 text-xs text-slate-500">
              <li>Telegram-এ <strong>@BotFather</strong>-এ গিয়ে একটি Bot বানান — সেখান থেকে পাওয়া <strong>Bot Token</strong>টি নিচে দিন।</li>
              <li>আপনার Channel-এর Settings → Administrators-এ এই Bot-টিকে <strong>Admin</strong> করুন (Post Messages অনুমতিসহ)।</li>
              <li>Channel-এর Username (@সহ) দিন — Private Channel হলে numeric Chat ID দিন।</li>
            </ol>
            <p className="text-xs text-slate-400">যুক্ত করার আগে যাচাই করা হয়: Bot Token ঠিক আছে কিনা, Channel পাওয়া যাচ্ছে কিনা, আর Bot-টি Channel-এর Admin কিনা। যেকোনো ধাপ ব্যর্থ হলে Telegram-এর নিজের বার্তাসহ কারণ দেখানো হবে এবং কিছুই সেভ হবে না। Tokenটি encrypted অবস্থায় সেভ থাকে — কখনো দেখানো হয় না।</p>
            <form
              onSubmit={(e) => { e.preventDefault(); void connectTelegram(); }}
              className="flex flex-wrap items-end gap-2"
            >
              <label className="block min-w-[220px] flex-1 text-sm">Bot Token (BotFather থেকে)
                <input type="password" className={inputCls} value={telegramTokenInput} onChange={(e) => setTelegramTokenInput(e.target.value)} placeholder="123456789:AA…" autoComplete="off" />
              </label>
              <label className="block min-w-[180px] text-sm">Channel Username / Chat ID
                <input type="text" className={inputCls} value={telegramChannelInput} onChange={(e) => setTelegramChannelInput(e.target.value)} placeholder="@mychannel" autoComplete="off" />
              </label>
              <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>
                {busy === "connect-telegram" ? "যাচাই করে যুক্ত হচ্ছে..." : "যাচাই করে যুক্ত করুন"}
              </button>
            </form>
          </div>
        ) : null}
        {platformModes && (!platformModes.tiktok.configured || !platformModes.youtube.configured || !platformModes.threads?.configured) ? (
          <p className="text-xs text-slate-400">
            {!platformModes.tiktok.configured ? "TikTok: Operator এখনো TikTok app configure করেননি — Connect করা যাচ্ছে না। " : null}
            {!platformModes.youtube.configured ? "YouTube: Operator এখনো Google app configure করেননি — Connect করা যাচ্ছে না।" : null}
            {!platformModes.threads?.configured ? "Threads: Operator এখনো Threads app configure করেননি — প্ল্যাটফর্ম app দিয়ে Connect করা যাচ্ছে না (নিজের Threads app দিয়ে করা যায়: কানেক্ট সেন্টার → নিজের অ্যাপ)।" : null}
          </p>
        ) : null}
        {youtubePick ? (
          <div className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3">
            <div className="text-sm font-semibold text-indigo-900">▶️ কোন YouTube Channelটি যুক্ত করবেন?</div>
            <p className="text-xs text-indigo-700">আপনার Google অ্যাকাউন্টে একাধিক Channel আছে — যেটিতে ভিডিও আপলোড হবে সেটি বেছে নিন। (এই পছন্দের লিংকটি ১০ মিনিটের মধ্যে মেয়াদোত্তীর্ণ হবে।)</p>
            {youtubePick.channels.length === 0 ? (
              <>
                <p className="text-xs text-indigo-700">Channel তালিকা লোড হচ্ছে…</p>
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
                  {busy === `yt-pick-${c.id}` ? "যুক্ত হচ্ছে..." : "এই Channel যুক্ত করুন"}
                </button>
              </div>
            ))}
            <button className="text-xs font-semibold text-slate-500 underline" disabled={busy !== ""} onClick={() => setYoutubePick(null)}>বাতিল করুন</button>
          </div>
        ) : null}
        {accounts.length === 0 ? (
          <div className="soc-empty">
            <span className="soc-empty-icon">🔗</span>
            <p className="text-sm text-slate-500">এখনো কোনো Social অ্যাকাউন্ট যুক্ত নেই। উপরের বোতামে Meta Access Token দিয়ে Facebook Page যুক্ত করুন — Page-এর সাথে Instagram থাকলে সেটিও যুক্ত হবে।</p>
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
                  {health?.healthCheckedAt ? <div className="mt-0.5 text-[11px] text-slate-400">শেষ যাচাই: {new Date(health.healthCheckedAt).toLocaleString("bn-BD")}</div> : null}
                  {(a.platform === "instagram" || a.platform === "telegram" || a.platform === "threads") && a.username ? <div className="text-xs text-slate-500">@{a.username}</div> : null}
                  {a.platform === "tiktok" ? (
                    <div className="mt-1 text-xs text-slate-500">
                      {platformModes?.tiktok.audited
                        ? "Direct post mode — app audit সম্পন্ন, পোস্ট সরাসরি প্রকাশিত হয়।"
                        : "Inbox mode — audit বাকি: নির্ধারিত সময়ে ভিডিও Creator-এর TikTok inbox-এ পৌঁছাবে, তাকে app থেকে post সম্পূর্ণ করতে হবে।"}
                    </div>
                  ) : null}
                  {a.platform === "youtube" ? (
                    <div className="mt-1 text-xs text-slate-500">
                      আপলোড YouTube-এ <strong>Private</strong> হিসেবে যায় — Google app যাচাই সম্পন্ন হলে Public করা যাবে। ভিডিও Channel-এর YouTube Studio-তে দেখা যাবে।
                    </div>
                  ) : null}
                  {a.platform === "telegram" ? (
                    <div className="mt-1 text-xs text-slate-500">
                      পোস্ট Bot-এর মাধ্যমে Channel-এ যায় — Bot-টির Admin মর্যাদা তুলে নিলে প্রকাশ ব্যর্থ হবে (Telegram-এর বার্তাই দেখানো হবে)। সৎ সীমা: Telegram Bot API পোস্টের Views/Engagement দেয় না, তাই এই অ্যাকাউন্টের Insights পাওয়া যায় না।
                    </div>
                  ) : null}
                  {a.platform === "threads" ? (
                    <div className="mt-1 text-xs text-slate-500">
                      পোস্ট Threads-এ সরাসরি প্রকাশিত হয় (Container flow)। সৎ সীমা: প্রোডাকশনে প্রকাশের জন্য Operator-এর Threads app-এ Meta-র App Review (Advanced Access) লাগতে পারে — না থাকলে Meta শুধু app-role থাকা অ্যাকাউন্টে অনুমতি দেয়, আর প্রত্যাখ্যান এলে Meta-র আসল বার্তাটাই দেখা যাবে।
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
                        {busy === `disconnect-${a.id}` ? "বিচ্ছিন্ন হচ্ছে..." : "বিচ্ছিন্ন করুন"}
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
              <label className="block min-w-0 flex-1 text-sm">Meta Access Token (Page পোস্টের অনুমতিসহ)
                <input type="password" className={inputCls} value={metaToken} onChange={(e) => onTokenChange(e.target.value)} placeholder="Token পেস্ট করুন" autoComplete="off" />
              </label>
              <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>
                {busy === "discover" ? "খোঁজা হচ্ছে..." : "🔍 Page খুঁজুন"}
              </button>
            </form>
            <label className="block text-sm">এই Tokenটি কোন অ্যাপের?
              <select className={inputCls} value={metaAppSource} onChange={(e) => setMetaAppSource(e.target.value as "platform" | "own")}>
                <option value="platform">প্ল্যাটফর্মের Meta অ্যাপের Token</option>
                <option value="own">আমার নিজের Meta অ্যাপের Token (Connect Center-এ আগে সেভ করা)</option>
              </select>
            </label>
            <p className="text-xs text-slate-400">Tokenটি শুধু যাচাই ও যুক্ত করার কাজে ব্যবহৃত হয়। একটি Page বেছে নিলে তার সাথে যুক্ত Instagram অ্যাকাউন্টটিও স্বয়ংক্রিয়ভাবে যুক্ত হবে। অ্যাপ-বাছাইটি অ্যাকাউন্টে সেভ থাকে — নিজের অ্যাপ বেছে নিলে পরের Token নবায়ন/হিলিং আপনার নিজের অ্যাপ দিয়েই হবে।</p>
            {discovered ? (
              discovered.length === 0 ? (
                <div className="soc-empty-sm">
                  <p className="text-sm text-slate-500">এই Token-এর অধীনে কোনো Page পাওয়া যায়নি।</p>
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
                        {p.alreadyConnectedPage ? <span className="rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-medium text-green-700">আগে থেকেই কানেক্টেড</span> : null}
                      </label>
                      <div className="ml-7 mt-1.5 border-l-2 border-slate-200 pl-3 text-sm">
                        {p.instagram ? (
                          <span className="flex flex-wrap items-center gap-2">
                            {p.instagram.pictureUrl ? <img src={p.instagram.pictureUrl} alt="" className="h-6 w-6 rounded-full object-cover" /> : null}
                            <span>Instagram{p.instagram.username ? ` — @${p.instagram.username}` : ""}</span>
                            {p.alreadyConnectedInstagram ? <span className="rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-medium text-green-700">আগে থেকেই কানেক্টেড</span> : null}
                          </span>
                        ) : (
                          <span className="text-slate-400">Instagram যুক্ত নেই</span>
                        )}
                      </div>
                    </div>
                  ))}
                  <button className="btn-primary disabled:opacity-50" disabled={busy !== ""} onClick={connectSelectedPages}>
                    {busy === "connect" ? "যুক্ত হচ্ছে..." : "বেছে নেওয়া Page যুক্ত করুন"}
                  </button>
                </div>
              )
            ) : null}
          </div>
        ) : null}
      </div>

      {/* SP7 approval setting — SD7: section card, one toggle shape */}
      <div className="soc-section-card">
        <div className="font-semibold">পোস্ট অনুমোদন ব্যবস্থা</div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className={TOGGLE_CLS} checked={requireApproval} disabled={busy !== "" || !requireApprovalLoaded}
            onChange={(e) => saveApprovalSetting(e.target.checked)} />
          <span>প্রকাশ / শিডিউলের আগে অনুমোদন বাধ্যতামূলক</span>
          {busy === "approval-setting" ? <span className="text-xs text-slate-400">সংরক্ষণ হচ্ছে...</span> : null}
        </label>
        <p className="text-xs text-slate-500">চালু থাকলে: যারা OWNER/ADMIN নন, তাদের পোস্ট প্রকাশ বা শিডিউলের আগে অনুমোদন লাগবে। OWNER/ADMIN-এর নিজের পোস্ট স্বয়ংক্রিয়ভাবে অনুমোদিত। প্রত্যাখ্যান করতে হলে কারণ লিখতে হবে।</p>
        {/* SU9: optional second step — Manager first, then Owner. */}
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className={TOGGLE_CLS} checked={approvalTwoStep} disabled={busy !== "" || !requireApprovalLoaded}
            onChange={(e) => saveApprovalTwoStep(e.target.checked)} />
          <span>দুই-ধাপের অনুমোদন (Manager → Owner)</span>
          {busy === "approval-two-step" ? <span className="text-xs text-slate-400">সংরক্ষণ হচ্ছে...</span> : null}
        </label>
        <p className="text-xs text-slate-500">চালু থাকলে অনুমোদন দুই ধাপে হয়: প্রথমে Manager ধাপের অনুমোদন, তারপর চূড়ান্ত অনুমোদন। বন্ধ থাকলে আগের এক-ধাপের নিয়মই থাকে।</p>
        {/* SN2: optional third gate — the client's own sign-off via share link. */}
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className={TOGGLE_CLS} checked={requireClientApproval} disabled={busy !== "" || !requireApprovalLoaded}
            onChange={(e) => saveRequireClientApproval(e.target.checked)} />
          <span>ক্লায়েন্ট অনুমোদন বাধ্যতামূলক (শেয়ার লিংক)</span>
          {busy === "client-approval-requirement" ? <span className="text-xs text-slate-400">সংরক্ষণ হচ্ছে...</span> : null}
        </label>
        <p className="text-xs text-slate-500">চালু থাকলে: শেয়ার লিংকে ক্লায়েন্টের সর্বশেষ সিদ্ধান্ত "অনুমোদিত" না হলে পোস্টটি publish/schedule হবে না — "ক্লায়েন্ট অনুমোদন বাকি" বলে আটকাবে। বন্ধ থাকলে ক্লায়েন্ট review শুধু রেকর্ড হিসেবে থাকে, কোনো gate নয়।</p>
      </div>

      {/* SU5: Commerce Auto-Draft settings — SD7: section card */}
      <div className="soc-section-card">
        <div className="font-semibold">🤖 Commerce Auto-Draft</div>
        <p className="text-xs text-slate-500">এগুলো শুধু draft তৈরি করে — publish হয় মানুষের অনুমোদনে।</p>
        <div className="space-y-2">
          {AUTO_DRAFT_TOGGLES.map((t) => (
            <label key={t.key} className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className={TOGGLE_CLS} checked={autoDraftForm[t.key]} disabled={busy !== "" || !autoDraftLoaded}
                onChange={(e) => setAutoDraftForm((f) => ({ ...f, [t.key]: e.target.checked }))} />
              <span>{t.label}</span>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-sm">প্রতিদিন সর্বোচ্চ draft সংখ্যা (১–২০)
            <input type="number" min={1} max={20} className="input mt-1 w-28" value={autoDraftForm.maxDraftsPerDay}
              disabled={busy !== "" || !autoDraftLoaded}
              onChange={(e) => setAutoDraftForm((f) => ({ ...f, maxDraftsPerDay: Number(e.target.value) }))} />
          </label>
          <label className="block min-w-[220px] flex-1 text-sm">কোন অ্যাকাউন্টে draft যাবে
            <select className={inputCls} value={autoDraftForm.socialAccountId} disabled={busy !== "" || !autoDraftLoaded}
              onChange={(e) => setAutoDraftForm((f) => ({ ...f, socialAccountId: e.target.value }))}>
              <option value="">প্রথম connected Facebook Page</option>
              {accounts.filter((a) => a.platform === "meta_page").map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({PLATFORM_LABELS[a.platform] ?? a.platform})</option>
              ))}
            </select>
          </label>
          <button type="button" className="btn-primary disabled:opacity-50" disabled={busy !== "" || !autoDraftLoaded} onClick={saveAutoDraftSettings}>
            {busy === "auto-draft-settings" ? "সংরক্ষণ হচ্ছে..." : "সংরক্ষণ করুন"}
          </button>
        </div>
      </div>

      {/* SU10: Health & Failures center — SD7: section card, avatar
          identity on health rows, failure groups as ring cards */}
      <div className="soc-section-card">
        <div className="font-semibold">🩺 অ্যাকাউন্টের স্বাস্থ্য ও ব্যর্থতা (Health & Failures)</div>
        <div className="space-y-2">
          <div className="text-sm font-medium">অ্যাকাউন্টের স্বাস্থ্য</div>
          {accountHealth.length === 0 ? (
            <div className="soc-empty-sm">
              <p className="text-sm text-slate-500">কোনো অ্যাকাউন্টের স্বাস্থ্য তথ্য পাওয়া যায়নি।</p>
            </div>
          ) : accountHealth.map((h) => {
            const acc = accounts.find((a) => a.id === h.id);
            return (
              <div key={h.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-sm ring-1 ring-inset ring-slate-200/50">
                <AccountAvatar name={h.name} pictureUrl={acc?.pictureUrl} platform={h.platform} />
                <span className="font-medium">{h.name}</span>
                <PlatformChip platform={h.platform} />
                <HealthPill health={h.health} />
                {h.healthCheckedAt ? <span className="text-[11px] text-slate-400">শেষ যাচাই: {new Date(h.healthCheckedAt).toLocaleString("bn-BD")}</span> : null}
                {h.lastError ? <span className="min-w-0 flex-1 break-words text-xs text-red-600">{h.lastError}</span> : null}
                {acc ? (
                  <button type="button" className="btn-secondary btn-sm ml-auto disabled:opacity-50" disabled={busy !== ""} onClick={() => checkAccountHealth(acc)}>
                    {busy === `health-${h.id}` ? "যাচাই হচ্ছে..." : "স্বাস্থ্য যাচাই"}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <div className="text-sm font-medium">ব্যর্থ পোস্ট (Failure Center)</div>
          {failureGroups.length === 0 ? (
            <div className="soc-empty-sm">
              <p className="text-sm text-slate-500">এখন কোনো ব্যর্থ পোস্ট নেই — সব পোস্ট ঠিকঠাক আছে।</p>
            </div>
          ) : failureGroups.map((g) => (
            <div key={g.signature} className="space-y-1.5 rounded-xl bg-red-50/60 px-3 py-2.5 ring-1 ring-inset ring-red-100">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 break-words font-medium text-red-800">{g.signature}</span>
                <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700">{g.count.toLocaleString("bn-BD")}টি পোস্ট</span>
                <span className="text-[11px] text-slate-400">সর্বশেষ: {new Date(g.latestAt).toLocaleString("bn-BD")}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {g.postIds.map((postId) => {
                  const p = posts.find((x) => x.id === postId);
                  return (
                    <span key={postId} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2 py-1 text-xs text-slate-600 ring-1 ring-inset ring-red-100">
                      <span className="max-w-[220px] truncate" title={p?.caption ?? postId}>{p?.caption || "(ক্যাপশন নেই)"}</span>
                      <button type="button" className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-200 transition hover:bg-red-100 disabled:opacity-50" disabled={busy !== ""} onClick={() => retryFailedPost(postId)}>
                        {busy === `retry-${postId}` ? "Retry হচ্ছে..." : "↻ Retry"}
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
