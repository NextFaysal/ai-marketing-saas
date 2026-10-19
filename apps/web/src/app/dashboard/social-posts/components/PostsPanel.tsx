"use client";
import React, { useState } from "react";
import type { SocialPageCtx } from "./shared";
import { PLATFORM_LABELS, POST_STATUS_META, MediaThumb, PostStatusPill, AccountAvatar, PlatformDot } from "./shared";
import { SHARE_LINK_STATUS_META, shareLinkStatus, shareLinkStatusLabel } from "@/lib/social-posts-sn";
import { orgDayKey, utcToLocalInput } from "@/lib/social-calendar";
import {
  BOARD_COLUMNS, boardActionLabel, boardColumnForPost, boardColumnLabel, boardDropAction, boardMenuActions, isCalendarDraggable,
  type BoardActionKind, type BoardColumnId,
} from "@/lib/social-board";
import { weekdayLabelBn } from "@/lib/social-composer";
import { EmptyState } from "@repo/ui";
import { fmtDateTime, fmtNumber, intlLocaleOf } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";

/**
 * SU11 — posting slots + approval queue + posts list/calendar/queue (Posts & Calendar tab). Pure move from the former single-file page:
 * all state stays in page.tsx and arrives through the page
 * context prop `c` (every panel stays mounted, so no state is
 * lost on tab switches).
 *
 * SD4 — presentation only: post card v2 (avatar/platform identity,
 * SD1 pills, prominent schedule/publish time, primary actions in
 * front, Clone/Derive/Link-stats inside the detail expander),
 * calendar v2 (brand today highlight, platform-dot chips, mobile
 * agenda list from the same calBuckets), queue as a timeline.
 * No handler, state or label changed.
 *
 * SD8 — presentation only: every remaining plain-text empty state
 * in this panel takes a designed surface (slots / approval queue /
 * filtered list / queue / mobile agenda → .soc-empty; the detail
 * expander's notes / versions / timeline → .soc-empty-sm), and the
 * bulk-select label + note-delete button join the 12px type floor.
 * Same texts, same handlers.
 */

/** SD4: the platform chip used across this panel — PlatformDot +
 * the same PLATFORM_LABELS text the old slate spans showed. */
