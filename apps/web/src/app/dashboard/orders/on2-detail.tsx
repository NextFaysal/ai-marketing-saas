"use client";
import React, { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  DELIVERY_ATTEMPT_OUTCOMES, deliveryAttemptOutcomeLabel,
  notificationChannelLabel, notificationEventLabel, notificationStatusLabel,
} from "@/lib/orders-on5";
import { formatMinor } from "@repo/contracts";

/** Org staff row from GET /organizations/:id/members — the same
 * endpoint + shape the inbox and team pages use. The assignee id
 * everywhere in the dashboard is the USER id (m.user.id), never
 * the membership row id. */
export interface MemberRow { id: string; role: string; user: { id: string; name?: string | null; email: string } }
export const memberName = (members: MemberRow[], userId?: string | null): string => {
  if (!userId) return "—";
  const m = members.find((x) => x.user.id === userId);
  return m ? (m.user.name ?? m.user.email) : "টিম সদস্য";
};

interface TimelineEntry { at: string; kind: string; title: string; detail?: string | null; actor?: string | null }
interface Customer360 {
  customer: { id: string; name?: string | null; phone?: string | null; email?: string | null } | null;
  orderCount: number; deliveredCount: number; cancelledCount: number; returnedCount: number;
  lifetimeValueMinor: string; reliabilityPercent: number | null;
  openDueMinor: string; openReturns: number;
  lastOrders: { id: string; externalNumber?: string | null; status: string; totalMinor: string; placedAt?: string | null }[];
}
interface OrderComment { id: string; authorId: string; authorName?: string | null; body: string; createdAt: string }
// ON6: staff-recorded delivery attempts (GET /orders/:id/delivery-attempts).
interface DeliveryAttempt { id: string; outcome: string; note?: string | null; rescheduleDate?: string | null; attemptedAt?: string | null; createdAt: string }
// ON5: per-order notification log rows (GET /orders/:id/notification-logs).
interface NotificationLog { id?: string; event: string; channel: string; status: string; providerMessageId?: string | null; error?: string | null; createdAt: string }

const KIND_ICON: Record<string, string> = {
  created: "🆕", order_created: "🆕", status: "🔄", status_change: "🔄",
  payment: "💳", advance: "💳", shipment: "🚚", courier: "🚚",
  comment: "💬", assign: "👤", assignment: "👤", tag: "🏷️",
  refund: "↩️", return: "↩️", note: "📝",
  notification: "🔔", delivery_attempt: "🏠",
};
const kindIcon = (kind: string) => KIND_ICON[kind] ?? "•";
const money = (minor?: string | null) => {
  if (minor == null) return "—";
  try { return formatMinor(BigInt(minor)); } catch { return String(minor); }
};

/**
 * ON2 (Orders Next): the detail-panel additions — unified
 * timeline, Customer 360, assignee picker, tag editor and the
 * internal comments thread. Everything renders ONLY what the
 * server returns; a failed load says so instead of rendering an
 * empty-but-confident panel.
 */
