"use client";
import React, { useState } from "react";
import type { SocialPageCtx } from "./shared";
import { PLATFORM_LABELS, POST_STATUS_META, MediaThumb, PostStatusPill, AccountAvatar, PlatformDot } from "./shared";
import { SHARE_LINK_STATUS_META, shareLinkStatus } from "@/lib/social-posts-sn";
import { orgDayKey } from "@/lib/social-calendar";
import { weekdayLabelBn } from "@/lib/social-composer";
import { EmptyState } from "@repo/ui";

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
  const { accounts, approvePost, busy, calBuckets, calCells, calMonthTitle, caption, connectedAccounts, createPostingSlot, deletePost, deletePostingSlot, error, filterAccountId, filterQuery, filterStatus, filteredPosts, fmtInTz, inputCls, linkUrl, orgTz, pendingApprovalPosts, postingSlots, posts, queuePosts, rejectNotes, rejectOpenId, rejectPost, relativeLabel, renderApprovalBadge, renderCloneButton, renderDeriveButton, renderDerivePanel, renderEvergreenControls, renderInsights, renderLinkStats, renderPostActions, renderSuBadges, renderSubmitApproval, selectedPost, setCalCursor, setFilterAccountId, setFilterQuery, setFilterStatus, setRejectNotes, setRejectOpenId, setSelectedPostId, setSlotAccountId, setSlotTime, setSlotWeekday, setViewMode, slotAccountId, slotTime, slotWeekday, startEdit, togglePostingSlot, viewMode, postsNextCursor, loadMorePosts, selectedPostIds, togglePostSelected, bulkRescheduleAt, setBulkRescheduleAt, runPostsBulk, detailOpenId, togglePostDetail, notesByPost, versionsByPost, timelineByPost, noteInputs, setNoteInputs, addPostNote, deletePostNote, restorePostVersion, assignPost, memberLabel, members, myUserId, shareLinksByPost, shareCreatedByPost, createShareLink, createGroupShareLink, revokeShareLink, } = c;
  // SN2: which created share link was just copied (button feedback).
  const [copiedShareId, setCopiedShareId] = useState("");
  return (
<>
      {/* SU2: posting slots (queue) */}
      <div className="card space-y-3 p-5">
        <div className="font-semibold">🗓️ Posting Slots (Queue-এর সময়)</div>
        <p className="text-xs text-slate-500">প্রতিটি অ্যাকাউন্টের জন্য সপ্তাহের নির্দিষ্ট দিন ও সময়ে Slot রাখুন — Draft-এর “Queue-তে যোগ করুন” বোতাম পরের খালি Slot-এ পোস্টটি শিডিউল করবে (Organization-এর timezone: {orgTz})।</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-[200px] flex-1 text-sm">অ্যাকাউন্ট
            <select className={inputCls} value={slotAccountId} onChange={(e) => setSlotAccountId(e.target.value)}>
              <option value="">অ্যাকাউন্ট বেছে নিন</option>
              {connectedAccounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({PLATFORM_LABELS[a.platform] ?? a.platform})</option>)}
            </select>
          </label>
          <label className="block text-sm">বার
            <select className={inputCls} value={slotWeekday} onChange={(e) => setSlotWeekday(Number(e.target.value))}>
              {[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{weekdayLabelBn(d)}</option>)}
            </select>
          </label>
          <label className="block text-sm">সময়
            <input type="time" className={inputCls} value={slotTime} onChange={(e) => setSlotTime(e.target.value)} />
          </label>
          <button type="button" className="btn-primary disabled:opacity-50" disabled={busy !== ""} onClick={createPostingSlot}>
            {busy === "slot-create" ? "যোগ হচ্ছে..." : "Slot যোগ করুন"}
          </button>
        </div>
        {postingSlots.length === 0 ? (
          <div className="soc-empty">
            <span className="soc-empty-icon">🗓️</span>
            <p className="text-sm text-slate-500">এখনো কোনো Posting Slot নেই — উপরে একটি যোগ করুন।</p>
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
                  <span>{weekdayLabelBn(slot.weekday)}</span>
                  <span className="text-slate-500">{slot.time}</span>
                  <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
                    <input type="checkbox" checked={slot.enabled} disabled={busy !== ""} onChange={(e) => togglePostingSlot(slot, e.target.checked)} />
                    {slot.enabled ? "চালু" : "বন্ধ"}
                  </label>
                  <button type="button" className="rounded-lg border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => deletePostingSlot(slot)}>
                    {busy === `slot-${slot.id}` ? "হচ্ছে..." : "মুছুন"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SP7 approval queue — SD4: amber section header band */}
      <div className="card space-y-3 p-5">
        <div className="rounded-lg bg-amber-50 px-3 py-2 font-semibold text-amber-800 ring-1 ring-inset ring-amber-200/60">⏳ অনুমোদনের অপেক্ষায় ({pendingApprovalPosts.length})</div>
        {pendingApprovalPosts.length === 0 ? (
          <div className="soc-empty">
            <span className="soc-empty-icon">⏳</span>
            <p className="text-sm text-slate-500">এখন কোনো পোস্ট অনুমোদনের অপেক্ষায় নেই।</p>
          </div>
        ) : pendingApprovalPosts.map((p) => (
          <div key={p.id} className="space-y-2 rounded-xl bg-slate-50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <AccountAvatar name={p.account?.name ?? ""} platform={p.account?.platform ?? ""} />
              <span className="font-medium">{p.account?.name ?? ""}</span>
              <PlatformChip platform={p.account?.platform} />
              {p.account?.username ? <span className="text-xs text-slate-500">@{p.account.username}</span> : null}
              <span className="text-xs text-slate-400">{new Date(p.createdAt).toLocaleString("bn-BD")}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm text-slate-700 line-clamp-3">{p.caption || <span className="text-slate-400">(ক্যাপশন নেই)</span>}</p>
            {p.mediaRefs.length > 0 ? <p className="text-xs text-slate-400">{p.mediaRefs.length.toLocaleString("bn-BD")}টি মিডিয়া সংযুক্ত</p> : null}
            {rejectOpenId === p.id ? (
              <div className="space-y-2">
                <label className="block text-xs text-slate-500">প্রত্যাখ্যানের কারণ (আবশ্যক)
                  <textarea className="input mt-1" rows={2} value={rejectNotes[p.id] ?? ""}
                    onChange={(e) => setRejectNotes((s) => ({ ...s, [p.id]: e.target.value }))}
                    placeholder="কেন পোস্টটি প্রত্যাখ্যান করা হচ্ছে লিখুন" />
                </label>
                {!(rejectNotes[p.id] ?? "").trim() ? (
                  <p className="text-xs text-red-600">প্রত্যাখ্যান করতে হলে কারণ লেখা আবশ্যক — কারণ না লিখলে নিশ্চিত করা যাবে না।</p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                    disabled={busy !== "" || !(rejectNotes[p.id] ?? "").trim()} onClick={() => rejectPost(p)}>
                    {busy === `reject-${p.id}` ? "প্রত্যাখ্যান হচ্ছে..." : "প্রত্যাখ্যান নিশ্চিত করুন"}
                  </button>
                  <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => setRejectOpenId(null)}>বাতিল</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50" disabled={busy !== ""} onClick={() => approvePost(p)}>
                  {busy === `approve-${p.id}` ? "অনুমোদন হচ্ছে..." : "✅ অনুমোদন করুন"}
                </button>
                <button type="button" className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => setRejectOpenId(p.id)}>
                  ❌ প্রত্যাখ্যান
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Posts list / calendar / queue (SP5) */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={viewMode === "list" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => setViewMode("list")}>তালিকা</button>
          <button type="button" className={viewMode === "calendar" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => setViewMode("calendar")}>ক্যালেন্ডার</button>
          <button type="button" className={viewMode === "queue" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => setViewMode("queue")}>সারি (Queue)</button>
          {viewMode !== "list" ? <span className="text-xs text-slate-400">ফিল্টার শুধু তালিকা ভিউতে প্রযোজ্য — এই ভিউতে সব পোস্ট দেখানো হচ্ছে।</span> : null}
        </div>
        {viewMode === "list" ? (
          <>
        <div className="card space-y-3 p-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-500">খুঁজুন (ক্যাপশন / অ্যাকাউন্ট)
              <input className="input mt-1 w-56" placeholder="যেমন: ঈদ অফার" value={filterQuery} onChange={(e) => setFilterQuery(e.target.value)} />
            </label>
            <label className="text-xs text-slate-500">স্ট্যাটাস
              <select className="input mt-1" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="">সব</option>
                <option value="draft">Draft</option>
                <option value="scheduled">Scheduled</option>
                <option value="published">Published</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
            <label className="text-xs text-slate-500">অ্যাকাউন্ট
              <select className="input mt-1" value={filterAccountId} onChange={(e) => setFilterAccountId(e.target.value)}>
                <option value="">সব অ্যাকাউন্ট</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({PLATFORM_LABELS[a.platform] ?? a.platform})</option>)}
              </select>
            </label>
            <span className="pb-2 text-sm text-slate-500">{filteredPosts.length}টি পোস্ট দেখাচ্ছে (মোট {posts.length}টি)</span>
          </div>
        </div>

        {/* SU11: bulk bar — selection lives in page state */}
        {selectedPostIds.size > 0 ? (
          <div className="card flex flex-wrap items-end gap-2 p-4">
            <span className="pb-2 text-sm font-medium">{selectedPostIds.size.toLocaleString("bn-BD")}টি পোস্ট বাছাই করা হয়েছে</span>
            <button type="button" className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => runPostsBulk("delete_drafts")}>
              {busy === "posts-bulk-delete_drafts" ? "মোছা হচ্ছে..." : "🗑️ Draft মুছুন (Bulk)"}
            </button>
            <label className="block text-xs text-slate-500">নতুন শিডিউল সময় ({orgTz})
              <input type="datetime-local" className="input mt-1" value={bulkRescheduleAt} onChange={(e) => setBulkRescheduleAt(e.target.value)} />
            </label>
            <button type="button" className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => runPostsBulk("reschedule")}>
              {busy === "posts-bulk-reschedule" ? "Reschedule হচ্ছে..." : "🕒 Reschedule করুন"}
            </button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => c.setSelectedPostIds(new Set())}>বাছাই মুছুন</button>
            <span className="pb-2 text-xs text-slate-400">Draft মোছা শুধু Draft পোস্টে কাজ করে; Reschedule শুধু Draft/Scheduled পোস্টে — বাকিগুলো কারণসহ ব্যর্থ হিসেবে জানানো হবে।</span>
          </div>
        ) : null}

        {posts.length === 0 ? (
          <EmptyState title="এখনো কোনো পোস্ট তৈরি হয়নি" description="উপরের Composer-এ ক্যাপশন লিখে, অ্যাকাউন্ট বেছে নিয়ে প্রথম Draft সংরক্ষণ করুন।" />
        ) : filteredPosts.length === 0 ? (
          <div className="soc-empty">
            <span className="soc-empty-icon">🔍</span>
            <p className="text-sm text-slate-500">এই ফিল্টারে কোনো পোস্ট মিলছে না — ফিল্টার বদলে আবার চেষ্টা করুন। (পোস্ট মুছে যায়নি; মোট {posts.length}টি পোস্টই আছে।)</p>
          </div>
        ) : filteredPosts.map((p) => (
          <div key={p.id} className={`card p-5 ${selectedPostIds.has(p.id) ? "soc-selected" : ""}`}>
            <div className="flex flex-wrap items-start gap-3">
              <label className="flex shrink-0 cursor-pointer items-center gap-1 pt-1 text-xs text-slate-500">
                <input type="checkbox" className="h-4 w-4" checked={selectedPostIds.has(p.id)} onChange={() => togglePostSelected(p.id)} />
                বাছাই
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
                  <span className="text-xs text-slate-400">{new Date(p.createdAt).toLocaleString("bn-BD")}</span>
                </div>
                {p.scheduledAt ? (
                  <p className="mt-1.5 text-sm font-semibold text-slate-800">🕒 শিডিউল: {fmtInTz(p.scheduledAt)} <span className="text-xs font-normal text-slate-400">({orgTz})</span></p>
                ) : null}
                {p.publishedAt ? (
                  <p className="mt-1.5 text-sm font-semibold text-slate-800">প্রকাশিত: {fmtInTz(p.publishedAt)} <span className="text-xs font-normal text-slate-400">({orgTz})</span></p>
                ) : null}
                <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-700 line-clamp-2">{p.caption || <span className="text-slate-400">(ক্যাপশন নেই)</span>}</p>
                {p.linkUrl ? <a href={p.linkUrl} target="_blank" rel="noreferrer" className="mt-0.5 block truncate text-xs text-indigo-600 hover:underline">{p.linkUrl}</a> : null}
                {p.mediaRefs.length > 1 ? <p className="mt-0.5 text-xs text-slate-400">মোট {p.mediaRefs.length}টি মিডিয়া সংযুক্ত</p> : null}
                {p.error ? <p className="mt-1 break-words text-xs text-red-600">{p.error}</p> : null}
                {p.publishNote ? <p className="mt-1 break-words text-xs font-medium text-violet-700">{p.publishNote}</p> : null}
                {p.status === "published" && p.platformUrl ? (
                  <a href={p.platformUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-semibold text-indigo-600 hover:underline">প্রকাশিত পোস্ট দেখুন ↗</a>
                ) : null}
              </div>
            </div>
            {/* SD4: primary actions in front; Clone/Derive/Link-stats
                live inside the detail expander below. */}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => togglePostDetail(p)}>
                {busy === `detail-${p.id}` ? "লোড হচ্ছে..." : detailOpenId === p.id ? "বিস্তারিত বন্ধ করুন" : "📝 নোট ও Version"}
              </button>
              {p.status === "draft" ? (
                <>
                  {renderSubmitApproval(p)}
                  <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => startEdit(p)}>সম্পাদনা</button>
                  <button className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => deletePost(p)}>
                    {busy === `delete-${p.id}` ? "মুছছে..." : "মুছুন"}
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
                  <label className="block text-xs text-slate-500">দায়িত্ব (Assign)
                    <select className="input mt-1" value={p.assignedUserId ?? ""} disabled={busy !== ""}
                      onChange={(e) => assignPost(p, e.target.value)}>
                      <option value="">কেউ নয় (Unassign)</option>
                      {members.map((m) => (
                        <option key={m.user.id} value={m.user.id}>{m.user.name || m.user.email} ({m.role})</option>
                      ))}
                    </select>
                  </label>
                  <span className="pb-2 text-xs text-slate-400">বর্তমান দায়িত্ব: {memberLabel(p.assignedUserId)}</span>
                </div>
                {/* SU9: internal notes (team-only) */}
                <div className="space-y-2">
                  <div className="text-sm font-medium">📝 অভ্যন্তরীণ নোট (শুধু Team-এর জন্য — Platform-এ যায় না)</div>
                  {(notesByPost[p.id] ?? []).length === 0 ? (
                    <div className="soc-empty-sm">
                      <p className="text-sm text-slate-400">এখনো কোনো নোট নেই।</p>
                    </div>
                  ) : (notesByPost[p.id] ?? []).map((n) => (
                    <div key={n.id} className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="whitespace-pre-wrap text-sm text-slate-700">{n.body}</p>
                        <p className="mt-0.5 text-[11px] text-slate-400">{memberLabel(n.authorId)} · {new Date(n.createdAt).toLocaleString("bn-BD")}</p>
                      </div>
                      {myUserId && n.authorId === myUserId ? (
                        <button type="button" className="rounded-lg border border-red-300 px-2 py-0.5 text-xs font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => deletePostNote(p, n)}>
                          {busy === `note-del-${n.id}` ? "মুছছে..." : "মুছুন"}
                        </button>
                      ) : null}
                    </div>
                  ))}
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="block min-w-[220px] flex-1 text-xs text-slate-500">নতুন নোট
                      <input className="input mt-1" value={noteInputs[p.id] ?? ""}
                        onChange={(e) => setNoteInputs((st: any) => ({ ...st, [p.id]: e.target.value }))}
                        placeholder="Team-এর জন্য নোট লিখুন" />
                    </label>
                    <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => addPostNote(p)}>
                      {busy === `note-add-${p.id}` ? "যোগ হচ্ছে..." : "নোট যোগ করুন"}
                    </button>
                  </div>
                </div>
                {/* SU9: version history */}
                <div className="space-y-1.5">
                  <div className="text-sm font-medium">🕘 Version ইতিহাস</div>
                  {(versionsByPost[p.id] ?? []).length === 0 ? (
                    <div className="soc-empty-sm">
                      <p className="text-sm text-slate-400">কোনো Version পাওয়া যায়নি।</p>
                    </div>
                  ) : (versionsByPost[p.id] ?? []).map((v) => (
                    <div key={v.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <span className="font-medium">v{v.versionNo.toLocaleString("bn-BD")}</span>
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{v.kind}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-slate-500" title={v.snapshot?.caption ?? ""}>{v.snapshot?.caption || "(ক্যাপশন নেই)"}</span>
                      <span className="text-[11px] text-slate-400">{memberLabel(v.changedById)} · {new Date(v.createdAt).toLocaleString("bn-BD")}</span>
                      {p.status === "draft" ? (
                        <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => restorePostVersion(p, v)}>
                          {busy === `version-restore-${v.id}` ? "ফিরিয়ে আনা হচ্ছে..." : "এই Version ফিরিয়ে আনুন"}
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {p.status !== "draft" ? <p className="text-xs text-slate-400">Version ফিরিয়ে আনা শুধু Draft পোস্টে যায়।</p> : null}
                </div>
                {/* SU9: activity timeline */}
                <div className="space-y-1.5">
                  <div className="text-sm font-medium">📜 কার্যকলাপের Timeline</div>
                  {(timelineByPost[p.id] ?? []).length === 0 ? (
                    <div className="soc-empty-sm">
                      <p className="text-sm text-slate-400">এখনো কোনো কার্যকলাপ রেকর্ড হয়নি।</p>
                    </div>
                  ) : (timelineByPost[p.id] ?? []).map((entry, i) => (
                    <p key={i} className="text-xs text-slate-600">
                      <span className="text-slate-400">{new Date(entry.at).toLocaleString("bn-BD")}</span> · {entry.label}
                    </p>
                  ))}
                </div>
                {/* SN2: client approval share links */}
                <div className="space-y-1.5">
                  <div className="text-sm font-medium">🔗 ক্লায়েন্ট শেয়ার লিংক</div>
                  <p className="text-xs text-slate-400">ক্লায়েন্ট লগইন ছাড়াই পোস্টের preview দেখে অনুমোদন দিতে বা পরিবর্তন চাইতে পারবেন; সিদ্ধান্ত Timeline-এ রেকর্ড হয়। পূর্ণ লিংক শুধু তৈরির মুহূর্তে একবার দেখা যায় — কপি করে রাখুন।</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => createShareLink(p)}>
                      {busy === `share-create-${p.id}` ? "তৈরি হচ্ছে..." : "এই পোস্টের শেয়ার লিংক তৈরি করুন"}
                    </button>
                    {p.postGroupId ? (
                      <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => createGroupShareLink(p)}>
                        {busy === `share-group-${p.id}` ? "তৈরি হচ্ছে..." : "পুরো গ্রুপের শেয়ার লিংক তৈরি করুন"}
                      </button>
                    ) : null}
                  </div>
                  {p.postGroupId ? <p className="text-xs text-slate-400">গ্রুপ লিংক নিচের তালিকায় আসে না — তৈরির মুহূর্তে দেখানো লিংকটিই সংরক্ষণ করুন।</p> : null}
                  {shareCreatedByPost[p.id] ? (
                    <div className="space-y-1 rounded-lg bg-emerald-50 px-3 py-2 text-sm">
                      <div className="font-medium text-emerald-800">নতুন লিংক তৈরি হয়েছে:</div>
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1 text-xs">{shareCreatedByPost[p.id].url}</code>
                        <button type="button" className="btn-secondary btn-sm" onClick={() => { void navigator.clipboard?.writeText(shareCreatedByPost[p.id].url); setCopiedShareId(shareCreatedByPost[p.id].id); }}>
                          {copiedShareId === shareCreatedByPost[p.id].id ? "কপি হয়েছে ✓" : "কপি করুন"}
                        </button>
                      </div>
                      {shareCreatedByPost[p.id].urlNote ? <p className="text-xs text-amber-700">{shareCreatedByPost[p.id].urlNote}</p> : null}
                      <p className="text-xs text-slate-500">মেয়াদ শেষ: {new Date(shareCreatedByPost[p.id].expiresAt).toLocaleString("bn-BD")}</p>
                    </div>
                  ) : null}
                  {(shareLinksByPost[p.id] ?? []).length === 0 ? (
                    <p className="text-xs text-slate-400">এই পোস্টের জন্য এখনো কোনো শেয়ার লিংক তৈরি হয়নি।</p>
                  ) : (shareLinksByPost[p.id] ?? []).map((l) => {
                    const st = shareLinkStatus(l);
                    const meta = SHARE_LINK_STATUS_META[st];
                    return (
                      <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                        <span className="font-mono text-xs text-slate-600">{l.tokenMasked}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${meta.pillCls}`}>{meta.label}</span>
                        <span className="text-[11px] text-slate-400">মেয়াদ: {new Date(l.expiresAt).toLocaleString("bn-BD")}</span>
                        {st === "active" ? (
                          <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => revokeShareLink(p, l.id)}>
                            {busy === `share-revoke-${l.id}` ? "বাতিল হচ্ছে..." : "বাতিল করুন"}
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
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
                {busy === "posts-more" ? "লোড হচ্ছে..." : "আরও দেখুন (আরও পোস্ট লোড করুন)"}
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
            <p className="text-xs text-slate-500">নির্ধারিত পোস্ট সময়মতো প্রকাশের জন্য Automations পেজে &apos;Social Post Publisher&apos; Job চালু থাকতে হবে।</p>
            <div className="flex items-center justify-between gap-2">
              <button type="button" className="btn-secondary btn-sm" onClick={() => setCalCursor((c) => (c.m === 1 ? { y: c.y - 1, m: 12 } : { y: c.y, m: c.m - 1 }))}>‹ আগের মাস</button>
              <div className="font-semibold">{calMonthTitle}</div>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setCalCursor((c) => (c.m === 12 ? { y: c.y + 1, m: 1 } : { y: c.y, m: c.m + 1 }))}>পরের মাস ›</button>
            </div>
            {/* SD4: month grid — desktop/tablet only; mobile gets the agenda below */}
            <div className="hidden md:block">
            <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-500">
              {["রবি", "সোম", "মঙ্গল", "বুধ", "বৃহ", "শুক্র", "শনি"].map((d) => (
                <div key={d} className="py-1">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {calCells.map((cell) => {
                const dayPosts = calBuckets.get(cell.key) ?? [];
                const isToday = cell.key === orgDayKey(new Date().toISOString(), orgTz);
                return (
                  <div key={cell.key} className={`min-h-[92px] rounded-lg border p-1.5 ${cell.inMonth ? "bg-white" : "bg-slate-50"} ${isToday ? "soc-cal-today" : "border-slate-100"}`}>
                    <div className={`text-xs font-semibold ${cell.inMonth ? "text-slate-700" : "text-slate-300"}`}>{cell.day.toLocaleString("bn-BD")}</div>
                    <div className="mt-1 space-y-1">
                      {dayPosts.slice(0, 3).map((p) => {
                        const t = p.scheduledAt ?? p.publishedAt;
                        return (
                          <button key={p.id} type="button" onClick={() => setSelectedPostId(p.id)}
                            className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] ${POST_STATUS_META[p.status]?.cls ?? "bg-slate-100 text-slate-600"}`}
                            title={p.caption}>
                            <PlatformDot platform={p.account?.platform ?? ""} />
                            <span className="truncate">{t ? `${new Date(t).toLocaleTimeString("bn-BD", { timeZone: orgTz, hour: "2-digit", minute: "2-digit" })} ` : ""}{p.caption || "(ক্যাপশন নেই)"}</span>
                          </button>
                        );
                      })}
                      {dayPosts.length > 3 ? <div className="text-[11px] text-slate-500">+আরও {(dayPosts.length - 3).toLocaleString("bn-BD")}টি</div> : null}
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
                  <p className="text-sm text-slate-500">এই মাসে কোনো শিডিউল করা পোস্ট নেই।</p>
                </div>
              ) : calCells.filter((cell) => cell.inMonth && (calBuckets.get(cell.key) ?? []).length > 0).map((cell) => {
                const dayPosts = calBuckets.get(cell.key) ?? [];
                const isToday = cell.key === orgDayKey(new Date().toISOString(), orgTz);
                return (
                  <div key={cell.key} className={`rounded-xl border p-3 ${isToday ? "soc-cal-today" : "border-slate-100 bg-white"}`}>
                    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
                      <span>{weekdayLabelBn(new Date(`${cell.key}T12:00:00`).getDay())}</span>
                      <span className="font-normal text-slate-500">{cell.day.toLocaleString("bn-BD")} {calMonthTitle}</span>
                      {isToday ? <span className="badge-brand">আজ</span> : null}
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {dayPosts.map((p) => {
                        const t = p.scheduledAt ?? p.publishedAt;
                        return (
                          <button key={p.id} type="button" onClick={() => setSelectedPostId(p.id)}
                            className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs ${POST_STATUS_META[p.status]?.cls ?? "bg-slate-100 text-slate-600"}`}
                            title={p.caption}>
                            <PlatformDot platform={p.account?.platform ?? ""} />
                            <span className="truncate">{t ? `${new Date(t).toLocaleTimeString("bn-BD", { timeZone: orgTz, hour: "2-digit", minute: "2-digit" })} ` : ""}{p.caption || "(ক্যাপশন নেই)"}</span>
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
                  <button type="button" className="btn-secondary btn-sm ml-auto" onClick={() => setSelectedPostId(null)}>বন্ধ করুন</button>
                </div>
                <p className="whitespace-pre-wrap text-sm text-slate-700">{selectedPost.caption || <span className="text-slate-400">(ক্যাপশন নেই)</span>}</p>
                {selectedPost.mediaRefs.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {selectedPost.mediaRefs.map((m) => (
                      <MediaThumb key={m.assetId} assetId={m.assetId} kind={m.kind} className="h-16 w-16 rounded-lg object-cover" />
                    ))}
                  </div>
                ) : null}
                {selectedPost.scheduledAt ? <p className="text-xs text-slate-500">🕒 শিডিউল: {fmtInTz(selectedPost.scheduledAt)} ({orgTz})</p> : null}
                {selectedPost.publishedAt ? <p className="text-xs text-slate-500">প্রকাশিত: {fmtInTz(selectedPost.publishedAt)} ({orgTz})</p> : null}
                {selectedPost.linkUrl ? <a href={selectedPost.linkUrl} target="_blank" rel="noreferrer" className="block truncate text-xs text-indigo-600 hover:underline">{selectedPost.linkUrl}</a> : null}
                {selectedPost.error ? <p className="break-words text-xs text-red-600">{selectedPost.error}</p> : null}
                {selectedPost.publishNote ? <p className="break-words text-xs font-medium text-violet-700">{selectedPost.publishNote}</p> : null}
                {selectedPost.status === "published" && selectedPost.platformUrl ? (
                  <a href={selectedPost.platformUrl} target="_blank" rel="noreferrer" className="inline-block text-xs font-semibold text-indigo-600 hover:underline">প্রকাশিত পোস্ট দেখুন ↗</a>
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
        ) : (
          <div className="space-y-2">
            {queuePosts.length === 0 ? (
              <div className="soc-empty">
                <span className="soc-empty-icon">🕒</span>
                <p className="text-sm text-slate-500">এখন কোনো পোস্ট শিডিউল করা নেই।</p>
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
                    <p className="mt-1 truncate text-sm text-slate-700">{p.caption || <span className="text-slate-400">(ক্যাপশন নেই)</span>}</p>
                    <div className="mt-2 flex flex-wrap gap-2">{renderCloneButton(p)}{renderDeriveButton(p)}</div>
                    {renderDerivePanel(p)}
                    {renderPostActions(p)}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

</>
  );
}