function PlatformChip({ platform }: { platform?: string | null }) {
  if (!platform) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
      <PlatformDot platform={platform} />
      {PLATFORM_LABELS[platform] ?? platform}
    </span>
  );
}
export function PostsPanel({ c }: { c: SocialPageCtx }) {
  const { t, locale } = useLocale();
  const fmtTzTime = (iso: string) => new Intl.DateTimeFormat(intlLocaleOf(locale), { timeZone: orgTz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const { accounts, approvePost, busy, calBuckets, calCells, calMonthTitle, caption, connectedAccounts, createPostingSlot, deletePost, deletePostingSlot, error, filterAccountId, filterQuery, filterStatus, filteredPosts, fmtInTz, inputCls, linkUrl, orgTz, pendingApprovalPosts, postingSlots, posts, queuePosts, rejectNotes, rejectOpenId, rejectPost, relativeLabel, renderApprovalBadge, renderCloneButton, renderDeriveButton, renderDerivePanel, renderEvergreenControls, renderInsights, renderLinkStats, renderPostActions, renderSuBadges, renderSubmitApproval, selectedPost, setCalCursor, setFilterAccountId, setFilterQuery, setFilterStatus, setRejectNotes, setRejectOpenId, setSelectedPostId, setSlotAccountId, setSlotTime, setSlotWeekday, setViewMode, slotAccountId, slotTime, slotWeekday, startEdit, togglePostingSlot, viewMode, postsNextCursor, loadMorePosts, selectedPostIds, togglePostSelected, bulkRescheduleAt, setBulkRescheduleAt, runPostsBulk, detailOpenId, togglePostDetail, notesByPost, versionsByPost, timelineByPost, noteInputs, setNoteInputs, addPostNote, deletePostNote, restorePostVersion, assignPost, memberLabel, members, myUserId, shareLinksByPost, shareCreatedByPost, createShareLink, createGroupShareLink, revokeShareLink, submitApproval, doPublishNow, doCancelSchedule, doScheduleValue, reschedulePostToDay, requireApproval, repurposeScriptByPost, repurposeOutlineByPost, generateRepurposeScript, generateCarouselOutline, createCaptionTest, } = c;
  // SN2: which created share link was just copied (button feedback).
  const [copiedShareId, setCopiedShareId] = useState("");
  // SN3: board drag-over highlight, the schedule modal (post id +
  // datetime-local value), and the repurpose copy feedback. All
  // ephemeral UI state — the posts themselves never move locally;
  // a drop only calls the existing page handlers, and the server's
  // answer (via loadPosts inside them) decides where a card sits.
  const [boardDragOver, setBoardDragOver] = useState<BoardColumnId | null>(null);
  const [scheduleModal, setScheduleModal] = useState<{ postId: string; value: string } | null>(null);
  const [copiedRepurposeId, setCopiedRepurposeId] = useState("");
  const scheduleModalPost = scheduleModal ? posts.find((x) => x.id === scheduleModal.postId) ?? null : null;

  /** SN3: the next future occurrence of a posting slot as a
   * datetime-local value in the org timezone ("" when none of the
   * next 8 days yields a future slot time). */
  function nextSlotInputValue(slot: { weekday: number; time: string }): string {
    const now = new Date();
    const nowLocal = utcToLocalInput(now.toISOString(), orgTz);
    for (let add = 0; add < 8; add += 1) {
      const probe = new Date(now.getTime() + add * 86_400_000);
      const key = orgDayKey(probe.toISOString(), orgTz);
      if (new Date(`${key}T12:00:00Z`).getUTCDay() !== slot.weekday) continue;
      const value = `${key}T${slot.time}`;
      if (value > nowLocal) return value;
    }
    return "";
  }

  function runBoardAction(p: (typeof posts)[number], action: BoardActionKind) {
    if (action === "submit") void submitApproval(p);
    else if (action === "approve") void approvePost(p);
    else if (action === "publish") void doPublishNow(p);
    else if (action === "cancel-schedule") void doCancelSchedule(p);
    else if (action === "schedule") {
      setScheduleModal({ postId: p.id, value: p.scheduledAt ? utcToLocalInput(p.scheduledAt, orgTz) : "" });
    }
  }

  function handleBoardDrop(postId: string, target: BoardColumnId) {
    const p = posts.find((x) => x.id === postId);
    setBoardDragOver(null);
    if (!p) return;
    const r = boardDropAction(p, target, { requireApproval }, locale);
    if (r.kind === "noop") return;
    if (r.kind === "invalid") { c.setError(r.reason); return; }
    runBoardAction(p, r.kind);
  }
  return (
<>
      {/* SU2: posting slots (queue) */}
      <div className="card space-y-3 p-5">
        <div className="font-semibold">{t("social.ppSlotsTitle")}</div>
        <p className="text-xs text-slate-500">{t("social.ppSlotsNote", { tz: orgTz })}</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-[200px] flex-1 text-sm">{t("social.ppAccount")}
            <select className={inputCls} value={slotAccountId} onChange={(e) => setSlotAccountId(e.target.value)}>
              <option value="">{t("social.ppChooseAccount")}</option>
              {connectedAccounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({PLATFORM_LABELS[a.platform] ?? a.platform})</option>)}
            </select>
          </label>
          <label className="block text-sm">{t("social.ppDay")}
            <select className={inputCls} value={slotWeekday} onChange={(e) => setSlotWeekday(Number(e.target.value))}>
              {[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{weekdayLabelBn(d, locale)}</option>)}
            </select>
          </label>
          <label className="block text-sm">{t("social.ppTime")}
            <input type="time" className={inputCls} value={slotTime} onChange={(e) => setSlotTime(e.target.value)} />
          </label>
          <button type="button" className="btn-primary disabled:opacity-50" disabled={busy !== ""} onClick={createPostingSlot}>
            {busy === "slot-create" ? t("social.ppAdding") : t("social.ppAddSlot")}
          </button>
        </div>
        {postingSlots.length === 0 ? (
          <div className="soc-empty">
            <span className="soc-empty-icon">🗓️</span>
            <p className="text-sm text-slate-500">{t("social.ppNoSlots")}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {postingSlots.map((slot) => {
              const acc = accounts.find((a) => a.id === slot.socialAccountId);
              return (
                <div key={slot.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
                  {acc ? <AccountAvatar name={acc.name} platform={acc.platform} pictureUrl={acc.pictureUrl} /> : null}
                  <span className="font-medium">{acc?.name ?? slot.socialAccountId}</span>
                  {acc ? <PlatformChip platform={acc.platform} /> : null}
                  <span>{weekdayLabelBn(slot.weekday, locale)}</span>
                  <span className="text-slate-500">{slot.time}</span>
                  <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
                    <input type="checkbox" checked={slot.enabled} disabled={busy !== ""} onChange={(e) => togglePostingSlot(slot, e.target.checked)} />
                    {slot.enabled ? t("social.ppOn") : t("social.ppOff")}
                  </label>
                  <button type="button" className="rounded-lg border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => deletePostingSlot(slot)}>
                    {busy === `slot-${slot.id}` ? t("social.ppDoing") : t("social.ppDelete")}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SP7 approval queue — SD4: amber section header band */}
      <div className="card space-y-3 p-5">
        <div className="rounded-lg bg-amber-50 px-3 py-2 font-semibold text-amber-800 ring-1 ring-inset ring-amber-200/60">{t("social.ppPendingApproval", { count: fmtNumber(locale, pendingApprovalPosts.length) })}</div>
        {pendingApprovalPosts.length === 0 ? (
          <div className="soc-empty">
            <span className="soc-empty-icon">⏳</span>
            <p className="text-sm text-slate-500">{t("social.ppNoPending")}</p>
          </div>
        ) : pendingApprovalPosts.map((p) => (
          <div key={p.id} className="space-y-2 rounded-xl bg-slate-50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <AccountAvatar name={p.account?.name ?? ""} platform={p.account?.platform ?? ""} />
              <span className="font-medium">{p.account?.name ?? ""}</span>
              <PlatformChip platform={p.account?.platform} />
              {p.account?.username ? <span className="text-xs text-slate-500">@{p.account.username}</span> : null}
              <span className="text-xs text-slate-400">{fmtDateTime(locale, p.createdAt)}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm text-slate-700 line-clamp-3">{p.caption || <span className="text-slate-400">{t("social.ppNoCaption")}</span>}</p>
            {p.mediaRefs.length > 0 ? <p className="text-xs text-slate-400">{t("social.ppMediaAttached", { count: fmtNumber(locale, p.mediaRefs.length) })}</p> : null}
            {rejectOpenId === p.id ? (
              <div className="space-y-2">
                <label className="block text-xs text-slate-500">{t("social.ppRejectReason")}
                  <textarea className="input mt-1" rows={2} value={rejectNotes[p.id] ?? ""}
                    onChange={(e) => setRejectNotes((s) => ({ ...s, [p.id]: e.target.value }))}
                    placeholder={t("social.ppRejectReasonPlaceholder")} />
                </label>
                {!(rejectNotes[p.id] ?? "").trim() ? (
                  <p className="text-xs text-red-600">{t("social.ppRejectReasonRequired")}</p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                    disabled={busy !== "" || !(rejectNotes[p.id] ?? "").trim()} onClick={() => rejectPost(p)}>
                    {busy === `reject-${p.id}` ? t("social.ppRejecting") : t("social.ppConfirmReject")}
                  </button>
                  <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => setRejectOpenId(null)}>{t("social.ppCancel")}</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50" disabled={busy !== ""} onClick={() => approvePost(p)}>
                  {busy === `approve-${p.id}` ? t("social.ppApproving") : t("social.ppApprove")}
                </button>
                <button type="button" className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => setRejectOpenId(p.id)}>
                  {t("social.ppReject")}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Posts list / calendar / queue (SP5) */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={viewMode === "list" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => setViewMode("list")}>{t("social.ppViewList")}</button>
          <button type="button" className={viewMode === "calendar" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => setViewMode("calendar")}>{t("social.ppViewCalendar")}</button>
          <button type="button" className={viewMode === "queue" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => setViewMode("queue")}>{t("social.ppViewQueue")}</button>
          <button type="button" className={viewMode === "board" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => setViewMode("board")}>{t("social.ppViewBoard")}</button>
          {viewMode !== "list" ? <span className="text-xs text-slate-400">{t("social.ppFilterListOnly")}</span> : null}
        </div>
        {viewMode === "list" ? (
          <>
        <div className="card space-y-3 p-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-500">{t("social.ppSearchLabel")}
              <input className="input mt-1 w-56" placeholder={t("social.ppSearchPlaceholder")} value={filterQuery} onChange={(e) => setFilterQuery(e.target.value)} />
            </label>
            <label className="text-xs text-slate-500">{t("social.ppStatus")}
              <select className="input mt-1" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="">{t("social.ppAll")}</option>
                <option value="draft">Draft</option>
                <option value="scheduled">Scheduled</option>
                <option value="published">Published</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
            <label className="text-xs text-slate-500">{t("social.ppAccount")}
              <select className="input mt-1" value={filterAccountId} onChange={(e) => setFilterAccountId(e.target.value)}>
                <option value="">{t("social.ppAllAccounts")}</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({PLATFORM_LABELS[a.platform] ?? a.platform})</option>)}
              </select>
            </label>
            <span className="pb-2 text-sm text-slate-500">{t("social.ppShowingCount", { shown: fmtNumber(locale, filteredPosts.length), total: fmtNumber(locale, posts.length) })}</span>
          </div>
        </div>

        {/* SU11: bulk bar — selection lives in page state */}
        {selectedPostIds.size > 0 ? (
          <div className="card flex flex-wrap items-end gap-2 p-4">
            <span className="pb-2 text-sm font-medium">{t("social.ppSelectedCount", { count: fmtNumber(locale, selectedPostIds.size) })}</span>
            <button type="button" className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => runPostsBulk("delete_drafts")}>
              {busy === "posts-bulk-delete_drafts" ? t("social.ppDeleting") : t("social.ppBulkDeleteDrafts")}
            </button>
            <label className="block text-xs text-slate-500">{t("social.ppNewScheduleTime", { tz: orgTz })}
              <input type="datetime-local" className="input mt-1" value={bulkRescheduleAt} onChange={(e) => setBulkRescheduleAt(e.target.value)} />
            </label>
            <button type="button" className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => runPostsBulk("reschedule")}>
              {busy === "posts-bulk-reschedule" ? t("social.ppRescheduling") : t("social.ppReschedule")}
            </button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => c.setSelectedPostIds(new Set())}>{t("social.ppClearSelection")}</button>
            <span className="pb-2 text-xs text-slate-400">{t("social.ppBulkNote")}</span>
          </div>
        ) : null}

        {posts.length === 0 ? (
          <EmptyState title={t("social.ppEmptyTitle")} description={t("social.ppEmptyDesc")} />
        ) : filteredPosts.length === 0 ? (
          <div className="soc-empty">
            <span className="soc-empty-icon">🔍</span>
            <p className="text-sm text-slate-500">{t("social.ppNoFilterMatch", { total: fmtNumber(locale, posts.length) })}</p>
          </div>
        ) : filteredPosts.map((p) => (
          <div key={p.id} className={`card p-5 ${selectedPostIds.has(p.id) ? "soc-selected" : ""}`}>
            <div className="flex flex-wrap items-start gap-3">
              <label className="flex shrink-0 cursor-pointer items-center gap-1 pt-1 text-xs text-slate-500">
                <input type="checkbox" className="h-4 w-4" checked={selectedPostIds.has(p.id)} onChange={() => togglePostSelected(p.id)} />
                {t("social.ppSelect")}
              </label>
              {p.mediaRefs[0] ? <MediaThumb assetId={p.mediaRefs[0].assetId} kind={p.mediaRefs[0].kind} className="h-16 w-16 shrink-0 rounded-lg object-cover" /> : null}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <AccountAvatar name={p.account?.name ?? ""} platform={p.account?.platform ?? ""} />
                  <span className="font-medium">{p.account?.name ?? ""}</span>
                  <PlatformChip platform={p.account?.platform} />
                  {p.account?.username ? <span className="text-xs text-slate-500">@{p.account.username}</span> : null}
                  <span className="ml-auto flex flex-wrap items-center gap-1.5">
                    <PostStatusPill status={p.status} />
                    {renderApprovalBadge(p)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {renderSuBadges(p)}
                  {/* SN10: a post already in a caption-test pair
                      shows the pair badge instead of the create
                      button in the draft actions below. */}
                  {p.captionTestId ? (
                    <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">{t("social.ppCaptionTestPair")}</span>
                  ) : null}
                  <span className="text-xs text-slate-400">{fmtDateTime(locale, p.createdAt)}</span>
                </div>
                {p.scheduledAt ? (
                  <p className="mt-1.5 text-sm font-semibold text-slate-800">{t("social.ppScheduleLine", { when: fmtInTz(p.scheduledAt) })} <span className="text-xs font-normal text-slate-400">({orgTz})</span></p>
                ) : null}
                {p.publishedAt ? (
                  <p className="mt-1.5 text-sm font-semibold text-slate-800">{t("social.ppPublishedLine", { when: fmtInTz(p.publishedAt) })} <span className="text-xs font-normal text-slate-400">({orgTz})</span></p>
                ) : null}
                <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-700 line-clamp-2">{p.caption || <span className="text-slate-400">{t("social.ppNoCaption")}</span>}</p>
                {p.linkUrl ? <a href={p.linkUrl} target="_blank" rel="noreferrer" className="mt-0.5 block truncate text-xs text-indigo-600 hover:underline">{p.linkUrl}</a> : null}
                {p.mediaRefs.length > 1 ? <p className="mt-0.5 text-xs text-slate-400">{t("social.ppMediaTotal", { count: fmtNumber(locale, p.mediaRefs.length) })}</p> : null}
                {p.error ? <p className="mt-1 break-words text-xs text-red-600">{p.error}</p> : null}
                {p.publishNote ? <p className="mt-1 break-words text-xs font-medium text-violet-700">{p.publishNote}</p> : null}
                {p.status === "published" && p.platformUrl ? (
                  <a href={p.platformUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-semibold text-indigo-600 hover:underline">{t("social.ppViewPublished")}</a>
                ) : null}
              </div>
            </div>
            {/* SD4: primary actions in front; Clone/Derive/Link-stats
                live inside the detail expander below. */}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => togglePostDetail(p)}>
                {busy === `detail-${p.id}` ? t("social.ppLoading") : detailOpenId === p.id ? t("social.ppCloseDetail") : t("social.ppNotesVersions")}
              </button>
              {p.status === "draft" ? (
                <>
                  {renderSubmitApproval(p)}
                  <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => startEdit(p)}>{t("social.ppEdit")}</button>
                  {/* SN10: pair this draft with a clone draft for
                      a caption test (badge above replaces this
                      button once the post is in a pair). */}
                  {!p.captionTestId ? (
                    <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => createCaptionTest(p)}>
                      {busy === `caption-test-${p.id}` ? t("social.ppCreating") : t("social.ppMakeCaptionTest")}
                    </button>
                  ) : null}
                  <button className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => deletePost(p)}>
                    {busy === `delete-${p.id}` ? t("social.ppDeleting2") : t("social.ppDelete")}
                  </button>
                </>
              ) : null}
            </div>
            {renderPostActions(p)}
            {detailOpenId === p.id ? (
              <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                {/* SD4: secondary actions, grouped inside the expander */}
                <div className="flex flex-wrap gap-2">
                  {renderCloneButton(p)}
                  {renderDeriveButton(p)}
                </div>
                {/* SU9: assign */}
                <div className="flex flex-wrap items-end gap-2">
                  <label className="block text-xs text-slate-500">{t("social.ppAssign")}
                    <select className="input mt-1" value={p.assignedUserId ?? ""} disabled={busy !== ""}
                      onChange={(e) => assignPost(p, e.target.value)}>
                      <option value="">{t("social.ppUnassign")}</option>
                      {members.map((m) => (
                        <option key={m.user.id} value={m.user.id}>{m.user.name || m.user.email} ({m.role})</option>
                      ))}
                    </select>
                  </label>
                  <span className="pb-2 text-xs text-slate-400">{t("social.ppCurrentAssignee", { name: memberLabel(p.assignedUserId) })}</span>
                </div>
                {/* SU9: internal notes (team-only) */}
                <div className="space-y-2">
                  <div className="text-sm font-medium">{t("social.ppInternalNotes")}</div>
                  {(notesByPost[p.id] ?? []).length === 0 ? (
                    <div className="soc-empty-sm">
                      <p className="text-sm text-slate-400">{t("social.ppNoNotes")}</p>
                    </div>
                  ) : (notesByPost[p.id] ?? []).map((n) => (
                    <div key={n.id} className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="whitespace-pre-wrap text-sm text-slate-700">{n.body}</p>
                        <p className="mt-0.5 text-[11px] text-slate-400">{memberLabel(n.authorId)} · {fmtDateTime(locale, n.createdAt)}</p>
                      </div>
                      {myUserId && n.authorId === myUserId ? (
                        <button type="button" className="rounded-lg border border-red-300 px-2 py-0.5 text-xs font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => deletePostNote(p, n)}>
                          {busy === `note-del-${n.id}` ? t("social.ppDeleting2") : t("social.ppDelete")}
                        </button>
                      ) : null}
                    </div>
                  ))}
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="block min-w-[220px] flex-1 text-xs text-slate-500">{t("social.ppNewNote")}
                      <input className="input mt-1" value={noteInputs[p.id] ?? ""}
                        onChange={(e) => setNoteInputs((st: any) => ({ ...st, [p.id]: e.target.value }))}
                        placeholder={t("social.ppNotePlaceholder")} />
                    </label>
                    <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => addPostNote(p)}>
                      {busy === `note-add-${p.id}` ? t("social.ppAdding") : t("social.ppAddNote")}
                    </button>
                  </div>
                </div>
                {/* SU9: version history */}
                <div className="space-y-1.5">
                  <div className="text-sm font-medium">{t("social.ppVersionHistory")}</div>
                  {(versionsByPost[p.id] ?? []).length === 0 ? (
                    <div className="soc-empty-sm">
                      <p className="text-sm text-slate-400">{t("social.ppNoVersions")}</p>
                    </div>
                  ) : (versionsByPost[p.id] ?? []).map((v) => (
                    <div key={v.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <span className="font-medium">v{fmtNumber(locale, v.versionNo)}</span>
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{v.kind}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-slate-500" title={v.snapshot?.caption ?? ""}>{v.snapshot?.caption || t("social.ppNoCaption")}</span>
                      <span className="text-[11px] text-slate-400">{memberLabel(v.changedById)} · {fmtDateTime(locale, v.createdAt)}</span>
                      {p.status === "draft" ? (
                        <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => restorePostVersion(p, v)}>
                          {busy === `version-restore-${v.id}` ? t("social.ppRestoring") : t("social.ppRestoreVersion")}
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {p.status !== "draft" ? <p className="text-xs text-slate-400">{t("social.ppRestoreDraftOnly")}</p> : null}
                </div>
                {/* SU9: activity timeline */}
                <div className="space-y-1.5">
                  <div className="text-sm font-medium">{t("social.ppTimeline")}</div>
                  {(timelineByPost[p.id] ?? []).length === 0 ? (
                    <div className="soc-empty-sm">
                      <p className="text-sm text-slate-400">{t("social.ppNoActivity")}</p>
                    </div>
                  ) : (timelineByPost[p.id] ?? []).map((entry, i) => (
                    <p key={i} className="text-xs text-slate-600">
                      <span className="text-slate-400">{fmtDateTime(locale, entry.at)}</span> · {entry.label}
                    </p>
                  ))}
                </div>
                {/* SN2: client approval share links */}
                <div className="space-y-1.5">
                  <div className="text-sm font-medium">{t("social.ppShareLinks")}</div>
                  <p className="text-xs text-slate-400">{t("social.ppShareLinksNote")}</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => createShareLink(p)}>
                      {busy === `share-create-${p.id}` ? t("social.ppCreating") : t("social.ppMakeShareLink")}
                    </button>
                    {p.postGroupId ? (
                      <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => createGroupShareLink(p)}>
                        {busy === `share-group-${p.id}` ? t("social.ppCreating") : t("social.ppMakeGroupShareLink")}
                      </button>
                    ) : null}
                  </div>
                  {p.postGroupId ? <p className="text-xs text-slate-400">{t("social.ppGroupLinkNote")}</p> : null}
                  {shareCreatedByPost[p.id] ? (
                    <div className="space-y-1 rounded-lg bg-emerald-50 px-3 py-2 text-sm">
                      <div className="font-medium text-emerald-800">{t("social.ppNewLinkCreated")}</div>
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1 text-xs">{shareCreatedByPost[p.id].url}</code>
                        <button type="button" className="btn-secondary btn-sm" onClick={() => { void navigator.clipboard?.writeText(shareCreatedByPost[p.id].url); setCopiedShareId(shareCreatedByPost[p.id].id); }}>
                          {copiedShareId === shareCreatedByPost[p.id].id ? t("social.ppCopied") : t("social.ppCopy")}
                        </button>
                      </div>
                      {shareCreatedByPost[p.id].urlNote ? <p className="text-xs text-amber-700">{shareCreatedByPost[p.id].urlNote}</p> : null}
                      <p className="text-xs text-slate-500">{t("social.ppExpiresAt", { date: fmtDateTime(locale, shareCreatedByPost[p.id].expiresAt) })}</p>
                    </div>
                  ) : null}
                  {(shareLinksByPost[p.id] ?? []).length === 0 ? (
                    <p className="text-xs text-slate-400">{t("social.ppNoShareLinks")}</p>
                  ) : (shareLinksByPost[p.id] ?? []).map((l) => {
                    const st = shareLinkStatus(l);
                    const meta = SHARE_LINK_STATUS_META[st];
                    return (
                      <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                        <span className="font-mono text-xs text-slate-600">{l.tokenMasked}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${meta.pillCls}`}>{shareLinkStatusLabel(st, locale)}</span>
                        <span className="text-[11px] text-slate-400">{t("social.ppExpiry", { date: fmtDateTime(locale, l.expiresAt) })}</span>
                        {st === "active" ? (
                          <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => revokeShareLink(p, l.id)}>
                            {busy === `share-revoke-${l.id}` ? t("social.ppRevoking") : t("social.ppRevoke")}
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                {/* SN4: repurpose — script + carousel outline come
                    back from the AI endpoints and are only SHOWN
                    here; the Messaging handoff opens the Messaging
                    composer with the caption prefilled as a draft.
                    Nothing is saved or sent by any of these. */}
                <div className="space-y-2">
                  <div className="text-sm font-medium">{t("social.ppRepurpose")}</div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => generateRepurposeScript(p)}>
                      {busy === `repurpose-script-${p.id}` ? t("social.ppScriptCreating") : t("social.ppMakeReelScript")}
                    </button>
                    <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => generateCarouselOutline(p)}>
                      {busy === `repurpose-outline-${p.id}` ? t("social.ppOutlineCreating") : t("social.ppMakeCarouselOutline")}
                    </button>
                    {(p.caption ?? "").trim() && encodeURIComponent(p.caption).length <= 1800 ? (
                      <a className="btn-secondary btn-sm" href={`/dashboard/messaging?prefill=${encodeURIComponent(p.caption)}`}>{t("social.ppToMessagingDraft")}</a>
                    ) : null}
                    {(p.caption ?? "").trim() ? (
                      <button type="button" className="btn-secondary btn-sm" onClick={() => { void navigator.clipboard?.writeText(p.caption); setCopiedRepurposeId(p.id); }}>
                        {copiedRepurposeId === p.id ? t("social.ppCopied") : t("social.ppCopyCaption")}
                      </button>
                    ) : null}
                  </div>
                  <p className="text-xs text-slate-400">{t("social.ppMessagingNote")}{(p.caption ?? "").trim() && encodeURIComponent(p.caption).length > 1800 ? t("social.ppMessagingTooLong") : ""}</p>
                  {repurposeScriptByPost[p.id] ? (
                    <div className="space-y-2 rounded-xl bg-slate-50 p-3">
                      <p className="text-sm font-semibold text-slate-800">{repurposeScriptByPost[p.id].hook}</p>
                      {repurposeScriptByPost[p.id].onScreenText.length > 0 ? (
                        <div>
                          <div className="text-xs font-medium text-slate-500">{t("social.ppOnScreenText")}</div>
                          <ul className="list-inside list-disc text-sm text-slate-700">
                            {repurposeScriptByPost[p.id].onScreenText.map((line, i) => <li key={i}>{line}</li>)}
                          </ul>
                        </div>
                      ) : null}
                      {repurposeScriptByPost[p.id].shotList.length > 0 ? (
                        <div>
                          <div className="text-xs font-medium text-slate-500">{t("social.ppShotList")}</div>
                          <ol className="list-inside list-decimal text-sm text-slate-700">
                            {repurposeScriptByPost[p.id].shotList.map((shot, i) => <li key={i}>{shot}</li>)}
                          </ol>
                        </div>
                      ) : null}
                      {repurposeScriptByPost[p.id].captionDraft ? (
                        <p className="whitespace-pre-wrap text-sm text-slate-600">{t("social.ppCaptionDraftLine", { text: repurposeScriptByPost[p.id].captionDraft })}</p>
                      ) : null}
                    </div>
                  ) : null}
                  {repurposeOutlineByPost[p.id] ? (
                    <div className="space-y-1.5 rounded-xl bg-slate-50 p-3">
                      <div className="text-xs font-medium text-slate-500">{t("social.ppCarouselOutlineCount", { count: fmtNumber(locale, repurposeOutlineByPost[p.id].slides.length) })}</div>
                      <ol className="list-inside list-decimal space-y-1 text-sm text-slate-700">
                        {repurposeOutlineByPost[p.id].slides.map((slide, i) => <li key={i} className="whitespace-pre-wrap">{slide}</li>)}
                      </ol>
                      {repurposeOutlineByPost[p.id].droppedCount > 0 ? (
                        <p className="text-[11px] text-amber-700">{t("social.ppSlidesDropped", { count: fmtNumber(locale, repurposeOutlineByPost[p.id].droppedCount) })}</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {/* SD4: tracked-link stats live in the expander too */}
                {renderLinkStats(p)}
              </div>
            ) : null}
            {renderDerivePanel(p)}
            {renderEvergreenControls(p)}
            {renderInsights(p)}
          </div>
        ))}
        {postsNextCursor ? (
          <div className="space-y-2 pt-1">
            <div className="flex justify-center">
              <button type="button" className="btn-secondary disabled:opacity-50" disabled={busy !== ""} onClick={() => loadMorePosts()}>
                {busy === "posts-more" ? t("social.ppLoading") : t("social.ppLoadMore")}
              </button>
            </div>
            {busy === "posts-more" ? (
              <div className="space-y-2" aria-hidden="true">
                <div className="soc-skeleton h-24 w-full" />
                <div className="soc-skeleton h-24 w-full" />
              </div>
            ) : null}
          </div>
        ) : null}
          </>
        ) : viewMode === "calendar" ? (
          <div className="card space-y-3 p-4">
            <p className="text-xs text-slate-500">{t("social.ppPublisherNote")}</p>
            <div className="flex items-center justify-between gap-2">
              <button type="button" className="btn-secondary btn-sm" onClick={() => setCalCursor((c) => (c.m === 1 ? { y: c.y - 1, m: 12 } : { y: c.y, m: c.m - 1 }))}>{t("social.ppPrevMonth")}</button>
              <div className="font-semibold">{calMonthTitle}</div>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setCalCursor((c) => (c.m === 12 ? { y: c.y + 1, m: 1 } : { y: c.y, m: c.m + 1 }))}>{t("social.ppNextMonth")}</button>
            </div>
            {/* SD4: month grid — desktop/tablet only; mobile gets the agenda below */}
            <div className="hidden md:block">
            <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-500">
              {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                <div key={d} className="py-1">{weekdayLabelBn(d, locale)}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {calCells.map((cell) => {
                const dayPosts = calBuckets.get(cell.key) ?? [];
                const isToday = cell.key === orgDayKey(new Date().toISOString(), orgTz);
                return (
                  <div key={cell.key}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData("text/plain");
                      const post = posts.find((x) => x.id === id);
                      if (post) void reschedulePostToDay(post, cell.key);
                    }}
                    className={`min-h-[92px] rounded-lg border p-1.5 ${cell.inMonth ? "bg-white" : "bg-slate-50"} ${isToday ? "soc-cal-today" : "border-slate-100"}`}>
                    <div className={`text-xs font-semibold ${cell.inMonth ? "text-slate-700" : "text-slate-300"}`}>{fmtNumber(locale, cell.day)}</div>
                    <div className="mt-1 space-y-1">
                      {dayPosts.slice(0, 3).map((p) => {
                        const ts = p.scheduledAt ?? p.publishedAt;
                        return (
                          <button key={p.id} type="button" onClick={() => setSelectedPostId(p.id)}
                            draggable={isCalendarDraggable(p)}
                            onDragStart={(e) => { e.dataTransfer.setData("text/plain", p.id); e.dataTransfer.effectAllowed = "move"; }}
                            className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] ${POST_STATUS_META[p.status]?.cls ?? "bg-slate-100 text-slate-600"} ${isCalendarDraggable(p) ? "cursor-grab" : ""}`}
                            title={isCalendarDraggable(p) ? t("social.ppDragTitle", { caption: p.caption }) : p.caption}>
                            <PlatformDot platform={p.account?.platform ?? ""} />
                            <span className="truncate">{ts ? `${fmtTzTime(ts)} ` : ""}{p.caption || t("social.ppNoCaption")}</span>
                          </button>
                        );
                      })}
                      {dayPosts.length > 3 ? <div className="text-[11px] text-slate-500">{t("social.ppMoreCount", { count: fmtNumber(locale, dayPosts.length - 3) })}</div> : null}
                    </div>
                  </div>
                );
              })}
            </div>
            </div>
            {/* SD4: mobile agenda — the SAME calBuckets data grouped by
                day (presentation only, no new fetch), shown under md
                where the 7-column grid would crush. */}
            <div className="space-y-3 md:hidden">
              {calCells.filter((cell) => cell.inMonth && (calBuckets.get(cell.key) ?? []).length > 0).length === 0 ? (
                <div className="soc-empty">
                  <span className="soc-empty-icon">🗓️</span>
                  <p className="text-sm text-slate-500">{t("social.ppNoScheduledMonth")}</p>
                </div>
              ) : calCells.filter((cell) => cell.inMonth && (calBuckets.get(cell.key) ?? []).length > 0).map((cell) => {
                const dayPosts = calBuckets.get(cell.key) ?? [];
                const isToday = cell.key === orgDayKey(new Date().toISOString(), orgTz);
                return (
                  <div key={cell.key} className={`rounded-xl border p-3 ${isToday ? "soc-cal-today" : "border-slate-100 bg-white"}`}>
                    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
                      <span>{weekdayLabelBn(new Date(`${cell.key}T12:00:00`).getDay(), locale)}</span>
                      <span className="font-normal text-slate-500">{fmtNumber(locale, cell.day)} {calMonthTitle}</span>
                      {isToday ? <span className="badge-brand">{t("social.ppToday")}</span> : null}
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {dayPosts.map((p) => {
                        const ts = p.scheduledAt ?? p.publishedAt;
                        return (
                          <button key={p.id} type="button" onClick={() => setSelectedPostId(p.id)}
                            className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs ${POST_STATUS_META[p.status]?.cls ?? "bg-slate-100 text-slate-600"}`}
                            title={p.caption}>
                            <PlatformDot platform={p.account?.platform ?? ""} />
                            <span className="truncate">{ts ? `${fmtTzTime(ts)} ` : ""}{p.caption || t("social.ppNoCaption")}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            {selectedPost ? (
              <div className="space-y-2 rounded-xl bg-slate-50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <AccountAvatar name={selectedPost.account?.name ?? ""} platform={selectedPost.account?.platform ?? ""} />
                  <span className="font-medium">{selectedPost.account?.name ?? ""}</span>
                  <PlatformChip platform={selectedPost.account?.platform} />
                  {selectedPost.account?.username ? <span className="text-xs text-slate-500">@{selectedPost.account.username}</span> : null}
                  <PostStatusPill status={selectedPost.status} />
                  {renderApprovalBadge(selectedPost)}
                  {renderSuBadges(selectedPost)}
                  <button type="button" className="btn-secondary btn-sm ml-auto" onClick={() => setSelectedPostId(null)}>{t("social.ppClose")}</button>
                </div>
                <p className="whitespace-pre-wrap text-sm text-slate-700">{selectedPost.caption || <span className="text-slate-400">{t("social.ppNoCaption")}</span>}</p>
                {selectedPost.mediaRefs.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {selectedPost.mediaRefs.map((m) => (
                      <MediaThumb key={m.assetId} assetId={m.assetId} kind={m.kind} className="h-16 w-16 rounded-lg object-cover" />
                    ))}
                  </div>
                ) : null}
                {selectedPost.scheduledAt ? <p className="text-xs text-slate-500">{t("social.ppScheduleLine", { when: fmtInTz(selectedPost.scheduledAt) })} ({orgTz})</p> : null}
                {selectedPost.publishedAt ? <p className="text-xs text-slate-500">{t("social.ppPublishedLine", { when: fmtInTz(selectedPost.publishedAt) })} ({orgTz})</p> : null}
                {selectedPost.linkUrl ? <a href={selectedPost.linkUrl} target="_blank" rel="noreferrer" className="block truncate text-xs text-indigo-600 hover:underline">{selectedPost.linkUrl}</a> : null}
                {selectedPost.error ? <p className="break-words text-xs text-red-600">{selectedPost.error}</p> : null}
                {selectedPost.publishNote ? <p className="break-words text-xs font-medium text-violet-700">{selectedPost.publishNote}</p> : null}
                {selectedPost.status === "published" && selectedPost.platformUrl ? (
                  <a href={selectedPost.platformUrl} target="_blank" rel="noreferrer" className="inline-block text-xs font-semibold text-indigo-600 hover:underline">{t("social.ppViewPublished")}</a>
                ) : null}
                {renderSubmitApproval(selectedPost)}
                <div className="flex flex-wrap gap-2">{renderCloneButton(selectedPost)}{renderDeriveButton(selectedPost)}</div>
                {renderDerivePanel(selectedPost)}
                {renderInsights(selectedPost)}
                {renderLinkStats(selectedPost)}
                {renderPostActions(selectedPost)}
                {renderEvergreenControls(selectedPost)}
              </div>
            ) : null}
          </div>
        ) : viewMode === "queue" ? (
          <div className="space-y-2">
            {queuePosts.length === 0 ? (
              <div className="soc-empty">
                <span className="soc-empty-icon">🕒</span>
                <p className="text-sm text-slate-500">{t("social.ppNoScheduled")}</p>
              </div>
            ) : (
              /* SD4: the queue as a visual timeline — same queuePosts,
                 a brand dot on the rail per scheduled post. */
              <div className="relative ml-2 space-y-3 border-l-2 border-slate-200 pl-5">
                {queuePosts.map((p) => (
                  <div key={p.id} className="card relative p-4">
                    <span aria-hidden="true" className="absolute -left-[27px] top-5 h-3 w-3 rounded-full bg-[var(--brand-from)] ring-4 ring-white" />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-bold text-slate-900">{p.scheduledAt ? fmtInTz(p.scheduledAt) : ""}</span>
                      <span className="rounded bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">{relativeLabel(p.scheduledAt)}</span>
                      <PostStatusPill status={p.status} />
                      {renderApprovalBadge(p)}
                      {renderSuBadges(p)}
                      <AccountAvatar name={p.account?.name ?? ""} platform={p.account?.platform ?? ""} />
                      <span className="font-medium">{p.account?.name ?? ""}</span>
                      <PlatformChip platform={p.account?.platform} />
                      {p.account?.username ? <span className="text-xs text-slate-500">@{p.account.username}</span> : null}
                    </div>
                    <p className="mt-1 truncate text-sm text-slate-700">{p.caption || <span className="text-slate-400">{t("social.ppNoCaption")}</span>}</p>
                    <div className="mt-2 flex flex-wrap gap-2">{renderCloneButton(p)}{renderDeriveButton(p)}</div>
                    {renderDerivePanel(p)}
                    {renderPostActions(p)}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* SN3: pipeline board — the loaded posts grouped by the
             pure boardColumnForPost mapping. Dragging a card (or
             using its move buttons) only calls the SAME handlers
             the list view uses; the card's place is whatever the
             server-refreshed posts say afterwards, so a refused
             move simply leaves the card where it was, with the
             server's reason in the page banner. */
          <div className="space-y-3">
            <p className="text-xs text-slate-400">{t("social.ppBoardNote", { count: fmtNumber(locale, posts.length) })}{postsNextCursor ? t("social.ppBoardLoadMoreSuffix") : ""}</p>
            <div className="grid items-start gap-3 md:grid-cols-3 xl:grid-cols-5">
              {BOARD_COLUMNS.map((col) => {
                const colPosts = posts.filter((p) => boardColumnForPost(p) === col.id);
                return (
                  <div key={col.id}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setBoardDragOver(col.id); }}
                    onDragLeave={() => setBoardDragOver((cur) => (cur === col.id ? null : cur))}
                    onDrop={(e) => { e.preventDefault(); handleBoardDrop(e.dataTransfer.getData("text/plain"), col.id); }}
                    className={`min-h-[120px] space-y-2 rounded-2xl bg-slate-50 p-2.5 ring-1 ring-inset ${boardDragOver === col.id ? "ring-2 ring-[var(--brand-from)]" : "ring-slate-200/70"}`}>
                    <div className="flex items-center justify-between px-1 pt-1">
                      <span className="text-sm font-semibold text-slate-800">{boardColumnLabel(col.id, locale)}</span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500 ring-1 ring-inset ring-slate-200">{fmtNumber(locale, colPosts.length)}</span>
                    </div>
                    {colPosts.length === 0 ? (
                      <p className="px-1 pb-2 text-xs text-slate-400">{t("social.ppBoardEmpty")}</p>
                    ) : colPosts.map((p) => (
                      <div key={p.id} draggable={p.status !== "publishing"}
                        onDragStart={(e) => { e.dataTransfer.setData("text/plain", p.id); e.dataTransfer.effectAllowed = "move"; }}
                        className="card cursor-grab space-y-2 p-3 active:cursor-grabbing">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <AccountAvatar name={p.account?.name ?? ""} platform={p.account?.platform ?? ""} />
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{p.account?.name ?? ""}</span>
                          <PlatformChip platform={p.account?.platform} />
                        </div>
                        {p.mediaRefs[0] ? <MediaThumb assetId={p.mediaRefs[0].assetId} kind={p.mediaRefs[0].kind} className="h-24 w-full rounded-lg object-cover" /> : null}
                        <p className="whitespace-pre-wrap text-[13px] text-slate-700 line-clamp-3">{p.caption || <span className="text-slate-400">{t("social.ppNoCaption")}</span>}</p>
                        {p.scheduledAt ? <p className="text-xs font-semibold text-slate-700">🕒 {fmtInTz(p.scheduledAt)}</p> : null}
                        {p.status === "published" && p.publishedAt ? <p className="text-xs font-semibold text-slate-700">{t("social.ppPublishedLine", { when: fmtInTz(p.publishedAt) })}</p> : null}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <PostStatusPill status={p.status} />
                          {renderApprovalBadge(p)}
                        </div>
                        {p.error ? <p className="break-words text-[11px] text-red-600">{p.error}</p> : null}
                        {/* Move menu — the touch path to the exact
                            same moves a drag makes. */}
                        {boardMenuActions(p, { requireApproval }).length > 0 ? (
                          <div className="flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
                            {boardMenuActions(p, { requireApproval }).map((a) => (
                              <button key={a.action} type="button" disabled={busy !== ""}
                                className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-200 disabled:opacity-50"
                                onClick={() => runBoardAction(p, a.action)}>
                                {boardActionLabel(a.action, locale)}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
            {postsNextCursor ? (
              <div className="flex justify-center">
                <button type="button" className="btn-secondary disabled:opacity-50" disabled={busy !== ""} onClick={() => loadMorePosts()}>
                  {busy === "posts-more" ? t("social.ppLoading") : t("social.ppLoadMore")}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* SN3: schedule picker for board moves into the Scheduled
          column — a datetime field plus the account's posting
          slots as one-tap quick picks. Confirming calls the same
          doScheduleValue the list form uses. */}
      {scheduleModal && scheduleModalPost ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-3 sm:items-center" role="dialog" aria-modal="true"
          onClick={() => setScheduleModal(null)}>
          <div className="w-full max-w-md space-y-3 rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="font-semibold">{t("social.ppScheduleModalTitle")}</div>
            <div className="flex items-center gap-2 text-sm">
              <AccountAvatar name={scheduleModalPost.account?.name ?? ""} platform={scheduleModalPost.account?.platform ?? ""} />
              <span className="font-medium">{scheduleModalPost.account?.name ?? ""}</span>
              <PlatformChip platform={scheduleModalPost.account?.platform} />
            </div>
            <p className="line-clamp-2 whitespace-pre-wrap text-sm text-slate-600">{scheduleModalPost.caption || t("social.ppNoCaption")}</p>
            <label className="block text-sm">{t("social.ppDateTimeLabel", { tz: orgTz })}
              <input type="datetime-local" className="input mt-1" value={scheduleModal.value}
                onChange={(e) => setScheduleModal((s) => (s ? { ...s, value: e.target.value } : s))} />
            </label>
            {postingSlots.filter((s) => s.enabled && s.socialAccountId === scheduleModalPost.socialAccountId).length > 0 ? (
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-slate-500">{t("social.ppPickFromSlot")}</div>
                <div className="flex flex-wrap gap-1.5">
                  {postingSlots.filter((s) => s.enabled && s.socialAccountId === scheduleModalPost.socialAccountId).map((s) => {
                    const value = nextSlotInputValue(s);
                    if (!value) return null;
                    return (
                      <button key={s.id} type="button" className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200"
                        onClick={() => setScheduleModal((cur) => (cur ? { ...cur, value } : cur))}>
                        {weekdayLabelBn(s.weekday, locale)} · {s.time}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button type="button" className="btn-secondary btn-sm" onClick={() => setScheduleModal(null)}>{t("social.ppCancel")}</button>
              <button type="button" className="btn-primary btn-sm disabled:opacity-50"
                disabled={busy !== "" || !scheduleModal.value}
                onClick={async () => { await doScheduleValue(scheduleModalPost, scheduleModal.value); setScheduleModal(null); }}>
                {busy === `schedule-${scheduleModalPost.id}` ? t("social.ppScheduling") : t("social.ppScheduleBtn")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

</>
  );
}