export function OrderDetailOn2({ orderId, orderLabel, assigneeId, tags, members, onPatch, onOpenOrder }: {
  orderId: string;
  orderLabel: string;
  assigneeId?: string | null;
  tags?: string[] | null;
  members: MemberRow[];
  /** Let the parent page sync its actOrder / list row after an
   * assign or tag change made from here. */
  onPatch: (patch: { assigneeId?: string | null; tags?: string[] }) => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const [timeline, setTimeline] = useState<{ entries: TimelineEntry[]; truncated: boolean } | null>(null);
  const [timelineError, setTimelineError] = useState("");
  const [c360, setC360] = useState<Customer360 | null>(null);
  const [c360Error, setC360Error] = useState("");
  const [comments, setComments] = useState<OrderComment[]>([]);
  const [commentsError, setCommentsError] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [myId, setMyId] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  // ON6 delivery attempts + ON5 notification logs.
  const [attempts, setAttempts] = useState<DeliveryAttempt[] | null>(null);
  const [attemptsError, setAttemptsError] = useState("");
  const [attemptOutcome, setAttemptOutcome] = useState("customer_unavailable");
  const [attemptNote, setAttemptNote] = useState("");
  const [attemptDate, setAttemptDate] = useState("");
  const [logs, setLogs] = useState<NotificationLog[] | null>(null);
  const [logsError, setLogsError] = useState("");

  // Sync the tag draft when the order changes OR its tags arrive
  // late (the parent enriches actOrder from GET /:orderId after
  // the panel mounts). Keyed on the joined string so a re-render
  // with identical tags never clobbers what staff are typing.
  const tagsKey = (tags ?? []).join(",");
  useEffect(() => { setTagDraft(tagsKey); }, [orderId, tagsKey]);

  useEffect(() => {
    apiFetch<any>("/auth/me").then((j) => setMyId(j?.id ?? j?.user?.id ?? null)).catch(() => undefined);
  }, []);

  useEffect(() => {
    const orgId = getOrganizationId(); if (!orgId) return;
    let alive = true;
    setTimeline(null); setTimelineError("");
    apiFetch<{ entries: TimelineEntry[]; truncated: boolean }>(`/organizations/${orgId}/orders/${orderId}/timeline`)
      .then((t) => { if (alive) setTimeline(t); })
      .catch((e) => { if (alive) setTimelineError(e instanceof Error ? e.message : "টাইমলাইন লোড ব্যর্থ"); });
    setC360(null); setC360Error("");
    apiFetch<Customer360>(`/organizations/${orgId}/orders/${orderId}/customer-360`)
      .then((c) => { if (alive) setC360(c); })
      .catch((e) => { if (alive) setC360Error(e instanceof Error ? e.message : "গ্রাহকের তথ্য লোড ব্যর্থ"); });
    setComments([]); setCommentsError("");
    apiFetch<OrderComment[]>(`/organizations/${orgId}/orders/${orderId}/comments`)
      .then((c) => { if (alive) setComments(c ?? []); })
      .catch((e) => { if (alive) setCommentsError(e instanceof Error ? e.message : "মন্তব্য লোড ব্যর্থ"); });
    setAttempts(null); setAttemptsError("");
    apiFetch<DeliveryAttempt[]>(`/organizations/${orgId}/orders/${orderId}/delivery-attempts`)
      .then((a) => { if (alive) setAttempts(a ?? []); })
      .catch((e) => { if (alive) setAttemptsError(e instanceof Error ? e.message : "ডেলিভারি চেষ্টা লোড ব্যর্থ"); });
    setLogs(null); setLogsError("");
    apiFetch<NotificationLog[]>(`/organizations/${orgId}/orders/${orderId}/notification-logs`)
      .then((l) => { if (alive) setLogs(l ?? []); })
      .catch((e) => { if (alive) setLogsError(e instanceof Error ? e.message : "বিজ্ঞপ্তি লগ লোড ব্যর্থ"); });
    return () => { alive = false; };
  }, [orderId]);

  /** Record what the courier reported. This is a STAFF record
   * only — nothing is sent back to the courier's system. Server
   * errors (no shipment, rescheduled without a date) are shown
   * verbatim. */
  async function recordAttempt() {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (attemptOutcome === "rescheduled" && !attemptDate) {
      setAttemptsError("পুনঃনির্ধারিত হলে নতুন তারিখ দিতে হবে।");
      return;
    }
    setBusy("attempt"); setAttemptsError("");
    try {
      const created = await apiFetch<DeliveryAttempt>(`/organizations/${orgId}/orders/${orderId}/delivery-attempts`, {
        method: "POST",
        body: JSON.stringify({
          outcome: attemptOutcome,
          note: attemptNote.trim() || undefined,
          rescheduleDate: attemptOutcome === "rescheduled" ? attemptDate : undefined,
        }),
      });
      setAttempts((prev) => [created, ...(prev ?? [])]);
      setAttemptNote(""); setAttemptDate("");
    } catch (e) { setAttemptsError(e instanceof Error ? e.message : "ডেলিভারি চেষ্টা রেকর্ড ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function assign(userId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("assign"); setCommentsError("");
    try {
      await apiFetch(`/organizations/${orgId}/orders/${orderId}/assign`, {
        method: "PATCH", body: JSON.stringify({ assigneeId: userId || null }),
      });
      onPatch({ assigneeId: userId || null });
    } catch (e) { setCommentsError(e instanceof Error ? e.message : "দায়িত্ব দেওয়া ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function saveTags() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const next = [...new Set(tagDraft.split(",").map((t) => t.trim()).filter(Boolean))];
    setBusy("tags"); setCommentsError("");
    try {
      await apiFetch(`/organizations/${orgId}/orders/${orderId}/tags`, {
        method: "POST", body: JSON.stringify({ tags: next }),
      });
      onPatch({ tags: next });
    } catch (e) { setCommentsError(e instanceof Error ? e.message : "ট্যাগ সংরক্ষণ ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function postComment() {
    const orgId = getOrganizationId(); if (!orgId || !draft.trim()) return;
    setBusy("comment"); setCommentsError("");
    try {
      const created = await apiFetch<OrderComment>(`/organizations/${orgId}/orders/${orderId}/comments`, {
        method: "POST", body: JSON.stringify({ body: draft.trim() }),
      });
      setComments((prev) => [...prev, created]);
      setDraft("");
    } catch (e) { setCommentsError(e instanceof Error ? e.message : "মন্তব্য পাঠানো ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function deleteComment(c: OrderComment) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`del-${c.id}`); setCommentsError("");
    try {
      await apiFetch(`/organizations/${orgId}/orders/${orderId}/comments/${c.id}`, { method: "DELETE" });
      setComments((prev) => prev.filter((x) => x.id !== c.id));
    } catch (e) { setCommentsError(e instanceof Error ? e.message : "মন্তব্য মোছা ব্যর্থ"); }
    finally { setBusy(""); }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        {/* Customer 360 */}
        <div className="space-y-2 rounded-xl border bg-white p-3">
          <h4 className="text-sm font-semibold">👤 গ্রাহক ৩৬০ — অর্ডার {orderLabel}</h4>
          {c360Error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{c360Error}</p> : !c360 ? (
            <p className="text-xs text-slate-400">লোড হচ্ছে…</p>
          ) : !c360.customer ? (
            <p className="text-sm text-slate-500">অতিথি গ্রাহক — এই অর্ডারের সাথে কোনো গ্রাহক রেকর্ড যুক্ত নেই।</p>
          ) : (
            <div className="space-y-2 text-sm">
              <p className="font-medium">{c360.customer.name ?? "নাম নেই"}
                {c360.customer.phone ? <span className="ml-2 font-mono text-xs text-slate-500">{c360.customer.phone}</span> : null}
                {c360.customer.email ? <span className="ml-2 text-xs text-slate-500">{c360.customer.email}</span> : null}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                <span>মোট অর্ডার: <b>{c360.orderCount}</b></span>
                <span>ডেলিভার্ড: <b>{c360.deliveredCount}</b></span>
                <span>বাতিল: <b>{c360.cancelledCount}</b></span>
                <span>রিটার্ন: <b>{c360.returnedCount}</b></span>
                <span>সর্বমোট কেনাকাটা: <b>{money(c360.lifetimeValueMinor)}</b></span>
                <span>নির্ভরযোগ্যতা: <b>{c360.reliabilityPercent == null ? "—" : `${c360.reliabilityPercent}%`}</b></span>
                <span>খোলা বকেয়া: <b className={c360.openDueMinor && c360.openDueMinor !== "0" ? "text-red-600" : ""}>{money(c360.openDueMinor)}</b></span>
                <span>খোলা রিটার্ন: <b>{c360.openReturns}</b></span>
              </div>
              {c360.lastOrders.length > 0 ? (
                <div className="space-y-1 border-t pt-2">
                  <p className="text-xs font-semibold text-slate-600">সাম্প্রতিক অর্ডার</p>
                  {c360.lastOrders.map((lo) => (
                    <button key={lo.id} type="button" disabled={lo.id === orderId}
                      className="flex w-full flex-wrap items-baseline gap-x-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-left text-xs hover:bg-slate-100 disabled:opacity-60"
                      onClick={() => onOpenOrder(lo.id)}>
                      <span className="font-medium">#{lo.externalNumber ?? lo.id.slice(0, 8)}</span>
                      <span className="rounded bg-slate-200 px-1.5 py-0.5">{lo.status}</span>
                      <span className="font-semibold">{money(lo.totalMinor)}</span>
                      {lo.placedAt ? <span className="text-slate-400">{new Date(lo.placedAt).toLocaleDateString("bn-BD")}</span> : null}
                      {lo.id === orderId ? <span className="text-slate-400">(এই অর্ডার)</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Assignee + tags */}
        <div className="space-y-3 rounded-xl border bg-white p-3">
          <div className="space-y-1.5">
            <label className="text-sm font-semibold">👤 দায়িত্ব</label>
            <div className="flex flex-wrap items-center gap-2">
              <select className="input w-auto" value={assigneeId ?? ""} disabled={busy !== ""} onChange={(e) => void assign(e.target.value)}>
                <option value="">কেউ নয়</option>
                {members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.name ?? m.user.email} ({m.role})</option>)}
              </select>
              <span className="text-xs text-slate-500">বর্তমান: {memberName(members, assigneeId)}</span>
            </div>
          </div>
          <div className="space-y-1.5 border-t pt-3">
            <label className="text-sm font-semibold">🏷️ ট্যাগ</label>
            <div className="flex flex-wrap items-center gap-2">
              <input className="input flex-1" placeholder="কমা দিয়ে ট্যাগ (যেমন: vip, জরুরি)" value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} />
              <button type="button" className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => void saveTags()}>{busy === "tags" ? "হচ্ছে…" : "ট্যাগ সংরক্ষণ"}</button>
            </div>
            {(tags ?? []).length > 0 ? (
              <div className="flex flex-wrap gap-1">{(tags ?? []).map((t) => <span key={t} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">{t}</span>)}</div>
            ) : <p className="text-xs text-slate-400">কোনো ট্যাগ নেই।</p>}
          </div>
          {commentsError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{commentsError}</p> : null}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Timeline */}
        <div className="space-y-2 rounded-xl border bg-white p-3">
          <h4 className="text-sm font-semibold">🕘 টাইমলাইন — অর্ডারের পুরো ইতিহাস</h4>
          {timelineError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{timelineError}</p> : !timeline ? (
            <p className="text-xs text-slate-400">লোড হচ্ছে…</p>
          ) : timeline.entries.length === 0 ? (
            <p className="text-xs text-slate-400">এখনো কোনো ঘটনা রেকর্ড হয়নি।</p>
          ) : (
            <>
              <ul className="space-y-0">
                {timeline.entries.map((e, i) => (
                  <li key={i} className="relative flex gap-3 pb-3 last:pb-0">
                    <span className="flex flex-col items-center">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px]">{kindIcon(e.kind)}</span>
                      {i < timeline.entries.length - 1 ? <span className="mt-0.5 w-px flex-1 bg-slate-200" /> : null}
                    </span>
                    <span className="min-w-0 text-sm">
                      <span className="font-medium">{e.title}</span>
                      {e.detail ? <span className="block text-xs text-slate-600">{e.detail}</span> : null}
                      <span className="block text-[11px] text-slate-400">
                        {new Date(e.at).toLocaleString("bn-BD")}{e.actor ? ` · ${e.actor}` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              {timeline.truncated ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">আরও ছিল — সর্বশেষ ২০০টি দেখানো হচ্ছে</p> : null}
            </>
          )}
        </div>

        {/* Internal comments */}
        <div className="space-y-2 rounded-xl border bg-white p-3">
          <h4 className="text-sm font-semibold">💬 অভ্যন্তরীণ মন্তব্য — গ্রাহক এটি দেখবে না</h4>
          {comments.length === 0 ? (
            <p className="text-xs text-slate-400">এখনো কোনো মন্তব্য নেই।</p>
          ) : (
            <ul className="space-y-2">
              {comments.map((c) => (
                <li key={c.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-700">{c.authorName ?? memberName(members, c.authorId)}</span>
                    <span className="text-[11px] text-slate-400">{new Date(c.createdAt).toLocaleString("bn-BD")}</span>
                  </span>
                  <span className="mt-0.5 block whitespace-pre-wrap text-slate-700">{c.body}</span>
                  {/* Delete is shown for the author's own comments
                      (myId from /auth/me); the server also allows
                      admins and its error is shown verbatim. */}
                  {(myId === null || c.authorId === myId) ? (
                    <button type="button" className="mt-1 text-[11px] font-semibold text-red-600 hover:underline" disabled={busy !== ""} onClick={() => void deleteComment(c)}>
                      {busy === `del-${c.id}` ? "মুছছে…" : "মুছুন"}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2 border-t pt-2">
            <input className="input flex-1" placeholder="টিমের জন্য মন্তব্য লিখুন…" value={draft} maxLength={2000}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void postComment(); } }} />
            <button type="button" className="btn-primary btn-sm" disabled={busy !== "" || !draft.trim()} onClick={() => void postComment()}>
              {busy === "comment" ? "পাঠাচ্ছে…" : "যোগ করুন"}
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* ON6: delivery attempts — staff records of courier reports */}
        <div className="space-y-2 rounded-xl border bg-white p-3">
          <h4 className="text-sm font-semibold">🏠 ডেলিভারি চেষ্টা</h4>
          <p className="text-[11px] text-slate-400">কুরিয়ার যা জানিয়েছে তার রেকর্ড — কুরিয়ার সিস্টেমে পাঠানো হয় না।</p>
          {attemptsError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{attemptsError}</p> : null}
          {attempts === null && !attemptsError ? (
            <p className="text-xs text-slate-400">লোড হচ্ছে…</p>
          ) : (attempts ?? []).length === 0 ? (
            <p className="text-xs text-slate-400">এখনো কোনো ডেলিভারি চেষ্টা রেকর্ড হয়নি।</p>
          ) : (
            <ul className="space-y-1.5">
              {(attempts ?? []).map((a) => (
                <li key={a.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{deliveryAttemptOutcomeLabel(a.outcome)}</span>
                    <span className="text-[11px] text-slate-400">{new Date(a.attemptedAt ?? a.createdAt).toLocaleString("bn-BD")}</span>
                  </span>
                  {a.rescheduleDate ? <span className="block text-xs text-slate-600">নতুন তারিখ: {a.rescheduleDate}</span> : null}
                  {a.note ? <span className="block whitespace-pre-wrap text-xs text-slate-600">{a.note}</span> : null}
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-2 border-t pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <select className="input w-auto" value={attemptOutcome} onChange={(e) => setAttemptOutcome(e.target.value)} aria-label="ডেলিভারি চেষ্টার ফলাফল">
                {DELIVERY_ATTEMPT_OUTCOMES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              {attemptOutcome === "rescheduled" ? (
                <input className="input w-auto" type="date" value={attemptDate} onChange={(e) => setAttemptDate(e.target.value)} aria-label="পুনঃনির্ধারিত তারিখ" required />
              ) : null}
            </div>
            <div className="flex gap-2">
              <input className="input flex-1" placeholder="নোট (ঐচ্ছিক) — কুরিয়ার যা বলেছে" value={attemptNote} maxLength={1000}
                onChange={(e) => setAttemptNote(e.target.value)} />
              <button type="button" className="btn-primary btn-sm" disabled={busy !== ""} onClick={() => void recordAttempt()}>
                {busy === "attempt" ? "রেকর্ড হচ্ছে…" : "রেকর্ড করুন"}
              </button>
            </div>
          </div>
        </div>

        {/* ON5: notification log for this order */}
        <div className="space-y-2 rounded-xl border bg-white p-3">
          <h4 className="text-sm font-semibold">🔔 বিজ্ঞপ্তি লগ — গ্রাহককে পাঠানো বার্তা</h4>
          {logsError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{logsError}</p> : logs === null ? (
            <p className="text-xs text-slate-400">লোড হচ্ছে…</p>
          ) : logs.length === 0 ? (
            <p className="text-xs text-slate-400">এই অর্ডারের জন্য এখনো কোনো বিজ্ঞপ্তি লগ নেই।</p>
          ) : (
            <ul className="space-y-1.5">
              {logs.map((l, i) => (
                <li key={l.id ?? i} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{notificationEventLabel(l.event)}</span>
                    <span className="text-[11px] text-slate-400">{new Date(l.createdAt).toLocaleString("bn-BD")}</span>
                  </span>
                  <span className="block text-xs text-slate-600">
                    {notificationChannelLabel(l.channel)} · {notificationStatusLabel(l.status)}
                    {l.providerMessageId ? <span className="ml-1 font-mono text-[11px] text-slate-400">{l.providerMessageId}</span> : null}
                  </span>
                  {l.error ? <span className="block text-xs text-red-600">{l.error}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
